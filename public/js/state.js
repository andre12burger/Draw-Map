/**
 * @file state.js
 * @description Módulo de Gerenciamento de Estado Global da Aplicação.
 * Implementa o padrão de arquitetura Flux/Observer para manter a consistência 
 * dos dados (coordenadas, distâncias, histórico) entre diferentes módulos do sistema.
 * Também gerencia a persistência no LocalStorage do navegador.
 */

import { saveState, loadState } from './persistence.js';

/**
 * @constant estadoInicial
 * @description Estrutura base de dados (Single Source of Truth) da aplicação.
 */
const estadoInicial = {
  coordenadasNiveis: [],
  segmentosRota: [],
  modosTraco: [],
  ferramentaAtiva: 'rua',
  distanciaTotal: 0,
  contadorPontos: 0,
  historicoEstados: [],
  carregandoRota: false,
  criadoEm: new Date().toISOString(),
  atualizadoEm: new Date().toISOString()
};

let estadoAtual = { ...estadoInicial };
const observadores = [];

/**
 * @function inscrever
 * @description Registra funções callbacks que serão notificadas quando o estado mudar (Padrão Observer).
 * @param {Function} callback - Função a ser executada na mudança de estado.
 * @returns {Function} Função para cancelar a inscrição.
 */
export function inscrever(callback) {
  observadores.push(callback);
  return () => {
    const index = observadores.indexOf(callback);
    if (index > -1) observadores.splice(index, 1);
  };
}

/**
 * @function notificarMudancas
 * @description Dispara a atualização para todos os módulos inscritos.
 */
export function notificarMudancas() {
  observadores.forEach(cb => cb(estadoAtual));
}

export function getEstado() {
  return { ...estadoAtual };
}

export function getCampo(campo) {
  return estadoAtual[campo];
}

/**
 * @function setCampo
 * @description Atualiza um campo específico do estado e persiste a alteração.
 * @param {string} campo - Nome da chave no objeto de estado.
 * @param {any} valor - Novo valor a ser atribuído.
 * @param {boolean} persistir - Define se salva no LocalStorage (padrão: true).
 */
export function setCampo(campo, valor, persistir = true) {
  estadoAtual[campo] = valor;
  estadoAtual.atualizadoEm = new Date().toISOString();
  
  if (persistir) saveState(estadoAtual);
  
  notificarMudancas();
  return estadoAtual[campo];
}

export function atualizarEstado(novosDados, persistir = true) {
  estadoAtual = { ...estadoAtual, ...novosDados, atualizadoEm: new Date().toISOString() };
  if (persistir) saveState(estadoAtual);
  notificarMudancas();
  return getEstado();
}

export function resetarEstado() {
  estadoAtual = { ...estadoInicial };
  saveState(estadoAtual);
  notificarMudancas();
  return getEstado();
}

export function inicializarEstado() {
  const salvo = loadState();
  if (salvo) {
    estadoAtual = { ...estadoInicial, ...salvo };
    notificarMudancas();
    return getEstado();
  }
  return getEstado();
}

/**
 * @function salvarHistorico
 * @description Salva uma cópia profunda (deep copy) do estado atual na pilha de histórico.
 * Limita o array a 50 posições para evitar estouro de memória no navegador.
 */
export function salvarHistorico() {
  const historico = [...estadoAtual.historicoEstados, {
    coordenadasNiveis: [...estadoAtual.coordenadasNiveis],
    segmentosRota: JSON.parse(JSON.stringify(estadoAtual.segmentosRota)),
    modosTraco: [...estadoAtual.modosTraco],
    ferramentaAtiva: estadoAtual.ferramentaAtiva
  }];
  
  if (historico.length > 50) historico.shift();
  
  setCampo('historicoEstados', historico, false);
  return historico;
}

/**
 * @function desfazerUltimo
 * @description Algoritmo de rollback. Retorna a aplicação para o estado do penúltimo clique (Ctrl+Z).
 * @returns {Object|null} O estado anterior restaurado, ou null se não houver histórico.
 */
export function desfazerUltimo() {
  if (estadoAtual.historicoEstados.length <= 1) return null;
  
  const historico = [...estadoAtual.historicoEstados];
  historico.pop();
  const estadoAnterior = historico[historico.length - 1];
  
  estadoAtual = { ...estadoInicial, ...estadoAnterior, atualizadoEm: new Date().toISOString() };
  setCampo('historicoEstados', historico, false);
  
  return getEstado();
}