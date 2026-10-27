import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitEstado,
  desfazerUltimo,
  getEstado,
  inicializarEstado,
  resetarEstado,
} from '../../public/js/core/state.js';
import { CHAVE_ESTADO, sanitizarEstado } from '../../public/js/core/persistence.js';
import {
  limpar as limparHistorico,
  tamanho as tamanhoHistorico,
} from '../../public/js/core/history.js';

const estadoComPonto = {
  coordenadasNiveis: [{ lat: -32.03, lng: -52.1 }],
  segmentosRota: [[[-32.03, -52.1]]],
  modosTraco: ['rua'],
  distanciaTotal: 0,
  contadorPontos: 1,
};

describe('state', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    limparHistorico();
    resetarEstado();
  });

  it('não compartilha arrays entre resets', () => {
    getEstado().coordenadasNiveis.push({ lat: 0, lng: 0 });
    resetarEstado();

    expect(getEstado().coordenadasNiveis).toEqual([]);
  });

  it('faz undo do primeiro ponto (volta ao estado vazio)', () => {
    commitEstado(estadoComPonto);
    expect(tamanhoHistorico()).toBe(1);
    expect(getEstado().coordenadasNiveis).toHaveLength(1);

    const restaurado = desfazerUltimo();
    expect(restaurado.coordenadasNiveis).toEqual([]);
    expect(tamanhoHistorico()).toBe(0);
    expect(getEstado().coordenadasNiveis).toEqual([]);
  });

  it('não corrompe o histórico quando o estado restaurado é mutado', () => {
    commitEstado(estadoComPonto);
    commitEstado({
      coordenadasNiveis: [
        { lat: -32.03, lng: -52.1 },
        { lat: -32.04, lng: -52.2 },
      ],
      segmentosRota: [
        [[-32.03, -52.1]],
        [
          [-32.03, -52.1],
          [-32.04, -52.2],
        ],
      ],
      modosTraco: ['rua', 'rua'],
      contadorPontos: 2,
    });

    const primeiroUndo = desfazerUltimo();
    expect(primeiroUndo.coordenadasNiveis).toHaveLength(1);

    // mutar o retorno não deve alterar o snapshot guardado
    primeiroUndo.segmentosRota[0][0][0] = 999;
    expect(getEstado().segmentosRota[0][0][0]).toBe(-32.03);

    const segundoUndo = desfazerUltimo();
    expect(segundoUndo.coordenadasNiveis).toEqual([]);
    expect(desfazerUltimo()).toBeNull();
  });

  it('persiste somente os campos duráveis (sem histórico)', () => {
    commitEstado(estadoComPonto);
    const bruto = JSON.parse(window.localStorage.getItem(CHAVE_ESTADO));

    expect(bruto).not.toHaveProperty('historicoEstados');
    expect(bruto).not.toHaveProperty('carregandoRota');
    expect(bruto.versao).toBe(2);
    expect(bruto.coordenadasNiveis).toHaveLength(1);
  });

  it('sanitiza estado corrompido e completa campos ausentes', () => {
    window.localStorage.setItem(
      CHAVE_ESTADO,
      JSON.stringify({
        coordenadasNiveis: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 },
        ],
        segmentosRota: [[[1, 2]], []],
        modosTraco: ['livre'],
        distanciaTotal: 'abc',
        ferramentaAtiva: 'inexistente',
        nomeRota: '   ',
      }),
    );

    const estado = inicializarEstado();
    expect(estado.coordenadasNiveis).toHaveLength(2);
    expect(estado.modosTraco).toEqual(['livre', 'rua']);
    expect(estado.segmentosRota[1]).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(estado.distanciaTotal).toBe(0);
    expect(estado.ferramentaAtiva).toBe('rua');
    expect(estado.nomeRota).toBe('Strava Art Route');
    expect(estado.contadorPontos).toBe(2);
  });

  it('rejeita estado persistido sem coordenadas válidas', () => {
    expect(sanitizarEstado(null)).toBeNull();
    expect(sanitizarEstado({ coordenadasNiveis: [] })).toBeNull();
    expect(
      sanitizarEstado({
        coordenadasNiveis: [{ lat: 999, lng: 999 }],
        segmentosRota: [],
        modosTraco: [],
      }),
    ).toBeNull();
  });

  it('emite evento de erro quando o LocalStorage está cheio', () => {
    const ouvinte = vi.fn();
    window.addEventListener('app:storage-error', ouvinte);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    commitEstado(estadoComPonto);

    expect(ouvinte).toHaveBeenCalledTimes(1);
    window.removeEventListener('app:storage-error', ouvinte);
  });
});
