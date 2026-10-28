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
import { useBoletos } from '../hooks/useBoletos';

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
    progressoCaixa,
    erroCaixa,
    sincronizarCaixa,
    consultarMes,
  } = useBoletos();

  const progressoTexto = progressoCaixa
    ? `${progressoCaixa.feitas}/${progressoCaixa.total} ${progressoCaixa.unidade}`
    : '';

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
              onClick={() => sincronizarCaixa(boletos ?? [])}
              disabled={carregando || consultandoCaixa || !boletos?.length}
              title="Procura na CAIXA os boletos das NFs desta lista e sobe os PDFs para o sistema (precisa da extensão no Chrome)"
            >
              {consultandoCaixa ? `Consultando boletos… ${progressoTexto}` : 'Consultar boletos'}
            </button>
            <button
              className="secundario"
              onClick={consultarMes}
              disabled={carregando || consultandoCaixa || !diaDeHoje}
              title="Procura na CAIXA os boletos de todos os pedidos do mês deste dia, até hoje (precisa da extensão no Chrome)"
            >
              Consultar boletos do mês
            </button>
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

      {erroCaixa && (
        <div className="aviso">
          <strong>Boletos da CAIXA</strong>
          <p className="texto-quebra">{erroCaixa}</p>
        </div>
      )}

      <details className="ajuda-extensao">
        <summary>Como instalar a extensão da CAIXA (uma vez por computador)</summary>
        <p>
          A CAIXA não deixa o servidor baixar os boletos, então quem baixa é o seu Chrome, por uma extensão. Só ela
          acessa o link de impressão de boletos da CAIXA, e só quando você clica em &quot;Consultar boletos&quot;.
        </p>
        <ol>
          <li>
            Baixe <a href="/extensao-caixa.zip">extensao-caixa.zip</a> e descompacte numa pasta que não vá ser apagada.
          </li>
          <li>
            No Chrome, abra <span className="mono">chrome://extensions</span> e ligue o &quot;Modo do
            desenvolvedor&quot; (canto superior direito).
          </li>
          <li>Clique em &quot;Carregar sem compactação&quot; e escolha a pasta descompactada.</li>
          <li>Recarregue esta página.</li>
        </ol>
      </details>

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
                      <StatusBoleto b={b} alterarStatus={alterarStatus} />
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
