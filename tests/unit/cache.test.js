import { describe, expect, it } from 'vitest';
import CacheTTL from '../../server/lib/cache.js';

function criarCache(opcoes = {}) {
  let agora = 1_000;
  const cache = new CacheTTL({
    ttlMs: 5_000,
    maxEntradas: 2,
    agora: () => agora,
    ...opcoes,
  });
  return {
    cache,
    avancar(ms) {
      agora += ms;
    },
  };
}

describe('CacheTTL', () => {
  it('armazena e recupera valores', () => {
    const { cache } = criarCache();
    cache.set('a', { valor: 1 });
    expect(cache.get('a')).toEqual({ valor: 1 });
    expect(cache.get('inexistente')).toBeUndefined();
  });

  it('expira entradas após o TTL', () => {
    const { cache, avancar } = criarCache();
    cache.set('a', 1);
    avancar(4_999);
    expect(cache.get('a')).toBe(1);

    avancar(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.tamanho).toBe(0);
  });

  it('remove a entrada mais antiga ao exceder o limite', () => {
    const { cache } = criarCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.tamanho).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('rejeita TTL inválido', () => {
    expect(() => new CacheTTL({ ttlMs: 0 })).toThrow(TypeError);
    expect(() => new CacheTTL({ ttlMs: Number.NaN })).toThrow(TypeError);
  });

  it('limpa todas as entradas', () => {
    const { cache } = criarCache();
    cache.set('a', 1);
    cache.limpar();
    expect(cache.tamanho).toBe(0);
  });
});
