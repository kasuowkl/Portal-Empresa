/**
 * routes/patrimonio.js
 * GestÃ£o de PatrimÃ´nio â€” Portal WKL
 */

const express            = require('express');
const router             = express.Router();
const sql                = require('mssql');
const path               = require('path');
const { registrarLog }   = require('../services/logService');
const { enviarNotificacaoWhatsAppPorChips } = require('../services/whatsappDispatchService');
const { renderizarMensagemWhatsApp } = require('../services/whatsappTemplateService');
const {
  carregarConfigProtheus,
  listarColunasProtheus,
  listarDistintosProtheus,
  listarOpcoesPatrimonioProtheus,
  buscarAtivosProtheus,
} = require('../services/protheusService');

function verificarLogin(req, res, next) {
  if (!req.session?.usuario) {
    return req.path.startsWith('/api/')
      ? res.status(401).json({ erro: 'NÃ£o autorizado.' })
      : res.redirect('/login.html');
  }
  next();
}

// Verifica se o usuÃ¡rio tem nÃ­vel mÃ­nimo de acesso ao patrimÃ´nio
// Admin sempre passa. Outros consultam pat_permissoes.
async function verificarAcesso(nivelMinimo, req, res, next) {
  const u = req.session.usuario;
  if (u.nivel === 'admin') return next();

  const NIVEL = { visualizar: 1, editar: 2 };
  try {
    const pool = req.app.locals.pool;
    const r = await pool.request()
      .input('usuario', sql.VarChar(100), u.usuario)
      .query('SELECT nivel FROM pat_permissoes WHERE usuario = @usuario');

    const nivelUsuario = r.recordset[0]?.nivel || null;
    if (!nivelUsuario || (NIVEL[nivelUsuario] || 0) < (NIVEL[nivelMinimo] || 0)) {
      return req.path.startsWith('/api/')
        ? res.status(403).json({ erro: 'Sem permissÃ£o para esta operaÃ§Ã£o.' })
        : res.redirect('/login.html');
    }
    req.patNivel = nivelUsuario;
    next();
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
}

const acessoVer   = (req, res, next) => verificarAcesso('visualizar', req, res, next);
const acessoEditar = (req, res, next) => verificarAcesso('editar', req, res, next);

function normalizarTipoEventoPatrimonio(tipo) {
  return String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function tipoGeraTermo(tipo) {
  return [
    'disponibilizado',
    'transferido',
    'devolvido',
    'emprestimo',
    'avaria',
    'sinistro',
    'descarte',
    'manutencao',
  ].includes(normalizarTipoEventoPatrimonio(tipo));
}

async function enviarWhatsAppPatrimonio(pool, evento, contexto, meta = {}) {
  const eventoLabel = {
    'patrimonio.cadastro': 'Novo ativo cadastrado',
    'patrimonio.transferencia': 'Ativo transferido',
    'patrimonio.avaria': 'Avaria registrada',
    'patrimonio.descarte': 'Ativo descartado',
  };
  const mensagem = await renderizarMensagemWhatsApp(pool, 'patrimonio.evento_padrao', {
    evento_label: eventoLabel[evento] || evento,
    codigo: contexto.codigo || '-',
    descricao_item: contexto.descricao || '-',
    responsavel_atual: contexto.responsavelAtual || '-',
    novo_responsavel: contexto.novoResponsavel || '-',
    link: 'http://192.168.0.80:3132/patrimonio/',
  });

  await enviarNotificacaoWhatsAppPorChips(pool, {
    evento,
    sistema: 'patrimonio',
    mensagem,
    usuario: meta.usuario || 'sistema',
    ip: meta.ip || '',
    mapaChips: {
      responsavel_atual: contexto.responsavelAtual ? [contexto.responsavelAtual] : [],
      novo_responsavel: contexto.novoResponsavel ? [contexto.novoResponsavel] : [],
      gestores_setor: [],
    },
  });
}

// ============================================================
// PÃGINA
// ============================================================
router.get('/patrimonio', verificarLogin, acessoVer, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/patrimonio/index.html'));
});

router.get('/patrimonio/protheus-teste', verificarLogin, acessoEditar, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/patrimonio/protheus-teste.html'));
});

