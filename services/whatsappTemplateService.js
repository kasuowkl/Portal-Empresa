const { carregarConfigWhatsApp } = require('./whatsappService');

const WHATSAPP_MESSAGE_CATALOG = [
  {
    key: 'portal.login',
    sistema: 'portal',
    titulo: 'Login realizado',
    descricao: 'Aviso enviado quando um usuário entra no portal com sucesso.',
    placeholders: ['nome', 'usuario', 'tipo', 'ip', 'link_portal'],
    template:
      `*Portal WKL - Login realizado*\n\n` +
      `Olá, *{{nome}}*!\n` +
      `Seu acesso ao portal foi registrado com sucesso.\n\n` +
      `Usuário: {{usuario}}\n` +
      `Tipo: {{tipo}}\n` +
      `IP: {{ip}}\n\n` +
      `Acesse: {{link_portal}}`,
  },
  {
    key: 'portal.login_falha',
    sistema: 'portal',
    titulo: 'Falha de login',
    descricao: 'Aviso enviado quando ocorre tentativa de acesso sem sucesso.',
    placeholders: ['usuario', 'motivo', 'ip'],
    template:
      `*Portal WKL - Falha de login*\n\n` +
      `Foi identificada uma tentativa de acesso sem sucesso.\n\n` +
      `Usuário informado: {{usuario}}\n` +
      `Motivo: {{motivo}}\n` +
      `IP: {{ip}}\n\n` +
      `Se não foi você, revise suas credenciais.`,
  },
  {
    key: 'portal.usuario_bloqueado',
    sistema: 'portal',
    titulo: 'Usuário bloqueado',
    descricao: 'Aviso enviado quando um usuário bloqueado tenta acessar o portal.',
    placeholders: ['usuario', 'ip'],
    template:
      `*Portal WKL - Usuário bloqueado*\n\n` +
      `Uma tentativa de acesso foi feita com um usuário bloqueado.\n\n` +
      `Usuário: {{usuario}}\n` +
      `IP: {{ip}}\n\n` +
      `Procure o administrador do sistema para liberar o acesso.`,
  },
  {
    key: 'portal.usuario_criado',
    sistema: 'portal',
    titulo: 'Acesso liberado',
    descricao: 'Mensagem enviada quando um usuário recebe acesso ao portal.',
    placeholders: ['nome', 'login', 'nivel', 'link_login'],
    template:
      `*Portal WKL - Acesso liberado*\n\n` +
      `Olá, *{{nome}}*!\n` +
      `Seu acesso ao portal foi criado com sucesso.\n\n` +
      `Login: {{login}}\n` +
      `Nível: {{nivel}}\n\n` +
      `Acesse: {{link_login}}`,
  },
  {
    key: 'agenda.evento_padrao',
    sistema: 'agenda',
    titulo: 'Eventos da Agenda de Tarefas',
    descricao: 'Modelo usado para novas tarefas, edição, conclusão, passos e membros.',
    placeholders: ['cabecalho', 'titulo', 'lista', 'passo', 'permissao', 'usuario_acao', 'link'],
    template:
      `*Portal WKL - {{cabecalho}}*\n\n` +
      `Tarefa: {{titulo}}\n` +
      `Lista: {{lista}}` +
      `{{passo}}` +
      `{{permissao}}` +
      `{{usuario_acao}}` +
      `\nAcesse: {{link}}`,
  },
  {
    key: 'agenda.aprovacao_tarefa',
    sistema: 'agenda',
    titulo: 'Aprovação ligada à tarefa',
    descricao: 'Solicitação de aprovação enviada a partir de uma tarefa.',
    placeholders: ['aprovador_nome', 'aprovacao_id', 'titulo', 'lista', 'tarefa', 'solicitante', 'link_item', 'link_aprovacoes'],
    template:
      `*Portal WKL - Aprovação Pendente*\n\n` +
      `Olá, *{{aprovador_nome}}*! Você recebeu uma solicitação de aprovação ligada a uma tarefa.\n\n` +
      `*#{{aprovacao_id}}* - {{titulo}}\n` +
      `Lista: {{lista}}\n` +
      `Tarefa: {{tarefa}}\n` +
      `Solicitante: {{solicitante}}\n\n` +
      `Para responder:\n` +
      `✅ *aprovar {{aprovacao_id}}*\n` +
      `❌ *reprovar {{aprovacao_id}} [motivo]*\n\n` +
      `Acesse a tarefa: {{link_item}}\n` +
      `Ou responda em: {{link_aprovacoes}}`,
  },
  {
    key: 'agendaProjetos.aprovacao_projeto',
    sistema: 'agendaProjetos',
    titulo: 'Aprovação ligada ao projeto',
    descricao: 'Solicitação de aprovação enviada a partir de um projeto.',
    placeholders: ['aprovador_nome', 'aprovacao_id', 'titulo', 'projeto', 'solicitante', 'objetivo', 'link_aprovacoes'],
    template:
      `*Portal WKL - Aprovação Pendente*\n\n` +
      `Olá, *{{aprovador_nome}}*! Você recebeu uma solicitação de aprovação ligada a um projeto.\n\n` +
      `*#{{aprovacao_id}}* - {{titulo}}\n` +
      `Projeto: {{projeto}}\n` +
      `Solicitante: {{solicitante}}` +
      `{{objetivo}}\n\n` +
      `Para responder:\n` +
      `✅ *aprovar {{aprovacao_id}}*\n` +
      `❌ *reprovar {{aprovacao_id}} [motivo]*\n\n` +
      `Acesse também: {{link_aprovacoes}}`,
  },
  {
    key: 'financeiro.evento_padrao',
    sistema: 'financeiro',
    titulo: 'Eventos da Agenda Financeira',
    descricao: 'Modelo usado para contas criadas, editadas, pagas, vencidas e lançamentos.',
    placeholders: ['evento_label', 'descricao_item', 'agenda_nome', 'valor', 'data', 'link'],
    template:
      `*Portal WKL - Agenda Financeira*\n\n` +
      `Você recebeu uma atualização em um lançamento financeiro.\n\n` +
      `Evento: {{evento_label}}\n` +
      `Descrição: {{descricao_item}}\n` +
      `Agenda: {{agenda_nome}}\n` +
      `Valor: {{valor}}\n` +
      `Data: {{data}}\n\n` +
      `Acesse: {{link}}`,
  },
  {
    key: 'financeiro.aprovacao_lancamento',
    sistema: 'financeiro',
    titulo: 'Aprovação ligada ao financeiro',
    descricao: 'Solicitação de aprovação enviada a partir de um lançamento financeiro.',
    placeholders: ['aprovador_nome', 'aprovacao_id', 'titulo', 'agenda_nome', 'lancamento', 'solicitante', 'link_item', 'link_aprovacoes'],
    template:
      `*Portal WKL - Aprovação Pendente*\n\n` +
      `Olá, *{{aprovador_nome}}*! Você recebeu uma solicitação de aprovação ligada a um lançamento financeiro.\n\n` +
      `*#{{aprovacao_id}}* - {{titulo}}\n` +
      `Agenda: {{agenda_nome}}\n` +
      `Lançamento: {{lancamento}}\n` +
      `Solicitante: {{solicitante}}\n\n` +
      `Para responder:\n` +
      `✅ *aprovar {{aprovacao_id}}*\n` +
      `❌ *reprovar {{aprovacao_id}} [motivo]*\n\n` +
      `Acesse: {{link_item}}\n` +
      `Ou responda em: {{link_aprovacoes}}`,
  },
  {
    key: 'financeiro.lembrete_hoje',
    sistema: 'financeiro',
    titulo: 'Lembrete do dia',
    descricao: 'Resumo diário de lançamentos com vencimento hoje.',
    placeholders: ['total', 'data_referencia', 'link'],
    template:
      `*Portal WKL - Agenda Financeira*\n\n` +
      `Lembrete do dia.\n` +
      `Você possui {{total}} lançamento(s) com vencimento em {{data_referencia}}.\n\n` +
      `Acesse: {{link}}`,
  },
  {
    key: 'financeiro.lembrete_7dias',
    sistema: 'financeiro',
    titulo: 'Lembrete próximos 7 dias',
    descricao: 'Resumo de lançamentos com vencimento nos próximos 7 dias.',
    placeholders: ['total', 'link'],
    template:
      `*Portal WKL - Agenda Financeira*\n\n` +
      `Lembrete de próximos vencimentos.\n` +
      `Você possui {{total}} lançamento(s) com vencimento nos próximos 7 dias.\n\n` +
      `Acesse: {{link}}`,
  },
  {
    key: 'financeiro.lembrete_lancamento',
    sistema: 'financeiro',
    titulo: 'Lembrete de lançamento',
    descricao: 'Resumo de lançamentos a preparar com antecedência.',
    placeholders: ['total', 'dias', 'link'],
    template:
      `*Portal WKL - Agenda Financeira*\n\n` +
      `Lembrete de lançamento.\n` +
      `Você possui {{total}} lançamento(s) para preparar com antecedência de {{dias}} dia(s).\n\n` +
      `Acesse: {{link}}`,
  },
  {
    key: 'financeiro.conta_vencida_diario',
    sistema: 'financeiro',
    titulo: 'Resumo de vencidas',
    descricao: 'Resumo diário de lançamentos vencidos aguardando tratamento.',
    placeholders: ['total', 'link'],
    template:
      `*Portal WKL - Agenda Financeira*\n\n` +
      `Resumo de vencidas.\n` +
      `Você possui {{total}} lançamento(s) vencido(s) aguardando tratamento.\n\n` +
      `Acesse: {{link}}`,
  },
  {
    key: 'contabil.evento_padrao',
    sistema: 'contabil',
    titulo: 'Eventos da Agenda Contábil',
    descricao: 'Modelo usado para criação, edição, pagamento e vencimento de itens contábeis.',
    placeholders: ['evento_label', 'titulo_item', 'agenda_nome', 'valor', 'vencimento', 'link'],
    template:
      `*Portal WKL - Agenda Contábil*\n\n` +
      `Você recebeu uma atualização em um item contábil.\n\n` +
      `Evento: {{evento_label}}\n` +
      `Título: {{titulo_item}}\n` +
      `Agenda: {{agenda_nome}}\n` +
      `Valor: {{valor}}\n` +
      `Vencimento: {{vencimento}}\n\n` +
      `Acesse: {{link}}`,
  },
  {
    key: 'contatos.novo_contato',
    sistema: 'contatos',
    titulo: 'Novo contato',
    descricao: 'Mensagem enviada quando um contato é criado.',
    placeholders: ['nome', 'empresa', 'lista', 'link'],
    template:
      `*Portal WKL - Novo contato*\n\n` +
      `Nome: {{nome}}\n` +
      `Empresa: {{empresa}}\n` +
      `Lista: {{lista}}\n` +
      `Acesse: {{link}}`,
  },
  {
    key: 'patrimonio.evento_padrao',
    sistema: 'patrimonio',
    titulo: 'Eventos do Patrimônio',
    descricao: 'Modelo usado para cadastro, transferência, avaria e descarte.',
    placeholders: ['evento_label', 'codigo', 'descricao_item', 'responsavel_atual', 'novo_responsavel', 'link'],
    template:
      `*Portal WKL - Patrimônio*\n\n` +
      `Você recebeu uma atualização em um ativo.\n\n` +
      `Evento: {{evento_label}}\n` +
      `Código: {{codigo}}\n` +
      `Descrição: {{descricao_item}}\n` +
      `Responsável atual: {{responsavel_atual}}\n` +
      `Novo responsável: {{novo_responsavel}}\n\n` +
      `Acesse: {{link}}`,
  },
  {
    key: 'chamados.evento_padrao',
    sistema: 'chamados',
    titulo: 'Eventos dos Chamados',
    descricao: 'Modelo usado para notificações operacionais do módulo de chamados.',
    placeholders: ['evento_label', 'protocolo', 'setor', 'assunto', 'solicitante', 'link'],
    template:
      `*Portal WKL - Chamados*\n\n` +
      `Você recebeu uma atualização em um chamado.\n\n` +
      `Evento: {{evento_label}}\n` +
      `Protocolo: {{protocolo}}\n` +
      `Setor: {{setor}}\n` +
      `Assunto: {{assunto}}\n` +
      `Solicitante: {{solicitante}}\n\n` +
      `Acesse: {{link}}`,
  },
  {
    key: 'aprovacoes.nova_solicitacao',
    sistema: 'aprovacoes',
    titulo: 'Nova solicitação de aprovação',
    descricao: 'Mensagem principal enviada ao aprovador quando nasce uma nova aprovação.',
    placeholders: ['aprovador_nome', 'aprovacao_id', 'titulo', 'solicitante', 'objetivo', 'link_aprovacoes'],
    template:
      `*Portal WKL - Aprovação Pendente*\n\n` +
      `Olá, *{{aprovador_nome}}*! Você tem uma nova solicitação aguardando sua resposta.\n\n` +
      `*#{{aprovacao_id}}* - {{titulo}}\n` +
      `Solicitante: {{solicitante}}` +
      `{{objetivo}}\n\n` +
      `Para responder:\n` +
      `✅ *aprovar {{aprovacao_id}}*\n` +
      `❌ *reprovar {{aprovacao_id}} [motivo]*\n\n` +
      `Acesse também: {{link_aprovacoes}}`,
  },
  {
    key: 'aprovacoes.lembrete_pendente',
    sistema: 'aprovacoes',
    titulo: 'Lembrete de aprovação pendente',
    descricao: 'Mensagem enviada quando a aprovação ainda aguarda resposta.',
    placeholders: ['aprovacao_id', 'titulo', 'solicitante', 'objetivo', 'link_aprovacoes'],
    template:
      `*Portal WKL - Lembrete: Aprovação Pendente*\n\n` +
      `Você ainda tem uma solicitação aguardando sua resposta:\n\n` +
      `*#{{aprovacao_id}}* - {{titulo}}\n` +
      `Solicitante: {{solicitante}}` +
      `{{objetivo}}\n\n` +
      `Para responder:\n` +
      `✅ *aprovar {{aprovacao_id}}*\n` +
      `❌ *reprovar {{aprovacao_id}} [motivo]*\n\n` +
      `Acesse também: {{link_aprovacoes}}`,
  },
  {
    key: 'aprovacoes.cron_pendentes',
    sistema: 'aprovacoes',
    titulo: 'Resumo diário de pendências',
    descricao: 'Lembrete diário consolidado para aprovadores pendentes.',
    placeholders: ['nome', 'total', 'link_aprovacoes'],
    template:
      `*Portal WKL - Aprovações pendentes*\n\n` +
      `Olá, {{nome}}.\n` +
      `Você possui {{total}} aprovação(ões) pendente(s).\n` +
      `Acesse: {{link_aprovacoes}}\n` +
      `Ou responda diretamente no WhatsApp com:\n` +
      `✅ *aprovar ID*\n` +
      `❌ *reprovar ID [motivo]*`,
  },
];

