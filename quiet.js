/* quiet.js: spoken directions that are not annoying, and cannot be wrong.
   Michael: "the instructions for taking exits that name the long ass name of the road is super annoying in nashville... but have the turning instructions read and gated for
   accuracy so its not hallucinating... recursive learning... learn from common routes".

   Three parts, all pure and tested (test/quiet.test.mjs):
   1. CANDIDATES: from the routing engine's own sentence, only DELETIONS and a reordering of the distance phrase. Nothing is ever added.
   2. GATE: any candidate, from a rule or from a model, must pass: same action words, same numbers, road names only as ordered pieces of the source's own. This is a
      mechanical check, so a model that invents a road, a turn or a distance is refused no matter how confident it sounds. A refusal falls back to the source sentence.
   3. POLICY: a fold over the trip log decides HOW MUCH to say at each junction. State is rebuilt from the log (nothing hidden), decays over months, and uses a
      Wilson lower bound so one lucky pass never counts as "known" (advice from the Wilson's-ants work: strength without a sample size looks familiar after one success).
      A miss after a quiet prompt is sticky (a veto only explicit relearning clears) and counts four times. The SAFETY_GROUND floor sits outside the learner:
      familiarity can only reduce talk down to the floor, never below it.
   The model slot (`phraser`) is optional; with none, the policy picks. See docs/quiet-voice.md. */
