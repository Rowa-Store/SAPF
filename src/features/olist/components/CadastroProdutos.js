// /olist — cadastro de produtos na Olist a partir do Shopify.
//
// Busca um SKU (ou nome): o Shopify devolve o produto com todos os tamanhos
// (e, com "família", as outras cores do mesmo modelo), e cada SKU aparece
// lado a lado com o cadastro dele na Olist. "Trazer do Shopify" atualiza os
// diferentes e inclui os que não existem lá.

'use client';

import { useState } from 'react';
import AbasOlist from '@/components/ui/AbasOlist';
import { formatarDataHoraCurta, formatarMoedaOuTraco } from '@/lib/format';
import { CAMPOS } from '@/lib/olist/produtoTiny';
import { useProdutosOlist } from '../hooks/useProdutosOlist';

const FORMATO = {
  preco: formatarMoedaOuTraco,
  peso: (v) => (v == null ? '—' : String(v).replace('.', ',')),
};

function valor(chave, v) {
  if (FORMATO[chave]) return FORMATO[chave](v);
  return v || '—';
}

const SITUACAO = {
  igual: ['marca-ok', 'igual'],
  diferente: ['marca-acessorio', 'diferente'],
  nao_encontrado: ['marca-erro', 'produto não encontrado'],
  duplicado: ['marca-erro', 'código duplicado na Olist'],
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

function Notificacoes({ notificacoes, comparar, dispensar }) {
  if (!notificacoes.length) return null;
  return (
    <div className="aviso aviso-atencao" role="status">
      <strong>
        {notificacoes.length === 1
          ? '1 produto mudou no Shopify depois do último envio à Olist.'
          : `${notificacoes.length} produtos mudaram no Shopify depois do último envio à Olist.`}
      </strong>
      <ul className="lista-notificacao">
        {notificacoes.map((n) => (
          <li key={n.id}>
            <span>
              <span className="forte">{n.titulo}</span>{' '}
              <span className="fraco">— alterado em {formatarDataHoraCurta(n.atualizadoEm)}</span>
            </span>
            <span className="acoes-linha">
              <button className="pequeno" onClick={() => comparar(n.titulo, false)}>
                Comparar
              </button>
              <button className="secundario pequeno" onClick={() => dispensar(n)}>
                Dispensar
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TabelaProduto({ produto, resultados }) {
  return (
    <div className="cartao">
      <div className="cabecalho-produto">
        <span className="forte">{produto.titulo}</span>
        <span className="fraco">
          {[produto.tipo, `${produto.linhas.length} SKU(s)`].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className="tabela-rolavel">
        <table className="tabela-paralela">
          <thead>
            <tr>
              <th rowSpan={2}>SKU</th>
              <th colSpan={CAMPOS.length} className="lado">
                Shopify
              </th>
              <th colSpan={CAMPOS.length} className="lado">
                Olist
              </th>
            </tr>
            <tr>
              {[...CAMPOS, ...CAMPOS].map((c, i) => (
                <th key={i} className={i === CAMPOS.length ? 'inicio-lado' : undefined}>
                  {c.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {produto.linhas.map((l, i) => (
              <tr key={l.sku || i}>
                <td>
                  <div className="mono">{l.sku || '—'}</div>
                  <MarcaSituacao linha={l} resultado={resultados[l.sku]} />
                </td>
                {CAMPOS.map((c) => (
                  <td key={c.chave} className={l.diferencas.includes(c.chave) ? 'celula-diferente' : undefined}>
                    {valor(c.chave, l.shopify[c.chave])}
                  </td>
                ))}
                {l.tiny ? (
                  CAMPOS.map((c, j) => (
                    <td
                      key={c.chave}
                      className={[j === 0 && 'inicio-lado', l.diferencas.includes(c.chave) && 'celula-diferente']
                        .filter(Boolean)
                        .join(' ') || undefined}
                    >
                      {valor(c.chave, l.tiny[c.chave])}
                    </td>
                  ))
                ) : (
                  <td colSpan={CAMPOS.length} className="inicio-lado fraco">
                    {l.situacao === 'duplicado'
                      ? `Código em ${l.duplicados} produtos na Olist — corrija lá antes.`
                      : 'Produto não encontrado na Olist.'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
    aEnviar,
    confirmado,
    setConfirmado,
    enviando,
    trazerDoShopify,
    resultados,
    notificacoes,
    dispensar,
  } = useProdutosOlist();
  const [termo, setTermo] = useState('');
  const [familia, setFamilia] = useState(false);

  const incluir = aEnviar.filter((l) => l.situacao === 'nao_encontrado').length;
  const atualizar = aEnviar.length - incluir;

  return (
    <>
      <AbasOlist />
      <div className="cabecalho-pagina">
        <h2>Cadastro de produtos</h2>
      </div>

      <Notificacoes
        notificacoes={notificacoes}
        comparar={(titulo, comFamilia) => {
          setTermo(titulo);
          setFamilia(comFamilia);
          comparar(titulo, comFamilia);
        }}
        dispensar={dispensar}
      />

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
            <TabelaProduto key={p.id} produto={p} resultados={resultados} />
          ))}

          {aEnviar.length === 0 ? (
            <p className="fraco">Tudo igual entre o Shopify e a Olist — nada para trazer.</p>
          ) : (
            <div className="confirmacao">
              <p style={{ marginTop: 0 }}>
                <strong>
                  Trazer do Shopify: {atualizar > 0 && `${atualizar} SKU(s) atualizado(s)`}
                  {atualizar > 0 && incluir > 0 && ' e '}
                  {incluir > 0 && `${incluir} SKU(s) cadastrado(s)`} na Olist.
                </strong>{' '}
                Só vão os campos preenchidos no Shopify; o que estiver vazio lá fica como está na Olist.
              </p>
              <label>
                <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
                <span>Entendo que isto grava na conta de produção da Olist.</span>
              </label>
              <div className="grupo-botoes" style={{ marginTop: '0.75rem' }}>
                <button onClick={trazerDoShopify} disabled={!confirmado || enviando}>
                  {enviando ? 'Enviando…' : 'Trazer do Shopify'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
