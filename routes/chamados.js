/**
 * ARQUIVO: routes/chamados.js
 * VERSÃO:  1.0.0
 * DATA:    2026-03-04
 * DESCRIÇÃO: Rotas do sistema de Chamados integrado ao Portal WKL
 *
 * Papéis no chamados (independentes do nível do portal):
 *   ADMIN    → portal admin (nivel='admin') — acesso total
 *   GESTOR   → pode aprovar/reprovar, reabrir, ver todos os chamados de seus setores
 *   TECNICO  → aceita, mensagem, finaliza, transfere, solicita aprovação
 *   SOLICITANTE → cria chamados e acompanha os seus (padrão)
 */

const express = require('express');
const path    = require('path');
const router  = express.Router();
const sql     = require('mssql');
const { enviarNotificacao } = require('../services/emailService');
const { registrarLog }     = require('../services/logService');

// ── Middleware ─────────────────────────────────────────────────
function verificarLogin(req, res, next) {
  if (!req.session?.usuario) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ erro: 'Não autenticado' });
    return res.redirect('/login.html');
  }
  next();
}

// ── Helpers ────────────────────────────────────────────────────

/** Retorna perfil chamados do usuário logado */
async function getPerfil(pool, login, nivelPortal) {
  if (nivelPortal === 'admin') return { cargo: 'ADMIN', setores: [] };
  const r = await pool.request()
    .input('login', sql.VarChar, login)
    .query('SELECT cargo, setores FROM chamados_perfis WHERE login = @login');
  if (!r.recordset.length) return { cargo: 'SOLICITANTE', setores: [] };
  return {
    cargo:   r.recordset[0].cargo,
    setores: JSON.parse(r.recordset[0].setores || '[]')
  };
}

/** Verifica se o usuário pode visualizar um chamado */
function podeVer(perfil, login, chamado) {
  if (perfil.cargo === 'ADMIN') return true;
  if (chamado.login_solicitante === login) return true;
  if (['TECNICO', 'GESTOR'].includes(perfil.cargo)) {
    return perfil.setores.length === 0 || perfil.setores.includes(chamado.setor);
  }
  return false;
}

/** Gera/atualiza o contador de protocolo por setor */
async function gerarProtocolo(pool, setor) {
  const setor3 = setor.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 3).padEnd(3, 'X');
  const r = await pool.request()
    .input('setor', sql.VarChar, setor)
    .query('SELECT cont FROM chamados_contadores WHERE setor = @setor');
  let cont;
  if (r.recordset.length) {
    cont = r.recordset[0].cont + 1;
    await pool.request()
      .input('setor', sql.VarChar, setor)
      .input('cont',  sql.Int,     cont)
      .query('UPDATE chamados_contadores SET cont = @cont WHERE setor = @setor');
  } else {
    cont = 1;
    await pool.request()
      .input('setor', sql.VarChar, setor)
      .query("INSERT INTO chamados_contadores (setor, cont) VALUES (@setor, 1)");
  }
  return `${setor3}-${String(cont).padStart(3, '0')}`;
}

/** Insere entrada no histórico */
async function addHistorico(pool, chamadoId, login, narrativa, msg = null) {
  await pool.request()
    .input('chamado_id', sql.Int,     chamadoId)
    .input('login',      sql.VarChar, login)
    .input('narrativa',  sql.VarChar, narrativa)
    .input('msg',        sql.VarChar, msg)
    .query(`INSERT INTO chamados_historico (chamado_id, login, narrativa, msg)
            VALUES (@chamado_id, @login, @narrativa, @msg)`);
}

/** Formata e envia notificação Telegram para um evento de chamado (fire-and-forget) */
async function enviarNotificacaoTelegram(pool, logErro, chamado, evento) {
  try {
    const r = await pool.request()
      .query("SELECT chave, valor FROM configuracoes WHERE grupo='chamados_telegram'");
    const cfg = {};
    r.recordset.forEach(row => { cfg[row.chave] = row.valor; });

    const token = cfg['chamados_tg_token'];
    if (!token) return;

    const statuses = JSON.parse(cfg['chamados_tg_statuses'] || '[]');
    if (!statuses.includes(evento)) return;

    const chatId = cfg[`chamados_tg_map_${chamado.setor}`];
    if (!chatId) return;

    const labels = {
      'Aberto':         '🆕 NOVO CHAMADO',
      'Em Atendimento': '🔧 EM ATENDIMENTO',
      'Respondido':     '💬 RESPONDIDO',
      'Finalizado':     '✅ FINALIZADO',
      'Reaberto':       '🔄 REABERTO',
      'TRANSFERIDO':    '🔀 TRANSFERIDO',
      'APROVACAO':      '⏳ AGUARD. APROVAÇÃO',
      'APROVADO':       '✔️ APROVADO',
      'REPROVADO':      '❌ REPROVADO',
    };
    const titulo = labels[evento] || evento;
    const texto = `*${titulo}*\n\n` +
      `📋 *Protocolo:* \`${chamado.protocolo}\`\n` +
      `📁 *Setor:* ${chamado.setor}\n` +
      `📝 *Assunto:* ${String(chamado.assunto || '').substring(0, 100)}\n` +
      `👤 *Solicitante:* ${chamado.nome_solicitante || '—'}`;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown' })
    });
  } catch (e) {
    if (logErro?.error) logErro.error(`Telegram chamados: ${e.message}`);
  }
}

/** Busca email de um login em usuarios_dominio */
async function buscarEmail(pool, login) {
  if (!login) return null;
  try {
    const r = await pool.request().input('login', sql.VarChar, login)
      .query('SELECT email FROM usuarios_dominio WHERE login = @login AND ativo = 1');
    return r.recordset[0]?.email || null;
  } catch (e) { return null; }
}

/** Busca emails dos perfis do setor com cargo especificado */
async function buscarEmailsSetor(pool, setor, cargos) {
  try {
    const lista = cargos.map(c => `'${c}'`).join(',');
    const r = await pool.request()
      .query(`SELECT p.login, p.setores, ud.email FROM chamados_perfis p
              LEFT JOIN usuarios_dominio ud ON ud.login = p.login AND ud.ativo = 1
              WHERE p.cargo IN (${lista}) AND ud.email IS NOT NULL`);
    return r.recordset
      .filter(row => {
        const s = JSON.parse(row.setores || '[]');
        return s.length === 0 || s.includes(setor);
      })
      .map(row => row.email).filter(Boolean);
  } catch (e) { return []; }
}

