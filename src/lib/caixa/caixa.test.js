// Testes dos utilitários da CAIXA: `npm test` (node:test, sem dependência).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { montarNossoNumero, parseNossoNumero, urlBoletoPdf } from './nossoNumero.js';
import { dataDoFator, lerBoletoPdf, lerLinhaDigitavel } from './boletoPdf.js';
import { centavos, statusBoletoCaixa } from './statusTitulos.js';
import { lerConsultaTitulos, parcelaDoTitulo } from './consultaTitulos.js';

test('montarNossoNumero segue 14 + NF(13) + parcela(2)', () => {
  assert.equal(montarNossoNumero(24515, 1), '14000000002451501');
  assert.equal(montarNossoNumero(24515, 2), '14000000002451502');
  assert.equal(montarNossoNumero(24602, 3), '14000000002460203');
  assert.throws(() => montarNossoNumero(0, 1));
  assert.throws(() => montarNossoNumero(24515, 0));
  assert.throws(() => montarNossoNumero(24515, 100));
});

test('parseNossoNumero lê o padrão e o formato irregular', () => {
  assert.deepEqual(parseNossoNumero('14000000002451501'), { nf: 24515, parcela: 1, formato: 'padrao' });
  assert.deepEqual(parseNossoNumero('14000000002460203-4'), { nf: 24602, parcela: 3, formato: 'padrao' });
  assert.deepEqual(parseNossoNumero('14000000024518002'), { nf: 24518, parcela: 2, formato: 'irregular' });
  assert.equal(parseNossoNumero('24000000002451501'), null);
  assert.equal(parseNossoNumero('1400000000245150'), null);
  assert.equal(parseNossoNumero(null), null);
});

// Vale para NF de até 5 dígitos — ver o comentário em parseNossoNumero.
test('montar e ler são inversos', () => {
  for (const [nf, parcela] of [[24515, 1], [24619, 3], [99999, 12], [7, 1]]) {
    const { nf: n, parcela: p } = parseNossoNumero(montarNossoNumero(nf, parcela));
    assert.deepEqual([n, p], [nf, parcela]);
  }
});

test('urlBoletoPdf usa o cedente e exige que ele exista', () => {
  assert.equal(
    urlBoletoPdf('14000000002451501', '1248934'),
    'https://boletoonline.caixa.gov.br/ecobranca/SIGCB/imprimir/1248934/14000000002451501'
  );
  assert.throws(() => urlBoletoPdf('14000000002451501', ''));
});

test('fator de vencimento usa a base de 22/02/2025', () => {
  assert.equal(dataDoFator('1000'), '2025-02-22');
  assert.equal(dataDoFator('1641'), '2026-11-25');
  assert.equal(dataDoFator('0000'), null);
});

test('lerLinhaDigitavel tira valor e vencimento do último campo', () => {
  const linha = lerLinhaDigitavel('xx 10491.24892 34000.100049 00245.150172 2 16410000332886 yy');
  assert.deepEqual(linha, {
    linhaDigitavel: '10491248923400010004900245150172216410000332886',
    valor: '3328.86',
    vencimento: '2026-11-25',
  });
  assert.equal(lerLinhaDigitavel('sem linha'), null);
});

test('lerBoletoPdf reconhece "não encontrado" e lê o texto Flate do PDF', () => {
  assert.deepEqual(lerBoletoPdf(Buffer.from('BOLETO NAO ENCONTRADO')), { encontrado: false });

  const conteudo = deflateSync('BT (Vencimento) Tj (10491.24892 34000.100049 00245.150172 2 16410000332886) Tj ET');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj <</Filter /FlateDecode>> stream\n'), conteudo, Buffer.from('\nendstream\n')]);
  assert.deepEqual(lerBoletoPdf(pdf), {
    encontrado: true,
    valor: '3328.86',
    vencimento: '2026-11-25',
    linhaDigitavel: '10491248923400010004900245150172216410000332886',
  });
});

test('centavos não passa por float', () => {
  assert.equal(centavos('3328.86'), 332886);
  assert.equal(centavos('0.1'), 10);
  assert.equal(centavos(10), 1000);
  assert.equal(centavos(null), null);
});

// Casos reais (valores ilustrativos; o que importa é a diferença).
const t = (parcela, vencimento, valor, extra = {}) => ({
  nosso_numero: montarNossoNumero(24515, parcela),
  parcela,
  vencimento,
  valor,
  situacao: 'em_aberto',
  ...extra,
});

test('#80421 (NF 24515): 3 títulos batendo o total -> emitido', () => {
  const titulos = [t(1, '2026-11-25', '3328.86'), t(2, '2026-12-10', '3328.86'), t(3, '2026-12-25', '3328.87')];
  assert.equal(statusBoletoCaixa({ titulos, total: 9986.59, parcelasEsperadas: 3 }).status, 'emitido');
});

test('#80428 (NF 24518): 2 títulos no mesmo vencimento -> divergente', () => {
  const titulos = [
    t(1, '2026-11-25', '1000.00'),
    t(2, '2026-11-25', '1000.00'),
    t(3, '2026-12-25', '1000.00'),
    { ...t(2, '2026-12-10', '1000.00'), nosso_numero: '14000000024518002' },
  ];
  const r = statusBoletoCaixa({ titulos, total: 3000, parcelasEsperadas: 3 });
  assert.equal(r.status, 'divergente');
  assert.match(r.motivos[0], /2026-11-25/);
});

