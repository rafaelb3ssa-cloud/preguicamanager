import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });
const fail = (message: string, status = 400) => reply({ error: message }, status);
const sha = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, '0')).join('');
};
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
type Profile = { id: string; display_name: string; role: 'owner' | 'manager' | 'staff'; active: boolean };

async function currentProfile(req: Request): Promise<Profile | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (token.length < 32) return null;
  const { data: session } = await db.from('app_sessions').select('profile_id, expires_at')
    .eq('token_hash', await sha(token)).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!session) return null;
  const { data } = await db.from('profiles').select('id,display_name,role,active').eq('id', session.profile_id).eq('active', true).maybeSingle();
  return data as Profile | null;
}
const canManage = (profile: Profile) => profile.role === 'owner' || profile.role === 'manager';
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return fail('Método não permitido.', 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('Pedido inválido.'); }
  const action = String(body.action || '');

  if (action === 'list-users') {
    const { data, error } = await db.from('profiles').select('id,display_name,role').eq('active', true).not('pin_hash','is',null).order('display_name');
    if (error) return fail('Não foi possível carregar os utilizadores.', 500);
    const profiles=data||[];
    const manager=profiles.find(p=>p.role==='owner')||profiles.find(p=>p.role==='manager');
    const collaborators=profiles.filter(p=>p.role==='staff').map(p=>({...p,login_label:p.display_name}));
    return reply({ users:[...(manager?[{...manager,login_label:'Gerência'}]:[]),...collaborators] });
  }

  if (action === 'login') {
    const profileId = String(body.profileId || '');
    const pin = String(body.pin || '');
    if (!/^[0-9]{4,8}$/.test(pin) || !/^[0-9a-f-]{36}$/i.test(profileId)) return fail('PIN ou utilizador inválido.', 401);
    const attemptKey = `pin:${profileId}`;
    const { data: locked } = await db.rpc('check_pin_login_lock', { p_attempt_key: attemptKey });
    if (locked) return fail('Demasiadas tentativas. Tenta novamente dentro de 15 minutos.', 429);
    const { data: valid, error: verifyError } = await db.rpc('verify_app_pin', { p_profile_id: profileId, p_pin: pin });
    if (verifyError || valid !== true) {
      await db.rpc('record_pin_login_attempt', { p_attempt_key: attemptKey, p_success: false });
      return fail('PIN incorreto.', 401);
    }
    await db.rpc('record_pin_login_attempt', { p_attempt_key: attemptKey, p_success: true });
    const { data: profile, error } = await db.from('profiles').select('id,display_name,role,active').eq('id', profileId).eq('active', true).single();
    if (error || !profile) return fail('Utilizador indisponível.', 401);
    const token = randomToken();
    const { error: sessionError } = await db.from('app_sessions').insert({ token_hash: await sha(token), profile_id: profile.id, expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() });
    if (sessionError) return fail('Não foi possível iniciar sessão.', 500);
    return reply({ token, profile });
  }

  if (action === 'logout') {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (token) await db.from('app_sessions').delete().eq('token_hash', await sha(token));
    return reply({ ok: true });
  }

  const actor = await currentProfile(req);
  if (!actor) return fail('Sessão expirada. Entra novamente.', 401);
  if (action === 'session') return reply({ profile: actor });
  const staffActions=new Set(['stock:list','stock:quantity','daily-orders:list','daily-orders:save','suppliers:list','haccp:list','haccp:training-status','haccp:training-acknowledge','haccp:temperature','haccp:checklist','cleaning:record','facility-cleaning:list','facility-cleaning:record','recipes:list']);
  if(actor.role==='staff'&&!staffActions.has(action))return fail('Este módulo está disponível apenas à Gerência.',403);

  if (action === 'stock:list') {
    const { data, error } = await db.from('stock_items').select('id,name,category,unit,quantity,minimum_quantity,supplier_name,unit_cost_ex_vat,active').eq('active', true).order('category').order('name');
    return error ? fail('Não foi possível carregar o inventário.', 500) : reply({ items: data || [] });
  }
  if (action === 'stock:quantity') {
    const quantity = Number(body.quantity), id = String(body.itemId || '');
    if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isFinite(quantity) || quantity < 0) return fail('Quantidade inválida.');
    const { error } = await db.from('stock_items').update({ quantity, updated_by: actor.id, updated_at: new Date().toISOString() }).eq('id', id).eq('active', true);
    return error ? fail('Não foi possível atualizar a quantidade.', 400) : reply({ ok: true });
  }
  if (action === 'daily-orders:list') {
    const date=String(body.date||new Date().toISOString().slice(0,10));
    if(!validDate(date))return fail('Indica uma data válida.');
    const {data,error}=await db.from('daily_order_items').select('stock_item_id,quantity,is_selected').eq('order_date',date);
    return error?fail('Não foi possível carregar a encomenda diária.',500):reply({items:data||[]});
  }
  if (action === 'daily-orders:save') {
    const date=String(body.date||''),items=Array.isArray(body.items)?body.items:[];
    if(!validDate(date)||items.length>500)return fail('Encomenda diária inválida.');
    const clean=[];for(const item of items){const row=item&&typeof item==='object'?item as Record<string,unknown>:{};const itemId=String(row.itemId||''),quantity=Number(row.quantity);if(!/^[0-9a-f-]{36}$/i.test(itemId)||!Number.isFinite(quantity)||quantity<0)return fail('Há um produto ou quantidade inválida.');clean.push({order_date:date,stock_item_id:itemId,quantity,is_selected:row.selected===true,ordered_by:actor.id,updated_at:new Date().toISOString()})}
    if(!clean.length)return reply({ok:true});
    const {error}=await db.from('daily_order_items').upsert(clean,{onConflict:'order_date,stock_item_id'});
    return error?fail('Não foi possível guardar a encomenda diária.',400):reply({ok:true});
  }

  if (action === 'stock:configure') {
    if (!canManage(actor)) return fail('Só a gerência pode criar ou configurar artigos.', 403);
    const item = body.item && typeof body.item === 'object' ? body.item as Record<string, unknown> : {};
    const name = String(item.name || '').trim(), unit = String(item.unit || '').trim();
    const quantity = Number(item.quantity), minimum = Number(item.minimum_quantity), cost = item.unit_cost_ex_vat == null ? null : Number(item.unit_cost_ex_vat);
    if (!name || !unit || name.length > 120 || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(minimum) || minimum < 0 || (cost !== null && (!Number.isFinite(cost) || cost < 0))) return fail('Confirma os dados do artigo.');
    const record = { name, category: String(item.category || 'Outros').slice(0, 80), unit, quantity, minimum_quantity: minimum, supplier_name: String(item.supplier_name || '').slice(0, 160) || null, unit_cost_ex_vat: cost, updated_by: actor.id, updated_at: new Date().toISOString(), active: true };
    const result = item.id ? await db.from('stock_items').update(record).eq('id', item.id).select('id').single() : await db.from('stock_items').insert(record).select('id').single();
    return result.error ? fail('Não foi possível guardar o artigo.', 400) : reply({ id: result.data.id });
  }

  if (action === 'suppliers:list') {
    const { data, error } = await db.from('suppliers').select('id,name,phone,order_weekday,delivery_weekday,active').eq('active', true).order('order_weekday').order('name');
    return error ? fail('Não foi possível carregar fornecedores.', 500) : reply({ suppliers: data || [] });
  }
  if (action === 'suppliers:save') {
    if (!canManage(actor)) return fail('Só a gerência pode editar fornecedores.', 403);
    const s = body.supplier && typeof body.supplier === 'object' ? body.supplier as Record<string, unknown> : {};
    const name = String(s.name || '').trim(), orderDay = Number(s.order_weekday), deliveryDay = Number(s.delivery_weekday);
    if (!name || name.length > 120 || !Number.isInteger(orderDay) || orderDay < 1 || orderDay > 7 || !Number.isInteger(deliveryDay) || deliveryDay < 1 || deliveryDay > 7) return fail('Confirma os dados do fornecedor.');
    const { error } = await db.from('suppliers').upsert({ name, phone: String(s.phone || '').trim().slice(0,40) || null, order_weekday: orderDay, delivery_weekday: deliveryDay, updated_at: new Date().toISOString() }, { onConflict: 'name' });
    return error ? fail('Não foi possível guardar o fornecedor.', 400) : reply({ ok: true });
  }

  if (action === 'facility-cleaning:list') {
    const month = String(body.month || new Date().toISOString().slice(0,7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('Indica um mês válido.');
    const [year, mon] = month.split('-').map(Number), start = `${month}-01`, end = new Date(Date.UTC(year,mon,1)).toISOString();
    let query = db.from('facility_cleaning_records').select('id,recorded_at,area_equipment,responsible_id,responsible_rubric,observations,product_used').gte('recorded_at', `${start}T00:00:00Z`).lt('recorded_at',end).order('recorded_at',{ascending:false});
    const { data, error } = await query;
    if (error) return fail('Não foi possível carregar o registo de instalações.',500);
    const ids = [...new Set((data || []).map(r=>r.responsible_id))];
    const { data: profiles } = ids.length ? await db.from('profiles').select('id,display_name').in('id',ids) : {data:[]};
    return reply({ records:(data||[]).map(r=>({...r,responsible:(profiles||[]).find(p=>p.id===r.responsible_id)?.display_name||'—'})) });
  }
  if (action === 'facility-cleaning:record') {
    const area = String(body.area || '').trim(), rubric = String(body.rubric || actor.display_name.split(/\s+/).map(x=>x[0]).join('').slice(0,4)).trim();
    const date = String(body.date || new Date().toISOString().slice(0,10)), time = String(body.time || new Date().toISOString().slice(11,16)), recordedAt = String(body.recordedAt || '');
    if (!area || area.length > 180 || !rubric || rubric.length > 30 || !validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || Number.isNaN(Date.parse(recordedAt))) return fail('Preenche área, data, hora e rubrica.');
    const { error } = await db.from('facility_cleaning_records').insert({ recorded_at:new Date(recordedAt).toISOString(), area_equipment:area, responsible_id:actor.id, responsible_rubric:rubric, observations:String(body.observations||'').slice(0,1000), product_used:String(body.product||'').slice(0,200) });
    return error ? fail('Não foi possível guardar o registo.',400) : reply({ok:true});
  }

  if (action === 'attendance:list') {
    const month = String(body.month || new Date().toISOString().slice(0,7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('Indica um mês válido.');
    const [year,mon]=month.split('-').map(Number), start=`${month}-01`, end=new Date(Date.UTC(year,mon,1)).toISOString();
    let q=db.from('attendance_records').select('id,staff_id,kind,occurred_at,note,status,created_at').gte('occurred_at',`${start}T00:00:00Z`).lt('occurred_at',end).order('occurred_at',{ascending:false});
    if(actor.role==='staff') q=q.eq('staff_id',actor.id);
    const {data,error}=await q; if(error)return fail('Não foi possível carregar assiduidade.',500);
    const ids=[...new Set((data||[]).map(x=>x.staff_id))], {data:profiles}=ids.length?await db.from('profiles').select('id,display_name').in('id',ids):{data:[]};
    return reply({records:(data||[]).map(x=>({...x,display_name:(profiles||[]).find(p=>p.id===x.staff_id)?.display_name||'—'}))});
  }
  if (action === 'attendance:record') {
    const kind=String(body.kind||''), at=String(body.occurredAt||'');
    if(!['clock_in','clock_out','late','early_departure','absence','medical_leave','other'].includes(kind)||Number.isNaN(Date.parse(at))||Date.parse(at)>Date.now())return fail('Indica tipo, data e hora válidos.');
    const {error}=await db.from('attendance_records').insert({staff_id:actor.id,submitted_by:actor.id,kind,occurred_at:new Date(at).toISOString(),note:String(body.note||'').slice(0,1000),status:'pending'});
    return error?fail('Não foi possível guardar a assiduidade.',400):reply({ok:true});
  }
  if (action === 'attendance:review') {
    if(!canManage(actor))return fail('Só a gerência pode validar registos.',403);
    const id=String(body.id||''), status=String(body.status||'');
    if(!/^[0-9a-f-]{36}$/i.test(id)||!['validated','rejected','corrected'].includes(status))return fail('Indica uma validação válida.');
    const {error}=await db.from('attendance_records').update({status,reviewed_by:actor.id,reviewed_at:new Date().toISOString(),correction_reason:String(body.reason||'').slice(0,1000)}).eq('id',id);
    return error?fail('Não foi possível validar o registo.',400):reply({ok:true});
  }

  if (action === 'schedule:list') {
    const week=String(body.weekStart||''); if(!validDate(week))return fail('Indica a segunda-feira da semana.');
    const {data:schedules,error}=await db.from('weekly_schedules').select('id,week_start,version,status,published_at').eq('week_start',week).in('status',actor.role==='staff'?['published']:['draft','published']).order('version',{ascending:false}).limit(1);
    if(error)return fail('Não foi possível carregar o horário.',500); const schedule=schedules?.[0];
    const [profiles,shifts]=await Promise.all([db.from('profiles').select('id,display_name,weekly_hours').eq('active',true).eq('role','staff').order('display_name'),schedule?db.from('shifts').select('id,staff_id,shift_date,starts_at,ends_at,break_minutes,notes').eq('schedule_id',schedule.id).order('shift_date'):Promise.resolve({data:[],error:null})]);
    const monthStart=`${week.slice(0,7)}-01`;
    const {data:priorSchedules,error:priorError}=await db.from('weekly_schedules').select('id,week_start,version').eq('status','published').gte('week_start',monthStart).lt('week_start',week).order('version',{ascending:false});
    if(priorError)return fail('Não foi possível calcular as horas acumuladas.',500);
    const latestPrior=new Map<string,string>(); for(const item of priorSchedules||[])if(!latestPrior.has(item.week_start))latestPrior.set(item.week_start,item.id);
    const priorIds=[...latestPrior.values()];
    const {data:priorShifts,error:priorShiftsError}=priorIds.length?await db.from('shifts').select('staff_id,starts_at,ends_at,break_minutes').in('schedule_id',priorIds):{data:[],error:null};
    if(priorShiftsError)return fail('Não foi possível calcular as horas acumuladas.',500);
    const accumulated:Record<string,number>={};
    const addHours=(row:{staff_id:string;starts_at:string;ends_at:string;break_minutes:number|null})=>{const [sh,sm]=String(row.starts_at).slice(0,5).split(':').map(Number),[eh,em]=String(row.ends_at).slice(0,5).split(':').map(Number);let minutes=eh*60+em-sh*60-sm;if(minutes<0)minutes+=1440;accumulated[row.staff_id]=(accumulated[row.staff_id]||0)+Math.max(0,minutes-(row.break_minutes||0))/60};
    for(const row of priorShifts||[])addHours(row);
    for(const row of shifts.data||[])addHours(row);
    return reply({schedule:schedule||null,profiles:profiles.data||[],shifts:shifts.data||[],accumulated});
  }
  if (action === 'schedule:save') {
    if(!canManage(actor))return fail('Só a gerência pode editar horários.',403);
    const week=String(body.weekStart||''), items=Array.isArray(body.shifts)?body.shifts:[]; if(!validDate(week)||items.length>80)return fail('Horário inválido.');
    const existing=await db.from('weekly_schedules').select('id,version').eq('week_start',week).eq('status','draft').order('version',{ascending:false}).limit(1).maybeSingle();
    let schedule=existing.data;
    if(!schedule){const prior=await db.from('weekly_schedules').select('version').eq('week_start',week).order('version',{ascending:false}).limit(1).maybeSingle();const made=await db.from('weekly_schedules').insert({week_start:week,version:(prior.data?.version||0)+1,status:'draft'}).select('id,version').single();if(made.error)return fail('Não foi possível criar o rascunho.',400);schedule=made.data;}
    const clean=[]; for(const s of items){if(!validDate(String(s.date||''))||String(s.date)<week||String(s.date)>=new Date(Date.parse(week+'T00:00:00Z')+7*86400000).toISOString().slice(0,10)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.start||''))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.end||''))||!/^[0-9a-f-]{36}$/i.test(String(s.staffId||'')))return fail('Há um turno inválido.');clean.push({schedule_id:schedule.id,staff_id:s.staffId,shift_date:s.date,starts_at:s.start,ends_at:s.end,break_minutes:Math.max(0,Number(s.breakMinutes)||0),notes:String(s.notes||'').slice(0,300)});}
    const staffIds=[...new Set(clean.map(x=>x.staff_id))]; if(staffIds.length){const {data:validStaff,error:staffError}=await db.from('profiles').select('id').in('id',staffIds).eq('active',true).eq('role','staff');if(staffError||validStaff?.length!==staffIds.length)return fail('O horário pode incluir apenas colaboradoras ativas.',403)}
    await db.from('shifts').delete().eq('schedule_id',schedule.id); if(clean.length){const {error}=await db.from('shifts').insert(clean);if(error)return fail('Não foi possível guardar os turnos.',400)} return reply({ok:true,scheduleId:schedule.id});
  }
  if (action === 'schedule:publish') {
    if(!canManage(actor))return fail('Só a gerência pode publicar horários.',403);
    const id=String(body.scheduleId||''); if(!/^[0-9a-f-]{36}$/i.test(id))return fail('Horário inválido.');
    const {error}=await db.from('weekly_schedules').update({status:'published',published_by:actor.id,published_at:new Date().toISOString()}).eq('id',id).eq('status','draft');
    return error?fail('Não foi possível publicar o horário.',400):reply({ok:true});
  }

  if (action === 'haccp:training-status') {
    const revision='cafe-preguica-haccp-manual-v1';
    let query=db.from('haccp_training_acknowledgements').select('profile_id,manual_revision,acknowledged_at').eq('manual_revision',revision).order('acknowledged_at',{ascending:false});
    if(actor.role==='staff')query=query.eq('profile_id',actor.id);
    const {data,error}=await query;if(error)return fail('Não foi possível carregar as confirmações de formação.',500);
    const ids=[...new Set((data||[]).map(x=>x.profile_id))],{data:profiles}=ids.length?await db.from('profiles').select('id,display_name').in('id',ids):{data:[]};
    return reply({revision,acknowledgements:(data||[]).map(x=>({...x,display_name:(profiles||[]).find(p=>p.id===x.profile_id)?.display_name||'—'}))});
  }
  if (action === 'haccp:training-acknowledge') {
    const revision='cafe-preguica-haccp-manual-v1';
    const {error}=await db.from('haccp_training_acknowledgements').upsert({profile_id:actor.id,manual_revision:revision,acknowledged_at:new Date().toISOString()},{onConflict:'profile_id,manual_revision'});
    return error?fail('Não foi possível registar a confirmação.',400):reply({ok:true});
  }

  if (action === 'haccp:list') {
    const temperatureMonth = String(body.temperatureMonth || new Date().toISOString().slice(0, 7));
    const cleaningMonth = String(body.cleaningMonth || temperatureMonth);
    const monthRange = (value: string) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
      const start = `${value}-01`;
      const [year, month] = value.split('-').map(Number);
      const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      return { start, end };
    };
    const temperatureRange = monthRange(temperatureMonth), cleaningRange = monthRange(cleaningMonth);
    if (!temperatureRange || !cleaningRange) return fail('Indica um mês válido.');
    const [records, tasks, cleaning] = await Promise.all([
      db.from('haccp_records').select('id,kind,record_date,recorded_at,staff_id,equipment_name,temperature_c,checklist_key,checklist_data,result,corrective_action').gte('record_date', temperatureRange.start).lt('record_date', temperatureRange.end).order('recorded_at', { ascending: false }),
      db.from('cleaning_tasks').select('id,name,frequency,active').eq('active', true).order('frequency').order('name'),
      db.from('cleaning_records').select('id,task_id,task_name,frequency,completed_at,completed_by,observations,product_used').gte('completed_at', `${cleaningRange.start}T00:00:00Z`).lt('completed_at', `${cleaningRange.end}T00:00:00Z`).order('completed_at', { ascending: false }),
    ]);
    if (records.error || tasks.error || cleaning.error) return fail('Não foi possível carregar os registos HACCP.', 500);
    const { data: profiles, error: profileError } = await db.from('profiles').select('id,display_name').eq('active', true);
    if (profileError) return fail('Não foi possível carregar responsáveis.', 500);
    return reply({ records: records.data || [], tasks: tasks.data || [], cleaning: cleaning.data || [], profiles: profiles || [] });
  }
  if (action === 'haccp:temperature' || action === 'haccp:checklist') {
    const recordDate = String(body.date || new Date().toISOString().slice(0, 10));
    if (!validDate(recordDate)) return fail('Indica uma data válida.');
    if (recordDate > new Date().toISOString().slice(0, 10)) return fail('Não é possível registar uma data futura.');
    const base = { staff_id: actor.id, recorded_at: new Date().toISOString(), record_date: recordDate };
    const record = action === 'haccp:temperature'
      ? { ...base, kind: 'temperature', equipment_name: String(body.equipment || '').trim().slice(0, 120), temperature_c: Number(body.temperature), checklist_data: { period: body.period === 'Tarde' ? 'Tarde' : 'Manhã' }, result: 'Registada; avaliar pelo plano HACCP aprovado', corrective_action: String(body.observations || '').slice(0, 2000) }
      : { ...base, kind: 'cleaning', checklist_key: String(body.checklist || '').slice(0, 80), checklist_data: body.checklistData && typeof body.checklistData === 'object' ? body.checklistData : {}, result: 'Registada', corrective_action: String(body.observations || '').slice(0, 2000) };
    if (action === 'haccp:temperature' && (!record.equipment_name || !Number.isFinite(record.temperature_c))) return fail('Indica equipamento e temperatura.');
    const { error } = await db.from('haccp_records').insert(record);
    return error ? fail('Não foi possível guardar o registo HACCP.', 400) : reply({ ok: true });
  }
  if (action === 'cleaning:record') {
    const id = String(body.taskId || '');
    const completedDate = String(body.completedDate || new Date().toISOString().slice(0, 10));
    if (!validDate(completedDate) || completedDate > new Date().toISOString().slice(0, 10)) return fail('Indica uma data válida para a conclusão.');
    const { data: task, error: taskError } = await db.from('cleaning_tasks').select('id,name,frequency').eq('id', id).eq('active', true).maybeSingle();
    if (taskError || !task) return fail('Tarefa não encontrada.', 404);
    const completedAt = `${completedDate}T${new Date().toISOString().slice(11, 23)}Z`;
    const { error } = await db.from('cleaning_records').insert({ task_id: task.id, task_name: task.name, frequency: task.frequency, completed_by: actor.id, completed_at: completedAt, observations: String(body.observations || '').slice(0, 2000), product_used: String(body.product || '').slice(0, 200) });
    return error ? fail('Não foi possível guardar a tarefa.', 400) : reply({ ok: true });
  }
  if (action === 'cleaning:add-monthly-task') {
    if (!canManage(actor)) return fail('Só a gerência pode adicionar tarefas.', 403);
    const name = String(body.name || '').trim();
    if (!name || name.length > 120) return fail('Indica um nome de tarefa.');
    const { error } = await db.from('cleaning_tasks').insert({ name, frequency: 'monthly', created_by: actor.id, active: true });
    return error ? fail('Não foi possível adicionar a tarefa mensal.', 400) : reply({ ok: true });
  }
  if (action === 'closures:list') {
    const year = Number(body.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) return fail('Indica um ano válido.');
    const { data, error } = await db.from('collective_closure_days').select('closed_date,closure_type,note').gte('closed_date', `${year}-01-01`).lt('closed_date', `${year + 1}-01-01`).order('closed_date');
    return error ? fail('Não foi possível carregar o mapa anual.', 500) : reply({ days: data || [] });
  }
  if (action === 'closures:save-day') {
    if (!canManage(actor)) return fail('Só a gerência pode alterar o mapa de encerramentos.', 403);
    const date = String(body.date || ''), type = String(body.type || ''), note = String(body.note || '').trim();
    if (!validDate(date) || !['public_holiday', 'collective_vacation', 'weekly_rest'].includes(type) || note.length > 300) return fail('Confirma a data, classificação e nota do encerramento.');
    const { error } = await db.from('collective_closure_days').upsert({ closed_date: date, closure_type: type, note: note || null, created_by: actor.id, updated_at: new Date().toISOString() }, { onConflict: 'closed_date' });
    return error ? fail('Não foi possível guardar o encerramento.', 400) : reply({ ok: true });
  }
  if (action === 'closures:remove-day') {
    if (!canManage(actor)) return fail('Só a gerência pode alterar o mapa de encerramentos.', 403);
    const date = String(body.date || '');
    if (!validDate(date)) return fail('Indica uma data válida.');
    const { error } = await db.from('collective_closure_days').delete().eq('closed_date', date);
    return error ? fail('Não foi possível remover o encerramento.', 400) : reply({ ok: true });
  }
  if (action === 'holidays:list') {
    const [leave, balances, profiles] = await Promise.all([
      db.from('leave_requests').select('id,staff_id,start_date,end_date,status,cancelled_at').eq('leave_type', 'holiday').order('start_date'),
      db.from('leave_balances').select('staff_id,reference_year,entitled_days,used_days'),
      db.from('profiles').select('id,display_name,role').eq('active', true),
    ]);
    if (leave.error || balances.error || profiles.error) return fail('Não foi possível carregar o mapa de férias.', 500);
    const names = new Map((profiles.data || []).map(p => [p.id, p.display_name]));
    return reply({ entries: (leave.data || []).map(x => ({ ...x, display_name: names.get(x.staff_id) || '—' })), balances: (balances.data || []).map(x => ({ ...x, display_name: names.get(x.staff_id) || '—', remaining_days: Number(x.entitled_days) - Number(x.used_days) })), staff: (profiles.data || []).filter(p => p.role === 'staff') });
  }
  if (action === 'holidays:collective') {
    if (!canManage(actor)) return fail('Só a gerência pode criar períodos de férias.', 403);
    const start = String(body.start || ''), end = String(body.end || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return fail('Confirma as datas do período.');
    const { data: staff, error: staffError } = await db.from('profiles').select('id').eq('active', true).eq('role', 'staff');
    if (staffError) return fail('Não foi possível carregar a equipa.', 500);
    if (!staff?.length) return fail('Não há colaboradoras ativas para registar.');
    const { error } = await db.from('leave_requests').insert(staff.map(p => ({ staff_id: p.id, leave_type: 'holiday', start_date: start, end_date: end, note: String(body.note || '').slice(0, 1000) || null, status: 'approved', decided_by: actor.id, decided_at: new Date().toISOString() })));
    return error ? fail('Não foi possível registar o período.', 400) : reply({ ok: true, affected: staff.length });
  }
  if (action === 'holidays:cancel') {
    if (!canManage(actor)) return fail('Só a gerência pode cancelar períodos.', 403);
    const { error } = await db.from('leave_requests').update({ cancelled_at: new Date().toISOString(), cancelled_by: actor.id }).eq('id', String(body.id || '')).eq('leave_type', 'holiday').is('cancelled_at', null);
    return error ? fail('Não foi possível cancelar o período.', 400) : reply({ ok: true });
  }
  if (action === 'holidays:balance') {
    if (!canManage(actor)) return fail('Só a gerência pode alterar saldos.', 403);
    const staffId = String(body.staffId || ''), year = Number(body.year), entitled = Number(body.entitled), used = Number(body.used);
    if (!/^[0-9a-f-]{36}$/i.test(staffId) || !Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isFinite(entitled) || entitled < 0 || !Number.isFinite(used) || used < 0 || used > entitled) return fail('Confirma os valores do saldo.');
    const { error } = await db.from('leave_balances').upsert({ staff_id: staffId, reference_year: year, entitled_days: entitled, used_days: used, updated_by: actor.id, updated_at: new Date().toISOString() }, { onConflict: 'staff_id,reference_year' });
    return error ? fail('Não foi possível guardar o saldo.', 400) : reply({ ok: true });
  }

  if (action === 'recipes:list') {
    const { data, error } = await db.from('product_recipes').select('id,name,category,sale_price_inc_vat,ingredient_cost_ex_vat,ingredients,method,active').eq('active', true).order('name');
    if (error) return fail('Não foi possível carregar as fichas técnicas.', 500);
    const recipes = (data || []).map((r) => ({
      id: r.id, name: r.name, category: r.category, sale: Number(r.sale_price_inc_vat), cost: Number(r.ingredient_cost_ex_vat),
      ingredients: Array.isArray(r.ingredients) ? r.ingredients.join('; ') : String(r.ingredients || ''), method: r.method || '',
    }));
    return reply({ recipes });
  }

  if (action === 'recipes:save') {
    if (!canManage(actor)) return fail('Sem permissões para alterar fichas técnicas.', 403);
    const r = (body.recipe && typeof body.recipe === 'object' ? body.recipe : {}) as Record<string, unknown>;
    const name = String(r.name || '').trim(), sale = Number(r.sale), cost = Number(r.cost);
    if (!name || name.length > 160 || !Number.isFinite(sale) || sale < 0 || !Number.isFinite(cost) || cost < 0) return fail('Confirma o nome e os valores da ficha.');
    const record = { name, category: String(r.category || '').slice(0, 100), sale_price_inc_vat: sale, ingredient_cost_ex_vat: cost,
      ingredients: [String(r.ingredients || '')], method: String(r.method || '').slice(0, 4000), active: true, updated_by: actor.id, updated_at: new Date().toISOString() };
    const existingName = String(body.existingName || '').trim();
    const { error } = existingName && existingName !== name
      ? await db.from('product_recipes').update(record).eq('name', existingName)
      : await db.from('product_recipes').upsert(record, { onConflict: 'name' });
    return error ? fail('Não foi possível guardar a ficha.', 400) : reply({ ok: true });
  }

  if (action.startsWith('users:')) {
    if (!canManage(actor)) return fail('Só a gerência pode gerir utilizadores.', 403);
    if (action === 'users:list') {
      const { data, error } = await db.from('profiles').select('id,display_name,role,active,weekly_hours,created_at').order('created_at');
      return error ? fail('Não foi possível carregar a equipa.', 500) : reply({ users: data || [] });
    }
    if (action === 'users:create') {
      const name = String(body.name || '').trim();
      const pin = String(body.pin || '');
      const role = actor.role === 'owner' && body.role === 'manager' ? 'manager' : 'staff';
      if (!name || name.length > 80 || !/^[0-9]{4,8}$/.test(pin)) return fail('Indica um nome e um PIN de 4 a 8 algarismos.');
      const { data, error } = await db.rpc('create_pin_profile', { p_name: name, p_role: role, p_pin: pin });
      return error ? fail('Não foi possível criar a conta.', 400) : reply({ user: data });
    }
    const userId = String(body.userId || '');
    const { data: target, error: targetError } = await db.from('profiles').select('id,role,active').eq('id', userId).maybeSingle();
    if (targetError || !target) return fail('Utilizador não encontrado.', 404);
    if (target.role === 'owner') return fail('A conta proprietária não pode ser alterada por aqui.', 403);
    if (actor.role !== 'owner' && target.role !== 'staff') return fail('Só o proprietário pode gerir contas de gerência.', 403);
    if (action === 'users:deactivate') {
      const { error } = await db.from('profiles').update({ active: false }).eq('id', userId);
      await db.from('app_sessions').delete().eq('profile_id', userId);
      return error ? fail('Não foi possível desativar a conta.', 500) : reply({ ok: true });
    }
    if (action === 'users:update') {
      const patch: Record<string, unknown> = {};
      if (typeof body.name === 'string' && body.name.trim()) patch.display_name = body.name.trim().slice(0, 80);
      if (typeof body.active === 'boolean') patch.active = body.active;
      if (actor.role === 'owner' && (body.role === 'manager' || body.role === 'staff')) patch.role = body.role;
      const { error } = Object.keys(patch).length ? await db.from('profiles').update(patch).eq('id', userId) : { error: null };
      if (typeof body.pin === 'string' && body.pin) {
        const { error: pinError } = await db.rpc('change_profile_pin', { p_profile_id: userId, p_pin: body.pin });
        if (pinError) return fail('O PIN deve ter 4 a 8 algarismos.', 400);
        await db.from('app_sessions').delete().eq('profile_id', userId);
      }
      return error ? fail('Não foi possível atualizar a conta.', 500) : reply({ ok: true });
    }
  }
  return fail('Ação desconhecida.', 404);
});
