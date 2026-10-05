// GET /api/saude — diz, serviço por serviço, se a configuração está de pé.
// É a primeira tela a consultar quando algo não funciona.

import { verificarShopify } from '@/lib/integrations/shopify';
import { verificarShopifyTransferencias } from '@/lib/integrations/shopifyTransferencias';
import { verificarTiny } from '@/lib/integrations/tiny';
import { verificarSupabase } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function checar(nome, fn) {
  try {
    return await fn();
  } catch (erro) {
    return { servico: nome, ok: false, detalhe: erro.message };
  }
}

export async function GET() {
  const servicos = await Promise.all([
    checar('Shopify', verificarShopify),
    checar('Shopify (transferências)', verificarShopifyTransferencias),
    checar('Tiny', verificarTiny),
    checar('Supabase', verificarSupabase),
  ]);

  return Response.json({
    tudoOk: servicos.every((s) => s.ok),
    servicos,
  });
}
