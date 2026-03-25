/**
 * ARQUIVO: routes/agenda.js
 * VERSÃO:  1.0.0
 * DATA:    2026-03-03
 * DESCRIÇÃO: Rotas da Agenda de Tarefas
 */

const express        = require('express');
const sql            = require('mssql');
const path           = require('path');
const verificarLogin   = require('../middleware/verificarLogin');
const { registrarLog } = require('../services/logService');
const router           = express.Router();

// ============================================================
// Helper: permissão do usuário na lista
// Retorna: 'dono' | 'edicao' | 'leitura' | null
// ============================================================
async function getPermissao(pool, listaId, usuario) {
  const result = await pool.request()
    .input('lista_id', sql.Int,     listaId)
    .input('usuario',  sql.VarChar, usuario)
    .query(`
      SELECT 'dono' AS permissao
      FROM agenda_listas
      WHERE id = @lista_id AND dono = @usuario
      UNION ALL
      SELECT permissao
      FROM agenda_membros
      WHERE lista_id = @lista_id AND usuario = @usuario
    `);
  return result.recordset[0]?.permissao || null;
}

const NIVEL = { leitura: 1, edicao: 2, dono: 3 };

function temPermissao(perm, nivelMinimo) {
  return !!perm && (NIVEL[perm] || 0) >= (NIVEL[nivelMinimo] || 0);
}

// ============================================================
// GET /agenda — Serve a página HTML
// ============================================================
router.get('/agenda', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agendaTarefas/index.html'));
});

