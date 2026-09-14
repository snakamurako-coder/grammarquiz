/**
 * 授業ライブ Firebase β — リアルタイム集計（Firebase Auth なし・クライアント送信を信頼）
 */
const LiveFirebase = (function () {
  let configCache_ = null;
  let configPromise_ = null;
  let app_ = null;
  let db_ = null;
  let boardUnsub_ = null;

  function apiUrl_() {
    return (window.DIGITALDRILL_CONFIG && window.DIGITALDRILL_CONFIG.API_URL) || window.API_URL || '';
  }

  async function fetchConfig_() {
    if (configCache_) return configCache_;
    if (configPromise_) return configPromise_;
    const url = apiUrl_();
    if (!url) {
      configCache_ = { firebaseEnabled: false, defaultBackend: 'gas', webConfig: null };
      return configCache_;
    }
    configPromise_ = (async function () {
      try {
        let target = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'action=liveConfig';
        let res = await fetch(target, { redirect: 'follow', credentials: 'omit' });
        let data = await res.json();
        if (data.status !== 'success' && window.DASHBOARD_URL && window.DASHBOARD_URL !== url) {
          target = window.DASHBOARD_URL + (window.DASHBOARD_URL.indexOf('?') >= 0 ? '&' : '?') + 'action=liveConfig';
          res = await fetch(target, { redirect: 'follow', credentials: 'omit' });
          data = await res.json();
        }
        configCache_ = (data.status === 'success' && data.data) ? data.data : {
          firebaseEnabled: false,
          defaultBackend: 'gas',
          webConfig: null
        };
      } catch (e) {
        console.warn('liveConfig:', e.message || e);
        configCache_ = { firebaseEnabled: false, defaultBackend: 'gas', webConfig: null };
      } finally {
        configPromise_ = null;
      }
      return configCache_;
    })();
    return configPromise_;
  }

  async function ensureDb_() {
    const cfg = await fetchConfig_();
    if (!cfg.firebaseEnabled || !cfg.webConfig) {
      throw new Error('Firebase β は Script Properties 未設定のため使えません');
    }
    if (db_) return db_;
    const webConfig = Object.assign({}, cfg.webConfig);
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
    const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    app_ = initializeApp(webConfig);
    db_ = getFirestore(app_);
    return db_;
  }

  function parseDurationSec_(v) {
    const n = parseFloat(v);
    if (isNaN(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }

  function compareWordLinkBest_(aBest, bBest) {
    aBest = aBest || {};
    bBest = bBest || {};
    const aw = parseInt(aBest.wrongCount, 10) || 0;
    const bw = parseInt(bBest.wrongCount, 10) || 0;
    if (aw !== bw) return aw - bw;
    const ad = parseDurationSec_(aBest.durationSec);
    const bd = parseDurationSec_(bBest.durationSec);
    if (ad !== bd) return ad - bd;
    return 0;
  }

  function isBetterAttempt_(mode, nextAttempt, prevBest) {
    if (!prevBest) return true;
    if (mode === 'word-link') {
      return compareWordLinkBest_(nextAttempt, prevBest) < 0;
    }
    if (nextAttempt.scoreRate > prevBest.scoreRate) return true;
    if (nextAttempt.scoreRate < prevBest.scoreRate) return false;
    if (nextAttempt.durationSec < prevBest.durationSec) return true;
    return false;
  }

  function compareJoinedRoster_(a, b) {
    const na = parseInt(a && a.number, 10);
    const nb = parseInt(b && b.number, 10);
    const aNum = !isNaN(na);
    const bNum = !isNaN(nb);
    if (aNum && bNum && na !== nb) return na - nb;
    if (aNum !== bNum) return aNum ? -1 : 1;
    return String((a && a.name) || '').localeCompare(String((b && b.name) || ''), 'ja');
  }

  function withUnfinishedJoiners_(ranked, entries) {
    const seen = {};
    (ranked || []).forEach(function (e) {
      seen[String((e && (e.account || e.name)) || '')] = true;
    });
    const pending = (entries || []).filter(function (e) {
      const key = String((e && (e.account || e.name)) || '');
      return key && !seen[key];
    }).sort(compareJoinedRoster_);
    return (ranked || []).concat(pending);
  }

  function sortBoardLists_(mode, entries) {
    const finished = (entries || []).filter(function (e) { return e.best; });
    const byAchievement = finished.slice().sort(function (a, b) {
      const fa = Date.parse(a.best.finishedAt || '') || 0;
      const fb = Date.parse(b.best.finishedAt || '') || 0;
      return fb - fa;
    });
    const byScore = finished.slice().sort(function (a, b) {
      if (mode === 'word-link') return compareWordLinkBest_(a.best, b.best);
      if (a.best.scoreRate !== b.best.scoreRate) return b.best.scoreRate - a.best.scoreRate;
      return parseDurationSec_(a.best.durationSec) - parseDurationSec_(b.best.durationSec);
    });
    const bySpeed = finished.slice().sort(function (a, b) {
      const ad = parseDurationSec_(a.best.durationSec);
      const bd = parseDurationSec_(b.best.durationSec);
      if (ad !== bd) return ad - bd;
      if (mode === 'word-link') {
        return (parseInt(a.best.wrongCount, 10) || 0) - (parseInt(b.best.wrongCount, 10) || 0);
      }
      return b.best.scoreRate - a.best.scoreRate;
    });
    return {
      achievement: withUnfinishedJoiners_(byAchievement, entries),
      scoreRate: withUnfinishedJoiners_(byScore, entries),
      speed: withUnfinishedJoiners_(bySpeed, entries)
    };
  }

  function decodeEntryDoc_(account, data) {
    data = data || {};
    return {
      account: account,
      name: data.name || '',
      number: data.number || '',
      class: data.class || '',
      attempts: parseInt(data.attempts, 10) || 0,
      status: data.status || 'joined',
      best: data.best || null,
      poll: data.poll || null,
      teamId: data.teamId != null ? String(data.teamId) : ''
    };
  }

  function buildBoardPayload_(pin, mode, meta, entries) {
    meta = meta || {};
    entries = entries || [];
    const lists = sortBoardLists_(mode, entries);
    const roster = meta.roster || [];
    const rosterCount = roster.length ? roster.length : entries.length;
    const finishedCount = entries.filter(function (e) { return !!e.best; }).length;
    return {
      pin: pin,
      title: meta.title || '授業ライブ',
      mode: mode,
      backend: 'firebase',
      closesAt: meta.closesAt || 0,
      timeLimitSec: meta.timeLimitSec || 0,
      rosterCount: rosterCount,
      finishedCount: finishedCount,
      joinedCount: entries.length,
      lists: lists,
      entries: entries,
      launchOptions: meta.launchOptions || null,
      activity: meta.activity || mode,
      pollPublic: meta.pollPublic || null
    };
  }

  async function submitEntry_(pin, mode, user, attempt, prevBest) {
    const db = await ensureDb_();
    const { doc, getDoc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const account = String((user && user.account) || '').trim().toLowerCase();
    if (!account) throw new Error('アカウント情報を取得できません');
    const ref = doc(db, 'liveRooms', pin, 'entries', account);
    const snap = await getDoc(ref);
    let entry = snap.exists() ? decodeEntryDoc_(account, snap.data()) : {
      account: account,
      name: String(user.name || '').trim(),
      number: String(user.number != null ? user.number : '').trim(),
      class: String(user.class || '').trim(),
      attempts: 0,
      status: 'joined',
      best: null
    };
    entry.attempts = (parseInt(entry.attempts, 10) || 0) + 1;
    let updated = false;
    if (isBetterAttempt_(mode, attempt, entry.best || prevBest)) {
      entry.best = attempt;
      updated = true;
    }
    entry.status = entry.best ? 'finished' : entry.status;
    const payload = {
      account: entry.account,
      name: entry.name || '',
      number: entry.number || '',
      class: entry.class || '',
      attempts: entry.attempts,
      status: entry.status,
      best: entry.best || null
    };
    await setDoc(ref, payload, { merge: true });
    return { updated: updated, entry: entry, localBest: entry.best };
  }

  function unsubscribeBoard_() {
    if (boardUnsub_) {
      boardUnsub_();
      boardUnsub_ = null;
    }
  }

  async function subscribeBoard_(pin, mode, roomMeta, onData, onError) {
    unsubscribeBoard_();
    const db = await ensureDb_();
    const { collection, doc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const roomRef = doc(db, 'liveRooms', pin);
    const entriesRef = collection(db, 'liveRooms', pin, 'entries');
    let meta = Object.assign({}, roomMeta || {});
    let entries = [];

    function emit_() {
      const current = meta.activity || meta.mode || mode;
      onData(buildBoardPayload_(pin, current, meta, entries));
    }

    const unsubRoom = onSnapshot(roomRef, function (snap) {
      if (snap.exists()) meta = Object.assign(meta, snap.data() || {});
      emit_();
    }, function (err) {
      if (onError) onError(err);
    });

    const unsubEntries = onSnapshot(entriesRef, function (snap) {
      entries = [];
      snap.forEach(function (docSnap) {
        entries.push(decodeEntryDoc_(docSnap.id, docSnap.data()));
      });
      emit_();
    }, function (err) {
      if (onError) onError(err);
    });

    boardUnsub_ = function () {
      unsubRoom();
      unsubEntries();
      boardUnsub_ = null;
    };
    return boardUnsub_;
  }

  let pollUnsub_ = null;
  let teamUnsub_ = null;
  let roomMetaUnsub_ = null;

  function unsubscribeRoomMeta_() {
    if (roomMetaUnsub_) {
      roomMetaUnsub_();
      roomMetaUnsub_ = null;
    }
  }

  async function subscribeRoomMeta_(pin, roomMeta, onChange, onError) {
    unsubscribeRoomMeta_();
    const db = await ensureDb_();
    const { doc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const roomRef = doc(db, 'liveRooms', pin);
    let meta = Object.assign({}, roomMeta || {});
    roomMetaUnsub_ = onSnapshot(roomRef, function (snap) {
      if (!snap.exists()) return;
      meta = Object.assign(meta, snap.data() || {});
      onChange({
        pin: pin,
        activity: meta.activity || meta.mode,
        mode: meta.mode,
        pollPublic: meta.pollPublic || null,
        teamPublic: meta.teamPublic || null,
        launchOptions: meta.launchOptions || null,
        title: meta.title,
        timeLimitSec: meta.timeLimitSec,
        closesAt: meta.closesAt
      });
    }, function (err) {
      if (onError) onError(err);
    });
    return roomMetaUnsub_;
  }

  function unsubscribePoll_() {
    if (pollUnsub_) {
      pollUnsub_();
      pollUnsub_ = null;
    }
  }

  async function subscribePoll_(pin, includeEntries, roomMeta, onData, onError) {
    unsubscribePoll_();
    const db = await ensureDb_();
    const { collection, doc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const roomRef = doc(db, 'liveRooms', pin);
    let meta = Object.assign({}, roomMeta || {});
    let entries = [];

    function emit_() {
      onData({
        pin: pin,
        title: meta.title || 'リアルタイム投票',
        mode: meta.mode || 'poll',
        activity: meta.activity || meta.mode || 'poll',
        backend: 'firebase',
        pollPublic: meta.pollPublic || null,
        rosterCount: (meta.roster && meta.roster.length) || 0,
        joinedCount: entries.length,
        entries: entries
      });
    }

    const unsubRoom = onSnapshot(roomRef, function (snap) {
      if (snap.exists()) meta = Object.assign(meta, snap.data() || {});
      emit_();
    }, function (err) {
      if (onError) onError(err);
    });

    let unsubEntries = function () {};
    if (includeEntries) {
      const entriesRef = collection(db, 'liveRooms', pin, 'entries');
      unsubEntries = onSnapshot(entriesRef, function (snap) {
        entries = [];
        snap.forEach(function (docSnap) {
          entries.push(decodeEntryDoc_(docSnap.id, docSnap.data()));
        });
        emit_();
      }, function (err) {
        if (onError) onError(err);
      });
    }

    pollUnsub_ = function () {
      unsubRoom();
      unsubEntries();
      pollUnsub_ = null;
    };
    return pollUnsub_;
  }

  function unsubscribeTeam_() {
    if (teamUnsub_) {
      teamUnsub_();
      teamUnsub_ = null;
    }
  }

  async function subscribeTeam_(pin, includeEntries, roomMeta, onData, onError) {
    unsubscribeTeam_();
    const db = await ensureDb_();
    const { collection, doc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const roomRef = doc(db, 'liveRooms', pin);
    let meta = Object.assign({}, roomMeta || {});
    let entries = [];
    let teams = [];

    function emit_() {
      onData({
        pin: pin,
        title: meta.title || 'チームN択',
        mode: meta.mode || 'vocab-team',
        activity: meta.activity || meta.mode || 'vocab-team',
        backend: 'firebase',
        teamPublic: meta.teamPublic || null,
        launchOptions: meta.launchOptions || null,
        rosterCount: (meta.roster && meta.roster.length) || 0,
        joinedCount: entries.length,
        entries: entries,
        teams: teams
      });
    }

    const unsubRoom = onSnapshot(roomRef, function (snap) {
      if (snap.exists()) meta = Object.assign(meta, snap.data() || {});
      emit_();
    }, function (err) {
      if (onError) onError(err);
    });

    let unsubEntries = function () {};
    if (includeEntries) {
      const entriesRef = collection(db, 'liveRooms', pin, 'entries');
      unsubEntries = onSnapshot(entriesRef, function (snap) {
        entries = [];
        snap.forEach(function (docSnap) {
          entries.push(decodeEntryDoc_(docSnap.id, docSnap.data()));
        });
        emit_();
      }, function (err) {
        if (onError) onError(err);
      });
    }

    const teamsRef = collection(db, 'liveRooms', pin, 'teams');
    const unsubTeams = onSnapshot(teamsRef, function (snap) {
      teams = [];
      snap.forEach(function (docSnap) {
        const data = docSnap.data() || {};
        data.id = docSnap.id;
        teams.push(data);
      });
      emit_();
    }, function (err) {
      console.warn('teams 購読:', err && err.message ? err.message : err);
      emit_();
    });

    teamUnsub_ = function () {
      unsubRoom();
      unsubEntries();
      unsubTeams();
      teamUnsub_ = null;
    };
    return teamUnsub_;
  }

  async function submitTeamPick_(pin, teamId, pick) {
    const db = await ensureDb_();
    const { doc, getDoc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    teamId = String(teamId || '').trim();
    if (!teamId) throw new Error('teamId が必要です');
    pick = pick || {};
    const expectedIndex = parseInt(pick.expectedIndex, 10) || 0;
    const totalQuestions = parseInt(pick.totalQuestions, 10) || 0;
    const isCorrect = !!pick.isCorrect;
    const ref = doc(db, 'liveRooms', pin, 'teams', teamId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('チームが見つかりません');
    const team = snap.data() || {};
    const now = Date.now();
    const lockUntil = parseInt(team.lockUntil, 10) || 0;
    if (lockUntil > now) return { blocked: true, lockUntil: lockUntil };
    const currentIndex = parseInt(team.currentIndex, 10) || 0;
    if (currentIndex !== expectedIndex) return { stale: true, currentIndex: currentIndex };
    if (parseInt(team.finishedAt, 10) > 0) return { stale: true, finished: true };

    if (!isCorrect) {
      await setDoc(ref, {
        lockUntil: now + 2000,
        wrongCount: (parseInt(team.wrongCount, 10) || 0) + 1
      }, { merge: true });
      return { ok: false, wrong: true, lockUntil: now + 2000 };
    }

    const nextIndex = currentIndex + 1;
    if (totalQuestions > 0 && nextIndex >= totalQuestions) {
      await setDoc(ref, {
        currentIndex: nextIndex,
        lockUntil: 0,
        finishedAt: now
      }, { merge: true });
      return { ok: true, finished: true, finishedAt: now };
    }
    await setDoc(ref, {
      currentIndex: nextIndex,
      lockUntil: 0
    }, { merge: true });
    return { ok: true, currentIndex: nextIndex };
  }

  async function submitPollAnswers_(pin, user, round, answers) {
    const db = await ensureDb_();
    const { doc, getDoc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const account = String((user && user.account) || '').trim().toLowerCase();
    if (!account) throw new Error('アカウント情報を取得できません');
    const ref = doc(db, 'liveRooms', pin, 'entries', account);
    const snap = await getDoc(ref);
    const prev = snap.exists() ? decodeEntryDoc_(account, snap.data()) : {};
    const prevPoll = prev.poll || {};
    const nextRound = parseInt(round, 10) || 0;
    const sameRound = (parseInt(prevPoll.round, 10) || 0) === nextRound;
    const now = Date.now();
    const entry = {
      account: account,
      name: String((user && user.name) || prev.name || '').trim(),
      number: String((user && user.number != null ? user.number : prev.number) || '').trim(),
      class: String((user && user.class) || prev.class || '').trim(),
      attempts: parseInt(prev.attempts, 10) || 0,
      status: prev.status || 'joined',
      best: prev.best || null,
      poll: {
        round: nextRound,
        answers: answers || {},
        updatedAt: now,
        submittedAt: (sameRound && prevPoll.submittedAt) ? prevPoll.submittedAt : now
      }
    };
    await setDoc(ref, entry, { merge: true });
    return { entry: entry };
  }

  async function applyBackendUi_(rootId, hintId) {
    const cfg = await fetchConfig_();
    const root = document.getElementById(rootId);
    const hint = hintId ? document.getElementById(hintId) : null;
    const fbRadio = root ? root.querySelector('input[name="live-backend"][value="firebase"]') : null;
    const gasRadio = root ? root.querySelector('input[name="live-backend"][value="gas"]') : null;
    if (gasRadio && cfg.defaultBackend === 'gas') gasRadio.checked = true;
    if (fbRadio && cfg.defaultBackend === 'firebase' && cfg.firebaseEnabled) fbRadio.checked = true;
    if (fbRadio) {
      fbRadio.disabled = !cfg.firebaseEnabled;
      if (!cfg.firebaseEnabled && gasRadio) gasRadio.checked = true;
    }
    if (hint) {
      hint.textContent = cfg.firebaseEnabled
        ? 'リアルタイム β は Firebase へ直接書き込みます（教室用途・クライアント送信を信頼）。'
        : 'Firebase β を使うには GAS Script Properties に Firebase 設定を登録してください。';
    }
    return cfg;
  }

  function getSelectedBackend_(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return 'gas';
    const checked = root.querySelector('input[name="live-backend"]:checked');
    return (checked && checked.value === 'firebase') ? 'firebase' : 'gas';
  }

  function backendLabel_(backend) {
    return backend === 'firebase' ? 'リアルタイムβ' : '標準';
  }

  return {
    fetchConfig: fetchConfig_,
    ensureDb: ensureDb_,
    submitEntry: submitEntry_,
    subscribeBoard: subscribeBoard_,
    unsubscribeBoard: unsubscribeBoard_,
    subscribePoll: subscribePoll_,
    unsubscribePoll: unsubscribePoll_,
    subscribeTeam: subscribeTeam_,
    unsubscribeTeam: unsubscribeTeam_,
    submitTeamPick: submitTeamPick_,
    subscribeRoomMeta: subscribeRoomMeta_,
    unsubscribeRoomMeta: unsubscribeRoomMeta_,
    submitPollAnswers: submitPollAnswers_,
    applyBackendUi: applyBackendUi_,
    getSelectedBackend: getSelectedBackend_,
    backendLabel: backendLabel_,
    sortBoardLists: sortBoardLists_
  };
})();

window.LiveFirebase = LiveFirebase;
