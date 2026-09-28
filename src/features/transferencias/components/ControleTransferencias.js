// /transferencias — transferências de estoque entre lojas (Shopify) e a nota
// fiscal de cada uma no Tiny: rascunho (criar, refazer e editar), emissão, nº da NF e
// DANFE.

'use client';

import { Fragment } from 'react';
import IconePdf from '@/components/ui/IconePdf';
import Paginacao from '@/components/ui/Paginacao';
import { formatarDataCurta, formatarMoeda } from '@/lib/format';
import { useTransferencias } from '../hooks/useTransferencias';

const STATUS_SHOPIFY = {
  DRAFT: ['Rascunho', ''],
  READY_TO_SHIP: ['Pronta p/ envio', 'marca-atacado'],
  IN_PROGRESS: ['Em trânsito', 'marca-franquia'],
  TRANSFERRED: ['Transferida', 'marca-ok'],
  CANCELED: ['Cancelada', 'marca-erro'],
};

const COLUNAS = 7;

const DICA_TRAVA = 'Ligue "Permitir emissão" na tela de atacado';

function StatusShopify({ status }) {
  const [rotulo, classe] = STATUS_SHOPIFY[status] ?? [status, ''];
  return <span className={`marca ${classe}`}>{rotulo}</span>;
}

function StatusFiscal({ t }) {
  if (t.notaEmitida) {
    return <span className="marca marca-ok">NF emitida{t.numeroNf ? ` nº ${t.numeroNf}` : ''}</span>;
  }
  if (t.situacaoFiscal === 'rascunho_criado') {
    return <span className="marca marca-atacado">rascunho {t.tinyNotaId}</span>;
  }
  if (t.situacaoFiscal === 'erro') return <span className="marca marca-erro">erro no Tiny</span>;
  return <span className="marca marca-erro">NF pendente</span>;
}

function SeletorLoja({ id, rotulo, valor, locais, aoMudar, vazio }) {
  return (
    <div>
      <label htmlFor={id}>{rotulo}</label>
      <select id={id} value={valor} onChange={(e) => aoMudar(e.target.value)}>
        <option value="">{vazio}</option>
        {locais.map((l) => (
          <option key={l.id} value={l.id}>
            {l.nome}
            {l.ativo ? '' : ' (inativa)'}
          </option>
        ))}
      </select>
    </div>
  );
}

