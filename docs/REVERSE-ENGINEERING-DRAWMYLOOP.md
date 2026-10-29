# Engenharia reversa do editor do DrawMyLoop (GPS Art)

**Fonte analisada:** bundle Next.js de `https://drawmyloop.com/en/studio`
(`webpack-f15d732234982755.js` + chunks assíncronos, principalmente `5586.ff0f45fea0c95cc1.js`,
`5814.efc424264cdb6b03.js`, `3485.3ed87e06eba600cf.js`, `4886-d7ff5303d9665cc5.js`,
`2272-9e1b9a9465681c9c.js`, `5608-894579079e6f4f01.js`, `2964-7abe82c8887f7d81.js`).
**Data:** 29/10/2026
**Objetivo:** documentar as quatro mecânicas de domínio (roteamento/snap, lápis livre, formas
geométricas e sobreposição de imagem) e propor a replicação no `strava-art-generator`
(Express + Leaflet).

> Todos os nomes de variáveis/funções citados são os identificadores obfuscados do bundle.
> Quando o nome original é recuperável (strings de API, campos de estado), ele é preservado.

---

## 1. Stack e arquitetura observadas

| Aspeto               | Evidência no bundle                                                                |
| -------------------- | ---------------------------------------------------------------------------------- |
| Renderização do mapa | **Leaflet 1.9** (`L.map`, `L.imageOverlay`, `L.polygon`, `L.polyline`, `L.marker`) |
| UI                   | React 18 + `react-leaflet` (`MapContainer`, `Polyline`, `Marker`, `useMapEvents`)  |
| Estado               | Store tipo Zustand (`useAppStore.getState().draft`, `setDraft`)                    |
| Roteamento           | **OSRM** (self-hosted via proxy) e um serviço próprio de "point routing"           |
| Snap de formas/lápis | Serviço próprio `POST /api/project-shape` (motor "C3"), com fallback OSRM          |
| Biblioteca de formas | `GET/POST /api/shapes`, `DELETE /api/shapes/:id` (Bearer token)                    |

Feature flags relevantes: `NEXT_PUBLIC_OWN_POINT_ROUTING`,
`NEXT_PUBLIC_SHAPE_PROJECTION_LAB`, `NEXT_PUBLIC_LIVE_SHAPE_PREVIEW`,
`NEXT_PUBLIC_BROWSER_SHAPE_PREVIEW`, `NEXT_PUBLIC_BROWSER_POINT_ROUTING`,
`NEXT_PUBLIC_AUTOFIT_COMPARISON_MODE`.

O editor é composto por dois chunks principais:

- `5586.*` — estado do estúdio, histórico, chamadas de rede, reconstrução de waypoints,
  geometria de formas e geração de payloads.
- `5814.*` — camada Leaflet: captura de ponteiro do lápis, overlays de forma/imagem e
  alças de transformação (mover, redimensionar, rodar, escalar).

### 1.1 Formato de dados adotado em todo o app

```ts
type LatLng = [lat: number, lng: number]; // SEMPRE nesta ordem no cliente
type ShapePoint = [x: number, y: number]; // normalizado 0..1, y para baixo (topo = 0)

type Shape = {
  id: string;
  name: string;
  type: 'polyline' | 'curve';
  points: ShapePoint[];
  strokes?: ShapePoint[][]; // formas multi-traço (letras, ícones)
  aspectRatio?: number; // largura/altura — multiplica o eixo X
  closed?: boolean;
  tension?: number; // 0.5 por omissão
};
```

Exceção importante: **o payload de `/api/project-shape` envia `center: [lng, lat]`**
(`center: [e.center[1], e.center[0]]` em `3485`), enquanto o resto do cliente usa
`[lat, lng]`. Essa inversão é intencional no contrato do backend e deve ser replicada.

---

## 2. Mecânica 1 — Roteamento e snap-to-road

### 2.1 Contrato `POST /api/route-points`

Chamado pelo hook de rotas nativo (`5586`, função `eU`):

```js
fetch('/api/route-points', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ points: [[lat, lng], ...], profile: 'bike' | 'foot' }),
  cache: 'no-store',
  signal: AbortSignal.any([abortSignal, AbortSignal.timeout(8000)]),
});
```

Resposta validada campo a campo (`eq`):

```json
{
  "coordinates": [
    [48.85, 2.29],
    [48.86, 2.3]
  ],
  "distance_m": 1523.4,
  "duration_s": 365.6,
  "snapped_waypoints": [
    [48.8501, 2.2902],
    [48.8601, 2.3003]
  ]
}
```

Regras do cliente antes de chamar (`e$`, `eO`, `eq`):

- `2 <= points.length <= 25`;
- cada perna consecutiva tem de ter **≤ 8 000 m** (haversine);
- coordenadas finitas, `|lat| ≤ 90`, `|lng| ≤ 180`;
- `snapped_waypoints.length === points.length`;
- `distance_m` e `duration_s` finitos e ≥ 0.

Comportamento de falha (`eU` + `eD`/`eF`):

- resposta 5xx **exceto 504**, ou erro de rede → abre **circuit breaker de 60 s**
  (`eD = Date.now() + 60000`); durante esse período o cliente nem tenta o endpoint;
- timeout por requisição: **8 s** (uma perna) e **10 s** (janela de pernas);
- `NEXT_PUBLIC_OWN_POINT_ROUTING === '0'` desliga completamente o endpoint;
- 504 é tratado como falha transitória (não abre o breaker).

O endpoint pode ainda devolver `legs` (usado pelo divisor guloso `eK`):

```json
{ "legs": [{ "coordinates": [[48.85, 2.29]], "distance_m": 812.3 }] }
```

### 2.2 Contrato `GET /api/osrm-public/route/v1/...`

