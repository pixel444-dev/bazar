import { ErroHttp, reais, codigoFmt, texto } from './util.js';
import { transacao, lerConfig, buscarMovel } from './db.js';

// 'entrega': o cliente paga ao entregador quando recebe o móvel.
export const FORMAS = ['dinheiro', 'pix', 'cartao', 'entrega'];
const TROCO_MAXIMO = 10_000_000; // R$ 100.000,00

const ROTULO = {
  rascunho: 'em andamento',
  aguardando: 'aguardando pagamento',
  pago: 'pago',
  cancelado: 'cancelado',
  expirado: 'expirado',
};

const SQL_PEDIDO = `
  SELECT p.*, v.nome AS vendedor_nome, c.nome AS caixa_nome, ci.nome AS cidade_nome
  FROM pedidos p
  JOIN usuarios v ON v.id = p.vendedor_id
  LEFT JOIN usuarios c ON c.id = p.caixa_id
  LEFT JOIN cidades ci ON ci.id = p.cidade_id`;

export function criarVendas(db, aoMudar = () => {}) {
  const prazo = () => Date.now() + (Number(lerConfig(db).reserva_minutos) || 20) * 60_000;

  function registrar(usuarioId, acao, detalhe) {
    db.prepare('INSERT INTO historico (quando, usuario_id, acao, detalhe) VALUES (?, ?, ?, ?)')
      .run(Date.now(), usuarioId ?? null, acao, detalhe == null ? null : JSON.stringify(detalhe));
  }

  function pedido(id) {
    const p = db.prepare(`${SQL_PEDIDO} WHERE p.id = ?`).get(id);
    if (!p) return null;
    p.itens = db.prepare(`
      SELECT i.movel_codigo AS codigo, i.preco_centavos, m.descricao, t.nome AS tipo_nome
      FROM itens i
      JOIN moveis m ON m.codigo = i.movel_codigo
      LEFT JOIN tipos t ON t.id = m.tipo_id
      WHERE i.pedido_id = ?
      ORDER BY i.movel_codigo`).all(id);
    p.total_centavos = p.itens.reduce((soma, i) => soma + i.preco_centavos, 0);
    p.pagamentos = db.prepare('SELECT forma, valor_centavos FROM pagamentos WHERE pedido_id = ? ORDER BY id').all(id);
    p.comprovantes = db.prepare('SELECT id, criado_em FROM comprovantes WHERE pedido_id = ? ORDER BY id').all(id);
    return p;
  }

  function exigirPedido(id) {
    const p = pedido(Number(id));
    if (!p) throw new ErroHttp(404, `Pedido #${id} não encontrado.`);
    return p;
  }

  function podeVer(usuario, p) {
    if (usuario.papel === 'vendedor' && p.vendedor_id !== usuario.id) {
      throw new ErroHttp(403, 'Esse pedido é de outro vendedor.');
    }
  }

  function liberarReservas(pedidoId) {
    db.prepare(`UPDATE moveis SET status = 'disponivel', pedido_id = NULL, atualizado_em = ?
                WHERE pedido_id = ? AND status = 'reservado'`).run(Date.now(), pedidoId);
  }

  function expirarVencidos() {
    const vencidos = db.prepare(`SELECT id FROM pedidos WHERE status IN ('rascunho', 'aguardando') AND expira_em < ?`)
      .all(Date.now());
    if (!vencidos.length) return 0;
    transacao(db, () => {
      for (const { id } of vencidos) {
        liberarReservas(id);
        db.prepare(`UPDATE pedidos SET status = 'expirado' WHERE id = ?`).run(id);
        registrar(null, 'expirou', { pedido: id });
      }
    });
    aoMudar();
    return vencidos.length;
  }

  function rascunhoId(usuarioId) {
    return db.prepare(`SELECT id FROM pedidos WHERE vendedor_id = ? AND status = 'rascunho' ORDER BY id DESC LIMIT 1`)
      .get(usuarioId)?.id ?? null;
  }

  function rascunho(usuarioId) {
    expirarVencidos();
    const id = rascunhoId(usuarioId);
    return id ? pedido(id) : null;
  }

  function motivoIndisponivel(m) {
    const cod = codigoFmt(m.codigo);
    if (m.status === 'sem_cadastro') return `O ${cod} ainda não tem tipo e preço cadastrados. Chame o responsável.`;
    if (m.status === 'reservado') return `O ${cod} já está reservado por ${m.vendedor_nome} (pedido #${m.pedido_id}).`;
    if (m.status === 'vendido') return `O ${cod} já foi vendido (pedido #${m.pedido_id}).`;
    return `O ${cod} não está disponível.`;
  }

  // O coração do sistema: só um pedido consegue tirar o móvel de "disponivel".
  function reservar(usuario, codigoBruto) {
    const codigo = Number(codigoBruto);
    if (!Number.isInteger(codigo) || codigo <= 0) throw new ErroHttp(400, 'Digite o número da etiqueta.');
    expirarVencidos();
    const id = transacao(db, () => {
      const m = buscarMovel(db, codigo);
      let pedidoId = rascunhoId(usuario.id);
      if (!m) throw new ErroHttp(404, `Não existe móvel com o número ${codigoFmt(codigo)}.`);
      if (m.status !== 'disponivel') {
        if (m.status === 'reservado' && m.pedido_id === pedidoId) {
          throw new ErroHttp(409, `O ${codigoFmt(codigo)} já está nesta venda.`);
        }
        throw new ErroHttp(409, motivoIndisponivel(m));
      }
      const agora = Date.now();
      if (pedidoId) {
        db.prepare('UPDATE pedidos SET expira_em = ? WHERE id = ?').run(prazo(), pedidoId);
      } else {
        pedidoId = Number(db.prepare(`INSERT INTO pedidos (vendedor_id, status, criado_em, expira_em)
                                      VALUES (?, 'rascunho', ?, ?)`).run(usuario.id, agora, prazo()).lastInsertRowid);
      }
      const r = db.prepare(`UPDATE moveis SET status = 'reservado', pedido_id = ?, atualizado_em = ?
                            WHERE codigo = ? AND status = 'disponivel'`).run(pedidoId, agora, codigo);
      if (r.changes !== 1) throw new ErroHttp(409, `O ${codigoFmt(codigo)} acabou de ser reservado por outro vendedor.`);
      db.prepare('INSERT INTO itens (pedido_id, movel_codigo, preco_centavos) VALUES (?, ?, ?)')
        .run(pedidoId, codigo, m.preco_centavos);
      registrar(usuario.id, 'reservou', { pedido: pedidoId, codigo });
      return pedidoId;
    });
    aoMudar();
    return pedido(id);
  }

  function removerItem(usuario, pedidoId, codigoBruto) {
    const codigo = Number(codigoBruto);
    expirarVencidos();
    transacao(db, () => {
      const p = exigirPedido(pedidoId);
      podeVer(usuario, p);
      if (!['rascunho', 'aguardando'].includes(p.status)) {
        throw new ErroHttp(409, `Esse pedido está ${ROTULO[p.status]}; não dá para remover móveis.`);
      }
      const r = db.prepare('DELETE FROM itens WHERE pedido_id = ? AND movel_codigo = ?').run(p.id, codigo);
      if (r.changes !== 1) throw new ErroHttp(404, `O ${codigoFmt(codigo)} não está nesse pedido.`);
      db.prepare(`UPDATE moveis SET status = 'disponivel', pedido_id = NULL, atualizado_em = ?
                  WHERE codigo = ? AND pedido_id = ? AND status = 'reservado'`).run(Date.now(), codigo, p.id);
      if (p.status === 'aguardando' && p.itens.length === 1) {
        db.prepare(`UPDATE pedidos SET status = 'cancelado', cancelado_em = ?, cancelado_por = ? WHERE id = ?`)
          .run(Date.now(), usuario.id, p.id);
      }
      registrar(usuario.id, 'removeu_item', { pedido: p.id, codigo });
    });
    aoMudar();
    return pedido(pedidoId);
  }

  function validarCliente(dados) {
    const c = {
      cliente_nome: texto(dados.cliente_nome),
      telefone: texto(dados.telefone).replace(/\D/g, ''),
      cidade_id: Number(dados.cidade_id) || null,
      bairro: texto(dados.bairro),
      rua: texto(dados.rua),
      numero: texto(dados.numero),
      complemento: texto(dados.complemento),
      observacao: texto(dados.observacao),
    };
    const faltando = [];
    if (!c.cliente_nome) faltando.push('nome do cliente');
    if (c.telefone.length < 10 || c.telefone.length > 11) faltando.push('telefone com DDD');
    if (!c.cidade_id || !db.prepare('SELECT 1 FROM cidades WHERE id = ?').get(c.cidade_id)) faltando.push('cidade');
    if (!c.bairro) faltando.push('bairro');
    if (!c.rua) faltando.push('rua');
    if (!c.numero) faltando.push('número');
    if (faltando.length) throw new ErroHttp(400, `Preencha: ${faltando.join(', ')}.`);
    return c;
  }

  function gravarCliente(id, c) {
    db.prepare(`UPDATE pedidos SET cliente_nome = ?, telefone = ?, cidade_id = ?, bairro = ?, rua = ?, numero = ?,
                complemento = ?, observacao = ? WHERE id = ?`)
      .run(c.cliente_nome, c.telefone, c.cidade_id, c.bairro, c.rua, c.numero, c.complemento, c.observacao, id);
  }

  function finalizar(usuario, dados) {
    expirarVencidos();
    const c = validarCliente(dados);
    const id = rascunhoId(usuario.id);
    if (!id) throw new ErroHttp(409, 'Nenhuma venda em andamento. A reserva pode ter expirado.');
    transacao(db, () => {
      const p = pedido(id);
      if (!p.itens.length) throw new ErroHttp(400, 'Reserve pelo menos um móvel antes de finalizar.');
      gravarCliente(id, c);
      db.prepare(`UPDATE pedidos SET status = 'aguardando', finalizado_em = ?, expira_em = ? WHERE id = ?`)
        .run(Date.now(), prazo(), id);
      registrar(usuario.id, 'finalizou', { pedido: id });
    });
    aoMudar();
    return pedido(id);
  }

  function atualizarCliente(usuario, id, dados) {
    const p = exigirPedido(id);
    podeVer(usuario, p);
    if (p.status === 'cancelado') throw new ErroHttp(409, 'Esse pedido foi cancelado.');
    if (p.status === 'pago' && usuario.papel === 'vendedor') {
      throw new ErroHttp(403, 'Pedido já pago. Peça ao caixa para corrigir o endereço.');
    }
    const c = validarCliente(dados);
    gravarCliente(p.id, c);
    registrar(usuario.id, 'editou_cliente', { pedido: p.id });
    aoMudar();
    return pedido(p.id);
  }

  function cancelar(usuario, id) {
    expirarVencidos();
    transacao(db, () => {
      const p = exigirPedido(id);
      podeVer(usuario, p);
      if (p.status === 'cancelado') throw new ErroHttp(409, 'Esse pedido já está cancelado.');
      if (p.status === 'pago') {
        if (usuario.papel !== 'admin') throw new ErroHttp(403, 'Só o administrador pode cancelar um pedido já pago.');
        db.prepare(`UPDATE moveis SET status = 'disponivel', pedido_id = NULL, atualizado_em = ?
                    WHERE pedido_id = ? AND status = 'vendido'`).run(Date.now(), p.id);
      } else {
        liberarReservas(p.id);
      }
      db.prepare(`UPDATE pedidos SET status = 'cancelado', cancelado_em = ?, cancelado_por = ?, expira_em = NULL WHERE id = ?`)
        .run(Date.now(), usuario.id, p.id);
      registrar(usuario.id, 'cancelou', { pedido: p.id, status_anterior: p.status });
    });
    aoMudar();
    return pedido(id);
  }

  function descartar(usuario) {
    const id = rascunhoId(usuario.id);
    return id ? cancelar(usuario, id) : null;
  }

  // Cliente demorou na fila do caixa: tenta reservar de novo o que ainda estiver livre.
  function reativar(usuario, id) {
    expirarVencidos();
    const perdidos = transacao(db, () => {
      const p = exigirPedido(id);
      if (p.status !== 'expirado') throw new ErroHttp(409, 'Só pedidos expirados podem ser reativados.');
      if (!p.finalizado_em) throw new ErroHttp(409, 'Essa venda não chegou a ser finalizada pelo vendedor.');
      const perdidos = [];
      for (const item of p.itens) {
        const r = db.prepare(`UPDATE moveis SET status = 'reservado', pedido_id = ?, atualizado_em = ?
                              WHERE codigo = ? AND status = 'disponivel'`).run(p.id, Date.now(), item.codigo);
        if (r.changes !== 1) {
          perdidos.push(item.codigo);
          db.prepare('DELETE FROM itens WHERE pedido_id = ? AND movel_codigo = ?').run(p.id, item.codigo);
        }
      }
      if (perdidos.length === p.itens.length) {
        throw new ErroHttp(409, 'Todos os móveis desse pedido já foram vendidos ou reservados para outra pessoa.');
      }
      db.prepare(`UPDATE pedidos SET status = 'aguardando', expira_em = ? WHERE id = ?`).run(prazo(), p.id);
      registrar(usuario.id, 'reativou', { pedido: p.id, perdidos });
      return perdidos;
    });
    aoMudar();
    return { pedido: pedido(id), perdidos };
  }

  function pagar(usuario, id, corpo = {}) {
    expirarVencidos();
    transacao(db, () => {
      const p = exigirPedido(id);
      if (p.status === 'expirado') {
        throw new ErroHttp(409, 'A reserva desse pedido expirou. Clique em "Reativar" para reservar os móveis de novo.');
      }
      if (p.status !== 'aguardando') throw new ErroHttp(409, `Esse pedido está ${ROTULO[p.status]}.`);
      if (!p.itens.length) throw new ErroHttp(409, 'Esse pedido não tem móveis.');

      const pagamentos = (Array.isArray(corpo.pagamentos) ? corpo.pagamentos : [])
        .map((x) => ({ forma: x?.forma, valor: Number(x?.valor_centavos) }))
        .filter((x) => x.valor !== 0);
      if (!pagamentos.length) throw new ErroHttp(400, 'Informe como o cliente pagou.');
      for (const x of pagamentos) {
        if (!FORMAS.includes(x.forma) || !Number.isSafeInteger(x.valor) || x.valor < 0) {
          throw new ErroHttp(400, 'Pagamento inválido.');
        }
      }
      const soma = pagamentos.reduce((s, x) => s + x.valor, 0);
      if (soma !== p.total_centavos) {
        throw new ErroHttp(400, `A soma dos pagamentos (${reais(soma)}) não bate com o total (${reais(p.total_centavos)}).`);
      }
      // Um número gigante gravado aqui não volta mais do banco e quebraria o fechamento de vez.
      const troco = Number(corpo.troco_centavos) || 0;
      if (!Number.isInteger(troco) || troco < 0 || troco > TROCO_MAXIMO) {
        throw new ErroHttp(400, 'Troco inválido. Confira quanto o cliente entregou em dinheiro.');
      }
      if (troco > 0 && !pagamentos.some((x) => x.forma === 'dinheiro')) {
        throw new ErroHttp(400, 'Só existe troco quando parte do pagamento é em dinheiro.');
      }

      const agora = Date.now();
      const inserir = db.prepare('INSERT INTO pagamentos (pedido_id, forma, valor_centavos, caixa_id, criado_em) VALUES (?, ?, ?, ?, ?)');
      for (const x of pagamentos) inserir.run(p.id, x.forma, x.valor, usuario.id, agora);
      const r = db.prepare(`UPDATE moveis SET status = 'vendido', atualizado_em = ? WHERE pedido_id = ? AND status = 'reservado'`)
        .run(agora, p.id);
      if (r.changes !== p.itens.length) {
        throw new ErroHttp(409, 'Algum móvel desse pedido não está mais reservado. Atualize a tela.');
      }
      db.prepare(`UPDATE pedidos SET status = 'pago', pago_em = ?, caixa_id = ?, troco_centavos = ?, expira_em = NULL WHERE id = ?`)
        .run(agora, usuario.id, troco, p.id);
      registrar(usuario.id, 'pagou', { pedido: p.id, pagamentos, troco });
    });
    aoMudar();
    return pedido(id);
  }

  function marcarEntrega(usuario, id, entregue) {
    const p = exigirPedido(id);
    if (p.status !== 'pago') throw new ErroHttp(409, 'Só pedidos pagos vão para entrega.');
    db.prepare('UPDATE pedidos SET entregue = ?, entregue_em = ? WHERE id = ?')
      .run(entregue ? 1 : 0, entregue ? Date.now() : null, p.id);
    registrar(usuario.id, entregue ? 'entregou' : 'desmarcou_entrega', { pedido: p.id });
    aoMudar();
    return pedido(p.id);
  }

  function adicionarComprovante(usuario, id, arquivo) {
    const p = exigirPedido(id);
    const r = db.prepare('INSERT INTO comprovantes (pedido_id, arquivo, criado_em) VALUES (?, ?, ?)').run(p.id, arquivo, Date.now());
    registrar(usuario.id, 'anexou_comprovante', { pedido: p.id });
    aoMudar();
    return { id: Number(r.lastInsertRowid) };
  }

  function listarPedidos(filtro = {}) {
    expirarVencidos();
    const onde = [];
    const args = [];
    const status = String(filtro.status ?? '').split(',').filter((s) => ROTULO[s]);
    if (status.length) {
      onde.push(`p.status IN (${status.map(() => '?').join(',')})`);
      args.push(...status);
    }
    // Vendas que nunca saíram do celular do vendedor não interessam ao caixa.
    if (!status.includes('rascunho')) onde.push('p.finalizado_em IS NOT NULL');
    if (filtro.vendedor_id) {
      onde.push('p.vendedor_id = ?');
      args.push(Number(filtro.vendedor_id));
    }
    if (filtro.entregue !== undefined && filtro.entregue !== '') {
      onde.push('p.entregue = ?');
      args.push(Number(filtro.entregue) ? 1 : 0);
    }
    let ordemExata = 0;
    const busca = texto(filtro.busca);
    if (busca) {
      const digitos = busca.replace(/^#/, '');
      if (/^\d+$/.test(digitos)) {
        onde.push('(p.id = ? OR p.telefone LIKE ?)');
        args.push(Number(digitos), `%${digitos}%`);
        ordemExata = Number(digitos);
      } else {
        onde.push('p.cliente_nome LIKE ?');
        args.push(`%${busca}%`);
      }
    }
    const limite = Math.min(Number(filtro.limite) || 300, 2000);
    return db.prepare(`
      SELECT p.id, p.status, p.cliente_nome, p.telefone, p.bairro, ci.nome AS cidade_nome, v.nome AS vendedor_nome,
             p.criado_em, p.finalizado_em, p.expira_em, p.pago_em, p.entregue,
             (SELECT COUNT(*) FROM itens i WHERE i.pedido_id = p.id) AS qtd_itens,
             (SELECT COALESCE(SUM(i.preco_centavos), 0) FROM itens i WHERE i.pedido_id = p.id) AS total_centavos
      FROM pedidos p
      JOIN usuarios v ON v.id = p.vendedor_id
      LEFT JOIN cidades ci ON ci.id = p.cidade_id
      WHERE ${onde.length ? onde.join(' AND ') : '1'}
      ORDER BY (p.id = ?) DESC, p.id DESC
      LIMIT ?`).all(...args, ordemExata, limite);
  }

  return {
    pedido, exigirPedido, podeVer, expirarVencidos, rascunho, reservar, removerItem, finalizar,
    atualizarCliente, cancelar, descartar, reativar, pagar, marcarEntrega, adicionarComprovante, listarPedidos,
  };
}
