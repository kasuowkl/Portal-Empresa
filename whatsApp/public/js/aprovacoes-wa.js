/* ── aprovacoes-wa.js ── */

let aprovacoes  = [];
let aprAtual    = null; // aprovação selecionada nos modais

// ── Login persistido ─────────────────────────────────────
const inpLogin = document.getElementById('inp-login-global');
inpLogin.value = localStorage.getItem('apr_login') || '';
inpLogin.addEventListener('change', () => localStorage.setItem('apr_login', inpLogin.value.trim()));

function getLogin() { return inpLogin.value.trim(); }

// ── Toast ────────────────────────────────────────────────
let toastTimer;
function toast(msg, tipo = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + tipo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

// ── Modais ───────────────────────────────────────────────
function abrirModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function fecharModal(id) { document.getElementById(id).classList.add('hidden'); }

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    ['modal-aprovar', 'modal-reprovar', 'modal-notificar'].forEach(fecharModal);
  }
});

// ── Formatar data ─────────────────────────────────────────
function fmt(str) {
  if (!str) return '—';
  return str;
}

// ── Detalhe HTML para modais ──────────────────────────────
function htmlDetalhe(a) {
  return `
    <div class="titulo">#${a.id} — ${a.titulo || '—'}</div>
    <div class="row"><span class="k">Solicitante:</span><span>${a.criado_por_nome || a.criado_por || '—'}</span></div>
    <div class="row"><span class="k">Criada em:</span><span>${a.criado_em_fmt || a.criado_em || '—'}</span></div>
    ${a.descricao ? `<div class="row"><span class="k">Descrição:</span><span>${a.descricao}</span></div>` : ''}
    <div class="row"><span class="k">Status:</span><span>${a.status || '—'}</span></div>
  `;
}

// ── Mensagem padrão de notificação ────────────────────────
function gerarMensagem(a) {
  const portal = 'http://192.168.0.80:3132/aprovacoes';
  return `*Portal WKL — Aprovação Pendente* 🔔\n\nVocê tem uma aprovação aguardando sua resposta:\n\n*#${a.id}* — ${a.titulo || '—'}\nSolicitante: ${a.criado_por_nome || a.criado_por || '—'}\nCriada em: ${a.criado_em_fmt || a.criado_em || '—'}\n${a.descricao ? `\n${a.descricao}\n` : ''}\nPara responder, envie:\n✅ *aprovar ${a.id}*\n❌ *reprovar ${a.id} [motivo]*\n\nPortal: ${portal}`;
}

// ── Carregar aprovações ───────────────────────────────────
async function carregar() {
  const busca    = document.getElementById('inp-busca-apr').value.trim();
  const aprovador = document.getElementById('inp-filtro-aprovador').value.trim();
  const lista    = document.getElementById('apr-lista');
  lista.innerHTML = '<div class="apr-empty">Carregando...</div>';

  try {
    const params = new URLSearchParams();
    if (aprovador) params.set('aprovador', aprovador);
    const res  = await fetch('/api/aprovacoes?' + params.toString());
    aprovacoes = await res.json();

    if (!Array.isArray(aprovacoes)) {
      lista.innerHTML = '<div class="apr-empty">Erro ao carregar aprovações.</div>';
      return;
    }

    // Aplica busca local
    let filtradas = aprovacoes;
    if (busca) {
      const b = busca.toLowerCase();
      filtradas = aprovacoes.filter(a =>
        (a.titulo || '').toLowerCase().includes(b) ||
        (a.criado_por_nome || a.criado_por || '').toLowerCase().includes(b) ||
        String(a.id).includes(b)
      );
    }

    atualizarStats(aprovacoes);
    renderLista(filtradas);
  } catch (err) {
    lista.innerHTML = `<div class="apr-empty">Erro: ${err.message}</div>`;
  }
}

