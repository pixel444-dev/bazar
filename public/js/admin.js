import {
  api, aviso, esc, reais, codigo, dataHora, iniciarPagina, ouvirMudancas, ativarAbas, lerFormulario,
  seloMovel, telefoneFmt, enderecoFmt, paraCentavos, centavosParaTexto, ROTULO_PAPEL, aReceberNaEntrega,
} from './comum.js';

let { config } = await iniciarPagina({ titulo: 'Administração', papeis: ['admin'] });
const $ = (s) => document.querySelector(s);
let aba = 'painel';

async function recarregarConfig() {
  config = await api('GET', '/api/config');
  const opcoes = config.tipos.map((t) => `<option value="${t.id}">${esc(t.nome)}</option>`).join('');
  for (const sel of document.querySelectorAll('.seletor-tipo')) {
    const atual = sel.value;
    sel.innerHTML = `<option value="">Escolha o tipo…</option>${opcoes}<option value="novo">+ Novo tipo…</option>`;
    sel.value = atual;
  }
  const filtro = $('#filtro-tipo');
  const atual = filtro.value;
  filtro.innerHTML = `<option value="">Todos os tipos</option>${opcoes}`;
  filtro.value = atual;
}

// "+ Novo tipo…" nos seletores: cria o tipo na hora e já deixa ele escolhido.
for (const sel of document.querySelectorAll('.seletor-tipo')) {
  let anterior = '';
  sel.addEventListener('focus', () => { anterior = sel.value; });
  sel.addEventListener('change', async () => {
    if (sel.value !== 'novo') {
      anterior = sel.value;
      return;
    }
    const nome = prompt('Nome do novo tipo de móvel:');
    sel.value = anterior;
    if (!nome?.trim()) return;
    try {
      const { id } = await api('POST', '/api/admin/tipos', { nome });
      await recarregarConfig();
      sel.value = anterior = String(id);
      aviso(`Tipo "${nome.trim()}" adicionado.`, 'ok', 2500);
    } catch (erro) {
      aviso(erro.message, 'erro', 6000);
    }
  });
}

// ---------- Painel ----------

