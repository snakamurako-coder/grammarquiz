// スプレッドシートを操作・返却するGASの基本構造（APIとして機能させる）

function doGet(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  const action = e.parameter.action;
  
  if (action === 'getQuestions') {
    try {
      const data = fetchQuestionsFromSheet(e.parameter);
      output.setContent(JSON.stringify({ status: "success", data: data }));
    } catch (error) {
      output.setContent(JSON.stringify({ status: "error", message: error.toString(), stack: error.stack }));
    }
  } else {
    output.setContent(JSON.stringify({ status: "error", message: "Invalid action" }));
  }
  
  return output;
}

function fetchQuestionsFromSheet(params) {
  const subject = params.subject; // 例： "中学1年 英語"
  const unit = params.unit;       // 例： "be動詞"

  if (!subject || !unit) {
    throw new Error("subject (学年・科目) と unit (単元名) のパラメータが必須です。");
  }

  let materialsFolder = null;

  try {
    // 実行スクリプトファイルの親フォルダを基準にmaterialsを探す
    const scriptId = ScriptApp.getScriptId();
    const scriptFile = DriveApp.getFileById(scriptId);
    const parents = scriptFile.getParents();
    if (parents.hasNext()) {
      const parentFolder = parents.next();
      const mFolders = parentFolder.getFoldersByName("materials");
      if (mFolders.hasNext()) materialsFolder = mFolders.next();
    }
  } catch (e) {
    // コンテナバインド等で失敗した場合はフォールバック
  }

  if (!materialsFolder) {
    // 全体からmaterialsフォルダを探して最初に見つかったものを利用
    const mFolders = DriveApp.getFoldersByName("materials");
    if (mFolders.hasNext()) {
      materialsFolder = mFolders.next();
    } else {
      throw new Error("materialsフォルダが見つかりません。");
    }
  }
  
  // 対象のブックを探す
  const files = materialsFolder.getFilesByName(subject);
  if (!files.hasNext()) {
    throw new Error("スプレッドシートが見つかりません: " + subject);
  }
  const spreadsheetFile = files.next();
  const ss = SpreadsheetApp.open(spreadsheetFile);
  
  const unitList = unit.split(',').map(u => u.trim());
  const questions = [];

  for (let u = 0; u < unitList.length; u++) {
    const sheetName = unitList[u];
    if (!sheetName) continue;
    
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue; // 見つからない単元はスキップ
    
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) continue;
    
    const headers = data[0];
    
    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      
      function getValue(headerName) {
        const idx = headers.indexOf(headerName);
        return idx !== -1 ? row[idx] : "";
      }
      
      const id = getValue("通し番号");
      const format = getValue("問題形式");
      
      if (id === "" || format === "") continue;
      
      const japanese = getValue("日本語訳・和文") || getValue("和文（空所有）");
      const sentence_template = getValue("並び替え用英文") || getValue("英文（空所有）");
      const correct_answer = getValue("正答") || getValue("英文");
      const dummy_selection_method = getValue("ダミー選出方法");
      
      const poolWords = [];
      const dummies = [];
      
      for (let c = 0; c < headers.length; c++) {
        const h = headers[c] ? headers[c].toString() : "";
        if (h.startsWith("並び替え語句") && !h.includes("ダミー")) {
          if (row[c] !== "") poolWords.push(row[c]);
        } else if (h.includes("ダミー")) {
          if (row[c] !== "") dummies.push(row[c]);
        }
      }
      
      const assembledCorrectWords = correct_answer ? correct_answer.toString().split(' ') : [];
      
      const q = {
        id: id,
        unit: sheetName,
        format: format,
        japanese: japanese,
        sentence_template: sentence_template,
        correct_answer: correct_answer,
        all_correct_words: poolWords.length > 0 ? assembledCorrectWords : assembledCorrectWords, 
        pool_words: poolWords.length > 0 ? poolWords : assembledCorrectWords,
        dummies: dummies,
        dummy_selection_method: dummy_selection_method,
        explanation: getValue("その他説明やヒント")
      };
      
      questions.push(q);
    }
  }
  
  return questions;
}

