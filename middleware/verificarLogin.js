/**
 * ARQUIVO: middleware/verificarLogin.js
 * VERSÃO: 1.1.0
 * DESCRIÇÃO: Middleware para verificar se usuário está logado.
 *            Aceita também autenticação via API Key (x-api-key header)
 *            para integrações server-to-server (ex: WhatsApp bot).
 *            Suporta acesso por serviços externos via x-api-key + _whatsapp_login.
 */

const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || '';

function verificarLogin(req, res, next) {
  // Sessão normal de browser
  if (req.session && req.session.usuario) {
    return next();
  }

  // Autenticação por API Key (integrações externas, ex: WhatsApp)
  const apiKey = req.headers['x-api-key'];
  if (WHATSAPP_API_KEY && apiKey === WHATSAPP_API_KEY) {
    // Login informado no body ou query
    const login = req.body?._whatsapp_login || req.query._whatsapp_login;
    if (!login) {
      return res.status(401).json({ erro: 'API Key válida mas _whatsapp_login não informado.' });
    }
    // Injeta sessão temporária para o request
    req.session = req.session || {};
    req.session.usuario = { usuario: login, login, nome: login, perfil: 'EXTERNO' };
    return next();
  }

  // Requisição de browser — redireciona para login
  if (req.accepts('html')) {
    req.session.redirectAfterLogin = req.originalUrl;
    return res.redirect('/login.html');
  }

  return res.status(401).json({ erro: 'Não autenticado.' });
}

module.exports = verificarLogin;
