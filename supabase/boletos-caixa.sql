-- boletos-caixa.sql — títulos da CAIXA (e-Cobrança) achados para cada NF.
-- Rode no SQL Editor do Supabase (é o mesmo trecho do final de schema.sql;
-- pode rodar mais de uma vez).
--
-- Uma linha por título (nosso número). O vínculo com o pedido é pelo nº da NF
-- — o pedido não tem tabela própria (vem do Shopify), e o nº da NF de um
-- pedido pode ser corrigido na tela (boletos.numero_nf). Cliente, CNPJ e
-- total ficam no pedido; aqui só o que é do título.
--
--   origem 'gerado'     achado pelo nosso número padrão (14 + NF + parcela)
--                       no link de impressão da CAIXA — ver src/lib/caixa/
--   origem 'importado'  veio do arquivo da Consulta de Títulos do e-Cobrança
--                       (ver src/lib/caixa/consultaTitulos.js)
--
-- A NF de um título importado é a do NUM.DOCUMENTO da CAIXA. `situacao` fica
-- null até vir de um arquivo da CAIXA: o PDF não diz se o título foi pago.
-- O PDF fica no bucket `boletos`, em caixa/<nosso número>.pdf.
create table if not exists boletos_caixa (
  nosso_numero text primary key,           -- 17 dígitos, sem o DV
  nf_numero integer not null,
  parcela integer,                         -- null: nosso número fora do padrão da NF
  valor numeric(12, 2),
  vencimento date,
  situacao text check (situacao in ('em_aberto', 'liquidado', 'baixado', 'outro')),
  data_entrada date,
  data_liquidacao date,
  pdf_path text,
  origem text not null check (origem in ('gerado', 'importado')),
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);
-- Quem rodou a primeira versão deste arquivo tinha parcela not null.
alter table boletos_caixa alter column parcela drop not null;
create index if not exists boletos_caixa_nf_idx on boletos_caixa (nf_numero, parcela);
alter table boletos_caixa enable row level security;
