const axios = require('axios');

const BASE = process.env.PORTAL_URL || 'http://localhost:3132';
const KEY  = process.env.PORTAL_API_KEY || '';
const LOGIN = process.env.PORTAL_SERVICE_LOGIN || 'sistema';

const api = axios.create({
  baseURL: BASE,
  timeout: 10000,
  headers: { 'x-api-key': KEY },
});

// Busca todos os contatos (usuários locais, AD e agenda) com qualquer telefone
async function buscarContatosPortal(busca = '') {
  try {
    const { data } = await api.get('/api/usuarios/lista-whatsapp');
    const lista = Array.isArray(data) ? data : [];

    const todos = lista.map(c => {
      const numero = (c.numero || '').replace(/\D/g, '');
      return {
        id:      c.login,
        nome:    c.nome,
        numero,
        empresa: c.empresa || '',
        jid:     `${numero}@s.whatsapp.net`,
        tipo:    c.tipo,
      };
    }).filter(c => c.numero);

    // Remove duplicatas por número
    const unicos = Object.values(Object.fromEntries(todos.map(c => [c.numero, c])));

    if (busca) {
      const b = busca.toLowerCase();
      return unicos.filter(c =>
        c.nome.toLowerCase().includes(b) ||
        c.numero.includes(b) ||
        (c.empresa || '').toLowerCase().includes(b)
      );
    }

    return unicos.sort((a, b) => a.nome.localeCompare(b.nome));
  } catch (err) {
    console.error('[portalApi] erro ao buscar contatos:', err.message);
    return [];
  }
}

// Busca usuário do Portal pelo número WhatsApp
// Tenta os dois formatos brasileiros: com e sem o 9 após o DDD
async function buscarUsuarioPorWhatsapp(numero) {
  const n = numero.replace(/\D/g, '');
  const variantes = [n];

  // Brasil: 55 + DDD(2) + 9 + 8 dígitos = 13 dígitos → tenta sem o 9
  if (n.length === 13 && n.startsWith('55')) {
    variantes.push(n.slice(0, 4) + n.slice(5)); // remove o 9 após DDD
  }
  // Brasil: 55 + DDD(2) + 8 dígitos = 12 dígitos → tenta com o 9
  if (n.length === 12 && n.startsWith('55')) {
    variantes.push(n.slice(0, 4) + '9' + n.slice(4)); // insere 9 após DDD
  }

  console.log(`[portalApi] buscarUsuario: numero=${numero}, variantes=${JSON.stringify(variantes)}`);
  for (const v of variantes) {
    try {
      const { data } = await api.get(`/api/usuarios/por-whatsapp/${v}`);
      console.log(`[portalApi] ${v} → encontrado: ${data?.login}`);
      if (data?.login) return data;
    } catch (err) {
      console.log(`[portalApi] ${v} → ${err.response?.status || err.message}`);
    }
  }
  return null;
}

// Aprovações
async function listarTodasPendentes() {
  try {
    const { data } = await api.get('/api/aprovacoes', {
      params: { status: 'Pendente', _whatsapp_login: LOGIN },
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[portalApi] listarTodasPendentes:', err.message);
    return [];
  }
}

async function listarPendentes(login) {
  const { data } = await api.get('/api/aprovacoes', { params: { _whatsapp_login: login } });
  const todas = data?.aprovacoes || (Array.isArray(data) ? data : []);
  return todas.filter(a => a.status === 'Pendente' && a.minha_decisao === 'Pendente');
}

// Lista todas as aprovações do usuário (para filtrar por status no bot)
async function listarAprovacoes(login) {
  const { data } = await api.get('/api/aprovacoes', { params: { _whatsapp_login: login } });
  return data?.aprovacoes || (Array.isArray(data) ? data : []);
}

async function detalharAprovacao(id, login) {
  const { data } = await api.get(`/api/aprovacoes/${id}`, { params: { _whatsapp_login: login || LOGIN } });
  return data;
}

async function responderAprovacao(id, login, decisao, motivo) {
  const { data } = await api.put(`/api/aprovacoes/${id}/responder`, { decisao, motivo: motivo || null, _whatsapp_login: login });
  return data;
}

// Envia log para o Portal WKL
async function registrarLogPortal({ usuario, ip, acao, sistema, detalhes }) {
  try {
    await api.post('/api/log-externo', { usuario, ip: ip || '::whatsapp', acao, sistema, detalhes });
  } catch { /* log é best-effort */ }
}

module.exports = { buscarContatosPortal, buscarUsuarioPorWhatsapp, listarPendentes, listarAprovacoes, listarTodasPendentes, detalharAprovacao, responderAprovacao, registrarLogPortal };