function Produtos({ estado, temRascunho }) {
  if (estado.carregando) return <p className="fraco">Lendo os itens no Shopify…</p>;
  if (estado.erro) {
    return (
      <div className="aviso">
        <strong>Não foi possível ler a transferência.</strong>
        <p>{estado.erro}</p>
      </div>
    );
  }
  const { dados } = estado;
  const nota = dados.payload.nota_fiscal;
  return (
    <>
      {dados.alertas.length > 0 && (
        <div className="aviso">
          <strong>Confira antes de criar o rascunho</strong>
          <ul>
            {dados.alertas.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {temRascunho && (
        <p className="fraco">
          Nota remontada agora a partir do Shopify — se o rascunho foi editado, o que está no Tiny pode ser
          diferente (abra em &quot;Editar rascunho&quot; para ver o que foi enviado).
        </p>
      )}
      <p className="fraco">
        Destinatário na nota: {nota.cliente.nome}
        {nota.cliente.cpf_cnpj && <span className="mono"> · CNPJ {nota.cliente.cpf_cnpj}</span>}
        {nota.cliente.ie && <span className="mono"> · IE {nota.cliente.ie}</span>} · Natureza:{' '}
        {nota.natureza_operacao}
        {dados.regrasDestino && (
          <>
            {' '}
            · Valor: preço de {dados.regrasDestino.baseValor === 'venda' ? 'venda' : 'custo'}
            {dados.regrasDestino.descontoPercentual > 0 && ` com ${dados.regrasDestino.descontoPercentual}% de desconto`}
          </>
        )}
      </p>
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Descrição</th>
            <th className="num">Qtd.</th>
            <th className="num">Valor unitário</th>
            <th className="num">Total da linha</th>
          </tr>
        </thead>
        <tbody>
          {nota.itens.map(({ item }, i) => (
            <tr key={i}>
              <td className="mono">{item.codigo || '—'}</td>
              <td>{item.descricao}</td>
              <td className="num">{item.quantidade}</td>
              <td className="num">{formatarMoeda(item.valor_unitario)}</td>
              <td className="num">{formatarMoeda(Number(item.valor_unitario) * Number(item.quantidade))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <strong>Total da nota: {formatarMoeda(dados.totalNota)}</strong>
      </p>
    </>
  );
}

/** Linha de largura total logo abaixo da transferência (confirmação, erro, produtos). */
function LinhaDetalhe({ children }) {
  return (
    <tr className="linha-detalhe">
      <td colSpan={COLUNAS}>{children}</td>
    </tr>
  );
}

export default function ControleTransferencias() {
  const {
    pagina,
    totalPaginas,
    mudarPagina,
    transferenciasDaPagina,
    filtros,
    atualizarFiltro,
    aplicarFiltros,
    limparFiltros,
    filtrosAlterados,
    transferencias,
    locais,
    carregando,
    erro,
    aviso,
    setAviso,
    permitirEmissao,
    produtos,
    alternarProdutos,
    acoes,
    definirAcao,
    conferindo,
    precisaConferir,
    conferirNoTiny,
    criarRascunho,
    novoRascunho,
    emitir,
    emitirDireto,
    reemitir,
    podeEmitir,
    podeSelecionar,
    selecionadas,
    alternarSelecao,
    selecionarVarias,
    comRascunho,
    selecionadasEmitiveis,
    lote,
    loteAConfirmar,
    confirmarLote,
    cancelarLote,
    emitirTodasComRascunho,
    emitirSelecionadas,
  } = useTransferencias();

  const emitiveisDaPagina = transferenciasDaPagina.filter(podeEmitir).map((t) => t.id);

  return (
    <>
      <div className="cabecalho-pagina">
        <h2>Controle de transferências do fiscal</h2>
        <a
          href="/pedidos"
          className={`marca ${permitirEmissao ? 'marca-ok' : 'marca-erro'}`}
          title={
            permitirEmissao
              ? '"Emitir nota" grava valor fiscal de verdade, sem volta. A trava fica na tela de atacado.'
              : 'A trava de emissão fica na tela de atacado'
          }
        >
          Emissão fiscal: {permitirEmissao === null ? 'verificando…' : permitirEmissao ? 'LIBERADA' : 'BLOQUEADA'}
        </a>
      </div>

      <details className="cartao filtros-cartao" open>
        <summary>
          <strong>Filtros</strong>
          {filtrosAlterados && <span className="marca marca-atacado">ativos</span>}
        </summary>
        <div className="campos" style={{ marginTop: '0.75rem' }}>
          <SeletorLoja
            id="origem"
            rotulo="Loja de origem"
            valor={filtros.origem}
            locais={locais}
            aoMudar={(v) => atualizarFiltro('origem', v)}
            vazio="Todas as lojas"
          />
          <SeletorLoja
            id="destino"
            rotulo="Loja de destino"
            valor={filtros.destino}
            locais={locais}
            aoMudar={(v) => atualizarFiltro('destino', v)}
            vazio="Todas as lojas"
          />
          <div title="Oculta transferências em que a loja seja origem ou destino">
            <SeletorLoja
              id="excluir"
              rotulo="Excluir loja (origem ou destino)"
              valor={filtros.excluir}
              locais={locais}
              aoMudar={(v) => atualizarFiltro('excluir', v)}
              vazio="Nenhuma"
            />
          </div>
          <div>
            <label htmlFor="de">Data inicial</label>
            <input id="de" type="date" value={filtros.de} onChange={(e) => atualizarFiltro('de', e.target.value)} />
          </div>
          <div>
            <label htmlFor="ate">Data final</label>
            <input id="ate" type="date" value={filtros.ate} onChange={(e) => atualizarFiltro('ate', e.target.value)} />
          </div>
          <div>
            <label htmlFor="nome">Buscar por nome</label>
            <input
              id="nome"
              placeholder="Ex.: #T1024, #T1030, #T1041"
              title="Nome ou referência da transferência — separe vários por vírgula"
              value={filtros.nome}
              onChange={(e) => atualizarFiltro('nome', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && aplicarFiltros()}
            />
          </div>
          <div>
            <label htmlFor="nf">Buscar por nº da NF</label>
            <input
              id="nf"
              placeholder="Ex.: 1520, 1523"
              title="Nº da nota fiscal — separe vários por vírgula"
              value={filtros.nf}
              onChange={(e) => atualizarFiltro('nf', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && aplicarFiltros()}
            />
          </div>
        </div>

        <div className="filtros-rodape">
          <div className="filtros">
            <label>
              <input
                type="checkbox"
                checked={filtros.rascunhos}
                onChange={(e) => atualizarFiltro('rascunhos', e.target.checked)}
              />
              Mostrar rascunhos do Shopify
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
          <div className="grupo-botoes">
            <button className="secundario" onClick={limparFiltros} disabled={carregando || !filtrosAlterados}>
              Limpar
            </button>
            <button onClick={aplicarFiltros} disabled={carregando}>
              {carregando ? 'Carregando…' : 'Aplicar filtros'}
            </button>
          </div>
        </div>
      </details>

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
        </div>
      )}

      {!transferencias ? (
        !erro && <p className="fraco">Carregando transferências…</p>
      ) : transferencias.length === 0 ? (
        <div className="vazio">Nenhuma transferência corresponde aos filtros.</div>
      ) : (
        <>
          <div className="barra-lote">
            <span className="fraco">
              {selecionadas.size > 0 ? (
                <>
                  <strong className="barra-lote-contagem">{selecionadasEmitiveis.length}</strong> selecionada(s)
                  {' · '}
                  <button className="link" onClick={() => selecionarVarias([...selecionadas], false)} disabled={!!lote}>
                    limpar seleção
                  </button>
                </>
              ) : (
                'Marque as transferências para emitir em lote'
              )}
              {lote && ` — emitindo ${lote.feitas}/${lote.total}… não feche a página.`}
            </span>
            <div className="grupo-botoes">
              <button
                className="secundario"
                onClick={emitirTodasComRascunho}
                disabled={!permitirEmissao || carregando || !!lote || !!loteAConfirmar || comRascunho.length === 0}
                title={
                  permitirEmissao
                    ? 'Emite no Tiny todas as notas com rascunho da lista filtrada (todas as páginas)'
                    : DICA_TRAVA
                }
              >
                Emitir todas com rascunho ({comRascunho.length})
              </button>
              <button
                onClick={emitirSelecionadas}
                disabled={
                  !permitirEmissao || carregando || !!lote || !!loteAConfirmar || selecionadasEmitiveis.length === 0
                }
                title={
                  permitirEmissao
                    ? 'Cria o rascunho quando falta e emite as transferências marcadas — as já emitidas são reemitidas com um novo rascunho'
                    : DICA_TRAVA
                }
              >
                Emitir selecionadas ({selecionadasEmitiveis.length})
              </button>
            </div>
          </div>

          {loteAConfirmar && (
            <div className="confirmacao">
              <p style={{ marginTop: 0 }}>
                <strong>
                  Emitir {loteAConfirmar.lista.length} nota(s) de {loteAConfirmar.descricao}?
                </strong>{' '}
                Isso dá valor fiscal real no Tiny e é irreversível.
                {loteAConfirmar.semRascunho > 0 &&
                  ` ${loteAConfirmar.semRascunho} delas ainda não têm rascunho — ele será criado antes de emitir.`}
                {loteAConfirmar.jaEmitidas > 0 && (
                  <>
                    {' '}
                    <strong>{loteAConfirmar.jaEmitidas} delas JÁ ESTÃO EMITIDAS:</strong> cada uma ganha um novo
                    rascunho e uma NOVA nota fiscal — as notas anteriores continuam valendo até serem canceladas à mão
                    no Tiny.
                  </>
                )}
              </p>
              <div className="grupo-botoes">
                <button onClick={confirmarLote}>Sim, emitir {loteAConfirmar.lista.length} nota(s)</button>
                <button className="secundario" onClick={cancelarLote}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="tabela-rolavel">
            <table className="tabela-transferencias">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      aria-label="Selecionar as transferências emitíveis desta página"
                      checked={emitiveisDaPagina.length > 0 && emitiveisDaPagina.every((id) => selecionadas.has(id))}
                      disabled={emitiveisDaPagina.length === 0 || !!lote}
                      onChange={(e) => selecionarVarias(emitiveisDaPagina, e.target.checked)}
                    />
                  </th>
                  <th>Transferência</th>
                  <th>Origem → destino</th>
                  <th>Shopify</th>
                  <th className="num">Qtd.</th>
                  <th>Nota fiscal</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {transferenciasDaPagina.map((t) => {
                  const estadoProdutos = produtos[t.id];
                  const acao = acoes[t.id];
                  const enviando = acao?.fase === 'enviando';
                  const temRascunho = t.situacaoFiscal === 'rascunho_criado';
                  const podeCriar = !t.notaEmitida && !temRascunho && t.status !== 'CANCELED';
                  const expandida = estadoProdutos?.aberto || (acao && acao.fase !== 'enviando');

                  return (
                    <Fragment key={t.id}>
                      <tr className={`${selecionadas.has(t.id) ? 'linha-selecionada' : ''} ${expandida ? 'linha-expandida' : ''}`}>
                        <td className="col-check">
                          {podeSelecionar(t) && (
                            <input
                              type="checkbox"
                              aria-label={`Selecionar a transferência ${t.name}`}
                              checked={selecionadas.has(t.id)}
                              disabled={!!lote}
                              onChange={() => alternarSelecao(t.id)}
                            />
                          )}
                        </td>
                        <td>
                          <div className="mono forte">{t.name}</div>
                          <div className="fraco">{formatarDataCurta(t.data)}</div>
                        </td>
                        <td>
                          <div>{t.origem}</div>
                          <div className="rota-destino">→ {t.destino}</div>
                        </td>
                        <td>
                          <StatusShopify status={t.status} />
                        </td>
                        <td className="num">
                          {t.quantidadeRecebida}/{t.quantidadeTotal}
                        </td>
                        <td>
                          <div className="pilha">
                            <StatusFiscal t={t} />
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
                                  onClick={() => definirAcao(t.id, { fase: 'confirmar-rascunho' })}
                                  disabled={enviando || acao?.fase === 'confirmar-rascunho'}
                                >
                                  Criar rascunho
                                </button>
                                <button
                                  className="pequeno secundario"
                                  onClick={() => definirAcao(t.id, { fase: 'confirmar-emissao-direta' })}
                                  disabled={
                                    !permitirEmissao || enviando || !!lote || acao?.fase === 'confirmar-emissao-direta'
                                  }
                                  title={permitirEmissao ? 'Cria o rascunho no Tiny e emite em seguida' : DICA_TRAVA}
                                >
                                  Criar e emitir
                                </button>
                              </>
                            )}

                            {t.notaEmitida && t.status !== 'CANCELED' && (
                              <button
                                className="pequeno secundario"
                                onClick={() => definirAcao(t.id, { fase: 'confirmar-reemissao' })}
                                disabled={
                                  !permitirEmissao || enviando || !!lote || acao?.fase === 'confirmar-reemissao'
                                }
                                title={
                                  permitirEmissao
                                    ? 'Cria um novo rascunho a partir do Shopify e do cadastro da loja e emite uma nova nota'
                                    : DICA_TRAVA
                                }
                              >
                                Reemitir
                              </button>
                            )}

                            {temRascunho && !t.notaEmitida && (
                              <>
                                <button
                                  className="pequeno"
                                  onClick={() => definirAcao(t.id, { fase: 'confirmar-emissao' })}
                                  disabled={!permitirEmissao || enviando || !!lote || acao?.fase === 'confirmar-emissao'}
                                  title={permitirEmissao ? undefined : DICA_TRAVA}
                                >
                                  {permitirEmissao ? 'Emitir nota' : 'Emissão bloqueada'}
                                </button>
                                <button
                                  className="pequeno secundario"
                                  onClick={() => definirAcao(t.id, { fase: 'confirmar-novo-rascunho' })}
                                  disabled={enviando || !!lote || acao?.fase === 'confirmar-novo-rascunho'}
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
                              </>
                            )}

                            <button
                              className="pequeno secundario"
                              onClick={() => alternarProdutos(t.id)}
                              aria-expanded={!!estadoProdutos?.aberto}
                            >
                              {estadoProdutos?.aberto ? 'Ocultar produtos ▴' : 'Produtos ▾'}
                            </button>

                            {precisaConferir(t) && (
                              <button
                                className="pequeno secundario"
                                onClick={() => conferirNoTiny(t)}
                                disabled={conferindo.has(t.id) || enviando}
                                title="Busca no Tiny se a nota já foi autorizada e o número da NF"
                              >
                                {conferindo.has(t.id) ? 'Conferindo…' : 'Conferir no Tiny'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {acao?.fase === 'confirmar-rascunho' && (
                        <LinhaDetalhe>
                          <div className="confirmacao">
                            <p style={{ marginTop: 0 }}>
                              <strong>Criar o rascunho da transferência {t.name}?</strong> Isto grava uma nota
                              real no Tiny de produção. Confira os produtos e os avisos em &quot;Produtos&quot;
                              antes.
                            </p>
                            <div className="grupo-botoes">
                              <button onClick={() => criarRascunho(t)}>Sim, criar o rascunho</button>
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
                            <p className="fraco">
                              Se o que precisa mudar não vem do Shopify nem do cadastro, use &quot;Editar
                              rascunho&quot; (opcional) para ajustar à mão.
                            </p>
                            <div className="grupo-botoes">
                              <button onClick={() => novoRascunho(t)}>Sim, criar novo rascunho</button>
                              <button className="secundario" onClick={() => definirAcao(t.id, null)}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        </LinhaDetalhe>
                      )}

                      {acao?.fase === 'confirmar-reemissao' && (
                        <LinhaDetalhe>
                          <div className="confirmacao">
                            <p style={{ marginTop: 0 }}>
                              <strong>
                                Reemitir a transferência {t.name}
                                {t.numeroNf ? ` (hoje NF nº ${t.numeroNf})` : ''}?
                              </strong>{' '}
                              Um novo rascunho é montado agora a partir do Shopify e do cadastro da loja e uma NOVA
                              nota fiscal é emitida no Tiny — valor fiscal real, irreversível. A nota anterior (
                              {t.tinyNotaId}) continua valendo até ser cancelada à mão no Tiny.
                            </p>
                            <div className="grupo-botoes">
                              <button onClick={() => reemitir(t)}>Sim, criar novo rascunho e emitir</button>
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
                              e é irreversível.
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

                      {acao?.fase === 'confirmar-emissao-direta' && (
                        <LinhaDetalhe>
                          <div className="confirmacao">
                            <p style={{ marginTop: 0 }}>
                              <strong>Criar o rascunho e emitir a nota da transferência {t.name}?</strong> Isso
                              grava a nota no Tiny de produção e dá valor fiscal real — é irreversível. Confira os
                              produtos e os avisos em &quot;Produtos&quot; antes.
                            </p>
                            <div className="grupo-botoes">
                              <button onClick={() => emitirDireto(t)}>Sim, criar e emitir</button>
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
                              <p style={{ marginBottom: 0 }}>{acao.erro}</p>
                            </div>
                            <button className="secundario pequeno" onClick={() => definirAcao(t.id, null)}>
                              Fechar
                            </button>
                          </div>
                        </LinhaDetalhe>
                      )}

                      {estadoProdutos?.aberto && (
                        <LinhaDetalhe>
                          <Produtos estado={estadoProdutos} temRascunho={temRascunho && !t.notaEmitida} />
                        </LinhaDetalhe>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="fraco">
            {transferencias.length} transferência(s)
            {totalPaginas > 1 && ` — página ${pagina} de ${totalPaginas}`}.
          </p>
          <Paginacao pagina={pagina} totalPaginas={totalPaginas} aoMudarPagina={mudarPagina} />
        </>
      )}
    </>
  );
}
