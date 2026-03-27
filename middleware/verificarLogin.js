/**
 * ARQUIVO: middleware/verificarLogin.js
 * VERSÃO: 1.1.0
 * DESCRIÇÃO: Middleware para verificar se usuário está logado.
 *            Suporta acesso por serviços externos via x-api-key + _whatsapp_login.
 */

function verificarLogin(req, res, next) {
  // Sessão normal de browser
  if (req.session && req.session.usuario) {
    return next();
  }

  // Acesso por serviço externo (ex: WhatsApp) via API key
  const apiKey       = req.headers['x-api-key'];
  const serviceLogin = req.query._whatsapp_login || req.body?._whatsapp_login;
  const chaveCorreta = process.env.WHATSAPP_API_KEY;

  if (apiKey && chaveCorreta && apiKey === chaveCorreta && serviceLogin) {
    // Injeta usuário temporário sem persistir na sessão
    req.session.usuario = { usuario: serviceLogin, nivel: 'usuario' };
    return next();
  }

  req.session.redirectAfterLogin = req.originalUrl;
  res.redirect('/login.html');
}

module.exports = verificarLogin;
