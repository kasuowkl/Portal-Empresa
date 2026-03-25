/**
 * ARQUIVO: services/cronCalendarios.js
 * VERSÃO: 2.0.0
 * DATA: 2026-03-23
 * DESCRIÇÃO: Jobs periódicos para Agenda de Calendários
 * - Sincronização periódica com Google Calendar (a cada 30 min)
 * Usa setInterval nativo (sem dependência node-cron)
 */

const sql = require('mssql');
const caldavService = require('./caldavService');

// ============================================================
// INICIAR JOBS PERIÓDICOS
// ============================================================
function iniciarCronCalendarios(appLocals) {
  const pool = appLocals.pool;
  const logAtividade = appLocals.logAtividade;
  const logErro = appLocals.logErro;

  // Job: Sincronização Google → Portal — DESABILITADO (Google exige OAuth2)
  // Será habilitado quando implementar OAuth2 ou URL iCal secreta
  // const INTERVALO_SYNC = 30 * 60 * 1000;
  // setInterval(async () => {
  //   await sincronizarGoogle(pool, logErro);
  // }, INTERVALO_SYNC);

  logAtividade.info('[Cron Calendarios] Agendador de calendários iniciado (sync Google desabilitado)');
}

// ============================================================
// SINCRONIZAR GOOGLE → PORTAL
// ============================================================
async function sincronizarGoogle(pool, logErro) {
  try {
    // Buscar usuários com Google Calendar configurado e sync ativo
    const result = await pool.request()
      .query('SELECT usuario FROM cal_caldav_config WHERE sync_ativo = 1');

    const usuarios = result.recordset.map(r => r.usuario);

    for (const usuario of usuarios) {
      try {
        await caldavService.sincronizarDoGoogle(usuario, pool);
        console.log(`[Cron Calendarios] Sincronizado para ${usuario}`);
      } catch (erro) {
        logErro.error(`Erro ao sincronizar ${usuario}: ${erro.message}`);
      }
    }

    console.log(`[Cron Calendarios] Sincronização concluída para ${usuarios.length} usuários`);
  } catch (erro) {
    logErro.error(`Erro na sincronização Google: ${erro.message}`);
  }
}

// ============================================================
// EXPORTAÇÕES
// ============================================================
module.exports = {
  iniciarCronCalendarios
};
