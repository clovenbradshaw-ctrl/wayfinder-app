/* Wayfinder device vault. Loaded after people.js.
   Each device quietly gets its own user on hyphae.social (a Matrix server) the first time it needs somewhere to keep something secret, and its own private "main room".
   What goes in the room (your connections and the nicknames you gave them) is encrypted ON THIS DEVICE with a key that never leaves it, before it is sent. The server
   holds ciphertext only. This is the app's own AES-256-GCM, not Matrix's Megolm, so other Matrix apps cannot read it either.
   An email is optional and only for recovery: it is attached to the device's user, and a copy of the device's login and data key, locked by a recovery passphrase that only
   you know, is stored beside it. On a new phone you prove you own the email, enter the passphrase, and get your nicknames and connections back. */

const HS = (() => { try { return (localStorage.getItem('wf-hs') || 'https://hyphae.social').replace(/\/$/, ''); } catch { return 'https://hyphae.social'; } })();
const dev = { user: null, pass: null, token: null, device: null, dk: null, room: null, email: null };
try { const d = JSON.parse(localStorage.getItem('wf-dev') || 'null'); if (d && d.token && d.user) Object.assign(dev, d); } catch {}
const saveDev = () => { try { localStorage.setItem('wf-dev', JSON.stringify(dev)); } catch {} };
const U8 = s => new TextEncoder().encode(s);
const b64u = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const rnd = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
const vstat = { note: '', busy: false };

async function mx(method, path, body, token) {
  const r = await fetch(HS + '/_matrix/client/v3' + path, { method, headers: { 'content-type': 'application/json', ...(token !== false && (token || dev.token) ? { authorization: 'Bearer ' + (token || dev.token) } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error((j && j.error) || 'HTTP ' + r.status); e.status = r.status; e.errcode = j && j.errcode; e.data = j; throw e; }
  return j;
}

/* ---------- the device's own user ---------- */
let devPromise = null;
function ensureDevice() {
  if (dev.token) return Promise.resolve(dev);
  if (devPromise) return devPromise;
  devPromise = (async () => {
    let session = null;
    try { await mx('POST', '/register', {}, false); } catch (e) { if (e.status === 401 && e.data && e.data.session) session = e.data.session; else throw e; }
    if (!session) throw new Error('The server did not offer sign-up.');
    const username = 'pf-' + [...crypto.getRandomValues(new Uint8Array(16))].map(b => 'abcdefghijklmnopqrstuvwxyz234567'[b % 32]).join(''), pass = rnd(24);
    const j = await mx('POST', '/register', { username, password: pass, initial_device_display_name: 'Wayfinder', auth: { type: 'm.login.dummy', session } }, false);
    Object.assign(dev, { user: j.user_id, pass, token: j.access_token, device: j.device_id, dk: rnd(32), room: null }); saveDev(); return dev;
  })().finally(() => { devPromise = null; });
  return devPromise;
}
const acctData = type => `/user/${encodeURIComponent(dev.user)}/account_data/${type}`;
async function ensureRoom() {
  if (dev.room) return dev.room;
  try { const d = await mx('GET', acctData('app.pathfinder.main_room')); if (d && d.room_id) { dev.room = d.room_id; saveDev(); return dev.room; } } catch (e) { if (e.status !== 404) throw e; }
  const r = await mx('POST', '/createRoom', { preset: 'private_chat', visibility: 'private', name: 'Wayfinder device (encrypted by the app)', topic: 'Private to one device. Everything here is encrypted on the device. Do not invite anyone.',
    initial_state: [{ type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'invited' } }] });
  dev.room = r.room_id; saveDev(); await mx('PUT', acctData('app.pathfinder.main_room'), { room_id: dev.room }); return dev.room;
}

/* ---------- encrypted records ---------- */
const keyCache = new Map();
async function aesKey(dkB64, usage) { const k = dkB64 + usage; if (!keyCache.has(k)) keyCache.set(k, await crypto.subtle.importKey('raw', unb64u(dkB64), 'AES-GCM', false, ['encrypt', 'decrypt'])); return keyCache.get(k); }
async function seal(obj, aad, dk) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: U8(aad) }, await aesKey(dk || dev.dk, 'k'), U8(JSON.stringify(obj))); return { iv: b64u(iv), ct: b64u(new Uint8Array(ct)) }; }
async function unseal(p, aad, dk) { const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(p.iv), additionalData: U8(aad) }, await aesKey(dk || dev.dk, 'k'), unb64u(p.ct)); return JSON.parse(new TextDecoder().decode(pt)); }
const queueRead = () => { try { return JSON.parse(localStorage.getItem('wf-vq') || '[]'); } catch { return []; } };
const queueWrite = q => { try { localStorage.setItem('wf-vq', JSON.stringify(q.slice(-100))); } catch {} };
async function sendRec(content, txn) { const room = await ensureRoom(); return mx('PUT', `/rooms/${encodeURIComponent(room)}/send/m.room.message/${txn}`, content); }
async function putRec(rec) {      // rec: { k, id, ..., t }. Encrypted first; only ciphertext is sent or queued.
  await ensureDevice(); rec.t = rec.t || Date.now();
  const p = await seal(rec, 'rec:' + dev.user), content = { msgtype: 'm.notice', body: 'Wayfinder (encrypted)', 'app.pathfinder.rec': { v: 1, ...p } }, txn = 'pf' + rnd(9);
  try { await sendRec(content, txn); } catch (e) { if (e.status >= 400 && e.status < 500 && e.status !== 429) throw e; queueWrite([...queueRead(), { txn, content, user: dev.user }]); }
}
async function flushQueue() { const all = queueRead(), mine = all.filter(x => x.user === dev.user), rest = all.filter(x => x.user !== dev.user), left = []; if (!mine.length) return;
  for (const it of mine) { try { await sendRec(it.content, it.txn); } catch { left.push(it); } } queueWrite([...rest, ...left]); }
