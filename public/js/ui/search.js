/**
 * @file ui/search.js
 * @description Autocomplete de endereços com debounce, cancelamento de requisições
 * antigas, navegação por teclado e anúncios de acessibilidade.
 */

import { buscarEndereco } from '../services/api.js';
import { irPara } from '../map/map.js';
import { definirStatus } from './stats.js';
import { mostrarToast } from './toast.js';

const ATRASO_BUSCA_MS = 450;
const MINIMO_CARACTERES = 3;

let inicializado = false;

export function inicializarBusca() {
  if (inicializado) return;
  inicializado = true;

  const form = document.getElementById('form-busca');
  const input = document.getElementById('input-endereco');
  const caixa = document.getElementById('sugestoes-endereco');
  const botao = document.getElementById('btn-buscar-endereco');

  if (!form || !input || !caixa || !botao) return;

  let resultados = [];
  let indiceAtivo = -1;
  let temporizador = null;
  let controlador = null;
  let sequencia = 0;

  function fechar() {
    caixa.innerHTML = '';
    caixa.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    resultados = [];
    indiceAtivo = -1;
  }

  function destacar(indice) {
    const itens = caixa.querySelectorAll('[role="option"]');
    itens.forEach((item, posicao) => {
      const ativo = posicao === indice;
      item.classList.toggle('ativo', ativo);
      item.setAttribute('aria-selected', String(ativo));
    });

    if (indice >= 0 && itens[indice]) {
      input.setAttribute('aria-activedescendant', itens[indice].id);
      itens[indice].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
    indiceAtivo = indice;
  }

  function selecionar(resultado) {
    input.value = resultado.nome;
    fechar();
    irPara(resultado, 16);
    input.blur();
  }

  function renderizar(lista) {
    caixa.innerHTML = '';
    resultados = lista;
    indiceAtivo = -1;

    if (lista.length === 0) {
      fechar();
      return;
    }

    lista.forEach((resultado, indice) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.id = `sugestao-${indice}`;
      item.className = 'sugestao-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      item.textContent = resultado.nome;
      item.addEventListener('click', () => selecionar(resultado));
      caixa.appendChild(item);
    });

    caixa.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function cancelarPendente() {
    clearTimeout(temporizador);
    if (controlador) controlador.abort();
    controlador = null;
  }

  async function buscar(termo, { navegar }) {
    cancelarPendente();
    const token = sequencia + 1;
    sequencia = token;
    controlador = new AbortController();

    if (navegar) {
      botao.disabled = true;
      input.disabled = true;
      definirStatus('Buscando endereço...', { ocupado: true });
    }

    try {
      const lista = await buscarEndereco(termo, { sinal: controlador.signal });
      if (token !== sequencia) return;

      if (!lista || lista.length === 0) {
        fechar();
        if (navegar) {
          mostrarToast('Endereço não encontrado. Tente incluir a cidade.', {
            tipo: 'aviso',
          });
        }
        return;
      }

      renderizar(lista);
      if (navegar) selecionar(lista[0]);
    } finally {
      if (token === sequencia) {
        botao.disabled = false;
        input.disabled = false;
        if (navegar) definirStatus('');
      }
    }
  }

  input.addEventListener('input', () => {
    const termo = input.value.trim();
    clearTimeout(temporizador);

    if (termo.length < MINIMO_CARACTERES) {
      cancelarPendente();
      fechar();
      return;
    }

    temporizador = setTimeout(() => {
      void buscar(termo, { navegar: false });
    }, ATRASO_BUSCA_MS);
  });

  input.addEventListener('keydown', (evento) => {
    if (caixa.hidden) return;

    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      destacar(Math.min(indiceAtivo + 1, resultados.length - 1));
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      destacar(Math.max(indiceAtivo - 1, 0));
    } else if (evento.key === 'Enter' && indiceAtivo >= 0) {
      evento.preventDefault();
      selecionar(resultados[indiceAtivo]);
    } else if (evento.key === 'Escape') {
      evento.preventDefault();
      fechar();
    }
  });

  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const termo = input.value.trim();
    if (termo.length < 2) return;
    void buscar(termo, { navegar: true });
  });

  document.addEventListener('click', (evento) => {
    if (!form.contains(evento.target)) fechar();
  });
}
