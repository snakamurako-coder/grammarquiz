// code.gs 統合版

/** スクリプトプロパティキー */
const PROP = {
  CLIENT_ID: 'CLIENT_ID',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  MATERIALS_FOLDER_ID: 'MATERIALS_FOLDER_ID',
  VOCABULARY_FOLDER_ID: 'VOCABULARY_FOLDER_ID',
  MY_VOCAB_BOOK_ID: 'MY_VOCAB_BOOK_ID',
  SAMPLE_VOCAB_BOOK_IDS: 'SAMPLE_VOCAB_BOOK_IDS',
  PARENT_FOLDER_ID: 'PARENT_FOLDER_ID',
  SAMPLE_BOOK_IDS: 'SAMPLE_BOOK_IDS',
  SETUP_COMPLETED: 'SETUP_COMPLETED',
  PAGES_URL: 'PAGES_URL'
};

/** ユーザー権限実行時の UserProperties キー */
const USER_PROP = {
  MY_DATA_FOLDER_ID: 'MY_DATA_FOLDER_ID',
  MY_VOCAB_BOOK_ID: 'MY_VOCAB_BOOK_ID',
  MY_LOG_BOOK_ID: 'MY_LOG_BOOK_ID'
};

const USER_DATA_FOLDER_NAME = 'BrightStage_MyData';
const USER_LOG_BOOK_NAME = 'BrightStage学習記録';
const SESSION_CACHE_PREFIX = 'sess_';
const RESULT_CACHE_PREFIX = 'result_';
const SESSION_CACHE_TTL = 21600;
const RESULT_CACHE_TTL = 21600;
const DEFAULT_PAGES_URL = 'https://snakamurako-coder.github.io/grammarquiz/';

/** index.html の GSI client_id と揃える既定値（未設定時のみ書き込む） */
const DEFAULT_CLIENT_ID = '505252303455-84r495bnnsgiefcrv24ro2qtohlgbk2h.apps.googleusercontent.com';

const MATERIALS_FOLDER_NAME = 'materials';
const VOCABULARY_FOLDER_NAME = 'vocabulary';
const MANAGEMENT_BOOK_NAME = 'BrightStage管理';
const MY_VOCAB_BOOK_NAME = 'マイ単語帳';
const UNREGISTERED = '(未登録)';

/** 単語帳22列ヘッダ（管理者配布・ユーザー登録共通） */
const VOCAB_HEADERS = [
  '通し番号', '大区分', '中区分', '小区分', '英単語・熟語の表現',
  '意味＠名詞', '意味＠動詞', '意味＠形容詞', '意味＠副詞', '意味＠前置詞',
  '意味＠接続詞', '意味＠その他品詞', '意味＠熟語・慣用表現',
  'メモ', '類義語・同義語', '対義語', '派生語・関連語',
  '英文による定義', 'チャンク', 'チャンク訳', '例文', '例文訳'
];

// レスポンスを返す共通関数
const sendResponse = (responseObject) => {
  return ContentService.createTextOutput(JSON.stringify(responseObject))
    .setMimeType(ContentService.MimeType.JSON);
};

function doOptions(e) {
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : null;

  if (action) {
    ensureEnvironment();
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
    } else if (action === 'getVocabCatalog') {
      try {
        const data = fetchVocabCatalogFromDrive_();
        return sendResponse({ status: "success", data: data });
      } catch (error) {
        return sendResponse({ status: "error", message: error.toString(), stack: error.stack });
      }
    } else if (action === 'getVocabWords') {
      try {
        const filters = e.parameter.filters ? JSON.parse(e.parameter.filters) : {};
        const data = fetchVocabWordsFromSheet_({
          bookName: e.parameter.bookName,
          sheetName: e.parameter.sheetName,
          filters: filters,
          includeBookPool: e.parameter.includeBookPool || '0'
        });
        return sendResponse({ status: "success", data: data });
      } catch (error) {
        return sendResponse({ status: "error", message: error.toString(), stack: error.stack });
      }
    } else if (action === 'getSession') {
      try {
        const token = e.parameter.token;
        const session = getSessionFromCache_(token);
        if (!session) return sendResponse({ status: "error", message: "セッションが見つかりません" });
        return sendResponse({ status: "success", data: session });
      } catch (error) {
        return sendResponse({ status: "error", message: error.toString() });
      }
    } else if (action === 'getResult') {
      try {
        const token = e.parameter.token;
        const result = getResultFromCache_(token);
        if (!result) return sendResponse({ status: "error", message: "結果が見つかりません" });
        return sendResponse({ status: "success", data: result });
      } catch (error) {
        return sendResponse({ status: "error", message: error.toString() });
      }
    } else if (action === 'setup') {
      try {
        const force = String(e.parameter.force || '') === '1';
        const result = setupEnvironmentWithLock_(force);
        return sendResponse({ status: "success", data: result });
      } catch (error) {
        return sendResponse({ status: "error", message: error.toString(), stack: error.stack });
      }
    }
    return sendResponse({ status: "error", message: "無効なactionです: " + action });
  }

  const template = HtmlService.createTemplateFromFile('dashboard');
  template.PAGES_URL = getPagesUrl_();
  template.RESULT_TOKEN = (e && e.parameter && e.parameter.result_token) ? e.parameter.result_token : '';
  return template.evaluate()
    .setTitle('BrightStage 管理')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
        } else if (h.includes("ダミー") && !h.includes("選出方法")) {
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
    } else if (action === "registerVocabWords") {
      return handleRegisterVocabWords(requestData);
    } else if (action === "scoreReading") {
      return handleScoreReading(requestData);
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

function handleRegisterVocabWords(requestData) {
  try {
    const sheetName = requestData.sheetName;
    const rows = requestData.rows;
    const parsedRows = typeof rows === 'string' ? JSON.parse(rows) : rows;
    const data = registerVocabWords_(sheetName, parsedRows);
    return sendResponse({ status: "success", data: data, message: "単語を登録しました" });
  } catch (error) {
    return sendResponse({ status: "error", message: error.toString() });
  }
}

// =========================================================
// ⑥ 初回セットアップ（フォルダ・管理ブック・サンプル問題）
// =========================================================

/**
 * 未セットアップ時のみ自動実行。doGet/doPost から呼ばれる。
 * 並行リクエストによる二重生成を LockService で防止。
 */
function ensureEnvironment() {
  const props = PropertiesService.getScriptProperties();
  if (isEnvironmentReady_(props)) {
    ensureVocabularyResources_();
    return props.getProperties();
  }
  return setupEnvironmentWithLock_(false);
}

/** セットアップ済みか（プロパティ + 実リソース存在を確認） */
function isEnvironmentReady_(props) {
  if (props.getProperty(PROP.SETUP_COMPLETED) !== 'true') return false;
  const spreadId = props.getProperty(PROP.SPREADSHEET_ID);
  const folderId = props.getProperty(PROP.MATERIALS_FOLDER_ID);
  if (!spreadId || !folderId) return false;
  try {
    DriveApp.getFolderById(folderId);
    SpreadsheetApp.openById(spreadId);
    return true;
  } catch (e) {
    return false;
  }
}

/** ロック付きセットアップ（手動実行・API からもこちらを使う） */
function setupEnvironmentWithLock_(force) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    if (!force && isEnvironmentReady_(props)) {
      return props.getProperties();
    }
    return setupEnvironment_(force);
  } finally {
    lock.releaseLock();
  }
}

