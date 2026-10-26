/**
 * @file mapa.js
 * @description Controlador principal da Interface Gráfica (UI) e do Canvas do Leaflet.
 * Gerencia a renderização vetorial das rotas, captura de eventos de mouse (cliques/arrastar)
 * e o sistema de Autocomplete de endereços.
 */

import { buscarRotaBRouter, buscarRotaLoteBRouter, obterPontoRua, obterSnapSilencioso, buscarEndereco } from './api.js';
import { getEstado, setCampo, atualizarEstado, inicializarEstado, salvarHistorico, desfazerUltimo } from './state.js';

window.ferramentaAtiva = 'rua';
window.desenhandoLapis = false; 

const estado = inicializarEstado();
document.getElementById('distancia-total').innerText = estado.distanciaTotal.toFixed(2);
document.getElementById('contador-pontos').innerText = estado.contadorPontos;

let coordenadasNiveis = estado.coordenadasNiveis.map(c => L.latLng(c.lat, c.lng));
let segmentosRota = estado.segmentosRota;
let marcadores = [];
let linhasDesenhadas = [];
let modosTraco = estado.modosTraco;
let marcadoresKm = [];
let carregandoRota = false; 

// Inicializa a engine cartográfica centralizada em Rio Grande
const map = L.map('map', { doubleClickZoom: false, boxZoom: false }).setView([-32.0332, -52.0986], 14);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 24, maxNativeZoom: 19, attribution: '© OpenStreetMap'
}).addTo(map);

/**
 * @function obterEstilosDinamicos
 * @description Calcula o tamanho dos vetores da tela baseado no nível de Zoom.
 * Mantém as linhas e marcadores proporcionais para não poluir a tela.
 * @returns {Object} Objeto com os tamanhos calculados de linha, fonte e marcadores.
 */
export function obterEstilosDinamicos() {
    const z = map.getZoom();
    let pesoLinha = 4;
    let tamanhoMarcador = 12;
    let tamanhoFonteKm = 11;

    if (z > 14) {
        pesoLinha = 4 + (z - 14) * 1.5;
        tamanhoMarcador = 12 + (z - 14) * 2.5;
        tamanhoFonteKm = 11 + (z - 14) * 1.2;
    } else if (z < 14) {
        pesoLinha = Math.max(2, 4 - (14 - z));
        tamanhoMarcador = Math.max(6, 12 - (14 - z) * 1.5);
        tamanhoFonteKm = Math.max(8, 11 - (14 - z));
    }

    return { 
        pesoLinha: Math.round(pesoLinha), 
        tamanhoMarcador: Math.round(tamanhoMarcador), 
        tamanhoFonteKm: Math.round(tamanhoFonteKm) 
    };
}

// @event zoomend - Recalcula dinamicamente a espessura gráfica no evento de zoom
map.on('zoomend', function() {
    const { pesoLinha, tamanhoMarcador, tamanhoFonteKm } = obterEstilosDinamicos();

    linhasDesenhadas.forEach((linha, index) => {
        if (linha) {
            linha.setStyle({
                weight: pesoLinha,
                dashArray: modosTraco[index] === 'livre' ? `${pesoLinha * 2}, ${pesoLinha * 2}` : null
            });
        }
    });

    marcadores.forEach((marcador, index) => {
        const classeCss = modosTraco[index] === 'livre' ? 'marcador-custom marcador-livre' : 'marcador-custom';
        marcador.setIcon(L.divIcon({
            className: classeCss,
            iconSize: [tamanhoMarcador, tamanhoMarcador],
            iconAnchor: [tamanhoMarcador / 2, tamanhoMarcador / 2]
        }));
    });

    marcadoresKm.forEach(mark => {
        const iconeAntigo = mark.options.icon;
        const numero = iconeAntigo.options.html.replace(/<[^>]*>?/gm, ''); 
        mark.setIcon(L.divIcon({
            className: 'marcador-km',
            html: `<span style="font-size: ${tamanhoFonteKm}px;">${numero}</span>`,
            iconSize: [tamanhoMarcador * 1.8, tamanhoMarcador * 1.8],
            iconAnchor: [tamanhoMarcador * 0.9, tamanhoMarcador * 0.9]
        }));
    });
});

/* ==========================================
   EVENTOS DA BARRA DE FERRAMENTAS
   ========================================== */