Proxy same-origin para um OSRM privado (`eG = "/api/osrm-public"`):

```
GET /api/osrm-public/route/v1/{profile}/{lng},{lat};{lng},{lat}?overview=full&geometries=polyline6&steps=false&continue_straight=true
```

- `profile` é **`bicycle`** ou **`foot`** (perfis OSRM, não `bike`);
- coordenadas em **`lng,lat`** (invertidas em relação ao cliente);
- `geometries=polyline6` → descodificação com precisão 6 (`polyline.decode(geometry, 6)`);
- `snappedWaypoints` vem de `routes[0].waypoints[].location`, invertido para `[lat, lng]`;
- resposta normalizada: `{ coordinates, distance, duration, snappedWaypoints }`;
- **health check**: `GET /api/osrm-public/route/v1/{profile}/2.2945,48.8584;2.2950,48.8738`
  (Paris), timeout 7 s, resultado em `sessionStorage` como `osrm-health-{profile}`.

### 2.3 Cache e lotes (cliente)

- Cache em memória, chave `${profile}|${lat.toFixed(5)},${lng.toFixed(5)};...`,
  limite de **500 entradas** (remove a mais antiga quando excede).
- Lotes de **24 pernas (25 pontos)** por requisição, porque `/api/route-points`
  aceita no máximo 25 pontos.
- `findBatchRoutes`:
  1. resolve tudo o que está em cache;
  2. tenta `route-points` em blocos de 24 pernas;
  3. quebra o bloco quando `snapped[i] !== points[i + 1]` (pernas não contíguas);
  4. se o breaker abrir, para e devolve o que já tem;
  5. caso contrário, cai para OSRM ponto-a-ponto.
- `findMultiWaypointRoute` percorre `points` em janelas de 25 e concatena
  `coordinates.slice(1)` para não duplicar o ponto de junção.

### 2.4 Cadeia de snap para formas e lápis

```
POST /api/project-shape   (motor próprio "C3", preferido)
        │ falhou / 422 / timeout 60 s
        ▼
amostragem de waypoints sobre a forma + OSRM (fallback "autofit")
        │ falhou
        ▼
rota direta entre waypoints (linha reta, marcada como "unrouted")
```

Payload de forma (`M(e)` em `3485`):

```json
{
  "shape_points": [
    [0.1, 0.9],
    [0.2, 0.8]
  ],
  "center": [2.3522, 48.8566],
  "size_meters": 2000,
  "rotation_deg": 0,
  "scale_x": 2,
  "scale_y": 1,
  "profile": "foot",
  "alpha": 1,
  "beta": 0.5,
  "gamma": 2
}
```

- `scale_x = (shape.aspectRatio ?? 1) * state.scaleX` (o aspeto entra no eixo X);
- opcionais: `preview: true`, `comparison_requested: true`, `quality_context`;
- `422` significa `no_route` (forma sem ruas suficientes).

Payload de lápis (função `C` em `3485`):

```json
{ "geo_points": [[48.85, 2.29]], "profile": "bike", "quality_context": {} }
```

Resposta comum:

```json
{
  "coordinates": [[48.85, 2.29]],
  "fidelity_avg_m": 7.4,
  "fidelity_max_m": 38.1,
  "comparison": { "version": "route_comparison_v1", "score": 0.87 },
  "quality_snapshot": {},
  "projection": { "algorithm": "shape_preserving_v4" }
}
```

Limites do cliente: forma com **≤ 400 pontos** no navegador (corta com `r9`), **≤ 500** no
caminho manual; lápis **≤ 500** pontos; timeout **60 s** com `AbortController`.

### 2.5 Score de fidelidade ("autofit")

O motor compara a rota com o polígono original (`route_comparison_v1`) usando:

| Métrica           | Uso                                           |
| ----------------- | --------------------------------------------- |
| `frechet_ratio`   | distância de Fréchet normalizada              |
| `p95_ratio`       | percentil 95 do desvio ponto-a-ponto          |
| `coverage_visual` | quanto do desenho ficou coberto pela rota     |
| `tangent_score`   | alinhamento das tangentes (evita zigue-zague) |
| `closure_score`   | fecho do loop                                 |
| `length_ratio`    | comprimento da rota / comprimento do desenho  |

O "scanner" de formas testa variantes de **rotação** (`rotationRangeDeg`, padrão 20°),
**escala** (`scaleTolerance`) e **espelho** (`allowMirror`), escolhendo o candidato com
melhor `score`. É a mesma ideia usada para gerar arte a partir de uma forma sem
posicionamento manual.

---

## 3. Mecânica 2 — Lápis (desenho livre)

### 3.1 Captura de ponteiro (componente `ek` em `5814`)

O lápis não usa `L.Draw` nem plugins: é um controlador React montado dentro do mapa que
escuta eventos nativos e do Leaflet.

```js
function ek({
  onMapClick, onMouseMove, isDragging, clickBlockedRef,
  onCenterChange, onZoomChange, onBoundsChange, onUserInteraction,
  pencilMode, onPencilDraw, onPencilDrawEnd, onPencilClick,
  pencilDrawingLayerRef, mobilePanOverride, cursorClass,
}) { ... }
```

Regras de início (`mousedown` via `useMapEvents`):

- ignora se o alvo (ou ancestral) for `.leaflet-interactive`, `.leaflet-control` ou
  `.leaflet-popup-content-wrapper`;
- ignora `Shift` (reservado para "linha reta livre" / pan), `Space` (pan temporário),
  `mobilePanOverride`, arrasto em curso ou clique bloqueado;
- botão direito (`button === 2`) apenas marca `w.current` (contexto), não desenha;
- guarda de **500 ms** entre o fim de um gesto e o início do próximo (`j.current`);
- inicializa `y.current = [[lat, lng]]` (array de pontos em `[lat, lng]`).

