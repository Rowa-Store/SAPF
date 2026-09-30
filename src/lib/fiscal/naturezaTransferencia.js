// naturezaTransferencia.js — qual natureza de operação (nome + id no Tiny) vai
// na nota de transferência.
//
// Função pura, como montarNota: entra origem, destino e a transferência, sai a
// natureza ou o motivo de não ter uma.
//
// 1. O PAPEL da natureza sai do par origem x destino:
//      · consignacao   — a natureza cadastrada no destino é de consignação
//                        (lojas_fiscais.natureza_operacao com "consigna");
//      · mesmo_estado  — origem e destino na mesma UF;
//      · interestadual — UFs diferentes.
//    A UF vem de lojas_fiscais.uf; em branco, do endereço do local no Shopify.
//
// 2. Nome e id vêm da conta do Tiny que EMITE — a da loja de origem. O id de
//    uma natureza muda de conta para conta, então cada loja de origem guarda
//    os seus em lojas_fiscais.naturezas_tiny (jsonb):
//      { "mesmo_estado":  { "id": 123, "nome": "Transferência de mercadoria entre lojas sp" },
//        "interestadual": { "id": 456, "nome": "TRANSFERENCIA INTERESTADUAL" },
//        "consignacao":   { "id": 789, "nome": "Remessa de mercadoria em consignação mercantil ou industrial" } }
//    O nome tem que ser IGUAL ao da natureza no Tiny da loja: é ele que a
//    emissão confere contra a nota.
//
// 3. Origem que emite pela conta da matriz (os CDs) e ainda não tem
//    naturezas_tiny segue como antes: natureza_operacao e natureza_operacao_id
//    do cadastro do DESTINO — ids da conta da matriz.

export const PAPEIS_NATUREZA = {
  mesmo_estado: 'mesmo estado',
  interestadual: 'interestadual',
  consignacao: 'consignação',
};

function uf(loja, snapshot) {
  return String(loja?.uf || snapshot?.address?.provinceCode || '').trim().toUpperCase();
}

/**
 * @param {object} transferencia transferência do Shopify (origin/destination com address)
 * @param {{ origem: object|null, destino: object|null, contaMatriz?: boolean }} lojas
 *   linhas de lojas_fiscais; `contaMatriz` = a origem emite pela conta da matriz.
 * @returns {{ ok: true, nome: string, id: string, papel: string } | { ok: false, erro: string }}
 */
export function escolherNatureza(transferencia, { origem, destino, contaMatriz = false } = {}) {
  const nomeOrigem = transferencia.origin?.name ?? 'origem';
  const nomeDestino = transferencia.destination?.name ?? 'destino';

  if (!destino) return { ok: false, erro: `a loja de destino "${nomeDestino}" não está em lojas_fiscais.` };

  let papel;
  if (/consigna/i.test(destino.natureza_operacao ?? '')) {
    papel = 'consignacao';
  } else {
    const ufOrigem = uf(origem, transferencia.origin);
    const ufDestino = uf(destino, transferencia.destination);
    if (!ufOrigem || !ufDestino) {
      return {
        ok: false,
        erro: `sem a UF da loja ${!ufOrigem ? `de origem "${nomeOrigem}"` : `de destino "${nomeDestino}"`} não dá para saber se a transferência é interestadual — preencha a coluna uf em lojas_fiscais.`,
      };
    }
    papel = ufOrigem === ufDestino ? 'mesmo_estado' : 'interestadual';
  }

  const daConta = origem?.naturezas_tiny?.[papel];
  if (daConta) {
    const nome = String(daConta.nome ?? '').trim();
    const id = String(daConta.id ?? '').trim();
    if (!nome || !/^\d+$/.test(id)) {
      return {
        ok: false,
        erro: `naturezas_tiny.${papel} da loja de origem "${nomeOrigem}" precisa de "id" (número) e "nome" (igual ao Tiny).`,
      };
    }
    return { ok: true, nome, id, papel };
  }

  if (contaMatriz) {
    const nome = destino.natureza_operacao?.trim() ?? '';
    const id = String(destino.natureza_operacao_id ?? '').trim();
    if (!nome || !id) {
      return {
        ok: false,
        erro: `a loja de destino "${nomeDestino}" está sem natureza_operacao/natureza_operacao_id em lojas_fiscais.`,
      };
    }
    return { ok: true, nome, id, papel };
  }

  return {
    ok: false,
    erro:
      `a loja de origem "${nomeOrigem}" não tem a natureza de ${PAPEIS_NATUREZA[papel]} da conta Olist dela ` +
      `(lojas_fiscais.naturezas_tiny.${papel}, com "id" e "nome").`,
  };
}
