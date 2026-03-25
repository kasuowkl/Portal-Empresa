/**
 * ARQUIVO: services/emailService.js
 * VERSÃO:  1.0.0
 * DATA:    2026-03-10
 * DESCRIÇÃO: Serviço de e-mail para notificações do Portal WKL
 *            Usa configurações SMTP do .env e preferências salvas no banco.
 */

const nodemailer = require('nodemailer');

// ============================================================
// TRANSPORTER — lê configuração do banco (com fallback p/ .env)
// ============================================================
async function criarTransporter(pool) {
  const sql = require('mssql');
  const r = await pool.request()
    .input('c1', sql.VarChar, 'email_host')
    .input('c2', sql.VarChar, 'email_porta')
    .input('c3', sql.VarChar, 'email_ssl')
    .input('c4', sql.VarChar, 'email_usuario')
    .input('c5', sql.VarChar, 'email_senha')
    .query(`SELECT chave, valor FROM configuracoes WHERE chave IN (@c1,@c2,@c3,@c4,@c5)`);
  const c = {};
  for (const row of r.recordset) c[row.chave] = row.valor;

  const host  = c['email_host']    || process.env.SMTP_HOST;
  const porta = parseInt(c['email_porta']   || process.env.SMTP_PORT) || 587;
  const ssl   = c['email_ssl'] !== undefined
    ? c['email_ssl'] !== 'false' && c['email_ssl'] !== '0'
    : String(process.env.SMTP_PORT) === '465';
  const user  = c['email_usuario'] || process.env.SMTP_USER;
  const pass  = c['email_senha']   || process.env.SMTP_PASS;

  return nodemailer.createTransport({
    host, port: porta, secure: ssl,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });
}

