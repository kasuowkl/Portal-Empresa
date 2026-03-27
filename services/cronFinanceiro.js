/**
 * ARQUIVO: services/cronFinanceiro.js
 * VERSÃO:  2.0.0
 * DATA:    2026-03-17
 * DESCRIÇÃO: Agendador de lembretes financeiros (diário às 07:00)
 *            Envia e-mails personalizados por usuário (dono + membros com edição).
 */

const sql = require('mssql');
const { enviarNotificacao } = require('./emailService');

/**
 * Formata uma lista de contas em HTML para o corpo do e-mail.
 */
function montarListaHTML(contas) {
  if (!contas.length) return '<p>Nenhuma conta encontrada.</p>';
  const linhas = contas.map(c =>
    `<tr>
       <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f">${c.descricao}</td>
       <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f;white-space:nowrap">R$ ${parseFloat(c.valor || 0).toFixed(2)}</td>
       <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f;white-space:nowrap">${c.data_fmt}</td>
       <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f">${c.categoria || '—'}</td>
       <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f">${c.agenda_nome || '—'}</td>
     </tr>`
  ).join('');
  return `
    <table style="width:100%;border-collapse:collapse;font-size:0.85rem;color:#e0e0e0">
      <thead>
        <tr style="background:#1e3a5f">
          <th style="padding:6px 10px;text-align:left">Descrição</th>
          <th style="padding:6px 10px;text-align:left">Valor</th>
          <th style="padding:6px 10px;text-align:left">Vencimento</th>
          <th style="padding:6px 10px;text-align:left">Categoria</th>
          <th style="padding:6px 10px;text-align:left">Agenda</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>`;
}

/**
 * Formata uma data JS como dd/mm/yyyy.
 */
function fmtData(d) {
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Busca contas pendentes em um intervalo de datas e agrupa por e-mail do destinatário.
 * Retorna Map<email, conta[]>
 */
async function getContasPorUsuario(pool, inicio, fim) {
  const r = await pool.request()
    .input('inicio', sql.Date, inicio)
    .input('fim',    sql.Date, fim)
    .query(`
      SELECT DISTINCT
        ud.email        AS email,
        c.descricao,
        c.valor,
        c.categoria,
        c.data,
        fa.nome         AS agenda_nome,
        FORMAT(c.data, 'dd/MM/yyyy') AS data_fmt
      FROM fin_contas c
      JOIN fin_agendas fa ON fa.id = c.agenda_id
      JOIN (
        SELECT dono AS login, id AS agenda_id FROM fin_agendas
        UNION
        SELECT usuario AS login, agenda_id FROM fin_membros WHERE permissao IN ('edicao', 'dono')
      ) u ON u.agenda_id = c.agenda_id
      JOIN usuarios_dominio ud ON ud.login = u.login
      WHERE c.data >= @inicio
        AND c.data <  @fim
        AND c.status NOT IN ('pago')
        AND c.eh_pai = 0
        AND ud.email IS NOT NULL
        AND ud.email != ''
      ORDER BY ud.email, c.data, c.descricao
    `);

  const map = new Map();
  for (const row of r.recordset) {
    if (!map.has(row.email)) map.set(row.email, []);
    map.get(row.email).push(row);
  }
  return map;
}

/**
 * Lembrete: contas que vencem HOJE.
 */
async function enviarLembreteHoje(pool) {
  const hoje  = new Date(); hoje.setHours(0, 0, 0, 0);
  const amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);

  const porUsuario = await getContasPorUsuario(pool, hoje, amanha);
  if (porUsuario.size === 0) {
    console.log('[Cron Financeiro] Lembrete hoje: nenhuma conta pendente.');
    return;
  }

  for (const [email, contas] of porUsuario) {
    await enviarNotificacao(pool, 'financeiro.lembrete_hoje', {
      total:            contas.length,
      data_hoje:        fmtData(hoje),
      lista_html:       montarListaHTML(contas),
      email_criado_por: email,
    }).catch(e => console.error(`[Cron Financeiro] Erro lembrete_hoje (${email}): ${e.message}`));
  }
  console.log(`[Cron Financeiro] Lembrete hoje enviado para ${porUsuario.size} usuário(s).`);
}

