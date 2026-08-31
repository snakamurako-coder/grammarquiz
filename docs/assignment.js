/**
 * 宿題・小テスト（生徒側）
 * 課題マスタ／提出は GAS＋本体 SS。進捗キャッシュはローカル。
 */
const AssignmentModule = (function () {
  const PROGRESS_PREFIX = 'dd_hw_progress:';
  const PASS_PREFIX = 'dd_quiz_pass:';
  let listCache_ = [];
  let listRefreshWarn_ = null;
  let activeSession_ = null;
  let timerId_ = null;

  function apiUrl_() {
    return (window.DIGITALDRILL_CONFIG && window.DIGITALDRILL_CONFIG.API_URL) || window.API_URL || '';
  }

  async function post_(payload) {
    const url = apiUrl_();
    if (!url) throw new Error('API_URL が未設定です');
    if (!AuthGateService.isValid()) throw new Error('ログインが必要です');
    const body = Object.assign({ authToken: AuthGateService.getToken() }, payload);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      credentials: 'omit'
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch (e) {
      throw new Error('サーバー応答の解析に失敗しました');
    }
    if (data.status === 'error') throw new Error(data.message || 'API error');
    return data;
  }

  async function postWithRetry_(payload, retries) {
    retries = retries == null ? 2 : retries;
    let lastErr = null;
    for (let i = 0; i <= retries; i++) {
      try {
        return await post_(payload);
      } catch (e) {
        lastErr = e;
        if (i < retries) {
          await new Promise(function (resolve) { setTimeout(resolve, 800 * (i + 1)); });
        }
      }
    }
    throw lastErr || new Error('通信に失敗しました');
  }

  function progressKey_(assignmentId) {
    const user = AuthGateService.getUser() || {};
    const account = String(user.account || '').toLowerCase() || 'anon';
    return PROGRESS_PREFIX + assignmentId + ':' + account;
  }

  function passKey_(assignmentId) {
    const user = AuthGateService.getUser() || {};
    const account = String(user.account || '').toLowerCase() || 'anon';
    return PASS_PREFIX + assignmentId + ':' + account;
  }

  function defaultPassState_() {
    return { clearCount: 0, clears: [], serverAchieved: false, pendingAchievement: null };
  }

  function loadPassState_(assignmentId) {
    try {
      const raw = localStorage.getItem(passKey_(assignmentId));
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') return defaultPassState_();
      if (!parsed.clears) parsed.clears = [];
      if (parsed.pendingAchievement === undefined) parsed.pendingAchievement = null;
      return parsed;
    } catch (e) {
      return defaultPassState_();
    }
  }

  function savePassState_(assignmentId, state) {
    try {
      localStorage.setItem(passKey_(assignmentId), JSON.stringify(state || defaultPassState_()));
    } catch (e) {}
  }

  function evaluatePassLocal_(a, correct, total, points, pointsMax, durationSec) {
    const score = total > 0
      ? Math.round((correct / total) * 100)
      : (pointsMax > 0 ? Math.round((points / pointsMax) * 100) : 0);
    let pass = false;
    if (a.Pass_Mode === 'points') {
      pass = points >= a.Pass_Score;
    } else {
      pass = score >= a.Pass_Score;
    }
    if (a.Time_Limit_Sec > 0 && durationSec > a.Time_Limit_Sec + 2) pass = false;
    return { pass: pass, score: score };
  }

  function loadLocalProgress_(assignmentId) {
    try {
      const raw = localStorage.getItem(progressKey_(assignmentId));
      return raw ? JSON.parse(raw) : { doneIds: [], wrongIds: [] };
    } catch (e) {
      return { doneIds: [], wrongIds: [] };
    }
  }

  function saveLocalProgress_(assignmentId, progress) {
    try {
      localStorage.setItem(progressKey_(assignmentId), JSON.stringify(progress || { doneIds: [], wrongIds: [] }));
    } catch (e) {}
  }

  function markDone_(assignmentId, itemId, isCorrect) {
    if (!itemId) return;
    const p = loadLocalProgress_(assignmentId);
    if (p.doneIds.indexOf(itemId) < 0) p.doneIds.push(itemId);
    if (!isCorrect) {
      if (p.wrongIds.indexOf(itemId) < 0) p.wrongIds.push(itemId);
    } else {
      p.wrongIds = (p.wrongIds || []).filter(function (id) { return id !== itemId; });
    }
    saveLocalProgress_(assignmentId, p);
    return p;
  }

  function formatLimit_(sec) {
    sec = Math.max(0, parseInt(sec, 10) || 0);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function parseLooseDate_(value) {
    if (value === null || value === undefined || value === '') return null;
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value.getTime();
    }
    if (typeof value === 'number' && isFinite(value)) return value;
    const s = String(value).trim();
    if (!s) return null;
    const m = s.match(/(\d{4})[-\/年.](\d{1,2})[-\/月.](\d{1,2})日?(?:[T\s　]+(\d{1,2})[:時](\d{1,2})(?::(\d{1,2}))?)?/);
    if (m) {
      return new Date(
        parseInt(m[1], 10),
        parseInt(m[2], 10) - 1,
        parseInt(m[3], 10),
        parseInt(m[4] || '0', 10),
        parseInt(m[5] || '0', 10),
        parseInt(m[6] || '0', 10)
      ).getTime();
    }
    const t = Date.parse(s);
    return isNaN(t) ? null : t;
  }

  function coerceSections_(a) {
    function tryParse(raw) {
      if (!raw) return [];
      if (Array.isArray(raw)) return raw.slice(0, 4);
      if (typeof raw === 'string') {
        try {
          const p = JSON.parse(raw);
          if (Array.isArray(p)) return p.slice(0, 4);
          if (p && Array.isArray(p.sections)) return p.sections.slice(0, 4);
        } catch (e) {}
      }
      return [];
    }
    if (!a) return [];
    let list = tryParse(a.Sections);
    if (!list.length) list = tryParse(a.Sections_JSON);
    if (!list.length) list = tryParse(a.sections);
    return list.filter(Boolean);
  }

  function showAssignmentError_(e) {
    const msg = (e && e.message) ? e.message : String(e || '不明なエラー');
    console.error('課題開始:', e);
    if (typeof showToast_ === 'function') showToast_('課題を開始できません: ' + msg);
    alert('課題を開始できません:\n' + msg);
  }

  function formatAssignmentWhen_(value) {
    const ms = parseLooseDate_(value);
    if (ms == null) return '';
    try {
      return new Date(ms).toLocaleString('ja-JP', {
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return String(value);
    }
  }

  function formatAssignmentPeriod_(a) {
    if (!a) return '';
    const parts = [];
    if (a.Window_Start) parts.push('開始 ' + formatAssignmentWhen_(a.Window_Start));
    if (a.Window_End) parts.push('終了 ' + formatAssignmentWhen_(a.Window_End));
    else if (a.Deadline) parts.push('期限 ' + formatAssignmentWhen_(a.Deadline));
    return parts.join(' / ');
  }

  function getAssignmentWindowPhase_(row, nowMs) {
    const a = (row && row.assignment) || row || {};
    const now = nowMs == null ? Date.now() : nowMs;
    const start = parseLooseDate_(a.Window_Start);
    const end = parseLooseDate_(a.Window_End);
    const deadline = parseLooseDate_(a.Deadline);
    if (start != null && now < start) return 'future';
    if (end != null && now > end) return 'expired';
    if (deadline != null && now > deadline) return 'expired';
    return 'open';
  }

  function sortAssignmentRows_(rows) {
    const order = { open: 0, future: 1, expired: 2 };
    return (rows || []).slice().sort(function (x, y) {
      const px = getAssignmentWindowPhase_(x);
      const py = getAssignmentWindowPhase_(y);
      if (order[px] !== order[py]) return order[px] - order[py];
      return String((x.assignment && x.assignment.Title) || '').localeCompare(
        String((y.assignment && y.assignment.Title) || ''), 'ja'
      );
    });
  }

  function setAssignmentSessionBanner_(a, opts) {
    opts = opts || {};
    const banner = document.getElementById('assignment-session-banner');
    if (!banner) return;
    banner.hidden = false;
    banner.innerHTML = '';
    const title = document.createElement('div');
    title.textContent = (a.Kind === 'quiz' ? '【小テスト】' : '【宿題】') + a.Title
      + (opts.reviewWrong ? '（ニガテ復習）' : '')
      + (opts.preview ? '（予行演習）' : '');
    banner.appendChild(title);
    if (opts.preview) {
      const warn = document.createElement('div');
      warn.className = 'asg-preview-warn';
      warn.textContent = '取り組み期間外のため、この取り組みは成績・進捗にカウントされません。';
      banner.appendChild(warn);
    }
  }

  function clearTimer_() {
    if (timerId_) {
      clearInterval(timerId_);
      timerId_ = null;
    }
    const el = document.getElementById('assignment-timer');
    if (el) {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function startTimer_(deadlineMs) {
    clearTimer_();
    const el = document.getElementById('assignment-timer');
    if (!el || !deadlineMs) return;
    el.hidden = false;
    function tick() {
      const left = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
      el.textContent = '残り ' + formatLimit_(left);
      el.className = 'assignment-timer' + (left <= 30 ? ' urgent' : '');
      if (left <= 0) {
        clearTimer_();
        forceSubmitActiveSession_().catch(function (e) {
          console.warn('時間切れ強制提出:', e.message || e);
        });
      }
    }
    tick();
    timerId_ = setInterval(tick, 250);
  }

  function deriveStatus_(row, passState, local, phase) {
    const a = row.assignment || {};
    phase = phase || getAssignmentWindowPhase_(row);
    const serverReported = !!(row.serverAchieved || passState.serverAchieved);

    if (a.Kind === 'quiz' && serverReported) {
      return { label: '終了済み', css: 'asg-status-ended' };
    }
    if (a.Kind === 'homework') {
      const latest = row.latestSubmission;
      if (latest && String(latest.Status || '') === 'passed') {
        return { label: '終了済み', css: 'asg-status-ended' };
      }
    }
    if (phase === 'future') {
      return { label: '予定', css: 'asg-status-scheduled' };
    }
    if (phase === 'expired') {
      return { label: '期限超過', css: 'asg-status-expired' };
    }
    const clearN = passState.clearCount || 0;
    const doneN = (local.doneIds || []).length;
    const latest = row.latestSubmission;
    const hasProgress = clearN > 0
      || doneN > 0
      || !!(latest && String(latest.Status || '') !== '');
    if (!hasProgress) {
      return { label: '未着手', css: 'asg-status-not-started' };
    }
    return { label: '取組中', css: 'asg-status-in-progress' };
  }

  function canReportAchievement_(row, passState) {
    const a = row.assignment || {};
    if (a.Kind !== 'quiz') return false;
    if (row.serverAchieved || passState.serverAchieved) return false;
    const required = a.Required_Pass_Count || a.Max_Attempts || 1;
    const clearN = passState.clearCount || 0;
    return clearN >= required || !!passState.pendingAchievement;
  }

  async function refreshList() {
    const wrap = document.getElementById('assignment-list');
    if (!wrap) return;
    if (!AuthGateService.isValid()) {
      wrap.innerHTML = '<p>ログインすると課題が表示されます。</p>';
      return;
    }
    wrap.innerHTML = '<p>読込中...</p>';
    try {
      const res = await postWithRetry_({ action: 'listMyAssignments' }, 2);
      listCache_ = sortAssignmentRows_(res.data || []);
      listRefreshWarn_ = null;
      renderList_(listCache_);
    } catch (e) {
      if (listCache_.length) {
        listRefreshWarn_ = String(e.message || e);
        renderList_(listCache_);
      } else {
        wrap.innerHTML = '<p style="color:#c62828;">課題の取得に失敗: ' + escapeHtml_(e.message || e) + '</p>'
          + '<p class="hint" style="font-size:.85em;color:#666;margin-top:8px;">通信状況を確認して「更新」を押してください。</p>';
      }
    }
  }

  function escapeHtml_(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderList_(rows) {
    const wrap = document.getElementById('assignment-list');
    if (!wrap) return;
    let html = '';
    if (listRefreshWarn_) {
      html += '<p class="asg-refresh-warn">一覧の更新に失敗しました（前回の表示）: '
        + escapeHtml_(listRefreshWarn_) + '</p>';
    }
    if (!rows.length) {
      html += '<p>現在は何も課題が課されていません・予定されていません。</p>';
      wrap.innerHTML = html;
      return;
    }
    rows.forEach(function (row, idx) {
      const a = row.assignment || {};
      const kindLabel = a.Kind === 'quiz' ? '小テスト' : '宿題';
      const limit = a.Time_Limit_Sec > 0 ? ('制限 ' + formatLimit_(a.Time_Limit_Sec)) : '制限なし';
      const required = a.Required_Pass_Count || a.Max_Attempts || 1;
      const passState = loadPassState_(a.Assignment_ID);
      if (row.serverAchieved) {
        passState.serverAchieved = true;
        if (passState.pendingAchievement) {
          passState.pendingAchievement = null;
        }
        savePassState_(a.Assignment_ID, passState);
      }
      const local = loadLocalProgress_(a.Assignment_ID);
      const phase = getAssignmentWindowPhase_(row);
      const status = deriveStatus_(row, passState, local, phase);
      const clearN = passState.clearCount || 0;
      const serverReported = !!(row.serverAchieved || passState.serverAchieved);
      const doneN = (local.doneIds || []).length;
      const showReport = canReportAchievement_(row, passState);
      const periodText = formatAssignmentPeriod_(a);

      html += '<div class="log-item asg-list-item">';
      html += '<div class="log-item-main">';
      html += '<div class="log-title">' + escapeHtml_(a.Title) + ' <span style="font-size:.8em;color:#666;">[' + kindLabel + ']</span></div>';
      if (periodText) {
        html += '<div class="asg-period-meta">' + escapeHtml_(periodText) + '</div>';
      }
      html += '<div class="log-meta">' + escapeHtml_(limit);
      if (a.Kind === 'quiz') {
        html += ' / クリア ' + clearN + '／' + required + ' 回（ノルマ）';
        if (serverReported) html += ' / サーバー報告済';
        else if (clearN >= required) html += ' / <span style="color:#c62828;">未報告の可能性</span>';
      } else {
        html += ' / ローカル消化 ' + doneN + '問';
      }
      html += '</div>';
      html += '<div class="log-settings">合格ライン: ' + escapeHtml_(a.Pass_Score) + (a.Pass_Mode === 'points' ? '点' : '%');
      if (a.Kind === 'quiz') html += ' / 挑戦回数無制限';
      if (a.Weakness_Review) html += ' / ニガテ復習あり';
      html += '</div>';
      html += '<div class="asg-list-actions">';
      if (phase === 'open') {
        html += '<button type="button" class="btn-small assignment-start-btn" data-idx="' + idx + '">取り組む</button>';
      } else if (phase === 'future') {
        html += '<button type="button" class="btn-small assignment-preview-btn" data-idx="' + idx + '">予行演習</button>';
      }
      if (showReport) {
        html += '<button type="button" class="btn-small assignment-report-btn" data-idx="' + idx + '">再度報告</button>';
      }
      html += '</div>';
      if (showReport && !serverReported) {
        html += '<p class="asg-report-hint">ノルマ達成済みですがサーバー未確認の場合は「再度報告」を押してください。</p>';
      }
      html += '</div>';
      html += '<div class="log-item-aside"><span class="asg-status ' + status.css + '">' + escapeHtml_(status.label) + '</span></div>';
      html += '</div>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.assignment-start-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const row = listCache_[idx];
        if (!row) return;
        BusyButton.run(btn, function () {
          return startAssignment_(row, false, {}).catch(function (e) {
            showAssignmentError_(e);
          });
        }, '準備中…');
      });
    });
    wrap.querySelectorAll('.assignment-preview-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const row = listCache_[idx];
        if (!row) return;
        BusyButton.run(btn, function () {
          return startAssignment_(row, false, { preview: true }).catch(function (e) {
            showAssignmentError_(e);
          });
        }, '準備中…');
      });
    });
    wrap.querySelectorAll('.assignment-report-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const row = listCache_[idx];
        if (!row) return;
        BusyButton.run(btn, function () { return reportAchievement_(row); }, '報告中…');
      });
    });
  }

  async function reportAchievement_(row) {
    const a = row.assignment;
    if (!a || a.Kind !== 'quiz') throw new Error('小テスト以外は報告できません');
    const passState = loadPassState_(a.Assignment_ID);
    const required = a.Required_Pass_Count || a.Max_Attempts || 1;
    const clearCount = passState.clearCount || 0;
    if (clearCount < required && !passState.pendingAchievement) {
      throw new Error('ノルマ（' + required + '回クリア）に達していません（現在 ' + clearCount + ' 回）');
    }
    const pending = passState.pendingAchievement || {};
    const res = await postWithRetry_({
      action: 'reportQuizAchievement',
      assignmentId: a.Assignment_ID,
      clearCount: clearCount,
      correct: pending.correct,
      total: pending.total,
      points: pending.points,
      pointsMax: pending.pointsMax,
      durationSec: pending.durationSec || 0,
      resubmit: true,
      detail: pending.detail || { recordType: 'achievement', resubmit: true }
    }, 1);
    const d = res.data || {};
    passState.serverAchieved = !!(d.serverAchieved || d.serverRecorded || d.alreadyAchieved);
    passState.pendingAchievement = null;
    savePassState_(a.Assignment_ID, passState);
    if (d.alreadyAchieved) {
      showToast_('サーバーには既に達成記録があります');
    } else if (d.serverRecorded) {
      showToast_('達成をサーバーに報告しました');
    } else {
      showToast_('報告を受け付けました');
    }
    await refreshList();
    return res;
  }

  async function buildQuestionsFromSections_(sections, opts) {
    opts = opts || {};
    const all = [];
    const usedVocabKeys = new Set();
    const rangeIds = [];
    let pointsMax = 0;

    for (let si = 0; si < sections.length && si < 4; si++) {
      const sec = sections[si] || {};
      const mode = String(sec.mode || '').toLowerCase();
      const ppq = Math.max(0, parseInt(sec.pointsPerQuestion, 10) || 1);
      let qs = [];

      if (mode === 'reading' || mode === 'ai' || mode === 'conversation') {
        throw new Error('セクション' + (si + 1) + ': 「' + mode + '」は未実装です');
      }

      if (mode === 'grammar') {
        const subject = sec.subject || '';
        const units = sec.units || [];
        if (!subject || !units.length) throw new Error('セクション' + (si + 1) + ': 文法の subject / units が必要です');
        let rows = [];
        for (let ui = 0; ui < units.length; ui++) {
          const unitRows = await fetchGrammarRows(subject, units[ui], false);
          rows = rows.concat(unitRows || []);
        }
        if (sec.filters) {
          const f = sec.filters;
          rows = rows.filter(function (r) {
            if (f.dai && f.dai.length && f.dai.indexOf(r.dai || r['大単元']) < 0) return false;
            if (f.sho && f.sho.length && f.sho.indexOf(r.sho || r['小単元']) < 0) return false;
            if (f.area && f.area.length && f.area.indexOf(r.grammarArea || r['ターゲット文法領域']) < 0) return false;
            return true;
          });
        }
        const formats = (sec.formats && sec.formats.length) ? sec.formats : ['A'];
        const built = GrammarQuizGenerator.buildQuestions(rows, {
          formats: formats,
          questionCount: sec.questionCount || 'all',
          choiceCount: sec.choiceCount || 4,
          includeNone: sec.includeNone !== false,
          includeUnknown: sec.includeUnknown !== false
        });
        const ordered = AlgorithmModule.buildQuestionSet(built, 'normal', sec.questionCount || 'all');
        qs = ordered;
      } else if (mode === 'vocab') {
        const bookType = sec.bookType || 'preset';
        const bookName = sec.bookName || '';
        const sheetName = sec.sheetName || '';
        if (!sheetName) throw new Error('セクション' + (si + 1) + ': 単語の sheetName が必要です');
        let wordsPayload;
        if (bookType === 'user') {
          const res = await UserBridge.call('getVocabWords', {
            sheetName: sheetName,
            filters: sec.filters || {},
            includeBookPool: true
          });
          if (res.status !== 'success') throw new Error(res.message || '単語取得失敗');
          wordsPayload = res.data;
        } else {
          const filtersJson = JSON.stringify(sec.filters || {});
          const vocabRes = await PresetModule.getVocabWords(bookName, sheetName, filtersJson, true, false);
          if (!vocabRes || vocabRes.status !== 'success') {
            throw new Error('セクション' + (si + 1) + ': ' + ((vocabRes && vocabRes.message) || '単語の取得に失敗しました'));
          }
          wordsPayload = vocabRes.data;
        }
        const words = (wordsPayload && wordsPayload.words) || wordsPayload || [];
        const pool = (wordsPayload && wordsPayload.pool) || words;
        const bookPool = (wordsPayload && wordsPayload.bookPool) || pool;
        if (!sec.formats || !sec.formats.length) {
          throw new Error('セクション' + (si + 1) + ': 出題形式（formats）が必要です。課題を再作成してください。');
        }
        const formats = sec.formats.slice(0, 4);
        const per = parseInt(sec.questionCount, 10) || 5;
        const axes = sec.axes || {};
        const isPool = (axes.choiceStyle || sec.choiceStyle) === 'pool';
        qs = VocabQuizGenerator.buildQuestions(words, pool, bookPool, {
          formats: formats,
          homeworkMode: true,
          homeworkPerSection: per,
          includeNone: !isPool && sec.includeNone !== false,
          includeUnknown: !isPool && sec.includeUnknown !== false,
          choiceCount: sec.choiceCount || 4,
          poolDummyCount: sec.poolDummyCount != null ? sec.poolDummyCount : 2,
          dummyScope: sec.dummyScope || 'sheet',
          dummyMethod: sec.dummyMethod || 'none',
          affixType: sec.affixType || 'prefix',
          affixLen: sec.affixLen != null ? sec.affixLen : 2,
          usedKeys: usedVocabKeys
        });
        qs.forEach(function (q) {
          const key = q.wordId || q.itemId || (q.wordObj && (q.wordObj.wordId || q.wordObj['英単語・熟語の表現']));
          if (key) usedVocabKeys.add(String(key));
        });
      } else {
        throw new Error('セクション' + (si + 1) + ': 未対応の mode=' + mode);
      }

      if (opts.onlyWrongIds && opts.onlyWrongIds.length) {
        const set = {};
        opts.onlyWrongIds.forEach(function (id) { set[id] = true; });
        qs = qs.filter(function (q) {
          const id = q.questionId || q.itemId || q.wordId || q.rowId;
          return id && set[id];
        });
      }

      qs.forEach(function (q) {
        q._assignmentSection = si;
        q._pointsPerQuestion = ppq;
        const id = q.questionId || q.itemId || q.wordId || q.rowId || ('s' + si + '_' + all.length);
        q._assignmentItemId = id;
        rangeIds.push(id);
        pointsMax += ppq;
        all.push(q);
      });
    }

    if (opts.skipDoneIds && opts.skipDoneIds.length) {
      const done = {};
      opts.skipDoneIds.forEach(function (id) { done[id] = true; });
      const filtered = all.filter(function (q) { return !done[q._assignmentItemId]; });
      return { questions: filtered, rangeIds: rangeIds, pointsMax: pointsMax, allRangeIds: rangeIds };
    }

    return { questions: all, rangeIds: rangeIds, pointsMax: pointsMax, allRangeIds: rangeIds };
  }

  async function startAssignment_(row, reviewWrong, opts) {
    opts = opts || {};
    const a = row.assignment;
    if (!a) throw new Error('課題データがありません');
    const phase = getAssignmentWindowPhase_(row);
    const isPreview = opts.preview === true || phase === 'future';
    if (phase === 'expired') {
      throw new Error('この課題は終了しています（提出期間外）');
    }
    if (phase !== 'open' && !isPreview) {
      throw new Error('この課題はまだ取り組める期間ではありません');
    }
    const sections = coerceSections_(a);
    if (!sections.length) throw new Error('セクションが空です。管理ダッシュボードで課題を開き直して保存し直してください。');

    const local = loadLocalProgress_(a.Assignment_ID);
    let data = {};
    if (!isPreview) {
      const startRes = await post_({
        action: 'startAssignmentAttempt',
        assignmentId: a.Assignment_ID,
        progress: local
      });
      data = startRes.data || {};
    } else {
      data = {
        submissionId: 'preview_' + a.Assignment_ID + '_' + Date.now(),
        attemptNo: 0,
        localSession: true
      };
    }
    const buildOpts = {};
    if (!isPreview && reviewWrong && local.wrongIds && local.wrongIds.length) {
      buildOpts.onlyWrongIds = local.wrongIds.slice();
    } else if (!isPreview && a.Kind === 'homework') {
      buildOpts.skipDoneIds = local.doneIds || [];
    }

    const built = await buildQuestionsFromSections_(sections, buildOpts);
    if (!built.questions.length) {
      if (!isPreview && a.Kind === 'homework' && (local.doneIds || []).length) {
        const submit = await post_({
          action: 'submitAssignmentAttempt',
          submissionId: data.submissionId,
          correct: local.doneIds.length,
          total: built.allRangeIds.length || local.doneIds.length,
          points: 0,
          pointsMax: 0,
          durationSec: 0,
          rangeComplete: true,
          progress: local,
          detail: { note: 'already_complete' }
        });
        showToast_('宿題の範囲は完了済みです（' + (submit.data && submit.data.resultStatus) + '）');
        await refreshList();
        return;
      }
      throw new Error('出題できる問題がありません（範囲・形式を確認してください）');
    }

    activeSession_ = {
      assignment: a,
      submissionId: data.submissionId,
      attemptNo: data.attemptNo,
      startedAtMs: Date.now(),
      deadlineMs: (a.Time_Limit_Sec > 0) ? (Date.now() + a.Time_Limit_Sec * 1000) : 0,
      rangeIds: built.allRangeIds || built.rangeIds,
      pointsMax: built.pointsMax,
      pointsEarned: 0,
      reviewWrong: !!reviewWrong,
      answerLog: [],
      preview: isPreview
    };

    currentAppMode = a.Kind === 'quiz' ? 'assignment-quiz' : 'assignment-homework';
    currentSessionIsPreset = false;
    currentSessionSettings = {
      kind: 'assignment',
      assignmentId: a.Assignment_ID,
      assignmentKind: a.Kind,
      title: a.Title,
      reviewWrong: !!reviewWrong,
      preview: isPreview
    };
    currentQuestionDataList = built.questions;
    totalQuestionsCount = built.questions.length;
    currentQuestionIndex = 0;
    currentScore = 0;
    sessionAnswerLog = [];
    sessionPersistedToServer = false;
    sessionStartTime = Date.now();

    try {
      screens.login.style.display = 'none';
      screens.settings.style.display = 'none';
      const resultScreen = document.getElementById('result-screen');
      if (resultScreen) resultScreen.style.display = 'none';
      const readingScreen = document.getElementById('reading-screen');
      if (readingScreen) readingScreen.style.display = 'none';
      screens.game.style.display = 'block';

      setAssignmentSessionBanner_(a, { reviewWrong: !!reviewWrong, preview: isPreview });

      if (activeSession_.deadlineMs) startTimer_(activeSession_.deadlineMs);
      else clearTimer_();

      GameSessionPlay.start(currentQuestionDataList);
      if (window.clearSessionDraft_) window.clearSessionDraft_();
      if (window.persistSessionDraft_) window.persistSessionDraft_();
    } catch (e) {
      screens.settings.style.display = 'block';
      screens.game.style.display = 'none';
      abandonActiveSession_();
      throw e;
    }
  }

  function abandonActiveSession_() {
    clearTimer_();
    activeSession_ = null;
    const banner = document.getElementById('assignment-session-banner');
    if (banner) banner.hidden = true;
  }

  async function restoreFromDraft(draft) {
    if (!draft || !draft.questions || !draft.questions.length) return false;

    let assignment = draft.assignment || null;
    if (!assignment && draft.assignmentId) {
      const row = listCache_.find(function (r) {
        return r.assignment && r.assignment.Assignment_ID === draft.assignmentId;
      });
      assignment = row ? row.assignment : {
        Assignment_ID: draft.assignmentId,
        Title: draft.assignmentTitle || '',
        Kind: draft.assignmentKind || 'homework',
        Time_Limit_Sec: 0,
        Pass_Score: 0,
        Pass_Mode: 'percent',
        Required_Pass_Count: 1,
        Max_Attempts: 1,
        Weakness_Review: false
      };
    }
    if (!assignment) {
      alert('課題情報を復元できませんでした。宿題・小テスト一覧を開いてから再度お試しください。');
      return false;
    }

    activeSession_ = {
      assignment: assignment,
      submissionId: draft.submissionId,
      attemptNo: draft.attemptNo,
      startedAtMs: draft.startedAtMs || Date.now(),
      deadlineMs: draft.deadlineMs || 0,
      rangeIds: draft.rangeIds || [],
      pointsMax: draft.pointsMax || 0,
      pointsEarned: draft.pointsEarned || 0,
      reviewWrong: !!draft.reviewWrong,
      answerLog: (draft.answerLog || []).slice(),
      preview: !!draft.preview
    };

    currentAppMode = draft.appMode || (assignment.Kind === 'quiz' ? 'assignment-quiz' : 'assignment-homework');
    currentSessionIsPreset = false;
    currentSessionSettings = draft.currentSessionSettings || {
      kind: 'assignment',
      assignmentId: assignment.Assignment_ID,
      assignmentKind: assignment.Kind,
      title: assignment.Title,
      reviewWrong: !!draft.reviewWrong
    };
    currentQuestionDataList = draft.questions;
    totalQuestionsCount = draft.totalQuestionsCount || draft.questions.length;
    const resumeAt = draft.resumeIndex != null
      ? draft.resumeIndex
      : (draft.sessionAnswerLog || []).length;
    currentQuestionIndex = Math.min(resumeAt, draft.questions.length);
    currentScore = draft.currentScore || 0;
    sessionAnswerLog = (draft.sessionAnswerLog || []).slice();
    vocabResultMarks_ = draft.vocabResultMarks || {};
    sessionPersistedToServer = false;
    sessionStartTime = draft.sessionStartTime || Date.now();
    currentReviewSetId = null;

    screens.login.style.display = 'none';
    screens.settings.style.display = 'none';
    const resultScreen = document.getElementById('result-screen');
    if (resultScreen) resultScreen.style.display = 'none';
    const readingScreen = document.getElementById('reading-screen');
    if (readingScreen) readingScreen.style.display = 'none';
    screens.game.style.display = 'block';

    const banner = document.getElementById('assignment-session-banner');
    if (banner) {
      setAssignmentSessionBanner_(assignment, {
        reviewWrong: !!draft.reviewWrong,
        preview: !!draft.preview
      });
    }

    if (activeSession_.deadlineMs) startTimer_(activeSession_.deadlineMs);
    else clearTimer_();

    if (currentQuestionIndex >= currentQuestionDataList.length) {
      if (typeof showResultScreen === 'function') showResultScreen();
      return true;
    }

    GameSessionPlay.start(currentQuestionDataList);
    if (typeof loadQuestionToGame === 'function') {
      loadQuestionToGame(currentQuestionDataList[currentQuestionIndex]);
    }
    if (window.persistSessionDraft_) window.persistSessionDraft_();
    return true;
  }

  function isActive() {
    return !!activeSession_;
  }

  function getActive() {
    return activeSession_;
  }

  function onAnswered(itemId, isCorrect, pointsPerQuestion) {
    if (!activeSession_) return;
    const id = itemId || '';
    if (!activeSession_.preview && id) {
      markDone_(activeSession_.assignment.Assignment_ID, id, isCorrect);
    }
    if (isCorrect) {
      activeSession_.pointsEarned += Math.max(0, pointsPerQuestion || 0);
    }
    activeSession_.answerLog.push({ itemId: id, isCorrect: !!isCorrect });
  }

  async function persistHomeworkProgress_() {
    if (!activeSession_ || activeSession_.preview) return;
    if (activeSession_.assignment.Kind !== 'homework') return;
    const local = loadLocalProgress_(activeSession_.assignment.Assignment_ID);
    try {
      await post_({
        action: 'saveHomeworkProgress',
        submissionId: activeSession_.submissionId,
        progress: local
      });
    } catch (e) {
      console.warn('宿題進捗の保存:', e.message || e);
    }
  }

  function rangeComplete_() {
    if (!activeSession_) return false;
    const local = loadLocalProgress_(activeSession_.assignment.Assignment_ID);
    const need = activeSession_.rangeIds || [];
    if (!need.length) return false;
    const done = {};
    (local.doneIds || []).forEach(function (id) { done[id] = true; });
    return need.every(function (id) { return done[id]; });
  }

  async function finishActiveSession_(opts) {
    opts = opts || {};
    if (!activeSession_) return null;
    clearTimer_();
    const a = activeSession_.assignment;
    if (activeSession_.preview) {
      activeSession_ = null;
      const banner = document.getElementById('assignment-session-banner');
      if (banner) banner.hidden = true;
      if (window.clearSessionDraft_) window.clearSessionDraft_();
      return {
        status: 'success',
        assignment: true,
        preview: true,
        data: { resultStatus: 'preview' }
      };
    }
    const durationSec = Math.round((Date.now() - activeSession_.startedAtMs) / 1000);
    const correct = currentScore;
    const total = totalQuestionsCount;
    await persistHomeworkProgress_();
    const local = loadLocalProgress_(a.Assignment_ID);
    const payload = {
      action: 'submitAssignmentAttempt',
      assignmentId: a.Assignment_ID,
      submissionId: activeSession_.submissionId,
      correct: correct,
      total: total,
      points: activeSession_.pointsEarned,
      pointsMax: activeSession_.pointsMax,
      durationSec: durationSec,
      timedOut: !!opts.timedOut,
      rangeComplete: a.Kind === 'homework' ? rangeComplete_() : false,
      progress: local,
      detail: {
        reviewWrong: !!activeSession_.reviewWrong,
        answers: activeSession_.answerLog,
        sessionAnswers: sessionAnswerLog
      }
    };

    let recordAchievement = false;
    if (a.Kind === 'quiz') {
      const evalResult = evaluatePassLocal_(a, correct, total, activeSession_.pointsEarned, activeSession_.pointsMax, durationSec);
      const passState = loadPassState_(a.Assignment_ID);
      if (evalResult.pass) {
        passState.clearCount = (passState.clearCount || 0) + 1;
        passState.clears = passState.clears || [];
        passState.clears.push({
          at: new Date().toISOString(),
          score: evalResult.score,
          durationSec: durationSec
        });
      }
      const required = a.Required_Pass_Count || a.Max_Attempts || 1;
      payload.clearCount = passState.clearCount || 0;
      recordAchievement = !!(evalResult.pass
        && !passState.serverAchieved
        && passState.clearCount >= required);
      payload.recordAchievement = recordAchievement;
      savePassState_(a.Assignment_ID, passState);
    }

    let res;
    try {
      res = await postWithRetry_(payload, recordAchievement ? 2 : 1);
      if (a.Kind === 'quiz') {
        const passState = loadPassState_(a.Assignment_ID);
        if (res.data && (res.data.serverRecorded || res.data.serverAchieved)) {
          passState.serverAchieved = true;
          passState.pendingAchievement = null;
        }
        savePassState_(a.Assignment_ID, passState);
      }
    } catch (e) {
      if (a.Kind === 'quiz' && recordAchievement) {
        const passState = loadPassState_(a.Assignment_ID);
        passState.pendingAchievement = {
          correct: correct,
          total: total,
          points: activeSession_.pointsEarned,
          pointsMax: activeSession_.pointsMax,
          durationSec: durationSec,
          detail: payload.detail,
          clearCount: passState.clearCount
        };
        savePassState_(a.Assignment_ID, passState);
      }
      throw e;
    }

    if (a.Kind === 'quiz' && res.data) {
      const required = a.Required_Pass_Count || a.Max_Attempts || 1;
      const ps = loadPassState_(a.Assignment_ID);
      if (res.data.serverRecorded) {
        showToast_('ノルマ達成！管理者シートに記録しました（' + required + '回クリア）');
      } else if (res.data.passedThisAttempt) {
        showToast_('今回クリア（累計 ' + (ps.clearCount || 0) + ' / ' + required + ' 回）');
      } else if (res.data.clientOnly) {
        showToast_('今回は未達。挑戦回数に上限はありません。');
      }
    }
    const sessionSnap = activeSession_;
    activeSession_ = null;
    const banner = document.getElementById('assignment-session-banner');
    if (banner) banner.hidden = true;
    if (window.clearSessionDraft_) window.clearSessionDraft_();

    if (!opts.timedOut && !sessionSnap.reviewWrong && !sessionSnap.preview && a.Weakness_Review
        && local.wrongIds && local.wrongIds.length
        && a.Kind === 'quiz') {
      const improve = window.confirm('間違えた問題のニガテ復習に進みますか？');
      if (improve) {
        const row = listCache_.find(function (r) {
          return r.assignment && r.assignment.Assignment_ID === a.Assignment_ID;
        }) || { assignment: a, windowOpen: true };
        await startAssignment_(row, true, {});
        return res;
      }
    }

    return res;
  }

  async function forceSubmitActiveSession_() {
    if (!activeSession_) return;
    const isPreview = !!activeSession_.preview;
    if (!isPreview) showToast_('制限時間のため提出します…');
    const res = await finishActiveSession_({ timedOut: true });
    showResultScreen();
    if (!isPreview && res && res.data) {
      const d = res.data;
      showToast_('時間切れ提出: ' + (d.resultStatus || '') + ' / ' + d.score + '%');
    }
    await refreshList();
  }

  async function finalizeIfActive() {
    if (!activeSession_) return null;
    try {
      return await finishActiveSession_({ timedOut: false });
    } catch (e) {
      console.warn('課題提出:', e.message || e);
      return { status: 'error', assignment: true, message: e.message || String(e) };
    }
  }

  function bindUi() {
    const btn = document.getElementById('assignment-refresh-btn');
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener('click', function () {
        BusyButton.run(btn, refreshList, '更新中…');
      });
    }
  }

  return {
    refreshList: refreshList,
    bindUi: bindUi,
    isActive: isActive,
    getActive: getActive,
    onAnswered: onAnswered,
    finalizeIfActive: finalizeIfActive,
    reportAchievement: reportAchievement_,
    persistHomeworkProgress: persistHomeworkProgress_,
    loadLocalProgress: loadLocalProgress_,
    restoreFromDraft: restoreFromDraft,
    abandonActiveSession: abandonActiveSession_
  };
})();
window.AssignmentModule = AssignmentModule;
