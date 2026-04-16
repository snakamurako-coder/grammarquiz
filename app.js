// app.js
// データと画面遷移の管理

const API_URL = "https://script.google.com/macros/s/AKfycbxekok6FhAiXnkCfCKo5iCS9YMeoKIVdUARbzaRG94bOVVQEKcxsStegXvVSevrQ_-A/exec";
window.API_URL = API_URL;

let currentQuestionDataList = [];
let currentQuestionIndex = 0;
let totalQuestionsCount = 0;
let currentScore = 0;
let sessionResults = [];
let currentUserId = "Guest";
let sessionStartTime = null;

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
      sessionStartTime = Date.now();
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
  
  const user = window.AuthService && window.AuthService.currentUser ? window.AuthService.currentUser : {};
  
  sessionResults.push({
    timestamp: new Date().toISOString(),
    userId: currentUserId,
    userName: user.name || "",
    grade: user.grade || "",
    userClass: user.class || "",
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

async function sendSessionLogToGAS() {
  const timeTaken = sessionStartTime ? Math.round((Date.now() - sessionStartTime) / 1000) : 0;
  const correctRate = totalQuestionsCount > 0 ? Math.round((currentScore / totalQuestionsCount) * 100) : 0;
  const checkedUnits = Array.from(elements.units.querySelectorAll('input:checked')).map(el => el.value);
  const setName = `${getSelectedSubjectName()} - ${checkedUnits.join(',')}`;
  
  const payload = {
    action: "saveSessionLog",
    email: currentUserId,
    setName: setName,
    correctRate: correctRate,
    timeTaken: timeTaken
  };
  try {
    const res = await fetch(API_URL, { method: "POST", body: JSON.stringify(payload) });
    const data = await res.json();
    console.log("Session Log Response:", data);
  } catch(e) {
    console.error("Session Log Error:", e);
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
  
  Promise.all([sendResultsToGAS(), sendSessionLogToGAS()]).then(() => {
    document.getElementById('result-details').textContent = "演習が終了し、成績が保存されました。";
  }).catch(() => {
    document.getElementById('result-details').textContent = "演習が終了しました。(一部通信エラーあり)";
  });
}

document.getElementById('return-settings-btn').addEventListener('click', () => {
  document.getElementById('result-screen').style.display = 'none';
  screens.settings.style.display = 'block';
});

// ======= AuthService連携 =======
window.onLoginSuccess = function(user) {
  currentUserId = user.account;
  const unInput = document.getElementById('username-input');
  if (unInput) unInput.value = currentUserId;
  localStorage.setItem('brightstage_username', currentUserId);

  // プロフィールUIへの反映
  const elName = document.getElementById('profile-name');
  const elGrade = document.getElementById('profile-grade');
  const elClass = document.getElementById('profile-class');
  const elAccount = document.getElementById('profile-account');

  if(elName) elName.textContent = user.name || "未設定";
  if(elGrade) elGrade.textContent = user.grade || "未設定";
  if(elClass) elClass.textContent = user.class || "未設定";
  if(elAccount) elAccount.textContent = user.account || currentUserId;

  screens.login.style.display = 'none';
  screens.settings.style.display = 'block';
  
  renderUnits(getSelectedSubjectName());
  fetchUserLogs(currentUserId);
};

// ログ取得とマイページ描画
async function fetchUserLogs(email) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "getUserLogs", email: email })
    });
    const data = await res.json();
    if (data.status === "success") {
      renderMyPage(data.data);
    }
  } catch (e) {
    console.error("fetchUserLogs error:", e);
  }
}

