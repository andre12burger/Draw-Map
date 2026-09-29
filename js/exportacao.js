// exportacao.js - Geração de arquivos GPX

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