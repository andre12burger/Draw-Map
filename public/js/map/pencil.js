/**
 * @file map/pencil.js
 * @description Ferramenta de desenho livre (lápis).
 *
 * Regras replicadas do DrawMyLoop (relatório §3):
 * - filtro de 2 px entre pontos e deteção de arrasto real (> 1 px desde o início);
 * - clique simples adiciona um waypoint; arrasto contínuo gera um traço;
 * - simplificação por Douglas-Peucker **métrico** com tolerância adaptativa
 *   (`clamp(L/500, 5, 50)`) em vez de tolerância em pixels;
 * - reconstrução de alças (`reconstruirAlcas`): DP 12 m + viragem ≥ 55° +
 *   espaçamento mínimo de 8 m + limite de 120 alças;
 * - repaint do traço agendado em `requestAnimationFrame` (um por frame);
 * - guarda de 500 ms entre gestos, `Escape` cancela e `Space` devolve o pan;
 * - toque: 1 dedo desenha, 2 dedos cancelam o traço (pinch).
 */

import { getCampo } from '../core/state.js';
import { getMap, obterEstilosDinamicos } from './map.js';
import { adicionarPonto, estaOcupado, processarLoteLapis } from './draw.js';
import { reconstruirAlcas, resample, simplifyTrace } from '../core/geo.js';
import { ehCampoEditavel } from '../core/utils.js';
import { mostrarToast } from '../ui/toast.js';

/** Limiares do gesto (exportados para testes). */
export const CONFIG_LAPIS = Object.freeze({
  distanciaMinimaPixels: 2,
  distanciaArrastoPixels: 1,
  intervaloGestoMs: 500,
  passoMaximoMetros: 40,
  maxPontosEstrategicos: 400,
  maxAlcas: 120,
  espacamentoMinimoAlcasMetros: 8,
  toleranciaAlcasMetros: 12,
});

const raf =
  typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame.bind(globalThis)
    : (callback) => setTimeout(() => callback(Date.now()), 16);

let inicializado = false;
let desenhando = false;
let arrastou = false;
let pontosDecalque = [];
let polylineDecalque = null;
let espacoPressionado = false;
let quadroAgendado = null;
let ultimoFimGestoS = 0;
let pontoInicialContainer = null;
let toqueComMultiplosDedos = false;

function ferramentaLapisAtiva() {
  return getCampo('ferramentaAtiva') === 'lapis';
}

function permiteArrastar() {
  return !ferramentaLapisAtiva() || espacoPressionado;
}

/**
 * Ativa/desativa interações do mapa incompatíveis com o desenho. `Space`
 * devolve temporariamente o pan.
 */
function sincronizarArrasto() {
  const mapa = getMap();
  const desenhoAtivo = ferramentaLapisAtiva() && !espacoPressionado;

  if (permiteArrastar()) {
    mapa.dragging.enable();
  } else {
    mapa.dragging.disable();
  }

  mapa.getContainer().classList.toggle('cursor-lapis', desenhoAtivo);

  const alternar = (handler, ativo) => {
    if (!handler) return;
    if (ativo) handler.disable();
    else handler.enable();
  };

  alternar(mapa.doubleClickZoom, desenhoAtivo);
  alternar(mapa.boxZoom, desenhoAtivo);
  alternar(mapa.keyboard, desenhoAtivo);
}

function removerPolyline() {
  if (quadroAgendado !== null) {
    if (typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(quadroAgendado);
    }
    quadroAgendado = null;
  }

  if (polylineDecalque) {
    getMap().removeLayer(polylineDecalque);
    polylineDecalque = null;
  }
}

function limparEstadoDesenho() {
  desenhando = false;
  arrastou = false;
  pontosDecalque = [];
  pontoInicialContainer = null;
  toqueComMultiplosDedos = false;
  removerPolyline();
}

function cancelarDesenho() {
  limparEstadoDesenho();
  ultimoFimGestoS = Date.now();
}

function agendarAtualizacao() {
  if (quadroAgendado !== null) return;

  quadroAgendado = raf(() => {
    quadroAgendado = null;
    if (polylineDecalque) polylineDecalque.setLatLngs(pontosDecalque);
  });
}

function distanciaContainer(a, b) {
  const mapa = getMap();
  return mapa.latLngToContainerPoint(a).distanceTo(mapa.latLngToContainerPoint(b));
}

