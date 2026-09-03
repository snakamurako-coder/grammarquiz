/**
 * Word Link / Audio WL — 単語学習セット装填版（Desktop index.html 踏襲）
 */
const VocabLinkModule = (function () {
  const MODE_LABELS = {
    'wl-eija': 'Word Link 英和',
    'wl-jaei': 'Word Link 和英',
    'awl-eija': 'Audio WL 英和',
    'awl-jaei': 'Audio WL 和英'
  };

  let sessionMeta = null;
  let masterPairs = [];
  let statsMap = {};
  let currentMode = 'wl-eija';
  let currentGamePool = [];
  let remainingPool = [];
  let currentBatch = [];
  let batchMatchedCount = 0;
  let totalClearedCount = 0;
  let selectedCard1 = null;
  let selectedCard2 = null;
  let firstTapTimestamp = null;
  let startTime = null;
  let penaltyTime = 0;
  let timerInterval = null;
  let isWrongState = false;
  let isReviewMode = false;
  let sessionLogSaved = false;
  let uiBound = false;
  let lastSortedPool = [];
  let heardAudioIds = {};
  let firstPlayLock = false;
  let pauseStartedAt = null;
  let pausedSec = 0;
  let firstPlayToken = 0;

  function el_(id) {
    return document.getElementById(id);
  }

  function unreg_() {
    return window.VOCAB_UNREGISTERED || '×';
  }

  function shuffle_(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function buildPairsFromWords_(words) {
    const pairs = [];
    (words || []).forEach(function (wordObj) {
      if (window.vocabCanonicalizeWordObj) window.vocabCanonicalizeWordObj(wordObj);
      const en = window.vocabNorm(wordObj['英単語・熟語の表現']);
      const meanings = window.vocabGetMeanings ? window.vocabGetMeanings(wordObj) : [];
      const ja = meanings.length ? window.vocabNorm(meanings[0].meaning) : '';
      const bad = unreg_();
      if (!en || en === bad || !ja || ja === bad) return;
      pairs.push({
        id: String(wordObj['通し番号']),
        ja: ja,
        en: en,
        wordObj: wordObj
      });
    });
    return pairs;
  }

  function initStats_(pairs) {
    statsMap = {};
    pairs.forEach(function (p) {
      statsMap[p.id] = { wrongCount: 0, thinkTime: 0, rating: null };
    });
  }

  function playSpeech_(text, lang) {
    if (!window.TtsModule || typeof window.TtsModule.speakText !== 'function') {
      return Promise.resolve();
    }
    const langCode = lang === 'ja' ? 'ja-JP' : (window.TtsModule.load().locale || 'en-US');
    return window.TtsModule.speakText(String(text || ''), langCode);
  }

  function showScreen_() {
    document.body.classList.add('vocab-link-active');
    const screen = el_('vocab-link-screen');
    if (screen) {
      screen.style.display = 'flex';
      screen.setAttribute('aria-hidden', 'false');
    }
    const settings = document.getElementById('settings-screen');
    if (settings) settings.style.display = 'none';
    showStartScreen_();
  }

  function hideScreen_() {
    stopTimer_();
    resetAudioLock_(true);
    clearBoard_();
    hideOverlay_('vl-ready-screen');
    hideOverlay_('vl-result-screen');
    if (window.TtsModule && typeof window.TtsModule.stop === 'function') {
      window.TtsModule.stop();
    }
    document.body.classList.remove('vocab-link-active');
    const screen = el_('vocab-link-screen');
    if (screen) {
      screen.style.display = 'none';
      screen.setAttribute('aria-hidden', 'true');
    }
    const settings = document.getElementById('settings-screen');
    if (settings) settings.style.display = 'block';
  }

  function clearBoard_() {
    const colLeft = el_('vl-col-left');
    const colRight = el_('vl-col-right');
    if (colLeft) colLeft.innerHTML = '';
    if (colRight) colRight.innerHTML = '';
  }

  function hideOverlay_(id) {
    const node = el_(id);
    if (node) node.style.display = 'none';
  }

  function showStartScreen_() {
    stopTimer_();
    resetAudioLock_(true);
    if (window.TtsModule && typeof window.TtsModule.stop === 'function') {
      window.TtsModule.stop();
    }
    clearBoard_();
    hideOverlay_('vl-result-screen');
    hideOverlay_('vl-ready-screen');
    const start = el_('vl-start-screen');
    if (start) start.style.display = 'flex';
  }

  function showReadyScreen_() {
    hideOverlay_('vl-start-screen');
    hideOverlay_('vl-result-screen');
    const ready = el_('vl-ready-screen');
    if (ready) ready.style.display = 'flex';
  }

  function selectMode_(modeKey) {
    currentMode = modeKey;
    startNewGame_(masterPairs.slice(0, masterPairs.length), false);
  }

  function startNewGame_(pairs, isReview) {
    isReviewMode = !!isReview;
    sessionLogSaved = false;
    stopTimer_();
    clearBoard_();
    hideOverlay_('vl-result-screen');
    hideOverlay_('vl-start-screen');

    currentGamePool = pairs.slice();
    remainingPool = shuffle_(currentGamePool);

    currentGamePool.forEach(function (p) {
      if (!statsMap[p.id]) statsMap[p.id] = { wrongCount: 0, thinkTime: 0, rating: null };
      statsMap[p.id].wrongCount = 0;
      statsMap[p.id].thinkTime = 0;
    });

    totalClearedCount = 0;
    penaltyTime = 0;
    startTime = null;
    selectedCard1 = null;
    selectedCard2 = null;
    firstTapTimestamp = null;
    isWrongState = false;
    batchMatchedCount = 0;
    currentBatch = [];
    heardAudioIds = {};
    resetAudioLock_(true);

    const timerDisplay = el_('vl-timer');
    if (timerDisplay) timerDisplay.textContent = '0.00s';
    const modeText = el_('vl-mode-text');
    if (modeText) modeText.textContent = MODE_LABELS[currentMode] || currentMode;
    const progressText = el_('vl-progress-text');
    if (progressText) progressText.textContent = '残り: ' + currentGamePool.length;

    showReadyScreen_();
  }

  function beginPlay_() {
    hideOverlay_('vl-ready-screen');
    loadNextBatch_();
    startTimer_();
  }

  function loadNextBatch_() {
    const colLeft = el_('vl-col-left');
    const colRight = el_('vl-col-right');
    if (!colLeft || !colRight) return;
    colLeft.innerHTML = '';
    colRight.innerHTML = '';
    batchMatchedCount = 0;

    if (!remainingPool.length) {
      finishGame_();
      return;
    }

    const count = Math.min(10, remainingPool.length);
    currentBatch = remainingPool.splice(0, count);
    const leftList = shuffle_(currentBatch);
    const rightList = shuffle_(currentBatch);

    leftList.forEach(function (p) { colLeft.appendChild(createCard_(p, 'left')); });
    rightList.forEach(function (p) { colRight.appendChild(createCard_(p, 'right')); });
  }

  function createCard_(pair, colType) {
    const div = document.createElement('div');
    div.className = 'vl-card';
    div.dataset.id = pair.id;
    div.dataset.col = colType;

    if (colType === 'left') {
      if (currentMode === 'wl-eija') {
        div.textContent = pair.en;
      } else if (currentMode === 'wl-jaei') {
        div.textContent = pair.ja;
      } else if (currentMode === 'awl-eija') {
        div.textContent = '📢';
        div.classList.add('vl-audio-card');
        div.dataset.speechText = pair.en;
        div.dataset.speechLang = 'en';
      } else if (currentMode === 'awl-jaei') {
        div.textContent = '📢';
        div.classList.add('vl-audio-card');
        div.dataset.speechText = pair.ja;
        div.dataset.speechLang = 'ja';
      }
    } else {
      if (currentMode === 'wl-eija' || currentMode === 'awl-eija') {
        div.textContent = pair.ja;
      } else {
        div.textContent = pair.en;
      }
    }

    div.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      handleCardClick_(div);
    });
    return div;
  }

  function startTimer_() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    startTime = performance.now();
    pauseStartedAt = null;
    pausedSec = 0;
    timerInterval = setInterval(updateTimer_, 10);
  }

  function stopTimer_() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function nowForTimer_() {
    return pauseStartedAt != null ? pauseStartedAt : performance.now();
  }

  function updateTimer_() {
    if (!startTime) return;
    const timerDisplay = el_('vl-timer');
    if (timerDisplay) timerDisplay.textContent = getElapsedSec_().toFixed(2) + 's';
  }

  function pauseTimer_() {
    if (!startTime || pauseStartedAt != null) return;
    pauseStartedAt = performance.now();
    updateTimer_();
  }

  function resumeTimer_() {
    if (pauseStartedAt == null) return;
    pausedSec += (performance.now() - pauseStartedAt) / 1000;
    pauseStartedAt = null;
    updateTimer_();
  }

  function resetAudioLock_(resetPauseAccum) {
    firstPlayToken += 1;
    firstPlayLock = false;
    pauseStartedAt = null;
    if (resetPauseAccum) pausedSec = 0;
    document.body.classList.remove('vl-audio-lock');
    document.querySelectorAll('.vl-card.vl-audio-playing').forEach(function (node) {
      node.classList.remove('vl-audio-playing');
    });
  }

  function setFirstPlayLock_(on, playingCard) {
    firstPlayLock = !!on;
    document.body.classList.toggle('vl-audio-lock', firstPlayLock);
    document.querySelectorAll('.vl-card.vl-audio-playing').forEach(function (node) {
      node.classList.remove('vl-audio-playing');
    });
    if (playingCard && firstPlayLock) playingCard.classList.add('vl-audio-playing');
  }

  function handleCardClick_(card) {
    if (card.classList.contains('matched')) return;
    if (firstPlayLock) return;
    if (!startTime) startTimer_();
    if (isWrongState) clearWrongState_();

    const isAudio = !!card.dataset.speechText;
    const pairId = card.dataset.id;
    const isFirstAudioPlay = isAudio && !heardAudioIds[pairId];

    if (isFirstAudioPlay) {
      heardAudioIds[pairId] = true;
      const token = ++firstPlayToken;
      pauseTimer_();
      setFirstPlayLock_(true, card);
      const release = function () {
        if (token !== firstPlayToken) return;
        firstPlayToken += 1;
        setFirstPlayLock_(false);
        resumeTimer_();
      };
      playSpeech_(card.dataset.speechText, card.dataset.speechLang).then(release);
      setTimeout(release, 20000);
      return;
    }

    if (isAudio) {
      playSpeech_(card.dataset.speechText, card.dataset.speechLang);
    }

    if (!selectedCard1 && !selectedCard2) {
      firstTapTimestamp = performance.now();
    }

    if (card.dataset.col === 'left') {
      if (selectedCard1 && selectedCard1.dataset.col === 'left') selectedCard1.classList.remove('selected');
      if (selectedCard2 && selectedCard2.dataset.col === 'left') selectedCard2.classList.remove('selected');
      selectedCard1 = card;
    } else {
      if (selectedCard1 && selectedCard1.dataset.col === 'right') selectedCard1.classList.remove('selected');
      if (selectedCard2 && selectedCard2.dataset.col === 'right') selectedCard2.classList.remove('selected');
      selectedCard2 = card;
    }
    card.classList.add('selected');

    if (selectedCard1 && selectedCard2) {
      const id1 = selectedCard1.dataset.id;
      const id2 = selectedCard2.dataset.id;

      if (id1 === id2) {
        const thinkDuration = (nowForTimer_() - firstTapTimestamp) / 1000;
        if (statsMap[id1]) statsMap[id1].thinkTime += thinkDuration;

        selectedCard1.className = 'vl-card matched';
        selectedCard2.className = 'vl-card matched';
        selectedCard1 = null;
        selectedCard2 = null;
        firstTapTimestamp = null;

        batchMatchedCount++;
        totalClearedCount++;
        const progressText = el_('vl-progress-text');
        if (progressText) {
          progressText.textContent = '残り: ' + (currentGamePool.length - totalClearedCount);
        }

        if (batchMatchedCount === currentBatch.length) {
          loadNextBatch_();
        }
      } else {
        if (statsMap[id1]) statsMap[id1].wrongCount += 1;
        if (statsMap[id2]) statsMap[id2].wrongCount += 1;

        penaltyTime += 1.0;
        updateTimer_();
        showPenaltyAnimation_();

        selectedCard1.classList.add('wrong');
        selectedCard2.classList.add('wrong');
        isWrongState = true;

        setTimeout(function () {
          if (isWrongState) clearWrongState_();
        }, 150);
      }
    }
  }

  function showPenaltyAnimation_() {
    const penaltyPop = el_('vl-penalty-pop');
    if (!penaltyPop) return;
    penaltyPop.classList.remove('show');
    void penaltyPop.offsetWidth;
    penaltyPop.classList.add('show');
  }

  function clearWrongState_() {
    if (selectedCard1) selectedCard1.classList.remove('selected', 'wrong');
    if (selectedCard2) selectedCard2.classList.remove('selected', 'wrong');
    selectedCard1 = null;
    selectedCard2 = null;
    firstTapTimestamp = null;
    isWrongState = false;
  }

  function getElapsedSec_() {
    if (!startTime) return penaltyTime;
    return (nowForTimer_() - startTime) / 1000 - pausedSec + penaltyTime;
  }

  function finishGame_() {
    stopTimer_();
    updateTimer_();

    const elapsedTotal = getElapsedSec_().toFixed(2);
    const finalTime = el_('vl-final-time');
    if (finalTime) finalTime.textContent = elapsedTotal + 's';

    const resultTitle = el_('vl-result-title');
    const reviewControls = el_('vl-review-controls');
    const homeControl = el_('vl-home-control');

    if (isReviewMode) {
      if (resultTitle) resultTitle.textContent = '復習結果';
      if (reviewControls) reviewControls.style.display = 'none';
      if (homeControl) homeControl.style.display = 'flex';
    } else {
      if (resultTitle) resultTitle.textContent = 'RESULT';
      if (reviewControls) reviewControls.style.display = 'flex';
      if (homeControl) homeControl.style.display = 'none';
    }

    renderResultList_();
    const result = el_('vl-result-screen');
    if (result) result.style.display = 'flex';

    saveSessionLog_({ completed: true, elapsedSec: parseFloat(elapsedTotal) });
  }

  function renderResultList_() {
    const resultList = el_('vl-result-list');
    if (!resultList) return;
    resultList.innerHTML = '';

    const sortedPool = currentGamePool.slice().sort(function (a, b) {
      const statA = statsMap[a.id] || { wrongCount: 0, thinkTime: 0 };
      const statB = statsMap[b.id] || { wrongCount: 0, thinkTime: 0 };
      if (statB.wrongCount !== statA.wrongCount) return statB.wrongCount - statA.wrongCount;
      return statB.thinkTime - statA.thinkTime;
    });
    lastSortedPool = sortedPool;

    sortedPool.forEach(function (item, index) {
      const stat = statsMap[item.id] || { wrongCount: 0, thinkTime: 0, rating: null };
      const row = document.createElement('div');
      row.className = 'vl-result-item';

      const wrongBadge = stat.wrongCount > 0
        ? '<span class="vl-badge-wrong">ミス: ' + stat.wrongCount + '回</span>'
        : '<span style="color:#22c55e;">ミスなし</span>';

      row.innerHTML =
        '<div class="vl-word-info">'
        + '<div class="vl-word-pair">' + (index + 1) + '. ' + escapeHtml_(item.ja) + ' — ' + escapeHtml_(item.en) + '</div>'
        + '<div class="vl-word-stats">' + wrongBadge + ' | 思考: ' + stat.thinkTime.toFixed(2) + 's</div>'
        + '</div>'
        + '<div class="vl-rating-btns">'
        + '<button type="button" class="vl-btn-rate' + (stat.rating === 'good' ? ' active' : '') + '" data-rate-id="' + escapeHtml_(item.id) + '" data-rate-type="good">👍</button>'
        + '<button type="button" class="vl-btn-rate' + (stat.rating === 'bad' ? ' active' : '') + '" data-rate-id="' + escapeHtml_(item.id) + '" data-rate-type="bad">😱</button>'
        + '</div>';

      row.querySelectorAll('.vl-btn-rate').forEach(function (btn) {
        btn.addEventListener('click', function () {
          toggleRating_(btn.getAttribute('data-rate-id'), btn.getAttribute('data-rate-type'), btn);
        });
      });
      resultList.appendChild(row);
    });
  }

  function escapeHtml_(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toggleRating_(id, type, btnEl) {
    const stat = statsMap[id];
    if (!stat) return;
    const parent = btnEl.parentElement;
    parent.querySelectorAll('.vl-btn-rate').forEach(function (b) { b.classList.remove('active'); });

    if (stat.rating === type) {
      stat.rating = null;
      persistUserMark_(id, null);
    } else {
      stat.rating = type;
      btnEl.classList.add('active');
      persistUserMark_(id, type === 'good' ? 'known' : 'unknown');
    }
  }

  function persistUserMark_(pairId, mark) {
    if (!sessionMeta || !window.SrsModule || !window.ItemStateModule) return;
    const wordId = window.SrsModule.buildWordId(sessionMeta.bookName, sessionMeta.sheetName, pairId);
    const patch = { User_Mark: mark || '' };
    window.ItemStateModule.patchState(wordId, patch);
  }

  function startReviewMode_() {
    const select = el_('vl-review-count-select');
    const count = parseInt(select && select.value, 10) || 50;
    let reviewPool = lastSortedPool.slice();

    if (reviewPool.length < count) {
      const existingIds = {};
      reviewPool.forEach(function (p) { existingIds[p.id] = true; });
      masterPairs.forEach(function (p) {
        if (!existingIds[p.id]) reviewPool.push(p);
      });
    }
    const start = el_('vl-start-screen');
    if (start) start.style.display = 'none';
    startNewGame_(reviewPool.slice(0, count), true);
  }

  function goHome_() {
    const start = el_('vl-start-screen');
    if (start) start.style.display = 'none';
    startNewGame_(masterPairs.slice(0, masterPairs.length), false);
  }

  async function saveSessionLog_(opts) {
    opts = opts || {};
    if (sessionLogSaved || !sessionMeta) return;
    sessionLogSaved = true;

    let totalWrong = 0;
    currentGamePool.forEach(function (p) {
      totalWrong += (statsMap[p.id] && statsMap[p.id].wrongCount) || 0;
    });

    const stats = {
      setName: sessionMeta.setName,
      bookName: sessionMeta.bookName,
      sheetName: sessionMeta.sheetName,
      isPreset: sessionMeta.isPreset,
      linkMode: currentMode,
      wordCount: currentGamePool.length,
      elapsedSec: opts.elapsedSec != null ? opts.elapsedSec : getElapsedSec(),
      totalWrong: totalWrong,
      isReview: !!isReviewMode,
      completed: !!opts.completed
    };

    if (typeof window.saveVocabLinkSessionLog_ === 'function') {
      try {
        await window.saveVocabLinkSessionLog_(stats);
      } catch (e) {
        console.warn('Word Link 学習記録:', e.message || e);
        sessionLogSaved = false;
      }
    }

    if (window.ItemStateModule) {
      window.ItemStateModule.syncToServer().catch(function (e) {
        console.warn('学習状態の同期:', e.message || e);
      });
    }
  }

  function backToSettings_() {
    saveSessionLog_({ completed: false }).finally(function () {
      hideScreen_();
      if (window.BackendSyncStatus) window.BackendSyncStatus.refresh();
    });
  }

  function bindUiOnce_() {
    if (uiBound) return;
    uiBound = true;

    document.querySelectorAll('[data-vl-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectMode_(btn.getAttribute('data-vl-mode'));
      });
    });

    const changeModeBtn = el_('vl-change-mode-btn');
    if (changeModeBtn) changeModeBtn.addEventListener('click', showStartScreen_);
    const changeModeBtn2 = el_('vl-change-mode-btn-2');
    if (changeModeBtn2) changeModeBtn2.addEventListener('click', showStartScreen_);

    const readyStartBtn = el_('vl-ready-start-btn');
    if (readyStartBtn) readyStartBtn.addEventListener('click', beginPlay_);

    const backBtn = el_('vl-back-btn');
    if (backBtn) backBtn.addEventListener('click', backToSettings_);

    const reviewBtn = el_('vl-review-start-btn');
    if (reviewBtn) reviewBtn.addEventListener('click', startReviewMode_);

    const homeBtn = el_('vl-home-btn');
    if (homeBtn) homeBtn.addEventListener('click', goHome_);

    const resultTopBtn = el_('vl-result-top-btn');
    if (resultTopBtn) resultTopBtn.addEventListener('click', showStartScreen_);
  }

  function getLinkQuestionCount_() {
    const sel = el_('vocab-link-count');
    if (!sel) return 25;
    const n = parseInt(sel.value, 10);
    return n > 0 ? n : 25;
  }

  async function loadWords_(options) {
    if (window.VocabSettingsModule && VocabSettingsModule.loadVocabWordsForSettings) {
      return VocabSettingsModule.loadVocabWordsForSettings(options);
    }
    throw new Error('単語設定モジュールが読み込まれていません');
  }

  async function loadAndStart(options) {
    bindUiOnce_();
    const words = await loadWords_(options);
    if (!words.length) throw new Error('条件に合う単語がありません。');

    const pairs = buildPairsFromWords_(words);
    if (!pairs.length) throw new Error('語（WD）の英語と語義が揃った単語がありません。');

    const want = getLinkQuestionCount_();
    masterPairs = shuffle_(pairs).slice(0, Math.min(want, pairs.length));
    initStats_(masterPairs);

    const bookType = (document.getElementById('vocab-book-type') || {}).value;
    sessionMeta = {
      bookName: options.bookName,
      sheetName: options.sheetName,
      setName: options.bookName + ' / ' + options.sheetName,
      isPreset: bookType === 'preset'
    };

    if (typeof window.applyVocabLinkSessionGlobals_ === 'function') {
      window.applyVocabLinkSessionGlobals_(sessionMeta);
    }

    if (window.TtsModule && typeof window.TtsModule.prime === 'function') {
      window.TtsModule.prime();
    }

    showScreen_();
  }

  function syncHomeworkUi_(homework) {
    const btn = el_('vocab-link-start-btn');
    if (!btn) return;
    btn.disabled = !!homework;
    btn.title = homework ? '宿題・小テストモードでは利用できません' : '';
    btn.style.opacity = homework ? '0.5' : '';
  }

  function getSessionDisplaySettings_() {
    return {
      linkMode: currentMode,
      wordCount: masterPairs.length
    };
  }

  return {
    loadAndStart: loadAndStart,
    backToSettings: backToSettings_,
    syncHomeworkUi_: syncHomeworkUi_,
    getSessionDisplaySettings: getSessionDisplaySettings_
  };
})();

if (typeof window !== 'undefined') {
  window.VocabLinkModule = VocabLinkModule;
}
