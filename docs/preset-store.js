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

  function tx_(storeNames, mode) {
    return openDb_().then(function (db) {
      return db.transaction(storeNames, mode || 'readonly');
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
    const tx = await tx_(['manifests'], 'readonly');
    const store = tx.objectStore('manifests');
    const rec = await reqPromise_(store.get(manifestKey_(mode, hash)));
    return rec || null;
  }

  async function getMetaRecord_(key) {
    const tx = await tx_(['meta'], 'readonly');
    const store = tx.objectStore('meta');
    const rec = await reqPromise_(store.get(key));
    return rec && rec.value ? rec.value : null;
  }

  async function putMetaRecord_(key, value) {
    const tx = await tx_(['meta'], 'readwrite');
    const store = tx.objectStore('meta');
    await reqPromise_(store.put({ key: key, value: value }));
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
      const tx = await tx_(['meta'], 'readwrite');
      await reqPromise_(tx.objectStore('meta').delete('pending'));
      return;
    }
    await putMetaRecord_('pending', meta);
  }

  async function putManifest(mode, hash, data) {
    if (!mode || !hash || !data) return;
    const tx = await tx_(['manifests'], 'readwrite');
    const store = tx.objectStore('manifests');
    await reqPromise_(store.put({
      id: manifestKey_(mode, hash),
      mode: mode,
      hash: hash,
      data: data,
      savedAt: Date.now()
    }));
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
    const tx = await tx_(['manifests'], 'readonly');
    const store = tx.objectStore('manifests');
    const keys = await reqPromise_(store.getAllKeys());
    return keys || [];
  }

  /** 指定ハッシュ集合以外の manifest レコードを削除 */
  async function gcExcept(keepHashesByMode) {
    const keep = {};
    const modes = keepHashesByMode || {};
    Object.keys(modes).forEach(function (mode) {
      const hash = modes[mode];
      if (hash) keep[manifestKey_(mode, hash)] = true;
    });
    const allKeys = await listManifestKeys_();
    const tx = await tx_(['manifests'], 'readwrite');
    const store = tx.objectStore('manifests');
    for (let i = 0; i < allKeys.length; i++) {
      const id = allKeys[i];
      if (!keep[id]) {
        await reqPromise_(store.delete(id));
      }
    }
  }

  async function clearAll() {
    const tx = await tx_(['manifests', 'meta'], 'readwrite');
    await reqPromise_(tx.objectStore('manifests').clear());
    await reqPromise_(tx.objectStore('meta').clear());
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
