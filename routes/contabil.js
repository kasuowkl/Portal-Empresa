/**
 * ARQUIVO: routes/contabil.js
 * DESCRICAO: Rotas da Agenda Contabil integrada ao Portal
 */

const express = require('express');
const sql = require('mssql');
const path = require('path');
const verificarLogin = require('../middleware/verificarLogin');
const { registrarLog } = require('../services/logService');
const { enviarNotificacaoWhatsAppPorChips } = require('../services/whatsappDispatchService');
const { renderizarMensagemWhatsApp } = require('../services/whatsappTemplateService');

const router = express.Router();

const NIVEL = { leitura: 1, edicao: 2, dono: 3 };

function temPermissao(permissao, nivelMinimo) {
  return !!permissao && (NIVEL[permissao] || 0) >= (NIVEL[nivelMinimo] || 0);
}

async function getPermissao(pool, agendaId, usuario) {
  const result = await pool.request()
    .input('agenda_id', sql.Int, agendaId)
    .input('usuario', sql.VarChar, usuario)
    .query(`
      SELECT 'dono' AS permissao
      FROM cont_agendas
      WHERE id = @agenda_id AND dono = @usuario
      UNION ALL
      SELECT permissao
      FROM cont_membros
      WHERE agenda_id = @agenda_id AND usuario = @usuario
    `);

  return result.recordset[0]?.permissao || null;
}

async function registrarLogContabil(pool, agendaId, itemId, acao, detalhes, usuario) {
  await pool.request()
    .input('agenda_id', sql.Int, agendaId)
    .input('item_id', sql.Int, itemId || null)
    .input('acao', sql.VarChar, acao)
    .input('detalhes', sql.VarChar, detalhes || '')
    .input('usuario', sql.VarChar, usuario)
    .query(`
      INSERT INTO cont_logs (agenda_id, item_id, acao, detalhes, usuario)
      VALUES (@agenda_id, @item_id, @acao, @detalhes, @usuario)
    `);
}

