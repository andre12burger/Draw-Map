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

module.exports = {
  PERFIS_PERMITIDOS,
  PERFIL_PADRAO,
  MAX_PONTOS,
  MAX_TERMO_BUSCA,
  analisarCoordenada,
  validarLonLats,
  normalizarPerfil,
  validarTermoBusca,
};
