// typing.js
// 和文英訳・空所入力制御モジュール

const TypingModule = (() => {
  const container = document.getElementById('typing-sentence-container');
  const inputDisplay = document.getElementById('typing-input-display');
  const submitBtn = document.getElementById('typing-submit-btn');
  const resultMsg = document.getElementById('result-msg');
  
  let qData = null;

  document.body.addEventListener('click', (e) => {
    if (window.KeyboardModule && document.getElementById('typing-ui').style.display === 'block') {
      if (!e.target.closest('#typing-ui') && !e.target.closest('#keyboard-container')) {
        window.KeyboardModule.hide();
      }
    }
  });

  function initGame(questionData) {
    qData = questionData;
    container.innerHTML = '';
    resultMsg.textContent = '';
    inputDisplay.textContent = "タップして入力";
    submitBtn.style.display = 'none';

    if (qData.sentence_template) {
      container.textContent = qData.sentence_template;
    } else {
      container.textContent = "（訳を入力してください）";
    }

    if (window.KeyboardModule) {
      window.KeyboardModule.init(
        inputDisplay, 
        "", 
        (text) => {
           checkAnswer(text);
        }, 
        (text) => {
           if (text) {
             submitBtn.style.display = 'block';
           } else {
             submitBtn.style.display = 'none';
             if (inputDisplay.textContent === "") {
               inputDisplay.textContent = "タップして入力";
             }
           }
        }
      );

      inputDisplay.onclick = (e) => {
        window.KeyboardModule.show();
        if (inputDisplay.textContent === "タップして入力") {
          inputDisplay.textContent = "";
        }
        e.stopPropagation();
      };
    }
    
    submitBtn.onclick = () => {
       const text = inputDisplay.textContent;
       if (text && text !== "タップして入力") {
         checkAnswer(text);
       }
    };
  }

  function checkAnswer(userAnswer) {
    if (userAnswer.trim().toLowerCase() === qData.correct_answer.trim().toLowerCase()) {
      resultMsg.textContent = "⭕️ 正解！";
      resultMsg.style.color = "#4caf50";
      if(window.onQuestionCompleted) window.onQuestionCompleted(true);
    } else {
      resultMsg.textContent = "❌ 惜しい！ 正答: " + qData.correct_answer;
      resultMsg.style.color = "#f44336";
      if(window.onQuestionCompleted) window.onQuestionCompleted(false);
    }
    if (window.KeyboardModule) window.KeyboardModule.hide();
    submitBtn.style.display = 'none';
  }

  return { initGame };
})();

window.TypingModule = TypingModule;
