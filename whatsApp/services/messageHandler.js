const { listarPendentes, listarAprovacoes, detalharAprovacao, responderAprovacao, buscarUsuarioPorWhatsapp, registrarLogPortal } = require('./portalApi');
const { getConfig, interpolate } = require('./botConfig');
const log = require('./botLogger');

// Mapa temporário: jid → { login, nome }
const sessoes = new Map();

// ─── Helpers ──────────────────────────────────────────────────
function saudacao(nome) {
  const hora = new Date().getHours();
  const periodo = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  return interpolate(getConfig().saudacao, { periodo, nome });
}

function ehSaudacao(texto) {
  const t = texto.toLowerCase().trim();
  const lista = getConfig().saudacoes || [];
  return lista.some(s => t === s || t.startsWith(s + ' ') || t.startsWith(s + ',') || t.startsWith(s + '!'));
}

function formatarLista(lista, limite = 10) {
  if (!lista.length) return null;
  return lista.slice(0, limite).map((a, i) =>
    `${i + 1}. *#${a.id}* — ${a.titulo}` +
    (a.objetivo ? `\n   Objetivo: ${a.objetivo}` : '') +
    `\n   Status: ${a.status} | Por: ${a.criado_por_nome || a.criado_por}`
  ).join('\n\n');
}

