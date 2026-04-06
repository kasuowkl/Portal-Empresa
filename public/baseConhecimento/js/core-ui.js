(function () {
  function getArtigoModalBox() {
    return document.querySelector('#modal-artigo .kb-modal-box');
  }

  function abrirModal(id) {
    document.getElementById(id).classList.add('visivel');
  }

  function fecharModal(id) {
    document.getElementById(id).classList.remove('visivel');
    if (id === 'modal-artigo') {
      definirModalArtigoMaximizado(false);
    }
  }

  function definirModalArtigoMaximizado(ativo) {
    const modalBox = getArtigoModalBox();
    const botao = document.getElementById('btn-maximizar-artigo');
    if (!modalBox || !botao) return;

    modalBox.classList.toggle('maximizado', !!ativo);
    botao.innerHTML = ativo ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
    botao.title = ativo ? 'Restaurar modal' : 'Maximizar modal';
  }

  function toggleModalArtigoMaximizado() {
    const modalBox = getArtigoModalBox();
    if (!modalBox) return;
    definirModalArtigoMaximizado(!modalBox.classList.contains('maximizado'));
  }

  function toast(texto, tipo = 'sucesso') {
    const el = document.getElementById('toast');
    el.textContent = texto;
    el.className = 'kb-toast ' + tipo + ' visivel';
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
    return texto.split(/\r?\n/).filter(Boolean).map((linha) => '<p>' + esc(linha) + '</p>').join('\n');
  }

  function formatarTamanho(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function lerArquivoBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  window.abrirModal = abrirModal;
  window.fecharModal = fecharModal;
  window.definirModalArtigoMaximizado = definirModalArtigoMaximizado;
  window.toggleModalArtigoMaximizado = toggleModalArtigoMaximizado;
  window.toast = toast;
  window.esc = esc;
  window.stripHtml = stripHtml;
  window.contemHtml = contemHtml;
  window.textoParaHtml = textoParaHtml;
  window.formatarTamanho = formatarTamanho;
  window.lerArquivoBase64 = lerArquivoBase64;
})();
