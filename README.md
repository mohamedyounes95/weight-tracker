# Weight Tracker

A private iPhone web app for Eufy scale data: charts, Eufy Life screenshot upload (on-device OCR), and Excel export.
Everything is stored only on the phone (IndexedDB). No server and no account are needed.

## Daily use
1. Weigh on the Eufy scale, open Eufy Life, and take a screenshot of the measurement page.
2. Open **Weight** from the Home Screen, then tap **Upload Eufy screenshot** and pick the screenshot.
3. Check the values it read (anything suspicious is highlighted), then tap **Save**.
4. **Export Excel** (Dashboard or Settings) produces one .xlsx with all entries, in the same columns as the original sheet.

## Run on the PC
    python -m http.server 8765
Open http://localhost:8765. On first run it loads `data/seed.json` (your history), which only exists locally.

## Install on the iPhone (GitHub Pages, free)
1. Create a new GitHub repository and upload this folder. `.gitignore` keeps `data/seed.json`, `samples/` and `.xlsx` files out.
2. Go to the repo's Settings → Pages → Deploy from branch → `main` / root.
3. On the iPhone, open `https://<user>.github.io/<repo>/` in **Safari**, then Share → **Add to Home Screen**.
4. Open it from the Home Screen, go to Settings → **Import Excel**, and pick your weight-history Excel file (via Files/iCloud/AirDrop).
After the first load it works fully offline.

## Updating the app
After changing any file, bump `VERSION` in `sw.js` so phones fetch the new version.

## Files
`parser.js` maps OCR words to metrics (tune label aliases in `metrics.js`), `ocr.js` runs Tesseract,
`charts.js` draws the dashboard, `excel.js` handles import/export, and `store.js` holds the IndexedDB storage.
