-- apagar-pedido.sql — tira um pedido do sistema como se nunca tivesse passado
-- por aqui: nota, boleto, PDFs do boleto e itens pendentes.
-- Troque #NUMERO pelo pedido (com #) em todos os lugares e rode no SQL Editor.
--
-- Antes de rodar:
-- • PDFs de boleto: se o passo 1 listar boletos_pdfs, apague os PDFs pela tela
--   /boletos primeiro — lá o arquivo sai também do Storage; este SQL só apaga
--   o registro.
-- • Nota no Tiny: nada aqui mexe no Tiny. Nota autorizada continua valendo e
--   precisa ser cancelada lá, senão refazer o pedido gera nota duplicada.
-- • Para desfazer: recolocar-pedido.sql religa o pedido à nota que já existe
--   no Tiny.

-- 1. Confira o que vai sair (deve aparecer só o pedido certo)
select 'notas_processadas' t, shopify_order_name, status, tiny_nota_id, numero_nf::text
  from notas_processadas where shopify_order_name = '#NUMERO'
union all
select 'boletos', b.shopify_order_name, null, null, b.numero_nf
  from boletos b where b.shopify_order_name = '#NUMERO'
union all
select 'boletos_pdfs', b.shopify_order_name, null, null, p.path
  from boletos_pdfs p join boletos b using (shopify_order_id) where b.shopify_order_name = '#NUMERO'
union all
select 'itens_pendentes', shopify_order_name, motivo, sku, null
  from itens_pendentes where shopify_order_name = '#NUMERO';

-- 2. Apague
begin;
delete from boletos where shopify_order_id in
  (select shopify_order_id from notas_processadas where shopify_order_name = '#NUMERO')
  or shopify_order_name = '#NUMERO';   -- boletos_pdfs sai junto (on delete cascade)
delete from itens_pendentes where shopify_order_name = '#NUMERO';
delete from notas_processadas where shopify_order_name = '#NUMERO';
commit;
