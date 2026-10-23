// cadastroParaAlterar.js — payload do produto.alterar do Tiny montado a partir
// do cadastro atual (produto.obter), com só alguns campos trocados. Usado
// pelas correções gerais da Olist (limparGtin.js, corrigirNcm.js).
//
// O produto.alterar exige repetir o que já está no cadastro (código, nome,
// unidade, preço, origem, situação, tipo, NCM, peso), como paiParaAlterar em
// produtoTiny.js. Pelo pai, vai com todas as variações (com o id, senão viram
// variações novas).

export const temValor = (v) => String(v ?? '').trim() !== '';

export function variacoesCruas(cadastro) {
  const v = cadastro?.variacoes;
  const lista = Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [];
  return lista.map((item) => item.variacao ?? item);
}

/**
 * O cadastro como payload do produto.alterar, com `campos` trocados no
 * produto e `camposDaVariacao` em cada variação.
 */
export function cadastroParaAlterar(cadastro, campos, camposDaVariacao = {}) {
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
    ...campos,
    ...(variacoes.length
      ? {
          variacoes: variacoes.map((v) => ({
            variacao: { id: String(v.id), codigo: v.codigo, preco: v.preco, grade: v.grade, ...camposDaVariacao },
          })),
        }
      : {}),
  };
}

/** Payload para alterar uma variação pelo id dela mesma: sem variações nem classe. */
export function variacaoParaAlterar(variacao, campos) {
  const { variacoes: _v, classe_produto: _c, ...proprio } = cadastroParaAlterar({ ...variacao, variacoes: [] }, campos);
  return proprio;
}
