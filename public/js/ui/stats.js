/**
 * @file ui/stats.js
 * @description Atualização dos painéis de distância, pontos, requisições e status.
 */

import { formatarNumero } from '../core/utils.js';

function elemento(id) {
  return document.getElementById(id);
}

/**
 * @param {{distanciaTotal:number, contadorPontos:number}} estado
 */
export function atualizarEstatisticas({ distanciaTotal, contadorPontos }) {
  const distancia = elemento('distancia-total');
  const pontos = elemento('contador-pontos');

  if (distancia) distancia.textContent = formatarNumero(distanciaTotal);
  if (pontos) pontos.textContent = String(Number(contadorPontos) || 0);
}

/**
 * @param {number} total
 */
export function atualizarContadorApi(total) {
  const contador = elemento('contador-api');
  if (contador) contador.textContent = String(Number(total) || 0);
}

/**
 * Mensagem de status acessível (aria-live) e indicador de ocupado.
 * @param {string} texto
 * @param {{ocupado?:boolean}} [opcoes]
 */
export function definirStatus(texto = '', { ocupado = false } = {}) {
  const status = elemento('status');
  if (status) {
    status.textContent = texto;
    status.hidden = texto.length === 0;
  }
  document.body.classList.toggle('ocupado', Boolean(ocupado));
}
