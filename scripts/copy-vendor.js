'use strict';

/**
 * @file scripts/copy-vendor.js
 * @description Copia os arquivos de distribuição do Leaflet (instalado via npm)
 * para `public/vendor/leaflet`, permitindo que o frontend seja servido localmente.
 * Isso elimina a dependência de CDN, melhora o CSP e garante funcionamento offline
 * para os assets da biblioteca.
 */

const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const origem = path.join(raiz, 'node_modules', 'leaflet', 'dist');
const destino = path.join(raiz, 'public', 'vendor', 'leaflet');

if (!fs.existsSync(origem)) {
  console.warn('[vendor] Leaflet não encontrado em node_modules; cópia ignorada.');
  process.exit(0);
}

fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });

for (const arquivo of ['leaflet.js', 'leaflet.css']) {
  fs.copyFileSync(path.join(origem, arquivo), path.join(destino, arquivo));
}

const imagens = path.join(origem, 'images');
if (fs.existsSync(imagens)) {
  fs.cpSync(imagens, path.join(destino, 'images'), { recursive: true });
}

console.log('[vendor] Leaflet copiado para public/vendor/leaflet');
