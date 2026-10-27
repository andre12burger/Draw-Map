/**
 * @file core/state.js
 * @description Estado global (Single Source of Truth), observer e integração com
 * a pilha de undo. Toda leitura devolve uma cópia profunda, impedindo que módulos
 * de UI mutem o estado por referência.
 */

import { clonarProfundo } from './utils.js';
import {
  desfazer as desfazerNoHistorico,
  limpar as limparHistorico,
  registrar as registrarNoHistorico,
} from './history.js';
import {
  VERSAO_ESTADO,
  NOME_ROTA_PADRAO,
  carregarEstado,
  limparEstado,
  salvarEstado,
} from './persistence.js';

/**
 * @returns {Object} Estado inicial novo (arrays próprios, sem referências compartilhadas).
 */
export function criarEstadoInicial() {
  return {
    versao: VERSAO_ESTADO,
    coordenadasNiveis: [],
    segmentosRota: [],
    modosTraco: [],
    ferramentaAtiva: 'rua',
    nomeRota: NOME_ROTA_PADRAO,
    distanciaTotal: 0,
    contadorPontos: 0,
    mapa: null,
    atualizadoEm: new Date().toISOString(),
  };
}

let estadoAtual = criarEstadoInicial();
const observadores = new Set();

function persistir(estado) {
  return salvarEstado(estado);
}

function notificar() {
  const snapshot = getEstado();
  for (const observador of observadores) {
    try {
      observador(snapshot);
    } catch (erro) {
      console.error('Erro em observador de estado:', erro);
    }
  }
}

/**
 * @returns {Object} cópia profunda do estado.
 */
export function getEstado() {
  return clonarProfundo(estadoAtual);
}

/**
 * @param {string} campo
 * @returns {*} cópia profunda do valor.
 */
export function getCampo(campo) {
  return clonarProfundo(estadoAtual[campo]);
}

/**
 * Inscreve um observador. O callback é chamado imediatamente com o estado atual.
 * @param {(estado:Object)=>void} callback
 * @returns {() => void} função de cancelamento
 */
export function inscrever(callback) {
  observadores.add(callback);
  try {
    callback(getEstado());
  } catch (erro) {
    console.error('Erro no observador inicial:', erro);
  }
  return () => observadores.delete(callback);
}

/**
 * Atualização sem registro de histórico (ex.: posição do mapa, nome da rota).
 * @param {Object} parciais
 * @param {{persistir?:boolean, notificar?:boolean}} [opcoes]
 * @returns {Object}
 */
export function atualizarEstado(
  parciais,
  { persistir: devePersistir = true, notificar: deveNotificar = true } = {},
) {
  estadoAtual = {
    ...estadoAtual,
    ...clonarProfundo(parciais),
    atualizadoEm: new Date().toISOString(),
  };

  if (devePersistir) persistir(estadoAtual);
  if (deveNotificar) notificar();
  return getEstado();
}

/**
 * Atualização transacional com undo. A cópia do estado anterior é registrada
 * ANTES da mutação, garantindo que Ctrl+Z volte exatamente um passo.
 * @param {Object} parciais
 * @param {{persistir?:boolean, notificar?:boolean, registrarHistorico?:boolean}} [opcoes]
 * @returns {Object}
 */
export function commitEstado(
  parciais,
  {
    persistir: devePersistir = true,
    notificar: deveNotificar = true,
    registrarHistorico = true,
  } = {},
) {
  if (registrarHistorico) registrarNoHistorico(estadoAtual);

  estadoAtual = {
    ...estadoAtual,
    ...clonarProfundo(parciais),
    atualizadoEm: new Date().toISOString(),
  };

  if (devePersistir) persistir(estadoAtual);
  if (deveNotificar) notificar();
  return getEstado();
}

/**
 * @param {string} campo
 * @param {*} valor
 * @param {{persistir?:boolean, notificar?:boolean}} [opcoes]
 */
export function setCampo(campo, valor, opcoes = {}) {
  return atualizarEstado({ [campo]: valor }, opcoes);
}

/**
 * Carrega o estado persistido, sanitizado. A pilha de undo começa vazia.
 * @returns {Object}
 */
export function inicializarEstado() {
  const salvo = carregarEstado();
  estadoAtual = salvo ? { ...criarEstadoInicial(), ...salvo } : criarEstadoInicial();
  limparHistorico();
  notificar();
  return getEstado();
}

/**
 * Zera o estado e o histórico (usado em testes e em um reset completo).
 * @returns {Object}
 */
export function resetarEstado() {
  estadoAtual = criarEstadoInicial();
  limparHistorico();
  limparEstado();
  notificar();
  return getEstado();
}

/**
 * Restaura o último snapshot anterior, persiste e notifica os observadores.
 * @returns {Object|null}
 */
export function desfazerUltimo() {
  const anterior = desfazerNoHistorico();
  if (!anterior) return null;

  estadoAtual = {
    ...criarEstadoInicial(),
    ...clonarProfundo(anterior),
    atualizadoEm: new Date().toISOString(),
  };

  persistir(estadoAtual);
  notificar();
  return getEstado();
}
