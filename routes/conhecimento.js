/**
 * ARQUIVO: routes/conhecimento.js
 * VERSAO:  1.0.0
 * DATA:    2026-04-02
 * DESCRICAO: Rotas da Base de Conhecimento — artigos, categorias, busca, avaliacoes
 */

const express = require('express');
const router = express.Router();
const verificarLogin = require('../middleware/verificarLogin');
const { registrarLog } = require('../services/logService');
const sql = require('mssql');
const path = require('path');

// ============================================================
// PAGINAS HTML
// ============================================================
router.get('/conhecimento', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/baseConhecimento/index.html'));
});

// ============================================================
// CATEGORIAS
// ============================================================

// Listar categorias
router.get('/api/conhecimento/categorias', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  try {
    const r = await pool.request()
      .input('usuario', sql.NVarChar, usuario)
      .query(`
      SELECT c.*,
        (SELECT COUNT(*)
         FROM kb_artigos
         WHERE categoria_id = c.id
           AND (status = 'publicado' OR (status = 'rascunho' AND criado_por = @usuario))) AS total_artigos
      FROM kb_categorias c
      ORDER BY c.ordem, c.nome
    `);
    res.json(r.recordset);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar categorias.' });
  }
});

// Criar categoria
router.post('/api/conhecimento/categorias', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { nome, descricao, icone, cor } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome obrigatório.' });
  try {
    const r = await pool.request()
      .input('nome', sql.NVarChar, nome)
      .input('descricao', sql.NVarChar, descricao || null)
      .input('icone', sql.NVarChar, icone || 'fas fa-folder')
      .input('cor', sql.NVarChar, cor || '#3b82f6')
      .input('usuario', sql.NVarChar, usuario)
      .query(`
        INSERT INTO kb_categorias (nome, descricao, icone, cor, criado_por)
        OUTPUT INSERTED.*
        VALUES (@nome, @descricao, @icone, @cor, @usuario)
      `);
    await registrarLog(pool, { usuario, acao: 'CRIACAO', sistema: 'conhecimento', detalhes: `Categoria: ${nome}` });
    res.json({ sucesso: true, item: r.recordset[0] });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao criar categoria.' });
  }
});

// Atualizar categoria
router.put('/api/conhecimento/categorias/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const { nome, descricao, icone, cor } = req.body;
  try {
    await pool.request()
      .input('id', sql.Int, id)
      .input('nome', sql.NVarChar, nome)
      .input('descricao', sql.NVarChar, descricao || null)
      .input('icone', sql.NVarChar, icone || 'fas fa-folder')
      .input('cor', sql.NVarChar, cor || '#3b82f6')
      .query('UPDATE kb_categorias SET nome = @nome, descricao = @descricao, icone = @icone, cor = @cor WHERE id = @id');
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao atualizar categoria.' });
  }
});

// Excluir categoria
router.delete('/api/conhecimento/categorias/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  try {
    // Move artigos para sem categoria antes de excluir
    await pool.request()
      .input('id', sql.Int, id)
      .query('UPDATE kb_artigos SET categoria_id = NULL WHERE categoria_id = @id');
    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM kb_categorias WHERE id = @id');
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao excluir categoria.' });
  }
});

// ============================================================
// ARTIGOS
// ============================================================

// Listar artigos (com filtros opcionais)
router.get('/api/conhecimento/artigos', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { categoria_id, busca, tag, status } = req.query;
  try {
    let where = ['1=1'];
    const request = pool.request()
      .input('usuario', sql.NVarChar, usuario);

    if (categoria_id) {
      request.input('categoria_id', sql.Int, categoria_id);
      where.push('a.categoria_id = @categoria_id');
    }
    if (busca) {
      request.input('busca', sql.NVarChar, `%${busca}%`);
      where.push('(a.titulo LIKE @busca OR a.conteudo LIKE @busca OR a.tags LIKE @busca)');
    }
    if (tag) {
      request.input('tag', sql.NVarChar, `%${tag}%`);
      where.push('a.tags LIKE @tag');
    }
    if (status) {
      if (status === 'rascunho') {
        where.push("a.status = 'rascunho'");
        where.push('a.criado_por = @usuario');
      } else {
        request.input('status', sql.NVarChar, status);
        where.push('a.status = @status');
      }
    } else {
      where.push("(a.status = 'publicado' OR (a.status = 'rascunho' AND a.criado_por = @usuario))");
    }

    const r = await request.query(`
      SELECT a.*, c.nome AS categoria_nome, c.cor AS categoria_cor, c.icone AS categoria_icone,
        (SELECT COUNT(*) FROM kb_avaliacoes WHERE artigo_id = a.id AND util = 1) AS likes,
        (SELECT COUNT(*) FROM kb_avaliacoes WHERE artigo_id = a.id AND util = 0) AS dislikes
      FROM kb_artigos a
      LEFT JOIN kb_categorias c ON a.categoria_id = c.id
      WHERE ${where.join(' AND ')}
      ORDER BY a.fixado DESC, a.criado_em DESC
    `);
    res.json(r.recordset);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar artigos.' });
  }
});

