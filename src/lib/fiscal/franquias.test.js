// Testes da leitura do cadastro de franquias: `npm test` (node:test, sem dependência).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faltantesDaNota, lerFranquia } from './franquias.js';

test('normaliza o cadastro: markup com vírgula, UF maiúscula, IE em dígitos, Correios = null', () => {
  const lido = lerFranquia({ apelido: ' Loja BH ', markup: '2,6', uf: 'mg', cep: '30140-071', ie: '062.307.904/0081', transportadoraId: '' });
  assert.equal(lido.erro, undefined);
  assert.equal(lido.dados.apelido, 'Loja BH');
  assert.equal(lido.dados.markup, 2.6);
  assert.equal(lido.dados.uf, 'MG');
  assert.equal(lido.ie, '0623079040081');
  assert.equal(lido.transportadoraId, null);
});

test('campo que não veio fica de fora (não mexe no que está gravado)', () => {
  const lido = lerFranquia({ apelido: 'X' });
  assert.deepEqual(Object.keys(lido.dados), ['apelido']);
  assert.equal('ie' in lido, false);
  assert.equal('transportadoraId' in lido, false);
});

test('recusa markup, UF, CEP, e-mail e IE inválidos', () => {
  assert.match(lerFranquia({ markup: '0,5' }).erro, /Markup/);
  assert.match(lerFranquia({ uf: 'XX' }).erro, /UF/);
  assert.match(lerFranquia({ cep: '123' }).erro, /CEP/);
  assert.match(lerFranquia({ email: 'sem-arroba' }).erro, /e-mail/);
  assert.match(lerFranquia({ ie: 'ISENTO' }).erro, /inscrição/);
});

test('nota emitida completa só o que falta no cadastro', () => {
  const cadastro = { razao_social: 'ROWA BH LTDA', cidade: null, telefone: '' };
  const nota = {
    nome: 'Outro Nome', endereco: 'Rua A', numero: '10', bairro: 'Savassi', cep: '30140071',
    cidade: 'Belo Horizonte', uf: 'MG', ie: '123', pais: 'BRASIL',
  };
  assert.deepEqual(faltantesDaNota(cadastro, nota), {
    logradouro: 'Rua A', numero: '10', bairro: 'Savassi', cep: '30140071', cidade: 'Belo Horizonte', uf: 'MG',
  });
});

test('bairro padrão da nota e CEP/UF inválidos não entram no cadastro', () => {
  assert.deepEqual(faltantesDaNota({}, { bairro: 'Centro', cep: '123', uf: 'ZZ' }), {});
});
