(function () {
  function alvoUsaColagemPadrao(target) {
    if (!target) return false;
    const tagName = target.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function resumirClipboard(clipboardData) {
    if (!clipboardData) return { ok: false };
    const items = Array.from(clipboardData.items || []).map((item) => item.type);
    const files = Array.from(clipboardData.files || []).map((file) => file.type);
    let html = '';
    let texto = '';
    try { html = clipboardData.getData('text/html') || ''; } catch (erro) {}
    try { texto = clipboardData.getData('text/plain') || ''; } catch (erro) {}
    return {
      ok: true,
      items,
      files,
      htmlLen: html.length,
      textLen: texto.length,
      textPreview: texto.slice(0, 80)
    };
  }

  function htmlColadoTemConteudo(htmlLimpo) {
    if (!htmlLimpo) return false;
    const texto = stripHtml(htmlLimpo).replace(/\u00a0/g, ' ').trim();
    if (texto) return true;
    return /<img\b|<table\b|<ul\b|<ol\b|<blockquote\b|<pre\b/i.test(htmlLimpo);
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.carregarCategorias();
    window.carregarArtigos();
    window.carregarEstatisticas();

    const editor = window.getEditor();
    editor.setAttribute('tabindex', '0');
    editor.addEventListener('input', window.syncEditorSource);
    editor.addEventListener('paste', async (event) => {
      const clipboardData = event.clipboardData || window.clipboardData;
      if (!clipboardData) return;

      if (window.clipboardTemImagem(clipboardData)) {
        event.preventDefault();
        event.stopPropagation();
        await window.tratarColagemImagem(clipboardData);
        return;
      }

      const html = clipboardData.getData('text/html');
      if (html) {
        const htmlLimpo = window.limparHtmlEditor(html);
        if (htmlColadoTemConteudo(htmlLimpo)) {
          event.preventDefault();
          event.stopPropagation();
          window.insertHtmlAtCursor(htmlLimpo);
          return;
        }
      }

      const texto = clipboardData.getData('text/plain');
      if (texto) {
        event.preventDefault();
        event.stopPropagation();
        window.insertTextAtCursor(texto);
      }
    });

    document.addEventListener('paste', async (event) => {
      if (!document.getElementById('modal-artigo').classList.contains('visivel')) return;
      if (event.target === editor || editor.contains(event.target)) return;
      if (alvoUsaColagemPadrao(event.target)) return;

      const clipboardData = event.clipboardData || window.clipboardData;
      if (!clipboardData) return;

      if (window.clipboardTemImagem(clipboardData)) {
        event.preventDefault();
        event.stopPropagation();
        await window.tratarColagemImagem(clipboardData);
        window.focusEditor();
        return;
      }

      const html = clipboardData.getData('text/html');
      if (html) {
        const htmlLimpo = window.limparHtmlEditor(html);
        if (htmlColadoTemConteudo(htmlLimpo)) {
          event.preventDefault();
          event.stopPropagation();
          window.focusEditor();
          window.insertHtmlAtCursor(htmlLimpo);
          return;
        }
      }

      const texto = clipboardData.getData('text/plain');
      if (texto) {
        event.preventDefault();
        event.stopPropagation();
        window.focusEditor();
        window.insertTextAtCursor(texto);
      }
    });

    document.addEventListener('click', (e) => {
      if (e.target.tagName === 'IMG' && e.target.closest('.kb-view-conteudo')) {
        const overlay = document.createElement('div');
        overlay.className = 'kb-img-overlay';
        overlay.innerHTML = '<img src="' + e.target.src + '" alt="Imagem ampliada">';
        overlay.onclick = () => overlay.remove();
        document.body.appendChild(overlay);
      }
    });
  });
})();
