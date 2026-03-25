# CHANGELOG — Portal de Sistemas e Serviços (WKL)

Todas as mudanças relevantes do projeto serão documentadas aqui.
Formato: `[VERSÃO] - DATA - Descrição`

---

## [1.0.0] - 2026-03-02 — Versão inicial

### Adicionado
- Estrutura completa do projeto Node.js + Express + MSSQL
- `criarBancoPortal.js` — criação automática do banco, tabelas e dados iniciais
- `portal.js` — servidor principal com Express, sessão e logging via Winston
- `middleware/verificarLogin.js` — proteção de rotas para usuários autenticados
- `routes/auth.js` — login (POST /login), logout (GET /logout), sessão (GET /sessao)
- `routes/portal.js` — rotas do portal: /portal, /sistemas, /servicos, /configuracoes, /logs
- `public/componentes/menu.html` — menu compartilhado (carregado dinamicamente)
- `public/js/menu.js` — carregamento e inicialização do menu em qualquer página
- `public/css/style.css` — estilos globais em Dark Mode
- `public/css/menu.css` — estilos do menu e painel flutuante
- `public/login.html` — página de login com animação e tratamento de erros
- `public/portal.html` — página principal com grade de sistemas e saudação por horário
- Usuário administrador padrão: `admin` / `admin` (nível: admin)
- Sistema de log em arquivo: `logs/atividade.log` e `logs/erros.log`
- Tabelas do banco: `usuarios`, `sistemas`, `logs_atividade`, `logs_erro`
- Sistemas de exemplo: Agenda Financeira, Agenda de Tarefas

### Decisões técnicas
- Autenticação por sessão (express-session) com expiração de 8 horas
- Senhas protegidas com bcryptjs (hash + salt)
- Login AD deixado para v2.0
- Menu compartilhado via fetch para reuso em outros sistemas

---

## Próximas versões planejadas

### [1.1.0] — Melhorias de gestão
- [ ] Página de configurações com CRUD de usuários
- [ ] CRUD de sistemas pelo painel admin
- [ ] Visualização dos logs pelo navegador

### [2.0.0] — Autenticação AD
- [ ] Login com usuários do Active Directory (LDAP)
- [ ] Sincronização de grupos AD com níveis do portal
- [ ] Tela de configuração do servidor AD

---

> Para registrar uma nova versão, adicione uma seção acima seguindo o formato:
> `## [X.Y.Z] - AAAA-MM-DD — Título da versão`
