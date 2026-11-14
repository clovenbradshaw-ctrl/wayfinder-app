/* Wayfinder map data layers. GENERATED from explore.js (the Explore 3D page) and adapted to run on the main map's MapLibre canvas, so these are layers of the
   map you already have: license plate and other cameras, EV chargers, parcels, zoning, flood hazard areas, and terrain. The live bus and bus-traffic layers of Explore are
   not carried over because the main map already has its own. Loaded after app.js (uses its $, el and RELAY). */
const dataLayers = (() => {
  let map = null, onPersist = null;
  const note = (m, cls) => { const e = document.getElementById('lp-note'); if (e) { e.textContent = m || ''; e.className = 'sub' + (cls ? ' ' + cls : ''); } };
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
  const firstSymbol = () => (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
function setTerrain(on) {
  if (on) {
    if (!map.getSource('dem')) map.addSource('dem', { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Terrain: Mapzen, AWS Open Data' });
    if (!map.getLayer('hills')) map.addLayer({ id: 'hills', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#7b8794' } }, map.getLayer('water') ? 'water' : undefined);
    map.setTerrain({ source: 'dem', exaggeration: 1.3 });
  } else { map.setTerrain(null); if (map.getLayer('hills')) map.removeLayer('hills'); }
}
const empty = { type: 'FeatureCollection', features: [] };
let popup = null;
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
];
const state = { on: {}, counts: {}, timers: {}, pending: {} };
const setCount = (id, text, cls) => { const e = document.getElementById('c-' + id); if (e) { e.textContent = text; e.className = 'cnt ' + (cls || ''); } };
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
  state.on[L.id] = on; if (onPersist) onPersist(state.on); clearTimeout(state.timers[L.id]); clearInterval(state.timers[L.id]); visible(L, on);
  if (!on) { setCount(L.id, ''); if (L.clear) L.clear(); return; }
  if (L.kind === 'static') loadStatic(L); else if (L.kind === 'bbox') loadBbox(L); else startPoll(L);
}
  let bboxTimer2 = null;
  return {
    LAYERS, state, setTerrain, toggle,
    attach(m, saved, persist) {      // call once the base style has loaded
      map = m; onPersist = persist; popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' }); Object.assign(state.on, saved || {});
      for (const L of LAYERS) { L.add(); if (L.ids) visible(L, !!state.on[L.id]); if (state.on[L.id]) toggle(L, true); }
      map.on('moveend', () => { clearTimeout(bboxTimer2); bboxTimer2 = setTimeout(() => LAYERS.filter(L => L.kind === 'bbox' && state.on[L.id]).forEach(loadBbox), 500); });
    }
  };
})();