async function getLoginsAgendaContabil(pool, agendaId) {
  try {
    const r = await pool.request()
      .input('agenda_id', sql.Int, agendaId)
      .query(`
        SELECT dono AS login
        FROM cont_agendas
        WHERE id = @agenda_id
        UNION
        SELECT usuario AS login
        FROM cont_membros
        WHERE agenda_id = @agenda_id AND permissao IN ('edicao', 'dono')
      `);
    return r.recordset.map((row) => String(row.login || '').toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

async function enviarWhatsAppContabil(pool, evento, contexto, meta = {}) {
  const eventoLabel = {
    'contabil.novo_item': 'Novo item contábil',
    'contabil.item_editado': 'Item contábil editado',
    'contabil.item_pago': 'Item marcado como pago',
    'contabil.item_vencido': 'Item vencido',
  };
  const mensagem = await renderizarMensagemWhatsApp(pool, 'contabil.evento_padrao', {
    evento_label: eventoLabel[evento] || evento,
    titulo_item: contexto.titulo || '-',
    agenda_nome: contexto.agendaNome || '-',
    valor: contexto.valor || '-',
    vencimento: contexto.vencimento || '-',
    link: 'http://192.168.0.80:3132/agendaContabil',
  });

  await enviarNotificacaoWhatsAppPorChips(pool, {
    evento,
    sistema: 'contabil',
    mensagem,
    usuario: meta.usuario || contexto.criadoPor || 'sistema',
    ip: meta.ip || '',
    mapaChips: {
      criado_por_usuario: contexto.criadoPor ? [contexto.criadoPor] : [],
      gestores: contexto.loginsAgenda || [],
      gestores_setor: [],
    },
  });
}

function normalizarFrequencia(valor) {
  const frequencia = (valor || 'Unica').trim();
  return ['Unica', 'Mensal', 'Bimestral', 'Trimestral', 'Semestral', 'Anual'].includes(frequencia)
    ? frequencia
    : 'Unica';
}

function adicionarMeses(dataBase, quantidade) {
  const data = new Date(`${dataBase}T12:00:00`);
  const diaOriginal = data.getDate();
  data.setMonth(data.getMonth() + quantidade);
  if (data.getDate() < diaOriginal) data.setDate(0);
  return data.toISOString().slice(0, 10);
}

function proximaDataRecorrencia(dataBase, frequencia, indice) {
  const passo = {
    Mensal: 1,
    Bimestral: 2,
    Trimestral: 3,
    Semestral: 6,
    Anual: 12
  };

  return adicionarMeses(dataBase, (passo[frequencia] || 0) * indice);
}

function dataEmissaoPadrao(dataBase) {
  if (!dataBase) return null;
  return String(dataBase).slice(0, 10);
}

function calcularStatus(vencimento, statusAtual) {
  if (statusAtual === 'pago' || statusAtual === 'lancado') return statusAtual;
  if (!vencimento) return statusAtual || 'pendente';

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const data = new Date(`${String(vencimento).slice(0, 10)}T00:00:00`);

  return data < hoje ? 'vencido' : (statusAtual || 'pendente');
}

function montarSerieItens(payload, usuario) {
  const frequencia = normalizarFrequencia(payload.recorrencia);
  const maxParcelas = frequencia === 'Unica' ? 1 : Math.max(1, parseInt(payload.max_parcelas, 10) || 1);
  const recorrenciaFim = payload.recorrencia_fim || null;
  const serieId = frequencia === 'Unica' ? null : `cont-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const itens = [];

  if (frequencia !== 'Unica' && !payload.vencimento) {
    throw new Error('Informe a data de vencimento para itens recorrentes.');
  }

  for (let indice = 0; indice < maxParcelas; indice += 1) {
    const vencimento = frequencia === 'Unica'
      ? (payload.vencimento || null)
      : proximaDataRecorrencia(payload.vencimento, frequencia, indice);

    if (recorrenciaFim && vencimento && vencimento > recorrenciaFim) break;

    itens.push({
      grupo_id: payload.grupo_id || null,
      cliente_id: payload.cliente_id || null,
      titulo: payload.titulo.trim(),
      descricao: (payload.descricao || '').trim(),
      data_emissao: payload.data_emissao || dataEmissaoPadrao(vencimento),
      vencimento,
      valor: parseFloat(payload.valor) || 0,
      recorrencia: frequencia,
      status: calcularStatus(vencimento, payload.status || 'pendente'),
      prioridade: payload.prioridade || 'normal',
      dias_antecedencia: parseInt(payload.dias_antecedencia, 10) || 3,
      notificar_email: payload.notificar_email ? 1 : 0,
      notificar_whatsapp: payload.notificar_whatsapp ? 1 : 0,
      manifesto_ativo: payload.manifesto_ativo ? 1 : 0,
      observacoes: (payload.observacoes || '').trim(),
      recorrencia_id: serieId,
      eh_serie_principal: indice === 0 ? 1 : 0,
      parcela_atual: indice + 1,
      max_parcelas: maxParcelas,
      recorrencia_fim: recorrenciaFim,
      criado_por: usuario
    });
  }

  return itens;
}

router.get('/agendaContabil', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agendaContabil/index.html'));
});

router.get('/agendaContabil/relatorios', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agendaContabil/relatoriosContabil.html'));
});

router.get('/api/contabil/agendas', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;

  try {
    const result = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .query(`
        SELECT a.id, a.nome, a.descricao, a.cor, a.dono, a.criado_em,
               CASE WHEN a.dono = @usuario THEN 'dono' ELSE m.permissao END AS permissao,
               COALESCE(u.nome, ud.nome, a.dono) AS dono_nome
        FROM cont_agendas a
        LEFT JOIN cont_membros m ON m.agenda_id = a.id AND m.usuario = @usuario
        LEFT JOIN usuarios u ON u.usuario = a.dono
        LEFT JOIN usuarios_dominio ud ON ud.login = a.dono AND u.usuario IS NULL
        WHERE a.dono = @usuario OR m.usuario = @usuario
        ORDER BY a.criado_em ASC
      `);

    res.json({ sucesso: true, agendas: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar agendas contabeis: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar agendas.' });
  }
});

router.get('/api/contabil/relatorios', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const {
    agenda_id: agendaId,
    agenda_ids: agendaIdsRaw,
    dataInicio,
    dataFim,
    status,
    categoria,
    empresa,
    tipo,
    page
  } = req.query;

  function mkReq(extraConds = []) {
    const r = pool.request().input('usuario', sql.VarChar, usuario);
    const conds = ['(a.dono=@usuario OR EXISTS (SELECT 1 FROM cont_membros m WHERE m.agenda_id=a.id AND m.usuario=@usuario))'];
    const ids = agendaIdsRaw
      ? String(agendaIdsRaw).split(',').map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v))
      : (agendaId ? [parseInt(agendaId, 10)] : []);

    if (ids.length) {
      const placeholders = ids.map((id, index) => {
        const nome = `agenda_${index}`;
        r.input(nome, sql.Int, id);
        return `@${nome}`;
      });
      conds.push(`a.id IN (${placeholders.join(', ')})`);
    }
    if (dataInicio) {
      r.input('dataInicio', sql.Date, dataInicio);
      conds.push('i.vencimento>=@dataInicio');
    }
    if (dataFim) {
      r.input('dataFim', sql.Date, dataFim);
      conds.push('i.vencimento<=@dataFim');
    }
    if (status && status !== 'todos') {
      r.input('status', sql.VarChar, status);
      if (status === 'vencido') {
        conds.push("(i.status='vencido' OR (i.status<>'pago' AND i.status<>'lancado' AND i.vencimento < CAST(GETDATE() AS DATE)))");
      } else {
        conds.push('i.status=@status');
      }
    }
    if (categoria) {
      r.input('categoria', sql.VarChar, categoria);
      conds.push('g.nome=@categoria');
    }
    if (empresa) {
      r.input('empresa', sql.VarChar, empresa);
      conds.push('c.nome=@empresa');
    }
    return { r, where: 'WHERE ' + [...conds, ...extraConds].join(' AND ') };
  }

  try {
    const agendasAcesso = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .query(`
        SELECT DISTINCT a.id
        FROM cont_agendas a
        LEFT JOIN cont_membros m ON m.agenda_id = a.id AND m.usuario = @usuario
        WHERE a.dono = @usuario OR m.usuario = @usuario
      `);

    const idsPermitidos = agendasAcesso.recordset.map((item) => item.id);
    const idsSolicitados = agendaIdsRaw
      ? String(agendaIdsRaw).split(',').map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v))
      : (agendaId ? [parseInt(agendaId, 10)] : []);

    if (idsSolicitados.length && idsSolicitados.some((id) => !idsPermitidos.includes(id))) {
      return res.status(403).json({ erro: 'Sem acesso a uma ou mais agendas selecionadas.' });
    }

    const baseFrom = `
      FROM cont_itens i
      JOIN cont_agendas a ON a.id = i.agenda_id
      LEFT JOIN cont_grupos g ON g.id = i.grupo_id
      LEFT JOIN cont_clientes c ON c.id = i.cliente_id
    `;

    if (tipo === 'detalhado') {
      const pg = Math.max(1, parseInt(page, 10) || 1);
      const off = (pg - 1) * 50;
      const { r: rCount, where } = mkReq();
      const countR = await rCount.query(`SELECT COUNT(*) AS total ${baseFrom} ${where}`);

      const { r: rData, where: w2 } = mkReq();
      rData.input('off', sql.Int, off).input('lim', sql.Int, 50);
      const dataR = await rData.query(`
        SELECT i.id, a.nome AS agenda_nome, i.titulo, i.data_emissao, i.vencimento, i.valor,
               i.status, i.recorrencia, g.nome AS categoria_nome, c.nome AS empresa_nome
        ${baseFrom} ${w2}
        ORDER BY i.vencimento ASC, i.criado_em ASC
        OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY
      `);

      return res.json({
        total: countR.recordset[0].total,
        pagina: pg,
        por_pagina: 50,
        itens: dataR.recordset
      });
    }

    const { r: rResumo, where } = mkReq();
    const resumoR = await rResumo.query(`
      SELECT
        COUNT(*) AS total,
        ISNULL(SUM(i.valor), 0) AS total_valor,
        SUM(CASE WHEN i.status='pendente' THEN 1 ELSE 0 END) AS pendentes,
        ISNULL(SUM(CASE WHEN i.status='pendente' THEN i.valor ELSE 0 END), 0) AS valor_pendente,
        SUM(CASE WHEN i.status='pago' THEN 1 ELSE 0 END) AS pagos,
        ISNULL(SUM(CASE WHEN i.status='pago' THEN i.valor ELSE 0 END), 0) AS valor_pago,
        SUM(CASE WHEN i.status='lancado' THEN 1 ELSE 0 END) AS lancados,
        ISNULL(SUM(CASE WHEN i.status='lancado' THEN i.valor ELSE 0 END), 0) AS valor_lancado,
        SUM(CASE WHEN i.status='vencido' OR (i.status<>'pago' AND i.vencimento < CAST(GETDATE() AS DATE)) THEN 1 ELSE 0 END) AS vencidos
        ,ISNULL(SUM(CASE WHEN i.status='vencido' OR (i.status<>'pago' AND i.status<>'lancado' AND i.vencimento < CAST(GETDATE() AS DATE)) THEN i.valor ELSE 0 END), 0) AS valor_vencido
      ${baseFrom} ${where}
    `);

    const { r: rCat, where: wCat } = mkReq(['g.nome IS NOT NULL']);
    const catR = await rCat.query(`
      SELECT g.nome AS categoria, COUNT(*) AS total, ISNULL(SUM(i.valor), 0) AS valor
      ${baseFrom} ${wCat}
      GROUP BY g.nome
      ORDER BY SUM(i.valor) DESC
    `);

    const { r: rEmp, where: wEmp } = mkReq(['c.nome IS NOT NULL']);
    const empR = await rEmp.query(`
      SELECT c.nome AS empresa, COUNT(*) AS total, ISNULL(SUM(i.valor), 0) AS valor
      ${baseFrom} ${wEmp}
      GROUP BY c.nome
      ORDER BY SUM(i.valor) DESC
    `);

    res.json({
      resumo: resumoR.recordset[0],
      por_categoria: catR.recordset,
      por_empresa: empR.recordset
    });
  } catch (erro) {
    logErro.error(`Erro ao gerar relatorio contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao gerar relatorio.' });
  }
});

router.post('/api/contabil/agendas', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const { nome, descricao, cor } = req.body;

  if (!nome?.trim()) return res.status(400).json({ erro: 'Informe o nome da agenda.' });

  try {
    const result = await pool.request()
      .input('nome', sql.VarChar, nome.trim())
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('cor', sql.VarChar, cor || '#55a5ff')
      .input('dono', sql.VarChar, usuario)
      .query(`
        INSERT INTO cont_agendas (nome, descricao, cor, dono)
        OUTPUT INSERTED.id, INSERTED.nome, INSERTED.descricao, INSERTED.cor, INSERTED.dono, INSERTED.criado_em
        VALUES (@nome, @descricao, @cor, @dono)
      `);

    const agenda = { ...result.recordset[0], permissao: 'dono', dono_nome: usuario };
    registrarLog(pool, { usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'contabil', detalhes: `Agenda "${nome.trim()}" criada` });
    res.json({ sucesso: true, mensagem: 'Agenda criada.', agenda });
  } catch (erro) {
    logErro.error(`Erro ao criar agenda contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar agenda.' });
  }
});

router.put('/api/contabil/agendas/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);
  const { nome, descricao, cor } = req.body;

  const permissao = await getPermissao(pool, id, usuario);
  if (permissao !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode editar a agenda.' });
  if (!nome?.trim()) return res.status(400).json({ erro: 'Informe o nome da agenda.' });

  try {
    await pool.request()
      .input('id', sql.Int, id)
      .input('nome', sql.VarChar, nome.trim())
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('cor', sql.VarChar, cor || '#55a5ff')
      .query(`
        UPDATE cont_agendas
        SET nome = @nome, descricao = @descricao, cor = @cor
        WHERE id = @id
      `);

    registrarLog(pool, { usuario, ip: req.ip, acao: 'EDICAO', sistema: 'contabil', detalhes: `Agenda "${nome.trim()}" editada` });
    res.json({ sucesso: true, mensagem: 'Agenda atualizada.' });
  } catch (erro) {
    logErro.error(`Erro ao editar agenda contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao editar agenda.' });
  }
});

router.delete('/api/contabil/agendas/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);

  const permissao = await getPermissao(pool, id, usuario);
  if (permissao !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode excluir a agenda.' });

  try {
    await pool.request().input('id', sql.Int, id).query('DELETE FROM cont_logs WHERE agenda_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM cont_itens WHERE agenda_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM cont_clientes WHERE agenda_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM cont_grupos WHERE agenda_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM cont_membros WHERE agenda_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM cont_agendas WHERE id=@id');

    registrarLog(pool, { usuario, ip: req.ip, acao: 'EXCLUSAO', sistema: 'contabil', detalhes: `Agenda contabil #${id} excluida` });
    res.json({ sucesso: true, mensagem: 'Agenda excluida.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir agenda contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir agenda.' });
  }
});

router.get('/api/contabil/agendas/:id/membros', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);

  const permissao = await getPermissao(pool, id, usuario);
  if (!permissao) return res.status(403).json({ erro: 'Sem acesso a esta agenda.' });

  try {
    const result = await pool.request()
      .input('agenda_id', sql.Int, id)
      .query(`
        SELECT m.usuario,
               COALESCE(u.nome, ud.nome, m.usuario) AS nome,
               m.permissao, m.adicionado_em
        FROM cont_membros m
        LEFT JOIN usuarios u ON u.usuario = m.usuario
        LEFT JOIN usuarios_dominio ud ON ud.login = m.usuario AND u.usuario IS NULL
        WHERE m.agenda_id = @agenda_id
        ORDER BY m.adicionado_em ASC
      `);

    res.json({ sucesso: true, membros: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar membros contabeis: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar membros.' });
  }
});

router.post('/api/contabil/agendas/:id/membros', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);
  const { usuario: novo, permissao } = req.body;

  const permissaoAtual = await getPermissao(pool, id, usuario);
  if (permissaoAtual !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode gerenciar membros.' });
  if (!novo) return res.status(400).json({ erro: 'Informe o usuario.' });
  if (novo === usuario) return res.status(400).json({ erro: 'Voce ja e o dono da agenda.' });

  try {
    await pool.request()
      .input('agenda_id', sql.Int, id)
      .input('usuario', sql.VarChar, novo.trim().toLowerCase())
      .input('permissao', sql.VarChar, permissao || 'leitura')
      .query(`
        IF NOT EXISTS (SELECT 1 FROM cont_membros WHERE agenda_id=@agenda_id AND usuario=@usuario)
          INSERT INTO cont_membros (agenda_id, usuario, permissao) VALUES (@agenda_id, @usuario, @permissao)
        ELSE
          UPDATE cont_membros SET permissao=@permissao WHERE agenda_id=@agenda_id AND usuario=@usuario
      `);

    res.json({ sucesso: true, mensagem: 'Membro salvo.' });
  } catch (erro) {
    logErro.error(`Erro ao salvar membro contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao salvar membro.' });
  }
});

router.delete('/api/contabil/agendas/:id/membros/:membro', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);
  const membro = req.params.membro;

  const permissao = await getPermissao(pool, id, usuario);
  if (permissao !== 'dono') return res.status(403).json({ erro: 'Apenas o dono pode remover membros.' });

  try {
    await pool.request()
      .input('agenda_id', sql.Int, id)
      .input('usuario', sql.VarChar, membro)
      .query('DELETE FROM cont_membros WHERE agenda_id=@agenda_id AND usuario=@usuario');

    res.json({ sucesso: true, mensagem: 'Membro removido.' });
  } catch (erro) {
    logErro.error(`Erro ao remover membro contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao remover membro.' });
  }
});

router.get('/api/contabil/agendas/:id/grupos', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);

  const permissao = await getPermissao(pool, id, usuario);
  if (!permissao) return res.status(403).json({ erro: 'Sem acesso.' });

  try {
    const result = await pool.request()
      .input('agenda_id', sql.Int, id)
      .query(`
        SELECT id, nome, descricao, cor, ordem, ativo, criado_em
        FROM cont_grupos
        WHERE agenda_id = @agenda_id
        ORDER BY ordem ASC, nome ASC
      `);

    res.json({ sucesso: true, grupos: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar grupos contabeis: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar grupos.' });
  }
});

router.post('/api/contabil/agendas/:id/grupos', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);
  const { nome, descricao, cor } = req.body;

  const permissao = await getPermissao(pool, id, usuario);
  if (!temPermissao(permissao, 'edicao')) return res.status(403).json({ erro: 'Sem permissao.' });
  if (!nome?.trim()) return res.status(400).json({ erro: 'Informe o nome do grupo.' });

  try {
    const result = await pool.request()
      .input('agenda_id', sql.Int, id)
      .input('nome', sql.VarChar, nome.trim())
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('cor', sql.VarChar, cor || '#6b7280')
      .query(`
        INSERT INTO cont_grupos (agenda_id, nome, descricao, cor)
        OUTPUT INSERTED.id, INSERTED.nome, INSERTED.descricao, INSERTED.cor, INSERTED.ordem, INSERTED.ativo, INSERTED.criado_em
        VALUES (@agenda_id, @nome, @descricao, @cor)
      `);

    res.json({ sucesso: true, mensagem: 'Grupo criado.', grupo: result.recordset[0] });
  } catch (erro) {
    logErro.error(`Erro ao criar grupo contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar grupo.' });
  }
});

router.delete('/api/contabil/grupos/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);

  const grupo = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT agenda_id, nome FROM cont_grupos WHERE id=@id');

  if (!grupo.recordset[0]) return res.status(404).json({ erro: 'Grupo nao encontrado.' });

  const permissao = await getPermissao(pool, grupo.recordset[0].agenda_id, usuario);
  if (!temPermissao(permissao, 'edicao')) return res.status(403).json({ erro: 'Sem permissao.' });

  try {
    await pool.request().input('id', sql.Int, id).query('UPDATE cont_itens SET grupo_id=NULL WHERE grupo_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM cont_grupos WHERE id=@id');
    res.json({ sucesso: true, mensagem: 'Grupo excluido.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir grupo contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir grupo.' });
  }
});

router.get('/api/contabil/agendas/:id/clientes', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);

  const permissao = await getPermissao(pool, id, usuario);
  if (!permissao) return res.status(403).json({ erro: 'Sem acesso.' });

  try {
    const result = await pool.request()
      .input('agenda_id', sql.Int, id)
      .query(`
        SELECT id, nome, documento, email, whatsapp, responsavel, observacoes, ativo, criado_em
        FROM cont_clientes
        WHERE agenda_id = @agenda_id
        ORDER BY nome ASC
      `);

    res.json({ sucesso: true, clientes: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar clientes contabeis: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar clientes.' });
  }
});

router.post('/api/contabil/agendas/:id/clientes', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);
  const { nome, documento, email, whatsapp, responsavel, observacoes } = req.body;

  const permissao = await getPermissao(pool, id, usuario);
  if (!temPermissao(permissao, 'edicao')) return res.status(403).json({ erro: 'Sem permissao.' });
  if (!nome?.trim()) return res.status(400).json({ erro: 'Informe o nome do cliente.' });

  try {
    const result = await pool.request()
      .input('agenda_id', sql.Int, id)
      .input('nome', sql.VarChar, nome.trim())
      .input('documento', sql.VarChar, (documento || '').trim())
      .input('email', sql.VarChar, (email || '').trim())
      .input('whatsapp', sql.VarChar, (whatsapp || '').trim())
      .input('responsavel', sql.VarChar, (responsavel || '').trim())
      .input('observacoes', sql.VarChar, (observacoes || '').trim())
      .query(`
        INSERT INTO cont_clientes (agenda_id, nome, documento, email, whatsapp, responsavel, observacoes)
        OUTPUT INSERTED.id, INSERTED.nome, INSERTED.documento, INSERTED.email, INSERTED.whatsapp, INSERTED.responsavel, INSERTED.observacoes, INSERTED.ativo, INSERTED.criado_em
        VALUES (@agenda_id, @nome, @documento, @email, @whatsapp, @responsavel, @observacoes)
      `);

    res.json({ sucesso: true, mensagem: 'Cliente criado.', cliente: result.recordset[0] });
  } catch (erro) {
    logErro.error(`Erro ao criar cliente contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao criar cliente.' });
  }
});

