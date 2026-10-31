/**
 * @file core/persistence.js
 * @description Persistência do estado no LocalStorage, com versionamento,
 * sanitização defensiva e exclusão do histórico de undo.
 */

export const CHAVE_ESTADO = 'strava_art_state';
export const VERSAO_ESTADO = 2;
export const NOME_ROTA_PADRAO = 'Strava Art Route';

const FERRAMENTAS = new Set(['rua', 'livre', 'lapis']);
const MODOS_TRACO = new Set(['rua', 'livre']);
const PERFIS_ROTA = new Set(['bike', 'foot']);
const PERFIS_UI = new Set(['bike', 'foot', 'free']);

function numeroValido(valor, minimo, maximo) {
  return Number.isFinite(valor) && valor >= minimo && valor <= maximo;
}

/**
 * @param {unknown} valor
 * @returns {{lat:number, lng:number}|null}
 */
function normalizarPonto(valor) {
  if (!valor || typeof valor !== 'object') return null;
  const lat = Number(valor.lat);
  const lng = Number(valor.lng);
  if (!numeroValido(lat, -90, 90) || !numeroValido(lng, -180, 180)) return null;
  return { lat, lng };
}

/**
 * Normaliza um ponto de segmento no formato [lat, lng, ele?].
 * @param {unknown} valor
 * @returns {[number, number, number?]|null}
 */
function normalizarPontoSegmento(valor) {
  if (!Array.isArray(valor) || valor.length < 2) return null;
  const lat = Number(valor[0]);
  const lng = Number(valor[1]);
  if (!numeroValido(lat, -90, 90) || !numeroValido(lng, -180, 180)) return null;

  const ele = Number(valor[2]);
  return Number.isFinite(ele) ? [lat, lng, ele] : [lat, lng];
}

/**
 * Reconstrói um estado consistente a partir de dados possivelmente antigos/corrompidos.
 * Segmentos inválidos são substituídos por uma reta entre os pontos vizinhos, o que
 * mantém o desenho coerente em vez de descartar toda a rota do usuário.
 * @param {unknown} dados
 * @returns {Object|null}
 */
export function sanitizarEstado(dados) {
  if (!dados || typeof dados !== 'object') return null;

  const coordenadasBrutas = Array.isArray(dados.coordenadasNiveis) ? dados.coordenadasNiveis : [];
  const modosBrutos = Array.isArray(dados.modosTraco) ? dados.modosTraco : [];
  const segmentosBrutos = Array.isArray(dados.segmentosRota) ? dados.segmentosRota : [];

  if (coordenadasBrutas.length === 0) return null;

  const coordenadas = [];
  for (const bruta of coordenadasBrutas) {
    const ponto = normalizarPonto(bruta);
    if (!ponto) break;
    coordenadas.push(ponto);
  }

  if (coordenadas.length === 0) return null;

  const modos = coordenadas.map((_, indice) =>
    MODOS_TRACO.has(modosBrutos[indice]) ? modosBrutos[indice] : 'rua',
  );

  const segmentos = coordenadas.map((coordenada, indice) => {
    if (indice === 0) return [[coordenada.lat, coordenada.lng]];

    const bruto = segmentosBrutos[indice];
    const pontos = Array.isArray(bruto) ? bruto.map(normalizarPontoSegmento).filter(Boolean) : [];

    if (pontos.length >= 2) return pontos;

    const anterior = coordenadas[indice - 1];
    return [
      [anterior.lat, anterior.lng],
      [coordenada.lat, coordenada.lng],
    ];
  });

  const mapa = dados.mapa;
  const mapaValido =
    mapa &&
    numeroValido(Number(mapa.lat), -90, 90) &&
    numeroValido(Number(mapa.lng), -180, 180) &&
    numeroValido(Number(mapa.zoom), 1, 19)
      ? { lat: Number(mapa.lat), lng: Number(mapa.lng), zoom: Number(mapa.zoom) }
      : null;

  return {
    versao: VERSAO_ESTADO,
    coordenadasNiveis: coordenadas,
    segmentosRota: segmentos,
    modosTraco: modos,
    ferramentaAtiva: FERRAMENTAS.has(dados.ferramentaAtiva) ? dados.ferramentaAtiva : 'rua',
    perfilRota: PERFIS_ROTA.has(dados.perfilRota) ? dados.perfilRota : 'bike',
    perfilUi: PERFIS_UI.has(dados.perfilUi) ? dados.perfilUi : 'bike',
    nomeRota:
      typeof dados.nomeRota === 'string' && dados.nomeRota.trim().length > 0
        ? dados.nomeRota.trim().slice(0, 80)
        : NOME_ROTA_PADRAO,
    distanciaTotal: numeroValido(Number(dados.distanciaTotal), 0, Number.MAX_SAFE_INTEGER)
      ? Number(dados.distanciaTotal)
      : 0,
    contadorPontos: coordenadas.length,
    mapa: mapaValido,
    atualizadoEm: new Date().toISOString(),
  };
}

/**
 * Extrai somente os campos que devem ir para o LocalStorage.
 * `historicoEstados` e estados transitórios de UI ficam de fora.
 * @param {Object} estado
 * @returns {Object}
 */
export function extrairPersistivel(estado) {
  return {
    versao: VERSAO_ESTADO,
    coordenadasNiveis: estado.coordenadasNiveis,
    segmentosRota: estado.segmentosRota,
    modosTraco: estado.modosTraco,
    ferramentaAtiva: estado.ferramentaAtiva,
    perfilRota: estado.perfilRota,
    perfilUi: estado.perfilUi,
    nomeRota: estado.nomeRota,
    distanciaTotal: estado.distanciaTotal,
    contadorPontos: estado.contadorPontos,
    mapa: estado.mapa,
    atualizadoEm: estado.atualizadoEm,
  };
}

/**
 * @param {Object} estado
 * @returns {boolean}
 */
export function salvarEstado(estado) {
  try {
    window.localStorage.setItem(CHAVE_ESTADO, JSON.stringify(extrairPersistivel(estado)));
    return true;
  } catch (erro) {
    console.error('❌ Erro ao salvar estado:', erro);
    window.dispatchEvent(
      new CustomEvent('app:storage-error', {
        detail: { mensagem: 'Não foi possível salvar o progresso no navegador.', erro },
      }),
    );
    return false;
  }
}

/**
 * @returns {Object|null}
 */
export function carregarEstado() {
  try {
    const salvo = window.localStorage.getItem(CHAVE_ESTADO);
    if (!salvo) return null;
    return sanitizarEstado(JSON.parse(salvo));
  } catch (erro) {
    console.error('❌ Erro ao carregar estado:', erro);
    return null;
  }
}

export function limparEstado() {
  try {
    window.localStorage.removeItem(CHAVE_ESTADO);
    return true;
  } catch (erro) {
    console.error('❌ Erro ao limpar estado:', erro);
    return false;
  }
}