/**
 * Lembrete: contas que vencem nos próximos 7 dias (excluindo hoje).
 */
async function enviarLembrete7Dias(pool) {
  const hoje   = new Date(); hoje.setHours(0, 0, 0, 0);
  const amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);
  const limite = new Date(hoje); limite.setDate(limite.getDate() + 8); // até hoje+7 inclusive

  const porUsuario = await getContasPorUsuario(pool, amanha, limite);
  if (porUsuario.size === 0) {
    console.log('[Cron Financeiro] Lembrete 7 dias: nenhuma conta pendente.');
    return;
  }

  for (const [email, contas] of porUsuario) {
    await enviarNotificacao(pool, 'financeiro.lembrete_7dias', {
      total:            contas.length,
      lista_html:       montarListaHTML(contas),
      email_criado_por: email,
    }).catch(e => console.error(`[Cron Financeiro] Erro lembrete_7dias (${email}): ${e.message}`));
  }
  console.log(`[Cron Financeiro] Lembrete 7 dias enviado para ${porUsuario.size} usuário(s).`);
}

/**
 * Lembrete de lançamento: contas que vencem em N dias (configurável).
 * Usa a configuração `financeiro.dias_lembrete` da tabela `configuracoes`.
 */
async function enviarLembreteLancamento(pool) {
  // Lê configuração de dias
  const cfgR = await pool.request()
    .input('chave', sql.VarChar, 'financeiro.dias_lembrete')
    .query('SELECT valor FROM configuracoes WHERE chave = @chave');
  const dias = parseInt(cfgR.recordset[0]?.valor) || 3;

  const hoje  = new Date(); hoje.setHours(0, 0, 0, 0);
  const inicio = new Date(hoje); inicio.setDate(inicio.getDate() + dias);
  const fim    = new Date(inicio); fim.setDate(fim.getDate() + 1);

  // Busca apenas contas que ainda NÃO foram lançadas (status = 'pendente')
  const r = await pool.request()
    .input('inicio', sql.Date, inicio)
    .input('fim',    sql.Date, fim)
    .query(`
      SELECT DISTINCT
        ud.email        AS email,
        c.descricao,
        c.valor,
        c.categoria,
        c.data,
        fa.nome         AS agenda_nome,
        FORMAT(c.data, 'dd/MM/yyyy') AS data_fmt
      FROM fin_contas c
      JOIN fin_agendas fa ON fa.id = c.agenda_id
      JOIN (
        SELECT dono AS login, id AS agenda_id FROM fin_agendas
        UNION
        SELECT usuario AS login, agenda_id FROM fin_membros WHERE permissao IN ('edicao', 'dono')
      ) u ON u.agenda_id = c.agenda_id
      JOIN usuarios_dominio ud ON ud.login = u.login
      WHERE c.data >= @inicio
        AND c.data <  @fim
        AND c.status  = 'pendente'
        AND c.eh_pai  = 0
        AND ud.email IS NOT NULL
        AND ud.email != ''
      ORDER BY ud.email, c.data, c.descricao
    `);

  const porUsuario = new Map();
  for (const row of r.recordset) {
    if (!porUsuario.has(row.email)) porUsuario.set(row.email, []);
    porUsuario.get(row.email).push(row);
  }

  if (porUsuario.size === 0) {
    console.log(`[Cron Financeiro] Lembrete lançamento (${dias}d): nenhuma conta.`);
    return;
  }

  for (const [email, contas] of porUsuario) {
    await enviarNotificacao(pool, 'financeiro.lembrete_lancamento', {
      total:            contas.length,
      dias,
      lista_html:       montarListaHTML(contas),
      email_criado_por: email,
    }).catch(e => console.error(`[Cron Financeiro] Erro lembrete_lancamento (${email}): ${e.message}`));
  }
  console.log(`[Cron Financeiro] Lembrete lançamento (${dias}d) enviado para ${porUsuario.size} usuário(s).`);
}

