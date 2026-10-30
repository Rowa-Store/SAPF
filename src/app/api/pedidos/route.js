// GET /api/pedidos — os pedidos da tela de atacado, já classificados e com a
// situação fiscal de cada um (rascunho, emissão, nº da NF).
//
// Sem busca, a lista é POR DIA: todos os pedidos de um dia (fuso de São
// Paulo, ver lib/datas.js), e a tela navega para trás dia a dia. Com busca,
// o resultado não se prende a dia nenhum e vem paginado por cursor.
//
//   ?dia=     AAAA-MM-DD; sem ele, hoje
//   ?busca=   termos separados por vírgula: nº do pedido, cliente, nº da NF ou CNPJ
//   ?cursor=  só com busca: página seguinte (o `endCursor` da resposta anterior)

import { listarPedidosDoDia, listarPedidosRecentes, tiposDosItens } from '@/lib/integrations/shopify';
import { diaValido, hoje, intervaloDoDia } from '@/lib/datas';
import { classificarComListaFranquia, extrairCnpj } from '@/lib/fiscal/classificacao';
import { ehAcessorio } from '@/lib/fiscal/markup';
import { ehMeiaNota } from '@/lib/fiscal/desconto';
import { statusPorPedido, listarCnpjsFranquia, pedidosPorNfOuCnpj, listarTransportadoras } from '@/lib/db';
import { problemaDoTransporte, resolverTransporte } from '@/lib/fiscal/transporte';
import { ITENS_POR_PAGINA } from '@/lib/constants';
import { idNumerico, erroJson, somenteDigitos } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const busca = new URL(request.url).searchParams;
    const cursor = busca.get('cursor') || null;
    const termos = (busca.get('busca') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const diaDeHoje = hoje();
    const dia = termos.length === 0 ? busca.get('dia') || diaDeHoje : null;
    if (dia && (!diaValido(dia) || dia > diaDeHoje)) {
      return erroJson(`Dia inválido: "${dia}". Use AAAA-MM-DD, até hoje.`, 400);
    }

    // A lista do dia traz só pedidos daquele dia — rascunho pendente de outro
    // dia se acha navegando até o dia dele ou pela busca.

    // Franquias não dependem do Shopify: saem já, em paralelo com a busca,
    // em vez de esperar os pedidos voltarem.
    const cnpjsFranquiaPromessa = listarCnpjsFranquia();

    // Nº da NF e CNPJ não são pesquisáveis no Shopify: o Supabase os traduz
    // para o nº do pedido antes. CNPJ sai dos termos de texto (o Shopify não
    // acharia) e o resto segue como está.
    const ehCnpj = (t) => somenteDigitos(t).length === 14;
    const nomes = await pedidosPorNfOuCnpj({
      numerosNf: termos.filter((t) => /^\d+$/.test(t) && !ehCnpj(t)),
      cnpjs: termos.filter(ehCnpj).map(somenteDigitos),
    });
    const termosShopify = termos.filter((t) => !ehCnpj(t));
    if (termos.length > 0 && termosShopify.length === 0 && nomes.length === 0) {
      return Response.json({ pedidos: [], proximoCursor: null, dia: null, hoje: diaDeHoje });
    }

    let pedidos;
    let proximoCursor = null;
    let diaCompleto = true;
    if (dia) {
      ({ pedidos, completo: diaCompleto } = await listarPedidosDoDia({
        periodo: intervaloDoDia(dia),
        limitePorPagina: ITENS_POR_PAGINA,
      }));
      if (!diaCompleto) console.error(`[pedidos] Dia ${dia} passou do limite de páginas — lista cortada.`);
    } else {
      const pagina = await listarPedidosRecentes({
        limite: ITENS_POR_PAGINA,
        cursor,
        termos: termosShopify,
        nomes,
      });
      pedidos = pagina.pedidos;
      proximoCursor = pagina.pageInfo.hasNextPage ? pagina.pageInfo.endCursor : null;
    }
    const [situacoes, cnpjsFranquiaResp] = await Promise.all([
      statusPorPedido(pedidos.map((p) => p.id)),
      cnpjsFranquiaPromessa,
    ]);
    if (!cnpjsFranquiaResp.ok) {
      console.error('[pedidos] Falha ao buscar cnpjs_franquia no Supabase, classificando sem a lista de franquia:', cnpjsFranquiaResp.erro);
    }
    const cnpjsFranquia = cnpjsFranquiaResp.ok ? cnpjsFranquiaResp.cnpjs : [];

    // Transportadora pedida no metafield de cada pedido, conferida contra o
    // cadastro — só lê o cadastro se algum pedido da página informou uma.
    let transportadoras = null;
    if (pedidos.some((p) => String(p.transporteInformado ?? '').trim())) {
      const resp = await listarTransportadoras();
      if (resp.ok) transportadoras = resp.transportadoras;
      else console.error('[pedidos] Falha ao ler o cadastro de transportadoras:', resp.erro);
    }
    const transporteDoPedido = (texto) => {
      if (!String(texto ?? '').trim() || !transportadoras) return null;
      const resolvido = resolverTransporte(texto, transportadoras);
      return {
        texto: resolvido.texto,
        tipo: resolvido.tipo,
        nome: resolvido.transportadora?.nome ?? null,
        problema: problemaDoTransporte(resolvido),
      };
    };

    const classificacoes = Object.fromEntries(
      pedidos.map((p) => [p.id, classificarComListaFranquia(p._bruto, cnpjsFranquia)])
    );

    // Franquia que comprou acessório em QUALQUER item ganha a marca de
    // acessórios (ver markup.js) — a lista do Shopify só traz o primeiro item,
    // então os tipos dos demais vêm numa consulta à parte, só das franquias.
    // Se ela falhar, a marca cai para o primeiro item.
    let tiposPorPedido = {};
    const idsFranquia = pedidos.filter((p) => classificacoes[p.id] === 'franquia').map((p) => p.id);
    if (idsFranquia.length > 0) {
      try {
        tiposPorPedido = await tiposDosItens(idsFranquia);
      } catch (erro) {
        console.error('[pedidos] Falha ao ler os tipos dos itens das franquias, marcando pelo primeiro item:', erro);
      }
    }
    const temAcessorio = (p) =>
      (tiposPorPedido[p.id] ?? [p._bruto.primeiroItem?.nodes?.[0]?.product?.productType]).some(ehAcessorio);

    const lista = pedidos.map((p) => {
      const { cnpj, origem } = extrairCnpj(p._bruto);
      const situacao = situacoes[p.id];
      const classificacao = classificacoes[p.id];
      return {
        id: idNumerico(p.id),
        gid: p.id,
        name: p.name,
        createdAt: p.createdAt,
        cliente: p.cliente,
        total: p.total,
        tags: p.tags,
        // null = metafield em branco (vale a regra antiga) ou cadastro ilegível.
        transporte: transporteDoPedido(p.transporteInformado),
        classificacao,
        // Franquia com acessório em algum item: esses itens saem com markup
        // 2,0 (ver markup.js) — a lista marca esses pedidos.
        acessorio: classificacao === 'franquia' && temAcessorio(p),
        // Cliente que sai com meia nota (ver desconto.js).
        meiaNota: ehMeiaNota(cnpj),
        cnpj: cnpj,
        origemCnpj: origem,
        status: situacao?.status ?? null,
        tinyNotaId: situacao?.tiny_nota_id ?? null,
        notaEmitida: situacao?.nota_emitida ?? false,
        numeroNf: situacao?.numero_nf ?? null,
        tinyNotasSubstituidas: situacao?.tiny_notas_substituidas ?? [],
        // Último erro de rascunho/emissão, para o "Ver erro" da linha.
        erro: situacao?.erro ?? null,
        erroEm: situacao?.erro ? situacao.atualizado_em : null,
      };
    });

    return Response.json({
      pedidos: lista,
      proximoCursor,
      // null numa busca. `diaCompleto: false` = o dia tinha pedidos demais e
      // a lista veio cortada.
      dia,
      diaCompleto,
      hoje: diaDeHoje,
    });
  } catch (erro) {
    return erroJson(`Não foi possível listar os pedidos: ${erro.message}`);
  }
}
