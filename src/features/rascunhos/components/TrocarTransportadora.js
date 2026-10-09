// Janela da tela do rascunho para trocar o transporte de UM pedido: Correios,
// retirada ou uma transportadora ativa do cadastro. Não grava nada — nem no
// metafield do Shopify nem no anexo do cliente (/pedidos/transportadoras);
// quem usa a escolha é a nota que sair desta tela.

'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { transporteEscolhido } from '@/lib/fiscal/transporte';

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export default function TrocarTransportadora({ aberto, aoFechar, aoEscolher, atual, temOriginal }) {
  const [transportadoras, setTransportadoras] = useState(null);
  const [erro, setErro] = useState(null);
  const [busca, setBusca] = useState('');

  // Lê o cadastro toda vez que abre — a pessoa pode ter cadastrado uma
  // transportadora em outra aba depois de abrir o pedido.
  useEffect(() => {
    if (!aberto) return;
    setBusca('');
    setErro(null);
    fetch('/api/transportadoras')
      .then(async (r) => {
        const corpo = await r.json();
        if (!r.ok) throw new Error(corpo.erro ?? 'Falha ao carregar as transportadoras.');
        setTransportadoras(corpo.transportadoras ?? []);
      })
      .catch((e) => setErro(e.message));
  }, [aberto]);

  function escolher(opcao) {
    aoEscolher(opcao === null ? null : transporteEscolhido(opcao));
    aoFechar();
  }

  const alvo = normalizar(busca.trim());
  const ativas = (transportadoras ?? [])
    .filter((t) => t.ativo !== false)
    .filter((t) => !alvo || normalizar(`${t.nome} ${t.cnpj ?? ''} ${t.cidade ?? ''}`).includes(alvo));

  const ehAtual = (tipo, id) => atual?.tipo === tipo && (tipo !== 'transportadora' || atual.id === id);

  return (
    <Modal aberto={aberto} titulo="Trocar transportadora deste pedido" aoFechar={aoFechar} largura="44rem">
      <p className="fraco" style={{ marginTop: 0 }}>
        Vale só para a nota deste pedido — o cadastro do cliente e o metafield do Shopify continuam como estão.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <button
          className={ehAtual('correios') ? 'pequeno' : 'secundario pequeno'}
          onClick={() => escolher('correios')}
        >
          Correios (Sedex Contrato AG)
        </button>
        <button
          className={ehAtual('retirada') ? 'pequeno' : 'secundario pequeno'}
          onClick={() => escolher('retirada')}
        >
          Retirada pelo cliente
        </button>
        {temOriginal && (
          <button className="secundario pequeno" onClick={() => escolher(null)}>
            Voltar ao transporte original
          </button>
        )}
      </div>

      <input
        aria-label="Buscar transportadora"
        placeholder="Buscar por nome, CNPJ ou cidade"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        autoFocus
      />

      {erro && (
        <div className="aviso">
          <strong>Não foi possível carregar o cadastro.</strong>
          <p>{erro}</p>
        </div>
      )}

      {!erro && !transportadoras && <p className="fraco">Carregando transportadoras…</p>}

      {transportadoras && (
        <div className="lista-rolavel" style={{ marginTop: '0.75rem' }}>
          <table>
            <thead>
              <tr>
                <th>Transportadora</th>
                <th>Cidade</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ativas.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.nome}
                    {t.cnpj && <div className="fraco mono">{t.cnpj}</div>}
                  </td>
                  <td>{[t.cidade, t.uf].filter(Boolean).join(' / ') || '—'}</td>
                  <td>
                    {ehAtual('transportadora', t.id) ? (
                      <span className="fraco">em uso</span>
                    ) : (
                      <button className="pequeno" onClick={() => escolher(t)}>
                        Escolher
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {ativas.length === 0 && (
                <tr>
                  <td colSpan={3} className="fraco">
                    {alvo ? 'Nenhuma transportadora ativa com essa busca.' : 'Nenhuma transportadora ativa no cadastro.'}{' '}
                    <a href="/pedidos/transportadoras" target="_blank" rel="noreferrer">
                      Abrir o cadastro
                    </a>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