router.get('/api/patrimonio/protheus/schema', verificarLogin, acessoEditar, async (req, res) => {
  const pool = req.app.locals.pool;

  try {
    const config = await carregarConfigProtheus(pool);
    const tabela = String(config.protheus_patrimonio_tabela || config.protheus_patrimonio_alias || 'SN1010').trim().toUpperCase();
    const colunas = await listarColunasProtheus(pool, tabela);
    const opcoes = await listarOpcoesPatrimonioProtheus(pool, {
      tabela,
      campoFilial: config.protheus_patrimonio_campo_filial || 'N1_FILIAL',
      campoLocal: config.protheus_patrimonio_campo_local || 'N1_LOCAL',
      campoStatus: config.protheus_patrimonio_campo_status || 'N1_STATUS',
      campoFornecedor: config.protheus_patrimonio_campo_fornecedor || 'N1_FORNEC',
      campoLoja: config.protheus_patrimonio_campo_loja || 'N1_LOJA',
      campoNota: config.protheus_patrimonio_campo_nota_fiscal || 'N1_NFISCAL',
    });

    res.json({
      sucesso: true,
      tabela,
      colunas,
      empresas: opcoes.empresas,
      filiais: opcoes.filiais,
      locais: opcoes.locais,
      empresasCadastro: opcoes.empresasCadastro || opcoes.empresas,
      filiaisCadastro: opcoes.filiaisCadastro || opcoes.filiais,
      locaisCadastro: opcoes.locaisCadastro || opcoes.locais,
      status: opcoes.status,
      statusBemCadastro: opcoes.statusBemCadastro || [],
      motivosCadastro: opcoes.motivosCadastro || [],
      fornecedores: opcoes.fornecedores,
      notas: opcoes.notas,
      sugestoes: {
        codigo: config.protheus_patrimonio_campo_codigo || 'N1_CBASE',
        descricao: config.protheus_patrimonio_campo_descricao || 'N1_DESCRIC',
        fornecedor: config.protheus_patrimonio_campo_fornecedor || 'N1_FORNEC',
        local: config.protheus_patrimonio_campo_local || 'N1_LOCAL',
        serie: config.protheus_patrimonio_campo_num_serie || 'N1_NSERIE',
        nota: config.protheus_patrimonio_campo_nota_fiscal || 'N1_NFISCAL',
        status: config.protheus_patrimonio_campo_status || 'N1_STATUS',
        barra: config.protheus_patrimonio_campo_codigo_barras || 'N1_CODBAR',
        filial: config.protheus_patrimonio_campo_filial || 'N1_FILIAL',
        loja: config.protheus_patrimonio_campo_loja || 'N1_LOJA',
      },
      obrigatoriosPortal: ['codigo', 'descricao'],
      recomendadosPortal: ['categoria', 'fornecedor', 'num_serie', 'nota_fiscal', 'loc_tipo', 'loc_detalhe', 'status', 'estado'],
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.get('/api/patrimonio/protheus/ativos', verificarLogin, acessoEditar, async (req, res) => {
  const pool = req.app.locals.pool;

  try {
    const resultado = await buscarAtivosProtheus(pool, {
      tabela: req.query.tabela,
      q: req.query.q,
      campoBusca: req.query.campoBusca,
      empresa: req.query.empresa,
      filial: req.query.filial,
      status: req.query.status,
      fornecedor: req.query.fornecedor,
      nota: req.query.nota,
      local: req.query.local,
      limite: req.query.limite,
      campoCódigo: req.query.campoCodigo,
      campoDescrição: req.query.campoDescricao,
      campoFornecedor: req.query.campoFornecedor,
      campoLocal: req.query.campoLocal,
      campoSerie: req.query.campoSerie,
      campoNota: req.query.campoNota,
      campoStatus: req.query.campoStatus,
      campoBarra: req.query.campoBarra,
      campoFilial: req.query.campoFilial,
    });

    res.json({
      sucesso: true,
      tabela: resultado.tabela,
      mapeamento: resultado.mapeamento,
      ativos: resultado.rows,
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ============================================================
// GET /api/patrimonio/usuarios â€” UsuÃ¡rios locais + domÃ­nio
// ============================================================
router.get('/api/patrimonio/usuarios', verificarLogin, acessoVer, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const r = await pool.request().query(`
      SELECT usuario AS login, nome FROM usuarios WHERE ativo = 1
      UNION
      SELECT login, nome FROM usuarios_dominio WHERE ativo = 1
      ORDER BY nome
    `);
    res.json({ sucesso: true, usuarios: r.recordset });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ============================================================
// GET /api/patrimonio/bens â€” Listar bens
// ============================================================
router.get('/api/patrimonio/bens', verificarLogin, acessoVer, async (req, res) => {
  const pool = req.app.locals.pool;
  const { q, status, categoria } = req.query;

  try {
    const request = pool.request();
    let where = 'WHERE 1=1';

    if (q) {
      where += ' AND (codigo LIKE @q OR descricao LIKE @q OR marca LIKE @q OR num_serie LIKE @q OR fornecedor LIKE @q)';
      request.input('q', sql.VarChar, `%${q}%`);
    }
    if (status && status !== 'todos') {
      where += ' AND status = @status';
      request.input('status', sql.VarChar, status);
    }
    if (categoria && categoria !== 'todos') {
      where += ' AND categoria = @categoria';
      request.input('categoria', sql.VarChar, categoria);
    }

    const r = await request.query(`
      SELECT TOP 500
        b.id, b.codigo, b.descricao, b.categoria, b.marca, b.num_serie,
        b.loc_tipo, b.loc_detalhe, b.status, b.estado, b.valor, b.data_compra,
        b.responsavel_atual, b.setor_atual, b.criado_em,
        ult.tipo AS ultimo_tipo,
        ult.data_evt AS ultima_data_evt,
        ult.detalhe AS ultimo_detalhe,
        ult.numero_termo AS ultimo_numero_termo
      FROM pat_bens b
      OUTER APPLY (
        SELECT TOP 1
          h.tipo,
          h.data_evt,
          h.detalhe,
          h.numero_termo
        FROM pat_historico h
        WHERE h.bem_id = b.id
        ORDER BY h.data_evt DESC, h.registrado_em DESC, h.id DESC
      ) ult
      ${where}
      ORDER BY b.criado_em DESC
    `);

    res.json({ sucesso: true, bens: r.recordset });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ============================================================
// GET /api/patrimonio/bens/:id â€” Buscar bem + histÃ³rico
// ============================================================
router.get('/api/patrimonio/bens/:id', verificarLogin, acessoVer, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;

  try {
    const bem = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM pat_bens WHERE id = @id');

    if (!bem.recordset.length) return res.status(404).json({ erro: 'Bem nÃ£o encontrado.' });

    const hist = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM pat_historico WHERE bem_id = @id ORDER BY data_evt DESC, registrado_em DESC');

    res.json({ sucesso: true, bem: bem.recordset[0], historico: hist.recordset });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ============================================================
// POST /api/patrimonio/bens â€” Criar bem
// ============================================================
router.post('/api/patrimonio/bens', verificarLogin, acessoEditar, async (req, res) => {
  const pool = req.app.locals.pool;
  const u    = req.session.usuario;
  const {
    codigo, descricao, categoria, marca, num_serie,
    fornecedor, nota_fiscal, data_compra, valor,
    loc_tipo, loc_detalhe, loc_obs, estado, status, fotos,
    responsavel_atual, setor_atual
  } = req.body;

  if (!codigo || !descricao) return res.status(400).json({ erro: 'CÃ³digo e DescriÃ§Ã£o sÃ£o obrigatÃ³rios.' });

  try {
    const r = await pool.request()
      .input('codigo',      sql.VarChar(50),    codigo)
      .input('descricao',   sql.VarChar(200),   descricao)
      .input('categoria',   sql.VarChar(50),    categoria   || null)
      .input('marca',       sql.VarChar(100),   marca       || null)
      .input('num_serie',   sql.VarChar(100),   num_serie   || null)
      .input('fornecedor',  sql.VarChar(150),   fornecedor  || null)
      .input('nota_fiscal', sql.VarChar(50),    nota_fiscal || null)
      .input('data_compra', sql.Date,           data_compra ? new Date(data_compra) : null)
      .input('valor',       sql.Decimal(10, 2), valor       ? parseFloat(valor)    : null)
      .input('loc_tipo',    sql.VarChar(50),    loc_tipo    || null)
      .input('loc_detalhe', sql.VarChar(200),   loc_detalhe || null)
      .input('loc_obs',     sql.VarChar(500),   loc_obs     || null)
      .input('estado',      sql.VarChar(20),    estado      || 'Bom')
      .input('status',      sql.VarChar(30),    status      || 'Ativo')
      .input('responsavel_atual', sql.VarChar(150), responsavel_atual || null)
      .input('setor_atual', sql.VarChar(100), setor_atual || null)
      .input('fotos',       sql.VarChar(sql.MAX), fotos ? JSON.stringify(fotos) : null)
      .input('criado_por',  sql.VarChar(100),   u.usuario)
      .query(`
        INSERT INTO pat_bens
          (codigo, descricao, categoria, marca, num_serie, fornecedor, nota_fiscal,
           data_compra, valor, loc_tipo, loc_detalhe, loc_obs, estado, status,
           responsavel_atual, setor_atual, fotos, criado_por)
        OUTPUT INSERTED.id
        VALUES
          (@codigo, @descricao, @categoria, @marca, @num_serie, @fornecedor, @nota_fiscal,
           @data_compra, @valor, @loc_tipo, @loc_detalhe, @loc_obs, @estado, @status,
           @responsavel_atual, @setor_atual, @fotos, @criado_por)
      `);

    const novoId = r.recordset[0].id;

    // HistÃ³rico inicial automÃ¡tico
    await pool.request()
      .input('bem_id',        sql.Int,          novoId)
      .input('data_evt',      sql.Date,         new Date())
      .input('tipo',          sql.VarChar(50),  'Cadastro Inicial')
      .input('detalhe',       sql.VarChar(500), 'Item inserido no sistema')
      .input('resp',          sql.VarChar(100), u.nome || u.usuario)
      .input('registrado_por', sql.VarChar(100), u.usuario)
      .query(`
        INSERT INTO pat_historico (bem_id, data_evt, tipo, detalhe, resp, registrado_por)
        VALUES (@bem_id, @data_evt, @tipo, @detalhe, @resp, @registrado_por)
      `);

    registrarLog(pool, { usuario: u.usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'patrimonio', detalhes: `Bem cadastrado: ${codigo} â€” ${descricao}` });
    enviarWhatsAppPatrimonio(pool, 'patrimonio.cadastro', {
      codigo,
      descricao,
      responsavelAtual: '',
      novoResponsavel: '',
    }, { usuario: u.usuario, ip: req.ip }).catch(() => {});
    res.json({ sucesso: true, id: novoId });
  } catch (e) {
    if (e.message.includes('uq_pat_codigo') || e.message.includes('UNIQUE')) {
      return res.status(409).json({ erro: 'CÃ³digo jÃ¡ cadastrado.' });
    }
    res.status(500).json({ erro: e.message });
  }
});

// ============================================================
// PUT /api/patrimonio/bens/:id â€” Atualizar bem
// ============================================================
router.put('/api/patrimonio/bens/:id', verificarLogin, acessoEditar, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { id } = req.params;
  const {
    descricao, categoria, marca, num_serie,
    fornecedor, nota_fiscal, data_compra, valor,
    loc_tipo, loc_detalhe, loc_obs, estado, status, fotos,
    responsavel_atual, setor_atual
  } = req.body;

  try {
    await pool.request()
      .input('id',          sql.Int,            id)
      .input('descricao',   sql.VarChar(200),   descricao)
      .input('categoria',   sql.VarChar(50),    categoria   || null)
      .input('marca',       sql.VarChar(100),   marca       || null)
      .input('num_serie',   sql.VarChar(100),   num_serie   || null)
      .input('fornecedor',  sql.VarChar(150),   fornecedor  || null)
      .input('nota_fiscal', sql.VarChar(50),    nota_fiscal || null)
      .input('data_compra', sql.Date,           data_compra ? new Date(data_compra) : null)
      .input('valor',       sql.Decimal(10, 2), valor       ? parseFloat(valor)    : null)
      .input('loc_tipo',    sql.VarChar(50),    loc_tipo    || null)
      .input('loc_detalhe', sql.VarChar(200),   loc_detalhe || null)
      .input('loc_obs',     sql.VarChar(500),   loc_obs     || null)
      .input('estado',      sql.VarChar(20),    estado      || 'Bom')
      .input('status',      sql.VarChar(30),    status      || 'Ativo')
      .input('responsavel_atual', sql.VarChar(150), responsavel_atual || null)
      .input('setor_atual', sql.VarChar(100), setor_atual || null)
      .input('fotos',       sql.VarChar(sql.MAX), fotos ? JSON.stringify(fotos) : null)
      .query(`
        UPDATE pat_bens SET
          descricao = @descricao, categoria = @categoria, marca = @marca,
          num_serie = @num_serie, fornecedor = @fornecedor, nota_fiscal = @nota_fiscal,
          data_compra = @data_compra, valor = @valor,
          loc_tipo = @loc_tipo, loc_detalhe = @loc_detalhe, loc_obs = @loc_obs,
          estado = @estado, status = @status,
          responsavel_atual = @responsavel_atual, setor_atual = @setor_atual,
          fotos = @fotos,
          atualizado_em = GETDATE()
        WHERE id = @id
      `);

    registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'patrimonio', detalhes: `Bem #${id} editado: ${descricao}` });
    res.json({ sucesso: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ============================================================
// DELETE /api/patrimonio/bens/:id â€” Excluir bem
// ============================================================
router.delete('/api/patrimonio/bens/:id', verificarLogin, acessoEditar, async (req, res) => {
  const pool    = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { id } = req.params;

  try {
    const bemR = await pool.request().input('id', sql.Int, id)
      .query('SELECT codigo, descricao FROM pat_bens WHERE id=@id');
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM pat_historico WHERE bem_id = @id');
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM pat_bens WHERE id = @id');
    const bem = bemR.recordset[0];
    registrarLog(pool, { usuario, ip: req.ip, acao: 'EXCLUSAO', sistema: 'patrimonio', detalhes: `Bem excluÃ­do: ${bem?.codigo} â€” ${bem?.descricao}` });
    res.json({ sucesso: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ============================================================
// POST /api/patrimonio/bens/:id/historico â€” Registrar evento
// ============================================================

// Tipos que geram termos formais
router.post('/api/patrimonio/bens/:id/historico', verificarLogin, acessoEditar, async (req, res) => {
  const pool = req.app.locals.pool;
  const u    = req.session.usuario;
  const { id } = req.params;
  const {
    data_evt, tipo, detalhe, resp,
    novo_status, nova_loc_tipo, nova_loc_detalhe,
    responsavel_de, responsavel_para, setor_destino, novo_estado
  } = req.body;

  if (!resp) return res.status(400).json({ erro: 'ResponsÃ¡vel Ã© obrigatÃ³rio.' });

  try {
    // Gerar nÃºmero do termo (ex: TERM-20260306-0042)
    let numero_termo = null;
    if (tipoGeraTermo(tipo)) {
      const hoje = new Date();
      const yyyymmdd = `${hoje.getFullYear()}${String(hoje.getMonth()+1).padStart(2,'0')}${String(hoje.getDate()).padStart(2,'0')}`;
      const countR = await pool.request().query(`SELECT COUNT(*)+1 AS n FROM pat_historico WHERE numero_termo IS NOT NULL`);
      const seq = String(countR.recordset[0].n).padStart(4, '0');
      numero_termo = `TERM-${yyyymmdd}-${seq}`;
    }

    const ins = await pool.request()
      .input('bem_id',           sql.Int,           id)
      .input('data_evt',         sql.Date,          data_evt ? new Date(data_evt) : new Date())
      .input('tipo',             sql.VarChar(50),   tipo)
      .input('detalhe',          sql.VarChar(500),  detalhe || null)
      .input('resp',             sql.VarChar(100),  resp)
      .input('responsavel_de',   sql.VarChar(150),  responsavel_de   || null)
      .input('responsavel_para', sql.VarChar(150),  responsavel_para || null)
      .input('setor_destino',    sql.VarChar(100),  setor_destino    || null)
      .input('novo_estado',      sql.VarChar(20),   novo_estado      || null)
      .input('numero_termo',     sql.VarChar(30),   numero_termo)
      .input('registrado_por',   sql.VarChar(100),  u.usuario)
      .query(`
        INSERT INTO pat_historico
          (bem_id, data_evt, tipo, detalhe, resp, responsavel_de, responsavel_para,
           setor_destino, novo_estado, numero_termo, registrado_por)
        OUTPUT INSERTED.id
        VALUES
          (@bem_id, @data_evt, @tipo, @detalhe, @resp, @responsavel_de, @responsavel_para,
           @setor_destino, @novo_estado, @numero_termo, @registrado_por)
      `);

    const histId = ins.recordset[0].id;

    // Aplica alteraÃ§Ãµes no bem
    const sets = ['atualizado_em = GETDATE()'];
    const req2 = pool.request().input('id', sql.Int, id);

    if (novo_status)      { sets.push('status = @status');                 req2.input('status',             sql.VarChar(30),  novo_status);      }
    if (novo_estado)      { sets.push('estado = @estado');                 req2.input('estado',             sql.VarChar(20),  novo_estado);       }
    if (nova_loc_tipo)    { sets.push('loc_tipo = @loc_tipo');             req2.input('loc_tipo',           sql.VarChar(50),  nova_loc_tipo);     }
    if (nova_loc_detalhe) { sets.push('loc_detalhe = @loc_detalhe');       req2.input('loc_detalhe',        sql.VarChar(200), nova_loc_detalhe);  }
    if (responsavel_para) { sets.push('responsavel_atual = @resp_atual');  req2.input('resp_atual',         sql.VarChar(150), responsavel_para);  }
    if (setor_destino)    { sets.push('setor_atual = @setor_atual');       req2.input('setor_atual',        sql.VarChar(100), setor_destino);     }

    // Devolvido/Descarte: limpa responsÃ¡vel atual
    if (tipo === 'Devolvido' || tipo === 'Descarte') {
      sets.push('responsavel_atual = NULL');
      sets.push('setor_atual = NULL');
    }

    if (sets.length > 1) {
      await req2.query(`UPDATE pat_bens SET ${sets.join(', ')} WHERE id = @id`);
    }

    const bemR = await pool.request().input('id', sql.Int, id).query('SELECT codigo, descricao FROM pat_bens WHERE id=@id');
    const bem  = bemR.recordset[0];
    registrarLog(pool, { usuario: u.usuario, ip: req.ip, acao: 'EDICAO', sistema: 'patrimonio', detalhes: `${tipo} registrado: ${bem?.codigo} â€” ${bem?.descricao}${numero_termo ? ` (${numero_termo})` : ''}` });
    if (tipo === 'Transferido') {
      enviarWhatsAppPatrimonio(pool, 'patrimonio.transferencia', {
        codigo: bem?.codigo,
        descricao: bem?.descricao,
        responsavelAtual: responsavel_de || '',
        novoResponsavel: responsavel_para || '',
      }, { usuario: u.usuario, ip: req.ip }).catch(() => {});
    } else if (tipo === 'Avaria' || tipo === 'Sinistro') {
      enviarWhatsAppPatrimonio(pool, 'patrimonio.avaria', {
        codigo: bem?.codigo,
        descricao: bem?.descricao,
        responsavelAtual: responsavel_de || resp || '',
        novoResponsavel: '',
      }, { usuario: u.usuario, ip: req.ip }).catch(() => {});
    } else if (tipo === 'Descarte') {
      enviarWhatsAppPatrimonio(pool, 'patrimonio.descarte', {
        codigo: bem?.codigo,
        descricao: bem?.descricao,
        responsavelAtual: responsavel_de || resp || '',
        novoResponsavel: '',
      }, { usuario: u.usuario, ip: req.ip }).catch(() => {});
    }
    res.json({ sucesso: true, histId, numero_termo });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ============================================================
// CATEGORIAS  GET/POST/DELETE /api/patrimonio/categorias
// ============================================================
router.get('/api/patrimonio/categorias', verificarLogin, acessoVer, async (req, res) => {
  try {
    const r = await req.app.locals.pool.request()
      .query('SELECT id, nome FROM pat_categorias ORDER BY nome');
    res.json({ sucesso: true, categorias: r.recordset });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/api/patrimonio/categorias', verificarLogin, acessoEditar, async (req, res) => {
  const { nome } = req.body;
  if (!nome?.trim()) return res.status(400).json({ erro: 'Nome obrigatÃ³rio.' });
  try {
    const r = await req.app.locals.pool.request()
      .input('nome', sql.VarChar(80), nome.trim())
      .query('INSERT INTO pat_categorias (nome) OUTPUT INSERTED.id VALUES (@nome)');
    res.json({ sucesso: true, id: r.recordset[0].id });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.message.includes('unique'))
      return res.status(409).json({ erro: 'Categoria jÃ¡ existe.' });
    res.status(500).json({ erro: e.message });
  }
});

router.delete('/api/patrimonio/categorias/:id', verificarLogin, acessoEditar, async (req, res) => {
  try {
    await req.app.locals.pool.request()
      .input('id', sql.Int, req.params.id)
      .query('DELETE FROM pat_categorias WHERE id = @id');
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============================================================
// UNIDADES  GET/POST/DELETE /api/patrimonio/unidades
// ============================================================
router.get('/api/patrimonio/unidades', verificarLogin, acessoVer, async (req, res) => {
  try {
    const r = await req.app.locals.pool.request()
      .query('SELECT id, nome FROM pat_unidades ORDER BY nome');
    res.json({ sucesso: true, unidades: r.recordset });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/api/patrimonio/unidades', verificarLogin, acessoEditar, async (req, res) => {
  const { nome } = req.body;
  if (!nome?.trim()) return res.status(400).json({ erro: 'Nome obrigatÃ³rio.' });
  try {
    const r = await req.app.locals.pool.request()
      .input('nome', sql.VarChar(80), nome.trim())
      .query('INSERT INTO pat_unidades (nome) OUTPUT INSERTED.id VALUES (@nome)');
    res.json({ sucesso: true, id: r.recordset[0].id });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.message.includes('unique'))
      return res.status(409).json({ erro: 'Unidade jÃ¡ existe.' });
    res.status(500).json({ erro: e.message });
  }
});

router.delete('/api/patrimonio/unidades/:id', verificarLogin, acessoEditar, async (req, res) => {
  try {
    await req.app.locals.pool.request()
      .input('id', sql.Int, req.params.id)
      .query('DELETE FROM pat_unidades WHERE id = @id');
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============================================================
// GET /api/patrimonio/meu-acesso â€” Retorna nÃ­vel do usuÃ¡rio logado
// ============================================================
router.get('/api/patrimonio/meu-acesso', verificarLogin, async (req, res) => {
  const u = req.app.locals.pool;
  const usuario = req.session.usuario;

  if (usuario.nivel === 'admin') return res.json({ sucesso: true, nivel: 'editar', admin: true });

  try {
    const r = await req.app.locals.pool.request()
      .input('usuario', sql.VarChar(100), usuario.usuario)
      .query('SELECT nivel FROM pat_permissoes WHERE usuario = @usuario');
    res.json({ sucesso: true, nivel: r.recordset[0]?.nivel || null, admin: false });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============================================================
// PERMISSÃ•ES (apenas admin)  /api/patrimonio/permissoes
// ============================================================
function verificarAdmin(req, res, next) {
  if (req.session?.usuario?.nivel !== 'admin')
    return res.status(403).json({ erro: 'Somente administradores podem gerenciar permissÃµes.' });
  next();
}

router.get('/api/patrimonio/permissoes', verificarLogin, verificarAdmin, async (req, res) => {
  try {
    const r = await req.app.locals.pool.request()
      .query('SELECT usuario, nivel FROM pat_permissoes ORDER BY usuario');
    res.json({ sucesso: true, permissoes: r.recordset });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/api/patrimonio/permissoes', verificarLogin, verificarAdmin, async (req, res) => {
  const { usuario, nivel } = req.body;
  if (!usuario?.trim() || !['visualizar', 'editar'].includes(nivel))
    return res.status(400).json({ erro: 'Dados invÃ¡lidos.' });
  try {
    await req.app.locals.pool.request()
      .input('usuario', sql.VarChar(100), usuario.trim())
      .input('nivel',   sql.VarChar(20),  nivel)
      .query(`
        MERGE pat_permissoes AS t
        USING (SELECT @usuario AS usuario, @nivel AS nivel) AS s
        ON t.usuario = s.usuario
        WHEN MATCHED    THEN UPDATE SET nivel = s.nivel
        WHEN NOT MATCHED THEN INSERT (usuario, nivel) VALUES (s.usuario, s.nivel);
      `);
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.delete('/api/patrimonio/permissoes/:usuario', verificarLogin, verificarAdmin, async (req, res) => {
  try {
    await req.app.locals.pool.request()
      .input('usuario', sql.VarChar(100), decodeURIComponent(req.params.usuario))
      .query('DELETE FROM pat_permissoes WHERE usuario = @usuario');
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Buscar dados de contato de uma pessoa (para termos)
router.get('/api/patrimonio/contato/:nome', verificarLogin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const nome = decodeURIComponent(req.params.nome);
    // Busca em usuarios_dominio
    let r = await pool.request()
      .input('nome', sql.NVarChar, nome)
      .query(`SELECT TOP 1 email, departamento, whatsapp FROM usuarios_dominio WHERE nome = @nome AND ativo = 1`);
    if (r.recordset[0]) {
      return res.json({ sucesso: true, email: r.recordset[0].email || '', telefone: r.recordset[0].whatsapp || '', departamento: r.recordset[0].departamento || '' });
    }
    // Busca em contatos
    r = await pool.request()
      .input('nome', sql.NVarChar, nome)
      .query(`SELECT TOP 1 email_corporativo, email_pessoal, cel_corporativo, cel_pessoal, whatsapp, departamento FROM contatos WHERE nome = @nome`);
    if (r.recordset[0]) {
      const c = r.recordset[0];
      return res.json({ sucesso: true, email: c.email_corporativo || c.email_pessoal || '', telefone: c.cel_corporativo || c.cel_pessoal || c.whatsapp || '', departamento: c.departamento || '' });
    }
    // Busca em usuarios locais
    r = await pool.request()
      .input('nome', sql.NVarChar, nome)
      .query(`SELECT TOP 1 whatsapp FROM usuarios WHERE nome = @nome AND ativo = 1`);
    if (r.recordset[0]) {
      return res.json({ sucesso: true, email: '', telefone: r.recordset[0].whatsapp || '', departamento: '' });
    }
    res.json({ sucesso: true, email: '', telefone: '', departamento: '' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;