document.getElementById('btn-ferramenta-rua').addEventListener('click', function() {
    window.ferramentaAtiva = 'rua'; window.desenhandoLapis = false; carregandoRota = false; 
    atualizarBotoesFerramentas(this); document.getElementById('map').classList.remove('cursor-lapis');
});

document.getElementById('btn-ferramenta-livre').addEventListener('click', function() {
    window.ferramentaAtiva = 'livre'; window.desenhandoLapis = false; carregandoRota = false;
    atualizarBotoesFerramentas(this); document.getElementById('map').classList.remove('cursor-lapis');
});

document.getElementById('btn-ferramenta-lapis').addEventListener('click', function() {
    window.ferramentaAtiva = 'lapis'; carregandoRota = false;
    atualizarBotoesFerramentas(this); document.getElementById('map').classList.add('cursor-lapis');
});

/* ==========================================
   MÓDULO DE AUTOCOMPLETE E BUSCA (NOMINATIM)
   ========================================== */
let debounceBuscaEndereco = null;
const inputEndereco = document.getElementById('input-endereco');
const caixaSugestoes = document.getElementById('sugestoes-endereco');
const btnBuscarEndereco = document.getElementById('btn-buscar-endereco');

// Escuta digitação para preencher o dropdown
inputEndereco.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(debounceBuscaEndereco);
    
    if (query.length < 3) {
        caixaSugestoes.style.display = 'none';
        return;
    }

    debounceBuscaEndereco = setTimeout(async () => {
        const resultados = await buscarEndereco(query);
        caixaSugestoes.innerHTML = ''; 
        
        if (resultados && resultados.length > 0) {
            resultados.forEach(res => {
                const div = document.createElement('div');
                div.className = 'sugestao-item';
                div.innerText = res.nome;
                div.onclick = () => {
                    inputEndereco.value = res.nome;
                    caixaSugestoes.style.display = 'none';
                    map.flyTo([res.lat, res.lng], 16, { animate: true, duration: 1.5 });
                };
                caixaSugestoes.appendChild(div);
            });
            caixaSugestoes.style.display = 'block'; 
        } else {
            caixaSugestoes.style.display = 'none';
        }
    }, 500); // Algoritmo de Debounce (500ms) para não sobrecarregar o Web Service
});

// Ação do Botão Principal de Busca
btnBuscarEndereco.addEventListener('click', async () => {
    const query = inputEndereco.value.trim();
    if (!query) return;

    btnBuscarEndereco.innerText = '⌛';
    btnBuscarEndereco.disabled = true;
    inputEndereco.disabled = true;
    caixaSugestoes.style.display = 'none';
    
    const resultados = await buscarEndereco(query);
    
    if (resultados && resultados.length > 0) {
        map.flyTo([resultados[0].lat, resultados[0].lng], 16, { animate: true, duration: 1.5 });
    } else {
        alert("Endereço não encontrado. Tente adicionar o nome da cidade à busca.");
    }

    btnBuscarEndereco.innerText = '🔍';
    btnBuscarEndereco.disabled = false;
    inputEndereco.disabled = false;
});

inputEndereco.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') btnBuscarEndereco.click();
});

document.addEventListener('click', (e) => {
    if (e.target !== inputEndereco && e.target !== caixaSugestoes) {
        caixaSugestoes.style.display = 'none';
    }
});

/* ==========================================
   LÓGICA GRÁFICA DE DESENHO E ATALHOS
   ========================================== */
function atualizarBotoesFerramentas(botaoAtivo) {
    document.querySelectorAll('.btn-ferramenta').forEach(btn => btn.classList.remove('ativo'));
    botaoAtivo.classList.add('ativo');
    const painelLapis = document.getElementById('opcoes-lapis');
    if (painelLapis) painelLapis.style.display = window.ferramentaAtiva === 'lapis' ? 'block' : 'none';
}

window.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '1') document.getElementById('btn-ferramenta-rua').click();
  if (e.key === '2') document.getElementById('btn-ferramenta-livre').click();
  if (e.key === '3') document.getElementById('btn-ferramenta-lapis').click();
  
  if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    const estadoAnterior = desfazerUltimo();
    if (estadoAnterior) {
      coordenadasNiveis = estadoAnterior.coordenadasNiveis.map(c => L.latLng(c.lat, c.lng));
      segmentosRota = estadoAnterior.segmentosRota;
      modosTraco = estadoAnterior.modosTraco;
      redesenharMapa();
    }
  }
});

