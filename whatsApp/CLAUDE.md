# WhatsApp Bot — Portal WKL

## Descrição
Bot WhatsApp para integração com o Portal WKL. Permite que aprovadores respondam
pendências diretamente via mensagem, sem precisar acessar o portal.
Arquitetura dual-processo: serviço de conexão (3200) + bot de comandos (3210).

**Projeto principal:** `c:\Users\kasuo\Desktop\Portal` (Portal WKL)

## Arquitetura

```
whatsApp.js (porta 3200)              whatsapp-portal.js (porta 3210)
─────────────────────────             ─────────────────────────────────
Mantém conexão Baileys                Processa comandos do usuário
Gerencia chats/contatos/msgs          Autentica via número de telefone
Fornece API REST para envio           Chama API do Portal WKL
Emite eventos Socket.IO               Gerencia sessões de usuário
  │                                       │
  └──── POST /api/mensagem-recebida ──────┘
  (3200 encaminha msgs para 3210)
```

## Stack Técnico

| Camada | Tecnologia |
|--------|-----------|
| WhatsApp | @whiskeysockets/baileys 6.7.16 |
| Backend | Node.js + Express 4.18 |
| Real-time | Socket.IO 4.7 |
| HTTP Client | axios 1.7 |
| Upload | multer 2.1 |
| Config | dotenv + `data/bot-config.json` |
| Logger | botLogger.js (buffer em memória + Socket.IO) |

## Estrutura de Pastas

```
whatsApp/
├── whatsApp.js              # Processo 1 — conexão WA (porta 3200)
├── whatsapp-portal.js       # Processo 2 — bot de comandos (porta 3210)
├── .env                     # PORTAL_URL, PORTAL_API_KEY, PORTAL_SERVICE_LOGIN
│
├── services/
│   ├── whatsapp.js          # Wrapper Baileys: iniciar, enviar, listar chats
│   ├── messageHandler.js    # Processador de comandos: processarMensagem()
│   ├── portalApi.js         # Cliente HTTP para a API do Portal WKL
│   ├── botConfig.js         # Templates de mensagens + getConfig()/saveConfig()
│   └── botLogger.js         # Log com buffer circular (500 entradas)
│
├── public/
│   ├── index.html           # Interface de chat
│   ├── admin.html           # Painel admin (logs, config, sessões)
│   ├── aprovacoesWhatsApp.html
│   └── js/ + css/
│
└── data/
    ├── bot-config.json      # Configurações editáveis via admin (auto-criado)
    └── store.json           # Persistência de chats/contatos (auto-criado)
```

## Integração com Portal WKL

| O quê | Como |
|-------|------|
| Autenticação | Header `x-api-key: PORTAL_API_KEY` em todas as chamadas |
| Login por número | `GET /api/usuarios/por-whatsapp/{numero}` |
| Listar aprovações | `GET /api/aprovacoes?_whatsapp_login={login}` |
| Detalhar aprovação | `GET /api/aprovacoes/{id}` |
| Responder aprovação | `PUT /api/aprovacoes/{id}/responder` |
| Parâmetro de login | `_whatsapp_login` no query string (obrigatório em rotas autenticadas) |

## Arquivos-Modelo de Referência

| Tipo | Arquivo | Por quê |
|------|---------|---------|
| Comandos do bot | `services/messageHandler.js` | processarMensagem(), sessões, templates |
| Cliente HTTP Portal | `services/portalApi.js` | padrão axios, tratamento de erros, número BR |
| Config com templates | `services/botConfig.js` | getConfig(), interpolate(), defaults |
| Conexão Baileys | `services/whatsapp.js` | JID, reconexão, dedup, foto, presença |

## Padrões de Código

### Template de resposta do bot

```javascript
// Respostas usam {variavel} para interpolação via botConfig.interpolate()
const config = getConfig();
const msg = config.interpolate(config.saudacao, {
  periodo: 'Bom dia',
  nome: sessao.nome
});
await enviarMensagem(jid, msg);
```

### Adicionar novo comando

```javascript
// Em services/messageHandler.js → função processarMensagem()
if (texto === 'N' || texto === 'palavra-chave') {
  // 1. verificar se está autenticado
  if (!sessao) return enviar(jid, config.naoVinculado);

  // 2. buscar dados na API do Portal
  const dados = await funcaoPortalApi(sessao.login);

  // 3. verificar resultado
  if (!dados || !dados.length) return enviar(jid, config.nenhumDado);

  // 4. formatar e enviar resposta
  const texto = dados.map(d => `*${d.id}* — ${d.titulo}`).join('\n');
  return enviar(jid, config.interpolate(config.templateResposta, { lista: texto }));
}
```

### Chamada à API do Portal

```javascript
// Em services/portalApi.js
async function novaFuncao(login) {
  try {
    const resp = await api.get('/api/endpoint', {
      params: { _whatsapp_login: login }
    });
    return resp.data;
  } catch (erro) {
    botLog('api', `Erro em novaFuncao: ${erro.message}`);
    return null;
  }
}
```

## Variáveis de Ambiente (.env)

```
PORT=3200                              # porta do processo principal
BOT_PORT=3210                          # porta do bot de comandos
PORTAL_URL=http://localhost:3132       # URL base do Portal WKL
PORTAL_API_KEY=whatsapp-secret-key-2026
PORTAL_SERVICE_LOGIN=sistema           # login do serviço para chamadas gerais
```

## Comandos do Bot (numeração atual)

| Comando | Ação |
|---------|------|
| saudação | Menu principal |
| 0 / menu | Menu principal |
| 1 / pendentes | Aprovações pendentes |
| 2 | Últimas 10 aprovadas |
| 3 | Últimas 10 reprovadas |
| 4 | Resumo geral |
| 5 / detalhar \<id\> | Detalhes de uma aprovação |
| 6 / aprovar \<id\> | Aprovar |
| 7 / reprovar \<id\> [motivo] | Reprovar com motivo opcional |

## Regras Gerais

1. **Dois processos separados** — nunca mesclar lógica de conexão (3200) com bot (3210)
2. **Silent fail em chamadas ao Portal** — erro na API não deve derrubar o bot
3. **Deduplicação de mensagens** — verificar Set de IDs processados antes de agir
4. **Números brasileiros** — sempre lidar com variações de 12/13 dígitos (com/sem 9)
5. **Sem quebrar sessão do Baileys** — `whatsApp.js` deve ser reiniciado com cuidado
6. **Templates editáveis** — textos de resposta ficam em `botConfig.js` defaults + `data/bot-config.json`
7. **Logs via botLogger** — nunca `console.log` direto; usar `botLog(categoria, msg)`
