-- acessos.sql — papel de cada usuário do SAP (login e acesso às áreas).
--
-- 1. Crie o usuário no painel do Supabase: Authentication > Users > Add user
--    (e-mail + senha, marque "Auto Confirm User").
-- 2. Rode o UPDATE abaixo no SQL Editor com o e-mail e o papel dele.
--
-- Papéis (regras em src/lib/acessos.js):
--   admin       — tudo
--   financeiro  — B2B, Boletos e Transferências
--   varejo      — B2C
-- Usuário sem papel entra, mas não vê nenhuma área.
--
-- O papel fica em app_metadata: entra no token de login e o próprio usuário
-- não consegue alterar. Vale a partir do próximo login (ou da renovação do
-- token, em até 1 hora) — para valer na hora, peça para a pessoa sair e entrar.

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('papel', 'financeiro')
where email = 'pessoa@rowastore.com.br';

-- Conferir quem tem qual papel:
-- select email, raw_app_meta_data->>'papel' as papel from auth.users order by email;
