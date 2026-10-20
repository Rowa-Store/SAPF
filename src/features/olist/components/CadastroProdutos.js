// /olist — cadastro de produtos na Olist a partir do Shopify.
//
// Busca um SKU (ou nome): o Shopify devolve o produto com todos os tamanhos
// (e, com "família", as outras cores do mesmo modelo). Cada produto aparece
// lado a lado com o pai dele na Olist — a Olist à esquerda e o Shopify à
// direita, cada lado no visual do próprio sistema: primeiro os dados do pai
// (nome, NCM, peso), depois uma linha por tamanho (variação). "Trazer do
// Shopify" grava os SKUs marcados.

'use client';

import { useState } from 'react';
import AbasOlist from '@/components/ui/AbasOlist';
import { formatarMoedaOuTraco } from '@/lib/format';
import { CAMPOS_PAI } from '@/lib/olist/produtoTiny';
import { useProdutosOlist } from '../hooks/useProdutosOlist';

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
  fora_do_pai: ['marca-erro', 'SKU em outro produto'],
  bloqueado: ['marca-erro', 'produto duplicado'],
  sem_sku: ['marca-erro', 'sem SKU no Shopify'],
};

function MarcaSituacao({ linha, resultado }) {
  if (resultado?.ok && resultado.acao !== 'igual') {
    return <span className="marca marca-ok">{resultado.acao === 'incluido' ? 'incluído' : 'atualizado'}</span>;
  }
  if (resultado && !resultado.ok) {
    return (
      <span className="marca marca-erro" title={resultado.erro}>
        erro ao enviar
      </span>
    );
  }
  const [classe, rotulo] = SITUACAO[linha.situacao];
  return <span className={`marca ${classe}`}>{rotulo}</span>;
}

// Rótulos como cada sistema mostra na tela dele: a Olist em português, o
// admin do Shopify em inglês.
const ROTULO_OLIST = { nome: 'Nome do produto', ncm: 'NCM', peso: 'Peso Líquido' };
const ROTULO_SHOPIFY = { nome: 'Title', peso: 'Weight' };

const STATUS_SHOPIFY = { ACTIVE: 'Active', DRAFT: 'Draft', ARCHIVED: 'Archived' };

/** "Tamanho P" — os valores da grade, ou a opção da variante. */
function textoDaGrade(grade, opcao) {
  const valores = Object.values(grade ?? {}).filter(Boolean);
  return valores.length ? valores.join(' / ') : opcao || '—';
}

