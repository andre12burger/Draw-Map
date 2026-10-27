'use strict';

/**
 * @file server/routes/route.js
 * @description Rota de roteamento (`GET /api/rota`) que atua como proxy do BRouter,
 * com validação estrita, allowlist de perfis, cache de 1 h e timeout.
 */

const express = require('express');
const config = require('../config');
const CacheTTL = require('../lib/cache');
const { ErroUpstream, asyncHandler, buscarJson, responderErroUpstream } = require('../lib/http');
const { validarLonLats, normalizarPerfil } = require('../lib/validators');

const cache = new CacheTTL({ ttlMs: config.routeCacheTtlMs, maxEntradas: 500 });

function criarRotasRota() {
  const router = express.Router();

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