/**
 * Regista um ponto do traço respeitando o filtro de 2 px.
 * @param {L.LatLng} latlng
 */
function registarPonto(latlng) {
  const ultimo = pontosDecalque[pontosDecalque.length - 1];

  if (ultimo && distanciaContainer(ultimo, latlng) < CONFIG_LAPIS.distanciaMinimaPixels) {
    return;
  }

  if (
    !arrastou &&
    pontoInicialContainer &&
    distanciaContainer(pontosDecalque[0], latlng) > CONFIG_LAPIS.distanciaArrastoPixels
  ) {
    arrastou = true;
  }

  pontosDecalque.push(latlng);
  agendarAtualizacao();
}

function iniciarDesenho(latlng) {
  const mapa = getMap();
  const { pesoLinha } = obterEstilosDinamicos();

  limparEstadoDesenho();
  desenhando = true;
  pontosDecalque = [latlng];
  pontoInicialContainer = mapa.latLngToContainerPoint(latlng);

  polylineDecalque = L.polyline(pontosDecalque, {
    color: '#607d8b',
    weight: pesoLinha,
    opacity: 0.7,
    dashArray: '5, 5',
    className: 'rabisco-fantasma',
    interactive: false,
  }).addTo(mapa);
}

/**
 * Simplifica o traço em metros (DP adaptativo) e densifica para o roteador não
 * "cortar caminho" entre vértices distantes.
 * @param {Array<{lat:number,lng:number}|L.LatLng|number[]>} pontosBrutos
 * @param {{toleranciaMetros?:number, passoMaximoMetros?:number}} [opcoes]
 * @returns {Array<{lat:number,lng:number}>}
 */
export function prepararPontosEstrategicos(
  pontosBrutos,
  { toleranciaMetros, passoMaximoMetros = CONFIG_LAPIS.passoMaximoMetros } = {},
) {
  if (!Array.isArray(pontosBrutos) || pontosBrutos.length < 2) return [];

  const pontos = pontosBrutos
    .map((ponto) => {
      if (Array.isArray(ponto)) return [Number(ponto[0]), Number(ponto[1])];
      return [Number(ponto?.lat), Number(ponto?.lng)];
    })
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

  if (pontos.length < 2) return [];

  const simplificados = simplifyTrace(pontos, toleranciaMetros);
  const { handles } = reconstruirAlcas(simplificados);
  const base = handles.length >= 2 ? handles : simplificados;

  return resample(base, passoMaximoMetros).map(([lat, lng]) => ({ lat, lng }));
}

/**
 * Reconstrói alças editáveis (equivalente ao `ek` do DrawMyLoop).
 * @param {Array<{lat:number,lng:number}|L.LatLng|number[]>} pontosBrutos
 * @param {{maxHandles?:number, minSpacingMeters?:number, toleranceMeters?:number}} [opcoes]
 * @returns {Array<{lat:number,lng:number}>}
 */
export function prepararAlcas(pontosBrutos, opcoes = {}) {
  if (!Array.isArray(pontosBrutos) || pontosBrutos.length === 0) return [];

  const pontos = pontosBrutos
    .map((ponto) => {
      if (Array.isArray(ponto)) return [Number(ponto[0]), Number(ponto[1])];
      return [Number(ponto?.lat), Number(ponto?.lng)];
    })
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

  const { handles } = reconstruirAlcas(pontos, {
    maxHandles: opcoes.maxHandles ?? CONFIG_LAPIS.maxAlcas,
    minSpacingMeters: opcoes.minSpacingMeters ?? CONFIG_LAPIS.espacamentoMinimoAlcasMetros,
    toleranceMeters: opcoes.toleranceMeters ?? CONFIG_LAPIS.toleranciaAlcasMetros,
  });

  return handles.map(([lat, lng]) => ({ lat, lng }));
}