async function carregarPainel() {
  const [r, backup] = await Promise.all([api('GET', '/api/relatorios/resumo'), api('GET', '/api/admin/backup')]);
  const m = r.moveis;
  const totalMoveis = m.sem_cadastro + m.disponivel + m.reservado + m.vendido;
  const pv = r.previsao;
  const atingido = pv.total ? Math.round((pv.vendido / pv.total) * 100) : 0;
  $('#painel').innerHTML = `
    <div class="cartao previsao">
      <h2>Previsão de faturamento</h2>
      <p class="dica">Quanto entra se todos os móveis cadastrados forem vendidos pelo preço da etiqueta.</p>
      <div class="estatisticas">
        <div class="estatistica principal"><small>Se vender tudo</small><strong>${reais(pv.total)}</strong></div>
        <div class="estatistica"><small>Já vendido</small><strong>${reais(pv.vendido)}</strong></div>
        <div class="estatistica"><small>Reservado agora</small><strong>${reais(pv.reservado)}</strong></div>
        <div class="estatistica"><small>Ainda no galpão</small><strong>${reais(pv.disponivel)}</strong></div>
      </div>
      <div class="barra-progresso" role="progressbar" aria-valuenow="${atingido}" aria-valuemin="0" aria-valuemax="100"><span style="width:${atingido}%"></span></div>
      <p class="suave">${atingido}% da previsão já foi vendido.
        ${pv.sem_preco ? `<strong>${pv.sem_preco} etiqueta${pv.sem_preco > 1 ? 's' : ''} sem cadastro</strong> ainda não ${pv.sem_preco > 1 ? 'entram' : 'entra'} na conta.` : ''}</p>
    </div>
    <div class="estatisticas">
      <div class="estatistica principal"><small>Total vendido</small><strong>${reais(r.formas.total)}</strong></div>
      <div class="estatistica"><small>Dinheiro</small><strong>${reais(r.formas.dinheiro)}</strong></div>
      <div class="estatistica"><small>Pix</small><strong>${reais(r.formas.pix)}</strong></div>
      <div class="estatistica"><small>Cartão</small><strong>${reais(r.formas.cartao)}</strong></div>
      <div class="estatistica"><small>Na entrega (falta cobrar)</small><strong>${reais(r.entregas.a_receber)}</strong></div>
      <div class="estatistica"><small>Pedidos pagos</small><strong>${r.pedidos.pago}</strong></div>
      <div class="estatistica"><small>Aguardando no caixa</small><strong>${r.pedidos.aguardando}</strong></div>
    </div>
    <div class="estatisticas">
      <div class="estatistica"><small>Móveis no total</small><strong>${totalMoveis}</strong></div>
      <div class="estatistica"><small>Disponíveis</small><strong>${m.disponivel}</strong></div>
      <div class="estatistica"><small>Reservados agora</small><strong>${m.reservado}</strong></div>
      <div class="estatistica"><small>Vendidos</small><strong>${m.vendido}</strong></div>
      <div class="estatistica"><small>Sem cadastro</small><strong>${m.sem_cadastro}</strong></div>
      <div class="estatistica"><small>Entregas pendentes</small><strong>${r.entregas.pendentes}</strong></div>
    </div>
    <div class="grade-cartoes">
      <div class="cartao">
        <h2>Por tipo</h2>
        <div class="rolagem"><table class="tabela">
          <thead><tr><th>Tipo</th><th class="num">Total</th><th class="num">Disponíveis</th><th class="num">Reservados</th><th class="num">Vendidos</th><th class="num">Se vender tudo</th></tr></thead>
          <tbody>${r.tipos.map((t) => `<tr><td>${esc(t.nome)}</td><td class="num">${t.total}</td><td class="num">${t.disponiveis}</td><td class="num">${t.reservados}</td><td class="num">${t.vendidos}</td><td class="num">${reais(t.valor_total)}</td></tr>`).join('')
            || '<tr><td colspan="6" class="vazio">Nenhum móvel cadastrado.</td></tr>'}</tbody>
        </table></div>
      </div>
      <div class="cartao">
        <h2>Por vendedor</h2>
        <div class="rolagem"><table class="tabela">
          <thead><tr><th>Vendedor</th><th class="num">Pedidos</th><th class="num">Móveis</th><th class="num">Total</th></tr></thead>
          <tbody>${r.vendedores.map((v) => `<tr><td>${esc(v.nome)}</td><td class="num">${v.pedidos}</td><td class="num">${v.itens}</td><td class="num">${reais(v.total)}</td></tr>`).join('')
            || '<tr><td colspan="4" class="vazio">Nenhuma venda paga ainda.</td></tr>'}</tbody>
        </table></div>
      </div>
      <div class="cartao">
        <h2>Por caixa</h2>
        <div class="rolagem"><table class="tabela">
          <thead><tr><th>Caixa</th><th class="num">Dinheiro</th><th class="num">Pix</th><th class="num">Cartão</th><th class="num">Na entrega</th></tr></thead>
          <tbody>${r.caixas.map((c) => `<tr><td>${esc(c.nome)}</td><td class="num">${reais(c.dinheiro)}</td><td class="num">${reais(c.pix)}</td><td class="num">${reais(c.cartao)}</td><td class="num">${reais(c.entrega)}</td></tr>`).join('')
            || '<tr><td colspan="5" class="vazio">Nenhum pagamento ainda.</td></tr>'}</tbody>
        </table></div>
      </div>
      <div class="cartao">
        <h2>Relatórios</h2>
        <div class="grupo-botoes">
          <a class="botao primario" href="/imprimir/romaneio.html" target="_blank">Romaneio de entrega</a>
          <a class="botao secundario" href="/api/relatorios/vendas.csv">Planilha de vendas (Excel)</a>
        </div>
        <p class="dica" style="margin-top:12px">Último backup: ${backup ? dataHora(backup.quando) : 'ainda não feito'}
          ${backup?.erro_extra ? `<br><span style="color:var(--erro)">${esc(backup.erro_extra)}</span>` : ''}</p>
      </div>
    </div>`;
}

