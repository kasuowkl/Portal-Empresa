/**
 * ARQUIVO: criarBancoPortal.js
 * VERSÃO:  2.2.0
 * DATA:    2026-03-26
 * DESCRIÇÃO: Criação do banco de dados, tabelas e dados iniciais do Portal
 *
 * HISTÓRICO:
 * 1.0.0 - 2026-03-02 - Versão inicial
 * 1.1.0 - 2026-03-03 - Adicionada tabela configuracoes
 * 1.1.1 - 2026-03-03 - Corrigido pool reconectando com database fixo
 * 1.2.0 - 2026-03-03 - Adicionadas tabelas da Agenda de Tarefas
 * 1.3.0 - 2026-03-04 - Adicionadas tabelas do sistema de Chamados
 * 1.4.0 - 2026-03-06 - Adicionadas tabelas do Patrimônio (pat_bens, pat_historico)
 * 1.5.0 - 2026-03-09 - Adicionadas tabelas pat_categorias, pat_unidades, pat_permissoes
 * 1.6.0 - 2026-03-09 - Adicionadas tabelas da Agenda de Contatos
 * 1.7.0 - 2026-03-13 - Adicionadas tabelas do sistema de Aprovações
 * 1.8.0 - 2026-03-16 - Adicionada tabela aprovacoes_observadores
 * 1.9.0 - 2026-03-16 - Adicionada tabela aprovacoes_anexos
 * 2.0.0 - 2026-03-16 - Colunas tipo_consenso e consenso_valor em aprovacoes
 * 2.1.0 - 2026-03-23 - Adicionadas tabelas do módulo Calendários (cal_agendas, cal_membros, cal_eventos, cal_caldav_config)
 * 2.2.0 - 2026-03-26 - Coluna whatsapp em usuarios_dominio e usuarios (integração WhatsApp)
 * 2.3.0 - 2026-03-26 - Coluna visivel_usuarios em sistemas (controle de visibilidade por nível)
 */

require('dotenv').config();
const sql    = require('mssql');
const bcrypt = require('bcryptjs');

