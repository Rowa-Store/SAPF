// /api/transferencias/[id]/rascunho — rascunho da nota de transferência no Tiny.
//
// ESTES ENDPOINTS ESCREVEM EM PRODUÇÃO. Mesmas travas do rascunho de pedido:
// exigem `confirmacaoTeste: true` e nunca criam dois rascunhos para a mesma
// transferência.
//
//   - POST cria o rascunho. O payload NÃO vem do navegador: é remontado aqui
//     a partir do Shopify e do cadastro de lojas — o que vai para o Tiny é o
//     que o preview mostrou. Com `substituir: true`, cria um novo mesmo que já
//     exista rascunho (ex.: depois de corrigir o cadastro da loja); o antigo
//     vai para tiny_notas_substituidas e precisa ser removido à mão no Tiny.
//     Com `reemitir: true`, faz o mesmo mesmo que a nota atual já tenha sido
//     EMITIDA: o registro volta a "não emitida" para a nota nova ser emitida
//     em seguida. A NF antiga continua
//     valendo até ser cancelada à mão no Tiny.
//   - GET  devolve o rascunho já criado (o payload realmente enviado ao Tiny),
//     para a tela de edição carregar.
//   - PUT  "edita" o rascunho: a API 2.0 do Tiny não altera
//     nem exclui nota, então cria um NOVO rascunho com o payload corrigido
//     vindo da tela; o antigo precisa ser cancelado/excluído à mão no Tiny e
//     fica registrado em tiny_notas_substituidas.
//
// A nota é criada na conta do Tiny da loja de ORIGEM (tinyContas.js).

import { conferirNatureza, incluirNotaRascunho, obterCnpjDaConta, obterNota } from '@/lib/integrations/tiny';
import { contaTinyDaLoja, contaTinyDaTransferencia } from '@/lib/integrations/tinyContas';
import { obterTransferenciaCompleta, paraGidTransferencia } from '@/lib/integrations/shopifyTransferencias';
import { montarNotaTransferencia } from '@/lib/fiscal/montarNotaTransferencia';
import {
  lojasFiscaisPorLocal,
  obterRascunhoCriado,
  anotarErro,
  registrarErro,
  registrarRascunhoCriado,
  statusPorPedido,
} from '@/lib/db';
import { totalDaNota } from '@/lib/fiscal/montarNota';
import { erroJson, somenteDigitos } from '@/lib/utils';

/** Aviso para anexar à mensagem quando o Tiny trocou a natureza pedida. */
function avisoNatureza(confirmacao, payload) {
  if (!confirmacao || confirmacao.aviso) return '';
  const natureza = conferirNatureza(confirmacao, payload.nota_fiscal.natureza_operacao);
  if (natureza.ok) return '';
  return (
    ` ATENÇÃO: o Tiny gravou a natureza "${natureza.naNota ?? '(não informada)'}" em vez de ` +
    `"${natureza.esperada}". Confira o id e o nome da natureza em lojas_fiscais (naturezas_tiny da loja de origem). ` +
    'A emissão desta nota vai ser recusada até o cadastro ser corrigido e o rascunho refeito.'
  );
}

/**
 * Confere se o token é mesmo da conta da loja de origem — token colado na
 * variável da loja errada faria a nota sair com outro emitente. Compara o
 * CNPJ da conta (info.php) com o da origem em lojas_fiscais; sem um dos dois,
 * segue. Devolve a mensagem de erro, ou null.
 */