// ---------- Móveis ----------

let movelAberto = null;
let ultimoCadastro = null;
const formRapido = $('#form-rapido');

async function abrirMovel(numero) {
  const info = $('#rapido-info');
  try {
    const m = await api('GET', `/api/moveis/${numero}`);
    movelAberto = m;
    $('#rapido-codigo').value = codigo(m.codigo);
    const travado = ['reservado', 'vendido'].includes(m.status);
    info.className = `mensagem ${travado ? 'alerta' : 'info'}`;
    info.innerHTML = `<span class="cod">${codigo(m.codigo)}</span> ${seloMovel(m.status)}
      ${travado ? ' · tipo e preço não podem mudar agora' : ''}`;
    info.hidden = false;
    const campos = formRapido.elements;
    $('#rapido-campos').disabled = false;
    const usarAnterior = m.status === 'sem_cadastro' && ultimoCadastro;
    campos.tipo_id.value = m.tipo_id ?? (usarAnterior ? ultimoCadastro.tipo_id : '');
    campos.preco.value = centavosParaTexto(m.preco_centavos ?? (usarAnterior ? ultimoCadastro.preco_centavos : 0));
    campos.descricao.value = m.descricao ?? '';
    campos.tipo_id.disabled = travado;
    campos.preco.disabled = travado;
    (campos.tipo_id.value ? campos.preco : campos.tipo_id).focus();
    if (travado) campos.descricao.focus();
  } catch (erro) {
    movelAberto = null;
    $('#rapido-campos').disabled = true;
    info.className = 'mensagem erro';
    info.textContent = erro.message;
    info.hidden = false;
  }
}

$('#rapido-abrir').addEventListener('click', () => {
  const n = Number($('#rapido-codigo').value.replace(/\D/g, ''));
  if (n) abrirMovel(n);
});
$('#rapido-codigo').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#rapido-abrir').click();
  }
});

formRapido.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!movelAberto) return;
  const campos = formRapido.elements;
  const dados = { descricao: campos.descricao.value };
  if (!campos.tipo_id.disabled) {
    dados.tipo_id = Number(campos.tipo_id.value);
    dados.preco_centavos = paraCentavos(campos.preco.value);
    if (!(dados.preco_centavos > 0)) return aviso('Preço inválido.', 'erro');
  }
  try {
    const m = await api('PUT', `/api/admin/moveis/${movelAberto.codigo}`, dados);
    ultimoCadastro = { tipo_id: m.tipo_id, preco_centavos: m.preco_centavos };
    aviso(`${codigo(m.codigo)} salvo: ${m.tipo_nome} ${reais(m.preco_centavos)}`, 'ok', 2500);
    abrirMovel(m.codigo + 1);
  } catch (erro) {
    aviso(erro.message, 'erro', 6000);
  }
});

$('#form-etiquetas').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('POST', '/api/admin/etiquetas', { quantidade: Number(e.target.elements.quantidade.value) });
    aviso(`Etiquetas ${codigo(r.de)} a ${codigo(r.ate)} criadas.`, 'ok');
    e.target.reset();
    const imprimir = $('#form-imprimir-etiquetas').elements;
    imprimir.de.value = r.de;
    imprimir.ate.value = r.ate;
    carregarMoveis();
  } catch (erro) {
    aviso(erro.message, 'erro');
  }
});

$('#form-imprimir-etiquetas').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  window.open(`/imprimir/etiquetas.html?de=${f.de.value}&ate=${f.ate.value}&borda=${f.borda.checked ? 1 : 0}`, '_blank');
});