/** @deprecated 互換用。setupEnvironmentWithLock_ を使うこと */
function setupEnvironment(force) {
  return setupEnvironmentWithLock_(!!force);
}

/**
 * ウェブアプリGASと同じDrive階層に materials / 管理ブック / サンプル問題を整える。
 * @param {boolean} force true のとき、欠落リソースを再生成してプロパティを上書き
 * @return {Object} 作成・参照したリソース情報
 */
function setupEnvironment_(force) {
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

  const vocabularyFolder = getOrCreateVocabularyFolder_(parentFolder, force, created, reused);
  props.setProperty(PROP.VOCABULARY_FOLDER_ID, vocabularyFolder.getId());

  const myVocabBook = getOrCreateMyVocabBook_(vocabularyFolder, force, created, reused);
  props.setProperty(PROP.MY_VOCAB_BOOK_ID, myVocabBook.getId());

  const sampleVocabBookIds = ensureSampleVocabBooks_(vocabularyFolder, force, created, reused);
  props.setProperty(PROP.SAMPLE_VOCAB_BOOK_IDS, JSON.stringify(sampleVocabBookIds));

  props.setProperty(PROP.SETUP_COMPLETED, 'true');
  if (!props.getProperty(PROP.PAGES_URL)) {
    props.setProperty(PROP.PAGES_URL, DEFAULT_PAGES_URL);
    created.push('PAGES_URL');
  }

  const result = {
    parentFolderId: parentFolder.getId(),
    parentFolderName: parentFolder.getName(),
    materialsFolderId: materialsFolder.getId(),
    vocabularyFolderId: vocabularyFolder.getId(),
    myVocabBookId: myVocabBook.getId(),
    managementBookId: managementSs.getId(),
    managementBookUrl: managementSs.getUrl(),
    sampleBookIds: sampleBookIds,
    sampleVocabBookIds: sampleVocabBookIds,
    created: created,
    reused: reused
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** materials フォルダを Script Properties 優先で取得（親フォルダ内のみ探索） */
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

  const parentFolder = getScriptParentFolder_();
  const folder = findChildFolderByName_(parentFolder, MATERIALS_FOLDER_NAME);
  if (folder) {
    props.setProperty(PROP.MATERIALS_FOLDER_ID, folder.getId());
    props.setProperty(PROP.PARENT_FOLDER_ID, parentFolder.getId());
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

  if (!force) {
    const existingId = props.getProperty(PROP.MATERIALS_FOLDER_ID);
    if (existingId) {
      try {
        const folder = DriveApp.getFolderById(existingId);
        reused.push(MATERIALS_FOLDER_NAME);
        return folder;
      } catch (e) {
        // ID が無効な場合は名前検索へ
      }
    }

    const folder = findChildFolderByName_(parentFolder, MATERIALS_FOLDER_NAME);
    if (folder) {
      props.setProperty(PROP.MATERIALS_FOLDER_ID, folder.getId());
      reused.push(MATERIALS_FOLDER_NAME);
      return folder;
    }
  }

  const folder = parentFolder.createFolder(MATERIALS_FOLDER_NAME);
  props.setProperty(PROP.MATERIALS_FOLDER_ID, folder.getId());
  created.push(MATERIALS_FOLDER_NAME);
  return folder;
}

function getOrCreateManagementBook_(parentFolder, force, created, reused) {
  const props = PropertiesService.getScriptProperties();

  if (!force) {
    const existingId = props.getProperty(PROP.SPREADSHEET_ID);
    if (existingId) {
      try {
        reused.push(MANAGEMENT_BOOK_NAME);
        return SpreadsheetApp.openById(existingId);
      } catch (e) {
        // ID が無効な場合は名前検索へ
      }
    }

    const existingFile = findChildSpreadsheetByName_(parentFolder, MANAGEMENT_BOOK_NAME);
    if (existingFile) {
      props.setProperty(PROP.SPREADSHEET_ID, existingFile.getId());
      reused.push(MANAGEMENT_BOOK_NAME);
      return SpreadsheetApp.open(existingFile);
    }
  }

  const ss = createSpreadsheetInFolder_(MANAGEMENT_BOOK_NAME, parentFolder);
  props.setProperty(PROP.SPREADSHEET_ID, ss.getId());
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
  // 正誤判断指摘訂正: 4択と同じデータ形式。空所に正答かダミーを当てはめた英文を提示し、
  // ユーザーが最終確定した英文が正答文と一致するかで判定する
  function correction(id, ja, template, answer, dummies, hint) {
    return row(id, '正誤判断指摘訂正', ja, '', template, answer, [], dummies, '', hint);
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
        typing(5, '彼女は歌手です。', 'She ( ) a singer.', 'is', ''),
        correction(6, '彼らは野球選手です。', 'They ( ) baseball players.', 'are', ['is', 'am'], '主語が複数のときの be 動詞')
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
        typing(4, '私たちはきのう食べた。', 'We ( ) yesterday.', 'ate', 'eat の過去形'),
        correction(5, '彼はきのうそこへ行った。', 'He ( ) there yesterday.', 'went', ['go', 'goes'], '過去形に注意')
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

// =========================================================
// ⑧ 単語学習（vocabulary）フォルダ・ブック管理
// =========================================================

function getVocabularyFolder() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty(PROP.VOCABULARY_FOLDER_ID);
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // fall through
    }
  }

  const parentFolder = getScriptParentFolder_();
  const folder = findChildFolderByName_(parentFolder, VOCABULARY_FOLDER_NAME);
  if (folder) {
    props.setProperty(PROP.VOCABULARY_FOLDER_ID, folder.getId());
    props.setProperty(PROP.PARENT_FOLDER_ID, parentFolder.getId());
    return folder;
  }

  throw new Error('vocabularyフォルダが見つかりません。setupEnvironment() を実行してください。');
}

/** vocabulary フォルダと登録ブック（マイ単語帳）が実在するか */
function vocabularyResourcesReady_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty(PROP.VOCABULARY_FOLDER_ID);
  const bookId = props.getProperty(PROP.MY_VOCAB_BOOK_ID);
  if (!folderId || !bookId) return false;
  try {
    DriveApp.getFolderById(folderId);
    SpreadsheetApp.openById(bookId);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * vocabulary フォルダ・登録ブック未作成の既存環境向け遅延セットアップ。
 * 登録ブック（マイ単語帳）が無いときは、見出しを整えた「サンプル」シートに
 * 10単語分のサンプルデータを流し込んだ状態で作成する。
 */
function ensureVocabularyResources_() {
  if (vocabularyResourcesReady_()) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (vocabularyResourcesReady_()) return;

    const props = PropertiesService.getScriptProperties();
    const created = [];
    const reused = [];

    const parentFolder = getScriptParentFolder_();
    const vocabularyFolder = getOrCreateVocabularyFolder_(parentFolder, false, created, reused);
    props.setProperty(PROP.VOCABULARY_FOLDER_ID, vocabularyFolder.getId());

    const myVocabBook = getOrCreateMyVocabBook_(vocabularyFolder, false, created, reused);
    props.setProperty(PROP.MY_VOCAB_BOOK_ID, myVocabBook.getId());

    const sampleVocabBookIds = ensureSampleVocabBooks_(vocabularyFolder, false, created, reused);
    props.setProperty(PROP.SAMPLE_VOCAB_BOOK_IDS, JSON.stringify(sampleVocabBookIds));
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateVocabularyFolder_(parentFolder, force, created, reused) {
  const props = PropertiesService.getScriptProperties();

  if (!force) {
    const existingId = props.getProperty(PROP.VOCABULARY_FOLDER_ID);
    if (existingId) {
      try {
        const folder = DriveApp.getFolderById(existingId);
        reused.push(VOCABULARY_FOLDER_NAME);
        return folder;
      } catch (e) {
        // fall through
      }
    }

    const folder = findChildFolderByName_(parentFolder, VOCABULARY_FOLDER_NAME);
    if (folder) {
      props.setProperty(PROP.VOCABULARY_FOLDER_ID, folder.getId());
      reused.push(VOCABULARY_FOLDER_NAME);
      return folder;
    }
  }

  const existing = findChildFolderByName_(parentFolder, VOCABULARY_FOLDER_NAME);
  if (existing && !force) {
    props.setProperty(PROP.VOCABULARY_FOLDER_ID, existing.getId());
    reused.push(VOCABULARY_FOLDER_NAME);
    return existing;
  }

  const folder = existing || parentFolder.createFolder(VOCABULARY_FOLDER_NAME);
  props.setProperty(PROP.VOCABULARY_FOLDER_ID, folder.getId());
  if (existing) reused.push(VOCABULARY_FOLDER_NAME);
  else created.push(VOCABULARY_FOLDER_NAME);
  return folder;
}

function getOrCreateMyVocabBook_(vocabularyFolder, force, created, reused) {
  const props = PropertiesService.getScriptProperties();

  let ss = null;

  if (!force) {
    const existingId = props.getProperty(PROP.MY_VOCAB_BOOK_ID);
    if (existingId) {
      try {
        ss = SpreadsheetApp.openById(existingId);
        reused.push(MY_VOCAB_BOOK_NAME);
      } catch (e) {
        ss = null;
      }
    }
  }

  if (!ss) {
    const existingFile = findChildSpreadsheetByName_(vocabularyFolder, MY_VOCAB_BOOK_NAME);
    if (existingFile) {
      ss = SpreadsheetApp.open(existingFile);
      reused.push(MY_VOCAB_BOOK_NAME);
    } else {
      ss = createSpreadsheetInFolder_(MY_VOCAB_BOOK_NAME, vocabularyFolder);
      created.push(MY_VOCAB_BOOK_NAME);
    }
  }

  ensureMyVocabDefaultSheet_(ss);
  ensureMyVocabSampleSheet_(ss);
  props.setProperty(PROP.MY_VOCAB_BOOK_ID, ss.getId());
  return ss;
}

function ensureMyVocabDefaultSheet_(ss) {
  let sheet = ss.getSheetByName('デフォルト');
  if (!sheet) {
    const sheets = ss.getSheets();
    if (sheets.length === 1 && sheets[0].getName() === 'シート1') {
      sheet = sheets[0];
      sheet.setName('デフォルト');
    } else {
      sheet = ss.insertSheet('デフォルト');
    }
  }
  ensureVocabSheetHeader_(sheet);
}

/**
 * マイ単語帳に「サンプル」シートを用意する。
 * 空（またはヘッダのみ）のときだけ、見出しを整えたうえで
 * 22列仕様どおりに埋めた10単語分のサンプルデータを流し込む。
 * ユーザーが編集した既存データは上書きしない。
 */
function ensureMyVocabSampleSheet_(ss) {
  let sheet = ss.getSheetByName('サンプル');
  if (!sheet) {
    sheet = ss.insertSheet('サンプル');
  }

  const lastRow = sheet.getLastRow();
  const firstCell = lastRow > 0 ? sheet.getRange(1, 1).getValue() : '';
  if (lastRow <= 1 && (firstCell === '' || firstCell === '通し番号')) {
    const rows = [VOCAB_HEADERS].concat(getSampleVocabWords_());
    sheet.clear();
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    ensureVocabSheetHeader_(sheet);
  }
}

function ensureVocabSheetHeader_(sheet) {
  const firstCell = sheet.getLastRow() > 0 ? sheet.getRange(1, 1).getValue() : '';
  if (firstCell !== '通し番号') {
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(VOCAB_HEADERS);
    } else {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, VOCAB_HEADERS.length).setValues([VOCAB_HEADERS]);
    }
    sheet.getRange(1, 1, 1, VOCAB_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function ensureSampleVocabBooks_(vocabularyFolder, force, created, reused) {
  const catalog = getSampleVocabCatalog_();
  const bookIds = {};

  Object.keys(catalog).forEach(function (bookName) {
    let file = findChildSpreadsheetByName_(vocabularyFolder, bookName);
    let ss;

    if (file && !force) {
      ss = SpreadsheetApp.open(file);
      reused.push(bookName);
    } else if (file && force) {
      ss = SpreadsheetApp.open(file);
      reused.push(bookName + '(更新)');
    } else {
      ss = createSpreadsheetInFolder_(bookName, vocabularyFolder);
      created.push(bookName);
    }

    ensureSampleVocabSheets_(ss, catalog[bookName]);
    bookIds[bookName] = ss.getId();
  });

  return bookIds;
}

function ensureSampleVocabSheets_(ss, sheetsData) {
  const sheetNames = Object.keys(sheetsData);
  sheetNames.forEach(function (sheetName, index) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      if (index === 0 && ss.getSheetByName('シート1')) {
        sheet = ss.getSheetByName('シート1');
        sheet.setName(sheetName);
      } else {
        sheet = ss.insertSheet(sheetName);
      }
    }

    const lastRow = sheet.getLastRow();
    const firstCell = lastRow > 0 ? sheet.getRange(1, 1).getValue() : '';
    if (lastRow <= 1 && (firstCell === '' || firstCell === '通し番号')) {
      const rows = sheetsData[sheetName];
      sheet.clear();
      sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
      sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    } else {
      ensureVocabSheetHeader_(sheet);
    }
  });

  const leftover = ss.getSheetByName('シート1');
  if (leftover && ss.getSheets().length > 1) {
    ss.deleteSheet(leftover);
  }
}

/** サンプル単語1行を22列配列に組み立てる */
function sampleVocabRow_(id, dai, chu, sho, word, noun, verb, adj, adv, prep, conj, other, idiom, memo, syn, ant, deriv, def, chunk, chunkJa, ex, exJa) {
  return [
    id, dai || UNREGISTERED, chu || UNREGISTERED, sho || UNREGISTERED, word,
    noun || UNREGISTERED, verb || UNREGISTERED, adj || UNREGISTERED,
    adv || UNREGISTERED, prep || UNREGISTERED, conj || UNREGISTERED,
    other || UNREGISTERED, idiom || UNREGISTERED,
    memo || UNREGISTERED, syn || UNREGISTERED, ant || UNREGISTERED, deriv || UNREGISTERED,
    def || UNREGISTERED, chunk || UNREGISTERED, chunkJa || UNREGISTERED,
    ex || UNREGISTERED, exJa || UNREGISTERED
  ];
}

/** 22列仕様に沿った10単語分のサンプルデータ（ヘッダなし） */
function getSampleVocabWords_() {
  return [
    sampleVocabRow_(1, '通常ステージ', 'Stage1', 'Lesson1', 'well',
      '井戸', '湧き出る', '健康な', '上手に・十分に', UNREGISTERED, UNREGISTERED, UNREGISTERED, 'ええと・さて',
      '名詞の「井戸」という意味に注意。間投詞は熟語・慣用表現として扱う。',
      UNREGISTERED, 'badly,ill', 'wellness,better,best',
      'in a good or satisfactory way',
      'She sings (well).', '彼女は(上手に)歌う。',
      'The water in the (well) is clean.', 'その(井戸)の水はきれいだ。'),
    sampleVocabRow_(2, '通常ステージ', 'Stage1', 'Lesson1', 'book',
      '本', '予約する', UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED,
      '動詞「予約する」の意味も重要。',
      'volume,reserve', UNREGISTERED, 'booklet,booking',
      'a set of printed pages bound together',
      'read a (book)', '(本)を読む',
      'I bought a new (book) yesterday.', '昨日新しい(本)を買った。'),
    sampleVocabRow_(3, '通常ステージ', 'Stage1', 'Lesson1', 'run',
      '走ること・経営', '走る・経営する', UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED,
      '「経営する」の意味にも注意。',
      'sprint,manage', 'walk', 'runner,running',
      'to move quickly on foot',
      '(run) a company', '会社を(経営する)',
      'He (runs) every morning.', '彼は毎朝(走る)。'),
    sampleVocabRow_(4, '通常ステージ', 'Stage1', 'Lesson1', 'happy',
      UNREGISTERED, UNREGISTERED, '幸せな・うれしい', UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED,
      '感情を表す基本的な形容詞。',
      'glad,joyful', 'sad,unhappy', 'happily,happiness',
      'feeling or showing pleasure',
      'a (happy) child', '(幸せな)子供',
      'She looks (happy) today.', '彼女は今日(うれしそう)に見える。'),
    sampleVocabRow_(5, '通常ステージ', 'Stage1', 'Lesson2', 'look up',
      UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED,
      '（辞書などで）調べる',
      '熟語として登録。6〜12列目はすべて(未登録)。',
      'search,check', UNREGISTERED, UNREGISTERED,
      'to search for information in a reference book or online',
      '(look up) a word', '単語を(調べる)',
      'Please (look up) this word in the dictionary.', '辞書でこの単語を(調べて)ください。'),
    sampleVocabRow_(6, '通常ステージ', 'Stage1', 'Lesson2', 'fast',
      UNREGISTERED, UNREGISTERED, '速い', '速く', UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED,
      '形容詞と副詞が同形。fastly という語は存在しない。',
      'quick,rapid', 'slow', 'faster,fastest',
      'moving or able to move quickly',
      'a (fast) runner', '(速い)走者',
      'He drives too (fast).', '彼は(速く)運転しすぎる。'),
    sampleVocabRow_(7, '通常ステージ', 'Stage1', 'Lesson2', 'water',
      '水', '水をやる', UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED,
      '不可算名詞。動詞「水をやる」の用法にも注意。',
      UNREGISTERED, UNREGISTERED, 'watery,waterfall',
      'a clear liquid that falls as rain and is essential for life',
      'drink (water)', '(水)を飲む',
      'She (waters) the flowers every day.', '彼女は毎日花に(水をやる)。'),
    sampleVocabRow_(8, '通常ステージ', 'Stage1', 'Lesson3', 'because',
      UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, '〜だから・〜なので', UNREGISTERED, UNREGISTERED,
      '理由を表す従属接続詞。because of は前置詞句として働く。',
      'since,as', UNREGISTERED, UNREGISTERED,
      'for the reason that',
      '(because) of the rain', '雨(のため)',
      'I stayed home (because) it was raining.', '雨が降っていた(ので)家にいた。'),
    sampleVocabRow_(9, '通常ステージ', 'Stage1', 'Lesson3', 'under',
      UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, '〜の下に・〜未満で', UNREGISTERED, UNREGISTERED, UNREGISTERED,
      '位置の「下」のほか「〜未満」「〜の状況下で」の意味もある。',
      'beneath,below', 'over,above', 'underground,underline',
      'in or to a position below something',
      '(under) the table', 'テーブル(の下に)',
      'The cat is sleeping (under) the chair.', '猫は椅子(の下で)眠っている。'),
    sampleVocabRow_(10, '通常ステージ', 'Stage1', 'Lesson3', 'give up',
      UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED, UNREGISTERED,
      'あきらめる・やめる',
      '熟語。代名詞目的語は give it up のように間に置く。',
      'quit,abandon', 'continue', UNREGISTERED,
      'to stop trying to do something',
      '(give up) smoking', '喫煙を(やめる)',
      'Never (give up) your dream.', '夢を(あきらめる)な。')
  ];
}

function getSampleVocabCatalog_() {
  return {
    'コーパス（サンプル）': {
      'コーパス': [VOCAB_HEADERS].concat(getSampleVocabWords_())
    }
  };
}

function openVocabBookByName_(bookName) {
  const vocabularyFolder = getVocabularyFolder();
  const files = vocabularyFolder.getFilesByName(bookName);
  if (!files.hasNext()) {
    throw new Error('単語ブックが見つかりません: ' + bookName);
  }
  return SpreadsheetApp.open(files.next());
}

function isMyVocabBook_(bookName) {
  return bookName === MY_VOCAB_BOOK_NAME;
}

function rowToVocabObject_(headers, row) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    if (headers[i]) obj[headers[i]] = row[i] !== undefined && row[i] !== null ? row[i] : '';
  }
  return obj;
}

