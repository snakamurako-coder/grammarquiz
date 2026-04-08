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
  
  // 対象のシートを探す
  const sheet = ss.getSheetByName(unit);
  if (!sheet) {
    throw new Error("シートが見つかりません: " + unit);
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return []; // データ行がない場合は空配列
  }
  
  const headers = data[0];
  const questions = [];
  
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    
    // ヘッダーに対応する値を取得するヘルパー関数
    function getValue(headerName) {
      const idx = headers.indexOf(headerName);
      return idx !== -1 ? row[idx] : "";
    }
    
    const id = getValue("通し番号");
    const format = getValue("問題形式");
    
    // 必須項目のチェック
    if (id === "" || format === "") {
      continue; // 無視する行
    }
    
    const japanese = getValue("日本語訳・和文") || getValue("和文（空所有）");
    const sentence_template = getValue("並び替え用英文") || getValue("英文（空所有）");
    const correct_answer = getValue("正答") || getValue("英文");
    const dummy_selection_method = getValue("ダミー選出方法");
    
    const poolWords = [];
    const dummies = [];
    
    // 変動列の取得
    for (let c = 0; c < headers.length; c++) {
      const h = headers[c] ? headers[c].toString() : "";
      // 並び替え語句ダミーやダミー回答と被らないように
      if (h.startsWith("並び替え語句") && !h.includes("ダミー")) {
        if (row[c] !== "") poolWords.push(row[c]);
      } else if (h.includes("ダミー")) {
        if (row[c] !== "") dummies.push(row[c]);
      }
    }
    
    // 問題データの組み立て
    const assembledCorrectWords = correct_answer ? correct_answer.toString().split(' ') : [];
    
    const q = {
      id: id,
      format: format,
      japanese: japanese,
      sentence_template: sentence_template,
      correct_answer: correct_answer,
      all_correct_words: poolWords.length > 0 ? assembledCorrectWords : assembledCorrectWords, 
      pool_words: poolWords.length > 0 ? poolWords : assembledCorrectWords, // シートに未指定なら正答を分割して代用
      dummies: dummies,
      dummy_selection_method: dummy_selection_method,
      explanation: getValue("その他説明やヒント")
    };
    
    questions.push(q);
  }
  
  return questions;
}

// POSTリクエストを受け取った時（学習結果の保存などに使用）
function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    const postData = JSON.parse(e.postData.contents);
    if (postData.action === 'saveResult') {
      // 例：結果をスプレッドシートに書き込む処理（Phase 5以降）
      output.setContent(JSON.stringify({ status: "success" }));
    }
  } catch (error) {
    output.setContent(JSON.stringify({ status: "error", message: error.toString() }));
  }
  return output;
}