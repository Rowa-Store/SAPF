// montarNota.js — transforma um pedido do Shopify no JSON que o endpoint
// nota.fiscal.incluir do Tiny espera.
//
// Esta função é pura de propósito: entra um pedido, sai um objeto. Nenhuma
// chamada de rede, nenhum process.env além da natureza da operação. Assim dá
// para testar a transformação sozinha, com exemplos/pedido-exemplo.json.

import { dataBr, separarLogradouro, somenteDigitos, valorMonetario } from '../utils.js';
import { extrairCnpj } from './classificacao.js';
import { CAMPO_DESCONTO_TINY, montarDesconto } from './desconto.js';
import { markupPadrao, valorComMarkup } from './markup.js';
import { montarPagamento } from './pagamento.js';
import { TRANSPORTE_PADRAO, quantidadeDeVolumes } from './transporte.js';

/**
 * @param {object} pedidoShopify pedido já completo (com todos os lineItems)
 * @param {"atacado"|"franquia"} classificacao
 * @param {{ volumes?: string|number, metodoPagamento?: string, desconto?: string|number, markup?: number, transporte?: object }} [opcoes]
 *   `volumes`, `metodoPagamento` e `desconto` são os metafields
 *   `volume_pedido`, `metodo_pagamento` e `desconto` do Shopify, crus — quem
 *   lê os metafields é a rota do preview. `markup` troca o markup padrão da
 *   classificação (ver markup.js). `transporte` troca o bloco de transporte
 *   padrão (Correios) — é o da transportadora anexada ao cliente, lido pela
 *   rota do preview (ver transporteDaTransportadora em transporte.js).
 * @returns {{ payload: object, alertas: string[], markup: number, precosVarejo: number[] }}
 *   `precosVarejo` é o preço do Shopify de cada item, na mesma ordem de
 *   `itens` — fica FORA do payload (o Tiny não conhece o campo) e serve para a
 *   tela recalcular os itens quando alguém troca o markup.
 */

/**
 * O checkout desta loja grava o endereço já separado em campos (rua, número,
 * complemento, bairro, cidade, UF) como customAttributes, com chaves em
 * inglês: `${prefixo}_street_name`, `_street_number`, `_street_complement`,
 * `_neighborhood`, `_city`, `_province` — confirmado direto em pedidos reais.
 * Isso é mais confiável que separar `address1` na unha, e é a única fonte de
 * bairro (o Shopify não tem esse campo estruturado; ver extrairBairro). Devolve null quando o
 * pedido não tem esses atributos (pedidos antigos, ou o outro lado do
 * endereço) — nesse caso quem chama cai para `separarLogradouro`.
 */
function enderecoDosAtributos(customAttributes, prefixo) {
  const mapa = Object.fromEntries((customAttributes ?? []).map((a) => [a.key, a.value ?? '']));
  const logradouro = mapa[`${prefixo}_street_name`];
  if (!logradouro) return null;
  return {
    logradouro,
    numero: mapa[`${prefixo}_street_number`] ?? '',
    complemento: mapa[`${prefixo}_street_complement`] ?? '',
    cidade: mapa[`${prefixo}_city`] ?? '',
    uf: mapa[`${prefixo}_province`] ?? '',
  };
}

const BAIRRO_PADRAO = 'Centro';

/**
 * Bairro do cliente, lido dos customAttributes do checkout
 * (`billing_neighborhood` / `shipping_neighborhood`). O lado do endereço que
 * a nota usa vem primeiro, e o outro serve de reserva. O checkout grava o
 * texto "null" quando o cliente não preenche (aparece assim no
 * `_full_address`), então isso e o vazio contam como sem bairro. Sem bairro,
 * volta null e quem chama usa BAIRRO_PADRAO.
 */
function extrairBairro(customAttributes, prefixos) {
  const mapa = Object.fromEntries((customAttributes ?? []).map((a) => [a.key, a.value ?? '']));
  for (const prefixo of prefixos) {
    const valor = String(mapa[`${prefixo}_neighborhood`] ?? '').trim();
    if (valor && !/^(bairro\s+)?(null|undefined)$/i.test(valor)) return valor;
  }
  return null;
}

