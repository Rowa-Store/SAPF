// POST /api/olist/trazer — "trazer do Shopify" de UM produto (uma cor):
// grava na Olist os SKUs marcados dele. ESCREVE NA CONTA DE PRODUÇÃO.
//
// Corpo: { produtoId, skus }. Um produto por requisição: a tela monta a fila
// e manda um de cada vez, por causa do limite de chamadas por minuto do
// Tiny. Quando o Tiny recusa por limite, responde 429 e a tela espera e
// tenta o mesmo produto de novo (o SKU já gravado volta como igual).
//
// A comparação é refeita aqui (Shopify e Tiny lidos de novo). Na Olist cada
// SKU é um produto simples, sem pai (ver produtoTiny.js):
//   - existe: produto.alterar — nome, preço, NCM e peso (e reativa);
//   - não existe: produto.incluir.
// Um SKU por chamada: o erro do Tiny fica ligado ao SKU certo.

import { alterarProduto, erroDeLimite, incluirProduto } from '@/lib/integrations/tiny';
import { compararProdutoPorId } from '@/lib/olist/comparacao';
import { normalizarCodigo, simplesParaAlterar, simplesParaIncluir } from '@/lib/olist/produtoTiny';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Situações de SKU que a gravação aceita; as outras voltam como erro.
const GRAVAVEIS = ['diferente', 'nova', 'igual'];

const MOTIVO = {
  sem_sku: 'Variante sem SKU no Shopify.',
  bloqueado: 'Há mais de um produto com este código na Olist — corrija lá antes.',
  em_pai: 'O SKU é variação de um produto pai na Olist — exclua a variação lá antes.',
};

function respostaDeErro(e) {
  return erroDeLimite(e.message)
    ? erroJson('Limite de chamadas por minuto da Olist atingido.', 429, { limite: true })
    : erroJson(e.message, 502);
}

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  if (!corpo?.produtoId) return erroJson('Informe o produtoId (produto do Shopify).', 400);
  const skus = Array.isArray(corpo.skus) ? corpo.skus.filter(Boolean) : [];
  if (!skus.length) return erroJson('Nenhum SKU para trazer.', 400);
  const pedidos = new Set(skus.map(normalizarCodigo));

  let produto;
  let cadastros;
  try {
    ({ produto, cadastros } = await compararProdutoPorId(corpo.produtoId));
  } catch (e) {
    return respostaDeErro(e);
  }

  const marcadas = produto.linhas.filter((l) => pedidos.has(normalizarCodigo(l.sku)));
  const linhas = marcadas.filter((l) => GRAVAVEIS.includes(l.situacao));
  const resultados = marcadas
    .filter((l) => !GRAVAVEIS.includes(l.situacao))
    .map((l) => ({ sku: l.sku, ok: false, erro: MOTIVO[l.situacao] ?? 'Não dá para gravar este SKU.' }));
  if (!linhas.length) return Response.json({ resultados });

  for (const l of linhas) {
    if (l.situacao === 'igual') {
      resultados.push({ sku: l.sku, ok: true, acao: 'igual' });
      continue;
    }
    try {
      if (l.olist) {
        await alterarProduto(l.olist.id, simplesParaAlterar(l, cadastros[normalizarCodigo(l.sku)].simples));
        resultados.push({ sku: l.sku, ok: true, acao: 'atualizado' });
      } else {
        await incluirProduto(simplesParaIncluir(l));
        resultados.push({ sku: l.sku, ok: true, acao: 'incluido' });
      }
    } catch (e) {
      // Limite: o que já foi gravado fica; a tela tenta o produto de novo
      // e os SKUs gravados voltam como iguais.
      if (erroDeLimite(e.message)) return respostaDeErro(e);
      resultados.push({ sku: l.sku, ok: false, erro: e.message });
    }
  }

  return Response.json({ resultados });
}
