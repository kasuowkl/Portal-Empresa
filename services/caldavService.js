/**
 * ARQUIVO: services/caldavService.js
 * VERSÃO: 2.0.0
 * DATA: 2026-03-23
 * DESCRIÇÃO: Integração REAL com Google Calendar via CalDAV
 * Usa HTTPS nativo do Node.js (sem dependência externa)
 * Protocolo CalDAV sobre HTTPS com Basic Auth + Senha de App
 */

const sql = require('mssql');
const crypto = require('crypto');
const https = require('https');

// ============================================================
// CONSTANTES
// ============================================================
// Tentar múltiplos endpoints Google CalDAV (fallback)
const GOOGLE_ENDPOINTS = [
  { host: 'apidata.googleusercontent.com', path: (email) => `/caldav/v2/${email}/events/` },
  { host: 'calendar.google.com', path: (email) => `/calendar/dav/${email}/events/` },
  { host: 'www.google.com', path: (email) => `/calendar/dav/${email}/events/` }
];
let ENDPOINT_ATIVO = GOOGLE_ENDPOINTS[0];

// ============================================================
// CRIPTOGRAFIA — Armazenar senha de app criptografada no BD
// ============================================================
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'defaultkey32byteslongpassphrase!';
const ENCRYPTION_ALGORITHM = 'aes-256-cbc';

function criptografar(texto) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32)), iv);
  let encrypted = cipher.update(texto, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function descriptografar(texto) {
  const [ivHex, encrypted] = texto.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32)), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================================
