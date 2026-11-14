/* Wayfinder 3D layer and 3D navigation. Loaded after app.js.
   3D is a LAYER of the main map, not a separate page: the Layers button (top right of the map) switches "3D buildings" on or off, and the map you were looking at
   tilts into 3D in the same place. Everything you already see (your route, pins, traffic, buses, people sharing with you) is carried over, and map taps still work.
   While you navigate, the 3D map follows you. Two round buttons on the right, like Google Maps: the compass (Heading up <-> North up while navigating; resets north
   while browsing) and 3D / 2D (tilt). Inside the 3D map a MapLibre canvas covers the flat Leaflet map, which keeps running underneath as the source of truth.
   Only inside the Davidson County pack (the area with building tiles) and only with WebGL; elsewhere the flat map stays. The heavy libraries load on first use. */

/* ---------- pure camera logic (tested by slicing, see test/nav3d.test.mjs) ---------- */
const N3_BBOX = [-87.06, 35.96, -86.51, 36.42];                       // the area the pack covers: west, south, east, north
const n3InPack = ll => ll && ll[1] >= N3_BBOX[0] && ll[1] <= N3_BBOX[2] && ll[0] >= N3_BBOX[1] && ll[0] <= N3_BBOX[3];
const n3Norm = a => ((a % 360) + 360) % 360;
const n3Diff = (a, b) => ((b - a + 540) % 360) - 180;                 // shortest signed turn from a to b
function n3Smooth(prev, target, alpha) { return prev == null ? n3Norm(target) : n3Norm(prev + n3Diff(prev, target) * alpha); }
function n3Zoom(speedMs, view) {                                       // closer when slow, wider when fast so you can see the road ahead
  const base = view === 'top' ? 17.2 : 17.4; if (speedMs == null || !isFinite(speedMs)) return base;
  return speedMs > 25 ? base - 1.4 : speedMs > 15 ? base - 1.0 : speedMs > 8 ? base - 0.5 : speedMs < 1.5 ? base + 0.2 : base;
}
// where on the screen you sit: tilted and heading up puts you low so most of the screen shows the road ahead
const N3_Y = { 'tilt-heading': 0.70, 'tilt-north': 0.62, 'top-heading': 0.62, 'top-north': 0.5 };
function n3Camera({ view, orient, heading, speed, height }) {
  const bottom = 90, y = N3_Y[view + '-' + orient] ?? 0.5, h = height || 700;
  return { pitch: view === 'tilt' ? 62 : 0, bearing: orient === 'heading' ? n3Norm(heading || 0) : 0, zoom: n3Zoom(speed, view), padding: { top: Math.max(0, Math.round(2 * y * h - h + bottom)), bottom, left: 0, right: 0 } };
}
const N3_WORDS = {
  'tilt-heading': 'Tilted and heading up: a 3D view looking ahead along your road, like driving.',
  'tilt-north': 'Tilted and north up: a 3D view with north always at the top of the screen.',
  'top-heading': 'Top-down and heading up: the map turns so the way you are going is always up.',
  'top-north': 'Top-down and north up: a flat map that never turns, north always at the top.'
};
// The camera button draws what it does. Flat modes show a map tile (it turns with the real map); 3D modes show a ground plane with two buildings.
// Heading up: a blue arrow always points straight up (the map turns under you). North up: the arrow turns to your real heading and a red N badge sits at the top.
// The N badge always sits where north really is, so a turned map is visible in the icon too. arrow:false (browsing) draws no arrow.
function n3Icon({ view, orient, bearing = 0, heading = 0, arrow = true }) {
  const b = n3Norm(bearing), th = -b * Math.PI / 180, R = 19, bx = (24 + R * Math.sin(th)).toFixed(1), by = (26 - R * Math.cos(th)).toFixed(1);
  const badge = `<g class="nbadge"><circle cx="${bx}" cy="${by}" r="6" fill="#fff" stroke="#c3ccd6" stroke-width="1"/><text x="${bx}" y="${(+by + 2.6).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="800" fill="#d93025">N</text></g>`;
  const arrowSvg = (ax, ay, scale, deg) => `<path d="M0 -9 L7 8 L0 4 L-7 8 Z" fill="#0b6bcb" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" transform="translate(${ax} ${ay}) rotate(${deg}) scale(${scale})"/>`;
  let body;
  if (view === 'top') {
    const rot = orient === 'heading' ? -b : 0;
    body = `<g transform="rotate(${rot.toFixed(1)} 24 26)"><rect x="9" y="11" width="30" height="30" rx="5" fill="#e6ebf1" stroke="#8896a5" stroke-width="1.6"/><path d="M9 23 H39 M9 33 H39 M20 11 V41 M30 11 V41" stroke="#fff" stroke-width="2.4"/><path d="M12 37 L24 25 L37 29" stroke="#f3c13a" stroke-width="2.6" fill="none" stroke-linecap="round"/></g>`
      + (arrow ? arrowSvg(24, 26, 1.1, orient === 'heading' ? 0 : n3Norm(heading).toFixed(0)) : '');
  } else {
    body = `<polygon points="4,43 44,43 37,19 11,19" fill="#e6ebf1" stroke="#8896a5" stroke-width="1.6" stroke-linejoin="round"/><path d="M24 43 L24 19 M8 35 H40 M11 27 H37" stroke="#fff" stroke-width="2.4"/>`
      + `<g stroke="#6f7d8f" stroke-width="1"><polygon points="13,35 22,35 22,25 13,25" fill="#b9c3d1"/><polygon points="13,25 22,25 25,22 16,22" fill="#dfe5ec"/><polygon points="22,35 25,32 25,22 22,25" fill="#9aa7b8"/>`
      + `<polygon points="29,36 37,36 37,22 29,22" fill="#b9c3d1"/><polygon points="29,22 37,22 39,20 31,20" fill="#dfe5ec"/><polygon points="37,36 39,34 39,20 37,22" fill="#9aa7b8"/></g>`
      + (arrow ? arrowSvg(24, orient === 'heading' ? 36 : 33, 0.9, orient === 'heading' ? 0 : n3Norm(heading).toFixed(0)) : '');
  }
  return `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true" class="n3icon n3-${view}-${orient}">${body}${badge}</svg>`;
}
/* ---------- end pure logic ---------- */

