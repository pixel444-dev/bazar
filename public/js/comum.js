// Funções compartilhadas por todas as telas.

export const ROTULO_STATUS = {
  rascunho: 'Em andamento',
  aguardando: 'Aguardando pagamento',
  pago: 'Pago',
  cancelado: 'Cancelado',
  expirado: 'Expirado',
};
export const ROTULO_MOVEL = { sem_cadastro: 'Sem cadastro', disponivel: 'Disponível', reservado: 'Reservado', vendido: 'Vendido' };
export const ROTULO_FORMA = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão' };
export const ROTULO_PAPEL = { vendedor: 'Vendedor', caixa: 'Caixa', admin: 'Administrador' };
export const PAGINA_INICIAL = { vendedor: '/vendedor.html', caixa: '/caixa.html', admin: '/admin.html' };

// Diferença entre o relógio do celular e o do notebook central, para os contadores de reserva.
let diferencaRelogio = 0;
export const agora = () => Date.now() + diferencaRelogio;

export class ErroApi extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status;
  }
}

export async function api(metodo, url, corpo) {
  const init = { method: metodo, headers: {} };
  if (corpo instanceof Blob) {
    init.body = corpo;
    init.headers['Content-Type'] = corpo.type || 'application/octet-stream';
  } else if (corpo !== undefined) {
    init.body = JSON.stringify(corpo);
    init.headers['Content-Type'] = 'application/json';
  }
  let r;
  try {
    r = await fetch(url, init);
  } catch {
    throw new ErroApi('Sem conexão com a central. Confira se você está no Wi-Fi do bazar.', 0);
  }
  const ehJson = (r.headers.get('content-type') || '').includes('application/json');
  const dados = ehJson ? await r.json() : await r.text();
  if (r.status === 401 && location.pathname !== '/' && location.pathname !== '/index.html') {
    location.href = '/';
  }
  if (!r.ok) throw new ErroApi(dados?.erro || `Erro ${r.status}`, r.status);
  return dados;
}

