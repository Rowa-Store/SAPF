// GET /api/pedidos/[id]/preview — monta tudo o que a tela do rascunho
// (/pedidos/[id]/rascunho) precisa. Só faz LEITURA: nada é gravado no Tiny
// aqui.

import { obterPedidoCompleto } from '@/lib/integrations/shopify';
import { classificarPedido, extrairCnpj } from '@/lib/fiscal/classificacao';
import { descontoDaNota, montarNotaAtacado, totalDaNota } from '@/lib/fiscal/montarNota';
import { registrarPreview, jaProcessado } from '@/lib/db';
import { erroJson, paraGid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request, { params }) {

  const { id } = await params;

  try {
    // 1. Pedido completo — a leitura pagina até o fim; item faltando é erro grave.
    const pedido = await obterPedidoCompleto(id);
    const classificacao = await classificarPedido(pedido);
    const { cnpj, origem } = extrairCnpj(pedido);

    const alertas = [];
    if (classificacao === 'outro') {
      alertas.push(
        'Este pedido não foi identificado como atacado nem franquia (nenhum CNPJ encontrado). ' +
          'Confira o cadastro no Shopify antes de continuar.'
      );
    }

    // 2. Metafields do pedido — lidos antes da nota porque a quantidade de
    // volumes vai dentro dela (bloco de transporte).
    async function fetchOrderMetafields(orderId) {
      const STORE = process.env.SHOPIFY_STORE_DOMAIN;
      const TOKEN = process.env.SHOPIFY_API_TOKEN;

      const res = await fetch(
        `https://${STORE}/admin/api/2026-07/orders/${orderId}/metafields.json`,
        {
          headers: { "X-Shopify-Access-Token": TOKEN || "" },
          cache: "no-store",
        },
      );

      if (!res.ok) return [];
      const data = await res.json();
      return data.metafields ?? [];
    }

    const metafields = await fetchOrderMetafields(id);
    const noteAttributes = pedido.noteAttributes ?? [];

    // A chave é comparada sem diferenciar maiúsculas: o metafield (e o
    // atributo do pedido) é cadastrado à mão no Shopify, então a grafia varia.
    // Com a busca exata, uma chave escrita de outro jeito não casava e o valor
    // chegava vazio aqui — a nota ia sem forma de pagamento mesmo com boleto.
    const getMetafield = (key) => {
      const alvo = key.toLowerCase();
      return (
        metafields.find(
          (m) => m.namespace?.toLowerCase() === "custom" && m.key?.toLowerCase() === alvo,
        )?.value ??
        noteAttributes.find((attr) => attr.key?.toLowerCase() === alvo)?.value ??
        ""
      );
    };

    const metodoPagamento = getMetafield("metodo_pagamento") || "Não informado";
    const volumePedido = getMetafield("volume_pedido") || "Não informado";
    // Texto livre ("1200,45", "1.200,45", "R$ 1200.00") — quem converte para
    // número é desconto.js; aqui o valor segue cru, como os outros metafields.
    const descontoPedido = getMetafield("desconto");

    // 3. Nota montada a partir do pedido.
    const { payload, alertas: alertasNota, markup, precosVarejo } = montarNotaAtacado(pedido, classificacao, {
      volumes: volumePedido,
      metodoPagamento: metodoPagamento,
      desconto: descontoPedido,
    });
    alertas.push(...alertasNota);

    // 4. Já existe rascunho para este pedido?
    const processado = await jaProcessado(paraGid(id));
    if (processado.processado) {
      alertas.push(
        `Este pedido já gerou o rascunho ${processado.tinyNotaId} no Tiny. ` +
          'Criar outro geraria nota duplicada.'
      );
    }

    // 5. Histórico (não bloqueia se o Supabase não estiver configurado).
    const registro = await registrarPreview({
      orderId: pedido.id,
      orderName: pedido.name,
      classificacao,
      payload,
    });
    if (!registro.ok) {
      console.error(`[preview] Falha ao registrar o preview do pedido ${pedido.id} no Supabase:`, registro.erro);
    }

    return Response.json({
      pedido: {
        id: pedido.id,
        name: pedido.name,
        createdAt: pedido.createdAt,
        note: pedido.note,
        cliente: pedido.customer,
        billingAddress: pedido.billingAddress,
        shippingAddress: pedido.shippingAddress,
        descontos: pedido.discountApplications?.nodes ?? [],
        itens: pedido.lineItems,
        totalItens: pedido.lineItems.length,
        paginasLidas: pedido.paginasLidas,
        valorFrete: Number(pedido.currentShippingPriceSet?.shopMoney?.amount ?? 0),
        cnpj,
        origemCnpj: origem,
        metodoPagamento: metodoPagamento,
        volumePedido: volumePedido,
        // O que a tela mostra é o desconto que entrou na nota, não o texto cru.
        valorDesconto: descontoDaNota(payload)

      },
      classificacao,
      payload,
      // Markup padrão da classificação e o preço do Shopify de cada item (na
      // ordem de payload.nota_fiscal.itens) — a tela usa os dois para
      // recalcular a nota quando alguém troca o markup (ver markup.js).
      markup,
      precosVarejo,
      totalNota: totalDaNota(payload),
      alertas,
      jaProcessado: processado.processado,
      tinyNotaId: processado.tinyNotaId ?? null,
    });
  } catch (erro) {
    return erroJson(`Não foi possível montar o preview do pedido ${id}: ${erro.message}`);
  }
}
