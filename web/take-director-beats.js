(() => {
  'use strict';

  const panel = document.getElementById('liveAiPanel');
  const cameraView = document.getElementById('cameraView');
  const prompterText = document.getElementById('prompterText');
  const prompterScroller = document.getElementById('prompterScroller');
  if (!panel || !prompterText || !prompterScroller) return;

  const upstreamFetch = window.fetch.bind(window);
  const ACTUAL_SCRIPT_MAX_CHARS = 3200;
  const GUIDE_MAX_CHARS = 850;
  const BEATS_STORAGE_KEY = 'promptcam.script-beats.v1';

  let navRoot = null;
  let navStatus = null;
  let navHint = null;
  let currentButton = null;
  let nextButton = null;
  let lastBeatContext = null;
  let raf = 0;

  function fingerprint(text) {
    let hash = 2166136261;
    const value = String(text || '');
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function fallbackBeatPackage() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BEATS_STORAGE_KEY) || 'null');
      const script = String(prompterText.textContent || '');
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.beats)) return null;
      if (parsed.scriptHash !== fingerprint(script)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function beatPackage() {
    try {
      const pack = window.PromptCamScriptAI?.getBeatPackage?.();
      if (pack?.beats?.length) return pack;
    } catch (_) { /* Fall back to local storage. */ }
    return fallbackBeatPackage();
  }

  function compact(value, maxLength) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
  }

  function validBeats() {
    const pack = beatPackage();
    const script = String(prompterText.textContent || '');
    if (!pack?.beats?.length || !script) return [];
    const beats = [];
    for (const source of pack.beats.slice(0, 14)) {
      const anchor = compact(source?.anchor, 240);
      if (!anchor) continue;
      const offset = script.indexOf(anchor);
      if (offset < 0) continue;
      beats.push({
        kind: compact(source.kind, 24) || 'other',
        title: compact(source.title, 80) || 'Пункт',
        anchor,
        mustSay: compact(source.mustSay, 260),
        visualCue: compact(source.visualCue, 180),
        required: Boolean(source.required),
        offset
      });
    }
    beats.sort((left, right) => left.offset - right.offset);
    return beats;
  }

  function scrollProgress() {
    const maximum = Math.max(1, prompterScroller.scrollHeight - prompterScroller.clientHeight);
    return Math.max(0, Math.min(1, prompterScroller.scrollTop / maximum));
  }

  function beatContext(progressOverride = null) {
    const beats = validBeats();
    if (!beats.length) return null;
    const script = String(prompterText.textContent || '');
    const progress = Number.isFinite(Number(progressOverride))
      ? Math.max(0, Math.min(1, Number(progressOverride)))
      : scrollProgress();
    const approximate = Math.round(progress * script.length);
    let index = 0;
    for (let candidate = 0; candidate < beats.length; candidate += 1) {
      if (beats[candidate].offset <= approximate + 80) index = candidate;
      else break;
    }
    return {
      beats,
      index,
      current: beats[index],
      previous: index > 0 ? beats[index - 1] : null,
      next: index + 1 < beats.length ? beats[index + 1] : null,
      progress
    };
  }

  function guideFor(context) {
    if (!context) return '';
    const current = context.current;
    const next = context.next;
    const lines = [
      '[BEAT_MAP_CONTEXT — reference structure, not spoken words]',
      `Current beat ${context.index + 1}/${context.beats.length}: ${current.kind} — ${current.title}`,
      current.mustSay ? `Meaning to cover: ${current.mustSay}` : '',
      `Required: ${current.required ? 'yes' : 'no'}`,
      current.anchor ? `Current script anchor: ${current.anchor}` : '',
      next ? `Next beat: ${next.kind} — ${next.title}` : 'Next beat: none; this is the final beat.',
      next?.mustSay ? `Next meaning: ${next.mustSay}` : '',
      next?.anchor ? `Next script anchor: ${next.anchor}` : '',
      'Use this structure to understand what the creator is trying to cover. Natural paraphrases count as covered. Do not demand verbatim reading.',
      'If you return an assist anchor, use a phrase that exists in the real teleprompter script; prefer the current or next script anchor when appropriate.',
      '[END_BEAT_MAP_CONTEXT]'
    ].filter(Boolean);
    return lines.join('\n').slice(0, GUIDE_MAX_CHARS);
  }

  function isLiveAiRequest(input) {
    const raw = typeof input === 'string' ? input : input?.url;
    if (typeof raw !== 'string') return false;
    try {
      const url = new URL(raw, window.location.href);
      return url.origin === window.location.origin && url.pathname === '/api/ai/live';
    } catch (_) {
      return raw === '/api/ai/live';
    }
  }

  function responseWithJson(response, data) {
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.delete('Content-Length');
    return new Response(JSON.stringify(data), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  window.fetch = async function promptCamBeatAwareFetch(input, init = {}) {
    if (!isLiveAiRequest(input) || typeof init?.body !== 'string') return upstreamFetch(input, init);

    let payload;
    try { payload = JSON.parse(init.body); }
    catch (_) { return upstreamFetch(input, init); }
    if (payload?.mode !== 'take' || !payload?.takeDirector) return upstreamFetch(input, init);

    const context = beatContext(payload.takeDirector.progress);
    if (context) {
      const actualWindow = typeof payload.takeDirector.scriptWindow === 'string'
        ? payload.takeDirector.scriptWindow.slice(0, ACTUAL_SCRIPT_MAX_CHARS)
        : '';
      const guide = guideFor(context);
      payload.takeDirector.scriptWindow = `${guide}\n[ACTUAL_SCRIPT_WINDOW]\n${actualWindow}`;
      payload.takeDirector.beatIndex = context.index;
      payload.takeDirector.beatCount = context.beats.length;
      lastBeatContext = context;
      emitBeatState(context);
    }

    const response = await upstreamFetch(input, { ...init, body: JSON.stringify(payload) });
    if (!context || !response.ok) return response;

    const data = await response.clone().json().catch(() => null);
    const take = data?.takeDirector;
    if (!take) return response;

    if (take.action === 'assist') {
      const fullScript = String(prompterText.textContent || '');
      const anchorValid = typeof take.anchor === 'string' && take.anchor && fullScript.includes(take.anchor);
      if (!anchorValid) {
        const fallback = (take.status === 'continue' || take.status === 'help')
          ? (context.next?.anchor || context.current?.anchor || '')
          : (context.current?.anchor || context.next?.anchor || '');
        if (fallback) take.anchor = fallback;
        else {
          take.action = 'none';
          take.status = 'on_track';
          take.text = '';
          take.anchor = '';
          take.confidence = 'low';
        }
      }
    }

    data.beatContext = {
      current: context.index,
      count: context.beats.length,
      title: context.current.title,
      kind: context.current.kind,
      nextTitle: context.next?.title || ''
    };
    return responseWithJson(response, data);
  };

  function injectStyles() {
    if (document.getElementById('promptcamTakeBeatStyles')) return;
    const style = document.createElement('style');
    style.id = 'promptcamTakeBeatStyles';
    style.textContent = `
      .take-beat-nav { margin-top: 8px; padding: 9px; border: 1px solid rgba(255,255,255,.07); border-radius: 13px; background: rgba(255,255,255,.025); }
      .take-beat-nav-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .take-beat-nav-head strong { color:#d8cef7; font-size:9.5px; }
      .take-beat-nav-head span { color:#8f89a0; font-size:8px; }
      .take-beat-nav-hint { margin:5px 0 7px; color:#a19aac; font-size:8.5px; line-height:1.3; }
      .take-beat-nav-actions { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
      .take-beat-nav-button { min-height:34px; border:1px solid rgba(255,255,255,.09); border-radius:10px; background:rgba(255,255,255,.045); color:#d2cbdc; font-size:9px; font-weight:760; }
      .take-beat-nav-button:last-child { border-color:rgba(137,102,255,.34); background:rgba(103,72,220,.11); color:#eee9ff; }
      .take-beat-nav-button:disabled { opacity:.42; }
    `;
    document.head.append(style);
  }

  function emitBeatState(context = beatContext()) {
    window.dispatchEvent(new CustomEvent('promptcam:take-beat-state', {
      detail: context ? {
        current: context.index,
        count: context.beats.length,
        title: context.current.title,
        kind: context.current.kind,
        nextTitle: context.next?.title || ''
      } : { current: -1, count: 0, title: '', kind: '', nextTitle: '' }
    }));
    renderNavigation(context);
  }

  function renderNavigation(context = beatContext()) {
    if (!navRoot) return;
    if (!context) {
      navStatus.textContent = 'Нет beat-карты';
      navHint.textContent = 'На первой странице нажми «🎬 Подготовить к съёмке», чтобы появились смысловые переходы.';
      currentButton.disabled = true;
      nextButton.disabled = true;
      return;
    }
    navStatus.textContent = `Пункт ${context.index + 1} из ${context.beats.length}`;
    navHint.textContent = context.next
      ? `Сейчас: ${context.current.title} · дальше: ${context.next.title}`
      : `Сейчас: ${context.current.title} · финальный пункт`;
    currentButton.disabled = !context.current?.anchor;
    nextButton.disabled = !context.next?.anchor;
  }

  function jumpTo(beat) {
    if (!beat?.anchor) return false;
    const ok = window.PromptCamTakeDirector?.jumpToAnchor?.(beat.anchor);
    if (ok) {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light');
      window.setTimeout(() => emitBeatState(), 280);
    }
    return Boolean(ok);
  }

  function decorateTakeDirector() {
    const block = panel.querySelector('.take-director-block');
    if (!block || block.querySelector('.take-beat-nav')) return false;
    injectStyles();
    navRoot = document.createElement('section');
    navRoot.className = 'take-beat-nav';
    const head = document.createElement('div');
    head.className = 'take-beat-nav-head';
    const label = document.createElement('strong');
    label.textContent = 'СТРУКТУРА ДУБЛЯ';
    navStatus = document.createElement('span');
    head.append(label, navStatus);
    navHint = document.createElement('p');
    navHint.className = 'take-beat-nav-hint';
    const actions = document.createElement('div');
    actions.className = 'take-beat-nav-actions';
    currentButton = document.createElement('button');
    currentButton.type = 'button';
    currentButton.className = 'take-beat-nav-button';
    currentButton.textContent = '↩ К текущему пункту';
    nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'take-beat-nav-button';
    nextButton.textContent = '→ Следующий пункт';
    currentButton.addEventListener('click', () => jumpTo(beatContext()?.current));
    nextButton.addEventListener('click', () => jumpTo(beatContext()?.next));
    actions.append(currentButton, nextButton);
    navRoot.append(head, navHint, actions);
    block.append(navRoot);
    renderNavigation();
    return true;
  }

  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      decorateTakeDirector();
      emitBeatState();
    });
  }

  const panelObserver = new MutationObserver(scheduleRender);
  panelObserver.observe(panel, { childList: true, subtree: true });
  const scriptObserver = new MutationObserver(scheduleRender);
  scriptObserver.observe(prompterText, { childList: true, subtree: true, characterData: true });
  const cameraObserver = cameraView ? new MutationObserver(scheduleRender) : null;
  cameraObserver?.observe(cameraView, { attributes: true, attributeFilter: ['class'] });
  prompterScroller.addEventListener('scroll', scheduleRender, { passive: true });
  window.addEventListener('promptcam:creator-modules-ready', scheduleRender);
  window.addEventListener('pagehide', () => {
    panelObserver.disconnect();
    scriptObserver.disconnect();
    cameraObserver?.disconnect();
  });

  scheduleRender();

  window.PromptCamTakeBeats = Object.freeze({
    getContext: () => beatContext(),
    jumpCurrent: () => jumpTo(beatContext()?.current),
    jumpNext: () => jumpTo(beatContext()?.next),
    getLastRequestContext: () => lastBeatContext
  });
})();