// ---------- Formatação ----------

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const reais = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const codigo = (n) => String(n).padStart(3, '0');
export const hora = (ms) => (ms ? new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
export const dataHora = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
export const centavosParaTexto = (c) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');

// "150" → 15000, "150,50" → 15050, "1.500" → 150000, "" → 0, lixo → NaN
export function paraCentavos(valor) {
  let s = String(valor ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

export function telefoneFmt(t) {
  const d = String(t ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

export function enderecoFmt(p) {
  return [`${p.rua ?? ''}, ${p.numero ?? ''}`, p.complemento, p.bairro, p.cidade_nome].filter(Boolean).join(' · ');
}

export const seloStatus = (status) => `<span class="selo ${status}">${ROTULO_STATUS[status] ?? status}</span>`;
export const seloMovel = (status) => `<span class="selo ${status}">${ROTULO_MOVEL[status] ?? status}</span>`;

export function descricaoMovel(m) {
  return `${esc(m.tipo_nome ?? 'Sem tipo')}${m.descricao ? ` <small>${esc(m.descricao)}</small>` : ''}`;
}

// ---------- Avisos ----------

export function aviso(mensagem, tipo = 'info', duracao = 4000) {
  let caixa = document.getElementById('avisos');
  if (!caixa) {
    caixa = document.createElement('div');
    caixa.id = 'avisos';
    document.body.append(caixa);
  }
  const el = document.createElement('div');
  el.className = `aviso ${tipo}`;
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  el.textContent = mensagem;
  el.addEventListener('click', () => el.remove());
  caixa.append(el);
  if (tipo === 'erro' && navigator.vibrate) navigator.vibrate([120, 60, 120]);
  setTimeout(() => el.remove(), duracao);
}

// ---------- Tempo real ----------

function marcarConexao(ok) {
  document.body.classList.toggle('desconectado', !ok);
  const el = document.getElementById('conexao');
  if (el) el.title = ok ? 'Conectado à central' : 'Sem conexão com a central';
}

export function ouvirMudancas(aoMudar) {
  let espera;
  const disparar = () => {
    clearTimeout(espera);
    espera = setTimeout(aoMudar, 120);
  };
  const fonte = new EventSource('/api/eventos');
  fonte.onmessage = disparar;
  fonte.onopen = () => {
    marcarConexao(true);
    disparar();
  };
  fonte.onerror = () => marcarConexao(false);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) disparar();
  });
}

// Contadores "Reserva: 12:34" em qualquer elemento com data-expira.
export function atualizarContadores() {
  for (const el of document.querySelectorAll('[data-expira]')) {
    const ms = Number(el.dataset.expira) - agora();
    if (ms <= 0) {
      el.textContent = 'Reserva expirada';
      el.classList.add('urgente');
      continue;
    }
    const s = Math.ceil(ms / 1000);
    el.textContent = `Reserva: ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.classList.toggle('urgente', ms < 5 * 60_000);
  }
}
setInterval(atualizarContadores, 1000);

// ---------- Página ----------

function montarTopo(usuario, titulo, config) {
  const topo = document.getElementById('topo');
  if (!topo) return;
  const links = [];
  if (usuario.papel !== 'vendedor') links.push(['/vendedor.html', 'Vender'], ['/caixa.html', 'Caixa']);
  if (usuario.papel === 'admin') links.push(['/admin.html', 'Admin']);
  topo.className = 'topo';
  topo.innerHTML = `
    <div class="topo-titulo">
      <span id="conexao" class="conexao" title="Conectado à central"></span>
      <div><strong>${esc(titulo)}</strong><small>${esc(config.nome_evento)}</small></div>
    </div>
    <nav class="topo-nav">
      ${links.map(([href, nome]) => `<a href="${href}" ${location.pathname === href ? 'aria-current="page"' : ''}>${nome}</a>`).join('')}
      <span class="topo-usuario">${esc(usuario.nome)}</span>
      <button id="sair" class="botao pequeno secundario">Sair</button>
    </nav>`;
  document.getElementById('sair').addEventListener('click', async () => {
    await api('POST', '/api/logout').catch(() => {});
    location.href = '/';
  });
}

export async function iniciarPagina({ titulo, papeis }) {
  let usuario;
  try {
    usuario = await api('GET', '/api/eu');
  } catch (e) {
    if (e.status !== 401) document.body.innerHTML = `<main><div class="mensagem erro">${esc(e.message)}</div><button class="botao primario" onclick="location.reload()">Tentar de novo</button></main>`;
    throw e;
  }
  if (papeis && !papeis.includes(usuario.papel)) {
    location.href = PAGINA_INICIAL[usuario.papel];
    throw new Error('Sem permissão para esta página.');
  }
  const config = await api('GET', '/api/config');
  diferencaRelogio = config.servidor_agora - Date.now();
  document.title = `${titulo} · ${config.nome_evento}`;
  montarTopo(usuario, titulo, config);
  return { usuario, config };
}

// Abas: botões com data-aba="x" mostram a seção com data-painel="x".
export function ativarAbas(aoTrocar) {
  const botoes = [...document.querySelectorAll('[data-aba]')];
  const chave = `aba:${location.pathname}`;
  function mostrar(nome) {
    for (const b of botoes) b.classList.toggle('ativa', b.dataset.aba === nome);
    for (const s of document.querySelectorAll('[data-painel]')) s.hidden = s.dataset.painel !== nome;
    try { sessionStorage.setItem(chave, nome); } catch { /* sem armazenamento */ }
    aoTrocar?.(nome);
  }
  for (const b of botoes) b.addEventListener('click', () => mostrar(b.dataset.aba));
  let inicial = null;
  try { inicial = sessionStorage.getItem(chave); } catch { /* sem armazenamento */ }
  mostrar(botoes.some((b) => b.dataset.aba === inicial) ? inicial : botoes[0].dataset.aba);
  return mostrar;
}

// ---------- Cliente ----------

export function camposCliente(cidades, v = {}) {
  const val = (k) => esc(v[k] ?? '');
  if (!cidades.length) {
    return '<p class="mensagem erro">Nenhuma cidade de entrega cadastrada. Peça ao administrador para cadastrar.</p>';
  }
  return `
    <label>Nome do cliente
      <input name="cliente_nome" required autocomplete="off" autocapitalize="words" value="${val('cliente_nome')}">
    </label>
    <label>Telefone com DDD
      <input name="telefone" type="tel" inputmode="tel" required autocomplete="off" placeholder="(19) 98765-4321" value="${esc(telefoneFmt(v.telefone))}">
    </label>
    <label>Cidade
      <select name="cidade_id" required>
        <option value="">Escolha a cidade…</option>
        ${cidades.map((c) => `<option value="${c.id}" ${c.id === v.cidade_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
      </select>
    </label>
    <label>Bairro
      <input name="bairro" required autocomplete="off" autocapitalize="words" value="${val('bairro')}">
    </label>
    <div class="duas-colunas">
      <label>Rua
        <input name="rua" required autocomplete="off" autocapitalize="words" value="${val('rua')}">
      </label>
      <label class="estreito">Número
        <input name="numero" required autocomplete="off" value="${val('numero')}">
      </label>
    </div>
    <label>Complemento / ponto de referência
      <input name="complemento" autocomplete="off" value="${val('complemento')}">
    </label>
    <label>Observação para a entrega
      <textarea name="observacao" rows="2">${val('observacao')}</textarea>
    </label>`;
}

export const lerFormulario = (form) => Object.fromEntries(new FormData(form));

// ---------- Impressão e fotos ----------

export function imprimirComprovante(pedidoId) {
  let quadro = document.getElementById('quadro-impressao');
  if (!quadro) {
    quadro = document.createElement('iframe');
    quadro.id = 'quadro-impressao';
    quadro.title = 'Impressão do comprovante';
    quadro.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.append(quadro);
  }
  quadro.src = `/imprimir/comprovante.html?pedido=${pedidoId}&auto=1&t=${Date.now()}`;
}

export async function reduzirImagem(arquivo, ladoMaximo = 1600) {
  const imagem = await createImageBitmap(arquivo);
  const escala = Math.min(1, ladoMaximo / Math.max(imagem.width, imagem.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(imagem.width * escala);
  canvas.height = Math.round(imagem.height * escala);
  canvas.getContext('2d').drawImage(imagem, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}