router.delete('/api/contabil/clientes/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);

  const cliente = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT agenda_id FROM cont_clientes WHERE id=@id');

  if (!cliente.recordset[0]) return res.status(404).json({ erro: 'Cliente nao encontrado.' });

  const permissao = await getPermissao(pool, cliente.recordset[0].agenda_id, usuario);
  if (!temPermissao(permissao, 'edicao')) return res.status(403).json({ erro: 'Sem permissao.' });

  try {
    await pool.request().input('id', sql.Int, id).query('UPDATE cont_itens SET cliente_id=NULL WHERE cliente_id=@id');
    await pool.request().input('id', sql.Int, id).query('DELETE FROM cont_clientes WHERE id=@id');
    res.json({ sucesso: true, mensagem: 'Cliente excluido.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir cliente contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir cliente.' });
  }
});

router.get('/api/contabil/agendas/:id/itens', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);

  const permissao = await getPermissao(pool, id, usuario);
  if (!permissao) return res.status(403).json({ erro: 'Sem acesso a esta agenda.' });

  try {
    const result = await pool.request()
      .input('agenda_id', sql.Int, id)
      .query(`
        SELECT i.id, i.agenda_id, i.grupo_id, i.cliente_id, i.titulo, i.descricao, i.data_emissao,
               i.vencimento, i.valor, i.recorrencia, i.status, i.prioridade, i.dias_antecedencia,
               i.notificar_email, i.notificar_whatsapp, i.manifesto_ativo, i.observacoes,
               i.recorrencia_id, i.eh_serie_principal, i.parcela_atual, i.max_parcelas, i.recorrencia_fim,
               i.criado_por, i.criado_em, i.atualizado_em,
               g.nome AS grupo_nome,
               c.nome AS cliente_nome
        FROM cont_itens i
        LEFT JOIN cont_grupos g ON g.id = i.grupo_id
        LEFT JOIN cont_clientes c ON c.id = i.cliente_id
        WHERE i.agenda_id = @agenda_id
        ORDER BY i.vencimento ASC, i.criado_em ASC
      `);

    res.json({ sucesso: true, itens: result.recordset, permissao });
  } catch (erro) {
    logErro.error(`Erro ao listar itens contabeis: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar itens.' });
  }
});

router.post('/api/contabil/agendas/:id/itens', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);
  const {
    grupo_id, cliente_id, titulo, descricao, data_emissao, vencimento, valor,
    recorrencia, status, prioridade, dias_antecedencia,
    notificar_email, notificar_whatsapp, manifesto_ativo, observacoes,
    recorrencia_fim, max_parcelas
  } = req.body;

  const permissao = await getPermissao(pool, id, usuario);
  if (!temPermissao(permissao, 'edicao')) return res.status(403).json({ erro: 'Sem permissao para criar itens.' });
  if (!titulo?.trim()) return res.status(400).json({ erro: 'Informe o titulo do item.' });

  try {
    const itensSerie = montarSerieItens({
      grupo_id,
      cliente_id,
      titulo,
      descricao,
      data_emissao,
      vencimento,
      valor,
      recorrencia,
      status,
      prioridade,
      dias_antecedencia,
      notificar_email,
      notificar_whatsapp,
      manifesto_ativo,
      observacoes,
      recorrencia_fim,
      max_parcelas
    }, usuario);

    if (!itensSerie.length) {
      return res.status(400).json({ erro: 'A recorrencia informada nao gerou nenhuma parcela valida.' });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      let primeiroId = null;
      for (const item of itensSerie) {
        const result = await new sql.Request(transaction)
          .input('agenda_id', sql.Int, id)
          .input('grupo_id', sql.Int, item.grupo_id)
          .input('cliente_id', sql.Int, item.cliente_id)
          .input('titulo', sql.VarChar, item.titulo)
          .input('descricao', sql.VarChar, item.descricao)
          .input('data_emissao', sql.Date, item.data_emissao || null)
          .input('vencimento', sql.Date, item.vencimento || null)
          .input('valor', sql.Decimal(15, 2), item.valor)
          .input('recorrencia', sql.VarChar, item.recorrencia)
          .input('status', sql.VarChar, item.status)
          .input('prioridade', sql.VarChar, item.prioridade)
          .input('dias_antecedencia', sql.Int, item.dias_antecedencia)
          .input('notificar_email', sql.Bit, item.notificar_email)
          .input('notificar_whatsapp', sql.Bit, item.notificar_whatsapp)
          .input('manifesto_ativo', sql.Bit, item.manifesto_ativo)
          .input('observacoes', sql.VarChar, item.observacoes)
          .input('recorrencia_id', sql.VarChar, item.recorrencia_id)
          .input('eh_serie_principal', sql.Bit, item.eh_serie_principal)
          .input('parcela_atual', sql.Int, item.parcela_atual)
          .input('max_parcelas', sql.Int, item.max_parcelas)
          .input('recorrencia_fim', sql.Date, item.recorrencia_fim || null)
          .input('criado_por', sql.VarChar, item.criado_por)
          .query(`
            INSERT INTO cont_itens (
              agenda_id, grupo_id, cliente_id, titulo, descricao, data_emissao, vencimento, valor,
              recorrencia, status, prioridade, dias_antecedencia,
              notificar_email, notificar_whatsapp, manifesto_ativo, observacoes,
              recorrencia_id, eh_serie_principal, parcela_atual, max_parcelas, recorrencia_fim, criado_por
            )
            OUTPUT INSERTED.id
            VALUES (
              @agenda_id, @grupo_id, @cliente_id, @titulo, @descricao, @data_emissao, @vencimento, @valor,
              @recorrencia, @status, @prioridade, @dias_antecedencia,
              @notificar_email, @notificar_whatsapp, @manifesto_ativo, @observacoes,
              @recorrencia_id, @eh_serie_principal, @parcela_atual, @max_parcelas, @recorrencia_fim, @criado_por
            )
          `);

        if (!primeiroId) primeiroId = result.recordset[0].id;
      }

      await transaction.commit();
      await registrarLogContabil(pool, id, primeiroId, 'CRIAR', `${itensSerie.length} item(ns) criado(s): ${titulo.trim()}`, usuario);
    } catch (erroTransacao) {
      await transaction.rollback();
      throw erroTransacao;
    }

    registrarLog(pool, { usuario, ip: req.ip, acao: 'CRIACAO', sistema: 'contabil', detalhes: `Item contabil criado: ${titulo.trim()}` });
    const agendaNomeR = await pool.request().input('id', sql.Int, id).query('SELECT nome FROM cont_agendas WHERE id=@id');
    await enviarWhatsAppContabil(pool, 'contabil.novo_item', {
      titulo: titulo.trim(),
      agendaNome: agendaNomeR.recordset[0]?.nome || '',
      valor: parseFloat(valor || 0).toFixed(2),
      vencimento: vencimento || '-',
      criadoPor: usuario,
      loginsAgenda: await getLoginsAgendaContabil(pool, id),
    }, { usuario, ip: req.ip });
    res.json({ sucesso: true, mensagem: `${itensSerie.length} item(ns) criado(s).` });
  } catch (erro) {
    logErro.error(`Erro ao criar item contabil: ${erro.message}`);
    res.status(erro.message.includes('Informe a data de vencimento') ? 400 : 500).json({ erro: erro.message || 'Erro ao criar item.' });
  }
});

router.delete('/api/contabil/itens/recorrencia/:rid', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const rid = req.params.rid;

  const serie = await pool.request()
    .input('rid', sql.VarChar, rid)
    .query('SELECT TOP 1 agenda_id, titulo FROM cont_itens WHERE recorrencia_id=@rid');

  if (!serie.recordset[0]) return res.status(404).json({ erro: 'Serie recorrente nao encontrada.' });

  const agendaId = serie.recordset[0].agenda_id;
  const permissao = await getPermissao(pool, agendaId, usuario);
  if (!temPermissao(permissao, 'edicao')) return res.status(403).json({ erro: 'Sem permissao.' });

  try {
    await pool.request()
      .input('rid', sql.VarChar, rid)
      .query('DELETE FROM cont_itens WHERE recorrencia_id=@rid');

    await registrarLogContabil(pool, agendaId, null, 'EXCLUIR', `Serie recorrente excluida: ${serie.recordset[0].titulo}`, usuario);
    res.json({ sucesso: true, mensagem: 'Serie recorrente excluida.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir serie recorrente contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir serie recorrente.' });
  }
});

router.put('/api/contabil/itens/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);
  const {
    grupo_id, cliente_id, titulo, descricao, data_emissao, vencimento, valor,
    recorrencia, status, prioridade, dias_antecedencia,
    notificar_email, notificar_whatsapp, manifesto_ativo, observacoes,
    recorrencia_fim, max_parcelas, propagarGrupo
  } = req.body;

  const itemAtual = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT agenda_id, titulo, recorrencia_id, parcela_atual, max_parcelas, eh_serie_principal FROM cont_itens WHERE id=@id');

  if (!itemAtual.recordset[0]) return res.status(404).json({ erro: 'Item nao encontrado.' });

  const agendaId = itemAtual.recordset[0].agenda_id;
  const permissao = await getPermissao(pool, agendaId, usuario);
  if (!temPermissao(permissao, 'edicao')) return res.status(403).json({ erro: 'Sem permissao.' });
  const ehSerieFilha = !!itemAtual.recordset[0].recorrencia_id && !itemAtual.recordset[0].eh_serie_principal;
  if (!ehSerieFilha && !titulo?.trim()) return res.status(400).json({ erro: 'Informe o titulo do item.' });

  try {
    if (ehSerieFilha && !propagarGrupo) {
      await pool.request()
        .input('id', sql.Int, id)
        .input('vencimento', sql.Date, vencimento || null)
        .input('valor', sql.Decimal(15, 2), parseFloat(valor) || 0)
        .input('status', sql.VarChar, calcularStatus(vencimento, status || 'pendente'))
        .query(`
          UPDATE cont_itens
          SET vencimento = @vencimento,
              valor = @valor,
              status = @status,
              atualizado_em = GETDATE()
          WHERE id = @id
        `);

      await registrarLogContabil(pool, agendaId, id, 'ATUALIZAR', `Parcela recorrente atualizada: ${itemAtual.recordset[0].titulo}`, usuario);
      return res.json({ sucesso: true, mensagem: 'Parcela recorrente atualizada.' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('grupo_id', sql.Int, grupo_id || null)
      .input('cliente_id', sql.Int, cliente_id || null)
      .input('titulo', sql.VarChar, titulo.trim())
      .input('descricao', sql.VarChar, (descricao || '').trim())
      .input('data_emissao', sql.Date, data_emissao || null)
      .input('vencimento', sql.Date, vencimento || null)
      .input('valor', sql.Decimal(15, 2), parseFloat(valor) || 0)
      .input('recorrencia', sql.VarChar, normalizarFrequencia(recorrencia || 'Mensal'))
      .input('status', sql.VarChar, calcularStatus(vencimento, status || 'pendente'))
      .input('prioridade', sql.VarChar, prioridade || 'normal')
      .input('dias_antecedencia', sql.Int, parseInt(dias_antecedencia) || 3)
      .input('notificar_email', sql.Bit, notificar_email ? 1 : 0)
      .input('notificar_whatsapp', sql.Bit, notificar_whatsapp ? 1 : 0)
      .input('manifesto_ativo', sql.Bit, manifesto_ativo ? 1 : 0)
      .input('observacoes', sql.VarChar, (observacoes || '').trim())
      .input('max_parcelas', sql.Int, Math.max(1, parseInt(max_parcelas, 10) || itemAtual.recordset[0].max_parcelas || 1))
      .input('recorrencia_fim', sql.Date, recorrencia_fim || null)
      .query(`
        UPDATE cont_itens
        SET grupo_id = @grupo_id,
            cliente_id = @cliente_id,
            titulo = @titulo,
            descricao = @descricao,
            data_emissao = @data_emissao,
            vencimento = @vencimento,
            valor = @valor,
            recorrencia = @recorrencia,
            status = @status,
            prioridade = @prioridade,
            dias_antecedencia = @dias_antecedencia,
            notificar_email = @notificar_email,
            notificar_whatsapp = @notificar_whatsapp,
            manifesto_ativo = @manifesto_ativo,
            observacoes = @observacoes,
            max_parcelas = @max_parcelas,
            recorrencia_fim = @recorrencia_fim,
            atualizado_em = GETDATE()
        WHERE id = @id
      `);

    if (propagarGrupo && itemAtual.recordset[0].recorrencia_id) {
      await pool.request()
        .input('rid', sql.VarChar, itemAtual.recordset[0].recorrencia_id)
        .input('id', sql.Int, id)
        .input('grupo_id', sql.Int, grupo_id || null)
        .input('cliente_id', sql.Int, cliente_id || null)
        .input('titulo', sql.VarChar, titulo.trim())
        .input('descricao', sql.VarChar, (descricao || '').trim())
        .input('data_emissao', sql.Date, data_emissao || null)
        .input('prioridade', sql.VarChar, prioridade || 'normal')
        .input('dias_antecedencia', sql.Int, parseInt(dias_antecedencia) || 3)
        .input('notificar_email', sql.Bit, notificar_email ? 1 : 0)
        .input('notificar_whatsapp', sql.Bit, notificar_whatsapp ? 1 : 0)
        .input('manifesto_ativo', sql.Bit, manifesto_ativo ? 1 : 0)
        .input('observacoes', sql.VarChar, (observacoes || '').trim())
        .query(`
          UPDATE cont_itens
          SET grupo_id = @grupo_id,
              cliente_id = @cliente_id,
              titulo = @titulo,
              descricao = @descricao,
              data_emissao = @data_emissao,
              prioridade = @prioridade,
              dias_antecedencia = @dias_antecedencia,
              notificar_email = @notificar_email,
              notificar_whatsapp = @notificar_whatsapp,
              manifesto_ativo = @manifesto_ativo,
              observacoes = @observacoes,
              atualizado_em = GETDATE()
          WHERE recorrencia_id = @rid AND id <> @id
        `);
    }

    await registrarLogContabil(pool, agendaId, id, 'ATUALIZAR', propagarGrupo ? `Serie recorrente atualizada: ${titulo.trim()}` : `Item atualizado: ${titulo.trim()}`, usuario);
    const agendaNomeR = await pool.request().input('id', sql.Int, agendaId).query('SELECT nome FROM cont_agendas WHERE id=@id');
    await enviarWhatsAppContabil(pool, 'contabil.item_editado', {
      titulo: titulo.trim(),
      agendaNome: agendaNomeR.recordset[0]?.nome || '',
      valor: parseFloat(valor || 0).toFixed(2),
      vencimento: vencimento || '-',
      criadoPor: usuario,
      loginsAgenda: await getLoginsAgendaContabil(pool, agendaId),
    }, { usuario, ip: req.ip });
    res.json({ sucesso: true, mensagem: propagarGrupo ? 'Serie recorrente atualizada.' : 'Item atualizado.' });
  } catch (erro) {
    logErro.error(`Erro ao editar item contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao editar item.' });
  }
});