// ============================================================
// GET /api/agenda/listas — Listas do usuário (dono + membro)
// ============================================================
router.get('/api/agenda/listas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;

  try {
    const result = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .query(`
        SELECT l.id, l.nome, l.descricao, l.cor, l.dono, l.criado_em,
               CASE WHEN l.dono = @usuario THEN 'dono' ELSE m.permissao END AS permissao,
               COALESCE(u.nome, ud.nome, l.dono) AS dono_nome
        FROM agenda_listas l
        LEFT JOIN agenda_membros  m  ON m.lista_id = l.id AND m.usuario = @usuario
        LEFT JOIN usuarios        u  ON u.usuario  = l.dono
        LEFT JOIN usuarios_dominio ud ON ud.login  = l.dono AND u.usuario IS NULL
        WHERE l.dono = @usuario OR m.usuario = @usuario
        ORDER BY l.criado_em ASC
      `);
    res.json({ sucesso: true, listas: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar listas: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar listas.' });
  }
});

// ============================================================
// POST /api/agenda/listas — Criar lista
// ============================================================
router.post('/api/agenda/listas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const { nome, descricao, cor } = req.body;

  if (!nome?.trim()) return res.status(400).json({ erro: 'Informe o nome da lista.' });

  try {
    const result = await pool.request()
      .input('nome',      sql.VarChar, nome.trim())
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('cor',       sql.VarChar, cor || '#3b82f6')
      .input('dono',      sql.VarChar, usuario)
      .query(`
        INSERT INTO agenda_listas (nome, descricao, cor, dono)
        OUTPUT INSERTED.id, INSERTED.nome, INSERTED.descricao,
               INSERTED.cor, INSERTED.dono, INSERTED.criado_em
        VALUES (@nome, @descricao, @cor, @dono)
      `);
    const lista = { ...result.recordset[0], permissao: 'dono' };
    registrarLog(pool, { usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'agenda', detalhes: `Lista "${nome.trim()}" criada` });
    res.json({ sucesso: true, mensagem: 'Lista criada.', lista });
  } catch (erro) {
    logErro.error(`Erro ao criar lista: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar lista.' });
  }
});

// ============================================================
// PUT /api/agenda/listas/:id — Editar lista (somente dono)
// ============================================================
router.put('/api/agenda/listas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { nome, descricao, cor } = req.body;

  const perm = await getPermissao(pool, id, usuario);
  if (perm !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode editar a lista.' });
  if (!nome?.trim())   return res.status(400).json({ erro: 'Informe o nome.' });

  try {
    await pool.request()
      .input('id',        sql.Int,     id)
      .input('nome',      sql.VarChar, nome.trim())
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('cor',       sql.VarChar, cor || '#3b82f6')
      .query('UPDATE agenda_listas SET nome=@nome, descricao=@descricao, cor=@cor WHERE id=@id');
    res.json({ sucesso: true, mensagem: 'Lista atualizada.' });
  } catch (erro) {
    logErro.error(`Erro ao editar lista: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao editar lista.' });
  }
});

// ============================================================
// DELETE /api/agenda/listas/:id — Excluir lista (somente dono)
// ============================================================
router.delete('/api/agenda/listas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const perm = await getPermissao(pool, id, usuario);
  if (perm !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode excluir a lista.' });

  try {
    await pool.request().input('id', sql.Int, id).query('DELETE FROM agenda_tarefas    WHERE lista_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM agenda_categorias WHERE lista_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM agenda_membros    WHERE lista_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM agenda_listas     WHERE id=@id');
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EXCLUSAO', sistema: 'agenda', detalhes: `Lista #${id} excluída` });
    res.json({ sucesso: true, mensagem: 'Lista excluída.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir lista: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir lista.' });
  }
});

// ============================================================
// GET /api/agenda/listas/:id/membros
// ============================================================
router.get('/api/agenda/listas/:id/membros', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const perm = await getPermissao(pool, id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso a esta lista.' });

  try {
    const result = await pool.request()
      .input('lista_id', sql.Int, id)
      .query(`SELECT usuario, permissao, adicionado_em FROM agenda_membros
              WHERE lista_id=@lista_id ORDER BY adicionado_em ASC`);
    res.json({ sucesso: true, membros: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar membros: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar membros.' });
  }
});

// ============================================================
// POST /api/agenda/listas/:id/membros — Adicionar/atualizar membro
// ============================================================
router.post('/api/agenda/listas/:id/membros', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { usuario: novo, permissao } = req.body;

  const perm = await getPermissao(pool, id, usuario);
  if (perm !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode adicionar membros.' });
  if (!novo)           return res.status(400).json({ erro: 'Informe o usuário.' });
  if (novo === usuario) return res.status(400).json({ erro: 'Você já é o dono da lista.' });

  try {
    await pool.request()
      .input('lista_id',  sql.Int,     id)
      .input('usuario',   sql.VarChar, novo.trim().toLowerCase())
      .input('permissao', sql.VarChar, permissao || 'leitura')
      .query(`
        IF NOT EXISTS (SELECT 1 FROM agenda_membros WHERE lista_id=@lista_id AND usuario=@usuario)
          INSERT INTO agenda_membros (lista_id, usuario, permissao) VALUES (@lista_id, @usuario, @permissao)
        ELSE
          UPDATE agenda_membros SET permissao=@permissao WHERE lista_id=@lista_id AND usuario=@usuario
      `);

    // ✅ Notificação para o novo membro
    (async () => {
      try {
        const emailService = require('../services/emailService');

        // Buscar nome da lista
        const lR = await pool.request()
          .input('id', sql.Int, id)
          .query('SELECT nome FROM agenda_listas WHERE id=@id');
        const listaNome = lR.recordset[0]?.nome || `Lista #${id}`;

        // Email do membro adicionado
        const mR = await pool.request()
          .input('login', sql.VarChar, novo.trim().toLowerCase())
          .query('SELECT email FROM usuarios_dominio WHERE login=@login');
        const emailMembro = mR.recordset[0]?.email || '';

        if (emailMembro) {
          await emailService.enviarNotificacao(pool, 'agenda.membro_adicionado', {
            lista:         listaNome,
            permissao:     permissao || 'leitura',
            adicionado_por: usuario,
            email_atribuido: emailMembro   // o novo membro é o destinatário natural
          });
        }
      } catch (eEmail) {
        logErro.warn(`Email membro_adicionado não enviado: ${eEmail.message}`);
      }
    })();

    res.json({ sucesso: true, mensagem: 'Membro adicionado.' });
  } catch (erro) {
    logErro.error(`Erro ao adicionar membro: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao adicionar membro.' });
  }
});

// ============================================================
// DELETE /api/agenda/listas/:id/membros/:membro
// ============================================================
router.delete('/api/agenda/listas/:id/membros/:membro', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const membro  = req.params.membro;

  const perm = await getPermissao(pool, id, usuario);
  if (perm !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode remover membros.' });

  try {
    await pool.request()
      .input('lista_id', sql.Int,     id)
      .input('usuario',  sql.VarChar, membro)
      .query('DELETE FROM agenda_membros WHERE lista_id=@lista_id AND usuario=@usuario');
    res.json({ sucesso: true, mensagem: 'Membro removido.' });
  } catch (erro) {
    logErro.error(`Erro ao remover membro: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao remover membro.' });
  }
});

// ============================================================
// GET /api/agenda/listas/:id/tarefas
// ============================================================
router.get('/api/agenda/listas/:id/tarefas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const perm = await getPermissao(pool, id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso a esta lista.' });

  try {
    const result = await pool.request()
      .input('lista_id', sql.Int, id)
      .query(`
        SELECT t.id, t.titulo, t.descricao, t.prazo, t.prioridade, t.status,
               t.categoria_id, c.nome AS categoria_nome, c.cor AS categoria_cor,
               t.criado_por, t.criado_em, t.atualizado_em,
               (SELECT COUNT(*) FROM agenda_passos WHERE tarefa_id = t.id)                      AS passos_total,
               (SELECT COUNT(*) FROM agenda_passos WHERE tarefa_id = t.id AND concluido = 1)    AS passos_concluidos
        FROM agenda_tarefas t
        LEFT JOIN agenda_categorias c ON c.id = t.categoria_id
        WHERE t.lista_id = @lista_id
        ORDER BY
          CASE t.status WHEN 'concluida' THEN 1 ELSE 0 END,
          CASE t.prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
          t.prazo ASC,
          t.criado_em ASC
      `);
    res.json({ sucesso: true, tarefas: result.recordset, permissao: perm });
  } catch (erro) {
    logErro.error(`Erro ao listar tarefas: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar tarefas.' });
  }
});

// ============================================================
// POST /api/agenda/listas/:id/tarefas — Criar tarefa
// ============================================================
router.post('/api/agenda/listas/:id/tarefas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { titulo, descricao, prazo, prioridade, categoria_id } = req.body;

  const perm = await getPermissao(pool, id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão para criar tarefas.' });
  if (!titulo?.trim())               return res.status(400).json({ erro: 'Informe o título.' });

  try {
    const result = await pool.request()
      .input('lista_id',    sql.Int,     id)
      .input('titulo',      sql.VarChar, titulo.trim())
      .input('descricao',   sql.VarChar, (descricao || '').trim())
      .input('prazo',       sql.Date,    prazo || null)
      .input('prioridade',  sql.VarChar, prioridade || 'media')
      .input('categoria_id', sql.Int,    categoria_id || null)
      .input('criado_por',  sql.VarChar, usuario)
      .query(`
        INSERT INTO agenda_tarefas (lista_id, titulo, descricao, prazo, prioridade, categoria_id, criado_por)
        OUTPUT INSERTED.id
        VALUES (@lista_id, @titulo, @descricao, @prazo, @prioridade, @categoria_id, @criado_por)
      `);
    registrarLog(pool, { usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'agenda', detalhes: `Tarefa criada: "${titulo.trim()}"` });
    res.json({ sucesso: true, mensagem: 'Tarefa criada.', id: result.recordset[0].id });
  } catch (erro) {
    logErro.error(`Erro ao criar tarefa: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar tarefa.' });
  }
});

// ============================================================
// PUT /api/agenda/tarefas/:id — Editar tarefa
// ============================================================
router.put('/api/agenda/tarefas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { titulo, descricao, prazo, prioridade, status, categoria_id } = req.body;

  const t = await pool.request().input('id', sql.Int, id)
    .query('SELECT lista_id FROM agenda_tarefas WHERE id=@id');
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa não encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });
  if (!titulo?.trim())               return res.status(400).json({ erro: 'Informe o título.' });

  const statusValido = ['a_fazer', 'em_andamento', 'concluida'].includes(status) ? status : 'a_fazer';

  try {
    await pool.request()
      .input('id',          sql.Int,     id)
      .input('titulo',      sql.VarChar, titulo.trim())
      .input('descricao',   sql.VarChar, (descricao || '').trim())
      .input('prazo',       sql.Date,    prazo || null)
      .input('prioridade',  sql.VarChar, prioridade || 'media')
      .input('status',      sql.VarChar, statusValido)
      .input('categoria_id', sql.Int,    categoria_id || null)
      .query(`UPDATE agenda_tarefas
              SET titulo=@titulo, descricao=@descricao, prazo=@prazo,
                  prioridade=@prioridade, status=@status, categoria_id=@categoria_id,
                  atualizado_em=GETDATE()
              WHERE id=@id`);
    res.json({ sucesso: true, mensagem: 'Tarefa atualizada.' });
  } catch (erro) {
    logErro.error(`Erro ao editar tarefa: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao editar tarefa.' });
  }
});

// ============================================================
// POST /api/agenda/tarefas/:id/notificar
// Dispara notificação consolidada (1 email, todos os passos)
// Query param: tipo = 'nova' | 'editada'
// Chamado pelo frontend DEPOIS de salvar tarefa + todos os passos
// ============================================================
router.post('/api/agenda/tarefas/:id/notificar', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { tipo } = req.query;   // 'nova' ou 'editada'

  const t = await pool.request().input('id', sql.Int, id)
    .query('SELECT lista_id FROM agenda_tarefas WHERE id=@id');
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa não encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso.' });

  const eventoTipo = tipo === 'editada' ? 'agenda.tarefa_editada' : 'agenda.tarefa_criada';

  // ✅ Dispara de forma assíncrona — responde imediatamente ao frontend
  (async () => {
    await _notifTarefa(pool, id, eventoTipo, logErro);
  })();

  res.json({ sucesso: true });
});

// ============================================================
// PATCH /api/agenda/tarefas/:id/status
// ============================================================
router.patch('/api/agenda/tarefas/:id/status', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { status } = req.body;

  if (!['a_fazer','em_andamento','concluida'].includes(status))
    return res.status(400).json({ erro: 'Status inválido.' });

  const t = await pool.request().input('id', sql.Int, id)
    .query('SELECT lista_id FROM agenda_tarefas WHERE id=@id');
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa não encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });

  try {
    await pool.request()
      .input('id',     sql.Int,     id)
      .input('status', sql.VarChar, status)
      .query('UPDATE agenda_tarefas SET status=@status, atualizado_em=GETDATE() WHERE id=@id');
    if (status === 'concluida') {
      const tR = await pool.request()
        .input('id', sql.Int, id)
        .query(`SELECT t.titulo, t.descricao, t.criado_por, t.lista_id, l.nome AS lista_nome
                FROM agenda_tarefas t
                LEFT JOIN agenda_listas l ON l.id = t.lista_id
                WHERE t.id=@id`);
      const tarefa = tR.recordset[0];
      registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'agenda', detalhes: `Tarefa concluída: "${tarefa?.titulo}"` });

      // Buscar passos da tarefa (incluindo atribuído_para para resolver colaboradores)
      const pR = await pool.request()
        .input('tarefa_id', sql.Int, id)
        .query(`SELECT texto AS descricao, concluido, executado_por, executado_em, atribuido_para FROM agenda_passos WHERE tarefa_id=@tarefa_id ORDER BY id ASC`);
      const passos = pR.recordset;

      // Enviar notificação de tarefa concluída
      try {
        const uR = await pool.request()
          .input('usuario', sql.VarChar, tarefa?.criado_por)
          .query('SELECT email FROM usuarios_dominio WHERE login=@usuario');

        // ✅ Coletar todos os colaboradores de todos os passos
        const loginsColabs = new Set();
        for (const passo of passos) {
          if (passo.atribuido_para) {
            try {
              const arr = JSON.parse(passo.atribuido_para);
              if (Array.isArray(arr)) arr.forEach(l => loginsColabs.add(l));
            } catch (_) {}
          }
        }

        // ✅ Buscar emails dos colaboradores em lote
        const emailsColabs = [];
        for (const login of loginsColabs) {
          const eR = await pool.request()
            .input('login', sql.VarChar, login)
            .query('SELECT email FROM usuarios_dominio WHERE login=@login');
          if (eR.recordset[0]?.email) emailsColabs.push(eR.recordset[0].email);
        }

        const emailService = require('../services/emailService');
        await emailService.enviarNotificacao(pool, 'agenda.tarefa_concluida', {
          titulo: tarefa?.titulo || 'Sem título',
          descricao: tarefa?.descricao || '—',
          lista: tarefa?.lista_nome || 'Minhas tarefas',
          passos: passos,
          email_criado_por: uR.recordset[0]?.email,
          email_atribuido: emailsColabs   // ✅ Array com todos os colaboradores
        });
      } catch (eEmail) {
        logErro.warn(`Email de conclusão não enviado: ${eEmail.message}`);
      }
    }
    res.json({ sucesso: true, mensagem: 'Status atualizado.' });
  } catch (erro) {
    logErro.error(`Erro ao atualizar status: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao atualizar status.' });
  }
});