function normalizeVocabField_(value) {
  if (value === null || value === undefined) return UNREGISTERED;
  const str = value.toString().trim();
  return str === '' ? UNREGISTERED : str;
}

function isMeaningRegistered_(value) {
  const str = normalizeVocabField_(value);
  return str !== UNREGISTERED;
}

function validateVocabInputRow_(rowObj) {
  const word = normalizeVocabField_(rowObj['英単語・熟語の表現']);
  if (word === UNREGISTERED) {
    throw new Error('英単語・熟語の表現（5列目）は必須です。');
  }

  const meaningKeys = [
    '意味＠名詞', '意味＠動詞', '意味＠形容詞', '意味＠副詞',
    '意味＠前置詞', '意味＠接続詞', '意味＠その他品詞', '意味＠熟語・慣用表現'
  ];
  const hasMeaning = meaningKeys.some(function (key) {
    return isMeaningRegistered_(rowObj[key]);
  });
  if (!hasMeaning) {
    throw new Error('6〜13列目のいずれか1つの意味は必須です: ' + word);
  }
}

function buildVocabRowFromInput_(rowObj) {
  validateVocabInputRow_(rowObj);
  const result = [];
  VOCAB_HEADERS.forEach(function (header, idx) {
    if (header === '通し番号') {
      result.push('');
      return;
    }
    result.push(normalizeVocabField_(rowObj[header]));
  });
  return result;
}

function renumberVocabSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const count = lastRow - 1;
  const numbers = [];
  for (let i = 1; i <= count; i++) {
    numbers.push([i]);
  }
  sheet.getRange(2, 1, count, 1).setValues(numbers);
}

function fetchVocabCatalogFromDrive_() {
  const vocabularyFolder = getVocabularyFolder();
  const props = PropertiesService.getScriptProperties();
  const myBookId = props.getProperty(PROP.MY_VOCAB_BOOK_ID);

  const presets = [];
  const userBooks = [];

  const files = vocabularyFolder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (files.hasNext()) {
    const file = files.next();
    const bookName = file.getName();
    const bookId = file.getId();
    const ss = SpreadsheetApp.open(file);
    const sheets = ss.getSheets();
    const sheetInfos = sheets.map(function (sheet) {
      return buildVocabSheetInfo_(sheet);
    });

    const bookInfo = {
      bookName: bookName,
      bookId: bookId,
      sheets: sheetInfos
    };

    if (bookId === myBookId || bookName === MY_VOCAB_BOOK_NAME) {
      userBooks.push(bookInfo);
    } else {
      presets.push(bookInfo);
    }
  }

  return { presets: presets, userBooks: userBooks };
}

function buildVocabSheetInfo_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return {
      sheetName: sheet.getName(),
      wordCount: 0,
      divisions: { dai: [], chu: [], sho: [] }
    };
  }

  const headers = data[0];
  const daiIdx = headers.indexOf('大区分');
  const chuIdx = headers.indexOf('中区分');
  const shoIdx = headers.indexOf('小区分');
  const wordIdx = headers.indexOf('英単語・熟語の表現');

  const daiSet = {};
  const chuSet = {};
  const shoSet = {};

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const word = wordIdx >= 0 ? row[wordIdx] : '';
    if (!word || word.toString().trim() === '') continue;

    const dai = daiIdx >= 0 ? normalizeVocabField_(row[daiIdx]) : UNREGISTERED;
    const chu = chuIdx >= 0 ? normalizeVocabField_(row[chuIdx]) : UNREGISTERED;
    const sho = shoIdx >= 0 ? normalizeVocabField_(row[shoIdx]) : UNREGISTERED;
    daiSet[dai] = true;
    chuSet[chu] = true;
    shoSet[sho] = true;
  }

  return {
    sheetName: sheet.getName(),
    wordCount: data.length - 1,
    divisions: {
      dai: Object.keys(daiSet).sort(),
      chu: Object.keys(chuSet).sort(),
      sho: Object.keys(shoSet).sort()
    }
  };
}

