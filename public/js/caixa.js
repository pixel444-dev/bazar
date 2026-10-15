import {
  api, aviso, esc, reais, codigo, hora, dataHora, iniciarPagina, ouvirMudancas, ativarAbas, camposCliente, lerFormulario,
  seloStatus, descricaoMovel, telefoneFmt, enderecoFmt, paraCentavos, centavosParaTexto, imprimirComprovante, reduzirImagem,
  atualizarContadores, ROTULO_FORMA,
} from './comum.js';

const { usuario, config } = await iniciarPagina({ titulo: 'Caixa', papeis: ['caixa', 'admin'] });
const $ = (s) => document.querySelector(s);

let filtro = 'aguardando';
let selecionado = null;
let ultimoDesenhado = '';
let editandoCliente = false;
let aba = 'pedidos';

// ---------- Lista ----------

async function carregarLista() {
  const busca = $('#busca').value.trim();
  const params = new URLSearchParams(busca ? { busca } : { status: filtro });
  const lista = await api('GET', `/api/pedidos?${params}`);
  $('#lista-pedidos').innerHTML = lista.length
    ? lista.map((p) => `
      <button class="pedido-item ${p.id === selecionado ? 'ativo' : ''}" data-id="${p.id}">
        <div class="linha-topo"><span class="num">#${p.id}</span>${seloStatus(p.status)}</div>
        <div>${esc(p.cliente_nome)}</div>
        <div class="linha-topo">
          <small>${esc(p.vendedor_nome)} · ${p.qtd_itens} ${p.qtd_itens === 1 ? 'móvel' : 'móveis'}</small>
          <strong>${reais(p.total_centavos)}</strong>
        </div>
        ${p.status === 'aguardando' ? `<span class="contador" data-expira="${p.expira_em}"></span>` : ''}
      </button>`).join('')
    : `<p class="vazio">${busca ? 'Nada encontrado.' : 'Nenhum pedido aqui.'}</p>`;
  atualizarContadores();
}

$('#filtros').addEventListener('click', (e) => {
  const b = e.target.closest('[data-status]');
  if (!b) return;
  filtro = b.dataset.status;
  $('#busca').value = '';
  for (const x of $('#filtros').children) x.classList.toggle('ativo', x === b);
  carregarLista().catch((erro) => aviso(erro.message, 'erro'));
});

$('#lista-pedidos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (b) abrir(Number(b.dataset.id), true);
});

