const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  makeCacheableSignalKeyStore,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino   = require('pino');
const qrcode = require('qrcode');
const fs     = require('fs');
const path   = require('path');
// Cache simples para retry de mensagens (evita Bad MAC)
const msgRetryCache = new Map();
const axios = require('axios');

const BOT_URL = process.env.BOT_URL || 'http://localhost:3210';

const STORE_FILE = path.join(__dirname, '..', 'data', 'store.json');

let sock      = null;
let conectado = false;
const lidMap  = {};  // @lid → @s.whatsapp.net
const phoneMap = {}; // qualquer JID → número de telefone (para auto-login)
const msgProcessadas = new Set(); // IDs de mensagens já processadas (dedup)
const msgEnviadas = new Map();    // msgId → { jid, texto, tentativas, ts } para retry por status

// ── Persistência ───────────────────────────────────────────
function carregarStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      global.contatos  = raw.contatos  || {};
      global.chats     = raw.chats     || {};
      global.mensagens = raw.mensagens || {};
      // Restaura lidMap salvo
      const savedLidMap = raw.lidMap || {};
      Object.assign(lidMap, savedLidMap);
      console.log(`[store] carregado: ${Object.keys(global.chats).length} chats, ${Object.keys(global.contatos).length} contatos, ${Object.keys(savedLidMap).length} lids`);
      return;
    }
  } catch (e) { console.error('[store] erro ao carregar:', e.message); }
  global.contatos  = {};
  global.chats     = {};
  global.mensagens = {};
}

let _saveTimer = null;
function salvarStore() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify({ contatos: global.contatos, chats: global.chats, mensagens: global.mensagens, lidMap }));
    } catch (e) { console.error('[store] erro ao salvar:', e.message); }
  }, 1000);
}

carregarStore();

// ── Expõe instância do socket ──────────────────────────────
function getSock() { return sock; }

