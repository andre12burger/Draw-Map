/**
 * @file services/api.js
 * @description Comunicação com o Web Service local. Centraliza timeout, cancelamento,
 * retentativas apenas para falhas transitórias e contagem de requisições reais.
 */

const PERFIL = 'shortest';
const TIMEOUT_MS = 15_000;
const MAX_TENTATIVAS = 3;
const ATRASO_BASE_MS = 500;

const STATUS_RETENTAVEIS = new Set([408, 425, 429, 500, 502, 503, 504]);

let totalRequisicoes = 0;
const ouvintesContador = new Set();

class ErroHttp extends Error {
  constructor(mensagem, status = null, causa = null) {
    super(mensagem);
    this.name = 'ErroHttp';
    this.status = status;
    this.causa = causa;
  }
}

/**
 * @param {(total:number)=>void} callback
 * @returns {() => void}
 */
export function inscreverContadorRequisicoes(callback) {
  ouvintesContador.add(callback);
  callback(totalRequisicoes);
  return () => ouvintesContador.delete(callback);
}

export function getTotalRequisicoes() {
  return totalRequisicoes;
}

function registrarRequisicao() {
  totalRequisicoes += 1;
  for (const ouvinte of ouvintesContador) {
    try {
      ouvinte(totalRequisicoes);
    } catch (erro) {
      console.error('Erro no contador de requisições:', erro);
    }
  }
}

function combinarSinal(controlador, sinalExterno) {
  if (!sinalExterno) return () => {};
  const abortar = () => controlador.abort();

  if (sinalExterno.aborted) {
    controlador.abort();
    return () => {};
  }

  sinalExterno.addEventListener('abort', abortar, { once: true });
  return () => sinalExterno.removeEventListener('abort', abortar);
}

/**
 * @param {string} url
 * @param {{timeout?:number, contar?:boolean, sinal?:AbortSignal|null, metodo?:string, corpo?:any}} [opcoes]
 * @returns {Promise<Response>}
 */
async function requisitar(
  url,
  { timeout = TIMEOUT_MS, contar = true, sinal = null, metodo = 'GET', corpo = null } = {},
) {
  if (contar) registrarRequisicao();

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeout);
  const removerOuvinte = combinarSinal(controlador, sinal);

  const cabecalhos = { Accept: 'application/json' };
  const opcoesFetch = { method: metodo, signal: controlador.signal, headers: cabecalhos };

  if (corpo !== null && corpo !== undefined) {
    cabecalhos['Content-Type'] = 'application/json';
    opcoesFetch.body = JSON.stringify(corpo);
  }

  try {
    return await fetch(url, opcoesFetch);
  } finally {
    clearTimeout(temporizador);
    removerOuvinte();
  }
}

function erroDeResposta(resposta) {
  return new ErroHttp(`Servidor respondeu ${resposta.status}`, resposta.status);
}

function podeTentarNovamente(erro, tentativa, maxTentativas) {
  if (tentativa >= maxTentativas) return false;
  if (erro?.name === 'AbortError') return false;
  if (!erro?.status) return true; // falha de rede
  return STATUS_RETENTAVEIS.has(erro.status);
}

async function esperar(tentativa) {
  const atraso = ATRASO_BASE_MS * 2 ** (tentativa - 1);
  await new Promise((resolver) => setTimeout(resolver, atraso));
}

/**
 * Executa uma função com retentativa exponencial.
 * @template T
 * @param {() => Promise<T>} operacao
 * @param {number} [maxTentativas=MAX_TENTATIVAS]
 * @returns {Promise<T|null>} null quando todas as tentativas falham.
 */

function coordenadasDaRota(dados) {
  const coordenadas = dados?.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordenadas) || coordenadas.length < 2) {
    throw new ErroHttp('Nenhuma rota encontrada', 422);
  }

  const pontos = coordenadas
    .map((coord) => [Number(coord[1]), Number(coord[0]), Number(coord[2]) || 0])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

  if (pontos.length < 2) throw new ErroHttp('Geometria de rota inválida', 502);
  return pontos;
}

