-- Mantém o histórico de registos cancelados, mas permite que a colaboradora
-- corrija um engano apenas enquanto o registo ainda aguarda aprovação.
alter type public.attendance_status add value if not exists 'cancelled';
