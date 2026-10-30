/**
 * @file map/image-overlay.js
 * @description Sobreposição de imagem de referência (mover, redimensionar e
 * opacidade). Os bounds são calculados projetando no zoom 20
 * (`156543.03392 * cos(lat) / 2^20`) e a altura deriva do rácio de aspeto real
 * da imagem (`naturalWidth / naturalHeight`), sem rotação — como no DrawMyLoop
 * (relatório §5).
 *
 * A imagem é desenhada num pane próprio (`reference-image`, zIndex 350) com
 * `pointer-events: none`, `data-clarity-mask` e `data-html2canvas-ignore`
 * (privacidade e exportação).
 */

import { calcularBoundsImagem } from '../core/geo.js';
import { getMap } from './map.js';

export const IMAGEM_MIN_METROS = 10;
export const IMAGEM_MAX_METROS = 20_000;
export const OPACIDADE_PADRAO = 0.5;
export const PANE_IMAGEM = 'reference-image';

const INTERVALO_ATUALIZACAO_MS = 32;
const ATRASO_FIM_TRANSFORMACAO_MS = 50;
const TEMPO_MAXIMO_ASPETO_MS = 3_000;

let estado = null;
let ultimaAtualizacao = 0;
let quadroAnimacao = null;

/**
 * @param {number} valor
 * @returns {number} valor limitado a `[IMAGEM_MIN_METROS, IMAGEM_MAX_METROS]`.
 */
export function limitarTamanhoImagem(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return IMAGEM_MIN_METROS;
  return Math.max(IMAGEM_MIN_METROS, Math.min(IMAGEM_MAX_METROS, numero));
}

/**
 * @param {number} valor
 * @returns {number} opacidade em `[0, 1]`.
 */
export function limitarOpacidade(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return OPACIDADE_PADRAO;
  return Math.max(0, Math.min(1, numero));
}

/**
 * Cria o pane dedicado com zIndex 350 e sem eventos de ponteiro.
 * @param {L.Map} mapa
 * @returns {HTMLElement}
 */
export function garantirPane(mapa) {
  let pane = mapa.getPane(PANE_IMAGEM);
  if (!pane) pane = mapa.createPane(PANE_IMAGEM);

  pane.style.zIndex = '350';
  pane.style.pointerEvents = 'none';
  return pane;
}

/**
 * Lê `naturalWidth / naturalHeight` de forma assíncrona, com fallback `1`
 * (imagem inválida, bloqueada por CORS ou ambiente sem `Image`).
 * @param {string} url
 * @returns {Promise<number>}
 */
export function obterAspectoImagem(url) {
  return new Promise((resolver) => {
    if (typeof Image !== 'function') {
      resolver(1);
      return;
    }

    const imagem = new Image();
    let resolvido = false;
    let temporizador = null;

    const finalizar = (valor) => {
      if (resolvido) return;
      resolvido = true;
      if (temporizador) clearTimeout(temporizador);
      const numero = Number(valor);
      resolver(Number.isFinite(numero) && numero > 0 ? numero : 1);
    };

    imagem.onload = () =>
      finalizar(
        imagem.naturalWidth && imagem.naturalHeight
          ? imagem.naturalWidth / imagem.naturalHeight
          : 1,
      );
    imagem.onerror = () => finalizar(1);
    temporizador = setTimeout(() => finalizar(1), TEMPO_MAXIMO_ASPETO_MS);

    imagem.src = url;
  });
}

function estadoPublico() {
  if (!estado) return null;
  return {
    url: estado.url,
    center: { lat: estado.center[0], lng: estado.center[1] },
    size: estado.size,
    opacity: estado.opacity,
    aspectRatio: estado.aspectRatio,
    visible: Boolean(estado.camada),
  };
}

function boundsAtuais() {
  const bounds = calcularBoundsImagem(estado.center, estado.size, estado.aspectRatio, 20);
  return L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
}

