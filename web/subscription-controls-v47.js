(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  if (!initData) return;

  let subscription = null;
  let loading = false;
  let timer = 0;

  function injectStyles() {
    if (document.getElementById('promptcamSubscriptionV47Styles')) return;
    const style = document.createElement('style');
    style.id = 'promptcamSubscriptionV47Styles';
    style.textContent = `
      .promptcam-subscription-control{display:grid;gap:7px;margin-top:9px;padding:10px 11px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:rgba(255,255,255,.022)}
      .promptcam-subscription-control strong{font-size:11px;color:#eee9f7}.promptcam-subscription-control small{font-size:9.5px;line-height:1.4;color:#817a8e}
      .promptcam-subscription-control button{min-height:36px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.035);color:#bbb4c7;font-size:10px;font-weight:760}
      .promptcam-subscription-control[data-canceled="false"] button{border-color:rgba(255,166,79,.2);color:#e6bd91}.promptcam-subscription-control[data-canceled="true"] button{border-color:rgba(112,206,154,.22);color:#9edbb7}
      .promptcam-subscription-control button:disabled{opacity:.5}
      .promptcam-active-pro-note{margin:9px 1px 0;color:#8b8497;font-size:9.5px;line-height:1.4}
    `;
    document.head.append(style);
  }

  async function api(action = 'status') {
    const response = await fetch('/api/billing/subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action }),
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      const error = new Error(data?.error || 'subscription_request_failed');
      error.status = response.status;
      throw error;
    }
    return data.subscription || null;
  }

  function dateLabel(seconds) {
    if (!seconds) return '';
    try {
      return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
        .format(new Date(Number(seconds) * 1000));
    } catch (_) { return ''; }
  }

  function ask(message) {
    return new Promise((resolve) => {
      if (typeof tg?.showConfirm === 'function') tg.showConfirm(message, (value) => resolve(Boolean(value)));
      else resolve(window.confirm(message));
    });
  }

  async function change(cancel, button) {
    if (loading) return;
    const confirmed = await ask(cancel
      ? 'Остановить автопродление? PromptCam Pro останется активным до конца уже оплаченного периода.'
      : 'Снова включить автоматическое продление PromptCam Pro каждые 30 дней?');
    if (!confirmed) return;
    loading = true;
    if (button) button.disabled = true;
    try {
      subscription = await api(cancel ? 'cancel' : 'resume');
      tg?.HapticFeedback?.notificationOccurred?.('success');
      await window.PromptCamBilling?.refresh?.();
    } catch (_) {
      tg?.showAlert?.('Не удалось изменить автопродление. Попробуй позже или напиши /paysupport в боте.');
    } finally {
      loading = false;
      render();
    }
  }

  function guardPlanPurchases(host) {
    const access = window.PromptCamBilling?.state?.access || {};
    const active = Boolean(access.pro);
    const plans = host.querySelector('.promptcam-tariff-plans');
    if (plans) plans.hidden = active;
    let note = host.querySelector('.promptcam-active-pro-note');
    if (active) {
      if (!note) {
        note = document.createElement('p');
        note.className = 'promptcam-active-pro-note';
        const current = host.querySelector('.promptcam-tariff-current');
        (current || host).insertAdjacentElement?.('afterend', note);
        if (!note.isConnected) host.prepend(note);
      }
      note.textContent = 'Пока Pro активен, второй тариф не продаётся — это защищает от случайного двойного списания Stars.';
    } else {
      note?.remove();
    }
  }

  function render() {
    const host = document.getElementById('promptcamTariffHubContent');
    if (!host) return;
    guardPlanPurchases(host);

    const old = host.querySelector('.promptcam-subscription-control');
    if (!subscription?.recurring || !subscription?.active || !subscription?.canManage) {
      old?.remove();
      return;
    }

    let card = old;
    if (!card) {
      card = document.createElement('section');
      card.className = 'promptcam-subscription-control';
      const current = host.querySelector('.promptcam-tariff-current');
      if (current) current.insertAdjacentElement('afterend', card);
      else host.prepend(card);
    }
    card.dataset.canceled = String(Boolean(subscription.canceled));
    card.replaceChildren();

    const title = document.createElement('strong');
    title.textContent = subscription.canceled
      ? 'Автопродление остановлено'
      : subscription.lastState === 'failed'
        ? 'Последнее продление не прошло'
        : 'Автопродление включено';
    const hint = document.createElement('small');
    const until = dateLabel(subscription.expiresAt);
    hint.textContent = subscription.canceled
      ? `Текущий Pro остаётся активным${until ? ` до ${until}` : ' до конца оплаченного периода'}. Новых списаний не будет.`
      : subscription.lastState === 'failed'
        ? `Текущий доступ остаётся до ${until || 'конца оплаченного периода'}. Проверь баланс Stars перед следующим продлением.`
        : `Следующее продление происходит по правилам Telegram Stars${until ? ` после текущего периода до ${until}` : ''}.`;
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = loading;
    button.textContent = subscription.canceled ? 'Возобновить автопродление' : 'Остановить автопродление';
    button.addEventListener('click', () => change(!subscription.canceled, button));
    card.append(title, hint, button);
  }

  async function refresh({ silent = false } = {}) {
    if (loading && !silent) return subscription;
    try {
      subscription = await api('status');
      render();
    } catch (_) {
      subscription = null;
      render();
    }
    return subscription;
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; refresh({ silent: true }); }, 80);
  }

  injectStyles();
  window.addEventListener('promptcam:billing', schedule);
  window.addEventListener('promptcam:editor-hub-ready', schedule);
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-hub-action="tariff"]')) schedule();
  }, true);
  refresh({ silent: true });

  window.PromptCamSubscription = Object.freeze({ refresh, getStatus: () => subscription ? { ...subscription } : null });
})();
