import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { hashPin } from './seguranca.js';

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pin TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('vendedor', 'caixa', 'admin')),
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tipos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS cidades (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY,
  vendedor_id INTEGER NOT NULL REFERENCES usuarios(id),
  status TEXT NOT NULL CHECK (status IN ('rascunho', 'aguardando', 'pago', 'cancelado', 'expirado')),
  cliente_nome TEXT,
  telefone TEXT,
  cidade_id INTEGER REFERENCES cidades(id),
  bairro TEXT,
  rua TEXT,
  numero TEXT,
  complemento TEXT,
  observacao TEXT,
  criado_em INTEGER NOT NULL,
  expira_em INTEGER,
  finalizado_em INTEGER,
  pago_em INTEGER,
  caixa_id INTEGER REFERENCES usuarios(id),
  troco_centavos INTEGER NOT NULL DEFAULT 0,
  cancelado_em INTEGER,
  cancelado_por INTEGER REFERENCES usuarios(id),
  entregue INTEGER NOT NULL DEFAULT 0,
  entregue_em INTEGER
);

-- Cada móvel aponta para o pedido que o está segurando (reservado) ou que o comprou (vendido).
CREATE TABLE IF NOT EXISTS moveis (
  codigo INTEGER PRIMARY KEY,
  tipo_id INTEGER REFERENCES tipos(id),
  descricao TEXT NOT NULL DEFAULT '',
  preco_centavos INTEGER,
  status TEXT NOT NULL DEFAULT 'sem_cadastro' CHECK (status IN ('sem_cadastro', 'disponivel', 'reservado', 'vendido')),
  pedido_id INTEGER REFERENCES pedidos(id),
  atualizado_em INTEGER NOT NULL
);

-- Itens guardam o preço do momento da reserva.
CREATE TABLE IF NOT EXISTS itens (
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  movel_codigo INTEGER NOT NULL REFERENCES moveis(codigo),
  preco_centavos INTEGER NOT NULL,
  PRIMARY KEY (pedido_id, movel_codigo)
);

CREATE TABLE IF NOT EXISTS pagamentos (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  forma TEXT NOT NULL CHECK (forma IN ('dinheiro', 'pix', 'cartao')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  caixa_id INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comprovantes (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  arquivo TEXT NOT NULL,
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS historico (
  id INTEGER PRIMARY KEY,
  quando INTEGER NOT NULL,
  usuario_id INTEGER,
  acao TEXT NOT NULL,
  detalhe TEXT
);

CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_vendedor ON pedidos(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_moveis_pedido ON moveis(pedido_id);
CREATE INDEX IF NOT EXISTS idx_itens_movel ON itens(movel_codigo);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pedido ON pagamentos(pedido_id);
`;

const CONFIG_PADRAO = {
  nome_evento: 'Bazar de Móveis',
  reserva_minutos: '20',
  backup_pasta: '',
  wifi_nome: '',
  wifi_senha: '',
};

const TIPOS_INICIAIS = [
  'Armário', 'Balcão', 'Cadeira', 'Cama', 'Colchão', 'Cômoda', 'Criado-mudo', 'Escrivaninha',
  'Estante', 'Guarda-roupa', 'Mesa', 'Poltrona', 'Rack', 'Sofá',
];

export const PIN_ADMIN_INICIAL = '1234';

export function abrirBanco(arquivo) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(ESQUEMA);
  popular(db);
  return db;
}

function popular(db) {
  const inserir = db.prepare('INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)');
  for (const [chave, valor] of Object.entries(CONFIG_PADRAO)) inserir.run(chave, valor);

  if (!db.prepare('SELECT 1 FROM usuarios LIMIT 1').get()) {
    db.prepare("INSERT INTO usuarios (nome, pin, papel) VALUES ('Admin', ?, 'admin')").run(hashPin(PIN_ADMIN_INICIAL));
    const tipo = db.prepare('INSERT INTO tipos (nome) VALUES (?)');
    for (const nome of TIPOS_INICIAIS) tipo.run(nome);
  }
}

// O node:sqlite é síncrono: tudo o que roda dentro de `fn` acontece sem nenhuma outra
// requisição no meio, e o BEGIN IMMEDIATE garante que ninguém mais grava no arquivo.
export function transacao(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function lerConfig(db) {
  return Object.fromEntries(db.prepare('SELECT chave, valor FROM config').all().map((r) => [r.chave, r.valor]));
}

export const SQL_MOVEL = `
  SELECT m.codigo, m.tipo_id, t.nome AS tipo_nome, m.descricao, m.preco_centavos, m.status,
         m.pedido_id, u.nome AS vendedor_nome, m.atualizado_em
  FROM moveis m
  LEFT JOIN tipos t ON t.id = m.tipo_id
  LEFT JOIN pedidos p ON p.id = m.pedido_id
  LEFT JOIN usuarios u ON u.id = p.vendedor_id`;

export function buscarMovel(db, codigo) {
  return db.prepare(`${SQL_MOVEL} WHERE m.codigo = ?`).get(codigo) ?? null;
}
