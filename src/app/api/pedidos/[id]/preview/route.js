// GET /api/pedidos/[id]/preview — monta tudo o que a tela do rascunho
// (/pedidos/[id]/rascunho) precisa. Só faz LEITURA: nada é gravado no Tiny
// aqui.

import { obterPedidoCompleto } from '@/lib/integrations/shopify';
import { classificarPedido, extrairCnpj } from '@/lib/fiscal/classificacao';
import { descontoDaNota, montarNotaAtacado, totalDaNota } from '@/lib/fiscal/montarNota';
import { resolverIe } from '@/lib/fiscal/inscricaoEstadual';
import { registrarPreview, jaProcessado, markupDaFranquia, transportadoraDoCliente, listarTransportadoras } from '@/lib/db';
import { lerMarkup, ehAcessorio, formatarMarkup, markupPadrao, MARKUP_FRANQUIA_ACESSORIO } from '@/lib/fiscal/markup';
import {
  blocoDoTransporte,
  problemaDoTransporte,
  resolverTransporte,
  transporteDaTransportadora,
} from '@/lib/fiscal/transporte';
import { erroJson, paraGid } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Totais do pedido como o admin do Shopify mostra (Subtotal, Discount,
// Shipping, Total, Paid) — só para conferência na tela, não entram na nota.
// O admin embute no Subtotal o desconto dado item a item (R$ X na peça) e só
// lista em Discount o desconto do pedido inteiro (o "carrinho"). O
// currentSubtotalPriceSet da API já vem com os dois descontados, então o
// subtotal do admin é ele mais o desconto do carrinho.
function resumoDoShopify(pedido) {
  const valor = (set) => Number(set?.shopMoney?.amount ?? 0);
  const total = valor(pedido.currentTotalPriceSet);
  const frete = valor(pedido.currentShippingPriceSet);
  const desconto = valor(pedido.currentCartDiscountAmountSet);
  const impostos = valor(pedido.currentTotalTaxSet);
  // Só os descontos do pedido inteiro — os de item já estão no subtotal.
  // Sem repetir: cada desconto manual vem com o mesmo título.
  const nomesDesconto = [
    ...new Set(
      (pedido.discountApplications?.nodes ?? [])
        .filter((d) => d.targetSelection === 'ALL')
        .map((d) => d.title || d.code)
        .filter(Boolean)
    ),
  ];
  return {
    quantidadeItens: pedido.currentSubtotalLineItemsQuantity ?? 0,
    subtotal: valor(pedido.currentSubtotalPriceSet) + desconto,
    desconto,
    descricaoDesconto: nomesDesconto.join(', '),
    frete,
    formaFrete: pedido.shippingLine?.title ?? '',
    // totalWeight vem em gramas, como string.
    pesoKg: Number(pedido.totalWeight ?? 0) / 1000,
    impostos,
    total,
    pago: valor(pedido.totalReceivedSet),
  };
}
export const runtime = 'nodejs';

export async function GET(request, { params }) {

  const { id } = await params;

  try {
    // 1. Pedido completo — a leitura pagina até o fim; item faltando é erro grave.
    const pedido = await obterPedidoCompleto(id);
    const classificacao = await classificarPedido(pedido);
    const { cnpj, origem } = extrairCnpj(pedido);

    const alertas = [];
    if (classificacao === 'outro') {
      alertas.push(
        'Este pedido não foi identificado como atacado nem franquia (nenhum CNPJ encontrado). ' +
          'Confira o cadastro no Shopify antes de continuar.'
      );
    }

    // 2. Metafields do pedido — lidos antes da nota porque a quantidade de
    // volumes vai dentro dela (bloco de transporte).
    async function fetchOrderMetafields(orderId) {
      const STORE = process.env.SHOPIFY_STORE_DOMAIN;
      const TOKEN = process.env.SHOPIFY_API_TOKEN;

      const res = await fetch(
        `https://${STORE}/admin/api/2026-07/orders/${orderId}/metafields.json`,
        {
          headers: { "X-Shopify-Access-Token": TOKEN || "" },
          cache: "no-store",
        },
      );

      if (!res.ok) return [];
      const data = await res.json();
      return data.metafields ?? [];
    }

    const metafields = await fetchOrderMetafields(id);
    const noteAttributes = pedido.noteAttributes ?? [];

    // A chave é comparada sem diferenciar maiúsculas: o metafield (e o
    // atributo do pedido) é cadastrado à mão no Shopify, então a grafia varia.
    // Com a busca exata, uma chave escrita de outro jeito não casava e o valor
    // chegava vazio aqui — a nota ia sem forma de pagamento mesmo com boleto.
    const getMetafield = (key) => {
      const alvo = key.toLowerCase();
      return (
        metafields.find(
          (m) => m.namespace?.toLowerCase() === "custom" && m.key?.toLowerCase() === alvo,
        )?.value ??
        noteAttributes.find((attr) => attr.key?.toLowerCase() === alvo)?.value ??
        ""
      );
    };

    const metodoPagamento = getMetafield("metodo_pagamento") || "Não informado";
    const volumePedido = getMetafield("volume_pedido") || "Não informado";
    // Texto livre ("1200,45", "1.200,45", "R$ 1200.00") — quem converte para
    // número é desconto.js; aqui o valor segue cru, como os outros metafields.
    const descontoPedido = getMetafield("desconto");
    // "correios", "retirada" ou o nome (ou parte dele) de uma transportadora
    // do cadastro — ver resolverTransporte em transporte.js.
    const transporteInformado = getMetafield("transportadora");

    // 3. Franquia: o markup é decidido item a item (ver markup.js).
    // Acessório sai com 2,0; vestuário com o markup próprio do cadastro
    // (cnpjs_franquia.markup) ou, sem ele, o padrão de franquia. Pedido só de
    // acessório sai com 2,0 direto; pedido que mistura os dois sai com markup
    // híbrido, sem mexer no valor do vestuário.
    let markupFranquia;
    let markupOrigem = 'classificacao';
    if (classificacao === 'franquia') {
      const itensAcessorio = pedido.lineItems.filter((l) => ehAcessorio(l.product?.productType));
      const temVestuario = itensAcessorio.length < pedido.lineItems.length;

      const semTipo = pedido.lineItems.filter((l) => !String(l.product?.productType ?? '').trim());
      if (semTipo.length > 0) {
        const nomes = semTipo.map((l) => `"${l.title}"`).join(', ');
        alertas.push(
          `${semTipo.length === 1 ? 'O item' : 'Os itens'} ${nomes} ${semTipo.length === 1 ? 'está' : 'estão'} ` +
            'sem tipo de produto no Shopify — tratado como vestuário. Se for acessório, ajuste o valor ' +
            `(markup ${formatarMarkup(MARKUP_FRANQUIA_ACESSORIO)}).`
        );
      }

      let markupVestuario;
      if (temVestuario) {
        const resp = await markupDaFranquia(cnpj);
        if (!resp.ok) {
          console.error(`[preview] Falha ao buscar o markup da franquia ${cnpj} no Supabase:`, resp.erro);
          alertas.push(
            'Não foi possível ler o markup desta franquia no cadastro — o vestuário saiu com o markup padrão de franquia. ' +
              'Confira antes de continuar.'
          );
        }
        markupVestuario = lerMarkup(resp.markup) ?? undefined;
        if (markupVestuario !== undefined) markupOrigem = 'franquia';
      }

      if (itensAcessorio.length > 0 && !temVestuario) {
        markupFranquia = MARKUP_FRANQUIA_ACESSORIO;
        markupOrigem = 'acessorio';
      } else if (itensAcessorio.length > 0) {
        markupFranquia = {
          acessorio: MARKUP_FRANQUIA_ACESSORIO,
          vestuario: markupVestuario ?? markupPadrao('franquia'),
        };
        markupOrigem = markupVestuario !== undefined ? 'hibrido_franquia' : 'hibrido';
      } else {
        markupFranquia = markupVestuario;
      }
    }

    // 3b. Transporte. O metafield `transportadora` do pedido manda: Correios,
    // retirada (forma de envio Transportadora, sem transportador) ou uma transportadora do
    // cadastro. Transportadora que não está no cadastro BLOQUEIA a criação —
    // a nota não pode sair com um transporte que ninguém pediu.
    //
    // Metafield em branco: cliente anexado a uma transportadora
    // (/pedidos/transportadoras) sai com o transporte dela; sem anexo, a nota
    // fica com os Correios. Falha na consulta também cai nos Correios, mas
    // avisa — a pessoa pode estar esperando a transportadora.
    //
    // Metafield "transportadora" sem nome (ou variações — ver
    // resolverTransporte): também vale a anexada ao cliente, mas aqui o
    // pedido pediu transportadora, então sem anexo (ou anexo inativo, ou
    // falha na consulta) a criação fica BLOQUEADA em vez de cair nos Correios.
    let transporte;
    let transportadora = null;
    let transporteResolvido = { tipo: 'vazio', texto: '' };
    let transporteBloqueado = null;
    if (transporteInformado.trim()) {
      const cadastroTransp = await listarTransportadoras();
      if (!cadastroTransp.ok) {
        transporteBloqueado =
          `Não foi possível ler o cadastro de transportadoras para conferir "${transporteInformado}" ` +
          `(metafield transportadora): ${cadastroTransp.erro}`;
      } else {
        transporteResolvido = resolverTransporte(transporteInformado, cadastroTransp.transportadoras);
        transporteBloqueado = problemaDoTransporte(transporteResolvido);
        transporte = blocoDoTransporte(transporteResolvido);
        if (transporteResolvido.transportadora) {
          transportadora = { id: transporteResolvido.transportadora.id, nome: transporteResolvido.transportadora.nome };
        }
      }
      if (transporteBloqueado) alertas.push(transporteBloqueado);
    }
    const pedeDoCliente = transporteResolvido.tipo === 'do_cliente';
    if ((transporteResolvido.tipo === 'vazio' && !transporteInformado.trim()) || pedeDoCliente) {
      const resp = cnpj ? await transportadoraDoCliente(cnpj) : { ok: true, transportadora: null };
      if (!resp.ok) {
        console.error(`[preview] Falha ao buscar a transportadora do cliente ${cnpj} no Supabase:`, resp.erro);
        if (pedeDoCliente) {
          transporteBloqueado =
            `O pedido pede "${transporteInformado}" (metafield transportadora), mas não foi possível ler ` +
            `a transportadora anexada a este cliente: ${resp.erro}`;
          alertas.push(transporteBloqueado);
        } else {
          alertas.push(
            'Não foi possível ler a transportadora deste cliente no cadastro — a nota saiu com os Correios. ' +
              'Confira antes de continuar.'
          );
        }
      } else if (resp.transportadora && !resp.transportadora.ativo) {
        if (pedeDoCliente) {
          transporteBloqueado =
            `O pedido pede "${transporteInformado}" (metafield transportadora) e o cliente está anexado à ` +
            `transportadora ${resp.transportadora.nome}, mas ela está inativa. Reative ou escolha outra.`;
          alertas.push(transporteBloqueado);
        } else {
          alertas.push(
            `O cliente está anexado à transportadora ${resp.transportadora.nome}, mas ela está inativa — ` +
              'a nota saiu com os Correios.'
          );
        }
      } else if (resp.transportadora) {
        transportadora = { id: resp.transportadora.id, nome: resp.transportadora.nome };
        transporte = transporteDaTransportadora(resp.transportadora);
      } else if (pedeDoCliente) {
        transporteBloqueado =
          `O pedido pede "${transporteInformado}" (metafield transportadora) sem dizer qual, e o cliente ` +
          `${cnpj ? 'não está anexado a nenhuma transportadora' : 'está sem CNPJ'}. Anexe o cliente em ` +
          '/pedidos/transportadoras, escreva o nome da transportadora no Shopify ou troque nesta tela.';
        alertas.push(transporteBloqueado);
      }
    }

    // 4. Nota montada a partir do pedido.
    const { payload, alertas: alertasNota, markup, precosVarejo, acessorios } = montarNotaAtacado(pedido, classificacao, {
      volumes: volumePedido,
      metodoPagamento: metodoPagamento,
      desconto: descontoPedido,
      markup: markupFranquia,
      transporte,
    });
    alertas.push(...alertasNota);

    // 4b. IE do cliente: cache no Supabase e, se não tiver, SintegrAPI (que
    // grava no cache). Depois da nota porque a consulta usa a UF dela.
    const clienteNota = payload.nota_fiscal.cliente;
    const { ie, alertas: alertasIe } = await resolverIe({ cnpj, uf: clienteNota.uf });
    clienteNota.ie = ie;
    alertas.push(...alertasIe);

    // 5. Já existe rascunho para este pedido?
    const processado = await jaProcessado(paraGid(id));
    if (processado.notaEmitida) {
      alertas.push(`A nota deste pedido (${processado.tinyNotaId}) já foi emitida no Tiny.`);
    } else if (processado.processado) {
      alertas.push(
        `Este pedido já gerou o rascunho ${processado.tinyNotaId} no Tiny. ` +
          'Enviar de novo cria um rascunho novo no lugar dele — o antigo precisa ser removido à mão no Tiny.'
      );
    }

    // 6. Histórico (não bloqueia se o Supabase não estiver configurado). Só
    // para pedido sem rascunho: gravar por cima de um já enviado trocava o
    // status para "preview" — a lista perdia o DANFE, a emissão recusava o
    // pedido — e o payload que foi para o Tiny pelo recalculado.
    if (!processado.processado && !processado.notaEmitida) {
      const registro = await registrarPreview({
        orderId: pedido.id,
        orderName: pedido.name,
        classificacao,
        payload,
      });
      if (!registro.ok) {
        console.error(`[preview] Falha ao registrar o preview do pedido ${pedido.id} no Supabase:`, registro.erro);
      }
    }

    return Response.json({
      pedido: {
        id: pedido.id,
        name: pedido.name,
        createdAt: pedido.createdAt,
        note: pedido.note,
        cliente: pedido.customer,
        billingAddress: pedido.billingAddress,
        shippingAddress: pedido.shippingAddress,
        descontos: pedido.discountApplications?.nodes ?? [],
        itens: pedido.lineItems,
        totalItens: pedido.lineItems.length,
        paginasLidas: pedido.paginasLidas,
        valorFrete: Number(pedido.currentShippingPriceSet?.shopMoney?.amount ?? 0),
        cnpj,
        origemCnpj: origem,
        metodoPagamento: metodoPagamento,
        volumePedido: volumePedido,
        // O que a tela mostra é o desconto que entrou na nota, não o texto cru.
        valorDesconto: descontoDaNota(payload),
        resumoShopify: resumoDoShopify(pedido),
      },
      classificacao,
      payload,
      // Markup padrão (da franquia, se ela tem um cadastrado, ou da
      // classificação; híbrido quando a franquia mistura acessório e
      // vestuário), o preço do Shopify de cada item e se ele é acessório (na
      // ordem de payload.nota_fiscal.itens) — a tela usa os três para
      // recalcular a nota quando alguém troca o markup (ver markup.js).
      markup,
      // De onde veio o markup padrão: 'franquia' (cnpjs_franquia.markup),
      // 'acessorio' (franquia só com acessórios), 'hibrido' / 'hibrido_franquia'
      // (acessórios + vestuário com o padrão de franquia / com o do cadastro)
      // ou 'classificacao' — a tela usa para dizer de quem é o padrão.
      markupOrigem,
      precosVarejo,
      acessorios,
      // Transportadora que entrou na nota (do metafield ou anexada ao
      // cliente); null = Correios ou retirada.
      transportadora,
      // O que o metafield `transportadora` pediu e como foi lido.
      transporteInformado: {
        texto: transporteResolvido.texto,
        tipo: transporteResolvido.tipo,
        candidatas: (transporteResolvido.candidatas ?? []).map((t) => t.nome),
      },
      // Mensagem que impede criar a nota (transporte não cadastrado,
      // ambíguo, inativo, "transportadora" sem anexo no cliente ou cadastro
      // ilegível); null = pode criar.
      transporteBloqueado,
      totalNota: totalDaNota(payload),
      alertas,
      jaProcessado: processado.processado,
      notaEmitida: processado.notaEmitida ?? false,
      tinyNotaId: processado.tinyNotaId ?? null,
    });
  } catch (erro) {
    return erroJson(`Não foi possível montar o preview do pedido ${id}: ${erro.message}`);
  }
}
