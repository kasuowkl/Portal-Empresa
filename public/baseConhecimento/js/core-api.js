(function () {
  async function json(url, options) {
    const response = await fetch(url, options);
    return response.json();
  }

  window.KBApi = {
    listarCategorias() {
      return json('/api/conhecimento/categorias');
    },
    listarFiltros() {
      return json('/api/conhecimento/filtros');
    },
    salvarCategoria(id, dados) {
      return json(id ? '/api/conhecimento/categorias/' + id : '/api/conhecimento/categorias', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
    },
    excluirCategoria(id) {
      return json('/api/conhecimento/categorias/' + id, { method: 'DELETE' });
    },
    listarArtigos(url) {
      return json(url);
    },
    obterArtigo(id) {
      return json('/api/conhecimento/artigos/' + id);
    },
    salvarArtigo(id, dados) {
      return json(id ? '/api/conhecimento/artigos/' + id : '/api/conhecimento/artigos', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
    },
    anexarArquivo(id, dados) {
      return json('/api/conhecimento/artigos/' + id + '/anexos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
    },
    obterPdfConvertido(id) {
      return json('/api/conhecimento/anexos/' + id + '/pdf-html');
    },
    excluirArtigo(id) {
      return json('/api/conhecimento/artigos/' + id, { method: 'DELETE' });
    },
    avaliarArtigo(id, util) {
      return json('/api/conhecimento/artigos/' + id + '/avaliar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ util })
      });
    },
    estatisticas() {
      return json('/api/conhecimento/estatisticas');
    }
  };
})();
