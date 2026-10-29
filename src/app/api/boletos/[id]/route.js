// PATCH /api/boletos/[id] — grava o status do boleto (emitido/pendente), o nº
// da NF digitado na tela e/ou a forma em que o pedido acabou pago. Corpo:
// { orderName?, emitido?, numeroNf?, pagoCom? }; campo ausente fica como
// está, `numeroNf` vazio volta ao nº da nota no Tiny e `pagoCom` null volta a
// boleto.

import { FORMAS_PAGO_COM, salvarBoleto } from '@/lib/db';
import { erroJson, paraGid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(request, { params }) {
  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!corpo) return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);

  const { orderName, emitido, numeroNf, pagoCom } = corpo;
  if (emitido === undefined && numeroNf === undefined && pagoCom === undefined) {
    return erroJson('Nada para gravar: envie emitido, numeroNf ou pagoCom.', 400);
  }
  if (emitido !== undefined && typeof emitido !== 'boolean') return erroJson('emitido deve ser true ou false.', 400);
  if (numeroNf != null && !/^\d{0,9}$/.test(String(numeroNf).trim())) {
    return erroJson('O nº da NF deve ter só dígitos (até 9).', 400);
  }
  if (pagoCom != null && !FORMAS_PAGO_COM.includes(pagoCom)) {
    return erroJson(`pagoCom deve ser ${FORMAS_PAGO_COM.join(', ')} ou null.`, 400);
  }

  const resultado = await salvarBoleto({ orderId: paraGid(id), orderName, emitido, numeroNf, pagoCom });
  if (!resultado.ok) return erroJson(`Não foi possível salvar o boleto: ${resultado.erro}`, 502);
  return Response.json({
    emitido: resultado.boleto.emitido,
    numeroNfEditado: resultado.boleto.numero_nf,
    pagoCom: resultado.boleto.pago_com,
  });
}