router.patch('/api/contabil/itens/:id/status', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);
  const { status } = req.body;

  if (!['pendente', 'lancado', 'pago', 'vencido'].includes(status))
    return res.status(400).json({ erro: 'Status invalido.' });

  const itemAtual = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT agenda_id, titulo FROM cont_itens WHERE id=@id');

  if (!itemAtual.recordset[0]) return res.status(404).json({ erro: 'Item nao encontrado.' });

  const agendaId = itemAtual.recordset[0].agenda_id;
  const permissao = await getPermissao(pool, agendaId, usuario);
  if (!temPermissao(permissao, 'edicao')) return res.status(403).json({ erro: 'Sem permissao.' });

  try {
    await pool.request()
      .input('id', sql.Int, id)
      .input('status', sql.VarChar, status)
      .query('UPDATE cont_itens SET status=@status, atualizado_em=GETDATE() WHERE id=@id');

    await registrarLogContabil(pool, agendaId, id, status === 'lancado' ? 'LANCAMENTO' : 'ATUALIZAR', `Status -> ${status}: ${itemAtual.recordset[0].titulo}`, usuario);
    const agendaNomeR = await pool.request().input('id', sql.Int, agendaId).query('SELECT nome FROM cont_agendas WHERE id=@id');
    const evento = status === 'pago' ? 'contabil.item_pago' : (status === 'vencido' ? 'contabil.item_vencido' : 'contabil.item_editado');
    await enviarWhatsAppContabil(pool, evento, {
      titulo: itemAtual.recordset[0].titulo,
      agendaNome: agendaNomeR.recordset[0]?.nome || '',
      valor: '-',
      vencimento: '-',
      criadoPor: usuario,
      loginsAgenda: await getLoginsAgendaContabil(pool, agendaId),
    }, { usuario, ip: req.ip });
    res.json({ sucesso: true, mensagem: 'Status atualizado.' });
  } catch (erro) {
    logErro.error(`Erro ao atualizar status contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao atualizar status.' });
  }
});

router.delete('/api/contabil/itens/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);

  const itemAtual = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT agenda_id, titulo FROM cont_itens WHERE id=@id');

  if (!itemAtual.recordset[0]) return res.status(404).json({ erro: 'Item nao encontrado.' });

  const agendaId = itemAtual.recordset[0].agenda_id;
  const permissao = await getPermissao(pool, agendaId, usuario);
  if (!temPermissao(permissao, 'edicao')) return res.status(403).json({ erro: 'Sem permissao.' });

  try {
    await pool.request().input('id', sql.Int, id).query('DELETE FROM cont_itens WHERE id=@id');
    await registrarLogContabil(pool, agendaId, null, 'EXCLUIR', `Item excluido: ${itemAtual.recordset[0].titulo}`, usuario);
    res.json({ sucesso: true, mensagem: 'Item excluido.' });
  } catch (erro) {
    logErro.error(`Erro ao excluir item contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao excluir item.' });
  }
});

