-- schema.sql — rode este arquivo uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).

-- Histórico de tudo que este sistema fez com cada pedido.
-- A unicidade de shopify_order_id é o que impede nota duplicada.
create table if not exists notas_processadas (
  id bigserial primary key,
  shopify_order_id text not null unique,
  shopify_order_name text not null,
  classificacao text not null,            -- atacado | franquia
  status text not null,                   -- preview | rascunho_criado | erro
  tiny_nota_id text,
  nota_emitida boolean not null default false, -- true só depois de confirmado no Tiny
  payload_enviado jsonb,
  resposta_tiny jsonb,
  erro text,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

-- Fila de trabalho do time: SKUs que precisam de cadastro ou de correção no Tiny.
create table if not exists itens_pendentes (
  id bigserial primary key,
  shopify_order_name text not null,
  sku text not null,
  quantidade int not null,
  motivo text not null,                   -- nao_encontrado | multiplos_cadastros
  criado_em timestamptz default now()
);

-- Para quem já rodou este schema antes de a coluna existir.
alter table notas_processadas add column if not exists nota_emitida boolean not null default false;

-- IDs de rascunhos antigos, substituídos por uma recriação (ver "editar
-- rascunho" na tela de rascunhos). A API do Tiny não tem endpoint para
-- alterar nem excluir uma nota — corrigir um rascunho significa criar um novo
-- no Tiny e cancelar/excluir o antigo lá dentro, à mão. Esta coluna é só o
-- registro de quais IDs antigos ainda esperam essa limpeza manual.
alter table notas_processadas add column if not exists tiny_notas_substituidas text[] not null default '{}';

-- Flags de configuração que precisam poder mudar em tempo real, sem depender
-- de reiniciar o servidor (variável de ambiente só é lida na inicialização).
-- PERMITIR_EMISSAO mora aqui, não no .env, por isso.
create table if not exists configuracoes (
  chave text primary key,
  valor boolean not null default false,
  atualizado_em timestamptz default now()
);

create index if not exists idx_notas_status on notas_processadas (status);
create index if not exists idx_pendentes_sku on itens_pendentes (sku);

-- CNPJs dos clientes franqueados. Antes vivia numa constante fixa em
-- classificacao.js; migrado para cá para poder ser editado sem deploy (ver
-- listarCnpjsFranquia em src/lib/db.js).
--
-- Este repositório é público (ou vai ser) — por isso a carga de dados reais
-- NÃO fica aqui. Cadastre os CNPJs direto no SQL Editor do Supabase, fora do
-- controle de versão, algo como:
--   insert into client_exce (cnpj, apelido) values ('00000000000000', 'Nome da franquia');
create table if not exists client_exce (
  cnpj text primary key,           -- só dígitos, sem máscara
  apelido text,                    -- nome da franquia, só para referência humana
  ativo boolean not null default true,
  criado_em timestamptz default now()
);

-- As tabelas são acessadas só pelo servidor, com a service role key, que ignora
-- RLS. Ligamos RLS mesmo assim para que nenhuma chave pública leia esses dados.
alter table notas_processadas enable row level security;
alter table itens_pendentes  enable row level security;
alter table configuracoes    enable row level security;
alter table client_exce   enable row level security;

-- Markup de cada franquia (ver src/lib/fiscal/markup.js): o valor do item na
-- nota é o preço do Shopify ÷ markup. Vazio = markup padrão de franquia (2,2).
-- Os limites são os mesmos da tela do rascunho (MARKUP_MINIMO/MARKUP_MAXIMO).
--   update client_exce set markup = 2.6 where cnpj = '00000000000000';
alter table client_exce add column if not exists markup numeric(6,4)
  check (markup is null or (markup >= 1 and markup <= 10));

-- Dados cadastrais da franquia (tela /pedidos/clientes) — mesmo trecho de
-- supabase/client-exce-cadastro.sql. Só referência: a nota usa o pedido.
alter table client_exce add column if not exists razao_social text;
alter table client_exce add column if not exists contato text;
alter table client_exce add column if not exists email text;
alter table client_exce add column if not exists telefone text;
alter table client_exce add column if not exists cep text;
alter table client_exce add column if not exists logradouro text;
alter table client_exce add column if not exists numero text;
alter table client_exce add column if not exists complemento text;
alter table client_exce add column if not exists bairro text;
alter table client_exce add column if not exists cidade text;
alter table client_exce add column if not exists uf text;
alter table client_exce add column if not exists observacoes text;
alter table client_exce add column if not exists atualizado_em timestamptz default now();

-- ---------------------------------------------------------------------------
-- Transferências entre lojas (tela /transferencias)
--
-- As notas de transferência moram em notas_processadas também, com o gid da
-- transferência (gid://shopify/InventoryTransfer/...) em shopify_order_id e
-- classificacao = 'transferencia'. Assim a trava contra nota duplicada, o
-- histórico e a emissão são os mesmos dos pedidos.
-- ---------------------------------------------------------------------------

-- Número da NF: preenchido pelo Tiny depois da emissão, ou digitado à mão
-- para transferências cuja nota foi emitida fora deste sistema.
alter table notas_processadas add column if not exists numero_nf text;

-- Dados fiscais de cada loja (local do Shopify). O Shopify não guarda CNPJ nem
-- IE de local, e o endereço dele não tem bairro — sem esta tabela a nota de
-- transferência não tem destinatário válido. Assim como client_exce, a
-- carga real NÃO fica no repositório. Cadastre pelo SQL Editor:
--   insert into lojas_fiscais (shopify_location_id, razao_social, cnpj, ie, logradouro, numero, bairro, cidade, uf, cep)
--   values ('gid://shopify/Location/123', 'RAZAO SOCIAL LTDA', '00000000000000', '000000000', 'Av. X', '100', 'Centro', 'Belo Horizonte', 'MG', '30000000');
-- Os ids dos locais estão em `locais` na resposta de GET /api/transferencias.
create table if not exists lojas_fiscais (
  shopify_location_id text primary key,  -- gid://shopify/Location/...
  razao_social text not null,
  cnpj text not null,                    -- só dígitos
  ie text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  criado_em timestamptz default now()
);

-- Regras da nota por loja de DESTINO (ver montarNotaTransferencia.js):
--   natureza_operacao    nome da natureza no Tiny (define o CFOP). Tem que ser
--                        IGUAL ao cadastro do Tiny, com acento e maiúsculas —
--                        nome desconhecido vira "Venda para contribuinte".
--                        Vazia = rascunho recusado.
--   natureza_operacao_id id da natureza no Tiny — é o que vai na nota
--                        (id_natureza_operacao); só o nome não bastou.
--                        Vazio = rascunho recusado.
--   base_valor           'custo' (padrão) ou 'venda' — de onde sai o valor do item.
--   desconto_percentual  % abatido do valor de cada item. 0 = sem desconto.
alter table lojas_fiscais add column if not exists natureza_operacao text;
alter table lojas_fiscais add column if not exists natureza_operacao_id bigint;
alter table lojas_fiscais add column if not exists base_valor text not null default 'custo'
  check (base_valor in ('custo', 'venda'));
alter table lojas_fiscais add column if not exists desconto_percentual numeric(5,2) not null default 0
  check (desconto_percentual >= 0 and desconto_percentual < 100);

-- Naturezas da conta do Tiny de cada loja de ORIGEM (quem emite a nota) —
-- o id muda de conta para conta. Ver supabase/naturezas-por-conta.sql e
-- src/lib/fiscal/naturezaTransferencia.js. Formato:
--   { "mesmo_estado": { "id": 0, "nome": "..." }, "interestadual": {...}, "consignacao": {...} }
-- Vazio nos CDs (conta da matriz) = natureza_operacao/_id do destino, como antes.
alter table lojas_fiscais add column if not exists naturezas_tiny jsonb;

alter table lojas_fiscais enable row level security;

-- ---------------------------------------------------------------------------
-- Transportadoras do atacado (tela /pedidos/transportadoras)
--
-- Por padrão a nota de atacado/franquia sai pelos Correios (ver
-- src/lib/fiscal/transporte.js). Cliente com CNPJ anexado a uma
-- transportadora ATIVA tem o bloco de transporte da nota trocado pelo dela.
-- Cadastro e anexos são feitos pela tela; a carga real não fica no repositório.
-- ---------------------------------------------------------------------------

-- Os dados vão direto no bloco de transporte da nota: a transportadora não
-- precisa estar cadastrada no Tiny, e o sistema não procura nem cadastra lá.
-- forma_frete  serviço contratado, com o rótulo inteiro do cadastro da Olist.
--              Vazio = o campo não vai na nota.
create table if not exists transportadoras (
  id bigserial primary key,
  nome text not null,
  cnpj text unique,                      -- só dígitos
  ie text,
  forma_frete text,
  endereco text,
  cidade text,
  uf text,
  ativo boolean not null default true,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

-- Cliente (CNPJ, só dígitos) -> transportadora. A chave primária no CNPJ
-- garante uma transportadora por cliente; apagar a transportadora solta os
-- anexos dela (os clientes voltam para os Correios).
create table if not exists clientes_transportadora (
  cnpj text primary key,
  nome text,                              -- só para referência humana
  transportadora_id bigint not null references transportadoras (id) on delete cascade,
  criado_em timestamptz default now()
);
create index if not exists idx_clientes_transportadora on clientes_transportadora (transportadora_id);

alter table transportadoras         enable row level security;
alter table clientes_transportadora enable row level security;

-- Cache da inscrição estadual (IE) dos clientes de atacado, por CNPJ. O
-- preview procura aqui antes de consultar o SintegrAPI (que cobra por
-- consulta) e grava o que a consulta trouxer. Ver supabase/clientes-ie.sql.
create table if not exists clientes_ie (
  cnpj text primary key,                 -- só dígitos
  ie text not null,                      -- só dígitos
  uf text,
  origem text not null default 'manual', -- 'sintegrapi' ou 'manual'
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

alter table clientes_ie enable row level security;

-- Controle dos boletos (tela /boletos), por pedido do Shopify. `emitido` é
-- marcado à mão na tela (padrão: pendente). `numero_nf` só existe quando a
-- pessoa corrige o nº na tela — vazio, vale o de notas_processadas. Ver
-- supabase/boletos.sql.
create table if not exists boletos (
  shopify_order_id text primary key,
  shopify_order_name text,
  emitido boolean not null default false,
  numero_nf text,                        -- nº da NF digitado; null = o da nota no Tiny
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

-- Pedido de boleto que acabou pago com cartão ou PIX (botão "Trocar para
-- cartão/PIX" da tela /boletos): pago_com null = boleto. O metafield do
-- Shopify e a nota não mudam. Os comprovantes desse pagamento (PDF ou imagem)
-- ficam em boletos_pdfs com tipo 'comprovante' e não marcam emitido.
alter table boletos add column if not exists pago_com text check (pago_com in ('cartao', 'pix'));
alter table boletos_pdfs add column if not exists tipo text not null default 'boleto'
  check (tipo in ('boleto', 'comprovante'));

-- Títulos da CAIXA (e-Cobrança) por NF — ver supabase/boletos-caixa.sql.
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

-- Quando o e-mail da nota (DANFE + XML) foi para a franquia — ver
-- supabase/email-nf-franquia.sql.
alter table notas_processadas add column if not exists email_nf_enviado_em timestamptz;