function salvarEstado() {
  salvarHistorico();
  const novoEstado = {
    coordenadasNiveis: coordenadasNiveis.map(c => ({ lat: c.lat, lng: c.lng })),
    segmentosRota: segmentosRota, modosTraco: modosTraco, ferramentaAtiva: window.ferramentaAtiva,
    distanciaTotal: parseFloat(document.getElementById('distancia-total').innerText),
    contadorPontos: coordenadasNiveis.length, carregandoRota: false
  };
  atualizarEstado(novoEstado);
}

/**
 * @function redesenharMapa
 * @description Apaga as camadas atuais (layers) do Leaflet e redesenha a rota inteira
 * iterando sobre o Array de Estado. Usado primariamente pela função de "Desfazer" (Ctrl+Z).
 */
function redesenharMapa() {
  const { pesoLinha } = obterEstilosDinamicos();
  marcadores.forEach(m => map.removeLayer(m));
  linhasDesenhadas.forEach(l => { if (l) map.removeLayer(l) });
  marcadores = []; linhasDesenhadas = [];

  for (let i = 0; i < coordenadasNiveis.length; i++) {
    const coord = coordenadasNiveis[i];
    const modo = modosTraco[i];
    marcadores.push(criarMarcador(coord, modo === 'livre'));
    
    const segmento = segmentosRota[i];
    if (i === 0 || !segmento || segmento.length === 0) {
      linhasDesenhadas.push(null);
    } else {
      const estilo = modo === 'livre' ? { color: 'red', weight: pesoLinha, opacity: 0.8, dashArray: `${pesoLinha*2}, ${pesoLinha*2}` } : { color: 'red', weight: pesoLinha, opacity: 0.8 };
      const linha = L.polyline(segmento, estilo).addTo(map);
      linha.on('contextmenu', (e) => { L.DomEvent.stopPropagation(e); adicionarPontoNaLinha(linha, e); });
      linhasDesenhadas.push(linha);
    }
  }
  atualizarDistancia();
}

/**
 * @function atualizarDistancia
 * @description Calcula o comprimento total da rota gerada usando geometria de projeção
 * e distribui as "bolinhas de KM" perfeitamente espaçadas sobre a linha traçada.
 */
function atualizarDistancia() {
  const { tamanhoMarcador, tamanhoFonteKm } = obterEstilosDinamicos();
  let distanciaTotal = 0;
  const todosPontos = segmentosRota.flat(); 
  
  if (typeof marcadoresKm !== 'undefined') {
      marcadoresKm.forEach(m => map.removeLayer(m));
      marcadoresKm = [];
  }
  
  let proximoKm = 1;

  for (let i = 0; i < todosPontos.length - 1; i++) {
    const ptA = L.latLng(todosPontos[i][0], todosPontos[i][1]);
    const ptB = L.latLng(todosPontos[i+1][0], todosPontos[i+1][1]);
    const distTrecho = ptA.distanceTo(ptB); 
    
    if (distanciaTotal + distTrecho >= proximoKm * 1000) {
        const ratio = (proximoKm * 1000 - distanciaTotal) / distTrecho;
        const latKm = ptA.lat + (ptB.lat - ptA.lat) * ratio;
        const lngKm = ptA.lng + (ptB.lng - ptA.lng) * ratio;
        
        const iconeKm = L.divIcon({ 
            className: 'marcador-km', 
            html: `<span style="font-size: ${tamanhoFonteKm}px;">${proximoKm}</span>`, 
            iconSize: [tamanhoMarcador * 1.8, tamanhoMarcador * 1.8], 
            iconAnchor: [tamanhoMarcador * 0.9, tamanhoMarcador * 0.9] 
        });
        const mark = L.marker([latKm, lngKm], { icon: iconeKm, interactive: false }).addTo(map);
        marcadoresKm.push(mark);
        proximoKm++;
    }
    distanciaTotal += distTrecho; 
  }

  document.getElementById('distancia-total').innerText = (distanciaTotal / 1000).toFixed(2);
  document.getElementById('contador-pontos').innerText = coordenadasNiveis.length;
}

/**
 * @function criarMarcador
 * @description Instancia nós (vértices) de arrasto sobre o mapa. Controla a lógica
 * de re-roteamento automático quando o usuário move um ponto na malha urbana.
 */
