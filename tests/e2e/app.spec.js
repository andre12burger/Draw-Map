'use strict';

const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');

/**
 * Mock do BRouter: devolve uma linha reta passando por todos os pontos pedidos.
 * Assim os testes não dependem de rede/API pública.
 */
async function mockApiRota(page) {
  await page.route('**/api/rota**', async (route) => {
    const url = new URL(route.request().url());
    const lonlats = url.searchParams.get('lonlats') || '';
    const coordenadas = lonlats
      .split('|')
      .map((par) => par.split(',').map(Number))
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
      .map(([lon, lat]) => [lon, lat, 0]);

    if (coordenadas.length < 2) {
      await route.fulfill({ status: 400, json: { erro: 'coordenadas inválidas' } });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coordenadas },
            properties: {},
          },
        ],
      }),
    });
  });

  await page.route('**/api/route-points', async (route) => {
    const corpo = route.request().postDataJSON() ?? {};
    const pontos = Array.isArray(corpo.points) ? corpo.points : [];

    if (pontos.length < 2) {
      await route.fulfill({ status: 400, json: { erro: 'points inválidos' } });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        coordinates: pontos.map(([lat, lng]) => [lat, lng, 0]),
        distance_m: 0,
        duration_s: 0,
        profile: corpo.profile ?? 'bike',
      }),
    });
  });

  await page.route('**/api/pesquisa**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { lat: -32.0386, lon: -52.1115, display_name: 'Praça Saraiva, Rio Grande' },
      ]),
    }),
  );

  // PNG 1×1 transparente: evita requisições externas e erros de console.
  const pngTransparente = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lKsH2QAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.route('**/*.tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: pngTransparente }),
  );
}

async function clicarNoMapa(page, fracaoX, fracaoY) {
  const mapa = page.locator('#map');
  const caixa = await mapa.boundingBox();
  await page.mouse.click(caixa.x + caixa.width * fracaoX, caixa.y + caixa.height * fracaoY);
}

test.beforeEach(async ({ page }) => {
  await mockApiRota(page);
  await page.goto('/');
  await expect(page.locator('#map.leaflet-container')).toBeVisible();
});

test('carrega o mapa e a interface sem erros de console', async ({ page }) => {
  const erros = [];
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(mensagem.text());
  });

  await page.reload();
  await expect(page.locator('#map.leaflet-container')).toBeVisible();
  await expect(page.locator('[data-ferramenta="rua"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#distancia-total')).toHaveText('0.00');
  expect(erros.filter((erro) => !erro.includes('tile.openstreetmap.org'))).toEqual([]);
});

test('adiciona dois pontos, calcula distância e desfaz com Ctrl+Z', async ({ page }) => {
  await clicarNoMapa(page, 0.35, 0.45);
  await expect(page.locator('#contador-pontos')).toHaveText('1');

  await clicarNoMapa(page, 0.45, 0.55);
  await expect(page.locator('#contador-pontos')).toHaveText('2');

  const distancia = Number(await page.locator('#distancia-total').textContent());
  expect(distancia).toBeGreaterThan(0);

  await page.keyboard.press('Control+z');
  await expect(page.locator('#contador-pontos')).toHaveText('1');

  await page.keyboard.press('Control+z');
  await expect(page.locator('#contador-pontos')).toHaveText('0');
});

test('persiste a rota após recarregar a página', async ({ page }) => {
  await clicarNoMapa(page, 0.35, 0.45);
  await clicarNoMapa(page, 0.45, 0.55);
  await expect(page.locator('#contador-pontos')).toHaveText('2');

  await page.reload();
  await expect(page.locator('#map.leaflet-container')).toBeVisible();
  await expect(page.locator('#contador-pontos')).toHaveText('2');
  expect(Number(await page.locator('#distancia-total').textContent())).toBeGreaterThan(0);
});

test('exporta GPX 1.1 com os pontos desenhados', async ({ page }) => {
  await clicarNoMapa(page, 0.35, 0.45);
  await clicarNoMapa(page, 0.45, 0.55);
  await expect(page.locator('#contador-pontos')).toHaveText('2');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#btn-exportar').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.gpx$/);
  const caminho = await download.path();
  const conteudo = await fs.readFile(caminho, 'utf8');

  expect(conteudo).toContain('<gpx version="1.1"');
  expect(conteudo.match(/<trkpt /g).length).toBeGreaterThanOrEqual(2);
});

