// /api/franquias — lista de clientes franqueados (tabela client_exce).
//
//   - GET  lista todos, ativos ou não.
//   - POST inclui um cliente.
//
// Só grava no Supabase. O efeito aparece na classificação do pedido
// (classificacao.js) e no markup da nota (markupDaFranquia).

import { criarFranquia, listarFranquias } from '@/lib/db';
import { lerMarkup, MARKUP_MAXIMO, MARKUP_MINIMO } from '@/lib/fiscal/markup';
import { lerCnpjCliente } from '@/lib/fiscal/transportadoras';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const { ok, erro, franquias } = await listarFranquias();
  if (!ok) return erroJson(`Não foi possível carregar os clientes: ${erro}`, 502);
  return Response.json({ franquias });
}

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  if (!corpo) return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);

  const { cnpj, erro } = lerCnpjCliente(corpo.cnpj);
  if (erro) return erroJson(erro, 400);

  // Markup vazio = a franquia usa o padrão (ver markup.js).
  const textoMarkup = String(corpo.markup ?? '').trim();
  const markup = textoMarkup ? lerMarkup(textoMarkup) : null;
  if (textoMarkup && markup == null) {
    return erroJson(`Markup inválido: use um número entre ${MARKUP_MINIMO} e ${MARKUP_MAXIMO}, ou deixe vazio.`, 400);
  }

  const resultado = await criarFranquia({ cnpj, apelido: corpo.apelido, markup, ativo: corpo.ativo });
  if (!resultado.ok) return erroJson(`Não foi possível salvar: ${resultado.erro}`, 502);
  return Response.json({ franquia: resultado.franquia }, { status: 201 });
}
