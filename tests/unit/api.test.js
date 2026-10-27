import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarRota, getTotalRequisicoes, obterSnap } from '../../public/js/services/api.js';

function respostaJson(corpo, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  };
}

const geojson = {
  features: [
    {
      geometry: {
        coordinates: [
          [-52.1, -32.03, 5],
          [-52.11, -32.04, 6],
        ],
      },
    },
  ],
};

describe('services/api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('modo livre não faz requisição', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const rota = await buscarRota({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { modoLivre: true });
    expect(rota).toEqual([
      [1, 2, 0],
      [3, 4, 0],
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('converte [lon,lat] em [lat,lng] e conta a requisição', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(geojson)));
    const antes = getTotalRequisicoes();

    const rota = await buscarRota({ lat: -32.03, lng: -52.1 }, { lat: -32.04, lng: -52.11 });

    expect(rota).toEqual([
      [-32.03, -52.1, 5],
      [-32.04, -52.11, 6],
    ]);
    expect(getTotalRequisicoes()).toBe(antes + 1);
  });

  it('retorna null em erro 400 sem retentativa', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaJson({ erro: 'x' }, 400));
    vi.stubGlobal('fetch', fetchMock);

    const rota = await buscarRota({ lat: -32.03, lng: -52.1 }, { lat: -32.04, lng: -52.11 });
    expect(rota).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('snap silencioso não incrementa o contador', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(geojson)));
    const antes = getTotalRequisicoes();

    const snap = await obterSnap({ lat: -32.03, lng: -52.1 });
    expect(snap).toEqual({ lat: -32.03, lng: -52.1 });
    expect(getTotalRequisicoes()).toBe(antes);
  });

  it('ignora entradas inválidas', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await buscarRota({ lat: 999, lng: 0 }, { lat: 0, lng: 0 })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
