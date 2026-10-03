// IndexedDB storage: all data stays on this device.
const Store = (() => {
  const DB = 'weight-tracker', VER = 1;
  let dbp = null;

  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const sortByDate = list => list.sort((a, b) => a.date.localeCompare(b.date) || (a.id || 0) - (b.id || 0));

  return {
    all: () => tx('entries', 'readonly', s => req(s.getAll())).then(sortByDate),
    put: e => tx('entries', 'readwrite', s => req(s.put(e))),
    remove: id => tx('entries', 'readwrite', s => req(s.delete(id))),
    replaceAll: list => tx('entries', 'readwrite', s => { s.clear(); list.forEach(e => { const c = { ...e }; delete c.id; s.add(c); }); }),
    clear: () => tx('entries', 'readwrite', s => req(s.clear())),
    getSetting: (k, d) => tx('settings', 'readonly', s => req(s.get(k))).then(v => v === undefined ? d : v),
    setSetting: (k, v) => tx('settings', 'readwrite', s => req(s.put(v, k))),
  };
})();
