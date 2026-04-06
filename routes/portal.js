/**
 * ARQUIVO: routes/portal.js
 * VERSÃO:  1.3.0
 * DATA:    2026-03-03
 * DESCRIÇÃO: Rotas da área autenticada do Portal
 *
 * HISTÓRICO:
 * 1.0.0 - 2026-03-02 - Versão inicial
 * 1.1.0 - 2026-03-03 - /configuracoes serve configuracoes.html
 * 1.2.0 - 2026-03-03 - Rotas /conf/* e /api/* para painel de configurações
 * 1.3.0 - 2026-03-03 - Rotas /api/ad/* para gestão de usuários do domínio
 */

const express        = require('express');
const path           = require('path');
const sql            = require('mssql');
const bcrypt         = require('bcryptjs');
const ad             = require('../lib/ad');
const verificarLogin        = require('../middleware/verificarLogin');
const { enviarNotificacao, enviarEmailTeste } = require('../services/emailService');
const { enviarLembreteHoje, enviarLembrete7Dias, enviarLembreteLancamento, enviarContasVencidas } = require('../services/cronFinanceiro');
const { enviarLembreteAprovacoes } = require('../services/cronAprovacoes');
const { registrarLog } = require('../services/logService');
const router                = express.Router();

// ============================================================
// MIDDLEWARE — verifica se o usuário é administrador
// ============================================================
function verificarAdmin(req, res, next) {
  if (req.session.usuario.nivel !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
  }
  next();
}

// ============================================================
// GET /portal — Página principal (após login)
// ============================================================
router.get('/portal', verificarLogin, (req, res) => {
  const logAtividade = req.app.locals.logAtividade;
  const usuario      = req.session.usuario.usuario;
  const ip           = req.ip || req.connection.remoteAddress;

  logAtividade.info(`Acesso ao portal — usuário: "${usuario}" | IP: ${ip}`);
  res.sendFile(path.join(__dirname, '../public/portal.html'));
});

// ============================================================
// GET /sistemas — Retorna lista de sistemas ativos (JSON)
// ============================================================
router.get('/sistemas', verificarLogin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const nivel        = req.session.usuario?.nivel;
  const logErro      = req.app.locals.logErro;
  const usuario      = req.session.usuario.usuario;
  const ip           = req.ip || req.connection.remoteAddress;

  try {
    const isAdmin = req.session.usuario?.nivel === 'admin';
    const resultado = await pool.request()
      .query(`SELECT id, nome, url, icone, descricao, nova_aba FROM sistemas WHERE ativo = 1${isAdmin ? '' : ' AND visivel_usuarios = 1'} ORDER BY nome`);

    logAtividade.info(`Listagem de sistemas — usuário: "${usuario}" | IP: ${ip}`);
    res.json({ sucesso: true, sistemas: resultado.recordset });

  } catch (erro) {
    logErro.error(`Erro ao listar sistemas: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar sistemas.' });
  }
});

// ============================================================
// GET /servicos — Retorna lista de serviços ativos (JSON)
// ============================================================
router.get('/servicos', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  try {
    const resultado = await pool.request()
      .query('SELECT id, nome, url, icone, descricao, nova_aba FROM servicos WHERE ativo = 1 ORDER BY nome');
    res.json({ sucesso: true, servicos: resultado.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar serviços: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar serviços.' });
  }
});

// ============================================================
// GET /configuracoes — Página de configurações (somente admin)
// ============================================================
router.get('/configuracoes', verificarLogin, (req, res) => {
  const logAtividade = req.app.locals.logAtividade;
  const usuario      = req.session.usuario;
  const ip           = req.ip;

  if (usuario.nivel !== 'admin') {
    logAtividade.info(`Acesso negado a configurações — usuário: "${usuario.usuario}" | IP: ${ip}`);
    return res.status(403).send(`
      <!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>Acesso Negado</title>
      <style>body{font-family:sans-serif;background:#1a1a2e;color:#e0e0e0;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px}
      h1{color:#e94560}a{color:#4e9af1}</style></head>
      <body><h1>&#128274; Acesso Negado</h1><p>Apenas administradores podem acessar esta página.</p>
      <a href="/portal">Voltar ao portal</a></body></html>
    `);
  }

  logAtividade.info(`Acesso a configurações — usuário: "${usuario.usuario}" | IP: ${ip}`);
  res.sendFile(path.join(__dirname, '../public/configuracoes.html'));
});

// ============================================================
// GET /logs — Últimos 50 logs de atividade (somente admin)
// ============================================================
router.get('/logs', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario;

  if (usuario.nivel !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
  }

  try {
    const resultado = await pool.request()
      .query(`
        SELECT TOP 50 usuario, acao, ip, data_hora, detalhes
        FROM logs_atividade
        ORDER BY data_hora DESC
      `);

    res.json({ sucesso: true, logs: resultado.recordset });

  } catch (erro) {
    logErro.error(`Erro ao buscar logs: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar logs.' });
  }
});

// ============================================================
// FRAGMENTOS DAS ABAS DE CONFIGURAÇÃO
// ============================================================
router.get('/conf/usuarios-locais', verificarLogin, verificarAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/fragmentos/usuarios-locais.html'));
});

router.get('/conf/usuarios-dominio', verificarLogin, verificarAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/fragmentos/usuarios-dominio.html'));
});

router.get('/conf/sistemas', verificarLogin, verificarAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/fragmentos/sistemas.html'));
});

router.get('/conf/servicos', verificarLogin, verificarAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/fragmentos/servicos.html'));
});

router.get('/conf/telegram', verificarLogin, verificarAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/fragmentos/telegram.html'));
});

router.get('/conf/email', verificarLogin, verificarAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/fragmentos/email.html'));
});

router.get('/conf/seguranca', verificarLogin, verificarAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/fragmentos/seguranca.html'));
});

router.get('/conf/logs', verificarLogin, verificarAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/fragmentos/logs.html'));
});

router.get('/conf/manutencao', verificarLogin, verificarAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/fragmentos/manutencao.html'));
});

// ============================================================
// API — NOTIFICAÇÕES
// ============================================================