// HELPER: Requisição HTTPS para CalDAV
// ============================================================
function caldavRequest(email, senha, method, path, body, extraHeaders = {}, host = null) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${email}:${senha}`).toString('base64');

    const options = {
      hostname: host || ENDPOINT_ATIVO.host,
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        ...extraHeaders
      }
    };

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Timeout na requisição CalDAV'));
    });

    if (body) req.write(body);
    req.end();
  });
}

// ============================================================
// HELPER: Formatar data para iCalendar (UTC)
// ============================================================
function dataParaICal(data) {
  const d = new Date(data);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// ============================================================
// HELPER: Gerar UID único para evento
// ============================================================
function gerarUID() {
  return `${crypto.randomUUID()}@portalwkl`;
}

// ============================================================
// HELPER: Gerar ICS (iCalendar) de um evento
// ============================================================
function gerarICS(evento, uid) {
  const inicio = dataParaICal(evento.inicio);
  const fim = dataParaICal(evento.fim);
  const agora = dataParaICal(new Date());

  let ics = 'BEGIN:VCALENDAR\r\n';
  ics += 'VERSION:2.0\r\n';
  ics += 'PRODID:-//Portal WKL//Calendarios//PT-BR\r\n';
  ics += 'BEGIN:VEVENT\r\n';
  ics += `UID:${uid}\r\n`;
  ics += `DTSTAMP:${agora}\r\n`;
  ics += `DTSTART:${inicio}\r\n`;
  ics += `DTEND:${fim}\r\n`;
  ics += `SUMMARY:${(evento.titulo || 'Sem título').replace(/\n/g, '\\n')}\r\n`;
  if (evento.descricao) {
    ics += `DESCRIPTION:${evento.descricao.replace(/\n/g, '\\n')}\r\n`;
  }
  ics += 'END:VEVENT\r\n';
  ics += 'END:VCALENDAR\r\n';

  return ics;
}

// ============================================================
// HELPER: Parsear ICS para objeto de evento
// ============================================================
function parsearICS(icsText) {
  const eventos = [];
  const blocos = icsText.split('BEGIN:VEVENT');

  for (let i = 1; i < blocos.length; i++) {
    const bloco = blocos[i].split('END:VEVENT')[0];
    const evento = {};

    const linhas = bloco.replace(/\r\n /g, '').split(/\r?\n/);
    for (const linha of linhas) {
      // Extrair campo base (antes de ; ou :), parâmetros (entre ; e último :), e valor
      // Ex: DTSTART;TZID=America/Manaus:20250710T110000
      //     campo=DTSTART, params=TZID=America/Manaus, valor=20250710T110000
      const colonIdx = linha.indexOf(':');
      if (colonIdx < 0) continue;

      const prefixo = linha.substring(0, colonIdx); // DTSTART;TZID=America/Manaus
      const campo = prefixo.split(';')[0];           // DTSTART
      const params = prefixo.includes(';') ? prefixo.substring(prefixo.indexOf(';') + 1) : '';
      const valor = linha.substring(colonIdx + 1);    // 20250710T110000

      switch (campo) {
        case 'UID': evento.uid = valor; break;
        case 'SUMMARY': evento.titulo = valor.replace(/\\n/g, '\n'); break;
        case 'DESCRIPTION': evento.descricao = valor.replace(/\\n/g, '\n'); break;
        case 'DTSTART': evento.inicio = parsearDataICal(valor, params); break;
        case 'DTEND': evento.fim = parsearDataICal(valor, params); break;
      }
    }

    if (evento.uid && evento.inicio) {
      eventos.push(evento);
    }
  }

  return eventos;
}

// ============================================================
// HELPER: Parsear data iCalendar para Date
// ============================================================
function parsearDataICal(valor, params) {
  // Formato: 20260323T140000Z ou 20260323 ou 20250710T110000 (com TZID)
  const limpo = valor.replace(/[^0-9TZ]/g, '');
  if (limpo.length === 8) {
    // Data apenas (dia inteiro)
    return new Date(`${limpo.slice(0,4)}-${limpo.slice(4,6)}-${limpo.slice(6,8)}T00:00:00`);
  }
  // Data + hora
  const ano = limpo.slice(0, 4);
  const mes = limpo.slice(4, 6);
  const dia = limpo.slice(6, 8);
  const hora = limpo.slice(9, 11) || '00';
  const min = limpo.slice(11, 13) || '00';
  const seg = limpo.slice(13, 15) || '00';
  const isUTC = valor.endsWith('Z');

  if (isUTC) {
    return new Date(`${ano}-${mes}-${dia}T${hora}:${min}:${seg}Z`);
  }

  // Se tem TZID, interpretar como horário local daquele timezone
  // Para simplificar, tratamos como horário local do servidor
  return new Date(`${ano}-${mes}-${dia}T${hora}:${min}:${seg}`);
}

// ============================================================
// HELPER: Extrair ETags e hrefs da resposta XML do CalDAV
// ============================================================
function parsearRespostaCalDAV(xmlBody) {
  const resultados = [];
  // Split por qualquer variação de <D:response> ou <d:response>
  const respostas = xmlBody.split(/<[dD]:response[\s>]/i);

  for (let i = 1; i < respostas.length; i++) {
    const resp = respostas[i];
    // href — qualquer namespace prefix
    const hrefMatch = resp.match(/<[dD]:href>([^<]+)<\/[dD]:href>/i);
    // etag
    const etagMatch = resp.match(/<[dD]:getetag>([^<]+)<\/[dD]:getetag>/i);
    // calendar-data — Google usa "caldav:", Apple usa "cal:" ou "C:"
    const calDataMatch = resp.match(/<(?:caldav|cal|c|C):calendar-data[^>]*>([\s\S]*?)<\/(?:caldav|cal|c|C):calendar-data>/i);

    if (hrefMatch) {
      resultados.push({
        href: hrefMatch[1],
        etag: etagMatch ? etagMatch[1].replace(/"/g, '') : null,
        icsData: calDataMatch ? calDataMatch[1] : null
      });
    }
  }

  return resultados;
}

// ============================================================
// SALVAR CONFIGURAÇÃO CalDAV
// ============================================================
async function salvarConfiguracaoCaldav(pool, usuario, emailGoogle, senhaApp) {
  const senhaAppCriptografada = criptografar(senhaApp);
  const caldavUrl = `https://${ENDPOINT_ATIVO.host}${ENDPOINT_ATIVO.path(emailGoogle)}`;

  try {
    await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .input('email_google', sql.VarChar, emailGoogle)
      .input('senha_app', sql.VarChar, senhaAppCriptografada)
      .input('caldav_url', sql.VarChar, caldavUrl)
      .query(`
        IF EXISTS (SELECT 1 FROM cal_caldav_config WHERE usuario = @usuario)
          UPDATE cal_caldav_config
          SET email_google = @email_google, senha_app = @senha_app, caldav_url = @caldav_url, atualizado_em = GETDATE()
          WHERE usuario = @usuario
        ELSE
          INSERT INTO cal_caldav_config (usuario, email_google, senha_app, caldav_url)
          VALUES (@usuario, @email_google, @senha_app, @caldav_url)
      `);
    return { sucesso: true, mensagem: 'Configuração salva com sucesso' };
  } catch (erro) {
    return { sucesso: false, erro: erro.message };
  }
}

// ============================================================
// OBTER CONFIGURAÇÃO CalDAV
// ============================================================
async function obterConfiguracaoCaldav(pool, usuario) {
  try {
    const resultado = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .query('SELECT * FROM cal_caldav_config WHERE usuario = @usuario');

    if (resultado.recordset.length === 0) return null;

    const config = resultado.recordset[0];
    config.senha_app = descriptografar(config.senha_app);
    return config;
  } catch (erro) {
    console.error(`[CalDAV] Erro ao obter config para ${usuario}:`, erro.message);
    return null;
  }
}

