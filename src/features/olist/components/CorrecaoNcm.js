// /olist/ncm — correção geral de NCM: grava em todos os produtos da Olist
// (simples, pais e variações) o NCM da regra do código, pelo nome
// (src/lib/fiscal/ncm.js).
//
// "Procurar" lê a lista inteira de produtos da Olist e separa os que têm
// regra (só lê). "Corrigir NCM de todos" confere e grava, um produto por vez,
// com confirmação — ESCREVE NA CONTA DE PRODUÇÃO. Ver useCorrecaoNcm.

'use client';

import { useState } from 'react';
import AbasOlist from '@/components/ui/AbasOlist';
import Modal from '@/components/ui/Modal';
import { formatarDataHoraCurta } from '@/lib/format';
import { useCorrecaoNcm } from '../hooks/useCorrecaoNcm';

// A lista mostra só os próximos da fila — com milhares de itens, a tela pesaria.
const MOSTRAR_NA_FILA = 50;

export default function CorrecaoNcm() {
  const {
    estado,
    atual,
    erro,
    aviso,
    setAviso,
    procura,
    itens,
    semRegra,
    pendentes,
    comErro,
    corrigidos,
    jaCertos,
    iniciar,
    continuarProcura,
    corrigir,
    pausar,
  } = useCorrecaoNcm();
  const [confirmando, setConfirmando] = useState(false);
  // { nome, erro } do "erro" clicado
  const [erroAberto, setErroAberto] = useState(null);

  const ocupado = estado !== 'parado';
  const procuraPela = procura && !procura.concluida;
  const idsComErro = new Set(comErro.map((i) => i.id));

  return (
    <>
      <AbasOlist />
      <div className="cabecalho-pagina">
        <h2>Corrigir NCM</h2>
      </div>

      <div className="cartao">
        <p className="fraco" style={{ marginTop: 0 }}>
          Grava em todos os produtos da Olist — simples, pais e variações — o NCM da regra pelo nome do produto (a
          mesma do cadastro de produtos). Primeiro procura quem tem regra (só lê); depois “Corrigir NCM de todos”
          confere o NCM gravado de cada um e grava só onde estiver diferente, um produto por vez. Produto sem regra
          não é tocado.
        </p>
        <div className="grupo-botoes">
          {ocupado ? (
            <button className="secundario" onClick={pausar} disabled={estado === 'pausando'}>
              {estado === 'pausando' ? 'Pausando…' : 'Pausar'}
            </button>
          ) : (
            <>
              {procuraPela && <button onClick={continuarProcura}>Continuar procura</button>}
              {procura?.concluida && pendentes.length > 0 && (
                <button onClick={() => setConfirmando(true)}>Corrigir NCM de todos ({pendentes.length})</button>
              )}
              <button className={procura ? 'secundario' : undefined} onClick={iniciar}>
                {procura ? 'Procurar de novo' : 'Procurar produtos na Olist'}
              </button>
            </>
          )}
          {procura && <span className="fraco">Procura iniciada em {formatarDataHoraCurta(procura.inicio)}</span>}
        </div>
      </div>

      {aviso && (
        <div className="aviso aviso-ok aviso-fechavel">
          <p style={{ margin: 0 }}>{aviso}</p>
          <button className="secundario pequeno" onClick={() => setAviso(null)} aria-label="Fechar aviso">
            Fechar
          </button>
        </div>
      )}

      {erro && (
        <div className="aviso">
          <p style={{ margin: 0 }}>{erro}</p>
        </div>
      )}

      {procura && (
        <p className="fraco" role="status">
          {procura.lidos} produto(s) lidos
          {procura.paginas ? ` (página ${Math.min(procura.pagina - 1, procura.paginas)} de ${procura.paginas})` : ''} ·{' '}
          {itens.length} com regra · {semRegra.length} sem regra · {corrigidos.length} corrigidos · {jaCertos} já certos ·{' '}
          {pendentes.length - comErro.length} pendentes
          {comErro.length > 0 && ` · ${comErro.length} com erro`}
          {procura.concluida ? '' : ' — procura não terminou.'}
          {atual && (
            <>
              <br />
              {atual.segundos ? `${atual.texto} — limite de chamadas da Olist, tentando de novo em ${atual.segundos}s` : `${atual.texto}…`}
            </>
          )}
        </p>
      )}

      {procura?.concluida && itens.length === 0 && <div className="vazio">Nenhum produto da Olist com regra de NCM.</div>}
      {procura?.concluida && itens.length > 0 && pendentes.length === 0 && (
        <div className="vazio">NCM conferido em todos os produtos com regra.</div>
      )}

      {comErro.length > 0 && (
        <div className="cartao">
          <h3 style={{ marginTop: 0 }}>Com erro</h3>
          <ul>
            {comErro.map((i) => (
              <li key={i.id}>
                {i.nome} <span className="fraco">({i.codigo || `id ${i.id}`})</span> —{' '}
                <button className="marca marca-erro" onClick={() => setErroAberto({ nome: i.nome, erro: i.erro })}>
                  ver erro
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pendentes.length > comErro.length && (
        <div className="tabela-rolavel">
          <table className="tabela-controle">
            <thead>
              <tr>
                <th>Produto na Olist</th>
                <th>Código (SKU)</th>
                <th>NCM da regra</th>
              </tr>
            </thead>
            <tbody>
              {pendentes
                .filter((i) => !idsComErro.has(i.id))
                .slice(0, MOSTRAR_NA_FILA)
                .map((i) => (
                  <tr key={i.id}>
                    <td>{i.nome}</td>
                    <td>{i.codigo || '—'}</td>
                    <td>{i.ncm}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {pendentes.length - comErro.length > MOSTRAR_NA_FILA && (
        <p className="fraco">Mostrando os próximos {MOSTRAR_NA_FILA} de {pendentes.length - comErro.length}.</p>
      )}

      {corrigidos.length > 0 && (
        <details className="cartao filtros-cartao">
          <summary>Corrigidos ({corrigidos.length})</summary>
          <div className="tabela-rolavel">
            <table className="tabela-controle">
              <thead>
                <tr>
                  <th>Produto na Olist</th>
                  <th>Código (SKU)</th>
                  <th>NCM antes</th>
                  <th>NCM agora</th>
                </tr>
              </thead>
              <tbody>
                {corrigidos.map((i) => (
                  <tr key={i.id}>
                    <td>{i.nome}</td>
                    <td>{i.codigo || '—'}</td>
                    <td>{i.de || '(vazio)'}</td>
                    <td>{i.para}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {semRegra.length > 0 && (
        <details className="cartao filtros-cartao">
          <summary>Sem regra de NCM ({semRegra.length}) — não são tocados</summary>
          <ul>
            {semRegra.map((i) => (
              <li key={i.id}>
                {i.nome} <span className="fraco">({i.codigo || `id ${i.id}`})</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Modal aberto={confirmando} titulo="Corrigir NCM na Olist" aoFechar={() => setConfirmando(false)}>
        <p style={{ marginTop: 0 }}>
          Conferir o NCM de {pendentes.length} produto(s) da Olist e gravar o da regra onde estiver diferente? Grava na
          conta de produção, um produto por vez, e não tem como desfazer em lote — a lista de corrigidos guarda o NCM
          de antes.
        </p>
        <div className="grupo-botoes">
          <button
            onClick={() => {
              setConfirmando(false);
              corrigir();
            }}
          >
            Corrigir NCM
          </button>
          <button className="secundario" onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </div>
      </Modal>

      <Modal aberto={!!erroAberto} titulo={`Erro em ${erroAberto?.nome ?? ''}`} aoFechar={() => setErroAberto(null)}>
        {erroAberto && <pre className="texto-erro">{erroAberto.erro}</pre>}
      </Modal>
    </>
  );
}
