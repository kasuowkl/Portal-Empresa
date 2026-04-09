/**
 * ARQUIVO: services/cronWhatsApp.js
 * DESCRIÇÃO: Agendador de lembretes WhatsApp (diário às 07:00)
 */

const sql = require('mssql');
const { buscarWhatsAppsPorLogins, enviarNotificacaoWhatsAppPorChips } = require('./whatsappDispatchService');
const { renderizarMensagemWhatsApp } = require('./whatsappTemplateService');

async function enviarLembreteWhatsAppAprovacoes(pool) {
  const r = await pool.request().query(`
    SELECT DISTINCT ap.aprovador_login, ap.aprovador_nome,
      a.id, a.titulo, a.criado_por, a.criado_por_nome, a.criado_em
    FROM aprovacoes_participantes ap
    JOIN aprovacoes a ON a.id = ap.aprovacao_id
    WHERE ap.decisao = 'Pendente' AND a.status = 'Pendente'
    ORDER BY ap.aprovador_login, a.criado_em
  `);

  const porAprovador = {};
  for (const row of r.recordset) {
    if (!porAprovador[row.aprovador_login]) {
      porAprovador[row.aprovador_login] = { nome: row.aprovador_nome, aprovacoes: [] };
    }
    porAprovador[row.aprovador_login].aprovacoes.push(row);
  }

  for (const [login, dados] of Object.entries(porAprovador)) {
    const mapaWhats = await buscarWhatsAppsPorLogins(pool, [login]);
    const numero = mapaWhats[String(login).toLowerCase()];

    const mensagemWhatsApp = await renderizarMensagemWhatsApp(pool, 'aprovacoes.cron_pendentes', {
      nome: dados.nome || login,
      total: dados.aprovacoes.length,
      link_aprovacoes: 'http://192.168.0.80:3132/aprovacoes/',
    });
    await enviarNotificacaoWhatsAppPorChips(pool, {
      evento: 'aprovacoes.lembrete_pendente',
      sistema: 'aprovacoes',
      mensagem: mensagemWhatsApp,
      usuario: login,
      ip: '::1',
      mapaChips: {
        aprovadores_pendentes: [login],
      },
      extraNumeros: numero ? [numero] : [],
    }).catch(() => {});
  }

  console.log(`[Cron WhatsApp] Lembretes de aprovações enviados para ${Object.keys(porAprovador).length} aprovador(es).`);
}

function iniciarCronWhatsApp(pool) {
  let ultimoDiaExecutado = -1;

  setInterval(async () => {
    const agora = new Date();
    const hora  = agora.getHours();
    const min   = agora.getMinutes();
    const dia   = agora.getDate();

    if (hora === 7 && min === 0 && dia !== ultimoDiaExecutado) {
      ultimoDiaExecutado = dia;
      console.log('[Cron WhatsApp] Iniciando automações das 07:00...');
      try { await enviarLembreteWhatsAppAprovacoes(pool); }
      catch (e) { console.error('[Cron WhatsApp] Erro em aprovações:', e.message); }
    }
  }, 60 * 1000);

  console.log('[Cron WhatsApp] Agendador iniciado - lembretes diários às 07:00.');
}

module.exports = {
  iniciarCronWhatsApp,
  enviarLembreteWhatsAppAprovacoes,
};

