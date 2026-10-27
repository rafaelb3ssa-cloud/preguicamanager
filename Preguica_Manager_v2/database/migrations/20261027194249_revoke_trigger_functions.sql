-- Estas funções são chamadas apenas pelos respetivos triggers; nunca pela API.
begin;
revoke all on function public.audit_stock_quantity_change() from public, anon, authenticated;
revoke all on function public.audit_leave_request_change() from public, anon, authenticated;
commit;
