// code.gs 統合版

/** アプリ表示名 */
const APP_NAME = 'DigitalDrill（デジドリ）';

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
  SAMPLE_CATALOG_VERSION: 'SAMPLE_CATALOG_VERSION',
  SETUP_COMPLETED: 'SETUP_COMPLETED',
  PAGES_URL: 'PAGES_URL',
  ADMIN_EMAIL: 'ADMIN_EMAIL',
  WHITELIST_CACHE: 'WHITELIST_CACHE'
};

/** ユーザー権限実行時の UserProperties キー */
const USER_PROP = {
  MY_DATA_FOLDER_ID: 'MY_DATA_FOLDER_ID',
  MY_VOCAB_BOOK_ID: 'MY_VOCAB_BOOK_ID',
  MY_LOG_BOOK_ID: 'MY_LOG_BOOK_ID'
};

const USER_DATA_FOLDER_NAME = 'DigitalDrill_MyData';
const USER_LOG_BOOK_NAME = 'DigitalDrill学習記録';
const SESSION_CACHE_PREFIX = 'sess_';
const RESULT_CACHE_PREFIX = 'result_';
const AUTH_CACHE_PREFIX = 'auth_';
const SRS_SYNC_CACHE_PREFIX = 'srs_sync_';
const SESSION_CACHE_TTL = 21600;
const RESULT_CACHE_TTL = 21600;
const SRS_SYNC_CACHE_TTL = 3600;
/** 認証トークン有効期間: 1時間半（5400秒） */
const AUTH_CACHE_TTL = 5400;
const DEFAULT_PAGES_URL = 'https://snakamurako-coder.github.io/grammarquiz/';

/** index.html の GOOGLE_CLIENT_ID と揃える（Script Properties 未設定時の既定値） */
const DEFAULT_CLIENT_ID = '505252303455-84r495bnnsgiefcrv24ro2qtohlgbk2h.apps.googleusercontent.com';
/** GAS① ユーザー権限デプロイ（config.js の DASHBOARD_URL と同一） */
const DEFAULT_DASHBOARD_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxN9pnUp_mG6QHBKJz2WPaS-YqZlrhUaSI1XjTc3aXbmivNowfQPAi1Vi0WmpmfcDSo/exec';

const MATERIALS_FOLDER_NAME = 'grammarquizzes';
/** 旧フォルダ名（既存環境からの自動リネーム用） */
const LEGACY_MATERIALS_FOLDER_NAME = 'materials';
const VOCABULARY_FOLDER_NAME = 'vocabulary';
/** 本体スプレッドシート（whitelist・成績・ログ） */
const APP_BOOK_NAME = 'DigitalDrill';
/** 旧ファイル名（初回検出時に APP_BOOK_NAME へ改名して再利用） */
const LEGACY_APP_BOOK_NAMES = ['DigitalDrill管理', 'BrightStage管理'];
const LEGACY_USER_DATA_FOLDER_NAMES = ['BrightStage_MyData'];
const LEGACY_USER_LOG_BOOK_NAMES = ['BrightStage学習記録'];
const MY_VOCAB_BOOK_NAME = 'マイ単語帳';
const UNREGISTERED = '(未登録)';
const USER_SRS_SHEET_NAME = 'SRS状態';
const ADMIN_SRS_LOG_SHEET = 'SRSログ';
const SRS_STATE_HEADERS = ['Word_ID', 'Step_Index', 'EF', 'Next_Review', 'History', 'Avg_Time'];
const ADMIN_SRS_HEADERS = ['Log_ID', 'User_ID', 'Set_ID', 'Score', 'Attempts', 'Timestamp'];
const SCORE_HEADERS = [
  'タイムスタンプ', 'ユーザーID', '問題ID', '学年科目', '単元', '正誤判定', '出題モード',
  '出題形式', '難易度', 'ターゲット文法領域'
];

/** 文法データセット11列ヘッダ。1行が形式A〜Hすべての素材になる */
const GRAMMAR_HEADERS = [
  '通し番号', '大単元', '小単元', '英文全文', '日本語訳',
  '並び替え文', '並び替えダミー', 'N択文', 'N択ダミー',
  'ターゲット文法領域', '解説'
];

/** 文法サンプルカタログの版。変更時は ensureEnvironment が Drive 上のブックを再同期する */
const SAMPLE_CATALOG_VERSION = '2026-infinitive-only-v1';

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

  if (action === 'applySrsSync') {
    return handleApplySrsSync_(e);
  }

  // 認証系は ensureEnvironment を通さない（GAS① ユーザー権限で Drive 初期化が失敗し得る）
  if (action === 'auth') {
    return handleAuthRedirect_();
  }
  if (action === 'getAuthUser') {
    try {
      const token = e.parameter.token;
      const auth = validateAuthToken_(token);
      if (!auth) return sendResponse({ status: "error", message: "認証トークンが無効または期限切れです" });
      return sendResponse({ status: "success", user: auth.user, email: auth.email });
    } catch (error) {
      return sendResponse({ status: "error", message: error.toString() });
    }
  }
  if (action === 'logout') {
    const token = e.parameter.token;
    if (token) invalidateAuthToken_(token);
    return sendResponse({ status: "success", message: "ログアウトしました" });
  }

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

  const access = checkDashboardAccess_();
  if (!access.allowed) {
    return renderAccessDeniedPage_(access.email, access.reason);
  }

  const template = HtmlService.createTemplateFromFile('dashboard');
  template.PAGES_URL = getPagesUrl_();
  template.RESULT_TOKEN = (e && e.parameter && e.parameter.result_token) ? e.parameter.result_token : '';
  // googleusercontent の echo URL ではなく /exec の正規 URL を使う（クエリ破壊・白紙防止）
  template.AUTH_URL = ScriptApp.getService().getUrl() + '?action=auth';
  return template.evaluate()
    .setTitle(APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

const GRAMMAR_BRACKET_RE = /[(（][^)）]*[)）]/;

/** "He wants (a,b,c)." → { prefix: 'He wants', inner: 'a,b,c', suffix: '.' } */
function parseBracketSentence_(text) {
  const s = (text || '').toString().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = s.match(GRAMMAR_BRACKET_RE);
  if (!m) return null;
  return {
    prefix: s.slice(0, m.index).trim(),
    inner: m[0].slice(1, -1).trim(),
    suffix: s.slice(m.index + m[0].length).trim()
  };
}

/** カンマ区切り文字列を語句配列に */
function splitGrammarList_(text) {
  return (text || '').toString().split(/[,、，]/)
    .map(function (s) { return s.replace(/\s+/g, ' ').trim(); })
    .filter(function (s) { return s !== ''; });
}

