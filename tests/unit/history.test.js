import { beforeEach, describe, expect, it } from 'vitest';
import {
  definirLimite,
  desfazer,
  limpar,
  registrar,
  tamanho,
} from '../../public/js/core/history.js';

describe('history', () => {
  beforeEach(() => {
    limpar();
    definirLimite(50);
  });

  it('devolve cópias profundas e na ordem correta', () => {
    registrar({ coordenadasNiveis: [{ lat: 0, lng: 0 }] });
    registrar({ coordenadasNiveis: [{ lat: 1, lng: 1 }] });

    const segundo = desfazer();
    expect(segundo.coordenadasNiveis[0].lat).toBe(1);

    segundo.coordenadasNiveis[0].lat = 999;
    expect(desfazer().coordenadasNiveis[0].lat).toBe(0);
  });

  it('respeita o limite configurado', () => {
    definirLimite(2);
    registrar({ valor: 1 });
    registrar({ valor: 2 });
    registrar({ valor: 3 });

    expect(tamanho()).toBe(2);
    expect(desfazer().valor).toBe(3);
    expect(desfazer().valor).toBe(2);
    expect(desfazer()).toBeNull();
  });

  it('retorna null quando vazio', () => {
    expect(desfazer()).toBeNull();
  });
});
