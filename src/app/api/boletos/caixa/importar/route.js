// POST /api/boletos/caixa/importar — importa o arquivo texto da "Consulta de
// Títulos" do e-Cobrança (multipart, campo `arquivo`). Grava/atualiza cada
// título em boletos_caixa por nosso número (situação, valor, vencimento,
// entrada) e devolve o resumo:
//
//   { lidos, novos, atualizados, ignoradas,
//     semPedido: [nfs sem pedido no sistema],
//     divergentes: [{ nossoNumero, documento }] }  // nosso nº fora do padrão da NF
//
// Título que sumiu do arquivo não é mexido: a consulta costuma vir filtrada
// (ex.: só EM ABERTO), então ausência não quer dizer pago.

import { lerConsultaTitulos } from '@/lib/caixa/consultaTitulos';
import { importarTitulosCaixa, nfsComPedido } from '@/lib/db';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const TAMANHO_MAXIMO = 4 * 1024 * 1024;

export async function POST(request) {
  const form = await request.formData().catch(() => null);
  const arquivo = form?.get('arquivo');
  if (!arquivo || typeof arquivo === 'string') return erroJson('Envie o arquivo da CAIXA no campo "arquivo".', 400);
  if (arquivo.size > TAMANHO_MAXIMO) return erroJson('Arquivo maior que 4 MB.', 400);

  // O e-Cobrança exporta em Latin-1 (nomes com acento).
  const texto = new TextDecoder('latin1').decode(await arquivo.arrayBuffer());
  let lido;
  try {
    lido = lerConsultaTitulos(texto);
  } catch (erro) {
    return erroJson(erro.message, 400);
  }
  if (lido.titulos.length === 0) return erroJson('Nenhum título encontrado no arquivo.', 400);

  const gravado = await importarTitulosCaixa(lido.titulos);
  if (!gravado.ok) {
    return erroJson(
      `Importação interrompida (${gravado.novos} novos e ${gravado.atualizados} atualizados até aqui): ${gravado.erro}`,
      502
    );
  }

  const nfs = [...new Set(lido.titulos.map((t) => t.nf_numero))];
  const comPedido = await nfsComPedido(nfs);
  if (!comPedido.ok) console.error('[boletos-caixa] Falha ao conferir os pedidos das NFs importadas:', comPedido.erro);

  return Response.json({
    lidos: lido.titulos.length,
    novos: gravado.novos,
    atualizados: gravado.atualizados,
    ignoradas: lido.ignoradas,
    semPedido: comPedido.ok ? nfs.filter((nf) => !comPedido.nfs.has(nf)).sort((a, b) => a - b) : null,
    divergentes: lido.divergentes,
  });
}
