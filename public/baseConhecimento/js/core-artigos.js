(function () {
  const state = window.KBState;
  const api = window.KBApi;

  function obterEl(id) {
    return document.getElementById(id);
  }

  function sincronizarBusca(origemId) {
    const buscaSidebar = obterEl('busca-input');
    const buscaTopo = obterEl('busca-avancada-input');
    const valor = origemId === 'busca-input'
      ? (buscaSidebar ? buscaSidebar.value : '')
      : (buscaTopo ? buscaTopo.value : '');

    if (buscaSidebar && origemId !== 'busca-input') buscaSidebar.value = valor;
    if (buscaTopo && origemId !== 'busca-avancada-input') buscaTopo.value = valor;
    state.filtros.busca = (valor || '').trim();
  }

  function atualizarTituloSecao() {
    const temFiltrosExtras = !!(state.filtros.busca || state.filtros.tag || state.filtros.criado_por || state.filtros.status || state.filtros.fixado);
    const cat = state.categorias.find((item) => item.id === state.categoriaAtiva);
    let titulo = cat ? cat.nome : 'Todos os Artigos';
    if (!cat && temFiltrosExtras) titulo = 'Resultados da Busca';
    obterEl('titulo-secao').textContent = titulo;
  }

  function coletarFiltrosDaTela() {
    sincronizarBusca('busca-avancada-input');
    const categoriaSelecionada = obterEl('filtro-categoria') ? obterEl('filtro-categoria').value : '';
    state.categoriaAtiva = categoriaSelecionada ? parseInt(categoriaSelecionada, 10) : null;
    state.filtros.categoria_id = categoriaSelecionada;
    state.filtros.tag = obterEl('filtro-tag') ? obterEl('filtro-tag').value : '';
    state.filtros.criado_por = obterEl('filtro-criador') ? obterEl('filtro-criador').value : '';
    state.filtros.status = obterEl('filtro-status') ? obterEl('filtro-status').value : '';
    state.filtros.fixado = obterEl('filtro-fixado') && obterEl('filtro-fixado').checked ? '1' : '';
    atualizarTituloSecao();
  }

  async function carregarFacetas() {
    try {
      const dados = await api.listarFiltros();
      state.facetas.criadores = dados.criadores || [];
      state.facetas.tags = dados.tags || [];
      preencherFiltros();
    } catch (erro) {
      console.error('Erro ao carregar filtros:', erro);
    }
  }

  function preencherFiltros() {
    const selectCategoria = obterEl('filtro-categoria');
    const selectTag = obterEl('filtro-tag');
    const selectCriador = obterEl('filtro-criador');
    if (selectCategoria) {
      const valorAtual = state.categoriaAtiva ? String(state.categoriaAtiva) : '';
      selectCategoria.innerHTML = '<option value="">Todas as categorias</option>' +
        state.categorias.map((cat) => '<option value="' + cat.id + '">' + esc(cat.nome) + '</option>').join('');
      selectCategoria.value = valorAtual;
    }
    if (selectTag) {
      const valorAtualTag = state.filtros.tag || '';
      selectTag.innerHTML = '<option value="">Todas as tags</option>' +
        state.facetas.tags.map((tag) => '<option value="' + esc(tag) + '">' + esc(tag) + '</option>').join('');
      selectTag.value = valorAtualTag;
    }
    if (selectCriador) {
      const valorAtualCriador = state.filtros.criado_por || '';
      selectCriador.innerHTML = '<option value="">Todos os criadores</option>' +
        state.facetas.criadores.map((criador) => '<option value="' + esc(criador) + '">' + esc(criador) + '</option>').join('');
      selectCriador.value = valorAtualCriador;
    }
  }

  async function carregarArtigos() {
    try {
      const params = new URLSearchParams();
      if (state.categoriaAtiva) params.set('categoria_id', state.categoriaAtiva);
      if (state.filtros.busca) params.set('busca', state.filtros.busca);
      if (state.filtros.tag) params.set('tag', state.filtros.tag);
      if (state.filtros.criado_por) params.set('criado_por', state.filtros.criado_por);
      if (state.filtros.status) params.set('status', state.filtros.status);
      if (state.filtros.fixado) params.set('fixado', state.filtros.fixado);
      state.artigos = await api.listarArtigos('/api/conhecimento/artigos?' + params.toString());
      renderizarArtigos();
    } catch (erro) {
      console.error('Erro ao carregar artigos:', erro);
    }
  }

  function renderizarArtigos() {
    const lista = document.getElementById('artigos-lista');
    if (state.artigos.length === 0) {
      lista.innerHTML = '<div class="kb-vazio"><i class="fas fa-book-open"></i><p>Nenhum artigo encontrado</p><p>Crie o primeiro artigo clicando em "Novo Artigo"</p></div>';
      return;
    }

    let html = '';
    for (const art of state.artigos) {
      const preview = stripHtml(art.conteudo).substring(0, 160);
      const tags = art.tags ? art.tags.split(',').map((t) => '<span class="kb-tag">' + esc(t.trim()) + '</span>').join('') : '';
      const catBadge = art.categoria_nome ? '<span class="kb-cat-badge" style="background:' + art.categoria_cor + '"><i class="' + art.categoria_icone + '"></i> ' + esc(art.categoria_nome) + '</span>' : '';
      const statusBadge = art.status === 'rascunho' ? '<span class="kb-tag" style="background:rgba(245,158,11,0.12);color:#f59e0b;border:1px solid rgba(245,158,11,0.25)">Rascunho</span>' : '';
      const data = new Date(art.criado_em).toLocaleDateString('pt-BR');
      const chipsFiltro =
        '<div class="kb-artigo-filtros">' +
          (art.fixado ? '<span class="kb-artigo-chip"><i class="fas fa-thumbtack"></i> Fixado</span>' : '') +
          (art.categoria_nome ? '<span class="kb-artigo-chip"><i class="' + art.categoria_icone + '"></i> ' + esc(art.categoria_nome) + '</span>' : '') +
          (art.tags ? art.tags.split(',').slice(0, 2).map((t) => '<span class="kb-artigo-chip"><i class="fas fa-tag"></i> ' + esc(t.trim()) + '</span>').join('') : '') +
        '</div>';

      html +=
        '<div class="kb-artigo-card ' + (art.fixado ? 'fixado' : '') + '" onclick="abrirArtigo(' + art.id + ')">' +
          '<div class="kb-artigo-header">' +
            '<div class="kb-artigo-titulo">' +
              (art.fixado ? '<i class="fas fa-thumbtack pin-icon"></i>' : '') +
              esc(art.titulo) +
            '</div>' +
            chipsFiltro +
          '</div>' +
          '<div class="kb-artigo-preview">' + esc(preview) + '</div>' +
          '<div class="kb-artigo-meta">' +
            catBadge + statusBadge + tags +
            '<span><i class="fas fa-user"></i> ' + esc(art.criado_por) + '</span>' +
            '<span><i class="fas fa-calendar"></i> ' + data + '</span>' +
            '<span><i class="fas fa-eye"></i> ' + art.visualizacoes + '</span>' +
            '<span><i class="fas fa-thumbs-up"></i> ' + art.likes + '</span>' +
          '</div>' +
        '</div>';
    }

    lista.innerHTML = html;
    window.renderizarCategorias();
  }

  function renderizarArquivosSelecionados(inputId, listaId) {
    const input = document.getElementById(inputId);
    const lista = document.getElementById(listaId);
    if (!input || !lista) return;
    const arquivos = Array.from(input.files || []);
    const arquivosPendentes = listaId === 'artigo-documentos-lista'
      ? (state.documentosPendentes || []).map((item) => item.file)
      : [];
    const todosArquivos = [...arquivosPendentes, ...arquivos];
    if (!todosArquivos.length) {
      lista.innerHTML = '';
      return;
    }
    lista.innerHTML = todosArquivos.map((file) =>
      '<div class="kb-anexo-item"><i class="fas fa-file"></i> ' + esc(file.name) +
      ' <small>(' + formatarTamanho(file.size || 0) + ')</small>' +
      (file._origemClipboard ? ' <small>[clipboard]</small>' : '') +
      '</div>'
    ).join('');
  }

  function obterTipoDocumento(tipoMime, nomeArquivo) {
    const nome = String(nomeArquivo || '').toLowerCase();
    const tipo = String(tipoMime || '').toLowerCase();
    if (tipo === 'application/pdf' || nome.endsWith('.pdf')) return 'pdf';
    if (tipo === 'application/msword' || tipo === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || nome.endsWith('.doc') || nome.endsWith('.docx')) return 'doc';
    if (tipo === 'application/vnd.ms-powerpoint' || tipo === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || nome.endsWith('.ppt') || nome.endsWith('.pptx') || nome.endsWith('.ptt')) return 'ppt';
    return 'arquivo';
  }

  function gerarHtmlIncorporadoDocumento(anexo) {
    const tipo = obterTipoDocumento(anexo.tipo_mime, anexo.nome_original);
    const nome = esc(anexo.nome_original || 'Documento');
    const urlBase = '/api/conhecimento/anexos/' + anexo.id;
    const urlAbrir = urlBase + '?inline=1';
    const icone = tipo === 'pdf' ? 'fa-file-pdf' : (tipo === 'doc' ? 'fa-file-word' : 'fa-file-powerpoint');
    const rotulo = tipo === 'pdf' ? 'PDF incorporado' : (tipo === 'doc' ? 'Documento Word anexado' : 'Apresentacao anexada');

    if (tipo === 'pdf') {
      return '' +
        '<div class="kb-doc-embed kb-doc-embed-pdf">' +
          '<div class="kb-doc-embed-header">' +
            '<div class="kb-doc-embed-meta"><i class="fas ' + icone + '"></i><div><strong>' + nome + '</strong><small>' + rotulo + '</small></div></div>' +
            '<div class="kb-doc-embed-acoes">' +
              '<a class="kb-anexo-item" href="' + urlAbrir + '" target="_blank" rel="noopener noreferrer"><i class="fas fa-up-right-from-square"></i> Abrir</a>' +
              '<a class="kb-anexo-item" href="' + urlBase + '" target="_blank" rel="noopener noreferrer"><i class="fas fa-download"></i> Baixar</a>' +
            '</div>' +
          '</div>' +
          '<div class="kb-doc-embed-body">O PDF original foi anexado ao artigo. Use <b>Abrir</b> para visualizar ou <b>Baixar</b> para salvar.</div>' +
        '</div>';
    }

    return '' +
      '<div class="kb-doc-embed kb-doc-embed-arquivo">' +
        '<div class="kb-doc-embed-header">' +
          '<div class="kb-doc-embed-meta"><i class="fas ' + icone + '"></i><div><strong>' + nome + '</strong><small>' + rotulo + '</small></div></div>' +
          '<div class="kb-doc-embed-acoes">' +
            '<a class="kb-anexo-item" href="' + urlAbrir + '" target="_blank" rel="noopener noreferrer"><i class="fas fa-up-right-from-square"></i> Abrir</a>' +
            '<a class="kb-anexo-item" href="' + urlBase + '" target="_blank" rel="noopener noreferrer"><i class="fas fa-download"></i> Baixar</a>' +
          '</div>' +
        '</div>' +
        '<div class="kb-doc-embed-body">A visualizacao embutida ainda nao esta disponivel para este formato no navegador. Use Abrir ou Baixar.</div>' +
      '</div>';
  }

  function substituirMarcadoresDocumentos(conteudo, anexosIncorporados) {
    if (!conteudo || !anexosIncorporados || !anexosIncorporados.length) return conteudo;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = conteudo;
    const mapa = new Map(anexosIncorporados.map((item) => [item.token, item]));

    wrapper.querySelectorAll('[data-kb-doc-token]').forEach((el) => {
      const token = el.getAttribute('data-kb-doc-token');
      const item = mapa.get(token);
      if (item && item.html) {
        el.outerHTML = item.html;
      } else if (item && item.anexo) {
        el.outerHTML = gerarHtmlIncorporadoDocumento(item.anexo);
      }
    });

    return wrapper.innerHTML;
  }

  function normalizarEmbedsPdf(conteudo) {
    if (!conteudo || conteudo.indexOf('kb-doc-embed-pdf') === -1) return conteudo;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = conteudo;

    wrapper.querySelectorAll('.kb-doc-embed-pdf').forEach((embed) => {
      const body = embed.querySelector('.kb-doc-embed-body');
      const origem =
        embed.querySelector('a[href*="/api/conhecimento/anexos/"]')?.getAttribute('href') ||
        embed.querySelector('iframe[src*="/api/conhecimento/anexos/"]')?.getAttribute('src') ||
        '';
      const match = String(origem).match(/\/api\/conhecimento\/anexos\/(\d+)/i);

      embed.querySelectorAll('.kb-doc-embed-viewer, iframe, object, embed, canvas').forEach((el) => el.remove());
      if (!embed.querySelector('.kb-doc-embed-body')) {
        const corpo = document.createElement('div');
        corpo.className = 'kb-doc-embed-body kb-doc-converted-body';
        corpo.innerHTML = match
          ? 'Convertendo conteúdo do PDF...'
          : 'O PDF original foi anexado ao artigo. Use <b>Abrir</b> para visualizar ou <b>Baixar</b> para salvar.';
        if (match) corpo.setAttribute('data-kb-pdf-html-id', match[1]);
        embed.appendChild(corpo);
      } else if (match) {
        body.classList.add('kb-doc-converted-body');
        body.setAttribute('data-kb-pdf-html-id', match[1]);
        body.innerHTML = 'Convertendo conteúdo do PDF...';
      }
    });

    return wrapper.innerHTML;
  }

  function normalizarMarcadoresPdfPendentes(conteudo, anexos) {
    const anexosPdf = (anexos || []).filter((anexo) => obterTipoDocumento(anexo.tipo_mime, anexo.nome_original) === 'pdf');
    if (!conteudo || !anexosPdf.length) return conteudo;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = conteudo;
    let indicePdf = 0;

    const candidatos = Array.from(wrapper.querySelectorAll('[data-kb-doc-token], blockquote, p, div'))
      .filter((el) => {
        const texto = (el.textContent || '').toLowerCase();
        return texto.includes('pdf incorporado') ||
          (texto.includes('convertido em conteudo legivel ao salvar') && texto.includes('.pdf'));
      });

    candidatos.forEach((el) => {
      const anexo = anexosPdf[indicePdf] || anexosPdf[anexosPdf.length - 1];
      if (!anexo) return;

      const urlBase = '/api/conhecimento/anexos/' + anexo.id;
      el.outerHTML =
        '<div class="kb-doc-embed kb-doc-embed-pdf">' +
          '<div class="kb-doc-embed-header">' +
            '<div class="kb-doc-embed-meta"><i class="fas fa-file-pdf"></i><div><strong>' + esc(anexo.nome_original || 'Documento PDF') + '</strong><small>Conteúdo convertido automaticamente do PDF</small></div></div>' +
            '<div class="kb-doc-embed-acoes">' +
              '<a class="kb-anexo-item" href="' + urlBase + '?inline=1" target="_blank" rel="noopener noreferrer"><i class="fas fa-up-right-from-square"></i> Abrir</a>' +
              '<a class="kb-anexo-item" href="' + urlBase + '" target="_blank" rel="noopener noreferrer"><i class="fas fa-download"></i> Baixar</a>' +
            '</div>' +
          '</div>' +
          '<div class="kb-doc-embed-body kb-doc-converted-body" data-kb-pdf-html-id="' + anexo.id + '">Convertendo conteúdo do PDF...</div>' +
        '</div>';
      indicePdf += 1;
    });

    return wrapper.innerHTML;
  }

  async function hidratarPdfsConvertidos() {
    const blocos = Array.from(document.querySelectorAll('#view-conteudo .kb-doc-converted-body[data-kb-pdf-html-id]'));
    for (const bloco of blocos) {
      const anexoId = bloco.getAttribute('data-kb-pdf-html-id');
      if (!anexoId) continue;
      try {
        const resposta = await api.obterPdfConvertido(anexoId);
        if (resposta && resposta.html) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = resposta.html;
          const novo = wrapper.firstElementChild;
          if (novo) {
            const atual = bloco.closest('.kb-doc-embed-pdf');
            if (atual) atual.replaceWith(novo);
          } else {
            bloco.innerHTML = 'Não foi possível converter o PDF.';
          }
        } else {
          bloco.innerHTML = 'Não foi possível converter o PDF.';
        }
      } catch (_) {
        bloco.innerHTML = 'Não foi possível converter o PDF.';
      }
    }
  }

  function buscarArtigos() {
    sincronizarBusca('busca-avancada-input');
    atualizarTituloSecao();
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => carregarArtigos(), 300);
  }

  function buscarArtigosSidebar() {
    sincronizarBusca('busca-input');
    atualizarTituloSecao();
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => carregarArtigos(), 300);
  }

  function aplicarFiltrosConhecimento() {
    coletarFiltrosDaTela();
    window.renderizarCategorias();
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => carregarArtigos(), 120);
  }

  function limparFiltrosConhecimento() {
    if (obterEl('busca-input')) obterEl('busca-input').value = '';
    if (obterEl('busca-avancada-input')) obterEl('busca-avancada-input').value = '';
    if (obterEl('filtro-categoria')) obterEl('filtro-categoria').value = '';
    if (obterEl('filtro-tag')) obterEl('filtro-tag').value = '';
    if (obterEl('filtro-criador')) obterEl('filtro-criador').value = '';
    if (obterEl('filtro-status')) obterEl('filtro-status').value = '';
    if (obterEl('filtro-fixado')) obterEl('filtro-fixado').checked = false;
    state.categoriaAtiva = null;
    state.filtros = { busca: '', categoria_id: '', tag: '', criado_por: '', status: '', fixado: '' };
    atualizarTituloSecao();
    window.renderizarCategorias();
    carregarArtigos();
  }

  function renderizarConteudoArtigoAtual() {
    if (!state.artigoAtual) return;
    const art = state.artigoAtual;
    const el = document.getElementById('view-conteudo');
    const conteudoOriginal = normalizarMarcadoresPdfPendentes(
      normalizarEmbedsPdf(art.conteudo || ''),
      art.anexos || []
    );
    const conteudoNormalizado = normalizarHtmlDocumentoCompleto(conteudoOriginal);
    const conteudoRender = ehHtmlDocumentoCompleto(conteudoNormalizado) ? conteudoNormalizado : conteudoOriginal;
    const htmlCompleto = ehHtmlDocumentoCompleto(conteudoRender);
    const temPdfIncorporado = /class=["'][^"']*kb-doc-embed-pdf/i.test(conteudoOriginal);
    const modos = document.getElementById('view-modos');
    const btnPagina = document.getElementById('btn-view-modo-pagina');
    const btnCodigo = document.getElementById('btn-view-modo-codigo');
    const btnTelaCheia = document.getElementById('btn-view-tela-cheia');

    if (modos) modos.style.display = (htmlCompleto || temPdfIncorporado || conteudoOriginal) ? 'flex' : 'none';
    if (btnPagina) btnPagina.style.display = htmlCompleto ? 'inline-flex' : 'none';
    if (btnCodigo) btnCodigo.style.display = htmlCompleto ? 'inline-flex' : 'none';
    if (btnTelaCheia) btnTelaCheia.style.display = (htmlCompleto || temPdfIncorporado || conteudoOriginal) ? 'inline-flex' : 'none';
    if (btnPagina) btnPagina.classList.toggle('ativo', state.modoVisualizacaoArtigo === 'pagina');
    if (btnCodigo) btnCodigo.classList.toggle('ativo', state.modoVisualizacaoArtigo === 'codigo');

    el.classList.remove('codigo');
    if (!htmlCompleto || state.modoVisualizacaoArtigo === 'pagina') {
      if (htmlCompleto) {
        el.innerHTML = '<div class="kb-view-frame-wrap"><iframe class="kb-view-frame" sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-downloads" referrerpolicy="no-referrer"></iframe></div>';
        const frame = el.querySelector('iframe');
        if (frame) frame.srcdoc = prepararHtmlDocumentoParaIframe(conteudoRender);
      } else {
        el.innerHTML = conteudoOriginal;
        hidratarPdfsConvertidos();
      }
      return;
    }

    el.classList.add('codigo');
    el.innerHTML = '<pre><code>' + esc(conteudoRender) + '</code></pre>';
  }

  function definirModoVisualizacaoArtigo(modo) {
    state.modoVisualizacaoArtigo = modo === 'codigo' ? 'codigo' : 'pagina';
    renderizarConteudoArtigoAtual();
  }

  async function alternarTelaCheiaArtigo() {
    const alvo = document.querySelector('#view-conteudo .kb-doc-embed') ||
      document.querySelector('#view-conteudo .kb-view-frame-wrap') ||
      document.getElementById('view-conteudo');
    if (!alvo) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await alvo.requestFullscreen();
    } catch (erro) {
      toast('Nao foi possivel abrir em tela cheia.', 'erro');
    }
  }

  async function abrirArtigo(id) {
    try {
      const art = await api.obterArtigo(id);
      if (art.erro) return toast(art.erro, 'erro');

      state.artigoAtual = art;
      document.getElementById('view-titulo').textContent = art.titulo;
      const data = new Date(art.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
      let metaHtml = '<span><i class="fas fa-user"></i> ' + esc(art.criado_por) + '</span>' +
        '<span><i class="fas fa-calendar"></i> ' + data + '</span>' +
        '<span><i class="fas fa-eye"></i> ' + art.visualizacoes + ' visualizacoes</span>';
      if (art.categoria_nome) {
        metaHtml += '<span class="kb-cat-badge" style="background:' + art.categoria_cor + '"><i class="' + art.categoria_icone + '"></i> ' + esc(art.categoria_nome) + '</span>';
      }
      if (art.tags) {
        metaHtml += art.tags.split(',').map((t) => '<span class="kb-tag">' + esc(t.trim()) + '</span>').join('');
      }
      document.getElementById('view-meta').innerHTML = metaHtml;

      let acoesHtml = '';
      if (art.pode_editar) {
        acoesHtml += '<button class="kb-btn kb-btn-secundario kb-btn-sm" onclick="editarArtigo(' + art.id + ')"><i class="fas fa-pen"></i> Editar</button>';
      }
      if (art.pode_excluir) {
        acoesHtml += '<button class="kb-btn kb-btn-perigo kb-btn-sm" onclick="excluirArtigo(' + art.id + ')"><i class="fas fa-trash"></i> Excluir</button>';
      }
      document.getElementById('view-acoes').innerHTML = acoesHtml;
      state.modoVisualizacaoArtigo = 'pagina';
      renderizarConteudoArtigoAtual();

      if (art.anexos && art.anexos.length > 0) {
        document.getElementById('view-anexos').style.display = 'block';
        document.getElementById('view-anexos-lista').innerHTML = art.anexos.map((a) => '<a class="kb-anexo-item" href="/api/conhecimento/anexos/' + a.id + '" target="_blank"><i class="fas fa-file"></i> ' + esc(a.nome_original) + (a.tamanho ? ' <small>(' + formatarTamanho(a.tamanho) + ')</small>' : '') + '</a>').join('');
      } else {
        document.getElementById('view-anexos').style.display = 'none';
      }

      document.getElementById('like-count').textContent = art.likes;
      document.getElementById('dislike-count').textContent = art.dislikes;
      document.getElementById('btn-like').className = 'kb-btn-avaliacao' + (art.minha_avaliacao === true ? ' ativo-sim' : '');
      document.getElementById('btn-dislike').className = 'kb-btn-avaliacao' + (art.minha_avaliacao === false ? ' ativo-nao' : '');
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

  function abrirModalArtigo() {
    document.getElementById('artigo-id').value = '';
    document.getElementById('artigo-titulo').value = '';
    setEditorHtml('');
    document.getElementById('artigo-categoria').value = '';
    document.getElementById('artigo-tags').value = '';
    document.getElementById('artigo-status').value = 'publicado';
    document.getElementById('artigo-fixado').value = '0';
    document.getElementById('artigo-anexos-lista').innerHTML = '';
    document.getElementById('artigo-anexos').value = '';
    document.getElementById('artigo-documentos-lista').innerHTML = '';
    document.getElementById('artigo-documentos').value = '';
    state.anexosPendentes = [];
    state.documentosPendentes = [];
    state.artigoHtmlCompleto = false;
    document.getElementById('modal-artigo-titulo').textContent = 'Novo Artigo';
    window.atualizarSelectCategorias();
    definirModoEdicaoArtigo('visual');
    definirModalArtigoMaximizado(false);
    abrirModal('modal-artigo');
  }

  async function editarArtigo(id) {
    const art = state.artigoAtual || state.artigos.find((a) => a.id === id);
    if (!art) return;
    let artigo = art;
    if (!art.conteudo) artigo = await api.obterArtigo(id);

    document.getElementById('artigo-id').value = artigo.id;
    document.getElementById('artigo-titulo').value = artigo.titulo;
    setEditorHtml(artigo.conteudo || '');
    document.getElementById('artigo-categoria').value = artigo.categoria_id || '';
    document.getElementById('artigo-tags').value = artigo.tags || '';
    document.getElementById('artigo-status').value = artigo.status;
    document.getElementById('artigo-fixado').value = artigo.fixado ? '1' : '0';
    document.getElementById('artigo-anexos-lista').innerHTML = '';
    document.getElementById('artigo-anexos').value = '';
    document.getElementById('artigo-documentos-lista').innerHTML = '';
    document.getElementById('artigo-documentos').value = '';
    state.anexosPendentes = [];
    state.documentosPendentes = [];
    document.getElementById('modal-artigo-titulo').textContent = 'Editar Artigo';
    window.atualizarSelectCategorias();
    definirModoEdicaoArtigo(
      ehHtmlDocumentoCompleto(artigo.conteudo || '')
        ? 'codigo'
        : (/<iframe\b[^>]*\/api\/conhecimento\/anexos\//i.test(artigo.conteudo || '') ? 'pagina' : 'visual')
    );
    definirModalArtigoMaximizado(false);
    abrirModal('modal-artigo');
  }

  async function salvarArtigo() {
    const id = document.getElementById('artigo-id').value;
    const titulo = document.getElementById('artigo-titulo').value.trim();
    const conteudo = getEditorHtml().trim();
    if (!titulo || !conteudo) return toast('Titulo e conteudo sao obrigatorios.', 'erro');

    const fileInput = document.getElementById('artigo-anexos');
    const docsInput = document.getElementById('artigo-documentos');
    const uploads = [];
    const documentosClipboard = state.documentosPendentes || [];
    documentosClipboard.forEach((item) => {
      if (item && item.file) {
        uploads.push({
          file: item.file,
          token: item.token || null,
          embedNoConteudo: !!item.embedNoConteudo
        });
      }
    });
    [
      ...Array.from(fileInput.files || []),
      ...Array.from(docsInput.files || [])
    ].forEach((file) => uploads.push({ file, token: null, embedNoConteudo: false }));

    const conteudoResolvido = resolverImagensNoConteudo(conteudo);
    const conteudoFinal = ehHtmlDocumentoCompleto(conteudoResolvido)
      ? conteudoResolvido
      : (contemHtml(conteudoResolvido) ? conteudoResolvido : textoParaHtml(conteudoResolvido));
    const dados = {
      titulo,
      conteudo: conteudoFinal,
      categoria_id: document.getElementById('artigo-categoria').value || null,
      tags: document.getElementById('artigo-tags').value.trim(),
      status: document.getElementById('artigo-status').value,
      fixado: document.getElementById('artigo-fixado').value === '1'
    };

    try {
      const r = await api.salvarArtigo(id, dados);
      if (r.erro) return toast(r.erro, 'erro');

      const artigoId = id || (r.item && r.item.id);
      const anexosIncorporados = [];

      if (artigoId && uploads.length > 0) {
        for (const upload of uploads) {
          const dadosArquivo = await lerArquivoBase64(upload.file);
          const respostaAnexo = await api.anexarArquivo(artigoId, {
            nome: upload.file.name,
            tipo: upload.file.type,
            tamanho: upload.file.size,
            dados: dadosArquivo
          });
          if (respostaAnexo && respostaAnexo.anexo && upload.embedNoConteudo && upload.token) {
            const nomeArquivo = String(upload.file.name || '').toLowerCase();
            const tipoArquivo = String(upload.file.type || '').toLowerCase();
            const ehPdf = tipoArquivo === 'application/pdf' || nomeArquivo.endsWith('.pdf');
            if (ehPdf) {
              const convertido = await api.obterPdfConvertido(respostaAnexo.anexo.id);
              anexosIncorporados.push({
                token: upload.token,
                anexo: respostaAnexo.anexo,
                html: convertido && convertido.html ? convertido.html : null
              });
            } else {
              anexosIncorporados.push({ token: upload.token, anexo: respostaAnexo.anexo });
            }
          }
        }
      }

      if (artigoId && anexosIncorporados.length > 0) {
        const conteudoComEmbeds = substituirMarcadoresDocumentos(conteudoFinal, anexosIncorporados);
        const atualizacao = await api.salvarArtigo(artigoId, { ...dados, conteudo: conteudoComEmbeds });
        if (atualizacao && atualizacao.erro) return toast(atualizacao.erro, 'erro');
      }

      fecharModal('modal-artigo');
      state.documentosPendentes = [];
      toast(id ? 'Artigo atualizado!' : 'Artigo criado!');
      await carregarArtigos();
      await window.carregarCategorias();
      await window.carregarEstatisticas();
      if (state.artigoAtual && artigoId) abrirArtigo(parseInt(artigoId, 10));
    } catch (erro) {
      toast('Erro ao salvar artigo.', 'erro');
    }
  }

  async function excluirArtigo(id) {
    if (!confirm('Tem certeza que deseja excluir este artigo?')) return;
    try {
      const r = await api.excluirArtigo(id);
      if (r.erro) return toast(r.erro, 'erro');
      toast('Artigo excluido!');
      voltarLista();
      await window.carregarCategorias();
      await window.carregarEstatisticas();
    } catch (erro) {
      toast('Erro ao excluir.', 'erro');
    }
  }

  async function avaliarArtigo(util) {
    if (!state.artigoAtual) return;
    try {
      const r = await api.avaliarArtigo(state.artigoAtual.id, util);
      if (r.erro) return toast(r.erro, 'erro');
      document.getElementById('like-count').textContent = r.likes;
      document.getElementById('dislike-count').textContent = r.dislikes;
      document.getElementById('btn-like').className = 'kb-btn-avaliacao' + (util === true ? ' ativo-sim' : '');
      document.getElementById('btn-dislike').className = 'kb-btn-avaliacao' + (util === false ? ' ativo-nao' : '');
      state.artigoAtual.minha_avaliacao = util;
    } catch (erro) {
      toast('Erro ao avaliar.', 'erro');
    }
  }

  window.carregarArtigos = carregarArtigos;
  window.carregarFacetas = carregarFacetas;
  window.preencherFiltros = preencherFiltros;
  window.renderizarArtigos = renderizarArtigos;
  window.renderizarArquivosSelecionados = renderizarArquivosSelecionados;
  window.buscarArtigos = buscarArtigos;
  window.buscarArtigosSidebar = buscarArtigosSidebar;
  window.aplicarFiltrosConhecimento = aplicarFiltrosConhecimento;
  window.limparFiltrosConhecimento = limparFiltrosConhecimento;
  window.definirModoVisualizacaoArtigo = definirModoVisualizacaoArtigo;
  window.alternarTelaCheiaArtigo = alternarTelaCheiaArtigo;
  window.renderizarConteudoArtigoAtual = renderizarConteudoArtigoAtual;
  window.abrirArtigo = abrirArtigo;
  window.voltarLista = voltarLista;
  window.abrirModalArtigo = abrirModalArtigo;
  window.editarArtigo = editarArtigo;
  window.salvarArtigo = salvarArtigo;
  window.excluirArtigo = excluirArtigo;
  window.avaliarArtigo = avaliarArtigo;
})();