// ============================================================
// TEMPLATES DE E-MAIL POR TIPO DE NOTIFICAÇÃO
// ============================================================
const templates = {

  // ── PORTAL ─────────────────────────────────────────────────
  'portal.login': (d) => ({
    assunto: `Login realizado — ${d.usuario}`,
    html: bloco('Portal · Login realizado', '#4e9af1',
      `O usuário <b>${d.nome || d.usuario}</b> fez login no Portal.<br>
       <small>Tipo: ${d.tipo || 'local'} &nbsp;|&nbsp; IP: ${d.ip || '—'}</small>`)
  }),

  'portal.login_falha': (d) => ({
    assunto: `Tentativa de login falhou — ${d.usuario}`,
    html: bloco('Portal · Login com falha', '#e94560',
      `Tentativa de login <b>malsucedida</b> para o usuário <b>${d.usuario}</b>.<br>
       <small>Motivo: ${d.motivo || '—'} &nbsp;|&nbsp; IP: ${d.ip || '—'}</small>`)
  }),

  'portal.usuario_bloqueado': (d) => ({
    assunto: `Usuário bloqueado — ${d.usuario}`,
    html: bloco('Portal · Usuário bloqueado', '#e94560',
      `O usuário <b>${d.usuario}</b> tentou acessar e está <b>bloqueado</b>.<br>
       <small>IP: ${d.ip || '—'}</small>`)
  }),

  'portal.usuario_criado': (d) => ({
    assunto: `Novo usuário criado — ${d.usuario}`,
    html: bloco('Portal · Novo usuário', '#4caf50',
      `Um novo usuário foi criado no Portal.<br>
       <b>Nome:</b> ${d.nome}<br>
       <b>Login:</b> ${d.usuario}<br>
       <b>Nível:</b> ${d.nivel}<br>
       <small>Criado por: ${d.criado_por}</small>`)
  }),

  // ── CHAMADOS ───────────────────────────────────────────────
  'chamados.aprovacao_solicitada': (d) => ({
    assunto: `Aprovação solicitada — Chamado ${d.protocolo}`,
    html: bloco('Chamados · Aprovação solicitada', '#ff9800',
      `O chamado <b>${d.protocolo}</b> aguarda a sua aprovação.<br>
       <b>Solicitante:</b> ${d.nome_solicitante || d.solicitante || '—'}<br>
       <b>Assunto:</b> ${d.assunto || '—'}<br>
       <b>Setor:</b> ${d.setor || '—'}<br>
       <small>Por favor, acesse o portal para aprovar ou rejeitar.</small>`)
  }),

  'chamados.aprovacao_concluida': (d) => ({
    assunto: `Chamado ${d.aprovado ? 'aprovado' : 'rejeitado'} — ${d.protocolo}`,
    html: bloco(
      `Chamados · ${d.aprovado ? 'Aprovado' : 'Rejeitado'}`,
      d.aprovado ? '#4caf50' : '#e94560',
      `O chamado <b>${d.protocolo}</b> foi <b>${d.aprovado ? 'aprovado' : 'rejeitado'}</b>.<br>
       <b>Aprovador:</b> ${d.aprovador || '—'}<br>
       ${d.observacao ? `<b>Observação:</b> ${d.observacao}<br>` : ''}
       <small>${d.aprovado ? 'O atendimento pode ser iniciado.' : 'Entre em contato com o responsável para mais detalhes.'}</small>`
    )
  }),

  'chamados.atribuido': (d) => ({
    assunto: `Chamado atribuído a você — ${d.protocolo}`,
    html: bloco('Chamados · Chamado atribuído', '#4e9af1',
      `O chamado <b>${d.protocolo}</b> foi atribuído a você.<br>
       <b>Solicitante:</b> ${d.nome_solicitante || '—'}<br>
       <b>Setor:</b> ${d.setor || '—'}<br>
       <b>Assunto:</b> ${d.assunto || '—'}`)
  }),

  'chamados.transferido': (d) => ({
    assunto: `Chamado transferido — ${d.protocolo}`,
    html: bloco('Chamados · Transferência', '#ff9800',
      `O chamado <b>${d.protocolo}</b> foi transferido.<br>
       <b>De:</b> ${d.tecnico_anterior || '—'} → <b>Para:</b> ${d.tecnico_novo || '—'}<br>
       <b>Setor destino:</b> ${d.setor_destino || '—'}<br>
       ${d.motivo ? `<b>Motivo:</b> ${d.motivo}` : ''}`)
  }),

  'chamados.vinculado': (d) => ({
    assunto: `Chamados vinculados — ${d.protocolo}`,
    html: bloco('Chamados · Vínculo', '#9c27b0',
      `O chamado <b>${d.protocolo}</b> foi vinculado ao chamado <b>${d.protocolo_pai || '—'}</b>.<br>
       <small>Chamados vinculados compartilham atualizações de status.</small>`)
  }),

  'chamados.reaberto': (d) => ({
    assunto: `Chamado reaberto — ${d.protocolo}`,
    html: bloco('Chamados · Reaberto', '#ff9800',
      `O chamado <b>${d.protocolo}</b> foi <b>reaberto</b>.<br>
       <b>Solicitante:</b> ${d.nome_solicitante || '—'}<br>
       ${d.motivo ? `<b>Motivo:</b> ${d.motivo}` : ''}`)
  }),

  'chamados.cancelado': (d) => ({
    assunto: `Chamado cancelado — ${d.protocolo}`,
    html: bloco('Chamados · Cancelado', '#e94560',
      `O chamado <b>${d.protocolo}</b> foi <b>cancelado</b>.<br>
       ${d.motivo ? `<b>Motivo:</b> ${d.motivo}<br>` : ''}
       <b>Cancelado por:</b> ${d.cancelado_por || '—'}`)
  }),

  'chamados.novo': (d) => ({
    assunto: `Novo chamado aberto — ${d.protocolo}`,
    html: bloco('Chamados · Novo chamado', '#4e9af1',
      `Um novo chamado foi aberto.<br>
       <b>Protocolo:</b> ${d.protocolo}<br>
       <b>Solicitante:</b> ${d.nome_solicitante}<br>
       <b>Setor:</b> ${d.setor}<br>
       <b>Assunto:</b> ${d.assunto}`)
  }),

  'chamados.status_alterado': (d) => ({
    assunto: `Chamado atualizado — ${d.protocolo}`,
    html: bloco('Chamados · Status alterado', '#ff9800',
      `O chamado <b>${d.protocolo}</b> teve seu status alterado.<br>
       <b>Novo status:</b> ${d.status}<br>
       <b>Por:</b> ${d.por || '—'}`)
  }),

  'chamados.concluido': (d) => ({
    assunto: `Chamado concluído — ${d.protocolo}`,
    html: bloco('Chamados · Concluído', '#4caf50',
      `O chamado <b>${d.protocolo}</b> foi <b>concluído</b>.<br>
       <b>Atendedor:</b> ${d.nome_atendedor || '—'}`)
  }),

  'chamados.nova_mensagem': (d) => ({
    assunto: `Nova mensagem — Chamado ${d.protocolo}`,
    html: bloco('Chamados · Nova mensagem', '#9c27b0',
      `Nova mensagem no chamado <b>${d.protocolo}</b>.<br>
       <b>De:</b> ${d.login}<br>
       <b>Mensagem:</b> ${d.mensagem || '—'}`)
  }),

  // ── PATRIMÔNIO ─────────────────────────────────────────────
  'patrimonio.cadastro': (d) => ({
    assunto: `Bem cadastrado — ${d.codigo}`,
    html: bloco('Patrimônio · Bem cadastrado', '#4e9af1',
      `Um novo bem foi cadastrado no Patrimônio.<br>
       <b>Código:</b> ${d.codigo}<br>
       <b>Descrição:</b> ${d.descricao}<br>
       <b>Por:</b> ${d.criado_por}`)
  }),

  'patrimonio.transferencia': (d) => ({
    assunto: `Transferência de bem — ${d.codigo}`,
    html: bloco('Patrimônio · Transferência', '#ff9800',
      `O bem <b>${d.codigo}</b> foi transferido.<br>
       <b>De:</b> ${d.resp_de || '—'} → <b>Para:</b> ${d.resp_para || '—'}<br>
       <b>Setor destino:</b> ${d.setor_destino || '—'}`)
  }),

  'patrimonio.avaria': (d) => ({
    assunto: `Avaria/Sinistro — ${d.codigo}`,
    html: bloco('Patrimônio · Avaria', '#e94560',
      `Avaria ou sinistro registrado no bem <b>${d.codigo}</b>.<br>
       <b>Detalhe:</b> ${d.detalhe || '—'}<br>
       <b>Por:</b> ${d.registrado_por}`)
  }),

  'patrimonio.descarte': (d) => ({
    assunto: `Bem descartado — ${d.codigo}`,
    html: bloco('Patrimônio · Descarte', '#e94560',
      `O bem <b>${d.codigo}</b> foi <b>descartado</b>.<br>
       <b>Detalhe:</b> ${d.detalhe || '—'}<br>
       <b>Por:</b> ${d.registrado_por}`)
  }),

  // ── AGENDA DE TAREFAS ──────────────────────────────────────
  'agenda.tarefa_criada': (d) => ({
    assunto: `Nova tarefa criada — ${d.titulo}`,
    html: bloco('Agenda · Nova tarefa', '#4e9af1',
      `Uma nova tarefa foi criada.<br>
       <b>Título:</b> ${d.titulo}<br>
       <b>Lista:</b> ${d.lista || '—'}<br>
       <b>Prazo:</b> ${d.prazo || 'Sem prazo'}<br>
       <b>Por:</b> ${d.criado_por}`)
  }),

  'agenda.tarefa_concluida': (d) => {
    let corpo = `A tarefa <b>${d.titulo}</b> foi <b>concluída</b>.<br>`;
    if (d.descricao && d.descricao !== '—') corpo += `<b>Descrição:</b> ${d.descricao}<br>`;
    corpo += `<b>Lista:</b> ${d.lista || '—'}`;

    if (Array.isArray(d.passos) && d.passos.length > 0) {
      corpo += '<br><br><b>Passos executados:</b><table style="width:100%;margin:8px 0;border-collapse:collapse">';
      for (const p of d.passos) {
        const style = p.concluido ? 'text-decoration:line-through;color:#9e9e9e' : '';
        const executor = p.executado_por || '—';
        const dataExec = p.executado_em ? new Date(p.executado_em).toLocaleString('pt-BR') : '—';
        corpo += `<tr style="border-bottom:1px solid #2a3a55"><td style="padding:6px;${style}">${p.descricao}</td><td style="padding:6px;text-align:right;font-size:0.85rem;color:#9e9e9e"><b>Executado por:</b> ${executor}<br><small>${dataExec}</small></td></tr>`;
      }
      corpo += '</table>';
    }

    return { assunto: `Tarefa concluída — ${d.titulo}`, html: bloco('Agenda · Tarefa concluída', '#4caf50', corpo) };
  },

  'agenda.passo_atribuido': (d) => {
    let corpo = `Você foi atribuído a um ou mais passos da tarefa <b>${d.titulo}</b>:<br><br>
                 <b>📋 Lista:</b> ${d.lista || '—'}<br>`;
    if (d.prazo) corpo += `<b>⏰ Prazo:</b> ${d.prazo}<br>`;

    if (Array.isArray(d.passos) && d.passos.length > 0) {
      corpo += '<b>Todos os passos da tarefa:</b><table style="width:100%;margin:8px 0;border-collapse:collapse">';
      for (const p of d.passos) {
        const status = p.atribuido_para ? `Atribuído para: <b>${p.atribuido_para}</b>` : 'Não atribuído';
        corpo += `<tr style="border-bottom:1px solid #2a3a55"><td style="padding:6px">${p.descricao}</td><td style="padding:6px;text-align:right;font-size:0.85rem;color:#9e9e9e">${status}</td></tr>`;
      }
      corpo += '</table>';
    }

    corpo += '<br><small>Por favor, acesse o Portal para marcar este passo como concluído quando terminar.</small>';
    return { assunto: `Novo passo atribuído — ${d.titulo}`, html: bloco('Agenda · Passo atribuído', '#4e9af1', corpo) };
  },

  'agenda.tarefa_editada': (d) => ({
    assunto: `Tarefa atualizada — ${d.titulo}`,
    html: bloco('Agenda · Tarefa atualizada', '#f5a623',
      `Uma tarefa foi editada.<br>
       <b>Título:</b> ${d.titulo}<br>
       <b>Lista:</b> ${d.lista || '—'}<br>
       <b>Prazo:</b> ${d.prazo || 'Sem prazo'}<br>
       <b>Por:</b> ${d.criado_por}`)
  }),

  'agenda.passo_concluido': (d) => ({
    assunto: `Passo concluído — ${d.titulo}`,
    html: bloco('Agenda · Passo concluído', '#4caf50',
      `Um passo da tarefa <b>${d.titulo}</b> foi marcado como concluído.<br>
       <b>Passo:</b> ${d.passo}<br>
       <b>Concluído por:</b> ${d.executado_por || '—'}<br>
       <b>Lista:</b> ${d.lista || '—'}`)
  }),

  'agenda.membro_adicionado': (d) => ({
    assunto: `Você foi adicionado à lista — ${d.lista}`,
    html: bloco('Agenda · Novo membro', '#4e9af1',
      `Você foi adicionado como membro da lista <b>${d.lista}</b>.<br>
       <b>Permissão:</b> ${d.permissao || '—'}<br>
       <b>Adicionado por:</b> ${d.adicionado_por}`)
  }),

  // ── CALENDÁRIOS ────────────────────────────────────────────
  'calendarios.evento_criado': (d) => ({
    assunto: `Novo evento — ${d.titulo}`,
    html: bloco('Calendários · Novo evento', '#6366f1',
      `Um novo evento foi criado no calendário <b>${d.calendario || '—'}</b>.<br>
       <b>Evento:</b> ${d.titulo}<br>
       <b>Data/Hora:</b> ${d.inicio ? new Date(d.inicio).toLocaleString('pt-BR') : '—'}<br>
       <b>Criado por:</b> ${d.criado_por || '—'}`)
  }),

  'calendarios.lembrete_evento': (d) => ({
    assunto: `Lembrete: ${d.titulo}`,
    html: bloco('Calendários · Lembrete', '#f59e0b',
      `<b>Lembrete de evento!</b><br>
       <b>Evento:</b> ${d.titulo}<br>
       <b>Início:</b> ${d.inicio ? new Date(d.inicio).toLocaleString('pt-BR') : '—'}<br>
       Acesse seu calendário para mais detalhes.`)
  }),

  // ── FINANCEIRO ─────────────────────────────────────────────
  'financeiro.nova_conta': (d) => ({
    assunto: `Nova conta cadastrada — ${d.descricao}`,
    html: bloco('Financeiro · Nova conta', '#4e9af1',
      `Uma nova conta foi cadastrada na Agenda Financeira.<br>
       <b>Descrição:</b> ${d.descricao}<br>
       <b>Valor:</b> R$ ${d.valor}<br>
       <b>Data:</b> ${d.data || '—'}<br>
       <b>Por:</b> ${d.criado_por}`)
  }),

  'financeiro.conta_vencida': (d) => ({
    assunto: `Conta vencida — ${d.descricao}`,
    html: bloco('Financeiro · Conta vencida', '#e94560',
      `A conta <b>${d.descricao}</b> está <b>vencida</b>.<br>
       <b>Valor:</b> R$ ${d.valor}<br>
       <b>Vencimento:</b> ${d.data || '—'}`)
  }),

  'financeiro.lembrete_hoje': (d) => ({
    assunto: `Lembrete financeiro — ${d.total} conta(s) vencem hoje`,
    html: bloco('Financeiro · Contas do dia', '#f5a623',
      `Você tem <b>${d.total} conta(s)</b> com vencimento <b>hoje</b> (${d.data_hoje}) ainda não pagas.<br><br>
       ${d.lista_html}`)
  }),

  'financeiro.lembrete_7dias': (d) => ({
    assunto: `Lembrete financeiro — ${d.total} conta(s) vencem nos próximos 7 dias`,
    html: bloco('Financeiro · Contas dos próximos 7 dias', '#f5a623',
      `Você tem <b>${d.total} conta(s)</b> com vencimento nos <b>próximos 7 dias</b> ainda não pagas.<br><br>
       ${d.lista_html}`)
  }),

  'financeiro.lancamento': (d) => ({
    assunto: `Lançamento registrado — ${d.descricao}`,
    html: bloco('Financeiro · Lançamento registrado', '#f97316',
      `O lançamento da conta foi registrado na Agenda Financeira.<br>
       <b>Descrição:</b> ${d.descricao}<br>
       <b>Valor:</b> R$ ${d.valor}<br>
       <b>Vencimento:</b> ${d.data || '—'}<br>
       <b>Agenda:</b> ${d.agenda_nome || '—'}<br>
       <b>Por:</b> ${d.criado_por}`)
  }),

  'financeiro.conta_paga': (d) => ({
    assunto: `Conta quitada — ${d.descricao}`,
    html: bloco('Financeiro · Conta quitada', '#10b981',
      `A conta foi marcada como <b>paga</b> na Agenda Financeira.<br>
       <b>Descrição:</b> ${d.descricao}<br>
       <b>Valor:</b> R$ ${d.valor}<br>
       <b>Vencimento:</b> ${d.data || '—'}<br>
       <b>Agenda:</b> ${d.agenda_nome || '—'}<br>
       <b>Por:</b> ${d.criado_por}`)
  }),

  'financeiro.lembrete_lancamento': (d) => ({
    assunto: `Lembrete de lançamento — ${d.total} conta(s) vencem em ${d.dias} dia(s)`,
    html: bloco('Financeiro · Lembrete de lançamento', '#f97316',
      `Você tem <b>${d.total} conta(s)</b> com vencimento nos próximos <b>${d.dias} dia(s)</b> que ainda não foram lançadas.<br><br>
       ${d.lista_html}`)
  }),

  'financeiro.conta_vencida_diario': (d) => ({
    assunto: `Contas vencidas — ${d.total} conta(s) em atraso`,
    html: bloco('Financeiro · Contas vencidas', '#e94560',
      `Você tem <b>${d.total} conta(s)</b> com vencimento ultrapassado ainda não pagas.<br><br>
       ${d.lista_html}`)
  }),

  // ── APROVAÇÕES ─────────────────────────────────────────────
  'aprovacoes.nova_solicitacao': (d) => ({
    assunto: `Nova solicitação de aprovação — ${d.titulo}`,
    html: bloco('Aprovações · Nova solicitação', '#4e9af1',
      `Uma nova solicitação de aprovação foi criada e aguarda sua análise.<br>
       <b>Título:</b> ${d.titulo}<br>
       ${d.objetivo ? `<b>Objetivo:</b> ${d.objetivo}<br>` : ''}
       <b>Criado por:</b> ${d.criado_por_nome}<br>
       ${infoApr(d)}
       <small>Acesse o Portal para aprovar ou reprovar a solicitação.</small>`)
  }),

  'aprovacoes.aprovada': (d) => ({
    assunto: `Solicitação aprovada — ${d.titulo}`,
    html: bloco('Aprovações · Aprovada', '#4caf50',
      `A solicitação <b>${d.titulo}</b> foi <b>aprovada</b>.<br>
       <b>Criado por:</b> ${d.criado_por_nome}<br>
       ${infoApr(d)}`)
  }),

  'aprovacoes.reprovada': (d) => ({
    assunto: `Solicitação reprovada — ${d.titulo}`,
    html: bloco('Aprovações · Reprovada', '#e94560',
      `A solicitação <b>${d.titulo}</b> foi <b>reprovada</b>.<br>
       <b>Por:</b> ${d.por_nome || '—'}<br>
       ${d.motivo ? `<b>Motivo:</b> ${d.motivo}<br>` : ''}
       <b>Criado por:</b> ${d.criado_por_nome}<br>
       ${infoApr(d)}`)
  }),

  'aprovacoes.cancelada': (d) => ({
    assunto: `Solicitação cancelada — ${d.titulo}`,
    html: bloco('Aprovações · Cancelada', '#9e9e9e',
      `A solicitação <b>${d.titulo}</b> foi <b>cancelada</b> pelo criador.<br>
       <b>Criado por:</b> ${d.criado_por_nome}<br>
       ${infoApr(d)}`)
  }),

  'aprovacoes.editada': (d) => ({
    assunto: `Solicitação editada — ${d.titulo}`,
    html: bloco('Aprovações · Editada', '#ff9800',
      `A solicitação <b>${d.titulo}</b> foi <b>editada</b> pelo criador.<br>
       <b>Criado por:</b> ${d.criado_por_nome}<br>
       ${infoApr(d)}
       <small>Acesse o Portal para revisar os detalhes atualizados.</small>`)
  }),

  'aprovacoes.lembrete_pendente': (d) => ({
    assunto: `Lembrete — ${d.total} solicitação(ões) aguardando sua aprovação`,
    html: bloco('Aprovações · Lembrete pendente', '#f5a623',
      `Olá <b>${d.nome || d.login}</b>, você tem <b>${d.total}</b> solicitação(ões) pendente(s).<br><br>
       ${d.lista_html}<br>
       <small>Acesse o Portal para aprovar ou reprovar.</small>`)
  }),

  // ── CONTATOS ───────────────────────────────────────────────
  'contatos.novo_contato': (d) => ({
    assunto: `Novo contato adicionado — ${d.nome}`,
    html: bloco('Contatos · Novo contato', '#4e9af1',
      `Um novo contato foi adicionado.<br>
       <b>Nome:</b> ${d.nome}<br>
       <b>Empresa:</b> ${d.empresa || '—'}<br>
       <b>Por:</b> ${d.criado_por}`)
  }),
};