Durante o movimento (`window.mousemove`):

- converte com `map.mouseEventToLatLng(e)`;
- filtro de **2 px**: `D(x, y)` guarda a última posição e só aceita novo ponto se
  `dx² + dy² >= 4`;
- marca "arrasto real" quando o deslocamento desde o início é **> 1 px** (`L.current`);
- empurra o ponto e pede atualização do layer em **`requestAnimationFrame`**
  (`B()` → `pencilDrawingLayerRef.current.setPositions(points)`), evitando repaint por evento.

No fim (`window.mouseup`):

- se houve arrasto e `points.length > 2` → `onPencilDrawEnd(points, false)`;
- senão, se existe pelo menos um ponto → `onPencilClick(lastPoint, false)`
  (um toque = um waypoint, não um traço);
- limpa buffers e `pencilDrawingLayerRef.current.clear()`.

Toque (`touchstart/move/end`, `{ passive: false }`):

- `1` dedo desenha; `>= 2` dedos cancelam o traço e devolvem o controlo ao mapa (pinch);
- acumula `pathLengthPx` (`P.current`) para distinguir **toque** de **traço**;
- `onPencilDrawEnd` só é chamado se o gesto for considerado traço (heurística
  `n9({ pointCount, pathLengthPx, hadMultiTouch })`); caso contrário, toque simples.

Atalhos e modos:

- `Escape` cancela o traço em curso e chama `onPencilDraw([])`;
- `Space` mantém o mapa em modo pan (roda do rato faz `panBy([dx/2, dy/2])`);
- em modo lápis, `dragging`, `touchZoom`, `scrollWheelZoom`, `smoothWheelZoom`,
  `doubleClickZoom`, `boxZoom` e `keyboard` são desativados (`q()`), exceto quando o
  utilizador pede pan;
- classes de cursor: `cursor-mode-pencil`, `cursor-mode-pan`, `cursor-mode-points`,
  `cursor-mode-shapes`.

### 3.2 Fluxo no editor (`fu`, `fd`, `fp`, `fc` em `5586`)

```js
fu = useCallback((points) => {
  if (!busy && !shape) setGhost(points);
}, []);

fd = useCallback(
  (points, straight) => {
    if (busy) {
      reset();
      return;
    }
    track('pencil', 'pencil_stroke');
    processPencil(points, straight); // fc
    analytics.pencilDrawCompleted(points.length, straight);
  },
  [processPencil, track],
);

fp = useCallback((point) => {
  /* adiciona waypoint (clique) ou traço */
}, []);
```

`fc(points, straight)` (`processPencil`):

1. `points.length < 2` → limpa o fantasma e sai.
2. **Modo freeform** (`ct.current`): não há snap; o traço é simplificado e vira rota
   direta (`i9(...)`, `rQ(...)`); em modo "linha reta" usa `uS(points, 50)`.
3. Calcula `i = uS(points)` (traço simplificado).
4. Se **já existem waypoints** e o snap está ligado (`i0`):
   - `projectPencilViaBackendC3(i, profile)` → `POST /api/project-shape`
     com `{ geo_points, profile, quality_context }`;
   - liga o último waypoint ao primeiro ponto projetado com uma perna roteada;
   - funde `nonRoutedSegments` (trechos que falharam) e recalcula distância/handles.
5. Caso contrário (primeiro traço): `ek(i)` gera waypoints e `eI(i)` a distância;
   - com snap → `projectPencilViaBackendC3`;
   - sem snap → `pF(...)` grava rota direta, `waypointsQuality` marca trechos
     `sourceTraceSegmentCount` vs `directSegmentCount`.
6. Guarda `sessionStorage["dml_guided_pencil_ghost_v1"]` com as últimas 20 pinceladas
   (`{ coordinates, savedAt }`) para restaurar o fantasma ao recarregar.

### 3.3 Simplificação do traço — `uS` (módulo `26163`)

```js
function uS(points, toleranceMeters) {
  if (points.length < 3) return points;
  const lengthM = totalLength(points); // soma de haversine
  const tolerance = toleranceMeters ?? Math.max(5, Math.min(50, lengthM / 500));
  const maxSpacing = Math.max(100, Math.min(500, lengthM / 15));

  let out = resample(douglasPeucker(points, tolerance), maxSpacing);
  if (out.length < 3 && points.length >= 3) {
    return [points[0], points[Math.floor(points.length / 2)], points.at(-1)];
  }
  if (out.length > 100) out = douglasPeucker(out, tolerance * 1.5);
  return out;
}
```

- `douglasPeucker` usa **distância perpendicular em metros** (projeção equiretangular local:
  `111320 * cos(lat)` para longitude), não distância em graus;
- `resample(points, maxSpacing)` densifica segmentos com passo máximo de 100–500 m
  (importante para o roteador ter pontos intermédios em curvas suaves);
- `r9(points, maxPoints)` reduz para N pontos por **busca binária no epsilon do DP**
  (24 iterações), com fallback de amostragem uniforme;
- `Ry(points, maxStep = 500)` apenas densifica (usado antes de exportar/rotear).

### 3.4 Reconstrução de waypoints — `ek` (`5586`)

Quando o traço é convertido em pontos de controlo (para o utilizador poder arrastar):

```js
ek(points, { maxHandles = 120, minSpacingMeters = 8, toleranceMeters = 12 });
```

1. remove duplicados consecutivos (`eb`);
2. DP com tolerância de **12 m** → candidatos;
3. adiciona vértices onde o **ângulo de viragem ≥ 55°**
   (`acos` dos vetores normalizados; ignora segmentos < 5 m);
