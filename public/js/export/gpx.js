/**
 * @file export/gpx.js
 * @description Geração e download de GPX 1.1. A função `gerarGPX` é pura e
 * testável; elevação, metadados XML e escape de caracteres são tratados.
 */

import { atualizarEstado, getCampo, getEstado } from '../core/state.js';
import { NOME_ROTA_PADRAO } from '../core/persistence.js';
import { mostrarToast } from '../ui/toast.js';

/**
 * @param {unknown} valor
 * @returns {string}
 */
export function escaparXml(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * @param {unknown} valor
 * @returns {string}
 */
export function formatarCoordenada(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '0';
  if (numero === 0) return '0';
  return numero.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
}

function nomeNormalizado(nome) {
  const texto = String(nome ?? '')
    .trim()
    .slice(0, 80);
  return texto.length > 0 ? texto : NOME_ROTA_PADRAO;
}

/**
 * Gera o XML GPX 1.1. Retorna null quando há menos de dois pontos únicos.
 * @param {{segmentosRota?:Array, nomeRota?:string}} estado
 * @param {{nome?:string, geradoEm?:string}} [opcoes]
 * @returns {string|null}
 */
export function gerarGPX(estado, { nome, geradoEm = new Date().toISOString() } = {}) {
  const segmentos = Array.isArray(estado?.segmentosRota) ? estado.segmentosRota : [];
  const pontos = [];

  for (const segmento of segmentos) {
    if (!Array.isArray(segmento)) continue;
    for (const ponto of segmento) {
      if (!Array.isArray(ponto) || ponto.length < 2) continue;
      const lat = Number(ponto[0]);
      const lng = Number(ponto[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const anterior = pontos[pontos.length - 1];
      if (anterior && anterior[0] === lat && anterior[1] === lng) continue;

      const ele = Number(ponto[2]);
      pontos.push(Number.isFinite(ele) ? [lat, lng, ele] : [lat, lng]);
    }
  }

  if (pontos.length < 2) return null;

  const titulo = escaparXml(nomeNormalizado(nome ?? estado?.nomeRota));
  const horario = Number.isNaN(Date.parse(geradoEm))
    ? new Date().toISOString()
    : new Date(geradoEm).toISOString();

  const linhas = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Strava Art Generator"',
    '     xmlns="http://www.topografix.com/GPX/1/1"',
    '     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    '  <metadata>',
    `    <name>${titulo}</name>`,
    '    <desc>Rota de GPS Art gerada pelo Strava Art Generator</desc>',
    `    <time>${horario}</time>`,
    '  </metadata>',
    '  <trk>',
    `    <name>${titulo}</name>`,
    '    <type>running</type>',
    '    <trkseg>',
  ];

  for (const ponto of pontos) {
    const eleTag = ponto.length > 2 ? `<ele>${Number(ponto[2]).toFixed(1)}</ele>` : '';
    linhas.push(
      `      <trkpt lat="${formatarCoordenada(ponto[0])}" lon="${formatarCoordenada(ponto[1])}">${eleTag}</trkpt>`,
    );
  }

  linhas.push('    </trkseg>', '  </trk>', '</gpx>');
  return `${linhas.join('\n')}\n`;
}

/**
 * @param {string} nome
 * @returns {string}
 */
export function nomeArquivo(nome) {
  const base = String(nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

  return `${base || 'strava_art'}.gpx`;
}

/**
 * @param {string} texto
 * @param {string} arquivo
 */
export function baixarGPX(texto, arquivo) {
  const blob = new Blob([texto], { type: 'application/gpx+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = arquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function inicializarExportacao() {
  const botao = document.getElementById('btn-exportar');
  const inputNome = document.getElementById('input-nome-rota');
  if (!botao) return;

  if (inputNome) {
    inputNome.value = getCampo('nomeRota') || NOME_ROTA_PADRAO;
    inputNome.addEventListener('change', () => {
      const nome = inputNome.value.trim() || NOME_ROTA_PADRAO;
      inputNome.value = nome;
      atualizarEstado({ nomeRota: nome }, { registrarHistorico: false });
    });
  }

  botao.addEventListener('click', () => {
    const estado = getEstado();
    const nome = inputNome?.value.trim() || estado.nomeRota;
    const gpx = gerarGPX(estado, { nome });

    if (!gpx) {
      mostrarToast('Desenhe pelo menos dois pontos antes de exportar.', {
        tipo: 'aviso',
      });
      return;
    }

    baixarGPX(gpx, nomeArquivo(nome));
    mostrarToast('Ficheiro GPX gerado com sucesso.', { tipo: 'sucesso' });
  });
}
