const $ = id => document.getElementById(id);
const TN = { bbox: [-90.31, 34.98, -81.65, 36.68], center: [36.1627, -86.7816] }; // minLon,minLat,maxLon,maxLat
const inTN = ll => ll[1] >= TN.bbox[0] - .3 && ll[1] <= TN.bbox[2] + .3 && ll[0] >= TN.bbox[1] - .3 && ll[0] <= TN.bbox[3] + .3;
// Wayfinder's own API (bus relay + traffic collector on hyphae). Same origin when served from hyphae; any other host (GitHub Pages, localhost) uses the public address, which sends CORS headers.
const RELAY = location.hostname === 'collab.hyphae.social' ? new URL('../wayfinder-relay/', location.href).href : 'https://collab.hyphae.social/wayfinder-relay/';
const pinIcon = c => L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
  html: `<div style="width:22px;height:22px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>` });

const map = L.map('map').setView(TN.center, 11);
const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);

let start = null, dest = null, mode = 'routed-car';
let startMk = null, destMk = null, accCircle = null;
let routes = [], routeLines = [], selected = 0, errs = [];
try { mode = localStorage.getItem('wf-mode') || mode; } catch {}
// Ending something needs a second tap: the first turns the button yellow and bold with "Are you sure?" for 3 seconds, the second does it.
function armTap(btn, run, label) {
  let t = null, keep = null;
  const back = () => { clearTimeout(t); t = null; btn.classList.remove('armed'); if (keep != null) { btn.innerHTML = keep; keep = null; } };
  btn.onclick = e => { if (t) { back(); return run(e); } keep = btn.innerHTML; btn.classList.add('armed'); btn.textContent = label || 'Are you sure?'; t = setTimeout(back, 3000); };
  return back;
}
const status = (msg, cls) => { const s = $('status'); s.textContent = msg || ''; s.className = cls || ''; };

/* ---------- phone layout: bottom sheet (peek / half / full) and the start line ---------- */
const isMob = () => !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
const sheetEl = $('sheet'); let sheetState = 'peek';
function setSheet(s) {
  sheetState = s; document.body.classList.remove('sheet-peek', 'sheet-half', 'sheet-full'); document.body.classList.add('sheet-' + s);
  setTimeout(() => map.invalidateSize(), 280);
}
// pixels of the map the sheet covers at the bottom, so fitBounds can keep routes in view
const sheetCover = () => !isMob() ? 0 : sheetState === 'peek' ? 158 : sheetState === 'half' ? Math.round(innerHeight * .88 * .48) : Math.round(innerHeight * .88);
const fitOpts = () => isMob() ? { paddingTopLeft: [30, 70], paddingBottomRight: [30, sheetCover() + 20] } : { padding: [50, 50] };
(function dragSheet() {
  // The sheet follows your finger from the handle OR from anywhere on it (except lists that scroll); a quick flick steps it up or down one height.
  const grab = $('grab'), PEEK = 158; let y0 = 0, x0 = 0, base = 0, h = 0, drag = false, decided = false, lastY = 0, lastT = 0, vel = 0, onGrab = false, skip = false;
  const tops = () => [0, h * .52, h - PEEK], clamp = v => Math.max(0, Math.min(h - PEEK, v)), order = ['full', 'half', 'peek'];
  let slop = 10;
  function begin(y, x, fromGrab, target) {
    h = sheetEl.offsetHeight; base = tops()[order.indexOf(sheetState)]; y0 = lastY = y; x0 = x; lastT = Date.now(); vel = 0; drag = false; decided = false; onGrab = fromGrab;
    skip = !!(target && target.closest && target.closest('.sugg, input[type=file]'));
    // A finger always wobbles a little, so a tap must not be mistaken for a drag (that cancels the tap and the button "does nothing"):
    // wait for a clear vertical move, and more of one when the touch started on something you can press.
    slop = fromGrab ? 8 : (target && target.closest && target.closest('button, a, label, summary, input, select, li, [role=button]')) ? 18 : 12;
  }
  function move(y, x, ev) {
    if (skip) return; const dy = y - y0, dx = x - x0;
    if (!decided) { if (Math.abs(dy) < slop && Math.abs(dx) < slop) return; if (!onGrab && Math.abs(dy) < Math.abs(dx) * 1.3) { decided = true; drag = false; return; } decided = true;
      drag = onGrab || (Math.abs(dy) > Math.abs(dx) && (sheetState !== 'full' || (dy > 0 && sheetEl.scrollTop <= 0)));   // when full, let the content scroll unless you pull down from its top
      if (drag) sheetEl.classList.add('dragging'); }
    if (!drag) return; if (ev.cancelable) ev.preventDefault();
    const now = Date.now(); if (now > lastT) vel = 0.7 * vel + 0.3 * ((y - lastY) / (now - lastT)); lastY = y; lastT = now;
    sheetEl.style.transform = `translateY(${clamp(base + dy)}px)`;
  }
  function finish(y) {
    sheetEl.classList.remove('dragging'); const was = drag, cur = clamp(base + (y - y0)); sheetEl.style.transform = ''; drag = false;
    if (!was) { if (onGrab && !decided) setSheet(sheetState === 'peek' ? 'half' : sheetState === 'half' ? 'full' : 'half'); return; }
    let i = order.indexOf(sheetState);
    if (Math.abs(vel) > 0.4) i = Math.max(0, Math.min(2, i + (vel < 0 ? -1 : 1)));            // flick: one step
    else { const t = tops(); i = t.reduce((b, v, k) => Math.abs(v - cur) < Math.abs(t[b] - cur) ? k : b, 0); }   // slow drag: nearest height
    setSheet(order[i]);
  }
  sheetEl.addEventListener('touchstart', e => { if (!isMob() || e.touches.length !== 1) return; const t = e.touches[0]; begin(t.clientY, t.clientX, !!e.target.closest('#grab'), e.target); }, { passive: true });
  sheetEl.addEventListener('touchmove', e => { if (!isMob() || e.touches.length !== 1) return; const t = e.touches[0]; move(t.clientY, t.clientX, e); }, { passive: false });
  const tEnd = e => { if (!isMob()) return; const t = e.changedTouches[0]; finish(t ? t.clientY : lastY); };
  sheetEl.addEventListener('touchend', tEnd); sheetEl.addEventListener('touchcancel', tEnd);
  // mouse and pen (desktop emulation): handle only
  let mdown = false;
  grab.addEventListener('pointerdown', e => { if (!isMob() || e.pointerType === 'touch') return; mdown = true; begin(e.clientY, e.clientX, true, e.target); try { grab.setPointerCapture(e.pointerId); } catch {} });
  grab.addEventListener('pointermove', e => { if (mdown) move(e.clientY, e.clientX, e); });
  const mEnd = e => { if (mdown) { mdown = false; finish(e.clientY); } };
  grab.addEventListener('pointerup', mEnd); grab.addEventListener('pointercancel', mEnd);
})();
setSheet('peek');
let locating = false;
const fromInput = $('from');
function paintStart() { const v = fromInput.value.trim(); $('starttxt').textContent = v || (locating ? 'finding you…' : 'not set'); $('usegps').hidden = !!v || locating; }
(function () { // paint the start line whenever any code assigns the start field's value
  const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(fromInput, 'value', { get() { return d.get.call(this); }, set(v) { d.set.call(this, v); paintStart(); } });
  fromInput.addEventListener('input', paintStart);
})();
$('startline').onclick = () => { document.body.classList.add('show-start'); setSheet('full'); fromInput.focus(); };
$('from').addEventListener('focus', () => { if (isMob()) setSheet('full'); });
$('to').addEventListener('focus', () => { if (isMob()) setSheet('full'); });

/* ---------- helpers ---------- */
const hav = (a, b) => { const R = 3958.8, r = x => x * Math.PI / 180, dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
function bias() { return (start && inTN(start)) ? start : TN.center; }
const biasName = () => (start && inTN(start)) ? 'you' : 'downtown Nashville';
const fmtMi = d => d < 0.1 ? 'here' : d < 10 ? d.toFixed(1) + ' mi' : Math.round(d) + ' mi';
const withDist = items => items.map(i => ({ ...i, right: fmtMi(hav(bias(), i.ll)) }));

/* ---------- local knowledge: Tennessee landmarks + recents ---------- */
const LANDMARKS = [
  ['Metro Courthouse, 1 Public Square', 'Nashville, TN', 36.1627, -86.7770, 'nashville public square city hall'],
  ['Tennessee State Capitol', 'Nashville, TN', 36.1658, -86.7844, 'capitol hill state'],
  ['Nashville International Airport (BNA)', 'Nashville, TN', 36.1263, -86.6774, 'bna airport flights'],
  ['Country Music Hall of Fame', 'Nashville, TN', 36.1580, -86.7765, 'museum'],
  ['Ryman Auditorium', 'Nashville, TN', 36.1613, -86.7785, 'broadway music'],
  ['Music City Center', 'Nashville, TN', 36.1575, -86.7757, 'convention'],
  ['Nashville Union Station', 'Nashville, TN', 36.1573, -86.7826, 'train hotel broadway'],
  ['Nissan Stadium', 'Nashville, TN', 36.1665, -86.7713, 'titans football'],
  ['Centennial Park', 'Nashville, TN', 36.1496, -86.8133, 'parthenon'],
  ['Vanderbilt University', 'Nashville, TN', 36.1447, -86.8027, 'vandy'],
  ['Belmont University', 'Nashville, TN', 36.1340, -86.7955, ''],
  ['Grand Ole Opry House', 'Nashville, TN', 36.2068, -86.6921, 'opry'],
  ['The Hermitage', 'Nashville, TN', 36.2186, -86.6143, 'andrew jackson'],
  ['Nashville Zoo', 'Nashville, TN', 36.1141, -86.7396, 'grassmere'],
  ['Franklin Public Square', 'Franklin, TN', 35.9251, -86.8689, 'downtown franklin'],
  ['Murfreesboro Public Square', 'Murfreesboro, TN', 35.8456, -86.3903, 'mtsu'],
  ['Clarksville Downtown', 'Clarksville, TN', 36.5298, -87.3595, ''],
  ['Market Square', 'Knoxville, TN', 35.9648, -83.9189, 'knoxville downtown'],
  ['Tennessee Aquarium', 'Chattanooga, TN', 35.0558, -85.3111, 'chattanooga'],
  ['Beale Street', 'Memphis, TN', 35.1390, -90.0530, 'memphis downtown'],
  ['Graceland', 'Memphis, TN', 35.0477, -90.0261, 'elvis'],
  ['Gatlinburg', 'Gatlinburg, TN', 35.7143, -83.5102, 'smoky mountains'],
  ['Sugarlands Visitor Center, Great Smoky Mountains NP', 'Gatlinburg, TN', 35.6866, -83.5370, 'national park']
].map(([title, sub, la, lo, alias]) => ({ title, sub, ll: [la, lo], alias, kind: 'place' }));

let recents = []; try { recents = JSON.parse(localStorage.getItem('wf-recent') || '[]'); } catch {}
function saveRecent(it) {
  if (!it || !it.ll || !it.title) return;
  recents = [{ title: it.title, sub: it.sub || '', ll: it.ll, kind: 'recent' }, ...recents.filter(r => !(r.title === it.title && r.sub === (it.sub || '')))].slice(0, 6);
  try { localStorage.setItem('wf-recent', JSON.stringify(recents)); } catch {}
}
let saved = []; try { saved = JSON.parse(localStorage.getItem('wf-saved') || '[]'); } catch {}
function savePlace(it) {
  if (!it || !it.ll || !it.title) return false;
  saved = [{ title: it.title, sub: it.sub || '', ll: it.ll, kind: 'saved' }, ...saved.filter(r => r.title !== it.title)].slice(0, 12);
  try { localStorage.setItem('wf-saved', JSON.stringify(saved)); } catch {} return true;
}
function localMatches(q) {
  const toks = q.toLowerCase().replace(/\btn\b|tennessee/g, '').split(/[\s,]+/).filter(Boolean);
  if (!toks.length) return [];
  return [...saved, ...recents, ...LANDMARKS].filter(i => { const t = (i.title + ' ' + i.sub + ' ' + (i.alias || '')).toLowerCase(); return toks.every(k => t.includes(k)); });
}
function defaultItems(forStart) {
  const here = bias();
  const near = [...LANDMARKS].sort((a, b) => hav(here, a.ll) - hav(here, b.ll)).slice(0, 7);
  const out = [...saved, ...recents.filter(r => !saved.some(s => s.title === r.title)), ...near.filter(n => !recents.some(r => r.title === n.title) && !saved.some(s => s.title === n.title))];
  return forStart ? [{ title: 'My location', sub: 'Use GPS or Wi-Fi', special: 'locate', right: '' }, ...withDist(out)] : withDist(out);
}

/* ---------- offline places (from the downloaded Davidson County pack) ---------- */
let placesIdx = null, placesLow = [];      // items [name, kind, lat, lon, addr] and their lowercase search text
function setPlaces(d) { placesIdx = d && d.items ? d.items : null; placesLow = placesIdx ? placesIdx.map(p => (p[0] + ' ' + p[4]).toLowerCase()) : []; }
function placeMatches(q) {
  if (!placesIdx) return [];
  const toks = q.toLowerCase().replace(/\btn\b|tennessee|nashville/g, '').split(/[\s,]+/).filter(Boolean); if (!toks.length || q.length < 3) return [];
  const here = bias(), hits = [];
  for (let i = 0; i < placesIdx.length && hits.length < 400; i++) if (toks.every(k => placesLow[i].includes(k))) hits.push(placesIdx[i]);
  const qq = toks.join(' '), rank = n => { const t = n.toLowerCase(); return t === qq ? 0 : t.startsWith(qq) ? 1 : toks.every(k => new RegExp('\\b' + k.replace(/[^a-z0-9]/g, '')).test(t)) ? 2 : 3; };   // exact name, name starts with it, whole words, then any substring
  return hits.map(p => ({ title: p[0], sub: [p[4], 'Nashville, TN'].filter(Boolean).join(', '), ll: [p[2], p[3]], kind: 'remote', alias: p[1] }))
    .sort((a, b) => rank(a.title) - rank(b.title) || hav(here, a.ll) - hav(here, b.ll)).slice(0, 5);
}

/* ---------- geocoding, Tennessee first ---------- */
const abbr = s => (s || '').replace(/^Tennessee$/, 'TN');
function labelOf(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const place = p.city || p.town || p.village || p.locality || p.county;
  const title = p.name && p.name !== street ? p.name : (street || place || p.state || '');
  const parts = [p.name && street ? street : '', p.district, place, abbr(p.state), p.country && p.country !== 'United States' ? p.country : ''].filter(Boolean);
  return { title, sub: [...new Set(parts)].filter(x => x !== title).join(', ') };
}
async function photon(q, { bbox, limit = 6 } = {}) {
  const b = bias();
  const u = `https://photon.komoot.io/api/?limit=${limit}&lat=${b[0]}&lon=${b[1]}&q=${encodeURIComponent(q)}` + (bbox ? `&bbox=${bbox.join(',')}` : '');
  const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status);
  return ((await r.json()).features || []).map(f => { const l = labelOf(f.properties);
    return { ll: [f.geometry.coordinates[1], f.geometry.coordinates[0]], title: l.title, sub: l.sub, kind: 'remote' }; }).filter(i => i.title);
}
async function nominatim(q, bounded) {
  const u = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=us&q=${encodeURIComponent(q)}` +
    (bounded ? `&viewbox=${TN.bbox[0]},${TN.bbox[3]},${TN.bbox[2]},${TN.bbox[1]}&bounded=1` : '');
  const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).map(x => { const p = x.display_name.split(', ');
    return { ll: [+x.lat, +x.lon], title: p[0], sub: p.slice(1, 4).join(', ').replace('Tennessee', 'TN'), kind: 'remote' }; });
}
function tidy(q) {
  return q.replace(/\bpublic sq\b/i, 'public square').replace(/\b(\d+)\s+(st|nd|rd|th)\b/i, '$1$2').trim();
}
async function remoteSearch(q, quick) {
  q = tidy(q); const noState = !/\b(tn|tennessee)\b/i.test(q);
  const steps = [
    ['Photon', () => photon(q.replace(/\b(tn|tennessee)\b/ig, '').trim() || q, { bbox: TN.bbox })],
    ['Photon', () => photon(noState ? q + ' Tennessee' : q)],
    ['Nominatim', () => nominatim(noState ? q + ' Tennessee' : q, true)],
    ['Nominatim', () => nominatim(noState ? q + ' Tennessee' : q, false)]
  ];
  for (const [name, fn] of steps) {
    try { const res = await fn(); const tn = res.filter(i => inTN(i.ll)); if (tn.length) return tn; if (res.length && !quick) return res; }
    catch (e) { errs.push(name + ': ' + e.message); }
  }
  return [];
}
async function smartSearch(q, quick) {
  errs = [];
  const local = localMatches(q);
  if (quick && local.length >= 4) return withDist(local.slice(0, 6));
  const rem = await remoteSearch(q, quick);
  const fall = rem.length < 3 ? placeMatches(q) : [];      // offline pack: named places and streets in Davidson County
  const seen = []; const out = [];
  for (const it of [...local.slice(0, 3), ...rem, ...fall]) {
    if (seen.some(s => s.title === it.title && hav(s.ll, it.ll) < 0.05)) continue;
    seen.push(it); out.push(it);
  }
  return withDist(out.slice(0, 7));
}
async function reverseName(ll) {
  try {
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${ll[0]}&lon=${ll[1]}`); const f = (await r.json()).features[0];
    if (f) { const l = labelOf(f.properties); return [l.title, l.sub].filter(Boolean).join(', '); }
  } catch {}
  return '';
}

