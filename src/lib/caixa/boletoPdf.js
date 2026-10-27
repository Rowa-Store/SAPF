// boletoPdf.js — lê o valor e o vencimento do PDF de um boleto da CAIXA.
//
// Não lê o layout do PDF (que pode mudar): procura a LINHA DIGITÁVEL, que é
// padrão FEBRABAN. O último campo dela é o fator de vencimento (4 dígitos) +
// o valor em centavos (10 dígitos). O PDF do e-Cobrança é gerado pelo iText,
// com o texto em claro dentro de streams Flate — dá para tirar o texto só com
// o zlib, sem biblioteca de PDF.

import { inflateSync } from 'node:zlib';

// 5.5 5.6 5.6 1 14 — ex.: 10491.24892 34000.100049 00245.150172 2 16410000332886
const LINHA_DIGITAVEL = /(\d{5})\.(\d{5})\s+(\d{5})\.(\d{6})\s+(\d{5})\.(\d{6})\s+(\d)\s+(\d{4})(\d{10})/;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Data (AAAA-MM-DD) de um fator de vencimento. O fator chegou a 9999 em
 * 21/02/2025 e recomeçou em 1000 no dia seguinte (regra da FEBRABAN); "0000"
 * é boleto sem vencimento.
 */
export function dataDoFator(fator) {
  const f = Number(fator);
  if (!Number.isInteger(f) || f < 1000) return null;
  return new Date(Date.UTC(2025, 1, 22) + (f - 1000) * DIA_MS).toISOString().slice(0, 10);
}

/** { linhaDigitavel, valor (string "1234.56"), vencimento (AAAA-MM-DD) } ou null. */
export function lerLinhaDigitavel(texto) {
  const m = String(texto ?? '').match(LINHA_DIGITAVEL);
  if (!m) return null;
  const centavos = Number(m[9]);
  return {
    linhaDigitavel: m.slice(1).join(''),
    // String com 2 casas, não float: vai para uma coluna numeric.
    valor: `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`,
    vencimento: dataDoFator(m[8]),
  };
}

/** Texto das strings `(…) Tj` de todas as streams Flate do PDF. */
function textoDoPdf(bytes) {
  const buf = Buffer.from(bytes);
  const bruto = buf.toString('latin1');
  const partes = [];
  const inicio = /stream\r?\n/g;
  let m;
  while ((m = inicio.exec(bruto))) {
    const ini = m.index + m[0].length;
    const fim = bruto.indexOf('endstream', ini);
    if (fim < 0) break;
    let conteudo;
    try {
      conteudo = inflateSync(buf.subarray(ini, fim)).toString('latin1');
    } catch {
      continue; // imagem, fonte ou stream que não é Flate
    }
    for (const s of conteudo.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) partes.push(s[1].replace(/\\(.)/g, '$1'));
  }
  return partes.join('\n');
}

/**
 * Resposta do link de impressão da CAIXA: PDF ou o texto "BOLETO NAO
 * ENCONTRADO" (as duas com HTTP 200). Devolve { encontrado: false } ou
 * { encontrado: true, valor, vencimento, linhaDigitavel } — valor e
 * vencimento null se a linha digitável não for achada.
 */
export function lerBoletoPdf(bytes) {
  const ehPdf = Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
  if (!ehPdf) return { encontrado: false };
  const linha = lerLinhaDigitavel(textoDoPdf(bytes));
  return { encontrado: true, valor: linha?.valor ?? null, vencimento: linha?.vencimento ?? null, linhaDigitavel: linha?.linhaDigitavel ?? null };
}
