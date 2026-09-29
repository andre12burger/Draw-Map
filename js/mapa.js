const map = L.map('map').setView([-32.0332, -52.0986], 14);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

let coordenadasNiveis = []; 
let segmentosRota = [];     
let marcadores = [];        
let linhasDesenhadas = [];  
let modosTraco = []; 
let carregandoRota = false; 

// NOVA VARIÁVEL: Guarda a "linha do tempo" das alterações do mapa
let historicoEstados = []; 

// NOVA FUNÇÃO: Tira uma "foto" profunda de todos os dados atuais do desenho
function salvarEstado() {
    historicoEstados.push({
        coordenadas: coordenadasNiveis.map(c => L.latLng(c.lat, c.lng)),
        segmentos: JSON.parse(JSON.stringify(segmentosRota)),
        modos: [...modosTraco]
    });
}

// NOVA FUNÇÃO: Destrói os gráficos atuais e redesenha tudo baseado no estado da memória
function redesenharMapa() {
    marcadores.forEach(m => map.removeLayer(m));
    linhasDesenhadas.forEach(l => { if (l) map.removeLayer(l) });
    marcadores = [];
    linhasDesenhadas = [];

    for (let i = 0; i < coordenadasNiveis.length; i++) {
        const coord = coordenadasNiveis[i];
        const modo = modosTraco[i];
        
        marcadores.push(criarMarcador(coord, modo === 'livre'));
        
        const segmento = segmentosRota[i];
        if (i === 0 || !segmento || segmento.length === 0) {
            linhasDesenhadas.push(null);
        } else {
            const estilo = modo === 'livre' ? { color: 'red', weight: 4, opacity: 0.8, dashArray: '10, 10' } : { color: 'red', weight: 4, opacity: 0.8 };
            const linha = L.polyline(segmento, estilo).addTo(map);
            linha.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                adicionarPontoNaLinha(linha, e);
            });
            linhasDesenhadas.push(linha);
        }
    }
    atualizarDistancia();
}

// Salva a primeira foto do mapa em branco logo ao abrir a página
salvarEstado();

