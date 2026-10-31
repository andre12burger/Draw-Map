/**
 * @file ui/shape-panel.js
 * @description Painel contextual da ferramenta Shape: seleção de forma,
 * distância alvo, distância da rota encaixada nas ruas e ações
 * (`Find a better spot`, `Use this route`, `Remove shape`).
 *
 * Este módulo é apenas DOM: não conhece o motor de rotas nem o estado global.
 * O coordenador (`map/shape-studio.js`) injeta os handlers via
 * `inicializarPainelForma` e publica o resultado com `atualizarPainelForma`.
 */

export const FORMAS_PAINEL = Object.freeze({
  triangulo: 'Triângulo',
  estrela: 'Estrela',
  hexagono: 'Hexágono',
});

const formatador = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const handlers = {
  onSelecionarForma: () => {},
  onAlvoChange: () => {},
  onMelhorLocal: () => {},
  onUsarRota: () => {},
  onRemover: () => {},
  onFechar: () => {},
};

let inicializado = false;
let alvoAtual = 2;

function elemento(id) {
  return document.getElementById(id);
}

/**
 * Formata uma distância em km para exibição pt-BR.
 * @param {number|null|undefined} km
 * @returns {string}
 */
export function formatarKm(km) {
  const numero = Number(km);
  return Number.isFinite(numero) ? formatador.format(numero) : '—';
}

/**
 * Liga os eventos do painel aos handlers do coordenador.
 * @param {Object} [novos]
 * @param {(nome:string)=>void} [novos.onSelecionarForma]
 * @param {(alvoKm:number)=>void} [novos.onAlvoChange]
 * @param {()=>void} [novos.onMelhorLocal]
 * @param {()=>void} [novos.onUsarRota]
 * @param {()=>void} [novos.onRemover]
 * @param {()=>void} [novos.onFechar]
 */
export function inicializarPainelForma(novos = {}) {
  Object.assign(handlers, novos);
  if (inicializado) return;
  inicializado = true;

  document.querySelectorAll('[data-forma]').forEach((botao) => {
    botao.addEventListener('click', () => handlers.onSelecionarForma(botao.dataset.forma));
  });

  elemento('input-alvo')?.addEventListener('change', (evento) => {
    const valor = Number(evento.target.value);
    if (!Number.isFinite(valor)) return;
    handlers.onAlvoChange(valor);
  });

  elemento('btn-melhor-local')?.addEventListener('click', () => handlers.onMelhorLocal());
  elemento('btn-usar-rota')?.addEventListener('click', () => handlers.onUsarRota());
  elemento('btn-remover-forma')?.addEventListener('click', () => handlers.onRemover());
  elemento('btn-fechar-forma')?.addEventListener('click', () => handlers.onFechar());
}

/**
 * Alterna entre o painel da rota e o painel da forma.
 * @param {boolean} visivel
 */
export function mostrarPainelForma(visivel) {
  const painelForma = elemento('painel-forma');
  const painelRota = elemento('painel-rota');

  if (painelForma) painelForma.hidden = !visivel;
  if (painelRota) painelRota.hidden = Boolean(visivel);
  document.body.classList.toggle('modo-forma', Boolean(visivel));
}

/**
 * @param {string} nome
 */
export function destacarFormaSelecionada(nome) {
  document.querySelectorAll('[data-forma]').forEach((botao) => {
    const ativo = botao.dataset.forma === nome;
    botao.classList.toggle('ativo', ativo);
    botao.setAttribute('aria-pressed', String(ativo));
  });
}

/**
 * @param {number} valor km
 */
export function definirAlvoKm(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return;
  alvoAtual = numero;

  const input = elemento('input-alvo');
  if (input && document.activeElement !== input) input.value = numero.toFixed(1);
}

/**
 * @returns {number} distância alvo atual em km
 */
export function obterAlvoKm() {
  return alvoAtual;
}

/**
 * Atualiza os textos/estados do painel da forma.
 * @param {{resumo?:string, alvoKm?:number, distanciaKm?:number|null, status?:string, podeUsar?:boolean, calculando?:boolean}} dados
 */
export function atualizarPainelForma({
  resumo,
  alvoKm,
  distanciaKm,
  status,
  podeUsar = false,
  calculando = false,
} = {}) {
  if (typeof resumo === 'string') {
    const alvoResumo = elemento('forma-resumo');
    if (alvoResumo) alvoResumo.textContent = resumo;
  }

  if (Number.isFinite(Number(alvoKm))) definirAlvoKm(Number(alvoKm));

  const distancia = Number(distanciaKm);
  const temDistancia = Number.isFinite(distancia) && distancia >= 0;
  const alvo = Number(alvoKm ?? alvoAtual);

  const campoDistancia = elemento('forma-distancia');
  if (campoDistancia)
    campoDistancia.textContent = temDistancia ? `${formatarKm(distancia)} km` : '—';

  const campoDiferenca = elemento('forma-diferenca');
  if (campoDiferenca) {
    if (temDistancia && Number.isFinite(alvo) && alvo > 0) {
      const diferenca = distancia - alvo;
      const sinal = diferenca > 0 ? '+' : '';
      campoDiferenca.textContent = `${sinal}${formatarKm(diferenca)} km`;
      campoDiferenca.dataset.tendencia =
        diferenca > 0.05 ? 'acima' : diferenca < -0.05 ? 'abaixo' : 'alvo';
    } else {
      campoDiferenca.textContent = '—';
      delete campoDiferenca.dataset.tendencia;
    }
  }

  if (typeof status === 'string') {
    const campoStatus = elemento('forma-status');
    if (campoStatus) campoStatus.textContent = status;
  }

  const painel = elemento('painel-forma');
  if (painel) {
    painel.classList.toggle('calculando', Boolean(calculando));
    painel.dataset.estado = calculando ? 'calculando' : podeUsar ? 'pronto' : 'incompleto';
  }

  const botaoUsar = elemento('btn-usar-rota');
  if (botaoUsar) botaoUsar.disabled = !podeUsar || Boolean(calculando);

  const botaoMelhor = elemento('btn-melhor-local');
  if (botaoMelhor) botaoMelhor.disabled = Boolean(calculando);
}
