/**
 * 授業ライブ v1 — GAS Cache（4秒ポーリング）または Firebase β（リアルタイム）
 */
const LiveRoomModule = (function () {
  const STORAGE_KEY = 'dd_live_room';
  const BACKEND_UI_ROOT = 'live-room-backend-block';
  const FONT_KEY = 'dd_live_board_font_pt';
  const FONT_MIN = 1;
  const FONT_MAX = 50;
  const FONT_DEFAULT = 18;
  const BEST_N_KEY = 'dd_live_board_best_n';
  const BEST_N_DEFAULT = 8;
  const BEST_N_PRESETS = [3, 4, 8, 16];
  const POST_TIMEOUT_MS = 45000;
  const EXPORT_TIMEOUT_MS = 60000;
  const BOARD_POLL_MS = 4000;

  let activeRoom_ = null;
  let localBest_ = null;
  let boardPollId_ = null;
  let boardClockId_ = null;
  let lastBoardData_ = null;
  let boardPrevByKind_ = { achievement: {}, score: {}, speed: {} };
  let boardListSigByKind_ = { achievement: '', score: '', speed: '' };
  let roomTimerId_ = null;
  let timeoutFired_ = false;
  let boardDefaultedPin_ = '';

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

  function isFirebaseRoom_(room) {
    room = room || activeRoom_;
    return !!(room && String(room.backend || '').toLowerCase() === 'firebase');
  }

  function getSelectedBackend_() {
    if (window.LiveFirebase && typeof LiveFirebase.getSelectedBackend === 'function') {
      return LiveFirebase.getSelectedBackend(BACKEND_UI_ROOT);
    }
    return 'gas';
  }

  function backendLabel_(backend) {
    if (window.LiveFirebase && typeof LiveFirebase.backendLabel === 'function') {
      return LiveFirebase.backendLabel(backend);
    }
    return backend === 'firebase' ? 'リアルタイムβ' : '標準';
  }

  function paintBackendBadge_(backend) {
    const badge = el_('live-board-backend-badge');
    if (!badge) return;
    badge.textContent = backendLabel_(backend || 'gas');
    badge.classList.toggle('is-firebase', backend === 'firebase');
    badge.style.display = '';
  }

  async function post_(payload, retries, timeoutMs) {
    retries = retries == null ? 2 : retries;
    const waitMs = timeoutMs || POST_TIMEOUT_MS;
    const url = apiUrl_();
    if (!url) throw new Error('API_URL が未設定です');
    if (!window.AuthGateService || !AuthGateService.isValid()) throw new Error('ログインが必要です');
    const body = Object.assign({ authToken: AuthGateService.getToken() }, payload);
    let lastErr = null;
    for (let i = 0; i <= retries; i++) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(function () { controller.abort(); }, waitMs) : null;
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

  function parseDurationSec_(v) {
    const n = parseFloat(v);
    if (isNaN(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }

  function wordLinkModeLabel_(key) {
    if (window.VocabLinkModule && typeof VocabLinkModule.modeLabel === 'function') {
      return VocabLinkModule.modeLabel(key);
    }
    const map = {
      'wl-eija': 'Word Link 英和',
      'wl-jaei': 'Word Link 和英',
      'awl-eija': 'Audio WL 英和',
      'awl-jaei': 'Audio WL 和英'
    };
    return map[key] || key || '';
  }

  function isWordLinkMode_(key) {
    return key === 'wl-eija' || key === 'wl-jaei' || key === 'awl-eija' || key === 'awl-jaei';
  }

  function isPollRoom_(room) {
    room = room || activeRoom_;
    if (!room) return false;
    const act = room.activity || room.mode;
    return act === 'poll';
  }

  function isQuizActivity_(room) {
    room = room || activeRoom_;
    if (!room) return false;
    const act = room.activity || room.mode;
    return act === 'vocab' || act === 'word-link';
  }

  function currentMode_(room) {
    room = room || activeRoom_;
    if (!room) return '';
    return String(room.activity || room.mode || '').trim();
  }

  function getContinueChecked_() {
    const boardCb = el_('live-board-continue-modes');
    const setupCb = el_('live-poll-setup-continue-modes');
    if (boardCb && document.body.classList.contains('live-room-board-active')) return !!boardCb.checked;
    if (setupCb && document.body.classList.contains('live-poll-setup-active')) return !!setupCb.checked;
    if (setupCb) return !!setupCb.checked;
    if (boardCb) return !!boardCb.checked;
    return true;
  }

  function showLiveModeView_(on) {
    document.body.classList.toggle('live-mode-view-active', !!on);
    const screen = el_('live-mode-screen');
    if (screen) screen.style.display = on ? 'block' : 'none';
    const btn = el_('live-mode-open-btn');
    if (btn) btn.classList.toggle('is-active-live-nav', !!on);
    refreshUi_();
  }

  function isLiveModeView_() {
    return document.body.classList.contains('live-mode-view-active');
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

  function normalizeAttempt_(mode, attempt) {
    attempt = attempt || {};
    const correct = parseInt(attempt.correct, 10) || 0;
    const total = parseInt(attempt.total, 10) || 0;
    const durationSec = parseDurationSec_(attempt.durationSec);
    const wrongCount = Math.max(0, parseInt(attempt.wrongCount, 10) || 0);
    let scoreRate = parseInt(attempt.scoreRate, 10);
    if (isNaN(scoreRate)) {
      scoreRate = total > 0 ? Math.round((correct / total) * 100) : 0;
    }
    const out = {
      correct: correct,
      total: total,
      scoreRate: scoreRate,
      durationSec: durationSec,
      wrongCount: wrongCount,
      timedOut: !!attempt.timedOut,
      finishedAt: attempt.finishedAt || new Date().toISOString()
    };
    if (mode === 'word-link') {
      out.linkMode = String(attempt.linkMode || '').trim();
    }
    return out;
  }

  function isBetterAttempt_(mode, nextAttempt, prevBest) {
    nextAttempt = normalizeAttempt_(mode, nextAttempt);
    if (!prevBest) return true;
    prevBest = normalizeAttempt_(mode, prevBest);
    if (mode === 'word-link') {
      return compareWordLinkBest_(nextAttempt, prevBest) < 0;
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

  function formatDuration_(sec, precise) {
    const n = parseDurationSec_(sec);
    if (precise) {
      const m = Math.floor(n / 60);
      const r = n - m * 60;
      return m > 0 ? (m + '分' + r.toFixed(2) + '秒') : (r.toFixed(2) + '秒');
    }
    const s = Math.floor(n);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? (m + '分' + r + '秒') : (r + '秒');
  }

  function loadFontPt_() {
    try {
      const n = parseInt(localStorage.getItem(FONT_KEY), 10);
      if (isNaN(n)) return FONT_DEFAULT;
      return Math.min(FONT_MAX, Math.max(FONT_MIN, n));
    } catch (e) {
      return FONT_DEFAULT;
    }
  }

  function applyFontPt_(pt, persist) {
    pt = Math.min(FONT_MAX, Math.max(FONT_MIN, parseInt(pt, 10) || FONT_DEFAULT));
    const screen = el_('live-room-board-screen');
    if (screen) screen.style.setProperty('--live-list-pt', String(pt));
    const input = el_('live-board-font-input');
    if (input && String(input.value) !== String(pt)) input.value = String(pt);
    if (persist !== false) {
      try { localStorage.setItem(FONT_KEY, String(pt)); } catch (e) { /* ignore */ }
    }
    return pt;
  }

  function loadBestN_() {
    try {
      const n = parseInt(localStorage.getItem(BEST_N_KEY), 10);
      if (isNaN(n)) return BEST_N_DEFAULT;
      return Math.min(200, Math.max(1, n));
    } catch (e) {
      return BEST_N_DEFAULT;
    }
  }

  function saveBestN_(n) {
    n = Math.min(200, Math.max(1, parseInt(n, 10) || BEST_N_DEFAULT));
    try { localStorage.setItem(BEST_N_KEY, String(n)); } catch (e) { /* ignore */ }
    return n;
  }

  function applyBestNToUi_(n) {
    n = saveBestN_(n);
    const input = el_('live-board-best-n');
    const select = el_('live-board-best-n-select');
    if (input && String(input.value) !== String(n)) input.value = String(n);
    if (select) {
      select.value = BEST_N_PRESETS.indexOf(n) >= 0 ? String(n) : '';
    }
    return n;
  }

  function bestFingerprint_(best) {
    best = best || {};
    return [best.scoreRate, best.durationSec, best.wrongCount, best.finishedAt, best.linkMode].join('|');
  }

  function paintBoardTimerText_(closesAt, timeLimitSec) {
    const timerEl = el_('live-board-timer');
    if (!timerEl) return;
    if (closesAt) {
      const left = Math.max(0, Math.ceil((closesAt - Date.now()) / 1000));
      timerEl.textContent = left > 0 ? formatBoardClock_(left) : '終了';
      timerEl.classList.toggle('is-urgent', left > 0 && left <= 30);
      return;
    }
    timerEl.classList.remove('is-urgent');
    if (timeLimitSec > 0) timerEl.textContent = formatBoardClock_(timeLimitSec);
    else timerEl.textContent = '制限なし';
  }

  function startBoardClock_() {
    stopBoardClock_();
    function tick() {
      const room = activeRoom_ || {};
      const data = lastBoardData_ || {};
      const closesAt = data.closesAt || room.closesAt || 0;
      const timeLimitSec = data.timeLimitSec != null ? data.timeLimitSec : room.timeLimitSec;
      paintBoardTimerText_(closesAt, timeLimitSec);
    }
    tick();
    boardClockId_ = setInterval(tick, 250);
  }

  function stopBoardClock_() {
    if (boardClockId_) {
      clearInterval(boardClockId_);
      boardClockId_ = null;
    }
  }

  function relocateLiveEntry_() {
    const block = el_('live-room-entry-block');
    if (!block) return;
    if (document.body.classList.contains('live-mode-view-active')) {
      const slot = el_('live-mode-entry-slot');
      if (slot && block.parentNode !== slot) slot.appendChild(block);
      block.style.display = '';
      return;
    }
    const quiz = document.getElementById('vocab-quiz-section');
    const link = document.getElementById('vocab-link-section');
    const quizOn = quiz && quiz.style.display !== 'none';
    const linkOn = link && link.style.display !== 'none';
    const target = linkOn ? link : (quizOn ? quiz : null);
    if (target) {
      if (block.parentNode !== target) target.appendChild(block);
      block.style.display = '';
    } else {
      block.style.display = 'none';
    }
  }

  function formatLimit_(sec) {
    const s = Math.max(0, parseInt(sec, 10) || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m > 0) return m + ':' + String(r).padStart(2, '0');
    return String(r) + '秒';
  }

  function formatBoardClock_(sec) {
    const s = Math.max(0, parseInt(sec, 10) || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
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
  }

  function launchSummaryCols_(mode, opts, timeLimitSec) {
    opts = opts || {};
    const left = [];
    const right = [];
    left.push('種別: ' + (mode === 'poll' ? 'リアルタイム投票'
      : (mode === 'word-link' ? 'Word Link' : '単語クイズ')));
    if (mode === 'poll') {
      right.push('問題文はスライド側に表示');
      if (timeLimitSec > 0) right.push('制限時間: ' + formatLimit_(timeLimitSec));
      else right.push('部屋の制限時間: なし');
      return { left: left, right: right };
    }
    if (opts.bookName || opts.sheetName) {
      left.push('教材: ' + (opts.bookName || '—') + ' / ' + (opts.sheetName || '—'));
    }
    const filters = opts.filters || {};
    const divParts = [];
    if (filters.dai && filters.dai.length) divParts.push('大:' + filters.dai.join(','));
    if (filters.chu && filters.chu.length) divParts.push('中:' + filters.chu.join(','));
    if (filters.sho && filters.sho.length) divParts.push('小:' + filters.sho.join(','));
    left.push('区分: ' + (divParts.length ? divParts.join(' / ') : '指定なし（シート全体）'));
    if (mode === 'word-link') {
      const linkMode = opts.linkMode || (opts.wordLink && opts.wordLink.linkMode);
      if (linkMode) right.push('形式: ' + wordLinkModeLabel_(linkMode));
      else right.push('形式: 未指定');
      right.push('出題数: ' + (opts.linkQuestionCount || 25) + '語');
    } else {
      const axes = opts.axes || {};
      const dirMap = { jaen: '和英', enja: '英和' };
      const grainMap = { WD: '語', PH: '句', EX: '例文' };
      const dirs = (axes.directions || []).map(function (d) { return dirMap[d] || d; });
      const grains = (axes.grains || []).map(function (g) { return grainMap[g] || g; });
      right.push('方向: ' + (dirs.length ? dirs.join('・') : '—'));
      right.push('単位: ' + (grains.length ? grains.join('・') : '—'));
      const respMap = { choice: '選択', typing: '入力', speech: '音声' };
      right.push('解答: ' + (respMap[axes.response] || axes.response || '—'));
      if (opts.questionCount) right.push('出題数: ' + (opts.questionCount === 'all' ? 'すべて' : opts.questionCount + '問'));
    }
    if (timeLimitSec > 0) right.push('制限時間: ' + formatLimit_(timeLimitSec));
    else right.push('制限時間: なし');
    return { left: left, right: right };
  }

  function formatLaunchSummary_(mode, opts, timeLimitSec) {
    const cols = launchSummaryCols_(mode, opts, timeLimitSec);
    return cols.left.concat(cols.right).join('\n');
  }

  function paintLaunchSummary_(el, mode, opts, timeLimitSec) {
    if (!el) return;
    const cols = launchSummaryCols_(mode, opts, timeLimitSec);
    function colHtml(lines) {
      return '<div class="live-board-settings-col">' + lines.map(function (line) {
        return escapeHtml_(line);
      }).join('<br>') + '</div>';
    }
    el.innerHTML = colHtml(cols.left) + colHtml(cols.right);
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
      if (isPollRoom_(stored)) {
        activeRoom_ = stored;
        localBest_ = stored.localBest || null;
        timeoutFired_ = false;
        refreshUi_();
        if (window.LivePollModule) {
          const openFn = LivePollModule.openSetup || LivePollModule.openHost;
          openFn.call(LivePollModule).catch(function (e) {
            console.warn('投票ホスト復帰:', e.message || e);
          });
        }
        return;
      }
      showBoardScreen_();
      startBoardUpdates_();
    } else if (stored.closesAt) {
      startRoomTimer_(stored.closesAt);
    }
    refreshUi_();
  }

  function restoreFromStorage_() {
    hideBoardScreen_();
    const stored = loadStoredRoom_();
    if (!stored || !stored.pin) {
      refreshUi_();
      return;
    }
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
    startStudentRoomMetaWatch_();
  }

  function maybeOpenLivePollFromQuery_() {
    try {
      if (maybeOpenLivePollFromQuery_._done) return;
      const params = new URLSearchParams(window.location.search || '');
      if (params.get('livePoll') !== '1') return;
      if (!isLoggedIn_() || !isAdminUser_()) return;
      maybeOpenLivePollFromQuery_._done = true;
      if (activeRoom_ && activeRoom_.isTeacher && isPollRoom_(activeRoom_)) {
        if (window.LivePollModule) LivePollModule.openHost();
        return;
      }
      const btn = el_('live-vote-open-btn');
      if (btn) btn.click();
    } catch (e) { /* ignore */ }
  }

  function tryResumeAfterAuth_() {
    if (activeRoom_) {
      if (activeRoom_.isTeacher && (!isLoggedIn_() || !isAdminUser_())) {
        hideBoardScreen_();
        stopBoardUpdates_();
        if (window.LivePollModule) LivePollModule.closeScreens();
        refreshUi_();
        return;
      }
      refreshUi_();
      maybeOpenLivePollFromQuery_();
      return;
    }
    restoreFromStorage_();
    refreshUi_();
    maybeOpenLivePollFromQuery_();
  }

  function refreshUi_() {
    const banner = el_('live-room-student-banner');
    const teacherBanner = el_('live-room-teacher-banner');
    const adminBtns = document.querySelectorAll('.live-room-open-btn');
    const joinPanel = el_('live-room-join-panel');
    if (banner) {
      if (activeRoom_ && !activeRoom_.isTeacher && isLoggedIn_()) {
        banner.style.display = 'block';
        const statusEl = el_('live-room-student-status');
        if (statusEl) {
          statusEl.textContent = '授業ライブ参加中 [' + backendLabel_(activeRoom_.backend) + ']: '
            + (activeRoom_.title || activeRoom_.pin)
            + '（コード ' + activeRoom_.pin + '）';
        }
        const startBtn = el_('live-room-start-attempt-btn');
        if (startBtn) {
          startBtn.textContent = isPollRoom_(activeRoom_) ? '参加する（投票）' : '参加する（取り組む）';
        }
        const settingsEl = el_('live-room-student-settings');
        if (settingsEl) {
          settingsEl.textContent = formatLaunchSummary_(currentMode_(activeRoom_), activeRoom_.launchOptions, activeRoom_.timeLimitSec);
        }
      } else {
        banner.style.display = 'none';
      }
    }
    const storedTeacher = (activeRoom_ && activeRoom_.isTeacher) ? activeRoom_ : loadStoredRoom_();
    const boardVisible = document.body.classList.contains('live-room-board-active')
      || document.body.classList.contains('live-poll-host-active')
      || document.body.classList.contains('live-poll-setup-active');
    if (teacherBanner) {
      if (canRestoreTeacher_(storedTeacher) && !boardVisible) {
        teacherBanner.style.display = 'block';
        teacherBanner.innerHTML = '授業ライブ開催中 [' + escapeHtml_(backendLabel_(storedTeacher.backend)) + ']: '
          + escapeHtml_(storedTeacher.title || storedTeacher.pin)
          + '（コード ' + escapeHtml_(storedTeacher.pin) + '）'
          + ' <button type="button" class="btn-secondary" id="live-room-show-board-btn" style="width:auto;min-width:auto;padding:4px 10px;margin-left:8px;">'
          + (isPollRoom_(storedTeacher) ? '投票画面を表示' : 'ボードを表示') + '</button>';
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
    const backendBlock = el_(BACKEND_UI_ROOT);
    if (backendBlock) {
      backendBlock.style.display = (isAdminUser_() && isLoggedIn_() && !homework) ? '' : 'none';
    }
    const liveModeWrap = el_('vocab-link-live-mode-wrap');
    if (liveModeWrap) {
      liveModeWrap.style.display = (isAdminUser_() && isLoggedIn_() && !homework) ? '' : 'none';
    }
    const voteBtn = el_('live-vote-open-btn');
    if (voteBtn) {
      voteBtn.style.display = (isAdminUser_() && isLoggedIn_() && !homework) ? '' : 'none';
    }
    if (joinPanel && activeRoom_ && !activeRoom_.isTeacher) {
      const pinInput = el_('live-room-pin-input');
      if (pinInput) pinInput.value = activeRoom_.pin;
    }
    relocateLiveEntry_();
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
    return createRoomWithOpts_(mode, showCreateDialog_(mode));
  }

  async function switchActivity_(activity, opts) {
    opts = opts || {};
    const room = activeRoom_;
    if (!room || !room.isTeacher) throw new Error('開催中の部屋がありません');
    if (!room.continueAcrossModes) {
      throw new Error('先に開催中の授業ライブを閉じるか、モード継続を有効にしてください');
    }
    const payload = {
      action: 'liveSwitchActivity',
      pin: room.pin,
      activity: activity
    };
    if (activity === 'vocab' || activity === 'word-link') {
      if (!window.VocabSettingsModule) throw new Error('設定モジュールが未初期化です');
      const launchOptions = opts.launchOptions || window.VocabSettingsModule.getQuizOptions();
      if (!launchOptions.bookName || !launchOptions.sheetName) {
        throw new Error('ブックと教材（シート）を選択してください');
      }
      if (activity === 'word-link') {
        const linkMode = String(opts.linkMode || launchOptions.linkMode
          || (el_('vocab-link-live-mode') || {}).value || '').trim();
        if (!isWordLinkMode_(linkMode)) {
          throw new Error('Word Link の形式（英和 / 和英 / Audio）を選んでください');
        }
        launchOptions.linkMode = linkMode;
      }
      payload.launchOptions = launchOptions;
      if (opts.timeLimitSec != null) payload.timeLimitSec = opts.timeLimitSec;
      if (opts.title) payload.title = opts.title;
      payload.autoSubmitOnTimeout = opts.autoSubmitOnTimeout !== false;
    }
    if (activity === 'poll' && opts.title) payload.title = opts.title;
    const res = await post_(payload);
    const data = res.data || {};
    const current = data.activity || activity;
    room.activity = current;
    room.mode = current;
    room.backend = data.backend || room.backend;
    room.pollPublic = data.pollPublic != null ? data.pollPublic : room.pollPublic;
    room.launchOptions = data.launchOptions || room.launchOptions;
    room.title = data.title || room.title;
    room.timeLimitSec = data.timeLimitSec != null ? data.timeLimitSec : room.timeLimitSec;
    room.closesAt = data.closesAt != null ? data.closesAt : room.closesAt;
    room.autoSubmitOnTimeout = data.autoSubmitOnTimeout !== false;
    room.continueAcrossModes = data.continueAcrossModes !== false;
    boardDefaultedPin_ = '';
    boardPrevByKind_ = { achievement: {}, score: {}, speed: {} };
    boardListSigByKind_ = { achievement: '', score: '', speed: '' };
    timeoutFired_ = false;
    setActiveRoom_(room);
    if (activity === 'poll') {
      stopBoardUpdates_();
      hideBoardScreen_();
      if (window.LivePollModule) {
        if (LivePollModule.openSetup) await LivePollModule.openSetup();
        else await LivePollModule.openHost();
      }
    } else {
      if (window.LivePollModule) LivePollModule.closeScreens();
      applyLaunchOptionsToUi_(room.launchOptions, activity);
      showBoardScreen_();
      startBoardUpdates_();
    }
    refreshUi_();
    return room;
  }

  async function createRoomWithOpts_(mode, opts) {
    if (!isAdminUser_()) throw new Error('管理者のみ部屋を開けます');
    if (!window.VocabSettingsModule) throw new Error('設定モジュールが未初期化です');
    opts = opts || {};
    if (activeRoom_ && activeRoom_.isTeacher && (activeRoom_.continueAcrossModes || getContinueChecked_())) {
      activeRoom_.continueAcrossModes = true;
      return switchActivity_(mode === 'word-link' ? 'word-link' : 'vocab', opts);
    }
    if (activeRoom_ && activeRoom_.isTeacher) {
      throw new Error('先に開催中の授業ライブを閉じるか、モード継続を有効にしてください');
    }
    const launchOptions = window.VocabSettingsModule.getQuizOptions();
    if (!launchOptions.bookName || !launchOptions.sheetName) {
      throw new Error('ブックと教材（シート）を選択してください');
    }
    if (mode === 'word-link') {
      const linkMode = String(opts.linkMode || launchOptions.linkMode
        || (el_('vocab-link-live-mode') || {}).value || '').trim();
      if (!isWordLinkMode_(linkMode)) {
        throw new Error('Word Link の形式（英和 / 和英 / Audio）を選んでください');
      }
      launchOptions.linkMode = linkMode;
    }
    const backend = opts.backend || getSelectedBackend_();
    const res = await post_({
      action: 'liveCreate',
      mode: mode,
      backend: backend,
      launchOptions: launchOptions,
      targetClass: opts.targetClass,
      timeLimitSec: opts.timeLimitSec,
      autoSubmitOnTimeout: true,
      title: opts.title,
      continueAcrossModes: opts.continueAcrossModes != null ? opts.continueAcrossModes : getContinueChecked_()
    });
    const data = res.data || {};
    if (!data.pin) throw new Error('参加コードを発行できませんでした');
    const room = {
      pin: data.pin,
      backend: data.backend || backend,
      title: data.title,
      mode: data.mode,
      activity: data.activity || data.mode,
      pollPublic: data.pollPublic || null,
      isTeacher: true,
      closesAt: data.closesAt || 0,
      timeLimitSec: data.timeLimitSec || 0,
      autoSubmitOnTimeout: data.autoSubmitOnTimeout !== false,
      rosterCount: data.rosterCount || 0,
      launchOptions: data.launchOptions || launchOptions,
      continueAcrossModes: data.continueAcrossModes !== false
    };
    timeoutFired_ = false;
    boardDefaultedPin_ = '';
    setActiveRoom_(room);
    if (isPollRoom_(room)) {
      if (window.LivePollModule) await LivePollModule.openHost();
      return room;
    }
    showBoardScreen_();
    startBoardUpdates_();
    return room;
  }

  async function createPollRoomWithOpts_(opts) {
    if (!isAdminUser_()) throw new Error('管理者のみ投票を開催できます');
    opts = opts || {};
    if (activeRoom_ && activeRoom_.isTeacher && activeRoom_.continueAcrossModes && !isPollRoom_(activeRoom_)) {
      await switchActivity_('poll', opts);
      return activeRoom_;
    }
    if (activeRoom_ && activeRoom_.isTeacher && !isPollRoom_(activeRoom_)) {
      throw new Error('先に開催中の授業ライブを閉じるか、モード継続を有効にしてください');
    }
    if (activeRoom_ && activeRoom_.isTeacher && isPollRoom_(activeRoom_)) {
      if (window.LivePollModule && !opts.skipOpenHost) {
        if (LivePollModule.openSetup) await LivePollModule.openSetup();
        else await LivePollModule.openHost();
      }
      return activeRoom_;
    }
    if (window.LiveFirebase && typeof LiveFirebase.fetchConfig === 'function') {
      const cfg = await LiveFirebase.fetchConfig();
      if (!cfg || !cfg.firebaseEnabled) {
        throw new Error('投票ライブは Firebase β が必要です。接続方式の設定を確認してください');
      }
    }
    const res = await post_({
      action: 'liveCreate',
      mode: 'poll',
      backend: 'firebase',
      targetClass: opts.targetClass,
      title: opts.title,
      timeLimitSec: 0,
      autoSubmitOnTimeout: false,
      continueAcrossModes: opts.continueAcrossModes != null ? opts.continueAcrossModes : getContinueChecked_()
    });
    const data = res.data || {};
    if (!data.pin) throw new Error('参加コードを発行できませんでした');
    const room = {
      pin: data.pin,
      backend: 'firebase',
      title: data.title || 'リアルタイム投票',
      mode: 'poll',
      activity: 'poll',
      pollPublic: data.pollPublic || null,
      isTeacher: true,
      closesAt: 0,
      timeLimitSec: 0,
      autoSubmitOnTimeout: false,
      rosterCount: data.rosterCount || 0,
      launchOptions: {},
      continueAcrossModes: data.continueAcrossModes !== false
    };
    timeoutFired_ = false;
    boardDefaultedPin_ = '';
    setActiveRoom_(room);
    if (window.LivePollModule && !opts.skipOpenHost) {
      if (LivePollModule.openSetup) await LivePollModule.openSetup();
      else await LivePollModule.openHost();
    }
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
      backend: data.backend || 'gas',
      title: data.title,
      mode: data.mode,
      activity: data.activity || data.mode,
      pollPublic: data.pollPublic || null,
      isTeacher: false,
      closesAt: data.closesAt || 0,
      timeLimitSec: data.timeLimitSec || 0,
      autoSubmitOnTimeout: data.autoSubmitOnTimeout !== false,
      launchOptions: data.launchOptions || null,
      localBest: (data.entry && data.entry.best) ? data.entry.best : null,
      continueAcrossModes: data.continueAcrossModes !== false
    };
    timeoutFired_ = false;
    localBest_ = room.localBest;
    setActiveRoom_(room);
    if (!isPollRoom_(room)) applyLaunchOptionsToUi_(room.launchOptions, room.activity || room.mode);
    startStudentRoomMetaWatch_();
    return room;
  }

  function stopStudentRoomMetaWatch_() {
    if (window.LiveFirebase && typeof LiveFirebase.unsubscribeRoomMeta === 'function') {
      LiveFirebase.unsubscribeRoomMeta();
    }
  }

  function handleRoomMetaChange_(data) {
    if (!activeRoom_ || activeRoom_.isTeacher) return;
    const prevActivity = activeRoom_.activity || activeRoom_.mode;
    activeRoom_.activity = data.activity || activeRoom_.activity;
    if (data.mode) activeRoom_.mode = data.mode;
    activeRoom_.pollPublic = data.pollPublic != null ? data.pollPublic : activeRoom_.pollPublic;
    if (data.launchOptions) activeRoom_.launchOptions = data.launchOptions;
    if (data.title) activeRoom_.title = data.title;
    if (data.timeLimitSec != null) activeRoom_.timeLimitSec = data.timeLimitSec;
    if (data.closesAt != null) activeRoom_.closesAt = data.closesAt;
    saveStoredRoom_(activeRoom_);
    const newActivity = activeRoom_.activity || activeRoom_.mode;
    if (prevActivity !== newActivity) {
      if (window.LivePollModule && LivePollModule.isStudentOpen && LivePollModule.isStudentOpen()) {
        if (newActivity !== 'poll') LivePollModule.closeScreens();
      }
      if (newActivity !== 'poll') {
        applyLaunchOptionsToUi_(activeRoom_.launchOptions, newActivity);
      }
      if (typeof showToast_ === 'function') {
        showToast_(newActivity === 'poll'
          ? '投票が始まりました。「参加する（投票）」から入れます'
          : '取り組みが再開できます。「参加する（取り組む）」から開始できます');
      }
    }
    refreshUi_();
  }

  function startStudentRoomMetaWatch_() {
    if (!activeRoom_ || activeRoom_.isTeacher || !isFirebaseRoom_()) return;
    if (!window.LiveFirebase || typeof LiveFirebase.subscribeRoomMeta !== 'function') return;
    LiveFirebase.subscribeRoomMeta(activeRoom_.pin, {
      activity: activeRoom_.activity || activeRoom_.mode,
      pollPublic: activeRoom_.pollPublic,
      launchOptions: activeRoom_.launchOptions
    }, handleRoomMetaChange_, function (e) {
      console.warn('部屋 meta 購読:', e.message || e);
    });
  }

  function applyLaunchOptionsToUi_(opts, mode) {
    if (!opts || !window.VocabSettingsModule || typeof VocabSettingsModule.applySettings !== 'function') return;
    try {
      VocabSettingsModule.applySettings(opts);
      if (typeof VocabSettingsModule.applyVocabModeTab === 'function') {
        VocabSettingsModule.applyVocabModeTab(mode === 'word-link' ? 'link' : 'quiz', false);
      }
    } catch (e) {
      console.warn('授業ライブ設定の反映:', e.message || e);
    }
  }

  async function startAssignedSession_() {
    if (!activeRoom_ || activeRoom_.isTeacher) throw new Error('授業ライブに参加してから取り組んでください');
    if (isPollRoom_(activeRoom_)) {
      if (!window.LivePollModule) throw new Error('投票モジュールの読み込みに失敗しました');
      const startBtn = el_('live-room-start-attempt-btn');
      await BusyButton.run(startBtn, async function () {
        await LivePollModule.openStudent();
      }, '開いています…');
      return;
    }
    const opts = Object.assign({}, activeRoom_.launchOptions || {});
    opts.homeworkMode = false;
    if (!opts.bookName || !opts.sheetName) throw new Error('出題設定がありません。もう一度参加し直してください。');
    applyLaunchOptionsToUi_(opts, currentMode_(activeRoom_));
    const startBtn = el_('live-room-start-attempt-btn');
    if (currentMode_(activeRoom_) === 'word-link') {
      if (!window.VocabLinkModule) throw new Error('Word Link モジュールの読み込みに失敗しました');
      if (window.TtsModule && typeof window.TtsModule.prime === 'function') window.TtsModule.prime();
      await BusyButton.run(startBtn, async function () {
        await VocabLinkModule.loadAndStart(opts);
        if (window.BackendSyncStatus) BackendSyncStatus.refresh();
      }, '開始中…');
      return;
    }
    if (typeof window.runVocabQuizSession_ !== 'function') {
      throw new Error('単語クイズを開始できません');
    }
    window.currentAppMode = 'vocab';
    await window.runVocabQuizSession_(opts, startBtn, null);
  }

  async function leaveRoom() {
    stopBoardUpdates_();
    stopBoardClock_();
    clearRoomTimer_();
    stopStudentRoomMetaWatch_();
    if (window.LivePollModule) LivePollModule.closeScreens();
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
    const res = await post_({ action: 'liveClose', pin: room.pin }, 1, EXPORT_TIMEOUT_MS);
    if (window.LivePollModule) LivePollModule.closeScreens();
    await leaveRoom();
    const data = (res && res.data) || {};
    if (data.spreadsheetUrl) {
      const name = data.spreadsheetName || '結果ブック';
      if (window.confirm('結果を保存しました: ' + name + '\nスプレッドシートを開きますか？')) {
        window.open(data.spreadsheetUrl, '_blank');
      }
    }
  }

  async function exportResults() {
    const room = (activeRoom_ && activeRoom_.isTeacher) ? activeRoom_ : loadStoredRoom_();
    if (!room || !room.isTeacher) throw new Error('開催中の部屋がありません');
    const res = await post_({ action: 'liveExport', pin: room.pin }, 1, EXPORT_TIMEOUT_MS);
    const data = (res && res.data) || {};
    if (data.spreadsheetUrl) {
      const name = data.spreadsheetName || '結果ブック';
      if (window.confirm('結果を保存しました: ' + name + '\nスプレッドシートを開きますか？')) {
        window.open(data.spreadsheetUrl, '_blank');
      }
    }
    return data;
  }

  function dismissBoardToSettings_() {
    stopBoardUpdates_();
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
    if (isPollRoom_(stored)) {
      activeRoom_ = stored;
      refreshUi_();
      if (window.LivePollModule) {
        const openFn = LivePollModule.openSetup || LivePollModule.openHost;
        openFn.call(LivePollModule).catch(function (e) { alert(e.message || e); });
      }
      return;
    }
    applyStoredRoom_(stored);
  }

  async function submitAttempt(attempt, options) {
    options = options || {};
    if (!activeRoom_ || activeRoom_.isTeacher) return { skipped: true, reason: 'no_student_room' };
    if (!isQuizActivity_(activeRoom_)) return { skipped: true, reason: 'activity_frozen' };
    const mode = activeRoom_.activity || activeRoom_.mode;
    const normalized = normalizeAttempt_(mode, attempt);
    if (!isBetterAttempt_(mode, normalized, localBest_)) {
      return { skipped: true, reason: 'not_better', localBest: localBest_ };
    }
    if (isFirebaseRoom_()) {
      if (!window.LiveFirebase) throw new Error('Firebase モジュールが読み込まれていません');
      const user = (window.AuthGateService && AuthGateService.getUser()) || {};
      const fbRes = await LiveFirebase.submitEntry(
        activeRoom_.pin, mode, user, normalized, localBest_);
      if (fbRes.updated && fbRes.entry && fbRes.entry.best) {
        localBest_ = fbRes.entry.best;
        activeRoom_.localBest = fbRes.entry.best;
        saveStoredRoom_(activeRoom_);
      }
      return {
        updated: !!fbRes.updated,
        entry: fbRes.entry || {},
        localBest: localBest_
      };
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
    const mode = activeRoom_ ? currentMode_(activeRoom_) : '';
    if (mode === 'word-link') {
      return normalizeAttempt_('word-link', {
        correct: extra.wordCount || summary.Correct || 0,
        total: extra.wordCount || summary.Total || 0,
        durationSec: extra.elapsedSec != null ? extra.elapsedSec : summary.Duration_Sec,
        wrongCount: extra.totalWrong || 0,
        linkMode: extra.linkMode || ((window.VocabLinkModule && VocabLinkModule.getSessionDisplaySettings)
          ? VocabLinkModule.getSessionDisplaySettings().linkMode : ''),
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
    if (!isActive() || isTeacherRoom() || !isQuizActivity_()) return { skipped: true };
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

  function paintBoardHeaderFromRoom_(room) {
    room = room || activeRoom_ || {};
    const titleEl = el_('live-board-title');
    const pinEl = el_('live-board-pin');
    const metaEl = el_('live-board-meta');
    if (titleEl) titleEl.textContent = room.title || '授業ライブ';
    if (pinEl) pinEl.textContent = room.pin || '';
    paintBackendBadge_(room.backend);
    if (metaEl) {
      metaEl.textContent = '名簿 ' + (room.rosterCount || 0) + ' 人';
    }
    paintBoardTimerText_(room.closesAt, room.timeLimitSec);
    startBoardClock_();
  }

  function showBoardScreen_() {
    const screen = el_('live-room-board-screen');
    if (screen) {
      screen.style.display = 'flex';
      screen.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('live-room-board-active');
    applyBestNToUi_(loadBestN_());
    paintBoardHeaderFromRoom_(activeRoom_);
    applyFontPt_(loadFontPt_(), false);
    if (activeRoom_) {
      paintLaunchSummary_(
        el_('live-board-settings'),
        currentMode_(activeRoom_), activeRoom_.launchOptions, activeRoom_.timeLimitSec);
    }
    updateBoardTabLabels_(currentMode_(activeRoom_));
  }

  function hideBoardScreen_() {
    const screen = el_('live-room-board-screen');
    if (screen) {
      screen.style.display = 'none';
      screen.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('live-room-board-active');
    stopBoardClock_();
  }

  function renderBoard_(data) {
    const titleEl = el_('live-board-title');
    const pinEl = el_('live-board-pin');
    const metaEl = el_('live-board-meta');
    if (data.backend) paintBackendBadge_(data.backend);
    if (titleEl) titleEl.textContent = data.title || '授業ライブ';
    if (pinEl) pinEl.textContent = data.pin || (activeRoom_ && activeRoom_.pin) || pinEl.textContent || '';
    if (metaEl) {
      metaEl.textContent = '達成 ' + (data.finishedCount || 0)
        + ' / 名簿 ' + (data.rosterCount || data.joinedCount || 0);
    }
    lastBoardData_ = data;
    if (activeRoom_) {
      if (data.closesAt) activeRoom_.closesAt = data.closesAt;
      if (data.timeLimitSec != null) activeRoom_.timeLimitSec = data.timeLimitSec;
    }
    startBoardClock_();
    if (activeRoom_) {
      if (data.backend) activeRoom_.backend = data.backend;
      if (data.launchOptions) activeRoom_.launchOptions = data.launchOptions;
      if (data.activity) activeRoom_.activity = data.activity;
      if (data.mode) activeRoom_.mode = data.mode;
      if (data.title) activeRoom_.title = data.title;
      saveStoredRoom_(activeRoom_);
    }
    paintLaunchSummary_(
      el_('live-board-settings'),
      data.activity || data.mode || currentMode_(activeRoom_),
      data.launchOptions || (activeRoom_ && activeRoom_.launchOptions),
      data.timeLimitSec != null ? data.timeLimitSec : (activeRoom_ && activeRoom_.timeLimitSec)
    );
    const boardMode = data.activity || data.mode || currentMode_(activeRoom_);
    updateBoardTabLabels_(boardMode);
    renderBoardList_('live-board-list-achievement', data.lists && data.lists.achievement, boardMode, 'achievement');
    renderBoardList_('live-board-list-score', data.lists && data.lists.scoreRate, boardMode, 'score');
    renderBoardList_('live-board-list-speed', data.lists && data.lists.speed, boardMode, 'speed');
    if (boardDefaultedPin_ !== (data.pin || (activeRoom_ && activeRoom_.pin) || '')) {
      boardDefaultedPin_ = data.pin || (activeRoom_ && activeRoom_.pin) || '';
      boardPrevByKind_ = { achievement: {}, score: {}, speed: {} };
      boardListSigByKind_ = { achievement: '', score: '', speed: '' };
      switchBoardTab_(boardMode === 'word-link' ? 'score' : 'score');
    }
  }

  function updateBoardTabLabels_(mode) {
    document.querySelectorAll('.live-board-tab').forEach(function (btn) {
      const tab = btn.getAttribute('data-live-tab');
      if (tab === 'score') btn.textContent = mode === 'word-link' ? 'ミス順' : '正解率';
      if (tab === 'speed') btn.textContent = mode === 'word-link' ? 'タイム' : '速さ';
    });
  }

  function renderBoardList_(containerId, rows, mode, kind) {
    const el = el_(containerId);
    if (!el) return;
    rows = rows || [];
    const prevMap = boardPrevByKind_[kind] || {};
    const nextMap = {};
    const limit = loadBestN_();
    const shown = rows.slice(0, limit);
    const sig = limit + ':' + shown.map(function (r) {
      return String(r.account || '') + ':' + bestFingerprint_(r.best);
    }).join(';');
    if (sig === boardListSigByKind_[kind] && el.querySelector('table')) return;
    boardListSigByKind_[kind] = sig;
    if (!rows.length) {
      boardPrevByKind_[kind] = {};
      el.innerHTML = '<p class="filter-axis-hint" style="margin:0;">まだ達成者がいません</p>';
      return;
    }
    const isWl = mode === 'word-link';
    let html = '<table class="live-board-table"><thead><tr><th>#</th><th>番号</th><th>氏名</th>';
    if (isWl) html += '<th>形式</th>';
    if (kind === 'achievement') html += '<th>達成時刻</th>';
    else if (isWl) html += '<th>ミス</th><th>タイム</th>';
    else if (kind === 'speed') html += '<th>タイム</th>';
    else html += '<th>正解率</th>';
    html += '</tr></thead><tbody>';
    shown.forEach(function (row, idx) {
      const account = String(row.account || row.name || idx);
      const rank = idx + 1;
      const best = row.best || {};
      const fp = bestFingerprint_(best);
      const prev = prevMap[account];
      const classes = [];
      if (Object.keys(prevMap).length) {
        if (prev && prev.fp && prev.fp !== fp) classes.push('live-row-best-flash');
        else if (!prev && fp) classes.push('live-row-best-flash');
        if (prev && prev.rank && prev.rank !== rank) classes.push('live-row-rank-shift');
      }
      nextMap[account] = { rank: rank, fp: fp };
      const cls = classes.length ? (' class="' + classes.join(' ') + '"') : '';
      html += '<tr' + cls + ' data-account="' + escapeHtml_(account) + '"><td>' + rank + '</td><td>'
        + escapeHtml_(row.number || '—') + '</td><td>'
        + escapeHtml_(row.name || '—') + '</td>';
      if (isWl) html += '<td>' + escapeHtml_(wordLinkModeLabel_(best.linkMode) || '—') + '</td>';
      if (kind === 'achievement') {
        const d = best.finishedAt ? new Date(best.finishedAt) : null;
        const value = d ? (d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')) : '—';
        html += '<td>' + escapeHtml_(value) + '</td>';
      } else if (isWl) {
        html += '<td>' + escapeHtml_(String(best.wrongCount || 0)) + '</td>';
        html += '<td>' + escapeHtml_(formatDuration_(best.durationSec, true)) + '</td>';
      } else if (kind === 'speed') {
        html += '<td>' + escapeHtml_(formatDuration_(best.durationSec)) + '</td>';
      } else {
        let value = (best.scoreRate != null ? best.scoreRate : '—') + '%';
        if (best.durationSec) value += ' / ' + formatDuration_(best.durationSec);
        html += '<td>' + escapeHtml_(value) + '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
    boardPrevByKind_[kind] = nextMap;
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

  function startBoardUpdates_() {
    stopBoardUpdates_();
    if (!activeRoom_ || !activeRoom_.isTeacher) return;
    if (isFirebaseRoom_() && window.LiveFirebase) {
      LiveFirebase.subscribeBoard(
        activeRoom_.pin,
        currentMode_(activeRoom_),
        {
          title: activeRoom_.title,
          mode: currentMode_(activeRoom_),
          activity: currentMode_(activeRoom_),
          closesAt: activeRoom_.closesAt,
          timeLimitSec: activeRoom_.timeLimitSec,
          launchOptions: activeRoom_.launchOptions,
          rosterCount: activeRoom_.rosterCount
        },
        function (data) { renderBoard_(data); },
        function (e) { console.warn('Firebase ライブボード:', e.message || e); }
      ).catch(function (e) {
        console.warn('Firebase 購読開始:', e.message || e);
        startBoardPoll_();
      });
      return;
    }
    startBoardPoll_();
  }

  function stopBoardUpdates_() {
    stopBoardPoll_();
    if (window.LiveFirebase && typeof LiveFirebase.unsubscribeBoard === 'function') {
      LiveFirebase.unsubscribeBoard();
    }
  }

  function bindUi_() {
    const liveModeBtn = el_('live-mode-open-btn');
    if (liveModeBtn) {
      liveModeBtn.addEventListener('click', function () {
        showLiveModeView_(!isLiveModeView_());
      });
    }
    const liveModeBack = el_('live-mode-back-btn');
    if (liveModeBack) {
      liveModeBack.addEventListener('click', function () {
        showLiveModeView_(false);
      });
    }
    const voteBtn = el_('live-vote-open-btn');
    if (voteBtn) {
      voteBtn.addEventListener('click', function () {
        if (!isAdminUser_()) {
          alert('管理者のみ投票を開催できます');
          return;
        }
        BusyButton.run(voteBtn, function () {
          if (activeRoom_ && activeRoom_.isTeacher && isPollRoom_(activeRoom_) && window.LivePollModule && LivePollModule.openSetup) {
            return LivePollModule.openSetup();
          }
          if (activeRoom_ && activeRoom_.isTeacher && activeRoom_.continueAcrossModes && !isPollRoom_(activeRoom_)) {
            return switchActivity_('poll', {});
          }
          if (activeRoom_ && activeRoom_.isTeacher && isPollRoom_(activeRoom_)) {
            return createPollRoomWithOpts_({});
          }
          return createPollRoomWithOpts_({}).then(function () {
            if (window.LivePollModule && LivePollModule.openSetup) return LivePollModule.openSetup();
          });
        }, '開いています…').catch(function (e) {
          alert(e.message || e);
        });
      });
    }
    document.querySelectorAll('.live-room-open-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const mode = btn.getAttribute('data-live-mode') || 'vocab';
        if (!isAdminUser_()) {
          alert('管理者のみ部屋を開けます');
          return;
        }
        let opts;
        try {
          opts = showCreateDialog_(mode);
        } catch (e) {
          alert(e.message || e);
          return;
        }
        BusyButton.run(btn, function () {
          return createRoomWithOpts_(mode, opts);
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
        }, '参加中…').then(function (room) {
          if (typeof showToast_ === 'function') {
            showToast_(isPollRoom_(room)
              ? '授業ライブに参加しました。「参加する（投票）」で投票画面を開けます'
              : '授業ライブに参加しました。「参加する（取り組む）」で開始できます');
          }
        }).catch(function (e) {
          alert(e.message || e);
        });
      });
    }
    const startAttemptBtn = el_('live-room-start-attempt-btn');
    if (startAttemptBtn) {
      startAttemptBtn.addEventListener('click', function () {
        startAssignedSession_().catch(function (e) {
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
        if (!window.confirm('授業ライブを終了し、結果をスプレッドシートに保存しますか？')) return;
        BusyButton.run(closeBtn, function () {
          return closeRoom();
        }, '保存して終了中…').catch(function (e) {
          alert(e.message || e);
        });
      });
    }
    const switchPollBtn = el_('live-board-switch-poll-btn');
    if (switchPollBtn) {
      switchPollBtn.addEventListener('click', function () {
        if (!activeRoom_ || !activeRoom_.isTeacher) {
          alert('開催中の部屋がありません');
          return;
        }
        if (!activeRoom_.continueAcrossModes) {
          alert('モード継続がオフです。チェックを入れるか、投票専用の部屋を新規に開いてください');
          return;
        }
        BusyButton.run(switchPollBtn, function () {
          return switchActivity_('poll', {});
        }, '切替中…').catch(function (e) {
          alert(e.message || e);
        });
      });
    }
    const exportBtn = el_('live-board-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        BusyButton.run(exportBtn, function () {
          return exportResults();
        }, '保存中…').catch(function (e) {
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
    const fontInput = el_('live-board-font-input');
    const fontMinus = el_('live-board-font-minus');
    const fontPlus = el_('live-board-font-plus');
    applyFontPt_(loadFontPt_(), false);
    if (fontMinus) {
      fontMinus.addEventListener('click', function () {
        applyFontPt_(loadFontPt_() - 1, true);
      });
    }
    if (fontPlus) {
      fontPlus.addEventListener('click', function () {
        applyFontPt_(loadFontPt_() + 1, true);
      });
    }
    if (fontInput) {
      fontInput.addEventListener('change', function () {
        applyFontPt_(fontInput.value, true);
      });
      fontInput.addEventListener('input', function () {
        const n = parseInt(fontInput.value, 10);
        if (!isNaN(n)) applyFontPt_(n, true);
      });
    }
    applyBestNToUi_(loadBestN_());
    const bestSelect = el_('live-board-best-n-select');
    const bestInput = el_('live-board-best-n');
    if (bestSelect) {
      bestSelect.addEventListener('change', function () {
        if (!bestSelect.value) return;
        applyBestNToUi_(bestSelect.value);
        if (lastBoardData_) renderBoard_(lastBoardData_);
      });
    }
    if (bestInput) {
      bestInput.addEventListener('change', function () {
        applyBestNToUi_(bestInput.value);
        if (lastBoardData_) renderBoard_(lastBoardData_);
      });
      bestInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          applyBestNToUi_(bestInput.value);
          if (lastBoardData_) renderBoard_(lastBoardData_);
        }
      });
    }
  }

  function init() {
    hideBoardScreen_();
    bindUi_();
    if (window.LiveFirebase && typeof LiveFirebase.applyBackendUi === 'function') {
      LiveFirebase.applyBackendUi(BACKEND_UI_ROOT, 'live-backend-hint').catch(function () { /* ignore */ });
    }
    restoreFromStorage_();
    refreshUi_();
    if (window.LivePollModule && typeof LivePollModule.init === 'function') {
      LivePollModule.init();
    }
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
    exportResults: exportResults,
    getActiveRoom: getActiveRoom,
    isActive: isActive,
    isTeacherRoom: isTeacherRoom,
    isAdminUser_: isAdminUser_,
    refreshUi_: refreshUi_,
    apiPost: post_,
    touchActiveRoom: function (room) {
      if (!room) return;
      activeRoom_ = room;
      saveStoredRoom_(room);
    },
    createPollRoom: createPollRoomWithOpts_,
    switchActivity: switchActivity_,
    showLiveModeView: showLiveModeView_
  };
})();

window.LiveRoomModule = LiveRoomModule;
