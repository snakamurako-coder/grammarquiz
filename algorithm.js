// algorithm.js
// 出題アルゴリズム・成績記録モジュール

const AlgorithmModule = (() => {
  const STORAGE_KEY = 'brightstage_history';

  function getHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  }

  function saveHistory(historyObj) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(historyObj));
    } catch (e) {}
  }

  function recordResult(questionId, isCorrect) {
    const history = getHistory();
    if (!history[questionId]) {
      history[questionId] = { correct: 0, incorrect: 0, lastPlayed: 0 };
    }
    if (isCorrect) {
      history[questionId].correct += 1;
    } else {
      history[questionId].incorrect += 1;
    }
    history[questionId].lastPlayed = Date.now();
    saveHistory(history);
  }

  function buildQuestionSet(allQuestions, mode) {
    if (!allQuestions || allQuestions.length === 0) return [];
    
    let pool = [...allQuestions];
    const history = getHistory();

    if (mode === "normal") {
      return pool;
    }

    if (mode === "random10") {
      pool.sort(() => Math.random() - 0.5);
      return pool.slice(0, 10);
    }

    if (mode === "weakness") {
      pool.sort((a, b) => {
        const ha = history[a.id] || { correct: 0, incorrect: 0, lastPlayed: 0 };
        const hb = history[b.id] || { correct: 0, incorrect: 0, lastPlayed: 0 };
        const errorRateA = ha.incorrect > 0 ? (ha.incorrect / (ha.correct + ha.incorrect)) : -1;
        const errorRateB = hb.incorrect > 0 ? (hb.incorrect / (hb.correct + hb.incorrect)) : -1;
        
        if (errorRateA !== errorRateB) {
           return errorRateB - errorRateA; // エラー率が高い順
        }
        return Math.random() - 0.5;
      });
      return pool.slice(0, 10);
    }

    if (mode === "unseen") {
      pool.sort((a, b) => {
        const ha = history[a.id] || { correct: 0, incorrect: 0, lastPlayed: 0 };
        const hb = history[b.id] || { correct: 0, incorrect: 0, lastPlayed: 0 };
        const playsA = ha.correct + ha.incorrect;
        const playsB = hb.correct + hb.incorrect;
        
        if (playsA !== playsB) {
          return playsA - playsB; // 取組回数少ない順
        }
        return ha.lastPlayed - hb.lastPlayed; // 日時が古い順
      });
      return pool.slice(0, 10);
    }

    return pool; 
  }

  return {
    recordResult,
    buildQuestionSet
  };
})();

window.AlgorithmModule = AlgorithmModule;
