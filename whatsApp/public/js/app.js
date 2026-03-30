const WA_BASE = window.WA_BASE || '';
const socket = io(WA_BASE);

// Estado
let jidAtivo        = null;
let whatsConectado  = false;
let arquivoPendente = null;
let replyMsgId      = null;
let totalNaoLidas   = 0;

// Elementos principais
const qrOverlay    = document.getElementById('qr-overlay');
const qrImg        = document.getElementById('qr-img');
const qrStatus     = document.getElementById('qr-status');
const statusDot    = document.getElementById('status-dot');
const listaChatsEl = document.getElementById('lista-chats');
const inpBusca     = document.getElementById('inp-busca');
const chatVazio    = document.getElementById('chat-vazio');
const chatAtivo    = document.getElementById('chat-ativo');
const ctAvatar     = document.getElementById('ct-avatar');
const ctAvatarImg  = document.getElementById('ct-avatar-img');
const ctAvatarIni  = document.getElementById('ct-avatar-inicial');
const ctNome       = document.getElementById('ct-nome');
const ctNumero     = document.getElementById('ct-numero');
const ctStatus     = document.getElementById('ct-status');
const chatFeed     = document.getElementById('chat-feed');
const inpMsg       = document.getElementById('inp-msg');
const btnEnviar    = document.getElementById('btn-enviar');
const replyBar     = document.getElementById('reply-bar');
const replyTexto   = document.getElementById('reply-texto');

// ── Socket ─────────────────────────────────────────────────
socket.on('qr', (dataUrl) => {
  qrImg.src = dataUrl;
  qrStatus.textContent = 'Escaneie o QR Code acima';
  qrOverlay.classList.remove('hidden');
});

socket.on('status', ({ conectado }) => {
  whatsConectado = conectado;
  statusDot.className = `dot ${conectado ? 'on' : 'off'}`;
  statusDot.title     = conectado ? 'Conectado' : 'Desconectado';
  const cfgStatus = document.getElementById('cfg-status');
  if (cfgStatus) cfgStatus.textContent = conectado ? '🟢 Conectado' : '🔴 Desconectado';
  const btnDesc = document.getElementById('btn-desconectar');
  if (btnDesc) btnDesc.disabled = !conectado;
  if (conectado) qrOverlay.classList.add('hidden');
});

socket.on('chats', renderizarChats);

socket.on('mensagem', (msg) => {
  if (msg.jid === jidAtivo) {
    adicionarBubble(msg);
  } else {
    // Incrementa não-lidas só para chats que não estão ativos
    totalNaoLidas++;
    atualizarTituloComBadge();
  }
});

// Evento de presença vindo do servidor
socket.on('presence', ({ jid, presences }) => {
  if (jid !== jidAtivo) return;
  // presences é objeto: { "jid@s.whatsapp.net": { lastKnownPresence: "available"|"unavailable"|"composing" } }
  const valores = Object.values(presences || {});
  if (!valores.length) return;
  const estado = valores[0].lastKnownPresence;
  if (estado === 'composing') {
    ctStatus.textContent = 'digitando';
    ctStatus.classList.add('digitando');
  } else if (estado === 'available') {
    ctStatus.textContent = 'online';
    ctStatus.classList.remove('digitando');
  } else if (estado === 'unavailable') {
    // Tenta mostrar "visto por último" se tiver timestamp
    const ts = valores[0].lastSeen;
    if (ts) {
      ctStatus.textContent = 'visto ' + formatarHoraPresenca(ts * 1000);
    } else {
      ctStatus.textContent = '';
    }
    ctStatus.classList.remove('digitando');
  } else {
    ctStatus.textContent = '';
    ctStatus.classList.remove('digitando');
  }
});

// Carrega inicial
fetch(WA_BASE + '/api/chats').then(r => r.json()).then(renderizarChats);

// ── Título com badge de não-lidas ──────────────────────────
function atualizarTituloComBadge() {
  if (totalNaoLidas > 0) {
    document.title = `(${totalNaoLidas}) WhatsApp Portal — WKL`;
  } else {
    document.title = 'WhatsApp Portal — WKL';
  }
}

// Recalcula total de não-lidas a partir do cache de chats
function recalcularNaoLidas(lista) {
  totalNaoLidas = lista.reduce((soma, c) => soma + (c.naoLidas || 0), 0);
  atualizarTituloComBadge();
}

