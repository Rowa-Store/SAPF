// resend.js — envio de e-mail pela API REST do Resend (sem SDK: é um POST).
//
// O SAPF tem a própria RESEND_API_KEY, criada na mesma conta Resend do
// hub-rowa — o domínio rowastore.com.br já está verificado lá e vale para as
// duas chaves. Chave separada permite revogar uma sem derrubar a outra.
// https://resend.com/docs/api-reference/emails/send-email

const URL_RESEND = 'https://api.resend.com/emails';

/**
 * Envia um e-mail. `anexos`: [{ nome, conteudo: Buffer|string }].
 * `idempotencia`: o Resend descarta um segundo envio com a mesma chave
 * (por 24h) — protege contra reenvio numa repetição da chamada.
 */
export async function enviarEmail({ de, para, assunto, html, anexos = [], idempotencia }) {
  const chave = process.env.RESEND_API_KEY;
  if (!chave) throw new Error('RESEND_API_KEY não configurada. Preencha o .env.local / as variáveis do Vercel.');

  let resposta;
  try {
    resposta = await fetch(URL_RESEND, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chave}`,
        'Content-Type': 'application/json',
        ...(idempotencia ? { 'Idempotency-Key': idempotencia } : {}),
      },
      body: JSON.stringify({
        from: de,
        to: [para],
        subject: assunto,
        html,
        attachments: anexos.map((a) => ({ filename: a.nome, content: Buffer.from(a.conteudo).toString('base64') })),
      }),
      cache: 'no-store',
    });
  } catch (erro) {
    console.error('[resend] falha de rede:', erro);
    throw new Error('Falha de rede ao chamar o Resend. Veja os logs do servidor para o detalhe.');
  }

  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(`Resend recusou o envio (${resposta.status}): ${corpo.message ?? 'sem detalhe'}`);
  return corpo.id;
}
