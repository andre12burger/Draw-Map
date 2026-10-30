'use strict';

/**
 * @file server/routes/route.js
 * @description Rota de roteamento (`GET /api/rota`) que atua como proxy do BRouter,
 * com validação estrita, allowlist de perfis, cache de 1 h e timeout.
 */

const express = require('express');
const config = require('../config');
const CacheTTL = require('../lib/cache');
const geo = require('../lib/geo');
const { ErroUpstream, asyncHandler, buscarJson, responderErroUpstream } = require('../lib/http');
const {
  validarLonLats,
  normalizarPerfil,
  validarPontosRota,
  mapearPerfilRota,
  MAX_METROS_POR_PERNA,
} = require('../lib/validators');

const cache = new CacheTTL({ ttlMs: config.routeCacheTtlMs, maxEntradas: 500 });
const cachePontos = new CacheTTL({ ttlMs: config.routeCacheTtlMs, maxEntradas: 500 });

const TIMEOUT_PERNA_MS = 8_000;
const TIMEOUT_TOTAL_MS = 25_000;

/**
 * Chave de cache estável (5 casas decimais ≈ 1 m) por perfil e sequência de pontos.
 * @param {string} perfil
 * @param {Array<[number, number]>} pontos
 * @returns {string}
 */
function chaveCachePontos(perfil, pontos) {
  return `${perfil}|${pontos.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(';')}`;
}

/**
 * Extrai coordenadas `[lat, lng]`, distância e duração de uma resposta GeoJSON
 * do BRouter (`track-length`/`total-time`), com fallback para Haversine.
 * @param {any} dados
 * @returns {{coordinates:Array<[number,number]>, distance:number, duration:number}}
 */
function extrairPerna(dados) {
  const feature = dados?.features?.[0];
  const coordenadas = feature?.geometry?.coordinates;

  if (!Array.isArray(coordenadas) || coordenadas.length < 2) {
    throw new ErroUpstream('O roteador devolveu uma geometria inválida.', { status: 502 });
  }

  const pontos = coordenadas
    .map((coordenada) => [Number(coordenada?.[1]), Number(coordenada?.[0])])
    .filter((ponto) => geo.pontoValido(ponto));

  if (pontos.length < 2) {
    throw new ErroUpstream('O roteador devolveu uma geometria inválida.', { status: 502 });
  }

  const propriedades = feature?.properties ?? {};
  const distancia = Number(propriedades['track-length']);
  const duracao = Number(propriedades['total-time']);

  return {
    coordinates: pontos,
    distance: Number.isFinite(distancia) && distancia > 0 ? distancia : geo.totalLength(pontos),
    duration: Number.isFinite(duracao) && duracao > 0 ? duracao : 0,
  };
}

/**
 * Roteia uma perna pelo BRouter com timeout próprio.
 * @param {[number, number]} inicio - `[lat, lng]`.
 * @param {[number, number]} fim - `[lat, lng]`.
 * @param {string} perfil - perfil do BRouter.
 * @param {number} timeoutMs
 * @returns {Promise<{coordinates:Array<[number,number]>, distance:number, duration:number}>}
 */
async function rotearPerna(inicio, fim, perfil, timeoutMs) {
  const url = new URL(config.brouterUrl);
  url.searchParams.set('lonlats', `${inicio[1]},${inicio[0]}|${fim[1]},${fim[0]}`);
  url.searchParams.set('profile', perfil);
  url.searchParams.set('format', 'geojson');
  url.searchParams.set('alternativeidx', '0');

  try {
    const dados = await buscarJson(url, { timeoutMs });
    return extrairPerna(dados);
  } catch (erro) {
    if (
      erro instanceof ErroUpstream &&
      Number(erro.statusExterno) >= 400 &&
      Number(erro.statusExterno) < 500
    ) {
      throw new ErroUpstream('O roteador não encontrou rota para uma das pernas.', {
        status: 422,
        statusExterno: erro.statusExterno,
        causa: erro,
      });
    }
    throw erro;
  }
}