// ============================================================
// DELETE /api/agenda/tarefas/:id
// ============================================================
router.delete('/api/agenda/tarefas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const t = await pool.request().input('id', sql.Int, id)
    .query('SELECT lista_id FROM agenda_tarefas WHERE id=@id');
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa não encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });

  try {
    const tR = await pool.request().input('id', sql.Int, id).query('SELECT titulo FROM agenda_tarefas WHERE id=@id');
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM agenda_passos WHERE tarefa_id=@id');
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM agenda_tarefas WHERE id=@id');
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EXCLUSAO', sistema: 'agenda', detalhes: `Tarefa excluída: "${tR.recordset[0]?.titulo}"` });
    res.json({ sucesso: true, mensagem: 'Tarefa excluída.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir tarefa: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir tarefa.' });
  }
});

// ============================================================
// GET /api/agenda/tarefas/:id/passos
// ============================================================
router.get('/api/agenda/tarefas/:id/passos', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const t = await pool.request().input('id', sql.Int, id)
    .query('SELECT lista_id FROM agenda_tarefas WHERE id=@id');
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa não encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso.' });

  try {
    const result = await pool.request().input('id', sql.Int, id)
      .query('SELECT id, texto, concluido, ordem, atribuido_para FROM agenda_passos WHERE tarefa_id=@id ORDER BY ordem, id');
    res.json({ sucesso: true, passos: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar passos: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao listar passos.' });
  }
});

// ============================================================
// POST /api/agenda/tarefas/:id/passos
// ============================================================
router.post('/api/agenda/tarefas/:id/passos', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { texto, concluido, atribuido_para } = req.body;

  const t = await pool.request().input('id', sql.Int, id)
    .query('SELECT id, titulo, descricao, lista_id, criado_por FROM agenda_tarefas WHERE id=@id');
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa não encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });
  if (!texto?.trim()) return res.status(400).json({ erro: 'Informe o texto do passo.' });

  try {
    const maxOrdem = await pool.request().input('id', sql.Int, id)
      .query('SELECT ISNULL(MAX(ordem), 0) AS max_ordem FROM agenda_passos WHERE tarefa_id=@id');
    const ordem = (maxOrdem.recordset[0].max_ordem || 0) + 1;

    // ✅ FALLBACK: Se não tem colaborador, usa o criador da tarefa
    let colabsFinais = atribuido_para;
    if (!Array.isArray(atribuido_para) || atribuido_para.length === 0) {
      colabsFinais = [t.recordset[0].criado_por];  // fallback para criador
    }

    const atribuidoJson = Array.isArray(colabsFinais) && colabsFinais.length > 0 ? JSON.stringify(colabsFinais) : null;

    const result = await pool.request()
      .input('tarefa_id', sql.Int,     id)
      .input('texto',     sql.VarChar, texto.trim())
      .input('concluido', sql.Bit,     concluido ? 1 : 0)
      .input('ordem',     sql.Int,     ordem)
      .input('atribuido_para', sql.VarChar, atribuidoJson)
      .query('INSERT INTO agenda_passos (tarefa_id, texto, concluido, ordem, atribuido_para) OUTPUT INSERTED.id VALUES (@tarefa_id, @texto, @concluido, @ordem, @atribuido_para)');

    const passoId = result.recordset[0].id;

    // 📧 EMAIL SERÁ DISPARADO PELO ENDPOINT POST /api/agenda/tarefas/:id/notificar
    // Removido daqui para consolidar em 1 email por salvar de tarefa (não 1 por passo)

    res.json({ sucesso: true, id: passoId });
  } catch (erro) {
    logErro.error(`Erro ao criar passo: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar passo.' });
  }
});

// ============================================================
// PATCH /api/agenda/passos/:id — Atualizar passo (texto, colaboradores)
// ============================================================
router.patch('/api/agenda/passos/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { texto, atribuido_para } = req.body;

  const p = await pool.request().input('id', sql.Int, id)
    .query('SELECT ap.tarefa_id, at.lista_id FROM agenda_passos ap JOIN agenda_tarefas at ON at.id=ap.tarefa_id WHERE ap.id=@id');
  if (!p.recordset[0]) return res.status(404).json({ erro: 'Passo não encontrado.' });

  const perm = await getPermissao(pool, p.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });

  try {
    const atribuidoJson = Array.isArray(atribuido_para) && atribuido_para.length > 0 ? JSON.stringify(atribuido_para) : null;

    console.log(`\n[PATCH PASSO] ID: ${id}`);
    console.log(`  Texto recebido: ${texto}`);
    console.log(`  Atribuido_para recebido:`, atribuido_para);
    console.log(`  JSON convertido:`, atribuidoJson);

    const result = await pool.request()
      .input('id',             sql.Int,     id)
      .input('texto',          sql.VarChar, texto?.trim() || null)
      .input('atribuido_para', sql.VarChar, atribuidoJson)
      .query('UPDATE agenda_passos SET texto=ISNULL(@texto, texto), atribuido_para=@atribuido_para WHERE id=@id');

    console.log(`  Linhas afetadas: ${result.rowsAffected[0]}`);

    if (result.rowsAffected[0] === 0) {
      console.warn(`⚠ Nenhuma linha atualizada para ID ${id}`);
      return res.status(404).json({ erro: 'Passo não encontrado.' });
    }

    console.log(`✅ Passo ${id} atualizado com sucesso!`);

    // 📧 EMAIL SERÁ DISPARADO PELO ENDPOINT POST /api/agenda/tarefas/:id/notificar
    // Removido daqui para consolidar em 1 email por salvar de tarefa

    res.json({ sucesso: true, mensagem: 'Passo atualizado.' });
  } catch (erro) {
    logErro.error(`Erro ao atualizar passo: ${erro.message}`);
    console.error(`❌ Erro detalhado:`, erro);
    res.status(500).json({ erro: 'Erro ao atualizar passo.' });
  }
});

// ============================================================
// PATCH /api/agenda/passos/:id/concluido
// ============================================================
router.patch('/api/agenda/passos/:id/concluido', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { concluido } = req.body;

  const p = await pool.request().input('id', sql.Int, id)
    .query('SELECT ap.tarefa_id, at.lista_id FROM agenda_passos ap JOIN agenda_tarefas at ON at.id=ap.tarefa_id WHERE ap.id=@id');
  if (!p.recordset[0]) return res.status(404).json({ erro: 'Passo não encontrado.' });

  const perm = await getPermissao(pool, p.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });

  try {
    if (concluido) {
      // Quando marcar como concluído, registra quem fez e quando
      await pool.request()
        .input('id',            sql.Int,     id)
        .input('concluido',     sql.Bit,     1)
        .input('executado_por', sql.VarChar, usuario)
        .input('executado_em',  sql.DateTime, new Date())
        .query('UPDATE agenda_passos SET concluido=@concluido, executado_por=@executado_por, executado_em=@executado_em WHERE id=@id');
    } else {
      // Quando desmarcar, limpa os dados de execução
      await pool.request()
        .input('id',        sql.Int, id)
        .input('concluido', sql.Bit, 0)
        .query('UPDATE agenda_passos SET concluido=@concluido, executado_por=NULL, executado_em=NULL WHERE id=@id');
    }

    // ✅ Notificação de passo concluído (somente ao marcar, não ao desmarcar)
    if (concluido) {
      (async () => {
        try {
          const emailService = require('../services/emailService');
          const passo = p.recordset[0];

          // Dados da tarefa
          const tR = await pool.request()
            .input('id', sql.Int, passo.tarefa_id)
            .query(`SELECT t.titulo, t.descricao, t.lista_id, l.nome AS lista_nome, t.criado_por
                    FROM agenda_tarefas t
                    LEFT JOIN agenda_listas l ON l.id = t.lista_id
                    WHERE t.id = @id`);
          const tarefa = tR.recordset[0];

          // Texto do passo que foi concluído
          const pR = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT texto, atribuido_para FROM agenda_passos WHERE id=@id');
          const passoData = pR.recordset[0];

          // Email do criador
          let emailCriador = '';
          if (tarefa?.criado_por) {
            const cR = await pool.request()
              .input('login', sql.VarChar, tarefa.criado_por)
              .query('SELECT email FROM usuarios_dominio WHERE login=@login');
            emailCriador = cR.recordset[0]?.email || '';
          }

          // Email do colaborador do passo (fallback para criador)
          const emailsColabs = [];
          if (passoData?.atribuido_para) {
            try {
              const arr = JSON.parse(passoData.atribuido_para);
              for (const login of (Array.isArray(arr) ? arr : [])) {
                const eR = await pool.request()
                  .input('login', sql.VarChar, login)
                  .query('SELECT email FROM usuarios_dominio WHERE login=@login');
                if (eR.recordset[0]?.email) emailsColabs.push(eR.recordset[0].email);
              }
            } catch (_) {}
          }
          if (emailsColabs.length === 0 && emailCriador) emailsColabs.push(emailCriador);

          await emailService.enviarNotificacao(pool, 'agenda.passo_concluido', {
            titulo:           tarefa?.titulo || 'Sem título',
            lista:            tarefa?.lista_nome || 'Minhas tarefas',
            passo:            passoData?.texto || '—',
            executado_por:    usuario,
            email_criado_por: emailCriador,
            email_atribuido:  emailsColabs
          });
        } catch (eEmail) {
          logErro.warn(`Email passo_concluido não enviado: ${eEmail.message}`);
        }
      })();
    }

    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao atualizar passo: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao atualizar passo.' });
  }
});

// ============================================================
// PATCH /api/agenda/passos/:id/atribuir
// ============================================================
router.patch('/api/agenda/passos/:id/atribuir', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { atribuido_para } = req.body;

  const p = await pool.request().input('id', sql.Int, id)
    .query('SELECT ap.tarefa_id, ap.texto, at.lista_id, at.titulo FROM agenda_passos ap JOIN agenda_tarefas at ON at.id=ap.tarefa_id WHERE ap.id=@id');
  if (!p.recordset[0]) return res.status(404).json({ erro: 'Passo não encontrado.' });

  const perm = await getPermissao(pool, p.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });

  try {
    const passo = p.recordset[0];

    // Atualizar atribuição
    await pool.request()
      .input('id', sql.Int, id)
      .input('atribuido_para', sql.VarChar, atribuido_para || null)
      .query('UPDATE agenda_passos SET atribuido_para=@atribuido_para WHERE id=@id');

    // 📧 Email é enviado pelo endpoint PATCH /api/agenda/passos/:id
    // Este endpoint é usado apenas para retrocompatibilidade

    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao atribuir passo: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao atribuir passo.' });
  }
});

// ============================================================
// DELETE /api/agenda/passos/:id
// ============================================================
router.delete('/api/agenda/passos/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const p = await pool.request().input('id', sql.Int, id)
    .query('SELECT ap.tarefa_id, at.lista_id FROM agenda_passos ap JOIN agenda_tarefas at ON at.id=ap.tarefa_id WHERE ap.id=@id');
  if (!p.recordset[0]) return res.status(404).json({ erro: 'Passo não encontrado.' });

  const perm = await getPermissao(pool, p.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });

  try {
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM agenda_passos WHERE id=@id');
    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao excluir passo: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir passo.' });
  }
});

// ============================================================
// GET /api/agenda/listas/:id/categorias
// ============================================================
router.get('/api/agenda/listas/:id/categorias', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const perm = await getPermissao(pool, id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso.' });

  try {
    const result = await pool.request().input('lista_id', sql.Int, id)
      .query('SELECT id, nome, cor FROM agenda_categorias WHERE lista_id=@lista_id ORDER BY nome');
    res.json({ sucesso: true, categorias: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar categorias: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar categorias.' });
  }
});

// ============================================================
// POST /api/agenda/listas/:id/categorias
// ============================================================
router.post('/api/agenda/listas/:id/categorias', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { nome, cor } = req.body;

  const perm = await getPermissao(pool, id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });
  if (!nome?.trim())                 return res.status(400).json({ erro: 'Informe o nome.' });

  try {
    const result = await pool.request()
      .input('lista_id', sql.Int,     id)
      .input('nome',     sql.VarChar, nome.trim())
      .input('cor',      sql.VarChar, cor || '#6b7280')
      .query(`INSERT INTO agenda_categorias (lista_id, nome, cor)
              OUTPUT INSERTED.id, INSERTED.nome, INSERTED.cor
              VALUES (@lista_id, @nome, @cor)`);
    res.json({ sucesso: true, mensagem: 'Categoria criada.', categoria: result.recordset[0] });
  } catch (erro) {
    logErro.error(`Erro ao criar categoria: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar categoria.' });
  }
});

