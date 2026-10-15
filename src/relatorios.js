import { codigoFmt } from './util.js';
import { SQL_MOVEL } from './db.js';

const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');

export function estoquePorTipo(db) {
  return db.prepare(`
    SELECT t.id, t.nome, COUNT(m.codigo) AS total,
           COALESCE(SUM(m.status = 'disponivel'), 0) AS disponiveis,
           COALESCE(SUM(m.status = 'reservado'), 0) AS reservados,
           COALESCE(SUM(m.status = 'vendido'), 0) AS vendidos,
           COALESCE(SUM(m.preco_centavos), 0) AS valor_total,
           COALESCE(SUM(CASE WHEN m.status = 'vendido' THEN m.preco_centavos END), 0) AS valor_vendido
    FROM tipos t JOIN moveis m ON m.tipo_id = t.id
    GROUP BY t.id`).all().sort(porNome);
}

export function resumo(db) {
  const moveis = { sem_cadastro: 0, disponivel: 0, reservado: 0, vendido: 0 };
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM moveis GROUP BY status').all()) moveis[r.status] = r.n;

  const pedidos = { aguardando: 0, pago: 0, cancelado: 0, expirado: 0 };
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM pedidos WHERE finalizado_em IS NOT NULL GROUP BY status').all()) {
    pedidos[r.status] = r.n;
  }

  const formas = { dinheiro: 0, pix: 0, cartao: 0, entrega: 0, total: 0 };
  const caixas = new Map();
  const linhas = db.prepare(`
    SELECT pg.caixa_id, u.nome, pg.forma, SUM(pg.valor_centavos) AS total, COUNT(DISTINCT pg.pedido_id) AS pedidos
    FROM pagamentos pg
    JOIN pedidos p ON p.id = pg.pedido_id AND p.status = 'pago'
    JOIN usuarios u ON u.id = pg.caixa_id
    GROUP BY pg.caixa_id, pg.forma`).all();
  for (const l of linhas) {
    formas[l.forma] += l.total;
    formas.total += l.total;
    const c = caixas.get(l.caixa_id) ?? { caixa_id: l.caixa_id, nome: l.nome, dinheiro: 0, pix: 0, cartao: 0, entrega: 0, total: 0 };
    c[l.forma] += l.total;
    c.total += l.total;
    caixas.set(l.caixa_id, c);
  }
  const pedidosPorCaixa = db.prepare(`SELECT caixa_id, COUNT(*) AS n, SUM(troco_centavos) AS troco FROM pedidos WHERE status = 'pago' GROUP BY caixa_id`).all();
  for (const r of pedidosPorCaixa) {
    const c = caixas.get(r.caixa_id);
    if (c) { c.pedidos = r.n; c.troco = r.troco; }
  }

  const vendedores = db.prepare(`
    SELECT u.nome, COUNT(DISTINCT p.id) AS pedidos, COUNT(i.movel_codigo) AS itens, COALESCE(SUM(i.preco_centavos), 0) AS total
    FROM pedidos p
    JOIN usuarios u ON u.id = p.vendedor_id
    JOIN itens i ON i.pedido_id = p.id
    WHERE p.status = 'pago'
    GROUP BY u.id
    ORDER BY total DESC`).all();

  const entregas = db.prepare(`
    SELECT COALESCE(SUM(entregue = 1), 0) AS entregues, COALESCE(SUM(entregue = 0), 0) AS pendentes
    FROM pedidos WHERE status = 'pago'`).get();
  // Pagamento na entrega: o que o entregador ainda vai cobrar e o que já cobrou (pedido marcado como entregue).
  const naEntrega = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN p.entregue = 0 THEN pg.valor_centavos END), 0) AS a_receber,
           COALESCE(SUM(CASE WHEN p.entregue = 1 THEN pg.valor_centavos END), 0) AS recebido
    FROM pagamentos pg JOIN pedidos p ON p.id = pg.pedido_id AND p.status = 'pago'
    WHERE pg.forma = 'entrega'`).get();
  entregas.a_receber = naEntrega.a_receber;
  entregas.recebido_na_entrega = naEntrega.recebido;

  // Quanto entra se tudo o que tem preço for vendido: o que já foi pago mais o preço de quem ainda está no galpão.
  // Etiquetas sem cadastro ficam de fora, porque ainda não têm preço.
  const precos = { disponivel: 0, reservado: 0 };
  for (const r of db.prepare(`
    SELECT status, SUM(preco_centavos) AS total FROM moveis WHERE status IN ('disponivel', 'reservado') GROUP BY status`).all()) {
    precos[r.status] = r.total;
  }
  const previsao = {
    vendido: formas.total,
    reservado: precos.reservado,
    disponivel: precos.disponivel,
    total: formas.total + precos.reservado + precos.disponivel,
    sem_preco: moveis.sem_cadastro,
  };

  return {
    moveis,
    pedidos,
    formas,
    previsao,
    caixas: [...caixas.values()].sort(porNome),
    vendedores,
    entregas,
    tipos: estoquePorTipo(db),
  };
}

export function romaneio(db, vendas, { pendentes = true } = {}) {
  const ids = db.prepare(`
    SELECT p.id FROM pedidos p LEFT JOIN cidades ci ON ci.id = p.cidade_id
    WHERE p.status = 'pago' ${pendentes ? 'AND p.entregue = 0' : ''}
    ORDER BY ci.nome COLLATE NOCASE, p.bairro COLLATE NOCASE, p.rua COLLATE NOCASE, p.id`).all();
  return ids.map(({ id }) => vendas.pedido(id));
}

// Relatório completo para entregar ao dono do bazar: o resumo, cada venda paga e tudo o que sobrou.
export function relatorioFinal(db, vendas) {
  const pagos = db.prepare(`SELECT id FROM pedidos WHERE status = 'pago' ORDER BY pago_em, id`).all();
  return {
    resumo: resumo(db),
    pedidos: pagos.map(({ id }) => vendas.pedido(id)),
    nao_vendidos: db.prepare(`${SQL_MOVEL} WHERE m.status IN ('disponivel', 'reservado') ORDER BY t.nome COLLATE NOCASE, m.codigo`).all(),
    sem_cadastro: db.prepare(`SELECT codigo FROM moveis WHERE status = 'sem_cadastro' ORDER BY codigo`).all().map((r) => r.codigo),
  };
}

const NOME_FORMA = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', entrega: 'Na entrega' };
const valorBr = (centavos) => (centavos / 100).toFixed(2).replace('.', ',');
const celula = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;

// CSV com ";" e BOM para abrir direto no Excel em português.
export function vendasCsv(db) {
  const pagamentos = new Map();
  for (const pg of db.prepare('SELECT pedido_id, forma, valor_centavos FROM pagamentos ORDER BY id').all()) {
    const lista = pagamentos.get(pg.pedido_id) ?? [];
    lista.push(`${NOME_FORMA[pg.forma]} ${valorBr(pg.valor_centavos)}`);
    pagamentos.set(pg.pedido_id, lista);
  }
  const linhas = db.prepare(`
    SELECT p.id, p.pago_em, v.nome AS vendedor, c.nome AS caixa, p.cliente_nome, p.telefone, ci.nome AS cidade,
           p.bairro, p.rua, p.numero, p.complemento, p.observacao, p.entregue,
           i.movel_codigo, t.nome AS tipo, m.descricao, i.preco_centavos
    FROM pedidos p
    JOIN itens i ON i.pedido_id = p.id
    JOIN moveis m ON m.codigo = i.movel_codigo
    LEFT JOIN tipos t ON t.id = m.tipo_id
    JOIN usuarios v ON v.id = p.vendedor_id
    LEFT JOIN usuarios c ON c.id = p.caixa_id
    LEFT JOIN cidades ci ON ci.id = p.cidade_id
    WHERE p.status = 'pago'
    ORDER BY p.id, i.movel_codigo`).all();
  const cabecalho = ['Pedido', 'Pago em', 'Vendedor', 'Caixa', 'Cliente', 'Telefone', 'Cidade', 'Bairro', 'Rua', 'Número',
    'Complemento', 'Observação', 'Etiqueta', 'Tipo', 'Descrição', 'Preço', 'Pagamento do pedido', 'Entregue'];
  const corpo = linhas.map((l) => [
    l.id, new Date(l.pago_em).toLocaleString('pt-BR'), l.vendedor, l.caixa, l.cliente_nome, l.telefone, l.cidade, l.bairro,
    l.rua, l.numero, l.complemento, l.observacao, codigoFmt(l.movel_codigo), l.tipo, l.descricao, valorBr(l.preco_centavos),
    (pagamentos.get(l.id) ?? []).join(' + '), l.entregue ? 'Sim' : 'Não',
  ]);
  return '﻿' + [cabecalho, ...corpo].map((linha) => linha.map(celula).join(';')).join('\r\n');
}
