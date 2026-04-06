/**
 * ARQUIVO: routes/agendaProjetos.js
 * VERSÃO:  1.0.0
 * DATA:    2026-03-31
 * DESCRIÇÃO: Rotas do módulo Agenda Projetos
 *
 * HISTÓRICO:
 * 1.0.0 - 2026-03-31 - Versão inicial (Fase 1: projetos, subprojetos, membros, tarefas)
 * 1.1.0 - 2026-03-31 - Logs com req.ip, endpoint de usuários, endpoint de logs do projeto
 */

const express        = require('express');
const router         = express.Router();
const verificarLogin = require('../middleware/verificarLogin');
const { registrarLog } = require('../services/logService');
const sql            = require('mssql');
const path           = require('path');

// ============================================================
// HELPERS DE PERMISSÃO
// ============================================================

async function getPermissao(pool, projetoId, usuario) {
  const r = await pool.request()
    .input('id',      sql.Int,     projetoId)
    .input('usuario', sql.VarChar, usuario)
    .query(`
      SELECT 'dono' AS perm FROM proj_projetos WHERE id = @id AND dono = @usuario
      UNION ALL
      SELECT permissao FROM proj_membros WHERE projeto_id = @id AND usuario = @usuario
    `);
  return r.recordset[0]?.perm || null;
}

const NIVEL = { leitura: 1, edicao: 2, dono: 3 };
function temPermissao(perm, minimo) {
  return !!perm && (NIVEL[perm] || 0) >= (NIVEL[minimo] || 0);
}

// ============================================================
// PÁGINAS HTML
// ============================================================

router.get('/agendaProjetos', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agendaProjetos/index.html'));
});

router.get('/agendaProjetos/projeto', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agendaProjetos/projeto.html'));
});

// ============================================================
// API — PROJETOS
// ============================================================

// Listar projetos acessíveis
router.get('/api/projetos/lista', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  try {
    let query;
    if (isAdmin) {
      query = `
        SELECT p.*,
          a.status AS aprovacao_status,
          (SELECT COUNT(*) FROM agenda_tarefas t WHERE t.projeto_id = p.id AND t.status != 'concluida') AS tarefas_abertas,
          (SELECT COUNT(*) FROM agenda_tarefas t WHERE t.projeto_id = p.id) AS tarefas_total,
          (SELECT COUNT(*) FROM agenda_tarefas t WHERE t.projeto_id = p.id AND t.status = 'concluida') AS tarefas_concluidas,
          (SELECT COUNT(*) FROM agenda_passos ap JOIN agenda_tarefas at2 ON at2.id = ap.tarefa_id WHERE at2.projeto_id = p.id) AS passos_total,
          (SELECT COUNT(*) FROM agenda_passos ap JOIN agenda_tarefas at2 ON at2.id = ap.tarefa_id WHERE at2.projeto_id = p.id AND ap.concluido = 1) AS passos_concluidos,
          (SELECT COUNT(*) FROM proj_subprojetos s WHERE s.projeto_id = p.id) AS subprojetos_total,
          (SELECT COUNT(*) FROM proj_membros m WHERE m.projeto_id = p.id) AS membros_total
        FROM proj_projetos p
        LEFT JOIN aprovacoes a ON a.id = p.aprovacao_id
        WHERE p.ativo = 1
        ORDER BY p.criado_em DESC
      `;
    } else {
      query = `
        SELECT p.*,
          a.status AS aprovacao_status,
          (SELECT COUNT(*) FROM agenda_tarefas t WHERE t.projeto_id = p.id AND t.status != 'concluida') AS tarefas_abertas,
          (SELECT COUNT(*) FROM agenda_tarefas t WHERE t.projeto_id = p.id) AS tarefas_total,
          (SELECT COUNT(*) FROM agenda_tarefas t WHERE t.projeto_id = p.id AND t.status = 'concluida') AS tarefas_concluidas,
          (SELECT COUNT(*) FROM agenda_passos ap JOIN agenda_tarefas at2 ON at2.id = ap.tarefa_id WHERE at2.projeto_id = p.id) AS passos_total,
          (SELECT COUNT(*) FROM agenda_passos ap JOIN agenda_tarefas at2 ON at2.id = ap.tarefa_id WHERE at2.projeto_id = p.id AND ap.concluido = 1) AS passos_concluidos,
          (SELECT COUNT(*) FROM proj_subprojetos s WHERE s.projeto_id = p.id) AS subprojetos_total,
          (SELECT COUNT(*) FROM proj_membros m WHERE m.projeto_id = p.id) AS membros_total
        FROM proj_projetos p
        LEFT JOIN aprovacoes a ON a.id = p.aprovacao_id
        WHERE p.ativo = 1
          AND (p.dono = @usuario OR EXISTS (
            SELECT 1 FROM proj_membros m WHERE m.projeto_id = p.id AND m.usuario = @usuario
          ))
        ORDER BY p.criado_em DESC
      `;
    }
    const r = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .query(query);
    res.json(r.recordset);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar projetos.' });
  }
});

