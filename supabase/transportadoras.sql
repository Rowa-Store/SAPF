-- transportadoras.sql — para quem já rodou o schema.sql antes das
-- transportadoras existirem. Rode no SQL Editor do Supabase (é o mesmo trecho
-- do final de schema.sql; pode rodar mais de uma vez).

create table if not exists transportadoras (
  id bigserial primary key,
  nome text not null,
  cnpj text unique,
  ie text,
  forma_frete text,
  endereco text,
  cidade text,
  uf text,
  ativo boolean not null default true,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

create table if not exists clientes_transportadora (
  cnpj text primary key,
  nome text,
  transportadora_id bigint not null references transportadoras (id) on delete cascade,
  criado_em timestamptz default now()
);
create index if not exists idx_clientes_transportadora on clientes_transportadora (transportadora_id);

alter table transportadoras         enable row level security;
alter table clientes_transportadora enable row level security;
