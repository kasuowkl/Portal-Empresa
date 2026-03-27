Você vai criar um novo módulo completo no Portal WKL.

Antes de escrever qualquer código, faça as seguintes perguntas ao usuário (pode perguntar tudo de uma vez):

1. **Nome do módulo** — qual o nome em português? (ex: "Reservas", "Documentos")
2. **Rota URL** — qual será a URL? (ex: `/reservas`) — ou devo sugerir baseado no nome?
3. **Prefixo das tabelas** — qual o prefixo para as tabelas no banco? (ex: `res_`) — ou devo sugerir?
4. **Campos principais** — quais campos o recurso principal tem? (nome, descrição, data, valor, etc.)
5. **Permissões** — o módulo tem dono + membros com permissões (leitura/edição), ou é global para todos os usuários logados?
6. **Notificações** — precisa enviar email ou WhatsApp em alguma ação? Se sim, quais ações?
7. **Relatório** — vai ter uma página de relatórios separada?
8. **Cron/agendamento** — precisa de job automático (lembrete, sync)? Se sim, quando e o quê?

Com as respostas, crie:

1. **`routes/<modulo>.js`** — rota completa com CRUD (GET página, GET lista, GET detalhe, POST, PUT, DELETE). Use o padrão de `routes/agenda.js` como referência.

2. **`public/<modulo>/index.html`** — página HTML com menu inject, dark mode (CSS variables), modais para criação e edição, tabela ou cards de listagem, fetch para todas as operações. Use `public/agendaTarefas/index.html` como referência visual.

3. **`public/<modulo>/css/<modulo>.css`** — estilos específicos do módulo usando `--cor-*` do style.css.

4. **Bloco SQL em `criarBancoPortal.js`** — tabelas com `IF NOT EXISTS`, colunas padrão (id, criado_por, criado_em, ativo), e migrações seguras com `ALTER TABLE IF NOT EXISTS COLUMN`.

5. **Registro em `portal.js`** — linhas para montar a rota (`app.use`) e iniciar o cron se houver.

Após criar os arquivos, mostre ao usuário:
- Os arquivos criados e seus caminhos
- As linhas que precisam ser adicionadas manualmente em `portal.js`
- O comando de deploy: `scp` + `pm2 restart portal`