async function loadRecs() {          // read the room newest-first and keep the latest record per thing
  if (!dev.token) return new Map(); const room = await ensureRoom(), latest = new Map(); let from = null;
  for (let page = 0; page < 10; page++) {
    const r = await mx('GET', `/rooms/${encodeURIComponent(room)}/messages?dir=b&limit=100${from ? '&from=' + encodeURIComponent(from) : ''}&filter=${encodeURIComponent(JSON.stringify({ types: ['m.room.message'], senders: [dev.user] }))}`);
    for (const ev of r.chunk || []) { const p = ev.content && ev.content['app.pathfinder.rec']; if (!p || ev.sender !== dev.user) continue;
      try { const rec = await unseal(p, 'rec:' + dev.user); const k = rec.k + ':' + rec.id; const cur = latest.get(k); if (!cur || rec.t > cur.t) latest.set(k, rec); } catch {} }
    if (!r.end || !(r.chunk || []).length) break; from = r.end;
  }
  return latest;
}

/* ---------- what people.js calls ---------- */
window.pfVault = {
  ready: () => !!dev.token,
  async putConn(p, first) {      // a connection (with its nickname) was added or changed
    try {
      const fresh = !dev.token; await ensureDevice();
      if (fresh && !first) for (const o of people.list) if (o.id !== p.id) await putRec({ k: 'conn', id: o.id, key: o.key, name: o.name, nick: o.nick || '' });   // the first time, back up what already exists
      await putRec({ k: 'conn', id: p.id, key: p.key, name: p.name, nick: p.nick || '' }); p.rt = Date.now(); vstat.note = ''; paintVault();
    } catch (e) { vstat.note = 'Could not save to your secure space (' + e.message + '). It stays on this phone and will be tried again.'; paintVault(); }
  },
  async putLearn(trip) { if (!dev.token) return; try { await putRec({ k: 'trip', ...trip }); } catch {} },          // a driven trip (junction keys, prompts, outcomes), encrypted like everything else here; only with an account
  async resetLearn(at) { if (!dev.token) return; try { await putRec({ k: 'learnreset', id: 'r', at, t: at }); } catch {} },
  async delConn(id) { if (!dev.token) return; try { await putRec({ k: 'conn', id, del: true }); } catch {} },
  async sync() {                   // merge what the server has into this phone
    if (!dev.token) return; try { await flushQueue(); const recs = await loadRecs(); let changed = false;
      for (const rec of recs.values()) { if (rec.k !== 'conn') continue; const i = people.list.findIndex(x => x.id === rec.id);
        if (rec.del) { if (i >= 0 && !(people.list[i].rt > rec.t)) { people.list.splice(i, 1); changed = true; } continue; }
        if (i < 0) { people.list.push({ id: rec.id, key: rec.key, name: rec.name || 'Friend', nick: rec.nick || '', share: null, want: false, info: null, rt: rec.t }); changed = true; }
        else if (!(people.list[i].rt >= rec.t) && rec.nick && rec.nick !== people.list[i].nick) { people.list[i].nick = rec.nick; people.list[i].rt = rec.t; changed = true; } }
      if (typeof qlog !== 'undefined') {            // the learning log: trips from the room, a reset if there was one, and back up local trips the room has not seen
        const remote = [...recs.values()].filter(r => r.k === 'trip'), reset = [...recs.values()].find(r => r.k === 'learnreset'), have = new Set(remote.map(r => r.id)), local = qlog.load();
        qlog.merge(remote.map(({ k, ...t }) => t), reset ? reset.at : 0);
        for (const t of local.trips.slice(-100)) if (!have.has(t.id) && t.t > (reset ? reset.at : 0)) await putRec({ k: 'trip', ...t });
      }
      if (changed) { savePeople(); paintPeople(); } vstat.note = ''; } catch (e) { vstat.note = 'Could not reach your secure space (' + e.message + ').'; } paintVault();
  }
};

