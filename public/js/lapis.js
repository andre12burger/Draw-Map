/**
 * @file lapis.js
 * @description Módulo da ferramenta de desenho livre (Freehand/Pencil).
 * Inclui gestão de atalhos (Spacebar) para permitir arrastar o mapa sem sair da ferramenta.
 */

import { map, obterEstilosDinamicos } from './mapa.js';

let desenhandoLapis = false;
let pontosDecalque = [];
let polylineDecalque = null;
let barraEspacoPressionada = false;

// Permite arrastar o mapa segurando a Barra de Espaço
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        barraEspacoPressionada = true;
        map.dragging.enable(); // Devolve o controle ao Leaflet
        document.getElementById('map').classList.remove('cursor-lapis');
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        barraEspacoPressionada = false;
        if (window.ferramentaAtiva === 'lapis') {
            document.getElementById('map').classList.add('cursor-lapis');
        }
    }
});

/**
 * @event mousedown
 * @description Trava o mapa e inicia a captura do desenho livre apenas com botão esquerdo.
 */
map.on('mousedown', (e) => {
    if (window.ferramentaAtiva !== 'lapis') return;
    if (e.originalEvent.button !== 0) return; // Ignora se não for o botão esquerdo do mouse
    if (barraEspacoPressionada) return; // Permite arrastar o mapa normalmente se segurar Espaço
    
    map.dragging.disable();
    desenhandoLapis = true;
    pontosDecalque = [e.latlng];

    const { pesoLinha } = obterEstilosDinamicos();
    
    polylineDecalque = L.polyline(pontosDecalque, {
        color: 'gray',
        weight: pesoLinha,
        opacity: 0.6,
        dashArray: '5, 5',
        className: 'rabisco-fantasma'
    }).addTo(map);
});

/**
 * @event mousemove
 * @description Adiciona vértices ao traço fantasma enquanto o botão é segurado.
 */
map.on('mousemove', (e) => {
    if (!desenhandoLapis || window.ferramentaAtiva !== 'lapis') return;
    pontosDecalque.push(e.latlng);
    
    if (polylineDecalque) {
        polylineDecalque.setLatLngs(pontosDecalque);
    }
});

/**
 * @event mouseup
 * @description Finaliza o desenho, destrava o mapa e aciona o processamento da rota.
 */
map.on('mouseup', async () => {
    if (!desenhandoLapis || window.ferramentaAtiva !== 'lapis') return;
    
    desenhandoLapis = false;
    map.dragging.enable(); 

    if (pontosDecalque.length < 2) {
        if (polylineDecalque) map.removeLayer(polylineDecalque);
        return;
    }

    await processarDecalqueLapis(pontosDecalque);
});

/**
 * @function processarDecalqueLapis
 * @description Filtra o ruído e processa os nós por Batch Routing.
 */
async function processarDecalqueLapis(pontosBrutos) {
    const pontosPixel = pontosBrutos.map(p => map.project(p));
    const toleranciaPixels = 15; 
    const esquinas = L.LineUtil.simplify(pontosPixel, toleranciaPixels).map(p => map.unproject(p));

    const pontosEstrategicos = [];
    const distMaxima = 40; 

    for (let i = 0; i < esquinas.length - 1; i++) {
        let ptA = esquinas[i];
        let ptB = esquinas[i + 1];
        pontosEstrategicos.push(ptA);

        let dist = ptA.distanceTo(ptB);
        if (dist > distMaxima) {
            let numFracoes = Math.ceil(dist / distMaxima);
            for (let j = 1; j < numFracoes; j++) {
                let ratio = j / numFracoes;
                let lat = ptA.lat + (ptB.lat - ptA.lat) * ratio;
                let lng = ptA.lng + (ptB.lng - ptA.lng) * ratio;
                pontosEstrategicos.push(L.latLng(lat, lng));
            }
        }
    }
    pontosEstrategicos.push(esquinas[esquinas.length - 1]);

    const sucesso = await window.processarLoteLapis(pontosEstrategicos, false);
    
    if (!sucesso) {
        alert("O desenho é muito grande e sobrecarregou a API. Tente desenhar partes menores.");
    }
    
    if (polylineDecalque) {
        map.removeLayer(polylineDecalque);
    }
}