/** prefix + 中身 + suffix を英文として連結（句読点は詰めて連結） */
function joinGrammarSentence_(prefix, inner, suffix) {
  let s = prefix ? (inner ? prefix + ' ' + inner : prefix) : inner;
  if (suffix) {
    s += /^[.,!?;:]/.test(suffix) ? suffix : ' ' + suffix;
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** 整合性チェック用のゆるい正規化 */
function normalizeGrammarSentence_(s) {
  return (s || '').toString().toLowerCase()
    .replace(/[.,!?;:"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

    const headers = data[0].map(function (h) { return (h === null || h === undefined) ? '' : h.toString().trim(); });
    const colIndex = {};
    GRAMMAR_HEADERS.forEach(function (name) { colIndex[name] = headers.indexOf(name); });

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      const cell = function (name) {
        const i = colIndex[name];
        if (i === -1) return '';
        const v = row[i];
        return (v === null || v === undefined) ? '' : v.toString().replace(/\s+/g, ' ').trim();
      };

      const id = cell('通し番号');
      const fullSentence = cell('英文全文');
      const japanese = cell('日本語訳');
      if (!id || !fullSentence || !japanese) continue;

      const sort = parseBracketSentence_(cell('並び替え文'));
      const mcq = parseBracketSentence_(cell('N択文'));
      const sortTokens = sort ? splitGrammarList_(sort.inner) : [];
      const sortDummy = cell('並び替えダミー');
      const mcqAnswer = mcq ? mcq.inner : '';
      const mcqDummies = splitGrammarList_(cell('N択ダミー'));

      const warnings = [];
      if (sort && normalizeGrammarSentence_(joinGrammarSentence_(sort.prefix, sortTokens.join(' '), sort.suffix)) !== normalizeGrammarSentence_(fullSentence)) {
        warnings.push('並び替え文を組み立てても英文全文と一致しません');
      }
      if (mcq && normalizeGrammarSentence_(joinGrammarSentence_(mcq.prefix, mcqAnswer, mcq.suffix)) !== normalizeGrammarSentence_(fullSentence)) {
        warnings.push('N択文を組み立てても英文全文と一致しません');
      }

      const hasSort = sortTokens.length > 0;
      const hasMcq = mcqAnswer !== '';

      questions.push({
        rowId: sheetName + '#' + id,
        id: id,
        unit: sheetName,
        daiUnit: cell('大単元'),
        shoUnit: cell('小単元'),
        fullSentence: fullSentence,
        japanese: japanese,
        grammarArea: cell('ターゲット文法領域'),
        explanation: cell('解説'),
        sortPrefix: sort ? sort.prefix : '',
        sortTokens: sortTokens,
        sortSuffix: sort ? sort.suffix : '',
        sortDummy: sortDummy,
        mcqPrefix: mcq ? mcq.prefix : '',
        mcqAnswer: mcqAnswer,
        mcqSuffix: mcq ? mcq.suffix : '',
        mcqDummies: mcqDummies,
        available: {
          A: true,
          B: hasSort,
          C: sortTokens.length >= 2,
          D: hasSort && sortDummy !== '',
          E: hasSort,
          F: hasMcq,
          G: hasMcq && mcqDummies.length >= 1,
          H: hasMcq && mcqDummies.length >= 1
        },
        warnings: warnings
      });
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
    const requestData = JSON.parse(e.postData.contents);
    const action = requestData.action;

    if (action === "login") {
      ensureEnvironment();
      return handleLogin(requestData);
    }

    ensureEnvironment();

    // アクション（目的）によって処理を振り分ける
    if (action === "saveResult") {
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
    } else if (action === "logout") {
      if (requestData.authToken) invalidateAuthToken_(requestData.authToken);
      return sendResponse({ status: "success", message: "ログアウトしました" });
    } else if (action === "saveSrsLog") {
      return handleSaveSrsLog_(requestData);
    } else if (action === "queueSrsBulk") {
      return handleQueueSrsBulk_(requestData);
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
/** Google ID トークンでログイン（GAS② POST・getActiveUser 不要） */
function handleLogin(requestData) {
  const idToken = requestData.idToken;
  if (!idToken) return sendResponse({ status: 'error', message: 'IDトークンがありません' });

  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty(PROP.CLIENT_ID) || DEFAULT_CLIENT_ID;
  const tokenInfoUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  const tokenResponse = UrlFetchApp.fetch(tokenInfoUrl, { muteHttpExceptions: true });
  if (tokenResponse.getResponseCode() !== 200) {
    return sendResponse({ status: 'error', message: '無効なトークンです' });
  }

  const tokenData = JSON.parse(tokenResponse.getContentText());
  if (tokenData.aud !== clientId) {
    return sendResponse({ status: 'error', message: '不正なアクセスです' });
  }

  const userEmail = String(tokenData.email || '').trim().toLowerCase();
  if (!userEmail) {
    return sendResponse({ status: 'error', message: 'メールアドレスを取得できません' });
  }

  syncWhitelistCache_();

  if (!isWhitelistedOrAdmin_(userEmail)) {
    return sendResponse({
      status: 'error',
      message: '許可されていないユーザーです',
      code: 'not_whitelisted',
      email: userEmail
    });
  }

  try {
    const authToken = issueAuthToken_(userEmail);
    const user = getWhitelistUserProfile_(userEmail);
    return sendResponse({
      status: 'success',
      authToken: authToken,
      user: user,
      email: userEmail,
      message: '認証成功'
    });
  } catch (e) {
    return sendResponse({ status: 'error', message: e.message || String(e) });
  }
}

// =========================================================
// ①-2 ホワイトリスト認可ヘルパー
//   GAS①（ユーザー権限実行）は本体スプレッドシートを直接開けないため、
//   GAS②（作成者権限）実行時に Script Properties へキャッシュしておき、
//   GAS① はキャッシュを参照して入口で判定する。
// =========================================================

/** 管理者メールアドレス（setup 実行者）を小文字で返す */
function getAdminEmail_() {
  return String(PropertiesService.getScriptProperties().getProperty(PROP.ADMIN_EMAIL) || '').trim().toLowerCase();
}

function isAdminEmail_(email) {
  const admin = getAdminEmail_();
  return !!admin && String(email || '').trim().toLowerCase() === admin;
}

/** whitelist シートから許可メール一覧（小文字）を読み取る。本体スプレッドシートへのアクセス権が必要 */
function readWhitelistEmailsFromSheet_() {
  const spreadId = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
  if (!spreadId) throw new Error('SPREADSHEET_IDが設定されていません');
  const sheet = SpreadsheetApp.openById(spreadId).getSheetByName('whitelist');
  if (!sheet) throw new Error('whitelistシートが見つかりません');
  const data = sheet.getDataRange().getValues();
  const accountIdx = data[0].indexOf('account');
  if (accountIdx === -1) throw new Error('account列がありません');
  const emails = [];
  for (let i = 1; i < data.length; i++) {
    const v = String(data[i][accountIdx] || '').trim().toLowerCase();
    if (v) emails.push(v);
  }
  return emails;
}

/** whitelist を Script Properties にキャッシュ（本体スプレッドシートを開けない実行文脈では何もしない） */
function syncWhitelistCache_() {
  try {
    const emails = readWhitelistEmailsFromSheet_();
    PropertiesService.getScriptProperties().setProperty(PROP.WHITELIST_CACHE, JSON.stringify(emails));
  } catch (e) {
    // ユーザー権限実行時など。既存キャッシュを維持
  }
}

/** GAS② の通常リクエストに便乗して10分間隔でキャッシュを更新 */
function syncWhitelistCacheIfStale_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('whitelist_cache_fresh')) return;
  syncWhitelistCache_();
  cache.put('whitelist_cache_fresh', '1', 600);
}

/** メールが whitelist または管理者に含まれるか（シート読取不可時はキャッシュにフォールバック） */
function isWhitelistedOrAdmin_(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  if (isAdminEmail_(normalized)) return true;
  let emails;
  try {
    emails = readWhitelistEmailsFromSheet_();
  } catch (e) {
    try {
      const raw = PropertiesService.getScriptProperties().getProperty(PROP.WHITELIST_CACHE);
      emails = raw ? JSON.parse(raw) : [];
    } catch (e2) {
      emails = [];
    }
  }
  return emails.indexOf(normalized) !== -1;
}

/**
 * ログイン中ユーザーのメール（小文字）。
 * GAS②（作成者実行・匿名アクセス可）では常に空になるため、Pages では ID トークン認証を使う。
 */
function getActiveUserEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

/** GAS① ダッシュボードのアクセス判定（管理者は常に許可・匿名は拒否） */
function checkDashboardAccess_() {
  const email = getActiveUserEmail_();
  if (!email) {
    return { allowed: false, email: '', reason: 'no_email' };
  }
  const allowed = isWhitelistedOrAdmin_(email);
  return {
    allowed: allowed,
    email: email,
    reason: allowed ? 'ok' : 'not_whitelisted'
  };
}

/** アクセス拒否ページ */
function renderAccessDeniedPage_(email, reason) {
  let shown;
  if (reason === 'no_email') {
    shown =
      'Google アカウントのメールアドレスを取得できませんでした。<br>' +
      '<span style="font-size:.9em;font-weight:normal;">' +
      '学習画面（GitHub Pages）の「Googleアカウントでログイン」から認証してください。' +
      'GAS②（API・匿名アクセス可）の URL では <code>getActiveUser()</code> が空になります。' +
      '</span>';
  } else if (email) {
    shown = 'ログイン中のアカウント: <strong>' + email + '</strong>';
  } else {
    shown = 'アカウント情報を取得できませんでした。';
  }
  const html =
    '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
    '<body style="font-family:sans-serif;max-width:560px;margin:60px auto;padding:0 16px;text-align:center;">' +
    '<h1 style="font-size:1.4em;color:#2c3e50;">' + APP_NAME + '</h1>' +
    '<div style="background:#ffebee;color:#c62828;border-radius:12px;padding:24px;font-weight:bold;">' +
    '利用が許可されていないアカウントです。</div>' +
    '<p style="color:#555;margin-top:16px;">' + shown + '</p>' +
    '<p style="color:#777;font-size:.9em;">利用を希望する場合は、管理者に連絡してホワイトリストへの登録を依頼してください。</p>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(APP_NAME + ' - アクセス不可')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =========================================================
// ①-3 GAS① 認証ゲート＋短命トークン（Pages 連携）
// =========================================================

/** whitelist / 管理者からユーザープロフィールを取得 */
function getWhitelistUserProfile_(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  if (isAdminEmail_(normalized)) {
    return { account: normalized, name: '管理者', grade: '', class: '', role: 'admin' };
  }
  const spreadId = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
  if (!spreadId) return { account: normalized, name: '', grade: '', class: '' };
  try {
    const sheet = SpreadsheetApp.openById(spreadId).getSheetByName('whitelist');
    if (!sheet) return { account: normalized, name: '', grade: '', class: '' };
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const accountIdx = headers.indexOf('account');
    if (accountIdx === -1) return { account: normalized, name: '', grade: '', class: '' };
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][accountIdx] || '').trim().toLowerCase() === normalized) {
        const user = {};
        for (let j = 0; j < headers.length; j++) {
          if (headers[j]) user[headers[j]] = data[i][j];
        }
        return user;
      }
    }
  } catch (e) {
    // GAS① 実行文脈など
  }
  return { account: normalized, name: '', grade: '', class: '' };
}

/** 認証トークンを発行して CacheService に保存 */
function issueAuthToken_(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new Error('メールアドレスを取得できません');
  if (!isWhitelistedOrAdmin_(normalized)) throw new Error('許可されていないユーザーです');
  const user = getWhitelistUserProfile_(normalized);
  const token = generateSessionToken_();
  const now = Date.now();
  const payload = {
    email: normalized,
    user: user,
    issuedAt: now,
    expiresAt: now + AUTH_CACHE_TTL * 1000
  };
  CacheService.getScriptCache().put(AUTH_CACHE_PREFIX + token, JSON.stringify(payload), AUTH_CACHE_TTL);
  return token;
}

/** 認証トークンを検証（無効・期限切れなら null） */
function validateAuthToken_(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get(AUTH_CACHE_PREFIX + token);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/** 認証トークンを無効化（ログアウト用） */
function invalidateAuthToken_(token) {
  if (token) CacheService.getScriptCache().remove(AUTH_CACHE_PREFIX + token);
}

/**
 * POST 書き込みAPI用: authToken を検証
 * @return {{ok:boolean, auth?:Object, error?:string}}
 */
function requireAuthToken_(requestData) {
  const token = requestData.authToken;
  if (!token) return { ok: false, error: '認証トークンがありません' };
  const auth = validateAuthToken_(token);
  if (!auth) return { ok: false, error: '認証トークンが無効または期限切れです' };
  return { ok: true, auth: auth };
}

/** 認証直前に whitelist キャッシュを更新（GAS② ならシートから、GAS① なら既存キャッシュ維持） */
function warmWhitelistCacheForAuth_() {
  try {
    syncWhitelistCache_();
  } catch (e) {
    // GAS① などシートを開けない文脈では何もしない
  }
}

/** GAS①/GAS② ?action=auth → whitelist 確認後 Pages へリダイレクト */
function handleAuthRedirect_() {
  warmWhitelistCacheForAuth_();
  const access = checkDashboardAccess_();
  if (!access.allowed && access.reason === 'no_email') {
    const dashBase = String(DEFAULT_DASHBOARD_WEBAPP_URL).split('?')[0];
    const currentBase = String(ScriptApp.getService().getUrl()).split('?')[0];
    if (dashBase && currentBase && dashBase !== currentBase) {
      return renderAuthRedirectPage_(dashBase + '?action=auth');
    }
  }
  if (!access.allowed) {
    return renderAccessDeniedPage_(access.email, access.reason);
  }
  try {
    const token = issueAuthToken_(access.email);
    const pagesUrl = getPagesUrl_();
    const sep = pagesUrl.indexOf('?') >= 0 ? '&' : '?';
    const profile = getWhitelistUserProfile_(access.email) || { account: access.email };
    const compact = {
      account: profile.account || access.email,
      name: profile.name || '',
      grade: profile.grade || '',
      class: profile.class || ''
    };
    let target = pagesUrl + sep + 'auth=' + encodeURIComponent(token);
    target += '&authUser=' + encodeURIComponent(JSON.stringify(compact));
    return renderAuthRedirectPage_(target);
  } catch (e) {
    return renderAccessDeniedPage_(access.email, 'not_whitelisted');
  }
}

/** Pages への即時リダイレクト HTML（GAS iframe 外の top へ遷移） */
function renderAuthRedirectPage_(targetUrl) {
  const hrefAttr = String(targetUrl)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
  // JS 文字列用（JSON.stringify で安全にエスケープ）
  const jsUrl = JSON.stringify(String(targetUrl));
  const html =
    '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding:40px;">' +
    '<p>認証成功。学習画面へ移動しています...</p>' +
    '<p><a id="auth-go" target="_top" rel="noopener" href="' + hrefAttr + '">移動しない場合はこちら</a></p>' +
    '<script>(function(){var u=' + jsUrl + ';try{window.top.location.href=u;}catch(e){window.location.href=u;}})();</script>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(APP_NAME + ' - 認証中')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =========================================================
// 成績保存処理（Phase 5用・リファクタ版）
// =========================================================
function handleSaveResult(requestData) {
  const authCheck = requireAuthToken_(requestData);
  if (!authCheck.ok) return sendResponse({ status: "error", message: authCheck.error });
  const email = authCheck.auth.email;

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
    sheet.appendRow(SCORE_HEADERS);
  }

  const rows = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    rows.push([
      r.timestamp, 
      email,
      r.questionId, 
      r.subject, 
      r.unit, 
      r.isCorrect, 
      r.mode,
      r.questionFormat || '',
      r.difficulty || '',
      r.grammarArea || ''
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
  const authCheck = requireAuthToken_(requestData);
  if (!authCheck.ok) return sendResponse({ status: "error", message: authCheck.error });

  const sheetName = requestData.sheetName;
  const record = requestData.record;

  if (!sheetName || !record) return sendResponse({ status: "error", message: "sheetNameとrecordが必要です" });
  if (record.account !== undefined) record.account = authCheck.auth.email;

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
  const authCheck = requireAuthToken_(requestData);
  if (!authCheck.ok) return sendResponse({ status: "error", message: authCheck.error });
  const targetEmail = authCheck.auth.email;

  const sheetName = requestData.sheetName;
  if (!sheetName) return sendResponse({ status: "error", message: "sheetNameが必要です" });

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
  const authCheck = requireAuthToken_(requestData);
  if (!authCheck.ok) return sendResponse({ status: "error", message: authCheck.error });
  const email = authCheck.auth.email;

  const { setName, correctRate, timeTaken } = requestData;
  if (!setName) return sendResponse({ status: "error", message: "必須パラメータがありません" });

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
// ⑤ マイページ用ログ取得処理（文法: ログ + 単語SRS: SRSログ を統合）
// =========================================================
function normalizeLegacyLogRow_(rowObj) {
  return {
    タイムスタンプ: rowObj['タイムスタンプ'] != null ? rowObj['タイムスタンプ'] : '',
    学習セット名: rowObj['学習セット名'] != null ? rowObj['学習セット名'] : '',
    正答率: rowObj['正答率'] != null ? rowObj['正答率'] : '',
    解答時間: rowObj['解答時間'] != null ? rowObj['解答時間'] : '',
    実施回数: rowObj['実施回数'] != null ? rowObj['実施回数'] : '',
    source: 'grammar'
  };
}

function normalizeSrsLogRow_(rowObj) {
  return {
    タイムスタンプ: rowObj['Timestamp'] != null ? rowObj['Timestamp'] : '',
    学習セット名: rowObj['Set_ID'] != null ? rowObj['Set_ID'] : '',
    正答率: rowObj['Score'] != null ? rowObj['Score'] : '',
    解答時間: '',
    実施回数: rowObj['Attempts'] != null ? rowObj['Attempts'] : '',
    Log_ID: rowObj['Log_ID'] != null ? rowObj['Log_ID'] : '',
    source: 'vocab'
  };
}

function collectSheetLogsForEmail_(sheet, emailColName, email, normalizer) {
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf(emailColName);
  if (emailIdx === -1) return [];

  const logs = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][emailIdx] !== email) continue;
    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) rowObj[headers[j]] = data[i][j];
    }
    logs.push(normalizer(rowObj));
  }
  return logs;
}

