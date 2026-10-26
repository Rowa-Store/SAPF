// /transferencias — transferências de estoque entre lojas (Shopify) e a nota
// fiscal de cada uma no Tiny — rascunho, emissão, nº da NF e DANFE. Mesmo
// formato da tela de atacado: lista por dia, busca única e confirmação com a
// prévia da nota na própria linha.

'use client';

import { Fragment } from 'react';
import IconePdf from '@/components/ui/IconePdf';
import NavegacaoDia from '@/components/ui/NavegacaoDia';
import Paginacao from '@/components/ui/Paginacao';
import { formatarDataCurta, formatarDataHoraCurta, formatarMoeda } from '@/lib/format';
import { useTransferencias } from '../hooks/useTransferencias';

const STATUS_SHOPIFY = {
  DRAFT: ['Rascunho', ''],
  READY_TO_SHIP: ['Pronta p/ envio', 'marca-atacado'],
  IN_PROGRESS: ['Em trânsito', 'marca-franquia'],
  TRANSFERRED: ['Transferida', 'marca-ok'],
  CANCELED: ['Cancelada', 'marca-erro'],
};

const COLUNAS = 6;

function StatusShopify({ status }) {
  const [rotulo, classe] = STATUS_SHOPIFY[status] ?? [status, ''];
  return <span className={`marca ${classe}`}>{rotulo}</span>;
}

/** "erro no Tiny": clicável quando há erro guardado — abre o erro na linha. */
function MarcaErro({ rotulo = 'erro no Tiny', aoClicar }) {
  if (!aoClicar) return <span className="marca marca-erro">{rotulo}</span>;
  return (
    <button type="button" className="marca marca-erro" onClick={aoClicar} title="Ver o erro">
      {rotulo}
    </button>
  );
}

function StatusFiscal({ t, verErro }) {
  if (t.bloqueio && !t.notaEmitida) {
    return (
      <span className="marca" title={t.bloqueio}>
        sem nota (CD ↔ CD)
      </span>
    );
  }
  if (t.notaEmitida) {
    return <span className="marca marca-ok">NF emitida{t.numeroNf ? ` nº ${t.numeroNf}` : ''}</span>;
  }
  const abrirErro = t.erro ? () => verErro(t) : null;
  if (t.situacaoFiscal === 'rascunho_criado') {
    return (
      <>
        <span className="marca marca-atacado">rascunho {t.tinyNotaId}</span>
        {abrirErro && <MarcaErro aoClicar={abrirErro} />}
      </>
    );
  }
  if (t.situacaoFiscal === 'erro') return <MarcaErro aoClicar={abrirErro} />;
  return (
    <>
      <span className="fraco">sem rascunho</span>
      {abrirErro && <MarcaErro aoClicar={abrirErro} />}
    </>
  );
}

/** Linha de largura total logo abaixo da transferência (confirmação, erro). */
function LinhaDetalhe({ children }) {
  return (
    <tr className="linha-detalhe">
      <td colSpan={COLUNAS}>{children}</td>
    </tr>
  );
}

/** Destinatário, total e alertas da nota montada agora, mostrados antes de confirmar a criação. */
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
        Destinatário na nota: {nota.cliente.nome}
        {nota.cliente.cpf_cnpj && <span className="mono"> · CNPJ {nota.cliente.cpf_cnpj}</span>}
        {nota.cliente.ie && <span className="mono"> · IE {nota.cliente.ie}</span>} · Natureza:{' '}
        {nota.natureza_operacao} · {nota.itens.length} item(ns) ·{' '}
        <strong>Total da nota: {formatarMoeda(dados.totalNota)}</strong>
        {dados.regrasDestino && (
          <>
            <br />
            Valor: preço de {dados.regrasDestino.baseValor === 'venda' ? 'venda' : 'custo'}
            {dados.regrasDestino.descontoPercentual > 0 && ` com ${dados.regrasDestino.descontoPercentual}% de desconto`}
          </>
        )}
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

