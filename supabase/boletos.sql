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

-- Vários PDFs por boleto (um por parcela, por exemplo): uma linha por arquivo,
-- em <id numérico do pedido>/<uuid>.pdf no bucket. Subir qualquer um marca o
-- boleto como emitido. O PDF único de boletos.pdf_path é copiado para cá; a
-- coluna fica só por compatibilidade e não é mais gravada.
create table if not exists boletos_pdfs (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text not null references boletos (shopify_order_id) on delete cascade,
  nome text not null,                    -- nome original do arquivo
  path text not null unique,             -- caminho no bucket boletos
  criado_em timestamptz default now()
);
create index if not exists boletos_pdfs_pedido_idx on boletos_pdfs (shopify_order_id, criado_em);
alter table boletos_pdfs enable row level security;
insert into boletos_pdfs (shopify_order_id, nome, path)
select shopify_order_id, coalesce(shopify_order_name, 'boleto') || '.pdf', pdf_path
from boletos
where pdf_path is not null
on conflict (path) do nothing;
