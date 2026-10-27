# Relatório do projeto reformulado

**Projeto:** Strava Art Generator<br>
**Branch:** `cline/1d3kf3jc`<br>
**Data:** 27/10/2026<br>
**Versão:** 2.0.0

---

## 1. Sumário executivo

O projeto passou por uma reformulação completa de arquitetura, correção de bugs e introdução de qualidade automatizada. O núcleo funcional (desenhar, rotear, editar, desfazer, persistir e exportar) foi preservado, mas a implementação interna foi substituída por módulos com responsabilidades claras, estado imutável e backend defensivo.

### Números da reformulação

| Indicador | Antes | Depois |
|---|---|---|
| Arquivos versionados | 632 (617 em `node_modules`) | sem `node_modules`/`repomix` versionados |
| Módulos do frontend | 7 arquivos monolíticos | 17 módulos por domínio |
| Backend | 1 arquivo (`server.js`, 75 linhas) | 10 arquivos (config, libs, middlewares, rotas, bootstrap) |
| Testes automatizados | 0 | **53 testes unitários** + 6 specs E2E |
| Lint / formatação | ausentes | ESLint 10 + Prettier + CI |
| Vulnerabilidades (`npm audit`) | não verificado | **0** |
| Duplicações de CDN/CSS | Leaflet 2×, Chart.js sem uso, `.marcador-km` 2× | removidas |
| Estado/undo | referências compartilhadas, histórico no LS | imutável, undo em memória, persistência sanitizada |
| Segurança do proxy | parâmetros crus, sem timeout/cache/limite | validação, allowlist, cache, rate limit, CSP, helmet |

---

## 2. O que o projeto faz

O sistema é um planejador de **GPS Art / Strava Art**:

1. O utilizador desenha sobre um mapa Leaflet em três modos: **Rua** (snap-to-road), **Livre** (linha reta) e **Lápis** (traço livre).
2. No modo Rua, cada clique é projetado na via mais próxima via BRouter e o trecho é roteado por ruas reais.
3. No modo Lápis, o traço é simplificado em pixels, subdividido em trechos de até 40 m e roteado em lotes de 40 pontos por requisição.
4. Pontos podem ser arrastados (re-roteamento dos vizinhos) ou inseridos com botão direito numa linha.
5. A rota é persistida no navegador (LocalStorage versionado) e pode ser desfeita com Ctrl+Z.
6. A exportação gera um GPX 1.1 com metadados, nome configurável e elevação.
7. O backend atua como proxy do Nominatim e do BRouter, com validação, cache, timeout e proteção contra abuso.

---

## 3. Como funciona a nova arquitetura

### Frontend

```
index.html
  └─ js/main.js
       ├─ core/state.js         estado + observer + undo transacional
       │    ├─ core/history.js  pilha de snapshots (somente memória)
       │    └─ core/persistence.js  LocalStorage versionado + sanitização
       ├─ services/api.js       fetch com timeout, abort, retry e contador
       ├─ map/map.js            mapa, tiles, zoom, view persistida
       ├─ map/render.js         desenho declarativo a partir do estado
       ├─ map/draw.js           adicionar/inserir/arrastar/lote/limpar/undo
       ├─ map/pencil.js         captura do traço e simplificação
       ├─ map/preview.js        cursor fantasma com abort/sequência
       ├─ map/distance.js       Haversine + marcadores de km (puro)
       ├─ ui/toolbar.js         ferramentas, atalhos, aria-pressed
       ├─ ui/search.js          autocomplete acessível + debounce
       ├─ ui/stats.js           estatísticas/status
       ├─ ui/toast.js           notificações e erros globais
       └─ export/gpx.js         GPX 1.1 puro + download
```

O fluxo de uma mutação é sempre:

```
handler (ex.: clique)
  → clona o estado atual
  → calcula/valida a alteração
  → commitEstado() registra snapshot e persiste
  → observer dispara redesenhar(estado)
  → estatísticas e marcadores de km são recalculados
```

Isso elimina a duplicação de verdade entre arrays locais e o objeto de estado que existia antes.

### Backend

```
server.js → server/index.js (listen + shutdown)
              └─ server/app.js (helmet, CSP, compression, rate limit, static)
                   ├─ /api/health
                   ├─ /api/pesquisa → routes/geocode.js → Nominatim
                   └─ /api/rota     → routes/route.js    → BRouter
```

