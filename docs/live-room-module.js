/**
 * 授業ライブ v1 — Cache 上の部屋・ベストスコア採用
 */
const LiveRoomModule = (function () {
  const STORAGE_KEY = 'dd_live_room';
  const POST_TIMEOUT_MS = 20000;
  const BOARD_POLL_MS = 3000;

  let activeRoom_ = null;
  let localBest_ = null;
  let boardPollId_ = null;
  let roomTimerId_ = null;
  let timeoutFired_ = false;

  function apiUrl_() {
    return (window.DIGITALDRILL_CONFIG && window.DIGITALDRILL_CONFIG.API_URL) || window.API_URL || '';
  }

  function loadStoredRoom_() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveStoredRoom_(room) {
    if (!room) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(room));
  }

  function isAdminUser_() {
    const user = (window.AuthGateService && AuthGateService.getUser()) || {};
    if (String(user.role || '').toLowerCase() === 'admin') return true;
    if (String(user.class || '').trim().toLowerCase() === 'admin') return true;
    return false;
  }

  async function post_(payload, retries) {
    retries = retries == null ? 2 : retries;
    const url = apiUrl_();
    if (!url) throw new Error('API_URL が未設定です');
    if (!window.AuthGateService || !AuthGateService.isValid()) throw new Error('ログインが必要です');
    const body = Object.assign({ authToken: AuthGateService.getToken() }, payload);
    let lastErr = null;
    for (let i = 0; i <= retries; i++) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(function () { controller.abort(); }, POST_TIMEOUT_MS) : null;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body),
          redirect: 'follow',
          credentials: 'omit',
          signal: controller ? controller.signal : undefined
        });
        const text = await res.text();
        let data = {};
        try { data = JSON.parse(text); } catch (e) {
          throw new Error('サーバー応答の解析に失敗しました');
        }
        if (data.status === 'error') throw new Error(data.message || 'API error');
        return data;
      } catch (e) {
        lastErr = e;
        if (i < retries) {
          await new Promise(function (resolve) { setTimeout(resolve, 500 * Math.pow(3, i)); });
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastErr || new Error('通信に失敗しました');
  }

  function normalizeAttempt_(mode, attempt) {
    attempt = attempt || {};
    const correct = parseInt(attempt.correct, 10) || 0;
    const total = parseInt(attempt.total, 10) || 0;
    const durationSec = Math.max(0, parseInt(attempt.durationSec, 10) || 0);
    const wrongCount = Math.max(0, parseInt(attempt.wrongCount, 10) || 0);
    let scoreRate = parseInt(attempt.scoreRate, 10);
    if (isNaN(scoreRate)) {
      scoreRate = total > 0 ? Math.round((correct / total) * 100) : 0;
    }
    return {
      correct: correct,
      total: total,
      scoreRate: scoreRate,
      durationSec: durationSec,
      wrongCount: wrongCount,
      timedOut: !!attempt.timedOut,
      finishedAt: attempt.finishedAt || new Date().toISOString()
    };
  }

  function isBetterAttempt_(mode, nextAttempt, prevBest) {
    nextAttempt = normalizeAttempt_(mode, nextAttempt);
    if (!prevBest) return true;
    prevBest = normalizeAttempt_(mode, prevBest);
    if (mode === 'word-link') {
      if (nextAttempt.durationSec < prevBest.durationSec) return true;
      if (nextAttempt.durationSec > prevBest.durationSec) return false;
      if (nextAttempt.wrongCount < prevBest.wrongCount) return true;
      return false;
    }
    if (nextAttempt.scoreRate > prevBest.scoreRate) return true;
    if (nextAttempt.scoreRate < prevBest.scoreRate) return false;
    if (nextAttempt.durationSec < prevBest.durationSec) return true;
    return false;
  }

  function jitterMs_(user) {
    const number = parseInt(user && user.number, 10) || 0;
    const base = Math.random() * 1500;
    const stagger = (number % 20) * 80;
    return Math.round(base + stagger);
  }

  function el_(id) {
    return document.getElementById(id);
  }

  function formatDuration_(sec) {
    const s = Math.max(0, parseInt(sec, 10) || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? (m + '分' + r + '秒') : (r + '秒');
  }

  function formatLimit_(sec) {
    const s = Math.max(0, parseInt(sec, 10) || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m > 0) return m + ':' + String(r).padStart(2, '0');
    return String(r) + '秒';
  }

  function paintRoomTimer_(text, urgent, hide) {
    const ids = ['live-room-timer', 'assignment-timer', 'pool-header-status'];
    ids.forEach(function (id) {
      const el = el_(id);
      if (!el) return;
      el.hidden = !!hide;
      el.textContent = text;
      el.classList.toggle('urgent', !!urgent);
    });
    const banner = el_('live-room-student-banner');
    if (banner && activeRoom_ && !activeRoom_.isTeacher) {
      if (hide || !text) {
        banner.textContent = '授業ライブ参加中: ' + (activeRoom_.title || activeRoom_.pin)
          + '（コード ' + activeRoom_.pin + '）';
      } else {
        banner.textContent = '授業ライブ参加中: ' + (activeRoom_.title || activeRoom_.pin)
          + '（コード ' + activeRoom_.pin + '） ' + text;
      }
    }
  }

  function clearRoomTimer_() {
    if (roomTimerId_) {
      clearInterval(roomTimerId_);
      roomTimerId_ = null;
    }
    paintRoomTimer_('', false, true);
  }

  function startRoomTimer_(closesAt) {
    clearRoomTimer_();
    if (!closesAt) {
      paintRoomTimer_('制限なし', false, false);
      return;
    }
    function tick() {
      const left = Math.max(0, Math.ceil((closesAt - Date.now()) / 1000));
      paintRoomTimer_(left > 0 ? ('残り ' + formatLimit_(left)) : '終了', left > 0 && left <= 30, false);
      if (left <= 0 && !timeoutFired_) {
        timeoutFired_ = true;
        if (roomTimerId_) {
          clearInterval(roomTimerId_);
          roomTimerId_ = null;
        }
        onRoomTimeout_();
      }
    }
    tick();
    roomTimerId_ = setInterval(tick, 250);
  }

  async function onRoomTimeout_() {
    if (!activeRoom_ || activeRoom_.isTeacher) return;
    if (!activeRoom_.autoSubmitOnTimeout) return;
    if (typeof window.forceLiveRoomTimeoutSubmit_ === 'function') {
      try {
        await window.forceLiveRoomTimeoutSubmit_();
      } catch (e) {
        console.warn('授業ライブ時間切れ:', e.message || e);
      }
    }
  }

  function setActiveRoom_(room) {
    activeRoom_ = room;
    saveStoredRoom_(room);
    localBest_ = room && room.localBest ? room.localBest : null;
    refreshUi_();
    if (room && room.closesAt && !room.isTeacher) {
      startRoomTimer_(room.closesAt);
    } else {
      clearRoomTimer_();
    }
  }

  function getActiveRoom() {
    return activeRoom_;
  }

  function isActive() {
    return !!(activeRoom_ && activeRoom_.pin);
  }

  function isTeacherRoom() {
    return !!(activeRoom_ && activeRoom_.isTeacher);
  }

  function isLoggedIn_() {
    return !!(window.AuthGateService && AuthGateService.isValid());
  }

  function canRestoreTeacher_(stored) {
    return !!(stored && stored.isTeacher && isLoggedIn_() && isAdminUser_());
  }

  function canRestoreStudent_(stored) {
    return !!(stored && stored.pin && !stored.isTeacher && isLoggedIn_());
  }

  function applyStoredRoom_(stored) {
    activeRoom_ = stored;
    localBest_ = stored.localBest || null;
    timeoutFired_ = false;
    if (stored.isTeacher) {
      showBoardScreen_();
      startBoardPoll_();
    } else if (stored.closesAt) {
      startRoomTimer_(stored.closesAt);
    }
    refreshUi_();
  }

  function restoreFromStorage_() {
    hideBoardScreen_();
    const stored = loadStoredRoom_();
    if (!stored || !stored.pin) return;
    if (stored.closesAt && Date.now() > stored.closesAt) {
      saveStoredRoom_(null);
      return;
    }
    if (stored.isTeacher) {
      if (!canRestoreTeacher_(stored)) return;
      applyStoredRoom_(stored);
      return;
    }
    if (!canRestoreStudent_(stored)) return;
    applyStoredRoom_(stored);
  }

  function tryResumeAfterAuth_() {
    if (activeRoom_) {
      if (activeRoom_.isTeacher && (!isLoggedIn_() || !isAdminUser_())) {
        hideBoardScreen_();
        stopBoardPoll_();
        refreshUi_();
        return;
      }
      refreshUi_();
      return;
    }
    restoreFromStorage_();
  }

  function refreshUi_() {
    const banner = el_('live-room-student-banner');
    const teacherBanner = el_('live-room-teacher-banner');
    const adminBtns = document.querySelectorAll('.live-room-open-btn');
    const joinPanel = el_('live-room-join-panel');
    if (banner) {
      if (activeRoom_ && !activeRoom_.isTeacher && isLoggedIn_()) {
        banner.style.display = 'block';
        banner.textContent = '授業ライブ参加中: ' + (activeRoom_.title || activeRoom_.pin)
          + '（コード ' + activeRoom_.pin + '）';
      } else {
        banner.style.display = 'none';
      }
    }
    const storedTeacher = (activeRoom_ && activeRoom_.isTeacher) ? activeRoom_ : loadStoredRoom_();
    const boardVisible = document.body.classList.contains('live-room-board-active');
    if (teacherBanner) {
      if (canRestoreTeacher_(storedTeacher) && !boardVisible) {
        teacherBanner.style.display = 'block';
        teacherBanner.innerHTML = '授業ライブ開催中: ' + escapeHtml_(storedTeacher.title || storedTeacher.pin)
          + '（コード ' + escapeHtml_(storedTeacher.pin) + '）'
          + ' <button type="button" class="btn-secondary" id="live-room-show-board-btn" style="width:auto;min-width:auto;padding:4px 10px;margin-left:8px;">ボードを表示</button>';
        const showBtn = el_('live-room-show-board-btn');
        if (showBtn) showBtn.onclick = reopenTeacherBoard_;
      } else {
        teacherBanner.style.display = 'none';
        teacherBanner.innerHTML = '';
      }
    }
    const homework = window.VocabLaunchConfig && VocabLaunchConfig.isHomeworkMode();
    adminBtns.forEach(function (btn) {
      btn.style.display = (isAdminUser_() && isLoggedIn_() && !homework) ? '' : 'none';
    });
    if (joinPanel && activeRoom_ && !activeRoom_.isTeacher) {
      const pinInput = el_('live-room-pin-input');
      if (pinInput) pinInput.value = activeRoom_.pin;
    }
  }

  function showCreateDialog_(mode) {
    const targetClass = window.prompt('名簿に出すクラス（空欄可。PIN を知っている人は誰でも参加できます）', '') || '';
    const limitRaw = window.prompt('制限時間（分・空欄＝なし）', '8');
    let timeLimitSec = 0;
    if (String(limitRaw || '').trim()) {
      const mins = parseInt(limitRaw, 10);
      if (!isNaN(mins) && mins > 0) timeLimitSec = mins * 60;
    }
    const title = window.prompt('表示名（空欄＝教材名）', '') || '';
    return {
      targetClass: String(targetClass).trim(),
      timeLimitSec: timeLimitSec,
      title: String(title).trim(),
      mode: mode
    };
  }

  async function createRoom(mode) {
    if (!isAdminUser_()) throw new Error('管理者のみ部屋を開けます');
    if (!window.VocabSettingsModule) throw new Error('設定モジュールが未初期化です');
    const opts = showCreateDialog_(mode);
    const launchOptions = window.VocabSettingsModule.getQuizOptions();
    if (!launchOptions.bookName || !launchOptions.sheetName) {
      throw new Error('ブックと教材（シート）を選択してください');
    }
    const res = await post_({
      action: 'liveCreate',
      mode: mode,
      launchOptions: launchOptions,
      targetClass: opts.targetClass,
      timeLimitSec: opts.timeLimitSec,
      autoSubmitOnTimeout: true,
      title: opts.title
    });
    const data = res.data || {};
    const room = {
      pin: data.pin,
      title: data.title,
      mode: data.mode,
      isTeacher: true,
      closesAt: data.closesAt || 0,
      timeLimitSec: data.timeLimitSec || 0,
      autoSubmitOnTimeout: data.autoSubmitOnTimeout !== false,
      rosterCount: data.rosterCount || 0
    };
    timeoutFired_ = false;
    setActiveRoom_(room);
    showBoardScreen_();
    startBoardPoll_();
    return room;
  }

  async function joinRoom(pin) {
    pin = String(pin || '').trim();
    if (!/^\d{4}$/.test(pin)) throw new Error('参加コードは4桁の数字です');
    const res = await post_({
      action: 'liveJoin',
      pin: pin
    });
    const data = res.data || {};
    const room = {
      pin: data.pin,
      title: data.title,
      mode: data.mode,
      isTeacher: false,
      closesAt: data.closesAt || 0,
      timeLimitSec: data.timeLimitSec || 0,
      autoSubmitOnTimeout: data.autoSubmitOnTimeout !== false,
      launchOptions: data.launchOptions || null,
      localBest: (data.entry && data.entry.best) ? data.entry.best : null
    };
    timeoutFired_ = false;
    localBest_ = room.localBest;
    setActiveRoom_(room);
    return room;
  }

  async function leaveRoom() {
    stopBoardPoll_();
    clearRoomTimer_();
    activeRoom_ = null;
    localBest_ = null;
    saveStoredRoom_(null);
    refreshUi_();
    hideBoardScreen_();
  }

  async function closeRoom() {
    const room = (activeRoom_ && activeRoom_.isTeacher) ? activeRoom_ : loadStoredRoom_();
    if (!room || !room.isTeacher) return;
    if (!isLoggedIn_()) {
      dismissBoardToSettings_();
      return;
    }
    activeRoom_ = room;
    await post_({ action: 'liveClose', pin: room.pin });
    await leaveRoom();
  }

  function dismissBoardToSettings_() {
    stopBoardPoll_();
    hideBoardScreen_();
    const settingsScreen = document.getElementById('settings-screen');
    const loginScreen = document.getElementById('login-screen');
    if (isLoggedIn_()) {
      if (settingsScreen) settingsScreen.style.display = 'block';
      if (loginScreen) loginScreen.style.display = 'none';
    } else {
      if (loginScreen) loginScreen.style.display = 'block';
      if (settingsScreen) settingsScreen.style.display = 'none';
    }
    refreshUi_();
  }

  function reopenTeacherBoard_() {
    const stored = (activeRoom_ && activeRoom_.isTeacher) ? activeRoom_ : loadStoredRoom_();
    if (!canRestoreTeacher_(stored)) return;
    applyStoredRoom_(stored);
  }

  async function submitAttempt(attempt, options) {
    options = options || {};
    if (!activeRoom_ || activeRoom_.isTeacher) return { skipped: true, reason: 'no_student_room' };
    const mode = activeRoom_.mode;
    const normalized = normalizeAttempt_(mode, attempt);
    if (!isBetterAttempt_(mode, normalized, localBest_)) {
      return { skipped: true, reason: 'not_better', localBest: localBest_ };
    }
    if (!options.skipJitter) {
      const user = (window.AuthGateService && AuthGateService.getUser()) || {};
      await new Promise(function (resolve) { setTimeout(resolve, jitterMs_(user)); });
    }
    const res = await post_({
      action: 'liveSubmit',
      pin: activeRoom_.pin,
      attempt: normalized
    }, 3);
    const entry = (res.data && res.data.entry) || {};
    if (res.data && res.data.updated && entry.best) {
      localBest_ = entry.best;
      activeRoom_.localBest = entry.best;
      saveStoredRoom_(activeRoom_);
    }
    return {
      updated: !!(res.data && res.data.updated),
      entry: entry,
      localBest: localBest_
    };
  }

  function buildAttemptFromSummary_(summary, extra) {
    extra = extra || {};
    const mode = activeRoom_ ? activeRoom_.mode : '';
    if (mode === 'word-link') {
      return normalizeAttempt_('word-link', {
        correct: extra.wordCount || summary.Correct || 0,
        total: extra.wordCount || summary.Total || 0,
        durationSec: extra.elapsedSec != null ? extra.elapsedSec : summary.Duration_Sec,
        wrongCount: extra.totalWrong || 0,
        timedOut: !!extra.timedOut,
        finishedAt: summary.Ended_At || new Date().toISOString()
      });
    }
    return normalizeAttempt_('vocab', {
      correct: summary.Correct || 0,
      total: summary.Total || 0,
      scoreRate: summary.Score,
      durationSec: summary.Duration_Sec || 0,
      timedOut: !!extra.timedOut,
      finishedAt: summary.Ended_At || new Date().toISOString()
    });
  }

  async function trySubmitFromSession(summary, extra) {
    if (!isActive() || isTeacherRoom()) return { skipped: true };
    try {
      const attempt = buildAttemptFromSummary_(summary, extra);
      return await submitAttempt(attempt);
    } catch (e) {
      console.warn('授業ライブ提出:', e.message || e);
      return { status: 'error', message: e.message || String(e) };
    }
  }

  function formatLiveResultMessage_(result) {
    if (!result || result.skipped) {
      if (result && result.reason === 'not_better') {
        return '授業ライブ: ベストスコアは更新されませんでした';
      }
      return '';
    }
    if (result.updated) return '授業ライブ: ベストスコアを更新しました';
    return '授業ライブ: ベストスコアは更新されませんでした';
  }

  function showBoardScreen_() {
    const screen = el_('live-room-board-screen');
    if (screen) {
      screen.style.display = 'flex';
      screen.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('live-room-board-active');
  }

  function hideBoardScreen_() {
    const screen = el_('live-room-board-screen');
    if (screen) {
      screen.style.display = 'none';
      screen.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('live-room-board-active');
  }

  function renderBoard_(data) {
    const titleEl = el_('live-board-title');
    const pinEl = el_('live-board-pin');
    const metaEl = el_('live-board-meta');
    const timerEl = el_('live-board-timer');
    if (titleEl) titleEl.textContent = data.title || '授業ライブ';
    if (pinEl) pinEl.textContent = data.pin || '';
    if (metaEl) {
      metaEl.textContent = '達成 ' + (data.finishedCount || 0)
        + ' / 名簿 ' + (data.rosterCount || data.joinedCount || 0);
    }
    if (timerEl) {
      if (data.closesAt) {
        const left = Math.max(0, Math.ceil((data.closesAt - Date.now()) / 1000));
        timerEl.textContent = left > 0 ? ('残り ' + formatLimit_(left)) : '終了';
      } else {
        timerEl.textContent = '制限なし';
      }
    }
    renderBoardList_('live-board-list-achievement', data.lists && data.lists.achievement, data.mode, 'achievement');
    renderBoardList_('live-board-list-score', data.lists && data.lists.scoreRate, data.mode, 'score');
    renderBoardList_('live-board-list-speed', data.lists && data.lists.speed, data.mode, 'speed');
    const defaultTab = data.mode === 'word-link' ? 'speed' : 'score';
    switchBoardTab_(defaultTab);
  }

  function renderBoardList_(containerId, rows, mode, kind) {
    const el = el_(containerId);
    if (!el) return;
    rows = rows || [];
    if (!rows.length) {
      el.innerHTML = '<p class="filter-axis-hint" style="margin:0;">まだ達成者がいません</p>';
      return;
    }
    let html = '<table class="live-board-table"><thead><tr><th>#</th><th>番号</th><th>氏名</th><th>';
    if (kind === 'achievement') html += '達成時刻';
    else if (mode === 'word-link' || kind === 'speed') html += 'タイム';
    else html += '正解率';
    html += '</th></tr></thead><tbody>';
    rows.forEach(function (row, idx) {
      const best = row.best || {};
      let value = '';
      if (kind === 'achievement') {
        const d = best.finishedAt ? new Date(best.finishedAt) : null;
        value = d ? (d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')) : '—';
      } else if (mode === 'word-link' || kind === 'speed') {
        value = formatDuration_(best.durationSec);
        if (best.wrongCount > 0) value += ' (ミス' + best.wrongCount + ')';
      } else {
        value = (best.scoreRate != null ? best.scoreRate : '—') + '%';
        if (best.durationSec) value += ' / ' + formatDuration_(best.durationSec);
      }
      html += '<tr><td>' + (idx + 1) + '</td><td>' + escapeHtml_(row.number || '—') + '</td><td>'
        + escapeHtml_(row.name || '—') + '</td><td>' + escapeHtml_(value) + '</td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function escapeHtml_(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function switchBoardTab_(tabId) {
    document.querySelectorAll('.live-board-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-live-tab') === tabId);
    });
    document.querySelectorAll('.live-board-panel').forEach(function (panel) {
      panel.style.display = panel.getAttribute('data-live-panel') === tabId ? 'block' : 'none';
    });
  }

  async function refreshBoard_() {
    if (!activeRoom_ || !activeRoom_.isTeacher) return;
    const res = await post_({ action: 'liveBoard', pin: activeRoom_.pin }, 1);
    renderBoard_(res.data || {});
  }

  function startBoardPoll_() {
    stopBoardPoll_();
    refreshBoard_().catch(function (e) { console.warn('ライブボード:', e.message || e); });
    boardPollId_ = setInterval(function () {
      refreshBoard_().catch(function (e) { console.warn('ライブボード:', e.message || e); });
    }, BOARD_POLL_MS);
  }

  function stopBoardPoll_() {
    if (boardPollId_) {
      clearInterval(boardPollId_);
      boardPollId_ = null;
    }
  }

  function bindUi_() {
    document.querySelectorAll('.live-room-open-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const mode = btn.getAttribute('data-live-mode') || 'vocab';
        BusyButton.run(btn, function () {
          return createRoom(mode);
        }, '部屋を開いています…').catch(function (e) {
          alert(e.message || e);
        });
      });
    });
    const joinBtn = el_('live-room-join-btn');
    if (joinBtn) {
      joinBtn.addEventListener('click', function () {
        const pin = (el_('live-room-pin-input') || {}).value;
        BusyButton.run(joinBtn, function () {
          return joinRoom(pin);
        }, '参加中…').then(function () {
          if (typeof showToast_ === 'function') showToast_('授業ライブに参加しました');
        }).catch(function (e) {
          alert(e.message || e);
        });
      });
    }
    const leaveBtn = el_('live-room-leave-btn');
    if (leaveBtn) {
      leaveBtn.addEventListener('click', function () {
        leaveRoom();
        if (typeof showToast_ === 'function') showToast_('授業ライブから退出しました');
      });
    }
    const closeBtn = el_('live-board-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (!window.confirm('授業ライブを終了しますか？')) return;
        BusyButton.run(closeBtn, function () {
          return closeRoom();
        }, '終了中…').catch(function (e) {
          alert(e.message || e);
        });
      });
    }
    const backBtn = el_('live-board-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        dismissBoardToSettings_();
      });
    }
    document.querySelectorAll('.live-board-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchBoardTab_(btn.getAttribute('data-live-tab'));
      });
    });
  }

  function init() {
    hideBoardScreen_();
    bindUi_();
    restoreFromStorage_();
    if (window.AuthGateService) {
      AuthGateService.fetchUserIfNeeded().then(function () {
        tryResumeAfterAuth_();
      }).catch(function () {
        hideBoardScreen_();
        refreshUi_();
      });
    }
  }

  return {
    init: init,
    createRoom: createRoom,
    joinRoom: joinRoom,
    leaveRoom: leaveRoom,
    closeRoom: closeRoom,
    submitAttempt: submitAttempt,
    trySubmitFromSession: trySubmitFromSession,
    tryResumeAfterAuth_: tryResumeAfterAuth_,
    formatLiveResultMessage_: formatLiveResultMessage_,
    getActiveRoom: getActiveRoom,
    isActive: isActive,
    isTeacherRoom: isTeacherRoom,
    isAdminUser_: isAdminUser_,
    refreshUi_: refreshUi_
  };
})();

window.LiveRoomModule = LiveRoomModule;
