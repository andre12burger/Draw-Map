/**
 * @file map/shapes.js
 * @description Motor de formas geométricas normalizadas (`[0, 1]`) no Leaflet,
 * com alças de transformação (`L.divIcon`): mover, redimensionar (cantos),
 * rodar (alça superior) e escalar por eixo (bordas).
 *
 * A forma guarda apenas parâmetros de projeção (`center`, `size`, `rotation`,
 * `scaleX`, `scaleY`); os pontos normalizados nunca são mutados, tornando a
 * transformação reversível e barata. Referência: relatório §4.
 *
 * Limites: `SHAPE_MIN_SIZE_M = 25` e `ESCALA_MINIMA = 0.1`.
 */

import { calcularBbox, normalizarRotacao, projectShapeParts } from '../core/geo.js';
import { getMap } from './map.js';

export const SHAPE_MIN_SIZE_M = 25;
export const SHAPE_DEFAULT_SIZE_M = 2000;
export const ESCALA_MINIMA = 0.1;

const INTERVALO_ATUALIZACAO_MS = 32;
const ATRASO_FIM_TRANSFORMACAO_MS = 50;

/**
 * Gera uma estrela normalizada em `[0, 1]`.
 * @param {number} [pontas=5]
 * @param {number} [raioInterno=0.4]
 * @returns {{id:string, name:string, type:string, closed:boolean, tension:number, aspectRatio:number, points:Array<[number, number]>}}
 */
export function criarEstrela(pontas = 5, raioInterno = 0.4) {
  const total = Math.max(3, Math.trunc(pontas)) * 2;
  const pontos = [];

  for (let i = 0; i < total; i += 1) {
    const raio = i % 2 === 0 ? 0.5 : 0.5 * raioInterno;
    // começa no topo (norte) e gira no sentido horário em coordenadas SVG
    const angulo = -Math.PI / 2 + (i * Math.PI) / (total / 2);
    pontos.push([0.5 + Math.cos(angulo) * raio, 0.5 + Math.sin(angulo) * raio]);
  }

  pontos.push([...pontos[0]]);

  return {
    id: 'estrela',
    name: 'Estrela',
    type: 'polygon',
    closed: true,
    tension: 0.5,
    aspectRatio: 1,
    points: pontos,
  };
}

/**
 * Gera um polígono regular normalizado em `[0, 1]`.
 * @param {number} [lados=6]
 * @returns {Object}
 */
export function criarPoligonoRegular(lados = 6) {
  const total = Math.max(3, Math.trunc(lados));
  const pontos = [];

  for (let i = 0; i < total; i += 1) {
    const angulo = -Math.PI / 2 + (i * 2 * Math.PI) / total;
    pontos.push([0.5 + Math.cos(angulo) * 0.5, 0.5 + Math.sin(angulo) * 0.5]);
  }
  pontos.push([...pontos[0]]);

  return {
    id: 'poligono',
    name: 'Polígono',
    type: 'polygon',
    closed: true,
    tension: 0.5,
    aspectRatio: 1,
    points: pontos,
  };
}

/** Formas disponíveis sem backend. */
export const FORMAS_PADRAO = Object.freeze({
  estrela: criarEstrela(5, 0.4),
  hexagono: criarPoligonoRegular(6),
  triangulo: criarPoligonoRegular(3),
});

/**
 * Distância ao centro projetada em pontos de camada (`latLngToLayerPoint`),
 * constante em píxeis e independente do zoom.
 * @param {{lat:number,lng:number}} a
 * @param {{lat:number,lng:number}} b
 * @returns {number}
 */
export function distanciaEmPontos(a, b) {
  const mapa = getMap();
  return mapa
    .latLngToLayerPoint([a.lat, a.lng])
    .distanceTo(mapa.latLngToLayerPoint([b.lat, b.lng]));
}

/**
 * Ângulo (graus) do vetor centro → ponto, com eixo Y já invertido em relação
 * ao ecrã (`atan2(dLng, dLat)`).
 * @param {{lat:number,lng:number}} centro
 * @param {{lat:number,lng:number}} ponto
 * @returns {number}
 */
export function anguloDoCentro(centro, ponto) {
  return (180 / Math.PI) * Math.atan2(ponto.lng - centro.lng, ponto.lat - centro.lat);
}