// ── Foto de perfil ─────────────────────────────────────────
// Cache local no frontend para não recarregar a cada renderização da lista
const fotoCache = {}; // jid → url | 'erro'

async function carregarFoto(jid) {
  if (fotoCache[jid]) return fotoCache[jid] === 'erro' ? null : fotoCache[jid];
  try {
    const url = WA_BASE + `/api/foto/${encodeURIComponent(jid)}`;
    // Testa se a URL retorna algo válido fazendo um HEAD-like via fetch com redirect manual
    const resp = await fetch(url, { method: 'GET', redirect: 'follow' });
    if (resp.ok) {
      // A URL final após redirect é a foto real do WhatsApp
      fotoCache[jid] = url;
      return url;
    }
  } catch (_) {}
  fotoCache[jid] = 'erro';
  return null;
}

function aplicarFotoNaLista(jid, url) {
  document.querySelectorAll(`.chat-item[data-jid="${CSS.escape(jid)}"] .avatar-img`).forEach(img => {
    img.src = url;
    img.style.display = 'block';
    if (img.nextElementSibling) img.nextElementSibling.style.display = 'none';
  });
}

function aplicarFotoNoHeader(url) {
  if (!ctAvatarImg || !ctAvatarIni) return;
  ctAvatarImg.src = url;
  ctAvatarImg.style.display = 'block';
  ctAvatarIni.style.display = 'none';
}

// ── Presença ───────────────────────────────────────────────
async function atualizarPresenca(jid) {
  ctStatus.textContent = '';
  ctStatus.classList.remove('digitando');
  try {
    await fetch(WA_BASE + `/api/presenca/${encodeURIComponent(jid)}`, { method: 'POST' });
  } catch (_) {}
}

// ── Lista de chats ─────────────────────────────────────────
function renderizarChats(lista) {
  global_chats_cache = lista;
  recalcularNaoLidas(lista);

  const busca = inpBusca.value.toLowerCase();
  const filtrado = busca ? lista.filter(c => (c.nome || '').toLowerCase().includes(busca) || c.jid.includes(busca)) : lista;

  if (!filtrado.length) {
    listaChatsEl.innerHTML = '<div class="empty-hint">Nenhuma conversa ainda.<br>Inicie uma nova clicando em ✏</div>';
    return;
  }

  listaChatsEl.innerHTML = '';
  for (const chat of filtrado) {
    const el = criarItemChat(chat);
    listaChatsEl.appendChild(el);
    // Carrega foto de forma assíncrona sem bloquear renderização
    carregarFoto(chat.jid).then(url => {
      if (url) aplicarFotoNaLista(chat.jid, url);
    });
  }
}

function criarItemChat(chat) {
  const el = document.createElement('div');
  el.className = `chat-item${chat.jid === jidAtivo ? ' ativo' : ''}`;
  el.dataset.jid = chat.jid;
  const inicial = (chat.nome || '?')[0].toUpperCase();
  el.innerHTML = `
    <div class="ci-avatar">
      <img class="avatar-img" src="" alt="" style="display:none" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='flex'">
      <span class="avatar-inicial">${inicial}</span>
    </div>
    <div class="ci-body">
      <div class="ci-top">
        <span class="ci-nome">${esc(chat.nome)}</span>
        <span class="ci-hora">${chat.horario ? formatarHora(chat.horario) : ''}</span>
      </div>
      <div class="ci-bottom">
        <span class="ci-preview">${esc(chat.ultimaMensagem || '')}</span>
        ${chat.naoLidas > 0 ? `<span class="ci-badge">${chat.naoLidas}</span>` : ''}
      </div>
    </div>`;
  el.addEventListener('click', () => abrirChat(chat));
  return el;
}

inpBusca.addEventListener('input', () => {
  fetch(WA_BASE + '/api/chats').then(r => r.json()).then(renderizarChats);
});

