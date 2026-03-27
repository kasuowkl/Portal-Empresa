Você vai adicionar um ou mais endpoints a uma rota existente do Portal WKL.

Antes de escrever qualquer código, faça as seguintes perguntas ao usuário:

1. **Arquivo de rota** — em qual arquivo vai o endpoint? (ex: `routes/chamados.js`, `routes/aprovacoes.js`)
2. **Método HTTP** — GET, POST, PUT ou DELETE?
3. **Caminho do endpoint** — qual a URL? (ex: `/api/chamados/:id/transferir`)
4. **O que faz** — descreva a operação em uma frase
5. **Dados de entrada** — quais parâmetros recebe? (body, params, query)
6. **Tabelas envolvidas** — quais tabelas do banco serão lidas/modificadas?
7. **Retorno** — o que deve retornar em caso de sucesso?
8. **Permissão** — qualquer usuário logado pode usar, ou tem restrição de perfil/dono?
9. **Log** — precisa registrar em `logs_atividade`? Se sim, qual ação registrar?
10. **Notificação** — precisa disparar email, Telegram ou WhatsApp após a ação?

Com as respostas:

1. Leia o arquivo de rota atual para entender o contexto, imports já existentes e funções helper disponíveis
2. Adicione o endpoint no local correto do arquivo (agrupado por recurso)
3. Siga o padrão de error handling do arquivo (`try/catch` + `logErro.error` + resposta JSON)
4. Reutilize funções helper já existentes no arquivo (getPermissao, getPerfil, etc.) quando aplicável
5. Não duplique imports já existentes no topo do arquivo

Após editar, mostre as linhas adicionadas e confirme se há alteração no frontend necessária.