- `config.js`: parâmetros por ambiente e carregamento nativo de `.env` (`process.loadEnvFile`, sem sobrescrever variáveis já definidas).
- `lib/http.js`: `fetch` + `AbortSignal.timeout`, User-Agent, status e parsing seguro.
- `lib/validators.js`: validação estrita de coordenadas, allowlist de perfis e termo de busca.
- `lib/cache.js`: cache TTL com limite de entradas.
- `routes/*`: validação → cache → upstream → status correto (400/422/502/503/504).
- `app.js`: CSP, compressão, rate limit, estáticos com cache e tratamento central de erros.


---

## 4. Correções aplicadas

### 4.1 Reavaliação de um achado do relatório anterior

O relatório inicial classificou como crítico um possível `TypeError` ao inserir ponto no último trecho (`coordenadasNiveis[index + 1]`). **A reavaliação mostrou que o crash não ocorria no fluxo normal**: o `splice` do novo ponto acontece antes da leitura de `index + 1`, portanto o antigo último ponto passa a ocupar `index + 1`.

O que existia de fato era:

- ausência de guarda para índice 0 / índice inválido;
- mutação parcial quando o segundo trecho falhava;
- ausência de `try/finally`, que poderia deixar `carregandoRota` preso em qualquer exceção.

A nova implementação trata os três pontos: valida índices, calcula as duas metades **antes** de mutar o estado (rollback natural) e envolve tudo em `try/finally`. Há teste de regressão específico para inserção no último trecho.

### 4.2 Matriz de correções

| # | Problema anterior | Solução aplicada | Evidência |
|---|---|---|---|
| 1 | Estado inicial e reset compartilhavam arrays; undo restaurava referências do histórico | `criarEstadoInicial()` por factory, `clonarProfundo` em toda leitura, snapshot antes da mutação | `state.test.js` |
| 2 | Histórico completo (50 rotas) gravado no LocalStorage a cada mudança | Histórico apenas em memória; persistência restrita a campos duráveis | teste “sem histórico” |
| 3 | Erro de cota do LS apenas no console | Evento `app:storage-error` + toast com sugestão de exportar GPX | `state.test.js` (QuotaExceeded) |
| 4 | Undo não persistia; reload trazia o ponto “desfeito” de volta | `desfazerUltimo` persiste e notifica; observer redesenha | `state.js`/`main.js` |
| 5 | Primeiro ponto não podia ser desfeito | Pilha de snapshots anteriores; undo do primeiro ponto volta ao vazio | `state.test.js` |
| 6 | Marcadores de km perdidos quando um trecho cruzava vários km | `while` com ratio e guarda de distância zero | `distance.test.js` |
| 7 | `carregandoRota` preso após exceções | `try/catch/finally` em adicionar, inserir, arrastar e lote | `draw.test.js` |
| 8 | Inserção mutava parcialmente se o segundo trecho falhasse | Cálculo das duas metades antes do `commit` | `draw.test.js` |
| 9 | Lápis travava o mapa ao soltar fora do mapa | `mouseup` no `document`, cancelamento em `blur`/troca, sincronização do `dragging` | `pencil.js` |
| 10 | Espaço acionava botão focado e rolava a página | `preventDefault`, `e.repeat`, exclusão de campos/botões/links, reset no `blur` | `pencil.js` |
| 11 | Cursor fantasma consultava BRouter a cada 400 ms em qualquer ferramenta | Só Rua/Livre, debounce 350 ms, `AbortController`, descarte fora de ordem | `preview.js` |
| 12 | Preview inflava “Requisições API” | Contador só para chamadas reais; snap usa `contar:false` | `api.test.js` |
| 13 | Distância lida de `innerText` (podia persistir `NaN`) | Estado calculado por Haversine puro; DOM apenas exibe | `distance.js`/`stats.js` |
| 14 | Retry duplicado e aplicado a 4xx; lote sem retry | `comRetentativa` único, só 408/425/429/5xx/rede | `api.test.js` |
| 15 | Backend interpolava parâmetros crus e sem timeout/status | URLSearchParams, validação estrita, allowlist, `AbortSignal.timeout`, status preservado | `validators.test.js` |
| 16 | Upstream 4xx/5xx virava 500 genérico | 400 próprio, 422 sem rota, 502/503/504 upstream | smoke: rota inválida → 400 |
| 17 | Sem cache/rate limit; risco de bloqueio por fair use | Cache TTL (24 h/1 h), rate limit por IP, User-Agent com contato | `cache.test.js`, `X-Cache` |
| 18 | Sem headers de segurança e `X-Powered-By` exposto | helmet + CSP + compressão; `x-powered-by` desativado | smoke de headers |
| 19 | Leaflet duplicado, Chart.js e polylineoffset sem uso | Leaflet local único; dependências mortas removidas | `index.html` |
| 20 | CSS duplicado e painel gráfico órfão | `style.css` reescrito, responsivo, sem duplicatas | inspeção |
| 21 | Globais `window.ferramentaAtiva/processar*` | estado + módulos explícitos (`draw`, `toolbar`) | `main.js` |
| 22 | `maxZoom: 24` borrava tiles nativos 19 | `maxZoom` e `maxNativeZoom` em 19 | `map.js` |
| 23 | LS corrompido quebrava a inicialização | `sanitizarEstado` reconstrói segmentos, modos, nome, mapa e distância | `state.test.js` |
| 24 | Lote do lápis com índices fora de ordem/segmentos vazios | Projeção monotônica + `if (fim <= inicio) continue` | `draw.test.js` |
| 25 | GPX sem metadados/elevação/escape | GPX 1.1 com `<metadata>`, `<ele>`, escape e nome configurável | `gpx.test.js` |
| 26 | `node_modules` e `repomix.xml` versionados | `.gitignore` + remoção do índice + artefato apagado | `git status` |
| 27 | Sem testes, lint, formatação ou CI | Vitest (53), Playwright (6), ESLint/Prettier, Actions | execuções abaixo |
| 28 | Dependências de teste vulneráveis | Vitest/coverage 5.0.5 | `npm audit` → 0 |
| 29 | README desatualizado e sem contrato de API | README reescrito + `.env.example` | README |
| 30 | `express.json()` inútil; sem 404/handler de erro | middleware removido, 404 JSON e handler global | `app.js` |

