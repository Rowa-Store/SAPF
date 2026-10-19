-- produtos-olist.sql — cadastro de produtos na Olist (tela /olist). Rode no
-- SQL Editor do Supabase (é o mesmo trecho do final de schema.sql; pode rodar
-- mais de uma vez).

-- Produtos do Shopify já levados à Olist pela tela /olist ("trazer do
-- Shopify"). shopify_atualizado_em guarda o updatedAt do Shopify no último
-- envio (ou quando a notificação foi dispensada): produto com updatedAt mais
-- novo que isso aparece no aviso de "atualizado no Shopify" da tela.
create table if not exists produtos_olist (
  shopify_product_id text primary key,
  titulo text,
  shopify_atualizado_em timestamptz,
  sincronizado_em timestamptz,
  criado_em timestamptz default now()
);

alter table produtos_olist enable row level security;
