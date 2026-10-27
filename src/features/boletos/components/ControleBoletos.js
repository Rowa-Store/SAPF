// /boletos — pedidos pagos com boleto: status do boleto (emitido/pendente,
// marcado à mão ou ao subir PDF), os PDFs do boleto e o nº da NF de cada um,
// editável. Os boletos registrados na CAIXA para a NF aparecem sozinhos, um
// botão por parcela, com o status calculado a partir deles.

'use client';

import { useEffect, useRef, useState } from 'react';
import IconePdf from '@/components/ui/IconePdf';
import NavegacaoDia from '@/components/ui/NavegacaoDia';
import { formatarDataCurta, formatarMoeda, formatarMoedaOuTraco } from '@/lib/format';
import { parseNossoNumero } from '@/lib/caixa/nossoNumero';
import { statusBoletoCaixa } from '@/lib/caixa/statusTitulos';
import { nfDaLinha, useBoletos } from '../hooks/useBoletos';

const STATUS = [
  { emitido: false, rotulo: 'Pendente', classe: 'marca-acessorio' },
  { emitido: true, rotulo: 'Emitido', classe: 'marca-ok' },
];

/**
 * Status do boleto: ao passar o mouse (ou clicar, no toque) abre a lista de
 * status com um check no atual. O menu é `position: fixed`, calculado a
 * partir da marca, porque a tabela rola na horizontal e cortaria um menu
 * absoluto nas últimas linhas.
 */
