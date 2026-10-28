-- recolocar-pedido.sql — desfaz o apagar-pedido.sql: religa o pedido à nota
-- que já existe no Tiny, sem criar nem emitir outra. Nada vai para o Tiny.
--
-- Precisa de três valores (troque nos dois lugares em que aparecem):
-- • ID_DO_PEDIDO: na tela de atacado, "Conferir itens" no pedido abre
--   /pedidos/<ID_DO_PEDIDO>/rascunho — são só os dígitos da URL.
-- • ID_NOTA_TINY: o "id" da nota no Tiny (URL da nota), não o nº da NF.
-- • NUMERO_NF: o nº da NF com os zeros, ex.: '024807'.
--
-- Até rodar, não clique em "Criar e emitir" nem "Só rascunho" no pedido:
-- isso cria uma segunda nota no Tiny.
--
-- Abrir "Conferir itens" já grava uma linha de prévia (status 'preview') do
-- pedido — por isso o on conflict: aproveita essa linha e o payload_enviado
-- dela (usado pela tela de boletos para contar as parcelas).

insert into notas_processadas
  (shopify_order_id, shopify_order_name, classificacao, status, tiny_nota_id, nota_emitida, numero_nf)
values
  ('gid://shopify/Order/ID_DO_PEDIDO', '#NUMERO', 'franquia', 'rascunho_criado', 'ID_NOTA_TINY', true, 'NUMERO_NF')
on conflict (shopify_order_id) do update set
  status = 'rascunho_criado',
  tiny_nota_id = excluded.tiny_nota_id,
  nota_emitida = true,
  numero_nf = excluded.numero_nf,
  erro = null,
  atualizado_em = now();
-- classificacao: 'franquia' ou 'atacado', como o pedido aparece na tela.
-- No conflito, a classificacao da linha de prévia é mantida.

-- Confira (deve vir uma linha só, com o gid certo):
select id, shopify_order_id, shopify_order_name, status, tiny_nota_id, numero_nf, nota_emitida
  from notas_processadas where shopify_order_name = '#NUMERO';