export default function ControleTransferencias() {
  const {
    transferencias,
    erro,
    aviso,
    setAviso,
    filtros,
    atualizarFiltro,
    limparFiltros,
    filtrosAlterados,
    buscar,
    buscaAplicada,
    carregando,
    visiveis,
    visiveisDaPagina,
    pagina,
    totalPaginas,
    mudarPagina,
    dia,
    diaDeHoje,
    listaCompleta,
    irParaDia,
    diaAnterior,
    diaSeguinte,
    acoes,
    definirAcao,
    pedirCriacao,
    criarRascunho,
    novoRascunho,
    criarEEmitir,
    emitir,
    verErro,
  } = useTransferencias();

  return (
    <>
      <div className="cabecalho-pagina">
        <h2>Controle de transferências do fiscal</h2>
      </div>

      <div className="cartao">
        <div className="campos">
          <div>
            <label htmlFor="busca">Buscar</label>
            <input
              id="busca"
              placeholder="Ex.: #T1024, #T1030 ou nome da loja"
              title="Nome ou referência da transferência, loja de origem ou destino, ou nº da NF — separe vários por vírgula. Enter para buscar."
              value={filtros.busca}
              onChange={(e) => atualizarFiltro('busca', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && buscar()}
            />
          </div>
        </div>
        {/* Sem busca, a lista é de um dia só (abre em hoje). */}
        <NavegacaoDia
          dia={dia}
          diaDeHoje={diaDeHoje}
          carregando={carregando}
          irParaDia={irParaDia}
          diaAnterior={diaAnterior}
          diaSeguinte={diaSeguinte}
        />
        <div className="filtros-rodape">
          <div className="filtros">
            <label>
              <input
                type="checkbox"
                checked={filtros.naoEmitidas}
                onChange={(e) => atualizarFiltro('naoEmitidas', e.target.checked)}
              />
              Mostrar apenas não emitidas
            </label>
          </div>
          <div className="grupo-botoes">
            <button className="secundario" onClick={limparFiltros} disabled={carregando || !filtrosAlterados}>
              Limpar
            </button>
            <button onClick={() => buscar()} disabled={carregando || filtros.busca === buscaAplicada}>
              {carregando ? 'Carregando…' : 'Buscar'}
            </button>
          </div>
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
          <strong>Não foi possível carregar as transferências.</strong>
          <p>{erro}</p>
          <p>Confira as integrações em Sys Info e tente de novo.</p>
        </div>
      )}

      {transferencias && !listaCompleta && (
        <div className="aviso">
          <strong>{dia ? 'Este dia tem' : 'A busca achou'} transferências demais — a lista veio cortada.</strong>
          <p>{dia ? 'Use a busca para achar uma transferência específica.' : 'Use termos mais específicos.'}</p>
        </div>
      )}

      {!transferencias ? (
        !erro && <p className="fraco">Carregando transferências…</p>
      ) : visiveis.length === 0 ? (
        <div className="vazio">
          {dia ? 'Nenhuma transferência neste dia.' : 'Nenhuma transferência corresponde à busca.'}
        </div>
      ) : (
        <>
          <div className="tabela-rolavel">
            <table className="tabela-controle">
              <thead>
                <tr>
                  <th>Transferência</th>
                  <th>Destino ← origem</th>
                  <th>Shopify</th>
                  <th className="num">Qtd.</th>
                  <th>Nota fiscal</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {visiveisDaPagina.map((t) => {
                  const acao = acoes[t.id];
                  const enviando = acao?.fase === 'enviando';
                  const temRascunho = t.situacaoFiscal === 'rascunho_criado';
                  const travada = !!t.bloqueio;
                  const podeCriar = !t.notaEmitida && !temRascunho && t.status !== 'CANCELED' && !travada;
                  const previewPronto = !!acao?.preview?.dados?.podeCriar;
                  const expandida = acao && !enviando;

                  return (
                    <Fragment key={t.id}>
                      <tr className={expandida ? 'linha-expandida' : undefined}>
                        <td>
                          <div className="mono forte">{t.name}</div>
                          <div className="fraco">{formatarDataCurta(t.data)}</div>
                        </td>
                        <td>
                          <div>{t.destino}</div>
                          <div className="rota-destino">← {t.origem}</div>
                        </td>
                        <td>
                          <StatusShopify status={t.status} />
                        </td>
                        <td className="num">
                          {t.quantidadeRecebida}/{t.quantidadeTotal}
                        </td>
                        <td>
                          <div className="pilha">
                            <StatusFiscal t={t} verErro={verErro} />
                            {t.tinyNotaId && (
                              <a
                                className={`botao-pdf ${t.notaEmitida ? 'botao-pdf-destaque' : ''}`}
                                href={`/api/transferencias/${t.id}/danfe`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={
                                  t.notaEmitida
                                    ? 'Abrir DANFE (salve como PDF pelo diálogo de impressão do navegador)'
                                    : 'Prévia do DANFE — sem valor fiscal até emitir'
                                }
                              >
                                <IconePdf /> {t.notaEmitida ? 'DANFE' : 'Prévia DANFE'}
                              </a>
                            )}
                            {t.tinyNotasSubstituidas?.length > 0 && !t.notaEmitida && (
                              <span
                                className="marca marca-erro"
                                title={`Substituído(s): ${t.tinyNotasSubstituidas.join(', ')} — cancele/exclua no Tiny`}
                              >
                                {t.tinyNotasSubstituidas.length} antigo(s) p/ remover no Tiny
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
                                  onClick={() => pedirCriacao(t, 'confirmar-emissao-direta')}
                                  disabled={enviando || acao?.fase === 'confirmar-emissao-direta'}
                                  title="Cria o rascunho no Tiny e emite em seguida"
                                >
                                  Criar e emitir
                                </button>
                                <button
                                  className="pequeno secundario"
                                  onClick={() => pedirCriacao(t, 'confirmar-rascunho')}
                                  disabled={enviando || acao?.fase === 'confirmar-rascunho'}
                                  title="Cria só o rascunho no Tiny, para emitir depois"
                                >
                                  Só rascunho
                                </button>
                              </>
                            )}

                            {/* Rascunho já enviado: emitir, mandar um novo remontado do
                                Shopify ou ajustar à mão antes de mandar um novo. */}
                            {temRascunho && !t.notaEmitida && !travada && (
                              <>
                                <button
                                  className="pequeno secundario"
                                  onClick={() => pedirCriacao(t, 'confirmar-novo-rascunho')}
                                  disabled={enviando || acao?.fase === 'confirmar-novo-rascunho'}
                                  title="Remonta a nota a partir do Shopify e do cadastro da loja e cria um novo rascunho no Tiny"
                                >
                                  Novo rascunho
                                </button>
                                <a
                                  className="botao-link"
                                  href={`/transferencias/${t.id}/rascunho/editar`}
                                  title="Opcional: ajusta à mão o destinatário e os itens — cria um novo rascunho no Tiny"
                                >
                                  Editar rascunho
                                </a>
                                <button
                                  className="pequeno"
                                  onClick={() => definirAcao(t.id, { fase: 'confirmar-emissao' })}
                                  disabled={enviando || acao?.fase === 'confirmar-emissao'}
                                >
                                  Emitir nota
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                      {acao?.fase === 'confirmar-emissao-direta' && (
                        <LinhaDetalhe>
                          <div className="confirmacao">
                            <p style={{ marginTop: 0 }}>
                              <strong>Criar o rascunho e emitir a nota da transferência {t.name}?</strong> Isso
                              grava a nota no Tiny de produção e dá valor fiscal real — é irreversível.
                            </p>
                            <ResumoPreview preview={acao.preview} />
                            <div className="grupo-botoes">
                              <button onClick={() => criarEEmitir(t)} disabled={!previewPronto}>
                                Sim, criar e emitir
                              </button>
                              <button className="secundario" onClick={() => definirAcao(t.id, null)}>
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
                              <strong>Criar o rascunho da transferência {t.name}?</strong> Isto grava uma nota
                              real no Tiny de produção, ainda sem valor fiscal.
                            </p>
                            <ResumoPreview preview={acao.preview} />
                            <div className="grupo-botoes">
                              <button onClick={() => criarRascunho(t)} disabled={!previewPronto}>
                                Sim, criar o rascunho
                              </button>
                              <button className="secundario" onClick={() => definirAcao(t.id, null)}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        </LinhaDetalhe>
                      )}

                      {acao?.fase === 'confirmar-novo-rascunho' && (
                        <LinhaDetalhe>
                          <div className="confirmacao">
                            <p style={{ marginTop: 0 }}>
                              <strong>Criar um novo rascunho para a transferência {t.name}?</strong> A nota é
                              remontada agora a partir do Shopify e do cadastro da loja, e grava uma nota real no
                              Tiny de produção. O rascunho atual ({t.tinyNotaId}) não é apagado: cancele ou exclua
                              ele à mão no Tiny depois.
                            </p>
                            <ResumoPreview preview={acao.preview} />
                            <div className="grupo-botoes">
                              <button onClick={() => novoRascunho(t)} disabled={!previewPronto}>
                                Sim, criar novo rascunho
                              </button>
                              <button className="secundario" onClick={() => definirAcao(t.id, null)}>
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
                              <strong>Emitir a nota {t.tinyNotaId} ({t.name})?</strong> Isso dá valor fiscal real
                              e é irreversível — não é possível desfazer pelo sistema.
                            </p>
                            <div className="grupo-botoes">
                              <button onClick={() => emitir(t)}>Sim, emitir</button>
                              <button className="secundario" onClick={() => definirAcao(t.id, null)}>
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
                              <strong>A operação na transferência {t.name} não foi concluída.</strong>
                              <p className="texto-erro" style={{ marginBottom: 0 }}>{acao.erro}</p>
                              {acao.erroEm && <p className="fraco" style={{ marginBottom: 0 }}>Em {formatarDataHoraCurta(acao.erroEm)}</p>}
                            </div>
                            <button className="secundario pequeno" onClick={() => definirAcao(t.id, null)}>
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
            {visiveis.length} de {transferencias.length} transferência(s)
            {totalPaginas > 1 && ` — página ${pagina} de ${totalPaginas}`}
            {carregando && ' — carregando…'}
          </p>
          <Paginacao pagina={pagina} totalPaginas={totalPaginas} aoMudarPagina={mudarPagina} />
        </>
      )}
    </>
  );
}