/**
 * Escala uniforme de um canto, com distância mínima (`SHAPE_MIN_SIZE_M`).
 * @param {number} tamanhoInicial
 * @param {number} distanciaInicial
 * @param {number} distanciaAtual
 * @param {number} [minimo=SHAPE_MIN_SIZE_M]
 * @returns {number}
 */
export function tamanhoPorDistancia(
  tamanhoInicial,
  distanciaInicial,
  distanciaAtual,
  minimo = SHAPE_MIN_SIZE_M,
) {
  if (!Number.isFinite(distanciaInicial) || distanciaInicial <= 0) return tamanhoInicial;
  return Math.max(minimo, tamanhoInicial * (distanciaAtual / distanciaInicial));
}

/**
 * Escala não-uniforme de uma borda a partir do rácio da bounding box inicial.
 * @param {{eixo:'x'|'y', borda:'left'|'right'|'top'|'bottom', bboxInicial:Object, ponto:{lat:number,lng:number}, escalaInicial:number, minimo?:number}} opcoes
 * @returns {number}
 */
export function escalaPorBorda({
  eixo,
  borda,
  bboxInicial,
  ponto,
  escalaInicial,
  minimo = ESCALA_MINIMA,
}) {
  const horizontal = eixo === 'x';
  const dimensao = horizontal ? bboxInicial.largura : bboxInicial.altura;
  if (!Number.isFinite(dimensao) || dimensao <= 0) return escalaInicial;

  const extremo = horizontal
    ? borda === 'left'
      ? bboxInicial.maxLng - ponto.lng
      : ponto.lng - bboxInicial.minLng
    : borda === 'top'
      ? ponto.lat - bboxInicial.minLat
      : bboxInicial.maxLat - ponto.lat;

  return Math.max(minimo, escalaInicial * (extremo / dimensao));
}

/**
 * Offset do centro da forma em relação ao centro da bounding box, preservado
 * durante o arrasto da alça central.
 * @param {{lat:number,lng:number}} centro
 * @param {{lat:number,lng:number}} centroBbox
 * @returns {{lat:number,lng:number}}
 */
export function calcularOffsetCentro(centro, centroBbox) {
  return { lat: centro.lat - centroBbox.lat, lng: centro.lng - centroBbox.lng };
}

const formas = new Map();
let contadorId = 0;

