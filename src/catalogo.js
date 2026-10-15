import { ErroHttp, codigoFmt, texto } from './util.js';
import { transacao, lerConfig, buscarMovel, SQL_MOVEL } from './db.js';
import { hashPin } from './seguranca.js';

const PAPEIS = ['vendedor', 'caixa', 'admin'];
const CHAVES_CONFIG = ['nome_evento', 'reserva_minutos', 'backup_pasta', 'wifi_nome', 'wifi_senha'];
const MAX_FAIXA = 2000;

const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');

export function criarCatalogo(db, aoMudar = () => {}) {
  function nome(valor, oQue) {
    const n = texto(valor);
    if (!n) throw new ErroHttp(400, `Informe o nome ${oQue}.`);
    if (n.length > 60) throw new ErroHttp(400, 'Nome muito longo.');
    return n;
  }

  function preco(valor) {
    const n = Number(valor);
    if (!Number.isInteger(n) || n <= 0 || n > 10_000_000) throw new ErroHttp(400, 'Preço inválido.');
    return n;
  }

  function exigirTipo(id) {
    if (!db.prepare('SELECT 1 FROM tipos WHERE id = ?').get(id)) throw new ErroHttp(400, 'Escolha o tipo do móvel.');
    return id;
  }

  // ---- Móveis ----

  function listarMoveis(filtro = {}) {
    const onde = [];
    const args = [];
    if (filtro.status) {
      const lista = String(filtro.status).split(',');
      onde.push(`m.status IN (${lista.map(() => '?').join(',')})`);
      args.push(...lista);
    }
    if (filtro.tipo_id) {
      onde.push('m.tipo_id = ?');
      args.push(Number(filtro.tipo_id));
    }
    return db.prepare(`${SQL_MOVEL} ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''} ORDER BY m.codigo`).all(...args);
  }

  function gerarEtiquetas(quantidade) {
    const qtd = Number(quantidade);
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > MAX_FAIXA) throw new ErroHttp(400, `Quantidade inválida (de 1 a ${MAX_FAIXA}).`);
    const ultimo = db.prepare('SELECT COALESCE(MAX(codigo), 0) AS m FROM moveis').get().m;
    transacao(db, () => {
      const inserir = db.prepare('INSERT INTO moveis (codigo, atualizado_em) VALUES (?, ?)');
      for (let c = ultimo + 1; c <= ultimo + qtd; c++) inserir.run(c, Date.now());
    });
    aoMudar();
    return { de: ultimo + 1, ate: ultimo + qtd };
  }

  function statusDepoisDoCadastro(statusAtual, tipoId, precoCentavos) {
    const completo = Boolean(tipoId && precoCentavos);
    if (statusAtual === 'sem_cadastro' && completo) return 'disponivel';
    if (statusAtual === 'disponivel' && !completo) return 'sem_cadastro';
    return statusAtual;
  }

  function atualizarMovel(codigoBruto, dados) {
    const codigo = Number(codigoBruto);
    const m = buscarMovel(db, codigo);
    if (!m) throw new ErroHttp(404, `Não existe móvel com o número ${codigoFmt(codigo)}.`);
    const tipoId = dados.tipo_id !== undefined ? exigirTipo(Number(dados.tipo_id)) : m.tipo_id;
    const precoNovo = dados.preco_centavos !== undefined ? preco(dados.preco_centavos) : m.preco_centavos;
    const descricao = dados.descricao !== undefined ? texto(dados.descricao).slice(0, 120) : m.descricao;
    if (['reservado', 'vendido'].includes(m.status) && (precoNovo !== m.preco_centavos || tipoId !== m.tipo_id)) {
      throw new ErroHttp(409, `O ${codigoFmt(codigo)} está ${m.status}; não dá para mudar tipo ou preço agora.`);
    }
    db.prepare('UPDATE moveis SET tipo_id = ?, preco_centavos = ?, descricao = ?, status = ?, atualizado_em = ? WHERE codigo = ?')
      .run(tipoId, precoNovo, descricao, statusDepoisDoCadastro(m.status, tipoId, precoNovo), Date.now(), codigo);
    aoMudar();
    return buscarMovel(db, codigo);
  }

  function cadastrarLote(dados) {
    const de = Number(dados.de);
    const ate = Number(dados.ate);
    if (!Number.isInteger(de) || !Number.isInteger(ate) || de < 1 || ate < de) throw new ErroHttp(400, 'Faixa de números inválida.');
    if (ate - de + 1 > MAX_FAIXA) throw new ErroHttp(400, 'Faixa grande demais.');
    const tipoId = exigirTipo(Number(dados.tipo_id));
    const precoNovo = preco(dados.preco_centavos);
    const descricao = dados.descricao !== undefined ? texto(dados.descricao).slice(0, 120) : null;
    const resultado = { atualizados: 0, pulados: [], inexistentes: 0 };
    transacao(db, () => {
      for (let codigo = de; codigo <= ate; codigo++) {
        const m = db.prepare('SELECT status, descricao FROM moveis WHERE codigo = ?').get(codigo);
        if (!m) { resultado.inexistentes++; continue; }
        if (!['sem_cadastro', 'disponivel'].includes(m.status)) { resultado.pulados.push(codigo); continue; }
        db.prepare('UPDATE moveis SET tipo_id = ?, preco_centavos = ?, descricao = ?, status = ?, atualizado_em = ? WHERE codigo = ?')
          .run(tipoId, precoNovo, descricao ?? m.descricao, 'disponivel', Date.now(), codigo);
        resultado.atualizados++;
      }
    });
    aoMudar();
    return resultado;
  }

  // ---- Tipos e cidades ----

  const listarTipos = () => db.prepare(`
    SELECT t.id, t.nome, COUNT(m.codigo) AS qtd FROM tipos t LEFT JOIN moveis m ON m.tipo_id = t.id GROUP BY t.id`).all().sort(porNome);

  const listarCidades = () => db.prepare(`
    SELECT c.id, c.nome, COUNT(p.id) AS qtd FROM cidades c LEFT JOIN pedidos p ON p.cidade_id = c.id GROUP BY c.id`).all().sort(porNome);

  function criarSimples(tabela, oQue) {
    return (valor) => {
      const r = db.prepare(`INSERT INTO ${tabela} (nome) VALUES (?)`).run(nome(valor, oQue));
      aoMudar();
      return { id: Number(r.lastInsertRowid) };
    };
  }

  function renomearSimples(tabela, oQue) {
    return (id, valor) => {
      const r = db.prepare(`UPDATE ${tabela} SET nome = ? WHERE id = ?`).run(nome(valor, oQue), Number(id));
      if (r.changes !== 1) throw new ErroHttp(404, 'Cadastro não encontrado.');
      aoMudar();
      return { ok: true };
    };
  }

  function excluirTipo(id) {
    if (db.prepare('SELECT 1 FROM moveis WHERE tipo_id = ?').get(Number(id))) {
      throw new ErroHttp(409, 'Esse tipo está sendo usado por algum móvel.');
    }
    db.prepare('DELETE FROM tipos WHERE id = ?').run(Number(id));
    aoMudar();
    return { ok: true };
  }

  function excluirCidade(id) {
    if (db.prepare('SELECT 1 FROM pedidos WHERE cidade_id = ?').get(Number(id))) {
      throw new ErroHttp(409, 'Essa cidade já aparece em algum pedido.');
    }
    db.prepare('DELETE FROM cidades WHERE id = ?').run(Number(id));
    aoMudar();
    return { ok: true };
  }

  // ---- Usuários ----

  function pin(valor) {
    const p = texto(valor);
    if (!/^\d{4,6}$/.test(p)) throw new ErroHttp(400, 'O PIN deve ter de 4 a 6 números.');
    return p;
  }

  function papel(valor) {
    if (!PAPEIS.includes(valor)) throw new ErroHttp(400, 'Função inválida.');
    return valor;
  }

  const listarUsuarios = () => db.prepare(`
    SELECT id, nome, papel, ativo FROM usuarios
    ORDER BY ativo DESC, CASE papel WHEN 'vendedor' THEN 1 WHEN 'caixa' THEN 2 ELSE 3 END, nome`).all();

  function criarUsuario(dados) {
    const r = db.prepare('INSERT INTO usuarios (nome, pin, papel) VALUES (?, ?, ?)')
      .run(nome(dados.nome, 'da pessoa'), hashPin(pin(dados.pin)), papel(dados.papel));
    aoMudar();
    return { id: Number(r.lastInsertRowid) };
  }

  function atualizarUsuario(id, dados) {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(id));
    if (!u) throw new ErroHttp(404, 'Usuário não encontrado.');
    const novo = {
      nome: dados.nome !== undefined ? nome(dados.nome, 'da pessoa') : u.nome,
      pin: dados.pin !== undefined ? hashPin(pin(dados.pin)) : u.pin,
      papel: dados.papel !== undefined ? papel(dados.papel) : u.papel,
      ativo: dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : u.ativo,
    };
    if (u.papel === 'admin' && u.ativo && (novo.papel !== 'admin' || !novo.ativo)) {
      const outros = db.prepare(`SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'admin' AND ativo = 1 AND id <> ?`).get(u.id).n;
      if (!outros) throw new ErroHttp(409, 'Precisa existir pelo menos um administrador ativo.');
    }
    db.prepare('UPDATE usuarios SET nome = ?, pin = ?, papel = ?, ativo = ? WHERE id = ?')
      .run(novo.nome, novo.pin, novo.papel, novo.ativo, u.id);
    if (!novo.ativo || dados.pin !== undefined) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(u.id);
    aoMudar();
    return { ok: true };
  }

  // ---- Configurações ----

  function salvarConfig(dados) {
    for (const chave of CHAVES_CONFIG) {
      if (dados[chave] === undefined) continue;
      const valor = texto(dados[chave]);
      if (chave === 'nome_evento' && !valor) throw new ErroHttp(400, 'Informe o nome do evento.');
      if (chave === 'reserva_minutos') {
        const n = Number(valor);
        if (!Number.isInteger(n) || n < 1 || n > 240) throw new ErroHttp(400, 'Tempo de reserva deve ser de 1 a 240 minutos.');
      }
      db.prepare('UPDATE config SET valor = ? WHERE chave = ?').run(valor, chave);
    }
    aoMudar();
    return lerConfig(db);
  }

  return {
    listarMoveis, gerarEtiquetas, atualizarMovel, cadastrarLote,
    listarTipos, criarTipo: criarSimples('tipos', 'do tipo'), renomearTipo: renomearSimples('tipos', 'do tipo'), excluirTipo,
    listarCidades, criarCidade: criarSimples('cidades', 'da cidade'), renomearCidade: renomearSimples('cidades', 'da cidade'), excluirCidade,
    listarUsuarios, criarUsuario, atualizarUsuario,
    salvarConfig,
  };
}
