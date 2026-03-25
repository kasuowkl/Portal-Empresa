/**
 * ARQUIVO: routes/calendarios.js
 * VERSÃO: 1.0.0
 * DATA: 2026-03-23
 * DESCRIÇÃO: Rotas da Agenda de Calendários com integração CalDAV/Google Calendar
 */

const express = require('express');
const sql = require('mssql');
const path = require('path');
const verificarLogin = require('../middleware/verificarLogin');
const caldavService = require('../services/caldavService');
const router = express.Router();

// ============================================================
// Helper: obter permissão do usuário em um calendário
// Retorna: 'dono' | 'edicao' | 'leitura' | null
// ============================================================
async function getPermissao(pool, agendaId, usuario) {
  const result = await pool.request()
    .input('agenda_id', sql.Int, agendaId)
    .input('usuario', sql.VarChar, usuario)
    .query(`
      SELECT 'dono' AS permissao
      FROM cal_agendas
      WHERE id = @agenda_id AND dono = @usuario
      UNION ALL
      SELECT permissao
      FROM cal_membros
      WHERE agenda_id = @agenda_id AND usuario = @usuario
    `);
  return result.recordset[0]?.permissao || null;
}

const NIVEL = { leitura: 1, edicao: 2, dono: 3 };

function temPermissao(perm, nivelMinimo) {
  return !!perm && (NIVEL[perm] || 0) >= (NIVEL[nivelMinimo] || 0);
}

// ============================================================
// GET /agendaCalendarios — Serve a página HTML
// ============================================================
router.get('/agendaCalendarios', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agendaCalendarios/index.html'));
});

// ============================================================
// GET /api/calendarios/agendas — Lista calendários do usuário
// ============================================================
router.get('/api/calendarios/agendas', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;

  try {
    const result = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .query(`
        SELECT a.id, a.nome, a.descricao, a.cor, a.dono, a.criado_em,
               CASE WHEN a.dono = @usuario THEN 'dono' ELSE m.permissao END AS permissao
        FROM cal_agendas a
        LEFT JOIN cal_membros m ON m.agenda_id = a.id AND m.usuario = @usuario
        WHERE a.dono = @usuario OR m.usuario = @usuario
        ORDER BY a.criado_em ASC
      `);
    res.json({ sucesso: true, agendas: result.recordset });
  } catch (erro) {
    console.error('[Calendarios] Erro ao listar agendas:', erro.message);
    res.status(500).json({ erro: 'Erro ao carregar agendas.' });
  }
});

// ============================================================
// POST /api/calendarios/agendas — Criar calendário
// ============================================================
router.post('/api/calendarios/agendas', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { nome, descricao, cor } = req.body;

  if (!nome?.trim()) return res.status(400).json({ erro: 'Informe o nome do calendário.' });

  try {
    const result = await pool.request()
      .input('nome', sql.VarChar, nome.trim())
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('cor', sql.VarChar, cor || '#3b82f6')
      .input('dono', sql.VarChar, usuario)
      .query(`
        INSERT INTO cal_agendas (nome, descricao, cor, dono)
        OUTPUT INSERTED.id, INSERTED.nome, INSERTED.descricao, INSERTED.cor, INSERTED.dono, INSERTED.criado_em
        VALUES (@nome, @descricao, @cor, @dono)
      `);
    const agenda = { ...result.recordset[0], permissao: 'dono' };

    // Criar calendário no Google (fire-and-forget)
    caldavService.criarCalendarioGoogle(usuario, pool, nome.trim(), cor || '#3b82f6').then(async (resultGoogle) => {
      if (resultGoogle.sucesso && resultGoogle.googleCalPath) {
        await pool.request()
          .input('id', sql.Int, agenda.id)
          .input('path', sql.VarChar, resultGoogle.googleCalPath)
          .query('UPDATE cal_agendas SET google_cal_path = @path WHERE id = @id');
        console.log(`[Calendarios] Google Calendar path salvo para agenda ${agenda.id}: ${resultGoogle.googleCalPath}`);
      }
    }).catch(err => console.error('[Calendarios] Erro ao criar calendário no Google:', err.message));

    res.json({ sucesso: true, agenda });
  } catch (erro) {
    console.error('[Calendarios] Erro ao criar agenda:', erro.message);
    res.status(500).json({ erro: 'Erro ao criar calendário.' });
  }
});

