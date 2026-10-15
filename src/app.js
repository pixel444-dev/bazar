import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { abrirBanco, lerConfig, buscarMovel } from './db.js';
import { criarVendas } from './vendas.js';
import { criarCatalogo } from './catalogo.js';
import * as relatorios from './relatorios.js';
import { criarBackup } from './backup.js';
import { enderecosLocais, textoWifi } from './rede.js';
import { conferePin, novoToken } from './seguranca.js';
import { ErroHttp, codigoFmt, traduzirErroBanco } from './util.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const EXTENSAO_IMAGEM = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const DURACAO_SESSAO_MS = 14 * 24 * 3600 * 1000;
const LIMITE_CORPO = 12 * 1024 * 1024;
const SEM_RESPOSTA = Symbol('sem-resposta');

const TODOS = ['vendedor', 'caixa', 'admin'];
const CAIXA = ['caixa', 'admin'];
const ADMIN = ['admin'];

export function criarApp({ pastaDados, pastaPublica, timers = true }) {
  const pastaComprovantes = path.join(pastaDados, 'comprovantes');
  fs.mkdirSync(pastaComprovantes, { recursive: true });
  const db = abrirBanco(path.join(pastaDados, 'bazar.db'));

  // ---- Avisos em tempo real (Server-Sent Events) ----
  const ouvintes = new Set();
  let avisoPendente = null;
  let mudouDesdeBackup = false;
  function aoMudar() {
    mudouDesdeBackup = true;
    if (avisoPendente) return;
    avisoPendente = setTimeout(() => {
      avisoPendente = null;
      for (const res of ouvintes) res.write('data: mudou\n\n');
    }, 150);
  }

  const vendas = criarVendas(db, aoMudar);
  const catalogo = criarCatalogo(db, aoMudar);
  const backup = criarBackup(db, pastaDados, () => lerConfig(db).backup_pasta);

  // ---- Rotas ----
  const rotas = [];
  function rota(metodo, padrao, papeis, fn) {
    const re = new RegExp('^' + padrao.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
    rotas.push({ metodo, re, papeis, fn });
  }

  // Sessão
  rota('GET', '/api/login/usuarios', null, () => ({
    nome_evento: lerConfig(db).nome_evento,
    usuarios: db.prepare(`SELECT id, nome, papel FROM usuarios WHERE ativo = 1
                          ORDER BY CASE papel WHEN 'vendedor' THEN 1 WHEN 'caixa' THEN 2 ELSE 3 END, nome`).all(),
  }));

  rota('POST', '/api/login', null, ({ corpo, res }) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ? AND ativo = 1').get(Number(corpo.usuario_id));
    if (!u || !conferePin(corpo.pin, u.pin)) throw new ErroHttp(400, 'PIN incorreto.');
    const token = novoToken();
    db.prepare('INSERT INTO sessoes (token, usuario_id, criado_em) VALUES (?, ?, ?)').run(token, u.id, Date.now());
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${DURACAO_SESSAO_MS / 1000}`);
    return { id: u.id, nome: u.nome, papel: u.papel };
  });

  rota('POST', '/api/logout', TODOS, ({ req, res }) => {
    db.prepare('DELETE FROM sessoes WHERE token = ?').run(lerCookies(req).sid ?? '');
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    return { ok: true };
  });

  rota('GET', '/api/eu', TODOS, ({ usuario }) => usuario);

  rota('GET', '/api/config', TODOS, () => {
    const c = lerConfig(db);
    return {
      nome_evento: c.nome_evento,
      reserva_minutos: Number(c.reserva_minutos),
      tipos: catalogo.listarTipos(),
      cidades: catalogo.listarCidades(),
      servidor_agora: Date.now(),
    };
  });

  rota('GET', '/api/eventos', TODOS, ({ res }) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    ouvintes.add(res);
    res.on('close', () => ouvintes.delete(res));
    return SEM_RESPOSTA;
  });

  // Móveis e estoque (consulta, todos os papéis)
  rota('GET', '/api/moveis', TODOS, ({ query }) => {
    vendas.expirarVencidos();
    return catalogo.listarMoveis(query);
  });
  rota('GET', '/api/moveis/:codigo', TODOS, ({ params }) => {
    vendas.expirarVencidos();
    const m = buscarMovel(db, Number(params.codigo));
    if (!m) throw new ErroHttp(404, `Não existe móvel com o número ${codigoFmt(params.codigo)}.`);
    return m;
  });
  rota('GET', '/api/estoque', TODOS, () => {
    vendas.expirarVencidos();
    return relatorios.estoquePorTipo(db);
  });

  // Venda em andamento do vendedor logado
  rota('GET', '/api/rascunho', TODOS, ({ usuario }) => vendas.rascunho(usuario.id));
  rota('POST', '/api/rascunho/itens', TODOS, ({ usuario, corpo }) => vendas.reservar(usuario, corpo.codigo));
  rota('POST', '/api/rascunho/finalizar', TODOS, ({ usuario, corpo }) => vendas.finalizar(usuario, corpo));
  rota('POST', '/api/rascunho/descartar', TODOS, ({ usuario }) => vendas.descartar(usuario));
  rota('GET', '/api/meus-pedidos', TODOS, ({ usuario }) => vendas.listarPedidos({ vendedor_id: usuario.id, limite: 100 }));

  // Pedidos
  rota('GET', '/api/pedidos', CAIXA, ({ query }) => vendas.listarPedidos(query));
  rota('GET', '/api/pedidos/:id', TODOS, ({ usuario, params }) => {
    vendas.expirarVencidos();
    const p = vendas.exigirPedido(params.id);
    vendas.podeVer(usuario, p);
    return p;
  });
  rota('PUT', '/api/pedidos/:id/cliente', TODOS, ({ usuario, params, corpo }) => vendas.atualizarCliente(usuario, params.id, corpo));
  rota('DELETE', '/api/pedidos/:id/itens/:codigo', TODOS, ({ usuario, params }) => vendas.removerItem(usuario, params.id, params.codigo));
  rota('POST', '/api/pedidos/:id/cancelar', TODOS, ({ usuario, params }) => vendas.cancelar(usuario, params.id));
  rota('POST', '/api/pedidos/:id/reativar', CAIXA, ({ usuario, params }) => vendas.reativar(usuario, params.id));
  rota('POST', '/api/pedidos/:id/pagar', CAIXA, ({ usuario, params, corpo }) => vendas.pagar(usuario, params.id, corpo));
  rota('POST', '/api/pedidos/:id/entrega', ADMIN, ({ usuario, params, corpo }) => vendas.marcarEntrega(usuario, params.id, Boolean(corpo.entregue)));

  rota('POST', '/api/pedidos/:id/comprovantes', CAIXA, ({ usuario, params, corpo }) => {
    const p = vendas.exigirPedido(params.id);
    const ext = EXTENSAO_IMAGEM[corpo.tipo];
    if (!corpo.buffer?.length || !ext) throw new ErroHttp(400, 'Envie uma foto (JPG, PNG ou WEBP).');
    const arquivo = `pedido-${p.id}-${Date.now()}${ext}`;
    fs.writeFileSync(path.join(pastaComprovantes, arquivo), corpo.buffer);
    return vendas.adicionarComprovante(usuario, p.id, arquivo);
  });
  rota('GET', '/api/comprovantes/:id', CAIXA, ({ params, res }) => {
    const c = db.prepare('SELECT arquivo FROM comprovantes WHERE id = ?').get(Number(params.id));
    if (!c) throw new ErroHttp(404, 'Comprovante não encontrado.');
    const tipo = Object.entries(EXTENSAO_IMAGEM).find(([, ext]) => c.arquivo.endsWith(ext))?.[0] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'private, max-age=86400' });
    res.end(fs.readFileSync(path.join(pastaComprovantes, path.basename(c.arquivo))));
    return SEM_RESPOSTA;
  });

  // Relatórios
  rota('GET', '/api/relatorios/resumo', CAIXA, () => {
    vendas.expirarVencidos();
    return relatorios.resumo(db);
  });
  rota('GET', '/api/relatorios/romaneio', ADMIN, ({ query }) => relatorios.romaneio(db, vendas, { pendentes: query.pendentes !== '0' }));
  rota('GET', '/api/relatorios/final', ADMIN, () => {
    vendas.expirarVencidos();
    return relatorios.relatorioFinal(db, vendas);
  });
  rota('GET', '/api/relatorios/vendas.csv', ADMIN, ({ res }) => {
    const nome = `vendas-bazar-${new Date().toISOString().slice(0, 10)}.csv`;
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}"` });
    res.end(relatorios.vendasCsv(db));
    return SEM_RESPOSTA;
  });

  // Administração: móveis e etiquetas
  rota('POST', '/api/admin/etiquetas', ADMIN, ({ corpo }) => catalogo.gerarEtiquetas(corpo.quantidade));
  rota('POST', '/api/admin/moveis/lote', ADMIN, ({ corpo }) => catalogo.cadastrarLote(corpo));
  rota('PUT', '/api/admin/moveis/:codigo', ADMIN, ({ params, corpo }) => catalogo.atualizarMovel(params.codigo, corpo));

  // Administração: cadastros
  rota('POST', '/api/admin/tipos', ADMIN, ({ corpo }) => catalogo.criarTipo(corpo.nome));
  rota('PUT', '/api/admin/tipos/:id', ADMIN, ({ params, corpo }) => catalogo.renomearTipo(params.id, corpo.nome));
  rota('DELETE', '/api/admin/tipos/:id', ADMIN, ({ params }) => catalogo.excluirTipo(params.id));
  rota('POST', '/api/admin/cidades', ADMIN, ({ corpo }) => catalogo.criarCidade(corpo.nome));
  rota('PUT', '/api/admin/cidades/:id', ADMIN, ({ params, corpo }) => catalogo.renomearCidade(params.id, corpo.nome));
  rota('DELETE', '/api/admin/cidades/:id', ADMIN, ({ params }) => catalogo.excluirCidade(params.id));
  rota('GET', '/api/admin/usuarios', ADMIN, () => catalogo.listarUsuarios());
  rota('POST', '/api/admin/usuarios', ADMIN, ({ corpo }) => catalogo.criarUsuario(corpo));
  rota('PUT', '/api/admin/usuarios/:id', ADMIN, ({ params, corpo }) => catalogo.atualizarUsuario(params.id, corpo));
  rota('GET', '/api/admin/config', ADMIN, () => lerConfig(db));
  rota('PUT', '/api/admin/config', ADMIN, ({ corpo }) => catalogo.salvarConfig(corpo));

  // Administração: backup e acesso
  rota('GET', '/api/admin/backup', ADMIN, () => backup.ultimo());
  rota('POST', '/api/admin/backup', ADMIN, () => {
    mudouDesdeBackup = false;
    return backup.fazer();
  });
  rota('GET', '/api/admin/acesso', ADMIN, async () => {
    const c = lerConfig(db);
    const porta = servidor.address()?.port;
    const enderecos = await Promise.all(enderecosLocais(porta).map(async (url) => ({
      url,
      qr: await QRCode.toString(url, { type: 'svg', margin: 1 }),
    })));
    const wifi = c.wifi_nome
      ? { nome: c.wifi_nome, senha: c.wifi_senha, qr: await QRCode.toString(textoWifi(c.wifi_nome, c.wifi_senha), { type: 'svg', margin: 1 }) }
      : null;
    return { nome_evento: c.nome_evento, enderecos, wifi };
  });

  // ---- Infraestrutura HTTP ----
  function lerCookies(req) {
    return Object.fromEntries((req.headers.cookie ?? '').split(';').map((p) => p.trim().split('=')).filter(([k]) => k));
  }

  function usuarioDaSessao(req) {
    const token = lerCookies(req).sid;
    if (!token) return null;
    return db.prepare(`SELECT u.id, u.nome, u.papel FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
                       WHERE s.token = ? AND u.ativo = 1 AND s.criado_em > ?`).get(token, Date.now() - DURACAO_SESSAO_MS) ?? null;
  }

  function lerCorpo(req) {
    return new Promise((resolve, reject) => {
      const partes = [];
      let tamanho = 0;
      req.on('data', (parte) => {
        tamanho += parte.length;
        if (tamanho > LIMITE_CORPO) {
          reject(new ErroHttp(413, 'Arquivo grande demais.'));
          req.destroy();
          return;
        }
        partes.push(parte);
      });
      req.on('end', () => {
        const buffer = Buffer.concat(partes);
        const tipo = (req.headers['content-type'] ?? '').split(';')[0].trim();
        if (tipo === 'application/json') {
          try {
            resolve(buffer.length ? JSON.parse(buffer.toString('utf8')) : {});
          } catch {
            reject(new ErroHttp(400, 'JSON inválido.'));
          }
        } else if (tipo.startsWith('image/')) {
          resolve({ buffer, tipo });
        } else {
          resolve({});
        }
      });
      req.on('error', reject);
    });
  }

  function enviarJson(res, status, dados) {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(dados));
  }

  function servirEstatico(caminho, res) {
    if (caminho === '/') caminho = '/index.html';
    const arquivo = path.normalize(path.join(pastaPublica, decodeURIComponent(caminho)));
    if (!arquivo.startsWith(pastaPublica + path.sep)) throw new ErroHttp(404, 'Não encontrado.');
    fs.readFile(arquivo, (erro, dados) => {
      if (erro) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Página não encontrada.');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(arquivo)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(dados);
    });
  }

  async function tratar(req, res) {
    try {
      const url = new URL(req.url, 'http://bazar.local');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErroHttp(405, 'Método não permitido.');
        return servirEstatico(url.pathname, res);
      }
      const r = rotas.find((x) => x.metodo === req.method && x.re.test(url.pathname));
      if (!r) throw new ErroHttp(404, 'Rota não encontrada.');
      let usuario = null;
      if (r.papeis) {
        usuario = usuarioDaSessao(req);
        if (!usuario) throw new ErroHttp(401, 'Faça login novamente.');
        if (!r.papeis.includes(usuario.papel)) throw new ErroHttp(403, 'Você não tem permissão para isso.');
      }
      const corpo = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await lerCorpo(req) : {};
      const resultado = await r.fn({
        req, res, usuario, corpo,
        params: url.pathname.match(r.re).groups ?? {},
        query: Object.fromEntries(url.searchParams),
      });
      if (resultado === SEM_RESPOSTA) return;
      enviarJson(res, 200, resultado === undefined ? { ok: true } : resultado);
    } catch (e) {
      const erro = e instanceof ErroHttp ? e : traduzirErroBanco(e);
      if (erro) return enviarJson(res, erro.status, { erro: erro.message });
      console.error(e);
      enviarJson(res, 500, { erro: `Erro interno: ${e.message}` });
    }
  }

  const servidor = http.createServer(tratar);

  // ---- Rotinas periódicas ----
  const intervalos = [];
  function fazerBackupSeMudou() {
    if (!mudouDesdeBackup) return;
    mudouDesdeBackup = false;
    try {
      const r = backup.fazer();
      if (r.erro_extra) console.warn(`[backup] ${r.erro_extra}`);
    } catch (e) {
      console.error('[backup] falhou:', e.message);
    }
  }
  if (timers) {
    intervalos.push(setInterval(() => vendas.expirarVencidos(), 15_000));
    intervalos.push(setInterval(() => { for (const res of ouvintes) res.write(': ping\n\n'); }, 20_000));
    intervalos.push(setInterval(fazerBackupSeMudou, 3 * 60_000));
  }

  async function fechar({ comBackup = false } = {}) {
    intervalos.forEach(clearInterval);
    clearTimeout(avisoPendente);
    if (comBackup) {
      mudouDesdeBackup = true;
      fazerBackupSeMudou();
    }
    for (const res of ouvintes) res.end();
    servidor.closeAllConnections?.();
    await new Promise((resolve) => servidor.close(() => resolve()));
    db.close();
  }

  return { servidor, db, vendas, catalogo, backup, fechar };
}
