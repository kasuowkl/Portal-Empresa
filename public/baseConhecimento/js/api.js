(function () {
  async function json(url, options) {
    const response = await fetch(url, options);
    return response.json();
  }

  window.KBApi = {
    listarCategorias() {
      return json('/api/conhecimento/categorias');
    },
    salvarCategoria(id, dados) {
      return json(id ? `/api/conhecimento/categorias/${id}` : '/api/conhecimento/categorias', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
    },
    excluirCategoria(id) {
      return json(`/api/conhecimento/categorias/${id}`, { method: 'DELETE' });
    },
    listarArtigos({ categoriaId, busca }) {
      const params = new URLSearchParams();
      if (categoriaId) params.set('categoria_id', categoriaId);
      if (busca) params.set('busca', busca);
      return json(`/api/conhecimento/artigos?${params.toString()}`);
    },
    obterArtigo(id) {
      return json(`/api/conhecimento/artigos/${id}`);
    },
    salvarArtigo(id, dados) {
      return json(id ? `/api/conhecimento/artigos/${id}` : '/api/conhecimento/artigos', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
    },
    excluirArtigo(id) {
      return json(`/api/conhecimento/artigos/${id}`, { method: 'DELETE' });
    },
    avaliarArtigo(id, util) {
      return json(`/api/conhecimento/artigos/${id}/avaliar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ util })
      });
    },
    anexarArquivo(artigoId, dados) {
      return json(`/api/conhecimento/artigos/${artigoId}/anexos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
    },
    estatisticas() {
      return json('/api/conhecimento/estatisticas');
    }
  };
})();
