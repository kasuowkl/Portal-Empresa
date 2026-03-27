const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'bot-config.json');

const DEFAULTS = {
  saudacao: '{periodo}, *{nome}*! Bem-vindo ao *Portal WKL* via WhatsApp.',
  menuPrincipal: `*Portal WKL — Menu Principal*

Escolha uma opção digitando o *número*:

*1* - Aprovações pendentes
*2* - Últimas 10 aprovadas
*3* - Últimas 10 reprovadas
*4* - Todas minhas aprovações
*5* - Detalhar aprovação
*6* - Aprovar solicitação
*7* - Reprovar solicitação
*0* - Exibir este menu

_Ou use os comandos diretos:_
_aprovar <id> | reprovar <id> [motivo] | detalhar <id>_`,
  naoVinculado: '⚠️ Seu número não está vinculado ao Portal WKL.\nContate o administrador para cadastrar seu WhatsApp.',
  erroInterno: '⚠️ Erro interno: {erro}\n\nDigite *0* para voltar ao menu.',
  erroGenerico: '⚠️ Erro: {detalhe}\n\nDigite *0* para voltar ao menu.',
  nenhumaPendente: '✅ Nenhuma aprovação pendente para você.\n\nDigite *0* para voltar ao menu.',
  nenhumaAprovada: 'Nenhuma aprovação com status *Aprovado* encontrada.\n\nDigite *0* para voltar ao menu.',
  nenhumaReprovada: 'Nenhuma aprovação com status *Reprovado* encontrada.\n\nDigite *0* para voltar ao menu.',
  nenhumaEncontrada: 'Nenhuma aprovação encontrada.\n\nDigite *0* para voltar ao menu.',
  aprovadoSucesso: '✅ Aprovação *#{id}* aprovada com sucesso!{status}\n\nDigite *1* para ver pendentes ou *0* para o menu.',
  reprovadoSucesso: '❌ Aprovação *#{id}* reprovada.{motivo}{status}\n\nDigite *1* para ver pendentes ou *0* para o menu.',
  informeIdAprovar: 'Informe o ID da aprovação:\n*aprovar <id>*\n\nDigite *1* para ver pendentes ou *0* para o menu.',
  informeIdReprovar: 'Informe o ID e motivo:\n*reprovar <id> [motivo]*\n\nDigite *1* para ver pendentes ou *0* para o menu.',
  informeIdDetalhar: 'Informe o ID da aprovação:\n*detalhar <id>*\n\nDigite *0* para voltar ao menu.',
  saudacoes: ['oi', 'ola', 'olá', 'hello', 'hi', 'hey', 'bom dia', 'boa tarde', 'boa noite', 'e ai', 'eai', 'fala'],
};

let _config = null;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      _config = { ...DEFAULTS, ...raw };
    } else {
      _config = { ...DEFAULTS };
      saveConfig(_config);
    }
  } catch (e) {
    console.error('[botConfig] erro ao carregar:', e.message);
    _config = { ...DEFAULTS };
  }
  return _config;
}

function getConfig() {
  if (!_config) loadConfig();
  return _config;
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    _config = { ...DEFAULTS, ...cfg };
  } catch (e) {
    console.error('[botConfig] erro ao salvar:', e.message);
    throw e;
  }
}

function reloadConfig() {
  _config = null;
  return getConfig();
}

function getDefaults() {
  return { ...DEFAULTS };
}

// Interpolação simples: substitui {chave} por valor
function interpolate(template, vars) {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), val ?? '');
  }
  return result;
}

module.exports = { getConfig, saveConfig, reloadConfig, getDefaults, interpolate };
