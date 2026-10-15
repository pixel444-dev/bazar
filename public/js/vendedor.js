import {
  api, aviso, esc, reais, codigo, hora, iniciarPagina, ouvirMudancas, ativarAbas, camposCliente, lerFormulario,
  seloStatus, seloMovel, descricaoMovel, atualizarContadores,
} from './comum.js';

const { usuario, config } = await iniciarPagina({ titulo: 'Vender' });
const $ = (s) => document.querySelector(s);

let rascunho = null;
let etapa = 'itens';
let aba = 'vender';
let tipoAberto = null;

const formCliente = $('#etapa-cliente');
formCliente.querySelector('.campos').innerHTML = camposCliente(config.cidades);

// ---------- Etapas da venda ----------

function mostrarEtapa(nova) {
  etapa = nova;
  $('#etapa-itens').hidden = nova !== 'itens';
  formCliente.hidden = nova !== 'cliente';
  $('#etapa-pronto').hidden = nova !== 'pronto';
  window.scrollTo(0, 0);
}

function mensagemCodigo(textoMsg, tipo) {
  const el = $('#mensagem-codigo');
  el.textContent = textoMsg;
  el.className = `mensagem ${tipo}`;
  el.hidden = !textoMsg;
}

function desenharCarrinho() {
  const el = $('#carrinho');
  if (!rascunho?.itens.length) {
    el.innerHTML = '';
    return;
  }
  const qtd = rascunho.itens.length;
  el.innerHTML = `
    <div class="cartao">
      <div class="linha-topo">
        <h2>Venda em andamento</h2>
        <span class="contador" data-expira="${rascunho.expira_em}"></span>
      </div>
      <ul class="itens">
        ${rascunho.itens.map((i) => `
          <li>
            <span class="cod">${codigo(i.codigo)}</span>
            <span class="desc">${descricaoMovel(i)}</span>
            <strong>${reais(i.preco_centavos)}</strong>
            <button class="botao-icone" data-remover="${i.codigo}" aria-label="Tirar o ${codigo(i.codigo)} da venda">✕</button>
          </li>`).join('')}
      </ul>
      <div class="total"><span>Total (${qtd} ${qtd === 1 ? 'móvel' : 'móveis'})</span><strong>${reais(rascunho.total_centavos)}</strong></div>
      <button class="botao primario grande" id="ir-cliente">Continuar: dados do cliente</button>
      <button class="botao perigo-texto largo" id="descartar">Cancelar venda e liberar os móveis</button>
    </div>`;
  atualizarContadores();
}

async function carregarRascunho() {
  rascunho = await api('GET', '/api/rascunho');
  if (etapa === 'cliente' && !rascunho?.itens.length) {
    mostrarEtapa('itens');
    aviso('A reserva expirou ou foi cancelada. Reserve os móveis de novo.', 'erro', 8000);
  }
  if (rascunho) {
    const qtd = rascunho.itens.length;
    $('#resumo-cliente').textContent = `${qtd} ${qtd === 1 ? 'móvel' : 'móveis'} · ${reais(rascunho.total_centavos)}`;
    $('#contador-cliente').dataset.expira = rascunho.expira_em;
  }
  desenharCarrinho();
}

$('#form-codigo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const valor = $('#codigo').value.trim().replace(/\D/g, '');
  if (!valor) return;
  const botao = e.submitter;
  botao.disabled = true;
  try {
    rascunho = await api('POST', '/api/rascunho/itens', { codigo: Number(valor) });
    const item = rascunho.itens.find((i) => i.codigo === Number(valor));
    mensagemCodigo(`✓ ${codigo(valor)} reservado: ${item?.tipo_nome ?? ''} ${reais(item?.preco_centavos)}`, 'ok');
    $('#codigo').value = '';
    desenharCarrinho();
  } catch (erro) {
    mensagemCodigo(erro.message, 'erro');
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  } finally {
    botao.disabled = false;
    $('#codigo').focus();
  }
});

