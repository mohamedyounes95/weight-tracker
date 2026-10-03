// Excel import/export (SheetJS). Export uses the same columns as the original
// weight-history spreadsheet, so the file looks the same, with new rows added.
const Excel = (() => {
  const { METRICS } = Metrics;
  const HEADERS = ['Date', ...METRICS.map(m => m.header), 'Change vs Previous (kg)', 'Change vs Previous (%)'];
  const pad = n => String(n).padStart(2, '0');
  const ddmmyyyy = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

  function buildWorkbook(entries) {
    const rows = [HEADERS];
    let prevW = null;
    for (const e of entries) {
      const row = [e.dateLabel || ddmmyyyy(e.date), ...METRICS.map(m => e[m.key] ?? null)];
      if (e.weight != null && prevW != null) {
        row.push(Math.round((e.weight - prevW) * 100) / 100, (e.weight - prevW) / prevW);
      } else row.push(null, null);
      if (e.weight != null) prevW = e.weight;
      rows.push(row);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const pctCol = HEADERS.length - 1;
    for (let r = 1; r < rows.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: pctCol })];
      if (cell) cell.z = '0.00%';
    }
    ws['!cols'] = HEADERS.map(h => ({ wch: Math.max(10, h.length + 2) }));
    ws['!freeze'] = { xSplit: 1, ySplit: 1 };

    const notes = XLSX.utils.aoa_to_sheet([
      ['Note', 'Details'],
      ['Blank cells', 'The metric was not available/recorded for that date, so it was left blank rather than estimated.'],
      ['Change columns', 'Calculated against the previous entry that has a weight.'],
      ['Sources', 'Rows come from the original Excel history, Eufy Life screenshots read by the app, or manual entry.'],
      ['Exported', new Date().toLocaleString()],
    ]);
    notes['!cols'] = [{ wch: 18 }, { wch: 100 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Weight History');
    XLSX.utils.book_append_sheet(wb, notes, 'Notes');
    return wb;
  }

  async function exportAll(entries) {
    const wb = buildWorkbook(entries);
    const d = new Date();
    const name = `Weight_Body_Composition_History_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    // On iPhone the share sheet lets you "Save to Files", AirDrop, WhatsApp, Mail…
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return 'shared'; }
      catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
    }
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'downloaded';
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function parseDate(v) {
    if (v instanceof Date && !isNaN(v)) return { date: `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` };
    if (typeof v === 'number') { const p = XLSX.SSF.parse_date_code(v); return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}` }; }
    const s = String(v || '').trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return { date: `${m[1]}-${pad(m[2])}-${pad(m[3])}` };
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/))) return { date: `${m[3]}-${pad(m[2])}-${pad(m[1])}` };
    if ((m = s.match(/^(early|mid|late)?\s*([a-z]+)\s+(\d{4})$/i))) {
      const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
      if (mi >= 0) {
        const day = { early: 2, mid: 15, late: 25 }[(m[1] || 'mid').toLowerCase()];
        return { date: `${m[3]}-${pad(mi + 1)}-${pad(day)}`, approxDate: true, dateLabel: s };
      }
    }
    return null;
  }

  async function importFile(file) {
    if (/\.json$/i.test(file.name)) {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error('JSON file must contain a list of entries');
      return data.filter(e => e.date);
    }
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const ws = wb.Sheets['Weight History'] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const hi = rows.findIndex(r => r.some(c => norm(c || '') === 'date'));
    if (hi < 0) throw new Error('Could not find a "Date" column');
    const head = rows[hi].map(h => norm(h || ''));
    const col = {};
    head.forEach((h, i) => {
      if (h === 'date') col.date = i;
      const m = METRICS.find(m => norm(m.header) === h || norm(m.label) === h);
      if (m) col[m.key] = i;
    });
    const out = [];
    for (const r of rows.slice(hi + 1)) {
      const d = parseDate(r[col.date]);
      if (!d) continue;
      const e = { ...d, source: 'excel' };
      let any = false;
      for (const m of METRICS) {
        if (col[m.key] === undefined) continue;
        let v = r[col[m.key]];
        if (v === null || v === '') continue;
        if (!m.text) { v = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); if (!isFinite(v)) continue; }
        e[m.key] = v; any = true;
      }
      // A visceral-fat score typed into the bone-mass column (bone mass is never above ~8 kg).
      if (e.boneMass > 8 && e.visceralFat === undefined) { e.visceralFat = e.boneMass; delete e.boneMass; }
      if (any) out.push(e);
    }
    return out;
  }

  return { exportAll, importFile, buildWorkbook };
})();
