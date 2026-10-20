// POST /api/olist/trazer — "trazer do Shopify" de UM produto (uma cor):
// grava na Olist os SKUs marcados dele. ESCREVE NA CONTA DE PRODUÇÃO.
//
// Corpo: { produtoId, skus }. Um produto por requisição: a tela monta a fila
// e manda um de cada vez, por causa do limite de chamadas por minuto do
// Tiny. Quando o Tiny recusa por limite, responde 429 — nada foi gravado e
// a tela espera e tenta o mesmo produto de novo.
//
// A comparação é refeita aqui (Shopify e Tiny lidos de novo). Na Olist cada
// cor é um pai sem código com os tamanhos como variações:
//   - pai existe: produto.alterar no pai — nome, NCM e peso do pai, e o
//     preço das variações marcadas; SKU marcado que falta vira variação nova;
//   - pai não existe: produto.incluir do pai com as variações marcadas.

import { alterarProduto, erroDeLimite, incluirProduto, variacoesDoPai } from '@/lib/integrations/tiny';
import { compararProdutoPorId } from '@/lib/olist/comparacao';
import { normalizarCodigo, paiParaAlterar, paiParaIncluir } from '@/lib/olist/produtoTiny';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Situações de SKU que a gravação aceita; as outras voltam como erro.
const GRAVAVEIS = ['diferente', 'nova', 'igual'];

const MOTIVO = {
  sem_sku: 'Variante sem SKU no Shopify.',
  bloqueado: 'Há mais de um produto ativo com este nome na Olist — corrija lá antes.',
  fora_do_pai: 'O SKU já existe na Olist em outro produto — corrija lá antes.',
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
  let cadastro;
  try {
    ({ produto, cadastro } = await compararProdutoPorId(corpo.produtoId));
  } catch (e) {
    return respostaDeErro(e);
  }

  const marcadas = produto.linhas.filter((l) => pedidos.has(normalizarCodigo(l.sku)));
  const linhas = marcadas.filter((l) => GRAVAVEIS.includes(l.situacao));
  const resultados = marcadas
    .filter((l) => !GRAVAVEIS.includes(l.situacao))
    .map((l) => ({ sku: l.sku, ok: false, erro: MOTIVO[l.situacao] ?? 'Não dá para gravar este SKU.' }));
  if (!linhas.length) return Response.json({ resultados });

  try {
    let acao;
    if (cadastro) {
      await alterarProduto(cadastro.id, paiParaAlterar(produto, cadastro, variacoesDoPai(cadastro), linhas));
      acao = 'atualizado';
    } else {
      await incluirProduto(paiParaIncluir(produto, linhas));
      acao = 'incluido';
    }
    for (const l of linhas) resultados.push({ sku: l.sku, ok: true, acao: l.situacao === 'nova' ? 'incluido' : acao });
  } catch (e) {
    if (erroDeLimite(e.message)) return respostaDeErro(e);
    for (const l of linhas) resultados.push({ sku: l.sku, ok: false, erro: e.message });
  }

  return Response.json({ resultados });
}
