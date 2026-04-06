(function () {
  function abrirModal(id) {
    document.getElementById(id).classList.add('visivel');
  }

  function fecharModal(id) {
    document.getElementById(id).classList.remove('visivel');
    if (id === 'modal-artigo') {
      definirModalArtigoMaximizado(false);
    }
  }

  function toast(texto, tipo = 'sucesso') {
    const el = document.getElementById('toast');
    el.textContent = texto;
    el.className = `kb-toast ${tipo} visivel`;
    setTimeout(() => el.classList.remove('visivel'), 3000);
  }

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  function contemHtml(texto) {
    return /<(h[1-6]|p|ul|ol|li|table|div|br|blockquote|pre|strong|em)\b/i.test(texto);
  }

  function textoParaHtml(texto) {
    const linhas = texto.split('\n');
    let html = '';
    let dentroLista = false;
    let tipoLista = '';
    let dentroCodeBlock = false;
    let codeBuffer = [];
    let tabelaBuffer = [];

    function fecharLista() {
      if (!dentroLista) return;
      html += `</${tipoLista}>\n`;
      dentroLista = false;
      tipoLista = '';
    }

    function ehLinhaTabela(linha) {
      return (linha.match(/\|/g) || []).length >= 2;
    }

    function fecharTabela() {
      if (!tabelaBuffer.length) return;
      const linhasTabela = tabelaBuffer
        .map((l) => l.split('|').map((c) => c.trim()).filter(Boolean))
        .filter((cols) => cols.length >= 2);

      if (linhasTabela.length) {
        html += '<table>\n';
        linhasTabela.forEach((cols, idx) => {
          html += '  <tr>';
          html += cols.map((col) => idx === 0 ? `<th>${col}</th>` : `<td>${col}</td>`).join('');
          html += '</tr>\n';
        });
        html += '</table>\n';
      }
      tabelaBuffer = [];
    }

    function formatarLinhaTexto(linha) {
      return linha
        .replace(/(https?:\/\/[^\s<>"')\]]+)/g, '<a href="$1" target="_blank">$1</a>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
    }

    for (let i = 0; i < linhas.length; i += 1) {
      let linha = linhas[i];
      const linhaTrim = linha.trim();
      const proxLinha = i + 1 < linhas.length ? linhas[i + 1].trim() : '';

      if (!linhaTrim) {
        fecharLista();
        fecharTabela();
        continue;
      }

      if (ehLinhaTabela(linhaTrim)) {
        fecharLista();
        tabelaBuffer.push(linhaTrim);
        continue;
      }
      fecharTabela();

      if (/^(javascript|python|sql|bash|json|css|html|xml|php|java|c#|csharp)\s*$/i.test(linhaTrim)) {
        fecharLista();
        dentroCodeBlock = true;
        codeBuffer = [];
        continue;
      }

      if (dentroCodeBlock) {
        codeBuffer.push(esc(linhaTrim));
        if (!proxLinha || (/^[A-ZÀ-ÿ]/.test(proxLinha) && !/[{(;=]/.test(proxLinha))) {
          html += `<pre><code>${codeBuffer.join('\n')}</code></pre>\n`;
          dentroCodeBlock = false;
          codeBuffer = [];
        }
        continue;
      }

      linha = formatarLinhaTexto(linhaTrim);

      if (/^[•???\-*]\s+/.test(linhaTrim)) {
        const conteudoItem = linha.replace(/^[•???\-*]\s+/, '');
        if (!dentroLista || tipoLista !== 'ul') {
          fecharLista();
          html += '<ul>\n';
          dentroLista = true;
          tipoLista = 'ul';
        }
        html += `  <li>${conteudoItem}</li>\n`;
        continue;
      }

      if (/^\d+[\.\)]\s+/.test(linhaTrim) || /^[a-z][\.\)]\s+/i.test(linhaTrim)) {
        const conteudoItem = linha.replace(/^[\da-z]+[\.\)]\s+/i, '');
        if (!dentroLista || tipoLista !== 'ol') {
          fecharLista();
          html += '<ol>\n';
          dentroLista = true;
          tipoLista = 'ol';
        }
        html += `  <li>${conteudoItem}</li>\n`;
        continue;
      }

      fecharLista();

      if (/^(obs|observacao|nota|atencao|importante):\s*/i.test(linhaTrim)) {
        html += `<blockquote>${linha}</blockquote>\n`;
        continue;
      }

      if (linhaTrim.length < 100 && !/[.;]$/.test(linhaTrim) && !ehLinhaTabela(linhaTrim) && !/^(https?:\/\/)/i.test(linhaTrim)) {
        if (proxLinha && (proxLinha.length > linhaTrim.length || /^[•???\-*]/.test(proxLinha) || /^\d+[\.\)]\s+/.test(proxLinha))) {
          html += `<h3>${linha}</h3>\n`;
          continue;
        }
      }

      html += `<p>${linha}</p>\n`;
    }

    fecharLista();
    fecharTabela();

    if (codeBuffer.length > 0) {
      html += `<pre><code>${codeBuffer.join('\n')}</code></pre>\n`;
    }

    return html;
  }

  function formatarTamanho(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  function lerArquivoBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function definirModalArtigoMaximizado(ativo) {
    const state = window.KBState;
    const modal = document.getElementById('modal-artigo');
    const botao = document.getElementById('btn-maximizar-artigo');
    if (!modal || !botao) return;

    state.modalArtigoMaximizado = Boolean(ativo);
    modal.classList.toggle('kb-modal-artigo-maximizado', state.modalArtigoMaximizado);
    botao.innerHTML = `<i class="fas fa-${state.modalArtigoMaximizado ? 'compress' : 'expand'}"></i>`;
    botao.title = state.modalArtigoMaximizado ? 'Restaurar tamanho' : 'Maximizar editor';
  }

  function alternarModalArtigoMaximizado() {
    definirModalArtigoMaximizado(!window.KBState.modalArtigoMaximizado);
  }

  window.abrirModal = abrirModal;
  window.fecharModal = fecharModal;
  window.toast = toast;
  window.esc = esc;
  window.stripHtml = stripHtml;
  window.contemHtml = contemHtml;
  window.textoParaHtml = textoParaHtml;
  window.formatarTamanho = formatarTamanho;
  window.lerArquivoBase64 = lerArquivoBase64;
  window.definirModalArtigoMaximizado = definirModalArtigoMaximizado;
  window.alternarModalArtigoMaximizado = alternarModalArtigoMaximizado;
})();
