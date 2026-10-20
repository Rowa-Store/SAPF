// /olist/diagnostico — varredura das diferenças de cadastro entre o Shopify
// e a Olist.
//
// Anda pelos produtos ativos do Shopify de 20 em 20 e compara cada um com o
// pai dele na Olist (a mesma comparação do cadastro de produtos). A lista
// mostra só o que tem divergência ou não está cadastrado; os iguais entram
// só na contagem. "Abrir" leva o produto ao cadastro, onde dá para trazer
// do Shopify.

'use client';

import { useState } from 'react';
import AbasOlist from '@/components/ui/AbasOlist';
import { PROBLEMAS, useDiagnosticoOlist } from '../hooks/useDiagnosticoOlist';

const STATUS_SHOPIFY = { ACTIVE: 'Active', DRAFT: 'Draft', ARCHIVED: 'Archived' };
const POR_CHAVE = Object.fromEntries(PROBLEMAS.map((p) => [p.chave, p]));

function linkDoCadastro(produto) {
  return `/olist?${new URLSearchParams({ busca: produto.sku ?? produto.titulo })}`;
}

export default function DiagnosticoOlist() {
  const { estado, lotes, verificados, iguais, divergentes, falhas, atual, erro, iniciar, continuar, pausar } =
    useDiagnosticoOlist();
  const [filtro, setFiltro] = useState('todos');

  const rodando = estado === 'rodando' || estado === 'pausando';
  const visiveis = filtro === 'todos' ? divergentes : divergentes.filter((p) => p.problemas.includes(filtro));
  const contagens = Object.fromEntries(
    PROBLEMAS.map((p) => [p.chave, divergentes.filter((d) => d.problemas.includes(p.chave)).length])
  );

  return (
    <>
      <AbasOlist />
      <div className="cabecalho-pagina">
        <h2>Diagnóstico</h2>
      </div>

      <div className="cartao">
        <p className="fraco" style={{ marginTop: 0 }}>
          Compara todos os produtos ativos do Shopify com a Olist, de 20 em 20, e lista os que estão diferentes ou não
          cadastrados. Só lê — nada é gravado.
        </p>
        <div className="grupo-botoes">
          {rodando ? (
            <button className="secundario" onClick={pausar} disabled={estado === 'pausando'}>
              {estado === 'pausando' ? 'Pausando…' : 'Pausar'}
            </button>
          ) : (
            <>
              {estado === 'pausado' && <button onClick={continuar}>Continuar</button>}
              <button className={estado === 'pausado' ? 'secundario' : undefined} onClick={iniciar}>
                {estado === 'parado' ? 'Iniciar varredura' : 'Recomeçar varredura'}
              </button>
            </>
          )}
        </div>
      </div>

      {erro && (
        <div className="aviso">
          <p style={{ margin: 0 }}>{erro}</p>
        </div>
      )}

      {estado !== 'parado' && (
        <p className="fraco" role="status">
          Lote {lotes} · {verificados} produto(s) verificados · {iguais} iguais · {divergentes.length} com diferença
          {falhas.length > 0 && ` · ${falhas.length} com erro`}
          {estado === 'fim' && ' — varredura concluída.'}
          {estado === 'pausado' && ' — pausada.'}
          {atual && (
            <>
              <br />
              {atual.segundos
                ? `Limite de chamadas da Olist — tentando “${atual.titulo}” de novo em ${atual.segundos}s`
                : `Comparando “${atual.titulo}”…`}
            </>
          )}
        </p>
      )}

      {divergentes.length > 0 && (
        <div className="filtros-olist" role="group" aria-label="Filtrar produtos">
          {[{ chave: 'todos', rotulo: 'Todos' }, ...PROBLEMAS].map((f) =>
            f.chave !== 'todos' && !contagens[f.chave] ? null : (
              <button
                key={f.chave}
                type="button"
                className={`filtro-chip${filtro === f.chave ? ' ativo' : ''}`}
                aria-pressed={filtro === f.chave}
                onClick={() => setFiltro(f.chave)}
              >
                {f.rotulo}{' '}
                <span className="filtro-contagem">{f.chave === 'todos' ? divergentes.length : contagens[f.chave]}</span>
              </button>
            )
          )}
        </div>
      )}

      {estado === 'fim' && divergentes.length === 0 && falhas.length === 0 && (
        <div className="vazio">Tudo igual entre o Shopify e a Olist.</div>
      )}

      {visiveis.length > 0 && (
        <div className="tabela-rolavel">
          <table className="tabela-controle">
            <thead>
              <tr>
                <th>Produto no Shopify</th>
                <th>Problema</th>
                <th>Detalhe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.titulo}
                    {p.status && p.status !== 'ACTIVE' && (
                      <span className="fraco"> · {STATUS_SHOPIFY[p.status] ?? p.status}</span>
                    )}
                  </td>
                  <td>
                    {p.problemas.map((c) => (
                      <span key={c} className={`marca ${POR_CHAVE[c].classe}`} style={{ marginRight: '0.3rem' }}>
                        {POR_CHAVE[c].rotulo}
                      </span>
                    ))}
                  </td>
                  <td className="fraco">{p.detalhes.join(' · ')}</td>
                  <td>
                    <a href={linkDoCadastro(p)} target="_blank" rel="noreferrer">
                      Abrir
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {falhas.length > 0 && (
        <div className="cartao" style={{ marginTop: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Não deu para comparar</h3>
          <ul>
            {falhas.map((f) => (
              <li key={f.id}>
                {f.titulo} — <span className="fraco">{f.erro}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
