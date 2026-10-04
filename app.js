// App shell: navigation, dashboard, history, upload/review flow, settings.
(() => {
  const { METRICS, BODY_TYPES, byKey } = Metrics;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const { fmtNum, ts } = Charts;
  const state = { entries: [], goal: null, range: 'all', anyMetric: 'waterPct', view: 'dashboard', review: null,
    selecting: false, selected: new Set() };

  const fmtDate = (e, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
    e.dateLabel || new Date(e.date + 'T12:00:00').toLocaleDateString(undefined, opts);
  const signed = (v, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmtNum(Math.abs(v), d)}`;
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Optional action button (e.g. Undo); toasts with an action stay up longer.
  function toast(msg, actionLabel, onAction) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('has-action', !!actionLabel);
    if (actionLabel) {
      const b = document.createElement('button');
      b.className = 'toast-action'; b.textContent = actionLabel;
      b.onclick = () => { t.classList.remove('show'); onAction(); };
      t.append(b);
    }
    t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), actionLabel ? 6000 : 2600);
  }

  // ---------- navigation ----------
  function show(view) {
    if (view !== 'history') { state.selecting = false; state.selected.clear(); document.body.classList.remove('selecting'); }
    state.view = view;
    $$('.view').forEach(v => v.hidden = v.dataset.view !== view);
    $$('.tabbar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === view));
    document.body.classList.toggle('in-review', view === 'review');
    window.scrollTo(0, 0);
    if (view === 'dashboard') renderDashboard();
    if (view === 'history') renderHistory();
    if (view === 'settings') renderSettings();
  }

  // ---------- dashboard ----------
  const weighed = () => state.entries.filter(e => typeof e.weight === 'number');

  function tile(label, value, delta, deltaGood, extra = '') {
    const cls = delta == null ? '' : deltaGood ? 'good' : 'neutral';
    return `<div class="card tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>` +
      (delta != null ? `<div class="tile-delta ${cls}">${delta}</div>` : '') + extra + `</div>`;
  }

  function weightAtOrBefore(list, t) {
    let r = null; for (const e of list) if (ts(e.date) <= t) r = e; return r;
  }

  function pace(list) { // kg/week, least-squares over the last 8 weeks
    const last = ts(list[list.length - 1].date);
    const pts = list.filter(e => ts(e.date) >= last - 56 * 864e5);
    if (pts.length < 3) return null;
    const xs = pts.map(e => ts(e.date) / (7 * 864e5)), ys = pts.map(e => e.weight);
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let num = 0, den = 0; xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    return den ? num / den : null;
  }

  function renderDashboard() {
    const w = weighed();
    const empty = !w.length;
    $('#empty-state').hidden = !empty;
    $('#dash-content').hidden = empty;
    if (empty) return;

    const first = w[0], last = w[w.length - 1], prev = w[w.length - 2];
    $('#hero-weight').textContent = fmtNum(last.weight, 2);
    $('#hero-date').textContent = fmtDate(last);
    $('#hero-delta').innerHTML = prev
      ? `<span class="${last.weight <= prev.weight ? 'good' : 'neutral'}">${signed(last.weight - prev.weight)} kg</span> since ${fmtDate(prev, { day: 'numeric', month: 'short' })}`
      : '';

    const tiles = [];
    const total = last.weight - first.weight;
    tiles.push(tile('Total change', `${signed(total)} kg`, `since ${fmtDate(first, { day: 'numeric', month: 'short' })}`, null));
    const ref30 = weightAtOrBefore(w, ts(last.date) - 30 * 864e5);
    if (ref30) tiles.push(tile('Last 30 days', `${signed(last.weight - ref30.weight)} kg`, `from ${fmtNum(ref30.weight, 2)} kg`, null));
    const p = pace(w);
    if (p != null) tiles.push(tile('Pace', `${signed(p, 2)} kg/wk`, 'trend over last 8 weeks', null));

    const comp = state.entries.filter(e => typeof e.bodyFatPct === 'number');
    if (comp.length) {
      const a = comp[0], b = comp[comp.length - 1];
      tiles.push(tile('Body fat', `${fmtNum(b.bodyFatPct)}%`, comp.length > 1 ? `${signed(b.bodyFatPct - a.bodyFatPct, 1)} pts since ${fmtDate(a, { day: 'numeric', month: 'short' })}` : null, b.bodyFatPct < a.bodyFatPct));
    }
    const mm = state.entries.filter(e => typeof e.muscleMass === 'number');
    if (mm.length) {
      const a = mm[0], b = mm[mm.length - 1];
      tiles.push(tile('Muscle mass', `${fmtNum(b.muscleMass)} kg`, mm.length > 1 ? `${signed(b.muscleMass - a.muscleMass, 1)} kg since ${fmtDate(a, { day: 'numeric', month: 'short' })}` : null, b.muscleMass >= a.muscleMass));
    }
    if (state.goal) {
      const toGo = last.weight - state.goal;
      const pct = Math.max(0, Math.min(1, (first.weight - last.weight) / (first.weight - state.goal || 1)));
      const eta = p && p < 0 && toGo > 0 ? ` · ~${Math.ceil(toGo / -p)} wks at this pace` : '';
      tiles.push(tile('Goal', toGo > 0 ? `${fmtNum(toGo, 2)} kg to go` : 'Reached 🎉', `${Math.round(pct * 100)}% of the way to ${fmtNum(state.goal, 2)} kg${eta}`, null,
        `<div class="meter" role="meter" aria-valuenow="${Math.round(pct * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct * 100}%"></i></div>`));
    } else {
      tiles.push(`<button class="card tile tile-cta" data-tab-go="settings"><div class="tile-label">Goal</div><div class="tile-value small">Set a goal weight →</div></button>`);
    }
    $('#tiles').innerHTML = tiles.join('');

    const bf = comp[comp.length - 1], m2 = mm[mm.length - 1];
    $('#bf-now').textContent = bf ? `${fmtNum(bf.bodyFatPct)}%` : '';
    $('#mm-now').textContent = m2 ? `${fmtNum(m2.muscleMass)} kg` : '';

    Charts.render(state.entries, { goal: state.goal, range: state.range, anyMetric: state.anyMetric });
  }

  // ---------- history ----------
  function renderHistory() {
    const list = [...state.entries].reverse();
    const prevWeight = {};
    let pw = null;
    for (const e of state.entries) { prevWeight[e.id] = pw; if (typeof e.weight === 'number') pw = e.weight; }
    $('#history-list').innerHTML = list.length ? list.map(e => {
      const d = (typeof e.weight === 'number' && prevWeight[e.id] != null) ? e.weight - prevWeight[e.id] : null;
      const details = METRICS.filter(m => m.key !== 'weight' && e[m.key] != null)
        .map(m => `<div><span>${m.label}</span><b>${esc(m.text ? e[m.key] : fmtNum(e[m.key], 2))}${m.unit && m.unit !== 'yrs' ? ' ' + m.unit : ''}</b></div>`).join('');
      const src = { excel: 'From Excel', screenshot: 'From screenshot', manual: 'Manual entry' }[e.source] || '';
      const sel = state.selected.has(e.id);
      return `<li class="card h-item${sel ? ' selected' : ''}" data-id="${e.id}">
        <div class="h-top">
          ${state.selecting ? `<span class="h-check${sel ? ' on' : ''}" aria-hidden="true"></span>` : ''}
          <button class="h-row" aria-expanded="false" ${state.selecting ? `aria-pressed="${sel}"` : ''}>
            <span class="h-date">${esc(fmtDate(e))}${e.approxDate ? ' <em>approx.</em>' : ''}</span>
            <span class="h-weight">${e.weight != null ? fmtNum(e.weight, 2) + ' kg' : '–'}</span>
            <span class="chip ${d == null ? '' : d <= 0 ? 'good' : 'neutral'}">${d == null ? '' : signed(d) }</span>
          </button>
          ${state.selecting ? '' : `<button class="h-trash" data-delete="${e.id}" aria-label="Delete entry for ${esc(fmtDate(e))}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>`}
        </div>
        <div class="h-details" hidden>
          ${details ? `<div class="kv">${details}</div>` : '<p class="muted">Weight only</p>'}
          <div class="h-actions"><span class="muted small">${src}</span>
            <button class="btn-ghost" data-edit="${e.id}">Edit</button></div>
        </div></li>`;
    }).join('') : '<li class="muted center">No entries yet.</li>';

    $('#btn-select').textContent = state.selecting ? 'Done' : 'Select';
    $('#btn-select').hidden = !list.length;
    $('#btn-manual').hidden = state.selecting;
    $('#select-bar').hidden = !state.selecting;
    document.body.classList.toggle('selecting', state.selecting);
    const n = state.selected.size;
    $('#btn-del-sel').disabled = !n;
    $('#btn-del-sel').textContent = n ? `Delete ${n} entr${n > 1 ? 'ies' : 'y'}` : 'Delete';
    $('#btn-sel-all').textContent = n === list.length && n ? 'Clear' : 'Select all';
  }

  // Deletes entries right away and offers Undo (the dashboard and charts recalculate from what's left).
  async function deleteEntries(ids) {
    const removed = state.entries.filter(e => ids.includes(e.id));
    if (!removed.length) return;
    for (const e of removed) await Store.remove(e.id);
    await reload();
    state.selected.clear();
    renderHistory();
    const label = removed.length === 1 ? `Deleted ${fmtDate(removed[0])}` : `Deleted ${removed.length} entries`;
    toast(label, 'Undo', async () => {
      for (const e of removed) await Store.put(e);   // same ids, so everything comes back exactly
      await reload();
      if (state.view === 'history') renderHistory(); else if (state.view === 'dashboard') renderDashboard();
      toast('Restored');
    });
  }

  // ---------- review / entry form ----------
  function buildFields() {
    $('#review-fields').innerHTML = METRICS.map(m => m.text
      ? `<label class="field" data-key="${m.key}"><span>${m.label}</span><input name="${m.key}" list="bt-list" autocapitalize="words"><small></small></label>`
      : `<label class="field" data-key="${m.key}"><span>${m.label}${m.unit ? ` <em>${m.unit}</em>` : ''}</span><input name="${m.key}" type="number" inputmode="decimal" step="any"><small></small></label>`
    ).join('') + `<datalist id="bt-list">${BODY_TYPES.map(b => `<option value="${b}">`).join('')}</datalist>`;
  }

  function readForm() {
    const f = $('#review-form'), rec = { date: f.date.value };
    for (const m of METRICS) {
      const v = f[m.key].value.trim();
      if (v === '') continue;
      rec[m.key] = m.text ? v : parseFloat(v.replace(',', '.'));
    }
    return rec;
  }

  function refreshFlags() {
    const rec = readForm(), r = state.review;
    const prev = [...weighed()].filter(e => e.id !== r.editId && e.date <= (rec.date || '9999')).pop();
    const flags = EufyParser.validate(rec, prev, r.confidence || {});
    for (const m of METRICS) {
      const el = $(`.field[data-key="${m.key}"]`), small = el.querySelector('small');
      const missing = rec[m.key] === undefined;
      el.classList.toggle('flag', !!flags[m.key]);
      el.classList.toggle('missing', missing && r.fromOcr);
      small.textContent = flags[m.key] || (missing && r.fromOcr ? 'Not found in screenshot' : '');
    }
    return flags;
  }

  function openReview({ title, entry = {}, editId = null, fromOcr = false, confidence = {} }) {
    state.review = { editId, fromOcr, confidence, source: entry.source || (fromOcr ? 'screenshot' : 'manual'), keep: entry };
    $('#review-title').textContent = title;
    const f = $('#review-form'); f.reset();
    f.date.value = entry.date || today();
    for (const m of METRICS) if (entry[m.key] != null) f[m.key].value = entry[m.key];
    show('review');
    refreshFlags();
  }

  // ---------- upload step 1: pick the date ----------
  const isoDaysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  function setUploadDate(iso) {
    $('#upload-date').value = iso;
    $('#upload-date-label').textContent = iso
      ? new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : 'Choose a date';
    $$('.chip-btn').forEach(c => c.classList.toggle('on', isoDaysAgo(+c.dataset.day) === iso));
  }

  function openUploadSheet() {
    $('#upload-date').max = today();
    setUploadDate(today());
    $('#upload-sheet').showModal();
  }

  async function startUpload(files) {
    if (!files.length) return;
    const date = state.uploadDate || today();
    openReview({ title: 'New entry', fromOcr: true, entry: { date } });
    $('#review-thumbs').innerHTML = files.map(f => `<img src="${URL.createObjectURL(f)}" alt="Screenshot">`).join('');
    const note = $('#review-note'); note.hidden = true;
    const prog = $('#ocr-progress'); prog.hidden = false;
    $('#review-form').classList.add('busy');
    try {
      const r = await OCR.read(files, (msg, p) => { $('#ocr-status').textContent = msg; $('#ocr-bar').style.width = `${Math.round((p || 0) * 100)}%`; });
      state.review.confidence = r.confidence;
      const f = $('#review-form');
      for (const k in r.values) f[k].value = r.values[k];
      const found = Object.keys(r.values).length;
      const flags = refreshFlags();
      const nFlags = Object.keys(flags).length;
      note.className = 'note ' + (found >= 10 && !nFlags ? 'ok' : 'warn');
      note.innerHTML = found
        ? `<b>Read ${found} of ${METRICS.length} values.</b> ${nFlags ? `Check the ${nFlags} highlighted field${nFlags > 1 ? 's' : ''}, then Save.` : 'Looks good, so check the values and tap Save.'}` +
          `<br>Date: <b>${esc(new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</b>`
        : `<b>Couldn't read values from this image.</b> You can type them in below.`;
      note.hidden = false;
      console.debug('OCR text:\n' + r.text);
    } catch (e) {
      console.error(e);
      note.className = 'note warn'; note.innerHTML = `<b>Text recognition failed.</b> ${esc(e.message || e)}. You can still type the values in.`; note.hidden = false;
    } finally {
      prog.hidden = true; $('#review-form').classList.remove('busy');
    }
  }

  async function saveReview() {
    const f = $('#review-form');
    if (!f.date.value) { toast('Please set a date'); f.date.focus(); return; }
    const rec = readForm();
    if (rec.weight === undefined) { toast('Weight is required'); f.weight.focus(); return; }
    const r = state.review;
    const entry = { ...rec, source: r.source };
    if (r.editId != null) {
      entry.id = r.editId;
      // Keep the original approximate-date label only if the date was not changed.
      if (r.keep.approxDate && r.keep.date === rec.date) { entry.approxDate = true; entry.dateLabel = r.keep.dateLabel; }
    } else {
      const same = state.entries.find(e => e.date === rec.date);
      if (same && confirm(`There is already an entry for ${fmtDate(same)} (${same.weight ?? '–'} kg).\n\nOK = replace it\nCancel = keep both`)) entry.id = same.id;
    }
    await Store.put(entry);
    await reload();
    toast(r.editId != null ? 'Entry updated' : 'Entry added ✓');
    $('#review-thumbs').innerHTML = ''; $('#review-note').hidden = true;
    show(r.editId != null ? 'history' : 'dashboard');
  }

  // ---------- settings ----------
  async function renderSettings() {
    $('#goal-input').value = state.goal ?? '';
    $('#count-label').textContent = `${state.entries.length} entries`;
    let info = '';
    if (navigator.storage && navigator.storage.persisted) {
      const p = await navigator.storage.persisted();
      info = p ? 'Storage: persistent ✓' : 'Storage: best-effort. Install to Home Screen to keep data safe.';
    }
    $('#storage-info').textContent = info;
  }

  async function doExport() {
    if (!state.entries.length) return toast('Nothing to export yet');
    try { const r = await Excel.exportAll(state.entries); if (r !== 'cancelled') toast('Excel file ready'); }
    catch (e) { console.error(e); toast('Export failed: ' + e.message); }
  }

  async function doImport(file) {
    try {
      const list = await Excel.importFile(file);
      if (!list.length) return toast('No rows found in that file');
      if (state.entries.length && !confirm(`Replace all ${state.entries.length} current entries with ${list.length} entries from "${file.name}"?`)) return;
      await Store.replaceAll(list);
      await reload();
      toast(`Imported ${list.length} entries`);
      show('dashboard');
    } catch (e) { console.error(e); toast('Import failed: ' + e.message); }
  }

  // ---------- full-screen chart ----------
  // Controls (range buttons, metric picker, legend) move into the full-screen header and go back on close.
  const full = { id: null, moved: [], ranges: {} };   // ranges: per-chart choice in full screen, kept while the app is open
  const FULL_RANGE = ['chart-bf', 'chart-mm', 'chart-any'];
  const EXPAND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function openFull(id, fromHistory = false) {
    closeFull();
    const card = $('#' + id).closest('.chart-card');
    if (!Charts.expand(id, 'chart-full-canvas', full.ranges[id])) return toast('Not enough data for this chart yet');
    full.id = id;
    $('#full-title').textContent = card.querySelector('h3').textContent;
    const sub = card.querySelector('p.sub');
    $('#full-sub').textContent = sub ? sub.textContent : '';
    full.moved = [...card.querySelector('.chart-head').children]
      .filter(n => n.tagName !== 'H3' && !n.classList.contains('expand-btn'))
      .map(n => ({ n, parent: n.parentNode, next: n.nextSibling }));
    full.moved.forEach(m => $('#full-tools').append(m.n));
    if (FULL_RANGE.includes(id)) {
      const on = full.ranges[id] || 'all';
      $('#full-tools').insertAdjacentHTML('beforeend', `<div class="seg" id="full-range" role="tablist">` +
        [['30', '1M'], ['90', '3M'], ['all', 'All']].map(([v, l]) => `<button data-full-range="${v}"${String(on) === v ? ' class="on"' : ''}>${l}</button>`).join('') + `</div>`);
    }
    $('#chart-full').hidden = false;
    document.body.classList.add('full-open');
    if (!fromHistory) history.pushState({ chart: id }, '', '#chart');   // the phone's Back button closes it
    $('#chart-full').focus({ preventScroll: true });
  }

  function closeFull() {
    if (!full.id) return;
    full.moved.forEach(m => m.parent.insertBefore(m.n, m.next));
    full.moved = []; full.id = null;
    $('#full-range')?.remove();
    Charts.close('chart-full-canvas');
    $('#chart-full').hidden = true;
    document.body.classList.remove('full-open');
  }

  // Redraws the dashboard and, if open, the full-screen copy (after range/metric/theme changes).
  function redrawCharts() {
    if (state.view === 'dashboard') renderDashboard();
    if (full.id && !Charts.expand(full.id, 'chart-full-canvas', full.ranges[full.id])) history.back();
  }

  // ---------- theme ----------
  const THEME_COLORS = { light: '#f9f9f7', dark: '#0d0d0d' };

  function applyTheme(pref) {
    const root = document.documentElement;
    if (pref === 'light' || pref === 'dark') root.dataset.theme = pref; else delete root.dataset.theme;
    // Keep the phone's status-bar color in step with a forced theme.
    $$('meta[name="theme-color"]').forEach(m => {
      const own = m.media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light;
      m.content = THEME_COLORS[pref] || own;
    });
    $$('#theme-seg button').forEach(b => {
      const on = b.dataset.themePick === (pref || 'system');
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    });
  }
  const savedTheme = () => { try { return localStorage.getItem('theme') || 'system'; } catch { return 'system'; } };

  // ---------- data ----------
  async function reload() { state.entries = await Store.all(); }

  async function firstRun() {
    if (state.entries.length || (await Store.getSetting('seeded', false))) return;
    try {
      const res = await fetch('data/seed.json', { cache: 'no-store' });
      if (res.ok) { await Store.replaceAll(await res.json()); await reload(); }
    } catch { /* no seed file published, so the user imports the Excel instead */ }
    await Store.setSetting('seeded', true);
  }

  // ---------- events ----------
  document.addEventListener('click', async ev => {
    const t = ev.target.closest('button, [data-tab-go]');
    if (!t) return;
    if (t.dataset.tab) return show(t.dataset.tab);
    if (t.dataset.tabGo) return show(t.dataset.tabGo);
    if (t.dataset.day !== undefined) return setUploadDate(isoDaysAgo(+t.dataset.day));
    if (t.dataset.expand) return openFull(t.dataset.expand);
    if (t.dataset.themePick) {
      try { localStorage.setItem('theme', t.dataset.themePick); } catch {}
      applyTheme(t.dataset.themePick);
      return redrawCharts();
    }
    if (t.dataset.fullRange) {
      full.ranges[full.id] = t.dataset.fullRange === 'all' ? 'all' : +t.dataset.fullRange;
      $$('#full-range button').forEach(b => b.classList.toggle('on', b === t));
      return Charts.expand(full.id, 'chart-full-canvas', full.ranges[full.id]);
    }
    if (t.dataset.range) {
      state.range = t.dataset.range === 'all' ? 'all' : +t.dataset.range;
      $$('#range-seg button').forEach(b => b.classList.toggle('on', b === t));
      return redrawCharts();
    }
    if (t.dataset.edit) {
      const e = state.entries.find(x => x.id === +t.dataset.edit);
      return openReview({ title: 'Edit entry', entry: e, editId: e.id });
    }
    if (t.dataset.delete) return deleteEntries([+t.dataset.delete]);
    if (t.classList.contains('h-row') && state.selecting) {
      const id = +t.closest('.h-item').dataset.id;
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
      return renderHistory();
    }
    if (t.classList.contains('h-row')) {
      const item = t.closest('.h-item'), d = item.querySelector('.h-details');
      d.hidden = !d.hidden; item.classList.toggle('open', !d.hidden); t.setAttribute('aria-expanded', String(!d.hidden)); return;
    }
    switch (t.dataset.action) {
      case 'upload': openUploadSheet(); break;
      case 'choose-shot': {
        const d = $('#upload-date').value;
        if (!d) { toast('Please pick a date first'); break; }
        state.uploadDate = d;
        $('#upload-sheet').close();
        $('#file-shot').value = ''; $('#file-shot').click();
        break;
      }
      case 'close-sheet': $('#upload-sheet').close(); break;
      case 'close-full': history.state && history.state.chart ? history.back() : closeFull(); break;
      case 'select-mode':
        state.selecting = !state.selecting; state.selected.clear(); renderHistory(); break;
      case 'select-all':
        if (state.selected.size === state.entries.length) state.selected.clear();
        else state.entries.forEach(e => state.selected.add(e.id));
        renderHistory(); break;
      case 'delete-selected': {
        const n = state.selected.size;
        if (n && (n === 1 || confirm(`Delete ${n} entries? You can undo right after.`))) {
          await deleteEntries([...state.selected]);
          state.selecting = false; renderHistory();
        }
        break;
      }
      case 'manual': openReview({ title: 'Manual entry' }); break;
      case 'save-review': saveReview(); break;
      case 'cancel-review': $('#review-thumbs').innerHTML = ''; show(state.review && state.review.editId != null ? 'history' : 'dashboard'); break;
      case 'export': doExport(); break;
      case 'import': $('#file-xlsx').value = ''; $('#file-xlsx').click(); break;
      case 'wipe':
        if (confirm('Delete ALL entries from this device? Export to Excel first if you want a backup.') && confirm('Are you sure? This cannot be undone.')) {
          await Store.clear(); await reload(); toast('All data deleted'); show('dashboard');
        }
        break;
    }
  });

  $('#file-shot').addEventListener('change', e => startUpload([...e.target.files]));
  $('#upload-date').addEventListener('change', e => setUploadDate(e.target.value));
  // Tap anywhere on the date field (icon or text) opens the calendar.
  $('#date-btn').addEventListener('click', () => {
    const inp = $('#upload-date');
    try { inp.showPicker(); } catch { inp.focus(); }
  });
  // Tap on the dimmed backdrop closes the sheet.
  $('#upload-sheet').addEventListener('click', e => { if (e.target.id === 'upload-sheet') e.target.close(); });
  $('#file-xlsx').addEventListener('change', e => e.target.files[0] && doImport(e.target.files[0]));
  $('#review-form').addEventListener('input', refreshFlags);
  $('#review-form').addEventListener('submit', e => { e.preventDefault(); saveReview(); });
  $('#goal-input').addEventListener('change', async e => {
    const v = parseFloat(e.target.value);
    state.goal = isFinite(v) && v > 0 ? v : null;
    await Store.setSetting('goal', state.goal);
    toast(state.goal ? `Goal set to ${fmtNum(state.goal, 2)} kg` : 'Goal cleared');
  });
  $('#metric-pick').addEventListener('change', async e => {
    state.anyMetric = e.target.value; await Store.setSetting('anyMetric', state.anyMetric);
    redrawCharts();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawCharts);
  // Tap a chart itself to open it full screen.
  $('#dash-content').addEventListener('click', e => {
    const box = e.target.closest('.chart-box');
    if (box) openFull(box.querySelector('canvas').id);
  });
  window.addEventListener('popstate', e => {
    if (e.state && e.state.chart && state.view === 'dashboard') openFull(e.state.chart, true); else closeFull();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && full.id) history.state && history.state.chart ? history.back() : closeFull(); });

  // ---------- boot ----------
  (async () => {
    applyTheme(savedTheme());
    $$('.chart-card').forEach(card => {
      const id = card.querySelector('canvas').id, name = card.querySelector('h3').textContent;
      card.querySelector('.chart-head').insertAdjacentHTML('beforeend',
        `<button class="expand-btn" data-expand="${id}" aria-label="Open ${esc(name)} full screen">${EXPAND_ICON}</button>`);
    });
    if (location.hash === '#chart') history.replaceState(null, '', location.pathname + location.search);
    buildFields();
    $('#metric-pick').innerHTML = METRICS.filter(m => !m.text && !['weight', 'bodyFatPct', 'muscleMass'].includes(m.key))
      .map(m => `<option value="${m.key}">${m.label}</option>`).join('');
    await reload();
    await firstRun();
    state.goal = await Store.getSetting('goal', null);
    state.anyMetric = await Store.getSetting('anyMetric', 'waterPct');
    $('#metric-pick').value = state.anyMetric;
    show('dashboard');
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(console.warn);
  })();
})();
