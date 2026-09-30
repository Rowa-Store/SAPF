-- Naturezas de operação por conta do Tiny — a nota de transferência sai da
-- conta Olist da loja de ORIGEM, e o id de uma natureza muda de conta para
-- conta. Cada loja de origem guarda aqui as naturezas da conta DELA (ver
-- src/lib/fiscal/naturezaTransferencia.js).
--
-- Qual natureza vai na nota:
--   consignacao   — a natureza_operacao do DESTINO é de consignação;
--   mesmo_estado  — origem e destino com a mesma uf em lojas_fiscais;
--   interestadual — ufs diferentes.
-- "nome" tem que ser IGUAL ao da natureza no Tiny da loja (acentos e
-- maiúsculas inclusos) — é ele que a emissão confere. O id aparece na URL ao
-- abrir a natureza no Tiny DA LOJA (Configurações > Naturezas de operação >
-- editar, parâmetro buscaid).
--
-- Os CDs emitem pela conta da matriz e podem ficar sem naturezas_tiny: nesse
-- caso segue valendo natureza_operacao / natureza_operacao_id do destino.
--
-- Rodar no SQL Editor do Supabase. O alter é idempotente; troque os ids e
-- nomes de exemplo pelos de cada conta antes de rodar os updates. Uma loja
-- que nunca envia para outro estado não precisa de "interestadual" (e o
-- mesmo vale para "consignacao").

alter table lojas_fiscais add column if not exists naturezas_tiny jsonb;

-- Modelo — um update por loja de origem:
--
-- update lojas_fiscais set naturezas_tiny = '{
--   "mesmo_estado":  { "id": 0, "nome": "Transferência de mercadoria entre lojas sp" },
--   "interestadual": { "id": 0, "nome": "TRANSFERENCIA INTERESTADUAL" },
--   "consignacao":   { "id": 0, "nome": "Remessa de mercadoria em consignação mercantil ou industrial" }
-- }' where shopify_location_id = 'gid://shopify/Location/...';
--
-- Locais (Shopify):
--   Rowa  Morumbi Shopping                gid://shopify/Location/66539814982
--   Rowa  Oscar Freire                    gid://shopify/Location/73478537286
--   Rowa  Shopping Anália Franco          gid://shopify/Location/66540011590
--   Rowa Shopping Center Norte            gid://shopify/Location/69768511558
--   Rowa Bh Shopping                      gid://shopify/Location/78529298502
--   Rowa Diamon Mall Bh                   gid://shopify/Location/78528905286
--   Rowa Boa Vista Village - Town Center  gid://shopify/Location/83028410438
--   Rowa Botânico Shopping                gid://shopify/Location/82351128646

-- Conferência: lojas sem uf (sem ela não dá para escolher a natureza) e o que
-- cada uma tem em naturezas_tiny.
select shopify_location_id, razao_social, uf,
       naturezas_tiny->'mesmo_estado'->>'id'  as mesmo_estado,
       naturezas_tiny->'interestadual'->>'id' as interestadual,
       naturezas_tiny->'consignacao'->>'id'   as consignacao
from lojas_fiscais
order by uf nulls first, razao_social;
