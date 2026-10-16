import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enderecosLocais } from './src/rede.js';

const raiz = path.dirname(fileURLToPath(import.meta.url));

// Código de saída para problemas que ligar de novo não resolve (porta ocupada, Node antigo,
// banco que não abre): o iniciar.bat só religa a central sozinho quando o código é 1.
const SAIDA_SEM_RELIGAR = 2;

// O banco usa o node:sqlite, que não existe em versões antigas do Node. Confere antes de
// carregar o resto, senão aparece só um erro técnico.
const [maior, menor] = process.versions.node.split('.').map(Number);
if (maior < 22 || (maior === 22 && menor < 13)) {
  console.error(`\nEste sistema precisa do Node.js 22.13 ou mais novo, e este computador tem o ${process.version}.`);
  console.error('Instale a versão LTS de https://nodejs.org e abra de novo.\n');
  process.exit(SAIDA_SEM_RELIGAR);
}
const { criarApp } = await import('./src/app.js');
const { PIN_ADMIN_INICIAL } = await import('./src/db.js');

// Uso: node server.js [--porta 3000] [--dados pasta]
function argumento(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const porta = Number(argumento('porta', process.env.PORT || 3000));
const pastaDados = path.resolve(argumento('dados', process.env.BAZAR_DADOS || path.join(raiz, 'data')));
// O iniciar.bat só passa --abrir-navegador na primeira vez, para não abrir uma aba nova cada vez
// que a central religa sozinha depois de um erro.
const abrirNavegador = process.argv.includes('--abrir-navegador');

// Abre o endereço no navegador padrão do Windows. Se não der, a central segue ligada do mesmo jeito.
function abrirNoNavegador(url) {
  try {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
  } catch { /* o endereço continua na janela */ }
}

// Erros graves também vão para data\erros.log, para dar para ver depois do bazar o que aconteceu.
function registrarErroGrave(titulo, e) {
  const texto = `[${new Date().toLocaleString('pt-BR')}] ${titulo}: ${e?.stack ?? e}\n`;
  console.error(`\n${texto}`);
  try {
    fs.appendFileSync(path.join(pastaDados, 'erros.log'), texto);
  } catch { /* sem como registrar */ }
}

let app;
try {
  app = criarApp({ pastaDados, pastaPublica: path.join(raiz, 'public') });
} catch (e) {
  registrarErroGrave('Não consegui abrir o banco de dados', e);
  console.error(`Confira a pasta ${pastaDados}. Se o arquivo bazar.db estiver danificado, restaure um backup (veja o README).\n`);
  process.exit(SAIDA_SEM_RELIGAR);
}

// Tudo o que importa está no banco, então ligar de novo é seguro: o iniciar.bat religa a central
// e os celulares se reconectam sozinhos.
for (const evento of ['uncaughtException', 'unhandledRejection']) {
  process.on(evento, (e) => {
    registrarErroGrave('Erro inesperado, a central vai reiniciar', e);
    process.exit(1);
  });
}

app.servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nA porta ${porta} já está em uso. A central já está aberta em outra janela?\n`);
  } else {
    console.error(e);
  }
  process.exit(SAIDA_SEM_RELIGAR);
});

app.servidor.listen(porta, '0.0.0.0', () => {
  const linha = '='.repeat(64);
  const enderecos = enderecosLocais(porta);
  console.log(`\n${linha}`);
  console.log('  CENTRAL DO BAZAR LIGADA');
  console.log(linha);
  console.log(`  Neste notebook:  http://localhost:${porta}`);
  if (enderecos.length) {
    console.log('  Celulares e caixas (no mesmo Wi-Fi):');
    for (const e of enderecos) console.log(`     ${e}`);
  } else {
    console.log('  ATENÇÃO: o notebook não está conectado a nenhuma rede.');
    console.log('  Conecte no Wi-Fi do roteador do bazar para os celulares acessarem.');
  }
  console.log(`  Dados em: ${pastaDados}`);
  console.log(`  Primeiro acesso: usuário "Admin", PIN ${PIN_ADMIN_INICIAL} (troque depois!)`);
  console.log('');
  console.log('  NÃO FECHE ESTA JANELA durante o bazar.');
  console.log(`${linha}\n`);
  if (abrirNavegador) abrirNoNavegador(`http://localhost:${porta}`);
});

let encerrando = false;
async function encerrar() {
  if (encerrando) return;
  encerrando = true;
  console.log('\nEncerrando: fazendo backup final...');
  try {
    await app.fechar({ comBackup: true });
    console.log('Backup feito. Até logo!');
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
process.on('SIGHUP', encerrar);
