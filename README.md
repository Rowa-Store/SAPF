# SAPF — Shopify para Tiny (Olist)

Sistema que lê pedidos de atacado e de franquia no Shopify, monta a nota
fiscal e cria o **rascunho** dentro do Tiny. A conferência e a emissão
continuam manuais, no próprio Tiny — este sistema só emite quando a trava
`PERMITIR_EMISSAO` está ligada, e nenhuma tela hoje chama isso automaticamente.

Cobre dois dos três processos fiscais de hoje: atacado/franquia e
transferência entre lojas (tela `/transferencias`, ver seção própria abaixo).
Notas de devolução ficam para depois.

A integração com o Shopify já é real (Admin GraphQL API), não simulada.

---

| Operação | Endpoint do Tiny | Risco |
|---|---|---|
| Consultar nota / conferir emissão | `nota.fiscal.obter.php` | Nenhum, só lê |
| Criar ou "editar" rascunho | `nota.fiscal.incluir.xml.php` | **Cria uma nota real na conta de produção** |
| Emitir nota | `nota.fiscal.emitir.php` | Irreversível — dá valor fiscal à nota |

### Travas de segurança

São duas, independentes:

1. **Confirmação na tela.** Criar o rascunho exige marcar `confirmacaoTeste`
   na tela do rascunho. Sem ela, o endpoint (`POST /api/pedidos/[id]/rascunho`)
   recusa a requisição.
2. **`PERMITIR_EMISSAO=false`.** Trava só a emissão fiscal
   (`POST /api/pedidos/[id]/emitir`). A checagem é feita duas vezes — na rota
   e de novo dentro de `emitirNota` em `src/lib/integrations/tiny.js` — para
   que a trava valha mesmo se a função for chamada de outro lugar no futuro.
   Liga/desliga pela tela de atacado (`/pedidos`), que lê e grava essa flag no Supabase
   (não no `.env`, porque precisa ter efeito imediato).

Rascunho de pedido de atacado não é editado depois de enviado ao Tiny:
cliente e itens se ajustam antes, na conferência (`/pedidos/[id]/rascunho`).
Nas transferências, a API 2.0 do Tiny não tem endpoint para alterar nem
excluir uma nota — por isso "editar" um rascunho
(`PUT /api/transferencias/[id]/rascunho`) na prática cria um rascunho novo com
os dados corrigidos; o antigo precisa ser cancelado/excluído manualmente
dentro do Tiny. O id da nota antiga fica registrado (`tiny_notas_substituidas`)
para a tela deixar isso explícito.

---

## Pré-requisitos

- Node.js 18.17 ou superior
- Uma conta no Supabase (plano gratuito serve)
- Token da Admin API do Shopify e token da API 2.0 do Tiny
- Conta no Vercel para publicar (opcional)

---

## Variáveis de ambiente

Copie `.env.example` para `.env.local` (uso local) e configure as mesmas
variáveis no painel do Vercel para publicar. Nenhuma credencial deve ser
commitada no repositório.

| Variável | Descrição |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | Domínio `.myshopify.com` da loja |
| `SHOPIFY_API_TOKEN` | Token da Admin API (leitura de pedidos e escopos `read_inventory_transfers`, `read_locations`, `read_inventory`, `read_products` para as transferências) |
| `SHOPIFY_API_VERSION` | Versão da Admin API, ex.: `2025-07` |
| `TINY_API_TOKEN` | Token em Configurações > Geral > Tokens no Tiny |
| `TINY_API_BASE` | `https://api.tiny.com.br/api2` |
| `SUPABASE_URL` | Project Settings > API > Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings > API > `service_role`. Nunca exponha no navegador. |
| `PERMITIR_EMISSAO` | Valor inicial da trava, só usado se a linha `permitir_emissao` ainda não existir no Supabase. Não mude sem alinhar com o time fiscal. |

O sistema roda sem Supabase configurado, mas sem histórico, sem trava contra
nota duplicada e sem a lista de CNPJs de franquia (todo CNPJ com pedido vira
"atacado" nesse caso). A tela Sys Info (`/sysinfo`, que consulta `/api/saude`) avisa quando algum
serviço não está configurado ou fora do ar.

### Criando as tabelas no Supabase

No painel do Supabase: **SQL Editor > New query**, cole o conteúdo de
`supabase/schema.sql` e clique em **Run**. São cinco tabelas:
`notas_processadas`, `itens_pendentes`, `configuracoes`, `cnpjs_franquia` e
`lojas_fiscais`.

