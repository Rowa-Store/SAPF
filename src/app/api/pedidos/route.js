// GET /api/pedidos — pedidos recentes, já classificados e com a situação
// fiscal de cada um (rascunho, emissão, nº da NF). É a fonte da tela de
// atacado.

import { listarPedidosRecentes } from '@/lib/integrations/shopify';
import { classificarComListaFranquia, extrairCnpj } from '@/lib/fiscal/classificacao';
import { totalDaNota } from '@/lib/fiscal/montarNota';
import { statusPorPedido, listarCnpjsFranquia, listarRascunhosCriados } from '@/lib/db';
import { idNumerico, erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Rascunhos ainda não emitidos de pedidos que já saíram da lista recente do
 * Shopify. Sem isso, a nota ficaria sem botão de emitir em lugar nenhum —
 * então entram na lista com os dados do payload que foi enviado ao Tiny.
 */
async function rascunhosForaDaLista(idsNaLista) {
  const { ok, erro, rascunhos } = await listarRascunhosCriados({ limite: 100 });
  if (!ok) {
    console.error('[pedidos] Falha ao listar rascunhos no Supabase:', erro);
    return [];
  }
  return rascunhos
    .filter((r) => !r.nota_emitida && !idsNaLista.has(r.shopify_order_id))
    .map((r) => {
      const cliente = r.payload_enviado?.nota_fiscal?.cliente;
      return {
        id: idNumerico(r.shopify_order_id),
        gid: r.shopify_order_id,
        name: r.shopify_order_name,
        createdAt: r.criado_em,
        cliente: cliente?.nome || '—',
        total: r.payload_enviado ? totalDaNota(r.payload_enviado) : null,
        tags: [],
        classificacao: r.classificacao,
        cnpj: cliente?.cpf_cnpj || null,
        origemCnpj: null,
        status: 'rascunho_criado',
        tinyNotaId: r.tiny_nota_id,
        notaEmitida: false,
        numeroNf: r.numero_nf ?? null,
        tinyNotasSubstituidas: r.tiny_notas_substituidas ?? [],
        foraDaLista: true,
      };
    });
}

export async function GET(request) {
  try {
    const limite = Number(new URL(request.url).searchParams.get('limite') ?? 200);
    const pedidos = await listarPedidosRecentes({ limite });

    // Uma consulta só ao Supabase para todos os pedidos da página — tanto para
    // a situação de cada um quanto para a lista de CNPJs de franquia usada na
    // classificação.
    const [situacoes, cnpjsFranquiaResp, antigos] = await Promise.all([
      statusPorPedido(pedidos.map((p) => p.id)),
      listarCnpjsFranquia(),
      rascunhosForaDaLista(new Set(pedidos.map((p) => p.id))),
    ]);
    if (!cnpjsFranquiaResp.ok) {
      console.error('[pedidos] Falha ao buscar cnpjs_franquia no Supabase, classificando sem a lista de franquia:', cnpjsFranquiaResp.erro);
    }
    const cnpjsFranquia = cnpjsFranquiaResp.ok ? cnpjsFranquiaResp.cnpjs : [];

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

    return Response.json({ pedidos: [...lista, ...antigos], modo: 'real' });
  } catch (erro) {
    return erroJson(`Não foi possível listar os pedidos: ${erro.message}`);
  }
}
