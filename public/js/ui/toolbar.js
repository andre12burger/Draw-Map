/**
 * @file ui/toolbar.js
 * @description Seleção das ferramentas (Rua, Livre, Lápis), atalhos 1/2/3,
 * estado `aria-pressed` e sincronização do modo de arrasto do mapa.
 */

import { atualizarEstado, getCampo, inscrever } from '../core/state.js';
import { getMap } from '../map/map.js';
import { cancelarLapis, sincronizarArrasto } from '../map/pencil.js';
import { limparPrevia } from '../map/preview.js';
import { ehCampoEditavel } from '../core/utils.js';

const FERRAMENTAS = new Set(['rua', 'livre', 'lapis']);

let inicializado = false;

function botoes() {
  return document.querySelectorAll('[data-ferramenta]');
}

function aplicarDom(ferramenta) {
  botoes().forEach((botao) => {
    const ativo = botao.dataset.ferramenta === ferramenta;
    botao.classList.toggle('ativo', ativo);
    botao.setAttribute('aria-pressed', String(ativo));
  });

  const container = getMap().getContainer();
  container.classList.toggle('cursor-lapis', ferramenta === 'lapis');
  sincronizarArrasto();
}

/**
 * @param {'rua'|'livre'|'lapis'} ferramenta
 */
export function definirFerramenta(ferramenta) {
  if (!FERRAMENTAS.has(ferramenta)) return;
  if (getCampo('ferramentaAtiva') === ferramenta) return;

  cancelarLapis();
  limparPrevia();
  atualizarEstado({ ferramentaAtiva: ferramenta }, { registrarHistorico: false });
  aplicarDom(ferramenta);
}

export function inicializarToolbar() {
  if (inicializado) return;
  inicializado = true;

  botoes().forEach((botao) => {
    botao.addEventListener('click', () => definirFerramenta(botao.dataset.ferramenta));
  });

  window.addEventListener('keydown', (evento) => {
    if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
    if (ehCampoEditavel(evento.target)) return;

    if (evento.key === '1') definirFerramenta('rua');
    if (evento.key === '2') definirFerramenta('livre');
    if (evento.key === '3') definirFerramenta('lapis');
  });

  inscrever((estado) => aplicarDom(estado.ferramentaAtiva));
}