// GET /api/notificacoes — Retorna configurações salvas
router.get('/api/notificacoes', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;

  // Chaves de eventos gerenciados por esta rota (sem prefixo 'notif.')
  const EVENTOS_NOTIF = [
    // Toggles por sistema (ativo/desativado)
    'portal.ativo', 'chamados.ativo', 'patrimonio.ativo', 'agenda.ativo',
    'financeiro.ativo', 'contatos.ativo', 'aprovacoes.ativo', 'calendarios.ativo',
    // Eventos individuais
    'portal.login', 'portal.login_falha', 'portal.usuario_bloqueado', 'portal.usuario_criado',
    'chamados.aprovacao_solicitada', 'chamados.aprovacao_concluida',
    'chamados.novo', 'chamados.atribuido', 'chamados.transferido', 'chamados.vinculado',
    'chamados.status_alterado', 'chamados.nova_mensagem',
    'chamados.reaberto', 'chamados.concluido', 'chamados.cancelado',
    'patrimonio.cadastro', 'patrimonio.transferencia', 'patrimonio.avaria', 'patrimonio.descarte',
    'agenda.tarefa_criada', 'agenda.tarefa_editada', 'agenda.tarefa_concluida',
    'agenda.passo_atribuido', 'agenda.passo_concluido', 'agenda.membro_adicionado',
    'calendarios.evento_criado', 'calendarios.lembrete_evento',
    'financeiro.nova_conta', 'financeiro.lancamento', 'financeiro.conta_paga', 'financeiro.conta_vencida',
    'financeiro.lembrete_hoje', 'financeiro.lembrete_7dias', 'financeiro.lembrete_lancamento',
    'financeiro.conta_vencida_diario',
    'contatos.novo_contato',
    'aprovacoes.nova_solicitacao', 'aprovacoes.aprovada', 'aprovacoes.reprovada',
    'aprovacoes.cancelada', 'aprovacoes.editada', 'aprovacoes.lembrete_pendente',
  ];

  try {
    const resultado = await pool.request()
      .query(`SELECT chave, valor FROM configuracoes WHERE chave LIKE 'notif.%'`);

    const mapa = {};
    for (const row of resultado.recordset) mapa[row.chave] = row.valor;

    // Monta lista de notificações com campo dest (array de tipos de destinatário)
    const notificacoes = EVENTOS_NOTIF.map(ev => ({
      chave: ev,
      ativo: mapa[`notif.${ev}`] === '1',
      dest:  mapa[`notif.${ev}.dest`] ? mapa[`notif.${ev}.dest`].split(',') : [],
    }));

    res.json({
      sucesso:      true,
      emailAtivo:   mapa['notif.email_ativo']  === '1',
      emailDestino: mapa['notif.email_destino'] || '',
      notificacoes,
    });
  } catch (erro) {
    logErro.error(`Erro ao carregar notificações: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar configurações de notificação.' });
  }
});

// POST /api/notificacoes — Salva configurações
router.post('/api/notificacoes', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const { emailAtivo, emailDestino } = req.body;
  const notificacoes = Array.isArray(req.body.notificacoes) ? req.body.notificacoes : [];

  try {
    // Helper para upsert na tabela configuracoes
    async function upsert(chave, valor, grupo, descricao) {
      await pool.request()
        .input('chave',    sql.VarChar, chave)
        .input('valor',    sql.VarChar, String(valor))
        .input('grupo',    sql.VarChar, grupo)
        .input('descricao',sql.VarChar, descricao)
        .query(`
          IF EXISTS (SELECT 1 FROM configuracoes WHERE chave = @chave)
            UPDATE configuracoes SET valor = @valor WHERE chave = @chave
          ELSE
            INSERT INTO configuracoes (chave, valor, grupo, descricao)
            VALUES (@chave, @valor, @grupo, @descricao)
        `);
    }

    await upsert('notif.email_ativo',   emailAtivo   ? '1' : '0', 'Notificacoes', 'Notificações por e-mail ativas');
    await upsert('notif.email_destino', emailDestino || '',        'Notificacoes', 'E-mail de destino das notificações');

    for (const item of notificacoes) {
      if (!item.chave) continue;
      await upsert(
        `notif.${item.chave}`,
        item.ativo ? '1' : '0',
        'Notificacoes',
        `Notificação: ${item.chave}`
      );
      // Salva destinatários (array → string CSV)
      if (Array.isArray(item.dest)) {
        await upsert(
          `notif.${item.chave}.dest`,
          item.dest.filter(Boolean).join(','),
          'Notificacoes',
          `Destinatários: ${item.chave}`
        );
      }
    }

    logAtividade.info(`Notificações atualizadas por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Configurações salvas com sucesso.' });
  } catch (erro) {
    logErro.error(`Erro ao salvar notificações: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao salvar configurações.' });
  }
});

// ============================================================
// API — USUÁRIOS
// ============================================================

// GET /api/usuarios/por-whatsapp/:numero — Busca usuário pelo número WhatsApp (sem auth, chave API)
router.get('/api/usuarios/por-whatsapp/:numero', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.WHATSAPP_API_KEY) return res.status(401).json({ erro: 'Não autorizado' });

  const pool   = req.app.locals.pool;
  const numero = (req.params.numero || '').replace(/\D/g, '');
  if (!numero) return res.status(400).json({ erro: 'Número inválido' });

  try {
    const r = await pool.request()
      .input('n', sql.VarChar, numero)
      .query(`
        SELECT login, nome FROM usuarios_dominio WHERE whatsapp = @n AND ativo = 1
        UNION ALL
        SELECT usuario AS login, nome FROM usuarios WHERE whatsapp = @n AND ativo = 1
      `);
    if (!r.recordset.length) return res.status(404).json({ erro: 'Usuário não encontrado' });
    res.json(r.recordset[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/usuarios/lista-whatsapp — Lista todos os usuários + contatos com qualquer telefone (API Key)
router.get('/api/usuarios/lista-whatsapp', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.WHATSAPP_API_KEY) return res.status(401).json({ erro: 'Não autorizado' });

  const pool = req.app.locals.pool;
  try {
    const r = await pool.request().query(`
      SELECT nome, usuario AS login, 'local'   AS tipo, ''  AS empresa, whatsapp AS numero
      FROM usuarios WHERE ativo = 1 AND whatsapp IS NOT NULL AND whatsapp <> ''
      UNION ALL
      SELECT nome, login,           'dominio' AS tipo, ''  AS empresa, whatsapp AS numero
      FROM usuarios_dominio WHERE ativo = 1 AND whatsapp IS NOT NULL AND whatsapp <> ''
      UNION ALL
      SELECT c.nome, c.nome AS login, 'contato' AS tipo,
             ISNULL(c.empresa, '') AS empresa,
             COALESCE(NULLIF(c.whatsapp,''), NULLIF(c.cel_pessoal,''), NULLIF(c.cel_corporativo,'')) AS numero
      FROM contatos c
      WHERE COALESCE(NULLIF(c.whatsapp,''), NULLIF(c.cel_pessoal,''), NULLIF(c.cel_corporativo,'')) IS NOT NULL
    `);
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PUT /api/perfil/whatsapp — Usuário salva seu próprio número WhatsApp
router.put('/api/perfil/whatsapp', verificarLogin, async (req, res) => {
  const pool  = req.app.locals.pool;
  const login = req.session.usuario.usuario || req.session.usuario.login;
  const { whatsapp } = req.body;
  const numero = (whatsapp || '').replace(/\D/g, '').slice(0, 20);

  try {
    // Tenta atualizar em usuarios_dominio primeiro, depois usuarios local
    const r1 = await pool.request()
      .input('whatsapp', sql.VarChar, numero || null)
      .input('login',    sql.VarChar, login)
      .query('UPDATE usuarios_dominio SET whatsapp = @whatsapp WHERE login = @login');

    if (r1.rowsAffected[0] === 0) {
      await pool.request()
        .input('whatsapp', sql.VarChar, numero || null)
        .input('usuario',  sql.VarChar, login)
        .query('UPDATE usuarios SET whatsapp = @whatsapp WHERE usuario = @usuario');
    }
    res.json({ sucesso: true });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao salvar número WhatsApp.' });
  }
});

// PUT /api/ad/usuarios/:id/whatsapp — Admin salva WhatsApp de qualquer usuário domínio
router.put('/api/ad/usuarios/:id/whatsapp', verificarLogin, verificarAdmin, async (req, res) => {
  const pool  = req.app.locals.pool;
  const id    = parseInt(req.params.id);
  const { whatsapp } = req.body;
  const numero = (whatsapp || '').replace(/\D/g, '').slice(0, 20);

  try {
    await pool.request()
      .input('whatsapp', sql.VarChar, numero || null)
      .input('id',       sql.Int,     id)
      .query('UPDATE usuarios_dominio SET whatsapp = @whatsapp WHERE id = @id');
    res.json({ sucesso: true });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao salvar número WhatsApp.' });
  }
});

// GET /api/usuarios — Listar todos
router.get('/api/usuarios', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;

  try {
    const resultado = await pool.request()
      .query('SELECT id, nome, usuario, nivel, ativo, criado_em, whatsapp FROM usuarios ORDER BY nome');
    res.json({ sucesso: true, usuarios: resultado.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar usuários: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar usuários.' });
  }
});

// POST /api/usuarios — Criar
router.post('/api/usuarios', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const { nome, usuario, senha, nivel, whatsapp } = req.body;

  if (!nome || !usuario || !senha || !nivel) {
    return res.status(400).json({ erro: 'Preencha todos os campos.' });
  }

  try {
    const senhaHash = await bcrypt.hash(senha, 10);

    await pool.request()
      .input('nome',      sql.VarChar, nome.trim())
      .input('usuario',   sql.VarChar, usuario.trim().toLowerCase())
      .input('senhaHash', sql.VarChar, senhaHash)
      .input('nivel',     sql.VarChar, nivel)
      .input('whatsapp',  sql.VarChar, (whatsapp || '').replace(/\D/g, '') || null)
      .query(`
        INSERT INTO usuarios (nome, usuario, senha_hash, nivel, ativo, whatsapp)
        VALUES (@nome, @usuario, @senhaHash, @nivel, 1, @whatsapp)
      `);

    logAtividade.info(`Usuário criado: "${usuario}" — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Usuário criado com sucesso.' });

  } catch (erro) {
    if (erro.number === 2627) {
      return res.status(400).json({ erro: 'Esse nome de usuário já existe.' });
    }
    logErro.error(`Erro ao criar usuário: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar usuário.' });
  }
});

// PUT /api/usuarios/:id — Editar
router.put('/api/usuarios/:id', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const id           = parseInt(req.params.id);
  const { nome, nivel, senha, whatsapp } = req.body;
  const waNro = (whatsapp || '').replace(/\D/g, '').slice(0, 20) || null;

  if (!nome || !nivel) {
    return res.status(400).json({ erro: 'Nome e nível são obrigatórios.' });
  }

  try {
    if (senha && senha.trim()) {
      const senhaHash = await bcrypt.hash(senha, 10);
      await pool.request()
        .input('id',        sql.Int,     id)
        .input('nome',      sql.VarChar, nome.trim())
        .input('nivel',     sql.VarChar, nivel)
        .input('senhaHash', sql.VarChar, senhaHash)
        .input('whatsapp',  sql.VarChar, waNro)
        .query('UPDATE usuarios SET nome = @nome, nivel = @nivel, senha_hash = @senhaHash, whatsapp = @whatsapp WHERE id = @id');
    } else {
      await pool.request()
        .input('id',       sql.Int,     id)
        .input('nome',     sql.VarChar, nome.trim())
        .input('nivel',    sql.VarChar, nivel)
        .input('whatsapp', sql.VarChar, waNro)
        .query('UPDATE usuarios SET nome = @nome, nivel = @nivel, whatsapp = @whatsapp WHERE id = @id');
    }

    logAtividade.info(`Usuário id=${id} editado — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Usuário atualizado.' });

  } catch (erro) {
    logErro.error(`Erro ao editar usuário id=${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao atualizar usuário.' });
  }
});

// PATCH /api/usuarios/:id/status — Ativar/Bloquear
router.patch('/api/usuarios/:id/status', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const id           = parseInt(req.params.id);
  const { ativo }    = req.body;

  if (req.session.usuario.id === id) {
    return res.status(400).json({ erro: 'Você não pode bloquear sua própria conta.' });
  }

  try {
    await pool.request()
      .input('id',    sql.Int, id)
      .input('ativo', sql.Bit, ativo ? 1 : 0)
      .query('UPDATE usuarios SET ativo = @ativo WHERE id = @id');

    logAtividade.info(`Usuário id=${id} ${ativo ? 'ativado' : 'bloqueado'} — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: ativo ? 'Usuário ativado.' : 'Usuário bloqueado.' });

  } catch (erro) {
    logErro.error(`Erro ao alterar status do usuário id=${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao alterar status.' });
  }
});

// GET /api/usuarios/por-whatsapp/:numero — Buscar usuário pelo número WhatsApp (uso interno bot)
router.get('/api/usuarios/por-whatsapp/:numero', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const chave  = process.env.WHATSAPP_API_KEY;
  if (!chave || !apiKey || apiKey !== chave) return res.status(401).json({ erro: 'Não autorizado.' });

  const pool = req.app.locals.pool;
  const numero = req.params.numero.replace(/\D/g, '');
  if (!numero) return res.status(400).json({ erro: 'Número inválido.' });

  try {
    const resultado = await pool.request()
      .input('whatsapp', sql.VarChar, numero)
      .query(`
        SELECT TOP 1 usuario AS login, nome, nivel
        FROM usuarios
        WHERE whatsapp = @whatsapp AND ativo = 1
        UNION ALL
        SELECT TOP 1 login, nome, 'usuario' AS nivel
        FROM usuarios_dominio
        WHERE whatsapp = @whatsapp AND ativo = 1
      `);

    if (!resultado.recordset.length) return res.status(404).json({ erro: 'Não encontrado.' });
    res.json(resultado.recordset[0]);
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// DELETE /api/usuarios/:id — Excluir
router.delete('/api/usuarios/:id', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const id           = parseInt(req.params.id);

  if (req.session.usuario.id === id) {
    return res.status(400).json({ erro: 'Você não pode excluir sua própria conta.' });
  }

  try {
    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM usuarios WHERE id = @id');

    logAtividade.info(`Usuário id=${id} excluído — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Usuário excluído.' });

  } catch (erro) {
    logErro.error(`Erro ao excluir usuário id=${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir usuário.' });
  }
});

// ============================================================
// API — SISTEMAS
// ============================================================

// GET /api/sistemas-admin — Listar todos (incluindo inativos)
router.get('/api/sistemas-admin', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;

  try {
    const resultado = await pool.request()
      .query('SELECT id, nome, url, icone, descricao, ativo, nova_aba, visivel_usuarios FROM sistemas ORDER BY nome');
    res.json({ sucesso: true, sistemas: resultado.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar sistemas (admin): ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar sistemas.' });
  }
});

// POST /api/sistemas — Criar
router.post('/api/sistemas', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const { nome, url, icone, descricao, nova_aba, visivel_usuarios } = req.body;

  if (!nome || !url) {
    return res.status(400).json({ erro: 'Nome e URL são obrigatórios.' });
  }

  try {
    await pool.request()
      .input('nome',             sql.VarChar, nome.trim())
      .input('url',              sql.VarChar, url.trim())
      .input('icone',            sql.VarChar, (icone || 'fa-window-maximize').trim())
      .input('descricao',        sql.VarChar, (descricao || '').trim())
      .input('nova_aba',         sql.Bit,     nova_aba ? 1 : 0)
      .input('visivel_usuarios', sql.Bit,     visivel_usuarios !== false ? 1 : 0)
      .query(`
        INSERT INTO sistemas (nome, url, icone, descricao, ativo, nova_aba, visivel_usuarios)
        VALUES (@nome, @url, @icone, @descricao, 1, @nova_aba, @visivel_usuarios)
      `);

    logAtividade.info(`Sistema criado: "${nome}" — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Sistema criado com sucesso.' });

  } catch (erro) {
    logErro.error(`Erro ao criar sistema: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar sistema.' });
  }
});

// PUT /api/sistemas/:id — Editar
router.put('/api/sistemas/:id', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const id           = parseInt(req.params.id);
  const { nome, url, icone, descricao, nova_aba, visivel_usuarios } = req.body;

  if (!nome || !url) {
    return res.status(400).json({ erro: 'Nome e URL são obrigatórios.' });
  }

  try {
    await pool.request()
      .input('id',               sql.Int,     id)
      .input('nome',             sql.VarChar, nome.trim())
      .input('url',              sql.VarChar, url.trim())
      .input('icone',            sql.VarChar, (icone || 'fa-window-maximize').trim())
      .input('descricao',        sql.VarChar, (descricao || '').trim())
      .input('nova_aba',         sql.Bit,     nova_aba ? 1 : 0)
      .input('visivel_usuarios', sql.Bit,     visivel_usuarios !== false ? 1 : 0)
      .query(`
        UPDATE sistemas
        SET nome = @nome, url = @url, icone = @icone, descricao = @descricao,
            nova_aba = @nova_aba, visivel_usuarios = @visivel_usuarios
        WHERE id = @id
      `);

    logAtividade.info(`Sistema id=${id} editado — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Sistema atualizado.' });

  } catch (erro) {
    logErro.error(`Erro ao editar sistema id=${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao atualizar sistema.' });
  }
});

// PATCH /api/sistemas/:id/status — Ativar/Desativar
router.patch('/api/sistemas/:id/status', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const id           = parseInt(req.params.id);
  const { ativo }    = req.body;

  try {
    await pool.request()
      .input('id',    sql.Int, id)
      .input('ativo', sql.Bit, ativo ? 1 : 0)
      .query('UPDATE sistemas SET ativo = @ativo WHERE id = @id');

    logAtividade.info(`Sistema id=${id} ${ativo ? 'ativado' : 'desativado'} — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: ativo ? 'Sistema ativado.' : 'Sistema desativado.' });

  } catch (erro) {
    logErro.error(`Erro ao alterar status do sistema id=${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao alterar status.' });
  }
});

// DELETE /api/sistemas/:id — Excluir
router.delete('/api/sistemas/:id', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const id           = parseInt(req.params.id);

  try {
    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM sistemas WHERE id = @id');

    logAtividade.info(`Sistema id=${id} excluído — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Sistema excluído.' });

  } catch (erro) {
    logErro.error(`Erro ao excluir sistema id=${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir sistema.' });
  }
});

// ============================================================
// API — SERVIÇOS
// ============================================================

// GET /api/servicos-admin — Listar todos (incluindo inativos)
router.get('/api/servicos-admin', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  try {
    const resultado = await pool.request()
      .query('SELECT id, nome, url, icone, descricao, ativo, nova_aba FROM servicos ORDER BY nome');
    res.json({ sucesso: true, servicos: resultado.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar serviços (admin): ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar serviços.' });
  }
});

// POST /api/servicos — Criar
router.post('/api/servicos', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const { nome, url, icone, descricao, nova_aba } = req.body;

  if (!nome || !url) return res.status(400).json({ erro: 'Nome e URL são obrigatórios.' });

  try {
    await pool.request()
      .input('nome',      sql.VarChar, nome.trim())
      .input('url',       sql.VarChar, url.trim())
      .input('icone',     sql.VarChar, (icone || 'fa-cogs').trim())
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('nova_aba',  sql.Bit,     nova_aba ? 1 : 0)
      .query('INSERT INTO servicos (nome, url, icone, descricao, ativo, nova_aba) VALUES (@nome, @url, @icone, @descricao, 1, @nova_aba)');
    logAtividade.info(`Serviço criado: "${nome}" — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Serviço criado com sucesso.' });
  } catch (erro) {
    logErro.error(`Erro ao criar serviço: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar serviço.' });
  }
});

// PUT /api/servicos/:id — Editar
router.put('/api/servicos/:id', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const id           = parseInt(req.params.id);
  const { nome, url, icone, descricao, nova_aba } = req.body;

  if (!nome || !url) return res.status(400).json({ erro: 'Nome e URL são obrigatórios.' });

  try {
    await pool.request()
      .input('id',        sql.Int,     id)
      .input('nome',      sql.VarChar, nome.trim())
      .input('url',       sql.VarChar, url.trim())
      .input('icone',     sql.VarChar, (icone || 'fa-cogs').trim())
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('nova_aba',  sql.Bit,     nova_aba ? 1 : 0)
      .query('UPDATE servicos SET nome=@nome, url=@url, icone=@icone, descricao=@descricao, nova_aba=@nova_aba WHERE id=@id');
    logAtividade.info(`Serviço id=${id} editado — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Serviço atualizado.' });
  } catch (erro) {
    logErro.error(`Erro ao editar serviço id=${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao atualizar serviço.' });
  }
});

// PATCH /api/servicos/:id/status — Ativar/Desativar
router.patch('/api/servicos/:id/status', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const id           = parseInt(req.params.id);
  const { ativo }    = req.body;

  try {
    await pool.request()
      .input('id',    sql.Int, id)
      .input('ativo', sql.Bit, ativo ? 1 : 0)
      .query('UPDATE servicos SET ativo=@ativo WHERE id=@id');
    logAtividade.info(`Serviço id=${id} ${ativo ? 'ativado' : 'desativado'} — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: ativo ? 'Serviço ativado.' : 'Serviço desativado.' });
  } catch (erro) {
    logErro.error(`Erro ao alterar status do serviço id=${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao alterar status.' });
  }
});

// DELETE /api/servicos/:id — Excluir
router.delete('/api/servicos/:id', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const id           = parseInt(req.params.id);

  try {
    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM servicos WHERE id=@id');
    logAtividade.info(`Serviço id=${id} excluído — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Serviço excluído.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir serviço id=${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir serviço.' });
  }
});

// ============================================================
// API — CONFIGURAÇÕES (chave-valor por grupo)
// ============================================================

// GET /api/configuracoes/:grupo — Buscar configurações de um grupo
router.get('/api/configuracoes/:grupo', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const grupo   = req.params.grupo;

  try {
    const resultado = await pool.request()
      .input('grupo', sql.VarChar, grupo)
      .query('SELECT chave, valor FROM configuracoes WHERE grupo = @grupo');

    const config = {};
    resultado.recordset.forEach(r => { config[r.chave] = r.valor; });
    res.json({ sucesso: true, config });

  } catch (erro) {
    logErro.error(`Erro ao buscar configurações (${grupo}): ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar configurações.' });
  }
});

// POST /api/configuracoes — Salvar configurações (upsert)
router.post('/api/configuracoes', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const { grupo, configuracoes } = req.body;

  if (!grupo || !configuracoes) {
    return res.status(400).json({ erro: 'Grupo e configurações são obrigatórios.' });
  }

  try {
    for (const [chave, valor] of Object.entries(configuracoes)) {
      await pool.request()
        .input('chave', sql.VarChar, chave)
        .input('valor', sql.VarChar, valor !== null && valor !== undefined ? String(valor) : null)
        .input('grupo', sql.VarChar, grupo)
        .query(`
          IF EXISTS (SELECT 1 FROM configuracoes WHERE chave = @chave)
            UPDATE configuracoes SET valor = @valor WHERE chave = @chave
          ELSE
            INSERT INTO configuracoes (chave, valor, grupo) VALUES (@chave, @valor, @grupo)
        `);
    }

    logAtividade.info(`Configurações do grupo "${grupo}" salvas — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Configurações salvas com sucesso.' });

  } catch (erro) {
    logErro.error(`Erro ao salvar configurações (${grupo}): ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao salvar configurações.' });
  }
});

// ============================================================
// POST /api/email/testar — Envia email de teste com as configs salvas
// ============================================================
router.post('/api/email/testar', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const admin   = req.session.usuario.usuario;
  const destino = req.body?.destino || null;
  try {
    await enviarEmailTeste(pool, admin, destino);
    res.json({ sucesso: true, mensagem: `Email de teste enviado para ${destino || 'email padrão'}.` });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: 'Falha ao enviar email: ' + erro.message });
  }
});

// ============================================================
// POST /api/email/testar-aprovacoes — Dispara todos os 6 eventos de aprovações
//   para o email de destino configurado (ignora destinatários reais)
// ============================================================
router.post('/api/email/testar-aprovacoes', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const admin   = req.session.usuario.usuario || req.session.usuario.login;
  const destino = req.body?.destino || null;

  try {
    // Resolve email de destino
    const cfgR = await pool.request()
      .input('k', sql.VarChar, 'notif.email_destino')
      .query('SELECT valor FROM configuracoes WHERE chave = @k');
    const emailDestino = destino || cfgR.recordset[0]?.valor;
    if (!emailDestino) return res.status(400).json({ erro: 'Configure o Email padrão antes de testar.' });

    // Busca última aprovação para dados reais
    const aprR = await pool.request().query(
      'SELECT TOP 1 titulo, objetivo, criado_por_nome FROM aprovacoes ORDER BY criado_em DESC'
    );
    const base = aprR.recordset[0] || {};

    const dadosTeste = {
      titulo:          base.titulo          || 'Aprovação de teste',
      objetivo:        base.objetivo        || 'Verificação do sistema de notificações por e-mail.',
      criado_por_nome: base.criado_por_nome || admin,
      por_nome:        admin,
      motivo:          'Teste de notificação',
      total:           1,
      login:           admin,
      nome:            admin,
      lista_html:      '<p style="color:#e0e0e0">Exemplo de solicitação pendente — teste.</p>',
      // Todos os destinatários apontam para o email de destino
      email_solicitante:  emailDestino,
      email_aprovadores:  [emailDestino],
      email_observadores: [emailDestino],
      email_admins:       [emailDestino],
    };

    const eventos = [
      'aprovacoes.nova_solicitacao',
      'aprovacoes.aprovada',
      'aprovacoes.reprovada',
      'aprovacoes.cancelada',
      'aprovacoes.editada',
      'aprovacoes.lembrete_pendente',
    ];

    const resultados = [];
    for (const tipo of eventos) {
      const ok = await enviarNotificacao(pool, tipo, dadosTeste);
      resultados.push({ tipo, enviado: ok });
    }

    const enviados  = resultados.filter(r => r.enviado).length;
    const ignorados = resultados.length - enviados;
    const nomesIgnorados = resultados.filter(r => !r.enviado).map(r => r.tipo.replace('aprovacoes.', '')).join(', ');

    res.json({
      sucesso: true,
      mensagem: `${enviados} email(s) enviado(s) para ${emailDestino}.` +
        (ignorados ? ` ${ignorados} desabilitado(s): ${nomesIgnorados}.` : ''),
      resultados,
    });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: 'Erro: ' + erro.message });
  }
});

// ============================================================
// POST /api/email/testar-financeiro — Testa todos os eventos financeiros
// ============================================================
router.post('/api/email/testar-financeiro', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const admin   = req.session.usuario.usuario || req.session.usuario.login;
  const destino = req.body?.destino || null;

  try {
    const cfgR = await pool.request()
      .input('k', sql.VarChar, 'notif.email_destino')
      .query('SELECT valor FROM configuracoes WHERE chave = @k');
    const emailDestino = destino || cfgR.recordset[0]?.valor;
    if (!emailDestino) return res.status(400).json({ erro: 'Configure o Email padrão antes de testar.' });

    const listaHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem;color:#e0e0e0">
        <thead><tr style="background:#1e3a5f">
          <th style="padding:6px 10px;text-align:left">Descrição</th>
          <th style="padding:6px 10px;text-align:left">Valor</th>
          <th style="padding:6px 10px;text-align:left">Vencimento</th>
          <th style="padding:6px 10px;text-align:left">Categoria</th>
          <th style="padding:6px 10px;text-align:left">Agenda</th>
        </tr></thead>
        <tbody><tr>
          <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f">Conta de teste</td>
          <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f">R$ 100,00</td>
          <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f">17/03/2026</td>
          <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f">Geral</td>
          <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f">Agenda Teste</td>
        </tr></tbody>
      </table>`;

    const dadosTeste = {
      descricao:    'Conta de teste',
      valor:        '100.00',
      data:         '17/03/2026',
      agenda_nome:  'Agenda Teste',
      criado_por:   admin,
      total:        1,
      dias:         3,
      data_hoje:    new Date().toLocaleDateString('pt-BR'),
      lista_html:   listaHTML,
      email_direto: [emailDestino],
    };

    const eventos = [
      'financeiro.nova_conta',
      'financeiro.lancamento',
      'financeiro.conta_paga',
      'financeiro.conta_vencida',
      'financeiro.lembrete_hoje',
      'financeiro.lembrete_7dias',
      'financeiro.lembrete_lancamento',
      'financeiro.conta_vencida_diario',
    ];

    const resultados = [];
    for (const tipo of eventos) {
      const ok = await enviarNotificacao(pool, tipo, dadosTeste);
      resultados.push({ tipo, enviado: ok });
    }

    const enviados  = resultados.filter(r => r.enviado).length;
    const ignorados = resultados.length - enviados;
    const nomeIgn   = resultados.filter(r => !r.enviado).map(r => r.tipo.replace('financeiro.', '')).join(', ');

    res.json({
      sucesso: true,
      mensagem: `${enviados} email(s) enviado(s) para ${emailDestino}.` +
        (ignorados ? ` ${ignorados} desabilitado(s): ${nomeIgn}.` : ''),
      resultados,
    });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: 'Erro: ' + erro.message });
  }
});

// ============================================================
// POST /api/email/reenviar-financeiro — Dispara os crons reais agora
// ============================================================
router.post('/api/email/reenviar-financeiro', verificarLogin, verificarAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const resultados = [];
    const run = async (nome, fn) => {
      try { await fn(pool); resultados.push({ nome, ok: true }); }
      catch (e) { resultados.push({ nome, ok: false, erro: e.message }); }
    };
    await run('Vence hoje',         enviarLembreteHoje);
    await run('Próximos 7 dias',    enviarLembrete7Dias);
    await run('Lembrete lançamento',enviarLembreteLancamento);
    await run('Contas vencidas',    enviarContasVencidas);

    const erros = resultados.filter(r => !r.ok);
    res.json({
      sucesso: erros.length === 0,
      mensagem: erros.length === 0
        ? 'Lembretes disparados com sucesso para os destinatários reais.'
        : `${erros.length} erro(s): ${erros.map(e => e.nome + ': ' + e.erro).join(' | ')}`,
      resultados,
    });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: 'Erro: ' + erro.message });
  }
});

// ============================================================
// POST /api/email/cron-manual — Dispara um serviço automático individualmente
// ============================================================
router.post('/api/email/cron-manual', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const admin   = req.session.usuario.usuario || req.session.usuario.login;
  const { servico } = req.body;

  const servicoMap = {
    'conta_vencida_diario':       () => enviarContasVencidas(pool),
    'lembrete_hoje':               () => enviarLembreteHoje(pool),
    'lembrete_7dias':              () => enviarLembrete7Dias(pool),
    'lembrete_lancamento':         () => enviarLembreteLancamento(pool),
    'aprovacoes_lembrete_pendente':() => enviarLembreteAprovacoes(pool),
  };

  const nomes = {
    'conta_vencida_diario':       'Contas em atraso (diário)',
    'lembrete_hoje':               'Lembrar contas do dia',
    'lembrete_7dias':              'Lembrar contas dos próximos 7 dias',
    'lembrete_lancamento':         'Lembrete para lançar conta',
    'aprovacoes_lembrete_pendente':'Lembrete de aprovação pendente',
  };

  if (!servicoMap[servico]) {
    return res.status(400).json({ erro: 'Serviço inválido.' });
  }

  try {
    await servicoMap[servico]();
    registrarLog(pool, { usuario: admin, ip: null, acao: 'EMAIL', sistema: 'portal',
      detalhes: `Serviço de email disparado manualmente: "${nomes[servico]}"` });
    res.json({ sucesso: true, mensagem: `"${nomes[servico]}" disparado com sucesso para os destinatários reais.` });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: 'Erro: ' + erro.message });
  }
});

