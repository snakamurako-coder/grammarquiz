// code.gs 統合版

/** スクリプトプロパティキー */
const PROP = {
  CLIENT_ID: 'CLIENT_ID',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  MATERIALS_FOLDER_ID: 'MATERIALS_FOLDER_ID',
  PARENT_FOLDER_ID: 'PARENT_FOLDER_ID',
  SAMPLE_BOOK_IDS: 'SAMPLE_BOOK_IDS',
  SETUP_COMPLETED: 'SETUP_COMPLETED'
};

/** index.html の GSI client_id と揃える既定値（未設定時のみ書き込む） */
const DEFAULT_CLIENT_ID = '505252303455-84r495bnnsgiefcrv24ro2qtohlgbk2h.apps.googleusercontent.com';

const MATERIALS_FOLDER_NAME = 'materials';
const MANAGEMENT_BOOK_NAME = 'BrightStage管理';

// レスポンスを返す共通関数
const sendResponse = (responseObject) => {
  return ContentService.createTextOutput(JSON.stringify(responseObject))
    .setMimeType(ContentService.MimeType.JSON);
};

function doOptions(e) {
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

function doGet(e) {
  ensureEnvironment();
  const action = e.parameter.action;
  if (action === 'getQuestions') {
    try {
      const data = fetchQuestionsFromSheet(e.parameter);
      return sendResponse({ status: "success", data: data });
    } catch (error) {
      return sendResponse({ status: "error", message: error.toString(), stack: error.stack });
    }
  } else if (action === 'getCatalog') {
    try {
      const data = fetchCatalogFromDrive();
      return sendResponse({ status: "success", data: data });
    } catch (error) {
      return sendResponse({ status: "error", message: error.toString(), stack: error.stack });
    }
  } else if (action === 'setup') {
    try {
      const force = String(e.parameter.force || '') === '1';
      const result = setupEnvironment(force);
      return sendResponse({ status: "success", data: result });
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

  const materialsFolder = getMaterialsFolder();
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

function fetchCatalogFromDrive() {
  const materialsFolder = getMaterialsFolder();

  const catalog = {};
  const files = materialsFolder.getFilesByType(MimeType.GOOGLE_SHEETS);
  
  while (files.hasNext()) {
    const file = files.next();
    const subjectName = file.getName();
    const ss = SpreadsheetApp.open(file);
    const sheets = ss.getSheets();
    const unitNames = sheets.map(s => s.getName());
    catalog[subjectName] = unitNames;
  }

  return catalog;
}

// メインの受信処理
function doPost(e) {
  try {
    ensureEnvironment();
    const requestData = JSON.parse(e.postData.contents);
    const action = requestData.action;

    // アクション（目的）によって処理を振り分ける
    if (action === "login") {
      return handleLogin(requestData);
    } else if (action === "saveResult") {
      return handleSaveResult(requestData); // アプリ側成績用
    } else if (action === "saveSessionLog") {
      return handleSaveSessionLog(requestData); // セッションサマリー用
    } else if (action === "getUserLogs") {
      return handleGetUserLogs(requestData); // マイページ情報取得用
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

// =========================================================
// ④ セッションログ保存処理（マイページ用）
// =========================================================
function handleSaveSessionLog(requestData) {
  const { email, setName, correctRate, timeTaken } = requestData;
  if (!email || !setName) return sendResponse({ status: "error", message: "必須パラメータがありません" });

  const spreadId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadId) return sendResponse({ status: "error", message: "SPREADSHEET_IDが設定されていません。" });

  const ss = SpreadsheetApp.openById(spreadId);
  let sheet = ss.getSheetByName("ログ");
  
  if (!sheet) {
    sheet = ss.insertSheet("ログ");
    sheet.appendRow(["タイムスタンプ", "メールアドレス", "学習セット名", "実施回数", "正答率", "解答時間"]);
  }

  const data = sheet.getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    // data[i][1] はメールアドレス, data[i][2] は学習セット名
    if (data[i][1] === email && data[i][2] === setName) {
      count++;
    }
  }

  const execCount = count + 1;
  const timeStr = Utilities.formatDate(new Date(), "JST", "yyyy/MM/dd HH:mm:ss");

  sheet.appendRow([timeStr, email, setName, execCount, correctRate, timeTaken]);
  return sendResponse({ status: "success", message: "セッションログを保存しました", execCount: execCount });
}

// =========================================================
// ⑤ マイページ用ログ取得処理
// =========================================================
function handleGetUserLogs(requestData) {
  const email = requestData.email;
  if (!email) return sendResponse({ status: "error", message: "emailが必要です" });

  const spreadId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadId) return sendResponse({ status: "error", message: "SPREADSHEET_IDが設定されていません。" });

  const ss = SpreadsheetApp.openById(spreadId);
  const sheet = ss.getSheetByName("ログ");
  
  if (!sheet) return sendResponse({ status: "success", data: [], message: "ログがありません" });

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf('メールアドレス');

  if (emailIdx === -1) return sendResponse({ status: "error", message: "ログ内にメールアドレス列がありません" });

  const userLogs = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][emailIdx] === email) {
      let obj = {};
      for (let j = 0; j < headers.length; j++) {
        if (headers[j]) obj[headers[j]] = data[i][j];
      }
      userLogs.push(obj);
    }
  }

  return sendResponse({ status: "success", data: userLogs });
}

// =========================================================
// ⑥ 初回セットアップ（フォルダ・管理ブック・サンプル問題）
// =========================================================

/**
 * 未セットアップ時のみ自動実行。doGet/doPost から呼ばれる。
 * エディタから再実行したい場合は setupEnvironment(true) を使う。
 */
function ensureEnvironment() {
  const props = PropertiesService.getScriptProperties();
  const done = props.getProperty(PROP.SETUP_COMPLETED) === 'true';
  const hasMgmt = !!props.getProperty(PROP.SPREADSHEET_ID);
  const hasMaterials = !!props.getProperty(PROP.MATERIALS_FOLDER_ID);
  if (done && hasMgmt && hasMaterials) {
    return props.getProperties();
  }
  return setupEnvironment(false);
}

/**
 * ウェブアプリGASと同じDrive階層に materials / 管理ブック / サンプル問題を整える。
 * @param {boolean} force true のとき、欠落リソースを再生成してプロパティを上書き
 * @return {Object} 作成・参照したリソース情報
 */
function setupEnvironment(force) {
  const props = PropertiesService.getScriptProperties();
  const created = [];
  const reused = [];

  const parentFolder = getScriptParentFolder_();
  props.setProperty(PROP.PARENT_FOLDER_ID, parentFolder.getId());

  // CLIENT_ID は既存値を尊重し、未設定なら既定値を入れる
  if (!props.getProperty(PROP.CLIENT_ID)) {
    props.setProperty(PROP.CLIENT_ID, DEFAULT_CLIENT_ID);
    created.push('CLIENT_ID');
  } else {
    reused.push('CLIENT_ID');
  }

  const materialsFolder = getOrCreateMaterialsFolder_(parentFolder, force, created, reused);
  props.setProperty(PROP.MATERIALS_FOLDER_ID, materialsFolder.getId());

  const managementSs = getOrCreateManagementBook_(parentFolder, force, created, reused);
  ensureManagementSheets_(managementSs);
  props.setProperty(PROP.SPREADSHEET_ID, managementSs.getId());

  const sampleBookIds = ensureSampleQuestionBooks_(materialsFolder, force, created, reused);
  props.setProperty(PROP.SAMPLE_BOOK_IDS, JSON.stringify(sampleBookIds));
  props.setProperty(PROP.SETUP_COMPLETED, 'true');

  const result = {
    parentFolderId: parentFolder.getId(),
    parentFolderName: parentFolder.getName(),
    materialsFolderId: materialsFolder.getId(),
    managementBookId: managementSs.getId(),
    managementBookUrl: managementSs.getUrl(),
    sampleBookIds: sampleBookIds,
    created: created,
    reused: reused
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** materials フォルダを Script Properties 優先で取得 */
function getMaterialsFolder() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty(PROP.MATERIALS_FOLDER_ID);
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // fall through
    }
  }

  const parentId = props.getProperty(PROP.PARENT_FOLDER_ID);
  if (parentId) {
    try {
      const parent = DriveApp.getFolderById(parentId);
      const folders = parent.getFoldersByName(MATERIALS_FOLDER_NAME);
      if (folders.hasNext()) {
        const folder = folders.next();
        props.setProperty(PROP.MATERIALS_FOLDER_ID, folder.getId());
        return folder;
      }
    } catch (e) {
      // fall through
    }
  }

  const mFolders = DriveApp.getFoldersByName(MATERIALS_FOLDER_NAME);
  if (mFolders.hasNext()) {
    const folder = mFolders.next();
    props.setProperty(PROP.MATERIALS_FOLDER_ID, folder.getId());
    return folder;
  }

  throw new Error("materialsフォルダが見つかりません。setupEnvironment() を実行してください。");
}