/* ---------- nearby categories: results on the map and in a list, like a real maps app ---------- */
const CATS = {
  Coffee: { tags: ['amenity=cafe'], noun: 'coffee', word: /^(coffee|cafe|cafes|coffee shops?)$/, name: 'Cafe', color: '#8d5a2b', kinds: ['cafe', 'coffee_shop'] },
  Food: { tags: ['amenity=restaurant', 'amenity=fast_food'], noun: 'food', word: /^(food|restaurants?|eat|lunch|dinner)$/, name: 'Restaurant', color: '#d9622b', kinds: ['restaurant', 'fast_food', 'food_court'] },
  Gas: { tags: ['amenity=fuel'], noun: 'gas stations', word: /^(gas|gas stations?|fuel)$/, name: 'Gas station', color: '#2b7de9', kinds: ['fuel'] },
  Pharmacy: { tags: ['amenity=pharmacy'], noun: 'pharmacies', word: /^(pharmacy|pharmacies|drugstore)$/, name: 'Pharmacy', color: '#2e9e44', kinds: ['pharmacy'] },
  Hospital: { tags: ['amenity=hospital', 'amenity=clinic'], noun: 'hospitals', word: /^(hospitals?|clinics?|er|urgent care)$/, name: 'Hospital', color: '#d93025', kinds: ['hospital', 'clinic'] },
  Parking: { tags: ['amenity=parking'], noun: 'parking', word: /^(parking|park)$/, name: 'Parking', color: '#5d6b7a', kinds: ['parking'] }
};
const catFromText = q => Object.keys(CATS).find(k => CATS[k].word.test(String(q || '').trim().toLowerCase()));
const shortHours = h => h ? String(h).replace(/\s*;\s*/g, '; ').replace(/\bMo\b/g, 'Mon').replace(/\bTu\b/g, 'Tue').replace(/\bWe\b/g, 'Wed').replace(/\bTh\b/g, 'Thu').replace(/\bFr\b/g, 'Fri').replace(/\bSa\b/g, 'Sat').replace(/\bSu\b/g, 'Sun').slice(0, 80) : '';
/* ---------- opening hours: open or closed right now (pure, tested in test/places-ui.test.mjs) ---------- */
function openStatus(rows, nowMs, tz) {          // rows: [{d:[0..6] (0 = Sunday), o:'HH:MM', c:'HH:MM'}]; tz: 'America/Chicago'. -> { open, text }
  if (!rows || !rows.length) return null;
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Chicago', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(nowMs)), g = t => (f.find(x => x.type === t) || {}).value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')), min = (+g('hour') % 24) * 60 + (+g('minute')), mm = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fmt = t => { let [h, m] = t.split(':').map(Number); const ap = h >= 12 && h < 24 ? 'PM' : 'AM'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; };
  const span = r => { const o = mm(r.o), c = mm(r.c); return c > o ? [o, c] : [o, c + 1440]; };            // closes after midnight: it runs into the next day
  for (const r of rows) {
    const [o, c] = span(r);
    if (r.d.includes(dow) && min >= o && min < c) return { open: true, text: (c - o >= 1439 ? 'Open 24 hours' : 'Open \u00b7 closes ' + fmt(r.c)) };
    if (r.d.includes((dow + 6) % 7) && c > 1440 && min + 1440 < c) return { open: true, text: 'Open \u00b7 closes ' + fmt(r.c) };      // yesterday's late night is still running
  }
  for (let k = 0; k < 8; k++) {                  // when does it open next?
    const day = (dow + k) % 7, nxt = rows.filter(r => r.d.includes(day) && (k > 0 || mm(r.o) > min)).sort((x, y) => mm(x.o) - mm(y.o))[0];
    if (nxt) return { open: false, text: 'Closed \u00b7 opens ' + (k === 0 ? '' : k === 1 ? 'tomorrow ' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] + ' ') + fmt(nxt.o) };
  }
  return { open: false, text: 'Closed' };
}
/* ---------- end opening hours ---------- */
function searchSpot(viewOnly) {      // what to search around: a pin you dropped or picked if it is on screen (Michael: "it didn't search in the vicinity of where I actually clicked"), else the area on screen once zoomed in, else you (or downtown Nashville)
  if (!viewOnly && dest && map.getBounds().contains(L.latLng(dest))) {
    const b = map.getBounds(), view = toM(hav([b.getNorth(), dest[1]], [b.getSouth(), dest[1]])) / 2, nm = ($('to').value || '').split(',')[0].trim(), generic = !nm || /^(dropped pin|pinned location)$/i.test(nm);
    return { ll: dest, r: Math.max(1000, Math.min(3000, view * 0.7)), label: generic ? 'near the pin' : 'near ' + nm, pin: true };
  }
  if (map.getZoom() >= 13) { const c = map.getCenter(), b = map.getBounds(), r = Math.max(800, Math.min(5000, toM(hav([b.getNorth(), c.lng], [b.getSouth(), c.lng])) / 2 * 1.1)); return { ll: [c.lat, c.lng], r, label: 'in this area' }; }
  return { ll: bias(), r: 5000, label: 'near ' + biasName() };
}
async function nearby(label, spot) {
  // Our own server answers from an index of ~70,000 Nashville-area places (Overture Maps open data): phone, website and address included, no third party sees where you are.
  const s = spot || searchSpot(), url = `${RELAY}places/search?cat=${encodeURIComponent(label)}&lat=${s.ll[0].toFixed(5)}&lon=${s.ll[1].toFixed(5)}&r=${Math.round(s.r)}&limit=25`;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json();
    return j.items.map(p => ({ id: p.id, name: p.name, addr: p.addr, ll: p.ll, phone: p.phone, web: /^https?:\/\//i.test(p.web || '') ? p.web : '', hours: '', extra: [p.brand && p.brand !== p.name ? p.brand : '', p.type].filter(Boolean).join(' \u00b7 '), street: p.street, zip: p.zip, d: p.d }));
  } finally { clearTimeout(timer); }
}
async function ensurePlaces() {      // our own list of Davidson County places: from the saved pack if you have it, otherwise fetched from our server
  if (placesIdx) return; try { const r = await fetch(new URL('data/places.json', location.href).href); if (r.ok) setPlaces(await r.json()); } catch {}
}
function nearbyOffline(label, spot) {      // from the saved Davidson County pack when the network search is unavailable
  if (!placesIdx) return [];
  const kinds = CATS[label].kinds, s = spot || searchSpot(), maxMi = s.r / 1609.344;
  return placesIdx.filter(p => kinds.includes(p[1])).map(p => ({ name: p[0], addr: p[4] || '', ll: [p[2], p[3]], hours: '', phone: '', web: '', extra: '', d: hav(s.ll, [p[2], p[3]]) })).filter(i => i.d <= maxMi).sort((x, y) => x.d - y.d).slice(0, 12);
}

/* ---------- autocomplete UI ---------- */
function attachSuggest(inputId, listId, onPick, onEdit, forStart) {
  const input = $(inputId), ul = $(listId); let timer, seq = 0, items = [], act = -1, header = '';
  const hide = () => { ul.style.display = 'none'; act = -1; };
  const pick = i => { const it = items[i]; if (!it) return; hide();
    if (it.special === 'locate') { input.value = ''; locate(); return; }
    input.value = it.sub ? `${it.title}, ${it.sub}` : it.title; onPick(it); };
  function show(list, head) {
    items = list; header = head || ''; ul.innerHTML = '';
    if (!items.length) return hide();
    if (header) { const h = document.createElement('li'); h.className = 'hd'; h.textContent = header; ul.appendChild(h); }
    items.forEach((it, i) => {
      const li = document.createElement('li'); li.dataset.i = i;
      const top = document.createElement('div'); top.className = 'top';
      const a = document.createElement('span'); const pre = it.special === 'locate' ? 'crosshair-simple' : it.kind === 'recent' ? 'clock-counter-clockwise' : it.kind === 'saved' ? 'star-fill' : '';
      if (pre) a.innerHTML = ic(pre) + ' '; a.append(document.createTextNode(it.title));
      const d = document.createElement('span'); d.className = 'r'; d.textContent = it.right || '';
      top.append(a, d);
      const b = document.createElement('div'); b.className = 's2'; b.textContent = it.sub || '';
      li.append(top, b); li.onmousedown = e => e.preventDefault(); li.onclick = () => pick(i); ul.appendChild(li);
    });
    ul.style.display = 'block'; act = -1;
  }
  input.addEventListener('focus', () => { if (!input.value.trim()) show(defaultItems(forStart), 'Suggested near ' + biasName()); });
  input.addEventListener('input', () => {
    onEdit(); clearTimeout(timer);
    const q = input.value.trim();
    if (!q) return show(defaultItems(forStart), 'Suggested near ' + biasName());
    const loc = localMatches(q); if (loc.length) show(withDist(loc.slice(0, 4)), '');
    if (q.length < 3) return;
    timer = setTimeout(async () => {
      const mine = ++seq; let res = [];
      try { res = await smartSearch(q, true); } catch {}
      if (mine !== seq) return;
      if (res.length) show(res, ''); else if (!loc.length) hide();
    }, 250);
  });
  input.addEventListener('keydown', e => {
    const lis = [...ul.querySelectorAll('li[data-i]')];
    if (ul.style.display === 'block' && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && lis.length) {
      e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % lis.length;
      lis.forEach((li, i) => li.classList.toggle('act', i === act));
    } else if (e.key === 'Enter') {
      if (ul.style.display === 'block' && act >= 0) { e.preventDefault(); pick(act); } else hide();
      if (act < 0) route();
    } else if (e.key === 'Escape') hide();
  });
  input.addEventListener('blur', () => setTimeout(hide, 300));
  return { show, hide };
}

/* ---------- points ---------- */
function setStart(ll) {
  start = ll; document.body.classList.remove('show-start'); if (startMk) startMk.remove();
  startMk = L.marker(ll, { icon: pinIcon('#0b6bcb'), draggable: true, title: 'Start (drag to adjust)' }).addTo(map);
  startMk.on('dragend', () => { const p = startMk.getLatLng(); start = [p.lat, p.lng]; $('from').value = 'Pinned location'; if (dest) route(); });
}
function setDest(ll) {
  dest = ll; if (destMk) destMk.remove();
  destMk = L.marker(ll, { icon: pinIcon('#d93025'), draggable: true, title: 'Destination (drag to adjust)' }).addTo(map);
  destMk.on('dragend', () => { const p = destMk.getLatLng(); dest = [p.lat, p.lng]; $('to').value = 'Pinned location'; route(); });
}
attachSuggest('from', 'sg-from', it => { setStart(it.ll); map.setView(it.ll, 14); if (dest) route(); },
  () => { start = null; if (startMk) { startMk.remove(); startMk = null; } }, true);
const toBox = attachSuggest('to', 'sg-to', it => { saveRecent(it); setDest(it.ll); if (start) route(); else { map.setView(it.ll, 14); if (!locating) { document.body.classList.add('show-start'); setSheet('full'); } } },
  () => { dest = null; if (destMk) { destMk.remove(); destMk = null; } }, false);

/* ---------- category results: numbered pins on the map, a list in the sheet, a place card with Directions ---------- */
const res = { on: false, cat: null, items: [], sel: -1, layer: null, spot: null, loading: false, offline: false, err: '' };
const pinNum = (n, color, sel) => L.divIcon({ className: '', iconSize: [34, 42], iconAnchor: [17, 40],
  html: `<div class="pp${sel ? ' sel' : ''}" style="background:${sel ? '#d93025' : color}"><span>${n}</span></div>` });
function clearResults() {
  res.on = false; res.items = []; res.sel = -1; res.loading = false; if (res.layer) { res.layer.remove(); res.layer = null; }
  document.body.classList.remove('has-results'); $('results').hidden = true; $('results').replaceChildren(); const ab = document.querySelector('.rs-area'); if (ab) ab.hidden = true;
}
function drawPins() {
  if (res.layer) res.layer.remove(); res.layer = L.layerGroup().addTo(map); const color = CATS[res.cat].color;
  res.items.forEach((it, i) => { const m = L.marker(it.ll, { icon: pinNum(i + 1, color, i === res.sel), title: it.name, zIndexOffset: i === res.sel ? 1000 : 0 }); m.on('click', () => selectPlace(i)); res.layer.addLayer(m); });
}
function fitResults() { res.fitUntil = Date.now() + 1500; const pts = res.items.map(i => i.ll); if (res.spot) pts.push(res.spot.ll); if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.12), fitOpts()); }
async function searchCategory(label, spot) {
  // Our own place index answers in well under a second; if our server cannot be reached, the saved Davidson County pack (when you have it) is the fallback.
  // Progress is visible the whole time: a moving bar, a spinner, what it is doing, and the seconds so far.
  const seq = res.seq = (res.seq || 0) + 1; clearResults(); res.seq = seq;
  res.on = true; res.cat = label; res.loading = true; res.upgrading = false; res.err = ''; res.offline = false; res.spot = spot || searchSpot(); res.moved = false; res.t0 = Date.now(); res.stage = 'Searching our place index\u2026';
  document.body.classList.add('has-results'); toBox.hide(); $('to').blur(); if (isMob()) setSheet('half'); renderResults(); status(''); startLoadTick();
  const spotNow = res.spot; let items = null, failed = null;
  try { items = await nearby(label, spotNow); } catch (e) { failed = e; }
  if (seq !== res.seq || !res.on) return;
  if (failed) { res.stage = 'Our server did not answer. Trying the saved offline list\u2026'; renderResults(); await ensurePlaces(); if (seq !== res.seq || !res.on) return; items = nearbyOffline(label, spotNow); res.offline = true; res.err = items.length ? '' : (navigator.onLine === false ? 'You are offline and the offline pack has none here.' : 'The place search could not be reached. Try again in a moment.'); }
  res.items = items; res.loading = false; stopLoadTick(); drawPins(); fitResults(); renderResults();
  if (!res.offline) prefetchDetails(seq, 4);
}
let loadTick = null;
function startLoadTick() { stopLoadTick(); loadTick = setInterval(() => { const t = document.querySelector('#results .rs-sec'); if (t && res.t0) t.textContent = Math.max(0, Math.round((Date.now() - res.t0) / 1000)) + ' s'; }, 1000); }
function stopLoadTick() { if (loadTick) clearInterval(loadTick); loadTick = null; }
function selectPlace(i) {
  res.sel = i; drawPins(); renderResults(); const it = res.items[i]; if (!it) return;
  map.fitBounds(L.latLng(it.ll).toBounds(280), fitOpts()); if (isMob()) setSheet('half'); $('results').scrollTop = 0; sheetEl.scrollTop = 0;
}
function chooseDest(it) {
  saveRecent({ title: it.name, sub: it.addr, ll: it.ll }); const keep = it; clearResults(); setDest(keep.ll); $('to').value = keep.addr ? `${keep.name}, ${keep.addr}` : keep.name;
  if (start) route(); else { map.setView(keep.ll, 15); if (!locating) { document.body.classList.add('show-start'); setSheet('full'); } else status('Finding you, then I will plan the route.'); }
}
/* ---------- place details: hours, open or closed now, price, cuisine, where it came from ---------- */
const pdet = new Map();      // place id -> { state: 'loading' | 'done' | 'none', v }
function placeDetails(it) {
  if (!it || !it.id) return Promise.resolve(null); const c = pdet.get(it.id); if (c && c.p) return c.p;
  const rec = { state: 'loading', v: null, t0: Date.now() };
  rec.p = (async () => { for (let k = 0; k < 2; k++) { try { const r = await fetch(`${RELAY}places/details?id=${encodeURIComponent(it.id)}`); if (r.status === 503 && k === 0) { await new Promise(z => setTimeout(z, 1500)); continue; } if (!r.ok) throw new Error('HTTP ' + r.status); rec.v = await r.json(); rec.state = 'done'; break; } catch { rec.state = 'none'; } } if (rec.v && !(rec.v.hours || rec.v.price || rec.v.cuisine || rec.v.phone || rec.v.image)) rec.state = 'none'; if (res.on) renderResults(); return rec.v; })();
  pdet.set(it.id, rec); return rec.p;
}
async function prefetchDetails(seq, n) { for (const it of res.items.slice(0, n)) { if (seq !== res.seq || !res.on) return; if (it.web) await placeDetails(it); } }
const badgeFor = it => { const d = pdet.get(it.id); return d && d.v && d.v.hours ? openStatus(d.v.hours, Date.now(), d.v.tz) : null; };
function renderResults() {
  const box = $('results'); box.hidden = !res.on; box.replaceChildren(); if (!res.on) return; const cat = CATS[res.cat], it = res.items[res.sel];
  // Like Google Maps: a search bar that says what you searched (X clears it), then quick category chips, then the list.
  const head = el('div', 'rs-h'), glass = el('span', 'rs-gl'); glass.innerHTML = ic(({ Coffee: 'coffee', Food: 'fork-knife', Gas: 'gas-pump', Pharmacy: 'pill', Hospital: 'hospital', Parking: 'letter-circle-p' })[res.cat] || 'magnifying-glass');
  const title = el('b', '', `${cat.noun.charAt(0).toUpperCase() + cat.noun.slice(1)} ${res.spot.label}`); const x = el('button', 'x'); x.type = 'button'; x.setAttribute('aria-label', 'Clear search'); x.innerHTML = ic('x'); x.onclick = clearResults;
  head.append(glass, title, x); box.append(head);
  const chips = el('div', 'rs-chips'); for (const k of Object.keys(CATS)) { const b = el('button', k === res.cat ? 'on' : '', CATS[k].name === 'Cafe' ? 'Coffee' : k); b.type = 'button'; b.onclick = () => searchCategory(k, searchSpot(true)); chips.append(b); } box.append(chips);
  const prog = () => { const w = el('div', 'rs-prog'), sp = el('span', 'spin'), tx = el('span', 'rs-pt', res.stage || 'Working…'), sec = el('span', 'rs-sec', Math.max(0, Math.round((Date.now() - (res.t0 || Date.now())) / 1000)) + ' s'); w.setAttribute('role', 'status'); w.append(sp, tx, sec); return w; };
  if (res.loading) { box.append(el('div', 'rs-bar'), prog()); return; }
  if (res.upgrading) box.append(el('div', 'rs-bar'), prog());
  if (res.offline && res.items.length && !res.upgrading) box.append(el('div', 'sub', 'The live place search did not answer, so these come from our own Davidson County list. Hours and phone numbers are not included.'));
  if (!res.items.length && !res.upgrading) { box.append(el('div', 'sub err', res.err || `No ${cat.noun} found ${res.spot.label}. Pan the map and search this area again.`)); }
  if (it) {                                   // one place, in detail
    const card = el('div', 'pcard'), back = el('button', 'rs-back'); back.type = 'button'; back.innerHTML = ic('arrow-left') + ' All results'; back.onclick = () => { res.sel = -1; drawPins(); fitResults(); renderResults(); };
    const nm = el('div', 'pc-n', it.name), ty = el('div', 'pc-t', [cat.name, it.extra, fmtMi(it.d)].filter(Boolean).join(' · '));
    card.append(back, nm, ty);
    const row = (icon, node) => { const r = el('div', 'pc-r'), i = el('span', 'pc-i'); i.innerHTML = ic(icon); r.append(i, node); card.append(r); };
    row('map-pin', el('span', '', it.addr || 'Address not listed'));
    const dd = pdet.get(it.id), dv = dd && dd.v;
    if (it.id && !dd) placeDetails(it);                                      // fetched when the card opens (cached for a week on the server)
    if (dd && dd.state === 'loading') { const w = el('div', 'rs-prog'); w.setAttribute('role', 'status'); w.append(el('span', 'spin'), el('span', 'rs-pt', 'Looking up hours and details\u2026'), el('span', 'rs-sec', '')); card.append(el('div', 'rs-bar'), w); }
    if (dv && dv.hours) { const st = openStatus(dv.hours, Date.now(), dv.tz); if (st) { const b = el('div', 'rs-open big ' + (st.open ? 'yes' : 'no'), st.text); card.append(b); } row('clock', el('span', '', dv.hoursText || '')); }
    else if (dd && dd.state !== 'loading') row('clock', el('span', 'sub', 'Hours not published online'));
    if (dv && (dv.price || dv.cuisine)) row('fork-knife', el('span', '', [dv.price, dv.cuisine].filter(Boolean).join(' · ')));
    if (dv && dv.rating) row('star', el('span', '', `${dv.rating.value} / ${dv.rating.best}` + (dv.rating.count ? ` (${dv.rating.count} reviews on their site)` : '')));
    if (it.phone) { const a = el('a', '', it.phone); a.href = 'tel:' + it.phone.replace(/[^+\d]/g, ''); row('phone', a); }
    if (it.web) { const a = el('a', '', it.web.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').slice(0, 40)); a.href = it.web; a.target = '_blank'; a.rel = 'noopener noreferrer'; row('globe', a); }
    if (dv && dv.sources && dv.sources[0]) card.append(el('div', 'rs-src', (dv.exactBranch ? 'Hours and details from ' : 'From ') + dv.sources[0].host + (dv.exactBranch ? '' : ' (may be for another location)')));
    card.append(el('div', 'rs-src', 'Place data: Overture Maps (open data)'));
    const go = el('button', 'primary'); go.type = 'button'; go.innerHTML = ic('navigation-arrow') + ' Directions'; go.onclick = () => chooseDest(it); card.append(go); box.append(card); return;
  }
  const list = el('div', 'rs-list');
  res.items.forEach((p, i) => { const b = el('button', 'place'); b.type = 'button'; const n = el('span', 'pn', String(i + 1)); n.style.background = cat.color; const t = el('span', 'pt'); const bd = badgeFor(p); t.append(el('b', '', p.name), el('span', 'sub', [fmtMi(p.d), p.extra].filter(Boolean).join(' · ')), ...(bd ? [el('span', 'rs-open ' + (bd.open ? 'yes' : 'no'), bd.text)] : []), el('small', '', p.addr)); b.append(n, t); b.onclick = () => selectPlace(i); list.append(b); });
  box.append(list);
}
document.querySelectorAll('#chips button[data-c]').forEach(b => b.onclick = () => searchCategory(b.dataset.c));
// Floating "Search this area" pill over the map (as Google Maps): appears once you pan or zoom away from where the results were searched.
let areaBtn = null;      // created after the helpers exist (see initAreaBtn)
map.on('moveend', () => {
  if (!res.on || res.loading || !res.spot || Date.now() < (res.fitUntil || 0)) return;
  const moved = toM(hav(res.spot.ll, [map.getCenter().lat, map.getCenter().lng])) > res.spot.r * 0.3 || res.sel >= 0 && false;
  if (moved) res.moved = true; if (areaBtn) areaBtn.hidden = !(res.moved && res.on && res.sel < 0);
});

/* ---------- locate: refine for a few seconds, reject fixes outside Tennessee ---------- */
function locate() {
  if (!navigator.geolocation) return status('This browser has no location support. Type a start place instead.', 'err');
  status('Finding you…'); locating = true; paintStart();
  let best = null, done = false, wid, t;
  const clear = () => { done = true; locating = false; navigator.geolocation.clearWatch(wid); clearTimeout(t); paintStart(); };
  const finish = () => { if (done) return; clear(); best ? applyFix(best) : status('Could not get your location. Type a start place instead.', 'err'); };
  wid = navigator.geolocation.watchPosition(p => {
    if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
    if (p.coords.accuracy <= 100) finish();
  }, e => {
    if (done) return;
    if (best) return finish();
    if (e.code === 3) return status('Still searching for GPS. This can take a minute, ideally outdoors.');
    clear();
    if (e.code === 1) { status('Location is blocked for this site, so I cannot find you. You can still type a start place.', 'err'); showLocHelp(true); }
    else status(e.code === 2 ? 'Your device could not work out where you are. Check that Location is turned on, ideally outdoors, then try again.' : 'Could not get your location (' + e.message + '). Type a start place instead.', 'err');
  }, { enableHighAccuracy: true, timeout: 60000, maximumAge: 0 });
  t = setTimeout(() => { if (best) finish(); else { status('Still searching for GPS. This can take a minute, ideally outdoors.'); t = setTimeout(finish, 45000); } }, 8000);
}
async function applyFix(pos) {
  showLocHelp(false); const ll = [pos.coords.latitude, pos.coords.longitude], acc = pos.coords.accuracy;
  if (accCircle) { accCircle.remove(); accCircle = null; }
  if (!inTN(ll)) {
    map.setView(TN.center, 11);
    return status(`Your browser placed you outside Tennessee (a VPN or Wi-Fi guess can do this), so I'm assuming Nashville. Pick or type your starting place, or click the map.`, 'warn');
  }
  accCircle = L.circle(ll, { radius: acc, color: '#0b6bcb', weight: 1, fillOpacity: .1 }).addTo(map);
  setStart(ll); $('from').value = 'My location'; if (avatarOn()) startMk.setIcon(avatarIcon(0));
  map.fitBounds(acc > 1500 ? accCircle.getBounds() : L.latLng(ll).toBounds(1200), fitOpts());
  if (acc > 3000) status(`Rough fix (±${(acc / 1000).toFixed(0)} km). Drag the blue dot to your real spot, or type your address.`, 'warn');
  else status(`Location found (±${Math.round(acc)} m).`);
  if (dest) route();
  const nm = await reverseName(ll); if (nm && start === ll) { $('from').title = nm; if (acc <= 3000) status(`Near ${nm} (±${Math.round(acc)} m).`); }
}

/* ---------- formatting ---------- */
const miles = m => m < 160 ? Math.round(m * 3.281) + ' ft' : (m / 1609.344).toFixed(1) + ' mi';
const dur = s => { const m = Math.round(s / 60); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : Math.max(m, 1) + ' min'; };
const ordinal = n => n + (n % 100 > 10 && n % 100 < 14 ? 'th' : ['th','st','nd','rd','th','th','th','th','th','th'][n % 10]);
const compass = b => ['north','northeast','east','southeast','south','southwest','west','northwest'][Math.round(b / 45) % 8];
function describe(s, noRoad) {
  const m = s.maneuver, mod = m.modifier || '', road = noRoad ? '' : (s.name || s.ref || ''), onto = road ? ' onto ' + road : '';
  const toward = s.destinations ? ' toward ' + s.destinations.split(',')[0] : '';
  const icons = { left:'arrow-left', right:'arrow-right', 'slight left':'arrow-up-left', 'slight right':'arrow-up-right', 'sharp left':'arrow-u-up-left', 'sharp right':'arrow-u-up-right', straight:'arrow-up', uturn:'arrow-u-down-left' };
  let icon = icons[mod] || 'arrow-up', text;
  switch (m.type) {
    case 'depart': icon = 'navigation-arrow'; text = 'Head ' + compass(m.bearing_after) + (road ? ' on ' + road : ''); break;
    case 'arrive': icon = 'flag-checkered'; text = 'Arrive at your destination' + (mod && mod !== 'straight' ? ', on the ' + mod : ''); break;
    case 'roundabout': case 'rotary': case 'roundabout turn': icon = 'arrow-clockwise'; text = `At the roundabout, take the ${ordinal(m.exit || 1)} exit${onto}`; break;
    case 'continue': text = mod === 'uturn' ? 'Make a U-turn' + (road ? ' on ' + road : '') : 'Continue ' + (mod || 'straight') + (road ? ' on ' + road : ''); break;
    case 'merge': text = 'Merge' + (mod && mod !== 'straight' ? ' ' + mod : '') + onto + toward; break;
    case 'on ramp': text = 'Take the ramp' + (mod && mod !== 'straight' ? ' on the ' + mod : '') + toward; break;
    case 'off ramp': text = 'Take the exit' + (mod && mod !== 'straight' ? ' on the ' + mod : '') + onto + toward; break;
    case 'fork': text = 'Keep ' + (mod || 'straight') + ' at the fork' + onto + toward; break;
    case 'end of road': text = 'At the end of the road, turn ' + mod + onto; break;
    case 'new name': text = 'Continue' + onto; break;
    default: text = mod === 'uturn' ? 'Make a U-turn' : (mod && mod !== 'straight' ? 'Turn ' + mod : 'Continue straight') + onto;
  }
  return { icon, text };
}

/* ---------- routing ---------- */
function clearRoute() { document.body.classList.remove('has-route'); routeLines.forEach(l => l.remove()); routeLines = []; routes = []; $('steps').innerHTML = ''; $('summary').style.display = 'none'; $('alts').style.display = 'none'; }

async function resolve(inputId, current, setter) {
  if (current) return true;
  const q = $(inputId).value.trim();
  if (!q || q === 'My location') return false;
  const res = await smartSearch(q, false);
  if (!res.length) {
    status(errs.length ? `Address search could not be reached (${[...new Set(errs)].join('; ')}). Check your connection or content blocker, or click the map to drop a pin.`
                       : `Couldn't find "${q}" in Tennessee. Try a street and city, or click the map to drop a pin.`, 'err');
    return null;
  }
  setter(res[0].ll); $('from').title = ''; $(inputId).value = res[0].sub ? `${res[0].title}, ${res[0].sub}` : res[0].title;
  if (inputId === 'to') saveRecent(res[0]);
  return true;
}
async function getRoutes(a, b, alts, heading) {      // heading (degrees, optional): the road must be taken in the way you are facing, so a reroute never asks for a U-turn you did not need
  const base = `https://routing.openstreetmap.de/${mode}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&steps=true&alternatives=${alts ? 'true' : 'false'}`;
  for (const url of heading != null ? [base + `&bearings=${Math.round(heading)},70;`, base] : [base]) {
    try { const j = await (await fetch(url)).json(); if (j.code === 'Ok' && j.routes.length) return j.routes; } catch (e) { if (url === base) throw e; }
  }
  throw new Error('No route found between those points.');
}
async function route() {
  { const q = $('to').value.trim(), cat = !dest && catFromText(q); if (cat) return searchCategory(cat); }
  clearResults(); clearRoute();
  try {
    status('Working…');
    let ok = await resolve('from', start, setStart); if (ok === null) return;
    if (!ok) { document.body.classList.add('show-start'); return status('Set a start: tap Locate or type a place.', 'err'); }
    ok = await resolve('to', dest, setDest); if (ok === null) return;
    if (!ok) return status('Enter a destination, pick a category, or click the map.', 'err');
    routes = (await getRoutes(start, dest, true)).slice(0, 3);
    if (tf.url && (!tf.data || Date.now() - tf.loaded > 60000)) await loadTraffic(true);
    routes.forEach(applyTraffic); routes.sort((a, b) => T(a) - T(b)); selected = 0; drawRoutes();
    if (isMob()) { setSheet('half'); sheetEl.scrollTop = 0; $('to').blur(); }
    map.fitBounds(L.featureGroup(routeLines).getBounds(), fitOpts());
    const far = mode === 'routed-foot' ? 30000 : mode === 'routed-bike' ? 100000 : 800000;
    if (routes[0].distance > far) status(`That's ${miles(routes[0].distance)} away. Check that the start is where you really are.`, 'warn'); else status('');
  } catch (e) { clearRoute(); status(!navigator.onLine ? 'You are offline. The map and place search still work, but directions need a connection.' : (e.message || 'Something went wrong.'), 'err'); }
}
function drawRoutes() {
  routeLines.forEach(l => l.remove()); routeLines = [];
  routes.forEach((rt, i) => { const on = i === selected;
    const line = L.geoJSON(rt.geometry, { style: { color: on ? '#0b6bcb' : '#8aa4c0', weight: on ? 6 : 5, opacity: on ? .9 : .7 } }).addTo(map);
    line.on('click', () => { selected = i; drawRoutes(); }); routeLines.push(line); if (on) line.bringToFront(); });
  const rt = routes[selected], alts = $('alts'); alts.innerHTML = '';
  document.body.classList.add('has-route');
  const delay = r => (r.adj || r.duration) - r.duration;
  routes.forEach((r, i) => {
    const b = document.createElement('button'), label = i === 0 ? (routes.length > 1 ? 'Fastest' : 'Route') : delay(r) < delay(routes[0]) - 60 ? 'Less traffic' : 'Alternative';
    b.className = 'card' + (i === selected ? ' on' : '');
    const t = document.createElement('span'), m = document.createElement('span'), c = document.createElement('span');
    t.className = 'ct'; t.textContent = dur(T(r)); m.className = 'cm'; m.textContent = `${miles(r.distance)} · ${label}`; c.className = 'cc'; c.textContent = chipFor(r);
    b.append(t, m); if (c.textContent) { c.insertAdjacentHTML('afterbegin', ic('bus') + ' '); b.append(c); }
    b.onclick = () => { selected = i; drawRoutes(); }; alts.appendChild(b);
  });
  alts.style.display = 'flex';
  const eta = new Date(Date.now() + T(rt) * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sm = $('summary'); sm.style.display = 'block';
  sm.innerHTML = `<b>${dur(T(rt))}</b> &middot; ${miles(rt.distance)} &middot; arrive ~${eta}${trafficNote(rt)}
    <div class="links"><button class="primary" id="startnav">${ic('navigation-arrow')} Start navigation</button><button id="simnav" title="Preview the route at 3x speed">Simulate</button></div>`;
  $('startnav').onclick = () => startNav(false); $('simnav').onclick = () => startNav(true);
  const ol = $('steps'); ol.innerHTML = '';
  rt.legs[0].steps.forEach((s, si) => { const dd = describe(s), li = document.createElement('li'); li.dataset.i = si;
    li.innerHTML = `<span class="ic">${ic(dd.icon)}</span><div><div class="t"></div><div class="d">${s.maneuver.type === 'arrive' ? '' : miles(s.distance)}</div></div>`;
    li.querySelector('.t').textContent = dd.text; li.onclick = () => map.setView([s.maneuver.location[1], s.maneuver.location[0]], 17); ol.appendChild(li); });
}

/* ---------- live navigation ---------- */
const voiceDef = { on: true, streets: true, style: 'auto', music: 'duck' };
const voice = { ...voiceDef }; try { Object.assign(voice, JSON.parse(localStorage.getItem('wf-voice') || '{}')); } catch {}
const saveVoice = () => { try { localStorage.setItem('wf-voice', JSON.stringify(voice)); } catch {} };
const dm0 = (a, b) => a && b ? toM(hav(a, b)) : 0;
const nav = { on: false, sim: false, wid: null, simT: null, rt: null, geom: [], cum: [], total: 1, starts: [], spoken: {}, off: 0,
  follow: true, marker: null, lock: null, muted: !voice.on, rerouting: false, arrived: false, along: 0, first: true, last: null };
const toM = mi => mi * 1609.344;
const bearing = (a, b) => { const r = x => x * Math.PI / 180, y = Math.sin(r(b[1] - a[1])) * Math.cos(r(b[0])),
  x = Math.cos(r(a[0])) * Math.sin(r(b[0])) - Math.sin(r(a[0])) * Math.cos(r(b[0])) * Math.cos(r(b[1] - a[1])); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; };
const fmtD = m => m < 30 ? 'Now' : (m / 1609.344 >= 0.2 ? (m / 1609.344).toFixed(1) + ' mi' : Math.max(50, Math.round(m * 3.281 / 50) * 50) + ' ft');
/* ---------- voice guidance settings (Michael: mute, street names on or off, "turn left in 1,000 feet", music ducking or pausing) ---------- */
function voiceLine(step, dNext) {      // what to say for the next manoeuvre, given the settings. Pure; tested in test/voice.test.mjs
  const d = describe(step, !voice.streets), ph = phraseDist(dNext).replace(/,\s*$/, ''), low = t => t.charAt(0).toLowerCase() + t.slice(1);
  if (!ph) return d.text;
  return voice.style === 'short' ? `${d.text} ${low(ph)}.` : `${ph}, ${low(d.text)}.`;
}
/* ---------- quiet voice: what to say, how much, and learning from your trips (quiet.js; docs/quiet-voice.md) ---------- */
let QWORDS = new Set(), QAMB = new Set(), QSTATE = null;
const QLOG_KEY = 'wf-qlog';
const qlog = {
  load() { try { return JSON.parse(localStorage.getItem(QLOG_KEY) || '{"trips":[],"resetAt":0}'); } catch { return { trips: [], resetAt: 0 }; } },
  save(d) { try { localStorage.setItem(QLOG_KEY, JSON.stringify({ ...d, trips: d.trips.slice(-400) })); } catch {} },
  refold() { const d = this.load(); QSTATE = Quiet.fold(d.trips.filter(t => t.t > d.resetAt), Date.now()); QSTATE.resetAt = d.resetAt; paintLearned(); return QSTATE; },
  add(trip) { const d = this.load(); if (!d.trips.some(t => t.id === trip.id)) d.trips.push(trip); this.save(d); this.refold(); if (window.pfVault && pfVault.putLearn) pfVault.putLearn(trip); },     // encrypted into the account's room when there is one
  reset() { const d = { trips: [], resetAt: Date.now() }; this.save(d); this.refold(); if (window.pfVault && pfVault.resetLearn) pfVault.resetLearn(d.resetAt); },
  merge(trips, resetAt) { const d = this.load(); d.resetAt = Math.max(d.resetAt || 0, resetAt || 0); const have = new Set(d.trips.map(t => t.id)); for (const t of trips || []) if (!have.has(t.id)) d.trips.push(t); d.trips = d.trips.filter(t => t.t > d.resetAt).sort((x, y) => x.t - y.t); this.save(d); this.refold(); },     // from the account on start (called by vault.js)
};

fetch(new URL('quiet-words.json', location.href).href).then(r => r.ok ? r.json() : null).then(j => { if (j && j.words) { QWORDS = new Set(j.words); QAMB = new Set(j.ambiguousBases || []); } }).catch(() => {});      // road-type words EARNED from the street names (scripts/earn-street-words.mjs)
const RAMP = /^(off ramp|on ramp|fork|exit)$/;
function quietSource(step, dNext) {      // the sentence the routing data supports, built only from the step's own facts (exit number, road name, refs, destinations)
  const m = step.maneuver || {}, head0 = describe(step, true).text.replace(/\.$/, '').replace(/\s+toward\s+.*$/i, '').replace(/on the (?:slight|sharp) (left|right)/i, 'on the $1'), ph = phraseDist(dNext);      // the destination is rebuilt below from the step's own fields, so it is not said twice
  const refs = String(step.ref || '').split(';').map(x => x.trim()).filter(Boolean), dest = String(step.destinations || '').split(',').map(x => x.trim()).filter(Boolean);
  let head = head0, prep = '', ids = [];
  if (RAMP.test(m.type || '') && step.exits) head = head0.replace(/^Take the exit/i, 'Take exit ' + step.exits);
  if (RAMP.test(m.type || '') && dest.length) { prep = 'toward'; ids = dest.slice(0, 2); }
  else { prep = /^(depart|continue)$/.test(m.type || '') ? 'on' : 'onto'; ids = [...new Set([step.name, ...refs].filter(Boolean))]; }
  if (m.type === 'arrive' || /^(roundabout|rotary)$/.test(m.type || '')) ids = [];
  const low = t => t.charAt(0).toLowerCase() + t.slice(1), idText = ids.length ? ' ' + prep + ' ' + ids.join(', ') : '';
  return ph ? `${ph}${low(head)}${idText}.` : `${head}${idText}.`;
}
function quietLine(step, dNext) {      // -> the sentence to speak (already passed through the gate)
  const src = quietSource(step, dNext), style = voice.style === 'auto' ? (QSTATE ? QSTATE.style : 'short') : voice.style;
  try { return Quiet.sayNow(src, QSTATE, { suffixes: QWORDS, ambiguous: QAMB, style, names: voice.streets }); } catch { return src; }
}
function phraseDist(m) {
  if (m < 40) return '';
  if (m >= 1200) return `In ${(m / 1609.344).toFixed(1)} miles, `;
  if (m >= 600) return 'In half a mile, ';
  if (m >= 300) return 'In a quarter mile, ';
  return `In ${Math.max(100, Math.round(m * 3.281 / 50) * 50)} feet, `;
}
function speak(text) {
  if (nav.muted || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1; speechSynthesis.speak(u); } catch {}
}
function prepNav(rt) {
  nav.rt = rt; nav.geom = rt.geometry.coordinates.map(c => [c[1], c[0]]);
  nav.cum = [0]; for (let i = 1; i < nav.geom.length; i++) nav.cum.push(nav.cum[i - 1] + toM(hav(nav.geom[i - 1], nav.geom[i])));
  nav.total = nav.cum[nav.cum.length - 1] || 1;
  const steps = rt.legs[0].steps, k = nav.total / (rt.distance || nav.total); let acc = 0;
  nav.starts = steps.map(s => { const st = acc * k; acc += s.distance; return st; });
  nav.spoken = {}; nav.off = 0; nav.wrongAt = 0; nav.lastGood = Date.now(); nav.arrived = false; nav.along = 0;
}
/* ---------- nav matching and off-route rules (pure, tested in test/offroute.test.mjs) ----------
   Not invented here. Organic Maps (libs/routing/routing_session.cpp, route.cpp): the matched position only moves forward along the route and
   a counter of "moving away from the last good point" triggers the rebuild. OsmAnd (RoutingHelper.java, RoutingHelperUtils.java): off-route when
   the sideways distance exceeds about 2 x (30 m + accuracy), AND a separate wrong-direction rule: GPS bearing more than 90 degrees from the route
   bearing. Valhalla/OSRM: the reroute request carries the current heading (OSRM `bearings`) so the new route continues the way you are facing. */
const NAV = { ahead: 400, behind: 40, minSpeed: 2.5, wrongDeg: 100, wrongMs: 4000, cooldownMs: 6000 };
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
function navSnap(geom, cum, p, along, ahead = NAV.ahead) {          // only segments near where we were: a little behind, `ahead` metres forward (grows while fixes are missing); a parallel leg of a route that doubles back is out of reach
  const kx = 111320 * Math.cos(p[0] * Math.PI / 180), ky = 110540, px = p[1] * kx, py = p[0] * ky;
  let best = { d: 1e12, along, idx: 0, pt: p };
  for (let i = 0; i < geom.length - 1; i++) {
    if (cum[i + 1] < along - NAV.behind) continue; if (cum[i] > along + ahead) break;
    const ax = geom[i][1] * kx, ay = geom[i][0] * ky, dx = geom[i + 1][1] * kx - ax, dy = geom[i + 1][0] * ky - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy, d = Math.hypot(px - cx, py - cy);
    if (d < best.d) best = { d, idx: i, along: cum[i] + t * (cum[i + 1] - cum[i]), pt: [cy / ky, cx / kx] };
  }
  return best;
}
function navJudge(st, now, m) {                  // m: { d, tol, heading (deg or null), speed (m/s or null), routeBrg }. Returns '' (on route), 'away' or 'wrong-way'. st keeps the counters.
  st.off = m.d > m.tol ? st.off + 1 : 0;
  const moving = m.heading != null && m.speed != null && m.speed >= NAV.minSpeed;
  if (moving && angDiff(m.heading, m.routeBrg) > NAV.wrongDeg) { if (!st.wrongAt) st.wrongAt = now; } else st.wrongAt = 0;
  if (st.off >= 2) return 'away';
  if (st.wrongAt && now - st.wrongAt >= NAV.wrongMs) return 'wrong-way';
  return '';
}
/* ---------- end nav matching ---------- */
function snap(p) { return navSnap(nav.geom, nav.cum, p, nav.along, NAV.ahead + Math.max(0, Date.now() - (nav.lastGood || Date.now())) / 1000 * 30); }      // 30 m/s allowance for every second since the last good match (tunnel, lost signal)
function updateMarker(pt, heading, extra) {
  const icon = avatarOn() ? avatarIcon(heading) : L.divIcon({ className: '', iconSize: [38, 38], iconAnchor: [19, 19],
    html: `<div style="transform:rotate(${heading || 0}deg);width:38px;height:38px"><svg viewBox="0 0 34 34" width="38" height="38"><circle cx="17" cy="17" r="15" fill="#fff" opacity=".92"/><path d="M17 5 L26 27 L17 22 L8 27 Z" fill="#0b6bcb" stroke="#fff" stroke-width="1.5"/></svg></div>` });
  if (!nav.marker) nav.marker = L.marker(pt, { icon, zIndexOffset: 1000, interactive: false }).addTo(map); else { nav.marker.setLatLng(pt); nav.marker.setIcon(icon); }
  nav.last = pt;
  if (nav.follow) { if (map.getZoom() < 16) map.setView(pt, 17); else map.panTo(pt, { animate: true, duration: .8 }); }
  if (typeof nav3d !== 'undefined') nav3d.update(pt, heading, extra);     // the 3D view (nav3d.js) follows the same fixes
}
/* ---------- when to speak (pure, tested in test/promptwatch.test.mjs) ----------
   Complaint from real users: the last warning comes too late at highway speed. Distances now come from time: first prompt about 45 s ahead, then 15 s, then 4 s,
   never closer than a floor (so a crawl still gets a useful prompt). Walking and cycling keep short fixed distances. */
function promptDistances(driving, speedMs) {
  if (!driving) return [150, 60, 15];
  const v = Math.max(speedMs || 0, 0), floor = [400, 120, 30], sec = [45, 15, 4];
  return sec.map((t, i) => Math.round(Math.max(floor[i], v * t)));
}
// A position that stopped arriving is worse than a wrong one: say so after 10 s without a fix (tunnel, garage, lost signal).
const GPS_STALE_MS = 10000;
const gpsStale = (now, lastFixAt) => !!lastFixAt && now - lastFixAt > GPS_STALE_MS;
/* ---------- end when to speak ---------- */
/* the trip as it is driven: which prompts were spoken at each junction and how each junction went (the log's raw material) */
function qStart() { nav.q = { id: 'tr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: Date.now(), steps: new Map(), lastPrompt: null, muteVote: null }; }
function qStep(i) { const st = nav.rt.legs[0].steps[i]; if (!st || !nav.q) return null; const key = Quiet.stepKey(st); let e = nav.q.steps.get(i); if (!e) { e = { key, man: (st.maneuver || {}).type, level: 'full', style: null, spoken: [], outcome: null, muted: false }; nav.q.steps.set(i, e); } return e; }
function qPrompt(i, stage, style, level) { const e = qStep(i); if (!e) return; e.spoken.push(stage); e.style = style; e.level = level; nav.q.lastPrompt = { i, at: Date.now() }; }
function qMiss() { if (!nav.q || nav.curStep == null) return; for (const i of [nav.curStep, nav.curStep - 1]) { if (i < 1) continue; const e = qStep(i); if (e && e.spoken.length && e.outcome == null && (i === nav.curStep || (nav.along - nav.starts[i]) < 150)) { e.outcome = 'miss'; break; } } }
function qFinish(arrived) {
  const q = nav.q; if (!q || !nav.rt) return; nav.q = null;
  const steps = [...q.steps].filter(([i, e]) => e.spoken.length && (e.outcome === 'miss' || arrived || nav.along > nav.starts[i] + 30)).map(([i, e]) => ({ key: e.key, man: e.man, level: e.level, style: e.style, muted: e.muted, outcome: e.outcome || 'ok' }));
  if (!steps.length || nav.sim) return;      // Simulate teaches nothing about you
  const g = nav.geom; qlog.add({ id: q.id, t: q.t, route: Quiet.routeKey(g[0], g[g.length - 1]), arrived: !!arrived, steps });
}
// The turn banner changes height with the street name (up to four lines), so everything that sits under it is placed from its measured bottom edge (--navtop-b), not a fixed number.
function syncNavTop() { const t = $('navtop'); if (!t || !document.body.classList.contains('navigating')) return; document.body.style.setProperty('--navtop-b', Math.ceil(t.getBoundingClientRect().bottom) + 'px'); }
try { new ResizeObserver(syncNavTop).observe($('navtop')); } catch {} addEventListener('resize', syncNavTop);
function updateNavUI(along, speedMs) {
  const steps = nav.rt.legs[0].steps; let i = 0;
  while (i + 1 < steps.length && nav.starts[i + 1] <= along) i++;
  const nxt = Math.min(i + 1, steps.length - 1), dNext = i >= steps.length - 1 ? 0 : Math.max(0, nav.starts[nxt] - along), d = describe(steps[nxt]);
  $('nav-ic').innerHTML = ic(d.icon); $('nav-dist').textContent = fmtD(dNext); $('nav-txt').textContent = d.text; syncNavTop();
  $('nav-then').textContent = nxt + 1 < steps.length && nav.starts[nxt + 1] - nav.starts[nxt] < 400 ? 'Then ' + describe(steps[nxt + 1]).text.toLowerCase() : '';
  const rem = Math.max(0, nav.total - along), sec = remSec(along, rem);
  $('nb-eta').textContent = new Date(Date.now() + sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('nb-rest').textContent = ` · ${dur(sec)} · ${miles(rem)}` + (speedMs > 1 ? ` · ${Math.round(speedMs * 2.237)} mph` : '');
  document.querySelectorAll('#steps li').forEach(li => { const on = +li.dataset.i === i; li.classList.toggle('cur', on); if (on) li.scrollIntoView({ block: 'nearest' }); });
  // voice prompts at escalating distances
  nav.spd = nav.spd == null ? (speedMs || 0) : nav.spd * 0.7 + (speedMs || 0) * 0.3;      // smoothed, so one slow fix does not pull the warning closer
  const thr = promptDistances(mode === 'routed-car', nav.spd);
  nav.curStep = nxt;
  if (dNext > 0) {
    const lv = Quiet.level(QSTATE, steps[nxt]), allowed = Quiet.stagesFor(lv.n);
    thr.forEach((t, k) => {
      if (dNext <= t && !nav.spoken[nxt + ':' + k]) {
        for (let j = 0; j <= k; j++) nav.spoken[nxt + ':' + j] = 1;
        if (!allowed.includes(k)) return;      // a junction you know well skips the early prompts; the safety floor in quiet.js keeps the ones that matter
        const text = quietLine(steps[nxt], dNext); speak(text); qPrompt(nxt, k, voice.style === 'auto' ? (QSTATE ? QSTATE.style : 'short') : voice.style, lv.name);
      }
    });
  }
}
function onFix(pos) {
  if (!nav.on || nav.arrived) return;
  nav.lastFixAt = Date.now(); if (nav.gpsLost) { nav.gpsLost = false; paintGpsLost(); }
  const c = pos.coords, p = [c.latitude, c.longitude];
  if (!nav.sim && nav.first) {
    nav.first = false;
    if (!inTN(p)) { endNav(); return status('Your GPS fix is outside Tennessee, so I cannot track you along this route. Use Simulate to preview it, or try again on a phone with GPS.', 'warn'); }
  }
  const s = snap(p), tol = Math.max(45, 30 + (c.accuracy || 0) * 1.5), now = Date.now();
  // heading and speed: the phone's own when it has them, else worked out from the last two fixes (a browser often gives null heading)
  let gh = (c.heading != null && !isNaN(c.heading)) ? c.heading : null, gs = (c.speed != null && !isNaN(c.speed)) ? c.speed : null;
  if (nav.prevP && nav.prevT && now > nav.prevT) { const dm = toM(hav(nav.prevP, p)); if (gs == null) gs = dm / ((now - nav.prevT) / 1000); if (gh == null && dm > 8) gh = bearing(nav.prevP, p); }
  if (dm0(nav.prevP, p) > 8 || !nav.prevP) { nav.prevP = p; nav.prevT = now; }
  const rb = bearing(nav.geom[s.idx], nav.geom[Math.min(s.idx + 1, nav.geom.length - 1)]);
  const why = navJudge(nav, now, { d: s.d, tol, heading: gh, speed: gs, routeBrg: rb });
  if (why) {
    updateMarker(p, gh != null ? gh : c.heading, { speed: c.speed });
    qMiss();
    if (!nav.rerouting && now - (nav.lastReroute || 0) >= NAV.cooldownMs) reroute(p, gs != null && gs >= NAV.minSpeed ? gh : null);
    return;
  }
  nav.along = s.along; nav.lastGood = now;
  const hd = (c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 1) ? c.heading : bearing(nav.geom[s.idx], nav.geom[Math.min(s.idx + 1, nav.geom.length - 1)]);
  updateMarker(s.pt, hd, { idx: s.idx, speed: c.speed });
  if (nav.total - s.along < 25) {
    nav.arrived = true; qFinish(true); stopTrackers();
    $('nav-ic').innerHTML = ic('flag-checkered'); $('nav-dist').textContent = 'Arrived'; $('nav-txt').textContent = 'You have arrived at your destination'; $('nav-then').textContent = '';
    $('nb-end').textContent = 'Done'; $('nb-save').style.display = 'inline-block'; $('nb-rec').style.display = 'none';
    return speak('You have arrived at your destination.');
  }
  updateNavUI(s.along, c.speed);
}
async function reroute(p, heading) {
  nav.rerouting = true; nav.lastReroute = Date.now(); $('nav-txt').textContent = 'Rerouting…'; speak('Rerouting.');
  try {
    const r = (await getRoutes(p, dest, false, heading))[0];
    applyTraffic(r); routes = [r]; selected = 0; prepNav(r); drawRoutes(); routeLines.forEach(l => l.setStyle({ weight: 7 })); if (typeof nav3d !== 'undefined') nav3d.setRoute(nav.geom);
    speak(describe(r.legs[0].steps[0]).text);
  } catch (e) { status('Could not reroute: ' + e.message, 'err'); }
  nav.rerouting = false;
}
function simulate() {
  let along = 0; const sp = (mode === 'routed-car' ? 22 : mode === 'routed-bike' ? 7 : 2.5);
  nav.simT = setInterval(() => {
    along = Math.min(nav.total, along + sp * 3); // 3x speed so the demo is quick
    let i = 0; while (i < nav.cum.length - 2 && nav.cum[i + 1] < along) i++;
    const seg = nav.cum[i + 1] - nav.cum[i] || 1, t = Math.min(1, (along - nav.cum[i]) / seg), a = nav.geom[i], b = nav.geom[i + 1];
    onFix({ coords: { latitude: a[0] + (b[0] - a[0]) * t, longitude: a[1] + (b[1] - a[1]) * t, accuracy: 5, heading: bearing(a, b), speed: sp } });
  }, 1000);
}
function paintGpsLost() { const b = $('gpslost'); if (b) b.hidden = !nav.gpsLost; document.body.style.setProperty('--gpslost-h', nav.gpsLost && b ? Math.ceil(b.getBoundingClientRect().height) + 8 + 'px' : '0px'); syncNavTop(); }
function gpsWatchTick() {      // runs every 2 s while navigating with a real GPS (not Simulate)
  if (!nav.on || nav.sim || nav.arrived) return;
  const stale = gpsStale(Date.now(), nav.lastFixAt);
  // a quiet note, not an alarm: no sound, no colour
  if (stale && !nav.gpsLost) { nav.gpsLost = true; paintGpsLost(); } else if (!stale && nav.gpsLost) { nav.gpsLost = false; paintGpsLost(); }
}
setInterval(gpsWatchTick, 2000);
function stopTrackers() {
  if (nav.wid != null) { navigator.geolocation.clearWatch(nav.wid); nav.wid = null; }
  if (nav.simT) { clearInterval(nav.simT); nav.simT = null; }
}
async function startNav(sim) {
  // In the Android app, turn-by-turn is the native screen (MapLibre Navigation Android + Valhalla): proven route following, off-route detection and voice,
  // and it keeps going with the screen off. The web navigation below is the fallback for browsers and iPhone.
  { const n = window.WayfinderNative; let can = false; try { can = !!(n && n.canNavigate && n.canNavigate()); } catch {}
    if (can && dest) {
      const from0 = sim && start ? start[0] : NaN, from1 = sim && start ? start[1] : NaN;
      try { if (n.startNavigationV2) n.startNavigationV2(dest[0], dest[1], $('to').value || '', mode, !!sim, from0, from1, JSON.stringify(voice)); else n.startNavigation(dest[0], dest[1], $('to').value || '', mode, !!sim, from0, from1); return; } catch {} } }
  if (!routes.length) return;
  nav.on = true; nav.sim = sim; nav.follow = true; nav.first = true; qStart(); nav.lastFixAt = Date.now(); nav.gpsLost = false; nav.spd = null; paintGpsLost();
  prepNav(routes[selected]);
  document.body.classList.add('navigating'); $('navtop').style.display = 'flex'; $('navbot').style.display = 'flex'; syncNavTop(); $('nb-rec').style.display = 'none';
  setTimeout(() => map.invalidateSize(), 50);
  if (typeof nav3d !== 'undefined') nav3d.start(nav.geom);
  routeLines.forEach((l, i) => { if (i !== selected) l.remove(); });
  $('nav-ic').innerHTML = ic('compass'); $('nav-dist').textContent = '…'; $('nav-txt').textContent = sim ? 'Simulating drive' : 'Waiting for GPS…'; $('nav-then').textContent = '';
  speak('Starting navigation. ' + describe(nav.rt.legs[0].steps[0]).text);
  try { nav.lock = await navigator.wakeLock.request('screen'); } catch {}
  if (sim) simulate();
  else if (!navigator.geolocation) endNav('This browser has no location support.');
  else nav.wid = navigator.geolocation.watchPosition(onFix, e => status(e.code === 3 ? 'Searching for GPS…' : 'GPS problem: ' + e.message, e.code === 3 ? '' : 'err'), { enableHighAccuracy: true, maximumAge: 1000, timeout: 60000 });
}
function endNav(msg) {
  if (typeof nav3d !== 'undefined') nav3d.stop();
  qFinish(false); stopTrackers(); nav.on = false; nav.gpsLost = false; paintGpsLost(); try { speechSynthesis.cancel(); } catch {}
  try { nav.lock && nav.lock.release(); } catch {} nav.lock = null;
  if (nav.marker) { nav.marker.remove(); nav.marker = null; }
  document.body.classList.remove('navigating'); $('navtop').style.display = 'none'; $('navbot').style.display = 'none';
  clearTimeout(endT); endArmed = false; $('nb-end').classList.remove('armed', 'holding'); $('nb-end').textContent = 'End'; $('nb-save').style.display = 'none'; $('nb-save').innerHTML = ic('star') + ' Save place';
  document.querySelectorAll('#steps li.cur').forEach(li => li.classList.remove('cur'));
  if (isMob()) setSheet('half');
  setTimeout(() => { map.invalidateSize(); if (routeLines.length) map.fitBounds(L.featureGroup(routeLines).getBounds(), fitOpts()); }, 80);
  if (msg) status(msg);
}
map.on('dragstart', () => { if (nav.on) { nav.follow = false; $('nb-rec').style.display = 'inline-block'; } });
$('nb-rec').onclick = () => { nav.follow = true; $('nb-rec').style.display = 'none'; if (nav.last) map.setView(nav.last, 17); if (typeof nav3d !== 'undefined') nav3d.recenter(); };
$('nb-mute').onclick = () => { const wasMuted = nav.muted; if (!wasMuted && nav.q && nav.q.lastPrompt && Date.now() - nav.q.lastPrompt.at < 6000) { const e = qStep(nav.q.lastPrompt.i); if (e) e.muted = true; }      /* muting within 6 s of a prompt is a vote against how it was worded */
  nav.muted = !nav.muted; voice.on = !nav.muted; saveVoice(); paintVoice(); $('nb-mute').innerHTML = ic(nav.muted ? 'speaker-slash' : 'speaker-high'); if (nav.muted) try { speechSynthesis.cancel(); } catch {} };

function paintLearned() {      // an auditable view of what the fold knows: counts, not a black box
  const box = $('vc-learned'); if (!box) return; const st = QSTATE; if (!st || !st.trips) { box.textContent = 'Nothing yet. It learns after you finish drives (Simulate teaches nothing).'; } else {
    let known = 0, veto = 0, floorStep = 0; for (const [, e] of st.steps) { const f = Quiet.wilsonLower(e.H, e.A); if (e.veto) veto++; else if (f >= Quiet.GROUND.knownAt) known++; }
    const rk = [...st.routes].filter(([, r]) => r.n >= Quiet.GROUND.minRouteRepeats).length;
    box.textContent = `${st.trips} drive${st.trips === 1 ? '' : 's'}, ${st.steps.size} junction${st.steps.size === 1 ? '' : 's'} seen, ${known} known well enough to say less, ${veto} kept at full because a turn was missed there, ${rk} route${rk === 1 ? '' : 's'} you repeat. Wording leans ${st.style === 'short' ? 'short' : 'with road names'}.`; }
  const w = $('vc-where'); if (w) w.textContent = window.pfVault && pfVault.ready && pfVault.ready() ? 'Saved encrypted in your account room, so a new phone gets it back.' : 'Kept only on this phone. With a Wayfinder account it is saved encrypted instead.';
}
$('vc-forget').onclick = () => { qlog.reset(); };
qlog.refold();
function paintVoice() {
  $('vc-on').checked = voice.on; $('vc-streets').checked = voice.streets; $('vcpill').textContent = voice.on ? 'On' : 'Muted'; $('vcpill').className = 'pill ' + (voice.on ? 'live' : 'off');
  document.querySelectorAll('#vc-style button').forEach(b => b.classList.toggle('on', b.dataset.v === voice.style)); document.querySelectorAll('#vc-music button').forEach(b => b.classList.toggle('on', b.dataset.v === voice.music));
  const eg = { type: 'turn', modifier: 'left' }, step = { maneuver: eg, name: '9th Avenue South' }; $('vc-eg').textContent = voice.on ? 'Sounds like: "' + quietLine(step, 305) + '"' : 'Muted: nothing is spoken.';
  const nat = !!(window.WayfinderNative && window.WayfinderNative.canNavigate); $('vc-music-note').textContent = nat ? 'Lower: the music gets quieter while the voice speaks. Pause: it stops, then resumes. Talk over: the voice plays on top and leaves the music alone.' : 'Only the Android app can control other audio. A phone browser decides this itself.';
  document.querySelectorAll('#vc-music button').forEach(b => b.disabled = !nat); nav.muted = !voice.on;
  const m = $('nb-mute'); if (m) m.innerHTML = ic(nav.muted ? 'speaker-slash' : 'speaker-high');
}
$('vc-on').onchange = () => { voice.on = $('vc-on').checked; saveVoice(); paintVoice(); if (!voice.on) try { speechSynthesis.cancel(); } catch {} };
$('vc-streets').onchange = () => { voice.streets = $('vc-streets').checked; saveVoice(); paintVoice(); };
$('vc-style').onclick = e => { const b = e.target.closest('button'); if (!b) return; voice.style = b.dataset.v; saveVoice(); paintVoice(); };
$('vc-music').onclick = e => { const b = e.target.closest('button'); if (!b || b.disabled) return; voice.music = b.dataset.v; saveVoice(); paintVoice(); };
paintVoice();
// ending needs a second tap within 3 s, so a bump or a pocket touch cannot kill navigation; after arrival one tap is enough
let endArmed = false, endT = null, holdT = null, held = false;
const endBtn = $('nb-end');
const disarm = () => { clearTimeout(endT); endArmed = false; endBtn.classList.remove('armed'); if (!nav.arrived) endBtn.textContent = 'End'; };
// Two ways to end: tap twice within 3 s (the button turns yellow after the first tap), or press and hold for 0.6 s (a yellow fill shows the time running). After arrival one tap is enough.
endBtn.onclick = () => {
  if (held) { held = false; return; }
  if (nav.arrived || endArmed) { disarm(); return endNav(); }
  endArmed = true; endBtn.classList.add('armed'); endBtn.textContent = 'Are you sure?'; endT = setTimeout(disarm, 3000);
};
endBtn.addEventListener('pointerdown', () => {
  if (nav.arrived) return; held = false; endBtn.classList.add('holding');
  holdT = setTimeout(() => { held = true; endBtn.classList.remove('holding'); disarm(); endNav(); setTimeout(() => { held = false; }, 500); }, 600);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach(t => endBtn.addEventListener(t, () => { clearTimeout(holdT); endBtn.classList.remove('holding'); }));
$('nb-save').onclick = () => { if (dest && savePlace({ title: $('to').value || 'Saved place', sub: '', ll: dest })) $('nb-save').innerHTML = ic('star-fill') + ' Saved'; };

/* ---------- bus-based traffic ---------- */
const TW = 0.6;   // share of a bus slowdown applied to cars (buses also stop for riders, so apply only part of it)
const T = r => r.adj || r.duration;
const tf = { url: '', show: true, data: null, links: [], grid: new Map(), layer: L.layerGroup().addTo(map), timer: null, loaded: 0 };
const TRAFFIC_DEFAULT = RELAY + 'traffic/now.json';     // the log-fold hypothesis; the older collector feed stays at traffic.json for comparison
tf.url = TRAFFIC_DEFAULT;     // default: our own API. A saved address (even an empty one, meaning off) overrides it.
try { const s = localStorage.getItem('wf-traffic-url'); if (s !== null) tf.url = s; tf.show = localStorage.getItem('wf-traffic-show') !== '0'; } catch {}
const tfFresh = () => !!(tf.data && tf.data.generated && Date.now() - Date.parse(tf.data.generated) < 15 * 60 * 1000);
const tstat = (msg, cls) => { const e = $('tstat'); e.textContent = msg; e.className = cls || ''; };
const tpill = (kind, label) => { const e = $('tpill'); e.className = 'pill ' + kind; e.textContent = label; };
const tColor = r => r >= .85 ? '#2e9e44' : r >= .6 ? '#e6b800' : r >= .4 ? '#f28c28' : '#d93025';
function remSec(along, rem) {
  const rt = nav.rt; if (!rt.tcum || rt.tcum.length !== nav.cum.length) return rt.duration * rem / nav.total;
  let lo = 0, hi = nav.cum.length - 1; while (lo < hi - 1) { const m = (lo + hi) >> 1; if (nav.cum[m] <= along) lo = m; else hi = m; }
  const f = (along - nav.cum[lo]) / ((nav.cum[hi] - nav.cum[lo]) || 1);
  return Math.max(0, rt.adj - (rt.tcum[lo] + (rt.tcum[hi] - rt.tcum[lo]) * f));
}
const GLAT = 0.002, GLON = 0.0025;
function indexLinks(links) {
  tf.links = links; tf.grid = new Map();
  for (const lk of links) {
    const kx = 111320 * Math.cos(lk.a[0] * Math.PI / 180);
    lk._k = kx; lk._ax = lk.a[1] * kx; lk._ay = lk.a[0] * 110540; lk._dx = lk.b[1] * kx - lk._ax; lk._dy = lk.b[0] * 110540 - lk._ay;
    lk._len2 = lk._dx * lk._dx + lk._dy * lk._dy; lk._len = Math.sqrt(lk._len2);
    const pad = 0.0006, la0 = Math.min(lk.a[0], lk.b[0]) - pad, la1 = Math.max(lk.a[0], lk.b[0]) + pad, lo0 = Math.min(lk.a[1], lk.b[1]) - pad, lo1 = Math.max(lk.a[1], lk.b[1]) + pad;
    for (let i = Math.floor(la0 / GLAT); i <= Math.floor(la1 / GLAT); i++) for (let j = Math.floor(lo0 / GLON); j <= Math.floor(lo1 / GLON); j++) {
      const k = i + ':' + j; (tf.grid.get(k) || tf.grid.set(k, []).get(k)).push(lk);
    }
  }
}
// The bus link (stop to stop) that a road segment lies on: within 45 m of it and heading the same way.
function linkAt(lat, lon, dLat, dLon) {
  const cands = tf.grid.get(Math.floor(lat / GLAT) + ':' + Math.floor(lon / GLON)); if (!cands) return null;
  let best = null, bd = 45;
  for (const lk of cands) {
    if (lk._len < 5) continue;
    const px = lon * lk._k, py = lat * 110540;
    let t = ((px - lk._ax) * lk._dx + (py - lk._ay) * lk._dy) / lk._len2; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (lk._ax + t * lk._dx), py - (lk._ay + t * lk._dy)); if (d >= bd) continue;
    const sx = dLon * lk._k, sy = dLat * 110540, sl = Math.hypot(sx, sy) || 1;
    if ((sx * lk._dx + sy * lk._dy) / (sl * lk._len) < 0.5) continue;          // opposite direction of travel
    best = lk; bd = d;
  }
  return best;
}
async function loadTraffic() {
  tf.loaded = Date.now();
  if (!tf.url) { tf.data = null; indexLinks([]); tf.layer.clearLayers(); applyAndRefresh(); tpill('off', 'Off'); return tstat('Off. Open Advanced to turn it back on.'); }
  if (location.protocol === 'https:' && /^http:/i.test(tf.url)) { tpill('err', 'Blocked'); return tstat('Browsers block http:// addresses from an https page. Serve the collector over https.', 'err'); }
  try {
    const r = await fetch(tf.url, { cache: 'no-store', signal: AbortSignal.timeout(6000) }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); tf.data = j; const all = j.links || [], ok = all.filter(lk => lk.ratio != null && lk.basis !== 'network' && lk.basis !== 'profile');   // links with no recent bus are not used for ETAs
    indexLinks(ok); drawTrafficLayer();
    const age = j.generated ? Math.round((Date.now() - Date.parse(j.generated)) / 60000) : null, learning = all.length - ok.length;
    const when = age == null ? '' : ` Updated ${age < 1 ? 'just now' : age + ' min ago'}.`;
    if (j.sample) { tpill('warn', 'Sample'); tstat('SAMPLE data for testing, not real traffic. ETAs are not adjusted.', 'warn'); }
    else if (!tfFresh()) { tpill('warn', 'Stale'); tstat('The traffic feed is stale (the collector may be down), so it is ignored.', 'warn'); }
    else if (!ok.length) { tpill('learn', 'Learning'); tstat(`Timing buses now: ${all.length} road section${all.length === 1 ? '' : 's'} seen, none with the 25 runs needed to judge traffic yet. ETAs are not adjusted.${when}`); }
    else { tpill('live', 'Live'); tstat(`${ok.length} road section${ok.length === 1 ? '' : 's'} timed${learning ? `, ${learning} still learning what is normal` : ''}.${when}`); }
    applyAndRefresh();
  } catch (e) { tf.data = null; indexLinks([]); tf.layer.clearLayers(); tpill('err', 'Offline'); tstat('Could not load traffic (' + e.message + '). Routes use normal driving time.', 'err'); }
}
function drawTrafficLayer() {
  tf.layer.clearLayers(); if (!tf.show || !tf.data) return;
  // Only slowdowns are drawn (like other maps apps): roads moving normally stay clear. Michael, 2026-11-14: "what's with all the green".
  for (const lk of tf.links) if (lk.ratio < .85)
    L.polyline([lk.a, lk.b], { color: tColor(lk.ratio), weight: 6, opacity: .85 })
      .bindTooltip(`Bus took ${lk.secs} s between stops, usually ${lk.base} s`).addTo(tf.layer);
}
function applyTraffic(rt) {
  delete rt.tcum; delete rt.adj; rt.cov = 0;
  if (mode !== 'routed-car' || !tfFresh() || tf.data.sample || !tf.links.length) return;
  const g = rt.geometry.coordinates, segs = []; let tot = 0;
  for (let i = 0; i < g.length - 1; i++) { const m = toM(hav([g[i][1], g[i][0]], [g[i + 1][1], g[i + 1][0]])); segs.push(m); tot += m; }
  const perM = rt.duration / (tot || 1), tc = [0]; let t = 0, cov = 0;
  for (let i = 0; i < segs.length; i++) {
    const lk = linkAt((g[i][1] + g[i + 1][1]) / 2, (g[i][0] + g[i + 1][0]) / 2, g[i + 1][1] - g[i][1], g[i + 1][0] - g[i][0]);
    let f = 1; if (lk) { f = 1 / Math.max(0.25, 1 - TW * (1 - Math.min(1, lk.ratio))); cov += segs[i]; }
    t += segs[i] * perM * f; tc.push(t);
  }
  rt.tcum = tc; rt.adj = t; rt.cov = cov / (tot || 1);
}
function trafficNote(rt) {
  if (mode !== 'routed-car' || !tf.url) return '';
  if (tf.data && tf.data.sample) return '<div class="tnote warn">Sample traffic data loaded, ETAs not adjusted.</div>';
  if (!tfFresh()) return '<div class="tnote warn">Traffic feed unavailable, showing normal driving time.</div>';
  if (rt.adj == null) return '<div class="tnote">No bus data on this route right now.</div>';
  const d = Math.round((rt.adj - rt.duration) / 60);
  return `<div class="tnote">${d >= 1 ? `+${d} min from bus-based traffic` : 'No bus-detected slowdowns'} · bus data covers ${Math.round(rt.cov * 100)}% of this route</div>`;
}
// one-line traffic note for a route card; says plainly when there is no data instead of looking like "all clear"
function chipFor(rt) {
  if (mode !== 'routed-car' || !tf.url) return '';
  if (tf.data && tf.data.sample) return 'Sample traffic data, ETAs not adjusted';
  if (!tfFresh()) return 'No live traffic data, normal driving time';
  if (rt.adj == null) return 'No bus data on this route';
  const d = Math.round((rt.adj - rt.duration) / 60);
  return `${d >= 1 ? '+' + d + ' min from buses' : 'no slowdowns seen'} · ${Math.round(rt.cov * 100)}% covered`;
}
function applyAndRefresh() { routes.forEach(applyTraffic); if (!nav.on && routes.length) drawRoutes(); }
function startTrafficTimer() { clearInterval(tf.timer); if (tf.url) tf.timer = setInterval(loadTraffic, 60000); }
$('t-url').value = tf.url; $('t-show').checked = tf.show;
$('t-save').onclick = () => { tf.url = $('t-url').value.trim(); try { localStorage.setItem('wf-traffic-url', tf.url); } catch {} startTrafficTimer(); loadTraffic(); };
$('t-reset').onclick = () => { try { localStorage.removeItem('wf-traffic-url'); } catch {} tf.url = TRAFFIC_DEFAULT; $('t-url').value = tf.url; startTrafficTimer(); loadTraffic(); };
$('t-sample').onclick = () => { $('t-url').value = 'traffic.sample.json'; $('t-save').click(); };
$('t-show').onchange = () => { tf.show = $('t-show').checked; try { localStorage.setItem('wf-traffic-show', tf.show ? '1' : '0'); } catch {} drawTrafficLayer(); };

/* ---------- bus times: stops and live buses on the map, pick a bus, confirm you are on it ---------- */
const bus = { on: false, stops: [], vehicles: [], layer: L.layerGroup().addTo(map), timer: null };
const hex = c => /^[0-9a-f]{6}$/i.test(c || '') ? '#' + c : '#0b6bcb';
const ink = h => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150 ? '#111' : '#fff'; };
function badge(route, color) { const s = document.createElement('span'); s.className = 'rb'; s.textContent = route; const h = hex(color); s.style.background = h; s.style.color = ink(h); return s; }
const minsTxt = m => m <= 0 ? 'Due' : m + ' min';
async function relay(path) { const r = await fetch(RELAY + path, { cache: 'no-store', signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
const dM = (a, b) => toM(hav(a, b));
const busCenter = () => (start && inTN(start)) ? { ll: start, label: 'you' } : { ll: [map.getCenter().lat, map.getCenter().lng], label: 'the map centre' };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function initAreaBtn() {   // floating "Search this area" pill over the map, as Google Maps does
  areaBtn = el('button', 'rs-area', 'Search this area'); areaBtn.type = 'button'; areaBtn.hidden = true; document.body.append(areaBtn);
  areaBtn.onclick = () => { areaBtn.hidden = true; searchCategory(res.cat, searchSpot(true)); };
}
initAreaBtn();
const busIcon = () => { const d = el('div', 'sm'); d.innerHTML = ic('bus'); return L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: d }); };
const vehIcon = (v, sel) => { const d = el('div', 'vm' + (sel ? ' sel' : ''), v.route); const h = hex(v.color); d.style.background = h; d.style.color = ink(h); return L.divIcon({ className: '', iconSize: [34, 22], iconAnchor: [17, 11], html: d }); };

async function loadBuses() {
  const c = busCenter(); $('bus-where').textContent = c.label;
  try {
    const [s, v] = await Promise.all([relay(`stops.json?lat=${c.ll[0]}&lon=${c.ll[1]}&r=800&n=8`), relay('vehicles.json')]);
    bus.stops = s.stops || []; bus.vehicles = v.vehicles || []; $('bus-note').textContent = ''; $('bus-note').className = '';
    drawBuses(); renderBusList();
  } catch (e) { $('bus-note').textContent = `Could not reach the bus service (${e.message}). Bus times need a connection.`; $('bus-note').className = 'err'; }
}
function drawBuses() {
  bus.layer.clearLayers(); if (!bus.on) return;
  for (const s of bus.stops) {
    const m = L.marker([s.lat, s.lon], { icon: busIcon(), title: s.name }).addTo(bus.layer);
    m.on('click', () => { const row = document.querySelector(`[data-stop="${CSS.escape(s.id)}"]`); if (row) { row.scrollIntoView({ block: 'nearest' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 900); } });
  }
  const b = map.getBounds().pad(0.1); let n = 0;
  for (const v of bus.vehicles) { if (!b.contains([v.lat, v.lon]) || n++ > 60) continue;
    const tt = el('span', '', `Route ${v.route}${v.headsign ? ' to ' + v.headsign : ''}`); L.marker([v.lat, v.lon], { icon: vehIcon(v, ride.on && v.trip === ride.trip), interactive: true }).bindTooltip(tt).addTo(bus.layer); }
}
function renderBusList() {
  const box = $('bus-list'); box.replaceChildren();
  if (!bus.stops.length) { box.append(el('div', 'sub', 'No bus stops within about half a mile. Pan the map and tap refresh.')); return; }
  const any = bus.stops.some(s => s.arrivals.length);
  if (!any) box.append(el('div', 'sub', 'No buses are predicted at these stops right now. WeGo only publishes predictions for buses that are running.'));
  for (const s of bus.stops) {
    const g = el('div', 'bstop'); g.dataset.stop = s.id;
    const h = el('div', 'bs-h'); h.append(el('span', 'bs-n', s.name), el('span', 'bs-d', miles(s.dist))); g.append(h);
    if (!s.arrivals.length) g.append(el('div', 'bs-none', 'No buses predicted'));
    for (const a of s.arrivals.slice(0, 4)) {
      const b = el('button', 'arr'); b.append(badge(a.route, a.color), el('span', 'ah', a.headsign || 'Route ' + a.route), el('span', 'am' + (a.mins <= 1 ? ' due' : ''), minsTxt(a.mins)));
      b.onclick = () => startRide(a, s); g.append(b);
    }
    box.append(g);
  }
}
function toggleBus(on) {
  bus.on = on; document.body.classList.toggle('bus-on', on); clearInterval(bus.timer); bus.timer = null;
  if (on) { if (isMob()) setSheet('half'); loadBuses(); bus.timer = setInterval(loadBuses, 20000); } else drawBuses();
}
$('busbtn').onclick = () => toggleBus(!bus.on); $('bus-close').onclick = () => toggleBus(false); $('bus-refresh').onclick = loadBuses;

/* ---------- ride logic (pure, tested): is the phone moving with the chosen bus? ---------- */
// track: the phone's GPS fixes [{t ms, ll, acc}] oldest first. Returns the phone's position at time t, interpolated, or null when no fix is close enough in time.
function userAt(track, t) {
  let a = null, b = null;
  for (const k of track) { if (k.t <= t) a = k; else { b = k; break; } }
  if (a && b && b.t - a.t <= 20000) { const f = (t - a.t) / ((b.t - a.t) || 1); return { ll: [a.ll[0] + (b.ll[0] - a.ll[0]) * f, a.ll[1] + (b.ll[1] - a.ll[1]) * f], acc: Math.max(a.acc || 0, b.acc || 0) }; }
  const n = a && t - a.t <= 15000 ? a : b && b.t - t <= 15000 ? b : null; return n ? { ll: n.ll, acc: n.acc || 0 } : null;
}
// fixes: the bus's reported positions [{t ms (the bus's own timestamp), ll}] oldest first. Each is compared with where the phone was AT THAT TIME,
// because the bus data is up to 20 s old and a bus covers 200 m in that time. "On the bus" needs three consecutive fixes inside the match radius
// over at least 30 s with both the phone and the bus having moved 80 m or more: standing at a stop next to a parked bus does not count.
function assessRide(fixes, track, prev) {
  const rows = [];
  for (const f of fixes) { const u = userAt(track, f.t); if (!u) continue; const d = dM(u.ll, f.ll), thr = Math.max(40, Math.min(120, 20 + 1.5 * u.acc)); rows.push({ t: f.t, d, thr, near: d <= thr, u: u.ll, b: f.ll }); }
  if (!rows.length) return { state: prev === 'onboard' ? 'onboard' : 'waiting', dist: null, mismatch: false, together: 0 };
  const cur = rows[rows.length - 1], l3 = rows.slice(-3), l2 = rows.slice(-2);
  const moved = l3.length === 3 ? Math.min(dM(l3[0].u, l3[2].u), dM(l3[0].b, l3[2].b)) : 0;
  const together = l3.length === 3 && l3.every(r => r.near) && l3[2].t - l3[0].t >= 30000 && moved >= 80;
  const away = l2.length === 2 && l2.every(r => r.d > Math.max(150, 3 * r.thr));
  let state = cur.near ? 'near' : 'waiting';
  if (together) state = 'onboard'; else if (prev === 'onboard') state = away ? 'off' : 'onboard';
  return { state, dist: cur.d, mismatch: away, together: together ? moved : 0 };
}

/* ---------- ride: the bus you chose, GPS confirmation, next stops ---------- */
const ride = { on: false }; const userTrack = [];
function endRide() {
  if (ride.wid != null) { try { navigator.geolocation.clearWatch(ride.wid); } catch {} }
  clearInterval(ride.timer); try { ride.lock && ride.lock.release(); } catch {}
  ride.on = false; ride.wid = null; ride.timer = null; ride.lock = null; document.body.classList.remove('riding'); $('ride').replaceChildren(); drawBuses(); if (ride.layer) { ride.layer.remove(); ride.layer = null; }
}
function startRide(a, stop) {
  endRide();
  Object.assign(ride, { on: true, trip: a.trip, route: a.route, color: a.color, headsign: a.headsign, stop, state: 'waiting', via: 'gps', fixes: [], lastTs: 0, detail: null, dist: null, mismatch: false, together: 0, alight: null, spoke: {}, fitted: false, err: '' });
  document.body.classList.add('riding'); if (isMob()) setSheet('half');
  if (navigator.geolocation) ride.wid = navigator.geolocation.watchPosition(onRideFix, e => { ride.err = e.code === 1 ? 'Location permission denied, so GPS cannot confirm the bus.' : 'GPS problem: ' + e.message; rideRender(); }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 60000 });
  else ride.err = 'This browser has no location support, so GPS cannot confirm the bus.';
  try { navigator.wakeLock.request('screen').then(l => { ride.lock = l; }).catch(() => {}); } catch {}
  ridePoll(); ride.timer = setInterval(ridePoll, 8000); rideRender();
}
function onRideFix(p) {
  userTrack.push({ t: p.timestamp || Date.now(), ll: [p.coords.latitude, p.coords.longitude], acc: p.coords.accuracy || 0 });
  while (userTrack.length > 400 || (userTrack.length && Date.now() - userTrack[0].t > 5 * 60000)) userTrack.shift();
  if (ride.on) { rideAssess(); rideRender(); }
}
async function ridePoll() {
  if (!ride.on) return;
  try {
    const d = await relay('trip.json?trip=' + encodeURIComponent(ride.trip)); if (!ride.on) return;
    ride.detail = d; ride.err = '';
    if (d.vehicle && d.vehicle.ts && d.vehicle.ts * 1000 !== ride.lastTs) { ride.lastTs = d.vehicle.ts * 1000; ride.fixes.push({ t: ride.lastTs, ll: [d.vehicle.lat, d.vehicle.lon] }); ride.fixes = ride.fixes.slice(-8); }
    rideAssess(); rideDraw(); rideRender();
  } catch (e) { ride.err = 'Cannot reach the bus service (' + e.message + '). Keeping the last known position.'; rideRender(); }
}
function rideAssess() {
  const r = assessRide(ride.fixes, userTrack, ride.state), was = ride.state;
  ride.dist = r.dist; ride.mismatch = r.mismatch; ride.together = r.together || ride.together;
  ride.state = ride.via === 'manual' ? 'onboard' : r.state;
  if (ride.state === 'onboard' && was !== 'onboard' && ride.via === 'gps') speak(`Confirmed. You are on the route ${ride.route} bus.`);
  if (ride.state === 'off' && was !== 'off') speak('You have left the bus.');
}
function rideDraw() {
  if (!ride.layer) ride.layer = L.layerGroup().addTo(map); ride.layer.clearLayers();
  const d = ride.detail, pts = [];
  if (ride.stop) { L.marker([ride.stop.lat, ride.stop.lon], { icon: busIcon(), zIndexOffset: 500 }).addTo(ride.layer); pts.push([ride.stop.lat, ride.stop.lon]); }
  if (d && d.vehicle) { L.marker([d.vehicle.lat, d.vehicle.lon], { icon: vehIcon({ route: ride.route, color: ride.color }, true), zIndexOffset: 900 }).addTo(ride.layer); pts.push([d.vehicle.lat, d.vehicle.lon]); }
  if (userTrack.length) pts.push(userTrack[userTrack.length - 1].ll); else if (start) pts.push(start);
  if (!ride.fitted && pts.length > 1) { ride.fitted = true; map.fitBounds(L.latLngBounds(pts), fitOpts()); }
}
function rideRender() {
  const root = $('ride'); root.replaceChildren(); if (!ride.on) return;
  const card = el('div', 'rcard ' + ride.state), head = el('div', 'rc-h');
  const x = el('button', 'x'); x.setAttribute('aria-label', 'Stop tracking this bus'); x.innerHTML = ic('x'); armTap(x, endRide);
  head.append(badge(ride.route, ride.color), el('span', 'rc-t', ride.headsign || 'Route ' + ride.route), x); card.append(head);
  const now = Date.now(), d = ride.detail, stops = d ? d.stops.filter(s => s.t * 1000 > now - 30000) : [];
  const line = (icon, big, small) => { const r = el('div', 'rc-s'), i = el('span', 'rc-i'); if (avatarOn() && icon !== 'warning') { i.classList.add('av'); i.append(avatarEl(40)); } else i.innerHTML = ic(icon); const t = el('div'); t.append(el('b', '', big)); if (small) t.append(el('div', 'sub', small)); r.append(i, t); card.append(r); };
  if (ride.state === 'onboard') {
    line('check-circle', `You are on this bus`, ride.via === 'gps' ? `Confirmed by GPS: your phone and the bus moved together for ${miles(ride.together)}.` : 'You told the app you are on it. GPS keeps checking.');
    if (ride.mismatch) line('warning', 'GPS does not match this bus', `Your phone is ${miles(ride.dist)} from it. Check the route number on the bus.`);
  } else if (ride.state === 'near') line('bus', 'The bus is next to you', 'Board it. GPS confirms once you are moving together, or tap the button below.');
  else if (ride.state === 'off') line('flag-checkered', 'You have left the bus', 'Tap the cross to finish.');
  else {
    const mine = d && ride.stop ? d.stops.find(s => s.id === ride.stop.id) : null, mins = mine ? Math.max(0, Math.round((mine.t * 1000 - now) / 60000)) : null;
    const vd = d && d.vehicle && ride.stop ? dM([d.vehicle.lat, d.vehicle.lon], [ride.stop.lat, ride.stop.lon]) : null;   // no GPS fix yet: say how far the bus is from the stop
    line('bus', ride.dist != null ? `The bus is ${miles(ride.dist)} from you` : vd != null ? `The bus is ${miles(vd)} from the stop` : 'Looking for the bus…', ride.stop ? (mins != null ? `Due at ${ride.stop.name} in ${minsTxt(mins)}` : `Boarding at ${ride.stop.name}`) : '');
  }
  if (!d || !d.vehicle) card.append(el('div', 'sub', 'No live position for this bus yet.'));
  if (ride.state === 'onboard' && stops.length) {
    const nx = stops[0], nm = Math.max(0, Math.round((nx.t * 1000 - now) / 60000));
    card.append(el('div', 'rc-next', `Next stop: ${nx.name} · ${minsTxt(nm)}`));
    const list = el('div', 'rc-list');
    for (const s of stops.slice(0, 5)) {
      const b = el('button', 'stp' + (ride.alight === s.id ? ' on' : '')), m = Math.max(0, Math.round((s.t * 1000 - now) / 60000));
      b.append(el('span', 'sn', s.name), el('span', 'sm', minsTxt(m))); const bell = el('span', 'sb'); bell.innerHTML = ic('bell-ringing'); b.append(bell);
      b.setAttribute('aria-label', 'Alert me at ' + s.name); b.onclick = () => { ride.alight = ride.alight === s.id ? null : s.id; rideRender(); }; list.append(b);
    }
    card.append(list, el('div', 'sub', ride.alight ? 'You will get an alert when your stop is next.' : 'Tap a stop to be alerted when it is next.'));
    const al = ride.alight && stops.find(s => s.id === ride.alight);
    if (al && al.id === nx.id && nm <= 1) { card.append(el('div', 'rc-alert', `Get off at ${al.name}`)); if (!ride.spoke[al.id]) { ride.spoke[al.id] = 1; speak(`Next stop, ${al.name}. Get ready to get off.`); } }
  }
  if (ride.err) card.append(el('div', 'sub err', ride.err));
  if ((ride.state === 'waiting' || ride.state === 'near') && ride.via !== 'manual') { const b = el('button', 'primary', ''); b.innerHTML = ic('check-circle') + " I'm on this bus"; b.onclick = () => { ride.via = 'manual'; ride.state = 'onboard'; rideRender(); }; card.append(b); }
  root.append(card);
}
setInterval(() => { if (ride.on) rideRender(); }, 15000);   // keep minutes-to-stop fresh between polls

/* ---------- avatar: what represents you on the map and on the bus ---------- */
// "clip" is an original paperclip character drawn for this app. "custom" is any picture you choose; it is shrunk and kept on this device only.
const CLIP_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M21 56V22a12 12 0 0 1 24 0v26a7 7 0 0 1-14 0V28" fill="none" stroke="#6b7a8c" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M21 56V22a12 12 0 0 1 24 0v26a7 7 0 0 1-14 0V28" fill="none" stroke="#c9d3de" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(-.8 -.8)"/>' +
  '<ellipse cx="27.5" cy="21" rx="4.6" ry="5.6" fill="#fff" stroke="#3b4756" stroke-width="1.2"/><ellipse cx="38.5" cy="21" rx="4.6" ry="5.6" fill="#fff" stroke="#3b4756" stroke-width="1.2"/>' +
  '<circle cx="28.4" cy="22" r="2.1" fill="#1b2430"/><circle cx="37.6" cy="22" r="2.1" fill="#1b2430"/>' +
  '<path d="M22.5 13.5q4-3 8 0M34.5 13.5q4-3 8 0" fill="none" stroke="#3b4756" stroke-width="1.6" stroke-linecap="round"/></svg>';
const av = { id: 'arrow', img: '', rot: false };
try { av.id = localStorage.getItem('wf-avatar') || 'arrow'; av.img = localStorage.getItem('wf-avatar-img') || ''; av.rot = localStorage.getItem('wf-avatar-rot') === '1'; } catch {}
if (av.id === 'custom' && !av.img) av.id = 'arrow';
const avatarOn = () => av.id === 'clip' || (av.id === 'custom' && !!av.img);
function avatarEl(px) {
  const d = el('span', 'av-pic'); d.style.width = d.style.height = px + 'px';
  if (av.id === 'clip') d.innerHTML = CLIP_SVG; else if (av.id === 'custom' && av.img) { const i = new Image(); i.alt = ''; i.src = av.img; d.append(i); }
  return d;
}
function avatarIcon(heading) {     // upright with a heading pointer, or (top-down vehicles) the picture itself turns to face the way you are going
  const w = el('div', 'av-wrap'), d = el('div', 'av-dir'), b = el('div', 'av-body'), pic = avatarEl(40);
  if (av.rot && av.id === 'custom') { w.classList.add('rot'); pic.style.transform = `rotate(${heading || 0}deg)`; b.append(pic); w.append(b); }
  else { d.style.transform = `rotate(${heading || 0}deg)`; d.innerHTML = '<svg viewBox="0 0 58 58" width="58" height="58"><path d="M29 1.5 L39 14 L19 14 Z" fill="#0b6bcb" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>'; b.append(pic); w.append(d, b); }
  return L.divIcon({ className: '', iconSize: [58, 58], iconAnchor: [29, 29], html: w });
}
function paintAvatar() {
  $('a-rot').checked = av.rot;
  const names = { arrow: 'Arrow', clip: 'Paperclip', custom: 'My image' };
  $('apill').textContent = avatarOn() ? names[av.id] : 'Arrow'; $('apill').className = 'pill ' + (avatarOn() ? 'live' : 'off');
  document.querySelectorAll('#achoices button').forEach(b => {
    const id = b.dataset.av, on = id === av.id; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    const pv = b.querySelector('.ap'); pv.replaceChildren();
    if (id === 'arrow') pv.innerHTML = '<svg viewBox="0 0 34 34" width="40" height="40"><circle cx="17" cy="17" r="15" fill="#fff" stroke="#dde3ea"/><path d="M17 5 L26 27 L17 22 L8 27 Z" fill="#0b6bcb" stroke="#fff" stroke-width="1.5"/></svg>';
    else if (id === 'clip') pv.innerHTML = CLIP_SVG;
    else if (av.img) { const i = new Image(); i.alt = ''; i.src = av.img; pv.append(i); } else pv.innerHTML = ic('image');
  });
  if (nav.marker && nav.last) updateMarker(nav.last, 0);
  if (startMk && $('from').value === 'My location') startMk.setIcon(avatarOn() ? avatarIcon(0) : pinIcon('#0b6bcb'));
  if (ride.on) rideRender();
}
$('a-rot').onchange = () => { av.rot = $('a-rot').checked; try { localStorage.setItem('wf-avatar-rot', av.rot ? '1' : '0'); } catch {} paintAvatar(); };
function setAvatar(id) { av.id = id; try { localStorage.setItem('wf-avatar', id); } catch {} paintAvatar(); }
document.querySelectorAll('#achoices button').forEach(b => b.onclick = () => { if (b.dataset.av === 'custom') $('a-file').click(); else setAvatar(b.dataset.av); });
$('a-file').onchange = () => {
  const f = $('a-file').files[0]; if (!f) return; const url = URL.createObjectURL(f), img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'), s = Math.min(img.width, img.height);
    x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96); URL.revokeObjectURL(url);
    av.img = c.toDataURL('image/png'); try { localStorage.setItem('wf-avatar-img', av.img); } catch {} setAvatar('custom'); $('a-file').value = '';
  };
  img.onerror = () => { URL.revokeObjectURL(url); $('apill').textContent = 'Not an image'; $('apill').className = 'pill err'; };
  img.src = url;
};
paintAvatar();

/* ---------- sprite library: free (public, CC0) and private (your own key) ---------- */
// Free sprites ship with the app (sprites/free/). The private library lives on hyphae behind a key that is kept only in this browser; nothing from it is in the public repo or pages.
const FREE_BASE = new URL('sprites/free/', location.href).href, PRIV_BASE = 'https://collab.hyphae.social/wayfinder-private/sprites/';
const lib = { tab: 'free', free: null, priv: null, key: '', q: '', blobs: new Map() };
try { lib.key = localStorage.getItem('wf-lib-key') || ''; } catch {}
// Michael (2026-11-13): "lets only use top down vehicles". Both tabs list only sprites marked facing 'up' (a top-down vehicle that points up); side views, rear views and fighters are not shown.
const libItems = () => ((lib.tab === 'free' ? lib.free : lib.priv) || []).filter(it => it.facing === 'up');
async function loadLib() {
  const note = $('l-note'); note.textContent = ''; note.className = 'sub'; $('l-key').hidden = !(lib.tab === 'private' && !lib.key);
  try {
    if (lib.tab === 'free' && !lib.free) { const j = await (await fetch(FREE_BASE + 'index.json')).json(); lib.free = j.items; lib.freeCredit = j.credit; }
    if (lib.tab === 'private' && lib.key && !lib.priv) {
      const r = await fetch(PRIV_BASE + 'index.json', { headers: { 'x-wf-key': lib.key }, cache: 'no-store' });
      if (r.status === 403) { lib.key = ''; try { localStorage.removeItem('wf-lib-key'); } catch {} $('l-key').hidden = false; note.textContent = 'That key was not accepted.'; note.className = 'sub err'; return renderLib(); }
      if (!r.ok) throw new Error('HTTP ' + r.status); lib.priv = (await r.json()).items;
    }
  } catch (e) { note.textContent = 'Could not load the library (' + e.message + ').'; note.className = 'sub err'; }
  renderLib();
}
function renderLib() {
  const grid = $('l-grid'); grid.replaceChildren(); const toks = lib.q.toLowerCase().split(/\s+/).filter(Boolean);
  const items = libItems().filter(it => { const t = (it.name + ' ' + (it.tags || []).join(' ')).toLowerCase(); return toks.every(k => t.includes(k)); });
  $('lpill').textContent = lib.tab === 'free' ? 'Free' : lib.key ? 'Private' : 'Locked'; $('lpill').className = 'pill ' + (lib.tab === 'free' || lib.key ? 'live' : 'off');
  document.querySelectorAll('#ltabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === lib.tab));
  if (lib.tab === 'private' && !lib.key) return;
  if (!items.length) { grid.append(el('div', 'sub', libItems().length ? 'Nothing matches that search.' : lib.tab === 'private' ? 'No top-down vehicles in your private library yet. Only top-down vehicles are shown.' : 'Loading…')); return; }
  if (lib.tab === 'free' && lib.freeCredit) $('l-note').textContent = 'Free sprites: ' + lib.freeCredit + ', CC0 (public domain).';
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); en.target._load(); } }), { root: null, rootMargin: '200px' }) : null;
  for (const it of items) {
    const b = el('button', 'sp'); b.type = 'button'; b.title = it.name; const im = new Image(); im.alt = it.name; im.className = 'spi'; b.append(im, el('span', 'spn', it.name));
    im._load = async () => { try { im.src = await spriteURL(it); } catch { im.alt = '!'; } };
    if (io) io.observe(im); else im._load();
    b.onclick = () => chooseSprite(it); grid.append(b);
  }
}
async function spriteURL(it) {      // free: plain URL. private: fetched with the key, shown from a blob (the key never appears in a URL)
  if (lib.tab === 'free') return FREE_BASE + it.file;
  if (lib.blobs.has(it.id)) return lib.blobs.get(it.id);
  const r = await fetch(PRIV_BASE + it.file, { headers: { 'x-wf-key': lib.key } }); if (!r.ok) throw new Error('HTTP ' + r.status);
  const u = URL.createObjectURL(await r.blob()); lib.blobs.set(it.id, u); return u;
}
function shrinkToDataURL(img, max = 128) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/png');
}
function useSprite(dataURL, rot) {
  av.img = dataURL; av.rot = !!rot; try { localStorage.setItem('wf-avatar-img', dataURL); localStorage.setItem('wf-avatar-rot', rot ? '1' : '0'); } catch {}
  setAvatar('custom');
}
async function chooseSprite(it) {
  const url = await spriteURL(it), img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => { if (lib.tab === 'free' || it.w && it.w <= 160 && it.h <= 160) useSprite(shrinkToDataURL(img), it.facing === 'up'); else openCrop(img, it.facing === 'up'); };
  img.src = url;
}
$('ltabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; lib.tab = b.dataset.tab; loadLib(); };
$('l-q').oninput = () => { lib.q = $('l-q').value; renderLib(); };
$('l-keysave').onclick = () => { lib.key = $('l-keyin').value.trim(); if (!lib.key) return; try { localStorage.setItem('wf-lib-key', lib.key); } catch {} lib.priv = null; $('l-keyin').value = ''; loadLib(); };
$('lbox').addEventListener('toggle', () => { if ($('lbox').open) loadLib(); });

/* cut one sprite out of a sheet: drag a box, optionally clear the background colour, then it is shrunk and kept in this browser */
const cr = { img: null, sel: null, key: null, scale: 1, drag: null };
function openCrop(img, up) {
  cr.img = img; cr.sel = null; cr.key = null; $('c-bg').checked = false; $('c-rot').checked = up; $('crop').hidden = false;
  const cv = $('c-cv'), maxW = Math.min(innerWidth - 40, 520), maxH = Math.round(innerHeight * 0.5); cr.scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 4);
  cv.width = Math.round(img.naturalWidth * cr.scale); cv.height = Math.round(img.naturalHeight * cr.scale); drawCrop();
}
function drawCrop() {
  const cv = $('c-cv'), x = cv.getContext('2d'); x.imageSmoothingEnabled = false; x.clearRect(0, 0, cv.width, cv.height); x.drawImage(cr.img, 0, 0, cv.width, cv.height);
  if (cr.sel) { const s = cr.sel; x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(0, 0, cv.width, cv.height); x.save(); x.beginPath(); x.rect(s.x, s.y, s.w, s.h); x.clip(); x.clearRect(s.x, s.y, s.w, s.h); x.drawImage(cr.img, 0, 0, cv.width, cv.height); x.restore(); x.strokeStyle = '#ffd400'; x.lineWidth = 2; x.strokeRect(s.x, s.y, s.w, s.h); }
}
const cpos = e => { const r = $('c-cv').getBoundingClientRect(); return [(e.clientX - r.left) * ($('c-cv').width / r.width), (e.clientY - r.top) * ($('c-cv').height / r.height)]; };
$('c-cv').addEventListener('pointerdown', e => {
  const [x, y] = cpos(e);
  if ($('c-bg').checked) { const c = document.createElement('canvas'); c.width = cr.img.naturalWidth; c.height = cr.img.naturalHeight; const g = c.getContext('2d'); g.drawImage(cr.img, 0, 0);
    const px = g.getImageData(Math.min(c.width - 1, Math.floor(x / cr.scale)), Math.min(c.height - 1, Math.floor(y / cr.scale)), 1, 1).data; cr.key = [px[0], px[1], px[2]]; $('c-bg').checked = false; $('l-note').textContent = ''; return; }
  cr.drag = [x, y]; cr.sel = { x, y, w: 0, h: 0 }; try { $('c-cv').setPointerCapture(e.pointerId); } catch {} });