$('#form-lote').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const preco = paraCentavos(f.preco.value);
  if (!(preco > 0)) return aviso('Preço inválido.', 'erro');
  const tipo = config.tipos.find((t) => t.id === Number(f.tipo_id.value));
  if (!confirm(`Aplicar ${tipo?.nome} por ${reais(preco)} do ${codigo(f.de.value)} ao ${codigo(f.ate.value)}?`)) return;
  try {
    const r = await api('POST', '/api/admin/moveis/lote', { de: Number(f.de.value), ate: Number(f.ate.value), tipo_id: Number(f.tipo_id.value), preco_centavos: preco });
    aviso(`${r.atualizados} móveis atualizados.${r.pulados.length ? ` Ignorados (reservados/vendidos): ${r.pulados.map(codigo).join(', ')}.` : ''}${r.inexistentes ? ` ${r.inexistentes} números ainda não existem.` : ''}`, 'ok', 7000);
  } catch (erro) {
    aviso(erro.message, 'erro');
  }
});

async function carregarListaMoveis() {
  const params = new URLSearchParams();
  if ($('#filtro-status').value) params.set('status', $('#filtro-status').value);
  if ($('#filtro-tipo').value) params.set('tipo_id', $('#filtro-tipo').value);
  const lista = await api('GET', `/api/moveis?${params}`);
  $('#tabela-moveis').innerHTML = lista.map((m) => `
    <tr class="clicavel" data-codigo="${m.codigo}">
      <td><span class="cod">${codigo(m.codigo)}</span></td>
      <td>${esc(m.tipo_nome ?? '—')}</td>
      <td>${esc(m.descricao)}</td>
      <td class="num">${m.preco_centavos ? reais(m.preco_centavos) : '—'}</td>
      <td>${seloMovel(m.status)}</td>
      <td>${m.pedido_id ? `#${m.pedido_id}${m.vendedor_nome ? ` · ${esc(m.vendedor_nome)}` : ''}` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum móvel. Crie as etiquetas primeiro.</td></tr>';
  return lista;
}

async function carregarMoveis() {
  await recarregarConfig();
  const todos = await api('GET', '/api/moveis');
  const ultimo = todos.at(-1)?.codigo ?? 0;
  $('#etiquetas-info').textContent = ultimo
    ? `Já existem ${todos.length} etiquetas (${codigo(1)} a ${codigo(ultimo)}).`
    : 'Nenhuma etiqueta criada ainda.';
  const imprimir = $('#form-imprimir-etiquetas').elements;
  if (!imprimir.de.value && ultimo) {
    imprimir.de.value = 1;
    imprimir.ate.value = ultimo;
  }
  await carregarListaMoveis();
}

$('#filtro-status').addEventListener('change', () => carregarListaMoveis());
$('#filtro-tipo').addEventListener('change', () => carregarListaMoveis());
$('#tabela-moveis').addEventListener('click', (e) => {
  const linha = e.target.closest('[data-codigo]');
  if (!linha) return;
  abrirMovel(Number(linha.dataset.codigo));
  formRapido.scrollIntoView({ behavior: 'smooth' });
});

// ---------- Entregas ----------

async function carregarEntregas() {
  const todos = $('#mostrar-entregues').checked;
  const lista = await api('GET', `/api/relatorios/romaneio?pendentes=${todos ? 0 : 1}`);
  if (!lista.length) {
    $('#lista-entregas').innerHTML = `<p class="vazio">${todos ? 'Nenhum pedido pago ainda.' : 'Nenhuma entrega pendente.'}</p>`;
    return;
  }
  const grupos = new Map();
  for (const p of lista) {
    const chave = p.cidade_nome ?? 'Sem cidade';
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(p);
  }
  $('#lista-entregas').innerHTML = [...grupos].map(([cidade, pedidos]) => `
    <div class="grupo-cidade">
      <h3>${esc(cidade)} <small>(${pedidos.length})</small></h3>
      ${pedidos.map((p) => `
        <div class="entrega">
          <input type="checkbox" data-entrega="${p.id}" data-cobrar="${aReceberNaEntrega(p)}" ${p.entregue ? 'checked' : ''} aria-label="Pedido #${p.id} entregue">
          <div class="info">
            <div class="linha-topo"><strong>#${p.id} · ${esc(p.cliente_nome)}</strong><span>${esc(telefoneFmt(p.telefone))}</span></div>
            <div>${esc(enderecoFmt(p))}</div>
            <div class="suave">${p.itens.map((i) => `${codigo(i.codigo)} ${esc(i.tipo_nome)}`).join(' · ')}</div>
            ${p.observacao ? `<div class="suave">Obs.: ${esc(p.observacao)}</div>` : ''}
            ${aReceberNaEntrega(p) ? `<div class="mensagem alerta" style="margin:6px 0 0">${p.entregue ? 'Recebido na entrega' : 'Cobrar na entrega'}: ${reais(aReceberNaEntrega(p))}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>`).join('');
}

$('#mostrar-entregues').addEventListener('change', () => carregarEntregas());
$('#lista-entregas').addEventListener('change', async (e) => {
  const caixa = e.target.closest('[data-entrega]');
  if (!caixa) return;
  const cobrar = caixa.dataset.cobrar && Number(caixa.dataset.cobrar);
  if (caixa.checked && cobrar && !confirm(`O entregador recebeu ${reais(cobrar)} do cliente do pedido #${caixa.dataset.entrega}?`)) {
    caixa.checked = false;
    return;
  }
  try {
    await api('POST', `/api/pedidos/${caixa.dataset.entrega}/entrega`, { entregue: caixa.checked });
    aviso(caixa.checked ? `Pedido #${caixa.dataset.entrega} entregue.` : 'Entrega desmarcada.', 'ok', 2000);
  } catch (erro) {
    caixa.checked = !caixa.checked;
    aviso(erro.message, 'erro');
  }
});

// ---------- Equipe, cidades e tipos ----------

async function carregarCadastros() {
  const [usuarios] = await Promise.all([api('GET', '/api/admin/usuarios'), recarregarConfig()]);
  $('#lista-usuarios').innerHTML = `<div class="rolagem"><table class="tabela">
    <thead><tr><th>Nome</th><th>Função</th><th></th></tr></thead>
    <tbody>${usuarios.map((u) => `
      <tr ${u.ativo ? '' : 'class="suave"'}>
        <td>${esc(u.nome)}${u.ativo ? '' : ' <small>(desativado)</small>'}</td>
        <td>${ROTULO_PAPEL[u.papel]}</td>
        <td class="num">
          <button class="botao pequeno secundario" data-pin="${u.id}" data-nome="${esc(u.nome)}">Trocar PIN</button>
          <button class="botao pequeno ${u.ativo ? 'perigo-texto' : 'secundario'}" data-ativo="${u.id}" data-valor="${u.ativo ? 0 : 1}">${u.ativo ? 'Desativar' : 'Reativar'}</button>
        </td>
      </tr>`).join('')}</tbody></table></div>`;

  const listaSimples = (itens, tipo, rotuloUso) => itens.length
    ? `<div class="rolagem"><table class="tabela"><tbody>${itens.map((x) => `
        <tr><td>${esc(x.nome)}</td><td class="num suave">${x.qtd} ${rotuloUso}</td>
          <td class="num">
            <button class="botao pequeno secundario" data-renomear="${tipo}" data-id="${x.id}" data-nome="${esc(x.nome)}">Renomear</button>
            <button class="botao pequeno perigo-texto" data-excluir="${tipo}" data-id="${x.id}" data-nome="${esc(x.nome)}">Excluir</button>
          </td></tr>`).join('')}</tbody></table></div>`
    : '<p class="vazio">Nenhum cadastro.</p>';
  $('#lista-cidades').innerHTML = listaSimples(config.cidades, 'cidades', 'pedidos');
  $('#lista-tipos').innerHTML = listaSimples(config.tipos, 'tipos', 'móveis');
}

$('[data-painel="cadastros"]').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-pin], button[data-ativo], button[data-renomear], button[data-excluir]');
  if (!b) return;
  try {
    if (b.dataset.pin) {
      const pin = prompt(`Novo PIN para ${b.dataset.nome} (4 a 6 números):`);
      if (!pin) return;
      await api('PUT', `/api/admin/usuarios/${b.dataset.pin}`, { pin });
      aviso('PIN alterado.', 'ok');
    } else if (b.dataset.ativo) {
      await api('PUT', `/api/admin/usuarios/${b.dataset.ativo}`, { ativo: b.dataset.valor === '1' });
    } else if (b.dataset.renomear) {
      const nome = prompt('Novo nome:', b.dataset.nome);
      if (!nome) return;
      await api('PUT', `/api/admin/${b.dataset.renomear}/${b.dataset.id}`, { nome });
    } else if (b.dataset.excluir) {
      if (!confirm(`Excluir "${b.dataset.nome}"?`)) return;
      await api('DELETE', `/api/admin/${b.dataset.excluir}/${b.dataset.id}`);
    }
    carregarCadastros();
  } catch (erro) {
    aviso(erro.message, 'erro', 6000);
  }
});