/**
 * Verificação diária de contas vencidas (para contas que venceram antes de hoje).
 */
async function enviarContasVencidas(pool) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

  const r = await pool.request()
    .input('hoje', sql.Date, hoje)
    .query(`
      SELECT DISTINCT
        ud.email        AS email,
        c.descricao,
        c.valor,
        c.categoria,
        c.data,
        fa.nome         AS agenda_nome,
        FORMAT(c.data, 'dd/MM/yyyy') AS data_fmt
      FROM fin_contas c
      JOIN fin_agendas fa ON fa.id = c.agenda_id
      JOIN (
        SELECT dono AS login, id AS agenda_id FROM fin_agendas
        UNION
        SELECT usuario AS login, agenda_id FROM fin_membros WHERE permissao IN ('edicao', 'dono')
      ) u ON u.agenda_id = c.agenda_id
      JOIN usuarios_dominio ud ON ud.login = u.login
      WHERE c.data < @hoje
        AND c.status NOT IN ('pago')
        AND c.eh_pai = 0
        AND ud.email IS NOT NULL
        AND ud.email != ''
      ORDER BY ud.email, c.data, c.descricao
    `);

  const porUsuario = new Map();
  for (const row of r.recordset) {
    if (!porUsuario.has(row.email)) porUsuario.set(row.email, []);
    porUsuario.get(row.email).push(row);
  }

  if (porUsuario.size === 0) {
    console.log('[Cron Financeiro] Contas vencidas: nenhuma encontrada.');
    return;
  }

  for (const [email, contas] of porUsuario) {
    await enviarNotificacao(pool, 'financeiro.conta_vencida_diario', {
      total:            contas.length,
      lista_html:       montarListaHTML(contas),
      email_criado_por: email,
    }).catch(e => console.error(`[Cron Financeiro] Erro conta_vencida_diario (${email}): ${e.message}`));
  }
  console.log(`[Cron Financeiro] Contas vencidas enviado para ${porUsuario.size} usuário(s).`);
}

/**
 * Inicia o agendador. Verifica a cada minuto se é hora de disparar
 * os lembretes (08:00 local). Dispara uma vez por dia.
 *
 * @param {object} pool - Pool de conexão MSSQL
 */
function iniciarCronFinanceiro(pool) {
  let ultimoDiaExecutado = -1;

  setInterval(async () => {
    const agora = new Date();
    const hora  = agora.getHours();
    const min   = agora.getMinutes();
    const dia   = agora.getDate();

    // Executa às 07:00 e apenas uma vez por dia
    if (hora === 7 && min === 0 && dia !== ultimoDiaExecutado) {
      ultimoDiaExecutado = dia;
      console.log('[Cron Financeiro] Iniciando lembretes das 08:00...');
      try { await enviarLembreteHoje(pool);      } catch (e) { console.error('[Cron Financeiro] Erro lembrete_hoje:', e.message); }
      try { await enviarLembrete7Dias(pool);     } catch (e) { console.error('[Cron Financeiro] Erro lembrete_7dias:', e.message); }
      try { await enviarLembreteLancamento(pool);} catch (e) { console.error('[Cron Financeiro] Erro lembrete_lancamento:', e.message); }
      try { await enviarContasVencidas(pool);    } catch (e) { console.error('[Cron Financeiro] Erro conta_vencida_diario:', e.message); }
    }
  }, 60 * 1000); // verifica a cada 1 minuto

  console.log('[Cron Financeiro] Agendador v2 iniciado — lembretes diários às 07:00.');
}

module.exports = {
  iniciarCronFinanceiro,
  // Exportados para uso no endpoint de teste
  enviarLembreteHoje,
  enviarLembrete7Dias,
  enviarLembreteLancamento,
  enviarContasVencidas,
};
