/**
 * @file server.js
 * @description Web Service principal construído em Node.js com Express.
 * Este servidor atua como um intermediário (Proxy) entre o frontend (Interface do Cliente)
 * e as APIs de terceiros. Esta arquitetura resolve problemas de CORS, protege a lógica 
 * de negócio e centraliza as requisições externas.
 * 
 * @author André Luiz Ditzel Burger
 */

const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

/**
 * @middleware Arquivos Estáticos
 * @description Define a pasta 'public' como o diretório raiz para o frontend.
 * Qualquer requisição não mapeada nas rotas de API buscará arquivos HTML/CSS/JS aqui.
 */
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * @route GET /api/pesquisa
 * @description Consome a API do Nominatim (OpenStreetMap) para Geocodificação.
 * Converte um endereço em texto para coordenadas geográficas.
 * @param {string} req.query.q - O endereço digitado pelo usuário na barra de busca.
 * @returns {Array} JSON contendo até 5 sugestões de locais com propriedades de latitude, longitude e nome.
 */
app.get('/api/pesquisa', async (req, res) => {
    try {
        const query = req.query.q;
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
        
        const resposta = await fetch(url, {
            headers: { 'User-Agent': 'StravaArtGenerator/1.0 (Trabalho Academico)' }
        });
        
        const dados = await resposta.json();
        res.json(dados);
    } catch (error) {
        console.error('Erro na API de pesquisa:', error);
        res.status(500).json({ erro: 'Falha ao comunicar com a API de Geocodificação' });
    }
});

/**
 * @route GET /api/rota
 * @description Consome a API do BRouter para calcular o trajeto otimizado nas ruas.
 * @param {string} req.query.lonlats - Coordenadas de início e fim separadas por pipe (|).
 * @param {string} req.query.profile - Perfil de roteamento (ex: shortest para pedestres).
 * @returns {Object} Um objeto GeoJSON contendo a matriz de coordenadas da rota gerada.
 */
app.get('/api/rota', async (req, res) => {
    try {
        const { lonlats, profile } = req.query;
        const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile}&format=geojson`;
        
        const resposta = await fetch(url);
        const dados = await resposta.json();
        res.json(dados);
    } catch (error) {
        console.error('Erro na API de roteamento:', error);
        res.status(500).json({ erro: 'Falha ao comunicar com a API de Roteamento' });
    }
});

/**
 * @event listen
 * @description Inicia o servidor e o coloca em estado de escuta na porta definida.
 */
app.listen(PORT, () => {
    console.log(`Servidor Web rodando na porta ${PORT}`);
});