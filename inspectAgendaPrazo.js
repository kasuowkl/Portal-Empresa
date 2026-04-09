const sql = require('mssql');
const cfg = require('./config/db');
(async () => {
  await sql.connect(cfg);
  const r = await sql.query("SELECT TOP 30 id, lista_id, titulo, prazo, status, criado_em FROM agenda_tarefas WHERE lista_id = 2 ORDER BY id DESC");
  console.log(JSON.stringify(r.recordset, null, 2));
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
