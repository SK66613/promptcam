(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  const upgradeButton = document.getElementById('upgradeButton');
  const paywallDialog = document.getElementById('paywallDialog');
  const paywallClose = document.getElementById('paywallClose');
  const planList = document.getElementById('planList');
  const paywallStatus = document.getElementById('paywallStatus');
  const resultAccessStatus = document.getElementById('resultAccessStatus');
  const recordButton = document.getElementById('recordButton');

  const state = {
    access: { pro: false, plan: '', expiresAt: 0, recurring: false },
    billingConfigured: false,
    plans: [],
    loading: false
  };

  const api = {
    state,
    ready: null,
    refresh: refreshAccess,
    openPaywall
  };
  window.PromptCamBilling = api;

  if (recordButton) recordButton.disabled = true;

  function setStatus(message = '', tone = '') {
    if (!paywallStatus) return;
    paywallStatus.textContent = message;
    paywallStatus.dataset.tone = tone;
    paywallStatus.classList.toggle('hidden', !message);
  }

  function applyWatermarkPolicy() {
    window.PromptCamWatermark?.setEnabled?.(!state.access.pro);
    document.documentElement.dataset.access = state.access.pro ? 'pro' : 'free';
  }

  function formatExpiry(timestamp) {
    if (!timestamp) return '';
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(timestamp * 1000));
    } catch (_) {
      return '';
    }
  }

  function renderAccess() {
    applyWatermarkPolicy();

    if (state.access.pro) {
      if (upgradeButton) upgradeButton.classList.add('hidden');
      if (resultAccessStatus) {
        const until = formatExpiry(state.access.expiresAt);
        resultAccessStatus.textContent = until
          ? `PromptCam Pro активен до ${until}. Новые записи сохраняются без водяного знака.`
          : 'PromptCam Pro активен. Новые записи сохраняются без водяного знака.';
        resultAccessStatus.dataset.tone = 'success';
        resultAccessStatus.classList.remove('hidden');
      }
      return;
    }

    if (upgradeButton) upgradeButton.classList.remove('hidden');
    if (resultAccessStatus) {
      resultAccessStatus.textContent = '';
      resultAccessStatus.classList.add('hidden');
      delete resultAccessStatus.dataset.tone;
    }
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || 'request_failed');
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function refreshAccess() {
    if (!initData) {
      state.access = { pro: false, plan: '', expiresAt: 0, recurring: false };
      state.billingConfigured = false;
      state.plans = [];
      renderAccess();
      return state.access;
    }

    try {
      const payload = await postJson('/api/me', { initData });
      state.access = payload.access || { pro: false, plan: '', expiresAt: 0, recurring: false };
      state.billingConfigured = Boolean(payload.billingConfigured);
      state.plans = Array.isArray(payload.plans) ? payload.plans : [];
      renderAccess();
      return state.access;
    } catch (_) {
      state.access = { pro: false, plan: '', expiresAt: 0, recurring: false };
      state.billingConfigured = false;
      state.plans = [];
      renderAccess();
      return state.access;
    }
  }

  function planSubtitle(plan) {
    if (plan.recurring) return 'Автопродление каждые 30 дней';
    if (plan.id === 'day') return 'Разовый доступ на 24 часа';
    if (plan.id === 'week') return 'Разовый доступ на 7 дней';
    if (plan.id === 'year') return 'Разовый доступ на 365 дней';
    return 'PromptCam Pro';
  }

  function renderPlans() {
    if (!planList) return;
    planList.replaceChildren();

    for (const plan of state.plans) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'plan-option';
      button.dataset.plan = plan.id;

      const main = document.createElement('span');
      main.className = 'plan-copy';
      const title = document.createElement('strong');
      title.textContent = plan.title;
      const subtitle = document.createElement('small');
      subtitle.textContent = planSubtitle(plan);
      main.append(title, subtitle);

      if (plan.badge) {
        const badge = document.createElement('em');
        badge.textContent = plan.badge;
        main.append(badge);
      }

      const price = document.createElement('span');
      price.className = 'plan-price';
      price.textContent = `⭐ ${plan.stars}`;

      button.append(main, price);
      button.addEventListener('click', () => purchase(plan.id, button));
      planList.append(button);
    }
  }

  function showUnavailable(message) {
    if (typeof tg?.showAlert === 'function') tg.showAlert(message);
    else window.alert(message);
  }

  async function openPaywall() {
    if (state.loading) return;
    await refreshAccess();

    if (state.access.pro) return;
    if (!initData || !tg) {
      showUnavailable('Оплата PromptCam Pro через Telegram Stars доступна внутри Telegram Mini App.');
      return;
    }
    if (!state.billingConfigured) {
      showUnavailable('Оплата ещё не подключена к базе PromptCam. Попробуй немного позже.');
      return;
    }

    renderPlans();
    setStatus('');
    if (paywallDialog && !paywallDialog.open) paywallDialog.showModal();
    try { tg.HapticFeedback?.impactOccurred('light'); } catch (_) { /* Telegram haptics are optional. */ }
  }

  function setPlansDisabled(disabled) {
    planList?.querySelectorAll('button').forEach((button) => {
      button.disabled = Boolean(disabled);
    });
  }

  async function waitForEntitlement() {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 350 : 1000));
      const access = await refreshAccess();
      if (access.pro) return true;
    }
    return false;
  }

  async function purchase(planId, selectedButton) {
    if (state.loading || !initData || !tg?.openInvoice) return;
    state.loading = true;
    setPlansDisabled(true);
    selectedButton?.classList.add('is-loading');
    setStatus('Создаём счёт в Telegram…');

    try {
      const invoice = await postJson('/api/billing/invoice', { initData, plan: planId });
      setStatus('Открой оплату Telegram Stars.');

      tg.openInvoice(invoice.invoiceUrl, async (status) => {
        if (status === 'cancelled') {
          setStatus('Оплата отменена.');
          state.loading = false;
          setPlansDisabled(false);
          selectedButton?.classList.remove('is-loading');
          return;
        }

        if (status === 'failed') {
          setStatus('Telegram не смог провести оплату. Попробуй ещё раз.', 'error');
          state.loading = false;
          setPlansDisabled(false);
          selectedButton?.classList.remove('is-loading');
          return;
        }

        if (status === 'paid' || status === 'pending') {
          setStatus('Платёж принят. Активируем PromptCam Pro…');
          const activated = await waitForEntitlement();
          if (activated) {
            setStatus('PromptCam Pro активирован ✓', 'success');
            try { tg.HapticFeedback?.notificationOccurred('success'); } catch (_) { /* optional */ }
            window.setTimeout(() => paywallDialog?.close(), 650);
          } else {
            setStatus('Платёж обрабатывается. Pro активируется автоматически через несколько секунд.');
          }
        }

        state.loading = false;
        setPlansDisabled(false);
        selectedButton?.classList.remove('is-loading');
      });
    } catch (error) {
      const message = error.message === 'billing_not_configured'
        ? 'Оплата ещё не подключена к D1.'
        : 'Не удалось создать счёт Telegram Stars. Попробуй ещё раз.';
      setStatus(message, 'error');
      state.loading = false;
      setPlansDisabled(false);
      selectedButton?.classList.remove('is-loading');
    }
  }

  upgradeButton?.addEventListener('click', openPaywall);
  paywallClose?.addEventListener('click', () => paywallDialog?.close());
  paywallDialog?.addEventListener('click', (event) => {
    if (event.target === paywallDialog && !state.loading) paywallDialog.close();
  });
  paywallDialog?.addEventListener('cancel', (event) => {
    if (state.loading) event.preventDefault();
  });

  api.ready = refreshAccess().finally(() => {
    if (recordButton) recordButton.disabled = false;
  });
})();
