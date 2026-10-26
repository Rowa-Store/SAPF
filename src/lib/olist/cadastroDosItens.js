// cadastroDosItens.js — confere, antes de todo rascunho de nota (atacado,
// franquia e transferência), o cadastro na Olist do produto de cada item:
// GTIN vazio e NCM da regra (fiscal/ncm.js). A nota pega GTIN e NCM do
// cadastro, então o que estiver errado é corrigido ANTES da inclusão.
// ESCREVE NA CONTA DE PRODUÇÃO — a conta da nota (`conta`).
//
// Nunca bloqueia a nota: o que não deu para corrigir volta como "erro gtin" /
// "erro ncm" para a linha do item na tela, e a inclusão segue. Item a item,
// faz o papel da limpeza geral de GTIN (/olist/gtin).
//
// Duas chamadas por código (pesquisa + cadastro), mais a gravação e a
// releitura quando há o que corrigir. No limite de chamadas por minuto do
// Tiny, espera e repete enquanto houver tempo (ORCAMENTO_MS); acabado o
// tempo, os códigos que faltam ficam "não conferidos" e a nota segue.
// Código de produto pai fica de fora: o Tiny recusa a nota e a troca pela
// variação (incluirNotaTrocandoProdutosPai) cuida dele.

import { alterarProduto, erroDeLimite, obterProduto, produtosPorCodigo } from '../integrations/tiny.js';
import { cadastroParaAlterar, temValor, variacaoParaAlterar } from './cadastroParaAlterar.js';
import { ncmEsperado } from './corrigirNcm.js';

export const ERRO_GTIN = 'erro gtin';
export const ERRO_NCM = 'erro ncm';

// Tempo máximo gasto conferindo, para a inclusão ainda caber na função.
const ORCAMENTO_MS = 120_000;
const ESPERA_LIMITE_MS = 60_000;

const SEM_GTIN = { gtin: '', gtin_embalagem: '' };

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const digitos = (ncm) => String(ncm ?? '').replace(/\D+/g, '');
const ncmDe = (cadastro) => String(cadastro?.ncm ?? '').trim();
const temGtin = (cadastro) => temValor(cadastro?.gtin) || temValor(cadastro?.gtin_embalagem);
const ehVariacao = (cadastro) => temValor(cadastro.idProdutoPai) && String(cadastro.idProdutoPai) !== '0';

/**
 * O que o cadastro precisa mudar. O NCM vem da regra pelo nome na Olist; sem
 * regra, pela descrição do item. NCM preenchido sem regra que o reconheça
 * fica como está.
 */
function correcoes(cadastro, descricao) {
  const para = ncmEsperado(cadastro.nome ?? '') ?? ncmEsperado(descricao);
  const campos = temGtin(cadastro) ? { ...SEM_GTIN } : {};
  if (para && digitos(ncmDe(cadastro)) !== digitos(para)) campos.ncm = para;
  return { campos, ncmSemRegra: !ncmDe(cadastro) && !para };
}

/**
 * Confere e corrige um produto (simples ou variação). Variação: tenta pelo
 * id dela; se continuar errado, pelo pai — como em limparGtin.js. Relê
 * depois de gravar para conferir.
 */
async function conferirProduto(id, descricao, conta) {
  const cadastro = await obterProduto(id, conta);
  if (!cadastro) throw new Error(`produto ${id} não encontrado na Olist`);

  const resultado = { corrigidos: [], erros: [], motivos: [] };
  const { campos, ncmSemRegra } = correcoes(cadastro, descricao);
  if (ncmSemRegra) {
    resultado.erros.push(ERRO_NCM);
    resultado.motivos.push('sem NCM no cadastro e nenhuma regra reconhece o nome');
  }
  if (!Object.keys(campos).length) return resultado;

  const alvo = String(cadastro.id);
  const gtinDaVariacao = 'gtin' in campos ? SEM_GTIN : {};
  const tentativas = ehVariacao(cadastro)
    ? [
        ['variação', () => alterarProduto(alvo, variacaoParaAlterar(cadastro, campos), conta)],
        ['pai', async () => {
          const pai = await obterProduto(cadastro.idProdutoPai, conta);
          if (!pai) throw new Error(`pai da variação ${alvo} não encontrado na Olist`);
          await alterarProduto(String(pai.id), cadastroParaAlterar(pai, campos, gtinDaVariacao), conta);
        }],
      ]
    : [['produto', () => alterarProduto(alvo, cadastroParaAlterar(cadastro, campos), conta)]];

  const falhas = [];
  let restante = campos;
  for (const [via, alterar] of tentativas) {
    try {
      await alterar();
    } catch (e) {
      if (erroDeLimite(e.message)) throw e;
      falhas.push(`pelo(a) ${via}: ${e.message}`);
      continue;
    }
    // Gravou; a releitura é bônus — se falhar, conta como corrigido.
    try {
      const depois = await obterProduto(alvo, conta);
      restante = depois ? correcoes(depois, descricao).campos : {};
    } catch {
      restante = {};
    }
    if (!Object.keys(restante).length) break;
  }

  for (const [campo, erro] of [['gtin', ERRO_GTIN], ['ncm', ERRO_NCM]]) {
    if (!(campo in campos)) continue;
    if (campo in restante) resultado.erros.push(erro);
    else resultado.corrigidos.push(campo);
  }
  if (resultado.erros.length > Number(ncmSemRegra)) {
    resultado.motivos.push(falhas.length ? `Olist recusou — ${falhas.join(' | ')}` : 'a Olist não gravou a correção');
  }
  return resultado;
}