### 4.3 UX e acessibilidade

- `alert`/`confirm` substituídos por toasts; apagar virou ação reversível.
- Toolbar com `aria-pressed`, rótulos, foco visível e atalhos `1/2/3`.
- Busca com `role="combobox"`, `listbox`, setas, Enter e Escape.
- Status `aria-live` para “Calculando rota...”, “Processando desenho...” etc.
- Layout responsivo (painel compacto e toolbar horizontal em telas ≤ 720 px).
- Nome da rota configurável e persistido.
- Posição/zoom do mapa persistidos.

---

## 5. Testes e validação executada

### 5.1 Resultados

| Verificação | Comando | Resultado |
|---|---|---|
| Lint | `npx eslint .` | **0 erros / 0 warnings** |
| Testes unitários | `npx vitest run` | **53 testes / 9 arquivos / todos passando** |
| Vulnerabilidades | `npm audit` | **0** |
| Cobertura (módulos puros) | `npm run test:coverage` | **78,29% statements / 81,86% lines** |
| Sintaxe/imports | script de resolução de imports | **0 imports quebrados** |
| IDs do DOM | script `getElementById` × HTML | **0 IDs ausentes** |
| Servidor | smoke com `curl` | `/` 200, health 200, rota real 200, inválida 400, 404 JSON |
| Cache | duas chamadas iguais | `X-Cache: MISS` e depois `HIT` |
| Headers | `curl -D` | CSP, HSTS, nosniff, referrer-policy, sem `X-Powered-By` |
| Geocodificação | Nominatim real | 200 com `display_name` e cache 24 h |

### 5.2 Servidor (evidências)

```
GET /                        → 200 + CSP + Cache-Control: no-cache
GET /api/health              → {"status":"ok","versao":"2.0.0",...}
GET /api/rota?lonlats=abc    → 400 {"erro":"Informe pelo menos dois pontos..."}
GET /api/rota (válida)       → 200, X-Cache: MISS, Cache-Control: public, max-age=3600
GET /api/rota (repetida)     → 200, X-Cache: HIT
GET /api/pesquisa?q=...      → 200, X-Cache: MISS, max-age=86400
GET /api/nao-existe          → 404 {"erro":"Endpoint não encontrado."}
```

### 5.3 Playwright / E2E

Foram criados 6 cenários E2E com as APIs externas mockadas por `page.route`:

1. carregamento do mapa e da UI sem erros de console;
2. adicionar dois pontos, calcular distância e desfazer com Ctrl+Z;
3. persistência após reload;
4. download de GPX 1.1 com track points;
5. autocomplete de endereço e centralização;
6. troca de ferramenta com `aria-pressed` e cursor.

**Limitação do ambiente de execução:** o Chromium do Playwright não inicia neste sandbox por ausência de bibliotecas de sistema (`libglib-2.0.so.0`), e não há `sudo`/apt disponível para instalá-las. Os specs estão prontos e o workflow de CI usa `npx playwright install --with-deps chromium`, que instala as dependências no runner do GitHub. Portanto, o E2E **não foi executado localmente** nesta sessão.

