// js/mapa.js - Core do mapa, variáveis de estado e interações físicas

window.ferramentaAtiva = 'rua'; 

// Controle dos botões
document.getElementById('btn-ferramenta-rua').addEventListener('click', function() {
    window.ferramentaAtiva = 'rua';
    atualizarBotoesFerramentas(this);
    document.getElementById('map').classList.remove('cursor-lapis');
});

document.getElementById('btn-ferramenta-livre').addEventListener('click', function() {
    window.ferramentaAtiva = 'livre';
    atualizarBotoesFerramentas(this);
    document.getElementById('map').classList.remove('cursor-lapis');
});

document.getElementById('btn-ferramenta-lapis').addEventListener('click', function() {
    window.ferramentaAtiva = 'lapis';
    atualizarBotoesFerramentas(this);
    document.getElementById('map').classList.add('cursor-lapis');
});

function atualizarBotoesFerramentas(botaoAtivo) {
    document.querySelectorAll('.btn-ferramenta').forEach(btn => btn.classList.remove('ativo'));
    botaoAtivo.classList.add('ativo');
}

// Atalhos de teclado (1, 2, 3)
window.addEventListener('keydown', function(e) {
    // Ignora atalhos se o usuário estiver digitando em algum campo de texto no futuro
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    if (e.key === '1') document.getElementById('btn-ferramenta-rua').click();
    if (e.key === '2') document.getElementById('btn-ferramenta-livre').click();
    if (e.key === '3') document.getElementById('btn-ferramenta-lapis').click();
    
    // Ctrl + Z
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
        if (historicoEstados.length > 1) {
            historicoEstados.pop(); 
            const passado = historicoEstados[historicoEstados.length - 1]; 
            coordenadasNiveis = passado.coordenadas.map(c => L.latLng(c.lat, c.lng));
            segmentosRota = JSON.parse(JSON.stringify(passado.segmentos));
            modosTraco = [...passado.modos];
            redesenharMapa(); 
        }
    }
});

const map = L.map('map', {
    doubleClickZoom: false, 
    boxZoom: false          
}).setView([-32.0332, -52.0986], 14);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 24,
    maxNativeZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

let coordenadasNiveis = []; 
let segmentosRota = [];     
let marcadores = [];        
let linhasDesenhadas = [];  
let modosTraco = []; 
let carregandoRota = false; 
let historicoEstados = []; 

function salvarEstado() {
    historicoEstados.push({
        coordenadas: coordenadasNiveis.map(c => L.latLng(c.lat, c.lng)),
        segmentos: JSON.parse(JSON.stringify(segmentosRota)),
        modos: [...modosTraco]
    });
}

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
            linha.on('contextmenu', (e) => {
                L.DomEvent.stopPropagation(e);
                adicionarPontoNaLinha(linha, e);
            });
            linhasDesenhadas.push(linha);
        }
    }
    atualizarDistancia();
}

salvarEstado();

function atualizarDistancia() {
    let distanciaTotal = 0;
    const todosPontos = segmentosRota.flat(); 
    for (let i = 0; i < todosPontos.length - 1; i++) {
        const ptA = L.latLng(todosPontos[i][0], todosPontos[i][1]);
        const ptB = L.latLng(todosPontos[i+1][0], todosPontos[i+1][1]);
        distanciaTotal += ptA.distanceTo(ptB); 
    }
    document.getElementById('distancia-total').innerText = (distanciaTotal / 1000).toFixed(2);
    document.getElementById('contador-pontos').innerText = coordenadasNiveis.length;
}

