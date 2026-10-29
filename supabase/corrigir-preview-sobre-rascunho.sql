-- corrigir-preview-sobre-rascunho.sql — devolve o status dos pedidos que
-- perderam o "rascunho_criado" ao abrir a tela do pedido (/pedidos/[id]/rascunho):
-- o preview gravava status 'preview' por cima, a lista B2B escondia o DANFE e
-- a emissão e o e-mail da franquia recusavam o pedido. Corrigido no código;
-- este update conserta as linhas já afetadas. Pode rodar mais de uma vez.
--
-- O preview nunca grava tiny_nota_id: status 'preview' com id de nota só
-- existe por causa do defeito. O payload_enviado dessas linhas ficou com o
-- recalculado na abertura da tela (mesmo cliente; itens e valores podem
-- diferir do que foi para o Tiny) — o original não volta.

-- Confira antes:
-- select shopify_order_name, tiny_nota_id, nota_emitida, numero_nf
-- from notas_processadas where status = 'preview' and tiny_nota_id is not null;

update notas_processadas
set status = 'rascunho_criado'
where status = 'preview' and tiny_nota_id is not null;
