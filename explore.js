// Explore 3D: MapLibre over the Davidson County Protomaps pack (the same file the offline map saves), extruded OSM buildings,
// optional terrain, and free public layers served through our own API (parcels, zoning, flood, cameras, buses, bus traffic).
const $ = id => document.getElementById(id);
const RELAY = location.hostname === 'collab.hyphae.social' ? new URL('../wayfinder-relay/', location.href).href : 'https://collab.hyphae.social/wayfinder-relay/';
const PACK = new URL('data/davidson.pmtiles', location.href).href, ASSETS = new URL('vendor/map-assets/', location.href).href;
const DOWNTOWN = [-86.7816, 36.1627];

/* ---------- pure helpers (tested by slicing, see test/explore.test.mjs) ---------- */
const COMPASS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
function parseDirection(v) {
  if (v == null) return null; const s = String(v).trim().toUpperCase().split(';')[0];
  if (s in COMPASS) return COMPASS[s]; const n = parseFloat(s); return isFinite(n) ? ((n % 360) + 360) % 360 : null;
}
function coneRing(lon, lat, dir, len = 45, fov = 60) {                 // a wedge showing where a camera looks, in degrees of lon/lat
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540, pts = [[lon, lat]];
  for (let i = 0; i <= 6; i++) { const a = (dir - fov / 2 + fov * i / 6) * Math.PI / 180; pts.push([lon + Math.sin(a) * len / kx, lat + Math.cos(a) * len / ky]); }
  pts.push([lon, lat]); return pts;
}
function bboxAround(lng, lat, zoom, w, h) {                            // ground near the centre only, so a tilted view never asks for the horizon
  const deg = 360 / (512 * Math.pow(2, zoom)), hx = 0.6 * Math.max(w, h) * deg, hy = hx * Math.cos(lat * Math.PI / 180);
  return [lng - hx, lat - hy, lng + hx, lat + hy];
}
const money = n => n == null || n === '' ? '' : '$' + Math.round(+n).toLocaleString('en-US');
const dateOf = ms => { if (ms == null || !isFinite(ms)) return ''; const d = new Date(+ms); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
const ZONE_COLORS = [['RM', '#f4a259'], ['R', '#f6d365'], ['MU', '#b388eb'], ['OR', '#7aa7e8'], ['O', '#7aa7e8'], ['CS', '#ef7b7b'], ['CN', '#ef7b7b'], ['CL', '#ef7b7b'], ['CA', '#ef7b7b'], ['CF', '#ef7b7b'], ['SCR', '#ef7b7b'], ['I', '#9aa4b2'], ['SP', '#4db6ac'], ['AG', '#8bc34a'], ['AR', '#8bc34a'], ['DTC', '#e6a0a0'], ['ORI', '#7aa7e8']];
function zoneColor(code) { const c = String(code || '').toUpperCase(); let best = null; for (const [p, col] of ZONE_COLORS) if (c.startsWith(p) && (!best || p.length > best[0].length)) best = [p, col]; return best ? best[1] : '#cfd6df'; }
/* ---------- end pure helpers ---------- */

const store = { get(k, d) { try { const v = localStorage.getItem('wf3d-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('wf3d-' + k, JSON.stringify(v)); } catch {} } };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const note = (msg, cls) => { $('note').textContent = msg || ''; $('note').className = cls || ''; };

const protocol = new pmtiles.Protocol(); maplibregl.addProtocol('pmtiles', protocol.tile);
const baseLayers = basemaps.layers('protomaps', basemaps.namedFlavor('light'), { lang: 'en' });
const map = new maplibregl.Map({
  container: 'map', center: store.get('center', DOWNTOWN), zoom: store.get('zoom', 15.6), pitch: store.get('pitch', 60), bearing: store.get('bearing', -25), maxPitch: 80, hash: false, attributionControl: false,
  style: { version: 8, glyphs: ASSETS + 'fonts/{fontstack}/{range}.pbf', sprite: ASSETS + 'sprites/light',
    sources: { protomaps: { type: 'vector', url: 'pmtiles://' + PACK, attribution: '&copy; OpenStreetMap contributors, Protomaps' } }, layers: baseLayers }
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

/* ---------- buildings and terrain ---------- */
const firstSymbol = () => (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
function setBuildings(on) {
  if (map.getLayer('bld3d')) map.removeLayer('bld3d');
  if (map.getLayer('buildings')) map.setLayoutProperty('buildings', 'visibility', on ? 'none' : 'visible');
  if (!on) return;
  map.addLayer({ id: 'bld3d', type: 'fill-extrusion', source: 'protomaps', 'source-layer': 'buildings', minzoom: 13, filter: ['in', 'kind', 'building', 'building_part'],
    paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'height']], 8], 0, '#ebe8e2', 40, '#d9dde4', 120, '#c1c9d6', 250, '#a9b4c6'],
      'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'height']], ['*', ['coalesce', ['to-number', ['get', 'levels']], 2], 3.2]], 'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'min_height']], 0], 'fill-extrusion-opacity': 0.93 } }, firstSymbol());
}
function setTerrain(on) {
  if (on) {
    if (!map.getSource('dem')) map.addSource('dem', { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Terrain: Mapzen, AWS Open Data' });
    if (!map.getLayer('hills')) map.addLayer({ id: 'hills', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#7b8794' } }, map.getLayer('water') ? 'water' : undefined);
    map.setTerrain({ source: 'dem', exaggeration: 1.3 });
  } else { map.setTerrain(null); if (map.getLayer('hills')) map.removeLayer('hills'); }
}

/* ---------- free layers ---------- */
const empty = { type: 'FeatureCollection', features: [] };
const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' });
function showPopup(lngLat, title, rows) {
  const box = el('div'); box.append(el('b', '', title)); const dl = el('dl');
  for (const [k, v] of rows) if (v != null && v !== '') { dl.append(el('dt', '', k), el('dd', '', String(v))); } box.append(dl); popup.setLngLat(lngLat).setDOMContent(box).addTo(map);
}
const click = (layer, fn) => { map.on('click', layer, e => { if (e.features && e.features[0]) fn(e.features[0], e.lngLat); }); map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; }); };
async function api(path) { const r = await fetch(RELAY + path, { cache: 'no-store', signal: AbortSignal.timeout(30000) }); if (r.status === 202) return { pending: true }; if (!r.ok) { let m = 'HTTP ' + r.status; try { m = (await r.json()).error || m; } catch {} throw new Error(m); } return r.json(); }

const camLabel = p => [p.manufacturer, p.operator, p.brand].filter(Boolean)[0] || 'Unknown operator';
const LAYERS = [
  { id: 'alpr', label: 'License plate cameras', sub: 'Flock and other ALPR, mapped by volunteers (OpenStreetMap, DeFlock)', color: '#d93025', kind: 'static', url: 'osm/alpr.json',
    add() { map.addSource('alpr', { type: 'geojson', data: empty }); map.addSource('alpr-cone', { type: 'geojson', data: empty });
      map.addLayer({ id: 'alpr-cone', type: 'fill', source: 'alpr-cone', paint: { 'fill-color': '#d93025', 'fill-opacity': 0.22 } });
      map.addLayer({ id: 'alpr', type: 'circle', source: 'alpr', paint: { 'circle-color': '#d93025', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 8], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map' } });
      click('alpr', (f, ll) => showPopup(ll, 'License plate reader', [['Operator', camLabel(f.properties)], ['Facing', f.properties.direction || f.properties['camera:direction']], ['Mounted', f.properties['surveillance:zone']], ['Since', f.properties.start_date], ['Source', 'OpenStreetMap volunteers; may be out of date']])); },
    set(fc) { map.getSource('alpr').setData(fc); map.getSource('alpr-cone').setData({ type: 'FeatureCollection', features: fc.features.map(f => { const d = parseDirection(f.properties.direction ?? f.properties['camera:direction']); return d == null ? null : { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coneRing(f.geometry.coordinates[0], f.geometry.coordinates[1], d)] } }; }).filter(Boolean) }); },
    ids: ['alpr-cone', 'alpr'] },
  { id: 'cctv', label: 'Other surveillance cameras', sub: 'Public and private CCTV mapped in OpenStreetMap', color: '#f28c28', kind: 'static', url: 'osm/cctv.json',
    add() { map.addSource('cctv', { type: 'geojson', data: empty }); map.addLayer({ id: 'cctv', type: 'circle', source: 'cctv', minzoom: 13, paint: { 'circle-color': '#f28c28', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 17, 6], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
      click('cctv', (f, ll) => showPopup(ll, 'Camera', [['Kind', f.properties.surveillance || f.properties['surveillance:type']], ['Type', f.properties['camera:type']], ['Operator', f.properties.operator], ['Facing', f.properties.direction || f.properties['camera:direction']]])); },
    set(fc) { map.getSource('cctv').setData(fc); }, ids: ['cctv'] },
  { id: 'ev', label: 'EV chargers', sub: 'Charging stations in OpenStreetMap', color: '#2e9e44', kind: 'static', url: 'osm/ev.json',
    add() { map.addSource('ev', { type: 'geojson', data: empty }); map.addLayer({ id: 'ev', type: 'circle', source: 'ev', minzoom: 11, paint: { 'circle-color': '#2e9e44', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 17, 7], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } });
      click('ev', (f, ll) => showPopup(ll, f.properties.name || 'EV charger', [['Operator', f.properties.operator || f.properties.brand], ['Plugs', f.properties.capacity], ['Fee', f.properties.fee]])); },
    set(fc) { map.getSource('ev').setData(fc); }, ids: ['ev'] },
  { id: 'parcels', label: 'Parcels', sub: 'Owner, appraisal and zoning for each lot (Metro Nashville). Zoom in close to load.', color: '#5d6b7a', kind: 'bbox', url: 'gis/parcels.json', minZoom: 16.2,
    add() { map.addSource('parcels', { type: 'geojson', data: empty });
      map.addLayer({ id: 'parcels-fill', type: 'fill', source: 'parcels', paint: { 'fill-color': '#5d6b7a', 'fill-opacity': 0.06 } });
      map.addLayer({ id: 'parcels', type: 'line', source: 'parcels', paint: { 'line-color': '#5d6b7a', 'line-width': 1 } });
      map.addLayer({ id: 'parcels-label', type: 'symbol', source: 'parcels', minzoom: 17.4, layout: { 'text-field': ['get', 'PropAddr'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 }, paint: { 'text-color': '#3b4756', 'text-halo-color': '#fff', 'text-halo-width': 1.2 } });
      click('parcels-fill', (f, ll) => { const p = f.properties; showPopup(ll, p.PropAddr || 'Parcel', [['City', [p.PropCity, p.PropZip].filter(Boolean).join(' ')], ['Owner', p.Owner], ['Owner address', [p.OwnAddr1, p.OwnCity, p.OwnState, p.OwnZip].filter(Boolean).join(', ')], ['Last sale', [dateOf(p.OwnDate), money(p.SalePrice)].filter(Boolean).join('  ')], ['Land', money(p.LandAppr)], ['Improvements', money(p.ImprAppr)], ['Total appraisal', money(p.TotlAppr)], ['Acres', p.Acres != null ? (+p.Acres).toFixed(2) : ''], ['Use', p.LUDesc], ['Zoning', p.Zoning], ['Council district', p.Council], ['Parcel ID', p.ParID]]); }); },
    set(fc) { map.getSource('parcels').setData(fc); }, ids: ['parcels-fill', 'parcels', 'parcels-label'] },
  { id: 'zoning', label: 'Zoning districts', sub: 'Metro Nashville zoning map, colour by type', color: '#f6d365', kind: 'bbox', url: 'gis/zoning.json', minZoom: 12.5,
    add() { map.addSource('zoning', { type: 'geojson', data: empty });
      map.addLayer({ id: 'zoning', type: 'fill', source: 'zoning', paint: { 'fill-color': ['get', '_c'], 'fill-opacity': 0.34, 'fill-outline-color': '#8793a3' } }, firstSymbol());
      map.addLayer({ id: 'zoning-label', type: 'symbol', source: 'zoning', minzoom: 14.5, layout: { 'text-field': ['get', 'ZONE_DESC'], 'text-font': ['Noto Sans Medium'], 'text-size': 11 }, paint: { 'text-color': '#2b3440', 'text-halo-color': '#fff', 'text-halo-width': 1.2 } });
      click('zoning', (f, ll) => showPopup(ll, 'Zoning ' + (f.properties.ZONE_DESC || ''), [['Name', f.properties.NAME], ['Case', f.properties.CASE_NO], ['Ordinance', f.properties.ORDINANCE]])); },
    set(fc) { for (const f of fc.features) f.properties._c = zoneColor(f.properties.ZONE_DESC); map.getSource('zoning').setData(fc); }, ids: ['zoning', 'zoning-label'] },
  { id: 'flood', label: 'Flood hazard areas', sub: 'FEMA special flood hazard areas, as published by Metro', color: '#2b7de9', kind: 'bbox', url: 'gis/flood.json', minZoom: 12,
    add() { map.addSource('flood', { type: 'geojson', data: empty }); map.addLayer({ id: 'flood', type: 'fill', source: 'flood', filter: ['==', ['get', 'SFHA_TF'], 'T'], paint: { 'fill-color': '#2b7de9', 'fill-opacity': 0.38, 'fill-outline-color': '#1b5cc0' } }, firstSymbol());
      click('flood', (f, ll) => showPopup(ll, 'Flood zone ' + (f.properties.FloodZone || ''), [['Type', f.properties.ZoneSubtype], ['Detail', f.properties.ZoneDescription]])); },
    set(fc) { map.getSource('flood').setData(fc); }, ids: ['flood'] },
  { id: 'buses', label: 'Live WeGo buses', sub: 'Positions from the live feed, refreshed every 15 seconds', color: '#753cbe', kind: 'poll', every: 15000,
    add() { this.markers = []; }, async poll() {
      const v = await api('vehicles.json'); this.markers.forEach(m => m.remove()); this.markers = [];
      for (const b of v.vehicles || []) { const d = el('div', 'bus', b.route); d.style.background = /^[0-9a-f]{6}$/i.test(b.color) ? '#' + b.color : '#753cbe'; d.title = 'Route ' + b.route + (b.headsign ? ' to ' + b.headsign : '');
        this.markers.push(new maplibregl.Marker({ element: d }).setLngLat([b.lon, b.lat]).addTo(map)); }
      return (v.vehicles || []).length; }, clear() { (this.markers || []).forEach(m => m.remove()); this.markers = []; } },
  { id: 'waze', label: 'Waze alerts (TDOT)', sub: 'Jams, hazards and accidents reported through TDOT\'s public Waze feed; recorded here as they start and end', color: '#e8590c', kind: 'poll', every: 60000,
    add() { map.addSource('waze', { type: 'geojson', data: empty });
      map.addLayer({ id: 'waze', type: 'circle', source: 'waze', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 16, 8], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2,
        'circle-color': ['match', ['get', 'type'], 'ACCIDENT', '#7a0f0f', 'JAM', ['match', ['get', 'subtype'], 'JAM_STAND_STILL_TRAFFIC', '#d93025', '#f28c28'], 'HAZARD', '#e6b800', '#5d6b7a'] } });
      click('waze', (f, ll) => { const p = f.properties; showPopup(ll, (p.type || '').toLowerCase() + ' ' + String(p.subtype || '').replace(/^[A-Z]+_/, '').replace(/_/g, ' ').toLowerCase(), [['Street', p.street], ['Reported', p.firstSeen ? new Date(+p.firstSeen).toLocaleTimeString() : ''], ['Open for', p.ageMin != null ? p.ageMin + ' min (seen by this server)' : ''], ['Reliability', p.reliability]]); }); },
    async poll() { const v = await api('events/waze.json?bbox=-87.4,35.8,-86.2,36.6&hours=1'); map.getSource('waze').setData({ type: 'FeatureCollection', features: (v.active || []).map(a => ({ type: 'Feature', properties: a, geometry: { type: 'Point', coordinates: [a.lon, a.lat] } })) }); return (v.active || []).length; },
    clear() { map.getSource('waze') && map.getSource('waze').setData(empty); }, ids: ['waze'] },
  { id: 'traffic', label: 'Bus-based traffic', sub: 'How fast buses ran between stops (green free flow, red slow)', color: '#e6b800', kind: 'poll', every: 60000,
    add() { map.addSource('traffic', { type: 'geojson', data: empty }); map.addLayer({ id: 'traffic', type: 'line', source: 'traffic', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['interpolate', ['linear'], ['get', 'ratio'], 0.3, '#d93025', 0.6, '#f28c28', 0.85, '#e6b800', 1, '#2e9e44'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 17, 7], 'line-opacity': 0.9 } }, firstSymbol()); },
    async poll() { const r = await fetch(RELAY + 'traffic/now.json', { cache: 'no-store', signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json();
      const ok = (j.links || []).filter(l => l.ratio != null && l.basis !== 'network' && l.basis !== 'profile'); map.getSource('traffic').setData({ type: 'FeatureCollection', features: ok.map(l => ({ type: 'Feature', properties: { ratio: l.ratio }, geometry: { type: 'LineString', coordinates: [[l.a[1], l.a[0]], [l.b[1], l.b[0]]] } })) }); return ok.length; },
    clear() { map.getSource('traffic') && map.getSource('traffic').setData(empty); }, ids: ['traffic'] },
];
const state = { on: store.get('layers', { alpr: true, zoning: false }), counts: {}, timers: {}, pending: {} };
const setCount = (id, text, cls) => { const e = $('c-' + id); if (e) { e.textContent = text; e.className = 'cnt ' + (cls || ''); } };
const visible = (L, on) => (L.ids || []).forEach(i => map.getLayer(i) && map.setLayoutProperty(i, 'visibility', on ? 'visible' : 'none'));

async function loadStatic(L, tries = 0) {
  try { setCount(L.id, 'loading…'); const fc = await api(L.url);
    if (fc.pending) { if (tries < 12) { setCount(L.id, 'downloading…'); state.timers[L.id] = setTimeout(() => loadStatic(L, tries + 1), 15000); } else setCount(L.id, 'try later', 'err'); return; }
    L.set(fc); setCount(L.id, fc.features.length.toLocaleString() + ' mapped', 'ok'); }
  catch (e) { setCount(L.id, 'unavailable', 'err'); note(L.label + ': ' + e.message, 'err'); }
}
let bboxTimer = null, bboxSeq = {};
async function loadBbox(L) {
  if (!state.on[L.id]) return; const z = map.getZoom();
  if (z < L.minZoom) { setCount(L.id, 'zoom in to load'); return; }
  const c = map.getCenter(), box = map.getContainer(), bb = bboxAround(c.lng, c.lat, z, box.clientWidth, box.clientHeight), seq = bboxSeq[L.id] = (bboxSeq[L.id] || 0) + 1;
  try { setCount(L.id, 'loading…'); const fc = await api(L.url + '?bbox=' + bb.map(x => x.toFixed(5)).join(',')); if (seq !== bboxSeq[L.id]) return; L.set(fc); setCount(L.id, fc.features.length.toLocaleString() + ' here', 'ok'); }
  catch (e) { if (seq === bboxSeq[L.id]) setCount(L.id, /zoom in/.test(e.message) ? 'zoom in to load' : 'unavailable', /zoom in/.test(e.message) ? '' : 'err'); }
}
function startPoll(L) { clearInterval(state.timers[L.id]); const run = async () => { try { setCount(L.id, 'loading…'); const n = await L.poll(); setCount(L.id, n.toLocaleString() + ' now', 'ok'); } catch (e) { setCount(L.id, 'unavailable', 'err'); } }; run(); state.timers[L.id] = setInterval(run, L.every); }
function toggle(L, on) {
  state.on[L.id] = on; store.set('layers', state.on); clearTimeout(state.timers[L.id]); clearInterval(state.timers[L.id]); visible(L, on);
  if (!on) { setCount(L.id, ''); if (L.clear) L.clear(); return; }
  if (L.kind === 'static') loadStatic(L); else if (L.kind === 'bbox') loadBbox(L); else startPoll(L);
}
function buildPanel() {
  const box = $('layers');
  for (const L of LAYERS) { const row = el('label', 'row'), cb = el('input'); cb.type = 'checkbox'; cb.id = 'l-' + L.id; cb.checked = !!state.on[L.id]; const sw = el('span', 'sw'); sw.style.background = L.color;
    const t = el('span', 'lt', L.label); t.append(el('small', '', L.sub)); row.append(cb, sw, t, Object.assign(el('span', 'cnt'), { id: 'c-' + L.id })); cb.onchange = () => toggle(L, cb.checked); box.append(row); }
}
$('t-bld').checked = store.get('bld', true); $('t-terrain').checked = store.get('terrain', false);
$('t-bld').onchange = () => { store.set('bld', $('t-bld').checked); setBuildings($('t-bld').checked); };
$('t-terrain').onchange = () => { store.set('terrain', $('t-terrain').checked); setTerrain($('t-terrain').checked); };
$('pclose').onclick = () => document.body.classList.add('closed'); $('pbtn').onclick = () => document.body.classList.remove('closed');
if (innerWidth <= 760 && !store.get('seen', false)) store.set('seen', true);
buildPanel();

map.on('load', () => {
  setBuildings($('t-bld').checked); if ($('t-terrain').checked) setTerrain(true);
  for (const L of LAYERS) { L.add(); if (L.ids) visible(L, !!state.on[L.id]); if (state.on[L.id]) toggle(L, true); }
  note('');
});
map.on('moveend', () => {
  const c = map.getCenter(); store.set('center', [c.lng, c.lat]); store.set('zoom', map.getZoom()); store.set('pitch', map.getPitch()); store.set('bearing', map.getBearing());
  clearTimeout(bboxTimer); bboxTimer = setTimeout(() => LAYERS.filter(L => L.kind === 'bbox').forEach(loadBbox), 500);
});
map.on('error', e => { const m = e && e.error && e.error.message || ''; if (/pmtiles|Range|404|Failed to fetch/i.test(m)) note('Base map problem: ' + m.slice(0, 120), 'err'); });