// ============================================================
// API — LOGS COM FILTROS
// ============================================================
router.get('/api/logs', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const { usuario, acao, sistema, texto, de, ate, pagina } = req.query;
  const POR_PAGINA = 100;
  const offset     = (Math.max(1, parseInt(pagina) || 1) - 1) * POR_PAGINA;

  try {
    const request = pool.request();
    let where = 'WHERE 1=1';

    if (usuario) {
      where += ' AND usuario LIKE @usuario';
      request.input('usuario', sql.VarChar, `%${usuario}%`);
    }
    if (acao && acao !== 'todos') {
      where += ' AND acao = @acao';
      request.input('acao', sql.VarChar, acao);
    }
    if (sistema && sistema !== 'todos') {
      where += ' AND sistema = @sistema';
      request.input('sistema', sql.VarChar, sistema);
    }
    if (texto) {
      where += ' AND detalhes LIKE @texto';
      request.input('texto', sql.VarChar, `%${texto}%`);
    }
    if (de) {
      where += ' AND data_hora >= @de';
      request.input('de', sql.DateTime, new Date(de));
    }
    if (ate) {
      where += ' AND data_hora <= @ate';
      request.input('ate', sql.DateTime, new Date(ate + 'T23:59:59'));
    }

    // Total para paginação
    const countReq = pool.request();
    if (usuario)                         countReq.input('usuario', sql.VarChar, `%${usuario}%`);
    if (acao && acao !== 'todos')        countReq.input('acao',    sql.VarChar, acao);
    if (sistema && sistema !== 'todos')  countReq.input('sistema', sql.VarChar, sistema);
    if (texto)                           countReq.input('texto',   sql.VarChar, `%${texto}%`);
    if (de)                              countReq.input('de',      sql.DateTime, new Date(de));
    if (ate)                             countReq.input('ate',     sql.DateTime, new Date(ate + 'T23:59:59'));
    const countResult = await countReq.query(`SELECT COUNT(*) AS total FROM logs_atividade ${where}`);
    const total = countResult.recordset[0].total;

    request.input('offset',     sql.Int, offset);
    request.input('porPagina',  sql.Int, POR_PAGINA);
    const resultado = await request.query(`
      SELECT usuario, acao, ip, sistema, data_hora, detalhes
      FROM logs_atividade
      ${where}
      ORDER BY data_hora DESC
      OFFSET @offset ROWS FETCH NEXT @porPagina ROWS ONLY
    `);

    res.json({ sucesso: true, logs: resultado.recordset, total, pagina: parseInt(pagina) || 1, porPagina: POR_PAGINA });

  } catch (erro) {
    logErro.error(`Erro ao buscar logs com filtros: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar logs.' });
  }
});

// ============================================================
// API — DOMÍNIO (ACTIVE DIRECTORY)
// ============================================================

// GET /api/ad/usuarios-portal — Usuários do domínio com acesso ao portal
router.get('/api/ad/usuarios-portal', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;

  try {
    const resultado = await pool.request()
      .query('SELECT id, login, nome, email, departamento, nivel, ativo, criado_em, whatsapp FROM usuarios_dominio ORDER BY nome');
    res.json({ sucesso: true, usuarios: resultado.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar usuários do domínio: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar usuários do domínio.' });
  }
});

// GET /api/ad/buscar — Busca usuários ativos no Active Directory
router.get('/api/ad/buscar', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;

  try {
    const config = await ad.lerConfigAD(pool);

    if (!ad.configValida(config)) {
      return res.status(400).json({ erro: 'Configure o servidor AD antes de buscar usuários.' });
    }
    if (!config.ad_usuario_svc || !config.ad_senha_svc) {
      return res.status(400).json({ erro: 'Configure o usuário de serviço do AD.' });
    }

    const usuarios = await ad.listarUsuariosAD(config);
    res.json({ sucesso: true, usuarios });

  } catch (erro) {
    logErro.error(`Erro ao buscar usuários no AD: ${erro.message}`);
    res.status(500).json({ erro: 'Não foi possível conectar ao Active Directory. Verifique as configurações.' });
  }
});

// POST /api/ad/usuarios/sincronizar — Atualiza nome/email/depto dos usuários do portal via AD
router.post('/api/ad/usuarios/sincronizar', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;

  try {
    const config = await ad.lerConfigAD(pool);
    if (!ad.configValida(config)) {
      return res.status(400).json({ erro: 'Configure o servidor AD antes de sincronizar.' });
    }

    // 1. Busca todos os usuários cadastrados no portal
    const dbR = await pool.request().query(
      'SELECT id, login, nome, email, departamento FROM usuarios_dominio'
    );
    if (dbR.recordset.length === 0) {
      return res.json({ sucesso: true, mensagem: 'Nenhum usuário de domínio cadastrado no portal.', atualizados: 0 });
    }

    // 2. Busca todos os usuários ativos no AD
    const usuariosAD = await ad.listarUsuariosAD(config);
    const mapaAD = {};
    for (const u of usuariosAD) mapaAD[u.login.toLowerCase()] = u;

    // 3. Atualiza os que existem no AD
    let atualizados = 0;
    let naoEncontrados = 0;
    for (const u of dbR.recordset) {
      const adUser = mapaAD[u.login.toLowerCase()];
      if (!adUser) { naoEncontrados++; continue; }

      const novoWhatsapp = (adUser.whatsapp || '').replace(/\D/g, '');
      await pool.request()
        .input('id',          sql.Int,     u.id)
        .input('nome',        sql.VarChar, (adUser.nome        || u.nome        || u.login).trim())
        .input('email',       sql.VarChar, (adUser.email       || u.email       || '').trim())
        .input('departamento',sql.VarChar, (adUser.departamento|| u.departamento|| '').trim())
        .input('whatsapp',    sql.VarChar, novoWhatsapp || null)
        .query(`
          UPDATE usuarios_dominio
          SET nome = @nome, email = @email, departamento = @departamento
            ${novoWhatsapp ? ', whatsapp = @whatsapp' : ''}
          WHERE id = @id
        `);
      atualizados++;
    }

    logAtividade.info(`Sincronização AD: ${atualizados} usuário(s) atualizados — por: "${admin}"`);
    const msg = `${atualizados} usuário(s) atualizados` +
      (naoEncontrados > 0 ? `, ${naoEncontrados} não encontrado(s) no AD` : '') + '.';
    res.json({ sucesso: true, mensagem: msg, atualizados, naoEncontrados });

  } catch (erro) {
    logErro.error(`Erro na sincronização AD: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao sincronizar com o AD: ' + erro.message });
  }
});

