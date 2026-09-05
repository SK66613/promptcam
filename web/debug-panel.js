(function () {
  'use strict';
  if (new URLSearchParams(window.location.search).get('debug') !== '1') return;
  if (document.querySelector('script[data-promptcam-debug-internal]')) return;
  var script = document.createElement('script');
  script.src = '/debug-panel-internal.js?v=47';
  script.async = false;
  script.setAttribute('data-promptcam-debug-internal', 'true');
  document.head.appendChild(script);
})();
