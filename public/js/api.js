/**
 * @file api.js
 * @description Módulo de comunicação com o Web Service local.
 * Centraliza todas as requisições HTTP (Fetch API) do cliente para o servidor,
 * implementando padrões de resiliência como Timeouts e tentativas (Retries).
 */

const PROFILE = 'shortest';
const TIMEOUT = 15000;
const MAX_TENTATIVAS = 3;

let totalRequisicoes = 0;

/**
 * @function registrarRequisicao
 * @description Atualiza o contador de uso da API na interface do usuário para monitoramento de tráfego.
 */
function registrarRequisicao() {
    totalRequisicoes++;
    const elementoContador = document.getElementById('contador-api');
    if (elementoContador) elementoContador.innerText = totalRequisicoes;
}

/**
 * @function fetchComTimeout
 * @description Wrapper customizado para a função fetch nativa. 
 * Aborta automaticamente a requisição se o servidor demorar mais que o tempo limite especificado.
 * @param {string} url - O endpoint do Web Service a ser consumido.
 * @param {Object} opcoes - Configurações adicionais do fetch (headers, métodos).
 * @param {number} tempo - Tempo limite em milissegundos.
 * @returns {Promise<Response>} A resposta bruta da requisição.
 */
async function fetchComTimeout(url, opcoes = {}, tempo = TIMEOUT) {
    registrarRequisicao(); 
    const controlador = new AbortController();
    const timeoutId = setTimeout(() => controlador.abort(), tempo);
    try {
        const resposta = await fetch(url, { ...opcoes, signal: controlador.signal });
        clearTimeout(timeoutId);
        return resposta;
    } catch (erro) {
        clearTimeout(timeoutId);
        throw erro;
    }
}

/**
 * @function buscarRotaBRouter
 * @description Solicita ao Web Service o cálculo de uma rota entre dois pontos.
 * Possui um sistema de fallback: se falhar, tenta novamente até MAX_TENTATIVAS.
 * @param {Object} inicio - Coordenada L.latLng inicial.
 * @param {Object} fim - Coordenada L.latLng final.
 * @param {boolean} modoLivre - Se verdadeiro, ignora o servidor e devolve uma reta direta.
 * @param {number} tentativa - Contador interno de chamadas recursivas.
 * @returns {Array|null} Array tridimensional [lat, lng, elevacao] com o trajeto, ou null em caso de falha.
 */
export async function buscarRotaBRouter(inicio, fim, modoLivre = false, tentativa = 1) {
    if (modoLivre) return [[inicio.lat, inicio.lng, 0], [fim.lat, fim.lng, 0]];

    const lonlats = `${inicio.lng},${inicio.lat}|${fim.lng},${fim.lat}`;
    const url = `/api/rota?lonlats=${lonlats}&profile=${PROFILE}`;

    try {
        const resposta = await fetchComTimeout(url);
        if (!resposta.ok) {
            if (tentativa < MAX_TENTATIVAS) {
                await new Promise(resolve => setTimeout(resolve, 1000 * tentativa));
                return buscarRotaBRouter(inicio, fim, modoLivre, tentativa + 1);
            }
            throw new Error(`Erro: ${resposta.status}`);
        }
        const dados = await resposta.json();
        if (!dados.features || dados.features.length === 0) throw new Error('Nenhuma rota encontrada');
        return dados.features[0].geometry.coordinates.map(coord => [coord[1], coord[0], coord[2] || 0]);
    } catch (erro) {
        if (tentativa < MAX_TENTATIVAS) {
            await new Promise(resolve => setTimeout(resolve, 1000 * tentativa));
            return buscarRotaBRouter(inicio, fim, modoLivre, tentativa + 1);
        }
        return null;
    }
}

/**
 * @function buscarRotaLoteBRouter
 * @description Algoritmo de Batch Routing. Divide um desenho complexo (ferramenta Lápis) 
 * em lotes menores para não ultrapassar o limite de tamanho da URL HTTP (URI Too Long).
 * @param {Array} pontos - Matriz de coordenadas brutas desenhadas pelo usuário.
 * @returns {Array|null} Traçado completo e consolidado, ancorado na malha urbana.
 */
export async function buscarRotaLoteBRouter(pontos) {
    const TAMANHO_LOTE = 40; 
    let rotasCompletas = [];

    for (let i = 0; i < pontos.length; i += TAMANHO_LOTE - 1) {
        let lote = pontos.slice(i, i + TAMANHO_LOTE);
        if (lote.length < 2) continue;

        const lonlats = lote.map(p => `${p.lng},${p.lat}`).join('|');
        const url = `/api/rota?lonlats=${lonlats}&profile=${PROFILE}`;

        try {
            const resposta = await fetchComTimeout(url);
            if (!resposta.ok) return null;
            const dados = await resposta.json();
            if (dados.features && dados.features.length > 0) {
                const coords = dados.features[0].geometry.coordinates.map(c => [c[1], c[0], c[2] || 0]);
                if (i > 0) coords.shift(); 
                rotasCompletas = rotasCompletas.concat(coords);
            } else {
                return null;
            }
        } catch (e) {
            return null;
        }
    }
    return rotasCompletas.length > 0 ? rotasCompletas : null;
}

/**
 * @function obterPontoRua
 * @description Projeta uma coordenada arbitrária no ponto de via roteável mais próximo (Snap-to-road).
 * @param {Object} latlng - Coordenada onde ocorreu o clique do usuário.
 * @returns {Object|null} Objeto L.latLng ajustado para a rua mais próxima.
 */
export async function obterPontoRua(latlng) {
    const destinoFake = { lat: latlng.lat + 0.0001, lng: latlng.lng + 0.0001 };
    const trecho = await buscarRotaBRouter(latlng, destinoFake, false);
    if (trecho && trecho.length > 0) return L.latLng(trecho[0][0], trecho[0][1]);
    return null;
}

/**
 * @function obterSnapSilencioso
 * @description Similar a obterPontoRua, mas otimizado para o efeito visual do cursor (fantasma).
 * Executa chamadas rápidas sem registrar na interface ou gerar alertas de erro.
 */
export async function obterSnapSilencioso(latlng) {
    const destinoFake = { lat: latlng.lat + 0.0001, lng: latlng.lng + 0.0001 };
    const lonlats = `${latlng.lng},${latlng.lat}|${destinoFake.lng},${destinoFake.lat}`;
    const url = `/api/rota?lonlats=${lonlats}&profile=${PROFILE}`;
    
    try {
        const resposta = await fetchComTimeout(url);
        if (!resposta.ok) return null;
        const dados = await resposta.json();
        if (dados.features && dados.features.length > 0) {
            return L.latLng(dados.features[0].geometry.coordinates[0][1], dados.features[0].geometry.coordinates[0][0]);
        }
    } catch (e) { return null; }
    return null;
}

/**
 * @function buscarEndereco
 * @description Consulta o Web Service para procurar um local específico via Nominatim.
 * @param {string} query - O texto digitado na barra de pesquisa (Ex: "Praça Saraiva").
 * @returns {Array|null} Array de objetos formatados com as opções encontradas.
 */
export async function buscarEndereco(query) {
    const url = `/api/pesquisa?q=${encodeURIComponent(query)}`;
    
    try {
        const resposta = await fetch(url);
        if (!resposta.ok) return null;
        
        const dados = await resposta.json();
        if (dados && dados.length > 0) {
            return dados.map(local => ({
                lat: parseFloat(local.lat),
                lng: parseFloat(local.lon),
                nome: local.display_name
            }));
        }
        return null;
    } catch (erro) {
        return null;
    }
}