// POST /api/ad/testar — Testa a conexão com o AD
router.post('/api/ad/testar', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;

  try {
    const config = await ad.lerConfigAD(pool);

    if (!ad.configValida(config)) {
      return res.status(400).json({ erro: 'Configure o servidor AD antes de testar.' });
    }

    await ad.testarConexao(config);
    res.json({ sucesso: true, mensagem: 'Conexão com o Active Directory estabelecida com sucesso!' });

  } catch (erro) {
    logErro.error(`Falha ao testar conexão AD: ${erro.message}`);
    res.status(500).json({ erro: 'Falha na conexão: ' + erro.message });
  }
});

// POST /api/ad/usuarios — Adicionar usuário do domínio ao portal
router.post('/api/ad/usuarios', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const { login, nome, email, departamento, nivel } = req.body;

  if (!login) return res.status(400).json({ erro: 'Informe o login do usuário.' });

  try {
    await pool.request()
      .input('login',        sql.VarChar, login.trim().toLowerCase())
      .input('nome',         sql.VarChar, (nome || login).trim())
      .input('email',        sql.VarChar, (email || '').trim())
      .input('departamento', sql.VarChar, (departamento || '').trim())
      .input('nivel',        sql.VarChar, nivel || 'usuario')
      .query(`
        IF NOT EXISTS (SELECT 1 FROM usuarios_dominio WHERE login = @login)
          INSERT INTO usuarios_dominio (login, nome, email, departamento, nivel, ativo)
          VALUES (@login, @nome, @email, @departamento, @nivel, 1)
        ELSE
          UPDATE usuarios_dominio
          SET nome = @nome, email = @email, departamento = @departamento
          WHERE login = @login
      `);

    logAtividade.info(`Usuário do domínio adicionado/atualizado: "${login}" — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Usuário adicionado/atualizado no portal.' });

  } catch (erro) {
    logErro.error(`Erro ao adicionar usuário do domínio: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao adicionar usuário.' });
  }
});

