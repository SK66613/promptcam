(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  if (!initData) return;

  const STYLE_ID = 'promptcamLibrarySwipeV43';
  let openShell = null;
  let decorateTimer = 0;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .promptcam-swipe-shell{position:relative;overflow:hidden;border-radius:14px;background:linear-gradient(90deg,rgba(255,54,83,.04),rgba(255,68,96,.12));touch-action:pan-y}
      .promptcam-swipe-shell>.creator-template-row-personal,.promptcam-swipe-shell>.creator-favorite-row-personal{position:relative;z-index:2;margin:0!important;transform:translate3d(0,0,0);transition:transform .2s cubic-bezier(.2,.75,.25,1),opacity .18s ease;background:linear-gradient(145deg,rgba(22,21,35,.99),rgba(13,14,25,.99));will-change:transform}
      .promptcam-swipe-shell.is-dragging>.creator-template-row-personal,.promptcam-swipe-shell.is-dragging>.creator-favorite-row-personal{transition:none}
      .promptcam-swipe-delete{position:absolute;z-index:1;top:0;right:0;bottom:0;width:30%;min-width:72px;max-width:112px;display:grid;place-items:center;border:0;background:linear-gradient(145deg,rgba(161,37,61,.9),rgba(111,26,48,.94));color:#ffdbe2;font-size:22px}
      .promptcam-swipe-delete svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8}
      .promptcam-swipe-delete:disabled{opacity:.55}
      .promptcam-swipe-shell .creator-row-actions{grid-template-columns:1fr!important}
      .promptcam-swipe-shell .creator-row-actions:empty{display:none!important}
      .promptcam-swipe-shell .creator-row-actions .primary{width:100%}
    `;
    document.head.append(style);
  }

  async function api(action, id) {
    const response = await fetch('/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action, id }),
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'delete_failed');
    return data;
  }

  function trashIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5');
    svg.append(path);
    return svg;
  }

  function close(shell = openShell, animate = true) {
    if (!shell) return;
    const row = shell.querySelector('.creator-template-row-personal,.creator-favorite-row-personal');
    if (row) {
      if (!animate) row.style.transition = 'none';
      row.style.transform = 'translate3d(0,0,0)';
      if (!animate) requestAnimationFrame(() => { row.style.transition = ''; });
    }
    shell.classList.remove('is-open', 'is-dragging');
    if (openShell === shell) openShell = null;
  }

  function reveal(shell) {
    if (openShell && openShell !== shell) close(openShell);
    const row = shell.querySelector('.creator-template-row-personal,.creator-favorite-row-personal');
    if (!row) return;
    const target = Math.min(112, Math.max(72, row.getBoundingClientRect().width * .3));
    shell.dataset.revealPx = String(Math.round(target));
    row.style.transform = `translate3d(${-target}px,0,0)`;
    shell.classList.add('is-open');
    shell.classList.remove('is-dragging');
    openShell = shell;
  }

  async function removeItem(shell) {
    const id = Number(shell.dataset.itemId || 0);
    const kind = shell.dataset.itemKind || '';
    if (!id || !kind) return;
    const button = shell.querySelector('.promptcam-swipe-delete');
    const row = shell.querySelector('.creator-template-row-personal,.creator-favorite-row-personal');
    if (button) button.disabled = true;
    try {
      await api(kind === 'template' ? 'delete_template' : 'delete_favorite', id);
      if (row) {
        row.style.transform = 'translate3d(-105%,0,0)';
        row.style.opacity = '0';
      }
      tg?.HapticFeedback?.notificationOccurred?.('success');
      window.setTimeout(() => window.PromptCamCreatorLibrary?.refresh?.(), 150);
    } catch (_) {
      if (button) button.disabled = false;
      close(shell);
      tg?.HapticFeedback?.notificationOccurred?.('error');
    }
  }

  function removeLegacyDelete(row) {
    const actions = row.querySelector('.creator-row-actions');
    if (!actions) return;
    for (const button of [...actions.querySelectorAll('button')]) {
      const text = String(button.textContent || '').trim().toLowerCase();
      if (button.classList.contains('danger') || button.classList.contains('creator-unlike-button') || text.includes('удалить') || text.includes('убрать ♥')) {
        button.remove();
      }
    }
    if (!actions.querySelector('button')) actions.style.display = 'none';
  }

  function bindGesture(shell, row) {
    if (shell.dataset.gestureBound === 'true') return;
    shell.dataset.gestureBound = 'true';
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let horizontal = false;

    row.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target.closest('button,a,input,textarea,select')) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      dragging = false;
      horizontal = false;
      try { row.setPointerCapture(pointerId); } catch (_) { /* optional */ }
    });

    row.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!horizontal) {
        if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          pointerId = null;
          return;
        }
        horizontal = true;
        dragging = true;
        if (openShell && openShell !== shell) close(openShell);
        shell.classList.add('is-dragging');
      }
      if (!dragging) return;
      event.preventDefault();
      const target = Math.min(112, Math.max(72, row.getBoundingClientRect().width * .3));
      const base = shell.classList.contains('is-open') ? -target : 0;
      const offset = Math.max(-target, Math.min(0, base + dx));
      row.style.transform = `translate3d(${offset}px,0,0)`;
    }, { passive: false });

    const finish = (event) => {
      if (pointerId !== event.pointerId) return;
      const dx = event.clientX - startX;
      const target = Math.min(112, Math.max(72, row.getBoundingClientRect().width * .3));
      const wasOpen = shell.classList.contains('is-open');
      pointerId = null;
      shell.classList.remove('is-dragging');
      if (!dragging) {
        if (wasOpen) close(shell);
        return;
      }
      dragging = false;
      if ((!wasOpen && dx < -target * .35) || (wasOpen && dx < target * .55)) reveal(shell);
      else close(shell);
    };
    row.addEventListener('pointerup', finish);
    row.addEventListener('pointercancel', () => { pointerId = null; dragging = false; close(shell); });
  }

  function wrapRow(row, item, kind) {
    if (!row || !item?.id) return;
    let shell = row.parentElement?.classList.contains('promptcam-swipe-shell') ? row.parentElement : null;
    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'promptcam-swipe-shell';
      row.before(shell);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'promptcam-swipe-delete';
      remove.setAttribute('aria-label', kind === 'template' ? 'Удалить шаблон' : 'Удалить из избранного');
      remove.append(trashIcon());
      remove.addEventListener('click', () => removeItem(shell));
      shell.append(remove, row);
    }
    shell.dataset.itemId = String(item.id);
    shell.dataset.itemKind = kind;
    removeLegacyDelete(row);
    bindGesture(shell, row);
  }

  function decorate() {
    decorateTimer = 0;
    const api = window.PromptCamCreatorLibrary;
    if (!api) return;
    const templates = api.getTemplates?.() || [];
    const favorites = api.getFavorites?.() || [];
    [...document.querySelectorAll('.creator-template-row-personal')].forEach((row, index) => wrapRow(row, templates[index], 'template'));
    [...document.querySelectorAll('.creator-favorite-row-personal')].forEach((row, index) => wrapRow(row, favorites[index], 'favorite'));
  }

  function schedule() {
    if (decorateTimer) return;
    decorateTimer = window.setTimeout(decorate, 0);
  }

  injectStyles();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('promptcam:creator-library-ready', schedule);
  window.addEventListener('promptcam:creator-modules-ready', schedule);
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  schedule();

  window.PromptCamLibrarySwipe = Object.freeze({ close, refresh: schedule, getStatus: () => ({ open: Boolean(openShell) }) });
})();