async function conferirTokenDaConta(conta, cnpjOrigem) {
  const esperado = somenteDigitos(cnpjOrigem);
  if (esperado.length !== 14) return null;
  let cnpjDoToken;
  try {
    cnpjDoToken = await obterCnpjDaConta(conta);
  } catch (erro) {
    console.warn(`[transferencia] Não foi possível conferir o CNPJ da conta de ${conta.variavel}:`, erro.message);
    return null;
  }
  if (cnpjDoToken && cnpjDoToken !== esperado) {
    return (
      `O token em ${conta.variavel} é da conta do Tiny do CNPJ ${cnpjDoToken}, mas a loja de origem ` +
      `"${conta.nome}" tem o CNPJ ${esperado} em lojas_fiscais. Corrija a variável de ambiente antes de criar a nota.`
    );
  }
  return null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CLASSIFICACAO = 'transferencia';

/** Rascunho criado desta transferência — o mesmo id numérico poderia, em tese, ser de um pedido. */
async function rascunhoDaTransferencia(gid) {
  const atual = await obterRascunhoCriado(gid);
  if (atual.ok && atual.rascunho && atual.rascunho.classificacao !== CLASSIFICACAO) {
    return { ok: true, rascunho: null };
  }
  return atual;
}

export async function GET(request, { params }) {
  const { id } = await params;
  const gid = paraGidTransferencia(id);

  const { ok, erro, rascunho } = await rascunhoDaTransferencia(gid);
  if (!ok) return erroJson(`Não foi possível carregar o rascunho: ${erro}`, 502);
  if (!rascunho) return erroJson('Esta transferência ainda não tem rascunho criado no Tiny.', 404);

  return Response.json({
    orderName: rascunho.shopify_order_name,
    classificacao: rascunho.classificacao,
    payload: rascunho.payload_enviado,
    totalNota: rascunho.payload_enviado ? totalDaNota(rascunho.payload_enviado) : 0,
    tinyNotaId: rascunho.tiny_nota_id,
    notaEmitida: rascunho.nota_emitida,
    tinyNotasSubstituidas: rascunho.tiny_notas_substituidas ?? [],
  });
}

export async function PUT(request, { params }) {
  const { id } = await params;
  const gid = paraGidTransferencia(id);

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);
  }

  const { payload, confirmacaoTeste } = corpo ?? {};
  if (confirmacaoTeste !== true) {
    return erroJson(
      'Confirmação ausente: isto cria um NOVO rascunho no Tiny com os dados corrigidos — o antigo ' +
        'precisa ser cancelado/excluído manualmente dentro do Tiny.',
      400
    );
  }
  if (!payload?.nota_fiscal?.itens?.length) {
    return erroJson('Payload sem itens. Volte e confira os dados antes de salvar.', 400);
  }

  const atual = await rascunhoDaTransferencia(gid);
  if (!atual.ok) return erroJson(`Não foi possível confirmar o rascunho atual: ${atual.erro}`, 502);
  if (!atual.rascunho) {
    return erroJson('Esta transferência ainda não tem rascunho criado no Tiny — crie pela tela de transferências.', 404);
  }
  if (atual.rascunho.nota_emitida) {
    return erroJson('Esta nota já foi emitida no Tiny. Uma nota emitida não pode ser recriada por aqui.', 409);
  }

  const tinyNotaIdAnterior = atual.rascunho.tiny_nota_id;
  const orderName = atual.rascunho.shopify_order_name;

  const lida = await contaTinyDaTransferencia(id);
  if (!lida.ok) return erroJson(lida.erro, 422);
  const conta = lida.conta;

  try {
    const { idNota, retorno } = await incluirNotaRascunho(payload, conta);
    const confirmacao = idNota ? await obterNota(idNota, conta).catch((erro) => ({ aviso: erro.message })) : null;

    // Acumula: um rascunho corrigido duas vezes deixa dois antigos para remover no Tiny.
    const notasSubstituidas = [...(atual.rascunho.tiny_notas_substituidas ?? [])];
    if (tinyNotaIdAnterior) notasSubstituidas.push(tinyNotaIdAnterior);

    const registro = await registrarRascunhoCriado({
      orderId: gid,
      orderName,
      classificacao: CLASSIFICACAO,
      payload,
      tinyNotaId: idNota,
      respostaTiny: retorno,
      notasSubstituidas,
    });
    if (!registro.ok) {
      console.error(
        `[transferencia] Novo rascunho ${idNota} (corrigindo ${tinyNotaIdAnterior}) criado no Tiny, mas falhou ao registrar no Supabase:`,
        registro.erro
      );
    }

    return Response.json({
      ok: true,
      tinyNotaId: idNota,
      tinyNotaIdAnterior,
      confirmacao,
      mensagem:
        `Novo rascunho ${idNota ?? ''} criado na conta do Tiny de "${conta.nome}" com os dados corrigidos. ` +
        `Cancele ou exclua o rascunho ${tinyNotaIdAnterior} dentro do Tiny — a API não faz isso ` +
        'automaticamente, e os dois ficam duplicados até você remover o antigo à mão.' +
        avisoNatureza(confirmacao, payload),
    });
  } catch (erro) {
    console.error(`[transferencia] Tiny recusou a recriação da transferência ${gid} (substituindo ${tinyNotaIdAnterior}):`, erro);
    const mensagem = `O Tiny recusou a inclusão da nota corrigida: ${erro.message}`;
    // O rascunho anterior continua valendo: só a mensagem fica guardada.
    await anotarErro(gid, mensagem);
    return erroJson(mensagem, 502);
  }
}

