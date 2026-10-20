// /api/olist/gtin — limpeza geral de GTIN da Olist (tela /olist/gtin).
//
// GET ?pagina=1 — uma página da lista de produtos da Olist (100 por página),
// só os que têm GTIN. Só lê.
//
// POST { id } — limpa o GTIN de UM produto (se for variação, do pai dela, com
// todas as variações). ESCREVE NA CONTA DE PRODUÇÃO. Um produto por
// requisição: a tela monta a fila por causa do limite de chamadas do Tiny, e
// recebe 429 quando o Tiny recusa por limite (nada foi gravado).

import { erroDeLimite, paginaDeProdutosDaConta } from '@/lib/integrations/tiny';
import { limparGtinDoProduto } from '@/lib/olist/limparGtin';
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
    return Response.json({
      paginas,
      lidos: itens.length,
      comGtin: itens
        .filter((p) => String(p.gtin ?? '').trim())
        .map((p) => ({
          id: String(p.id),
          nome: p.nome ?? '',
          codigo: p.codigo ?? '',
          gtin: String(p.gtin).trim(),
          tipoVariacao: p.tipoVariacao ?? '',
        })),
    });
  } catch (e) {
    return respostaDeErro(e);
  }
}

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  if (!corpo?.id) return erroJson('Informe o id do produto na Olist.', 400);
  try {
    return Response.json(await limparGtinDoProduto(String(corpo.id)));
  } catch (e) {
    return respostaDeErro(e);
  }
}