function criarMarcador(latlng, ehLivre) {
  const { tamanhoMarcador } = obterEstilosDinamicos();
  const classeCss = ehLivre ? 'marcador-custom marcador-livre' : 'marcador-custom';
  const icone = L.divIcon({ className: classeCss, iconSize: [tamanhoMarcador, tamanhoMarcador], iconAnchor: [tamanhoMarcador / 2, tamanhoMarcador / 2] });
  const marcador = L.marker(latlng, { icon: icone, draggable: true }).addTo(map);

  marcador.on('dragend', async function(e) {
    if (carregandoRota) return;
    carregandoRota = true;
    
    const index = marcadores.indexOf(e.target);
    let novaPosicao = e.target.getLatLng();
    const ehLivrePonto = modosTraco[index] === 'livre';

    if (!ehLivrePonto) {
      let refPonto = null;
      if (index > 0) refPonto = coordenadasNiveis[index - 1];
      else if (marcadores.length > 1) refPonto = coordenadasNiveis[1];

      if (refPonto) {
        const trechoTemp = await buscarRotaBRouter(refPonto, novaPosicao, false);
        if (trechoTemp) {
          novaPosicao = index > 0 ? L.latLng(trechoTemp[trechoTemp.length - 1][0], trechoTemp[trechoTemp.length - 1][1]) : L.latLng(trechoTemp[0][0], trechoTemp[0][1]);
        } else novaPosicao = coordenadasNiveis[index]; 
      } else {
        const snap = await obterPontoRua(novaPosicao);
        novaPosicao = snap ? snap : coordenadasNiveis[index];
      }
    }

    e.target.setLatLng(novaPosicao);
    coordenadasNiveis[index] = novaPosicao;

    if (index > 0) {
      const ptAnterior = coordenadasNiveis[index - 1];
      let novoTrecho = await buscarRotaBRouter(ptAnterior, novaPosicao, modosTraco[index] === 'livre');
      if (!novoTrecho) novoTrecho = segmentosRota[index];
      else if (modosTraco[index] !== 'livre') novoTrecho[0] = [ptAnterior.lat, ptAnterior.lng]; 
      segmentosRota[index] = novoTrecho;
      linhasDesenhadas[index].setLatLngs(novoTrecho);
    } else segmentosRota[0] = [[novaPosicao.lat, novaPosicao.lng]];

    if (index < marcadores.length - 1) {
      const ptProximo = coordenadasNiveis[index + 1];
      let novoTrechoProximo = await buscarRotaBRouter(novaPosicao, ptProximo, modosTraco[index + 1] === 'livre');
      if (!novoTrechoProximo) novoTrechoProximo = segmentosRota[index + 1];
      else if (modosTraco[index + 1] !== 'livre') novoTrechoProximo[0] = [novaPosicao.lat, novaPosicao.lng]; 
      segmentosRota[index + 1] = novoTrechoProximo;
      linhasDesenhadas[index + 1].setLatLngs(novoTrechoProximo);
    }
    
    atualizarDistancia();
    salvarEstado(); 
    carregandoRota = false;
  });
  return marcador;
}