// ============================================================
// PATCH /api/calendarios/agendas/:id — Editar calendário
// ============================================================
router.patch('/api/calendarios/agendas/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { id } = req.params;
  const { nome, descricao, cor } = req.body;

  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!temPermissao(perm, 'edicao')) {
      return res.status(403).json({ erro: 'Sem permissão para editar.' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('nome', sql.VarChar, nome?.trim() || '')
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('cor', sql.VarChar, cor || '#3b82f6')
      .query(`
        UPDATE cal_agendas
        SET nome = @nome, descricao = @descricao, cor = @cor
        WHERE id = @id
      `);
    res.json({ sucesso: true });
  } catch (erro) {
    console.error('[Calendarios] Erro ao editar agenda:', erro.message);
    res.status(500).json({ erro: 'Erro ao editar calendário.' });
  }
});

// ============================================================
// DELETE /api/calendarios/agendas/:id — Deletar calendário
// ============================================================
router.delete('/api/calendarios/agendas/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { id } = req.params;

  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!temPermissao(perm, 'dono')) {
      return res.status(403).json({ erro: 'Apenas o dono pode deletar.' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .query(`
        DELETE FROM cal_eventos WHERE agenda_id = @id;
        DELETE FROM cal_membros WHERE agenda_id = @id;
        DELETE FROM cal_agendas WHERE id = @id;
      `);
    res.json({ sucesso: true });
  } catch (erro) {
    console.error('[Calendarios] Erro ao deletar agenda:', erro.message);
    res.status(500).json({ erro: 'Erro ao deletar calendário.' });
  }
});

// ============================================================
// GET /api/calendarios/eventos — Listar eventos
// Query params: start, end, agendas (comma-separated IDs)
// ============================================================
router.get('/api/calendarios/eventos', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { start, end, agendas } = req.query;

  try {
    const agendaIds = agendas ? agendas.split(',').map(Number) : [];
    if (agendaIds.length === 0) {
      return res.json({ sucesso: true, eventos: [] });
    }

    const placeholders = agendaIds.map((_, i) => `@agenda${i}`).join(',');
    let query = `
      SELECT e.id, e.agenda_id, e.titulo, e.descricao, e.inicio, e.fim, e.dia_inteiro,
             e.cor, e.recorrencia, e.criado_por, a.cor as cor_padrao
      FROM cal_eventos e
      JOIN cal_agendas a ON a.id = e.agenda_id
      WHERE e.agenda_id IN (${placeholders})
    `;

    if (start) query += ` AND e.fim >= @start`;
    if (end) query += ` AND e.inicio <= @end`;

    const req_query = pool.request();
    agendaIds.forEach((id, i) => req_query.input(`agenda${i}`, sql.Int, id));
    if (start) req_query.input('start', sql.DateTime, new Date(start));
    if (end) req_query.input('end', sql.DateTime, new Date(end));

    const result = await req_query.query(query + ' ORDER BY e.inicio ASC');
    res.json({ sucesso: true, eventos: result.recordset });
  } catch (erro) {
    console.error('[Calendarios] Erro ao listar eventos:', erro.message);
    res.status(500).json({ erro: 'Erro ao carregar eventos.' });
  }
});