async function buscarRotaBRouter(inicio, fim) {
    const url = `https://brouter.de/brouter?lonlats=${inicio.lng},${inicio.lat}|${fim.lng},${fim.lat}&profile=shortest&format=geojson`;
    try {
        const resposta = await fetch(url);
        const dados = await resposta.json();
        if (dados.features && dados.features.length > 0) {
            return dados.features[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
        }
    } catch (erro) {
        console.error("Erro ao buscar a rota no BRouter:", erro);
    }
    return [[inicio.lat, inicio.lng], [fim.lat, fim.lng]];
}

function atualizarDistancia() {
    let distanciaTotal = 0;
    const todosPontos = segmentosRota.flat(); 
    for (let i = 0; i < todosPontos.length - 1; i++) {
        const ptA = L.latLng(todosPontos[i][0], todosPontos[i][1]);
        const ptB = L.latLng(todosPontos[i+1][0], todosPontos[i+1][1]);
        distanciaTotal += ptA.distanceTo(ptB); 
    }
    document.getElementById('distancia-total').innerText = (distanciaTotal / 1000).toFixed(2);
}

function criarMarcador(latlng, ehLivre) {
    const classeCss = ehLivre ? 'marcador-custom marcador-livre' : 'marcador-custom';
    const icone = L.divIcon({ className: classeCss, iconSize: [12, 12], iconAnchor: [6, 6] });
    const marcador = L.marker(latlng, { icon: icone, draggable: true }).addTo(map);

    marcador.on('dragend', async function(e) {
        if (carregandoRota) return;
        carregandoRota = true;
        
        const index = marcadores.indexOf(e.target);
        const novaPosicao = e.target.getLatLng();
        coordenadasNiveis[index] = novaPosicao;

        if (index > 0) {
            const ptAnterior = coordenadasNiveis[index - 1];
            let novoTrecho = [];
            if (modosTraco[index] === 'livre') {
                novoTrecho = [[ptAnterior.lat, ptAnterior.lng], [novaPosicao.lat, novaPosicao.lng]];
            } else {
                novoTrecho = await buscarRotaBRouter(ptAnterior, novaPosicao);
                const ultimoPonto = novoTrecho[novoTrecho.length - 1];
                coordenadasNiveis[index] = L.latLng(ultimoPonto[0], ultimoPonto[1]);
                e.target.setLatLng(coordenadasNiveis[index]); 
            }
            segmentosRota[index] = novoTrecho;
            linhasDesenhadas[index].setLatLngs(novoTrecho);
        } else {
            segmentosRota[0] = [[novaPosicao.lat, novaPosicao.lng]];
        }

        if (index < marcadores.length - 1) {
            const ptProximo = coordenadasNiveis[index + 1];
            let novoTrechoProximo = [];
            if (modosTraco[index + 1] === 'livre') {
                novoTrechoProximo = [[coordenadasNiveis[index].lat, coordenadasNiveis[index].lng], [ptProximo.lat, ptProximo.lng]];
            } else {
                novoTrechoProximo = await buscarRotaBRouter(coordenadasNiveis[index], ptProximo);
            }
            segmentosRota[index + 1] = novoTrechoProximo;
            linhasDesenhadas[index + 1].setLatLngs(novoTrechoProximo);
        }
        
        atualizarDistancia();
        salvarEstado(); // Salva a foto do mapa após arrastar
        carregandoRota = false;
    });

    return marcador;
}

async function adicionarPontoNaLinha(linha, evento) {
    if (carregandoRota) return;
    carregandoRota = true;

    const index = linhasDesenhadas.indexOf(linha);
    if (index === -1) {
        carregandoRota = false;
        return;
    }

    let coordenadaClique = evento.latlng;
    const modoAtual = modosTraco[index];

    const novoMarcador = criarMarcador(coordenadaClique, modoAtual === 'livre');
    coordenadasNiveis.splice(index, 0, coordenadaClique);
    marcadores.splice(index, 0, novoMarcador);
    modosTraco.splice(index, 0, modoAtual);
    linhasDesenhadas.splice(index, 0, null); 
    segmentosRota.splice(index, 0, []); 

    const ptAnterior = coordenadasNiveis[index - 1];
    let trechoAnterior = [];
    if (modoAtual === 'livre') {
        trechoAnterior = [[ptAnterior.lat, ptAnterior.lng], [coordenadaClique.lat, coordenadaClique.lng]];
    } else {
        trechoAnterior = await buscarRotaBRouter(ptAnterior, coordenadaClique);
        const ult = trechoAnterior[trechoAnterior.length - 1];
        coordenadaClique = L.latLng(ult[0], ult[1]);
        coordenadasNiveis[index] = coordenadaClique;
        novoMarcador.setLatLng(coordenadaClique);
    }

    const estiloLinha = modoAtual === 'livre' ? { color: 'red', weight: 4, opacity: 0.8, dashArray: '10, 10' } : { color: 'red', weight: 4, opacity: 0.8 };
    const novaLinhaAnterior = L.polyline(trechoAnterior, estiloLinha).addTo(map);
    
    novaLinhaAnterior.on('click', (e) => {
        L.DomEvent.stopPropagation(e); 
        adicionarPontoNaLinha(novaLinhaAnterior, e);
    });
    
    linhasDesenhadas[index] = novaLinhaAnterior;
    segmentosRota[index] = trechoAnterior;

    const ptProximo = coordenadasNiveis[index + 1];
    const modoProximo = modosTraco[index + 1];
    let trechoProximo = [];
    if (modoProximo === 'livre') {
        trechoProximo = [[coordenadaClique.lat, coordenadaClique.lng], [ptProximo.lat, ptProximo.lng]];
    } else {
        trechoProximo = await buscarRotaBRouter(coordenadaClique, ptProximo);
    }

    linhasDesenhadas[index + 1].setLatLngs(trechoProximo);
    segmentosRota[index + 1] = trechoProximo;

    atualizarDistancia();
    salvarEstado(); // Salva a foto do mapa após criar o ponto no meio da linha
    carregandoRota = false;
}

map.on('click', async function(evento) {
    if (carregandoRota) return;
    carregandoRota = true;
    
    const coordenadaAtual = evento.latlng;
    const shiftPressionado = evento.originalEvent.shiftKey;
    const ehPrimeiroPonto = coordenadasNiveis.length === 0;

    if (ehPrimeiroPonto) {
        coordenadasNiveis.push(coordenadaAtual);
        segmentosRota.push([[coordenadaAtual.lat, coordenadaAtual.lng]]); 
        modosTraco.push('inicio');
        linhasDesenhadas.push(null); 
        marcadores.push(criarMarcador(coordenadaAtual, shiftPressionado));
        
        salvarEstado();
        carregandoRota = false;
        return; 
    }

    const pontoAnterior = coordenadasNiveis[coordenadasNiveis.length - 1];
    let trechoRota = [];
    let estiloLinha = {};

    if (shiftPressionado) {
        trechoRota = [[pontoAnterior.lat, pontoAnterior.lng], [coordenadaAtual.lat, coordenadaAtual.lng]];
        coordenadasNiveis.push(coordenadaAtual);
        estiloLinha = { color: 'red', weight: 4, opacity: 0.8, dashArray: '10, 10' };
        modosTraco.push('livre');
        marcadores.push(criarMarcador(coordenadaAtual, true));
        
    } else {
        trechoRota = await buscarRotaBRouter(pontoAnterior, coordenadaAtual); 
        const ultimoPonto = trechoRota[trechoRota.length - 1];
        const coordenadaAjustada = L.latLng(ultimoPonto[0], ultimoPonto[1]);

        coordenadasNiveis.push(coordenadaAjustada);
        estiloLinha = { color: 'red', weight: 4, opacity: 0.8 };
        modosTraco.push('rua');
        marcadores.push(criarMarcador(coordenadaAjustada, false));
    }

    const novaLinha = L.polyline(trechoRota, estiloLinha).addTo(map);
    
    novaLinha.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        adicionarPontoNaLinha(novaLinha, e);
    });
    
    linhasDesenhadas.push(novaLinha);
    segmentosRota.push(trechoRota);

    atualizarDistancia();
    salvarEstado(); // Salva a foto do mapa após um clique normal
    carregandoRota = false; 
});

