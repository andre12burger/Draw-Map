/**
 * @file persistence.js
 * @description Módulo responsável pela persistência de dados locais (LocalStorage).
 * Garante que o utilizador não perca o seu progresso caso atualize a página acidentalmente.
 */

const STORAGE_KEY = 'strava_art_state';

/**
 * @function saveState
 * @description Converte o estado atual da aplicação em JSON e guarda no LocalStorage.
 * @param {Object} state - O objeto de estado global da aplicação.
 * @returns {boolean} Retorna true se a operação for bem-sucedida, false em caso de erro.
 */
export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    console.log('💾 Estado salvo com sucesso');
    return true;
  } catch (erro) {
    console.error('❌ Erro ao salvar estado:', erro);
    return false;
  }
}

/**
 * @function loadState
 * @description Recupera e analisa (parse) o estado previamente guardado no navegador.
 * @returns {Object|null} O objeto de estado recuperado ou null se estiver vazio.
 */
export function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      console.log('📭 Nenhum estado salvo encontrado');
      return null;
    }
    const estado = JSON.parse(saved);
    console.log('📥 Estado carregado com sucesso');
    return estado;
  } catch (erro) {
    console.error('❌ Erro ao carregar estado:', erro);
    return null;
  }
}

/**
 * @function clearState
 * @description Limpa permanentemente os dados salvos da aplicação na memória local.
 * @returns {boolean} Retorna true após a limpeza bem-sucedida.
 */
export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log('🗑️ Estado limpo');
    return true;
  } catch (erro) {
    console.error('❌ Erro ao limpar estado:', erro);
    return false;
  }
}