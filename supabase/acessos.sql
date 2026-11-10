-- acessos.sql — papel de cada usuário do SAP (login e acesso às áreas).
-- Rode uma vez no SQL Editor. Depois, tudo pelo Table Editor (tabela "acessos").
--
-- Para dar acesso a alguém:
-- 1. Crie o usuário: Authentication > Users > Add user (e-mail + senha,
--    marque "Auto Confirm User").
-- 2. No Table Editor, tabela "acessos": Insert row com o e-mail (em
--    minúsculas, igual ao do usuário) e o papel.
--
-- Papéis (regras em src/lib/acessos.js):
--   admin       — tudo
--   financeiro  — B2B, Boletos e Transferências
--   varejo      — B2C
-- Quem não está na tabela entra, mas não vê nenhuma área. Trocar o papel ou
-- apagar a linha vale na próxima página que a pessoa abrir.

create table if not exists acessos (
  email text primary key check (email = lower(email)),
  papel text not null check (papel in ('admin', 'financeiro', 'varejo')),
  criado_em timestamptz default now()
);

alter table acessos enable row level security;

-- Cada usuário logado lê só a própria linha (é assim que o app descobre o
-- papel). Ninguém altera pelo app: só pelo painel do Supabase.
drop policy if exists "le o proprio acesso" on acessos;
create policy "le o proprio acesso" on acessos
  for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

-- Primeiro admin (troque o e-mail e descomente):
-- insert into acessos (email, papel) values ('voce@rowastore.com.br', 'admin');
