// transporte.js — o bloco de transporte da nota. O padrão é Correios, Sedex
// Contrato AG; cliente anexado a uma transportadora do cadastro
// (/pedidos/transportadoras) usa a dela, com os dados do nosso cadastro — ver
// transporteDaTransportadora.
//
// Os nomes dos campos e os códigos vêm da documentação da API 2.0
// (nota.fiscal.incluir + tabela de forma de envio):
//
//   - `forma_envio`  'C' = Correios (tabela de forma de envio do Tiny).
//   - `forma_frete`  serviço contratado. A doc só diz "de acordo com o
//     cadastro na Olist", e o cadastro guarda o RÓTULO INTEIRO, com o código
//     entre parênteses — mandar só "03220" cai como "Não definida" na nota.
//     O valor abaixo foi lido de um pedido real desta conta
//     (pedido.obter.php devolve forma_envio/forma_frete; nota.fiscal.obter
//     não devolve nenhum dos dois, então é por lá que se confere).
//   - `transportador` só leva o nome de propósito: CNPJ, IE e endereço saem do
//     cadastro dos Correios dentro do Tiny. Mandar esses campos aqui
//     sobrescreveria o cadastro com dados nossos, que podem estar velhos. O
//     nome tem que bater LETRA POR LETRA com o cadastro, senão o Tiny não
//     encontra a transportadora — por isso a razão social inteira, em caixa
//     alta e sem acento, exatamente como está lá.
//   - `frete_por_conta` fica no montarNota.js, junto do resto da nota, porque
//     é dado da operação (quem paga) e não da transportadora.

/** Transportadora e serviço da nota de atacado/franquia quando o cliente não
 *  tem transportadora anexada. */
export const TRANSPORTE_PADRAO = {
  forma_envio: 'C',
  forma_frete: 'SEDEX CONTRATO AG (03220)',
  transportador: { nome: 'EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS' },
};

/** `forma_envio` 'T' = Transportadora (tabela de forma de envio do Tiny). */
const FORMA_ENVIO_TRANSPORTADORA = 'T';

/**
 * Bloco de transporte para uma linha da tabela `transportadoras`. Diferente
 * dos Correios, a transportadora não precisa existir no Tiny, e este sistema
 * não procura nem cadastra nada lá: a nota leva os dados do nosso cadastro.
 * Pela doc do nota.fiscal.incluir, o Tiny só procura o transportador pelo
 * `nome` (ou `codigo`) e, sem cadastro com esse nome, fica com os campos
 * enviados — por isso eles vão completos (a tela exige todos, menos a IE).
 * Se um dia existir no Tiny uma transportadora com o mesmo nome, o Tiny passa
 * a usar os dados de lá.
 * `forma_frete` só vai quando preenchida — um rótulo que não existe na Olist
 * cai como "Não definida".
 */
export function transporteDaTransportadora(t) {
  const transportador = { nome: t.nome };
  if (t.cnpj) {
    transportador.tipo_pessoa = 'J';
    transportador.cpf_cnpj = t.cnpj;
  }
  if (t.ie) transportador.ie = t.ie;
  if (t.endereco) transportador.endereco = t.endereco;
  if (t.cidade) transportador.cidade = t.cidade;
  if (t.uf) transportador.uf = t.uf;

  return {
    forma_envio: FORMA_ENVIO_TRANSPORTADORA,
    ...(t.forma_frete ? { forma_frete: t.forma_frete } : {}),
    transportador,
  };
}

/**
 * A quantidade de volumes vem do metafield `volume_pedido` do Shopify, que é
 * texto livre: pode chegar "3", "3 volumes" ou o nosso "Não informado". Pega o
 * primeiro número inteiro positivo; devolve null quando não dá para ler, para
 * quem chama avisar em vez de chutar.
 */
export function quantidadeDeVolumes(valor) {
  const numero = parseInt(String(valor ?? '').match(/\d+/)?.[0] ?? '', 10);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}
