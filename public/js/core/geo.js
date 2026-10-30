/**
 * @file core/geo.js
 * @description Núcleo geodésico puro do frontend (ESM, sem Leaflet para que
 * possa ser testado em Node/jsdom). Espelha `server/lib/geo.js`; a paridade
 * numérica é verificada em `tests/unit/geo-parity.test.js`.
 *
 * Pontos no formato `[lat, lng]`, distâncias em metros. Inclui a reconstrução
 * de alças do lápis (`reconstruirAlcas`, equivalente ao `ek` do DrawMyLoop).
 */

const RAIO_TERRA_METROS = 6_371_000;
const METROS_POR_GRAU_LAT = 111_320;
const METROS_POR_PIXEL_ZOOM_0 = 156_543.03392;
const ZOOM_BOUNDS_PADRAO = 20;
const TAMANHO_TILE_PX = 256;

const TOLERANCIA_MINIMA_METROS = 5;
const TOLERANCIA_MAXIMA_METROS = 50;
const PASSO_MINIMO_METROS = 100;
const PASSO_MAXIMO_METROS = 500;

const MAX_ALCAS_PADRAO = 120;
const ESPACAMENTO_MINIMO_ALCAS_METROS = 8;
const TOLERANCIA_ALCAS_METROS = 12;
const ANGULO_VIRAGEM_MINIMO_GRAUS = 55;
const SEGMENTO_MINIMO_ANGULO_METROS = 5;

/** @param {number} graus */
export function paraRadiano(graus) {
  return (graus * Math.PI) / 180;
}

/** @param {number} radianos */
export function paraGraus(radianos) {
  return (radianos * 180) / Math.PI;
}

/**
 * @param {unknown} ponto
 * @returns {boolean}
 */
