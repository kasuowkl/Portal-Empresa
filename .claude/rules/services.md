---
description: Padrões para serviços e jobs agendados do Portal WKL
paths:
  - services/*.js
---

# Regras para Services (services/*.js)

## Tipos de serviço existentes no projeto

| Tipo | Exemplos | Característica |
|------|----------|----------------|
| Cron/job agendado | `cronAprovacoes.js`, `cronFinanceiro.js` | `setInterval` + horário fixo |
| Serviço de notificação | `emailService.js` | Templates + envio via nodemailer |
| Helper de infraestrutura | `logService.js`, `sessionStore.js` | Utilitário único, export direto |
| Integração externa | `caldavService.js` | Protocolo externo, retry, fallback |

## Padrão de cron com setInterval

```javascript
// services/cronXxx.js
async function executarJob(pool) {
  // lógica principal aqui
}

function iniciarCronXxx(pool) {
  let ultimoDiaExecutado = -1;

  setInterval(async () => {
    const agora = new Date();
    const dia = agora.getDate();
    if (agora.getHours() === HORA && agora.getMinutes() === 0 && dia !== ultimoDiaExecutado) {
      ultimoDiaExecutado = dia;
      await executarJob(pool);
    }
  }, 60 * 1000); // verifica a cada 1 minuto
}

module.exports = { iniciarCronXxx };
```

- `pool` é **sempre recebido como parâmetro** — nunca importado diretamente
- `ultimoDiaExecutado` garante que o job **não execute mais de uma vez por dia**
- O job é iniciado em `portal.js` via `iniciarCronXxx(app.locals.pool)`
- Erros dentro do job devem ser silenciosos (try/catch sem re-throw)

## Padrão de serviço de email

```javascript
// services/emailService.js — padrão para adicionar novo template
const templates = {
  'modulo.evento': {
    assunto: (dados) => `Assunto: ${dados.campo}`,
    corpo: (dados) => bloco('Título', '#3b82f6', `
      <p>Conteúdo do email com ${dados.campo}</p>
    `)
  }
};

// bloco() — wrapper de seção do email
function bloco(titulo, cor, conteudo) {
  return `
    <div style="border-left: 4px solid ${cor}; padding: 12px 16px; margin: 12px 0;">
      <strong>${titulo}</strong>
      ${conteudo}
    </div>
  `;
}
```

## Padrão de helper mínimo (logService.js)

```javascript
async function registrarLog(pool, { usuario, ip, acao, sistema, detalhes }) {
  try {
    await pool.request()
      .input('usuario', sql.VarChar, (usuario || '').substring(0, 100))
      .input('ip', sql.VarChar, (ip || '').substring(0, 50))
      .input('acao', sql.VarChar, (acao || '').substring(0, 100))
      .input('sistema', sql.VarChar, (sistema || '').substring(0, 100))
      .input('detalhes', sql.VarChar, (detalhes || '').substring(0, 500))
      .query(`INSERT INTO logs_atividade (usuario, ip, acao, sistema, detalhes, criado_em)
              VALUES (@usuario, @ip, @acao, @sistema, @detalhes, GETDATE())`);
  } catch (_) {} // silent fail — nunca bloquear o fluxo principal
}

module.exports = { registrarLog };
```

## Regras gerais

- **Não acessar `req`/`res`** em services — receber dados como parâmetros
- **Pool sempre como parâmetro** da função de inicialização ou de cada chamada
- **Silent fail** nos services chamados a partir de rotas — erro no service não deve quebrar a requisição
- **Módulo exporta funções nomeadas** — não exportar classes, salvo `sessionStore.js`
- **Comentário de header** em cada arquivo: nome, versão, data, descrição
- **Sem dependências circulares** — services não importam routes