test('#80482 (NF 24602): soma R$ 0,70 abaixo -> divergente', () => {
  const titulos = [t(1, '2026-11-25', '100.00'), t(2, '2026-12-10', '100.00'), t(3, '2026-12-25', '99.30')];
  const r = statusBoletoCaixa({ titulos, total: '300.00', parcelasEsperadas: 3 });
  assert.equal(r.status, 'divergente');
  assert.equal(r.diferenca, -70);
});

test('#80493 (NF 24619): soma R$ 0,20 abaixo -> divergente; R$ 0,05 passa', () => {
  const base = [t(1, '2026-11-25', '100.00'), t(2, '2026-12-10', '100.00')];
  assert.equal(statusBoletoCaixa({ titulos: [...base, t(3, '2026-12-25', '99.80')], total: 300 }).status, 'divergente');
  assert.equal(statusBoletoCaixa({ titulos: [...base, t(3, '2026-12-25', '99.95')], total: 300 }).status, 'emitido');
});

test('#80440 / #80497: sem títulos -> pendente', () => {
  assert.equal(statusBoletoCaixa({ titulos: [], total: 500 }).status, 'pendente');
});

test('parcial só quando a nota diz quantas parcelas tem', () => {
  const titulos = [t(1, '2026-11-25', '100.00')];
  assert.equal(statusBoletoCaixa({ titulos, total: 300, parcelasEsperadas: 3 }).status, 'parcial');
  assert.equal(statusBoletoCaixa({ titulos, total: 300 }).status, 'divergente');
});

test('liquidado quando todos os títulos estão pagos', () => {
  const titulos = [t(1, '2026-11-25', '150.00', { situacao: 'liquidado' }), t(2, '2026-12-10', '150.00', { situacao: 'liquidado' })];
  assert.equal(statusBoletoCaixa({ titulos, total: 300 }).status, 'liquidado');
  titulos[1].situacao = 'em_aberto';
  assert.equal(statusBoletoCaixa({ titulos, total: 300 }).status, 'emitido');
});

test('título baixado não conta', () => {
  const titulos = [
    t(1, '2026-11-25', '150.00'),
    t(2, '2026-11-25', '150.00', { situacao: 'baixado' }),
    t(2, '2026-12-10', '150.00', { nosso_numero: '14000000024515002' }),
  ];
  assert.equal(statusBoletoCaixa({ titulos, total: 300 }).status, 'emitido');
  assert.equal(statusBoletoCaixa({ titulos: [titulos[1]], total: 300 }).status, 'pendente');
});

// Linhas no formato do arquivo real da Consulta de Títulos, com sacado fictício.
const CABECALHO =
  'NOSSO NUMERO          NUM.DOCUMENTO      NOME DO SACADO                              VALOR DO TITULO    DT.VENCTO     SITUACAO                                 ULTIMO COMANDO    DT.ENTRADA';
const linha = (nn, doc, valor, venc, situacao = 'EM ABERTO') =>
  ` ${nn.padEnd(21)}${doc.padEnd(19)}${'CLIENTE EXEMPLO LTDA'.padEnd(44)}${valor.padStart(15)}    ${venc}    ${situacao.padEnd(41)}28.09.2026        28.09.2026`;

test('lerConsultaTitulos lê o arquivo de largura fixa da CAIXA', () => {
  const texto = [
    'CONSULTA DE TITULOS',
    '',
    '-'.repeat(200),
    CABECALHO,
    '-'.repeat(200),
    linha('14000000002451501', '24515', '3.328,86', '25.11.2026'),
    '',
    linha('14000000024518002', '24518', '26.225,13', '10.12.2026', 'LIQUIDADO'),
    linha('14000000002168103', '21681  /003/003', '11.824,72', '10.11.2026'),
    linha('14000000002343102', '24341', '100,00', '10.11.2026', 'BAIXADO'),
    linha('14000000000022418', '022418', '4.406,63', '28.10.2026', 'PROTESTADO'),
  ].join('\r\n');
  const { titulos, divergentes, ignoradas } = lerConsultaTitulos(texto);
  assert.equal(ignoradas, 0);
  assert.deepEqual(titulos[0], {
    nosso_numero: '14000000002451501',
    nf_numero: 24515,
    parcela: 1,
    valor: '3328.86',
    vencimento: '2026-11-25',
    situacao: 'em_aberto',
    data_entrada: '2026-09-28',
  });
  assert.deepEqual(
    titulos.map((x) => [x.nf_numero, x.parcela, x.situacao]),
    [[24515, 1, 'em_aberto'], [24518, 2, 'liquidado'], [21681, 3, 'em_aberto'], [24341, null, 'baixado'], [22418, null, 'outro']]
  );
  assert.deepEqual(divergentes.map((d) => d.nossoNumero), ['14000000002343102', '14000000000022418']);
  assert.throws(() => lerConsultaTitulos('outro arquivo qualquer'), /cabeçalho/);
});

test('parcelaDoTitulo só aceita nosso número da própria NF', () => {
  assert.equal(parcelaDoTitulo('14000000002451503', 24515), 3);
  assert.equal(parcelaDoTitulo('14000000024518002', 24518), 2);
  assert.equal(parcelaDoTitulo('14000000002343102', 24341), null);
});
