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
//   - pai não existe: produto.incluir do pai com as variações marcadas;
//   - pai inativo com o mesmo nome conta como existente (o Tiny não deixa
//     incluir outro com o mesmo nome): é atualizado e reativado.

import { alterarProduto, erroDeLimite, incluirProduto, resumoDaGrade, variacoesDoPai } from '@/lib/integrations/tiny';
import { compararProdutoPorId } from '@/lib/olist/comparacao';
import { comCorNaGrade, normalizarCodigo, paiParaAlterar, paiParaIncluir } from '@/lib/olist/produtoTiny';
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

/**
 * produto.alterar do pai. Pai SEM variações que recusa a grade só com o
 * Tamanho (o Tiny guarda os níveis das variações que ele já teve) é
 * tentado de novo com a Cor do título na grade.
 */
async function alterarPai(produto, cadastro, linhas) {
  const atuais = variacoesDoPai(cadastro);
  const payload = paiParaAlterar(produto, cadastro, atuais, linhas);
  try {
    await alterarProduto(cadastro.id, payload);
  } catch (e) {
    const comCor = !atuais.length && /grade/i.test(e.message) && comCorNaGrade(payload, produto.esperado.nome);
    if (!comCor) throw e;
    await alterarProduto(cadastro.id, comCor);
  }
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
      await alterarPai(produto, cadastro, linhas);
      acao = 'atualizado';
    } else {
      await incluirProduto(paiParaIncluir(produto, linhas));
      acao = 'incluido';
    }
    for (const l of linhas) resultados.push({ sku: l.sku, ok: true, acao: l.situacao === 'nova' ? 'incluido' : acao });
  } catch (e) {
    if (erroDeLimite(e.message)) return respostaDeErro(e);
    // Grade recusada: junta como o pai está no Tiny, para dar para corrigir.
    const erro = cadastro && /grade/i.test(e.message) ? `${e.message} — ${resumoDaGrade(cadastro)}` : e.message;
    for (const l of linhas) resultados.push({ sku: l.sku, ok: false, erro });
  }

  return Response.json({ resultados });
}
