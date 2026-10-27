/**
 * @file map/map.js
 * @description Inicialização do mapa Leaflet, tiles e estilos responsivos.
 * O mapa é criado sob demanda para que o estado persistido já esteja carregado.
 */

import { atualizarEstado, getCampo } from '../core/state.js';

const CENTRO_PADRAO = { lat: -32.0332, lng: -52.0986, zoom: 14 };
const ZOOM_NATIVO_MAXIMO = 19;
const ATRASO_SALVAR_VIEW = 250;

let mapa = null;
let temporizadorView = null;

function viewInicial() {
  const salva = getCampo('mapa');
  if (
    salva &&
    Number.isFinite(Number(salva.lat)) &&
    Number.isFinite(Number(salva.lng)) &&
    Number.isFinite(Number(salva.zoom))
  ) {
    return {
      lat: Number(salva.lat),
      lng: Number(salva.lng),
      zoom: Math.min(ZOOM_NATIVO_MAXIMO, Math.max(1, Number(salva.zoom))),
    };
  }
  return CENTRO_PADRAO;
}

function salvarView(instancia) {
  clearTimeout(temporizadorView);
  temporizadorView = setTimeout(() => {
    const centro = instancia.getCenter();
    atualizarEstado(
      { mapa: { lat: centro.lat, lng: centro.lng, zoom: instancia.getZoom() } },
      { registrarHistorico: false, notificar: false },
    );
  }, ATRASO_SALVAR_VIEW);
}

function criarMapa() {
  const view = viewInicial();
  const instancia = L.map('map', {
    doubleClickZoom: false,
    boxZoom: false,
    zoomControl: true,
  }).setView([view.lat, view.lng], view.zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: ZOOM_NATIVO_MAXIMO,
    maxNativeZoom: ZOOM_NATIVO_MAXIMO,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(instancia);

  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(instancia);

  instancia.on('moveend zoomend', () => salvarView(instancia));

  return instancia;
}

/**
 * @returns {L.Map} instância única do mapa.
 */
export function getMap() {
  if (!mapa) mapa = criarMapa();
  return mapa;
}

/**
 * @param {{lat:number,lng:number}} ponto
 * @param {number} [zoom=16]
 */
export function irPara(ponto, zoom = 16) {
  getMap().flyTo([ponto.lat, ponto.lng], zoom, { animate: true, duration: 1.2 });
}

/**
 * Calcula espessuras/tamanhos conforme o zoom, mantendo a rota legível.
 * @returns {{pesoLinha:number, tamanhoMarcador:number, tamanhoFonteKm:number}}
 */
export function obterEstilosDinamicos() {
  const zoom = getMap().getZoom();
  let pesoLinha = 4;
  let tamanhoMarcador = 12;
  let tamanhoFonteKm = 11;

  if (zoom > 14) {
    pesoLinha = 4 + (zoom - 14) * 1.5;
    tamanhoMarcador = 12 + (zoom - 14) * 2.5;
    tamanhoFonteKm = 11 + (zoom - 14) * 1.2;
  } else if (zoom < 14) {
    pesoLinha = Math.max(2, 4 - (14 - zoom));
    tamanhoMarcador = Math.max(6, 12 - (14 - zoom) * 1.5);
    tamanhoFonteKm = Math.max(8, 11 - (14 - zoom));
  }

  return {
    pesoLinha: Math.round(pesoLinha),
    tamanhoMarcador: Math.round(tamanhoMarcador),
    tamanhoFonteKm: Math.round(tamanhoFonteKm),
  };
}