// ============================================================
// POST /api/calendarios/eventos — Criar evento
// ============================================================
router.post('/api/calendarios/eventos', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { agenda_id, titulo, descricao, inicio, fim, dia_inteiro, cor, recorrencia } = req.body;

  try {
    const perm = await getPermissao(pool, agenda_id, usuario);
    if (!temPermissao(perm, 'edicao')) {
      return res.status(403).json({ erro: 'Sem permissão para criar eventos.' });
    }

    const result = await pool.request()
      .input('agenda_id', sql.Int, agenda_id)
      .input('titulo', sql.VarChar, titulo?.trim() || 'Sem título')
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('inicio', sql.DateTime, new Date(inicio))
      .input('fim', sql.DateTime, new Date(fim))
      .input('dia_inteiro', sql.Bit, dia_inteiro ? 1 : 0)
      .input('cor', sql.VarChar, cor || null)
      .input('recorrencia', sql.VarChar, recorrencia || null)
      .input('criado_por', sql.VarChar, usuario)
      .query(`
        INSERT INTO cal_eventos (agenda_id, titulo, descricao, inicio, fim, dia_inteiro, cor, recorrencia, criado_por)
        OUTPUT INSERTED.id, INSERTED.agenda_id, INSERTED.titulo, INSERTED.inicio, INSERTED.fim, INSERTED.dia_inteiro, INSERTED.cor
        VALUES (@agenda_id, @titulo, @descricao, @inicio, @fim, @dia_inteiro, @cor, @recorrencia, @criado_por)
      `);

    const evento = result.recordset[0];

    // Buscar google_cal_path da agenda
    const agendaInfo = await pool.request()
      .input('agenda_id', sql.Int, agenda_id)
      .query('SELECT google_cal_path FROM cal_agendas WHERE id = @agenda_id');
    const googleCalPath = agendaInfo.recordset[0]?.google_cal_path || null;

    // Sincronizar com Google se configurado (fire-and-forget com catch)
    caldavService.criarEventoGoogle(usuario, pool, evento, googleCalPath).then(async (resultSync) => {
      if (resultSync.sucesso && resultSync.uid_caldav) {
        await pool.request()
          .input('id', sql.Int, evento.id)
          .input('uid_caldav', sql.VarChar, resultSync.uid_caldav)
          .input('etag_caldav', sql.VarChar, resultSync.etag_caldav)
          .query(`UPDATE cal_eventos SET uid_caldav = @uid_caldav, etag_caldav = @etag_caldav WHERE id = @id`);
      }
    }).catch(err => console.error('[Calendarios] Erro sync Google (criar):', err.message));

    res.json({ sucesso: true, evento });
  } catch (erro) {
    console.error('[Calendarios] Erro ao criar evento:', erro.message);
    res.status(500).json({ erro: 'Erro ao criar evento.' });
  }
});

