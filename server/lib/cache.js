'use strict';

/**
 * @file server/lib/cache.js
 * @description Cache em memória com TTL e limite de entradas (política LRU simples
 * baseada na ordem de inserção do Map). Evita repetir chamadas idênticas às APIs
 * públicas, respeitando as políticas de uso do Nominatim e do BRouter.
 */

class CacheTTL {
  /**
   * @param {Object} opcoes
   * @param {number} opcoes.ttlMs - Tempo de vida de cada entrada em milissegundos.
   * @param {number} [opcoes.maxEntradas=500] - Número máximo de entradas.
   * @param {Function} [opcoes.agora] - Relógio injetável (facilita testes).
   */
  constructor({ ttlMs, maxEntradas = 500, agora = () => Date.now() }) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new TypeError('ttlMs deve ser um número positivo');
    }
    this.ttlMs = ttlMs;
    this.maxEntradas = maxEntradas;
    this.agora = agora;
    this.entradas = new Map();
  }

  get(chave) {
    const entrada = this.entradas.get(chave);
    if (!entrada) return undefined;

    if (entrada.expiraEm <= this.agora()) {
      this.entradas.delete(chave);
      return undefined;
    }

    return entrada.valor;
  }

  set(chave, valor) {
    if (this.entradas.has(chave)) this.entradas.delete(chave);

    this.entradas.set(chave, {
      valor,
      expiraEm: this.agora() + this.ttlMs,
    });

    while (this.entradas.size > this.maxEntradas) {
      const maisAntiga = this.entradas.keys().next().value;
      this.entradas.delete(maisAntiga);
    }
  }

  limpar() {
    this.entradas.clear();
  }

  get tamanho() {
    return this.entradas.size;
  }
}

module.exports = CacheTTL;
