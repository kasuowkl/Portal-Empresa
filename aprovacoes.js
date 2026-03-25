/**
 * ARQUIVO: routes/aprovacoes.js
 * VERSÃO:  1.0.0
 * DATA:    2026-03-13
 * DESCRIÇÃO: Rotas do sistema de Aprovações
 */

const express        = require('express');
const sql            = require('mssql');
const path           = require('path');
const verificarLogin   = require('../middleware/verificarLogin');
const { registrarLog } = require('../services/logService');
const router           = express.Router();

// ============================================================
// GET /aprovacoes — Serve a página HTML
// ============================================================
router.get('/aprovacoes', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/aprovacoes/index.html'));
});

// ============================================================
// GET /api/aprovacoes — Lista aprovações onde sou criador OU aprovador
// ============================================================
router.get('/api/aprovacoes', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const login   = req.session.usuario.usuario || req.session.usuario.login;
  try {
    const result = await pool.request()
      .input('login', sql.VarChar, login)
      .query(`
        SELECT DISTINCT
          a.id, a.titulo, a.objetivo, a.criado_por, a.criado_por_nome,
          a.status, a.criado_em, a.atualizado_em,
          (SELECT COUNT(*) FROM aprovacoes_participantes WHERE aprovacao_id = a.id) AS total_aprovadores,
          (SELECT COUNT(*) FROM aprovacoes_participantes WHERE aprovacao_id = a.id AND decisao = 'Aprovado') AS total_aprovados,
          (SELECT COUNT(*) FROM aprovacoes_participantes WHERE aprovacao_id = a.id AND decisao = 'Reprovado') AS total_reprovados,
          CASE WHEN a.criado_por = @login THEN 1 ELSE 0 END AS sou_criador,
          COALESCE((SELECT decisao FROM aprovacoes_participantes WHERE aprovacao_id = a.id AND aprovador_login = @login), NULL) AS minha_decisao
        FROM aprovacoes a
        LEFT JOIN aprovacoes_participantes ap ON ap.aprovacao_id = a.id AND ap.aprovador_login = @login
        LEFT JOIN aprovacoes_observadores aobs ON aobs.aprovacao_id = a.id AND aobs.observador_login = @login
        WHERE a.criado_por = @login OR ap.aprovador_login = @login OR aobs.observador_login = @login
        ORDER BY a.criado_em DESC
      `);
    res.json({ sucesso: true, aprovacoes: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar aprovações: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar aprovações.' });
  }
});

// ============================================================
// POST /api/aprovacoes — Cria nova aprovação
// ============================================================
router.post('/api/aprovacoes', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const login   = req.session.usuario.usuario || req.session.usuario.login;
  const nome    = req.session.usuario.nome || login;
  const { titulo, objetivo, aprovadores, observadores } = req.body;

  if (!titulo?.trim()) return res.status(400).json({ erro: 'Título é obrigatório.' });
  if (!Array.isArray(aprovadores) || !aprovadores.length)
    return res.status(400).json({ erro: 'Selecione ao menos um aprovador.' });

  try {
    // Insere aprovação principal
    const ins = await pool.request()
      .input('titulo',          sql.VarChar, titulo.trim())
      .input('objetivo',        sql.VarChar, objetivo || null)
      .input('criado_por',      sql.VarChar, login)
      .input('criado_por_nome', sql.VarChar, nome)
      .query(`
        INSERT INTO aprovacoes (titulo, objetivo, criado_por, criado_por_nome)
        OUTPUT INSERTED.id
        VALUES (@titulo, @objetivo, @criado_por, @criado_por_nome)
      `);
    const aprovacaoId = ins.recordset[0].id;

    // Busca nomes dos aprovadores e observadores
    const nomesR = await pool.request().query(`
      SELECT usuario AS login, nome FROM usuarios WHERE nivel != 'inativo'
      UNION ALL
      SELECT login, nome FROM usuarios_dominio
    `);
    const mapaUsuarios = {};
    nomesR.recordset.forEach(u => { mapaUsuarios[u.login] = u.nome; });

    // Insere participantes
    for (const aprLogin of aprovadores) {
      const aprNome = mapaUsuarios[aprLogin] || aprLogin;
      await pool.request()
        .input('aprovacao_id',    sql.Int,     aprovacaoId)
        .input('aprovador_login', sql.VarChar, aprLogin)
        .input('aprovador_nome',  sql.VarChar, aprNome)
        .query(`
          INSERT INTO aprovacoes_participantes (aprovacao_id, aprovador_login, aprovador_nome)
          VALUES (@aprovacao_id, @aprovador_login, @aprovador_nome)
        `);
    }

    // Insere observadores
    if (Array.isArray(observadores) && observadores.length) {
      for (const obsLogin of observadores) {
        const obsNome = mapaUsuarios[obsLogin] || obsLogin;
        await pool.request()
          .input('aprovacao_id',     sql.Int,     aprovacaoId)
          .input('observador_login', sql.VarChar, obsLogin)
          .input('observador_nome',  sql.VarChar, obsNome)
          .query(`INSERT INTO aprovacoes_observadores (aprovacao_id, observador_login, observador_nome) VALUES (@aprovacao_id, @observador_login, @observador_nome)`);
      }
    }

    // Registra no log da aprovação
    await pool.request()
      .input('aprovacao_id', sql.Int,     aprovacaoId)
      .input('usuario',      sql.VarChar, login)
      .input('acao',         sql.VarChar, `${nome} criou a aprovação`)
      .query(`INSERT INTO aprovacoes_log (aprovacao_id, usuario, acao) VALUES (@aprovacao_id, @usuario, @acao)`);

    registrarLog(pool, {
      usuario: login, ip: req.ip, acao: 'CRIACAO', sistema: 'aprovacoes',
      detalhes: `Aprovação #${aprovacaoId} criada: "${titulo.trim()}"`
    });

    res.json({ sucesso: true, id: aprovacaoId });
  } catch (erro) {
    logErro.error(`Erro ao criar aprovação: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar aprovação.' });
  }
});

// ============================================================
// GET /api/aprovacoes/:id — Detalhes da aprovação
// ============================================================
router.get('/api/aprovacoes/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const login   = req.session.usuario.usuario || req.session.usuario.login;
  const id      = parseInt(req.params.id);

  try {
    // Busca aprovação
    const aprR = await pool.request()
      .input('id',    sql.Int,     id)
      .input('login', sql.VarChar, login)
      .query(`
        SELECT a.*,
          CASE WHEN a.criado_por = @login THEN 1 ELSE 0 END AS sou_criador,
          COALESCE(
            (SELECT decisao FROM aprovacoes_participantes
             WHERE aprovacao_id = a.id AND aprovador_login = @login), NULL
          ) AS minha_decisao
        FROM aprovacoes a
        WHERE a.id = @id
          AND (a.criado_por = @login
               OR EXISTS (SELECT 1 FROM aprovacoes_participantes
                          WHERE aprovacao_id = a.id AND aprovador_login = @login)
               OR EXISTS (SELECT 1 FROM aprovacoes_observadores
                          WHERE aprovacao_id = a.id AND observador_login = @login))
      `);

    if (!aprR.recordset.length) return res.status(404).json({ erro: 'Aprovação não encontrada ou sem acesso.' });

    // Busca participantes
    const partsR = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT aprovador_login, aprovador_nome, decisao, motivo, respondido_em
        FROM aprovacoes_participantes
        WHERE aprovacao_id = @id
        ORDER BY id ASC
      `);

    // Busca observadores
    const obsR = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT observador_login, observador_nome
        FROM aprovacoes_observadores
        WHERE aprovacao_id = @id
        ORDER BY id ASC
      `);

    // Busca log
    const logR = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT usuario, acao, criado_em
        FROM aprovacoes_log
        WHERE aprovacao_id = @id
        ORDER BY criado_em ASC
      `);

    res.json({
      sucesso: true,
      aprovacao:    aprR.recordset[0],
      participantes: partsR.recordset,
      observadores:  obsR.recordset,
      log:           logR.recordset
    });
  } catch (erro) {
    logErro.error(`Erro ao buscar aprovação #${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar aprovação.' });
  }
});

// ============================================================
// PUT /api/aprovacoes/:id — Edita aprovação (criador, só Pendente)
// ============================================================
router.put('/api/aprovacoes/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const login   = req.session.usuario.usuario || req.session.usuario.login;
  const nome    = req.session.usuario.nome || login;
  const id      = parseInt(req.params.id);
  const { titulo, objetivo, aprovadores, observadores } = req.body;

  if (!titulo?.trim()) return res.status(400).json({ erro: 'Título é obrigatório.' });
  if (!Array.isArray(aprovadores) || !aprovadores.length)
    return res.status(400).json({ erro: 'Selecione ao menos um aprovador.' });

  try {
    // Verifica existência e permissão
    const aprR = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT criado_por, status FROM aprovacoes WHERE id = @id`);
    if (!aprR.recordset.length) return res.status(404).json({ erro: 'Aprovação não encontrada.' });
    const apr = aprR.recordset[0];
    if (apr.criado_por !== login) return res.status(403).json({ erro: 'Apenas o criador pode editar.' });
    if (apr.status !== 'Pendente') return res.status(400).json({ erro: 'Apenas aprovações pendentes podem ser editadas.' });

    // Atualiza título e objetivo
    await pool.request()
      .input('id',      sql.Int,     id)
      .input('titulo',  sql.VarChar, titulo.trim())
      .input('objetivo', sql.VarChar, objetivo || null)
      .query(`UPDATE aprovacoes SET titulo = @titulo, objetivo = @objetivo, atualizado_em = GETDATE() WHERE id = @id`);

    // Participantes atuais (Pendente = ainda pode ser removido)
    const partsR = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT aprovador_login, decisao FROM aprovacoes_participantes WHERE aprovacao_id = @id`);
    const partsAtual = partsR.recordset;
    const loginsPendentes = partsAtual.filter(p => p.decisao === 'Pendente').map(p => p.aprovador_login);
    const loginsRespondidos = partsAtual.filter(p => p.decisao !== 'Pendente').map(p => p.aprovador_login);

    // Remove pendentes que não estão mais na nova lista
    for (const lp of loginsPendentes) {
      if (!aprovadores.includes(lp)) {
        await pool.request()
          .input('id',    sql.Int,     id)
          .input('login', sql.VarChar, lp)
          .query(`DELETE FROM aprovacoes_participantes WHERE aprovacao_id = @id AND aprovador_login = @login`);
      }
    }

    // Busca nomes para novos aprovadores
    const nomesR = await pool.request().query(`
      SELECT usuario AS login, nome FROM usuarios WHERE nivel != 'inativo'
      UNION ALL
      SELECT login, nome FROM usuarios_dominio
    `);
    const mapaUsuarios = {};
    nomesR.recordset.forEach(u => { mapaUsuarios[u.login] = u.nome; });

    // Adiciona novos aprovadores que não existem ainda
    for (const aprLogin of aprovadores) {
      const jaExiste = partsAtual.find(p => p.aprovador_login === aprLogin);
      if (!jaExiste) {
        const aprNome = mapaUsuarios[aprLogin] || aprLogin;
        await pool.request()
          .input('aprovacao_id',    sql.Int,     id)
          .input('aprovador_login', sql.VarChar, aprLogin)
          .input('aprovador_nome',  sql.VarChar, aprNome)
          .query(`INSERT INTO aprovacoes_participantes (aprovacao_id, aprovador_login, aprovador_nome) VALUES (@aprovacao_id, @aprovador_login, @aprovador_nome)`);
      }
    }

    // Sincroniza observadores: remove todos e reinsere
    await pool.request()
      .input('id', sql.Int, id)
      .query(`DELETE FROM aprovacoes_observadores WHERE aprovacao_id = @id`);
    if (Array.isArray(observadores) && observadores.length) {
      for (const obsLogin of observadores) {
        const obsNome = mapaUsuarios[obsLogin] || obsLogin;
        await pool.request()
          .input('aprovacao_id',     sql.Int,     id)
          .input('observador_login', sql.VarChar, obsLogin)
          .input('observador_nome',  sql.VarChar, obsNome)
          .query(`INSERT INTO aprovacoes_observadores (aprovacao_id, observador_login, observador_nome) VALUES (@aprovacao_id, @observador_login, @observador_nome)`);
      }
    }

    // Log
    await pool.request()
      .input('aprovacao_id', sql.Int,     id)
      .input('usuario',      sql.VarChar, login)
      .input('acao',         sql.VarChar, `${nome} editou a aprovação`)
      .query(`INSERT INTO aprovacoes_log (aprovacao_id, usuario, acao) VALUES (@aprovacao_id, @usuario, @acao)`);

    registrarLog(pool, {
      usuario: login, ip: req.ip, acao: 'EDICAO', sistema: 'aprovacoes',
      detalhes: `Aprovação #${id} editada: "${titulo.trim()}"`
    });

    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao editar aprovação #${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao editar aprovação.' });
  }
});

