// /api/boletos/[id]/pdf — arquivos do boleto, guardados no Supabase Storage:
// os PDFs do boleto (vários, um por parcela, por exemplo) e, se o pedido foi
// pago com cartão/PIX, os comprovantes do pagamento (PDF ou imagem).
//
//   GET     ?pdf=<id> redireciona para um link temporário daquele arquivo;
//           sem ?pdf, para o primeiro PDF de boleto enviado
//   POST    multipart: { arquivo (um ou mais), orderName?, tipo? } — sobe mais
//           arquivos; `tipo=comprovante` aceita PDF, PNG ou JPG e não mexe no
//           status, sem ele é PDF de boleto e marca o boleto como emitido.
//           Devolve as listas completas
//   DELETE  ?pdf=<id> remove um arquivo; o status do boleto fica como está
//
// O corpo de uma Vercel Function tem limite de 4,5 MB: a tela manda um
// arquivo por requisição, e o POST recusa o que passar disso somado.

import { linkPdfBoleto, listarPdfsBoleto, removerPdfBoleto, salvarPdfBoleto } from '@/lib/db';
import { erroJson, paraGid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TAMANHO_MAXIMO = 4 * 1024 * 1024;

// Tipos aceitos, pela assinatura dos primeiros bytes em vez da extensão ou do
// tipo declarado. Boleto só PDF; comprovante também aceita print (PNG/JPG).
const FORMATOS = [
  { assinatura: [0x25, 0x50, 0x44, 0x46], contentType: 'application/pdf', extensao: 'pdf' },
  { assinatura: [0x89, 0x50, 0x4e, 0x47], contentType: 'image/png', extensao: 'png' },
  { assinatura: [0xff, 0xd8, 0xff], contentType: 'image/jpeg', extensao: 'jpg' },
];
const formatoDe = (bytes) => FORMATOS.find((f) => f.assinatura.every((b, i) => bytes[i] === b));
const ID_PDF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idDoPdf(request) {
  const pdf = new URL(request.url).searchParams.get('pdf');
  return pdf && ID_PDF.test(pdf) ? pdf : pdf ? false : null;
}

export async function GET(request, { params }) {
  const { id } = await params;
  const pdf = idDoPdf(request);
  if (pdf === false) return erroJson('Id de PDF inválido.', 400);
  const resultado = await linkPdfBoleto(paraGid(id), pdf);
  if (!resultado.ok) return erroJson(`Não foi possível abrir o boleto: ${resultado.erro}`, resultado.semPdf ? 404 : 502);
  return Response.redirect(resultado.url, 302);
}

export async function POST(request, { params }) {
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const arquivos = (form?.getAll('arquivo') ?? []).filter((a) => typeof a !== 'string');
  const tipo = form?.get('tipo') || 'boleto';
  if (!['boleto', 'comprovante'].includes(tipo)) return erroJson('tipo deve ser boleto ou comprovante.', 400);
  const comprovante = tipo === 'comprovante';
  if (arquivos.length === 0) {
    return erroJson(`Envie o ${comprovante ? 'comprovante' : 'PDF do boleto'} no campo "arquivo".`, 400);
  }
  if (arquivos.reduce((soma, a) => soma + a.size, 0) > TAMANHO_MAXIMO) {
    return erroJson('Os arquivos passam de 4 MB — envie um por vez.', 400);
  }

  // Confere tudo antes de subir qualquer um.
  const lidos = [];
  for (const arquivo of arquivos) {
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const formato = formatoDe(bytes);
    if (!formato || (!comprovante && formato.extensao !== 'pdf')) {
      return erroJson(`"${arquivo.name}" não é ${comprovante ? 'PDF, PNG nem JPG' : 'um PDF'}.`, 400);
    }
    lidos.push({ nome: arquivo.name || `${tipo}.${formato.extensao}`, bytes, formato });
  }

  const orderId = paraGid(id);
  const orderName = form.get('orderName') || undefined;
  let boleto;
  for (const { nome, bytes, formato } of lidos) {
    const resultado = await salvarPdfBoleto({
      orderId,
      orderName,
      nome,
      bytes,
      tipo,
      contentType: formato.contentType,
      extensao: formato.extensao,
    });
    if (!resultado.ok) return erroJson(`Não foi possível salvar "${nome}": ${resultado.erro}`, 502);
    boleto = resultado.boleto;
  }

  const lista = await listarPdfsBoleto(orderId);
  if (!lista.ok) return erroJson(`Arquivo salvo, mas não foi possível reler a lista: ${lista.erro}`, 502);
  return Response.json({
    emitido: boleto.emitido,
    numeroNfEditado: boleto.numero_nf,
    pagoCom: boleto.pago_com,
    pdfs: lista.pdfs,
    temPdf: lista.pdfs.length > 0,
    comprovantes: lista.comprovantes,
  });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const pdf = idDoPdf(request);
  if (!pdf) return erroJson('Informe o PDF a remover em ?pdf=.', 400);

  const orderId = paraGid(id);
  const resultado = await removerPdfBoleto(orderId, pdf);
  if (!resultado.ok) return erroJson(`Não foi possível remover o arquivo: ${resultado.erro}`, resultado.semPdf ? 404 : 502);

  const lista = await listarPdfsBoleto(orderId);
  if (!lista.ok) return erroJson(`Arquivo removido, mas não foi possível reler a lista: ${lista.erro}`, 502);
  return Response.json({ pdfs: lista.pdfs, temPdf: lista.pdfs.length > 0, comprovantes: lista.comprovantes });
}