4. filtra por **espaçamento mínimo de 8 m** (mantém o primeiro de cada grupo);
5. se exceder **120** handles, decima uniformemente;
6. devolve `{ handles: LatLng[], bindings: number[] }` — `bindings[i]` é o índice do
   ponto original correspondente (usado para "esticar" a rota ao arrastar um handle).

O mesmo módulo tem `eS` (deformação elástica dos pontos entre dois handles),
`eN` (corte em segmentos por handles) e `e_` (mapeamento handles → índices).

---

## 4. Mecânica 3 — Formas geométricas

### 4.1 Estado e modelo

Estado inicial (`2272`, `draft.libraryShape`):

```js
libraryShape: {
  shape: null,
  center: [48.8566, 2.3522],
  size: 2000,      // metros (largura)
  rotation: 0,     // graus, 0..360
  scaleX: 1,
  scaleY: 1,
  visible: false,
}
```

A forma em si (`/api/shapes` ou biblioteca local) é normalizada em `[0, 1]`:

```js
{
  id: 'star',
  name: 'Estrela',
  category: 'symbols',
  type: 'polyline' | 'polygon' | 'curve',
  points: [[0.5, 0], [0.61, 0.35], ...],
  strokes: [[[0, 0], [1, 0]], ...], // opcional (letras, ícones compostos)
  aspectRatio: 1,
  closed: true,
  tension: 0.5,
}
```

### 4.2 Projeção forma → geografia (`h_`, módulo `69070`)

```js
function projectShape(
  shape,
  center,
  size,
  rotationDeg = 0,
  smooth = true,
  subdivisions = 6,
  scaleX = 1,
  scaleY = 1,
) {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((center[0] * Math.PI) / 180);

  const toLatLng = ([x, y]) => {
    const east = (x - 0.5) * size * scaleX;
    const north = (0.5 - y) * size * scaleY; // y cresce para baixo
    const rotatedEast = east * cos - north * sin;
    const rotatedNorth = east * sin + north * cos;
    return [center[0] + rotatedNorth / metersPerDegLat, center[1] + rotatedEast / metersPerDegLng];
  };

  const points = shape.type === 'curve' ? smoothCurve(shape, subdivisions) : shape.points;
  return points.map(toLatLng); // [[lat, lng], ...]
}
```

Verificação numérica (rot 0, `size = 2000`, centro Paris): o ponto `[1, 0.5]` cai
exatamente em `lng + 1000 / (111320 * cos(lat))`; com `rot = 90°` cai em
`lat + 1000 / 111320` — confirmado em `node`.

Notas:

- `size` é a **largura em metros** (eixo X); a altura depende de `aspectRatio` e `scaleY`;
- `scaleX` já inclui `aspectRatio` quando vem do estado
  (`scale_x = (shape.aspectRatio ?? 1) * state.scaleX`);
- `center` é `[lat, lng]` **nesta** função; o payload do backend inverte para `[lng, lat]`.

### 4.3 Suavização — Catmull-Rom com tensão (`o` em `69070`)

Formas `type: "curve"` são subdivididas (6 por omissão) com um spline de Catmull-Rom
"tensionado":

```js
function catmullRom(p0, p1, p2, p3, t, tension = 0.5) {
  const l = (1 - tension) / 2;
  const t2 = t * t;
  const t3 = t2 * t;
  const c0 = -l * t3 + 2 * l * t2 - l * t;
  const c1 = (2 - l) * t3 + (l - 3) * t2 + 1;
  const c2 = (l - 2) * t3 + (3 - 2 * l) * t2 + l * t;
  const c3 = l * t3 - l * t2;
  return [
    c0 * p0[0] + c1 * p1[0] + c2 * p2[0] + c3 * p3[0],
    c0 * p0[1] + c1 * p1[1] + c2 * p2[1] + c3 * p3[1],
  ];
}
```

- verificado: `t = 0` devolve `p1`, `t = 1` devolve `p2`;
- `subdivisions` é **6** por omissão, mas os chamadores usam **10** quando
  `type === "curve"` (mais suave) e 4–6 em miniaturas;
- forma fechada quando `|first - last| < 0.01` em X e Y (`co(shape)`);
- em formas fechadas, o último ponto é removido antes da suavização e o primeiro é
  repetido no fim;
- **traços de imagem** (`sourceType: "image"`) não são suavizados quando um segmento é
  maior que 5× o comprimento médio (evita "derreter" cantos de silhuetas).

### 4.4 Dimensionamento e limites

```js
const SHAPE_MIN_SIZE_M = 25; // M.L1 (módulo 65608)
const SHAPE_DEFAULT_SIZE_M = 2000; // estado inicial
const SHAPE_MAX_SIZE_M = 33396; // ~0.3 * circunferência no equador

function fitBounds(center, sizeMeters) {
  const mPerDegLng = Math.max(1, 111320 * Math.cos((center[0] * Math.PI) / 180));
  const clamped = Math.min(Math.max(6000, sizeMeters), Math.min(33396, 0.3 * mPerDegLng));
  const dLat = clamped / 2 / 111320;
  const dLng = clamped / 2 / mPerDegLng;
  return {
    north: center[0] + dLat,
    south: center[0] - dLat,
    east: center[1] + dLng,
    west: center[1] - dLng,
  };
}
```

`tv(shape, size, scaleX, scaleY) = size * Math.max(aspectRatio * scaleX, scaleY)` é usado
para calcular a "pegada" visual (miniatura, enquadramento) sem projetar toda a forma.

Nota: o mínimo **geométrico** é 25 m (`M.L1`), mas `fitBounds` nunca enquadra menos de
**6 000 m** — é um limite de _framing_ de ecrã, não de desenho.

