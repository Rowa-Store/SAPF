// statusTitulos.js — status do boleto de um pedido a partir dos títulos da
// CAIXA (tabela boletos_caixa) achados para a NF. Função pura: roda na tela e
// nos testes.
//
//   pendente    nenhum título para a NF
//   parcial     menos títulos que as parcelas da nota (só quando a nota tem
//               parcelas — atacado com boleto vai sem, e aí não dá para saber)
//   divergente  soma dos títulos ≠ total do pedido (tolerância de R$ 0,05),
//               ou dois títulos com o mesmo vencimento
//   liquidado   todos os títulos pagos
//   emitido     o resto
//
// Título baixado na CAIXA (cancelado) não conta para nada.
//
// A conta é feita em centavos inteiros: valor de dinheiro não passa por float.

export const TOLERANCIA_CENTAVOS = 5;

/** "1234.5" / 1234.5 -> 123450. null para vazio. */
export function centavos(valor) {
  if (valor == null || valor === '') return null;
  const [inteiro, decimal = ''] = String(valor).trim().split('.');
  const sinal = inteiro.startsWith('-') ? -1 : 1;
  return sinal * (Math.abs(Number(inteiro)) * 100 + Number(decimal.padEnd(2, '0').slice(0, 2)));
}

/**
 * @param {object} p
 * @param {Array<{ nosso_numero, parcela, valor, vencimento, situacao }>} p.titulos
 * @param {number|string} p.total total do pedido
 * @param {number|null} [p.parcelasEsperadas] nº de parcelas da nota, se houver
 * @returns {{ status, diferenca, motivos: string[] }} `diferenca` em centavos
 *   (soma dos títulos − total); null sem títulos
 */
export function statusBoletoCaixa({ titulos = [], total, parcelasEsperadas = null }) {
  titulos = titulos.filter((t) => t.situacao !== 'baixado');
  if (titulos.length === 0) return { status: 'pendente', diferenca: null, motivos: [] };

  const motivos = [];
  const semValor = titulos.some((t) => t.valor == null);
  const soma = titulos.reduce((s, t) => s + (centavos(t.valor) ?? 0), 0);
  const totalCentavos = centavos(Number(total ?? 0).toFixed(2));
  const diferenca = soma - totalCentavos;

  const porVencimento = new Map();
  for (const t of titulos) if (t.vencimento) porVencimento.set(t.vencimento, (porVencimento.get(t.vencimento) ?? 0) + 1);
  const repetidos = [...porVencimento].filter(([, n]) => n > 1).map(([v]) => v);
  if (repetidos.length > 0) motivos.push(`Mais de um título vencendo em ${repetidos.join(', ')}`);

  const faltam = parcelasEsperadas ? parcelasEsperadas - titulos.length : 0;
  if (repetidos.length === 0 && faltam > 0) {
    return { status: 'parcial', diferenca, motivos: [`${titulos.length} de ${parcelasEsperadas} parcelas na CAIXA`] };
  }

  if (semValor) motivos.push('Título sem valor lido do PDF');
  else if (Math.abs(diferenca) > TOLERANCIA_CENTAVOS) motivos.push('Soma dos títulos diferente do total do pedido');
  if (motivos.length > 0) return { status: 'divergente', diferenca, motivos };

  if (titulos.every((t) => t.situacao === 'liquidado')) return { status: 'liquidado', diferenca, motivos };
  return { status: 'emitido', diferenca, motivos };
}
