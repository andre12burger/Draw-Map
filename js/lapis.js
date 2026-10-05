// js/lapis.js - Motor da Ferramenta de Desenho Livre

let desenhandoLapis = false;
let linhaRabiscaLapis = null;
let coordenadasRabisco = [];

// DISTÂNCIA MÍNIMA DE AMOSTRAGEM (Em metros)
// Pega um ponto de ancoragem a cada 50 metros desenhados pelo mouse
const ESPACAMENTO_AMOSTRAGEM = 50; 

map.on('mousedown', function(e) {
    if (window.ferramentaAtiva !== 'lapis') return;
    
    // Trava o arrasto visual do mapa para permitir o desenho do lápis
    map.dragging.disable();
    desenhandoLapis = true;
    coordenadasRabisco = [e.latlng];
    
    // Cria a linha guia que vai acompanhar o ponteiro do mouse
    linhaRabiscaLapis = L.polyline(coordenadasRabisco, {
        color: '#607D8B', 
        weight: 4, 
        dashArray: '5, 5',
        opacity: 0.7
    }).addTo(map);
});

map.on('mousemove', function(e) {
    if (!desenhandoLapis || window.ferramentaAtiva !== 'lapis') return;
    
    // Alimenta a linha guia em tempo real
    coordenadasRabisco.push(e.latlng);
    linhaRabiscaLapis.setLatLngs(coordenadasRabisco);
});

map.on('mouseup', async function(e) {
    if (!desenhandoLapis || window.ferramentaAtiva !== 'lapis') return;
    
    desenhandoLapis = false;
    map.dragging.enable(); // Libera a navegação do mapa novamente

    if (coordenadasRabisco.length < 2) {
        map.removeLayer(linhaRabiscaLapis);
        return;
    }

    // Altera a cor do traço para indicar que está "calculando"
    linhaRabiscaLapis.setStyle({ color: '#FF9800' });
    
    await converterRabiscoEmRota(coordenadasRabisco);
    
    // Remove o traço rabiscado original, deixando apenas a rota vermelha final
    map.removeLayer(linhaRabiscaLapis);
    linhaRabiscaLapis = null;
});

async function converterRabiscoEmRota(pontosBrutos) {
    // Passo 1: Filtrar/Amostras. Reduz milhares de pixels para poucos pontos cruciais
    let pontosFiltrados = [pontosBrutos[0]];
    let ultimoPontoSalvo = pontosBrutos[0];

    for (let i = 1; i < pontosBrutos.length; i++) {
        if (ultimoPontoSalvo.distanceTo(pontosBrutos[i]) >= ESPACAMENTO_AMOSTRAGEM) {
            pontosFiltrados.push(pontosBrutos[i]);
            ultimoPontoSalvo = pontosBrutos[i];
        }
    }
    // Garante que o ponto exato onde você soltou o clique final entre no processamento
    if (ultimoPontoSalvo !== pontosBrutos[pontosBrutos.length - 1]) {
        pontosFiltrados.push(pontosBrutos[pontosBrutos.length - 1]);
    }

    // Passo 2: Processar a rota no BRouter
    // Por enquanto, usaremos a versão rígida (modo Rua estrito = false no processarNovoPonto).
    // Num update futuro, você pode criar uma variável para ler um checkbox "Lápis Livre"
    
    for (let i = 0; i < pontosFiltrados.length; i++) {
        // Envia o ponto para o arquivo principal como se fosse um clique do usuário
        const sucesso = await window.processarNovoPonto(pontosFiltrados[i], false); 
        
        if (!sucesso) {
            console.warn("Lápis pausou para evitar sobrecarga no BRouter. Retomando...");
            // Se o BRouter chiar com a velocidade (mesmo com os 50m de filtro),
            // recuamos o i e forçamos o loop a esperar 1 segundinho para recuperar o fôlego
            i--; 
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}