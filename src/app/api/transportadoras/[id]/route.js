// PUT /api/transportadoras/[id] — edita o cadastro de uma transportadora.
// Os campos que não vierem no corpo ficam como estão.

import { atualizarTransportadora } from '@/lib/db';
import { validarTransportadora } from '@/lib/fiscal/transportadoras';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(request, { params }) {
  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!corpo) return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);

  const problema = validarTransportadora(corpo, { parcial: true });
  if (problema) return erroJson(problema, 400);

  const resultado = await atualizarTransportadora(id, corpo);
  if (!resultado.ok) return erroJson(`Não foi possível salvar: ${resultado.erro}`, resultado.naoEncontrada ? 404 : 502);
  return Response.json({ transportadora: resultado.transportadora });
}