/** Todos os produtos com o código (o mesmo SKU pode estar em mais de um cadastro). */
async function conferirCodigo(codigo, descricao, conta) {
  const produtos = await produtosPorCodigo(codigo, conta);
  const resultado = { corrigidos: [], erros: [], motivos: [] };
  if (!produtos.length) {
    return { ...resultado, erros: [ERRO_NCM], motivos: ['código não cadastrado na Olist'] };
  }
  for (const produto of produtos.filter((p) => p.tipoVariacao !== 'P')) {
    const doProduto = await conferirProduto(produto.id, descricao, conta);
    for (const chave of Object.keys(resultado)) {
      resultado[chave] = [...new Set([...resultado[chave], ...doProduto[chave]])];
    }
  }
  return resultado;
}

/** Repete `fn` depois de esperar o limite do Tiny, enquanto couber no orçamento. */
async function comEspera(fn, inicio) {
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!erroDeLimite(e.message) || Date.now() - inicio + ESPERA_LIMITE_MS > ORCAMENTO_MS) throw e;
      await esperar(ESPERA_LIMITE_MS);
    }
  }
}

/**
 * Confere e corrige o cadastro dos produtos dos itens da nota. Nunca lança.
 *
 * @param {object[]} itens `nota_fiscal.itens` do payload ({ item: {...} })
 * @returns {Promise<{ itens: { codigo: string, corrigidos: string[], erros: string[], motivos: string[] }[],
 *   naoConferidos: { codigo: string, motivo: string }[] }>}
 *   corrigidos: 'gtin' | 'ncm'; erros: ERRO_GTIN | ERRO_NCM.
 */
export async function conferirCadastroDosItens(itens, conta = null) {
  const descricoes = new Map();
  for (const { item } of itens ?? []) {
    const codigo = String(item?.codigo ?? '').trim();
    if (codigo && !descricoes.has(codigo)) descricoes.set(codigo, item.descricao ?? '');
  }

  const inicio = Date.now();
  const resultado = { itens: [], naoConferidos: [] };
  let semTempo = false;
  for (const [codigo, descricao] of descricoes) {
    if (semTempo) {
      resultado.naoConferidos.push({ codigo, motivo: 'limite de chamadas do Tiny' });
      continue;
    }
    try {
      resultado.itens.push({ codigo, ...(await comEspera(() => conferirCodigo(codigo, descricao, conta), inicio)) });
    } catch (e) {
      semTempo = erroDeLimite(e.message);
      resultado.naoConferidos.push({ codigo, motivo: semTempo ? 'limite de chamadas do Tiny' : e.message });
    }
  }
  return resultado;
}

/** Trecho da mensagem de sucesso com o que foi feito no cadastro ('' sem nada). */
export function avisoDoCadastro(conferencia) {
  if (!conferencia) return '';
  const corrigidos = conferencia.itens.filter((i) => i.corrigidos.length);
  const comErro = conferencia.itens.filter((i) => i.erros.length);
  const partes = [];
  if (corrigidos.length) {
    partes.push(
      `Cadastro corrigido na Olist antes da nota: ${corrigidos
        .map((i) => `${i.codigo} (${i.corrigidos.map((c) => c.toUpperCase()).join(' e ')})`)
        .join(', ')}.`
    );
  }
  if (comErro.length) {
    partes.push(
      `Não deu para corrigir o cadastro de: ${comErro
        .map((i) => `${i.codigo} (${i.erros.join(', ')}: ${i.motivos.join('; ')})`)
        .join(', ')} — a nota seguiu assim.`
    );
  }
  if (conferencia.naoConferidos.length) {
    partes.push(
      `Cadastro não conferido: ${conferencia.naoConferidos.map((i) => `${i.codigo} (${i.motivo})`).join(', ')}.`
    );
  }
  return partes.length ? ` ${partes.join(' ')}` : '';
}
