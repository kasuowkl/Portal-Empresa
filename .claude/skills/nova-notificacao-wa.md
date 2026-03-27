Você vai adicionar o envio de notificação via WhatsApp a um evento do Portal WKL.

A integração funciona assim: o Portal envia um POST para `http://localhost:3200/api/notificar`
com o número do destinatário e a mensagem. O serviço WhatsApp (`whatsApp.js`) entrega a mensagem.

Antes de escrever qualquer código, faça as seguintes perguntas ao usuário:

1. **Evento que dispara** — em qual ação do Portal a notificação deve ser enviada?
   (ex: "quando aprovação for criada", "quando chamado for atribuído a um técnico")
2. **Arquivo de rota** — em qual route file está esse evento? (ex: `routes/aprovacoes.js`)
3. **Destinatário** — para quem enviar? Como obter o número de WhatsApp da pessoa?
   (ex: "campo `whatsapp` do usuário na tabela `usuarios`")
4. **Conteúdo da mensagem** — o que deve dizer? Mostre um exemplo com os dados disponíveis
5. **Fallback** — o que fazer se o envio falhar? (ignorar silenciosamente? logar?)

Com as respostas:

1. Leia o arquivo de rota indicado para entender o contexto e os dados disponíveis
2. Crie ou localize a função de envio de notificação WA:

```javascript
async function notificarWhatsApp(pool, login, mensagem) {
  try {
    // Busca o número do usuário
    const r = await pool.request()
      .input('login', sql.VarChar, login)
      .query('SELECT whatsapp FROM usuarios WHERE usuario = @login');
    const numero = r.recordset[0]?.whatsapp;
    if (!numero) return; // usuário não tem WA cadastrado

    const WHATSAPP_URL = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:3200';
    const WHATSAPP_KEY = process.env.WHATSAPP_API_KEY;

    await fetch(`${WHATSAPP_URL}/api/notificar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': WHATSAPP_KEY
      },
      body: JSON.stringify({ numero, mensagem })
    });
  } catch (_) {} // silent fail — nunca bloquear o fluxo principal
}
```

3. Adicione a chamada da função após a ação que dispara a notificação (sem await se for fire-and-forget)
4. Não quebre o fluxo principal em caso de falha no envio WA

Após editar, mostre as linhas adicionadas e como testar (ex: cadastrando o WA do usuário e disparando o evento).
