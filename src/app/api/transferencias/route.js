// GET /api/transferencias — transferências de estoque entre lojas (Shopify)
// com a situação fiscal de cada uma (Supabase).
//
// Filtros aceitos na URL: origem, destino, excluir (gid do local), de, ate
// (AAAA-MM-DD), rascunhos=1 (inclui transferências em rascunho no Shopify),
// naoEmitidas=1, nf (número da nota) e nome (nome ou referência da
// transferência, sem diferenciar maiúsculas). Origem, destino, datas e rascunhos vão
// direto para a busca do Shopify; o resto depende do Supabase e é filtrado aqui.

import { listarLocais, listarTransferencias } from '@/lib/integrations/shopifyTransferencias';
import { statusPorPedido } from '@/lib/db';
import { erroJson, idNumerico } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request) {
  const busca = new URL(request.url).searchParams;
  const dataInicial = busca.get('de') || null;
  const dataFinal = busca.get('ate') || null;
  if ((dataInicial && !DATA.test(dataInicial)) || (dataFinal && !DATA.test(dataFinal))) {
    return erroJson('Datas devem vir no formato AAAA-MM-DD.', 400);
  }

  try {
    const [{ transferencias, truncado }, locais] = await Promise.all([
      listarTransferencias({
        origemId: busca.get('origem') || null,
        destinoId: busca.get('destino') || null,
        dataInicial,
        dataFinal,
        mostrarRascunhos: busca.get('rascunhos') === '1',
      }),
      listarLocais(),
    ]);

    const situacoes = await statusPorPedido(transferencias.map((t) => t.id));

    const excluir = busca.get('excluir');
    const naoEmitidas = busca.get('naoEmitidas') === '1';
    const nf = (busca.get('nf') ?? '').replace(/\D+/g, '');
    const nome = (busca.get('nome') ?? '').trim().toLowerCase();

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
          origemId: t.origin?.location?.id ?? null,
          destino: t.destination?.name ?? '—',
          destinoId: t.destination?.location?.id ?? null,
          quantidadeTotal: t.totalQuantity,
          quantidadeRecebida: t.receivedQuantity,
          situacaoFiscal: situacao?.status ?? null,
          tinyNotaId: situacao?.tiny_nota_id ?? null,
          notaEmitida: situacao?.nota_emitida ?? false,
          numeroNf: situacao?.numero_nf ?? null,
          tinyNotasSubstituidas: situacao?.tiny_notas_substituidas ?? [],
        };
      })
      .filter((t) => !excluir || (t.origemId !== excluir && t.destinoId !== excluir))
      .filter((t) => !naoEmitidas || !t.notaEmitida)
      .filter((t) => !nf || String(t.numeroNf ?? '').replace(/\D+/g, '').includes(nf))
      .filter((t) => !nome || [t.name, t.referencia].some((v) => String(v ?? '').toLowerCase().includes(nome)));

    return Response.json({
      transferencias: lista,
      locais: locais.map((l) => ({ id: l.id, nome: l.name, ativo: l.isActive })),
      truncado,
    });
  } catch (erro) {
    return erroJson(`Não foi possível listar as transferências: ${erro.message}`);
  }
}
