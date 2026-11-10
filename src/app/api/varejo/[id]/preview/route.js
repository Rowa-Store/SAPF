// GET /api/varejo/[id]/preview — monta a nota de um pedido da loja online
// (ver montarNotaVarejo) para a confirmação da tela /varejo. Só faz LEITURA
// no Tiny; o rascunho é criado por POST /api/pedidos/[id]/rascunho.

import { obterPedidoCompleto } from '@/lib/integrations/shopify';
import { descontoDaNota, montarNotaVarejo, totalDaNota } from '@/lib/fiscal/montarNota';
import { jaProcessado, registrarPreview } from '@/lib/db';
import { erroJson, paraGid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CLASSIFICACAO = 'varejo';

export async function GET(request, { params }) {
  const { id } = await params;

  try {
    const pedido = await obterPedidoCompleto(id);
    const { payload, alertas } = montarNotaVarejo(pedido);
    if (pedido.sourceName !== 'web') {
      alertas.unshift('Este pedido não veio da loja online — confira se a nota é mesmo de varejo.');
    }

    const processado = await jaProcessado(paraGid(id));
    if (processado.notaEmitida) {
      alertas.push(`A nota deste pedido (${processado.tinyNotaId}) já foi emitida no Tiny.`);
    } else if (processado.processado) {
      alertas.push(`Este pedido já gerou o rascunho ${processado.tinyNotaId} no Tiny.`);
    } else {
      // Só para pedido sem rascunho — ver o mesmo passo em /api/pedidos/[id]/preview.
      const registro = await registrarPreview({
        orderId: pedido.id,
        orderName: pedido.name,
        classificacao: CLASSIFICACAO,
        payload,
      });
      if (!registro.ok) {
        console.error(`[varejo] Falha ao registrar o preview do pedido ${pedido.id} no Supabase:`, registro.erro);
      }
    }

    return Response.json({
      pedido: { id: pedido.id, name: pedido.name },
      classificacao: CLASSIFICACAO,
      payload,
      // O que o cliente pagou: itens − cupom + frete.
      totalNota: Number(
        (totalDaNota(payload) - descontoDaNota(payload) + Number(payload.nota_fiscal.valor_frete ?? 0)).toFixed(2)
      ),
      alertas,
      jaProcessado: processado.processado,
      notaEmitida: processado.notaEmitida ?? false,
      tinyNotaId: processado.tinyNotaId ?? null,
    });
  } catch (erro) {
    return erroJson(`Não foi possível montar a nota do pedido ${id}: ${erro.message}`);
  }
}
