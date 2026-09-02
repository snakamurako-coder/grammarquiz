/**
 * 期間別復習単語セット（First_Seen バケット + 復習専用3連続正解卒業）
 */
const ReviewSetModule = (() => {
  const BUCKETS = [
    { id: 'first', label: '復習セット初回', minDays: null, maxDays: null, isFirst: true },
    { id: '1day', label: '復習セット1Day', minDays: 1, maxDays: 6 },
    { id: '1week', label: '復習セット1Week', minDays: 7, maxDays: 29 },
    { id: '1month', label: '復習セット1Month', minDays: 30, maxDays: 89 },
    { id: '3month', label: '復習セット3Month', minDays: 90, maxDays: 179 },
    { id: 'midyear', label: '復習セットMid-Year', minDays: 180, maxDays: 364 },
    { id: '1year', label: '復習セット1Year', minDays: 365, maxDays: null }
  ];

  function getBucketById_(id) {
    for (let i = 0; i < BUCKETS.length; i++) {
      if (BUCKETS[i].id === id) return BUCKETS[i];
    }
    return null;
  }

  function getBucketLabel_(id) {
    const b = getBucketById_(id);
    return b ? b.label : id || '';
  }

  function isReviewCleared_(state) {
    return (parseInt(state && state.Review_Clear, 10) || 0) === 1;
  }

  function ageDaysSinceFirstSeen_(state, nowSec) {
    const first = parseInt(state && state.First_Seen, 10) || 0;
    if (!first) return null;
    return Math.floor((nowSec - first) / 86400);
  }

  function classifyBucket(state, nowSec) {
    nowSec = nowSec || Math.floor(Date.now() / 1000);
    if (!state) return 'first';
    if (isReviewCleared_(state)) return null;
    const attempts = parseInt(state.Total_Attempts, 10) || 0;
    const firstSeen = parseInt(state.First_Seen, 10) || 0;
    if (attempts === 0 || !firstSeen) return 'first';

    const ageDays = ageDaysSinceFirstSeen_(state, nowSec);
    if (ageDays == null || ageDays < 1) return null;

    for (let i = 0; i < BUCKETS.length; i++) {
      const b = BUCKETS[i];
      if (b.isFirst) continue;
      const minOk = b.minDays == null || ageDays >= b.minDays;
      const maxOk = b.maxDays == null || ageDays <= b.maxDays;
      if (minOk && maxOk) return b.id;
    }
    return null;
  }

  function buildWordId_(bookName, sheetName, wordObj) {
    if (window.SrsModule && window.SrsModule.buildWordId) {
      return window.SrsModule.buildWordId(bookName, sheetName, wordObj['通し番号']);
    }
    return String(bookName) + '|' + String(sheetName) + '|' + String(wordObj['通し番号']);
  }

  function getStateForWord_(wordId) {
    if (!window.ItemStateModule) return null;
    return window.ItemStateModule.getState(wordId);
  }

  function resolveLimit_(options, poolLen) {
    if (!options || options.questionCount === 'all' || options.questionCount == null || options.questionCount === '') {
      return poolLen;
    }
    const n = parseInt(options.questionCount, 10);
    if (!n || n <= 0) return poolLen;
    return Math.min(n, poolLen);
  }

  function shuffle_(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function selectWords(words, bucketId, bookName, sheetName, options) {
    const bucket = getBucketById_(bucketId);
    if (!bucket || !words || !words.length) return [];

    const nowSec = Math.floor(Date.now() / 1000);
    const matched = [];

    words.forEach(function (wordObj) {
      const wordId = buildWordId_(bookName, sheetName, wordObj);
      const state = getStateForWord_(wordId);
      if (classifyBucket(state, nowSec) === bucketId) {
        matched.push({
          wordObj: wordObj,
          wordId: wordId,
          state: state || {}
        });
      }
    });

    if (bucketId === 'first') {
      shuffle_(matched);
    } else {
      matched.sort(function (a, b) {
        const sa = parseInt(a.state.Review_Streak, 10) || 0;
        const sb = parseInt(b.state.Review_Streak, 10) || 0;
        if (sa !== sb) return sa - sb;
        const fa = parseInt(a.state.First_Seen, 10) || 0;
        const fb = parseInt(b.state.First_Seen, 10) || 0;
        return fa - fb;
      });
    }

    return matched.map(function (m) { return m.wordObj; });
  }

  function countByBucket(words, bookName, sheetName) {
    const counts = {};
    BUCKETS.forEach(function (b) { counts[b.id] = 0; });
    if (!words || !words.length) return counts;

    const nowSec = Math.floor(Date.now() / 1000);
    words.forEach(function (wordObj) {
      const wordId = buildWordId_(bookName, sheetName, wordObj);
      const state = getStateForWord_(wordId);
      const bucketId = classifyBucket(state, nowSec);
      if (bucketId && counts[bucketId] != null) counts[bucketId]++;
    });
    return counts;
  }

  function recordAnswer(wordId, isCorrect, isUnknown) {
    if (!window.ItemStateModule || !wordId) return;
    const st = window.ItemStateModule.getState(wordId) || window.ItemStateModule.defaultState(wordId, 'vocab', '');
    let streak = parseInt(st.Review_Streak, 10) || 0;
    let cleared = parseInt(st.Review_Clear, 10) || 0;

    if (isCorrect && !isUnknown) {
      streak++;
      if (streak >= 3) {
        cleared = 1;
        streak = 0;
      }
    } else {
      streak = 0;
    }

    window.ItemStateModule.patchState(wordId, {
      Review_Streak: streak,
      Review_Clear: cleared
    });
  }

  return {
    BUCKETS: BUCKETS,
    getBucketLabel: getBucketLabel_,
    classifyBucket: classifyBucket,
    selectWords: selectWords,
    countByBucket: countByBucket,
    recordAnswer: recordAnswer
  };
})();

window.ReviewSetModule = ReviewSetModule;
