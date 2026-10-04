// Dashboard charts (Chart.js). Colors come from CSS tokens so light/dark mode both work.
const Charts = (() => {
  const instances = {}, builders = {};
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const DAY = 86400000;
  const ts = iso => new Date(iso + 'T12:00:00').getTime();
  const fmtDay = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const fmtNum = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

  function tokens() {
    return {
      s1: css('--series-1'), s2: css('--series-2'), surface: css('--surface-1'),
      ink: css('--text-primary'), ink2: css('--text-secondary'), muted: css('--text-muted'),
      grid: css('--grid'), axis: css('--axis'), wash: css('--series-1-wash'),
    };
  }

  function applyDefaults(t) {
    Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    Chart.defaults.font.size = 11;
    Chart.defaults.color = t.muted;
    Chart.defaults.animation.duration = 300;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.display = false;
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: t.surface, titleColor: t.ink, bodyColor: t.ink2, borderColor: t.axis, borderWidth: 1,
      padding: 10, cornerRadius: 8, displayColors: false, titleFont: { weight: '600' }, caretSize: 0,
    });
  }

  // Vertical crosshair at the hovered point (line charts).
  const crosshair = {
    id: 'crosshair',
    afterDatasetsDraw(chart) {
      const a = chart.tooltip && chart.tooltip.getActiveElements();
      if (!a || !a.length) return;
      const { ctx, chartArea: { top, bottom } } = chart, x = a[0].element.x;
      ctx.save(); ctx.strokeStyle = tokens().axis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore();
    },
  };

  // Horizontal goal reference line with a label.
  const goalLine = {
    id: 'goalLine',
    afterDatasetsDraw(chart, _, opts) {
      if (opts.value == null) return;
      const y = chart.scales.y.getPixelForValue(opts.value);
      const { ctx, chartArea: { left, right, top, bottom } } = chart;
      if (y < top || y > bottom) return;
      const t = tokens();
      ctx.save(); ctx.strokeStyle = t.ink2; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = t.ink2; ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'right'; ctx.fillText(`Goal ${fmtNum(opts.value, 2)} kg`, right - 2, y - 5); ctx.restore();
    },
  };

  // Value label at the end of the last point (line) or at each bar tip.
  const endLabel = {
    id: 'endLabel',
    afterDatasetsDraw(chart, _, opts) {
      if (!opts.show) return;
      const t = tokens(), { ctx } = chart, meta = chart.getDatasetMeta(0), ds = chart.data.datasets[0];
      ctx.save(); ctx.fillStyle = t.ink; ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      if (opts.show === 'last') {
        const el = meta.data[meta.data.length - 1]; if (!el) return ctx.restore();
        const v = ds.data[ds.data.length - 1]; const val = typeof v === 'object' ? v.y : v;
        // Halo in the surface color keeps the label legible where it crosses the line.
        ctx.textAlign = 'right'; ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = t.surface;
        ctx.strokeText(opts.fmt(val), el.x - 4, el.y - 11); ctx.fillText(opts.fmt(val), el.x - 4, el.y - 11);
      } else {
        meta.data.forEach((el, i) => {
          const v = ds.data[i]; const neg = v < 0;
          ctx.textAlign = neg ? 'right' : 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(opts.fmt(v), el.x + (neg ? -6 : 6), el.y);
        });
      }
      ctx.restore();
    },
  };

  // Charts are built from a stored function so the same chart can be redrawn full screen.
  function make(id, build) {
    builders[id] = build;
    if (instances[id]) instances[id].destroy();
    instances[id] = new Chart(document.getElementById(id), build());
  }

  // Draws the dashboard chart `id` onto another canvas (the full-screen view), optionally limited to the
  // last `range` days. Returns false if there is no chart.
  function expand(id, canvasId, range = 'all') {
    if (instances[canvasId]) { instances[canvasId].destroy(); delete instances[canvasId]; }
    if (!builders[id]) return false;
    const t = tokens(); applyDefaults(t);
    instances[canvasId] = new Chart(document.getElementById(canvasId), builders[id](true, range));
    return true;
  }

  function close(canvasId) {
    if (instances[canvasId]) { instances[canvasId].destroy(); delete instances[canvasId]; }
  }

  function lineConfig(points, t, { unit, decimals = 1, goal = null, minSpanDays = 0 }) {
    const xs = points.map(p => p.x);
    let xmin = Math.min(...xs), xmax = Math.max(...xs);
    if (xmax - xmin < minSpanDays * DAY) xmin = xmax - minSpanDays * DAY;
    return {
      type: 'line',
      data: { datasets: [{
        data: points, borderColor: t.s1, borderWidth: 2, tension: 0.25, borderCapStyle: 'round', borderJoinStyle: 'round',
        pointRadius: points.length > 40 ? 0 : 4, pointHoverRadius: 6, pointBackgroundColor: t.s1,
        pointBorderColor: t.surface, pointBorderWidth: 2, pointHitRadius: 16,
        fill: true, backgroundColor: t.wash,
      }] },
      options: {
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        layout: { padding: { top: 18, right: 6 } },
        scales: {
          x: { type: 'linear', min: xmin - DAY, max: xmax + DAY, grid: { display: false }, border: { color: t.axis },
               ticks: { maxTicksLimit: 5, callback: v => fmtDay(v), maxRotation: 0 } },
          y: { grace: '8%', grid: { color: t.grid }, border: { display: false },
               ticks: { maxTicksLimit: 5, callback: v => fmtNum(v, decimals), font: { variant: 'tabular-nums' } } },
        },
        plugins: {
          tooltip: { callbacks: {
            title: items => new Date(items[0].parsed.x).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
            label: item => `${fmtNum(item.parsed.y, decimals === 1 ? 2 : decimals)} ${unit}`.trim(),
          } },
          goalLine: { value: goal },
          endLabel: { show: 'last', fmt: v => `${fmtNum(v, decimals === 1 ? 2 : decimals)} ${unit}`.trim() },
        },
      },
      plugins: [crosshair, goalLine, endLabel],
    };
  }

  // Keeps the last `range` days counted back from the newest point ('all' keeps everything).
  const clip = (points, range) => {
    if (range === 'all' || !points.length) return points;
    const cut = points[points.length - 1].x - range * DAY;
    return points.filter(p => p.x >= cut);
  };

  const series = (entries, key) => entries.filter(e => typeof e[key] === 'number').map(e => ({ x: ts(e.date), y: e[key] }));

  function weekly(entries) {
    const weeks = new Map();
    for (const e of entries) {
      if (typeof e.weight !== 'number') continue;
      const d = new Date(e.date + 'T12:00:00');
      const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const k = monday.toISOString().slice(0, 10);
      if (!weeks.has(k)) weeks.set(k, []);
      weeks.get(k).push(e);
    }
    return [...weeks.entries()].map(([k, v]) => ({ week: k, avg: v.reduce((a, e) => a + e.weight, 0) / v.length, days: v.map(e => e.date) }));
  }

  function render(entries, { goal, range, anyMetric }) {
    const t = tokens(); applyDefaults(t);

    // Weight trend (with range filter)
    const w = clip(series(entries, 'weight'), range);
    make('chart-weight', () => lineConfig(w, t, { unit: 'kg', goal, minSpanDays: 7 }));

    // These three show everything on the dashboard; the full-screen view can pick a range.
    make('chart-bf', (big, r = 'all') => lineConfig(clip(series(entries, 'bodyFatPct'), r), t, { unit: '%' }));
    make('chart-mm', (big, r = 'all') => lineConfig(clip(series(entries, 'muscleMass'), r), t, { unit: 'kg' }));
    const m = Metrics.byKey[anyMetric];
    make('chart-any', (big, r = 'all') => lineConfig(clip(series(entries, anyMetric), r), t, { unit: m.unit, decimals: m.step >= 1 ? 0 : 1 }));

    // Where did the weight go: change since first full body-composition scan
    const full = entries.filter(e => typeof e.bodyFatMass === 'number' && typeof e.leanMass === 'number' && typeof e.weight === 'number');
    const sub = document.getElementById('split-sub');
    if (full.length >= 2) {
      const a = full[0], b = full[full.length - 1];
      const dw = b.weight - a.weight, df = b.bodyFatMass - a.bodyFatMass, dl = b.leanMass - a.leanMass;
      const share = dw < 0 && df < 0 ? Math.round(Math.min(1, df / dw) * 100) : null;
      sub.textContent = `Since your first full scan on ${fmtDay(ts(a.date))}` + (share !== null ? `, about ${share}% of the weight lost was fat.` : '.');
      make('chart-split', () => ({
        type: 'bar',
        data: { labels: ['Weight', 'Fat mass', 'Lean mass'], datasets: [{
          data: [dw, df, dl].map(v => Math.round(v * 100) / 100), backgroundColor: t.s1, maxBarThickness: 22,
          borderRadius: 4, borderSkipped: 'start',
        }] },
        options: {
          indexAxis: 'y', layout: { padding: { left: 0, right: 8 } },
          scales: {
            x: { grid: { color: t.grid }, border: { display: false }, suggestedMin: Math.min(0, dw, df, dl) * 1.6, suggestedMax: Math.max(0, dw, df, dl) * 1.6, ticks: { maxTicksLimit: 5, callback: v => `${fmtNum(v)} kg` } },
            y: { grid: { display: false }, border: { color: t.axis }, ticks: { color: t.ink2, font: { size: 12 } } },
          },
          plugins: {
            tooltip: { callbacks: { label: i => `${i.parsed.x > 0 ? '+' : ''}${fmtNum(i.parsed.x, 2)} kg` } },
            endLabel: { show: 'bars', fmt: v => `${v > 0 ? '+' : ''}${fmtNum(v, 2)} kg` },
          },
        },
        plugins: [endLabel],
      }));
    } else {
      sub.textContent = 'Needs at least two full body-composition scans.';
      if (instances['chart-split']) { instances['chart-split'].destroy(); delete instances['chart-split']; }
      delete builders['chart-split'];
    }

    // Week-over-week change of the weekly average (zero baseline; loss and gain colored by sign)
    const wk = weekly(entries);
    // Bars are Monday–Sunday weeks, labelled by the Monday they start on (more labels fit full screen).
    // The tooltip names the full range, the weigh-in days used, and flags a week that is not over yet.
    const now = Date.now();
    const ch = wk.slice(1).map((x, i) => {
      const start = ts(x.week), end = start + 6 * DAY;
      return { d: Math.round((x.avg - wk[i].avg) * 100) / 100, avg: x.avg, days: x.days,
        range: `${fmtDay(start)} – ${fmtDay(end)}`, start: fmtDay(start), open: end >= now - DAY / 2 };
    });
    make('chart-weekly', (big = false) => ({
      type: 'bar',
      data: { labels: ch.map(x => x.start), datasets: [{
        data: ch.map(x => x.d), backgroundColor: ch.map(x => x.d > 0 ? t.s2 : t.s1), maxBarThickness: 22, borderRadius: 4, borderSkipped: 'start',
      }] },
      options: {
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: big ? 14 : 6 } },
          y: { grid: { color: c => c.tick.value === 0 ? t.axis : t.grid }, border: { display: false },
               ticks: { maxTicksLimit: 5, callback: v => `${v > 0 ? '+' : ''}${fmtNum(v)}`, font: { variant: 'tabular-nums' } } },
        },
        plugins: { tooltip: { callbacks: {
          title: i => { const x = ch[i[0].dataIndex]; return `${x.range}${x.open ? ' (week in progress)' : ''}`; },
          label: i => {
            const x = ch[i.dataIndex];
            return [`${i.parsed.y > 0 ? '+' : ''}${fmtNum(i.parsed.y, 2)} kg vs previous week`, `Average ${fmtNum(x.avg, 2)} kg`,
              `${x.days.length} weigh-in${x.days.length > 1 ? 's' : ''}: ${x.days.map(d => fmtDay(ts(d))).join(', ')}`];
          },
        } } },
      },
    }));
  }

  return { render, expand, close, fmtNum, fmtDay, ts };
})();
