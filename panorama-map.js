(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else factory({window: root, document: root.document}).start();
})(typeof window === 'object' ? window : this, function ({window: win, document: doc}) {
  const $ = id => doc.getElementById(id);
  const raw = (new URLSearchParams(win.location.search).get('point') || '').split(',');
  const point = raw.map(value => value.trim() ? Number(value) : NaN);
  const valid = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  let map, manager, startupTimer;
  let disposed = false, usingWidget = false;

  function send(type, extra = {}) {
    if (win.parent !== win) win.parent.postMessage({type: 'yard-panorama-' + type, ...extra}, '*');
  }

  function reportError(text) {
    if (disposed) return;
    $('notice').textContent = text;
    $('fallback').hidden = false;
    send('error', {message: text});
  }

  function mapKey() {
    try {
      if (win.parent.location.origin === win.location.origin && win.parent.MAP_CONFIG?.activeYandexApiKey) {
        return win.parent.MAP_CONFIG.activeYandexApiKey;
      }
      const saved = win.localStorage.getItem('courtyard-yandex-key');
      if (saved) return saved;
    } catch { /* Standalone pages can run with storage disabled. */ }
    return win.MAP_CONFIG?.yandexApiKey || '';
  }

  function yandexUrl(path) {
    const url = new URL(path, 'https://yandex.ru');
    const coords = point.join(',');
    url.search = new URLSearchParams({
      'panorama[point]': coords, 'panorama[full]': 'true', ll: coords, l: 'stv,sta', z: '18', lang: 'ru_RU'
    });
    return url.href;
  }

  function showWidget() {
    if (disposed || usingWidget) return;
    usingWidget = true;
    win.clearTimeout(startupTimer);
    const frame = $('panoramaWidget');
    $('notice').textContent = 'Загружаем уличный снимок Яндекса…';
    frame.onload = () => {
      if (!disposed) $('notice').textContent = '';
    };
    frame.onerror = () => reportError('Виджет не загрузился. Откройте выбранную точку в Яндекс Картах.');
    frame.src = yandexUrl('/map-widget/v1/');
    frame.hidden = false;
    doc.body.classList.add('widget-mode');
    $('cameraLegend').hidden = true;
    $('location').textContent = '';
    $('legend').hidden = !map;
    $('panoramaMap').hidden = !map;
    send('widget');
    if (manager) {
      manager.disableLookup();
      if (manager.getPlayer()) manager.closePlayer();
    }
    if (map) {
      map.container.fitToViewport();
      map.setCenter(point, 17);
    }
  }

  function changed(player) {
    if (disposed || usingWidget) return;
    const p = player.getPanorama().getPosition().slice(0, 2);
    if (!valid(p)) return;
    win.clearTimeout(startupTimer);
    $('notice').textContent = '';
    map.container.fitToViewport();
    player.fitToViewport();
    $('location').textContent = 'Место съёмки: ' + p[1].toFixed(6) + ', ' + p[0].toFixed(6);
    send('position', {point: p});
  }

  async function init(api) {
    if (disposed || usingWidget) return;
    map = new api.Map('panoramaMap', {
      center: point, zoom: 18, controls: ['zoomControl'], behaviors: ['drag', 'scrollZoom', 'multiTouch']
    }, {suppressMapOpenBlock: false});
    map.geoObjects.add(new api.Placemark(point, {
      hintContent: 'Выбранная точка на маршруте',
      balloonContent: 'Выбранная точка: ' + point[1].toFixed(6) + ', ' + point[0].toFixed(6)
    }, {preset: 'islands#orangeCircleDotIcon', zIndex: 1000}));
    manager = await map.getPanoramaManager();
    if (disposed || usingWidget) return;
    manager.events.add('openplayer', () => {
      if (disposed) return;
      if (usingWidget) { manager.closePlayer(); return; }
      const player = manager.getPlayer();
      if (!player) return;
      changed(player);
      player.events.add('panoramachange', () => changed(player));
      player.events.add('error', showWidget);
    });
    manager.events.add('closeplayer', () => {
      if (disposed || usingWidget) return;
      $('notice').textContent = 'Выберите место на синей линии карты, чтобы открыть панораму.';
      send('map');
    });
    manager.enableLookup();
    await manager.openPlayer(point);
  }

  function start() {
    if (point.length !== 2 || !valid(point)) {
      $('notice').textContent = 'Не удалось определить точку. Закройте окно и нажмите на маршрут ещё раз.';
      send('error');
      return;
    }
    $('fallbackLink').href = yandexUrl('/maps/');
    startupTimer = win.setTimeout(showWidget, 12000);
    const script = doc.createElement('script');
    const url = new URL('https://api-maps.yandex.ru/2.1/');
    url.search = new URLSearchParams({lang: 'ru_RU', coordorder: 'longlat', ns: 'yardPanoramaApi', apikey: mapKey()});
    script.src = url.href;
    script.onerror = showWidget;
    script.onload = () => {
      const api = win.yardPanoramaApi;
      if (!api) { showWidget(); return; }
      api.ready(() => init(api).catch(showWidget), showWidget);
    };
    doc.head.append(script);
  }

  win.addEventListener('resize', () => { if (!disposed) map?.container.fitToViewport(); });
  win.addEventListener('pagehide', () => {
    disposed = true;
    win.clearTimeout(startupTimer);
    map?.destroy();
  });
  return {start, init, changed};
});
