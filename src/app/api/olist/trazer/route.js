// POST /api/olist/trazer — "trazer do Shopify": grava na Olist os SKUs
// marcados. ESCREVE NA CONTA DE PRODUÇÃO.
//
// Corpo: { busca, familia, skus }. A comparação é refeita aqui
// (Shopify e Tiny lidos de novo). Na Olist cada cor é um pai sem código com
// os tamanhos como variações, então a gravação é por produto:
//   - pai existe: produto.alterar no pai — nome, NCM e peso do pai, e o
//     preço das variações marcadas; SKU marcado que falta vira variação nova;
//   - pai não existe: produto.incluir do pai com as variações marcadas.

import { alterarProduto, incluirProduto, variacoesDoPai } from '@/lib/integrations/tiny';
import { compararBusca } from '@/lib/olist/comparacao';
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

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  if (!corpo) return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);
  const skus = Array.isArray(corpo.skus) ? corpo.skus.filter(Boolean) : [];
  if (!skus.length) return erroJson('Nenhum SKU para trazer.', 400);
  const pedidos = new Set(skus.map(normalizarCodigo));

  let comparacao;
  try {
    comparacao = await compararBusca({ busca: String(corpo.busca ?? ''), familia: !!corpo.familia, skus });
  } catch (e) {
    return erroJson(e.message, 502);
  }

  const resultados = [];
  // Um produto por vez: a API do Tiny limita chamadas por minuto, e o erro
  // de um não pode impedir os outros.
  for (const produto of comparacao.produtos) {
    const marcadas = produto.linhas.filter((l) => pedidos.has(normalizarCodigo(l.sku)));
    const linhas = marcadas.filter((l) => GRAVAVEIS.includes(l.situacao));
    for (const l of marcadas.filter((x) => !GRAVAVEIS.includes(x.situacao))) {
      resultados.push({ sku: l.sku, ok: false, erro: MOTIVO[l.situacao] ?? 'Não dá para gravar este SKU.' });
    }
    if (!linhas.length) continue;

    try {
      const cadastro = comparacao.cadastros[produto.id];
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
      for (const l of linhas) resultados.push({ sku: l.sku, ok: false, erro: e.message });
    }
  }

  return Response.json({ resultados });
}
