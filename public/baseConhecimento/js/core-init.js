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

  function clipboardTemHtmlCompleto(clipboardData) {
    if (!clipboardData) return false;
    let html = '';
    let texto = '';
    try { html = clipboardData.getData('text/html') || ''; } catch (erro) {}
    try { texto = clipboardData.getData('text/plain') || ''; } catch (erro) {}
    return ehHtmlDocumentoCompleto(html) || ehHtmlDocumentoCompleto(texto);
  }

  function extrairHtmlCompletoClipboard(clipboardData) {
    if (!clipboardData) return '';
    let html = '';
    let texto = '';
    try { html = clipboardData.getData('text/html') || ''; } catch (erro) {}
    try { texto = clipboardData.getData('text/plain') || ''; } catch (erro) {}
    const bruto = ehHtmlDocumentoCompleto(texto) ? texto : html;
    return normalizarHtmlDocumentoCompleto(bruto);
  }

  function ehDocumentoClipboard(file) {
    if (!file) return false;
    const nome = String(file.name || '').toLowerCase();
    const tipo = String(file.type || '').toLowerCase();
    return tipo === 'application/pdf' ||
      tipo === 'application/msword' ||
      tipo === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      tipo === 'application/vnd.ms-powerpoint' ||
      tipo === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      nome.endsWith('.pdf') ||
      nome.endsWith('.doc') ||
      nome.endsWith('.docx') ||
      nome.endsWith('.ppt') ||
      nome.endsWith('.pptx') ||
      nome.endsWith('.ptt');
  }

  function extrairDocumentosClipboard(clipboardData) {
    if (!clipboardData) return [];
    const files = Array.from(clipboardData.files || []).filter(ehDocumentoClipboard);
    const items = Array.from(clipboardData.items || []);
    for (const item of items) {
      const file = item.getAsFile ? item.getAsFile() : null;
      if (file && ehDocumentoClipboard(file)) files.push(file);
    }
    return files.filter((file, index, array) => array.findIndex((other) =>
      other.name === file.name &&
      other.size === file.size &&
      other.type === file.type
    ) === index);
  }

  function adicionarDocumentosDoClipboard(arquivos) {
    if (!arquivos || !arquivos.length) return;
    window.KBState.documentosPendentes = window.KBState.documentosPendentes || [];
    arquivos.forEach((arquivo) => {
      const item = {
        file: arquivo,
        token: 'kbdoc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        embedNoConteudo: true,
        origemClipboard: true
      };
      item.file._origemClipboard = true;
      const jaExiste = window.KBState.documentosPendentes.some((pendente) =>
        pendente.file &&
        pendente.file.name === arquivo.name &&
        pendente.file.size === arquivo.size &&
        pendente.file.type === arquivo.type
      );
      if (!jaExiste) {
        window.KBState.documentosPendentes.push(item);
        window.inserirMarcadorDocumentoPendente(item);
      }
    });
    window.renderizarArquivosSelecionados('artigo-documentos', 'artigo-documentos-lista');
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.carregarCategorias();
    window.carregarFacetas();
    window.carregarArtigos();
    window.carregarEstatisticas();

    const editor = window.getEditor();
    const codeEditor = window.getCodeEditor();
    const anexosInput = document.getElementById('artigo-anexos');
    const docsInput = document.getElementById('artigo-documentos');
    editor.setAttribute('tabindex', '0');
    editor.addEventListener('input', window.syncEditorSource);
    if (codeEditor) {
      codeEditor.addEventListener('input', window.atualizarPreviewEditor);
    }
    if (anexosInput) {
      anexosInput.addEventListener('change', () => window.renderizarArquivosSelecionados('artigo-anexos', 'artigo-anexos-lista'));
    }
    if (docsInput) {
      docsInput.addEventListener('change', () => window.renderizarArquivosSelecionados('artigo-documentos', 'artigo-documentos-lista'));
    }
    editor.addEventListener('paste', async (event) => {
      const clipboardData = event.clipboardData || window.clipboardData;
      if (!clipboardData) return;

      if (clipboardTemHtmlCompleto(clipboardData)) {
        event.preventDefault();
        event.stopPropagation();
        const htmlCompleto = extrairHtmlCompletoClipboard(clipboardData);
        if (htmlCompleto) {
          window.setEditorHtml(htmlCompleto);
          window.definirModoEdicaoArtigo('codigo');
          window.toast('HTML completo detectado. O conteúdo foi enviado para Código HTML para preservar classes, ids e scripts.');
        }
        return;
      }

      const documentos = extrairDocumentosClipboard(clipboardData);
      if (documentos.length) {
        event.preventDefault();
        event.stopPropagation();
        adicionarDocumentosDoClipboard(documentos);
        window.toast(documentos.length + ' documento(s) adicionados ao artigo.');
        return;
      }

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

      if (clipboardTemHtmlCompleto(clipboardData)) {
        event.preventDefault();
        event.stopPropagation();
        const htmlCompleto = extrairHtmlCompletoClipboard(clipboardData);
        if (htmlCompleto) {
          window.setEditorHtml(htmlCompleto);
          window.definirModoEdicaoArtigo('codigo');
          window.toast('HTML completo detectado. O conteúdo foi enviado para Código HTML para preservar classes, ids e scripts.');
        }
        return;
      }

      const documentos = extrairDocumentosClipboard(clipboardData);
      if (documentos.length) {
        event.preventDefault();
        event.stopPropagation();
        adicionarDocumentosDoClipboard(documentos);
        window.toast(documentos.length + ' documento(s) adicionados ao artigo.');
        return;
      }

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
