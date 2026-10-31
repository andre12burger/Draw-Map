import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Fluxo completo em jsdom: index.html real → main.js → barra inferior →
 * Auto-Fit (fetch mockado) → linha vermelha → “Use this route” → GPX.
 * Cobre a fiação que o E2E cobre no navegador, sem depender de Chromium.
 */
describe('fluxo Shape de ponta a ponta (jsdom)', () => {
  beforeAll(async () => {
    const html = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
    const corpo = html.match(/<body>([\s\S]*)<\/body>/i)?.[1] ?? '';
    document.body.innerHTML = corpo.replace(/<script[\s\S]*?<\/script>/gi, '');

    const leaflet = await import('leaflet');
    globalThis.L = leaflet.default ?? leaflet;
    globalThis.L.Browser.svg = true;
    window.localStorage.clear();
  });

  it('cria o molde, encaixa nas ruas e incorpora a rota ao GPX', async () => {
    const pedidos = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, opcoes = {}) => {
        if (String(url).includes('/api/route-points')) {
          const corpo = JSON.parse(opcoes.body);
          pedidos.push(corpo);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              coordinates: corpo.points.map(([lat, lng]) => [lat, lng, 0]),
            }),
          };
        }

        return { ok: false, status: 404, json: async () => ({ erro: 'não mockado' }) };
      }),
    );

    await import('../../public/js/main.js');

    document.querySelector('[data-ferramenta="forma"]').click();

    expect(document.getElementById('painel-forma').hidden).toBe(false);
    expect(document.getElementById('painel-rota').hidden).toBe(true);

    await vi.waitFor(() => expect(document.getElementById('btn-usar-rota').disabled).toBe(false), {
      timeout: 4000,
      interval: 50,
    });

    expect(pedidos.length).toBeGreaterThan(0);
    expect(pedidos[0].profile).toBe('bike');
    expect(pedidos[0].points.length).toBeGreaterThanOrEqual(6);
    expect(pedidos[0].points.length).toBeLessThanOrEqual(25);

    const { getMap } = await import('../../public/js/map/map.js');
    let camadaRota = null;
    getMap().eachLayer((camada) => {
      if (camada.options?.className === 'rota-forma') camadaRota = camada;
    });

    expect(camadaRota).not.toBeNull();
    expect(camadaRota.getLatLngs().length).toBe(pedidos[0].points.length);

    document.getElementById('btn-usar-rota').click();

    await vi.waitFor(
      () => expect(document.getElementById('contador-pontos').textContent).toBe('2'),
      { timeout: 4000, interval: 50 },
    );

    expect(document.getElementById('painel-forma').hidden).toBe(true);
    expect(document.getElementById('painel-rota').hidden).toBe(false);
    expect(document.querySelector('[data-ferramenta="rua"]').getAttribute('aria-pressed')).toBe(
      'true',
    );

    const { getForma } = await import('../../public/js/map/shapes.js');
    const { getEstado } = await import('../../public/js/core/state.js');

    expect(getForma('forma-ativa')).toBeNull();

    const estado = getEstado();
    expect(estado.coordenadasNiveis).toHaveLength(2);
    expect(estado.segmentosRota[1].length).toBe(pedidos[0].points.length);
    expect(estado.distanciaTotal).toBeGreaterThan(0);
  });
});