// Detalhe de um projeto
router.get('/api/projetos/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !perm) return res.status(403).json({ erro: 'Sem acesso.' });

    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT p.*,
          (SELECT COUNT(*) FROM agenda_tarefas t WHERE t.projeto_id = p.id) AS tarefas_total,
          (SELECT COUNT(*) FROM agenda_tarefas t WHERE t.projeto_id = p.id AND t.status = 'concluida') AS tarefas_concluidas,
          (SELECT COUNT(*) FROM proj_subprojetos s WHERE s.projeto_id = p.id) AS subprojetos_total,
          (SELECT COUNT(*) FROM proj_membros m WHERE m.projeto_id = p.id) AS membros_total
        FROM proj_projetos p
        WHERE p.id = @id AND p.ativo = 1
      `);
    if (!r.recordset[0]) return res.status(404).json({ erro: 'Projeto não encontrado.' });
    res.json({ projeto: r.recordset[0], permissao: isAdmin ? 'dono' : perm });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar projeto.' });
  }
});

// Criar projeto
router.post('/api/projetos', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { nome, descricao, data_inicio, data_fim, cor, status } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome obrigatório.' });
  const statusValido = ['planejado','em_andamento','concluido','pausado'].includes(status) ? status : 'planejado';
  try {
    const r = await pool.request()
      .input('nome',        sql.NVarChar, nome)
      .input('descricao',   sql.NVarChar, descricao || null)
      .input('data_inicio', sql.Date,     data_inicio || null)
      .input('data_fim',    sql.Date,     data_fim    || null)
      .input('cor',         sql.NVarChar, cor || '#3b82f6')
      .input('status',      sql.NVarChar, statusValido)
      .input('dono',        sql.NVarChar, usuario)
      .input('criado_por',  sql.NVarChar, usuario)
      .query(`
        INSERT INTO proj_projetos (nome, descricao, data_inicio, data_fim, cor, status, dono, criado_por, criado_em, atualizado_em)
        OUTPUT INSERTED.*
        VALUES (@nome, @descricao, @data_inicio, @data_fim, @cor, @status, @dono, @criado_por, GETDATE(), GETDATE())
      `);
    await registrarLog(pool, { usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'projetos', detalhes: nome });
    res.json({ sucesso: true, projeto: r.recordset[0] });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao criar projeto.' });
  }
});

// Atualizar projeto
router.put('/api/projetos/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  const { nome, descricao, data_inicio, data_fim, status, cor } = req.body;
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });
    await pool.request()
      .input('id',          sql.Int,      id)
      .input('nome',        sql.NVarChar, nome)
      .input('descricao',   sql.NVarChar, descricao   || null)
      .input('data_inicio', sql.Date,     data_inicio || null)
      .input('data_fim',    sql.Date,     data_fim    || null)
      .input('status',      sql.NVarChar, status      || 'planejado')
      .input('cor',         sql.NVarChar, cor         || '#3b82f6')
      .query(`
        UPDATE proj_projetos
        SET nome=@nome, descricao=@descricao, data_inicio=@data_inicio, data_fim=@data_fim,
            status=@status, cor=@cor, atualizado_em=GETDATE()
        WHERE id=@id
      `);
    await registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'projetos', detalhes: `Projeto '${nome}' editado` });
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao atualizar projeto.' });
  }
});

// Mover projeto (drag & drop kanban) — log com status anterior e novo
router.patch('/api/projetos/:id/status', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  const { status } = req.body;
  if (!status) return res.status(400).json({ erro: 'Status obrigatório.' });
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });
    const proj = await pool.request().input('id', sql.Int, id)
      .query('SELECT nome, status FROM proj_projetos WHERE id=@id AND ativo=1');
    if (!proj.recordset[0]) return res.status(404).json({ erro: 'Projeto não encontrado.' });
    const { nome: nomeProjeto, status: statusAnterior } = proj.recordset[0];
    await pool.request()
      .input('id',     sql.Int,      id)
      .input('status', sql.NVarChar, status)
      .query(`UPDATE proj_projetos SET status=@status, atualizado_em=GETDATE() WHERE id=@id`);
    await registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'projetos',
      detalhes: `Projeto '${nomeProjeto}' movido de '${statusAnterior}' para '${status}'` });
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao mover projeto.' });
  }
});

// Arquivar projeto (soft delete via ativo=0)
router.patch('/api/projetos/:id/arquivar', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !temPermissao(perm, 'dono')) return res.status(403).json({ erro: 'Apenas o dono pode arquivar.' });
    const proj = await pool.request().input('id', sql.Int, id).query('SELECT nome FROM proj_projetos WHERE id=@id');
    const nomeProjeto = proj.recordset[0]?.nome || `#${id}`;
    await pool.request()
      .input('id',     sql.Int,      id)
      .input('status', sql.NVarChar, 'arquivado')
      .query(`UPDATE proj_projetos SET ativo=0, status=@status, atualizado_em=GETDATE() WHERE id=@id`);
    await registrarLog(pool, { usuario, ip: req.ip, acao: 'ARQUIVAMENTO', sistema: 'projetos', detalhes: `Projeto '${nomeProjeto}' arquivado` });
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao arquivar projeto.' });
  }
});

