/**
 * ARQUIVO: routes/auth.js
 * VERSÃO:  1.1.0
 * DATA:    2026-03-03
 * DESCRIÇÃO: Rotas de autenticação — Login local e via Domínio (AD)
 *
 * HISTÓRICO:
 * 1.0.0 - 2026-03-02 - Versão inicial (somente usuários locais)
 * 1.1.0 - 2026-03-03 - Suporte a login de usuários do domínio (AD)
 *
 * FLUXO DE LOGIN:
 *   1. Busca usuário na tabela `usuarios` (local)
 *   2. Se não encontrado, busca em `usuarios_dominio`
 *   3. Se encontrado no domínio, valida senha contra o AD via LDAP
 *   4. Cria sessão e registra log
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const sql     = require('mssql');
const ad      = require('../lib/ad');
const { enviarNotificacao } = require('../services/emailService');
const router  = express.Router();

// ============================================================
// POST /login — Autentica o usuário (local ou domínio)
// ============================================================
router.post('/login', async (req, res) => {
  const { usuario, senha } = req.body;
  const ip           = req.ip || req.connection.remoteAddress;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const pool         = req.app.locals.pool;

  if (!usuario || !senha) {
    return res.status(400).json({ erro: 'Informe o usuário e a senha.' });
  }

  const loginLimpo = usuario.trim().toLowerCase();

  try {
    // --------------------------------------------------------
    // 1. Tenta autenticação LOCAL
    // --------------------------------------------------------
    const resultadoLocal = await pool.request()
      .input('usuario', sql.VarChar, loginLimpo)
      .query(`
        SELECT id, nome, usuario, senha_hash, nivel, ativo
        FROM usuarios
        WHERE usuario = @usuario
      `);

    const usuarioLocal = resultadoLocal.recordset[0];

    if (usuarioLocal) {
      if (!usuarioLocal.ativo) {
        logAtividade.info(`Login bloqueado (local) — usuário: "${loginLimpo}" | IP: ${ip}`);
        return res.status(403).json({ erro: 'Usuário bloqueado. Contate o administrador.' });
      }

      const senhaCorreta = await bcrypt.compare(senha, usuarioLocal.senha_hash);
      if (!senhaCorreta) {
        logAtividade.info(`Login falhou (local) — senha incorreta: "${loginLimpo}" | IP: ${ip}`);
        enviarNotificacao(pool, 'portal.login_falha', { usuario: loginLimpo, motivo: 'Senha incorreta', ip });
        return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
      }

      req.session.usuario = {
        id:      usuarioLocal.id,
        nome:    usuarioLocal.nome,
        usuario: usuarioLocal.usuario,
        nivel:   usuarioLocal.nivel,
        tipo:    'local'
      };

      await registrarLogin(pool, loginLimpo, ip, usuarioLocal.nivel, 'local');
      logAtividade.info(`Login realizado (local) — usuário: "${loginLimpo}" | Nível: ${usuarioLocal.nivel} | IP: ${ip}`);
      enviarNotificacao(pool, 'portal.login', { usuario: loginLimpo, nome: usuarioLocal.nome, tipo: 'local', ip });
      return res.json({ sucesso: true, redirecionar: '/portal.html' });
    }

    // --------------------------------------------------------
    // 2. Não é usuário local — tenta autenticação de DOMÍNIO
    // --------------------------------------------------------
    const resultadoDominio = await pool.request()
      .input('login', sql.VarChar, loginLimpo)
      .query(`
        SELECT id, login, nome, email, nivel, ativo
        FROM usuarios_dominio
        WHERE login = @login
      `);

    const usuarioDominio = resultadoDominio.recordset[0];

    if (!usuarioDominio) {
      logAtividade.info(`Login falhou — usuário inexistente: "${loginLimpo}" | IP: ${ip}`);
      enviarNotificacao(pool, 'portal.login_falha', { usuario: loginLimpo, motivo: 'Usuário inexistente', ip });
      return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
    }

    if (!usuarioDominio.ativo) {
      logAtividade.info(`Login bloqueado (domínio) — usuário: "${loginLimpo}" | IP: ${ip}`);
      enviarNotificacao(pool, 'portal.usuario_bloqueado', { usuario: loginLimpo, ip });
      return res.status(403).json({ erro: 'Usuário bloqueado. Contate o administrador.' });
    }

    // Lê configuração do AD
    const configAD = await ad.lerConfigAD(pool);

    if (!ad.configValida(configAD)) {
      logErro.error(`Login de domínio falhou — AD não configurado. Usuário: "${loginLimpo}"`);
      return res.status(503).json({ erro: 'Autenticação de domínio indisponível. Contate o administrador.' });
    }

    // Valida senha contra o AD
    try {
      await ad.autenticarUsuario(configAD, loginLimpo, senha);
    } catch (errAD) {
      logAtividade.info(`Login falhou (domínio) — senha incorreta: "${loginLimpo}" | IP: ${ip}`);
      return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
    }

    req.session.usuario = {
      id:      usuarioDominio.id,
      nome:    usuarioDominio.nome,
      usuario: usuarioDominio.login,
      nivel:   usuarioDominio.nivel,
      tipo:    'dominio'
    };

    await registrarLogin(pool, loginLimpo, ip, usuarioDominio.nivel, 'domínio');
    logAtividade.info(`Login realizado (domínio) — usuário: "${loginLimpo}" | Nível: ${usuarioDominio.nivel} | IP: ${ip}`);
    enviarNotificacao(pool, 'portal.login', { usuario: loginLimpo, nome: usuarioDominio.nome, tipo: 'domínio', ip });
    return res.json({ sucesso: true, redirecionar: '/portal.html' });

  } catch (erro) {
    logErro.error(`Erro no login de "${loginLimpo}": ${erro.message}`);
    try {
      await pool.request()
        .input('origem',   sql.VarChar, 'routes/auth.js - POST /login')
        .input('mensagem', sql.VarChar, erro.message)
        .input('stack',    sql.VarChar, erro.stack)
        .query(`INSERT INTO logs_erro (origem, mensagem, stack) VALUES (@origem, @mensagem, @stack)`);
    } catch (_) {}
    res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
});

// ============================================================
// GET /logout — Encerra a sessão
// ============================================================
router.get('/logout', (req, res) => {
  const logAtividade = req.app.locals.logAtividade;
  const usuario      = req.session?.usuario?.usuario || 'desconhecido';
  const ip           = req.ip || req.connection.remoteAddress;

  req.session.destroy(() => {
    logAtividade.info(`Logout — usuário: "${usuario}" | IP: ${ip}`);
    res.redirect('/login.html');
  });
});

// ============================================================
// GET /sessao — Dados do usuário logado (usado pelo menu)
// ============================================================
router.get('/sessao', (req, res) => {
  if (req.session && req.session.usuario) {
    res.json({
      logado:  true,
      nome:    req.session.usuario.nome,
      usuario: req.session.usuario.usuario,
      nivel:   req.session.usuario.nivel,
      tipo:    req.session.usuario.tipo || 'local'
    });
  } else {
    res.json({ logado: false });
  }
});

// ============================================================
// Registra login na tabela logs_atividade
// ============================================================
async function registrarLogin(pool, usuario, ip, nivel, tipo) {
  try {
    await pool.request()
      .input('usuario',  sql.VarChar, usuario)
      .input('acao',     sql.VarChar, 'LOGIN')
      .input('ip',       sql.VarChar, ip)
      .input('sistema',  sql.VarChar, 'portal')
      .input('detalhes', sql.VarChar, `Nível: ${nivel} | Tipo: ${tipo}`)
      .query(`INSERT INTO logs_atividade (usuario, acao, ip, sistema, detalhes) VALUES (@usuario, @acao, @ip, @sistema, @detalhes)`);
  } catch (_) {}
}

module.exports = router;