function decorarElemento(camada) {
  const elemento = camada.getElement?.();
  if (!elemento) return;

  elemento.setAttribute('data-clarity-mask', 'true');
  elemento.setAttribute('data-html2canvas-ignore', 'true');
  elemento.setAttribute('alt', '');
  elemento.setAttribute('draggable', 'false');
  elemento.style.pointerEvents = 'none';
}

function distanciaEmPontos(a, b) {
  const mapa = getMap();
  return mapa
    .latLngToLayerPoint([a.lat, a.lng])
    .distanceTo(mapa.latLngToLayerPoint([b.lat, b.lng]));
}

function posicoesAlcas() {
  const bounds = boundsAtuais();
  const norte = bounds.getNorth();
  const sul = bounds.getSouth();
  const leste = bounds.getEast();
  const oeste = bounds.getWest();

  return {
    center: { lat: estado.center[0], lng: estado.center[1] },
    nw: { lat: norte, lng: oeste },
    ne: { lat: norte, lng: leste },
    sw: { lat: sul, lng: oeste },
    se: { lat: sul, lng: leste },
  };
}

function criarMarcador(tipo, html, titulo) {
  return L.marker([0, 0], {
    icon: L.divIcon({
      className: `image-handle image-handle--${tipo}`,
      html: `<span aria-hidden="true">${html}</span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    }),
    draggable: true,
    keyboard: false,
    title: titulo,
    alt: titulo,
    zIndexOffset: 900,
  }).addTo(getMap());
}

function agendarRender() {
  if (quadroAnimacao !== null) return;

  quadroAnimacao = requestAnimationFrame((agora) => {
    quadroAnimacao = null;
    if (Number.isFinite(agora) && agora - ultimaAtualizacao < INTERVALO_ATUALIZACAO_MS) {
      agendarRender();
      return;
    }
    ultimaAtualizacao = Number.isFinite(agora) ? agora : Date.now();
    renderizar();
  });
}

function atualizarAlcas() {
  if (!estado) return;

  if (estado.alcas.size === 0) {
    const definicoes = [
      ['center', 'center', '✥', 'Mover imagem'],
      ['nw', 'corner', '', 'Redimensionar imagem (NW)'],
      ['ne', 'corner', '', 'Redimensionar imagem (NE)'],
      ['sw', 'corner', '', 'Redimensionar imagem (SW)'],
      ['se', 'corner', '', 'Redimensionar imagem (SE)'],
    ];

    for (const [chave, tipo, html, titulo] of definicoes) {
      const marcador = criarMarcador(tipo, html, titulo);
      ligarAlca(chave, marcador);
      estado.alcas.set(chave, marcador);
    }
  }

  const posicoes = posicoesAlcas();
  for (const [chave, marcador] of estado.alcas) {
    const posicao = posicoes[chave];
    if (posicao) marcador.setLatLng([posicao.lat, posicao.lng]);
  }
}

function ligarAlca(chave, marcador) {
  const mapa = getMap();
  let inicial = null;

  marcador.on('dragstart', () => {
    mapa.dragging.disable();
    inicial =
      chave === 'center'
        ? { tipo: 'center' }
        : {
            tipo: 'corner',
            size: estado.size,
            distance: distanciaEmPontos(
              { lat: estado.center[0], lng: estado.center[1] },
              marcador.getLatLng(),
            ),
          };
  });

  marcador.on('drag', () => {
    if (!inicial || !estado) return;
    const latlng = marcador.getLatLng();

    if (inicial.tipo === 'center') {
      estado.center = [latlng.lat, latlng.lng];
      estado.callbacks.onMoveLive?.(estadoPublico());
    } else {
      const distancia = distanciaEmPontos({ lat: estado.center[0], lng: estado.center[1] }, latlng);
      estado.size = limitarTamanhoImagem(
        inicial.distance > 0 ? (inicial.size * distancia) / inicial.distance : inicial.size,
      );
      estado.callbacks.onSizeChange?.(estado.size);
    }

    agendarRender();
  });

  marcador.on('dragend', () => {
    mapa.dragging.enable();
    renderizar();

    if (inicial?.tipo === 'center') estado.callbacks.onMove?.(estadoPublico());

    setTimeout(
      () => estado?.callbacks.onTransformEnd?.(estadoPublico()),
      ATRASO_FIM_TRANSFORMACAO_MS,
    );
    inicial = null;
  });
}

function renderizar() {
  if (!estado) return;

  const mapa = getMap();
  garantirPane(mapa);
  const bounds = boundsAtuais();

  if (!estado.camada) {
    estado.camada = L.imageOverlay(estado.url, bounds, {
      opacity: estado.opacity,
      interactive: false,
      pane: PANE_IMAGEM,
      className: 'ph-no-capture reference-image-layer',
      alt: '',
    }).addTo(mapa);

    estado.camada.on('add', () => decorarElemento(estado.camada));
  } else {
    estado.camada.setBounds(bounds);
    estado.camada.setOpacity(estado.opacity);
  }

  decorarElemento(estado.camada);
  atualizarAlcas();
}

/**
 * Mostra uma imagem de referência (substitui a anterior, se existir).
 * @param {{url:string, center?:{lat:number,lng:number}, size?:number, opacity?:number, aspectRatio?:number, callbacks?:Object}} opcoes
 * @returns {Promise<Object|null>} estado público.
 */
export async function mostrarImagem({
  url,
  center,
  size = 2000,
  opacity = OPACIDADE_PADRAO,
  aspectRatio,
  callbacks = {},
} = {}) {
  if (typeof url !== 'string' || url.trim() === '') return null;

  const mapa = getMap();
  const centro = center ?? mapa.getCenter();
  const aspectoInformado = Number(aspectRatio);
  const aspecto =
    Number.isFinite(aspectoInformado) && aspectoInformado > 0
      ? aspectoInformado
      : await obterAspectoImagem(url);

  removerImagem();

  estado = {
    url,
    center: [Number(centro.lat), Number(centro.lng)],
    size: limitarTamanhoImagem(size),
    opacity: limitarOpacidade(opacity),
    aspectRatio: aspecto,
    camada: null,
    alcas: new Map(),
    callbacks: callbacks ?? {},
  };

  renderizar();
  return estadoPublico();
}

/**
 * Atualiza centro, tamanho e/ou opacidade.
 * @param {{center?:{lat:number,lng:number}, size?:number, opacity?:number}} [alteracoes]
 * @returns {Object|null}
 */
export function atualizarImagem({ center, size, opacity } = {}) {
  if (!estado) return null;

  if (center) estado.center = [Number(center.lat), Number(center.lng)];
  if (Number.isFinite(Number(size))) estado.size = limitarTamanhoImagem(size);
  if (Number.isFinite(Number(opacity))) estado.opacity = limitarOpacidade(opacity);

  renderizar();
  return estadoPublico();
}

/**
 * @param {{lat:number,lng:number}} center
 * @returns {Object|null}
 */
export function moverImagem(center) {
  return center ? atualizarImagem({ center }) : null;
}

/**
 * @param {number} size - largura em metros (10–20 000).
 * @returns {Object|null}
 */
export function redimensionarImagem(size) {
  return Number.isFinite(Number(size)) ? atualizarImagem({ size }) : null;
}

/**
 * @param {number} valor - 0 a 1.
 * @returns {Object|null}
 */
export function definirOpacidade(valor) {
  if (!estado) return null;
  estado.opacity = limitarOpacidade(valor);
  estado.camada?.setOpacity(estado.opacity);
  return estadoPublico();
}

/**
 * Remove a imagem e as alças.
 * @returns {boolean}
 */
export function removerImagem() {
  if (!estado) return false;

  const mapa = getMap();
  if (estado.camada) mapa.removeLayer(estado.camada);
  for (const marcador of estado.alcas.values()) mapa.removeLayer(marcador);

  estado = null;
  return true;
}

/**
 * @returns {Object|null}
 */
export function getImagemReferencia() {
  return estadoPublico();
}

/**
 * Garante o pane dedicado (idempotente).
 * @returns {L.Map}
 */
export function inicializarImagemReferencia() {
  const mapa = getMap();
  garantirPane(mapa);
  return mapa;
}
