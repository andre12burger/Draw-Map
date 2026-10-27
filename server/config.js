'use strict';

/**
 * @file server/config.js
 * @description Configuração central do Web Service. Todos os valores podem ser
 * sobrescritos por variáveis de ambiente (ver `.env.example`).
 */

const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');

// Carrega `.env` (Node 22+) sem sobrescrever variáveis já definidas no processo.
const caminhoEnv = path.join(__dirname, '..', '.env');
if (fs.existsSync(caminhoEnv)) {
  try {
    process.loadEnvFile(caminhoEnv);
  } catch (erro) {
    console.warn('[config] Não foi possível carregar .env:', erro.message);
  }
}

function inteiroPositivo(valor, padrao) {
  const numero = Number.parseInt(valor, 10);
  return Number.isFinite(numero) && numero > 0 ? numero : padrao;
}

function booleano(valor, padrao = false) {
  if (valor === undefined) return padrao;
  return ['1', 'true', 'yes', 'on'].includes(String(valor).toLowerCase());
}

const contato = process.env.CONTACT_EMAIL || 'contato@strava-art-generator.local';

const config = Object.freeze({
  versao: version,
  porta: inteiroPositivo(process.env.PORT, 3000),
  ambiente: process.env.NODE_ENV || 'development',
  contato,
  userAgent: `StravaArtGenerator/${version} (+${contato})`,
  brouterUrl: process.env.BROUTER_URL || 'https://brouter.de/brouter',
  nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
  upstreamTimeoutMs: inteiroPositivo(process.env.UPSTREAM_TIMEOUT_MS, 12_000),
  rateLimitWindowMs: inteiroPositivo(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMax: inteiroPositivo(process.env.RATE_LIMIT_MAX, 60),
  geocodeCacheTtlMs: 24 * 60 * 60 * 1000,
  routeCacheTtlMs: 60 * 60 * 1000,
  trustProxy: booleano(process.env.TRUST_PROXY, false),
});

module.exports = config;
