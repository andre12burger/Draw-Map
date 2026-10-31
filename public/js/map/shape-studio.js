/**
 * @file map/shape-studio.js
 * @description Coordenador do modo Shape / Auto-Fit. O polígono é apenas um
 * molde: os vértices amostrados são enviados ao motor de rotas e a resposta
 * (linha vermelha) é desenhada sobre a forma, seguindo as ruas reais.
 *
 * Fluxo:
 * 1. `calcularWaypointsDaForma` amostra até 25 pontos ao redor do molde;
 * 2. `rotearPontos` resolve a rota multi-ponto com o perfil ativo;
 * 3. `desenharRota` pinta a linha vermelha; a distância alimenta o painel;
 * 4. `usarRotaAtual` injeta a geometria no desenho oficial e destrói o molde.
 *
 * Qualquer transformação (mover, rodar, redimensionar) agenda um novo ajuste
 * com debounce; cálculos antigos são abortados por versão + AbortController.
 */

import {
  fidelityMetrics,
  haversine,
  removerDuplicados,
  sampleShapeWaypoints,
  totalLength,
} from '../core/geo.js';
import { getCampo } from '../core/state.js';
import { rotearPontos } from '../services/api.js';
import { mostrarToast } from '../ui/toast.js';
import {
  atualizarPainelForma,
  definirAlvoKm,
  destacarFormaSelecionada,
  formatarKm,
  inicializarPainelForma,
  mostrarPainelForma,
  obterAlvoKm,
  FORMAS_PAINEL,
} from '../ui/shape-panel.js';
import { importarRota } from './draw.js';
import { getMap } from './map.js';
import {
  SHAPE_DEFAULT_SIZE_M,
  SHAPE_MIN_SIZE_M,
  atualizarForma,
  criarForma,
  getForma,
  removerForma,
} from './shapes.js';

const ID_FORMA = 'forma-ativa';
const N_MIN = 6;
const N_MAX = 25;
const PASSO_ALVO_M = 300;
const ATRASO_AJUSTE_MS = 420;
const ALVO_MIN_KM = 0.2;
const ALVO_MAX_KM = 60;
const TAMANHO_MAX_M = 20_000;
const METROS_POR_GRAU = 111_320;

let formaId = null;
let formaNome = 'estrela';
let alvoKm = 2;
let rota = null;
let camadaRota = null;
let versao = 0;
let controlador = null;
let temporizador = null;
let estadoCalculo = 'idle';
let mensagem = '';
let aoSairDoModo = () => {};

function limitar(valor, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, valor));
}

function arredondarKm(valor) {
  return Math.round(valor * 10) / 10;
}

/**
 * Converte `latlngs` públicos da forma em pares `[lat, lng]`.
 * @param {Object|null} forma
 * @returns {Array<[number, number]>}
 */
export function paresDaForma(forma) {
  const lista = Array.isArray(forma?.latlngs) ? forma.latlngs : [];

  return lista
    .map((ponto) => [Number(ponto?.lat), Number(ponto?.lng)])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
}

function formaFechada(forma) {
  return Boolean(forma?.shape?.closed ?? forma?.shape?.type === 'polygon');
}

/**
 * Perímetro do molde em metros (fecha o anel quando necessário).
 * @param {Object|null} forma
 * @returns {number}
 */
export function perimetroDaForma(forma) {
  const pares = paresDaForma(forma);
  if (pares.length < 2) return 0;

  return totalLength(formaFechada(forma) ? [...pares, pares[0]] : pares);
}

/**
 * Amostra os waypoints que serão enviados ao motor de rotas.
 * O número de pontos cresce com o perímetro, limitado a 25 (limite da API).
 * Formas fechadas devolvem o primeiro ponto também no fim para fechar o laço.
 * @param {Object|null} forma
 * @returns {Array<[number, number]>}
 */
export function calcularWaypointsDaForma(forma) {
  const pares = paresDaForma(forma);
  if (pares.length < 2) return [];

  const fechada = formaFechada(forma);
  let abertos = removerDuplicados(pares, 0.5);

  if (fechada && abertos.length > 3) {
    const primeiro = abertos[0];
    const ultimo = abertos[abertos.length - 1];
    if (haversine(primeiro, ultimo) <= 1) abertos = abertos.slice(0, -1);
  }

  if (abertos.length < 2) return [];

  const perimetro = totalLength(fechada ? [...abertos, abertos[0]] : abertos);
  const quantidade = limitar(Math.round(perimetro / PASSO_ALVO_M), N_MIN, N_MAX);
  const amostras = sampleShapeWaypoints(
    abertos,
    fechada ? Math.max(2, quantidade - 1) : quantidade,
  );

  if (amostras.length < 2) return [];

  const waypoints = fechada ? [...amostras, [amostras[0][0], amostras[0][1]]] : amostras;

  return removerDuplicados(waypoints, 0.5);
}

