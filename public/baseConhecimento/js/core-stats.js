(function () {
  const api = window.KBApi;

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

  window.carregarEstatisticas = carregarEstatisticas;
})();
