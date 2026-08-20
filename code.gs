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
const AUTH_CACHE_PREFIX = 'auth_';
const USER_OP_CACHE_PREFIX = 'uop_';
/** 教材の版。全ユーザー共通なので CacheService に載せて Drive 走査を抑える */
const PRESET_VERSION_CACHE_KEY = 'preset_version';
const PRESET_VERSION_CACHE_TTL = 120;
/** セッション集約の待ち行列。1件=1プロパティで read-modify-write 競合を避ける */
const SESSION_SUMMARY_QUEUE_PREFIX = 'ssq_';
const USER_OP_CACHE_TTL = 600;
/** 認証トークン有効期間: 1時間半（5400秒） */
const AUTH_CACHE_TTL = 5400;
const DEFAULT_PAGES_URL = 'https://snakamurako-coder.github.io/grammarquiz/';
/** index.html の GOOGLE_CLIENT_ID と揃える（Script Properties 未設定時の既定値） */
const DEFAULT_CLIENT_ID = '505252303455-84r495bnnsgiefcrv24ro2qtohlgbk2h.apps.googleusercontent.com';
/** GAS① ユーザー権限デプロイ（config.js の DASHBOARD_URL と同一） */
const DEFAULT_DASHBOARD_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxN9pnUp_mG6QHBKJz2WPaS-YqZlrhUaSI1XjTc3aXbmivNowfQPAi1Vi0WmpmfcDSo/exec';

const MATERIALS_FOLDER_NAME = 'grammarquizzes';
const VOCABULARY_FOLDER_NAME = 'vocabulary';
/** 本体スプレッドシート（whitelist・セッション集約） */
const APP_BOOK_NAME = 'DigitalDrill';
const MY_VOCAB_BOOK_NAME = 'マイ単語帳';
const UNREGISTERED = '(未登録)';
const USER_ITEM_STATE_SHEET_NAME = '学習状態';
const USER_SESSION_LOG_SHEET_NAME = '学習記録';
const USER_SESSION_LOG_HEADERS = ['タイムスタンプ', '学習セット名', 'モード', '正答率', '解答時間', '詳細'];
const ADMIN_SESSION_SUMMARY_SHEET = 'セッション集約';
const ITEM_STATE_HEADERS = [
  'Item_ID', 'Kind', 'Set_ID', 'Total_Attempts', 'Total_Wrong',
  'Recent_Bits', 'Last_Seen', 'Step_Index', 'EF', 'Next_Review', 'Avg_Time'
];
const SESSION_SUMMARY_HEADERS = [
  'Session_ID', 'User_ID', 'Mode', 'Set_ID', 'Set_Name',
  'Attempt_No', 'Correct', 'Total', 'Score', 'Duration_Sec', 'Started_At', 'Ended_At'
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

  if (action === 'userBridge') {
    return handleUserBridge_(e);
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
    } else if (action === 'getGrammarCatalog') {
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
    } else if (action === 'setup') {
      try {
        const force = String(e.parameter.force || '') === '1';
        const result = setupEnvironmentWithLock_(force);
        return sendResponse({ status: "success", data: result });
      } catch (error) {
        return sendResponse({ status: "error", message: error.toString(), stack: error.stack });
      }
    } else if (action === 'exportStatic') {
      try {
        const data = exportStaticPresetData_();
        return sendResponse({ status: 'success', data: data });
      } catch (error) {
        return sendResponse({ status: 'error', message: error.toString(), stack: error.stack });
      }
    } else if (action === 'presetVersion') {
      try {
        return sendResponse({ status: 'success', version: computePresetVersion_() });
      } catch (error) {
        return sendResponse({ status: 'error', message: error.toString() });
      }
    }
    return sendResponse({ status: "error", message: "無効なactionです: " + action });
  }

  const access = checkDashboardAccess_();
  if (!access.allowed) {
    return renderAccessDeniedPage_(access.email, access.reason);
  }

  if (!isAdminEmail_(access.email)) {
    const pagesUrl = getPagesUrl_();
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
      '<body style="font-family:sans-serif;max-width:560px;margin:60px auto;padding:0 16px;text-align:center;">' +
      '<h1>' + APP_NAME + '</h1>' +
      '<p>学習者の方は GitHub Pages の学習画面をご利用ください。</p>' +
      '<p><a href="' + pagesUrl + '">学習画面を開く</a></p>' +
      '<p style="font-size:.85em;color:#666;margin-top:24px;"><a href="' + ScriptApp.getService().getUrl() + '?action=auth">ログイン（Pagesへ）</a></p>' +
      '</body></html>'
    ).setTitle(APP_NAME).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const template = HtmlService.createTemplateFromFile('dashboard');
  template.PAGES_URL = getPagesUrl_();
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

  // 学習セットは grammarquizzes 内のスプレッドシート名で開く（ID の登録は不要）
  const ss = openGrammarBookByName_(subject);

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

