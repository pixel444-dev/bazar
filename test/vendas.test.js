import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarApp } from '../src/app.js';

let app;
let base;
let pasta;

before(async () => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'bazar-teste-'));
  app = criarApp({ pastaDados: pasta, pastaPublica: path.resolve('public'), timers: false });
  await new Promise((resolve) => app.servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.servidor.address().port}`;
});

after(async () => {
  await app.fechar();
  fs.rmSync(pasta, { recursive: true, force: true });
});

function cliente() {
  let cookie = '';
  // `bruto` ({ tipo, dados }) manda o corpo como está, para fotos e corpos malformados.
  async function req(metodo, url, corpo, bruto) {
    const headers = {};
    if (bruto) headers['Content-Type'] = bruto.tipo;
    else if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const body = bruto ? bruto.dados : corpo === undefined ? undefined : JSON.stringify(corpo);
    const r = await fetch(base + url, { method: metodo, headers, body });
    const setCookie = r.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const json = (r.headers.get('content-type') ?? '').includes('json');
    return { status: r.status, dados: json ? await r.json() : await r.text() };
  }
  async function login(nome, pin) {
    const { dados } = await req('GET', '/api/login/usuarios');
    const u = dados.usuarios.find((x) => x.nome === nome);
    assert.ok(u, `usuário ${nome} existe`);
    const r = await req('POST', '/api/login', { usuario_id: u.id, pin });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
  }
  return { req, login };
}

const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  return r.dados;
};

const dadosCliente = (cidadeId) => ({
  cliente_nome: 'Maria Souza', telefone: '(19) 98765-4321', cidade_id: cidadeId,
  bairro: 'Centro', rua: 'Rua das Flores', numero: '120', complemento: 'casa 2',
});

const admin = cliente();
const ana = cliente();
const beto = cliente();
const carla = cliente();
let cidadeId;

test('preparação: admin cadastra cidades, etiquetas, móveis e equipe', async () => {
  await admin.login('Admin', '1234');
  cidadeId = ok(await admin.req('POST', '/api/admin/cidades', { nome: 'Campinas' })).id;
  assert.equal((await admin.req('POST', '/api/admin/cidades', { nome: 'campinas' })).status, 409, 'cidade duplicada');

  assert.deepEqual(ok(await admin.req('POST', '/api/admin/etiquetas', { quantidade: 6 })), { de: 1, ate: 6 });
  const { tipos } = ok(await admin.req('GET', '/api/config'));
  const cama = tipos.find((t) => t.nome === 'Cama').id;
  const sofa = tipos.find((t) => t.nome === 'Sofá').id;

  const lote = ok(await admin.req('POST', '/api/admin/moveis/lote', { de: 1, ate: 3, tipo_id: cama, preco_centavos: 15000 }));
  assert.equal(lote.atualizados, 3);
  const m4 = ok(await admin.req('PUT', '/api/admin/moveis/4', { tipo_id: sofa, preco_centavos: 30000, descricao: 'retrátil' }));
  assert.equal(m4.status, 'disponivel');
  ok(await admin.req('PUT', '/api/admin/moveis/2', { preco_centavos: 18000 }));

  ok(await admin.req('POST', '/api/admin/usuarios', { nome: 'Ana', pin: '1111', papel: 'vendedor' }));
  ok(await admin.req('POST', '/api/admin/usuarios', { nome: 'Beto', pin: '2222', papel: 'vendedor' }));
  ok(await admin.req('POST', '/api/admin/usuarios', { nome: 'Carla', pin: '3333', papel: 'caixa' }));
  assert.equal((await admin.req('POST', '/api/admin/usuarios', { nome: 'X', pin: '12', papel: 'vendedor' })).status, 400);

  await ana.login('Ana', '1111');
  await beto.login('Beto', '2222');
  await carla.login('Carla', '3333');
});

test('PIN errado não entra', async () => {
  const intruso = cliente();
  const { dados } = await intruso.req('GET', '/api/login/usuarios');
  const r = await intruso.req('POST', '/api/login', { usuario_id: dados.usuarios[0].id, pin: '0000' });
  assert.equal(r.status, 400);
  assert.equal((await intruso.req('GET', '/api/eu')).status, 401);
});

test('dois vendedores tentando o mesmo móvel ao mesmo tempo: só um consegue', async () => {
  for (let rodada = 0; rodada < 20; rodada++) {
    const [a, b] = await Promise.all([
      ana.req('POST', '/api/rascunho/itens', { codigo: 1 }),
      beto.req('POST', '/api/rascunho/itens', { codigo: 1 }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const perdedor = a.status === 409 ? a : b;
    assert.match(perdedor.dados.erro, /já está reservado por (Ana|Beto)/);
    // devolve para a próxima rodada
    const vencedor = a.status === 200 ? { c: ana, p: a.dados } : { c: beto, p: b.dados };
    ok(await vencedor.c.req('DELETE', `/api/pedidos/${vencedor.p.id}/itens/1`));
  }
});

test('não reserva móvel sem cadastro nem inexistente', async () => {
  const semCadastro = await ana.req('POST', '/api/rascunho/itens', { codigo: 5 });
  assert.equal(semCadastro.status, 409);
  assert.match(semCadastro.dados.erro, /não tem tipo e preço/);
  assert.equal((await ana.req('POST', '/api/rascunho/itens', { codigo: 999 })).status, 404);
});

let pedidoAna;

test('vendedor monta a venda, finaliza e o caixa recebe dividido', async () => {
  ok(await ana.req('POST', '/api/rascunho/itens', { codigo: 1 }));
  const r = ok(await ana.req('POST', '/api/rascunho/itens', { codigo: 4 }));
  assert.equal(r.total_centavos, 45000);
  assert.equal((await ana.req('POST', '/api/rascunho/itens', { codigo: 4 })).status, 409, 'mesmo item duas vezes');

  const incompleto = await ana.req('POST', '/api/rascunho/finalizar', { cliente_nome: 'Maria' });
  assert.equal(incompleto.status, 400);
  assert.match(incompleto.dados.erro, /telefone/);

  pedidoAna = ok(await ana.req('POST', '/api/rascunho/finalizar', dadosCliente(cidadeId)));
  assert.equal(pedidoAna.status, 'aguardando');
  assert.equal(pedidoAna.telefone, '19987654321');
  assert.equal(ok(await ana.req('GET', '/api/rascunho')), null);

  // vendedor não acessa a lista do caixa nem mexe no pedido de outro
  assert.equal((await ana.req('GET', '/api/pedidos')).status, 403);
  assert.equal((await beto.req('DELETE', `/api/pedidos/${pedidoAna.id}/itens/1`)).status, 403);
  assert.equal((await beto.req('GET', `/api/pedidos/${pedidoAna.id}`)).status, 403);

  const lista = ok(await carla.req('GET', '/api/pedidos?status=aguardando'));
  assert.ok(lista.some((p) => p.id === pedidoAna.id));
  assert.equal(ok(await carla.req('GET', `/api/pedidos?busca=${pedidoAna.id}`))[0].id, pedidoAna.id);

  const errado = await carla.req('POST', `/api/pedidos/${pedidoAna.id}/pagar`, { pagamentos: [{ forma: 'dinheiro', valor_centavos: 10000 }] });
  assert.equal(errado.status, 400);
  assert.match(errado.dados.erro, /não bate/);

  const pago = ok(await carla.req('POST', `/api/pedidos/${pedidoAna.id}/pagar`, {
    pagamentos: [{ forma: 'dinheiro', valor_centavos: 15000 }, { forma: 'pix', valor_centavos: 30000 }],
    troco_centavos: 5000,
  }));
  assert.equal(pago.status, 'pago');
  assert.equal(pago.caixa_nome, 'Carla');

  const m1 = ok(await beto.req('GET', '/api/moveis/1'));
  assert.equal(m1.status, 'vendido');
  const tentativa = await beto.req('POST', '/api/rascunho/itens', { codigo: 1 });
  assert.equal(tentativa.status, 409);
  assert.match(tentativa.dados.erro, /já foi vendido/);

  assert.equal((await carla.req('POST', `/api/pedidos/${pedidoAna.id}/pagar`, { pagamentos: [{ forma: 'pix', valor_centavos: 45000 }] })).status, 409, 'não paga duas vezes');
  assert.equal((await admin.req('PUT', '/api/admin/moveis/1', { preco_centavos: 100 })).status, 409, 'não muda preço de vendido');
});

test('reserva expirada libera o móvel e o caixa pode reativar se ainda estiver livre', async () => {
  ok(await beto.req('POST', '/api/rascunho/itens', { codigo: 2 }));
  ok(await beto.req('POST', '/api/rascunho/itens', { codigo: 3 }));
  const p = ok(await beto.req('POST', '/api/rascunho/finalizar', dadosCliente(cidadeId)));

  app.db.prepare('UPDATE pedidos SET expira_em = 0 WHERE id = ?').run(p.id);
  assert.equal(ok(await carla.req('GET', `/api/pedidos/${p.id}`)).status, 'expirado');
  assert.equal(ok(await ana.req('GET', '/api/moveis/2')).status, 'disponivel');

  const pagarExpirado = await carla.req('POST', `/api/pedidos/${p.id}/pagar`, { pagamentos: [{ forma: 'pix', valor_centavos: 33000 }] });
  assert.equal(pagarExpirado.status, 409);

  // Ana pega o 2 enquanto isso; na reativação, só o 3 volta
  ok(await ana.req('POST', '/api/rascunho/itens', { codigo: 2 }));
  const reativado = ok(await carla.req('POST', `/api/pedidos/${p.id}/reativar`));
  assert.deepEqual(reativado.perdidos, [2]);
  assert.equal(reativado.pedido.status, 'aguardando');
  assert.equal(reativado.pedido.total_centavos, 15000);

  ok(await carla.req('POST', `/api/pedidos/${p.id}/pagar`, { pagamentos: [{ forma: 'cartao', valor_centavos: 15000 }] }));
  ok(await ana.req('POST', '/api/rascunho/descartar'));
  assert.equal(ok(await ana.req('GET', '/api/moveis/2')).status, 'disponivel');
});

test('relatórios: fechamento de caixa, romaneio e planilha', async () => {
  const r = ok(await carla.req('GET', '/api/relatorios/resumo'));
  assert.equal(r.formas.dinheiro, 15000);
  assert.equal(r.formas.pix, 30000);
  assert.equal(r.formas.cartao, 15000);
  assert.equal(r.formas.total, 60000);
  assert.equal(r.caixas[0].nome, 'Carla');
  assert.equal(r.caixas[0].troco, 5000);
  assert.equal(r.moveis.vendido, 3);
  // 3 camas (150 + 180 + 150) e um sofá (300); as etiquetas 5 e 6 ainda não têm preço.
  assert.equal(r.previsao.total, 78000);
  assert.equal(r.previsao.vendido, 60000);
  assert.equal(r.previsao.disponivel + r.previsao.reservado, 18000);
  assert.equal(r.previsao.sem_preco, 2);
  assert.equal(r.tipos.find((t) => t.nome === 'Cama').valor_total, 48000);

  assert.equal((await carla.req('GET', '/api/relatorios/final')).status, 403);
  const final = ok(await admin.req('GET', '/api/relatorios/final'));
  assert.equal(final.pedidos.reduce((s, p) => s + p.total_centavos, 0), 60000);
  assert.equal(final.nao_vendidos.reduce((s, m) => s + m.preco_centavos, 0), 18000);
  assert.deepEqual(final.sem_cadastro, [5, 6]);
  assert.equal(final.resumo.tipos.reduce((s, t) => s + t.valor_vendido, 0), 60000);

  assert.equal((await carla.req('GET', '/api/relatorios/romaneio')).status, 403);
  const romaneio = ok(await admin.req('GET', '/api/relatorios/romaneio'));
  assert.equal(romaneio.length, 2);
  ok(await admin.req('POST', `/api/pedidos/${romaneio[0].id}/entrega`, { entregue: true }));
  assert.equal(ok(await admin.req('GET', '/api/relatorios/romaneio')).length, 1);

  const csv = await admin.req('GET', '/api/relatorios/vendas.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.dados, /Campinas/);
  assert.match(csv.dados, /Dinheiro 150,00 \+ Pix 300,00/);
});

test('ranking dos vendedores: só venda paga, todo vendedor aparece, caixa sem venda não', async () => {
  const lista = ok(await beto.req('GET', '/api/ranking'));
  assert.deepEqual(lista.map((v) => v.nome).sort(), ['Ana', 'Beto']);
  assert.equal(lista.reduce((s, v) => s + v.total, 0), 60000);
  assert.deepEqual(lista.map((v) => v.posicao), [1, 2]);
  assert.ok(lista[0].total > lista[1].total);
  const ana = lista.find((v) => v.nome === 'Ana');
  assert.ok(ana.pedidos >= 1 && ana.itens >= 2);
});

test('cancelar pedido pago devolve o móvel (só admin)', async () => {
  assert.equal((await carla.req('POST', `/api/pedidos/${pedidoAna.id}/cancelar`)).status, 403);
  ok(await admin.req('POST', `/api/pedidos/${pedidoAna.id}/cancelar`));
  assert.equal(ok(await ana.req('GET', '/api/moveis/4')).status, 'disponivel');
  const r = ok(await admin.req('GET', '/api/relatorios/resumo'));
  assert.equal(r.formas.total, 15000, 'pagamentos do pedido cancelado saem do fechamento');
});

test('backup gera arquivo de banco', async () => {
  const b = ok(await admin.req('POST', '/api/admin/backup'));
  assert.ok(fs.existsSync(b.arquivo));
});

test('pagamento na entrega: sai do romaneio para o entregador cobrar e não entra na gaveta', async () => {
  ok(await beto.req('POST', '/api/rascunho/itens', { codigo: 2 }));
  const p = ok(await beto.req('POST', '/api/rascunho/finalizar', dadosCliente(cidadeId)));
  const antes = ok(await admin.req('GET', '/api/relatorios/resumo'));

  const comTroco = await carla.req('POST', `/api/pedidos/${p.id}/pagar`, {
    pagamentos: [{ forma: 'entrega', valor_centavos: p.total_centavos }], troco_centavos: 1000,
  });
  assert.equal(comTroco.status, 400, 'troco só sai da parte em dinheiro');

  const pago = ok(await carla.req('POST', `/api/pedidos/${p.id}/pagar`, {
    pagamentos: [{ forma: 'pix', valor_centavos: 5000 }, { forma: 'entrega', valor_centavos: p.total_centavos - 5000 }],
  }));
  assert.equal(pago.status, 'pago');
  const aCobrar = p.total_centavos - 5000;

  const r = ok(await admin.req('GET', '/api/relatorios/resumo'));
  assert.equal(r.formas.entrega, aCobrar);
  assert.equal(r.formas.dinheiro, antes.formas.dinheiro, 'não entra no dinheiro da gaveta');
  assert.equal(r.formas.total, antes.formas.total + p.total_centavos);
  assert.equal(r.caixas.find((c) => c.nome === 'Carla').entrega, aCobrar);
  assert.equal(r.entregas.a_receber, aCobrar);
  assert.equal(r.entregas.recebido_na_entrega, 0);

  const noRomaneio = ok(await admin.req('GET', '/api/relatorios/romaneio')).find((x) => x.id === p.id);
  assert.deepEqual(noRomaneio.pagamentos.find((x) => x.forma === 'entrega'), { forma: 'entrega', valor_centavos: aCobrar });

  ok(await admin.req('POST', `/api/pedidos/${p.id}/entrega`, { entregue: true }));
  const depois = ok(await admin.req('GET', '/api/relatorios/resumo'));
  assert.equal(depois.entregas.a_receber, 0);
  assert.equal(depois.entregas.recebido_na_entrega, aCobrar);

  const csv = await admin.req('GET', '/api/relatorios/vendas.csv');
  assert.ok(csv.dados.includes(`Pix 50,00 + Na entrega ${(aCobrar / 100).toFixed(2).replace('.', ',')}`));
});

test('banco antigo ganha a forma de pagamento na entrega sem perder pagamentos', async () => {
  const { abrirBanco } = await import('../src/db.js');
  const arquivo = path.join(pasta, 'antigo.db');
  let db = abrirBanco(arquivo);
  db.exec(`DROP TABLE pagamentos;
    CREATE TABLE pagamentos (
      id INTEGER PRIMARY KEY,
      pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
      forma TEXT NOT NULL CHECK (forma IN ('dinheiro', 'pix', 'cartao')),
      valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
      caixa_id INTEGER NOT NULL REFERENCES usuarios(id),
      criado_em INTEGER NOT NULL
    );
    INSERT INTO pedidos (id, vendedor_id, status, criado_em) VALUES (1, 1, 'pago', 0);
    INSERT INTO pagamentos (pedido_id, forma, valor_centavos, caixa_id, criado_em) VALUES (1, 'pix', 900, 1, 0);`);
  assert.throws(() => db.exec(`INSERT INTO pagamentos (pedido_id, forma, valor_centavos, caixa_id, criado_em) VALUES (1, 'entrega', 100, 1, 0)`));
  db.close();

  db = abrirBanco(arquivo);
  db.exec(`INSERT INTO pagamentos (pedido_id, forma, valor_centavos, caixa_id, criado_em) VALUES (1, 'entrega', 100, 1, 0)`);
  assert.deepEqual(db.prepare('SELECT forma, valor_centavos FROM pagamentos ORDER BY id').all().map((x) => ({ ...x })),
    [{ forma: 'pix', valor_centavos: 900 }, { forma: 'entrega', valor_centavos: 100 }]);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_pagamentos_pedido'").get());
  db.close();
});

test('troco gigante digitado por engano é recusado e o fechamento continua abrindo', async () => {
  ok(await beto.req('POST', '/api/rascunho/itens', { codigo: 4 }));
  const p = ok(await beto.req('POST', '/api/rascunho/finalizar', dadosCliente(cidadeId)));
  // O SQLite aceita gravar 10^17, mas não devolve mais o valor: pedido e fechamento quebrariam de vez.
  const r = await carla.req('POST', `/api/pedidos/${p.id}/pagar`, {
    pagamentos: [{ forma: 'dinheiro', valor_centavos: p.total_centavos }], troco_centavos: 1e17,
  });
  assert.equal(r.status, 400);
  assert.match(r.dados.erro, /Troco inválido/);
  assert.equal((await carla.req('POST', `/api/pedidos/${p.id}/pagar`, { pagamentos: [null] })).status, 400);
  ok(await carla.req('GET', '/api/relatorios/resumo'));
  assert.equal(ok(await carla.req('GET', `/api/pedidos/${p.id}`)).status, 'aguardando');
  ok(await carla.req('POST', `/api/pedidos/${p.id}/cancelar`));
});

test('números de etiqueta enormes são recusados em vez de travar a central', async () => {
  const tipo = ok(await admin.req('GET', '/api/config')).tipos[0].id;
  // Acima de 2^53, `codigo++` não muda o número e o cadastro em lote nunca terminaria.
  const lote = await admin.req('POST', '/api/admin/moveis/lote', { de: 1e16, ate: 1e16, tipo_id: tipo, preco_centavos: 100 });
  assert.equal(lote.status, 400);
  app.db.prepare('INSERT INTO moveis (codigo, atualizado_em) VALUES (99990, 0)').run();
  const etiquetas = await admin.req('POST', '/api/admin/etiquetas', { quantidade: 20 });
  assert.equal(etiquetas.status, 400);
  assert.match(etiquetas.dados.erro, /mais 9/);
  app.db.prepare('DELETE FROM moveis WHERE codigo = 99990').run();
});

test('corpo, endereço e arquivos com problema viram mensagem, não "Erro interno" nem espera eterna', async () => {
  const nulo = await cliente().req('POST', '/api/login', null);
  assert.equal(nulo.status, 400);
  assert.equal(nulo.dados.erro, 'PIN incorreto.');
  assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);

  const png = { tipo: 'image/png', dados: Buffer.from('89504e470d0a1a0a', 'hex') };
  const { id } = ok(await carla.req('POST', `/api/pedidos/${pedidoAna.id}/comprovantes`, undefined, png));
  for (const f of fs.readdirSync(path.join(pasta, 'comprovantes'))) fs.rmSync(path.join(pasta, 'comprovantes', f));
  const sumiu = await carla.req('GET', `/api/comprovantes/${id}`);
  assert.equal(sumiu.status, 404);

  const grande = { tipo: 'image/jpeg', dados: Buffer.alloc(13 * 1024 * 1024) };
  const r = await carla.req('POST', `/api/pedidos/${pedidoAna.id}/comprovantes`, undefined, grande);
  assert.equal(r.status, 413);
  assert.equal(r.dados.erro, 'Arquivo grande demais.');
});

test('banco ocupado por outro programa: espera liberar em vez de falhar', async () => {
  // Outro processo (antivírus, cópia do arquivo) segura o banco por 0,8 s.
  const outro = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(path.join(pasta, 'bazar.db'))});
    db.exec('BEGIN IMMEDIATE');
    console.log('segurando');
    setTimeout(() => { db.exec('ROLLBACK'); db.close(); }, 800);`]);
  const saiu = new Promise((resolve) => outro.on('exit', resolve));
  await new Promise((resolve) => outro.stdout.once('data', resolve));
  ok(await admin.req('POST', '/api/admin/cidades', { nome: 'Sumaré' }));
  await saiu;
});

test('transação que sobrou aberta não trava as próximas', async () => {
  const { abrirBanco, transacao } = await import('../src/db.js');
  const db = abrirBanco(':memory:');
  db.exec('BEGIN');
  assert.equal(transacao(db, () => 42), 42);
  assert.throws(() => transacao(db, () => { throw new Error('falhou de propósito'); }), /falhou de propósito/);
  assert.equal(transacao(db, () => 7), 7);
  db.close();
});

// Fica por último: bloqueia novos logins deste endereço por 30 s.
test('muitos PINs errados seguidos fazem esperar antes de tentar de novo', async () => {
  const intruso = cliente();
  await intruso.login('Ana', '1111');
  const { dados } = await intruso.req('GET', '/api/login/usuarios');
  const anaId = dados.usuarios.find((u) => u.nome === 'Ana').id;
  for (let i = 0; i < 5; i++) assert.equal((await intruso.req('POST', '/api/login', { usuario_id: anaId, pin: '9999' })).status, 400);
  const bloqueado = await intruso.req('POST', '/api/login', { usuario_id: anaId, pin: '1111' });
  assert.equal(bloqueado.status, 429);
  assert.match(bloqueado.dados.erro, /Espere \d+ segundos/);
});