$('#carrinho').addEventListener('click', async (e) => {
  const remover = e.target.closest('[data-remover]');
  if (remover) {
    try {
      rascunho = await api('DELETE', `/api/pedidos/${rascunho.id}/itens/${remover.dataset.remover}`);
      mensagemCodigo(`${codigo(remover.dataset.remover)} liberado.`, 'info');
      desenharCarrinho();
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
  } else if (e.target.closest('#ir-cliente')) {
    mensagemCodigo('', '');
    mostrarEtapa('cliente');
    formCliente.querySelector('[name=cliente_nome]')?.focus();
  } else if (e.target.closest('#descartar')) {
    if (!confirm('Cancelar esta venda? Os móveis voltam a ficar disponíveis.')) return;
    try {
      await api('POST', '/api/rascunho/descartar');
      rascunho = null;
      mensagemCodigo('Venda cancelada. Os móveis estão livres de novo.', 'info');
      desenharCarrinho();
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
  }
});

$('#voltar-itens').addEventListener('click', () => mostrarEtapa('itens'));

formCliente.addEventListener('submit', async (e) => {
  e.preventDefault();
  const botao = e.submitter;
  botao.disabled = true;
  try {
    const pedido = await api('POST', '/api/rascunho/finalizar', lerFormulario(formCliente));
    rascunho = null;
    formCliente.reset();
    mostrarPronto(pedido);
  } catch (erro) {
    aviso(erro.message, 'erro', 7000);
  } finally {
    botao.disabled = false;
  }
});

function mostrarPronto(p) {
  $('#etapa-pronto').innerHTML = `
    <div class="cartao destaque">
      <p><strong>Venda registrada!</strong></p>
      <p>Mande o cliente ao <strong>CAIXA</strong> e diga o número do pedido:</p>
      <div class="numero-pedido">${p.id}</div>
      <p>${esc(p.cliente_nome)} · ${p.itens.length} ${p.itens.length === 1 ? 'móvel' : 'móveis'} · <strong>${reais(p.total_centavos)}</strong></p>
      <p class="dica">Se não pagar até ${hora(p.expira_em)}, os móveis voltam a ficar disponíveis.</p>
      <button class="botao primario grande" id="nova-venda">Nova venda</button>
    </div>`;
  mostrarEtapa('pronto');
  $('#nova-venda').addEventListener('click', () => {
    mensagemCodigo('', '');
    desenharCarrinho();
    mostrarEtapa('itens');
    $('#codigo').focus();
  });
}

// ---------- Minhas vendas ----------

async function carregarMinhas() {
  const lista = await api('GET', '/api/meus-pedidos');
  const pagos = lista.filter((p) => p.status === 'pago');
  const resumo = `<div class="estatisticas">
      <div class="estatistica principal"><small>Vendas pagas</small><strong>${pagos.length}</strong></div>
      <div class="estatistica"><small>Total vendido</small><strong>${reais(pagos.reduce((s, p) => s + p.total_centavos, 0))}</strong></div>
    </div>`;
  $('#lista-minhas').innerHTML = resumo + (lista.length
    ? lista.map((p) => `
      <article class="cartao">
        <div class="linha-topo"><strong>Pedido #${p.id}</strong>${seloStatus(p.status)}</div>
        <p>${esc(p.cliente_nome)} · ${esc(p.bairro)}, ${esc(p.cidade_nome)}</p>
        <div class="linha-topo">
          <span>${p.qtd_itens} ${p.qtd_itens === 1 ? 'móvel' : 'móveis'} · <strong>${reais(p.total_centavos)}</strong></span>
          <small>${hora(p.finalizado_em)}</small>
        </div>
        ${p.status === 'aguardando' ? `
          <div class="linha-topo" style="margin-top:8px">
            <span class="contador" data-expira="${p.expira_em}"></span>
            <button class="botao pequeno perigo-texto" data-cancelar="${p.id}">Cliente desistiu</button>
          </div>` : ''}
      </article>`).join('')
    : '<p class="vazio">Você ainda não finalizou nenhuma venda.</p>');
  atualizarContadores();
}

$('#lista-minhas').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cancelar]');
  if (!b || !confirm(`Cancelar o pedido #${b.dataset.cancelar}? Os móveis voltam a ficar disponíveis.`)) return;
  try {
    await api('POST', `/api/pedidos/${b.dataset.cancelar}/cancelar`);
    aviso('Pedido cancelado.', 'ok');
    carregarMinhas();
  } catch (erro) {
    aviso(erro.message, 'erro');
  }
});

// ---------- Estoque ----------

async function carregarEstoque() {
  const tipos = await api('GET', '/api/estoque');
  let disponiveis = [];
  if (tipoAberto) disponiveis = await api('GET', `/api/moveis?tipo_id=${tipoAberto}&status=disponivel`);
  $('#lista-estoque').innerHTML = tipos.length
    ? tipos.map((t) => `
      <button class="tipo-linha" data-tipo="${t.id}" aria-expanded="${t.id === tipoAberto}">
        <span>${esc(t.nome)}</span>
        <span><strong class="${t.disponiveis ? '' : 'zero'}">${t.disponiveis}</strong> <small>de ${t.total}</small></span>
      </button>
      ${t.id === tipoAberto ? `<div class="chips">${disponiveis.length
        ? disponiveis.map((m) => `<button class="chip" data-usar="${m.codigo}"><b>${codigo(m.codigo)}</b> ${reais(m.preco_centavos)}${m.descricao ? ` · ${esc(m.descricao)}` : ''}</button>`).join('')
        : '<span class="suave">Nenhum disponível.</span>'}</div>` : ''}`).join('')
    : '<p class="vazio">Nenhum móvel cadastrado ainda.</p>';
}

$('#lista-estoque').addEventListener('click', (e) => {
  const usar = e.target.closest('[data-usar]');
  if (usar) {
    $('#codigo').value = codigo(usar.dataset.usar);
    mostrarAba('vender');
    mostrarEtapa('itens');
    mensagemCodigo('Confira com o cliente e toque em Reservar.', 'info');
    return;
  }
  const t = e.target.closest('[data-tipo]');
  if (!t) return;
  tipoAberto = tipoAberto === Number(t.dataset.tipo) ? null : Number(t.dataset.tipo);
  carregarEstoque().catch((erro) => aviso(erro.message, 'erro'));
});