function criarRotasRota() {
  const router = express.Router();

  /**
   * POST /api/route-points
   * Roteia 2–25 pontos (25 no máximo), validando cada perna (≤ 8000 m),
   * com cache em memória de 500 entradas e orçamento total de 25 s.
   * Corpo: `{ points: [[lat, lng], ...], profile?: 'bike' | 'foot' }`.
   */
  router.post(
    '/route-points',
    asyncHandler(async (req, res) => {
      const validacao = validarPontosRota(req.body?.points);
      if (!validacao.valido) {
        return res.status(400).json({ erro: validacao.erro });
      }

      const perfil = mapearPerfilRota(req.body?.profile ?? 'bike');
      if (!perfil) {
        return res.status(400).json({ erro: 'Perfil inválido. Use "bike" ou "foot".' });
      }

      const pontos = validacao.valor;

      for (let i = 1; i < pontos.length; i += 1) {
        const distancia = geo.haversine(pontos[i - 1], pontos[i]);
        if (distancia > MAX_METROS_POR_PERNA) {
          return res.status(422).json({
            erro: `A perna ${i} tem ${Math.round(distancia)} m; o máximo permitido é ${MAX_METROS_POR_PERNA} m.`,
          });
        }
      }

      const chave = chaveCachePontos(perfil, pontos);
      const emCache = cachePontos.get(chave);
      if (emCache) {
        return res.set('X-Cache', 'HIT').set('Cache-Control', 'public, max-age=3600').json(emCache);
      }

      const inicioExecucao = Date.now();

      try {
        const pernas = [];

        for (let i = 1; i < pontos.length; i += 1) {
          const restante = TIMEOUT_TOTAL_MS - (Date.now() - inicioExecucao);
          if (restante <= 0) {
            throw new ErroUpstream('O roteamento excedeu o tempo limite total.', { status: 504 });
          }

          pernas.push(
            await rotearPerna(
              pontos[i - 1],
              pontos[i],
              perfil,
              Math.min(TIMEOUT_PERNA_MS, restante),
            ),
          );
        }

        const ultima = pernas[pernas.length - 1];
        const resposta = {
          coordinates: pernas.reduce(
            (acumulado, perna, indice) =>
              acumulado.concat(indice === 0 ? perna.coordinates : perna.coordinates.slice(1)),
            [],
          ),
          distance_m: pernas.reduce((soma, perna) => soma + perna.distance, 0),
          duration_s: pernas.reduce((soma, perna) => soma + perna.duration, 0),
          snapped_waypoints: pernas
            .map((perna) => perna.coordinates[0])
            .concat([ultima.coordinates[ultima.coordinates.length - 1]]),
          legs: pernas.map((perna) => ({
            distance_m: Math.round(perna.distance),
            duration_s: Math.round(perna.duration),
          })),
          profile: perfil,
        };

        cachePontos.set(chave, resposta);

        return res
          .set('X-Cache', 'MISS')
          .set('Cache-Control', 'public, max-age=3600')
          .json(resposta);
      } catch (erro) {
        return responderErroUpstream(res, erro, 'roteamento multi-ponto');
      }
    }),
  );

  router.get(
    '/rota',
    asyncHandler(async (req, res) => {
      const validacao = validarLonLats(req.query.lonlats);
      if (!validacao.valido) {
        return res.status(400).json({ erro: validacao.erro });
      }

      const perfil = normalizarPerfil(req.query.profile);
      const chave = `${perfil}:${validacao.valor}`;
      const emCache = cache.get(chave);

      if (emCache) {
        return res.set('X-Cache', 'HIT').set('Cache-Control', 'public, max-age=3600').json(emCache);
      }

      const url = new URL(config.brouterUrl);
      url.searchParams.set('lonlats', validacao.valor);
      url.searchParams.set('profile', perfil);
      url.searchParams.set('format', 'geojson');
      url.searchParams.set('alternativeidx', '0');

      try {
        const dados = await buscarJson(url);

        if (!dados || !Array.isArray(dados.features) || dados.features.length === 0) {
          throw new ErroUpstream('Nenhuma rota foi encontrada para os pontos informados.', {
            status: 422,
          });
        }

        const geometria = dados.features[0]?.geometry?.coordinates;
        if (!Array.isArray(geometria) || geometria.length < 2) {
          throw new ErroUpstream('O roteador devolveu uma geometria inválida.', { status: 502 });
        }

        cache.set(chave, dados);

        return res.set('X-Cache', 'MISS').set('Cache-Control', 'public, max-age=3600').json(dados);
      } catch (erro) {
        return responderErroUpstream(res, erro, 'roteamento');
      }
    }),
  );

  return router;
}

module.exports = criarRotasRota;