function StatusBoleto({ b, alterarStatus }) {
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState(null);
  const ancora = useRef(null);
  const atual = STATUS.find((s) => s.emitido === b.emitido);

  function abrir() {
    const r = ancora.current?.getBoundingClientRect();
    if (r) setPosicao({ top: r.bottom, left: r.left });
    setAberto(true);
  }

  // Posição fixa não acompanha a rolagem: rolou, fecha.
  useEffect(() => {
    if (!aberto) return;
    const fechar = () => setAberto(false);
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [aberto]);

  function escolher(emitido) {
    setAberto(false);
    alterarStatus(b, emitido);
  }

  return (
    <div
      className="status-boleto"
      onMouseEnter={abrir}
      onMouseLeave={() => setAberto(false)}
      onKeyDown={(e) => e.key === 'Escape' && setAberto(false)}
    >
      <button
        ref={ancora}
        type="button"
        className={`marca ${atual.classe}`}
        onClick={() => (aberto ? setAberto(false) : abrir())}
        aria-haspopup="menu"
        aria-expanded={aberto}
      >
        {atual.rotulo} <span aria-hidden="true">▾</span>
      </button>
      {aberto && posicao && (
        <div className="status-menu" role="menu" style={{ top: posicao.top, left: posicao.left }}>
          <div className="status-menu-caixa">
            {STATUS.map((s) => {
              const selecionado = s.emitido === b.emitido;
              return (
                <button
                  key={s.rotulo}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selecionado}
                  className={selecionado ? 'selecionado' : undefined}
                  onClick={() => escolher(s.emitido)}
                >
                  <span className="status-menu-check" aria-hidden="true">
                    {selecionado ? '✓' : ''}
                  </span>
                  <span className={`status-menu-ponto ${s.classe}`} aria-hidden="true" />
                  {s.rotulo}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_CAIXA = {
  pendente: { rotulo: 'Pendente', classe: 'marca-outro' },
  parcial: { rotulo: 'Parcial', classe: 'marca-acessorio' },
  divergente: { rotulo: 'Divergente', classe: 'marca-erro' },
  emitido: { rotulo: 'Emitido', classe: 'marca-ok' },
  liquidado: { rotulo: 'Liquidado', classe: 'marca-atacado' },
};

/** "2026-11-25" -> "25/11", sem passar por Date (fuso). */
const diaMes = (data) => (data ? `${data.slice(8, 10)}/${data.slice(5, 7)}` : '—');

/**
 * Boletos da CAIXA achados para a NF: um botão por título, que abre o PDF
 * numa aba nova. Título fora do padrão (duplicado/correção) aparece com o
 * nosso número, para não se passar por uma parcela.
 */
function TitulosCaixa({ titulos }) {
  if (titulos.length === 0) return null;
  return (
    <div className="pilha">
      {titulos.map((t) => {
        const lido = parseNossoNumero(t.nosso_numero);
        const irregular = lido?.formato !== 'padrao' || lido.nf !== t.nf_numero;
        return (
          <a
            key={t.nosso_numero}
            className="botao-pdf botao-pdf-boleto"
            href={`/api/boletos/caixa/${t.nosso_numero}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Boleto CAIXA — nosso número ${t.nosso_numero}`}
          >
            <IconePdf /> {irregular ? `Título ${t.nosso_numero}` : `Parcela ${t.parcela}`} · {diaMes(t.vencimento)} ·{' '}
            {t.valor == null ? 'R$ ?' : formatarMoeda(t.valor)}
          </a>
        );
      })}
    </div>
  );
}

/**
 * Status do boleto na CAIXA, calculado dos títulos achados para a NF (ver
 * statusTitulos.js), com o porquê no tooltip. Alerta quando o boleto está
 * marcado como emitido aqui e não há nenhum título na CAIXA.
 */
function StatusCaixa({ b, consultando }) {
  if (!nfDaLinha(b)) return <span className="fraco">CAIXA: sem NF</span>;
  if (consultando && b.titulosCaixa.length === 0) return <span className="fraco">CAIXA: consultando…</span>;

  const { status, diferenca, motivos } = statusBoletoCaixa({
    titulos: b.titulosCaixa,
    total: b.total,
    parcelasEsperadas: b.parcelasEsperadas,
  });
  const { rotulo, classe } = STATUS_CAIXA[status];
  const dica = [
    ...motivos,
    ...(diferenca ? [`Soma dos títulos − total do pedido: ${formatarMoeda(diferenca / 100)}`] : []),
  ].join('\n');

  return (
    <div className="pilha">
      <span className={`marca ${classe}`} title={dica || undefined}>
        CAIXA: {rotulo}
      </span>
      {b.emitido && status === 'pendente' && (
        <span className="marca marca-erro" title="Marcado como emitido, mas nenhum boleto desta NF foi achado na CAIXA.">
          ⚠ Emitido sem boleto na CAIXA
        </span>
      )}
    </div>
  );
}

/** Resultado da importação do arquivo da CAIXA. */
function ResumoImportacao({ resumo, fechar }) {
  if (resumo.erro) {
    return (
      <div className="aviso aviso-fechavel">
        <div>
          <strong>Não foi possível importar {resumo.arquivo}.</strong>
          <p>{resumo.erro}</p>
        </div>
        <button className="secundario pequeno" onClick={fechar}>
          Fechar
        </button>
      </div>
    );
  }
  return (
    <div className="aviso aviso-ok aviso-fechavel">
      <div>
        <strong>
          {resumo.arquivo}: {resumo.lidos} título(s) — {resumo.novos} novo(s), {resumo.atualizados} atualizado(s)
          {resumo.ignoradas > 0 && `, ${resumo.ignoradas} linha(s) ilegível(is)`}.
        </strong>
        <ul>
          {resumo.semPedido == null ? (
            <li>Não foi possível conferir quais NFs têm pedido no sistema.</li>
          ) : (
            resumo.semPedido.length > 0 && (
              <li>
                {resumo.semPedido.length} NF(s) sem pedido correspondente:{' '}
                <span className="mono">{resumo.semPedido.join(', ')}</span>
              </li>
            )
          )}
          {resumo.divergentes.length > 0 && (
            <li>
              {resumo.divergentes.length} título(s) com nosso número fora do padrão da NF do documento (conferir na
              CAIXA):{' '}
              <span className="mono">
                {resumo.divergentes.map((d) => `${d.nossoNumero} (doc. ${d.documento})`).join(', ')}
              </span>
            </li>
          )}
        </ul>
      </div>
      <button className="secundario pequeno" onClick={fechar}>
        Fechar
      </button>
    </div>
  );
}

/**
 * Nº da NF: clicar abre a edição. Enter (ou ✓) salva, Esc cancela. Salvar
 * vazio volta a valer o nº da nota no Tiny.
 */
function CampoNumeroNf({ b, salvarNumeroNf }) {
  const numero = b.numeroNfEditado ?? b.numeroNfTiny;
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [salvando, setSalvando] = useState(false);
  const campo = useRef(null);

  function abrir() {
    setValor(numero ?? '');
    setEditando(true);
  }

  useEffect(() => {
    if (editando) campo.current?.focus();
  }, [editando]);

  async function salvar() {
    if (salvando) return;
    if (valor.trim() === (b.numeroNfEditado ?? b.numeroNfTiny ?? '')) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    try {
      // Igual ao nº do Tiny: não guarda cópia, para seguir o Tiny se ele mudar.
      await salvarNumeroNf(b, valor.trim() === (b.numeroNfTiny ?? '') ? '' : valor.trim());
      setEditando(false);
    } catch {
      // O erro aparece abaixo da linha; a edição continua aberta.
    } finally {
      setSalvando(false);
    }
  }

  if (!editando) {
    return (
      <button
        type="button"
        className={`campo-nf ${numero ? 'mono' : 'fraco'}`}
        onClick={abrir}
        title={b.numeroNfEditado ? 'Nº digitado na tela — clique para editar' : 'Clique para editar'}
      >
        {numero ?? 'sem NF'}
        {b.numeroNfEditado && b.numeroNfEditado !== b.numeroNfTiny && <span className="campo-nf-editado">editado</span>}
      </button>
    );
  }

  return (
    <div className="campo-nf-edicao">
      <input
        ref={campo}
        value={valor}
        inputMode="numeric"
        placeholder="nº da NF"
        aria-label={`Nº da NF do pedido ${b.name}`}
        onChange={(e) => setValor(e.target.value.replace(/\D+/g, '').slice(0, 9))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') salvar();
          if (e.key === 'Escape') setEditando(false);
        }}
        disabled={salvando}
      />
      <button type="button" className="botao-icone" onClick={salvar} disabled={salvando} title="Salvar (Enter)" aria-label="Salvar">
        ✓
      </button>
      <button
        type="button"
        className="botao-icone"
        onClick={() => setEditando(false)}
        disabled={salvando}
        title="Cancelar (Esc)"
        aria-label="Cancelar"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * PDFs do boleto, no formato do botão do DANFE, em azul. Um pedido pode ter
 * vários (um por parcela, por exemplo): cada um abre o seu PDF e tem um ✕
 * para remover; "Enviar boleto" / "+ adicionar PDF" escolhe um ou mais
 * arquivos de uma vez. Subir PDF marca o boleto como emitido (no servidor).
 */
function PdfsBoleto({ b, enviarPdfs, removerPdf }) {
  const [enviando, setEnviando] = useState(0);
  const [removendo, setRemovendo] = useState(null);

  async function escolher(e) {
    const arquivos = [...(e.target.files ?? [])];
    e.target.value = '';
    if (arquivos.length === 0) return;
    setEnviando(arquivos.length);
    try {
      await enviarPdfs(b, arquivos);
    } finally {
      setEnviando(0);
    }
  }

  async function remover(pdf) {
    if (!window.confirm(`Remover "${pdf.nome}" deste boleto?`)) return;
    setRemovendo(pdf.id);
    try {
      await removerPdf(b, pdf);
    } finally {
      setRemovendo(null);
    }
  }

  const input = (
    <input
      type="file"
      accept="application/pdf,.pdf"
      multiple
      className="input-arquivo-oculto"
      onChange={escolher}
      disabled={enviando > 0}
    />
  );

  return (
    <div className="pilha">
      {b.pdfs.map((pdf, i) => (
        <div key={pdf.id} className="pdf-boleto">
          <a
            className={`botao-pdf botao-pdf-boleto ${removendo === pdf.id ? 'carregando' : ''}`}
            href={`/api/boletos/${b.id}/pdf?pdf=${pdf.id}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Abrir ${pdf.nome}`}
          >
            <IconePdf /> {b.pdfs.length > 1 ? `Boleto ${i + 1}` : 'Boleto'}
          </a>
          <button
            type="button"
            className="botao-icone"
            onClick={() => remover(pdf)}
            disabled={!!removendo || enviando > 0}
            title={`Remover ${pdf.nome}`}
            aria-label={`Remover ${pdf.nome}`}
          >
            ✕
          </button>
        </div>
      ))}
      {enviando > 0 ? (
        <span className="botao-pdf botao-pdf-boleto carregando">
          <IconePdf /> Enviando {enviando > 1 ? `${enviando} PDFs` : 'PDF'}…
        </span>
      ) : b.pdfs.length === 0 ? (
        <label className="botao-pdf botao-pdf-boleto" title="Enviar os PDFs do boleto (pode escolher vários) — marca como emitido">
          {input}
          <IconePdf /> Enviar boleto
        </label>
      ) : (
        <label className="botao-pdf-trocar" title="Enviar mais PDFs para este boleto (pode escolher vários)">
          {input}+ adicionar PDF
        </label>
      )}
    </div>
  );
}

export default function ControleBoletos() {
  const {
    boletos,
    erro,
    errosLinha,
    definirErroLinha,
    filtros,
    atualizarFiltro,
    limparFiltros,
    filtrosAlterados,
    buscar,
    buscaAplicada,
    carregando,
    visiveis,
    pagina,
    dia,
    diaDeHoje,
    diaCompleto,
    irParaDia,
    diaAnterior,
    diaSeguinte,
    temProxima,
    proximaPagina,
    paginaAnterior,
    alterarStatus,
    salvarNumeroNf,
    enviarPdfs,
    removerPdf,
    consultandoCaixa,
    erroCaixa,
    sincronizarCaixa,
    importando,
    importarConsultaCaixa,
    resumoImportacao,
    fecharResumoImportacao,
  } = useBoletos();

  const paginacao = !dia && (pagina > 1 || temProxima) && (
    <div className="paginacao">
      <button className="secundario" onClick={paginaAnterior} disabled={pagina === 1 || carregando}>
        Anterior
      </button>
      <span>Página {pagina}</span>
      <button className="secundario" onClick={proximaPagina} disabled={!temProxima || carregando}>
        Próxima
      </button>
    </div>
  );

  return (
    <>
      <div className="cabecalho-pagina">
        <h2>Boletos</h2>
      </div>

      <div className="cartao">
        <div className="campos">
          <div>
            <label htmlFor="busca">Buscar</label>
            <input
              id="busca"
              placeholder="Ex.: #1024, #1030 ou nome do cliente"
              title="Nº do pedido, cliente, nº da NF ou CNPJ — separe vários por vírgula. Enter para buscar."
              value={filtros.busca}
              onChange={(e) => atualizarFiltro('busca', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && buscar()}
            />
          </div>
        </div>
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
                checked={filtros.soPendentes}
                onChange={(e) => atualizarFiltro('soPendentes', e.target.checked)}
              />
              Mostrar apenas pendentes
            </label>
          </div>
          <div className="grupo-botoes">
            <button
              className="secundario"
              onClick={() => sincronizarCaixa((boletos ?? []).map(nfDaLinha))}
              disabled={carregando || consultandoCaixa || !boletos?.length}
              title="Procura de novo na CAIXA os boletos das NFs desta lista"
            >
              {consultandoCaixa ? 'Consultando CAIXA…' : 'Consultar CAIXA'}
            </button>
            <label
              className={`botao-arquivo ${importando ? 'carregando' : ''}`}
              title="Arquivo texto da Consulta de Títulos do e-Cobrança (Banco de Títulos → Consulta de Títulos). Atualiza a situação de cada título."
            >
              <input
                type="file"
                accept=".txt,text/plain"
                className="input-arquivo-oculto"
                disabled={importando}
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  e.target.value = '';
                  if (arquivo) importarConsultaCaixa(arquivo);
                }}
              />
              {importando ? 'Importando…' : 'Importar consulta CAIXA'}
            </label>
            <button className="secundario" onClick={limparFiltros} disabled={carregando || !filtrosAlterados}>
              Limpar
            </button>
            <button onClick={() => buscar()} disabled={carregando || filtros.busca === buscaAplicada}>
              {carregando ? 'Carregando…' : 'Buscar'}
            </button>
          </div>
        </div>
      </div>

      {erro && (
        <div className="aviso">
          <strong>Não foi possível carregar os boletos.</strong>
          <p>{erro}</p>
          <p>Confira as integrações em Sys Info e tente de novo.</p>
        </div>
      )}

      {resumoImportacao && <ResumoImportacao resumo={resumoImportacao} fechar={fecharResumoImportacao} />}

      {erroCaixa && (
        <div className="aviso">
          <strong>Boletos da CAIXA</strong>
          <p>{erroCaixa}</p>
        </div>
      )}

      {boletos && dia && !diaCompleto && (
        <div className="aviso">
          <strong>Este dia tem pedidos demais — a lista veio cortada.</strong>
          <p>Use a busca para achar um pedido específico.</p>
        </div>
      )}

      {!boletos ? (
        !erro && <p className="fraco">Carregando boletos…</p>
      ) : visiveis.length === 0 ? (
        <>
          <div className="vazio">
            {dia ? 'Nenhum pedido pago com boleto neste dia.' : 'Nenhum boleto corresponde aos filtros nesta página.'}
          </div>
          {paginacao}
        </>
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
                  <th>Boleto</th>
                  <th>Nº da NF</th>
                  <th>Status do boleto</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.flatMap((b) => [
                  <tr key={b.id}>
                    <td>
                      <div className="mono forte">
                        <a href={`/pedidos/${b.id}/rascunho`}>{b.name}</a>
                      </div>
                      <div className="fraco">{formatarDataCurta(b.createdAt)}</div>
                    </td>
                    <td>
                      {b.cliente}
                      {b.cnpj && <div className="fraco mono">{b.cnpj}</div>}
                    </td>
                    <td className="num">{formatarMoedaOuTraco(b.total)}</td>
                    <td>
                      <span className={`marca marca-${b.classificacao}`}>{b.classificacao}</span>
                    </td>
                    <td>
                      <div className="pilha">
                        <TitulosCaixa titulos={b.titulosCaixa} />
                        <PdfsBoleto b={b} enviarPdfs={enviarPdfs} removerPdf={removerPdf} />
                      </div>
                    </td>
                    <td>
                      <div className="pilha">
                        <CampoNumeroNf b={b} salvarNumeroNf={salvarNumeroNf} />
                        {b.tinyNotaId && (
                          <a
                            className={`botao-pdf ${b.notaEmitida ? 'botao-pdf-destaque' : ''}`}
                            href={`/api/pedidos/${b.id}/danfe?tinyNotaId=${b.tinyNotaId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={
                              b.notaEmitida
                                ? 'Abrir DANFE (salve como PDF pelo diálogo de impressão do navegador)'
                                : 'Prévia do DANFE — sem valor fiscal até emitir'
                            }
                          >
                            <IconePdf /> {b.notaEmitida ? 'DANFE' : 'Prévia DANFE'}
                          </a>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="pilha">
                        <StatusBoleto b={b} alterarStatus={alterarStatus} />
                        <StatusCaixa b={b} consultando={consultandoCaixa} />
                      </div>
                    </td>
                  </tr>,
                  errosLinha[b.id] && (
                    <tr key={`${b.id}-erro`} className="linha-detalhe">
                      <td colSpan={7}>
                        <div className="aviso aviso-fechavel">
                          <p className="texto-erro" style={{ margin: 0 }}>{errosLinha[b.id]}</p>
                          <button className="secundario pequeno" onClick={() => definirErroLinha(b.id, null)}>
                            Fechar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ),
                ])}
              </tbody>
            </table>
          </div>
          <p className="fraco">
            {visiveis.length} de {boletos.length} boleto(s) {dia ? 'neste dia' : 'nesta página'}
            {carregando && ' — carregando…'}
          </p>
          {paginacao}
        </>
      )}
    </>
  );
}
