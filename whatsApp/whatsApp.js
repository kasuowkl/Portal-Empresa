/**
 * whatsApp.js — Conexão Baileys + Web UI de conversas
 * Porta: 3200
 * Este processo NUNCA precisa ser reiniciado (exceto reconexão de QR).
 * Encaminha mensagens recebidas para whatsapp-portal.js (porta 3201).
 */
const path       = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const fs         = require('fs');
const multer     = require('multer');

const { iniciarWhatsApp, enviarMensagem, enviarArquivo, listarChats, estaConectado, getSock, salvarMensagem, salvarStore, limparSessoesCorreompidas } = require('./services/whatsapp');
const { buscarContatosPortal } = require('./services/portalApi');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.locals.io = io;

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Chats
app.get('/api/chats', (_req, res) => res.json(listarChats()));

// Mensagens de um contato
app.get('/api/mensagens/:jid', (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  res.json(global.mensagens?.[jid] || []);
});

// Enviar texto
app.post('/api/mensagens/enviar', async (req, res) => {
  const { jid, texto } = req.body;
  if (!jid || !texto) return res.status(400).json({ erro: 'jid e texto são obrigatórios' });
  try {
    const msg = await enviarMensagem(jid, texto);
    io.emit('mensagem', msg);
    io.emit('chats', listarChats());
    res.json({ sucesso: true, msg });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Enviar arquivo
app.post('/api/mensagens/arquivo', upload.single('arquivo'), async (req, res) => {
  const { jid, legenda } = req.body;
  if (!jid || !req.file) return res.status(400).json({ erro: 'jid e arquivo são obrigatórios' });
  try {
    const msg = await enviarArquivo(jid, req.file, legenda || '');
    io.emit('mensagem', msg);
    io.emit('chats', listarChats());
    res.json({ sucesso: true, msg });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Contatos para Nova Conversa (WhatsApp em memória + Portal)
app.get('/api/portal-contatos', async (req, res) => {
  try {
    const { busca } = req.query;
    const b = (busca || '').toLowerCase();

    const whatsContatos = Object.values(global.contatos || {})
      .filter(c => c.jid.endsWith('@s.whatsapp.net'))
      .map(c => ({
        jid:     c.jid,
        nome:    c.nome || c.jid.replace('@s.whatsapp.net', ''),
        numero:  c.jid.replace('@s.whatsapp.net', ''),
        empresa: '',
        fonte:   'whatsapp',
      }));

    let portalContatos = [];
    try {
      portalContatos = await buscarContatosPortal(busca || '');
      portalContatos = portalContatos.map(c => ({ ...c, fonte: 'portal' }));
    } catch (e) {
      console.error('[portal-contatos] Portal indisponível:', e.message);
    }

    const mapa = {};
    for (const c of whatsContatos) mapa[c.numero] = c;
    for (const c of portalContatos) mapa[c.numero] = c;

    let resultado = Object.values(mapa);
    if (b) resultado = resultado.filter(c =>
      c.nome.toLowerCase().includes(b) ||
      c.numero.includes(b) ||
      (c.empresa || '').toLowerCase().includes(b)
    );

    resultado.sort((a, b) => a.nome.localeCompare(b.nome));
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Endpoint genérico de notificação (chamado pelo Portal para enviar WhatsApp)
app.post('/api/notificar', async (req, res) => {
  const { numero, mensagem } = req.body;
  if (!numero || !mensagem) return res.status(400).json({ erro: 'numero e mensagem são obrigatórios' });
  try {
    const jid = numero.includes('@') ? numero : `${numero.replace(/\D/g, '')}@s.whatsapp.net`;
    const msg = await enviarMensagem(jid, mensagem);
    io.emit('mensagem', msg);
    io.emit('chats', listarChats());
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Desconectar sessão
app.post('/api/desconectar', async (req, res) => {
  try {
    const authDir   = path.join(__dirname, 'auth_info_baileys');
    const storeFile = path.join(__dirname, 'data', 'store.json');
    if (fs.existsSync(authDir))   fs.rmSync(authDir,   { recursive: true, force: true });
    if (fs.existsSync(storeFile)) fs.rmSync(storeFile, { force: true });
    global.contatos  = {};
    global.chats     = {};
    global.mensagens = {};
    io.emit('chats', []);
    io.emit('status', { conectado: false, mensagem: 'Sessão encerrada.' });
    res.json({ sucesso: true });
    setTimeout(() => iniciarWhatsApp(io), 500);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Foto de perfil
const photoCache = {};
app.get('/api/foto/:jid', async (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  try {
    const cached = photoCache[jid];
    if (cached && Date.now() - cached.ts < 3600000) return res.redirect(cached.url);
    const s = getSock();
    if (!s) return res.status(404).end();
    const url = await s.profilePictureUrl(jid, 'image');
    photoCache[jid] = { url, ts: Date.now() };
    res.redirect(url);
  } catch { res.status(404).end(); }
});

// Presença
app.post('/api/presenca/:jid', async (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  try {
    const s = getSock();
    if (s) await s.subscribePresence(jid);
    res.json({ sucesso: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// Limpar sessões corrompidas (mantém creds.json, sem novo QR)
app.post('/api/limpar-sessoes', async (req, res) => {
  try {
    const resultado = limparSessoesCorreompidas();
    res.json({ sucesso: true, ...resultado });
    // Reconecta após limpeza
    setTimeout(() => iniciarWhatsApp(io), 1000);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Socket.IO
io.on('connection', (socket) => {
  socket.emit('status', { conectado: estaConectado() });
  socket.emit('chats', listarChats());
});

const PORT = process.env.PORT || 3200;
server.listen(PORT, () => {
  console.log(`[whatsapp] servidor rodando em http://localhost:${PORT}`);
  iniciarWhatsApp(io);
});