### 4.5 Alças de transformação (componente `N` em `5814`)

Todas as alças usam `divIcon` com classes CSS `shape-handle--center`, `--corner`,
`--rotation`, `--edge-ew`, `--edge-ns`, e desativam `map.dragging` enquanto arrastam.

**Mover** (centro):

- guarda o offset `[center[0] - bboxCenter[0], center[1] - bboxCenter[1]]`;
- durante o arrasto aplica o offset ao `latlng` do marcador (não "salta" para o centro);
- `onMoveLive` a cada frame (limitado a ~32 ms) e `onMove` no `dragend`.

**Redimensionar** (cantos) — escala uniforme:

```js
const initial = { size, distance: distanceFromCenter(cornerLatLng) };
// drag
const ratio = distanceFromCenter(currentLatLng) / initial.distance;
onSizeChange(Math.max(25, initial.size * ratio)); // M.L1 = 25 m
```

**Rodar** (alça acima do topo, a 15% da altura do bbox):

```js
const angleFromCenter = (lat, lng) =>
  (180 / Math.PI) * Math.atan2(lng - center[1], lat - center[0]);

const start = { rotation, angle: angleFromCenter(lat, lng) };
// drag
let delta = -(angleFromCenter(lat, lng) - start.angle); // eixo Y invertido
let rotation = (start.rotation + delta) % 360;
if (rotation < 0) rotation += 360;
onRotationChange(rotation);
```

**Escalar eixos** (alças nas bordas) — não uniforme, por rácio da _bounding box_:

```js
// guarda no dragstart
const initial = { scaleX, scaleY, width: maxLng - minLng, height: maxLat - minLat };

// arrasto horizontal
const ratio = (edge === 'left' ? maxLng - lng : lng - minLng) / initial.width;
onScaleChange(Math.max(0.1, initial.scaleX * ratio), initial.scaleY);

// arrasto vertical
const ratio = (edge === 'top' ? lat - minLat : maxLat - lat) / initial.height;
onScaleChange(initial.scaleX, Math.max(0.1, initial.scaleY * ratio));
```

- o mínimo de escala é **0.1** em cada eixo;
- `onMoveLive`/arrasto são limitados por `requestAnimationFrame` com intervalo mínimo de
  ~32 ms (`K`/`Q`), e o `dragend` faz `setTimeout(onTransformEnd, 50)` para o Leaflet
  terminar o evento antes de recalcular a rota;
- a rotação e a escala não alteram os pontos normalizados — são apenas parâmetros de
  projeção, o que torna a transformação reversível e barata.

### 4.6 Biblioteca, letras e traço de imagem

- `GET /api/shapes` devolve `{ shapes: Shape[] }`; `POST /api/shapes` cria
  `{ name, category, type, points, strokes, aspectRatio, closed, tension }`;
  `DELETE /api/shapes/:id` remove; todas exigem `Authorization: Bearer <token>`.
- Categorias fixas: `basics, animals, food, nature, transport, sport, body, objects,
letters, symbols` (`JJ` em `65608`).
- **Letras**: `e4(text)` gera glifos para `A-Z 0-9 _` (avanço **1.2** por caractere, `_` vira
  `space` no fim), normaliza para `[0, 1]` e produz `type: "polygon"`, `closed: false`,
  `aspectRatio = totalWidth` (sem dividir pela altura, que é 1),
  `autofitRotationRangeDeg: 180`, além de `autofitPointWeights` (peso por ponto:
  `4` em vértice de curva, `2` em linha reta, `0.2` em espaço, `0.05` em conector) e
  `autofitSegmentRoles` (para o otimizador saber o que é traço e o que é salto).
- **Traço de imagem**: `sourceType: "image"`, até **500 pontos**; se a importação tiver
  apenas 2 pontos, é inserido um ponto médio (linha horizontal); o resultado é
  `shape_kind: "generic"` com `aspectRatio` calculado.
- Formas de texto usam `autofitShapeKind: "text"` e podem ter `aspectRatio > 4`
  (o código trata `text-*` com aspeto largo de forma especial na miniatura SVG).

---

## 5. Mecânica 4 — Sobreposição de imagem (referência)

### 5.1 Estado e limites

```js
imageOverlay: {
  imageUrl: null,
  assetId: undefined,
  center: [48.8566, 2.3522],
  size: 2000,       // largura em metros
  opacity: 0.5,
  aspectRatio: undefined, // se ausente, é lida da imagem
  editable: false,
  placementPending: false,
  visible: false,
}
```

- `size` é limitado a **10 m … 20 000 m** durante o redimensionamento;
- opacidade é livre (0–1), por omissão `0.5`;
- **não existe rotação** para a imagem: o estado não tem `rotation` e o componente
  `b` (em `5814`) só implementa mover, redimensionar, opacidade e apagar.
  (As formas é que rodam — ver 4.5.)

### 5.2 Cálculo dos bounds (o núcleo da mecânica)

```js
function imageBounds(map, center, sizeMeters, aspectRatio, zoom = 20) {
  const point = map.project(center, zoom);
  const metersPerPixel = (156543.03392 * Math.cos((center[0] * Math.PI) / 180)) / Math.pow(2, zoom);
  const widthPx = sizeMeters / metersPerPixel;
  const heightPx = widthPx / aspectRatio;

  return L.latLngBounds(
    map.unproject(point.subtract([widthPx / 2, heightPx / 2]), zoom),
    map.unproject(point.add([widthPx / 2, heightPx / 2]), zoom),
  );
}
```

- `156543.03392` = metros/pixel no zoom 0 (tiles 256 px, circunferência equatorial);
- projetar no zoom 20 e dessprojetar dá precisão sub-métrica e independe do zoom atual;
- `size` = largura real em metros; a altura é `largura / aspectRatio`;
- verificado: `size = 2000 m`, `aspectRatio = 2` → 2000 m × 1000 m.

