// POST /api/pedidos/[id]/emitir — emite a nota no Tiny (dá valor fiscal).
//
// ESTE ENDPOINT É IRREVERSÍVEL — a tela de atacado pede confirmação antes.
// Antes de emitir, garante o cliente como Contribuinte ICMS no cadastro do
// Tiny (ver tiny.js) — sem isso a nota do atacado não sai. Depois de emitir,
// lê o número da NF da nota autorizada e grava no Supabase e, se o cliente é
// franquia, completa o cadastro dele com o que a nota tem e ele não.

import { emitirNota, garantirContribuinteIcms, obterSituacaoNota } from '@/lib/integrations/tiny';
import {
  anotarErro,
  obterRascunhoCriado,
  atualizarNotaEmitida,
  atualizarFranquia,
  franquiaPorCnpj,
  registrarNumeroNf,
  statusPorPedido,
} from '@/lib/db';
import { faltantesDaNota } from '@/lib/fiscal/franquias';
import { erroJson, paraGid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Recusa a emissão e guarda a mensagem para o "Ver erro" da linha. */
async function falhou(gid, mensagem, status) {
  await anotarErro(gid, mensagem);
  return erroJson(mensagem, status);
}

export async function POST(request, { params }) {
  const { id } = await params;
  const gid = paraGid(id);

  // O id da nota vem do Supabase, não do navegador: emitir a nota errada é o
  // pior erro possível aqui.
  const situacao = (await statusPorPedido([gid]))[gid];
  if (situacao?.status !== 'rascunho_criado' || !situacao.tiny_nota_id) {
    return erroJson('Este pedido ainda não tem rascunho criado no Tiny.', 400);
  }
  if (situacao.nota_emitida) return erroJson('Esta nota já foi emitida.', 409);


  const tinyNotaId = situacao.tiny_nota_id;

  // O cliente vem do payload que foi para o Tiny neste rascunho. Emitir sem
  // Contribuinte ICMS seria irreversível — então aqui a falha bloqueia.
  const rascunho = await obterRascunhoCriado(gid);
  const cliente = rascunho.rascunho?.payload_enviado?.nota_fiscal?.cliente;
  if (!cliente?.cpf_cnpj) {
    return falhou(
      gid,
      'Não foi possível ler o cliente do rascunho para conferir o Contribuinte ICMS' +
        `${rascunho.erro ? `: ${rascunho.erro}` : ''}. A nota não foi emitida.`,
      502
    );
  }
  const contribuinte = await garantirContribuinteIcms(cliente.cpf_cnpj, { clienteNota: cliente });
  if (!contribuinte.ok) {
    return falhou(
      gid,
      `${contribuinte.mensagem} A nota não foi emitida — marque o cliente como Contribuinte ICMS no Tiny e tente de novo.`,
      502
    );
  }

  try {
    await emitirNota(tinyNotaId);
  } catch (erro) {
    return falhou(gid, erro.message, 502);
  }

  const registro = await atualizarNotaEmitida(gid, true);
  if (!registro.ok) {
    console.error(`[emitir] Nota ${tinyNotaId} emitida no Tiny, mas falhou ao registrar no Supabase:`, registro.erro);
  }

  // A autorização na SEFAZ pode demorar: sem número agora, a tela confere de
  // novo depois (/api/pedidos/[id]/situacao). Falhar aqui não é erro da emissão.
  let numeroNf = null;
  try {
    numeroNf = (await obterSituacaoNota(tinyNotaId)).numero;
    if (numeroNf) await registrarNumeroNf({ orderId: gid, numeroNf });
  } catch (erro) {
    console.error(`[emitir] Nota ${tinyNotaId} emitida, mas não foi possível ler o número no Tiny:`, erro);
  }

  await completarCadastroFranquia(cliente);

  return Response.json({
    ok: true,
    tinyNotaId,
    numeroNf,
    mensagem: 'Nota emitida no Tiny.',
  });
}

/** Preenche os campos vazios do cadastro da franquia (/pedidos/clientes) com
 *  os dados do cliente na nota. A nota já foi emitida: falha aqui só loga. */
async function completarCadastroFranquia(clienteNota) {
  try {
    const { ok, erro, franquia } = await franquiaPorCnpj(clienteNota.cpf_cnpj);
    if (!ok) throw new Error(erro);
    if (!franquia) return;
    const faltantes = faltantesDaNota(franquia, clienteNota);
    if (!Object.keys(faltantes).length) return;
    const gravacao = await atualizarFranquia(franquia.cnpj, faltantes);
    if (!gravacao.ok) throw new Error(gravacao.erro);
  } catch (erro) {
    console.error(`[emitir] Nota emitida, mas não foi possível completar o cadastro da franquia ${clienteNota.cpf_cnpj}:`, erro);
  }
}
