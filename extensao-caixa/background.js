// background.js — baixa o boleto da CAIXA pelo link de impressão. Roda no
// navegador de quem usa o SAPF (a CAIXA recusa o acesso vindo do servidor).
// Só aceita o link de impressão do e-Cobrança, com cedente e nosso número
// numéricos: a extensão não serve para buscar outra coisa.

const BASE = 'https://boletoonline.caixa.gov.br/ecobranca/SIGCB/imprimir';

async function baixar({ cedente, nossoNumero }) {
  if (!/^\d{1,10}$/.test(String(cedente)) || !/^\d{17}$/.test(String(nossoNumero))) {
    return { erro: 'Cedente ou nosso número inválido.' };
  }
  const resposta = await fetch(`${BASE}/${cedente}/${nossoNumero}`, { cache: 'no-store' });
  if (!resposta.ok) return { erro: `CAIXA respondeu HTTP ${resposta.status}.` };
  const bytes = new Uint8Array(await resposta.arrayBuffer());
  // A CAIXA devolve o PDF, ou o texto "BOLETO NAO ENCONTRADO" (também 200).
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') return { encontrado: false };
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { encontrado: true, pdfBase64: btoa(binario) };
}

chrome.runtime.onMessage.addListener((mensagem, _remetente, responder) => {
  if (mensagem?.tipo !== 'caixa:baixar') return false;
  baixar(mensagem)
    .then(responder)
    .catch((erro) => responder({ erro: `Falha ao acessar a CAIXA: ${erro.message}` }));
  return true; // resposta assíncrona
});