// ============================================================
// PUT /api/aprovacoes/:id/responder — Responde como aprovador
// ============================================================
router.put('/api/aprovacoes/:id/responder', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const login   = req.session.usuario.usuario || req.session.usuario.login;
  const nome    = req.session.usuario.nome || login;
  const id      = parseInt(req.params.id);
  const { decisao, motivo } = req.body;

  if (!['Aprovado', 'Reprovado'].includes(decisao))
    return res.status(400).json({ erro: 'Decisão inválida. Use "Aprovado" ou "Reprovado".' });

  try {
    // Verifica que a aprovação existe e está Pendente
    const aprR = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT status FROM aprovacoes WHERE id = @id`);
    if (!aprR.recordset.length) return res.status(404).json({ erro: 'Aprovação não encontrada.' });
    if (aprR.recordset[0].status !== 'Pendente')
      return res.status(400).json({ erro: 'Esta aprovação não está mais pendente.' });

    // Verifica que sou participante com decisão Pendente
    const partR = await pool.request()
      .input('id',    sql.Int,     id)
      .input('login', sql.VarChar, login)
      .query(`SELECT id, decisao FROM aprovacoes_participantes WHERE aprovacao_id = @id AND aprovador_login = @login`);
    if (!partR.recordset.length) return res.status(403).json({ erro: 'Você não é aprovador desta aprovação.' });
    if (partR.recordset[0].decisao !== 'Pendente')
      return res.status(400).json({ erro: 'Você já respondeu esta aprovação.' });

    // Atualiza participante
    await pool.request()
      .input('id',            sql.Int,      id)
      .input('login',         sql.VarChar,  login)
      .input('decisao',       sql.VarChar,  decisao)
      .input('motivo',        sql.VarChar,  motivo || null)
      .query(`
        UPDATE aprovacoes_participantes
        SET decisao = @decisao, motivo = @motivo, respondido_em = GETDATE()
        WHERE aprovacao_id = @id AND aprovador_login = @login
      `);

    // Verifica se deve atualizar status da aprovação
    const todosR = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT decisao FROM aprovacoes_participantes WHERE aprovacao_id = @id`);
    const todos       = todosR.recordset.map(p => p.decisao);
    const algumReprov = todos.some(d => d === 'Reprovado');
    const todosAprov  = todos.every(d => d === 'Aprovado');

    let novoStatus = null;
    if (algumReprov)  novoStatus = 'Reprovado';
    else if (todosAprov) novoStatus = 'Aprovado';

    if (novoStatus) {
      await pool.request()
        .input('id',     sql.Int,     id)
        .input('status', sql.VarChar, novoStatus)
        .query(`UPDATE aprovacoes SET status = @status, atualizado_em = GETDATE() WHERE id = @id`);
    }

    // Registra no log da aprovação
    const acaoLog = decisao === 'Aprovado'
      ? `${nome} aprovou`
      : `${nome} reprovou${motivo ? ` — ${motivo}` : ''}`;
    await pool.request()
      .input('aprovacao_id', sql.Int,     id)
      .input('usuario',      sql.VarChar, login)
      .input('acao',         sql.VarChar, acaoLog)
      .query(`INSERT INTO aprovacoes_log (aprovacao_id, usuario, acao) VALUES (@aprovacao_id, @usuario, @acao)`);

    if (novoStatus) {
      const resumo = novoStatus === 'Aprovado' ? 'todos aprovaram' : 'aprovação reprovada';
      await pool.request()
        .input('aprovacao_id', sql.Int,     id)
        .input('usuario',      sql.VarChar, 'sistema')
        .input('acao',         sql.VarChar, `Status alterado para ${novoStatus} — ${resumo}`)
        .query(`INSERT INTO aprovacoes_log (aprovacao_id, usuario, acao) VALUES (@aprovacao_id, @usuario, @acao)`);
    }

    registrarLog(pool, {
      usuario: login, ip: req.ip, acao: 'EDICAO', sistema: 'aprovacoes',
      detalhes: `Aprovação #${id}: ${acaoLog}`
    });

    res.json({ sucesso: true, novoStatus });
  } catch (erro) {
    logErro.error(`Erro ao responder aprovação #${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao registrar resposta.' });
  }
});

// ============================================================
// DELETE /api/aprovacoes/:id — Cancela aprovação (só criador, só Pendente)
// ============================================================
router.delete('/api/aprovacoes/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const login   = req.session.usuario.usuario || req.session.usuario.login;
  const nome    = req.session.usuario.nome || login;
  const id      = parseInt(req.params.id);

  try {
    const aprR = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT criado_por, status, titulo FROM aprovacoes WHERE id = @id`);
    if (!aprR.recordset.length) return res.status(404).json({ erro: 'Aprovação não encontrada.' });
    const apr = aprR.recordset[0];
    if (apr.criado_por !== login) return res.status(403).json({ erro: 'Apenas o criador pode cancelar.' });
    if (apr.status !== 'Pendente') return res.status(400).json({ erro: 'Apenas aprovações pendentes podem ser canceladas.' });

    await pool.request()
      .input('id', sql.Int, id)
      .query(`UPDATE aprovacoes SET status = 'Cancelado', atualizado_em = GETDATE() WHERE id = @id`);

    await pool.request()
      .input('aprovacao_id', sql.Int,     id)
      .input('usuario',      sql.VarChar, login)
      .input('acao',         sql.VarChar, `${nome} cancelou a aprovação`)
      .query(`INSERT INTO aprovacoes_log (aprovacao_id, usuario, acao) VALUES (@aprovacao_id, @usuario, @acao)`);

    registrarLog(pool, {
      usuario: login, ip: req.ip, acao: 'EXCLUSAO', sistema: 'aprovacoes',
      detalhes: `Aprovação #${id} cancelada: "${apr.titulo}"`
    });

    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao cancelar aprovação #${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao cancelar aprovação.' });
  }
});

module.exports = router;
