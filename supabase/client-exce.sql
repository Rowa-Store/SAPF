-- client-exce.sql — renomeia a lista de clientes franqueados de cnpjs_franquia
-- para client_exce. Rode no SQL Editor do Supabase ANTES de publicar o código
-- que já lê client_exce (src/lib/db.js) — entre um e outro, todo pedido é
-- classificado como atacado. Pode rodar mais de uma vez.
--
-- O RLS, as colunas (cnpj, apelido, ativo, criado_em, markup) e os dados ficam
-- como estão; só os nomes mudam.

do $$
begin
  if to_regclass('public.cnpjs_franquia') is not null and to_regclass('public.client_exce') is null then
    alter table public.cnpjs_franquia rename to client_exce;
    alter table public.client_exce rename constraint cnpjs_franquia_pkey to client_exce_pkey;
  end if;
end $$;
