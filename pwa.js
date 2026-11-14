// Keeps the installed app up to date by itself. The service worker is network first, so a reload always brings the newest files; this checks for a new version
// whenever you come back to the app and every 30 minutes, and reloads when it is safe. It never reloads in the middle of navigation, a bus ride or live sharing:
// it waits until that finishes and shows a small note meanwhile.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  let hadController = !!navigator.serviceWorker.controller, waiting = false;
  const busy = () => (typeof nav !== 'undefined' && nav.on) || (typeof ride !== 'undefined' && ride.on) || (typeof senders !== 'undefined' && senders.size > 0);
  const note = msg => { let n = document.getElementById('updnote'); if (!msg) { if (n) n.remove(); return; } if (!n) { n = document.createElement('div'); n.id = 'updnote'; n.setAttribute('role', 'status'); document.body.append(n); } n.textContent = msg; };
  function reloadWhenSafe() {
    if (waiting) return; waiting = true;
    const go = () => { if (busy()) { note('A new version is ready. It installs when you finish navigating, riding or sharing.'); return false; } try { sessionStorage.setItem('wf-updated', '1'); } catch {} location.reload(); return true; };
    if (!go()) { const t = setInterval(() => { if (go()) clearInterval(t); }, 8000); }
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController) { hadController = true; return; } reloadWhenSafe(); });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); }); setInterval(check, 30 * 60 * 1000); check();
  }).catch(() => {});
  try { if (sessionStorage.getItem('wf-updated')) { sessionStorage.removeItem('wf-updated'); setTimeout(() => { note('Updated to the newest version.'); setTimeout(() => note(''), 3000); }, 600); } } catch {}
}
let installEv; addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; $('install').style.display = 'inline-block'; });
$('install').onclick = () => { if (installEv) { installEv.prompt(); installEv = null; $('install').style.display = 'none'; } };
addEventListener('appinstalled', () => { $('install').style.display = 'none'; });
