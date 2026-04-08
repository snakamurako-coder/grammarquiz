// choice.js
// 4択問題制御モジュール

const ChoiceModule = (() => {
  const container = document.getElementById('choice-sentence-container');
  const buttonsContainer = document.getElementById('choice-buttons-container');
  const resultMsg = document.getElementById('result-msg');
  
  let qData = null;

  function initGame(questionData) {
    qData = questionData;
    container.innerHTML = '';
    buttonsContainer.innerHTML = '';
    resultMsg.textContent = '';

    if (qData.sentence_template) {
      container.textContent = qData.sentence_template;
    } else {
      container.textContent = "";
    }

    let choices = [qData.correct_answer];
    
    // ダミー選出方法
    let dummiesToUse = [];
    if (qData.dummy_selection_method === "順番" || qData.dummy_selection_method === "sequential") {
       dummiesToUse = qData.dummies.slice(0, 3);
    } else {
       // 無作為
       let shuffled = [...qData.dummies].sort(() => Math.random() - 0.5);
       dummiesToUse = shuffled.slice(0, 3);
    }
    
    choices = choices.concat(dummiesToUse);
    choices.sort(() => Math.random() - 0.5);

    // 第5の選択肢
    choices.push("わからない・自信がない");

    choices.forEach((choiceText) => {
      if (!choiceText) return;
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = choiceText;
      
      if (choiceText === "わからない・自信がない") {
        btn.classList.add('unknown');
      }

      btn.onclick = () => handleChoice(choiceText, btn);
      buttonsContainer.appendChild(btn);
    });
  }

  function handleChoice(selectedText, btn) {
    if (resultMsg.textContent !== '') return;

    Array.from(buttonsContainer.children).forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    if (selectedText === qData.correct_answer) {
      resultMsg.textContent = "⭕️ 正解！";
      resultMsg.style.color = "#4caf50";
      if(window.onQuestionCompleted) window.onQuestionCompleted(true);
    } else if (selectedText === "わからない・自信がない") {
      resultMsg.textContent = "復習しましょう。正答: " + qData.correct_answer;
      resultMsg.style.color = "#ff9800";
      if(window.onQuestionCompleted) window.onQuestionCompleted(false);
    } else {
      resultMsg.textContent = "❌ 不正解...";
      resultMsg.style.color = "#f44336";
      if(window.onQuestionCompleted) window.onQuestionCompleted(false);
    }
  }

  return { initGame };
})();

window.ChoiceModule = ChoiceModule;
