const map = L.map('map').setView([-32.0332, -52.0986], 14);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

let coordenadasNiveis = []; // Guarda os nós clicados pelo usuário
let segmentosRota = [];     // Guarda arrays com os micro-pontos de cada trajeto
let marcadores = [];        // Guarda os elementos visuais das bolinhas para podermos apagá-los

const linhaDesenho = L.polyline([], { 
    color: 'red', 
    weight: 4,
    opacity: 0.8
}).addTo(map);

// Busca a rota usando o motor do BRouter com perfil de caminhada
async function buscarRotaBRouter(inicio, fim) {
    // A API do BRouter usa o formato lonlats=lon,lat|lon,lat e retorna um GeoJSON
    const url = `https://brouter.de/brouter?lonlats=${inicio.lng},${inicio.lat}|${fim.lng},${fim.lat}&profile=shortest&format=geojson`;
    
    try {
        const resposta = await fetch(url);
        const dados = await resposta.json();
        
        // O BRouter devolve a geometria dentro de features[0].geometry.coordinates
        if (dados.features && dados.features.length > 0) {
            return dados.features[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
        }
    } catch (erro) {
        console.error("Erro ao buscar a rota no BRouter:", erro);
    }
    
    // Se a API falhar, devolve uma linha reta como segurança
    return [[fim.lat, fim.lng]];
}

// 2. Atualiza o desenho achatando (flat) os segmentos numa única linha contínua
function atualizarLinha() {
    linhaDesenho.setLatLngs(segmentosRota.flat());
}

map.on('click', async function(evento) {
    const coordenadaAtual = evento.latlng;
    const shiftPressionado = evento.originalEvent.shiftKey;
    const ehPrimeiroPonto = coordenadasNiveis.length === 0;

    // Se for o primeiro ponto, desenha no exato local do clique
    if (ehPrimeiroPonto) {
        coordenadasNiveis.push(coordenadaAtual);
        segmentosRota.push([[coordenadaAtual.lat, coordenadaAtual.lng]]);
        
        const marcador = L.circleMarker(coordenadaAtual, { 
            radius: 5, 
            color: shiftPressionado ? '#2196F3' : 'black', 
            fillColor: 'white', 
            fillOpacity: 1 
        }).addTo(map);
        marcadores.push(marcador);
        
        atualizarLinha();
        return;
    }

    const pontoAnterior = coordenadasNiveis[coordenadasNiveis.length - 1];

    if (shiftPressionado) {
        // MODO LIVRE: Usa o local exato do clique
        coordenadasNiveis.push(coordenadaAtual);
        segmentosRota.push([[coordenadaAtual.lat, coordenadaAtual.lng]]);
        
        const marcador = L.circleMarker(coordenadaAtual, { 
            radius: 5, 
            color: '#2196F3', 
            fillColor: 'white', 
            fillOpacity: 1 
        }).addTo(map);
        marcadores.push(marcador);
        
    } else {
        // MODO RUA: Busca a rota primeiro
        // (Use buscarRotaOSRM ou buscarRotaBRouter, dependendo da API que você manteve)
        const trechoRota = await buscarRotaBRouter(pontoAnterior, coordenadaAtual); 
        
        // Extrai a última coordenada do trajeto devolvido (ponto já ajustado para a rua)
        const ultimoPontoRua = trechoRota[trechoRota.length - 1];
        
        // Transforma o array [lat, lng] de volta em um objeto do Leaflet
        const coordenadaAjustada = L.latLng(ultimoPontoRua[0], ultimoPontoRua[1]);

        // Salva a coordenada da RUA, não do clique original
        coordenadasNiveis.push(coordenadaAjustada);
        segmentosRota.push(trechoRota);
        
        // Desenha a bolinha preta colada na rua
        const marcador = L.circleMarker(coordenadaAjustada, { 
            radius: 5, 
            color: 'black', 
            fillColor: 'white', 
            fillOpacity: 1 
        }).addTo(map);
        marcadores.push(marcador);
    }

    atualizarLinha();
});

// 3. Sistema de Desfazer (Ctrl + Z)
document.addEventListener('keydown', function(evento) {
    // Verifica se apertou Ctrl + Z
    if (evento.ctrlKey && (evento.key === 'z' || evento.key === 'Z')) {
        // Só desfaz se houver mais de um ponto (não apaga o ponto inicial)
        if (coordenadasNiveis.length > 1) {
            coordenadasNiveis.pop(); // Remove o último clique
            segmentosRota.pop();     // Remove a rota gerada
            
            const ultimoMarcador = marcadores.pop(); // Pega a última bolinha desenhada
            map.removeLayer(ultimoMarcador);         // Remove a bolinha do mapa
            
            atualizarLinha();        // Refaz o desenho vermelho
        }
    }
});