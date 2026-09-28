// GET /api/transferencias — transferências de estoque entre lojas (Shopify)
// com a situação fiscal de cada uma (Supabase).
//
// Filtros aceitos na URL: origem, destino, excluir (gid do local), de, ate
// (AAAA-MM-DD), rascunhos=1 (inclui transferências em rascunho no Shopify),
// naoEmitidas=1, nf (número da nota) e nome (nome ou referência da
// transferência, sem diferenciar maiúsculas). nf e nome aceitam vários termos
// separados por vírgula — basta um deles bater. Origem, destino, datas e rascunhos vão
// direto para a busca do Shopify; o resto depende do Supabase e é filtrado aqui.
// origemNome (sem origem) procura a loja de origem pelo nome — é como a tela
// abre já filtrada no CD; o gid encontrado volta em `origemId`.

import { listarLocais, listarTransferencias } from '@/lib/integrations/shopifyTransferencias';
import { statusPorPedido } from '@/lib/db';
import { erroJson, idNumerico } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** "Rowa Centro de Distribuição 1" -> "rowacentrodedistribuicao1", para comparar nomes de loja sem ligar para caixa, acento e pontuação. */
function chaveNome(nome) {
  return String(nome ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** "a, b ,c" -> ['a', 'b', 'c'], já normalizados; termos vazios são descartados. */
function termos(valor, normalizar) {
  return (valor ?? '').split(',').map(normalizar).filter(Boolean);
}

export async function GET(request) {
  const busca = new URL(request.url).searchParams;
  const dataInicial = busca.get('de') || null;
  const dataFinal = busca.get('ate') || null;
  if ((dataInicial && !DATA.test(dataInicial)) || (dataFinal && !DATA.test(dataFinal))) {
    return erroJson('Datas devem vir no formato AAAA-MM-DD.', 400);
  }

  try {
    let origemId = busca.get('origem') || null;
    let locaisProntos = null;
    const origemNome = chaveNome(busca.get('origemNome'));
    if (!origemId && origemNome) {
      locaisProntos = await listarLocais();
      origemId = locaisProntos.find((l) => chaveNome(l.name) === origemNome)?.id ?? null;
    }

    const [{ transferencias, truncado }, locais] = await Promise.all([
      listarTransferencias({
        origemId,
        destinoId: busca.get('destino') || null,
        dataInicial,
        dataFinal,
        mostrarRascunhos: busca.get('rascunhos') === '1',
      }),
      locaisProntos ?? listarLocais(),
    ]);

    const situacoes = await statusPorPedido(transferencias.map((t) => t.id));

    const excluir = busca.get('excluir');
    const naoEmitidas = busca.get('naoEmitidas') === '1';
    const nfs = termos(busca.get('nf'), (v) => v.replace(/\D+/g, ''));
    const nomes = termos(busca.get('nome'), (v) => v.trim().toLowerCase());

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
      .filter((t) => {
        if (!nfs.length) return true;
        const numero = String(t.numeroNf ?? '').replace(/\D+/g, '');
        return nfs.some((nf) => numero.includes(nf));
      })
      .filter((t) => {
        if (!nomes.length) return true;
        const campos = [t.name, t.referencia].map((v) => String(v ?? '').toLowerCase());
        return nomes.some((nome) => campos.some((c) => c.includes(nome)));
      });

    return Response.json({
      transferencias: lista,
      locais: locais.map((l) => ({ id: l.id, nome: l.name, ativo: l.isActive })),
      truncado,
      origemId,
    });
  } catch (erro) {
    return erroJson(`Não foi possível listar as transferências: ${erro.message}`);
  }
}
