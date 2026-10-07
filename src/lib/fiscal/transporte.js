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

// ---------------------------------------------------------------------------
// Metafield `custom.transportadora` do pedido — texto livre digitado no
// Shopify: "correios", "retirada" ou o nome (ou um pedaço do nome) de uma
// transportadora do cadastro. Quando vem preenchido, manda no transporte da
// nota, por cima da transportadora anexada ao cliente.
// ---------------------------------------------------------------------------

function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Pedaço mínimo para casar com o nome — "a" ou "tr" casaria com tudo. */
const MINIMO_TRECHO = 3;

/**
 * Lê o metafield e diz qual transporte a nota leva.
 *
 * @param {string} texto valor do metafield
 * @param {object[]} transportadoras linhas da tabela `transportadoras`
 * @returns {{ tipo: 'vazio'|'correios'|'retirada'|'transportadora'|'nao_cadastrada'|'ambigua'|'inativa',
 *   texto: string, transportadora?: object, candidatas?: object[] }}
 *   - vazio: metafield em branco — vale a regra antiga (cliente anexado ou Correios);
 *   - nao_cadastrada / ambigua / inativa: a nota não pode sair até corrigir.
 */
export function resolverTransporte(texto, transportadoras = []) {
  const bruto = String(texto ?? '').trim();
  const alvo = normalizarTexto(bruto);
  if (!alvo) return { tipo: 'vazio', texto: bruto };
  if (alvo === 'correios' || alvo === 'correio') return { tipo: 'correios', texto: bruto };
  if (alvo === 'retirada' || alvo === 'retirar' || alvo === 'retira') return { tipo: 'retirada', texto: bruto };

  // Casa nos dois sentidos: "jadlog" acha "JADLOG LOGISTICA S.A." e
  // "Braspress Transportes Urgentes Ltda" acha "BRASPRESS".
  const casa = (t) => {
    const nome = normalizarTexto(t.nome);
    if (!nome) return false;
    if (nome === alvo) return true;
    return (alvo.length >= MINIMO_TRECHO && nome.includes(alvo)) || (nome.length >= MINIMO_TRECHO && alvo.includes(nome));
  };
  const encontradas = transportadoras.filter(casa);
  const ativas = encontradas.filter((t) => t.ativo !== false);

  if (ativas.length === 1) return { tipo: 'transportadora', texto: bruto, transportadora: ativas[0] };
  if (ativas.length > 1) {
    // Nome idêntico desempata ("Jadlog" com "JADLOG" e "JADLOG CARGAS").
    const exata = ativas.filter((t) => normalizarTexto(t.nome) === alvo);
    if (exata.length === 1) return { tipo: 'transportadora', texto: bruto, transportadora: exata[0] };
    return { tipo: 'ambigua', texto: bruto, candidatas: ativas };
  }
  if (encontradas.length > 0) return { tipo: 'inativa', texto: bruto, candidatas: encontradas };
  return { tipo: 'nao_cadastrada', texto: bruto };
}

/** Problema do transporte informado no pedido, para a tela; null quando está ok. */
export function problemaDoTransporte(resolvido) {
  const nomes = (resolvido.candidatas ?? []).map((t) => t.nome).join(', ');
  switch (resolvido.tipo) {
    case 'nao_cadastrada':
      return (
        `O pedido pede a transportadora "${resolvido.texto}" (metafield transportadora), mas ela não está no ` +
        'cadastro de transportadoras. Cadastre antes de criar a nota.'
      );
    case 'ambigua':
      return (
        `"${resolvido.texto}" (metafield transportadora) casa com mais de uma transportadora do cadastro: ${nomes}. ` +
        'Escreva o nome mais completo no Shopify.'
      );
    case 'inativa':
      return (
        `"${resolvido.texto}" (metafield transportadora) é de uma transportadora inativa no cadastro: ${nomes}. ` +
        'Reative ou escolha outra.'
      );
    default:
      return null;
  }
}

/** Bloco de transporte da nota para o transporte resolvido; undefined = regra antiga. */
export function blocoDoTransporte(resolvido) {
  if (resolvido.tipo === 'correios') return TRANSPORTE_PADRAO;
  // Retirada: a nota não leva nenhum dado de transporte.
  if (resolvido.tipo === 'retirada') return {};
  if (resolvido.tipo === 'transportadora') return transporteDaTransportadora(resolvido.transportadora);
  return undefined;
}

/**
 * Texto da tela para o transporte que entrou na nota, a partir da resposta do
 * preview (`payload`, `transportadora`, `transporteInformado`).
 */
export function resumoDoTransporte(dados) {
  const nome = dados?.payload?.nota_fiscal?.transportador?.nome ?? '—';
  const informado = dados?.transporteInformado;
  switch (informado?.tipo) {
    case 'retirada':
      return 'Retirada pelo cliente — a nota vai sem dados de transporte (metafield transportadora)';
    case 'correios':
    case 'transportadora':
      return `${nome} (metafield transportadora: "${informado.texto}")`;
    case 'nao_cadastrada':
    case 'ambigua':
    case 'inativa':
      return `"${informado.texto}" não resolvida no cadastro — a nota não pode ser criada`;
    default:
      return `${nome} ${dados?.transportadora ? '(anexada ao cliente)' : '(padrão)'}`;
  }
}
