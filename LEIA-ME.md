# RoleSP, Fase 2: API

Express + Postgres (Neon). Testada localmente em Postgres 16 (rotas públicas, filtros, rotas de curadoria, validações, limite de senha). Ainda NÃO testada no Render nem no Neon real.

## Rotas
Públicas (só rolês com status `publicado`; únicos já passados somem sozinhos):
- `GET /api/health`: confirma que a API e o banco respondem (use para "acordar o servidor").
- `GET /api/meta`: categorias, bairros e tags existentes (para montar os filtros).
- `GET /api/roles`: lista com filtros (todos opcionais, combináveis):
  - `categoria=rango,palco` (qualquer uma)
  - `tag=barato,date` (todas)
  - `preco_max=30` (em reais) ou `gratuito=1`
  - `dia=hoje|amanha|dom|seg|ter|qua|qui|sex|sab` (fuso de São Paulo)
  - `periodo=madrugada|manha|tarde|noite`
  - `bairro=Luz`, `q=texto`, `limit=200`
- `GET /api/roles/:id`: um rolê.

Curadoria (header `Authorization: Bearer SENHA`): `GET /api/admin/roles`, `GET /api/admin/lugares`, `POST|PUT /api/admin/lugares[/:id]`, `POST|PUT /api/admin/roles[/:id]`, `PATCH /api/admin/roles/:id/status` (`rascunho`, `publicado`, `arquivado`). Preço vai em centavos. Agenda: `[{"dow":0,"inicio":"09:00","fim":"17:00"}]` (0 = domingo).

## Variáveis de ambiente
Veja `.env.example`. `DATABASE_URL` (Neon, versão pooled, sem channel_binding), `ADMIN_PASSWORD` (12+ caracteres; sem ela o painel fica desligado), `ALLOWED_ORIGIN` (endereços do site, separados por vírgula). Nunca suba o `.env` para o GitHub (o `.gitignore` já ignora).

## Rodar no seu computador (Node 20+)
1. `npm install`
2. Copie `.env.example` para `.env` e preencha.
3. `npm run dev` e abra http://localhost:3000/api/health (deve mostrar `{"ok":true}`) e http://localhost:3000/api/roles.

## Publicar no Render
1. Crie um repositório no GitHub com esta pasta (sem `node_modules` e sem `.env`).
2. No Render: New + > Web Service > conecte o repositório. Runtime Node, Build Command `npm install`, Start Command `npm start`, plano Free. (Ou use o `render.yaml` como Blueprint.)
3. Em Environment, cadastre `DATABASE_URL`, `ADMIN_PASSWORD` e `ALLOWED_ORIGIN`.
4. Quando terminar o deploy, abra `https://SEU-SERVICO.onrender.com/api/health` e `/api/roles`.

Plano gratuito do Render (conferido em docs.render.com/free em 31/10/2026): dorme após 15 minutos sem acesso, leva cerca de 1 minuto para acordar, 750 horas gratuitas por mês por workspace, disco apagado a cada reinício, sem cartão no cadastro.

## Segurança já embutida
Senha comparada em tempo constante; 10 senhas erradas por IP bloqueiam 15 min; limite geral de 600 requisições/15 min por IP; corpo limitado a 20 KB; toda entrada validada; erros internos só no log; CORS só para os endereços autorizados.
