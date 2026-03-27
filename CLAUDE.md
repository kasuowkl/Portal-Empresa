# Portal WKL — Sistema de Gestão Corporativa

## Descrição
Portal de sistemas e serviços internos para WKL. Multi-módulo com autenticação (local + AD),
workflow de aprovações, agenda de tarefas e financeira, chamados, patrimônio, contatos e calendários.
Integra com um bot WhatsApp para aprovações via mensagem.

**Versão:** 1.3.0 | **Servidor:** 192.168.0.80:3132 | **DB:** PortalSistemas (192.168.0.209:1433)

## Projetos Relacionados

| Projeto | Caminho | Uso |
|---------|---------|-----|
| WhatsApp Bot | `C:\Users\kasuo\Desktop\whatsApp` | Bot Baileys para aprovações via WhatsApp (porta 3200/3210) |
| Projeto Casa WKL | `c:\Users\kasuo\Desktop\Projeto Casa WKL\portal` | Cópia de referência — consulta apenas, **nunca deployar** |

## Stack Técnico

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js + Express 4.18 |
| Banco | SQL Server (mssql 10.0) — `192.168.0.209:1433` |
| Auth | express-session (8h) + bcryptjs + ldapjs (AD) |
| Email | Nodemailer + SMTP (config via DB ou .env) |
| Logging | Winston → `logs/atividade.log` + `logs/erros.log` |
| Frontend | HTML5 + CSS3 + Vanilla JS (sem framework, sem build) |
| Estilo | Dark mode com CSS variables (`--cor-*`) definidas em `public/css/style.css` |
| Calendário | CalDAV via tsdav (`ENCRYPTION_KEY` deve ter **exatamente 32 chars**) |
| Notificações | Email + Telegram + WhatsApp |
| Processo | PM2 — `pm2 restart portal` |

## Estrutura de Pastas

```
Portal/
├── portal.js               # Entry point — iniciarServidor(), monta rotas, inicia crons
├── criarBancoPortal.js     # Schema completo do banco (IF NOT EXISTS + ALTER TABLE)
├── aprovacoes.js           # Utilitários compartilhados de aprovações
├── .env                    # Configurações (DB, SMTP, sessão, API keys)
│
├── routes/                 # Um arquivo por módulo
│   ├── auth.js             # Login/logout/sessão
│   ├── portal.js           # Dashboard + config UI
│   ├── agenda.js           # Agenda de tarefas
│   ├── financeiro.js       # Agenda financeira
│   ├── chamados.js         # Sistema de chamados
│   ├── patrimonio.js       # Gestão de patrimônio
│   ├── contatos.js         # Agenda de contatos
│   ├── aprovacoes.js       # Workflow de aprovações
│   └── calendarios.js      # Calendários com CalDAV
│
├── services/               # Serviços e jobs
│   ├── emailService.js     # Templates + envio SMTP
│   ├── caldavService.js    # Protocolo CalDAV
│   ├── logService.js       # registrarLog() — helper de auditoria
│   ├── sessionStore.js     # Store MSSQL para express-session
│   ├── cronFinanceiro.js   # Job diário 07:00 — lembretes financeiros
│   ├── cronAprovacoes.js   # Job diário 08:00 — lembretes de aprovações
│   └── cronCalendarios.js  # Sync periódico de calendários
│
├── middleware/
│   └── verificarLogin.js   # Auth guard: sessão || x-api-key
│
├── lib/
│   └── ad.js               # Operações LDAP/Active Directory
│
├── public/
│   ├── *.html              # Páginas principais (login, portal, configuracoes...)
│   ├── css/style.css       # CSS variables globais (dark mode)
│   ├── js/menu.js          # Carrega menu.html dinamicamente
│   ├── componentes/        # menu.html (injetado em todas as páginas)
│   ├── fragmentos/         # Tabs do painel de configurações
│   ├── agendaTarefas/      # Módulo tarefas (index.html + css/)
│   ├── agendaFinanceira/   # Módulo financeiro
│   ├── chamados/           # Módulo chamados
│   ├── patrimonio/         # Módulo patrimônio
│   ├── agendaContatos/     # Módulo contatos
│   ├── agendaCalendarios/  # Módulo calendários
│   ├── aprovacoes/         # Módulo aprovações
│   └── ajuda/              # Documentação HTML por módulo
│
└── logs/                   # atividade.log + erros.log (gitignored)
```

