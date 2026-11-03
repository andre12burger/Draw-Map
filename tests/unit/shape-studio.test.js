import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../public/js/services/api.js', () => ({
  buscarRota: vi.fn(),
  buscarRotaLote: vi.fn(),
  obterPontoRua: vi.fn(),
  rotearPontos: vi.fn(),
}));

vi.mock('../../public/js/ui/toast.js', () => ({
  mostrarToast: vi.fn(),
}));

import {
  abrirEstudioForma,
  ajustarForma,
  atualizarAlvo,
  calcularWaypointsDaForma,
  fecharEstudioForma,
  inicializarEstudioForma,
  perimetroDaForma,
  selecionarForma,
  usarRotaAtual,
} from '../../public/js/map/shape-studio.js';
import { getForma, limparFormas } from '../../public/js/map/shapes.js';
import { getMap } from '../../public/js/map/map.js';
import { rotearPontos } from '../../public/js/services/api.js';
import { getEstado, resetarEstado } from '../../public/js/core/state.js';

const CENTRO = { lat: -32.03, lng: -52.1 };

/** Rota fictícia: devolve os próprios waypoints como geometria encaixada. */
function rotaDosWaypoints(pontos) {
  return pontos.map(({ lat, lng }) => [lat, lng, 0]);
}

function painelForma() {
  return document.getElementById('painel-forma');
}

function camadaRota() {
  let encontrada = null;
  getMap().eachLayer((camada) => {
    if (camada.options?.className === 'rota-forma') encontrada = camada;
  });
  return encontrada;
}

function alca(titulo) {
  let encontrada = null;
  getMap().eachLayer((camada) => {
    if (camada.options?.title === titulo) encontrada = camada;
  });
  return encontrada;
}

describe('map/shape-studio — Auto-Fit e “Use this route”', () => {
  beforeAll(async () => {
    const html = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
    const corpo = html.match(/<body>([\s\S]*)<\/body>/i)?.[1] ?? '';
    document.body.innerHTML = corpo.replace(/<script[\s\S]*?<\/script>/gi, '');

    const leaflet = await import('leaflet');
    globalThis.L = leaflet.default ?? leaflet;
    globalThis.L.Browser.svg = true;
    getMap().setView([CENTRO.lat, CENTRO.lng], 15);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    resetarEstado();
    limparFormas();
    rotearPontos.mockReset();
    rotearPontos.mockImplementation(async (pontos) => rotaDosWaypoints(pontos));
    inicializarEstudioForma();
  });

  afterEach(() => {
    fecharEstudioForma();
    vi.useRealTimers();
  });

  it('amostra no máximo 25 waypoints e fecha o laço da forma', () => {
    abrirEstudioForma();
    const forma = getForma('forma-ativa');

    expect(forma).not.toBeNull();

    const waypoints = calcularWaypointsDaForma(forma);

    expect(waypoints.length).toBeGreaterThanOrEqual(6);
    expect(waypoints.length).toBeLessThanOrEqual(25);
    expect(waypoints[0]).toEqual(waypoints[waypoints.length - 1]);
    expect(perimetroDaForma(forma)).toBeGreaterThan(0);
    expect(painelForma().hidden).toBe(false);
    expect(document.getElementById('painel-rota').hidden).toBe(true);
  });

  it('envia os waypoints ao motor de rotas e habilita “Use this route”', async () => {
    abrirEstudioForma();

    const rota = await ajustarForma();

    expect(rota).not.toBeNull();
    expect(rotearPontos).toHaveBeenCalledTimes(1);

    const [pontos, opcoes] = rotearPontos.mock.calls[0];
    expect(pontos.length).toBeLessThanOrEqual(25);
    expect(pontos.length).toBeGreaterThanOrEqual(6);
    expect(opcoes.perfil).toBe('bike');

    expect(document.getElementById('btn-usar-rota').disabled).toBe(false);
    expect(document.getElementById('forma-distancia').textContent).toMatch(/km$/);
    expect(painelForma().dataset.estado).toBe('pronto');
  });

  it('usa o perfil configurado no estado (Walking → foot)', async () => {
    abrirEstudioForma();
    const { atualizarEstado } = await import('../../public/js/core/state.js');
    atualizarEstado({ perfilUi: 'foot', perfilRota: 'foot' }, { registrarHistorico: false });

    await ajustarForma();

    expect(rotearPontos.mock.calls.at(-1)[1].perfil).toBe('foot');
  });

  it('redimensiona o molde quando a distância alvo muda', () => {
    abrirEstudioForma();
    const antes = getForma('forma-ativa');
    const alvoMetade = perimetroDaForma(antes) / 1000 / 2;

    atualizarAlvo(alvoMetade);

    const depois = getForma('forma-ativa');
    expect(depois.size).toBeLessThan(antes.size);
    expect(depois.size).toBeGreaterThan(antes.size * 0.4);
    expect(depois.size).toBeLessThan(antes.size * 0.6);
  });

  it('troca a forma mantendo o centro', () => {
    abrirEstudioForma();
    const antes = getForma('forma-ativa');

    selecionarForma('hexagono');

    const depois = getForma('forma-ativa');
    expect(depois.shape.id).toBe('poligono');
    expect(depois.center.lat).toBeCloseTo(antes.center.lat, 6);
    expect(depois.center.lng).toBeCloseTo(antes.center.lng, 6);
  });

  it('esconde a rota durante o arrasto e só recalcula no dragend', async () => {
    abrirEstudioForma();
    await ajustarForma();
    expect(camadaRota()).not.toBeNull();

    const chamadas = rotearPontos.mock.calls.length;
    const marcador = alca('Mover forma');
    const inicial = marcador.getLatLng();

    marcador.fire('dragstart');
    expect(camadaRota()).toBeNull();
    expect(painelForma().dataset.estado).toBe('ajustando');
    expect(painelForma().classList.contains('calculando')).toBe(true);
    expect(painelForma().getAttribute('aria-busy')).toBe('true');
    expect(document.getElementById('btn-usar-rota').disabled).toBe(true);
    expect(rotearPontos).toHaveBeenCalledTimes(chamadas);

    marcador.setLatLng([inicial.lat + 0.001, inicial.lng + 0.001]);
    marcador.fire('drag');
    expect(rotearPontos).toHaveBeenCalledTimes(chamadas);

    marcador.fire('dragend');
    vi.advanceTimersByTime(60);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    expect(rotearPontos).toHaveBeenCalledTimes(chamadas + 1);
    expect(camadaRota()).not.toBeNull();
    expect(painelForma().dataset.estado).toBe('pronto');
    expect(painelForma().getAttribute('aria-busy')).toBe('false');
    expect(document.getElementById('btn-usar-rota').disabled).toBe(false);
  });

  it('“Use this route” injeta a rota no desenho e destrói o molde', async () => {
    const aoSair = vi.fn();
    inicializarEstudioForma({ aoSairDoModo: aoSair });
    abrirEstudioForma();
    const rota = await ajustarForma();

    const incorporada = await usarRotaAtual();

    expect(incorporada).toBe(true);
    expect(aoSair).toHaveBeenCalledTimes(1);

    const estado = getEstado();
    expect(estado.coordenadasNiveis).toHaveLength(2);
    expect(estado.segmentosRota[1].length).toBe(rota.length);
    expect(estado.modosTraco).toEqual(['rua', 'rua']);
    expect(estado.distanciaTotal).toBeGreaterThan(0);

    expect(getForma('forma-ativa')).toBeNull();
    expect(painelForma().hidden).toBe(true);
    expect(document.getElementById('painel-rota').hidden).toBe(false);
  });
});