// ============================================================
// CONFIGURAÇÃO DE CONEXÃO COM O SQL SERVER
// ============================================================
const configConexao = {
  server: process.env.DB_SERVER,
  port:   parseInt(process.env.DB_PORT),
  user:   process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// ============================================================
// USUÁRIO ADMINISTRADOR PERMANENTE (HARDCODED)
// ============================================================
const ADMIN_USUARIO = 'admin';
const ADMIN_SENHA   = 'admin';
const ADMIN_NOME    = 'Administrador do Sistema';
const ADMIN_NIVEL   = 'admin';

// Pool de conexão global (exportado para uso em portal.js)
let pool = null;

// ============================================================
// FUNÇÃO PRINCIPAL — chamada por portal.js na inicialização
// ============================================================
async function criarBancoPortal() {
  try {
    console.log('Conectando ao SQL Server...');

    // 1. Conecta sem banco específico para poder criar o banco
    const poolInicial = new sql.ConnectionPool(configConexao);
    await poolInicial.connect();
    console.log('Conectado ao SQL Server!');

    await criarBanco(poolInicial);
    await poolInicial.close();

    // 2. Reconecta especificando o banco — todas as conexões do pool usarão PortalSistemas
    pool = new sql.ConnectionPool({ ...configConexao, database: process.env.DB_NAME });
    await pool.connect();

    // 3. Criar tabelas (se não existirem)
    await criarTabelas(pool);

    // 4. Inserir admin e sistemas de exemplo
    await inserirDadosIniciais(pool);

    console.log('\nBanco de dados configurado com sucesso!');
    return pool;

  } catch (erro) {
    console.error('Erro ao configurar banco de dados:', erro.message);
    throw erro;
  }
}

// ============================================================
// CRIAR BANCO DE DADOS
// ============================================================
async function criarBanco(pool) {
  console.log(`\nVerificando banco "${process.env.DB_NAME}"...`);

  await pool.request().query(`
    IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = '${process.env.DB_NAME}')
    BEGIN
      CREATE DATABASE ${process.env.DB_NAME}
    END
  `);

  console.log(`Banco "${process.env.DB_NAME}" pronto.`);
}

// ============================================================
// CRIAR TABELAS
// ============================================================
async function criarTabelas(pool) {
  console.log('\nCriando tabelas...');

  // Tabela: usuarios
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='usuarios' AND xtype='U')
    BEGIN
      CREATE TABLE usuarios (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        nome       VARCHAR(100)  NOT NULL,
        usuario    VARCHAR(50)   NOT NULL UNIQUE,
        senha_hash VARCHAR(255)  NOT NULL,
        nivel      VARCHAR(20)   NOT NULL DEFAULT 'usuario',
        ativo      BIT           NOT NULL DEFAULT 1,
        criado_em  DATETIME      NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: usuarios — OK');

  // Tabela: sistemas
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='sistemas' AND xtype='U')
    BEGIN
      CREATE TABLE sistemas (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        nome      VARCHAR(100)  NOT NULL,
        url       VARCHAR(255)  NOT NULL,
        icone     VARCHAR(50)   NOT NULL DEFAULT 'fa-window-maximize',
        descricao VARCHAR(255),
        ativo     BIT           NOT NULL DEFAULT 1
      )
    END
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'nova_aba' AND Object_ID = Object_ID(N'sistemas'))
      ALTER TABLE sistemas ADD nova_aba BIT NOT NULL DEFAULT 0
  `);
  console.log('  Tabela: sistemas — OK');

  // Tabela: servicos
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='servicos' AND xtype='U')
    BEGIN
      CREATE TABLE servicos (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        nome      VARCHAR(100)  NOT NULL,
        url       VARCHAR(255)  NOT NULL,
        icone     VARCHAR(50)   NOT NULL DEFAULT 'fa-cogs',
        descricao VARCHAR(255),
        nova_aba  BIT           NOT NULL DEFAULT 0,
        ativo     BIT           NOT NULL DEFAULT 1
      )
    END
  `);
  console.log('  Tabela: servicos — OK');

  // Tabela: logs_atividade
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='logs_atividade' AND xtype='U')
    BEGIN
      CREATE TABLE logs_atividade (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        usuario   VARCHAR(50)   NOT NULL,
        acao      VARCHAR(100)  NOT NULL,
        ip        VARCHAR(50),
        data_hora DATETIME      NOT NULL DEFAULT GETDATE(),
        detalhes  VARCHAR(500)
      )
    END
  `);
  // Migração: adiciona coluna 'sistema' se não existir
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME='logs_atividade' AND COLUMN_NAME='sistema'
    )
    ALTER TABLE logs_atividade ADD sistema VARCHAR(50) NOT NULL DEFAULT 'portal'
  `);
  console.log('  Tabela: logs_atividade — OK');

  // Tabela: logs_erro
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='logs_erro' AND xtype='U')
    BEGIN
      CREATE TABLE logs_erro (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        origem    VARCHAR(100)  NOT NULL,
        mensagem  VARCHAR(500)  NOT NULL,
        stack     VARCHAR(MAX),
        data_hora DATETIME      NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: logs_erro — OK');

  // Tabela: configuracoes (chave-valor para Telegram, Email, Segurança, AD)
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='configuracoes' AND xtype='U')
    BEGIN
      CREATE TABLE configuracoes (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        chave     VARCHAR(100)  NOT NULL UNIQUE,
        valor     VARCHAR(500),
        grupo     VARCHAR(50)   NOT NULL,
        descricao VARCHAR(200)
      )
    END
  `);
  console.log('  Tabela: configuracoes — OK');

  // Tabela: sessions (sessões persistentes — sobrevive ao restart do PM2)
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='sessions' AND xtype='U')
    BEGIN
      CREATE TABLE sessions (
        sid     VARCHAR(255) NOT NULL PRIMARY KEY,
        sess    VARCHAR(MAX) NOT NULL,
        expire  DATETIME     NOT NULL
      )
    END
  `);
  // Limpa sessões expiradas ao iniciar
  await pool.request().query(`DELETE FROM sessions WHERE expire < GETDATE()`);
  console.log('  Tabela: sessions — OK');

  // Tabela: usuarios_dominio (usuários do AD com acesso ao portal)
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='usuarios_dominio' AND xtype='U')
    BEGIN
      CREATE TABLE usuarios_dominio (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        login        VARCHAR(100)  NOT NULL UNIQUE,
        nome         VARCHAR(200),
        email        VARCHAR(200),
        departamento VARCHAR(200),
        nivel        VARCHAR(20)   NOT NULL DEFAULT 'usuario',
        ativo        BIT           NOT NULL DEFAULT 1,
        criado_em    DATETIME      NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: usuarios_dominio — OK');

  // ── Agenda de Tarefas ─────────────────────────────────────

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='agenda_listas' AND xtype='U')
    BEGIN
      CREATE TABLE agenda_listas (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        nome      VARCHAR(100)  NOT NULL,
        descricao VARCHAR(500),
        cor       VARCHAR(20)   NOT NULL DEFAULT '#3b82f6',
        dono      VARCHAR(100)  NOT NULL,
        criado_em DATETIME      NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: agenda_listas — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='agenda_membros' AND xtype='U')
    BEGIN
      CREATE TABLE agenda_membros (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        lista_id      INT          NOT NULL REFERENCES agenda_listas(id),
        usuario       VARCHAR(100) NOT NULL,
        permissao     VARCHAR(10)  NOT NULL DEFAULT 'leitura',
        adicionado_em DATETIME     NOT NULL DEFAULT GETDATE(),
        UNIQUE (lista_id, usuario)
      )
    END
  `);
  console.log('  Tabela: agenda_membros — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='agenda_categorias' AND xtype='U')
    BEGIN
      CREATE TABLE agenda_categorias (
        id       INT IDENTITY(1,1) PRIMARY KEY,
        lista_id INT         NOT NULL REFERENCES agenda_listas(id),
        nome     VARCHAR(50) NOT NULL,
        cor      VARCHAR(20) NOT NULL DEFAULT '#6b7280'
      )
    END
  `);
  console.log('  Tabela: agenda_categorias — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='agenda_tarefas' AND xtype='U')
    BEGIN
      CREATE TABLE agenda_tarefas (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        lista_id      INT          NOT NULL REFERENCES agenda_listas(id),
        titulo        VARCHAR(200) NOT NULL,
        descricao     VARCHAR(MAX),
        prazo         DATE,
        prioridade    VARCHAR(10)  NOT NULL DEFAULT 'media',
        status        VARCHAR(20)  NOT NULL DEFAULT 'a_fazer',
        categoria_id  INT          REFERENCES agenda_categorias(id),
        criado_por    VARCHAR(100) NOT NULL,
        criado_em     DATETIME     NOT NULL DEFAULT GETDATE(),
        atualizado_em DATETIME     NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: agenda_tarefas — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='agenda_passos' AND xtype='U')
    BEGIN
      CREATE TABLE agenda_passos (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        tarefa_id INT          NOT NULL REFERENCES agenda_tarefas(id),
        texto     VARCHAR(500) NOT NULL,
        concluido BIT          NOT NULL DEFAULT 0,
        ordem     INT          NOT NULL DEFAULT 0,
        criado_em DATETIME     NOT NULL DEFAULT GETDATE(),
        executado_por VARCHAR(100),
        executado_em DATETIME,
        atribuido_para VARCHAR(MAX)
      )
    END
  `);
  // Adicionar colunas se a tabela já existir
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'executado_por' AND Object_ID = Object_ID(N'agenda_passos'))
      ALTER TABLE agenda_passos ADD executado_por VARCHAR(100)
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'executado_em' AND Object_ID = Object_ID(N'agenda_passos'))
      ALTER TABLE agenda_passos ADD executado_em DATETIME
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'atribuido_para' AND Object_ID = Object_ID(N'agenda_passos'))
      ALTER TABLE agenda_passos ADD atribuido_para VARCHAR(MAX)
    ELSE
      ALTER TABLE agenda_passos ALTER COLUMN atribuido_para VARCHAR(MAX)
  `);
  console.log('  Tabela: agenda_passos — OK');

  // ── Agenda Financeira ──────────────────────────────────────

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='fin_agendas' AND xtype='U')
    BEGIN
      CREATE TABLE fin_agendas (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        nome      VARCHAR(100)  NOT NULL,
        descricao VARCHAR(500),
        cor       VARCHAR(20)   NOT NULL DEFAULT '#3b82f6',
        dono      VARCHAR(100)  NOT NULL,
        criado_em DATETIME      NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: fin_agendas — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='fin_membros' AND xtype='U')
    BEGIN
      CREATE TABLE fin_membros (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        agenda_id     INT          NOT NULL REFERENCES fin_agendas(id),
        usuario       VARCHAR(100) NOT NULL,
        permissao     VARCHAR(10)  NOT NULL DEFAULT 'leitura',
        adicionado_em DATETIME     NOT NULL DEFAULT GETDATE(),
        UNIQUE (agenda_id, usuario)
      )
    END
  `);
  console.log('  Tabela: fin_membros — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='fin_categorias' AND xtype='U')
    BEGIN
      CREATE TABLE fin_categorias (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        agenda_id INT         NOT NULL REFERENCES fin_agendas(id),
        nome      VARCHAR(50) NOT NULL
      )
    END
  `);
  console.log('  Tabela: fin_categorias — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='fin_contas' AND xtype='U')
    BEGIN
      CREATE TABLE fin_contas (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        agenda_id      INT            NOT NULL REFERENCES fin_agendas(id),
        descricao      VARCHAR(200)   NOT NULL,
        valor          DECIMAL(15,2)  NOT NULL DEFAULT 0,
        data           DATE,
        categoria      VARCHAR(100)   NOT NULL DEFAULT 'Geral',
        empresa        VARCHAR(100),
        frequencia     VARCHAR(50)    NOT NULL DEFAULT 'Única',
        status         VARCHAR(20)    NOT NULL DEFAULT 'pendente',
        recorrencia_id VARCHAR(100),
        eh_pai         BIT            NOT NULL DEFAULT 0,
        criado_por     VARCHAR(100)   NOT NULL,
        criado_em      DATETIME       NOT NULL DEFAULT GETDATE(),
        atualizado_em  DATETIME       NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  // Adiciona coluna empresa se já existia antes desta versão
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('fin_contas') AND name='empresa')
      ALTER TABLE fin_contas ADD empresa VARCHAR(100)
  `);
  console.log('  Tabela: fin_contas — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='fin_empresas' AND xtype='U')
    BEGIN
      CREATE TABLE fin_empresas (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        agenda_id INT         NOT NULL REFERENCES fin_agendas(id),
        nome      VARCHAR(100) NOT NULL
      )
    END
  `);
  console.log('  Tabela: fin_empresas — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='fin_logs' AND xtype='U')
    BEGIN
      CREATE TABLE fin_logs (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        agenda_id INT          NOT NULL REFERENCES fin_agendas(id),
        conta_id  INT,
        acao      VARCHAR(20)  NOT NULL,
        detalhes  VARCHAR(500),
        usuario   VARCHAR(100) NOT NULL,
        data_hora DATETIME     NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: fin_logs — OK');

  // ── Sistema de Chamados ────────────────────────────────────

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='chamados_setores' AND xtype='U')
    BEGIN
      CREATE TABLE chamados_setores (
        id   INT IDENTITY(1,1) PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        CONSTRAINT uq_cham_setor UNIQUE (nome)
      )
    END
  `);
  console.log('  Tabela: chamados_setores — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='chamados_perfis' AND xtype='U')
    BEGIN
      CREATE TABLE chamados_perfis (
        login   VARCHAR(100) NOT NULL PRIMARY KEY,
        cargo   VARCHAR(20)  NOT NULL DEFAULT 'SOLICITANTE',
        setores VARCHAR(MAX)
      )
    END
  `);
  console.log('  Tabela: chamados_perfis — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='chamados' AND xtype='U')
    BEGIN
      CREATE TABLE chamados (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        protocolo         VARCHAR(20)   NOT NULL,
        login_solicitante VARCHAR(100)  NOT NULL,
        nome_solicitante  VARCHAR(200),
        setor             VARCHAR(100)  NOT NULL,
        assunto           VARCHAR(200)  NOT NULL,
        detalhe           VARCHAR(MAX),
        status            VARCHAR(30)   NOT NULL DEFAULT 'Aberto',
        login_atendedor   VARCHAR(100),
        nome_atendedor    VARCHAR(200),
        aprovador_login   VARCHAR(100),
        status_aprovacao  VARCHAR(20),
        chamado_pai_id    INT           REFERENCES chamados(id),
        anexo_nome        VARCHAR(200),
        anexo_base64      VARCHAR(MAX),
        criado_em         DATETIME      NOT NULL DEFAULT GETDATE(),
        atualizado_em     DATETIME      NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: chamados — OK');

  // Colunas de soft-delete (adicionadas após criação inicial)
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('chamados') AND name='excluido')
      ALTER TABLE chamados ADD excluido BIT NOT NULL DEFAULT 0;
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('chamados') AND name='excluido_em')
      ALTER TABLE chamados ADD excluido_em DATETIME NULL;
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('chamados') AND name='excluido_por')
      ALTER TABLE chamados ADD excluido_por VARCHAR(100) NULL;
  `);
  console.log('  Colunas soft-delete (chamados) — OK');

  // Coluna bloqueado (adicionada para suporte a chamados vinculados)
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('chamados') AND name='bloqueado')
      ALTER TABLE chamados ADD bloqueado BIT NOT NULL DEFAULT 0;
  `);
  console.log('  Coluna bloqueado (chamados) — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='chamados_historico' AND xtype='U')
    BEGIN
      CREATE TABLE chamados_historico (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        chamado_id INT          NOT NULL REFERENCES chamados(id),
        login      VARCHAR(100) NOT NULL,
        narrativa  VARCHAR(500) NOT NULL,
        msg        VARCHAR(MAX),
        criado_em  DATETIME     NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: chamados_historico — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='chamados_contadores' AND xtype='U')
    BEGIN
      CREATE TABLE chamados_contadores (
        setor VARCHAR(100) NOT NULL PRIMARY KEY,
        cont  INT          NOT NULL DEFAULT 0
      )
    END
  `);
  console.log('  Tabela: chamados_contadores — OK');

  // ── Patrimônio ─────────────────────────────────────────────

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='pat_bens' AND xtype='U')
    BEGIN
      CREATE TABLE pat_bens (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        codigo        VARCHAR(50)    NOT NULL,
        descricao     VARCHAR(200)   NOT NULL,
        categoria     VARCHAR(50),
        marca         VARCHAR(100),
        num_serie     VARCHAR(100),
        fornecedor    VARCHAR(150),
        nota_fiscal   VARCHAR(50),
        data_compra   DATE,
        valor         DECIMAL(10,2),
        loc_tipo      VARCHAR(50),
        loc_detalhe   VARCHAR(200),
        loc_obs       VARCHAR(500),
        estado        VARCHAR(20)    NOT NULL DEFAULT 'Bom',
        status        VARCHAR(30)    NOT NULL DEFAULT 'Ativo',
        fotos         VARCHAR(MAX),
        criado_por    VARCHAR(100)   NOT NULL,
        criado_em     DATETIME       NOT NULL DEFAULT GETDATE(),
        atualizado_em DATETIME       NOT NULL DEFAULT GETDATE(),
        CONSTRAINT uq_pat_codigo UNIQUE (codigo)
      )
    END
  `);
  console.log('  Tabela: pat_bens — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='pat_historico' AND xtype='U')
    BEGIN
      CREATE TABLE pat_historico (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        bem_id         INT          NOT NULL REFERENCES pat_bens(id),
        data_evt       DATE         NOT NULL,
        tipo           VARCHAR(50)  NOT NULL,
        detalhe        VARCHAR(500),
        resp           VARCHAR(100),
        registrado_por VARCHAR(100),
        registrado_em  DATETIME     NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: pat_historico — OK');

  // Colunas adicionais pat_bens
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('pat_bens') AND name='responsavel_atual')
      ALTER TABLE pat_bens ADD responsavel_atual VARCHAR(150) NULL;
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('pat_bens') AND name='setor_atual')
      ALTER TABLE pat_bens ADD setor_atual VARCHAR(100) NULL;
  `);
  console.log('  Colunas responsavel_atual/setor_atual (pat_bens) — OK');

  // Colunas adicionais pat_historico
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('pat_historico') AND name='responsavel_de')
      ALTER TABLE pat_historico ADD responsavel_de VARCHAR(150) NULL;
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('pat_historico') AND name='responsavel_para')
      ALTER TABLE pat_historico ADD responsavel_para VARCHAR(150) NULL;
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('pat_historico') AND name='setor_destino')
      ALTER TABLE pat_historico ADD setor_destino VARCHAR(100) NULL;
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('pat_historico') AND name='numero_termo')
      ALTER TABLE pat_historico ADD numero_termo VARCHAR(30) NULL;
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('pat_historico') AND name='novo_estado')
      ALTER TABLE pat_historico ADD novo_estado VARCHAR(20) NULL;
  `);
  console.log('  Colunas extras (pat_historico) — OK');

  // Tabela: pat_categorias
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='pat_categorias' AND xtype='U')
    BEGIN
      CREATE TABLE pat_categorias (
        id    INT IDENTITY(1,1) PRIMARY KEY,
        nome  VARCHAR(80) NOT NULL UNIQUE
      )
      INSERT INTO pat_categorias (nome) VALUES
        ('Informática'),('Móveis'),('Veículos'),('Máquinas'),('Ferramentas'),('Outros')
    END
  `);
  console.log('  Tabela: pat_categorias — OK');

  // Tabela: pat_unidades
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='pat_unidades' AND xtype='U')
    BEGIN
      CREATE TABLE pat_unidades (
        id    INT IDENTITY(1,1) PRIMARY KEY,
        nome  VARCHAR(80) NOT NULL UNIQUE
      )
      INSERT INTO pat_unidades (nome) VALUES
        ('Matriz'),('Filial'),('Obra'),('Armazém'),('Externo / Home Office')
    END
  `);
  console.log('  Tabela: pat_unidades — OK');

  // Tabela: pat_permissoes
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='pat_permissoes' AND xtype='U')
    BEGIN
      CREATE TABLE pat_permissoes (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        usuario   VARCHAR(100) NOT NULL UNIQUE,
        nivel     VARCHAR(20)  NOT NULL DEFAULT 'visualizar'
      )
    END
  `);
  console.log('  Tabela: pat_permissoes — OK');

  // ── Agenda de Contatos ────────────────────────────────────
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='contatos_listas' AND xtype='U')
    CREATE TABLE contatos_listas (
      id        INT IDENTITY(1,1) PRIMARY KEY,
      nome      VARCHAR(100) NOT NULL,
      descricao VARCHAR(500),
      cor       VARCHAR(20)  NOT NULL DEFAULT '#3b82f6',
      icone     VARCHAR(50)  NOT NULL DEFAULT 'fas fa-address-book',
      tipo      VARCHAR(20)  NOT NULL DEFAULT 'pessoal',
      dono      VARCHAR(100) NOT NULL,
      criado_em DATETIME     NOT NULL DEFAULT GETDATE()
    )
  `);
  // Migração: adiciona coluna tipo em instalações existentes
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('contatos_listas') AND name='tipo')
      ALTER TABLE contatos_listas ADD tipo VARCHAR(20) NOT NULL DEFAULT 'pessoal'
  `);
  // Migração: marca listas corporativas como empresa
  await pool.request().query(`
    UPDATE contatos_listas SET tipo = 'empresa' WHERE nome = 'Contatos Grupo AB' AND tipo = 'pessoal'
  `);
  console.log('  Tabela: contatos_listas — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='contatos_membros' AND xtype='U')
    CREATE TABLE contatos_membros (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      lista_id      INT          NOT NULL REFERENCES contatos_listas(id) ON DELETE CASCADE,
      usuario       VARCHAR(100) NOT NULL,
      permissao     VARCHAR(10)  NOT NULL DEFAULT 'leitura',
      adicionado_em DATETIME     NOT NULL DEFAULT GETDATE(),
      UNIQUE (lista_id, usuario)
    )
  `);
  console.log('  Tabela: contatos_membros — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='contatos' AND xtype='U')
    CREATE TABLE contatos (
      id                INT IDENTITY(1,1) PRIMARY KEY,
      lista_id          INT           NOT NULL REFERENCES contatos_listas(id) ON DELETE CASCADE,
      nome              VARCHAR(150)  NOT NULL,
      cargo             VARCHAR(100),
      empresa           VARCHAR(150),
      departamento      VARCHAR(100),
      -- Telefones
      cel_pessoal       VARCHAR(30),
      cel_corporativo   VARCHAR(30),
      tel_fixo          VARCHAR(30),
      tel_ramal         VARCHAR(20),
      whatsapp          VARCHAR(30),
      -- E-mails
      email_pessoal     VARCHAR(200),
      email_corporativo VARCHAR(200),
      -- Redes sociais
      linkedin          VARCHAR(300),
      facebook          VARCHAR(300),
      instagram         VARCHAR(150),
      twitter           VARCHAR(150),
      -- Profissional
      site              VARCHAR(300),
      cnpj_cpf          VARCHAR(30),
      -- Endereço
      endereco          VARCHAR(300),
      cidade            VARCHAR(100),
      estado            VARCHAR(50),
      cep               VARCHAR(10),
      pais              VARCHAR(100) DEFAULT 'Brasil',
      -- Extra
      data_nascimento   DATE,
      tags              VARCHAR(500),
      observacoes       VARCHAR(MAX),
      favorito          BIT          NOT NULL DEFAULT 0,
      -- Metadata
      criado_por        VARCHAR(100) NOT NULL,
      criado_em         DATETIME     NOT NULL DEFAULT GETDATE(),
      atualizado_em     DATETIME     NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log('  Tabela: contatos — OK');

  // ── Aprovações ──────────────────────────────────────────────
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='aprovacoes' AND xtype='U')
    BEGIN
      CREATE TABLE aprovacoes (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        titulo        VARCHAR(200)  NOT NULL,
        objetivo      VARCHAR(MAX),
        criado_por    VARCHAR(100)  NOT NULL,
        criado_por_nome VARCHAR(200),
        status        VARCHAR(20)   NOT NULL DEFAULT 'Pendente',
        criado_em     DATETIME      NOT NULL DEFAULT GETDATE(),
        atualizado_em DATETIME      NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='aprovacoes_participantes' AND xtype='U')
    BEGIN
      CREATE TABLE aprovacoes_participantes (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        aprovacao_id     INT          NOT NULL REFERENCES aprovacoes(id),
        aprovador_login  VARCHAR(100) NOT NULL,
        aprovador_nome   VARCHAR(200),
        decisao          VARCHAR(20)  NOT NULL DEFAULT 'Pendente',
        motivo           VARCHAR(500),
        respondido_em    DATETIME     NULL
      )
    END
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='aprovacoes_log' AND xtype='U')
    BEGIN
      CREATE TABLE aprovacoes_log (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        aprovacao_id INT          NOT NULL REFERENCES aprovacoes(id),
        usuario      VARCHAR(100) NOT NULL,
        acao         VARCHAR(200) NOT NULL,
        criado_em    DATETIME     NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='aprovacoes_observadores' AND xtype='U')
    BEGIN
      CREATE TABLE aprovacoes_observadores (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        aprovacao_id      INT          NOT NULL REFERENCES aprovacoes(id),
        observador_login  VARCHAR(100) NOT NULL,
        observador_nome   VARCHAR(200)
      )
    END
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='aprovacoes_anexos' AND xtype='U')
    BEGIN
      CREATE TABLE aprovacoes_anexos (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        aprovacao_id      INT           NOT NULL REFERENCES aprovacoes(id),
        nome_original     VARCHAR(255)  NOT NULL,
        tipo_mime         VARCHAR(100),
        tamanho           INT,
        dados_base64      VARCHAR(MAX)  NOT NULL,
        enviado_por       VARCHAR(100)  NOT NULL,
        enviado_por_nome  VARCHAR(200),
        enviado_em        DATETIME      NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  // Migração: adiciona colunas de consenso se ainda não existirem
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('aprovacoes') AND name = 'tipo_consenso')
      ALTER TABLE aprovacoes ADD tipo_consenso VARCHAR(30) NOT NULL DEFAULT 'unanimidade'
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('aprovacoes') AND name = 'consenso_valor')
      ALTER TABLE aprovacoes ADD consenso_valor INT NULL
  `);
  console.log('  Tabelas: aprovacoes — OK');

  // ── Calendários ──────────────────────────────────────────────
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='cal_agendas' AND xtype='U')
    BEGIN
      CREATE TABLE cal_agendas (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        nome      VARCHAR(100)  NOT NULL,
        cor       VARCHAR(20)   NOT NULL DEFAULT '#3b82f6',
        descricao VARCHAR(500),
        dono      VARCHAR(100)  NOT NULL,
        criado_em DATETIME      NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: cal_agendas — OK');

  // Colunas extras: google_cal_path e ical_url
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('cal_agendas') AND name = 'google_cal_path')
      ALTER TABLE cal_agendas ADD google_cal_path VARCHAR(500) NULL
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('cal_agendas') AND name = 'ical_url')
      ALTER TABLE cal_agendas ADD ical_url VARCHAR(500) NULL
  `);
  console.log('  Colunas extras (cal_agendas) — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='cal_membros' AND xtype='U')
    BEGIN
      CREATE TABLE cal_membros (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        agenda_id     INT          NOT NULL REFERENCES cal_agendas(id),
        usuario       VARCHAR(100) NOT NULL,
        permissao     VARCHAR(10)  NOT NULL DEFAULT 'leitura',
        adicionado_em DATETIME     NOT NULL DEFAULT GETDATE(),
        UNIQUE (agenda_id, usuario)
      )
    END
  `);
  console.log('  Tabela: cal_membros — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='cal_eventos' AND xtype='U')
    BEGIN
      CREATE TABLE cal_eventos (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        agenda_id     INT          NOT NULL REFERENCES cal_agendas(id),
        titulo        VARCHAR(200) NOT NULL,
        descricao     VARCHAR(MAX),
        inicio        DATETIME     NOT NULL,
        fim           DATETIME     NOT NULL,
        dia_inteiro   BIT          NOT NULL DEFAULT 0,
        cor           VARCHAR(20),
        recorrencia   VARCHAR(50),
        recorrencia_fim DATE,
        uid_caldav    VARCHAR(200),
        etag_caldav   VARCHAR(200),
        criado_por    VARCHAR(100) NOT NULL,
        criado_em     DATETIME     NOT NULL DEFAULT GETDATE(),
        atualizado_em DATETIME     NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: cal_eventos — OK');

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='cal_caldav_config' AND xtype='U')
    BEGIN
      CREATE TABLE cal_caldav_config (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        usuario     VARCHAR(100)  NOT NULL UNIQUE,
        email_google VARCHAR(200) NOT NULL,
        senha_app   VARCHAR(MAX)  NOT NULL,
        caldav_url  VARCHAR(500),
        sync_ativo  BIT           NOT NULL DEFAULT 1,
        ultimo_sync DATETIME,
        atualizado_em DATETIME    NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  console.log('  Tabela: cal_caldav_config — OK');

  // Coluna whatsapp em usuarios_dominio
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'whatsapp' AND Object_ID = Object_ID(N'usuarios_dominio'))
      ALTER TABLE usuarios_dominio ADD whatsapp VARCHAR(20) NULL
  `);
  // Coluna whatsapp em usuarios
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'whatsapp' AND Object_ID = Object_ID(N'usuarios'))
      ALTER TABLE usuarios ADD whatsapp VARCHAR(20) NULL
  `);
  console.log('  Coluna whatsapp em usuarios_dominio/usuarios — OK');

  // Coluna visivel_usuarios em sistemas
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'visivel_usuarios' AND Object_ID = Object_ID(N'sistemas'))
      ALTER TABLE sistemas ADD visivel_usuarios BIT NOT NULL DEFAULT 1
  `);
  await pool.request().query(`
    UPDATE sistemas SET visivel_usuarios = 1 WHERE visivel_usuarios IS NULL
  `);
  console.log('  Coluna visivel_usuarios em sistemas — OK');
}