function formSimples(seletor, url, mensagem) {
  $(seletor).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', url, lerFormulario(e.target));
      aviso(mensagem, 'ok');
      e.target.reset();
      carregarCadastros();
    } catch (erro) {
      aviso(erro.message, 'erro', 6000);
    }
  });
}
formSimples('#form-usuario', '/api/admin/usuarios', 'Pessoa adicionada.');
formSimples('#form-cidade', '/api/admin/cidades', 'Cidade adicionada.');
formSimples('#form-tipo', '/api/admin/tipos', 'Tipo adicionado.');

// ---------- Configurações ----------

async function carregarConfig() {
  const [c, backup] = await Promise.all([api('GET', '/api/admin/config'), api('GET', '/api/admin/backup')]);
  const f = $('#form-config').elements;
  for (const chave of ['nome_evento', 'reserva_minutos', 'backup_pasta', 'wifi_nome', 'wifi_senha']) f[chave].value = c[chave] ?? '';
  mostrarBackup(backup);
}

function mostrarBackup(b) {
  $('#info-backup').innerHTML = b
    ? `Último backup: ${dataHora(b.quando)}<br><small>${esc(b.arquivo)}</small>
       ${b.extra ? `<br>Cópia no pendrive: ${esc(b.extra)}` : ''}
       ${b.erro_extra ? `<p class="mensagem erro">${esc(b.erro_extra)}</p>` : ''}`
    : 'Nenhum backup feito desde que a central foi ligada. Ele é feito sozinho a cada 3 minutos quando há mudanças.';
}

