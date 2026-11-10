-- emissoes-por-usuario.sql — quem emitiu cada nota pelo SAP e quantas notas
-- cada usuário emitiu. Rode uma vez no SQL Editor, ANTES do deploy que grava
-- a coluna (se a coluna faltar, a emissão ainda é registrada, mas sem o
-- usuário — ver atualizarNotaEmitida em src/lib/db.js).
--
-- emitida_por: e-mail do usuário logado que clicou em emitir. Fica vazio na
-- nota emitida direto no Tiny (o SAP só descobre depois, pela situação) e nas
-- emitidas antes do login existir.

alter table notas_processadas add column if not exists emitida_por text;
alter table notas_processadas add column if not exists emitida_em timestamptz;

-- Quantidade de notas emitidas por usuário, por tipo de nota (varejo =
-- aba B2C; atacado/franquia = B2B; transferencia).
create or replace view notas_emitidas_por_usuario as
select emitida_por, classificacao, count(*) as notas, max(emitida_em) as ultima_emissao
from notas_processadas
where nota_emitida and emitida_por is not null
group by emitida_por, classificacao;
