// /api/transportadoras/[id]/clientes — clientes (por CNPJ) que usam esta
// transportadora.
//
//   - GET  lista os anexados.
//   - POST anexa um CNPJ: { cnpj, nome?, mover? }. Cada cliente tem uma
//          transportadora só — se o CNPJ já estiver em outra, volta 409 com
//          `emOutra`, e só com `mover: true` o anexo troca de transportadora.

import { anexarClienteTransportadora, listarClientesDaTransportadora } from '@/lib/db';
import { lerCnpjCliente } from '@/lib/fiscal/transportadoras';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const { id } = await params;
  const { ok, erro, clientes } = await listarClientesDaTransportadora(id);
  if (!ok) return erroJson(`Não foi possível carregar os clientes: ${erro}`, 502);
  return Response.json({ clientes });
}

export async function POST(request, { params }) {
  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!corpo) return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);

  const { cnpj, erro: erroCnpj } = lerCnpjCliente(corpo.cnpj);
  if (erroCnpj) return erroJson(erroCnpj, 400);

  const resultado = await anexarClienteTransportadora({
    transportadoraId: id,
    cnpj,
    nome: corpo.nome,
    mover: corpo.mover === true,
  });
  if (!resultado.ok) {
    const status = resultado.emOutra || resultado.jaAnexado ? 409 : 502;
    return erroJson(resultado.erro, status, resultado.emOutra ? { emOutra: resultado.emOutra } : {});
  }
  return Response.json({ cliente: resultado.cliente, movido: resultado.movido }, { status: 201 });
}
