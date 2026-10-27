// content.js — ponte entre a tela /boletos do SAPF e a extensão. A página
// conversa por window.postMessage (ver src/features/boletos/extensaoCaixa.js);
// os pedidos de download vão para o background.js.

const VERSAO = chrome.runtime.getManifest().version;
const anunciar = () => window.postMessage({ origem: 'sapf-extensao', tipo: 'pronta', versao: VERSAO }, window.location.origin);

window.addEventListener('message', (evento) => {
  if (evento.source !== window || evento.data?.origem !== 'sapf') return;
  const { tipo, id, cedente, nossoNumero } = evento.data;
  if (tipo === 'caixa:ping') anunciar();
  if (tipo !== 'caixa:baixar') return;
  chrome.runtime.sendMessage({ tipo, cedente, nossoNumero }, (resposta) => {
    const erro = chrome.runtime.lastError?.message;
    window.postMessage(
      { origem: 'sapf-extensao', tipo: 'caixa:resultado', id, ...(erro ? { erro } : resposta) },
      window.location.origin
    );
  });
});

anunciar();