function perfilAtual() {
  return getCampo('perfilRota') === 'foot' ? 'foot' : 'bike';
}

function dimensaoFormatada(metros) {
  const valor = Number(metros);
  if (!Number.isFinite(valor) || valor <= 0) return '—';
  return valor >= 1000 ? `${formatarKm(valor / 1000)} km` : `${Math.round(valor)} m`;
}

function resumoDaForma(forma) {
  const nome = FORMAS_PAINEL[formaNome] ?? 'Forma';
  if (!forma) return nome;

  const largura = forma.size * (forma.scaleX ?? 1);
  const altura = forma.size * (forma.scaleY ?? 1);
  const rotacao = Math.round(Number(forma.rotation) || 0);

  return `${nome} · ${dimensaoFormatada(largura)} × ${dimensaoFormatada(altura)} · ${rotacao}°`;
}

function limparCamadaRota() {
  if (!camadaRota) return;
  getMap().removeLayer(camadaRota);
  camadaRota = null;
}

function desenharRota() {
  limparCamadaRota();
  if (!Array.isArray(rota) || rota.length < 2) return;

  camadaRota = L.polyline(
    rota.map(([lat, lng]) => [lat, lng]),
    {
      color: '#e53935',
      weight: 5,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
      className: 'rota-forma',
    },
  ).addTo(getMap());
}

function publicar(extra = {}) {
  const forma = formaId ? getForma(formaId) : null;
  const distanciaKm = Array.isArray(rota) ? totalLength(rota) / 1000 : null;
  const calculando = estadoCalculo === 'calculando';

  atualizarPainelForma({
    resumo: resumoDaForma(forma),
    alvoKm,
    distanciaKm,
    status: extra.status ?? (mensagem || 'Mova, rode ou redimensione: a rota acompanha as ruas.'),
    podeUsar: Boolean(rota && rota.length >= 2) && estadoCalculo === 'pronto',
    calculando,
  });
}

function cancelarCalculo() {
  clearTimeout(temporizador);
  temporizador = null;
  versao += 1;
  controlador?.abort();
  controlador = null;
}

function agendarAjuste(atraso = ATRASO_AJUSTE_MS) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    temporizador = null;
    void ajustarForma();
  }, atraso);
}

async function rotearWaypoints(waypoints, sinal) {
  if (!Array.isArray(waypoints) || waypoints.length < 3) return null;

  return rotearPontos(
    waypoints.map(([lat, lng]) => ({ lat, lng })),
    { perfil: perfilAtual(), sinal },
  );
}

/**
 * Recalcula a rota da forma atual e redesenha a linha vermelha.
 * @returns {Promise<Array<[number, number, number]>|null>}
 */
export async function ajustarForma() {
  const forma = formaId ? getForma(formaId) : null;
  if (!forma) return null;

  clearTimeout(temporizador);
  temporizador = null;

  const meu = ++versao;
  controlador?.abort();
  controlador = new AbortController();

  const waypoints = calcularWaypointsDaForma(forma);

  if (waypoints.length < 3) {
    estadoCalculo = 'erro';
    mensagem = 'A forma é pequena demais para encaixar nas ruas. Aumente a distância alvo.';
    limparCamadaRota();
    rota = null;
    publicar();
    return null;
  }

  estadoCalculo = 'calculando';
  mensagem = 'Calculando rota nas ruas…';
  publicar();

  const resultado = await rotearWaypoints(waypoints, controlador.signal);
  if (meu !== versao) return null;

  if (!resultado) {
    estadoCalculo = 'erro';
    mensagem = 'Não foi possível encaixar a forma nas ruas. Tente outro local ou outra forma.';
    limparCamadaRota();
    rota = null;
    publicar();
    mostrarToast('Não foi possível encaixar a forma nas ruas.', { tipo: 'erro' });
    return null;
  }

  rota = resultado;
  estadoCalculo = 'pronto';
  mensagem = 'Rota encaixada nas ruas. Use “Use this route” para incorporar ao desenho.';
  desenharRota();
  publicar();
  return resultado;
}

/**
 * Agenda um novo Auto-Fit (usado após criar/transformar a forma).
 * @param {number} [atraso]
 */