$('c-cv').addEventListener('pointermove', e => { if (!cr.drag) return; const [x, y] = cpos(e); cr.sel = { x: Math.min(x, cr.drag[0]), y: Math.min(y, cr.drag[1]), w: Math.abs(x - cr.drag[0]), h: Math.abs(y - cr.drag[1]) }; drawCrop(); });
$('c-cv').addEventListener('pointerup', () => { cr.drag = null; });
function cutSprite(whole) {
  const s = whole || !cr.sel || cr.sel.w < 4 ? { x: 0, y: 0, w: $('c-cv').width, h: $('c-cv').height } : cr.sel, k = 1 / cr.scale;
  const sx = Math.round(s.x * k), sy = Math.round(s.y * k), sw = Math.max(1, Math.round(s.w * k)), sh = Math.max(1, Math.round(s.h * k));
  const c = document.createElement('canvas'); c.width = sw; c.height = sh; const g = c.getContext('2d'); g.drawImage(cr.img, sx, sy, sw, sh, 0, 0, sw, sh);
  const d = g.getImageData(0, 0, sw, sh), p = d.data, key = cr.key || (p[3] === 255 ? [p[0], p[1], p[2]] : null);     // default: the top-left pixel colour is the background if the sheet has no transparency
  if (cr.key || $('c-bg').dataset.auto === '1') for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - key[0]) + Math.abs(p[i + 1] - key[1]) + Math.abs(p[i + 2] - key[2]) < 40) p[i + 3] = 0;
  g.putImageData(d, 0, 0);
  let x0 = sw, y0 = sh, x1 = 0, y1 = 0; for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (p[(y * sw + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const t = document.createElement('canvas'); if (x1 >= x0) { t.width = x1 - x0 + 1; t.height = y1 - y0 + 1; t.getContext('2d').drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height); } else { t.width = sw; t.height = sh; t.getContext('2d').drawImage(c, 0, 0); }
  const im = new Image(); im.onload = () => { useSprite(shrinkToDataURL(im), $('c-rot').checked); $('crop').hidden = true; }; im.src = t.toDataURL('image/png');
}
$('c-use').onclick = () => cutSprite(false); $('c-whole').onclick = () => cutSprite(true); $('c-x').onclick = () => { $('crop').hidden = true; };

/* ---------- offline map: download Davidson County once, then it works without a connection ---------- */
const PACK_URL = new URL('data/davidson.pmtiles', location.href).href, PLACES_URL = new URL('data/places.json', location.href).href, MANIFEST_URL = new URL('data/manifest.json', location.href).href;
const OFF_CACHE = 'wayfinder-offline';
const off = { pack: null, layer: null, busy: false, use: false };
try { off.pack = JSON.parse(localStorage.getItem('wf-pack') || 'null'); off.use = localStorage.getItem('wf-pack-use') === '1'; } catch {}
const opill = (kind, label) => { const e = $('opill'); e.className = 'pill ' + kind; e.textContent = label; };
const mb = n => (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB';
function syncOfflineLayer() {      // the vector pack shows when there is no connection, or when you ask for it
  const want = !!off.pack && typeof protomapsL !== 'undefined' && (off.use || !navigator.onLine);
  if (want && !off.layer) { off.layer = protomapsL.leafletLayer({ url: PACK_URL, flavor: 'light', maxDataZoom: 15, attribution: '&copy; OpenStreetMap contributors, Protomaps (offline)' }); off.layer.addTo(map); }
  else if (!want && off.layer) { off.layer.remove(); off.layer = null; }
}
function paintOffline(msg, cls) {
  if (off.busy) return;
  const saved = !!off.pack;
  opill(saved ? 'live' : 'off', saved ? 'Saved' : 'Not saved');
  $('ostat').textContent = msg || (saved ? `Saved on this device: ${mb(off.pack.bytes)} map and ${off.pack.places.toLocaleString()} places (OpenStreetMap data from ${off.pack.build.replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3')}).` : 'Save Davidson County to this device so the map and search keep working without a connection.');
  $('ostat').className = cls || '';
  $('o-dl').hidden = saved; $('o-rm').hidden = !saved; $('obar').hidden = true; $('o-use').checked = off.use;
}
async function downloadPack() {
  if (off.busy) return; if (!('caches' in window)) return paintOffline('This browser cannot store offline files.', 'err');
  off.busy = true; $('o-dl').disabled = true; $('obar').hidden = false; $('ostat').className = ''; opill('learn', 'Saving');
  const bar = $('obar').firstElementChild, say = t => { $('ostat').textContent = t; };
  try {
    const man = await (await fetch(MANIFEST_URL, { cache: 'no-store' })).json(), mp = man['davidson.pmtiles'], ml = man['places.json'];
    say('Downloading the map…'); const r = await fetch(PACK_URL + '?download', { cache: 'no-store' }); if (!r.ok) throw new Error('map HTTP ' + r.status);
    const rd = r.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; bar.style.width = (100 * got / mp.bytes).toFixed(1) + '%'; opill('learn', Math.floor(100 * got / mp.bytes) + '%'); say(`Downloading the map… ${mb(got)} of ${mb(mp.bytes)}`); }
    const blob = new Blob(parts); if (blob.size !== mp.bytes) throw new Error(`map is ${blob.size} bytes, expected ${mp.bytes}`);
    let verified = false;
    if (window.crypto && crypto.subtle) { say('Checking the download…'); const h = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
      if ([...h].map(b => b.toString(16).padStart(2, '0')).join('') !== mp.sha256) throw new Error('map checksum does not match'); verified = true; }
    say('Downloading places…'); const pr = await fetch(PLACES_URL, { cache: 'no-store' }); if (!pr.ok) throw new Error('places HTTP ' + pr.status);
    const ptxt = await pr.text(), pd = JSON.parse(ptxt); if (!pd.items || pd.items.length !== ml.n) throw new Error('places list is incomplete');
    const c = await caches.open(OFF_CACHE);
    await c.put(PACK_URL, new Response(blob, { headers: { 'content-type': 'application/octet-stream' } }));
    await c.put(PLACES_URL, new Response(ptxt, { headers: { 'content-type': 'application/json' } }));
    off.pack = { build: mp.build, bytes: mp.bytes, places: ml.n, at: Date.now(), verified };
    try { localStorage.setItem('wf-pack', JSON.stringify(off.pack)); } catch {}
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
    try { navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage('pack-changed'); } catch {}
    setPlaces(pd); off.busy = false; syncOfflineLayer(); paintOffline();
  } catch (e) { off.busy = false; paintOffline('Download failed (' + e.message + '). Nothing was saved. Try again on a stronger connection.', 'err'); opill('err', 'Failed'); }
  $('o-dl').disabled = false;
}
async function removePack() {
  try { const c = await caches.open(OFF_CACHE); await c.delete(PACK_URL); await c.delete(PLACES_URL); } catch {}
  off.pack = null; try { localStorage.removeItem('wf-pack'); } catch {}
  try { navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage('pack-changed'); } catch {}
  setPlaces(null); syncOfflineLayer(); paintOffline();
}
async function initOffline() {
  if (off.pack && 'caches' in window) {      // the browser can evict stored files, so confirm they are still there
    try { const c = await caches.open(OFF_CACHE), p = await c.match(PACK_URL), pl = await c.match(PLACES_URL);
      if (!p || !pl) { off.pack = null; localStorage.removeItem('wf-pack'); } else setPlaces(await pl.json()); } catch {}
  }
  paintOffline(); syncOfflineLayer();
}
$('o-dl').onclick = downloadPack; $('o-rm').onclick = removePack;
$('o-use').onchange = () => { off.use = $('o-use').checked; try { localStorage.setItem('wf-pack-use', off.use ? '1' : '0'); } catch {} syncOfflineLayer(); };
window.addEventListener('online', syncOfflineLayer); window.addEventListener('offline', syncOfflineLayer);
initOffline();

/* ---------- location permission: ask only after a tap, and say how to fix a block ---------- */
function showLocHelp(on) {
  const box = $('lochelp'); box.hidden = !on; if (!on) return;
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua), android = /Android/.test(ua);
  $('lochelp-why').textContent = ios ? 'Turn location on for Safari (or this app) in Settings' : android ? 'Allow location for your browser, then reload' : 'Allow location for this site';
  const steps = ios ? ['Open Settings > Privacy & Security > Location Services and make sure it is On.', 'Scroll to Safari Websites (or Wayfinder if you added it to the Home Screen) and choose While Using the App or Ask Next Time.', 'In Safari, tap the aA button > Website Settings > Location > Allow, then come back and tap Try again.']
    : android ? ['Pull down Quick Settings and make sure Location is on.', 'Settings > Apps > your browser (Vanadium on GrapheneOS) > Permissions > Location: Allow only while using the app, and turn on Use precise location.', 'In the browser, tap the lock icon in the address bar > Permissions > Location > Allow, then tap Try again.', 'GrapheneOS has no Google network location, so the first GPS fix can take a minute outdoors.']
    : ['Click the lock icon in the address bar, set Location to Allow, then tap Try again.'];
  $('lochelp-steps').replaceChildren(...steps.map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
}
$('lochelp-retry').onclick = () => { showLocHelp(false); locate(); };
$('usegps').onclick = () => locate();
async function permState() { try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return null; } }
// Browsers often hide or auto-deny a location prompt that appears with no tap. So on a phone we only start by ourselves when permission is already granted;
// otherwise the "Use my location" button (a real tap) asks. Desktop, and browsers that cannot report the state, still try straight away.
async function initLocation() {
  const s = await permState();
  if (s === 'granted' || (s === null && !isMob())) locate();
  else if (s === 'denied') { status('Location is blocked for this site. You can still type a start place.', 'err'); showLocHelp(true); }
  else status('Tap "Use my location" to find where you are, or type a start place.');
  try { const p = await navigator.permissions.query({ name: 'geolocation' }); p.onchange = () => { if (p.state === 'granted') { showLocHelp(false); locate(); } }; } catch {}
}

