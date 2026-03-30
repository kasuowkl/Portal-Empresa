/**
 * whatsapp-portal.js — Bot de aprovações + integração Portal WKL
 * Porta: 3210
 * Este processo pode ser reiniciado LIVREMENTE sem afetar a conexão WhatsApp.
 * Recebe mensagens encaminhadas do whatsApp.js (porta 3200).
 * Envia respostas chamando a API de envio do whatsApp.js.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const axios   = require('axios');

const { processarMensagem, getSessoes } = require('./services/messageHandler');
const { listarTodasPendentes, listarPendentes, detalharAprovacao, responderAprovacao } = require('./services/portalApi');
const { getConfig, saveConfig, reloadConfig, getDefaults } = require('./services/botConfig');
const log = require('./services/botLogger');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

const WHATSAPP_URL = process.env.WHATSAPP_URL || 'http://localhost:3200';
const BOT_PORT     = process.env.BOT_PORT || 3210;

// ── Enviar mensagem via whatsApp.js ─────────────────────────
async function enviarViaWhatsApp(jid, texto) {
  await axios.post(`${WHATSAPP_URL}/api/mensagens/enviar`, { jid, texto });
}

// ── Recebe mensagens encaminhadas do whatsApp.js ────────────
app.post('/api/mensagem-recebida', async (req, res) => {
  const { jid, texto, nome, msgId } = req.body;
  if (!jid || !texto) return res.status(400).json({ erro: 'jid e texto obrigatórios' });

  res.json({ recebido: true });

  try {
    await processarMensagem({
      jid,
      texto,
      nome,
      msgId,
      enviar: enviarViaWhatsApp,
    });
  } catch (err) {
    log.log('erro', `Erro ao processar mensagem: ${err.message}`, { jid });
    try {
      await enviarViaWhatsApp(jid, `⚠️ Erro interno: ${err.message}\n\nDigite *0* para voltar ao menu.`);
    } catch (_) {}
  }
});

// ── Aprovações API (para a página aprovacoesWhatsApp.html) ──

app.get('/api/aprovacoes', async (req, res) => {
  try {
    const { aprovador } = req.query;
    const dados = aprovador ? await listarPendentes(aprovador) : await listarTodasPendentes();
    res.json(Array.isArray(dados) ? dados : []);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/aprovacoes/:id', async (req, res) => {
  try {
    const login = req.query.login || req.query._whatsapp_login;
    const dados = await detalharAprovacao(req.params.id, login);
    res.json(dados);
  } catch (err) {
    res.status(500).json({ erro: err.response?.data?.erro || err.message });
  }
});

app.post('/api/aprovacoes/:id/aprovar', async (req, res) => {
  try {
    const { login } = req.body;
    if (!login) return res.status(400).json({ erro: 'Login obrigatório' });
    const resultado = await responderAprovacao(req.params.id, login, 'Aprovado', null);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ erro: err.response?.data?.erro || err.message });
  }
});

app.post('/api/aprovacoes/:id/reprovar', async (req, res) => {
  try {
    const { login, motivo } = req.body;
    if (!login)  return res.status(400).json({ erro: 'Login obrigatório' });
    if (!motivo) return res.status(400).json({ erro: 'Motivo obrigatório para reprovação' });
    const resultado = await responderAprovacao(req.params.id, login, 'Reprovado', motivo);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ erro: err.response?.data?.erro || err.message });
  }
});

app.post('/api/aprovacoes/:id/notificar', async (req, res) => {
  try {
    const { numero, mensagem } = req.body;
    if (!numero || !mensagem) return res.status(400).json({ erro: 'numero e mensagem são obrigatórios' });
    await enviarViaWhatsApp(`${numero.replace(/\D/g, '')}@s.whatsapp.net`, mensagem);
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── Admin API ───────────────────────────────────────────────

app.get('/api/admin/config', (_req, res) => {
  res.json(getConfig());
});

app.put('/api/admin/config', (req, res) => {
  try {
    saveConfig(req.body);
    log.log('config', 'Configurações atualizadas via admin');
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/admin/config/reset', (_req, res) => {
  try {
    saveConfig(getDefaults());
    log.log('config', 'Configurações restauradas ao padrão');
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/admin/logs', (_req, res) => {
  res.json(log.getBuffer());
});

app.delete('/api/admin/logs', (_req, res) => {
  log.clear();
  res.json({ sucesso: true });
});

app.post('/api/admin/limpar-sessoes', async (_req, res) => {
  try {
    const { data } = await axios.post(`${WHATSAPP_URL}/api/limpar-sessoes`);
    log.log('conexao', `Sessoes Signal limpas: ${data.removidos} arquivos removidos`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/admin/sessoes', (_req, res) => {
  const sessoes = getSessoes();
  const lista = [];
  for (const [jid, s] of sessoes) {
    lista.push({ jid, login: s.login, nome: s.nome });
  }
  res.json(lista);
});

// ── Páginas estáticas ───────────────────────────────────────
app.use('/aprovacoes', express.static(path.join(__dirname, 'public')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/ajuda',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'ajuda', 'index.html')));

// ── Socket.IO — Logs em tempo real ──────────────────────────
io.on('connection', (socket) => {
  socket.emit('logs:buffer', log.getBuffer());
});

log.on('log', (entry) => {
  io.emit('logs:new', entry);
});

// ── Start ───────────────────────────────────────────────────
server.listen(BOT_PORT, () => {
  log.log('conexao', `Bot servidor rodando em http://localhost:${BOT_PORT}`);
});