$('#form-consulta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const valor = $('#consulta').value.replace(/\D/g, '');
  const el = $('#resultado-consulta');
  try {
    const m = await api('GET', `/api/moveis/${Number(valor)}`);
    el.innerHTML = `<div class="bloco">
      <div class="linha-topo"><span><span class="cod">${codigo(m.codigo)}</span> ${descricaoMovel(m)}</span>${seloMovel(m.status)}</div>
      ${m.preco_centavos ? `<p><strong>${reais(m.preco_centavos)}</strong></p>` : ''}
      ${m.status === 'reservado' ? `<p class="suave">Reservado por ${esc(m.vendedor_nome)} (pedido #${m.pedido_id})</p>` : ''}
      ${m.status === 'vendido' ? `<p class="suave">Vendido no pedido #${m.pedido_id}</p>` : ''}
    </div>`;
  } catch (erro) {
    el.innerHTML = `<p class="mensagem erro">${esc(erro.message)}</p>`;
  }
});

// ---------- Ranking ----------

const MEDALHA = { 1: '🥇', 2: '🥈', 3: '🥉' };
let posicoesAntes = null; // id → posição no último ranking recebido

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function cartaoMinhaPosicao(lista, eu) {
  if (!eu) return '';
  if (!eu.total) {
    return `<div class="cartao minha-posicao"><p><strong>Você ainda não tem venda paga.</strong></p>
      <p class="suave">A primeira venda paga no caixa já coloca você no ranking.</p></div>`;
  }
  const lugar = `${eu.posicao}º lugar`;
  const empatados = lista.filter((v) => v.id !== eu.id && v.total === eu.total);
  let detalhe;
  if (empatados.length) {
    detalhe = `Empatado com ${empatados.map((v) => esc(v.nome)).join(', ')}. Mais uma venda e você passa!`;
  } else if (eu.posicao === 1) {
    const segundo = lista.find((v) => v.total < eu.total);
    detalhe = segundo ? `${reais(eu.total - segundo.total)} à frente de ${esc(segundo.nome)}.` : 'Ninguém mais vendeu ainda.';
  } else {
    const frente = lista.findLast((v) => v.total > eu.total);
    detalhe = `Faltam <strong>${reais(frente.total - eu.total)}</strong> para alcançar ${esc(frente.nome)} (${frente.posicao}º).`;
  }
  return `<div class="cartao minha-posicao ${eu.posicao === 1 ? 'lider' : ''}">
    <div class="linha-topo">
      <span class="lugar">${MEDALHA[eu.posicao] ?? ''} Você está em ${lugar}</span>
      <strong>${reais(eu.total)}</strong>
    </div>
    <p>${detalhe}</p>
  </div>`;
}

function desenharRanking(lista, eu) {
  $('#minha-posicao').innerHTML = cartaoMinhaPosicao(lista, eu);
  const maior = lista[0]?.total || 1;
  $('#lista-ranking').innerHTML = lista.length
    ? lista.map((v) => {
      const subiu = posicoesAntes?.has(v.id) && v.posicao < posicoesAntes.get(v.id);
      return `
      <li class="${v.id === eu?.id ? 'eu' : ''} ${subiu ? 'subiu' : ''}">
        <span class="posicao">${v.total ? MEDALHA[v.posicao] ?? `${v.posicao}º` : '–'}</span>
        <span class="nome">
          ${esc(v.nome)}${v.id === eu?.id ? ' <small>(você)</small>' : ''}
          <span class="barra-progresso"><span style="width:${(v.total / maior) * 100}%"></span></span>
          <small>${plural(v.itens, 'móvel', 'móveis')} · ${plural(v.pedidos, 'venda', 'vendas')}</small>
        </span>
        <strong>${reais(v.total)}</strong>
      </li>`;
    }).join('')
    : '<p class="vazio">Nenhum vendedor cadastrado.</p>';
}

async function carregarRanking() {
  const lista = await api('GET', '/api/ranking');
  const eu = lista.find((v) => v.id === usuario.id);
  const antes = posicoesAntes?.get(usuario.id);
  if (eu?.total && antes && eu.posicao < antes) aviso(`🎉 Você subiu para ${eu.posicao}º lugar no ranking!`, 'ok', 6000);
  if (aba === 'ranking') desenharRanking(lista, eu);
  posicoesAntes = new Map(lista.map((v) => [v.id, v.posicao]));
}

// ---------- Atualização ----------

async function atualizar() {
  try {
    if (etapa !== 'pronto' || aba !== 'vender') await carregarRascunho();
    if (aba === 'minhas') await carregarMinhas();
    if (aba === 'estoque') await carregarEstoque();
    // Sempre, para avisar quando o vendedor sobe de posição mesmo fora da aba.
    await carregarRanking();
  } catch (erro) {
    if (erro.status !== 401) aviso(erro.message, 'erro');
  }
}

const mostrarAba = ativarAbas((nome) => {
  aba = nome;
  atualizar();
});
ouvirMudancas(atualizar);
