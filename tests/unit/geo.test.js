import { describe, expect, it } from 'vitest';
import geo from '../../server/lib/geo.js';

const PARIS = [48.8566, 2.3522];

describe('server/lib/geo — geodésia básica', () => {
  it('haversine mede 1° de latitude com o raio médio da Terra', () => {
    expect(geo.haversine([0, 0], [0, 1])).toBeCloseTo(111_194.93, 1);
    expect(geo.haversine([0, 0], [1, 0])).toBeCloseTo(111_194.93, 1);
    expect(geo.haversine([0, 0], [0, 0])).toBe(0);
  });

  it('haversine ignora entradas inválidas', () => {
    expect(geo.haversine([999, 0], [0, 0])).toBe(0);
    expect(geo.haversine(null, [0, 0])).toBe(0);
  });

  it('totalLength soma os segmentos', () => {
    const pontos = [
      [0, 0],
      [0, 1],
      [0, 2],
    ];
    expect(geo.totalLength(pontos)).toBeCloseTo(2 * 111_194.93, 0);
    expect(geo.totalLength([])).toBe(0);
  });

  it('perpendicularDistance usa projeção equiretangular local', () => {
    // 0.0009° a norte do equador ≈ 100 m
    const distancia = geo.perpendicularDistance([0.0009, 0.005], [0, 0], [0, 0.01]);
    expect(distancia).toBeCloseTo(100.2, 0);
  });

  it('perpendicularDistance limita ao extremo do segmento', () => {
    const distancia = geo.perpendicularDistance([0, 0.02], [0, 0], [0, 0.01]);
    expect(distancia).toBeCloseTo(1113.2, 0);
  });
});

describe('server/lib/geo — simplificação e reamostragem', () => {
  it('douglasPeucker remove pontos colineares e mantém esquinas', () => {
    const pontos = [
      [0, 0],
      [0, 0.001],
      [0, 0.002],
      [0.001, 0.002],
    ];
    const simplificado = geo.douglasPeucker(pontos, 5);

    expect(simplificado).toEqual([
      [0, 0],
      [0, 0.002],
      [0.001, 0.002],
    ]);
  });

  it('resample respeita o passo máximo e mantém os extremos', () => {
    const pontos = [
      [0, 0],
      [0, 0.01],
    ];
    const densos = geo.resample(pontos, 100);

    expect(densos[0]).toEqual([0, 0]);
    expect(densos[densos.length - 1]).toEqual([0, 0.01]);

    for (let i = 1; i < densos.length; i += 1) {
      expect(geo.haversine(densos[i - 1], densos[i])).toBeLessThanOrEqual(100.5);
    }
  });

  it('simplifyTrace adapta a tolerância e preserva os extremos', () => {
    const traco = [];
    for (let i = 0; i < 400; i += 1) {
      traco.push([0, i * 0.00002 + Math.sin(i / 10) * 0.000002]);
    }

    const simplificado = geo.simplifyTrace(traco);

    expect(simplificado.length).toBeLessThan(traco.length);
    expect(simplificado[0]).toEqual(traco[0]);
    expect(simplificado[simplificado.length - 1]).toEqual(traco[traco.length - 1]);
    expect(geo.totalLength(simplificado)).toBeGreaterThan(0);
  });

  it('simplifyToCount nunca excede o limite', () => {
    const pontos = Array.from({ length: 500 }, (_, i) => [0, i * 0.00001]);
    const reduzido = geo.simplifyToCount(pontos, 20);

    expect(reduzido.length).toBeLessThanOrEqual(20);
    expect(reduzido[0]).toEqual(pontos[0]);
    expect(reduzido[reduzido.length - 1]).toEqual(pontos[pontos.length - 1]);
  });
});

