import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../public/js/services/api.js', () => ({
  buscarRota: vi.fn(),
  buscarRotaLote: vi.fn(),
  obterPontoRua: vi.fn(),
}));

vi.mock('../../public/js/map/render.js', () => ({
  redesenhar: vi.fn(),
}));

vi.mock('../../public/js/ui/toast.js', () => ({
  mostrarToast: vi.fn(),
}));

import {
  adicionarPonto,
  aoArrastarPonto,
  aoInserirPonto,
  desfazer,
  estaOcupado,
  importarRota,
  limparTudo,
  processarLoteLapis,
} from '../../public/js/map/draw.js';
import { buscarRota, buscarRotaLote, obterPontoRua } from '../../public/js/services/api.js';
import { redesenhar } from '../../public/js/map/render.js';
import { commitEstado, getEstado, resetarEstado } from '../../public/js/core/state.js';
import { tamanho as tamanhoHistorico } from '../../public/js/core/history.js';

const p1 = { lat: -32.03, lng: -52.1 };
const p2 = { lat: -32.04, lng: -52.2 };

function rota(a, b) {
  return [
    [a.lat, a.lng, 0],
    [b.lat, b.lng, 0],
  ];
}

function estadoComDoisPontos() {
  commitEstado({
    coordenadasNiveis: [p1, p2],
    segmentosRota: [[[p1.lat, p1.lng]], rota(p1, p2)],
    modosTraco: ['rua', 'rua'],
    distanciaTotal: 0,
    contadorPontos: 2,
  });
}

describe('draw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetarEstado();
    obterPontoRua.mockResolvedValue(p1);
  });

  it('adiciona o primeiro ponto com snap', async () => {
    const ok = await adicionarPonto({ lat: -32.0, lng: -52.0 }, false);

    expect(ok).toBe(true);
    const estado = getEstado();
    expect(estado.coordenadasNiveis).toEqual([p1]);
    expect(estado.segmentosRota[0]).toEqual([[p1.lat, p1.lng]]);
    expect(estado.modosTraco).toEqual(['rua']);
    expect(estaOcupado()).toBe(false);
  });

  it('adiciona o segundo ponto roteado e calcula a distância', async () => {
    await adicionarPonto(p1, false);
    buscarRota.mockResolvedValueOnce(rota(p1, p2));

    const ok = await adicionarPonto(p2, false);
    expect(ok).toBe(true);

    const estado = getEstado();
    expect(estado.coordenadasNiveis).toHaveLength(2);
    expect(estado.segmentosRota[1][0]).toEqual([p1.lat, p1.lng]);
    expect(estado.distanciaTotal).toBeGreaterThan(0);
    expect(tamanhoHistorico()).toBe(2);
  });

  it('não deixa o app travado quando o roteamento falha', async () => {
    await adicionarPonto(p1, false);
    buscarRota.mockResolvedValueOnce(null);

    const ok = await adicionarPonto(p2, false);
    expect(ok).toBe(false);
    expect(estaOcupado()).toBe(false);
    expect(getEstado().coordenadasNiveis).toHaveLength(1);
  });

  it('insere ponto no último trecho sem quebrar (regressão)', async () => {
    estadoComDoisPontos();
    const meio = { lat: -32.035, lng: -52.15 };

    buscarRota.mockResolvedValueOnce(rota(p1, meio)).mockResolvedValueOnce(rota(meio, p2));

    const ok = await aoInserirPonto(1, { lat: -32.035, lng: -52.15 });

    expect(ok).toBe(true);
    const estado = getEstado();
    expect(estado.coordenadasNiveis).toHaveLength(3);
    expect(estado.segmentosRota).toHaveLength(3);
    expect(estado.modosTraco).toEqual(['rua', 'rua', 'rua']);
    expect(estado.coordenadasNiveis[1].lat).toBeCloseTo(meio.lat, 6);
    expect(estado.segmentosRota[2][0]).toEqual([
      estado.coordenadasNiveis[1].lat,
      estado.coordenadasNiveis[1].lng,
    ]);
  });

  it('não muta o estado se a segunda metade da inserção falhar', async () => {
    estadoComDoisPontos();
    buscarRota.mockResolvedValueOnce(rota(p1, p2)).mockResolvedValueOnce(null);

    const ok = await aoInserirPonto(1, { lat: -32.035, lng: -52.15 });

    expect(ok).toBe(false);
    expect(getEstado().coordenadasNiveis).toHaveLength(2);
    expect(getEstado().segmentosRota).toHaveLength(2);
    expect(estaOcupado()).toBe(false);
  });
});

