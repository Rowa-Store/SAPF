// consultaTitulos.js — lê o arquivo texto da "CONSULTA DE TITULOS" do
// e-Cobrança (Banco de Títulos → Consulta de Títulos → exportar). Função pura.
//
// O arquivo tem largura fixa, com um cabeçalho assim:
//
//   NOSSO NUMERO  NUM.DOCUMENTO  NOME DO SACADO  VALOR DO TITULO  DT.VENCTO
//   SITUACAO  ULTIMO COMANDO  DT.ENTRADA
//
// As colunas são cortadas pela posição dos títulos no cabeçalho (não por
// posição fixa no código), para aguentar coluna mais larga ou mais estreita.
//
// A NF sai de NUM.DOCUMENTO, não do nosso número: no arquivo real há
// títulos fora do padrão (14 + NF + parcela) e alguns em que o nosso número
// nem bate com o documento — digitação errada no registro. Nesses a parcela
// fica null e o título volta em `divergentes`. O nome do sacado não é lido.

import { montarNossoNumero, parseNossoNumero } from './nossoNumero.js';

const COLUNAS = {
  nossoNumero: 'NOSSO NUMERO',
  documento: 'NUM.DOCUMENTO',
  sacado: 'NOME DO SACADO',
  valor: 'VALOR DO TITULO',
  vencimento: 'DT.VENCTO',
  situacao: 'SITUACAO',
  ultimoComando: 'ULTIMO COMANDO',
  entrada: 'DT.ENTRADA',
};

/** "4.406,63" -> "4406.63" (string: vai para numeric sem passar por float). */
function valorBr(texto) {
  const m = String(texto).trim().match(/^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/);
  return m ? `${Number(m[1].replace(/\./g, ''))}.${m[2]}` : null;
}

/** "28.10.2026" ou "28/10/2026" -> "2026-10-28". */
function dataBr(texto) {
  const m = String(texto).trim().match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Situação como a tabela guarda. */
export function situacaoDoTitulo(texto) {
  const s = String(texto ?? '').trim().toUpperCase();
  if (s === 'EM ABERTO') return 'em_aberto';
  if (s.startsWith('LIQUIDAD')) return 'liquidado';
  if (s.startsWith('BAIXAD')) return 'baixado';
  return 'outro';
}

/**
 * Parcela do título quando o nosso número segue um dos formatos conhecidos
 * para esta NF (padrão ou irregular); null quando não segue.
 */
export function parcelaDoTitulo(nossoNumero, nf) {
  const lido = parseNossoNumero(nossoNumero);
  if (!lido || lido.nf !== nf) return null;
  if (lido.formato === 'irregular') return lido.parcela;
  return montarNossoNumero(nf, lido.parcela) === nossoNumero ? lido.parcela : null;
}

/**
 * @returns {{ titulos: object[], divergentes: object[], ignoradas: number }}
 *   `titulos` no formato da tabela boletos_caixa (sem origem);
 *   `divergentes` os que têm nosso número fora do padrão da NF do documento;
 *   `ignoradas` linhas que pareciam título mas não deu para ler.
 */
export function lerConsultaTitulos(texto) {
  const linhas = String(texto ?? '').split(/\r?\n/);
  const cabecalho = linhas.find((l) => l.trimStart().startsWith(COLUNAS.nossoNumero));
  if (!cabecalho) throw new Error('Não é o arquivo da Consulta de Títulos da CAIXA (cabeçalho não encontrado).');

  const inicio = Object.fromEntries(Object.entries(COLUNAS).map(([campo, rotulo]) => [campo, cabecalho.indexOf(rotulo)]));
  const faltando = Object.entries(inicio).filter(([, i]) => i < 0).map(([campo]) => COLUNAS[campo]);
  if (faltando.length > 0) throw new Error(`Colunas não encontradas no arquivo: ${faltando.join(', ')}.`);
  const ordem = Object.entries(inicio).sort((a, b) => a[1] - b[1]);
  const campo = (linha, nome) => {
    const i = ordem.findIndex(([n]) => n === nome);
    return linha.slice(ordem[i][1], ordem[i + 1]?.[1] ?? linha.length).trim();
  };

  const titulos = [];
  const divergentes = [];
  let ignoradas = 0;
  for (const linha of linhas) {
    if (!/^\s*\d{17}\s/.test(linha)) continue;
    const nossoNumero = linha.trim().split(/\s+/)[0];
    const documento = campo(linha, 'documento');
    const nf = Number(documento.match(/^\d+/)?.[0]);
    const valor = valorBr(campo(linha, 'valor'));
    const vencimento = dataBr(campo(linha, 'vencimento'));
    if (!nf || !valor || !vencimento) {
      ignoradas++;
      continue;
    }
    const parcela = parcelaDoTitulo(nossoNumero, nf);
    const titulo = {
      nosso_numero: nossoNumero,
      nf_numero: nf,
      parcela,
      valor,
      vencimento,
      situacao: situacaoDoTitulo(campo(linha, 'situacao')),
      data_entrada: dataBr(campo(linha, 'entrada')),
    };
    titulos.push(titulo);
    if (parcela == null) divergentes.push({ nossoNumero, documento });
  }
  return { titulos, divergentes, ignoradas };
}
