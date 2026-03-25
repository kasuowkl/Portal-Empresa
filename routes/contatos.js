/**
 * ARQUIVO: routes/contatos.js
 * VERSÃO:  1.0.0
 * DATA:    2026-03-09
 * DESCRIÇÃO: Rotas da Agenda de Contatos
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
      SELECT
        CASE
          WHEN l.dono = @usuario             THEN 'dono'
          WHEN m.permissao IS NOT NULL       THEN m.permissao
          WHEN l.tipo = 'empresa'            THEN 'leitura'
          ELSE NULL
        END AS permissao
      FROM contatos_listas l
      LEFT JOIN contatos_membros m ON m.lista_id = l.id AND m.usuario = @usuario
      WHERE l.id = @lista_id
    `);
  return result.recordset[0]?.permissao || null;
}

const NIVEL = { leitura: 1, edicao: 2, dono: 3 };
function temPermissao(perm, nivelMinimo) {
  return !!perm && (NIVEL[perm] || 0) >= (NIVEL[nivelMinimo] || 0);
}

// ============================================================
// GET /contatos — Serve a página HTML
// ============================================================
router.get('/contatos', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agendaContatos/index.html'));
});

// ============================================================
// GET /api/contatos/listas — Listas do usuário (dono + membro)
// ============================================================
router.get('/api/contatos/listas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  try {
    const result = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .query(`
        SELECT l.id, l.nome, l.descricao, l.cor, l.icone, l.tipo, l.dono, l.criado_em,
               CASE
                 WHEN l.dono = @usuario       THEN 'dono'
                 WHEN m.permissao IS NOT NULL THEN m.permissao
                 WHEN l.tipo = 'empresa'      THEN 'leitura'
                 ELSE NULL
               END AS permissao,
               COALESCE(u.nome, ud.nome, l.dono) AS dono_nome,
               (SELECT COUNT(*) FROM contatos c WHERE c.lista_id = l.id) AS total_contatos
        FROM contatos_listas l
        LEFT JOIN contatos_membros  m  ON m.lista_id = l.id AND m.usuario = @usuario
        LEFT JOIN usuarios          u  ON u.usuario  = l.dono
        LEFT JOIN usuarios_dominio  ud ON ud.login   = l.dono AND u.usuario IS NULL
        WHERE l.dono = @usuario OR m.usuario = @usuario OR l.tipo = 'empresa'
        ORDER BY l.tipo DESC, l.criado_em ASC
      `);
    res.json({ sucesso: true, listas: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar listas de contatos: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar listas.' });
  }
});

// ============================================================
// POST /api/contatos/listas — Criar lista
// ============================================================
router.post('/api/contatos/listas', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const { nome, descricao, cor, icone, tipo } = req.body;
  if (!nome?.trim()) return res.status(400).json({ erro: 'Nome é obrigatório.' });
  const tipoLista = tipo === 'empresa' ? 'empresa' : 'pessoal';
  try {
    const result = await pool.request()
      .input('nome',      sql.VarChar, nome.trim())
      .input('descricao', sql.VarChar, descricao || null)
      .input('cor',       sql.VarChar, cor    || '#3b82f6')
      .input('icone',     sql.VarChar, icone  || 'fas fa-address-book')
      .input('tipo',      sql.VarChar, tipoLista)
      .input('dono',      sql.VarChar, usuario)
      .query(`
        INSERT INTO contatos_listas (nome, descricao, cor, icone, tipo, dono)
        OUTPUT INSERTED.id, INSERTED.nome, INSERTED.descricao, INSERTED.cor, INSERTED.icone, INSERTED.tipo, INSERTED.dono, INSERTED.criado_em
        VALUES (@nome, @descricao, @cor, @icone, @tipo, @dono)
      `);
    registrarLog(pool, { usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'contatos', detalhes: `Lista de contatos "${nome.trim()}" criada (${tipoLista})` });
    res.json({ sucesso: true, lista: { ...result.recordset[0], permissao: 'dono', total_contatos: 0 } });
  } catch (erro) {
    logErro.error(`Erro ao criar lista de contatos: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar lista.' });
  }
});

// ============================================================
// PUT /api/contatos/listas/:id — Editar lista (dono)
// ============================================================
router.put('/api/contatos/listas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const listaId = parseInt(req.params.id);
  const perm = await getPermissao(pool, listaId, usuario);
  if (!temPermissao(perm, 'dono')) return res.status(403).json({ erro: 'Sem permissão.' });
  const { nome, descricao, cor, icone, tipo } = req.body;
  if (!nome?.trim()) return res.status(400).json({ erro: 'Nome é obrigatório.' });
  const tipoLista = tipo === 'empresa' ? 'empresa' : 'pessoal';
  try {
    await pool.request()
      .input('id',        sql.Int,     listaId)
      .input('nome',      sql.VarChar, nome.trim())
      .input('descricao', sql.VarChar, descricao || null)
      .input('cor',       sql.VarChar, cor   || '#3b82f6')
      .input('icone',     sql.VarChar, icone || 'fas fa-address-book')
      .input('tipo',      sql.VarChar, tipoLista)
      .query(`UPDATE contatos_listas SET nome=@nome, descricao=@descricao, cor=@cor, icone=@icone, tipo=@tipo WHERE id=@id`);
    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao editar lista de contatos: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao editar lista.' });
  }
});

// ============================================================
// DELETE /api/contatos/listas/:id — Excluir lista (dono)
// ============================================================
router.delete('/api/contatos/listas/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const listaId = parseInt(req.params.id);
  const perm = await getPermissao(pool, listaId, usuario);
  if (!temPermissao(perm, 'dono')) return res.status(403).json({ erro: 'Sem permissão.' });
  try {
    await pool.request().input('id', sql.Int, listaId)
      .query(`DELETE FROM contatos_listas WHERE id = @id`);
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EXCLUSAO', sistema: 'contatos', detalhes: `Lista de contatos #${listaId} excluída` });
    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao excluir lista de contatos: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir lista.' });
  }
});

// ============================================================
// GET /api/contatos/listas/:id/membros
// ============================================================
router.get('/api/contatos/listas/:id/membros', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const listaId = parseInt(req.params.id);
  const perm = await getPermissao(pool, listaId, usuario);
  if (!temPermissao(perm, 'leitura')) return res.status(403).json({ erro: 'Sem permissão.' });
  try {
    const result = await pool.request()
      .input('lista_id', sql.Int, listaId)
      .query(`
        SELECT m.usuario, m.permissao, m.adicionado_em,
               COALESCE(u.nome, ud.nome, m.usuario) AS nome
        FROM contatos_membros m
        LEFT JOIN usuarios         u  ON u.usuario = m.usuario
        LEFT JOIN usuarios_dominio ud ON ud.login  = m.usuario AND u.usuario IS NULL
        WHERE m.lista_id = @lista_id
        ORDER BY m.adicionado_em ASC
      `);
    res.json({ sucesso: true, membros: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar membros: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar membros.' });
  }
});

// ============================================================
// POST /api/contatos/listas/:id/membros — Adicionar membro (dono)
// ============================================================
router.post('/api/contatos/listas/:id/membros', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const listaId = parseInt(req.params.id);
  const perm = await getPermissao(pool, listaId, usuario);
  if (!temPermissao(perm, 'dono')) return res.status(403).json({ erro: 'Sem permissão.' });
  const { usuario: novo, permissao } = req.body;
  if (!novo?.trim()) return res.status(400).json({ erro: 'Usuário obrigatório.' });

  // Verifica se o dono da lista
  const lista = await pool.request().input('id', sql.Int, listaId)
    .query('SELECT dono FROM contatos_listas WHERE id = @id');
  if (lista.recordset[0]?.dono === novo.trim()) return res.status(400).json({ erro: 'O dono já tem acesso total.' });

  try {
    await pool.request()
      .input('lista_id',  sql.Int,     listaId)
      .input('usuario',   sql.VarChar, novo.trim())
      .input('permissao', sql.VarChar, permissao || 'leitura')
      .query(`
        MERGE contatos_membros AS t
        USING (SELECT @lista_id AS lista_id, @usuario AS usuario) AS s
        ON t.lista_id = s.lista_id AND t.usuario = s.usuario
        WHEN MATCHED THEN UPDATE SET permissao = @permissao
        WHEN NOT MATCHED THEN INSERT (lista_id, usuario, permissao) VALUES (@lista_id, @usuario, @permissao);
      `);
    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao adicionar membro: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao adicionar membro.' });
  }
});

// ============================================================
// DELETE /api/contatos/listas/:id/membros/:usuario — Remover membro (dono)
// ============================================================
router.delete('/api/contatos/listas/:id/membros/:usuario', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const listaId = parseInt(req.params.id);
  const perm = await getPermissao(pool, listaId, usuario);
  if (!temPermissao(perm, 'dono')) return res.status(403).json({ erro: 'Sem permissão.' });
  try {
    await pool.request()
      .input('lista_id', sql.Int,     listaId)
      .input('usuario',  sql.VarChar, req.params.usuario)
      .query(`DELETE FROM contatos_membros WHERE lista_id = @lista_id AND usuario = @usuario`);
    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao remover membro: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao remover membro.' });
  }
});

// ============================================================
// GET /api/contatos/listas/:id/contatos — Listar contatos
// ============================================================
router.get('/api/contatos/listas/:id/contatos', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const listaId = parseInt(req.params.id);
  const perm = await getPermissao(pool, listaId, usuario);
  if (!temPermissao(perm, 'leitura')) return res.status(403).json({ erro: 'Sem permissão.' });
  const { busca, favorito } = req.query;
  try {
    let where = 'WHERE lista_id = @lista_id';
    if (busca)   where += ` AND (nome LIKE @busca OR empresa LIKE @busca OR email_pessoal LIKE @busca OR email_corporativo LIKE @busca OR cel_pessoal LIKE @busca OR cel_corporativo LIKE @busca OR tags LIKE @busca)`;
    if (favorito === '1') where += ' AND favorito = 1';

    const req2 = pool.request().input('lista_id', sql.Int, listaId);
    if (busca) req2.input('busca', sql.VarChar, `%${busca}%`);

    const result = await req2.query(`SELECT * FROM contatos ${where} ORDER BY favorito DESC, nome ASC`);
    res.json({ sucesso: true, contatos: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar contatos: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar contatos.' });
  }
});

// ============================================================
// POST /api/contatos/listas/:id/contatos — Criar contato
// ============================================================
router.post('/api/contatos/listas/:id/contatos', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const listaId = parseInt(req.params.id);
  const perm = await getPermissao(pool, listaId, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });
  const d = req.body;
  if (!d.nome?.trim()) return res.status(400).json({ erro: 'Nome é obrigatório.' });
  try {
    const result = await pool.request()
      .input('lista_id',          sql.Int,      listaId)
      .input('nome',              sql.VarChar,  d.nome?.trim() || null)
      .input('cargo',             sql.VarChar,  d.cargo        || null)
      .input('empresa',           sql.VarChar,  d.empresa      || null)
      .input('departamento',      sql.VarChar,  d.departamento || null)
      .input('cel_pessoal',       sql.VarChar,  d.cel_pessoal       || null)
      .input('cel_corporativo',   sql.VarChar,  d.cel_corporativo   || null)
      .input('tel_fixo',          sql.VarChar,  d.tel_fixo          || null)
      .input('tel_ramal',         sql.VarChar,  d.tel_ramal         || null)
      .input('whatsapp',          sql.VarChar,  d.whatsapp          || null)
      .input('email_pessoal',     sql.VarChar,  d.email_pessoal     || null)
      .input('email_corporativo', sql.VarChar,  d.email_corporativo || null)
      .input('linkedin',          sql.VarChar,  d.linkedin    || null)
      .input('facebook',          sql.VarChar,  d.facebook    || null)
      .input('instagram',         sql.VarChar,  d.instagram   || null)
      .input('twitter',           sql.VarChar,  d.twitter     || null)
      .input('site',              sql.VarChar,  d.site        || null)
      .input('cnpj_cpf',          sql.VarChar,  d.cnpj_cpf    || null)
      .input('endereco',          sql.VarChar,  d.endereco    || null)
      .input('cidade',            sql.VarChar,  d.cidade      || null)
      .input('estado',            sql.VarChar,  d.estado      || null)
      .input('cep',               sql.VarChar,  d.cep         || null)
      .input('pais',              sql.VarChar,  d.pais        || 'Brasil')
      .input('data_nascimento',   sql.Date,     d.data_nascimento || null)
      .input('tags',              sql.VarChar,  d.tags        || null)
      .input('observacoes',       sql.NVarChar, d.observacoes || null)
      .input('favorito',          sql.Bit,      d.favorito    ? 1 : 0)
      .input('criado_por',        sql.VarChar,  usuario)
      .query(`
        INSERT INTO contatos
          (lista_id, nome, cargo, empresa, departamento,
           cel_pessoal, cel_corporativo, tel_fixo, tel_ramal, whatsapp,
           email_pessoal, email_corporativo,
           linkedin, facebook, instagram, twitter,
           site, cnpj_cpf, endereco, cidade, estado, cep, pais,
           data_nascimento, tags, observacoes, favorito, criado_por)
        OUTPUT INSERTED.*
        VALUES
          (@lista_id, @nome, @cargo, @empresa, @departamento,
           @cel_pessoal, @cel_corporativo, @tel_fixo, @tel_ramal, @whatsapp,
           @email_pessoal, @email_corporativo,
           @linkedin, @facebook, @instagram, @twitter,
           @site, @cnpj_cpf, @endereco, @cidade, @estado, @cep, @pais,
           @data_nascimento, @tags, @observacoes, @favorito, @criado_por)
      `);
    registrarLog(pool, { usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'contatos', detalhes: `Contato criado: ${d.nome?.trim()}${d.empresa ? ` — ${d.empresa}` : ''}` });
    res.json({ sucesso: true, contato: result.recordset[0] });
  } catch (erro) {
    logErro.error(`Erro ao criar contato: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar contato.' });
  }
});

// ============================================================
// PUT /api/contatos/:id — Editar contato
// ============================================================
router.put('/api/contatos/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);

  const cont = await pool.request().input('id', sql.Int, id).query('SELECT lista_id FROM contatos WHERE id = @id');
  if (!cont.recordset.length) return res.status(404).json({ erro: 'Contato não encontrado.' });
  const perm = await getPermissao(pool, cont.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });

  const d = req.body;
  if (!d.nome?.trim()) return res.status(400).json({ erro: 'Nome é obrigatório.' });
  try {
    await pool.request()
      .input('id',                sql.Int,      id)
      .input('nome',              sql.VarChar,  d.nome?.trim() || null)
      .input('cargo',             sql.VarChar,  d.cargo        || null)
      .input('empresa',           sql.VarChar,  d.empresa      || null)
      .input('departamento',      sql.VarChar,  d.departamento || null)
      .input('cel_pessoal',       sql.VarChar,  d.cel_pessoal       || null)
      .input('cel_corporativo',   sql.VarChar,  d.cel_corporativo   || null)
      .input('tel_fixo',          sql.VarChar,  d.tel_fixo          || null)
      .input('tel_ramal',         sql.VarChar,  d.tel_ramal         || null)
      .input('whatsapp',          sql.VarChar,  d.whatsapp          || null)
      .input('email_pessoal',     sql.VarChar,  d.email_pessoal     || null)
      .input('email_corporativo', sql.VarChar,  d.email_corporativo || null)
      .input('linkedin',          sql.VarChar,  d.linkedin    || null)
      .input('facebook',          sql.VarChar,  d.facebook    || null)
      .input('instagram',         sql.VarChar,  d.instagram   || null)
      .input('twitter',           sql.VarChar,  d.twitter     || null)
      .input('site',              sql.VarChar,  d.site        || null)
      .input('cnpj_cpf',          sql.VarChar,  d.cnpj_cpf    || null)
      .input('endereco',          sql.VarChar,  d.endereco    || null)
      .input('cidade',            sql.VarChar,  d.cidade      || null)
      .input('estado',            sql.VarChar,  d.estado      || null)
      .input('cep',               sql.VarChar,  d.cep         || null)
      .input('pais',              sql.VarChar,  d.pais        || 'Brasil')
      .input('data_nascimento',   sql.Date,     d.data_nascimento || null)
      .input('tags',              sql.VarChar,  d.tags        || null)
      .input('observacoes',       sql.NVarChar, d.observacoes || null)
      .input('favorito',          sql.Bit,      d.favorito    ? 1 : 0)
      .query(`
        UPDATE contatos SET
          nome=@nome, cargo=@cargo, empresa=@empresa, departamento=@departamento,
          cel_pessoal=@cel_pessoal, cel_corporativo=@cel_corporativo,
          tel_fixo=@tel_fixo, tel_ramal=@tel_ramal, whatsapp=@whatsapp,
          email_pessoal=@email_pessoal, email_corporativo=@email_corporativo,
          linkedin=@linkedin, facebook=@facebook, instagram=@instagram, twitter=@twitter,
          site=@site, cnpj_cpf=@cnpj_cpf,
          endereco=@endereco, cidade=@cidade, estado=@estado, cep=@cep, pais=@pais,
          data_nascimento=@data_nascimento, tags=@tags, observacoes=@observacoes,
          favorito=@favorito, atualizado_em=GETDATE()
        WHERE id = @id
      `);
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'contatos', detalhes: `Contato editado: ${d.nome?.trim()}${d.empresa ? ` — ${d.empresa}` : ''}` });
    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao editar contato: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao editar contato.' });
  }
});

// ============================================================
// PATCH /api/contatos/:id/favorito — Alternar favorito
// ============================================================
router.patch('/api/contatos/:id/favorito', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const cont = await pool.request().input('id', sql.Int, id).query('SELECT lista_id, favorito FROM contatos WHERE id = @id');
  if (!cont.recordset.length) return res.status(404).json({ erro: 'Contato não encontrado.' });
  const perm = await getPermissao(pool, cont.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });
  try {
    const novoFav = cont.recordset[0].favorito ? 0 : 1;
    await pool.request().input('id', sql.Int, id).input('fav', sql.Bit, novoFav)
      .query('UPDATE contatos SET favorito=@fav, atualizado_em=GETDATE() WHERE id=@id');
    res.json({ sucesso: true, favorito: novoFav });
  } catch (erro) {
    logErro.error(`Erro ao alternar favorito: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao atualizar favorito.' });
  }
});

// ============================================================
// DELETE /api/contatos/:id — Excluir contato
// ============================================================
router.delete('/api/contatos/:id', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const cont = await pool.request().input('id', sql.Int, id).query('SELECT lista_id FROM contatos WHERE id = @id');
  if (!cont.recordset.length) return res.status(404).json({ erro: 'Contato não encontrado.' });
  const perm = await getPermissao(pool, cont.recordset[0].lista_id, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });
  try {
    const cR = await pool.request().input('id', sql.Int, id).query('SELECT nome, empresa FROM contatos WHERE id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM contatos WHERE id = @id');
    const c = cR.recordset[0];
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EXCLUSAO', sistema: 'contatos', detalhes: `Contato excluído: ${c?.nome}${c?.empresa ? ` — ${c.empresa}` : ''}` });
    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao excluir contato: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir contato.' });
  }
});

// ============================================================
// GET /api/contatos/listas/:id/exportar — Exporta contatos como CSV
// ============================================================
router.get('/api/contatos/listas/:id/exportar', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const listaId = parseInt(req.params.id);
  const perm = await getPermissao(pool, listaId, usuario);
  if (!temPermissao(perm, 'leitura')) return res.status(403).json({ erro: 'Sem permissão.' });

  try {
    const lista  = await pool.request().input('id', sql.Int, listaId).query('SELECT nome FROM contatos_listas WHERE id = @id');
    const result = await pool.request().input('lista_id', sql.Int, listaId)
      .query('SELECT * FROM contatos WHERE lista_id = @lista_id ORDER BY nome ASC');

    const CAMPOS = ['nome','cargo','empresa','departamento','cel_pessoal','cel_corporativo',
      'tel_fixo','tel_ramal','whatsapp','email_pessoal','email_corporativo',
      'linkedin','facebook','instagram','twitter','site','cnpj_cpf',
      'endereco','cidade','estado','cep','pais','data_nascimento','tags','observacoes'];

    const esc = v => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g,'""')}"`;
      return s;
    };

    let csv = '\uFEFF' + CAMPOS.join(',') + '\r\n';
    result.recordset.forEach(c => {
      csv += CAMPOS.map(f => {
        if (f === 'data_nascimento' && c[f]) return esc(new Date(c[f]).toISOString().substring(0,10));
        return esc(c[f]);
      }).join(',') + '\r\n';
    });

    const nomeLista = (lista.recordset[0]?.nome || 'contatos').replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contatos_${nomeLista}.csv"`);
    res.send(csv);
  } catch (erro) {
    logErro.error(`Erro ao exportar contatos: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao exportar.' });
  }
});

// ============================================================
// GET /api/contatos/listas/:id/exportar-vcf — Exporta como vCard 3.0
// ============================================================
router.get('/api/contatos/listas/:id/exportar-vcf', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const listaId = parseInt(req.params.id);
  const perm = await getPermissao(pool, listaId, usuario);
  if (!temPermissao(perm, 'leitura')) return res.status(403).json({ erro: 'Sem permissão.' });

  try {
    const lista  = await pool.request().input('id', sql.Int, listaId).query('SELECT nome FROM contatos_listas WHERE id = @id');
    const result = await pool.request().input('lista_id', sql.Int, listaId)
      .query('SELECT * FROM contatos WHERE lista_id = @lista_id ORDER BY nome ASC');

    // vCard line folding — max 75 chars, continuation indented with space
    const fold = line => {
      if (line.length <= 75) return line;
      let out = '';
      while (line.length > 75) { out += line.substring(0, 75) + '\r\n '; line = line.substring(75); }
      return out + line;
    };
    const ev = v => v ? String(v).replace(/\\/g,'\\\\').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\n/g,'\\n') : '';

    let vcf = '';
    for (const c of result.recordset) {
      vcf += 'BEGIN:VCARD\r\n';
      vcf += 'VERSION:3.0\r\n';
      if (c.nome) {
        vcf += fold(`FN:${ev(c.nome)}`) + '\r\n';
        const p = c.nome.trim().split(' ');
        const last = p.length > 1 ? p[p.length - 1] : '';
        const first = p.length > 1 ? p.slice(0, -1).join(' ') : p[0];
        vcf += fold(`N:${ev(last)};${ev(first)};;;`) + '\r\n';
      }
      if (c.empresa)  vcf += fold(`ORG:${ev(c.empresa)}${c.departamento ? ';' + ev(c.departamento) : ''}`) + '\r\n';
      if (c.cargo)    vcf += fold(`TITLE:${ev(c.cargo)}`) + '\r\n';
      if (c.cel_pessoal)     vcf += fold(`TEL;TYPE=CELL,HOME:${ev(c.cel_pessoal)}`) + '\r\n';
      if (c.cel_corporativo) vcf += fold(`TEL;TYPE=CELL,WORK:${ev(c.cel_corporativo)}`) + '\r\n';
      if (c.tel_fixo)  vcf += fold(`TEL;TYPE=VOICE,WORK:${ev(c.tel_fixo)}`) + '\r\n';
      if (c.tel_ramal) vcf += fold(`TEL;TYPE=WORK,X-RAMAL:${ev(c.tel_ramal)}`) + '\r\n';
      if (c.whatsapp)  vcf += fold(`TEL;TYPE=CELL,X-WHATSAPP:${ev(c.whatsapp)}`) + '\r\n';
      if (c.email_pessoal)     vcf += fold(`EMAIL;TYPE=HOME:${ev(c.email_pessoal)}`) + '\r\n';
      if (c.email_corporativo) vcf += fold(`EMAIL;TYPE=WORK:${ev(c.email_corporativo)}`) + '\r\n';
      if (c.site)      vcf += fold(`URL:${ev(c.site)}`) + '\r\n';
      if (c.linkedin)  vcf += fold(`X-SOCIALPROFILE;TYPE=linkedin:${ev(c.linkedin)}`) + '\r\n';
      if (c.facebook)  vcf += fold(`X-SOCIALPROFILE;TYPE=facebook:${ev(c.facebook)}`) + '\r\n';
      if (c.instagram) vcf += fold(`X-SOCIALPROFILE;TYPE=instagram:${ev(c.instagram)}`) + '\r\n';
      if (c.twitter)   vcf += fold(`X-SOCIALPROFILE;TYPE=twitter:${ev(c.twitter)}`) + '\r\n';
      if (c.endereco || c.cidade || c.estado || c.cep || c.pais) {
        vcf += fold(`ADR;TYPE=WORK:;;${ev(c.endereco||'')};${ev(c.cidade||'')};${ev(c.estado||'')};${ev(c.cep||'')};${ev(c.pais||'')}`) + '\r\n';
      }
      if (c.data_nascimento) {
        const bd = new Date(c.data_nascimento).toISOString().substring(0, 10).replace(/-/g, '');
        vcf += `BDAY:${bd}\r\n`;
      }
      if (c.observacoes) vcf += fold(`NOTE:${ev(c.observacoes)}`) + '\r\n';
      vcf += 'END:VCARD\r\n';
    }

    const nomeLista = (lista.recordset[0]?.nome || 'contatos').replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contatos_${nomeLista}.vcf"`);
    res.send(vcf);
  } catch (erro) {
    logErro.error(`Erro ao exportar vCard: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao exportar vCard.' });
  }
});

// ============================================================
// POST /api/contatos/listas/:id/importar — Importa contatos via JSON
// ============================================================
router.post('/api/contatos/listas/:id/importar', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const listaId = parseInt(req.params.id);
  const perm = await getPermissao(pool, listaId, usuario);
  if (!temPermissao(perm, 'edicao')) return res.status(403).json({ erro: 'Sem permissão.' });

  const { contatos: lista } = req.body;
  if (!Array.isArray(lista) || !lista.length) return res.status(400).json({ erro: 'Nenhum contato enviado.' });

  let ok = 0, erros = 0;
  for (const d of lista) {
    if (!d.nome?.trim()) { erros++; continue; }
    try {
      await pool.request()
        .input('lista_id',          sql.Int,      listaId)
        .input('nome',              sql.VarChar,  d.nome?.trim())
        .input('cargo',             sql.VarChar,  d.cargo             || null)
        .input('empresa',           sql.VarChar,  d.empresa           || null)
        .input('departamento',      sql.VarChar,  d.departamento      || null)
        .input('cel_pessoal',       sql.VarChar,  d.cel_pessoal       || null)
        .input('cel_corporativo',   sql.VarChar,  d.cel_corporativo   || null)
        .input('tel_fixo',          sql.VarChar,  d.tel_fixo          || null)
        .input('tel_ramal',         sql.VarChar,  d.tel_ramal         || null)
        .input('whatsapp',          sql.VarChar,  d.whatsapp          || null)
        .input('email_pessoal',     sql.VarChar,  d.email_pessoal     || null)
        .input('email_corporativo', sql.VarChar,  d.email_corporativo || null)
        .input('linkedin',          sql.VarChar,  d.linkedin          || null)
        .input('facebook',          sql.VarChar,  d.facebook          || null)
        .input('instagram',         sql.VarChar,  d.instagram         || null)
        .input('twitter',           sql.VarChar,  d.twitter           || null)
        .input('site',              sql.VarChar,  d.site              || null)
        .input('cnpj_cpf',          sql.VarChar,  d.cnpj_cpf          || null)
        .input('endereco',          sql.VarChar,  d.endereco          || null)
        .input('cidade',            sql.VarChar,  d.cidade            || null)
        .input('estado',            sql.VarChar,  d.estado            || null)
        .input('cep',               sql.VarChar,  d.cep               || null)
        .input('pais',              sql.VarChar,  d.pais              || 'Brasil')
        .input('data_nascimento',   sql.Date,     d.data_nascimento   || null)
        .input('tags',              sql.VarChar,  d.tags              || null)
        .input('observacoes',       sql.NVarChar, d.observacoes       || null)
        .input('criado_por',        sql.VarChar,  usuario)
        .query(`INSERT INTO contatos
          (lista_id,nome,cargo,empresa,departamento,
           cel_pessoal,cel_corporativo,tel_fixo,tel_ramal,whatsapp,
           email_pessoal,email_corporativo,linkedin,facebook,instagram,twitter,
           site,cnpj_cpf,endereco,cidade,estado,cep,pais,
           data_nascimento,tags,observacoes,criado_por)
          VALUES
          (@lista_id,@nome,@cargo,@empresa,@departamento,
           @cel_pessoal,@cel_corporativo,@tel_fixo,@tel_ramal,@whatsapp,
           @email_pessoal,@email_corporativo,@linkedin,@facebook,@instagram,@twitter,
           @site,@cnpj_cpf,@endereco,@cidade,@estado,@cep,@pais,
           @data_nascimento,@tags,@observacoes,@criado_por)`);
      ok++;
    } catch (e) { erros++; }
  }
  res.json({ sucesso: true, importados: ok, erros });
});

// ============================================================
// POST /api/contatos/:id/copiar — Copia contato individual para outra lista
// ============================================================
router.post('/api/contatos/:id/copiar', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { lista_destino } = req.body;
  if (!lista_destino) return res.status(400).json({ erro: 'Lista destino obrigatória.' });

  const cont = await pool.request().input('id', sql.Int, id)
    .query('SELECT * FROM contatos WHERE id = @id');
  if (!cont.recordset.length) return res.status(404).json({ erro: 'Contato não encontrado.' });

  const permOrigem  = await getPermissao(pool, cont.recordset[0].lista_id, usuario);
  const permDestino = await getPermissao(pool, lista_destino, usuario);
  if (!temPermissao(permOrigem,  'leitura')) return res.status(403).json({ erro: 'Sem acesso ao contato.' });
  if (!temPermissao(permDestino, 'edicao'))  return res.status(403).json({ erro: 'Sem permissão na lista destino.' });

  try {
    const c = cont.recordset[0];
    await pool.request()
      .input('lista_id',          sql.Int,      parseInt(lista_destino))
      .input('nome',              sql.VarChar,  c.nome)
      .input('cargo',             sql.VarChar,  c.cargo             || null)
      .input('empresa',           sql.VarChar,  c.empresa           || null)
      .input('departamento',      sql.VarChar,  c.departamento      || null)
      .input('cel_pessoal',       sql.VarChar,  c.cel_pessoal       || null)
      .input('cel_corporativo',   sql.VarChar,  c.cel_corporativo   || null)
      .input('tel_fixo',          sql.VarChar,  c.tel_fixo          || null)
      .input('tel_ramal',         sql.VarChar,  c.tel_ramal         || null)
      .input('whatsapp',          sql.VarChar,  c.whatsapp          || null)
      .input('email_pessoal',     sql.VarChar,  c.email_pessoal     || null)
      .input('email_corporativo', sql.VarChar,  c.email_corporativo || null)
      .input('linkedin',          sql.VarChar,  c.linkedin          || null)
      .input('facebook',          sql.VarChar,  c.facebook          || null)
      .input('instagram',         sql.VarChar,  c.instagram         || null)
      .input('twitter',           sql.VarChar,  c.twitter           || null)
      .input('site',              sql.VarChar,  c.site              || null)
      .input('cnpj_cpf',          sql.VarChar,  c.cnpj_cpf          || null)
      .input('endereco',          sql.VarChar,  c.endereco          || null)
      .input('cidade',            sql.VarChar,  c.cidade            || null)
      .input('estado',            sql.VarChar,  c.estado            || null)
      .input('cep',               sql.VarChar,  c.cep               || null)
      .input('pais',              sql.VarChar,  c.pais              || null)
      .input('data_nascimento',   sql.Date,     c.data_nascimento   || null)
      .input('tags',              sql.VarChar,  c.tags              || null)
      .input('observacoes',       sql.VarChar,  c.observacoes       || null)
      .input('criado_por',        sql.VarChar,  usuario)
      .query(`INSERT INTO contatos (
          lista_id,nome,cargo,empresa,departamento,
          cel_pessoal,cel_corporativo,tel_fixo,tel_ramal,whatsapp,
          email_pessoal,email_corporativo,linkedin,facebook,instagram,twitter,
          site,cnpj_cpf,endereco,cidade,estado,cep,pais,
          data_nascimento,tags,observacoes,criado_por)
        VALUES (
          @lista_id,@nome,@cargo,@empresa,@departamento,
          @cel_pessoal,@cel_corporativo,@tel_fixo,@tel_ramal,@whatsapp,
          @email_pessoal,@email_corporativo,@linkedin,@facebook,@instagram,@twitter,
          @site,@cnpj_cpf,@endereco,@cidade,@estado,@cep,@pais,
          @data_nascimento,@tags,@observacoes,@criado_por)`);

    registrarLog(pool, { usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'contatos',
      detalhes: `Contato "${c.nome}" copiado da lista #${c.lista_id} para #${lista_destino}` });
    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao copiar contato #${id}: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao copiar contato.' });
  }
});

// ============================================================
// PATCH /api/contatos/:id/mover — Mover contato para outra lista
// ============================================================
router.patch('/api/contatos/:id/mover', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id      = parseInt(req.params.id);
  const { lista_destino } = req.body;
  if (!lista_destino) return res.status(400).json({ erro: 'Lista destino obrigatória.' });

  const cont = await pool.request().input('id', sql.Int, id)
    .query('SELECT c.lista_id, l.tipo FROM contatos c JOIN contatos_listas l ON l.id = c.lista_id WHERE c.id = @id');
  if (!cont.recordset.length) return res.status(404).json({ erro: 'Contato não encontrado.' });

  const { lista_id: listaOrigemId, tipo: tipoOrigem } = cont.recordset[0];
  const permOrigem  = await getPermissao(pool, listaOrigemId, usuario);
  const permDestino = await getPermissao(pool, lista_destino, usuario);
  // Listas empresa: qualquer usuário com leitura pode mover
  const nivelOrigem = tipoOrigem === 'empresa' ? 'leitura' : 'edicao';
  if (!temPermissao(permOrigem, nivelOrigem)) return res.status(403).json({ erro: 'Sem permissão na lista origem.' });
  if (!temPermissao(permDestino, 'edicao'))   return res.status(403).json({ erro: 'Sem permissão na lista destino.' });

  try {
    await pool.request()
      .input('id',      sql.Int, id)
      .input('lista_id', sql.Int, lista_destino)
      .query('UPDATE contatos SET lista_id=@lista_id, atualizado_em=GETDATE() WHERE id=@id');
    res.json({ sucesso: true });
  } catch (erro) {
    logErro.error(`Erro ao mover contato: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao mover contato.' });
  }
});

// ============================================================
// POST /api/contatos/listas/:id/copiar — Copia contatos de outra lista para esta
// ============================================================
router.post('/api/contatos/listas/:id/copiar', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const destino = parseInt(req.params.id);
  const { lista_origem } = req.body;
  if (!lista_origem) return res.status(400).json({ erro: 'Lista de origem obrigatória.' });
  const origem = parseInt(lista_origem);

  const permDest = await getPermissao(pool, destino, usuario);
  if (!temPermissao(permDest, 'edicao')) return res.status(403).json({ erro: 'Sem permissão para editar a lista destino.' });

  const permOrig = await getPermissao(pool, origem, usuario);
  if (!temPermissao(permOrig, 'leitura')) return res.status(403).json({ erro: 'Sem acesso à lista de origem.' });

  try {
    const countR = await pool.request()
      .input('origem', sql.Int, origem)
      .query(`SELECT COUNT(*) AS total FROM contatos WHERE lista_id = @origem`);
    const total = countR.recordset[0].total;
    if (!total) return res.json({ sucesso: true, copiados: 0 });

    await pool.request()
      .input('destino', sql.Int, destino)
      .input('origem',  sql.Int, origem)
      .input('usuario', sql.VarChar, usuario)
      .query(`
        INSERT INTO contatos (
          lista_id, nome, cargo, empresa, departamento,
          cel_pessoal, cel_corporativo, tel_fixo, tel_ramal, whatsapp,
          email_pessoal, email_corporativo,
          linkedin, facebook, instagram, twitter,
          site, cnpj_cpf, endereco, cidade, estado, cep, pais,
          data_nascimento, tags, observacoes, favorito, criado_por, criado_em, atualizado_em
        )
        SELECT
          @destino, nome, cargo, empresa, departamento,
          cel_pessoal, cel_corporativo, tel_fixo, tel_ramal, whatsapp,
          email_pessoal, email_corporativo,
          linkedin, facebook, instagram, twitter,
          site, cnpj_cpf, endereco, cidade, estado, cep, pais,
          data_nascimento, tags, observacoes, 0, @usuario, GETDATE(), GETDATE()
        FROM contatos WHERE lista_id = @origem
      `);

    registrarLog(pool, {
      usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'contatos',
      detalhes: `${total} contatos copiados da lista #${origem} para #${destino}`
    });
    res.json({ sucesso: true, copiados: total });
  } catch (erro) {
    logErro.error(`Erro ao copiar contatos: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao copiar contatos.' });
  }
});

// ============================================================
// GET /api/contatos/usuarios — Lista todos os usuários (para seletor de membros)
// ============================================================
router.get('/api/contatos/usuarios', verificarLogin, async (req, res) => {
  const pool    = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  try {
    const r1 = await pool.request().query(`SELECT usuario AS login, nome FROM usuarios WHERE nivel != 'inativo' ORDER BY nome`);
    const r2 = await pool.request().query(`SELECT login, nome FROM usuarios_dominio ORDER BY nome`);
    const todos = [...r1.recordset, ...r2.recordset].reduce((acc, u) => {
      if (!acc.find(x => x.login === u.login)) acc.push(u);
      return acc;
    }, []);
    res.json({ sucesso: true, usuarios: todos });
  } catch (erro) {
    logErro.error(`Erro ao listar usuários: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar usuários.' });
  }
});

module.exports = router;
