// tiny.js — integração com a API 2.0 do Tiny (Olist).
//
// A API 2.0 é antiga: recebe POST com application/x-www-form-urlencoded,
// sempre com `token` e `formato=JSON`, e o payload vai em um campo de nome
// específico por endpoint (`pesquisa`, `nota`, `id`...). A resposta vem sempre
// embrulhada em `retorno`, com `status`, `erros` e `registros`.
//
// incluirNotaRascunho usa nota.fiscal.incluir.php (JSON), como os demais
// endpoints. Já tentamos duas vezes ir por XML pra conseguir mandar
// `gtin_ean`: primeiro com o nome errado (nota.fiscal.incluir.xml.php, 404),
// depois com o nome correto da doc (incluir.nota.xml.php) — mas o Tiny
// rejeita esse endpoint nesta conta/token mesmo assim. Então ficamos em
// JSON; o campo `gtin_ean` está no payload mesmo sem confirmação de que o
// Tiny o usa de fato na emissão — ver alertas se a nota sair sem GTIN.
//
// ATENÇÃO — este token é de PRODUÇÃO:
// 
//   - incluirNotaRascunho: CRIA uma nota de verdade no Tiny, mesmo a partir de
//     um pedido fictício. A tela do rascunho exige uma confirmação explícita.
//   - emitirNota: dá valor fiscal à nota, sem volta. Cada tela pede
//     confirmação antes de chamar.
//
// CONTAS — cada loja tem a sua conta no Tiny. Pedidos de atacado saem da conta
// da matriz (TINY_API_TOKEN). Nota de transferência sai da conta da loja de
// ORIGEM — emitir pela matriz uma transferência entre duas lojas é errado
// fiscalmente. As funções de nota aceitam uma `conta` (ver tinyContas.js);
// sem ela, vale a conta da matriz.

import { somenteDigitos } from '../utils.js';

const BASE_PADRAO = 'https://api.tiny.com.br/api2';

/**
 * Base da API do Tiny. `TINY_API_BASE` existe só para apontar para outro
 * ambiente; vazia, cai no padrão.
 *
 * A validação aqui não é preciosismo: já aconteceu de o token ser colado
 * nesta variável no painel do Vercel. Sem checagem, a URL virava
 * "<token>/nota.fiscal.incluir.php", o fetch estourava com "Failed to parse
 * URL from ..." e a mensagem — com o token dentro — ia parar na tela do
 * usuário. Falhamos cedo, dizendo qual variável está errada e sem repetir o
 * valor dela.
 */
function BASE() {
  const bruta = (process.env.TINY_API_BASE ?? '').trim();
  if (!bruta) return BASE_PADRAO;

  let url;
  try {
    url = new URL(bruta);
  } catch {
    throw new Error(
      'TINY_API_BASE não é uma URL válida (esperado algo como ' +
        `${BASE_PADRAO}). Corrija a variável de ambiente — confira se o token ` +
        'não foi colado nela por engano.'
    );
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`TINY_API_BASE precisa começar com https:// (esperado algo como ${BASE_PADRAO}).`);
  }

  // Sem barra no fim, senão a URL final sai com "//" antes do endpoint.
  return bruta.replace(/\/+$/, '');
}

// A API 2.0 do Tiny devolve objeto único (não array) quando só há um item em
// listas como `registros` ou `erros` — só vira array com dois ou mais.
function paraArray(valor) {
  if (Array.isArray(valor)) return valor;
  if (valor && typeof valor === 'object') return [valor];
  return [];
}

/**
 * Variável de ambiente com o token da conta Tiny de uma loja, pelo nome do
 * local no Shopify: sem acento, maiúsculas, e o que não for letra ou número
 * vira "_". "Rowa Centro de Distribuição 1" -> TINY_API_TOKEN_ROWA_CENTRO_DE_DISTRIBUICAO_1.
 */
