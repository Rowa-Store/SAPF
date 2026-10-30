import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPO_DESCONTO_TINY, comDesconto, descontoComMeiaNota, ehMeiaNota } from './desconto.js';

test('meia nota só para o CNPJ combinado', () => {
  assert.equal(ehMeiaNota('60617401000206'), true);
  assert.equal(ehMeiaNota('11111111000111'), false);
  assert.equal(ehMeiaNota(''), false);
});

test('metade do líquido (itens + frete − desconto) entra como desconto', () => {
  // líquido = 1000 + 50 − 100 = 950 → metade 475 → desconto 575, nota fecha em 475
  assert.equal(descontoComMeiaNota({ desconto: 100, totalItens: 1000, frete: 50, meiaNota: true }), 575);
  assert.equal(descontoComMeiaNota({ desconto: 0, totalItens: 128814.42, meiaNota: true }), 64407.21);
  assert.equal(descontoComMeiaNota({ desconto: 100, totalItens: 1000, frete: 50, meiaNota: false }), 100);
});

test('comDesconto grava no formato do Tiny e tira o campo quando zera', () => {
  assert.deepEqual(comDesconto({ a: 1 }, 575), { a: 1, [CAMPO_DESCONTO_TINY]: '575.00' });
  assert.deepEqual(comDesconto({ a: 1, [CAMPO_DESCONTO_TINY]: '9.00' }, 0), { a: 1 });
});
