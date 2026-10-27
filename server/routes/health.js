'use strict';

/**
 * @file server/routes/health.js
 * @description Endpoint de saúde usado por monitoramento, CI e pelo Playwright.
 */

const express = require('express');
const config = require('../config');

function criarRotasHealth() {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      versao: config.versao,
      ambiente: config.ambiente,
      uptimeSegundos: Math.round(process.uptime()),
    });
  });

  return router;
}

module.exports = criarRotasHealth;
