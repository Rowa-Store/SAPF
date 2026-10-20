// /olist/gtin — limpeza geral de GTIN: deixa vazio o GTIN (e o GTIN da
// embalagem) de todos os produtos da Olist, pais e variações.
//
// "Procurar" lê a lista inteira de produtos da Olist e junta os que têm GTIN
// (só lê). "Limpar GTIN de todos" grava, um produto por vez, com confirmação
// — ESCREVE NA CONTA DE PRODUÇÃO. Ver useLimpezaGtin.

'use client';

import { useState } from 'react';
import AbasOlist from '@/components/ui/AbasOlist';
import Modal from '@/components/ui/Modal';
import { formatarDataHoraCurta } from '@/lib/format';
import { useLimpezaGtin } from '../hooks/useLimpezaGtin';

// A lista mostra só os próximos da fila — com milhares de itens, a tela pesaria.
const MOSTRAR_NA_FILA = 50;

export default function LimpezaGtin() {
  const {
    estado,
    atual,
    erro,
    aviso,
    setAviso,
    procura,
    itens,
    pendentes,
    comErro,
    limpos,
    iniciar,
    continuarProcura,
    limpar,
    pausar,
  } = useLimpezaGtin();
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
        <h2>Limpar GTIN</h2>
      </div>

      <div className="cartao">
        <p className="fraco" style={{ marginTop: 0 }}>
          Remove o GTIN (e o GTIN da embalagem) do cadastro de todos os produtos da Olist — pais e variações. Primeiro
          procura quem tem GTIN (só lê); depois “Limpar GTIN de todos” grava, um produto por vez.
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
                <button onClick={() => setConfirmando(true)}>Limpar GTIN de todos ({pendentes.length})</button>
              )}
              <button className={procura ? 'secundario' : undefined} onClick={iniciar}>
                {procura ? 'Procurar de novo' : 'Procurar GTINs na Olist'}
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
          {itens.length} com GTIN · {limpos} limpos · {pendentes.length - comErro.length} pendentes
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

      {procura?.concluida && itens.length === 0 && <div className="vazio">Nenhum produto com GTIN na Olist.</div>}
      {procura?.concluida && itens.length > 0 && pendentes.length === 0 && (
        <div className="vazio">GTIN limpo em todos os produtos.</div>
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
                <th>GTIN</th>
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
                    <td>{i.gtin}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {pendentes.length - comErro.length > MOSTRAR_NA_FILA && (
        <p className="fraco">Mostrando os próximos {MOSTRAR_NA_FILA} de {pendentes.length - comErro.length}.</p>
      )}

      <Modal aberto={confirmando} titulo="Limpar GTIN na Olist" aoFechar={() => setConfirmando(false)}>
        <p style={{ marginTop: 0 }}>
          Deixar vazio o GTIN e o GTIN da embalagem de {pendentes.length} produto(s) da Olist — e de todas as variações
          deles? Grava na conta de produção, um produto por vez, e não tem como desfazer em lote.
        </p>
        <div className="grupo-botoes">
          <button
            onClick={() => {
              setConfirmando(false);
              limpar();
            }}
          >
            Limpar GTIN
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
