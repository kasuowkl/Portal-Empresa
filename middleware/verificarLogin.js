/**
 * ARQUIVO: middleware/verificarLogin.js
 * VERSÃO: 1.0.0
 * DESCRIÇÃO: Middleware para verificar se usuário está logado
 */

function verificarLogin(req, res, next) {
  if (req.session && req.session.usuario) {
    return next();
  }
  req.session.redirectAfterLogin = req.originalUrl;
  res.redirect('/login.html');
}

module.exports = verificarLogin;
