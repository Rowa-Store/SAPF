// /api/boletos/[id]/pdf — PDFs do boleto, guardados no Supabase Storage. Um
// pedido pode ter vários (um por parcela, por exemplo).
//
//   GET     ?pdf=<id> redireciona para um link temporário daquele PDF; sem
//           ?pdf, para o primeiro enviado
//   POST    multipart: { arquivo (PDF, um ou mais), orderName? } — sobe mais
//           PDFs e marca o boleto como emitido; devolve a lista completa
//   DELETE  ?pdf=<id> remove um PDF; o status do boleto fica como está
//
// O corpo de uma Vercel Function tem limite de 4,5 MB: a tela manda um
// arquivo por requisição, e o POST recusa o que passar disso somado.

import { linkPdfBoleto, listarPdfsBoleto, removerPdfBoleto, salvarPdfBoleto } from '@/lib/db';
import { erroJson, paraGid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TAMANHO_MAXIMO = 4 * 1024 * 1024;
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
  if (arquivos.length === 0) return erroJson('Envie o PDF do boleto no campo "arquivo".', 400);
  if (arquivos.reduce((soma, a) => soma + a.size, 0) > TAMANHO_MAXIMO) {
    return erroJson('Os PDFs passam de 4 MB — envie um por vez.', 400);
  }

  // Confere tudo antes de subir qualquer um. Assinatura "%PDF" em vez de
  // confiar na extensão ou no tipo.
  const lidos = [];
  for (const arquivo of arquivos) {
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') return erroJson(`"${arquivo.name}" não é um PDF.`, 400);
    lidos.push({ nome: arquivo.name || 'boleto.pdf', bytes });
  }

  const orderId = paraGid(id);
  const orderName = form.get('orderName') || undefined;
  let boleto;
  for (const { nome, bytes } of lidos) {
    const resultado = await salvarPdfBoleto({ orderId, orderName, nome, bytes });
    if (!resultado.ok) return erroJson(`Não foi possível salvar "${nome}": ${resultado.erro}`, 502);
    boleto = resultado.boleto;
  }

  const lista = await listarPdfsBoleto(orderId);
  if (!lista.ok) return erroJson(`PDF salvo, mas não foi possível reler a lista: ${lista.erro}`, 502);
  return Response.json({
    emitido: boleto.emitido,
    numeroNfEditado: boleto.numero_nf,
    pdfs: lista.pdfs,
    temPdf: lista.pdfs.length > 0,
  });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const pdf = idDoPdf(request);
  if (!pdf) return erroJson('Informe o PDF a remover em ?pdf=.', 400);

  const orderId = paraGid(id);
  const resultado = await removerPdfBoleto(orderId, pdf);
  if (!resultado.ok) return erroJson(`Não foi possível remover o PDF: ${resultado.erro}`, resultado.semPdf ? 404 : 502);

  const lista = await listarPdfsBoleto(orderId);
  if (!lista.ok) return erroJson(`PDF removido, mas não foi possível reler a lista: ${lista.erro}`, 502);
  return Response.json({ pdfs: lista.pdfs, temPdf: lista.pdfs.length > 0 });
}
