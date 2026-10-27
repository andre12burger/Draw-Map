'use strict';

/**
 * @file server/app.js
 * @description Fábrica da aplicação Express. Centraliza middlewares de segurança
 * (helmet/CSP, rate limit, compressão), arquivos estáticos e montagem das rotas.
 * Exportar uma função facilita testes de integração e reutilização.
 */

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const criarRotasHealth = require('./routes/health');
const criarRotasGeocode = require('./routes/geocode');
const criarRotasRota = require('./routes/route');

const DIRETORIO_PUBLICO = path.join(__dirname, '..', 'public');

function criarApp() {
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: [
            "'self'",
            'data:',
            'https://tile.openstreetmap.org',
            'https://*.tile.openstreetmap.org',
          ],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(compression());

  const limitadorApi = rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.ambiente === 'test',
    message: { erro: 'Muitas requisições. Aguarde um instante e tente novamente.' },
  });
  app.use('/api', limitadorApi);

  app.use(
    express.static(DIRETORIO_PUBLICO, {
      maxAge: config.ambiente === 'production' ? '1h' : 0,
      setHeaders(res, caminhoArquivo) {
        if (caminhoArquivo.includes(`${path.sep}vendor${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (caminhoArquivo.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  app.use('/api', criarRotasHealth());
  app.use('/api', criarRotasGeocode());
  app.use('/api', criarRotasRota());

  app.use('/api', (_req, res) => {
    res.status(404).json({ erro: 'Endpoint não encontrado.' });
  });

  app.use((erro, _req, res, _next) => {
    console.error('[app] erro não tratado:', erro);
    if (res.headersSent) return;
    res.status(500).json({ erro: 'Erro interno do servidor.' });
  });

  return app;
}

module.exports = criarApp;
