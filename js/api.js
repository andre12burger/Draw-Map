// api.js - Isolamento da comunicação com o servidor BRouter

async function buscarRotaBRouter(inicio, fim, modoLivre = false) {
    if (modoLivre) {
        return [[inicio.lat, inicio.lng], [fim.lat, fim.lng]];
    }
    const url = `https://brouter.de/brouter?lonlats=${inicio.lng},${inicio.lat}|${fim.lng},${fim.lat}&profile=shortest&format=geojson`;
    try {
        const resposta = await fetch(url);
        if (!resposta.ok) return null; 
        const dados = await resposta.json();
        if (dados.features && dados.features.length > 0) {
            return dados.features[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
        }
    } catch (erro) {
        console.error("Erro no BRouter:", erro);
    }
    return null; 
}

async function obterPontoRua(latlng) {
    const destinoFake = L.latLng(latlng.lat + 0.0001, latlng.lng + 0.0001);
    const trecho = await buscarRotaBRouter(latlng, destinoFake, false);
    if (trecho && trecho.length > 0) {
        return L.latLng(trecho[0][0], trecho[0][1]);
    }
    return null;
}

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