/** Envia notificação por email para um evento de chamado (fire-and-forget) */
async function enviarNotificacaoEmail(pool, logErro, chamado, evento) {
  console.log(`[Email chamados] enviarNotificacaoEmail chamada: evento=${evento} setor=${chamado?.setor} protocolo=${chamado?.protocolo}`);
  try {
    const mapa = {
      'Aberto':         'chamados.novo',
      'Em Atendimento': 'chamados.atribuido',
      'Respondido':     'chamados.nova_mensagem',
      'Finalizado':     'chamados.concluido',
      'Reaberto':       'chamados.reaberto',
      'TRANSFERIDO':    'chamados.transferido',
      'APROVACAO':      'chamados.aprovacao_solicitada',
      'APROVADO':       'chamados.aprovacao_concluida',
      'REPROVADO':      'chamados.aprovacao_concluida',
    };
    const tipo = mapa[evento];
    if (!tipo) return;

    const [email_tecnicos, email_gestores, email_solicitante, email_tecnico, email_aprovador] = await Promise.all([
      buscarEmailsSetor(pool, chamado.setor, ['TECNICO']),
      buscarEmailsSetor(pool, chamado.setor, ['GESTOR']),
      buscarEmail(pool, chamado.login_solicitante),
      buscarEmail(pool, chamado.login_atendedor),
      buscarEmail(pool, chamado.aprovador_login),
    ]);

    await enviarNotificacao(pool, tipo, {
      ...chamado,
      email_tecnicos,
      email_gestores,
      email_solicitante,
      email_tecnico,
      email_aprovador,
      aprovado: evento === 'APROVADO',
      observacao: chamado.justificativa,
    });
  } catch (e) {
    if (logErro?.error) logErro.error(`Email chamados [${evento}]: ${e.message}`);
  }
}

// ============================================================
// PÁGINAS
// ============================================================

router.get('/chamados', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/chamados/index.html'));
});

router.get('/chamados/configuracoes', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/chamados/configuracoes.html'));
});

router.get('/chamados/integracao', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/chamados/integracao.html'));
});

router.get('/chamados/telegram', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/chamados/telegram.html'));
});

router.get('/chamados/tv', verificarLogin, (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/chamados/tv.html'));
});

router.get('/chamados/relatorios', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/chamados/relatoriosChamados.html'));
});

// ============================================================
// MEU PERFIL
// ============================================================