// O Sistema de Desfazer (Ctrl + Z) atualizado com a Máquina do Tempo
window.addEventListener('keyup', function(evento) {
    if (evento.ctrlKey && (evento.key === 'z' || evento.key === 'Z')) {
        // Verifica se há algo no passado para resgatar
        if (historicoEstados.length > 1) {
            historicoEstados.pop(); // Descarta o presente (última ação)
            
            // Pega as memórias do passo imediatamente anterior
            const passado = historicoEstados[historicoEstados.length - 1]; 
            
            // Substitui todas as listas atuais pelas memórias passadas
            coordenadasNiveis = passado.coordenadas.map(c => L.latLng(c.lat, c.lng));
            segmentosRota = JSON.parse(JSON.stringify(passado.segmentos));
            modosTraco = [...passado.modos];
            
            redesenharMapa(); // Refaz o desenho baseado no passado
        }
    }
});

document.getElementById('btn-limpar').addEventListener('click', function() {
    coordenadasNiveis = [];
    segmentosRota = [];
    modosTraco = [];
    redesenharMapa();
    salvarEstado(); // Grava a limpeza no histórico (permitindo Ctrl+Z para desfazer a exclusão)
});

document.getElementById('btn-exportar').addEventListener('click', function() {
    if (segmentosRota.length === 0) {
        alert("Desenhe uma rota no mapa primeiro!");
        return;
    }
    
    let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Strava Art Generator">\n  <trk>\n    <name>Strava Art Route</name>\n    <trkseg>\n';
    
    const todosPontos = segmentosRota.flat();
    let ultimoPonto = null;

    todosPontos.forEach(ponto => {
        if (!ultimoPonto || ultimoPonto[0] !== ponto[0] || ultimoPonto[1] !== ponto[1]) {
            gpx += `      <trkpt lat="${ponto[0]}" lon="${ponto[1]}"></trkpt>\n`;
            ultimoPonto = ponto;
        }
    });
    
    gpx += '    </trkseg>\n  </trk>\n</gpx>';
    
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const linkTag = document.createElement('a');
    linkTag.href = url;
    linkTag.download = 'strava_art.gpx';
    document.body.appendChild(linkTag);
    linkTag.click();
    document.body.removeChild(linkTag);
    URL.revokeObjectURL(url);
});