// ============================================================
// PATCH /api/calendarios/eventos/:id — Editar evento
// ============================================================
router.patch('/api/calendarios/eventos/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { id } = req.params;
  const { titulo, descricao, inicio, fim, dia_inteiro, cor } = req.body;

  try {
    // Verificar permissão
    const eventoResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT agenda_id FROM cal_eventos WHERE id = @id');

    if (eventoResult.recordset.length === 0) {
      return res.status(404).json({ erro: 'Evento não encontrado.' });
    }

    const agendaId = eventoResult.recordset[0].agenda_id;
    const perm = await getPermissao(pool, agendaId, usuario);
    if (!temPermissao(perm, 'edicao')) {
      return res.status(403).json({ erro: 'Sem permissão para editar.' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('titulo', sql.VarChar, titulo?.trim() || 'Sem título')
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('inicio', sql.DateTime, new Date(inicio))
      .input('fim', sql.DateTime, new Date(fim))
      .input('dia_inteiro', sql.Bit, dia_inteiro ? 1 : 0)
      .input('cor', sql.VarChar, cor || null)
      .query(`
        UPDATE cal_eventos
        SET titulo = @titulo, descricao = @descricao, inicio = @inicio, fim = @fim,
            dia_inteiro = @dia_inteiro, cor = @cor, atualizado_em = GETDATE()
        WHERE id = @id
      `);

    // Sincronizar com Google (fire-and-forget com catch)
    caldavService.editarEventoGoogle(usuario, pool, { id, titulo, inicio, fim })
      .catch(err => console.error('[Calendarios] Erro sync Google (editar):', err.message));

    res.json({ sucesso: true });
  } catch (erro) {
    console.error('[Calendarios] Erro ao editar evento:', erro.message);
    res.status(500).json({ erro: 'Erro ao editar evento.' });
  }
});

// ============================================================
// DELETE /api/calendarios/eventos/:id — Deletar evento
// ============================================================
router.delete('/api/calendarios/eventos/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { id } = req.params;

  try {
    const eventoResult = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT agenda_id, uid_caldav FROM cal_eventos WHERE id = @id');

    if (eventoResult.recordset.length === 0) {
      return res.status(404).json({ erro: 'Evento não encontrado.' });
    }

    const { agenda_id, uid_caldav } = eventoResult.recordset[0];
    const perm = await getPermissao(pool, agenda_id, usuario);
    if (!temPermissao(perm, 'edicao')) {
      return res.status(403).json({ erro: 'Sem permissão para deletar.' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM cal_eventos WHERE id = @id');

    // Sincronizar com Google (fire-and-forget com catch)
    if (uid_caldav) {
      caldavService.deletarEventoGoogle(usuario, pool, uid_caldav)
        .catch(err => console.error('[Calendarios] Erro sync Google (deletar):', err.message));
    }

    res.json({ sucesso: true });
  } catch (erro) {
    console.error('[Calendarios] Erro ao deletar evento:', erro.message);
    res.status(500).json({ erro: 'Erro ao deletar evento.' });
  }
});

// ============================================================
// CalDAV Configuration Endpoints
// ============================================================

// GET /api/calendarios/caldav/status
router.get('/api/calendarios/caldav/status', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;

  try {
    const config = await caldavService.obterConfiguracaoCaldav(pool, usuario);
    if (!config) {
      return res.json({ conectado: false });
    }
    res.json({
      conectado: true,
      email: config.email_google,
      ultimo_sync: config.ultimo_sync,
      sync_ativo: config.sync_ativo === 1
    });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao verificar status.' });
  }
});

// POST /api/calendarios/caldav/configurar
router.post('/api/calendarios/caldav/configurar', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { email_google, senha_app } = req.body;

  if (!email_google?.trim() || !senha_app?.trim()) {
    return res.status(400).json({ erro: 'Email e Senha de App são obrigatórios.' });
  }

  try {
    // Validar credenciais
    const valido = await caldavService.validarCredenciaisCaldav(email_google, senha_app);
    if (!valido) {
      return res.status(400).json({ erro: 'Credenciais inválidas. Verifique email e Senha de App.' });
    }

    const resultado = await caldavService.salvarConfiguracaoCaldav(pool, usuario, email_google, senha_app);
    res.json(resultado);
  } catch (erro) {
    console.error('[Calendarios] Erro ao configurar CalDAV:', erro.message);
    res.status(500).json({ erro: 'Erro ao configurar.' });
  }
});

// POST /api/calendarios/caldav/sincronizar
router.post('/api/calendarios/caldav/sincronizar', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { agenda_ids } = req.body || {};

  try {
    const resultado = await caldavService.sincronizarDoGoogle(usuario, pool, agenda_ids);
    res.json(resultado);
  } catch (erro) {
    console.error('[Calendarios] Erro ao sincronizar:', erro.message);
    res.status(500).json({ erro: 'Erro ao sincronizar.' });
  }
});

// POST /api/calendarios/ical/sincronizar — Sincronizar via URL iCal
router.post('/api/calendarios/ical/sincronizar', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { url, nome, cor } = req.body;

  if (!url) {
    return res.status(400).json({ erro: 'URL iCal é obrigatória.' });
  }

  try {
    const resultado = await caldavService.sincronizarViaIcal(usuario, pool, url, nome, cor);
    res.json(resultado);
  } catch (erro) {
    console.error('[Calendarios] Erro ao sincronizar iCal:', erro.message);
    res.status(500).json({ erro: 'Erro ao sincronizar via iCal.' });
  }
});

// DELETE /api/calendarios/caldav/desconectar
router.delete('/api/calendarios/caldav/desconectar', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;

  try {
    const resultado = await caldavService.desconectarCaldav(pool, usuario);
    res.json(resultado);
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao desconectar.' });
  }
});

module.exports = router;
