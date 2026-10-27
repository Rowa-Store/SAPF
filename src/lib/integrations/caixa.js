// caixa.js — boletos da CAIXA (e-Cobrança) pelo link público de impressão.
//
// O link (ver urlBoletoPdf) abre sem login e devolve o PDF do título, ou o
// texto "BOLETO NAO ENCONTRADO" quando ele não existe. Nada aqui faz login
// nem lê as telas do e-Cobrança. A situação do título (pago, baixado) não
// vem do PDF: isso fica para o arquivo de retorno da CAIXA.

import { urlBoletoPdf } from '../caixa/nossoNumero.js';
import { lerBoletoPdf } from '../caixa/boletoPdf.js';

const TEMPO_LIMITE_MS = 15000;

/**
 * Baixa o boleto deste nosso número. Devolve { encontrado: false } ou
 * { encontrado: true, bytes, valor, vencimento }. Lança exceção em falha de
 * rede, HTTP de erro ou CAIXA_CEDENTE ausente.
 */
export async function baixarBoletoCaixa(nossoNumero) {
  const resposta = await fetch(urlBoletoPdf(nossoNumero), {
    cache: 'no-store',
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  });
  if (!resposta.ok) throw new Error(`CAIXA respondeu HTTP ${resposta.status}.`);
  const bytes = new Uint8Array(await resposta.arrayBuffer());
  const lido = lerBoletoPdf(bytes);
  return lido.encontrado ? { ...lido, bytes } : lido;
}
