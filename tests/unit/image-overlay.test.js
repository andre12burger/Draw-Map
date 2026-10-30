import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGEM_MAX_METROS,
  IMAGEM_MIN_METROS,
  OPACIDADE_PADRAO,
  PANE_IMAGEM,
  atualizarImagem,
  definirOpacidade,
  garantirPane,
  getImagemReferencia,
  inicializarImagemReferencia,
  limitarOpacidade,
  limitarTamanhoImagem,
  mostrarImagem,
  moverImagem,
  obterAspectoImagem,
  redimensionarImagem,
  removerImagem,
} from '../../public/js/map/image-overlay.js';
import { getMap } from '../../public/js/map/map.js';
import { haversine } from '../../public/js/core/geo.js';

const CENTRO = { lat: -32.03, lng: -52.1 };
const IMAGEM = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

function camadaImagem() {
  let encontrada = null;
  getMap().eachLayer((camada) => {
    if (camada.options?.pane === PANE_IMAGEM) encontrada = camada;
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

function totalAlcas() {
  let total = 0;
  getMap().eachLayer((camada) => {
    if (camada.options?.title?.includes('imagem')) total += 1;
  });
  return total;
}

describe('map/image-overlay — limites puros', () => {
  it('limita o tamanho entre 10 m e 20 000 m', () => {
    expect(limitarTamanhoImagem(5)).toBe(IMAGEM_MIN_METROS);
    expect(limitarTamanhoImagem(50_000)).toBe(IMAGEM_MAX_METROS);
    expect(limitarTamanhoImagem(1500)).toBe(1500);
    expect(limitarTamanhoImagem('x')).toBe(IMAGEM_MIN_METROS);
  });

  it('limita a opacidade entre 0 e 1 com fallback 0.5', () => {
    expect(limitarOpacidade(-0.5)).toBe(0);
    expect(limitarOpacidade(3)).toBe(1);
    expect(limitarOpacidade(0.25)).toBe(0.25);
    expect(limitarOpacidade('x')).toBe(OPACIDADE_PADRAO);
  });

  it('lê o rácio de aspeto da imagem e cai para 1 em erro', async () => {
    class ImagemFalsa {
      set src(_valor) {
        this.naturalWidth = 800;
        this.naturalHeight = 400;
        this.onload?.();
      }
    }
    vi.stubGlobal('Image', ImagemFalsa);
    await expect(obterAspectoImagem('x')).resolves.toBe(2);
    vi.unstubAllGlobals();

    class ImagemComErro {
      set src(_valor) {
        this.onerror?.();
      }
    }
    vi.stubGlobal('Image', ImagemComErro);
    await expect(obterAspectoImagem('x')).resolves.toBe(1);
    vi.unstubAllGlobals();
  });
});

describe('map/image-overlay — integração Leaflet (jsdom)', () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="map" style="width:400px;height:300px"></div>';
    const leaflet = await import('leaflet');
    globalThis.L = leaflet.default ?? leaflet;
    globalThis.L.Browser.svg = true;
    getMap().setView([CENTRO.lat, CENTRO.lng], 15);
  });

  beforeEach(() => {
    removerImagem();
  });

  it('cria o pane dedicado com zIndex 350 e sem eventos de ponteiro', () => {
    inicializarImagemReferencia();
    const pane = getMap().getPane(PANE_IMAGEM);

    expect(pane).toBeDefined();
    expect(pane.style.zIndex).toBe('350');
    expect(pane.style.pointerEvents).toBe('none');
    expect(garantirPane(getMap())).toBe(pane);
  });

  it('mostra a imagem com bounds de 2000 m × 1000 m e atributos de privacidade', async () => {
    const estado = await mostrarImagem({
      url: IMAGEM,
      center: CENTRO,
      size: 2000,
      aspectRatio: 2,
      opacity: 0.5,
    });

    expect(estado).toMatchObject({ size: 2000, opacity: 0.5, aspectRatio: 2, visible: true });

    const camada = camadaImagem();
    expect(camada).not.toBeNull();

    const bounds = camada.getBounds();
    const largura = haversine(
      [bounds.getSouth(), bounds.getWest()],
      [bounds.getSouth(), bounds.getEast()],
    );
    const altura = haversine(
      [bounds.getSouth(), bounds.getWest()],
      [bounds.getNorth(), bounds.getWest()],
    );

    expect(largura).toBeGreaterThan(1950);
    expect(largura).toBeLessThan(2050);
    expect(altura).toBeGreaterThan(975);
    expect(altura).toBeLessThan(1025);

    const elemento = camada.getElement();
    expect(elemento.getAttribute('data-clarity-mask')).toBe('true');
    expect(elemento.getAttribute('data-html2canvas-ignore')).toBe('true');
    expect(elemento.getAttribute('alt')).toBe('');
    expect(totalAlcas()).toBe(5);
  });

  it('redimensiona livremente mantendo o rácio, com clamp 10–20 000 m', async () => {
    await mostrarImagem({ url: IMAGEM, center: CENTRO, size: 2000, aspectRatio: 2 });

    expect(redimensionarImagem(5).size).toBe(IMAGEM_MIN_METROS);
    expect(redimensionarImagem(50_000).size).toBe(IMAGEM_MAX_METROS);
    expect(atualizarImagem({ size: 1500 }).size).toBe(1500);

    const bounds = camadaImagem().getBounds();
    const largura = haversine(
      [bounds.getSouth(), bounds.getWest()],
      [bounds.getSouth(), bounds.getEast()],
    );
    const altura = haversine(
      [bounds.getSouth(), bounds.getWest()],
      [bounds.getNorth(), bounds.getWest()],
    );

    expect(largura / altura).toBeCloseTo(2, 1);
  });

  it('move e altera a opacidade da imagem', async () => {
    await mostrarImagem({ url: IMAGEM, center: CENTRO, size: 1000, aspectRatio: 1 });

    const movida = moverImagem({ lat: -32.04, lng: -52.11 });
    expect(movida.center).toEqual({ lat: -32.04, lng: -52.11 });

    expect(definirOpacidade(0.8).opacity).toBe(0.8);
    expect(definirOpacidade(2).opacity).toBe(1);
    expect(camadaImagem().options.opacity).toBe(1);
  });

  it('arrasta a alça central e os cantos', async () => {
    await mostrarImagem({ url: IMAGEM, center: CENTRO, size: 1000, aspectRatio: 1 });

    const centro = alca('Mover imagem');
    centro.fire('dragstart');
    expect(getMap().dragging.enabled()).toBe(false);

    centro.setLatLng([CENTRO.lat + 0.001, CENTRO.lng + 0.001]);
    centro.fire('drag');
    centro.fire('dragend');

    expect(getImagemReferencia().center.lat).toBeCloseTo(CENTRO.lat + 0.001, 6);
    expect(getMap().dragging.enabled()).toBe(true);

    const canto = alca('Redimensionar imagem (NW)');
    const inicial = canto.getLatLng();
    canto.fire('dragstart');
    canto.setLatLng([
      CENTRO.lat + (inicial.lat - CENTRO.lat) * 3,
      CENTRO.lng + (inicial.lng - CENTRO.lng) * 3,
    ]);
    canto.fire('drag');
    canto.fire('dragend');

    expect(getImagemReferencia().size).toBeGreaterThan(2000);

    const centroMovido = getImagemReferencia().center;
    canto.fire('dragstart');
    canto.setLatLng([centroMovido.lat, centroMovido.lng]);
    canto.fire('drag');
    canto.fire('dragend');

    expect(getImagemReferencia().size).toBe(IMAGEM_MIN_METROS);
  });

  it('remove a imagem e todas as alças', async () => {
    await mostrarImagem({ url: IMAGEM, center: CENTRO, size: 1000, aspectRatio: 1 });
    expect(removerImagem()).toBe(true);
    expect(getImagemReferencia()).toBeNull();
    expect(camadaImagem()).toBeNull();
    expect(totalAlcas()).toBe(0);
  });

  it('ignora URLs inválidos', async () => {
    await expect(mostrarImagem({ url: '  ' })).resolves.toBeNull();
    await expect(mostrarImagem({})).resolves.toBeNull();
  });
});
