// nossoNumero.js — o "nosso número" dos boletos da CAIXA (e-Cobrança) e o
// link do PDF de cada um. Funções puras: sem rede, sem banco.
//
// Padrão dos boletos da Rowa (17 dígitos, sem o DV):
//
//   14 + nº da NF com zeros à esquerda até 13 dígitos + parcela em 2 dígitos
//   ex.: NF 24515, parcela 1 -> 14000000002451501
//
// Exceção vista na CAIXA: 14000000024518002 (NF 24518) é 14 + 7 zeros + NF +
// parcela em 3 dígitos — título duplicado/de correção. Esse formato é
// reconhecido por parseNossoNumero, mas NUNCA gerado: não dá para saber de
// antemão que ele existe.

const PREFIXO = '14';

/** Nosso número padrão (17 dígitos, sem DV) da parcela `parcela` da NF `nf`. */
export function montarNossoNumero(nf, parcela) {
  if (!Number.isInteger(nf) || nf <= 0 || String(nf).length > 13) throw new Error(`NF inválida: ${nf}`);
  if (!Number.isInteger(parcela) || parcela < 1 || parcela > 99) throw new Error(`Parcela inválida: ${parcela}`);
  return `${PREFIXO}${String(nf).padStart(13, '0')}${String(parcela).padStart(2, '0')}`;
}

/**
 * NF e parcela de um nosso número (com ou sem o DV "-4" do final).
 * `formato` é 'padrao' ou 'irregular' (14 + 7 zeros + NF + parcela em 3
 * dígitos). Devolve null para o que não segue nenhum dos dois.
 */
export function parseNossoNumero(n) {
  const digitos = String(n ?? '').trim().replace(/-\d$/, '');
  if (!/^\d{17}$/.test(digitos) || !digitos.startsWith(PREFIXO)) return null;

  // Com NF de 5 dígitos (a Rowa está na casa dos 24 mil), o padrão tem 8 zeros
  // depois do 14 e o irregular só 7. A partir da NF 100000 os dois formatos
  // geram a mesma string e esta leitura passa a errar — rever aqui antes.
  const irregular = digitos.match(/^140{7}([1-9]\d{4})(\d{3})$/);
  if (irregular) {
    return { nf: Number(irregular[1]), parcela: Number(irregular[2]), formato: 'irregular' };
  }
  const nf = Number(digitos.slice(2, 15));
  const parcela = Number(digitos.slice(15));
  if (nf === 0 || parcela === 0) return null;
  return { nf, parcela, formato: 'padrao' };
}

/**
 * Link do PDF do boleto no e-Cobrança. Abre sem login: devolve o PDF, ou um
 * texto "BOLETO NAO ENCONTRADO" (também com HTTP 200) quando o título não
 * existe. O código do beneficiário vem de CAIXA_CEDENTE.
 */
export function urlBoletoPdf(nossoNumero, cedente = process.env.CAIXA_CEDENTE) {
  if (!/^\d+$/.test(String(cedente ?? ''))) throw new Error('CAIXA_CEDENTE não configurado.');
  return `https://boletoonline.caixa.gov.br/ecobranca/SIGCB/imprimir/${cedente}/${nossoNumero}`;
}
