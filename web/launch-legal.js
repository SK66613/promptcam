(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  if (!initData) return;

  const state = {
    accepted: false,
    termsVersion: '',
    privacyVersion: '',
    loading: false,
    loaded: false
  };

  const PRIVACY_NOTE = 'Видео записывается на устройстве. При включённом AI отдельные кадры и речевые чанки отправляются AI-провайдеру для обработки.';
  const LIVE_COPY = 'AI Live анализирует отдельные кадры; Speech Context отправляет только речевые чанки. PromptCam не сохраняет видео, кадры или распознанный текст в D1.';

  function injectStyles() {
    if (document.getElementById('promptcamLaunchLegalStyles')) return;
    const style = document.createElement('style');
    style.id = 'promptcamLaunchLegalStyles';
    style.textContent = `
      .promptcam-legal-gate{display:grid;gap:8px;margin:10px 0;padding:10px 11px;border:1px solid rgba(255,255,255,.08);border-radius:13px;background:rgba(255,255,255,.025);color:#aaa3b4;font-size:10px;line-height:1.45}
      .promptcam-legal-gate[data-accepted="true"]{border-color:rgba(94,205,145,.18);background:rgba(67,163,112,.055);color:#99caaa}
      .promptcam-legal-links{display:flex;flex-wrap:wrap;gap:8px}.promptcam-legal-links a{color:#c8baff;text-decoration:none;font-weight:750}
      .promptcam-legal-check{display:flex;align-items:flex-start;gap:8px;color:#aaa3b4}.promptcam-legal-check input{margin-top:2px}
      .promptcam-legal-accept{min-height:34px;border:1px solid rgba(128,96,255,.32);border-radius:10px;background:rgba(104,72,229,.12);color:#eee8ff;font-size:10px;font-weight:780}
      .promptcam-launch-start-pack{border-color:rgba(128,96,255,.26)!important;background:rgba(104,72,229,.08)!important}
      .promptcam-launch-start-pack strong{color:#eee8ff!important}
      html:not([data-promptcam-debug="true"]) #pcdbgBtn,
      html:not([data-promptcam-debug="true"]) #promptcamDebugEmergency{display:none!important}
    `;
    document.head.append(style);
  }

  function debugPolicy() {
    const enabled = new URLSearchParams(location.search).get('debug') === '1';
    document.documentElement.dataset.promptcamDebug = String(enabled);
    if (!enabled) {
      document.getElementById('pcdbgBtn')?.remove();
      document.getElementById('promptcamDebugEmergency')?.remove();
    }
  }

  function setTextIfChanged(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function patchPrivacyCopy() {
    setTextIfChanged(document.querySelector('.privacy-note'), PRIVACY_NOTE);
    setTextIfChanged(document.querySelector('#liveAiPanel .live-ai-copy'), LIVE_COPY);
  }

  function acceptedFrom(data) {
    return Boolean(data?.termsAccepted ?? data?.accepted);
  }

  async function postLegal(action = 'status') {
    const response = await fetch('/api/legal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData,
        action,
        ...(action === 'accept' ? { termsVersion: state.termsVersion } : {})
      }),
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'legal_request_failed');
    return data;
  }

  function gateTargets() {
    const result = [];
    const tokenContent = document.getElementById('promptcamTokenHubContent');
    const tariffContent = document.getElementById('promptcamTariffHubContent');
    const paywallList = document.getElementById('planList');
    if (tokenContent) result.push({ key: 'tokens', host: tokenContent });
    if (tariffContent) result.push({ key: 'tariff', host: tariffContent });
    if (paywallList?.parentElement) result.push({ key: 'paywall', host: paywallList.parentElement, before: paywallList });
    return result;
  }

  function buildGate(key) {
    const gate = document.createElement('section');
    gate.className = 'promptcam-legal-gate';
    gate.dataset.legalGate = key;
    gate.dataset.accepted = String(state.accepted);
    gate.dataset.loaded = String(state.loaded);

    const copy = document.createElement('span');
    copy.className = 'promptcam-legal-copy';
    copy.textContent = !state.loaded
      ? 'Проверяю условия покупки…'
      : state.accepted
        ? '✓ Условия покупки приняты.'
        : 'Перед покупкой через Telegram Stars нужно принять Условия использования PromptCam.';
    gate.append(copy);

    const links = document.createElement('div');
    links.className = 'promptcam-legal-links';
    const terms = document.createElement('a');
    terms.href = '/terms.html'; terms.target = '_blank'; terms.rel = 'noopener'; terms.textContent = 'Условия использования';
    const privacy = document.createElement('a');
    privacy.href = '/privacy.html'; privacy.target = '_blank'; privacy.rel = 'noopener'; privacy.textContent = 'Политика конфиденциальности';
    links.append(terms, privacy);
    gate.append(links);

    if (!state.loaded || state.accepted) return gate;

    const label = document.createElement('label');
    label.className = 'promptcam-legal-check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    const text = document.createElement('span');
    text.textContent = 'Я прочитал(а) и принимаю Условия использования PromptCam.';
    label.append(check, text);

    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'promptcam-legal-accept';
    accept.textContent = 'Принять условия';
    accept.disabled = true;
    check.addEventListener('change', () => { accept.disabled = !check.checked || state.loading; });
    accept.addEventListener('click', async () => {
      if (!state.loaded || !check.checked || state.loading) return;
      state.loading = true;
      accept.disabled = true;
      accept.textContent = 'Сохраняю…';
      try {
        const data = await postLegal('accept');
        state.accepted = acceptedFrom(data);
        state.termsVersion = String(data.termsVersion || state.termsVersion);
        state.privacyVersion = String(data.privacyVersion || state.privacyVersion);
        applyAll();
        tg?.HapticFeedback?.notificationOccurred?.('success');
      } catch (_) {
        accept.textContent = 'Не удалось · повторить';
        accept.disabled = false;
      } finally {
        state.loading = false;
      }
    });
    gate.append(label, accept);
    return gate;
  }

  function renderGates() {
    const acceptedKey = String(state.accepted);
    const loadedKey = String(state.loaded);
    for (const target of gateTargets()) {
      const selector = `:scope > .promptcam-legal-gate[data-legal-gate="${target.key}"]`;
      const existing = target.host.querySelector(selector);
      if (existing?.dataset.accepted === acceptedKey && existing?.dataset.loaded === loadedKey) continue;
      const gate = buildGate(target.key);
      if (existing) existing.replaceWith(gate);
      else if (target.before) target.host.insertBefore(gate, target.before);
      else target.host.prepend(gate);
    }
  }

  function setLegalDisabled(button, disabled) {
    if (!button) return;
    if (disabled) {
      if (!button.disabled) button.dataset.legalDisabled = 'true';
      button.disabled = true;
    } else if (button.dataset.legalDisabled === 'true') {
      button.disabled = false;
      delete button.dataset.legalDisabled;
    }
  }

  async function buyStartPack(button) {
    if (!state.accepted || button.disabled) return;
    button.disabled = true;
    const status = document.querySelector('.ai-wallet-status');
    setTextIfChanged(status, 'Создаю счёт Telegram Stars…');
    try {
      const response = await fetch('/api/ai/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, action: 'buy_pack', pack: 'start' }),
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok || !data.invoiceUrl) throw new Error(data?.error || 'invoice_failed');
      tg.openInvoice(data.invoiceUrl, async (invoiceStatus) => {
        setTextIfChanged(status, invoiceStatus === 'paid' || invoiceStatus === 'pending'
          ? 'Платёж принят · обновляю баланс…'
          : 'Оплата отменена.');
        if (invoiceStatus === 'paid' || invoiceStatus === 'pending') {
          for (let index = 0; index < 8; index += 1) {
            await new Promise((resolve) => setTimeout(resolve, index ? 650 : 250));
            await window.PromptCamAIWallet?.refresh?.({ silent: true });
          }
        }
        button.disabled = false;
      });
    } catch (_) {
      setTextIfChanged(status, 'Не удалось создать счёт.');
      button.disabled = false;
    }
  }

  function patchWalletShop() {
    const shop = document.querySelector('.ai-wallet-shop');
    if (!shop) return;
    shop.querySelectorAll('.ai-wallet-pack[data-test="true"]').forEach((node) => node.remove());
    shop.querySelectorAll('.ai-wallet-note').forEach((node) => {
      const text = node.textContent.toLowerCase();
      if (text.includes('⭐1') || text.includes('тест')) node.remove();
    });

    let start = shop.querySelector('.promptcam-launch-start-pack');
    if (!start) {
      start = document.createElement('button');
      start.type = 'button';
      start.className = 'ai-wallet-pack promptcam-launch-start-pack';
      const strong = document.createElement('strong'); strong.textContent = '60 токенов · ⭐25';
      const small = document.createElement('small'); small.textContent = 'Стартовый пакет PromptCam AI';
      start.append(strong, small);
      start.addEventListener('click', () => buyStartPack(start));
      shop.prepend(start);
    }
    setLegalDisabled(start, !state.loaded || !state.accepted);
    shop.querySelectorAll('.ai-wallet-pack:not([data-test="true"]):not(.promptcam-launch-start-pack)')
      .forEach((button) => setLegalDisabled(button, !state.loaded || !state.accepted));
  }

  function gatePurchaseButtons() {
    const disabled = !state.loaded || !state.accepted;
    document.querySelectorAll('.promptcam-tariff-plan,.plan-option')
      .forEach((button) => setLegalDisabled(button, disabled));
  }

  let lastEventKey = '';
  function applyAll() {
    debugPolicy();
    patchPrivacyCopy();
    patchWalletShop();
    gatePurchaseButtons();
    renderGates();
    const eventKey = `${state.loaded}:${state.accepted}:${state.termsVersion}`;
    if (eventKey !== lastEventKey) {
      lastEventKey = eventKey;
      window.dispatchEvent(new CustomEvent('promptcam:legal', {
        detail: { accepted: state.accepted, loaded: state.loaded, termsVersion: state.termsVersion }
      }));
    }
  }

  let timer = 0;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; applyAll(); }, 0);
  }

  injectStyles();
  debugPolicy();
  patchPrivacyCopy();

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('promptcam:editor-hub-ready', schedule);
  window.addEventListener('promptcam:ai-wallet', schedule);
  window.addEventListener('promptcam:billing', schedule);
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });

  (async () => {
    try {
      const data = await postLegal('status');
      state.accepted = acceptedFrom(data);
      state.termsVersion = String(data.termsVersion || '');
      state.privacyVersion = String(data.privacyVersion || '');
    } catch (_) {
      state.accepted = false;
    } finally {
      state.loaded = true;
      applyAll();
    }
  })();

  window.PromptCamLegal = Object.freeze({
    refresh: async () => {
      const data = await postLegal('status');
      state.accepted = acceptedFrom(data);
      state.termsVersion = String(data.termsVersion || '');
      state.privacyVersion = String(data.privacyVersion || '');
      state.loaded = true;
      applyAll();
      return { ...state };
    },
    getStatus: () => ({ ...state })
  });
})();