/* ---------- recovery by email ---------- */
async function wrapKey(pass, salt, iter) { const base = await crypto.subtle.importKey('raw', U8(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
async function wrapBlob(pass, obj) { const salt = crypto.getRandomValues(new Uint8Array(16)), iter = 310000, iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(pass, salt, iter), U8(JSON.stringify(obj))); return { v: 1, kdf: 'PBKDF2-SHA256', iter, salt: b64u(salt), iv: b64u(iv), ct: b64u(new Uint8Array(ct)) }; }
async function unwrapBlob(pass, b) { try { const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(b.iv) }, await wrapKey(pass, unb64u(b.salt), b.iter), unb64u(b.ct)); return JSON.parse(new TextDecoder().decode(pt)); } catch { throw new Error('That recovery passphrase does not open it.'); } }
const rec1 = { secret: null, sid: null, email: null, pass: null, session: null };
async function recoverySend(email, passphrase) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.'); if (passphrase.length < 10) throw new Error('Use a recovery passphrase of at least 10 characters.');
  await ensureDevice(); Object.assign(rec1, { secret: rnd(18), email, pass: passphrase, sid: null, session: null });
  const t = await mx('POST', '/account/3pid/email/requestToken', { client_secret: rec1.secret, email, send_attempt: 1 }); rec1.sid = t.sid;
}
async function recoveryFinish() {
  if (!rec1.sid) throw new Error('Start again.');
  const auth = (session) => ({ type: 'm.login.password', identifier: { type: 'm.id.user', user: dev.user }, password: dev.pass, ...(session ? { session } : {}) });
  let session = null; try { await mx('POST', '/account/3pid/add', { client_secret: rec1.secret, sid: rec1.sid }); } catch (e) { if (e.status === 401 && e.data && e.data.session) session = e.data.session; else throw e; }
  if (session) { try { await mx('POST', '/account/3pid/add', { client_secret: rec1.secret, sid: rec1.sid, auth: auth(session) }); } catch (e) { if (e.errcode === 'M_THREEPID_AUTH_FAILED' || /not validated|not verified/i.test(e.message)) { const n = new Error('That email is not verified yet. Open the link we sent, then try again.'); n.pending = true; throw n; } throw e; } }
  const blob = await wrapBlob(rec1.pass, { dk: dev.dk, user: dev.user, pass: dev.pass, room: dev.room });
  await mx('PUT', acctData('app.pathfinder.recovery'), { ...blob, email_hint: rec1.email.replace(/^(.).*(@.*)$/, '$1…$2') }); dev.email = rec1.email; saveDev(); rec1.pass = null;
}
const rst = { secret: null, sid: null, email: null, pass: null };
async function restoreSend(email, passphrase) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter the email you used.'); Object.assign(rst, { secret: rnd(18), email, pass: passphrase, sid: null });
  const t = await mx('POST', '/account/password/email/requestToken', { client_secret: rst.secret, email, send_attempt: 1 }, false); rst.sid = t.sid;
}
async function restoreFinish() {
  if (!rst.sid) throw new Error('Start again.'); const np = rnd(24); let session = null;
  try { await mx('POST', '/account/password', { new_password: np, logout_devices: false }, false); } catch (e) { if (e.status === 401 && e.data && e.data.session) session = e.data.session; else throw e; }
  try { await mx('POST', '/account/password', { new_password: np, logout_devices: false, auth: { type: 'm.login.email.identity', threepid_creds: { sid: rst.sid, client_secret: rst.secret }, session } }, false); }
  catch (e) { if (e.status === 401) { const n = new Error('That email is not verified yet. Open the link we sent, then try again.'); n.pending = true; throw n; } throw e; }
  const j = await mx('POST', '/login', { type: 'm.login.password', identifier: { type: 'm.id.thirdparty', medium: 'email', address: rst.email }, password: np, initial_device_display_name: 'Wayfinder (restored)' }, false);
  const saved = { ...dev }; Object.assign(dev, { user: j.user_id, pass: np, token: j.access_token, device: j.device_id, dk: null, room: null });
  try { const blob = await mx('GET', acctData('app.pathfinder.recovery')); const sec = await unwrapBlob(rst.pass, blob); Object.assign(dev, { dk: sec.dk, room: sec.room || null, email: rst.email }); }
  catch (e) { Object.assign(dev, saved); throw e; }
  saveDev(); rst.pass = null; await window.pfVault.sync();
}