/** スクリプトファイルと同じ親フォルダを返す（無ければマイドライブ直下） */
function getScriptParentFolder_() {
  const scriptFile = DriveApp.getFileById(ScriptApp.getScriptId());
  const parents = scriptFile.getParents();
  if (parents.hasNext()) return parents.next();
  return DriveApp.getRootFolder();
}

function findChildFolderByName_(parentFolder, name) {
  const it = parentFolder.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

function findChildSpreadsheetByName_(parentFolder, name) {
  const it = parentFolder.getFilesByName(name);
  while (it.hasNext()) {
    const file = it.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) return file;
  }
  return null;
}

function createSpreadsheetInFolder_(name, folder) {
  const ss = SpreadsheetApp.create(name);
  const file = DriveApp.getFileById(ss.getId());
  file.moveTo(folder);
  return ss;
}

function getOrCreateMaterialsFolder_(parentFolder, force, created, reused) {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(PROP.MATERIALS_FOLDER_ID);

  if (!force && existingId) {
    try {
      const folder = DriveApp.getFolderById(existingId);
      reused.push(MATERIALS_FOLDER_NAME);
      return folder;
    } catch (e) {
      // recreate below
    }
  }

  let folder = findChildFolderByName_(parentFolder, MATERIALS_FOLDER_NAME);
  if (folder) {
    reused.push(MATERIALS_FOLDER_NAME);
    return folder;
  }

  folder = parentFolder.createFolder(MATERIALS_FOLDER_NAME);
  created.push(MATERIALS_FOLDER_NAME);
  return folder;
}