function fetchVocabWordsFromSheet_(params) {
  const bookName = params.bookName;
  const sheetName = params.sheetName;
  if (!bookName || !sheetName) {
    throw new Error('bookName と sheetName は必須です。');
  }
  const ss = openVocabBookByName_(bookName);
  const includeBookPool = String(params.includeBookPool || '') === '1' || params.includeBookPool === true;
  return fetchVocabWordsFromSpreadsheet_(ss, sheetName, params.filters || {}, includeBookPool);
}

function registerVocabWords_(sheetName, rows, ssOpt) {
  if (!sheetName) throw new Error('sheetName は必須です。');
  if (!rows || rows.length === 0) throw new Error('登録する単語がありません。');

  let ss = ssOpt;
  if (!ss) {
    const vocabularyFolder = getVocabularyFolder();
    const myFile = findChildSpreadsheetByName_(vocabularyFolder, MY_VOCAB_BOOK_NAME);
    if (!myFile) throw new Error('マイ単語帳が見つかりません。');
    ss = SpreadsheetApp.open(myFile);
  }
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(VOCAB_HEADERS);
    sheet.getRange(1, 1, 1, VOCAB_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    ensureVocabSheetHeader_(sheet);
  }

  const builtRows = rows.map(function (rowObj) {
    return buildVocabRowFromInput_(rowObj);
  });

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, builtRows.length, VOCAB_HEADERS.length).setValues(builtRows);
  renumberVocabSheet_(sheet);

  return { registeredCount: builtRows.length, sheetName: sheetName };
}

