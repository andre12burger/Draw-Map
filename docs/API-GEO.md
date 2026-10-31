# Motor Geodésico, Formas e Imagem de Referência

Documentação das capacidades implementadas a partir do relatório
[`REVERSE-ENGINEERING-DRAWMYLOOP.md`](REVERSE-ENGINEERING-DRAWMYLOOP.md): núcleo
geodésico, roteamento multi-ponto, lápis com simplificação métrica, formas
geométricas com alças de transformação e sobreposição de imagem.

---

## 1. Princípios

- **Funções puras primeiro.** Toda a matemática (Haversine, Douglas-Peucker,
  projeção de formas, bounds) vive em módulos sem Leaflet, testáveis em Node.
- **Duas cópias espelhadas.** O backend é CommonJS (`server/lib/geo.js`) e o
  frontend é ESM (`public/js/core/geo.js`) — não há bundler no projeto. As duas
  implementações são idênticas e a paridade é verificada em
  `tests/unit/geo-parity.test.js`; qualquer alteração deve ser feita nos dois
  ficheiros.
- **Projeção reversível.** Formas e imagens guardam apenas parâmetros
  (`center`, `size`, `rotation`, `scaleX`, `scaleY`); os pontos normalizados em
  `[0, 1]` nunca são mutados.
- **Limites explícitos.** 25 m para formas, 0.1 de escala mínima, 10–20 000 m
  para imagens, 8 000 m por perna e 25 pontos por requisição.

---

## 2. `server/lib/geo.js` (CommonJS)

| Função                                                             | Descrição                                                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `haversine(a, b)`                                                  | Distância em metros (`R = 6 371 000 m`); entradas inválidas → `0`.                                                                          |
| `totalLength(pontos)`                                              | Soma das distâncias entre vértices consecutivos.                                                                                            |
| `perpendicularDistance(p, a, b)`                                   | Distância ponto–segmento com projeção equiretangular local (`111320 * cos(lat)` para longitude).                                            |
| `douglasPeucker(pontos, toleranciaMetros)`                         | Simplificação métrica recursiva.                                                                                                            |
| `resample(pontos, passoMaximoMetros)`                              | Densifica com passo máximo (interpolação linear).                                                                                           |
| `simplifyTrace(pontos, tolerancia?)`                               | Equivalente ao `uS`: DP com tolerância `clamp(L/500, 5, 50)`, passo `clamp(L/15, 100, 500)`, re-simplificação a `1.5×` acima de 100 pontos. |
| `simplifyToCount(pontos, maxPontos)`                               | Busca binária (24 iterações) na tolerância do DP + amostragem uniforme de emergência.                                                       |
| `catmullRom(p0, p1, p2, p3, t, tensao = 0.5)`                      | Spline tensionada; `t = 0 → p1`, `t = 1 → p2`.                                                                                              |
| `suavizarCurva(pontos, subdivisoes = 6, { tensao, fechada })`      | Subdivide formas `type: "curve"`; formas fechadas repetem o primeiro ponto.                                                                 |
| `projectShape(forma, centro, tamanhoMetros, rotacaoGraus, opcoes)` | Projeta `[0, 1] → [lat, lng]` com rotação, `scaleX`, `scaleY` e `aspectRatio` (aplicado ao eixo X).                                         |
| `projectShapeParts(...)`                                           | Projeta a forma principal + `strokes` (letras/ícones compostos).                                                                            |
| `sampleShapeWaypoints(pontos, n)`                                  | `n` pontos equidistantes por comprimento geodésico, incluindo extremos.                                                                     |
| `fidelityMetrics(rota, forma)`                                     | Média/máximo da distância ponto–polígono.                                                                                                   |
| `calcularBbox(pontos)`                                             | Limites, centro, largura e altura em graus.                                                                                                 |
| `normalizarRotacao(graus)`                                         | Normaliza para `[0, 360)`.                                                                                                                  |
| `calcularBoundsImagem(centro, tamanho, aspeto, zoom = 20)`         | Bounds Web Mercator com `156543.03392 * cos(lat) / 2^20`; altura = largura / aspeto.                                                        |

Fórmula da projeção (idêntica à do DrawMyLoop):

```js
const rad = (rotacao * Math.PI) / 180;
const leste = (x - 0.5) * tamanho * scaleX * aspecto;
const norte = (0.5 - y) * tamanho * scaleY; // y cresce para baixo
const lesteRodado = leste * Math.cos(rad) - norte * Math.sin(rad);
const norteRodado = leste * Math.sin(rad) + norte * Math.cos(rad);
lat = centroLat + norteRodado / 111320;
lng = centroLng + lesteRodado / (111320 * Math.cos(centroLat));
```

---

## 3. `POST /api/route-points`

Implementado em `server/routes/route.js` sobre o BRouter, com validação em
`server/lib/validators.js` (`validarPontosRota`, `mapearPerfilRota`).

