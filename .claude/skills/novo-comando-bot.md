Você vai adicionar um novo comando ao bot WhatsApp do Portal WKL.

O bot está em `C:\Users\kasuo\Desktop\whatsApp\services\messageHandler.js`.

Antes de escrever qualquer código, faça as seguintes perguntas ao usuário:

1. **Gatilho do comando** — o usuário digita o quê para acionar? (número, palavra ou frase)
2. **O que faz** — descreva a ação em detalhes
3. **Requer autenticação** — o usuário precisa estar logado no portal para usar?
4. **Chama a API do Portal?** — se sim, qual endpoint? (ex: `GET /api/chamados/lista`)
5. **Dados de entrada** — o comando recebe parâmetros extras? (ex: `reprovar 42 motivo`)
6. **Resposta esperada** — como deve ser a mensagem de retorno? Mostre um exemplo
7. **Tratamento de erro** — o que responder se falhar ou não houver dados?

Com as respostas:

1. Leia `messageHandler.js` para entender a estrutura atual dos comandos
2. Adicione o novo case/condição no local correto da função `processarMensagem()`
3. Se precisar de nova chamada ao Portal, adicione a função em `portalApi.js`
4. Mantenha o padrão de templates com `{variavel}` para as respostas dinâmicas
5. Adicione o novo comando na mensagem de menu principal (`botConfig.js` → `menuPrincipal`)

Referência de padrão de comando existente:
```javascript
// Em processarMensagem()
if (texto === '1' || texto === 'pendentes') {
  const lista = await listarPendentes(sessao.login);
  if (!lista.length) return enviar(jid, config.nenhumaPendente);
  const linhas = lista.map((a, i) => `*${i+1}.* [#${a.id}] ${a.titulo}`).join('\n');
  return enviar(jid, interpolar(config.listaPendentes, { lista: linhas }));
}
```

Após editar, mostre ao usuário:
- As linhas adicionadas em cada arquivo
- Como testar o novo comando no WhatsApp
