import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ESCALA_MINIMA,
  FORMAS_PADRAO,
  SHAPE_MIN_SIZE_M,
  anguloDoCentro,
  atualizarForma,
  calcularOffsetCentro,
  calcularRotacao,
  criarEstrela,
  criarForma,
  escalaPorBorda,
  getForma,
  limparFormas,
  listarFormas,
  removerForma,
  tamanhoPorDistancia,
} from '../../public/js/map/shapes.js';
import { getMap } from '../../public/js/map/map.js';

const CENTRO = { lat: -32.03, lng: -52.1 };

function alca(titulo) {
  let encontrada = null;
  getMap().eachLayer((camada) => {
    if (camada.options?.title === titulo) encontrada = camada;
  });
  return encontrada;
}

function camadasNoMapa() {
  // Ignora o tile e o renderer SVG partilhado; conta apenas forma + alças.
  let total = 0;
  getMap().eachLayer((camada) => {
    if (camada.options?.className === 'forma-art' || camada.options?.title) total += 1;
  });
  return total;
}

describe('map/shapes — geometria pura', () => {
  it('criarEstrela devolve pontos normalizados e fechados', () => {
    const estrela = criarEstrela(5, 0.4);

    expect(estrela.points).toHaveLength(11);
    expect(estrela.points[0]).toEqual(estrela.points[estrela.points.length - 1]);

    for (const [x, y] of estrela.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('tamanhoPorDistancia aplica o rácio e o mínimo de 25 m', () => {
    expect(tamanhoPorDistancia(1000, 100, 200)).toBe(2000);
    expect(tamanhoPorDistancia(100, 100, 10)).toBe(SHAPE_MIN_SIZE_M);
    expect(tamanhoPorDistancia(1000, 0, 10)).toBe(1000);
  });

  it('escalaPorBorda usa a proporção da bounding box e o mínimo 0.1', () => {
    const bbox = { minLng: 0, maxLng: 1, largura: 1, minLat: 0, maxLat: 1, altura: 1 };

    expect(
      escalaPorBorda({
        eixo: 'x',
        borda: 'left',
        bboxInicial: bbox,
        ponto: { lat: 0.5, lng: 0.25 },
        escalaInicial: 2,
      }),
    ).toBe(1.5);

    expect(
      escalaPorBorda({
        eixo: 'x',
        borda: 'right',
        bboxInicial: bbox,
        ponto: { lat: 0.5, lng: 0.75 },
        escalaInicial: 2,
      }),
    ).toBe(1.5);

    expect(
      escalaPorBorda({
        eixo: 'y',
        borda: 'top',
        bboxInicial: bbox,
        ponto: { lat: 0.25, lng: 0.5 },
        escalaInicial: 1,
      }),
    ).toBe(0.25);

    expect(
      escalaPorBorda({
        eixo: 'x',
        borda: 'left',
        bboxInicial: bbox,
        ponto: { lat: 0.5, lng: 2 },
        escalaInicial: 1,
      }),
    ).toBe(ESCALA_MINIMA);
  });

  it('anguloDoCentro e calcularRotacao respeitam o eixo Y invertido', () => {
    const centro = { lat: 0, lng: 0 };

    expect(anguloDoCentro(centro, { lat: 1, lng: 0 })).toBeCloseTo(0, 6);
    expect(anguloDoCentro(centro, { lat: 0, lng: 1 })).toBeCloseTo(90, 6);
    expect(anguloDoCentro(centro, { lat: -1, lng: 0 })).toBeCloseTo(180, 6);

    expect(calcularRotacao(0, 0, 90)).toBeCloseTo(270, 6);
    expect(calcularRotacao(0, 0, -90)).toBeCloseTo(90, 6);
    expect(calcularRotacao(350, 0, 20)).toBeCloseTo(330, 6);
  });

  it('calcularOffsetCentro preserva o deslocamento do centro', () => {
    expect(calcularOffsetCentro({ lat: 10, lng: 20 }, { lat: 9, lng: 19 })).toEqual({
      lat: 1,
      lng: 1,
    });
  });
});

describe('map/shapes — integração Leaflet (jsdom)', () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="map" style="width:400px;height:300px"></div>';
    const leaflet = await import('leaflet');
    globalThis.L = leaflet.default ?? leaflet;
    globalThis.L.Browser.svg = true;
    getMap().setView([CENTRO.lat, CENTRO.lng], 15);
  });

  beforeEach(() => {
    limparFormas();
  });

  it('cria a forma e as 10 alças no mapa', () => {
    const forma = criarForma({ shape: 'estrela', center: CENTRO, size: 1000 });

    expect(forma).toMatchObject({ size: 1000, rotation: 0, scaleX: 1, scaleY: 1 });
    expect(getForma(forma.id)).not.toBeNull();
    expect(listarFormas()).toHaveLength(1);
    expect(camadasNoMapa()).toBe(11);
    expect(alca('Mover forma')).not.toBeNull();
    expect(alca('Rodar forma')).not.toBeNull();
  });

  it('move preservando o offset do centro da bounding box', () => {
    const forma = criarForma({ shape: 'estrela', center: CENTRO, size: 1000 });
    const marcador = alca('Mover forma');

    marcador.fire('dragstart');
    expect(getMap().dragging.enabled()).toBe(false);

    const inicio = marcador.getLatLng();
    marcador.setLatLng([inicio.lat + 0.002, inicio.lng + 0.002]);
    marcador.fire('drag');
    marcador.fire('dragend');

    const atualizada = getForma(forma.id);
    expect(atualizada.center.lat).toBeCloseTo(CENTRO.lat + 0.002, 6);
    expect(atualizada.center.lng).toBeCloseTo(CENTRO.lng + 0.002, 6);
    expect(getMap().dragging.enabled()).toBe(true);
  });

  it('redimensiona pelos cantos com escala uniforme e mínimo de 25 m', () => {
    const forma = criarForma({ shape: 'estrela', center: CENTRO, size: 1000 });
    const marcador = alca('Redimensionar');
    const inicial = marcador.getLatLng();

    marcador.fire('dragstart');
    marcador.setLatLng([
      CENTRO.lat + (inicial.lat - CENTRO.lat) * 2,
      CENTRO.lng + (inicial.lng - CENTRO.lng) * 2,
    ]);
    marcador.fire('drag');
    marcador.fire('dragend');

    expect(getForma(forma.id).size).toBeGreaterThan(1900);

    marcador.fire('dragstart');
    marcador.setLatLng([CENTRO.lat, CENTRO.lng]);
    marcador.fire('drag');
    marcador.fire('dragend');

    expect(getForma(forma.id).size).toBe(SHAPE_MIN_SIZE_M);
  });

  it('roda pela alça superior com ângulo normalizado', () => {
    const forma = criarForma({ shape: 'estrela', center: CENTRO, size: 1000 });
    const marcador = alca('Rodar forma');

    marcador.fire('dragstart');
    marcador.setLatLng([CENTRO.lat, CENTRO.lng + 0.01]);
    marcador.fire('drag');
    marcador.fire('dragend');

    expect(getForma(forma.id).rotation).toBeCloseTo(270, 3);
  });

  it('escala por eixo nas bordas, com mínimo de 0.1', () => {
    const forma = criarForma({ shape: 'estrela', center: CENTRO, size: 1000 });
    const marcador = alca('Escalar no eixo X (esquerda)');
    const bounds = getMap().getBounds();

    marcador.fire('dragstart');
    marcador.setLatLng([CENTRO.lat, bounds.getWest() - 0.01]);
    marcador.fire('drag');
    marcador.fire('dragend');

    const escalada = getForma(forma.id);
    expect(escalada.scaleX).toBeGreaterThan(1);
    expect(escalada.scaleY).toBeCloseTo(1, 6);

    marcador.fire('dragstart');
    marcador.setLatLng([CENTRO.lat, bounds.getEast() + 0.01]);
    marcador.fire('drag');
    marcador.fire('dragend');

    expect(getForma(forma.id).scaleX).toBe(ESCALA_MINIMA);
  });

  it('atualiza parâmetros com limites e alterna visibilidade', () => {
    const forma = criarForma({ shape: 'hexagono', center: CENTRO, size: 1000 });

    const atualizada = atualizarForma(forma.id, {
      size: 1,
      rotation: -45,
      scaleX: 0,
      scaleY: 0,
    });

    expect(atualizada.size).toBe(SHAPE_MIN_SIZE_M);
    expect(atualizada.rotation).toBe(315);
    expect(atualizada.scaleX).toBe(ESCALA_MINIMA);
    expect(atualizada.scaleY).toBe(ESCALA_MINIMA);

    atualizarForma(forma.id, { visible: false });
    expect(getForma(forma.id).visible).toBe(false);
    expect(camadasNoMapa()).toBe(0);

    atualizarForma(forma.id, { visible: true });
    expect(getForma(forma.id).visible).toBe(true);
    expect(camadasNoMapa()).toBe(11);
  });

  it('remove a forma e limpa todas as camadas', () => {
    const forma = criarForma({ shape: 'estrela', center: CENTRO });
    expect(removerForma(forma.id)).toBe(true);
    expect(getForma(forma.id)).toBeNull();
    expect(camadasNoMapa()).toBe(0);
  });

  it('FORMAS_PADRAO expõe estrela, hexágono e triângulo', () => {
    expect(Object.keys(FORMAS_PADRAO)).toEqual(['estrela', 'hexagono', 'triangulo']);
    expect(FORMAS_PADRAO.hexagono.points).toHaveLength(7);
  });
});
