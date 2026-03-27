---
description: Padrões para services do bot WhatsApp (Baileys, portalApi, botConfig)
paths:
  - services/*.js
---

# Regras para Services do WhatsApp Bot (services/*.js)

## Funções por arquivo

| Arquivo | Responsabilidade | Não fazer |
|---------|-----------------|-----------|
| `whatsapp.js` | Conexão Baileys, envio, chats, presença | Lógica de negócio ou chamadas ao Portal |
| `messageHandler.js` | Processar comandos, gerenciar sessões | Conexão direta com Baileys ou DB |
| `portalApi.js` | Chamadas HTTP ao Portal WKL | Lógica de formatação ou bot |
| `botConfig.js` | Templates de mensagens, config persistida | Chamadas de rede |
| `botLogger.js` | Log com buffer circular | Qualquer lógica de negócio |

## Padrão de chamada ao Portal (portalApi.js)

```javascript
const axios = require('axios');

const api = axios.create({
  baseURL: process.env.PORTAL_URL,
  headers: { 'x-api-key': process.env.PORTAL_API_KEY },
  timeout: 10000
});

async function novaFuncao(login, parametro) {
  try {
    const resp = await api.get('/api/endpoint', {
      params: {
        _whatsapp_login: login,  // obrigatório para rotas autenticadas
        param: parametro
      }
    });
    return resp.data;
  } catch (erro) {
    botLog('api', `novaFuncao: ${erro.message}`);
    return null; // sempre retornar null em erro, nunca re-throw
  }
}
```

## Padrão de logging (botLogger.js)

```javascript
const { botLog } = require('./botLogger');

// Categorias: 'msg', 'auth', 'envio', 'api', 'conexao', 'config', 'erro'
botLog('msg', 'Mensagem recebida de 5511999...', { jid, texto });
botLog('api', `Erro ao buscar aprovações: ${erro.message}`);
botLog('auth', `Usuário autenticado: ${login}`);
```

## Padrão de template em botConfig.js

```javascript
// Ao adicionar novo template no objeto defaults:
{
  novoTemplate: 'Olá *{nome}*, sua solicitação *#{id}* foi {status}.',
}

// Uso com interpolate():
const config = getConfig();
const msg = config.interpolate(config.novoTemplate, {
  nome: 'João',
  id: 42,
  status: 'aprovada'
});
```

## Tratamento de JIDs (IDs do WhatsApp)

```javascript
// JID padrão: '5511999999999@s.whatsapp.net'
// JID de grupo: '123456789@g.us'
// JID linked device: 'abc123@lid' (mapear para @s.whatsapp.net)

// Normalizar número para JID:
function numeroParaJid(numero) {
  const digits = numero.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

// Extrair número de JID:
function jidParaNumero(jid) {
  return jid.split('@')[0];
}
```

## Números brasileiros — lidar com variação de 9 dígito

```javascript
// Tentar com e sem o 9 após DDD
// 13 dígitos (55 + 11 + 9XXXXXXXX) → tentar 12 (55 + 11 + XXXXXXXX)
// 12 dígitos (55 + 11 + XXXXXXXX) → tentar 13 (55 + 11 + 9XXXXXXXX)
function variantesNumero(numero) {
  const d = numero.replace(/\D/g, '');
  if (d.length === 13) return [d, d.slice(0, 4) + d.slice(5)];
  if (d.length === 12) return [d, d.slice(0, 4) + '9' + d.slice(4)];
  return [d];
}
```

## Regras gerais

- **Silent fail** em toda chamada ao Portal — nunca deixar erro de API derrubar o bot
- **Deduplicação** — verificar Set de IDs antes de processar mensagem recebida
- **Não usar `console.log`** — sempre usar `botLog(categoria, mensagem)`
- **Sessões em memória** — Map de `jid → { login, nome }` em `messageHandler.js`
- **Não reiniciar `whatsApp.js` desnecessariamente** — ele mantém a sessão Baileys
- **`whatsapp-portal.js` pode reiniciar livremente** — não tem estado de conexão WA