function iconeAlca(tipo, html) {
  return L.divIcon({
    className: `shape-handle shape-handle--${tipo}`,
    html: `<span aria-hidden="true">${html}</span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function criarMarcadorAlca(posicao, tipo, html, titulo) {
  return L.marker([posicao.lat, posicao.lng], {
    icon: iconeAlca(tipo, html),
    draggable: true,
    keyboard: false,
    title: titulo,
    alt: titulo,
    zIndexOffset: 1000,
  }).addTo(getMap());
}

/**
 * Calcula a rotação aplicada a partir do movimento da alça superior.
 * `delta` é negado porque o eixo Y do ecrã cresce para baixo.
 * @param {number} rotacaoInicial
 * @param {number} anguloInicial
 * @param {number} anguloAtual
 * @returns {number} 0..360
 */
export function calcularRotacao(rotacaoInicial, anguloInicial, anguloAtual) {
  return normalizarRotacao(rotacaoInicial - (anguloAtual - anguloInicial));
}

function estadoPublico(estado) {
  return {
    id: estado.id,
    shape: estado.shape,
    center: { lat: estado.center[0], lng: estado.center[1] },
    size: estado.size,
    rotation: estado.rotation,
    scaleX: estado.scaleX,
    scaleY: estado.scaleY,
    visible: estado.visivel,
  };
}

function projetarPartes(estado) {
  return projectShapeParts(estado.shape, estado.center, estado.size, estado.rotation, {
    scaleX: estado.scaleX,
    scaleY: estado.scaleY,
    aspectRatio: estado.shape?.aspectRatio,
  });
}

/**
 * Posições das alças derivadas da bounding box da forma projetada.
 * @param {Object} estado
 * @returns {Object}
 */
function posicoesAlcas(estado) {
  const bbox = calcularBbox(estado.latlngs);
  const centroLat = bbox.centro[0];
  const centroLng = bbox.centro[1];

  return {
    bbox,
    center: { lat: centroLat, lng: centroLng },
    nw: { lat: bbox.maxLat, lng: bbox.minLng },
    ne: { lat: bbox.maxLat, lng: bbox.maxLng },
    sw: { lat: bbox.minLat, lng: bbox.minLng },
    se: { lat: bbox.minLat, lng: bbox.maxLng },
    rotation: {
      // 15% da altura do bbox, com um mínimo de ~5 m para formas achatadas.
      lat: bbox.maxLat + Math.max(bbox.altura * 0.15, 0.00005),
      lng: centroLng,
    },
    left: { lat: centroLat, lng: bbox.minLng },
    right: { lat: centroLat, lng: bbox.maxLng },
    top: { lat: bbox.maxLat, lng: centroLng },
    bottom: { lat: bbox.minLat, lng: centroLng },
  };
}

let ultimaAtualizacao = 0;
let quadroAnimacao = null;

function agendarRender(estado) {
  const executar = (agora) => {
    quadroAnimacao = null;
    if (Number.isFinite(agora) && agora - ultimaAtualizacao < INTERVALO_ATUALIZACAO_MS) {
      quadroAnimacao = requestAnimationFrame(executar);
      return;
    }
    ultimaAtualizacao = Number.isFinite(agora) ? agora : Date.now();
    renderizar(estado);
  };

  if (quadroAnimacao !== null) return;
  quadroAnimacao = requestAnimationFrame(executar);
}

function renderizar(estado) {
  if (!estado || estado.removido || !formas.has(estado.id)) return;

  const partes = projetarPartes(estado);
  estado.latlngs = partes[0] ?? [];

  if (estado.latlngs.length === 0) return;

  if (estado.camadas.length === 0) {
    const estilo = {
      color: '#1e88e5',
      weight: 3,
      opacity: 0.9,
      fillColor: '#1e88e5',
      fillOpacity: 0.15,
      className: 'forma-art',
      interactive: false,
    };

    const principal = estado.shape?.closed
      ? L.polygon(estado.latlngs, estilo)
      : L.polyline(estado.latlngs, estilo);
    estado.camadas.push(principal.addTo(getMap()));

    for (const parte of partes.slice(1)) {
      estado.camadas.push(L.polyline(parte, estilo).addTo(getMap()));
    }
  } else {
    estado.camadas[0].setLatLngs(estado.latlngs);
  }

  estado.visivel = getMap().hasLayer(estado.camadas[0]);
  if (estado.interativa) atualizarAlcas(estado);
}

function snapshotAlca(estado, chave, marcador) {
  const bbox = calcularBbox(estado.latlngs);

  if (chave === 'center') {
    return {
      tipo: 'center',
      center: [...estado.center],
      offset: calcularOffsetCentro(
        { lat: estado.center[0], lng: estado.center[1] },
        { lat: bbox.centro[0], lng: bbox.centro[1] },
      ),
    };
  }

  if (chave === 'rotation') {
    return {
      tipo: 'rotation',
      rotation: estado.rotation,
      angle: anguloDoCentro({ lat: estado.center[0], lng: estado.center[1] }, marcador.getLatLng()),
    };
  }

  if (chave === 'nw' || chave === 'ne' || chave === 'sw' || chave === 'se') {
    return {
      tipo: 'corner',
      size: estado.size,
      distance: distanciaEmPontos(
        { lat: estado.center[0], lng: estado.center[1] },
        marcador.getLatLng(),
      ),
    };
  }

  return {
    tipo: 'edge',
    borda: chave,
    eixo: chave === 'left' || chave === 'right' ? 'x' : 'y',
    scaleX: estado.scaleX,
    scaleY: estado.scaleY,
    bbox,
  };
}

function aplicarArrasto(estado, marcador, inicial) {
  const latlng = marcador.getLatLng();

  if (inicial.tipo === 'center') {
    estado.center = [latlng.lat + inicial.offset.lat, latlng.lng + inicial.offset.lng];
    estado.callbacks.onMoveLive?.(estadoPublico(estado));
  } else if (inicial.tipo === 'corner') {
    const distancia = distanciaEmPontos({ lat: estado.center[0], lng: estado.center[1] }, latlng);
    estado.size = tamanhoPorDistancia(inicial.size, inicial.distance, distancia);
    estado.callbacks.onSizeChange?.(estado.size);
  } else if (inicial.tipo === 'rotation') {
    const angulo = anguloDoCentro({ lat: estado.center[0], lng: estado.center[1] }, latlng);
    estado.rotation = calcularRotacao(inicial.rotation, inicial.angle, angulo);
    estado.callbacks.onRotationChange?.(estado.rotation);
  } else {
    const proximaEscala = escalaPorBorda({
      eixo: inicial.eixo,
      borda: inicial.borda,
      bboxInicial: inicial.bbox,
      ponto: { lat: latlng.lat, lng: latlng.lng },
      escalaInicial: inicial.eixo === 'x' ? inicial.scaleX : inicial.scaleY,
    });

    if (inicial.eixo === 'x') estado.scaleX = proximaEscala;
    else estado.scaleY = proximaEscala;

    estado.callbacks.onScaleChange?.(estado.scaleX, estado.scaleY);
  }

  agendarRender(estado);
}

function ligarAlca(estado, chave, marcador) {
  const mapa = getMap();
  let inicial = null;

  marcador.on('dragstart', () => {
    mapa.dragging.disable();
    inicial = snapshotAlca(estado, chave, marcador);
  });

  marcador.on('drag', () => {
    if (!inicial) return;
    aplicarArrasto(estado, marcador, inicial);
  });

  marcador.on('dragend', () => {
    mapa.dragging.enable();
    renderizar(estado);

    if (inicial?.tipo === 'center') {
      estado.callbacks.onMove?.(estadoPublico(estado));
    }

    setTimeout(
      () => estado.callbacks.onTransformEnd?.(estadoPublico(estado)),
      ATRASO_FIM_TRANSFORMACAO_MS,
    );
    inicial = null;
  });
}

function criarAlcas(estado) {
  const definicoes = [
    ['center', 'center', '✥', 'Mover forma'],
    ['nw', 'corner', '', 'Redimensionar'],
    ['ne', 'corner', '', 'Redimensionar'],
    ['sw', 'corner', '', 'Redimensionar'],
    ['se', 'corner', '', 'Redimensionar'],
    ['rotation', 'rotation', '↻', 'Rodar forma'],
    ['left', 'edge-ew', '⇔', 'Escalar no eixo X (esquerda)'],
    ['right', 'edge-ew', '⇔', 'Escalar no eixo X (direita)'],
    ['top', 'edge-ns', '⇕', 'Escalar no eixo Y (topo)'],
    ['bottom', 'edge-ns', '⇕', 'Escalar no eixo Y (base)'],
  ];

  for (const [chave, tipo, html, titulo] of definicoes) {
    const marcador = criarMarcadorAlca({ lat: 0, lng: 0 }, tipo, html, titulo);
    ligarAlca(estado, chave, marcador);
    estado.alcas.set(chave, marcador);
  }
}

function atualizarAlcas(estado) {
  if (estado.alcas.size === 0) criarAlcas(estado);

  const posicoes = posicoesAlcas(estado);
  for (const [chave, marcador] of estado.alcas) {
    const posicao = posicoes[chave];
    if (posicao) marcador.setLatLng([posicao.lat, posicao.lng]);
  }
}

function resolverForma(shape) {
  if (typeof shape === 'string') return FORMAS_PADRAO[shape] ?? FORMAS_PADRAO.estrela;
  if (shape && Array.isArray(shape.points)) return shape;
  return null;
}

/**
 * Cria (ou substitui) uma forma no mapa.
 * @param {{id?:string, shape?:string|Object, center?:{lat:number,lng:number}, size?:number, rotation?:number, scaleX?:number, scaleY?:number, interativa?:boolean, callbacks?:Object}} [opcoes]
 * @returns {Object|null} estado público da forma.
 */
export function criarForma({
  id,
  shape = 'estrela',
  center,
  size = SHAPE_DEFAULT_SIZE_M,
  rotation = 0,
  scaleX = 1,
  scaleY = 1,
  interativa = true,
  callbacks = {},
} = {}) {
  const definicao = resolverForma(shape);
  if (!definicao) return null;

  const identificador = id ?? `forma-${(contadorId += 1)}`;
  if (formas.has(identificador)) removerForma(identificador);

  const centroMapa = center ?? getMap().getCenter();
  const estado = {
    id: identificador,
    shape: definicao,
    center: [Number(centroMapa.lat), Number(centroMapa.lng)],
    size: Math.max(SHAPE_MIN_SIZE_M, Number(size) || SHAPE_DEFAULT_SIZE_M),
    rotation: normalizarRotacao(rotation),
    scaleX: Math.max(ESCALA_MINIMA, Number(scaleX) || 1),
    scaleY: Math.max(ESCALA_MINIMA, Number(scaleY) || 1),
    interativa: Boolean(interativa),
    callbacks: callbacks ?? {},
    camadas: [],
    alcas: new Map(),
    latlngs: [],
    visivel: false,
  };

  formas.set(identificador, estado);
  renderizar(estado);
  return estadoPublico(estado);
}

/**
 * Atualiza parâmetros de projeção e re-renderiza.
 * @param {string} id
 * @param {{center?:{lat:number,lng:number}, size?:number, rotation?:number, scaleX?:number, scaleY?:number, shape?:string|Object, visible?:boolean}} [alteracoes]
 * @returns {Object|null}
 */
export function atualizarForma(id, alteracoes = {}) {
  const estado = formas.get(id);
  if (!estado) return null;

  if (alteracoes.center) {
    estado.center = [Number(alteracoes.center.lat), Number(alteracoes.center.lng)];
  }
  if (Number.isFinite(Number(alteracoes.size))) {
    estado.size = Math.max(SHAPE_MIN_SIZE_M, Number(alteracoes.size));
  }
  if (Number.isFinite(Number(alteracoes.rotation))) {
    estado.rotation = normalizarRotacao(Number(alteracoes.rotation));
  }
  if (Number.isFinite(Number(alteracoes.scaleX))) {
    estado.scaleX = Math.max(ESCALA_MINIMA, Number(alteracoes.scaleX));
  }
  if (Number.isFinite(Number(alteracoes.scaleY))) {
    estado.scaleY = Math.max(ESCALA_MINIMA, Number(alteracoes.scaleY));
  }
  if (alteracoes.shape) {
    const definicao = resolverForma(alteracoes.shape);
    if (definicao) estado.shape = definicao;
  }

  if (alteracoes.visible === false) {
    definirVisibilidade(id, false);
    return estadoPublico(estado);
  }
  if (alteracoes.visible === true) definirVisibilidade(id, true);

  renderizar(estado);
  return estadoPublico(estado);
}

/**
 * Mostra/esconde camadas e alças sem perder os parâmetros.
 * @param {string} id
 * @param {boolean} visivel
 * @returns {boolean}
 */
export function definirVisibilidade(id, visivel) {
  const estado = formas.get(id);
  if (!estado) return false;

  const mapa = getMap();
  const mostrar = Boolean(visivel);

  for (const camada of estado.camadas) {
    if (mostrar) camada.addTo(mapa);
    else mapa.removeLayer(camada);
  }
  for (const marcador of estado.alcas.values()) {
    if (mostrar) marcador.addTo(mapa);
    else mapa.removeLayer(marcador);
  }

  estado.visivel = mostrar;
  return true;
}

/**
 * Remove uma forma e todas as suas alças.
 * @param {string} id
 * @returns {boolean}
 */
export function removerForma(id) {
  const estado = formas.get(id);
  if (!estado) return false;

  estado.removido = true;

  const mapa = getMap();
  for (const camada of estado.camadas) mapa.removeLayer(camada);
  for (const marcador of estado.alcas.values()) mapa.removeLayer(marcador);

  estado.camadas = [];
  estado.alcas.clear();
  formas.delete(id);
  return true;
}

/** Remove todas as formas. */
export function limparFormas() {
  for (const id of [...formas.keys()]) removerForma(id);
}

/**
 * @param {string} id
 * @returns {Object|null}
 */
export function getForma(id) {
  const estado = formas.get(id);
  return estado ? estadoPublico(estado) : null;
}

/**
 * @returns {Array<Object>}
 */
export function listarFormas() {
  return [...formas.values()].map(estadoPublico);
}

/**
 * Garante que o mapa existe antes de criar formas (idempotente).
 * @returns {L.Map}
 */
export function inicializarFormas() {
  return getMap();
}