// ============================================================
// VALIDAR CREDENCIAIS CalDAV (real — tenta PROPFIND no Google)
// ============================================================
async function validarCredenciaisCaldav(emailGoogle, senhaApp) {
  // Tenta cada endpoint até encontrar um que funcione
  for (const endpoint of GOOGLE_ENDPOINTS) {
    try {
      const path = endpoint.path(emailGoogle);
      console.log(`[CalDAV] Tentando ${endpoint.host}${path}...`);

      const res = await caldavRequest(emailGoogle, senhaApp, 'PROPFIND', path, null, { 'Depth': '0' }, endpoint.host);
      console.log(`[CalDAV] Validação em ${endpoint.host}: status ${res.status}`);

      if (res.status === 207 || res.status === 200) {
        // Encontrou endpoint que funciona — salvar para uso futuro
        ENDPOINT_ATIVO = endpoint;
        _endpointValidado = true;
        console.log(`[CalDAV] Endpoint ativo definido: ${endpoint.host}`);
        return true;
      }

      // 301/302 = redirect (tentar próximo)
      if (res.status === 301 || res.status === 302) {
        console.log(`[CalDAV] Redirect de ${endpoint.host}, tentando próximo...`);
        continue;
      }

      // 401 = credenciais inválidas neste endpoint, tentar próximo
      if (res.status === 401) {
        continue;
      }
    } catch (erro) {
      console.error(`[CalDAV] Erro em ${endpoint.host}: ${erro.message}`);
    }
  }

  console.error(`[CalDAV] Todos os endpoints falharam para ${emailGoogle}`);
  return false;
}

