/**
 * @file main.js
 * @description Ponto de entrada do frontend. Inicializa estado, mapa, handlers,
 * ferramentas de UI e atalhos globais na ordem correta.
 */

import { getCampo, inicializarEstado, inscrever } from './core/state.js';
import { getMap } from './map/map.js';
import { atualizarEstilos, configurarHandlers, redesenhar } from './map/render.js';
import {
  adicionarPonto,
  aoArrastarPonto,
  aoInserirPonto,
  desfazer,
  estaOcupado,
  limparTudo,
} from './map/draw.js';
import { inicializarPencil } from './map/pencil.js';
import { criarForma, inicializarFormas } from './map/shapes.js';
import {
  definirOpacidade,
  inicializarImagemReferencia,
  mostrarImagem,
  removerImagem,
} from './map/image-overlay.js';
import { inicializarPreview } from './map/preview.js';
import { inicializarToolbar } from './ui/toolbar.js';
import { inicializarBusca } from './ui/search.js';
import { inicializarExportacao } from './export/gpx.js';
import { inscreverContadorRequisicoes } from './services/api.js';
import { atualizarContadorApi } from './ui/stats.js';
import { configurarTratamentoGlobal, mostrarToast } from './ui/toast.js';
import { ehCampoEditavel } from './core/utils.js';

configurarTratamentoGlobal();

const estadoInicial = inicializarEstado();
const mapa = getMap();

configurarHandlers({
  arrastarPonto: aoArrastarPonto,
  inserirPonto: aoInserirPonto,
});

// O observer redesenha sempre que o estado muda (clique, drag, undo, clear).
inscrever((estado) => redesenhar(estado));

mapa.on('zoomend', atualizarEstilos);

mapa.on('click', async (evento) => {
  if (getCampo('ferramentaAtiva') === 'lapis') return;

  if (estaOcupado()) {
    mostrarToast('Aguarde o cálculo anterior terminar.', { tipo: 'aviso', duracao: 2000 });
    return;
  }

  const modoLivre =
    Boolean(evento.originalEvent?.shiftKey) || getCampo('ferramentaAtiva') === 'livre';

  await adicionarPonto(evento.latlng, modoLivre);
});

document.getElementById('btn-limpar')?.addEventListener('click', () => {
  if (limparTudo()) {
    mostrarToast('Desenho apagado. Use Ctrl+Z para desfazer.', { tipo: 'info' });
  } else if (!estaOcupado()) {
    mostrarToast('Não há nada para apagar.', { tipo: 'aviso', duracao: 2000 });
  }
});

window.addEventListener('keydown', (evento) => {
  const ctrlZ = (evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'z';
  if (!ctrlZ) return;
  if (ehCampoEditavel(evento.target)) return;

  evento.preventDefault();

  if (estaOcupado()) {
    mostrarToast('Aguarde o cálculo atual antes de desfazer.', { tipo: 'aviso' });
    return;
  }

  const restaurado = desfazer();
  if (restaurado) {
    mostrarToast('Último passo desfeito.', { tipo: 'sucesso', duracao: 2000 });
  } else {
    mostrarToast('Nada para desfazer.', { tipo: 'aviso', duracao: 2000 });
  }
});

inicializarToolbar();
inicializarBusca();
inicializarPencil();
inicializarPreview();
inicializarExportacao();
inicializarFormas();
inicializarImagemReferencia();

// --- Formas geométricas e imagem de referência -------------------------------

let urlImagemReferencia = null;

const controloOpacidade = document.getElementById('controlo-opacidade');
const inputOpacidade = document.getElementById('input-opacidade');
const inputImagem = document.getElementById('input-imagem');

document.getElementById('btn-forma')?.addEventListener('click', () => {
  const centro = mapa.getCenter();
  const forma = criarForma({
    shape: 'estrela',
    center: { lat: centro.lat, lng: centro.lng },
    size: 2000,
    interativa: true,
    callbacks: {
      onTransformEnd: () => {
        mostrarToast('Forma atualizada.', { tipo: 'info', duracao: 1500 });
      },
    },
  });

  if (forma) {
    mostrarToast('Forma inserida. Arraste as alças para transformar.', {
      tipo: 'info',
      duracao: 3000,
    });
  }
});

document.getElementById('btn-imagem')?.addEventListener('click', () => inputImagem?.click());

inputImagem?.addEventListener('change', () => {
  const arquivo = inputImagem.files?.[0];
  if (!arquivo) return;

  if (urlImagemReferencia) URL.revokeObjectURL(urlImagemReferencia);
  urlImagemReferencia = URL.createObjectURL(arquivo);

  const centro = mapa.getCenter();
  const opacidade = Number(inputOpacidade?.value ?? 50) / 100;

  void mostrarImagem({
    url: urlImagemReferencia,
    center: { lat: centro.lat, lng: centro.lng },
    size: 2000,
    opacity: opacidade,
    callbacks: {
      onTransformEnd: () => mostrarToast('Imagem ajustada.', { tipo: 'info', duracao: 1500 }),
    },
  }).then((imagem) => {
    if (!imagem) {
      mostrarToast('Não foi possível carregar a imagem.', { tipo: 'erro' });
      return;
    }
    if (controloOpacidade) controloOpacidade.hidden = false;
    mostrarToast('Imagem de referência carregada.', { tipo: 'sucesso', duracao: 2000 });
  });

  inputImagem.value = '';
});

inputOpacidade?.addEventListener('input', () => {
  definirOpacidade(Number(inputOpacidade.value) / 100);
});

document.getElementById('btn-remover-imagem')?.addEventListener('click', () => {
  if (!removerImagem()) return;
  if (urlImagemReferencia) {
    URL.revokeObjectURL(urlImagemReferencia);
    urlImagemReferencia = null;
  }
  if (controloOpacidade) controloOpacidade.hidden = true;
  mostrarToast('Imagem de referência removida.', { tipo: 'info', duracao: 1500 });
});

inscreverContadorRequisicoes(atualizarContadorApi);

if (estadoInicial.coordenadasNiveis.length > 0) {
  mostrarToast('Progresso anterior restaurado.', { tipo: 'info', duracao: 2500 });
}