// ============================================================
// HELPER — informações extras de aprovação (tipo de consenso, aprovadores, etc.)
// ============================================================
function infoApr(d) {
  const labels = {
    unanimidade:         'Unanimidade — todos devem aprovar',
    maioria_simples:     'Maioria Simples — 50% + 1',
    maioria_qualificada: `Maioria Qualificada — ${d.consenso_valor || 67}%`,
    quorum_minimo:       `Quórum Mínimo — ${d.consenso_valor || '?'} pessoas`,
  };
  const consensoLabel = labels[d.tipo_consenso] || 'Unanimidade — todos devem aprovar';

  const aprovs = (d.nomes_aprovadores || []).length
    ? (d.nomes_aprovadores || []).map(n => `<span style="display:inline-block;background:#1e3a5f;border:1px solid #2d5a8e;border-radius:4px;padding:2px 8px;margin:2px 3px 2px 0;font-size:.82rem;color:#90caf9">${n}</span>`).join('')
    : '<span style="color:#9e9e9e">—</span>';

  const obsLinha = (d.nomes_observadores || []).length
    ? `<tr style="border-top:1px solid #1e2e45">
        <td style="padding:6px 10px;color:#9e9e9e;font-size:.82rem;white-space:nowrap;vertical-align:top">Observadores</td>
        <td style="padding:6px 10px;font-size:.85rem">${(d.nomes_observadores || []).map(n => `<span style="display:inline-block;background:#1a3326;border:1px solid #2d6b47;border-radius:4px;padding:2px 8px;margin:2px 3px 2px 0;font-size:.82rem;color:#81c995">${n}</span>`).join('')}</td>
       </tr>`
    : '';

  const anexoLinha = (d.qtd_anexos > 0)
    ? `<tr style="border-top:1px solid #1e2e45">
        <td style="padding:6px 10px;color:#9e9e9e;font-size:.82rem;white-space:nowrap">Anexos</td>
        <td style="padding:6px 10px;font-size:.85rem">
          <span style="background:#2a1f0a;border:1px solid #8b6914;border-radius:4px;padding:2px 10px;font-size:.82rem;color:#fbbf24">
            📎 ${d.qtd_anexos} arquivo(s) anexado(s)
          </span>
        </td>
       </tr>`
    : '';

  return `
  <div style="margin:14px 0;border:1px solid #2a3a55;border-radius:6px;overflow:hidden">
    <div style="background:#0f2035;padding:6px 10px;font-size:.78rem;color:#90caf9;font-weight:600;letter-spacing:.04em;text-transform:uppercase">
      Detalhes da solicitação
    </div>
    <table style="width:100%;border-collapse:collapse;background:#111b2e">
      <tr>
        <td style="padding:6px 10px;color:#9e9e9e;font-size:.82rem;white-space:nowrap;vertical-align:top">Tipo de consenso</td>
        <td style="padding:6px 10px;font-size:.85rem;color:#e0e0e0">${consensoLabel}</td>
      </tr>
      <tr style="border-top:1px solid #1e2e45">
        <td style="padding:6px 10px;color:#9e9e9e;font-size:.82rem;white-space:nowrap;vertical-align:top">Aprovadores</td>
        <td style="padding:6px 10px">${aprovs}</td>
      </tr>
      ${obsLinha}
      ${anexoLinha}
    </table>
  </div>`;
}