// ============================================================
// CRIAR CALENDÁRIO NO GOOGLE (MKCALENDAR)
// ============================================================
async function criarCalendarioGoogle(usuario, pool, nomeAgenda, corAgenda) {
  const config = await obterConfiguracaoCaldav(pool, usuario);
  if (!config) {
    return { sucesso: false, erro: 'Configuração CalDAV não encontrada' };
  }

  try {
    // Gerar slug seguro para URL
    const slug = nomeAgenda
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'agenda';

    // Usar o host do endpoint ativo para determinar o path base correto
    const basePath = ENDPOINT_ATIVO.host === 'apidata.googleusercontent.com'
      ? `/caldav/v2/${config.email_google}/calendars/${slug}/`
      : `/calendar/dav/${config.email_google}/calendars/${slug}/`;
    const calPath = basePath;

    // Cor no formato Apple CalDAV (#RRGGBBFF)
    const corHex = (corAgenda || '#3b82f6').replace('#', '');
    const corCalDAV = `#${corHex}FF`;

    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
  <d:set>
    <d:prop>
      <d:displayname>${nomeAgenda}</d:displayname>
      <a:calendar-color>${corCalDAV}</a:calendar-color>
    </d:prop>
  </d:set>
</c:mkcalendar>`;

    const res = await caldavRequest(
      config.email_google, config.senha_app,
      'MKCALENDAR', calPath, xmlBody,
      { 'Content-Type': 'application/xml; charset=utf-8' }
    );

    console.log(`[CalDAV] MKCALENDAR ${nomeAgenda}: status ${res.status}`);

    if (res.status === 201 || res.status === 207) {
      console.log(`[CalDAV] Calendário "${nomeAgenda}" criado no Google: ${calPath}`);
      return { sucesso: true, googleCalPath: calPath };
    } else if (res.status === 405) {
      // MKCALENDAR não suportado — usar calendário padrão
      console.log(`[CalDAV] MKCALENDAR não suportado, usando calendário padrão`);
      return { sucesso: true, googleCalPath: ENDPOINT_ATIVO.path(config.email_google) };
    } else {
      console.error(`[CalDAV] Falha MKCALENDAR: status ${res.status}, body: ${res.body.substring(0, 200)}`);
      // Fallback: usar calendário padrão
      return { sucesso: true, googleCalPath: ENDPOINT_ATIVO.path(config.email_google) };
    }
  } catch (erro) {
    console.error(`[CalDAV] Erro ao criar calendário no Google: ${erro.message}`);
    return { sucesso: false, erro: erro.message };
  }
}

// ============================================================
// DESCOBRIR CALENDÁRIOS DO GOOGLE (PROPFIND no calendar-home-set)
// ============================================================
function parsearCalendarios(xmlBody) {
  const calendarios = [];
  // Split por qualquer variação de <D:response>
  const respostas = xmlBody.split(/<[dD]:response[\s>]/i);

  for (let i = 1; i < respostas.length; i++) {
    const resp = respostas[i];

    // Extrair href
    const hrefMatch = resp.match(/<[dD]:href>([^<]+)<\/[dD]:href>/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1];

    // Verificar se é um calendário — Google usa "caldav:calendar", Apple usa "cal:calendar"
    const isCalendar = /<(?:caldav|cal|c|C):calendar[\s\/]/i.test(resp);
    if (!isCalendar) continue;

    // Extrair displayname
    const nomeMatch = resp.match(/<[dD]:displayname>([^<]*)<\/[dD]:displayname>/i);
    const nome = nomeMatch ? nomeMatch[1] : 'Sem nome';

    // Extrair cor — Google usa "ical:calendar-color", Apple usa "a:calendar-color"
    const corMatch = resp.match(/<(?:ical|a):calendar-color[^>]*>([^<]*)<\/(?:ical|a):calendar-color>/i);
    let cor = '#4285f4';
    if (corMatch && corMatch[1]) {
      cor = corMatch[1].trim();
      // Converter #RRGGBBFF para #RRGGBB
      if (cor.length === 9) cor = cor.slice(0, 7);
    }

    calendarios.push({ href, nome, cor });
  }

  return calendarios;
}

async function listarCalendariosGoogle(email, senha) {
  // PROPFIND no calendar-home-set para descobrir todos os calendários
  const homePath = ENDPOINT_ATIVO.host === 'apidata.googleusercontent.com'
    ? `/caldav/v2/${email}/`
    : `/calendar/dav/${email}/`;

  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <a:calendar-color/>
  </d:prop>
</d:propfind>`;

  try {
    const res = await caldavRequest(email, senha, 'PROPFIND', homePath, xmlBody, { 'Depth': '1' });
    console.log(`[CalDAV] PROPFIND calendários: status ${res.status}`);
    console.log(`[CalDAV] PROPFIND resposta XML (primeiros 2000 chars):\n${res.body.substring(0, 2000)}`);

    if (res.status !== 207) {
      console.error(`[CalDAV] PROPFIND calendários falhou: ${res.status}`);
      return [];
    }

    const calendarios = parsearCalendarios(res.body);
    console.log(`[CalDAV] ${calendarios.length} calendários encontrados: ${calendarios.map(c => c.nome).join(', ')}`);
    return calendarios;
  } catch (erro) {
    console.error(`[CalDAV] Erro ao listar calendários: ${erro.message}`);
    return [];
  }
}

// ============================================================
// LISTAR EVENTOS DE UM CALENDÁRIO ESPECÍFICO (CalDAV REPORT)
// ============================================================
async function listarEventosDeCalendario(email, senha, calPath, inicio, fim) {
  const dtInicio = dataParaICal(inicio);
  const dtFim = dataParaICal(fim);

  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${dtInicio}" end="${dtFim}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  const res = await caldavRequest(email, senha, 'REPORT', calPath, xmlBody, { 'Depth': '1' });
  console.log(`[CalDAV] REPORT em ${calPath}: status ${res.status}, body length: ${res.body.length}`);
  console.log(`[CalDAV] REPORT resposta (primeiros 1000 chars):\n${res.body.substring(0, 1000)}`);

  if (res.status !== 207) {
    console.log(`[CalDAV] REPORT em ${calPath}: status ${res.status} (ignorando)`);
    return [];
  }

  const respostas = parsearRespostaCalDAV(res.body);
  const eventos = [];

  for (const r of respostas) {
    if (r.icsData) {
      const parsed = parsearICS(r.icsData);
      for (const ev of parsed) {
        ev.etag = r.etag;
        ev.href = r.href;
        eventos.push(ev);
      }
    }
  }

  return eventos;
}

// ============================================================
// LISTAR EVENTOS DO GOOGLE CALENDAR (todos os calendários)
// ============================================================
async function listarEventosGoogle(usuario, pool, inicio, fim) {
  const config = await obterConfiguracaoCaldav(pool, usuario);
  if (!config) {
    return { sucesso: false, erro: 'Configuração CalDAV não encontrada' };
  }

  await garantirEndpoint(config.email_google, config.senha_app);

  try {
    // Buscar eventos do calendário padrão (compatibilidade)
    const eventos = await listarEventosDeCalendario(
      config.email_google, config.senha_app,
      ENDPOINT_ATIVO.path(config.email_google),
      inicio, fim
    );

    console.log(`[CalDAV] ${eventos.length} eventos encontrados no Google para ${usuario}`);
    return { sucesso: true, eventos };
  } catch (erro) {
    console.error(`[CalDAV] Erro ao listar eventos Google: ${erro.message}`);
    return { sucesso: false, erro: erro.message };
  }
}

// ============================================================
// HELPER: Garantir que ENDPOINT_ATIVO foi validado (revalida se servidor reiniciou)
// ============================================================
let _endpointValidado = false;
async function garantirEndpoint(emailGoogle, senhaApp) {
  if (_endpointValidado) return;
  const ok = await validarCredenciaisCaldav(emailGoogle, senhaApp);
  if (ok) _endpointValidado = true;
}

// ============================================================
// CRIAR EVENTO NO GOOGLE CALENDAR (real via CalDAV PUT)
// ============================================================
async function criarEventoGoogle(usuario, pool, evento, googleCalPath) {
  const config = await obterConfiguracaoCaldav(pool, usuario);
  if (!config) {
    return { sucesso: false, erro: 'Configuração CalDAV não encontrada' };
  }

  // Garantir que o endpoint correto está ativo
  await garantirEndpoint(config.email_google, config.senha_app);

  try {
    const uid = gerarUID();
    const ics = gerarICS(evento, uid);
    // SEMPRE usar o path do endpoint ativo (ignora googleCalPath salvo no banco
    // pois pode estar no formato errado para o host atual)
    const basePath = ENDPOINT_ATIVO.path(config.email_google);
    const eventPath = `${basePath}${uid}.ics`;
    console.log(`[CalDAV] Criando evento em ${ENDPOINT_ATIVO.host}${eventPath}`);

    const res = await caldavRequest(
      config.email_google, config.senha_app,
      'PUT', eventPath, ics,
      { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }
    );

    if (res.status === 201 || res.status === 204) {
      const etag = res.headers['etag'] || '';
      console.log(`[CalDAV] Evento criado no Google: ${uid}`);
      return { sucesso: true, uid_caldav: uid, etag_caldav: etag };
    } else {
      console.error(`[CalDAV] Falha ao criar evento: status ${res.status}`);
      return { sucesso: false, erro: `Google retornou status ${res.status}` };
    }
  } catch (erro) {
    console.error(`[CalDAV] Erro ao criar evento no Google: ${erro.message}`);
    return { sucesso: false, erro: erro.message };
  }
}

// ============================================================
// EDITAR EVENTO NO GOOGLE CALENDAR (real via CalDAV PUT)
// ============================================================
async function editarEventoGoogle(usuario, pool, evento) {
  const config = await obterConfiguracaoCaldav(pool, usuario);
  if (!config) {
    return { sucesso: false, erro: 'Configuração CalDAV não encontrada' };
  }

  await garantirEndpoint(config.email_google, config.senha_app);

  try {
    // Buscar UID do evento no banco
    const result = await pool.request()
      .input('id', sql.Int, evento.id)
      .query('SELECT uid_caldav, etag_caldav FROM cal_eventos WHERE id = @id');

    const row = result.recordset[0];
    if (!row || !row.uid_caldav) {
      return { sucesso: false, erro: 'Evento não tem UID CalDAV' };
    }

    const ics = gerarICS(evento, row.uid_caldav);
    const eventPath = `${ENDPOINT_ATIVO.path(config.email_google)}${row.uid_caldav}.ics`;

    const res = await caldavRequest(
      config.email_google, config.senha_app,
      'PUT', eventPath, ics,
      { 'Content-Type': 'text/calendar; charset=utf-8' }
    );

    if (res.status === 204 || res.status === 200 || res.status === 201) {
      const etag = res.headers['etag'] || '';
      // Atualizar ETag no banco
      await pool.request()
        .input('id', sql.Int, evento.id)
        .input('etag', sql.VarChar, etag)
        .query('UPDATE cal_eventos SET etag_caldav = @etag WHERE id = @id');
      console.log(`[CalDAV] Evento editado no Google: ${row.uid_caldav}`);
      return { sucesso: true };
    } else {
      console.error(`[CalDAV] Falha ao editar evento: status ${res.status}`);
      return { sucesso: false, erro: `Google retornou status ${res.status}` };
    }
  } catch (erro) {
    console.error(`[CalDAV] Erro ao editar evento no Google: ${erro.message}`);
    return { sucesso: false, erro: erro.message };
  }
}

// ============================================================
// DELETAR EVENTO NO GOOGLE CALENDAR (real via CalDAV DELETE)
// ============================================================
async function deletarEventoGoogle(usuario, pool, uid_caldav) {
  const config = await obterConfiguracaoCaldav(pool, usuario);
  if (!config) {
    return { sucesso: false, erro: 'Configuração CalDAV não encontrada' };
  }

  await garantirEndpoint(config.email_google, config.senha_app);

  try {
    const eventPath = `${ENDPOINT_ATIVO.path(config.email_google)}${uid_caldav}.ics`;

    const res = await caldavRequest(
      config.email_google, config.senha_app,
      'DELETE', eventPath
    );

    if (res.status === 204 || res.status === 200 || res.status === 404) {
      console.log(`[CalDAV] Evento deletado do Google: ${uid_caldav}`);
      return { sucesso: true };
    } else {
      console.error(`[CalDAV] Falha ao deletar evento: status ${res.status}`);
      return { sucesso: false, erro: `Google retornou status ${res.status}` };
    }
  } catch (erro) {
    console.error(`[CalDAV] Erro ao deletar evento no Google: ${erro.message}`);
    return { sucesso: false, erro: erro.message };
  }
}

// ============================================================
// SINCRONIZAR DO GOOGLE PARA PORTAL (importar TODOS os calendários e eventos)
// ============================================================
async function sincronizarDoGoogle(usuario, pool, agendaIdsFiltro) {
  const config = await obterConfiguracaoCaldav(pool, usuario);
  if (!config) {
    return { sucesso: false, erro: 'Configuração CalDAV não encontrada' };
  }

  await garantirEndpoint(config.email_google, config.senha_app);

  try {
    // 1. Descobrir todos os calendários do Google
    const calendarios = await listarCalendariosGoogle(config.email_google, config.senha_app);

    if (calendarios.length === 0) {
      // Fallback: tentar só o calendário padrão
      console.log(`[CalDAV] Nenhum calendário descoberto, usando padrão`);
      calendarios.push({
        href: ENDPOINT_ATIVO.path(config.email_google),
        nome: 'Google Calendar',
        cor: '#4285f4'
      });
    }

    const inicio = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const fim = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

    let totalCriados = 0;
    let totalAtualizados = 0;
    let totalExcluidos = 0;
    let totalEventos = 0;
    const todosUidsGoogle = new Set(); // Rastrear todos os UIDs vindos do Google
    const agendasSincronizadas = []; // IDs das agendas sincronizadas

    // 2. Para cada calendário do Google, buscar eventos e criar agenda no Portal
    for (const cal of calendarios) {
      console.log(`[CalDAV] Sincronizando calendário "${cal.nome}" (${cal.href})`);

      // Buscar eventos deste calendário
      const eventos = await listarEventosDeCalendario(
        config.email_google, config.senha_app,
        cal.href, inicio, fim
      );

      console.log(`[CalDAV] ${eventos.length} eventos em "${cal.nome}"`);

      // Buscar ou criar agenda no Portal com o MESMO NOME do Google
      const nomeAgenda = `${cal.nome} (Google)`;
      let agendaResult = await pool.request()
        .input('dono', sql.VarChar, usuario)
        .input('nome', sql.VarChar, nomeAgenda)
        .query(`SELECT id FROM cal_agendas WHERE dono = @dono AND nome = @nome`);

      let agendaId;
      if (agendaResult.recordset.length === 0) {
        const insert = await pool.request()
          .input('nome', sql.VarChar, nomeAgenda)
          .input('cor', sql.VarChar, cal.cor)
          .input('descricao', sql.VarChar, `Sincronizado do Google Calendar: ${cal.nome}`)
          .input('dono', sql.VarChar, usuario)
          .input('google_cal_path', sql.VarChar, cal.href)
          .query(`
            INSERT INTO cal_agendas (nome, cor, descricao, dono, google_cal_path)
            OUTPUT INSERTED.id
            VALUES (@nome, @cor, @descricao, @dono, @google_cal_path)
          `);
        agendaId = insert.recordset[0].id;
        console.log(`[CalDAV] Agenda "${nomeAgenda}" criada no Portal (ID: ${agendaId})`);
      } else {
        agendaId = agendaResult.recordset[0].id;
      }

      // Se foram passados IDs específicos, pular agendas não selecionadas
      if (agendaIdsFiltro && agendaIdsFiltro.length > 0 && !agendaIdsFiltro.includes(agendaId)) {
        console.log(`[CalDAV] Agenda "${nomeAgenda}" (ID: ${agendaId}) não selecionada, pulando`);
        continue;
      }

      agendasSincronizadas.push(agendaId);

      // 3. Importar eventos
      for (const ev of eventos) {
        if (!ev.uid) continue;
        todosUidsGoogle.add(ev.uid);

        const existente = await pool.request()
          .input('uid', sql.VarChar, ev.uid)
          .query('SELECT id, etag_caldav FROM cal_eventos WHERE uid_caldav = @uid');

        if (existente.recordset.length === 0) {
          await pool.request()
            .input('agenda_id', sql.Int, agendaId)
            .input('titulo', sql.VarChar, ev.titulo || 'Sem título')
            .input('descricao', sql.VarChar, ev.descricao || '')
            .input('inicio', sql.DateTime, new Date(ev.inicio))
            .input('fim', sql.DateTime, new Date(ev.fim || ev.inicio))
            .input('uid_caldav', sql.VarChar, ev.uid)
            .input('etag_caldav', sql.VarChar, ev.etag || '')
            .input('criado_por', sql.VarChar, usuario)
            .query(`
              INSERT INTO cal_eventos (agenda_id, titulo, descricao, inicio, fim, uid_caldav, etag_caldav, criado_por)
              VALUES (@agenda_id, @titulo, @descricao, @inicio, @fim, @uid_caldav, @etag_caldav, @criado_por)
            `);
          totalCriados++;
        } else {
          const atual = existente.recordset[0];
          if (ev.etag && ev.etag !== atual.etag_caldav) {
            await pool.request()
              .input('id', sql.Int, atual.id)
              .input('titulo', sql.VarChar, ev.titulo || 'Sem título')
              .input('descricao', sql.VarChar, ev.descricao || '')
              .input('inicio', sql.DateTime, new Date(ev.inicio))
              .input('fim', sql.DateTime, new Date(ev.fim || ev.inicio))
              .input('etag_caldav', sql.VarChar, ev.etag)
              .query(`
                UPDATE cal_eventos
                SET titulo = @titulo, descricao = @descricao, inicio = @inicio, fim = @fim,
                    etag_caldav = @etag_caldav, atualizado_em = GETDATE()
                WHERE id = @id
              `);
            totalAtualizados++;
          }
        }
      }

      totalEventos += eventos.length;
    }

    // 4. Remover eventos excluídos no Google — apenas das agendas sincronizadas
    const idsParaVerificar = (agendaIdsFiltro && agendaIdsFiltro.length > 0)
      ? agendaIdsFiltro
      : agendasSincronizadas;

    if (idsParaVerificar.length > 0) {
      const eventosPortal = await pool.request()
        .query(`SELECT id, uid_caldav FROM cal_eventos WHERE uid_caldav IS NOT NULL AND uid_caldav <> '' AND agenda_id IN (${idsParaVerificar.join(',')})`);

      for (const ev of eventosPortal.recordset) {
        if (!todosUidsGoogle.has(ev.uid_caldav)) {
          await pool.request()
            .input('id', sql.Int, ev.id)
            .query('DELETE FROM cal_eventos WHERE id = @id');
          totalExcluidos++;
          console.log(`[CalDAV] Evento removido do Portal (excluído no Google): ${ev.uid_caldav}`);
        }
      }
    }

    // 5. Atualizar timestamp de último sync
    await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .query('UPDATE cal_caldav_config SET ultimo_sync = GETDATE() WHERE usuario = @usuario');

    const msg = `Sincronização concluída: ${totalCriados} criados, ${totalAtualizados} atualizados, ${totalExcluidos} excluídos de ${totalEventos} eventos`;
    console.log(`[CalDAV] ${msg} para ${usuario}`);
    return { sucesso: true, mensagem: msg, criados: totalCriados, atualizados: totalAtualizados, excluidos: totalExcluidos, total: totalEventos };
  } catch (erro) {
    console.error(`[CalDAV] Erro ao sincronizar ${usuario}: ${erro.message}`);
    return { sucesso: false, erro: erro.message };
  }
}

// ============================================================
// HELPER: Fetch HTTPS simples (GET)
// ============================================================
function fetchIcal(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Muitos redirects'));

    // Usar https.get com URL string direta (preserva encoding %40 etc)
    console.log(`[iCal] GET ${url}`);
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 PortalWKL/1.0' } }, (res) => {
      console.log(`[iCal] Resposta: status ${res.statusCode}, headers: ${JSON.stringify(res.headers).substring(0, 300)}`);

      // Seguir redirects
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
        console.log(`[iCal] Redirect para: ${res.headers.location}`);
        res.resume(); // Consumir resposta
        return fetchIcal(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }

      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.error(`[iCal] Resposta body (primeiros 500 chars): ${data.substring(0, 500)}`);
        }
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Timeout ao buscar iCal'));
    });
  });
}

