// previsao.js - Efeitos visuais do cursor e inteligência de debounce

let marcadorPrevia = null;
let debouncePrevia = null;

map.on('mousemove', function(e) {
    const shiftPressionado = e.originalEvent.shiftKey;
    const classeCss = shiftPressionado ? 'marcador-previa marcador-previa-livre' : 'marcador-previa';
    const iconePrevia = L.divIcon({ className: classeCss, iconSize: [12, 12], iconAnchor: [6, 6] });

    if (!marcadorPrevia) {
        marcadorPrevia = L.marker(e.latlng, { icon: iconePrevia, interactive: false }).addTo(map);
    } else {
        marcadorPrevia.setIcon(iconePrevia);
    }

    marcadorPrevia.setLatLng(e.latlng);

    if (shiftPressionado) {
        marcadorPrevia.setOpacity(1); 
        clearTimeout(debouncePrevia);
        return;
    }

    marcadorPrevia.setOpacity(0.4); 
    clearTimeout(debouncePrevia);
    
    debouncePrevia = setTimeout(async () => {
        if (marcadorPrevia && !shiftPressionado) {
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
        const iconeRua = L.divIcon({ className: 'marcador-previa', iconSize: [12, 12], iconAnchor: [6, 6] });
        marcadorPrevia.setIcon(iconeRua);
        marcadorPrevia.setOpacity(0.4);
    }
});