// ============================================================
// HELPER — gera o HTML do bloco padrão do e-mail
// ============================================================
function bloco(titulo, cor, corpo) {
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;
                border:1px solid #2a2a3e;border-radius:10px;overflow:hidden">
      <div style="background:${cor};padding:16px 20px">
        <span style="color:#fff;font-size:1rem;font-weight:600">${titulo}</span>
      </div>
      <div style="background:#16213e;padding:20px;color:#e0e0e0;font-size:0.9rem;line-height:1.6">
        ${corpo}
        <hr style="border-color:#1e3a5f;margin:16px 0">
        <p style="font-size:0.75rem;color:#9e9e9e;margin:0">
          ${new Date().toLocaleString('pt-BR')} — Portal WKL
        </p>
      </div>
    </div>`;
}

// ============================================================
// FUNÇÃO PRINCIPAL — enviarNotificacao(pool, tipo, dados)
// ============================================================
/**
 * Verifica se a notificação está habilitada no banco e envia o e-mail.
 * @param {object} pool  - Pool de conexão MSSQL (req.app.locals.pool)
 * @param {string} tipo  - Ex: 'portal.login', 'chamados.novo', etc.
 * @param {object} dados - Dados para popular o template
 */
async function enviarNotificacao(pool, tipo, dados) {
  try {
    console.log(`\n🔵 [EMAIL SERVICE] INICIANDO enviarNotificacao(tipo="${tipo}")`);

    // 1. Verifica se o tipo é conhecido
    if (!templates[tipo]) {
      console.warn(`❌ [EMAIL SERVICE] Tipo desconhecido: "${tipo}"`);
      return false;
    }
    console.log(`✅ [EMAIL SERVICE] Tipo encontrado em templates`);


    // 2. Busca configurações da notificação (ativo, dest) e global (email_ativo, email_destino)
    const sql = require('mssql');
    const sistema = tipo.split('.')[0]; // ex: 'financeiro'
    const resultado = await pool.request()
      .input('c1', sql.VarChar, `notif.${tipo}`)
      .input('c2', sql.VarChar, `notif.${tipo}.dest`)
      .input('c3', sql.VarChar, 'notif.email_ativo')
      .input('c4', sql.VarChar, 'notif.email_destino')
      .input('c5', sql.VarChar, 'email_ativo')
      .input('c6', sql.VarChar, `notif.${sistema}.ativo`)
      .query(`SELECT chave, valor FROM configuracoes WHERE chave IN (@c1,@c2,@c3,@c4,@c5,@c6)`);

    const config = {};
    for (const row of resultado.recordset) config[row.chave] = row.valor;

    // Se e-mail global desativado → sai
    const emailGlobalAtivo = config['notif.email_ativo'] === '1' || config['email_ativo'] === 'true';
    console.log(`[EMAIL SERVICE] emailGlobalAtivo=${emailGlobalAtivo}, config['notif.email_ativo']=${config['notif.email_ativo']}`);
    if (!emailGlobalAtivo) {
      console.log(`❌ [EMAIL SERVICE] BLOQUEADO (${tipo}): email global desativado. Ative em Configurações → Email SMTP → Configuração e salve.`);
      return false;
    }
    // Se o sistema estiver desativado (valor '0') → sai (padrão null/undefined = ativo)
    if (config[`notif.${sistema}.ativo`] === '0') {
      console.log(`❌ [EMAIL SERVICE] BLOQUEADO (${tipo}): notificações do sistema "${sistema}" desativadas. Ative em Configurações → Email SMTP → aba ${sistema}.`);
      return false;
    }
    // Se o evento específico estiver desativado → sai
    if (config[`notif.${tipo}`] !== '1') {
      console.log(`❌ [EMAIL SERVICE] BLOQUEADO (${tipo}): evento desativado. notif.${tipo}=${config[`notif.${tipo}`]} (deve ser '1'). Habilite em Configurações → Email SMTP → aba ${sistema}.`);
      return false;
    }
    console.log(`✅ [EMAIL SERVICE] Todas as verificações passaram (global + sistema + evento)`);


    // Resolve lista de destinatários com base nos tipos configurados
    const emailPadrao = config['notif.email_destino'] || process.env.SMTP_USER;
    const destTypes   = config[`notif.${tipo}.dest`]
      ? config[`notif.${tipo}.dest`].split(',').filter(Boolean)
      : ['email_padrao'];

    console.log(`[Email] (${tipo}) dest configurado: [${destTypes.join(', ')}] | email_padrao=${emailPadrao}`);

    // Mapa tipo → e-mail(s) vindos de `dados`
    const resolverDest = {
      email_padrao:        emailPadrao,
      admins:              dados.email_admins,          // string ou array
      solicitante:         dados.email_solicitante,
      aprovadores:         dados.email_aprovadores,     // array de aprovadores
      observador:          dados.email_observadores,    // array de observadores
      tecnicos_setor:      dados.email_tecnicos,        // string ou array
      gestores_setor:      dados.email_gestores,        // string ou array
      aprovador:           dados.email_aprovador,
      tecnico_responsavel: dados.email_tecnico,
      responsavel_atual:   dados.email_responsavel,
      novo_responsavel:    dados.email_novo_responsavel,
      atribuido:           dados.email_atribuido,
      criado_por_usuario:  dados.email_criado_por,
      novo_usuario:        dados.email_usuario,
    };

    // Flatten: resolve cada tipo e junta tudo em um Set (evita duplicatas)
    const destinatariosSet = new Set();
    for (const tipo of destTypes) {
      const val = resolverDest[tipo];
      if (!val) continue;
      if (Array.isArray(val)) val.forEach(e => e && destinatariosSet.add(e.trim()));
      else destinatariosSet.add(String(val).trim());
    }

    // Sempre inclui email_direto se populado (destinatários específicos da entidade)
    if (Array.isArray(dados.email_direto)) {
      dados.email_direto.forEach(e => e && destinatariosSet.add(e.trim()));
    }

    console.log(`[EMAIL SERVICE] Destinatários resolvidos: ${Array.from(destinatariosSet).join(', ')} (count=${destinatariosSet.size})`);

    // Fallback: se nenhum destinatário resolveu, usa email padrão
    if (destinatariosSet.size === 0 && emailPadrao) destinatariosSet.add(emailPadrao);

    if (destinatariosSet.size === 0) {
      console.warn(`❌ [EMAIL SERVICE] BLOQUEADO (${tipo}): sem destinatários. dest=[${destTypes.join(',')}] email_padrao=${emailPadrao}`);
      return false;
    }

    console.log(`✅ [EMAIL SERVICE] (${tipo}) Enviando para: ${Array.from(destinatariosSet).join(', ')}`);

    // 3. Gera o template
    console.log(`[EMAIL SERVICE] Gerando template para tipo="${tipo}"`);
    const { assunto, html } = templates[tipo](dados);
    console.log(`[EMAIL SERVICE] Assunto: "${assunto}"`);

    // 4. Envia para todos os destinatários
    const remetenteConf = await pool.request()
      .input('k', sql.VarChar, 'email_remetente')
      .query(`SELECT valor FROM configuracoes WHERE chave = @k`);
    const remetente = remetenteConf.recordset[0]?.valor
      || `"Portal WKL" <${process.env.SMTP_USER}>`;
    console.log(`[EMAIL SERVICE] Remetente: "${remetente}"`);

    console.log(`[EMAIL SERVICE] Criando transporter...`);
    const transporter = await criarTransporter(pool);
    console.log(`[EMAIL SERVICE] Transporter criado com sucesso`);

    console.log(`[EMAIL SERVICE] Chamando transporter.sendMail()...`);
    const info = await transporter.sendMail({
      from: remetente,
      to:   Array.from(destinatariosSet).join(', '),
      subject: assunto,
      html,
    });

    console.log(`✅ [EMAIL SERVICE] ENVIADO (${tipo}): messageId=${info.messageId}`);
    if (info.rejected && info.rejected.length > 0) {
      console.warn(`⚠️ [EMAIL SERVICE] REJEITADOS pelo SMTP: ${info.rejected.join(', ')}`);
    }
    if (info.response) {
      console.log(`[EMAIL SERVICE] Resposta SMTP: ${info.response}`);
    }
    return true;

  } catch (err) {
    console.error(`❌ [EMAIL SERVICE] FALHA ao enviar "${tipo}": ${err.message}`);
    console.error(`[EMAIL SERVICE] Stack: ${err.stack}`);
    return false;
  }
}

// ============================================================
// FUNÇÃO — enviarEmailTeste(pool, usuario)
// Envia diretamente sem verificar flags no banco
// ============================================================
async function enviarEmailTeste(pool, usuario, destinoOverride) {
  const sql = require('mssql');

  // Busca destinatário e configurações SMTP salvas no banco
  const resultado = await pool.request()
    .input('c1', sql.VarChar, 'notif.email_destino')
    .input('c2', sql.VarChar, 'email_usuario')
    .input('c3', sql.VarChar, 'email_senha')
    .input('c4', sql.VarChar, 'email_host')
    .input('c5', sql.VarChar, 'email_porta')
    .input('c6', sql.VarChar, 'email_ssl')
    .input('c7', sql.VarChar, 'email_remetente')
    .query(`SELECT chave, valor FROM configuracoes WHERE chave IN (@c1,@c2,@c3,@c4,@c5,@c6,@c7)`);

  const c = {};
  for (const row of resultado.recordset) c[row.chave] = row.valor;

  const host      = c['email_host']     || process.env.SMTP_HOST;
  const porta     = parseInt(c['email_porta']    || process.env.SMTP_PORT) || 587;
  const ssl       = (c['email_ssl'] !== undefined ? c['email_ssl'] !== 'false' : String(process.env.SMTP_PORT) === '465');
  const emailUser = c['email_usuario']  || process.env.SMTP_USER;
  const emailPass = c['email_senha']    || process.env.SMTP_PASS;
  const remetente = c['email_remetente']|| `"Portal WKL" <${emailUser}>`;
  const destino   = destinoOverride || c['notif.email_destino'] || emailUser;

  if (!host || !emailUser || !emailPass || !destino) {
    throw new Error('Configuração SMTP incompleta. Salve o servidor, usuário e senha antes de testar.');
  }

  const transporter = nodemailer.createTransport({
    host, port: porta, secure: ssl,
    auth: { user: emailUser, pass: emailPass },
    tls: { rejectUnauthorized: false }
  });

  const html = bloco('Portal WKL · Email de teste', '#4e9af1',
    `Este é um e-mail de teste enviado pelo Portal WKL.<br>
     Se você recebeu esta mensagem, o servidor SMTP está configurado corretamente.<br>
     <small>Enviado por: <b>${usuario}</b></small>`);

  const info = await transporter.sendMail({
    from: remetente, to: destino,
    subject: 'Portal WKL — Email de teste', html
  });

  console.log(`[Email] Teste enviado: ${info.messageId}`);
  return info;
}

module.exports = { enviarNotificacao, enviarEmailTeste };