const nav3d = (() => {
  const prefs = { view: 'tilt', orient: 'heading', on: true, layer: false, b3d: false, terrain: false, vec: true, data: {} };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('wf-nav3d') || '{}')); } catch {}
  if (prefs.view !== 'top') prefs.view = 'tilt'; if (prefs.orient !== 'north') prefs.orient = 'heading'; if (prefs.layer && !prefs.b3d) prefs.b3d = true; prefs.layer = false; prefs.b3d = !!prefs.b3d; prefs.terrain = !!prefs.terrain; prefs.vec = prefs.vec !== false; if (!prefs.data || typeof prefs.data !== 'object') prefs.data = {};
  const savePrefs = () => { try { localStorage.setItem('wf-nav3d', JSON.stringify(prefs)); } catch {} };
  let GL = null;   // ask the browser once. Every probe makes a WebGL context, and browsers only allow a handful, so probing repeatedly makes them kill the real map's context.
  const webgl = () => { if (GL !== null) return GL; if (typeof WebGLRenderingContext === 'undefined') return GL = false; try { const c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl'); GL = !!g; if (g) { const x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } } catch { GL = false; } return GL; };
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const S = { active: false, shown: false, map: null, ready: false, loading: null, follow: true, pt: null, heading: null, route: null, idx: 0, marker: null, dest: null, els: null, toastT: null, layer: false, syncing: false };
  const PACK = () => new URL('data/davidson.pmtiles', location.href).href, ASSETS = () => new URL('vendor/map-assets/', location.href).href;
  const BROWSE_PITCH = 55;
  const anyLayer = () => prefs.vec || prefs.b3d || prefs.terrain || Object.values(prefs.data).some(Boolean);   // the 3D map is also the canvas for terrain and the data layers
  S.layer = anyLayer();
  const E = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const $id = id => document.getElementById(id);
  const say = (m, c) => { if (typeof status === 'function') status(m, c); };
  const flatCenter = () => { const c = map.getCenter(); return [c.lat, c.lng]; };       // `map` is the flat Leaflet map from app.js

  const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.append(s); });
  function loadLibs() {
    if (S.loading) return S.loading;
    S.loading = (async () => {
      if (!document.querySelector('link[data-n3]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('vendor/maplibre/maplibre-gl.css', location.href).href; l.dataset.n3 = '1'; document.head.append(l); }
      if (typeof maplibregl === 'undefined') await loadScript(new URL('vendor/maplibre/maplibre-gl.js', location.href).href);
      if (typeof pmtiles === 'undefined') await loadScript(new URL('vendor/pmtiles/pmtiles.js', location.href).href);
      if (typeof basemaps === 'undefined') await loadScript(new URL('vendor/protomaps-basemaps/basemaps.js', location.href).href);
    })().catch(e => { S.loading = null; throw e; });
    return S.loading;
  }

  /* ---------- one round button: tap to cycle the camera ---------- */
  // Navigating cycles: 3D heading up -> 2D heading up -> 2D north up -> 3D north up -> (again). Browsing cycles 3D <-> 2D, and a tap first points a turned map north.
  // The needle in the button always shows where north is, so a needle that has swung away from the top means the map is turned to your heading.
  const MODES = [['tilt', 'heading'], ['top', 'heading'], ['top', 'north'], ['tilt', 'north']];
  const SHORT = { 'tilt-heading': '3D, heading up', 'top-heading': '2D, heading up', 'top-north': '2D, north up', 'tilt-north': '3D, north up' };
  const NEEDLE_SVG_UNUSED = '<svg viewBox="0 0 48 48" width="26" height="26" aria-hidden="true"><g class="needle"><path d="M24 4 L33 26 L24 22 L15 26 Z" fill="#d93025"/><path d="M24 44 L15 26 L24 30 L33 26 Z" fill="#8896a5"/></g></svg>';
  function buildControls() {
    if (S.els) return S.els; const box = $id('map3d'), stack = E('div', 'n3-stack'), b = E('button', 'n3-btn n3-mode'); b.type = 'button';
    b.innerHTML = '<span class="n3-ico"></span><span class="n3-lab"></span>'; stack.append(b);
    const toast = E('div', 'n3-toast'); toast.hidden = true; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); box.append(stack, toast);
    b.onclick = cycle; S.els = { stack, b, toast, ico: b.querySelector('.n3-ico'), lab: b.querySelector('.n3-lab') }; paintControls(); return S.els;
  }
  function paintControls() {
    if (!S.els) return; const t = prefs.view === 'tilt', bearing = S.map ? S.map.getBearing() : 0, key = prefs.view + '-' + prefs.orient, turned = Math.abs(n3Diff(0, bearing)) > 3;
    const view = S.active ? prefs.view : (prefs.b3d ? 'tilt' : 'top'), orient = S.active ? prefs.orient : 'heading';      // browsing: a turned map, no arrow
    S.els.ico.innerHTML = n3Icon({ view, orient, bearing, heading: S.heading || 0, arrow: S.active });
    S.els.lab.textContent = S.active ? (t ? '3D' : '2D') + (prefs.orient === 'north' ? ' N' : ' \u2191') : 'North'; S.els.lab.hidden = false; S.els.b.classList.toggle('on', S.active && t);
    S.els.stack.hidden = !S.active;        // browsing: the button only appears once the map is turned; the 3D buildings layer decides tilt
    const now = S.active ? SHORT[key] : turned ? 'turned' : 'north up';
    const label = S.active ? 'Camera: ' + now + '. Tap to change the view.' : 'Map is ' + now + '. Tap to point north to the top.'; S.els.b.title = label; S.els.b.setAttribute('aria-label', label);
  }
  function paintCompass() { paintControls(); }
  function toast(msg) { if (!S.els) return; const t = S.els.toast; t.textContent = msg; t.hidden = false; clearTimeout(S.toastT); S.toastT = setTimeout(() => { t.hidden = true; }, 2600); }
  function cycle() {
    if (S.active) {
      let i = MODES.findIndex(m => m[0] === prefs.view && m[1] === prefs.orient); i = (i + 1) % MODES.length; [prefs.view, prefs.orient] = MODES[i]; S.follow = true; hideRecenter();
      savePrefs(); paintControls(); { const w = N3_WORDS[prefs.view + '-' + prefs.orient].replace(/^[^:]*: /, ''); toast(SHORT[prefs.view + '-' + prefs.orient] + '. ' + w.charAt(0).toUpperCase() + w.slice(1)); } camera(true); return;
    }
    if (!S.ready) return; S.map.easeTo({ bearing: 0, duration: reduced() ? 0 : 400 }); toast('North up.');
  }
  function hideRecenter() { const r = $id('nb-rec'); if (r) r.style.display = 'none'; if (typeof nav !== 'undefined') nav.follow = true; }

  /* ---------- the map ---------- */
  function addLayers() {
    const m = S.map, firstSym = () => (m.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
    if (m.getLayer('buildings')) m.setLayoutProperty('buildings', 'visibility', 'none');
    m.addLayer({ id: 'bld3d', type: 'fill-extrusion', source: 'protomaps', 'source-layer': 'buildings', minzoom: 13, filter: ['in', 'kind', 'building', 'building_part'],
      paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'height']], 8], 0, '#ebe8e2', 40, '#d9dde4', 120, '#c1c9d6', 250, '#a9b4c6'],
        'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'height']], ['*', ['coalesce', ['to-number', ['get', 'levels']], 2], 3.2]], 'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'min_height']], 0], 'fill-extrusion-opacity': 0.93 } }, firstSym());
    const empty = { type: 'FeatureCollection', features: [] };
    for (const id of ['n3-route', 'n3-done', 'mr-fill', 'mr-line']) m.addSource(id, { type: 'geojson', data: empty });
    m.addLayer({ id: 'mr-fill', type: 'fill', source: 'mr-fill', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] } });
    m.addLayer({ id: 'mr-line', type: 'line', source: 'mr-line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'weight'], 'line-opacity': ['get', 'opacity'] } });
    m.addLayer({ id: 'n3-done', type: 'line', source: 'n3-done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9aa8b8', 'line-width': 6, 'line-opacity': .7 } });
    m.addLayer({ id: 'n3-casing', type: 'line', source: 'n3-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 12 } });
    m.addLayer({ id: 'n3-line', type: 'line', source: 'n3-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0b6bcb', 'line-width': 8 } });
    if (typeof dataLayers !== 'undefined') dataLayers.attach(m, prefs.data, d => { prefs.data = { ...d }; savePrefs(); });
    if (prefs.terrain && typeof dataLayers !== 'undefined') try { dataLayers.setTerrain(true); } catch {}
  }
  // extruded buildings show while navigating, and when the 3D buildings layer is on; otherwise the flat building shapes
  function applyBuildings() { if (!S.ready) return; const ext = S.active || prefs.b3d, m = S.map; if (m.getLayer('bld3d')) m.setLayoutProperty('bld3d', 'visibility', ext ? 'visible' : 'none'); if (m.getLayer('buildings')) m.setLayoutProperty('buildings', 'visibility', ext ? 'none' : 'visible'); }
  const browsePitch = () => prefs.b3d ? BROWSE_PITCH : 0;
  function userEl() {
    if (typeof avatarOn === 'function' && avatarOn()) { const d = E('div', 'n3-me av'); d.append(avatarEl(40)); return d; }
    const d = E('div', 'n3-me'); d.innerHTML = '<svg viewBox="0 0 34 34" width="40" height="40"><circle cx="17" cy="17" r="15" fill="#fff" opacity=".95"/><path d="M17 5 L26 27 L17 22 L8 27 Z" fill="#0b6bcb" stroke="#fff" stroke-width="1.5"/></svg>'; return d;
  }
  function setInteractive(browse) {                      // browsing: you steer it (pan, zoom, rotate, tilt); navigating: the camera follows you
    const m = S.map; if (!m) return;
    for (const h of [m.dragPan, m.scrollZoom, m.doubleClickZoom, m.touchZoomRotate]) { try { h.enable(); } catch {} }
    try { if (browse) { m.dragRotate.enable(); m.touchZoomRotate.enableRotation(); m.touchPitch.enable(); } else { m.dragRotate.disable(); m.touchZoomRotate.disableRotation(); m.touchPitch.disable(); } } catch {}
  }
  async function makeMap() {
    await loadLibs(); if (S.map) return;
    const box = $id('map3d'), proto = new pmtiles.Protocol(); try { maplibregl.addProtocol('pmtiles', proto.tile); } catch {}
    const c = flatCenter();
    S.map = new maplibregl.Map({ container: box, center: [c[1], c[0]], zoom: Math.max(1, map.getZoom() - 1), pitch: 0, bearing: 0, maxPitch: 70, attributionControl: false, pitchWithRotate: false, fadeDuration: 0,
      style: { version: 8, glyphs: ASSETS() + 'fonts/{fontstack}/{range}.pbf', sprite: ASSETS() + 'sprites/light', sources: { protomaps: { type: 'vector', url: 'pmtiles://' + PACK(), attribution: '&copy; OpenStreetMap contributors, Protomaps' } },
        layers: basemaps.layers('protomaps', basemaps.namedFlavor('light'), { lang: 'en' }) } });
    S.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    S.zoomCtl = new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }); S.map.addControl(S.zoomCtl, 'top-left');     // zoom +/-, and a compass you tap for north or press and drag to spin the map
    S.map.getCanvas().addEventListener('webglcontextlost', e => { e.preventDefault(); });                      // let MapLibre restore it
    S.map.getCanvas().addEventListener('webglcontextrestored', () => { try { S.map.triggerRepaint(); } catch {} });
    S.map.on('rotate', paintControls);
    S.map.on('dragstart', () => { if (S.active && S.shown) { S.follow = false; const r = $id('nb-rec'); if (r) r.style.display = 'inline-block'; if (typeof nav !== 'undefined') nav.follow = false; } });
    S.map.on('moveend', () => { if (S.syncing || S.active || !S.layer || !S.ready) return; pushToFlat(); });          // you moved the 3D map: keep the flat map (and everything that asks it where we are) in step
    S.map.on('click', e => { if (S.active || !S.layer) return; handleClick(e); });
    // wait for the first full draw; a slow phone or a cold cache can take a while, and one missing font file is not a reason to give up
    await new Promise((res, rej) => { S.map.once('load', res); setTimeout(() => { if (!S.ready) say('Still loading the 3D map…'); }, 15000); setTimeout(() => rej(new Error('the 3D map took too long')), 90000); });
    addLayers(); S.ready = true; S.map.resize(); window.addEventListener('resize', () => S.map && S.map.resize());
    try { new ResizeObserver(() => { if (S.map && box.clientWidth) S.map.resize(); }).observe(box); } catch {}      // the canvas must follow its box even if the box was hidden or zero-sized when the map was made
  }
  function geoLine(coords) { return { type: 'FeatureCollection', features: coords.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : [] }; }
  function drawRoute() {
    if (!S.ready || !S.route || !S.active) return; const ll = S.route.map(p => [p[1], p[0]]), i = Math.min(S.idx, ll.length - 1);
    S.map.getSource('n3-route').setData(geoLine(ll.slice(i))); S.map.getSource('n3-done').setData(geoLine(ll.slice(0, i + 1)));
    if (S.dest) S.dest.remove(); const d = E('div', 'n3-dest'); S.dest = new maplibregl.Marker({ element: d, anchor: 'bottom' }).setLngLat(ll[ll.length - 1]).addTo(S.map);
  }
  function camera(smooth) {
    if (!S.ready || !S.shown || !S.active || !S.pt || !S.follow) return; const m = S.map, h = ($id('map3d').clientHeight) || 700;
    const cam = n3Camera({ view: prefs.view, orient: prefs.orient, heading: S.heading, speed: S.speed, height: h }), opts = { center: [S.pt[1], S.pt[0]], ...cam };
    if (reduced() || !smooth && !S.cameraSet) { m.jumpTo(opts); S.cameraSet = true; } else m.easeTo({ ...opts, duration: smooth === true ? 700 : 900, easing: t => t });
  }

  /* ---------- the flat map and the 3D map stay in step ---------- */
  const toFlatZoom = z => z + 1;
  function pushToFlat() { const c = S.map.getCenter(); S.syncing = true; try { map.setView([c.lat, c.lng], Math.round(toFlatZoom(S.map.getZoom()) * 100) / 100, { animate: false }); } finally { S.syncing = false; } }
  function pullFromFlat(opts) {
    if (!S.ready) return; const c = flatCenter(); S.syncing = true;
    try { S.map.jumpTo({ center: [c[1], c[0]], zoom: Math.max(0, map.getZoom() - 1), ...(opts || {}) }); } finally { S.syncing = false; }
  }
  map.on('moveend', () => { if (S.syncing || S.active || !S.layer) return; if (!S.shown) { if (n3InPack(flatCenter())) { S.warnedPack = false; refresh(); } return; } if (!n3InPack(flatCenter())) { showMap(false); return; } if (S.ready) pullFromFlat(); });       // something else moved the flat map (a search, Locate, a route fit)
  function handleClick(e) {
    const ll = L.latLng(e.lngLat.lat, e.lngLat.lng), f = S.map.queryRenderedFeatures(e.point, { layers: ['mr-line'] })[0];
    if (f) { const l = MR.layers.get(f.properties.id); if (l && l.hasEventListeners && l.hasEventListeners('click')) { l.fire('click', { latlng: ll }); return; } }
    map.fire('click', { latlng: ll, layerPoint: map.latLngToLayerPoint(ll), containerPoint: map.latLngToContainerPoint(ll) });
  }

  /* ---------- carrying everything on the flat map over to the 3D map ---------- */
  const MR = { markers: new Map(), layers: new Map(), sig: '', timer: null };
  const markerEl = icon => { const o = icon.options || {}, el = E('div'), sz = o.iconSize || [20, 20]; el.style.width = sz[0] + 'px'; el.style.height = sz[1] + 'px'; const h = o.html;
    if (h instanceof HTMLElement) el.append(h.cloneNode(true)); else if (typeof h === 'string') el.innerHTML = h; return el; };
  function circlePoly(c) { const ll = c.getLatLng(), r = c.getRadius(), pts = [], kx = 111320 * Math.cos(ll.lat * Math.PI / 180), ky = 110540; for (let i = 0; i <= 48; i++) { const a = i / 48 * 2 * Math.PI; pts.push([ll.lng + Math.cos(a) * r / kx, ll.lat + Math.sin(a) * r / ky]); } return pts; }
  function mirrorTick() {
    if (!S.ready || !S.shown || S.active || !S.layer) return;
    const lines = [], fills = [], seen = new Set(); MR.layers.clear(); let sig = '';
    map.eachLayer(l => {
      if (l instanceof L.Marker) {
        const icon = l.options.icon; if (!icon || !icon.options || !icon.options.html) return; const id = L.stamp(l); seen.add(id); const p = l.getLatLng(); let rec = MR.markers.get(id);
        if (!rec || rec.icon !== icon) { if (rec) rec.mk.remove(); const o = icon.options, sz = o.iconSize || [20, 20], an = o.iconAnchor || [sz[0] / 2, sz[1] / 2];
          const mk = new maplibregl.Marker({ element: markerEl(icon), offset: [sz[0] / 2 - an[0], sz[1] / 2 - an[1]], draggable: !!l.options.draggable, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(S.map);
          mk.on('dragend', () => { const q = mk.getLngLat(); l.setLatLng([q.lat, q.lng]); l.fire('dragend'); }); if (l.options.title) mk.getElement().title = l.options.title;
          if (l.hasEventListeners && l.hasEventListeners('click')) mk.getElement().addEventListener('click', e => { e.stopPropagation(); l.fire('click', { latlng: l.getLatLng() }); });      // pins you can tap (search results)
          rec = { mk, icon }; MR.markers.set(id, rec); }
        else { const c = rec.mk.getLngLat(); if (Math.abs(c.lat - p.lat) > 1e-9 || Math.abs(c.lng - p.lng) > 1e-9) rec.mk.setLngLat([p.lng, p.lat]); }
        if (rec.mk.getElement()) rec.mk.getElement().style.zIndex = String(l.options.zIndexOffset || 0);
      } else if (l instanceof L.Circle) { const id = L.stamp(l), o = l.options; fills.push({ type: 'Feature', properties: { id, color: o.fillColor || o.color || '#0b6bcb', opacity: o.fillOpacity == null ? .2 : o.fillOpacity }, geometry: { type: 'Polygon', coordinates: [circlePoly(l)] } }); sig += 'c' + id + l.getRadius() + l.getLatLng().lat; }
      else if (l instanceof L.Polyline && !(l instanceof L.Polygon)) {
        const raw = l.getLatLngs(), parts = (raw.length && Array.isArray(raw[0])) ? raw : [raw], id = L.stamp(l), o = l.options; MR.layers.set(id, l);
        const coords = parts.map(a => a.map(q => [q.lng, q.lat])).filter(a => a.length > 1); if (!coords.length) return;
        lines.push({ type: 'Feature', properties: { id, color: o.color || '#3388ff', weight: o.weight || 3, opacity: o.opacity == null ? 1 : o.opacity }, geometry: coords.length === 1 ? { type: 'LineString', coordinates: coords[0] } : { type: 'MultiLineString', coordinates: coords } });
        const f = coords[0][0], e = coords[0][coords[0].length - 1]; sig += 'l' + id + ':' + coords.length + ':' + coords[0].length + (o.color || '') + (o.weight || '') + (o.opacity == null ? '' : o.opacity) + f[0] + e[1];
      }
    });
    for (const [id, rec] of MR.markers) if (!seen.has(id)) { rec.mk.remove(); MR.markers.delete(id); }
    if (sig !== MR.sig) { MR.sig = sig; S.map.getSource('mr-line').setData({ type: 'FeatureCollection', features: lines }); S.map.getSource('mr-fill').setData({ type: 'FeatureCollection', features: fills }); }
  }
  function mirrorStart() { if (MR.timer) return; MR.timer = setInterval(mirrorTick, 350); mirrorTick(); }
  function mirrorStop() {
    clearInterval(MR.timer); MR.timer = null; for (const r of MR.markers.values()) r.mk.remove(); MR.markers.clear(); MR.sig = '';
    if (S.ready) { const empty = { type: 'FeatureCollection', features: [] }; S.map.getSource('mr-line').setData(empty); S.map.getSource('mr-fill').setData(empty); }
  }

  /* ---------- showing and hiding the 3D map ---------- */
  function showMap(on) {
    const box = $id('map3d'); S.shown = on; box.hidden = !on; box.classList.toggle('loading', on && !S.ready); document.body.classList.toggle('nav3d', on && S.ready); document.body.classList.toggle('layer3d', on && S.ready && !S.active);
    if (on && S.map) setTimeout(() => S.map.resize(), 30); if (!on) mirrorStop();
  }
  const wanted = () => S.layer || (S.active && prefs.on);
  async function refresh() {
    if (!wanted()) { showMap(false); return paintLayerUi(); }
    if (!webgl()) { if (S.layer && !S.warnedGl) { S.warnedGl = true; say('These layers need WebGL, which this browser does not have.', 'warn'); } showMap(false); return paintLayerUi(); }
    if (S.active ? (S.pt && !n3InPack(S.pt)) : !n3InPack(flatCenter())) {
      if (!S.active && !S.warnedPack) { S.warnedPack = true; say('These layers cover Davidson County. Pan there to see them.', 'warn'); } showMap(false); return paintLayerUi();
    }
    try {
      buildControls(); showMap(true); const t0 = performance.now(); if (!S.ready) say('Loading the 3D map…'); await makeMap(); S.loadMs = Math.round(performance.now() - t0); say('');
      if (!wanted()) { showMap(false); return paintLayerUi(); }
      showMap(true); applyBuildings(); paintControls(); setInteractive(!S.active);
      if (S.active) {
        mirrorStop(); S.cameraSet = false; drawRoute(); if (!S.marker) S.marker = new maplibregl.Marker({ element: userEl(), rotationAlignment: 'viewport', pitchAlignment: 'viewport' });
        if (S.pt) { S.marker.setLngLat([S.pt[1], S.pt[0]]).addTo(S.map); camera(false); } toast(N3_WORDS[prefs.view + '-' + prefs.orient]);
      } else {
        if (S.marker) { S.marker.remove(); S.marker = null; } if (S.dest) { S.dest.remove(); S.dest = null; }
        for (const id of ['n3-route', 'n3-done']) S.map.getSource(id).setData({ type: 'FeatureCollection', features: [] });
        pullFromFlat({ pitch: browsePitch(), bearing: 0 }); mirrorStart();
      }
      paintLayerUi();
    } catch (e) { S.err = String(e && e.message || e); showMap(false); say('The 3D map could not start (' + e.message + '), so the flat map is shown.', 'warn'); paintLayerUi(); }
  }
  function setOn(v) { prefs.on = v; savePrefs(); refresh(); }
  function setOpt(id, on) {          // id: 'b3d' | 'terrain' | a data layer id
    if (id === 'vec') prefs.vec = !!on; else if (id === 'b3d') prefs.b3d = !!on; else if (id === 'terrain') prefs.terrain = !!on; else prefs.data = { ...prefs.data, [id]: !!on };
    savePrefs(); const was = S.layer; S.layer = anyLayer();
    if (S.ready && typeof dataLayers !== 'undefined') {
      if (id === 'terrain') { try { dataLayers.setTerrain(!!on); } catch {} }
      else if (id !== 'b3d') { const L = dataLayers.LAYERS.find(x => x.id === id); if (L) dataLayers.toggle(L, !!on); }
      if (id === 'b3d' && !S.active) { applyBuildings(); S.map.easeTo({ pitch: browsePitch(), duration: reduced() ? 0 : 600 }); }
    }
    if (S.layer !== was || !S.ready) refresh(); else paintLayerUi();
  }
  const setLayer = v => setOpt('b3d', v);

  /* ---------- the Layers button ---------- */
  const ROWS = {
    map: [['vec', 'Rotating map', 'Turn it with two fingers, like Google Maps. Inside Davidson County'], ['b3d', '3D buildings', 'Tilts the map and raises the buildings'], ['terrain', 'Terrain', 'Hills and slopes. Needs a connection']],
    road: [['traffic', 'Bus-based traffic', 'How fast buses ran between stops'], ['bus', 'Buses and stops', 'Live arrivals near you']]
  };
  const isGl = id => id === 'vec' || id === 'b3d' || id === 'terrain' || (typeof dataLayers !== 'undefined' && dataLayers.LAYERS.some(l => l.id === id));
  function paintLayerUi() {
    const on = { vec: prefs.vec, b3d: prefs.b3d, terrain: prefs.terrain, traffic: !!($id('t-show') && $id('t-show').checked), bus: typeof bus !== 'undefined' && !!bus.on, offline: typeof off !== 'undefined' && !!off.use, ...prefs.data };
    document.querySelectorAll('#layerspop input[data-lid]').forEach(i => { i.checked = !!on[i.dataset.lid]; i.disabled = isGl(i.dataset.lid) && !webgl(); });
    const note = $id('lp-note'); if (note && !note.dataset.busy) note.textContent = !webgl() ? 'The 3D map and data layers need WebGL, which this browser does not offer.' : 'Data layers and 3D cover Davidson County.';
    const btn = $id('layersbtn'); if (btn) btn.classList.toggle('on', S.layer && S.shown);
  }
  (function wireLayers() {
    const btn = $id('layersbtn'), pop = $id('layerspop'); if (!btn || !pop) return;
    const row = (id, label, sub, withCount) => { const l = E('label', 'switch'), i = E('input'); i.type = 'checkbox'; i.dataset.lid = id; const sl = E('span', 'sl'), t = E('span', 'lt'); t.append(document.createTextNode(label)); if (sub) t.append(E('small', '', sub));
      l.append(i, sl, t); if (withCount) { const c = E('span', 'cnt'); c.id = 'c-' + id; l.append(c); } i.onchange = () => onToggle(id, i.checked); return l; };
    const fill = (sel, list, count) => { const box = $id(sel); if (!box) return; for (const [id, label, sub] of list) box.append(row(id, label, sub, count)); };
    fill('lp-map', ROWS.map); fill('lp-road', ROWS.road);
    if (typeof dataLayers !== 'undefined') fill('lp-data', dataLayers.LAYERS.map(L => [L.id, L.label, L.sub]), true); else { const s = $id('lp-data-sec'); if (s) s.hidden = true; }
    function onToggle(id, v) {
      if (id === 'traffic') { const s = $id('t-show'); if (s) { s.checked = v; s.dispatchEvent(new Event('change')); } }
      else if (id === 'bus') { if (typeof toggleBus === 'function') toggleBus(v); }
      else if (id === 'offline') { const s = $id('o-use'); if (s) { s.checked = v; s.dispatchEvent(new Event('change')); } }
      else setOpt(id, v);
      paintLayerUi();
    }
    const open = on => { pop.hidden = !on; btn.setAttribute('aria-expanded', on ? 'true' : 'false'); document.body.classList.toggle('lp-open', on); if (on) { paintLayerUi(); pop.scrollTop = 0; } };
    btn.onclick = e => { e.stopPropagation(); open(pop.hidden); }; document.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) open(false); });
    $id('t-show') && $id('t-show').addEventListener('change', paintLayerUi);
    paintLayerUi();
  })();

  const sw = $id('n3-on'); if (sw) { sw.checked = prefs.on; sw.onchange = () => setOn(sw.checked); }
  if (S.layer) setTimeout(() => { if (typeof map !== 'undefined') refresh(); }, 600);
  const sheetClass = document.body; /* (layers pop is positioned by CSS) */

  return {
    prefs, _pure: { n3Norm, n3Diff, n3Smooth, n3Zoom, n3Camera, n3InPack, N3_WORDS },
    start(route) { S.active = true; S.follow = true; S.pt = null; S.heading = null; S.speed = null; S.idx = 0; S.route = route; S.cameraSet = false; if (S.shown) { mirrorStop(); paintControls(); } refresh(); },
    setRoute(geom) { S.route = geom; S.idx = 0; drawRoute(); },
    update(pt, heading, extra) {
      if (!S.active) return; extra = extra || {}; const first = !S.pt; S.pt = pt; S.speed = extra.speed;
      if (heading != null && (first || S.speed == null || S.speed > 1)) S.heading = n3Smooth(S.heading, heading, 0.6); else if (S.heading == null && heading != null) S.heading = n3Norm(heading);
      if (extra.idx != null) S.idx = extra.idx;
      if (S.shown && !n3InPack(pt)) { showMap(false); say('You left the area the 3D map covers, so the flat map is shown.', 'warn'); return; }
      if (!S.shown && wanted() && n3InPack(pt) && webgl()) { refresh(); return; }
      if (!S.ready || !S.shown) return;
      S.marker && S.marker.setLngLat([pt[1], pt[0]]); if (S.marker && S.marker.getElement()) { const el = S.marker.getElement(); if (!el.classList.contains('av')) el.firstChild && (el.firstChild.style.transform = prefs.orient === 'north' ? `rotate(${S.heading || 0}deg)` : 'none'); }
      if (extra.idx != null && !(S.drawn === extra.idx)) { S.drawn = extra.idx; drawRoute(); }
      camera();
    },
    recenter() { S.follow = true; hideRecenter(); camera(true); },
    setLayer, setOpt, layerOn: () => S.layer,
    debug: () => ({ active: S.active, shown: S.shown, ready: S.ready, layer: S.layer, hasMap: !!S.map, err: S.err || null, loadMs: S.loadMs }), isOn: () => prefs.on, isShown: () => S.shown && S.ready, map: () => S.map, loadMs: () => S.loadMs,
    stop() {
      S.active = false; S.pt = null; if (S.marker) { S.marker.remove(); S.marker = null; } if (S.dest) { S.dest.remove(); S.dest = null; }
      if (S.layer) { refresh(); } else showMap(false);
    }
  };
})();
