const sql = require('mssql');
const { carregarConfigWhatsApp, enviarWhatsApp } = require('./whatsappService');

function listaConfig(config, chave, padrao = []) {
  if (!Object.prototype.hasOwnProperty.call(config, chave)) return [...padrao];
  return String(config[chave] || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizarLogins(logins) {
  return [...new Set((logins || []).map((l) => String(l || '').trim().toLowerCase()).filter(Boolean))];
}

async function buscarWhatsAppsPorLogins(pool, logins) {
  const unicos = normalizarLogins(logins);
  if (!unicos.length) return {};

  const params = unicos.map((_, i) => `@login${i}`);
  const req = pool.request();
  unicos.forEach((login, i) => req.input(`login${i}`, sql.VarChar, login));

  const r = await req.query(`
    SELECT login, whatsapp
    FROM usuarios_dominio
    WHERE ativo = 1 AND whatsapp IS NOT NULL AND whatsapp <> '' AND login IN (${params.join(',')})
    UNION ALL
    SELECT usuario AS login, whatsapp
    FROM usuarios
    WHERE ativo = 1 AND whatsapp IS NOT NULL AND whatsapp <> '' AND usuario IN (${params.join(',')})
  `);

  const mapa = {};
  for (const row of r.recordset) {
    mapa[String(row.login || '').toLowerCase()] = String(row.whatsapp || '').replace(/\D/g, '');
  }
  return mapa;
}

async function buscarAdmins(pool) {
  try {
    const r = await pool.request().query(`
      SELECT usuario AS login
      FROM usuarios
      WHERE ativo = 1 AND nivel = 'admin'
    `);
    return normalizarLogins(r.recordset.map((x) => x.login));
  } catch {
    return [];
  }
}

async function enviarNotificacaoWhatsAppPorChips(pool, {
  evento,
  sistema,
  mensagem,
  usuario = '',
  ip = '',
  mapaChips = {},
  extraNumeros = [],
}) {
  const config = await carregarConfigWhatsApp(pool);
  const chipsAtivos = listaConfig(config, `wpp.dest.${evento}`, []);
  if (!chipsAtivos.length) return { total: 0, enviados: 0 };

  const numeros = new Set(
    (extraNumeros || [])
      .map((n) => String(n || '').replace(/\D/g, '').slice(0, 20))
      .filter(Boolean)
  );
  const logins = new Set();

  if (chipsAtivos.includes('whatsapp_padrao')) {
    const padrao = String(config.whatsapp_numero_teste || '').replace(/\D/g, '').slice(0, 20);
    if (padrao) numeros.add(padrao);
  }

  if (chipsAtivos.includes('admins')) {
    const admins = await buscarAdmins(pool);
    admins.forEach((login) => logins.add(login));
  }

  for (const chip of chipsAtivos) {
    const lista = Array.isArray(mapaChips[chip]) ? mapaChips[chip] : [];
    normalizarLogins(lista).forEach((login) => logins.add(login));
  }

  const mapaWhats = await buscarWhatsAppsPorLogins(pool, [...logins]);
  Object.values(mapaWhats).forEach((numero) => {
    if (numero) numeros.add(numero);
  });

  let enviados = 0;
  for (const numero of numeros) {
    const result = await enviarWhatsApp(pool, {
      numero,
      mensagem,
      evento,
      usuario,
      ip,
      sistema,
    });
    if (result.ok) enviados++;
  }

  return { total: numeros.size, enviados };
}

module.exports = {
  listaConfig,
  normalizarLogins,
  buscarWhatsAppsPorLogins,
  buscarAdmins,
  enviarNotificacaoWhatsAppPorChips,
};
