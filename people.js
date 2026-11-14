/* People: permanent connections made by trading a one-time code (no accounts). Loaded after app.js and uses its helpers.
   - Make a code, or enter one. The two phones each get a private key that only that phone keeps.
   - Each person can switch on "share my location with <name>" and switch it off any time. Positions travel through the live-sharing relay and are held
     in memory only; the server stores only the connection (hashed keys and the two names), never where anyone was.
   - "Show on map" follows a person while they are sharing with you. Removing a connection removes it for both sides. */

const people = { list: [], pairing: null, watch: new Map(), infoTimer: null };
try { people.list = (JSON.parse(localStorage.getItem('wf-people') || '[]') || []).filter(p => p && p.id && p.key); } catch {}
const savePeople = () => { try { localStorage.setItem('wf-people', JSON.stringify(people.list.map(p => ({ id: p.id, key: p.key, name: p.name, share: p.share || null, want: !!p.want, nick: p.nick || '' })))); } catch {} };
try { $('p-me').value = localStorage.getItem('wf-myname') || ''; } catch {}
const pnote = (m, cls) => { const e = $('p-note'); e.textContent = m || ''; e.className = 'note' + (cls ? ' ' + cls : ''); };
async function rel(method, path, body, headers) {
  const r = await fetch(RELAY + path, { method, headers: { 'content-type': 'application/json', ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error((j && j.error) || 'HTTP ' + r.status); e.status = r.status; throw e; } return j;
}
const ck = p => ({ 'x-conn-key': p.key });
const nickOf = () => $('p-nick').value.trim().slice(0, 30);
const label = p => p.nick || p.name || 'Friend';
const myName = () => { const n = $('p-me').value.trim().slice(0, 30); try { localStorage.setItem('wf-myname', n); } catch {} return n; };

/* ---------- making or entering a code ---------- */
let waitTimer = null;
function resetPairing() { clearInterval(waitTimer); waitTimer = null; people.pairing = null; $('p-code').hidden = true; $('p-join').hidden = true; $('p-start').hidden = false; }
$('p-make').onclick = async () => {
  pnote(''); if (!myName()) return pnote('Type your name first so they know who you are.', 'err');
  if (!nickOf()) return pnote('Give them a nickname first, so you can tell who is who. Only you see it.', 'err');
  try {
    const c = await rel('POST', 'pair/new', { name: myName() }); people.pairing = { ...c, nick: nickOf() }; $('p-start').hidden = true; $('p-code').hidden = false; $('p-code-text').textContent = c.code;
    const left = () => Math.max(0, Math.round((c.until - Date.now()) / 60000)); $('p-code-sub').textContent = `Tell them this code in person or in a message. It works once and expires in ${left()} minutes.`;
    waitTimer = setInterval(async () => {
      if (Date.now() > c.until) { resetPairing(); return pnote('The code expired. Make a new one.', 'err'); }
      try { const w = await rel('GET', 'pair/wait/' + c.pairId, null, { 'x-pair-secret': c.secret });
        if (w.status === 'done') { resetPairing(); addPerson({ id: w.connId, key: w.key, name: w.peerName || 'Friend', nick: c.nick || nickOf() }); pnote(`Connected with ${c.nick || w.peerName || 'your friend'}.`); } else $('p-code-sub').textContent = `Waiting for them to enter it. Expires in ${left()} minutes.`;
      } catch (e) { if (e.status === 404) { resetPairing(); pnote('The code expired. Make a new one.', 'err'); } }
    }, 2000);
  } catch (e) { pnote('Could not make a code (' + e.message + ').', 'err'); }
};
$('p-enter').onclick = () => { pnote(''); if (!myName()) return pnote('Type your name first so they know who you are.', 'err'); if (!nickOf()) return pnote('Give them a nickname first, so you can tell who is who. Only you see it.', 'err'); $('p-start').hidden = true; $('p-join').hidden = false; $('p-join-code').value = ''; $('p-join-code').focus(); };
$('p-code-cancel').onclick = () => { resetPairing(); pnote(''); }; $('p-join-cancel').onclick = () => { resetPairing(); pnote(''); };
$('p-join-code').oninput = () => { const v = $('p-join-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); $('p-join-code').value = v.length > 4 ? v.slice(0, 4) + '-' + v.slice(4) : v; };
$('p-join-go').onclick = async () => {
  pnote(''); $('p-join-go').disabled = true;
  try { const j = await rel('POST', 'pair/join', { code: $('p-join-code').value, name: myName() }); resetPairing(); addPerson({ id: j.connId, key: j.key, name: j.peerName || 'Friend', nick: nickOf() }); pnote(`Connected with ${nickOf()}.`); }
  catch (e) { pnote(e.status === 404 ? 'That code is not valid or has expired. Check it and try again.' : e.status === 429 ? 'Too many wrong tries. Wait a minute.' : 'Could not connect (' + e.message + ').', 'err'); }
  $('p-join-go').disabled = false;
};
function addPerson(p) { if (people.list.some(x => x.id === p.id)) return; const np = { ...p, share: null, want: false, info: null }; people.list.push(np); savePeople(); paintPeople(); refreshInfo(); if (window.pfVault) window.pfVault.putConn(np); }

/* ---------- sharing with a person, and watching them ---------- */
async function startShareTo(p) {
  try {
    const s = await rel('POST', `conn/${p.id}/share`, {}, ck(p)); p.share = { token: s.token, key: s.key, until: s.until }; p.want = true; savePeople();
    addSender(s.token, s.key, s.until, () => { p.share = null; if (p.want) setTimeout(() => startShareTo(p), 1500); paintPeople(); });   // a quiet session ends by itself; start a fresh one while you still want to share
  } catch (e) { p.want = false; p.err = e.status === 404 ? 'This connection was removed.' : 'Could not start sharing (' + e.message + ').'; if (e.status === 404) dropPerson(p); }
  savePeople(); paintPeople();
}
async function stopShareTo(p) {
  p.want = false; const s = p.share; p.share = null; savePeople(); if (s) dropSender(s.token, false);
  try { await rel('DELETE', `conn/${p.id}/share`, null, ck(p)); } catch {} paintPeople();
}
function dropPerson(p) { if (window.pfVault) window.pfVault.delConn(p.id); stopWatching(p); if (p.share) dropSender(p.share.token, false); people.list = people.list.filter(x => x.id !== p.id); savePeople(); paintPeople(); }
async function removePerson(p) { try { await rel('DELETE', `conn/${p.id}`, null, ck(p)); } catch (e) { if (e.status !== 404) { p.err = 'Could not remove (' + e.message + ').'; return paintPeople(); } } dropPerson(p); }
function startWatching(p) {
  const w = { marker: null, line: null, fitted: false, timer: null, text: 'looking…' }; people.watch.set(p.id, w);
  const tick = async () => {
    try { const v = await rel('GET', `conn/${p.id}/peer`, null, ck(p));
      if (!v.active || !v.last) { w.text = 'is not sharing right now'; if (w.marker) { w.marker.remove(); w.marker = null; } if (w.line) { w.line.remove(); w.line = null; } paintWatchbar(); paintPeople(); return; }
      const ll = [v.last.lat, v.last.lon], age = Math.round((v.now - v.last.t) / 1000);
      if (!w.marker) { const d = document.createElement('div'); d.className = 'friend'; d.textContent = label(p).slice(0, 1).toUpperCase(); w.marker = L.marker(ll, { icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: d }), zIndexOffset: 800, title: label(p) }).addTo(map); } else w.marker.setLatLng(ll);
      const tr = (v.trail || []).map(x => [x[0], x[1]]); if (tr.length > 1) { if (!w.line) w.line = L.polyline(tr, { color: '#7a3cbe', weight: 4, opacity: .6 }).addTo(map); else w.line.setLatLngs(tr); }
      if (!w.fitted) { w.fitted = true; map.setView(ll, 16); if (isMob()) setSheet('peek'); }
      w.text = (age > 45 ? 'last seen ' : 'live, ') + (age < 5 ? 'just now' : age + ' s ago') + (v.last.speed > 0.8 ? ` · ${Math.round(v.last.speed * 2.237)} mph` : ''); paintWatchbar();
    } catch (e) { if (e.status === 404) { w.text = 'connection removed'; dropPerson(p); } else w.text = 'could not be reached (' + e.message + ')'; }
    paintPeople();
  };
  tick(); w.timer = setInterval(tick, 4000); paintWatchbar();
}
function stopWatching(p) { const w = people.watch.get(p.id); if (!w) return; clearInterval(w.timer); if (w.marker) w.marker.remove(); if (w.line) w.line.remove(); people.watch.delete(p.id); paintWatchbar(); paintPeople(); }
function paintWatchbar() {
  const bar = $('watchbar'); bar.replaceChildren(); bar.hidden = !people.watch.size;
  for (const [id, w] of people.watch) { const p = people.list.find(x => x.id === id); if (!p) continue;
    const c = document.createElement('div'); c.className = 'chip'; const t = document.createElement('span'); t.textContent = `${label(p)} ${w.text}`;
    const b = document.createElement('button'); b.textContent = 'Hide'; b.onclick = () => stopWatching(p); c.append(t, b); bar.append(c); }
}
async function refreshInfo() {
  for (const p of [...people.list]) { try { p.info = await rel('GET', `conn/${p.id}`, null, ck(p)); if (p.info.peerName && p.info.peerName !== p.name) { p.name = p.info.peerName; savePeople(); } p.err = ''; }
    catch (e) { if (e.status === 404) { p.err = ''; dropPerson(p); } } }
  paintPeople();
}

/* ---------- list ---------- */
function paintPeople() {
  const box = $('p-list'); if (!box) return; box.replaceChildren();
  const sharing = people.list.filter(p => p.info && p.info.peerSharing).length;
  $('ppill').className = 'pill ' + (sharing ? 'live' : people.list.length ? 'warn' : 'off'); $('ppill').textContent = sharing ? sharing + ' sharing' : people.list.length ? people.list.length + (people.list.length === 1 ? ' person' : ' people') : 'None';
  if (!people.list.length) { box.append(Object.assign(document.createElement('div'), { className: 'sub', textContent: 'No one connected yet.' })); return; }
  for (const p of people.list) {
    const row = document.createElement('div'); row.className = 'person'; const nm = label(p);
    const head = document.createElement('div'); head.className = 'ph'; const n = document.createElement('span'); n.className = 'pn'; n.textContent = nm; head.append(n);
    const ren = document.createElement('button'); ren.textContent = 'Rename'; ren.className = 'ren';
    ren.onclick = () => { const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 30; inp.value = nm; inp.setAttribute('aria-label', 'Nickname'); const ok = document.createElement('button'); ok.textContent = 'Save';
      const save = () => { const v = inp.value.trim().slice(0, 30); if (v) { p.nick = v; savePeople(); if (window.pfVault) window.pfVault.putConn(p); } paintPeople(); }; ok.onclick = save; inp.onkeydown = e => { if (e.key === 'Enter') save(); };
      head.replaceChildren(inp, ok); inp.focus(); };
    head.append(ren);
    const who = document.createElement('div'); who.className = 'ps'; if (p.name && p.name.toLowerCase() !== nm.toLowerCase()) who.textContent = `They call themselves ${p.name}`;
    const st = document.createElement('div'), w = people.watch.get(p.id), live = p.info && p.info.peerSharing; st.className = 'ps' + (live ? ' live' : '');
    st.textContent = p.err || (w ? `${nm} ${w.text}` : live ? `${nm} is sharing with you` : `${nm} is not sharing with you right now`);
    const sw = document.createElement('label'); sw.className = 'switch'; const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!p.want; const sl = document.createElement('span'); sl.className = 'sl'; const tx2 = document.createElement('span'); tx2.textContent = `Share my location with ${nm}`;
    sw.append(cb, sl, tx2); cb.onchange = () => cb.checked ? startShareTo(p) : stopShareTo(p);
    const btns = document.createElement('div'); btns.className = 'row';
    const show = document.createElement('button'); show.textContent = w ? 'Hide on map' : 'Show on map'; show.onclick = () => w ? stopWatching(p) : startWatching(p);
    const rm = document.createElement('button'); rm.textContent = 'Remove'; let armed = 0;
    rm.onclick = () => { if (armed) return removePerson(p); armed = 1; rm.classList.add('armed'); rm.textContent = 'Are you sure?'; setTimeout(() => { armed = 0; rm.classList.remove('armed'); rm.textContent = 'Remove'; }, 3000); };
    btns.append(show, rm); row.append(head, ...(who.textContent ? [who] : []), st, sw, btns); box.append(row);
  }
}
// resume sharing with anyone you had switched on, then keep the "is sharing with you" lights fresh
for (const p of people.list) if (p.want) { if (p.share && p.share.until > Date.now()) addSender(p.share.token, p.share.key, p.share.until, () => { p.share = null; if (p.want) setTimeout(() => startShareTo(p), 1500); }); else startShareTo(p); }
paintPeople(); refreshInfo(); people.infoTimer = setInterval(refreshInfo, 20000);