async function adicionarPontoNaLinha(linha, evento) {
  if (carregandoRota) return;
  carregandoRota = true;

  const index = linhasDesenhadas.indexOf(linha);
  if (index === -1) { carregandoRota = false; return; }

  let coordenadaClique = evento.latlng;
  const modoAtual = modosTraco[index];
  const ehLivre = modoAtual === 'livre';
  const ptAnterior = coordenadasNiveis[index - 1];
  
  let trechoAnterior = await buscarRotaBRouter(ptAnterior, coordenadaClique, ehLivre);
  if (!trechoAnterior) { alert("Servidor ocupado. Tente novamente."); carregandoRota = false; return; }

  if (!ehLivre) {
    coordenadaClique = L.latLng(trechoAnterior[trechoAnterior.length - 1][0], trechoAnterior[trechoAnterior.length - 1][1]);
    trechoAnterior[0] = [ptAnterior.lat, ptAnterior.lng];
  }

  const novoMarcador = criarMarcador(coordenadaClique, ehLivre);
  coordenadasNiveis.splice(index, 0, coordenadaClique);
  marcadores.splice(index, 0, novoMarcador);
  modosTraco.splice(index, 0, modoAtual);
  linhasDesenhadas.splice(index, 0, null); 
  segmentosRota.splice(index, 0, []); 

  const { pesoLinha } = obterEstilosDinamicos();
  const estiloLinha = ehLivre ? { color: 'red', weight: pesoLinha, opacity: 0.8, dashArray: `${pesoLinha*2}, ${pesoLinha*2}` } : { color: 'red', weight: pesoLinha, opacity: 0.8 };
  const novaLinhaAnterior = L.polyline(trechoAnterior, estiloLinha).addTo(map);
  novaLinhaAnterior.on('contextmenu', (e) => { L.DomEvent.stopPropagation(e); adicionarPontoNaLinha(novaLinhaAnterior, e); });
  
  linhasDesenhadas[index] = novaLinhaAnterior;
  segmentosRota[index] = trechoAnterior;

  const ptProximo = coordenadasNiveis[index + 1];
  let trechoProximo = await buscarRotaBRouter(coordenadaClique, ptProximo, modosTraco[index + 1] === 'livre');

  if (trechoProximo) {
    if (!ehLivre && modosTraco[index + 1] !== 'livre') trechoProximo[0] = [coordenadaClique.lat, coordenadaClique.lng];
    linhasDesenhadas[index + 1].setLatLngs(trechoProximo);
    segmentosRota[index + 1] = trechoProximo;
  }

  atualizarDistancia(); salvarEstado(); carregandoRota = false;
}

window.processarNovoPonto = async function(coordenadaAtual, modoLivreAtivo) {
  if (carregandoRota) return false;
  carregandoRota = true;
  const ehPrimeiroPonto = coordenadasNiveis.length === 0;

  if (ehPrimeiroPonto) {
    let posicaoInicial = coordenadaAtual;
    if (!modoLivreAtivo) {
      const snap = await obterPontoRua(coordenadaAtual);
      if (!snap) { carregandoRota = false; return false; }
      posicaoInicial = snap; 
    }
    coordenadasNiveis.push(posicaoInicial);
    segmentosRota.push([[posicaoInicial.lat, posicaoInicial.lng]]); 
    modosTraco.push(modoLivreAtivo ? 'livre' : 'rua');
    linhasDesenhadas.push(null); 
    marcadores.push(criarMarcador(posicaoInicial, modoLivreAtivo));
    
    salvarEstado(); carregandoRota = false; return true; 
  }

  const pontoAnterior = coordenadasNiveis[coordenadasNiveis.length - 1];
  let trechoRota = await buscarRotaBRouter(pontoAnterior, coordenadaAtual, modoLivreAtivo);

  if (!trechoRota) { carregandoRota = false; return false; }

  const { pesoLinha } = obterEstilosDinamicos();
  let estiloLinha = {}; let posicaoFinal;
  
  if (modoLivreAtivo) {
    posicaoFinal = coordenadaAtual;
    estiloLinha = { color: 'red', weight: pesoLinha, opacity: 0.8, dashArray: `${pesoLinha*2}, ${pesoLinha*2}` };
    modosTraco.push('livre');
  } else {
    posicaoFinal = L.latLng(trechoRota[trechoRota.length - 1][0], trechoRota[trechoRota.length - 1][1]);
    trechoRota[0] = [pontoAnterior.lat, pontoAnterior.lng];
    estiloLinha = { color: 'red', weight: pesoLinha, opacity: 0.8 };
    modosTraco.push('rua');
  }

  coordenadasNiveis.push(posicaoFinal);
  marcadores.push(criarMarcador(posicaoFinal, modoLivreAtivo)); 

  const novaLinha = L.polyline(trechoRota, estiloLinha).addTo(map);
  novaLinha.on('contextmenu', (e) => { L.DomEvent.stopPropagation(e); adicionarPontoNaLinha(novaLinha, e); });
  
  linhasDesenhadas.push(novaLinha);
  segmentosRota.push(trechoRota);

  atualizarDistancia(); salvarEstado(); carregandoRota = false; return true;
}

