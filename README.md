# S.J. Martins Corretor de Imóveis — Plataforma Imobiliária Integrada

Plataforma de **S.J. Martins Corretor de Imóveis** (atua em toda a cidade de
São Paulo): site institucional + painel administrativo + assistente de IA
(Claude) em **um único serviço** Node/Express. Todos os dados vivem em um
banco SQLite embutido no mesmo deploy — nenhum serviço externo além da API
da Anthropic.

| Rota | O que é |
| --- | --- |
| `/` | Site público da S.J. Martins Corretor de Imóveis, com a vitrine de imóveis e o chat da Ana |
| `/admin` | Painel: publica anúncios no site e recebe as fichas de clientes (login) |
| `/api/catalogo` | API pública que alimenta a vitrine do site |
| `/api/conversa/*`, `/api/ficha`, `/health` | API do assistente de IA (Claude) |

## Como tudo se conecta

```
 Painel (/admin) ── publica anúncios ──▶ SQLite ◀── grava fichas ── Chat da Ana (site)
        ▲                                 │  │
        └──────── lê fichas ──────────────┘  └──── lê anúncios ────▶ Site (/) e Ana
```

1. **Painel → Site**: um anúncio salvo no painel aparece na vitrine do site
   na hora (o site lê `/api/catalogo`; anúncios "Vendido"/"Alugado" somem).
2. **Painel → Ana**: a vitrine é injetada no prompt da assistente a cada
   mensagem — a Ana só recomenda imóveis realmente cadastrados.
3. **Ana → Painel**: quando a Ana coleta os dados do cliente, a ficha é
   gravada no banco e aparece no painel imediatamente, com etapas
   (recebido → conversando → fechado) e exportação CSV.

## Stack

- **Node.js 20 + Express 5** — um servidor só serve os dois front-ends
  estáticos (HTML/CSS/JS puro, sem build) e toda a API.
- **SQLite (better-sqlite3)** — banco embutido em arquivo único; em produção
  vive num Volume e sobrevive a deploys.
- **Claude (Anthropic SDK)** — assistente com memória por visitante, vitrine
  dinâmica de imóveis e handoff para o WhatsApp.
- **Zero imagens externas** — todas as artes do site são SVG inline.

## Estrutura

```
├── src/
│   ├── server.js      # Express: estáticos + API pública + API do painel
│   ├── db.js          # SQLite: tabelas anuncios e fichas + queries
│   ├── agente.js      # prompt da Ana (Claude) + vitrine dinâmica
│   ├── conversas.js   # memória de conversa por visitante
│   └── validar.js     # validação de visitorId/mensagem
├── public/            # site público (servido em /)
│   └── admin/         # painel (servido em /admin, protegido por login)
├── views/entrar.html  # tela de login do painel
├── railway.json       # configuração de deploy do Railway
└── package.json
```

## Rodando localmente

```bash
npm install
cp .env.example .env   # preencha ANTHROPIC_API_KEY, CONVERSA_SECRET e ADMIN_PASSWORD
npm start
# http://localhost:3000        → site + chat da Ana
# http://localhost:3000/admin  → painel (login com ADMIN_USER/ADMIN_PASSWORD)
```

O banco é criado sozinho em `./data/sjmartins.db` na primeira execução.

## Personalização

- **WhatsApp**: o número oficial `+55 11 98231-3938` (`5511982313938`) está em
  três lugares — `WHATSAPP_NUMBER` no `.env`, a constante `WHATSAPP_SJMARTINS` em
  `public/app.js` e os links `wa.me` de `public/index.html`. Se mudar no
  futuro, ajuste nos três.
- **Textos e região**: cidade/bairros de atuação estão em
  `public/index.html` e no prompt de `src/agente.js`.
- **Identidade visual**: cores e fontes ficam nas variáveis CSS no topo de
  `public/styles.css` e `public/admin/admin.css`.

## Deploy no Railway

1. Crie um projeto no Railway e conecte este repositório.
2. **Volume** (para o banco não sumir a cada deploy): adicione um Volume ao
   serviço, montado em `/data`.
3. Configure as variáveis:
   - `ANTHROPIC_API_KEY` — chave da Anthropic (obrigatória para o chat)
   - `CONVERSA_SECRET` — segredo longo e aleatório
   - `ADMIN_USER` / `ADMIN_PASSWORD` — credenciais do painel
     (`ADMIN_PASSWORD` é obrigatória; sem ela o painel fica bloqueado)
   - `WHATSAPP_NUMBER` — WhatsApp oficial de S.J. Martins (dígitos com DDI)
   - `DATA_DIR=/data` — aponta o banco para o Volume
4. O Railway detecta Node.js e usa o `railway.json` (start `npm start`,
   healthcheck em `/health`).
5. Em **Settings → Networking**, gere o domínio público.

## API

### Pública

- `GET /api/catalogo` — anúncios visíveis no site (exclui Vendido/Alugado)
- `GET /health` — healthcheck

### Conversa (usada pelo chat do site)

- `POST /api/conversa/abrir` com `{ "visitorId": "uuid" }` →
  `{ "token": "...", "validadeMs": 900000 }`
- `POST /api/conversa` com header `X-Conversa-Token` e body
  `{ "visitorId": "uuid", "texto": "Olá" }` → `{ "resposta": "..." }`
- `POST /api/ficha` com header `X-Conversa-Token` e body
  `{ "visitorId": "uuid", "ficha": [{ "campo": "nome", "valor": "Italo" }], "origem": "https://site.com" }`
  → grava a ficha (uma por visitante; envios repetidos atualizam)

### Painel (exige cookie de login)

- `GET /admin/api/anuncios` · `POST /admin/api/anuncios` ·
  `PUT /admin/api/anuncios/:id` · `DELETE /admin/api/anuncios/:id`
- `POST /admin/api/foto` — corpo é a própria imagem (JPG/PNG/WebP/GIF, até
  5 MB, `Content-Type` da imagem) → `{ "url": "/fotos/foto-…" }`
- `GET /admin/api/fichas` · `PATCH /admin/api/fichas/:id`
  (`{ "etapa": "recebido|conversando|fechado" }`) · `DELETE /admin/api/fichas/:id`

### Erros

`400` entrada inválida · `401` token/sessão inválidos · `404` não encontrado ·
`413` payload muito grande · `429` rate limit · `500` erro interno