## Módulos

| Módulo | URL | API | Prefixo DB |
|--------|-----|-----|-----------|
| Agenda de Tarefas | `/agenda` | `/api/agenda/*` | `agenda_` |
| Agenda Financeira | `/agendaFinanceira` | `/api/financeiro/*` | `fin_` |
| Chamados | `/chamados` | `/api/chamados/*` | `chamados_` |
| Patrimônio | `/patrimonio` | `/api/patrimonio/*` | `pat_` |
| Aprovações | `/aprovacoes` | `/api/aprovacoes/*` | `aprovacoes_` |
| Contatos | `/agendaContatos` | `/api/contatos/*` | `contatos_` |
| Calendários | `/agendaCalendarios` | `/api/calendarios/*` | `cal_` |

## Arquivos-Modelo de Referência

| Tipo de artefato | Arquivo-modelo | Por quê usar como referência |
|-----------------|----------------|------------------------------|
| Rota CRUD com permissões (dono/membro) | `routes/agenda.js` | getPermissao(), NIVEL, temPermissao(), CRUD completo |
| Rota com perfis por módulo | `routes/chamados.js` | getPerfil(), podeVer(), gerarProtocolo() |
| Serviço cron (job diário) | `services/cronAprovacoes.js` | setInterval + horário fixo + guard de dia |
| Serviço de email com templates | `services/emailService.js` | criarTransporter(), enviarNotificacao(), bloco() |
| Helper de log mínimo | `services/logService.js` | registrarLog() — silent fail |
| HTML de módulo completo | `public/agendaTarefas/index.html` | menu inject, dark mode, modais, fetch CRUD |
| Fragmento do painel admin | `public/fragmentos/usuarios-locais.html` | form + tabela + validação client-side |
| Auth guard | `middleware/verificarLogin.js` | sessão + x-api-key para integrações |

## Padrões de Código

### Template de rota REST
```javascript
const express = require('express');
const router = express.Router();
const verificarLogin = require('../middleware/verificarLogin');
const { registrarLog } = require('../services/logService');
const sql = require('mssql');
const path = require('path');

// Página HTML
router.get('/modulo', verificarLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/modulo/index.html'));
});

// Listar
router.get('/api/modulo/lista', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  try {
    const r = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .query('SELECT * FROM tabela WHERE usuario = @usuario ORDER BY criado_em DESC');
    res.json(r.recordset);
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao carregar.' });
  }
});

// Criar
router.post('/api/modulo', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { campo } = req.body;
  if (!campo) return res.status(400).json({ erro: 'Campo obrigatório.' });
  try {
    const r = await pool.request()
      .input('campo', sql.VarChar, campo)
      .input('usuario', sql.VarChar, usuario)
      .query(`
        INSERT INTO tabela (campo, criado_por, criado_em)
        OUTPUT INSERTED.*
        VALUES (@campo, @usuario, GETDATE())
      `);
    await registrarLog(pool, { usuario, acao: 'CRIACAO', sistema: 'modulo', detalhes: campo });
    res.json({ sucesso: true, item: r.recordset[0] });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao criar.' });
  }
});

// Atualizar
router.put('/api/modulo/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const usuario = req.session.usuario.usuario;
  const { id } = req.params;
  const { campo } = req.body;
  try {
    await pool.request()
      .input('id', sql.Int, id)
      .input('campo', sql.VarChar, campo)
      .query('UPDATE tabela SET campo = @campo WHERE id = @id');
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao atualizar.' });
  }
});

// Excluir
router.delete('/api/modulo/:id', verificarLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  try {
    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM tabela WHERE id = @id');
    res.json({ sucesso: true });
  } catch (erro) {
    req.app.locals.logErro.error(erro.message);
    res.status(500).json({ erro: 'Erro ao excluir.' });
  }
});

module.exports = router;
```