### 5.3 Interação

- **Mover**: marcador central `+` arrastável; `onMove` no `dragend`;
- **Redimensionar**: 4 cantos; no `dragstart` guarda
  `{ size, distance: layerDistance(center, corner) }`; no `drag`,
  `size = clamp(10, 20000, initial.size * distance / initial.distance)` — a distância é
  medida em **pontos de camada** (`latLngToLayerPoint`), logo é constante em píxeis e
  independente do zoom;
- **Aspeto**: se `aspectRatio` não for fornecido, é calculado com
  `new Image()` → `naturalWidth / naturalHeight` no `onload` (fallback `1`);
- **Colocação**: quando `placementPending`, o centro é o centro do viewport;
  em ecrãs ≥ 640 px usa `x = (360 + width) / 2` (área do mapa à direita do painel de
  360 px) e `y = (100 + usableHeight) / 2`; abaixo de 640 px usa `x = width / 2`;
- **Render**: `L.imageOverlay(url, bounds, { opacity, interactive: false })` num pane
  próprio (`name="reference-image"`, `zIndex: 350`, `pointer-events: none`), com
  `className="ph-no-capture reference-image-layer"` e, no `add`,
  `data-clarity-mask="true"`, `data-html2canvas-ignore="true"` e `alt=""`
  (privacidade/export).

---

## 6. Proposta de replicação no `strava-art-generator`

O projeto já cobre roteamento por BRouter e lápis com simplificação em pixels. O que falta
em relação ao DrawMyLoop:

| Capacidade do DrawMyLoop                         | Estado no projeto         | Onde implementar                        |
| ------------------------------------------------ | ------------------------- | --------------------------------------- |
| Rota multi-ponto (25 pontos, 8 km/perna, cache)  | parcial (1 perna por GET) | `server/routes/route.js` + `lib/geo.js` |
| Snap de traço livre em lote com waypoints        | parcial                   | `server/routes/route.js` (modo batch)   |
| Simplificação por distância métrica + DP         | pixels                    | `public/js/core/geo.js`                 |
| Reconstrução de waypoints (DP 12 m + ângulo 55°) | ausente                   | `public/js/map/pencil.js`               |
| Formas geométricas normalizadas + projeção       | ausente                   | `public/js/map/shapes.js`               |
| Alças mover/redimensionar/rodar/escalar          | ausente                   | `public/js/map/shapes.js`               |
| Sobreposição de imagem (mover/redimensionar/α)   | ausente                   | `public/js/map/image-overlay.js`        |
| Biblioteca de formas (`/api/shapes`)             | ausente                   | `server/routes/shapes.js`               |

### 6.1 Backend — `server/lib/geo.js` (novo, puro e testável)

```js
'use strict';

const R = 6371000;
const METERS_PER_DEG_LAT = 111320;

const toRad = (deg) => (deg * Math.PI) / 180;

function haversine([lat1, lng1], [lat2, lng2]) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * R;
}

function totalLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversine(points[i - 1], points[i]);
  return total;
}

// distância perpendicular (metros) de p ao segmento a-b, projeção equiretangular local
function perpendicularDistance(p, a, b) {
  const latRef = toRad((a[0] + b[0]) / 2);
  const kx = METERS_PER_DEG_LAT * Math.cos(latRef);
  const px = (p[1] - a[1]) * kx;
  const py = (p[0] - a[0]) * METERS_PER_DEG_LAT;
  const bx = (b[1] - a[1]) * kx;
  const by = (b[0] - a[0]) * METERS_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

function douglasPeucker(points, toleranceMeters) {
  if (points.length < 3) return points;
  let index = -1;
  let max = 0;
  const first = points[0];
  const last = points.at(-1);
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > max) [max, index] = [d, i];
  }
  if (max <= toleranceMeters || index === -1) return [first, last];
  return [
    ...douglasPeucker(points.slice(0, index + 1), toleranceMeters).slice(0, -1),
    ...douglasPeucker(points.slice(index), toleranceMeters),
  ];
}
```

Demais funções a acrescentar no mesmo módulo:

- `resample(points, maxStepMeters)` — densifica;
- `simplifyTrace(points, tolerance?)` — equivalente ao `uS` (tolerância adaptativa
  `clamp(L/500, 5, 50)`, passo `clamp(L/15, 100, 500)`, re-simplificação a `1.5×` se > 100);
- `simplifyToCount(points, maxPoints)` — busca binária no epsilon (24 iterações);
- `projectShape(shape, center, size, rotationDeg, { scaleX, scaleY, aspectRatio })`;
- `sampleShapeWaypoints(points, count)` — amostragem equidistante por comprimento;
- `pointToSegmentDistance` (já acima) e `fidelityMetrics(route, shape)`.

### 6.2 Backend — `POST /api/route-points` (adaptador BRouter)

Contrato compatível com o cliente descrito em 2.1, mas implementado sobre o BRouter:

```js
router.post(
  '/route-points',
  asyncHandler(async (req, res) => {
    const { points, profile } = req.body ?? {};
    if (!validarPontos(points)) {
      return res.status(400).json({ erro: 'points deve ter 2 a 25 pares [lat, lng].' });
    }
    const perfil = profile === 'bike' ? 'fastbike' : 'hiking-beta';

    const legs = [];
    for (let i = 1; i < points.length; i += 1) {
      const [lat1, lng1] = points[i - 1];
      const [lat2, lng2] = points[i];
      if (haversine(points[i - 1], points[i]) > 8000) {
        return res.status(422).json({ erro: 'Perna superior a 8000 m.' });
      }
      const geo = await brouter(lng1, lat1, lng2, lat2, perfil);
      legs.push(geo);
    }

    res.json({
      coordinates: legs.reduce(
        (acc, l) => acc.concat(acc.length > 0 ? l.coordinates.slice(1) : l.coordinates),
        [],
      ),
      distance_m: legs.reduce((s, l) => s + l.distance, 0),
      duration_s: legs.reduce((s, l) => s + l.duration, 0),
      snapped_waypoints: legs.map((l) => l.coordinates[0]).concat(legs.at(-1).coordinates.at(-1)),
    });
  }),
);
```

