// app.js
// データと画面遷移の管理

const API_URL = "https://script.google.com/macros/s/AKfycbxekok6FhAiXnkCfCKo5iCS9YMeoKIVdUARbzaRG94bOVVQEKcxsStegXvVSevrQ_-A/exec";
let currentQuestionDataList = [];
let currentQuestionIndex = 0;
let totalQuestionsCount = 0;
let currentScore = 0;
let sessionResults = [];
let currentUserId = "Guest";

// GASへ送信するテキスト値
const unitData = { 
  "中学1年 英語": ["単元A", "単元B", "be動詞", "一般動詞"], 
  "中学2年 英語": ["単元A", "単元B", "過去形", "助動詞"] 
};

// UI要素
const screens = {
  login: document.getElementById('login-screen'),
  settings: document.getElementById('settings-screen'),
  game: document.getElementById('game-screen')
};
const elements = {
  subject: document.getElementById('subject-select'),
  units: document.getElementById('unit-container'),
  startBtn: document.getElementById('start-btn'),
  backBtn: document.getElementById('back-btn'),
  qJa: document.getElementById('question-ja'),
  prefix: document.getElementById('prefix-text'),
  suffix: document.getElementById('suffix-text')
};

// セレクトボックスの表示テキスト（実際のスプレッドシート名として使われるもの）を取得
function getSelectedSubjectName() {
  const select = elements.subject;
  return select.options[select.selectedIndex].text;
}

function renderUnits(subjectText) {
  elements.units.innerHTML = '';
  // フォールバック付きで単元リストを取得
  const units = unitData[subjectText] || ["単元A", "単元B"];
  
  units.forEach(unit => {
    const lbl = document.createElement('label');
    lbl.className = 'unit-card selected';
    lbl.innerHTML = `<input type="checkbox" value="${unit}" checked style="display:none;"> ${unit}`;
    lbl.querySelector('input').addEventListener('change', e => {
      lbl.classList.toggle('selected', e.target.checked);
    });
    elements.units.appendChild(lbl);
  });
}

elements.subject.addEventListener('change', e => {
  renderUnits(getSelectedSubjectName());
});

elements.startBtn.addEventListener('click', async () => {
  const subjectName = getSelectedSubjectName();
  const checkedUnits = Array.from(elements.units.querySelectorAll('input:checked')).map(el => el.value);
  
  if (checkedUnits.length === 0) {
    alert("単元を1つ以上選択してください。");
    return;
  }

  // ユーザー名の保存・取得
  const unInput = document.getElementById('username-input');
  if (unInput && unInput.value.trim() !== '') {
    currentUserId = unInput.value.trim();
    localStorage.setItem('brightstage_username', currentUserId);
  } else {
    currentUserId = localStorage.getItem('brightstage_username') || "Guest";
    if (unInput && currentUserId !== "Guest") unInput.value = currentUserId;
  }
  
  sessionResults = [];
  
  // UX：ロード中の表現
  elements.startBtn.disabled = true;
  const originalText = elements.startBtn.textContent;
  elements.startBtn.textContent = "問題を読み込み中...";

  try {
    const unitParam = checkedUnits.join(",");
    const rawQuestions = await fetchQuestionsFromGAS(subjectName, unitParam);
    const mode = document.querySelector('input[name="play-mode"]:checked').value;
    
    // アルゴリズムモジュールを通す
    const questions = window.AlgorithmModule ? window.AlgorithmModule.buildQuestionSet(rawQuestions, mode) : rawQuestions;
    
    if (questions && questions.length > 0) {
      currentQuestionDataList = questions;
      totalQuestionsCount = questions.length;
      currentQuestionIndex = 0;
      currentScore = 0;
      loadQuestionToGame(currentQuestionDataList[currentQuestionIndex]);
      screens.settings.style.display = 'none';
      document.getElementById('result-screen').style.display = 'none';
      screens.game.style.display = 'block';
    } else {
      alert("問題が見つからない、またはシートに有効なデータがありません。");
    }
  } catch (error) {
    console.error(error);
    alert("通信エラーが発生しました: " + error.message);
  } finally {
    elements.startBtn.disabled = false;
    elements.startBtn.textContent = originalText;
  }
});

elements.backBtn.addEventListener('click', () => {
  screens.game.style.display = 'none';
  screens.settings.style.display = 'block';
});

