/**
 * ARQUIVO: services/cronAprovacoes.js
 * DESCRIÇÃO: Agendador de lembrete de aprovações pendentes (diário às 08:00)
 */

const sql = require('mssql');
const { enviarNotificacao } = require('./emailService');

async function buscarEmail(pool, login) {
  if (!login) return null;
  try {
    const r = await pool.request().input('login', sql.VarChar, login)
      .query('SELECT email FROM usuarios_dominio WHERE login = @login AND ativo = 1');
    return r.recordset[0]?.email || null;
  } catch { return null; }
}

function montarListaHTML(aprovacoes) {
  const linhas = aprovacoes.map(a =>
    `<tr>
       <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f">${a.titulo}</td>
       <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f">${a.criado_por_nome || a.criado_por}</td>
       <td style="padding:6px 10px;border-bottom:1px solid #1e3a5f;white-space:nowrap">${new Date(a.criado_em).toLocaleDateString('pt-BR')}</td>
     </tr>`
  ).join('');
  return `
    <table style="width:100%;border-collapse:collapse;font-size:0.85rem;color:#e0e0e0">
      <thead>
        <tr style="background:#1e3a5f">
          <th style="padding:6px 10px;text-align:left">Título</th>
          <th style="padding:6px 10px;text-align:left">Criado por</th>
          <th style="padding:6px 10px;text-align:left">Data</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>`;
}

async function enviarLembreteAprovacoes(pool) {
  // Busca todos os aprovadores com pendências
  const r = await pool.request().query(`
    SELECT DISTINCT ap.aprovador_login, ap.aprovador_nome,
      a.id, a.titulo, a.criado_por, a.criado_por_nome, a.criado_em
    FROM aprovacoes_participantes ap
    JOIN aprovacoes a ON a.id = ap.aprovacao_id
    WHERE ap.decisao = 'Pendente' AND a.status = 'Pendente'
    ORDER BY ap.aprovador_login, a.criado_em
  `);

  // Agrupa por aprovador
  const porAprovador = {};
  for (const row of r.recordset) {
    if (!porAprovador[row.aprovador_login]) {
      porAprovador[row.aprovador_login] = { nome: row.aprovador_nome, aprovacoes: [] };
    }
    porAprovador[row.aprovador_login].aprovacoes.push(row);
  }

  for (const [login, dados] of Object.entries(porAprovador)) {
    const email = await buscarEmail(pool, login);
    if (!email) continue;

    await enviarNotificacao(pool, 'aprovacoes.lembrete_pendente', {
      login,
      nome:              dados.nome || login,
      total:             dados.aprovacoes.length,
      lista_html:        montarListaHTML(dados.aprovacoes),
      email_aprovadores: [email],
    }).catch(() => {});
  }

  console.log(`[Cron Aprovações] Lembretes enviados para ${Object.keys(porAprovador).length} aprovador(es).`);
}

function iniciarCronAprovacoes(pool) {
  let ultimoDiaExecutado = -1;

  setInterval(async () => {
    const agora = new Date();
    const hora  = agora.getHours();
    const min   = agora.getMinutes();
    const dia   = agora.getDate();

    if (hora === 8 && min === 0 && dia !== ultimoDiaExecutado) {
      ultimoDiaExecutado = dia;
      console.log('[Cron Aprovações] Iniciando lembrete das 08:00...');
      try { await enviarLembreteAprovacoes(pool); }
      catch (e) { console.error('[Cron Aprovações] Erro:', e.message); }
    }
  }, 60 * 1000);

  console.log('[Cron Aprovações] Agendador iniciado — lembretes às 08:00 diariamente.');
}

module.exports = { iniciarCronAprovacoes };