$('#form-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('PUT', '/api/admin/config', lerFormulario(e.target));
    aviso('Configurações salvas.', 'ok');
  } catch (erro) {
    aviso(erro.message, 'erro');
  }
});

$('#fazer-backup').addEventListener('click', async () => {
  try {
    const b = await api('POST', '/api/admin/backup');
    mostrarBackup(b);
    aviso(b.erro_extra ? 'Backup local feito, mas a cópia extra falhou.' : 'Backup feito.', b.erro_extra ? 'erro' : 'ok');
  } catch (erro) {
    aviso(erro.message, 'erro');
  }
});

// ---------- Abas e atualização ----------

const CARREGAR = { painel: carregarPainel, moveis: carregarMoveis, entregas: carregarEntregas, cadastros: carregarCadastros, config: carregarConfig };

async function carregarAba(nome) {
  try {
    await CARREGAR[nome]();
  } catch (erro) {
    if (erro.status !== 401) aviso(erro.message, 'erro');
  }
}

ativarAbas((nome) => {
  aba = nome;
  carregarAba(nome);
});

// Só atualiza sozinho o que não tem formulário sendo digitado.
ouvirMudancas(() => {
  if (aba === 'painel' || aba === 'entregas') carregarAba(aba);
  else if (aba === 'moveis') carregarListaMoveis().catch(() => {});
});