function openGrammarBookByName_(subjectName) {
  const materialsFolder = getMaterialsFolder();
  const files = materialsFolder.getFilesByName(subjectName);
  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
      return SpreadsheetApp.open(file);
    }
  }
  throw new Error("スプレッドシートが見つかりません: " + subjectName);
}

function isGrammarUnitSheet_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return (h === null || h === undefined) ? '' : h.toString().trim();
  });
  return headers.indexOf('英文全文') >= 0 && headers.indexOf('日本語訳') >= 0;
}

/**
 * grammarquizzes フォルダ内の Google スプレッドシートをすべて学習セットとして列挙する。
 * ブック名＝科目、シート名＝単元。ID の登録は不要。
 * （高速化する場合は、同じ構造の JSON を GitHub Pages の manifest に載せる）
 */
function fetchCatalogFromDrive() {
  const materialsFolder = getMaterialsFolder();

  const catalog = {};
  const files = materialsFolder.getFilesByType(MimeType.GOOGLE_SHEETS);

  while (files.hasNext()) {
    const file = files.next();
    const subjectName = file.getName();
    const ss = SpreadsheetApp.open(file);
    const unitNames = ss.getSheets()
      .filter(function (s) { return isGrammarUnitSheet_(s); })
      .map(function (s) { return s.getName(); });
    if (unitNames.length === 0) continue;
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
      return handleLogin_(requestData);
    }

    ensureEnvironment();

    if (action === "logout") {
      if (requestData.authToken) invalidateAuthToken_(requestData.authToken);
      return sendResponse({ status: "success", message: "ログアウトしました" });
    } else if (action === "queueUserOp") {
      return handleQueueUserOp_(requestData);
    } else if (action === "queueSessionSummary") {
      return handleQueueSessionSummary_(requestData);
    } else {
      return sendResponse({ status: "error", message: "無効なactionです: " + action });
    }
  } catch (error) {
    return sendResponse({ status: "error", message: error.toString() });
  }
}

// =========================================================
// ① ホワイトリスト認可ヘルパー
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
 * GAS②（作成者実行・匿名アクセス可）では常に空になるため、認証は GAS① 経由にすること。
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

