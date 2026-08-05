/**
 * Self-contained Mapbox GL JS document for Sun Planner (native WebView).
 * RN boots/updates via window.__creaBoot / window.__creaUpdate and receives
 * subject taps via ReactNativeWebView.postMessage.
 */
export function buildSunPlannerMapHtml(): string {
  // Keep HTML free of secrets; token arrives with __creaBoot.
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link href="https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css" rel="stylesheet" />
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #111; }
    .mapboxgl-ctrl-logo { margin: 0 0 4px 4px !important; }
    .mapboxgl-ctrl-attrib { font-size: 9px !important; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.js"></script>
  <script>
(function () {
  var map = null;
  var layersReady = false;
  var emptyFc = { type: 'FeatureCollection', features: [] };

  function post(msg) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    } catch (e) {}
  }

  function setSrc(id, data) {
    if (!map) return;
    var src = map.getSource(id);
    if (src && typeof src.setData === 'function') src.setData(data || emptyFc);
  }

  function firstSymbolLayerId() {
    var layers = map.getStyle().layers || [];
    for (var i = 0; i < layers.length; i++) {
      if (layers[i].type === 'symbol') return layers[i].id;
    }
    return undefined;
  }

  function ensureLayers() {
    if (!map || layersReady) return;
    var before = firstSymbolLayerId();

    if (!map.getSource('crea-buildings')) {
      map.addSource('crea-buildings', {
        type: 'vector',
        url: 'mapbox://mapbox.mapbox-streets-v8'
      });
    }

    // Single soft building shadow (no near/mid/far stacking).
    if (!map.getLayer('crea-building-shadow')) {
      map.addLayer({
        id: 'crea-building-shadow',
        source: 'crea-buildings',
        'source-layer': 'building',
        filter: ['==', ['get', 'extrude'], 'true'],
        type: 'fill',
        paint: {
          'fill-color': 'rgba(0,0,0,0.4)',
          'fill-opacity': 0,
          'fill-translate': [0, 0],
          'fill-translate-anchor': 'map'
        }
      }, before);
    }

    if (!map.getLayer('crea-3d-buildings')) {
      map.addLayer({
        id: 'crea-3d-buildings',
        source: 'crea-buildings',
        'source-layer': 'building',
        filter: ['==', ['get', 'extrude'], 'true'],
        type: 'fill-extrusion',
        paint: {
          'fill-extrusion-color': '#e6e8ec',
          'fill-extrusion-opacity': 0.88,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0]
        }
      }, before);
    }

    map.addSource('crea-shadow-area', { type: 'geojson', data: emptyFc });
    map.addLayer({
      id: 'crea-shadow-penumbra',
      type: 'fill',
      source: 'crea-shadow-area',
      filter: ['==', ['get', 'kind'], 'penumbra'],
      paint: {
        'fill-color': 'rgba(20,20,20,0.22)',
        'fill-opacity': 0.12,
        'fill-opacity-transition': { duration: 180 }
      }
    }, before);
    map.addLayer({
      id: 'crea-shadow-umbra',
      type: 'fill',
      source: 'crea-shadow-area',
      filter: ['==', ['get', 'kind'], 'umbra'],
      paint: {
        'fill-color': 'rgba(10,10,10,0.4)',
        'fill-opacity': 0.2,
        'fill-opacity-transition': { duration: 180 }
      }
    }, before);

    map.addSource('crea-shadow-line', { type: 'geojson', data: emptyFc });
    map.addLayer({
      id: 'crea-shadow-line-soft',
      type: 'line',
      source: 'crea-shadow-line',
      paint: {
        'line-color': 'rgba(10,10,10,0.35)',
        'line-width': 10,
        'line-opacity': 0.2,
        'line-blur': 2.5
      }
    }, before);
    map.addLayer({
      id: 'crea-shadow-line-core',
      type: 'line',
      source: 'crea-shadow-line',
      paint: {
        'line-color': 'rgba(10,10,10,0.7)',
        'line-width': 3.5,
        'line-opacity': 0.35,
        'line-blur': 0.6
      }
    }, before);

    map.addSource('crea-sun-direction', { type: 'geojson', data: emptyFc });
    map.addLayer({
      id: 'crea-sun-direction-soft',
      type: 'line',
      source: 'crea-sun-direction',
      paint: {
        'line-color': 'rgba(255,220,0,0.42)',
        'line-width': 8,
        'line-opacity': 0.5,
        'line-blur': 1.5
      }
    });
    map.addLayer({
      id: 'crea-sun-direction-core',
      type: 'line',
      source: 'crea-sun-direction',
      paint: {
        'line-color': '#FFDC00',
        'line-width': 3,
        'line-opacity': 0.95
      }
    });

    map.addSource('crea-sun-tip', { type: 'geojson', data: emptyFc });
    map.addLayer({
      id: 'crea-sun-tip-circle',
      type: 'circle',
      source: 'crea-sun-tip',
      paint: {
        'circle-radius': 5,
        'circle-color': '#FFDC00',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#0a0a0a'
      }
    });

    map.addSource('crea-subject', { type: 'geojson', data: emptyFc });
    map.addLayer({
      id: 'crea-subject-circle',
      type: 'circle',
      source: 'crea-subject',
      paint: {
        'circle-radius': 9,
        'circle-color': '#FFDC00',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#0a0a0a'
      }
    });

    layersReady = true;
  }

  function applyState(state) {
    if (!map || !state) return;
    ensureLayers();

    var cam = state.camera || {};
    if (cam.center) {
      map.easeTo({
        center: cam.center,
        zoom: cam.zoom != null ? cam.zoom : map.getZoom(),
        pitch: cam.pitch != null ? cam.pitch : map.getPitch(),
        duration: 220,
        essential: true
      });
    }

    if (state.mapLight) {
      try {
        map.setLight({
          anchor: state.mapLight.anchor || 'map',
          position: state.mapLight.position,
          intensity: state.mapLight.intensity
        });
      } catch (e) {}
    }

    setSrc('crea-subject', state.subjectPoint);
    setSrc('crea-sun-direction', state.sunDirection);
    setSrc('crea-sun-tip', state.sunTip);
    setSrc('crea-shadow-area', state.shadowArea);
    setSrc('crea-shadow-line', state.shadowLine);

    var tone = state.shadowTone || {};
    if (map.getLayer('crea-shadow-penumbra')) {
      map.setPaintProperty('crea-shadow-penumbra', 'fill-opacity', tone.penumbraOpacity != null ? tone.penumbraOpacity : 0.12);
    }
    if (map.getLayer('crea-shadow-umbra')) {
      map.setPaintProperty('crea-shadow-umbra', 'fill-opacity', tone.umbraOpacity != null ? tone.umbraOpacity : 0.2);
    }
    if (map.getLayer('crea-shadow-line-soft')) {
      map.setPaintProperty('crea-shadow-line-soft', 'line-opacity', (tone.lineOpacity || 0.3) * 0.42);
    }
    if (map.getLayer('crea-shadow-line-core')) {
      map.setPaintProperty('crea-shadow-line-core', 'line-opacity', tone.lineOpacity || 0.35);
    }

    var b = state.buildingShadow || {};
    if (map.getLayer('crea-building-shadow')) {
      var visible = !!b.visible;
      map.setLayoutProperty('crea-building-shadow', 'visibility', visible ? 'visible' : 'none');
      map.setPaintProperty('crea-building-shadow', 'fill-opacity', visible ? (b.opacity || 0) : 0);
      map.setPaintProperty('crea-building-shadow', 'fill-translate', b.translate || [0, 0]);
    }
  }

  window.__creaBoot = function (cfg) {
    try {
      if (!window.mapboxgl) {
        post({ type: 'error', message: 'Mapbox GL failed to load' });
        return;
      }
      if (map) {
        applyState(cfg && cfg.state);
        return;
      }
      var token = cfg && cfg.token;
      if (!token) {
        post({ type: 'error', message: 'Missing Mapbox token' });
        return;
      }
      mapboxgl.accessToken = token;
      var state = (cfg && cfg.state) || {};
      var cam = state.camera || {};
      map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: cam.center || [0, 0],
        zoom: cam.zoom != null ? cam.zoom : 17,
        pitch: cam.pitch != null ? cam.pitch : 55,
        bearing: 0,
        attributionControl: true,
        logoPosition: 'bottom-left'
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right');
      map.on('click', function (e) {
        var lat = Number(e.lngLat.lat);
        var lon = Number(e.lngLat.lng);
        if (isFinite(lat) && isFinite(lon)) post({ type: 'subject', lat: lat, lon: lon });
      });
      map.on('error', function (e) {
        var msg = (e && e.error && e.error.message) || 'Map failed to load';
        post({ type: 'error', message: String(msg) });
      });
      map.on('load', function () {
        applyState(state);
        post({ type: 'ready' });
      });
    } catch (err) {
      post({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
  };

  window.__creaUpdate = function (state) {
    try {
      applyState(state);
    } catch (err) {
      post({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
  };

  if (window.mapboxgl) {
    post({ type: 'script-ready' });
  } else {
    post({ type: 'error', message: 'Mapbox GL script missing' });
  }
})();
  </script>
</body>
</html>`
}
