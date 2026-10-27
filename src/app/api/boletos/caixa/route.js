// POST /api/boletos/caixa — grava um boleto da CAIXA baixado pela extensão
// no navegador de quem usa a tela (ver src/features/boletos/extensaoCaixa.js:
// a CAIXA recusa o acesso vindo do servidor). Multipart: { arquivo (PDF),
// nf, parcela }. Lê valor e vencimento da linha digitável, guarda a cópia do
// PDF no Storage e grava o título em boletos_caixa. Devolve { titulo }.
//
// Só aceita o nosso número padrão (14 + NF + parcela), que é o que a tela
// procura; título fora do padrão vem pela importação do arquivo da CAIXA.

import { montarNossoNumero } from '@/lib/caixa/nossoNumero';
import { lerBoletoPdf } from '@/lib/caixa/boletoPdf';
import { salvarTituloCaixa } from '@/lib/db';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TAMANHO_MAXIMO = 1024 * 1024;

export async function POST(request) {
  const form = await request.formData().catch(() => null);
  const arquivo = form?.get('arquivo');
  const nf = Number(form?.get('nf'));
  const parcela = Number(form?.get('parcela'));
  if (!arquivo || typeof arquivo === 'string') return erroJson('Envie o PDF do boleto no campo "arquivo".', 400);
  if (arquivo.size > TAMANHO_MAXIMO) return erroJson('PDF maior que 1 MB — não parece um boleto da CAIXA.', 400);
  if (!Number.isInteger(nf) || nf <= 0 || nf > 99999 || !Number.isInteger(parcela) || parcela < 1 || parcela > 99) {
    return erroJson('nf (até 5 dígitos) e parcela (1 a 99) são obrigatórios.', 400);
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const lido = lerBoletoPdf(bytes);
  if (!lido.encontrado) return erroJson('O arquivo não é um PDF.', 400);
  // Na linha digitável da CAIXA (SIGCB), o 3º campo começa com os 9 últimos
  // dígitos do nosso número: não batendo, o PDF é de outro título.
  const nossoNumero = montarNossoNumero(nf, parcela);
  if (lido.linhaDigitavel?.slice(21, 30) !== nossoNumero.slice(-9)) {
    return erroJson(`O PDF não é o boleto da NF ${nf}, parcela ${parcela}.`, 400);
  }

  const salvo = await salvarTituloCaixa({
    nossoNumero,
    nf,
    parcela,
    valor: lido.valor,
    vencimento: lido.vencimento,
    bytes,
    origem: 'gerado',
  });
  if (!salvo.ok) return erroJson(`Não foi possível gravar o boleto: ${salvo.erro}`, 502);
  return Response.json({ titulo: salvo.titulo });
}