$('#form-busca').addEventListener('submit', async (e) => {
  e.preventDefault();
  const busca = $('#busca').value.trim().replace(/^#/, '');
  if (/^\d{1,6}$/.test(busca)) {
    const abriu = await abrir(Number(busca), true);
    if (abriu) {
      $('#busca').value = '';
      $('#busca').focus();
    }
  }
  carregarLista().catch((erro) => aviso(erro.message, 'erro'));
});
$('#busca').addEventListener('input', () => {
  clearTimeout($('#busca')._espera);
  $('#busca')._espera = setTimeout(() => carregarLista().catch(() => {}), 250);
});

// ---------- Detalhe ----------

async function abrir(id, forcar = false) {
  try {
    const p = await api('GET', `/api/pedidos/${id}`);
    const json = JSON.stringify(p);
    if (!forcar && (json === ultimoDesenhado || editandoCliente)) return true;
    selecionado = id;
    ultimoDesenhado = json;
    editandoCliente = false;
    desenharDetalhe(p);
    for (const b of document.querySelectorAll('.pedido-item')) b.classList.toggle('ativo', Number(b.dataset.id) === id);
    return true;
  } catch (erro) {
    aviso(erro.message, 'erro');
    return false;
  }
}

function blocoCliente(p) {
  return `
    <div class="linha-topo"><h3>Entrega</h3>
      ${p.status !== 'cancelado' ? '<button class="botao pequeno secundario" id="editar-cliente">Corrigir dados</button>' : ''}
    </div>
    <p><strong>${esc(p.cliente_nome)}</strong> · ${esc(telefoneFmt(p.telefone))}</p>
    <p>${esc(enderecoFmt(p))}</p>
    ${p.observacao ? `<p class="suave">Obs.: ${esc(p.observacao)}</p>` : ''}`;
}

function formPagamento() {
  return `
    <form id="form-pagamento" class="pagamento" autocomplete="off">
      <h3>Como o cliente vai pagar?</h3>
      <div class="atalhos">
        <button type="button" class="botao secundario" data-tudo="dinheiro">Tudo em dinheiro</button>
        <button type="button" class="botao secundario" data-tudo="pix">Tudo no Pix</button>
        <button type="button" class="botao secundario" data-tudo="cartao">Tudo no cartão</button>
      </div>
      <div class="grade-pagamento">
        <label>Dinheiro<input name="dinheiro" inputmode="decimal" placeholder="0,00"></label>
        <label>Pix<input name="pix" inputmode="decimal" placeholder="0,00"></label>
        <label>Cartão<input name="cartao" inputmode="decimal" placeholder="0,00"></label>
      </div>
      <label class="recebido" hidden>Quanto o cliente entregou em dinheiro? (para calcular o troco)
        <input name="recebido" inputmode="decimal" placeholder="0,00">
      </label>
      <div class="conta" id="conta"></div>
      <button class="botao primario grande" id="confirmar" disabled>Confirmar pagamento</button>
    </form>`;
}

function blocoPago(p) {
  return `
    <div class="bloco">
      <h3>Pagamento</h3>
      ${p.pagamentos.map((x) => `<div class="linha-topo"><span>${ROTULO_FORMA[x.forma]}</span><strong>${reais(x.valor_centavos)}</strong></div>`).join('')}
      ${p.troco_centavos ? `<div class="linha-topo"><span>Recebido em dinheiro</span><span>${reais(p.pagamentos.filter((x) => x.forma === 'dinheiro').reduce((s, x) => s + x.valor_centavos, 0) + p.troco_centavos)}</span></div>
      <div class="linha-topo"><span>Troco dado</span><span>${reais(p.troco_centavos)}</span></div>` : ''}
      <p class="suave">Recebido por ${esc(p.caixa_nome)} às ${hora(p.pago_em)}${p.entregue ? ' · <strong>já entregue</strong>' : ''}</p>
      <button class="botao primario" id="imprimir">Imprimir comprovante</button>
    </div>`;
}

function blocoComprovantes(p) {
  return `
    <div class="bloco">
      <h3>Comprovantes de Pix</h3>
      ${p.comprovantes.length
        ? `<div class="miniaturas">${p.comprovantes.map((c) => `<a href="/api/comprovantes/${c.id}" target="_blank" rel="noopener"><img src="/api/comprovantes/${c.id}" alt="Comprovante enviado às ${hora(c.criado_em)}"></a>`).join('')}</div>`
        : '<p class="suave">Nenhuma foto anexada.</p>'}
      <label class="botao secundario" style="margin:0">Anexar foto do comprovante
        <input type="file" accept="image/*" capture="environment" id="arquivo-comprovante" hidden>
      </label>
    </div>`;
}

function desenharDetalhe(p) {
  const alteravel = p.status === 'aguardando';
  const podeCancelar = ['aguardando', 'expirado'].includes(p.status) || (p.status === 'pago' && usuario.papel === 'admin');
  $('#detalhe').innerHTML = `
    <div class="detalhe-topo"><h2>Pedido #${p.id}</h2>${seloStatus(p.status)}</div>
    <p class="suave">Vendedor: <strong>${esc(p.vendedor_nome)}</strong> · ${dataHora(p.finalizado_em)}
      ${p.status === 'aguardando' ? ` · <span class="contador" data-expira="${p.expira_em}"></span>` : ''}</p>

    <section class="bloco" id="bloco-cliente">${blocoCliente(p)}</section>

    <div class="rolagem">
      <table class="tabela">
        <thead><tr><th>Nº</th><th>Móvel</th><th class="num">Preço</th>${alteravel ? '<th></th>' : ''}</tr></thead>
        <tbody>
          ${p.itens.map((i) => `<tr>
            <td><span class="cod">${codigo(i.codigo)}</span></td>
            <td>${descricaoMovel(i)}</td>
            <td class="num">${reais(i.preco_centavos)}</td>
            ${alteravel ? `<td class="num"><button class="botao pequeno secundario" data-remover="${i.codigo}">Tirar</button></td>` : ''}
          </tr>`).join('')}
        </tbody>
        <tfoot><tr><th colspan="2">Total</th><th class="num total-grande">${reais(p.total_centavos)}</th>${alteravel ? '<th></th>' : ''}</tr></tfoot>
      </table>
    </div>

    ${p.status === 'aguardando' ? formPagamento() : ''}
    ${p.status === 'pago' ? blocoPago(p) : ''}
    ${p.status === 'expirado' ? `
      <div class="mensagem alerta">A reserva expirou e os móveis voltaram para a venda. Se o cliente ainda quer,
        clique em Reativar: o sistema tenta reservar de novo o que ainda estiver livre.</div>
      <button class="botao primario" id="reativar">Reativar pedido</button>` : ''}
    ${['aguardando', 'pago'].includes(p.status) ? blocoComprovantes(p) : ''}

    <div class="acoes-rodape">
      <span></span>
      ${podeCancelar ? `<button class="botao perigo-texto" id="cancelar">${p.status === 'pago' ? 'Cancelar pedido pago (devolver dinheiro)' : 'Cancelar pedido'}</button>` : ''}
    </div>`;
  atualizarContadores();
  ligarDetalhe(p);
}

function ligarDetalhe(p) {
  const detalhe = $('#detalhe');

  detalhe.querySelector('#editar-cliente')?.addEventListener('click', () => {
    editandoCliente = true;
    $('#bloco-cliente').innerHTML = `<form id="form-cliente" autocomplete="off">${camposCliente(config.cidades, p)}
      <div class="grupo-botoes"><button class="botao primario">Salvar</button><button type="button" class="botao secundario" id="cancelar-edicao">Cancelar</button></div></form>`;
    $('#cancelar-edicao').addEventListener('click', () => abrir(p.id, true));
    $('#form-cliente').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', `/api/pedidos/${p.id}/cliente`, lerFormulario(e.target));
        aviso('Dados de entrega atualizados.', 'ok');
        abrir(p.id, true);
      } catch (erro) {
        aviso(erro.message, 'erro', 6000);
      }
    });
  });

  for (const b of detalhe.querySelectorAll('[data-remover]')) {
    b.addEventListener('click', async () => {
      if (!confirm(`Tirar o ${codigo(b.dataset.remover)} do pedido? Ele volta a ficar disponível.`)) return;
      try {
        await api('DELETE', `/api/pedidos/${p.id}/itens/${b.dataset.remover}`);
        abrir(p.id, true);
        carregarLista();
      } catch (erro) {
        aviso(erro.message, 'erro');
      }
    });
  }

  const form = detalhe.querySelector('#form-pagamento');
  if (form) ligarPagamento(form, p);

  detalhe.querySelector('#imprimir')?.addEventListener('click', () => imprimirComprovante(p.id));

  detalhe.querySelector('#reativar')?.addEventListener('click', async () => {
    try {
      const r = await api('POST', `/api/pedidos/${p.id}/reativar`);
      if (r.perdidos.length) {
        aviso(`Reativado, mas ${r.perdidos.map(codigo).join(', ')} já foi vendido para outra pessoa e saiu do pedido.`, 'erro', 10000);
      } else {
        aviso('Pedido reativado. Pode receber.', 'ok');
      }
      abrir(p.id, true);
      carregarLista();
    } catch (erro) {
      aviso(erro.message, 'erro', 8000);
    }
  });

  detalhe.querySelector('#cancelar')?.addEventListener('click', async () => {
    const pergunta = p.status === 'pago'
      ? `Cancelar o pedido #${p.id} que JÁ FOI PAGO? Os móveis voltam para venda e o valor sai do fechamento. Devolva o dinheiro ao cliente.`
      : `Cancelar o pedido #${p.id}? Os móveis voltam a ficar disponíveis.`;
    if (!confirm(pergunta)) return;
    try {
      await api('POST', `/api/pedidos/${p.id}/cancelar`);
      aviso('Pedido cancelado.', 'ok');
      abrir(p.id, true);
      carregarLista();
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
  });

  detalhe.querySelector('#arquivo-comprovante')?.addEventListener('change', async (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    try {
      const foto = await reduzirImagem(arquivo);
      await api('POST', `/api/pedidos/${p.id}/comprovantes`, foto);
      aviso('Comprovante anexado.', 'ok');
      abrir(p.id, true);
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
  });
}

function ligarPagamento(form, p) {
  const campos = form.elements;
  const conta = form.querySelector('#conta');
  const botao = form.querySelector('#confirmar');
  let calculo = null;

  function recalcular() {
    const v = (nome) => paraCentavos(campos[nome].value);
    const din = v('dinheiro');
    const pix = v('pix');
    const cartao = v('cartao');
    const recebido = v('recebido');
    const invalido = [din, pix, cartao, recebido].some(Number.isNaN);
    const soma = din + pix + cartao;
    const falta = p.total_centavos - soma;
    // Se passou do total e o excesso cabe no dinheiro, o que passou é troco:
    // o campo Dinheiro vira "quanto o cliente entregou".
    const trocoDoExcesso = !invalido && falta < 0 && -falta < din;
    const dinNoCaixa = trocoDoExcesso ? din + falta : din;
    form.querySelector('.recebido').hidden = !(din > 0) || trocoDoExcesso;
    let ok = !invalido && (falta === 0 || trocoDoExcesso);
    let html;
    let troco = 0;
    if (invalido) html = '<span class="erro">Algum valor está inválido.</span>';
    else if (falta > 0) html = `Falta <strong>${reais(falta)}</strong>`;
    else if (trocoDoExcesso) {
      troco = -falta;
      html = `<span class="ok">✓ Fica ${reais(dinNoCaixa)} em dinheiro no caixa</span> · Troco: <strong class="troco">${reais(troco)}</strong>`;
    } else if (falta < 0) html = `<span class="erro">Passou ${reais(-falta)} do total — o troco só pode sair da parte em dinheiro</span>`;
    else html = '<span class="ok">✓ Valor confere</span>';
    if (!invalido && !trocoDoExcesso && din > 0 && recebido > 0) {
      troco = recebido - din;
      if (troco < 0) {
        ok = false;
        html += ' · <span class="erro">entregou menos que a parte em dinheiro</span>';
      } else {
        html += ` · Troco: <strong class="troco">${reais(troco)}</strong>`;
      }
    }
    conta.innerHTML = html;
    botao.disabled = !ok;
    calculo = {
      pagamentos: [['dinheiro', dinNoCaixa], ['pix', pix], ['cartao', cartao]]
        .filter(([, valor]) => valor > 0)
        .map(([forma, valor]) => ({ forma, valor_centavos: valor })),
      troco_centavos: Math.max(0, troco),
    };
  }

  form.addEventListener('input', recalcular);
  form.querySelector('.atalhos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tudo]');
    if (!b) return;
    for (const nome of ['dinheiro', 'pix', 'cartao']) campos[nome].value = nome === b.dataset.tudo ? centavosParaTexto(p.total_centavos) : '';
    campos.recebido.value = '';
    recalcular();
    if (b.dataset.tudo === 'dinheiro') campos.recebido.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!calculo || botao.disabled) return;
    botao.disabled = true;
    try {
      await api('POST', `/api/pedidos/${p.id}/pagar`, calculo);
      aviso(`Pedido #${p.id} pago!${calculo.troco_centavos ? ` Troco: ${reais(calculo.troco_centavos)}` : ''}`, 'ok', 6000);
      imprimirComprovante(p.id);
      await abrir(p.id, true);
      carregarLista();
    } catch (erro) {
      aviso(erro.message, 'erro', 8000);
      botao.disabled = false;
    }
  });
  recalcular();
}

