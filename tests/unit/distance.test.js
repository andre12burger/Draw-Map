import { describe, expect, it } from 'vitest';
import {
  calcularDistanciaTotal,
  calcularMarcadoresKm,
  calcularMetricas,
  distanciaMetros,
} from '../../public/js/map/distance.js';

const METROS_POR_GRAU_EQUADOR = 111_319.49;

function pontoPorMetros(metros) {
  return [0, metros / METROS_POR_GRAU_EQUADOR];
}

function segmentoDeMetros(metros, inicioEmGraus = 0) {
  const delta = metros / METROS_POR_GRAU_EQUADOR;
  return [
    [0, inicioEmGraus],
    [0, inicioEmGraus + delta],
  ];
}

describe('distance', () => {
  it('calcula distância de um grau no equador com tolerância', () => {
    const distancia = distanciaMetros([0, 0], [0, 1]);
    expect(distancia).toBeGreaterThan(111_000);
    expect(distancia).toBeLessThan(111_500);
  });

  it('ignora coordenadas inválidas', () => {
    expect(distanciaMetros([0, 0], [999, 999])).toBe(0);
    expect(distanciaMetros(null, [0, 0])).toBe(0);
    expect(calcularDistanciaTotal(null)).toBe(0);
  });

  it('cria marcadores de km em um único segmento longo', () => {
    const marcadores = calcularMarcadoresKm([segmentoDeMetros(3_200)]);
    expect(marcadores.map((m) => m.km)).toEqual([1, 2, 3]);
  });

  it('cria marcadores em vários segmentos de 1,55 km (1..6)', () => {
    const segmentos = [];
    for (let i = 0; i < 4; i += 1) {
      segmentos.push(segmentoDeMetros(1_550, i * (1_550 / METROS_POR_GRAU_EQUADOR)));
    }

    const marcadores = calcularMarcadoresKm(segmentos);
    expect(marcadores.map((m) => m.km)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(marcadores[0].lng).toBeGreaterThan(0);
  });

  it('não entra em loop com trechos de distância zero', () => {
    const marcadores = calcularMarcadoresKm([
      [
        [0, 0],
        [0, 0],
      ],
    ]);
    expect(marcadores).toEqual([]);
  });

  it('respeita o limite máximo de marcadores', () => {
    const marcadores = calcularMarcadoresKm([segmentoDeMetros(10_000)], {
      maxMarcadores: 2,
    });
    expect(marcadores).toHaveLength(2);
  });

  it('retorna métricas consolidadas', () => {
    const metricas = calcularMetricas([segmentoDeMetros(2_100)]);
    expect(metricas.totalMetros).toBeGreaterThan(2_000);
    expect(metricas.totalKm).toBeCloseTo(metricas.totalMetros / 1000, 5);
    expect(metricas.marcadores.map((m) => m.km)).toEqual([1, 2]);
    expect(pontoPorMetros(1_000)[1]).toBeGreaterThan(0);
  });
});
