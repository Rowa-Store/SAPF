// montarNotaTransferencia.js — transforma uma transferência de estoque do
// Shopify no JSON do nota.fiscal.incluir do Tiny.
//
// Mesma ideia de montarNota.js: função pura, entra transferência + cadastro
// fiscal da loja de destino, sai { payload, alertas }. Quem busca os dados é a
// rota do preview.
//
// Diferenças para a nota de atacado:
//   - O destinatário é a LOJA de destino, não um cliente. O Shopify não guarda
//     CNPJ/IE de local, então esses dados vêm da tabela `lojas_fiscais` do
//     Supabase (ver schema.sql), chaveada pelo id do local no Shopify.
//   - Valor do item, natureza de operação e desconto dependem da loja de
//     DESTINO, e vêm do cadastro dela em `lojas_fiscais`:
//       · `base_valor`: 'custo' (padrão, `unitCost` do inventoryItem) ou
//         'venda' (preço da variante). Custo em branco cai no preço de venda,
//         com aviso.
//       · `desconto_percentual`: % abatido do valor unitário de cada item
//         (0 = sem desconto).
//       · `natureza_operacao`: nome da natureza no Tiny, de onde sai o CFOP.
//         Tem que ser IGUAL ao cadastro de naturezas da conta: um nome que não
//         existe lá é trocado em silêncio pela natureza padrão ("Venda para
//         contribuinte"). Em branco, a nota não é criada.
//       · `natureza_operacao_id`: id da natureza no Tiny. É ele que vai na
//         nota (`id_natureza_operacao`) — o Tiny ignorou o nome mesmo idêntico
//         ao cadastro. O nome continua indo junto e é o que a emissão confere.
//         Sem id, o rascunho não é criado.
//   - Sem frete, sem transportadora, sem pagamento, sem desconto no rodapé.

import { dataBr, separarLogradouro, somenteDigitos, valorMonetario } from '../utils.js';

/** `frete_por_conta` "S" = sem ocorrência de transporte (a própria empresa leva). */
const SEM_FRETE = 'S';

function enderecoDestino(loja, snapshot) {
  // Endereço cadastrado no Supabase ganha — é o único com bairro e com número
  // separado. O snapshot do Shopify é o plano B.
  if (loja?.logradouro) {
    return {
      endereco: loja.logradouro,
      numero: loja.numero ?? '',
      complemento: loja.complemento ?? '',
      bairro: loja.bairro ?? '',
      cep: somenteDigitos(loja.cep),
      cidade: loja.cidade ?? '',
      uf: loja.uf ?? '',
    };
  }
  const endereco = snapshot?.address ?? {};
  const { logradouro, numero } = separarLogradouro(endereco.address1);
  return {
    endereco: logradouro,
    numero,
    complemento: endereco.address2 ?? '',
    bairro: '',
    cep: somenteDigitos(endereco.zip),
    cidade: endereco.city ?? '',
    uf: endereco.provinceCode ?? '',
  };
}

/**
 * @param {object} transferencia transferência completa (com todos os lineItems)
 * @param {{ origem: object|null, destino: object|null }} lojas linhas de `lojas_fiscais`
 * @returns {{ payload: object, alertas: string[] }}
 */