async function fetchQuestionsFromGAS(subject, unit) {
  const url = `${API_URL}?action=getQuestions&subject=${encodeURIComponent(subject)}&unit=${encodeURIComponent(unit)}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error("HTTP error " + response.status);
  }
  const result = await response.json();
  if (result.status === "success") {
    return result.data;
  } else {
    throw new Error(result.message);
  }
}

function loadQuestionToGame(qData) {
  elements.qJa.textContent = qData.japanese;
  
  // UIの初期化・非表示化
  document.getElementById('sort-ui').style.display = 'none';
  document.getElementById('choice-ui').style.display = 'none';
  document.getElementById('typing-ui').style.display = 'none';
  const missingWordArea = document.getElementById('missing-word-input-area');
  if (missingWordArea) missingWordArea.style.display = 'none';
  document.getElementById('result-msg').textContent = '';

  const format = qData.format || "並び替え";

  if (format.includes("4択") || format.includes("４択")) {
    // 4択問題
    document.getElementById('choice-ui').style.display = 'block';
    if (window.ChoiceModule) window.ChoiceModule.initGame(qData);
  } else if (format.includes("英訳") || format.includes("空所")) {
    // 和文英訳・空所入力
    document.getElementById('typing-ui').style.display = 'block';
    if (window.TypingModule) window.TypingModule.initGame(qData);
  } else {
    // 並び替え問題
    document.getElementById('sort-ui').style.display = 'block';
    if (missingWordArea) missingWordArea.style.display = 'flex';

    if (qData.sentence_template) {
      const match = qData.sentence_template.match(/[(\[（［<＜][^)\]）］>＞]*[)\]）］>＞]/);
      if (match) {
        elements.prefix.textContent = qData.sentence_template.substring(0, match.index).trim();
        elements.suffix.textContent = qData.sentence_template.substring(match.index + match[0].length).trim();
      } else {
        elements.prefix.textContent = qData.sentence_template;
        elements.suffix.textContent = "";
      }
    } else {
      elements.prefix.textContent = "";
      elements.suffix.textContent = "";
    }
    
    if (!document.getElementById('dummy-option').checked) {
      qData.dummies = [];
    }
    
    if (window.SortingModule) {
      window.SortingModule.initGame(qData);
    }
  }
}

// モジュールからのコールバック
window.onQuestionCompleted = (isCorrect) => {
  const currentQ = currentQuestionDataList[currentQuestionIndex];
  if (window.AlgorithmModule) {
    window.AlgorithmModule.recordResult(currentQ.id, isCorrect);
  }
  if (isCorrect) currentScore++;
  
  let modeDesc = "通常";
  const modeRadio = document.querySelector('input[name="play-mode"]:checked');
  if (modeRadio) modeDesc = modeRadio.value;
  
  sessionResults.push({
    timestamp: new Date().toISOString(),
    userId: currentUserId,
    questionId: currentQ.id,
    subject: elements.subject.options[elements.subject.selectedIndex].text,
    unit: currentQ.unit || "",
    isCorrect: isCorrect ? "正解" : "不正解",
    mode: modeDesc
  });
  
  document.getElementById('next-btn').style.display = 'block';
};

async function sendResultsToGAS() {
  if (sessionResults.length === 0) return;
  const payload = {
    action: "saveResult",
    results: sessionResults
  };
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log("Save Response:", data);
  } catch(e) {
    console.error("Save Error:", e);
  }
}

document.getElementById('next-btn').addEventListener('click', () => {
  document.getElementById('next-btn').style.display = 'none';
  currentQuestionIndex++;
  if (currentQuestionIndex < currentQuestionDataList.length) {
    loadQuestionToGame(currentQuestionDataList[currentQuestionIndex]);
  } else {
    showResultScreen();
  }
});

function showResultScreen() {
  screens.game.style.display = 'none';
  const resultScreen = document.getElementById('result-screen');
  resultScreen.style.display = 'block';
  
  document.getElementById('result-score').textContent = `スコア: ${currentScore} / ${totalQuestionsCount}`;
  document.getElementById('result-details').textContent = "成績データを保存しています...";
  
  sendResultsToGAS().then(() => {
    document.getElementById('result-details').textContent = "演習が終了し、成績が保存されました。";
  }).catch(() => {
    document.getElementById('result-details').textContent = "演習が終了しました。(一部通信エラーあり)";
  });
}

document.getElementById('return-settings-btn').addEventListener('click', () => {
  document.getElementById('result-screen').style.display = 'none';
  screens.settings.style.display = 'block';
});

// ======= Google認証 (Phase 6) =======
async function handleCredentialResponse(response) {
  const msgEl = document.getElementById('login-msg');
  msgEl.textContent = "認証中...";
  msgEl.style.color = "#555";
  
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "login",
        idToken: response.credential
      })
    });
    
    const data = await res.json();
    if (data.status === "success") {
      // 認証成功
      currentUserId = data.user.account; // whitelistのaccountとする
      
      const unInput = document.getElementById('username-input');
      if (unInput) unInput.value = currentUserId;
      localStorage.setItem('brightstage_username', currentUserId);
      
      screens.login.style.display = 'none';
      screens.settings.style.display = 'block';
      msgEl.textContent = "";
      
      renderUnits(getSelectedSubjectName());
    } else {
      msgEl.textContent = "エラー: " + data.message;
      msgEl.style.color = "#f44336";
    }
  } catch (error) {
    msgEl.textContent = "通信エラーが発生しました。";
    msgEl.style.color = "#f44336";
  }
}
window.handleCredentialResponse = handleCredentialResponse;

// 初期化実行
document.addEventListener('DOMContentLoaded', () => {
  // DOM読み込み直後はLogin画面を表示したまま待機。
  // GSIライブラリが自動でボタンを描画します。
});