// ── Abrir chat ─────────────────────────────────────────────
async function abrirChat(chat) {
  jidAtivo = chat.jid;

  // Zera contagem de não-lidas deste chat localmente
  const cachedChat = global_chats_cache.find(c => c.jid === chat.jid);
  if (cachedChat) cachedChat.naoLidas = 0;
  recalcularNaoLidas(global_chats_cache);

  // Header: inicial por padrão, depois tenta foto
  const inicial = (chat.nome || '?')[0].toUpperCase();
  ctAvatarIni.textContent = inicial;
  ctAvatarImg.style.display = 'none';
  ctAvatarIni.style.display = 'flex';

  ctNome.textContent   = chat.nome;
  ctNumero.textContent = chat.jid.endsWith('@lid')
    ? 'WhatsApp Multi-device'
    : chat.jid.replace('@s.whatsapp.net', '');

  // Presença
  atualizarPresenca(chat.jid);

  chatVazio.style.display = 'none';
  chatAtivo.classList.remove('hidden');

  document.querySelectorAll('.chat-item').forEach(el => el.classList.toggle('ativo', el.dataset.jid === jidAtivo));

  // Carrega foto do header de forma assíncrona
  carregarFoto(chat.jid).then(url => {
    if (url && jidAtivo === chat.jid) aplicarFotoNoHeader(url);
  });

  chatFeed.innerHTML = '';
  try {
    const msgs = await fetch(WA_BASE + `/api/mensagens/${encodeURIComponent(chat.jid)}`).then(r => r.json());
    if (!msgs.length) {
      const av = document.createElement('div');
      av.className = 'aviso-hist';
      av.textContent = 'As mensagens aparecerão aqui em tempo real';
      chatFeed.appendChild(av);
    } else {
      let ultimaData = '';
      for (const m of msgs) {
        const data = m.horario?.split(',')[0] || '';
        if (data !== ultimaData) { adicionarSeparadorData(data); ultimaData = data; }
        adicionarBubble(m);
      }
    }
    chatFeed.scrollTop = chatFeed.scrollHeight;
  } catch (e) { console.error(e); }

  inpMsg.focus();
}

// ── Bolhas ─────────────────────────────────────────────────
function adicionarBubble(msg) {
  const div = document.createElement('div');
  // tipo pode ser 'enviada', 'recebida' ou legado (nome do contato)
  const lado = (msg.tipo === 'enviada' || msg.de === 'eu') ? 'enviada' : 'recebida';
  div.className = `bubble ${lado}`;
  div.dataset.id = msg.id;

  const conteudo = renderConteudo(msg);
  const statusHtml = renderStatusTick(msg);
  div.innerHTML = `${conteudo}<div class="b-meta"><span class="b-hora">${formatarHora(msg.horario)}</span>${statusHtml}</div>`;

  div.addEventListener('dblclick', () => iniciarReply(msg));
  chatFeed.appendChild(div);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function renderConteudo(msg) {
  if (msg.tipoMidia === 'imagem')    return `🖼 <em>${esc(msg.texto)}</em>`;
  if (msg.tipoMidia === 'video')     return `🎥 <em>${esc(msg.texto)}</em>`;
  if (msg.tipoMidia === 'audio')     return `🎵 Áudio`;
  if (msg.tipoMidia === 'documento') return `📄 <em>${esc(msg.texto)}</em>`;
  if (msg.tipoMidia === 'figurinha') return `🎨 Figurinha`;
  return esc(msg.texto);
}

// Tick de status: ✓ para enviada, ✓✓ para entregue/lida
function renderStatusTick(msg) {
  const lado = msg.tipo === 'enviada' || msg.de === 'eu' ? 'enviada' : 'recebida';
  if (lado !== 'enviada') return '';
  const status = msg.status || 'enviada';
  if (status === 'entregue' || status === 'lida') {
    return `<span class="b-status entregue">✓✓</span>`;
  }
  return `<span class="b-status">✓</span>`;
}

function adicionarSeparadorData(data) {
  if (!data) return;
  const sep = document.createElement('div');
  sep.className = 'date-sep';
  sep.textContent = data;
  chatFeed.appendChild(sep);
}

// ── Reply ──────────────────────────────────────────────────
function iniciarReply(msg) {
  replyMsgId = msg.id;
  replyTexto.textContent = msg.texto;
  replyBar.classList.remove('hidden');
  inpMsg.focus();
}

document.getElementById('btn-cancelar-reply').addEventListener('click', () => {
  replyMsgId = null;
  replyBar.classList.add('hidden');
});

// ── Enviar texto ───────────────────────────────────────────
btnEnviar.addEventListener('click', enviar);
inpMsg.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
});
inpMsg.addEventListener('input', () => {
  inpMsg.style.height = 'auto';
  inpMsg.style.height = Math.min(inpMsg.scrollHeight, 120) + 'px';
});