// Excluir projeto
router.delete('/api/projetos/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !temPermissao(perm, 'dono')) return res.status(403).json({ erro: 'Apenas o dono pode excluir.' });
    const projInfo = await pool.request().input('id', sql.Int, id).query('SELECT nome FROM proj_projetos WHERE id=@id');
    const nomeProjeto = projInfo.recordset[0]?.nome || `#${id}`;
    // Desvincula tarefas antes de excluir
    await pool.request().input('id', sql.Int, id)
      .query(`UPDATE agenda_tarefas SET projeto_id=NULL, subprojeto_id=NULL WHERE projeto_id=@id`);
    await pool.request().input('id', sql.Int, id)
      .query(`DELETE FROM proj_subprojetos WHERE projeto_id=@id`);
    await pool.request().input('id', sql.Int, id)
      .query(`DELETE FROM proj_membros WHERE projeto_id=@id`);
    await pool.request().input('id', sql.Int, id)
      .query(`DELETE FROM proj_projetos WHERE id=@id`);
    await registrarLog(pool, { usuario, ip: req.ip, acao: 'EXCLUSAO', sistema: 'projetos', detalhes: `Projeto '${nomeProjeto}' excluído` });
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao excluir projeto.' });
  }
});

// ============================================================
// API — MEMBROS
// ============================================================

router.get('/api/projetos/:id/membros', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !perm) return res.status(403).json({ erro: 'Sem acesso.' });
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM proj_membros WHERE projeto_id=@id ORDER BY adicionado_em`);
    res.json(r.recordset);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar membros.' });
  }
});

router.post('/api/projetos/:id/membros', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  const { membro, permissao } = req.body;
  if (!membro) return res.status(400).json({ erro: 'Usuário obrigatório.' });
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !temPermissao(perm, 'dono')) return res.status(403).json({ erro: 'Apenas o dono pode adicionar membros.' });
    // Verificar se já é dono
    const proj = await pool.request().input('id', sql.Int, id).query('SELECT dono FROM proj_projetos WHERE id=@id');
    if (proj.recordset[0]?.dono === membro) return res.status(400).json({ erro: 'Usuário já é dono do projeto.' });
    const r = await pool.request()
      .input('projeto_id', sql.Int,      id)
      .input('usuario',    sql.NVarChar, membro)
      .input('permissao',  sql.NVarChar, permissao || 'leitura')
      .query(`
        IF NOT EXISTS (SELECT 1 FROM proj_membros WHERE projeto_id=@projeto_id AND usuario=@usuario)
          INSERT INTO proj_membros (projeto_id, usuario, permissao) OUTPUT INSERTED.*
          VALUES (@projeto_id, @usuario, @permissao)
        ELSE
          UPDATE proj_membros SET permissao=@permissao OUTPUT INSERTED.*
          WHERE projeto_id=@projeto_id AND usuario=@usuario
      `);
    const projNome = proj.recordset[0]?.dono ? (await pool.request().input('id', sql.Int, id).query('SELECT nome FROM proj_projetos WHERE id=@id')).recordset[0]?.nome || `#${id}` : `#${id}`;
    await registrarLog(pool, { usuario, ip: req.ip, acao: 'COMPARTILHAMENTO', sistema: 'projetos', detalhes: `Membro '${membro}' adicionado/atualizado no projeto '${projNome}' com permissão '${permissao||'leitura'}'` });
    res.json({ sucesso: true, membro: r.recordset[0] });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao adicionar membro.' });
  }
});

