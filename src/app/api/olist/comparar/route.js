// GET /api/olist/comparar?busca=...&familia=1 — o produto do Shopify (pelo
// SKU de uma variação ou pelo nome), com todos os tamanhos, lado a lado com o
// cadastro de cada SKU na Olist. `familia=1` traz também as outras cores do
// mesmo modelo. `produtoId=...` compara um produto só (a tela usa para reler
// o produto depois de gravar). Só lê.
//
// POST /api/olist/comparar — { produtoId, catalogo }: um produto só, com os
// registros do catálogo da Olist que o diagnóstico já leu e que casam com
// ele (pelo nome ou pelos SKUs). Economiza as pesquisas no Tiny. Só lê.

import { erroDeLimite } from '@/lib/integrations/tiny';
import { compararBusca, compararProdutoPorId } from '@/lib/olist/comparacao';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function respostaDeErro(e) {
  if (erroDeLimite(e.message)) {
    return erroJson('Limite de chamadas por minuto da Olist atingido. Espere um minuto e busque de novo.', 429);
  }
  return erroJson(e.message, 502);
}

export async function GET(request) {
  const parametros = new URL(request.url).searchParams;
  const busca = (parametros.get('busca') ?? '').trim();
  const produtoId = parametros.get('produtoId');
  if (!busca && !produtoId) return erroJson('Informe um SKU ou nome de produto.', 400);

  try {
    if (produtoId) return Response.json({ produtos: [(await compararProdutoPorId(produtoId)).produto] });
    const { produtos } = await compararBusca({ busca, familia: parametros.get('familia') === '1' });
    return Response.json({ produtos });
  } catch (e) {
    return respostaDeErro(e);
  }
}

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  if (!corpo?.produtoId) return erroJson('Informe o produtoId (produto do Shopify).', 400);
  // Só os campos que a comparação usa, como o produtos.pesquisa devolve.
  const catalogo = Array.isArray(corpo.catalogo)
    ? corpo.catalogo.map((p) => ({
        id: String(p?.id ?? ''),
        nome: String(p?.nome ?? ''),
        codigo: String(p?.codigo ?? ''),
        tipoVariacao: String(p?.tipoVariacao ?? ''),
        situacao: String(p?.situacao ?? ''),
      }))
    : null;

  try {
    return Response.json({ produtos: [(await compararProdutoPorId(corpo.produtoId, { catalogo })).produto] });
  } catch (e) {
    return respostaDeErro(e);
  }
}