**Corpo**

```json
{
  "points": [
    [-32.03, -52.1],
    [-32.031, -52.101]
  ],
  "profile": "bike"
}
```

**Regras**

- 2 a 25 pares `[lat, lng]` finitos e dentro dos limites geográficos.
- Cada perna é validada por Haversine antes de qualquer chamada externa:
  `> 8000 m → 422`.
- Perfis: `bike`/`bicycle`/`fastbike`/`trekking` → perfil BRouter homónimo;
  `foot`/`hiking`/`hiking-beta` → `hiking-beta`; desconhecido → `400`.
- Cache em memória de 500 entradas, TTL de 1 h, chave
  `perfil|lat.toFixed(5),lng.toFixed(5);...`.
- Timeout de 8 s por perna (mínimo entre o restante e o orçamento de 25 s).
- 4xx do BRouter → `422`; 5xx/timeout → `502`/`504`; geometria inválida → `502`.

**Resposta**

```json
{
  "coordinates": [
    [-32.03, -52.1],
    [-32.031, -52.101]
  ],
  "distance_m": 222,
  "duration_s": 84,
  "snapped_waypoints": [
    [-32.03, -52.1],
    [-32.031, -52.101]
  ],
  "legs": [{ "distance_m": 111, "duration_s": 42 }],
  "profile": "fastbike"
}
```

Headers: `X-Cache: HIT|MISS` e `Cache-Control: public, max-age=3600`.

O endpoint legado `GET /api/rota` mantém-se inalterado.

### Cliente

`public/js/services/api.js` expõe `rotearPontos(pontos, { perfil, timeout, sinal })`,
que envia o `POST`, converte `[lat, lng] → [lat, lng, 0]` e reutiliza a
retentativa exponencial existente (408/425/429/5xx). `buscarRotaLote` continua a
usar o `GET` em lotes de 40 pontos por compatibilidade com o fluxo antigo.

---

## 4. `public/js/core/geo.js` (ESM)

Espelho do módulo do backend, com uma função adicional:

### `reconstruirAlcas(pontos, { maxHandles = 120, minSpacingMeters = 8, toleranceMeters = 12 })`

Equivalente ao `ek` do DrawMyLoop:

1. remove duplicados consecutivos (`< 0.5 m`);
2. Douglas-Peucker com 12 m (iterativo, devolve índices);
3. acrescenta vértices com **viragem ≥ 55°** (ignora segmentos < 5 m);
4. filtra por **espaçamento mínimo de 8 m**, mantendo o primeiro de cada grupo;
5. acima de **120** alças, decima uniformemente;
6. devolve `{ handles: [[lat, lng], ...], bindings: number[] }` — `bindings[i]` é
   o índice do ponto original correspondente.

---

## 5. `public/js/map/pencil.js`

- Filtro de **2 px** entre pontos e deteção de arrasto real (`> 1 px` desde o
  início do gesto).
- **Clique simples** → `adicionarPonto(latlng)` (snap para a via).
- **Arrasto** → `prepararPontosEstrategicos` (DP métrico adaptativo +
  reamostragem de 40 m) → `processarLoteLapis`.
- `prepararAlcas` expõe a reconstrução de waypoints para edição.
- Repaint do traço em `requestAnimationFrame` (um por frame) e guarda de
  **500 ms** entre gestos.
- `Escape` cancela o traço; `Space` devolve o pan; `blur` limpa o estado.
- Toque: 1 dedo desenha; 2 dedos cancelam o traço e devolvem o pinch ao mapa.

`CONFIG_LAPIS` centraliza os limiares (2 px, 500 ms, 40 m, 120 alças, 8 m, 12 m).

---

## 6. `public/js/map/shapes.js`

### API

| Função                                                                                     | Descrição                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `criarForma({ id, shape, center, size, rotation, scaleX, scaleY, interativa, callbacks })` | Cria/substitui a forma e as 10 alças. `shape` aceita `'estrela'`, `'hexagono'`, `'triangulo'` ou um objeto `{ points, type, closed, tension, aspectRatio, strokes }`. |
| `atualizarForma(id, patch)`                                                                | Atualiza `center`, `size` (mín. 25 m), `rotation` (normalizada), `scaleX`/`scaleY` (mín. 0.1) e `visible`.                                                            |
| `definirVisibilidade(id, visivel)`                                                         | Mostra/esconde camadas e alças.                                                                                                                                       |
| `removerForma(id)` / `limparFormas()`                                                      | Remove forma(s) e alças (com guarda contra frames pendentes).                                                                                                         |
| `getForma(id)` / `listarFormas()`                                                          | Estado público (sem camadas).                                                                                                                                         |
| `inicializarFormas()`                                                                      | Garante o mapa (idempotente).                                                                                                                                         |

### Alças (todas `L.divIcon`, com `map.dragging` desativado durante o arrasto)

