// sorting.js
// 並び替えと正誤判定

const SortingModule = (() => {
  const answerSlot = document.getElementById('answer-slot');
  const wordPool = document.getElementById('word-pool');
  const trashSlot = document.getElementById('trash-slot');
  const submitBtn = document.getElementById('submit-btn');
  const resultMsg = document.getElementById('result-msg');
  const moveAllBtn = document.getElementById('move-all-btn');
  
  const missDisplay = document.getElementById('missing-word-display');
  const createCardBtn = document.getElementById('create-card-btn');
  const missingWordArea = document.getElementById('missing-word-input-area');
  
  let qData = null;

  document.body.addEventListener('click', (e) => {
    if (window.KeyboardModule && document.getElementById('sort-ui').style.display === 'block') {
      if (!e.target.closest('#missing-word-input-area') && !e.target.closest('#keyboard-container')) {
        window.KeyboardModule.hide();
      }
    }
  });

  function initGame(questionData) {
    qData = questionData;
    
    answerSlot.innerHTML = '';
    wordPool.innerHTML = '';
    trashSlot.innerHTML = '';
    resultMsg.textContent = '';
    
    let initialPool = [...qData.pool_words, ...qData.dummies];
    initialPool.sort(() => Math.random() - 0.5);
    initialPool.forEach(w => createCard(w, wordPool));
    
    // キーボード機能の初期化
    if (window.KeyboardModule) {
      window.KeyboardModule.init(
        missDisplay, 
        "", 
        (text) => {
           if (text) createCardAction(text);
        }, 
        (text) => {
           createCardBtn.disabled = (text.length === 0);
        }
      );
      
      missDisplay.onclick = (e) => {
        window.KeyboardModule.show();
        e.stopPropagation();
      };
      
      createCardBtn.onclick = () => {
         if (!createCardBtn.disabled) createCardAction(missDisplay.textContent);
      };
    }
    
    checkSubmitVisibility();
  }

  function createCardAction(text) {
    createCard(text, wordPool);
    checkSubmitVisibility();
    if(window.KeyboardModule) window.KeyboardModule.resetInput("");
    createCardBtn.disabled = true;
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
      submitBtn.style.display = 'none'; // 正解したら消す
      if(window.onQuestionCompleted) window.onQuestionCompleted(true);
    } else {
      resultMsg.textContent = "❌ 不正解...";
      resultMsg.style.color = "#f44336";
      if(window.onQuestionCompleted) window.onQuestionCompleted(false);
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