// ============================================================
// SINCRONIZAR VIA URL iCAL (Google Calendar público/secreto)
// ============================================================
async function sincronizarViaIcal(usuario, pool, icalUrl, nomeAgenda, corAgenda) {
  try {
    console.log(`[iCal] Buscando eventos de: ${icalUrl}`);

    // 1. Fetch do arquivo .ics
    const res = await fetchIcal(icalUrl);

    if (res.status !== 200) {
      console.error(`[iCal] Fetch falhou: status ${res.status}`);
      return { sucesso: false, erro: `Google retornou status ${res.status}. Verifique se a URL está correta e o calendário é público.` };
    }

    // 2. Parsear eventos do ICS
    const eventos = parsearICS(res.body);
    console.log(`[iCal] ${eventos.length} eventos encontrados no arquivo ICS`);

    if (eventos.length === 0 && res.body.length < 100) {
      console.log(`[iCal] Resposta vazia ou muito curta: ${res.body.substring(0, 200)}`);
    }

    // 3. Buscar ou criar agenda no Portal
    const nome = nomeAgenda || 'Google Calendar';
    let agendaResult = await pool.request()
      .input('dono', sql.VarChar, usuario)
      .input('ical_url', sql.VarChar, icalUrl)
      .query(`SELECT id FROM cal_agendas WHERE dono = @dono AND ical_url = @ical_url`);

    let agendaId;
    if (agendaResult.recordset.length === 0) {
      // Verificar se existe agenda com mesmo nome
      agendaResult = await pool.request()
        .input('dono', sql.VarChar, usuario)
        .input('nome', sql.VarChar, nome)
        .query(`SELECT id FROM cal_agendas WHERE dono = @dono AND nome = @nome`);

      if (agendaResult.recordset.length > 0) {
        agendaId = agendaResult.recordset[0].id;
        // Atualizar ical_url
        await pool.request()
          .input('id', sql.Int, agendaId)
          .input('ical_url', sql.VarChar, icalUrl)
          .query('UPDATE cal_agendas SET ical_url = @ical_url WHERE id = @id');
      } else {
        const insert = await pool.request()
          .input('nome', sql.VarChar, nome)
          .input('cor', sql.VarChar, corAgenda || '#4285f4')
          .input('descricao', sql.VarChar, 'Sincronizado via iCal URL')
          .input('dono', sql.VarChar, usuario)
          .input('ical_url', sql.VarChar, icalUrl)
          .query(`
            INSERT INTO cal_agendas (nome, cor, descricao, dono, ical_url)
            OUTPUT INSERTED.id
            VALUES (@nome, @cor, @descricao, @dono, @ical_url)
          `);
        agendaId = insert.recordset[0].id;
        console.log(`[iCal] Agenda "${nome}" criada (ID: ${agendaId})`);
      }
    } else {
      agendaId = agendaResult.recordset[0].id;
    }

    // 4. Importar eventos
    let criados = 0;
    let atualizados = 0;
    let excluidos = 0;
    const uidsGoogle = new Set();

    for (const ev of eventos) {
      if (!ev.uid) continue;
      uidsGoogle.add(ev.uid);

      const existente = await pool.request()
        .input('uid', sql.VarChar, ev.uid)
        .query('SELECT id, etag_caldav FROM cal_eventos WHERE uid_caldav = @uid');

      if (existente.recordset.length === 0) {
        await pool.request()
          .input('agenda_id', sql.Int, agendaId)
          .input('titulo', sql.VarChar, ev.titulo || 'Sem título')
          .input('descricao', sql.VarChar, ev.descricao || '')
          .input('inicio', sql.DateTime, new Date(ev.inicio))
          .input('fim', sql.DateTime, new Date(ev.fim || ev.inicio))
          .input('uid_caldav', sql.VarChar, ev.uid)
          .input('etag_caldav', sql.VarChar, ev.etag || '')
          .input('criado_por', sql.VarChar, usuario)
          .query(`
            INSERT INTO cal_eventos (agenda_id, titulo, descricao, inicio, fim, uid_caldav, etag_caldav, criado_por)
            VALUES (@agenda_id, @titulo, @descricao, @inicio, @fim, @uid_caldav, @etag_caldav, @criado_por)
          `);
        criados++;
      } else {
        const atual = existente.recordset[0];
        if (ev.etag && ev.etag !== atual.etag_caldav) {
          await pool.request()
            .input('id', sql.Int, atual.id)
            .input('titulo', sql.VarChar, ev.titulo || 'Sem título')
            .input('descricao', sql.VarChar, ev.descricao || '')
            .input('inicio', sql.DateTime, new Date(ev.inicio))
            .input('fim', sql.DateTime, new Date(ev.fim || ev.inicio))
            .input('etag_caldav', sql.VarChar, ev.etag)
            .query(`
              UPDATE cal_eventos
              SET titulo = @titulo, descricao = @descricao, inicio = @inicio, fim = @fim,
                  etag_caldav = @etag_caldav, atualizado_em = GETDATE()
              WHERE id = @id
            `);
          atualizados++;
        }
      }
    }

    // 5. Remover eventos excluídos no Google (existem no Portal mas não no iCal)
    const eventosPortal = await pool.request()
      .input('agenda_id', sql.Int, agendaId)
      .query('SELECT id, uid_caldav FROM cal_eventos WHERE agenda_id = @agenda_id AND uid_caldav IS NOT NULL');

    for (const ev of eventosPortal.recordset) {
      if (!uidsGoogle.has(ev.uid_caldav)) {
        await pool.request()
          .input('id', sql.Int, ev.id)
          .query('DELETE FROM cal_eventos WHERE id = @id');
        excluidos++;
        console.log(`[iCal] Evento removido (excluído no Google): ${ev.uid_caldav}`);
      }
    }

    const msg = `Sincronização iCal concluída: ${criados} criados, ${atualizados} atualizados, ${excluidos} excluídos de ${eventos.length} eventos`;
    console.log(`[iCal] ${msg}`);
    return { sucesso: true, mensagem: msg, criados, atualizados, excluidos, total: eventos.length, agendaId };
  } catch (erro) {
    console.error(`[iCal] Erro: ${erro.message}`);
    return { sucesso: false, erro: erro.message };
  }
}

// ============================================================
// DESCONECTAR CalDAV
// ============================================================
async function desconectarCaldav(pool, usuario) {
  try {
    await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .query('DELETE FROM cal_caldav_config WHERE usuario = @usuario');
    return { sucesso: true, mensagem: 'Desconectado com sucesso' };
  } catch (erro) {
    return { sucesso: false, erro: erro.message };
  }
}

// ============================================================
// EXPORTAÇÕES
// ============================================================
module.exports = {
  salvarConfiguracaoCaldav,
  obterConfiguracaoCaldav,
  validarCredenciaisCaldav,
  criarCalendarioGoogle,
  listarEventosGoogle,
  criarEventoGoogle,
  editarEventoGoogle,
  deletarEventoGoogle,
  sincronizarDoGoogle,
  sincronizarViaIcal,
  desconectarCaldav,
  criptografar,
  descriptografar
};
