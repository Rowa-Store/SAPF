// POST /api/boletos/caixa — procura na CAIXA os boletos destas NFs e grava
// os achados em boletos_caixa (com a cópia do PDF). Corpo: { nfs: [24515, …] }.
// Devolve { titulos: { [nf]: [...] }, erros: { [nf]: mensagem } }.
//
// Procura pelo nosso número padrão (14 + NF + parcela), parcela 1, 2, 3…, e
// para depois de MAX_FALTAS parcelas seguidas sem boleto — o nº de parcelas
// não é fixo. Parcela já gravada não é baixada de novo. Título fora do padrão
// (ex.: 14000000024518002) não é achado assim: só vem por arquivo da CAIXA.

import { montarNossoNumero } from '@/lib/caixa/nossoNumero';
import { baixarBoletoCaixa } from '@/lib/integrations/caixa';
import { salvarTituloCaixa, titulosCaixaPorNf } from '@/lib/db';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_NFS = 10;
const MAX_PARCELAS = 12;
const MAX_FALTAS = 2;
const NFS_EM_PARALELO = 4;

/** Procura as parcelas que faltam de uma NF. Devolve os títulos da NF. */
async function sincronizarNf(nf, conhecidos) {
  const titulos = [...conhecidos];
  const jaTem = new Set(conhecidos.map((t) => t.nosso_numero));
  let faltas = 0;
  for (let parcela = 1; parcela <= MAX_PARCELAS && faltas < MAX_FALTAS; parcela++) {
    const nossoNumero = montarNossoNumero(nf, parcela);
    if (jaTem.has(nossoNumero)) {
      faltas = 0;
      continue;
    }
    const boleto = await baixarBoletoCaixa(nossoNumero);
    if (!boleto.encontrado) {
      faltas++;
      continue;
    }
    faltas = 0;
    const salvo = await salvarTituloCaixa({
      nossoNumero,
      nf,
      parcela,
      valor: boleto.valor,
      vencimento: boleto.vencimento,
      bytes: boleto.bytes,
      origem: 'gerado',
    });
    if (!salvo.ok) throw new Error(`Não foi possível gravar a parcela ${parcela}: ${salvo.erro}`);
    titulos.push(salvo.titulo);
  }
  return titulos.sort((a, b) => (a.parcela ?? 99) - (b.parcela ?? 99));
}

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  const nfs = [...new Set((corpo?.nfs ?? []).map(Number))];
  if (nfs.length === 0 || nfs.some((n) => !Number.isInteger(n) || n <= 0 || n > 99999)) {
    return erroJson('Envie { nfs: [...] } com os nºs das NFs (até 5 dígitos).', 400);
  }
  if (nfs.length > MAX_NFS) return erroJson(`No máximo ${MAX_NFS} NFs por vez.`, 400);
  if (!process.env.CAIXA_CEDENTE) return erroJson('CAIXA_CEDENTE não configurado.', 500);

  let conhecidos;
  try {
    conhecidos = await titulosCaixaPorNf(nfs);
  } catch (erro) {
    return erroJson(erro.message, 502);
  }

  const titulos = {};
  const erros = {};
  const fila = [...nfs];
  await Promise.all(
    Array.from({ length: NFS_EM_PARALELO }, async () => {
      for (let nf = fila.shift(); nf !== undefined; nf = fila.shift()) {
        try {
          titulos[nf] = await sincronizarNf(nf, conhecidos[nf] ?? []);
        } catch (erro) {
          console.error(`[boletos-caixa] Falha ao consultar a NF ${nf}:`, erro.message);
          erros[nf] = erro.message;
          titulos[nf] = conhecidos[nf] ?? [];
        }
      }
    })
  );
  return Response.json({ titulos, erros });
}
