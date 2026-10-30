-- Mantém os fornecedores e artigos; remove apenas frequências semanais não incluídas no plano confirmado.
update public.suppliers
set order_weekday = null,
    delivery_weekday = null,
    updated_at = now()
where name in ('Pão', 'Garrafeira', 'Fruta');