function criarMarcador(latlng, ehLivre) {
    const classeCss = ehLivre ? 'marcador-custom marcador-livre' : 'marcador-custom';
    const icone = L.divIcon({ className: classeCss, iconSize: [12, 12], iconAnchor: [6, 6] });
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
                    if (index > 0) novaPosicao = L.latLng(trechoTemp[trechoTemp.length - 1][0], trechoTemp[trechoTemp.length - 1][1]);
                    else novaPosicao = L.latLng(trechoTemp[0][0], trechoTemp[0][1]);
                } else {
                    novaPosicao = coordenadasNiveis[index]; 
                }
            } else {
                const snap = await obterPontoRua(novaPosicao);
                if (snap) novaPosicao = snap;
                else novaPosicao = coordenadasNiveis[index];
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
        } else {
            segmentosRota[0] = [[novaPosicao.lat, novaPosicao.lng]];
        }

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
    if (index === -1) {
        carregandoRota = false;
        return;
    }

    let coordenadaClique = evento.latlng;
    const modoAtual = modosTraco[index];
    const ehLivre = modoAtual === 'livre';

    const ptAnterior = coordenadasNiveis[index - 1];
    let trechoAnterior = await buscarRotaBRouter(ptAnterior, coordenadaClique, ehLivre);

    if (!trechoAnterior) {
        alert("O servidor roteador está ocupado. Espere 1 segundo e tente novamente.");
        carregandoRota = false;
        return;
    }

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

    const estiloLinha = ehLivre ? { color: 'red', weight: 4, opacity: 0.8, dashArray: '10, 10' } : { color: 'red', weight: 4, opacity: 0.8 };
    const novaLinhaAnterior = L.polyline(trechoAnterior, estiloLinha).addTo(map);
    
    novaLinhaAnterior.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e); 
        adicionarPontoNaLinha(novaLinhaAnterior, e);
    });
    
    linhasDesenhadas[index] = novaLinhaAnterior;
    segmentosRota[index] = trechoAnterior;

    const ptProximo = coordenadasNiveis[index + 1];
    let trechoProximo = await buscarRotaBRouter(coordenadaClique, ptProximo, modosTraco[index + 1] === 'livre');

    if (trechoProximo) {
        if (!ehLivre && modosTraco[index + 1] !== 'livre') {
            trechoProximo[0] = [coordenadaClique.lat, coordenadaClique.lng];
        }
        linhasDesenhadas[index + 1].setLatLngs(trechoProximo);
        segmentosRota[index + 1] = trechoProximo;
    }

    atualizarDistancia();
    salvarEstado(); 
    carregandoRota = false;
}

// Isola a lógica de adicionar um ponto para ser chamada pelo clique ou pelo script do Lápis
window.processarNovoPonto = async function(coordenadaAtual, modoLivreAtivo) {
    if (carregandoRota) return false;
    carregandoRota = true;
    
    const ehPrimeiroPonto = coordenadasNiveis.length === 0;

    if (ehPrimeiroPonto) {
        let posicaoInicial = coordenadaAtual;
        
        if (!modoLivreAtivo) {
            const snap = await obterPontoRua(coordenadaAtual);
            if (!snap) {
                carregandoRota = false;
                return false;
            }
            posicaoInicial = snap; 
        }

        coordenadasNiveis.push(posicaoInicial);
        segmentosRota.push([[posicaoInicial.lat, posicaoInicial.lng]]); 
        modosTraco.push(modoLivreAtivo ? 'livre' : 'rua');
        linhasDesenhadas.push(null); 
        marcadores.push(criarMarcador(posicaoInicial, modoLivreAtivo));
        
        salvarEstado();
        carregandoRota = false;
        return true; 
    }

    const pontoAnterior = coordenadasNiveis[coordenadasNiveis.length - 1];
    let trechoRota = await buscarRotaBRouter(pontoAnterior, coordenadaAtual, modoLivreAtivo);

    if (!trechoRota) {
        carregandoRota = false;
        return false;
    }

    let estiloLinha = {};
    let posicaoFinal;

    if (modoLivreAtivo) {
        posicaoFinal = coordenadaAtual;
        estiloLinha = { color: 'red', weight: 4, opacity: 0.8, dashArray: '10, 10' };
        modosTraco.push('livre');
    } else {
        posicaoFinal = L.latLng(trechoRota[trechoRota.length - 1][0], trechoRota[trechoRota.length - 1][1]);
        trechoRota[0] = [pontoAnterior.lat, pontoAnterior.lng];
        estiloLinha = { color: 'red', weight: 4, opacity: 0.8 };
        modosTraco.push('rua');
    }

    coordenadasNiveis.push(posicaoFinal);
    marcadores.push(criarMarcador(posicaoFinal, modoLivreAtivo)); 

    const novaLinha = L.polyline(trechoRota, estiloLinha).addTo(map);
    novaLinha.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e);
        adicionarPontoNaLinha(novaLinha, e);
    });
    
    linhasDesenhadas.push(novaLinha);
    segmentosRota.push(trechoRota);

    atualizarDistancia();
    salvarEstado(); 
    carregandoRota = false;
    return true;
}

map.on('click', async function(evento) {
    // Ignora cliques simples se a ferramenta lápis estiver ativada
    if (window.ferramentaAtiva === 'lapis') return;
    
    const modoLivreAtivo = evento.originalEvent.shiftKey || window.ferramentaAtiva === 'livre';
    const sucesso = await window.processarNovoPonto(evento.latlng, modoLivreAtivo);
    if (!sucesso && !carregandoRota) {
        alert("Servidor ocupado. Aguarde 1 segundo e tente novamente.");
    }
});

document.getElementById('btn-limpar').addEventListener('click', function() {
    coordenadasNiveis = [];
    segmentosRota = [];
    modosTraco = [];
    redesenharMapa();
    salvarEstado(); 
});