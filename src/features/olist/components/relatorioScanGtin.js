// Relatório do scan de GTIN para PDF: abre uma janela com o relatório em
// HTML simples, próprio para impressão, e chama a impressão do navegador —
// "Salvar como PDF" no destino gera o arquivo. Sem biblioteca de PDF.

import { formatarDataCurta, formatarDataHoraCurta, formatarMoedaOuTraco } from '@/lib/format';

const STATUS = { ACTIVE: 'Active', DRAFT: 'Draft', ARCHIVED: 'Archived' };

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function htmlDoConflito(conflito, n) {
  const cabecalho = conflito.produtos
    .map(
      (p) =>
        `<li><b>${esc(p.titulo)}</b> <span class="fraco">· ${esc(STATUS[p.status] ?? p.status)}` +
        ` · criado em ${esc(formatarDataCurta(p.criado))}</span></li>`
    )
    .join('');
  const linhas = conflito.gtins
    .flatMap((g) => {
      const ocorrencias = g.porProduto.flatMap((variantes, i) => variantes.map((v) => ({ i, v })));
      return ocorrencias.map(
        ({ i, v }, k) =>
          '<tr>' +
          (k === 0 ? `<td rowspan="${ocorrencias.length}" class="gtin">${esc(g.gtin)}</td>` : '') +
          `<td>${esc(conflito.produtos[i].titulo)}</td><td>${esc(v.opcao)}</td><td>${esc(v.sku || '—')}</td>` +
          `<td class="num">${esc(formatarMoedaOuTraco(v.preco))}</td></tr>`
      );
    })
    .join('');
  return `
    <section>
      <h2>${n}. ${conflito.produtos.length > 1 ? `${conflito.produtos.length} produtos` : 'Mesmo produto'} · ${conflito.gtins.length} GTIN(s) repetido(s)</h2>
      <ul>${cabecalho}</ul>
      <table>
        <thead><tr><th>GTIN</th><th>Produto</th><th>Variante</th><th>SKU</th><th class="num">Preço</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </section>`;
}

/** Abre o relatório dos conflitos dados e a janela de impressão. false se o navegador bloqueou a janela. */
export function abrirRelatorioPdf({ conflitos, trabalho, soAtivos, gtinsDuplicados }) {
  const janela = window.open('', '_blank');
  if (!janela) return false;
  const situacao = trabalho?.temMais
    ? `scan incompleto — ${trabalho.lidos} produtos lidos até agora`
    : `scan concluído em ${formatarDataHoraCurta(trabalho?.fim)} — ${trabalho?.lidos ?? 0} produtos lidos`;
  janela.document.write(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>GTINs duplicados no Shopify — ${esc(formatarDataCurta(new Date().toISOString()))}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font: 11px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a1a1a; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 0 0 4px; }
  .fraco { color: #666; }
  .resumo { margin: 0 0 16px; }
  section { break-inside: avoid; margin: 0 0 14px; padding-top: 10px; border-top: 1px solid #ccc; }
  ul { margin: 0 0 6px; padding-left: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 3px 6px; border: 1px solid #ddd; vertical-align: top; }
  th { background: #f2f2f2; }
  .gtin { font-family: ui-monospace, monospace; font-weight: 600; }
  .num { text-align: right; white-space: nowrap; }
</style></head><body>
  <h1>GTINs duplicados no Shopify</h1>
  <p class="resumo fraco">
    Gerado em ${esc(formatarDataHoraCurta(new Date().toISOString()))} · ${esc(situacao)}
    · ${soAtivos ? 'só produtos ativos' : 'todos os status'}<br>
    <b>${gtinsDuplicados}</b> GTIN(s) repetido(s) em <b>${conflitos.length}</b> conflito(s).
  </p>
  ${conflitos.length ? conflitos.map(htmlDoConflito).join('') : '<p>Nenhum GTIN duplicado.</p>'}
</body></html>`);
  janela.document.close();
  janela.focus();
  janela.print();
  return true;
}