- cache por `${perfil}|${lat.toFixed(5)},${lng.toFixed(5)};...` (500 entradas, TTL 1 h);
- `AbortSignal.timeout(8000)` por perna, 25 s no total;
- erros 4xx do BRouter → 422; 5xx/timeout → 502 com `{ erro, upstream }`;
- o endpoint antigo `GET /api/rota` mantém-se para compatibilidade.

### 6.3 Backend — `POST /api/project-shape` (snap de forma e lápis)

Implementação possível sem o motor "C3" (que é proprietário):

```js
// forma: shape_points normalizados + center + size + rotation
// 1. projeta o polígono para [lat, lng] (6.1)
// 2. amostra N waypoints equidistantes (N ≈ perímetro / 150 m, limitado a 25 por lote)
// 3. roteia cada par de waypoints com o BRouter (em lotes de 25)
// 4. devolve coordinates concatenadas + métricas de fidelidade
```

- `shape_points` deve ter 3–400 pontos (rejeitar 422 se o perímetro for < 200 m);
- `center` chega em `[lng, lat]` (contrato do DrawMyLoop) e é convertido para `[lat, lng]`;
- `rotation_deg`, `scale_x`, `scale_y`, `alpha/beta/gamma` são aceites mas `alpha/beta/gamma`
  podem ser ignorados (são parâmetros do otimizador interno);
- `fidelity_avg_m` = média das distâncias ponto-a-polígono; `fidelity_max_m` = máximo;
- para lápis (`geo_points`): `simplifyTrace` → rotear segmento a segmento (snap),
  mantendo trechos sem estrada como segmentos diretos (`nonRoutedSegments`);
- limite de 500 pontos de entrada e 60 s de execução; abortar com 499 se o cliente fechar.

### 6.4 Frontend — novos módulos

```text
public/js/
  core/geo.js            (novo) haversine, DP métrico, simplifyTrace, projectShape
  map/shapes.js          (novo) overlay L.polygon + alças (mover/redimensionar/rodar/escalar)
  map/image-overlay.js   (novo) L.imageOverlay + bounds matemáticos + 4 cantos + opacidade
  map/pencil.js          (existente) trocar L.LineUtil.simplify (12 px) por DP métrico,
                         separar clique vs traço, throttle RAF e reconstrução de handles
  services/api.js        (existente) + rotearPontos(), projetarForma(), listarFormas()
```

`map/pencil.js` já existe e funciona com tolerância em píxeis
(`TOLERANCIA_SIMPLIFICACAO_PIXELS = 12`, `L.LineUtil.simplify`); a migração para
distância métrica é o que garante o mesmo resultado em qualquer zoom.

`core/geo.js` pode ser um módulo ES partilhado pelo browser e pelos testes Vitest
(o backend CommonJS importa a mesma matemática via `server/lib/geo.js`; evitar duplicar
fórmulas é preferível a micro-otimizar o bundle).

### 6.5 Frontend — alças e interação (resumo do que copiar)

- `L.divIcon` para centro, cantos, rotação e bordas; `map.dragging.disable()` durante arrasto;
- mover: offset `center - bboxCenter` preservado;
- redimensionar forma: `max(25, size * dist / dist0)`;
- rodar: `-(atan2(lng - cLng, lat - cLat) - ang0)` normalizado em `0..360`;
- escalar: por eixo, `max(0.1, scale * (bboxEdge / bboxEdge0))` (não é rácio de distância
  ao centro — é esticar a caixa);
- imagem: `max(10, min(20000, size * dist / dist0))`, bounds via `project/unproject` no zoom 20;
- throttle de `onMoveLive` a ~32 ms com `requestAnimationFrame`;
- `dragend` → `setTimeout(onTransformEnd, 50)` antes de re-rotear.

---

## 7. Limitações, riscos e decisões

1. **Licença/uso**: o código do DrawMyLoop é proprietário; este documento descreve
   comportamento observável (engenharia reversa para interoperabilidade). Não copiar a
   biblioteca de formas nem assets — usar formas próprias/OSM.
2. **Serviço `project-shape`**: o motor "C3" não é público. A replicação com BRouter +
   amostragem produz resultados inferiores em formas complexas (perde detalhe em ruas
   estreitas). Alternativas: OSRM `route` com `continue_straight`, GraphHopper ou
   Valhalla `map matching` (`/trace_route`), que faz snap de traço livre nativamente.
3. **OSRM público**: o servidor de demonstração tem rate limit e não deve ser usado em
   produção; o padrão correto é self-hosted + proxy (como o DrawMyLoop faz).
4. **GPS Art**: o resultado precisa de ser ciclável/caminhável e fechado; o "autofit"
   com score evita formas que exigem contramão, escadas ou passagens bloqueadas.
5. **Privacidade**: imagens de referência são enviadas para o servidor? No DrawMyLoop a
   imagem é carregada por URL e renderizada no cliente (`L.imageOverlay`), sem upload
   obrigatório; manter o mesmo modelo (data URL/blob local) reduz risco de LGPD.
6. **Precisão**: `111320` e `156543.03392` são aproximações; erro < 0.3% em latitudes
   médias, aceitável para planeamento (o GPX final é recalculado pelo dispositivo).

