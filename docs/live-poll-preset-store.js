/**
 * 投票プリセット（IndexedDB）— 学習画面オリジン専用
 */
const LivePollPresetStore = (function () {
  const DB_NAME = 'digitaldrill_live_poll';
  const DB_VERSION = 1;

  let dbPromise_ = null;

  function openDb_() {
    if (dbPromise_) return dbPromise_;
    dbPromise_ = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB が利用できません'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
      req.onupgradeneeded = function (ev) {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('presets')) {
          db.createObjectStore('presets', { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
    });
    return dbPromise_;
  }

  function runTx_(mode, fn) {
    return openDb_().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(['presets'], mode);
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
          const out = fn(tx.objectStore('presets'));
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

  function newId_() {
    return 'pp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function normalizeQuestion_(q, si, qi) {
    q = q || {};
    const CS = window.LivePollChoiceSets;
    let choiceSet = String(q.choiceSet || 'ABC').trim();
    let choiceCount = parseInt(q.choiceCount, 10);
    const customChoices = String(q.customChoices == null ? '' : q.customChoices);
    if (CS) {
      const cfg = CS.resolveConfig({ choiceSet: choiceSet, choiceCount: choiceCount, customChoices: customChoices });
      choiceSet = cfg.kind;
      if (CS.needsCount(choiceSet)) {
        if (isNaN(choiceCount) || choiceCount <= 0) choiceCount = cfg.count;
      } else {
        choiceCount = 0;
      }
    } else {
      if (choiceSet === 'CIRCLED10') { choiceSet = 'CIRCLED'; choiceCount = 10; }
      else if (choiceSet === 'KATAKANA5') { choiceSet = 'KATAKANA'; choiceCount = 5; }
      else if (isNaN(choiceCount) || choiceCount <= 0) choiceCount = 3;
    }
    const isWritten = choiceSet === 'WRITTEN';
    const choices = (!isWritten && CS) ? CS.buildChoices({
      choiceSet: choiceSet,
      choiceCount: choiceCount,
      customChoices: customChoices
    }) : [];
    let answers = [];
    if (isWritten) {
      answers = [String(q.answer == null ? (Array.isArray(q.answers) ? (q.answers[0] || '') : '') : q.answer).trim()].filter(Boolean);
    } else if (Array.isArray(q.answers) && q.answers.length) {
      answers = q.answers.map(function (s) { return String(s == null ? '' : s).trim(); }).filter(Boolean);
    } else {
      const raw = String(q.answer == null ? '' : q.answer).trim();
      if (raw) {
        if (choices.indexOf(raw) >= 0) answers = [raw];
        else {
          const parts = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          if (parts.length && parts.every(function (p) { return choices.indexOf(p) >= 0; })) answers = parts;
          else if (choices.indexOf(raw) >= 0) answers = [raw];
        }
      }
    }
    if (!isWritten && choices.length) {
      answers = answers.filter(function (a) { return choices.indexOf(a) >= 0; });
    }
    return {
      id: 's' + si + 'q' + qi,
      label: String(q.label || ('Q' + (qi + 1) + '.')).trim(),
      choiceSet: choiceSet,
      choiceCount: isWritten ? 0 : choiceCount,
      customChoices: customChoices,
      type: isWritten ? 'written' : 'choice',
      answers: isWritten ? [] : answers,
      answer: isWritten ? (answers[0] || String(q.answer == null ? '' : q.answer).trim()) : answers.join(',')
    };
  }

  function normalizePreset_(data) {
    data = data || {};
    const sections = (data.sections || []).map(function (sec, si) {
      sec = sec || {};
      const questions = (sec.questions || []).map(function (q, qi) {
        return normalizeQuestion_(q, si, qi);
      });
      const dur = parseInt(sec.collectDurationSec, 10) || 0;
      return {
        name: String(sec.name || ('セクション' + (si + 1))).trim(),
        collectDurationSec: Math.max(0, dur),
        questions: questions
      };
    });
    return {
      id: String(data.id || newId_()),
      name: String(data.name || '無題のプリセット').trim(),
      updatedAt: Date.now(),
      sections: sections
    };
  }

  async function listPresets() {
    return runTx_('readonly', function (store) {
      return reqPromise_(store.getAll()).then(function (rows) {
        rows = rows || [];
        return rows.sort(function (a, b) {
          return (parseInt(b.updatedAt, 10) || 0) - (parseInt(a.updatedAt, 10) || 0);
        });
      });
    });
  }

  async function getPreset(id) {
    id = String(id || '').trim();
    if (!id) return null;
    return runTx_('readonly', function (store) {
      return reqPromise_(store.get(id));
    });
  }

  async function savePreset(data) {
    const preset = normalizePreset_(data);
    preset.updatedAt = Date.now();
    await runTx_('readwrite', function (store) {
      return reqPromise_(store.put(preset));
    });
    return preset;
  }

  async function deletePreset(id) {
    id = String(id || '').trim();
    if (!id) return;
    await runTx_('readwrite', function (store) {
      return reqPromise_(store.delete(id));
    });
  }

  function exportJson(preset) {
    preset = normalizePreset_(preset);
    return JSON.stringify(preset, null, 2);
  }

  function importJson(text) {
    const data = JSON.parse(text);
    return normalizePreset_(data);
  }

  function emptyPreset() {
    return normalizePreset_({
      name: '新しいプリセット',
      sections: [{
        name: 'セクション1',
        collectDurationSec: 120,
        questions: [{
          label: 'Q1.',
          choiceSet: 'TF',
          choiceCount: 2,
          customChoices: '',
          answers: ['True'],
          answer: 'True'
        }]
      }]
    });
  }

  return {
    listPresets: listPresets,
    getPreset: getPreset,
    savePreset: savePreset,
    deletePreset: deletePreset,
    exportJson: exportJson,
    importJson: importJson,
    emptyPreset: emptyPreset,
    normalizePreset: normalizePreset_
  };
})();

window.LivePollPresetStore = LivePollPresetStore;

