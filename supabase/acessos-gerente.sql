-- acessos-gerente.sql — libera o papel "gerente" na tabela acessos (vê o B2C
-- e a contagem de emissões, sem emitir — ver src/lib/acessos.js). Rode uma
-- vez no SQL Editor; quem criou a tabela com o acessos.sql atual não precisa.

alter table acessos drop constraint if exists acessos_papel_check;
alter table acessos add constraint acessos_papel_check
  check (papel in ('admin', 'financeiro', 'varejo', 'gerente'));
