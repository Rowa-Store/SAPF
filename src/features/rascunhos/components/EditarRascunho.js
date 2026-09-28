// /transferencias/[id]/rascunho/editar — corrige um rascunho já criado no
// Tiny. `tipo` escolhe a API e para onde voltar. Rascunho de pedido de
// atacado não passa por aqui: depois de enviado ao Tiny, não é editado.
//
// A tela deixa explícito, antes e depois de salvar, que o rascunho antigo
// não some sozinho: ver useEditarRascunho para o porquê.

'use client';

import { useState } from 'react';
import Paginacao from '@/components/ui/Paginacao';
import { CAMPOS_CLIENTE } from '@/lib/fiscal/camposCliente';
import { formatarMoeda } from '@/lib/format';
import { useEditarRascunho } from '../hooks/useEditarRascunho';

// Duração da transição de saída da linha (ver .linha-saindo em globals.css) —
// a remoção de verdade só acontece depois, senão a linha some sem animar.
const DURACAO_ANIMACAO_MS = 250;

const TIPOS = {
  transferencia: {
    api: (id) => `/api/transferencias/${id}/rascunho`,
    rotulo: 'transferência',
    tituloCliente: 'Destinatário na nota (loja de destino)',
    voltar: ['/transferencias', 'Voltar para as transferências'],
  },
};

export default function EditarRascunho({ params, tipo = 'transferencia' }) {
  const { id } = params;
  const config = TIPOS[tipo];
  const [hrefVoltar, rotuloVoltar] = config.voltar;

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
    podeSalvar,
    itensRemovidos,
    atualizarCliente,
    atualizarItem,
    removerItem,
    restaurarItemRemovido,
    restaurarItens,
    confirmarRecriacao,
  } = useEditarRascunho(config.api(id));

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
        <strong>Não foi possível abrir este rascunho.</strong>
        <p>{erroCarregamento}</p>
        <p>
          <a href={hrefVoltar}>{rotuloVoltar}</a>
        </p>
      </div>
    );
  }

  if (!carregado) return <p className="fraco">Lendo o rascunho…</p>;

  if (dados.notaEmitida) {
    return (
      <div className="aviso">
        <strong>Esta nota já foi emitida no Tiny.</strong>
        <p>
          Nota {dados.tinyNotaId} já tem valor fiscal — não é possível recriar um rascunho a partir dela por
          aqui. Qualquer correção agora precisa ser feita à mão, dentro do Tiny.
        </p>
        <p>
          <a href={hrefVoltar}>{rotuloVoltar}</a>
        </p>
      </div>
    );
  }

  return (
    <>
      <h2>
        Editar rascunho — {config.rotulo} {dados.orderName}{' '}
        <span className={`marca marca-${dados.classificacao}`}>{dados.classificacao}</span>
      </h2>

      <div className="aviso">
        <strong>Isto cria um NOVO rascunho no Tiny — não altera o rascunho {dados.tinyNotaId}.</strong>
        <p>
          A API do Tiny não tem como alterar ou excluir uma nota já incluída. Ao salvar, este sistema cria
          outra nota (rascunho) com os dados corrigidos, e o rascunho {dados.tinyNotaId} continua existindo no
          Tiny até você cancelá-lo ou excluí-lo lá dentro, à mão.
        </p>
      </div>

      {dados.tinyNotasSubstituidas?.length > 0 && (
        <div className="aviso">
          <strong>Rascunhos antigos ainda aguardando remoção manual no Tiny:</strong>
          <ul>
            {dados.tinyNotasSubstituidas.map((n) => (
              <li key={n} className="mono">{n}</li>
            ))}
          </ul>
        </div>
      )}

      {resultado && (
        <div className="aviso aviso-ok">
          <strong>Novo rascunho criado no Tiny — nota {resultado.tinyNotaId ?? 'sem id retornado'}.</strong>
          <p>{resultado.mensagem}</p>
          <p>
            <a href={hrefVoltar}>{rotuloVoltar}</a>
          </p>
        </div>
      )}

      {erroEnvio && (
        <div className="aviso">
          <strong>A correção não foi concluída.</strong>
          <p>{erroEnvio}</p>
        </div>
      )}

      <h3>{config.tituloCliente}</h3>
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
            Restaurar valores do rascunho atual
          </button>
        )}
      </h3>

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
                Nenhum item na nota. Use &quot;Restaurar valores do rascunho atual&quot; acima para trazer os itens de volta.
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

      <p style={{ marginTop: '1rem' }}>
        <strong>Total do novo rascunho: {formatarMoeda(totalNota)}</strong>
      </p>

      {!resultado && (
        <>
          <button
            style={{ marginTop: '1.5rem' }}
            onClick={() => setPedindoConfirmacao(true)}
            disabled={!podeSalvar || pedindoConfirmacao}
          >
            Salvar como novo rascunho no Tiny
          </button>

          {pedindoConfirmacao && (
            <div className="confirmacao">
              <p style={{ marginTop: 0 }}>
                <strong>Confirma a criação de um novo rascunho?</strong> Isto grava uma nota real no Tiny de
                produção com os dados acima. O rascunho {dados.tinyNotaId} atual não é apagado — cancele ou
                exclua-o dentro do Tiny depois de confirmar aqui, para não ficar duplicado.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={confirmarRecriacao} disabled={enviando}>
                  {enviando ? 'Enviando…' : 'Sim, criar o novo rascunho'}
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
        <a href={hrefVoltar}>{rotuloVoltar}</a>
      </p>
    </>
  );
}