`cnpjs_franquia` não vem com dados — é cadastro sensível de cliente, então
fica de fora do controle de versão de propósito. Cadastre direto no SQL
Editor:

```sql
insert into cnpjs_franquia (cnpj, apelido) values ('00000000000000', 'Nome da franquia');
```

---

## Como publicar no Vercel

1. Suba o repositório para o GitHub.
2. No Vercel: **Add New > Project**, escolha o repositório. O framework é
   detectado como Next.js sozinho.
3. Em **Environment Variables**, cadastre todas as variáveis da seção acima
   com os valores reais, para os ambientes Production e Preview.
4. **Deploy**. A cada push na branch principal o Vercel republica.

Se algo falhar depois do deploy, abra `/api/saude` na URL publicada: a
resposta diz qual serviço está com problema e por quê.

---

## Transferências entre lojas

A tela `/transferencias` lista as transferências de estoque do Shopify
(`inventoryTransfers`, lidas com o mesmo token dos pedidos) e, para
cada uma, cria o rascunho da nota no Tiny e emite — com as mesmas travas dos
pedidos (confirmação na tela e `permitir_emissao`). O registro fica em
`notas_processadas`, com o gid da transferência e `classificacao =
'transferencia'`.

- **Destinatário:** o Shopify não guarda CNPJ/IE de local. Cada loja precisa
  estar em `lojas_fiscais` (id do local no Shopify, razão social, CNPJ, IE e
  endereço com bairro) — sem a loja de destino cadastrada, o rascunho é
  recusado. Cadastre direto no SQL Editor, como `cnpjs_franquia`.
- **Regras por loja de destino** (colunas de `lojas_fiscais`):
  - `natureza_operacao`: nome da natureza no Tiny, de onde sai o CFOP. Tem que
    ser **idêntico** ao cadastro de naturezas do Tiny (acentos e maiúsculas
    inclusos) — um nome que não existe lá vira, em silêncio, a natureza padrão
    da conta ("Venda para contribuinte"). Vazia, o rascunho é recusado.
  - `base_valor`: `custo` (padrão, `unitCost` do Shopify; sem custo, cai no
    preço de venda e a tela avisa) ou `venda` (preço da variante).
  - `desconto_percentual`: % abatido do valor de cada item (padrão 0).
- **Nº da NF:** nunca é digitado — vem da nota autorizada no Tiny. É gravado
  na emissão e, quando a autorização demora ou a nota é emitida direto no
  Tiny, a tela confere sozinha as linhas da página aberta
  (`/api/transferencias/[id]/situacao`); há também o botão "Conferir no Tiny".
- **Novo rascunho:** com rascunho já criado (e nota não emitida), o botão
  "Novo rascunho" remonta a nota a partir do Shopify e de `lojas_fiscais` e
  cria outro rascunho no Tiny (`POST .../rascunho` com `substituir: true`) —
  útil depois de corrigir o cadastro da loja. O antigo vai para
  `tiny_notas_substituidas`, para ser cancelado à mão no Tiny.
- **Reemitir:** transferência com nota já emitida tem o botão "Reemitir":
  com uma confirmação, cria um novo rascunho (`POST .../rascunho` com
  `reemitir: true`, que exige a trava de emissão ligada) e emite a nota nova.
  O registro volta a "não emitida" antes da emissão e a nota antiga vai para
  `tiny_notas_substituidas` — **a NF anterior continua valendo até ser
  cancelada à mão no Tiny.** Já emitidas também podem ser marcadas para
  "Emitir selecionadas": a confirmação única do lote avisa quantas serão
  reemitidas e vale para todas. "Emitir todas com rascunho" e o "marcar a
  página" continuam ignorando as já emitidas.
- **Editar rascunho (opcional):** `/transferencias/[id]/rascunho/editar`. Salvar cria um NOVO rascunho no Tiny e o
  antigo fica em `tiny_notas_substituidas`, para ser cancelado à mão lá.
- **DANFE:** `/api/transferencias/[id]/danfe` pega o id da nota no Supabase e
  redireciona para o link do Tiny (antes de emitir, sai como prévia sem valor
  fiscal).

---

## Mapa do projeto

O projeto segue uma organização orientada a **features**: cada domínio
(`inicio`, `sysinfo`, `pedidos`, `rascunhos`) tem sua própria pasta de componentes e
hooks em `src/features/`, e o que é compartilhado entre eles (integrações
externas, acesso a dados, regras fiscais, utilitários) fica isolado em
`src/lib/`. As rotas em `src/app/` são a "casca" de roteamento do Next.js —
cada `page.js` reexporta o componente da feature correspondente, e cada
`route.js` de API importa o que precisa de `src/lib/`.