function formatarData(dt) {
  if (!dt) return '';
  try {
    return new Date(dt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return dt; }
}

// ─── Processador principal ────────────────────────────────────
async function processarMensagem({ jid, texto, nome, msgId, enviar }) {
  const cfg   = getConfig();
  const input = texto.trim();
  const partes = input.split(/\s+/);
  const acao   = partes[0].toLowerCase();

  // Sessão do usuário
  if (!sessoes.has(jid)) sessoes.set(jid, { login: null, nome: nome || null });
  const sessao = sessoes.get(jid);

  log.log('msg', `Recebida de ${nome || jid}: ${texto}`, { jid, msgId });

  // Auto-login: identifica pelo número do JID
  if (!sessao.login) {
    const numero = jid.replace('@s.whatsapp.net', '').replace(/@\w+/g, '');
    log.log('auth', `Auto-login tentativa: ${jid}, numero=${numero}`);
    if (numero && /^\d{10,15}$/.test(numero)) {
      const usuario = await buscarUsuarioPorWhatsapp(numero).catch(() => null);
      if (usuario?.login) {
        sessao.login = usuario.login;
        sessao.nome  = usuario.nome || usuario.login;
        sessoes.set(jid, sessao);
        log.log('auth', `Auto-login OK: ${jid} → ${usuario.login}`);
        registrarLogPortal({ usuario: usuario.login, acao: 'LOGIN', sistema: 'whatsapp', detalhes: `Login automático via WhatsApp (${jid.replace('@s.whatsapp.net','')})` });
      } else {
        log.log('auth', `Auto-login falhou: ${numero} não encontrado no Portal`);
      }
    }
  }

  async function reply(txt) {
    log.log('envio', `Para ${sessao.nome || jid}: ${txt.substring(0, 100)}...`, { jid });
    await enviar(jid, txt);
  }

  async function tentarLogin() {
    const numero = jid.replace('@s.whatsapp.net', '').replace(/@\w+/g, '');
    if (numero && /^\d{10,15}$/.test(numero)) {
      const usuario = await buscarUsuarioPorWhatsapp(numero).catch((e) => {
        log.log('erro', `Busca usuário falhou: ${e.message}`, { numero });
        return null;
      });
      if (usuario?.login) {
        sessao.login = usuario.login;
        sessao.nome  = usuario.nome || usuario.login;
        sessoes.set(jid, sessao);
        log.log('auth', `Login inline OK: ${jid} → ${usuario.login}`);
        return true;
      }
    }
    return false;
  }

  try {
    // ─── SAUDAÇÃO → Menu ────────────────────────────────
    if (ehSaudacao(input)) {
      const nomeExibir = sessao.nome || nome || 'usuário';
      let msg = saudacao(nomeExibir);
      if (!sessao.login) {
        msg += '\n\n' + cfg.naoVinculado;
      } else {
        msg += '\n' + cfg.menuPrincipal;
      }
      return reply(msg);
    }

    // ─── MENU / AJUDA ───────────────────────────────────
    if (['menu', 'ajuda', '0'].includes(acao)) {
      if (!sessao.login && !(await tentarLogin())) {
        return reply(cfg.naoVinculado);
      }
      return reply(cfg.menuPrincipal);
    }

    // ─── LOGIN MANUAL ───────────────────────────────────
    if (acao === 'login') {
      const usuario = partes[1];
      if (!usuario) return reply('Informe o usuário: *login <usuario>*');
      sessao.login = usuario;
      sessao.nome  = usuario;
      sessoes.set(jid, sessao);
      log.log('auth', `Login manual: ${jid} → ${usuario}`);
      registrarLogPortal({ usuario, acao: 'LOGIN', sistema: 'whatsapp', detalhes: `Login manual via WhatsApp (${jid.replace('@s.whatsapp.net','')})` });
      return reply(`✅ Usuário *${usuario}* vinculado.\n${cfg.menuPrincipal}`);
    }

    // ─── Comandos que exigem login ──────────────────────
    const comandosAutenticados = ['1', '2', '3', '4', '5', '6', '7', 'pendentes', 'detalhar', 'aprovar', 'reprovar'];
    if (comandosAutenticados.includes(acao)) {
      if (!sessao.login && !(await tentarLogin())) {
        return reply(cfg.naoVinculado);
      }
    }

    // ═══════════════════════════════════════════════════
    // OPÇÃO 1 — Aprovações Pendentes
    // ═══════════════════════════════════════════════════
    if (acao === '1' || acao === 'pendentes') {
      log.log('api', `Listando pendentes para ${sessao.login}`);
      const lista = await listarPendentes(sessao.login);
      if (!lista.length) return reply(cfg.nenhumaPendente);
      const linhas = formatarLista(lista, 10);
      const exId = lista[0].id;
      return reply(`*Aprovações Pendentes (${lista.length}):*\n\n${linhas}\n\n_Para aprovar: *aprovar ${exId}*_\n_Para reprovar: *reprovar ${exId} [motivo]*_\n_Para detalhes: *detalhar ${exId}*_\n\nDigite *0* para voltar ao menu.`);
    }

    // ═══════════════════════════════════════════════════
    // OPÇÃO 2 — Últimas 10 Aprovadas
    // ═══════════════════════════════════════════════════
    if (acao === '2') {
      const todas = await listarAprovacoes(sessao.login);
      const aprovadas = todas.filter(a => a.status === 'Aprovado').slice(0, 10);
      if (!aprovadas.length) return reply(cfg.nenhumaAprovada);
      const linhas = formatarLista(aprovadas, 10);
      return reply(`*Últimas 10 Aprovadas:*\n\n${linhas}\n\n_Para detalhes: *detalhar <id>*_\n\nDigite *0* para voltar ao menu.`);
    }

    // ═══════════════════════════════════════════════════
    // OPÇÃO 3 — Últimas 10 Reprovadas
    // ═══════════════════════════════════════════════════
    if (acao === '3') {
      const todas = await listarAprovacoes(sessao.login);
      const reprovadas = todas.filter(a => a.status === 'Reprovado').slice(0, 10);
      if (!reprovadas.length) return reply(cfg.nenhumaReprovada);
      const linhas = formatarLista(reprovadas, 10);
      return reply(`*Últimas 10 Reprovadas:*\n\n${linhas}\n\n_Para detalhes: *detalhar <id>*_\n\nDigite *0* para voltar ao menu.`);
    }

    // ═══════════════════════════════════════════════════
    // OPÇÃO 4 — Todas minhas aprovações
    // ═══════════════════════════════════════════════════
    if (acao === '4') {
      const todas = await listarAprovacoes(sessao.login);
      if (!todas.length) return reply(cfg.nenhumaEncontrada);

      const pendentes  = todas.filter(a => a.status === 'Pendente').length;
      const aprovadas  = todas.filter(a => a.status === 'Aprovado').length;
      const reprovadas = todas.filter(a => a.status === 'Reprovado').length;

      let txt = `*Resumo das suas aprovações:*\n\n`;
      txt += `Pendentes: *${pendentes}*\n`;
      txt += `Aprovadas: *${aprovadas}*\n`;
      txt += `Reprovadas: *${reprovadas}*\n`;
      txt += `Total: *${todas.length}*\n\n`;
      txt += `_Últimas 10:_\n\n`;
      txt += formatarLista(todas, 10);
      txt += `\n\nDigite *0* para voltar ao menu.`;
      return reply(txt);
    }

    // ═══════════════════════════════════════════════════
    // OPÇÃO 5 — Detalhar aprovação
    // ═══════════════════════════════════════════════════
    if (acao === '5' || acao === 'detalhar') {
      const id = parseInt(partes[1]);
      if (!id) return reply(cfg.informeIdDetalhar);
      log.log('api', `Detalhando aprovação #${id} (login: ${sessao.login})`);
      const apr = await detalharAprovacao(id, sessao.login);
      const participantes = apr.participantes?.map(p =>
        `   • ${p.aprovador_nome || p.aprovador_login} — ${p.decisao}${p.motivo ? ` (${p.motivo})` : ''}`
      ).join('\n') || '   Nenhum';

      const txt =
        `*Aprovação #${apr.id}*\n\n` +
        `Título: ${apr.titulo}\n` +
        `Objetivo: ${apr.objetivo || '—'}\n` +
        `Solicitante: ${apr.criado_por_nome || apr.criado_por}\n` +
        `Status: *${apr.status}*\n` +
        `Consenso: ${apr.tipo_consenso || 'unanimidade'}\n` +
        `Criada em: ${formatarData(apr.criado_em)}\n\n` +
        `*Aprovadores:*\n${participantes}\n\n` +
        (apr.status === 'Pendente' ? `_Para responder:_\n*aprovar ${id}* ou *reprovar ${id} [motivo]*\n\n` : '') +
        `Digite *0* para voltar ao menu.`;
      return reply(txt);
    }

    // ═══════════════════════════════════════════════════
    // OPÇÃO 6 — Aprovar
    // ═══════════════════════════════════════════════════
    if (acao === '6' || acao === 'aprovar') {
      const id = parseInt(partes[1]);
      if (!id) return reply(cfg.informeIdAprovar);
      log.log('api', `Aprovando #${id} (login: ${sessao.login})`);
      const res = await responderAprovacao(id, sessao.login, 'Aprovado', null);
      const status = res.novoStatus ? `\nStatus geral: *${res.novoStatus}*` : '';
      registrarLogPortal({ usuario: sessao.login, acao: 'APROVACAO', sistema: 'aprovacoes', detalhes: `Aprovação #${id} aprovada via WhatsApp` });
      return reply(interpolate(cfg.aprovadoSucesso, { id, status }));
    }

    // ═══════════════════════════════════════════════════
    // OPÇÃO 7 — Reprovar
    // ═══════════════════════════════════════════════════
    if (acao === '7' || acao === 'reprovar') {
      const id     = parseInt(partes[1]);
      const motivo = partes.slice(2).join(' ') || null;
      if (!id) return reply(cfg.informeIdReprovar);
      log.log('api', `Reprovando #${id} (login: ${sessao.login}, motivo: ${motivo})`);
      const res = await responderAprovacao(id, sessao.login, 'Reprovado', motivo);
      const status = res.novoStatus ? `\nStatus geral: *${res.novoStatus}*` : '';
      const motivoTxt = motivo ? `\nMotivo: ${motivo}` : '';
      registrarLogPortal({ usuario: sessao.login, acao: 'REPROVACAO', sistema: 'aprovacoes', detalhes: `Aprovação #${id} reprovada via WhatsApp${motivo ? ': ' + motivo : ''}` });
      return reply(interpolate(cfg.reprovadoSucesso, { id, motivo: motivoTxt, status }));
    }

    // ─── Mensagem não reconhecida ───────────────────────
    // Não responde a mensagens aleatórias para evitar spam

  } catch (err) {
    log.log('erro', `${err.message} | status: ${err.response?.status} | url: ${err.config?.url}`, { data: err.response?.data });
    const detalhe = err.response?.data?.erro || err.message;
    return reply(interpolate(cfg.erroGenerico, { detalhe }));
  }
}

function getSessoes() {
  return sessoes;
}

module.exports = { processarMensagem, getSessoes };
