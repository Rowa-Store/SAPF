// Testes da leitura do XML para o e-mail da nota: `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dadosDoXml } from './emailNotaFranquia.js';

const XML =
  '<nfeProc versao="4.00"><NFe><infNFe versao="4.00" Id="NFe35250251783049000107550010000046911612345678">' +
  '<ide><serie>1</serie><nNF>4691</nNF><dhEmi>2025-02-03T23:30:00-03:00</dhEmi></ide>' +
  '<total><ICMSTot><vProd>1200.00</vProd><vNF>1234.56</vNF></ICMSTot></total>' +
  '</infNFe></NFe><protNFe/></nfeProc>';

test('lê número, série, chave, data (sem fuso) e valor da nota', () => {
  assert.deepEqual(dadosDoXml(XML), {
    numero: '4691',
    serie: '1',
    chave: '35250251783049000107550010000046911612345678',
    emissao: '03/02/2025',
    valor: 1234.56,
  });
});
