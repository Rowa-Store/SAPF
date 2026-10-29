// emailNotaFranquia.js — e-mail da nota autorizada para o cliente franqueado:
// o XML anexado e o link do DANFE para impressão no corpo. O Tiny não entrega
// o DANFE em PDF pela API — o link é a mesma página com impressão automática
// do botão "DANFE" da tela (ver obterLinkDanfe em tiny.js).
//
// Quem chama: a emissão (/api/pedidos/[id]/emitir) e a conferência da tela B2B
// (/api/pedidos/[id]/situacao), que pega a nota cuja autorização demorou. A
// coluna email_nf_enviado_em garante um envio automático só por nota; o botão
// da tela do pedido (/api/pedidos/[id]/email) reenvia quando a pessoa pede. A nota já está
// emitida quando isto roda: nada aqui lança exceção — o resultado vira um
// aviso na tela.

import { obterLinkDanfe, obterXmlNota } from '../integrations/tiny.js';
import { enviarEmail } from '../integrations/resend.js';
import { franquiaPorCnpj, liberarEmailNf, obterRascunhoCriado, registrarEmailNf, reservarEmailNf } from '../db.js';

const REMETENTE = 'Rowa <nfe@rowastore.com.br>';

/**
 * Cadastro da franquia ativa dona do pedido, pelo cliente do rascunho que foi
 * para o Tiny; null quando o cliente não é franquia (ou a consulta falha).
 */
export async function franquiaDoPedido(orderId) {
  const rascunho = await obterRascunhoCriado(orderId);
  const cnpj = rascunho.rascunho?.payload_enviado?.nota_fiscal?.cliente?.cpf_cnpj;
  if (!cnpj) return null;
  const { ok, erro, franquia } = await franquiaPorCnpj(cnpj);
  if (!ok) {
    console.error(`[email-nf] Não foi possível conferir se ${cnpj} é franquia:`, erro);
    return null;
  }
  return franquia && franquia.ativo !== false ? franquia : null;
}

/** Os dados da nota que o e-mail mostra, lidos do XML autorizado. */
export function dadosDoXml(xml) {
  const tag = (nome) => xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`))?.[1]?.trim() ?? '';
  const [ano, mes, dia] = tag('dhEmi').slice(0, 10).split('-');
  return {
    numero: tag('nNF'),
    serie: tag('serie'),
    chave: xml.match(/Id="NFe(\d{44})"/)?.[1] ?? '',
    emissao: dia ? `${dia}/${mes}/${ano}` : '',
    valor: Number(tag('vNF') || 0),
  };
}

/**
 * Envia a nota para o e-mail do cadastro da franquia. `reenvio`: pedido à
 * mão — manda mesmo que já tenha ido, e só registra o envio depois.
 *
 * @returns {{ enviado: true, para: string } | { aviso: string } | null}
 *          null quando não há o que avisar (já enviado).
 */
export async function enviarNotaParaFranquia({ orderId, tinyNotaId, franquia, reenvio = false }) {
  const nome = franquia.apelido || franquia.razao_social || franquia.cnpj;
  const para = String(franquia.email ?? '').trim();
  if (!para) {
    return { aviso: `A franquia ${nome} não tem e-mail no cadastro (B2B > Clientes): a nota não foi enviada por e-mail.` };
  }

  let reservado = false;
  try {
    // Quem chama só chama com a nota já numerada (autorizada); o XML sem o
    // protocolo da SEFAZ não vai para o cliente.
    const xml = await obterXmlNota(tinyNotaId);
    if (!xml) throw new Error('o Tiny ainda não tem o XML autorizado da nota');

    if (!reenvio) {
      const reserva = await reservarEmailNf(orderId);
      if (!reserva.ok) throw new Error(reserva.erro);
      if (!reserva.reservado) return null;
      reservado = true;
    }

    const nota = dadosDoXml(xml);
    const linkDanfe = await obterLinkDanfe(tinyNotaId);
    await enviarEmail({
      de: REMETENTE,
      para,
      assunto: `Nota fiscal nº ${nota.numero} — Rowa`,
      html: htmlEmail({ nome, nota, linkDanfe }),
      anexos: [{ nome: `NFe${nota.chave || nota.numero}.xml`, conteudo: xml }],
      // O Resend descarta a mesma chave por 24h: no reenvio ela atrapalharia.
      idempotencia: reenvio ? undefined : `nf-franquia/${tinyNotaId}`,
    });
    if (reenvio) await registrarReenvio(orderId);
    return { enviado: true, para };
  } catch (erro) {
    console.error(`[email-nf] Falha ao enviar a nota ${tinyNotaId} para ${para}:`, erro);
    if (reservado) {
      const liberacao = await liberarEmailNf(orderId);
      if (!liberacao.ok) console.error(`[email-nf] Falha ao liberar o envio de ${orderId}:`, liberacao.erro);
    }
    return { aviso: `Não foi possível enviar a nota por e-mail para ${para}: ${erro.message}` };
  }
}

/** O e-mail já saiu: falha ao registrar só loga — virar aviso de erro faria a
 *  pessoa clicar de novo e mandar em dobro. */
async function registrarReenvio(orderId) {
  try {
    const registro = await registrarEmailNf(orderId);
    if (!registro.ok) throw new Error(registro.erro);
  } catch (erro) {
    console.error(`[email-nf] Nota enviada, mas falhou ao registrar o envio de ${orderId}:`, erro);
  }
}

function htmlEmail({ nome, nota, linkDanfe }) {
  const valor = nota.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const linha = (rotulo, texto) =>
    `<tr><td style="padding:6px 0;color:#9ca3af;font-size:13px">${rotulo}</td>` +
    `<td style="padding:6px 0;color:#1a1a1a;font-size:13px;text-align:right">${escapar(texto)}</td></tr>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f6f3;margin:0;padding:0">
  <div style="max-width:480px;margin:48px auto;background:#fff;border-radius:24px;border:1px solid #e5e3de;overflow:hidden">
    <div style="background:#c47276;padding:32px 40px">
      <p style="font-size:11px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#f0d8d9;margin:0 0 8px">Rowa</p>
      <h1 style="font-size:24px;font-weight:700;color:#fff;margin:0">Nota fiscal nº ${escapar(nota.numero)}</h1>
    </div>
    <div style="padding:36px 40px">
      <p style="font-size:15px;line-height:1.7;color:#667085;margin:0 0 24px">
        Olá, <strong>${escapar(nome)}</strong>! A nota fiscal do seu pedido foi emitida.
        O XML está anexado a este e-mail e o DANFE abre pronto para imprimir no botão abaixo.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        ${linha('Número / série', `${nota.numero} / ${nota.serie}`)}
        ${linha('Emissão', nota.emissao)}
        ${linha('Valor total', valor)}
        ${linha('Chave de acesso', nota.chave)}
      </table>
      <a href="${escapar(linkDanfe)}" style="display:inline-block;background:#c47276;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:100px">Imprimir DANFE</a>
      <p style="font-size:12px;color:#9ca3af;margin:24px 0 0;padding-top:20px;border-top:1px solid #f0ece6">
        E-mail automático enviado pela Rowa. Dúvidas sobre a nota, fale com o seu contato comercial.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
