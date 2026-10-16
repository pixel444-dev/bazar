import { api, esc, botaoDoEnvio, PAGINA_INICIAL } from './comum.js';

const $ = (s) => document.querySelector(s);
let escolhido = null;

try {
  const eu = await api('GET', '/api/eu');
  location.replace(PAGINA_INICIAL[eu.papel]);
} catch {
  // não está logado: mostra a lista
}

const GRUPOS = [['vendedor', 'Vendedores'], ['caixa', 'Caixas'], ['admin', 'Administração']];

async function carregar() {
  try {
    const { nome_evento, usuarios } = await api('GET', '/api/login/usuarios');
    $('#nome-evento').textContent = nome_evento;
    document.title = `Entrar · ${nome_evento}`;
    $('#usuarios').innerHTML = GRUPOS.map(([papel, titulo]) => {
      const lista = usuarios.filter((u) => u.papel === papel);
      if (!lista.length) return '';
      return `<div class="grupo-login"><h2>${titulo}</h2><div class="grade-usuarios">
        ${lista.map((u) => `<button class="botao" data-id="${u.id}" data-nome="${esc(u.nome)}">${esc(u.nome)}</button>`).join('')}
      </div></div>`;
    }).join('');
  } catch (e) {
    $('#usuarios').innerHTML = `<p class="mensagem erro">${esc(e.message)}</p><button class="botao primario" onclick="location.reload()">Tentar de novo</button>`;
  }
}

$('#usuarios').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  escolhido = { id: Number(b.dataset.id), nome: b.dataset.nome };
  $('#nome-escolhido').textContent = escolhido.nome;
  $('#escolher').hidden = true;
  $('#form-pin').hidden = false;
  $('#erro-pin').hidden = true;
  $('#pin').value = '';
  $('#pin').focus();
});

$('#voltar').addEventListener('click', () => {
  $('#form-pin').hidden = true;
  $('#escolher').hidden = false;
});

$('#form-pin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const botao = botaoDoEnvio(e);
  botao.disabled = true;
  try {
    const u = await api('POST', '/api/login', { usuario_id: escolhido.id, pin: $('#pin').value });
    location.replace(PAGINA_INICIAL[u.papel]);
  } catch (erro) {
    $('#erro-pin').textContent = erro.message;
    $('#erro-pin').hidden = false;
    $('#pin').value = '';
    $('#pin').focus();
  } finally {
    botao.disabled = false;
  }
});

carregar();