window.processarLoteLapis = async function(pontosBrutos, modoLivreAtivo) {
    if (carregandoRota) return false;
    carregandoRota = true;

    let pontosFiltrados = [...pontosBrutos];
    const temRotaPrevia = coordenadasNiveis.length > 0;
    const { pesoLinha } = obterEstilosDinamicos();

    if (temRotaPrevia) pontosFiltrados.unshift(coordenadasNiveis[coordenadasNiveis.length - 1]);
    else {
        let ptInicial = pontosFiltrados[0];
        if (!modoLivreAtivo) {
            const snap = await obterPontoRua(ptInicial);
            if (snap) ptInicial = snap;
        }
        coordenadasNiveis.push(ptInicial);
        segmentosRota.push([[ptInicial.lat, ptInicial.lng]]);
        modosTraco.push(modoLivreAtivo ? 'livre' : 'rua');
        linhasDesenhadas.push(null);
        marcadores.push(criarMarcador(ptInicial, modoLivreAtivo));
    }

    if (modoLivreAtivo) {
        for (let i = 1; i < pontosFiltrados.length; i++) {
            let ptAnt = pontosFiltrados[i - 1]; let ptAtu = pontosFiltrados[i];
            let trecho = [[ptAnt.lat, ptAnt.lng], [ptAtu.lat, ptAtu.lng]];
            
            coordenadasNiveis.push(ptAtu); segmentosRota.push(trecho); modosTraco.push('livre');
            marcadores.push(criarMarcador(ptAtu, true));
            let linha = L.polyline(trecho, { color: 'red', weight: pesoLinha, opacity: 0.8, dashArray: `${pesoLinha*2}, ${pesoLinha*2}` }).addTo(map);
            linha.on('contextmenu', (e) => { L.DomEvent.stopPropagation(e); adicionarPontoNaLinha(linha, e); });
            linhasDesenhadas.push(linha);
        }
    } else {
        const rotaCompleta = await buscarRotaLoteBRouter(pontosFiltrados);
        if (!rotaCompleta) { carregandoRota = false; return false; }

        let indices = [0];
        let idxAtual = 0;
        for (let i = 1; i < pontosFiltrados.length - 1; i++) {
            let ptAlvo = L.latLng(pontosFiltrados[i]);
            let melhorDist = Infinity; let melhorIdx = idxAtual;
            for (let j = idxAtual; j < Math.min(idxAtual + 800, rotaCompleta.length); j++) {
                let dist = ptAlvo.distanceTo(L.latLng(rotaCompleta[j][0], rotaCompleta[j][1]));
                if (dist < melhorDist) { melhorDist = dist; melhorIdx = j; }
            }
            indices.push(melhorIdx); idxAtual = melhorIdx;
        }
        indices.push(rotaCompleta.length - 1);

        for (let i = 0; i < indices.length - 1; i++) {
            let segmento = rotaCompleta.slice(indices[i], indices[i+1] + 1);
            let ptSnapFinal = L.latLng(rotaCompleta[indices[i+1]][0], rotaCompleta[indices[i+1]][1]);

            coordenadasNiveis.push(ptSnapFinal); segmentosRota.push(segmento); modosTraco.push('rua');
            marcadores.push(criarMarcador(ptSnapFinal, false));

            let linha = L.polyline(segmento, { color: 'red', weight: pesoLinha, opacity: 0.8 }).addTo(map);
            linha.on('contextmenu', (e) => { L.DomEvent.stopPropagation(e); adicionarPontoNaLinha(linha, e); });
            linhasDesenhadas.push(linha);
        }
    }

    atualizarDistancia(); salvarEstado(); carregandoRota = false; return true;
}

map.on('click', async function(evento) {
  if (window.ferramentaAtiva === 'lapis') return;
  const modoLivreAtivo = evento.originalEvent.shiftKey || window.ferramentaAtiva === 'livre';
  const sucesso = await window.processarNovoPonto(evento.latlng, modoLivreAtivo);
  if (!sucesso && !carregandoRota) alert("Servidor ocupado. Aguarde 1 segundo e tente novamente.");
});

document.getElementById('btn-limpar').addEventListener('click', function() {
  if (confirm("Tem certeza que deseja apagar tudo?")) {
    window.desenhandoLapis = false; carregandoRota = false; 
    
    map.eachLayer((layer) => {
        if (layer.options && layer.options.className === 'rabisco-fantasma') {
            map.removeLayer(layer);
        }
    });

    coordenadasNiveis = []; segmentosRota = []; modosTraco = [];
    redesenharMapa(); salvarEstado(); 
  }
});

if (coordenadasNiveis.length > 0) redesenharMapa();

export { map, marcadores, coordenadasNiveis, segmentosRota, modosTraco };