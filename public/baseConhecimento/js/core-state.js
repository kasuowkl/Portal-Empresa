(function () {
  window.KBState = window.KBState || {
    categorias: [],
    artigos: [],
    facetas: {
      criadores: [],
      tags: []
    },
    filtros: {
      busca: '',
      categoria_id: '',
      tag: '',
      criado_por: '',
      status: '',
      fixado: ''
    },
    categoriaAtiva: null,
    artigoAtual: null,
    anexosPendentes: [],
    documentosPendentes: [],
    imagensPendentes: [],
    debounceTimer: null,
    modoEditor: 'visual',
    modoVisualizacaoArtigo: 'pagina',
    artigoHtmlCompleto: false
  };
})();