Para compensar, foi criado o teste `frontend-smoke.test.js`, que carrega o `index.html` real em jsdom, importa o Leaflet, executa o `main.js` e simula cliques no mapa (modo livre), verificação de distância, Ctrl+Z, botão “Apagar tudo” e undo da limpeza. Ele validou o boot completo da aplicação, o wiring entre módulos, o observer, a renderização de marcadores/linhas e a persistência.

### 5.4 Cobertura de testes por módulo

| Arquivo | Testes |
|---|---|
| `tests/unit/state.test.js` | 7 |
| `tests/unit/history.test.js` | 3 |
| `tests/unit/draw.test.js` | 11 |
| `tests/unit/distance.test.js` | 7 |
| `tests/unit/gpx.test.js` | 7 |
| `tests/unit/api.test.js` | 5 |
| `tests/unit/validators.test.js` | 7 |
| `tests/unit/cache.test.js` | 5 |
| `tests/unit/frontend-smoke.test.js` | 1 (boot real do frontend no jsdom + desenhar/undo/limpar) |
| **Total** | **53** |

---

## 6. Higiene do repositório

- `.gitignore` criado: `node_modules/`, `.cline-home/`, `repomix-output.xml`, `.env*`, `coverage/`, `test-results/`, `playwright-report/`, logs e artefatos de IDE.
- `.gitattributes` adicionado para EOL LF e para tratar `public/vendor/**` como asset de terceiros.
- `node_modules` (617 arquivos) e `repomix-output.xml` removidos do índice do Git.
- `repomix-output.xml` apagado do disco (snapshot obsoleto que listava `grafico.js`, já removido).
- `package-lock.json` atualizado.
- `public/vendor/leaflet` versionado e regenerável via `npm run vendor` / `postinstall`.
- CI em `.github/workflows/ci.yml` com dois jobs (lint/test e E2E), Node 24 e cache de npm.

---

## 7. Riscos e limitações restantes

1. **Dependência de serviços públicos:** BRouter/Nominatim não oferecem SLA. O cache e o rate limit reduzem o risco, mas não o eliminam.
2. **Persistência local:** o LocalStorage continua limitado a ~5 MB; o app avisa e sugere exportar o GPX, mas não migra automaticamente para IndexedDB.
3. **Undo por sessão:** o histórico não é persistido (decisão deliberada para evitar quota e vazamento de rotas antigas).
4. **Lote do lápis:** a divisão por projeção monotônica é robusta para a maioria dos traços, mas auto-interseções severas ainda podem gerar pequenas imprecisões geométricas.
5. **Desenho por toque:** o layout é responsivo e os controles são acessíveis, mas o traço fino do lápis foi pensado para mouse; em dispositivos móveis o desenho pode ser impreciso.
6. **E2E:** precisa de navegador com dependências de sistema; roda no CI, não neste sandbox.
7. **Autenticação:** não há contas/rotas privadas; o serviço é um planejador público.

---

## 8. Próximos passos recomendados

1. Adicionar **IndexedDB** para rotas densas e histórico opcional.
2. Implementar **undo/redo** com pilha de redo.
3. Criar **teste de integração do backend** com `supertest` e upstream mockado (sem rede).
4. Adicionar **métricas/observabilidade** (pino + request id) e health com dependências.
5. Considerar **auto-hospedagem** de BRouter/Nominatim para uso intenso.
6. Implementar desenho por toque com Pointer Events e testes em dispositivo real.
7. Adicionar **cache HTTP no cliente** para geocodificação (evitar reconsultas ao digitar de volta).
8. Avaliar `express@5` + `helmet`/`rate-limit` atuais e política de versionamento.

---

## 9. Conclusão

A reformulação elimina os riscos estruturais do projeto original: o estado deixou de ser mutável por referência, o undo passou a ser transacional e persistente, o backend deixou de ser um proxy aberto e o frontend foi dividido em módulos testáveis. A aplicação mantém todas as funcionalidades originais e ganha:

- **53 testes** cobrindo os pontos que antes falhavam, incluindo um smoke de integração que inicializa o frontend real em jsdom e executa desenho, undo e limpeza;
- **0 vulnerabilidades** conhecidas nas dependências;
- **CSP/helmet/rate limit/cache/timeout** no servidor;
- **CI** com lint, formatação, testes e E2E;
- **documentação** de execução, API, arquitetura e limitações.

O projeto está pronto para ser commitado na branch `cline/1d3kf3jc` e validado no CI. Nenhum commit ou push foi realizado, conforme a política da tarefa.