export function montarNotaTransferencia(transferencia, lojas = {}) {
  const alertas = [];
  const { origem, destino } = lojas;
  const nomeOrigem = transferencia.origin?.name ?? 'origem desconhecida';
  const nomeDestino = transferencia.destination?.name ?? 'destino desconhecido';

  if (!destino) {
    alertas.push(
      `A loja de destino "${nomeDestino}" não está cadastrada em lojas_fiscais no Supabase — ` +
        'a nota não tem CNPJ nem IE do destinatário. Cadastre a loja antes de criar o rascunho.'
    );
  } else {
    if (somenteDigitos(destino.cnpj).length !== 14) {
      alertas.push(`CNPJ da loja de destino "${nomeDestino}" inválido no cadastro (lojas_fiscais).`);
    }
    if (!destino.ie) alertas.push(`Loja de destino "${nomeDestino}" sem inscrição estadual no cadastro.`);
  }

  if (!origem) {
    alertas.push(
      `A loja de origem "${nomeOrigem}" não está cadastrada em lojas_fiscais. A nota sai com o CNPJ ` +
        'da conta do Tiny como emitente — confira se é mesmo o da loja de origem.'
    );
  }

  if (origem && destino && somenteDigitos(origem.cnpj) === somenteDigitos(destino.cnpj)) {
    alertas.push('Origem e destino têm o mesmo CNPJ — transferência dentro do mesmo estabelecimento não gera nota.');
  }

  const end = enderecoDestino(destino, transferencia.destination);
  if (end.endereco && !end.numero) {
    alertas.push('Número do endereço da loja de destino em branco. Preencha à mão ou complete o cadastro.');
  }
  if (!end.bairro) {
    alertas.push('Bairro da loja de destino em branco — o Shopify não tem esse campo. Complete em lojas_fiscais.');
  }

  const baseVenda = destino?.base_valor === 'venda';
  const desconto = Number(destino?.desconto_percentual ?? 0);
  if (!Number.isFinite(desconto) || desconto < 0 || desconto >= 100) {
    alertas.push(
      `Desconto da loja "${nomeDestino}" inválido no cadastro (${destino?.desconto_percentual}%) — ` +
        'a nota vai sem desconto. Corrija em lojas_fiscais.'
    );
  } else if (desconto > 0) {
    alertas.push(`Desconto de ${desconto}% aplicado em cada item (cadastro da loja "${nomeDestino}").`);
  }
  const fator = Number.isFinite(desconto) && desconto > 0 && desconto < 100 ? 1 - desconto / 100 : 1;

  const natureza = destino?.natureza_operacao?.trim() ?? '';
  if (destino && !natureza) {
    alertas.push(
      `Loja "${nomeDestino}" sem natureza de operação no cadastro (lojas_fiscais) — o rascunho não ` +
        'será criado até ela ser preenchida com o nome exato da natureza no Tiny.'
    );
  }

  const naturezaId = String(destino?.natureza_operacao_id ?? '').trim();
  if (destino && !naturezaId) {
    alertas.push(
      `Loja "${nomeDestino}" sem natureza_operacao_id no cadastro (lojas_fiscais) — o rascunho não ` +
        'será criado até ele ser preenchido com o id da natureza no Tiny.'
    );
  }

  const semCusto = [];
  const itens = (transferencia.lineItems ?? []).map((linha) => {
    const inventario = linha.inventoryItem ?? {};
    const variante = inventario.variants?.nodes?.[0];
    const custo = Number(inventario.unitCost?.amount ?? 0);
    const venda = Number(variante?.price ?? 0);
    const base = baseVenda ? venda : custo > 0 ? custo : venda;
    if (!baseVenda && !(custo > 0)) semCusto.push(inventario.sku || linha.title);
    const valorUnitario = base * fator;
    if (!inventario.sku) alertas.push(`Item "${linha.title}" está sem SKU no Shopify.`);

    return {
      item: {
        codigo: inventario.sku ?? '',
        descricao: variante?.displayName ?? linha.title ?? '',
        unidade: 'UN',
        quantidade: Number(linha.totalQuantity ?? 0),
        valor_unitario: valorMonetario(valorUnitario),
        tipo: 'P',
        gtin_ean: variante?.barcode || 'SEM GTIN',
        gtin_ean_embalagem: 'SEM GTIN',
      },
    };
  });

  if (semCusto.length) {
    alertas.push(
      `${semCusto.length} item(ns) sem custo cadastrado no Shopify — usado o preço de venda: ` +
        `${semCusto.slice(0, 10).join(', ')}${semCusto.length > 10 ? '…' : ''}.`
    );
  }
  if (itens.length === 0) alertas.push('Transferência sem itens. Verifique se a leitura do Shopify foi completa.');

  const nome = transferencia.name ?? '';
  const payload = {
    nota_fiscal: {
      tipo: 'S',
      ...(naturezaId ? { id_natureza_operacao: Number(naturezaId) } : {}),
      natureza_operacao: natureza,
      frete_por_conta: SEM_FRETE,
      // A nota é emitida no dia em que for criada, não na data da transferência.
      data_emissao: dataBr(),
      obs: `Transferência ${nome} do Shopify: ${nomeOrigem} -> ${nomeDestino}`,
      cliente: {
        nome: destino?.razao_social || nomeDestino,
        tipo_pessoa: 'J',
        cpf_cnpj: somenteDigitos(destino?.cnpj),
        ie: destino?.ie ?? '',
        ...end,
        pais: 'BRASIL',
        atualizar_cliente: 'N',
      },
      itens,
    },
  };

  return { payload, alertas };
}