/* ---------- share my location: a public link (8 hours at most) and permanent connections with people you pair with ---------- */
// The server only sees positions you send with the key made for each stream, keeps them in memory, and wipes them when the stream ends.
// One GPS watch feeds every stream I am sending (my public link and each connected person). In the Android app (window.WayfinderNative) a foreground
// service sends even with the screen off; in a browser the page sends while it is open.
const share = { on: false, token: null, key: null, until: 0, link: '' };
const senders = new Map();                                   // token -> { key, until, onGone }
const tx = { wid: null, lock: null, poll: null, paused: false, lastOk: 0, err: '' };
const nat = () => window.WayfinderNative || null;
const spill = (k, t) => { const e = $('spill'); e.className = 'pill ' + k; e.textContent = t; };
const hm = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const hmDay = ms => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
function paintShare() {
  $('s-go').hidden = share.on; $('s-len').hidden = share.on; $('s-stop').hidden = !share.on; $('s-ext').hidden = !share.on; $('slink').hidden = !share.on;
  if (!share.on) { spill(senders.size ? 'live' : 'off', senders.size ? 'People' : 'Off'); if (!$('sstat').dataset.keep) $('sstat').textContent = 'Send anyone a link that shows where you are on a map. It stops after the time you choose, 8 hours at most.'; if (typeof paintPeople === 'function') paintPeople(); return; }
  $('s-url').value = share.link; $('s-ext').disabled = share.until >= share.start + 8 * 3600000 - 1000;
  const age = tx.lastOk ? Math.round((Date.now() - tx.lastOk) / 1000) : null;
  if (tx.err) { spill('err', 'Problem'); $('sstat').textContent = tx.err; }
  else if (tx.paused) { spill('warn', 'Paused'); $('sstat').textContent = 'Paused while this page is hidden or the screen is off. Open it again to resume, or use the Android app to keep sending.'; }
  else if (age == null) { spill('learn', 'Starting'); $('sstat').textContent = nat() ? 'Waiting for the first GPS fix…' : 'Waiting for your first position…'; }
  else { spill('live', 'Sharing'); $('sstat').textContent = `Anyone with the link can see you until ${hm(share.until)}. Last sent ${age < 5 ? 'just now' : age + ' s ago'}${nat() ? ' (keeps going with the screen off)' : ''}.`; }
  $('sstat').dataset.keep = '';
  if (typeof paintPeople === 'function') paintPeople();
}
async function sendAll(p) {
  for (const [token, s] of [...senders]) {
    try {
      const r = await fetch(RELAY + 'share/' + token, { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json', 'x-share-key': s.key }, body: JSON.stringify(p) });
      if (r.status === 404) { dropSender(token, true); continue; } if (!r.ok) throw new Error('HTTP ' + r.status);
      tx.lastOk = Date.now(); tx.err = '';
    } catch (e) { tx.err = 'Could not send your position (' + e.message + '). Trying again.'; }
  }
  paintShare();
}
function webWatch() {
  if (tx.wid != null) return; if (!navigator.geolocation) { tx.err = 'This browser has no location support.'; return paintShare(); }
  let last = 0;
  tx.wid = navigator.geolocation.watchPosition(p => { const t = Date.now(); if (t - last < 3000) return; last = t; tx.paused = false;
    sendAll({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading }); },
    e => { tx.err = e.code === 1 ? 'Location is blocked for this site, so nothing can be shared. Allow it in your browser settings.' : 'GPS problem: ' + e.message; paintShare(); },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 60000 });
  try { navigator.wakeLock.request('screen').then(l => { tx.lock = l; }).catch(() => {}); } catch {}
}
function ensureTx() {
  if (!nat()) webWatch();
  if (tx.poll) return;
  tx.poll = setInterval(() => {
    for (const [token, s] of [...senders]) if (Date.now() >= s.until) dropSender(token, true);
    if (nat()) { try { const s = JSON.parse(nat().status()); if (s.lastOk) tx.lastOk = s.lastOk; tx.err = s.error || ''; } catch {} }
    else tx.paused = document.hidden; paintShare();
  }, 2000);
}
function addSender(token, key, until, onGone) {
  senders.set(token, { key, until, onGone });
  if (nat()) { try { nat().startShare(RELAY, token, key, until); } catch (e) { tx.err = 'The Android app could not start sharing (' + e.message + ').'; } }
  ensureTx(); paintShare();
}
function dropSender(token, gone) {
  const s = senders.get(token); senders.delete(token); try { nat() && nat().stopShare(token); } catch {}
  if (gone && s && s.onGone) s.onGone();
  if (!senders.size) { if (tx.wid != null) { try { navigator.geolocation.clearWatch(tx.wid); } catch {} tx.wid = null; } clearInterval(tx.poll); tx.poll = null; try { tx.lock && tx.lock.release(); } catch {} tx.lock = null; tx.err = ''; tx.lastOk = 0; }
  paintShare();
}
async function startShare() {
  if (share.on) return; $('s-go').disabled = true; $('sstat').textContent = 'Creating your link…'; $('sstat').dataset.keep = '1';
  try {
    const r = await fetch(RELAY + 'share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ minutes: +$('s-min').value }) });
    if (!r.ok) throw new Error(r.status === 429 ? 'Too many links were started recently. Try again in a few minutes' : r.status === 503 ? 'The share server is full right now' : 'HTTP ' + r.status);
    const c = await r.json();
    Object.assign(share, { on: true, token: c.token, key: c.key, until: c.until, start: Date.now(), link: new URL('live.html', location.href).href + '#t=' + c.token });
    try { localStorage.setItem('wf-share', JSON.stringify({ token: c.token, key: c.key, until: c.until, start: share.start })); } catch {}
    addSender(c.token, c.key, c.until, () => stopShare(true, 'Sharing finished: the link expired.'));
  } catch (e) { $('sstat').textContent = 'Could not start sharing: ' + e.message + '.'; $('sstat').dataset.keep = '1'; }
  $('s-go').disabled = false;
}
function stopShare(local, msg) {
  const was = { ...share }; Object.assign(share, { on: false, token: null, key: null }); try { localStorage.removeItem('wf-share'); } catch {}
  if (was.token) { senders.delete(was.token); dropSender(was.token, false); }
  if (was.on && !local) fetch(RELAY + 'share/' + was.token, { method: 'DELETE', headers: { 'x-share-key': was.key }, keepalive: true }).catch(() => {});
  if (msg) { $('sstat').textContent = msg; $('sstat').dataset.keep = '1'; } else $('sstat').dataset.keep = ''; paintShare();
}
async function extendShare() {   // more time, but never past 8 hours from when the link started
  if (!share.on) return;
  try { const r = await fetch(RELAY + 'share/' + share.token + '/extend', { method: 'POST', headers: { 'content-type': 'application/json', 'x-share-key': share.key }, body: JSON.stringify({ minutes: 60 }) });
    if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); share.until = j.until; const s = senders.get(share.token); if (s) s.until = j.until;
    try { localStorage.setItem('wf-share', JSON.stringify({ token: share.token, key: share.key, until: share.until, start: share.start })); } catch {}
    $('sstat').textContent = j.until >= j.endsBy - 1000 ? `Extended to the 8 hour limit (${hm(j.until)}).` : `Extended to ${hm(j.until)}.`; $('sstat').dataset.keep = '1'; setTimeout(() => { $('sstat').dataset.keep = ''; paintShare(); }, 3000);
  } catch (e) { $('sstat').textContent = 'Could not extend (' + e.message + ').'; $('sstat').dataset.keep = '1'; }
  paintShare();
}
async function copyLink() { try { await navigator.clipboard.writeText(share.link); $('s-copy').lastChild.textContent = ' Copied'; setTimeout(() => { $('s-copy').lastChild.textContent = ' Copy'; }, 1500); } catch { $('s-url').select(); } }
async function sendLink() {
  const data = { title: 'My live location', text: `Follow my live location on a map (works until ${hm(share.until)}):`, url: share.link };
  if (navigator.share) { try { await navigator.share(data); } catch {} } else copyLink();
}
$('s-go').onclick = startShare; armTap($('s-stop'), () => stopShare(false)); $('s-ext').onclick = extendShare; $('s-copy').onclick = copyLink; $('s-send').onclick = sendLink; $('s-url').onfocus = () => $('s-url').select();
document.addEventListener('visibilitychange', () => { if (senders.size && !nat()) { tx.paused = document.hidden; paintShare(); if (!document.hidden) { try { navigator.wakeLock.request('screen').then(l => { tx.lock = l; }).catch(() => {}); } catch {} } } });
try { const s = JSON.parse(localStorage.getItem('wf-share') || 'null');
  if (s && s.until > Date.now()) { Object.assign(share, { on: true, token: s.token, key: s.key, until: s.until, start: s.start || Date.now(), link: new URL('live.html', location.href).href + '#t=' + s.token }); addSender(s.token, s.key, s.until, () => stopShare(true, 'Sharing finished: the link expired.')); }
  else localStorage.removeItem('wf-share'); } catch {}
paintShare();

/* ---------- wiring ---------- */
map.on('click', async e => {
  const ll = [e.latlng.lat, e.latlng.lng]; setDest(ll); $('to').value = 'Dropped pin'; if (start) route();
  const n = await reverseName(ll); if (n && dest && dest[0] === ll[0]) $('to').value = n;
});
$('locate').onclick = locate; $('go').onclick = route;
$('swap').onclick = () => {
  [start, dest] = [dest, start]; const f = $('from').value; $('from').value = $('to').value; $('to').value = f;
  if (startMk) { startMk.remove(); startMk = null; } if (destMk) { destMk.remove(); destMk = null; }
  if (start) setStart(start); if (dest) setDest(dest); if (start && dest) route();
};
function paintModes() { [...$('modes').children].forEach(x => x.classList.toggle('on', x.dataset.m === mode)); }
$('modes').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
  mode = b.dataset.m; try { localStorage.setItem('wf-mode', mode); } catch {} paintModes(); if (start && dest) route(); });
paintModes(); startTrafficTimer(); loadTraffic(); initLocation();

// the Android app download link shows in browsers, not inside the app itself
try { if (!window.WayfinderNative && /android/i.test(navigator.userAgent)) $('apklink').hidden = false; } catch {}
