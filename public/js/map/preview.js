/**
 * @file map/preview.js
 * @description Cursor fantasma que antecipa o snap do próximo ponto.
 * Só funciona nos modos Rua/Livre, cancela requisições antigas, ignora respostas
 * fora de ordem e não entra no contador de requisições.
 */

import { getCampo } from '../core/state.js';
import { obterSnap } from '../services/api.js';
import { getMap, obterEstilosDinamicos } from './map.js';

const ATRASO_SNAP_MS = 350;

let inicializado = false;
let marcador = null;
let temporizador = null;
let controlador = null;
let sequencia = 0;
let ultimoTamanho = 0;
let ultimoModoLivre = null;

function removerMarcador() {
  if (marcador) {
    getMap().removeLayer(marcador);
    marcador = null;
  }
}

function cancelarPendente() {
  clearTimeout(temporizador);
  temporizador = null;
  if (controlador) {
    controlador.abort();
    controlador = null;
  }
  sequencia += 1;
}

export function limparPrevia() {
  cancelarPendente();
  removerMarcador();
}

function garantirMarcador(latlng, livre, tamanho) {
  const mapa = getMap();
  const classe = livre ? 'marcador-previa marcador-previa-livre' : 'marcador-previa';
  const icone = L.divIcon({
    className: classe,
    iconSize: [tamanho, tamanho],
    iconAnchor: [tamanho / 2, tamanho / 2],
  });

  if (!marcador) {
    marcador = L.marker(latlng, { icon: icone, interactive: false, keyboard: false }).addTo(mapa);
  } else {
    marcador.setLatLng(latlng);
    if (tamanho !== ultimoTamanho || livre !== ultimoModoLivre) {
      marcador.setIcon(icone);
    }
  }

  ultimoTamanho = tamanho;
  ultimoModoLivre = livre;
  marcador.setOpacity(livre ? 1 : 0.4);
}

/**
 * Registra os listeners do cursor fantasma. Idempotente.
 */
export function inicializarPreview() {
  if (inicializado) return;
  inicializado = true;

  const mapa = getMap();
  const container = mapa.getContainer();

  mapa.on('mousemove', (evento) => {
    const ferramenta = getCampo('ferramentaAtiva');
    if (ferramenta === 'lapis') {
      limparPrevia();
      return;
    }

    const livre = Boolean(evento.originalEvent?.shiftKey) || ferramenta === 'livre';
    const { tamanhoMarcador } = obterEstilosDinamicos();

    garantirMarcador(evento.latlng, livre, tamanhoMarcador);

    if (livre) {
      cancelarPendente();
      return;
    }

    cancelarPendente();
    const token = sequencia + 1;
    sequencia = token;
    const posicao = { lat: evento.latlng.lat, lng: evento.latlng.lng };

    temporizador = setTimeout(async () => {
      controlador = new AbortController();
      const snap = await obterSnap(posicao, { sinal: controlador.signal });

      if (token !== sequencia || !marcador) return;
      if (snap) {
        marcador.setLatLng([snap.lat, snap.lng]);
        marcador.setOpacity(1);
      }
    }, ATRASO_SNAP_MS);
  });

  container.addEventListener('mouseleave', limparPrevia);
}
