/**
 * ARQUIVO: services/sessionStore.js
 * VERSÃO:  1.0.0
 * DATA:    2026-03-17
 * DESCRIÇÃO: Session store customizado usando MSSQL
 *            Persiste sessões no banco — sobrevive ao restart do PM2
 */

const sql = require('mssql');

/**
 * Cria um express-session Store usando o pool MSSQL.
 * @param {object} session - o módulo express-session
 * @param {object} appLocals - app.locals (para acesso lazy ao pool)
 */
function criarMssqlSessionStore(session, appLocals) {
  const Store = session.Store;

  class MssqlStore extends Store {

    get _pool() { return appLocals.pool; }

    // ── Ler sessão ──────────────────────────────────────────
    get(sid, callback) {
      this._pool.request()
        .input('sid', sql.VarChar(255), sid)
        .query('SELECT sess FROM sessions WHERE sid = @sid AND expire > GETDATE()')
        .then(r => {
          const row = r.recordset[0];
          callback(null, row ? JSON.parse(row.sess) : null);
        })
        .catch(e => callback(e));
    }

    // ── Salvar/atualizar sessão ─────────────────────────────
    set(sid, sessData, callback) {
      const ttl    = (sessData.cookie && sessData.cookie.maxAge) ? sessData.cookie.maxAge : 8 * 60 * 60 * 1000;
      const expire = new Date(Date.now() + ttl);

      this._pool.request()
        .input('sid',    sql.VarChar(255), sid)
        .input('sess',   sql.NVarChar(sql.MAX), JSON.stringify(sessData))
        .input('expire', sql.DateTime, expire)
        .query(`
          IF EXISTS (SELECT 1 FROM sessions WHERE sid = @sid)
            UPDATE sessions SET sess = @sess, expire = @expire WHERE sid = @sid
          ELSE
            INSERT INTO sessions (sid, sess, expire) VALUES (@sid, @sess, @expire)
        `)
        .then(() => callback(null))
        .catch(e => callback(e));
    }

    // ── Destruir sessão (logout) ────────────────────────────
    destroy(sid, callback) {
      this._pool.request()
        .input('sid', sql.VarChar(255), sid)
        .query('DELETE FROM sessions WHERE sid = @sid')
        .then(() => callback(null))
        .catch(e => callback(e));
    }

    // ── Renovar TTL ─────────────────────────────────────────
    touch(sid, sessData, callback) {
      const ttl    = (sessData.cookie && sessData.cookie.maxAge) ? sessData.cookie.maxAge : 8 * 60 * 60 * 1000;
      const expire = new Date(Date.now() + ttl);

      this._pool.request()
        .input('sid',    sql.VarChar(255), sid)
        .input('expire', sql.DateTime, expire)
        .query('UPDATE sessions SET expire = @expire WHERE sid = @sid')
        .then(() => callback(null))
        .catch(e => callback(e));
    }
  }

  return new MssqlStore();
}

module.exports = { criarMssqlSessionStore };