// ── WhatsApp ───────────────────────────────────────────────
async function iniciarWhatsApp(io) {
  // Fecha instância anterior para evitar múltiplas conexões
  if (sock) {
    try { sock.ev.removeAllListeners(); sock.end(); } catch (_) {}
    sock = null;
  }

  const authDir = path.join(__dirname, '..', 'auth_info_baileys');
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  console.log(`[whatsapp] versão Baileys: ${version.join('.')}`);

  const logger = pino({ level: 'warn' });

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    msgRetryCounterCache: msgRetryCache,
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => {
      // Busca mensagem no store para retry de decrypt
      const jid = key.remoteJid;
      const msgs = global.mensagens[jid] || [];
      const found = msgs.find(m => m.id === key.id);
      // Retorna mensagem vazia em vez de undefined para permitir retry
      return found ? { conversation: found.texto } : { conversation: '' };
    },
    patchMessageBeforeSending: async (msg) => {
      // Garante prekeys atualizadas antes de cada envio
      try { await sock.uploadPreKeysToServerIfRequired(); } catch (_) {}
      return msg;
    },
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      const qrDataUrl = await qrcode.toDataURL(qr);
      io.emit('qr', qrDataUrl);
    }
    if (connection === 'open') {
      console.log('[whatsapp] conectado!');
      conectado = true;
      io.emit('status', { conectado: true });
      io.emit('chats', listarChats());
    }
    if (connection === 'close') {
      const motivo     = lastDisconnect?.error?.output?.statusCode;
      const reconectar = motivo !== DisconnectReason.loggedOut;
      conectado = false;
      io.emit('status', { conectado: false });
      if (motivo === DisconnectReason.loggedOut) {
        // Sessão expirou — limpa auth e aguarda novo QR
        console.log('[whatsapp] sessão expirou, limpando auth para novo QR...');
        try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (_) {}
      }
      if (reconectar) setTimeout(() => iniciarWhatsApp(io), 5000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('contacts.upsert', (lista) => {
    for (const c of lista) {
      global.contatos[c.id] = { jid: c.id, nome: c.name || c.notify || c.id.replace(/@\w+\.net/, ''), pushName: c.notify || c.name || '' };
      // Mapeia @lid ↔ @s.whatsapp.net a partir do campo lid
      if (c.lid) {
        const lidJid = c.lid.endsWith('@lid') ? c.lid : `${c.lid}@lid`;
        if (c.id.endsWith('@s.whatsapp.net')) {
          lidMap[lidJid] = c.id;
          console.log(`[lidMap] ${lidJid} → ${c.id} (${c.name || c.notify || ''})`);
        }
      }
    }
    salvarStore();
  });

  sock.ev.on('contacts.update', (lista) => {
    for (const c of lista) {
      if (global.contatos[c.id]) global.contatos[c.id].nome = c.name || c.notify || global.contatos[c.id].nome;
    }
    salvarStore();
  });

  sock.ev.on('messaging-history.set', ({ chats: listaH, contacts: contatosH }) => {
    console.log(`[whatsapp] history.set: ${(listaH||[]).length} chats, ${(contatosH||[]).length} contatos`);
    for (const c of (contatosH || [])) {
      global.contatos[c.id] = { jid: c.id, nome: c.name || c.notify || c.id.replace('@s.whatsapp.net', ''), pushName: c.notify || c.name || '' };
    }
    for (const c of (listaH || [])) {
      if (!c.id.endsWith('@s.whatsapp.net')) continue;
      const nome = global.contatos[c.id]?.nome || c.id.replace('@s.whatsapp.net', '');
      if (!global.chats[c.id]) global.chats[c.id] = { jid: c.id, nome, ultimaMensagem: '', horario: '', naoLidas: c.unreadCount || 0 };
    }
    salvarStore();
    io.emit('chats', listarChats());
  });

  sock.ev.on('chats.upsert', (lista) => {
    for (const c of lista) {
      if (!c.id.endsWith('@s.whatsapp.net')) continue;
      const nome = global.contatos[c.id]?.nome || c.id.replace('@s.whatsapp.net', '');
      global.chats[c.id] = { jid: c.id, nome, ultimaMensagem: global.chats[c.id]?.ultimaMensagem || '', horario: global.chats[c.id]?.horario || '', naoLidas: c.unreadCount || 0 };
    }
    salvarStore();
    io.emit('chats', listarChats());
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      console.log(`[whatsapp] upsert: jid=${msg.key.remoteJid} fromMe=${msg.key.fromMe} hasMsg=${!!msg.message} id=${msg.key.id}`);
      if (!msg.message) continue;

      // Deduplicação: evita processar mesma mensagem 2x (@s.whatsapp.net + @lid)
      const msgId = msg.key.id;
      if (msgProcessadas.has(msgId)) continue;
      msgProcessadas.add(msgId);
      // Limpa set antigo para não crescer infinitamente
      if (msgProcessadas.size > 500) {
        const arr = [...msgProcessadas];
        arr.splice(0, 250).forEach(id => msgProcessadas.delete(id));
      }

      let jid = msg.key.remoteJid;

      // Resolve @lid → @s.whatsapp.net
      if (jid.endsWith('@lid')) {
        if (lidMap[jid]) {
          jid = lidMap[jid];
        } else {
          // Tenta remoteJidAlt (campo nativo do Baileys com o JID real)
          const jidAlt    = msg.key.remoteJidAlt || '';
          const senderPn  = msg.key.senderPn || msg.key.participant || '';
          const resolucao = jidAlt.endsWith('@s.whatsapp.net') ? jidAlt
                          : senderPn.endsWith('@s.whatsapp.net') ? senderPn
                          : '';
          if (resolucao) {
            jid = resolucao;
            lidMap[msg.key.remoteJid] = jid;
            salvarStore();
            console.log(`[lidMap] resolvido: ${msg.key.remoteJid} → ${jid}`);
          } else {
            console.log(`[whatsapp] @lid sem mapeamento: ${msg.key.remoteJid} | key: ${JSON.stringify(msg.key)}`);
            continue;
          }
        }
      }

      // Aceita apenas @s.whatsapp.net
      if (!jid.endsWith('@s.whatsapp.net')) continue;
      const fromMe = msg.key.fromMe;
      const texto  = extrairTexto(msg);
      const horario = new Date(msg.messageTimestamp * 1000).toLocaleString('pt-BR');
      const nome   = msg.pushName || global.contatos[jid]?.nome || jid.replace('@s.whatsapp.net', '');
      const tipo   = detectarTipoMensagem(msg);

      // Atualiza nome com pushName
      if (msg.pushName && (!global.contatos[jid] || !global.contatos[jid].nome || global.contatos[jid].nome === jid.replace('@s.whatsapp.net', ''))) {
        global.contatos[jid] = { jid, nome: msg.pushName, pushName: msg.pushName };
        if (global.chats[jid]) global.chats[jid].nome = msg.pushName;
      } else if (!global.contatos[jid]) {
        global.contatos[jid] = { jid, nome, pushName: msg.pushName || '' };
      }

      const status = fromMe ? 'enviada' : 'recebida';
      const entrada = { id: msgId, jid, de: fromMe ? 'eu' : jid, nome, texto, horario, tipo: status, tipoMidia: tipo !== 'texto' ? tipo : null, status };

      salvarMensagem(jid, entrada);
      global.chats[jid] = { jid, nome, ultimaMensagem: texto, horario, naoLidas: fromMe ? 0 : (global.chats[jid]?.naoLidas || 0) + 1 };
      salvarStore();
      io.emit('mensagem', entrada);
      io.emit('chats', listarChats());

      if (!fromMe) {
        console.log(`[whatsapp] msg de ${nome}: ${texto}`);
        // Encaminha para o bot (whatsapp-portal.js) via HTTP — fire & forget
        axios.post(`${BOT_URL}/api/mensagem-recebida`, { jid, texto, nome, msgId })
          .catch(err => console.log(`[whatsapp] bot indisponível: ${err.message}`));
      }
    }
  });

  // Retry automático: monitora status de entrega
  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      const msgId = update.key?.id;
      if (!msgId || !msgEnviadas.has(msgId)) continue;

      const status = update.update?.status;
      // Status 4 = ERROR, status 5 = PLAYED (OK), status 3 = DELIVERY (OK), status 2 = SERVER_ACK (OK)
      if (status === 4) { // ERROR — mensagem não entregue
        const info = msgEnviadas.get(msgId);
        if (info.tentativas >= 2) {
          console.log(`[whatsapp] retry esgotado para msg ${msgId} (${info.tentativas} tentativas)`);
          msgEnviadas.delete(msgId);
          continue;
        }
        info.tentativas++;
        console.log(`[whatsapp] retry ${info.tentativas} para msg ${msgId} → ${info.jid}`);

        // Tenta reenviar com JID alternativo
        const altJid = info.destFinal.endsWith('@lid')
          ? (lidMap[info.destFinal] || info.jid)
          : (Object.entries(lidMap).find(([lid, snet]) => snet === info.destFinal)?.[0] || info.destFinal);

        try {
          await new Promise(r => setTimeout(r, 2000));
          await sock.sendMessage(altJid, { text: info.texto });
          console.log(`[whatsapp] retry enviado para ${altJid}`);
        } catch (err) {
          console.log(`[whatsapp] retry falhou: ${err.message}`);
        }
        msgEnviadas.delete(msgId);
      } else if (status >= 2) {
        // Entregue com sucesso — remove do mapa
        msgEnviadas.delete(msgId);
      }
    }
  });

  // Presença em tempo real
  sock.ev.on('presence.update', ({ id, presences }) => {
    io.emit('presence', { jid: id, presences });
  });
}