function getOrCreateManagementBook_(parentFolder, force, created, reused) {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(PROP.SPREADSHEET_ID);

  if (!force && existingId) {
    try {
      reused.push(MANAGEMENT_BOOK_NAME);
      return SpreadsheetApp.openById(existingId);
    } catch (e) {
      // recreate below
    }
  }

  const existingFile = findChildSpreadsheetByName_(parentFolder, MANAGEMENT_BOOK_NAME);
  if (existingFile) {
    reused.push(MANAGEMENT_BOOK_NAME);
    return SpreadsheetApp.open(existingFile);
  }

  const ss = createSpreadsheetInFolder_(MANAGEMENT_BOOK_NAME, parentFolder);
  created.push(MANAGEMENT_BOOK_NAME);
  return ss;
}

function ensureManagementSheets_(ss) {
  // whitelist
  let whitelist = ss.getSheetByName('whitelist');
  if (!whitelist) {
    const sheets = ss.getSheets();
    whitelist = sheets[0];
    whitelist.setName('whitelist');
  }
  if (whitelist.getLastRow() === 0 || whitelist.getRange(1, 1).getValue() === '') {
    whitelist.clear();
    whitelist.appendRow(['account', 'name', 'grade', 'class']);
    whitelist.appendRow(['example@example.com', 'サンプル太郎', '1', 'A']);
    whitelist.getRange(1, 1, 1, 4).setFontWeight('bold');
  }

  let scores = ss.getSheetByName('成績記録');
  if (!scores) {
    scores = ss.insertSheet('成績記録');
  }
  if (scores.getLastRow() === 0 || scores.getRange(1, 1).getValue() === '') {
    scores.clear();
    scores.appendRow(['タイムスタンプ', 'ユーザーID', '問題ID', '学年科目', '単元', '正誤判定', '出題モード']);
    scores.getRange(1, 1, 1, 7).setFontWeight('bold');
  }

  let logs = ss.getSheetByName('ログ');
  if (!logs) {
    logs = ss.insertSheet('ログ');
  }
  if (logs.getLastRow() === 0 || logs.getRange(1, 1).getValue() === '') {
    logs.clear();
    logs.appendRow(['タイムスタンプ', 'メールアドレス', '学習セット名', '実施回数', '正答率', '解答時間']);
    logs.getRange(1, 1, 1, 6).setFontWeight('bold');
  }

  // 作成直後の「シート1」が残っていれば削除
  const leftover = ss.getSheetByName('シート1');
  if (leftover && ss.getSheets().length > 1) {
    ss.deleteSheet(leftover);
  }
}