router.delete('/api/projetos/:id/membros/:uid', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id, uid } = req.params;
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !temPermissao(perm, 'dono')) return res.status(403).json({ erro: 'Sem permissão.' });
    await pool.request()
      .input('projeto_id', sql.Int,      id)
      .input('usuario',    sql.NVarChar, uid)
      .query(`DELETE FROM proj_membros WHERE projeto_id=@projeto_id AND usuario=@usuario`);
    const projMR = await pool.request().input('id', sql.Int, id).query('SELECT nome FROM proj_projetos WHERE id=@id');
    await registrarLog(pool, { usuario, ip: req.ip, acao: 'COMPARTILHAMENTO', sistema: 'projetos', detalhes: `Membro '${uid}' removido do projeto '${projMR.recordset[0]?.nome || '#'+id}'` });
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao remover membro.' });
  }
});

// ============================================================
// API — SUBPROJETOS
// ============================================================

router.get('/api/projetos/:id/subprojetos', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !perm) return res.status(403).json({ erro: 'Sem acesso.' });
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT s.*,
          (SELECT COUNT(*) FROM agenda_tarefas t WHERE t.subprojeto_id = s.id) AS tarefas_total,
          (SELECT COUNT(*) FROM agenda_tarefas t WHERE t.subprojeto_id = s.id AND t.status = 'concluida') AS tarefas_concluidas
        FROM proj_subprojetos s
        WHERE s.projeto_id=@id
        ORDER BY s.criado_em
      `);
    res.json(r.recordset);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar subprojetos.' });
  }
});

router.post('/api/projetos/:id/subprojetos', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  const { nome, descricao, data_inicio, data_fim } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome obrigatório.' });
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });
    const r = await pool.request()
      .input('projeto_id',  sql.Int,      id)
      .input('nome',        sql.NVarChar, nome)
      .input('descricao',   sql.NVarChar, descricao   || null)
      .input('data_inicio', sql.Date,     data_inicio || null)
      .input('data_fim',    sql.Date,     data_fim    || null)
      .input('criado_por',  sql.NVarChar, usuario)
      .query(`
        INSERT INTO proj_subprojetos (projeto_id, nome, descricao, data_inicio, data_fim, status, criado_por, criado_em, atualizado_em)
        OUTPUT INSERTED.*
        VALUES (@projeto_id, @nome, @descricao, @data_inicio, @data_fim, 'planejado', @criado_por, GETDATE(), GETDATE())
      `);
    const projSP = await pool.request().input('id', sql.Int, id).query('SELECT nome FROM proj_projetos WHERE id=@id');
    await registrarLog(pool, { usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'projetos', detalhes: `Subprojeto '${nome}' criado no projeto '${projSP.recordset[0]?.nome || '#'+id}'` });
    res.json({ sucesso: true, subprojeto: r.recordset[0] });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao criar subprojeto.' });
  }
});