test('“Find a better spot” procura um novo encaixe', async ({ page }) => {
  await page.locator('[data-ferramenta="forma"]').click();
  await expect(page.locator('#btn-usar-rota')).toBeEnabled({ timeout: 15_000 });

  await page.locator('#btn-melhor-local').click();

  await expect(page.locator('#forma-status')).toContainText('Melhor encaixe', {
    timeout: 20_000,
  });
  await expect(page.locator('#btn-usar-rota')).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator('#painel-forma')).toBeVisible();
});

test('busca de endereço mostra sugestões e centraliza o mapa', async ({ page }) => {
  await page.locator('#input-endereco').fill('Praça Saraiva');
  const sugestao = page.locator('.sugestao-item').first();
  await expect(sugestao).toBeVisible();
  await expect(sugestao).toContainText('Praça Saraiva');

  await sugestao.click();
  await expect(page.locator('#input-endereco')).toHaveValue('Praça Saraiva, Rio Grande');
  await expect(page.locator('#sugestoes-endereco')).toBeHidden();
});

test('troca de ferramenta atualiza aria-pressed e cursor', async ({ page }) => {
  await page.keyboard.press('3');
  await expect(page.locator('[data-ferramenta="lapis"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map')).toHaveClass(/cursor-lapis/);

  await page.keyboard.press('1');
  await expect(page.locator('[data-ferramenta="rua"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map')).not.toHaveClass(/cursor-lapis/);
});

test('barra inferior alterna perfis Cycling/Walking e o modo Shape', async ({ page }) => {
  await expect(page.locator('[data-perfil="bike"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-perfil="foot"]').click();
  await expect(page.locator('[data-perfil="foot"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-ferramenta="rua"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-ferramenta="forma"]').click();
  await expect(page.locator('#painel-forma')).toBeVisible();
  await expect(page.locator('#painel-rota')).toBeHidden();
  await expect(page.locator('[data-forma="estrela"]')).toHaveAttribute('aria-pressed', 'true');

  await expect(page.locator('#btn-usar-rota')).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator('#forma-distancia')).toContainText('km');
  await expect(page.locator('#forma-diferenca')).toBeVisible();

  await page.locator('[data-perfil="bike"]').click();
  await expect(page.locator('[data-perfil="bike"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-usar-rota')).toBeEnabled({ timeout: 15_000 });
});

test('Shape faz Auto-Fit nas ruas e “Use this route” alimenta o GPX', async ({ page }) => {
  const pedidos = [];
  page.on('request', (pedido) => {
    if (pedido.url().includes('/api/route-points')) pedidos.push(pedido.postDataJSON());
  });

  await page.locator('[data-ferramenta="forma"]').click();
  await expect(page.locator('#painel-forma')).toBeVisible();
  await expect(page.locator('#btn-usar-rota')).toBeEnabled({ timeout: 15_000 });

  expect(pedidos.length).toBeGreaterThan(0);
  expect(pedidos.at(-1).points.length).toBeGreaterThanOrEqual(6);
  expect(pedidos.at(-1).points.length).toBeLessThanOrEqual(25);
  expect(pedidos.at(-1).profile).toBe('bike');

  await page.locator('[data-forma="hexagono"]').click();
  await expect(page.locator('[data-forma="hexagono"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-usar-rota')).toBeEnabled({ timeout: 15_000 });

  await page.locator('#btn-usar-rota').click();

  await expect(page.locator('#painel-forma')).toBeHidden();
  await expect(page.locator('#painel-rota')).toBeVisible();
  await expect(page.locator('[data-ferramenta="rua"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#contador-pontos')).toHaveText('2');
  expect(Number(await page.locator('#distancia-total').textContent())).toBeGreaterThan(0);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#btn-exportar').click();
  const download = await downloadPromise;
  const conteudo = await fs.readFile(await download.path(), 'utf8');

  expect(conteudo).toContain('<gpx version="1.1"');
  expect(conteudo.match(/<trkpt /g).length).toBeGreaterThanOrEqual(2);
});
