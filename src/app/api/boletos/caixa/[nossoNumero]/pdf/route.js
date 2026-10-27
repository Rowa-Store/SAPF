// GET /api/boletos/caixa/[nossoNumero]/pdf — abre o PDF de um título da
// CAIXA: a cópia guardada no Storage, ou, sem cópia, o link de impressão da
// própria CAIXA.

import { urlBoletoPdf } from '@/lib/caixa/nossoNumero';
import { linkPdfTituloCaixa } from '@/lib/db';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  const { nossoNumero } = await params;
  if (!/^\d{17}$/.test(nossoNumero)) return erroJson('Nosso número inválido.', 400);

  const copia = await linkPdfTituloCaixa(nossoNumero);
  if (copia.ok) return Response.redirect(copia.url, 302);
  if (!copia.semPdf) return erroJson(`Não foi possível abrir o boleto: ${copia.erro}`, 502);
  try {
    return Response.redirect(urlBoletoPdf(nossoNumero), 302);
  } catch (erro) {
    return erroJson(erro.message, 500);
  }
}
