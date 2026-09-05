(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  if (!initData) return;

  const TEST_PACK = Object.freeze({ id: 'test60', title: '🧪 Тест', tokens: 60, stars: 1, test: true });
  const upstreamFetch = window.fetch.bind(window);
  let wallet = { balance: 0, lifetimePurchased: 0, lifetimeSpent: 0, low: false, empty: false };
  let costs = { liveMinute: 1, scriptEdit: 2, favoriteInsert: 1 };
  let packs = [];
  let topups = [];
  let loading = false;
  let shopOpen = false;
  let historyOpen = false;
  let emptyAlertShown = false;

  function injectStyles() {
    if (document.getElementById('promptcamAiWalletStyles')) return;
    const style = document.createElement('style');
    style.id = 'promptcamAiWalletStyles';
    style.textContent = `
      .ai-wallet-card{margin:0 0 11px;padding:13px;border:1px solid rgba(255,255,255,.085);border-radius:17px;background:linear-gradient(145deg,rgba(20,18,34,.96),rgba(11,13,25,.94));box-shadow:0 16px 48px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.025);color:#f5f1ff}
      .ai-wallet-head{display:flex;align-items:center;gap:9px}.ai-wallet-icon{display:grid;width:34px;height:34px;place-items:center;border:1px solid rgba(151,113,255,.25);border-radius:11px;background:rgba(111,77,238,.11);font-size:16px}.ai-wallet-copy{display:grid;gap:2px;min-width:0}.ai-wallet-copy strong{font-size:12px}.ai-wallet-copy small{color:#7f788d;font-size:8.5px;line-height:1.3}.ai-wallet-balance{margin-left:auto;display:grid;text-align:right}.ai-wallet-balance b{font-size:20px;line-height:1;color:#f6f1ff}.ai-wallet-balance small{margin-top:3px;color:#827b8f;font-size:7.5px}.ai-wallet-card[data-state=low] .ai-wallet-balance b{color:#ffd17f}.ai-wallet-card[data-state=empty] .ai-wallet-balance b{color:#ff7d91}
      .ai-wallet-costs{margin:10px 0 0;padding:8px 9px;border-radius:11px;background:rgba(255,255,255,.025);color:#817a8c;font-size:8px;line-height:1.4}.ai-wallet-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.ai-wallet-actions button,.ai-wallet-pack,.ai-wallet-history-toggle{min-height:35px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.035);color:#aaa2b7;font-size:9px;font-weight:760}.ai-wallet-actions .primary{border-color:rgba(133,99,255,.32);background:rgba(104,72,229,.13);color:#eee8ff}
      .ai-wallet-shop{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.ai-wallet-shop[hidden],.ai-wallet-history[hidden]{display:none!important}.ai-wallet-pack{display:grid;gap:3px;padding:8px;text-align:left}.ai-wallet-pack strong{font-size:10px;color:#eee9f8}.ai-wallet-pack small{font-size:8px;color:#7f788d}.ai-wallet-pack[data-test=true]{grid-column:1/-1;border-color:rgba(255,190,72,.32);background:rgba(255,175,55,.07)}.ai-wallet-pack[data-test=true] strong{color:#ffd48b}.ai-wallet-pack:disabled{opacity:.55}
      .ai-wallet-note{grid-column:1/-1;margin:0 2px;color:#706a7b;font-size:7.5px;line-height:1.35}.ai-wallet-status{min-height:14px;margin:8px 1px 0;color:#7c7589;font-size:8px;line-height:1.35}.ai-wallet-status[data-tone=error]{color:#e88898}.ai-wallet-status[data-tone=success]{color:#83d7a7}
      .ai-wallet-history{display:grid;gap:6px;margin-top:9px}.ai-wallet-history-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;border:1px solid rgba(255,255,255,.055);border-radius:9px;background:rgba(255,255,255,.02)}.ai-wallet-history-row span{display:grid;gap:2px}.ai-wallet-history-row b{font-size:8.5px}.ai-wallet-history-row small{color:#746e7f;font-size:7px}.ai-wallet-history-row em{font-style:normal;color:#9edbb6;font-size:9px;font-weight:800}
      .ai-wallet-panel-badge{display:inline-flex;align-items:center;min-height:19px;padding:0 7px;border:1px solid rgba(124,97,255,.28);border-radius:999px;background:rgba(99,72,218,.11);color:#d9d0ff;font-size:8px;font-weight:850}.ai-wallet-panel-badge[data-state=low]{border-color:rgba(255,190,65,.34);background:rgba(255,177,45,.09);color:#ffd17d}.ai-wallet-panel-badge[data-state=empty]{border-color:rgba(255,86,112,.35);background:rgba(255,64,92,.09);color:#ff8ea0}
      .live-ai-tool{position:relative}.live-ai-tool[data-ai-tokens]::after{content:'⚡' attr(data-ai-tokens);position:absolute;top:-5px;right:-7px;min-width:25px;height:17px;padding:0 4px;display:grid;place-items:center;border:1px solid rgba(122,94,255,.35);border-radius:999px;background:rgba(12,10,24,.94);color:#d9d0ff;font-size:7px;font-weight:850;line-height:1}.live-ai-tool[data-token-state=low]::after{color:#ffd17d;border-color:rgba(255,190,65,.4)}.live-ai-tool[data-token-state=empty]::after{color:#ff8ea0;border-color:rgba(255,86,112,.42)}
      .ai-wallet-camera-empty{margin:7px 0 0;padding:8px;border:1px solid rgba(255,82,108,.22);border-radius:10px;background:rgba(255,54,86,.06);color:#d99aa6;font-size:8px;line-height:1.35}.ai-wallet-camera-empty button{margin-top:6px;width:100%;min-height:31px;border:1px solid rgba(138,102,255,.28);border-radius:9px;background:rgba(103,73,222,.12);color:#eee7ff;font-size:8.5px;font-weight:760}
    `;
    document.head.append(style);
  }

  const card = document.createElement('section');
  card.className = 'ai-wallet-card';
  card.setAttribute('aria-label', 'AI токены PromptCam');
  const head = document.createElement('div'); head.className = 'ai-wallet-head';
  const icon = document.createElement('span'); icon.className = 'ai-wallet-icon'; icon.textContent = '⚡';
  const copy = document.createElement('span'); copy.className = 'ai-wallet-copy';
  const title = document.createElement('strong'); title.textContent = 'AI-токены';
  const sub = document.createElement('small'); sub.textContent = 'Баланс для AI Live, AI Дубля и AI-редактора';
  copy.append(title, sub);
  const balanceBox = document.createElement('span'); balanceBox.className = 'ai-wallet-balance';
  const balanceValue = document.createElement('b'); balanceValue.textContent = '…';
  const balanceLabel = document.createElement('small'); balanceLabel.textContent = 'ТОКЕНОВ';
  balanceBox.append(balanceValue, balanceLabel); head.append(icon, copy, balanceBox);

  const costLine = document.createElement('p'); costLine.className = 'ai-wallet-costs';
  const actions = document.createElement('div'); actions.className = 'ai-wallet-actions';
  const buyToggle = document.createElement('button'); buyToggle.type = 'button'; buyToggle.className = 'primary'; buyToggle.textContent = '⭐ Пополнить';
  const historyToggle = document.createElement('button'); historyToggle.type = 'button'; historyToggle.textContent = '📜 История';
  actions.append(buyToggle, historyToggle);
  const shop = document.createElement('div'); shop.className = 'ai-wallet-shop'; shop.hidden = true;
  const history = document.createElement('div'); history.className = 'ai-wallet-history'; history.hidden = true;
  const status = document.createElement('p'); status.className = 'ai-wallet-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  card.append(head, costLine, actions, shop, history, status);

  let panelBadge = null;
  let cameraEmpty = null;

  function setStatus(message = '', tone = '') {
    status.textContent = message;
    if (tone) status.dataset.tone = tone; else delete status.dataset.tone;
  }

  function stateName() {
    return wallet.empty ? 'empty' : wallet.low ? 'low' : 'ok';
  }

  function mountEditorCard() {
    const panel = document.querySelector('.editor-tab-panel[data-editor-panel="ai"]');
    if (!panel || card.isConnected) return;
    const scriptCard = panel.querySelector('.script-ai-card');
    if (scriptCard) panel.insertBefore(card, scriptCard);
    else panel.prepend(card);
  }

  function mountCameraBadge() {
    const panelTitle = document.querySelector('#liveAiPanel .live-ai-panel-title');
    if (panelTitle && !panelBadge) {
      panelBadge = document.createElement('span');
      panelBadge.className = 'ai-wallet-panel-badge';
      panelBadge.setAttribute('aria-label', 'Остаток AI токенов');
      panelTitle.append(panelBadge);
    }
    const liveButton = document.getElementById('liveAiButton');
    if (liveButton) liveButton.dataset.aiTokens = String(wallet.balance ?? 0);

    const panel = document.getElementById('liveAiPanel');
    if (panel && !cameraEmpty) {
      cameraEmpty = document.createElement('div');
      cameraEmpty.className = 'ai-wallet-camera-empty';
      cameraEmpty.hidden = true;
      const message = document.createElement('span');
      message.textContent = 'AI-токены закончились. Пополни баланс, чтобы продолжить.';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Перейти к пополнению';
      button.addEventListener('click', () => {
        if (document.getElementById('cameraView')?.classList.contains('is-recording')) {
          tg?.showAlert?.('Сначала останови запись, затем пополни AI-токены.');
          return;
        }
        document.getElementById('backButton')?.click();
        window.setTimeout(() => window.PromptCamEditorTabs?.setTab?.('ai'), 120);
      });
      cameraEmpty.append(message, button);
      panel.append(cameraEmpty);
    }
  }

  function renderBalance() {
    const balance = Math.max(0, Number(wallet.balance || 0));
    balanceValue.textContent = String(balance);
    card.dataset.state = stateName();
    costLine.textContent = `AI Live / AI Дубль: ${costs.liveMinute || 1} токен за активную минуту · AI-правка: ${costs.scriptEdit || 2} · Встроить с AI: ${costs.favoriteInsert || 1}`;
    mountCameraBadge();
    if (panelBadge) {
      panelBadge.textContent = `⚡ ${balance}`;
      panelBadge.dataset.state = stateName();
    }
    const liveButton = document.getElementById('liveAiButton');
    if (liveButton) {
      liveButton.dataset.aiTokens = String(balance);
      liveButton.dataset.tokenState = stateName();
    }
    if (cameraEmpty) cameraEmpty.hidden = balance > 0;
    window.dispatchEvent(new CustomEvent('promptcam:ai-wallet', { detail: { wallet: { ...wallet } } }));
  }

  function dateLabel(seconds) {
    if (!seconds) return '';
    try { return new Date(seconds * 1000).toLocaleDateString('ru-RU'); }
    catch (_) { return ''; }
  }

  function renderHistory() {
    history.replaceChildren();
    if (!topups.length) {
      const empty = document.createElement('div');
      empty.className = 'ai-wallet-history-row';
      empty.textContent = 'Пополнений пока нет.';
      history.append(empty);
      return;
    }
    for (const item of topups) {
      const row = document.createElement('div'); row.className = 'ai-wallet-history-row';
      const text = document.createElement('span');
      const strong = document.createElement('b');
      strong.textContent = item.kind === 'starter' ? 'Стартовый подарок' : `Пополнение${item.stars ? ` · ⭐${item.stars}` : ''}`;
      const small = document.createElement('small'); small.textContent = dateLabel(Number(item.createdAt || 0));
      text.append(strong, small);
      const delta = document.createElement('em'); delta.textContent = `+${Number(item.tokens || 0)}`;
      row.append(text, delta); history.append(row);
    }
  }

  function packButton(pack, { test = false } = {}) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ai-wallet-pack'; button.dataset.test = String(test);
    const strong = document.createElement('strong'); strong.textContent = `${test ? '🧪 ' : ''}${pack.tokens} токенов · ⭐${pack.stars}`;
    const small = document.createElement('small'); small.textContent = test ? 'Временная цена для проверки Stars' : (pack.title || 'PromptCam AI');
    button.append(strong, small);
    button.addEventListener('click', () => buyPack(pack, button, test));
    return button;
  }

  function renderShop() {
    shop.replaceChildren();
    shop.append(packButton(TEST_PACK, { test: true }));
    const visibleReal = packs.filter((pack) => pack.id !== 'start');
    for (const pack of visibleReal) shop.append(packButton(pack));
    const note = document.createElement('p');
    note.className = 'ai-wallet-note';
    note.textContent = '🧪 ⭐1 — только временный тест цепочки. После проверки тестовый пакет уберём.';
    shop.append(note);
  }

  async function apiStatus() {
    const response = await upstreamFetch('/api/ai/wallet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'status' }), cache: 'no-store', credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'wallet_status_failed');
    return data;
  }

  async function refreshWallet({ silent = false } = {}) {
    if (loading) return wallet;
    loading = true;
    if (!silent) setStatus('Обновляю баланс…');
    try {
      const data = await apiStatus();
      wallet = data.wallet || wallet;
      costs = data.costs || costs;
      packs = Array.isArray(data.packs) ? data.packs : packs;
      topups = Array.isArray(data.topups) ? data.topups : [];
      renderBalance(); renderShop(); renderHistory();
      if (!silent) setStatus(wallet.empty ? 'Баланс пуст · пополни токены.' : 'Баланс актуален.', wallet.empty ? 'error' : 'success');
      return wallet;
    } catch (_) {
      if (!silent) setStatus('Не удалось загрузить AI-баланс. Попробуй ещё раз.', 'error');
      return wallet;
    } finally { loading = false; }
  }

  async function createInvoice(pack, test) {
    const url = test ? '/api/ai/wallet-test' : '/api/ai/wallet';
    const body = test ? { initData, action: 'buy_pack' } : { initData, action: 'buy_pack', pack: pack.id };
    const response = await upstreamFetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-store', credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok || !data.invoiceUrl) throw new Error(data?.error || 'invoice_failed');
    return data;
  }

  async function pollAfterPayment(previousBalance) {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 350 : 900));
      const before = Number(wallet.balance || 0);
      await refreshWallet({ silent: true });
      if (Number(wallet.balance || 0) > Math.max(previousBalance, before)) {
        setStatus(`Оплата подтверждена · баланс ${wallet.balance} токенов.`, 'success');
        try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch (_) { /* optional */ }
        return true;
      }
    }
    setStatus('Платёж обрабатывается. Баланс обновится автоматически.', 'success');
    return false;
  }

  async function buyPack(pack, button, test) {
    if (button.disabled) return;
    const previousBalance = Number(wallet.balance || 0);
    button.disabled = true;
    setStatus(`Создаю счёт на ⭐${pack.stars}…`);
    try {
      const invoice = await createInvoice(pack, test);
      if (typeof tg?.openInvoice === 'function') {
        tg.openInvoice(invoice.invoiceUrl, (invoiceStatus) => {
          button.disabled = false;
          if (invoiceStatus === 'paid' || invoiceStatus === 'pending') {
            setStatus('Платёж принят Telegram · начисляю токены…');
            pollAfterPayment(previousBalance);
          } else if (invoiceStatus === 'cancelled') {
            setStatus('Оплата отменена.');
          } else if (invoiceStatus === 'failed') {
            setStatus('Telegram не смог провести оплату.', 'error');
          }
        });
      } else {
        window.open(invoice.invoiceUrl, '_blank', 'noopener');
        button.disabled = false;
        setStatus('Счёт открыт. После оплаты обнови баланс.');
      }
    } catch (_) {
      button.disabled = false;
      setStatus('Не удалось создать Stars-счёт. Попробуй ещё раз.', 'error');
    }
  }

  buyToggle.addEventListener('click', () => {
    shopOpen = !shopOpen;
    shop.hidden = !shopOpen;
    buyToggle.textContent = shopOpen ? 'Скрыть пакеты' : '⭐ Пополнить';
    if (shopOpen) renderShop();
  });
  historyToggle.addEventListener('click', () => {
    historyOpen = !historyOpen;
    history.hidden = !historyOpen;
    historyToggle.textContent = historyOpen ? 'Скрыть историю' : '📜 История';
    if (historyOpen) renderHistory();
  });

  window.fetch = async function promptCamWalletAwareFetch(input, init = {}) {
    const response = await upstreamFetch(input, init);
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      const url = new URL(raw || '', window.location.href);
      if (url.origin === window.location.origin && url.pathname.startsWith('/api/ai/')) {
        const header = response.headers.get('X-PromptCam-AI-Tokens');
        if (header !== null && Number.isFinite(Number(header))) {
          wallet = { ...wallet, balance: Math.max(0, Number(header)), low: Number(header) <= 5, empty: Number(header) <= 0 };
          renderBalance();
        }
        if (response.status === 402) {
          response.clone().json().then((data) => {
            if (data?.wallet) wallet = { ...wallet, ...data.wallet };
            renderBalance();
            if (!emptyAlertShown) {
              emptyAlertShown = true;
              setStatus('AI-токены закончились · пополни баланс.', 'error');
            }
          }).catch(() => {});
        }
      }
    } catch (_) { /* unrelated fetch */ }
    return response;
  };

  injectStyles();
  mountEditorCard();
  mountCameraBadge();
  const mountObserver = new MutationObserver(() => { mountEditorCard(); mountCameraBadge(); });
  mountObserver.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshWallet({ silent: true }); });
  if (typeof tg?.onEvent === 'function') {
    try { tg.onEvent('activated', () => refreshWallet({ silent: true })); } catch (_) { /* optional */ }
  }
  window.addEventListener('pagehide', () => mountObserver.disconnect(), { once: true });
  refreshWallet();

  window.PromptCamAIWallet = Object.freeze({
    refresh: refreshWallet,
    openShop: () => { shopOpen = true; shop.hidden = false; renderShop(); window.PromptCamEditorTabs?.setTab?.('ai'); },
    getStatus: () => ({ wallet: { ...wallet }, costs: { ...costs }, packs: packs.map((item) => ({ ...item })) })
  });
})();
