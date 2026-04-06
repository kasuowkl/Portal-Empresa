(function () {
  const state = window.KBState;
  const api = window.KBApi;

  async function carregarCategorias() {
    try {
      state.categorias = await api.listarCategorias();
      renderizarCategorias();
      atualizarSelectCategorias();
    } catch (erro) {
      console.error('Erro ao carregar categorias:', erro);
    }
  }

  function renderizarCategorias() {
    const lista = document.getElementById('categorias-lista');
    const totalArtigos = state.artigos.length;
    let html =
      '<div class="kb-cat-item ' + (state.categoriaAtiva === null ? 'ativo' : '') + '" onclick="filtrarCategoria(null)" data-cat-id="todas">' +
        '<div class="kb-cat-icone" style="background: var(--cor-destaque)">' +
          '<i class="fas fa-layer-group"></i>' +
        '</div>' +
        '<div class="kb-cat-info">' +
          '<div class="kb-cat-nome">Todas</div>' +
          '<div class="kb-cat-total">' + totalArtigos + ' artigo' + (totalArtigos !== 1 ? 's' : '') + '</div>' +
        '</div>' +
      '</div>';

    for (const cat of state.categorias) {
      html +=
        '<div class="kb-cat-item ' + (state.categoriaAtiva === cat.id ? 'ativo' : '') + '" onclick="filtrarCategoria(' + cat.id + ')" data-cat-id="' + cat.id + '">' +
          '<div class="kb-cat-icone" style="background: ' + cat.cor + '">' +
            '<i class="' + cat.icone + '"></i>' +
          '</div>' +
          '<div class="kb-cat-info">' +
            '<div class="kb-cat-nome">' + esc(cat.nome) + '</div>' +
            '<div class="kb-cat-total">' + cat.total_artigos + ' artigo' + (cat.total_artigos !== 1 ? 's' : '') + '</div>' +
          '</div>' +
          '<div class="kb-cat-acoes">' +
            '<button onclick="event.stopPropagation(); editarCategoria(' + cat.id + ')" title="Editar"><i class="fas fa-pen"></i></button>' +
            '<button onclick=' + JSON.stringify('event.stopPropagation(); excluirCategoria(' + cat.id + ', ' + JSON.stringify(cat.nome || '') + ')') + ' title="Excluir"><i class="fas fa-trash"></i></button>' +
          '</div>' +
        '</div>';
    }

    lista.innerHTML = html;
  }

  function atualizarSelectCategorias() {
    const select = document.getElementById('artigo-categoria');
    select.innerHTML = '<option value="">Sem categoria</option>';
    for (const cat of state.categorias) {
      select.innerHTML += '<option value="' + cat.id + '">' + esc(cat.nome) + '</option>';
    }
  }

  function filtrarCategoria(id) {
    state.categoriaAtiva = id;
    const cat = state.categorias.find((item) => item.id === id);
    document.getElementById('titulo-secao').textContent = cat ? cat.nome : 'Todos os Artigos';
    window.carregarArtigos();
    window.voltarLista();
    renderizarCategorias();
  }

  function abrirModalCategoria() {
    document.getElementById('cat-id').value = '';
    document.getElementById('cat-nome').value = '';
    document.getElementById('cat-descricao').value = '';
    document.getElementById('cat-icone').value = 'fas fa-folder';
    document.getElementById('cat-cor').value = '#3b82f6';
    document.getElementById('modal-cat-titulo').textContent = 'Nova Categoria';
    abrirModal('modal-categoria');
  }

  function editarCategoria(id) {
    const cat = state.categorias.find((item) => item.id === id);
    if (!cat) return;
    document.getElementById('cat-id').value = cat.id;
    document.getElementById('cat-nome').value = cat.nome;
    document.getElementById('cat-descricao').value = cat.descricao || '';
    document.getElementById('cat-icone').value = cat.icone;
    document.getElementById('cat-cor').value = cat.cor;
    document.getElementById('modal-cat-titulo').textContent = 'Editar Categoria';
    abrirModal('modal-categoria');
  }

  async function salvarCategoria() {
    const id = document.getElementById('cat-id').value;
    const nome = document.getElementById('cat-nome').value.trim();
    if (!nome) return toast('Nome obrigatorio.', 'erro');

    const dados = {
      nome,
      descricao: document.getElementById('cat-descricao').value.trim(),
      icone: document.getElementById('cat-icone').value.trim() || 'fas fa-folder',
      cor: document.getElementById('cat-cor').value
    };

    try {
      const r = await api.salvarCategoria(id, dados);
      if (r.erro) return toast(r.erro, 'erro');
      fecharModal('modal-categoria');
      toast(id ? 'Categoria atualizada!' : 'Categoria criada!');
      await carregarCategorias();
      await window.carregarEstatisticas();
    } catch (erro) {
      toast('Erro ao salvar categoria.', 'erro');
    }
  }

  async function excluirCategoria(id, nome) {
    if (!confirm('Excluir a categoria "' + nome + '"?\nOs artigos serao movidos para "Sem categoria".')) return;
    try {
      const r = await api.excluirCategoria(id);
      if (r.erro) return toast(r.erro, 'erro');
      toast('Categoria excluida!');
      if (state.categoriaAtiva === id) state.categoriaAtiva = null;
      await carregarCategorias();
      await window.carregarArtigos();
      await window.carregarEstatisticas();
    } catch (erro) {
      toast('Erro ao excluir.', 'erro');
    }
  }

  window.carregarCategorias = carregarCategorias;
  window.renderizarCategorias = renderizarCategorias;
  window.atualizarSelectCategorias = atualizarSelectCategorias;
  window.filtrarCategoria = filtrarCategoria;
  window.abrirModalCategoria = abrirModalCategoria;
  window.editarCategoria = editarCategoria;
  window.salvarCategoria = salvarCategoria;
  window.excluirCategoria = excluirCategoria;
})();
