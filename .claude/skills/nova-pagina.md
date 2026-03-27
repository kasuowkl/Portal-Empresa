Você vai criar uma nova página HTML para o Portal WKL.

Antes de escrever qualquer código, faça as seguintes perguntas ao usuário:

1. **Nome da página** — qual o título? (ex: "Relatório de Chamados")
2. **Caminho do arquivo** — onde fica? (ex: `public/chamados/relatoriosChamados.html`)
3. **Propósito** — o que o usuário faz nessa página? (listar, filtrar, visualizar, editar, etc.)
4. **Dados exibidos** — quais informações mostrar? De qual endpoint API vêm?
5. **Ações disponíveis** — botões, filtros, exportação, modais?
6. **Acesso** — qualquer usuário logado ou apenas admin?
7. **CSS específico** — precisa de arquivo CSS próprio, ou o style.css global é suficiente?

Com as respostas, crie:

1. **Arquivo HTML** com:
   - Estrutura base com `<!DOCTYPE html>`, `<meta charset="UTF-8">`, links CSS
   - `<div id="menu-container"></div>` e `<script src="/js/menu.js"></script>`
   - CSS variables dark mode (`--cor-fundo`, `--cor-texto`, etc.) — nunca hardcode
   - Fetch API para carregar dados do endpoint indicado
   - Layout responsivo com CSS Grid ou Flexbox
   - Loading state (spinner) enquanto carrega dados
   - Feedback de erro se a requisição falhar

2. **`public/<modulo>/css/<pagina>.css`** se precisar de estilos específicos (caso contrário, usar inline `<style>` compacto)

Use `public/agendaTarefas/index.html` como referência de estrutura e estilo.

Após criar, mostre o caminho do arquivo e como acessar via browser.