function compareLogTimestamp_(a, b) {
  const ta = a['タイムスタンプ'] ? new Date(a['タイムスタンプ']).getTime() : 0;
  const tb = b['タイムスタンプ'] ? new Date(b['タイムスタンプ']).getTime() : 0;
  const na = isNaN(ta) ? 0 : ta;
  const nb = isNaN(tb) ? 0 : tb;
  return na - nb;
}

function handleGetUserLogs(requestData) {
  const authCheck = requireAuthToken_(requestData);
  if (!authCheck.ok) return sendResponse({ status: "error", message: authCheck.error });
  const email = authCheck.auth.email;

  const spreadId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadId) return sendResponse({ status: "error", message: "SPREADSHEET_IDが設定されていません。" });

  const ss = SpreadsheetApp.openById(spreadId);
  const legacySheet = ss.getSheetByName("ログ");
  const srsSheet = ss.getSheetByName(ADMIN_SRS_LOG_SHEET);

  const legacyLogs = collectSheetLogsForEmail_(legacySheet, 'メールアドレス', email, normalizeLegacyLogRow_);
  const srsLogs = collectSheetLogsForEmail_(srsSheet, 'User_ID', email, normalizeSrsLogRow_);

  const userLogs = legacyLogs.concat(srsLogs);
  userLogs.sort(compareLogTimestamp_);

  return sendResponse({ status: "success", data: userLogs });
}

