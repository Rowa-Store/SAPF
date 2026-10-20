// limparGtin.js — a limpeza geral de GTIN da Olist (tela /olist/gtin):
// deixa vazios o GTIN e o GTIN da embalagem do produto e de todas as
// variações dele. ESCREVE NA CONTA DE PRODUÇÃO.
//
// No Tiny o GTIN da variação só muda pelo produto.alterar do PAI, com todas
// as variações (com o id, senão viram variações novas) — por isso uma
// variação leva à limpeza do pai inteiro. O payload repete do cadastro atual
// o que o produto.alterar exige (código, nome, unidade, preço, origem,
// situação, tipo, NCM, peso), como paiParaAlterar em produtoTiny.js.

import { alterarProduto, obterProduto } from '../integrations/tiny.js';

const temValor = (v) => String(v ?? '').trim() !== '';

function variacoesCruas(cadastro) {
  const v = cadastro?.variacoes;
  const lista = Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [];
  return lista.map((item) => item.variacao ?? item);
}

/** Campos de GTIN que ainda têm valor no cadastro (pai e variações). */
export function gtinsRestantes(cadastro) {
  const restantes = [];
  if (temValor(cadastro.gtin) || temValor(cadastro.gtin_embalagem)) restantes.push(cadastro.codigo || cadastro.nome);
  for (const v of variacoesCruas(cadastro)) {
    if (temValor(v.gtin) || temValor(v.gtin_embalagem)) restantes.push(v.codigo || `variação ${v.id}`);
  }
  return restantes;
}

function semGtin(cadastro) {
  const variacoes = variacoesCruas(cadastro);
  return {
    codigo: cadastro.codigo ?? '',
    nome: cadastro.nome,
    unidade: cadastro.unidade || 'UN',
    preco: cadastro.preco,
    origem: cadastro.origem ?? '0',
    situacao: cadastro.situacao || 'A',
    tipo: cadastro.tipo || 'P',
    classe_produto: cadastro.classe_produto || (variacoes.length ? 'V' : 'S'),
    ...(cadastro.ncm ? { ncm: cadastro.ncm } : {}),
    ...(temValor(cadastro.peso_liquido) ? { peso_liquido: cadastro.peso_liquido } : {}),
    ...(temValor(cadastro.peso_bruto) ? { peso_bruto: cadastro.peso_bruto } : {}),
    gtin: '',
    gtin_embalagem: '',
    ...(variacoes.length
      ? {
          variacoes: variacoes.map((v) => ({
            variacao: { id: String(v.id), codigo: v.codigo, preco: v.preco, grade: v.grade, gtin: '', gtin_embalagem: '' },
          })),
        }
      : {}),
  };
}

/**
 * Limpa o GTIN do produto `id` — se for uma variação, do pai dela, com todas
 * as variações. Relê depois de gravar para conferir.
 *
 * @returns {Promise<{ alvo: string, ids: string[], nome: string,
 *   acao: 'limpo'|'ja_limpo', restantes: string[], conferido: boolean }>}
 *   alvo: o id que foi alterado (o pai, quando `id` é variação); ids: ele e
 *   as variações dele — a tela pula as outras da fila. restantes: o que
 *   continuou com GTIN depois.
 */
export async function limparGtinDoProduto(id) {
  let cadastro = await obterProduto(id);
  if (!cadastro) throw new Error(`Produto ${id} não encontrado na Olist.`);
  if (temValor(cadastro.idProdutoPai) && String(cadastro.idProdutoPai) !== '0') {
    cadastro = await obterProduto(cadastro.idProdutoPai);
    if (!cadastro) throw new Error(`Pai da variação ${id} não encontrado na Olist.`);
  }
  const alvo = String(cadastro.id);
  const nome = cadastro.nome ?? '';
  const ids = [alvo, ...variacoesCruas(cadastro).map((v) => String(v.id))];
  if (!gtinsRestantes(cadastro).length) return { alvo, ids, nome, acao: 'ja_limpo', restantes: [], conferido: true };

  await alterarProduto(alvo, semGtin(cadastro));

  // Gravou; a conferência é bônus — se o Tiny recusar por limite agora, não desfaz nada.
  try {
    const depois = await obterProduto(alvo);
    return { alvo, ids, nome, acao: 'limpo', restantes: depois ? gtinsRestantes(depois) : [], conferido: !!depois };
  } catch {
    return { alvo, ids, nome, acao: 'limpo', restantes: [], conferido: false };
  }
}
