---
description: Padrões para arquivos de rota Express do Portal WKL
paths:
  - routes/*.js
---

# Regras para Routes (routes/*.js)

## Estrutura obrigatória de todo arquivo de rota

```javascript
const express = require('express');
const router = express.Router();
const verificarLogin = require('../middleware/verificarLogin');
const { registrarLog } = require('../services/logService');
const sql = require('mssql');
const path = require('path');
```

## Ordem dos endpoints

1. `GET /modulo` — serve o HTML (sem lógica)
2. `GET /api/modulo/lista` — listar recursos
3. `GET /api/modulo/:id` — detalhar um recurso
4. `POST /api/modulo` — criar
5. `PUT /api/modulo/:id` — atualizar
6. `DELETE /api/modulo/:id` — excluir
7. `POST /api/modulo/:id/acao` — ações especiais (aprovar, transferir, etc.)

## Regras de implementação

- **Todo endpoint** começa com `verificarLogin` como segundo argumento
- **Sempre `async (req, res)`** para endpoints que acessam o banco
- **`const pool = req.app.locals.pool`** no início de todo handler async
- **`const usuario = req.session.usuario.usuario`** para identificar o usuário logado
- **Validar entradas** antes de qualquer query; retornar `res.status(400).json({ erro: '...' })` se inválido
- **`try/catch` em todo handler** que acessa o banco
- **`req.app.locals.logErro.error(erro.message)`** dentro de todo catch
- **`registrarLog()`** após toda operação CRUD com sucesso
- **`module.exports = router`** ao final do arquivo

## Padrão de resposta JSON

```javascript
// Sucesso com dado
res.json({ sucesso: true, item: r.recordset[0] });
res.json({ sucesso: true, dados: r.recordset });

// Sucesso sem dado
res.json({ sucesso: true, mensagem: 'Operação realizada.' });

// Erro de validação (400)
res.status(400).json({ erro: 'Descrição do problema.' });

// Erro de permissão (403)
res.status(403).json({ erro: 'Sem permissão para esta operação.' });

// Erro de servidor (500)
res.status(500).json({ erro: 'Erro ao processar requisição.' });
```

## Sistema de permissões (quando o módulo tem dono/membros)

```javascript
async function getPermissao(pool, recursoId, usuario) {
  const r = await pool.request()
    .input('id', sql.Int, recursoId)
    .input('usuario', sql.VarChar, usuario)
    .query(`
      SELECT 'dono' AS perm FROM tabela WHERE id = @id AND dono = @usuario
      UNION ALL
      SELECT permissao FROM membros WHERE recurso_id = @id AND usuario = @usuario
    `);
  return r.recordset[0]?.perm || null;
}

const NIVEL = { leitura: 1, edicao: 2, dono: 3 };
function temPermissao(perm, minimo) {
  return !!perm && (NIVEL[perm] || 0) >= (NIVEL[minimo] || 0);
}
```

## Padrão INSERT com retorno

```javascript
// Usar OUTPUT INSERTED — nunca fazer SELECT separado após INSERT
const r = await pool.request()
  .input('campo', sql.VarChar, valor)
  .query(`
    INSERT INTO tabela (campo, criado_em)
    OUTPUT INSERTED.*
    VALUES (@campo, GETDATE())
  `);
```

## Registro no banco após erro (opcional, padrão do projeto)

```javascript
} catch (erro) {
  req.app.locals.logErro.error(erro.message);
  try {
    await pool.request()
      .input('origem', sql.VarChar, 'routes/modulo.js')
      .input('mensagem', sql.VarChar, erro.message.substring(0, 500))
      .query('INSERT INTO logs_erro (origem, mensagem, criado_em) VALUES (@origem, @mensagem, GETDATE())');
  } catch (_) {}
  res.status(500).json({ erro: 'Erro ao processar.' });
}
```

## Verificação de perfil de usuário (módulos com papéis próprios)

```javascript
// Perfis independentes do nível do portal (ex: chamados)
async function getPerfil(pool, login, nivelPortal) {
  if (nivelPortal === 'admin') return { cargo: 'ADMIN', setores: [] };
  const r = await pool.request()
    .input('login', sql.VarChar, login)
    .query('SELECT cargo, setores FROM modulo_perfis WHERE login = @login');
  if (!r.recordset[0]) return null;
  return {
    cargo: r.recordset[0].cargo,
    setores: JSON.parse(r.recordset[0].setores || '[]')
  };
}
```