function handleRegisterVocabWords(requestData) {
  const authCheck = requireAuthToken_(requestData);
  if (!authCheck.ok) return sendResponse({ status: "error", message: authCheck.error });

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
// ⑥ 初回セットアップ（フォルダ・本体スプレッドシート・サンプル問題）
// =========================================================

/**
 * 未セットアップ時のみ自動実行。doGet/doPost から呼ばれる。
 * 並行リクエストによる二重生成を LockService で防止。
 */
function ensureEnvironment() {
  const props = PropertiesService.getScriptProperties();
  if (isEnvironmentReady_(props)) {
    ensureVocabularyResources_();
    syncWhitelistCacheIfStale_();
    syncSampleQuestionBooksIfNeeded_();
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
 * ウェブアプリGASと同じDrive階層に grammarquizzes / DigitalDrill / サンプル問題を整える。
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

  const appSs = getOrCreateAppBook_(parentFolder, force, created, reused);
  ensureAppBookSheets_(appSs);
  props.setProperty(PROP.SPREADSHEET_ID, appSs.getId());

  // 管理者（setup 実行者）を記録（未設定時のみ）し、whitelist をキャッシュ
  if (!props.getProperty(PROP.ADMIN_EMAIL)) {
    const adminEmail = Session.getEffectiveUser().getEmail();
    if (adminEmail) {
      props.setProperty(PROP.ADMIN_EMAIL, adminEmail);
      created.push('ADMIN_EMAIL');
    }
  }
  syncWhitelistCache_();

  const sampleBookIds = ensureSampleQuestionBooks_(materialsFolder, force, created, reused);
  props.setProperty(PROP.SAMPLE_BOOK_IDS, JSON.stringify(sampleBookIds));

  const vocabularyFolder = getOrCreateVocabularyFolder_(parentFolder, force, created, reused);
  props.setProperty(PROP.VOCABULARY_FOLDER_ID, vocabularyFolder.getId());

  const myVocabBook = getOrCreateMyVocabBook_(vocabularyFolder, force, created, reused);
  props.setProperty(PROP.MY_VOCAB_BOOK_ID, myVocabBook.getId());

  const sampleVocabBookIds = ensureSampleVocabBooks_(vocabularyFolder, force, created, reused);
  props.setProperty(PROP.SAMPLE_VOCAB_BOOK_IDS, JSON.stringify(sampleVocabBookIds));

  props.setProperty(PROP.SETUP_COMPLETED, 'true');
  props.setProperty(PROP.SAMPLE_CATALOG_VERSION, SAMPLE_CATALOG_VERSION);
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
    managementBookId: appSs.getId(),
    managementBookUrl: appSs.getUrl(),
    sampleBookIds: sampleBookIds,
    sampleVocabBookIds: sampleVocabBookIds,
    created: created,
    reused: reused
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** grammarquizzes（文法演習）フォルダを Script Properties 優先で取得（親フォルダ内のみ探索） */
function getMaterialsFolder() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty(PROP.MATERIALS_FOLDER_ID);
  if (folderId) {
    try {
      return migrateMaterialsFolderName_(DriveApp.getFolderById(folderId));
    } catch (e) {
      // fall through
    }
  }

  const parentFolder = getScriptParentFolder_();
  const folder = findMaterialsFolderWithMigration_(parentFolder);
  if (folder) {
    props.setProperty(PROP.MATERIALS_FOLDER_ID, folder.getId());
    props.setProperty(PROP.PARENT_FOLDER_ID, parentFolder.getId());
    return folder;
  }

  throw new Error(MATERIALS_FOLDER_NAME + "フォルダが見つかりません。setupEnvironment() を実行してください。");
}

function findChildSpreadsheetWithMigration_(parentFolder, name, legacyNames) {
  let file = findChildSpreadsheetByName_(parentFolder, name);
  if (file) return file;
  const legacyList = Array.isArray(legacyNames) ? legacyNames : [legacyNames];
  for (let i = 0; i < legacyList.length; i++) {
    file = findChildSpreadsheetByName_(parentFolder, legacyList[i]);
    if (file) {
      file.setName(name);
      return file;
    }
  }
  return null;
}

function migrateAppBookFileName_(file) {
  const name = file.getName();
  if (name === APP_BOOK_NAME) return;
  for (let i = 0; i < LEGACY_APP_BOOK_NAMES.length; i++) {
    if (name === LEGACY_APP_BOOK_NAMES[i]) {
      file.setName(APP_BOOK_NAME);
      return;
    }
  }
}

function findChildFolderWithMigration_(parentFolder, name, legacyNames) {
  let folder = findChildFolderByName_(parentFolder, name);
  if (folder) return folder;
  const legacyList = Array.isArray(legacyNames) ? legacyNames : [legacyNames];
  for (let i = 0; i < legacyList.length; i++) {
    folder = findChildFolderByName_(parentFolder, legacyList[i]);
    if (folder) {
      folder.setName(name);
      return folder;
    }
  }
  return null;
}

function findFolderByNameWithMigration_(name, legacyNames, preferredParentId) {
  let fallback = null;
  const names = [name].concat(Array.isArray(legacyNames) ? legacyNames : [legacyNames]);
  for (let n = 0; n < names.length; n++) {
    const it = DriveApp.getFoldersByName(names[n]);
    while (it.hasNext()) {
      const candidate = it.next();
      if (names[n] !== name) candidate.setName(name);
      if (!fallback) fallback = candidate;
      const parents = candidate.getParents();
      while (parents.hasNext()) {
        if (parents.next().getId() === preferredParentId) return candidate;
      }
    }
  }
  return fallback;
}

/** 旧名 materials のフォルダを grammarquizzes に改名して返す（改名済みならそのまま） */
function migrateMaterialsFolderName_(folder) {
  if (folder.getName() === LEGACY_MATERIALS_FOLDER_NAME) {
    folder.setName(MATERIALS_FOLDER_NAME);
  }
  return folder;
}

/** 親フォルダ内で grammarquizzes を探す。無ければ旧名 materials を探して改名する */
function findMaterialsFolderWithMigration_(parentFolder) {
  let folder = findChildFolderByName_(parentFolder, MATERIALS_FOLDER_NAME);
  if (folder) return folder;
  folder = findChildFolderByName_(parentFolder, LEGACY_MATERIALS_FOLDER_NAME);
  if (folder) return migrateMaterialsFolderName_(folder);
  return null;
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
        const folder = migrateMaterialsFolderName_(DriveApp.getFolderById(existingId));
        reused.push(MATERIALS_FOLDER_NAME);
        return folder;
      } catch (e) {
        // ID が無効な場合は名前検索へ
      }
    }
  }

  {
    // force 時も旧名からの改名・既存フォルダ再利用を優先（サンプル問題の重複生成を防ぐ）
    const folder = findMaterialsFolderWithMigration_(parentFolder);
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

function getOrCreateAppBook_(parentFolder, force, created, reused) {
  const props = PropertiesService.getScriptProperties();

  if (!force) {
    const existingId = props.getProperty(PROP.SPREADSHEET_ID);
    if (existingId) {
      try {
        const file = DriveApp.getFileById(existingId);
        migrateAppBookFileName_(file);
        reused.push(APP_BOOK_NAME);
        return SpreadsheetApp.openById(existingId);
      } catch (e) {
        // ID が無効な場合は名前検索へ
      }
    }

    const existingFile = findChildSpreadsheetWithMigration_(
      parentFolder, APP_BOOK_NAME, LEGACY_APP_BOOK_NAMES
    );
    if (existingFile) {
      props.setProperty(PROP.SPREADSHEET_ID, existingFile.getId());
      reused.push(APP_BOOK_NAME);
      return SpreadsheetApp.open(existingFile);
    }
  } else {
    const existingFile = findChildSpreadsheetWithMigration_(
      parentFolder, APP_BOOK_NAME, LEGACY_APP_BOOK_NAMES
    );
    if (existingFile) {
      props.setProperty(PROP.SPREADSHEET_ID, existingFile.getId());
      reused.push(APP_BOOK_NAME);
      return SpreadsheetApp.open(existingFile);
    }
  }

  const ss = createSpreadsheetInFolder_(APP_BOOK_NAME, parentFolder);
  props.setProperty(PROP.SPREADSHEET_ID, ss.getId());
  created.push(APP_BOOK_NAME);
  return ss;
}

function ensureAppBookSheets_(ss) {
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
    scores.appendRow(SCORE_HEADERS);
    scores.getRange(1, 1, 1, SCORE_HEADERS.length).setFontWeight('bold');
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

  let srsLog = ss.getSheetByName(ADMIN_SRS_LOG_SHEET);
  if (!srsLog) {
    srsLog = ss.insertSheet(ADMIN_SRS_LOG_SHEET);
  }
  if (srsLog.getLastRow() === 0 || srsLog.getRange(1, 1).getValue() === '') {
    srsLog.clear();
    srsLog.appendRow(ADMIN_SRS_HEADERS);
    srsLog.getRange(1, 1, 1, ADMIN_SRS_HEADERS.length).setFontWeight('bold');
  }

  // 作成直後の「シート1」が残っていれば削除
  const leftover = ss.getSheetByName('シート1');
  if (leftover && ss.getSheets().length > 1) {
    ss.deleteSheet(leftover);
  }
}

/**
 * サンプルカタログ版が古いとき、grammarquizzes 内のブックをカタログ定義に合わせて再同期する。
 * カタログ外の旧ブック（中学1年 英語 等）は削除する。
 */
function syncSampleQuestionBooksIfNeeded_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(PROP.SAMPLE_CATALOG_VERSION) === SAMPLE_CATALOG_VERSION) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    if (props.getProperty(PROP.SAMPLE_CATALOG_VERSION) === SAMPLE_CATALOG_VERSION) return;

    const created = [];
    const reused = [];
    const materialsFolder = getMaterialsFolder();
    const bookIds = ensureSampleQuestionBooks_(materialsFolder, true, created, reused);
    props.setProperty(PROP.SAMPLE_BOOK_IDS, JSON.stringify(bookIds));
    props.setProperty(PROP.SAMPLE_CATALOG_VERSION, SAMPLE_CATALOG_VERSION);
    Logger.log('Sample catalog synced: ' + JSON.stringify({ created: created, reused: reused }));
  } finally {
    lock.releaseLock();
  }
}