```
src/
  app/
    page.js                          Tela inicial com atalhos -> features/inicio
    sysinfo/page.js                  Diagnóstico das integrações -> features/sysinfo
    pedidos/page.js                  Tela única de atacado -> features/pedidos
    pedidos/[id]/rascunho/page.js            Conferência e inclusão do rascunho -> features/rascunhos
    pedidos/[id]/rascunho/editar/page.js     Redireciona para /pedidos (rascunho enviado não é editado)
    rascunhos/page.js                Redireciona para /pedidos (endereço antigo)
    layout.js                        Cabeçalho + CSS global
    api/saude/route.js               Testa Shopify, Tiny e Supabase
    api/pedidos/route.js             Lista pedidos + classificação + situação fiscal
                                      (inclui rascunhos pendentes fora da lista recente)
    api/pedidos/[id]/preview/        Monta o payload da nota que a tela do rascunho
                                      consome (só leitura)
    api/pedidos/[id]/rascunho/       Cria/edita o rascunho no Tiny (escreve em produção)
    api/pedidos/[id]/situacao/       Confere no Tiny se a nota já foi emitida e o nº da NF
    api/pedidos/[id]/danfe/          Resolve e redireciona pro link do DANFE
    api/pedidos/[id]/emitir/         Emite a nota (irreversível, travado)
    api/config/permitir-emissao/     Liga/desliga a trava de emissão
    transferencias/page.js           Controle de transferências -> features/transferencias
    api/transferencias/              Lista transferências + situação fiscal; subrotas
                                      [id]/preview, [id]/rascunho, [id]/emitir
                                      e [id]/situacao

  components/
    layouts/SiteHeader.js            Cabeçalho de navegação
    ui/Paginacao.js, ui/IconePdf.js   Componentes de UI reaproveitáveis

  features/
    inicio/
      components/Inicio.js           Página inicial: status das integrações
      hooks/useSaude.js
    pedidos/
      components/ControleAtacado.js  Tela única: filtros, rascunho, emissão, nº da NF e DANFE
      hooks/useAtacado.js
    rascunhos/
      components/IncluirRascunho.js  Confere a nota e grava o rascunho no Tiny
      components/EditarRascunho.js   Corrige um rascunho já criado no Tiny
      hooks/useIncluirRascunho.js, hooks/useEditarRascunho.js
    transferencias/
      components/ControleTransferencias.js  Filtros, lista, rascunho e emissão das transferências
      hooks/useTransferencias.js

  lib/
    constants.js                     Constantes de UI compartilhadas
    format.js                        Formatação para exibição na UI
    utils.js                         Formatação de valor, data, CEP, CNPJ, endereço, ids
    db.js                            Histórico, franquias e configurações no Supabase
    fiscal/
      classificacao.js               Atacado, franquia ou outro, a partir do CNPJ
      camposCliente.js                Lista dos campos do cliente exibidos nas telas de rascunho
      montarNota.js                  Pedido do Shopify -> JSON do nota.fiscal.incluir
      montarNotaTransferencia.js     Transferência do Shopify -> JSON do nota.fiscal.incluir
    integrations/
      shopify.js                     Admin GraphQL API — fonte real dos pedidos
      shopifyTransferencias.js       Transferências e locais
      tiny.js                        API 2.0 do Tiny, com as travas de segurança

supabase/
  schema.sql                         As cinco tabelas: notas, pendências,
                                      configurações, CNPJs de franquia e lojas
```

Novos fluxos fiscais (transferência entre lojas, devolução) entram como uma
nova pasta em `src/features/<fluxo>/`, reaproveitando o que já existe em
`src/lib/` sem reescrever nada.

---

## Classificação atacado x franquia

A regra é: pedido sem CNPJ é "outro"; com CNPJ, é "franquia" se o CNPJ estiver
cadastrado na tabela `cnpjs_franquia` do Supabase, senão é "atacado"
(`src/lib/fiscal/classificacao.js`). Não há mais lista fixa no código — se a
consulta ao Supabase falhar, o sistema não arrisca classificar como franquia
por engano e trata como se nenhum CNPJ fosse conhecido.

O CNPJ do cliente ainda não tem uma fonte 100% confirmada no Shopify: hoje o
código lê, nessa ordem, metafield do cliente, `company` do endereço, um
`customAttribute` do checkout e por último a observação do pedido — usando o
primeiro valor que tiver 14 dígitos. Os pontos em aberto continuam marcados
com `// TODO` no código.