function validarLatLng(ponto) {
  return (
    ponto &&
    Number.isFinite(Number(ponto.lat)) &&
    Number.isFinite(Number(ponto.lng)) &&
    Number(ponto.lat) >= -90 &&
    Number(ponto.lat) <= 90 &&
    Number(ponto.lng) >= -180 &&
    Number(ponto.lng) <= 180
  );
}

/**
 * @param {{lat:number,lng:number}} inicio
 * @param {{lat:number,lng:number}} fim
 * @param {{modoLivre?:boolean}} [opcoes]
 * @returns {Promise<Array<[number,number,number]>|null>}
 */
export async function buscarRota(inicio, fim, { modoLivre = false } = {}) {
  if (!validarLatLng(inicio) || !validarLatLng(fim)) return null;

  if (modoLivre) {
    return [
      [inicio.lat, inicio.lng, 0],
      [fim.lat, fim.lng, 0],
    ];
  }

  const parametros = new URLSearchParams({
    lonlats: `${inicio.lng},${inicio.lat}|${fim.lng},${fim.lat}`,
    profile: PERFIL,
  });
  const url = `/api/rota?${parametros.toString()}`;

  return comRetentativa(async () => {
    const resposta = await requisitar(url);
    if (!resposta.ok) throw erroDeResposta(resposta);
    return coordenadasDaRota(await resposta.json());
  });
}

const MAX_PONTOS_POR_REQUISICAO = 25;

/**
 * Roteia 2–25 pontos numa única chamada (`POST /api/route-points`), validando
 * as pernas no servidor (≤ 8000 m) e usando o cache de 500 entradas.
 * @param {Array<{lat:number,lng:number}>} pontos
 * @param {{perfil?:'bike'|'foot', timeout?:number, sinal?:AbortSignal|null}} [opcoes]
 * @returns {Promise<Array<[number,number,number]>|null>}
 */
export async function rotearPontos(pontos, { perfil = 'bike', timeout, sinal = null } = {}) {
  if (!Array.isArray(pontos) || pontos.length < 2) return null;
  if (pontos.length > MAX_PONTOS_POR_REQUISICAO) return null;
  if (!pontos.every(validarLatLng)) return null;

  const corpo = {
    points: pontos.map((ponto) => [Number(ponto.lat), Number(ponto.lng)]),
    profile: perfil === 'foot' ? 'foot' : 'bike',
  };

  return comRetentativa(async () => {
    const resposta = await requisitar('/api/route-points', {
      metodo: 'POST',
      corpo,
      ...(Number.isFinite(timeout) ? { timeout } : {}),
      sinal,
    });
    if (!resposta.ok) throw erroDeResposta(resposta);

    const dados = await resposta.json();
    const coordenadas = dados?.coordinates;
    if (!Array.isArray(coordenadas) || coordenadas.length < 2) {
      throw new ErroHttp('Rota multi-ponto inválida', 502);
    }

    const convertidas = coordenadas
      .map(([lat, lng]) => [Number(lat), Number(lng), 0])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

    if (convertidas.length < 2) throw new ErroHttp('Rota multi-ponto inválida', 502);
    return convertidas;
  });
}

/**
 * Roteia vários pontos em lotes sobrepostos sobre `GET /api/rota`. O primeiro
 * ponto do lote seguinte repete o último do lote anterior para manter a
 * continuidade geométrica. Para 2–25 pontos prefira `rotearPontos`.
 * @param {Array<{lat:number,lng:number}>} pontos
 * @returns {Promise<Array<[number,number,number]>|null>}
 */
