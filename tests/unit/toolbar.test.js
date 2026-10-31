import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../public/js/services/api.js', () => ({
  buscarRota: vi.fn(),
  buscarRotaLote: vi.fn(),
  obterPontoRua: vi.fn(),
  rotearPontos: vi.fn(async (pontos) => pontos.map(({ lat, lng }) => [lat, lng, 0])),
}));

vi.mock('../../public/js/ui/toast.js', () => ({
  mostrarToast: vi.fn(),
}));

import { definirPerfil, inicializarToolbar } from '../../public/js/ui/toolbar.js';
import {
  fecharEstudioForma,
  inicializarEstudioForma,
  selecionarForma,
} from '../../public/js/map/shape-studio.js';
import { getForma, limparFormas } from '../../public/js/map/shapes.js';
import { getMap } from '../../public/js/map/map.js';
import { getEstado, resetarEstado } from '../../public/js/core/state.js';

const CENTRO = { lat: -32.03, lng: -52.1 };

function pressionado(seletor) {
  return document.querySelector(seletor)?.getAttribute('aria-pressed');
}

describe('ui/toolbar — barra inferior (jsdom)', () => {
  beforeAll(async () => {
    const html = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
    const corpo = html.match(/<body>([\s\S]*)<\/body>/i)?.[1] ?? '';
    document.body.innerHTML = corpo.replace(/<script[\s\S]*?<\/script>/gi, '');

    const leaflet = await import('leaflet');
    globalThis.L = leaflet.default ?? leaflet;
    globalThis.L.Browser.svg = true;
    getMap().setView([CENTRO.lat, CENTRO.lng], 15);

    inicializarEstudioForma();
    inicializarToolbar();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    resetarEstado();
    limparFormas();
    fecharEstudioForma();
  });

  afterEach(() => {
    fecharEstudioForma();
    vi.useRealTimers();
  });

  it('inicia com Cycling + Points e sincroniza aria-pressed', () => {
    expect(pressionado('[data-perfil="bike"]')).toBe('true');
    expect(pressionado('[data-ferramenta="rua"]')).toBe('true');
    expect(pressionado('[data-ferramenta="forma"]')).toBe('false');
  });

  it('Walking mantém a ferramenta e atualiza o perfil de rota', () => {
    document.querySelector('[data-perfil="foot"]').click();

    expect(pressionado('[data-perfil="foot"]')).toBe('true');
    expect(pressionado('[data-perfil="bike"]')).toBe('false');
    expect(pressionado('[data-ferramenta="rua"]')).toBe('true');
    expect(getEstado().perfilRota).toBe('foot');
  });

  it('Free ativa o traço livre sem seguir ruas, mantendo Points ativo', () => {
    document.querySelector('[data-perfil="free"]').click();

    expect(pressionado('[data-perfil="free"]')).toBe('true');
    expect(pressionado('[data-ferramenta="rua"]')).toBe('true');
    expect(getEstado().ferramentaAtiva).toBe('rua');
    expect(getEstado().perfilUi).toBe('free');
    expect(getEstado().perfilRota).toBe('bike');
  });

  it('Shape abre o painel dinâmico e Points volta à rota', () => {
    document.querySelector('[data-ferramenta="forma"]').click();

    expect(getEstado().ferramentaAtiva).toBe('forma');
    expect(pressionado('[data-ferramenta="forma"]')).toBe('true');
    expect(document.getElementById('painel-forma').hidden).toBe(false);
    expect(document.getElementById('painel-rota').hidden).toBe(true);
    expect(getForma('forma-ativa')).not.toBeNull();

    document.querySelector('[data-ferramenta="rua"]').click();

    expect(getEstado().ferramentaAtiva).toBe('rua');
    expect(document.getElementById('painel-forma').hidden).toBe(true);
    expect(getForma('forma-ativa')).toBeNull();
  });

  it('trocar de forma com o painel aberto recria o molde', () => {
    document.querySelector('[data-ferramenta="forma"]').click();
    selecionarForma('triangulo');

    expect(pressionado('[data-forma="triangulo"]')).toBe('true');
    expect(getForma('forma-ativa').shape.points.length).toBe(4);
  });

  it('definirPerfil com o modo Shape ativo preserva o molde', () => {
    document.querySelector('[data-ferramenta="forma"]').click();
    definirPerfil('foot');

    expect(getEstado().ferramentaAtiva).toBe('forma');
    expect(getEstado().perfilRota).toBe('foot');
    expect(getForma('forma-ativa')).not.toBeNull();
  });
});