/**
 * app.js の unitData と揃えたサンプル問題ブックを materials 内に用意する。
 * @return {Object} 科目名 → スプレッドシートID
 */
function ensureSampleQuestionBooks_(materialsFolder, force, created, reused) {
  const catalog = getSampleQuestionCatalog_();
  const bookIds = {};

  Object.keys(catalog).forEach(function (subjectName) {
    let file = findChildSpreadsheetByName_(materialsFolder, subjectName);
    let ss;

    if (file && !force) {
      ss = SpreadsheetApp.open(file);
      reused.push(subjectName);
    } else if (file && force) {
      ss = SpreadsheetApp.open(file);
      reused.push(subjectName + '(更新)');
    } else {
      ss = createSpreadsheetInFolder_(subjectName, materialsFolder);
      created.push(subjectName);
    }

    ensureSampleUnitSheets_(ss, catalog[subjectName]);
    bookIds[subjectName] = ss.getId();
  });

  return bookIds;
}

function ensureSampleUnitSheets_(ss, units) {
  const unitNames = Object.keys(units);
  unitNames.forEach(function (unitName, index) {
    let sheet = ss.getSheetByName(unitName);
    if (!sheet) {
      if (index === 0 && ss.getSheetByName('シート1')) {
        sheet = ss.getSheetByName('シート1');
        sheet.setName(unitName);
      } else {
        sheet = ss.insertSheet(unitName);
      }
    }

    // 空、またはヘッダのみならサンプルを流し込む（既存データは上書きしない）
    const lastRow = sheet.getLastRow();
    const firstCell = lastRow > 0 ? sheet.getRange(1, 1).getValue() : '';
    if (lastRow <= 1 && (firstCell === '' || firstCell === '通し番号')) {
      const rows = units[unitName];
      sheet.clear();
      sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
      sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });

  const leftover = ss.getSheetByName('シート1');
  if (leftover && ss.getSheets().length > 1) {
    ss.deleteSheet(leftover);
  }
}

/** サンプル問題定義（ヘッダ行 + データ行）。全形式共通の広いヘッダを使う */
function getSampleQuestionCatalog_() {
  // fetchQuestionsFromSheet はヘッダ名で参照するため、全列を1行にまとめる
  const headers = [
    '通し番号', '問題形式', '日本語訳・和文', '並び替え用英文', '英文（空所有）', '正答',
    '並び替え語句1', '並び替え語句2', '並び替え語句3', '並び替え語句4', '並び替え語句5',
    'ダミー1', 'ダミー2', 'ダミー3', 'ダミー選出方法', 'その他説明やヒント'
  ];

  function row(id, format, ja, sortTpl, blankTpl, answer, words, dummies, method, hint) {
    const w = (words || []).concat(['', '', '', '', '']).slice(0, 5);
    const d = (dummies || []).concat(['', '', '']).slice(0, 3);
    return [
      id, format, ja, sortTpl || '', blankTpl || '', answer || ''
    ].concat(w).concat(d).concat([method || '', hint || '']);
  }

  function sorting(id, ja, template, answer, words, dummies, method, hint) {
    return row(id, '並び替え', ja, template, '', answer, words, dummies, method || '無作為', hint);
  }
  function choice(id, ja, template, answer, dummies, method, hint) {
    return row(id, '4択', ja, '', template, answer, [], dummies, method || '無作為', hint);
  }
  function typing(id, ja, template, answer, hint) {
    return row(id, '英訳', ja, '', template, answer, [], [], '', hint);
  }

  return {
    '中学1年 英語': {
      '単元A': [
        headers,
        sorting(1, '私は学生です。', 'I ( ) a student.', 'am', ['am'], ['is', 'are'], '無作為', 'be動詞の基本'),
        sorting(2, '彼女は先生です。', 'She ( ) a teacher.', 'is', ['is'], ['am', 'are'], '無作為', ''),
        choice(3, '彼らは友達です。', 'They ( ) friends.', 'are', ['am', 'is', 'be'], '順番', ''),
        typing(4, 'あなたは生徒です。', 'You ( ) a student.', 'are', '主語に合わせて be 動詞を選ぶ')
      ],
      '単元B': [
        headers,
        sorting(1, 'これは本です。', 'This ( ) a book.', 'is', ['is'], ['am', 'are'], '無作為', 'This/That'),
        choice(2, 'あれはペンです。', 'That ( ) a pen.', 'is', ['am', 'are', 'be'], '無作為', ''),
        typing(3, 'これらは机です。', 'These ( ) desks.', 'are', '')
      ],
      'be動詞': [
        headers,
        sorting(1, '私は元気です。', 'I ( ) fine.', 'am', ['am'], ['is', 'are'], '無作為', 'be動詞'),
        sorting(2, '彼は忙しいです。', 'He ( ) busy.', 'is', ['is'], ['am', 'are'], '無作為', ''),
        choice(3, '私たちは日本人です。', 'We ( ) Japanese.', 'are', ['am', 'is', 'be'], '順番', ''),
        choice(4, 'あなたは学生ですか。', '( ) you a student?', 'Are', ['Is', 'Am', 'Be'], '無作為', '疑問文'),
        typing(5, '彼女は歌手です。', 'She ( ) a singer.', 'is', '')
      ],
      '一般動詞': [
        headers,
        sorting(1, '私はテニスをします。', 'I ( ) tennis.', 'play', ['play'], ['plays', 'playing'], '無作為', '一般動詞'),
        sorting(2, '彼はサッカーをします。', 'He ( ) soccer.', 'plays', ['plays'], ['play', 'playing'], '無作為', '三人称単数'),
        choice(3, '彼女は本を読みます。', 'She ( ) a book.', 'reads', ['read', 'reading', 'to read'], '順番', ''),
        typing(4, '私たちは英語を勉強します。', 'We ( ) English.', 'study', '')
      ]
    },
    '中学2年 英語': {
      '単元A': [
        headers,
        sorting(1, '私は昨日公園へ行きました。', 'I ( ) to the park yesterday.', 'went', ['went'], ['go', 'goes'], '無作為', '過去形'),
        choice(2, '彼は昨日テレビを見ました。', 'He ( ) TV yesterday.', 'watched', ['watch', 'watches', 'watching'], '無作為', ''),
        typing(3, '彼女は昨日家にいました。', 'She ( ) home yesterday.', 'was', '')
      ],
      '単元B': [
        headers,
        sorting(1, '私は宿題をしなければなりません。', 'I ( ) do my homework.', 'must', ['must'], ['can', 'will'], '無作為', '助動詞'),
        choice(2, '彼は泳ぐことができます。', 'He ( ) swim.', 'can', ['must', 'will', 'should'], '順番', ''),
        typing(3, 'あなたは早く寝るべきです。', 'You ( ) go to bed early.', 'should', '')
      ],
      '過去形': [
        headers,
        sorting(1, '私はきのう走った。', 'I ( ) yesterday.', 'ran', ['ran'], ['run', 'runs'], '無作為', '不規則動詞'),
        sorting(2, '彼らはきのう遊んだ。', 'They ( ) yesterday.', 'played', ['played'], ['play', 'plays'], '無作為', ''),
        choice(3, '彼女はきのう来た。', 'She ( ) yesterday.', 'came', ['come', 'comes', 'coming'], '無作為', ''),
        typing(4, '私たちはきのう食べた。', 'We ( ) yesterday.', 'ate', 'eat の過去形')
      ],
      '助動詞': [
        headers,
        sorting(1, '私はピアノを弾けます。', 'I ( ) play the piano.', 'can', ['can'], ['must', 'will'], '無作為', 'can'),
        choice(2, 'あなたはここに来てもよい。', 'You ( ) come here.', 'may', ['can', 'must', 'will'], '順番', ''),
        choice(3, '私たちは急ぐべきだ。', 'We ( ) hurry.', 'should', ['can', 'may', 'will'], '無作為', ''),
        typing(4, '彼は明日来るでしょう。', 'He ( ) come tomorrow.', 'will', '')
      ]
    }
  };
}