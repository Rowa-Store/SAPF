// /api/franquias — cadastro de clientes franqueados (tabela client_exce).
//
//   - GET  lista todos, ativos ou não, com a transportadora e a IE de cada um.
//   - POST inclui um cliente.
//   - PUT  edita um cliente: { cnpjOriginal, ...campos }. O CNPJ não muda.
//
// POST e PUT aceitam também `ie` (gravada em clientes_ie, a que a nota usa) e
// `transportadoraId` (anexo em clientes_transportadora; null = Correios).
// Só grava no Supabase. O efeito aparece na classificação do pedido
// (classificacao.js), no markup da nota (markupDaFranquia), na IE e no
// transporte dos próximos rascunhos.

import {
  anexarClienteTransportadora,
  atualizarFranquia,
  criarFranquia,
  desanexarClienteTransportadora,
  gravarIeDoCliente,
  ieDoCliente,
  listarFranquias,
  removerIeDoCliente,
  transportadoraDoCliente,
} from '@/lib/db';
import { lerFranquia } from '@/lib/fiscal/franquias';
import { lerCnpjCliente } from '@/lib/fiscal/transportadoras';
import { erroJson, somenteDigitos } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const { ok, erro, franquias } = await listarFranquias();
  if (!ok) return erroJson(`Não foi possível carregar os clientes: ${erro}`, 502);
  return Response.json({ franquias });
}

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  if (!corpo) return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);

  const { cnpj, erro } = lerCnpjCliente(corpo.cnpj);
  if (erro) return erroJson(erro, 400);

  const lido = lerFranquia(corpo);
  if (lido.erro) return erroJson(lido.erro, 400);

  const resultado = await criarFranquia({ cnpj, ...lido.dados });
  if (!resultado.ok) return erroJson(`Não foi possível salvar: ${resultado.erro}`, 502);
  return responderComVinculos(resultado.franquia, lido, 201);
}

export async function PUT(request) {
  const corpo = await request.json().catch(() => null);
  if (!corpo) return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);
  if (!corpo.cnpjOriginal) return erroJson('Informe qual cliente editar (cnpjOriginal).', 400);

  const lido = lerFranquia(corpo);
  if (lido.erro) return erroJson(lido.erro, 400);

  const resultado = await atualizarFranquia(corpo.cnpjOriginal, lido.dados);
  if (!resultado.ok) return erroJson(`Não foi possível salvar: ${resultado.erro}`, resultado.naoEncontrada ? 404 : 502);
  return responderComVinculos(resultado.franquia, lido, 200);
}

/** Grava a IE e a transportadora depois do cadastro. Se uma delas falhar, o
 *  cadastro já está salvo — a resposta diz o que ficou para trás. */
async function responderComVinculos(franquia, { ie, transportadoraId }, status) {
  const cnpj = somenteDigitos(franquia.cnpj);
  const nome = franquia.apelido || franquia.razao_social;
  const falhas = [];

  if (ie !== undefined) {
    const atual = await ieDoCliente(cnpj);
    if (!atual.ok) falhas.push(`IE: ${atual.erro}`);
    else if (ie && ie !== atual.ie) {
      const r = await gravarIeDoCliente({ cnpj, ie, uf: franquia.uf || atual.uf, origem: 'manual' });
      if (!r.ok) falhas.push(`IE: ${r.erro}`);
    } else if (!ie && atual.ie) {
      const r = await removerIeDoCliente(cnpj);
      if (!r.ok) falhas.push(`IE: ${r.erro}`);
    }
  }

  if (transportadoraId !== undefined) {
    const atual = await transportadoraDoCliente(cnpj);
    const idAtual = atual.transportadora?.id == null ? null : String(atual.transportadora.id);
    if (!atual.ok) falhas.push(`transportadora: ${atual.erro}`);
    else if (transportadoraId === null && idAtual) {
      const r = await desanexarClienteTransportadora({ transportadoraId: idAtual, cnpj });
      if (!r.ok) falhas.push(`transportadora: ${r.erro}`);
    } else if (transportadoraId && transportadoraId !== idAtual) {
      const r = await anexarClienteTransportadora({ transportadoraId, cnpj, nome, mover: true });
      if (!r.ok) falhas.push(`transportadora: ${r.erro}`);
    }
  }

  if (falhas.length) {
    return erroJson(`O cadastro foi salvo, mas não deu para gravar ${falhas.join('; ')}.`, 502, { franquia });
  }
  return Response.json({ franquia }, { status });
}
