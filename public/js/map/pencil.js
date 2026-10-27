/**
 * @file map/pencil.js
 * @description Ferramenta de desenho livre (lápis). Corrige os travamentos do
 * fluxo antigo ao finalizar o traço no `document` (mesmo fora do mapa), tratar a
 * barra de espaço sem acionar botões focados e resetar o estado no `blur`.
 */

import { getCampo } from '../core/state.js';
import { getMap, obterEstilosDinamicos } from './map.js';
import { processarLoteLapis } from './draw.js';
import { ehCampoEditavel } from '../core/utils.js';
import { mostrarToast } from '../ui/toast.js';

const DISTANCIA_MINIMA_PIXELS = 2;
const TOLERANCIA_SIMPLIFICACAO_PIXELS = 12;
const DISTANCIA_MAXIMA_METROS = 40;
const MAX_PONTOS_ESTRATEGICOS = 400;

let inicializado = false;
let desenhando = false;
let pontosDecalque = [];
let polylineDecalque = null;
let espacoPressionado = false;

function ferramentaLapisAtiva() {
  return getCampo('ferramentaAtiva') === 'lapis';
}

function permiteArrastar() {
  return !ferramentaLapisAtiva() || espacoPressionado;
}

function sincronizarArrasto() {
  const mapa = getMap();
  if (permiteArrastar()) mapa.dragging.enable();
  else mapa.dragging.disable();
}

function removerPolyline() {
  if (polylineDecalque) {
    getMap().removeLayer(polylineDecalque);
    polylineDecalque = null;
  }
}

function cancelarDesenho() {
  desenhando = false;
  pontosDecalque = [];
  removerPolyline();
}

/**
 * Simplifica o traço em pixels e subdivide trechos longos para que o roteador
 * não "corte caminho" entre vértices distantes.
 * @param {L.LatLng[]} pontosBrutos
 * @returns {Array<{lat:number,lng:number}>}
 */
export function prepararPontosEstrategicos(pontosBrutos) {
  const mapa = getMap();
  const pontosPixel = pontosBrutos.map((ponto) => mapa.project(ponto));
  const esquinas = L.LineUtil.simplify(pontosPixel, TOLERANCIA_SIMPLIFICACAO_PIXELS).map((ponto) =>
    mapa.unproject(ponto),
  );

  const estrategicos = [];

  for (let i = 0; i < esquinas.length - 1; i += 1) {
    const atual = esquinas[i];
    const proximo = esquinas[i + 1];
    estrategicos.push({ lat: atual.lat, lng: atual.lng });

    const distancia = atual.distanceTo(proximo);
    if (distancia > DISTANCIA_MAXIMA_METROS) {
      const fracoes = Math.ceil(distancia / DISTANCIA_MAXIMA_METROS);
      for (let j = 1; j < fracoes; j += 1) {
        const proporcao = j / fracoes;
        estrategicos.push({
          lat: atual.lat + (proximo.lat - atual.lat) * proporcao,
          lng: atual.lng + (proximo.lng - atual.lng) * proporcao,
        });
      }
    }
  }

  const ultimo = esquinas[esquinas.length - 1];
  if (ultimo) estrategicos.push({ lat: ultimo.lat, lng: ultimo.lng });

  return estrategicos;
}

async function finalizarDesenho() {
  if (!desenhando) return;

  desenhando = false;
  sincronizarArrasto();

  const pontos = pontosDecalque;
  pontosDecalque = [];
  removerPolyline();

  if (pontos.length < 2) return;

  const estrategicos = prepararPontosEstrategicos(pontos);

  if (estrategicos.length > MAX_PONTOS_ESTRATEGICOS) {
    mostrarToast('Desenho muito grande. Divida o traço em partes menores.', {
      tipo: 'aviso',
    });
    return;
  }

  await processarLoteLapis(estrategicos, false);
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
    if (evento.originalEvent?.button !== 0) return;
    if (espacoPressionado) return;
    // Não inicia um traço ao tentar arrastar um marcador existente.
    if (evento.originalEvent?.target?.closest?.('.leaflet-marker-icon')) return;

    mapa.dragging.disable();
    desenhando = true;
    pontosDecalque = [evento.latlng];

    const { pesoLinha } = obterEstilosDinamicos();
    polylineDecalque = L.polyline(pontosDecalque, {
      color: '#607d8b',
      weight: pesoLinha,
      opacity: 0.7,
      dashArray: '5, 5',
      className: 'rabisco-fantasma',
      interactive: false,
    }).addTo(mapa);
  });

  mapa.on('mousemove', (evento) => {
    if (!desenhando || !ferramentaLapisAtiva()) return;

    const ultimo = pontosDecalque[pontosDecalque.length - 1];
    if (ultimo) {
      const distancia = mapa
        .latLngToContainerPoint(ultimo)
        .distanceTo(mapa.latLngToContainerPoint(evento.latlng));
      if (distancia < DISTANCIA_MINIMA_PIXELS) return;
    }

    pontosDecalque.push(evento.latlng);
    if (polylineDecalque) polylineDecalque.setLatLngs(pontosDecalque);
  });

  // Finaliza mesmo se o botão for solto fora do mapa.
  document.addEventListener('mouseup', () => {
    if (!desenhando) return;
    void finalizarDesenho();
  });

  window.addEventListener('keydown', (evento) => {
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
}

export { sincronizarArrasto };
