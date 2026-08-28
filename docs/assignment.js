/**
 * 宿題・小テスト（生徒側）
 * 課題マスタ／提出は GAS＋本体 SS。進捗キャッシュはローカル。
 */
const AssignmentModule = (function () {
  const PROGRESS_PREFIX = 'dd_hw_progress:';
  const PASS_PREFIX = 'dd_quiz_pass:';
  let listCache_ = [];
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

  function loadPassState_(assignmentId) {
    try {
      const raw = localStorage.getItem(passKey_(assignmentId));
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object'
        ? parsed
        : { clearCount: 0, clears: [], serverAchieved: false };
    } catch (e) {
      return { clearCount: 0, clears: [], serverAchieved: false };
    }
  }

  function savePassState_(assignmentId, state) {
    try {
      localStorage.setItem(passKey_(assignmentId), JSON.stringify(state || { clearCount: 0, clears: [], serverAchieved: false }));
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

  async function refreshList() {
    const wrap = document.getElementById('assignment-list');
    if (!wrap) return;
    if (!AuthGateService.isValid()) {
      wrap.innerHTML = '<p>ログインすると課題が表示されます。</p>';
      return;
    }
    wrap.innerHTML = '<p>読込中...</p>';
    try {
      const res = await post_({ action: 'listMyAssignments' });
      listCache_ = res.data || [];
      renderList_(listCache_);
    } catch (e) {
      wrap.innerHTML = '<p style="color:#c62828;">課題の取得に失敗: ' + escapeHtml_(e.message || e) + '</p>';
    }
  }

  function escapeHtml_(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderList_(rows) {
    const wrap = document.getElementById('assignment-list');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML = '<p>現在取り組める課題はありません。</p>'
        + '<p class="hint" style="font-size:.85em;color:#666;margin-top:8px;">'
        + '管理者側で「公開＝有効」、期間内、配布対象（class / attribute）が一致しているか確認してください。'
        + 'ログイン直後は「更新」を押してください。</p>';
      return;
    }
    let html = '';
    rows.forEach(function (row, idx) {
      const a = row.assignment || {};
      const kindLabel = a.Kind === 'quiz' ? '小テスト' : '宿題';
      const limit = a.Time_Limit_Sec > 0 ? ('制限 ' + formatLimit_(a.Time_Limit_Sec)) : '制限なし';
      const required = a.Required_Pass_Count || a.Max_Attempts || 1;
      const passState = loadPassState_(a.Assignment_ID);
      if (row.serverAchieved) {
        passState.serverAchieved = true;
        savePassState_(a.Assignment_ID, passState);
      }
      const serverDone = !!(row.serverAchieved || passState.serverAchieved);
      const clearN = serverDone ? required : (passState.clearCount || 0);
      const latest = row.latestSubmission;
      const status = serverDone ? '達成済' : (latest ? String(latest.Status || '') : '未着手');
      const local = loadLocalProgress_(a.Assignment_ID);
      const doneN = (local.doneIds || []).length;
      html += '<div class="log-item" style="display:block;">';
      html += '<div class="log-title">' + escapeHtml_(a.Title) + ' <span style="font-size:.8em;color:#666;">[' + kindLabel + ']</span></div>';
      html += '<div class="log-meta">' + escapeHtml_(limit);
      if (a.Kind === 'quiz') {
        html += ' / クリア ' + clearN + '／' + required + ' 回（ノルマ）';
        html += ' / 状態 ' + escapeHtml_(status);
      } else {
        html += ' / 状態 ' + escapeHtml_(status);
        html += ' / ローカル消化 ' + doneN + '問';
      }
      html += '</div>';
      html += '<div class="log-settings">合格ライン: ' + escapeHtml_(a.Pass_Score) + (a.Pass_Mode === 'points' ? '点' : '%');
      if (a.Kind === 'quiz') html += ' / 挑戦回数無制限';
      if (a.Weakness_Review) html += ' / ニガテ復習あり';
      html += '</div>';
      html += '<button type="button" class="btn-small assignment-start-btn" data-idx="' + idx + '" style="margin-top:8px;">'
        + (serverDone && a.Kind === 'quiz' ? '再挑戦（記録済）' : '取り組む') + '</button>';
      html += '</div>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.assignment-start-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const row = listCache_[idx];
        if (!row) return;
        BusyButton.run(btn, function () { return startAssignment_(row); }, '準備中…');
      });
    });
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
        if (sec.filters && window.GrammarSettingsModule && GrammarSettingsModule.getFilteredRows) {
          // getFilteredRows はモジュール内部状態依存のため簡易フィルタを使う
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
          wordsPayload = await PresetModule.getVocabWords(bookName, sheetName, filtersJson, true, false);
          if (wordsPayload && wordsPayload.data) wordsPayload = wordsPayload.data;
        }
        const words = (wordsPayload && wordsPayload.words) || wordsPayload || [];
        const pool = (wordsPayload && wordsPayload.pool) || words;
        const bookPool = (wordsPayload && wordsPayload.bookPool) || pool;
        const formats = (sec.formats && sec.formats.length) ? sec.formats.slice(0, 4) : ['vocab-enja'];
        const per = parseInt(sec.questionCount, 10) || 5;
        qs = VocabQuizGenerator.buildQuestions(words, pool, bookPool, {
          formats: formats,
          homeworkMode: true,
          homeworkPerSection: per,
          includeNone: sec.includeNone !== false,
          includeUnknown: sec.includeUnknown !== false,
          choiceCount: sec.choiceCount || 4,
          poolDummyCount: sec.poolDummyCount != null ? sec.poolDummyCount : 2,
          dummyScope: sec.dummyScope || 'sheet',
          dummyMethod: sec.dummyMethod || 'none',
          affixType: sec.affixType || 'prefix',
          affixLen: sec.affixLen != null ? sec.affixLen : 2,
          usedKeys: usedVocabKeys
        });
        // usedKeys 伝播（ビルダが Set を受け取らない場合は後段で除外）
        qs.forEach(function (q) {
          const key = q.wordId || q.itemId || (q.wordObj && (q.wordObj.wordId || q.wordObj['英単語・熟語の表現']));
          if (key) usedVocabKeys.add(String(key));
        });
        if (usedVocabKeys.size) {
          // 追加セクションで重複語を落とす
          qs = qs.filter(function (q, i, arr) {
            const key = String(q.wordId || q.itemId || '');
            if (!key) return true;
            // buildHomeworkQuestions 内で既に unique なのでセクション内はOK。横断は usedKeys で
            return true;
          });
        }
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

  async function startAssignment_(row, reviewWrong) {
    const a = row.assignment;
    if (!a) throw new Error('課題データがありません');
    const sections = a.Sections || [];
    if (!sections.length) throw new Error('セクションが空です');

    const local = loadLocalProgress_(a.Assignment_ID);
    const startRes = await post_({
      action: 'startAssignmentAttempt',
      assignmentId: a.Assignment_ID,
      progress: local
    });
    const data = startRes.data || {};
    const buildOpts = {};
    if (reviewWrong && local.wrongIds && local.wrongIds.length) {
      buildOpts.onlyWrongIds = local.wrongIds.slice();
    } else if (a.Kind === 'homework') {
      buildOpts.skipDoneIds = local.doneIds || [];
    }

    const built = await buildQuestionsFromSections_(sections, buildOpts);
    if (!built.questions.length) {
      if (a.Kind === 'homework' && (local.doneIds || []).length) {
        // 範囲完走済み → 提出
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
      answerLog: []
    };

    currentAppMode = a.Kind === 'quiz' ? 'assignment-quiz' : 'assignment-homework';
    currentSessionIsPreset = false;
    currentSessionSettings = {
      kind: 'assignment',
      assignmentId: a.Assignment_ID,
      assignmentKind: a.Kind,
      title: a.Title,
      reviewWrong: !!reviewWrong
    };
    currentQuestionDataList = built.questions;
    totalQuestionsCount = built.questions.length;
    currentQuestionIndex = 0;
    currentScore = 0;
    sessionAnswerLog = [];
    sessionPersistedToServer = false;
    sessionStartTime = Date.now();

    screens.login.style.display = 'none';
    screens.settings.style.display = 'none';
    const resultScreen = document.getElementById('result-screen');
    if (resultScreen) resultScreen.style.display = 'none';
    const readingScreen = document.getElementById('reading-screen');
    if (readingScreen) readingScreen.style.display = 'none';
    screens.game.style.display = 'block';

    const banner = document.getElementById('assignment-session-banner');
    if (banner) {
      banner.hidden = false;
      banner.textContent = (a.Kind === 'quiz' ? '【小テスト】' : '【宿題】') + a.Title
        + (reviewWrong ? '（ニガテ復習）' : '');
    }

    if (activeSession_.deadlineMs) startTimer_(activeSession_.deadlineMs);
    else clearTimer_();

    if (typeof beginVocabPoolGameSession_ === 'function' && beginVocabPoolGameSession_(currentQuestionDataList)) {
      // 選択肢プール専用UI（単語マッチング）
    } else {
      loadQuestionToGame(currentQuestionDataList[0]);
    }
  }

  function isActive() {
    return !!activeSession_;
  }

  function getActive() {
    return activeSession_;
  }

  /** 解答確定時（正誤）— ItemState / SRS は呼び出し側で抑制すること */
  function onAnswered(itemId, isCorrect, pointsPerQuestion) {
    if (!activeSession_) return;
    const id = itemId || '';
    if (id) markDone_(activeSession_.assignment.Assignment_ID, id, isCorrect);
    if (isCorrect) {
      activeSession_.pointsEarned += Math.max(0, pointsPerQuestion || 0);
    }
    activeSession_.answerLog.push({ itemId: id, isCorrect: !!isCorrect });
  }

  async function persistHomeworkProgress_() {
    if (!activeSession_ || activeSession_.assignment.Kind !== 'homework') return;
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

    if (a.Kind === 'quiz') {
      const evalResult = evaluatePassLocal_(a, correct, total, activeSession_.pointsEarned, activeSession_.pointsMax, durationSec);
      const passState = loadPassState_(a.Assignment_ID);
      if (evalResult.pass && !passState.serverAchieved) {
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
      payload.recordAchievement = !!(evalResult.pass
        && !passState.serverAchieved
        && passState.clearCount >= required);
      savePassState_(a.Assignment_ID, passState);
    }

    const res = await post_(payload);
    if (a.Kind === 'quiz' && res.data && res.data.serverRecorded) {
      const passState = loadPassState_(a.Assignment_ID);
      passState.serverAchieved = true;
      savePassState_(a.Assignment_ID, passState);
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

    // ⑥ ニガテ復習: 初回提出後・不合格でなく wrong があり・オプションON
    if (!opts.timedOut && !sessionSnap.reviewWrong && a.Weakness_Review
        && local.wrongIds && local.wrongIds.length
        && a.Kind === 'quiz') {
      const improve = window.confirm('間違えた問題のニガテ復習に進みますか？');
      if (improve) {
        await startAssignment_({ assignment: a }, true);
        return res;
      }
    }

    return res;
  }

  async function forceSubmitActiveSession_() {
    if (!activeSession_) return;
    // 現在表示中の未回答は不正解扱いせず、ここまでのスコアで提出
    showToast_('制限時間のため提出します…');
    const res = await finishActiveSession_({ timedOut: true });
    showResultScreen();
    if (res && res.data) {
      const d = res.data;
      showToast_('時間切れ提出: ' + (d.resultStatus || '') + ' / ' + d.score + '%');
    }
    await refreshList();
  }

  /** 通常の結果画面フローから呼ぶ */
  async function finalizeIfActive() {
    if (!activeSession_) return null;
    return finishActiveSession_({ timedOut: false });
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
    persistHomeworkProgress: persistHomeworkProgress_,
    loadLocalProgress: loadLocalProgress_
  };
})();
window.AssignmentModule = AssignmentModule;