async function finalizarDesenho() {
  if (!desenhando) return;

  const pontos = pontosDecalque.slice();
  const foiArrasto = arrastou && pontos.length > 2;

  desenhando = false;
  arrastou = false;
  pontosDecalque = [];
  pontoInicialContainer = null;
  removerPolyline();
  sincronizarArrasto();
  ultimoFimGestoS = Date.now();

  if (estaOcupado()) {
    mostrarToast('Aguarde o cálculo anterior terminar.', { tipo: 'aviso', duracao: 2000 });
    return;
  }

  if (!foiArrasto) {
    const ponto = pontos[pontos.length - 1];
    if (!ponto) return;
    // Clique simples = um waypoint (com snap para a via), não um traço.
    const modoLivre = getCampo('perfilUi') === 'free';
    await adicionarPonto({ lat: ponto.lat, lng: ponto.lng }, modoLivre);
    return;
  }

  const estrategicos = prepararPontosEstrategicos(pontos);

  if (estrategicos.length < 2) return;

  if (estrategicos.length > CONFIG_LAPIS.maxPontosEstrategicos) {
    mostrarToast('Desenho muito grande. Divida o traço em partes menores.', {
      tipo: 'aviso',
    });
    return;
  }

  await processarLoteLapis(estrategicos, getCampo('perfilUi') === 'free');
}

export function cancelarLapis() {
  cancelarDesenho();
  sincronizarArrasto();
}

/**
 * Registra os listeners do lápis. Idempotente.
 */
export function inicializarPencil() {
  if (inicializado) return;
  inicializado = true;

  const mapa = getMap();

  mapa.on('mousedown', (evento) => {
    if (!ferramentaLapisAtiva()) return;

    const original = evento.originalEvent;
    if (original?.button !== 0) return;
    if (espacoPressionado) return;
    if (
      original?.target?.closest?.(
        '.leaflet-marker-icon, .leaflet-control, .leaflet-popup-content-wrapper, .leaflet-interactive',
      )
    ) {
      return;
    }
    if (Date.now() - ultimoFimGestoS < CONFIG_LAPIS.intervaloGestoMs) return;

    if (estaOcupado()) {
      mostrarToast('Aguarde o cálculo anterior terminar.', { tipo: 'aviso', duracao: 2000 });
      return;
    }

    iniciarDesenho(evento.latlng);
  });

  mapa.on('mousemove', (evento) => {
    if (!desenhando || !ferramentaLapisAtiva()) return;
    registarPonto(evento.latlng);
  });

  // Finaliza mesmo se o botão for solto fora do mapa.
  document.addEventListener('mouseup', () => {
    if (!desenhando) return;
    void finalizarDesenho();
  });

  const contentor = mapa.getContainer();

  contentor.addEventListener(
    'touchstart',
    (evento) => {
      if (!ferramentaLapisAtiva() || espacoPressionado) return;

      if (evento.touches.length >= 2) {
        toqueComMultiplosDedos = true;
        if (desenhando) cancelarDesenho();
        return;
      }
      if (estaOcupado()) return;

      evento.preventDefault();
      iniciarDesenho(mapa.mouseEventToLatLng(evento.touches[0]));
    },
    { passive: false },
  );

  contentor.addEventListener(
    'touchmove',
    (evento) => {
      if (!desenhando) return;

      if (evento.touches.length >= 2) {
        toqueComMultiplosDedos = true;
        cancelarDesenho();
        return;
      }

      evento.preventDefault();
      registarPonto(mapa.mouseEventToLatLng(evento.touches[0]));
    },
    { passive: false },
  );

  contentor.addEventListener(
    'touchend',
    (evento) => {
      if (!desenhando) return;
      if (toqueComMultiplosDedos || evento.touches.length > 0) return;

      evento.preventDefault();
      void finalizarDesenho();
    },
    { passive: false },
  );

  contentor.addEventListener('touchcancel', () => {
    if (desenhando) cancelarDesenho();
  });

  window.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && desenhando) {
      evento.preventDefault();
      cancelarDesenho();
      mostrarToast('Traço cancelado.', { tipo: 'info', duracao: 1500 });
      return;
    }

    if (evento.code !== 'Space' || evento.repeat) return;
    if (ehCampoEditavel(evento.target)) return;
    if (evento.target?.closest?.('button, a')) return;

    evento.preventDefault();
    espacoPressionado = true;
    sincronizarArrasto();
  });

  window.addEventListener('keyup', (evento) => {
    if (evento.code !== 'Space') return;
    espacoPressionado = false;
    sincronizarArrasto();
  });

  window.addEventListener('blur', () => {
    espacoPressionado = false;
    if (desenhando) cancelarDesenho();
    sincronizarArrasto();
  });

  sincronizarArrasto();
}

export { sincronizarArrasto };