router.put('/api/projetos/subprojetos/:sid', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { sid } = req.params;
  const { nome, descricao, data_inicio, data_fim, status } = req.body;
  try {
    // Busca projeto_id para verificar permissão
    const sp = await pool.request().input('id', sql.Int, sid)
      .query('SELECT projeto_id FROM proj_subprojetos WHERE id=@id');
    if (!sp.recordset[0]) return res.status(404).json({ erro: 'Subprojeto não encontrado.' });
    const projetoId = sp.recordset[0].projeto_id;
    const perm = await getPermissao(pool, projetoId, usuario);
    if (!isAdmin && !temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });
    await pool.request()
      .input('id',          sql.Int,      sid)
      .input('nome',        sql.NVarChar, nome)
      .input('descricao',   sql.NVarChar, descricao   || null)
      .input('data_inicio', sql.Date,     data_inicio || null)
      .input('data_fim',    sql.Date,     data_fim    || null)
      .input('status',      sql.NVarChar, status      || 'planejado')
      .query(`
        UPDATE proj_subprojetos
        SET nome=@nome, descricao=@descricao, data_inicio=@data_inicio,
            data_fim=@data_fim, status=@status, atualizado_em=GETDATE()
        WHERE id=@id
      `);
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao atualizar subprojeto.' });
  }
});

router.delete('/api/projetos/subprojetos/:sid', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { sid } = req.params;
  try {
    const sp = await pool.request().input('id', sql.Int, sid)
      .query('SELECT projeto_id FROM proj_subprojetos WHERE id=@id');
    if (!sp.recordset[0]) return res.status(404).json({ erro: 'Subprojeto não encontrado.' });
    const perm = await getPermissao(pool, sp.recordset[0].projeto_id, usuario);
    if (!isAdmin && !temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });
    // Desvincula tarefas
    await pool.request().input('id', sql.Int, sid)
      .query(`UPDATE agenda_tarefas SET subprojeto_id=NULL WHERE subprojeto_id=@id`);
    await pool.request().input('id', sql.Int, sid)
      .query(`DELETE FROM proj_subprojetos WHERE id=@id`);
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao excluir subprojeto.' });
  }
});

// ============================================================
// API — TAREFAS DO PROJETO (integradas com agenda_tarefas)
// ============================================================

// Listar tarefas do projeto
router.get('/api/projetos/:id/tarefas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  const { subprojeto_id } = req.query;
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !perm) return res.status(403).json({ erro: 'Sem acesso.' });
    let cond = 'WHERE t.projeto_id = @id';
    if (subprojeto_id) cond += ' AND t.subprojeto_id = @spid';
    const req2 = pool.request()
      .input('id', sql.Int, id);
    if (subprojeto_id) req2.input('spid', sql.Int, subprojeto_id);
    const r = await req2.query(`
      SELECT t.id, t.titulo, t.descricao, t.prazo, t.prioridade, t.status,
             t.responsavel, t.subprojeto_id, t.lista_id, t.criado_por, t.criado_em,
             c.nome AS categoria_nome,
             s.nome AS subprojeto_nome,
             l.nome AS lista_nome,
             (SELECT COUNT(*) FROM agenda_passos p WHERE p.tarefa_id = t.id) AS passos_total,
             (SELECT COUNT(*) FROM agenda_passos p WHERE p.tarefa_id = t.id AND p.concluido=1) AS passos_concluidos
      FROM agenda_tarefas t
      LEFT JOIN agenda_categorias c ON c.id = t.categoria_id
      LEFT JOIN proj_subprojetos s ON s.id = t.subprojeto_id
      LEFT JOIN agenda_listas l ON l.id = t.lista_id
      ${cond}
      ORDER BY
        CASE t.status WHEN 'a_fazer' THEN 1 WHEN 'em_andamento' THEN 2 WHEN 'concluida' THEN 3 ELSE 4 END,
        CASE t.prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 WHEN 'baixa' THEN 3 ELSE 4 END,
        t.prazo
    `);
    res.json(r.recordset);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar tarefas.' });
  }
});