export function pontoValido(ponto) {
  if (!Array.isArray(ponto) || ponto.length < 2) return false;
  const lat = Number(ponto[0]);
  const lng = Number(ponto[1]);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Distância de Haversine em metros.
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @returns {number}
 */
export function haversine(a, b) {
  if (!pontoValido(a) || !pontoValido(b)) return 0;

  const lat1 = paraRadiano(Number(a[0]));
  const lat2 = paraRadiano(Number(b[0]));
  const deltaLat = lat2 - lat1;
  const deltaLng = paraRadiano(Number(b[1]) - Number(a[1]));

  const h =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return 2 * RAIO_TERRA_METROS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * @param {Array<[number, number]>} pontos
 * @returns {number}
 */
export function totalLength(pontos) {
  if (!Array.isArray(pontos)) return 0;

  let total = 0;
  for (let i = 1; i < pontos.length; i += 1) {
    total += haversine(pontos[i - 1], pontos[i]);
  }
  return total;
}

/**
 * Distância perpendicular (metros) de `p` ao segmento `a→b`, com projeção
 * equiretangular local (`111320 * cos(lat)`).
 * @param {[number, number]} p
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @returns {number}
 */
export function perpendicularDistance(p, a, b) {
  if (!pontoValido(p) || !pontoValido(a) || !pontoValido(b)) return 0;

  const latRef = paraRadiano((Number(a[0]) + Number(b[0])) / 2);
  const kx = METROS_POR_GRAU_LAT * Math.cos(latRef);

  const px = (Number(p[1]) - Number(a[1])) * kx;
  const py = (Number(p[0]) - Number(a[0])) * METROS_POR_GRAU_LAT;
  const bx = (Number(b[1]) - Number(a[1])) * kx;
  const by = (Number(b[0]) - Number(a[0])) * METROS_POR_GRAU_LAT;

  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);

  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

/**
 * Douglas-Peucker com tolerância métrica.
 * @param {Array<[number, number]>} pontos
 * @param {number} toleranciaMetros
 * @returns {Array<[number, number]>}
 */
export function douglasPeucker(pontos, toleranciaMetros) {
  if (!Array.isArray(pontos) || pontos.length < 3) return pontos ? [...pontos] : [];
  if (!Number.isFinite(toleranciaMetros) || toleranciaMetros <= 0) return [...pontos];

  let indice = -1;
  let maximo = 0;
  const primeiro = pontos[0];
  const ultimo = pontos[pontos.length - 1];

  for (let i = 1; i < pontos.length - 1; i += 1) {
    const distancia = perpendicularDistance(pontos[i], primeiro, ultimo);
    if (distancia > maximo) {
      maximo = distancia;
      indice = i;
    }
  }

  if (indice === -1 || maximo <= toleranciaMetros) return [primeiro, ultimo];

  const esquerda = douglasPeucker(pontos.slice(0, indice + 1), toleranciaMetros);
  const direita = douglasPeucker(pontos.slice(indice), toleranciaMetros);
  return [...esquerda.slice(0, -1), ...direita];
}

/**
 * Densifica a linha com passo máximo entre vértices.
 * @param {Array<[number, number]>} pontos
 * @param {number} passoMaximoMetros
 * @returns {Array<[number, number]>}
 */
export function resample(pontos, passoMaximoMetros) {
  if (!Array.isArray(pontos) || pontos.length < 2) return pontos ? [...pontos] : [];
  if (!Number.isFinite(passoMaximoMetros) || passoMaximoMetros <= 0) return [...pontos];

  const saida = [[Number(pontos[0][0]), Number(pontos[0][1])]];

  for (let i = 1; i < pontos.length; i += 1) {
    const anterior = pontos[i - 1];
    const atual = pontos[i];
    const distancia = haversine(anterior, atual);

    if (distancia > passoMaximoMetros) {
      const partes = Math.ceil(distancia / passoMaximoMetros);
      for (let j = 1; j < partes; j += 1) {
        const t = j / partes;
        saida.push([
          Number(anterior[0]) + (Number(atual[0]) - Number(anterior[0])) * t,
          Number(anterior[1]) + (Number(atual[1]) - Number(anterior[1])) * t,
        ]);
      }
    }

    saida.push([Number(atual[0]), Number(atual[1])]);
  }

  return saida;
}

/**
 * Equivalente ao `uS` do DrawMyLoop.
 * @param {Array<[number, number]>} pontos
 * @param {number} [toleranciaMetros]
 * @returns {Array<[number, number]>}
 */
export function simplifyTrace(pontos, toleranciaMetros) {
  if (!Array.isArray(pontos) || pontos.length < 3) return pontos ? [...pontos] : [];

  const comprimento = totalLength(pontos);
  const tolerancia =
    Number.isFinite(toleranciaMetros) && toleranciaMetros > 0
      ? toleranciaMetros
      : Math.max(TOLERANCIA_MINIMA_METROS, Math.min(TOLERANCIA_MAXIMA_METROS, comprimento / 500));
  const passo = Math.max(PASSO_MINIMO_METROS, Math.min(PASSO_MAXIMO_METROS, comprimento / 15));

  let saida = resample(douglasPeucker(pontos, tolerancia), passo);

  if (saida.length < 3 && pontos.length >= 3) {
    return [pontos[0], pontos[Math.floor(pontos.length / 2)], pontos[pontos.length - 1]];
  }
  if (saida.length > 100) {
    saida = douglasPeucker(saida, tolerancia * 1.5);
  }

  return saida;
}

/**
 * Reduz para no máximo `maxPontos` (busca binária na tolerância do DP).
 * @param {Array<[number, number]>} pontos
 * @param {number} maxPontos
 * @returns {Array<[number, number]>}
 */
export function simplifyToCount(pontos, maxPontos) {
  if (!Array.isArray(pontos)) return [];
  const limite = Math.trunc(maxPontos);
  if (pontos.length <= limite || limite <= 0) return [...pontos];
  if (limite === 1) return [pontos[0]];
  if (limite === 2) return [pontos[0], pontos[pontos.length - 1]];

  let baixo = 0;
  let alto = Math.max(1, totalLength(pontos));
  let melhor = douglasPeucker(pontos, alto);

  for (let i = 0; i < 24 && alto - baixo > 1e-6; i += 1) {
    const meio = (baixo + alto) / 2;
    const atual = douglasPeucker(pontos, meio);
    if (atual.length > limite) {
      baixo = meio;
    } else {
      melhor = atual;
      alto = meio;
    }
  }

  if (melhor.length > limite) {
    const indices = new Set([0, pontos.length - 1]);
    for (let i = 1; i < limite - 1; i += 1) {
      indices.add(Math.round((i * (pontos.length - 1)) / (limite - 1)));
    }
    melhor = [...indices].sort((a, b) => a - b).map((indice) => pontos[indice]);
  }

  return melhor;
}

/**
 * Catmull-Rom tensionada (t = 0 → p1, t = 1 → p2).
 * @param {[number, number]} p0
 * @param {[number, number]} p1
 * @param {[number, number]} p2
 * @param {[number, number]} p3
 * @param {number} t
 * @param {number} [tensao=0.5]
 * @returns {[number, number]}
 */
export function catmullRom(p0, p1, p2, p3, t, tensao = 0.5) {
  const l = (1 - tensao) / 2;
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

/**
 * Suaviza pontos com Catmull-Rom tensionada.
 * @param {Array<[number, number]>} pontos
 * @param {number} [subdivisoes=6]
 * @param {{tensao?:number, fechada?:boolean}} [opcoes]
 * @returns {Array<[number, number]>}
 */
export function suavizarCurva(pontos, subdivisoes = 6, { tensao = 0.5, fechada = false } = {}) {
  if (!Array.isArray(pontos) || pontos.length < 3) return pontos ? [...pontos] : [];

  const passos = Math.max(1, Math.trunc(subdivisoes));
  const lista = pontos.map((ponto) => [Number(ponto[0]), Number(ponto[1])]);
  const n = lista.length;
  const ehFechada =
    Boolean(fechada) ||
    (Math.abs(lista[0][0] - lista[n - 1][0]) < 0.01 &&
      Math.abs(lista[0][1] - lista[n - 1][1]) < 0.01);

  const base = ehFechada ? lista.slice(0, -1) : lista;
  const total = base.length;
  if (total < 3) return [...lista];

  const saida = [];
  const segmentos = ehFechada ? total : total - 1;

  for (let i = 0; i < segmentos; i += 1) {
    const p0 = base[(i - 1 + total) % total];
    const p1 = base[i % total];
    const p2 = base[(i + 1) % total];
    const p3 = base[(i + 2) % total];

    for (let passo = 0; passo < passos; passo += 1) {
      saida.push(catmullRom(p0, p1, p2, p3, passo / passos, tensao));
    }
  }

  saida.push(ehFechada ? [base[0][0], base[0][1]] : [base[total - 1][0], base[total - 1][1]]);
  return saida;
}

/**
 * Extrai os pontos normalizados de uma forma.
 * @param {{points?:Array<[number, number]>}|Array<[number, number]>} forma
 * @returns {Array<[number, number]>}
 */
function obterPontosForma(forma) {
  if (Array.isArray(forma)) return forma;
  if (forma && Array.isArray(forma.points)) return forma.points;
  return [];
}

/**
 * Projeta uma forma normalizada `[0, 1]` para `[lat, lng]` com rotação
 * trigonométrica, escala por eixo e fator de aspeto.
 * @param {{points?:Array<[number, number]>, type?:string, closed?:boolean, tension?:number, aspectRatio?:number}|Array<[number, number]>} forma
 * @param {[number, number]} centro - `[lat, lng]`.
 * @param {number} tamanhoMetros - largura em metros (eixo X).
 * @param {number} [rotacaoGraus=0]
 * @param {{scaleX?:number, scaleY?:number, aspectRatio?:number, smooth?:boolean, subdivisions?:number}} [opcoes]
 * @returns {Array<[number, number]>}
 */
export function projectShape(forma, centro, tamanhoMetros, rotacaoGraus = 0, opcoes = {}) {
  const { scaleX = 1, scaleY = 1, aspectRatio, smooth = true, subdivisions } = opcoes;

  if (!pontoValido(centro)) return [];

  const pontosBase = obterPontosForma(forma);
  if (pontosBase.length === 0) return [];

  const tipo = Array.isArray(forma) ? 'polyline' : (forma?.type ?? 'polyline');
  const fechada = Array.isArray(forma) ? false : Boolean(forma?.closed ?? tipo === 'polygon');
  const tensao = Array.isArray(forma) ? 0.5 : Number(forma?.tension ?? 0.5);
  const aspecto = Number(aspectRatio ?? (Array.isArray(forma) ? 1 : forma?.aspectRatio) ?? 1) || 1;
  const subdivisoes = Number.isFinite(subdivisions)
    ? Number(subdivisions)
    : tipo === 'curve'
      ? 10
      : 6;

  const pontos =
    tipo === 'curve' && smooth
      ? suavizarCurva(pontosBase, subdivisoes, { tensao, fechada })
      : pontosBase;

  const rad = paraRadiano(Number(rotacaoGraus) || 0);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const metrosPorGrauLng = Math.max(
    1e-6,
    METROS_POR_GRAU_LAT * Math.cos(paraRadiano(Number(centro[0]))),
  );
  const largura = Number(tamanhoMetros);
  if (!Number.isFinite(largura) || largura <= 0) return [];

  return pontos.map(([x, y]) => {
    const leste = (Number(x) - 0.5) * largura * scaleX * aspecto;
    const norte = (0.5 - Number(y)) * largura * scaleY;
    const lesteRodado = leste * cos - norte * sin;
    const norteRodado = leste * sin + norte * cos;

    return [
      Number(centro[0]) + norteRodado / METROS_POR_GRAU_LAT,
      Number(centro[1]) + lesteRodado / metrosPorGrauLng,
    ];
  });
}

/**
 * Projeta a forma e os seus `strokes` (letras/ícones compostos).
 * @param {Object} forma
 * @param {[number, number]} centro
 * @param {number} tamanhoMetros
 * @param {number} [rotacaoGraus=0]
 * @param {Object} [opcoes]
 * @returns {Array<Array<[number, number]>>}
 */
export function projectShapeParts(forma, centro, tamanhoMetros, rotacaoGraus = 0, opcoes = {}) {
  const partes = [];
  const principal = projectShape(forma, centro, tamanhoMetros, rotacaoGraus, opcoes);
  if (principal.length > 0) partes.push(principal);

  if (forma && Array.isArray(forma.strokes)) {
    for (const traco of forma.strokes) {
      const projetado = projectShape(
        { points: traco, type: 'polyline', closed: false },
        centro,
        tamanhoMetros,
        rotacaoGraus,
        { ...opcoes, smooth: false },
      );
      if (projetado.length > 0) partes.push(projetado);
    }
  }

  return partes;
}

/**
 * Amostra `quantidade` pontos equidistantes por comprimento geodésico.
 * @param {Array<[number, number]>} pontos
 * @param {number} quantidade
 * @returns {Array<[number, number]>}
 */
export function sampleShapeWaypoints(pontos, quantidade) {
  if (!Array.isArray(pontos) || pontos.length === 0) return [];
  const total = Math.trunc(quantidade);
  if (total <= 1) return [pontos[0]];
  if (pontos.length === 1) return [pontos[0]];

  const comprimento = totalLength(pontos);
  if (comprimento <= 0) return [pontos[0]];

  const passo = comprimento / (total - 1);
  const saida = [[pontos[0][0], pontos[0][1]]];
  let alvo = passo;
  let acumulado = 0;

  for (let i = 1; i < pontos.length && saida.length < total; i += 1) {
    const anterior = pontos[i - 1];
    const atual = pontos[i];
    const distancia = haversine(anterior, atual);
    if (distancia <= 0) continue;

    while (acumulado + distancia >= alvo && saida.length < total - 1) {
      const t = (alvo - acumulado) / distancia;
      saida.push([
        Number(anterior[0]) + (Number(atual[0]) - Number(anterior[0])) * t,
        Number(anterior[1]) + (Number(atual[1]) - Number(anterior[1])) * t,
      ]);
      alvo += passo;
    }

    acumulado += distancia;
  }

  const ultimo = pontos[pontos.length - 1];
  if (saida.length < total) saida.push([ultimo[0], ultimo[1]]);
  return saida.slice(0, total);
}

/**
 * Bounding box geográfico.
 * @param {Array<[number, number]>} pontos
 * @returns {{minLat:number, maxLat:number, minLng:number, maxLng:number, centro:[number, number], largura:number, altura:number}}
 */
export function calcularBbox(pontos) {
  const validos = (Array.isArray(pontos) ? pontos : []).filter(pontoValido);
  if (validos.length === 0) {
    return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0, centro: [0, 0], largura: 0, altura: 0 };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const ponto of validos) {
    const lat = Number(ponto[0]);
    const lng = Number(ponto[1]);
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  return {
    minLat,
    maxLat,
    minLng,
    maxLng,
    centro: [(minLat + maxLat) / 2, (minLng + maxLng) / 2],
    largura: maxLng - minLng,
    altura: maxLat - minLat,
  };
}

/**
 * Normaliza um ângulo para `[0, 360)`.
 * @param {number} graus
 * @returns {number}
 */
export function normalizarRotacao(graus) {
  const valor = Number(graus);
  if (!Number.isFinite(valor)) return 0;
  const modulo = valor % 360;
  return modulo < 0 ? modulo + 360 : modulo;
}

/**
 * Metros por pixel na latitude dada (tiles de 256 px).
 * @param {number} lat
 * @param {number} [zoom=20]
 * @returns {number}
 */
export function metrosPorPixel(lat, zoom = ZOOM_BOUNDS_PADRAO) {
  return (METROS_POR_PIXEL_ZOOM_0 * Math.cos(paraRadiano(Number(lat) || 0))) / Math.pow(2, zoom);
}

/**
 * Bounds geográficos de uma imagem projetada no zoom 20.
 * @param {[number, number]} centro - `[lat, lng]`.
 * @param {number} tamanhoMetros
 * @param {number} [aspectRatio=1]
 * @param {number} [zoom=20]
 * @returns {{south:number, west:number, north:number, east:number}}
 */
export function calcularBoundsImagem(
  centro,
  tamanhoMetros,
  aspectRatio = 1,
  zoom = ZOOM_BOUNDS_PADRAO,
) {
  const lat = Number(centro?.[0]);
  const lng = Number(centro?.[1]);
  const largura = Number(tamanhoMetros);
  const aspecto = Number(aspectRatio);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(largura) || largura <= 0) {
    return { south: lat || 0, west: lng || 0, north: lat || 0, east: lng || 0 };
  }

  const razao = Number.isFinite(aspecto) && aspecto > 0 ? aspecto : 1;
  const tamanhoMundo = TAMANHO_TILE_PX * Math.pow(2, zoom);
  const mpp = metrosPorPixel(lat, zoom);

  const larguraPx = largura / mpp;
  const alturaPx = larguraPx / razao;

  const x = ((lng + 180) / 360) * tamanhoMundo;
  const rad = paraRadiano(lat);
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * tamanhoMundo;

  const paraLat = (valorY) => {
    const n = Math.PI - (2 * Math.PI * valorY) / tamanhoMundo;
    return paraGraus(Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
  };
  const paraLng = (valorX) => (valorX / tamanhoMundo) * 360 - 180;

  return {
    south: paraLat(y + alturaPx / 2),
    west: paraLng(x - larguraPx / 2),
    north: paraLat(y - alturaPx / 2),
    east: paraLng(x + larguraPx / 2),
  };
}

/**
 * Métricas de fidelidade rota ↔ forma (média e máximo ponto-a-polígono).
 * @param {Array<[number, number]>} rota
 * @param {Array<[number, number]>} forma
 * @returns {{mediaM:number, maximoM:number, amostras:number}}
 */
export function fidelityMetrics(rota, forma) {
  if (!Array.isArray(rota) || rota.length === 0 || !Array.isArray(forma) || forma.length < 2) {
    return { mediaM: 0, maximoM: 0, amostras: 0 };
  }

  let soma = 0;
  let maximo = 0;

  for (const ponto of rota) {
    let minimo = Infinity;
    for (let i = 1; i < forma.length; i += 1) {
      const distancia = perpendicularDistance(ponto, forma[i - 1], forma[i]);
      if (distancia < minimo) minimo = distancia;
    }
    if (!Number.isFinite(minimo)) minimo = 0;
    soma += minimo;
    if (minimo > maximo) maximo = minimo;
  }

  return { mediaM: soma / rota.length, maximoM: maximo, amostras: rota.length };
}

/**
 * Índices mantidos pelo Douglas-Peucker (iterativo, sem recursão profunda).
 * @param {Array<[number, number]>} pontos
 * @param {number} toleranciaMetros
 * @returns {number[]}
 */
function indicesDouglasPeucker(pontos, toleranciaMetros) {
  const n = pontos.length;
  const manter = new Array(n).fill(false);
  manter[0] = true;
  manter[n - 1] = true;

  const pilha = [[0, n - 1]];

  while (pilha.length > 0) {
    const [inicio, fim] = pilha.pop();
    let maximo = 0;
    let indice = -1;

    for (let i = inicio + 1; i < fim; i += 1) {
      const distancia = perpendicularDistance(pontos[i], pontos[inicio], pontos[fim]);
      if (distancia > maximo) {
        maximo = distancia;
        indice = i;
      }
    }

    if (indice !== -1 && maximo > toleranciaMetros) {
      manter[indice] = true;
      pilha.push([inicio, indice], [indice, fim]);
    }
  }

  const indices = [];
  for (let i = 0; i < n; i += 1) {
    if (manter[i]) indices.push(i);
  }
  return indices;
}

/**
 * Ângulo de viragem (graus) em `b`, no plano local equiretangular.
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @param {[number, number]} c
 * @returns {number}
 */
function anguloViragem(a, b, c) {
  const latRef = paraRadiano(Number(b[0]));
  const kx = METROS_POR_GRAU_LAT * Math.cos(latRef);

  const v1x = (Number(a[1]) - Number(b[1])) * kx;
  const v1y = (Number(a[0]) - Number(b[0])) * METROS_POR_GRAU_LAT;
  const v2x = (Number(c[1]) - Number(b[1])) * kx;
  const v2y = (Number(c[0]) - Number(b[0])) * METROS_POR_GRAU_LAT;

  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (n1 < SEGMENTO_MINIMO_ANGULO_METROS || n2 < SEGMENTO_MINIMO_ANGULO_METROS) return 0;

  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return paraGraus(Math.acos(cos));
}

/**
 * Remove pontos consecutivos praticamente coincidentes.
 * @param {Array<[number, number]>} pontos
 * @param {number} [toleranciaMetros=0.5]
 * @returns {Array<[number, number]>}
 */
export function removerDuplicados(pontos, toleranciaMetros = 0.5) {
  return deduplicarComMapa(pontos, toleranciaMetros).pontos;
}

/**
 * Remove duplicados consecutivos preservando o índice original de cada ponto
 * (necessário para os `bindings` das alças).
 * @param {Array<[number, number]>} pontos
 * @param {number} [toleranciaMetros=0.5]
 * @returns {{pontos:Array<[number, number]>, origens:number[]}}
 */
function deduplicarComMapa(pontos, toleranciaMetros = 0.5) {
  if (!Array.isArray(pontos)) return { pontos: [], origens: [] };

  const saida = [];
  const origens = [];

  pontos.forEach((ponto, indice) => {
    if (!pontoValido(ponto)) return;
    if (saida.length === 0 || haversine(saida[saida.length - 1], ponto) >= toleranciaMetros) {
      saida.push([Number(ponto[0]), Number(ponto[1])]);
      origens.push(indice);
    }
  });

  return { pontos: saida, origens };
}

/**
 * Reconstrói alças editáveis a partir de um traço livre — equivalente ao `ek`
 * do DrawMyLoop:
 * 1. remove duplicados consecutivos;
 * 2. Douglas-Peucker com 12 m;
 * 3. acrescenta vértices com viragem ≥ 55° (ignorando segmentos < 5 m);
 * 4. filtra por espaçamento mínimo de 8 m (mantém o primeiro de cada grupo);
 * 5. decima uniformemente acima de 120 alças.
 *
 * @param {Array<[number, number]>} pontos
 * @param {{maxHandles?:number, minSpacingMeters?:number, toleranceMeters?:number}} [opcoes]
 * @returns {{handles:Array<[number, number]>, bindings:number[]}}
 */
export function reconstruirAlcas(
  pontos,
  {
    maxHandles = MAX_ALCAS_PADRAO,
    minSpacingMeters = ESPACAMENTO_MINIMO_ALCAS_METROS,
    toleranceMeters = TOLERANCIA_ALCAS_METROS,
  } = {},
) {
  const { pontos: limpos, origens } = deduplicarComMapa(pontos);
  const n = limpos.length;

  if (n < 3) {
    return { handles: limpos.map((ponto) => [...ponto]), bindings: [...origens] };
  }

  const limite = Math.max(2, Math.trunc(maxHandles));
  const espacamento = Math.max(0, Number(minSpacingMeters) || 0);
  const tolerancia = Math.max(0, Number(toleranceMeters) || 0);

  const candidatos = new Set(indicesDouglasPeucker(limpos, tolerancia));
  candidatos.add(0);
  candidatos.add(n - 1);

  for (let i = 1; i < n - 1; i += 1) {
    if (anguloViragem(limpos[i - 1], limpos[i], limpos[i + 1]) >= ANGULO_VIRAGEM_MINIMO_GRAUS) {
      candidatos.add(i);
    }
  }

  const ordenados = [...candidatos].sort((a, b) => a - b);
  const filtrados = [];

  for (const indice of ordenados) {
    if (filtrados.length === 0) {
      filtrados.push(indice);
      continue;
    }
    const anterior = filtrados[filtrados.length - 1];
    if (haversine(limpos[anterior], limpos[indice]) >= espacamento) filtrados.push(indice);
  }

  const ultimo = n - 1;
  if (filtrados[filtrados.length - 1] !== ultimo) {
    if (
      filtrados.length >= 2 &&
      haversine(limpos[filtrados[filtrados.length - 2]], limpos[ultimo]) < espacamento
    ) {
      filtrados.pop();
    }
    filtrados.push(ultimo);
  }

  let finais = filtrados;
  if (finais.length > limite) {
    const decimados = [];
    for (let i = 0; i < limite; i += 1) {
      decimados.push(finais[Math.round((i * (finais.length - 1)) / (limite - 1))]);
    }
    finais = [...new Set(decimados)].sort((a, b) => a - b);
  }

  return {
    handles: finais.map((indice) => [...limpos[indice]]),
    bindings: finais.map((indice) => origens[indice] ?? indice),
  };
}
