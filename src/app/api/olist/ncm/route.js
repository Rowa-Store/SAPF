// /api/olist/ncm — correção geral de NCM da Olist (tela /olist/ncm).
//
// GET ?pagina=1 — uma página da lista de produtos da Olist (100 por página),
// separada entre os que têm regra de NCM (com o NCM certo) e os sem regra. A
// lista do Tiny não traz o NCM: o que está gravado só é lido na correção. Só lê.
//
// POST { id } — confere e corrige o NCM de UM produto. ESCREVE NA CONTA DE
// PRODUÇÃO. Um produto por requisição: a tela monta a fila por causa do
// limite de chamadas do Tiny, e recebe 429 quando o Tiny recusa por limite.

import { erroDeLimite, paginaDeProdutosDaConta } from '@/lib/integrations/tiny';
import { corrigirNcmDoProduto, ncmEsperado } from '@/lib/olist/corrigirNcm';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function respostaDeErro(e) {
  return erroDeLimite(e.message)
    ? erroJson('Limite de chamadas por minuto da Olist atingido.', 429, { limite: true })
    : erroJson(e.message, 502);
}

export async function GET(request) {
  const pagina = Math.max(1, Number(new URL(request.url).searchParams.get('pagina')) || 1);
  try {
    const { itens, paginas } = await paginaDeProdutosDaConta(pagina);
    const comRegra = [];
    const semRegra = [];
    for (const p of itens) {
      const item = { id: String(p.id), nome: p.nome ?? '', codigo: p.codigo ?? '', tipoVariacao: p.tipoVariacao ?? '' };
      const ncm = ncmEsperado(item.nome);
      if (ncm) comRegra.push({ ...item, ncm });
      else semRegra.push(item);
    }
    return Response.json({ paginas, lidos: itens.length, comRegra, semRegra });
  } catch (e) {
    return respostaDeErro(e);
  }
}

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  if (!corpo?.id) return erroJson('Informe o id do produto na Olist.', 400);
  try {
    return Response.json(await corrigirNcmDoProduto(String(corpo.id)));
  } catch (e) {
    return respostaDeErro(e);
  }
}
