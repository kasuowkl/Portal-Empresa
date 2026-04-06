(function () {
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.bindEditor === 'function') {
      window.bindEditor();
    }
    window.carregarCategorias();
    window.carregarArtigos();
    window.carregarEstatisticas();
  });
})();
