// format.js — formatação para exibição na tela (client-side).
// Diferente de lib/utils.js: aquele formata para o que a API do Tiny espera;
// este formata para o que a pessoa lê na tela.

/** Valor em reais; `null`/`undefined` viram R$ 0,00. */
export function formatarMoeda(valor) {
  return Number(valor ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Igual a `formatarMoeda`, mas `null`/`undefined` viram "—" em vez de R$ 0,00. */
export function formatarMoedaOuTraco(valor) {
  return valor == null ? '—' : Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** dd/mm/aa. */
export function formatarDataCurta(iso) {
  return iso
    ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '—';
}

/** dd/mm/aa hh:mm. */
export function formatarDataHoraCurta(iso) {
  return iso
    ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
}

/** 00.000.000/0000-00 — aceita com ou sem máscara; o que não tem 14 dígitos
 *  volta como veio, para a pessoa ver o que foi digitado. */
export function formatarCnpj(valor) {
  const d = String(valor ?? '').replace(/\D+/g, '');
  if (d.length !== 14) return String(valor ?? '');
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
