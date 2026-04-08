// keyboard.js
// ソフトウェアキーボードと不足語入力関連ロジック

const KeyboardModule = (() => {
  const missDisplay = document.getElementById('missing-word-display');
  const createBtn = document.getElementById('create-card-btn');
  const kbContainer = document.getElementById('keyboard-container');
  
  let currentInput = "";
  let shiftState = 0;
  let lastShiftClickTime = 0;

  const keyLayout = {
    normal: [
      ["!", "\"", "$", "%", "&", "'", "(", ")", "-", "¥"],
      ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
      ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
      ["Shift", "z", "x", "c", "v", "b", "n", "m", "Back"],
      ["Space", "Enter"]
    ],
    shifted: [
      ["!", "\"", "$", "%", "&", "'", "(", ")", "-", "¥"],
      ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
      ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
      ["Shift", "Z", "X", "C", "V", "B", "N", "M", "Back"],
      ["Space", "Enter"]
    ]
  };

  function renderKeyboard() {
    kbContainer.innerHTML = ''; 
    const rows = (shiftState > 0) ? keyLayout.shifted : keyLayout.normal;

    rows.forEach((row) => {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'keyboard-row';
      
      row.forEach(key => {
        const keyBtn = document.createElement('button');
        keyBtn.className = 'key';
        
        if (key === "Back") keyBtn.textContent = "⌫";
        else if (key === "Space") keyBtn.textContent = "空白"; 
        else keyBtn.textContent = key;

        if (key === "Shift") {
          keyBtn.classList.add('wide');
          if (shiftState === 1) keyBtn.classList.add('activated');
          if (shiftState === 2) keyBtn.innerHTML = '⬆️<span style="font-size:0.6em">LOCK</span>';
        }
        if (key === "Back") keyBtn.classList.add('wide');
        if (key === "Space") keyBtn.classList.add('space');
        if (key === "Enter") keyBtn.classList.add('enter');

        keyBtn.addEventListener('pointerdown', (e) => {
          e.preventDefault(); 
          handleKeyPress(key);
        });

        rowDiv.appendChild(keyBtn);
      });
      kbContainer.appendChild(rowDiv);
    });
  }

  function handleKeyPress(key) {
    if (key === "Shift") {
      handleShiftLogic();
    } else if (key === "Back") {
      currentInput = currentInput.slice(0, -1);
    } else if (key === "Space") {
      currentInput += " ";
    } else if (key === "Enter") {
      if(currentInput.length > 0) {
        createBtn.click();
      }
      return; 
    } else {
      currentInput += key;
      if (shiftState === 1) shiftState = 0;
    }
    updateInputDisplay();
    renderKeyboard(); 
  }

  function updateInputDisplay() {
    missDisplay.textContent = currentInput;
    createBtn.disabled = (currentInput.length === 0);
  }

  function handleShiftLogic() {
    const now = Date.now();
    const timeDiff = now - lastShiftClickTime;
    if (timeDiff < 300) shiftState = 2;
    else shiftState = (shiftState === 0) ? 1 : 0;
    lastShiftClickTime = now;
  }

  missDisplay.addEventListener('click', () => {
    kbContainer.style.display = 'block';
  });

  document.body.addEventListener('click', (e) => {
    if (e.target.closest('#missing-word-input-area') || e.target.closest('#keyboard-container')) {
      return; 
    }
    kbContainer.style.display = 'none';
  });

  createBtn.addEventListener('click', () => {
    if (!currentInput) return;
    if (window.SortingModule) {
      window.SortingModule.createCard(currentInput, window.SortingModule.getPool());
      window.SortingModule.checkSubmitVisibility();
    }
    currentInput = "";
    updateInputDisplay();
    kbContainer.style.display = 'none'; 
  });

  window.addEventListener('keydown', (e) => {
    if (kbContainer.style.display === 'none') return;
    
    let pressedKey = e.key;
    e.preventDefault(); 

    if (pressedKey === "Backspace") pressedKey = "Back";
    if (pressedKey === "Shift") pressedKey = "Shift";
    if (pressedKey === " ") pressedKey = "Space";
    if (pressedKey === "Enter") pressedKey = "Enter";

    const allKeysNormal = keyLayout.normal.flat();
    const allKeysShifted = keyLayout.shifted.flat();
    
    if (allKeysNormal.includes(pressedKey) || allKeysShifted.includes(pressedKey)) {
      handleKeyPress(pressedKey);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    renderKeyboard();
  });

})();