export async function POST(request, { params }) {
  const { id } = await params;
  const gid = paraGidTransferencia(id);

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);
  }

  if (corpo?.confirmacaoTeste !== true) {
    return erroJson(
      'Confirmação ausente: criar o rascunho grava uma nota real no Tiny de produção.',
      400
    );
  }

  const reemitir = corpo.reemitir === true;
  const substituir = reemitir || corpo.substituir === true;

  // Trava contra duplicidade — vale também para nota emitida fora do sistema.
  // Substituir um rascunho ou uma nota emitida só é aceito quando pedido
  // explicitamente.
  const situacao = (await statusPorPedido([gid]))[gid];
  if (situacao?.nota_emitida && !reemitir) {
    return erroJson(
      `Esta transferência já está marcada como emitida${situacao.numero_nf ? ` (NF ${situacao.numero_nf})` : ''} — ` +
        'use "Reemitir" para criar e emitir uma nota nova.',
      409
    );
  }
  if (reemitir && !situacao?.nota_emitida) {
    return erroJson('Esta transferência não tem nota emitida — use "Novo rascunho" ou "Emitir nota".', 409);
  }
  if (situacao?.status === 'rascunho_criado' && !substituir) {
    return erroJson(`Esta transferência já tem o rascunho ${situacao.tiny_nota_id} no Tiny.`, 409, {
      tinyNotaId: situacao.tiny_nota_id,
    });
  }

  let anterior = null;
  if (substituir) {
    const atual = await rascunhoDaTransferencia(gid);
    if (!atual.ok) return erroJson(`Não foi possível confirmar o rascunho atual: ${atual.erro}`, 502);
    if (!atual.rascunho?.tiny_nota_id) {
      return erroJson('Esta transferência ainda não tem rascunho no Tiny — use "Criar rascunho".', 404);
    }
    anterior = atual.rascunho;
  }

  let transferencia, payload, conta, cnpjOrigem;
  try {
    transferencia = await obterTransferenciaCompleta(id);
    const origemId = transferencia.origin?.location?.id ?? null;
    const destinoId = transferencia.destination?.location?.id ?? null;
    const cadastro = await lojasFiscaisPorLocal([origemId, destinoId]);
    if (!cadastro.ok) return erroJson(`Não foi possível ler o cadastro de lojas: ${cadastro.erro}`, 502);

    // A nota sai da conta do Tiny da loja de origem — nunca cai na da matriz
    // por falta de token.
    const resolvida = contaTinyDaLoja(transferencia.origin?.name);
    if (!resolvida.ok) return erroJson(resolvida.erro, 422);
    conta = resolvida.conta;
    cnpjOrigem = cadastro.lojas[origemId]?.cnpj;

    if (!cadastro.lojas[destinoId]) {
      return erroJson(
        `A loja de destino "${transferencia.destination?.name}" não está cadastrada em lojas_fiscais — ` +
          'sem CNPJ do destinatário o Tiny recusa a nota.',
        422
      );
    }
    // Sem natureza (nome + id na conta que emite), o Tiny cairia na natureza
    // padrão da conta e a nota sairia com CFOP de venda.
    let natureza;
    ({ payload, natureza } = montarNotaTransferencia(transferencia, {
      origem: cadastro.lojas[origemId] ?? null,
      destino: cadastro.lojas[destinoId],
      contaMatriz: conta.matriz,
    }));
    if (!natureza.ok) return erroJson(`Natureza de operação: ${natureza.erro}`, 422);
  } catch (erro) {
    return erroJson(`Não foi possível montar a nota: ${erro.message}`, 502);
  }

  if (!payload.nota_fiscal.itens.length) {
    return erroJson('Transferência sem itens — nada para enviar ao Tiny.', 400);
  }

  const erroToken = await conferirTokenDaConta(conta, cnpjOrigem);
  if (erroToken) return erroJson(erroToken, 422);

  try {
    const { idNota, retorno } = await incluirNotaRascunho(payload, conta);
    const confirmacao = idNota ? await obterNota(idNota, conta).catch((erro) => ({ aviso: erro.message })) : null;

    // Acumula: um rascunho refeito duas vezes deixa dois antigos para remover no Tiny.
    const notasSubstituidas = anterior
      ? [...(anterior.tiny_notas_substituidas ?? []), anterior.tiny_nota_id]
      : undefined;

    const registro = await registrarRascunhoCriado({
      orderId: gid,
      orderName: transferencia.name,
      classificacao: CLASSIFICACAO,
      payload,
      tinyNotaId: idNota,
      respostaTiny: retorno,
      notasSubstituidas,
      reiniciarEmissao: reemitir,
    });
    if (!registro.ok) {
      console.error(`[transferencia] Nota ${idNota} criada no Tiny, mas falhou ao registrar no Supabase:`, registro.erro);
    }

    const mensagem = reemitir
      ? `Novo rascunho ${idNota ?? ''} criado no Tiny para reemitir a transferência ${transferencia.name}. ` +
        `A nota anterior (${anterior.tiny_nota_id}${situacao.numero_nf ? `, NF ${situacao.numero_nf}` : ''}) ` +
        'continua emitida — cancele ela à mão no Tiny.'
      : anterior
      ? `Novo rascunho ${idNota ?? ''} criado no Tiny para a transferência ${transferencia.name}. ` +
        `Cancele ou exclua o rascunho ${anterior.tiny_nota_id} dentro do Tiny — a API não faz isso ` +
        'automaticamente, e os dois ficam duplicados até você remover o antigo à mão.'
      : `Rascunho ${idNota ?? ''} criado no Tiny para a transferência ${transferencia.name}.`;
    const naConta = ` Nota criada na conta do Tiny de "${conta.nome}".`;

    return Response.json({
      ok: true,
      tinyNotaId: idNota,
      tinyNotaIdAnterior: anterior?.tiny_nota_id ?? null,
      tinyNotasSubstituidas: notasSubstituidas ?? null,
      confirmacao,
      mensagem: mensagem + naConta + avisoNatureza(confirmacao, payload),
    });
  } catch (erro) {
    console.error(`[transferencia] Tiny recusou a inclusão da transferência ${gid}:`, erro);
    const mensagem = `O Tiny recusou a inclusão da nota: ${erro.message}`;
    await registrarErro({
      orderId: gid,
      orderName: transferencia.name,
      classificacao: CLASSIFICACAO,
      payload,
      mensagem,
    });
    return erroJson(mensagem, 502);
  }
}
