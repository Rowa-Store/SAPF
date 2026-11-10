import { test } from 'node:test';
import assert from 'node:assert/strict';
import { podeAcessar, areasDoPapel, buscarPapel, somenteLeituraNoVarejo } from './acessos.js';

function supabaseFalso(resultado) {
  return { from: () => ({ select: () => ({ maybeSingle: async () => resultado }) }) };
}

test('papel vem da tabela acessos; sem linha ou com erro, nenhum', async () => {
  assert.equal(await buscarPapel(supabaseFalso({ data: { papel: 'varejo' }, error: null })), 'varejo');
  assert.equal(await buscarPapel(supabaseFalso({ data: null, error: null })), null);
  assert.equal(await buscarPapel(supabaseFalso({ data: { papel: 'admin' }, error: { message: 'x' } })), null);
});

test('varejo abre só o B2C e as rotas de nota que ele usa', () => {
  assert.ok(podeAcessar('varejo', '/varejo'));
  assert.ok(podeAcessar('varejo', '/api/varejo'));
  assert.ok(podeAcessar('varejo', '/api/varejo/123/preview'));
  for (const acao of ['rascunho', 'emitir', 'situacao', 'danfe']) {
    assert.ok(podeAcessar('varejo', `/api/pedidos/123/${acao}`), acao);
  }
  assert.ok(!podeAcessar('varejo', '/api/pedidos'));
  assert.ok(!podeAcessar('varejo', '/api/pedidos/123/preview'));
  assert.ok(!podeAcessar('varejo', '/api/pedidos/123/email'));
  assert.ok(!podeAcessar('varejo', '/pedidos'));
  assert.ok(!podeAcessar('varejo', '/boletos'));
  assert.ok(!podeAcessar('varejo', '/api/boletos'));
  assert.ok(!podeAcessar('varejo', '/olist'));
  // a contagem de emissões fica no B2C, mas é só do admin
  assert.ok(!podeAcessar('varejo', '/varejo/emissoes'));
  assert.ok(!podeAcessar('varejo', '/api/varejo/emissoes'));
  assert.ok(podeAcessar('admin', '/varejo/emissoes'));
});

test('financeiro abre B2B, boletos e transferências, e não o B2C', () => {
  for (const c of [
    '/pedidos',
    '/pedidos/transportadoras',
    '/pedidos/clientes',
    '/pedidos/123/rascunho',
    '/boletos',
    '/transferencias',
    '/transferencias/9/rascunho/editar',
    '/api/pedidos',
    '/api/pedidos/123/email',
    '/api/boletos/caixa',
    '/api/transferencias/9/emitir',
    '/api/transportadoras/1/clientes',
    '/api/franquias',
  ]) {
    assert.ok(podeAcessar('financeiro', c), c);
  }
  assert.ok(!podeAcessar('financeiro', '/varejo'));
  assert.ok(!podeAcessar('financeiro', '/api/varejo'));
  assert.ok(!podeAcessar('financeiro', '/olist'));
  assert.ok(!podeAcessar('financeiro', '/sysinfo'));
  // prefixo não vaza para nomes parecidos
  assert.ok(!podeAcessar('financeiro', '/boletosx'));
});

test('admin abre tudo; sem papel só a tela inicial', () => {
  assert.ok(podeAcessar('admin', '/olist/ncm'));
  assert.ok(podeAcessar('admin', '/api/saude'));
  assert.ok(podeAcessar(undefined, '/'));
  assert.ok(!podeAcessar(undefined, '/varejo'));
  assert.ok(!podeAcessar('qualquer', '/pedidos'));
});

test('menu segue o papel', () => {
  assert.deepEqual(areasDoPapel('varejo').map((a) => a.href), ['/varejo']);
  assert.deepEqual(areasDoPapel('financeiro').map((a) => a.href), ['/pedidos', '/boletos', '/transferencias']);
  assert.equal(areasDoPapel(undefined).length, 0);
});

test('gerente vê o B2C e a contagem de emissões, sem escrever nada', () => {
  for (const c of [
    '/varejo',
    '/varejo/emissoes',
    '/api/varejo',
    '/api/varejo/emissoes',
    '/api/pedidos/123/situacao',
    '/api/pedidos/123/danfe',
  ]) {
    assert.ok(podeAcessar('gerente', c), c);
  }
  for (const c of [
    '/api/varejo/123/preview',
    '/api/pedidos/123/rascunho',
    '/api/pedidos/123/emitir',
    '/api/pedidos',
    '/pedidos',
    '/boletos',
  ]) {
    assert.ok(!podeAcessar('gerente', c), c);
  }
  assert.deepEqual(areasDoPapel('gerente').map((a) => a.href), ['/varejo']);
});

test('só o B2C do gerente é somente leitura', () => {
  assert.ok(somenteLeituraNoVarejo('gerente'));
  assert.ok(!somenteLeituraNoVarejo('varejo'));
  assert.ok(!somenteLeituraNoVarejo('admin'));
});
