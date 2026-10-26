-- boletos.sql — tabela da tela /boletos. Rode no SQL Editor do Supabase (é o
-- mesmo trecho do final de schema.sql; pode rodar mais de uma vez).

create table if not exists boletos (
  shopify_order_id text primary key,
  shopify_order_name text,
  emitido boolean not null default false,
  numero_nf text,
  atualizado_em timestamptz default now()
);

alter table boletos enable row level security;
