import { describe, expect, it } from 'vitest';
import servidor from '../../server/lib/geo.js';
import * as cliente from '../../public/js/core/geo.js';

/** Gerador determinístico (LCG) para comparar as duas implementações. */
function criarAleatorio(semente = 42) {
  let estado = semente;
  return () => {
    estado = (estado * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return estado / 4_294_967_296;
  };
}

function pontosAleatorios(quantidade, aleatorio) {
  const baseLat = -32.03 + aleatorio() * 0.02;
  const baseLng = -52.1 + aleatorio() * 0.02;
  return Array.from({ length: quantidade }, (_, i) => [
    baseLat + Math.sin(i / 3) * 0.001 + aleatorio() * 0.0005,
    baseLng + i * 0.00008 + aleatorio() * 0.0005,
  ]);
}

function arredondar(valor) {
  return Number(valor.toFixed(9));
}

function normalizarPontos(pontos) {
  return pontos.map(([lat, lng]) => [arredondar(lat), arredondar(lng)]);
}

describe('paridade server/lib/geo ↔ public/js/core/geo', () => {
  it('funções escalares devolvem o mesmo resultado', () => {
    const aleatorio = criarAleatorio(7);
    const a = [-32.03 + aleatorio() * 0.01, -52.1 + aleatorio() * 0.01];
    const b = [-32.03 + aleatorio() * 0.01, -52.1 + aleatorio() * 0.01];
    const p = [-32.03 + aleatorio() * 0.01, -52.1 + aleatorio() * 0.01];

    expect(cliente.haversine(a, b)).toBeCloseTo(servidor.haversine(a, b), 9);
    expect(cliente.totalLength([a, b, p])).toBeCloseTo(servidor.totalLength([a, b, p]), 9);
    expect(cliente.perpendicularDistance(p, a, b)).toBeCloseTo(
      servidor.perpendicularDistance(p, a, b),
      9,
    );
    expect(cliente.normalizarRotacao(-123.4)).toBe(servidor.normalizarRotacao(-123.4));
    expect(cliente.normalizarRotacao(987)).toBe(servidor.normalizarRotacao(987));
  });

  it('simplificação e reamostragem produzem as mesmas sequências', () => {
    const aleatorio = criarAleatorio(11);
    const pontos = pontosAleatorios(120, aleatorio);

    expect(normalizarPontos(cliente.douglasPeucker(pontos, 8))).toEqual(
      normalizarPontos(servidor.douglasPeucker(pontos, 8)),
    );
    expect(normalizarPontos(cliente.resample(pontos, 60))).toEqual(
      normalizarPontos(servidor.resample(pontos, 60)),
    );
    expect(normalizarPontos(cliente.simplifyTrace(pontos))).toEqual(
      normalizarPontos(servidor.simplifyTrace(pontos)),
    );
    expect(normalizarPontos(cliente.simplifyToCount(pontos, 15))).toEqual(
      normalizarPontos(servidor.simplifyToCount(pontos, 15)),
    );
    expect(normalizarPontos(cliente.sampleShapeWaypoints(pontos, 12))).toEqual(
      normalizarPontos(servidor.sampleShapeWaypoints(pontos, 12)),
    );
  });

  it('splines, projeção de formas e bounds coincidem', () => {
    const aleatorio = criarAleatorio(23);
    const p0 = [aleatorio(), aleatorio()];
    const p1 = [aleatorio(), aleatorio()];
    const p2 = [aleatorio(), aleatorio()];
    const p3 = [aleatorio(), aleatorio()];

    expect(cliente.catmullRom(p0, p1, p2, p3, 0.37, 0.6)).toEqual(
      servidor.catmullRom(p0, p1, p2, p3, 0.37, 0.6),
    );

    const forma = {
      points: [
        [0.1, 0.2],
        [0.9, 0.2],
        [0.9, 0.8],
        [0.1, 0.8],
        [0.1, 0.2],
      ],
      type: 'polygon',
      closed: true,
      aspectRatio: 1.4,
    };
    const centro = [-32.03, -52.1];

    expect(
      normalizarPontos(cliente.projectShape(forma, centro, 1800, 33, { scaleX: 1.2, scaleY: 0.8 })),
    ).toEqual(
      normalizarPontos(
        servidor.projectShape(forma, centro, 1800, 33, { scaleX: 1.2, scaleY: 0.8 }),
      ),
    );

    expect(cliente.calcularBbox(forma.points)).toEqual(servidor.calcularBbox(forma.points));

    const boundsCliente = cliente.calcularBoundsImagem(centro, 2500, 1.7, 20);
    const boundsServidor = servidor.calcularBoundsImagem(centro, 2500, 1.7, 20);
    for (const chave of ['south', 'west', 'north', 'east']) {
      expect(boundsCliente[chave]).toBeCloseTo(boundsServidor[chave], 9);
    }
  });

  it('projectShape normaliza aspeto zero/inválido da mesma forma', () => {
    const forma = { points: [[1, 0.5]], type: 'polyline', aspectRatio: 0 };
    const centro = [0, 0];

    expect(normalizarPontos(cliente.projectShape(forma, centro, 1000))).toEqual(
      normalizarPontos(servidor.projectShape(forma, centro, 1000)),
    );
  });
});
