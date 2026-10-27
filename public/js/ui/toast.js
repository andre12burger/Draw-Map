/**
 * @file ui/toast.js
 * @description Notificações não bloqueantes (substituem alert/confirm) e
 * tratamento global de erros não capturados.
 */

function container() {
  let elemento = document.getElementById('toasts');
  if (!elemento) {
    elemento = document.createElement('div');
    elemento.id = 'toasts';
    elemento.className = 'toasts';
    elemento.setAttribute('aria-live', 'polite');
    document.body.appendChild(elemento);
  }
  return elemento;
}

/**
 * @param {string} mensagem
 * @param {{tipo?:'info'|'sucesso'|'aviso'|'erro', duracao?:number}} [opcoes]
 */
export function mostrarToast(mensagem, { tipo = 'info', duracao = 4000 } = {}) {
  const texto = String(mensagem || '').trim();
  if (!texto) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${tipo}`;
  toast.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  toast.textContent = texto;

  container().appendChild(toast);

  const remover = () => {
    toast.classList.add('toast--saindo');
    setTimeout(() => toast.remove(), 200);
  };

  const temporizador = setTimeout(remover, Math.max(1500, duracao));
  toast.addEventListener('click', () => {
    clearTimeout(temporizador);
    remover();
  });
}

/**
 * Captura erros de promise não tratados e falhas de persistência.
 */
export function configurarTratamentoGlobal() {
  window.addEventListener('unhandledrejection', (evento) => {
    console.error('Promise rejeitada sem tratamento:', evento.reason);
    mostrarToast('Ocorreu um erro inesperado. Tente novamente.', { tipo: 'erro' });
  });

  window.addEventListener('app:storage-error', (evento) => {
    const mensagem = evento.detail?.mensagem || 'Não foi possível salvar o progresso no navegador.';
    mostrarToast(`${mensagem} Exporte o GPX para não perder o desenho.`, {
      tipo: 'aviso',
      duracao: 7000,
    });
  });
}