## 8. Anexo — Contratos completos

### 8.1 Tabela de endpoints

| Método | Caminho                                   | Entrada                                                                    | Saída                                                                     | Timeout   |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------- |
| POST   | `/api/route-points`                       | `{ points: [[lat,lng]], profile: bike\|foot }`                             | `{ coordinates, distance_m, duration_s, snapped_waypoints, legs? }`       | 8 s/perna |
| GET    | `/api/osrm-public/route/v1/{profile}/...` | perfis `bicycle`\|`foot`, `lng,lat;lng,lat`                                | `{ coordinates, distance, duration, snappedWaypoints }`                   | 7 s       |
| POST   | `/api/project-shape`                      | `{ shape_points\|geo_points, center[lng,lat], ... }`                       | `{ coordinates, fidelity_avg_m, fidelity_max_m, comparison, projection }` | 60 s      |
| GET    | `/api/shapes`                             | `Authorization: Bearer`                                                    | `{ shapes: Shape[] }`                                                     | —         |
| POST   | `/api/shapes`                             | `{ name, category, type, points, strokes?, aspectRatio, closed, tension }` | `{ shape }`                                                               | —         |
| DELETE | `/api/shapes/:id`                         | `Authorization: Bearer`                                                    | `204`                                                                     | —         |

### 8.2 Feature flags observadas

Semântica: quase todas são **desligadas com `"0"`** (`"0" !== env.X`); as exceções estão
marcadas.

| Flag                                             | Efeito                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `NEXT_PUBLIC_OWN_POINT_ROUTING`                  | `"0"` desliga `/api/route-points` (só OSRM)                      |
| `NEXT_PUBLIC_BROWSER_POINT_ROUTING`              | roteamento de pontos no browser via Worker + WASM                |
| `NEXT_PUBLIC_BROWSER_SHAPE_PREVIEW`              | pré-visualização de forma no browser (WASM)                      |
| `NEXT_PUBLIC_LIVE_SHAPE_PREVIEW`                 | recalcula a forma em tempo real enquanto se move/roda            |
| `NEXT_PUBLIC_PLACEMENT_ROUTE_PREVIEW`            | rota de pré-visualização durante a colocação                     |
| `NEXT_PUBLIC_STUDIO_LIVE_PANEL`                  | painel "live" do estúdio (depende da flag anterior)              |
| `NEXT_PUBLIC_SHAPE_PROJECTION_LAB`               | `"1"` liga o laboratório de projeção (**default desligado**)     |
| `NEXT_PUBLIC_AUTOFIT_SEARCH_AREA_ENABLED`        | área de busca do autofit (`search_area_width_m`)                 |
| `NEXT_PUBLIC_AUTOFIT_COMPARISON_MODE`            | modo do comparador `route_comparison_v1`                         |
| `NEXT_PUBLIC_AUTOFIT_COMPARISON_ROLLOUT_PERCENT` | rollout percentual do comparador                                 |
| `NEXT_PUBLIC_AUTOFIT_ADVANCED_COMPARISON_MODE`   | comparador avançado                                              |
| `NEXT_PUBLIC_POSTHOG_MAP_CANVAS_REPLAY`          | replay do canvas no PostHog                                      |
| `NEXT_PUBLIC_CLARITY_PROJECT_ID`                 | Microsoft Clarity (nesse caso a imagem leva `data-clarity-mask`) |

### 8.3 Mapa de evidências (chunk → símbolo)

| Chunk  | Símbolos principais                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| `5586` | `eU` (route-points), `eD`/`eF` (breaker), `eK` (legs), `fu`/`fd`/`fp`/`fc` (lápis), `uS`, `r9`, `ek`, `tv` |
| `5814` | `ek` (captura de ponteiro), `N` (alças de forma), `b` (overlay de imagem), `q` (modo pan)                  |
| `3485` | `M` (payload de forma), `C` (payload de lápis), `h_` (projeção), `o` (Catmull-Rom), `co` (fecho)           |
| `5608` | (módulo `65608`) `L1` (tamanho mínimo 25 m), `JJ` (categorias), `e4` (letras), `tv`                        |
| `2272` | estado inicial (`draft.libraryShape`, `imageOverlay`)                                                      |

### 8.4 Correspondência `profile`

O DrawMyLoop só conhece `bike` e `foot`; a coluna BRouter é a tradução necessária no
`strava-art-generator` (allowlist em `server/lib/validators.js`).

| DrawMyLoop | OSRM      | BRouter (projeto)             |
| ---------- | --------- | ----------------------------- |
| `bike`     | `bicycle` | `fastbike` (ou `trekking`)    |
| `foot`     | `foot`    | `hiking-beta` (ou `shortest`) |

`shortest` existe apenas no BRouter do projeto e não tem equivalente no contrato do
DrawMyLoop — se for exposto, mapear para `bike` no cliente.

### 8.5 Checklist de replicação

`[x]` = comportamento já especificado neste documento (pronto a implementar);
`[ ]` = em falta.

- [x] Rota multi-ponto com cache e breaker
- [x] Snap de traço livre com fallback para linha reta
- [x] Simplificação métrica + reconstrução de handles
- [x] Formas normalizadas com projeção, rotação e escala
- [x] Sobreposição de imagem com bounds matemáticos
- [ ] Biblioteca de formas persistida (endpoints em 6.2/8.1)
- [ ] Score de fidelidade (`route_comparison_v1`) — só métricas básicas em 6.1

---

_Documento gerado por engenharia reversa estática do bundle de produção
(`drawmyloop_chunks.js`) em 29/10/2026. Todas as fórmulas foram verificadas
numericamente em Node antes de serem documentadas._
