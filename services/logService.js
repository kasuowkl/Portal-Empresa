/**
 * ARQUIVO: services/logService.js
 * DESCRIÇÃO: Helper para registrar eventos de atividade em logs_atividade
 */

const sql = require('mssql');

/**
 * Registra uma entrada de log na tabela logs_atividade.
 * Silencia erros para nunca bloquear o fluxo principal.
 *
 * @param {object} pool
 * @param {object} opts
 * @param {string} opts.usuario  - Login do usuário
 * @param {string} opts.ip       - IP da requisição
 * @param {string} opts.acao     - LOGIN | LOGOUT | CRIACAO | EDICAO | EXCLUSAO
 * @param {string} opts.sistema  - portal | chamados | financeiro | patrimonio | agenda | contatos
 * @param {string} opts.detalhes - Descrição do evento
 */
async function registrarLog(pool, { usuario, ip, acao, sistema, detalhes }) {
  try {
    await pool.request()
      .input('usuario',  sql.VarChar(50),  (usuario  || 'sistema').substring(0, 50))
      .input('acao',     sql.VarChar(100), (acao     || 'ACAO').substring(0, 100))
      .input('ip',       sql.VarChar(50),  ip        || null)
      .input('sistema',  sql.VarChar(50),  (sistema  || 'portal').substring(0, 50))
      .input('detalhes', sql.VarChar(500), detalhes  ? detalhes.substring(0, 500) : null)
      .query(`INSERT INTO logs_atividade (usuario, acao, ip, sistema, detalhes)
              VALUES (@usuario, @acao, @ip, @sistema, @detalhes)`);
  } catch (_) {}
}

module.exports = { registrarLog };