/**
 * index.html の GRAMMAR_UNITS と揃えたサンプル問題ブックを grammarquizzes 内に用意する。
 * @return {Object} 科目名 → スプレッドシートID
 */
function ensureSampleQuestionBooks_(materialsFolder, force, created, reused) {
  const catalog = getSampleQuestionCatalog_();
  const subjectNames = Object.keys(catalog);
  purgeObsoleteSampleQuestionBooks_(materialsFolder, subjectNames, created);

  const bookIds = {};

  subjectNames.forEach(function (subjectName) {
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

/** grammarquizzes 内でカタログに無いスプレッドシート（旧サンプルブック）をゴミ箱へ移動 */
function purgeObsoleteSampleQuestionBooks_(materialsFolder, allowedSubjectNames, created) {
  const allowed = {};
  allowedSubjectNames.forEach(function (name) { allowed[name] = true; });
  const files = materialsFolder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (!allowed[name]) {
      file.setTrashed(true);
      if (created) created.push('削除:' + name);
    }
  }
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

    const rows = units[unitName];
    sheet.clear();
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });

  // カタログにないシートは削除（サンプルブックはカタログ定義のみ）
  const allSheets = ss.getSheets();
  for (let i = allSheets.length - 1; i >= 0; i--) {
    const sheet = allSheets[i];
    if (unitNames.indexOf(sheet.getName()) === -1 && ss.getSheets().length > 1) {
      ss.deleteSheet(sheet);
    }
  }

  const leftover = ss.getSheetByName('シート1');
  if (leftover && ss.getSheets().length > 1) {
    ss.deleteSheet(leftover);
  }
}

