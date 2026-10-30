'use strict';

/**
 * @file server/lib/validators.js
 * @description Validação e normalização de todos os parâmetros recebidos pela API.
 * A validação estrita impede injeção de parâmetros na URL do upstream, requisições
 * com tamanho abusivo e perfis de roteamento inexistentes.
 */

const PERFIS_PERMITIDOS = new Set(['shortest', 'trekking', 'fastbike', 'hiking-beta']);
const PERFIL_PADRAO = 'shortest';
const MAX_PONTOS = 50;
const MAX_TERMO_BUSCA = 200;

// longitude/latitude com até 8 casas decimais, sem sinal de "+" e sem expoente
const RE_NUMERO = /^-?\d{1,3}(?:\.\d+)?$/;

/**
 * @param {string} valor - Par "lon,lat" (ex.: "-52.0986,-32.0332").
 * @returns {{lon:number, lat:number}|null}
 */
function analisarCoordenada(valor) {
  if (typeof valor !== 'string') return null;

  const partes = valor.split(',');
  if (partes.length !== 2) return null;

  const [lonTexto, latTexto] = partes;
  if (!RE_NUMERO.test(lonTexto) || !RE_NUMERO.test(latTexto)) return null;

  const lon = Number(lonTexto);
  const lat = Number(latTexto);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;

  return { lon, lat };
}

/**
 * Valida a lista de coordenadas do BRouter.
 * @param {unknown} valor - String no formato "lon,lat|lon,lat|...".
 * @returns {{valido:true, valor:string, pontos:number}|{valido:false, erro:string}}
 */
function validarLonLats(valor) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    return { valido: false, erro: 'O parâmetro "lonlats" é obrigatório.' };
  }

  const partes = valor.split('|');
  if (partes.length < 2) {
    return { valido: false, erro: 'Informe pelo menos dois pontos em "lonlats".' };
  }
  if (partes.length > MAX_PONTOS) {
    return { valido: false, erro: `"lonlats" aceita no máximo ${MAX_PONTOS} pontos.` };
  }

  const coordenadas = [];
  for (const parte of partes) {
    const coordenada = analisarCoordenada(parte);
    if (!coordenada) {
      return { valido: false, erro: 'Coordenada inválida em "lonlats". Use "lon,lat".' };
    }
    coordenadas.push(coordenada);
  }

  const normalizado = coordenadas.map(({ lon, lat }) => `${lon},${lat}`).join('|');
  return { valido: true, valor: normalizado, pontos: coordenadas.length };
}

/**
 * Normaliza o perfil de roteamento, aplicando allowlist.
 * @param {unknown} perfil
 * @returns {string}
 */
function normalizarPerfil(perfil) {
  return typeof perfil === 'string' && PERFIS_PERMITIDOS.has(perfil) ? perfil : PERFIL_PADRAO;
}

/**
 * Valida o termo de busca de endereço.
 * @param {unknown} termo
 * @returns {{valido:true, valor:string}|{valido:false, erro:string}}
 */
function validarTermoBusca(termo) {
  if (typeof termo !== 'string') {
    return { valido: false, erro: 'O parâmetro "q" é obrigatório.' };
  }

  // remove caracteres de controle e normaliza espaços
  const limpo = termo
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (limpo.length < 2) {
    return { valido: false, erro: 'Informe pelo menos 2 caracteres para a busca.' };
  }
  if (limpo.length > MAX_TERMO_BUSCA) {
    return {
      valido: false,
      erro: `O termo de busca deve ter no máximo ${MAX_TERMO_BUSCA} caracteres.`,
    };
  }

  return { valido: true, valor: limpo };
}

const MAX_PONTOS_ROTA = 25;
const MAX_METROS_POR_PERNA = 8000;

/** Perfis públicos do endpoint multi-ponto → perfis do BRouter. */
const PERFIS_ROTA = Object.freeze({
  bike: 'fastbike',
  bicycle: 'fastbike',
  fastbike: 'fastbike',
  trekking: 'trekking',
  foot: 'hiking-beta',
  hiking: 'hiking-beta',
  'hiking-beta': 'hiking-beta',
});

/**
 * Valida e normaliza uma lista de pontos `[[lat, lng], ...]` para roteamento.
 * @param {unknown} pontos
 * @returns {{valido:true, valor:Array<[number,number]>}|{valido:false, erro:string}}
 */
function validarPontosRota(pontos) {
  if (!Array.isArray(pontos)) {
    return { valido: false, erro: 'O corpo deve conter "points" como lista de pares [lat, lng].' };
  }
  if (pontos.length < 2) {
    return { valido: false, erro: 'Informe pelo menos dois pontos em "points".' };
  }
  if (pontos.length > MAX_PONTOS_ROTA) {
    return {
      valido: false,
      erro: `"points" deve ter no máximo ${MAX_PONTOS_ROTA} pontos por requisição.`,
    };
  }

  const normalizados = [];

  for (const ponto of pontos) {
    if (!Array.isArray(ponto) || ponto.length < 2) {
      return { valido: false, erro: 'Cada ponto deve ser um par [lat, lng].' };
    }

    const lat = Number(ponto[0]);
    const lng = Number(ponto[1]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { valido: false, erro: 'Latitude e longitude devem ser números finitos.' };
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return {
        valido: false,
        erro: 'Latitude deve estar em [-90, 90] e longitude em [-180, 180].',
      };
    }

    normalizados.push([lat, lng]);
  }

  return { valido: true, valor: normalizados };
}

/**
 * Mapeia o perfil público (`bike`/`foot` e aliases) para o perfil do BRouter.
 * @param {unknown} perfil
 * @returns {string|null} `null` quando o perfil não é reconhecido.
 */
function mapearPerfilRota(perfil) {
  if (typeof perfil !== 'string') return null;
  return PERFIS_ROTA[perfil.trim().toLowerCase()] ?? null;
}

module.exports = {
  PERFIS_PERMITIDOS,
  PERFIL_PADRAO,
  MAX_PONTOS,
  MAX_TERMO_BUSCA,
  MAX_PONTOS_ROTA,
  MAX_METROS_POR_PERNA,
  PERFIS_ROTA,
  analisarCoordenada,
  validarLonLats,
  normalizarPerfil,
  validarTermoBusca,
  validarPontosRota,
  mapearPerfilRota,
};
