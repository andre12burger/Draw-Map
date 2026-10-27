import { describe, expect, it } from 'vitest';
import {
  escaparXml,
  formatarCoordenada,
  gerarGPX,
  nomeArquivo,
} from '../../public/js/export/gpx.js';

const estadoBase = {
  nomeRota: 'Corrida & Arte',
  segmentosRota: [
    [
      [-32.0332, -52.0986, 5],
      [-32.034, -52.099, 6],
    ],
    [
      [-32.034, -52.099, 6],
      [-32.035, -52.1, 7],
    ],
  ],
};

describe('GPX', () => {
  it('gera GPX 1.1 com metadados, elevação e track points', () => {
    const gpx = gerarGPX(estadoBase, {
      nome: 'Minha Rota',
      geradoEm: '2026-01-02T03:04:05.000Z',
    });

    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('<metadata>');
    expect(gpx).toContain('<name>Minha Rota</name>');
    expect(gpx).toContain('<time>2026-01-02T03:04:05.000Z</time>');
    expect(gpx).toContain('<ele>5.0</ele>');
    expect(gpx.match(/<trkpt /g)).toHaveLength(3);
  });

  it('remove pontos duplicados consecutivos', () => {
    const estado = {
      segmentosRota: [
        [
          [1, 2],
          [1, 2],
          [3, 4],
        ],
      ],
    };
    const gpx = gerarGPX(estado, { geradoEm: '2026-01-01T00:00:00.000Z' });
    expect(gpx.match(/<trkpt /g)).toHaveLength(2);
  });

  it('escapa caracteres especiais no nome', () => {
    const gpx = gerarGPX(
      {
        segmentosRota: [
          [
            [1, 2],
            [3, 4],
          ],
        ],
      },
      { nome: 'A & B <x> "y"', geradoEm: '2026-01-01T00:00:00.000Z' },
    );
    expect(gpx).toContain('A &amp; B &lt;x&gt; &quot;y&quot;');
    expect(gpx).not.toContain('<x>');
  });

  it('retorna null com menos de dois pontos', () => {
    expect(gerarGPX({ segmentosRota: [] })).toBeNull();
    expect(gerarGPX({ segmentosRota: [[[1, 2]]] })).toBeNull();
  });

  it('formata coordenadas sem ruído de ponto flutuante', () => {
    expect(formatarCoordenada(-32.0332)).toBe('-32.0332');
    expect(formatarCoordenada(0)).toBe('0');
    expect(formatarCoordenada(Number.NaN)).toBe('0');
  });

  it('sanitiza o nome do arquivo', () => {
    expect(nomeArquivo('Rota Ação & Cia')).toBe('Rota_Acao_Cia.gpx');
    expect(nomeArquivo('')).toBe('strava_art.gpx');
  });

  it('escapa os cinco caracteres XML', () => {
    expect(escaparXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});
