// /api/transportadoras — cadastro de transportadoras do atacado.
//
//   - GET  lista todas, com a contagem de clientes anexados.
//   - POST cria uma nova.
//
// Só grava no Supabase — nada aqui toca no Tiny. O efeito na nota acontece
// no preview do pedido (/api/pedidos/[id]/preview).

import { criarTransportadora, listarTransportadoras } from '@/lib/db';
import { validarTransportadora } from '@/lib/fiscal/transportadoras';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const { ok, erro, transportadoras } = await listarTransportadoras();
  if (!ok) return erroJson(`Não foi possível carregar as transportadoras: ${erro}`, 502);
  return Response.json({ transportadoras });
}

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  if (!corpo) return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);

  const problema = validarTransportadora(corpo);
  if (problema) return erroJson(problema, 400);

  const resultado = await criarTransportadora(corpo);
  if (!resultado.ok) return erroJson(`Não foi possível salvar: ${resultado.erro}`, 502);
  return Response.json({ transportadora: resultado.transportadora }, { status: 201 });
}
