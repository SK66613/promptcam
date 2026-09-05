(() => {
  'use strict';

  const ALWAYS_PRODUCTION_KIND = [
    'оператор',
    'свет',
    'актёрский коуч',
    'актерский коуч',
    'acting coach',
    'критик',
    'льстец',
    'ai дубль',
    'take director'
  ];

  const PRODUCTION_TEXT_HINTS = [
    'камера', 'камеру', 'кадре', 'кадр', 'объектив', 'свет', 'окно', 'экспозиц',
    'подними камеру', 'опусти камеру', 'смести камеру', 'повернись', 'поверни голову',
    'взгляд', 'смотри в объектив', 'плеч', 'поза', 'жест', 'руки', 'наклони',
    'отодвинься', 'приблизься', 'стань ближе', 'стань дальше'
  ];

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function productionOnly(row) {
    const kind = normalize(row.querySelector('.creator-favorite-row-head strong')?.textContent);
    const text = normalize(row.querySelector('.creator-favorite-text')?.textContent);
    const detail = normalize(row.querySelector('.creator-favorite-detail')?.textContent);

    if (ALWAYS_PRODUCTION_KIND.some((term) => kind.includes(term))) return true;

    // Director notes are mixed: some are useful spoken hooks, some are pure filming actions.
    // Hide the script action only when the text is clearly about camera/performance mechanics.
    if (kind.includes('режисс')) {
      const combined = `${text} ${detail}`;
      return PRODUCTION_TEXT_HINTS.some((term) => combined.includes(term));
    }

    return false;
  }

  function refresh() {
    const rows = document.querySelectorAll('.creator-favorite-row-personal');
    for (const row of rows) {
      const actions = row.querySelector('.creator-row-actions');
      if (!actions) continue;
      const integrate = [...actions.querySelectorAll('button')]
        .find((button) => normalize(button.textContent).includes('встроить с ai'));
      if (!integrate) continue;

      if (productionOnly(row)) {
        integrate.remove();
        actions.style.gridTemplateColumns = '1fr';
        const remove = actions.querySelector('button');
        if (remove) remove.style.width = '100%';
        row.dataset.scriptInsert = 'false';
      } else {
        row.dataset.scriptInsert = 'true';
      }
    }
  }

  let timer = 0;
  function schedule() {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      refresh();
    }, 0);
  }

  const observer = new MutationObserver(schedule);
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { childList: true, subtree: true }), { once: true });

  window.addEventListener('promptcam:creator-library-ready', schedule);
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  schedule();
})();
