/**
 * プリセット manifest の IndexedDB ストア。
 * localStorage の dd_preset_* は使わない（レガシー掃除のみ）。
 */
const PresetStore = (() => {
  const DB_NAME = 'digitaldrill_presets';
  const DB_VERSION = 1;
  const LEGACY_LS_PREFIX = 'dd_preset_';
  const LEGACY_VERSION_KEY = 'dd_preset_version';

  let dbPromise = null;

  function manifestKey_(mode, hash) {
    return String(mode || '') + ':' + String(hash || '');
  }

  function openDb_() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB が利用できません'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
      req.onupgradeneeded = function (ev) {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('manifests')) {
          db.createObjectStore('manifests', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
    });
    return dbPromise;
  }

  /** トランザクション完了まで待つ（大きな manifest の put/get で必須） */
  function runTx_(storeNames, mode, fn) {
    return openDb_().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(storeNames, mode);
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB tx error')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB tx aborted')); };
        let settled = false;
        function finish(val) {
          if (settled) return;
          settled = true;
          resolve(val);
        }
        function fail(err) {
          if (settled) return;
          settled = true;
          reject(err);
        }
        try {
          const out = fn(tx);
          if (out && typeof out.then === 'function') {
            out.then(finish).catch(function (e) {
              try { tx.abort(); } catch (x) { /* ignore */ }
              fail(e);
            });
          } else {
            tx.oncomplete = function () { finish(out); };
          }
        } catch (e) {
          try { tx.abort(); } catch (x) { /* ignore */ }
          fail(e);
        }
      });
    });
  }

  function reqPromise_(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB request failed')); };
    });
  }

  async function getManifestRecord_(mode, hash) {
    if (!mode || !hash) return null;
    return runTx_(['manifests'], 'readonly', function (tx) {
      const store = tx.objectStore('manifests');
      return reqPromise_(store.get(manifestKey_(mode, hash)));
    }).then(function (rec) { return rec || null; });
  }

  async function getMetaRecord_(key) {
    return runTx_(['meta'], 'readonly', function (tx) {
      return reqPromise_(tx.objectStore('meta').get(key));
    }).then(function (rec) { return rec && rec.value ? rec.value : null; });
  }

  async function putMetaRecord_(key, value) {
    await runTx_(['meta'], 'readwrite', function (tx) {
      return reqPromise_(tx.objectStore('meta').put({ key: key, value: value }));
    });
  }

  async function open() {
    return openDb_();
  }

  async function getMeta() {
    const active = await getMetaRecord_('active');
    const pending = await getMetaRecord_('pending');
    return { active: active, pending: pending };
  }

  async function getActiveMeta() {
    return getMetaRecord_('active');
  }

  async function getPendingMeta() {
    return getMetaRecord_('pending');
  }

  async function setActiveMeta(meta) {
    await putMetaRecord_('active', meta);
  }

  async function setPendingMeta(meta) {
    if (!meta) {
      await runTx_(['meta'], 'readwrite', function (tx) {
        return reqPromise_(tx.objectStore('meta').delete('pending'));
      });
      return;
    }
    await putMetaRecord_('pending', meta);
  }

  async function putManifest(mode, hash, data) {
    if (!mode || !hash || !data) return;
    await runTx_(['manifests'], 'readwrite', function (tx) {
      return reqPromise_(tx.objectStore('manifests').put({
        id: manifestKey_(mode, hash),
        mode: mode,
        hash: hash,
        data: data,
        savedAt: Date.now()
      }));
    });
  }

  async function getManifest(mode, hash) {
    const rec = await getManifestRecord_(mode, hash);
    return rec ? rec.data : null;
  }

  async function getActiveManifest(mode) {
    const active = await getActiveMeta();
    if (!active || !active.modes) return null;
    const hash = active.modes[mode];
    if (!hash) return null;
    return getManifest(mode, hash);
  }

  async function getPendingManifest(mode) {
    const pending = await getPendingMeta();
    if (!pending || !pending.modes) return null;
    const hash = pending.modes[mode];
    if (!hash) return null;
    return getManifest(mode, hash);
  }

  async function applyPending() {
    const pending = await getPendingMeta();
    if (!pending) return { applied: false, reason: 'no_pending' };
    await setActiveMeta(Object.assign({}, pending, { appliedAt: Date.now() }));
    await setPendingMeta(null);
    return { applied: true, meta: pending };
  }

  async function listManifestKeys_() {
    return runTx_(['manifests'], 'readonly', function (tx) {
      return reqPromise_(tx.objectStore('manifests').getAllKeys());
    }).then(function (keys) { return keys || []; });
  }

  async function gcExcept(keepHashesByMode) {
    const keep = {};
    const modes = keepHashesByMode || {};
    Object.keys(modes).forEach(function (mode) {
      const hash = modes[mode];
      if (hash) keep[manifestKey_(mode, hash)] = true;
    });
    const allKeys = await listManifestKeys_();
    await runTx_(['manifests'], 'readwrite', function (tx) {
      const store = tx.objectStore('manifests');
      const tasks = [];
      for (let i = 0; i < allKeys.length; i++) {
        const id = allKeys[i];
        if (!keep[id]) tasks.push(reqPromise_(store.delete(id)));
      }
      return Promise.all(tasks);
    });
  }

  async function clearAll() {
    await runTx_(['manifests', 'meta'], 'readwrite', function (tx) {
      return Promise.all([
        reqPromise_(tx.objectStore('manifests').clear()),
        reqPromise_(tx.objectStore('meta').clear())
      ]);
    });
  }

  function migrateFromLegacyLocalStorage() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.indexOf(LEGACY_LS_PREFIX) === 0 || k === LEGACY_VERSION_KEY)) {
          keys.push(k);
        }
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
      return keys.length;
    } catch (e) {
      return 0;
    }
  }

  async function hasPendingUpdate() {
    const pending = await getPendingMeta();
    return !!pending;
  }

  return {
    open: open,
    getMeta: getMeta,
    getActiveMeta: getActiveMeta,
    getPendingMeta: getPendingMeta,
    setActiveMeta: setActiveMeta,
    setPendingMeta: setPendingMeta,
    putManifest: putManifest,
    getManifest: getManifest,
    getActiveManifest: getActiveManifest,
    getPendingManifest: getPendingManifest,
    applyPending: applyPending,
    gcExcept: gcExcept,
    clearAll: clearAll,
    migrateFromLegacyLocalStorage: migrateFromLegacyLocalStorage,
    hasPendingUpdate: hasPendingUpdate
  };
})();

window.PresetStore = PresetStore;