// POST /api/ad/usuarios/lote — Adicionar vários usuários de uma vez
router.post('/api/ad/usuarios/lote', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const { usuarios, nivel } = req.body;

  if (!Array.isArray(usuarios) || usuarios.length === 0) {
    return res.status(400).json({ erro: 'Nenhum usuário informado.' });
  }

  let adicionados = 0;
  let ignorados   = 0;

  for (const u of usuarios) {
    try {
      await pool.request()
        .input('login',        sql.VarChar, u.login.trim().toLowerCase())
        .input('nome',         sql.VarChar, (u.nome || u.login).trim())
        .input('email',        sql.VarChar, (u.email || '').trim())
        .input('departamento', sql.VarChar, (u.departamento || '').trim())
        .input('nivel',        sql.VarChar, nivel || 'usuario')
        .query(`
          IF NOT EXISTS (SELECT 1 FROM usuarios_dominio WHERE login = @login)
            INSERT INTO usuarios_dominio (login, nome, email, departamento, nivel, ativo)
            VALUES (@login, @nome, @email, @departamento, @nivel, 1)
          ELSE
            UPDATE usuarios_dominio
            SET nome = @nome, email = @email, departamento = @departamento
            WHERE login = @login
        `);
      adicionados++;
    } catch (e) {
      ignorados++;
    }
  }

  logAtividade.info(`${adicionados} usuários do domínio adicionados em lote — por: "${admin}"`);
  res.json({ sucesso: true, mensagem: `${adicionados} usuário(s) adicionado(s).${ignorados ? ` ${ignorados} ignorado(s).` : ''}` });
});

