// utils.js — funções pequenas e sem efeito colateral, usadas em vários módulos.
// Ficam separadas para poderem ser testadas isoladamente.

/** Mantém apenas os dígitos de uma string (CNPJ, CPF, CEP). */
export function somenteDigitos(valor) {
  return String(valor ?? '').replace(/\D+/g, '');
}

/** true quando a string tem exatamente 14 dígitos (formato de CNPJ).
 *  Atenção: não valida os dígitos verificadores, só o formato. */
export function pareceCnpj(valor) {
  return somenteDigitos(valor).length === 14;
}

/** Formata um número no padrão que o Tiny espera: ponto decimal, 2 casas. */
export function valorMonetario(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

/** Converte uma data ISO (Shopify) para dd/mm/aaaa (Tiny). */
export function dataBr(iso) {
  const d = iso ? new Date(iso) : new Date();
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getFullYear()}`;
}

/** Tenta separar "Rua das Flores 120" em { logradouro, numero }.
 *  Quando não dá para separar com segurança, devolve numero vazio — a tela do
 *  rascunho deixa o campo editável justamente para esses casos. */
export function separarLogradouro(address1) {
  const texto = String(address1 ?? '').trim();
  if (!texto) return { logradouro: '', numero: '' };

  // Casos comuns: "Rua X, 120", "Rua X 120", "Rua X, 120 - fundos"
  const comVirgula = texto.match(/^(.*?),\s*(\d+[A-Za-z]?)\b(.*)$/);
  if (comVirgula) {
    return { logradouro: comVirgula[1].trim(), numero: comVirgula[2].trim() };
  }
  const semVirgula = texto.match(/^(.*?)\s+(\d+[A-Za-z]?)$/);
  if (semVirgula) {
    return { logradouro: semVirgula[1].trim(), numero: semVirgula[2].trim() };
  }
  return { logradouro: texto, numero: '' };
}

/** Extrai o número de um gid do Shopify: gid://shopify/Order/1001 -> "1001". */
export function idNumerico(gid) {
  const partes = String(gid ?? '').split('/');
  return partes[partes.length - 1] || '';
}

/** Aceita "1001" ou o gid completo e sempre devolve o gid. */
export function paraGid(id) {
  const texto = String(id ?? '');
  if (texto.startsWith('gid://')) return texto;
  return `gid://shopify/Order/${texto}`;
}

/** Resposta JSON de erro padronizada para as API Routes. */
export function erroJson(mensagem, status = 500, extra = {}) {
  return Response.json({ erro: mensagem, ...extra }, { status });
}
