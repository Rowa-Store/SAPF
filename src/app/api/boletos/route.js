// GET /api/boletos — pedidos pagos com boleto (metafield
// `custom.metodo_pagamento` com "boleto"), com o status do boleto e o nº da
// NF de cada um, mais os títulos da CAIXA já achados para a NF.
//
// Mesma navegação da tela de atacado (ver api/pedidos/route.js): sem busca, a
// lista é POR DIA; com busca, não se prende a dia e vem paginada por cursor.
// Os pedidos vêm do Shopify e o filtro de boleto é aplicado aqui — o Shopify
// não busca por metafield —, então uma página de busca pode vir com menos
// boletos que pedidos.
//
//   ?dia=     AAAA-MM-DD; sem ele, hoje
//   ?busca=   termos separados por vírgula: nº do pedido, cliente, nº da NF ou CNPJ
//   ?cursor=  só com busca: página seguinte
//   ?todas=1  todos os pedidos B2B, de qualquer forma de pagamento (usado
//             pelo Fechamento de Caixa do hub-rowa); `ehBoleto` diz quais são

import { listarPedidosDoDia, listarPedidosRecentes, metodosDePagamento } from '@/lib/integrations/shopify';
import { diaValido, hoje, intervaloDoDia } from '@/lib/datas';
import { classificarComListaFranquia, extrairCnpj } from '@/lib/fiscal/classificacao';
import { FORMA_BOLETO, formaDePagamentoTiny } from '@/lib/fiscal/pagamento';
import { obterSituacaoNota } from '@/lib/integrations/tiny';
import {
  atualizarNotaEmitida,
  boletosPorPedido,
  listarCnpjsFranquia,
  pedidosPorNfOuCnpj,
  registrarNumeroNf,
  statusPorPedido,
  titulosCaixaPorNf,
} from '@/lib/db';
import { ITENS_POR_PAGINA } from '@/lib/constants';
import { erroJson, idNumerico, somenteDigitos } from '@/lib/utils';

/**
 * Nota com rascunho no Tiny e sem nº gravado: confere no Tiny e, se ela já
 * estiver emitida, grava a emissão e o nº (como /api/pedidos/[id]/situacao).
 * Uma por vez, pelo limite de chamadas do Tiny; falha numa não para a lista.
 * Muda `situacoes` no lugar.
 */
