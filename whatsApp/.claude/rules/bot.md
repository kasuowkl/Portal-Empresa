---
description: Padrões para os entry points do bot WhatsApp (whatsApp.js e whatsapp-portal.js)
paths:
  - whatsApp.js
  - whatsapp-portal.js
---

# Regras para Entry Points do WhatsApp Bot

## Separação de responsabilidades

**`whatsApp.js` (porta 3200) — NÃO modificar sem necessidade**
- Conexão e reconexão Baileys
- Gerenciamento de chats, contatos, mensagens
- API REST e Socket.IO para o frontend de chat
- Encaminhamento de mensagens recebidas para porta 3210
- **Reiniciar apenas se necessário** — quebra a sessão WA

**`whatsapp-portal.js` (porta 3210) — pode modificar livremente**
- Recebe mensagens de 3200 via `POST /api/mensagem-recebida`
- Roteia para `processarMensagem()` do messageHandler
- Expõe endpoints de aprovações e admin
- **Pode reiniciar sem perder conexão WA**

## Endpoints do processo principal (3200)

```javascript
// Receber notificação do Portal para enviar WA
POST /api/notificar
Body: { numero: '5511999999999', mensagem: 'Texto da mensagem' }

// Enviar mensagem de chat
POST /api/mensagens/enviar
Body: { jid: '5511999@s.whatsapp.net', texto: 'Olá' }

// Status da conexão
GET /api/status  // → { conectado: true/false }
```

## Encaminhamento de mensagens (3200 → 3210)

```javascript
// Em whatsApp.js — ao receber mensagem, encaminhar para bot:
await fetch(`http://localhost:${BOT_PORT}/api/mensagem-recebida`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jid, texto, nome, pushName })
});
// Silencioso — se bot não está rodando, mensagem é ignorada
```

## Padrão de endpoint de admin (whatsapp-portal.js)

```javascript
// Endpoints admin seguem o padrão /api/admin/*
app.get('/api/admin/recurso', (req, res) => {
  res.json({ dados: getRecurso() });
});

app.put('/api/admin/recurso', (req, res) => {
  const novo = req.body;
  saveRecurso(novo);
  botLog('config', 'Recurso atualizado');
  res.json({ sucesso: true });
});
```

## Socket.IO — eventos em uso

```javascript
// Processo 3200 (chat):
io.emit('chats', listarChats());           // lista atualizada de chats
io.emit('mensagem', { jid, msg });          // nova mensagem recebida
io.emit('qr', qrBase64);                   // QR code para autenticação
io.emit('status', { conectado: bool });     // estado da conexão

// Processo 3210 (admin):
io.emit('logs:new', logEntry);             // novo log para admin dashboard
```

## Regras de modificação

- **Não adicionar lógica de negócio em `whatsApp.js`** — ele é infraestrutura pura
- **Toda lógica de bot vai em `messageHandler.js`** ou `portalApi.js`
- **Novos endpoints de admin** vão em `whatsapp-portal.js` sob `/api/admin/`
- **Novos endpoints de aprovações** vão em `whatsapp-portal.js` sob `/api/aprovacoes/`
- **Configurações** sempre via `botConfig.js` — nunca hardcode de texto no entry point
- **Erros no startup** devem ser logados mas não devem impedir o processo de iniciar
