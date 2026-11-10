// GET /api/varejo — os pedidos da loja online (varejo, tela /varejo), com a
// situação fiscal de cada um (rascunho, emissão, nº da NF). Mesmo formato e
// mesmos parâmetros de /api/pedidos:
//
//   ?dia=     AAAA-MM-DD; sem ele, hoje
//   ?busca=   termos separados por vírgula: nº do pedido, cliente, nº da NF ou CPF/CNPJ
//   ?cursor=  só com busca: página seguinte (o `endCursor` da resposta anterior)
//
// Rascunho, emissão, situação e DANFE usam as rotas de /api/pedidos/[id]: a
// situação fiscal fica na mesma tabela, por pedido do Shopify.

import { listarPedidosDoDia, listarPedidosRecentes } from '@/lib/integrations/shopify';
import { diaValido, hoje, intervaloDoDia } from '@/lib/datas';
import { extrairDocumento } from '@/lib/fiscal/classificacao';
import { pedidosPorNfOuCnpj, statusPorPedido } from '@/lib/db';
import { ITENS_POR_PAGINA } from '@/lib/constants';
import { idNumerico, erroJson, somenteDigitos } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

    // Nº da NF e CPF/CNPJ não são pesquisáveis no Shopify: o Supabase os
    // traduz para o nº do pedido antes (só acha pedido que já tem nota).
    const ehDocumento = (t) => [11, 14].includes(somenteDigitos(t).length);
    const nomes = await pedidosPorNfOuCnpj({
      numerosNf: termos.filter((t) => /^\d+$/.test(t) && !ehDocumento(t)),
      cnpjs: termos.filter(ehDocumento).map(somenteDigitos),
    });
    const termosShopify = termos.filter((t) => !ehDocumento(t));
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
        canal: 'varejo',
      }));
      if (!diaCompleto) console.error(`[varejo] Dia ${dia} passou do limite de páginas — lista cortada.`);
    } else {
      const pagina = await listarPedidosRecentes({
        canal: 'varejo',
        limite: ITENS_POR_PAGINA,
        cursor,
        termos: termosShopify,
        nomes,
      });
      pedidos = pagina.pedidos;
      proximoCursor = pagina.pageInfo.hasNextPage ? pagina.pageInfo.endCursor : null;
    }
    const situacoes = await statusPorPedido(pedidos.map((p) => p.id));

    const lista = pedidos.map((p) => {
      const situacao = situacoes[p.id];
      return {
        id: idNumerico(p.id),
        gid: p.id,
        name: p.name,
        createdAt: p.createdAt,
        cliente: p.cliente,
        total: p.total,
        tags: p.tags,
        classificacao: 'varejo',
        cnpj: extrairDocumento(p._bruto).documento,
        status: situacao?.status ?? null,
        tinyNotaId: situacao?.tiny_nota_id ?? null,
        notaEmitida: situacao?.nota_emitida ?? false,
        numeroNf: situacao?.numero_nf ?? null,
        tinyNotasSubstituidas: situacao?.tiny_notas_substituidas ?? [],
        erro: situacao?.erro ?? null,
        erroEm: situacao?.erro ? situacao.atualizado_em : null,
      };
    });

    return Response.json({ pedidos: lista, proximoCursor, dia, diaCompleto, hoje: diaDeHoje });
  } catch (erro) {
    return erroJson(`Não foi possível listar os pedidos do varejo: ${erro.message}`);
  }
}
