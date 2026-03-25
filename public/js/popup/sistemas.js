/**
 * ARQUIVO: public/js/popup/sistemas.js
 * VERSÃO:  1.0.0
 * DATA:    2026-03-17
 * DESCRIÇÃO: Sistema de notificações popup — Portal WKL
 *
 * Carregado automaticamente pelo menu.js em todas as páginas.
 * Injeta um sino no menu, faz polling do servidor a cada 30s
 * e exibe as notificações agrupadas por sistema.
 *
 * Preferências e dispensas são armazenadas em localStorage
 * com chave por usuário logado.
 */
(function () {
  'use strict';

  // ── Constantes ────────────────────────────────────────────
  const API_URL   = '/api/portal/popup';
  const POLL_SECS = 30;

  /**
   * Definição dos sistemas monitorados.
   * key       → chave no JSON retornado pela API e no localStorage
   * label     → nome exibido no popup
   * icon      → classe Font Awesome
   * cor       → cor do grupo no popup
   * descricao → texto mostrado no painel de configurações
   */
  const SISTEMAS = [
    {
      key:       'aprovacoes',
      label:     'Aprovações Pendentes',
      icon:      'fa-check-square',
      cor:       '#6366f1',
      descricao: 'Aprovações aguardando sua decisão como aprovador'
    },
    {
      key:       'aprovacoes_resultado',
      label:     'Aprovações — Resultado',
      icon:      'fa-check-double',
      cor:       '#10b981',
      descricao: 'Suas aprovações criadas que foram aprovadas ou reprovadas'
    },
    {
      key:       'chamados_respondidos',
      label:     'Chamados Respondidos',
      icon:      'fa-reply',
      cor:       '#f59e0b',
      descricao: 'Seus chamados que receberam resposta do técnico'
    },
    {
      key:       'chamados_em_atendimento',
      label:     'Chamados Em Atendimento',
      icon:      'fa-tools',
      cor:       '#3b82f6',
      descricao: 'Seus chamados que estão sendo atendidos pelo técnico'
    },
    {
      key:       'chamados_finalizados',
      label:     'Chamados Finalizados',
      icon:      'fa-check-circle',
      cor:       '#10b981',
      descricao: 'Seus chamados concluídos nos últimos 7 dias'
    },
    {
      key:       'chamados_atribuidos',
      label:     'Chamados Atribuídos a Mim',
      icon:      'fa-user-cog',
      cor:       '#06b6d4',
      descricao: 'Chamados onde você é o técnico responsável'
    },
    {
      key:       'chamados_sem_atendedor',
      label:     'Chamados Sem Atendedor',
      icon:      'fa-exclamation-circle',
      cor:       '#ef4444',
      descricao: 'Chamados abertos sem técnico atribuído (admin/gestor)'
    },
    {
      key:       'financeiro_a_lancar',
      label:     'Contas a Lançar',
      icon:      'fa-file-invoice-dollar',
      cor:       '#f97316',
      descricao: 'Contas pendentes (sem lançamento) que vencem em breve'
    },
    {
      key:       'financeiro_vencendo',
      label:     'Contas Lançadas Vencendo',
      icon:      'fa-calendar-times',
      cor:       '#f59e0b',
      descricao: 'Contas já lançadas que vencem nos próximos dias'
    },
    {
      key:       'financeiro_vencidas',
      label:     'Contas Vencidas',
      icon:      'fa-exclamation-triangle',
      cor:       '#ef4444',
      descricao: 'Contas pendentes ou lançadas com data de vencimento ultrapassada'
    },
  ];

  // ── Estado interno ────────────────────────────────────────
  let _usuario     = null;
  let _timer       = null;
  let _dados       = {};       // resposta atual da API
  let _aberto      = false;    // painel visível
  let _telaConf    = false;    // mostrar tela de configurações no painel

  // ── Chaves de localStorage ────────────────────────────────
  function kPrefs()     { return 'portal_notif_prefs_'     + (_usuario || '_'); }
  function kDismissed() { return 'portal_notif_dismissed_' + (_usuario || '_'); }

  // ── Preferências (quais sistemas estão ativos) ─────────────
  function getPrefs() {
    try { return JSON.parse(localStorage.getItem(kPrefs())) || {}; } catch { return {}; }
  }
  function savePrefs(p) {
    try { localStorage.setItem(kPrefs(), JSON.stringify(p)); } catch {}
  }
  function isSistemaAtivo(key) {
    return getPrefs()[key] !== false; // padrão: ON
  }

  // ── Dismissals (itens dispensados) ───────────────────────
  function getDismissed() {
    try { return new Set(JSON.parse(localStorage.getItem(kDismissed())) || []); } catch { return new Set(); }
  }
  function saveDismissed(set) {
    try {
      // Limita a 500 entradas para não crescer indefinidamente
      const arr = [...set].slice(-500);
      localStorage.setItem(kDismissed(), JSON.stringify(arr));
    } catch {}
  }
  function isDismissed(uid) {
    return getDismissed().has(uid);
  }
  function dismiss(uid) {
    const s = getDismissed();
    s.add(uid);
    saveDismissed(s);
  }
  function dismissAll() {
    const s = getDismissed();
    SISTEMAS.forEach(sis => {
      (_dados[sis.key] || []).forEach(item => s.add(sis.key + ':' + item.id));
    });
    saveDismissed(s);
  }

  // ── Contagem de visíveis ──────────────────────────────────
  function totalVisivel() {
    let n = 0;
    SISTEMAS.forEach(sis => {
      if (!isSistemaAtivo(sis.key)) return;
      (_dados[sis.key] || []).forEach(item => {
        if (!isDismissed(sis.key + ':' + item.id)) n++;
      });
    });
    return n;
  }

  // ── Tempo relativo ────────────────────────────────────────
  function tempoRel(dateStr) {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 60000);
    if (diff < 1)   return 'agora mesmo';
    if (diff < 60)  return diff + 'min atrás';
    const h = Math.floor(diff / 60);
    if (h < 24) return h + 'h atrás';
    return Math.floor(h / 24) + 'd atrás';
  }

  // ── Escape HTML ───────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Polling ───────────────────────────────────────────────
  async function poll() {
    try {
      const r = await fetch(API_URL);
      if (!r.ok) return;
      _dados = await r.json();
      atualizarBadge();
      if (_aberto) renderCorpo();
    } catch { /* silencia erros de rede */ }
  }

  function iniciarPolling() {
    const saved = parseInt(localStorage.getItem('portal_notif_poll_secs')) || POLL_SECS;
    const secs  = Math.max(10, Math.min(300, saved));
    poll();
    _timer = setInterval(poll, secs * 1000);
  }

  // ── Badge ─────────────────────────────────────────────────
  function atualizarBadge() {
    const badge = document.getElementById('pnot-badge');
    if (!badge) return;
    const n = totalVisivel();
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.style.display = n > 0 ? 'flex' : 'none';
    const btn = document.getElementById('pnot-btn');
    if (n > 0 && btn && !btn.classList.contains('pnot-shake')) {
      btn.classList.add('pnot-shake');
      setTimeout(() => btn.classList.remove('pnot-shake'), 800);
    }
  }

  // ── Injeção do botão no menu ──────────────────────────────
  function injetarBotao() {
    if (document.getElementById('pnot-btn')) return;

    const btn = document.createElement('button');
    btn.id        = 'pnot-btn';
    btn.title     = 'Notificações';
    btn.setAttribute('aria-label', 'Notificações');
    // Inline styles garantem visibilidade independente do CSS do menu
    btn.style.cssText = [
      'position:relative', 'background:transparent', 'border:none',
      'color:#94a3b8', 'font-size:1.1rem', 'cursor:pointer',
      'padding:4px 10px', 'border-radius:8px', 'display:flex',
      'align-items:center', 'transition:color .2s'
    ].join(';');
    btn.innerHTML = `<i class="fas fa-bell"></i><span id="pnot-badge" style="display:none;position:absolute;top:0;right:2px;background:#ef4444;color:#fff;font-size:.5rem;font-weight:900;min-width:15px;height:15px;border-radius:8px;padding:0 3px;align-items:center;justify-content:center;border:2px solid #0f172a;line-height:1">0</span>`;
    btn.addEventListener('click', e => { e.stopPropagation(); togglePainel(); });
    btn.addEventListener('mouseenter', () => { btn.style.color = '#f1f5f9'; btn.style.background = 'rgba(255,255,255,.08)'; });
    btn.addEventListener('mouseleave', () => { btn.style.color = '#94a3b8'; btn.style.background = 'transparent'; });

    // Tenta inserir na área do usuário, ou antes do botão Sair, ou no final do menu
    const alvo =
      document.querySelector('.menu-usuario') ||
      document.querySelector('.menu-btn-sair')?.parentElement ||
      document.querySelector('nav');

    if (!alvo) return;

    const ref = document.querySelector('.menu-btn-sair') ||
                document.querySelector('.menu-btn-config') ||
                alvo.firstChild;

    alvo.insertBefore(btn, ref);
  }

  // ── Painel ────────────────────────────────────────────────
  function togglePainel() {
    if (_aberto) {
      fecharPainel();
    } else {
      _telaConf = false;
      abrirPainel();
    }
  }

  function abrirPainel() {
    if (document.getElementById('pnot-painel')) return;
    _aberto = true;

    const painel = document.createElement('div');
    painel.id        = 'pnot-painel';
    painel.className = 'pnot-painel';
    painel.innerHTML = buildPainelHTML();
    document.body.appendChild(painel);

    // Fecha ao clicar fora
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        const p = document.getElementById('pnot-painel');
        const b = document.getElementById('pnot-btn');
        if (p && !p.contains(e.target) && b && !b.contains(e.target)) {
          fecharPainel();
          document.removeEventListener('click', handler);
        }
      });
    }, 50);
  }

  function fecharPainel() {
    const el = document.getElementById('pnot-painel');
    if (el) el.remove();
    _aberto = false;
  }

  function renderCorpo() {
    const corpo = document.getElementById('pnot-corpo');
    const head  = document.getElementById('pnot-head');
    if (!corpo || !head) return;
    head.innerHTML  = buildHeaderHTML();
    corpo.innerHTML = _telaConf ? buildConfHTML() : buildListaHTML();
  }

  // ── HTML do painel ────────────────────────────────────────
  function buildPainelHTML() {
    return `
      <div id="pnot-head" class="pnot-header">${buildHeaderHTML()}</div>
      <div id="pnot-corpo" class="pnot-corpo">${_telaConf ? buildConfHTML() : buildListaHTML()}</div>
    `;
  }

  function buildHeaderHTML() {
    const n = totalVisivel();
    return `
      <span class="pnot-header-titulo">
        <i class="fas fa-bell"></i> Notificações
        ${n > 0 ? `<span class="pnot-chip">${n}</span>` : ''}
      </span>
      <div class="pnot-header-acoes">
        ${!_telaConf && n > 0
          ? `<button class="pnot-btn-txt" onclick="window.__pnotDispensarTodas()">Dispensar todas</button>`
          : ''}
        <button class="pnot-btn-icone ${_telaConf ? 'ativo' : ''}"
          onclick="window.__pnotTelaConf()" title="Configurações">
          <i class="fas fa-sliders-h"></i>
        </button>
        <button class="pnot-btn-icone" onclick="window.__pnotFechar()" title="Fechar">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
  }

  function buildListaHTML() {
    const grupos = [];
    SISTEMAS.forEach(sis => {
      if (!isSistemaAtivo(sis.key)) return;
      const itens = (_dados[sis.key] || []).filter(item => !isDismissed(sis.key + ':' + item.id));
      if (itens.length) grupos.push({ sis, itens });
    });

    if (!grupos.length) {
      return `
        <div class="pnot-vazio">
          <i class="fas fa-check-circle"></i>
          <span>Tudo em dia! Sem notificações pendentes.</span>
        </div>`;
    }

    return grupos.map(({ sis, itens }) => `
      <div class="pnot-grupo">
        <div class="pnot-grupo-header" style="border-left:3px solid ${sis.cor}">
          <i class="fas ${sis.icon}" style="color:${sis.cor}"></i>
          <span>${esc(sis.label)}</span>
          <span class="pnot-grupo-count" style="background:${sis.cor}22;color:${sis.cor}">${itens.length}</span>
        </div>
        ${itens.map(item => `
          <div class="pnot-item">
            <div class="pnot-item-info">
              <div class="pnot-item-titulo" title="${esc(item.titulo)}">${esc(item.titulo)}</div>
              ${item.subtitulo ? `<div class="pnot-item-sub">${esc(item.subtitulo)}</div>` : ''}
              ${item.criado_em ? `<div class="pnot-item-tempo"><i class="fas fa-clock"></i> ${tempoRel(item.criado_em)}</div>` : ''}
            </div>
            <div class="pnot-item-acoes">
              ${item.link
                ? `<a href="${esc(item.link)}" class="pnot-btn-ver"
                     onclick="window.__pnotDispensar('${esc(sis.key + ':' + item.id)}')">
                     <i class="fas fa-arrow-right"></i>
                   </a>`
                : ''}
              <button class="pnot-btn-x"
                onclick="window.__pnotDispensar('${esc(sis.key + ':' + item.id)}')"
                title="Dispensar">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  function buildConfHTML() {
    const prefs = getPrefs();
    return `
      <div class="pnot-conf-titulo">
        <i class="fas fa-sliders-h"></i> Configurar Notificações
      </div>
      <div class="pnot-conf-sub">
        Escolha quais sistemas exibem notificações neste navegador
      </div>
      ${SISTEMAS.map(sis => `
        <div class="pnot-conf-item">
          <div class="pnot-conf-info">
            <i class="fas ${sis.icon}" style="color:${sis.cor}"></i>
            <div>
              <div class="pnot-conf-label">${esc(sis.label)}</div>
              <div class="pnot-conf-desc">${esc(sis.descricao)}</div>
            </div>
          </div>
          <label class="pnot-toggle">
            <input type="checkbox"
              ${prefs[sis.key] !== false ? 'checked' : ''}
              onchange="window.__pnotToggleSistema('${sis.key}', this.checked)">
            <span class="pnot-toggle-slider"></span>
          </label>
        </div>
      `).join('')}
      <div class="pnot-conf-rodape">
        <i class="fas fa-info-circle"></i>
        Preferências salvas neste navegador (por usuário)
      </div>
    `;
  }

  // ── API global para eventos inline ───────────────────────
  window.__pnotFechar = function () {
    fecharPainel();
  };

  window.__pnotTelaConf = function () {
    _telaConf = !_telaConf;
    renderCorpo();
    const btn = document.querySelector('#pnot-head .pnot-btn-icone[title="Configurações"]');
    if (btn) btn.classList.toggle('ativo', _telaConf);
  };

  window.__pnotDispensar = function (uid) {
    dismiss(uid);
    atualizarBadge();
    renderCorpo();
  };

  window.__pnotDispensarTodas = function () {
    dismissAll();
    atualizarBadge();
    renderCorpo();
  };

  window.__pnotToggleSistema = function (key, ativo) {
    const prefs = getPrefs();
    prefs[key] = ativo;
    savePrefs(prefs);
    atualizarBadge();
  };

  // ── CSS injetado dinamicamente ────────────────────────────
  function injetarCSS() {
    if (document.getElementById('pnot-css')) return;
    const s = document.createElement('style');
    s.id = 'pnot-css';
    s.textContent = `
      /* ── Botão sino ── */
      .pnot-btn {
        position: relative;
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 1.05rem;
        cursor: pointer;
        padding: 6px 10px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        transition: color .2s, background .2s;
      }
      .pnot-btn:hover { color: #f1f5f9; background: rgba(255,255,255,.07); }

      @keyframes pnotShake {
        0%,100%{ transform: rotate(0) }
        20%{ transform: rotate(-18deg) }
        40%{ transform: rotate(18deg) }
        60%{ transform: rotate(-10deg) }
        80%{ transform: rotate(10deg) }
      }
      .pnot-shake .fa-bell { animation: pnotShake .7s ease; }

      #pnot-badge {
        position: absolute;
        top: 1px; right: 3px;
        background: #ef4444;
        color: #fff;
        font-size: .55rem;
        font-weight: 900;
        min-width: 17px;
        height: 17px;
        border-radius: 10px;
        padding: 0 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid #0f172a;
        pointer-events: none;
        line-height: 1;
      }

      /* ── Painel flutuante ── */
      .pnot-painel {
        position: fixed;
        top: 58px;
        right: 12px;
        width: 370px;
        max-height: 560px;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 14px;
        box-shadow: 0 24px 64px rgba(0,0,0,.55);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: 'Inter','Segoe UI',sans-serif;
        font-size: 13px;
        color: #f1f5f9;
      }

      /* ── Header ── */
      .pnot-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 13px 14px 10px;
        border-bottom: 1px solid #334155;
        flex-shrink: 0;
        gap: 8px;
      }
      .pnot-header-titulo {
        font-weight: 800;
        font-size: .9rem;
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
      }
      .pnot-chip {
        background: #ef4444;
        color: #fff;
        border-radius: 10px;
        font-size: .62rem;
        font-weight: 900;
        padding: 1px 7px;
      }
      .pnot-header-acoes { display: flex; align-items: center; gap: 3px; }
      .pnot-btn-txt {
        background: none;
        border: none;
        color: #64748b;
        font-size: .72rem;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 6px;
        white-space: nowrap;
        transition: .2s;
      }
      .pnot-btn-txt:hover { color: #f1f5f9; background: rgba(255,255,255,.06); }
      .pnot-btn-icone {
        background: none;
        border: none;
        color: #64748b;
        font-size: .82rem;
        cursor: pointer;
        padding: 5px 7px;
        border-radius: 6px;
        transition: .2s;
      }
      .pnot-btn-icone:hover, .pnot-btn-icone.ativo {
        color: #3b82f6;
        background: rgba(59,130,246,.12);
      }

      /* ── Corpo ── */
      .pnot-corpo {
        flex: 1;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .pnot-corpo::-webkit-scrollbar { width: 4px; }
      .pnot-corpo::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }

      /* ── Vazio ── */
      .pnot-vazio {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px 20px;
        gap: 12px;
        color: #475569;
        text-align: center;
      }
      .pnot-vazio .fa-check-circle { font-size: 2.2rem; color: #10b981; }
      .pnot-vazio span { font-size: .83rem; }

      /* ── Grupo ── */
      .pnot-grupo { margin-bottom: 2px; }
      .pnot-grupo-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 14px;
        background: rgba(0,0,0,.2);
        font-size: .68rem;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: .7px;
        color: #94a3b8;
      }
      .pnot-grupo-count {
        margin-left: auto;
        border-radius: 10px;
        font-size: .65rem;
        font-weight: 700;
        padding: 1px 8px;
      }

      /* ── Item ── */
      .pnot-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 10px 14px;
        border-bottom: 1px solid rgba(51,65,85,.4);
        transition: background .15s;
      }
      .pnot-item:last-child { border-bottom: none; }
      .pnot-item:hover { background: rgba(255,255,255,.03); }
      .pnot-item-info { flex: 1; min-width: 0; }
      .pnot-item-titulo {
        font-size: .82rem;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pnot-item-sub {
        font-size: .7rem;
        color: #94a3b8;
        margin-top: 2px;
      }
      .pnot-item-tempo {
        font-size: .67rem;
        color: #475569;
        margin-top: 3px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .pnot-item-acoes { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
      .pnot-btn-ver {
        background: rgba(59,130,246,.15);
        border: none;
        color: #3b82f6;
        padding: 5px 9px;
        border-radius: 6px;
        cursor: pointer;
        font-size: .75rem;
        text-decoration: none;
        transition: .2s;
        display: flex;
        align-items: center;
      }
      .pnot-btn-ver:hover { background: rgba(59,130,246,.3); }
      .pnot-btn-x {
        background: none;
        border: none;
        color: #475569;
        cursor: pointer;
        padding: 5px 6px;
        border-radius: 6px;
        font-size: .72rem;
        transition: .2s;
      }
      .pnot-btn-x:hover { color: #ef4444; background: rgba(239,68,68,.1); }

      /* ── Tela de configurações ── */
      .pnot-conf-titulo {
        padding: 14px 16px 2px;
        font-size: .78rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .5px;
        color: #64748b;
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .pnot-conf-sub {
        padding: 0 16px 12px;
        font-size: .72rem;
        color: #475569;
      }
      .pnot-conf-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-top: 1px solid rgba(51,65,85,.4);
        gap: 12px;
      }
      .pnot-conf-info {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        flex: 1;
        min-width: 0;
      }
      .pnot-conf-info i { margin-top: 2px; width: 16px; text-align: center; flex-shrink: 0; }
      .pnot-conf-label { font-size: .84rem; font-weight: 600; }
      .pnot-conf-desc  { font-size: .7rem; color: #475569; margin-top: 2px; }
      .pnot-conf-rodape {
        padding: 10px 16px 14px;
        font-size: .68rem;
        color: #334155;
        display: flex;
        align-items: center;
        gap: 6px;
        border-top: 1px solid rgba(51,65,85,.4);
        margin-top: 4px;
      }

      /* ── Toggle switch ── */
      .pnot-toggle {
        position: relative;
        display: inline-block;
        width: 40px;
        height: 22px;
        flex-shrink: 0;
      }
      .pnot-toggle input { opacity: 0; width: 0; height: 0; }
      .pnot-toggle-slider {
        position: absolute;
        cursor: pointer;
        inset: 0;
        background: #334155;
        border-radius: 22px;
        transition: .3s;
      }
      .pnot-toggle-slider::before {
        content: '';
        position: absolute;
        width: 16px;
        height: 16px;
        left: 3px;
        bottom: 3px;
        background: #64748b;
        border-radius: 50%;
        transition: .3s;
      }
      .pnot-toggle input:checked + .pnot-toggle-slider { background: rgba(59,130,246,.35); }
      .pnot-toggle input:checked + .pnot-toggle-slider::before {
        transform: translateX(18px);
        background: #3b82f6;
      }

      @media (max-width: 420px) {
        .pnot-painel { width: calc(100vw - 16px); right: 8px; }
      }
    `;
    document.head.appendChild(s);
  }

  // ── Inicialização ─────────────────────────────────────────
  function init() {
    if (document.getElementById('pnot-btn')) return;
    injetarCSS();
    injetarBotao();
    iniciarPolling();
  }

  // Aguarda menu.js definir window.usuarioLogado
  function aguardarUsuario(n) {
    if (window.usuarioLogado) {
      _usuario = window.usuarioLogado.usuario || window.usuarioLogado.login || null;
      init();
    } else if (n < 30) {
      setTimeout(() => aguardarUsuario(n + 1), 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => aguardarUsuario(0));
  } else {
    aguardarUsuario(0);
  }

})();