export function agendarAutoFit(atraso = ATRASO_AJUSTE_MS) {
  if (!formaId) return;
  agendarAjuste(atraso);
}

function callbackTransformacao() {
  estadoCalculo = 'calculando';
  mensagem = 'Recalculando a rota nas ruas…';
  publicar();
  agendarAjuste(120);
}

function criarFormaNoMapa({ centro, tamanho, rotacao = 0 } = {}) {
  const mapa = getMap();
  const base = centro ?? mapa.getCenter();

  const forma = criarForma({
    id: ID_FORMA,
    shape: formaNome,
    center: { lat: Number(base.lat), lng: Number(base.lng) },
    size: tamanho ?? SHAPE_DEFAULT_SIZE_M,
    rotation: rotacao,
    interativa: true,
    callbacks: {
      onTransformEnd: callbackTransformacao,
      onMove: callbackTransformacao,
      onSizeChange: () => publicar(),
      onRotationChange: () => publicar(),
      onScaleChange: () => publicar(),
    },
  });

  formaId = forma?.id ?? null;
  rota = null;
  estadoCalculo = 'idle';
  mensagem = '';
  limparCamadaRota();

  const perimetro = perimetroDaForma(getForma(formaId));
  if (perimetro > 0) {
    alvoKm = limitar(arredondarKm(perimetro / 1000), ALVO_MIN_KM, ALVO_MAX_KM);
    definirAlvoKm(alvoKm);
  }

  publicar();
  return forma;
}

/**
 * Entra no modo Shape: abre o painel e cria o molde se ainda não existir.
 */
export function abrirEstudioForma() {
  destacarFormaSelecionada(formaNome);
  mostrarPainelForma(true);

  if (!formaId || !getForma(formaId)) {
    criarFormaNoMapa();
    agendarAjuste(150);
  } else {
    publicar();
    agendarAjuste(0);
  }
}

/**
 * Sai do modo Shape e destrói molde, alças e rota de encaixe.
 */
export function fecharEstudioForma() {
  cancelarCalculo();
  limparCamadaRota();
  if (formaId) removerForma(formaId);

  formaId = null;
  rota = null;
  estadoCalculo = 'idle';
  mensagem = '';
  mostrarPainelForma(false);
  document.body.classList.remove('modo-forma');
}

/**
 * Recalcula imediatamente (ex.: troca de perfil Cycling/Walking).
 */
export function reajustarEstudioForma() {
  if (!formaId) return;
  publicar();
  agendarAjuste(0);
}

/**
 * Troca o tipo de forma mantendo centro, tamanho e rotação.
 * @param {string} nome
 */
export function selecionarForma(nome) {
  if (!FORMAS_PAINEL[nome] || nome === formaNome) return;

  const atual = formaId ? getForma(formaId) : null;
  const centro = atual?.center ?? getMap().getCenter();
  const tamanho = atual?.size ?? SHAPE_DEFAULT_SIZE_M;
  const rotacao = atual?.rotation ?? 0;

  cancelarCalculo();
  if (formaId) removerForma(formaId);

  formaNome = nome;
  destacarFormaSelecionada(nome);
  criarFormaNoMapa({ centro, tamanho, rotacao });
  agendarAjuste(120);
}

/**
 * Redimensiona o molde para que o perímetro se aproxime da distância alvo.
 * @param {number} valorKm
 */
export function atualizarAlvo(valorKm) {
  const forma = formaId ? getForma(formaId) : null;
  if (!forma) return;

  const alvo = limitar(Number(valorKm), ALVO_MIN_KM, ALVO_MAX_KM);
  if (!Number.isFinite(alvo)) return;

  const perimetro = perimetroDaForma(forma);
  if (perimetro <= 1) return;

  const tamanho = limitar(
    forma.size * ((alvo * 1000) / perimetro),
    SHAPE_MIN_SIZE_M,
    TAMANHO_MAX_M,
  );

  alvoKm = arredondarKm(alvo);
  definirAlvoKm(alvoKm);
  atualizarForma(formaId, { size: tamanho });
  estadoCalculo = 'calculando';
  mensagem = 'Ajustando a forma ao novo tamanho…';
  publicar();
  agendarAjuste(120);
}

function deslocarCentro(centro, metros, azimuteGraus) {
  const rad = (azimuteGraus * Math.PI) / 180;
  const dLat = (metros * Math.cos(rad)) / METROS_POR_GRAU;
  const dLng =
    (metros * Math.sin(rad)) /
    (METROS_POR_GRAU * Math.max(0.01, Math.cos((centro.lat * Math.PI) / 180)));

  return { lat: centro.lat + dLat, lng: centro.lng + dLng };
}

