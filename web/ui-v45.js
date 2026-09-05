(() => {
  'use strict';

  const modules = [
    ['/ui-shell-v45.js?v=45', 'data-promptcam-ui-shell-v45'],
    ['/library-explain-v45.js?v=45', 'data-promptcam-library-explain-v45'],
    ['/launch-legal.js?v=46', 'data-promptcam-launch-legal-v46']
  ];

  for (const [src, attribute] of modules) {
    if (document.querySelector(`script[${attribute}]`)) continue;
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.setAttribute(attribute, 'true');
    document.head.append(script);
  }
})();