async function enviar() {
  const texto = inpMsg.value.trim();
  if (!texto || !jidAtivo) return;
  inpMsg.value = '';
  inpMsg.style.height = 'auto';
  replyMsgId = null;
  replyBar.classList.add('hidden');
  btnEnviar.disabled = true;
  try {
    await fetch(WA_BASE + '/api/mensagens/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid: jidAtivo, texto }),
    });
  } catch (e) { alert('Erro: ' + e.message); }
  finally { btnEnviar.disabled = false; inpMsg.focus(); }
}

// ── Arquivo ────────────────────────────────────────────────
document.getElementById('inp-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file || !jidAtivo) return;
  arquivoPendente = file;
  abrirPreviewArquivo(file);
  e.target.value = '';
});

function abrirPreviewArquivo(file) {
  const area = document.getElementById('preview-area');
  area.innerHTML = '';
  const mime = file.type;

  if (mime.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    area.appendChild(img);
  } else if (mime.startsWith('video/')) {
    const vid = document.createElement('video');
    vid.src = URL.createObjectURL(file); vid.controls = true;
    area.appendChild(vid);
  } else {
    const ext = file.name.split('.').pop().toUpperCase();
    area.innerHTML = `<div class="preview-doc"><span class="preview-doc-icon">📄</span><div><strong>${esc(file.name)}</strong><br><small>${ext} · ${(file.size/1024).toFixed(1)} KB</small></div></div>`;
  }

  document.getElementById('modal-arquivo').classList.remove('hidden');
}

document.getElementById('btn-cancelar-arquivo').addEventListener('click', () => {
  arquivoPendente = null;
  document.getElementById('modal-arquivo').classList.add('hidden');
});

document.getElementById('btn-confirmar-envio').addEventListener('click', async () => {
  if (!arquivoPendente || !jidAtivo) return;
  const legenda = document.getElementById('inp-legenda').value;
  const btn = document.getElementById('btn-confirmar-envio');
  btn.disabled = true; btn.textContent = 'Enviando...';

  const fd = new FormData();
  fd.append('jid', jidAtivo);
  fd.append('arquivo', arquivoPendente);
  fd.append('legenda', legenda);

  try {
    await fetch(WA_BASE + '/api/mensagens/arquivo', { method: 'POST', body: fd });
    document.getElementById('modal-arquivo').classList.add('hidden');
    arquivoPendente = null;
    document.getElementById('inp-legenda').value = '';
  } catch (e) { alert('Erro ao enviar arquivo: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'Enviar'; }
});

// ── Modal Nova Conversa ────────────────────────────────────
async function abrirNovoChat() {
  document.getElementById('modal-novo-chat').classList.remove('hidden');
  await carregarContatosPortal('');
}

async function carregarContatosPortal(busca) {
  const lista = document.getElementById('lista-contatos-portal');
  lista.innerHTML = '<div class="hint-load">Buscando...</div>';
  try {
    const url = WA_BASE + '/api/portal-contatos' + (busca ? `?busca=${encodeURIComponent(busca)}` : '');
    const contatos = await fetch(url).then(r => r.json());

    if (!contatos.length) {
      lista.innerHTML = '<div class="hint-load">Nenhum contato encontrado.</div>';
      return;
    }

    lista.innerHTML = '';
    for (const c of contatos) {
      const el = document.createElement('div');
      el.className = 'contato-item';
      el.innerHTML = `
        <div class="contato-avatar">${c.nome[0].toUpperCase()}</div>
        <div class="contato-info">
          <div class="contato-nome">${esc(c.nome)}</div>
          <div class="contato-detalhe">${c.numero}${c.empresa ? ' · ' + esc(c.empresa) : ''}</div>
        </div>`;
      el.addEventListener('click', () => {
        document.getElementById('modal-novo-chat').classList.add('hidden');
        abrirChat({ jid: c.jid, nome: c.nome, ultimaMensagem: '', horario: '', naoLidas: 0 });
        // Garante que aparece na lista de chats
        if (!global_chats_cache.find(x => x.jid === c.jid)) {
          fetch(WA_BASE + '/api/chats').then(r => r.json()).then(renderizarChats);
        }
      });
      lista.appendChild(el);
    }
  } catch (e) {
    lista.innerHTML = `<div class="hint-load">Erro: ${e.message}</div>`;
  }
}

let _buscaTimer = null;
document.getElementById('inp-busca-contato').addEventListener('input', (e) => {
  clearTimeout(_buscaTimer);
  _buscaTimer = setTimeout(() => carregarContatosPortal(e.target.value.trim()), 350);
});

document.getElementById('btn-novo-chat').addEventListener('click', abrirNovoChat);
document.getElementById('btn-novo-chat-2').addEventListener('click', abrirNovoChat);

// Cache local de chats
let global_chats_cache = [];

// ── Modal Configurações ────────────────────────────────────
document.getElementById('btn-config').addEventListener('click', () => {
  const s = document.getElementById('cfg-status');
  if (s) s.textContent = whatsConectado ? '🟢 Conectado' : '🔴 Desconectado';
  const d = document.getElementById('btn-desconectar');
  if (d) d.disabled = !whatsConectado;
  document.getElementById('modal-config').classList.remove('hidden');
});

document.getElementById('btn-desconectar').addEventListener('click', async () => {
  if (!confirm('Deseja desconectar e limpar a sessão? Será necessário escanear o QR Code novamente.')) return;
  try {
    await fetch(WA_BASE + '/api/desconectar', { method: 'POST' });
    document.getElementById('modal-config').classList.add('hidden');
    qrOverlay.classList.remove('hidden');
    qrImg.src = ''; qrStatus.textContent = 'Aguardando QR Code...';
    listaChatsEl.innerHTML = '<div class="empty-hint">Nenhuma conversa ainda.</div>';
    jidAtivo = null;
    totalNaoLidas = 0;
    atualizarTituloComBadge();
    chatVazio.style.display = '';
    chatAtivo.classList.add('hidden');
  } catch (e) { alert('Erro: ' + e.message); }
});

// Fechar modais pelo botão ✕
document.querySelectorAll('[data-fechar]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.fechar).classList.add('hidden');
  });
});