// Criar tarefa no projeto (insere em agenda_tarefas com projeto_id)
router.post('/api/projetos/:id/tarefas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  const { titulo, descricao, lista_id, subprojeto_id, responsavel, prazo, prioridade, status } = req.body;
  if (!titulo) return res.status(400).json({ erro: 'Título obrigatório.' });
  if (!lista_id) return res.status(400).json({ erro: 'Lista obrigatória.' });
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão para criar tarefas.' });
    const r = await pool.request()
      .input('lista_id',      sql.Int,      lista_id)
      .input('projeto_id',    sql.Int,      id)
      .input('subprojeto_id', sql.Int,      subprojeto_id || null)
      .input('titulo',        sql.NVarChar, titulo)
      .input('descricao',     sql.NVarChar, descricao   || null)
      .input('responsavel',   sql.NVarChar, responsavel || null)
      .input('prazo',         sql.Date,     prazo       || null)
      .input('prioridade',    sql.NVarChar, prioridade  || 'media')
      .input('status',        sql.NVarChar, status      || 'a_fazer')
      .input('criado_por',    sql.NVarChar, usuario)
      .query(`
        INSERT INTO agenda_tarefas
          (lista_id, projeto_id, subprojeto_id, titulo, descricao, responsavel, prazo, prioridade, status, criado_por, criado_em, atualizado_em)
        OUTPUT INSERTED.*
        VALUES
          (@lista_id, @projeto_id, @subprojeto_id, @titulo, @descricao, @responsavel, @prazo, @prioridade, @status, @criado_por, GETDATE(), GETDATE())
      `);
    const projTar = await pool.request().input('id', sql.Int, id).query('SELECT nome FROM proj_projetos WHERE id=@id');
    await registrarLog(pool, { usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'projetos', detalhes: `Tarefa '${titulo}' criada no projeto '${projTar.recordset[0]?.nome || '#'+id}'` });
    res.json({ sucesso: true, tarefa: r.recordset[0] });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao criar tarefa.' });
  }
});

// Atualizar status de tarefa
router.patch('/api/projetos/tarefas/:tid/status', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { tid } = req.params;
  const { status } = req.body;
  if (!status) return res.status(400).json({ erro: 'Status obrigatório.' });
  try {
    const t = await pool.request().input('id', sql.Int, tid)
      .query('SELECT projeto_id, lista_id, titulo, status AS status_atual FROM agenda_tarefas WHERE id=@id');
    if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa não encontrada.' });
    const { projeto_id: projetoId, titulo: tituloTarefa, status_atual: statusAnterior } = t.recordset[0];
    if (projetoId) {
      const perm = await getPermissao(pool, projetoId, usuario);
      if (!isAdmin && !temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });
    }
    await pool.request()
      .input('id',     sql.Int,      tid)
      .input('status', sql.NVarChar, status)
      .query(`UPDATE agenda_tarefas SET status=@status, atualizado_em=GETDATE() WHERE id=@id`);
    if (projetoId) {
      const projTar2 = await pool.request().input('id', sql.Int, projetoId).query('SELECT nome FROM proj_projetos WHERE id=@id');
      const nomeProjeto = projTar2.recordset[0]?.nome || `#${projetoId}`;
      await registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'projetos',
        detalhes: `Tarefa '${tituloTarefa}' do projeto '${nomeProjeto}': status '${statusAnterior}' → '${status}'` });
    }
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao atualizar status.' });
  }
});

// Listar todos os usuários (local + AD + contatos + whatsapp) para seletor de membros
router.get('/api/projetos/auxiliar/usuarios', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const r = await pool.request().query(`
      -- Usuários locais do Portal
      SELECT usuario AS login, nome, 'local' AS origem
      FROM usuarios WHERE ativo = 1

      UNION

      -- Usuários do Active Directory
      SELECT login, ISNULL(nome, login) AS nome, 'dominio' AS origem
      FROM usuarios_dominio WHERE ativo = 1

      UNION

      -- Contatos com whatsapp (como login usa o número sem formatação)
      SELECT
        REPLACE(REPLACE(REPLACE(REPLACE(whatsapp,' ',''),'-',''),'(',''),')','') AS login,
        nome,
        'contato' AS origem
      FROM contatos
      WHERE whatsapp IS NOT NULL AND whatsapp <> ''

      ORDER BY nome
    `);
    res.json(r.recordset);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar usuários.' });
  }
});

// Listar logs de atividade do projeto
router.get('/api/projetos/:id/logs', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !perm) return res.status(403).json({ erro: 'Sem acesso.' });
    // Busca projeto para montar filtro de nome
    const proj = await pool.request().input('id', sql.Int, id)
      .query('SELECT nome FROM proj_projetos WHERE id=@id');
    const nomeProjeto = proj.recordset[0]?.nome || '';
    // Logs onde detalhes menciona o projeto ou sistema=projetos e referencia o id
    const r = await pool.request()
      .input('id',     sql.Int,      id)
      .input('sistema',sql.VarChar,  'projetos')
      .query(`
        SELECT TOP 100 id, usuario, ip, acao, sistema, detalhes, criado_em
        FROM logs_atividade
        WHERE sistema = @sistema
          AND (detalhes LIKE '%#' + CAST(@id AS NVARCHAR) + '%'
               OR detalhes LIKE '%projeto #' + CAST(@id AS NVARCHAR) + '%')
        ORDER BY criado_em DESC
      `);
    res.json(r.recordset);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar logs.' });
  }
});

