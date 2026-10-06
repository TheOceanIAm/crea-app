import { MAPBOX_GL_VERSION, MAPBOX_STANDARD_BASEMAP, MAPBOX_STANDARD_STYLE } from '@/lib/mapboxConfig'

/**
 * Self-contained Mapbox GL JS document for Sun Planner (native WebView).
 * RN boots/updates via window.__creaBoot / window.__creaUpdate and receives
 * subject taps via ReactNativeWebView.postMessage.
 */
export function buildSunPlannerMapHtml(): string {
  const basemapConfig = JSON.stringify(MAPBOX_STANDARD_BASEMAP)
  // Keep HTML free of secrets; token arrives with __creaBoot.
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link href="https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.css" rel="stylesheet" />
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #111; }
    .mapboxgl-ctrl-logo { margin: 0 0 4px 4px !important; }
    .mapboxgl-ctrl-attrib { font-size: 9px !important; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.js"></script>
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

  function applySunLight(mapLight) {
    if (!map || !mapLight || typeof map.setLights !== 'function' || !mapLight.position) return;
    var azimuth = Number(mapLight.position[1]) || 0;
    var polar = Math.max(0, Math.min(90, Number(mapLight.position[2]) || 45));
    var sunUp = polar < 89;
    var directional = sunUp ? 1 : 0.08;
    try {
      map.setLights([
        {
          id: 'crea-ambient',
          type: 'ambient',
          properties: { color: 'rgb(210,220,232)', intensity: sunUp ? 0.22 : 0.18 }
        },
        {
          id: 'crea-sun',
          type: 'directional',
          properties: {
            color: 'rgb(255,232,180)',
            intensity: directional,
            direction: [azimuth, polar],
            'cast-shadows': sunUp,
            'shadow-intensity': sunUp ? 1 : 0
          }
        }
      ]);
    } catch (e) {}
  }

  function ensureLayers() {
    if (!map || layersReady) return;
    var before = firstSymbolLayerId();

    map.addSource('crea-shadow-area', { type: 'geojson', data: emptyFc });
    map.addLayer({
      id: 'crea-shadow-penumbra',
      type: 'fill',
      source: 'crea-shadow-area',
      filter: ['==', ['get', 'kind'], 'penumbra'],
      paint: {
        'fill-color': 'rgba(20,20,20,0.22)',
        'fill-opacity': 0.12,
        'fill-emissive-strength': 0.65,
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
        'fill-emissive-strength': 0.65,
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
        'line-blur': 2.5,
        'line-emissive-strength': 0.7
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
        'line-blur': 0.6,
        'line-emissive-strength': 0.7
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
        'line-blur': 1.5,
        'line-emissive-strength': 1
      }
    });
    map.addLayer({
      id: 'crea-sun-direction-core',
      type: 'line',
      source: 'crea-sun-direction',
      paint: {
        'line-color': '#FFDC00',
        'line-width': 3,
        'line-opacity': 0.95,
        'line-emissive-strength': 1
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
        'circle-stroke-color': '#0a0a0a',
        'circle-emissive-strength': 1
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
        'circle-stroke-color': '#0a0a0a',
        'circle-emissive-strength': 1
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

    if (state.mapLight) applySunLight(state.mapLight);

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
        style: '${MAPBOX_STANDARD_STYLE}',
        config: { basemap: ${basemapConfig} },
        center: cam.center || [0, 0],
        zoom: cam.zoom != null ? cam.zoom : 17.2,
        pitch: cam.pitch != null ? cam.pitch : 62,
        bearing: 0,
        antialias: true,
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