// Buscar artigo por ID
router.get('/api/conhecimento/artigos/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.nivel === 'admin';
  try {
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT a.*, c.nome AS categoria_nome, c.cor AS categoria_cor, c.icone AS categoria_icone,
          (SELECT COUNT(*) FROM kb_avaliacoes WHERE artigo_id = a.id AND util = 1) AS likes,
          (SELECT COUNT(*) FROM kb_avaliacoes WHERE artigo_id = a.id AND util = 0) AS dislikes
        FROM kb_artigos a
        LEFT JOIN kb_categorias c ON a.categoria_id = c.id
        WHERE a.id = @id
      `);

    if (r.recordset.length === 0) return res.status(404).json({ erro: 'Artigo nao encontrado.' });

    const artigo = r.recordset[0];
    const dono = artigo.criado_por === usuario;
    if (artigo.status === 'rascunho' && !dono) {
      return res.status(403).json({ erro: 'Este rascunho so pode ser visualizado pelo criador.' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .query('UPDATE kb_artigos SET visualizacoes = visualizacoes + 1 WHERE id = @id');

    const av = await pool.request()
      .input('artigo_id', sql.Int, id)
      .input('usuario', sql.NVarChar, usuario)
      .query('SELECT util FROM kb_avaliacoes WHERE artigo_id = @artigo_id AND usuario = @usuario');

    artigo.minha_avaliacao = av.recordset.length > 0 ? av.recordset[0].util : null;
    artigo.pode_editar = dono || isAdmin;
    artigo.pode_excluir = dono || isAdmin;
    artigo.pode_visualizar = artigo.status !== 'rascunho' || dono;

    const anexos = await pool.request()
      .input('artigo_id', sql.Int, id)
      .query('SELECT id, nome_original, tipo_mime, tamanho, enviado_por, enviado_em FROM kb_anexos WHERE artigo_id = @artigo_id ORDER BY enviado_em DESC');
    artigo.anexos = anexos.recordset;

    res.json(artigo);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar artigo.' });
  }
});

// Criar artigo
router.post('/api/conhecimento/artigos', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { titulo, conteudo, categoria_id, tags, status, anexos } = req.body;
  if (!titulo || !conteudo) return res.status(400).json({ erro: 'Título e conteúdo são obrigatórios.' });
  try {
    const r = await pool.request()
      .input('titulo', sql.NVarChar, titulo)
      .input('conteudo', sql.NVarChar, conteudo)
      .input('categoria_id', sql.Int, categoria_id || null)
      .input('tags', sql.NVarChar, tags || null)
      .input('status', sql.NVarChar, status || 'publicado')
      .input('usuario', sql.NVarChar, usuario)
      .query(`
        INSERT INTO kb_artigos (titulo, conteudo, categoria_id, tags, status, criado_por)
        OUTPUT INSERTED.*
        VALUES (@titulo, @conteudo, @categoria_id, @tags, @status, @usuario)
      `);

    const artigo = r.recordset[0];

    // Salva anexos se houver
    if (anexos && anexos.length > 0) {
      for (const anexo of anexos) {
        await pool.request()
          .input('artigo_id', sql.Int, artigo.id)
          .input('nome_original', sql.NVarChar, anexo.nome)
          .input('tipo_mime', sql.NVarChar, anexo.tipo)
          .input('tamanho', sql.Int, anexo.tamanho)
          .input('dados_base64', sql.NVarChar, anexo.dados)
          .input('enviado_por', sql.NVarChar, usuario)
          .query(`
            INSERT INTO kb_anexos (artigo_id, nome_original, tipo_mime, tamanho, dados_base64, enviado_por)
            VALUES (@artigo_id, @nome_original, @tipo_mime, @tamanho, @dados_base64, @enviado_por)
          `);
      }
    }

    // Registra no historico
    await pool.request()
      .input('artigo_id', sql.Int, artigo.id)
      .input('usuario', sql.NVarChar, usuario)
      .query(`
        INSERT INTO kb_historico (artigo_id, usuario, acao, detalhes)
        VALUES (@artigo_id, @usuario, 'CRIACAO', 'Artigo criado')
      `);

    await registrarLog(pool, { usuario, acao: 'CRIACAO', sistema: 'conhecimento', detalhes: `Artigo: ${titulo}` });
    res.json({ sucesso: true, item: artigo });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao criar artigo.' });
  }
});

// Atualizar artigo
router.put('/api/conhecimento/artigos/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.nivel === 'admin';
  const { id } = req.params;
  const { titulo, conteudo, categoria_id, tags, status, fixado } = req.body;
  try {
    const artigo = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT id, criado_por FROM kb_artigos WHERE id = @id');

    if (artigo.recordset.length === 0) {
      return res.status(404).json({ erro: 'Artigo nao encontrado.' });
    }

    const dono = artigo.recordset[0].criado_por === usuario;
    if (!dono && !isAdmin) {
      return res.status(403).json({ erro: 'Apenas o criador ou um administrador podem editar este artigo.' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('titulo', sql.NVarChar, titulo)
      .input('conteudo', sql.NVarChar, conteudo)
      .input('categoria_id', sql.Int, categoria_id || null)
      .input('tags', sql.NVarChar, tags || null)
      .input('status', sql.NVarChar, status || 'publicado')
      .input('fixado', sql.Bit, fixado ? 1 : 0)
      .query(`
        UPDATE kb_artigos
        SET titulo = @titulo, conteudo = @conteudo, categoria_id = @categoria_id,
            tags = @tags, status = @status, fixado = @fixado, atualizado_em = GETDATE()
        WHERE id = @id
      `);

    await pool.request()
      .input('artigo_id', sql.Int, id)
      .input('usuario', sql.NVarChar, usuario)
      .query(`
        INSERT INTO kb_historico (artigo_id, usuario, acao, detalhes)
        VALUES (@artigo_id, @usuario, 'EDICAO', 'Artigo atualizado')
      `);

    await registrarLog(pool, { usuario, acao: 'EDICAO', sistema: 'conhecimento', detalhes: `Artigo #${id}: ${titulo}` });
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao atualizar artigo.' });
  }
});