// PUT /api/ad/usuarios/:id — Alterar nível de acesso
router.put('/api/ad/usuarios/:id', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const id           = parseInt(req.params.id);
  const { nivel }    = req.body;

  if (!nivel) return res.status(400).json({ erro: 'Informe o nível de acesso.' });

  try {
    await pool.request()
      .input('id',    sql.Int,     id)
      .input('nivel', sql.VarChar, nivel)
      .query('UPDATE usuarios_dominio SET nivel = @nivel WHERE id = @id');

    logAtividade.info(`Nível do usuário do domínio id=${id} alterado para "${nivel}" — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Nível de acesso atualizado.' });

  } catch (erro) {
    logErro.error(`Erro ao alterar nível do usuário do domínio id=${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao atualizar.' });
  }
});

// PATCH /api/ad/usuarios/:id/status — Ativar/Bloquear
router.patch('/api/ad/usuarios/:id/status', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const id           = parseInt(req.params.id);
  const { ativo }    = req.body;

  try {
    await pool.request()
      .input('id',    sql.Int, id)
      .input('ativo', sql.Bit, ativo ? 1 : 0)
      .query('UPDATE usuarios_dominio SET ativo = @ativo WHERE id = @id');

    logAtividade.info(`Usuário do domínio id=${id} ${ativo ? 'ativado' : 'bloqueado'} — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: ativo ? 'Usuário ativado.' : 'Usuário bloqueado.' });

  } catch (erro) {
    logErro.error(`Erro ao alterar status do usuário do domínio id=${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao alterar status.' });
  }
});

// DELETE /api/ad/usuarios/:id — Remover acesso ao portal
router.delete('/api/ad/usuarios/:id', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const id           = parseInt(req.params.id);

  try {
    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM usuarios_dominio WHERE id = @id');

    logAtividade.info(`Usuário do domínio id=${id} removido do portal — por: "${admin}"`);
    res.json({ sucesso: true, mensagem: 'Acesso removido.' });

  } catch (erro) {
    logErro.error(`Erro ao remover usuário do domínio id=${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao remover usuário.' });
  }
});

// ============================================================
// API — MANUTENÇÃO
// ============================================================

// Lista de todas as tabelas com metadados para backup/restore
const TABELAS_BACKUP = [
  // Portal
  { nome: 'usuarios',         identidade: true,  fk: [] },
  { nome: 'usuarios_dominio', identidade: true,  fk: [] },
  { nome: 'sistemas',         identidade: true,  fk: [] },
  { nome: 'servicos',         identidade: true,  fk: [] },
  { nome: 'configuracoes',    identidade: true,  fk: [] },
  { nome: 'logs_atividade',   identidade: true,  fk: [] },
  // Chamados
  { nome: 'chamados_setores',   identidade: true,  fk: [] },
  { nome: 'chamados_perfis',    identidade: true,  fk: ['chamados_setores'] },
  { nome: 'chamados_contadores',identidade: true,  fk: ['chamados_setores'] },
  { nome: 'chamados',           identidade: true,  fk: ['chamados_setores'], selfRef: 'chamado_pai_id' },
  { nome: 'chamados_historico', identidade: true,  fk: ['chamados'] },
  // Agenda Tarefas
  { nome: 'agenda_listas',     identidade: true, fk: [] },
  { nome: 'agenda_membros',    identidade: true, fk: ['agenda_listas'] },
  { nome: 'agenda_categorias', identidade: true, fk: ['agenda_listas'] },
  { nome: 'agenda_tarefas',    identidade: true, fk: ['agenda_listas', 'agenda_categorias'] },
  { nome: 'agenda_passos',     identidade: true, fk: ['agenda_tarefas'] },
  // Agenda Financeira
  { nome: 'fin_agendas',    identidade: true, fk: [] },
  { nome: 'fin_membros',    identidade: true, fk: ['fin_agendas'] },
  { nome: 'fin_categorias', identidade: true, fk: ['fin_agendas'] },
  { nome: 'fin_empresas',   identidade: true, fk: ['fin_agendas'] },
  { nome: 'fin_contas',     identidade: true, fk: ['fin_agendas', 'fin_categorias', 'fin_empresas'] },
  { nome: 'fin_logs',       identidade: true, fk: ['fin_agendas'] },
  // Patrimônio
  { nome: 'pat_categorias', identidade: true, fk: [] },
  { nome: 'pat_unidades',   identidade: true, fk: [] },
  { nome: 'pat_permissoes', identidade: true, fk: [] },
  { nome: 'pat_bens',       identidade: true, fk: ['pat_categorias', 'pat_unidades'] },
  { nome: 'pat_historico',  identidade: true, fk: ['pat_bens'] },
  // Contatos
  { nome: 'contatos_listas',  identidade: true, fk: [] },
  { nome: 'contatos_membros', identidade: true, fk: ['contatos_listas'] },
  { nome: 'contatos',         identidade: true, fk: ['contatos_listas'] },
  // Aprovações
  { nome: 'aprovacoes',               identidade: true, fk: [] },
  { nome: 'aprovacoes_participantes', identidade: true, fk: ['aprovacoes'] },
  { nome: 'aprovacoes_observadores',  identidade: true, fk: ['aprovacoes'] },
  { nome: 'aprovacoes_log',           identidade: true, fk: ['aprovacoes'] },
  { nome: 'aprovacoes_anexos',        identidade: true, fk: ['aprovacoes'] },
  // Calendários
  { nome: 'cal_agendas',       identidade: true,  fk: [] },
  { nome: 'cal_membros',       identidade: true,  fk: ['cal_agendas'] },
  { nome: 'cal_eventos',       identidade: true,  fk: ['cal_agendas'] },
  { nome: 'cal_caldav_config', identidade: false, fk: [] },
];

// GET /api/manutencao/usuarios — Lista todos os usuários (locais + domínio)
router.get('/api/manutencao/usuarios', verificarLogin, verificarAdmin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  try {
    const r = await pool.request().query(`
      SELECT usuario AS login, nome FROM usuarios WHERE ativo = 1
      UNION
      SELECT login, nome FROM usuarios_dominio WHERE ativo = 1
      ORDER BY nome
    `);
    res.json({ sucesso: true, usuarios: r.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar usuários manutenção: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao listar usuários.' });
  }
});

// GET /api/manutencao/backup — Exporta todas as tabelas como JSON
router.get('/api/manutencao/backup', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;

  try {
    const backup = { versao: '1.0', data: new Date().toISOString(), tabelas: {} };

    for (const t of TABELAS_BACKUP) {
      try {
        const r = await pool.request().query(`SELECT * FROM ${t.nome}`);
        backup.tabelas[t.nome] = r.recordset;
      } catch (e) {
        backup.tabelas[t.nome] = [];
      }
    }

    logAtividade.info(`Backup do banco realizado — por: "${admin}"`);
    registrarLog(pool, { usuario: admin, ip: req.ip, acao: 'MANUTENCAO', sistema: 'portal', detalhes: 'Backup do banco realizado' });

    const nomeArquivo = `backup_portal_${new Date().toISOString().slice(0,10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(backup);

  } catch (erro) {
    logErro.error(`Erro ao gerar backup: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao gerar backup.' });
  }
});

// POST /api/manutencao/restore — Restaura banco a partir de JSON
router.post('/api/manutencao/restore', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const { tabelas }  = req.body;

  if (!tabelas || typeof tabelas !== 'object') {
    return res.status(400).json({ erro: 'Dados de backup inválidos.' });
  }

  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const req2 = new sql.Request(transaction);

    // Desabilita todas as FK constraints para facilitar a restauração
    await req2.query(`
      EXEC sp_msforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL'
    `);

    // Deleta na ordem reversa (filhos antes de pais)
    const tabelasReverso = [...TABELAS_BACKUP].reverse();
    for (const t of tabelasReverso) {
      if (tabelas[t.nome] !== undefined) {
        const rDel = new sql.Request(transaction);
        try { await rDel.query(`DELETE FROM ${t.nome}`); } catch (e) { /* tabela pode não existir */ }
      }
    }

    // Insere na ordem normal (pais antes de filhos)
    for (const t of TABELAS_BACKUP) {
      const linhas = tabelas[t.nome];
      if (!linhas || linhas.length === 0) continue;

      const rIns = new sql.Request(transaction);
      try { await rIns.query(`SET IDENTITY_INSERT ${t.nome} ON`); } catch (e) { /* sem identity */ }

      for (const linha of linhas) {
        const colunas = Object.keys(linha);
        if (colunas.length === 0) continue;
        const rRow = new sql.Request(transaction);
        const nomes = colunas.map(c => `[${c}]`).join(', ');
        const params = colunas.map((c, i) => `@p${i}`).join(', ');
        colunas.forEach((c, i) => {
          const v = linha[c];
          if (v === null || v === undefined) {
            rRow.input(`p${i}`, sql.NVarChar, null);
          } else if (typeof v === 'number') {
            rRow.input(`p${i}`, sql.Decimal(18, 4), v);
          } else if (typeof v === 'boolean') {
            rRow.input(`p${i}`, sql.Bit, v ? 1 : 0);
          } else {
            rRow.input(`p${i}`, sql.NVarChar(sql.MAX), String(v));
          }
        });
        await rRow.query(`INSERT INTO ${t.nome} (${nomes}) VALUES (${params})`);
      }

      const rOff = new sql.Request(transaction);
      try { await rOff.query(`SET IDENTITY_INSERT ${t.nome} OFF`); } catch (e) { /* sem identity */ }
    }

    // Reabilita FK constraints
    const rFk = new sql.Request(transaction);
    await rFk.query(`
      EXEC sp_msforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL'
    `);

    await transaction.commit();
    logAtividade.info(`Restore do banco realizado — por: "${admin}"`);
    registrarLog(pool, { usuario: admin, ip: req.ip, acao: 'MANUTENCAO', sistema: 'portal', detalhes: 'Restore do banco realizado' });
    res.json({ sucesso: true, mensagem: 'Banco restaurado com sucesso.' });

  } catch (erro) {
    try { await transaction.rollback(); } catch (e) { /* ignore */ }
    logErro.error(`Erro no restore: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao restaurar banco: ' + erro.message });
  }
});

// POST /api/manutencao/limpar — Limpa dados por sistema (opcionalmente por usuário)
router.post('/api/manutencao/limpar', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const { sistema, usuario } = req.body;  // usuario = login específico ou vazio = todos

  if (!['chamados', 'tarefas', 'financeiro', 'logs', 'patrimonio', 'contatos', 'aprovacoes', 'calendarios', 'tudo'].includes(sistema)) {
    return res.status(400).json({ erro: 'Sistema inválido.' });
  }

  const u = usuario ? usuario.trim() : null;

  // Monta clausulas WHERE condicionais — usa parâmetro nomeado @u
  const wChamados    = u ? ' WHERE login_solicitante = @u' : '';
  const wChamHist    = u ? ' WHERE chamado_id IN (SELECT id FROM chamados WHERE login_solicitante = @u)' : '';
  const wChamPai     = u ? ' SET chamado_pai_id = NULL WHERE chamado_pai_id IN (SELECT id FROM chamados WHERE login_solicitante = @u)' : ' SET chamado_pai_id = NULL';
  const wListas      = u ? ' WHERE dono = @u' : '';
  const wTarefas     = u ? ' WHERE lista_id IN (SELECT id FROM agenda_listas WHERE dono = @u)' : '';
  const wPassos      = u ? ' WHERE tarefa_id IN (SELECT id FROM agenda_tarefas WHERE lista_id IN (SELECT id FROM agenda_listas WHERE dono = @u))' : '';
  const wAgMembros   = u ? ' WHERE lista_id IN (SELECT id FROM agenda_listas WHERE dono = @u)' : '';
  const wAgCat       = u ? ' WHERE lista_id IN (SELECT id FROM agenda_listas WHERE dono = @u)' : '';
  const wFinAgendas  = u ? ' WHERE dono = @u' : '';
  const wFinSub      = u ? ' WHERE agenda_id IN (SELECT id FROM fin_agendas WHERE dono = @u)' : '';
  const wContListas  = u ? ' WHERE dono = @u' : '';
  const wContSub     = u ? ' WHERE lista_id IN (SELECT id FROM contatos_listas WHERE dono = @u)' : '';
  const wAprov       = u ? ' WHERE criado_por = @u' : '';
  const wAprovSub    = u ? ' WHERE aprovacao_id IN (SELECT id FROM aprovacoes WHERE criado_por = @u)' : '';
  const wCalAgendas  = u ? ' WHERE dono = @u' : '';
  const wCalSub      = u ? ' WHERE agenda_id IN (SELECT id FROM cal_agendas WHERE dono = @u)' : '';
  const wCalDav      = u ? ' WHERE usuario = @u' : '';

  const exec = async (stmt) => {
    try {
      const r = pool.request();
      if (u) r.input('u', sql.VarChar, u);
      await r.query(stmt);
    } catch (e) { /* tabela pode não existir */ }
  };

  try {
    if (sistema === 'chamados' || sistema === 'tudo') {
      await exec(`DELETE FROM chamados_historico${wChamHist}`);
      await exec(`UPDATE chamados${wChamPai}`);
      await exec(`DELETE FROM chamados${wChamados}`);
      if (!u) await exec('UPDATE chamados_contadores SET ultimo_numero = 0');
    }
    if (sistema === 'tarefas' || sistema === 'tudo') {
      await exec(`DELETE FROM agenda_passos${wPassos}`);
      await exec(`DELETE FROM agenda_tarefas${wTarefas}`);
      await exec(`DELETE FROM agenda_membros${wAgMembros}`);
      await exec(`DELETE FROM agenda_categorias${wAgCat}`);
      await exec(`DELETE FROM agenda_listas${wListas}`);
    }
    if (sistema === 'financeiro' || sistema === 'tudo') {
      await exec(`DELETE FROM fin_logs${wFinSub}`);
      await exec(`DELETE FROM fin_contas${wFinSub}`);
      await exec(`DELETE FROM fin_empresas${wFinSub}`);
      await exec(`DELETE FROM fin_categorias${wFinSub}`);
      await exec(`DELETE FROM fin_membros${wFinSub}`);
      await exec(`DELETE FROM fin_agendas${wFinAgendas}`);
    }
    if (sistema === 'logs' || sistema === 'tudo') {
      await exec('DELETE FROM logs_atividade');
    }
    if (sistema === 'patrimonio' || sistema === 'tudo') {
      await exec('DELETE FROM pat_historico');
      await exec('DELETE FROM pat_bens');
    }
    if (sistema === 'contatos' || sistema === 'tudo') {
      await exec(`DELETE FROM contatos${wContSub}`);
      await exec(`DELETE FROM contatos_membros${wContSub}`);
      await exec(`DELETE FROM contatos_listas${wContListas}`);
    }
    if (sistema === 'aprovacoes' || sistema === 'tudo') {
      await exec(`DELETE FROM aprovacoes_anexos${wAprovSub}`);
      await exec(`DELETE FROM aprovacoes_log${wAprovSub}`);
      await exec(`DELETE FROM aprovacoes_observadores${wAprovSub}`);
      await exec(`DELETE FROM aprovacoes_participantes${wAprovSub}`);
      await exec(`DELETE FROM aprovacoes${wAprov}`);
    }
    if (sistema === 'calendarios' || sistema === 'tudo') {
      await exec(`DELETE FROM cal_eventos${wCalSub}`);
      await exec(`DELETE FROM cal_membros${wCalSub}`);
      await exec(`DELETE FROM cal_agendas${wCalAgendas}`);
      await exec(`DELETE FROM cal_caldav_config${wCalDav}`);
    }

    const label = u ? ` do usuário "${u}"` : '';
    logAtividade.info(`Limpeza de dados — sistema: "${sistema}"${label} — por: "${admin}"`);
    registrarLog(pool, { usuario: admin, ip: req.ip, acao: 'MANUTENCAO', sistema: 'portal', detalhes: `Limpeza de dados: "${sistema}"${label}` });
    res.json({ sucesso: true, mensagem: `Dados de "${sistema}"${label} removidos com sucesso.` });
  } catch (erro) {
    logErro.error(`Erro ao limpar dados (${sistema}): ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao limpar dados: ' + erro.message });
  }
});

// POST /api/manutencao/transferir — Transfere propriedade de agendas entre usuários
router.post('/api/manutencao/transferir', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;
  const { origem, destino, sistemas } = req.body;  // sistemas: array ['tarefas','financeiro']

  if (!origem || !destino) {
    return res.status(400).json({ erro: 'Informe os usuários de origem e destino.' });
  }
  if (origem === destino) {
    return res.status(400).json({ erro: 'Origem e destino devem ser usuários diferentes.' });
  }
  if (!Array.isArray(sistemas) || sistemas.length === 0) {
    return res.status(400).json({ erro: 'Selecione pelo menos um sistema.' });
  }

  const transferidos = [];
  try {
    if (sistemas.includes('tarefas')) {
      const r = await pool.request()
        .input('origem',  sql.VarChar, origem)
        .input('destino', sql.VarChar, destino)
        .query('UPDATE agenda_listas SET dono = @destino WHERE dono = @origem');
      transferidos.push(`Tarefas: ${r.rowsAffected[0]} agenda(s)`);
    }
    if (sistemas.includes('financeiro')) {
      const r = await pool.request()
        .input('origem',  sql.VarChar, origem)
        .input('destino', sql.VarChar, destino)
        .query('UPDATE fin_agendas SET dono = @destino WHERE dono = @origem');
      transferidos.push(`Financeiro: ${r.rowsAffected[0]} agenda(s)`);
    }
    if (sistemas.includes('contatos')) {
      const r = await pool.request()
        .input('origem',  sql.VarChar, origem)
        .input('destino', sql.VarChar, destino)
        .query('UPDATE contatos_listas SET dono = @destino WHERE dono = @origem');
      transferidos.push(`Contatos: ${r.rowsAffected[0]} lista(s)`);
    }
    if (sistemas.includes('calendarios')) {
      const r = await pool.request()
        .input('origem',  sql.VarChar, origem)
        .input('destino', sql.VarChar, destino)
        .query('UPDATE cal_agendas SET dono = @destino WHERE dono = @origem');
      transferidos.push(`Calendários: ${r.rowsAffected[0]} agenda(s)`);
    }

    logAtividade.info(`Transferência de agendas: "${origem}" → "${destino}" — por: "${admin}"`);
    registrarLog(pool, { usuario: admin, ip: req.ip, acao: 'MANUTENCAO', sistema: 'portal', detalhes: `Transferência de agendas: "${origem}" → "${destino}"` });
    res.json({ sucesso: true, mensagem: 'Transferência concluída. ' + transferidos.join(' | ') });
  } catch (erro) {
    logErro.error(`Erro na transferência: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao transferir agendas: ' + erro.message });
  }
});

// POST /api/manutencao/reset — Reset completo, preserva admin e configurações
router.post('/api/manutencao/reset', verificarLogin, verificarAdmin, async (req, res) => {
  const pool         = req.app.locals.pool;
  const logAtividade = req.app.locals.logAtividade;
  const logErro      = req.app.locals.logErro;
  const admin        = req.session.usuario.usuario;

  try {
    const stmts = [
      // Chamados
      'DELETE FROM chamados_historico',
      'UPDATE chamados SET chamado_pai_id = NULL',
      'DELETE FROM chamados',
      'UPDATE chamados_contadores SET ultimo_numero = 0',
      // Tarefas
      'DELETE FROM agenda_passos',
      'DELETE FROM agenda_tarefas',
      'DELETE FROM agenda_membros',
      'DELETE FROM agenda_categorias',
      'DELETE FROM agenda_listas',
      // Financeiro
      'DELETE FROM fin_logs',
      'DELETE FROM fin_contas',
      'DELETE FROM fin_empresas',
      'DELETE FROM fin_categorias',
      'DELETE FROM fin_membros',
      'DELETE FROM fin_agendas',
      // Logs
      'DELETE FROM logs_atividade',
      // Contatos
      'DELETE FROM contatos',
      'DELETE FROM contatos_membros',
      'DELETE FROM contatos_listas',
      // Aprovações
      'DELETE FROM aprovacoes_anexos',
      'DELETE FROM aprovacoes_log',
      'DELETE FROM aprovacoes_observadores',
      'DELETE FROM aprovacoes_participantes',
      'DELETE FROM aprovacoes',
      // Calendários
      'DELETE FROM cal_eventos',
      'DELETE FROM cal_membros',
      'DELETE FROM cal_agendas',
      'DELETE FROM cal_caldav_config',
      // Usuários — mantém apenas admin
      "DELETE FROM usuarios_dominio",
      "DELETE FROM usuarios WHERE nivel <> 'admin'",
    ];

    for (const stmt of stmts) {
      try {
        await pool.request().query(stmt);
      } catch (e) { /* tabela pode não existir */ }
    }

    logAtividade.info(`Reset completo do portal — por: "${admin}"`);
    registrarLog(pool, { usuario: admin, ip: req.ip, acao: 'MANUTENCAO', sistema: 'portal', detalhes: 'Reset completo do portal realizado' });
    res.json({ sucesso: true, mensagem: 'Portal resetado. Apenas o usuário admin foi preservado.' });
  } catch (erro) {
    logErro.error(`Erro no reset: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao resetar portal: ' + erro.message });
  }
});

// ============================================================
// GET /api/portal/popup — Notificações em tempo real de todos os sistemas
// ============================================================
router.get('/api/portal/popup', verificarLogin, async (req, res) => {
  const pool  = req.app.locals.pool;
  const login = req.session.usuario.usuario || req.session.usuario.login;
  const nivel = req.session.usuario.nivel   || '';

  try {
    const diasLembreteR = await pool.request()
      .query(`SELECT valor FROM configuracoes WHERE chave = 'financeiro.dias_lembrete'`);
    const diasLembrete = parseInt(diasLembreteR.recordset[0]?.valor) || 3;

    const [aprovR, aprovResR, chamRespR, chamAtendR, chamFinalR, chamSemR, chamAtribR, finVencidasR, finVencendoR, finALancarR] = await Promise.all([

      // 1. Aprovações pendentes onde sou aprovador
      pool.request().input('login', sql.VarChar, login).query(`
        SELECT a.id, a.titulo, a.criado_por_nome, a.criado_em
        FROM aprovacoes a
        JOIN aprovacoes_participantes ap ON ap.aprovacao_id = a.id
        WHERE ap.aprovador_login = @login
          AND ap.decisao = 'Pendente'
          AND a.status   = 'Pendente'
        ORDER BY a.criado_em ASC
      `),

      // 2. Minhas aprovações criadas com resultado nos últimos 7 dias
      pool.request().input('login', sql.VarChar, login).query(`
        SELECT TOP 10 id, titulo, status, atualizado_em
        FROM aprovacoes
        WHERE criado_por = @login
          AND status IN ('Aprovado', 'Reprovado')
          AND atualizado_em >= DATEADD(day, -7, GETDATE())
        ORDER BY atualizado_em DESC
      `),

      // 3. Meus chamados respondidos pelo técnico (aguardando meu feedback)
      pool.request().input('login', sql.VarChar, login).query(`
        SELECT TOP 15 id, protocolo, assunto, atualizado_em
        FROM chamados
        WHERE login_solicitante = @login
          AND status = 'Respondido'
          AND (excluido IS NULL OR excluido = 0)
        ORDER BY atualizado_em DESC
      `),

      // 4. Meus chamados em atendimento (aceitos pelo técnico)
      pool.request().input('login', sql.VarChar, login).query(`
        SELECT TOP 10 id, protocolo, assunto, atualizado_em, nome_atendedor
        FROM chamados
        WHERE login_solicitante = @login
          AND status = 'Em Atendimento'
          AND (excluido IS NULL OR excluido = 0)
        ORDER BY atualizado_em DESC
      `),

      // 5. Meus chamados finalizados nos últimos 7 dias
      pool.request().input('login', sql.VarChar, login).query(`
        SELECT TOP 10 id, protocolo, assunto, atualizado_em
        FROM chamados
        WHERE login_solicitante = @login
          AND status = 'Finalizado'
          AND atualizado_em >= DATEADD(day, -7, GETDATE())
          AND (excluido IS NULL OR excluido = 0)
        ORDER BY atualizado_em DESC
      `),

      // 6. Admin/gestor: chamados abertos/reabertos sem atendedor
      ['admin', 'gestor'].includes(nivel)
        ? pool.request().query(`
            SELECT TOP 10 id, protocolo, assunto, criado_em
            FROM chamados
            WHERE status IN ('Aberto', 'Reaberto')
              AND (login_atendedor IS NULL OR login_atendedor = '')
              AND (excluido IS NULL OR excluido = 0)
            ORDER BY criado_em ASC
          `)
        : Promise.resolve({ recordset: [] }),

      // 7. Chamados atribuídos a mim como técnico (Aberto/Em Atendimento/Reaberto)
      pool.request().input('login', sql.VarChar, login).query(`
        SELECT TOP 15 id, protocolo, assunto, status, atualizado_em, nome_solicitante
        FROM chamados
        WHERE login_atendedor = @login
          AND status IN ('Aberto', 'Em Atendimento', 'Reaberto')
          AND (excluido IS NULL OR excluido = 0)
        ORDER BY atualizado_em DESC
      `),

      // 8. Contas vencidas (data < hoje, status=pendente) em agendas acessíveis
      pool.request().input('login', sql.VarChar, login).query(`
        SELECT TOP 15 c.id, c.descricao, c.valor, c.data, c.categoria, fa.nome AS agenda_nome
        FROM fin_contas c
        JOIN fin_agendas fa ON fa.id = c.agenda_id
        WHERE c.status IN ('pendente', 'lancado')
          AND c.data < CAST(GETDATE() AS DATE)
          AND c.eh_pai = 0
          AND (fa.dono = @login
            OR EXISTS (SELECT 1 FROM fin_membros fm WHERE fm.agenda_id = fa.id AND fm.usuario = @login))
        ORDER BY c.data ASC
      `),

      // 9. Contas LANÇADAS vencendo nos próximos N dias (status=lancado)
      pool.request().input('login', sql.VarChar, login).input('diasLembrete', sql.Int, diasLembrete).query(`
        SELECT TOP 15 c.id, c.descricao, c.valor, c.data, c.categoria, fa.nome AS agenda_nome
        FROM fin_contas c
        JOIN fin_agendas fa ON fa.id = c.agenda_id
        WHERE c.status = 'lancado'
          AND c.data >= CAST(GETDATE() AS DATE)
          AND c.data <= DATEADD(day, @diasLembrete, CAST(GETDATE() AS DATE))
          AND c.eh_pai = 0
          AND (fa.dono = @login
            OR EXISTS (SELECT 1 FROM fin_membros fm WHERE fm.agenda_id = fa.id AND fm.usuario = @login))
        ORDER BY c.data ASC
      `),

      // 10. Contas a LANÇAR nos próximos N dias (status=pendente, ainda sem lançamento)
      pool.request().input('login', sql.VarChar, login).input('diasLembrete', sql.Int, diasLembrete).query(`
        SELECT TOP 15 c.id, c.descricao, c.valor, c.data, c.categoria, fa.nome AS agenda_nome
        FROM fin_contas c
        JOIN fin_agendas fa ON fa.id = c.agenda_id
        WHERE c.status = 'pendente'
          AND c.data >= CAST(GETDATE() AS DATE)
          AND c.data <= DATEADD(day, @diasLembrete, CAST(GETDATE() AS DATE))
          AND c.eh_pai = 0
          AND (fa.dono = @login
            OR EXISTS (SELECT 1 FROM fin_membros fm WHERE fm.agenda_id = fa.id AND fm.usuario = @login))
        ORDER BY c.data ASC
      `),
    ]);

    const statusLabel = { Aprovado: '✅ Aprovada', Reprovado: '❌ Reprovada' };

    res.json({
      aprovacoes: aprovR.recordset.map(a => ({
        id:        a.id,
        titulo:    a.titulo,
        subtitulo: 'Criado por ' + (a.criado_por_nome || ''),
        criado_em: a.criado_em,
        link:      '/aprovacoes'
      })),

      aprovacoes_resultado: aprovResR.recordset.map(a => ({
        id:        a.id,
        titulo:    a.titulo,
        subtitulo: (statusLabel[a.status] || a.status),
        criado_em: a.atualizado_em,
        link:      '/aprovacoes'
      })),

      chamados_respondidos: chamRespR.recordset.map(c => ({
        id:        c.id,
        titulo:    c.assunto,
        subtitulo: 'Protocolo ' + c.protocolo + ' — aguarda seu feedback',
        criado_em: c.atualizado_em,
        link:      '/chamados'
      })),

      chamados_em_atendimento: chamAtendR.recordset.map(c => ({
        id:        c.id,
        titulo:    c.assunto,
        subtitulo: 'Protocolo ' + c.protocolo + (c.nome_atendedor ? ' — ' + c.nome_atendedor : ''),
        criado_em: c.atualizado_em,
        link:      '/chamados'
      })),

      chamados_finalizados: chamFinalR.recordset.map(c => ({
        id:        c.id,
        titulo:    c.assunto,
        subtitulo: 'Protocolo ' + c.protocolo + ' — concluído',
        criado_em: c.atualizado_em,
        link:      '/chamados'
      })),

      chamados_sem_atendedor: chamSemR.recordset.map(c => ({
        id:        c.id,
        titulo:    c.assunto,
        subtitulo: 'Protocolo ' + c.protocolo + ' — aguardando técnico',
        criado_em: c.criado_em,
        link:      '/chamados'
      })),

      chamados_atribuidos: chamAtribR.recordset.map(c => ({
        id:        c.id,
        titulo:    c.assunto,
        subtitulo: 'Protocolo ' + c.protocolo + ' — ' + c.status + ' · ' + (c.nome_solicitante || ''),
        criado_em: c.atualizado_em,
        link:      '/chamados'
      })),

      financeiro_vencidas: finVencidasR.recordset.map(c => ({
        id:        c.id,
        titulo:    c.descricao,
        subtitulo: (c.agenda_nome || '') + ' · R$ ' + Number(c.valor).toFixed(2) + ' · venceu ' + new Date(c.data).toLocaleDateString('pt-BR'),
        criado_em: c.data,
        link:      '/agendaFinanceira'
      })),

      financeiro_vencendo: finVencendoR.recordset.map(c => ({
        id:        c.id,
        titulo:    c.descricao,
        subtitulo: (c.agenda_nome || '') + ' · R$ ' + Number(c.valor).toFixed(2) + ' · vence ' + new Date(c.data).toLocaleDateString('pt-BR'),
        criado_em: c.data,
        link:      '/agendaFinanceira'
      })),

      financeiro_a_lancar: finALancarR.recordset.map(c => ({
        id:        c.id,
        titulo:    c.descricao,
        subtitulo: (c.agenda_nome || '') + ' · R$ ' + Number(c.valor).toFixed(2) + ' · vence ' + new Date(c.data).toLocaleDateString('pt-BR'),
        criado_em: c.data,
        link:      '/agendaFinanceira'
      })),
    });

  } catch (erro) {
    req.app.locals.logErro.error(`Erro popup notificações: ${erro.message}`);
    res.status(500).json({
      aprovacoes: [], aprovacoes_resultado: [],
      chamados_respondidos: [], chamados_em_atendimento: [],
      chamados_finalizados: [], chamados_sem_atendedor: [],
      chamados_atribuidos: [],
      financeiro_vencidas: [], financeiro_vencendo: [], financeiro_a_lancar: []
    });
  }
});

// ============================================================
// GET /conf/popup — Fragment para aba de configurações
// ============================================================
router.get('/conf/popup', verificarLogin, verificarAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/fragmentos/popup.html'));
});

module.exports = router;
