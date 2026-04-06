require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const configConexao = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT, 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

const BACKUP_DIR = path.join(__dirname, '..', '_backups', 'db-json');

async function removerAntigos(dir, dias) {
  if (!fs.existsSync(dir)) return;
  const limite = Date.now() - (dias * 24 * 60 * 60 * 1000);
  for (const nome of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, nome);
    const stat = fs.statSync(fullPath);
    if (stat.isFile() && stat.mtimeMs < limite) {
      fs.unlinkSync(fullPath);
    }
  }
}

async function gerarBackupBanco() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const pool = new sql.ConnectionPool(configConexao);
  await pool.connect();

  try {
    const tabelasResult = await pool.request().query(`
      SELECT name
      FROM sys.tables
      WHERE is_ms_shipped = 0
      ORDER BY name
    `);

    const backup = {
      gerado_em: new Date().toISOString(),
      banco: process.env.DB_NAME,
      tabelas: {}
    };

    for (const tabela of tabelasResult.recordset) {
      const nomeTabela = tabela.name;
      const result = await pool.request().query(`SELECT * FROM ${nomeTabela}`);
      backup.tabelas[nomeTabela] = result.recordset;
    }

    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const nomeArquivo = `backup_db_${stamp}.json`;
    const destino = path.join(BACKUP_DIR, nomeArquivo);
    fs.writeFileSync(destino, JSON.stringify(backup, null, 2), 'utf8');

    await removerAntigos(BACKUP_DIR, 30);

    console.log(`Backup do banco gerado: ${destino}`);
  } finally {
    await pool.close();
  }
}

gerarBackupBanco().catch((erro) => {
  console.error('Falha no backup do banco:', erro.message);
  process.exit(1);
});