/** Google ID トークンでログイン（GAS② POST・getActiveUser 不要） */
function handleLogin_(requestData) {
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

/**
 * Pages へ戻す HTML。
 * GAS ウェブアプリは googleusercontent.com の iframe 内で動くため、
 * top 遷移も iframe 内遷移も失敗しやすい（Pages は X-Frame-Options で埋め込み拒否）。
 * 新しいタブで開く。
 */
function renderAuthRedirectPage_(targetUrl) {
  const hrefAttr = String(targetUrl)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
  const jsUrl = JSON.stringify(String(targetUrl));
  const html =
    '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding:40px;max-width:480px;margin:0 auto;">' +
    '<p style="font-size:1.15em;font-weight:bold;color:#2c3e50;">認証に成功しました。</p>' +
    '<p style="color:#555;">下のボタンで学習画面を開いてください。</p>' +
    '<p><a id="auth-go" target="_blank" rel="noopener noreferrer" href="' + hrefAttr + '"' +
    ' style="display:inline-block;margin-top:12px;padding:14px 28px;background:#2196f3;color:#fff;' +
    'text-decoration:none;border-radius:10px;font-weight:bold;">学習画面を開く</a></p>' +
    '<p style="color:#888;font-size:.85em;margin-top:20px;">ボタンで開かない場合は、このページのポップアップを許可してください。</p>' +
    '<script>(function(){var u=' + jsUrl + ';' +
    'try{var w=window.open(u,"_blank","noopener");if(w)w.opener=null;}catch(e){}})();</script>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(APP_NAME + ' - 認証中')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =========================================================
// ② 初回セットアップ（フォルダ・本体スプレッドシート・サンプル問題）
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

  throw new Error(MATERIALS_FOLDER_NAME + "フォルダが見つかりません。setupEnvironment() を実行してください。");
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
  }

  {
    // force 時も既存フォルダ再利用を優先（サンプル問題の重複生成を防ぐ）
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

function getOrCreateAppBook_(parentFolder, force, created, reused) {
  const props = PropertiesService.getScriptProperties();

  if (!force) {
    const existingId = props.getProperty(PROP.SPREADSHEET_ID);
    if (existingId) {
      try {
        const ss = SpreadsheetApp.openById(existingId);
        reused.push(APP_BOOK_NAME);
        return ss;
      } catch (e) {
        // ID が無効な場合は名前検索へ
      }
    }
  }

  const existingFile = findChildSpreadsheetByName_(parentFolder, APP_BOOK_NAME);
  if (existingFile) {
    props.setProperty(PROP.SPREADSHEET_ID, existingFile.getId());
    reused.push(APP_BOOK_NAME);
    return SpreadsheetApp.open(existingFile);
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

  let sessionSummary = ss.getSheetByName(ADMIN_SESSION_SUMMARY_SHEET);
  if (!sessionSummary) {
    sessionSummary = ss.insertSheet(ADMIN_SESSION_SUMMARY_SHEET);
  }
  if (sessionSummary.getLastRow() === 0 || sessionSummary.getRange(1, 1).getValue() === '') {
    sessionSummary.clear();
    sessionSummary.appendRow(SESSION_SUMMARY_HEADERS);
    sessionSummary.getRange(1, 1, 1, SESSION_SUMMARY_HEADERS.length).setFontWeight('bold');
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
 * サンプル問題ブックを grammarquizzes 内に用意する。
 * フォルダ内の追加ブックは削除しない（名前で自動認識する）。
 * @return {Object} 科目名 → スプレッドシートID（参考用。配信時は ID を使わない）
 */
function ensureSampleQuestionBooks_(materialsFolder, force, created, reused) {
  const catalog = getSampleQuestionCatalog_();
  const subjectNames = Object.keys(catalog);
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
  const lastRow = sheet.getLastRow();
  const firstCell = lastRow > 0 ? sheet.getRange(1, 1).getValue() : '';
  if (firstCell !== '通し番号') {
    if (lastRow === 0) {
      sheet.appendRow(VOCAB_HEADERS);
    } else {
      sheet.insertRowBefore(1);
    }
  }
  sheet.getRange(1, 1, 1, VOCAB_HEADERS.length).setValues([VOCAB_HEADERS]);
  sheet.getRange(1, 1, 1, VOCAB_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function spreadsheetEditUrl_(ss, sheet) {
  let url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/edit';
  if (sheet) url += '#gid=' + sheet.getSheetId();
  return url;
}

function isFileInFolder_(fileId, folder) {
  if (!fileId || !folder) return false;
  try {
    const parents = DriveApp.getFileById(fileId).getParents();
    const targetId = folder.getId();
    while (parents.hasNext()) {
      if (parents.next().getId() === targetId) return true;
    }
  } catch (e) {
    return false;
  }
  return false;
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
  const presets = [];

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

    presets.push({
      bookName: bookName,
      bookId: bookId,
      bookUrl: file.getUrl(),
      sheets: sheetInfos
    });
  }

  /** 学習者のマイ単語帳は GAS② では返さない（OAuth / GAS① ユーザードライブのみ） */
  return { presets: presets, userBooks: [] };
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

  const bookUrl = spreadsheetEditUrl_(ss);
  return {
    registeredCount: builtRows.length,
    sheetName: sheetName,
    bookName: ss.getName(),
    bookId: ss.getId(),
    bookUrl: bookUrl,
    sheetUrl: spreadsheetEditUrl_(ss, sheet)
  };
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
    } catch (e) {
      folder = null;
    }
  }

  const parent = resolveAppParentFolder_();

  if (!folder) {
    folder = findChildFolderByName_(parent, USER_DATA_FOLDER_NAME) || parent.createFolder(USER_DATA_FOLDER_NAME);
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
    const vocabBook = getOrCreateUserVocabBook_(folder);
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

  const existing = findChildSpreadsheetByName_(folder, USER_LOG_BOOK_NAME);
  if (existing) return SpreadsheetApp.open(existing);

  const ss = createSpreadsheetInFolder_(USER_LOG_BOOK_NAME, folder);
  const sheet = ss.getSheets()[0];
  sheet.setName(USER_SESSION_LOG_SHEET_NAME);
  sheet.appendRow(USER_SESSION_LOG_HEADERS);
  sheet.getRange(1, 1, 1, USER_SESSION_LOG_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return ss;
}

function getOrCreateUserVocabBook_(userFolder) {
  const props = PropertiesService.getUserProperties();
  const bookId = props.getProperty(USER_PROP.MY_VOCAB_BOOK_ID);
  if (bookId && isFileInFolder_(bookId, userFolder)) {
    try {
      const ss = SpreadsheetApp.openById(bookId);
      ensureMyVocabDefaultSheet_(ss);
      return ss;
    } catch (e) {
      // fall through and recreate in the user folder
    }
  }

  const existingFile = findChildSpreadsheetByName_(userFolder, MY_VOCAB_BOOK_NAME);
  let ss;
  const createdNew = !existingFile;
  if (existingFile) {
    ss = SpreadsheetApp.open(existingFile);
  } else {
    ss = createSpreadsheetInFolder_(MY_VOCAB_BOOK_NAME, userFolder);
  }
  ensureMyVocabDefaultSheet_(ss);
  if (createdNew) ensureMyVocabSampleSheet_(ss);
  props.setProperty(USER_PROP.MY_VOCAB_BOOK_ID, ss.getId());
  return ss;
}

function getUserVocabBook_() {
  const folder = ensureUserDataFolder_();
  return getOrCreateUserVocabBook_(folder);
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
      bookUrl: spreadsheetEditUrl_(ss),
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

function fetchUserLearningLogs_() {
  const ss = getUserLogBook_();
  const sheet = ss.getSheetByName(USER_SESSION_LOG_SHEET_NAME);
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

/** 単語1件を一意に識別する Item_ID（ブック名|シート名|通し番号） */
function buildWordId_(bookName, sheetName, serialNo) {
  return String(bookName || UNREGISTERED) + '|' + String(sheetName || UNREGISTERED) + '|' + String(serialNo || UNREGISTERED);
}

/** 空値を UNREGISTERED に寄せてシート上の型ブレを防ぐ */
function itemNormField_(value) {
  if (value === null || value === undefined || value === '') return UNREGISTERED;
  return String(value);
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
  const srsStates = fetchUserItemStatesForWords_(bookName, sheetName, wordData.words);

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

// --- GAS① ユーザー権限 API（UserBridge から dispatchUserOp_ 経由で呼ばれる） ---

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

// =========================================================
// ④ UserBridge（GAS② キュー → GAS① iframe 実行）
// =========================================================

function handleQueueUserOp_(requestData) {
  const authCheck = requireAuthToken_(requestData);
  if (!authCheck.ok) return sendResponse({ status: 'error', message: authCheck.error });

  const op = requestData.op;
  if (!op) return sendResponse({ status: 'error', message: 'op が必要です' });

  const payload = requestData.payload || {};
  const opToken = generateSessionToken_();
  const cachePayload = {
    op: op,
    payload: payload,
    email: authCheck.auth.email
  };
  const json = JSON.stringify(cachePayload);
  if (json.length > 95000) {
    return sendResponse({ status: 'error', message: '操作データが大きすぎます' });
  }
  CacheService.getScriptCache().put(USER_OP_CACHE_PREFIX + opToken, json, USER_OP_CACHE_TTL);
  return sendResponse({ status: 'success', opToken: opToken });
}

function handleUserBridge_(e) {
  const opToken = e && e.parameter ? e.parameter.token : null;
  if (!opToken) {
    return renderUserBridgeHtml_(false, 'opToken が必要です', null);
  }

  try {
    const access = checkDashboardAccess_();
    if (!access.allowed) {
      return renderUserBridgeHtml_(false, 'アクセスが許可されていません', null);
    }

    const raw = CacheService.getScriptCache().get(USER_OP_CACHE_PREFIX + opToken);
    if (!raw) {
      return renderUserBridgeHtml_(false, '操作トークンが無効または期限切れです', null);
    }

    const cached = JSON.parse(raw);
    const activeEmail = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    const expectedEmail = String(cached.email || '').trim().toLowerCase();
    if (expectedEmail && activeEmail && expectedEmail !== activeEmail) {
      return renderUserBridgeHtml_(false, 'ログインユーザーが一致しません', null);
    }

    const result = dispatchUserOp_(cached.op, cached.payload);
    CacheService.getScriptCache().remove(USER_OP_CACHE_PREFIX + opToken);
    return renderUserBridgeHtml_(result.status === 'success', result.message || '', result);
  } catch (error) {
    return renderUserBridgeHtml_(false, error.toString(), null);
  }
}

function renderUserBridgeHtml_(success, message, result) {
  const payload = JSON.stringify({
    type: 'userBridgeComplete',
    success: success,
    message: message,
    result: result || null
  });
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>UserBridge</title></head><body>'
    + '<p>' + (success ? '操作完了' : '操作失敗') + '</p>'
    + '<script>try{window.parent.postMessage(' + payload + ',"*");}catch(e){}</script>'
    + '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('UserBridge')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function dispatchUserOp_(op, payload) {
  payload = payload || {};
  switch (op) {
    case 'getVocabCatalog':
      return apiUserGetVocabCatalog();
    case 'getVocabWords':
      return apiUserGetVocabWords(payload.sheetName, payload.filtersJson || '{}');
    case 'registerVocabWords':
      return apiUserRegisterVocabWords(payload.sheetName, JSON.stringify(payload.rows || []));
    case 'getLearningLogs':
      return apiUserGetLearningLogs();
    case 'getItemStates':
      return apiUserGetItemStates(payload.setId || '');
    case 'upsertItemStates':
      return apiUserUpsertItemStates(payload.rows || []);
    case 'saveSessionLog':
      return apiUserSaveSessionLog(payload);
    case 'startSession':
      return apiUserStartSession(JSON.stringify(payload));
    case 'countSessionAttempts':
      return apiUserCountSessionAttempts(payload.setId || '');
    default:
      return { status: 'error', message: '未対応の op: ' + op };
  }
}

// =========================================================
// ⑤ 学習状態シート（ユーザーDrive・細粒度）
// =========================================================

function ensureUserItemStateSheet_() {
  const ss = getUserLogBook_();
  let sheet = ss.getSheetByName(USER_ITEM_STATE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(USER_ITEM_STATE_SHEET_NAME);
  }
  if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() === '') {
    sheet.clear();
    sheet.appendRow(ITEM_STATE_HEADERS);
    sheet.getRange(1, 1, 1, ITEM_STATE_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function fetchUserItemStates_(setIdFilter) {
  const sheet = ensureUserItemStateSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return {};

  const headers = data[0];
  const idx = {};
  ITEM_STATE_HEADERS.forEach(function (h) {
    idx[h] = headers.indexOf(h);
  });

  const states = {};
  for (let r = 1; r < data.length; r++) {
    const itemId = itemNormField_(data[r][idx['Item_ID']]);
    if (itemId === UNREGISTERED) continue;
    const setId = itemNormField_(data[r][idx['Set_ID']]);
    if (setIdFilter && setId !== setIdFilter && itemId.indexOf(setIdFilter) !== 0) continue;
    states[itemId] = {
      Item_ID: itemId,
      Kind: itemNormField_(data[r][idx['Kind']]),
      Set_ID: setId,
      Total_Attempts: parseInt(data[r][idx['Total_Attempts']], 10) || 0,
      Total_Wrong: parseInt(data[r][idx['Total_Wrong']], 10) || 0,
      Recent_Bits: parseInt(data[r][idx['Recent_Bits']], 10) || 0,
      Last_Seen: parseInt(data[r][idx['Last_Seen']], 10) || 0,
      Step_Index: parseInt(data[r][idx['Step_Index']], 10) || 0,
      EF: parseFloat(data[r][idx['EF']]) || 2.5,
      Next_Review: parseInt(data[r][idx['Next_Review']], 10) || 0,
      Avg_Time: parseInt(data[r][idx['Avg_Time']], 10) || 0
    };
  }
  return states;
}

function itemStateRowToValues_(row) {
  return ITEM_STATE_HEADERS.map(function (header) {
    return itemNormField_(row[header]);
  });
}

function upsertUserItemStateRows_(rows) {
  if (!rows || rows.length === 0) return { updated: 0, inserted: 0 };

  const sheet = ensureUserItemStateSheet_();
  const data = sheet.getDataRange().getValues();
  const headers = data.length > 0 ? data[0] : ITEM_STATE_HEADERS;
  const itemIdCol = headers.indexOf('Item_ID');

  const rowMap = {};
  for (let r = 1; r < data.length; r++) {
    const itemId = itemNormField_(data[r][itemIdCol]);
    if (itemId !== UNREGISTERED) rowMap[itemId] = r + 1;
  }

  let updated = 0;
  let inserted = 0;
  const newRows = [];

  rows.forEach(function (row) {
    const itemId = itemNormField_(row.Item_ID);
    if (itemId === UNREGISTERED) return;
    const normalized = {
      Item_ID: itemId,
      Kind: row.Kind || (itemId.indexOf('|') >= 0 ? 'vocab' : 'grammar'),
      Set_ID: row.Set_ID || '',
      Total_Attempts: row.Total_Attempts != null ? row.Total_Attempts : 0,
      Total_Wrong: row.Total_Wrong != null ? row.Total_Wrong : 0,
      Recent_Bits: row.Recent_Bits != null ? row.Recent_Bits : 0,
      Last_Seen: row.Last_Seen != null ? row.Last_Seen : 0,
      Step_Index: row.Step_Index != null ? row.Step_Index : 0,
      EF: row.EF != null ? row.EF : 2.5,
      Next_Review: row.Next_Review != null ? row.Next_Review : 0,
      Avg_Time: row.Avg_Time != null ? row.Avg_Time : 0
    };
    const values = itemStateRowToValues_(normalized);
    const existingRow = rowMap[itemId];
    if (existingRow) {
      sheet.getRange(existingRow, 1, 1, ITEM_STATE_HEADERS.length).setValues([values]);
      updated++;
    } else {
      newRows.push(values);
      inserted++;
    }
  });

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, ITEM_STATE_HEADERS.length).setValues(newRows);
  }

  return { updated: updated, inserted: inserted };
}

/** セッション対象の単語だけに絞った学習状態を返す（buildSessionPayload_ 用） */
function fetchUserItemStatesForWords_(bookName, sheetName, words) {
  const allStates = fetchUserItemStates_('');
  const result = {};
  (words || []).forEach(function (wordObj) {
    const wordId = buildWordId_(bookName, sheetName, wordObj['通し番号']);
    if (allStates[wordId]) {
      result[wordId] = allStates[wordId];
    }
  });
  return result;
}

function countUserSessionAttempts_(setId) {
  const ss = getUserLogBook_();
  const sheet = ss.getSheetByName(USER_SESSION_LOG_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const setIdx = headers.indexOf('学習セット名');
  if (setIdx === -1) return 0;
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][setIdx] || '') === String(setId || '')) count++;
  }
  return count;
}

function saveUserSessionLogEntry_(entry) {
  const ss = getUserLogBook_();
  let sheet = ss.getSheetByName(USER_SESSION_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(USER_SESSION_LOG_SHEET_NAME);
    sheet.appendRow(USER_SESSION_LOG_HEADERS);
    sheet.getRange(1, 1, 1, USER_SESSION_LOG_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const timeStr = Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm:ss');
  sheet.appendRow([
    timeStr,
    entry.setName || entry.setId || '',
    entry.mode || '',
    entry.score != null ? entry.score : (entry.correctRate || ''),
    entry.durationSec != null ? entry.durationSec : (entry.timeTaken || ''),
    JSON.stringify(entry)
  ]);
}

function apiUserGetItemStates(setId) {
  try {
    const data = fetchUserItemStates_(setId || '');
    return { status: 'success', data: data };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiUserUpsertItemStates(rows) {
  try {
    const data = upsertUserItemStateRows_(rows);
    return { status: 'success', data: data };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiUserSaveSessionLog(entry) {
  try {
    saveUserSessionLogEntry_(entry || {});
    return { status: 'success', message: '学習記録を保存しました' };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiUserCountSessionAttempts(setId) {
  try {
    const count = countUserSessionAttempts_(setId);
    return { status: 'success', data: { count: count, attemptNo: count + 1 } };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiUserStartSession(payloadJson) {
  try {
    const params = payloadJson ? JSON.parse(payloadJson) : {};
    return { status: 'success', data: buildSessionPayload_(params) };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

// =========================================================
// ⑩ 管理者セッション集約（キュー + フラッシュ）
// =========================================================

function handleQueueSessionSummary_(requestData) {
  const authCheck = requireAuthToken_(requestData);
  if (!authCheck.ok) return sendResponse({ status: 'error', message: authCheck.error });

  const summary = requestData.summary;
  if (!summary) return sendResponse({ status: 'error', message: 'summary が必要です' });

  summary.User_ID = authCheck.auth.email;
  if (!summary.Session_ID) summary.Session_ID = Utilities.getUuid();
  if (!summary.Ended_At) {
    summary.Ended_At = Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm:ss');
  }

  // 1セッション = 1プロパティ。read-modify-write を避けることで
  // 同時投入されたサマリーが取りこぼされないようにする。
  const json = JSON.stringify(summary);
  if (json.length > 9000) {
    return sendResponse({ status: 'error', message: 'サマリーデータが大きすぎます（9KB上限）' });
  }
  PropertiesService.getScriptProperties()
    .setProperty(SESSION_SUMMARY_QUEUE_PREFIX + summary.Session_ID, json);
  return sendResponse({ status: 'success', sessionId: summary.Session_ID });
}

function sessionSummaryToRow_(s) {
  return [
    s.Session_ID || '',
    s.User_ID || '',
    s.Mode || '',
    s.Set_ID || '',
    s.Set_Name || '',
    s.Attempt_No != null ? s.Attempt_No : '',
    s.Correct != null ? s.Correct : '',
    s.Total != null ? s.Total : '',
    s.Score != null ? s.Score : '',
    s.Duration_Sec != null ? s.Duration_Sec : '',
    s.Started_At || '',
    s.Ended_At || ''
  ];
}

/**
 * 待ち行列のサマリーをまとめて集約シートへ追記する。
 * 時間主導トリガーと手動実行が重なっても二重書き込みしないようロックを取る。
 */
function flushSessionSummaries_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { flushed: 0, skipped: '他のフラッシュ実行中' };

  try {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    const keys = Object.keys(all).filter(function (k) {
      return k.indexOf(SESSION_SUMMARY_QUEUE_PREFIX) === 0;
    });
    if (!keys.length) return { flushed: 0 };

    const rows = [];
    keys.forEach(function (k) {
      try {
        rows.push(sessionSummaryToRow_(JSON.parse(all[k])));
      } catch (e) {
        // 壊れたエントリは捨てる（下でキーごと削除される）
      }
    });

    if (rows.length) {
      const spreadId = props.getProperty(PROP.SPREADSHEET_ID);
      if (!spreadId) throw new Error('SPREADSHEET_IDが設定されていません。');
      const ss = SpreadsheetApp.openById(spreadId);
      let sheet = ss.getSheetByName(ADMIN_SESSION_SUMMARY_SHEET);
      if (!sheet) {
        sheet = ss.insertSheet(ADMIN_SESSION_SUMMARY_SHEET);
        sheet.appendRow(SESSION_SUMMARY_HEADERS);
        sheet.getRange(1, 1, 1, SESSION_SUMMARY_HEADERS.length).setFontWeight('bold');
      }
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, SESSION_SUMMARY_HEADERS.length).setValues(rows);
      SpreadsheetApp.flush();
    }

    keys.forEach(function (k) { props.deleteProperty(k); });
    return { flushed: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function installSessionSummaryTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'flushSessionSummaries_') {
      return { installed: true, message: '既にインストール済み' };
    }
  }
  ScriptApp.newTrigger('flushSessionSummaries_')
    .timeBased()
    .everyMinutes(5)
    .create();
  return { installed: true, message: '5分間隔トリガーをインストールしました' };
}

function apiAdminGetSessionSummaries(limit) {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed || !isAdminEmail_(access.email)) {
      return { status: 'error', message: '管理者権限が必要です' };
    }
    const spreadId = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
    const ss = SpreadsheetApp.openById(spreadId);
    const sheet = ss.getSheetByName(ADMIN_SESSION_SUMMARY_SHEET);
    if (!sheet || sheet.getLastRow() <= 1) return { status: 'success', data: [] };

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const max = limit || 100;
    const logs = [];
    for (let i = data.length - 1; i >= 1 && logs.length < max; i--) {
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        if (headers[j]) obj[headers[j]] = data[i][j];
      }
      logs.push(obj);
    }
    return { status: 'success', data: logs };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiAdminFlushSummaries() {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed || !isAdminEmail_(access.email)) {
      return { status: 'error', message: '管理者権限が必要です' };
    }
    const result = flushSessionSummaries_();
    return { status: 'success', message: 'フラッシュ完了: ' + (result.flushed || 0) + '件', data: result };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiAdminInstallTrigger() {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed || !isAdminEmail_(access.email)) {
      return { status: 'error', message: '管理者権限が必要です' };
    }
    const result = installSessionSummaryTrigger_();
    return { status: 'success', message: result.message, data: result };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiAdminGetWhitelist() {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed || !isAdminEmail_(access.email)) {
      return { status: 'error', message: '管理者権限が必要です' };
    }
    const emails = readWhitelistEmailsFromSheet_();
    const spreadId = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
    const sheet = SpreadsheetApp.openById(spreadId).getSheetByName('whitelist');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rows = [];
    for (let i = 1; i < data.length; i++) {
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        if (headers[j]) obj[headers[j]] = data[i][j];
      }
      rows.push(obj);
    }
    return { status: 'success', data: rows, emails: emails };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

// =========================================================
// ⑪ 静的プリセットエクスポート
// =========================================================

/**
 * 教材（grammarquizzes / vocabulary のスプレッドシート）の版を返す。
 * ファイルの最終更新時刻から算出するので、教材を編集した時だけ値が変わる。
 * クライアントはこの値でローカルキャッシュの有効性を判断する。
 */
function computePresetVersion_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(PRESET_VERSION_CACHE_KEY);
  if (cached) return cached;

  const stamps = [];
  [getMaterialsFolder(), getVocabularyFolder()].forEach(function (folder) {
    const it = folder.getFiles();
    while (it.hasNext()) {
      const file = it.next();
      if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
      stamps.push(file.getId() + ':' + file.getLastUpdated().getTime());
    }
  });
  stamps.sort();

  const version = Utilities
    .computeDigest(Utilities.DigestAlgorithm.MD5, stamps.join('|'), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); })
    .join('');

  cache.put(PRESET_VERSION_CACHE_KEY, version, PRESET_VERSION_CACHE_TTL);
  return version;
}

function exportStaticPresetData_() {
  ensureEnvironment();
  const catalog = fetchCatalogFromDrive();
  const vocabCatalog = fetchVocabCatalogFromDrive_();
  const questions = {};
  Object.keys(catalog).forEach(function (subject) {
    catalog[subject].forEach(function (unit) {
      try {
        const data = fetchQuestionsFromSheet({ subject: subject, unit: unit });
        questions[subject + '::' + unit] = data;
      } catch (e) {
        questions[subject + '::' + unit] = [];
      }
    });
  });
  const vocabWords = {};
  (vocabCatalog.presets || []).forEach(function (book) {
    (book.sheets || []).forEach(function (sheetInfo) {
      try {
        const key = book.bookName + '::' + sheetInfo.sheetName;
        vocabWords[key] = fetchVocabWordsFromSheet_({
          bookName: book.bookName,
          sheetName: sheetInfo.sheetName,
          filters: {},
          includeBookPool: '1'
        });
      } catch (e) {
        vocabWords[book.bookName + '::' + sheetInfo.sheetName] = { words: [], pool: [], bookPool: [] };
      }
    });
  });
  return {
    version: computePresetVersion_(),
    exportedAt: new Date().toISOString(),
    catalog: catalog,
    vocabCatalog: vocabCatalog,
    questions: questions,
    vocabWords: vocabWords
  };
}