/* ---------- panel ---------- */
function paintVault() {
  if (typeof $ !== 'function' || !$('vstat')) return; const on = !!dev.token;
  $('vpill').className = 'pill ' + (dev.email ? 'live' : on ? 'learn' : 'off'); $('vpill').textContent = dev.email ? 'Recovery on' : on ? 'Saved' : 'Not set up';
  $('vstat').textContent = vstat.note || (dev.email ? `Your nicknames and connections are saved encrypted, and you can recover them with ${dev.email} and your passphrase.` : on ? 'Your nicknames and connections are saved encrypted in this device\'s private space on hyphae. Turn on recovery so a lost phone does not lose them.' : 'Nothing is saved on the server yet. This sets up automatically the first time you connect with someone.');
  $('v-rec').hidden = !on || !!dev.email; $('v-setup').hidden = on;
}
const vnote = (id, m, cls) => { const e = $(id); e.textContent = m || ''; e.className = 'note' + (cls ? ' ' + cls : ''); };
$('v-setup').onclick = async () => { $('v-setup').disabled = true; try { await ensureDevice(); await ensureRoom(); for (const p of people.list) await putRec({ k: 'conn', id: p.id, key: p.key, name: p.name, nick: p.nick || '' }); vstat.note = ''; } catch (e) { vstat.note = 'Could not set up (' + e.message + ').'; } $('v-setup').disabled = false; paintVault(); };
$('v-rec-go').onclick = async () => { vnote('v-note', ''); $('v-rec-go').disabled = true; try { await recoverySend($('v-email').value.trim(), $('v-pass').value); $('v-rec-wait').hidden = false; $('v-rec-form').hidden = true; vnote('v-note', 'We sent a link to ' + rec1.email + '. Open it, then come back and tap the button.'); } catch (e) { vnote('v-note', e.message, 'err'); } $('v-rec-go').disabled = false; };
$('v-rec-done').onclick = async () => { try { await recoveryFinish(); $('v-rec-wait').hidden = true; $('v-rec-form').hidden = false; $('v-pass').value = ''; vnote('v-note', 'Recovery is on.'); paintVault(); } catch (e) { vnote('v-note', e.message, e.pending ? '' : 'err'); } };
$('v-restore-go').onclick = async () => { vnote('v-rnote', ''); try { await restoreSend($('v-remail').value.trim(), $('v-rpass').value); $('v-restore-wait').hidden = false; vnote('v-rnote', 'We sent a link to ' + rst.email + '. Open it, then come back and tap the button.'); } catch (e) { vnote('v-rnote', e.message, 'err'); } };
$('v-restore-done').onclick = async () => { try { await restoreFinish(); $('v-restore-wait').hidden = true; $('v-rpass').value = ''; vnote('v-rnote', 'Restored. Your connections are back.'); paintVault(); } catch (e) { vnote('v-rnote', e.message, e.pending ? '' : 'err'); } };
paintVault();
if (dev.token) window.pfVault.sync();
window.addEventListener('online', () => { if (dev.token) window.pfVault.sync(); });
