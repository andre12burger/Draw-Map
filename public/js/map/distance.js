/**
 * @file map/distance.js
 * @description Cálculos geodésicos puros (sem Leaflet), permitindo testes unitários.
 * Usa a fórmula de Haversine com o raio médio da Terra.
 */

const RAIO_TERRA_METROS = 6_371_008.8;

function paraRadiano(graus) {
  return (graus * Math.PI) / 180;
}

function coordenadaValida(ponto) {
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
 * Distância em metros entre dois pontos [lat, lng].
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @returns {number}
 */
export function distanciaMetros(a, b) {
  if (!coordenadaValida(a) || !coordenadaValida(b)) return 0;

  const lat1 = paraRadiano(Number(a[0]));
  const lat2 = paraRadiano(Number(b[0]));
  const deltaLat = lat2 - lat1;
  const deltaLng = paraRadiano(Number(b[1]) - Number(a[1]));

  const h =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return 2 * RAIO_TERRA_METROS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Soma a distância de todos os segmentos.
 * @param {Array<Array<[number, number]>>} segmentosRota
 * @returns {number} distância em metros
 */
export function calcularDistanciaTotal(segmentosRota) {
  if (!Array.isArray(segmentosRota)) return 0;

  let total = 0;
  for (const segmento of segmentosRota) {
    if (!Array.isArray(segmento)) continue;
    for (let i = 1; i < segmento.length; i += 1) {
      total += distanciaMetros(segmento[i - 1], segmento[i]);
    }
  }
  return total;
}

/**
 * Distribui marcadores a cada `intervaloMetros`, inclusive quando um único
 * segmento cruza vários quilômetros (o bug do `if` simples foi substituído por `while`).
 * @param {Array<Array<[number, number]>>} segmentosRota
 * @param {{intervaloMetros?:number, maxMarcadores?:number}} [opcoes]
 * @returns {Array<{km:number, lat:number, lng:number}>}
 */
export function calcularMarcadoresKm(
  segmentosRota,
  { intervaloMetros = 1000, maxMarcadores = 500 } = {},
) {
  if (!Array.isArray(segmentosRota) || intervaloMetros <= 0) return [];

  const marcadores = [];
  let acumulado = 0;
  let proximoKm = 1;

  for (const segmento of segmentosRota) {
    if (!Array.isArray(segmento)) continue;

    for (let i = 1; i < segmento.length; i += 1) {
      const inicio = segmento[i - 1];
      const fim = segmento[i];
      const distancia = distanciaMetros(inicio, fim);
      if (distancia <= 0) continue;

      while (
        acumulado + distancia >= proximoKm * intervaloMetros &&
        marcadores.length < maxMarcadores
      ) {
        const alvo = proximoKm * intervaloMetros;
        const proporcao = (alvo - acumulado) / distancia;

        marcadores.push({
          km: proximoKm,
          lat: Number(inicio[0]) + (Number(fim[0]) - Number(inicio[0])) * proporcao,
          lng: Number(inicio[1]) + (Number(fim[1]) - Number(inicio[1])) * proporcao,
        });

        proximoKm += 1;
      }

      acumulado += distancia;
    }
  }

  return marcadores;
}

/**
 * @param {Array<Array<[number, number]>>} segmentosRota
 * @returns {{totalMetros:number, totalKm:number, marcadores:Array<{km:number,lat:number,lng:number}>}}
 */
export function calcularMetricas(segmentosRota) {
  const totalMetros = calcularDistanciaTotal(segmentosRota);
  return {
    totalMetros,
    totalKm: totalMetros / 1000,
    marcadores: calcularMarcadoresKm(segmentosRota),
  };
}
