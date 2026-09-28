// /pedidos — tela única de atacado: pedidos de atacado e franquia do Shopify
// e a nota fiscal de cada um no Tiny — rascunho (criar e editar), emissão,
// nº da NF e DANFE. Também é onde fica a trava "Permitir emissão".

'use client';

import { Fragment } from 'react';
import IconePdf from '@/components/ui/IconePdf';
import Paginacao from '@/components/ui/Paginacao';
import { formatarDataCurta, formatarMoeda, formatarMoedaOuTraco } from '@/lib/format';
import { useAtacado } from '../hooks/useAtacado';

const COLUNAS = 6;

const DICA_TRAVA = 'Ligue "Permitir emissão" no topo da tela';

function StatusFiscal({ p }) {
  if (p.notaEmitida) {
    return <span className="marca marca-ok">NF emitida{p.numeroNf ? ` nº ${p.numeroNf}` : ''}</span>;
  }
  if (p.status === 'rascunho_criado') {
    return <span className="marca marca-atacado">rascunho {p.tinyNotaId}</span>;
  }
  if (p.status === 'erro') return <span className="marca marca-erro">erro no Tiny</span>;
  return <span className="fraco">sem rascunho</span>;
}

/** Linha de largura total logo abaixo do pedido (confirmação, erro). */
function LinhaDetalhe({ children }) {
  return (
    <tr className="linha-detalhe">
      <td colSpan={COLUNAS}>{children}</td>
    </tr>
  );
}

/** Alertas e total da nota montada agora, mostrados antes de confirmar a criação. */
function ResumoPreview({ preview }) {
  if (!preview || preview.carregando) return <p className="fraco">Montando a nota a partir do Shopify…</p>;
  if (preview.erro) {
    return (
      <div className="aviso">
        <strong>Não foi possível montar a nota.</strong>
        <p style={{ marginBottom: 0 }}>{preview.erro}</p>
      </div>
    );
  }
  const { dados } = preview;
  const nota = dados.payload.nota_fiscal;
  return (
    <>
      <p className="fraco">
        Cliente na nota: {nota.cliente.nome}
        {nota.cliente.cpf_cnpj && <span className="mono"> · CNPJ {nota.cliente.cpf_cnpj}</span>} ·{' '}
        {nota.itens.length} item(ns) · <strong>Total da nota: {formatarMoeda(dados.totalNota)}</strong>
      </p>
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
    </>
  );
}

