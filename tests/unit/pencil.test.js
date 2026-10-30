import { describe, expect, it } from 'vitest';
import {
  CONFIG_LAPIS,
  prepararAlcas,
  prepararPontosEstrategicos,
} from '../../public/js/map/pencil.js';
import { haversine, reconstruirAlcas } from '../../public/js/core/geo.js';

function linhaOndulada(quantidade = 300) {
  return Array.from({ length: quantidade }, (_, i) => ({
    lat: -32.03 + Math.sin(i / 12) * 0.000004,
    lng: -52.1 + i * 0.000015,
  }));
}

describe('map/pencil — simplificação métrica', () => {
  it('reduz o traço e respeita o passo máximo de densificação', () => {
    const pontos = linhaOndulada();
    const estrategicos = prepararPontosEstrategicos(pontos);

    expect(estrategicos.length).toBeGreaterThanOrEqual(2);
    expect(estrategicos.length).toBeLessThan(pontos.length);
    expect(estrategicos.length).toBeLessThanOrEqual(CONFIG_LAPIS.maxPontosEstrategicos);

    for (let i = 1; i < estrategicos.length; i += 1) {
      const distancia = haversine(
        [estrategicos[i - 1].lat, estrategicos[i - 1].lng],
        [estrategicos[i].lat, estrategicos[i].lng],
      );
      expect(distancia).toBeLessThanOrEqual(CONFIG_LAPIS.passoMaximoMetros + 0.5);
    }
  });

  it('preserva os extremos e aceita tolerância explícita', () => {
    const pontos = linhaOndulada(60);
    const estrategicos = prepararPontosEstrategicos(pontos, { toleranciaMetros: 30 });

    expect(estrategicos[0].lat).toBeCloseTo(pontos[0].lat, 6);
    expect(estrategicos[0].lng).toBeCloseTo(pontos[0].lng, 6);
    expect(estrategicos[estrategicos.length - 1].lng).toBeCloseTo(pontos[pontos.length - 1].lng, 6);
  });

  it('devolve lista vazia para entradas insuficientes ou inválidas', () => {
    expect(prepararPontosEstrategicos([])).toEqual([]);
    expect(prepararPontosEstrategicos([{ lat: 1, lng: 2 }])).toEqual([]);
    expect(
      prepararPontosEstrategicos([
        { lat: 'x', lng: 2 },
        { lat: 1, lng: 2 },
      ]),
    ).toEqual([]);
  });
});

describe('map/pencil — reconstrução de alças (ek)', () => {
  it('preserva esquinas com viragem ≥ 55° mesmo abaixo da tolerância do DP', () => {
    const pontos = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.00009 },
      { lat: 0.00009, lng: 0.00009 },
      { lat: 0.00009, lng: 0.00018 },
    ];

    const alcas = prepararAlcas(pontos, { toleranceMeters: 12, minSpacingMeters: 8 });

    expect(alcas).toHaveLength(4);
    expect(alcas[1].lng).toBeCloseTo(0.00009, 7);
    expect(alcas[2].lat).toBeCloseTo(0.00009, 7);
  });

  it('respeita espaçamento mínimo de 8 m e o limite de 120 alças', () => {
    const pontos = linhaOndulada(4_000);
    const alcas = prepararAlcas(pontos);

    expect(alcas.length).toBeLessThanOrEqual(CONFIG_LAPIS.maxAlcas);

    for (let i = 1; i < alcas.length; i += 1) {
      const distancia = haversine(
        [alcas[i - 1].lat, alcas[i - 1].lng],
        [alcas[i].lat, alcas[i].lng],
      );
      expect(distancia).toBeGreaterThanOrEqual(CONFIG_LAPIS.espacamentoMinimoAlcasMetros - 0.01);
    }
  });

  it('aceita maxHandles personalizado e devolve pelo menos os extremos', () => {
    const alcas = prepararAlcas(linhaOndulada(500), { maxHandles: 8 });

    expect(alcas.length).toBeLessThanOrEqual(8);
    expect(alcas.length).toBeGreaterThanOrEqual(2);
  });

  it('remove pontos duplicados consecutivos', () => {
    const alcas = prepararAlcas([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
    ]);

    expect(alcas).toEqual([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
    ]);
  });

  it('bindings apontam para o índice original após remover duplicados', () => {
    const { handles, bindings } = reconstruirAlcas([
      [0, 0],
      [0, 0],
      [0, 0.00009],
      [0.00009, 0.00009],
      [0.00009, 0.00018],
      [0.00009, 0.00018],
    ]);

    expect(handles).toHaveLength(bindings.length);
    expect(bindings[0]).toBe(0);
    expect(bindings[bindings.length - 1]).toBe(4);

    for (let i = 1; i < bindings.length; i += 1) {
      expect(bindings[i]).toBeGreaterThan(bindings[i - 1]);
    }
  });
});
