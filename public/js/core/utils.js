/**
 * @file core/utils.js
 * @description Utilitários compartilhados pelo frontend.
 */

/**
 * Clona profundamente estruturas JSON-compatíveis.
 * `structuredClone` é usado quando disponível (navegadores modernos e Node 17+).
 * @template T
 * @param {T} valor
 * @returns {T}
 */
export function clonarProfundo(valor) {
  if (valor === undefined || valor === null) return valor;
  if (typeof structuredClone === 'function') return structuredClone(valor);
  return JSON.parse(JSON.stringify(valor));
}

/**
 * Informa se o foco está em um campo que deve capturar atalhos de teclado.
 * @param {EventTarget|null} alvo
 * @returns {boolean}
 */
export function ehCampoEditavel(alvo) {
  if (!alvo || !(alvo instanceof Element)) return false;
  if (alvo.isContentEditable) return true;
  return Boolean(alvo.closest('input, textarea, select, [contenteditable="true"]'));
}

/**
 * Formata um número com casas decimais fixas sem lançar exceção.
 * @param {unknown} valor
 * @param {number} [casas=2]
 * @returns {string}
 */
export function formatarNumero(valor, casas = 2) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(casas) : (0).toFixed(casas);
}