export async function buscarRotaLote(pontos) {
  if (!Array.isArray(pontos) || pontos.length < 2) return null;
  if (!pontos.every(validarLatLng)) return null;

  const tamanhoLote = 40;
  let rotaCompleta = [];

  for (let inicio = 0; inicio < pontos.length; inicio += tamanhoLote - 1) {
    const lote = pontos.slice(inicio, inicio + tamanhoLote);
    if (lote.length < 2) continue;

    const parametros = new URLSearchParams({
      lonlats: lote.map((ponto) => `${ponto.lng},${ponto.lat}`).join('|'),
      profile: PERFIL,
    });
    const url = `/api/rota?${parametros.toString()}`;

    const trecho = await comRetentativa(async () => {
      const resposta = await requisitar(url);
      if (!resposta.ok) throw erroDeResposta(resposta);
      return coordenadasDaRota(await resposta.json());
    });

    if (!trecho) return null;
    if (inicio > 0) trecho.shift();
    rotaCompleta = rotaCompleta.concat(trecho);
  }

  return rotaCompleta.length >= 2 ? rotaCompleta : null;
}

/**
 * Projeta um ponto na via mais próxima usando uma rota fictícia de ~11 m.
 * @param {{lat:number,lng:number}} latlng
 * @returns {Promise<{lat:number,lng:number}|null>}
 */
export async function obterPontoRua(latlng) {
  if (!validarLatLng(latlng)) return null;

  const destino = { lat: latlng.lat + 0.0001, lng: latlng.lng + 0.0001 };
  const trecho = await buscarRota(latlng, destino, { modoLivre: false });
  if (!trecho || trecho.length === 0) return null;

  return { lat: trecho[0][0], lng: trecho[0][1] };
}

/**
 * Snap silencioso para o cursor fantasma: não entra no contador, tem timeout
 * curto e pode ser cancelado quando o mouse se move novamente.
 * @param {{lat:number,lng:number}} latlng
 * @param {{sinal?:AbortSignal|null}} [opcoes]
 * @returns {Promise<{lat:number,lng:number}|null>}
 */
export async function obterSnap(latlng, { sinal = null } = {}) {
  if (!validarLatLng(latlng)) return null;

  const destino = { lat: latlng.lat + 0.0001, lng: latlng.lng + 0.0001 };
  const parametros = new URLSearchParams({
    lonlats: `${latlng.lng},${latlng.lat}|${destino.lng},${destino.lat}`,
    profile: PERFIL,
  });

  try {
    const resposta = await requisitar(`/api/rota?${parametros.toString()}`, {
      timeout: 5_000,
      contar: false,
      sinal,
    });
    if (!resposta.ok) return null;

    const dados = await resposta.json();
    const coordenadas = dados?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coordenadas) || coordenadas.length === 0) return null;

    const lat = Number(coordenadas[0][1]);
    const lng = Number(coordenadas[0][0]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch (_erro) {
    return null;
  }
}

/**
 * @param {string} termo
 * @param {{sinal?:AbortSignal|null}} [opcoes]
 * @returns {Promise<Array<{lat:number,lng:number,nome:string}>|null>}
 */
export async function buscarEndereco(termo, { sinal = null } = {}) {
  const limpo = String(termo || '').trim();
  if (limpo.length < 2) return null;

  const parametros = new URLSearchParams({ q: limpo });

  try {
    const resposta = await requisitar(`/api/pesquisa?${parametros.toString()}`, { sinal });
    if (!resposta.ok) return null;

    const dados = await resposta.json();
    if (!Array.isArray(dados)) return null;

    return dados
      .map((local) => ({
        lat: Number(local.lat),
        lng: Number(local.lon),
        nome: String(local.display_name || ''),
      }))
      .filter(
        (local) =>
          Number.isFinite(local.lat) && Number.isFinite(local.lng) && local.nome.length > 0,
      );
  } catch (_erro) {
    return null;
  }
}

async function comRetentativa(operacao, maxTentativas = MAX_TENTATIVAS) {
  let tentativa = 1;

  while (tentativa <= maxTentativas) {
    try {
      return await operacao();
    } catch (erro) {
      if (!podeTentarNovamente(erro, tentativa, maxTentativas)) {
        const falhaInesperada = erro?.status == null || erro.status >= 500;
        if (erro?.name !== 'AbortError' && falhaInesperada) {
          console.error('Falha na requisição:', erro);
        }
        return null;
      }
      await esperar(tentativa);
      tentativa += 1;
    }
  }

  return null;
}
