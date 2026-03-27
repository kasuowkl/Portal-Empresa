/**
 * ARQUIVO: routes/aprovacoes.js
 * VERSÃO:  1.0.0
 * DATA:    2026-03-13
 * DESCRIÇÃO: Rotas do sistema de Aprovações
 */

const express        = require('express');
const sql            = require('mssql');
const path           = require('path');
const http           = require('http');
const verificarLogin   = require('../middleware/verificarLogin');
const { registrarLog } = require('../services/logService');
const { enviarNotificacao } = require('../services/emailService');
const router           = express.Router();

const WHATSAPP_URL = process.env.WHATSAPP_URL || 'http://localhost:3001';

// Envia mensagem WhatsApp via serviço interno (sem dependência de axios)
function notificarWhatsApp(numero, mensagem) {
  const body = JSON.stringify({ numero, mensagem });
  const url  = new URL(`${WHATSAPP_URL}/api/notificar`);
  const opts = {
    hostname: url.hostname, port: url.port || 3001,
    path: url.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  return new Promise((resolve) => {
    const req = http.request(opts, resolve);
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

async function buscarWhatsApp(pool, login) {
  if (!login) return null;
  try {
    const r = await pool.request().input('login', sql.VarChar, login).query(`
      SELECT whatsapp FROM usuarios       WHERE usuario = @login AND ativo = 1 AND whatsapp IS NOT NULL
      UNION ALL
      SELECT whatsapp FROM usuarios_dominio WHERE login = @login AND ativo = 1 AND whatsapp IS NOT NULL
    `);
    return r.recordset[0]?.whatsapp || null;
  } catch { return null; }
}

// ── Helpers de e-mail ─────────────────────────────────────────
async function buscarEmail(pool, login) {
  if (!login) return null;
  try {
    const r = await pool.request().input('login', sql.VarChar, login)
      .query('SELECT email FROM usuarios_dominio WHERE login = @login AND ativo = 1');
    return r.recordset[0]?.email || null;
  } catch { return null; }
}

async function buscarEmailsLista(pool, logins) {
  if (!logins || !logins.length) return [];
  const emails = await Promise.all(logins.map(l => buscarEmail(pool, l)));
  return emails.filter(Boolean);
}

async function buscarEmailsAdmins(pool) {
  try {
    const r = await pool.request().query(`
      SELECT ud.email FROM usuarios u
      LEFT JOIN usuarios_dominio ud ON ud.login = u.usuario
      WHERE u.nivel = 'admin' AND u.ativo = 1 AND ud.email IS NOT NULL AND ud.ativo = 1
    `);
    return r.recordset.map(x => x.email).filter(Boolean);
  } catch { return []; }
}

async function montarDadosNotif(pool, aprovacaoId) {
  const apr = await pool.request().input('id', sql.Int, aprovacaoId)
    .query('SELECT titulo, objetivo, criado_por, criado_por_nome, tipo_consenso, consenso_valor FROM aprovacoes WHERE id = @id');
  const a = apr.recordset[0];
  if (!a) return null;

  const partsR = await pool.request().input('id', sql.Int, aprovacaoId)
    .query('SELECT aprovador_login, aprovador_nome FROM aprovacoes_participantes WHERE aprovacao_id = @id');
  const obsR = await pool.request().input('id', sql.Int, aprovacaoId)
    .query('SELECT observador_login, observador_nome FROM aprovacoes_observadores WHERE aprovacao_id = @id');
  const anexosR = await pool.request().input('id', sql.Int, aprovacaoId)
    .query('SELECT COUNT(*) AS qtd FROM aprovacoes_anexos WHERE aprovacao_id = @id');

  const nomes_aprovadores  = partsR.recordset.map(p => p.aprovador_nome  || p.aprovador_login);
  const nomes_observadores = obsR.recordset.map(o => o.observador_nome || o.observador_login);
  const qtd_anexos         = anexosR.recordset[0]?.qtd || 0;

  const [email_solicitante, email_aprovadores, email_observadores, email_admins] = await Promise.all([
    buscarEmail(pool, a.criado_por),
    buscarEmailsLista(pool, partsR.recordset.map(p => p.aprovador_login)),
    buscarEmailsLista(pool, obsR.recordset.map(o => o.observador_login)),
    buscarEmailsAdmins(pool),
  ]);

  return { ...a, email_solicitante, email_aprovadores, email_observadores, email_admins,
           nomes_aprovadores, nomes_observadores, qtd_anexos };
}

// ============================================================
// LÓGICA DE CONSENSO
// ============================================================
function calcularConsenso(decisoes, tipoConsenso, consensoValor) {
  const total      = decisoes.length;
  const aprovados  = decisoes.filter(d => d === 'Aprovado').length;
  const reprovados = decisoes.filter(d => d === 'Reprovado').length;
  const pendentes  = decisoes.filter(d => d === 'Pendente').length;

  switch (tipoConsenso) {
    case 'maioria_simples': {
      const needed = Math.floor(total / 2) + 1;
      if (aprovados  >= needed)         return 'Aprovado';
      if (reprovados > total - needed)  return 'Reprovado'; // impossível atingir
      return null;
    }
    case 'maioria_qualificada': {
      const pct    = consensoValor || 67;
      const needed = Math.ceil(total * pct / 100);
      if (aprovados  >= needed)        return 'Aprovado';
      if (reprovados > total - needed) return 'Reprovado';
      return null;
    }
    case 'quorum_minimo': {
      const quorum      = consensoValor || Math.ceil(total / 2);
      const respondidos = aprovados + reprovados;
      if (respondidos < quorum) return null; // quórum não atingido
      // Com quórum atingido: maioria simples entre os respondentes
      if (aprovados  > reprovados) return 'Aprovado';
      if (reprovados >= aprovados) return 'Reprovado';
      return null;
    }
    case 'unanimidade':
    default:
      if (reprovados > 0)   return 'Reprovado';
      if (pendentes  === 0) return 'Aprovado';
      return null;
  }
}

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
          a.tipo_consenso, a.consenso_valor,
          (SELECT COUNT(*) FROM aprovacoes_participantes WHERE aprovacao_id = a.id) AS total_aprovadores,
          (SELECT COUNT(*) FROM aprovacoes_participantes WHERE aprovacao_id = a.id AND decisao = 'Aprovado') AS total_aprovados,
          (SELECT COUNT(*) FROM aprovacoes_participantes WHERE aprovacao_id = a.id AND decisao = 'Reprovado') AS total_reprovados,
          CASE WHEN a.criado_por = @login THEN 1 ELSE 0 END AS sou_criador,
          COALESCE((SELECT decisao FROM aprovacoes_participantes WHERE aprovacao_id = a.id AND aprovador_login = @login), NULL) AS minha_decisao,
          (SELECT STRING_AGG(aprovador_nome, ', ') WITHIN GROUP (ORDER BY id) FROM aprovacoes_participantes WHERE aprovacao_id = a.id) AS aprovadores_lista
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
  const { titulo, objetivo, aprovadores, observadores, tipo_consenso, consenso_valor } = req.body;

  if (!titulo?.trim()) return res.status(400).json({ erro: 'Título é obrigatório.' });
  if (!Array.isArray(aprovadores) || !aprovadores.length)
    return res.status(400).json({ erro: 'Selecione ao menos um aprovador.' });

  const tiposValidos = ['unanimidade', 'maioria_simples', 'maioria_qualificada', 'quorum_minimo'];
  const tipoFinal    = tiposValidos.includes(tipo_consenso) ? tipo_consenso : 'unanimidade';
  const valorFinal   = (tipoFinal === 'maioria_qualificada' || tipoFinal === 'quorum_minimo')
    ? (parseInt(consenso_valor) || null) : null;

  try {
    // Insere aprovação principal
    const ins = await pool.request()
      .input('titulo',          sql.VarChar, titulo.trim())
      .input('objetivo',        sql.VarChar, objetivo || null)
      .input('criado_por',      sql.VarChar, login)
      .input('criado_por_nome', sql.VarChar, nome)
      .input('tipo_consenso',   sql.VarChar, tipoFinal)
      .input('consenso_valor',  sql.Int,     valorFinal)
      .query(`
        INSERT INTO aprovacoes (titulo, objetivo, criado_por, criado_por_nome, tipo_consenso, consenso_valor)
        OUTPUT INSERTED.id
        VALUES (@titulo, @objetivo, @criado_por, @criado_por_nome, @tipo_consenso, @consenso_valor)
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

    montarDadosNotif(pool, aprovacaoId).then(d => {
      if (d) enviarNotificacao(pool, 'aprovacoes.nova_solicitacao', d).catch(() => {});
    }).catch(() => {});

    // Notificação WhatsApp para cada aprovador com número cadastrado
    if (Array.isArray(aprovadores) && aprovadores.length) {
      const portalBase = process.env.PORTAL_URL || `http://localhost:${process.env.PORTA_APP || 3000}`;
      const msg =
        `*Portal WKL — Nova Aprovação Pendente* 🔔\n\n` +
        `Você tem uma solicitação aguardando sua resposta:\n\n` +
        `*#${aprovacaoId}* — ${titulo.trim()}\n` +
        `Solicitante: ${nome}\n\n` +
        `Para responder, envie:\n` +
        `✅ *aprovar ${aprovacaoId}*\n` +
        `❌ *reprovar ${aprovacaoId} [motivo]*\n\n` +
        `Portal: ${portalBase}/aprovacoes`;

      for (const aprLogin of aprovadores) {
        buscarWhatsApp(pool, aprLogin).then(numero => {
          if (numero) notificarWhatsApp(numero, msg).catch(() => {});
        }).catch(() => {});
      }
    }

    res.json({ sucesso: true, id: aprovacaoId });
  } catch (erro) {
    logErro.error(`Erro ao criar aprovação: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar aprovação.' });
  }
});

// ============================================================
// GET /api/aprovacoes/relatorios — Dados para relatórios
// ============================================================
router.get('/api/aprovacoes/relatorios', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const nivel   = req.session.usuario.nivel || '';

  if (!['admin', 'gestor'].includes(nivel))
    return res.status(403).json({ erro: 'Acesso restrito a administradores e gestores.' });

  const { tipo = 'resumido', dataInicio, dataFim, criado_por, status, tipo_consenso } = req.query;

  const conds = [];
  if (dataInicio)    conds.push(`a.criado_em >= '${dataInicio.replace(/'/g, "''")}'`);
  if (dataFim)       conds.push(`a.criado_em < DATEADD(day,1,'${dataFim.replace(/'/g, "''")}')`);
  if (criado_por)    conds.push(`a.criado_por = '${criado_por.replace(/'/g, "''")}'`);
  if (tipo_consenso) conds.push(`a.tipo_consenso = '${tipo_consenso.replace(/'/g, "''")}'`);
  if (status) {
    const arr = status.split(',').map(s => `'${s.trim().replace(/'/g, "''")}'`).join(',');
    conds.push(`a.status IN (${arr})`);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  try {
    if (tipo === 'detalhado') {
      const r = await pool.request().query(`
        SELECT
          a.id, a.titulo, a.criado_por, a.criado_por_nome,
          a.status, a.tipo_consenso, a.consenso_valor,
          a.criado_em, a.atualizado_em,
          (SELECT COUNT(*) FROM aprovacoes_participantes WHERE aprovacao_id = a.id) AS total_aprovadores,
          (SELECT COUNT(*) FROM aprovacoes_participantes WHERE aprovacao_id = a.id AND decisao = 'Aprovado')  AS total_aprovados,
          (SELECT COUNT(*) FROM aprovacoes_participantes WHERE aprovacao_id = a.id AND decisao = 'Reprovado') AS total_reprovados,
          (SELECT COUNT(*) FROM aprovacoes_anexos WHERE aprovacao_id = a.id) AS total_anexos
        FROM aprovacoes a
        ${where}
        ORDER BY a.criado_em DESC
      `);
      return res.json({ aprovacoes: r.recordset });
    }

    const [resumoR, porStatusR, porTipoR, porCriadorR] = await Promise.all([
      pool.request().query(`
        SELECT
          COUNT(*) AS total_geral,
          SUM(CASE WHEN status = 'Pendente'  THEN 1 ELSE 0 END) AS total_pendentes,
          SUM(CASE WHEN status = 'Aprovado'  THEN 1 ELSE 0 END) AS total_aprovados,
          SUM(CASE WHEN status = 'Reprovado' THEN 1 ELSE 0 END) AS total_reprovados,
          SUM(CASE WHEN status = 'Cancelado' THEN 1 ELSE 0 END) AS total_cancelados,
          AVG(CAST(DATEDIFF(minute, a.criado_em,
            CASE WHEN a.status != 'Pendente' THEN a.atualizado_em END) AS FLOAT)) AS tempo_medio_min
        FROM aprovacoes a ${where}
      `),
      pool.request().query(`
        SELECT status, COUNT(*) AS total
        FROM aprovacoes a ${where}
        GROUP BY status ORDER BY total DESC
      `),
      pool.request().query(`
        SELECT tipo_consenso, COUNT(*) AS total
        FROM aprovacoes a ${where}
        GROUP BY tipo_consenso ORDER BY total DESC
      `),
      pool.request().query(`
        SELECT
          criado_por_nome AS nome, criado_por AS login,
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'Aprovado'  THEN 1 ELSE 0 END) AS aprovados,
          SUM(CASE WHEN status = 'Reprovado' THEN 1 ELSE 0 END) AS reprovados,
          SUM(CASE WHEN status = 'Pendente'  THEN 1 ELSE 0 END) AS pendentes
        FROM aprovacoes a ${where}
        GROUP BY criado_por_nome, criado_por
        ORDER BY total DESC
      `)
    ]);

    return res.json({
      resumo:          resumoR.recordset[0],
      porStatus:       porStatusR.recordset,
      porTipoConsenso: porTipoR.recordset,
      porCriador:      porCriadorR.recordset
    });
  } catch (erro) {
    logErro.error(`Erro ao gerar relatório de aprovações: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao gerar relatório.' });
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

    // Busca metadados dos anexos (sem base64)
    const anexosR = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT id, nome_original, tipo_mime, tamanho, enviado_por, enviado_por_nome, enviado_em
        FROM aprovacoes_anexos
        WHERE aprovacao_id = @id
        ORDER BY enviado_em ASC
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
      aprovacao:     aprR.recordset[0],
      participantes: partsR.recordset,
      observadores:  obsR.recordset,
      anexos:        anexosR.recordset,
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
  const { titulo, objetivo, aprovadores, observadores, tipo_consenso, consenso_valor } = req.body;

  if (!titulo?.trim()) return res.status(400).json({ erro: 'Título é obrigatório.' });
  if (!Array.isArray(aprovadores) || !aprovadores.length)
    return res.status(400).json({ erro: 'Selecione ao menos um aprovador.' });

  const tiposValidos2 = ['unanimidade', 'maioria_simples', 'maioria_qualificada', 'quorum_minimo'];
  const tipoFinal2    = tiposValidos2.includes(tipo_consenso) ? tipo_consenso : 'unanimidade';
  const valorFinal2   = (tipoFinal2 === 'maioria_qualificada' || tipoFinal2 === 'quorum_minimo')
    ? (parseInt(consenso_valor) || null) : null;

  try {
    // Verifica existência e permissão
    const aprR = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT criado_por, status FROM aprovacoes WHERE id = @id`);
    if (!aprR.recordset.length) return res.status(404).json({ erro: 'Aprovação não encontrada.' });
    const apr = aprR.recordset[0];
    if (apr.criado_por !== login) return res.status(403).json({ erro: 'Apenas o criador pode editar.' });
    if (apr.status !== 'Pendente') return res.status(400).json({ erro: 'Apenas aprovações pendentes podem ser editadas.' });

    // Atualiza título, objetivo e consenso
    await pool.request()
      .input('id',             sql.Int,     id)
      .input('titulo',         sql.VarChar, titulo.trim())
      .input('objetivo',       sql.VarChar, objetivo || null)
      .input('tipo_consenso',  sql.VarChar, tipoFinal2)
      .input('consenso_valor', sql.Int,     valorFinal2)
      .query(`UPDATE aprovacoes SET titulo = @titulo, objetivo = @objetivo, tipo_consenso = @tipo_consenso, consenso_valor = @consenso_valor, atualizado_em = GETDATE() WHERE id = @id`);

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

    montarDadosNotif(pool, id).then(d => {
      if (d) enviarNotificacao(pool, 'aprovacoes.editada', d).catch(() => {});
    }).catch(() => {});

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
      .query(`SELECT status, tipo_consenso, consenso_valor FROM aprovacoes WHERE id = @id`);
    if (!aprR.recordset.length) return res.status(404).json({ erro: 'Aprovação não encontrada.' });
    if (aprR.recordset[0].status !== 'Pendente')
      return res.status(400).json({ erro: 'Esta aprovação não está mais pendente.' });
    const { tipo_consenso: tipoC, consenso_valor: valorC } = aprR.recordset[0];

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

    // Verifica se deve atualizar status da aprovação (usando regra de consenso)
    const todosR = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT decisao FROM aprovacoes_participantes WHERE aprovacao_id = @id`);
    const todos      = todosR.recordset.map(p => p.decisao);
    const novoStatus = calcularConsenso(todos, tipoC || 'unanimidade', valorC);

    if (novoStatus) {
      await pool.request()
        .input('id',     sql.Int,     id)
        .input('status', sql.VarChar, novoStatus)
        .query(`UPDATE aprovacoes SET status = @status, atualizado_em = GETDATE() WHERE id = @id`);
    }

    // Registra no log da aprovação
    const viaWpp  = req.body._whatsapp_login ? ' (via WhatsApp)' : '';
    const acaoLog = decisao === 'Aprovado'
      ? `${nome} aprovou${viaWpp}`
      : `${nome} reprovou${viaWpp}${motivo ? ` — ${motivo}` : ''}`;
    await pool.request()
      .input('aprovacao_id', sql.Int,     id)
      .input('usuario',      sql.VarChar, login)
      .input('acao',         sql.VarChar, acaoLog)
      .query(`INSERT INTO aprovacoes_log (aprovacao_id, usuario, acao) VALUES (@aprovacao_id, @usuario, @acao)`);

    if (novoStatus) {
      const resumo = novoStatus === 'Aprovado' ? 'consenso atingido' : 'consenso negativo';
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

    if (novoStatus === 'Aprovado' || novoStatus === 'Reprovado') {
      const tipoNotif = novoStatus === 'Aprovado' ? 'aprovacoes.aprovada' : 'aprovacoes.reprovada';
      montarDadosNotif(pool, id).then(d => {
        if (d) enviarNotificacao(pool, tipoNotif, { ...d, por_nome: nome, motivo: motivo || null }).catch(() => {});
      }).catch(() => {});
    }

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

    montarDadosNotif(pool, id).then(d => {
      if (d) enviarNotificacao(pool, 'aprovacoes.cancelada', d).catch(() => {});
    }).catch(() => {});

    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao cancelar aprovação #${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao cancelar aprovação.' });
  }
});

// ============================================================
// GET /api/aprovacoes/:id/anexos/:anexoId — Download de anexo (com base64)
// ============================================================
router.get('/api/aprovacoes/:id/anexos/:anexoId', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const login   = req.session.usuario.usuario || req.session.usuario.login;
  const id      = parseInt(req.params.id);
  const anexoId = parseInt(req.params.anexoId);

  try {
    // Verifica acesso à aprovação
    const acesso = await pool.request()
      .input('id',    sql.Int,     id)
      .input('login', sql.VarChar, login)
      .query(`
        SELECT 1 FROM aprovacoes a
        WHERE a.id = @id
          AND (a.criado_por = @login
               OR EXISTS (SELECT 1 FROM aprovacoes_participantes WHERE aprovacao_id = a.id AND aprovador_login = @login)
               OR EXISTS (SELECT 1 FROM aprovacoes_observadores  WHERE aprovacao_id = a.id AND observador_login = @login))
      `);
    if (!acesso.recordset.length) return res.status(403).json({ erro: 'Sem acesso.' });

    const r = await pool.request()
      .input('id', sql.Int, anexoId)
      .input('aprovacaoId', sql.Int, id)
      .query(`SELECT nome_original, tipo_mime, dados_base64 FROM aprovacoes_anexos WHERE id = @id AND aprovacao_id = @aprovacaoId`);
    if (!r.recordset.length) return res.status(404).json({ erro: 'Anexo não encontrado.' });

    res.json({ sucesso: true, ...r.recordset[0] });
  } catch (erro) {
    logErro.error(`Erro ao baixar anexo: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao baixar anexo.' });
  }
});

// ============================================================
// POST /api/aprovacoes/:id/anexos — Envia novo anexo
// ============================================================
router.post('/api/aprovacoes/:id/anexos', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const login   = req.session.usuario.usuario || req.session.usuario.login;
  const nome    = req.session.usuario.nome || login;
  const id      = parseInt(req.params.id);
  const { nome_original, tipo_mime, tamanho, dados_base64 } = req.body;

  if (!nome_original || !dados_base64)
    return res.status(400).json({ erro: 'Dados do arquivo inválidos.' });
  if (tamanho > 5 * 1024 * 1024)
    return res.status(400).json({ erro: 'Arquivo muito grande. Limite: 5 MB.' });

  try {
    // Verifica acesso à aprovação
    const acesso = await pool.request()
      .input('id',    sql.Int,     id)
      .input('login', sql.VarChar, login)
      .query(`
        SELECT 1 FROM aprovacoes a
        WHERE a.id = @id
          AND (a.criado_por = @login
               OR EXISTS (SELECT 1 FROM aprovacoes_participantes WHERE aprovacao_id = a.id AND aprovador_login = @login)
               OR EXISTS (SELECT 1 FROM aprovacoes_observadores  WHERE aprovacao_id = a.id AND observador_login = @login))
      `);
    if (!acesso.recordset.length) return res.status(403).json({ erro: 'Sem acesso.' });

    const r = await pool.request()
      .input('aprovacao_id',    sql.Int,     id)
      .input('nome_original',   sql.VarChar, nome_original)
      .input('tipo_mime',       sql.VarChar, tipo_mime || null)
      .input('tamanho',         sql.Int,     tamanho || null)
      .input('dados_base64',    sql.VarChar, dados_base64)
      .input('enviado_por',     sql.VarChar, login)
      .input('enviado_por_nome',sql.VarChar, nome)
      .query(`
        INSERT INTO aprovacoes_anexos (aprovacao_id, nome_original, tipo_mime, tamanho, dados_base64, enviado_por, enviado_por_nome)
        OUTPUT INSERTED.id, INSERTED.enviado_em
        VALUES (@aprovacao_id, @nome_original, @tipo_mime, @tamanho, @dados_base64, @enviado_por, @enviado_por_nome)
      `);

    const novoId = r.recordset[0].id;
    const enviadoEm = r.recordset[0].enviado_em;

    await pool.request()
      .input('aprovacao_id', sql.Int,     id)
      .input('usuario',      sql.VarChar, login)
      .input('acao',         sql.VarChar, `${nome} anexou "${nome_original}"`.substring(0, 200))
      .query(`INSERT INTO aprovacoes_log (aprovacao_id, usuario, acao) VALUES (@aprovacao_id, @usuario, @acao)`);

    registrarLog(pool, {
      usuario: login, ip: req.ip, acao: 'EDICAO', sistema: 'aprovacoes',
      detalhes: `Aprovação #${id}: anexo "${nome_original}" enviado`
    });

    res.json({ sucesso: true, id: novoId, enviado_em: enviadoEm });
  } catch (erro) {
    logErro.error(`Erro ao enviar anexo: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao salvar anexo.' });
  }
});

// ============================================================
// DELETE /api/aprovacoes/:id/anexos/:anexoId — Remove anexo
// ============================================================
router.delete('/api/aprovacoes/:id/anexos/:anexoId', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const login   = req.session.usuario.usuario || req.session.usuario.login;
  const id      = parseInt(req.params.id);
  const anexoId = parseInt(req.params.anexoId);

  try {
    const nome    = req.session.usuario.nome || login;

    const r = await pool.request()
      .input('id',          sql.Int,     anexoId)
      .input('aprovacaoId', sql.Int,     id)
      .input('login',       sql.VarChar, login)
      .query(`SELECT enviado_por, nome_original FROM aprovacoes_anexos WHERE id = @id AND aprovacao_id = @aprovacaoId`);

    if (!r.recordset.length) return res.status(404).json({ erro: 'Anexo não encontrado.' });

    // Verifica criador da aprovação ou quem enviou
    const apr = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT criado_por FROM aprovacoes WHERE id = @id`);
    const criador = apr.recordset[0]?.criado_por;
    if (r.recordset[0].enviado_por !== login && criador !== login)
      return res.status(403).json({ erro: 'Sem permissão para remover este anexo.' });

    const nomeArquivo = r.recordset[0].nome_original;

    await pool.request()
      .input('id', sql.Int, anexoId)
      .query(`DELETE FROM aprovacoes_anexos WHERE id = @id`);

    await pool.request()
      .input('aprovacao_id', sql.Int,     id)
      .input('usuario',      sql.VarChar, login)
      .input('acao',         sql.VarChar, `${nome} removeu o anexo "${nomeArquivo}"`.substring(0, 200))
      .query(`INSERT INTO aprovacoes_log (aprovacao_id, usuario, acao) VALUES (@aprovacao_id, @usuario, @acao)`);

    registrarLog(pool, {
      usuario: login, ip: req.ip, acao: 'EXCLUSAO', sistema: 'aprovacoes',
      detalhes: `Aprovação #${id}: anexo "${nomeArquivo}" removido`
    });

    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao remover anexo: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao remover anexo.' });
  }
});

// ============================================================
// GET /aprovacoes/relatorios — Página HTML de relatórios
// ============================================================
router.get('/aprovacoes/relatorios', verificarLogin, (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/aprovacoes/relatoriosAprovacoes.html'));
});

module.exports = router;