export function variavelTokenDaLoja(nomeLoja) {
  const chave = String(nomeLoja ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return chave ? `TINY_API_TOKEN_${chave}` : null;
}

/**
 * POST no formato que a API 2.0 espera, já desembrulhando `retorno`.
 * `conta` ({ token, variavel }) escolhe a conta do Tiny; sem ela, a da matriz.
 */
async function chamarTiny(endpoint, params = {}, conta = null) {
  const variavel = conta?.variavel ?? 'TINY_API_TOKEN';
  const token = conta ? conta.token : process.env.TINY_API_TOKEN;
  if (!token) {
    throw new Error(`${variavel} não configurado. Preencha o .env.local / as variáveis do Vercel.`);
  }

  const corpo = new URLSearchParams({ token, formato: 'JSON', ...params });
  const url = `${BASE()}/${endpoint}`

  let resposta;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo.toString(),
      cache: 'no-store',
    });
  } catch (erro) {
    // `erro.message` do fetch inclui a URL inteira, e a URL carrega a base —
    // que, mal configurada, pode conter credencial. O detalhe cru fica no log
    // do servidor; para cima sobe só o que é seguro mostrar.
    console.error(`[tiny] falha de rede em ${endpoint}:`, erro);
    throw new Error(`Falha de rede ao chamar o Tiny (${endpoint}). Veja os logs do servidor para o detalhe.`);
  }

  if (!resposta.ok) {
    throw new Error(`Tiny respondeu ${resposta.status} em ${endpoint}.`);
  }

  const texto = await resposta.text();
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    // O Tiny às vezes devolve HTML quando o token é inválido.
    throw new Error(`Tiny devolveu uma resposta que não é JSON em ${endpoint}. Verifique o ${variavel}.`);
  }

  const retorno = dados.retorno ?? {};

  if (retorno.status === 'Erro') {
    // O Tiny bota o detalhe do erro em lugares diferentes conforme o endpoint,
    // e vira objeto único (em vez de array) quando só há um item — por isso
    // tudo passa por paraArray antes de percorrer.
    const errosDiretos = paraArray(retorno.erros);
    const errosDeRegistros = paraArray(retorno.registros).flatMap((r) => paraArray(r.registro?.erros));
    const mensagens = [...errosDiretos, ...errosDeRegistros]
      .map((e) => e.erro ?? JSON.stringify(e))
      .join('; ');

    if (!mensagens) {
      console.error(`[tiny] ${endpoint} devolveu status "Erro" sem detalhe reconhecido:`, JSON.stringify(retorno));
    }
    throw new Error(`Tiny recusou a chamada ${endpoint}: ${mensagens || 'erro não detalhado'}`);
  }

  return retorno;
}

/**
 * Cria a nota como RASCUNHO no Tiny (sem valor fiscal).
 * Isto escreve em produção — só chame depois da confirmação na interface.
 */
export async function incluirNotaRascunho(payload, conta = null) {
  const retorno = await chamarTiny('nota.fiscal.incluir.php', { nota: JSON.stringify(payload) }, conta);

  const registro = paraArray(retorno.registros)[0]?.registro ?? null;
  const idNota = registro?.id ?? retorno.idNotaFiscal ?? null;

  return { idNota: idNota ? String(idNota) : null, retorno };
}

/** Consulta uma nota já criada — usado para confirmar a inclusão. */
export async function obterNota(id, conta = null) {
  const retorno = await chamarTiny('nota.fiscal.obter.php', { id: String(id) }, conta);
  return retorno.nota_fiscal ?? retorno;
}

