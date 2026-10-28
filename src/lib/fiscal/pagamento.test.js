// Testes da forma de pagamento da nota: `npm test` (node:test, sem dependência).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarPagamento, recalcularParcelas, OBS_PARCELA_FRETE_PIX } from './pagamento.js';

const soma = (parcelas) => parcelas.reduce((s, { parcela }) => s + Math.round(Number(parcela.valor) * 100), 0);
const base = { dataBaseIso: '2026-10-28T12:00:00Z' };

// NF 24807: 15.259,21 de produtos + 434,40 de frete.
test('franquia com boleto: o frete entra nos boletos e as parcelas fecham no total', () => {
  const { pagamento } = montarPagamento({ ...base, classificacao: 'franquia', metodoPagamento: 'Boleto', total: 15259.21, frete: 434.4 });
  assert.equal(pagamento.forma_pagamento, 'multiplas');
  assert.equal(pagamento.condicao_pagamento, '30 45 60');
  assert.deepEqual(pagamento.parcelas.map(({ parcela }) => parcela.valor), ['5231.20', '5231.20', '5231.21']);
});

test('franquia com boleto + PIX do frete: parcela de dia 0 com o frete e 3 boletos da mercadoria', () => {
  const { pagamento } = montarPagamento({ ...base, classificacao: 'franquia', metodoPagamento: 'Boleto + pix (frete)', total: 15259.21, frete: 434.4 });
  assert.equal(pagamento.condicao_pagamento, '0 30 45 60');
  const [frete, ...boletos] = pagamento.parcelas;
  assert.deepEqual(frete.parcela, { dias: 0, data: '28/10/2026', valor: '434.40', obs: OBS_PARCELA_FRETE_PIX, forma_pagamento: 'Conta a Receber' });
  assert.equal(soma(boletos), 1525921);
});

test('atacado com boleto + PIX do frete: parcela do frete e um boleto', () => {
  const { pagamento } = montarPagamento({ ...base, classificacao: 'atacado', metodoPagamento: 'Boleto + Pix', total: 1000, frete: 50 });
  assert.equal(pagamento.forma_pagamento, 'multiplas');
  assert.equal(pagamento.condicao_pagamento, '0 30');
  assert.deepEqual(pagamento.parcelas.map(({ parcela }) => parcela.valor), ['50.00', '1000.00']);
});

test('atacado com boleto puro continua sem parcelas', () => {
  assert.deepEqual(montarPagamento({ ...base, classificacao: 'atacado', metodoPagamento: 'Boleto', total: 1000, frete: 50 }).pagamento, { forma_pagamento: 'boleto_bancario' });
});

test('boleto + PIX sem frete vai só com os boletos', () => {
  const { pagamento } = montarPagamento({ ...base, classificacao: 'franquia', metodoPagamento: 'Boleto + pix (frete)', total: 900, frete: 0 });
  assert.equal(pagamento.condicao_pagamento, '30 45 60');
  assert.equal(soma(pagamento.parcelas), 90000);
});

test('recalcularParcelas mantém o frete na parcela do PIX e reparte o resto nos boletos', () => {
  const { pagamento } = montarPagamento({ ...base, classificacao: 'franquia', metodoPagamento: 'Boleto + pix (frete)', total: 1000, frete: 50 });
  const nota = recalcularParcelas({ ...pagamento, valor_frete: '50.00', valor_desconto: '100.00' }, 1300);
  assert.deepEqual(nota.parcelas.map(({ parcela }) => parcela.valor), ['50.00', '400.00', '400.00', '400.00']);
});

test('recalcularParcelas sem PIX soma o frete nos boletos', () => {
  const { pagamento } = montarPagamento({ ...base, classificacao: 'franquia', metodoPagamento: 'Boleto', total: 1000, frete: 50 });
  const nota = recalcularParcelas({ ...pagamento, valor_frete: '50.00' }, 850);
  assert.equal(soma(nota.parcelas), 90000);
});
