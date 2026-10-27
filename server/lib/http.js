'use strict';

/**
 * @file server/lib/http.js
 * @description Cliente HTTP para APIs externas com timeout, User-Agent
 * identificável, verificação de status e parsing seguro de JSON.
 */

const config = require('../config');

class ErroUpstream extends Error {
  constructor(mensagem, { status = 502, statusExterno = null, causa = null } = {}) {
    super(mensagem);
    this.name = 'ErroUpstream';
    this.status = status;
    this.statusExterno = statusExterno;
    this.causa = causa;
  }
}

/**
 * Executa um GET e devolve o JSON validado.
 * @param {string|URL} url
 * @param {{timeoutMs?:number, headers?:Object}} [opcoes]
 * @returns {Promise<any>}
 */
async function buscarJson(url, { timeoutMs = config.upstreamTimeoutMs, headers = {} } = {}) {
  let resposta;

  try {
    resposta = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'User-Agent': config.userAgent,
        ...headers,
      },
    });
  } catch (erro) {
    const expirou = erro?.name === 'TimeoutError' || erro?.name === 'AbortError';
    throw new ErroUpstream(
      expirou
        ? 'O serviço externo excedeu o tempo limite.'
        : 'Falha de rede ao acessar o serviço externo.',
      { status: expirou ? 504 : 502, causa: erro },
    );
  }

  if (!resposta.ok) {
    throw new ErroUpstream('O serviço externo retornou um erro.', {
      status: resposta.status === 429 ? 503 : 502,
      statusExterno: resposta.status,
    });
  }

  const texto = await resposta.text();
  try {
    return JSON.parse(texto);
  } catch (erro) {
    throw new ErroUpstream('O serviço externo devolveu uma resposta inválida.', {
      status: 502,
      causa: erro,
    });
  }
}

/**
 * Encapsula handlers assíncronos para que rejeições cheguem ao middleware de erro
 * do Express 4 (que não faz isso automaticamente).
 * @param {Function} handler
 * @returns {Function}
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Responde ao cliente preservando a natureza do erro (4xx do próprio cliente,
 * 502/503/504 para falhas do upstream).
 */
function responderErroUpstream(res, erro, contexto) {
  const status = erro instanceof ErroUpstream ? erro.status : 500;

  if (status >= 500) {
    console.error(
      `[${contexto}]`,
      erro.message,
      erro.statusExterno ? `(upstream ${erro.statusExterno})` : '',
    );
  }

  const corpo = { erro: erro.message || 'Erro interno.' };
  if (erro instanceof ErroUpstream && erro.statusExterno) {
    corpo.upstream = erro.statusExterno;
  }

  res.status(status).json(corpo);
}

module.exports = { ErroUpstream, asyncHandler, buscarJson, responderErroUpstream };