// Solicitar aprovação do projeto
router.post('/api/projetos/:id/solicitar-aprovacao', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.perfil === 'admin';
  const { id }  = req.params;
  const { titulo, objetivo, aprovadores, tipo_consenso, consenso_valor } = req.body;
  if (!titulo) return res.status(400).json({ erro: 'Título obrigatório.' });
  if (!aprovadores || !aprovadores.length) return res.status(400).json({ erro: 'Pelo menos um aprovador obrigatório.' });
  try {
    const perm = await getPermissao(pool, id, usuario);
    if (!isAdmin && !temPermissao(perm, 'dono')) return res.status(403).json({ erro: 'Apenas o dono pode solicitar aprovação.' });

    const proj = await pool.request().input('id', sql.Int, id)
      .query('SELECT nome, aprovacao_id FROM proj_projetos WHERE id=@id AND ativo=1');
    if (!proj.recordset[0]) return res.status(404).json({ erro: 'Projeto não encontrado.' });
    if (proj.recordset[0].aprovacao_id) return res.status(400).json({ erro: 'Projeto já possui uma aprovação registrada.' });

    const nomeProjeto = proj.recordset[0].nome;
    const usuarioNome = req.session.usuario.nome || usuario;

    const aprov = await pool.request()
      .input('titulo',          sql.NVarChar, titulo)
      .input('objetivo',        sql.NVarChar, objetivo || `Aprovação do projeto: ${nomeProjeto}`)
      .input('criado_por',      sql.NVarChar, usuario)
      .input('criado_por_nome', sql.NVarChar, usuarioNome)
      .input('tipo_consenso',   sql.NVarChar, tipo_consenso  || 'unanimidade')
      .input('consenso_valor',  sql.Int,      consenso_valor || null)
      .query(`
        INSERT INTO aprovacoes (titulo, objetivo, criado_por, criado_por_nome, status, tipo_consenso, consenso_valor, criado_em)
        OUTPUT INSERTED.id
        VALUES (@titulo, @objetivo, @criado_por, @criado_por_nome, 'Pendente', @tipo_consenso, @consenso_valor, GETDATE())
      `);
    const aprovacaoId = aprov.recordset[0].id;

    for (const ap of aprovadores) {
      await pool.request()
        .input('aprovacao_id',    sql.Int,      aprovacaoId)
        .input('aprovador_login', sql.NVarChar, ap.login)
        .input('aprovador_nome',  sql.NVarChar, ap.nome || ap.login)
        .query(`
          INSERT INTO aprovacoes_participantes (aprovacao_id, aprovador_login, aprovador_nome)
          VALUES (@aprovacao_id, @aprovador_login, @aprovador_nome)
        `);
    }

    await pool.request()
      .input('id',           sql.Int, id)
      .input('aprovacao_id', sql.Int, aprovacaoId)
      .query(`UPDATE proj_projetos SET aprovacao_id=@aprovacao_id, atualizado_em=GETDATE() WHERE id=@id`);

    await registrarLog(pool, { usuario, ip: req.ip, acao: 'APROVACAO', sistema: 'projetos', detalhes: `Aprovação solicitada para projeto #${id}: ${titulo}` });
    res.json({ sucesso: true, aprovacao_id: aprovacaoId });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao solicitar aprovação.' });
  }
});

// Listar listas de tarefas do usuário (para seleção ao criar tarefa no projeto)
router.get('/api/projetos/auxiliar/minhas-listas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  try {
    const r = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .query(`
        SELECT l.id, l.nome, l.cor
        FROM agenda_listas l
        WHERE l.dono = @usuario
           OR EXISTS (SELECT 1 FROM agenda_membros m WHERE m.lista_id = l.id AND m.usuario = @usuario AND m.permissao IN ('edicao','dono'))
        ORDER BY l.nome
      `);
    res.json(r.recordset);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar listas.' });
  }
});

module.exports = router;
