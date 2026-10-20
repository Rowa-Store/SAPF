// /olist/diagnostico — varredura das diferenças de cadastro entre o Shopify
// e a Olist.
//
// Anda pelos produtos ativos do Shopify de 20 em 20, os mais recentes
// primeiro, e compara cada um com o pai dele na Olist (a mesma comparação do
// cadastro de produtos). Depois da primeira, "atualizar" refaz só o que mudou
// no Shopify ou na Olist desde o último diagnóstico (ver useDiagnosticoOlist). A lista
// mostra só o que tem divergência ou não está cadastrado; os iguais entram
// só na contagem. Por padrão a lista traz só os desatualizados e os sem
// cadastro; "listar todos os problemas" mostra também os que só se corrigem
// na Olist (duplicado, SKU em outro produto, sem SKU). O último diagnóstico fica lembrado neste navegador.
// "Corrigir todos" traz do Shopify o que a lista mostra (ESCREVE NA CONTA DE
// PRODUÇÃO); "Abrir" leva o produto ao cadastro, para ver lado a lado.

'use client';

import { useEffect, useState } from 'react';
import AbasOlist from '@/components/ui/AbasOlist';
import Modal from '@/components/ui/Modal';
import { formatarDataHoraCurta } from '@/lib/format';
import { PROBLEMAS, useDiagnosticoOlist } from '../hooks/useDiagnosticoOlist';

const STATUS_SHOPIFY = { ACTIVE: 'Active', DRAFT: 'Draft', ARCHIVED: 'Archived' };
const POR_CHAVE = Object.fromEntries(PROBLEMAS.map((p) => [p.chave, p]));

// O "listar todos os problemas" fica lembrado neste navegador.
const CHAVE_TODOS = 'sapf:diagnostico-olist:todos-problemas';

const TEXTO_CORRECAO = {
  fila: () => 'na fila',
  enviando: () => 'enviando…',
  relendo: () => 'conferindo…',
  aguardando: ({ segundos }) => `limite — ${segundos}s`,
  gravado: () => 'gravado',
};

/** Estado do "corrigir" na linha do produto. */
function MarcaCorrecao({ correcao, verErro }) {
  if (!correcao) return null;
  if (correcao.estado === 'erro') {
    return (
      <button className="marca marca-erro" onClick={verErro}>
        erro ao corrigir
      </button>
    );
  }
  const classe = correcao.estado === 'gravado' ? 'marca-ok' : 'marca-atacado';
  return <span className={`marca ${classe}`}>{TEXTO_CORRECAO[correcao.estado](correcao)}</span>;
}

function linkDoCadastro(produto) {
  return `/olist?${new URLSearchParams({ busca: produto.sku ?? produto.titulo })}`;
}

