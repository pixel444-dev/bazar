import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarApp } from './src/app.js';
import { enderecosLocais } from './src/rede.js';
import { PIN_ADMIN_INICIAL } from './src/db.js';

const raiz = path.dirname(fileURLToPath(import.meta.url));

// Uso: node server.js [--porta 3000] [--dados pasta]
function argumento(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const porta = Number(argumento('porta', process.env.PORT || 3000));
const pastaDados = path.resolve(argumento('dados', process.env.BAZAR_DADOS || path.join(raiz, 'data')));
const app = criarApp({ pastaDados, pastaPublica: path.join(raiz, 'public') });

app.servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nA porta ${porta} já está em uso. A central já está aberta em outra janela?\n`);
  } else {
    console.error(e);
  }
  process.exit(1);
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
