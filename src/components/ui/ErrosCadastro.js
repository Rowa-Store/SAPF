/**
 * "erro gtin" / "erro ncm" na linha do item cujo cadastro na Olist não deu
 * para corrigir antes da nota (ver olist/cadastroDosItens.js). O motivo fica
 * no title. `conferencia` é o `cadastroItens` devolvido pela rota do rascunho.
 */
export default function ErrosCadastro({ conferencia, codigo }) {
  const doItem = conferencia?.itens?.find((i) => i.codigo === String(codigo ?? '').trim());
  if (!doItem?.erros?.length) return null;
  return doItem.erros.map((erro) => (
    <span
      key={erro}
      className="marca marca-erro"
      title={doItem.motivos.join('; ')}
      style={{ marginTop: '0.25rem', marginRight: '0.25rem', display: 'inline-block' }}
    >
      {erro}
    </span>
  ));
}