### Query parametrizada (obrigatório — nunca concatenar strings)
```javascript
// Busca com parâmetros
const r = await pool.request()
  .input('id', sql.Int, id)
  .input('texto', sql.VarChar, req.body.texto)
  .query('SELECT * FROM tabela WHERE id = @id AND campo = @texto');

// INSERT com retorno (OUTPUT INSERTED)
const r = await pool.request()
  .input('nome', sql.VarChar, nome)
  .query(`
    INSERT INTO tabela (nome, criado_em)
    OUTPUT INSERTED.id, INSERTED.nome
    VALUES (@nome, GETDATE())
  `);
const novoId = r.recordset[0].id;
```

### Sistema de permissões (padrão dono/membro)
```javascript
async function getPermissao(pool, recursoId, usuario) {
  const r = await pool.request()
    .input('id', sql.Int, recursoId)
    .input('usuario', sql.VarChar, usuario)
    .query(`
      SELECT 'dono' AS perm FROM tabela WHERE id = @id AND dono = @usuario
      UNION ALL
      SELECT permissao FROM membros WHERE recurso_id = @id AND usuario = @usuario
    `);
  return r.recordset[0]?.perm || null;
}

const NIVEL = { leitura: 1, edicao: 2, dono: 3 };
function temPermissao(perm, minimo) {
  return !!perm && (NIVEL[perm] || 0) >= (NIVEL[minimo] || 0);
}
```

### Cron com setInterval (padrão de todos os serviços)
```javascript
function iniciarCronXxx(pool) {
  let ultimoDiaExecutado = -1;
  setInterval(async () => {
    const agora = new Date();
    const dia = agora.getDate();
    if (agora.getHours() === 7 && agora.getMinutes() === 0 && dia !== ultimoDiaExecutado) {
      ultimoDiaExecutado = dia;
      await executarJob(pool);
    }
  }, 60 * 1000);
}
module.exports = { iniciarCronXxx };
```

## Convenções de Nomenclatura

| Contexto | Padrão | Exemplos |
|----------|--------|---------|
| Tabelas DB | `prefixo_nome` snake_case | `agenda_tarefas`, `fin_contas`, `pat_bens` |
| Colunas comuns | snake_case | `id`, `criado_em`, `ativo` (BIT), `dono`, `usuario` |
| Endpoint HTML | `GET /modulo` | `/chamados`, `/aprovacoes`, `/patrimonio` |
| Endpoint API | `GET /api/modulo/recurso` | `/api/chamados/lista` |
| Ação especial | `POST /api/modulo/:id/acao` | `/api/chamados/:id/aprovar` |
| Funções JS | camelCase | `getPermissao()`, `enviarNotificacao()`, `gerarProtocolo()` |
| Resultado de query | `r` | `const r = await pool.request()...` |
| Catch de erro | `erro` | `catch (erro) { ... }` |
| IDs de sessão | `req.session.usuario.usuario` | login do usuário logado |

## Regras Gerais

1. **Auth obrigatório** — Todo endpoint usa `verificarLogin` como middleware, sem exceção
2. **Sem SQL dinâmico** — Sempre `.input()` para dados externos; nunca concatenar strings em queries
3. **OUTPUT INSERTED** — Usar em INSERT para retornar o registro criado sem segundo SELECT
4. **logErro no catch** — `req.app.locals.logErro.error(erro.message)` em todo catch de rota
5. **registrarLog após ação** — Toda operação CRUD deve logar em `logs_atividade` via `registrarLog()`
6. **Sem frameworks frontend** — Vanilla JS + Fetch API; sem React, Vue, jQuery
7. **CSS variables** — Usar `--cor-*` do style.css; nunca hardcode de cor hex
8. **Sem TypeScript** — Projeto é JavaScript puro (CommonJS)
9. **Sem build step** — Arquivos HTML/CSS/JS servidos diretamente pelo Express
10. **Deploy** — SCP arquivo + `pm2 restart portal` no servidor 192.168.0.80

## Deploy Rápido

```bash
# Enviar arquivo para servidor
scp "C:/Users/kasuo/Desktop/Portal/<arquivo>" user@192.168.0.80:/var/www/html/wkl/Portal/<arquivo>

# Reiniciar aplicação
pm2 restart portal
```