// ============================================================
// INSERIR DADOS INICIAIS
// ============================================================
async function inserirDadosIniciais(pool) {
  console.log('\nVerificando usuário administrador...');

  // Verifica se admin já existe
  const resultado = await pool.request()
    .input('usuario', sql.VarChar, ADMIN_USUARIO)
    .query('SELECT id FROM usuarios WHERE usuario = @usuario');

  if (resultado.recordset.length === 0) {
    // Gera o hash da senha 'admin' (permanente no código)
    const senhaHash = bcrypt.hashSync(ADMIN_SENHA, 10);

    await pool.request()
      .input('nome',      sql.VarChar, ADMIN_NOME)
      .input('usuario',   sql.VarChar, ADMIN_USUARIO)
      .input('senhaHash', sql.VarChar, senhaHash)
      .input('nivel',     sql.VarChar, ADMIN_NIVEL)
      .query(`
        INSERT INTO usuarios (nome, usuario, senha_hash, nivel, ativo)
        VALUES (@nome, @usuario, @senhaHash, @nivel, 1)
      `);
    console.log('  Usuário admin criado com sucesso (login: admin / senha: admin)');
  } else {
    console.log('  Usuário admin já existe.');
  }

  // Sistemas de exemplo
  console.log('\nVerificando sistemas de exemplo...');

  const sistemasExemplo = [
    {
      nome:      'Agenda Financeira',
      url:       'http://192.168.0.80:3001',
      icone:     'fa-dollar-sign',
      descricao: 'Controle de receitas e despesas'
    },
    {
      nome:      'Agenda de Tarefas',
      url:       'http://192.168.0.80:3002',
      icone:     'fa-tasks',
      descricao: 'Gerenciamento de tarefas e prazos'
    }
  ];

  for (const sistema of sistemasExemplo) {
    const existe = await pool.request()
      .input('nome', sql.VarChar, sistema.nome)
      .query('SELECT id FROM sistemas WHERE nome = @nome');

    if (existe.recordset.length === 0) {
      await pool.request()
        .input('nome',      sql.VarChar, sistema.nome)
        .input('url',       sql.VarChar, sistema.url)
        .input('icone',     sql.VarChar, sistema.icone)
        .input('descricao', sql.VarChar, sistema.descricao)
        .query(`
          INSERT INTO sistemas (nome, url, icone, descricao, ativo)
          VALUES (@nome, @url, @icone, @descricao, 1)
        `);
      console.log(`  Sistema inserido: ${sistema.nome}`);
    } else {
      console.log(`  Sistema já existe: ${sistema.nome}`);
    }
  }
}

// ============================================================
// EXPORTAÇÕES — pool e função usados por portal.js
// ============================================================
module.exports = { criarBancoPortal, getPool: () => pool };

// Permite rodar diretamente: node criarBancoPortal.js
if (require.main === module) {
  criarBancoPortal()
    .then(() => {
      console.log('\nSetup concluído! Agora rode: node portal.js');
      process.exit(0);
    })
    .catch((erro) => {
      console.error('\nFalha no setup:', erro);
      process.exit(1);
    });
}
