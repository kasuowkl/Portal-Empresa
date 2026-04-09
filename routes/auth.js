/**
 * ARQUIVO: routes/auth.js
 * VERSÃƒO:  1.1.0
 * DATA:    2026-03-03
 * DESCRIÃ‡ÃƒO: Rotas de autenticaÃ§Ã£o â€” Login local e via DomÃ­nio (AD)
 *
 * HISTÃ“RICO:
 * 1.0.0 - 2026-03-02 - VersÃ£o inicial (somente usuÃ¡rios locais)
 * 1.1.0 - 2026-03-03 - Suporte a login de usuÃ¡rios do domÃ­nio (AD)
 *
 * FLUXO DE LOGIN:
 *   1. Busca usuÃ¡rio na tabela `usuarios` (local)
 *   2. Se nÃ£o encontrado, busca em `usuarios_dominio`
 *   3. Se encontrado no domÃ­nio, valida senha contra o AD via LDAP
 *   4. Cria sessÃ£o e registra log
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const sql     = require('mssql');
const ad      = require('../lib/ad');
const { enviarNotificacao } = require('../services/emailService');
const { enviarNotificacaoWhatsAppPorChips } = require('../services/whatsappDispatchService');
const { renderizarMensagemWhatsApp } = require('../services/whatsappTemplateService');
const router  = express.Router();

async function enviarWhatsAppPortal(pool, evento, contexto, meta = {}) {
  const mensagem = await renderizarMensagemWhatsApp(pool, evento, {
    nome: contexto.nome || contexto.usuario || 'usuário',
    usuario: contexto.usuario || '-',
    tipo: contexto.tipo || '-',
    motivo: contexto.motivo || '-',
    ip: contexto.ip || '-',
    link_portal: 'http://192.168.0.80:3132/portal.html',
  });

  await enviarNotificacaoWhatsAppPorChips(pool, {
    evento,
    sistema: 'portal',
    mensagem,
    usuario: meta.usuario || 'sistema',
    ip: meta.ip || contexto.ip || '',
    mapaChips: {
      novo_usuario: contexto.usuario ? [contexto.usuario] : [],
      gestores_setor: [],
    },
  });
}

// ============================================================
// POST /login â€” Autentica o usuÃ¡rio (local ou domÃ­nio)
// ============================================================
router.post('/login', async (req, res) => {
  const { usuario, senha } = req.body;
  const ip           = req.ip || req.connection.remoteAddress;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const pool         = req.app.locals.pool;

  if (!usuario || !senha) {
    return res.status(400).json({ erro: 'Informe o usuÃ¡rio e a senha.' });
  }

  const loginLimpo = usuario.trim().toLowerCase();

  try {
    // --------------------------------------------------------
    // 1. Tenta autenticaÃ§Ã£o LOCAL
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
        logAtividade.info(`Login bloqueado (local) â€” usuÃ¡rio: "${loginLimpo}" | IP: ${ip}`);
        return res.status(403).json({ erro: 'UsuÃ¡rio bloqueado. Contate o administrador.' });
      }

      const senhaCorreta = await bcrypt.compare(senha, usuarioLocal.senha_hash);
      if (!senhaCorreta) {
        logAtividade.info(`Login falhou (local) â€” senha incorreta: "${loginLimpo}" | IP: ${ip}`);
        enviarNotificacao(pool, 'portal.login_falha', { usuario: loginLimpo, motivo: 'Senha incorreta', ip });
        enviarWhatsAppPortal(pool, 'portal.login_falha', { usuario: loginLimpo, motivo: 'Senha incorreta', ip }, { usuario: loginLimpo, ip }).catch(() => {});
        return res.status(401).json({ erro: 'UsuÃ¡rio ou senha invÃ¡lidos.' });
      }

      req.session.usuario = {
        id:      usuarioLocal.id,
        nome:    usuarioLocal.nome,
        usuario: usuarioLocal.usuario,
        nivel:   usuarioLocal.nivel,
        tipo:    'local'
      };

      await registrarLogin(pool, loginLimpo, ip, usuarioLocal.nivel, 'local');
      logAtividade.info(`Login realizado (local) â€” usuÃ¡rio: "${loginLimpo}" | NÃ­vel: ${usuarioLocal.nivel} | IP: ${ip}`);
      enviarNotificacao(pool, 'portal.login', { usuario: loginLimpo, nome: usuarioLocal.nome, tipo: 'local', ip });
      enviarWhatsAppPortal(pool, 'portal.login', { usuario: loginLimpo, nome: usuarioLocal.nome, tipo: 'local', ip }, { usuario: loginLimpo, ip }).catch(() => {});
      return res.json({ sucesso: true, redirecionar: '/portal.html' });
    }

    // --------------------------------------------------------
    // 2. NÃ£o Ã© usuÃ¡rio local â€” tenta autenticaÃ§Ã£o de DOMÃNIO
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
      logAtividade.info(`Login falhou â€” usuÃ¡rio inexistente: "${loginLimpo}" | IP: ${ip}`);
      enviarNotificacao(pool, 'portal.login_falha', { usuario: loginLimpo, motivo: 'UsuÃ¡rio inexistente', ip });
      enviarWhatsAppPortal(pool, 'portal.login_falha', { usuario: loginLimpo, motivo: 'UsuÃ¡rio inexistente', ip }, { usuario: loginLimpo, ip }).catch(() => {});
      return res.status(401).json({ erro: 'UsuÃ¡rio ou senha invÃ¡lidos.' });
    }

    if (!usuarioDominio.ativo) {
      logAtividade.info(`Login bloqueado (domÃ­nio) â€” usuÃ¡rio: "${loginLimpo}" | IP: ${ip}`);
      enviarNotificacao(pool, 'portal.usuario_bloqueado', { usuario: loginLimpo, ip });
      enviarWhatsAppPortal(pool, 'portal.usuario_bloqueado', { usuario: loginLimpo, ip }, { usuario: loginLimpo, ip }).catch(() => {});
      return res.status(403).json({ erro: 'UsuÃ¡rio bloqueado. Contate o administrador.' });
    }

    // LÃª configuraÃ§Ã£o do AD
    const configAD = await ad.lerConfigAD(pool);

    if (!ad.configValida(configAD)) {
      logErro.error(`Login de domÃ­nio falhou â€” AD nÃ£o configurado. UsuÃ¡rio: "${loginLimpo}"`);
      return res.status(503).json({ erro: 'AutenticaÃ§Ã£o de domÃ­nio indisponÃ­vel. Contate o administrador.' });
    }

    // Valida senha contra o AD
    try {
      await ad.autenticarUsuario(configAD, loginLimpo, senha);
    } catch (errAD) {
      logAtividade.info(`Login falhou (domÃ­nio) â€” senha incorreta: "${loginLimpo}" | IP: ${ip}`);
      return res.status(401).json({ erro: 'UsuÃ¡rio ou senha invÃ¡lidos.' });
    }

    req.session.usuario = {
      id:      usuarioDominio.id,
      nome:    usuarioDominio.nome,
      usuario: usuarioDominio.login,
      nivel:   usuarioDominio.nivel,
      tipo:    'dominio'
    };

    await registrarLogin(pool, loginLimpo, ip, usuarioDominio.nivel, 'domÃ­nio');
    logAtividade.info(`Login realizado (domÃ­nio) â€” usuÃ¡rio: "${loginLimpo}" | NÃ­vel: ${usuarioDominio.nivel} | IP: ${ip}`);
    enviarNotificacao(pool, 'portal.login', { usuario: loginLimpo, nome: usuarioDominio.nome, tipo: 'domÃ­nio', ip });
    enviarWhatsAppPortal(pool, 'portal.login', { usuario: loginLimpo, nome: usuarioDominio.nome, tipo: 'domÃ­nio', ip }, { usuario: loginLimpo, ip }).catch(() => {});
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
// GET /logout â€” Encerra a sessÃ£o
// ============================================================
router.get('/logout', (req, res) => {
  const logAtividade = req.app.locals.logAtividade;
  const usuario      = req.session?.usuario?.usuario || 'desconhecido';
  const ip           = req.ip || req.connection.remoteAddress;

  req.session.destroy(() => {
    logAtividade.info(`Logout â€” usuÃ¡rio: "${usuario}" | IP: ${ip}`);
    res.redirect('/login.html');
  });
});

// ============================================================
// GET /sessao â€” Dados do usuÃ¡rio logado (usado pelo menu)
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
      .input('detalhes', sql.VarChar, `NÃ­vel: ${nivel} | Tipo: ${tipo}`)
      .query(`INSERT INTO logs_atividade (usuario, acao, ip, sistema, detalhes) VALUES (@usuario, @acao, @ip, @sistema, @detalhes)`);
  } catch (_) {}
}

module.exports = router;