// Excluir artigo
router.delete('/api/conhecimento/artigos/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const isAdmin = req.session.usuario.nivel === 'admin';
  const { id } = req.params;
  try {
    const artigo = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT id, titulo, criado_por FROM kb_artigos WHERE id = @id');

    if (artigo.recordset.length === 0) {
      return res.status(404).json({ erro: 'Artigo nao encontrado.' });
    }

    const dono = artigo.recordset[0].criado_por === usuario;
    if (!isAdmin && !dono) {
      return res.status(403).json({ erro: 'Apenas o criador ou um administrador podem excluir este artigo.' });
    }

    await pool.request().input('id', sql.Int, id).query('DELETE FROM kb_avaliacoes WHERE artigo_id = @id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM kb_anexos WHERE artigo_id = @id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM kb_historico WHERE artigo_id = @id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM kb_artigos WHERE id = @id');

    await registrarLog(pool, { usuario, acao: 'EXCLUSAO', sistema: 'conhecimento', detalhes: 'Artigo #' + id + ' excluido' });
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao excluir artigo.' });
  }
});
// ============================================================
// AVALIACOES
// ============================================================

// Avaliar artigo (util / nao util)
router.post('/api/conhecimento/artigos/:id/avaliar', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { id } = req.params;
  const { util } = req.body;
  try {
    // Upsert: atualiza se ja avaliou, insere se nao
    const existe = await pool.request()
      .input('artigo_id', sql.Int, id)
      .input('usuario', sql.NVarChar, usuario)
      .query('SELECT id FROM kb_avaliacoes WHERE artigo_id = @artigo_id AND usuario = @usuario');

    if (existe.recordset.length > 0) {
      await pool.request()
        .input('artigo_id', sql.Int, id)
        .input('usuario', sql.NVarChar, usuario)
        .input('util', sql.Bit, util ? 1 : 0)
        .query('UPDATE kb_avaliacoes SET util = @util, criado_em = GETDATE() WHERE artigo_id = @artigo_id AND usuario = @usuario');
    } else {
      await pool.request()
        .input('artigo_id', sql.Int, id)
        .input('usuario', sql.NVarChar, usuario)
        .input('util', sql.Bit, util ? 1 : 0)
        .query('INSERT INTO kb_avaliacoes (artigo_id, usuario, util) VALUES (@artigo_id, @usuario, @util)');
    }

    // Retorna contagem atualizada
    const r = await pool.request()
      .input('artigo_id', sql.Int, id)
      .query(`
        SELECT
          (SELECT COUNT(*) FROM kb_avaliacoes WHERE artigo_id = @artigo_id AND util = 1) AS likes,
          (SELECT COUNT(*) FROM kb_avaliacoes WHERE artigo_id = @artigo_id AND util = 0) AS dislikes
      `);
    res.json({ sucesso: true, ...r.recordset[0] });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao avaliar artigo.' });
  }
});

