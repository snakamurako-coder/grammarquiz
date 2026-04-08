// sorting.js
// 並び替えと正誤判定

const SortingModule = (() => {
  const answerSlot = document.getElementById('answer-slot');
  const wordPool = document.getElementById('word-pool');
  const trashSlot = document.getElementById('trash-slot');
  const submitBtn = document.getElementById('submit-btn');
  const resultMsg = document.getElementById('result-msg');
  const moveAllBtn = document.getElementById('move-all-btn');
  
  let qData = null;

  function initGame(questionData) {
    qData = questionData;
    
    answerSlot.innerHTML = '';
    wordPool.innerHTML = '';
    trashSlot.innerHTML = '';
    resultMsg.textContent = '';
    
    let initialPool = [...qData.pool_words, ...qData.dummies];
    initialPool.sort(() => Math.random() - 0.5);
    initialPool.forEach(w => createCard(w, wordPool));
    
    checkSubmitVisibility();
  }

  function createCard(text, container) {
    const card = document.createElement('div');
    card.className = 'word-card'; 
    card.textContent = text;
    container.appendChild(card);
  }

  const sortOptions = { 
    group: 'shared', 
    animation: 150, 
    ghostClass: 'sortable-ghost', 
    onSort: checkSubmitVisibility 
  };
  
  // Init Sortable logic
  new Sortable(answerSlot, sortOptions);
  new Sortable(wordPool, sortOptions);
  new Sortable(trashSlot, sortOptions);

  function checkSubmitVisibility() {
    if (!qData) return;
    submitBtn.style.display = (answerSlot.children.length === qData.all_correct_words.length) ? 'block' : 'none';
    resultMsg.textContent = "";
  }

  moveAllBtn.addEventListener('click', () => {
    Array.from(wordPool.children).forEach(c => answerSlot.appendChild(c));
    checkSubmitVisibility();
  });

  submitBtn.addEventListener('click', () => {
    if (!qData) return;
    const userAnswer = Array.from(answerSlot.children).map(c => c.textContent).join(' ');
    if (userAnswer === qData.correct_answer) {
      resultMsg.textContent = "⭕️ 正解！"; 
      resultMsg.style.color = "#4caf50";
    } else {
      resultMsg.textContent = "❌ 惜しい！並び順や入力した語句を確認。"; 
      resultMsg.style.color = "#f44336";
    }
  });

  return {
    initGame,
    createCard,
    getPool: () => wordPool,
    checkSubmitVisibility
  };
})();

// エクスポート（グローバルスコープ）
window.SortingModule = SortingModule;