/**
 * サンプル問題定義（ヘッダ行 + データ行）。1行が形式A〜Hすべての素材になる。
 * 初回セットアップ時に grammarquizzes へ投入するサンプルは「不定詞」のみ。
 */
function getSampleQuestionCatalog_() {
  const headers = GRAMMAR_HEADERS;

  function row(id, dai, sho, full, ja, sortTpl, sortDummy, mcqTpl, mcqDummies, area, note) {
    return [id, dai, sho, full, ja, sortTpl, sortDummy, mcqTpl, mcqDummies, area, note];
  }

  return {
    '中学2年 英語': {
      '不定詞': [
        headers,
        row(1, '不定詞', 'SVO to do', 'He wants his daughter to be a doctor in the future.', '彼は娘に将来医者になってほしいと思っている。',
          'He wants (his,daughter,to,be,a,doctor,in,the future).', 'being',
          'He wants his daughter (to be) a doctor in the future.', 'to being,being,be,become,will become',
          '不定詞', '動詞 want を SVO to do という形で用いると不定詞の動作主が O となり、「O が to do することを S は欲する」⇒「S は O に do してほしい」という意味になる。'),
        row(2, '不定詞', '副詞的用法', 'I went to the library to study math.', '私は数学を勉強するために図書館へ行きました。',
          'I went to the library (to,study,math).', 'studying',
          'I went to the library (to study) math.', 'studying,study,for study,for studying',
          '不定詞', '「〜するために」と目的を表す副詞的用法。'),
        row(3, '不定詞', '名詞的用法', 'It is important to read many books.', '多くの本を読むことは大切です。',
          'It is important (to,read,many,books).', 'reading',
          'It is important (to read) many books.', 'reading,read,for read,to reading',
          '不定詞', '形式主語 It を立て、真主語の不定詞句を後ろに置く形。')
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
  const authCheck = requireAuthToken_(requestData);
  if (!authCheck.ok) return sendResponse({ status: "error", message: authCheck.error });

  try {
    const token = requestData.token;
    const transcript = requestData.transcript || '';
    const session = getSessionFromCache_(token);
    if (!session) return sendResponse({ status: "error", message: "セッションが見つかりません" });
    const result = scoreReadingTranscript_(session, transcript);
    result.userEmail = authCheck.auth.email;
    const resultToken = generateSessionToken_();
    result.sessionToken = token;
    saveResultToCache_(resultToken, result);
    return sendResponse({ status: "success", data: result, resultToken: resultToken });
  } catch (error) {
    return sendResponse({ status: "error", message: error.toString() });
  }
}

/**
 * アプリ本体（grammarquizzes / vocabulary / DigitalDrill）と同じ親フォルダを返す。
 * ScriptProperties → スクリプト親 → マイドライブ直下の順。
 */
function resolveAppParentFolder_() {
  const props = PropertiesService.getScriptProperties();
  const parentId = props.getProperty(PROP.PARENT_FOLDER_ID);
  if (parentId) {
    try {
      return DriveApp.getFolderById(parentId);
    } catch (e) {
      // fall through
    }
  }
  try {
    return getScriptParentFolder_();
  } catch (e) {
    return DriveApp.getRootFolder();
  }
}

/**
 * DigitalDrill_MyData をアプリ親フォルダ内に1つだけ確保する。
 * 既存フォルダ（名前一致）があれば再利用し、重複生成しない。
 */
function ensureUserDataFolder_() {
  const props = PropertiesService.getUserProperties();
  let folder = null;
  const folderId = props.getProperty(USER_PROP.MY_DATA_FOLDER_ID);

  if (folderId) {
    try {
      folder = DriveApp.getFolderById(folderId);
      if (folder.getName() === LEGACY_USER_DATA_FOLDER_NAMES[0]) {
        folder.setName(USER_DATA_FOLDER_NAME);
      }
    } catch (e) {
      folder = null;
    }
  }

  const parent = resolveAppParentFolder_();
  const parentId = parent.getId();

  if (!folder) {
    folder = findChildFolderWithMigration_(
      parent, USER_DATA_FOLDER_NAME, LEGACY_USER_DATA_FOLDER_NAMES
    );
  }

  if (!folder) {
    folder = findFolderByNameWithMigration_(USER_DATA_FOLDER_NAME, LEGACY_USER_DATA_FOLDER_NAMES, parentId);
  }

  if (!folder) {
    folder = parent.createFolder(USER_DATA_FOLDER_NAME);
  } else {
    // 可能ならアプリ親フォルダ配下へ移動（既にそこなら何もしない）
    try {
      let underParent = false;
      const parents = folder.getParents();
      while (parents.hasNext()) {
        if (parents.next().getId() === parentId) {
          underParent = true;
          break;
        }
      }
      if (!underParent) {
        folder.moveTo(parent);
      }
    } catch (e) {
      // 移動権限が無い場合は現状の場所を維持
    }
  }

  props.setProperty(USER_PROP.MY_DATA_FOLDER_ID, folder.getId());
  return folder;
}

function ensureUserEnvironment_() {
  const lock = LockService.getUserLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getUserProperties();
    const folder = ensureUserDataFolder_();

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
  } finally {
    lock.releaseLock();
  }
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

  const existing = findChildSpreadsheetWithMigration_(
    folder, USER_LOG_BOOK_NAME, LEGACY_USER_LOG_BOOK_NAMES
  );
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

// =========================================================
// SRS: ユーザー側状態シート
// =========================================================

function buildWordId_(bookName, sheetName, serialNo) {
  return String(bookName || UNREGISTERED) + '|' + String(sheetName || UNREGISTERED) + '|' + String(serialNo || UNREGISTERED);
}

function srsNormField_(value) {
  if (value === null || value === undefined || value === '') return UNREGISTERED;
  return String(value);
}

function ensureUserSrsSheet_() {
  const ss = getUserLogBook_();
  let sheet = ss.getSheetByName(USER_SRS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(USER_SRS_SHEET_NAME);
  }
  if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() === '') {
    sheet.clear();
    sheet.appendRow(SRS_STATE_HEADERS);
    sheet.getRange(1, 1, 1, SRS_STATE_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function fetchUserSrsStates_() {
  const sheet = ensureUserSrsSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return {};

  const headers = data[0];
  const idx = {};
  SRS_STATE_HEADERS.forEach(function (h) {
    idx[h] = headers.indexOf(h);
  });

  const states = {};
  for (let r = 1; r < data.length; r++) {
    const wordId = srsNormField_(data[r][idx['Word_ID']]);
    if (wordId === UNREGISTERED) continue;
    states[wordId] = {
      Word_ID: wordId,
      Step_Index: data[r][idx['Step_Index']],
      EF: data[r][idx['EF']],
      Next_Review: data[r][idx['Next_Review']],
      History: data[r][idx['History']],
      Avg_Time: data[r][idx['Avg_Time']]
    };
  }
  return states;
}

function fetchUserSrsStatesForWords_(bookName, sheetName, words) {
  const allStates = fetchUserSrsStates_();
  const result = {};
  (words || []).forEach(function (wordObj) {
    const wordId = buildWordId_(bookName, sheetName, wordObj['通し番号']);
    if (allStates[wordId]) {
      result[wordId] = allStates[wordId];
    }
  });
  return result;
}

function srsRowToValues_(row) {
  return SRS_STATE_HEADERS.map(function (header) {
    return srsNormField_(row[header]);
  });
}

function upsertUserSrsRows_(rows) {
  if (!rows || rows.length === 0) return { updated: 0, inserted: 0 };

  const sheet = ensureUserSrsSheet_();
  const data = sheet.getDataRange().getValues();
  const headers = data.length > 0 ? data[0] : SRS_STATE_HEADERS;
  const wordIdCol = headers.indexOf('Word_ID');

  const rowMap = {};
  for (let r = 1; r < data.length; r++) {
    const wordId = srsNormField_(data[r][wordIdCol]);
    if (wordId !== UNREGISTERED) rowMap[wordId] = r + 1;
  }

  let updated = 0;
  let inserted = 0;
  const newRows = [];

  rows.forEach(function (row) {
    const wordId = srsNormField_(row.Word_ID);
    if (wordId === UNREGISTERED) return;
    const values = srsRowToValues_(row);
    const existingRow = rowMap[wordId];
    if (existingRow) {
      sheet.getRange(existingRow, 1, existingRow, SRS_STATE_HEADERS.length).setValues([values]);
      updated++;
    } else {
      newRows.push(values);
      inserted++;
    }
  });

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, SRS_STATE_HEADERS.length).setValues(newRows);
  }

  return { updated: updated, inserted: inserted };
}

function handleApplySrsSync_(e) {
  const token = e && e.parameter ? e.parameter.token : null;
  if (!token) {
    return renderSrsSyncResultHtml_(false, 'syncToken が必要です');
  }

  try {
    const raw = CacheService.getScriptCache().get(SRS_SYNC_CACHE_PREFIX + token);
    if (!raw) {
      return renderSrsSyncResultHtml_(false, '同期データが見つかりません（期限切れの可能性）');
    }

    const payload = JSON.parse(raw);
    const activeEmail = Session.getActiveUser().getEmail() || '';
    if (payload.email && activeEmail && payload.email !== activeEmail) {
      return renderSrsSyncResultHtml_(false, 'ログインユーザーが一致しません');
    }

    const result = upsertUserSrsRows_(payload.rows || []);
    CacheService.getScriptCache().remove(SRS_SYNC_CACHE_PREFIX + token);
    return renderSrsSyncResultHtml_(true, 'SRS状態を保存しました', result);
  } catch (error) {
    return renderSrsSyncResultHtml_(false, error.toString());
  }
}

function renderSrsSyncResultHtml_(success, message, data) {
  const payload = JSON.stringify({ type: 'srsSyncComplete', success: success, message: message, data: data || null });
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>SRS Sync</title></head><body>'
    + '<p>' + (success ? '同期完了' : '同期失敗') + '</p>'
    + '<script>try{window.parent.postMessage(' + payload + ',"*");}catch(e){}</script>'
    + '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('SRS Sync')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =========================================================
// SRS: 管理者側メタログ + 差分キュー
// =========================================================

function ensureAdminSrsLogSheet_() {
  const spreadId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadId) throw new Error('SPREADSHEET_IDが設定されていません。');
  const ss = SpreadsheetApp.openById(spreadId);
  let sheet = ss.getSheetByName(ADMIN_SRS_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ADMIN_SRS_LOG_SHEET);
    sheet.appendRow(ADMIN_SRS_HEADERS);
    sheet.getRange(1, 1, 1, ADMIN_SRS_HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function handleSaveSrsLog_(requestData) {
  const authCheck = requireAuthToken_(requestData);
  if (!authCheck.ok) return sendResponse({ status: 'error', message: authCheck.error });

  const setId = requestData.setId || requestData.setName;
  const score = requestData.score != null ? requestData.score : requestData.correctRate;
  if (!setId) return sendResponse({ status: 'error', message: 'setId が必要です' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return sendResponse({ status: 'error', message: '書き込みロック取得に失敗しました' });
  }

  try {
    const sheet = ensureAdminSrsLogSheet_();
    const email = authCheck.auth.email;
    const data = sheet.getDataRange().getValues();
    let attempts = 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === email && data[i][2] === setId) attempts++;
    }
    attempts++;

    const logId = Utilities.getUuid();
    const timeStr = Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm:ss');
    sheet.appendRow([
      srsNormField_(logId),
      srsNormField_(email),
      srsNormField_(setId),
      srsNormField_(score),
      srsNormField_(attempts),
      srsNormField_(timeStr)
    ]);

    return sendResponse({ status: 'success', message: 'SRSログを保存しました', logId: logId, attempts: attempts });
  } finally {
    lock.releaseLock();
  }
}

function handleQueueSrsBulk_(requestData) {
  const authCheck = requireAuthToken_(requestData);
  if (!authCheck.ok) return sendResponse({ status: 'error', message: authCheck.error });

  const rows = requestData.rows;
  if (!rows || !Array.isArray(rows)) {
    return sendResponse({ status: 'error', message: 'rows が必要です' });
  }

  const syncToken = generateSessionToken_();
  const payload = { email: authCheck.auth.email, rows: rows };
  const json = JSON.stringify(payload);
  if (json.length > 95000) {
    return sendResponse({ status: 'error', message: 'データが大きすぎます（CacheService 100KB上限）' });
  }

  CacheService.getScriptCache().put(SRS_SYNC_CACHE_PREFIX + syncToken, json, SRS_SYNC_CACHE_TTL);
  return sendResponse({ status: 'success', syncToken: syncToken });
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

  const bookName = MY_VOCAB_BOOK_NAME;
  const srsStates = fetchUserSrsStatesForWords_(bookName, sheetName, wordData.words);

  return {
    mode: mode,
    setName: MY_VOCAB_BOOK_NAME + ' / ' + sheetName,
    bookName: bookName,
    sheetName: sheetName,
    filters: filters,
    words: wordData.words,
    pool: wordData.pool,
    bookPool: wordData.bookPool,
    srsStates: srsStates,
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

    let authToken = null;
    const access = checkDashboardAccess_();
    if (access.allowed) {
      try {
        authToken = issueAuthToken_(access.email);
      } catch (e) {
        // auth 発行失敗時も学習セッションは返す
      }
    }
    return { status: 'success', token: token, authToken: authToken, pagesUrl: getPagesUrl_() };
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

/** GAS①: 認証トークン発行（dashboard から Pages へ引き渡し） */
function apiIssueAuthToken() {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed) return { status: 'error', message: 'アクセスが許可されていません' };
    const token = issueAuthToken_(access.email);
    const user = getWhitelistUserProfile_(access.email);
    return { status: 'success', token: token, user: user, pagesUrl: getPagesUrl_() };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}