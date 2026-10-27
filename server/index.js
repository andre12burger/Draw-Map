'use strict';

/**
 * @file server/index.js
 * @description Ponto de entrada do processo: inicia o servidor HTTP e implementa
 * encerramento gracioso em SIGINT/SIGTERM.
 */

const config = require('./config');
const criarApp = require('./app');

const servidor = criarApp().listen(config.porta, () => {
  console.log(`Servidor Web rodando em http://localhost:${config.porta} (${config.ambiente})`);
});

servidor.on('error', (erro) => {
  if (erro.code === 'EADDRINUSE') {
    console.error(`A porta ${config.porta} já está em uso. Defina PORT com outro valor.`);
  } else {
    console.error('Falha ao iniciar o servidor:', erro);
  }
  process.exitCode = 1;
});

let encerrando = false;

function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  console.log(`\n${sinal} recebido; encerrando o servidor...`);

  const temporizador = setTimeout(() => {
    console.error('Encerramento forçado após 10 s.');
    process.exit(1);
  }, 10_000);
  temporizador.unref();

  servidor.close((erro) => {
    clearTimeout(temporizador);
    if (erro) {
      console.error('Erro ao encerrar o servidor:', erro);
      process.exitCode = 1;
    }
    process.exit();
  });
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
