// /olist — cadastro de produtos na Olist a partir do Shopify.
//
// Busca um SKU (ou nome): o Shopify devolve o produto com todos os tamanhos
// (e, com "família", as outras cores do mesmo modelo). Cada produto aparece
// lado a lado com a Olist — a Olist à esquerda e o Shopify à direita, cada
// lado no visual do próprio sistema: primeiro o produto (NCM e peso que vão
// para a Olist), depois uma linha por tamanho. Na Olist cada tamanho é um
// produto simples, sem pai. "Trazer do Shopify" grava os SKUs marcados.

'use client';

import { useEffect, useState } from 'react';
import AbasOlist from '@/components/ui/AbasOlist';
import Modal from '@/components/ui/Modal';
import { formatarMoedaOuTraco } from '@/lib/format';
import { FILTROS, useProdutosOlist } from '../hooks/useProdutosOlist';

const FORMATO = {
  preco: formatarMoedaOuTraco,
  peso: (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 3 })} kg`),
};

function valor(chave, v) {
  if (FORMATO[chave]) return FORMATO[chave](v);
  return v || '—';
}

const SITUACAO = {
  igual: ['marca-ok', 'igual'],
  diferente: ['marca-acessorio', 'diferente'],
  nova: ['marca-erro', 'não está na Olist'],
  em_pai: ['marca-erro', 'variação de produto pai'],
  bloqueado: ['marca-erro', 'código duplicado'],
  sem_sku: ['marca-erro', 'sem SKU no Shopify'],
};

function MarcaSituacao({ linha, resultado, verErro }) {
  if (resultado?.ok && resultado.acao !== 'igual') {
    return <span className="marca marca-ok">{resultado.acao === 'incluido' ? 'incluído' : 'atualizado'}</span>;
  }
  if (resultado && !resultado.ok) {
    return (
      <button className="marca marca-erro" onClick={() => verErro({ sku: linha.sku, erro: resultado.erro })}>
        erro ao enviar
      </button>
    );
  }
  const [classe, rotulo] = SITUACAO[linha.situacao];
  return <span className={`marca ${classe}`}>{rotulo}</span>;
}

// Rótulos como cada sistema mostra na tela dele: a Olist em português, o
// admin do Shopify em inglês.
const ROTULO_OLIST = { nome: 'Nome do produto', preco: 'Preço de venda', ncm: 'NCM', peso: 'Peso Líquido' };
const ROTULO_SHOPIFY = { nome: 'Title', peso: 'Weight' };

const STATUS_SHOPIFY = { ACTIVE: 'Active', DRAFT: 'Draft', ARCHIVED: 'Archived' };

/** Cabeçalho do lado da Olist: o produto e o NCM e o peso que vão para cada SKU. */
function ProdutoOlist({ produto, caixaProduto, naFila }) {
  return (
    <div className="lado-olist olist-cabecalho">
      <span className="olist-marca">olist</span>
      <div className="olist-titulo">
        {caixaProduto}
        <span>{produto.titulo}</span>
        {naFila?.estado === 'ok' && <span className="marca marca-ok">OK</span>}
        {naFila?.estado === 'erro' && <span className="marca marca-erro">com erro</span>}
      </div>
      <div className="olist-campos olist-campos-pai">
        {['ncm', 'peso'].map((chave) => (
          <div key={chave}>
            <span className="olist-rotulo">{ROTULO_OLIST[chave]}</span>
            <span className="olist-valor">{valor(chave, produto.esperado[chave])}</span>
          </div>
        ))}
      </div>
      <p className="olist-vazio">Cada tamanho é um produto simples na Olist, com o SKU como código — sem produto pai.</p>
    </div>
  );
}

function PaiShopify({ produto }) {
  return (
    <div className="lado-shopify shopify-cabecalho">
      <span className="shopify-marca">shopify</span>
      <div className="shopify-titulo">
        <span>{produto.titulo}</span>
        {produto.status && (
          <span className={`shopify-status status-${produto.status.toLowerCase()}`}>
            {STATUS_SHOPIFY[produto.status] ?? produto.status}
          </span>
        )}
      </div>
      {produto.tipo && <div className="shopify-tipo">Type · {produto.tipo}</div>}
      <div className="shopify-campos shopify-campos-pai">
        {['nome', 'peso'].map((chave) => (
          <div key={chave}>
            <span className="shopify-rotulo">{ROTULO_SHOPIFY[chave]}</span>
            <span className="shopify-campo">{valor(chave, produto.esperado[chave])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Um SKU (produto simples) do lado da Olist. */
function SkuOlist({ linha, resultado, enviavel, selecionado, marcar, verErro }) {
  // Campos para mostrar: os da Olist, ou os que vão ser cadastrados.
  const mostrar = linha.olist ? ['nome', 'preco', ...linha.diferencas.filter((c) => c === 'ncm' || c === 'peso')] : [];
  return (
    <div className="lado-olist">
      <div className="olist-variacao">
        <label className="olist-sku">
          {enviavel && (
            <input
              type="checkbox"
              className="caixa-selecao"
              checked={selecionado}
              onChange={(e) => marcar([linha.sku], e.target.checked)}
            />
          )}
          <span>
            <span className="olist-rotulo">Código (SKU)</span>
            <span className="olist-valor">{linha.sku || '—'}</span>
          </span>
        </label>
        {mostrar.map((chave) => {
          const diferente = linha.diferencas.includes(chave);
          return (
            <div key={chave} className={diferente ? 'campo-diferente' : undefined}>
              <span className="olist-rotulo">{ROTULO_OLIST[chave]}</span>
              <span className="olist-valor">{valor(chave, linha.olist[chave])}</span>
              {diferente && <span className="valor-novo">→ {valor(chave, linha.esperado[chave])}</span>}
            </div>
          );
        })}
        <div className="olist-situacao">
          <MarcaSituacao linha={linha} resultado={resultado} verErro={verErro} />
        </div>
      </div>
      {linha.situacao === 'nova' && <p className="olist-vazio">Vai ser cadastrado como “{linha.esperado.nome}”.</p>}
      {linha.olist && !linha.olist.ativo && <p className="olist-vazio">Inativo na Olist — a gravação reativa.</p>}
      {linha.situacao === 'em_pai' && (
        <p className="olist-vazio">
          O SKU é variação de um produto pai na Olist (id {linha.emPai.id}) — exclua a variação lá antes.
        </p>
      )}
    </div>
  );
}

/** Uma variante do lado do Shopify. */
function VarianteShopify({ linha }) {
  return (
    <div className="lado-shopify">
      <div className="shopify-cartao">
        <div className="shopify-campos">
          <div>
            <span className="shopify-rotulo">Variant</span>
            <span className="shopify-campo">{linha.shopify.opcao || '—'}</span>
          </div>
          <div className={linha.diferencas.includes('preco') ? 'campo-diferente' : undefined}>
            <span className="shopify-rotulo">Price</span>
            <span className="shopify-campo">{valor('preco', linha.shopify.preco)}</span>
          </div>
          <div>
            <span className="shopify-rotulo">Barcode</span>
            <span className="shopify-campo">{linha.shopify.gtin || '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const TEXTO_NA_FILA = {
  fila: () => 'Na fila…',
  enviando: () => 'Enviando à Olist…',
  aguardando: ({ segundos }) => `Limite de chamadas da Olist — tentando de novo em ${segundos}s`,
};

/** Camada por cima do produto enquanto ele está na fila do envio. */
function ProgressoNaFila({ naFila }) {
  const texto = TEXTO_NA_FILA[naFila?.estado];
  if (!texto) return null;
  return (
    <div className="par-progresso" role="status">
      <div className="par-progresso-caixa">
        <span className={`girando${naFila.estado === 'fila' ? ' parado' : ''}`} aria-hidden="true" />
        <span>{texto(naFila)}</span>
      </div>
    </div>
  );
}

function ParProduto({ produto, resultados, enviavel, selecionados, marcar, verErro, naFila }) {
  const skusEnviaveis = produto.linhas.filter(enviavel).map((l) => l.sku);
  const marcados = skusEnviaveis.filter((sku) => selecionados.has(sku)).length;
  const caixaProduto = skusEnviaveis.length > 0 && (
    <input
      type="checkbox"
      className="caixa-selecao"
      aria-label={`Selecionar todos os SKUs de ${produto.titulo}`}
      checked={marcados === skusEnviaveis.length}
      ref={(el) => el && (el.indeterminate = marcados > 0 && marcados < skusEnviaveis.length)}
      onChange={(e) => marcar(skusEnviaveis, e.target.checked)}
    />
  );
  return (
    <section className="par-produto">
      <ProgressoNaFila naFila={naFila} />
      <div className="par-linha">
        <ProdutoOlist produto={produto} caixaProduto={caixaProduto} naFila={naFila} />
        <PaiShopify produto={produto} />
      </div>
      {produto.linhas.map((l, i) => (
        <div className="par-linha" key={l.sku || i}>
          <SkuOlist
            linha={l}
            resultado={resultados[l.sku]}
            enviavel={enviavel(l)}
            selecionado={selecionados.has(l.sku)}
            marcar={marcar}
            verErro={verErro}
          />
          <VarianteShopify linha={l} />
        </div>
      ))}
    </section>
  );
}

export default function CadastroProdutos() {
  const {
    consulta,
    produtos,
    carregando,
    erro,
    aviso,
    setAviso,
    comparar,
    enviavel,
    enviaveis,
    aEnviar,
    visiveis,
    contagens,
    filtro,
    trocarFiltro,
    selecionados,
    marcar,
    enviando,
    trazerDoShopify,
    resultados,
    fila,
  } = useProdutosOlist();
  const [termo, setTermo] = useState('');
  // { sku, erro } do "erro ao enviar" clicado
  const [erroAberto, setErroAberto] = useState(null);
  const [familia, setFamilia] = useState(false);

  // /olist?busca=... (o "Abrir" do diagnóstico) já chega buscando.
  useEffect(() => {
    const busca = new URLSearchParams(window.location.search).get('busca');
    if (!busca) return;
    setTermo(busca);
    comparar(busca, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const incluir = aEnviar.filter((l) => l.situacao === 'nova').length;
  const atualizar = aEnviar.length - incluir;

  return (
    <>
      <AbasOlist />
      <div className="cabecalho-pagina">
        <h2>Cadastro de produtos</h2>
      </div>

      <form
        className="cartao"
        onSubmit={(e) => {
          e.preventDefault();
          comparar(termo, familia);
        }}
      >
        <div className="linha-busca">
          <input
            autoFocus
            placeholder="SKU de qualquer tamanho (ex.: FY-Z010115S/P) ou nome do produto"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
          />
          <button type="submit" disabled={carregando || !termo.trim()}>
            {carregando ? 'Consultando…' : 'Buscar'}
          </button>
        </div>
        <label className="campo-check">
          <input type="checkbox" checked={familia} onChange={(e) => setFamilia(e.target.checked)} />
          Trazer a família — as outras cores do mesmo modelo
        </label>
      </form>

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

      {carregando && <p className="fraco">Consultando o Shopify e a Olist…</p>}

      {!carregando && produtos && produtos.length === 0 && (
        <div className="vazio">Nenhum produto encontrado no Shopify para “{consulta?.busca}”.</div>
      )}

      {!carregando && produtos?.length > 0 && (
        <>
          <div className="filtros-olist" role="group" aria-label="Filtrar SKUs">
            {FILTROS.map((f) => (
              <button
                key={f.chave}
                type="button"
                className={`filtro-chip${filtro === f.chave ? ' ativo' : ''}`}
                aria-pressed={filtro === f.chave}
                onClick={() => trocarFiltro(f.chave)}
              >
                {f.rotulo} <span className="filtro-contagem">{contagens[f.chave]}</span>
              </button>
            ))}
          </div>

          {visiveis.length === 0 && <div className="vazio">Nenhum SKU neste filtro.</div>}

          {visiveis.map((p) => (
            <ParProduto
              key={p.id}
              produto={p}
              resultados={resultados}
              enviavel={enviavel}
              selecionados={selecionados}
              marcar={marcar}
              verErro={setErroAberto}
              naFila={fila[p.id]}
            />
          ))}

          {enviaveis.length === 0 ? (
            <p className="fraco">Tudo igual entre o Shopify e a Olist — nada para trazer.</p>
          ) : (
            <div className="barra-lote barra-envio">
              <span className="barra-lote-contagem">
                {aEnviar.length === 0
                  ? 'Marque os SKUs que quer trazer do Shopify.'
                  : [atualizar > 0 && `${atualizar} para atualizar`, incluir > 0 && `${incluir} para cadastrar`]
                      .filter(Boolean)
                      .join(' · ')}
              </span>
              <div className="grupo-botoes">
                <button
                  className="link"
                  onClick={() => marcar(enviaveis.map((l) => l.sku), aEnviar.length < enviaveis.length)}
                >
                  {aEnviar.length < enviaveis.length ? `Marcar todos (${enviaveis.length})` : 'Desmarcar todos'}
                </button>
                <button onClick={trazerDoShopify} disabled={enviando || aEnviar.length === 0}>
                  {enviando ? 'Enviando…' : `Trazer do Shopify (${aEnviar.length})`}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <Modal aberto={!!erroAberto} titulo={`Erro ao enviar ${erroAberto?.sku ?? ''}`} aoFechar={() => setErroAberto(null)}>
        {erroAberto && (
          <>
            <p className="fraco" style={{ marginTop: 0 }}>Resposta da Olist (Tiny) ao gravar este SKU:</p>
            <pre className="texto-erro">{erroAberto.erro}</pre>
          </>
        )}
      </Modal>
    </>
  );
}
