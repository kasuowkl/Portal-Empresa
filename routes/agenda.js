/**
 * ARQUIVO: routes/agenda.js
 * VERSÃƒO:  1.0.0
 * DATA:    2026-03-03
 * DESCRIÃ‡ÃƒO: Rotas da Agenda de Tarefas
 */

const express        = require('express');
const sql            = require('mssql');
const path           = require('path');
const verificarLogin   = require('../middleware/verificarLogin');
const { registrarLog } = require('../services/logService');
const { enviarNotificacao } = require('../services/emailService');
const { enviarWhatsApp } = require('../services/whatsappService');
const { renderizarMensagemWhatsApp } = require('../services/whatsappTemplateService');
const router           = express.Router();

// ============================================================
// Helper: permissÃ£o do usuÃ¡rio na lista
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

async function carregarConfigWhatsApp(pool) {
  try {
    const r = await pool.request()
      .input('grupo', sql.VarChar, 'whatsapp')
      .query('SELECT chave, valor FROM configuracoes WHERE grupo = @grupo');
    const config = {};
    for (const row of r.recordset) config[row.chave] = row.valor;
    return config;
  } catch {
    return {};
  }
}

function listaConfig(config, chave, padrao = []) {
  if (!Object.prototype.hasOwnProperty.call(config, chave)) return [...padrao];
  return String(config[chave] || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function parseLoginsJson(valor) {
  if (!valor) return [];
  try {
    const arr = JSON.parse(valor);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function buscarWhatsAppsPorLogins(pool, logins) {
  const unicos = [...new Set((logins || []).map((l) => String(l || '').trim().toLowerCase()).filter(Boolean))];
  if (!unicos.length) return {};

  const params = unicos.map((_, i) => `@login${i}`);
  const req = pool.request();
  unicos.forEach((login, i) => req.input(`login${i}`, sql.VarChar, login));

  const r = await req.query(`
    SELECT login, whatsapp
    FROM usuarios_dominio
    WHERE ativo = 1 AND whatsapp IS NOT NULL AND whatsapp <> '' AND login IN (${params.join(',')})
    UNION ALL
    SELECT usuario AS login, whatsapp
    FROM usuarios
    WHERE ativo = 1 AND whatsapp IS NOT NULL AND whatsapp <> '' AND usuario IN (${params.join(',')})
  `);

  const mapa = {};
  for (const row of r.recordset) {
    mapa[String(row.login || '').toLowerCase()] = String(row.whatsapp || '').replace(/\D/g, '');
  }
  return mapa;
}

async function buscarAdminsAgenda(pool) {
  try {
    const r = await pool.request().query(`
      SELECT usuario AS login
      FROM usuarios
      WHERE ativo = 1 AND nivel = 'admin'
    `);
    return r.recordset.map((x) => String(x.login || '').toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

async function buscarEmailAprovacao(pool, login) {
  if (!login) return null;
  try {
    const r = await pool.request().input('login', sql.VarChar, login)
      .query('SELECT email FROM usuarios_dominio WHERE login = @login AND ativo = 1');
    return r.recordset[0]?.email || null;
  } catch {
    return null;
  }
}

async function buscarEmailsListaAprovacao(pool, logins) {
  if (!logins || !logins.length) return [];
  const emails = await Promise.all(logins.map((login) => buscarEmailAprovacao(pool, login)));
  return emails.filter(Boolean);
}

async function buscarEmailsAdminsAprovacao(pool) {
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

async function buscarWhatsAppAprovadoresAgenda(pool, logins) {
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

async function montarDadosNotifAprovacaoAgenda(pool, aprovacaoId) {
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
    buscarEmailAprovacao(pool, a.criado_por),
    buscarEmailsListaAprovacao(pool, partsR.recordset.map((p) => p.aprovador_login)),
    buscarEmailsListaAprovacao(pool, obsR.recordset.map((o) => o.observador_login)),
    buscarEmailsAdminsAprovacao(pool),
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

async function buscarEditoresListaAgenda(pool, listaId) {
  try {
    const r = await pool.request()
      .input('lista_id', sql.Int, listaId)
      .query(`
        SELECT dono AS login
        FROM agenda_listas
        WHERE id = @lista_id
        UNION
        SELECT usuario AS login
        FROM agenda_membros
        WHERE lista_id = @lista_id AND permissao = 'edicao'
      `);
    return r.recordset.map((x) => String(x.login || '').toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

async function montarMensagemWhatsAppAgenda(pool, evento, contexto) {
  const titulo = contexto.tarefa?.titulo || contexto.listaNome || 'Agenda de Tarefas';
  const lista = contexto.listaNome || 'Minhas tarefas';
  const cabecalhoMap = {
    'agenda.tarefa_criada': 'Nova tarefa',
    'agenda.tarefa_editada': 'Tarefa editada',
    'agenda.tarefa_concluida': 'Tarefa concluída',
    'agenda.passo_atribuido': 'Passo atribuído',
    'agenda.passo_concluido': 'Passo concluído',
    'agenda.membro_adicionado': 'Membro adicionado',
  };

  return renderizarMensagemWhatsApp(pool, 'agenda.evento_padrao', {
    cabecalho: cabecalhoMap[evento] || 'Agenda de Tarefas',
    titulo,
    lista,
    passo: contexto.passoTexto ? `\nPasso: ${contexto.passoTexto}` : '',
    permissao: evento === 'agenda.membro_adicionado' ? `\nPermissão: ${contexto.permissao || 'leitura'}` : '',
    usuario_acao: contexto.usuarioAcao ? `\nPor: ${contexto.usuarioAcao}` : '',
    link: 'http://192.168.0.80:3132/agenda',
  });
}

async function enviarWhatsAppAgenda(pool, evento, contexto, meta = {}) {
  const config = await carregarConfigWhatsApp(pool);
  const chaveDest = `wpp.dest.agenda.${evento.split('.').pop()}`;
  const chips = listaConfig(config, chaveDest, []);
  if (!chips.length) return;

  const logins = new Set();
  const numeros = new Set();

  if (chips.includes('criado_por_usuario') && contexto.criadoPor) {
    logins.add(String(contexto.criadoPor).toLowerCase());
  }

  if (chips.includes('atribuido')) {
    for (const login of (contexto.atribuidos || [])) logins.add(String(login).toLowerCase());
  }

  if (chips.includes('gestores') && contexto.listaId) {
    const editores = await buscarEditoresListaAgenda(pool, contexto.listaId);
    for (const login of editores) logins.add(login);
  }

  if (chips.includes('admins')) {
    const admins = await buscarAdminsAgenda(pool);
    for (const login of admins) logins.add(login);
  }

  if (chips.includes('whatsapp_padrao')) {
    const numeroPadrao = String(config.whatsapp_numero_teste || '').replace(/\D/g, '');
    if (numeroPadrao) numeros.add(numeroPadrao);
  }

  const mapaWhats = await buscarWhatsAppsPorLogins(pool, [...logins]);
  Object.values(mapaWhats).forEach((numero) => { if (numero) numeros.add(numero); });

  const mensagem = await montarMensagemWhatsAppAgenda(pool, evento, contexto);
  for (const numero of numeros) {
    const result = await enviarWhatsApp(pool, {
      numero,
      mensagem,
      evento,
      usuario: meta.usuario || '',
      ip: meta.ip || '',
      sistema: 'agenda',
    });

    if (!result.ok && !result.ignorado && meta.logErro) {
      meta.logErro.warn(`WhatsApp ${evento} nao enviado para ${numero}: ${result.erro || `status ${result.status}`}`);
    }
  }
}

// ============================================================
// GET /agenda â€” Serve a pÃ¡gina HTML
// ============================================================
router.get('/agenda', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agendaTarefas/index.html'));
});

// ============================================================
// GET /api/agenda/listas â€” Listas do usuÃ¡rio (dono + membro)
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
// POST /api/agenda/listas â€” Criar lista
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
// PUT /api/agenda/listas/:id â€” Editar lista (somente dono)
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
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'agenda', detalhes: `Lista #${id} editada: "${nome.trim()}"` });
    res.json({ sucesso: true, mensagem: 'Lista atualizada.' });
  } catch (erro) {
    logErro.error(`Erro ao editar lista: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao editar lista.' });
  }
});

// ============================================================
// DELETE /api/agenda/listas/:id â€” Excluir lista (somente dono)
// ============================================================
router.delete('/api/agenda/listas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const perm = await getPermissao(pool, id, usuario);
  if (perm !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode excluir a lista.' });

  try {
    await pool.request().input('id', sql.Int, id).query(`DELETE FROM agenda_anexos WHERE tarefa_id IN (SELECT id FROM agenda_tarefas WHERE lista_id=@id)`);
    await pool.request().input('id', sql.Int, id).query('DELETE FROM agenda_tarefas    WHERE lista_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM agenda_categorias WHERE lista_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM agenda_membros    WHERE lista_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM agenda_listas     WHERE id=@id');
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EXCLUSAO', sistema: 'agenda', detalhes: `Lista #${id} excluÃ­da` });
    res.json({ sucesso: true, mensagem: 'Lista excluÃ­da.' });
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
// POST /api/agenda/listas/:id/membros â€” Adicionar/atualizar membro
// ============================================================
router.post('/api/agenda/listas/:id/membros', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { usuario: novo, permissao } = req.body;

  const perm = await getPermissao(pool, id, usuario);
  if (perm !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode adicionar membros.' });
  if (!novo)           return res.status(400).json({ erro: 'Informe o usuÃ¡rio.' });
  if (novo === usuario) return res.status(400).json({ erro: 'VocÃª jÃ¡ Ã© o dono da lista.' });

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

    // âœ… NotificaÃ§Ã£o para o novo membro
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
            email_atribuido: emailMembro   // o novo membro Ã© o destinatÃ¡rio natural
          });
        }
        await enviarWhatsAppAgenda(pool, 'agenda.membro_adicionado', {
          listaId: id,
          listaNome,
          criadoPor: usuario,
          atribuidos: [novo.trim().toLowerCase()],
          permissao: permissao || 'leitura',
          usuarioAcao: usuario,
        }, { usuario, ip: req.ip, logErro });
      } catch (eEmail) {
        logErro.warn(`Email membro_adicionado nÃ£o enviado: ${eEmail.message}`);
      }
    })();

    registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'agenda', detalhes: `Membro "${novo}" adicionado/atualizado na lista #${id}` });
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
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EXCLUSAO', sistema: 'agenda', detalhes: `Membro "${membro}" removido da lista #${id}` });
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
// POST /api/agenda/listas/:id/tarefas â€” Criar tarefa
// ============================================================
router.post('/api/agenda/listas/:id/tarefas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { titulo, descricao, prazo, prioridade, categoria_id } = req.body;

  const perm = await getPermissao(pool, id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o para criar tarefas.' });
  if (!titulo?.trim())               return res.status(400).json({ erro: 'Informe o tÃ­tulo.' });

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
// GET /api/agenda/tarefas/:id â€” Detalhar tarefa (usado pelo mÃ³dulo Projetos)
// ============================================================
router.get('/api/agenda/tarefas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  try {
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT t.id, t.lista_id, t.titulo, t.descricao, t.prazo, t.prioridade,
               t.status, t.categoria_id, t.criado_por, t.criado_em, t.atualizado_em,
               t.responsavel, t.projeto_id, t.subprojeto_id,
               l.nome AS lista_nome,
               c.nome AS categoria_nome
        FROM agenda_tarefas t
        LEFT JOIN agenda_listas l ON l.id = t.lista_id
        LEFT JOIN agenda_categorias c ON c.id = t.categoria_id
        WHERE t.id = @id
      `);
    if (!r.recordset[0]) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

    const tarefa = r.recordset[0];
    const perm = await getPermissao(pool, tarefa.lista_id, usuario);
    if (!perm) return res.status(403).json({ erro: 'Sem acesso.' });

    const passos = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM agenda_passos WHERE tarefa_id = @id ORDER BY ordem ASC');

    res.json({ tarefa, passos: passos.recordset });
  } catch (erro) {
    logErro.error(`Erro ao buscar tarefa: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao buscar tarefa.' });
  }
});

// ============================================================
// GET /api/agenda/tarefas/:id/aprovacoes â€” AprovaÃ§Ãµes vinculadas
// ============================================================
router.get('/api/agenda/tarefas/:id/aprovacoes', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id, 10);

  try {
    const tarefaR = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT id, lista_id FROM agenda_tarefas WHERE id = @id');
    const tarefa = tarefaR.recordset[0];
    if (!tarefa) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

    const perm = await getPermissao(pool, tarefa.lista_id, usuario);
    if (!perm) return res.status(403).json({ erro: 'Sem acesso.' });

    const r = await pool.request()
      .input('tarefa_id', sql.Int, id)
      .query(`
        SELECT
          a.id,
          a.titulo,
          a.status,
          a.criado_em,
          a.atualizado_em,
          a.tipo_consenso,
          a.consenso_valor,
          a.criado_por,
          a.criado_por_nome
        FROM agenda_tarefas_aprovacoes ata
        JOIN aprovacoes a ON a.id = ata.aprovacao_id
        WHERE ata.tarefa_id = @tarefa_id
        ORDER BY ata.id DESC
      `);

    res.json({ sucesso: true, aprovacoes: r.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar aprovações da tarefa: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar aprovações da tarefa.' });
  }
});

// ============================================================
// POST /api/agenda/tarefas/:id/solicitar-aprovacao — Cria no sistema Aprovações
// ============================================================
router.post('/api/agenda/tarefas/:id/solicitar-aprovacao', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const login = req.session.usuario.usuario || req.session.usuario.login;
  const nome = req.session.usuario.nome || login;
  const id = parseInt(req.params.id, 10);
  const {
    titulo,
    objetivo,
    aprovadores,
    observadores,
    tipo_consenso,
    consenso_valor,
  } = req.body || {};

  if (!Array.isArray(aprovadores) || !aprovadores.length) {
    return res.status(400).json({ erro: 'Selecione ao menos um aprovador.' });
  }

  const tiposValidos = ['unanimidade', 'maioria_simples', 'maioria_qualificada', 'quorum_minimo'];
  const tipoFinal = tiposValidos.includes(tipo_consenso) ? tipo_consenso : 'unanimidade';
  const valorFinal = (tipoFinal === 'maioria_qualificada' || tipoFinal === 'quorum_minimo')
    ? (parseInt(consenso_valor, 10) || null)
    : null;

  try {
    const tarefaR = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT t.id, t.lista_id, t.titulo, t.descricao, t.criado_por, l.nome AS lista_nome
        FROM agenda_tarefas t
        LEFT JOIN agenda_listas l ON l.id = t.lista_id
        WHERE t.id = @id
      `);
    const tarefa = tarefaR.recordset[0];
    if (!tarefa) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

    const perm = await getPermissao(pool, tarefa.lista_id, login);
    if (!temPermissao(perm, 'edicao')) {
      return res.status(403).json({ erro: 'Sem permissÃ£o para solicitar aprovaÃ§Ã£o desta tarefa.' });
    }

    const nomesR = await pool.request().query(`
      SELECT usuario AS login, nome FROM usuarios WHERE nivel != 'inativo'
      UNION ALL
      SELECT login, nome FROM usuarios_dominio
    `);
    const mapaUsuarios = {};
    nomesR.recordset.forEach((u) => { mapaUsuarios[u.login] = u.nome; });

    const tituloFinal = String(titulo || '').trim() || `Aprovação da tarefa: ${tarefa.titulo}`;
    const linkTarefa = `http://192.168.0.80:3132/agenda?tarefa=${tarefa.id}`;
    const objetivoFinal = [
      (objetivo || '').trim(),
      '',
      'Origem: Agenda de Tarefas',
      `Lista: ${tarefa.lista_nome || 'Minhas tarefas'}`,
      `Tarefa: ${tarefa.titulo}`,
      `Link da tarefa: ${linkTarefa}`,
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
      .input('tarefa_id', sql.Int, id)
      .input('aprovacao_id', sql.Int, aprovacaoId)
      .input('criado_por', sql.VarChar, login)
      .query(`
        INSERT INTO agenda_tarefas_aprovacoes (tarefa_id, aprovacao_id, criado_por)
        VALUES (@tarefa_id, @aprovacao_id, @criado_por)
      `);

    await pool.request()
      .input('id', sql.Int, id)
      .input('status', sql.VarChar, 'aguardando')
      .query(`
        UPDATE agenda_tarefas
           SET status = @status,
               atualizado_em = GETDATE()
         WHERE id = @id
      `);


    await pool.request()
      .input('aprovacao_id', sql.Int, aprovacaoId)
      .input('usuario', sql.VarChar, login)
      .input('acao', sql.VarChar, `${nome} criou a aprovação via tarefa #${id}`)
      .query('INSERT INTO aprovacoes_log (aprovacao_id, usuario, acao) VALUES (@aprovacao_id, @usuario, @acao)');

    registrarLog(pool, {
      usuario: login,
      ip: req.ip,
      acao: 'CRIACAO',
      sistema: 'agenda',
      detalhes: `Tarefa #${id}: aprovação #${aprovacaoId} solicitada`,
    });

    registrarLog(pool, {
      usuario: login,
      ip: req.ip,
      acao: 'CRIACAO',
      sistema: 'aprovacoes',
      detalhes: `Aprovação #${aprovacaoId} criada via Agenda de Tarefas (#${id})`,
    });

    try {
      const dadosNotif = await montarDadosNotifAprovacaoAgenda(pool, aprovacaoId);
      if (dadosNotif) {
        await enviarNotificacao(pool, 'aprovacoes.nova_solicitacao', dadosNotif);
      }
    } catch (eNotif) {
      registrarLog(pool, {
        usuario: login,
        ip: req.ip,
        acao: 'NOTIF_EMAIL',
        sistema: 'aprovacoes',
        detalhes: `Aprovação #${aprovacaoId}: erro no envio inicial de e-mail via tarefa — ${eNotif.message}`,
      });
    }

    try {
      const mapaWhatsApp = await buscarWhatsAppAprovadoresAgenda(pool, aprovadores);
      const entries = Object.entries(mapaWhatsApp);
      for (const [aprLogin, numero] of entries) {
        const aprNome = mapaUsuarios[aprLogin] || aprLogin;
        const msg = await renderizarMensagemWhatsApp(pool, 'agenda.aprovacao_tarefa', {
          aprovador_nome: aprNome,
          aprovacao_id: aprovacaoId,
          titulo: tituloFinal,
          lista: tarefa.lista_nome || 'Minhas tarefas',
          tarefa: tarefa.titulo,
          solicitante: nome,
          link_item: linkTarefa,
          link_aprovacoes: 'http://192.168.0.80:3132/aprovacoes',
        });

        const result = await enviarWhatsApp(pool, {
          numero,
          mensagem: msg,
          evento: 'aprovacoes.nova_solicitacao',
          usuario: login,
          ip: req.ip,
          sistema: 'aprovacoes',
        });

        registrarLog(pool, {
          usuario: login,
          ip: req.ip,
          acao: 'NOTIF_WHATSAPP',
          sistema: 'aprovacoes',
          detalhes: result?.ok
            ? `Aprovação #${aprovacaoId}: envio inicial WhatsApp via tarefa para ${aprLogin} (${numero})`
            : `Aprovação #${aprovacaoId}: falha no envio inicial WhatsApp via tarefa para ${aprLogin} (${numero}) — ${result?.erro || result?.status || 'erro desconhecido'}`,
        });
      }
    } catch (eWhats) {
      registrarLog(pool, {
        usuario: login,
        ip: req.ip,
        acao: 'NOTIF_WHATSAPP',
        sistema: 'aprovacoes',
        detalhes: `Aprovação #${aprovacaoId}: erro no envio inicial WhatsApp via tarefa — ${eWhats.message}`,
      });
    }

    registrarLog(pool, {
      usuario: login,
      ip: req.ip,
      acao: 'EDICAO',
      sistema: 'agenda',
      detalhes: `Tarefa #${id}: status alterado automaticamente para "aguardando"`,
    });

    res.json({ sucesso: true, id: aprovacaoId, status_tarefa: 'aguardando', mensagem: 'Solicitação de aprovação criada com sucesso.' });
  } catch (erro) {
    logErro.error(`Erro ao solicitar aprovaÃ§Ã£o da tarefa #${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao solicitar aprovaÃ§Ã£o da tarefa.' });
  }
});

// ============================================================
// PUT /api/agenda/tarefas/:id â€” Editar tarefa
// ============================================================
router.put('/api/agenda/tarefas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { titulo, descricao, prazo, prioridade, status, categoria_id } = req.body;

  const t = await pool.request().input('id', sql.Int, id)
    .query('SELECT lista_id FROM agenda_tarefas WHERE id=@id');
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });
  if (!titulo?.trim())               return res.status(400).json({ erro: 'Informe o tÃ­tulo.' });

  const statusValido = status?.trim() || 'a_fazer';

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
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'agenda', detalhes: `Tarefa #${id} editada: "${titulo.trim()}"` });
    res.json({ sucesso: true, mensagem: 'Tarefa atualizada.' });
  } catch (erro) {
    logErro.error(`Erro ao editar tarefa: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao editar tarefa.' });
  }
});

// ============================================================
// POST /api/agenda/tarefas/:id/notificar
// Dispara notificaÃ§Ã£o consolidada (1 email, todos os passos)
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
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso.' });

  const eventoTipo = tipo === 'editada' ? 'agenda.tarefa_editada' : 'agenda.tarefa_criada';

  // âœ… Dispara de forma assÃ­ncrona â€” responde imediatamente ao frontend
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

  if (!status || typeof status !== 'string' || status.trim().length === 0)
    return res.status(400).json({ erro: 'Status invÃ¡lido.' });

  const t = await pool.request().input('id', sql.Int, id)
    .query('SELECT lista_id FROM agenda_tarefas WHERE id=@id');
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

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
      registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'agenda', detalhes: `Tarefa concluÃ­da: "${tarefa?.titulo}"` });

      // Buscar passos da tarefa (incluindo atribuÃ­do_para para resolver colaboradores)
      const pR = await pool.request()
        .input('tarefa_id', sql.Int, id)
        .query(`SELECT texto AS descricao, concluido, executado_por, executado_em, atribuido_para FROM agenda_passos WHERE tarefa_id=@tarefa_id ORDER BY id ASC`);
      const passos = pR.recordset;

      // Enviar notificaÃ§Ã£o de tarefa concluÃ­da
      try {
        const uR = await pool.request()
          .input('usuario', sql.VarChar, tarefa?.criado_por)
          .query('SELECT email FROM usuarios_dominio WHERE login=@usuario');

        // âœ… Coletar todos os colaboradores de todos os passos
        const loginsColabs = new Set();
        for (const passo of passos) {
          if (passo.atribuido_para) {
            try {
              const arr = JSON.parse(passo.atribuido_para);
              if (Array.isArray(arr)) arr.forEach(l => loginsColabs.add(l));
            } catch (_) {}
          }
        }

        // âœ… Buscar emails dos colaboradores em lote
        const emailsColabs = [];
        for (const login of loginsColabs) {
          const eR = await pool.request()
            .input('login', sql.VarChar, login)
            .query('SELECT email FROM usuarios_dominio WHERE login=@login');
          if (eR.recordset[0]?.email) emailsColabs.push(eR.recordset[0].email);
        }

        const emailService = require('../services/emailService');
        await emailService.enviarNotificacao(pool, 'agenda.tarefa_concluida', {
          titulo: tarefa?.titulo || 'Sem tÃ­tulo',
          descricao: tarefa?.descricao || 'â€”',
          lista: tarefa?.lista_nome || 'Minhas tarefas',
          passos: passos,
          email_criado_por: uR.recordset[0]?.email,
          email_atribuido: emailsColabs   // âœ… Array com todos os colaboradores
        });
        await enviarWhatsAppAgenda(pool, 'agenda.tarefa_concluida', {
          listaId: tarefa?.lista_id,
          listaNome: tarefa?.lista_nome || 'Minhas tarefas',
          tarefa: { titulo: tarefa?.titulo || 'Sem titulo' },
          criadoPor: tarefa?.criado_por,
          atribuidos: [...loginsColabs],
          usuarioAcao: usuario,
        }, { usuario, ip: req.ip, logErro });
      } catch (eEmail) {
        logErro.warn(`Email de conclusÃ£o nÃ£o enviado: ${eEmail.message}`);
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
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  try {
    const tR = await pool.request().input('id', sql.Int, id).query('SELECT titulo FROM agenda_tarefas WHERE id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM agenda_anexos WHERE tarefa_id=@id');
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM agenda_passos WHERE tarefa_id=@id');
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM agenda_tarefas WHERE id=@id');
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EXCLUSAO', sistema: 'agenda', detalhes: `Tarefa excluÃ­da: "${tR.recordset[0]?.titulo}"` });
    res.json({ sucesso: true, mensagem: 'Tarefa excluÃ­da.' });
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
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

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
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });
  if (!texto?.trim()) return res.status(400).json({ erro: 'Informe o texto do passo.' });

  try {
    const maxOrdem = await pool.request().input('id', sql.Int, id)
      .query('SELECT ISNULL(MAX(ordem), 0) AS max_ordem FROM agenda_passos WHERE tarefa_id=@id');
    const ordem = (maxOrdem.recordset[0].max_ordem || 0) + 1;

    // âœ… FALLBACK: Se nÃ£o tem colaborador, usa o criador da tarefa
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

    // ðŸ“§ EMAIL SERÃ DISPARADO PELO ENDPOINT POST /api/agenda/tarefas/:id/notificar
    // Removido daqui para consolidar em 1 email por salvar de tarefa (nÃ£o 1 por passo)

    res.json({ sucesso: true, id: passoId });
  } catch (erro) {
    logErro.error(`Erro ao criar passo: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar passo.' });
  }
});

// ============================================================
// PATCH /api/agenda/passos/:id â€” Atualizar passo (texto, colaboradores)
// ============================================================
router.patch('/api/agenda/passos/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { texto, atribuido_para } = req.body;

  const p = await pool.request().input('id', sql.Int, id)
    .query('SELECT ap.tarefa_id, at.lista_id FROM agenda_passos ap JOIN agenda_tarefas at ON at.id=ap.tarefa_id WHERE ap.id=@id');
  if (!p.recordset[0]) return res.status(404).json({ erro: 'Passo nÃ£o encontrado.' });

  const perm = await getPermissao(pool, p.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

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
      console.warn(`âš  Nenhuma linha atualizada para ID ${id}`);
      return res.status(404).json({ erro: 'Passo nÃ£o encontrado.' });
    }

    console.log(`âœ… Passo ${id} atualizado com sucesso!`);

    // ðŸ“§ EMAIL SERÃ DISPARADO PELO ENDPOINT POST /api/agenda/tarefas/:id/notificar
    // Removido daqui para consolidar em 1 email por salvar de tarefa

    res.json({ sucesso: true, mensagem: 'Passo atualizado.' });
  } catch (erro) {
    logErro.error(`Erro ao atualizar passo: ${erro.message}`);
    console.error(`âŒ Erro detalhado:`, erro);
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
  if (!p.recordset[0]) return res.status(404).json({ erro: 'Passo nÃ£o encontrado.' });

  const perm = await getPermissao(pool, p.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  try {
    if (concluido) {
      // Quando marcar como concluÃ­do, registra quem fez e quando
      await pool.request()
        .input('id',            sql.Int,     id)
        .input('concluido',     sql.Bit,     1)
        .input('executado_por', sql.VarChar, usuario)
        .input('executado_em',  sql.DateTime, new Date())
        .query('UPDATE agenda_passos SET concluido=@concluido, executado_por=@executado_por, executado_em=@executado_em WHERE id=@id');
    } else {
      // Quando desmarcar, limpa os dados de execuÃ§Ã£o
      await pool.request()
        .input('id',        sql.Int, id)
        .input('concluido', sql.Bit, 0)
        .query('UPDATE agenda_passos SET concluido=@concluido, executado_por=NULL, executado_em=NULL WHERE id=@id');
    }

    // âœ… NotificaÃ§Ã£o de passo concluÃ­do (somente ao marcar, nÃ£o ao desmarcar)
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

          // Texto do passo que foi concluÃ­do
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
            titulo:           tarefa?.titulo || 'Sem tÃ­tulo',
            lista:            tarefa?.lista_nome || 'Minhas tarefas',
            passo:            passoData?.texto || 'â€”',
            executado_por:    usuario,
            email_criado_por: emailCriador,
            email_atribuido:  emailsColabs
          });
          await enviarWhatsAppAgenda(pool, 'agenda.passo_concluido', {
            listaId: tarefa?.lista_id,
            listaNome: tarefa?.lista_nome || 'Minhas tarefas',
            tarefa: { titulo: tarefa?.titulo || 'Sem titulo' },
            criadoPor: tarefa?.criado_por,
            atribuidos: parseLoginsJson(passoData?.atribuido_para),
            passoTexto: passoData?.texto || '-',
            usuarioAcao: usuario,
          }, { usuario, ip: req.ip, logErro });
        } catch (eEmail) {
          logErro.warn(`Email passo_concluido nÃ£o enviado: ${eEmail.message}`);
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
  if (!p.recordset[0]) return res.status(404).json({ erro: 'Passo nÃ£o encontrado.' });

  const perm = await getPermissao(pool, p.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  try {
    const passo = p.recordset[0];

    // Atualizar atribuiÃ§Ã£o
    await pool.request()
      .input('id', sql.Int, id)
      .input('atribuido_para', sql.VarChar, atribuido_para || null)
      .query('UPDATE agenda_passos SET atribuido_para=@atribuido_para WHERE id=@id');

    // ðŸ“§ Email Ã© enviado pelo endpoint PATCH /api/agenda/passos/:id
    // Este endpoint Ã© usado apenas para retrocompatibilidade

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
  if (!p.recordset[0]) return res.status(404).json({ erro: 'Passo nÃ£o encontrado.' });

  const perm = await getPermissao(pool, p.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

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
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });
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
  if (!c.recordset[0]) return res.status(404).json({ erro: 'Categoria nÃ£o encontrada.' });

  const perm = await getPermissao(pool, c.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  try {
    await pool.request().input('id', sql.Int, id)
      .query('UPDATE agenda_tarefas SET categoria_id=NULL WHERE categoria_id=@id');
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM agenda_categorias WHERE id=@id');
    res.json({ sucesso: true, mensagem: 'Categoria excluÃ­da.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir categoria: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir categoria.' });
  }
});

// ============================================================
// GET /agenda/relatorios â€” Serve a pÃ¡gina de relatÃ³rios
// ============================================================
router.get('/agenda/relatorios', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agendaTarefas/relatoriosTarefas.html'));
});

// ============================================================
// GET /api/agenda/relatorios â€” Dados para relatÃ³rios
// ============================================================
router.get('/api/agenda/relatorios', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const { tipo, prazoInicio, prazoFim, lista_id: lId, lista_ids: lIds, categoria_id: catId, status, prioridade, page } = req.query;

  // lista_ids: IDs validados como inteiros (seguro para IN clause)
  const listaIdsArr = lIds
    ? lIds.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0)
    : null;

  const baseFrom = `
    FROM agenda_tarefas t
    JOIN agenda_listas l ON l.id = t.lista_id
    LEFT JOIN agenda_categorias c ON c.id = t.categoria_id
  `;

  function mkReq(extraConds = []) {
    const r = pool.request().input('usuario', sql.VarChar, usuario);
    const conds = ['(l.dono=@usuario OR EXISTS (SELECT 1 FROM agenda_membros m WHERE m.lista_id=l.id AND m.usuario=@usuario))'];
    if (lId)                           { r.input('lista_id',    sql.Int,     parseInt(lId));  conds.push('t.lista_id=@lista_id'); }
    else if (listaIdsArr && listaIdsArr.length > 0) { conds.push(`t.lista_id IN (${listaIdsArr.join(',')})`); }
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

    // Resumido â€” totais
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

    // Por lista â€” sempre retorna (inclui listas prÃ³prias e compartilhadas)
    const { r: rLst, where: wLst } = mkReq();
    const lstR = await rLst.query(`
      SELECT l.nome AS lista, l.cor, COUNT(*) AS total,
             SUM(CASE WHEN t.status='concluida'    THEN 1 ELSE 0 END) AS concluidas,
             SUM(CASE WHEN t.status='a_fazer'      THEN 1 ELSE 0 END) AS a_fazer,
             SUM(CASE WHEN t.status='em_andamento' THEN 1 ELSE 0 END) AS em_andamento
      ${baseFrom} ${wLst}
      GROUP BY l.nome, l.cor
      ORDER BY COUNT(*) DESC
    `);
    const porLista = lstR.recordset;

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
// GET /api/agenda/usuarios â€” Todos os usuÃ¡rios para seletor de membros
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
    logErro.error(`Erro ao listar usuÃ¡rios: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar usuÃ¡rios.' });
  }
});

// ============================================================
// GET /api/agenda/usuarios â€” Lista usuÃ¡rios para atribuiÃ§Ã£o
// ============================================================
router.get('/api/agenda/usuarios', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;

  try {
    // Buscar usuÃ¡rios locais
    const locaisR = await pool.request()
      .query('SELECT usuario AS login, nome FROM usuarios WHERE ativo=1 ORDER BY nome ASC');

    // Buscar usuÃ¡rios do domÃ­nio
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
    logErro.error(`Erro ao listar usuÃ¡rios: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar usuÃ¡rios.' });
  }
});

// ============================================================
// HELPER INTERNO â€” Consolida e envia notificaÃ§Ã£o de tarefa
// Tipo: 'agenda.tarefa_criada' | 'agenda.tarefa_editada'
// ============================================================
async function _notifTarefa(pool, tarefaId, tipo, logErro) {
  try {
    logErro.info(`[_notifTarefa] INICIANDO CADEIA para tarefa=${tarefaId}, tipo=${tipo}`);
    const emailService = require('../services/emailService');

    // 1. Buscar tarefa + lista
    const tR = await pool.request()
      .input('id', sql.Int, tarefaId)
      .query(`SELECT t.lista_id, t.titulo, t.descricao, t.prazo, t.criado_por, l.nome AS lista_nome
              FROM agenda_tarefas t
              LEFT JOIN agenda_listas l ON l.id = t.lista_id
              WHERE t.id = @id`);
    const tarefa = tR.recordset[0];
    if (!tarefa) {
      logErro.warn(`[_notifTarefa] Tarefa ${tarefaId} NÃƒO ENCONTRADA`);
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
    let temColab = false;      // hÃ¡ ao menos 1 passo com colaborador?
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

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // CADEIA DE EVENTOS: Cada evento Ã© verificado independentemente
    // Se o evento estÃ¡ desabilitado na config, o emailService pula silenciosamente
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    await enviarWhatsAppAgenda(pool, tipo, {
      listaId: tarefa.lista_id,
      listaNome: tarefa.lista_nome || 'Minhas tarefas',
      tarefa: { titulo: tarefa.titulo },
      criadoPor: tarefa.criado_por,
      atribuidos: [...loginsSet],
      usuarioAcao: tarefa.criado_por,
    }, { usuario: tarefa.criado_por, ip: '::1', logErro });

    // Se hÃ¡ colaboradores nos passos E Ã© criaÃ§Ã£o nova â†’ tambÃ©m dispara passo_atribuido
    if (tipo === 'agenda.tarefa_criada' && temColab && emailsColabs.length > 0) {
      logErro.info(`[_notifTarefa] Disparando evento ADICIONAL: agenda.passo_atribuido`);
      await emailService.enviarNotificacao(pool, 'agenda.passo_atribuido', dadosComuns);
      await enviarWhatsAppAgenda(pool, 'agenda.passo_atribuido', {
        listaId: tarefa.lista_id,
        listaNome: tarefa.lista_nome || 'Minhas tarefas',
        tarefa: { titulo: tarefa.titulo },
        criadoPor: tarefa.criado_por,
        atribuidos: [...loginsSet],
        usuarioAcao: tarefa.criado_por,
      }, { usuario: tarefa.criado_por, ip: '::1', logErro });
    }

    logErro.info(`[_notifTarefa] âœ… CADEIA COMPLETA para tarefa ${tarefaId}`);
  } catch (err) {
    logErro?.error(`[_notifTarefa] âŒ ERRO na cadeia: ${err.message}`);
  }
}

// ============================================================
// GET /api/agenda/tarefas/:id/anexos â€” listar anexos (sem dados)
// ============================================================
router.get('/api/agenda/tarefas/:id/anexos', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const t = await pool.request().input('id', sql.Int, id)
    .query('SELECT lista_id FROM agenda_tarefas WHERE id=@id');
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso.' });

  try {
    const r = await pool.request().input('tarefa_id', sql.Int, id)
      .query('SELECT id, nome, tipo, tamanho, criado_por, criado_em FROM agenda_anexos WHERE tarefa_id=@tarefa_id ORDER BY criado_em');
    res.json({ sucesso: true, anexos: r.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar anexos: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar anexos.' });
  }
});

// ============================================================
// GET /api/agenda/anexos/:id/dados â€” retorna dados base64 de um anexo
// ============================================================
router.get('/api/agenda/anexos/:id/dados', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const a = await pool.request().input('id', sql.Int, id)
    .query('SELECT aa.dados, at.lista_id FROM agenda_anexos aa JOIN agenda_tarefas at ON at.id=aa.tarefa_id WHERE aa.id=@id');
  if (!a.recordset[0]) return res.status(404).json({ erro: 'Anexo nÃ£o encontrado.' });

  const perm = await getPermissao(pool, a.recordset[0].lista_id, usuario);
  if (!perm) return res.status(403).json({ erro: 'Sem acesso.' });

  try {
    res.json({ sucesso: true, dados: a.recordset[0].dados });
  } catch (erro) {
    logErro.error(`Erro ao obter dados do anexo: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao obter anexo.' });
  }
});

// ============================================================
// POST /api/agenda/tarefas/:id/anexos â€” adicionar anexo (base64)
// ============================================================
router.post('/api/agenda/tarefas/:id/anexos', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { nome, tipo, tamanho, dados } = req.body;

  if (!nome?.trim()) return res.status(400).json({ erro: 'Informe o nome do arquivo.' });
  if (!dados)        return res.status(400).json({ erro: 'Dados do arquivo ausentes.' });

  const t = await pool.request().input('id', sql.Int, id)
    .query('SELECT lista_id FROM agenda_tarefas WHERE id=@id');
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  try {
    const r = await pool.request()
      .input('tarefa_id',  sql.Int,      id)
      .input('nome',       sql.NVarChar, nome.trim())
      .input('tipo',       sql.NVarChar, tipo || '')
      .input('tamanho',    sql.Int,      tamanho || null)
      .input('dados',      sql.NVarChar, dados)
      .input('criado_por', sql.NVarChar, usuario)
      .query(`
        INSERT INTO agenda_anexos (tarefa_id, nome, tipo, tamanho, dados, criado_por, criado_em)
        OUTPUT INSERTED.id, INSERTED.nome, INSERTED.tipo, INSERTED.tamanho, INSERTED.criado_em
        VALUES (@tarefa_id, @nome, @tipo, @tamanho, @dados, @criado_por, GETDATE())
      `);
    res.json({ sucesso: true, anexo: r.recordset[0] });
  } catch (erro) {
    logErro.error(`Erro ao salvar anexo: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao salvar anexo.' });
  }
});

// ============================================================
// DELETE /api/agenda/anexos/:id â€” excluir anexo
// ============================================================
router.delete('/api/agenda/anexos/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const a = await pool.request().input('id', sql.Int, id)
    .query('SELECT aa.tarefa_id, at.lista_id FROM agenda_anexos aa JOIN agenda_tarefas at ON at.id=aa.tarefa_id WHERE aa.id=@id');
  if (!a.recordset[0]) return res.status(404).json({ erro: 'Anexo nÃ£o encontrado.' });

  const perm = await getPermissao(pool, a.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  try {
    await pool.request().input('id', sql.Int, id).query('DELETE FROM agenda_anexos WHERE id=@id');
    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao excluir anexo: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir anexo.' });
  }
});

// ============================================================
// PATCH /api/agenda/tarefas/:id/passos/reordenar
// body: { ids: [3, 1, 2, ...] }  â€” nova ordem dos passos
// ============================================================
router.patch('/api/agenda/tarefas/:id/passos/reordenar', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ erro: 'Informe o array de IDs.' });

  const t = await pool.request().input('id', sql.Int, id)
    .query('SELECT lista_id FROM agenda_tarefas WHERE id=@id');
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

  const perm = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o.' });

  try {
    for (let i = 0; i < ids.length; i++) {
      await pool.request()
        .input('ordem',     sql.Int, i + 1)
        .input('id',        sql.Int, ids[i])
        .input('tarefa_id', sql.Int, id)
        .query('UPDATE agenda_passos SET ordem=@ordem WHERE id=@id AND tarefa_id=@tarefa_id');
    }
    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao reordenar passos: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao reordenar passos.' });
  }
});

// ============================================================
// PATCH /api/agenda/tarefas/:id/transferir
// body: { nova_lista_id }
// ============================================================
router.patch('/api/agenda/tarefas/:id/transferir', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { nova_lista_id } = req.body;

  if (!nova_lista_id) return res.status(400).json({ erro: 'Informe a lista de destino.' });

  const t = await pool.request().input('id', sql.Int, id)
    .query('SELECT lista_id, titulo FROM agenda_tarefas WHERE id=@id');
  if (!t.recordset[0]) return res.status(404).json({ erro: 'Tarefa nÃ£o encontrada.' });

  const permOrigem  = await getPermissao(pool, t.recordset[0].lista_id, usuario);
  const permDestino = await getPermissao(pool, nova_lista_id, usuario);

  if (!temPermissao(permOrigem,  'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o na lista de origem.' });
  if (!temPermissao(permDestino, 'edicao')) return res.status(403).json({ erro: 'Sem permissÃ£o na lista de destino.' });

  try {
    await pool.request()
      .input('nova_lista_id', sql.Int, nova_lista_id)
      .input('id',            sql.Int, id)
      .query('UPDATE agenda_tarefas SET lista_id=@nova_lista_id WHERE id=@id');

    await registrarLog(pool, {
      usuario, ip: req.ip, acao: 'TRANSFERENCIA', sistema: 'agenda',
      detalhes: `Tarefa #${id} "${t.recordset[0].titulo}" transferida para lista #${nova_lista_id}`
    });

    res.json({ sucesso: true, mensagem: 'Tarefa transferida.' });
  } catch (erro) {
    logErro.error(`Erro ao transferir tarefa: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao transferir tarefa.' });
  }
});

module.exports = router;