function atualizarStats(lista) {
  const hoje = new Date().toLocaleDateString('pt-BR');
  const pendentes  = lista.filter(a => a.status === 'Pendente').length;
  const aprovadas  = lista.filter(a => a.status === 'Aprovado'  && (a.criado_em_fmt || '').includes(hoje)).length;
  const reprovadas = lista.filter(a => a.status === 'Reprovado' && (a.criado_em_fmt || '').includes(hoje)).length;
  document.getElementById('stat-pendente').textContent  = pendentes;
  document.getElementById('stat-aprovada').textContent  = aprovadas;
  document.getElementById('stat-reprovada').textContent = reprovadas;
}

// ── Render cards ─────────────────────────────────────────
function renderLista(lista) {
  const el = document.getElementById('apr-lista');
  if (!lista.length) {
    el.innerHTML = '<div class="apr-empty">Nenhuma aprovação encontrada.</div>';
    return;
  }

  el.innerHTML = lista.map(a => {
    const chips = (a.aprovadores || []).map(ap => {
      const cls = ap.status === 'Aprovado' ? 'dot-aprovado' : ap.status === 'Reprovado' ? 'dot-reprovado' : 'dot-pendente';
      return `<span class="apr-aprovador-chip"><span class="dot ${cls}"></span>${ap.nome || ap.login}</span>`;
    }).join('');

    const isPendente = a.status === 'Pendente';

    return `
      <div class="apr-card" data-id="${a.id}">
        <div class="apr-card-hdr">
          <span class="apr-id">#${a.id}</span>
          <span class="apr-titulo">${a.titulo || '—'}</span>
          <span class="apr-status-badge ${a.status}">${a.status}</span>
        </div>
        <div class="apr-card-body">
          <div class="apr-info">
            <div class="apr-info-row"><span class="k">Solicitante</span><span class="v">${a.criado_por_nome || a.criado_por || '—'}</span></div>
            <div class="apr-info-row"><span class="k">Criada em</span><span class="v">${a.criado_em_fmt || a.criado_em || '—'}</span></div>
            ${a.descricao ? `<div class="apr-info-row"><span class="k">Descrição</span><span class="v">${a.descricao}</span></div>` : ''}
          </div>
          ${chips ? `<div class="apr-aprovadores">${chips}</div>` : ''}
        </div>
        <div class="apr-card-footer">
          <button class="btn-notif" onclick="abrirNotificar(${a.id})">📱 Notificar</button>
          ${isPendente ? `<button class="btn-apr" onclick="abrirAprovar(${a.id})">✅ Aprovar</button>` : ''}
          ${isPendente ? `<button class="btn-rep" onclick="abrirReprovar(${a.id})">❌ Reprovar</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ── Modal Aprovar ─────────────────────────────────────────
function abrirAprovar(id) {
  aprAtual = aprovacoes.find(a => a.id == id);
  if (!aprAtual) return;

  document.getElementById('apr-detalhe-aprovar').innerHTML = htmlDetalhe(aprAtual);
  document.getElementById('inp-confirm-apr').value = '';
  document.getElementById('btn-confirmar-apr').disabled = true;
  document.getElementById('apr-warn-login-apr').style.display = getLogin() ? 'none' : 'block';

  abrirModal('modal-aprovar');
}

document.getElementById('inp-confirm-apr').addEventListener('input', function () {
  const ok = this.value.trim() === String(aprAtual?.id) && getLogin();
  document.getElementById('btn-confirmar-apr').disabled = !ok;
});

document.getElementById('btn-confirmar-apr').addEventListener('click', async () => {
  if (!aprAtual || !getLogin()) return;
  const btn = document.getElementById('btn-confirmar-apr');
  btn.disabled = true;
  btn.textContent = 'Aguarde...';
  try {
    const res = await fetch(`/api/aprovacoes/${aprAtual.id}/aprovar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: getLogin() }),
    });
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || 'Erro ao aprovar');
    toast(`✅ Aprovação #${aprAtual.id} aprovada com sucesso!`, 'ok');
    fecharModal('modal-aprovar');
    await carregar();
  } catch (err) {
    toast(`Erro: ${err.message}`, 'err');
    btn.disabled = false;
    btn.textContent = '✅ Confirmar Aprovação';
  }
});

// ── Modal Reprovar ────────────────────────────────────────
function abrirReprovar(id) {
  aprAtual = aprovacoes.find(a => a.id == id);
  if (!aprAtual) return;

  document.getElementById('apr-detalhe-reprovar').innerHTML = htmlDetalhe(aprAtual);
  document.getElementById('inp-motivo-rep').value = '';
  document.getElementById('inp-confirm-rep').value = '';
  document.getElementById('btn-confirmar-rep').disabled = true;
  document.getElementById('apr-warn-login-rep').style.display = getLogin() ? 'none' : 'block';

  abrirModal('modal-reprovar');
}

function checarReprovar() {
  const motivo  = document.getElementById('inp-motivo-rep').value.trim();
  const confirm = document.getElementById('inp-confirm-rep').value.trim();
  const ok = motivo.length >= 5 && confirm === 'REPROVAR' && getLogin();
  document.getElementById('btn-confirmar-rep').disabled = !ok;
}

document.getElementById('inp-motivo-rep').addEventListener('input', checarReprovar);
document.getElementById('inp-confirm-rep').addEventListener('input', checarReprovar);

document.getElementById('btn-confirmar-rep').addEventListener('click', async () => {
  if (!aprAtual || !getLogin()) return;
  const motivo = document.getElementById('inp-motivo-rep').value.trim();
  const btn = document.getElementById('btn-confirmar-rep');
  btn.disabled = true;
  btn.textContent = 'Aguarde...';
  try {
    const res = await fetch(`/api/aprovacoes/${aprAtual.id}/reprovar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: getLogin(), motivo }),
    });
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || 'Erro ao reprovar');
    toast(`❌ Aprovação #${aprAtual.id} reprovada.`, 'err');
    fecharModal('modal-reprovar');
    await carregar();
  } catch (err) {
    toast(`Erro: ${err.message}`, 'err');
    btn.disabled = false;
    btn.textContent = '❌ Confirmar Reprovação';
  }
});

// ── Modal Notificar ───────────────────────────────────────
function abrirNotificar(id) {
  aprAtual = aprovacoes.find(a => a.id == id);
  if (!aprAtual) return;

  document.getElementById('apr-detalhe-notif').innerHTML = htmlDetalhe(aprAtual);
  document.getElementById('inp-numero-notif').value = '';
  document.getElementById('inp-msg-notif').value = gerarMensagem(aprAtual);

  // Preenche número se houver um único aprovador com número
  const pendente = (aprAtual.aprovadores || []).find(ap => ap.status === 'Pendente' && ap.whatsapp);
  if (pendente) document.getElementById('inp-numero-notif').value = pendente.whatsapp.replace(/\D/g, '');

  abrirModal('modal-notificar');
}

document.getElementById('btn-confirmar-notif').addEventListener('click', async () => {
  const numero   = document.getElementById('inp-numero-notif').value.trim();
  const mensagem = document.getElementById('inp-msg-notif').value.trim();
  if (!numero)   return toast('Informe o número WhatsApp.', 'err');
  if (!mensagem) return toast('Mensagem não pode ser vazia.', 'err');

  const btn = document.getElementById('btn-confirmar-notif');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  try {
    const res = await fetch(`/api/aprovacoes/${aprAtual.id}/notificar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero, mensagem }),
    });
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || 'Erro ao enviar');
    toast('📱 Notificação enviada com sucesso!', 'ok');
    fecharModal('modal-notificar');
  } catch (err) {
    toast(`Erro: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '📱 Enviar Notificação';
  }
});

// ── Eventos ───────────────────────────────────────────────
document.getElementById('btn-refresh').addEventListener('click', carregar);
document.getElementById('inp-busca-apr').addEventListener('input', () => {
  clearTimeout(window._buscarTimer);
  window._buscarTimer = setTimeout(carregar, 350);
});
document.getElementById('inp-filtro-aprovador').addEventListener('change', carregar);

// Fecha ao clicar no fundo
['modal-aprovar', 'modal-reprovar', 'modal-notificar'].forEach(id => {
  document.getElementById(id).addEventListener('click', function (e) {
    if (e.target === this) fecharModal(id);
  });
});

// Inicia
carregar();