// POSTリクエストを受け取った時（学習結果の保存に使用）
function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    const postData = JSON.parse(e.postData.contents);
    if (postData.action === 'saveResult') {
      const results = postData.results;
      if (results && results.length > 0) {
        
        let configFolder = null;
        try {
          const scriptId = ScriptApp.getScriptId();
          const parents = DriveApp.getFileById(scriptId).getParents();
          let parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
          const cFolders = parentFolder.getFoldersByName("config");
          if (cFolders.hasNext()) configFolder = cFolders.next();
        } catch (err) {}

        if (!configFolder) {
          const cFolders = DriveApp.getFoldersByName("config");
          if (cFolders.hasNext()) configFolder = cFolders.next();
        }
        
        if (configFolder) {
          const aFiles = configFolder.getFilesByName("管理ブック");
          if (aFiles.hasNext()) {
            const ss = SpreadsheetApp.open(aFiles.next());
            const sheet = ss.getSheetByName("成績記録");
            if (sheet) {
              // 排他制御や高速化のためには2次元配列にしてまとめて書き込む手法もありますが、
              // フェーズ5の初期実装としてループでのappendRowにて確実に行を追加します。
              const rows = [];
              for (let i = 0; i < results.length; i++) {
                const r = results[i];
                rows.push([
                  r.timestamp, 
                  r.userId, 
                  r.questionId, 
                  r.subject, 
                  r.unit, 
                  r.isCorrect, 
                  r.mode
                ]);
              }
              // まとめて書き込み（高速化）
              const startRow = sheet.getLastRow() + 1;
              sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
            }
          }
        }
      }
      output.setContent(JSON.stringify({ status: "success" }));
    } else {
      output.setContent(JSON.stringify({ status: "error", message: "Invalid action" }));
    }
  } catch (error) {
    output.setContent(JSON.stringify({ status: "error", message: error.toString() }));
  }
  return output;
}

// ＝＝＝＝＝ 初期セットアップ用関数 ＝＝＝＝＝
// ※ Google Apps Script のエディタ上で「setupEnvironment」を選択し「実行」を押してください。
function setupEnvironment() {
  const scriptId = ScriptApp.getScriptId();
  const scriptFile = DriveApp.getFileById(scriptId);
  const parents = scriptFile.getParents();
  let parentFolder;
  if (parents.hasNext()) {
    parentFolder = parents.next();
  } else {
    parentFolder = DriveApp.getRootFolder();
  }

  // 1. materials (教材格納) フォルダの作成
  let materialsFolder;
  const mFolders = parentFolder.getFoldersByName("materials");
  if (mFolders.hasNext()) {
    materialsFolder = mFolders.next();
    Logger.log("既存の materials フォルダを見つけました。");
  } else {
    materialsFolder = parentFolder.createFolder("materials");
    Logger.log("新規に materials フォルダを作成しました。");
  }

  // 2. config (管理・成績蓄積用) フォルダの作成
  let configFolder;
  const cFolders = parentFolder.getFoldersByName("config");
  if (cFolders.hasNext()) {
    configFolder = cFolders.next();
    Logger.log("既存の config フォルダを見つけました。");
  } else {
    configFolder = parentFolder.createFolder("config");
    Logger.log("新規に config フォルダを作成しました。");
  }

  // 3. ログ・成績管理ブックのセットアップ (configフォルダ内)
  const adminBookName = "管理ブック";
  const aFiles = configFolder.getFilesByName(adminBookName);
  if (!aFiles.hasNext()) {
    const ss = SpreadsheetApp.create(adminBookName);
    const file = DriveApp.getFileById(ss.getId());
    file.moveTo(configFolder);
    
    const logSheet = ss.getSheets()[0];
    logSheet.setName("成績記録");
    logSheet.appendRow(["タイムスタンプ", "ユーザーID", "問題ID", "学年科目", "単元", "正誤判定", "出題モード"]);
    Logger.log("管理ブック（成績記録用）を作成しました。");
  }

  // 4. サンプル教材ブックのセットアップ (materialsフォルダ内)
  const sampleBookName = "中学1年 英語";
  const sFiles = materialsFolder.getFilesByName(sampleBookName);
  if (!sFiles.hasNext()) {
    const ss = SpreadsheetApp.create(sampleBookName);
    const file = DriveApp.getFileById(ss.getId());
    file.moveTo(materialsFolder);
    
    const sheet = ss.getSheets()[0];
    sheet.setName("be動詞");
    
    // 見出し追加
    const headers = [
      "通し番号", "問題形式", "日本語訳・和文", "和文（空所有）", "並び替え用英文", "英文（空所有）",
      "正答", "ダミー選出方法", "並び替え語句1", "並び替え語句2", "並び替え語句3", "並び替え語句ダミー1",
      "ダミー回答1", "ダミー回答2", "ダミー回答3", "その他説明やヒント"
    ];
    sheet.appendRow(headers);
    
    // サンプルデータ追加
    sheet.appendRow([
      "Q001", "並び替え", "私は学生です。", "", "I am a student.", "", "I am a student.", 
      "", "I", "am", "a", "student", "teacher", "", "", "基本のbe動詞です。"
    ]);
    sheet.appendRow([
      "Q002", "4択", "彼は忙しいです。", "", "", "He [   ] busy.", "is", 
      "無作為", "", "", "", "", "are", "am", "be", "主語がHeなのでisを使います。"
    ]);
    sheet.appendRow([
      "Q003", "英訳", "これはペンですか？", "", "", "", "Is this a pen?", 
      "", "", "", "", "", "", "", "", "疑問文はbe動詞を前に出します。"
    ]);
    Logger.log("サンプル教材ブック（中学1年 英語）を作成しました。");
  }

  Logger.log("初期セットアップがすべて完了しました！");
}