function normalizarNatureza(nome) {
  return String(nome ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Confere se a natureza de operação que ficou na nota do Tiny é a que foi
 * pedida. O Tiny não recusa um nome que não existe no cadastro de naturezas:
 * troca em silêncio pela natureza padrão ("Venda para contribuinte"), e a
 * nota sai com o CFOP errado. Só a leitura da nota depois de criada mostra.
 *
 * Retorna { ok, naNota, esperada }. Nota sem o campo conta como divergente —
 * sem confirmar, não emite.
 */
export function conferirNatureza(notaTiny, esperada) {
  const naNota = notaTiny?.natureza_operacao ?? null;
  const ok = Boolean(naNota) && normalizarNatureza(naNota) === normalizarNatureza(esperada);
  return { ok, naNota, esperada };
}

/**
 * Interpreta o campo `situacao` que o Tiny devolve para a nota.
 * TODO: confirmar com o time fiscal a lista exata de situações desta conta —
 * o valor abaixo é a leitura textual mais comum da API 2.0, não documentação
 * oficial conferida.
 */
function notaEstaEmitida(notaTiny) {
  const situacao = String(notaTiny?.situacao ?? '').toLowerCase();
  return /emitid|autorizad/.test(situacao) && !/cancelad/.test(situacao);
}

/**
 * Situação da nota no Tiny: se já foi emitida (autorizada) e, nesse caso, o
 * número da NF. O número só é devolvido para nota autorizada — o de um
 * rascunho não é o número fiscal definitivo.
 */
export async function obterSituacaoNota(id, conta = null) {
  const nota = await obterNota(id, conta);
  const emitida = notaEstaEmitida(nota);
  const numero = emitida && nota?.numero ? String(nota.numero) : null;
  return { emitida, numero, situacao: nota?.situacao ?? null };
}

/**
 * Link do DANFE — uma página HTML com impressão automática, não um PDF cru.
 * O Tiny devolve esse link mesmo pra nota ainda não emitida (rascunho), só
 * que marcado "DOCUMENTO SEM VALOR FISCAL" no rodapé; vale a pena checar
 * `notaEmitida` antes de oferecer o botão, mas a chamada em si não falha.
 * https://tiny.com.br/api-docs/api2-notas-fiscais-obter-link
 */
export async function obterLinkDanfe(id, conta = null) {
  const retorno = await chamarTiny('nota.fiscal.obter.link.php', { id: String(id) }, conta);
  if (!retorno.link_nfe) {
    throw new Error('Tiny não devolveu o link do DANFE — confira se a nota já foi emitida.');
  }
  return retorno.link_nfe;
}

/** Emissão fiscal — dá valor tributário à nota, de forma irreversível. */
export async function emitirNota(id, conta = null) {
  return chamarTiny('nota.fiscal.emitir.php', { id: String(id) }, conta);
}

/**
 * CNPJ da conta dona do token (info.php). Serve para pegar token trocado —
 * colado na variável da loja errada, a nota sairia com outro emitente.
 * Devolve null quando o Tiny não informa o CNPJ; quem chama decide o que
 * fazer sem a confirmação.
 */
export async function obterCnpjDaConta(conta = null) {
  const retorno = await chamarTiny('info.php', {}, conta);
  const dados = retorno.conta ?? retorno;
  const cnpj = somenteDigitos(dados?.cnpj_cpf ?? dados?.cnpj ?? dados?.cpf_cnpj);
  return cnpj.length === 14 ? cnpj : null;
}

/** Ping usado pelo /api/saude. Faz só uma leitura inofensiva. */
export async function verificarTiny() {
  await chamarTiny('produtos.pesquisa.php', { pesquisa: '__ping__' }).catch((erro) => {
    // Busca sem resultado é resposta válida para o nosso teste de conectividade.
    if (!/não encontrad|nao encontrad|sem registros/i.test(erro.message));
  });
  return { servico: 'Tiny', ok: true, detalhe: 'Token aceito e API respondendo.' };
}



// ---------------------------------------------------------------------------
// Cadastro do cliente (contato) — campo "Contribuinte"
//
// "Contribuinte" NÃO é campo de nota. nota.fiscal.incluir não aceita
// `contribuinte` em nível nenhum (nem em `cliente`, nem na raiz), e
// nota.fiscal.obter de uma nota real desta conta devolve o cliente sem ele.
// O campo mora no cadastro do contato, e a nota herda dele na emissão — é o
// indIEDest da NFe. Por isso, garantir "Contribuinte ICMS" em toda nota
// significa marcar o CADASTRO antes de criar o rascunho.
//
// `atualizar_cliente: 'S'` na nota não resolveria: o Tiny só atualizaria o
// cadastro com os campos que vieram na nota, e contribuinte não é um deles.
//
// Cliente que ainda não existe no Tiny seria criado PELA nota — sem
// contribuinte. Então, nesse caso, o contato é criado antes, já como
// Contribuinte ICMS, com os mesmos dados do cliente da nota (o Tiny liga a
// nota a ele). E a emissão confere de novo, porque o cadastro pode ter sido
// mexido à mão no Tiny depois do rascunho.
// ---------------------------------------------------------------------------

/** Valores aceitos em `contribuinte` no cadastro de contato do Tiny. */
export const CONTRIBUINTE_ICMS = '1';

const ROTULO_CONTRIBUINTE = {
  0: 'não informado',
  1: 'Contribuinte ICMS',
  2: 'Contribuinte isento',
  9: 'Não contribuinte',
};

function rotuloContribuinte(valor) {
  return ROTULO_CONTRIBUINTE[valor] ?? `código ${valor}`;
}

/**
 * Contatos com este CNPJ. Devolve lista vazia quando não há nenhum: nesse caso
 * o Tiny responde status "Erro" com "A consulta não retornou registros", o que
 * chamarTiny transformaria em exceção — e não achar cliente não é falha.
 */
async function pesquisarContatosPorCnpj(cnpj) {
  let retorno;
  try {
    retorno = await chamarTiny('contatos.pesquisa.php', { cpf_cnpj: cnpj });
  } catch (erro) {
    if (/não retornou registros|nao retornou registros/i.test(erro.message)) return [];
    throw erro;
  }

  const contatos = paraArray(retorno.contatos).map((c) => c.contato ?? c);

  // O parâmetro cpf_cnpj é exato hoje, mas conferimos de novo pelos dígitos:
  // marcar o contato errado como contribuinte é pior do que não marcar nenhum.
  return contatos.filter((c) => somenteDigitos(c.cpf_cnpj) === somenteDigitos(cnpj));
}

/**
 * Cria o contato no Tiny já como Contribuinte ICMS, a partir do `cliente` do
 * payload da nota. Devolve o id do contato criado.
 */
async function incluirContatoContribuinte(cliente) {
  const retorno = await chamarTiny('contato.incluir.php', {
    contato: JSON.stringify({
      contatos: [
        {
          contato: {
            sequencia: 1,
            nome: cliente.nome,
            tipo_pessoa: cliente.tipo_pessoa ?? 'J',
            cpf_cnpj: cliente.cpf_cnpj,
            ie: cliente.ie ?? '',
            endereco: cliente.endereco ?? '',
            numero: cliente.numero ?? '',
            complemento: cliente.complemento ?? '',
            bairro: cliente.bairro ?? '',
            cep: cliente.cep ?? '',
            cidade: cliente.cidade ?? '',
            uf: cliente.uf ?? '',
            pais: cliente.pais ?? 'BRASIL',
            situacao: 'A',
            contribuinte: CONTRIBUINTE_ICMS,
          },
        },
      ],
    }),
  });

  // O status geral pode vir OK com o registro recusado.
  const registro = paraArray(retorno.registros)[0]?.registro ?? null;
  if (registro?.status === 'Erro') {
    const erros = paraArray(registro.erros).map((e) => e.erro ?? JSON.stringify(e)).join('; ');
    throw new Error(`Tiny recusou o cadastro do contato: ${erros || 'erro não detalhado'}`);
  }
  return registro?.id ? String(registro.id) : null;
}

/**
 * Marca o cadastro do cliente como "Contribuinte ICMS" no Tiny.
 *
 * ISTO ESCREVE EM PRODUÇÃO — altera o cadastro de contatos, não a nota. Só é
 * chamado dentro do fluxo de inclusão do rascunho, que já exige confirmação
 * explícita na tela.
 *
 * O cadastro desta conta tem CNPJ repetido em contatos de nomes diferentes
 * (um mesmo CNPJ chegou a devolver 5 contatos). A regra combinada é marcar o
 * PRIMEIRO — por isso devolvemos quantos apareceram, para a tela deixar isso
 * à vista em vez de esconder a escolha.
 *
 * Sem contato com este CNPJ, cria um já como Contribuinte ICMS quando vier
 * `clienteNota` (o `cliente` do payload) — senão a nota criaria o contato
 * sem contribuinte.
 *
 * Contribuinte ICMS exige IE na NFe (indIEDest=1). Então, se o cadastro
 * existente está com a IE vazia e a nota trouxe uma, ela é gravada junto.
 * IE já preenchida no cadastro nunca é sobrescrita.
 *
 * Nunca lança: devolve o que aconteceu; quem chama decide se a falha
 * bloqueia (a emissão bloqueia, a criação do rascunho só avisa).
 *
 * @param {string} cnpj
 * @param {{ clienteNota?: object }} [opcoes]
 * @returns {Promise<{ok: boolean, alterado: boolean, mensagem: string}>}
 */
export async function garantirContribuinteIcms(cnpj, { clienteNota } = {}) {
  const digitos = somenteDigitos(cnpj);

  if (digitos.length !== 14) {
    return {
      ok: false,
      alterado: false,
      mensagem: 'Contribuinte ICMS não aplicado: o cliente da nota não tem CNPJ de 14 dígitos.',
    };
  }

  try {
    const contatos = await pesquisarContatosPorCnpj(digitos);
    if (contatos.length === 0 && clienteNota?.nome) {
      const idContato = await incluirContatoContribuinte({ ...clienteNota, cpf_cnpj: digitos });
      return {
        ok: true,
        alterado: true,
        mensagem:
          `Cliente "${clienteNota.nome}" não existia no Tiny — cadastrado como Contribuinte ICMS` +
          `${idContato ? ` (contato ${idContato})` : ''}.`,
      };
    }
    if (contatos.length === 0) {
      return {
        ok: false,
        alterado: false,
        mensagem: `Contribuinte ICMS não aplicado: nenhum contato com o CNPJ ${digitos} no cadastro do Tiny.`,
      };
    }

    const [contato] = contatos;
    const duplicados =
      contatos.length > 1
        ? ` Atenção: este CNPJ tem ${contatos.length} contatos no Tiny e marcamos o primeiro — confira se é o certo.`
        : '';

    // contatos.pesquisa não devolve `contribuinte`; só o cadastro completo tem.
    const cadastro = await chamarTiny('contato.obter.php', { id: String(contato.id) });
    const atual = String(cadastro.contato?.contribuinte ?? '0');
    const jaContribuinte = atual === CONTRIBUINTE_ICMS;

    // Vazio de verdade: "ISENTO" ou qualquer outro texto conta como preenchido.
    const ieNota = somenteDigitos(clienteNota?.ie);
    const preencherIe = !String(cadastro.contato?.ie ?? '').trim() && ieNota !== '';

    if (jaContribuinte && !preencherIe) {
      return {
        ok: true,
        alterado: false,
        mensagem: `Cadastro de "${contato.nome}" já estava como Contribuinte ICMS.${duplicados}`,
      };
    }

    // `sequencia`, `nome` e `situacao` são obrigatórios mesmo numa alteração
    // parcial — devolvemos os valores que já estão lá para não mexer em nada
    // além de `contribuinte` (e da IE, quando estava vazia).
    await chamarTiny('contato.alterar.php', {
      contato: JSON.stringify({
        contatos: [
          {
            contato: {
              sequencia: 1,
              id: String(contato.id),
              nome: cadastro.contato?.nome ?? contato.nome,
              situacao: cadastro.contato?.situacao ?? 'A',
              contribuinte: CONTRIBUINTE_ICMS,
              ...(preencherIe ? { ie: ieNota } : {}),
            },
          },
        ],
      }),
    });

    const feito = jaContribuinte
      ? `já estava como Contribuinte ICMS`
      : `marcado como Contribuinte ICMS — antes estava como ${rotuloContribuinte(atual)}`;
    const avisoIe = preencherIe ? ` IE ${ieNota} preenchida no cadastro, que estava sem IE.` : '';

    return {
      ok: true,
      alterado: true,
      mensagem: `Cadastro de "${contato.nome}" (contato ${contato.id}) ${feito}.${avisoIe}${duplicados}`,
    };
  } catch (erro) {
    return {
      ok: false,
      alterado: false,
      mensagem: `Contribuinte ICMS não aplicado: ${erro.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Produto pai — "Um produto pai não pode ser informado"
//
// A nota leva o SKU do Shopify como `codigo` do item, e o Tiny procura o
// produto por esse código. Quando o código é o de um produto COM variações
// (o "pai"), o Tiny recusa a nota: só aceita a variação. Aqui o pai é
// trocado pela variação cuja grade (tamanho, cor...) bate com as opções do
// item no Shopify.
//
// Só roda depois de o Tiny recusar com esse erro: conferir todo SKU antes de
// toda nota estouraria o limite de chamadas por minuto da API.
// ---------------------------------------------------------------------------

/** true quando o erro do Tiny é o de produto pai informado no item. */
export function erroDeProdutoPai(mensagem) {
  return /produto pai/i.test(String(mensagem ?? ''));
}

function normalizarOpcao(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** Valores da grade de uma variação do Tiny — vem como objeto ou como lista. */
function valoresDaGrade(grade) {
  if (!grade) return [];
  if (Array.isArray(grade)) return grade.map((g) => g?.valor ?? g?.value ?? '').filter(Boolean);
  return Object.values(grade).filter((v) => typeof v === 'string' && v);
}

/** Código comparável: o Tiny casa o código sem ligar para caixa nem espaços nas pontas. */
function normalizarCodigo(codigo) {
  return String(codigo ?? '').trim().toUpperCase();
}

/** Resultado de produtos.pesquisa (casa por código e por nome). */
async function pesquisarProdutos(termo, conta) {
  let retorno;
  try {
    retorno = await chamarTiny('produtos.pesquisa.php', { pesquisa: String(termo).trim() }, conta);
  } catch (erro) {
    if (/não retornou registros|nao retornou registros/i.test(erro.message)) return [];
    throw erro;
  }
  return paraArray(retorno.produtos).map((p) => p.produto ?? p);
}

/** Produtos do Tiny com este código. */
async function produtosPorCodigo(codigo, conta) {
  const alvo = normalizarCodigo(codigo);
  return (await pesquisarProdutos(codigo, conta)).filter((p) => normalizarCodigo(p.codigo) === alvo);
}

/**
 * Pai com o mesmo nome da descrição do item. Quando o código da nota não
 * existe no Tiny, o Tiny casa o item pela descrição — e, se o nome é o de um
 * pai, recusa a nota do mesmo jeito. A pesquisa por código então não acha
 * nada, e só a pesquisa pelo nome chega no pai.
 */
async function paiPorDescricao(descricao, opcoes, conta) {
  if (!descricao) return null;
  // Na transferência a descrição é o displayName do Shopify ("Produto - M"):
  // o nome do pai é o que vem antes das opções da variante.
  const sufixo = opcoes.length ? ` - ${opcoes.join(' / ')}` : '';
  const nomes = [descricao];
  if (sufixo && descricao.endsWith(sufixo)) nomes.push(descricao.slice(0, -sufixo.length));

  for (const nome of nomes) {
    const alvo = normalizarOpcao(nome);
    const pais = (await pesquisarProdutos(nome, conta)).filter(
      (p) => p.tipoVariacao === 'P' && normalizarOpcao(p.nome) === alvo
    );
    if (pais.length === 1) return pais[0];
  }
  return null;
}

/**
 * Escolhe a variação cujos valores de grade são os mesmos das opções do item
 * no Shopify (sem olhar o nome da opção — "Tamanho" lá pode ser "Size" aqui).
 * Sem opções no Shopify, só decide quando o pai tem uma variação só.
 *
 * O Shopify às vezes só tem o tamanho, com a cor no nome do produto ("Top
 * Heart - Azul Marinho" / "M"), enquanto a grade do Tiny tem tamanho e cor.
 * Aí vale a variação que tem as opções do Shopify e cujo resto da grade
 * aparece na descrição do item.
 */
function escolherVariacao(variacoes, opcoes, descricao = '') {
  const alvo = new Set(opcoes.map(normalizarOpcao).filter(Boolean));
  if (alvo.size === 0) return variacoes.length === 1 ? variacoes[0] : null;

  const valores = (v) => new Set(valoresDaGrade(v.grade).map(normalizarOpcao).filter(Boolean));
  const unica = (lista) => (lista.length === 1 ? lista[0] : null);

  const iguais = variacoes.filter((v) => {
    const g = valores(v);
    return g.size === alvo.size && [...g].every((x) => alvo.has(x));
  });
  if (iguais.length) return unica(iguais);

  // Grade com menos atributos que o Shopify (ex.: só tamanho no Tiny).
  const contidas = variacoes.filter((v) => {
    const g = valores(v);
    return g.size > 0 && [...g].every((x) => alvo.has(x));
  });
  if (contidas.length) return unica(contidas);

  // Grade com mais atributos que o Shopify (ex.: cor só no nome do produto).
  const contem = variacoes.filter((v) => {
    const g = valores(v);
    return [...alvo].every((x) => g.has(x));
  });
  if (contem.length <= 1) return unica(contem);
  const texto = normalizarOpcao(descricao);
  return unica(contem.filter((v) => [...valores(v)].every((x) => alvo.has(x) || texto.includes(x))));
}

/** "M / Azul; G / Azul" — para a mensagem dizer o que o Tiny tem. */
function resumoDasGrades(variacoes) {
  return variacoes.map((v) => valoresDaGrade(v.grade).join(' / ') || `${v.codigo || 'sem código'} (sem grade)`).join('; ');
}

function rotuloTipoVariacao(tipo) {
  return { N: 'produto simples', V: 'variação', P: 'pai' }[tipo] ?? `tipo "${tipo ?? '?'}"`;
}

/**
 * Troca, nos itens, o código de produto pai pelo da variação certa.
 *
 * @param {object[]} itens `nota_fiscal.itens` do payload ({ item: {...} })
 * @param {Record<string, string[]>} opcoesPorCodigo opções do Shopify por SKU
 *   (ex.: { "G668-B1S": ["P", "Azul"] })
 * @param {{ mensagemErro?: string, conta?: object }} [opcoes] quando a
 *   mensagem do Tiny cita códigos da nota, só esses são conferidos — poupa
 *   chamadas num pedido com muitos itens
 * @returns {Promise<{ itens: object[], trocas: {de: string, para: string, descricao: string}[],
 *   pendentes: {codigo: string, descricao: string, motivo: string}[] }>}
 */
export async function trocarProdutosPai(itens, opcoesPorCodigo = {}, { mensagemErro = '', conta = null } = {}) {
  const codigos = [...new Set(itens.map(({ item }) => String(item.codigo ?? '')).filter(Boolean))];
  const mensagemNormalizada = normalizarCodigo(mensagemErro);
  const citados = codigos.filter((c) => mensagemNormalizada.includes(normalizarCodigo(c)));
  const conferir = citados.length > 0 ? citados : codigos;

  const descricaoDe = (codigo) => itens.find(({ item }) => item.codigo === codigo)?.item.descricao ?? '';
  const novoCodigo = {};
  const trocas = [];
  const pendentes = [];

  // Uma chamada por vez: a API do Tiny limita chamadas por minuto.
  for (const codigo of conferir) {
    const produtos = await produtosPorCodigo(codigo, conta);
    // O Tiny já disse que este código é de um pai: vale o pai mesmo que a
    // pesquisa também devolva uma variação com o mesmo código.
    let pai = produtos.find((p) => p.tipoVariacao === 'P');
    if (!pai && produtos.length === 0 && citados.includes(codigo)) {
      pai = await paiPorDescricao(descricaoDe(codigo), opcoesPorCodigo[codigo] ?? [], conta);
    }
    if (!pai) {
      // Código citado pelo Tiny e não achado como pai: vira pendência com o
      // motivo, em vez de sumir — senão a tela só diz "nenhum código encontrado".
      if (citados.includes(codigo)) {
        pendentes.push({
          codigo,
          descricao: descricaoDe(codigo),
          motivo:
            produtos.length === 0
              ? 'o código não existe no Tiny, nem há um pai com o nome da descrição — confira no Tiny se o nome do pai é igual ao do item'
              : `o Tiny cadastra este código como ${produtos.map((p) => rotuloTipoVariacao(p.tipoVariacao)).join(' e ')}, não como pai`,
        });
      }
      continue;
    }

    const cadastro = await chamarTiny('produto.obter.php', { id: String(pai.id) }, conta);
    const variacoes = paraArray(cadastro.produto?.variacoes).map((v) => v.variacao ?? v);
    const opcoes = opcoesPorCodigo[codigo] ?? [];
    const escolhida = escolherVariacao(variacoes, opcoes, descricaoDe(codigo));

    if (escolhida && !escolhida.codigo) {
      pendentes.push({
        codigo,
        descricao: descricaoDe(codigo),
        motivo: `a variação "${valoresDaGrade(escolhida.grade).join(' / ')}" não tem código no Tiny — cadastre um código nela`,
      });
    } else if (escolhida) {
      novoCodigo[codigo] = String(escolhida.codigo);
      trocas.push({ de: codigo, para: String(escolhida.codigo), descricao: descricaoDe(codigo) });
    } else {
      pendentes.push({
        codigo,
        descricao: descricaoDe(codigo),
        motivo:
          variacoes.length === 0
            ? 'o produto pai não tem variações cadastradas no Tiny'
            : `nenhuma das ${variacoes.length} variações do Tiny (${resumoDasGrades(variacoes)}) bate só com ` +
              `${opcoes.length ? `"${opcoes.join(' / ')}"` : 'o item (sem tamanho/cor no Shopify)'}`,
      });
    }
  }

  return {
    itens: itens.map((i) => (novoCodigo[i.item.codigo] ? { item: { ...i.item, codigo: novoCodigo[i.item.codigo] } } : i)),
    trocas,
    pendentes,
  };
}

/**
 * Inclui o rascunho; se o Tiny recusar por produto pai, troca pelos códigos
 * das variações e tenta de novo uma vez. Devolve também o payload aceito e
 * as trocas feitas. Lança com a lista do que não deu para resolver.
 *
 * @param {() => Promise<Record<string, string[]>>} lerOpcoes opções do
 *   Shopify por SKU — só lidas se o Tiny recusar
 */
export async function incluirNotaTrocandoProdutosPai(payload, { lerOpcoes = async () => ({}), conta = null } = {}) {
  try {
    return { ...(await incluirNotaRascunho(payload, conta)), payload, trocas: [] };
  } catch (erro) {
    if (!erroDeProdutoPai(erro.message)) throw erro;

    const { itens, trocas, pendentes } = await trocarProdutosPai(payload.nota_fiscal.itens, await lerOpcoes(), {
      mensagemErro: erro.message,
      conta,
    });
    if (pendentes.length > 0 || trocas.length === 0) {
      const detalhe = pendentes.length
        ? pendentes.map((p) => `${p.codigo}${p.descricao ? ` (${p.descricao})` : ''}: ${p.motivo}`).join('; ')
        : 'nenhum código da nota foi encontrado como produto pai no Tiny';
      throw new Error(
        `${erro.message}. Não deu para trocar pela variação automaticamente — ${detalhe}. ` +
          'Ajuste o cadastro do produto no Tiny (nome do pai ou grade das variações) e tente de novo.'
      );
    }

    const corrigido = { ...payload, nota_fiscal: { ...payload.nota_fiscal, itens } };
    return { ...(await incluirNotaRascunho(corrigido, conta)), payload: corrigido, trocas };
  }
}

/** Trecho da mensagem de sucesso com as trocas feitas ('' sem trocas). */
export function avisoDeTrocas(trocas) {
  return trocas.length
    ? ` O Tiny recusou produto pai — trocado pela variação: ${trocas.map((t) => `${t.de} → ${t.para}`).join(', ')}.`
    : '';
}