export function montarNotaAtacado(pedidoShopify, classificacao, opcoes = {}) {
  const alertas = [];

  // O markup em uso aparece no quadro de markup da tela do rascunho, e não
  // como alerta: lá ele muda junto quando a pessoa troca o valor.
  const markup = opcoes.markup ?? markupPadrao(classificacao);
  const precosVarejo = [];

  const usaCobranca = !!pedidoShopify.billingAddress;
  const endereco = pedidoShopify.billingAddress ?? pedidoShopify.shippingAddress ?? {};
  if (!usaCobranca && pedidoShopify.shippingAddress) {
    alertas.push('Pedido sem endereço de cobrança — usando o endereço de entrega. Confira antes de emitir.');
  }

  const atributosEndereco = enderecoDosAtributos(
    pedidoShopify.customAttributes,
    usaCobranca ? 'billing' : 'shipping'
  );

  let logradouro, numero, bairro, complemento, cidade, uf;
  if (atributosEndereco) {
    ({ logradouro, numero, complemento, cidade, uf } = atributosEndereco);
    if (!numero) {
      alertas.push('Número do endereço veio em branco nos dados do checkout. Preencha o campo à mão.');
    }
  } else {
    ({ logradouro, numero } = separarLogradouro(endereco.address1));
    complemento = endereco.address2 ?? '';
    cidade = endereco.city ?? '';
    uf = endereco.provinceCode ?? '';
    if (logradouro && !numero) {
      alertas.push(`Não foi possível separar o número de "${endereco.address1}". Preencha o campo à mão.`);
    }
  }

  // O bairro não depende do resto do endereço ter vindo dos atributos: mesmo
  // quando a rua sai de address1, o bairro só existe no checkout.
  bairro = extrairBairro(
    pedidoShopify.customAttributes,
    usaCobranca ? ['billing', 'shipping'] : ['shipping', 'billing']
  );
  if (!bairro) {
    bairro = BAIRRO_PADRAO;
    alertas.push(`Bairro não informado no pedido — a nota vai com o bairro "${BAIRRO_PADRAO}".`);
  }

  const { cnpj } = extrairCnpj(pedidoShopify); // isso aqui não é aqui nao ein
  if (!cnpj) {
    alertas.push('CNPJ não localizado no pedido. A nota não pode ser criada sem ele.');
  }

  // Volumes é campo da nota, não do cadastro da transportadora — sem ele o
  // Tiny assume 1 e a etiqueta sai errada, então é melhor avisar do que deixar
  // passar batido.
  const volumes = quantidadeDeVolumes(opcoes.volumes);
  if (!volumes) {
    alertas.push(
      'Quantidade de volumes não veio do Shopify — a nota vai com 1 volume. Confira antes de despachar.'
    );
  }

  const itens = (pedidoShopify.lineItems ?? []).map((linha) => {
    if (!linha.sku) {
      alertas.push(`Item "${linha.title}" está sem SKU no Shopify.`);
    }

    const precoVarejo = Number(linha.originalUnitPriceSet?.shopMoney?.amount ?? 0);
    precosVarejo.push(precoVarejo);
    const valorUnitario = valorComMarkup(precoVarejo, markup);
    const gtin = "sem gtin";
    const sem = "SEM GTIN";
    return {
      item: {
        codigo: linha.sku ?? '',
        descricao: linha.title ?? '',
        unidade: 'UN',
        quantidade: Number(linha.quantity ?? 0),
        valor_unitario: valorMonetario(valorUnitario),
        tipo: 'P',
        // Teste: vazio no lugar de 'SEM GTIN', para ver se o Tiny emite sem
        // precisar do script do /gtin. Se não emitir, voltar para 'SEM GTIN'.
        gtin_ean:'sem gtin',
        gtin_ean_embalagem: 'sem gtin',
      },
    };
  });

  if (itens.length === 0) {
    alertas.push('Pedido sem itens. Verifique se a leitura do Shopify foi completa.');
  }

  // Forma de pagamento (e, para franquia com boleto, as 3 parcelas) — ver
  // pagamento.js. As parcelas precisam do total dos itens, por isso isto vem
  // depois de `itens`. Se a pessoa editar itens na tela do rascunho, o hook
  // recalcula os valores das parcelas antes de enviar.
  const totalItens = itens.reduce(
    (soma, { item }) => soma + Number(item.valor_unitario) * Number(item.quantidade),
    0
  );
  // Desconto em dinheiro do pedido (metafield `desconto`) — abate o total da
  // nota, por isso vem antes do pagamento: as parcelas da franquia têm que
  // somar o que o cliente realmente vai pagar, não o total cheio dos itens.
  const {
    desconto,
    valor: valorDesconto,
    alertas: alertasDesconto,
  } = montarDesconto({ desconto: opcoes.desconto, total: totalItens });
  alertas.push(...alertasDesconto);

  const { pagamento, alertas: alertasPagamento } = montarPagamento({
    classificacao,
    metodoPagamento: opcoes.metodoPagamento,
    dataBaseIso: pedidoShopify.createdAt,
    total: Math.max(0, totalItens - valorDesconto),
  });
  alertas.push(...alertasPagamento);

  // Frete: o que o cliente pagou de frete no Shopify. `valor_frete` é do mesmo
  // bloco de `valor_desconto` na nota do Tiny (ver desconto.js) e segue a mesma
  // regra: só entra quando há valor, para a nota não levar campo zerado à toa.
  const valorFrete = Number(pedidoShopify.currentShippingPriceSet?.shopMoney?.amount ?? 0);
  const frete = valorFrete > 0 ? { valor_frete: valorMonetario(valorFrete) } : {};

  const payload =
   {

    nota_fiscal: 
    {
      tipo: 'S', // S = saída
      natureza_operacao: `Venda para contribuinte`,
      frete_por_conta: 'D',
      ...frete,
      // Transporte: Correios / Sedex Contrato AG, ou a transportadora anexada
      // ao cliente — ver transporte.js.
      ...(opcoes.transporte ?? TRANSPORTE_PADRAO),
      quantidade_volumes: volumes ?? 1,
      data_emissao: dataBr(pedidoShopify.createdAt),
      numero_pedido_ecommerce: String(pedidoShopify.name ?? '').replace('#', ''),
      // valor_desconto: só aparece quando há desconto — ver desconto.js.
      ...desconto,
      // forma_pagamento só existe quando o pagamento é boleto (+ parcelas,
      // quando é franquia); nos demais casos não entra nada aqui.
      ...pagamento,
      obs: `Pedido vindo do Shopify: ${String(pedidoShopify.name ?? '').replace('#', '')}`,
      cliente: 
      {
        nome: pedidoShopify.customer?.displayName ?? endereco.company ?? '',
        tipo_pessoa: 'J', 
        cpf_cnpj: cnpj,
        // Preenchida depois pela rota do preview (ver inscricaoEstadual.js), que
        // precisa da UF já resolvida aqui e consulta Supabase/SintegrAPI.
        ie: '',
        endereco: logradouro,
        numero: numero,
        complemento: complemento,
        bairro: bairro,
        cep: somenteDigitos(endereco.zip),
        cidade: cidade,
        uf: uf,
        pais: 'BRASIL',
        atualizar_cliente: 'N',
      },

      itens,
    },
  };

  return { payload, alertas, markup, precosVarejo };
}

/** Soma dos itens da nota, para conferência visual na tela do rascunho. */
export function totalDaNota(payload) {
  const itens = payload?.nota_fiscal?.itens ?? [];
  const total = itens.reduce(
    (soma, i) => soma + Number(i.item.valor_unitario) * Number(i.item.quantidade),
    0
  );
  return Number(total.toFixed(2));
}

/** Desconto da nota como número, para a tela — campo ausente vira 0. */
export function descontoDaNota(payload) {
  return Number(payload?.nota_fiscal?.[CAMPO_DESCONTO_TINY] ?? 0) || 0;
}