// ============================================================
// DELETE /api/agenda/categorias/:id
// ============================================================
router.delete('/api/agenda/categorias/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const c = await pool.request().input('id', sql.Int, id)
    .query('SELECT lista_id FROM agenda_categorias WHERE id=@id');
  if (!c.recordset[0]) return res.status(404).json({ erro: 'Categoria não encontrada.' });

  const perm = await getPermissao(pool, c.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });

  try {
    await pool.request().input('id', sql.Int, id)
      .query('UPDATE agenda_tarefas SET categoria_id=NULL WHERE categoria_id=@id');
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM agenda_categorias WHERE id=@id');
    res.json({ sucesso: true, mensagem: 'Categoria excluída.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir categoria: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir categoria.' });
  }
});

// ============================================================
// GET /agenda/relatorios — Serve a página de relatórios
// ============================================================
router.get('/agenda/relatorios', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agendaTarefas/relatoriosTarefas.html'));
});

// ============================================================
// GET /api/agenda/relatorios — Dados para relatórios
// ============================================================
router.get('/api/agenda/relatorios', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const { tipo, prazoInicio, prazoFim, lista_id: lId, categoria_id: catId, status, prioridade, page } = req.query;

  const baseFrom = `
    FROM agenda_tarefas t
    JOIN agenda_listas l ON l.id = t.lista_id
    LEFT JOIN agenda_categorias c ON c.id = t.categoria_id
  `;

  function mkReq(extraConds = []) {
    const r = pool.request().input('usuario', sql.VarChar, usuario);
    const conds = ['(l.dono=@usuario OR EXISTS (SELECT 1 FROM agenda_membros m WHERE m.lista_id=l.id AND m.usuario=@usuario))'];
    if (lId)                           { r.input('lista_id',    sql.Int,     parseInt(lId));  conds.push('t.lista_id=@lista_id'); }
    if (prazoInicio)                   { r.input('prazoInicio', sql.Date,    prazoInicio);    conds.push('t.prazo>=@prazoInicio'); }
    if (prazoFim)                      { r.input('prazoFim',    sql.Date,    prazoFim);       conds.push('t.prazo<=@prazoFim'); }
    if (catId)                         { r.input('categoria_id',sql.Int,     parseInt(catId));conds.push('t.categoria_id=@categoria_id'); }
    if (status && status !== 'todos')  { r.input('status',      sql.VarChar, status);         conds.push('t.status=@status'); }
    if (prioridade && prioridade !== 'todas') { r.input('prioridade', sql.VarChar, prioridade); conds.push('t.prioridade=@prioridade'); }
    return { r, where: 'WHERE ' + [...conds, ...extraConds].join(' AND ') };
  }

  try {
    if (tipo === 'detalhado') {
      const pg  = Math.max(1, parseInt(page) || 1);
      const off = (pg - 1) * 50;

      const { r: rCount, where } = mkReq();
      const countR = await rCount.query(`SELECT COUNT(*) AS total ${baseFrom} ${where}`);
      const total  = countR.recordset[0].total;

      const { r: rData, where: w2 } = mkReq();
      rData.input('off', sql.Int, off).input('lim', sql.Int, 50);
      const dataR = await rData.query(`
        SELECT t.id, l.nome AS lista_nome, l.cor AS lista_cor,
               t.titulo, t.prazo, t.prioridade, t.status,
               ISNULL(c.nome, 'Sem categoria') AS categoria_nome,
               c.cor AS categoria_cor,
               t.criado_por, t.criado_em, t.atualizado_em
        ${baseFrom} ${w2}
        ORDER BY
          CASE t.status WHEN 'a_fazer' THEN 1 WHEN 'em_andamento' THEN 2 ELSE 3 END,
          CASE t.prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
          t.prazo ASC
        OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY
      `);
      return res.json({ total, pagina: pg, por_pagina: 50, tarefas: dataR.recordset });
    }

    // Resumido — totais
    const { r: rRes, where } = mkReq();
    const resumoR = await rRes.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN t.status='a_fazer'      THEN 1 ELSE 0 END) AS a_fazer,
        SUM(CASE WHEN t.status='em_andamento' THEN 1 ELSE 0 END) AS em_andamento,
        SUM(CASE WHEN t.status='concluida'    THEN 1 ELSE 0 END) AS concluida,
        SUM(CASE WHEN t.status <> 'concluida' AND t.prazo IS NOT NULL
                      AND t.prazo < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS vencidas,
        SUM(CASE WHEN t.prioridade='alta' AND t.status <> 'concluida' THEN 1 ELSE 0 END) AS alta_pendente
      ${baseFrom} ${where}
    `);

    // Por categoria
    const { r: rCat, where: wCat } = mkReq();
    const catR = await rCat.query(`
      SELECT ISNULL(c.nome, 'Sem categoria') AS categoria, c.cor,
             COUNT(*) AS total,
             SUM(CASE WHEN t.status='concluida' THEN 1 ELSE 0 END) AS concluidas
      ${baseFrom} ${wCat}
      GROUP BY c.nome, c.cor
      ORDER BY COUNT(*) DESC
    `);

    // Por prioridade
    const { r: rPri, where: wPri } = mkReq();
    const priR = await rPri.query(`
      SELECT t.prioridade, COUNT(*) AS total,
             SUM(CASE WHEN t.status='concluida' THEN 1 ELSE 0 END) AS concluidas
      ${baseFrom} ${wPri}
      GROUP BY t.prioridade
      ORDER BY CASE t.prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END
    `);

    // Por lista (só se não filtrou uma lista específica)
    let porLista = [];
    if (!lId) {
      const { r: rLst, where: wLst } = mkReq();
      const lstR = await rLst.query(`
        SELECT l.nome AS lista, l.cor, COUNT(*) AS total,
               SUM(CASE WHEN t.status='concluida' THEN 1 ELSE 0 END) AS concluidas
        ${baseFrom} ${wLst}
        GROUP BY l.nome, l.cor
        ORDER BY COUNT(*) DESC
      `);
      porLista = lstR.recordset;
    }

    return res.json({
      resumo:       resumoR.recordset[0],
      por_categoria: catR.recordset,
      por_prioridade: priR.recordset,
      por_lista:    porLista
    });
  } catch (erro) {
    logErro.error(`Erro ao gerar relatorio de tarefas: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao gerar relatorio.' });
  }
});