// Fechar modal clicando fora
document.querySelectorAll('.overlay').forEach(el => {
  if (el.id === 'qr-overlay') return;
  el.addEventListener('click', (e) => { if (e.target === el) el.classList.add('hidden'); });
});

// ── Utils ──────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Formata horário de mensagem: "Agora", "HH:MM", "Ontem HH:MM", "DD/MM"
// horario vem no formato do toLocaleString pt-BR: "DD/MM/YYYY, HH:MM:SS"
function formatarHora(horario) {
  if (!horario) return '';

  // Tenta parsear o formato "DD/MM/YYYY, HH:MM:SS" ou "DD/MM/YYYY HH:MM:SS"
  const partes = horario.replace(', ', ' ').split(' ');
  if (partes.length < 2) return horario;

  const dateParts = partes[0].split('/'); // [DD, MM, YYYY]
  const timeParts = partes[1].split(':'); // [HH, MM, SS]

  if (dateParts.length < 3 || timeParts.length < 2) {
    // Fallback: retorna só HH:MM se não conseguir parsear
    return partes[1] ? partes[1].substring(0, 5) : horario;
  }

  const msgDate = new Date(
    parseInt(dateParts[2], 10),
    parseInt(dateParts[1], 10) - 1,
    parseInt(dateParts[0], 10),
    parseInt(timeParts[0], 10),
    parseInt(timeParts[1], 10)
  );

  const agora   = new Date();
  const hoje    = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const ontem   = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
  const msgDia  = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate());

  const hhmm = `${String(msgDate.getHours()).padStart(2, '0')}:${String(msgDate.getMinutes()).padStart(2, '0')}`;

  const diffMs   = agora - msgDate;
  const diffMins = Math.floor(diffMs / 60000);

  if (msgDia.getTime() === hoje.getTime()) {
    if (diffMins < 1) return 'Agora';
    return hhmm; // Hoje: só HH:MM
  }
  if (msgDia.getTime() === ontem.getTime()) {
    return `Ontem ${hhmm}`;
  }
  // Mais antigo: DD/MM
  return `${dateParts[0]}/${dateParts[1]}`;
}

// Formata timestamp em ms para indicador de presença
function formatarHoraPresenca(tsMs) {
  const agora  = new Date();
  const data   = new Date(tsMs);
  const hoje   = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const ontem  = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
  const diaMsg = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  const hhmm   = `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`;

  if (diaMsg.getTime() === hoje.getTime()) return `hoje às ${hhmm}`;
  if (diaMsg.getTime() === ontem.getTime()) return `ontem às ${hhmm}`;
  return `${String(data.getDate()).padStart(2,'0')}/${String(data.getMonth()+1).padStart(2,'0')} às ${hhmm}`;
}
