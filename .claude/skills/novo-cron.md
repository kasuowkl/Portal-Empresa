Você vai criar um novo serviço de agendamento (cron job) para o Portal WKL.

Antes de escrever qualquer código, faça as seguintes perguntas ao usuário:

1. **Nome do job** — como chamar este serviço? (ex: "lembretes de reservas", "sync de documentos")
2. **Horário de execução** — que horas deve rodar? (ex: 07:00, 08:30) — ou é periódico (a cada X minutos)?
3. **O que faz** — descreva a lógica em detalhes: o que consulta no banco, o que processa, o que envia
4. **Tabelas envolvidas** — quais tabelas serão lidas ou atualizadas?
5. **Notificação** — vai enviar email? WhatsApp? Para quem? Com qual conteúdo?
6. **Condição de disparo** — qual critério define "quem" recebe ou "o quê" é processado? (ex: vencimento hoje, status pendente há X dias)

Com as respostas, crie:

1. **`services/cron<Nome>.js`** — usando o padrão setInterval com guard de dia:

```javascript
function iniciarCron<Nome>(pool) {
  let ultimoDiaExecutado = -1;
  setInterval(async () => {
    const agora = new Date();
    const dia = agora.getDate();
    if (agora.getHours() === HORA && agora.getMinutes() === 0 && dia !== ultimoDiaExecutado) {
      ultimoDiaExecutado = dia;
      await executarJob(pool);
    }
  }, 60 * 1000);
}
module.exports = { iniciarCron<Nome> };
```

Use `services/cronAprovacoes.js` como referência de estrutura.

2. Mostre as **linhas a adicionar em `portal.js`**:
   - Import do novo serviço
   - Chamada de inicialização dentro de `iniciarServidor()`

Após criar, confirme com o usuário o horário e a lógica antes de finalizar.
