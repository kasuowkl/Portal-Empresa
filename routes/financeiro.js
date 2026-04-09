/**
 * ARQUIVO: routes/financeiro.js
 * VERSÃƒO:  1.0.0
 * DATA:    2026-03-04
 * DESCRIÃ‡ÃƒO: Rotas da Agenda Financeira
 */

const express              = require('express');
const sql                  = require('mssql');
const path                 = require('path');
const verificarLogin       = require('../middleware/verificarLogin');
const { enviarNotificacao } = require('../services/emailService');
const { registrarLog }     = require('../services/logService');
const { enviarNotificacaoWhatsAppPorChips } = require('../services/whatsappDispatchService');
const { renderizarMensagemWhatsApp } = require('../services/whatsappTemplateService');
const router               = express.Router();

// ============================================================
// Helper: retorna array de emails do dono + membros com ediÃ§Ã£o
// ============================================================
async function getEmailsAgenda(pool, agendaId) {
  try {
    const r = await pool.request()
      .input('agenda_id', sql.Int, agendaId)
      .query(`
        SELECT DISTINCT ud.email
        FROM fin_agendas fa
        JOIN usuarios_dominio ud ON ud.login = fa.dono
        WHERE fa.id = @agenda_id AND ud.email IS NOT NULL AND ud.email != ''
        UNION
        SELECT DISTINCT ud.email
        FROM fin_membros fm
        JOIN usuarios_dominio ud ON ud.login = fm.usuario
        WHERE fm.agenda_id = @agenda_id
          AND fm.permissao IN ('edicao', 'dono')
          AND ud.email IS NOT NULL AND ud.email != ''
      `);
    return r.recordset.map(row => row.email).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function getLoginsAgenda(pool, agendaId) {
  try {
    const r = await pool.request()
      .input('agenda_id', sql.Int, agendaId)
      .query(`
        SELECT dono AS login
        FROM fin_agendas
        WHERE id = @agenda_id
        UNION
        SELECT usuario AS login
        FROM fin_membros
        WHERE agenda_id = @agenda_id AND permissao IN ('edicao', 'dono')
      `);
    return r.recordset.map((row) => String(row.login || '').toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

async function enviarWhatsAppFinanceiro(pool, evento, contexto, meta = {}) {
  const eventoLabel = {
    'financeiro.nova_conta': 'Novo lançamento financeiro',
    'financeiro.conta_editada': 'Lançamento financeiro editado',
    'financeiro.conta_paga': 'Lançamento marcado como pago',
    'financeiro.conta_vencida': 'Lançamento vencido',
    'financeiro.lancamento': 'Lançamento a realizar',
  };
  const mensagem = await renderizarMensagemWhatsApp(pool, 'financeiro.evento_padrao', {
    evento_label: eventoLabel[evento] || evento,
    descricao_item: contexto.descricao || '-',
    agenda_nome: contexto.agenda_nome || '-',
    valor: contexto.valor || '-',
    data: contexto.data || '-',
    link: 'http://192.168.0.80:3132/agendaFinanceira',
  });

  await enviarNotificacaoWhatsAppPorChips(pool, {
    evento,
    sistema: 'financeiro',
    mensagem,
    usuario: meta.usuario || contexto.criado_por || 'sistema',
    ip: meta.ip || '',
    mapaChips: {
      criado_por_usuario: contexto.criado_por ? [contexto.criado_por] : [],
      gestores: contexto.logins_agenda || [],
      gestores_setor: [],
    },
  });
}

async function buscarEmailAprovacaoFinanceiro(pool, login) {
  if (!login) return null;
  try {
    const r = await pool.request().input('login', sql.VarChar, login)
      .query('SELECT email FROM usuarios_dominio WHERE login = @login AND ativo = 1');
    return r.recordset[0]?.email || null;
  } catch {
    return null;
  }
}

async function buscarEmailsListaAprovacaoFinanceiro(pool, logins) {
  if (!logins || !logins.length) return [];
  const emails = await Promise.all(logins.map((login) => buscarEmailAprovacaoFinanceiro(pool, login)));
  return emails.filter(Boolean);
}

async function buscarEmailsAdminsAprovacaoFinanceiro(pool) {
  try {
    const r = await pool.request().query(`
      SELECT ud.email
      FROM usuarios u
      LEFT JOIN usuarios_dominio ud ON ud.login = u.usuario
      WHERE u.nivel = 'admin' AND u.ativo = 1 AND ud.email IS NOT NULL AND ud.ativo = 1
    `);
    return r.recordset.map((x) => x.email).filter(Boolean);
  } catch {
    return [];
  }
}

async function buscarWhatsAppAprovadoresFinanceiro(pool, logins) {
  const unicos = [...new Set((logins || []).map((l) => String(l || '').trim()).filter(Boolean))];
  if (!unicos.length) return {};
  try {
    const lista = unicos.map((l) => `'${l.replace(/'/g, '')}'`).join(',');
    const r = await pool.request().query(`
      SELECT login, whatsapp FROM usuarios_dominio WHERE login IN (${lista}) AND whatsapp IS NOT NULL AND whatsapp <> ''
      UNION ALL
      SELECT usuario AS login, whatsapp FROM usuarios WHERE usuario IN (${lista}) AND whatsapp IS NOT NULL AND whatsapp <> ''
    `);
    const mapa = {};
    for (const row of r.recordset) mapa[row.login] = row.whatsapp;
    return mapa;
  } catch {
    return {};
  }
}

async function montarDadosNotifAprovacaoFinanceiro(pool, aprovacaoId) {
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

  const nomes_aprovadores = partsR.recordset.map((p) => p.aprovador_nome || p.aprovador_login);
  const nomes_observadores = obsR.recordset.map((o) => o.observador_nome || o.observador_login);
  const qtd_anexos = anexosR.recordset[0]?.qtd || 0;

  const [email_solicitante, email_aprovadores, email_observadores, email_admins] = await Promise.all([
    buscarEmailAprovacaoFinanceiro(pool, a.criado_por),
    buscarEmailsListaAprovacaoFinanceiro(pool, partsR.recordset.map((p) => p.aprovador_login)),
    buscarEmailsListaAprovacaoFinanceiro(pool, obsR.recordset.map((o) => o.observador_login)),
    buscarEmailsAdminsAprovacaoFinanceiro(pool),
  ]);

  return {
    ...a,
    email_solicitante,
    email_aprovadores,
    email_observadores,
    email_admins,
    nomes_aprovadores,
    nomes_observadores,
    qtd_anexos,
  };
}

// ============================================================
// Helper: permissÃ£o do usuÃ¡rio na agenda financeira
// Retorna: 'dono' | 'edicao' | 'leitura' | null
// ============================================================
async function getPermissao(pool, agendaId, usuario) {
  const result = await pool.request()
    .input('agenda_id', sql.Int,     agendaId)
    .input('usuario',   sql.VarChar, usuario)
    .query(`
      SELECT 'dono' AS permissao
      FROM fin_agendas
      WHERE id = @agenda_id AND dono = @usuario
      UNION ALL
      SELECT permissao
      FROM fin_membros
      WHERE agenda_id = @agenda_id AND usuario = @usuario
    `);
  return result.recordset[0]?.permissao || null;
}

const NIVEL = { leitura: 1, edicao: 2, dono: 3 };

function temPermissao(perm, nivelMinimo) {
  return !!perm && (NIVEL[perm] || 0) >= (NIVEL[nivelMinimo] || 0);
}

// ============================================================
// GET /agendaFinanceira — Serve a pÃ¡gina HTML
// ============================================================
router.get('/agendaFinanceira', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agendaFinanceira/index.html'));
});

// ============================================================
// GET /api/financeiro/agendas
// ============================================================
router.get('/api/financeiro/agendas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;

  try {
    const result = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .query(`
        SELECT a.id, a.nome, a.descricao, a.cor, a.dono, a.criado_em,
               CASE WHEN a.dono = @usuario THEN 'dono' ELSE m.permissao END AS permissao,
               COALESCE(u.nome, ud.nome, a.dono) AS dono_nome
        FROM fin_agendas a
        LEFT JOIN fin_membros       m  ON m.agenda_id = a.id AND m.usuario = @usuario
        LEFT JOIN usuarios          u  ON u.usuario   = a.dono
        LEFT JOIN usuarios_dominio  ud ON ud.login    = a.dono AND u.usuario IS NULL
        WHERE a.dono = @usuario OR m.usuario = @usuario
        ORDER BY a.criado_em ASC
      `);
    res.json({ sucesso: true, agendas: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar agendas financeiras: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar agendas.' });
  }
});

// ============================================================
// POST /api/financeiro/agendas — Criar agenda
// ============================================================
router.post('/api/financeiro/agendas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const { nome, descricao, cor } = req.body;

  if (!nome?.trim()) return res.status(400).json({ erro: 'Informe o nome da agenda.' });

  try {
    const result = await pool.request()
      .input('nome',      sql.VarChar, nome.trim())
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('cor',       sql.VarChar, cor || '#3b82f6')
      .input('dono',      sql.VarChar, usuario)
      .query(`
        INSERT INTO fin_agendas (nome, descricao, cor, dono)
        OUTPUT INSERTED.id, INSERTED.nome, INSERTED.descricao,
               INSERTED.cor, INSERTED.dono, INSERTED.criado_em
        VALUES (@nome, @descricao, @cor, @dono)
      `);
    const agenda = { ...result.recordset[0], permissao: 'dono', dono_nome: usuario };
    registrarLog(pool, { usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'financeiro', detalhes: `Agenda "${nome.trim()}" criada` });
    res.json({ sucesso: true, mensagem: 'Agenda criada.', agenda });
  } catch (erro) {
    logErro.error(`Erro ao criar agenda financeira: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar agenda.' });
  }
});

// ============================================================
// PUT /api/financeiro/agendas/:id — Editar (somente dono)
// ============================================================
router.put('/api/financeiro/agendas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { nome, descricao, cor } = req.body;

  const perm = await getPermissao(pool, id, usuario);
  if (perm !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode editar a agenda.' });
  if (!nome?.trim())   return res.status(400).json({ erro: 'Informe o nome.' });

  try {
    await pool.request()
      .input('id',        sql.Int,     id)
      .input('nome',      sql.VarChar, nome.trim())
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('cor',       sql.VarChar, cor || '#3b82f6')
      .query('UPDATE fin_agendas SET nome=@nome, descricao=@descricao, cor=@cor WHERE id=@id');
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'financeiro', detalhes: `Agenda "${nome.trim()}" editada` });
    res.json({ sucesso: true, mensagem: 'Agenda atualizada.' });
  } catch (erro) {
    logErro.error(`Erro ao editar agenda financeira: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao editar agenda.' });
  }
});

// ============================================================
// DELETE /api/financeiro/agendas/:id — Excluir (somente dono)
// ============================================================
router.delete('/api/financeiro/agendas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const perm = await getPermissao(pool, id, usuario);
  if (perm !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode excluir a agenda.' });

  try {
    await pool.request().input('id', sql.Int, id).query('DELETE FROM fin_logs       WHERE agenda_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM fin_contas     WHERE agenda_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM fin_categorias WHERE agenda_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM fin_empresas   WHERE agenda_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM fin_membros    WHERE agenda_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM fin_agendas    WHERE id=@id');
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EXCLUSAO', sistema: 'financeiro', detalhes: `Agenda #${id} excluÃ­da` });
    res.json({ sucesso: true, mensagem: 'Agenda excluÃ­da.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir agenda financeira: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir agenda.' });
  }
});

// ============================================================
// GET /api/financeiro/agendas/:id/membros
// ============================================================
router.get('/api/financeiro/agendas/:id/membros', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const perm = await getPermissao(pool, id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso a esta agenda.' });

  try {
    const result = await pool.request()
      .input('agenda_id', sql.Int, id)
      .query(`
        SELECT m.usuario,
               COALESCE(u.nome, ud.nome, m.usuario) AS nome,
               m.permissao, m.adicionado_em
        FROM fin_membros m
        LEFT JOIN usuarios         u  ON u.usuario = m.usuario
        LEFT JOIN usuarios_dominio ud ON ud.login   = m.usuario AND u.usuario IS NULL
        WHERE m.agenda_id = @agenda_id
        ORDER BY m.adicionado_em ASC
      `);
    res.json({ sucesso: true, membros: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar membros: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar membros.' });
  }
});

// ============================================================
// POST /api/financeiro/agendas/:id/membros
// ============================================================
router.post('/api/financeiro/agendas/:id/membros', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { usuario: novo, permissao } = req.body;

  const perm = await getPermissao(pool, id, usuario);
  if (perm !== 'dono')  return res.status(403).json({ erro: 'Apenas o dono pode adicionar membros.' });
  if (!novo)            return res.status(400).json({ erro: 'Informe o usuÃ¡rio.' });
  if (novo === usuario) return res.status(400).json({ erro: 'Você já é o dono da agenda.' });

  try {
    await pool.request()
      .input('agenda_id', sql.Int,     id)
      .input('usuario',   sql.VarChar, novo.trim().toLowerCase())
      .input('permissao', sql.VarChar, permissao || 'leitura')
      .query(`
        IF NOT EXISTS (SELECT 1 FROM fin_membros WHERE agenda_id=@agenda_id AND usuario=@usuario)
          INSERT INTO fin_membros (agenda_id, usuario, permissao) VALUES (@agenda_id, @usuario, @permissao)
        ELSE
          UPDATE fin_membros SET permissao=@permissao WHERE agenda_id=@agenda_id AND usuario=@usuario
      `);
    res.json({ sucesso: true, mensagem: 'Membro adicionado.' });
  } catch (erro) {
    logErro.error(`Erro ao adicionar membro: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao adicionar membro.' });
  }
});

// ============================================================
// DELETE /api/financeiro/agendas/:id/membros/:membro
// ============================================================
router.delete('/api/financeiro/agendas/:id/membros/:membro', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const membro  = req.params.membro;

  const perm = await getPermissao(pool, id, usuario);
  if (perm !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode remover membros.' });

  try {
    await pool.request()
      .input('agenda_id', sql.Int,     id)
      .input('usuario',   sql.VarChar, membro)
      .query('DELETE FROM fin_membros WHERE agenda_id=@agenda_id AND usuario=@usuario');
    res.json({ sucesso: true, mensagem: 'Membro removido.' });
  } catch (erro) {
    logErro.error(`Erro ao remover membro: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao remover membro.' });
  }
});

// ============================================================
// GET /api/financeiro/agendas/:id/contas
// ============================================================
router.get('/api/financeiro/agendas/:id/contas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const perm = await getPermissao(pool, id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso a esta agenda.' });

  try {
    const result = await pool.request()
      .input('agenda_id', sql.Int, id)
      .query(`
        SELECT id, agenda_id, descricao, valor, data, categoria, empresa, frequencia,
               status, recorrencia_id, eh_pai, criado_por, criado_em, atualizado_em
        FROM fin_contas
        WHERE agenda_id = @agenda_id
        ORDER BY data ASC, criado_em ASC
      `);
    res.json({ sucesso: true, contas: result.recordset, permissao: perm });
  } catch (erro) {
    logErro.error(`Erro ao listar contas: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar contas.' });
  }
});

// ============================================================
// GET /api/financeiro/contas/:id/aprovacoes
// ============================================================
router.get('/api/financeiro/contas/:id/aprovacoes', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id, 10);

  try {
    const contaR = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT id, agenda_id FROM fin_contas WHERE id = @id');
    const conta = contaR.recordset[0];
    if (!conta) return res.status(404).json({ erro: 'Lançamento não encontrado.' });

    const perm = await getPermissao(pool, conta.agenda_id, usuario);
    if (!perm) return res.status(403).json({ erro: 'Sem acesso.' });

    const r = await pool.request()
      .input('conta_id', sql.Int, id)
      .query(`
        SELECT a.id, a.titulo, a.status, a.criado_em, a.atualizado_em, a.tipo_consenso, a.consenso_valor,
               a.criado_por, a.criado_por_nome
        FROM fin_contas_aprovacoes fca
        JOIN aprovacoes a ON a.id = fca.aprovacao_id
        WHERE fca.conta_id = @conta_id
        ORDER BY fca.id DESC
      `);

    res.json({ sucesso: true, aprovacoes: r.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar aprovações do financeiro: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar aprovações do lançamento.' });
  }
});

// ============================================================
// POST /api/financeiro/contas/:id/solicitar-aprovacao
// ============================================================
router.post('/api/financeiro/contas/:id/solicitar-aprovacao', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const login = req.session.usuario.usuario || req.session.usuario.login;
  const nome = req.session.usuario.nome || login;
  const id = parseInt(req.params.id, 10);
  const { titulo, objetivo, aprovadores, observadores, tipo_consenso, consenso_valor } = req.body || {};

  if (!Array.isArray(aprovadores) || !aprovadores.length) {
    return res.status(400).json({ erro: 'Selecione ao menos um aprovador.' });
  }

  const tiposValidos = ['unanimidade', 'maioria_simples', 'maioria_qualificada', 'quorum_minimo'];
  const tipoFinal = tiposValidos.includes(tipo_consenso) ? tipo_consenso : 'unanimidade';
  const valorFinal = (tipoFinal === 'maioria_qualificada' || tipoFinal === 'quorum_minimo')
    ? (parseInt(consenso_valor, 10) || null)
    : null;

  try {
    const contaR = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT c.id, c.agenda_id, c.descricao, c.valor, c.data, c.categoria, c.empresa, a.nome AS agenda_nome
        FROM fin_contas c
        LEFT JOIN fin_agendas a ON a.id = c.agenda_id
        WHERE c.id = @id
      `);
    const conta = contaR.recordset[0];
    if (!conta) return res.status(404).json({ erro: 'Lançamento não encontrado.' });

    const perm = await getPermissao(pool, conta.agenda_id, login);
    if (!temPermissao(perm, 'edicao')) {
      return res.status(403).json({ erro: 'Sem permissão para solicitar aprovação deste lançamento.' });
    }

    const nomesR = await pool.request().query(`
      SELECT usuario AS login, nome FROM usuarios WHERE nivel != 'inativo'
      UNION ALL
      SELECT login, nome FROM usuarios_dominio
    `);
    const mapaUsuarios = {};
    nomesR.recordset.forEach((u) => { mapaUsuarios[u.login] = u.nome; });

    const valorFmt = parseFloat(conta.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dataFmt = conta.data ? new Date(conta.data).toLocaleDateString('pt-BR') : '—';
    const linkFinanceiro = `http://192.168.0.80:3132/agendaFinanceira`;
    const tituloFinal = String(titulo || '').trim() || `Aprovação do lançamento: ${conta.descricao}`;
    const objetivoFinal = [
      (objetivo || '').trim(),
      '',
      'Origem: Agenda Financeira',
      `Agenda: ${conta.agenda_nome || 'Agenda Financeira'}`,
      `Lançamento: ${conta.descricao}`,
      `Valor: ${valorFmt}`,
      `Vencimento: ${dataFmt}`,
      `Categoria: ${conta.categoria || 'Geral'}`,
      conta.empresa ? `Empresa: ${conta.empresa}` : '',
      `Link: ${linkFinanceiro}`,
    ].filter((parte, idx, arr) => parte || (idx > 0 && arr[idx - 1])).join('\n').trim();

    const ins = await pool.request()
      .input('titulo', sql.VarChar, tituloFinal)
      .input('objetivo', sql.VarChar, objetivoFinal || null)
      .input('criado_por', sql.VarChar, login)
      .input('criado_por_nome', sql.VarChar, nome)
      .input('tipo_consenso', sql.VarChar, tipoFinal)
      .input('consenso_valor', sql.Int, valorFinal)
      .query(`
        INSERT INTO aprovacoes (titulo, objetivo, criado_por, criado_por_nome, tipo_consenso, consenso_valor)
        OUTPUT INSERTED.id
        VALUES (@titulo, @objetivo, @criado_por, @criado_por_nome, @tipo_consenso, @consenso_valor)
      `);
    const aprovacaoId = ins.recordset[0].id;

    for (const aprLogin of aprovadores) {
      const aprNome = mapaUsuarios[aprLogin] || aprLogin;
      await pool.request()
        .input('aprovacao_id', sql.Int, aprovacaoId)
        .input('aprovador_login', sql.VarChar, aprLogin)
        .input('aprovador_nome', sql.VarChar, aprNome)
        .query(`
          INSERT INTO aprovacoes_participantes (aprovacao_id, aprovador_login, aprovador_nome)
          VALUES (@aprovacao_id, @aprovador_login, @aprovador_nome)
        `);
    }

    if (Array.isArray(observadores) && observadores.length) {
      for (const obsLogin of observadores) {
        const obsNome = mapaUsuarios[obsLogin] || obsLogin;
        await pool.request()
          .input('aprovacao_id', sql.Int, aprovacaoId)
          .input('observador_login', sql.VarChar, obsLogin)
          .input('observador_nome', sql.VarChar, obsNome)
          .query(`
            INSERT INTO aprovacoes_observadores (aprovacao_id, observador_login, observador_nome)
            VALUES (@aprovacao_id, @observador_login, @observador_nome)
          `);
      }
    }

    await pool.request()
      .input('conta_id', sql.Int, id)
      .input('aprovacao_id', sql.Int, aprovacaoId)
      .input('criado_por', sql.VarChar, login)
      .query(`
        INSERT INTO fin_contas_aprovacoes (conta_id, aprovacao_id, criado_por)
        VALUES (@conta_id, @aprovacao_id, @criado_por)
      `);

    await pool.request()
      .input('aprovacao_id', sql.Int, aprovacaoId)
      .input('usuario', sql.VarChar, login)
      .input('acao', sql.VarChar, `${nome} criou a aprovação via lançamento financeiro #${id}`)
      .query('INSERT INTO aprovacoes_log (aprovacao_id, usuario, acao) VALUES (@aprovacao_id, @usuario, @acao)');

    registrarLog(pool, { usuario: login, ip: req.ip, acao: 'CRIACAO', sistema: 'financeiro', detalhes: `Lançamento #${id}: aprovação #${aprovacaoId} solicitada` });
    registrarLog(pool, { usuario: login, ip: req.ip, acao: 'CRIACAO', sistema: 'aprovacoes', detalhes: `Aprovação #${aprovacaoId} criada via Agenda Financeira (#${id})` });

    montarDadosNotifAprovacaoFinanceiro(pool, aprovacaoId).then((dados) => {
      if (dados) enviarNotificacao(pool, 'aprovacoes.nova_solicitacao', dados).catch(() => {});
    }).catch(() => {});

    buscarWhatsAppAprovadoresFinanceiro(pool, aprovadores).then(async (mapaWhatsApp) => {
      for (const [aprLogin, numero] of Object.entries(mapaWhatsApp)) {
        const aprNome = mapaUsuarios[aprLogin] || aprLogin;
        const msg = await renderizarMensagemWhatsApp(pool, 'financeiro.aprovacao_lancamento', {
          aprovador_nome: aprNome,
          aprovacao_id: aprovacaoId,
          titulo: tituloFinal,
          agenda_nome: conta.agenda_nome || 'Agenda Financeira',
          lancamento: conta.descricao,
          solicitante: nome,
          link_item: linkFinanceiro,
          link_aprovacoes: 'http://192.168.0.80:3132/aprovacoes',
        });

        await enviarNotificacaoWhatsAppPorChips(pool, {
          evento: 'aprovacoes.nova_solicitacao',
          sistema: 'aprovacoes',
          mensagem: msg,
          usuario: login,
          ip: req.ip,
          mapaChips: { whatsapp_padrao: [String(numero || '').replace(/\D/g, '')] },
        });
      }
    }).catch(() => {});

    res.json({ sucesso: true, id: aprovacaoId, mensagem: 'Solicitação de aprovação criada com sucesso.' });
  } catch (erro) {
    logErro.error(`Erro ao solicitar aprovação do lançamento #${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao solicitar aprovação do lançamento.' });
  }
});

// ============================================================
// POST /api/financeiro/agendas/:id/contas — Criar conta(s)
// Aceita array de contas para suportar recorrência
// ============================================================
router.post('/api/financeiro/agendas/:id/contas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { contas } = req.body;

  const perm = await getPermissao(pool, id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão para criar contas.' });
  if (!Array.isArray(contas) || contas.length === 0) return res.status(400).json({ erro: 'Nenhuma conta enviada.' });

  try {
    for (const c of contas) {
      if (!c.descricao?.trim()) continue;
      await pool.request()
        .input('agenda_id',      sql.Int,           id)
        .input('descricao',      sql.VarChar,       c.descricao.trim())
        .input('valor',          sql.Decimal(15, 2), parseFloat(c.valor) || 0)
        .input('data',           sql.Date,          c.data || null)
        .input('categoria',      sql.VarChar,       c.categoria || 'Geral')
        .input('empresa',        sql.VarChar,       c.empresa || null)
        .input('frequencia',     sql.VarChar,       c.frequencia || 'Única')
        .input('status',         sql.VarChar,       c.status || 'pendente')
        .input('recorrencia_id', sql.VarChar,       c.recorrencia_id || null)
        .input('eh_pai',         sql.Bit,           c.eh_pai ? 1 : 0)
        .input('criado_por',     sql.VarChar,       usuario)
        .query(`
          INSERT INTO fin_contas
            (agenda_id, descricao, valor, data, categoria, empresa, frequencia, status, recorrencia_id, eh_pai, criado_por)
          VALUES
            (@agenda_id, @descricao, @valor, @data, @categoria, @empresa, @frequencia, @status, @recorrencia_id, @eh_pai, @criado_por)
        `);
    }
    await pool.request()
      .input('agenda_id', sql.Int,     id)
      .input('acao',      sql.VarChar, 'CRIAR')
      .input('detalhes',  sql.VarChar, `${contas.length} conta(s) criada(s)`)
      .input('usuario',   sql.VarChar, usuario)
      .query(`INSERT INTO fin_logs (agenda_id, acao, detalhes, usuario) VALUES (@agenda_id, @acao, @detalhes, @usuario)`);

    // Notificações de email (assíncrono, não bloqueia resposta)
    ;(async () => {
      try {
        const emailsAgenda = await getEmailsAgenda(pool, id);
        const hoje = new Date(); hoje.setHours(0,0,0,0);
        const agendaRow = await pool.request()
          .input('id', sql.Int, id)
          .query('SELECT nome FROM fin_agendas WHERE id=@id');
        const agendaNome = agendaRow.recordset[0]?.nome || '';

        for (const c of contas) {
          if (!c.descricao?.trim()) continue;
          const loginsAgenda = await getLoginsAgenda(pool, id);
          const dados = {
            descricao:   c.descricao.trim(),
            valor:       (parseFloat(c.valor) || 0).toFixed(2),
            data:        c.data || '—',
            agenda_nome: agendaNome,
            criado_por:  usuario,
            email_direto: emailsAgenda,
            logins_agenda: loginsAgenda,
          };
          enviarNotificacao(pool, 'financeiro.nova_conta', dados).catch(() => {});
          enviarWhatsAppFinanceiro(pool, 'financeiro.nova_conta', dados, { usuario, ip: req.ip }).catch(() => {});
          if (c.data) {
            // Compara apenas a parte da data em UTC para evitar problema de fuso horÃ¡rio
            const dataContaStr = new Date(c.data).toISOString().slice(0, 10);
            const hojeStr      = new Date().toISOString().slice(0, 10);
            if (dataContaStr < hojeStr && c.status !== 'pago') {
              enviarNotificacao(pool, 'financeiro.conta_vencida', dados).catch(() => {});
              enviarWhatsAppFinanceiro(pool, 'financeiro.conta_vencida', dados, { usuario, ip: req.ip }).catch(() => {});
            }
          }
        }
      } catch (eEmail) {
        logErro.warn(`[Email financeiro] Erro ao enviar notificaÃ§Ã£o nova_conta: ${eEmail.message}`);
      }
    })();

    const nomeContas = contas.filter(c => c.descricao?.trim()).map(c => c.descricao.trim()).slice(0, 3).join(', ');
    registrarLog(pool, { usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'financeiro', detalhes: `${contas.length} conta(s) criada(s): ${nomeContas}` });
    res.json({ sucesso: true, mensagem: `${contas.length} conta(s) criada(s).` });
  } catch (erro) {
    logErro.error(`Erro ao criar conta: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar conta.' });
  }
});

// ============================================================
// DELETE /api/financeiro/contas/recorrencia/:rid
// DEVE vir ANTES de /contas/:id para nÃ£o conflitar
// ============================================================
router.delete('/api/financeiro/contas/recorrencia/:rid', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const rid     = req.params.rid;

  const c = await pool.request().input('rid', sql.VarChar, rid)
    .query('SELECT TOP 1 agenda_id, descricao FROM fin_contas WHERE recorrencia_id=@rid');
  if (!c.recordset[0]) return res.status(404).json({ erro: 'Grupo nÃ£o encontrado.' });

  const perm = await getPermissao(pool, c.recordset[0].agenda_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  try {
    await pool.request().input('rid', sql.VarChar, rid)
      .query('DELETE FROM fin_contas WHERE recorrencia_id=@rid');
    await pool.request()
      .input('agenda_id', sql.Int,     c.recordset[0].agenda_id)
      .input('acao',      sql.VarChar, 'EXCLUIR')
      .input('detalhes',  sql.VarChar, `Grupo recorrente excluÃ­do: ${c.recordset[0].descricao}`)
      .input('usuario',   sql.VarChar, usuario)
      .query(`INSERT INTO fin_logs (agenda_id, acao, detalhes, usuario) VALUES (@agenda_id, @acao, @detalhes, @usuario)`);
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EXCLUSAO', sistema: 'financeiro', detalhes: `Grupo recorrente excluÃ­do: ${c.recordset[0].descricao}` });
    res.json({ sucesso: true, mensagem: 'Grupo excluÃ­do.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir grupo recorrente: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir grupo.' });
  }
});

// ============================================================
// PUT /api/financeiro/contas/:id — Editar conta
// ============================================================
router.put('/api/financeiro/contas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { descricao, valor, data, categoria, empresa, frequencia, propagarGrupo, recorrencia_id } = req.body;

  const c = await pool.request().input('id', sql.Int, id)
    .query('SELECT agenda_id, descricao FROM fin_contas WHERE id=@id');
  if (!c.recordset[0]) return res.status(404).json({ erro: 'Conta nÃ£o encontrada.' });

  const perm = await getPermissao(pool, c.recordset[0].agenda_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  // EdiÃ§Ã£o de parcela restrita (sem descriÃ§Ã£o) â†’ sÃ³ valor e data
  const somenteValorData = !descricao?.trim();
  if (somenteValorData && !propagarGrupo) {
    // parcela recorrente filha: apenas valor e data
    try {
      await pool.request()
        .input('id',    sql.Int,            id)
        .input('valor', sql.Decimal(15, 2), parseFloat(valor) || 0)
        .input('data',  sql.Date,           data || null)
        .query('UPDATE fin_contas SET valor=@valor, data=@data, atualizado_em=GETDATE() WHERE id=@id');
      res.json({ sucesso: true, mensagem: 'Conta atualizada.' });
    } catch (erro) {
      logErro.error(`Erro ao editar conta: ${erro.message}`);
      res.status(500).json({ erro: 'Erro ao editar conta.' });
    }
    return;
  }

  if (!descricao?.trim()) return res.status(400).json({ erro: 'Informe a descriÃ§Ã£o.' });

  try {
    // Atualiza a conta principal
    await pool.request()
      .input('id',        sql.Int,            id)
      .input('descricao', sql.VarChar,        descricao.trim())
      .input('valor',     sql.Decimal(15, 2), parseFloat(valor) || 0)
      .input('data',      sql.Date,           data || null)
      .input('categoria', sql.VarChar,        categoria || 'Geral')
      .input('empresa',   sql.VarChar,        empresa || null)
      .input('frequencia',sql.VarChar,        frequencia || 'Única')
      .query(`UPDATE fin_contas
              SET descricao=@descricao, valor=@valor, data=@data,
                  categoria=@categoria, empresa=@empresa, frequencia=@frequencia, atualizado_em=GETDATE()
              WHERE id=@id`);

    // Se Ã© pai, propaga descricao/categoria/empresa para as demais parcelas do grupo
    if (propagarGrupo && recorrencia_id) {
      await pool.request()
        .input('rid',       sql.VarChar, recorrencia_id)
        .input('id',        sql.Int,     id)
        .input('categoria', sql.VarChar, categoria || 'Geral')
        .input('empresa',   sql.VarChar, empresa || null)
        .query(`UPDATE fin_contas
                SET categoria=@categoria, empresa=@empresa, atualizado_em=GETDATE()
                WHERE recorrencia_id=@rid AND id<>@id`);
    }

    await pool.request()
      .input('agenda_id', sql.Int,     c.recordset[0].agenda_id)
      .input('conta_id',  sql.Int,     id)
      .input('acao',      sql.VarChar, 'ATUALIZAR')
      .input('detalhes',  sql.VarChar, propagarGrupo ? `Grupo atualizado: ${descricao}` : `Conta atualizada: ${descricao}`)
      .input('usuario',   sql.VarChar, usuario)
      .query(`INSERT INTO fin_logs (agenda_id, conta_id, acao, detalhes, usuario) VALUES (@agenda_id, @conta_id, @acao, @detalhes, @usuario)`);
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'financeiro', detalhes: propagarGrupo ? `Grupo atualizado: ${descricao}` : `Conta editada: ${descricao}` });
    res.json({ sucesso: true, mensagem: propagarGrupo ? 'Grupo atualizado.' : 'Conta atualizada.' });
  } catch (erro) {
    logErro.error(`Erro ao editar conta: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao editar conta.' });
  }
});

// ============================================================
// PATCH /api/financeiro/contas/:id/status — Marcar pago/pendente
// ============================================================
router.patch('/api/financeiro/contas/:id/status', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { status } = req.body;

  if (!['pendente', 'pago', 'lancado'].includes(status))
    return res.status(400).json({ erro: 'Status invÃ¡lido.' });

  const c = await pool.request().input('id', sql.Int, id)
    .query('SELECT agenda_id, descricao FROM fin_contas WHERE id=@id');
  if (!c.recordset[0]) return res.status(404).json({ erro: 'Conta nÃ£o encontrada.' });

  const perm = await getPermissao(pool, c.recordset[0].agenda_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  try {
    await pool.request()
      .input('id',     sql.Int,     id)
      .input('status', sql.VarChar, status)
      .query('UPDATE fin_contas SET status=@status, atualizado_em=GETDATE() WHERE id=@id');
    await pool.request()
      .input('agenda_id', sql.Int,     c.recordset[0].agenda_id)
      .input('conta_id',  sql.Int,     id)
      .input('acao',      sql.VarChar, status === 'lancado' ? 'LANCAMENTO' : 'ATUALIZAR')
      .input('detalhes',  sql.VarChar, status === 'lancado'
        ? `Lançamento registrado: ${c.recordset[0].descricao}`
        : `Status â†’ ${status}: ${c.recordset[0].descricao}`)
      .input('usuario',   sql.VarChar, usuario)
      .query(`INSERT INTO fin_logs (agenda_id, conta_id, acao, detalhes, usuario) VALUES (@agenda_id, @conta_id, @acao, @detalhes, @usuario)`);
    registrarLog(pool, { usuario, ip: req.ip, acao: status === 'lancado' ? 'LANCAMENTO' : 'EDICAO', sistema: 'financeiro', detalhes: status === 'lancado' ? `Lançamento registrado: "${c.recordset[0].descricao}"` : `Status da conta "${c.recordset[0].descricao}" â†’ ${status}` });
    res.json({ sucesso: true, mensagem: 'Status atualizado.' });

    // NotificaÃ§Ãµes de e-mail assÃ­ncronas
    if (status === 'lancado' || status === 'pago') {
      ;(async () => {
        try {
          const emailsAgenda = await getEmailsAgenda(pool, c.recordset[0].agenda_id);
          const agR = await pool.request()
            .input('id', sql.Int, c.recordset[0].agenda_id)
            .query('SELECT nome FROM fin_agendas WHERE id=@id');
          const contaR = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT valor, data FROM fin_contas WHERE id=@id');
          const dados = {
            descricao:    c.recordset[0].descricao,
            valor:        parseFloat(contaR.recordset[0]?.valor || 0).toFixed(2),
            data:         contaR.recordset[0]?.data ? new Date(contaR.recordset[0].data).toLocaleDateString('pt-BR') : '—',
            agenda_nome:  agR.recordset[0]?.nome || '',
            criado_por:   usuario,
            email_direto: emailsAgenda,
            logins_agenda: await getLoginsAgenda(pool, c.recordset[0].agenda_id),
          };
          const tipo = status === 'lancado' ? 'financeiro.lancamento' : 'financeiro.conta_paga';
          enviarNotificacao(pool, tipo, dados).catch(() => {});
          enviarWhatsAppFinanceiro(pool, tipo, dados, { usuario, ip: req.ip }).catch(() => {});
        } catch (eEmail) {
          logErro.warn(`[Email financeiro] Erro ao enviar notif status: ${eEmail.message}`);
        }
      })();
    }
  } catch (erro) {
    logErro.error(`Erro ao atualizar status: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao atualizar status.' });
  }
});

// ============================================================
// DELETE /api/financeiro/contas/:id — Excluir conta
// ============================================================
router.delete('/api/financeiro/contas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const c = await pool.request().input('id', sql.Int, id)
    .query('SELECT agenda_id, descricao, recorrencia_id, eh_pai FROM fin_contas WHERE id=@id');
  if (!c.recordset[0]) return res.status(404).json({ erro: 'Conta nÃ£o encontrada.' });

  const perm = await getPermissao(pool, c.recordset[0].agenda_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  try {
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM fin_contas WHERE id=@id');
    await pool.request()
      .input('agenda_id', sql.Int,     c.recordset[0].agenda_id)
      .input('acao',      sql.VarChar, 'EXCLUIR')
      .input('detalhes',  sql.VarChar, `Conta excluÃ­da: ${c.recordset[0].descricao}`)
      .input('usuario',   sql.VarChar, usuario)
      .query(`INSERT INTO fin_logs (agenda_id, acao, detalhes, usuario) VALUES (@agenda_id, @acao, @detalhes, @usuario)`);
    res.json({ sucesso: true, mensagem: 'Conta excluÃ­da.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir conta: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir conta.' });
  }
});

// ============================================================
// GET /api/financeiro/agendas/:id/categorias
// ============================================================
router.get('/api/financeiro/agendas/:id/categorias', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const perm = await getPermissao(pool, id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso.' });

  try {
    const result = await pool.request().input('agenda_id', sql.Int, id)
      .query('SELECT id, nome FROM fin_categorias WHERE agenda_id=@agenda_id ORDER BY nome');
    res.json({ sucesso: true, categorias: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar categorias: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar categorias.' });
  }
});

// ============================================================
// POST /api/financeiro/agendas/:id/categorias
// ============================================================
router.post('/api/financeiro/agendas/:id/categorias', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { nome } = req.body;

  const perm = await getPermissao(pool, id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });
  if (!nome?.trim())                 return res.status(400).json({ erro: 'Informe o nome.' });

  try {
    const result = await pool.request()
      .input('agenda_id', sql.Int,     id)
      .input('nome',      sql.VarChar, nome.trim())
      .query(`INSERT INTO fin_categorias (agenda_id, nome)
              OUTPUT INSERTED.id, INSERTED.nome
              VALUES (@agenda_id, @nome)`);
    res.json({ sucesso: true, mensagem: 'Categoria criada.', categoria: result.recordset[0] });
  } catch (erro) {
    logErro.error(`Erro ao criar categoria: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar categoria.' });
  }
});

// ============================================================
// DELETE /api/financeiro/categorias/:id
// ============================================================
router.delete('/api/financeiro/categorias/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const c = await pool.request().input('id', sql.Int, id)
    .query('SELECT agenda_id, nome FROM fin_categorias WHERE id=@id');
  if (!c.recordset[0]) return res.status(404).json({ erro: 'Categoria nÃ£o encontrada.' });

  const perm = await getPermissao(pool, c.recordset[0].agenda_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  try {
    await pool.request()
      .input('nome', sql.VarChar, c.recordset[0].nome)
      .query("UPDATE fin_contas SET categoria='Geral' WHERE categoria=@nome AND agenda_id=(SELECT agenda_id FROM fin_categorias WHERE nome=@nome)");
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM fin_categorias WHERE id=@id');
    res.json({ sucesso: true, mensagem: 'Categoria excluÃ­da.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir categoria: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir categoria.' });
  }
});

// ============================================================
// GET /api/financeiro/agendas/:id/empresas
// ============================================================
router.get('/api/financeiro/agendas/:id/empresas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const perm = await getPermissao(pool, id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso.' });

  try {
    const result = await pool.request().input('agenda_id', sql.Int, id)
      .query('SELECT id, nome FROM fin_empresas WHERE agenda_id=@agenda_id ORDER BY nome');
    res.json({ sucesso: true, empresas: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar empresas: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar empresas.' });
  }
});

// ============================================================
// POST /api/financeiro/agendas/:id/empresas
// ============================================================
router.post('/api/financeiro/agendas/:id/empresas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { nome } = req.body;

  const perm = await getPermissao(pool, id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });
  if (!nome?.trim())                 return res.status(400).json({ erro: 'Informe o nome.' });

  try {
    const result = await pool.request()
      .input('agenda_id', sql.Int,     id)
      .input('nome',      sql.VarChar, nome.trim())
      .query(`INSERT INTO fin_empresas (agenda_id, nome)
              OUTPUT INSERTED.id, INSERTED.nome
              VALUES (@agenda_id, @nome)`);
    res.json({ sucesso: true, mensagem: 'Empresa criada.', empresa: result.recordset[0] });
  } catch (erro) {
    logErro.error(`Erro ao criar empresa: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar empresa.' });
  }
});

// ============================================================
// DELETE /api/financeiro/empresas/:id
// ============================================================
router.delete('/api/financeiro/empresas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const e = await pool.request().input('id', sql.Int, id)
    .query('SELECT agenda_id, nome FROM fin_empresas WHERE id=@id');
  if (!e.recordset[0]) return res.status(404).json({ erro: 'Empresa nÃ£o encontrada.' });

  const perm = await getPermissao(pool, e.recordset[0].agenda_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  try {
    await pool.request()
      .input('nome',      sql.VarChar, e.recordset[0].nome)
      .input('agenda_id', sql.Int,     e.recordset[0].agenda_id)
      .query('UPDATE fin_contas SET empresa=NULL WHERE empresa=@nome AND agenda_id=@agenda_id');
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM fin_empresas WHERE id=@id');
    res.json({ sucesso: true, mensagem: 'Empresa excluÃ­da.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir empresa: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir empresa.' });
  }
});

// ============================================================
// GET /api/financeiro/agendas/:id/logs — Auditoria
// ============================================================
router.get('/api/financeiro/agendas/:id/logs', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const perm = await getPermissao(pool, id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso.' });

  try {
    const result = await pool.request()
      .input('agenda_id', sql.Int, id)
      .query(`
        SELECT TOP 100 l.id, l.conta_id, l.acao, l.detalhes, l.usuario, l.data_hora,
               c.descricao AS descricao_conta
        FROM fin_logs l
        LEFT JOIN fin_contas c ON c.id = l.conta_id
        WHERE l.agenda_id = @agenda_id
        ORDER BY l.data_hora DESC
      `);
    res.json({ sucesso: true, logs: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao buscar logs: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar logs.' });
  }
});

// ============================================================
// GET /agendaFinanceira/relatorios — Serve a pÃ¡gina de relatÃ³rios
// ============================================================
router.get('/agendaFinanceira/relatorios', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agendaFinanceira/relatoriosFinanceiro.html'));
});

// ============================================================
// GET /api/financeiro/relatorios — Dados para relatÃ³rios
// ============================================================
router.get('/api/financeiro/relatorios', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const { tipo, dataInicio, dataFim, agenda_id: agId, agenda_ids: agIds, categoria, empresa, status, page } = req.query;

  // Se uma agenda especÃ­fica for selecionada, verificar permissÃ£o
  if (agId) {
    const perm = await getPermissao(pool, parseInt(agId), usuario);
    if (!perm) return res.status(403).json({ erro: 'Sem acesso Ã  agenda.' });
  }

  // Parsear mÃºltiplos IDs de agendas (validar que sÃ£o nÃºmeros)
  let agendaIdsFiltro = [];
  if (agIds) {
    agendaIdsFiltro = agIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id) && id > 0);
  }

  const baseFrom = 'FROM fin_contas c JOIN fin_agendas a ON a.id = c.agenda_id';

  // Cria request parametrizado com todos os filtros ativos
  function mkReq(extraConds = []) {
    const r = pool.request().input('usuario', sql.VarChar, usuario);
    const conds = ['(a.dono=@usuario OR EXISTS (SELECT 1 FROM fin_membros m WHERE m.agenda_id=a.id AND m.usuario=@usuario))'];
    if (agendaIdsFiltro.length > 0)   { conds.push(`a.id IN (${agendaIdsFiltro.join(',')})`); }
    else if (agId)                    { r.input('agenda_id',  sql.Int,     parseInt(agId)); conds.push('a.id=@agenda_id'); }
    if (dataInicio)                   { r.input('dataInicio', sql.Date,    dataInicio);     conds.push('c.data>=@dataInicio'); }
    if (dataFim)                      { r.input('dataFim',    sql.Date,    dataFim);        conds.push('c.data<=@dataFim'); }
    if (categoria)                    { r.input('categoria',  sql.VarChar, categoria);      conds.push('c.categoria=@categoria'); }
    if (empresa)                      { r.input('empresa',    sql.VarChar, empresa);        conds.push('c.empresa=@empresa'); }
    if (status && status !== 'todos') { r.input('status',     sql.VarChar, status);         conds.push('c.status=@status'); }
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
        SELECT c.id, a.nome AS agenda_nome, c.descricao, c.valor, c.data,
               c.categoria, c.empresa, c.frequencia, c.status, c.criado_por, c.criado_em
        ${baseFrom} ${w2}
        ORDER BY c.data ASC, c.criado_em ASC
        OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY
      `);
      return res.json({ total, pagina: pg, por_pagina: 50, contas: dataR.recordset });
    }

    // Resumido
    const { r: rRes, where } = mkReq();
    const resumoR = await rRes.query(`
      SELECT
        COUNT(*) AS total,
        ISNULL(SUM(c.valor), 0) AS total_valor,
        SUM(CASE WHEN c.status='pendente' THEN 1 ELSE 0 END) AS pendentes,
        ISNULL(SUM(CASE WHEN c.status='pendente' THEN c.valor ELSE 0 END), 0) AS valor_pendente,
        SUM(CASE WHEN c.status='pago' THEN 1 ELSE 0 END) AS pagos,
        ISNULL(SUM(CASE WHEN c.status='pago' THEN c.valor ELSE 0 END), 0) AS valor_pago,
        SUM(CASE WHEN c.status='pendente' AND c.data < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS vencidos,
        ISNULL(SUM(CASE WHEN c.status='pendente' AND c.data < CAST(GETDATE() AS DATE) THEN c.valor ELSE 0 END), 0) AS valor_vencido
      ${baseFrom} ${where}
    `);

    const { r: rCat, where: wCat } = mkReq();
    const catR = await rCat.query(`
      SELECT c.categoria, COUNT(*) AS total, ISNULL(SUM(c.valor), 0) AS valor
      ${baseFrom} ${wCat}
      GROUP BY c.categoria
      ORDER BY SUM(c.valor) DESC
    `);

    const { r: rEmp, where: wEmp } = mkReq(['c.empresa IS NOT NULL']);
    const empR = await rEmp.query(`
      SELECT c.empresa, COUNT(*) AS total, ISNULL(SUM(c.valor), 0) AS valor
      ${baseFrom} ${wEmp}
      GROUP BY c.empresa
      ORDER BY SUM(c.valor) DESC
    `);

    return res.json({
      resumo:        resumoR.recordset[0],
      por_categoria: catR.recordset,
      por_empresa:   empR.recordset
    });
  } catch (erro) {
    logErro.error(`Erro ao gerar relatorio financeiro: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao gerar relatorio.' });
  }
});

// ============================================================
// GET /api/financeiro/usuarios — Para seletor de membros
// ============================================================
router.get('/api/financeiro/usuarios', verificarLogin, async (req, res) => {
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
    logErro.error(`Erro ao listar usuÃ¡rios: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar usuÃ¡rios.' });
  }
});

// ============================================================
// GET /api/financeiro/config — ConfiguraÃ§Ãµes pÃºblicas do mÃ³dulo
// ============================================================
router.get('/api/financeiro/config', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const r = await pool.request()
      .query(`SELECT chave, valor FROM configuracoes WHERE grupo = 'financeiro'`);
    const config = {};
    r.recordset.forEach(row => { config[row.chave] = row.valor; });
    res.json({ sucesso: true, config });
  } catch (erro) {
    res.json({ sucesso: true, config: {} });
  }
});

// ============================================================
// POST /api/financeiro/config — Salva dias_lembrete (admin)
// ============================================================
router.post('/api/financeiro/config', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario;
  if (usuario.nivel !== 'admin') return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  const dias = parseInt(req.body.dias_lembrete);
  if (isNaN(dias) || dias < 1) return res.status(400).json({ erro: 'Valor invÃ¡lido.' });

  try {
    await pool.request()
      .input('chave', sql.VarChar, 'financeiro.dias_lembrete')
      .input('valor', sql.VarChar, String(dias))
      .query(`
        IF EXISTS (SELECT 1 FROM configuracoes WHERE chave = @chave)
          UPDATE configuracoes SET valor = @valor WHERE chave = @chave
        ELSE
          INSERT INTO configuracoes (chave, valor, grupo, descricao)
          VALUES (@chave, @valor, 'financeiro', 'Dias de antecedÃªncia para lembrete de vencimento')
      `);
    res.json({ sucesso: true });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao salvar.' });
  }
});

module.exports = router;