// ============================================================
// GET /api/agenda/usuarios — Todos os usuários para seletor de membros
// ============================================================
router.get('/api/agenda/usuarios', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;

  try {
    const result = await pool.request().query(`
      SELECT usuario AS login, nome FROM usuarios        WHERE ativo = 1
      UNION ALL
      SELECT login,             nome FROM usuarios_dominio WHERE ativo = 1
      ORDER BY nome
    `);
    res.json({ sucesso: true, usuarios: result.recordset.filter(u => u.login !== usuario) });
  } catch (erro) {
    logErro.error(`Erro ao listar usuários: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar usuários.' });
  }
});

// ============================================================
// GET /api/agenda/usuarios — Lista usuários para atribuição
// ============================================================
router.get('/api/agenda/usuarios', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;

  try {
    // Buscar usuários locais
    const locaisR = await pool.request()
      .query('SELECT usuario AS login, nome FROM usuarios WHERE ativo=1 ORDER BY nome ASC');

    // Buscar usuários do domínio
    const dominioR = await pool.request()
      .query('SELECT login, nome FROM usuarios_dominio WHERE ativo=1 ORDER BY nome ASC');

    // Combinar e remover duplicatas
    const todos = [...locaisR.recordset, ...dominioR.recordset];
    const unicos = [];
    const vistos = new Set();
    for (const u of todos) {
      if (!vistos.has(u.login)) {
        vistos.add(u.login);
        unicos.push(u);
      }
    }

    res.json({ sucesso: true, usuarios: unicos });
  } catch (erro) {
    logErro.error(`Erro ao listar usuários: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar usuários.' });
  }
});

