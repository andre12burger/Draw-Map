// previsao.js - Efeitos visuais do cursor e inteligência de debounce

let marcadorPrevia = null;
let debouncePrevia = null;

async function obterSnapSilencioso(latlng) {
    const destinoFake = L.latLng(latlng.lat + 0.0001, latlng.lng + 0.0001);
    const url = `https://brouter.de/brouter?lonlats=${latlng.lng},${latlng.lat}|${destinoFake.lng},${destinoFake.lat}&profile=shortest&format=geojson`;
    try {
        const resposta = await fetch(url);
        if (!resposta.ok) return null;
        const dados = await resposta.json();
        if (dados.features && dados.features.length > 0) {
            return L.latLng(dados.features[0].geometry.coordinates[0][1], dados.features[0].geometry.coordinates[0][0]);
        }
    } catch (e) {
        return null;
    }
    return null;
}

map.on('mousemove', function(e) {
    // Agora a previsão respeita o botão da toolbar OU o Shift
    const usarModoLivre = e.originalEvent.shiftKey || window.ferramentaAtiva === 'livre';
    
    const classeCss = usarModoLivre ? 'marcador-previa marcador-previa-livre' : 'marcador-previa';
    const iconePrevia = L.divIcon({ className: classeCss, iconSize: [12, 12], iconAnchor: [6, 6] });

    if (!marcadorPrevia) {
        marcadorPrevia = L.marker(e.latlng, { icon: iconePrevia, interactive: false }).addTo(map);
    } else {
        marcadorPrevia.setIcon(iconePrevia);
    }

    marcadorPrevia.setLatLng(e.latlng);

    if (usarModoLivre) {
        marcadorPrevia.setOpacity(1); 
        clearTimeout(debouncePrevia);
        return;
    }

    marcadorPrevia.setOpacity(0.4); 
    clearTimeout(debouncePrevia);
    
    debouncePrevia = setTimeout(async () => {
        if (marcadorPrevia && !usarModoLivre) {
            const snap = await obterSnapSilencioso(e.latlng);
            if (snap) {
                marcadorPrevia.setLatLng(snap);
                marcadorPrevia.setOpacity(1); 
            }
        }
    }, 400); 
});

map.on('mouseout', function() {
    clearTimeout(debouncePrevia);
    if (marcadorPrevia) {
        map.removeLayer(marcadorPrevia);
        marcadorPrevia = null;
    }
});

window.addEventListener('keydown', function(e) {
    if (e.key === 'Shift' && marcadorPrevia) {
        clearTimeout(debouncePrevia);
        const iconeLivre = L.divIcon({ className: 'marcador-previa marcador-previa-livre', iconSize: [12, 12], iconAnchor: [6, 6] });
        marcadorPrevia.setIcon(iconeLivre);
        marcadorPrevia.setOpacity(1);
    }
});

window.addEventListener('keyup', function(e) {
    if (e.key === 'Shift' && marcadorPrevia) {
        // Só devolve para o estilo de rua se a toolbar não estiver forçando o modo livre
        if (window.ferramentaAtiva !== 'livre') {
            const iconeRua = L.divIcon({ className: 'marcador-previa', iconSize: [12, 12], iconAnchor: [6, 6] });
            marcadorPrevia.setIcon(iconeRua);
            marcadorPrevia.setOpacity(0.4);
        }
    }
});