router.get('/api/contabil/agendas/:id/logs', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;
  const id = parseInt(req.params.id);

  const permissao = await getPermissao(pool, id, usuario);
  if (!permissao) return res.status(403).json({ erro: 'Sem acesso.' });

  try {
    const result = await pool.request()
      .input('agenda_id', sql.Int, id)
      .query(`
        SELECT TOP 100 l.id, l.item_id, l.acao, l.detalhes, l.usuario, l.data_hora,
               i.titulo AS item_titulo
        FROM cont_logs l
        LEFT JOIN cont_itens i ON i.id = l.item_id
        WHERE l.agenda_id = @agenda_id
        ORDER BY l.data_hora DESC
      `);

    res.json({ sucesso: true, logs: result.recordset });
  } catch (erro) {
    logErro.error(`Erro ao listar logs contabeis: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar logs.' });
  }
});

router.get('/api/contabil/usuarios', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const logErro = req.app.locals.logErro;
  const usuario = req.session.usuario.usuario;

  try {
    const result = await pool.request().query(`
      SELECT usuario AS login, nome FROM usuarios WHERE ativo = 1
      UNION ALL
      SELECT login, nome FROM usuarios_dominio WHERE ativo = 1
      ORDER BY nome
    `);

    res.json({ sucesso: true, usuarios: result.recordset.filter((u) => u.login !== usuario) });
  } catch (erro) {
    logErro.error(`Erro ao listar usuarios para contabil: ${erro.message}`);
    res.status(500).json({ erro: 'Erro ao carregar usuarios.' });
  }
});

router.get('/api/contabil/config', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;

  try {
    const result = await pool.request()
      .query(`SELECT chave, valor FROM configuracoes WHERE grupo = 'contabil'`);

    const config = {};
    result.recordset.forEach((row) => {
      config[row.chave] = row.valor;
    });

    res.json({ sucesso: true, config });
  } catch (erro) {
    res.json({ sucesso: true, config: {} });
  }
});

router.post('/api/contabil/config', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario;
  const dias = parseInt(req.body.dias_lembrete);

  if (usuario.nivel !== 'admin') return res.status(403).json({ erro: 'Sem permissao.' });
  if (isNaN(dias) || dias < 1) return res.status(400).json({ erro: 'Valor invalido.' });

  try {
    await pool.request()
      .input('chave', sql.VarChar, 'contabil.dias_lembrete')
      .input('valor', sql.VarChar, String(dias))
      .query(`
        IF EXISTS (SELECT 1 FROM configuracoes WHERE chave = @chave)
          UPDATE configuracoes SET valor = @valor WHERE chave = @chave
        ELSE
          INSERT INTO configuracoes (chave, valor, grupo, descricao)
          VALUES (@chave, @valor, 'contabil', 'Dias de antecedencia para lembrete da agenda contabil')
      `);

    res.json({ sucesso: true });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao salvar configuracao.' });
  }
});

module.exports = router;