// ---------- Fechamento ----------

async function carregarFechamento() {
  const r = await api('GET', '/api/relatorios/resumo');
  const linha = (c, destaque) => `<tr ${destaque ? 'style="font-weight:700"' : ''}>
      <td>${esc(c.nome)}</td><td class="num">${c.pedidos ?? 0}</td><td class="num">${reais(c.dinheiro)}</td>
      <td class="num">${reais(c.pix)}</td><td class="num">${reais(c.cartao)}</td><td class="num">${reais(c.total)}</td></tr>`;
  const meu = r.caixas.find((c) => c.caixa_id === usuario.id);
  $('#fechamento').innerHTML = `
    <div class="estatisticas">
      <div class="estatistica principal"><small>Meu caixa: dinheiro na gaveta</small><strong>${reais(meu?.dinheiro ?? 0)}</strong></div>
      <div class="estatistica"><small>Meu caixa: Pix</small><strong>${reais(meu?.pix ?? 0)}</strong></div>
      <div class="estatistica"><small>Meu caixa: cartão</small><strong>${reais(meu?.cartao ?? 0)}</strong></div>
      <div class="estatistica"><small>Meus pedidos pagos</small><strong>${meu?.pedidos ?? 0}</strong></div>
    </div>
    <div class="cartao">
      <div class="linha-topo"><h2>Todos os caixas</h2><button class="botao secundario nao-imprimir" onclick="window.print()">Imprimir</button></div>
      <p class="dica">O valor em dinheiro já desconta o troco. Some o fundo de troco que a gaveta tinha no início.</p>
      <div class="rolagem"><table class="tabela">
        <thead><tr><th>Caixa</th><th class="num">Pedidos</th><th class="num">Dinheiro</th><th class="num">Pix</th><th class="num">Cartão</th><th class="num">Total</th></tr></thead>
        <tbody>${r.caixas.map((c) => linha(c)).join('') || '<tr><td colspan="6" class="vazio">Nenhum pagamento ainda.</td></tr>'}</tbody>
        <tfoot>${linha({ nome: 'Total geral', pedidos: r.pedidos.pago, ...r.formas }, true)}</tfoot>
      </table></div>
      <p class="suave">Atualizado às ${hora(Date.now())}</p>
    </div>`;
}

// ---------- Atualização ----------

async function atualizar() {
  try {
    if (aba === 'pedidos') {
      await carregarLista();
      if (selecionado) await abrir(selecionado);
    } else {
      await carregarFechamento();
    }
  } catch (erro) {
    if (erro.status !== 401) aviso(erro.message, 'erro');
  }
}

ativarAbas((nome) => {
  aba = nome;
  atualizar();
});
ouvirMudancas(atualizar);
$('#busca').focus();