function normalizarValorTemplate(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor);
}

function normalizarVariaveis(variaveis = {}) {
  const resultado = {};
  Object.entries(variaveis).forEach(([chave, valor]) => {
    resultado[chave] = normalizarValorTemplate(valor);
  });
  return resultado;
}

function interpolarTemplate(template, variaveis = {}) {
  const mapa = normalizarVariaveis(variaveis);
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, chave) => {
    return Object.prototype.hasOwnProperty.call(mapa, chave) ? mapa[chave] : '';
  });
}

function obterTemplatePadraoPorChave(chave) {
  return WHATSAPP_MESSAGE_CATALOG.find((item) => item.key === chave) || null;
}

async function carregarTemplatesWhatsApp(pool) {
  const config = await carregarConfigWhatsApp(pool);
  return WHATSAPP_MESSAGE_CATALOG.map((item) => ({
    ...item,
    configKey: `wpp.msg.${item.key}`,
    valorSalvo: String(config[`wpp.msg.${item.key}`] || ''),
  }));
}

async function renderizarMensagemWhatsApp(pool, chave, variaveis = {}, fallbackTemplate = '') {
  const config = await carregarConfigWhatsApp(pool);
  const padrao = obterTemplatePadraoPorChave(chave);
  const template = String(
    config[`wpp.msg.${chave}`] ||
    padrao?.template ||
    fallbackTemplate ||
    ''
  );
  return interpolarTemplate(template, variaveis);
}

module.exports = {
  WHATSAPP_MESSAGE_CATALOG,
  carregarTemplatesWhatsApp,
  obterTemplatePadraoPorChave,
  interpolarTemplate,
  renderizarMensagemWhatsApp,
};