function renderMyPage(logs) {
  const container = document.getElementById('mypage-container');
  if (container) container.style.display = 'block';
  
  if (!logs || logs.length === 0) {
    document.getElementById('recent-history-list').innerHTML = "<p>まだ学習記録がありません。</p>";
    document.getElementById('set-progress-list').innerHTML = "<p>まだ学習記録がありません。</p>";
    document.getElementById('weakness-list').innerHTML = "<p>まだ学習記録がありません。</p>";
    return;
  }

  // 1. 最近の学習履歴 (直近5件)
  const recentLogs = [...logs].reverse().slice(0, 5);
  let recentHtml = '';
  recentLogs.forEach(log => {
    const rate = parseInt(log['正答率']) || 0;
    const scoreClass = rate >= 80 ? 'score-perfect' : rate >= 60 ? 'score-good' : rate >= 40 ? 'score-warn' : 'score-poor';
    recentHtml += `
      <div class="log-item">
        <div>
          <div class="log-title">${log['学習セット名']}</div>
          <div class="log-meta">${log['タイムスタンプ']} - ${log['解答時間']}秒</div>
        </div>
        <div class="log-score ${scoreClass}">${rate}%</div>
      </div>
    `;
  });
  document.getElementById('recent-history-list').innerHTML = recentHtml;

  // 2. セット別進捗 & 弱点分析
  const setMap = {};
  logs.forEach(log => {
    const setName = log['学習セット名'];
    const rate = parseInt(log['正答率']) || 0;
    if (!setMap[setName]) {
      setMap[setName] = { playCount: 0, maxRate: 0, recentRate: rate };
    }
    setMap[setName].playCount++;
    if (rate > setMap[setName].maxRate) setMap[setName].maxRate = rate;
    setMap[setName].recentRate = rate; // keep last
  });

  let progressHtml = '';
  const weaknessList = [];
  
  for (const setName in setMap) {
    const stat = setMap[setName];
    const rate = stat.maxRate;
    const barColor = rate >= 80 ? '#4caf50' : rate >= 60 ? '#2196f3' : rate >= 40 ? '#ff9800' : '#f44336';
    
    progressHtml += `
      <div style="margin-bottom: 12px;">
        <div style="display:flex; justify-content:space-between; font-size: 0.9em; margin-bottom: 4px;">
          <strong>${setName}</strong>
          <span>最高 ${rate}% (計${stat.playCount}回)</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" style="width: ${rate}%; background-color: ${barColor};"></div>
        </div>
      </div>
    `;

    if (stat.recentRate < 60) {
      weaknessList.push({ name: setName, rate: stat.recentRate });
    }
  }
  document.getElementById('set-progress-list').innerHTML = progressHtml;

  let weaknessHtml = '';
  if (weaknessList.length > 0) {
    weaknessList.sort((a,b) => a.rate - b.rate);
    weaknessList.slice(0, 3).forEach(w => {
      weaknessHtml += `
        <div class="log-item" style="background-color: #fff8e1; border-left: 4px solid #f44336; padding: 10px; margin-bottom: 8px;">
          <div>
            <div class="log-title" style="color: #c62828;">${w.name}</div>
            <div class="log-meta">直近の正答率が <strong>${w.rate}%</strong> です！復習しましょう。</div>
          </div>
        </div>
      `;
    });
  } else {
    weaknessHtml = "<p>現在、目立った弱点はありません。すばらしい！</p>";
  }
  document.getElementById('weakness-list').innerHTML = weaknessHtml;
}

// ログアウト機能
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (window.AuthService) {
        window.AuthService.clearSession();
      }
      location.reload(); // ページをリロードしてログイン画面に戻す
    });
  }
});

// 初期化実行
document.addEventListener('DOMContentLoaded', () => {
  // 自動ログイン（セッション復元）の試行
  if (window.AuthService && window.AuthService.loadSession()) {
    console.log("前回ログインしたユーザー情報からセッションを復元中...", window.AuthService.currentUser);
    window.onLoginSuccess(window.AuthService.currentUser);
  } else {
    // セッションがない場合はLogin画面を表示したまま待機。
    // GSIライブラリが自動でボタンを描画します。
  }
});
