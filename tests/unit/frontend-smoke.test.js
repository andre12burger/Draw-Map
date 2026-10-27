import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('frontend smoke (jsdom)', () => {
  it('inicializa e permite desenhar, limpar e desfazer', async () => {
    const html = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
    const corpo = html.match(/<body>([\s\S]*)<\/body>/i)?.[1] ?? '';
    document.body.innerHTML = corpo.replace(/<script[\s\S]*?<\/script>/gi, '');

    const leaflet = await import('leaflet');
    globalThis.L = leaflet.default ?? leaflet;
    window.L = globalThis.L;

    // O jsdom não implementa createSVGRect; habilitamos o renderer SVG para o teste.
    globalThis.L.Browser.svg = true;
    window.localStorage.clear();

    await expect(import('../../public/js/main.js')).resolves.toBeDefined();

    const mapa = document.getElementById('map');
    expect(mapa.classList.contains('leaflet-container')).toBe(true);
    expect(document.getElementById('contador-pontos').textContent).toBe('0');
    expect(document.getElementById('distancia-total').textContent).toBe('0.00');
    expect(document.getElementById('input-nome-rota').value).toBe('Strava Art Route');
    expect(document.querySelector('[data-ferramenta="rua"]').getAttribute('aria-pressed')).toBe(
      'true',
    );

    const { getMap } = await import('../../public/js/map/map.js');
    const instancia = getMap();
    const clicar = (lat, lng) =>
      instancia.fire('click', {
        latlng: globalThis.L.latLng(lat, lng),
        originalEvent: { shiftKey: true },
      });

    clicar(-32.03, -52.1);
    await vi.waitFor(() =>
      expect(document.getElementById('contador-pontos').textContent).toBe('1'),
    );

    clicar(-32.04, -52.11);
    await vi.waitFor(() =>
      expect(document.getElementById('contador-pontos').textContent).toBe('2'),
    );
    expect(Number(document.getElementById('distancia-total').textContent)).toBeGreaterThan(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    await vi.waitFor(() =>
      expect(document.getElementById('contador-pontos').textContent).toBe('1'),
    );

    document.getElementById('btn-limpar').click();
    await vi.waitFor(() =>
      expect(document.getElementById('contador-pontos').textContent).toBe('0'),
    );

    // Desfazer o "apagar" restaura o estado imediatamente anterior (1 ponto).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    await vi.waitFor(() =>
      expect(document.getElementById('contador-pontos').textContent).toBe('1'),
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    await vi.waitFor(() =>
      expect(document.getElementById('contador-pontos').textContent).toBe('0'),
    );
  });
});
