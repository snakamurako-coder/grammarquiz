/**
 * 単語カードモード（Desktop index.html 移植）
 * 依存: vocabNorm, VOCAB_UNREGISTERED, vocabCanonicalizeWordObj, vocabGetMeanings,
 *       vocabGetChunkMaterial, vocabGetExampleMaterial, vocabParseBracket, SrsModule,
 *       ItemStateModule, PresetModule, UserVocabCacheModule, AuthGateService, BusyButton
 */
const VocabCardModule = (() => {
  const SETTINGS_KEY = 'dd_vocab_card_settings';
  const DEFAULT_SETTINGS = {
    contentType: 'word',
    firstLang: 'en',
    shuffle: false,
    intervalFrontBack: 1.0,
    intervalNextWord: 1.0
  };

  let sessionMeta = null;
  let allItems = [];
  let activeList = [];
  let currentIndex = 0;
  let currentMode = 'all';
  let knownIds = new Set();
  let unknownIds = new Set();
  let marks = {};
  let isAutoPlaying = false;
  let autoPlayToken = 0;
  let uiBound = false;
  let keyHandler = null;
  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let resultsCommitted = false;

  function esc_(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function unreg_() {
    return window.VOCAB_UNREGISTERED || '×';
  }

  function displayVocab_(text) {
    const s = window.vocabNorm(text);
    if (!s || s === unreg_()) return '';
    return esc_(s);
  }

  function highlightBracket_(text) {
    const s = window.vocabNorm(text);
    if (!s || s === unreg_()) return '';
    const m = s.match(/[(（]([^)）]+)[)）]/);
    if (!m) return esc_(s);
    const inner = m[1];
    const idx = s.indexOf(m[0]);
    if (idx < 0) return esc_(s);
    return esc_(s.slice(0, idx))
      + '<span class="vocab-card-hl">' + esc_(inner) + '</span>'
      + esc_(s.slice(idx + m[0].length));
  }

  function highlightWord_(text, word) {
    const s = window.vocabNorm(text);
    const w = window.vocabNorm(word);
    if (!s || s === unreg_()) return '';
    if (!w || w === unreg_()) return esc_(s);
    const lower = s.toLowerCase();
    const wl = w.toLowerCase();
    const idx = lower.indexOf(wl);
    if (idx < 0) return highlightBracket_(s);
    return esc_(s.slice(0, idx))
      + '<span class="vocab-card-hl">' + esc_(s.slice(idx, idx + w.length)) + '</span>'
      + esc_(s.slice(idx + w.length));
  }

  function buildCardItemsFromWords_(words, options) {
    const axes = (options && options.axes) || {};
    const grains = axes.grains || ['WD'];
    let defaultType = 'word';
    if (grains.indexOf('WD') < 0 && grains.indexOf('PH') >= 0) defaultType = 'phrase';
    if (grains.indexOf('WD') < 0 && grains.indexOf('PH') < 0 && grains.indexOf('EX') >= 0) defaultType = 'example';
    const dirs = axes.directions || ['jaen'];
    const defaultFirstLang = (dirs.indexOf('enja') >= 0 && dirs.indexOf('jaen') < 0) ? 'en' : 'ja';

    return (words || []).map(function (wordObj) {
      window.vocabCanonicalizeWordObj(wordObj);
      const word = window.vocabNorm(wordObj['英単語・熟語の表現']);
      const meanings = window.vocabGetMeanings(wordObj);
      const meaning = meanings.length ? meanings[0].meaning : '';
      const chunk = window.vocabGetChunkMaterial(wordObj);
      const ex = window.vocabGetExampleMaterial(wordObj);
      const unregistered = unreg_();
      const phraseEn = chunk.enFull !== unregistered
        ? (highlightBracket_(chunk.enFull) || highlightWord_(chunk.enFull, word))
        : '';
      const exEn = ex.enFull !== unregistered
        ? (highlightBracket_(ex.enFull) || highlightWord_(ex.enFull, word))
        : '';
      return {
        id: wordObj['通し番号'],
        wordObj: wordObj,
        word: displayVocab_(wordObj['英単語・熟語の表現']),
        meaning: displayVocab_(meaning),
        phrase: phraseEn,
        phraseMeaning: displayVocab_(chunk.jaFull),
        example: exEn,
        exampleMeaning: displayVocab_(ex.jaFull),
        defaultContentType: defaultType,
        defaultFirstLang: defaultFirstLang
      };
    }).filter(function (item) {
      const hasWord = !!(item.word && item.meaning);
      const hasPhrase = !!(item.phrase && item.phraseMeaning);
      const hasExample = !!(item.example && item.exampleMeaning);
      return hasWord || hasPhrase || hasExample;
    });
  }

  /** ユーザーが 👍/😫 で明示登録したマーク（単語テスト結果画面・単語カード） */
  function getUserMarkCategory_(state) {
    const mark = state && state.User_Mark ? String(state.User_Mark) : '';
    if (mark === 'known') return 'known';
    if (mark === 'unknown') return 'unknown';
    return 'none';
  }

  function getWordState_(wordObj, bookName, sheetName) {
    if (!window.SrsModule || !window.ItemStateModule) return null;
    const wordId = window.SrsModule.buildWordId(bookName, sheetName, wordObj['通し番号']);
    return window.ItemStateModule.getState(wordId);
  }

  function recentWrongRank_(state) {
    if (!state) return -1;
    const wrong = parseInt(state.Total_Wrong, 10) || 0;
    if (!wrong) return -1;
    const bits = parseInt(state.Recent_Bits, 10) || 0;
    const last = parseInt(state.Last_Seen, 10) || 0;
    if (!last) return -1;
    for (let b = 0; b < 8; b++) {
      if (((bits >> b) & 1) === 0) {
        return last - b;
      }
    }
    return last;
  }

  function matchesMarkFilters_(category, target) {
    const flags = {
      known: !!target.markKnown,
      unknown: !!target.markUnknown,
      none: !!target.markNone
    };
    if (!flags.known && !flags.unknown && !flags.none) return false;
    if (category === 'known' && flags.known) return true;
    if (category === 'unknown' && flags.unknown) return true;
    if (category === 'none' && flags.none) return true;
    return false;
  }

  function pickWordsByTarget_(words, bookName, sheetName, target) {
    target = target || {};
    const source = target.source || 'quiz';
    let list = (words || []).slice();

    if (source === 'mark') {
      const mode = target.markMode === 'include' ? 'include' : 'exclude';
      list = list.filter(function (w) {
        const st = getWordState_(w, bookName, sheetName);
        const cat = getUserMarkCategory_(st);
        const hit = matchesMarkFilters_(cat, target);
        return mode === 'include' ? hit : !hit;
      });
      return list;
    }

    const strategy = target.quizStrategy || 'recentWrong';
    if (strategy === 'unseen') {
      list = list.filter(function (w) {
        const st = getWordState_(w, bookName, sheetName);
        return !st || (parseInt(st.Total_Attempts, 10) || 0) === 0;
      });
      list.sort(function () { return Math.random() - 0.5; });
      return list;
    }

    if (strategy === 'historicalWrong') {
      list = list.filter(function (w) {
        const st = getWordState_(w, bookName, sheetName);
        return st && (parseInt(st.Total_Wrong, 10) || 0) > 0;
      });
      list.sort(function (a, b) {
        const sa = getWordState_(a, bookName, sheetName) || {};
        const sb = getWordState_(b, bookName, sheetName) || {};
        const wa = parseInt(sa.Total_Wrong, 10) || 0;
        const wb = parseInt(sb.Total_Wrong, 10) || 0;
        const ta = parseInt(sa.Total_Attempts, 10) || 0;
        const tb = parseInt(sb.Total_Attempts, 10) || 0;
        const ra = ta > 0 ? wa / ta : 0;
        const rb = tb > 0 ? wb / tb : 0;
        if (rb !== ra) return rb - ra;
        if (wb !== wa) return wb - wa;
        return Math.random() - 0.5;
      });
      return list;
    }

    // recentWrong
    list = list.filter(function (w) {
      return recentWrongRank_(getWordState_(w, bookName, sheetName)) >= 0;
    });
    list.sort(function (a, b) {
      const ra = recentWrongRank_(getWordState_(a, bookName, sheetName));
      const rb = recentWrongRank_(getWordState_(b, bookName, sheetName));
      if (rb !== ra) return rb - ra;
      return Math.random() - 0.5;
    });
    return list;
  }

  function pickWordsForCard_(words, scope, bookName, sheetName, cardTarget) {
    if (scope === 'targeted') {
      return pickWordsByTarget_(words, bookName, sheetName, cardTarget);
    }
    return (words || []).slice();
  }

  async function loadWordsForCard_(options) {
    const bookType = (document.getElementById('vocab-book-type') || {}).value;
    if (bookType === 'user' && window.AuthGateService && window.AuthGateService.isValid()) {
      if (!window.UserVocabCacheModule) throw new Error('ユーザー単語キャッシュが未初期化です');
      const res = window.UserVocabCacheModule.getWordsForStart(options.sheetName, options.filters);
      if (res.status !== 'success') throw new Error(res.message || 'キャッシュがありません。「キャッシュ更新」を押してください。');
      window.UserVocabCacheModule.markStudied(options.sheetName).catch(function () {});
      return res.data.words || [];
    }
    const res = await window.PresetModule.getVocabWords(
      options.bookName, options.sheetName, JSON.stringify(options.filters || {}), true, false);
    if (res.status !== 'success') throw new Error(res.message || '単語取得失敗');
    return res.data.words || [];
  }

  function readSettings_() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const merged = Object.assign({}, DEFAULT_SETTINGS, parsed && typeof parsed === 'object' ? parsed : {});
      merged.intervalFrontBack = parseFloat(merged.intervalFrontBack) || DEFAULT_SETTINGS.intervalFrontBack;
      merged.intervalNextWord = parseFloat(merged.intervalNextWord) || DEFAULT_SETTINGS.intervalNextWord;
      return merged;
    } catch (e) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function hasSavedSettings_() {
    try { return !!localStorage.getItem(SETTINGS_KEY); } catch (e) { return false; }
  }

  function writeSettings_() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        contentType: settings.contentType,
        firstLang: settings.firstLang,
        shuffle: !!settings.shuffle,
        intervalFrontBack: settings.intervalFrontBack,
        intervalNextWord: settings.intervalNextWord
      }));
    } catch (e) {}
  }

  function el_(id) { return document.getElementById(id); }

  function initIntervalSelects_() {
    const sel1 = el_('vc-cfg-interval-fb');
    const sel2 = el_('vc-cfg-interval-nw');
    if (!sel1 || sel1.options.length) return;
    for (let sec = 0; sec <= 5.0; sec += 0.5) {
      const v = sec.toFixed(1);
      const o1 = new Option(v + ' 秒', v);
      const o2 = new Option(v + ' 秒', v);
      if (sec === 1.0) { o1.selected = true; o2.selected = true; }
      sel1.add(o1);
      sel2.add(o2);
    }
    const typeSel = el_('vc-cfg-content-type');
    if (typeSel && !typeSel.options.length) {
      [['word', '単語'], ['phrase', '句 (フレーズ)'], ['example', '例文']].forEach(function (pair) {
        typeSel.add(new Option(pair[1], pair[0]));
      });
    }
  }

  function bindUiOnce_() {
    if (uiBound) return;
    uiBound = true;
    initIntervalSelects_();

    el_('vc-btn-mode-all').addEventListener('click', function () { setMode_('all'); });
    el_('vc-btn-mode-unknown').addEventListener('click', function () { setMode_('unknown'); });
    el_('vc-btn-mode-known').addEventListener('click', function () { setMode_('known'); });
    el_('vc-auto-play-btn').addEventListener('click', toggleAutoPlay_);
    el_('vc-settings-btn').addEventListener('click', openSettings_);
    el_('vc-back-btn').addEventListener('click', backToSettings);
    el_('vc-back-settings-btn').addEventListener('click', backToSettings);
    el_('vc-settings-close-btn').addEventListener('click', closeSettings_);
    el_('vc-settings-close-x').addEventListener('click', closeSettings_);
    el_('vc-prev-btn').addEventListener('click', function () { prevCard_(); });
    el_('vc-next-btn').addEventListener('click', function () { nextCard_(); });
    el_('vc-mark-known').addEventListener('click', function () { markCard_(true); });
    el_('vc-mark-unknown').addEventListener('click', function () { markCard_(false); });
    el_('vc-restart-unknown').addEventListener('click', function () { setMode_('unknown'); });
    el_('vc-restart-all').addEventListener('click', function () { setMode_('all'); });
    el_('vc-card-container').addEventListener('click', flipCard_);

    document.querySelectorAll('.vocab-card-content-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setContentType_(btn.getAttribute('data-vc-type'));
      });
    });

    ['vc-audio-front', 'vc-audio-back'].forEach(function (id) {
      const btn = el_(id);
      if (btn) btn.addEventListener('click', function (e) {
        e.stopPropagation();
        stopAutoPlay_();
        playAudioForSide_(el_('vc-flash-card').classList.contains('flipped'));
      });
    });

    ['vc-cfg-content-type', 'vc-cfg-first-lang', 'vc-cfg-shuffle',
      'vc-cfg-speech-en', 'vc-cfg-rate-en', 'vc-cfg-speech-ja', 'vc-cfg-rate-ja',
      'vc-cfg-interval-fb', 'vc-cfg-interval-nw'].forEach(function (id) {
      const node = el_(id);
      if (node) node.addEventListener('change', updateSettingsFromForm_);
      if (id.indexOf('rate') >= 0 && node) node.addEventListener('input', updateSettingsFromForm_);
    });

    let startX = 0;
    let startY = 0;
    const container = el_('vc-card-container');
    container.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    container.addEventListener('touchend', function (e) {
      const diffX = e.changedTouches[0].clientX - startX;
      const diffY = e.changedTouches[0].clientY - startY;
      if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX < 0) nextCard_();
        else prevCard_();
      }
    }, { passive: true });

    keyHandler = function (e) {
      if (!document.body.classList.contains('vocab-card-active')) return;
      if (el_('vc-completion-screen').style.display === 'flex') return;
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'Space') {
        e.preventDefault();
        flipCard_();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        prevCard_();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        nextCard_();
      }
    };
    document.addEventListener('keydown', keyHandler);
  }

  function stripTags_(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }

  function speakPromise_(htmlText, lang) {
    return new Promise(function (resolve) {
      if (!window.TtsModule || typeof window.TtsModule.speakText !== 'function') {
        resolve();
        return;
      }
      const langCode = lang === 'ja-JP' ? 'ja-JP' : (window.TtsModule.load().locale || 'en-US');
      window.TtsModule.speakText(stripTags_(htmlText), langCode).then(resolve).catch(resolve);
    });
  }

  function delay_(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function getContentData_(item) {
    if (settings.contentType === 'phrase') return { en: item.phrase, ja: item.phraseMeaning };
    if (settings.contentType === 'example') return { en: item.example, ja: item.exampleMeaning };
    return { en: item.word, ja: item.meaning };
  }

  function playAudioForSide_(isBack) {
    if (!activeList[currentIndex]) return Promise.resolve();
    const item = activeList[currentIndex];
    const content = getContentData_(item);
    const isEnOnFront = settings.firstLang === 'en';
    if (!isBack) {
      return isEnOnFront
        ? speakPromise_(content.en, 'en-US')
        : speakPromise_(content.ja, 'ja-JP');
    }
    return isEnOnFront
      ? speakPromise_(content.ja, 'ja-JP')
      : speakPromise_(content.en, 'en-US');
  }

  function flipCard_() {
    stopAutoPlay_();
    const card = el_('vc-flash-card');
    const isFlipped = card.classList.toggle('flipped');
    playAudioForSide_(isFlipped);
  }

  function updateModeButtons_() {
    el_('vc-btn-mode-all').textContent = '全 (' + allItems.length + ')';
    el_('vc-btn-mode-unknown').textContent = '😫 (' + unknownIds.size + ')';
    el_('vc-btn-mode-known').textContent = '👍 (' + knownIds.size + ')';
    document.querySelectorAll('.vocab-card-mode-btn').forEach(function (btn) { btn.classList.remove('active'); });
    if (currentMode === 'all') el_('vc-btn-mode-all').classList.add('active');
    if (currentMode === 'unknown') el_('vc-btn-mode-unknown').classList.add('active');
    if (currentMode === 'known') el_('vc-btn-mode-known').classList.add('active');
  }

  function updateCardUI_() {
    if (currentIndex >= activeList.length) {
      showCompletion_();
      return;
    }

    el_('vc-completion-screen').style.display = 'none';
    el_('vc-card-container').style.display = 'block';
    el_('vc-action-btns').style.display = 'flex';
    el_('vc-nav-btns').style.display = 'flex';
    el_('vc-status-bar').style.display = 'flex';

    const item = activeList[currentIndex];
    const content = getContentData_(item);
    const isEnOnFront = settings.firstLang === 'en';
    el_('vc-front-text').innerHTML = isEnOnFront ? (content.en || '—') : (content.ja || '—');
    el_('vc-front-lang').textContent = isEnOnFront ? '英語' : '日本語';
    el_('vc-back-text').innerHTML = isEnOnFront ? (content.ja || '—') : (content.en || '—');
    el_('vc-back-lang').textContent = isEnOnFront ? '日本語' : '英語';
    el_('vc-card-progress').textContent = (currentIndex + 1) + ' / ' + activeList.length;
    el_('vc-score-tracker').textContent = '👍 ' + knownIds.size + ' | 😫 ' + unknownIds.size;
    el_('vc-prev-btn').disabled = currentIndex === 0;
    el_('vc-next-btn').disabled = currentIndex === activeList.length - 1;

    const card = el_('vc-flash-card');
    card.style.transition = 'none';
    card.classList.remove('flipped', 'swipe-left', 'swipe-right');
    requestAnimationFrame(function () { card.style.transition = ''; });
  }

  function applyModeAndShuffle_() {
    let list = allItems.slice();
    if (currentMode === 'unknown') list = list.filter(function (w) { return unknownIds.has(w.id); });
    else if (currentMode === 'known') list = list.filter(function (w) { return knownIds.has(w.id); });
    if (settings.shuffle) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = list[i];
        list[i] = list[j];
        list[j] = t;
      }
    }
    activeList = list;
    currentIndex = 0;
    updateModeButtons_();
    updateCardUI_();
  }

  function setMode_(mode) {
    stopAutoPlay_();
    if (el_('vc-completion-screen').style.display === 'flex') {
      resultsCommitted = false;
    }
    currentMode = mode;
    applyModeAndShuffle_();
    if (!activeList.length) {
      alert('該当する単語がありません。');
      setMode_('all');
    }
  }

  function setContentType_(type) {
    stopAutoPlay_();
    settings.contentType = type;
    document.querySelectorAll('.vocab-card-content-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-vc-type') === type);
    });
    if (el_('vc-cfg-content-type')) el_('vc-cfg-content-type').value = type;
    writeSettings_();
    updateCardUI_();
  }

  function prevCard_() {
    stopAutoPlay_();
    if (currentIndex > 0) { currentIndex--; updateCardUI_(); }
  }

  function nextCard_() {
    stopAutoPlay_();
    if (currentIndex < activeList.length - 1) { currentIndex++; updateCardUI_(); }
  }

  function markCard_(isKnown) {
    stopAutoPlay_();
    if (currentIndex >= activeList.length) return;
    const currentItem = activeList[currentIndex];
    const card = el_('vc-flash-card');
    marks[currentItem.id] = isKnown;
    if (isKnown) {
      knownIds.add(currentItem.id);
      unknownIds.delete(currentItem.id);
      card.classList.add('swipe-right');
    } else {
      unknownIds.add(currentItem.id);
      knownIds.delete(currentItem.id);
      card.classList.add('swipe-left');
    }
    updateModeButtons_();
    setTimeout(function () { currentIndex++; updateCardUI_(); }, 150);
  }

  async function commitResults_() {
    if (resultsCommitted || !sessionMeta) return;
    resultsCommitted = true;
    const bookName = sessionMeta.bookName;
    const sheetName = sessionMeta.sheetName;
    if (window.SrsModule) {
      Object.keys(marks).forEach(function (id) {
        const isKnown = marks[id];
        const wordId = window.SrsModule.buildWordId(bookName, sheetName, id);
        window.SrsModule.update(wordId, !!isKnown, 0, !isKnown);
        if (window.ItemStateModule) {
          window.ItemStateModule.patchState(wordId, { User_Mark: isKnown ? 'known' : 'unknown' });
        }
      });
    }
    if (typeof window.applyVocabCardSessionScore_ === 'function') {
      window.applyVocabCardSessionScore_(knownIds.size, allItems.length);
    }
    if (typeof saveSessionResultsUnified === 'function' && window.AuthGateService && window.AuthGateService.isValid()) {
      try {
        await saveSessionResultsUnified('vocab', sessionMeta.setName);
      } catch (e) {
        console.warn('単語カード結果の保存:', e.message || e);
      }
    } else if (window.ItemStateModule) {
      window.ItemStateModule.syncToServer().catch(function (e) {
        console.warn('学習状態の同期:', e.message || e);
      });
    }
  }

  function showCompletion_() {
    stopAutoPlay_();
    el_('vc-card-container').style.display = 'none';
    el_('vc-action-btns').style.display = 'none';
    el_('vc-nav-btns').style.display = 'none';
    el_('vc-status-bar').style.display = 'none';
    el_('vc-completion-screen').style.display = 'flex';
    el_('vc-result-summary').innerHTML =
      '学習完了！<br>👍 覚えた: <b>' + knownIds.size + '</b> 個<br>😫 まだ: <b>' + unknownIds.size + '</b> 個';
    commitResults_();
  }

  function stopAutoPlay_() {
    isAutoPlaying = false;
    autoPlayToken++;
    if (window.TtsModule && typeof window.TtsModule.stop === 'function') window.TtsModule.stop();
    const btn = el_('vc-auto-play-btn');
    if (btn) {
      btn.textContent = '▶';
      btn.classList.remove('playing');
    }
  }

  async function startAutoPlay_() {
    isAutoPlaying = true;
    const btn = el_('vc-auto-play-btn');
    btn.textContent = '⏸';
    btn.classList.add('playing');
    const token = ++autoPlayToken;
    const card = el_('vc-flash-card');

    while (isAutoPlaying && currentIndex < activeList.length && autoPlayToken === token) {
      card.classList.remove('flipped');
      await playAudioForSide_(false);
      if (!isAutoPlaying || autoPlayToken !== token) break;
      await delay_(settings.intervalFrontBack * 1000);
      if (!isAutoPlaying || autoPlayToken !== token) break;
      card.classList.add('flipped');
      await playAudioForSide_(true);
      if (!isAutoPlaying || autoPlayToken !== token) break;
      await delay_(settings.intervalNextWord * 1000);
      if (!isAutoPlaying || autoPlayToken !== token) break;
      currentIndex++;
      updateCardUI_();
    }
    stopAutoPlay_();
  }

  function toggleAutoPlay_() {
    if (isAutoPlaying) stopAutoPlay_();
    else startAutoPlay_();
  }

  function openSettings_() {
    stopAutoPlay_();
    syncSettingsToForm_();
    el_('vc-settings-modal').style.display = 'flex';
  }

  function closeSettings_() {
    el_('vc-settings-modal').style.display = 'none';
  }

  function syncSettingsToForm_() {
    if (el_('vc-cfg-content-type')) el_('vc-cfg-content-type').value = settings.contentType;
    if (el_('vc-cfg-first-lang')) el_('vc-cfg-first-lang').value = settings.firstLang;
    if (el_('vc-cfg-shuffle')) el_('vc-cfg-shuffle').checked = !!settings.shuffle;
    if (window.TtsModule && typeof window.TtsModule.syncVocabCardTtsForm_ === 'function') {
      window.TtsModule.syncVocabCardTtsForm_();
    }
    if (el_('vc-cfg-interval-fb')) el_('vc-cfg-interval-fb').value = String(settings.intervalFrontBack);
    if (el_('vc-cfg-interval-nw')) el_('vc-cfg-interval-nw').value = String(settings.intervalNextWord);
  }

  function updateSettingsFromForm_() {
    const newType = el_('vc-cfg-content-type').value;
    if (settings.contentType !== newType) setContentType_(newType);
    settings.firstLang = el_('vc-cfg-first-lang').value;
    const newShuffle = el_('vc-cfg-shuffle').checked;
    const shuffleChanged = settings.shuffle !== newShuffle;
    settings.shuffle = newShuffle;
    if (window.TtsModule && typeof window.TtsModule.save === 'function' && typeof window.TtsModule.readTtsForm_ === 'function') {
      window.TtsModule.save(window.TtsModule.readTtsForm_('vc'));
    }
    settings.intervalFrontBack = parseFloat(el_('vc-cfg-interval-fb').value) || 1;
    settings.intervalNextWord = parseFloat(el_('vc-cfg-interval-nw').value) || 1;
    writeSettings_();
    if (shuffleChanged) {
      applyModeAndShuffle_();
    } else {
      updateCardUI_();
    }
  }

  function showScreen_() {
    document.body.classList.add('vocab-card-active');
    el_('vocab-card-screen').style.display = 'flex';
    el_('vocab-card-screen').setAttribute('aria-hidden', 'false');
    const settingsScreen = document.getElementById('settings-screen');
    if (settingsScreen) settingsScreen.style.display = 'none';
    const rs = document.getElementById('result-screen');
    if (rs) rs.style.display = 'none';
    const gs = document.getElementById('game-screen');
    if (gs) gs.style.display = 'none';
  }

  function hideScreen_() {
    stopAutoPlay_();
    document.body.classList.remove('vocab-card-active');
    el_('vocab-card-screen').style.display = 'none';
    el_('vocab-card-screen').setAttribute('aria-hidden', 'true');
    closeSettings_();
  }

  function startSession(meta) {
    bindUiOnce_();
    settings = readSettings_();
    sessionMeta = meta;
    allItems = meta.cardItems || [];
    knownIds = new Set();
    unknownIds = new Set();
    marks = {};
    currentMode = 'all';
    currentIndex = 0;
    resultsCommitted = false;

    if (!hasSavedSettings_()) {
      if (meta.defaultContentType) settings.contentType = meta.defaultContentType;
      if (meta.defaultFirstLang) settings.firstLang = meta.defaultFirstLang;
      writeSettings_();
    }

    if (window.SrsModule && window.ItemStateModule) {
      window.ItemStateModule.syncFromServer('').catch(function () {});
    }

    if (typeof window.applyVocabCardSessionGlobals_ === 'function') {
      window.applyVocabCardSessionGlobals_(meta);
    }

    document.querySelectorAll('.vocab-card-content-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-vc-type') === settings.contentType);
    });
    if (el_('vc-cfg-content-type')) el_('vc-cfg-content-type').value = settings.contentType;
    if (el_('vc-cfg-first-lang')) el_('vc-cfg-first-lang').value = settings.firstLang;
    if (el_('vc-cfg-shuffle')) el_('vc-cfg-shuffle').checked = !!settings.shuffle;
    if (window.TtsModule && typeof window.TtsModule.syncVocabCardTtsForm_ === 'function') {
      window.TtsModule.syncVocabCardTtsForm_();
    }

    applyModeAndShuffle_();
    showScreen_();
  }

  function backToSettings() {
    hideScreen_();
    const settingsScreen = document.getElementById('settings-screen');
    if (settingsScreen) settingsScreen.style.display = 'block';
    if (window.BackendSyncStatus) window.BackendSyncStatus.refresh();
  }

  function countPreview_(words, bookName, sheetName, cardTarget) {
    const pickedAll = pickWordsForCard_(words, 'all', bookName, sheetName);
    const pickedTarget = pickWordsForCard_(words, 'targeted', bookName, sheetName, cardTarget);
    const previewAxes = { axes: { grains: ['WD', 'PH', 'EX'], directions: ['jaen', 'enja'] } };
    return {
      allCards: buildCardItemsFromWords_(pickedAll, previewAxes).length,
      unmasteredCards: buildCardItemsFromWords_(pickedTarget, previewAxes).length
    };
  }

  async function previewDivisionCounts(options) {
    if (!options || !options.bookName || !options.sheetName) return null;
    const words = await loadWordsForCard_(options);
    return countPreview_(words, options.bookName, options.sheetName, options.cardTarget);
  }

  async function loadAndStart(options, scope) {
    scope = scope || 'all';
    if (scope === 'targeted' && window.ItemStateModule) {
      await window.ItemStateModule.syncFromServer('').catch(function () {});
    }
    const words = await loadWordsForCard_(options);
    if (!words.length) throw new Error('条件に合う単語がありません。');
    const picked = pickWordsForCard_(words, scope, options.bookName, options.sheetName, options.cardTarget);
    if (!picked.length) {
      throw new Error(scope === 'targeted'
        ? '条件に合う特定語がありません。選び方やチェックを見直してください。'
        : '条件に合う単語がありません。');
    }
    const cardItems = buildCardItemsFromWords_(picked, options);
    if (!cardItems.length) throw new Error('カードにできる単語がありません（語・句・例文のデータを確認してください）。');
    const bookType = (document.getElementById('vocab-book-type') || {}).value;
    startSession({
      cardItems: cardItems,
      bookName: options.bookName,
      sheetName: options.sheetName,
      setName: options.bookName + ' / ' + options.sheetName,
      isPreset: bookType === 'preset',
      defaultContentType: cardItems[0].defaultContentType,
      defaultFirstLang: cardItems[0].defaultFirstLang
    });
  }

  function syncHomeworkUi_(homework) {
    ['vocab-card-start-targeted-btn', 'vocab-card-start-all-btn'].forEach(function (id) {
      const btn = el_(id);
      if (!btn) return;
      btn.disabled = !!homework;
      btn.title = homework ? '宿題・小テストモードでは利用できません' : '';
      btn.style.opacity = homework ? '0.5' : '';
    });
    const panel = el_('vocab-card-target-panel');
    if (panel) panel.style.opacity = homework ? '0.5' : '';
  }

  return {
    loadAndStart: loadAndStart,
    previewDivisionCounts: previewDivisionCounts,
    startSession: startSession,
    backToSettings: backToSettings,
    syncHomeworkUi_: syncHomeworkUi_
  };
})();

window.VocabCardModule = VocabCardModule;
