# 🏃‍♂️🎨 Strava Art Generator (Web Service)

Web service para planejamento de rotas de **GPS Art / Strava Art**: o utilizador desenha no mapa e o sistema converte o traço em uma rota que segue ruas e calçadas reais, pronta para exportar em `.gpx`.

Projeto académico de **Cliente/Servidor** com arquitetura **frontend estático + backend proxy**.

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.12-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-199900?logo=leaflet&logoColor=white)
![Licença](https://img.shields.io/badge/licen%C3%A7a-Apache%202.0-blue)

---

## ✨ Funcionalidades

- **Roteamento nas ruas (snap-to-road):** cada clique é projetado na via mais próxima e ligado por uma rota real do BRouter.
- **Modo Livre / Shift+clique:** liga pontos em linha reta tracejada, sem consultar o roteador.
- **Modo Lápis:** desenho livre com simplificação em pixels, subdivisão de trechos longos e roteamento em lote (40 pontos por requisição).
- **Edição:** arrastar marcadores re-roteia os trechos vizinhos; botão direito numa linha insere um ponto intermediário — inclusive no último trecho.
- **Undo (Ctrl+Z):** pilha de 50 estados, mantida em memória, com restauração transacional (sem corromper snapshots).
- **Persistência versionada:** rota, modos, ferramenta, nome e posição do mapa no `LocalStorage`; histórico não é persistido para evitar estouro de cota.
- **Busca de endereços:** autocomplete via Nominatim com debounce, cancelamento de requisições, navegação por teclado (setas/Enter/Escape) e cache de 24 h no servidor.
- **Exportação GPX 1.1:** metadados, nome configurável, elevação e escape XML.
- **Feedback acessível:** toasts (`aria-live`), status de carregamento, `aria-pressed` nas ferramentas e foco visível.
- **Atalhos:** `1` Rua, `2` Livre, `3` Lápis, `Shift` reta livre, `Espaço` pan no lápis, `Ctrl+Z` desfazer.

---

## 🏗️ Arquitetura

```
Navegador (Leaflet + ES Modules)
  ├─ core/state.js        → estado imutável, observer, undo
  ├─ core/history.js      → pilha de snapshots (memória)
  ├─ core/persistence.js  → LocalStorage versionado + sanitização
  ├─ services/api.js      → fetch com timeout, abort, retry e contador
  ├─ map/                 → mapa, render, draw, lápis, preview, distância
  ├─ ui/                  → toolbar, busca, estatísticas, toasts
  └─ export/gpx.js        → gerador GPX puro + download
        │  /api/pesquisa, /api/rota
        ▼
Express (proxy + validação + cache + rate limit)
  ├─ routes/geocode.js    → Nominatim
  └─ routes/route.js      → BRouter
        │
        ▼
Nominatim (OpenStreetMap) · BRouter
```

### Decisões de arquitetura

- **Proxy Pattern:** contorna CORS, esconde parâmetros e centraliza timeout/cache/limites.
- **Estado como fonte única da verdade:** a UI sempre redesenha a partir de uma cópia profunda do estado; não há arrays duplicados entre módulos.
- **Undo transacional:** o snapshot é registrado **antes** da mutação. Assim o primeiro ponto também pode ser desfeito e mutações posteriores não corrompem o histórico.
- **Falha controlada:** todo handler assíncrono usa `try/finally`; nenhuma exceção deixa o app em estado “ocupado” permanente.
- **Sem CDN no caminho crítico:** Leaflet é servido localmente a partir de `public/vendor` (copiado pelo `postinstall`), o que permite CSP estrita e funcionamento offline dos assets da biblioteca.

---

## 🚀 Como executar

### Requisitos

- **Node.js 22.12+** (o runtime usa `fetch` nativo e o toolchain de testes exige Node moderno)
- Ligação à internet para tiles do OpenStreetMap e APIs de geocodificação/roteamento

```bash
git clone https://github.com/seu-usuario/strava-art-generator.git
cd strava-art-generator

cp .env.example .env       # ajuste, principalmente CONTACT_EMAIL
npm install                # instala e copia o Leaflet para public/vendor
npm start                  # http://localhost:3000
```

Modo desenvolvimento com reload do servidor:

```bash
npm run dev
```

### Configuração (`.env`)

| Variável               | Padrão                                | Descrição                                        |
| ---------------------- | ------------------------------------- | ------------------------------------------------ |
| `PORT`                 | `3000`                                | Porta HTTP                                       |
| `NODE_ENV`             | `development`                         | `development`, `production` ou `test`            |
| `CONTACT_EMAIL`        | `contato@strava-art-generator.local`  | Contato no `User-Agent` (exigido pelo Nominatim) |
| `BROUTER_URL`          | `https://brouter.de/brouter`          | Endpoint do BRouter                              |
| `NOMINATIM_URL`        | `https://nominatim.openstreetmap.org` | Endpoint do Nominatim                            |
| `UPSTREAM_TIMEOUT_MS`  | `12000`                               | Timeout das APIs externas                        |
| `RATE_LIMIT_WINDOW_MS` | `60000`                               | Janela do rate limit                             |
| `RATE_LIMIT_MAX`       | `60`                                  | Máximo de requisições por IP na janela           |
| `TRUST_PROXY`          | `false`                               | Habilite apenas atrás de proxy reverso           |

---

## 🔌 API

Todas as respostas são JSON. Erros seguem `{ "erro": "mensagem" }` e, quando aplicável, `{ "upstream": 500 }`.

### `GET /api/health`

```json
{ "status": "ok", "versao": "2.0.0", "ambiente": "development", "uptimeSegundos": 12 }
```

### `GET /api/pesquisa?q=<termo>`

Valida `q` (2–200 caracteres), consulta o Nominatim, reduz a resposta e faz cache por 24 h.

```json
[
  {
    "lat": -32.0386359,
    "lon": -52.1115452,
    "display_name": "Praça Saraiva, Rio Grande, Rio Grande do Sul, Brasil"
  }
]
```

| Status                | Quando                                   |
| --------------------- | ---------------------------------------- |
| `200`                 | Busca concluída (inclusive lista vazia)  |
| `400`                 | `q` ausente/curto/longo                  |
| `502` / `503` / `504` | Falha, rate limit ou timeout do upstream |

Headers: `X-Cache: HIT|MISS`, `Cache-Control: public, max-age=86400`.

### `GET /api/rota?lonlats=<lon,lat|lon,lat|...>&profile=<perfil>`

- `lonlats`: 2 a 50 pares `lon,lat` separados por `|`.
- `profile`: allowlist `shortest`, `trekking`, `fastbike`, `hiking-beta` (padrão `shortest`).
- Resposta: GeoJSON do BRouter, com `X-Cache` e `Cache-Control: public, max-age=3600`.

| Status                | Quando                                         |
| --------------------- | ---------------------------------------------- |
| `200`                 | Rota calculada                                 |
| `400`                 | Parâmetros inválidos/injeção/tamanho excessivo |
| `422`                 | Nenhuma rota encontrada                        |
| `502` / `503` / `504` | Falha, rate limit ou timeout do upstream       |

---

## 🧪 Testes e qualidade

```bash
npm test               # 53 testes unitários (Vitest + jsdom)
npm run test:coverage  # cobertura V8
npm run lint           # ESLint 10 (flat config)
npm run format:check   # Prettier
npm run test:e2e       # Playwright (requer navegador)
```

Para rodar E2E localmente:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

Cobertura atual dos testes unitários:

- `state` / `history` / `persistence`: isolamento de arrays, undo, corrupção, sanitização e cota do LocalStorage.
- `draw`: adição de pontos, inserção no último trecho, falha transacional, arrasto, lote do lápis, concorrência e limpeza.
- `distance`: Haversine, marcadores de km (inclusive múltiplos km num único segmento) e limites.
- `gpx`: GPX 1.1, escape XML, deduplicação, elevação e nome do arquivo.
- `api`: modo livre, conversão de coordenadas, retry/erros e contador.
- `validators` / `cache`: injeção de parâmetros, allowlist, ranges, TTL e LRU.
- `frontend-smoke`: inicializa o `index.html` real, o Leaflet e o `main.js` em jsdom; desenha dois pontos, calcula distância, desfaz, apaga e desfaz a limpeza.

O workflow de CI (`.github/workflows/ci.yml`) executa lint, formatação, testes unitários e E2E em Node 24.

---

## 📁 Estrutura

```
server/
  app.js              # fábrica Express (helmet, CSP, compressão, rate limit)
  index.js            # bootstrap + encerramento gracioso
  config.js           # configuração por ambiente
  lib/{cache,http,validators}.js
  routes/{geocode,route,health}.js
public/
  index.html
  css/style.css
  js/
    main.js
    core/{state,history,persistence,utils}.js
    services/api.js
    map/{map,render,draw,pencil,preview,distance}.js
    ui/{toolbar,search,stats,toast}.js
    export/gpx.js
  vendor/leaflet/     # gerado por npm run vendor/postinstall
tests/
  unit/               # Vitest
  e2e/                # Playwright
```

---

## 🔒 Segurança e resiliência

- `helmet` com CSP (scripts apenas `self`), `X-Content-Type-Options`, `frame-ancestors 'none'`, HSTS.
- Validação estrita de `lonlats` e allowlist de `profile` — bloqueia injeção de parâmetros e URLs abusivas.
- `AbortSignal.timeout` nas chamadas externas; status do upstream preservado (400/422/502/503/504).
- Cache TTL em memória (geocode 24 h, rota 1 h) e rate limit por IP.
- `compression`, `Cache-Control` para assets e `immutable` para o vendor.
- `User-Agent` identificável com contato (política do Nominatim) e `Accept-Language: pt-BR`.
- Encerramento gracioso em `SIGINT`/`SIGTERM`, com timeout de 10 s.
- LocalStorage com versionamento, sanitização e evento de erro de cota; histórico de undo **nunca** é persistido.

---

## ⚠️ Limitações conhecidas

- **BRouter e Nominatim públicos** não têm SLA e aplicam fair use; para uso intenso, auto-hospede ou configure `BROUTER_URL`/`NOMINATIM_URL`.
- **Tiles** do OpenStreetMap exigem internet e respeitam a política de uso da fundação.
- **Undo** é por sessão: recarregar a página restaura a rota, mas não a pilha de undo.
- **LocalStorage** tem cota de ~5 MB; rotas muito densas podem atingir o limite (o app avisa e sugere exportar o GPX).
- O split do lote do lápis usa projeção do ponto mais próximo; desenhos com auto-interseções severas podem gerar pequenas imprecisões.
- Sem autenticação/multiusuário: é um serviço público de planejamento, não um repositório de rotas.

---

## 👨‍💻 Autoria

**André Luiz Ditzel Burger**<br>
Engenharia de Automação — Universidade Federal do Rio Grande (FURG)

Licença: [Apache 2.0](LICENSE).
