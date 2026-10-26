/**
 * @file previsao.js
 * @description Módulo de feedback visual (Ghost Cursor/Preview).
 * Projeta um marcador semitransparente na rua mais próxima ao cursor do rato,
 * permitindo ao utilizador prever onde o ponto será ancorado antes do clique.
 */

import { obterSnapSilencioso } from './api.js';
import { map, obterEstilosDinamicos } from './mapa.js';

let marcadorPrevia = null;
let debouncePrevia = null;

/**
 * @event mousemove
 * @description Interceta o movimento do rato sobre o mapa cartográfico.
 * Aplica um algoritmo de Debounce para não sobrecarregar a API com pedidos de projeção.
 */
map.on('mousemove', function(e) {
    const usarModoLivre = e.originalEvent.shiftKey || window.ferramentaAtiva === 'livre';
    const classeCss = usarModoLivre ? 'marcador-previa marcador-previa-livre' : 'marcador-previa';
    
    const { tamanhoMarcador } = obterEstilosDinamicos();
    const iconePrevia = L.divIcon({ 
        className: classeCss, 
        iconSize: [tamanhoMarcador, tamanhoMarcador], 
        iconAnchor: [tamanhoMarcador / 2, tamanhoMarcador / 2] 
    });

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
            if (snap && marcadorPrevia) {
                marcadorPrevia.setLatLng(snap);
                marcadorPrevia.setOpacity(1); 
            }
        }
    }, 400); 
});

/**
 * @event mouseout
 * @description Remove o marcador fantasma da interface quando o cursor sai da área do mapa.
 */
map.on('mouseout', function() {
    clearTimeout(debouncePrevia);
    if (marcadorPrevia) {
        map.removeLayer(marcadorPrevia);
        marcadorPrevia = null;
    }
});