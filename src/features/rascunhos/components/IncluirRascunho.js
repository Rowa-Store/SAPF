// /pedidos/[id]/rascunho — conferência e inclusão do rascunho da nota no Tiny.
//
// É a primeira tela que se abre ao clicar num pedido da lista: cliente e itens
// chegam prontos e editáveis, e é aqui que se confere tudo antes de gravar. A
// tela só grava depois de duas ações da pessoa: clicar em "Incluir rascunho" e
// depois confirmar no aviso que aparece.

'use client';

import { useState } from 'react';
import Paginacao from '@/components/ui/Paginacao';
import { CAMPOS_CLIENTE } from '@/lib/fiscal/camposCliente';
import { CATEGORIA_PADRAO, rotuloFormaPagamento } from '@/lib/fiscal/pagamento';
import { ROTULO_FORMA_FRETE, ROTULO_TRANSPORTADORA } from '@/lib/fiscal/transporte';
import { formatarMoeda } from '@/lib/format';
import { useIncluirRascunho } from '../hooks/useIncluirRascunho';

// Duração da transição de saída da linha (ver .linha-saindo em globals.css) —
// a remoção de verdade só acontece depois, senão a linha some sem animar.
const DURACAO_ANIMACAO_MS = 250;

export default function IncluirRascunho({ params }) {
  const { id } = params;

  const {
    dados,
    erroCarregamento,
    pagina,
    setPagina,
    clienteEditado,
    pedindoConfirmacao,
    setPedindoConfirmacao,
    enviando,
    erroEnvio,
    resultado,
    carregado,
    totalPaginas,
    itensDaPagina,
    totalNota,
    itensForamEditados,
    podeIncluir,
    itensRemovidos,
    atualizarCliente,
    atualizarItem,
    removerItem,
    restaurarItemRemovido,
    restaurarItens,
    confirmarInclusao,
  } = useIncluirRascunho(id);

  const [saindoIndices, setSaindoIndices] = useState(() => new Set());

  function handleRemover(indiceGlobal) {
    setSaindoIndices((atual) => new Set(atual).add(indiceGlobal));
    setTimeout(() => {
      removerItem(indiceGlobal);
      setSaindoIndices((atual) => {
        const proximo = new Set(atual);
        proximo.delete(indiceGlobal);
        return proximo;
      });
    }, DURACAO_ANIMACAO_MS);
  }

  if (erroCarregamento && !dados) {
    return (
      <div className="aviso">
        <strong>Não foi possível abrir este pedido.</strong>
        <p>{erroCarregamento}</p>
        <p>
          <a href="/pedidos">Voltar para a tela de atacado</a>
        </p>
      </div>
    );
  }

  if (!carregado) return <p className="fraco">Lendo o pedido…</p>;

  return (
    <>
      <h2>
        Incluir rascunho — pedido {dados.pedido.name}{' '}
        <span className={`marca marca-${dados.classificacao}`}>{dados.classificacao}</span>
      </h2>
      <p className="fraco">
        Confira e corrija o que precisar antes de enviar. É exatamente isto que vai para o Tiny.
      </p>
      <p className="fraco">
        {dados.pedido.totalItens} itens lidos em {dados.pedido.paginasLidas} página(s).
        {dados.pedido.origemCnpj && ` CNPJ encontrado em ${dados.pedido.origemCnpj}.`}
      </p>

      {dados.jaProcessado && (
        <div className="aviso">
          <strong>Este pedido já tem rascunho no Tiny.</strong>
          <p>
            Nota {dados.tinyNotaId ?? 'sem id retornado'} já existe. Criar outra geraria duplicidade —
            cancele ou exclua a nota no Tiny antes de tentar de novo.
          </p>
        </div>
      )}

      {dados.alertas.length > 0 && (
        <div className="aviso">
          <strong>Confira antes de continuar</strong>
          <ul>
            {dados.alertas.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {resultado && (
        <div className="aviso aviso-ok">
          <strong>Rascunho criado no Tiny — nota {resultado.tinyNotaId ?? 'sem id retornado'}.</strong>
          <p>{resultado.mensagem}</p>
          {resultado.contribuinte && (
            <p className={resultado.contribuinte.ok ? 'fraco' : undefined}>
              {resultado.contribuinte.mensagem}
            </p>
          )}
          <p>
            <a href="/pedidos">Voltar para a tela de atacado e emitir a nota</a>
          </p>
        </div>
      )}

      {erroEnvio && (
        <div className="aviso">
          <strong>A inclusão não foi concluída.</strong>
          <p>{erroEnvio}</p>
        </div>
      )}

      <h3>Dados do cliente na nota</h3>
      <div className="cartao campos">
        {CAMPOS_CLIENTE.map(([campo, rotulo]) => (
          <div key={campo}>
            <label htmlFor={campo}>{rotulo}</label>
            <input
              id={campo}
              value={clienteEditado?.[campo] ?? ''}
              onChange={(e) => atualizarCliente(campo, e.target.value)}
              disabled={!!resultado}
            />
          </div>
        ))}
      </div>

      <h3>
        Itens da nota
        {itensForamEditados && (
          <button
            className="secundario"
            style={{ marginLeft: '1rem', padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}
            onClick={restaurarItens}
            disabled={!!resultado}
          >
            Restaurar valores originais
          </button>
        )}
      </h3>
      <p className="fraco">
        Quantidade e valor unitário aqui são os que vão para o Tiny — já incluem o desconto do
        Shopify e, se for atacado, o desconto adicional. Corrija diretamente se algo estiver errado.
      </p>

      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Descrição</th>
            <th className="num">Qtd.</th>
            <th className="num">Valor unitário</th>
            <th className="num">Total da linha</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {itensDaPagina.map(({ item, indiceGlobal }) => (
            <tr key={indiceGlobal} className={saindoIndices.has(indiceGlobal) ? 'linha-saindo' : undefined}>
              <td>
                <input
                  className="mono"
                  value={item.codigo}
                  onChange={(e) => atualizarItem(indiceGlobal, 'codigo', e.target.value)}
                  disabled={!!resultado}
                />
              </td>
              <td>
                <input
                  value={item.descricao}
                  onChange={(e) => atualizarItem(indiceGlobal, 'descricao', e.target.value)}
                  disabled={!!resultado}
                />
              </td>
              <td className="num">
                <input
                  type="number"
                  min="0"
                  step="1"
                  style={{ textAlign: 'right' }}
                  value={item.quantidade}
                  onChange={(e) => atualizarItem(indiceGlobal, 'quantidade', e.target.value)}
                  disabled={!!resultado}
                />
              </td>
              <td className="num">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  style={{ textAlign: 'right' }}
                  value={item.valor_unitario}
                  onChange={(e) => atualizarItem(indiceGlobal, 'valor_unitario', e.target.value)}
                  disabled={!!resultado}
                />
              </td>
              <td className="num">{formatarMoeda(Number(item.valor_unitario || 0) * Number(item.quantidade || 0))}</td>
              <td>
                <button
                  className="secundario"
                  style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}
                  onClick={() => handleRemover(indiceGlobal)}
                  disabled={!!resultado || saindoIndices.has(indiceGlobal)}
                >
                  Remover
                </button>
              </td>
            </tr>
          ))}
          {itensDaPagina.length === 0 && (
            <tr>
              <td colSpan={6} className="fraco">
                Nenhum item na nota. Use &quot;Restaurar valores originais&quot; acima para trazer os itens de volta.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <Paginacao pagina={pagina} totalPaginas={totalPaginas} aoMudarPagina={setPagina} />

      {itensRemovidos.length > 0 && (
        <div className="cartao" style={{ marginTop: '1rem' }}>
          <strong>Itens removidos desta nota ({itensRemovidos.length})</strong>
          <table style={{ marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Descrição</th>
                <th className="num">Qtd.</th>
                <th className="num">Valor unitário</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {itensRemovidos.map((item, indice) => (
                <tr key={indice}>
                  <td className="mono">{item.codigo}</td>
                  <td>{item.descricao}</td>
                  <td className="num">{item.quantidade}</td>
                  <td className="num">{formatarMoeda(Number(item.valor_unitario || 0))}</td>
                  <td>
                    <button
                      className="secundario"
                      style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}
                      onClick={() => restaurarItemRemovido(indice)}
                      disabled={!!resultado}
                    >
                      Restaurar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="cartao" style={{ marginTop: '1rem' }}>
        <div>
          <strong>Total da nota: {formatarMoeda(totalNota)}</strong>
        </div>
        <div>Frete: {formatarMoeda(dados.pedido.valorFrete)}</div>
        {/* Desconto do metafield `desconto` do Shopify, já convertido em
            número e abatido do total pelo Tiny — ver desconto.js. */}
        <div>Desconto: {formatarMoeda(dados.pedido.valorDesconto ?? 0)}</div>
        <div>Método de pagamento (Shopify): {dados.pedido.metodoPagamento}</div>
        {/* O que vai na nota nem sempre é o que veio do Shopify: franquia com
            boleto vira "múltiplas" com 3 parcelas (ver pagamento.js). */}
        <div>
          Forma de pagamento na nota:{' '}
          {rotuloFormaPagamento(dados.payload?.nota_fiscal?.forma_pagamento)}
        </div>
        {dados.payload?.nota_fiscal?.parcelas?.length > 0 && (
          <div>
            Parcelas:{' '}
            {dados.payload.nota_fiscal.parcelas
              .map(({ parcela }) => `${parcela.dias} dias (${parcela.data})`)
              .join(', ')}
          </div>
        )}
        {/* Categoria não é campo de nota fiscal na API do Tiny — ver
            pagamento.js. Fica como lembrete em vez de sumir da tela. */}
        <div className="fraco">
          Categoria: preencher como &quot;{CATEGORIA_PADRAO}&quot; dentro do Tiny — a API não aceita
          esse campo.
        </div>
        <div>Transportadora: {ROTULO_TRANSPORTADORA}</div>
        <div>Forma de frete: {ROTULO_FORMA_FRETE}</div>
        {/* O que vai na nota é o número já lido do payload, não o texto cru do
            metafield — se o Shopify não mandou nada, a nota vai com 1 volume e
            o alerta lá em cima avisa. */}
        <div>Quantidade de volumes: {dados.payload?.nota_fiscal?.quantidade_volumes ?? 1}</div>
      </div>

      {!resultado && (
        <>
          <button
            style={{ marginTop: '1.5rem' }}
            onClick={() => setPedindoConfirmacao(true)}
            disabled={!podeIncluir || pedindoConfirmacao}
          >
            Incluir rascunho no Tiny
          </button>

          {pedindoConfirmacao && (
            <div className="confirmacao">
              <p style={{ marginTop: 0 }}>
                <strong>Confirma a inclusão?</strong> Isto grava uma nota real no Tiny de produção,
                mesmo que este pedido seja fictício. Depois de criada, cancelar exige uma ação manual
                dentro do Tiny.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={confirmarInclusao} disabled={enviando}>
                  {enviando ? 'Enviando…' : 'Sim, criar o rascunho'}
                </button>
                <button
                  className="secundario"
                  onClick={() => setPedindoConfirmacao(false)}
                  disabled={enviando}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <p style={{ marginTop: '2rem' }}>
        <a href="/pedidos">Voltar para a tela de atacado</a>
      </p>
    </>
  );
}