async function completarNumerosNf(situacoes) {
  const semNumero = Object.entries(situacoes).filter(
    ([, s]) => s.status === 'rascunho_criado' && s.tiny_nota_id && !s.numero_nf
  );
  for (const [gid, s] of semNumero) {
    try {
      const tiny = await obterSituacaoNota(s.tiny_nota_id);
      if (!tiny.emitida) continue;
      if (!s.nota_emitida) await atualizarNotaEmitida(gid, true);
      s.nota_emitida = true;
      if (tiny.numero) {
        const registro = await registrarNumeroNf({ orderId: gid, numeroNf: tiny.numero });
        if (!registro.ok) console.error(`[boletos] Falha ao gravar o nº da NF de ${gid}:`, registro.erro);
        s.numero_nf = tiny.numero;
      }
    } catch (erro) {
      console.error(`[boletos] Falha ao conferir a nota ${s.tiny_nota_id} no Tiny:`, erro.message);
    }
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const busca = new URL(request.url).searchParams;
    const cursor = busca.get('cursor') || null;
    const todasAsFormas = busca.get('todas') === '1';
    const termos = (busca.get('busca') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const diaDeHoje = hoje();
    const dia = termos.length === 0 ? busca.get('dia') || diaDeHoje : null;
    if (dia && (!diaValido(dia) || dia > diaDeHoje)) {
      return erroJson(`Dia inválido: "${dia}". Use AAAA-MM-DD, até hoje.`, 400);
    }

    const cnpjsFranquiaPromessa = listarCnpjsFranquia();

    // Nº da NF e CNPJ viram nº do pedido pelo Supabase, como no atacado.
    const ehCnpj = (t) => somenteDigitos(t).length === 14;
    const nomes = await pedidosPorNfOuCnpj({
      numerosNf: termos.filter((t) => /^\d+$/.test(t) && !ehCnpj(t)),
      cnpjs: termos.filter(ehCnpj).map(somenteDigitos),
    });
    const termosShopify = termos.filter((t) => !ehCnpj(t));
    if (termos.length > 0 && termosShopify.length === 0 && nomes.length === 0) {
      return Response.json({ boletos: [], proximoCursor: null, dia: null, hoje: diaDeHoje });
    }

    let pedidos;
    let proximoCursor = null;
    let diaCompleto = true;
    if (dia) {
      ({ pedidos, completo: diaCompleto } = await listarPedidosDoDia({
        periodo: intervaloDoDia(dia),
        limitePorPagina: ITENS_POR_PAGINA,
      }));
      if (!diaCompleto) console.error(`[boletos] Dia ${dia} passou do limite de páginas — lista cortada.`);
    } else {
      const pagina = await listarPedidosRecentes({ limite: ITENS_POR_PAGINA, cursor, termos: termosShopify, nomes });
      pedidos = pagina.pedidos;
      proximoCursor = pagina.pageInfo.hasNextPage ? pagina.pageInfo.endCursor : null;
    }

    const metodos = await metodosDePagamento(
      pedidos.map((p) => p.id),
      Object.fromEntries(pedidos.map((p) => [p.id, p._bruto.customAttributes]))
    );
    const ehBoleto = (p) => formaDePagamentoTiny(metodos[p.id]) === FORMA_BOLETO;
    const comBoleto = todasAsFormas ? pedidos : pedidos.filter(ehBoleto);

    const ids = comBoleto.map((p) => p.id);
    const [situacoes, boletos, cnpjsFranquiaResp] = await Promise.all([
      statusPorPedido(ids),
      boletosPorPedido(ids),
      cnpjsFranquiaPromessa,
    ]);
    await completarNumerosNf(situacoes);
    if (!cnpjsFranquiaResp.ok) {
      console.error('[boletos] Falha ao buscar os CNPJs de franquia no Supabase:', cnpjsFranquiaResp.erro);
    }
    const cnpjsFranquia = cnpjsFranquiaResp.ok ? cnpjsFranquiaResp.cnpjs : [];

    // Títulos da CAIXA já gravados para a NF de cada pedido; o botão
    // "Consultar boletos" da tela procura os que faltam.
    const numeroNf = (id) => boletos[id]?.numero_nf ?? situacoes[id]?.numero_nf ?? null;
    // Falha aqui não derruba a lista (o hub-rowa também lê esta rota): a tela
    // só fica sem os títulos e avisa.
    let titulosCaixa = {};
    let erroCaixa = null;
    try {
      titulosCaixa = await titulosCaixaPorNf(ids.map(numeroNf).filter(Boolean));
    } catch (erro) {
      console.error('[boletos]', erro.message);
      erroCaixa = erro.message;
    }

    const lista = comBoleto.map((p) => {
      const situacao = situacoes[p.id];
      const boleto = boletos[p.id];
      return {
        id: idNumerico(p.id),
        gid: p.id,
        name: p.name,
        createdAt: p.createdAt,
        cliente: p.cliente,
        cnpj: extrairCnpj(p._bruto).cnpj,
        total: p.total,
        metodoPagamento: metodos[p.id],
        ehBoleto: ehBoleto(p),
        classificacao: classificarComListaFranquia(p._bruto, cnpjsFranquia),
        tinyNotaId: situacao?.status === 'rascunho_criado' ? situacao.tiny_nota_id : null,
        notaEmitida: situacao?.nota_emitida ?? false,
        // O nº digitado na tela (numeroNfEditado) vale sobre o da nota no Tiny.
        numeroNfTiny: situacao?.numero_nf ?? null,
        numeroNfEditado: boleto?.numero_nf ?? null,
        emitido: boleto?.emitido ?? false,
        pdfs: boleto?.pdfs ?? [],
        temPdf: (boleto?.pdfs.length ?? 0) > 0,
        // Parcelas da nota (franquia com boleto leva 3; atacado vai sem) e os
        // títulos da CAIXA achados para a NF — o status sai de statusTitulos.js.
        parcelasEsperadas: Array.isArray(situacao?.parcelas) ? situacao.parcelas.length || null : null,
        titulosCaixa: titulosCaixa[Number(numeroNf(p.id))] ?? [],
      };
    });

    // O cedente vai para a tela porque quem baixa o boleto da CAIXA é o
    // navegador (extensão), não o servidor — ver features/boletos/extensaoCaixa.js.
    const caixaCedente = process.env.CAIXA_CEDENTE ?? null;
    return Response.json({ boletos: lista, proximoCursor, dia, diaCompleto, hoje: diaDeHoje, erroCaixa, caixaCedente });
  } catch (erro) {
    return erroJson(`Não foi possível listar os boletos: ${erro.message}`);
  }
}
