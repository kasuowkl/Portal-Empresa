---
description: Padrões para fragmentos HTML do painel de configurações
paths:
  - public/fragmentos/*.html
---

# Regras para Fragmentos do Painel Admin (public/fragmentos/*.html)

## O que são fragmentos

Fragmentos são arquivos HTML parciais carregados dinamicamente como abas
dentro de `public/configuracoes.html`. Cada fragmento gerencia uma seção
das configurações do portal.

## Estrutura de um fragmento

```html
<!-- SEM <html>, <head> ou <body> — é um fragmento parcial -->
<div class="fragmento-container">
  <h2 class="fragmento-titulo">
    <i class="fas fa-icon"></i> Título da Seção
  </h2>

  <!-- Formulário de configuração -->
  <form id="form-xxx" class="form-config">
    <div class="form-grupo">
      <label for="campo">Rótulo</label>
      <input type="text" id="campo" name="campo" class="input-config" placeholder="...">
    </div>
    <div class="form-acoes">
      <button type="button" onclick="salvarXxx()" class="btn-primario">
        <i class="fas fa-save"></i> Salvar
      </button>
    </div>
  </form>

  <!-- Tabela de dados (quando aplicável) -->
  <div class="tabela-container">
    <table class="tabela-config">
      <thead>
        <tr>
          <th>Coluna</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody id="lista-xxx">
        <!-- preenchido via JS -->
      </tbody>
    </table>
  </div>
</div>

<script>
// Funções do fragmento — prefixar com nome do fragmento para evitar conflito
async function carregarXxx() { ... }
async function salvarXxx() { ... }
async function excluirXxx(id) { ... }

// Inicializar ao carregar o fragmento
carregarXxx();
</script>
```

## Padrão de fetch dentro de fragmento

```javascript
// Fragmentos não têm acesso direto ao menu.js
// mas window.usuarioLogado já está disponível quando o fragmento é carregado

async function carregarXxx() {
  const r = await fetch('/api/portal/xxx').then(r => r.json());
  const tbody = document.getElementById('lista-xxx');
  tbody.innerHTML = r.map(item => `
    <tr>
      <td>${item.campo}</td>
      <td>
        <button onclick="excluirXxx(${item.id})" class="btn-mini btn-perigo">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}
```

## Verificação de permissão admin

```javascript
// Fragmentos do painel de config só devem ser acessados por admins
// A verificação principal é no backend, mas pode reforçar no frontend:
if (window.usuarioLogado?.perfil !== 'admin') {
  document.querySelector('.fragmento-container').innerHTML =
    '<p class="sem-permissao">Acesso restrito a administradores.</p>';
  return;
}
```

## Regras específicas de fragmentos

- **Sem `<html>`, `<head>`, `<body>`** — é HTML parcial injetado via `innerHTML`
- **Prefixar funções JS** com o nome do fragmento (ex: `salvarEmail()`, não `salvar()`)
- **IDs únicos globalmente** — o fragmento coexiste com a página principal e outros fragmentos
- **Confirmar antes de excluir** — sempre usar `confirm()` ou modal de confirmação
- **Feedback inline** — mostrar mensagem de sucesso/erro dentro do próprio fragmento
- **Recarregar lista após salvar** — chamar função de carregamento após toda mutação
