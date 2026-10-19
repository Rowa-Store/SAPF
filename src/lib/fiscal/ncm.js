// ncm.js — NCM de um produto do Shopify, para o cadastro na Olist (tela
// /olist). O Shopify não tem o NCM: ele sai das palavras do nome do produto
// e do "Tipo de produto" — o tipo sozinho não basta, porque muitos produtos
// estão sem tipo (as calcinhas, parte dos tênis) e masculino x feminino só
// aparece no nome ("... Masculino ...").
//
// Produto que nenhuma regra reconhece fica sem NCM: vai para a Olist sem
// mexer no NCM (na atualização, fica o que já está lá).

// A tabela de NCMs que a Rowa usa.
export const NCMS = {
  '6104.63.00': 'Calças, bermudas e shorts femininos, de malha sintética',
  '6103.43.00': 'Calças, bermudas e shorts masculinos, de malha sintética',
  '6108.22.00': 'Calcinhas femininas, de malha sintética ou artificial',
  '6105.20.00': 'Camisas masculinas, de malha sintética ou artificial',
  '6206.40.00': 'Camisas e blusas femininas, de tecido plano, sintéticas ou artificiais',
  '6102.30.00': 'Casacos e jaquetas femininos, de malha sintética ou artificial',
  '6115.96.00': 'Meias de malha sintética',
  '6505.00.11': 'Chapéus e bonés',
  '4202.12.10': 'Bolsas e necessaires com exterior de plástico',
  '4202.12.20': 'Bolsas e mochilas com exterior têxtil',
  '6305.20.00': 'Sacos para embalagem, de algodão',
  '6404.11.00': 'Tênis — sola de borracha/plástico, parte superior têxtil',
  '6402.99.90': 'Chinelos e slides — borracha ou plástico',
  '9617.00.10': 'Garrafas térmicas e recipientes isotérmicos',
  '9615.90.00': 'Piranhas, presilhas e elásticos de cabelo',
};

/**
 * Regras em ordem: vale a primeira que casar. `palavras` são comparadas com
 * as palavras do nome (sem acento, minúsculas; "short" casa "shorts",
 * "shortinho"...); `tipos`, com o Tipo de produto do Shopify. `masculino`
 * exige "masculino" no nome — por isso as regras masculinas vêm antes.
 */
const REGRAS = [
  { ncm: '6103.43.00', masculino: true, palavras: ['calca', 'bermuda', 'short', 'legging'], tipos: ['calcas', 'bermuda', 'shorts', 'legging'] },
  { ncm: '6105.20.00', masculino: true, palavras: ['camiseta', 'regata', 'camisa'], tipos: ['camiseta', 'regatas', 'camisa'] },
  { ncm: '6108.22.00', palavras: ['calcinha'] },
  { ncm: '6402.99.90', palavras: ['chinelo', 'slide'] },
  { ncm: '6404.11.00', palavras: ['tenis'], tipos: ['tenis'] },
  { ncm: '6115.96.00', palavras: ['meia'], tipos: ['meias'] },
  { ncm: '6505.00.11', palavras: ['bone', 'viseira'], tipos: ['bone'] },
  { ncm: '6305.20.00', palavras: ['ecobag', 'sacola'], tipos: ['ecobag', 'sacola'] },
  { ncm: '9617.00.10', palavras: ['garrafa', 'copo'], tipos: ['garrafa', 'copo'] },
  { ncm: '9615.90.00', palavras: ['piranha', 'presilha', 'elastico', 'laco', 'faixa'], tipos: ['laco', 'faixa'] },
  { ncm: '4202.12.10', palavras: ['necessaire'], tipos: ['necessaire'] },
  { ncm: '4202.12.20', palavras: ['bolsa', 'mochila'], tipos: ['bolsa'] },
  { ncm: '6102.30.00', palavras: ['jaqueta', 'casaco', 'corta', 'moletom', 'blusao'], tipos: ['casacos e jaquetas', 'jaquetas e casacos', 'moletom'] },
  { ncm: '6104.63.00', palavras: ['legging', 'calca', 'bermuda', 'short'], tipos: ['legging', 'calcas', 'bermuda', 'shorts'] },
  // A lista da Rowa não tem NCM de blusa feminina de malha: as peças de cima
  // femininas vão em 6206.40.00, como já saem nas notas.
  {
    ncm: '6206.40.00',
    palavras: ['blusa', 'camisa', 'camiseta', 'cropped', 'regata', 'top', 'body', 'vestido', 'saia', 'macacao', 'macaquinho'],
    tipos: ['blusas', 'camisa', 'camiseta', 'cropped', 'regatas', 'top', 'body', 'vestido', 'saias', 'macacao', 'macaquinho'],
  },
];

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** NCM do produto pelo nome e pelo tipo, ou null quando nenhuma regra casa. */
export function ncmDoProduto({ titulo, tipo }) {
  const palavras = normalizar(titulo).split(/[^a-z0-9]+/).filter(Boolean);
  const tipoNormalizado = normalizar(tipo);
  const masculino = palavras.includes('masculino') || palavras.includes('masculina');

  const regra = REGRAS.find(
    (r) =>
      (!r.masculino || masculino) &&
      (palavras.some((p) => r.palavras.some((alvo) => p.startsWith(alvo))) || (r.tipos ?? []).includes(tipoNormalizado))
  );
  return regra?.ncm ?? null;
}
