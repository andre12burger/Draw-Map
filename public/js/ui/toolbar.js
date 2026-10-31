/**
 * @file ui/toolbar.js
 * @description Barra inferior em pílula: perfis de roteamento (Cycling/Walking/
 * Free) e ferramentas (Points/Pencil/Shape), atalhos 1–4, estado `aria-pressed`
 * e sincronização do modo de arrasto do mapa.
 *
 * Perfis e ferramentas são independentes: trocar de perfil com o modo Shape
 * ativo apenas recalcula o Auto-Fit, sem destruir o molde.
 */

import { atualizarEstado, getCampo, getEstado, inscrever } from '../core/state.js';
import { getMap } from '../map/map.js';
import { cancelarLapis, sincronizarArrasto } from '../map/pencil.js';
import { limparPrevia } from '../map/preview.js';
import { ehCampoEditavel } from '../core/utils.js';
import {
  abrirEstudioForma,
  fecharEstudioForma,
  reajustarEstudioForma,
} from '../map/shape-studio.js';

const FERRAMENTAS = new Set(['rua', 'livre', 'lapis', 'forma']);
const PERFIS = new Set(['bike', 'foot', 'free']);
const ROTULOS_PERFIL = Object.freeze({ bike: 'Cycling', foot: 'Walking', free: 'Free' });

let inicializado = false;

function aplicarDom(estado) {
  document.querySelectorAll('[data-ferramenta]').forEach((botao) => {
    // `livre` é o modo legado equivalente a Points com perfil Free.
    const ativo =
      botao.dataset.ferramenta === estado.ferramentaAtiva ||
      (botao.dataset.ferramenta === 'rua' && estado.ferramentaAtiva === 'livre');
    botao.classList.toggle('ativo', ativo);
    botao.setAttribute('aria-pressed', String(ativo));
  });

  document.querySelectorAll('[data-perfil]').forEach((botao) => {
    const ativo = botao.dataset.perfil === estado.perfilUi;
    botao.classList.toggle('ativo', ativo);
    botao.setAttribute('aria-pressed', String(ativo));
  });

  const rotulo = document.getElementById('painel-perfil-rotulo');
  if (rotulo) rotulo.textContent = ROTULOS_PERFIL[estado.perfilUi] ?? 'Cycling';

  const container = getMap().getContainer();
  container.classList.toggle('cursor-lapis', estado.ferramentaAtiva === 'lapis');
  container.classList.toggle('cursor-forma', estado.ferramentaAtiva === 'forma');
  sincronizarArrasto();
}

/**
 * @param {'rua'|'livre'|'lapis'|'forma'} ferramenta
 */
export function definirFerramenta(ferramenta) {
  if (!FERRAMENTAS.has(ferramenta)) return;
  if (getCampo('ferramentaAtiva') === ferramenta) return;

  cancelarLapis();
  limparPrevia();

  const alteracoes = { ferramentaAtiva: ferramenta };
  if (ferramenta === 'livre') alteracoes.perfilUi = 'free';

  atualizarEstado(alteracoes, { registrarHistorico: false });

  if (ferramenta === 'forma') abrirEstudioForma();
  else fecharEstudioForma();

  aplicarDom(getEstado());
}

/**
 * Troca o perfil de roteamento. Com o modo Shape ativo, recalcula o Auto-Fit
 * usando o novo perfil (Free mantém o último perfil roteável).
 * @param {'bike'|'foot'|'free'} perfil
 */
export function definirPerfil(perfil) {
  if (!PERFIS.has(perfil)) return;

  const emForma = getCampo('ferramentaAtiva') === 'forma';
  const perfilAnterior = getCampo('perfilRota') === 'foot' ? 'foot' : 'bike';
  const perfilRota = perfil === 'foot' ? 'foot' : perfil === 'bike' ? 'bike' : perfilAnterior;

  const alteracoes = { perfilUi: perfil, perfilRota };

  if (!emForma) {
    // Perfis são independentes da ferramenta: Free mantém Points ativo, mas
    // desenha sem rotear. Sair do lápis exige cancelar o gesto pendente.
    if (getCampo('ferramentaAtiva') === 'lapis') {
      cancelarLapis();
      limparPrevia();
    }
    alteracoes.ferramentaAtiva = 'rua';
  }

  atualizarEstado(alteracoes, { registrarHistorico: false });

  if (emForma) reajustarEstudioForma();

  aplicarDom(getEstado());
}

export function inicializarToolbar() {
  if (inicializado) return;
  inicializado = true;

  document.querySelectorAll('[data-ferramenta]').forEach((botao) => {
    botao.addEventListener('click', () => definirFerramenta(botao.dataset.ferramenta));
  });

  document.querySelectorAll('[data-perfil]').forEach((botao) => {
    botao.addEventListener('click', () => definirPerfil(botao.dataset.perfil));
  });

  window.addEventListener('keydown', (evento) => {
    if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
    if (ehCampoEditavel(evento.target)) return;

    if (evento.key === '1') {
      if (getCampo('perfilUi') === 'free') definirPerfil('bike');
      else definirFerramenta('rua');
    }
    if (evento.key === '2') definirPerfil('free');
    if (evento.key === '3') definirFerramenta('lapis');
    if (evento.key === '4') definirFerramenta('forma');
  });

  inscrever(aplicarDom);
}