/**
 * Procura um posicionamento/rotação alternativo que aproxime a rota das ruas
 * da distância alvo (e da silhueta do molde). Até 3 tentativas de roteamento.
 * @returns {Promise<boolean>}
 */
export async function procurarMelhorEncaixe() {
  const base = formaId ? getForma(formaId) : null;
  if (!base) return false;
  if (estadoCalculo === 'calculando') return false;

  clearTimeout(temporizador);
  temporizador = null;

  const meu = ++versao;
  controlador?.abort();
  controlador = new AbortController();
  estadoCalculo = 'calculando';
  mensagem = 'Procurando um melhor encaixe nas ruas…';
  publicar();

  const candidatos = [
    { rotation: base.rotation, center: base.center },
    { rotation: base.rotation + 15, center: base.center },
    { rotation: base.rotation - 15, center: deslocarCentro(base.center, base.size * 0.15, 45) },
  ];

  let melhor = null;

  try {
    for (const candidato of candidatos) {
      if (meu !== versao) return false;

      atualizarForma(formaId, { rotation: candidato.rotation, center: candidato.center });
      const forma = getForma(formaId);
      const waypoints = calcularWaypointsDaForma(forma);
      if (waypoints.length < 3) continue;

      const resultado = await rotearWaypoints(waypoints, controlador.signal);
      if (meu !== versao) return false;
      if (!resultado) continue;

      const distancia = totalLength(resultado) / 1000;
      const desvio = fidelityMetrics(resultado, paresDaForma(forma)).mediaM;
      const score = Math.abs(distancia - alvoKm) / Math.max(alvoKm, ALVO_MIN_KM) + desvio / 800;

      if (!melhor || score < melhor.score) {
        melhor = { score, rotation: candidato.rotation, center: candidato.center, rota: resultado };
      }
    }
  } finally {
    if (meu === versao) controlador = null;
  }

  if (meu !== versao) return false;

  if (!melhor) {
    atualizarForma(formaId, { rotation: base.rotation, center: base.center });
    estadoCalculo = 'erro';
    mensagem = 'Nenhum encaixe melhor encontrado por perto. Tente mover a forma.';
    publicar();
    mostrarToast('Nenhum encaixe melhor encontrado por perto.', { tipo: 'aviso' });
    return false;
  }

  atualizarForma(formaId, { rotation: melhor.rotation, center: melhor.center });
  rota = melhor.rota;
  estadoCalculo = 'pronto';
  mensagem = 'Melhor encaixe encontrado. Ajuste fino: arraste as alças verdes.';
  desenharRota();
  publicar();
  mostrarToast('Melhor encaixe encontrado.', { tipo: 'sucesso', duracao: 2000 });
  return true;
}

/**
 * Incorpora a rota do Auto-Fit ao desenho oficial e destrói o molde.
 * @returns {Promise<boolean>}
 */
export async function usarRotaAtual() {
  if (!Array.isArray(rota) || rota.length < 2) {
    mostrarToast('Calcule a rota da forma antes de usá-la.', { tipo: 'aviso' });
    return false;
  }
  if (estadoCalculo === 'calculando') return false;

  const nome = FORMAS_PAINEL[formaNome] ?? 'forma';
  const incorporada = await importarRota(rota);
  if (!incorporada) return false;

  fecharEstudioForma();
  mostrarToast(`Rota da ${nome.toLowerCase()} adicionada ao desenho.`, {
    tipo: 'sucesso',
    duracao: 2500,
  });
  aoSairDoModo();
  return true;
}

/**
 * Remove o molde atual e volta para o modo de pontos.
 */
export function removerFormaAtual() {
  fecharEstudioForma();
  mostrarToast('Forma removida.', { tipo: 'info', duracao: 1800 });
  aoSairDoModo();
}

/**
 * Liga o painel e as ações do estúdio de formas.
 * @param {{aoSairDoModo?:()=>void}} [opcoes]
 */
export function inicializarEstudioForma({ aoSairDoModo: aoSair } = {}) {
  if (typeof aoSair === 'function') aoSairDoModo = aoSair;

  inicializarPainelForma({
    onSelecionarForma: selecionarForma,
    onAlvoChange: atualizarAlvo,
    onMelhorLocal: () => void procurarMelhorEncaixe(),
    onUsarRota: () => void usarRotaAtual(),
    onRemover: removerFormaAtual,
    onFechar: removerFormaAtual,
  });

  definirAlvoKm(obterAlvoKm());
}
