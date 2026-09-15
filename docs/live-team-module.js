/**
 * 授業ライブ — チームN択（vocab-team）
 */
const LiveTeamModule = (function () {
  const FONT_KEY = 'dd_live_board_font_pt';
  const FONT_MIN = 1;
  const FONT_MAX = 50;
  const FONT_DEFAULT = 18;

  let hostOpen_ = false;
  let studentOpen_ = false;
  let lastSnap_ = null;
  let hands_ = null;
  let lockTimerId_ = null;
  let actionBusy_ = false;
  let miniQuestions_ = [];
  let miniIndex_ = 0;
  let miniRunning_ = false;
  let markFinishedSent_ = false;
  let studentPollId_ = 0;
  let raceSig_ = '';

  function el_(id) {
    return document.getElementById(id);
  }

  function escapeHtml_(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
    const screen = el_('live-team-host-screen');
    if (screen) screen.style.setProperty('--live-team-pt', String(pt));
    const input = el_('live-team-font-input');
    if (input && String(input.value) !== String(pt)) input.value = String(pt);
    if (persist !== false) {
      try { localStorage.setItem(FONT_KEY, String(pt)); } catch (e) { /* ignore */ }
    }
    return pt;
  }

  function teamPub_(snap) {
    return (snap && snap.teamPublic) || {};
  }

  function phaseLabel_(phase) {
    const map = {
      lobby: '待機（問題・チーム未設定）',
      ready: '開始待ち',
      racing: 'レース中',
      finished: '終了'
    };
    return map[phase] || phase || '—';
  }

  function formatRaceTime_(finishedAt, startedAt) {
    const fin = parseInt(finishedAt, 10) || 0;
    const start = parseInt(startedAt, 10) || 0;
    if (!fin || !start || fin < start) return '—';
    const sec = (fin - start) / 1000;
    return sec.toFixed(2) + ' 秒';
  }

  function entryByAccount_(entries, account) {
    account = String(account || '').trim().toLowerCase();
    for (let i = 0; i < (entries || []).length; i++) {
      if (String(entries[i].account || '').trim().toLowerCase() === account) return entries[i];
    }
    return null;
  }

  function questionPromptText_(q) {
    if (!q) return '';
    if (typeof window.getQuestionPrompt_ === 'function') {
      const t = window.getQuestionPrompt_(q);
      if (t) return String(t);
    }
    const word = q.word || q.promptEn || q.japanese || '';
    const pos = q.posLabel ? '（' + q.posLabel + '）' : '';
    return String(q.prompt || q.promptText || (word + pos) || '');
  }

  function memberLabels_(team, entries) {
    if (team.memberNames && team.memberNames.length) return team.memberNames.slice();
    return (team.memberAccounts || []).map(function (acc) {
      const e = entryByAccount_(entries, acc);
      const num = e && e.number ? String(e.number) + ' ' : '';
      return num + (e && e.name ? e.name : acc);
    });
  }

  function sortTeamsForRank_(teams, teamPublic) {
    const startedAt = parseInt(teamPublic.startedAt, 10) || 0;
    return (teams || []).slice().sort(function (a, b) {
      const fa = parseInt(a.finishedAt, 10) || 0;
      const fb = parseInt(b.finishedAt, 10) || 0;
      if (fa && fb) {
        if (fa !== fb) return fa - fb;
        return String(a.name || a.id).localeCompare(String(b.name || b.id), 'ja');
      }
      if (fa && !fb) return -1;
      if (!fa && fb) return 1;
      const ia = parseInt(a.currentIndex, 10) || 0;
      const ib = parseInt(b.currentIndex, 10) || 0;
      if (ib !== ia) return ib - ia;
      return String(a.name || a.id).localeCompare(String(b.name || b.id), 'ja');
    }).map(function (team, idx, arr) {
      let rank = idx + 1;
      if (idx > 0) {
        const prev = arr[idx - 1];
        const sameFinish = parseInt(team.finishedAt, 10) > 0
          && parseInt(team.finishedAt, 10) === parseInt(prev.finishedAt, 10);
        if (sameFinish) rank = prev._rank || rank;
      }
      team._rank = rank;
      team._timeLabel = formatRaceTime_(team.finishedAt, startedAt);
      return team;
    });
  }

  async function control_(payload) {
    const room = window.LiveRoomModule && LiveRoomModule.getActiveRoom();
    if (!room || !room.pin) throw new Error('開催中の部屋がありません');
    const res = await LiveRoomModule.apiPost(Object.assign({
      action: 'liveTeamControl',
      pin: room.pin
    }, payload || {}));
    if (!res || res.status !== 'success') {
      throw new Error((res && res.message) || '操作に失敗しました');
    }
    return res.data || {};
  }

  function setActionBusy_(on) {
    actionBusy_ = !!on;
    const screen = el_('live-team-host-screen');
    if (screen) screen.classList.toggle('is-action-busy', actionBusy_);
  }

  function wordOnlyFormats_(launchOptions) {
    const formats = (launchOptions && launchOptions.formats) || ['vocab-enja'];
    const word = formats.filter(function (f) {
      return f === 'vocab-enja' || f === 'vocab-jaen';
    });
    return word.length ? word : ['vocab-enja'];
  }

  async function fetchWordsForTeam_(launchOptions) {
    if (!launchOptions || !launchOptions.bookName || !launchOptions.sheetName) {
      throw new Error('教材設定がありません');
    }
    if (window.PresetModule && typeof PresetModule.getVocabWords === 'function') {
      try {
        const result = await PresetModule.getVocabWords(
          launchOptions.bookName,
          launchOptions.sheetName,
          JSON.stringify(launchOptions.filters || {}),
          true,
          false
        );
        if (result && result.status === 'success' && result.data && (result.data.words || []).length) {
          return result.data;
        }
      } catch (e) {
        console.warn('チーム教材の取得:', e.message || e);
      }
    }
    if (window.UserVocabCacheModule) {
      const result = UserVocabCacheModule.getWordsForStart(launchOptions.sheetName, launchOptions.filters);
      if (result && result.status === 'success') return result.data;
    }
    throw new Error('単語を取得できませんでした');
  }

  async function buildHostQuestions_(launchOptions, questionCount, choiceCount) {
    const data = await fetchWordsForTeam_(launchOptions);
    const words = data.words || [];
    const pool = data.pool || [];
    const bookPool = data.bookPool || pool;
    if (!words.length) throw new Error('条件に合う単語がありません');
    const opts = Object.assign({}, launchOptions, {
      questionCount: String(questionCount),
      choiceCount: choiceCount,
      includeNone: false,
      includeUnknown: false,
      formats: wordOnlyFormats_(launchOptions),
      dummyScope: launchOptions.dummyScope || 'sheet'
    });
    if (!window.VocabQuizGenerator) throw new Error('問題生成器が未初期化です');
    const questions = VocabQuizGenerator.buildQuestions(words, pool, bookPool, opts);
    if (!questions.length) throw new Error('出題できる問題がありません');
    return questions.slice(0, questionCount).map(function (q, idx) {
      const qid = q.id || ('q' + (idx + 1));
      return {
        id: qid,
        prompt: questionPromptText_(q),
        choices: (q.choices || []).map(function (c, ci) {
          return {
            id: qid + '_c' + ci,
            text: c.text || '',
            isCorrect: !!c.isCorrect
          };
        })
      };
    });
  }

  function liveTeamsForDisplay_(snap) {
    const pub = teamPub_(snap);
    if (pub.results && pub.results.length && (pub.phase === 'finished' || pub.phase === 'racing')) {
      const fromSnap = snap.teams || [];
      const snapHasFinish = fromSnap.some(function (t) { return parseInt(t.finishedAt, 10) > 0; });
      if (!snapHasFinish) return pub.results;
    }
    if (snap.teams && snap.teams.length) return snap.teams;
    if (pub.results && pub.results.length) return pub.results;
    return pub.roster || [];
  }

  function formatResultTime_(team, startedAt) {
    if (team.timeMs) return (team.timeMs / 1000).toFixed(2) + ' 秒';
    return formatRaceTime_(team.finishedAt, startedAt);
  }

  function renderResultsBoard_(wrap, teams, pub, entries, opts) {
    opts = opts || {};
    const ranked = sortTeamsForRank_(teams, pub);
    const startedAt = parseInt(pub.startedAt, 10) || 0;
    let html = '<div class="live-team-results">';
    html += '<div class="live-team-results-title">' + (opts.title || '結果') + '</div>';
    ranked.forEach(function (team) {
      const done = parseInt(team.finishedAt, 10) > 0;
      const rank = team.rank || team._rank || '—';
      const time = done ? formatResultTime_(team, startedAt) : '未完走';
      const progress = done ? time : ('問 ' + (parseInt(team.currentIndex, 10) || 0) + ' / ' + (pub.questionCount || '—'));
      html += '<div class="live-team-result-row" style="--team-color:' + escapeHtml_(team.color || '#1976d2') + '">';
      html += '<div class="live-team-result-rank">' + escapeHtml_(String(rank)) + '</div>';
      html += '<div class="live-team-result-body">';
      html += '<div class="live-team-result-name">' + escapeHtml_(team.name || team.id) + '</div>';
      html += '<div class="live-team-result-time">' + escapeHtml_(progress) + '</div>';
      html += '<ul class="live-team-member-list compact">';
      memberLabels_(team, entries).forEach(function (label) {
        html += '<li>' + escapeHtml_(label) + '</li>';
      });
      html += '</ul></div></div>';
    });
    html += '</div>';
    wrap.innerHTML = html;
  }

  function renderHostTeams_(snap) {
    const wrap = el_('live-team-host-teams');
    if (!wrap) return;
    const pub = teamPub_(snap);
    const liveTeams = liveTeamsForDisplay_(snap);
    const entries = snap.entries || [];
    if (!liveTeams.length) {
      wrap.innerHTML = '<p class="filter-axis-hint">チーム未編成です。「チームを組む」を押してください。</p>';
      return;
    }
    if (pub.phase === 'finished' || (liveTeams.length && liveTeams.every(function (t) { return parseInt(t.finishedAt, 10) > 0; }))) {
      const screen = el_('live-team-host-screen');
      if (screen) screen.classList.add('is-results');
      renderResultsBoard_(wrap, liveTeams, pub, entries, { title: '結果' });
      return;
    }
    const screen = el_('live-team-host-screen');
    if (screen) screen.classList.remove('is-results');
    const teams = sortTeamsForRank_(liveTeams, pub);
    let html = '';
    teams.forEach(function (team) {
      const total = (team.qOrder && team.qOrder.length) || pub.questionCount || 0;
      const cur = parseInt(team.currentIndex, 10) || 0;
      const done = parseInt(team.finishedAt, 10) > 0;
      const progress = pub.phase === 'racing' || pub.phase === 'finished'
        ? (done ? ('完走 ' + (team._timeLabel || formatResultTime_(team, pub.startedAt))) : ('問 ' + Math.min(cur + 1, total) + ' / ' + total))
        : (team.memberAccounts ? team.memberAccounts.length + ' 人' : '');
      const rank = done ? ('#' + (team._rank || team.rank || '—') + ' ') : '';
      html += '<div class="live-team-card" style="--team-color:' + escapeHtml_(team.color || '#1976d2') + '">';
      html += '<div class="live-team-card-head">';
      html += '<span class="live-team-card-name">' + escapeHtml_(rank + (team.name || team.id)) + '</span>';
      html += '<span class="live-team-card-meta">' + escapeHtml_(progress) + '</span></div>';
      html += '<ul class="live-team-member-list">';
      memberLabels_(team, entries).forEach(function (label) {
        html += '<li>' + escapeHtml_(label) + '</li>';
      });
      html += '</ul></div>';
    });
    wrap.innerHTML = html;
  }

  function maybeMarkFinished_(snap) {
    if (!hostOpen_ || markFinishedSent_) return;
    const pub = teamPub_(snap);
    if (pub.phase !== 'racing') return;
    const teams = liveTeamsForDisplay_(snap);
    if (!teams.length) return;
    const allDone = teams.every(function (t) { return parseInt(t.finishedAt, 10) > 0; });
    if (!allDone) return;
    markFinishedSent_ = true;
    control_({ command: 'markFinished' }).catch(function () {
      markFinishedSent_ = false;
    });
  }

  function renderHost_(snap) {
    lastSnap_ = snap;
    const pub = teamPub_(snap);
    const pinEl = el_('live-team-host-pin');
    if (pinEl) pinEl.textContent = snap.pin || '----';
    const titleEl = el_('live-team-host-title');
    if (titleEl) titleEl.textContent = snap.title || 'チームN択';
    const phaseEl = el_('live-team-host-phase');
    if (phaseEl) phaseEl.textContent = phaseLabel_(pub.phase);
    const countsEl = el_('live-team-host-counts');
    if (countsEl) {
      countsEl.textContent = '参加 ' + (snap.joinedCount || 0)
        + ' 人 · チーム ' + ((snap.teams && snap.teams.length) || (pub.roster && pub.roster.length) || 0)
        + ' · 1チーム ' + (pub.teamSize || 4) + ' 人 · 全 ' + (pub.questionCount || 0) + ' 問'
        + (pub.waitingCount ? (' · 待機 ' + pub.waitingCount + ' 人') : '');
    }
    const teamSizeInput = el_('live-team-size-input');
    if (teamSizeInput && document.activeElement !== teamSizeInput) {
      teamSizeInput.value = String(pub.teamSize || 4);
    }
    const qCountInput = el_('live-team-qcount-input');
    if (qCountInput && document.activeElement !== qCountInput) {
      qCountInput.value = String(pub.questionCount || 12);
    }
    const cCountInput = el_('live-team-ccount-input');
    if (cCountInput && document.activeElement !== cCountInput) {
      cCountInput.value = String(pub.choiceCount || 12);
    }
    renderHostTeams_(snap);
    maybeMarkFinished_(snap);
  }

  function subscribeHost_() {
    const room = LiveRoomModule.getActiveRoom();
    if (!room || !window.LiveFirebase) return;
    LiveFirebase.subscribeTeam(room.pin, true, {
      title: room.title,
      teamPublic: room.teamPublic,
      launchOptions: room.launchOptions
    }, function (snap) {
      room.teamPublic = snap.teamPublic;
      LiveRoomModule.touchActiveRoom(room);
      renderHost_(snap);
    }, function (err) {
      console.warn('チームホスト購読:', err.message || err);
      const wrap = el_('live-team-host-teams');
      if (wrap && !(lastSnap_ && ((lastSnap_.teams && lastSnap_.teams.length) || (teamPub_(lastSnap_).roster || []).length))) {
        wrap.innerHTML = '<p class="filter-axis-hint">チーム表の取得に失敗しました: '
          + escapeHtml_(err.message || err) + '</p>';
      }
    });
  }

  function unsubscribeHost_() {
    if (window.LiveFirebase && LiveFirebase.unsubscribeTeam) LiveFirebase.unsubscribeTeam();
  }

  function showHostScreen_(on) {
    hostOpen_ = !!on;
    document.body.classList.toggle('live-team-host-active', hostOpen_);
    const screen = el_('live-team-host-screen');
    if (screen) {
      screen.setAttribute('aria-hidden', hostOpen_ ? 'false' : 'true');
      screen.style.display = hostOpen_ ? 'flex' : 'none';
    }
    if (!on) unsubscribeHost_();
  }

  async function openHost() {
    applyFontPt_(loadFontPt_(), false);
    markFinishedSent_ = false;
    showHostScreen_(true);
    subscribeHost_();
  }

  function clearLockTimer_() {
    if (lockTimerId_) {
      clearInterval(lockTimerId_);
      lockTimerId_ = null;
    }
  }

  function updateLockUi_(lockUntil) {
    const lockEl = el_('live-team-student-lock');
    const now = Date.now();
    lockUntil = parseInt(lockUntil, 10) || 0;
    if (!lockEl) return;
    if (lockUntil <= now) {
      lockEl.hidden = true;
      lockEl.textContent = '';
      clearLockTimer_();
      return;
    }
    lockEl.hidden = false;
    function tick_() {
      const rem = Math.max(0, lockUntil - Date.now());
      if (rem <= 0) {
        lockEl.hidden = true;
        clearLockTimer_();
        return;
      }
      lockEl.textContent = 'ペナルティ：あと ' + (rem / 1000).toFixed(1) + ' 秒';
    }
    tick_();
    clearLockTimer_();
    lockTimerId_ = setInterval(tick_, 100);
  }

  async function refreshHands_() {
    const data = await control_({ command: 'myHands' });
    hands_ = data;
    return data;
  }

  function renderStudentResults_(snap, opts) {
    opts = opts || {};
    const promptEl = el_('live-team-student-prompt');
    const choicesEl = el_('live-team-student-choices');
    const statusEl = el_('live-team-student-status');
    hideMini_();
    if (statusEl) statusEl.textContent = opts.title === '途中経過' ? '完走しました。他チームの完走を待っています' : '結果';
    if (promptEl) promptEl.textContent = '';
    if (!choicesEl) return;
    const pub = teamPub_(snap);
    const teams = liveTeamsForDisplay_(snap);
    if (!teams.length) {
      choicesEl.innerHTML = '<p class="filter-axis-hint">結果を集計しています…</p>';
      return;
    }
    renderResultsBoard_(choicesEl, teams, pub, snap.entries || [], { title: opts.title || '結果' });
  }

  function renderStudentTeamInfo_(snap, myEntry) {
    const infoEl = el_('live-team-student-team-info');
    if (!infoEl) return;
    const teamId = myEntry && myEntry.teamId ? String(myEntry.teamId) : '';
    const pub = lastSnap_ ? teamPub_(lastSnap_) : {};
    const teams = (snap.teams && snap.teams.length) ? snap.teams : (pub.roster || []);
    let team = null;
    teams.forEach(function (t) {
      if (String(t.id) === teamId) team = t;
    });
    if (!team) {
      infoEl.innerHTML = '<p class="filter-axis-hint">チーム未所属（待機中）。開始後に再編されるまでミニ学習ができます。</p>';
      return;
    }
    let html = '<div class="live-team-student-badge" style="--team-color:' + escapeHtml_(team.color || '#1976d2') + '">';
    html += escapeHtml_(team.name || team.id) + '</div>';
    html += '<ul class="live-team-member-list compact">';
    memberLabels_(team, snap.entries || []).forEach(function (label) {
      html += '<li>' + escapeHtml_(label) + '</li>';
    });
    html += '</ul>';
    infoEl.innerHTML = html;
  }

  function renderStudentRace_(hands) {
    const promptEl = el_('live-team-student-prompt');
    const choicesEl = el_('live-team-student-choices');
    const statusEl = el_('live-team-student-status');
    if (!promptEl || !choicesEl) return;
    if (!hands || hands.waiting) {
      raceSig_ = '';
      promptEl.textContent = '';
      choicesEl.innerHTML = '';
      if (statusEl) statusEl.textContent = 'ホストがチームを組むまで、下のミニ学習ができます';
      return;
    }
    if (hands.phase !== 'racing') {
      raceSig_ = '';
      promptEl.textContent = '';
      choicesEl.innerHTML = '';
      if (statusEl) statusEl.textContent = '開始待ちです。下のミニ学習ができます';
      return;
    }
    hideMini_();
    if (hands.finished || parseInt(hands.finishedAt, 10) > 0
      || (hands.totalQuestions > 0 && hands.currentIndex >= hands.totalQuestions)) {
      raceSig_ = 'done';
      const snap = lastSnap_ || {};
      const pub = teamPub_(snap);
      if (pub.phase === 'finished' || (pub.results && pub.results.length && pub.results.every(function (t) { return parseInt(t.finishedAt, 10) > 0; }))) {
        renderStudentResults_(snap);
        return;
      }
      promptEl.textContent = '完走しました！他のチームを待っています';
      choicesEl.innerHTML = '';
      statusEl.textContent = hands.finishedAt
        ? ('タイム ' + formatRaceTime_(hands.finishedAt, hands.startedAt)) : '';
      renderStudentResults_(snap, { title: '途中経過' });
      return;
    }
    const sig = [hands.questionId, hands.currentIndex, hands.lockUntil, (hands.hand || []).length].join('|');
    if (sig === raceSig_ && choicesEl.childNodes.length) {
      updateLockUi_(hands.lockUntil);
      const lockedNow = (parseInt(hands.lockUntil, 10) || 0) > Date.now();
      choicesEl.querySelectorAll('.live-team-choice-btn').forEach(function (b) { b.disabled = lockedNow; });
      return;
    }
    raceSig_ = sig;
    promptEl.textContent = hands.prompt || '';
    statusEl.textContent = '問 ' + (hands.currentIndex + 1) + ' / ' + hands.totalQuestions;
    updateLockUi_(hands.lockUntil);
    const locked = (parseInt(hands.lockUntil, 10) || 0) > Date.now();
    let html = '';
    (hands.hand || []).forEach(function (c) {
      html += '<button type="button" class="btn-secondary live-team-choice-btn" data-choice-id="'
        + escapeHtml_(c.id) + '" data-is-correct="' + (c.isCorrect ? '1' : '0') + '"'
        + (locked ? ' disabled' : '') + '>' + escapeHtml_(c.text || '') + '</button>';
    });
    choicesEl.innerHTML = html;
  }

  async function renderStudent_(snap) {
    lastSnap_ = snap;
    const pub = teamPub_(snap);
    const room = LiveRoomModule.getActiveRoom();
    const myAcc = room && room.myAccount ? room.myAccount : '';
    let myEntry = null;
    if (myAcc) myEntry = entryByAccount_(snap.entries, myAcc);
    if (!myEntry && window.AuthGateService && AuthGateService.getUser) {
      const u = AuthGateService.getUser();
      if (u && u.account) myEntry = entryByAccount_(snap.entries, u.account);
    }
    renderStudentTeamInfo_(snap, myEntry);

    if (pub.phase === 'finished') {
      hideMini_();
      renderStudentResults_(snap);
      return;
    }

    const shouldRace = pub.phase === 'racing' && myEntry && myEntry.teamId;
    if (shouldRace) {
      try {
        const hands = await refreshHands_();
        renderStudentRace_(hands);
      } catch (e) {
        const statusEl = el_('live-team-student-status');
        if (statusEl) statusEl.textContent = e.message || String(e);
        showMiniIfNeeded_(snap);
      }
    } else {
      renderStudentRace_({ waiting: true, phase: pub.phase });
      if (pub.phase === 'ready' && myEntry && myEntry.teamId) {
        const statusEl = el_('live-team-student-status');
        if (statusEl) statusEl.textContent = '開始待ちです。下のミニ学習ができます';
      }
      showMiniIfNeeded_(snap);
    }
  }

  function hideMini_() {
    const miniEl = el_('live-team-mini-quiz');
    if (miniEl) miniEl.style.display = 'none';
  }

  function showMiniIfNeeded_(snap) {
    const miniEl = el_('live-team-mini-quiz');
    if (!miniEl) return;
    miniEl.style.display = 'block';
    if (miniRunning_) return;
    miniRunning_ = true;
    renderMiniQuiz_(snap);
  }

  async function ensureMiniQuestions_(launchOptions) {
    if (miniQuestions_.length) return miniQuestions_;
    const data = await fetchWordsForTeam_(launchOptions);
    const opts = Object.assign({}, launchOptions, {
      questionCount: '30',
      choiceCount: 4,
      includeNone: false,
      includeUnknown: false,
      formats: wordOnlyFormats_(launchOptions),
      dummyScope: launchOptions.dummyScope || 'sheet'
    });
    if (!window.VocabQuizGenerator) throw new Error('問題生成器が未初期化です');
    const questions = VocabQuizGenerator.buildQuestions(
      data.words || [], data.pool || [], data.bookPool || data.pool || [], opts);
    miniQuestions_ = (questions || []).slice();
    miniIndex_ = 0;
    return miniQuestions_;
  }

  function paintMiniQuestion_(q) {
    const miniEl = el_('live-team-mini-quiz');
    if (!miniEl || !q) return;
    miniRunning_ = true;
    miniEl.classList.remove('is-correct', 'is-wrong');
    let html = '<div class="subsection-title">待機ミニ学習（4択・個人練習・何度でも）</div>';
    html += '<p class="live-team-mini-prompt">' + escapeHtml_(questionPromptText_(q)) + '</p>';
    html += '<div class="live-team-mini-choices">';
    (q.choices || []).forEach(function (c, idx) {
      html += '<button type="button" class="btn-secondary live-team-mini-choice" data-mini-idx="' + idx + '">'
        + escapeHtml_(c.text || '') + '</button>';
    });
    html += '</div><p class="filter-axis-hint" id="live-team-mini-feedback"></p>';
    miniEl.innerHTML = html;
    miniEl.querySelectorAll('.live-team-mini-choice').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-mini-idx'), 10) || 0;
        const choice = (q.choices || [])[idx];
        const ok = !!(choice && choice.isCorrect);
        miniEl.classList.toggle('is-correct', ok);
        miniEl.classList.toggle('is-wrong', !ok);
        const fb = el_('live-team-mini-feedback');
        if (fb) fb.textContent = ok ? '正解！' : '不正解';
        miniEl.querySelectorAll('.live-team-mini-choice').forEach(function (b) { b.disabled = true; });
        setTimeout(function () {
          miniEl.classList.remove('is-correct', 'is-wrong');
          miniIndex_ += 1;
          miniRunning_ = false;
          if (miniIndex_ >= miniQuestions_.length) {
            miniQuestions_ = [];
            miniIndex_ = 0;
          }
          renderMiniQuiz_(lastSnap_);
        }, 1000);
      });
    });
  }

  function renderMiniQuiz_(snap) {
    const miniEl = el_('live-team-mini-quiz');
    if (!miniEl) return;
    miniEl.style.display = 'block';
    const launchOptions = (snap && snap.launchOptions)
      || (LiveRoomModule.getActiveRoom() || {}).launchOptions;
    if (!launchOptions) {
      miniEl.innerHTML = '<p class="filter-axis-hint">教材設定がありません</p>';
      miniRunning_ = true;
      return;
    }
    if (miniQuestions_.length && miniIndex_ < miniQuestions_.length) {
      paintMiniQuestion_(miniQuestions_[miniIndex_]);
      return;
    }
    ensureMiniQuestions_(launchOptions).then(function () {
      if (!miniQuestions_.length) {
        miniEl.innerHTML = '<p class="filter-axis-hint">ミニ学習用の問題がありません</p>';
        miniRunning_ = true;
        return;
      }
      if (miniIndex_ >= miniQuestions_.length) miniIndex_ = 0;
      paintMiniQuestion_(miniQuestions_[miniIndex_]);
    }).catch(function (e) {
      miniEl.innerHTML = '<p class="filter-axis-hint">' + escapeHtml_(e.message || e) + '</p>';
      miniRunning_ = false;
    });
  }

  function subscribeStudent_() {
    const room = LiveRoomModule.getActiveRoom();
    if (!room) return;
    if (window.AuthGateService && AuthGateService.getUser) {
      const u = AuthGateService.getUser() || {};
      room.myAccount = String(u.account || u.email || '').trim().toLowerCase();
    }
    if (!window.LiveFirebase || typeof LiveFirebase.subscribeTeam !== 'function') return;
    LiveFirebase.subscribeTeam(room.pin, true, {
      title: room.title,
      teamPublic: room.teamPublic,
      launchOptions: room.launchOptions
    }, function (snap) {
      room.teamPublic = snap.teamPublic;
      if (snap.launchOptions) room.launchOptions = snap.launchOptions;
      LiveRoomModule.touchActiveRoom(room);
      renderStudent_(snap);
    }, function (err) {
      console.warn('チーム生徒購読:', err.message || err);
      const statusEl = el_('live-team-student-status');
      if (statusEl && !statusEl.textContent) statusEl.textContent = '接続を再試行しています…';
    });
  }

  function stopStudentPoll_() {
    if (studentPollId_) {
      clearInterval(studentPollId_);
      studentPollId_ = 0;
    }
  }

  function startStudentPoll_() {
    stopStudentPoll_();
    studentPollId_ = setInterval(function () {
      if (!studentOpen_) return;
      tickStudentFromApi_().catch(function () { /* ignore */ });
    }, 1500);
  }

  function applyHandsToSnap_(hands, room) {
    const snap = lastSnap_ || {
      teamPublic: (room && room.teamPublic) || {},
      launchOptions: room && room.launchOptions,
      entries: [],
      teams: []
    };
    snap.teamPublic = Object.assign({}, snap.teamPublic || {}, {
      phase: hands.phase || (snap.teamPublic && snap.teamPublic.phase),
      startedAt: hands.startedAt || (snap.teamPublic && snap.teamPublic.startedAt) || 0,
      results: hands.results || (snap.teamPublic && snap.teamPublic.results) || []
    });
    lastSnap_ = snap;
    return snap;
  }

  async function tickStudentFromApi_() {
    const room = LiveRoomModule.getActiveRoom();
    if (!room) return;
    const hands = await refreshHands_();
    const snap = applyHandsToSnap_(hands, room);
    if (hands.phase === 'finished') {
      renderStudentResults_(snap);
      return;
    }
    if (hands.phase === 'racing' && hands.teamId && !hands.waiting) {
      renderStudentRace_(hands);
      return;
    }
    renderStudentRace_({ waiting: true, phase: hands.phase });
    const statusEl = el_('live-team-student-status');
    if (statusEl) {
      if (hands.phase === 'racing') statusEl.textContent = 'チーム未所属です。下のミニ学習ができます';
      else if (hands.phase === 'ready') statusEl.textContent = '開始待ちです。下のミニ学習ができます';
      else statusEl.textContent = 'チーム編成待ちです。下のミニ学習ができます';
    }
    showMiniIfNeeded_(snap);
  }

  function showStudentScreen_(on) {
    studentOpen_ = !!on;
    document.body.classList.toggle('live-team-student-active', studentOpen_);
    const screen = el_('live-team-student-screen');
    if (screen) {
      screen.setAttribute('aria-hidden', studentOpen_ ? 'false' : 'true');
      screen.style.display = studentOpen_ ? 'flex' : 'none';
    }
    if (!on) {
      stopStudentPoll_();
      if (window.LiveFirebase && LiveFirebase.unsubscribeTeam) LiveFirebase.unsubscribeTeam();
      clearLockTimer_();
      miniQuestions_ = [];
      miniIndex_ = 0;
      miniRunning_ = false;
      hands_ = null;
      raceSig_ = '';
    }
  }

  async function openStudent() {
    showStudentScreen_(true);
    const room = LiveRoomModule.getActiveRoom();
    const statusEl = el_('live-team-student-status');
    if (statusEl) statusEl.textContent = '接続中…ミニ学習を準備しています';
    const infoEl = el_('live-team-student-team-info');
    if (infoEl && !infoEl.innerHTML) {
      infoEl.innerHTML = '<p class="filter-axis-hint">部屋に参加しました。チーム編成と開始を待っています。</p>';
    }
    showMiniIfNeeded_({
      launchOptions: room && room.launchOptions,
      teamPublic: room && room.teamPublic,
      entries: [],
      teams: (room && room.teamPublic && room.teamPublic.roster) || []
    });
    subscribeStudent_();
    startStudentPoll_();
    tickStudentFromApi_().catch(function (e) {
      if (statusEl) statusEl.textContent = e.message || String(e);
    });
  }

  function closeScreens() {
    showHostScreen_(false);
    showStudentScreen_(false);
    lastSnap_ = null;
    markFinishedSent_ = false;
  }

  async function onHostDeal_(reshuffle) {
    const teamSize = parseInt((el_('live-team-size-input') || {}).value, 10) || 4;
    async function deal_() {
      return control_({ command: reshuffle ? 'reshuffleTeams' : 'dealTeams', teamSize: teamSize });
    }
    try {
      return await deal_();
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (msg.indexOf('先に問題') === -1 && msg.indexOf('NEED_QUESTIONS') === -1) throw e;
      await onHostLoadQuestions_();
      return deal_();
    }
  }

  async function onHostLoadQuestions_() {
    const room = LiveRoomModule.getActiveRoom();
    if (!room) throw new Error('部屋がありません');
    const teamSize = parseInt((el_('live-team-size-input') || {}).value, 10) || 4;
    const questionCount = parseInt((el_('live-team-qcount-input') || {}).value, 10) || 12;
    const choiceCount = parseInt((el_('live-team-ccount-input') || {}).value, 10) || 12;
    if (teamSize > choiceCount) throw new Error('1チーム人数は選択肢数以下にしてください');
    const questions = await buildHostQuestions_(room.launchOptions || {}, questionCount, choiceCount);
    await control_({
      command: 'loadQuestions',
      teamSize: teamSize,
      choiceCount: choiceCount,
      questions: questions
    });
  }

  function bindHostEvents_() {
    const closeBtn = el_('live-team-host-close-btn');
    if (closeBtn && !closeBtn._teamBound) {
      closeBtn._teamBound = true;
      closeBtn.addEventListener('click', function () {
        if (!window.confirm('部屋を閉じて結果を保存しますか？')) return;
        BusyButton.run(closeBtn, function () {
          closeScreens();
          return LiveRoomModule.closeRoom();
        }, '保存中…').catch(function (e) { alert(e.message || e); });
      });
    }
    const loadBtn = el_('live-team-load-questions-btn');
    if (loadBtn && !loadBtn._teamBound) {
      loadBtn._teamBound = true;
      loadBtn.addEventListener('click', function () {
        if (actionBusy_) return;
        setActionBusy_(true);
        BusyButton.run(loadBtn, function () {
          return onHostLoadQuestions_();
        }, '問題準備中…').catch(function (e) {
          alert(e.message || e);
        }).finally(function () {
          setActionBusy_(false);
        });
      });
    }
    const dealBtn = el_('live-team-deal-btn');
    if (dealBtn && !dealBtn._teamBound) {
      dealBtn._teamBound = true;
      dealBtn.addEventListener('click', function () {
        if (actionBusy_) return;
        setActionBusy_(true);
        BusyButton.run(dealBtn, function () {
          return onHostDeal_(false);
        }, '組み分け中…').catch(function (e) {
          alert(e.message || e);
        }).finally(function () {
          setActionBusy_(false);
        });
      });
    }
    const reshuffleBtn = el_('live-team-reshuffle-btn');
    if (reshuffleBtn && !reshuffleBtn._teamBound) {
      reshuffleBtn._teamBound = true;
      reshuffleBtn.addEventListener('click', function () {
        if (actionBusy_) return;
        if (!window.confirm('チームを組み直しますか？')) return;
        setActionBusy_(true);
        BusyButton.run(reshuffleBtn, function () {
          return onHostDeal_(true);
        }, '再編中…').catch(function (e) {
          alert(e.message || e);
        }).finally(function () {
          setActionBusy_(false);
        });
      });
    }
    const startBtn = el_('live-team-start-btn');
    if (startBtn && !startBtn._teamBound) {
      startBtn._teamBound = true;
      startBtn.addEventListener('click', function () {
        if (actionBusy_) return;
        setActionBusy_(true);
        markFinishedSent_ = false;
        BusyButton.run(startBtn, function () {
          return control_({ command: 'startRace' });
        }, '開始中…').catch(function (e) {
          alert(e.message || e);
        }).finally(function () {
          setActionBusy_(false);
        });
      });
    }
    const resetBtn = el_('live-team-reset-btn');
    if (resetBtn && !resetBtn._teamBound) {
      resetBtn._teamBound = true;
      resetBtn.addEventListener('click', function () {
        if (actionBusy_) return;
        if (!window.confirm('レースをやり直しますか？')) return;
        setActionBusy_(true);
        markFinishedSent_ = false;
        BusyButton.run(resetBtn, function () {
          return control_({ command: 'resetRace' });
        }, 'リセット中…').catch(function (e) {
          alert(e.message || e);
        }).finally(function () {
          setActionBusy_(false);
        });
      });
    }
    const fontMinus = el_('live-team-font-minus');
    const fontPlus = el_('live-team-font-plus');
    const fontInput = el_('live-team-font-input');
    if (fontMinus && !fontMinus._teamBound) {
      fontMinus._teamBound = true;
      fontMinus.addEventListener('click', function () {
        applyFontPt_(loadFontPt_() - 1);
      });
    }
    if (fontPlus && !fontPlus._teamBound) {
      fontPlus._teamBound = true;
      fontPlus.addEventListener('click', function () {
        applyFontPt_(loadFontPt_() + 1);
      });
    }
    if (fontInput && !fontInput._teamBound) {
      fontInput._teamBound = true;
      fontInput.addEventListener('change', function () {
        applyFontPt_(fontInput.value);
      });
    }
  }

  function bindStudentEvents_() {
    const choicesEl = el_('live-team-student-choices');
    if (choicesEl && !choicesEl._teamBound) {
      choicesEl._teamBound = true;
      choicesEl.addEventListener('click', function (ev) {
        const btn = ev.target.closest('.live-team-choice-btn');
        if (!btn || btn.disabled) return;
        const choiceId = btn.getAttribute('data-choice-id');
        if (!hands_) return;
        btn.disabled = true;
        control_({
          command: 'pick',
          teamId: hands_.teamId,
          choiceId: choiceId,
          expectedIndex: hands_.currentIndex
        }).then(function (res) {
          if (res && lastSnap_) {
            lastSnap_.teamPublic = Object.assign({}, lastSnap_.teamPublic || {}, {
              phase: res.phase || (lastSnap_.teamPublic && lastSnap_.teamPublic.phase),
              results: res.results || (lastSnap_.teamPublic && lastSnap_.teamPublic.results) || []
            });
          }
          if (res && res.phase === 'finished') {
            renderStudentResults_(lastSnap_ || {});
            return;
          }
          if (res && res.lockUntil) updateLockUi_(res.lockUntil);
          return refreshHands_().then(renderStudentRace_);
        }).catch(function (e) {
          alert(e.message || e);
        }).finally(function () {
          btn.disabled = false;
        });
      });
    }
    const backBtn = el_('live-team-student-back-btn');
    if (backBtn && !backBtn._teamBound) {
      backBtn._teamBound = true;
      backBtn.addEventListener('click', function () {
        closeScreens();
      });
    }
  }

  function init() {
    bindHostEvents_();
    bindStudentEvents_();
    applyFontPt_(loadFontPt_(), false);
  }

  return {
    init: init,
    openHost: openHost,
    openStudent: openStudent,
    closeScreens: closeScreens,
    isHostOpen: function () { return hostOpen_; },
    isStudentOpen: function () { return studentOpen_; }
  };
})();

window.LiveTeamModule = LiveTeamModule;
