// datas.js — o "dia" da tela de atacado, no fuso da loja.
//
// A lista de pedidos é paginada por dia (AAAA-MM-DD). "Hoje" e os limites
// do dia são sempre os de São Paulo, não os do servidor (Vercel roda em UTC:
// às 22h de Brasília o servidor já estaria no dia seguinte). O Brasil não tem
// mais horário de verão, então o deslocamento é fixo em -03:00.

export const FUSO_LOJA = 'America/Sao_Paulo';
const DESLOCAMENTO = '-03:00';

/** Hoje em São Paulo, como AAAA-MM-DD. */
export function hoje() {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_LOJA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** true para um AAAA-MM-DD que existe no calendário (recusa 2026-02-30). */
export function diaValido(dia) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia ?? ''))) return false;
  const data = new Date(`${dia}T12:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === dia;
}

/** AAAA-MM-DD deslocado em `n` dias (negativo volta). */
export function somarDias(dia, n) {
  const data = new Date(`${dia}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + n);
  return data.toISOString().slice(0, 10);
}

/**
 * Início (inclusivo) e fim (exclusivo) do dia em São Paulo, em UTC no
 * formato que a busca do Shopify aceita ("2026-10-05T03:00:00Z").
 */
export function intervaloDoDia(dia) {
  const emUtc = (d) => new Date(`${d}T00:00:00${DESLOCAMENTO}`).toISOString().replace('.000Z', 'Z');
  return { inicio: emUtc(dia), fim: emUtc(somarDias(dia, 1)) };
}

/** "seg., 05/10/2026" — como o dia aparece na navegação. */
export function formatarDia(dia) {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString('pt-BR', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** AAAA-MM deslocado em `n` meses (negativo volta). */
export function somarMeses(mes, n) {
  const [ano, m] = mes.split('-').map(Number);
  const data = new Date(Date.UTC(ano, m - 1 + n, 1));
  return data.toISOString().slice(0, 7);
}

/** Primeiro e último dia (inclusivos) de um mês AAAA-MM, como AAAA-MM-DD. */
export function intervaloDoMes(mes) {
  return { de: `${mes}-01`, ate: somarDias(`${somarMeses(mes, 1)}-01`, -1) };
}

/** O mês AAAA-MM quando `de`–`ate` cobrem exatamente um mês; senão ''. */
export function mesDoIntervalo(de, ate) {
  if (!de || !de.endsWith('-01')) return '';
  const mes = de.slice(0, 7);
  return intervaloDoMes(mes).ate === ate ? mes : '';
}