async function enviarMensagem(jid, texto) {
  if (!sock) throw new Error('WhatsApp não conectado');
  const dest = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
  let destFinal = (dest.endsWith('@lid') && lidMap[dest]) ? lidMap[dest] : dest;

  // Verifica número no WhatsApp e obtém JID correto
  // IMPORTANTE: usar o JID que onWhatsApp retornar, inclusive @lid
  // Forçar @s.whatsapp.net causa "Aguardando mensagem" em celulares com registro LID
  if (destFinal.endsWith('@s.whatsapp.net')) {
    const numero = destFinal.replace('@s.whatsapp.net', '');
    try {
      const [resultado] = await sock.onWhatsApp(numero);
      if (resultado && resultado.exists) {
        // Salva mapeamentos bidireccionais
        phoneMap[resultado.jid] = numero;
        if (resultado.jid !== dest) phoneMap[dest] = numero;

        if (resultado.jid.endsWith('@lid')) {
          // Mapeia @lid ↔ @s.whatsapp.net
          lidMap[resultado.jid] = destFinal;
          salvarStore();
        }

        // Usa o JID que o WhatsApp retornou (pode ser @lid ou @s.whatsapp.net)
        console.log(`[whatsapp] onWhatsApp: ${numero} → ${resultado.jid}`);
        destFinal = resultado.jid;
      } else {
        console.log(`[whatsapp] onWhatsApp: ${numero} NÃO encontrado no WhatsApp`);
      }
    } catch (e) {
      console.log(`[whatsapp] onWhatsApp erro: ${e.message} — enviando para ${destFinal}`);
    }
  }

  // Envia com retry automático
  let enviado = false;
  let tentativas = 0;
  const maxTentativas = 3;
  const jidsParaTentar = [destFinal];

  // Se destFinal é @lid, adiciona @s.whatsapp.net como fallback e vice-versa
  if (destFinal.endsWith('@lid') && lidMap[destFinal]) {
    jidsParaTentar.push(lidMap[destFinal]);
  } else if (destFinal.endsWith('@s.whatsapp.net')) {
    // Busca o @lid correspondente como alternativa
    const lidJid = Object.entries(lidMap).find(([lid, snet]) => snet === destFinal)?.[0];
    if (lidJid) jidsParaTentar.push(lidJid);
  }

  for (const tentarJid of jidsParaTentar) {
    if (enviado) break;
    tentativas++;
    try {
      const sent = await sock.sendMessage(tentarJid, { text: texto });
      console.log(`[whatsapp] mensagem enviada para ${tentarJid} (tentativa ${tentativas})`);
      enviado = true;
      // Salva para retry por status de entrega
      if (sent?.key?.id) {
        msgEnviadas.set(sent.key.id, { jid: dest, destFinal: tentarJid, texto, tentativas: 0, ts: Date.now() });
        // Limpa mapa antigo (> 5 min)
        if (msgEnviadas.size > 100) {
          const agora = Date.now();
          for (const [id, m] of msgEnviadas) {
            if (agora - m.ts > 300000) msgEnviadas.delete(id);
          }
        }
      }
    } catch (err) {
      console.log(`[whatsapp] falha envio para ${tentarJid}: ${err.message} (tentativa ${tentativas})`);
      if (tentativas < jidsParaTentar.length) {
        // Aguarda antes de tentar o próximo JID
        await new Promise(r => setTimeout(r, 1500));
      } else {
        throw err;
      }
    }
  }

  // Salva sempre com @s.whatsapp.net no store para evitar chats duplicados na web UI
  const chatJid = destFinal.endsWith('@lid') ? (lidMap[destFinal] || dest) : destFinal;
  const nome = global.contatos[chatJid]?.nome || global.contatos[dest]?.nome || chatJid.replace('@s.whatsapp.net', '').replace('@lid', '');
  const saida = { id: Date.now().toString(), jid: chatJid, de: 'eu', nome, texto, horario: new Date().toLocaleString('pt-BR'), tipo: 'enviada', tipoMidia: null, status: 'enviada' };
  salvarMensagem(chatJid, saida);
  global.chats[chatJid] = { jid: chatJid, nome, ultimaMensagem: texto, horario: saida.horario, naoLidas: 0 };
  salvarStore();
  return saida;
}

