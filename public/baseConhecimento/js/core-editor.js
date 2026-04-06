(function () {
  const state = window.KBState;

  function getEditor() {
    return document.getElementById('artigo-editor');
  }

  function isSelectionInsideEditor() {
    const editor = getEditor();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    return editor.contains(range.commonAncestorContainer);
  }

  function posicionarCursorNoFimEditor() {
    const editor = getEditor();
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function focusEditor() {
    const editor = getEditor();
    editor.focus();
    if (!isSelectionInsideEditor()) {
      posicionarCursorNoFimEditor();
    }
  }

  function normalizarHtmlColado(html) {
    return html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\sclass=(".*?"|'.*?')/gi, '')
      .replace(/\sstyle=(".*?"|'.*?')/gi, '')
      .replace(/\sdata-[\w-]+=(".*?"|'.*?')/gi, '')
      .replace(/\sid=(".*?"|'.*?')/gi, '')
      .replace(/<(meta|link|script|style|title|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<(meta|link|script|style|title|head)[^>]*\/?>/gi, '')
      .replace(/<\/?(html|body)[^>]*>/gi, '');
  }

  function limparHtmlEditor(html) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = normalizarHtmlColado(html);
    wrapper.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        if (!['href', 'src', 'target', 'rel', 'alt', 'title', 'colspan', 'rowspan'].includes(attr.name)) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return wrapper.innerHTML;
  }

  function syncEditorSource() {
    document.getElementById('artigo-conteudo').value = getEditor().innerHTML.trim();
  }

  function getEditorHtml() {
    syncEditorSource();
    return document.getElementById('artigo-conteudo').value;
  }

  function setEditorHtml(html) {
    getEditor().innerHTML = limparHtmlEditor(html || '');
    syncEditorSource();
  }

  function criarFragmentoHtml(html) {
    const range = document.createRange();
    return range.createContextualFragment(limparHtmlEditor(html));
  }

  function insertFragmentAtCursor(fragment) {
    focusEditor();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      posicionarCursorNoFimEditor();
    }

    const range = window.getSelection().getRangeAt(0);
    range.deleteContents();
    const lastNode = fragment.lastChild;
    range.insertNode(fragment);

    if (lastNode) {
      const novoRange = document.createRange();
      novoRange.setStartAfter(lastNode);
      novoRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(novoRange);
    }

    syncEditorSource();
  }

  function insertHtmlAtCursor(html) {
    insertFragmentAtCursor(criarFragmentoHtml(html));
  }

  function insertTextAtCursor(texto) {
    const linhas = esc(texto).replace(/\r?\n/g, '<br>');
    insertHtmlAtCursor(linhas);
  }

  function inserirTag(tag) {
    focusEditor();
    document.execCommand(tag === 'b' ? 'bold' : tag === 'i' ? 'italic' : tag === 'u' ? 'underline' : 'formatBlock', false, tag === 'h2' || tag === 'h3' ? tag.toUpperCase() : undefined);
    syncEditorSource();
  }

  function inserirBloco(tag) {
    focusEditor();
    const html = tag === 'pre' ? '<pre><code>codigo aqui</code></pre>' : '<blockquote>citacao</blockquote>';
    insertHtmlAtCursor(html);
  }

  function inserirLista(tipo) {
    focusEditor();
    document.execCommand(tipo === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
    syncEditorSource();
  }

  function inserirTabela() {
    insertHtmlAtCursor('<table><tr><th>Coluna 1</th><th>Coluna 2</th></tr><tr><td>Valor 1</td><td>Valor 2</td></tr></table>');
  }

  async function adicionarImagem(file) {
    if (!file) return;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        insertHtmlAtCursor('<p><img src="' + reader.result + '" alt="' + esc(file.name || 'imagem colada') + '"></p>');
        resolve();
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function inserirImagensUpload(input) {
    const arquivos = Array.from(input.files || []);
    arquivos.forEach((arquivo) => adicionarImagem(arquivo));
    input.value = '';
  }

  function extrairArquivosImagemClipboard(clipboardData) {
    const arquivos = [];

    const files = Array.from(clipboardData.files || [])
      .filter((file) => file.type && file.type.startsWith('image/'));
    arquivos.push(...files);

    const items = Array.from(clipboardData.items || []);
    for (const item of items) {
      if (!item.type || !item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (file) arquivos.push(file);
    }

    return arquivos.filter((file, index, array) => {
      return array.findIndex((other) =>
        other.name === file.name &&
        other.size === file.size &&
        other.type === file.type
      ) === index;
    });
  }

  function clipboardTemImagem(clipboardData) {
    const total = extrairArquivosImagemClipboard(clipboardData).length;
    return total > 0;
  }

  async function tratarColagemImagem(clipboardData) {
    const imagens = extrairArquivosImagemClipboard(clipboardData);
    if (!imagens.length) return false;

    for (const imagem of imagens) {
      await adicionarImagem(imagem);
    }

    return true;
  }

  function removerImagem(idx) {
    state.imagensPendentes.splice(idx, 1);
    renderizarImagensPreview();
    syncEditorSource();
  }

  function renderizarImagensPreview() {
    const container = document.getElementById('imagens-preview');
    let html = '';
    state.imagensPendentes.forEach((img, idx) => {
      html += '<div style="position:relative; width:88px; height:88px; border:1px solid var(--cor-borda); border-radius:6px; overflow:hidden;"><img src="' + img.src + '" alt="preview" style="width:100%; height:100%; object-fit:cover;"><button onclick="removerImagem(' + idx + ')" style="position:absolute; top:4px; right:4px; background:rgba(0,0,0,0.6); color:white; border:none; width:20px; height:20px; border-radius:50%; cursor:pointer;">x</button></div>';
    });
    container.innerHTML = html;
    container.style.display = html ? 'flex' : 'none';
  }

  function resolverImagensNoConteudo(conteudo) {
    return conteudo;
  }

  function converterParaHtml() {
    const texto = stripHtml(getEditorHtml()).trim();
    if (!texto) return toast('Conteudo vazio.', 'erro');
    if (contemHtml(texto)) return toast('O conteudo ja contem HTML.', 'erro');
    setEditorHtml(textoParaHtml(texto));
    toast('Texto convertido para HTML!');
  }

  function previewConteudo() {
    const texto = getEditorHtml().trim();
    if (!texto) return toast('Conteudo vazio.', 'erro');
    const html = contemHtml(texto) ? texto : textoParaHtml(texto);
    const win = window.open('', '_blank', 'width=800,height=600');
    win.document.write('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Preview - Base de Conhecimento</title><style>body{font-family:Segoe UI,sans-serif;background:#1a1a2e;color:#e0e0e0;padding:32px;line-height:1.8}h1,h2,h3{color:#e0e0e0;margin:16px 0 8px}a{color:#4e9af1}pre{background:#0f0f1f;border:1px solid #1e3a5f;border-radius:6px;padding:12px;overflow-x:auto;font-family:Consolas,monospace}code{background:#0f0f1f;padding:2px 6px;border-radius:4px;font-family:Consolas,monospace}pre code{background:none;padding:0}blockquote{border-left:3px solid #4e9af1;padding:8px 16px;color:#9e9e9e;background:rgba(78,154,241,0.05);margin:12px 0;border-radius:0 6px 6px 0}ul,ol{padding-left:24px}li{margin-bottom:4px}table{border-collapse:collapse;width:100%}th,td{padding:8px 12px;border:1px solid #1e3a5f}th{background:#0f3460}img{max-width:100%;border-radius:6px}</style></head><body>' + html + '</body></html>');
    win.document.close();
  }

  function inserirLink() {
    const url = prompt('URL do link:');
    if (!url) return;
    focusEditor();
    const sel = window.getSelection();
    const texto = sel.toString() || 'texto do link';
    insertHtmlAtCursor('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + texto + '</a>');
  }

  window.getEditor = getEditor;
  window.isSelectionInsideEditor = isSelectionInsideEditor;
  window.posicionarCursorNoFimEditor = posicionarCursorNoFimEditor;
  window.focusEditor = focusEditor;
  window.normalizarHtmlColado = normalizarHtmlColado;
  window.limparHtmlEditor = limparHtmlEditor;
  window.syncEditorSource = syncEditorSource;
  window.getEditorHtml = getEditorHtml;
  window.setEditorHtml = setEditorHtml;
  window.criarFragmentoHtml = criarFragmentoHtml;
  window.insertFragmentAtCursor = insertFragmentAtCursor;
  window.insertHtmlAtCursor = insertHtmlAtCursor;
  window.insertTextAtCursor = insertTextAtCursor;
  window.inserirTag = inserirTag;
  window.inserirBloco = inserirBloco;
  window.inserirLista = inserirLista;
  window.inserirTabela = inserirTabela;
  window.adicionarImagem = adicionarImagem;
  window.inserirImagensUpload = inserirImagensUpload;
  window.extrairArquivosImagemClipboard = extrairArquivosImagemClipboard;
  window.clipboardTemImagem = clipboardTemImagem;
  window.tratarColagemImagem = tratarColagemImagem;
  window.removerImagem = removerImagem;
  window.renderizarImagensPreview = renderizarImagensPreview;
  window.resolverImagensNoConteudo = resolverImagensNoConteudo;
  window.converterParaHtml = converterParaHtml;
  window.previewConteudo = previewConteudo;
  window.inserirLink = inserirLink;
})();
