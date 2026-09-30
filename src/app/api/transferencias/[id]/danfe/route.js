// GET /api/transferencias/[id]/danfe — abre o DANFE da nota da transferência.
//
// Mesmo esquema de /api/pedidos/[id]/danfe (o link do Tiny é uma página HTML
// que abre o diálogo de impressão — dali se salva o PDF), mas o id da nota
// vem do Supabase e não da URL: a tela só precisa saber o id da transferência.

import { obterLinkDanfe } from '@/lib/integrations/tiny';
import { contaTinyDaTransferencia, lerNaContaDaNota } from '@/lib/integrations/tinyContas';
import { paraGidTransferencia } from '@/lib/integrations/shopifyTransferencias';
import { statusPorPedido } from '@/lib/db';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const { id } = await params;
  const gid = paraGidTransferencia(id);

  const situacao = (await statusPorPedido([gid]))[gid];
  if (!situacao?.tiny_nota_id) return erroJson('Esta transferência ainda não tem nota no Tiny.', 404);

  // A nota mora na conta do Tiny da loja de origem (ou na da matriz, se for
  // anterior às contas por loja).
  const conta = await contaTinyDaTransferencia(id);
  if (!conta.ok) return erroJson(conta.erro, 422);

  let link;
  try {
    link = await lerNaContaDaNota(conta.conta, (c) => obterLinkDanfe(situacao.tiny_nota_id, c));
  } catch (erro) {
    return erroJson(`Não foi possível obter o DANFE: ${erro.message}`, 502);
  }

  return Response.redirect(link, 302);
}