export default function ControleAtacado() {
  const {
    pedidos,
    erro,
    aviso,
    setAviso,
    filtros,
    atualizarFiltro,
    limparFiltros,
    filtrosAlterados,
    visiveis,
    pedidosDaPagina,
    pagina,
    totalPaginas,
    mudarPagina,
    permitirEmissao,
    alternandoTrava,
    erroTrava,
    alternarPermitirEmissao,
    acoes,
    definirAcao,
    pedirCriacao,
    criarRascunho,
    criarEEmitir,
    emitir,
    conferindo,
    precisaConferir,
    conferirNoTiny,
  } = useAtacado();

  if (erro) {
    return (
      <div className="aviso">
        <strong>Não foi possível carregar os pedidos.</strong>
        <p>{erro}</p>
        <p>Confira as integrações em Sys Info e recarregue.</p>
      </div>
    );
  }

  return (
    <>
      <div className="cabecalho-pagina">
        <h2>Notas de atacado</h2>
      </div>

      <div className={permitirEmissao ? 'aviso aviso-ok' : 'aviso'}>
        <strong>
          Emissão fiscal: {permitirEmissao === null ? 'verificando…' : permitirEmissao ? 'LIBERADA' : 'BLOQUEADA'}
        </strong>
        <p>
          {permitirEmissao
            ? 'Os botões de emitir gravam valor fiscal de verdade no Tiny, de forma irreversível. Vale também para as transferências.'
            : 'Os botões de emitir ficam desabilitados até esta trava ser ligada. Vale também para as transferências.'}
        </p>
        {erroTrava && <p>Não foi possível salvar: {erroTrava}</p>}
        <button
          className={permitirEmissao ? 'secundario' : ''}
          onClick={alternarPermitirEmissao}
          disabled={permitirEmissao === null || alternandoTrava}
        >
          {alternandoTrava ? 'Salvando…' : permitirEmissao ? 'Bloquear emissão' : 'Permitir emissão'}
        </button>
      </div>

      <div className="cartao">
        <div className="campos">
          <div>
            <label htmlFor="busca">Buscar</label>
            <input
              id="busca"
              placeholder="Ex.: #1024, #1030 ou nome do cliente"
              title="Nº do pedido, cliente, CNPJ ou nº da NF — separe vários por vírgula"
              value={filtros.busca}
              onChange={(e) => atualizarFiltro('busca', e.target.value)}
            />
          </div>
        </div>
        <div className="filtros-rodape">
          <div className="filtros">
            <label>
              <input
                type="checkbox"
                checked={filtros.soAtacado}
                onChange={(e) => atualizarFiltro('soAtacado', e.target.checked)}
              />
              Mostrar só atacado e franquia
            </label>
            <label>
              <input
                type="checkbox"
                checked={filtros.naoEmitidas}
                onChange={(e) => atualizarFiltro('naoEmitidas', e.target.checked)}
              />
              Mostrar apenas não emitidas
            </label>
          </div>
          <button className="secundario" onClick={limparFiltros} disabled={!filtrosAlterados}>
            Limpar
          </button>
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

      {!pedidos ? (
        <p className="fraco">Carregando pedidos…</p>
      ) : visiveis.length === 0 ? (
        <div className="vazio">Nenhum pedido corresponde aos filtros.</div>
      ) : (
        <>
          <div className="tabela-rolavel">
            <table className="tabela-controle">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th className="num">Total</th>
                  <th>Classificação</th>
                  <th>Nota fiscal</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {pedidosDaPagina.map((p) => {
                  const acao = acoes[p.id];
                  const enviando = acao?.fase === 'enviando';
                  const temRascunho = p.status === 'rascunho_criado';
                  const podeCriar = !p.notaEmitida && !temRascunho;
                  const previewPronto = !!acao?.preview?.dados;
                  const expandida = acao && !enviando;

                  return (
                    <Fragment key={p.id}>
                      <tr className={expandida ? 'linha-expandida' : undefined}>
                        <td>
                          <div className="mono forte">
                            {p.foraDaLista ? p.name : <a href={`/pedidos/${p.id}/rascunho`}>{p.name}</a>}
                          </div>
                          <div className="fraco">{formatarDataCurta(p.createdAt)}</div>
                        </td>
                        <td>
                          {p.cliente}
                          {p.cnpj && <div className="fraco mono">{p.cnpj}</div>}
                        </td>
                        <td className="num">{formatarMoedaOuTraco(p.total)}</td>
                        <td>
                          <span className={`marca marca-${p.classificacao}`}>{p.classificacao}</span>
                        </td>
                        <td>
                          <div className="pilha">
                            <StatusFiscal p={p} />
                            {p.tinyNotaId && temRascunho && (
                              <a
                                className={`botao-pdf ${p.notaEmitida ? 'botao-pdf-destaque' : ''}`}
                                href={`/api/pedidos/${p.id}/danfe?tinyNotaId=${p.tinyNotaId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={
                                  p.notaEmitida
                                    ? 'Abrir DANFE (salve como PDF pelo diálogo de impressão do navegador)'
                                    : 'Prévia do DANFE — sem valor fiscal até emitir'
                                }
                              >
                                <IconePdf /> {p.notaEmitida ? 'DANFE' : 'Prévia DANFE'}
                              </a>
                            )}
                            {p.tinyNotasSubstituidas?.length > 0 && !p.notaEmitida && (
                              <span
                                className="marca marca-erro"
                                title={`Substituído(s): ${p.tinyNotasSubstituidas.join(', ')} — cancele/exclua no Tiny`}
                              >
                                {p.tinyNotasSubstituidas.length} antigo(s) p/ remover no Tiny
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="acoes-linha">
                            {enviando && <span className="fraco">Enviando…</span>}

                            {podeCriar && (
                              <>
                                <button
                                  className="pequeno"
                                  onClick={() => pedirCriacao(p, 'confirmar-emissao-direta')}
                                  disabled={
                                    !permitirEmissao || enviando || acao?.fase === 'confirmar-emissao-direta'
                                  }
                                  title={permitirEmissao ? 'Cria o rascunho no Tiny e emite em seguida' : DICA_TRAVA}
                                >
                                  Criar e emitir
                                </button>
                                <button
                                  className="pequeno secundario"
                                  onClick={() => pedirCriacao(p, 'confirmar-rascunho')}
                                  disabled={enviando || acao?.fase === 'confirmar-rascunho'}
                                  title="Cria só o rascunho no Tiny, para emitir depois"
                                >
                                  Só rascunho
                                </button>
                                <a
                                  className="botao-link"
                                  href={`/pedidos/${p.id}/rascunho`}
                                  title="Confere item a item e ajusta cliente e itens antes de criar o rascunho"
                                >
                                  Conferir itens
                                </a>
                              </>
                            )}

                            {temRascunho && !p.notaEmitida && (
                              <>
                                <button
                                  className="pequeno"
                                  onClick={() => definirAcao(p.id, { fase: 'confirmar-emissao' })}
                                  disabled={!permitirEmissao || enviando || acao?.fase === 'confirmar-emissao'}
                                  title={permitirEmissao ? undefined : DICA_TRAVA}
                                >
                                  {permitirEmissao ? 'Emitir nota' : 'Emissão bloqueada'}
                                </button>
                                <a
                                  className="botao-link"
                                  href={`/pedidos/${p.id}/rascunho/editar`}
                                  title="Ajusta à mão o cliente e os itens — cria um novo rascunho no Tiny"
                                >
                                  Editar rascunho
                                </a>
                              </>
                            )}

                            {precisaConferir(p) && (
                              <button
                                className="pequeno secundario"
                                onClick={() => conferirNoTiny(p)}
                                disabled={conferindo.has(p.id) || enviando}
                                title="Busca no Tiny se a nota já foi autorizada e o número da NF"
                              >
                                {conferindo.has(p.id) ? 'Conferindo…' : 'Conferir no Tiny'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {acao?.fase === 'confirmar-emissao-direta' && (
                        <LinhaDetalhe>
                          <div className="confirmacao">
                            <p style={{ marginTop: 0 }}>
                              <strong>Criar o rascunho e emitir a nota do pedido {p.name}?</strong> Isso grava a
                              nota no Tiny de produção e dá valor fiscal real — é irreversível.
                            </p>
                            <ResumoPreview preview={acao.preview} />
                            <div className="grupo-botoes">
                              <button onClick={() => criarEEmitir(p)} disabled={!previewPronto}>
                                Sim, criar e emitir
                              </button>
                              <button className="secundario" onClick={() => definirAcao(p.id, null)}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        </LinhaDetalhe>
                      )}

                      {acao?.fase === 'confirmar-rascunho' && (
                        <LinhaDetalhe>
                          <div className="confirmacao">
                            <p style={{ marginTop: 0 }}>
                              <strong>Criar o rascunho do pedido {p.name}?</strong> Isto grava uma nota real no
                              Tiny de produção, ainda sem valor fiscal.
                            </p>
                            <ResumoPreview preview={acao.preview} />
                            <div className="grupo-botoes">
                              <button onClick={() => criarRascunho(p)} disabled={!previewPronto}>
                                Sim, criar o rascunho
                              </button>
                              <button className="secundario" onClick={() => definirAcao(p.id, null)}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        </LinhaDetalhe>
                      )}

                      {acao?.fase === 'confirmar-emissao' && (
                        <LinhaDetalhe>
                          <div className="confirmacao">
                            <p style={{ marginTop: 0 }}>
                              <strong>
                                Emitir a nota {p.tinyNotaId} ({p.name})?
                              </strong>{' '}
                              Isso dá valor fiscal real e é irreversível — não é possível desfazer pelo sistema.
                            </p>
                            <div className="grupo-botoes">
                              <button onClick={() => emitir(p)}>Sim, emitir</button>
                              <button className="secundario" onClick={() => definirAcao(p.id, null)}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        </LinhaDetalhe>
                      )}

                      {acao?.fase === 'erro' && (
                        <LinhaDetalhe>
                          <div className="aviso aviso-fechavel">
                            <div>
                              <strong>A operação no pedido {p.name} não foi concluída.</strong>
                              <p style={{ marginBottom: 0 }}>{acao.erro}</p>
                            </div>
                            <button className="secundario pequeno" onClick={() => definirAcao(p.id, null)}>
                              Fechar
                            </button>
                          </div>
                        </LinhaDetalhe>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="fraco">
            {visiveis.length} de {pedidos.length} pedido(s)
            {totalPaginas > 1 && ` — página ${pagina} de ${totalPaginas}`}.
          </p>
          <Paginacao pagina={pagina} totalPaginas={totalPaginas} aoMudarPagina={mudarPagina} />
        </>
      )}
    </>
  );
}