// ============================================================
// ANEXOS
// ============================================================

// Download de anexo
router.get('/api/conhecimento/anexos/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  try {
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM kb_anexos WHERE id = @id');
    if (r.recordset.length === 0) return res.status(404).json({ erro: 'Anexo não encontrado.' });

    const anexo = r.recordset[0];
    const buffer = Buffer.from(anexo.dados_base64, 'base64');
    res.setHeader('Content-Disposition', `attachment; filename="${anexo.nome_original}"`);
    res.setHeader('Content-Type', anexo.tipo_mime || 'application/octet-stream');
    res.send(buffer);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao baixar anexo.' });
  }
});

// Adicionar anexo a artigo existente
router.post('/api/conhecimento/artigos/:id/anexos', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { id } = req.params;
  const { nome, tipo, tamanho, dados } = req.body;
  if (!nome || !dados) return res.status(400).json({ erro: 'Nome e dados do anexo são obrigatórios.' });
  try {
    const r = await pool.request()
      .input('artigo_id', sql.Int, id)
      .input('nome_original', sql.NVarChar, nome)
      .input('tipo_mime', sql.NVarChar, tipo || null)
      .input('tamanho', sql.Int, tamanho || 0)
      .input('dados_base64', sql.NVarChar, dados)
      .input('enviado_por', sql.NVarChar, usuario)
      .query(`
        INSERT INTO kb_anexos (artigo_id, nome_original, tipo_mime, tamanho, dados_base64, enviado_por)
        OUTPUT INSERTED.id, INSERTED.nome_original, INSERTED.tipo_mime, INSERTED.tamanho, INSERTED.enviado_por, INSERTED.enviado_em
        VALUES (@artigo_id, @nome_original, @tipo_mime, @tamanho, @dados_base64, @enviado_por)
      `);
    res.json({ sucesso: true, anexo: r.recordset[0] });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao enviar anexo.' });
  }
});

// Excluir anexo
router.delete('/api/conhecimento/anexos/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  try {
    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM kb_anexos WHERE id = @id');
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao excluir anexo.' });
  }
});

// ============================================================
// HISTORICO
// ============================================================
router.get('/api/conhecimento/artigos/:id/historico', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  try {
    const r = await pool.request()
      .input('artigo_id', sql.Int, id)
      .query('SELECT * FROM kb_historico WHERE artigo_id = @artigo_id ORDER BY criado_em DESC');
    res.json(r.recordset);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar histórico.' });
  }
});

// ============================================================
// ESTATISTICAS
// ============================================================
router.get('/api/conhecimento/estatisticas', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  try {
    const r = await pool.request()
      .input('usuario', sql.NVarChar, usuario)
      .query(`
      SELECT
        (SELECT COUNT(*) FROM kb_artigos WHERE status = 'publicado' OR (status = 'rascunho' AND criado_por = @usuario)) AS total_artigos,
        (SELECT COUNT(*) FROM kb_categorias) AS total_categorias,
        (SELECT ISNULL(SUM(visualizacoes), 0) FROM kb_artigos WHERE status = 'publicado' OR (status = 'rascunho' AND criado_por = @usuario)) AS total_visualizacoes,
        (SELECT COUNT(*)
         FROM kb_avaliacoes av
         JOIN kb_artigos a ON a.id = av.artigo_id
         WHERE av.util = 1 AND (a.status = 'publicado' OR (a.status = 'rascunho' AND a.criado_por = @usuario))) AS total_likes
    `);
    res.json(r.recordset[0]);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar estatisticas.' });
  }
});

module.exports = router;
