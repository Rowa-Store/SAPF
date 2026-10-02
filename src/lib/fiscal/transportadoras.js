// transportadoras.js — validação do cadastro de transportadoras, usada pelas
// rotas de /api/transportadoras. Fica fora do db.js porque é regra de
// negócio, não acesso a dados.

import { cnpjValido, somenteDigitos } from '../utils.js';

const UFS = new Set(
  'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')
);

// A nota leva os dados da transportadora só do nosso cadastro — nada é
// procurado nem cadastrado no Tiny (ver transporteDaTransportadora em
// transporte.js). Sem estes campos o bloco de transporte da nota sai
// incompleto. A IE fica opcional: transportadora isenta não tem.
const OBRIGATORIOS = [
  ['nome', 'o nome (razão social)'],
  ['cnpj', 'o CNPJ'],
  ['endereco', 'o endereço'],
  ['cidade', 'a cidade'],
  ['uf', 'a UF'],
];

/**
 * Confere os dados da tela antes de gravar. `parcial` (edição) deixa de fora
 * os campos que não vieram, mas o que vier não pode estar vazio.
 * @returns {string|null} a mensagem do primeiro problema, ou null.
 */
export function validarTransportadora(dados, { parcial = false } = {}) {
  if (!dados || typeof dados !== 'object') return 'Envie os dados da transportadora.';

  for (const [campo, rotulo] of OBRIGATORIOS) {
    if ((!parcial || campo in dados) && !String(dados[campo] ?? '').trim()) {
      return `Informe ${rotulo} da transportadora — esses dados vão direto na nota.`;
    }
  }
  if (dados.cnpj && !cnpjValido(dados.cnpj)) return 'O CNPJ da transportadora não é válido.';
  const uf = String(dados.uf ?? '').trim().toUpperCase();
  if (uf && !UFS.has(uf)) return `UF "${dados.uf}" não existe.`;
  return null;
}

/** CNPJ do cliente a anexar: obrigatório e válido. Devolve os dígitos ou o erro. */
export function lerCnpjCliente(valor) {
  const cnpj = somenteDigitos(valor);
  if (!cnpj) return { erro: 'Informe o CNPJ do cliente.' };
  if (!cnpjValido(cnpj)) return { erro: 'O CNPJ do cliente não é válido — confira os dígitos.' };
  return { cnpj };
}
