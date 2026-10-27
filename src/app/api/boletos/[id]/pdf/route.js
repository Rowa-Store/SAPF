// /api/boletos/[id]/pdf — PDF do boleto, guardado no Supabase Storage.
//
//   GET   redireciona para um link temporário do PDF
//   POST  multipart: { arquivo (PDF), orderName? } — sobe ou troca o PDF e
//         marca o boleto como emitido
//
// O corpo de uma Vercel Function tem limite de 4,5 MB; boleto passa longe disso.

import { linkPdfBoleto, salvarPdfBoleto } from '@/lib/db';
import { erroJson, paraGid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TAMANHO_MAXIMO = 4 * 1024 * 1024;

export async function GET(_request, { params }) {
  const { id } = await params;
  const resultado = await linkPdfBoleto(paraGid(id));
  if (!resultado.ok) return erroJson(`Não foi possível abrir o boleto: ${resultado.erro}`, resultado.semPdf ? 404 : 502);
  return Response.redirect(resultado.url, 302);
}

export async function POST(request, { params }) {
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const arquivo = form?.get('arquivo');
  if (!arquivo || typeof arquivo === 'string') return erroJson('Envie o PDF do boleto no campo "arquivo".', 400);
  if (arquivo.size > TAMANHO_MAXIMO) return erroJson('O PDF passa de 4 MB.', 400);

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  // Confere a assinatura "%PDF" em vez de confiar na extensão ou no tipo.
  if (String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') return erroJson('O arquivo não é um PDF.', 400);

  const resultado = await salvarPdfBoleto({
    orderId: paraGid(id),
    orderName: form.get('orderName') || undefined,
    bytes,
  });
  if (!resultado.ok) return erroJson(`Não foi possível salvar o boleto: ${resultado.erro}`, 502);
  return Response.json({
    emitido: resultado.boleto.emitido,
    numeroNfEditado: resultado.boleto.numero_nf,
    temPdf: !!resultado.boleto.pdf_path,
  });
}