export default function DiagnosticoOlist() {
  const {
    estado,
    trabalho,
    concluido,
    conhecidos,
    iguais,
    divergentes,
    falhas,
    atual,
    erro,
    aviso,
    setAviso,
    correcao,
    iniciar,
    continuar,
    pausar,
    corrigir,
  } = useDiagnosticoOlist();
  const [filtro, setFiltro] = useState('todos');
  const [todosProblemas, setTodosProblemas] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  // { titulo, erro } do "erro ao corrigir" clicado
  const [erroAberto, setErroAberto] = useState(null);

  useEffect(() => {
    try {
      setTodosProblemas(window.localStorage.getItem(CHAVE_TODOS) === '1');
    } catch {
      // Sem localStorage: fica o padrão.
    }
  }, []);

  function trocarTodosProblemas(marcado) {
    setTodosProblemas(marcado);
    if (!marcado && filtro !== 'todos' && !POR_CHAVE[filtro].principal) setFiltro('todos');
    try {
      window.localStorage.setItem(CHAVE_TODOS, marcado ? '1' : '0');
    } catch {
      // Só não fica lembrado.
    }
  }

  const listados = PROBLEMAS.filter((p) => todosProblemas || p.principal);
  const chavesListadas = new Set(listados.map((p) => p.chave));
  // Problemas e detalhes do produto que a lista mostra.
  const comListados = divergentes
    .map((p) => ({
      ...p,
      problemas: p.problemas.filter((c) => chavesListadas.has(c)),
      detalhes: p.detalhes.filter((d) => chavesListadas.has(d.problema)),
    }))
    .filter((p) => p.problemas.length);
  const escondidos = divergentes.length - comListados.length;

  const rodando = estado === 'rodando' || estado === 'pausando';
  const atualizando = trabalho?.modo === 'atualizacao';
  const corrigindo = estado === 'corrigindo';
  const visiveis = filtro === 'todos' ? comListados : comListados.filter((p) => p.problemas.includes(filtro));
  const corrigiveis = visiveis.filter((p) => p.enviaveis?.length);
  const skusACorrigir = corrigiveis.reduce((n, p) => n + p.enviaveis.length, 0);
  const contagens = Object.fromEntries(
    listados.map((p) => [p.chave, comListados.filter((d) => d.problemas.includes(p.chave)).length])
  );

  return (
    <>
      <AbasOlist />
      <div className="cabecalho-pagina">
        <h2>Diagnóstico</h2>
      </div>

      <div className="cartao">
        <p className="fraco" style={{ marginTop: 0 }}>
          Compara os produtos ativos do Shopify com a Olist, de 20 em 20 e dos mais recentes para os mais antigos, e lista
          os que estão diferentes ou não cadastrados. “Atualizar” refaz só o que mudou no Shopify ou na Olist desde o
          último diagnóstico. A varredura só lê; o “Corrigir todos” é que grava na Olist.
        </p>
        <div className="grupo-botoes">
          {rodando || corrigindo ? (
            <button className="secundario" onClick={pausar} disabled={estado === 'pausando'}>
              {estado === 'pausando' ? 'Pausando…' : corrigindo ? 'Parar correção' : 'Pausar'}
            </button>
          ) : (
            <>
              {estado === 'pausado' && <button onClick={continuar}>Continuar</button>}
              {concluido && (
                <button className={estado === 'pausado' ? 'secundario' : undefined} onClick={() => iniciar('atualizacao')}>
                  Atualizar diagnóstico
                </button>
              )}
              <button
                className={estado === 'pausado' || concluido ? 'secundario' : undefined}
                onClick={() => iniciar('completo')}
              >
                {estado === 'parado' ? 'Iniciar varredura' : 'Varredura completa'}
              </button>
            </>
          )}
          {concluido && <span className="fraco">Último diagnóstico concluído: {formatarDataHoraCurta(concluido)}</span>}
        </div>
        <label className="campo-check" style={{ marginTop: '0.75rem' }}>
          <input type="checkbox" checked={todosProblemas} onChange={(e) => trocarTodosProblemas(e.target.checked)} />
          Listar todos os problemas — também duplicados, SKU em outro produto e variantes sem SKU
        </label>
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

      {trabalho && !corrigindo && (
        <p className="fraco" role="status">
          {atualizando ? `Atualização desde ${formatarDataHoraCurta(trabalho.base)}` : 'Varredura completa'}
          {trabalho.fase !== 'catalogo' && ` · lote ${trabalho.lotes} · ${trabalho.verificados} verificados agora`}
          {' '}· {conhecidos} no diagnóstico · {iguais} iguais · {comListados.length} {todosProblemas ? 'com problema' : 'desatualizados ou sem cadastro'}
          {escondidos > 0 && ` · ${escondidos} com outros problemas (marque “listar todos” para ver)`}
          {falhas.length > 0 && ` · ${falhas.length} com erro`}
          {estado === 'fim' && ' — concluída.'}
          {estado === 'pausado' && ' — pausada.'}
          {trabalho.catalogo.indisponivel && (
            <>
              <br />
              Não deu para ler o catálogo da Olist ({trabalho.catalogo.indisponivel}) — comparando produto a produto, mais
              devagar{atualizando && '; mudanças feitas só na Olist ficam para a varredura completa'}.
            </>
          )}
          {atual && (
            <>
              <br />
              {atual.catalogo
                ? `Lendo o catálogo da Olist — página ${trabalho.catalogo.pagina}` +
                  (trabalho.catalogo.paginas ? ` de ${trabalho.catalogo.paginas}` : '') +
                  ` (${trabalho.catalogo.lidos} registros)` +
                  (atual.segundos ? ` · limite de chamadas, tentando de novo em ${atual.segundos}s` : '…')
                : atual.segundos
                  ? `Limite de chamadas da Olist — tentando “${atual.titulo}” de novo em ${atual.segundos}s`
                  : `Comparando “${atual.titulo}”…`}
            </>
          )}
        </p>
      )}

      {comListados.length > 0 && (
        <div className="filtros-olist" role="group" aria-label="Filtrar produtos">
          {[{ chave: 'todos', rotulo: 'Todos' }, ...listados].map((f) =>
            f.chave !== 'todos' && !contagens[f.chave] ? null : (
              <button
                key={f.chave}
                type="button"
                className={`filtro-chip${filtro === f.chave ? ' ativo' : ''}`}
                aria-pressed={filtro === f.chave}
                onClick={() => setFiltro(f.chave)}
              >
                {f.rotulo}{' '}
                <span className="filtro-contagem">{f.chave === 'todos' ? comListados.length : contagens[f.chave]}</span>
              </button>
            )
          )}
        </div>
      )}

      {estado === 'fim' && comListados.length === 0 && falhas.length === 0 && (
        <div className="vazio">
          {escondidos ? 'Nada desatualizado nem sem cadastro.' : 'Tudo igual entre o Shopify e a Olist.'}
        </div>
      )}

      {visiveis.length > 0 && corrigiveis.length > 0 && (
        <div className="barra-lote">
          <span className="barra-lote-contagem">
            {corrigiveis.length} produto(s) dá para corrigir trazendo do Shopify ({skusACorrigir} SKU(s))
            {corrigiveis.length < visiveis.length && ` · ${visiveis.length - corrigiveis.length} só se corrigem na Olist`}
          </span>
          <button onClick={() => setConfirmando(true)} disabled={rodando || corrigindo}>
            {corrigindo ? 'Corrigindo…' : `Corrigir todos (${corrigiveis.length})`}
          </button>
        </div>
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
                  <td className="fraco">{p.detalhes.map((d) => d.texto).join(' · ')}</td>
                  <td>
                    <MarcaCorrecao
                      correcao={correcao[p.id]}
                      verErro={() => setErroAberto({ titulo: p.titulo, erro: correcao[p.id].erro })}
                    />
                  </td>
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

      <Modal aberto={confirmando} titulo="Corrigir na Olist" aoFechar={() => setConfirmando(false)}>
        <p style={{ marginTop: 0 }}>
          Trazer do Shopify {skusACorrigir} SKU(s) de {corrigiveis.length} produto(s)
          {filtro !== 'todos' && ' (só os do filtro atual)'}? Grava na conta de produção da Olist, um produto por vez.
        </p>
        <div className="grupo-botoes">
          <button
            onClick={() => {
              setConfirmando(false);
              corrigir(corrigiveis);
            }}
          >
            Corrigir
          </button>
          <button className="secundario" onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </div>
      </Modal>

      <Modal aberto={!!erroAberto} titulo={`Erro ao corrigir ${erroAberto?.titulo ?? ''}`} aoFechar={() => setErroAberto(null)}>
        {erroAberto && <pre className="texto-erro">{erroAberto.erro}</pre>}
      </Modal>
    </>
  );
}
