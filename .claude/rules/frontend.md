---
description: Padrões para páginas HTML de módulos do Portal WKL
paths:
  - public/**/*.html
---

# Regras para Frontend HTML (public/**/*.html)

## Estrutura base de toda página de módulo

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nome do Módulo — Portal WKL</title>
  <link rel="stylesheet" href="/css/style.css">
  <link rel="stylesheet" href="/css/menu.css">
  <link rel="stylesheet" href="/modulo/css/modulo.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
  <div id="menu-container"></div>

  <main class="conteudo-principal">
    <!-- conteúdo do módulo aqui -->
  </main>

  <script src="/js/menu.js"></script>
  <script>
    // lógica do módulo
  </script>
</body>
</html>
```

## CSS Variables obrigatórias (dark mode)

```css
/* Usar SEMPRE estas variáveis — nunca hardcode de cor */
var(--cor-fundo)          /* #0f0f1f — fundo da página */
var(--cor-fundo-2)        /* #1a1a2e — cards e painéis */
var(--cor-borda)          /* #3d3d5c — bordas e divisores */
var(--cor-texto)          /* #e0e0e0 — texto principal */
var(--cor-texto-fraco)    /* #808080 — texto secundário/placeholder */
var(--cor-destaque)       /* #3b82f6 — botões primários, links ativos */
var(--cor-sucesso)        /* #4caf50 — confirmações, status ok */
var(--cor-erro)           /* #e94560 — erros, exclusões */
var(--raio)               /* 8px — border-radius padrão */
var(--sombra)             /* sombra padrão de cards */
var(--altura-menu)        /* 64px — altura da barra de menu */
```

## Injeção do menu (obrigatório em toda página)

```javascript
// menu.js já cuida disso — apenas incluir o script e o container
// O script /js/menu.js faz:
// 1. GET /sessao → define window.usuarioLogado
// 2. GET /componentes/menu.html → injeta em #menu-container
// 3. Inicializa interações do menu
```

## Acesso à sessão do usuário

```javascript
// Disponível após menu.js inicializar:
window.usuarioLogado  // { usuario, nome, perfil, email, ... }

// Para garantir que está disponível:
document.addEventListener('DOMContentLoaded', async () => {
  // menu.js popula window.usuarioLogado antes de resolver
});
```

## Padrão de fetch para APIs

```javascript
// GET
const dados = await fetch('/api/modulo/lista').then(r => r.json());

// POST
const resp = await fetch('/api/modulo', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ campo: valor })
}).then(r => r.json());

if (resp.erro) {
  mostrarErro(resp.erro);
  return;
}
// usar resp.item ou resp.dados

// PUT
await fetch(`/api/modulo/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ campo: valor })
});

// DELETE
await fetch(`/api/modulo/${id}`, { method: 'DELETE' });
```

## Padrão de modal

```html
<div id="modal-xxx" class="modal oculto">
  <div class="modal-box">
    <div class="modal-header">
      <h3>Título do Modal</h3>
      <button onclick="fecharModal()" class="btn-fechar">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="modal-body">
      <!-- conteúdo -->
    </div>
    <div class="modal-footer">
      <button onclick="fecharModal()" class="btn-secundario">Cancelar</button>
      <button onclick="confirmarAcao()" class="btn-primario">Confirmar</button>
    </div>
  </div>
</div>
```

```javascript
function abrirModal(id) {
  document.getElementById(id).classList.remove('oculto');
}
function fecharModal(id) {
  document.getElementById(id).classList.add('oculto');
}
```

## Padrão de feedback ao usuário

```javascript
function mostrarMensagem(texto, tipo = 'sucesso') {
  const el = document.getElementById('mensagem-feedback');
  el.textContent = texto;
  el.className = `feedback feedback-${tipo}`; // sucesso | erro | aviso
  el.classList.remove('oculto');
  setTimeout(() => el.classList.add('oculto'), 3000);
}
```

## Regras gerais

- **Sem frameworks JS** — apenas Vanilla JS e Fetch API
- **Font Awesome via CDN** — único recurso externo permitido
- **CSS inline mínimo** — preferir arquivo CSS dedicado na pasta do módulo
- **`oculto`** para esconder elementos (não `display:none` inline)
- **IDs únicos** por página — nunca reutilizar IDs entre componentes
- **Nomes em português** — IDs, classes e funções JS em pt-BR seguindo padrão do projeto
- **Validação client-side** — validar formulários antes de enviar ao servidor
- **Loading state** — desabilitar botão e mostrar spinner durante operações async