// =========================================================
// ⑨ ユーザー権限環境（GAS①・UserProperties + ユーザーDrive）
// =========================================================

function getPagesUrl_() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty(PROP.PAGES_URL) || DEFAULT_PAGES_URL;
}

function generateSessionToken_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function saveSessionToCache_(token, payload) {
  const json = JSON.stringify(payload);
  if (json.length > 95000) {
    throw new Error('セッションデータが大きすぎます（CacheService 100KB上限）');
  }
  CacheService.getScriptCache().put(SESSION_CACHE_PREFIX + token, json, SESSION_CACHE_TTL);
  return token;
}

function getSessionFromCache_(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get(SESSION_CACHE_PREFIX + token);
  if (!raw) return null;
  return JSON.parse(raw);
}

function saveResultToCache_(token, result) {
  CacheService.getScriptCache().put(RESULT_CACHE_PREFIX + token, JSON.stringify(result), RESULT_CACHE_TTL);
}

function getResultFromCache_(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get(RESULT_CACHE_PREFIX + token);
  if (!raw) return null;
  return JSON.parse(raw);
}

function normalizeForScoring_(s) {
  return (s || '').toString().toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

function scoreReadingTranscript_(sessionData, transcript) {
  const words = sessionData.words || [];
  const normalizedTranscript = normalizeForScoring_(transcript);
  let matched = 0;
  words.forEach(function (w) {
    const target = normalizeForScoring_(w['英単語・熟語の表現'] || '');
    if (target && normalizedTranscript.indexOf(target) >= 0) matched++;
  });
  const score = words.length > 0 ? Math.round((matched / words.length) * 100) : 0;
  return {
    score: score,
    matched: matched,
    total: words.length,
    transcript: transcript,
    mode: sessionData.mode || 'reading',
    setName: sessionData.setName || '',
    bookName: sessionData.bookName || '',
    sheetName: sessionData.sheetName || '',
    timestamp: new Date().toISOString()
  };
}

function handleScoreReading(requestData) {
  try {
    const token = requestData.token;
    const transcript = requestData.transcript || '';
    const session = getSessionFromCache_(token);
    if (!session) return sendResponse({ status: "error", message: "セッションが見つかりません" });
    const result = scoreReadingTranscript_(session, transcript);
    const resultToken = generateSessionToken_();
    result.sessionToken = token;
    saveResultToCache_(resultToken, result);
    return sendResponse({ status: "success", data: result, resultToken: resultToken });
  } catch (error) {
    return sendResponse({ status: "error", message: error.toString() });
  }
}

function ensureUserEnvironment_() {
  const props = PropertiesService.getUserProperties();
  let folderId = props.getProperty(USER_PROP.MY_DATA_FOLDER_ID);
  let folder = null;

  if (folderId) {
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (e) {
      folder = null;
    }
  }

  if (!folder) {
    const root = DriveApp.getRootFolder();
    folder = findChildFolderByName_(root, USER_DATA_FOLDER_NAME);
    if (!folder) folder = root.createFolder(USER_DATA_FOLDER_NAME);
    props.setProperty(USER_PROP.MY_DATA_FOLDER_ID, folder.getId());
  }

  const created = [];
  const reused = [];
  const vocabBook = getOrCreateMyVocabBook_(folder, false, created, reused);
  props.setProperty(USER_PROP.MY_VOCAB_BOOK_ID, vocabBook.getId());

  const logBook = getOrCreateUserLogBook_(folder, props);
  props.setProperty(USER_PROP.MY_LOG_BOOK_ID, logBook.getId());

  return {
    folderId: folder.getId(),
    vocabBookId: vocabBook.getId(),
    logBookId: logBook.getId()
  };
}

function getOrCreateUserLogBook_(folder, userProps) {
  let bookId = userProps.getProperty(USER_PROP.MY_LOG_BOOK_ID);
  if (bookId) {
    try {
      return SpreadsheetApp.openById(bookId);
    } catch (e) {
      // fall through
    }
  }

  const existing = findChildSpreadsheetByName_(folder, USER_LOG_BOOK_NAME);
  if (existing) return SpreadsheetApp.open(existing);

  const ss = createSpreadsheetInFolder_(USER_LOG_BOOK_NAME, folder);
  let sheet = ss.getSheets()[0];
  sheet.setName('学習記録');
  sheet.appendRow(['タイムスタンプ', '学習セット名', 'モード', '正答率', '解答時間', '詳細']);
  sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return ss;
}

function getUserVocabBook_() {
  ensureUserEnvironment_();
  const bookId = PropertiesService.getUserProperties().getProperty(USER_PROP.MY_VOCAB_BOOK_ID);
  return SpreadsheetApp.openById(bookId);
}

function getUserLogBook_() {
  ensureUserEnvironment_();
  const bookId = PropertiesService.getUserProperties().getProperty(USER_PROP.MY_LOG_BOOK_ID);
  return SpreadsheetApp.openById(bookId);
}

function fetchUserVocabCatalog_() {
  const ss = getUserVocabBook_();
  const sheetInfos = ss.getSheets().map(function (sheet) {
    return buildVocabSheetInfo_(sheet);
  });
  return {
    presets: [],
    userBooks: [{
      bookName: MY_VOCAB_BOOK_NAME,
      bookId: ss.getId(),
      sheets: sheetInfos
    }]
  };
}

function fetchUserVocabWordsFromSheet_(params) {
  const sheetName = params.sheetName;
  if (!sheetName) throw new Error('sheetName は必須です。');

  const ss = getUserVocabBook_();
  return fetchVocabWordsFromSpreadsheet_(ss, sheetName, params.filters || {}, !!params.includeBookPool);
}

function fetchVocabWordsFromSpreadsheet_(ss, sheetName, filters, includeBookPool) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('シートが見つかりません: ' + sheetName);

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { words: [], pool: [], bookPool: [] };

  const headers = data[0];
  const daiFilter = filters.dai || [];
  const chuFilter = filters.chu || [];
  const shoFilter = filters.sho || [];
  const words = [];
  const pool = [];

  for (let r = 1; r < data.length; r++) {
    const rowObj = rowToVocabObject_(headers, data[r]);
    const word = normalizeVocabField_(rowObj['英単語・熟語の表現']);
    if (word === UNREGISTERED) continue;
    rowObj._rowIndex = r + 1;
    pool.push(rowObj);

    const dai = normalizeVocabField_(rowObj['大区分']);
    const chu = normalizeVocabField_(rowObj['中区分']);
    const sho = normalizeVocabField_(rowObj['小区分']);
    if (daiFilter.length > 0 && daiFilter.indexOf(dai) === -1) continue;
    if (chuFilter.length > 0 && chuFilter.indexOf(chu) === -1) continue;
    if (shoFilter.length > 0 && shoFilter.indexOf(sho) === -1) continue;
    words.push(rowObj);
  }

  let bookPool = pool;
  if (includeBookPool) {
    bookPool = [];
    ss.getSheets().forEach(function (s) {
      const sData = s.getDataRange().getValues();
      if (sData.length <= 1) return;
      const sHeaders = sData[0];
      for (let r = 1; r < sData.length; r++) {
        const rowObj = rowToVocabObject_(sHeaders, sData[r]);
        const word = normalizeVocabField_(rowObj['英単語・熟語の表現']);
        if (word === UNREGISTERED) continue;
        rowObj._sheetName = s.getName();
        bookPool.push(rowObj);
      }
    });
  }

  return { words: words, pool: pool, bookPool: bookPool };
}

