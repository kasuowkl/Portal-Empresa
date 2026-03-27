Você vai criar um novo fragmento HTML para o painel de configurações do Portal WKL.

Antes de escrever qualquer código, faça as seguintes perguntas ao usuário:

1. **Nome da seção** — qual o título da aba? (ex: "Integrações", "Feriados")
2. **Ícone Font Awesome** — qual ícone usar? (ex: `fa-plug`, `fa-calendar`) — ou escolho eu?
3. **O que configura** — o que o admin gerencia nessa seção?
4. **Campos de formulário** — quais configurações têm? (campos de texto, toggles, selects?)
5. **Tabela de dados** — tem uma lista de itens para gerenciar (CRUD) ou só um formulário de configuração?
6. **Endpoint de API** — qual endpoint salva/carrega as configurações? (já existe ou precisa criar?)

Com as respostas, crie:

1. **`public/fragmentos/<nome>.html`** — fragmento SEM `<html>`, `<head>`, `<body>`:
   - Container `.fragmento-container` com título + ícone
   - Formulário ou tabela conforme necessário
   - Funções JS prefixadas com o nome do fragmento (ex: `salvarIntegracoes()`)
   - Chamada de carregamento inicial no final do script
   - Feedback inline de sucesso/erro

Use `public/fragmentos/usuarios-locais.html` como referência de estrutura.

2. Mostre as **linhas a adicionar em `public/configuracoes.html`** para registrar a nova aba:
   - Botão da aba no menu de tabs
   - Lógica de carregamento do fragmento via fetch

Após criar, confirme se o endpoint de API já existe ou precisa ser criado.
