// DELETE /api/transportadoras/[id]/clientes/[cnpj] — solta o cliente desta
// transportadora; as notas dele voltam a sair pelos Correios.

import { desanexarClienteTransportadora } from '@/lib/db';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(request, { params }) {
  const { id, cnpj } = await params;
  const resultado = await desanexarClienteTransportadora({ transportadoraId: id, cnpj });
  if (!resultado.ok) return erroJson(`Não foi possível remover o cliente: ${resultado.erro}`, 502);
  return Response.json({ ok: true });
}
