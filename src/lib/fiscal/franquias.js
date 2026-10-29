// franquias.js — leitura e validação do cadastro de clientes franqueados,
// usada por /api/franquias. Fica fora do db.js porque é regra de negócio,
// não acesso a dados.

import { lerMarkup, MARKUP_MAXIMO, MARKUP_MINIMO } from './markup.js';
import { UFS } from './transportadoras.js';
import { somenteDigitos } from '../utils.js';

const TEXTOS = [
  'apelido',
  'razao_social',
  'contato',
  'email',
  'telefone',
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
  'observacoes',
];

/**
 * Confere o corpo vindo da tela e devolve o que gravar.
 *
 *   - `dados`           campos de client_exce (markup já em número ou null);
 *   - `ie`              dígitos, '' para apagar, undefined = não mexer;
 *   - `transportadoraId` id, null = nenhuma (Correios), undefined = não mexer.
 *
 * @returns {{ erro: string } | { dados: object, ie?: string, transportadoraId?: string|null }}
 */
export function lerFranquia(corpo) {
  const dados = {};
  for (const campo of TEXTOS) {
    if (campo in corpo) dados[campo] = String(corpo[campo] ?? '').trim();
  }
  if ('ativo' in corpo) dados.ativo = corpo.ativo !== false;

  if ('markup' in corpo) {
    // Markup vazio = a franquia usa o padrão (ver markup.js).
    const texto = String(corpo.markup ?? '').trim();
    dados.markup = texto ? lerMarkup(texto) : null;
    if (texto && dados.markup == null) {
      return { erro: `Markup inválido: use um número entre ${MARKUP_MINIMO} e ${MARKUP_MAXIMO}, ou deixe vazio.` };
    }
  }

  if (dados.uf) {
    dados.uf = dados.uf.toUpperCase();
    if (!UFS.has(dados.uf)) return { erro: `UF "${dados.uf}" não existe.` };
  }
  if (dados.cep && somenteDigitos(dados.cep).length !== 8) return { erro: 'O CEP precisa ter 8 dígitos.' };
  if (dados.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) return { erro: 'O e-mail não parece válido.' };

  const resultado = { dados };

  if ('ie' in corpo) {
    const texto = String(corpo.ie ?? '').trim();
    resultado.ie = somenteDigitos(texto);
    if (texto && !resultado.ie) return { erro: 'A inscrição estadual deve ter só números (vazio para nenhuma).' };
  }

  if ('transportadoraId' in corpo) {
    const id = corpo.transportadoraId;
    resultado.transportadoraId = id == null || id === '' ? null : String(id);
  }

  return resultado;
}
