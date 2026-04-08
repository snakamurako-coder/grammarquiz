// app.js
// データと画面遷移の管理

const API_URL = "ここにGASのデプロイURLを後で設定します"; 
let currentQuestionData = null;

// モックデータ
const unitData = { "jhs1": ["be動詞", "一般動詞"], "jhs2": ["過去形", "助動詞"] };

// UI要素
const screens = { 
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

function renderUnits(subject) {
  elements.units.innerHTML = '';
  unitData[subject].forEach(unit => {
    const lbl = document.createElement('label');
    lbl.className = 'unit-card selected';
    lbl.innerHTML = `<input type="checkbox" value="${unit}" checked style="display:none;"> ${unit}`;
    lbl.querySelector('input').addEventListener('change', e => {
      lbl.classList.toggle('selected', e.target.checked);
    });
    elements.units.appendChild(lbl);
  });
}

elements.subject.addEventListener('change', e => renderUnits(e.target.value));

elements.startBtn.addEventListener('click', () => {
  loadMockQuestion();
  screens.settings.style.display = 'none';
  screens.game.style.display = 'block';
});

elements.backBtn.addEventListener('click', () => {
  screens.game.style.display = 'none';
  screens.settings.style.display = 'block';
});

function loadMockQuestion() {
  currentQuestionData = {
    japanese: "私が議長に最適だと思うのはジョンです。(欠損: think)",
    sentence_template: "I ＜並び替え入力箇所＞ is John.",
    correct_answer: "think the best person for chairperson",
    all_correct_words: ["think", "the", "best", "person", "for", "chairperson"],
    pool_words: ["chairperson", "person", "best", "the", "for"], // thinkが欠損
    dummies: document.getElementById('dummy-option').checked ? ["a"] : []
  };
  
  elements.qJa.textContent = currentQuestionData.japanese;
  const match = currentQuestionData.sentence_template.match(/[(\[（［<＜][^)\]）］>＞]*[)\]）］>＞]/);
  elements.prefix.textContent = match ? currentQuestionData.sentence_template.substring(0, match.index).trim() : "";
  elements.suffix.textContent = match ? currentQuestionData.sentence_template.substring(match.index + match[0].length).trim() : "";
  
  // Initialize sorting game state via sorting.js
  if (window.SortingModule) {
    window.SortingModule.initGame(currentQuestionData);
  }
}

// 初期化実行
document.addEventListener('DOMContentLoaded', () => {
  renderUnits(elements.subject.value);
});