describe('server/lib/geo — formas e splines', () => {
  it('catmullRom devolve p1 em t=0 e p2 em t=1', () => {
    const p0 = [0, 0];
    const p1 = [1, 2];
    const p2 = [3, 4];
    const p3 = [5, 6];

    expect(geo.catmullRom(p0, p1, p2, p3, 0)).toEqual(p1);
    expect(geo.catmullRom(p0, p1, p2, p3, 1)).toEqual(p2);
  });

  it('suavizarCurva fecha formas repetindo o primeiro ponto', () => {
    const quadrado = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    const suave = geo.suavizarCurva(quadrado, 4, { fechada: true });

    expect(suave.length).toBe(4 * 4 + 1);
    expect(suave[0]).toEqual(quadrado[0]);
    expect(suave[suave.length - 1]).toEqual(quadrado[0]);
  });

  it('projectShape mantém a paridade com a fórmula trigonométrica', () => {
    const forma = { points: [[1, 0.5]], type: 'polyline' };
    const metrosPorGrauLng = 111_320 * Math.cos((PARIS[0] * Math.PI) / 180);

    const [semRotacao] = geo.projectShape(forma, PARIS, 2000, 0);
    expect(semRotacao[0]).toBeCloseTo(PARIS[0], 10);
    expect(semRotacao[1]).toBeCloseTo(PARIS[1] + 1000 / metrosPorGrauLng, 10);

    const [rodado90] = geo.projectShape(forma, PARIS, 2000, 90);
    expect(rodado90[0]).toBeCloseTo(PARIS[0] + 1000 / 111_320, 10);
    expect(rodado90[1]).toBeCloseTo(PARIS[1], 10);

    const rotacao = 217;
    const rad = (rotacao * Math.PI) / 180;
    const [rodado217] = geo.projectShape(forma, PARIS, 2000, rotacao);
    expect(rodado217[0]).toBeCloseTo(PARIS[0] + (1000 * Math.sin(rad)) / 111_320, 10);
    expect(rodado217[1]).toBeCloseTo(PARIS[1] + (1000 * Math.cos(rad)) / metrosPorGrauLng, 10);
  });

  it('projectShape aplica aspeto no eixo X e escala independente no eixo Y', () => {
    const forma = { points: [[1, 0.5]], type: 'polyline', aspectRatio: 2 };
    const metrosPorGrauLng = 111_320 * Math.cos((PARIS[0] * Math.PI) / 180);

    const [ponto] = geo.projectShape(forma, PARIS, 1000, 0);
    expect(ponto[1]).toBeCloseTo(PARIS[1] + 1000 / metrosPorGrauLng, 10);

    const [vertical] = geo.projectShape({ points: [[0.5, 0]], type: 'polyline' }, PARIS, 1000, 0, {
      scaleY: 0.5,
    });
    expect(vertical[0]).toBeCloseTo(PARIS[0] + 250 / 111_320, 10);
  });

  it('sampleShapeWaypoints devolve N pontos equidistantes com extremos', () => {
    const linha = [
      [0, 0],
      [0, 0.09],
    ];
    const amostras = geo.sampleShapeWaypoints(linha, 5);

    expect(amostras).toHaveLength(5);
    expect(amostras[0]).toEqual([0, 0]);
    expect(amostras[4]).toEqual([0, 0.09]);

    const passo = geo.haversine(amostras[0], amostras[1]);
    for (let i = 2; i < amostras.length; i += 1) {
      expect(geo.haversine(amostras[i - 1], amostras[i])).toBeCloseTo(passo, 0);
    }
  });

  it('fidelityMetrics devolve média, máximo e número de amostras', () => {
    const forma = geo.projectShape(
      {
        points: [
          [0.4, 0.5],
          [0.6, 0.5],
        ],
        type: 'polyline',
      },
      PARIS,
      1000,
    );
    const rota = [
      [PARIS[0] + 0.0002, PARIS[1]],
      [PARIS[0] + 0.0002, PARIS[1] + 0.0005],
    ];
    const metrica = geo.fidelityMetrics(rota, forma);

    expect(metrica.mediaM).toBeGreaterThan(0);
    expect(metrica.maximoM).toBeGreaterThanOrEqual(metrica.mediaM);
    expect(metrica.amostras).toBe(2);
  });
});

describe('server/lib/geo — bounds e utilitários', () => {
  it('calcularBoundsImagem projeta 2000 m × 1000 m com aspeto 2', () => {
    const bounds = geo.calcularBoundsImagem(PARIS, 2000, 2);

    const largura = geo.haversine([bounds.south, bounds.west], [bounds.south, bounds.east]);
    const altura = geo.haversine([bounds.south, bounds.west], [bounds.north, bounds.west]);

    expect(largura).toBeGreaterThan(1950);
    expect(largura).toBeLessThan(2050);
    expect(altura).toBeGreaterThan(975);
    expect(altura).toBeLessThan(1025);
  });

  it('calcularBoundsImagem mantém o centro e cai para aspeto 1 quando inválido', () => {
    const bounds = geo.calcularBoundsImagem(PARIS, 500, 0);
    expect((bounds.north + bounds.south) / 2).toBeCloseTo(PARIS[0], 6);
    expect((bounds.east + bounds.west) / 2).toBeCloseTo(PARIS[1], 6);
  });

  it('normalizarRotacao devolve sempre [0, 360)', () => {
    expect(geo.normalizarRotacao(0)).toBe(0);
    expect(geo.normalizarRotacao(360)).toBe(0);
    expect(geo.normalizarRotacao(-90)).toBe(270);
    expect(geo.normalizarRotacao(725)).toBe(5);
    expect(geo.normalizarRotacao('x')).toBe(0);
  });

  it('calcularBbox devolve limites e centro', () => {
    const bbox = geo.calcularBbox([
      [1, 2],
      [3, 4],
      [2, 6],
    ]);

    expect(bbox).toMatchObject({ minLat: 1, maxLat: 3, minLng: 2, maxLng: 6 });
    expect(bbox.centro).toEqual([2, 4]);
    expect(bbox.largura).toBe(4);
    expect(bbox.altura).toBe(2);
  });
});
