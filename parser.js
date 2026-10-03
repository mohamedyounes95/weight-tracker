// Eufy Life screenshot parser: turns OCR lines/words (with bounding boxes) into metric values.
// Pure functions only, so it can be unit-tested in Node without a browser.
//
// Input:  lines = [{ words: [{ text, bbox: {x0,y0,x1,y1}, confidence }] }]
// Output: { values, confidence, date, dateFound }
(function (root) {
  const Metrics = (typeof module !== 'undefined' && module.exports) ? require('./metrics.js') : root.Metrics;
  const { METRICS, BODY_TYPES, byKey } = Metrics;

  const norm = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
  // Words that turn a label into a different thing ("Standard weight", "Weight control").
  const SKIP_BEFORE = new Set(['ideal', 'standard', 'target', 'goal', 'normal', 'healthy', 'recommended']);
  const SKIP_AFTER = new Set(['control', 'change', 'goal', 'target', 'trend', 'range']);

  // Aliases split into normalized tokens, longest first so "body fat mass" wins over "body fat".
  const ALIASES = METRICS.flatMap(m => m.aliases.map(a => ({ key: m.key, toks: a.split(/[\s\-–]+/).map(norm) })))
    .sort((a, b) => b.toks.length - a.toks.length || b.toks.join('').length - a.toks.join('').length);

  const union = boxes => ({
    x0: Math.min(...boxes.map(b => b.x0)), y0: Math.min(...boxes.map(b => b.y0)),
    x1: Math.max(...boxes.map(b => b.x1)), y1: Math.max(...boxes.map(b => b.y1)),
  });

  // Each line becomes a token list; hyphenated words are split but keep their word's box.
  function tokenize(lines) {
    return lines.map((ln, li) => ln.words.flatMap((w, wi) =>
      w.text.split(/[-–]/).filter(p => norm(p)).map(p => ({ text: p, n: norm(p), bbox: w.bbox, conf: w.confidence, li, wi }))));
  }

  function findLabels(tokLines) {
    const labels = [], used = new Set();
    tokLines.forEach(toks => {
      for (let i = 0; i < toks.length; i++) {
        for (const a of ALIASES) {
          const k = a.toks.length;
          if (i + k > toks.length) continue;
          let ok = true;
          for (let j = 0; j < k; j++) if (toks[i + j].n !== a.toks[j]) { ok = false; break; }
          if (!ok) continue;
          const prev = toks[i - 1], next = toks[i + k];
          if ((prev && SKIP_BEFORE.has(prev.n)) || (next && SKIP_AFTER.has(next.n))) { i += k - 1; break; }
          const seg = toks.slice(i, i + k);
          labels.push({ key: a.key, bbox: union(seg.map(t => t.bbox)), li: seg[0].li, wEnd: seg[k - 1].wi });
          seg.forEach(t => used.add(t.li + ':' + t.wi));
          i += k - 1;
          break;
        }
      }
    });
    return { labels, used };
  }

  const NUM_RE = /^[^\d\-]*(-?\d{1,4}(?:[.,]\d{1,3})?)\s*(kg|%|kcal|bpm|lbs?|yrs?|years?)?[^\d]*$/i;
  function parseNumber(raw) {
    if (/[:\/]/.test(raw)) return null;                 // times and dates
    const m = raw.replace(/\s+/g, '').match(NUM_RE);
    if (!m) return null;
    let s = m[1];
    if (/^\d{1,2},\d{3}$/.test(s)) s = s.replace(',', ''); // 1,629 kcal
    else s = s.replace(',', '.');
    const value = parseFloat(s);
    if (!isFinite(value)) return null;
    return { value, hasDecimal: s.includes('.'), unit: (m[2] || '').toLowerCase() };
  }

  function findNumbers(lines, used) {
    const nums = [];
    lines.forEach((ln, li) => ln.words.forEach((w, wi) => {
      if (used.has(li + ':' + wi)) return;
      const p = parseNumber(w.text);
      if (!p) return;
      // Unit may be the following word ("77.95" "kg").
      const nxt = ln.words[wi + 1];
      if (!p.unit && nxt && /^(kg|%|kcal|bpm|lbs?|yrs?)$/i.test(nxt.text.trim())) p.unit = nxt.text.trim().toLowerCase();
      nums.push({ ...p, bbox: w.bbox, conf: w.confidence, li, wi });
    }));
    return nums;
  }

  // Lower score = better pairing. Units are in label heights so it works at any resolution.
  function score(L, N) {
    const a = L.bbox, b = N.bbox;
    const lh = Math.max(1, a.y1 - a.y0), nh = Math.max(1, b.y1 - b.y0);
    const vOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (vOverlap > 0.3 * Math.min(lh, nh) && b.x0 >= a.x1 - 2) return (b.x0 - a.x1) / lh * 0.25; // same row, to the right
    const lcx = (a.x0 + a.x1) / 2, ncx = (b.x0 + b.x1) / 2;
    const hOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const dx = Math.abs(lcx - ncx);
    const hClose = hOverlap > 0 || dx < (a.x1 - a.x0);
    if (!hClose) return Infinity;
    if (b.y0 >= a.y1 - 2) { const d = (b.y0 - a.y1) / lh; return d > 4 ? Infinity : 1 + d * 1.2 + dx / lh * 0.1; } // below
    if (b.y1 <= a.y0 + 2) { const d = (a.y0 - b.y1) / lh; return d > 4 ? Infinity : 1.5 + d * 1.5 + dx / lh * 0.1; } // above
    return Infinity;
  }

  function unitCompatible(m, n) {
    if (!n.unit) return true;
    if (n.unit === '%') return m.unit === '%';
    if (n.unit === 'kg' || n.unit.startsWith('lb')) return m.unit === 'kg';
    if (n.unit === 'kcal') return m.key === 'bmr';
    if (n.unit === 'bpm') return m.key === 'heartRate';
    if (n.unit.startsWith('y')) return m.key === 'bodyAge';
    return true;
  }

  function toKg(n) { return n.unit && n.unit.startsWith('lb') ? Math.round(n.value * 0.45359237 * 100) / 100 : n.value; }

  // Body type is text, so look for a known type name near the label (right, below or above it).
  function findBodyType(L, lines, used) {
    const cands = [];
    lines.forEach((ln, li) => ln.words.forEach((w, wi) => {
      if (used.has(li + ':' + wi) || !/[a-z]/i.test(w.text)) return;
      const s = score(L, { bbox: w.bbox });
      if (s === Infinity) return;
      // Try two-word types first ("Lean Muscular"), then single words.
      const two = ln.words[wi + 1] ? (w.text + ' ' + ln.words[wi + 1].text) : null;
      for (const text of [two, w.text]) {
        if (!text) continue;
        const t = text.toLowerCase().replace(/[^a-z ]/g, '').trim();
        const hit = BODY_TYPES.find(bt => bt.toLowerCase() === t);
        if (hit) { cands.push({ hit, s }); break; }
      }
    }));
    cands.sort((a, b) => a.s - b.s);
    if (cands.length) return cands[0].hit;
    const after = lines[L.li].words.slice(L.wEnd + 1).map(w => w.text).join(' ').replace(/[^A-Za-z ]/g, '').trim();
    return after ? after.replace(/\b\w/g, c => c.toUpperCase()) : null;
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const pad = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${y}-${pad(m)}-${pad(d)}` : null;

  function findDate(text, now = new Date()) {
    let m;
    if ((m = text.match(/(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
    if ((m = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})\b/))) {
      const a = +m[1], b = +m[2];
      return b > 12 ? iso(+m[3], a, b) : iso(+m[3], b, a); // default day/month, like the original sheet
    }
    const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
    if ((m = text.match(new RegExp(mon + '\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(20\\d{2})?', 'i'))))
      return iso(m[3] ? +m[3] : now.getFullYear(), MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
    if ((m = text.match(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+' + mon + ',?\\s*(20\\d{2})?', 'i'))))
      return iso(m[3] ? +m[3] : now.getFullYear(), MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
    return null;
  }

  function parse(lines, opts = {}) {
    const tokLines = tokenize(lines);
    const { labels, used } = findLabels(tokLines);
    const nums = findNumbers(lines, used);
    const values = {}, confidence = {};

    const pairs = [];
    for (const L of labels) {
      const m = byKey[L.key];
      if (m.text) continue;
      for (const N of nums) {
        if (!unitCompatible(m, N)) continue;
        const v = m.unit === 'kg' ? toKg(N) : N.value;
        if (v < m.min || v > m.max) continue;
        const s = score(L, N);
        if (s < 12) pairs.push({ L, N, s, v });
      }
    }
    pairs.sort((a, b) => a.s - b.s);
    const takenN = new Set(), takenL = new Set();
    for (const p of pairs) {
      if (values[p.L.key] !== undefined || takenN.has(p.N) || takenL.has(p.L)) continue;
      values[p.L.key] = p.v; confidence[p.L.key] = p.N.conf;
      takenN.add(p.N); takenL.add(p.L);
    }

    // Weight is often the big headline number with no "Weight" label next to it.
    if (values.weight === undefined) {
      const cand = nums.filter(n => !takenN.has(n) && (n.hasDecimal || n.unit === 'kg' || n.unit.startsWith('lb')) && toKg(n) >= 30 && toKg(n) <= 250)
        .sort((a, b) => (b.bbox.y1 - b.bbox.y0) - (a.bbox.y1 - a.bbox.y0));
      if (cand.length) { values.weight = toKg(cand[0]); confidence.weight = Math.min(cand[0].conf, 70); }
    }

    const bt = labels.find(l => l.key === 'bodyType');
    if (bt) { const v = findBodyType(bt, lines, used); if (v) { values.bodyType = v; confidence.bodyType = 80; } }

    const fullText = lines.map(l => l.words.map(w => w.text).join(' ')).join('\n');
    const date = findDate(fullText, opts.now);
    return { values, confidence, date, dateFound: !!date };
  }

  // Sanity checks used by the review form: returns { key: reason } for values worth a second look.
  function validate(rec, prev, confidence = {}) {
    const flags = {};
    for (const m of METRICS) {
      const v = rec[m.key];
      if (m.text || v === undefined || v === null || v === '') continue;
      if (v < m.min || v > m.max) flags[m.key] = `Outside the usual range (${m.min}–${m.max})`;
      else if (confidence[m.key] !== undefined && confidence[m.key] < 60) flags[m.key] = 'Hard to read, please check';
    }
    const { weight: w, bodyFatPct: bf, bodyFatMass: fm, leanMass: lean } = rec;
    if (w && bf && fm && Math.abs(fm - w * bf / 100) > 0.6) {
      flags.bodyFatMass = flags.bodyFatMass || `Expected ≈ ${(w * bf / 100).toFixed(1)} kg (weight × body fat %)`;
    }
    if (w && fm && lean && Math.abs(lean - (w - fm)) > 0.8) {
      flags.leanMass = flags.leanMass || `Expected ≈ ${(w - fm).toFixed(1)} kg (weight − fat mass)`;
    }
    if (w && prev && prev.weight && Math.abs(w - prev.weight) > 3) {
      flags.weight = flags.weight || `Big jump from last entry (${prev.weight} kg)`;
    }
    return flags;
  }

  // ---------- Eufy Life tile layout ----------
  // The Eufy Life measurement page is a 2-column grid of white tiles, one metric per tile,
  // always in this order. Tiles are found by color and read one at a time.
  const EUFY_ORDER = ['weight', 'bmi', 'bodyFatPct', 'heartRate', 'muscleMass', 'bmr', 'waterPct', 'bodyFatMass',
    'leanMass', 'boneMass', 'visceralFat', 'proteinPct', 'skeletalMuscle', 'subcutFatPct', 'bodyAge', 'bodyType'];
  const STATUS_WORDS = new Set(['standard', 'low', 'high', 'normal', 'excellent', 'insufficient', 'very', 'over', 'under',
    'slightly', 'severe', 'good', 'kg', 'kcal', 'bpm', 'lb', 'lbs']);

  // Finds tile rectangles in a grayscale image (Uint8 array, one byte per pixel).
  function detectCards(g, W, H) {
    const edge = [];
    for (let y = 0; y < H; y += 4) edge.push(g[y * W + 1], g[y * W + W - 2]);
    edge.sort((a, b) => a - b);
    const bg = edge[edge.length >> 1];
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i += 3) hist[g[i]]++;
    let card = -1, best = 0;
    for (let v = 0; v < 256; v++) if (Math.abs(v - bg) >= 6 && hist[v] > best) { best = hist[v]; card = v; }
    if (card < 0) return [];
    const isCard = v => Math.abs(v - card) <= 4;

    const runs = (frac, thr, minLen, mergeGap) => {
      const out = []; let s = -1;
      for (let i = 0; i <= frac.length; i++) {
        const on = i < frac.length && frac[i] > thr;
        if (on && s < 0) s = i;
        if (!on && s >= 0) { out.push([s, i]); s = -1; }
      }
      const merged = [];
      for (const r of out) {
        const last = merged[merged.length - 1];
        if (last && r[0] - last[1] <= mergeGap) last[1] = r[1]; else merged.push(r);
      }
      return merged.filter(r => r[1] - r[0] >= minLen);
    };

    const rowFrac = new Float32Array(H);
    for (let y = 0; y < H; y++) { let c = 0; for (let x = 0; x < W; x += 2) if (isCard(g[y * W + x])) c++; rowFrac[y] = c / (W / 2); }
    const cards = [];
    for (const [y0, y1] of runs(rowFrac, 0.08, Math.max(8, H * 0.02), 1)) {
      const colFrac = new Float32Array(W);
      for (let x = 0; x < W; x++) { let c = 0; for (let y = y0; y < y1; y += 2) if (isCard(g[y * W + x])) c++; colFrac[x] = c / ((y1 - y0) / 2); }
      for (const [x0, x1] of runs(colFrac, 0.3, W * 0.15, Math.round(W * 0.01))) cards.push({ x0, y0, x1, y1 });
    }
    return cards;
  }

  function lev(a, b) {
    const d = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0]; d[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = d[j];
        d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return d[b.length];
  }

  // Fuzzy label match on a tile's text, so OCR slips like "WEICHT" or "smi" still land.
  function matchLabel(words) {
    // Digits inside words are usually misread letters ("80DY" → "body").
    const fixDigits = t => /[a-z]/i.test(t) ? t.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's').replace(/8/g, 'b') : t;
    const toks = words.map(w => fixDigits(w.text).toLowerCase().replace(/[^a-z]/g, ''))
      .filter(t => (t.length >= 3 || t === 'fat') && !STATUS_WORDS.has(t));
    const t = toks.join('');
    if (!t) return null;
    let bestKey = null, bestSim = 0;
    for (const m of METRICS) for (const alias of m.aliases) {
      const a = alias.replace(/[^a-z]/g, '');
      let sim = 1 - lev(t, a) / Math.max(t.length, a.length);
      if (a.length >= 5 && t.includes(a)) sim = Math.max(sim, 0.75 + 0.25 * a.length / t.length);
      if (sim > bestSim) { bestSim = sim; bestKey = m.key; }
    }
    return bestSim >= 0.6 ? { key: bestKey, sim: bestSim } : null;
  }

  // The tile's value is its tallest number (icons sometimes produce stray small digits).
  function tileNumber(words) {
    const nums = [];
    words.forEach((w, i) => {
      const p = parseNumber(w.text);
      if (!p || p.value < 0) return;
      const nxt = words[i + 1];
      if (!p.unit && nxt && /^(kg|%|kcal|bpm|lbs?)/i.test(nxt.text.trim())) p.unit = nxt.text.trim().toLowerCase().replace(/[^a-z%]/g, '');
      nums.push({ ...p, h: w.bbox.y1 - w.bbox.y0, conf: w.confidence });
    });
    nums.sort((a, b) => b.h - a.h);
    return nums[0] || null;
  }

  // Fits an OCR'd number to a metric's range; recovers a dropped decimal point ("5810" → 58.10).
  function fitValue(m, n) {
    let v = m.unit === 'kg' ? toKg(n) : n.value;
    if (v >= m.min && v <= m.max) return { v, conf: n.conf };
    if (!n.hasDecimal) for (const div of [10, 100]) if (v / div >= m.min && v / div <= m.max) return { v: v / div, conf: Math.min(n.conf, 50) };
    return { v, conf: 0 };
  }

  // cards: [{ words }] in reading order. Labels decide; Eufy's fixed order fills gaps and re-syncs after them.
  function parseCards(cards) {
    const values = {}, confidence = {};
    let p = 0;
    for (const c of cards) {
      const lab = matchLabel(c.words);
      let key = lab && lab.sim >= 0.75 ? lab.key : EUFY_ORDER[p];
      if (lab && lab.sim < 0.75 && EUFY_ORDER[p] !== lab.key && EUFY_ORDER.indexOf(lab.key) > p) key = lab.key;
      if (!key || values[key] !== undefined) { p++; continue; }
      p = EUFY_ORDER.indexOf(key) + 1;
      const m = byKey[key];
      if (m.text) {
        const txt = c.words.map(w => w.text).join(' ').toLowerCase();
        const hit = BODY_TYPES.find(bt => txt.includes(bt.toLowerCase()));
        if (hit) { values[key] = hit; confidence[key] = 85; }
        continue;
      }
      // Two reads per tile: the focused value line and the whole tile. Score each, and trust agreement.
      const wantsDecimal = m.step < 1;
      const quality = n => {
        if (!n) return 0;
        const f = fitValue(m, n);
        if (f.conf === 0) return 0;
        if (f.v !== (m.unit === 'kg' ? toKg(n) : n.value)) return 1;  // needed a recovered decimal point
        return n.hasDecimal === wantsDecimal || !wantsDecimal ? 3 : 2;
      };
      const nv = c.valueWords && tileNumber(c.valueWords), nt = tileNumber(c.words);
      const qv = quality(nv), qt = quality(nt);
      const n = qv >= qt ? nv : nt, q = Math.max(qv, qt);
      if (!n) continue;
      const f = fitValue(m, n);
      const v = Math.round(f.v * 100) / 100;
      const other = n === nv ? nt : nv;
      const agree = other && quality(other) > 0 && Math.round(fitValue(m, other).v * 100) / 100 === v;
      values[key] = v;
      const disagree = other && quality(other) >= q && !agree; // a weaker read (e.g. lost decimal) doesn't count
      confidence[key] = q === 0 ? 0 : agree ? 95 : disagree ? 40 : q === 3 ? 75 : 45;
      if (!lab) confidence[key] = Math.min(confidence[key], agree ? 75 : 55); // placed by tile order only
    }
    return { values, confidence };
  }

  const api = { parse, validate, findDate, parseNumber, detectCards, parseCards, matchLabel, EUFY_ORDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EufyParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