router.get('/api/chamados/meu-perfil', verificarLogin, async (req, res) => {
  try {
    const u     = req.session.usuario;
    const login = u.usuario || u.login;
    const perf  = await getPerfil(req.app.locals.pool, login, u.nivel);
    res.json({ login, nome: u.nome, nivel: u.nivel, ...perf });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============================================================
// SETORES
// ============================================================

router.get('/api/chamados/setores', verificarLogin, async (req, res) => {
  try {
    const r = await req.app.locals.pool.request()
      .query('SELECT id, nome FROM chamados_setores ORDER BY nome');
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/api/chamados/setores', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const u    = req.session.usuario;
    const perf = await getPerfil(pool, u.usuario || u.login, u.nivel);
    if (!['ADMIN', 'GESTOR'].includes(perf.cargo))
      return res.status(403).json({ erro: 'Sem permissão' });
    const nome = req.body.nome?.trim();
    if (!nome) return res.status(400).json({ erro: 'Nome obrigatório' });
    const r = await pool.request()
      .input('nome', sql.VarChar, nome)
      .query('INSERT INTO chamados_setores (nome) OUTPUT INSERTED.id VALUES (@nome)');
    res.json({ id: r.recordset[0].id, nome });
  } catch (e) {
    if (e.number === 2627 || e.number === 2601)
      return res.status(400).json({ erro: 'Setor já existe' });
    res.status(500).json({ erro: e.message });
  }
});

router.put('/api/chamados/setores/:id', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const u    = req.session.usuario;
    const perf = await getPerfil(pool, u.usuario || u.login, u.nivel);
    if (perf.cargo !== 'ADMIN') return res.status(403).json({ erro: 'Sem permissão' });
    const nome = req.body.nome?.trim();
    if (!nome) return res.status(400).json({ erro: 'Nome obrigatório' });
    await pool.request()
      .input('id',   sql.Int,     parseInt(req.params.id))
      .input('nome', sql.VarChar, nome)
      .query('UPDATE chamados_setores SET nome=@nome WHERE id=@id');
    res.json({ ok: true });
  } catch (e) {
    if (e.number === 2627 || e.number === 2601)
      return res.status(400).json({ erro: 'Setor já existe' });
    res.status(500).json({ erro: e.message });
  }
});

router.delete('/api/chamados/setores/:id', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const u    = req.session.usuario;
    const perf = await getPerfil(pool, u.usuario || u.login, u.nivel);
    if (perf.cargo !== 'ADMIN') return res.status(403).json({ erro: 'Sem permissão' });
    await pool.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .query('DELETE FROM chamados_setores WHERE id = @id');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============================================================
// USUÁRIOS / PERFIS
// ============================================================

/** Todos os usuários do portal (para dropdowns e gestão de perfis) */
router.get('/api/chamados/usuarios-portal', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const loc  = await pool.request()
      .query("SELECT usuario AS login, nome, nivel FROM usuarios WHERE ativo=1 AND usuario<>'admin'");
    const dom  = await pool.request()
      .query("SELECT login, ISNULL(nome,login) AS nome, nivel FROM usuarios_dominio WHERE ativo=1");
    res.json([...loc.recordset, ...dom.recordset]);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

/** Lista perfis configurados (somente ADMIN) */
router.get('/api/chamados/perfis', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const u    = req.session.usuario;
    const perf = await getPerfil(pool, u.usuario || u.login, u.nivel);
    if (perf.cargo !== 'ADMIN') return res.status(403).json({ erro: 'Sem permissão' });
    const r = await pool.request()
      .query('SELECT login, cargo, setores FROM chamados_perfis ORDER BY login');
    res.json(r.recordset.map(row => ({
      ...row,
      setores: JSON.parse(row.setores || '[]')
    })));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

/** Upsert de perfil (somente ADMIN) */
router.put('/api/chamados/perfis/:login', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const u    = req.session.usuario;
    const perf = await getPerfil(pool, u.usuario || u.login, u.nivel);
    if (perf.cargo !== 'ADMIN') return res.status(403).json({ erro: 'Sem permissão' });
    const { cargo, setores } = req.body;
    const setoresJson = JSON.stringify(Array.isArray(setores) ? setores : []);
    await pool.request()
      .input('login',   sql.VarChar, req.params.login)
      .input('cargo',   sql.VarChar, cargo)
      .input('setores', sql.VarChar, setoresJson)
      .query(`IF EXISTS (SELECT 1 FROM chamados_perfis WHERE login = @login)
                UPDATE chamados_perfis SET cargo=@cargo, setores=@setores WHERE login=@login
              ELSE
                INSERT INTO chamados_perfis (login, cargo, setores) VALUES (@login, @cargo, @setores)`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============================================================
// USUÁRIOS DO DOMÍNIO (leitura para exibição no painel)
// ============================================================

router.get('/api/chamados/usuarios-dominio', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const u    = req.session.usuario;
    const perf = await getPerfil(pool, u.usuario || u.login, u.nivel);
    if (perf.cargo !== 'ADMIN') return res.status(403).json({ erro: 'Sem permissão' });
    const r = await pool.request()
      .query('SELECT login, nome, email, departamento, ativo FROM usuarios_dominio ORDER BY nome');
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

/** Cria setores do chamados a partir dos departamentos dos usuários de domínio */
router.post('/api/chamados/sincronizar-setores-dominio', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const u    = req.session.usuario;
    const perf = await getPerfil(pool, u.usuario || u.login, u.nivel);
    if (perf.cargo !== 'ADMIN') return res.status(403).json({ erro: 'Sem permissão' });

    const r = await pool.request().query(`
      SELECT DISTINCT UPPER(LTRIM(RTRIM(departamento))) AS dep
      FROM usuarios_dominio
      WHERE ativo = 1
        AND departamento IS NOT NULL
        AND LTRIM(RTRIM(departamento)) <> ''
    `);

    let criados = 0;
    for (const row of r.recordset) {
      await pool.request()
        .input('nome', sql.VarChar, row.dep)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM chamados_setores WHERE nome = @nome)
            INSERT INTO chamados_setores (nome) VALUES (@nome)
        `);
      criados++;
    }

    res.json({ ok: true, criados, total: r.recordset.length });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============================================================
// ============================================================
// CHAMADOS — NOTIFICAÇÕES
// ============================================================
router.get('/api/chamados/notificacoes', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const u       = req.session.usuario;
  const login   = u.usuario || u.login;

  try {
    const perfil = await getPerfil(pool, login, u.nivel);
    const result = { abertos: [], reabertos: [], transferidos: [], aprovados: [], pendentes: [], aprovacoes: [], respondidos: [] };

    // Monta cláusula de setor (setores do técnico/gestor)
    const setoresCond = (perfil.setores.length > 0 && perfil.cargo !== 'ADMIN')
      ? `AND setor IN (${perfil.setores.map(s => `'${String(s).replace(/'/g, "''")}'`).join(',')})`
      : '';

    if (['ADMIN', 'GESTOR', 'TECNICO'].includes(perfil.cargo)) {
      // Chamados Abertos no setor
      const ab = await pool.request().query(`
        SELECT TOP 10 id, protocolo, assunto, setor, criado_em
        FROM chamados WHERE status='Aberto' AND (excluido IS NULL OR excluido=0) ${setoresCond}
        ORDER BY criado_em DESC
      `);
      result.abertos = ab.recordset;

      // Chamados Reabertos no setor
      const re = await pool.request().query(`
        SELECT TOP 10 id, protocolo, assunto, setor, atualizado_em
        FROM chamados WHERE status='Reaberto' AND (excluido IS NULL OR excluido=0) ${setoresCond}
        ORDER BY atualizado_em DESC
      `);
      result.reabertos = re.recordset;

      // Chamados Transferidos para o setor
      const tr = await pool.request().query(`
        SELECT TOP 10 id, protocolo, assunto, setor, atualizado_em
        FROM chamados WHERE status='TRANSFERIDO' AND (excluido IS NULL OR excluido=0) ${setoresCond}
        ORDER BY atualizado_em DESC
      `);
      result.transferidos = tr.recordset;

      // Chamados Aprovados aguardando aceite do técnico
      const apv = await pool.request().query(`
        SELECT TOP 10 id, protocolo, assunto, setor, atualizado_em
        FROM chamados WHERE status='APROVADO' AND (excluido IS NULL OR excluido=0) ${setoresCond}
        ORDER BY atualizado_em DESC
      `);
      result.aprovados = apv.recordset;

      // Mensagens pendentes: tecnico atribuído + último histórico é do solicitante
      const pe = await pool.request()
        .input('login', sql.VarChar, login)
        .query(`
          SELECT TOP 10 c.id, c.protocolo, c.assunto, c.setor, c.atualizado_em
          FROM chamados c
          WHERE c.status = 'Em Atendimento'
            AND (c.excluido IS NULL OR c.excluido=0)
            AND c.login_atendedor = @login
            AND EXISTS (
              SELECT 1 FROM chamados_historico h
              WHERE h.chamado_id = c.id
                AND h.login = c.login_solicitante
                AND h.criado_em = (
                  SELECT MAX(h2.criado_em) FROM chamados_historico h2
                  WHERE h2.chamado_id = c.id
                )
            )
          ORDER BY c.atualizado_em DESC
        `);
      result.pendentes = pe.recordset;
    }

    // Aprovações pendentes (GESTOR/ADMIN que precisam aprovar)
    if (['ADMIN', 'GESTOR'].includes(perfil.cargo)) {
      const loginEsc = login.replace(/'/g, "''");
      const ap = await pool.request().query(`
        SELECT TOP 10 id, protocolo, assunto, setor, atualizado_em, nome_solicitante
        FROM chamados
        WHERE status = 'APROVACAO'
          AND (excluido IS NULL OR excluido=0)
          AND (aprovador_login = '${loginEsc}' OR '${perfil.cargo}' = 'ADMIN')
        ORDER BY atualizado_em DESC
      `);
      result.aprovacoes = ap.recordset;
    }

    // Para SOLICITANTE: seus chamados onde tecnico respondeu (aguardando feedback)
    if (perfil.cargo === 'SOLICITANTE') {
      const resp = await pool.request()
        .input('login', sql.VarChar, login)
        .query(`
          SELECT TOP 10 id, protocolo, assunto, setor, atualizado_em
          FROM chamados
          WHERE status = 'Respondido' AND (excluido IS NULL OR excluido=0) AND login_solicitante = @login
          ORDER BY atualizado_em DESC
        `);
      result.respondidos = resp.recordset;
    }

    const total = result.abertos.length + result.reabertos.length +
                  result.transferidos.length + result.aprovados.length +
                  result.pendentes.length + result.aprovacoes.length +
                  result.respondidos.length;
    res.json({ ...result, total });
  } catch (erro) {
    logErro.error(`Erro ao buscar notificações: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao buscar notificações.' });
  }
});

// ============================================================
// CHAMADOS — LISTAR
// ============================================================

router.get('/api/chamados/lista', verificarLogin, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const u      = req.session.usuario;
    const login  = u.usuario || u.login;
    const perf   = await getPerfil(pool, login, u.nivel);
    const { status, setor, busca } = req.query;

    // Visibilidade baseada em cargo
    let where;
    const loginEsc = login.replace(/'/g, "''");
    if (perf.cargo === 'ADMIN') {
      where = 'WHERE 1=1';
    } else if (['TECNICO', 'GESTOR'].includes(perf.cargo) && perf.setores.length > 0) {
      const list = perf.setores.map(s => `'${s.replace(/'/g, "''")}'`).join(',');
      where = `WHERE (setor IN (${list}) OR login_solicitante='${loginEsc}')`;
    } else if (['TECNICO', 'GESTOR'].includes(perf.cargo)) {
      where = 'WHERE 1=1'; // sem setor configurado → vê tudo
    } else {
      where = `WHERE login_solicitante='${loginEsc}'`;
    }

    // Sempre oculta excluídos na listagem normal
    where += ` AND (excluido IS NULL OR excluido=0)`;

    if (status && status !== 'todos') {
      if (status === 'ativos')
        where += ` AND status NOT IN ('Finalizado','REPROVADO')`;
      else
        where += ` AND status='${status.replace(/'/g, "''")}'`;
    }
    if (setor) where += ` AND setor='${setor.replace(/'/g, "''")}'`;
    if (busca) {
      const b = busca.replace(/'/g, "''");
      where += ` AND (protocolo LIKE '%${b}%' OR assunto LIKE '%${b}%' OR nome_solicitante LIKE '%${b}%')`;
    }

    const r = await pool.request().query(`
      SELECT id, protocolo, setor, assunto, status,
             nome_solicitante, nome_atendedor, criado_em, atualizado_em,
             ISNULL(bloqueado,0) AS bloqueado, chamado_pai_id
      FROM chamados ${where}
      ORDER BY atualizado_em DESC
    `);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============================================================
// CHAMADOS — CRIAR
// ============================================================

router.post('/api/chamados', verificarLogin, async (req, res) => {
  try {
    const pool  = req.app.locals.pool;
    const u     = req.session.usuario;
    const login = u.usuario || u.login;
    const { setor, assunto, detalhe, anexo_nome, anexo_base64 } = req.body;

    if (!setor || !assunto?.trim())
      return res.status(400).json({ erro: 'Setor e assunto são obrigatórios' });

    const protocolo = await gerarProtocolo(pool, setor);

    const r = await pool.request()
      .input('protocolo',          sql.VarChar, protocolo)
      .input('login_solicitante',  sql.VarChar, login)
      .input('nome_solicitante',   sql.VarChar, u.nome || login)
      .input('setor',              sql.VarChar, setor)
      .input('assunto',            sql.VarChar, assunto.trim())
      .input('detalhe',            sql.VarChar, detalhe || null)
      .input('anexo_nome',         sql.VarChar, anexo_nome || null)
      .input('anexo_base64',       sql.VarChar, anexo_base64 || null)
      .query(`INSERT INTO chamados
               (protocolo, login_solicitante, nome_solicitante, setor, assunto, detalhe, status, anexo_nome, anexo_base64)
              OUTPUT INSERTED.id
              VALUES (@protocolo,@login_solicitante,@nome_solicitante,@setor,@assunto,@detalhe,'Aberto',@anexo_nome,@anexo_base64)`);

    const id = r.recordset[0].id;
    await addHistorico(pool, id, login, `${u.nome || login} abriu o chamado`, detalhe || null);
    const _cNotifNovo = { protocolo, setor, assunto: assunto.trim(), nome_solicitante: u.nome || login, login_solicitante: login };
    enviarNotificacaoTelegram(pool, req.app.locals.logErro, _cNotifNovo, 'Aberto').catch(() => {});
    enviarNotificacaoEmail(pool, req.app.locals.logErro, _cNotifNovo, 'Aberto').catch(() => {});
    registrarLog(pool, { usuario: login, ip: req.ip, acao: 'CRIACAO', sistema: 'chamados', detalhes: `Chamado #${protocolo} criado — ${assunto.trim()} [${setor}]` });
    res.json({ id, protocolo });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============================================================
// RELATÓRIOS  (deve vir ANTES de /:id)
// ============================================================

/** Lista técnicos e gestores para o filtro */
router.get('/api/chamados/tecnicos', verificarLogin, async (req, res) => {
  try {
    const pool  = req.app.locals.pool;
    const u     = req.session.usuario;
    const login = u.usuario || u.login;
    const perf  = await getPerfil(pool, login, u.nivel);
    if (!['ADMIN', 'GESTOR'].includes(perf.cargo))
      return res.status(403).json({ erro: 'Sem permissão' });
    const r = await pool.request().query(`
      SELECT p.login, ISNULL(u.nome, p.login) AS nome, p.cargo
      FROM chamados_perfis p
      LEFT JOIN usuarios_portal u ON u.login = p.login
      WHERE p.cargo IN ('TECNICO','GESTOR','ADMIN')
      ORDER BY nome
    `);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

/** Dados do relatório */
router.get('/api/chamados/relatorios', verificarLogin, async (req, res) => {
  try {
    const pool  = req.app.locals.pool;
    const u     = req.session.usuario;
    const login = u.usuario || u.login;
    const perf  = await getPerfil(pool, login, u.nivel);
    if (!['ADMIN', 'GESTOR'].includes(perf.cargo))
      return res.status(403).json({ erro: 'Acesso restrito a ADMIN e GESTOR' });

    const { dataInicio, dataFim, setor, tecnico, status, tipo, incluirExcluidos } = req.query;

    const conds = [];
    if (incluirExcluidos !== 'true') conds.push('(c.excluido IS NULL OR c.excluido=0)');
    if (dataInicio && /^\d{4}-\d{2}-\d{2}$/.test(dataInicio))
      conds.push(`CAST(c.criado_em AS DATE) >= '${dataInicio}'`);
    if (dataFim && /^\d{4}-\d{2}-\d{2}$/.test(dataFim))
      conds.push(`CAST(c.criado_em AS DATE) <= '${dataFim}'`);
    if (setor)   conds.push(`c.setor = '${setor.replace(/'/g,"''")}'`);
    if (tecnico) conds.push(`c.login_atendedor = '${tecnico.replace(/'/g,"''")}'`);
    if (status) {
      const sl = status.split(',').map(s=>`'${s.trim().replace(/'/g,"''")}'`).join(',');
      conds.push(`c.status IN (${sl})`);
    }
    if (perf.cargo === 'GESTOR' && perf.setores.length > 0) {
      const sl = perf.setores.map(s=>`'${s.replace(/'/g,"''")}'`).join(',');
      conds.push(`c.setor IN (${sl})`);
    }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    if (tipo === 'detalhado') {
      const r = await pool.request().query(`
        SELECT c.id, c.protocolo, c.setor, c.assunto, c.status,
               c.nome_solicitante, ISNULL(c.nome_atendedor,'—') AS nome_atendedor,
               c.criado_em, c.atualizado_em,
               DATEDIFF(minute, c.criado_em,
                 CASE WHEN c.status IN ('Finalizado','REPROVADO') THEN c.atualizado_em
                      ELSE GETDATE() END) AS tempo_minutos,
               ISNULL(c.excluido,0) AS excluido, c.excluido_em, c.excluido_por
        FROM chamados c ${where}
        ORDER BY c.criado_em DESC
      `);
      return res.json({ chamados: r.recordset });
    }

    const [rResumo, rStatus, rSetor, rTecnico] = await Promise.all([
      pool.request().query(`
        SELECT
          COUNT(*)                                                          AS total_geral,
          SUM(CASE WHEN c.status IN ('Aberto','Reaberto','TRANSFERIDO','APROVADO') THEN 1 ELSE 0 END) AS total_abertos,
          SUM(CASE WHEN c.status = 'Em Atendimento'  THEN 1 ELSE 0 END)   AS total_em_atendimento,
          SUM(CASE WHEN c.status = 'Respondido'      THEN 1 ELSE 0 END)   AS total_respondidos,
          SUM(CASE WHEN c.status = 'Finalizado'      THEN 1 ELSE 0 END)   AS total_finalizados,
          SUM(CASE WHEN c.status = 'REPROVADO'       THEN 1 ELSE 0 END)   AS total_reprovados,
          SUM(CASE WHEN c.status = 'APROVADO'        THEN 1 ELSE 0 END)   AS total_aprovados,
          SUM(CASE WHEN c.status = 'APROVACAO'       THEN 1 ELSE 0 END)   AS total_aprovacao,
          SUM(CASE WHEN ISNULL(c.excluido,0)=1       THEN 1 ELSE 0 END)   AS total_excluidos,
          AVG(CASE WHEN c.status = 'Finalizado'
              THEN DATEDIFF(minute, c.criado_em, c.atualizado_em) END)    AS tempo_medio_min
        FROM chamados c ${where}
      `),
      pool.request().query(`
        SELECT c.status, COUNT(*) AS total
        FROM chamados c ${where}
        GROUP BY c.status ORDER BY total DESC
      `),
      pool.request().query(`
        SELECT c.setor,
               COUNT(*)                                                        AS total,
               SUM(CASE WHEN c.status='Finalizado'     THEN 1 ELSE 0 END)    AS finalizados,
               SUM(CASE WHEN c.status IN ('Aberto','Reaberto','TRANSFERIDO','APROVADO') THEN 1 ELSE 0 END) AS abertos,
               SUM(CASE WHEN c.status='Em Atendimento' THEN 1 ELSE 0 END)    AS em_atendimento,
               SUM(CASE WHEN c.status='REPROVADO'      THEN 1 ELSE 0 END)    AS reprovados,
               AVG(CASE WHEN c.status='Finalizado'
                   THEN DATEDIFF(minute, c.criado_em, c.atualizado_em) END)  AS tempo_medio_min
        FROM chamados c ${where}
        GROUP BY c.setor ORDER BY total DESC
      `),
      pool.request().query(`
        SELECT ISNULL(c.nome_atendedor,'(sem técnico)') AS nome_atendedor,
               COUNT(*)                                                        AS total,
               SUM(CASE WHEN c.status='Finalizado'     THEN 1 ELSE 0 END)    AS finalizados,
               SUM(CASE WHEN c.status='Em Atendimento' THEN 1 ELSE 0 END)    AS em_atendimento,
               SUM(CASE WHEN c.status IN ('Aberto','Reaberto','TRANSFERIDO','APROVADO') THEN 1 ELSE 0 END) AS abertos,
               AVG(CASE WHEN c.status='Finalizado'
                   THEN DATEDIFF(minute, c.criado_em, c.atualizado_em) END)  AS tempo_medio_min
        FROM chamados c ${where}
        GROUP BY c.nome_atendedor ORDER BY total DESC
      `)
    ]);

    res.json({
      resumo:     rResumo.recordset[0] || {},
      porStatus:  rStatus.recordset    || [],
      porSetor:   rSetor.recordset     || [],
      porTecnico: rTecnico.recordset   || []
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============================================================
// CHAMADOS — VINCULAR (deve vir ANTES de /:id)
// ============================================================

/** Abre um chamado vinculado e bloqueia o chamado pai */
router.post('/api/chamados/:id/vincular', verificarLogin, async (req, res) => {
  try {
    const pool  = req.app.locals.pool;
    const u     = req.session.usuario;
    const login = u.usuario || u.login;
    const perf  = await getPerfil(pool, login, u.nivel);
    if (!['ADMIN','GESTOR','TECNICO'].includes(perf.cargo))
      return res.status(403).json({ erro: 'Sem permissão' });

    const paiId = parseInt(req.params.id);
    const { setor, assunto, detalhe } = req.body;
    if (!setor || !assunto?.trim())
      return res.status(400).json({ erro: 'Setor e assunto obrigatórios' });

    const paiR = await pool.request().input('id', sql.Int, paiId)
      .query('SELECT id, protocolo, status, ISNULL(bloqueado,0) AS bloqueado FROM chamados WHERE id=@id');
    if (!paiR.recordset.length) return res.status(404).json({ erro: 'Chamado não encontrado' });
    const pai = paiR.recordset[0];
    if (pai.bloqueado) return res.status(400).json({ erro: 'Chamado já está bloqueado por outro vínculo' });
    if (['Finalizado','REPROVADO'].includes(pai.status))
      return res.status(400).json({ erro: 'Não é possível vincular a um chamado encerrado' });

    const protocolo = await gerarProtocolo(pool, setor);
    const r = await pool.request()
      .input('protocolo',         sql.VarChar, protocolo)
      .input('login_solicitante', sql.VarChar, login)
      .input('nome_solicitante',  sql.VarChar, u.nome || login)
      .input('setor',             sql.VarChar, setor)
      .input('assunto',           sql.VarChar, assunto.trim())
      .input('detalhe',           sql.VarChar, detalhe || null)
      .input('chamado_pai_id',    sql.Int,     paiId)
      .query(`INSERT INTO chamados
               (protocolo, login_solicitante, nome_solicitante, setor, assunto, detalhe, status, chamado_pai_id)
              OUTPUT INSERTED.id
              VALUES (@protocolo,@login_solicitante,@nome_solicitante,@setor,@assunto,@detalhe,'Aberto',@chamado_pai_id)`);

    const vinculoId = r.recordset[0].id;

    // Bloqueia o chamado pai
    await pool.request().input('id', sql.Int, paiId)
      .query('UPDATE chamados SET bloqueado=1, atualizado_em=GETDATE() WHERE id=@id');

    // Histórico no chamado vinculado
    await addHistorico(pool, vinculoId, login,
      `${u.nome || login} abriu este chamado vinculado ao chamado pai ${pai.protocolo}`,
      detalhe || null);

    // Histórico no chamado pai
    await addHistorico(pool, paiId, login,
      `${u.nome || login} abriu chamado vinculado ${protocolo} para o setor "${setor}" — chamado PAI bloqueado até finalização do vínculo`,
      detalhe || null);

    res.json({ id: vinculoId, protocolo });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============================================================
// CHAMADOS — DETALHES
// ============================================================

router.get('/api/chamados/:id', verificarLogin, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const u      = req.session.usuario;
    const login  = u.usuario || u.login;
    const perf   = await getPerfil(pool, login, u.nivel);
    const id     = parseInt(req.params.id);

    const r = await pool.request().input('id', sql.Int, id).query('SELECT * FROM chamados WHERE id=@id');
    if (!r.recordset.length) return res.status(404).json({ erro: 'Não encontrado' });
    const c = r.recordset[0];

    if (!podeVer(perf, login, c)) return res.status(403).json({ erro: 'Sem permissão' });

    const hist = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM chamados_historico WHERE chamado_id=@id ORDER BY criado_em ASC');

    // Chamado pai (se este é vinculado)
    let chamadoPai = null;
    if (c.chamado_pai_id) {
      const pR = await pool.request().input('pid', sql.Int, c.chamado_pai_id)
        .query('SELECT id, protocolo, assunto, setor, status FROM chamados WHERE id=@pid');
      if (pR.recordset.length) {
        chamadoPai = pR.recordset[0];
        const pH = await pool.request().input('pid', sql.Int, c.chamado_pai_id)
          .query('SELECT * FROM chamados_historico WHERE chamado_id=@pid ORDER BY criado_em ASC');
        chamadoPai.historico = pH.recordset;
      }
    }

    // Chamados vinculados ativos (se este está bloqueado)
    let chamadosVinculados = [];
    if (c.bloqueado) {
      const vR = await pool.request().input('id', sql.Int, id)
        .query(`SELECT id, protocolo, assunto, setor, status
                FROM chamados
                WHERE chamado_pai_id=@id
                  AND status NOT IN ('Finalizado','REPROVADO')
                  AND (excluido IS NULL OR excluido=0)`);
      chamadosVinculados = vR.recordset;
    }

    res.json({ ...c, historico: hist.recordset, chamadoPai, chamadosVinculados });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============================================================
// CHAMADOS — AÇÕES
// ============================================================

/** Aceitar (TECNICO/GESTOR/ADMIN) */
router.put('/api/chamados/:id/aceitar', verificarLogin, async (req, res) => {
  try {
    const pool  = req.app.locals.pool;
    const u     = req.session.usuario;
    const login = u.usuario || u.login;
    const perf  = await getPerfil(pool, login, u.nivel);
    if (!['ADMIN','GESTOR','TECNICO'].includes(perf.cargo))
      return res.status(403).json({ erro: 'Sem permissão' });

    const id = parseInt(req.params.id);

    // Bloqueia ação se chamado está bloqueado por vínculo
    const blkR = await pool.request().input('id', sql.Int, id)
      .query('SELECT ISNULL(bloqueado,0) AS bloqueado FROM chamados WHERE id=@id');
    if (blkR.recordset[0]?.bloqueado)
      return res.status(400).json({ erro: 'Chamado bloqueado — aguardando finalização do chamado vinculado.' });

    // Valida setor: TECNICO só pode aceitar chamados dos seus setores
    if (perf.cargo === 'TECNICO' && perf.setores.length > 0) {
      const cR = await pool.request().input('id', sql.Int, id)
        .query('SELECT setor FROM chamados WHERE id=@id');
      if (!cR.recordset.length) return res.status(404).json({ erro: 'Chamado não encontrado' });
      const setorChamado = cR.recordset[0].setor;
      if (!perf.setores.includes(setorChamado))
        return res.status(403).json({ erro: 'Você não atende o setor deste chamado.' });
    }

    await pool.request()
      .input('id',    sql.Int,     id)
      .input('login', sql.VarChar, login)
      .input('nome',  sql.VarChar, u.nome || login)
      .query(`UPDATE chamados SET status='Em Atendimento',
                login_atendedor=@login, nome_atendedor=@nome, atualizado_em=GETDATE()
              WHERE id=@id AND status IN ('Aberto','TRANSFERIDO','Reaberto','APROVADO')`);
    await addHistorico(pool, id, login, `${u.nome || login} aceitou e está em atendimento`);
    (async () => {
      const cR = await pool.request().input('id', sql.Int, id)
        .query('SELECT protocolo, setor, assunto, nome_solicitante, login_solicitante, login_atendedor FROM chamados WHERE id=@id');
      if (cR.recordset[0]) {
        await enviarNotificacaoTelegram(pool, req.app.locals.logErro, cR.recordset[0], 'Em Atendimento');
        await enviarNotificacaoEmail(pool, req.app.locals.logErro, cR.recordset[0], 'Em Atendimento');
        registrarLog(pool, { usuario: login, ip: req.ip, acao: 'EDICAO', sistema: 'chamados', detalhes: `Chamado #${cR.recordset[0].protocolo} aceito — ${cR.recordset[0].assunto}` });
      }
    })().catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

/** Enviar mensagem */
router.put('/api/chamados/:id/mensagem', verificarLogin, async (req, res) => {
  try {
    const pool  = req.app.locals.pool;
    const u     = req.session.usuario;
    const login = u.usuario || u.login;
    const msg   = req.body.msg?.trim();
    if (!msg) return res.status(400).json({ erro: 'Mensagem vazia' });

    const id = parseInt(req.params.id);
    const cR = await pool.request().input('id', sql.Int, id)
      .query('SELECT login_solicitante, setor, status FROM chamados WHERE id=@id');
    if (!cR.recordset.length) return res.status(404).json({ erro: 'Não encontrado' });
    const c = cR.recordset[0];
    const perf = await getPerfil(pool, login, u.nivel);
    if (!podeVer(perf, login, c)) return res.status(403).json({ erro: 'Sem permissão' });

    // Muda status automaticamente
    let novoStatus = null;
    if (['ADMIN','GESTOR','TECNICO'].includes(perf.cargo) && ['Em Atendimento','Reaberto'].includes(c.status))
      novoStatus = 'Respondido';
    else if (perf.cargo === 'SOLICITANTE' && c.status === 'Respondido')
      novoStatus = 'Em Atendimento';

    if (novoStatus) {
      await pool.request()
        .input('id',     sql.Int,     id)
        .input('status', sql.VarChar, novoStatus)
        .query('UPDATE chamados SET status=@status, atualizado_em=GETDATE() WHERE id=@id');
    }

    // Narrativa descritiva por cargo
    let narrativa;
    if (['ADMIN','GESTOR','TECNICO'].includes(perf.cargo)) {
      narrativa = novoStatus === 'Respondido'
        ? `${u.nome || login} respondeu ao chamado`
        : `${u.nome || login} enviou uma mensagem`;
    } else {
      narrativa = novoStatus === 'Em Atendimento'
        ? `${u.nome || login} retornou com informações`
        : `${u.nome || login} enviou uma mensagem`;
    }

    await addHistorico(pool, id, login, narrativa, msg);
    if (novoStatus === 'Respondido')
      (async () => {
        const cR = await pool.request().input('id', sql.Int, id)
          .query('SELECT protocolo, setor, assunto, nome_solicitante, login_solicitante, login_atendedor FROM chamados WHERE id=@id');
        if (cR.recordset[0]) {
          await enviarNotificacaoTelegram(pool, req.app.locals.logErro, cR.recordset[0], 'Respondido');
          await enviarNotificacaoEmail(pool, req.app.locals.logErro, cR.recordset[0], 'Respondido');
        }
      })().catch(() => {});
    res.json({ ok: true, novoStatus });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

/** Finalizar */
router.put('/api/chamados/:id/finalizar', verificarLogin, async (req, res) => {
  try {
    const pool    = req.app.locals.pool;
    const u       = req.session.usuario;
    const login   = u.usuario || u.login;
    const parecer = (req.body?.parecer || '').trim();

    if (!parecer) return res.status(400).json({ erro: 'Informe o parecer ou motivo de finalização.' });

    const perf  = await getPerfil(pool, login, u.nivel);
    if (!['ADMIN','GESTOR','TECNICO'].includes(perf.cargo))
      return res.status(403).json({ erro: 'Sem permissão' });

    const id = parseInt(req.params.id);

    // Verifica se é chamado vinculado (tem pai) e obtém dados para validação
    const cR = await pool.request().input('id', sql.Int, id)
      .query('SELECT chamado_pai_id, protocolo, setor, login_atendedor FROM chamados WHERE id=@id');
    if (!cR.recordset.length) return res.status(404).json({ erro: 'Não encontrado' });
    const c = cR.recordset[0];

    // TECNICO só pode finalizar chamados do seu setor ou que esteja atendendo
    if (perf.cargo === 'TECNICO' && perf.setores.length > 0) {
      if (!perf.setores.includes(c.setor) && c.login_atendedor !== login)
        return res.status(403).json({ erro: 'Sem permissão para finalizar chamados deste setor.' });
    }

    await pool.request().input('id', sql.Int, id)
      .query("UPDATE chamados SET status='Finalizado', atualizado_em=GETDATE() WHERE id=@id");
    // Registra o parecer no histórico
    await addHistorico(pool, id, login, parecer);
    await addHistorico(pool, id, login, `${u.nome || login} finalizou o chamado`);
    (async () => {
      const cR = await pool.request().input('id', sql.Int, id)
        .query('SELECT protocolo, setor, assunto, nome_solicitante, login_solicitante, login_atendedor FROM chamados WHERE id=@id');
      if (cR.recordset[0]) {
        await enviarNotificacaoTelegram(pool, req.app.locals.logErro, cR.recordset[0], 'Finalizado');
        await enviarNotificacaoEmail(pool, req.app.locals.logErro, cR.recordset[0], 'Finalizado');
        registrarLog(pool, { usuario: login, ip: req.ip, acao: 'EDICAO', sistema: 'chamados', detalhes: `Chamado #${cR.recordset[0].protocolo} finalizado — ${cR.recordset[0].assunto}` });
      }
    })().catch(() => {});

    // Se é vinculado, desbloqueia o pai
    if (c.chamado_pai_id) {
      await pool.request().input('pid', sql.Int, c.chamado_pai_id)
        .query('UPDATE chamados SET bloqueado=0, atualizado_em=GETDATE() WHERE id=@pid');
      await addHistorico(pool, c.chamado_pai_id, login,
        `Chamado vinculado ${c.protocolo} foi finalizado. Chamado DESBLOQUEADO — pode seguir com o atendimento.`);
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

/** Reabrir */
router.put('/api/chamados/:id/reabrir', verificarLogin, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const u      = req.session.usuario;
    const login  = u.usuario || u.login;
    const motivo = req.body.motivo?.trim();
    if (!motivo) return res.status(400).json({ erro: 'Motivo obrigatório' });

    const id   = parseInt(req.params.id);
    const perf = await getPerfil(pool, login, u.nivel);
    const cR   = await pool.request().input('id', sql.Int, id)
      .query('SELECT login_solicitante FROM chamados WHERE id=@id');
    if (!cR.recordset.length) return res.status(404).json({ erro: 'Não encontrado' });
    const c = cR.recordset[0];

    if (!['ADMIN','GESTOR'].includes(perf.cargo) && c.login_solicitante !== login)
      return res.status(403).json({ erro: 'Sem permissão' });

    await pool.request().input('id', sql.Int, id)
      .query("UPDATE chamados SET status='Reaberto', atualizado_em=GETDATE() WHERE id=@id");
    await addHistorico(pool, id, login, `${u.nome || login} reabriu o chamado`, motivo);
    (async () => {
      const cR = await pool.request().input('id', sql.Int, id)
        .query('SELECT protocolo, setor, assunto, nome_solicitante, login_solicitante, login_atendedor FROM chamados WHERE id=@id');
      if (cR.recordset[0]) {
        await enviarNotificacaoTelegram(pool, req.app.locals.logErro, cR.recordset[0], 'Reaberto');
        await enviarNotificacaoEmail(pool, req.app.locals.logErro, cR.recordset[0], 'Reaberto');
        registrarLog(pool, { usuario: login, ip: req.ip, acao: 'EDICAO', sistema: 'chamados', detalhes: `Chamado #${cR.recordset[0].protocolo} reaberto — ${cR.recordset[0].assunto}` });
      }
    })().catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

/** Transferir setor */
router.put('/api/chamados/:id/transferir', verificarLogin, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const u      = req.session.usuario;
    const login  = u.usuario || u.login;
    const perf   = await getPerfil(pool, login, u.nivel);
    if (!['ADMIN','GESTOR','TECNICO'].includes(perf.cargo))
      return res.status(403).json({ erro: 'Sem permissão' });
    const { setor, motivo } = req.body;
    if (!setor || !motivo?.trim()) return res.status(400).json({ erro: 'Setor e motivo obrigatórios' });

    const id = parseInt(req.params.id);

    const blkT = await pool.request().input('id', sql.Int, id)
      .query('SELECT ISNULL(bloqueado,0) AS bloqueado, setor FROM chamados WHERE id=@id');
    if (blkT.recordset[0]?.bloqueado)
      return res.status(400).json({ erro: 'Chamado bloqueado — aguardando finalização do chamado vinculado.' });

    // TECNICO só pode transferir chamados do seu setor
    if (perf.cargo === 'TECNICO' && perf.setores.length > 0) {
      if (!blkT.recordset[0] || !perf.setores.includes(blkT.recordset[0].setor))
        return res.status(403).json({ erro: 'Sem permissão para transferir chamados deste setor.' });
    }

    await pool.request()
      .input('id',    sql.Int,     id)
      .input('setor', sql.VarChar, setor)
      .query(`UPDATE chamados SET setor=@setor, status='TRANSFERIDO',
                login_atendedor=NULL, nome_atendedor=NULL, atualizado_em=GETDATE()
              WHERE id=@id`);
    await addHistorico(pool, id, login, `${u.nome || login} transferiu para o setor: ${setor}`, motivo.trim());
    (async () => {
      const cR = await pool.request().input('id', sql.Int, id)
        .query('SELECT protocolo, setor, assunto, nome_solicitante, login_solicitante, login_atendedor FROM chamados WHERE id=@id');
      if (cR.recordset[0]) {
        await enviarNotificacaoTelegram(pool, req.app.locals.logErro, cR.recordset[0], 'TRANSFERIDO');
        await enviarNotificacaoEmail(pool, req.app.locals.logErro, cR.recordset[0], 'TRANSFERIDO');
        registrarLog(pool, { usuario: login, ip: req.ip, acao: 'EDICAO', sistema: 'chamados', detalhes: `Chamado #${cR.recordset[0].protocolo} transferido para setor: ${setor}` });
      }
    })().catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

/** Solicitar aprovação */
router.put('/api/chamados/:id/solicitar-aprovacao', verificarLogin, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const u      = req.session.usuario;
    const login  = u.usuario || u.login;
    const perf   = await getPerfil(pool, login, u.nivel);
    if (!['ADMIN','GESTOR','TECNICO'].includes(perf.cargo))
      return res.status(403).json({ erro: 'Sem permissão' });
    const { aprovador_login, motivo } = req.body;
    if (!aprovador_login || !motivo?.trim())
      return res.status(400).json({ erro: 'Aprovador e motivo obrigatórios' });

    const id = parseInt(req.params.id);

    const blkA = await pool.request().input('id', sql.Int, id)
      .query('SELECT ISNULL(bloqueado,0) AS bloqueado, setor FROM chamados WHERE id=@id');
    if (blkA.recordset[0]?.bloqueado)
      return res.status(400).json({ erro: 'Chamado bloqueado — aguardando finalização do chamado vinculado.' });

    // TECNICO só pode solicitar aprovação de chamados do seu setor
    if (perf.cargo === 'TECNICO' && perf.setores.length > 0) {
      if (!blkA.recordset[0] || !perf.setores.includes(blkA.recordset[0].setor))
        return res.status(403).json({ erro: 'Sem permissão para solicitar aprovação deste chamado.' });
    }

    await pool.request()
      .input('id',        sql.Int,     id)
      .input('aprovador', sql.VarChar, aprovador_login)
      .query(`UPDATE chamados SET status='APROVACAO', aprovador_login=@aprovador,
                status_aprovacao='Pendente', atualizado_em=GETDATE() WHERE id=@id`);
    await addHistorico(pool, id, login, `${u.nome || login} solicitou aprovação de ${aprovador_login}`, motivo.trim());
    (async () => {
      const cR = await pool.request().input('id', sql.Int, id)
        .query('SELECT protocolo, setor, assunto, nome_solicitante, login_solicitante, login_atendedor, aprovador_login FROM chamados WHERE id=@id');
      if (cR.recordset[0]) {
        await enviarNotificacaoTelegram(pool, req.app.locals.logErro, cR.recordset[0], 'APROVACAO');
        await enviarNotificacaoEmail(pool, req.app.locals.logErro, cR.recordset[0], 'APROVACAO');
        registrarLog(pool, { usuario: login, ip: req.ip, acao: 'EDICAO', sistema: 'chamados', detalhes: `Chamado #${cR.recordset[0].protocolo} — aprovação solicitada a ${aprovador_login}` });
      }
    })().catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

/** Responder aprovação (GESTOR/ADMIN) */
router.put('/api/chamados/:id/responder-aprovacao', verificarLogin, async (req, res) => {
  try {
    const pool  = req.app.locals.pool;
    const u     = req.session.usuario;
    const login = u.usuario || u.login;
    const perf  = await getPerfil(pool, login, u.nivel);
    if (!['ADMIN','GESTOR'].includes(perf.cargo))
      return res.status(403).json({ erro: 'Sem permissão' });
    const { decisao, justificativa } = req.body;
    if (!['APROVADO','REPROVADO'].includes(decisao) || !justificativa?.trim())
      return res.status(400).json({ erro: 'Campos inválidos' });

    const id         = parseInt(req.params.id);
    const novoStatus = decisao === 'APROVADO' ? 'APROVADO' : 'REPROVADO';
    await pool.request()
      .input('id',     sql.Int,     id)
      .input('status', sql.VarChar, novoStatus)
      .input('st_apv', sql.VarChar, decisao)
      .query("UPDATE chamados SET status=@status, status_aprovacao=@st_apv, atualizado_em=GETDATE() WHERE id=@id");
    const narrativa = decisao === 'APROVADO'
      ? `${u.nome || login} aprovou o chamado`
      : `${u.nome || login} reprovou o chamado`;
    await addHistorico(pool, id, login, narrativa, justificativa.trim());
    (async () => {
      const cR = await pool.request().input('id', sql.Int, id)
        .query('SELECT protocolo, setor, assunto, nome_solicitante, login_solicitante, login_atendedor, aprovador_login FROM chamados WHERE id=@id');
      if (cR.recordset[0]) {
        await enviarNotificacaoTelegram(pool, req.app.locals.logErro, cR.recordset[0], decisao);
        await enviarNotificacaoEmail(pool, req.app.locals.logErro, { ...cR.recordset[0], justificativa: justificativa.trim() }, decisao);
        registrarLog(pool, { usuario: login, ip: req.ip, acao: 'EDICAO', sistema: 'chamados', detalhes: `Chamado #${cR.recordset[0].protocolo} — aprovação ${decisao.toLowerCase()}` });
      }
    })().catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

/** Excluir (ADMIN) */
router.delete('/api/chamados/:id', verificarLogin, async (req, res) => {
  try {
    const pool  = req.app.locals.pool;
    const u     = req.session.usuario;
    const login = u.usuario || u.login;
    const perf  = await getPerfil(pool, login, u.nivel);
    if (perf.cargo !== 'ADMIN') return res.status(403).json({ erro: 'Sem permissão' });
    const id = parseInt(req.params.id);
    // Soft delete — preserva registro para relatórios
    await pool.request()
      .input('id',    sql.Int,     id)
      .input('login', sql.VarChar, login)
      .query(`UPDATE chamados
              SET excluido=1, excluido_em=GETDATE(), excluido_por=@login
              WHERE id=@id`);
    await addHistorico(pool, id, login, `${u.nome || login} excluiu o chamado`);
    registrarLog(pool, { usuario: login, ip: req.ip, acao: 'EXCLUSAO', sistema: 'chamados', detalhes: `Chamado #${id} excluído` });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});


// ============================================================
// CHAMADOS — TELEGRAM CONFIG
// ============================================================

router.get('/api/chamados/telegram/config', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const u    = req.session.usuario;
    const perf = await getPerfil(pool, u.usuario || u.login, u.nivel);
    if (perf.cargo !== 'ADMIN') return res.status(403).json({ erro: 'Sem permissão' });
    const r = await pool.request()
      .query("SELECT chave, valor FROM configuracoes WHERE grupo='chamados_telegram'");
    const cfg = {};
    r.recordset.forEach(row => { cfg[row.chave] = row.valor; });
    res.json({ config: cfg });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/api/chamados/telegram/config', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const u    = req.session.usuario;
    const perf = await getPerfil(pool, u.usuario || u.login, u.nivel);
    if (perf.cargo !== 'ADMIN') return res.status(403).json({ erro: 'Sem permissão' });
    const { token, statuses, mapping } = req.body;

    const upsert = async (chave, valor) => {
      await pool.request()
        .input('chave', sql.VarChar, chave)
        .input('valor', sql.VarChar, String(valor || ''))
        .query(`IF EXISTS (SELECT 1 FROM configuracoes WHERE chave=@chave)
                  UPDATE configuracoes SET valor=@valor WHERE chave=@chave
                ELSE
                  INSERT INTO configuracoes (chave, valor, grupo) VALUES (@chave, @valor, 'chamados_telegram')`);
    };

    await upsert('chamados_tg_token', token || '');
    await upsert('chamados_tg_statuses', JSON.stringify(Array.isArray(statuses) ? statuses : []));
    for (const [setor, chatId] of Object.entries(mapping || {})) {
      await upsert(`chamados_tg_map_${setor}`, chatId || '');
    }

    res.json({ ok: true, mensagem: 'Configurações salvas!' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/api/chamados/telegram/teste', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const u    = req.session.usuario;
    const perf = await getPerfil(pool, u.usuario || u.login, u.nivel);
    if (perf.cargo !== 'ADMIN') return res.status(403).json({ erro: 'Sem permissão' });
    const { token, chatId, setor } = req.body;
    if (!token || !chatId) return res.status(400).json({ erro: 'Token e Chat ID obrigatórios' });
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `✅ *Portal WKL — Chamados*\n\nTeste do canal do setor *${setor}* funcionando!`,
        parse_mode: 'Markdown'
      })
    });
    const dados = await resp.json();
    if (dados.ok) res.json({ ok: true });
    else res.status(400).json({ erro: dados.description });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/api/chamados/telegram/broadcast', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const u    = req.session.usuario;
    const perf = await getPerfil(pool, u.usuario || u.login, u.nivel);
    if (perf.cargo !== 'ADMIN') return res.status(403).json({ erro: 'Sem permissão' });
    const { mensagem } = req.body;
    if (!mensagem?.trim()) return res.status(400).json({ erro: 'Mensagem obrigatória' });

    const r = await pool.request()
      .query("SELECT chave, valor FROM configuracoes WHERE grupo='chamados_telegram'");
    const cfg = {};
    r.recordset.forEach(row => { cfg[row.chave] = row.valor; });
    const token = cfg['chamados_tg_token'];
    if (!token) return res.status(400).json({ erro: 'Token não configurado' });

    const channels = Object.entries(cfg)
      .filter(([k, v]) => k.startsWith('chamados_tg_map_') && v)
      .map(([k, v]) => ({ setor: k.replace('chamados_tg_map_', ''), chatId: v }));
    if (!channels.length) return res.status(400).json({ erro: 'Nenhum canal configurado' });

    const texto = `📢 *AVISO GERAL — Portal WKL*\n\n${mensagem.trim()}`;
    let enviados = 0;
    for (const { chatId } of channels) {
      try {
        const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown' })
        });
        const dados = await resp.json();
        if (dados.ok) enviados++;
      } catch (_) {}
    }
    res.json({ ok: true, enviados, total: channels.length });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
