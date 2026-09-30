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
--   insert into cnpjs_franquia (cnpj, apelido) values ('00000000000000', 'Nome da franquia');
create table if not exists cnpjs_franquia (
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
alter table cnpjs_franquia   enable row level security;

-- Markup de cada franquia (ver src/lib/fiscal/markup.js): o valor do item na
-- nota é o preço do Shopify ÷ markup. Vazio = markup padrão de franquia (2,2).
-- Os limites são os mesmos da tela do rascunho (MARKUP_MINIMO/MARKUP_MAXIMO).
--   update cnpjs_franquia set markup = 2.6 where cnpj = '00000000000000';
alter table cnpjs_franquia add column if not exists markup numeric(6,4)
  check (markup is null or (markup >= 1 and markup <= 10));

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
-- transferência não tem destinatário válido. Assim como cnpjs_franquia, a
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
