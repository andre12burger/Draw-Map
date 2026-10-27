/**
 * @file map/render.js
 * @description Renderização declarativa: recebe o estado e reconstrói as camadas
 * (marcadores, trechos e marcadores de km). Não conhece a lógica de roteamento,
 * evitando dependências circulares com `draw.js`.
 */

import { getMap, obterEstilosDinamicos } from './map.js';
import { calcularMarcadoresKm } from './distance.js';
import { atualizarEstatisticas } from '../ui/stats.js';

let camadasLinhas = [];
let camadasMarcadores = [];
let marcadoresKm = [];
let ultimoEstado = null;

let aoArrastarPonto = () => {};
let aoInserirPonto = () => {};

/**
 * @param {{arrastarPonto:Function, inserirPonto:Function}} handlers
 */
export function configurarHandlers({ arrastarPonto, inserirPonto }) {
  aoArrastarPonto = arrastarPonto;
  aoInserirPonto = inserirPonto;
}

function classePonto(modo) {
  return modo === 'livre' ? 'marcador-custom marcador-livre' : 'marcador-custom';
}

function criarIconePonto(modo, tamanho) {
  return L.divIcon({
    className: classePonto(modo),
    iconSize: [tamanho, tamanho],
    iconAnchor: [tamanho / 2, tamanho / 2],
  });
}

function criarIconeKm(numero, tamanho, tamanhoFonte) {
  return L.divIcon({
    className: 'marcador-km',
    html: `<span style="font-size: ${tamanhoFonte}px;">${numero}</span>`,
    iconSize: [tamanho * 1.8, tamanho * 1.8],
    iconAnchor: [tamanho * 0.9, tamanho * 0.9],
  });
}

function estiloLinha(modo, pesoLinha) {
  const estilo = { color: '#e53935', weight: pesoLinha, opacity: 0.85 };
  if (modo === 'livre') {
    estilo.dashArray = `${pesoLinha * 2}, ${pesoLinha * 2}`;
  }
  return estilo;
}

function criarMarcador(coordenada, modo, indice, tamanho) {
  const marcador = L.marker([coordenada.lat, coordenada.lng], {
    icon: criarIconePonto(modo, tamanho),
    draggable: true,
    keyboard: true,
    title: `Ponto ${indice + 1}`,
    alt: `Ponto ${indice + 1} da rota`,
    riseOnHover: true,
  }).addTo(getMap());

  marcador.on('dragend', () => {
    const posicao = marcador.getLatLng();
    aoArrastarPonto(indice, { lat: posicao.lat, lng: posicao.lng });
  });

  return marcador;
}

function criarLinha(segmento, modo, indice, pesoLinha) {
  const linha = L.polyline(segmento, estiloLinha(modo, pesoLinha)).addTo(getMap());

  linha.on('contextmenu', (evento) => {
    L.DomEvent.stopPropagation(evento);
    aoInserirPonto(indice, { lat: evento.latlng.lat, lng: evento.latlng.lng });
  });

  return linha;
}

function removerCamadas() {
  const mapa = getMap();
  camadasMarcadores.forEach((marcador) => marcador && mapa.removeLayer(marcador));
  camadasLinhas.forEach((linha) => linha && mapa.removeLayer(linha));
  marcadoresKm.forEach((marcador) => mapa.removeLayer(marcador));

  camadasMarcadores = [];
  camadasLinhas = [];
  marcadoresKm = [];
}

/**
 * Reconstrói todas as camadas a partir do estado.
 * @param {Object} estado
 */
export function redesenhar(estado) {
  if (!estado) return;

  ultimoEstado = estado;
  removerCamadas();

  const { pesoLinha, tamanhoMarcador, tamanhoFonteKm } = obterEstilosDinamicos();
  const coordenadas = Array.isArray(estado.coordenadasNiveis) ? estado.coordenadasNiveis : [];
  const segmentos = Array.isArray(estado.segmentosRota) ? estado.segmentosRota : [];
  const modos = Array.isArray(estado.modosTraco) ? estado.modosTraco : [];

  camadasLinhas = new Array(coordenadas.length).fill(null);

  coordenadas.forEach((coordenada, indice) => {
    camadasMarcadores.push(
      criarMarcador(coordenada, modos[indice] || 'rua', indice, tamanhoMarcador),
    );

    if (indice === 0) return;

    const segmento = segmentos[indice];
    if (!Array.isArray(segmento) || segmento.length < 2) return;

    camadasLinhas[indice] = criarLinha(segmento, modos[indice] || 'rua', indice, pesoLinha);
  });

  for (const marcador of calcularMarcadoresKm(segmentos)) {
    const icone = criarIconeKm(marcador.km, tamanhoMarcador, tamanhoFonteKm);
    const camada = L.marker([marcador.lat, marcador.lng], {
      icon: icone,
      interactive: false,
      keyboard: false,
    }).addTo(getMap());
    camada._km = marcador.km;
    marcadoresKm.push(camada);
  }

  atualizarEstatisticas(estado);
}

/**
 * Atualiza apenas espessuras/tamanhos no zoom, sem recriar as camadas.
 */
export function atualizarEstilos() {
  if (!ultimoEstado) return;

  const { pesoLinha, tamanhoMarcador, tamanhoFonteKm } = obterEstilosDinamicos();
  const modos = ultimoEstado.modosTraco || [];

  camadasLinhas.forEach((linha, indice) => {
    if (!linha) return;
    linha.setStyle({
      weight: pesoLinha,
      dashArray: modos[indice] === 'livre' ? `${pesoLinha * 2}, ${pesoLinha * 2}` : null,
    });
  });

  camadasMarcadores.forEach((marcador, indice) => {
    if (!marcador) return;
    marcador.setIcon(criarIconePonto(modos[indice] || 'rua', tamanhoMarcador));
  });

  for (const marcador of marcadoresKm) {
    marcador.setIcon(criarIconeKm(marcador._km, tamanhoMarcador, tamanhoFonteKm));
  }
}
