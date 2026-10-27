/**
 * @file map/draw.js
 * @description Operações de desenho/roteamento. Toda mutação é transacional:
 * o estado é clonado, validado e só então commitado (com snapshot para undo).
 * Nenhum handler assíncrono pode deixar `carregando` preso — todos usam
 * try/catch/finally.
 */

import { commitEstado, desfazerUltimo, getEstado } from '../core/state.js';
import { buscarRota, buscarRotaLote, obterPontoRua } from '../services/api.js';
import { calcularDistanciaTotal, distanciaMetros } from './distance.js';
import { redesenhar } from './render.js';
import { definirStatus } from '../ui/stats.js';
import { mostrarToast } from '../ui/toast.js';

let ocupado = false;

export function estaOcupado() {
  return ocupado;
}

function iniciar(mensagem) {
  if (ocupado) return false;
  ocupado = true;
  definirStatus(mensagem, { ocupado: true });
  return true;
}

function finalizar() {
  ocupado = false;
  definirStatus('');
}

function normalizarLatLng(latlng) {
  const lat = Number(latlng?.lat);
  const lng = Number(latlng?.lng);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

function comMetricas(estado) {
  estado.distanciaTotal = calcularDistanciaTotal(estado.segmentosRota) / 1000;
  estado.contadorPontos = estado.coordenadasNiveis.length;
  return estado;
}

function aplicar(estado) {
  return commitEstado(comMetricas(estado));
}

/**
 * Adiciona um ponto ao final da rota.
 * @param {{lat:number,lng:number}} latlng
 * @param {boolean} [modoLivre=false]
 * @returns {Promise<boolean>}
 */
export async function adicionarPonto(latlng, modoLivre = false) {
  const clicado = normalizarLatLng(latlng);
  if (!clicado) return false;
  if (!iniciar(modoLivre ? 'Adicionando ponto livre...' : 'Calculando rota...')) {
    return false;
  }

  try {
    const estado = getEstado();
    const coordenadas = estado.coordenadasNiveis;

    if (coordenadas.length === 0) {
      let inicial = clicado;

      if (!modoLivre) {
        const snap = await obterPontoRua(clicado);
        if (!snap) {
          mostrarToast('Não foi possível encaixar o ponto em uma via próxima.', {
            tipo: 'erro',
          });
          return false;
        }
        inicial = snap;
      }

      coordenadas.push(inicial);
      estado.segmentosRota.push([[inicial.lat, inicial.lng]]);
      estado.modosTraco.push(modoLivre ? 'livre' : 'rua');
      aplicar(estado);
      return true;
    }

    const anterior = coordenadas[coordenadas.length - 1];
    const trecho = await buscarRota(anterior, clicado, { modoLivre });

    if (!trecho) {
      mostrarToast('Não foi possível calcular o trecho. Tente novamente.', {
        tipo: 'erro',
      });
      return false;
    }

    let destino = clicado;
    if (!modoLivre) {
      const ultimo = trecho[trecho.length - 1];
      destino = { lat: ultimo[0], lng: ultimo[1] };
      trecho[0] = [anterior.lat, anterior.lng];
    }

    coordenadas.push(destino);
    estado.segmentosRota.push(trecho);
    estado.modosTraco.push(modoLivre ? 'livre' : 'rua');
    aplicar(estado);
    return true;
  } catch (erro) {
    console.error('Erro ao adicionar ponto:', erro);
    mostrarToast('Erro inesperado ao adicionar o ponto.', { tipo: 'erro' });
    return false;
  } finally {
    finalizar();
  }
}

/**
 * Insere um ponto no meio de um trecho existente (botão direito na linha).
 * As duas metades são calculadas ANTES de mutar o estado; se qualquer uma falhar,
 * nada é alterado. Funciona inclusive no último trecho.
 * @param {number} indice - índice do trecho (1..n-1)
 * @param {{lat:number,lng:number}} latlng
 * @returns {Promise<boolean>}
 */
export async function aoInserirPonto(indice, latlng) {
  const clicado = normalizarLatLng(latlng);
  if (!clicado) return false;
  if (!iniciar('Inserindo ponto no trecho...')) return false;

  try {
    const estado = getEstado();
    const coordenadas = estado.coordenadasNiveis;
    const modos = estado.modosTraco;

    if (!Number.isInteger(indice) || indice < 1 || indice >= coordenadas.length) {
      return false;
    }

    const modo = modos[indice] === 'livre' ? 'livre' : 'rua';
    const anterior = coordenadas[indice - 1];
    const proximo = coordenadas[indice];

    const trechoAnterior = await buscarRota(anterior, clicado, {
      modoLivre: modo === 'livre',
    });
    if (!trechoAnterior) {
      mostrarToast('Não foi possível calcular o trecho anterior.', { tipo: 'erro' });
      return false;
    }

    let novoPonto = clicado;
    if (modo === 'rua') {
      const ultimo = trechoAnterior[trechoAnterior.length - 1];
      novoPonto = { lat: ultimo[0], lng: ultimo[1] };
      trechoAnterior[0] = [anterior.lat, anterior.lng];
    }

    const trechoProximo = await buscarRota(novoPonto, proximo, {
      modoLivre: modo === 'livre',
    });
    if (!trechoProximo) {
      mostrarToast('Não foi possível recalcular o trecho seguinte.', { tipo: 'erro' });
      return false;
    }
    if (modo === 'rua') {
      trechoProximo[0] = [novoPonto.lat, novoPonto.lng];
    }

    coordenadas.splice(indice, 0, novoPonto);
    estado.segmentosRota.splice(indice, 0, trechoAnterior);
    modos.splice(indice, 0, modo);
    estado.segmentosRota[indice + 1] = trechoProximo;

    aplicar(estado);
    return true;
  } catch (erro) {
    console.error('Erro ao inserir ponto:', erro);
    mostrarToast('Erro inesperado ao inserir o ponto.', { tipo: 'erro' });
    return false;
  } finally {
    finalizar();
  }
}

/**
 * Reposiciona um marcador, re-roteando os trechos vizinhos.
 * @param {number} indice
 * @param {{lat:number,lng:number}} latlng
 * @returns {Promise<boolean>}
 */
export async function aoArrastarPonto(indice, latlng) {
  const alvo = normalizarLatLng(latlng);
  if (!alvo) return false;
  if (!iniciar('Reposicionando ponto...')) return false;

  try {
    const estado = getEstado();
    const coordenadas = estado.coordenadasNiveis;
    const modos = estado.modosTraco;

    if (!Number.isInteger(indice) || indice < 0 || indice >= coordenadas.length) {
      return false;
    }

    const modo = modos[indice] === 'livre' ? 'livre' : 'rua';
    let novaPosicao = alvo;

    if (modo === 'rua') {
      const snap = await obterPontoRua(alvo);
      if (!snap) {
        mostrarToast('Não foi possível encaixar o ponto em uma via.', { tipo: 'erro' });
        redesenhar(getEstado());
        return false;
      }
      novaPosicao = snap;
    }

    let trechoAnterior = null;
    if (indice > 0) {
      trechoAnterior = await buscarRota(coordenadas[indice - 1], novaPosicao, {
        modoLivre: modo === 'livre',
      });
      if (!trechoAnterior) {
        mostrarToast('Não foi possível recalcular o trecho anterior.', { tipo: 'erro' });
        redesenhar(getEstado());
        return false;
      }
      if (modo === 'rua') {
        trechoAnterior[0] = [coordenadas[indice - 1].lat, coordenadas[indice - 1].lng];
      }
    }

    let trechoProximo = null;
    if (indice < coordenadas.length - 1) {
      const modoProximo = modos[indice + 1] === 'livre' ? 'livre' : 'rua';
      trechoProximo = await buscarRota(novaPosicao, coordenadas[indice + 1], {
        modoLivre: modoProximo === 'livre',
      });
      if (!trechoProximo) {
        mostrarToast('Não foi possível recalcular o trecho seguinte.', { tipo: 'erro' });
        redesenhar(getEstado());
        return false;
      }
      if (modoProximo === 'rua') {
        trechoProximo[0] = [novaPosicao.lat, novaPosicao.lng];
      }
    }

    coordenadas[indice] = novaPosicao;
    if (indice === 0) {
      estado.segmentosRota[0] = [[novaPosicao.lat, novaPosicao.lng]];
    } else {
      estado.segmentosRota[indice] = trechoAnterior;
    }
    if (trechoProximo) estado.segmentosRota[indice + 1] = trechoProximo;

    aplicar(estado);
    return true;
  } catch (erro) {
    console.error('Erro ao arrastar ponto:', erro);
    mostrarToast('Erro inesperado ao mover o ponto.', { tipo: 'erro' });
    redesenhar(getEstado());
    return false;
  } finally {
    finalizar();
  }
}

/**
 * Projeta os pontos estratégicos nos índices da rota consolidada, mantendo
 * monotonicidade (um desenho com laço nunca "volta" no índice).
 * @param {Array<{lat:number,lng:number}>} pontos
 * @param {Array<[number,number,number]>} rota
 * @returns {number[]}
 */
function projetarIndices(pontos, rota) {
  const indices = [0];
  const janela = 800;
  let indiceAtual = 0;

  for (let i = 1; i < pontos.length - 1; i += 1) {
    const alvo = pontos[i];
    let melhorIndice = indiceAtual;
    let melhorDistancia = Infinity;
    const limite = Math.min(indiceAtual + janela, rota.length);

    for (let j = indiceAtual; j < limite; j += 1) {
      const distancia = distanciaMetros([alvo.lat, alvo.lng], [rota[j][0], rota[j][1]]);
      if (distancia < melhorDistancia) {
        melhorDistancia = distancia;
        melhorIndice = j;
      }
    }

    indices.push(melhorIndice);
    indiceAtual = melhorIndice;
  }

  indices.push(rota.length - 1);
  return indices;
}

/**
 * Processa o traço do lápis: snap do primeiro ponto, roteamento em lote e
 * divisão da geometria em trechos por projeção.
 * @param {Array<{lat:number,lng:number}>} pontosBrutos
 * @param {boolean} [modoLivre=false]
 * @returns {Promise<boolean>}
 */
export async function processarLoteLapis(pontosBrutos, modoLivre = false) {
  if (!Array.isArray(pontosBrutos) || pontosBrutos.length < 2) return false;
  if (!iniciar('Processando desenho...')) return false;

  try {
    const estado = getEstado();
    const coordenadas = estado.coordenadasNiveis;
    const pontosFiltrados = pontosBrutos.map(normalizarLatLng).filter((ponto) => ponto !== null);

    if (pontosFiltrados.length < 2) return false;

    if (coordenadas.length > 0) {
      pontosFiltrados.unshift(coordenadas[coordenadas.length - 1]);
    } else {
      let inicial = pontosFiltrados[0];
      if (!modoLivre) {
        const snap = await obterPontoRua(inicial);
        if (snap) inicial = snap;
      }
      coordenadas.push(inicial);
      estado.segmentosRota.push([[inicial.lat, inicial.lng]]);
      estado.modosTraco.push(modoLivre ? 'livre' : 'rua');
    }

    if (modoLivre) {
      for (let i = 1; i < pontosFiltrados.length; i += 1) {
        const anterior = pontosFiltrados[i - 1];
        const atual = pontosFiltrados[i];
        coordenadas.push(atual);
        estado.segmentosRota.push([
          [anterior.lat, anterior.lng],
          [atual.lat, atual.lng],
        ]);
        estado.modosTraco.push('livre');
      }
    } else {
      const rota = await buscarRotaLote(pontosFiltrados);
      if (!rota) {
        mostrarToast('O desenho é muito grande ou o servidor está ocupado. Tente partes menores.', {
          tipo: 'erro',
        });
        return false;
      }

      const indices = projetarIndices(pontosFiltrados, rota);
      let adicionados = 0;

      for (let i = 0; i < indices.length - 1; i += 1) {
        const inicio = indices[i];
        const fim = indices[i + 1];
        if (fim <= inicio) continue;

        const trecho = rota.slice(inicio, fim + 1);
        const destino = trecho[trecho.length - 1];

        coordenadas.push({ lat: destino[0], lng: destino[1] });
        estado.segmentosRota.push(trecho);
        estado.modosTraco.push('rua');
        adicionados += 1;
      }

      if (adicionados === 0) {
        mostrarToast('Não foi possível encaixar o desenho nas ruas.', { tipo: 'erro' });
        return false;
      }
    }

    aplicar(estado);
    return true;
  } catch (erro) {
    console.error('Erro ao processar lote do lápis:', erro);
    mostrarToast('Erro inesperado ao processar o desenho.', { tipo: 'erro' });
    return false;
  } finally {
    finalizar();
  }
}

/**
 * Apaga a rota, mantendo a possibilidade de desfazer (Ctrl+Z).
 * @returns {boolean}
 */
export function limparTudo() {
  if (ocupado) return false;

  const estado = getEstado();
  if (estado.coordenadasNiveis.length === 0) return false;

  estado.coordenadasNiveis = [];
  estado.segmentosRota = [];
  estado.modosTraco = [];
  estado.distanciaTotal = 0;
  estado.contadorPontos = 0;
  aplicar(estado);
  return true;
}

/**
 * @returns {Object|null} estado restaurado ou null.
 */
export function desfazer() {
  if (ocupado) return null;
  return desfazerUltimo();
}
