/**
 * ARQUIVO: portal.js
 * VERSÃO:  1.3.0
 * DATA:    2026-03-13
 * DESCRIÇÃO: Servidor principal do Portal de Sistemas e Serviços
 *
 * HISTÓRICO:
 * 1.0.0 - 2026-03-02 - Versão inicial
 * 1.1.0 - 2026-03-03 - Adicionadas rotas da Agenda de Tarefas
 * 1.2.0 - 2026-03-04 - Adicionadas rotas do sistema de Chamados
 * 1.3.0 - 2026-03-13 - Adicionadas rotas do sistema de Aprovações
 */

// ============================================================
// CARREGA AS CONFIGURAÇÕES DO ARQUIVO .env
// ============================================================
require('dotenv').config();

const express        = require('express');
const session        = require('express-session');
const path           = require('path');
const fs             = require('fs');
const winston        = require('winston');
const { criarBancoPortal, getPool }     = require('./criarBancoPortal');
const { iniciarCronFinanceiro }         = require('./services/cronFinanceiro');
const { iniciarCronAprovacoes }         = require('./services/cronAprovacoes');
const { iniciarCronCalendarios }        = require('./services/cronCalendarios');
const { criarMssqlSessionStore }        = require('./services/sessionStore');

const app   = express();
const PORTA = process.env.PORTA_APP || 3000;

// ============================================================
// CONFIGURAÇÃO DOS LOGS (winston)
// ============================================================

// Garante que a pasta logs existe
if (!fs.existsSync('./logs')) {
  fs.mkdirSync('./logs');
}

const logAtividade = winston.createLogger({
  transports: [
    new winston.transports.File({ filename: './logs/atividade.log' }),
    new winston.transports.Console()
  ],
  format: winston.format.combine(
    winston.format.timestamp({ format: 'DD/MM/YYYY HH:mm:ss' }),
    winston.format.printf(({ timestamp, message }) => `[${timestamp}] ${message}`)
  )
});

const logErro = winston.createLogger({
  transports: [
    new winston.transports.File({ filename: './logs/erros.log' }),
    new winston.transports.Console()
  ],
  format: winston.format.combine(
    winston.format.timestamp({ format: 'DD/MM/YYYY HH:mm:ss' }),
    winston.format.printf(({ timestamp, message }) => `[${timestamp}] ERRO: ${message}`)
  )
});

// Disponibiliza os loggers globalmente para uso nas rotas
app.locals.logAtividade = logAtividade;
app.locals.logErro      = logErro;

// ============================================================
// MIDDLEWARES PRINCIPAIS
// ============================================================

// Interpreta JSON e dados de formulários HTML
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve os arquivos estáticos da pasta public/ (HTML, CSS, JS, imagens)
app.use(express.static(path.join(__dirname, 'public')));

// Configura sessão de login (store persistente no MSSQL — sobrevive ao restart do PM2)
app.use(session({
  store:             criarMssqlSessionStore(session, app.locals),
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000  // Sessão expira em 8 horas
  }
}));

// ============================================================
// ROTAS
// ============================================================

// Redireciona a raiz "/" para a página de login
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Rotas de autenticação: POST /login | GET /logout
const rotasAuth   = require('./routes/auth');
app.use('/', rotasAuth);

// Rotas do portal: GET /portal | /sistemas | /servicos | /configuracoes
const rotasPortal = require('./routes/portal');
app.use('/', rotasPortal);

// Rotas da Agenda de Tarefas: GET /agenda | /api/agenda/*
const rotasAgenda = require('./routes/agenda');
app.use('/', rotasAgenda);

// Rotas da Agenda Financeira: GET /agendaFinanceira | /api/financeiro/*
const rotasFinanceiro = require('./routes/financeiro');
app.use('/', rotasFinanceiro);

// Rotas do sistema de Chamados: GET /chamados | /api/chamados/*
const rotasChamados = require('./routes/chamados');
app.use('/', rotasChamados);

// Rotas do Patrimônio: GET /patrimonio | /api/patrimonio/*
const rotasPatrimonio = require('./routes/patrimonio');
app.use('/', rotasPatrimonio);

// Rotas da Agenda de Contatos: GET /contatos | /api/contatos/*
const rotasContatos = require('./routes/contatos');
app.use('/', rotasContatos);

// Rotas do sistema de Aprovações: GET /aprovacoes | /api/aprovacoes/*
const rotasAprovacoes = require('./routes/aprovacoes');
app.use('/', rotasAprovacoes);

// Rotas da Agenda de Calendários: GET /agendaCalendarios | /api/calendarios/*
const rotasCalendarios = require('./routes/calendarios');
app.use('/', rotasCalendarios);

// ============================================================
// TRATAMENTO DE ERROS GERAIS
// ============================================================
app.use((erro, req, res, next) => {
  logErro.error(`${erro.message} | Rota: ${req.path} | Stack: ${erro.stack}`);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

// ============================================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================================
async function iniciarServidor() {
  try {
    // 1. Configura o banco de dados (cria tabelas e admin se necessário)
    console.log('Iniciando configuração do banco de dados...');
    await criarBancoPortal();

    // 2. Disponibiliza o pool de conexão para as rotas
    app.locals.pool = getPool();

    // 3. Inicia os agendadores de lembretes e sincronizações
    iniciarCronFinanceiro(app.locals.pool);
    iniciarCronAprovacoes(app.locals.pool);
    iniciarCronCalendarios(app.locals);

    // 4. Inicia o servidor HTTP
    app.listen(PORTA, () => {
      console.log(`\nPortal de Sistemas rodando em: http://192.168.0.80:${PORTA}`);
      console.log('Login: admin | Senha: admin');
      console.log('Pressione Ctrl+C para encerrar.\n');
      logAtividade.info('Servidor iniciado na porta ' + PORTA);
    });

  } catch (erro) {
    logErro.error('Falha ao iniciar o servidor: ' + erro.message);
    process.exit(1);
  }
}

iniciarServidor();
