// limparGtin.js — a limpeza geral de GTIN da Olist (tela /olist/gtin):
// deixa vazios o GTIN e o GTIN da embalagem do produto e de todas as
// variações dele. ESCREVE NA CONTA DE PRODUÇÃO.
//
// O produto.obter do pai NÃO devolve o GTIN das variações (conferido: pai
// "já limpo" com as variações ainda com GTIN). Cada variação é lida e
// conferida pelo próprio id. Pelo pai, o produto.alterar vai com todas as
// variações (com o id, senão viram variações novas). O payload repete do cadastro atual
// o que o produto.alterar exige (código, nome, unidade, preço, origem,
// situação, tipo, NCM, peso), como paiParaAlterar em produtoTiny.js.

import { alterarProduto, erroDeLimite, obterProduto } from '../integrations/tiny.js';

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

/** GTIN da variação no cadastro dela mesma — o do pai não traz o das variações. */
function gtinsDaVariacao(cadastro) {
  return temValor(cadastro?.gtin) || temValor(cadastro?.gtin_embalagem) ? [cadastro.codigo || `variação ${cadastro.id}`] : [];
}

/**
 * Variação: o produto.obter do PAI não devolve o GTIN das variações, então a
 * conferência é pelo cadastro da própria variação. Tenta primeiro alterar a
 * variação pelo id dela; se o GTIN continuar, altera pelo pai (com todas as
 * variações). `via` diz o que resolveu.
 */
async function limparGtinDaVariacao(variacao) {
  const id = String(variacao.id);
  const nome = variacao.nome ?? '';
  const base = { alvo: id, ids: [id], nome };
  if (!gtinsDaVariacao(variacao).length) return { ...base, acao: 'ja_limpo', restantes: [], conferido: true };

  const tentativas = [
    ['variação', async () => {
      const { variacoes: _v, classe_produto: _c, ...proprio } = semGtin({ ...variacao, variacoes: [] });
      await alterarProduto(id, proprio);
    }],
    ['pai', async () => {
      const pai = await obterProduto(variacao.idProdutoPai);
      if (!pai) throw new Error(`Pai da variação ${id} não encontrado na Olist.`);
      await alterarProduto(String(pai.id), semGtin(pai));
    }],
  ];

  const erros = [];
  let restantes = gtinsDaVariacao(variacao);
  for (const [via, alterar] of tentativas) {
    try {
      await alterar();
    } catch (e) {
      // Limite: sobe para a tela esperar e repetir — repetir é seguro.
      if (erroDeLimite(e.message)) throw e;
      erros.push(`pela ${via}: ${e.message}`);
      continue;
    }
    let depois;
    try {
      depois = await obterProduto(id);
    } catch {
      return { ...base, acao: 'limpo', via, restantes: [], conferido: false };
    }
    restantes = gtinsDaVariacao(depois);
    if (!restantes.length) return { ...base, acao: 'limpo', via, restantes, conferido: true };
  }
  if (erros.length === tentativas.length) throw new Error(`Olist recusou a limpeza — ${erros.join(' | ')}`);
  return { ...base, acao: 'limpo', restantes, conferido: true, erros };
}

/**
 * Limpa o GTIN do produto `id`. Produto simples ou pai: pelo próprio
 * cadastro (o pai leva as variações junto). Variação: ver
 * limparGtinDaVariacao. Relê depois de gravar para conferir.
 *
 * @returns {Promise<{ alvo: string, ids: string[], nome: string,
 *   acao: 'limpo'|'ja_limpo', restantes: string[], conferido: boolean, via?: string }>}
 *   alvo: o id que foi alterado; ids: os que a tela pode tirar da fila.
 *   restantes: o que continuou com GTIN depois.
 */
export async function limparGtinDoProduto(id) {
  const cadastro = await obterProduto(id);
  if (!cadastro) throw new Error(`Produto ${id} não encontrado na Olist.`);
  if (temValor(cadastro.idProdutoPai) && String(cadastro.idProdutoPai) !== '0') return limparGtinDaVariacao(cadastro);

  const alvo = String(cadastro.id);
  const nome = cadastro.nome ?? '';
  // Só o pai sai da fila: o GTIN das variações é conferido uma a uma.
  const ids = [alvo];
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