async function enviarArquivo(jid, file, legenda) {
  if (!sock) throw new Error('WhatsApp não conectado');
  const dest     = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
  const mime     = file.mimetype;
  const nome     = global.contatos[dest]?.nome || dest.replace('@s.whatsapp.net', '');
  let   conteudo = {};
  let   tipoMidia = 'documento';

  if (mime.startsWith('image/')) {
    conteudo  = { image: file.buffer, caption: legenda || undefined };
    tipoMidia = 'imagem';
  } else if (mime.startsWith('video/')) {
    conteudo  = { video: file.buffer, caption: legenda || undefined };
    tipoMidia = 'video';
  } else if (mime.startsWith('audio/')) {
    conteudo  = { audio: file.buffer, mimetype: mime };
    tipoMidia = 'audio';
  } else {
    conteudo  = { document: file.buffer, mimetype: mime, fileName: file.originalname };
    tipoMidia = 'documento';
  }

  await sock.sendMessage(dest, conteudo);

  const texto = tipoMidia === 'imagem' ? `🖼 ${legenda || 'Imagem'}` :
                tipoMidia === 'video'  ? `🎥 ${legenda || 'Vídeo'}` :
                tipoMidia === 'audio'  ? '🎵 Áudio' :
                `📄 ${file.originalname}`;

  const saida = { id: Date.now().toString(), jid: dest, de: 'eu', nome, texto, horario: new Date().toLocaleString('pt-BR'), tipo: 'enviada', tipoMidia, status: 'enviada' };
  salvarMensagem(dest, saida);
  global.chats[dest] = { jid: dest, nome, ultimaMensagem: texto, horario: saida.horario, naoLidas: 0 };
  salvarStore();
  return saida;
}

