// GET /api/transferencias — transferências de estoque entre lojas (Shopify)
// com a situação fiscal de cada uma (Supabase). Rascunhos do Shopify ficam de
// fora.
//
// Como a tela de atacado: sem busca, a lista é POR DIA (fuso de São Paulo,
// ver lib/datas.js) e a tela navega dia a dia. Com busca, o resultado não se
// prende a dia nenhum.
//
//   ?dia=    AAAA-MM-DD; sem ele, hoje
//   ?busca=  termos separados por vírgula — basta um bater: nome ou referência
//            da transferência, loja de origem ou de destino, ou nº da NF

import { listarTransferencias } from '@/lib/integrations/shopifyTransferencias';
import { statusPorPedido } from '@/lib/db';
import { bloqueioDaTransferencia } from '@/lib/fiscal/travaTransferencia';
import { diaValido, hoje, intervaloDoDia } from '@/lib/datas';
import { erroJson, idNumerico } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** A transferência bate com o termo da busca (já em minúsculas)? */
function bateComTermo(t, termo) {
  const textos = [t.name, t.referencia, t.origem, t.destino].map((v) => String(v ?? '').toLowerCase());
  if (textos.some((v) => v.includes(termo))) return true;
  // Termo só de dígitos também procura no nº da NF.
  return /^\d+$/.test(termo) && String(t.numeroNf ?? '').replace(/\D+/g, '').includes(termo);
}

export async function GET(request) {
  const busca = new URL(request.url).searchParams;
  const termos = (busca.get('busca') ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const diaDeHoje = hoje();
  const dia = termos.length === 0 ? busca.get('dia') || diaDeHoje : null;
  if (dia && (!diaValido(dia) || dia > diaDeHoje)) {
    return erroJson(`Dia inválido: "${dia}". Use AAAA-MM-DD, até hoje.`, 400);
  }

  try {
    // A situação fiscal de cada página já é pedida ao Supabase assim que a
    // página chega, em paralelo com a leitura da seguinte.
    const consultasSituacao = [];
    const { transferencias, truncado } = await listarTransferencias(
      { periodo: dia ? intervaloDoDia(dia) : null },
      {
        aoReceberPagina: (nodes) => {
          const consulta = statusPorPedido(nodes.map((t) => t.id));
          // Se o Shopify falhar numa página seguinte, ninguém chega a
          // esperar esta consulta — sem o catch, a falha dela ficaria solta.
          consulta.catch(() => {});
          consultasSituacao.push(consulta);
        },
      }
    );
    if (truncado) console.error(`[transferencias] Lista passou do limite de páginas — cortada (dia ${dia ?? '—'}).`);

    const situacoes = Object.assign({}, ...(await Promise.all(consultasSituacao)));

    const lista = transferencias
      .map((t) => {
        const situacao = situacoes[t.id];
        return {
          id: idNumerico(t.id),
          gid: t.id,
          name: t.name,
          referencia: t.referenceName,
          data: t.dateCreated,
          status: t.status,
          origem: t.origin?.name ?? '—',
          // Motivo de a transferência não poder ter nota (CD 1 <-> CD 2), ou null.
          bloqueio: bloqueioDaTransferencia(t.origin?.name, t.destination?.name),
          destino: t.destination?.name ?? '—',
          quantidadeTotal: t.totalQuantity,
          quantidadeRecebida: t.receivedQuantity,
          situacaoFiscal: situacao?.status ?? null,
          tinyNotaId: situacao?.tiny_nota_id ?? null,
          notaEmitida: situacao?.nota_emitida ?? false,
          numeroNf: situacao?.numero_nf ?? null,
          tinyNotasSubstituidas: situacao?.tiny_notas_substituidas ?? [],
          // Último erro de rascunho/emissão, para o "Ver erro" da linha.
          erro: situacao?.erro ?? null,
          erroEm: situacao?.erro ? situacao.atualizado_em : null,
        };
      })
      .filter((t) => termos.length === 0 || termos.some((termo) => bateComTermo(t, termo)));

    return Response.json({
      transferencias: lista,
      // null numa busca. `completo: false` = passou do limite de páginas do
      // Shopify e a lista veio cortada.
      dia,
      completo: !truncado,
      hoje: diaDeHoje,
    });
  } catch (erro) {
    return erroJson(`Não foi possível listar as transferências: ${erro.message}`);
  }
}
