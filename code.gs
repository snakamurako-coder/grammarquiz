// code.gs 統合版
// レスポンスを返す共通関数
const sendResponse = (responseObject) => {
  return ContentService.createTextOutput(JSON.stringify(responseObject))
    .setMimeType(ContentService.MimeType.JSON);
};

function doOptions(e) {
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'getQuestions') {
    try {
      const data = fetchQuestionsFromSheet(e.parameter);
      return sendResponse({ status: "success", data: data });
    } catch (error) {
      return sendResponse({ status: "error", message: error.toString(), stack: error.stack });
    }
  }
  return sendResponse({ status: "error", message: "Invalid action" });
}

function fetchQuestionsFromSheet(params) {
  const subject = params.subject;
  const unit = params.unit;

  if (!subject || !unit) {
    throw new Error("subject (学年・科目) と unit (単元名) のパラメータが必須です。");
  }

  let materialsFolder = null;
  const mFolders = DriveApp.getFoldersByName("materials");
  if (mFolders.hasNext()) materialsFolder = mFolders.next();
  if (!materialsFolder) throw new Error("materialsフォルダが見つかりません。");

  const files = materialsFolder.getFilesByName(subject);
  if (!files.hasNext()) throw new Error("スプレッドシートが見つかりません: " + subject);
  const spreadsheetFile = files.next();
  const ss = SpreadsheetApp.open(spreadsheetFile);

  const unitList = unit.split(',').map(u => u.trim());
  const questions = [];

  for (let u = 0; u < unitList.length; u++) {
    const sheetName = unitList[u];
    if (!sheetName) continue;
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

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

// メインの受信処理
function doPost(e) {
  try {
    const requestData = JSON.parse(e.postData.contents);
    const action = requestData.action;

    // アクション（目的）によって処理を振り分ける
    if (action === "login") {
      return handleLogin(requestData);
    } else if (action === "saveResult") {
      return handleSaveResult(requestData); // アプリ側成績用
    } else if (action === "save") {
      return handleSave(requestData);       // 既存利用用
    } else if (action === "get_csv_data") {
      return handleGetData(requestData);    // 既存利用用
    } else {
      return sendResponse({ status: "error", message: "無効なactionです" });
    }
  } catch (error) {
    return sendResponse({ status: "error", message: error.toString() });
  }
}

// =========================================================
// ① ログイン処理（以前のコードをそのまま関数化）
// =========================================================
function handleLogin(requestData) {
  const idToken = requestData.idToken;
  if (!idToken) return sendResponse({ status: "error", message: "IDトークンがありません" });

  const tokenInfoUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`;
  const tokenResponse = UrlFetchApp.fetch(tokenInfoUrl, { muteHttpExceptions: true });
  if (tokenResponse.getResponseCode() !== 200) return sendResponse({ status: "error", message: "無効なトークンです" });
  
  const tokenData = JSON.parse(tokenResponse.getContentText());
  const props = PropertiesService.getScriptProperties();
  if (tokenData.aud !== props.getProperty('CLIENT_ID')) {
    return sendResponse({ status: "error", message: "不正なアクセスです" });
  }

  const userEmail = tokenData.email;
  const spreadId = props.getProperty('SPREADSHEET_ID');
  if (!spreadId) return sendResponse({ status: "error", message: "SPREADSHEET_IDが設定されていません" });

  const sheet = SpreadsheetApp.openById(spreadId).getSheetByName('whitelist');
  if (!sheet) return sendResponse({ status: "error", message: "whitelistシートが見つかりません" });

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const accountIdx = headers.indexOf('account');
  if (accountIdx === -1) return sendResponse({ status: "error", message: "account列がありません" });

  let foundUser = null;
  for (let i = 1; i < data.length; i++) {
    if (data[i][accountIdx] === userEmail) {
      foundUser = {};
      for (let j = 0; j < headers.length; j++) {
        if (headers[j]) foundUser[headers[j]] = data[i][j];
      }
      break;
    }
  }
  
  if (foundUser) {
    return sendResponse({ status: "success", user: foundUser, message: "認証成功" });
  } else {
    return sendResponse({ status: "error", message: "許可されていないユーザーです" });
  }
}

// =========================================================
// 成績保存処理（Phase 5用・リファクタ版）
// =========================================================
function handleSaveResult(requestData) {
  const results = requestData.results;
  if (!results || results.length === 0) return sendResponse({ status: "success" });

  const props = PropertiesService.getScriptProperties();
  const spreadId = props.getProperty('SPREADSHEET_ID');
  
  if (!spreadId) {
    return sendResponse({ status: "error", message: "SPREADSHEET_IDが設定されていません。" });
  }

  const ss = SpreadsheetApp.openById(spreadId);
  let sheet = ss.getSheetByName("成績記録");
  
  if (!sheet) {
    sheet = ss.insertSheet("成績記録");
    sheet.appendRow(["タイムスタンプ", "ユーザーID", "問題ID", "学年科目", "単元", "正誤判定", "出題モード"]);
  }

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
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);

  return sendResponse({ status: "success", message: "成績を保存しました" });
}

// =========================================================
// ② 汎用データ保存処理（どんなアプリからでも使える）
// =========================================================
function handleSave(requestData) {
  const sheetName = requestData.sheetName; // アプリ側から「保存先シート名」を指定させる
  const record = requestData.record;       // 保存したいデータ本体（オブジェクト）

  if (!sheetName || !record) return sendResponse({ status: "error", message: "sheetNameとrecordが必要です" });

  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  let sheet = ss.getSheetByName(sheetName);

  // もしそのアプリ用のシートがまだ無ければ、自動で作る（超・汎用設計）
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    // recordのキー（プロパティ名）をそのまま1行目の見出しにする
    const newHeaders = Object.keys(record);
    sheet.appendRow(newHeaders);
  }

  // 見出しに合わせてデータを配列化して追記する
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowData = headers.map(header => {
    return record[header] !== undefined ? record[header] : ""; // データが無ければ空欄
  });

  sheet.appendRow(rowData);
  return sendResponse({ status: "success", message: "データを保存しました" });
}

// =========================================================
// ③ 汎用データ取得処理（CSV等用・自分のデータだけを抽出）
// =========================================================
function handleGetData(requestData) {
  const sheetName = requestData.sheetName;
  const targetEmail = requestData.userEmail;

  if (!sheetName || !targetEmail) return sendResponse({ status: "error", message: "sheetNameとuserEmailが必要です" });

  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) return sendResponse({ status: "success", data: [], message: "まだ記録がありません" });

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf('account'); // データの中に 'account' という見出しがある前提

  if (emailIdx === -1) return sendResponse({ status: "error", message: "データ内にaccount列がありません" });

  // 自分のメールアドレスと一致する行だけを抽出し、オブジェクトの配列に変換して返す
  const userRecords = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][emailIdx] === targetEmail) {
      let obj = {};
      for (let j = 0; j < headers.length; j++) {
        if (headers[j]) obj[headers[j]] = data[i][j];
      }
      userRecords.push(obj);
    }
  }

  return sendResponse({ status: "success", data: userRecords });
}