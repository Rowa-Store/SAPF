// POST /api/olist/trazer — "trazer do Shopify": para cada SKU pedido,
// atualiza o produto na Olist com os dados do Shopify ou, se ele não existe
// lá, inclui. ESCREVE NA CONTA DE PRODUÇÃO — exige `confirmacao: true`.
//
// Corpo: { busca, familia, skus, confirmacao }. A comparação é refeita aqui
// (Shopify e Tiny lidos de novo) e só os SKUs pedidos são enviados.

import { alterarProduto, incluirProduto } from '@/lib/integrations/tiny';
import { compararBusca } from '@/lib/olist/comparacao';
import { normalizarCodigo, produtoParaAlterar, produtoParaIncluir } from '@/lib/olist/produtoTiny';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  if (!corpo) return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);
  if (corpo.confirmacao !== true) {
    return erroJson('Confirme na tela que os produtos vão ser gravados na Olist de produção.', 400);
  }
  const skus = Array.isArray(corpo.skus) ? corpo.skus.filter(Boolean) : [];
  if (!skus.length) return erroJson('Nenhum SKU para trazer.', 400);

  let comparacao;
  try {
    comparacao = await compararBusca({ busca: String(corpo.busca ?? ''), familia: !!corpo.familia, skus });
  } catch (e) {
    return erroJson(e.message, 502);
  }

  const resultados = [];
  // Um SKU por vez: a API do Tiny limita chamadas por minuto, e o erro de um
  // não pode impedir os outros.
  for (const produto of comparacao.produtos) {
    for (const linha of produto.linhas) {
      try {
        if (linha.situacao === 'nao_encontrado') {
          const { id } = await incluirProduto(produtoParaIncluir(linha));
          resultados.push({ sku: linha.sku, ok: true, acao: 'incluido', tinyId: id });
        } else if (linha.situacao === 'diferente') {
          const cadastro = comparacao.doTiny[normalizarCodigo(linha.sku)].produto;
          await alterarProduto(linha.tiny.id, produtoParaAlterar(linha, cadastro));
          resultados.push({ sku: linha.sku, ok: true, acao: 'atualizado', tinyId: linha.tiny.id });
        } else if (linha.situacao === 'igual') {
          resultados.push({ sku: linha.sku, ok: true, acao: 'igual', tinyId: linha.tiny.id });
        } else {
          resultados.push({
            sku: linha.sku,
            ok: false,
            erro:
              linha.situacao === 'duplicado'
                ? `O código está em ${linha.duplicados} produtos na Olist — corrija lá antes.`
                : 'Variante sem SKU no Shopify.',
          });
        }
      } catch (e) {
        resultados.push({ sku: linha.sku, ok: false, erro: e.message });
      }
    }
  }

  return Response.json({ resultados });
}
