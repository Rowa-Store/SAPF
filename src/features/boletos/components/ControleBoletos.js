// /boletos — pedidos pagos com boleto: status do boleto (emitido/pendente,
// marcado à mão) e o nº da NF de cada um, editável.

'use client';

import { useEffect, useRef, useState } from 'react';
import NavegacaoDia from '@/components/ui/NavegacaoDia';
import { formatarDataCurta, formatarMoedaOuTraco } from '@/lib/format';
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

function IconeRefresh() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/**
 * Nº da NF: clicar abre a edição. Enter (ou ✓) salva, Esc cancela; o botão de
 * refresh confere a nota no Tiny e põe o nº encontrado no campo. Salvar vazio
 * volta a valer o nº da nota no Tiny.
 */
function CampoNumeroNf({ b, salvarNumeroNf, buscarNumeroNoTiny }) {
  const numero = b.numeroNfEditado ?? b.numeroNfTiny;
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [ocupado, setOcupado] = useState(null); // 'salvando' | 'buscando'
  const [semNumero, setSemNumero] = useState(false);
  const campo = useRef(null);

  function abrir() {
    setValor(numero ?? '');
    setSemNumero(false);
    setEditando(true);
  }

  useEffect(() => {
    if (editando) campo.current?.focus();
  }, [editando]);

  async function salvar() {
    if (ocupado) return;
    if (valor.trim() === (b.numeroNfEditado ?? b.numeroNfTiny ?? '')) {
      setEditando(false);
      return;
    }
    setOcupado('salvando');
    try {
      // Igual ao nº do Tiny: não guarda cópia, para seguir o Tiny se ele mudar.
      await salvarNumeroNf(b, valor.trim() === (b.numeroNfTiny ?? '') ? '' : valor.trim());
      setEditando(false);
    } catch {
      // O erro aparece abaixo da linha; a edição continua aberta.
    } finally {
      setOcupado(null);
    }
  }

  async function buscarDeNovo() {
    setOcupado('buscando');
    setSemNumero(false);
    const encontrado = await buscarNumeroNoTiny(b);
    setOcupado(null);
    if (encontrado) setValor(encontrado);
    else setSemNumero(true);
    campo.current?.focus();
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
    <div className="pilha">
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
          disabled={ocupado === 'salvando'}
        />
        <button
          type="button"
          className={`botao-icone ${ocupado === 'buscando' ? 'botao-icone-girando' : ''}`}
          onClick={buscarDeNovo}
          disabled={!!ocupado}
          title="Buscar o nº da NF no Tiny de novo"
          aria-label="Buscar o nº da NF no Tiny de novo"
        >
          <IconeRefresh />
        </button>
        <button type="button" className="botao-icone" onClick={salvar} disabled={!!ocupado} title="Salvar (Enter)" aria-label="Salvar">
          ✓
        </button>
        <button
          type="button"
          className="botao-icone"
          onClick={() => setEditando(false)}
          disabled={ocupado === 'salvando'}
          title="Cancelar (Esc)"
          aria-label="Cancelar"
        >
          ✕
        </button>
      </div>
      {semNumero && <span className="fraco">Nenhuma NF emitida no Tiny para este pedido.</span>}
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
    buscarNumeroNoTiny,
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
                      <CampoNumeroNf b={b} salvarNumeroNf={salvarNumeroNf} buscarNumeroNoTiny={buscarNumeroNoTiny} />
                    </td>
                    <td>
                      <StatusBoleto b={b} alterarStatus={alterarStatus} />
                    </td>
                  </tr>,
                  errosLinha[b.id] && (
                    <tr key={`${b.id}-erro`} className="linha-detalhe">
                      <td colSpan={6}>
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
