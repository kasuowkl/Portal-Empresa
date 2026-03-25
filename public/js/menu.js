/**
 * ARQUIVO: public/js/menu.js
 * VERSÃO:  1.0.0
 * DATA:    2026-03-02
 * DESCRIÇÃO: Carrega e inicializa o menu compartilhado em todas as páginas
 *
 * COMO USAR EM QUALQUER PÁGINA:
 *   <script src="http://192.168.0.80:3000/js/menu.js"></script>
 *   E adicione <div id="menu-container"></div> no topo do body.
 *
 * HISTÓRICO:
 * 1.0.0 - 2026-03-02 - Versão inicial
 */

// ============================================================
// ENDEREÇO BASE DO PORTAL (usado para chamadas de API)
// Se o menu for usado em sistemas externos, aponta para o portal
// ============================================================
const PORTAL_BASE = window.PORTAL_URL || '';

// ============================================================
// CARREGA O MENU AO ABRIR A PÁGINA
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
  carregarMenu();
});

// ============================================================
// FUNÇÃO PRINCIPAL — carrega o HTML do menu e inicializa
// ============================================================
async function carregarMenu() {
  try {
    // 1. Carrega o HTML do menu a partir do arquivo componentes/menu.html
    const resposta = await fetch(PORTAL_BASE + '/componentes/menu.html');

    if (!resposta.ok) {
      console.error('Não foi possível carregar o menu.');
      return;
    }

    const htmlMenu = await resposta.text();

    // 2. Injeta o menu no elemento #menu-container da página
    const container = document.getElementById('menu-container');
    if (container) {
      container.innerHTML = htmlMenu;
    } else {
      // Se não tiver o container, cria e insere no início do body
      const div = document.createElement('div');
      div.id = 'menu-container';
      div.innerHTML = htmlMenu;
      document.body.insertBefore(div, document.body.firstChild);
    }

    // 3. Busca os dados da sessão para preencher o nome do usuário
    await preencherUsuario();

    // 4. Marca o botão ativo conforme a página atual
    marcarBotaoAtivo();

    // 5. Carrega o sistema de notificações popup
    carregarPopupNotificacoes();

  } catch (erro) {
    console.error('Erro ao carregar menu:', erro);
  }
}

// ============================================================
// PREENCHE O NOME DO USUÁRIO LOGADO NO MENU
// ============================================================
async function preencherUsuario() {
  try {
    const resposta = await fetch(PORTAL_BASE + '/sessao');
    const dados    = await resposta.json();

    if (!dados.logado) {
      // Sessão expirada — redireciona para login
      window.location.href = PORTAL_BASE + '/login.html';
      return;
    }

    // Exibe o nome do usuário no menu
    const elementoNome = document.getElementById('menu-texto-usuario');
    if (elementoNome) {
      elementoNome.textContent = 'Olá, ' + dados.nome.split(' ')[0];
    }

    // Mostra o botão Configurações somente para admin
    if (dados.nivel === 'admin') {
      const btnConfig = document.getElementById('menu-btn-config');
      if (btnConfig) {
        btnConfig.style.display = 'flex';
      }
    }

    // Salva dados do usuário para uso nas páginas
    window.usuarioLogado = dados;

  } catch (erro) {
    console.error('Erro ao verificar sessão:', erro);
  }
}

// ============================================================
// CARREGA O SCRIPT DE NOTIFICAÇÕES POPUP
// ============================================================
function carregarPopupNotificacoes() {
  if (document.getElementById('pnot-script')) return;
  const script = document.createElement('script');
  script.id  = 'pnot-script';
  script.src = PORTAL_BASE + '/js/popup/sistemas.js';
  document.body.appendChild(script);
}

// ============================================================
// MARCA O BOTÃO DO MENU CORRESPONDENTE À PÁGINA ATUAL
// ============================================================
function marcarBotaoAtivo() {
  const caminhoAtual = window.location.pathname;
  const botoes       = document.querySelectorAll('.menu-btn');

  botoes.forEach(function (botao) {
    const href = botao.getAttribute('href');
    if (href && caminhoAtual.startsWith(href) && href !== '#') {
      botao.classList.add('menu-btn-ativo');
    }
  });
}

// ============================================================
// ABRE O PAINEL DE SISTEMAS (chamada pelo botão Sistemas)
// ============================================================
function abrirSistemas(evento) {
  if (evento) evento.preventDefault();

  // Se já existe o painel, fecha
  const painelExistente = document.getElementById('painel-sistemas');
  if (painelExistente) {
    painelExistente.remove();
    return;
  }

  // Busca a lista de sistemas no servidor
  fetch(PORTAL_BASE + '/sistemas')
    .then(function (r) { return r.json(); })
    .then(function (dados) {
      mostrarPainelFlutuante('sistemas', 'Sistemas', dados.sistemas || []);
    })
    .catch(function () {
      alert('Não foi possível carregar os sistemas.');
    });
}

// ============================================================
// ABRE O PAINEL DE SERVIÇOS (chamada pelo botão Serviços)
// ============================================================
function abrirServicos(evento) {
  if (evento) evento.preventDefault();

  const painelExistente = document.getElementById('painel-sistemas');
  if (painelExistente) {
    painelExistente.remove();
    return;
  }

  fetch(PORTAL_BASE + '/servicos')
    .then(function (r) { return r.json(); })
    .then(function (dados) {
      mostrarPainelFlutuante('sistemas', 'Serviços', dados.servicos || []);
    })
    .catch(function () {
      alert('Não foi possível carregar os serviços.');
    });
}

// ============================================================
// CRIA UM PAINEL FLUTUANTE COM A LISTA DE ITENS
// ============================================================
function mostrarPainelFlutuante(id, titulo, itens) {
  // Remove painel anterior se existir
  const anterior = document.getElementById('painel-' + id);
  if (anterior) anterior.remove();

  const painel = document.createElement('div');
  painel.id    = 'painel-' + id;
  painel.className = 'painel-flutuante';

  let conteudo = '<div class="painel-titulo">' + titulo + '</div>';

  if (itens.length === 0) {
    conteudo += '<div class="painel-vazio">Nenhum item cadastrado.</div>';
  } else {
    itens.forEach(function (item) {
      conteudo += `
        <a href="${item.url}" class="painel-item" target="_blank" rel="noopener noreferrer">
          <i class="fas ${item.icone || 'fa-window-maximize'}"></i>
          <div>
            <strong>${item.nome}</strong>
            <small>${item.descricao || ''}</small>
          </div>
        </a>`;
    });
  }

  // Botão para fechar o painel
  conteudo += '<button class="painel-fechar" onclick="document.getElementById(\'painel-' + id + '\').remove()">Fechar</button>';

  painel.innerHTML = conteudo;
  document.body.appendChild(painel);

  // Fecha o painel ao clicar fora dele
  setTimeout(function () {
    document.addEventListener('click', function fecharFora(e) {
      if (!painel.contains(e.target) && !e.target.closest('.menu-btn')) {
        painel.remove();
        document.removeEventListener('click', fecharFora);
      }
    });
  }, 100);
}
