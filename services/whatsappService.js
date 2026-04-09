const { registrarLog } = require('./logService');

const DEFAULT_URL = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:3200';
const DEFAULT_KEY = process.env.WHATSAPP_API_KEY || '';
const DEFAULT_DELAY_MS = Math.max(1000, parseInt(process.env.WHATSAPP_DELAY_MS || '4000', 10) || 4000);

let filaEnvioWhatsApp = Promise.resolve();
let ultimaJanelaEnvio = 0;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function carregarConfigWhatsApp(pool) {
  try {
    const r = await pool.request()
      .input('grupo', 'whatsapp')
      .query('SELECT chave, valor FROM configuracoes WHERE grupo = @grupo');

    const config = {};
    for (const row of r.recordset) config[row.chave] = row.valor;
    return config;
  } catch {
    return {};
  }
}

function valorBooleano(config, chave, padrao = false) {
  if (!Object.prototype.hasOwnProperty.call(config, chave)) return padrao;
  return String(config[chave]) === 'true';
}

async function obterCredenciaisWhatsApp(pool) {
  const config = await carregarConfigWhatsApp(pool);
  const delayConfigurado = parseInt(config.whatsapp_delay_ms || DEFAULT_DELAY_MS, 10);
  return {
    config,
    ativo: valorBooleano(config, 'whatsapp_ativo', true),
    url: (config.whatsapp_url || DEFAULT_URL || '').trim(),
    apiKey: (config.whatsapp_api_key || DEFAULT_KEY || '').trim(),
    delayMs: Math.max(1000, Number.isFinite(delayConfigurado) ? delayConfigurado : DEFAULT_DELAY_MS),
  };
}

async function eventoWhatsAppAtivo(pool, evento) {
  const { config, ativo } = await obterCredenciaisWhatsApp(pool);
  if (!ativo) return false;

  const [modulo, nomeEvento] = String(evento || '').split('.');
  const chaveModulo = `wpp.${modulo}.ativo`;
  const chaveEvento = `wpp.${modulo}.${nomeEvento}`;

  const padraoModulo = modulo === 'aprovacoes';
  const padraoEvento = modulo === 'aprovacoes' && ['nova_solicitacao', 'lembrete_pendente'].includes(nomeEvento);

  if (!valorBooleano(config, chaveModulo, padraoModulo)) return false;
  return valorBooleano(config, chaveEvento, padraoEvento);
}

function registrarLogWhatsApp(pool, { usuario, ip, sistema, evento, destino, status, detalhe }) {
  if (!usuario) return;
  const sufixoEvento = evento ? ` (${evento})` : '';
  const sufixoDestino = destino ? ` para ${destino}` : '';
  const sufixoDetalhe = detalhe ? ` - ${detalhe}` : '';

  registrarLog(pool, {
    usuario,
    ip,
    acao: 'NOTIF_WHATSAPP',
    sistema,
    detalhes: `WhatsApp ${status}${sufixoDestino}${sufixoEvento}${sufixoDetalhe}`,
  });
}

async function aguardarJanelaEnvio(pool) {
  const executar = async () => {
    const { delayMs } = await obterCredenciaisWhatsApp(pool);
    const agora = Date.now();
    const esperaMs = Math.max(0, (ultimaJanelaEnvio + delayMs) - agora);

    if (esperaMs > 0) {
      await esperar(esperaMs);
    }

    ultimaJanelaEnvio = Date.now();
    return delayMs;
  };

  const promessa = filaEnvioWhatsApp.then(executar, executar);
  filaEnvioWhatsApp = promessa.catch(() => {});
  return promessa;
}

async function enviarWhatsApp(pool, { numero, mensagem, evento = '', usuario = '', ip = '', sistema = 'whatsapp' }) {
  const destino = String(numero || '').replace(/\D/g, '').slice(0, 20);
  if (!destino) {
    registrarLogWhatsApp(pool, {
      usuario,
      ip,
      sistema,
      evento,
      destino,
      status: 'IGNORADO',
      detalhe: 'Número inválido',
    });
    return { ok: false, erro: 'Número inválido.' };
  }

  const habilitado = evento ? await eventoWhatsAppAtivo(pool, evento) : true;
  if (!habilitado) {
    registrarLogWhatsApp(pool, {
      usuario,
      ip,
      sistema,
      evento,
      destino,
      status: 'IGNORADO',
      detalhe: 'Evento desativado',
    });
    return { ok: false, ignorado: true, erro: 'Evento desativado.' };
  }

  const { url, apiKey, ativo } = await obterCredenciaisWhatsApp(pool);
  if (!ativo) {
    registrarLogWhatsApp(pool, {
      usuario,
      ip,
      sistema,
      evento,
      destino,
      status: 'IGNORADO',
      detalhe: 'Integração WhatsApp desativada',
    });
    return { ok: false, ignorado: true, erro: 'Integração WhatsApp desativada.' };
  }
  if (!url) {
    registrarLogWhatsApp(pool, {
      usuario,
      ip,
      sistema,
      evento,
      destino,
      status: 'ERRO',
      detalhe: 'URL do serviço WhatsApp não configurada',
    });
    return { ok: false, erro: 'URL do serviço WhatsApp não configurada.' };
  }
  if (!apiKey) {
    registrarLogWhatsApp(pool, {
      usuario,
      ip,
      sistema,
      evento,
      destino,
      status: 'ERRO',
      detalhe: 'API Key do serviço WhatsApp não configurada',
    });
    return { ok: false, erro: 'API Key do serviço WhatsApp não configurada.' };
  }

  try {
    const delayMs = await aguardarJanelaEnvio(pool);
    const response = await fetch(new URL('/api/notificar', url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ numero: destino, mensagem: String(mensagem || '') }),
    });

    const resultado = { ok: response.ok, status: response.status };
    if (!response.ok) {
      let detalhe = '';
      try {
        const data = await response.json();
        detalhe = data?.erro || data?.mensagem || '';
      } catch {
        detalhe = await response.text();
      }
      resultado.erro = detalhe || `status ${response.status}`;
    }

    registrarLogWhatsApp(pool, {
      usuario,
      ip,
      sistema,
      evento,
      destino,
      status: resultado.ok ? 'ENVIADO' : 'ERRO',
      detalhe: resultado.ok
        ? `Delay aplicado: ${delayMs}ms`
        : `${resultado.erro || `status ${resultado.status}`} | Delay aplicado: ${delayMs}ms`,
    });

    return resultado;
  } catch (erro) {
    registrarLogWhatsApp(pool, {
      usuario,
      ip,
      sistema,
      evento,
      destino,
      status: 'ERRO',
      detalhe: erro.message,
    });
    return { ok: false, erro: erro.message };
  }
}

module.exports = {
  carregarConfigWhatsApp,
  obterCredenciaisWhatsApp,
  eventoWhatsAppAtivo,
  enviarWhatsApp,
};