function registerUserVocabWords_(sheetName, rows) {
  const ss = getUserVocabBook_();
  return registerVocabWords_(sheetName, rows, ss);
}

function saveUserLearningLog_(result) {
  const ss = getUserLogBook_();
  let sheet = ss.getSheetByName('学習記録');
  if (!sheet) {
    sheet = ss.insertSheet('学習記録');
    sheet.appendRow(['タイムスタンプ', '学習セット名', 'モード', '正答率', '解答時間', '詳細']);
  }
  const timeStr = Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm:ss');
  sheet.appendRow([
    timeStr,
    result.setName || '',
    result.mode || '',
    result.score != null ? result.score : (result.correctRate || ''),
    result.timeTaken || '',
    JSON.stringify(result)
  ]);
}

function fetchUserLearningLogs_() {
  const ss = getUserLogBook_();
  const sheet = ss.getSheetByName('学習記録');
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const logs = [];
  for (let i = data.length - 1; i >= 1 && logs.length < 20; i--) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) obj[headers[j]] = data[i][j];
    }
    logs.push(obj);
  }
  return logs;
}

function buildSessionPayload_(params) {
  const mode = params.mode || 'reading';
  const sheetName = params.sheetName;
  if (!sheetName) throw new Error('sheetName は必須です');

  const filters = params.filters || {};
  const wordData = fetchUserVocabWordsFromSheet_({
    sheetName: sheetName,
    filters: filters,
    includeBookPool: true
  });

  if (!wordData.words || wordData.words.length === 0) {
    throw new Error('出題できる単語がありません');
  }

  return {
    mode: mode,
    setName: MY_VOCAB_BOOK_NAME + ' / ' + sheetName,
    bookName: MY_VOCAB_BOOK_NAME,
    sheetName: sheetName,
    filters: filters,
    words: wordData.words,
    pool: wordData.pool,
    bookPool: wordData.bookPool,
    options: params.options || {},
    createdAt: new Date().toISOString(),
    userEmail: Session.getActiveUser().getEmail() || ''
  };
}