describe('draw — arrasto, lote e limpeza', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetarEstado();
    obterPontoRua.mockResolvedValue(p1);
  });

  it('arrasta um ponto re-roteando o trecho', async () => {
    estadoComDoisPontos();
    const snap = { lat: -32.05, lng: -52.25 };
    const novo = { lat: -32.055, lng: -52.26 };
    obterPontoRua.mockResolvedValue(snap);
    buscarRota.mockResolvedValueOnce(rota(p1, novo));

    const ok = await aoArrastarPonto(1, novo);

    expect(ok).toBe(true);
    expect(getEstado().coordenadasNiveis[1]).toEqual(snap);
    expect(getEstado().segmentosRota[1][0]).toEqual([p1.lat, p1.lng]);
  });

  it('restaura o desenho quando o arrasto falha', async () => {
    estadoComDoisPontos();
    obterPontoRua.mockResolvedValue({ lat: -32.05, lng: -52.25 });
    buscarRota.mockResolvedValueOnce(null);

    const ok = await aoArrastarPonto(1, { lat: -32.05, lng: -52.25 });

    expect(ok).toBe(false);
    expect(getEstado().coordenadasNiveis[1]).toEqual(p2);
    expect(redesenhar).toHaveBeenCalled();
  });

  it('processa lote livre acrescentando segmentos retos', async () => {
    const ok = await processarLoteLapis(
      [
        { lat: 1, lng: 1 },
        { lat: 2, lng: 2 },
        { lat: 3, lng: 3 },
      ],
      true,
    );

    expect(ok).toBe(true);
    const estado = getEstado();
    expect(estado.coordenadasNiveis).toHaveLength(3);
    expect(estado.segmentosRota).toHaveLength(3);
    expect(estado.modosTraco).toEqual(['livre', 'livre', 'livre']);
  });

  it('processa lote roteado e divide a geometria', async () => {
    const estrategicos = [p1, { lat: -32.035, lng: -52.15 }, p2];
    buscarRotaLote.mockResolvedValueOnce([
      [p1.lat, p1.lng, 0],
      [-32.035, -52.15, 0],
      [p2.lat, p2.lng, 0],
    ]);

    const ok = await processarLoteLapis(estrategicos, false);

    expect(ok).toBe(true);
    const estado = getEstado();
    expect(estado.coordenadasNiveis.length).toBeGreaterThanOrEqual(2);
    expect(estado.segmentosRota.length).toBe(estado.coordenadasNiveis.length);
    expect(estado.modosTraco.every((modo) => modo === 'rua')).toBe(true);
  });

  it('limpa e desfaz a limpeza', async () => {
    estadoComDoisPontos();
    expect(limparTudo()).toBe(true);
    expect(getEstado().coordenadasNiveis).toHaveLength(0);

    const restaurado = desfazer();
    expect(restaurado.coordenadasNiveis).toHaveLength(2);
  });

  it('bloqueia operações concorrentes', async () => {
    let resolver;
    buscarRota.mockReturnValueOnce(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );

    await adicionarPonto(p1, false);
    const primeira = adicionarPonto(p2, false);
    const segunda = await adicionarPonto({ lat: 0, lng: 0 }, false);

    expect(segunda).toBe(false);
    resolver(rota(p1, p2));
    expect(await primeira).toBe(true);
  });

  it('incorpora uma rota pronta num desenho vazio', async () => {
    const laço = [
      [p1.lat, p1.lng, 0],
      [p2.lat, p2.lng, 0],
      [p1.lat, p1.lng, 0],
    ];

    const ok = await importarRota(laço);

    expect(ok).toBe(true);

    const estado = getEstado();
    expect(estado.coordenadasNiveis).toEqual([p1, p1]);
    expect(estado.segmentosRota[0]).toEqual([[p1.lat, p1.lng]]);
    expect(estado.segmentosRota[1]).toEqual([
      [p1.lat, p1.lng],
      [p2.lat, p2.lng],
      [p1.lat, p1.lng],
    ]);
    expect(estado.modosTraco).toEqual(['rua', 'rua']);
    expect(estado.distanciaTotal).toBeGreaterThan(0);
    expect(buscarRota).not.toHaveBeenCalled();
  });

  it('liga a rota da forma ao traçado existente com um trecho de rua', async () => {
    estadoComDoisPontos();
    buscarRota.mockResolvedValueOnce([
      [p2.lat, p2.lng, 0],
      [-32.05, -52.15, 0],
      [p1.lat, p1.lng, 0],
    ]);

    const ok = await importarRota([
      { lat: p1.lat, lng: p1.lng },
      { lat: p2.lat, lng: p2.lng },
    ]);

    expect(ok).toBe(true);
    expect(buscarRota).toHaveBeenCalledWith(p2, p1, { modoLivre: false });

    const estado = getEstado();
    expect(estado.coordenadasNiveis).toHaveLength(3);
    expect(estado.segmentosRota[2]).toEqual([
      [p2.lat, p2.lng],
      [-32.05, -52.15, 0],
      [p1.lat, p1.lng, 0],
      [p2.lat, p2.lng],
    ]);
    expect(estado.distanciaTotal).toBeGreaterThan(0);
  });

  it('recusa rotas com menos de dois pontos válidos', async () => {
    expect(await importarRota([[p1.lat, p1.lng]])).toBe(false);
    expect(await importarRota(null)).toBe(false);
    expect(getEstado().coordenadasNiveis).toHaveLength(0);
  });
});