/** Cabeçalho do lado da Olist: o pai, ou por que ele não está lá. */
function PaiOlist({ produto, caixaProduto }) {
  return (
    <div className="lado-olist olist-cabecalho">
      <span className="olist-marca">olist</span>
      <div className="olist-titulo">
        {caixaProduto}
        <span>{produto.olist?.nome ?? produto.titulo}</span>
      </div>
      {produto.situacao === 'encontrado' ? (
        <div className="olist-campos olist-campos-pai">
          {CAMPOS_PAI.map((c) => {
            const diferente = produto.diferencasPai.includes(c.chave);
            return (
              <div key={c.chave} className={diferente ? 'campo-diferente' : undefined}>
                <span className="olist-rotulo">{ROTULO_OLIST[c.chave]}</span>
                <span className="olist-valor">{valor(c.chave, produto.olist[c.chave])}</span>
                {/* O que vai para a Olist: o NCM não tem lado Shopify para mostrar. */}
                {diferente && <span className="valor-novo">→ {valor(c.chave, produto.esperado[c.chave])}</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="olist-vazio">
          {produto.situacao === 'duplicado'
            ? `Há ${produto.duplicados} produtos ativos com este nome na Olist — corrija lá antes.`
            : 'Produto não encontrado na Olist. Os SKUs marcados serão cadastrados como um produto com variações' +
              (produto.esperado.ncm ? `, NCM ${produto.esperado.ncm}.` : '.')}
        </p>
      )}
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
          <div key={chave} className={produto.diferencasPai.includes(chave) ? 'campo-diferente' : undefined}>
            <span className="shopify-rotulo">{ROTULO_SHOPIFY[chave]}</span>
            <span className="shopify-campo">{valor(chave, produto.esperado[chave])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Uma variação (tamanho) do lado da Olist. */
function VariacaoOlist({ linha, resultado, enviavel, selecionado, marcar }) {
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
        {linha.olist && (
          <>
            <div>
              <span className="olist-rotulo">Variação</span>
              <span className="olist-valor">{textoDaGrade(linha.olist.grade)}</span>
            </div>
            <div className={linha.diferencas.includes('preco') ? 'campo-diferente' : undefined}>
              <span className="olist-rotulo">Preço de venda</span>
              <span className="olist-valor">{valor('preco', linha.olist.preco)}</span>
            </div>
          </>
        )}
        <div className="olist-situacao">
          <MarcaSituacao linha={linha} resultado={resultado} />
        </div>
      </div>
      {linha.situacao === 'fora_do_pai' && (
        <p className="olist-vazio">
          O SKU já está na Olist em outro produto (id {linha.foraDoPai.id}) — corrija lá antes.
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
            <span className="shopify-campo">{textoDaGrade(linha.grade, linha.shopify.opcao)}</span>
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

function ParProduto({ produto, resultados, enviavel, selecionados, marcar }) {
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
      <div className="par-linha">
        <PaiOlist produto={produto} caixaProduto={caixaProduto} />
        <PaiShopify produto={produto} />
      </div>
      {produto.linhas.map((l, i) => (
        <div className="par-linha" key={l.sku || i}>
          <VariacaoOlist
            linha={l}
            resultado={resultados[l.sku]}
            enviavel={enviavel(l)}
            selecionado={selecionados.has(l.sku)}
            marcar={marcar}
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
    selecionados,
    marcar,
    confirmado,
    setConfirmado,
    enviando,
    trazerDoShopify,
    resultados,
  } = useProdutosOlist();
  const [termo, setTermo] = useState('');
  const [familia, setFamilia] = useState(false);

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
          {produtos.map((p) => (
            <ParProduto
              key={p.id}
              produto={p}
              resultados={resultados}
              enviavel={enviavel}
              selecionados={selecionados}
              marcar={marcar}
            />
          ))}

          {enviaveis.length === 0 ? (
            <p className="fraco">Tudo igual entre o Shopify e a Olist — nada para trazer.</p>
          ) : (
            <div className="confirmacao barra-envio">
              <p style={{ marginTop: 0 }}>
                {aEnviar.length === 0 ? (
                  <strong>Marque os SKUs (ou o produto inteiro) que quer trazer do Shopify.</strong>
                ) : (
                  <strong>
                    Trazer do Shopify: {atualizar > 0 && `${atualizar} SKU(s) atualizado(s)`}
                    {atualizar > 0 && incluir > 0 && ' e '}
                    {incluir > 0 && `${incluir} SKU(s) cadastrado(s)`} na Olist.
                  </strong>
                )}{' '}
                Junto vão o nome, o NCM e o peso do produto; o que estiver vazio do lado de cá fica como está na Olist.{' '}
                <button
                  className="link"
                  onClick={() => marcar(enviaveis.map((l) => l.sku), aEnviar.length < enviaveis.length)}
                >
                  {aEnviar.length < enviaveis.length ? `Marcar todos (${enviaveis.length})` : 'Desmarcar todos'}
                </button>
              </p>
              <label>
                <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
                <span>Entendo que isto grava na conta de produção da Olist.</span>
              </label>
              <div className="grupo-botoes" style={{ marginTop: '0.75rem' }}>
                <button onClick={trazerDoShopify} disabled={!confirmado || enviando || aEnviar.length === 0}>
                  {enviando ? 'Enviando…' : `Trazer do Shopify (${aEnviar.length})`}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