function listarChats() {
  return Object.values(global.chats).sort((a, b) => b.horario > a.horario ? 1 : -1);
}

function extrairTexto(msg) {
  const m = msg.message;
  if (m.conversation)               return m.conversation;
  if (m.extendedTextMessage?.text)  return m.extendedTextMessage.text;
  if (m.imageMessage)               return m.imageMessage.caption ? `🖼 ${m.imageMessage.caption}` : '🖼 Imagem';
  if (m.videoMessage)               return m.videoMessage.caption ? `🎥 ${m.videoMessage.caption}` : '🎥 Vídeo';
  if (m.audioMessage)               return '🎵 Áudio';
  if (m.documentMessage)            return `📄 ${m.documentMessage.fileName || 'Documento'}`;
  if (m.stickerMessage)             return '🎨 Figurinha';
  return '[mídia]';
}

function detectarTipoMensagem(msg) {
  const m = msg.message;
  if (m.imageMessage)    return 'imagem';
  if (m.videoMessage)    return 'video';
  if (m.audioMessage)    return 'audio';
  if (m.documentMessage) return 'documento';
  if (m.stickerMessage)  return 'figurinha';
  return 'texto';
}

function salvarMensagem(jid, msg) {
  if (!global.mensagens[jid]) global.mensagens[jid] = [];
  global.mensagens[jid].push(msg);
  if (global.mensagens[jid].length > 100) global.mensagens[jid].shift();
}

function estaConectado() { return conectado; }

// Retorna o número de telefone associado a um JID (via phoneMap ou extração direta)
function obterNumeroPorJid(jid) {
  if (phoneMap[jid]) return phoneMap[jid];
  if (jid.endsWith('@s.whatsapp.net')) return jid.replace('@s.whatsapp.net', '');
  // Tenta encontrar pelo contato salvo
  const contato = global.contatos[jid];
  if (contato?.jid?.endsWith('@s.whatsapp.net')) return contato.jid.replace('@s.whatsapp.net', '');
  return null;
}

// Limpa sessões Signal corrompidas mantendo creds.json (sem precisar rescanear QR)
function limparSessoesCorreompidas() {
  const authDir = path.join(__dirname, '..', 'auth_info_baileys');
  if (!fs.existsSync(authDir)) return { removidos: 0 };
  const files = fs.readdirSync(authDir);
  let removidos = 0;
  for (const file of files) {
    if (file === 'creds.json') continue; // Preserva credenciais
    if (file.startsWith('session-') || file.startsWith('sender-key-') || file.startsWith('app-state-sync-key-')) {
      fs.unlinkSync(path.join(authDir, file));
      removidos++;
    }
  }
  console.log(`[whatsapp] limpeza: ${removidos} arquivos de sessão removidos`);
  return { removidos };
}

module.exports = { iniciarWhatsApp, enviarMensagem, enviarArquivo, listarChats, estaConectado, getSock, obterNumeroPorJid, salvarMensagem, salvarStore, limparSessoesCorreompidas };
