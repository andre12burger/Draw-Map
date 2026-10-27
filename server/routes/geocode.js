'use strict';

/**
 * @file server/routes/geocode.js
 * @description Rota de geocodificação (`GET /api/pesquisa`) que atua como proxy
 * do Nominatim/OpenStreetMap, com validação, cache de 24 h e resposta reduzida.
 */

const express = require('express');
const config = require('../config');
const CacheTTL = require('../lib/cache');
const { asyncHandler, buscarJson, responderErroUpstream } = require('../lib/http');
const { validarTermoBusca } = require('../lib/validators');

const cache = new CacheTTL({ ttlMs: config.geocodeCacheTtlMs, maxEntradas: 1000 });

function criarRotasGeocode() {
  const router = express.Router();

  router.get(
    '/pesquisa',
    asyncHandler(async (req, res) => {
      const validacao = validarTermoBusca(req.query.q);
      if (!validacao.valido) {
        return res.status(400).json({ erro: validacao.erro });
      }

      const termo = validacao.valor;
      const chave = termo.toLowerCase();
      const emCache = cache.get(chave);

      if (emCache) {
        return res
          .set('X-Cache', 'HIT')
          .set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600')
          .json(emCache);
      }

      const url = new URL('/search', config.nominatimUrl);
      url.searchParams.set('q', termo);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '5');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('dedupe', '1');

      try {
        const dados = await buscarJson(url, {
          headers: { 'User-Agent': `${config.userAgent} Nominatim` },
        });

        if (!Array.isArray(dados)) {
          return res.status(502).json({ erro: 'Resposta inválida do serviço de geocodificação.' });
        }

        const resultados = dados
          .map((local) => ({
            lat: Number(local.lat),
            lon: Number(local.lon),
            display_name: String(local.display_name || ''),
          }))
          .filter(
            (local) =>
              Number.isFinite(local.lat) &&
              Number.isFinite(local.lon) &&
              local.display_name.length > 0,
          );

        cache.set(chave, resultados);

        return res
          .set('X-Cache', 'MISS')
          .set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600')
          .json(resultados);
      } catch (erro) {
        return responderErroUpstream(res, erro, 'geocodificação');
      }
    }),
  );

  return router;
}

module.exports = criarRotasGeocode;
