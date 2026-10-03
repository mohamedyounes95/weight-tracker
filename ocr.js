// On-device OCR for Eufy Life screenshots (Tesseract.js, fully offline; files live in vendor/).
const OCR = (() => {
  let workerPromise = null, progressFn = null;
  const abs = p => new URL(p, location.href).href;

  function getWorker(onProgress) {
    progressFn = onProgress;
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('eng', 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/'),
        langPath: abs('vendor/lang'),
        gzip: true,
        logger: m => progressFn && progressFn(m),
      }).then(async w => {
        await w.setParameters({ preserve_interword_spaces: '1' });
        return w;
      }).catch(e => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  // Draws a region scaled to at least `minW` px wide, as grayscale with stretched contrast;
  // dark-mode images are inverted so text is always dark on light.
  function enhance(src, sx, sy, sw, sh, minW, binarize = false) {
    const scale = Math.min(4, Math.max(1, minW / sw));
    const c = document.createElement('canvas');
    c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
    let sum = 0, lo = 255, hi = 0;
    const g = new Uint8ClampedArray(d.length / 4);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      g[j] = v; sum += v; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    const invert = sum / g.length < 110;
    const range = Math.max(1, hi - lo);
    for (let j = 0; j < g.length; j++) { let v = (g[j] - lo) * 255 / range; g[j] = invert ? 255 - v : v; }
    const t = binarize ? otsu(g) : -1;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) d[i] = d[i + 1] = d[i + 2] = t < 0 ? g[j] : (g[j] > t ? 255 : 0);
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Otsu threshold: splits dark text from light background (drops pale status colors and bars).
  function otsu(g) {
    const h = new Float64Array(256); for (const v of g) h[v]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i];
    let sB = 0, wB = 0, best = 0, t = 128;
    for (let i = 0; i < 256; i++) {
      wB += h[i]; if (!wB) continue;
      const wF = g.length - wB; if (!wF) break;
      sB += i * h[i];
      const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) ** 2;
      if (between > best) { best = between; t = i; }
    }
    return t;
  }

  function grayPixels(bmp) {
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data, g = new Uint8Array(c.width * c.height);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return g;
  }

  // Tesseract v5 returns blocks → paragraphs → lines → words; flatten to lines of words.
  function toLines(data) {
    const lines = [];
    if (data.blocks) {
      for (const b of data.blocks) for (const p of b.paragraphs || []) for (const l of p.lines || [])
        lines.push({ words: (l.words || []).map(w => ({ text: w.text, bbox: w.bbox, confidence: w.confidence })) });
    } else if (data.lines) {
      for (const l of data.lines) lines.push({ words: l.words.map(w => ({ text: w.text, bbox: w.bbox, confidence: w.confidence })) });
    }
    return lines.filter(l => l.words.length);
  }

  const flatWords = data => toLines(data).flatMap(l => l.words);

  // Finds the tallest line of text in a black-and-white tile (the big value) and returns it cropped.
  function valueLine(c) {
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const { width: W, height: H } = c, d = ctx.getImageData(0, 0, W, H).data;
    const dark = (x, y) => d[(y * W + x) * 4] < 128;
    const bands = []; let s = -1;
    for (let y = 0; y <= H; y++) {
      let n = 0;
      if (y < H) for (let x = 0; x < W; x += 2) if (dark(x, y)) n++;
      const on = n > W * 0.004;
      if (on && s < 0) s = y;
      if (!on && s >= 0) { bands.push([s, y]); s = -1; }
    }
    // The value sits below the label, so ignore anything starting in the top 30% (icon + label).
    const below = bands.filter(b => b[0] > H * 0.3);
    if (!below.length) return null;
    const [y0, y1] = below.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
    let x0 = W, x1 = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (dark(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    const pad = Math.round((y1 - y0) * 0.35);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 2 * pad; out.height = y1 - y0 + 2 * pad;
    const o = out.getContext('2d');
    o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height);
    o.drawImage(c, x0, y0, x1 - x0, y1 - y0, pad, pad, x1 - x0, y1 - y0);
    return out;
  }

  // Eufy Life tile layout: read every tile on its own (much more reliable than the whole page at once),
  // then re-read just the big value line as a single line of digits and units.
  async function readTiles(w, bmp, cards, onStatus) {
    const tiles = [];
    for (let i = 0; i < cards.length; i++) {
      onStatus && onStatus(`Reading tile ${i + 1} of ${cards.length}…`, i / cards.length);
      const { x0, y0, x1, y1 } = cards[i], inset = 2;
      const canvas = enhance(bmp, x0 + inset, y0 + inset, x1 - x0 - 2 * inset, y1 - y0 - 2 * inset, 700, true);
      await w.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
      const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
      const tile = { words: flatWords(data), text: data.text.replace(/\s+/g, ' ').trim() };
      const line = valueLine(canvas);
      if (line) {
        await w.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789.,%kgcalbpmK ' });
        const { data: vd } = await w.recognize(line, {}, { blocks: true, text: true });
        tile.valueWords = flatWords(vd);
        tile.text += '  ⟶ ' + vd.text.trim();
      }
      tiles.push(tile);
    }
    await w.setParameters({ tessedit_char_whitelist: '' });
    const r = EufyParser.parseCards(tiles);
    return { ...r, date: null, text: tiles.map((t, i) => `[${i + 1}] ${t.text}`).join('\n') };
  }

  // Any other layout: whole page in sparse-text mode, matched by label position.
  async function readPage(w, bmp) {
    await w.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    const canvas = enhance(bmp, 0, 0, bmp.width, bmp.height, 1000);
    const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
    return { ...EufyParser.parse(toLines(data)), text: data.text };
  }

  // Reads one or more screenshots; earlier images win when two images show the same metric.
  async function read(files, onStatus) {
    const merged = { values: {}, confidence: {}, date: null, dateFound: false, text: '' };
    const w = await getWorker(m => {
      if (m.status !== 'recognizing text') onStatus && onStatus('Preparing text recognition…', m.progress || 0);
    });
    for (let i = 0; i < files.length; i++) {
      onStatus && onStatus(files.length > 1 ? `Reading screenshot ${i + 1} of ${files.length}…` : 'Reading screenshot…', 0);
      const bmp = await createImageBitmap(files[i]);
      const cards = EufyParser.detectCards(grayPixels(bmp), bmp.width, bmp.height);
      let r = cards.length >= 4 ? await readTiles(w, bmp, cards, onStatus) : await readPage(w, bmp);
      // Not the usual tile layout, or values missing: also read the whole page and fill the gaps.
      if (cards.length >= 4 && Object.keys(r.values).length < Metrics.METRICS.length) {
        const page = await readPage(w, bmp);
        const tileCount = Object.keys(r.values).length;
        for (const k in page.values) if (r.values[k] === undefined || tileCount < 5) { r.values[k] = page.values[k]; r.confidence[k] = page.confidence[k]; }
        r.date = r.date || page.date;
        r.text += '\n--- page ---\n' + page.text;
      }
      for (const k in r.values) if (merged.values[k] === undefined) { merged.values[k] = r.values[k]; merged.confidence[k] = r.confidence[k]; }
      if (!merged.date && r.date) { merged.date = r.date; merged.dateFound = true; }
      merged.text += r.text + '\n';
    }
    return merged;
  }

  return { read, toLines };
})();
