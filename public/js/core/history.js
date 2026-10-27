/**
 * @file core/history.js
 * @description Pilha de undo mantida apenas em memória.
 *
 * Semântica: antes de cada mutação, `registrar` recebe uma cópia do estado
 * anterior. `desfazer` devolve o último estado anterior e o remove da pilha.
 * A pilha nunca é persistida no LocalStorage, evitando estouro de cota e
 * vazamento de dezenas de rotas completas entre sessões.
 */

import { clonarProfundo } from './utils.js';

const LIMITE_PADRAO = 50;

let pilha = [];
let limite = LIMITE_PADRAO;

/**
 * @param {Object} estado - Snapshot do estado ANTES da mutação.
 */
export function registrar(estado) {
  pilha.push(clonarProfundo(estado));
  if (pilha.length > limite) pilha.shift();
}

/**
 * @returns {Object|null} Estado anterior ou null se não houver undo disponível.
 */
export function desfazer() {
  if (pilha.length === 0) return null;
  return clonarProfundo(pilha.pop());
}

export function limpar() {
  pilha = [];
}

export function tamanho() {
  return pilha.length;
}

/**
 * Define o limite da pilha (usado em testes).
 * @param {number} novoLimite
 */
export function definirLimite(novoLimite) {
  limite = Math.max(1, Number(novoLimite) || LIMITE_PADRAO);
  while (pilha.length > limite) pilha.shift();
}
