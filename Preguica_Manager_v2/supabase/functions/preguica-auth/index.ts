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
type Profile = { id: string; display_name: string; role: 'owner' | 'manager' | 'staff'; active: boolean; activity_exempt: boolean };

async function currentProfile(req: Request): Promise<Profile | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (token.length < 32) return null;
  const { data: session } = await db.from('app_sessions').select('profile_id, expires_at')
    .eq('token_hash', await sha(token)).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!session) return null;
  const { data } = await db.from('profiles').select('id,display_name,role,active,activity_exempt').eq('id', session.profile_id).eq('active', true).maybeSingle();
  return data as Profile | null;
}
const canManage = (profile: Profile) => profile.role === 'owner' || profile.role === 'manager';
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const dateInTimezone = (value: string | Date, timeZone = 'Europe/Lisbon') => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(x => x.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const lisbonToday = () => dateInTimezone(new Date());
const shiftIsoDate = (value: string, days: number) => { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10); };
const mondayOf = (value: string) => shiftIsoDate(value, -((new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7));
async function pagedRows<T>(makeQuery: (from: number, to: number) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await makeQuery(from, from + 999);
    if (error) throw error;
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
  throw new Error('A consulta excedeu o limite de segurança.');
}
async function eligibleActivityDays(profiles: Array<{id:string}>, fromDate: string, toDate: string): Promise<Set<string>> {
  const eligible = new Set<string>();
  if (!profiles.length || fromDate > toDate) return eligible;
  const staffIds = profiles.map(p => p.id);
  const schedules = await pagedRows<{id:string;week_start:string;version:number}>((from,to)=>db.from('weekly_schedules').select('id,week_start,version').eq('status','published').gte('week_start',mondayOf(fromDate)).lte('week_start',toDate).order('week_start',{ascending:true}).order('version',{ascending:false}).range(from,to));
  const latest = new Map<string,string>();
  for (const schedule of schedules) if (!latest.has(schedule.week_start)) latest.set(schedule.week_start,schedule.id);
  const scheduleIds = [...latest.values()];
  const shifts: Array<{staff_id:string;shift_date:string}> = [];
  for (let i=0;i<scheduleIds.length;i+=100) {
    const batch=scheduleIds.slice(i,i+100);
    shifts.push(...await pagedRows<{staff_id:string;shift_date:string}>((from,to)=>db.from('shifts').select('staff_id,shift_date').in('schedule_id',batch).in('staff_id',staffIds).gte('shift_date',fromDate).lte('shift_date',toDate).order('shift_date').range(from,to)));
  }
  for (const shift of shifts) eligible.add(`${shift.staff_id}|${String(shift.shift_date).slice(0,10)}`);
  const leaveRows=await pagedRows<{staff_id:string;start_date:string;end_date:string}>((from,to)=>db.from('leave_requests').select('staff_id,start_date,end_date').in('staff_id',staffIds).eq('status','approved').is('cancelled_at',null).lte('start_date',toDate).gte('end_date',fromDate).range(from,to));
  const leaveDays=new Set<string>();
  for(const leave of leaveRows){const first=String(leave.start_date).slice(0,10)<fromDate?fromDate:String(leave.start_date).slice(0,10),last=String(leave.end_date).slice(0,10)>toDate?toDate:String(leave.end_date).slice(0,10);for(let day=first;day<=last;day=shiftIsoDate(day,1))leaveDays.add(`${leave.staff_id}|${day}`)}
  const widenedFrom=shiftIsoDate(fromDate,-1), widenedTo=shiftIsoDate(toDate,2);
  const absences=await pagedRows<{staff_id:string;occurred_at:string}>((from,to)=>db.from('attendance_records').select('staff_id,occurred_at').in('staff_id',staffIds).in('kind',['absence','medical_leave']).gte('occurred_at',`${widenedFrom}T00:00:00Z`).lt('occurred_at',`${widenedTo}T00:00:00Z`).range(from,to));
  const absenceDays=new Set<string>();
  for(const absence of absences){const day=dateInTimezone(absence.occurred_at);if(day>=fromDate&&day<=toDate)absenceDays.add(`${absence.staff_id}|${day}`)}
  for(const key of leaveDays)eligible.delete(key);
  for(const key of absenceDays)eligible.delete(key);
  return eligible;
}
async function missingActivityDays(profiles:Array<{id:string;display_name:string;activity_exempt:boolean}>,fromDate:string,toDate:string){
  const required=profiles.filter(p=>!p.activity_exempt);
  const eligible=await eligibleActivityDays(required,fromDate,toDate);
  if(!eligible.size)return [];
  const submitted=await pagedRows<{staff_id:string;activity_date:string}>((from,to)=>db.from('staff_activity_logs').select('staff_id,activity_date').in('staff_id',required.map(p=>p.id)).eq('status','submitted').gte('activity_date',fromDate).lte('activity_date',toDate).range(from,to));
  const completed=new Set(submitted.map(x=>`${x.staff_id}|${String(x.activity_date).slice(0,10)}`));
  const names=new Map(required.map(p=>[p.id,p.display_name]));
  return [...eligible].filter(key=>!completed.has(key)).map(key=>{const [staff_id,activity_date]=key.split('|');return {staff_id,display_name:names.get(staff_id)||'—',activity_date,status:activity_date===lisbonToday()?'today':'overdue'}}).sort((a,b)=>a.activity_date.localeCompare(b.activity_date)||a.display_name.localeCompare(b.display_name,'pt-PT'));
}


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
    const { data: profile, error } = await db.from('profiles').select('id,display_name,role,active,activity_exempt').eq('id', profileId).eq('active', true).single();
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
  const staffActions=new Set(['stock:list','stock:quantity','daily-orders:list','daily-orders:save','suppliers:list','attendance:list','attendance:record','schedule:list','closures:list','haccp:list','haccp:training-status','haccp:training-acknowledge','haccp:temperature','haccp:checklist','cleaning:record','facility-cleaning:list','facility-cleaning:record','onboarding:status','onboarding:acknowledge','onboarding:menu']);
  if(actor.role==='staff'&&!staffActions.has(action))return fail('Este módulo está disponível apenas à Gerência.',403);

  if(action==='onboarding:status'){
    const revision='welcome-preguica-v2';let query=db.from('staff_onboarding_acknowledgements').select('profile_id,revision,acknowledged_at').eq('revision',revision);
    if(actor.role==='staff')query=query.eq('profile_id',actor.id);
    const {data,error}=await query.order('acknowledged_at',{ascending:false});if(error)return fail('Não foi possível carregar o estado de integração.',500);
    const {data:profiles}=actor.role==='staff'?await db.from('profiles').select('id,display_name').eq('id',actor.id):await db.from('profiles').select('id,display_name').eq('active',true).eq('role','staff').order('display_name');
    return reply({acknowledgements:(profiles||[]).map(p=>{const row=(data||[]).find(x=>x.profile_id===p.id);return{profile_id:p.id,display_name:p.display_name,acknowledged_at:row?.acknowledged_at||null};})});
  }
  if(action==='onboarding:acknowledge'){
    const revision='welcome-preguica-v2';const {error}=await db.from('staff_onboarding_acknowledgements').upsert({profile_id:actor.id,revision,acknowledged_at:new Date().toISOString()},{onConflict:'profile_id,revision'});
    return error?fail('Não foi possível guardar a confirmação.',400):reply({ok:true,revision});
  }
  if(action==='onboarding:menu'){
    const {data,error}=await db.from('product_recipes').select('id,name,category,ingredients,method').eq('active',true).order('category').order('name');
    if(error)return fail('Não foi possível carregar os artigos da carta.',500);
    return reply({recipes:(data||[]).map(r=>({id:r.id,name:r.name,category:r.category||'Outros',ingredients:Array.isArray(r.ingredients)?r.ingredients.join('; '):String(r.ingredients||''),training_note:/receita.{0,20}(confirmar|por confirmar)|confirmar.{0,20}receita|componente.{0,30}(por definir|a definir)|receita indicativa/i.test(String(r.method||''))?'Confirmar esta receita com a Gerência antes de a preparar.':''}))});
  }

  if (action === 'stock:list') {
    const { data, error } = await db.from('stock_items').select('id,name,category,unit,quantity,minimum_quantity,supplier_name,unit_cost_ex_vat,active').eq('active', true).order('category').order('name');
    return error ? fail('Não foi possível carregar o inventário.', 500) : reply({ items: (data || []).map(({unit_cost_ex_vat,...item})=>actor.role==='staff'?item:{...item,unit_cost_ex_vat}) });
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

  if (action === 'stock:minimum') {
    if (!canManage(actor)) return fail('Só a Gerência pode alterar quantidades mínimas.', 403);
    const itemId=String(body.itemId||''),minimum=Number(body.minimum);
    if(!/^[0-9a-f-]{36}$/i.test(itemId)||!Number.isFinite(minimum)||minimum<0)return fail('Quantidade mínima inválida.');
    const {error}=await db.from('stock_items').update({minimum_quantity:minimum,updated_by:actor.id,updated_at:new Date().toISOString()}).eq('id',itemId).eq('active',true);
    return error?fail('Não foi possível guardar o mínimo.',400):reply({ok:true});
  }

  if (action.startsWith('inventory:monthly:')) {
    if (!canManage(actor)) return fail('O inventário mensal está disponível apenas à Gerência.',403);
    const month=String(body.month||'');
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return fail('Seleciona um mês válido.');
    const inventoryMonth=`${month}-01`;
    if(action==='inventory:monthly:get'){
      const {data,error}=await db.from('monthly_inventory_counts').select('id,inventory_month,items,created_at,updated_at').eq('inventory_month',inventoryMonth).maybeSingle();
      if(error)return fail('Não foi possível carregar o inventário mensal.',500);
      const today=lisbonToday(),canStart=today.slice(0,7)===month&&Number(today.slice(8,10))<=14;
      return reply({count:data||null,canStart});
    }
    if(action==='inventory:monthly:start'){
      const today=lisbonToday();
      if(today.slice(0,7)!==month||Number(today.slice(8,10))>14)return fail('A contagem mensal só pode ser iniciada entre os dias 1 e 14 do mês selecionado.');
      const {data:existing,error:readError}=await db.from('monthly_inventory_counts').select('id,inventory_month,items,created_at,updated_at').eq('inventory_month',inventoryMonth).maybeSingle();
      if(readError)return fail('Não foi possível verificar a contagem mensal.',500);
      if(existing)return reply({count:existing,alreadyStarted:true});
      const {data:products,error:stockError}=await db.from('stock_items').select('id,name,category,unit,unit_cost_ex_vat').eq('active',true).order('category').order('name');
      if(stockError)return fail('Não foi possível preparar os artigos do inventário.',500);
      const items=(products||[]).map(x=>({stock_item_id:x.id,name:x.name,category:x.category||'Outros',unit:x.unit,counted_quantity:null,unit_cost_ex_vat:x.unit_cost_ex_vat==null?null:Number(x.unit_cost_ex_vat)}));
      const {data,error}=await db.from('monthly_inventory_counts').insert({inventory_month:inventoryMonth,items,created_by:actor.id,updated_by:actor.id}).select('id,inventory_month,items,created_at,updated_at').single();
      if(error){if(error.code==='23505'){const again=await db.from('monthly_inventory_counts').select('id,inventory_month,items,created_at,updated_at').eq('inventory_month',inventoryMonth).maybeSingle();if(again.data)return reply({count:again.data,alreadyStarted:true})}return fail('Não foi possível iniciar a contagem mensal.',400)}
      return reply({count:data});
    }
    if(action==='inventory:monthly:save'){
      const {data:count,error:readError}=await db.from('monthly_inventory_counts').select('id,items').eq('inventory_month',inventoryMonth).maybeSingle();
      if(readError)return fail('Não foi possível carregar a contagem antes de guardar.',500);
      if(!count)return fail('Inicia primeiro a contagem mensal.');
      const incoming=Array.isArray(body.items)?body.items:[];
      if(incoming.length>500)return fail('A lista de artigos excede o limite.');
      const values=new Map<string,number|null>();
      for(const value of incoming){const row=value&&typeof value==='object'?value as Record<string,unknown>:{};const id=String(row.stockItemId||'');const raw=row.countedQuantity;if(!/^[0-9a-f-]{36}$/i.test(id)||(raw!==null&&(!Number.isFinite(Number(raw))||Number(raw)<0)))return fail('Há uma quantidade de inventário inválida.');values.set(id,raw===null?null:Number(raw))}
      const snapshot=Array.isArray(count.items)?count.items as Array<Record<string,unknown>>:[];
      const items=snapshot.map(x=>({...x,counted_quantity:values.has(String(x.stock_item_id))?values.get(String(x.stock_item_id)):x.counted_quantity??null}));
      const {data,error}=await db.from('monthly_inventory_counts').update({items,updated_by:actor.id,updated_at:new Date().toISOString()}).eq('id',count.id).select('id,inventory_month,items,created_at,updated_at').single();
      return error?fail('Não foi possível guardar a contagem mensal.',400):reply({count:data});
    }
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
    const name = String(s.name || '').trim(), orderDay = Number(s.order_weekday), deliveryDay = s.delivery_weekday===null||s.delivery_weekday===''?null:Number(s.delivery_weekday);
    if (!name || name.length > 120 || !Number.isInteger(orderDay) || orderDay < 1 || orderDay > 7 || (deliveryDay!==null&&(!Number.isInteger(deliveryDay)||deliveryDay<1||deliveryDay>7))) return fail('Confirma os dados do fornecedor.');
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
    let q=db.from('attendance_records').select('id,staff_id,shift_id,kind,occurred_at,original_occurred_at,note,status,correction_reason,created_at').gte('occurred_at',`${start}T00:00:00Z`).lt('occurred_at',end).order('occurred_at',{ascending:false});
    if(actor.role==='staff') q=q.eq('staff_id',actor.id);
    const {data,error}=await q; if(error)return fail('Não foi possível carregar assiduidade.',500);
    const {data:profiles}=actor.role==='staff'?await db.from('profiles').select('id,display_name,weekly_hours').eq('id',actor.id):await db.from('profiles').select('id,display_name,weekly_hours').eq('active',true).eq('role','staff').order('display_name');
    const staffProfiles=profiles||[],name=(id:string)=>staffProfiles.find(p=>p.id===id)?.display_name||'—';const linkedIds=[...new Set((data||[]).map(x=>x.shift_id).filter(Boolean))],{data:linkedShifts}=linkedIds.length?await db.from('shifts').select('id,shift_date').in('id',linkedIds):{data:[],error:null};const shiftDate=new Map((linkedShifts||[]).map(x=>[x.id,x.shift_date]));
    const approved=(data||[]).filter(x=>['validated','corrected'].includes(x.status)&&['clock_in','clock_out'].includes(x.kind)).slice().sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at));
    const opened=new Map<string,string>(),totals:Record<string,number>={};
    for(const row of approved){if(row.kind==='clock_in'){opened.set(row.staff_id,row.occurred_at);continue;}const began=opened.get(row.staff_id);if(!began)continue;opened.delete(row.staff_id);const mins=(Date.parse(row.occurred_at)-Date.parse(began))/60000;if(mins>0&&mins<24*60){const monday=mondayOf(dateInTimezone(began));const key=`${row.staff_id}|${monday}`;totals[key]=(totals[key]||0)+mins/60;}}
    const monthLast=new Date(Date.UTC(year,mon,0)).toISOString().slice(0,10),weeks:string[]=[];for(let w=mondayOf(start);w<=monthLast;w=shiftIsoDate(w,7))weeks.push(w);
    const weeklySummary=staffProfiles.flatMap(p=>weeks.map(week=>{const hours=totals[`${p.id}|${week}`]||0,base=Number(p.weekly_hours||40),weekDone=shiftIsoDate(week,7)<=lisbonToday();return{staff_id:p.id,display_name:p.display_name,week_start:week,approved_hours:Math.round(hours*100)/100,weekly_hours:base,difference:Math.round((hours-base)*100)/100,week_complete:weekDone,has_punches:hours>0};}));
    return reply({records:(data||[]).map(x=>({...x,display_name:name(x.staff_id),shift_date:shiftDate.get(x.shift_id)||null})),weeklySummary});
  }
  if (action === 'attendance:record') {
    if(actor.role!=='staff')return fail('A assiduidade é registada pela própria colaboradora. A Gerência valida e corrige no histórico.',403);
    const kind=String(body.kind||''), at=String(body.occurredAt||''),shiftId=String(body.shiftId||'');
    if(!['clock_in','clock_out','absence','medical_leave','vacation'].includes(kind)||Number.isNaN(Date.parse(at))||Date.parse(at)>Date.now())return fail('Indica tipo, data e hora válidos.');
    if(!/^[0-9a-f-]{36}$/i.test(shiftId))return fail('Abre um turno publicado antes de registar a assiduidade.');
    const {data:shift,error:shiftError}=await db.from('shifts').select('id,schedule_id,staff_id,shift_date').eq('id',shiftId).eq('staff_id',actor.id).maybeSingle();if(shiftError||!shift)return fail('Só podes registar ocorrências nos teus próprios turnos.',403);
    const {data:schedule,error:scheduleError}=await db.from('weekly_schedules').select('id').eq('id',shift.schedule_id).eq('status','published').maybeSingle();if(scheduleError||!schedule)return fail('Este turno ainda não foi publicado.',403);
    const startOfShift=Date.parse(`${shift.shift_date}T00:00:00Z`),occurred=Date.parse(at),dayOfEvent=new Date(`${dateInTimezone(at)}T00:00:00Z`).getTime();if(dayOfEvent<startOfShift||dayOfEvent>startOfShift+86400000)return fail('A ocorrência tem de pertencer ao dia do turno ou à manhã seguinte.');
    const {data:prior,error:priorError}=await db.from('attendance_records').select('id,kind,status').eq('shift_id',shiftId).eq('staff_id',actor.id).neq('status','rejected');if(priorError)return fail('Não foi possível validar os registos deste turno.',500);
    if(['clock_in','absence','medical_leave','vacation'].includes(kind)&&prior?.some(x=>['clock_in','absence','medical_leave','vacation'].includes(x.kind)))return fail('Já existe uma entrada ou ocorrência registada para este turno.');
    if(kind==='clock_out'&&!prior?.some(x=>x.kind==='clock_in'))return fail('Regista primeiro a entrada deste turno.');
    if(kind==='clock_out'&&prior?.some(x=>x.kind==='clock_out'))return fail('A saída deste turno já foi registada.');
    const {error}=await db.from('attendance_records').insert({staff_id:actor.id,shift_id:shiftId,submitted_by:actor.id,kind,occurred_at:new Date(occurred).toISOString(),note:String(body.note||'').slice(0,1000),status:'pending'});
    return error?fail('Não foi possível guardar a assiduidade.',400):reply({ok:true});
  }
  if (action === 'attendance:note') {
    if(!canManage(actor))return fail('Só a Gerência pode editar notas de assiduidade.',403);
    const id=String(body.id||''),note=String(body.note||'').slice(0,1000);if(!/^[0-9a-f-]{36}$/i.test(id))return fail('Registo inválido.');
    const {error}=await db.from('attendance_records').update({correction_reason:note,reviewed_by:actor.id,reviewed_at:new Date().toISOString()}).eq('id',id);return error?fail('Não foi possível guardar a nota.',400):reply({ok:true});
  }
  if (action === 'attendance:review') {
    if(!canManage(actor))return fail('Só a gerência pode validar registos.',403);
    const id=String(body.id||''), status=String(body.status||'');
    if(!/^[0-9a-f-]{36}$/i.test(id)||!['validated','rejected','corrected'].includes(status))return fail('Indica uma validação válida.');
    const patch:any={status,reviewed_by:actor.id,reviewed_at:new Date().toISOString()};if(body.reason!==undefined)patch.correction_reason=String(body.reason||'').slice(0,1000);if(body.occurredAt){const corrected=String(body.occurredAt);if(Number.isNaN(Date.parse(corrected))||Date.parse(corrected)>Date.now())return fail('Indica uma hora corrigida válida.');const {data:original,error:readError}=await db.from('attendance_records').select('occurred_at,original_occurred_at').eq('id',id).maybeSingle();if(readError||!original)return fail('Não foi possível carregar o registo original.',400);patch.original_occurred_at=original.original_occurred_at||original.occurred_at;patch.occurred_at=new Date(corrected).toISOString();}if(status==='corrected'&&(!patch.correction_reason||!patch.occurred_at))return fail('A correção exige hora e motivo.');const {error}=await db.from('attendance_records').update(patch).eq('id',id);
    return error?fail('Não foi possível validar o registo.',400):reply({ok:true});
  }

  if (action === 'schedule:list') {
    const week=String(body.weekStart||''); if(!validDate(week))return fail('Indica a segunda-feira da semana.');
    const {data:schedules,error}=await db.from('weekly_schedules').select('id,week_start,version,status,published_at,accumulated_hours').eq('week_start',week).in('status',actor.role==='staff'?['published']:['draft','published']).order('version',{ascending:false}).limit(1);
    if(error)return fail('Não foi possível carregar o horário.',500); const schedule=schedules?.[0];
    let profileQuery=db.from('profiles').select('id,display_name,weekly_hours').eq('active',true).eq('role','staff').order('display_name');if(actor.role==='staff')profileQuery=profileQuery.eq('id',actor.id);
    let shiftQuery=schedule?db.from('shifts').select('id,staff_id,shift_date,starts_at,ends_at,break_minutes,notes').eq('schedule_id',schedule.id).order('shift_date'):null;if(shiftQuery&&actor.role==='staff')shiftQuery=shiftQuery.eq('staff_id',actor.id);
    const [profiles,shifts]=await Promise.all([profileQuery,shiftQuery||Promise.resolve({data:[],error:null})]);
    const {data:allSchedules,error:allError}=await db.from('weekly_schedules').select('id,week_start,version,accumulated_hours').eq('status','published').lte('week_start',week).order('week_start',{ascending:true}).order('version',{ascending:false});
    if(allError)return fail('Não foi possível calcular as horas acumuladas.',500);
    const byWeek=new Map<string,any>();for(const item of allSchedules||[])if(!byWeek.has(item.week_start))byWeek.set(item.week_start,item);
    if(schedule)byWeek.set(week,schedule);
    const ordered=[...byWeek.values()].sort((a,b)=>a.week_start.localeCompare(b.week_start));
    const allIds=ordered.map(x=>x.id);const {data:allShifts,error:allShiftError}=allIds.length?await db.from('shifts').select('schedule_id,staff_id,shift_date,starts_at,ends_at,break_minutes').in('schedule_id',allIds):{data:[],error:null};
    if(allShiftError)return fail('Não foi possível calcular as horas acumuladas.',500);
    const hoursBySchedule:Record<string,Record<string,number>>={},plannedByDay:Record<string,number>={};
    for(const row of allShifts||[]){const [sh,sm]=String(row.starts_at).slice(0,5).split(':').map(Number),[eh,em]=String(row.ends_at).slice(0,5).split(':').map(Number);let mins=eh*60+em-sh*60-sm;if(mins<0)mins+=1440;const hours=Math.max(0,mins-(row.break_minutes||0))/60,day=String((row as any).shift_date||'').slice(0,10);hoursBySchedule[row.schedule_id]??={};hoursBySchedule[row.schedule_id][row.staff_id]=(hoursBySchedule[row.schedule_id][row.staff_id]||0)+hours;if(day)plannedByDay[`${row.schedule_id}|${row.staff_id}|${day}`]=(plannedByDay[`${row.schedule_id}|${row.staff_id}|${day}`]||0)+hours;}
    const firstDay=ordered[0]?.week_start||week,attendanceEnd=shiftIsoDate(week,8);
    const punches=await pagedRows<{staff_id:string;kind:string;occurred_at:string;status:string}>((from,to)=>db.from('attendance_records').select('staff_id,kind,occurred_at,status').in('kind',['clock_in','clock_out']).in('status',['validated','corrected']).gte('occurred_at',`${shiftIsoDate(firstDay,-1)}T00:00:00Z`).lt('occurred_at',`${attendanceEnd}T00:00:00Z`).order('occurred_at').range(from,to));
    const actualByDay:Record<string,number>={},opened=new Map<string,string>();for(const punch of punches){if(punch.kind==='clock_in'){opened.set(punch.staff_id,punch.occurred_at);continue;}const began=opened.get(punch.staff_id);if(!began)continue;opened.delete(punch.staff_id);const minutes=(Date.parse(punch.occurred_at)-Date.parse(began))/60000;if(minutes>0&&minutes<1440){const day=dateInTimezone(began),key=`${punch.staff_id}|${day}`;actualByDay[key]=(actualByDay[key]||0)+minutes/60;}}
    const accumulated:Record<string,number>={};const saved=(item:any)=>item?.accumulated_hours&&typeof item.accumulated_hours==='object'?item.accumulated_hours as Record<string,unknown>:{};
    for(const profile of profiles.data||[]){let baseline=-1;for(let i=ordered.length-1;i>=0;i--)if(typeof saved(ordered[i])[profile.id]==='number'){baseline=i;break;}let balance=baseline>=0?Number(saved(ordered[baseline])[profile.id]):0;for(let i=Math.max(0,baseline);i<ordered.length;i++){const item=ordered[i];let worked=0;for(const [key,planned] of Object.entries(plannedByDay)){const [scheduleId,staffId,day]=key.split('|');if(scheduleId!==item.id||staffId!==profile.id)continue;worked+=actualByDay[`${profile.id}|${day}`]??planned;}for(const [key,hours] of Object.entries(actualByDay)){const [staffId,day]=key.split('|');if(staffId===profile.id&&mondayOf(day)===item.week_start&&!plannedByDay[`${item.id}|${profile.id}|${day}`])worked+=hours;}balance+=worked-Number(profile.weekly_hours||40);}accumulated[profile.id]=Math.round(balance*100)/100;}
    let scheduleAttendance:any[]=[];if(actor.role==='staff'&&(shifts.data||[]).length){const shiftIds=(shifts.data||[]).map(x=>x.id);const {data:attRows,error:attError}=await db.from('attendance_records').select('id,shift_id,kind,occurred_at,note,status,correction_reason').eq('staff_id',actor.id).in('shift_id',shiftIds).order('occurred_at');if(attError)return fail('Não foi possível carregar as confirmações do teu horário.',500);scheduleAttendance=attRows||[];}
    const visibleSchedule=actor.role==='staff'&&schedule?{...schedule,accumulated_hours:{[actor.id]:schedule.accumulated_hours?.[actor.id]}}:schedule;
    return reply({schedule:visibleSchedule||null,profiles:profiles.data||[],shifts:shifts.data||[],accumulated,scheduleAttendance});
  }
  if (action === 'schedule:balance-save') {
    if(!canManage(actor))return fail('Só a Gerência pode editar horas acumuladas.',403);
    const week=String(body.weekStart||''),staffId=String(body.staffId||''),hours=Number(body.accumulatedHours);if(!validDate(week)||!/^[0-9a-f-]{36}$/i.test(staffId)||!Number.isFinite(hours)||hours < -1000||hours > 1000)return fail('Indica uma semana, colaboradora e saldo válidos.');
    const {data:staff,error:staffError}=await db.from('profiles').select('id').eq('id',staffId).eq('active',true).eq('role','staff').maybeSingle();if(staffError||!staff)return fail('Colaboradora inválida.',403);
    let {data:schedule,error:scheduleError}=await db.from('weekly_schedules').select('id,version,accumulated_hours').eq('week_start',week).in('status',['draft','published']).order('version',{ascending:false}).limit(1).maybeSingle();if(scheduleError)return fail('Não foi possível carregar o horário.',500);
    if(!schedule){const prior=await db.from('weekly_schedules').select('version,accumulated_hours').eq('week_start',week).order('version',{ascending:false}).limit(1).maybeSingle();const made=await db.from('weekly_schedules').insert({week_start:week,version:(prior.data?.version||0)+1,status:'draft',accumulated_hours:prior.data?.accumulated_hours||{}}).select('id,version,accumulated_hours').single();if(made.error)return fail('Não foi possível preparar o saldo para esta semana.',400);schedule=made.data;}
    const balances=schedule.accumulated_hours&&typeof schedule.accumulated_hours==='object'?schedule.accumulated_hours:{};balances[staffId]=hours;const {error:updateError}=await db.from('weekly_schedules').update({accumulated_hours:balances}).eq('id',schedule.id);return updateError?fail('Não foi possível guardar o saldo acumulado.',400):reply({ok:true});
  }
  if (action === 'schedule:save') {
    if(!canManage(actor))return fail('Só a gerência pode editar horários.',403);
    const week=String(body.weekStart||''), items=Array.isArray(body.shifts)?body.shifts:[]; if(!validDate(week)||items.length>80)return fail('Horário inválido.');
    const existing=await db.from('weekly_schedules').select('id,version').eq('week_start',week).eq('status','draft').order('version',{ascending:false}).limit(1).maybeSingle();
    let schedule=existing.data;
    if(!schedule){const prior=await db.from('weekly_schedules').select('version,accumulated_hours').eq('week_start',week).order('version',{ascending:false}).limit(1).maybeSingle();const made=await db.from('weekly_schedules').insert({week_start:week,version:(prior.data?.version||0)+1,status:'draft',accumulated_hours:prior.data?.accumulated_hours||{}}).select('id,version').single();if(made.error)return fail('Não foi possível criar o rascunho.',400);schedule=made.data;}
    const clean=[]; for(const s of items){if(!validDate(String(s.date||''))||String(s.date)<week||String(s.date)>=new Date(Date.parse(week+'T00:00:00Z')+7*86400000).toISOString().slice(0,10)||new Date(`${String(s.date)}T12:00:00Z`).getUTCDay()===0||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.start||''))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.end||''))||!/^[0-9a-f-]{36}$/i.test(String(s.staffId||'')))return fail('Há um turno inválido. Ao domingo a equipa está sempre de folga.');clean.push({schedule_id:schedule.id,staff_id:s.staffId,shift_date:s.date,starts_at:s.start,ends_at:s.end,break_minutes:Math.max(0,Number(s.breakMinutes)||0),notes:String(s.notes||'').slice(0,300)});}
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

  if (action.startsWith('activity:')) {
    const today=lisbonToday();
    const settingsResult=await db.from('activity_requirement_settings').select('start_date').eq('singleton',true).single();
    if(settingsResult.error)return fail('Não foi possível carregar a data inicial do registo de atividade.',500);
    const startDate=String(settingsResult.data.start_date).slice(0,10);
    if(action==='activity:settings'){
      if(!canManage(actor))return fail('Só a Gerência pode alterar a data inicial.',403);
      if(typeof body.startDate==='string'){
        const date=String(body.startDate);
        if(!validDate(date)||date>today)return fail('A data inicial tem de ser válida e não pode ser futura.');
        const {error}=await db.from('activity_requirement_settings').update({start_date:date,updated_by:actor.id,updated_at:new Date().toISOString()}).eq('singleton',true);
        if(error)return fail('Não foi possível guardar a data inicial.',400);
        return reply({startDate:date});
      }
      return reply({startDate});
    }
    if(action==='activity:pending'){
      let profiles:Array<{id:string;display_name:string;activity_exempt:boolean}>;
      if(actor.role==='staff'){
        const {data,error}=await db.from('profiles').select('id,display_name,activity_exempt').eq('id',actor.id).eq('active',true).single();
        if(error||!data)return fail('Não foi possível carregar o teu perfil.',500);
        profiles=[data];
      }else{
        let q=db.from('profiles').select('id,display_name,activity_exempt').eq('role','staff').order('display_name');
        const filterId=String(body.staffId||'');
        if(filterId){if(!/^[0-9a-f-]{36}$/i.test(filterId))return fail('Colaboradora inválida.');q=q.eq('id',filterId)}
        const {data,error}=await q;if(error)return fail('Não foi possível carregar a equipa.',500);profiles=data||[];
      }
      const fromInput=String(body.from||startDate),toInput=String(body.to||today);
      if(!validDate(fromInput)||!validDate(toInput))return fail('Indica um intervalo de datas válido.');
      const fromDate=fromInput<startDate?startDate:fromInput,toDate=toInput>today?today:toInput;
      const pending=fromDate<=toDate?await missingActivityDays(profiles,fromDate,toDate):[];
      return reply({today,startDate,required:actor.role==='staff'?!Boolean(profiles[0]?.activity_exempt):null,exempt:actor.role==='staff'?Boolean(profiles[0]?.activity_exempt):false,staff:actor.role==='staff'?[]:profiles.map(p=>({id:p.id,display_name:p.display_name,activity_exempt:p.activity_exempt})),pending});
    }
    if(action==='activity:logs:list'){
      const from=String(body.from||startDate),to=String(body.to||today);
      if(!validDate(from)||!validDate(to)||from>to)return fail('Indica um intervalo de datas válido.');
      let staffIds:string[]=[];
      if(actor.role==='staff')staffIds=[actor.id];
      else if(body.staffId){const id=String(body.staffId);if(!/^[0-9a-f-]{36}$/i.test(id))return fail('Colaboradora inválida.');const {data:profile}=await db.from('profiles').select('id').eq('id',id).eq('role','staff').maybeSingle();if(!profile)return fail('Colaboradora não encontrada.',404);staffIds=[id]}
      else {const {data:profiles,error}=await db.from('profiles').select('id').eq('role','staff');if(error)return fail('Não foi possível carregar a equipa.',500);staffIds=(profiles||[]).map(p=>p.id)}
      if(!staffIds.length)return reply({logs:[]});
      const logs=await pagedRows<{id:string;staff_id:string;activity_date:string;activity_summary:string|null;handover_notes:string|null;status:string;submitted_at:string|null;updated_at:string}>((fromRow,toRow)=>db.from('staff_activity_logs').select('id,staff_id,activity_date,activity_summary,handover_notes,status,submitted_at,updated_at').in('staff_id',staffIds).gte('activity_date',from).lte('activity_date',to).order('activity_date',{ascending:false}).range(fromRow,toRow));
      if(actor.role==='staff')return reply({logs});
      const {data:names}=await db.from('profiles').select('id,display_name').in('id',staffIds);
      const lookup=new Map((names||[]).map(p=>[p.id,p.display_name]));
      return reply({logs:logs.map(x=>({...x,display_name:lookup.get(x.staff_id)||'—'}))});
    }
    if(action==='activity:save-draft'||action==='activity:submit'){
      if(actor.role!=='staff')return fail('Os registos são submetidos pela própria colaboradora.',403);
      const date=String(body.activityDate||'');
      if(!validDate(date)||date<startDate||date>today)return fail('A data tem de estar dentro do período da obrigação e não pode ser futura.');
      const summary=String(body.activitySummary||'').trim(),handover=String(body.handoverNotes||'').trim();
      if(summary.length>5000||handover.length>5000)return fail('O texto excede o limite de 5000 caracteres.');
      if(action==='activity:submit'&&(summary.length<5||handover.length<5))return fail('Preenche as atividades realizadas e o estado/ocorrências do turno. Se não houve ocorrências, escreve “Sem ocorrências”.');
      const eligible=await eligibleActivityDays([{id:actor.id}],date,date);
      if(!eligible.has(`${actor.id}|${date}`))return fail('Não há um turno publicado para essa data, ou existe uma ausência aprovada registada.');
      const {data:existing,error:existingError}=await db.from('staff_activity_logs').select('id,status').eq('staff_id',actor.id).eq('activity_date',date).maybeSingle();
      if(existingError)return fail('Não foi possível validar o registo existente.',500);
      if(existing?.status==='submitted')return fail('Este registo já foi submetido e não pode ser substituído.',409);
      const submitted=action==='activity:submit',now=new Date().toISOString();
      const values={activity_summary:summary||null,handover_notes:handover||null,status:submitted?'submitted':'draft',submitted_at:submitted?now:null,submitted_by:submitted?actor.id:null,updated_at:now};
      const result=existing?await db.from('staff_activity_logs').update(values).eq('id',existing.id).eq('status','draft').select('id').single():await db.from('staff_activity_logs').insert({staff_id:actor.id,activity_date:date,...values}).select('id').single();
      if(result.error)return fail('Não foi possível guardar o registo.',400);
      return reply({ok:true,status:submitted?'submitted':'draft',activityDate:date,submittedAt:submitted?now:null});
    }
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
    const fields=actor.role==='staff'?'id,name,category,ingredients,method,active':'id,name,category,sale_price_inc_vat,ingredient_cost_ex_vat,ingredients,method,active';
    const { data, error } = await db.from('product_recipes').select(fields).eq('active', true).order('category').order('name');
    if (error) return fail('Não foi possível carregar as fichas técnicas.', 500);
    const recipes = (data || []).map((r) => ({
      id: r.id, name: r.name, category: r.category,
      ...(actor.role==='staff'?{}:{sale:Number(r.sale_price_inc_vat),cost:Number(r.ingredient_cost_ex_vat)}),
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
