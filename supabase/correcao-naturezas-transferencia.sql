-- Corrige os nomes de natureza_operacao em lojas_fiscais para ficarem IGUAIS
-- ao cadastro de naturezas do Tiny. Um nome que não bate é trocado em silêncio
-- pela natureza padrão da conta ("Venda para contribuinte").
--
-- Rodar uma vez no SQL Editor do Supabase. É idempotente: só toca as linhas
-- com o nome antigo.

begin;

update lojas_fiscais
set natureza_operacao = case natureza_operacao
  when 'Transferencias entre lojas sp'    then 'Transferência de mercadoria entre lojas sp'
  when 'Transferencia interestadual'      then 'TRANSFERENCIA INTERESTADUAL'
  when 'Remessa de mercadoria consignada' then 'Remessa de mercadoria em consignação mercantil ou industrial'
end
where natureza_operacao in (
  'Transferencias entre lojas sp',
  'Transferencia interestadual',
  'Remessa de mercadoria consignada'
);

-- Conferência: as 10 lojas devem aparecer só com os três nomes corretos.
select natureza_operacao, count(*) as lojas
from lojas_fiscais
group by natureza_operacao
order by natureza_operacao;

commit;
