// extensaoCaixa.js — conversa com a extensão "SAPF — Boletos CAIXA"
// (pasta extensao-caixa/ do repositório), que baixa o boleto da CAIXA pelo
// navegador de quem usa a tela. Precisa dela porque a CAIXA recusa o acesso
// vindo do servidor (HTTP 403) e não libera CORS para a página ler direto.
//
// A conversa é por window.postMessage: a página manda { origem: 'sapf' } e a
// extensão responde com { origem: 'sapf-extensao' }.

const TEMPO_PING_MS = 800;
const TEMPO_DOWNLOAD_MS = 30000;

let sequencia = 0;

/** Espera uma mensagem da extensão que passe em `aceita`, até `tempo` ms. */
function esperarResposta(aceita, tempo) {
  return new Promise((resolver) => {
    const ouvir = (evento) => {
      if (evento.source !== window || evento.data?.origem !== 'sapf-extensao' || !aceita(evento.data)) return;
      encerrar(evento.data);
    };
    const relogio = setTimeout(() => encerrar(null), tempo);
    function encerrar(dado) {
      clearTimeout(relogio);
      window.removeEventListener('message', ouvir);
      resolver(dado);
    }
    window.addEventListener('message', ouvir);
  });
}

/** true se a extensão está instalada e ativa nesta aba. */
export async function extensaoInstalada() {
  const resposta = esperarResposta((d) => d.tipo === 'pronta', TEMPO_PING_MS);
  window.postMessage({ origem: 'sapf', tipo: 'caixa:ping' }, window.location.origin);
  return !!(await resposta);
}

/**
 * Baixa o boleto pela extensão. Devolve { encontrado: false } ou
 * { encontrado: true, pdf: Blob }. Lança erro em falha ou sem resposta.
 */
export async function baixarPelaExtensao(cedente, nossoNumero) {
  const id = ++sequencia;
  const resposta = esperarResposta((d) => d.tipo === 'caixa:resultado' && d.id === id, TEMPO_DOWNLOAD_MS);
  window.postMessage({ origem: 'sapf', tipo: 'caixa:baixar', id, cedente, nossoNumero }, window.location.origin);
  const dado = await resposta;
  if (!dado) throw new Error('A extensão da CAIXA não respondeu.');
  if (dado.erro) throw new Error(dado.erro);
  if (!dado.encontrado) return { encontrado: false };
  const binario = atob(dado.pdfBase64);
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return { encontrado: true, pdf: new Blob([bytes], { type: 'application/pdf' }) };
}
