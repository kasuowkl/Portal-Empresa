(function () {
  const state = window.KBState;
  const api = window.KBApi;

  async function carregarArtigos() {
    try {
      state.artigos = await api.listarArtigos({
        categoriaId: state.categoriaAtiva,
        busca: document.getElementById('busca-input').value.trim()
      });
      renderizarArtigos();
    } catch (erro) {
      console.error('Erro ao carregar artigos:', erro);
    }
  }

  function renderizarArtigos() {
    const lista = document.getElementById('artigos-lista');
    if (state.artigos.length === 0) {
      lista.innerHTML = `
        <div class="kb-vazio">
          <i class="fas fa-book-open"></i>
          <p>Nenhum artigo encontrado</p>
          <p>Crie o primeiro artigo clicando em "Novo Artigo"</p>
        </div>
      `;
      return;
    }

    let html = '';
    for (const art of state.artigos) {
      const preview = stripHtml(art.conteudo).substring(0, 160);
      const tags = art.tags ? art.tags.split(',').map((t) => `<span class="kb-tag">${esc(t.trim())}</span>`).join('') : '';
      const catBadge = art.categoria_nome ? `<span class="kb-cat-badge" style="background:${art.categoria_cor}"><i class="${art.categoria_icone}"></i> ${esc(art.categoria_nome)}</span>` : '';
      const data = new Date(art.criado_em).toLocaleDateString('pt-BR');

      html += `
        <div class="kb-artigo-card ${art.fixado ? 'fixado' : ''}" onclick="abrirArtigo(${art.id})">
          <div class="kb-artigo-titulo">
            ${art.fixado ? '<i class="fas fa-thumbtack pin-icon"></i>' : ''}
            ${esc(art.titulo)}
          </div>
          <div class="kb-artigo-preview">${esc(preview)}</div>
          <div class="kb-artigo-meta">
            ${catBadge}
            ${tags}
            <span><i class="fas fa-user"></i> ${esc(art.criado_por)}</span>
            <span><i class="fas fa-calendar"></i> ${data}</span>
            <span><i class="fas fa-eye"></i> ${art.visualizacoes}</span>
            <span><i class="fas fa-thumbs-up"></i> ${art.likes}</span>
          </div>
        </div>
      `;
    }

    lista.innerHTML = html;
    window.renderizarCategorias();
  }

  function buscarArtigos() {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => carregarArtigos(), 300);
  }

  async function abrirArtigo(id) {
    try {
      const art = await api.obterArtigo(id);
      if (art.erro) return toast(art.erro, 'erro');

      state.artigoAtual = art;
      document.getElementById('view-titulo').textContent = art.titulo;

      let metaHtml = `
        <span><i class="fas fa-user"></i> ${esc(art.criado_por)}</span>
        <span><i class="fas fa-calendar"></i> ${new Date(art.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
        <span><i class="fas fa-eye"></i> ${art.visualizacoes} visualizacoes</span>
      `;
      if (art.categoria_nome) {
        metaHtml += `<span class="kb-cat-badge" style="background:${art.categoria_cor}"><i class="${art.categoria_icone}"></i> ${esc(art.categoria_nome)}</span>`;
      }
      if (art.tags) {
        metaHtml += art.tags.split(',').map((t) => `<span class="kb-tag">${esc(t.trim())}</span>`).join('');
      }
      document.getElementById('view-meta').innerHTML = metaHtml;
      document.getElementById('view-acoes').innerHTML = `
        <button class="kb-btn kb-btn-secundario kb-btn-sm" onclick="editarArtigo(${art.id})"><i class="fas fa-pen"></i> Editar</button>
        <button class="kb-btn kb-btn-perigo kb-btn-sm" onclick="excluirArtigo(${art.id})"><i class="fas fa-trash"></i> Excluir</button>
      `;
      document.getElementById('view-conteudo').innerHTML = art.conteudo;

      if (art.anexos && art.anexos.length > 0) {
        document.getElementById('view-anexos').style.display = 'block';
        document.getElementById('view-anexos-lista').innerHTML = art.anexos.map((a) => `
          <a class="kb-anexo-item" href="/api/conhecimento/anexos/${a.id}" target="_blank">
            <i class="fas fa-file"></i> ${esc(a.nome_original)}
            ${a.tamanho ? `<small>(${formatarTamanho(a.tamanho)})</small>` : ''}
          </a>
        `).join('');
      } else {
        document.getElementById('view-anexos').style.display = 'none';
      }

      document.getElementById('like-count').textContent = art.likes;
      document.getElementById('dislike-count').textContent = art.dislikes;
      document.getElementById('btn-like').className = `kb-btn-avaliacao${art.minha_avaliacao === true ? ' ativo-sim' : ''}`;
      document.getElementById('btn-dislike').className = `kb-btn-avaliacao${art.minha_avaliacao === false ? ' ativo-nao' : ''}`;

      document.getElementById('artigos-lista').style.display = 'none';
      document.getElementById('artigo-view').classList.add('visivel');
      document.querySelector('.kb-main-header').style.display = 'none';
    } catch (erro) {
      toast('Erro ao abrir artigo.', 'erro');
    }
  }

  function voltarLista() {
    document.getElementById('artigos-lista').style.display = 'block';
    document.getElementById('artigo-view').classList.remove('visivel');
    document.querySelector('.kb-main-header').style.display = 'flex';
    state.artigoAtual = null;
    carregarArtigos();
  }

  function limparFormularioArtigo() {
    document.getElementById('artigo-id').value = '';
    document.getElementById('artigo-titulo').value = '';
    setEditorHtml('');
    document.getElementById('artigo-categoria').value = '';
    document.getElementById('artigo-tags').value = '';
    document.getElementById('artigo-status').value = 'publicado';
    document.getElementById('artigo-fixado').value = '0';
    document.getElementById('artigo-anexos-lista').innerHTML = '';
    document.getElementById('artigo-anexos').value = '';
    state.anexosPendentes = [];
  }

  function abrirModalArtigo() {
    limparFormularioArtigo();
    document.getElementById('modal-artigo-titulo').textContent = 'Novo Artigo';
    window.atualizarSelectCategorias();
    abrirModal('modal-artigo');
  }

  async function editarArtigo(id) {
    const art = state.artigoAtual || state.artigos.find((item) => item.id === id);
    if (!art) return;

    let artigo = art;
    if (!art.conteudo) {
      artigo = await api.obterArtigo(id);
    }

    document.getElementById('artigo-id').value = artigo.id;
    document.getElementById('artigo-titulo').value = artigo.titulo;
    setEditorHtml(artigo.conteudo || '');
    document.getElementById('artigo-categoria').value = artigo.categoria_id || '';
    document.getElementById('artigo-tags').value = artigo.tags || '';
    document.getElementById('artigo-status').value = artigo.status;
    document.getElementById('artigo-fixado').value = artigo.fixado ? '1' : '0';
    document.getElementById('artigo-anexos-lista').innerHTML = '';
    state.anexosPendentes = [];
    document.getElementById('modal-artigo-titulo').textContent = 'Editar Artigo';
    window.atualizarSelectCategorias();
    abrirModal('modal-artigo');
  }

  async function salvarArtigo() {
    const id = document.getElementById('artigo-id').value;
    const titulo = document.getElementById('artigo-titulo').value.trim();
    const conteudo = getEditorHtml().trim();
    if (!titulo || !conteudo) return toast('Titulo e conteudo sao obrigatorios.', 'erro');

    const fileInput = document.getElementById('artigo-anexos');
    const anexos = [];
    for (const file of Array.from(fileInput.files || [])) {
      const dados = await lerArquivoBase64(file);
      anexos.push({ nome: file.name, tipo: file.type, tamanho: file.size, dados });
    }

    const conteudoResolvido = resolverImagensNoConteudo(conteudo);
    const conteudoFinal = contemHtml(conteudoResolvido) ? conteudoResolvido : textoParaHtml(conteudoResolvido);

    const dados = {
      titulo,
      conteudo: conteudoFinal,
      categoria_id: document.getElementById('artigo-categoria').value || null,
      tags: document.getElementById('artigo-tags').value.trim(),
      status: document.getElementById('artigo-status').value,
      fixado: document.getElementById('artigo-fixado').value === '1',
      anexos: !id ? anexos : undefined
    };

    try {
      const resposta = await api.salvarArtigo(id, dados);
      if (resposta.erro) return toast(resposta.erro, 'erro');

      if (id && anexos.length > 0) {
        for (const anexo of anexos) {
          await api.anexarArquivo(id, anexo);
        }
      }

      fecharModal('modal-artigo');
      toast(id ? 'Artigo atualizado!' : 'Artigo criado!');
      await carregarArtigos();
      await window.carregarCategorias();
      await carregarEstatisticas();

      if (state.artigoAtual && id) {
        await abrirArtigo(parseInt(id, 10));
      }
    } catch (erro) {
      toast('Erro ao salvar artigo.', 'erro');
    }
  }

  async function excluirArtigo(id) {
    if (!confirm('Tem certeza que deseja excluir este artigo?')) return;
    try {
      const resposta = await api.excluirArtigo(id);
      if (resposta.erro) return toast(resposta.erro, 'erro');
      toast('Artigo excluido!');
      voltarLista();
      await window.carregarCategorias();
      await carregarEstatisticas();
    } catch (erro) {
      toast('Erro ao excluir.', 'erro');
    }
  }

  async function avaliarArtigo(util) {
    if (!state.artigoAtual) return;
    try {
      const resposta = await api.avaliarArtigo(state.artigoAtual.id, util);
      if (resposta.erro) return toast(resposta.erro, 'erro');
      document.getElementById('like-count').textContent = resposta.likes;
      document.getElementById('dislike-count').textContent = resposta.dislikes;
      document.getElementById('btn-like').className = `kb-btn-avaliacao${util === true ? ' ativo-sim' : ''}`;
      document.getElementById('btn-dislike').className = `kb-btn-avaliacao${util === false ? ' ativo-nao' : ''}`;
      state.artigoAtual.minha_avaliacao = util;
    } catch (erro) {
      toast('Erro ao avaliar.', 'erro');
    }
  }

  async function carregarEstatisticas() {
    try {
      const stats = await api.estatisticas();
      document.getElementById('stat-artigos').textContent = stats.total_artigos;
      document.getElementById('stat-categorias').textContent = stats.total_categorias;
      document.getElementById('stat-views').textContent = stats.total_visualizacoes;
      document.getElementById('stat-likes').textContent = stats.total_likes;
    } catch (erro) {
      console.error('Erro ao carregar estatisticas:', erro);
    }
  }

  window.carregarArtigos = carregarArtigos;
  window.renderizarArtigos = renderizarArtigos;
  window.buscarArtigos = buscarArtigos;
  window.abrirArtigo = abrirArtigo;
  window.voltarLista = voltarLista;
  window.abrirModalArtigo = abrirModalArtigo;
  window.editarArtigo = editarArtigo;
  window.salvarArtigo = salvarArtigo;
  window.excluirArtigo = excluirArtigo;
  window.avaliarArtigo = avaliarArtigo;
  window.carregarEstatisticas = carregarEstatisticas;
})();
