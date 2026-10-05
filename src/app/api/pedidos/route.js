// GET /api/pedidos — os pedidos da tela de atacado, já classificados e com a
// situação fiscal de cada um (rascunho, emissão, nº da NF).
//
// Sem busca, a lista é POR DIA: todos os pedidos de um dia (fuso de São
// Paulo, ver lib/datas.js), e a tela navega para trás dia a dia. Com busca,
// o resultado não se prende a dia nenhum e vem paginado por cursor.
//
//   ?dia=     AAAA-MM-DD; sem ele, hoje
//   ?busca=   termos separados por vírgula: nº do pedido, cliente, nº da NF ou CNPJ
//   ?cursor=  só com busca: página seguinte (o `endCursor` da resposta anterior)

import { listarPedidosDoDia, listarPedidosRecentes } from '@/lib/integrations/shopify';
import { diaValido, hoje, intervaloDoDia } from '@/lib/datas';
import { classificarComListaFranquia, extrairCnpj } from '@/lib/fiscal/classificacao';
import { totalDaNota } from '@/lib/fiscal/montarNota';
import { statusPorPedido, listarCnpjsFranquia, listarRascunhosPendentes, pedidosPorNfOuCnpj } from '@/lib/db';
import { ITENS_POR_PAGINA } from '@/lib/constants';
import { idNumerico, erroJson, somenteDigitos } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Rascunhos ainda não emitidos de pedidos que não vieram na primeira página.
 * Sem isso, a nota de um pedido mais antigo ficaria sem botão de emitir em
 * lugar nenhum — então entram na lista com os dados do payload que foi
 * enviado ao Tiny.
 */
function rascunhosForaDaPagina(rascunhos, idsNaPagina) {
  return rascunhos
    .filter((r) => !idsNaPagina.has(r.shopify_order_id))
    .map((r) => ({
      id: idNumerico(r.shopify_order_id),
      gid: r.shopify_order_id,
      name: r.shopify_order_name,
      createdAt: r.criado_em,
      cliente: r.cliente_nome || '—',
      total: r.itens ? totalDaNota({ nota_fiscal: { itens: r.itens } }) : null,
      tags: [],
      classificacao: r.classificacao,
      cnpj: r.cliente_cnpj || null,
      origemCnpj: null,
      status: 'rascunho_criado',
      tinyNotaId: r.tiny_nota_id,
      notaEmitida: false,
      numeroNf: r.numero_nf ?? null,
      tinyNotasSubstituidas: r.tiny_notas_substituidas ?? [],
      foraDaLista: true,
    }));
}

export async function GET(request) {
  try {
    const busca = new URL(request.url).searchParams;
    const cursor = busca.get('cursor') || null;
    const termos = (busca.get('busca') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const diaDeHoje = hoje();
    const dia = termos.length === 0 ? busca.get('dia') || diaDeHoje : null;
    if (dia && (!diaValido(dia) || dia > diaDeHoje)) {
      return erroJson(`Dia inválido: "${dia}". Use AAAA-MM-DD, até hoje.`, 400);
    }

    // Rascunhos pendentes de outros dias só aparecem no dia de hoje e sem
    // busca — numa busca, a pessoa quer ver só o que casou.
    const primeiraPagina = dia === diaDeHoje;

    // Franquias e rascunhos pendentes não dependem do Shopify: saem já, em
    // paralelo com a busca, em vez de esperar os pedidos voltarem.
    const cnpjsFranquiaPromessa = listarCnpjsFranquia();
    const pendentesPromessa = primeiraPagina ? listarRascunhosPendentes({ limite: 50 }) : null;

    // Nº da NF e CNPJ não são pesquisáveis no Shopify: o Supabase os traduz
    // para o nº do pedido antes. CNPJ sai dos termos de texto (o Shopify não
    // acharia) e o resto segue como está.
    const ehCnpj = (t) => somenteDigitos(t).length === 14;
    const nomes = await pedidosPorNfOuCnpj({
      numerosNf: termos.filter((t) => /^\d+$/.test(t) && !ehCnpj(t)),
      cnpjs: termos.filter(ehCnpj).map(somenteDigitos),
    });
    const termosShopify = termos.filter((t) => !ehCnpj(t));
    if (termos.length > 0 && termosShopify.length === 0 && nomes.length === 0) {
      return Response.json({ pedidos: [], proximoCursor: null, dia: null, hoje: diaDeHoje });
    }

    let pedidos;
    let proximoCursor = null;
    let diaCompleto = true;
    if (dia) {
      ({ pedidos, completo: diaCompleto } = await listarPedidosDoDia({
        periodo: intervaloDoDia(dia),
        limitePorPagina: ITENS_POR_PAGINA,
      }));
      if (!diaCompleto) console.error(`[pedidos] Dia ${dia} passou do limite de páginas — lista cortada.`);
    } else {
      const pagina = await listarPedidosRecentes({
        limite: ITENS_POR_PAGINA,
        cursor,
        termos: termosShopify,
        nomes,
      });
      pedidos = pagina.pedidos;
      proximoCursor = pagina.pageInfo.hasNextPage ? pagina.pageInfo.endCursor : null;
    }
    const [situacoes, cnpjsFranquiaResp, pendentesResp] = await Promise.all([
      statusPorPedido(pedidos.map((p) => p.id)),
      cnpjsFranquiaPromessa,
      pendentesPromessa,
    ]);
    if (!cnpjsFranquiaResp.ok) {
      console.error('[pedidos] Falha ao buscar cnpjs_franquia no Supabase, classificando sem a lista de franquia:', cnpjsFranquiaResp.erro);
    }
    const cnpjsFranquia = cnpjsFranquiaResp.ok ? cnpjsFranquiaResp.cnpjs : [];
    if (pendentesResp && !pendentesResp.ok) {
      console.error('[pedidos] Falha ao listar rascunhos pendentes no Supabase:', pendentesResp.erro);
    }
    const antigos = pendentesResp?.ok
      ? rascunhosForaDaPagina(pendentesResp.rascunhos, new Set(pedidos.map((p) => p.id)))
      : [];

    const lista = pedidos.map((p) => {
      const { cnpj, origem } = extrairCnpj(p._bruto);
      const situacao = situacoes[p.id];
      return {
        id: idNumerico(p.id),
        gid: p.id,
        name: p.name,
        createdAt: p.createdAt,
        cliente: p.cliente,
        total: p.total,
        tags: p.tags,
        classificacao: classificarComListaFranquia(p._bruto, cnpjsFranquia),
        cnpj: cnpj,
        origemCnpj: origem,
        status: situacao?.status ?? null,
        tinyNotaId: situacao?.tiny_nota_id ?? null,
        notaEmitida: situacao?.nota_emitida ?? false,
        numeroNf: situacao?.numero_nf ?? null,
        tinyNotasSubstituidas: situacao?.tiny_notas_substituidas ?? [],
        foraDaLista: false,
      };
    });

    return Response.json({
      pedidos: [...lista, ...antigos],
      proximoCursor,
      // null numa busca. `diaCompleto: false` = o dia tinha pedidos demais e
      // a lista veio cortada.
      dia,
      diaCompleto,
      hoje: diaDeHoje,
    });
  } catch (erro) {
    return erroJson(`Não foi possível listar os pedidos: ${erro.message}`);
  }
}