// ============================================================
// HELPER INTERNO — Consolida e envia notificação de tarefa
// Tipo: 'agenda.tarefa_criada' | 'agenda.tarefa_editada'
// ============================================================
async function _notifTarefa(pool, tarefaId, tipo, logErro) {
  try {
    logErro.info(`[_notifTarefa] INICIANDO CADEIA para tarefa=${tarefaId}, tipo=${tipo}`);
    const emailService = require('../services/emailService');

    // 1. Buscar tarefa + lista
    const tR = await pool.request()
      .input('id', sql.Int, tarefaId)
      .query(`SELECT t.titulo, t.descricao, t.prazo, t.criado_por, l.nome AS lista_nome
              FROM agenda_tarefas t
              LEFT JOIN agenda_listas l ON l.id = t.lista_id
              WHERE t.id = @id`);
    const tarefa = tR.recordset[0];
    if (!tarefa) {
      logErro.warn(`[_notifTarefa] Tarefa ${tarefaId} NÃO ENCONTRADA`);
      return;
    }
    logErro.info(`[_notifTarefa] Tarefa: ${tarefa.titulo}, criado_por=${tarefa.criado_por}`);

    // 2. Buscar todos os passos
    const pasR = await pool.request()
      .input('tarefa_id', sql.Int, tarefaId)
      .query(`SELECT texto AS descricao, concluido, atribuido_para FROM agenda_passos
              WHERE tarefa_id = @tarefa_id ORDER BY ordem, id`);
    const passos = pasR.recordset;
    logErro.info(`[_notifTarefa] ${passos.length} passos encontrados`);

    // 3. Email do criador
    let emailCriador = '';
    if (tarefa.criado_por) {
      const cR = await pool.request()
        .input('login', sql.VarChar, tarefa.criado_por)
        .query('SELECT email FROM usuarios_dominio WHERE login=@login');
      emailCriador = cR.recordset[0]?.email || '';
    }

    // 4. Coletar logins de TODOS os colaboradores (sem fallback aqui)
    const loginsSet = new Set();
    let temColab = false;      // há ao menos 1 passo com colaborador?
    for (const p of passos) {
      if (p.atribuido_para) {
        try {
          const arr = JSON.parse(p.atribuido_para);
          if (Array.isArray(arr) && arr.length > 0) {
            arr.forEach(l => loginsSet.add(l));
            temColab = true;
          }
        } catch (_) {
          logErro.warn(`[_notifTarefa] Erro ao parsear atribuido_para: ${p.atribuido_para}`);
        }
      }
    }

    // 5. Buscar emails dos colaboradores
    const emailsColabs = [];
    for (const login of loginsSet) {
      const eR = await pool.request()
        .input('login', sql.VarChar, login)
        .query('SELECT email FROM usuarios_dominio WHERE login=@login');
      if (eR.recordset[0]?.email) emailsColabs.push(eR.recordset[0].email);
    }

    const prazoFormatado = tarefa.prazo
      ? new Date(tarefa.prazo).toLocaleDateString('pt-BR')
      : 'Sem prazo';

    // ─────────────────────────────────────────────────────────────────────────
    // CADEIA DE EVENTOS: Cada evento é verificado independentemente
    // Se o evento está desabilitado na config, o emailService pula silenciosamente
    // ─────────────────────────────────────────────────────────────────────────

    const dadosComuns = {
      titulo:           tarefa.titulo,
      lista:            tarefa.lista_nome || 'Minhas tarefas',
      prazo:            prazoFormatado,
      criado_por:       tarefa.criado_por,
      email_criado_por: emailCriador,
      email_atribuido:  emailsColabs,
      passos:           passos
    };

    logErro.info(`[_notifTarefa] Disparando evento: ${tipo}`);
    await emailService.enviarNotificacao(pool, tipo, dadosComuns);

    // Se há colaboradores nos passos E é criação nova → também dispara passo_atribuido
    if (tipo === 'agenda.tarefa_criada' && temColab && emailsColabs.length > 0) {
      logErro.info(`[_notifTarefa] Disparando evento ADICIONAL: agenda.passo_atribuido`);
      await emailService.enviarNotificacao(pool, 'agenda.passo_atribuido', dadosComuns);
    }

    logErro.info(`[_notifTarefa] ✅ CADEIA COMPLETA para tarefa ${tarefaId}`);
  } catch (err) {
    logErro?.error(`[_notifTarefa] ❌ ERRO na cadeia: ${err.message}`);
  }
}

module.exports = router;