// =========================================================
// ⑦ HtmlService クライアント用 API（google.script.run）
// =========================================================

function parseApiResponse_(output) {
  if (output && typeof output.getContent === 'function') {
    return JSON.parse(output.getContent());
  }
  return output;
}

function apiGetQuestions(subject, unit) {
  ensureEnvironment();
  try {
    const data = fetchQuestionsFromSheet({ subject: subject, unit: unit });
    return { status: 'success', data: data };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiLogin(idToken) {
  ensureEnvironment();
  return parseApiResponse_(handleLogin({ idToken: idToken }));
}

function apiSaveResult(results) {
  ensureEnvironment();
  return parseApiResponse_(handleSaveResult({ results: results }));
}

function apiSaveSessionLog(email, setName, correctRate, timeTaken) {
  ensureEnvironment();
  return parseApiResponse_(handleSaveSessionLog({ email: email, setName: setName, correctRate: correctRate, timeTaken: timeTaken }));
}

function apiGetUserLogs(email) {
  ensureEnvironment();
  return parseApiResponse_(handleGetUserLogs({ email: email }));
}

function apiGetCatalog() {
  ensureEnvironment();
  try {
    const data = fetchCatalogFromDrive();
    return { status: 'success', data: data };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiGetVocabCatalog() {
  ensureEnvironment();
  try {
    const data = fetchVocabCatalogFromDrive_();
    return { status: 'success', data: data };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiGetVocabWords(bookName, sheetName, filtersJson, includeBookPool) {
  ensureEnvironment();
  try {
    const filters = filtersJson ? JSON.parse(filtersJson) : {};
    const data = fetchVocabWordsFromSheet_({
      bookName: bookName,
      sheetName: sheetName,
      filters: filters,
      includeBookPool: includeBookPool ? '1' : '0'
    });
    return { status: 'success', data: data };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiRegisterVocabWords(sheetName, rowsJson) {
  ensureEnvironment();
  try {
    const rows = rowsJson ? JSON.parse(rowsJson) : [];
    const data = registerVocabWords_(sheetName, rows);
    return { status: 'success', data: data };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

// --- GAS① ユーザー権限 API（dashboard / google.script.run） ---

function apiUserGetVocabCatalog() {
  try {
    const data = fetchUserVocabCatalog_();
    return { status: 'success', data: data };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiUserGetVocabWords(sheetName, filtersJson) {
  try {
    const filters = filtersJson ? JSON.parse(filtersJson) : {};
    const data = fetchUserVocabWordsFromSheet_({
      sheetName: sheetName,
      filters: filters,
      includeBookPool: true
    });
    return { status: 'success', data: data };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiUserRegisterVocabWords(sheetName, rowsJson) {
  try {
    const rows = rowsJson ? JSON.parse(rowsJson) : [];
    const data = registerUserVocabWords_(sheetName, rows);
    return { status: 'success', data: data };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiUserGetLearningLogs() {
  try {
    const data = fetchUserLearningLogs_();
    return { status: 'success', data: data };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiStartSession(payloadJson) {
  try {
    const params = payloadJson ? JSON.parse(payloadJson) : {};
    const payload = buildSessionPayload_(params);
    const token = generateSessionToken_();
    saveSessionToCache_(token, payload);
    return { status: 'success', token: token, pagesUrl: getPagesUrl_() };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiSaveSessionResult(resultToken) {
  try {
    if (!resultToken) return { status: 'error', message: 'resultToken が必要です' };
    const result = getResultFromCache_(resultToken);
    if (!result) return { status: 'error', message: '結果が見つかりません（期限切れの可能性）' };
    saveUserLearningLog_(result);
    CacheService.getScriptCache().remove(RESULT_CACHE_PREFIX + resultToken);
    return { status: 'success', data: result };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiGetPagesUrl() {
  return { status: 'success', url: getPagesUrl_() };
}