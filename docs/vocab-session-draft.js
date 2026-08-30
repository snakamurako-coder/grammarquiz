/**
 * 単語クイズ・復習モード・宿題の途中セッションを localStorage に保持し復帰する
 */
const VocabSessionDraftModule = (() => {
  const STORAGE_KEY = 'dd_session_draft';
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  function accountSuffix_() {
    const user = window.AuthGateService && window.AuthGateService.getUser
      ? window.AuthGateService.getUser() : null;
    const account = user && user.account ? String(user.account).toLowerCase() : '';
    return account ? account.replace(/[^a-z0-9@._+-]/gi, '_') : 'guest';
  }

  function storageKey_() {
    return STORAGE_KEY + ':' + accountSuffix_();
  }

  function loadRaw_() {
    try {
      const raw = localStorage.getItem(storageKey_());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.updatedAt && (Date.now() - parsed.updatedAt) > MAX_AGE_MS) {
        clear();
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function save(draft) {
    if (!draft) return;
    try {
      draft.updatedAt = Date.now();
      localStorage.setItem(storageKey_(), JSON.stringify(draft));
    } catch (e) {
      console.warn('セッションドラフト保存:', e.message || e);
    }
    updateResumeBanner_();
  }

  function clear() {
    try { localStorage.removeItem(storageKey_()); } catch (e) { /* ignore */ }
    updateResumeBanner_();
  }

  function load() {
    return loadRaw_();
  }

  function kindLabel_(kind) {
    if (kind === 'vocab-review') return '復習モード';
    if (kind === 'vocab-quiz') return '単語クイズ';
    if (kind === 'assignment-homework') return '宿題';
    if (kind === 'assignment-quiz') return '小テスト';
    return '演習';
  }

  function isVocabKind_(kind) {
    return kind === 'vocab-quiz' || kind === 'vocab-review';
  }

  function isAssignmentKind_(kind) {
    return kind === 'assignment-homework' || kind === 'assignment-quiz';
  }

  function buildFromGlobals_() {
    if (typeof currentQuestionDataList === 'undefined' || !currentQuestionDataList.length) return null;
    const gameEl = document.getElementById('game-screen');
    if (!gameEl || gameEl.style.display === 'none') return null;

    const mode = typeof currentAppMode !== 'undefined' ? currentAppMode : '';
    let kind = null;
    if (mode === 'vocab') {
      kind = (typeof currentReviewSetId !== 'undefined' && currentReviewSetId) ? 'vocab-review' : 'vocab-quiz';
    } else if (mode === 'assignment-homework' || mode === 'assignment-quiz') {
      kind = mode;
    } else {
      return null;
    }

    const draft = {
      version: 1,
      kind: kind,
      appMode: mode,
      questions: currentQuestionDataList,
      currentQuestionIndex: typeof currentQuestionIndex !== 'undefined' ? currentQuestionIndex : 0,
      totalQuestionsCount: typeof totalQuestionsCount !== 'undefined' ? totalQuestionsCount : 0,
      currentScore: typeof currentScore !== 'undefined' ? currentScore : 0,
      sessionAnswerLog: typeof sessionAnswerLog !== 'undefined' ? sessionAnswerLog.slice() : [],
      vocabResultMarks: typeof vocabResultMarks_ !== 'undefined' ? Object.assign({}, vocabResultMarks_) : {},
      sessionStartTime: typeof sessionStartTime !== 'undefined' ? sessionStartTime : Date.now(),
      currentSessionSettings: typeof currentSessionSettings !== 'undefined' ? currentSessionSettings : null,
      currentVocabSetName: typeof currentVocabSetName !== 'undefined' ? currentVocabSetName : '',
      currentVocabBookName: typeof currentVocabBookName !== 'undefined' ? currentVocabBookName : '',
      currentVocabSheetName: typeof currentVocabSheetName !== 'undefined' ? currentVocabSheetName : '',
      currentReviewSetId: typeof currentReviewSetId !== 'undefined' ? currentReviewSetId : '',
      currentSessionIsPreset: typeof currentSessionIsPreset !== 'undefined' ? currentSessionIsPreset : true,
      resumeIndex: (typeof sessionAnswerLog !== 'undefined' ? sessionAnswerLog.length : 0)
    };

    if (window.AssignmentModule && window.AssignmentModule.isActive && window.AssignmentModule.isActive()) {
      const act = window.AssignmentModule.getActive();
      if (act) {
        draft.assignmentId = act.assignment && act.assignment.Assignment_ID;
        draft.submissionId = act.submissionId;
        draft.attemptNo = act.attemptNo;
        draft.pointsEarned = act.pointsEarned;
        draft.pointsMax = act.pointsMax;
        draft.reviewWrong = !!act.reviewWrong;
        draft.assignmentTitle = act.assignment && act.assignment.Title;
        draft.assignmentKind = act.assignment && act.assignment.Kind;
        draft.assignment = act.assignment;
        draft.deadlineMs = act.deadlineMs || 0;
        draft.startedAtMs = act.startedAtMs;
        draft.rangeIds = act.rangeIds || [];
        draft.answerLog = (act.answerLog || []).slice();
      }
    }
    return draft;
  }

  function saveCurrent() {
    const draft = buildFromGlobals_();
    if (draft) save(draft);
  }

  function updateBannerPair_(bannerId, textId, draft) {
    const banner = document.getElementById(bannerId);
    const textEl = textId ? document.getElementById(textId) : null;
    if (!banner) return;
    if (!draft || !draft.questions || !draft.questions.length) {
      banner.style.display = 'none';
      return;
    }
    const done = draft.resumeIndex != null ? draft.resumeIndex : (draft.sessionAnswerLog || []).length;
    const total = draft.totalQuestionsCount || draft.questions.length;
    const label = kindLabel_(draft.kind);
    const title = draft.currentVocabSetName || draft.assignmentTitle || '';
    if (textEl) {
      textEl.textContent = '中断した' + label + 'があります（' + done + '/' + total + ' 問済）'
        + (title ? ' — ' + title : '');
    }
    banner.style.display = 'block';
  }

  function updateResumeBanner_() {
    const draft = loadRaw_();
    updateBannerPair_('session-resume-banner', 'session-resume-text',
      draft && isVocabKind_(draft.kind) ? draft : null);
    updateBannerPair_('assignment-session-resume-banner', 'assignment-session-resume-text',
      draft && isAssignmentKind_(draft.kind) ? draft : null);
  }

  async function restoreDraft_(draft) {
    if (!draft || !draft.questions || !draft.questions.length) return false;

    if (isAssignmentKind_(draft.kind)) {
      if (!window.AssignmentModule || !window.AssignmentModule.restoreFromDraft) {
        alert('宿題の復帰機能を読み込めませんでした。');
        return false;
      }
      return window.AssignmentModule.restoreFromDraft(draft);
    }

    currentAppMode = 'vocab';
    currentQuestionDataList = draft.questions;
    totalQuestionsCount = draft.totalQuestionsCount || draft.questions.length;
    const resumeAt = draft.resumeIndex != null
      ? draft.resumeIndex
      : (draft.sessionAnswerLog || []).length;
    currentQuestionIndex = Math.min(resumeAt, draft.questions.length);
    currentScore = draft.currentScore || 0;
    sessionAnswerLog = draft.sessionAnswerLog || [];
    vocabResultMarks_ = draft.vocabResultMarks || {};
    sessionStartTime = draft.sessionStartTime || Date.now();
    currentSessionSettings = draft.currentSessionSettings || null;
    currentVocabSetName = draft.currentVocabSetName || '';
    currentVocabBookName = draft.currentVocabBookName || '';
    currentVocabSheetName = draft.currentVocabSheetName || '';
    currentReviewSetId = draft.currentReviewSetId || null;
    currentSessionIsPreset = draft.currentSessionIsPreset !== false;
    sessionPersistedToServer = false;

    const settingsScreen = document.getElementById('settings-screen');
    const resultScreen = document.getElementById('result-screen');
    const readingScreen = document.getElementById('reading-screen');
    if (settingsScreen) settingsScreen.style.display = 'none';
    if (resultScreen) resultScreen.style.display = 'none';
    if (readingScreen) readingScreen.style.display = 'none';
    if (screens.login) screens.login.style.display = 'none';
    screens.game.style.display = 'block';

    const ab = document.getElementById('assignment-session-banner');
    if (ab) ab.hidden = true;

    if (currentQuestionIndex >= currentQuestionDataList.length) {
      if (typeof showResultScreen === 'function') showResultScreen();
      return true;
    }

    if (window.GameSessionPlay) GameSessionPlay.start(currentQuestionDataList);
    if (typeof loadQuestionToGame === 'function') {
      loadQuestionToGame(currentQuestionDataList[currentQuestionIndex]);
    }
    saveCurrent();
    return true;
  }

  function bindUi_() {
    document.querySelectorAll('#session-resume-btn, .session-resume-btn').forEach(function (btn) {
      if (btn._draftBound) return;
      btn._draftBound = true;
      btn.addEventListener('click', async function () {
        const draft = loadRaw_();
        if (!draft) return;
        try {
          await restoreDraft_(draft);
        } catch (e) {
          console.error(e);
          alert('復帰に失敗しました: ' + (e.message || e));
        }
      });
    });
    document.querySelectorAll('#session-resume-discard-btn, .session-resume-discard-btn').forEach(function (btn) {
      if (btn._draftBound) return;
      btn._draftBound = true;
      btn.addEventListener('click', function () {
        if (!window.confirm('保存された途中データを破棄しますか？')) return;
        clear();
      });
    });
  }

  function init() {
    bindUi_();
    updateResumeBanner_();
  }

  return {
    save: save,
    saveCurrent: saveCurrent,
    load: load,
    clear: clear,
    updateResumeBanner: updateResumeBanner_,
    init: init
  };
})();

window.VocabSessionDraftModule = VocabSessionDraftModule;

window.persistSessionDraft_ = function () {
  if (window.VocabSessionDraftModule) VocabSessionDraftModule.saveCurrent();
};

window.clearSessionDraft_ = function () {
  if (window.VocabSessionDraftModule) VocabSessionDraftModule.clear();
};
