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

-- PDF do boleto (upload na tela /boletos): bucket privado no Storage; o
-- caminho do arquivo fica em boletos.pdf_path. Subir o PDF marca emitido.
alter table boletos add column if not exists pdf_path text;
insert into storage.buckets (id, name, public)
values ('boletos', 'boletos', false)
on conflict (id) do nothing;
