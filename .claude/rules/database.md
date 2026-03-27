---
description: Padrões para criação e migração de tabelas no banco de dados
paths:
  - criarBancoPortal.js
---

# Regras para Database (criarBancoPortal.js)

## Propósito do arquivo

`criarBancoPortal.js` é o arquivo de inicialização do banco. Deve ser idempotente:
executar várias vezes sem erros. Toda criação de tabela usa `IF NOT EXISTS`,
toda alteração de coluna usa `IF NOT EXISTS` na coluna antes do `ALTER TABLE`.

## Padrão de criação de tabela

```javascript
// Criar tabela (IF NOT EXISTS via OBJECT_ID)
await pool.request().query(`
  IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='prefixo_nome' AND xtype='U')
  CREATE TABLE prefixo_nome (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    campo1      NVARCHAR(255)     NOT NULL,
    campo2      NVARCHAR(MAX)     NULL,
    ativo       BIT               NOT NULL DEFAULT 1,
    criado_por  NVARCHAR(100)     NOT NULL,
    criado_em   DATETIME          NOT NULL DEFAULT GETDATE()
  )
`);
```

## Padrão de adição de coluna (migração)

```javascript
// Adicionar coluna sem derrubar tabela existente (ALTER TABLE seguro)
await pool.request().query(`
  IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'prefixo_nome' AND COLUMN_NAME = 'nova_coluna'
  )
  ALTER TABLE prefixo_nome ADD nova_coluna NVARCHAR(255) NULL
`);
```

## Convenções de nomenclatura de tabelas

| Módulo | Prefixo | Exemplos |
|--------|---------|---------|
| Agenda de tarefas | `agenda_` | `agenda_listas`, `agenda_tarefas`, `agenda_membros` |
| Agenda financeira | `fin_` | `fin_agendas`, `fin_contas`, `fin_membros` |
| Chamados | `chamados_` | `chamados`, `chamados_historico`, `chamados_perfis` |
| Patrimônio | `pat_` | `pat_bens`, `pat_categorias`, `pat_historico` |
| Aprovações | `aprovacoes_` | `aprovacoes`, `aprovacoes_participantes` |
| Contatos | `contatos_` | `contatos_listas`, `contatos_itens` |
| Calendários | `cal_` | `cal_calendarios`, `cal_eventos` |
| Sistema (compartilhado) | sem prefixo | `usuarios`, `sessions`, `logs_atividade`, `logs_erro` |

## Colunas padrão por tipo de tabela

```sql
-- Tabela de recurso principal
id          INT IDENTITY(1,1) PRIMARY KEY
criado_por  NVARCHAR(100) NOT NULL    -- login do usuário que criou
criado_em   DATETIME NOT NULL DEFAULT GETDATE()
ativo       BIT NOT NULL DEFAULT 1   -- soft delete quando necessário

-- Tabela de membros/permissões
recurso_id  INT NOT NULL REFERENCES tabela_principal(id)
usuario     NVARCHAR(100) NOT NULL
permissao   NVARCHAR(20) NOT NULL    -- 'leitura', 'edicao', 'dono'

-- Tabela de histórico/log
recurso_id  INT NOT NULL
usuario     NVARCHAR(100)
acao        NVARCHAR(100)
detalhes    NVARCHAR(MAX)
criado_em   DATETIME NOT NULL DEFAULT GETDATE()
```

## Tipos SQL preferidos

| Dado | Tipo SQL |
|------|----------|
| IDs internos | `INT IDENTITY(1,1) PRIMARY KEY` |
| Logins/usuários | `NVARCHAR(100)` |
| Textos curtos | `NVARCHAR(255)` |
| Textos longos / JSON | `NVARCHAR(MAX)` |
| Datas/horários | `DATETIME` |
| Flags booleanas | `BIT` |
| Valores monetários | `DECIMAL(15,2)` |
| Cores (hex) | `NVARCHAR(7)` |

## Estrutura da função de inicialização

```javascript
async function criarBancoPortal() {
  const pool = getPool();
  await pool.connect();

  // Grupos de tabelas por módulo, em ordem de dependência
  // (tabelas pai antes das filhas)
  await criarTabelasUsuarios(pool);
  await criarTabelasModuloXxx(pool);
  // ...

  console.log('Banco de dados inicializado.');
}
```

## Regras gerais

- **Nunca `DROP TABLE`** — usar `IF NOT EXISTS` para criações e `ALTER TABLE` para migrações
- **Sem FKs explícitas** opcionais — o projeto usa chaves naturais (login como string) para flexibilidade
- **Sempre `NVARCHAR`** — nunca `VARCHAR` para suportar caracteres especiais em português
- **Índices** apenas quando há consultas lentas identificadas — não antecipar
- **Ordem importa** — criar tabelas pai antes das filhas no mesmo script
