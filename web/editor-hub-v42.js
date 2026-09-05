(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  const editor = document.getElementById('editorView');
  const camera = document.getElementById('cameraView');
  const resultDialog = document.getElementById('resultDialog');
  const paywallDialog = document.getElementById('paywallDialog');
  const scriptInput = document.getElementById('scriptInput');
  if (!editor || !scriptInput) return;

  let active = 'camera';
  let walletCard = null;
  let walletBalance = null;
  let tariffBusy = false;

  const dock = document.createElement('nav');
  dock.className = 'promptcam-editor-hub';
  dock.setAttribute('aria-label', 'Быстрые действия PromptCam');

  function iconNode(kind) {
    const span = document.createElement('span');
    span.className = 'hub-icon';
    if (kind === 'camera') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-camera-switch');
      svg.append(use);
      span.append(svg);
    } else {
      span.textContent = kind === 'tokens' ? '⚡' : '⭐';
    }
    return span;
  }

  function makeDockButton(kind, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'promptcam-hub-button';
    button.dataset.hubAction = kind;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', 'false');
    const icon = iconNode(kind);
    const text = document.createElement('span');
    text.className = 'hub-label';
    text.textContent = label;
    button.append(icon, text);
    if (kind === 'tokens') {
      const count = document.createElement('span');
      count.className = 'hub-token-count';
      count.hidden = true;
      button.append(count);
      button._tokenCount = count;
    }
    dock.append(button);
    return button;
  }

  const tokenButton = makeDockButton('tokens', 'Токены');
  const cameraButton = makeDockButton('camera', 'Камера');
  const tariffButton = makeDockButton('tariff', 'Тариф');
  document.body.append(dock);

  function makeSheet(kind, title, subtitle) {
    const sheet = document.createElement('section');
    sheet.className = 'promptcam-hub-sheet';
    sheet.dataset.hubSheet = kind;
    sheet.hidden = true;
    sheet.setAttribute('aria-label', title);

    const head = document.createElement('div');
    head.className = 'promptcam-hub-sheet-head';
    const copy = document.createElement('span');
    copy.className = 'promptcam-hub-sheet-title';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const small = document.createElement('small');
    small.textContent = subtitle;
    copy.append(strong, small);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'promptcam-hub-sheet-close';
    close.textContent = '×';
    close.setAttribute('aria-label', `Закрыть ${title}`);
    head.append(copy, close);

    const content = document.createElement('div');
    content.id = kind === 'tokens' ? 'promptcamTokenHubContent' : 'promptcamTariffHubContent';
    sheet.append(head, content);
    document.body.append(sheet);
    close.addEventListener('click', () => closeSheet());
    return { sheet, content };
  }

  const tokensSheet = makeSheet('tokens', '⚡ AI-токены', 'Баланс, пополнение и история');
  const tariffSheet = makeSheet('tariff', '⭐ Тариф PromptCam', 'Доступ без водяного знака');

  const tokenPlaceholder = document.createElement('div');
  tokenPlaceholder.className = 'editor-tab-placeholder';
  tokenPlaceholder.textContent = 'Загружаю баланс AI-токенов…';
  tokensSheet.content.append(tokenPlaceholder);

  const tariffCurrent = document.createElement('div');
  tariffCurrent.className = 'promptcam-tariff-current';
  const tariffCurrentCopy = document.createElement('span');
  const tariffCurrentTitle = document.createElement('strong');
  tariffCurrentTitle.textContent = 'PromptCam Free';
  const tariffCurrentText = document.createElement('small');
  tariffCurrentText.textContent = 'Видео сохраняются с водяным знаком PromptCam.';
  tariffCurrentCopy.append(tariffCurrentTitle, tariffCurrentText);
  const tariffBadge = document.createElement('b');
  tariffBadge.textContent = 'FREE';
  tariffCurrent.append(tariffCurrentCopy, tariffBadge);
  const tariffPlans = document.createElement('div');
  tariffPlans.className = 'promptcam-tariff-plans';
  const tariffStatus = document.createElement('p');
  tariffStatus.className = 'promptcam-tariff-status';
  tariffSheet.content.append(tariffCurrent, tariffPlans, tariffStatus);

  function setTariffStatus(message = '', tone = '') {
    tariffStatus.textContent = message;
    if (tone) tariffStatus.dataset.tone = tone;
    else delete tariffStatus.dataset.tone;
  }

  function formatExpiry(timestamp) {
    if (!timestamp) return '';
    try {
      return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
        .format(new Date(Number(timestamp) * 1000));
    } catch (_) {
      return '';
    }
  }

  function planSubtitle(plan) {
    if (plan?.recurring) return 'Автопродление каждые 30 дней';
    if (plan?.id === 'day') return 'Разовый доступ на 24 часа';
    if (plan?.id === 'week') return 'Разовый доступ на 7 дней';
    if (plan?.id === 'year') return 'Разовый доступ на 365 дней';
    return 'PromptCam Pro';
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      const error = new Error(data?.error || 'request_failed');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function waitForAccess() {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt ? 900 : 300));
      const access = await window.PromptCamBilling?.refresh?.();
      if (access?.pro) return true;
    }
    return false;
  }

  async function buyTariff(plan, button) {
    if (tariffBusy) return;
    if (!initData || !tg?.openInvoice) {
      tg?.showAlert?.('Оплата PromptCam Pro доступна внутри Telegram Mini App.');
      return;
    }
    tariffBusy = true;
    tariffPlans.querySelectorAll('button').forEach((node) => { node.disabled = true; });
    button?.classList.add('is-loading');
    setTariffStatus('Создаю счёт Telegram Stars…');
    try {
      const invoice = await postJson('/api/billing/invoice', { initData, plan: plan.id });
      setTariffStatus('Подтверди оплату в Telegram.');
      tg.openInvoice(invoice.invoiceUrl, async (status) => {
        if (status === 'paid' || status === 'pending') {
          setTariffStatus('Платёж принят · обновляю тариф…');
          const activated = await waitForAccess();
          setTariffStatus(activated ? 'PromptCam Pro активирован ✓' : 'Платёж принят · тариф обновится автоматически.', activated ? 'success' : '');
          await refreshTariff();
          if (activated) tg?.HapticFeedback?.notificationOccurred?.('success');
        } else if (status === 'failed') {
          setTariffStatus('Telegram не смог провести оплату.', 'error');
        } else {
          setTariffStatus('Оплата отменена.');
        }
        tariffBusy = false;
        tariffPlans.querySelectorAll('button').forEach((node) => { node.disabled = false; });
        button?.classList.remove('is-loading');
      });
    } catch (_) {
      tariffBusy = false;
      tariffPlans.querySelectorAll('button').forEach((node) => { node.disabled = false; });
      button?.classList.remove('is-loading');
      setTariffStatus('Не удалось создать счёт. Попробуй ещё раз.', 'error');
    }
  }

  function renderTariff() {
    const billing = window.PromptCamBilling;
    const access = billing?.state?.access || { pro: false, plan: '', expiresAt: 0, recurring: false };
    const plans = Array.isArray(billing?.state?.plans) ? billing.state.plans : [];
    tariffCurrent.dataset.pro = String(Boolean(access.pro));
    if (access.pro) {
      const until = formatExpiry(access.expiresAt);
      tariffCurrentTitle.textContent = 'PromptCam Pro';
      tariffCurrentText.textContent = until ? `Активен до ${until} · без водяного знака.` : 'Активен · без водяного знака.';
      tariffBadge.textContent = access.recurring ? 'PRO · AUTO' : 'PRO';
    } else {
      tariffCurrentTitle.textContent = 'PromptCam Free';
      tariffCurrentText.textContent = 'Видео сохраняются с водяным знаком PromptCam.';
      tariffBadge.textContent = 'FREE';
    }

    tariffPlans.replaceChildren();
    for (const plan of plans) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'promptcam-tariff-plan';
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = plan.title || plan.id;
      const subtitle = document.createElement('small');
      subtitle.textContent = planSubtitle(plan);
      copy.append(title, subtitle);
      const price = document.createElement('b');
      price.textContent = `⭐ ${Number(plan.stars || 0)}`;
      button.append(copy, price);
      button.addEventListener('click', () => buyTariff(plan, button));
      tariffPlans.append(button);
    }
    if (!plans.length) setTariffStatus('Тарифы загружаются…');
  }

  async function refreshTariff() {
    try {
      if (window.PromptCamBilling?.ready) await window.PromptCamBilling.ready;
      await window.PromptCamBilling?.refresh?.();
      renderTariff();
      if (window.PromptCamBilling?.state?.plans?.length && !tariffBusy) setTariffStatus('');
    } catch (_) {
      renderTariff();
      setTariffStatus('Не удалось обновить тарифы.', 'error');
    }
  }

  function moveWalletCard() {
    const card = document.querySelector('.ai-wallet-card');
    if (!card) return;
    walletCard = card;
    if (card.parentElement !== tokensSheet.content) {
      tokenPlaceholder.remove();
      tokensSheet.content.append(card);
    }
  }

  function overrideEmptyWalletAction() {
    const button = document.querySelector('.ai-wallet-camera-empty button');
    if (!button || button.dataset.hubOverride === 'true') return;
    button.dataset.hubOverride = 'true';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (camera?.classList.contains('is-recording')) {
        tg?.showAlert?.('Сначала останови запись, затем пополни AI-токены.');
        return;
      }
      document.getElementById('backButton')?.click();
      window.setTimeout(() => open('tokens'), 140);
    }, true);
  }

  const walletObserver = new MutationObserver(() => {
    moveWalletCard();
    overrideEmptyWalletAction();
  });
  walletObserver.observe(document.body, { childList: true, subtree: true });

  function setExpanded(kind) {
    for (const button of [tokenButton, cameraButton, tariffButton]) {
      const selected = button.dataset.hubAction === kind;
      button.classList.toggle('is-expanded', selected);
      button.setAttribute('aria-expanded', String(selected && kind !== 'camera'));
    }
    active = kind;
  }

  function closeSheetsOnly() {
    tokensSheet.sheet.hidden = true;
    tariffSheet.sheet.hidden = true;
  }

  function closeSheet() {
    closeSheetsOnly();
    setExpanded('camera');
  }

  async function open(kind) {
    if (kind === 'camera') {
      closeSheetsOnly();
      setExpanded('camera');
      window.PromptCamEditorTabs?.openCamera?.();
      return;
    }

    if (active === kind && !(kind === 'tokens' ? tokensSheet.sheet.hidden : tariffSheet.sheet.hidden)) {
      closeSheet();
      return;
    }

    setExpanded(kind);
    tokensSheet.sheet.hidden = kind !== 'tokens';
    tariffSheet.sheet.hidden = kind !== 'tariff';
    if (kind === 'tokens') {
      moveWalletCard();
      await window.PromptCamAIWallet?.refresh?.({ silent: true });
      moveWalletCard();
    } else {
      await refreshTariff();
    }
  }

  tokenButton.addEventListener('click', () => open('tokens'));
  cameraButton.addEventListener('click', () => open('camera'));
  tariffButton.addEventListener('click', () => open('tariff'));

  function editorVisible() {
    return !editor.classList.contains('hidden') && camera?.classList.contains('hidden') !== false && !resultDialog?.open && !paywallDialog?.open;
  }

  function sync() {
    const visible = !editor.classList.contains('hidden') && (camera?.classList.contains('hidden') ?? true) && !resultDialog?.open && !paywallDialog?.open;
    dock.hidden = !visible;
    if (!visible) closeSheetsOnly();
    if (visible && active !== 'tokens' && active !== 'tariff') setExpanded('camera');
    try { tg?.MainButton?.hide?.(); } catch (_) { /* custom dock owns editor CTA */ }
  }

  const chromeObserver = new MutationObserver(sync);
  chromeObserver.observe(editor, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  if (camera) chromeObserver.observe(camera, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  if (resultDialog) chromeObserver.observe(resultDialog, { attributes: true, attributeFilter: ['open'] });
  if (paywallDialog) chromeObserver.observe(paywallDialog, { attributes: true, attributeFilter: ['open'] });

  window.addEventListener('promptcam:ai-wallet', (event) => {
    const balance = Math.max(0, Number(event.detail?.wallet?.balance || 0));
    walletBalance = balance;
    if (tokenButton._tokenCount) {
      tokenButton._tokenCount.hidden = false;
      tokenButton._tokenCount.textContent = String(balance);
    }
    moveWalletCard();
  });
  window.addEventListener('promptcam:billing', renderTariff);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (!tokensSheet.sheet.hidden || !tariffSheet.sheet.hidden)) closeSheet();
  });
  window.addEventListener('pagehide', () => {
    walletObserver.disconnect();
    chromeObserver.disconnect();
  }, { once: true });

  setExpanded('camera');
  sync();
  moveWalletCard();
  refreshTariff();

  window.PromptCamEditorHub = Object.freeze({
    open,
    close: closeSheet,
    sync,
    getStatus: () => ({ active, walletBalance, tokensOpen: !tokensSheet.sheet.hidden, tariffOpen: !tariffSheet.sheet.hidden })
  });
})();