| Alça       | Classe                                | Comportamento                                                                                                    |
| ---------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Centro     | `shape-handle--center`                | Move preservando o offset `center − bboxCenter`; `onMoveLive` por frame (≈32 ms) e `onMove` no `dragend`.        |
| Cantos (4) | `shape-handle--corner`                | Escala uniforme `size * distAtual / distInicial`, mínimo **25 m**.                                               |
| Superior   | `shape-handle--rotation`              | `rotation = (rotacaoInicial − (anguloAtual − anguloInicial)) mod 360`; `atan2(dLng, dLat)` com eixo Y invertido. |
| Bordas     | `shape-handle--edge-ew` / `--edge-ns` | Escala não-uniforme pelo rácio da bounding box (`(maxLng − lng) / largura`, etc.), mínimo **0.1**.               |

`dragend` reativa o pan e chama `onTransformEnd` após 50 ms (para o Leaflet
terminar o evento). O `center` da alça central é o centro da **bounding box**,
garantindo que o offset não provoca saltos.

---

## 7. `public/js/map/image-overlay.js`

| Função                                                                          | Descrição                                                                                                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `mostrarImagem({ url, center, size, opacity, aspectRatio, callbacks })`         | Cria a sobreposição e as 5 alças (centro + 4 cantos). Sem `aspectRatio`, lê `naturalWidth / naturalHeight` (fallback `1` após 3 s). |
| `atualizarImagem({ center, size, opacity })`                                    | Atualização combinada.                                                                                                              |
| `moverImagem(center)` / `redimensionarImagem(size)` / `definirOpacidade(valor)` | Atalhos com limites.                                                                                                                |
| `removerImagem()` / `getImagemReferencia()`                                     | Remove / consulta o estado público.                                                                                                 |
| `inicializarImagemReferencia()`                                                 | Cria o pane dedicado.                                                                                                               |

- `size` é a **largura real** em metros, limitada a **10–20 000 m**; a altura é
  `largura / aspeto`.
- Bounds calculados com `calcularBoundsImagem` no zoom 20 (precisão sub-métrica,
  independente do zoom atual) e convertidos em `L.latLngBounds`.
- Redimensionamento: distância em pontos de camada
  (`map.latLngToLayerPoint`), logo constante em píxeis e independente do zoom.
- Render: `L.imageOverlay(url, bounds, { opacity, interactive: false, pane: 'reference-image', className: 'ph-no-capture reference-image-layer' })`.
- O pane `reference-image` tem `zIndex = 350` e `pointer-events: none`.
- No elemento `<img>` são aplicados `data-clarity-mask="true"`,
  `data-html2canvas-ignore="true"`, `alt=""` e `draggable="false"`.
- Não existe rotação para a imagem (apenas mover, redimensionar e opacidade).

### UI

O painel (`#legenda`) ganhou os botões **✨ Forma** e **🖼️ Imagem**, um
`<input type="file">` oculto, um slider de opacidade (`#input-opacidade`) e o
botão de remoção. A imagem é carregada via `URL.createObjectURL` e o URL é
revogado ao substituir/remover.

---

## 8. Testes

| Ficheiro                           | Cobertura                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `tests/unit/geo.test.js`           | Haversine, DP, reamostragem, splines, projeção (0°/90°/217°), bounds, bbox.                   |
| `tests/unit/geo-parity.test.js`    | Paridade numérica backend ↔ frontend com entradas determinísticas.                            |
| `tests/unit/route-points.test.js`  | Contrato do `POST /api/route-points`, cache, validações e mapeamento de erros.                |
| `tests/unit/pencil.test.js`        | DP adaptativo, passo máximo, ângulo ≥ 55°, espaçamento de 8 m, limite de 120 alças.           |
| `tests/unit/shapes.test.js`        | Fórmulas das alças + integração Leaflet (mover, redimensionar, rodar, escalar, visibilidade). |
| `tests/unit/image-overlay.test.js` | Limites, aspeto, bounds 2000×1000 m, atributos de privacidade, arrasto e clamp.               |

```bash
npm test          # Vitest
npm run lint      # ESLint
npm run format:check
```

---

## 9. Limitações e próximos passos

- O molde da forma e a imagem de referência **não são persistidos** no
  `localStorage`: vivem no módulo e desaparecem ao recarregar. A rota consolidada
  com **Use this route** passa a fazer parte do estado global (e do undo/GPX).
- O Auto-Fit usa o `POST /api/route-points` existente (até 25 waypoints por
  requisição) em vez de um `POST /api/project-shape` dedicado no servidor.
- A biblioteca de formas (`/api/shapes`) não foi replicada; apenas as formas
  locais (`estrela`, `hexagono`, `triangulo`), apresentadas no painel dinâmico.
- O arrasto do lápis só acumula pontos dentro do mapa; mover o cursor fora do
  contentor interrompe o traço (comportamento igual ao Leaflet nativo).
