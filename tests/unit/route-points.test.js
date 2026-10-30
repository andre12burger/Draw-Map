import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import criarApp from '../../server/app.js';

const fetchReal = globalThis.fetch;
let servidor;
let baseUrl;
let modoUpstream = 'ok';
let chamadasUpstream = 0;

function responderUpstream(url) {
  if (modoUpstream === 'erro400') {
    return { ok: false, status: 400, text: async () => '{}' };
  }
  if (modoUpstream === 'erro500') {
    return { ok: false, status: 500, text: async () => '{}' };
  }

  const parametros = new URL(String(url)).searchParams;
  const coordenadas = (parametros.get('lonlats') || '')
    .split('|')
    .map((par) => par.split(',').map(Number));

  if (modoUpstream === 'geometria-invalida') {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ features: [{ geometry: { coordinates: [] } }] }),
    };
  }

  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        features: [
          {
            geometry: { coordinates: coordenadas },
            properties: { 'track-length': '111', 'total-time': '42' },
          },
        ],
      }),
  };
}

async function pedir(corpo, { bruto = false } = {}) {
  const resposta = await fetchReal(`${baseUrl}/api/route-points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bruto ? corpo : JSON.stringify(corpo),
  });

  return {
    status: resposta.status,
    cache: resposta.headers.get('x-cache'),
    corpo: await resposta.json(),
  };
}

beforeAll(async () => {
  globalThis.fetch = vi.fn(async (url) => {
    chamadasUpstream += 1;
    return responderUpstream(url);
  });

  servidor = criarApp().listen(0);
  await new Promise((resolver) => servidor.once('listening', resolver));
  baseUrl = `http://127.0.0.1:${servidor.address().port}`;
});

afterAll(async () => {
  globalThis.fetch = fetchReal;
  await new Promise((resolver) => servidor.close(resolver));
});

beforeEach(() => {
  modoUpstream = 'ok';
  chamadasUpstream = 0;
});

describe('POST /api/route-points', () => {
  it('roteia múltiplas pernas e concatena a geometria', async () => {
    const resposta = await pedir({
      points: [
        [-32.031, -52.101],
        [-32.0315, -52.1015],
        [-32.032, -52.102],
      ],
      profile: 'bike',
    });

    expect(resposta.status).toBe(200);
    expect(resposta.cache).toBe('MISS');
    expect(resposta.corpo.coordinates).toEqual([
      [-32.031, -52.101],
      [-32.0315, -52.1015],
      [-32.032, -52.102],
    ]);
    expect(resposta.corpo.distance_m).toBe(222);
    expect(resposta.corpo.duration_s).toBe(84);
    expect(resposta.corpo.profile).toBe('fastbike');
    expect(resposta.corpo.legs).toHaveLength(2);
    expect(resposta.corpo.snapped_waypoints).toEqual([
      [-32.031, -52.101],
      [-32.0315, -52.1015],
      [-32.032, -52.102],
    ]);
    expect(chamadasUpstream).toBe(2);
  });

  it('serve a segunda chamada a partir do cache de 500 entradas', async () => {
    const corpo = {
      points: [
        [-32.041, -52.111],
        [-32.0415, -52.1115],
        [-32.042, -52.112],
      ],
    };

    const primeira = await pedir(corpo);
    const segunda = await pedir(corpo);

    expect(primeira.cache).toBe('MISS');
    expect(segunda.cache).toBe('HIT');
    expect(segunda.corpo).toEqual(primeira.corpo);
    expect(chamadasUpstream).toBe(2);
  });

  it('mapeia o perfil foot para hiking-beta', async () => {
    const resposta = await pedir({
      points: [
        [-32.051, -52.121],
        [-32.0515, -52.1215],
      ],
      profile: 'foot',
    });

    expect(resposta.status).toBe(200);
    expect(resposta.corpo.profile).toBe('hiking-beta');
  });

  it('rejeita listas fora de 2–25 pontos', async () => {
    const umPonto = await pedir({ points: [[-32.061, -52.131]] });
    expect(umPonto.status).toBe(400);

    const muitosPontos = await pedir({
      points: Array.from({ length: 26 }, (_, i) => [-32.06 + i * 0.0001, -52.13]),
    });
    expect(muitosPontos.status).toBe(400);
  });

  it('rejeita pernas acima de 8000 m', async () => {
    const resposta = await pedir({
      points: [
        [-32.07, -52.14],
        [-32.2, -52.14],
      ],
    });

    expect(resposta.status).toBe(422);
    expect(resposta.corpo.erro).toContain('8000');
  });

  it('rejeita perfis desconhecidos', async () => {
    const resposta = await pedir({
      points: [
        [-32.08, -52.15],
        [-32.0805, -52.1505],
      ],
      profile: 'carro',
    });

    expect(resposta.status).toBe(400);
    expect(resposta.corpo.erro).toContain('Perfil inválido');
  });

  it('mapeia 4xx do upstream para 422', async () => {
    modoUpstream = 'erro400';
    const resposta = await pedir({
      points: [
        [-32.09, -52.16],
        [-32.0905, -52.1605],
      ],
    });

    expect(resposta.status).toBe(422);
  });

  it('mapeia 5xx do upstream para 502', async () => {
    modoUpstream = 'erro500';
    const resposta = await pedir({
      points: [
        [-32.1, -52.17],
        [-32.1005, -52.1705],
      ],
    });

    expect(resposta.status).toBe(502);
  });

  it('devolve 502 quando a geometria é inválida', async () => {
    modoUpstream = 'geometria-invalida';
    const resposta = await pedir({
      points: [
        [-32.11, -52.18],
        [-32.1105, -52.1805],
      ],
    });

    expect(resposta.status).toBe(502);
  });

  it('devolve 400 para JSON malformado', async () => {
    const resposta = await pedir('{"points": [', { bruto: true });
    expect(resposta.status).toBe(400);
  });
});