(function (root) {
  'use strict';

  /* ---------- the declared ground (who decided what; the learner cannot touch these) ---------- */
  const GROUND = {
    author: 'Michael Lacy, 2026-11-14',
    // minimum prompts per kind of manoeuvre: 3 = far, mid and near; 2 = mid and near; 1 = near only. Exits, ramps, forks, merges, roundabouts and U-turns are where a missed cue costs a lap of the city.
    floor: { default: 1, 'off ramp': 2, 'on ramp': 2, fork: 2, merge: 2, roundabout: 2, rotary: 2, 'end of road': 2, uturn: 2, depart: 1, arrive: 1 },
    halfLifeDays: 120,           // a road not driven for months stops counting as known (the ants session: 7 days is wrong for roads)
    missWeight: 4,               // a miss after a short prompt is strong evidence, not one deposit
    relearnStreak: 3,            // a vetoed junction is cleared only after this many successes at FULL verbosity
    knownAt: 0.5, familiarAt: 0.25,
    minRouteRepeats: 3,
  };
  const DAY = 864e5;

  /* ---------- parsing the sentence(s) ---------- */
  // Real Valhalla sentences (297 collected from Nashville routes, test/fixtures/nashville-sentences.json) have several shapes:
  //   "In 600 feet, Turn left onto Rosa L Parks Boulevard, U.S. 31."          distance first, action, road pieces
  //   "Turn left onto Main Street in a quarter mile."                          distance last
  //   "Drive southeast on 6th Avenue North. Then, in 600 feet, Turn right onto Commerce Street."   two sentences
  //   "Keep right to take exit 2 16B onto State Route 2 55 toward International Airport."          a road clause and a destination clause
  //   "Continue on U.S. 31, U.S. 41 for a half mile."                           the "for ..." phrase IS the information
  const UNIT = '(?:feet|foot|miles?|meters?|metres?|kilometers?|yards?)';
  const reLead = new RegExp('^in\\s+(.+?' + UNIT + '),\\s*(.+)$', 'i');
  const reTail = new RegExp('^(.+?)\\s+in\\s+((?:[\\w.,]+\\s+){0,4}?' + UNIT + ')$', 'i');      // "in 600 feet", "in a half mile", "in 1.5 miles"
  const reBound = /\s+(?:(onto|toward|towards)\s+|on\s+(?!the\b))/i;
  const reFor = /\s+(for\s+(?:\d|an?\s|half\s).*)$/i;
  const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const stripEnd = s => String(s || '').trim().replace(/[.\s]+$/, '');
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1), low = s => s.charAt(0).toLowerCase() + s.slice(1);

  function splitSentences(text) {                // ". " then a capital starts a new sentence, except after an initial or abbreviation ("U.S. Highway", "Rosa L. Parks")
    const t = String(text || '').trim(), out = []; let from = 0;
    for (let i = 0; i < t.length - 2; i++) {
      if (t[i] === '.' && t[i + 1] === ' ' && /[A-Z]/.test(t[i + 2])) {
        const w = /(\S+)$/.exec(t.slice(from, i + 1))[1];
        if (/^(?:[A-Za-z]\.)+$/.test(w) || w.length <= 2) continue;      // "U.S." "L." "St."
        out.push(t.slice(from, i + 1)); from = i + 2;
      }
    }
    out.push(t.slice(from)); return out.filter(x => x.trim());
  }
  function parse(text) {                         // ONE sentence -> { pre, dist, head, prep, ids, prep2, ids2, tail }
    let t = stripEnd(text), pre = '', dist = '', tail = '', m;
    if ((m = /^(then,?)\s+(.+)$/i.exec(t))) { pre = m[1]; t = m[2]; }
    if ((m = reLead.exec(t))) { dist = m[1]; t = m[2]; } else if ((m = reTail.exec(t))) { dist = m[2]; t = m[1]; }
    if ((m = reFor.exec(t))) { tail = m[1]; t = t.slice(0, m.index); }
    const b = reBound.exec(t);
    if (!b) return { pre, dist, head: t, prep: '', ids: [], prep2: '', ids2: [], tail };
    const head = t.slice(0, b.index); let rest = t.slice(b.index + b[0].length), prep = (b[1] || 'on').toLowerCase(), prep2 = '', ids2 = [];
    const t2 = /\s+(toward|towards)\s+(.+)$/i.exec(rest);       // a second clause: where the road goes
    if (t2) { prep2 = t2[1].toLowerCase(); ids2 = t2[2].split(/\s*,\s*|\s*;\s*/).map(x => x.trim()).filter(Boolean); rest = rest.slice(0, t2.index); }
    const pieces = x => x.split(/\s*,\s*|\s*;\s*|\s+\/\s+/).map(y => y.trim()).filter(Boolean);
    if (prep === 'toward' || prep === 'towards') return { pre, dist, head, prep: '', ids: [], prep2: prep, ids2: pieces(rest), tail };
    return { pre, dist, head, prep, ids: pieces(rest), prep2, ids2, tail };
  }
  function parseAll(text) { return splitSentences(text).map(parse); }
  function compose(p, style) {                   // style: 'full' puts the distance first, 'short' puts it last ("Turn left in a quarter mile.")
    const clause = (prep, ids) => ids.length ? ' ' + prep + ' ' + ids.join(', ') : '';
    const body = p.head + clause(p.prep, p.ids) + clause(p.prep2, p.ids2) + (p.tail ? ' ' + p.tail : '');
    const pre = p.pre ? cap(low(p.pre)).replace(/,?$/, p.pre.endsWith(',') ? ',' : '') + ' ' : '';
    if (!p.dist) return pre ? pre + low(body) : cap(body);
    if (style === 'short') return (pre ? pre + low(body) : cap(body)) + ' in ' + p.dist;
    return pre ? `${pre}in ${p.dist}, ${low(body)}` : `In ${p.dist}, ${low(body)}`;
  }
  const composeAll = (list, style) => list.map(p => compose(p, style).replace(/[.\s]+$/, '')).join('. ') + '.';

  /* ---------- the gate ---------- */
  const isSubseq = (a, b) => { let i = 0; for (const w of b) if (i < a.length && a[i] === w) i++; return i === a.length; };
  const wj = x => words(x).join(' ');
  function clauseOk(cIds, sIds, label) {         // each kept road piece must be an ordered piece of a source piece, pieces in source order
    let from = 0;
    for (const id of cIds) { const cw = words(id); let hit = -1; for (let k = from; k < sIds.length; k++) if (isSubseq(cw, words(sIds[k]))) { hit = k; break; } if (hit < 0) return 'a ' + label + ' that is not in the source: ' + id; from = hit; }
    return '';
  }
  function gate(source, candidate) {             // -> { ok, why }. Mechanical: refuses anything not made of the source's own words.
    if (!candidate || !String(candidate).trim()) return { ok: false, why: 'empty' };
    const S = parseAll(source), C = parseAll(candidate);
    if (S.length !== C.length) return { ok: false, why: 'the number of sentences changed' };
    for (let i = 0; i < S.length; i++) {
      const s = S[i], c = C[i];
      if (wj(c.pre) !== wj(s.pre)) return { ok: false, why: 'the "then" changed' };
      if (wj(c.head) !== wj(s.head)) return { ok: false, why: 'the action words changed' };
      if (c.dist && wj(c.dist) !== wj(s.dist)) return { ok: false, why: 'the distance changed' };
      if (s.dist && !c.dist) return { ok: false, why: 'the distance was dropped' };
      if (wj(c.tail) !== wj(s.tail)) return { ok: false, why: s.tail && !c.tail ? 'the "for ..." distance was dropped' : 'the "for ..." phrase changed' };
      if (c.ids.length && c.prep !== s.prep) return { ok: false, why: 'the preposition changed' };
      if (c.ids2.length && c.prep2 !== s.prep2) return { ok: false, why: 'the preposition changed' };
      let w = clauseOk(c.ids, s.ids, 'road name'); if (w) return { ok: false, why: w };
      w = clauseOk(c.ids2, s.ids2, 'destination'); if (w) return { ok: false, why: w };
    }
    const count = x => { const m = new Map(); for (const n of String(x).match(/\d+(?:[.,]\d+)*/g) || []) m.set(n, (m.get(n) || 0) + 1); return m; };      // numbers as a multiset: the distance may move, no number may appear that the source lacks
    const cs = count(candidate), ss = count(source);
    for (const [n, k] of cs) if ((ss.get(n) || 0) < k) return { ok: false, why: 'a number that is not in the source: ' + n };
    return { ok: true, why: '' };
  }

  /* ---------- candidates: only deletions ---------- */
  function dropSuffix(name, suffixes, ambiguous) {          // "Rosa L Parks Boulevard" -> "Rosa L Parks" when the last word is a road-type word EARNED from the street corpus AND the rest names only one road (scripts/earn-street-words.mjs)
    const w = name.split(/\s+/); if (w.length < 2 || !suffixes.has(w[w.length - 1].toLowerCase())) return name;
    return ambiguous && ambiguous.has(words(w.slice(0, -1).join(' ')).join(' ')) ? name : w.slice(0, -1).join(' ');
  }
  const nw = x => words(x).length;
  function transform(p, tag, suf, amb) {              // one sentence, one way of shortening
    const q = { ...p, ids: p.ids.slice(), ids2: p.ids2.slice() }, hasDigit = x => /\d/.test(x);
    if (tag === 'all') return q;
    if (tag === 'none') { q.ids = []; q.ids2 = []; return q; }
    const ds = x => dropSuffix(x, suf, amb), first = q.ids.slice(0, 1), firstShort = first.map(ds), ref = q.ids.find(hasDigit);
    if (tag === 'first') { q.ids = first; q.ids2 = q.ids2.slice(0, 1); return q; }
    if (tag === 'short') { q.ids = firstShort; q.ids2 = q.ids2.slice(0, 1).map(ds); return q; }
    if (tag === 'ref') { q.ids = ref ? [ref] : firstShort; q.ids2 = []; return q; }
    // 'auto': where the road goes beats what it is called; otherwise the fewest words that still name the road, preferring the name locals say on a tie
    if (q.ids2.length && q.prep === 'onto' && /\d/.test(q.head)) { q.ids = []; q.ids2 = q.ids2.slice(0, 1).map(ds); return q; }      // an exit number plus where it goes; the road it joins is the long name nobody needs
    if (!q.ids.length) { q.ids2 = q.ids2.slice(0, 1).map(ds); return q; }
    q.ids2 = [];                                             // "stay on X", "continue on X": the road IS the instruction, so it stays; the destination goes
    q.ids = ref && nw(ref) < nw(firstShort[0]) ? [ref] : firstShort; return q;
  }
  function candidates(source, opts) {
    const o = opts || {}, suf = o.suffixes instanceof Set ? o.suffixes : new Set(o.suffixes || []), amb = o.ambiguous instanceof Set ? o.ambiguous : new Set(o.ambiguous || []), list = parseAll(source), out = [], seen = new Set();
    for (const style of ['short', 'full']) for (const tag of ['auto', 'short', 'ref', 'first', 'all', 'none']) {
      const text = composeAll(list.map(p => transform(p, tag, suf, amb)), style), key = style + '|' + text; if (seen.has(key)) continue; seen.add(key);
      if (gate(source, text).ok) out.push({ id: tag + ':' + style, tag, style, text });
    }
    return out;
  }

  /* ---------- what to prefer when nothing has been learned: the 'auto' shortening in the driver's wording style ---------- */
  function preferred(cands, learned) {
    const style = (learned && learned.style) || 'short';
    if (learned && learned.names === false) return cands.find(c => c.tag === 'none' && c.style === style) || cands.find(c => c.tag === 'none') || null;      // street names switched off
    return cands.find(c => c.tag === 'auto' && c.style === style) || cands.find(c => c.style === style) || null;      // nothing approved: the caller speaks the source sentence as the router wrote it
  }

  /* ---------- the fold: trips -> per-junction familiarity ---------- */
  function wilsonLower(k, n, z) {                // lower bound of a proportion; (0 of 0) = 0, (1 of 1) is about 0.2, not 1. Same formula as khora native/organs/barker.js wilson().
    if (n <= 0) return 0; z = z || 1.959964; const p = k / n, d = 1 + z * z / n;
    return Math.max(0, (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / d);
  }
  const decay = (t, now) => Math.pow(0.5, Math.max(0, now - t) / (GROUND.halfLifeDays * DAY));
  const bearingBucket = b => Math.round(((b % 360) + 360) % 360 / 45) % 8;
  function stepKey(step) {                       // about 110 m cells, the way you approach it, and what kind of manoeuvre: the same junction on the next trip gets the same key
    const m = step.maneuver || {}, loc = m.location || [0, 0];
    return [Math.round(loc[1] * 1000), Math.round(loc[0] * 1000), bearingBucket(m.bearing_after || 0), m.type || 'turn'].join(':');
  }
  const routeKey = (o, d) => [Math.round(o[0] * 200), Math.round(o[1] * 200), Math.round(d[0] * 200), Math.round(d[1] * 200)].join('~');   // about 500 m cells at each end

  function fold(trips, now) {                    // pure: the same log and the same `now` always give the same state
    const steps = new Map(), routes = new Map(), style = { names: [1, 1], short: [1, 1] };      // style: [mutes, passes] with a weak prior
    for (const trip of trips.slice().sort((a, b) => a.t - b.t)) {
      const w = decay(trip.t, now);
      const r = routes.get(trip.route) || { n: 0, last: 0 }; r.n += w >= 0.1 ? 1 : 0; r.last = Math.max(r.last, trip.t); routes.set(trip.route, r);
      for (const s of trip.steps || []) {
        const e = steps.get(s.key) || { A: 0, H: 0, veto: false, streak: 0, misses: 0, seen: 0, last: 0, man: s.man };
        e.seen++; e.last = Math.max(e.last, trip.t);
        if (s.outcome === 'miss') { e.A += GROUND.missWeight * w; e.misses++; e.veto = true; e.streak = 0; }
        else if (s.outcome === 'ok') { e.A += w; e.H += w; if (e.veto && s.level === 'full') { e.streak++; if (e.streak >= GROUND.relearnStreak) { e.veto = false; e.streak = 0; } } }
        steps.set(s.key, e);
        if (s.muted && s.style) { const c = style[s.style]; if (c) c[0] += w; } else if (s.style && s.outcome === 'ok') { const c = style[s.style]; if (c) c[1] += w; }
      }
    }
    const pm = c => c[0] / (c[0] + c[1]);        // posterior mean of "mutes after a prompt of this style"
    const learnedStyle = style.names[0] + style.names[1] > 4 && pm(style.names) > pm(style.short) + 0.1 ? 'short' : (style.short[0] + style.short[1] > 4 && pm(style.short) > pm(style.names) + 0.1 ? 'names' : 'short');
    return { steps, routes, style: learnedStyle, trips: trips.length, now };
  }
  function familiarity(state, key) { const e = state && state.steps.get(key); return e ? { f: wilsonLower(e.H, e.A), veto: e.veto, misses: e.misses, seen: e.seen } : { f: 0, veto: false, misses: 0, seen: 0 }; }
  function level(state, step) {                  // 'full' | 'medium' | 'quiet': how many prompts this junction gets (3, 2, 1), never below the declared floor
    const type = (step.maneuver && step.maneuver.type) || 'turn', floor = GROUND.floor[type] != null ? GROUND.floor[type] : GROUND.floor.default;
    const fam = familiarity(state, stepKey(step)); let n = 3;
    if (!fam.veto) { if (fam.f >= GROUND.knownAt) n = 1; else if (fam.f >= GROUND.familiarAt) n = 2; }
    n = Math.max(n, floor); return { n, name: n >= 3 ? 'full' : n === 2 ? 'medium' : 'quiet', familiarity: fam.f, vetoed: fam.veto, floor };
  }
  const stagesFor = n => n >= 3 ? [0, 1, 2] : n === 2 ? [1, 2] : [2];       // which of the three distance prompts to speak
  const isKnownRoute = (state, key) => { const r = state && state.routes.get(key); return !!r && r.n >= GROUND.minRouteRepeats; };

  /* ---------- the optional model slot ---------- */
  function sayNow(source, state, opts) {         // the same without a model, synchronous: what the app speaks
    const o = opts || {}, cands = candidates(source, o), pick = preferred(cands, { style: o.style || (state && state.style), names: o.names });
    return pick ? pick.text : source;
  }
  async function say(source, state, opts) {      // -> { text, why, from: 'policy'|'model'|'source' }. A model may propose; the gate disposes.
    const o = opts || {}, cands = candidates(source, o), pick = preferred(cands, state && { style: state.style });
    let chosen = pick ? pick.text : source, from = pick ? 'policy' : 'source';
    if (o.phraser) {
      try { const proposal = await o.phraser(source, cands.map(c => c.text));
        if (proposal) { const g = gate(source, proposal); if (g.ok) { chosen = proposal; from = 'model'; } else { return { text: chosen, from, why: 'model refused by the gate: ' + g.why, refused: proposal }; } }
      } catch { /* a model that fails never silences or changes the prompt */ }
    }
    return { text: chosen, from, why: '' };
  }

  root.Quiet = { GROUND, parse, parseAll, splitSentences, compose, gate, candidates, preferred, wilsonLower, decay, stepKey, routeKey, fold, familiarity, level, stagesFor, isKnownRoute, say, sayNow, words };
})(typeof window !== 'undefined' ? window : globalThis);
