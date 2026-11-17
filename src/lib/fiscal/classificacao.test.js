import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cnpjDoCadastro, extrairCnpj, extrairDocumento } from './classificacao.js';

const doPedido = [{ key: 'info_document', value: '48372567000115' }];

test('o CNPJ do cadastro do cliente vale mais que o do pedido', () => {
  const pedido = { customer: { cnpj: { value: '43414452000122' } }, customAttributes: doPedido };
  assert.deepEqual(extrairCnpj(pedido), { cnpj: '43414452000122', origem: 'cadastro do cliente (custom.cnpj)' });
  assert.equal(extrairDocumento(pedido).documento, '43414452000122');
});

test('cadastro em branco cai para o documento do pedido', () => {
  const pedido = { customer: { cnpj: null }, customAttributes: doPedido };
  assert.deepEqual(extrairCnpj(pedido), { cnpj: '48372567000115', origem: 'customAttributes.info_document' });
});

test('metafield inteiro perde o zero à esquerda: completa e confere os dígitos', () => {
  assert.equal(cnpjDoCadastro('3746514000189'), '03746514000189');
  assert.equal(cnpjDoCadastro('7169245000196'), '07169245000196');
  assert.equal(cnpjDoCadastro('1234567000100'), ''); // dígitos verificadores errados
  assert.equal(cnpjDoCadastro(''), '');
  assert.equal(cnpjDoCadastro(undefined), '');
});
