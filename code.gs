// code.gs 統合版

/** アプリ表示名 */
const APP_NAME = 'DigitalDrill（デジドリ）';

/** スクリプトプロパティキー */
const PROP = {
  CLIENT_ID: 'CLIENT_ID',
  /** OAuth トークン交換用（Pages に置かず Script Properties のみ） */
  CLIENT_SECRET: 'CLIENT_SECRET',
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
  WHITELIST_CACHE: 'WHITELIST_CACHE',
  /** フォーム回答シート名（未設定時は自動検出） */
  FORM_RESPONSE_SHEET: 'FORM_RESPONSE_SHEET',
  /** Google フォーム formResponse URL（未設定時は既定値） */
  GOOGLE_FORM_ACTION_URL: 'GOOGLE_FORM_ACTION_URL',
  /** 双方向デプロイ間の auth トークン同期先（未設定時は DEFAULT_* から推定） */
  PEER_WEBAPP_URL: 'PEER_WEBAPP_URL',
  /** registerAuthToken / exportAuthToken 用（未設定時は CLIENT_SECRET） */
  AUTH_MIRROR_SECRET: 'AUTH_MIRROR_SECRET',
  /** 課題点検票（whitelist 名簿 → 提出転記） */
  CHECK_YEAR: 'CHECK_YEAR',
  CHECK_FOLDER_ID: 'CHECK_FOLDER_ID',
  CHECK_ASSIGNMENT_SS_ID: 'CHECK_ASSIGNMENT_SS_ID',
  CHECK_QUIZ_PF_SS_ID: 'CHECK_QUIZ_PF_SS_ID',
  CHECK_QUIZ_SCORE_SS_ID: 'CHECK_QUIZ_SCORE_SS_ID',
  CHECK_SCOPE_GRADE: 'CHECK_SCOPE_GRADE',
  CHECK_SCOPE_CLASS: 'CHECK_SCOPE_CLASS',
  CHECK_SCOPE_NUMBER: 'CHECK_SCOPE_NUMBER',
  CHECK_SCOPE_ATTR1: 'CHECK_SCOPE_ATTR1',
  CHECK_SCOPE_ATTR2: 'CHECK_SCOPE_ATTR2',
  CHECK_SCOPE_ATTR3: 'CHECK_SCOPE_ATTR3',
  CHECK_SCOPE_ATTR4: 'CHECK_SCOPE_ATTR4',
  CHECK_SCOPE_ATTR5: 'CHECK_SCOPE_ATTR5'
};

const AUTH_CACHE_PREFIX = 'auth_';
/** 教材の版。全ユーザー共通なので CacheService に載せて Drive 走査を抑える */
const PRESET_VERSION_CACHE_KEY = 'preset_version';
const PRESET_VERSION_CACHE_TTL = 120;
/** 認証トークン有効期間: 1時間半（5400秒） */
const AUTH_CACHE_TTL = 5400;
const DEFAULT_PAGES_URL = 'https://snakamurako-coder.github.io/grammarquiz/';
/** index.html の GOOGLE_CLIENT_ID と揃える（Script Properties 未設定時の既定値） */
const DEFAULT_CLIENT_ID = '505252303455-84r495bnnsgiefcrv24ro2qtohlgbk2h.apps.googleusercontent.com';
/** GAS① ユーザー権限デプロイ（config.js の DASHBOARD_URL と同一） */
const DEFAULT_DASHBOARD_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxN9pnUp_mG6QHBKJz2WPaS-YqZlrhUaSI1XjTc3aXbmivNowfQPAi1Vi0WmpmfcDSo/exec';
/** GAS② 作成者権限デプロイ（config.js の API_URL と同一） */
const DEFAULT_API_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwZlw4Q3SGI06YRHogjImWKc25jtLaKAVeEyuAwY0SCY34PvmI14W1LRpRzPxWvTgI/exec';

const MATERIALS_FOLDER_NAME = 'grammarquizzes';
const VOCABULARY_FOLDER_NAME = 'vocabulary';
/** 本体スプレッドシート（whitelist・フォーム回答） */
const APP_BOOK_NAME = 'DigitalDrill';
const MY_VOCAB_BOOK_NAME = 'マイ単語帳';
/** 単語帳など学習セットの空欄 sentinel（U+00D7 乗算記号） */
const UNREGISTERED = '×';
const LEGACY_UNREGISTERED = '(未登録)';

function naturalLabelSort_(a, b) {
  return String(a).localeCompare(String(b), 'ja', { numeric: true, sensitivity: 'base' });
}
const FORM_RESPONSE_HEADER_USER_ID = 'User_ID';

/** config.js の GOOGLE_FORM と同期（集約フォーム） */
const DEFAULT_GOOGLE_FORM_ACTION_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfI7mmZPNniyB602utDUnie6W79DQaZgWJghOKTz8TZeiwMPA/formResponse';
const GOOGLE_FORM_ENTRIES = {
  User_ID: 'entry.2140028729',
  Mode: 'entry.1570326402',
  Set_ID: 'entry.275307888',
  Set_Name: 'entry.289930202',
  Attempt_No: 'entry.2072779523',
  Correct: 'entry.1267466184',
  Total: 'entry.967050124',
  Score: 'entry.1646102233',
  Duration_Sec: 'entry.1713523091',
  Started_At: 'entry.1357277820',
  Ended_At: 'entry.1702093208'
};
const GOOGLE_FORM_CTX_CACHE_KEY = 'google_form_ctx_v1';

/** 文法データセット11列ヘッダ。1行が形式A〜Hすべての素材になる */
const GRAMMAR_HEADERS = [
  '通し番号', '大単元', '小単元', '英文全文', '日本語訳',
  '並び替え文', '並び替えダミー', 'N択文', 'N択ダミー',
  'ターゲット文法領域', '解説'
];

/** 文法サンプルカタログの版。変更時は ensureEnvironment が Drive 上のブックを再同期する */
const SAMPLE_CATALOG_VERSION = '2026-grammar-multi-answer-v1';

/** 単語帳22列ヘッダ（管理者配布・ユーザー登録共通） */
const VOCAB_HEADERS = [
  '通し番号', '大区分', '中区分', '小区分', '英単語・熟語の表現',
  '意味＠名詞', '意味＠動詞', '意味＠形容詞', '意味＠副詞', '意味＠前置詞',
  '意味＠接続詞', '意味＠その他品詞', '意味＠熟語・慣用表現',
  'メモ', '類義語・同義語', '対義語', '派生語・関連語',
  '英文による定義', 'チャンク', 'チャンク訳', '例文', '例文訳'
];

/** 既存ブックの番号付き見出しなどを正の列名へ寄せる */
const VOCAB_HEADER_ALIASES = {
  '意味①名詞': '意味＠名詞',
  '意味②動詞': '意味＠動詞',
  '意味③形容詞': '意味＠形容詞',
  '意味④副詞': '意味＠副詞',
  '意味⑤前置詞': '意味＠前置詞',
  '意味⑥接続詞': '意味＠接続詞',
  '意味⑦その他品詞': '意味＠その他品詞',
  '意味⑦その他助動詞': '意味＠その他品詞',
  '意味⑧熟語・慣用表現': '意味＠熟語・慣用表現',
  '意味⑧句動詞・熟語表現': '意味＠熟語・慣用表現'
};

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

  if (!isAssignmentAdminEmail_(access.email)) {
    const pagesUrl = getPagesUrl_();
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
      '<body style="font-family:sans-serif;max-width:560px;margin:60px auto;padding:0 16px;text-align:center;">' +
      '<h1>' + APP_NAME + '</h1>' +
      '<p>学習者の方は GitHub Pages の学習画面をご利用ください。</p>' +
      '<p><a href="' + pagesUrl + '">学習画面を開く</a></p>' +
      '<p style="font-size:.85em;color:#666;margin-top:24px;">管理画面は whitelist の class 列が <code>admin</code> のアカウントのみ利用できます。</p>' +
      '<p style="font-size:.85em;color:#666;margin-top:8px;"><a href="' + ScriptApp.getService().getUrl() + '?action=auth">ログイン（Pagesへ）</a></p>' +
      '</body></html>'
    ).setTitle(APP_NAME).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const template = HtmlService.createTemplateFromFile('dashboard');
  template.PAGES_URL = getPagesUrl_();
  return template.evaluate()
    .setTitle(APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** dashboard.html から部分 HTML/JS を読み込む */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
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

/** [] の外側の / のみで文バリエーションを分割 */
function splitGrammarVariants_(text) {
  const s = (text || '').toString().trim();
  if (!s) return [''];
  const parts = [];
  let current = '';
  let bracketDepth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '[') {
      bracketDepth++;
      current += ch;
    } else if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += ch;
    } else if (ch === '/' && bracketDepth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.length ? parts : [''];
}

/** word[alt1/alt2] を検出し、語[直前語+候補]の全組み合わせを展開 */
function expandWordAlternatives_(sentence) {
  const s = (sentence || '').toString().trim();
  if (!s) return [''];

  function expandRecursive(str) {
    const m = str.match(/([^\s\[]+)\[([^\]]+)\]/);
    if (!m) return [str.replace(/\s+/g, ' ').trim()];
    const alts = [m[1]].concat(
      m[2].split('/').map(function (a) { return a.trim(); }).filter(Boolean)
    );
    const results = [];
    alts.forEach(function (alt) {
      const replaced = str.slice(0, m.index) + alt + str.slice(m.index + m[0].length);
      expandRecursive(replaced).forEach(function (r) {
        if (r && results.indexOf(r) === -1) results.push(r);
      });
    });
    return results;
  }

  return expandRecursive(s);
}

/** 受理される英文の完全展開リスト */
function expandAcceptedSentences_(raw) {
  const variants = splitGrammarVariants_(raw);
  const all = [];
  variants.forEach(function (v) {
    expandWordAlternatives_(v).forEach(function (sent) {
      const norm = sent.replace(/\s+/g, ' ').trim();
      if (norm && all.indexOf(norm) === -1) all.push(norm);
    });
  });
  return all.length ? all : [''];
}

/** 正規化後、受理リストのいずれかと一致すれば true */
function matchesAcceptedSentences_(user, acceptedSentences) {
  const normUser = normalizeGrammarSentence_(user);
  if (!normUser) return false;
  const list = acceptedSentences || [];
  for (let i = 0; i < list.length; i++) {
    if (normalizeGrammarSentence_(list[i]) === normUser) return true;
  }
  return false;
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
      const acceptedSentences = expandAcceptedSentences_(fullSentence);

      const warnings = [];
      if (sort && !matchesAcceptedSentences_(joinGrammarSentence_(sort.prefix, sortTokens.join(' '), sort.suffix), acceptedSentences)) {
        warnings.push('並び替え文を組み立てても英文全文と一致しません');
      }
      if (mcq && !matchesAcceptedSentences_(joinGrammarSentence_(mcq.prefix, mcqAnswer, mcq.suffix), acceptedSentences)) {
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

    // OAuth トークン交換は Drive 初期化不要（CLIENT_SECRET は Script Properties）
    if (action === 'exchangeOAuthCode') {
      return handleExchangeOAuthCode_(requestData);
    }
    if (action === 'refreshOAuthToken') {
      return handleRefreshOAuthToken_(requestData);
    }
    if (action === 'registerAuthToken') {
      return sendResponse(handleRegisterAuthToken_(requestData));
    }
    if (action === 'exportAuthToken') {
      return sendResponse(handleExportAuthToken_(requestData));
    }

    if (action === "login") {
      ensureEnvironment();
      return handleLogin_(requestData);
    }

    ensureEnvironment();

    if (action === "logout") {
      if (requestData.authToken) invalidateAuthToken_(requestData.authToken);
      return sendResponse({ status: "success", message: "ログアウトしました" });
    } else if (action === "submitFormSummary") {
      syncWhitelistCacheIfStale_();
      return sendResponse(apiSubmitFormSummary_(requestData));
    } else if (action === 'listMyAssignments' || action === 'getAssignment'
        || action === 'startAssignmentAttempt' || action === 'submitAssignmentAttempt'
        || action === 'reportQuizAchievement' || action === 'saveHomeworkProgress'
        || action === 'adminListAssignments'
        || action === 'adminUpsertAssignment' || action === 'adminDeleteAssignments'
        || action === 'adminListSubmissions') {
      syncWhitelistCacheIfStale_();
      return sendResponse(handleAssignmentApi_(action, requestData));
    } else {
      return sendResponse({ status: "error", message: "無効なactionです: " + action });
    }
  } catch (error) {
    return sendResponse({ status: "error", message: error.toString() });
  }
}

/**
 * Pages（PKCE）からの認可コード交換。
 * Web クライアントは client_secret 必須のため GAS② のみが秘密を持つ。
 */
function handleExchangeOAuthCode_(requestData) {
  const code = String(requestData.code || '');
  const codeVerifier = String(requestData.codeVerifier || requestData.code_verifier || '');
  const redirectUri = String(requestData.redirectUri || requestData.redirect_uri || '');
  if (!code || !codeVerifier || !redirectUri) {
    return sendResponse({ status: 'error', message: 'code / codeVerifier / redirectUri が必要です' });
  }
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty(PROP.CLIENT_ID) || DEFAULT_CLIENT_ID;
  const clientSecret = String(props.getProperty(PROP.CLIENT_SECRET) || '').trim();
  if (!clientSecret) {
    return sendResponse({
      status: 'error',
      code: 'client_secret_missing',
      message: 'Script Properties に CLIENT_SECRET が未設定です（GCP OAuth クライアントのシークレットを GAS①② 両方に登録）'
    });
  }
  const body = {
    client_id: clientId,
    client_secret: clientSecret,
    code: code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  };
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: Object.keys(body).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(body[k]);
    }).join('&'),
    muteHttpExceptions: true
  });
  const text = res.getContentText();
  let data = {};
  try { data = JSON.parse(text); } catch (e) {}
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    return sendResponse({
      status: 'error',
      message: data.error_description || data.error || ('token exchange failed: ' + res.getResponseCode())
    });
  }
  return sendResponse({
    status: 'success',
    access_token: data.access_token || '',
    refresh_token: data.refresh_token || '',
    expires_in: data.expires_in || 3600,
    id_token: data.id_token || '',
    token_type: data.token_type || 'Bearer',
    scope: data.scope || ''
  });
}

/** refresh_token から access_token を更新（client_secret は GAS 側のみ） */
function handleRefreshOAuthToken_(requestData) {
  const refreshToken = String(requestData.refreshToken || requestData.refresh_token || '');
  if (!refreshToken) {
    return sendResponse({ status: 'error', message: 'refreshToken が必要です' });
  }
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty(PROP.CLIENT_ID) || DEFAULT_CLIENT_ID;
  const clientSecret = String(props.getProperty(PROP.CLIENT_SECRET) || '').trim();
  if (!clientSecret) {
    return sendResponse({
      status: 'error',
      code: 'client_secret_missing',
      message: 'Script Properties に CLIENT_SECRET が未設定です'
    });
  }
  const body = {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  };
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: Object.keys(body).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(body[k]);
    }).join('&'),
    muteHttpExceptions: true
  });
  const text = res.getContentText();
  let data = {};
  try { data = JSON.parse(text); } catch (e) {}
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    return sendResponse({
      status: 'error',
      message: data.error_description || data.error || ('refresh failed: ' + res.getResponseCode())
    });
  }
  return sendResponse({
    status: 'success',
    access_token: data.access_token || '',
    refresh_token: data.refresh_token || '',
    expires_in: data.expires_in || 3600,
    token_type: data.token_type || 'Bearer',
    scope: data.scope || ''
  });
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
    return {
      account: normalized, name: '管理者', grade: '', class: 'admin', role: 'admin',
      attribute1: '', attribute2: '', attribute3: '', attribute4: '', attribute5: ''
    };
  }
  const spreadId = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
  if (!spreadId) {
    return {
      account: normalized, name: '', grade: '', class: '',
      attribute1: '', attribute2: '', attribute3: '', attribute4: '', attribute5: ''
    };
  }
  try {
    const sheet = SpreadsheetApp.openById(spreadId).getSheetByName('whitelist');
    if (!sheet) {
      return {
        account: normalized, name: '', grade: '', class: '',
        attribute1: '', attribute2: '', attribute3: '', attribute4: '', attribute5: ''
      };
    }
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const accountIdx = headers.indexOf('account');
    if (accountIdx === -1) {
      return {
        account: normalized, name: '', grade: '', class: '',
        attribute1: '', attribute2: '', attribute3: '', attribute4: '', attribute5: ''
      };
    }
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][accountIdx] || '').trim().toLowerCase() === normalized) {
        const user = {};
        for (let j = 0; j < headers.length; j++) {
          if (headers[j]) user[headers[j]] = data[i][j];
        }
        if (String(user.class || '').trim().toLowerCase() === 'admin') {
          user.role = 'admin';
        }
        return user;
      }
    }
  } catch (e) {
    // GAS① 実行文脈など
  }
  return {
    account: normalized, name: '', grade: '', class: '',
    attribute1: '', attribute2: '', attribute3: '', attribute4: '', attribute5: ''
  };
}

/**
 * 宿題・小テスト管理権限。
 * whitelist の class=admin、または Script Properties の ADMIN_EMAIL。
 */
function isAssignmentAdminUser_(user) {
  if (!user) return false;
  if (String(user.role || '').toLowerCase() === 'admin') return true;
  if (String(user.class || '').trim().toLowerCase() === 'admin') return true;
  const account = String(user.account || user.email || '').trim().toLowerCase();
  return !!account && isAdminEmail_(account);
}

function isAssignmentAdminEmail_(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  if (isAdminEmail_(normalized)) return true;
  return isAssignmentAdminUser_(getWhitelistUserProfile_(normalized));
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
  mirrorAuthTokenToPeerDeployment_(token, payload);
  return token;
}

function getAuthMirrorSecret_() {
  const props = PropertiesService.getScriptProperties();
  return String(props.getProperty(PROP.AUTH_MIRROR_SECRET) || props.getProperty(PROP.CLIENT_SECRET) || '').trim();
}

/** GAS①↔GAS② のもう一方の exec URL（Script Properties 未設定時は既定 URL から推定） */
function getPeerWebAppUrl_() {
  const configured = String(PropertiesService.getScriptProperties().getProperty(PROP.PEER_WEBAPP_URL) || '').trim();
  if (configured) return configured.split('?')[0];
  const self = String(ScriptApp.getService().getUrl() || '').split('?')[0];
  const dash = String(DEFAULT_DASHBOARD_WEBAPP_URL).split('?')[0];
  const api = String(DEFAULT_API_WEBAPP_URL).split('?')[0];
  if (self && self === dash) return api;
  if (self && self === api) return dash;
  return '';
}

function validateAuthMirrorSecret_(requestData) {
  const secret = getAuthMirrorSecret_();
  if (!secret) return false;
  return String((requestData && requestData.secret) || '') === secret;
}

/** もう一方のデプロイの CacheService に同じ auth ペイロードを載せる */
function mirrorAuthTokenToPeerDeployment_(token, payload) {
  const peerUrl = getPeerWebAppUrl_();
  const secret = getAuthMirrorSecret_();
  if (!peerUrl || !secret || !token || !payload) return;
  try {
    UrlFetchApp.fetch(peerUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        action: 'registerAuthToken',
        secret: secret,
        token: token,
        payload: payload
      }),
      muteHttpExceptions: true
    });
  } catch (e) {
    // 非致命（片方のデプロイだけでも動作継続）
  }
}

/** ローカル Cache に無いトークンを peer から取り込む（GAS① 発行 → GAS② 参照 等） */
function fetchAuthTokenFromPeerDeployment_(token) {
  const peerUrl = getPeerWebAppUrl_();
  const secret = getAuthMirrorSecret_();
  if (!peerUrl || !secret || !token) return null;
  try {
    const res = UrlFetchApp.fetch(peerUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        action: 'exportAuthToken',
        secret: secret,
        token: token
      }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return null;
    const data = JSON.parse(res.getContentText());
    if (data.status !== 'success' || !data.payload) return null;
    CacheService.getScriptCache().put(
      AUTH_CACHE_PREFIX + token,
      JSON.stringify(data.payload),
      AUTH_CACHE_TTL
    );
    return data.payload;
  } catch (e) {
    return null;
  }
}

function handleRegisterAuthToken_(requestData) {
  if (!validateAuthMirrorSecret_(requestData)) {
    return { status: 'error', message: 'forbidden' };
  }
  const token = String((requestData && requestData.token) || '');
  const payload = requestData && requestData.payload;
  if (!token || !payload || typeof payload !== 'object') {
    return { status: 'error', message: 'token / payload が必要です' };
  }
  if (payload.expiresAt && Date.now() > payload.expiresAt) {
    return { status: 'error', message: 'expired' };
  }
  CacheService.getScriptCache().put(AUTH_CACHE_PREFIX + token, JSON.stringify(payload), AUTH_CACHE_TTL);
  return { status: 'success' };
}

function handleExportAuthToken_(requestData) {
  if (!validateAuthMirrorSecret_(requestData)) {
    return { status: 'error', message: 'forbidden' };
  }
  const token = String((requestData && requestData.token) || '');
  if (!token) return { status: 'error', message: 'token が必要です' };
  const raw = CacheService.getScriptCache().get(AUTH_CACHE_PREFIX + token);
  if (!raw) return { status: 'error', message: 'not_found' };
  try {
    const payload = JSON.parse(raw);
    if (payload.expiresAt && Date.now() > payload.expiresAt) {
      return { status: 'error', message: 'expired' };
    }
    return { status: 'success', payload: payload };
  } catch (e) {
    return { status: 'error', message: 'invalid_payload' };
  }
}

/** 認証トークンを検証（無効・期限切れなら null） */
function validateAuthToken_(token) {
  if (!token) return null;
  let raw = CacheService.getScriptCache().get(AUTH_CACHE_PREFIX + token);
  if (!raw) {
    fetchAuthTokenFromPeerDeployment_(token);
    raw = CacheService.getScriptCache().get(AUTH_CACHE_PREFIX + token);
  }
  if (!raw) return null;
  try {
    const auth = JSON.parse(raw);
    if (auth.expiresAt && Date.now() > auth.expiresAt) {
      invalidateAuthToken_(token);
      return null;
    }
    return auth;
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
  if (!auth) return { ok: false, error: '認証トークンが無効または期限切れです。再ログインしてください。' };
  return { ok: true, auth: auth };
}

/** 課題配布判定用: トークン保存時の profile ではなく whitelist 最新値を使う */
function resolveAuthUserFromRequest_(authReq) {
  const auth = authReq && authReq.auth;
  if (!auth) return {};
  const email = String(auth.email || (auth.user && auth.user.account) || '').trim().toLowerCase();
  if (email) {
    const fresh = getWhitelistUserProfile_(email);
    if (fresh) return fresh;
  }
  return auth.user || {};
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
    try { ensureCheckExportTrigger_(); } catch (e) { /* トリガー権限が無い実行文脈では無視 */ }
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
  try { ensureCheckExportTrigger_(); } catch (e) { /* セットアップ時点でトリガー不可でも続行 */ }

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
  ensureWhitelistColumns_(whitelist);

  ensureAssignmentSheets_(ss);

  // 作成直後の「シート1」が残っていれば削除
  const leftover = ss.getSheetByName('シート1');
  if (leftover && ss.getSheets().length > 1) {
    ss.deleteSheet(leftover);
  }
}

/** whitelist に attribute1～5 列を追加（既存行は保持） */
function ensureWhitelistColumns_(whitelist) {
  const required = ['account', 'name', 'grade', 'class', 'number', 'attribute1', 'attribute2', 'attribute3', 'attribute4', 'attribute5'];
  if (whitelist.getLastRow() === 0 || String(whitelist.getRange(1, 1).getValue() || '') === '') {
    whitelist.clear();
    whitelist.appendRow(required);
    whitelist.appendRow(['example@example.com', 'サンプル太郎', '1', 'A', '1', '', '', '', '', '']);
    whitelist.getRange(1, 1, 1, required.length).setFontWeight('bold');
    return;
  }
  const lastCol = Math.max(1, whitelist.getLastColumn());
  const headerRow = whitelist.getRange(1, 1, 1, lastCol).getValues()[0];
  const headers = headerRow.map(function (h) { return String(h || '').trim(); });
  required.forEach(function (col) {
    if (headers.indexOf(col) >= 0) return;
    const nextCol = headers.length + 1;
    whitelist.getRange(1, nextCol).setValue(col).setFontWeight('bold');
    headers.push(col);
  });
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
      ],
      '関係詞': [
        headers,
        row(1, '関係詞', '関係代名詞',
          'This is the hospital in which I was born./This is the hospital that[which] I was born in./This is the hospital where I was born.',
          '私が生まれた病院です。',
          'This is the hospital (in,which,I,was,born).', 'where',
          'This is the hospital (in which) I was born.', 'which,where,that I was born,when I was born',
          '関係詞', 'in which / that ... in / where の3パターンが正答。')
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
      '熟語として登録。6〜12列目はすべて×。',
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

function canonicalizeVocabHeader_(header) {
  const raw = header === null || header === undefined ? '' : header.toString().trim();
  if (!raw) return '';
  if (VOCAB_HEADER_ALIASES[raw]) return VOCAB_HEADER_ALIASES[raw];
  if (raw.indexOf('意味@') === 0) return '意味＠' + raw.slice('意味@'.length);
  return raw;
}

function rowToVocabObject_(headers, row) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    const key = canonicalizeVocabHeader_(headers[i]);
    if (!key) continue;
    const value = row[i] !== undefined && row[i] !== null ? row[i] : '';
    if (obj[key] === undefined || obj[key] === '') obj[key] = value;
  }
  return obj;
}

function parseVocabSheetValues_(data, filters) {
  if (!data || data.length <= 1) return { words: [], pool: [] };
  const headers = data[0];
  const daiFilter = (filters && filters.dai) || [];
  const chuFilter = (filters && filters.chu) || [];
  const shoFilter = (filters && filters.sho) || [];
  const words = [];
  const pool = [];
  for (let r = 1; r < data.length; r++) {
    const rowObj = rowToVocabObject_(headers, data[r]);
    rowObj._rowIndex = r + 1;
    const word = normalizeVocabField_(rowObj['英単語・熟語の表現']);
    if (word === UNREGISTERED) continue;
    pool.push(rowObj);
    const dai = normalizeVocabField_(rowObj['大区分']);
    const chu = normalizeVocabField_(rowObj['中区分']);
    const sho = normalizeVocabField_(rowObj['小区分']);
    if (daiFilter.length && daiFilter.indexOf(dai) === -1) continue;
    if (chuFilter.length && chuFilter.indexOf(chu) === -1) continue;
    if (shoFilter.length && shoFilter.indexOf(sho) === -1) continue;
    words.push(rowObj);
  }
  return { words: words, pool: pool };
}

function fetchVocabWordsFromSpreadsheet_(ss, sheetName, filters, includeBookPool) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('シートが見つかりません: ' + sheetName);
  const parsed = parseVocabSheetValues_(sheet.getDataRange().getValues(), filters || {});
  let bookPool = parsed.pool;
  if (includeBookPool) {
    bookPool = [];
    ss.getSheets().forEach(function (sh) {
      const part = parseVocabSheetValues_(sh.getDataRange().getValues(), {});
      part.pool.forEach(function (rowObj) {
        rowObj._sheetName = sh.getName();
        bookPool.push(rowObj);
      });
    });
  }
  return { words: parsed.words, pool: parsed.pool, bookPool: bookPool };
}

function normalizeVocabField_(value) {
  if (value === null || value === undefined) return UNREGISTERED;
  const str = value.toString().trim();
  if (str === '' || str === LEGACY_UNREGISTERED) return UNREGISTERED;
  return str;
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

function vocabSerialCell_(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s === UNREGISTERED) return '';
  return s;
}

function nextVocabSerial_(prevRaw) {
  const n = parseInt(String(prevRaw == null ? '' : prevRaw).trim(), 10);
  return isFinite(n) ? n + 1 : 1;
}

function buildVocabRowFromInput_(rowObj) {
  validateVocabInputRow_(rowObj);
  const result = [];
  VOCAB_HEADERS.forEach(function (header) {
    if (header === '通し番号') {
      result.push(vocabSerialCell_(rowObj[header]));
      return;
    }
    result.push(normalizeVocabField_(rowObj[header]));
  });
  return result;
}

/** 空の通し番号だけ埋める。既存値は触らない。空欄は直前行＋1（先頭は見出しなので 1）。 */
function fillBlankVocabSerials_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  const col = sheet.getRange(1, 1, lastRow, 1).getValues();
  const nums = [];
  let prev = col[0][0];
  let changed = false;
  for (let i = 1; i < col.length; i++) {
    const raw = col[i][0];
    if (vocabSerialCell_(raw)) {
      nums.push([raw]);
      prev = raw;
    } else {
      const next = nextVocabSerial_(prev);
      nums.push([next]);
      prev = next;
      changed = true;
    }
  }
  if (!changed) return;
  sheet.getRange(2, 1, nums.length, 1).setValues(nums);
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

  /** 学習者のマイ単語帳は GAS では返さない（Pages の UserDriveModule / OAuth のみ） */
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
      dai: Object.keys(daiSet).sort(naturalLabelSort_),
      chu: Object.keys(chuSet).sort(naturalLabelSort_),
      sho: Object.keys(shoSet).sort(naturalLabelSort_)
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
  fillBlankVocabSerials_(sheet);

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
// ⑨ 認証ヘルパー
// =========================================================

function getPagesUrl_() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty(PROP.PAGES_URL) || DEFAULT_PAGES_URL;
}

function generateSessionToken_() {
  return Utilities.getUuid().replace(/-/g, '');
}

// =========================================================
// ⑨-b Google フォーム集約（GAS② 経由で fbzx 付き POST）
// 設計契約: docs/FORM_AGGREGATION_SANCTUARY.md
// =========================================================

function getGoogleFormActionUrl_() {
  return PropertiesService.getScriptProperties().getProperty(PROP.GOOGLE_FORM_ACTION_URL)
    || DEFAULT_GOOGLE_FORM_ACTION_URL;
}

function formViewUrlFromAction_(actionUrl) {
  return String(actionUrl || '').replace(/\/formResponse\/?$/, '/viewform');
}

function parseGoogleFormContextFromHtml_(html) {
  let fbzx = '';
  const m1 = String(html || '').match(/name="fbzx"\s+value="([^"]+)"/);
  if (m1) fbzx = m1[1];
  if (!fbzx) {
    const m2 = String(html || '').match(/"fbzx","([^"]+)"/);
    if (m2) fbzx = m2[1];
  }
  if (!fbzx) {
    const m3 = String(html || '').match(/name=['"]fbzx['"][^>]*value=['"]([^'"]+)['"]/i);
    if (m3) fbzx = m3[1];
  }
  if (!fbzx) {
    const m4 = String(html || '').match(/\[null,null,"(-?\d+)"\]/);
    if (m4) fbzx = m4[1];
  }
  if (!fbzx) throw new Error('Googleフォームの fbzx を取得できませんでした');
  return {
    fbzx: fbzx,
    partialResponse: '[null,null,"' + fbzx + '"]',
    pageHistory: '0'
  };
}

function fetchGoogleFormContext_(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cached = cache.get(GOOGLE_FORM_CTX_CACHE_KEY);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* ignore */ }
    }
  }
  const viewUrl = formViewUrlFromAction_(getGoogleFormActionUrl_());
  const res = UrlFetchApp.fetch(viewUrl, {
    muteHttpExceptions: true,
    followRedirects: true
  });
  if (res.getResponseCode() >= 400) {
    throw new Error('Googleフォーム viewform の取得に失敗しました HTTP ' + res.getResponseCode());
  }
  const ctx = parseGoogleFormContextFromHtml_(res.getContentText());
  cache.put(GOOGLE_FORM_CTX_CACHE_KEY, JSON.stringify(ctx), 300);
  return ctx;
}

function submitGoogleFormSummary_(summary, userId) {
  const actionUrl = getGoogleFormActionUrl_();
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctx = fetchGoogleFormContext_(attempt > 0);
      const payload = {
        fvv: '1',
        pageHistory: ctx.pageHistory || '0',
        fbzx: ctx.fbzx,
        partialResponse: ctx.partialResponse
      };
      Object.keys(GOOGLE_FORM_ENTRIES).forEach(function (key) {
        const entryId = GOOGLE_FORM_ENTRIES[key];
        const value = key === 'User_ID' ? userId : summary[key];
        payload[entryId] = value != null ? String(value) : '';
      });
      const res = UrlFetchApp.fetch(actionUrl, {
        method: 'post',
        payload: payload,
        muteHttpExceptions: true,
        followRedirects: false
      });
      const code = res.getResponseCode();
      if (code >= 200 && code < 400) return { status: 'success' };
      lastError = new Error('Googleフォーム送信失敗 HTTP ' + code);
    } catch (e) {
      lastError = e;
    }
    CacheService.getScriptCache().remove(GOOGLE_FORM_CTX_CACHE_KEY);
  }
  throw lastError || new Error('Googleフォーム送信に失敗しました');
}

function apiSubmitFormSummary_(requestData) {
  const authReq = requireAuthToken_(requestData);
  if (!authReq.ok) return { status: 'error', message: authReq.error };
  const summary = requestData.summary || {};
  const auth = authReq.auth;
  const userId = (auth.user && auth.user.account) ? auth.user.account : (auth.email || '');
  if (!getGoogleFormActionUrl_()) {
    return { status: 'error', message: 'GOOGLE_FORM_ACTION_URL が未設定です' };
  }
  try {
    return submitGoogleFormSummary_(summary, userId);
  } catch (e) {
    return { status: 'error', message: String(e.message || e) };
  }
}

// =========================================================
// ⑩ 管理者セッション集約（Google フォーム回答シート閲覧）
// =========================================================

/** フォーム回答先シートを本体 SS から探す */
function findFormResponseSheet_(ss) {
  const skipNames = { whitelist: 1, assignments: 1, assignment_submissions: 1 };
  const configured = PropertiesService.getScriptProperties().getProperty(PROP.FORM_RESPONSE_SHEET);
  if (configured) {
    const configuredSheet = ss.getSheetByName(configured);
    if (configuredSheet) return configuredSheet;
  }

  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].getName();
    if (name.indexOf('フォームの回答') === 0) return sheets[i];
  }

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const name = sheet.getName();
    if (skipNames[name]) continue;
    if (sheet.getLastRow() === 0) continue;
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) continue;
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (headers.indexOf(FORM_RESPONSE_HEADER_USER_ID) >= 0) return sheet;
  }

  return null;
}

/** google.script.run 向けにセル値を JSON 化可能な型へ（Date は文字列化） */
function serializeCellForClient_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  }
  if (typeof value === 'object') return String(value);
  return value;
}

function normalizeFormResponseRow_(headers, row) {
  const obj = {};
  for (let j = 0; j < headers.length; j++) {
    if (headers[j]) obj[headers[j]] = serializeCellForClient_(row[j]);
  }
  if (!obj.Ended_At && obj['タイムスタンプ']) obj.Ended_At = obj['タイムスタンプ'];
  if (!obj.User_ID && obj[FORM_RESPONSE_HEADER_USER_ID]) obj.User_ID = obj[FORM_RESPONSE_HEADER_USER_ID];
  return obj;
}

function apiAdminGetSessionSummaries(limit) {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed || !isAssignmentAdminEmail_(access.email)) {
      return { status: 'error', message: '管理者権限が必要です（whitelist の class=admin）' };
    }
    const spreadId = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
    if (!spreadId) {
      return { status: 'success', data: [], message: 'SPREADSHEET_ID 未設定のため集約データはありません' };
    }
    const ss = SpreadsheetApp.openById(spreadId);
    const sheet = findFormResponseSheet_(ss);
    if (!sheet || sheet.getLastRow() <= 1) {
      return { status: 'success', data: [], message: 'フォーム回答シートが未設定またはデータがありません' };
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const max = limit || 100;
    const logs = [];
    for (let i = data.length - 1; i >= 1 && logs.length < max; i--) {
      logs.push(normalizeFormResponseRow_(headers, data[i]));
    }
    return { status: 'success', data: logs };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiAdminGetWhitelist() {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed || !isAssignmentAdminEmail_(access.email)) {
      return { status: 'error', message: '管理者権限が必要です（whitelist の class=admin）' };
    }
    const emails = readWhitelistEmailsFromSheet_();
    const spreadId = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
    const ss = SpreadsheetApp.openById(spreadId);
    const sheet = ss.getSheetByName('whitelist');
    ensureWhitelistColumns_(sheet);
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
// 宿題・小テスト（assignments / assignment_submissions）
// =========================================================

const ASSIGNMENT_HEADERS = [
  'Assignment_ID', 'Title', 'Kind', 'Window_Start', 'Window_End', 'Deadline',
  'Time_Limit_Sec', 'Required_Pass_Count', 'Pass_Score', 'Pass_Mode', 'Weakness_Review',
  'Target_Class',
  'Target_attribute1', 'Target_attribute2', 'Target_attribute3', 'Target_attribute4', 'Target_attribute5',
  'Sections_JSON', 'Active', 'Created_By', 'Updated_At'
];

const SUBMISSION_HEADERS = [
  'Submission_ID', 'Assignment_ID', 'Account', 'Attempt_No', 'Status',
  'Score', 'Correct', 'Total', 'Points', 'Points_Max', 'Duration_Sec', 'Timed_Out',
  'Progress_JSON', 'Detail_JSON', 'Submitted_At', 'Check_Exported'
];

const CHECK_FOLDER_NAME = 'DigitalDrill_点検票';
const CHECK_HEADER_ROWS = 5;
const CHECK_ROSTER_COLS = 7;
const CHECK_EXPORT_TRIGGER_FN = 'syncCheckSheetsPending';
const CHECK_EXPORT_BATCH = 80;
const CHECK_DEFAULT_INPUT_SHEET = '名簿＠入力';

function ensureAssignmentSheets_(ss) {
  ensureSheetWithHeaders_(ss, 'assignments', ASSIGNMENT_HEADERS);
  migrateSheetHeaders_(ss.getSheetByName('assignments'), ASSIGNMENT_HEADERS);
  ensureSheetWithHeaders_(ss, 'assignment_submissions', SUBMISSION_HEADERS);
  migrateSheetHeaders_(ss.getSheetByName('assignment_submissions'), SUBMISSION_HEADERS);
}

/** 既存シートの1行目に不足ヘッダ列を追加（データ行は保持） */
function migrateSheetHeaders_(sheet, requiredHeaders) {
  if (!sheet || sheet.getLastRow() === 0) return;
  const lastCol = Math.max(1, sheet.getLastColumn());
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const headers = headerRow.map(function (h) { return String(h || '').trim(); });
  requiredHeaders.forEach(function (col) {
    if (headers.indexOf(col) >= 0) return;
    const nextCol = headers.length + 1;
    sheet.getRange(1, nextCol).setValue(col).setFontWeight('bold');
    headers.push(col);
  });
}

/** 1行目ヘッダ名に合わせてオブジェクトを書き込む（列追加後のずれを防ぐ） */
function writeObjectRowByHeaders_(sheet, requiredHeaders, rowObj, existingRowNum) {
  migrateSheetHeaders_(sheet, requiredHeaders);
  const lastCol = Math.max(sheet.getLastColumn(), requiredHeaders.length);
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const headers = headerRow.map(function (h) { return String(h || '').trim(); });
  const values = [];
  for (let c = 0; c < lastCol; c++) {
    const h = headers[c];
    if (h && Object.prototype.hasOwnProperty.call(rowObj, h)) {
      values.push(rowObj[h]);
    } else {
      values.push('');
    }
  }
  const targetRow = existingRowNum && existingRowNum > 1 ? existingRowNum : sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, lastCol).setValues([values]);
  SpreadsheetApp.flush();
  return targetRow;
}

function ensureSheetWithHeaders_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    return sheet;
  }
  if (sheet.getLastRow() === 0 || String(sheet.getRange(1, 1).getValue() || '') === '') {
    sheet.clear();
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function openAppSpreadsheet_() {
  const spreadId = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
  if (!spreadId) throw new Error('SPREADSHEET_ID が未設定です');
  const ss = SpreadsheetApp.openById(spreadId);
  const wl = ss.getSheetByName('whitelist');
  if (wl) ensureWhitelistColumns_(wl);
  ensureAssignmentSheets_(ss);
  return ss;
}

function sheetRowsToObjects_(sheet) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const obj = { _row: i + 1 };
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) obj[headers[j]] = data[i][j];
    }
    rows.push(obj);
  }
  return rows;
}

/** 旧 Max_Attempts 列も読み取り（ノルマ回数・最低1） */
function readRequiredPassCount_(row) {
  const raw = (row && row.Required_Pass_Count != null && row.Required_Pass_Count !== '')
    ? row.Required_Pass_Count
    : (row && row.Max_Attempts);
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return 1;
  return n;
}

function hasAssignmentAchievement_(subSheet, assignmentId, account) {
  const rows = sheetRowsToObjects_(subSheet);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].Assignment_ID) === String(assignmentId)
        && String(rows[i].Account || '').toLowerCase() === String(account || '').toLowerCase()
        && String(rows[i].Status || '') === 'passed') {
      return rows[i];
    }
  }
  return null;
}

/** 宿題の進行中行（同一課題・同一アカウント）を返す */
function findInProgressSubmission_(subSheet, assignmentId, account) {
  const rows = sheetRowsToObjects_(subSheet);
  const acct = String(account || '').toLowerCase();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].Assignment_ID) === String(assignmentId)
        && String(rows[i].Account || '').toLowerCase() === acct
        && String(rows[i].Status || '') === 'in_progress') {
      return rows[i];
    }
  }
  return null;
}

/** assignment_submissions への書き込みを直列化（同時提出の競合防止） */
function withAssignmentSubmissionLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { status: 'error', message: '課題サーバーが混み合っています。少し待って再試行してください。' };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function evaluateQuizAttemptPass_(asg, correct, total, points, pointsMax, durationSec, timedOut) {
  const score = total > 0
    ? Math.round((correct / total) * 100)
    : (pointsMax > 0 ? Math.round((points / pointsMax) * 100) : 0);
  let pass = false;
  if (asg.Pass_Mode === 'points') {
    pass = points >= asg.Pass_Score;
  } else {
    pass = score >= asg.Pass_Score;
  }
  return { pass: pass, score: score };
}

function parseSectionsJson_(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.slice(0, 4);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.slice(0, 4) : [];
  } catch (e) {
    return [];
  }
}

function normalizeAssignmentRow_(row) {
  return {
    Assignment_ID: String(row.Assignment_ID || ''),
    Title: String(row.Title || ''),
    Kind: String(row.Kind || 'homework') === 'quiz' ? 'quiz' : 'homework',
    Window_Start: serializeCellForClient_(row.Window_Start),
    Window_End: serializeCellForClient_(row.Window_End),
    Deadline: serializeCellForClient_(row.Deadline),
    Time_Limit_Sec: Math.max(0, parseInt(row.Time_Limit_Sec, 10) || 0),
    Required_Pass_Count: readRequiredPassCount_(row),
    Max_Attempts: readRequiredPassCount_(row),
    Pass_Score: Math.max(0, parseInt(row.Pass_Score, 10) || 0),
    Pass_Mode: String(row.Pass_Mode || 'rate') === 'points' ? 'points' : 'rate',
    Weakness_Review: String(row.Weakness_Review || '0') === '1' || row.Weakness_Review === true || row.Weakness_Review === 1 ? 1 : 0,
    Target_Class: String(row.Target_Class || ''),
    Target_attribute1: String(row.Target_attribute1 || ''),
    Target_attribute2: String(row.Target_attribute2 || ''),
    Target_attribute3: String(row.Target_attribute3 || ''),
    Target_attribute4: String(row.Target_attribute4 || ''),
    Target_attribute5: String(row.Target_attribute5 || ''),
    Sections: parseSectionsJson_(row.Sections_JSON),
    Sections_JSON: typeof row.Sections_JSON === 'string'
      ? row.Sections_JSON
      : JSON.stringify(parseSectionsJson_(row.Sections_JSON)),
    Active: String(row.Active || '0') === '1' || row.Active === true || row.Active === 1 ? 1 : 0,
    Created_By: String(row.Created_By || ''),
    Updated_At: String(row.Updated_At || '')
  };
}

function newId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function parseLooseDate_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === 'number' && isFinite(value)) return value;
  const s = String(value).trim();
  if (!s) return null;
  const m = s.match(/(\d{4})[-\/年.](\d{1,2})[-\/月.](\d{1,2})日?(?:[T\s　]+(\d{1,2})[:時](\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    return new Date(
      parseInt(m[1], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[3], 10),
      parseInt(m[4] || '0', 10),
      parseInt(m[5] || '0', 10),
      parseInt(m[6] || '0', 10)
    ).getTime();
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

function isAssignmentInWindow_(asg, nowMs) {
  const start = parseLooseDate_(asg.Window_Start);
  const end = parseLooseDate_(asg.Window_End);
  const deadline = parseLooseDate_(asg.Deadline);
  if (start != null && nowMs < start) return false;
  if (end != null && nowMs > end) return false;
  if (deadline != null && nowMs > deadline) return false;
  return true;
}

function isTargetFieldMatch_(targetRaw, userValue) {
  const raw = String(targetRaw || '').trim();
  if (!raw) return true;
  const user = String(userValue || '').trim().toLowerCase();
  return raw.split(/[,、]/).map(function (s) {
    return String(s || '').trim().toLowerCase();
  }).filter(Boolean).indexOf(user) >= 0;
}

/** 課題の配布対象: class + attribute1～5（指定列はすべて AND、各列はカンマ区切り OR） */
function isAssignmentTargetMatch_(asg, user) {
  user = user || {};
  if (!isTargetFieldMatch_(asg.Target_Class, user.class)) return false;
  if (!isTargetFieldMatch_(asg.Target_attribute1, user.attribute1)) return false;
  if (!isTargetFieldMatch_(asg.Target_attribute2, user.attribute2)) return false;
  if (!isTargetFieldMatch_(asg.Target_attribute3, user.attribute3)) return false;
  if (!isTargetFieldMatch_(asg.Target_attribute4, user.attribute4)) return false;
  if (!isTargetFieldMatch_(asg.Target_attribute5, user.attribute5)) return false;
  return true;
}

function requireAssignmentAdminFromRequest_(requestData) {
  const authReq = requireAuthToken_(requestData);
  if (authReq.ok) {
    if (!isAssignmentAdminUser_(authReq.auth.user) && !isAssignmentAdminEmail_(authReq.auth.email)) {
      return { ok: false, error: '管理者権限が必要です（whitelist の class=admin）' };
    }
    return { ok: true, email: authReq.auth.email, user: authReq.auth.user };
  }
  // GAS① dashboard（ActiveUser）
  const access = checkDashboardAccess_();
  if (!access.allowed || !isAssignmentAdminEmail_(access.email)) {
    return { ok: false, error: authReq.error || '管理者権限が必要です（whitelist の class=admin）' };
  }
  return {
    ok: true,
    email: access.email,
    user: getWhitelistUserProfile_(access.email)
  };
}

function handleAssignmentApi_(action, requestData) {
  try {
    if (action === 'adminListAssignments') return apiAdminListAssignments_(requestData);
    if (action === 'adminUpsertAssignment') return apiAdminUpsertAssignment_(requestData);
    if (action === 'adminDeleteAssignments') return apiAdminDeleteAssignments_(requestData);
    if (action === 'adminListSubmissions') return apiAdminListSubmissions_(requestData);
    if (action === 'listMyAssignments') return apiListMyAssignments_(requestData);
    if (action === 'getAssignment') return apiGetAssignment_(requestData);
    if (action === 'startAssignmentAttempt') {
      return withAssignmentSubmissionLock_(function () { return apiStartAssignmentAttempt_(requestData); });
    }
    if (action === 'submitAssignmentAttempt') {
      return withAssignmentSubmissionLock_(function () { return apiSubmitAssignmentAttempt_(requestData); });
    }
    if (action === 'reportQuizAchievement') {
      return withAssignmentSubmissionLock_(function () { return apiReportQuizAchievement_(requestData); });
    }
    if (action === 'saveHomeworkProgress') {
      return withAssignmentSubmissionLock_(function () { return apiSaveHomeworkProgress_(requestData); });
    }
    return { status: 'error', message: '未知の課題API: ' + action };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiAdminListAssignments_(requestData) {
  const admin = requireAssignmentAdminFromRequest_(requestData || {});
  if (!admin.ok) return { status: 'error', message: admin.error };
  const ss = openAppSpreadsheet_();
  const rows = sheetRowsToObjects_(ss.getSheetByName('assignments')).map(normalizeAssignmentRow_);
  rows.sort(function (a, b) {
    return String(b.Updated_At).localeCompare(String(a.Updated_At));
  });
  return { status: 'success', data: rows };
}

function apiAdminUpsertAssignment_(requestData) {
  const admin = requireAssignmentAdminFromRequest_(requestData || {});
  if (!admin.ok) return { status: 'error', message: admin.error };
  const payload = requestData.assignment || requestData;
  const title = String(payload.Title || '').trim();
  if (!title) return { status: 'error', message: '課題名（Title）は必須です' };
  const sections = parseSectionsJson_(payload.Sections || payload.Sections_JSON);
  if (!sections.length) return { status: 'error', message: 'セクションを1つ以上指定してください' };
  if (sections.length > 4) return { status: 'error', message: 'セクションは最大4つです' };

  const ss = openAppSpreadsheet_();
  const sheet = ss.getSheetByName('assignments');
  const rows = sheetRowsToObjects_(sheet);
  let id = String(payload.Assignment_ID || '').trim();
  let existing = null;
  if (id) {
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i].Assignment_ID) === id) {
        existing = rows[i];
        break;
      }
    }
  } else {
    id = newId_('asg');
  }

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  const rowObj = {
    Assignment_ID: id,
    Title: title,
    Kind: String(payload.Kind || 'homework') === 'quiz' ? 'quiz' : 'homework',
    Window_Start: serializeCellForClient_(payload.Window_Start),
    Window_End: serializeCellForClient_(payload.Window_End),
    Deadline: serializeCellForClient_(payload.Deadline),
    Time_Limit_Sec: Math.max(0, parseInt(payload.Time_Limit_Sec, 10) || 0),
    Required_Pass_Count: Math.max(1, parseInt(payload.Required_Pass_Count != null ? payload.Required_Pass_Count : payload.Max_Attempts, 10) || 1),
    Pass_Score: Math.max(0, parseInt(payload.Pass_Score, 10) || 0),
    Pass_Mode: String(payload.Pass_Mode || 'rate') === 'points' ? 'points' : 'rate',
    Weakness_Review: (String(payload.Weakness_Review || '0') === '1' || payload.Weakness_Review === true || payload.Weakness_Review === 1) ? 1 : 0,
    Target_Class: String(payload.Target_Class || ''),
    Target_attribute1: String(payload.Target_attribute1 || ''),
    Target_attribute2: String(payload.Target_attribute2 || ''),
    Target_attribute3: String(payload.Target_attribute3 || ''),
    Target_attribute4: String(payload.Target_attribute4 || ''),
    Target_attribute5: String(payload.Target_attribute5 || ''),
    Sections_JSON: JSON.stringify(sections),
    Active: (String(payload.Active || '1') === '1' || payload.Active === true || payload.Active === 1) ? 1 : 0,
    Created_By: existing ? String(existing.Created_By || admin.email) : admin.email,
    Updated_At: now
  };
  migrateSheetHeaders_(sheet, ASSIGNMENT_HEADERS);
  writeObjectRowByHeaders_(sheet, ASSIGNMENT_HEADERS, rowObj, existing ? existing._row : 0);
  return { status: 'success', data: normalizeAssignmentRow_(rowObj) };
}

function apiAdminDeleteAssignments_(requestData) {
  const admin = requireAssignmentAdminFromRequest_(requestData || {});
  if (!admin.ok) return { status: 'error', message: admin.error };
  const raw = requestData.assignmentIds || requestData.ids || requestData.Assignment_IDs || [];
  const ids = (Array.isArray(raw) ? raw : [raw]).map(function (id) {
    return String(id || '').trim();
  }).filter(Boolean);
  if (!ids.length) return { status: 'error', message: '削除する課題を選んでください' };
  const idSet = {};
  ids.forEach(function (id) { idSet[id] = true; });
  const ss = openAppSpreadsheet_();
  const asgSheet = ss.getSheetByName('assignments');
  const subSheet = ss.getSheetByName('assignment_submissions');
  let deletedAssignments = 0;
  let deletedSubmissions = 0;
  if (asgSheet) {
    const rows = sheetRowsToObjects_(asgSheet);
    const rowNums = [];
    rows.forEach(function (r) {
      if (idSet[String(r.Assignment_ID || '')]) rowNums.push(r._row);
    });
    rowNums.sort(function (a, b) { return b - a; });
    rowNums.forEach(function (n) { asgSheet.deleteRow(n); });
    deletedAssignments = rowNums.length;
  }
  if (subSheet && deletedAssignments) {
    const subs = sheetRowsToObjects_(subSheet);
    const subRows = [];
    subs.forEach(function (r) {
      if (idSet[String(r.Assignment_ID || '')]) subRows.push(r._row);
    });
    subRows.sort(function (a, b) { return b - a; });
    subRows.forEach(function (n) { subSheet.deleteRow(n); });
    deletedSubmissions = subRows.length;
  }
  SpreadsheetApp.flush();
  if (!deletedAssignments) {
    return { status: 'error', message: '該当する課題が見つかりませんでした' };
  }
  return {
    status: 'success',
    data: { deletedAssignments: deletedAssignments, deletedSubmissions: deletedSubmissions }
  };
}

function formatSheetValueForClient_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  }
  if (value == null) return '';
  return value;
}

/** 管理ダッシュボード提出一覧用（大きな JSON 列は除外） */
function slimSubmissionForAdmin_(row) {
  return {
    Submission_ID: String(row.Submission_ID || ''),
    Assignment_ID: String(row.Assignment_ID || ''),
    Account: String(row.Account || ''),
    Attempt_No: row.Attempt_No,
    Status: String(row.Status || ''),
    Score: row.Score,
    Correct: row.Correct,
    Total: row.Total,
    Points: row.Points,
    Points_Max: row.Points_Max,
    Duration_Sec: row.Duration_Sec,
    Timed_Out: row.Timed_Out,
    Submitted_At: formatSheetValueForClient_(row.Submitted_At)
  };
}

function apiAdminListSubmissions_(requestData) {
  const admin = requireAssignmentAdminFromRequest_(requestData || {});
  if (!admin.ok) return { status: 'error', message: admin.error };
  const assignmentId = String((requestData && requestData.assignmentId) || '').trim();
  const ss = openAppSpreadsheet_();
  let rows = sheetRowsToObjects_(ss.getSheetByName('assignment_submissions'));
  if (assignmentId) {
    rows = rows.filter(function (r) { return String(r.Assignment_ID) === assignmentId; });
  }
  rows.sort(function (a, b) {
    return String(b.Submitted_At || '').localeCompare(String(a.Submitted_At || ''));
  });
  const limit = Math.min(500, Math.max(1, parseInt(requestData && requestData.limit, 10) || 200));
  return { status: 'success', data: rows.slice(0, limit).map(slimSubmissionForAdmin_) };
}

function apiListMyAssignments_(requestData) {
  const authReq = requireAuthToken_(requestData || {});
  if (!authReq.ok) return { status: 'error', message: authReq.error };
  const user = resolveAuthUserFromRequest_(authReq);
  const account = String(authReq.auth.email || user.account || '').toLowerCase();
  const ss = openAppSpreadsheet_();
  const now = Date.now();
  const subs = sheetRowsToObjects_(ss.getSheetByName('assignment_submissions'));
  const achievementByAsg = {};
  const latestByAsg = {};
  subs.forEach(function (s) {
    if (String(s.Account || '').toLowerCase() !== account) return;
    const aid = String(s.Assignment_ID);
    if (String(s.Status || '') === 'passed') achievementByAsg[aid] = s;
    const prev = latestByAsg[aid];
    if (!prev || String(s.Submitted_At || '').localeCompare(String(prev.Submitted_At || '')) > 0) {
      latestByAsg[aid] = s;
    }
  });
  const assignments = sheetRowsToObjects_(ss.getSheetByName('assignments'))
    .map(normalizeAssignmentRow_)
    .filter(function (a) {
      return a.Active === 1 && isAssignmentTargetMatch_(a, user);
    });
  const data = assignments.map(function (a) {
    const aid = a.Assignment_ID;
    return {
      assignment: a,
      windowOpen: isAssignmentInWindow_(a, now),
      serverAchieved: !!achievementByAsg[aid],
      achievementSubmission: achievementByAsg[aid] || null,
      latestSubmission: latestByAsg[aid] || null,
      requiredPassCount: a.Required_Pass_Count
    };
  });
  data.sort(function (x, y) {
    if (x.windowOpen !== y.windowOpen) return x.windowOpen ? -1 : 1;
    return String(x.assignment.Title || '').localeCompare(String(y.assignment.Title || ''), 'ja');
  });
  return { status: 'success', data: data };
}

function apiGetAssignment_(requestData) {
  const authReq = requireAuthToken_(requestData || {});
  if (!authReq.ok) return { status: 'error', message: authReq.error };
  const id = String(requestData.assignmentId || '').trim();
  if (!id) return { status: 'error', message: 'assignmentId が必要です' };
  const ss = openAppSpreadsheet_();
  const rows = sheetRowsToObjects_(ss.getSheetByName('assignments'));
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].Assignment_ID) === id) {
      return { status: 'success', data: normalizeAssignmentRow_(rows[i]) };
    }
  }
  return { status: 'error', message: '課題が見つかりません' };
}

function countAttempts_(sheet, assignmentId, account) {
  const rows = sheetRowsToObjects_(sheet);
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].Assignment_ID) === assignmentId
        && String(rows[i].Account || '').toLowerCase() === account) n++;
  }
  return n;
}

function apiStartAssignmentAttempt_(requestData) {
  const authReq = requireAuthToken_(requestData || {});
  if (!authReq.ok) return { status: 'error', message: authReq.error };
  const id = String(requestData.assignmentId || '').trim();
  if (!id) return { status: 'error', message: 'assignmentId が必要です' };
  const user = resolveAuthUserFromRequest_(authReq);
  const account = String(authReq.auth.email || user.account || '').toLowerCase();
  const ss = openAppSpreadsheet_();
  const asgSheet = ss.getSheetByName('assignments');
  const asgRows = sheetRowsToObjects_(asgSheet);
  let asg = null;
  for (let i = 0; i < asgRows.length; i++) {
    if (String(asgRows[i].Assignment_ID) === id) {
      asg = normalizeAssignmentRow_(asgRows[i]);
      break;
    }
  }
  if (!asg || asg.Active !== 1) return { status: 'error', message: '課題が無効または見つかりません' };
  if (!isAssignmentInWindow_(asg, Date.now())) return { status: 'error', message: '取り組める期間外です' };
  if (!isAssignmentTargetMatch_(asg, user)) {
    return { status: 'error', message: 'この課題の配布対象ではありません' };
  }
  const subSheet = ss.getSheetByName('assignment_submissions');
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');

  /** 小テスト: サーバー行は達成時のみ。開始はクライアントローカル */
  if (asg.Kind === 'quiz') {
    const achieved = hasAssignmentAchievement_(subSheet, id, account);
    return {
      status: 'success',
      data: {
        submissionId: 'local_' + newId_('sub'),
        attemptNo: 0,
        assignment: asg,
        localSession: true,
        serverAchieved: !!achieved,
        startedAt: now,
        timeLimitSec: asg.Time_Limit_Sec
      }
    };
  }

  const existingProgress = findInProgressSubmission_(subSheet, id, account);
  if (existingProgress) {
    const progressCol = SUBMISSION_HEADERS.indexOf('Progress_JSON') + 1;
    if (requestData.progress && progressCol > 0) {
      subSheet.getRange(existingProgress._row, progressCol)
        .setValue(JSON.stringify(requestData.progress || {}));
    }
    return {
      status: 'success',
      data: {
        submissionId: String(existingProgress.Submission_ID),
        attemptNo: existingProgress.Attempt_No,
        assignment: asg,
        resumed: true,
        startedAt: serializeCellForClient_(existingProgress.Submitted_At) || now,
        timeLimitSec: asg.Time_Limit_Sec
      }
    };
  }

  const attempts = countAttempts_(subSheet, id, account);
  const submissionId = newId_('sub');
  const attemptNo = attempts + 1;
  subSheet.appendRow([
    submissionId, id, account, attemptNo, 'in_progress',
    '', '', '', '', '', '', 0,
    JSON.stringify(requestData.progress || {}),
    JSON.stringify({ phase: 'start' }),
    now
  ]);
  return {
    status: 'success',
    data: {
      submissionId: submissionId,
      attemptNo: attemptNo,
      assignment: asg,
      startedAt: now,
      timeLimitSec: asg.Time_Limit_Sec
    }
  };
}

function apiSaveHomeworkProgress_(requestData) {
  const authReq = requireAuthToken_(requestData || {});
  if (!authReq.ok) return { status: 'error', message: authReq.error };
  const submissionId = String(requestData.submissionId || '').trim();
  if (!submissionId) return { status: 'error', message: 'submissionId が必要です' };
  const account = String(authReq.auth.email || '').toLowerCase();
  const ss = openAppSpreadsheet_();
  const sheet = ss.getSheetByName('assignment_submissions');
  const rows = sheetRowsToObjects_(sheet);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].Submission_ID) === submissionId
        && String(rows[i].Account || '').toLowerCase() === account) {
      if (String(rows[i].Status) !== 'in_progress') {
        return { status: 'error', message: 'この提出は既に完了しています' };
      }
      const progressCol = SUBMISSION_HEADERS.indexOf('Progress_JSON') + 1;
      sheet.getRange(rows[i]._row, progressCol).setValue(JSON.stringify(requestData.progress || {}));
      return { status: 'success' };
    }
  }
  return { status: 'error', message: '提出レコードが見つかりません' };
}

function appendQuizAchievementRow_(sheet, asg, account, requestData, clearCount, now) {
  const correct = Math.max(0, parseInt(requestData.correct, 10) || 0);
  const total = Math.max(0, parseInt(requestData.total, 10) || 0);
  const points = Math.max(0, parseInt(requestData.points, 10) || 0);
  const pointsMax = Math.max(0, parseInt(requestData.pointsMax, 10) || 0);
  const durationSec = Math.max(0, parseInt(requestData.durationSec, 10) || 0);
  const timedOut = requestData.timedOut === true || requestData.timedOut === 1 || requestData.timedOut === '1';
  const evalResult = evaluateQuizAttemptPass_(asg, correct, total, points, pointsMax, durationSec, timedOut);
  const score = evalResult.score;
  const newSubId = newId_('sub');
  const attemptNo = countAttempts_(sheet, asg.Assignment_ID, account) + 1;
  const detail = Object.assign({}, requestData.detail || {}, {
    recordType: 'achievement',
    clearCount: clearCount,
    requiredPassCount: asg.Required_Pass_Count,
    resubmit: requestData.resubmit === true || requestData.resubmit === 1 || requestData.resubmit === '1'
  });
  sheet.appendRow([
    newSubId, asg.Assignment_ID, account, attemptNo, 'passed',
    score, correct, total, points, pointsMax, durationSec, timedOut ? 1 : 0,
    JSON.stringify(requestData.progress || {}),
    JSON.stringify(detail),
    now
  ]);
  return {
    submissionId: newSubId,
    serverRecorded: true,
    serverAchieved: true,
    resultStatus: 'passed',
    score: score,
    correct: correct,
    total: total,
    points: points,
    pointsMax: pointsMax,
    timedOut: !!timedOut,
    passed: true,
    clearCount: clearCount,
    requiredPassCount: asg.Required_Pass_Count
  };
}

function apiReportQuizAchievement_(requestData) {
  const authReq = requireAuthToken_(requestData || {});
  if (!authReq.ok) return { status: 'error', message: authReq.error };
  const assignmentId = String(requestData.assignmentId || '').trim();
  if (!assignmentId) return { status: 'error', message: 'assignmentId が必要です' };
  const account = String(authReq.auth.email || '').toLowerCase();
  const user = resolveAuthUserFromRequest_(authReq);
  const ss = openAppSpreadsheet_();
  const asgRows = sheetRowsToObjects_(ss.getSheetByName('assignments'));
  let asg = null;
  for (let i = 0; i < asgRows.length; i++) {
    if (String(asgRows[i].Assignment_ID) === assignmentId) {
      asg = normalizeAssignmentRow_(asgRows[i]);
      break;
    }
  }
  if (!asg || asg.Active !== 1) return { status: 'error', message: '課題が無効または見つかりません' };
  if (asg.Kind !== 'quiz') return { status: 'error', message: '小テスト以外は再度報告できません' };
  if (!isAssignmentTargetMatch_(asg, user)) {
    return { status: 'error', message: 'この課題の配布対象ではありません' };
  }
  const sheet = ss.getSheetByName('assignment_submissions');
  const existing = hasAssignmentAchievement_(sheet, assignmentId, account);
  if (existing) {
    return {
      status: 'success',
      data: {
        serverRecorded: false,
        serverAchieved: true,
        alreadyAchieved: true,
        resultStatus: 'passed',
        message: 'サーバーには既に達成記録があります'
      }
    };
  }
  const clearCount = Math.max(0, parseInt(requestData.clearCount, 10) || 0);
  if (clearCount < asg.Required_Pass_Count) {
    return {
      status: 'error',
      message: 'ノルマ回数（' + asg.Required_Pass_Count + '回クリア）に達していません（現在' + clearCount + '回）'
    };
  }
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  const data = appendQuizAchievementRow_(sheet, asg, account, requestData, clearCount, now);
  return { status: 'success', data: data };
}

function apiSubmitAssignmentAttempt_(requestData) {
  const authReq = requireAuthToken_(requestData || {});
  if (!authReq.ok) return { status: 'error', message: authReq.error };
  const submissionId = String(requestData.submissionId || '').trim();
  const assignmentId = String(requestData.assignmentId || '').trim();
  if (!submissionId) return { status: 'error', message: 'submissionId が必要です' };
  const account = String(authReq.auth.email || '').toLowerCase();
  const ss = openAppSpreadsheet_();
  const sheet = ss.getSheetByName('assignment_submissions');
  const asgRows = sheetRowsToObjects_(ss.getSheetByName('assignments'));
  let asg = null;
  if (assignmentId) {
    for (let i = 0; i < asgRows.length; i++) {
      if (String(asgRows[i].Assignment_ID) === assignmentId) {
        asg = normalizeAssignmentRow_(asgRows[i]);
        break;
      }
    }
  }

  const correct = Math.max(0, parseInt(requestData.correct, 10) || 0);
  const total = Math.max(0, parseInt(requestData.total, 10) || 0);
  const points = Math.max(0, parseInt(requestData.points, 10) || 0);
  const pointsMax = Math.max(0, parseInt(requestData.pointsMax, 10) || 0);
  const durationSec = Math.max(0, parseInt(requestData.durationSec, 10) || 0);
  const timedOut = requestData.timedOut === true || requestData.timedOut === 1 || requestData.timedOut === '1';
  const recordAchievement = requestData.recordAchievement === true
    || requestData.recordAchievement === 1
    || requestData.recordAchievement === '1';
  const clearCount = Math.max(0, parseInt(requestData.clearCount, 10) || 0);
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');

  /** 小テスト: 達成記録前は SS に書かない（ローカルでクリア回数を管理） */
  if (asg && asg.Kind === 'quiz') {
    const evalResult = evaluateQuizAttemptPass_(asg, correct, total, points, pointsMax, durationSec, timedOut);
    const passedThisAttempt = evalResult.pass;
    const score = evalResult.score;
    const existing = hasAssignmentAchievement_(sheet, asg.Assignment_ID, account);
    if (existing) {
      return {
        status: 'success',
        data: {
          clientOnly: true,
          serverAchieved: true,
          alreadyAchieved: true,
          passedThisAttempt: passedThisAttempt,
          resultStatus: passedThisAttempt ? 'clear' : (timedOut ? 'forced' : 'failed'),
          score: score,
          correct: correct,
          total: total,
          points: points,
          pointsMax: pointsMax,
          timedOut: !!timedOut,
          passed: false
        }
      };
    }
    if (!recordAchievement) {
      const resultStatus = passedThisAttempt ? 'clear' : (timedOut ? 'forced' : 'failed');
      return {
        status: 'success',
        data: {
          clientOnly: true,
          serverAchieved: false,
          passedThisAttempt: passedThisAttempt,
          resultStatus: resultStatus,
          score: score,
          correct: correct,
          total: total,
          points: points,
          pointsMax: pointsMax,
          timedOut: !!timedOut,
          passed: false,
          requiredPassCount: asg.Required_Pass_Count,
          clearCount: clearCount
        }
      };
    }
    if (!passedThisAttempt) {
      return { status: 'error', message: '達成記録には今回の結果が合格条件を満たす必要があります' };
    }
    if (clearCount < asg.Required_Pass_Count) {
      return {
        status: 'error',
        message: 'ノルマ回数（' + asg.Required_Pass_Count + '回クリア）に達していません（現在' + clearCount + '回）'
      };
    }
    const nowAch = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    const achData = appendQuizAchievementRow_(sheet, asg, account, requestData, clearCount, nowAch);
    return { status: 'success', data: achData };
  }

  const rows = sheetRowsToObjects_(sheet);
  let row = null;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].Submission_ID) === submissionId
        && String(rows[i].Account || '').toLowerCase() === account) {
      row = rows[i];
      break;
    }
  }
  if (!row) return { status: 'error', message: '提出レコードが見つかりません' };
  if (String(row.Status) !== 'in_progress') {
    return { status: 'error', message: 'この提出は既に完了しています' };
  }

  if (!asg) {
    for (let j = 0; j < asgRows.length; j++) {
      if (String(asgRows[j].Assignment_ID) === String(row.Assignment_ID)) {
        asg = normalizeAssignmentRow_(asgRows[j]);
        break;
      }
    }
  }

  const score = total > 0 ? Math.round((correct / total) * 100) : (pointsMax > 0 ? Math.round((points / pointsMax) * 100) : 0);

  let status = 'submitted';
  if (asg) {
    if (asg.Kind === 'homework') {
      const done = requestData.rangeComplete === true || requestData.rangeComplete === 1 || requestData.rangeComplete === '1';
      status = done ? 'passed' : 'submitted';
    }
  }
  if (timedOut && status === 'submitted') status = 'forced';

  const values = [
    row.Submission_ID, row.Assignment_ID, row.Account, row.Attempt_No, status,
    score, correct, total, points, pointsMax, durationSec, timedOut ? 1 : 0,
    JSON.stringify(requestData.progress || {}),
    JSON.stringify(requestData.detail || {}),
    now
  ];
  sheet.getRange(row._row, 1, 1, values.length).setValues([values]);
  return {
    status: 'success',
    data: {
      submissionId: submissionId,
      resultStatus: status,
      score: score,
      correct: correct,
      total: total,
      points: points,
      pointsMax: pointsMax,
      timedOut: !!timedOut,
      passed: status === 'passed'
    }
  };
}

// =========================================================
// 課題点検票（whitelist 名簿 → 提出の未転記分を時間トリガーで追記）
// =========================================================

function compactRangeLabel_(items) {
  const seen = {};
  const arr = [];
  let list = items;
  if (list == null || list === '') list = [];
  else if (!Array.isArray(list)) list = [list];
  list.forEach(function (x) {
    const s = String(x || '').trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    arr.push(s);
  });
  if (!arr.length) return '';
  arr.sort(naturalLabelSort_);
  if (arr.length === 1) return arr[0];
  return arr[0] + '～' + arr[arr.length - 1];
}

function checkModeLabel_(mode) {
  const m = String(mode || '').toLowerCase();
  if (m === 'vocab') return '単語';
  if (m === 'grammar') return '文法';
  if (m === 'reading') return '音読';
  if (m === 'conversation' || m === 'ai') return '会話';
  if (!m) return '課題';
  return m.length <= 2 ? m : m.slice(0, 2);
}

function vocabSheetLabels_(sec) {
  if (!sec) return [];
  if (Array.isArray(sec.sheetNames) && sec.sheetNames.length) return sec.sheetNames;
  if (Array.isArray(sec.sheets) && sec.sheets.length) return sec.sheets;
  if (sec.sheetName) return [sec.sheetName];
  return [];
}

/** 行5見出し: 単語：コーパス4500・Stage1～14・Stage1 */
function buildCheckColumnTitle_(asg) {
  const sections = (asg && asg.Sections) || parseSectionsJson_(asg && asg.Sections_JSON);
  if (!sections.length) return String((asg && asg.Title) || (asg && asg.Assignment_ID) || '課題');
  const parts = sections.map(function (sec) {
    const mode = String(sec.mode || '').toLowerCase();
    const label = checkModeLabel_(mode);
    let book = '';
    let sheetRange = '';
    let dai = '';
    if (mode === 'vocab') {
      book = String(sec.bookName || '').trim();
      sheetRange = compactRangeLabel_(vocabSheetLabels_(sec));
      dai = compactRangeLabel_((sec.filters && sec.filters.dai) || []);
    } else if (mode === 'grammar') {
      book = String(sec.subject || '').trim();
      sheetRange = compactRangeLabel_(sec.units || []);
      dai = compactRangeLabel_((sec.filters && sec.filters.dai) || []);
    } else {
      book = String(sec.bookName || sec.subject || (asg && asg.Title) || '').trim();
      sheetRange = compactRangeLabel_(vocabSheetLabels_(sec).concat(sec.units || []));
      dai = compactRangeLabel_((sec.filters && sec.filters.dai) || []);
    }
    const tail = [book, sheetRange, dai].filter(Boolean).join('・');
    return tail ? (label + '：' + tail) : label;
  });
  return parts.filter(Boolean).join('／') || String((asg && asg.Title) || '');
}

function formatCheckDateOnly_(value) {
  const ms = parseLooseDate_(value);
  if (ms == null) return '';
  return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone() || 'Asia/Tokyo', 'M/d');
}

/** 提出日行: 期限があればそれ、なければ期間終了日（日付のみ） */
function checkDueDateLabel_(asg) {
  return formatCheckDateOnly_(asg && asg.Deadline) || formatCheckDateOnly_(asg && asg.Window_End) || '';
}

function isCheckExportableSubmission_(asg, row) {
  const status = String((row && row.Status) || '');
  if (!asg) return false;
  if (asg.Kind === 'quiz') return status === 'passed';
  return status === 'passed' || status === 'submitted' || status === 'forced';
}

function isCheckExportedFlag_(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function getCheckYear_() {
  const y = String(PropertiesService.getScriptProperties().getProperty(PROP.CHECK_YEAR) || '').trim();
  if (y) return y;
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy');
}

function checkBookFileName_(kind, year) {
  if (kind === 'quiz_pf') return '【' + year + '】デジドリ小テスト点検票(合否)';
  if (kind === 'quiz_score') return '【' + year + '】デジドリ小テスト点検票(点数)';
  return '【' + year + '】デジドリ課題点検票';
}

function checkPropKeyForKind_(kind) {
  if (kind === 'quiz_pf') return PROP.CHECK_QUIZ_PF_SS_ID;
  if (kind === 'quiz_score') return PROP.CHECK_QUIZ_SCORE_SS_ID;
  return PROP.CHECK_ASSIGNMENT_SS_ID;
}

/**
 * 1ブックにつき入力シートは1枚。
 * 既存の＠入力が1枚だけならそれを使う（課題点検アプリの「1年＠入力」など）。
 * 0枚または複数枚（学年IDで分裂した残骸）なら「名簿＠入力」にまとめる。
 */
function resolveCheckInputSheetName_(ss) {
  if (!ss) return CHECK_DEFAULT_INPUT_SHEET;
  const inputs = [];
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].getName();
    if (/＠入力$/.test(name)) inputs.push(name);
  }
  if (inputs.length === 1) return inputs[0];
  return CHECK_DEFAULT_INPUT_SHEET;
}

function normalizeGradeToken_(s) {
  return String(s || '').trim().toLowerCase().replace(/年$/, '');
}

function normalizeClassToken_(s) {
  return String(s || '').trim().toLowerCase().replace(/組$/, '');
}

function parseCheckCsvTokens_(raw) {
  return String(raw || '').split(/[,、]/).map(function (s) {
    return String(s || '').trim();
  }).filter(Boolean);
}

/** 番号フィルタ: 1,2,5 または 1-20 を許可。空＝制限なし */
function parseCheckNumberFilter_(raw) {
  const tokens = parseCheckCsvTokens_(raw);
  if (!tokens.length) return null;
  const allowed = {};
  tokens.forEach(function (tok) {
    const m = String(tok).match(/^(\d+)\s*[-~～]\s*(\d+)$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let n = lo; n <= hi; n++) allowed[n] = true;
      return;
    }
    const n = parseInt(tok, 10);
    if (!isNaN(n)) allowed[n] = true;
  });
  return allowed;
}

function readCheckScope_() {
  const props = PropertiesService.getScriptProperties();
  return {
    grade: String(props.getProperty(PROP.CHECK_SCOPE_GRADE) || '').trim(),
    className: String(props.getProperty(PROP.CHECK_SCOPE_CLASS) || '').trim(),
    number: String(props.getProperty(PROP.CHECK_SCOPE_NUMBER) || '').trim(),
    attribute1: String(props.getProperty(PROP.CHECK_SCOPE_ATTR1) || '').trim(),
    attribute2: String(props.getProperty(PROP.CHECK_SCOPE_ATTR2) || '').trim(),
    attribute3: String(props.getProperty(PROP.CHECK_SCOPE_ATTR3) || '').trim(),
    attribute4: String(props.getProperty(PROP.CHECK_SCOPE_ATTR4) || '').trim(),
    attribute5: String(props.getProperty(PROP.CHECK_SCOPE_ATTR5) || '').trim()
  };
}

function matchCheckScopeField_(filterRaw, value, normalizer) {
  const tokens = parseCheckCsvTokens_(filterRaw);
  if (!tokens.length) return true;
  const got = normalizer(value);
  if (!got) return false;
  for (let i = 0; i < tokens.length; i++) {
    if (normalizer(tokens[i]) === got) return true;
  }
  return false;
}

function studentMatchesCheckScope_(st, scope) {
  scope = scope || readCheckScope_();
  if (!matchCheckScopeField_(scope.grade, st.grade, normalizeGradeToken_)) return false;
  if (!matchCheckScopeField_(scope.className, st.className, normalizeClassToken_)) return false;
  const allowedNums = parseCheckNumberFilter_(scope.number);
  if (allowedNums) {
    const n = parseInt(st.number, 10);
    if (isNaN(n) || !allowedNums[n]) return false;
  }
  if (!isTargetFieldMatch_(scope.attribute1, st.attribute1)) return false;
  if (!isTargetFieldMatch_(scope.attribute2, st.attribute2)) return false;
  if (!isTargetFieldMatch_(scope.attribute3, st.attribute3)) return false;
  if (!isTargetFieldMatch_(scope.attribute4, st.attribute4)) return false;
  if (!isTargetFieldMatch_(scope.attribute5, st.attribute5)) return false;
  return true;
}

function listWhitelistStudentsForCheck_() {
  const ss = openAppSpreadsheet_();
  const rows = sheetRowsToObjects_(ss.getSheetByName('whitelist'));
  const scope = readCheckScope_();
  const out = [];
  rows.forEach(function (r) {
    const account = String(r.account || '').trim().toLowerCase();
    const cls = String(r.class || '').trim();
    if (!account) return;
    if (cls.toLowerCase() === 'admin') return;
    const st = {
      account: account,
      name: String(r.name || '').trim(),
      grade: String(r.grade || '').trim(),
      className: cls,
      number: String(r.number != null && r.number !== '' ? r.number : (r['番号'] || '')).trim(),
      attribute1: String(r.attribute1 || '').trim(),
      attribute2: String(r.attribute2 || '').trim(),
      attribute3: String(r.attribute3 || '').trim(),
      attribute4: String(r.attribute4 || '').trim(),
      attribute5: String(r.attribute5 || '').trim()
    };
    if (!studentMatchesCheckScope_(st, scope)) return;
    out.push(st);
  });
  out.sort(function (a, b) {
    const g = naturalLabelSort_(a.grade, b.grade);
    if (g) return g;
    const c = naturalLabelSort_(a.className, b.className);
    if (c) return c;
    const na = parseInt(a.number, 10);
    const nb = parseInt(b.number, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return naturalLabelSort_(a.name || a.account, b.name || b.account);
  });
  return out;
}

function getOrCreateCheckFolder_() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(PROP.CHECK_FOLDER_ID);
  if (existingId) {
    try {
      return DriveApp.getFolderById(existingId);
    } catch (e) { /* fall through */ }
  }
  const parentId = props.getProperty(PROP.PARENT_FOLDER_ID);
  const parent = parentId ? DriveApp.getFolderById(parentId) : getScriptParentFolder_();
  let folder = findChildFolderByName_(parent, CHECK_FOLDER_NAME);
  if (!folder) folder = parent.createFolder(CHECK_FOLDER_NAME);
  props.setProperty(PROP.CHECK_FOLDER_ID, folder.getId());
  return folder;
}

function openOrCreateCheckBook_(kind) {
  const props = PropertiesService.getScriptProperties();
  const propKey = checkPropKeyForKind_(kind);
  const configured = String(props.getProperty(propKey) || '').trim();
  if (configured) {
    return SpreadsheetApp.openById(configured);
  }
  const year = getCheckYear_();
  const fileName = checkBookFileName_(kind, year);
  const folder = getOrCreateCheckFolder_();
  const existing = findChildSpreadsheetByName_(folder, fileName);
  if (existing) {
    props.setProperty(propKey, existing.getId());
    return SpreadsheetApp.open(existing);
  }
  const ss = createSpreadsheetInFolder_(fileName, folder);
  props.setProperty(propKey, ss.getId());
  const leftover = ss.getSheetByName('シート1') || ss.getSheets()[0];
  if (leftover) leftover.setName('準備中');
  return ss;
}

function applyCheckSheetLayout_(sheet, sheetName, bookType) {
  try {
    sheet.setName(sheetName);
  } catch (e) { /* 既存名を維持 */ }

  let a1Val = '提出物';
  if (bookType === 'quiz_pf') a1Val = '小テスト(合否)';
  if (bookType === 'quiz_score') a1Val = '小テスト(点数)';

  const headers = [
    ['組', '', '', '', '', '', '通し番号→'],
    ['', '', '', '', '', '', '提出率→'],
    ['', '', '', '', '', '', '返却可否→'],
    ['', '', '', '', '', '', '提出日→'],
    ['組', '番号', 'ID', '氏名', '性別', '提出率', '提出数']
  ];
  sheet.getRange(1, 1, CHECK_HEADER_ROWS, CHECK_ROSTER_COLS).setValues(headers);
  sheet.getRange('A1').setValue(a1Val);
  if (bookType === 'quiz_pf' || bookType === 'quiz_score') {
    sheet.getRange('B1').setValue(80);
    sheet.getRange('C1').setValue('点合格');
  }

  const range = sheet.getRange('H6:AZ205');
  const rules = [];
  if (bookType === 'assignment') {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('提').setBackground('#b7e1cd').setFontColor('#0f5132').setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('未').setBackground('#f4c7c3').setFontColor('#842029').setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('再').setBackground('#fce8b2').setFontColor('#664d03').setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('休').setBackground('#d9d2e9').setFontColor('#351c75').setRanges([range]).build()
    );
  } else if (bookType === 'quiz_pf') {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('○').setBackground('#d1e7dd').setFontColor('#0f5132').setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('×').setBackground('#f8d7da').setFontColor('#842029').setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('休').setBackground('#d9d2e9').setFontColor('#351c75').setRanges([range]).build()
    );
  } else {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('休').setBackground('#d9d2e9').setFontColor('#351c75').setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER(H6), H6>=$B$1)').setBackground('#d1e7dd').setFontColor('#0f5132').setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER(H6), H6<$B$1)').setBackground('#f8d7da').setFontColor('#842029').setRanges([range]).build()
    );
  }
  sheet.setConditionalFormatRules(rules);
  sheet.setFrozenRows(CHECK_HEADER_ROWS);
  sheet.setFrozenColumns(CHECK_ROSTER_COLS);
}

function ensureCheckInputSheet_(ss, sheetName, bookType) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    const placeholders = ['準備中', 'シート1', 'Sheet1'];
    let reusable = null;
    for (let i = 0; i < placeholders.length; i++) {
      const cand = ss.getSheetByName(placeholders[i]);
      if (cand && ss.getSheets().length === 1) {
        reusable = cand;
        break;
      }
    }
    if (!reusable && ss.getSheets().length === 1) {
      const only = ss.getSheets()[0];
      if (only.getLastRow() === 0) reusable = only;
    }
    sheet = reusable || ss.insertSheet(sheetName);
    applyCheckSheetLayout_(sheet, sheetName, bookType);
    return sheet;
  }
  const a1 = String(sheet.getRange(1, 1).getValue() || '');
  const r5c1 = String(sheet.getRange(CHECK_HEADER_ROWS, 1).getValue() || '');
  if (!a1 && !r5c1) {
    applyCheckSheetLayout_(sheet, sheetName, bookType);
  } else if (r5c1 !== '組' && sheet.getLastRow() <= 1) {
    applyCheckSheetLayout_(sheet, sheetName, bookType);
  }
  return sheet;
}

function checkRosterFormulaRate_(rowIndex) {
  return '=IF(COUNTA($H$5:$AZ$5)=0, 0, G' + rowIndex + '/COUNTA($H$5:$AZ$5))';
}

function checkRosterFormulaCount_(rowIndex) {
  return '=COUNTIF(H' + rowIndex + ':AZ' + rowIndex + ',"提")+COUNTIF(H' + rowIndex + ':AZ' + rowIndex + ',1)+COUNTIF(H' + rowIndex + ':AZ' + rowIndex + ',"○")';
}

function ensureCheckRosterRows_(sheet, students) {
  const lastRow = Math.max(CHECK_HEADER_ROWS, sheet.getLastRow());
  const existingCount = Math.max(0, lastRow - CHECK_HEADER_ROWS);
  const idMap = {};
  let rosterAD = [];
  if (existingCount > 0) {
    rosterAD = sheet.getRange(CHECK_HEADER_ROWS + 1, 1, existingCount, 4).getValues();
    for (let i = 0; i < rosterAD.length; i++) {
      const id = String(rosterAD[i][2] || '').trim().toLowerCase();
      if (id) idMap[id] = CHECK_HEADER_ROWS + 1 + i;
    }
  }
  const classCounts = {};
  const newRows = [];
  students.forEach(function (st) {
    const cls = st.className || '';
    classCounts[cls] = (classCounts[cls] || 0) + 1;
    const existingRow = idMap[st.account];
    if (existingRow) {
      const idx = existingRow - CHECK_HEADER_ROWS - 1;
      rosterAD[idx][0] = cls;
      if (st.number !== '') rosterAD[idx][1] = st.number;
      rosterAD[idx][2] = st.account;
      rosterAD[idx][3] = st.name || '';
      return;
    }
    const startRow = CHECK_HEADER_ROWS + 1 + existingCount + newRows.length;
    const numVal = st.number !== '' ? st.number : classCounts[cls];
    newRows.push([
      cls,
      numVal,
      st.account,
      st.name || '',
      '',
      checkRosterFormulaRate_(startRow),
      checkRosterFormulaCount_(startRow)
    ]);
    idMap[st.account] = startRow;
  });
  if (existingCount > 0) {
    sheet.getRange(CHECK_HEADER_ROWS + 1, 1, existingCount, 4).setValues(rosterAD);
  }
  if (newRows.length) {
    const start = CHECK_HEADER_ROWS + 1 + existingCount;
    sheet.getRange(start, 1, newRows.length, CHECK_ROSTER_COLS).setValues(newRows);
    sheet.getRange(start, 6, newRows.length, 1).setNumberFormat('0.0%');
  }
  return idMap;
}

function findCheckTaskCol_(sheet, assignmentId) {
  const lastCol = sheet.getLastColumn();
  if (lastCol <= CHECK_ROSTER_COLS) return 0;
  const ids = sheet.getRange(1, CHECK_ROSTER_COLS + 1, 1, lastCol - CHECK_ROSTER_COLS).getValues()[0];
  const want = String(assignmentId || '');
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i] || '') === want) return CHECK_ROSTER_COLS + 1 + i;
  }
  return 0;
}

function nextCheckTaskCol_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol <= CHECK_ROSTER_COLS) return CHECK_ROSTER_COLS + 1;
  const ids = sheet.getRange(1, CHECK_ROSTER_COLS + 1, 1, lastCol - CHECK_ROSTER_COLS).getValues()[0];
  for (let i = 0; i < ids.length; i++) {
    if (!ids[i]) return CHECK_ROSTER_COLS + 1 + i;
  }
  return lastCol + 1;
}

function ensureCheckTaskColumn_(sheet, asg) {
  let col = findCheckTaskCol_(sheet, asg.Assignment_ID);
  if (!col) {
    col = nextCheckTaskCol_(sheet);
    if (col > sheet.getMaxColumns()) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
    }
    sheet.getRange(1, col).setValue(asg.Assignment_ID);
  }
  sheet.getRange(4, col).setValue(checkDueDateLabel_(asg));
  const titleCell = sheet.getRange(5, col);
  titleCell.setValue(buildCheckColumnTitle_(asg));
  titleCell.setWrap(true);
  sheet.setColumnWidth(col, 92);
  return col;
}

function checkCellIsProtected_(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return false;
  return s === '休' || s === '再' || s === '未' || s === '×';
}

function writeCheckCellIfEmpty_(sheet, row, col, value) {
  if (!row || !col || value === '' || value == null) return false;
  const cell = sheet.getRange(row, col);
  const cur = cell.getValue();
  if (checkCellIsProtected_(cur)) return true;
  if (String(cur == null ? '' : cur).trim() !== '') return true;
  cell.setValue(value);
  return true;
}

function checkValueForKind_(kind, row) {
  if (kind === 'quiz_score') {
    const n = parseFloat(row.Score);
    return isNaN(n) ? '' : n;
  }
  if (kind === 'quiz_pf') return '○';
  return '提';
}

function kindsForAssignment_(asg) {
  if (asg && asg.Kind === 'quiz') return ['quiz_pf', 'quiz_score'];
  return ['assignment'];
}

function configuredCheckBookKinds_() {
  const props = PropertiesService.getScriptProperties();
  const kinds = [];
  if (String(props.getProperty(PROP.CHECK_ASSIGNMENT_SS_ID) || '').trim()) kinds.push('assignment');
  if (String(props.getProperty(PROP.CHECK_QUIZ_PF_SS_ID) || '').trim()) kinds.push('quiz_pf');
  if (String(props.getProperty(PROP.CHECK_QUIZ_SCORE_SS_ID) || '').trim()) kinds.push('quiz_score');
  if (!kinds.length) kinds.push('assignment');
  return kinds;
}

function summarizeCheckPrepare_(runtime) {
  return {
    studentCount: runtime.students.length,
    assignmentCount: runtime.assignments.length,
    kinds: runtime.kinds.slice(),
    inputSheets: runtime.inputSheets,
    gradeSheets: runtime.kinds.map(function (k) { return runtime.inputSheets[k]; }),
    urls: runtime.urls
  };
}

/** 点検票ブックの見出し・名簿をすぐ整備。ID指定があるブックだけ触る。 */
function prepareCheckBooksRuntime_(opts) {
  opts = opts || {};
  const includeTaskColumns = !!opts.includeTaskColumns;
  const ssApp = openAppSpreadsheet_();
  const students = listWhitelistStudentsForCheck_();
  const assignments = includeTaskColumns
    ? sheetRowsToObjects_(ssApp.getSheetByName('assignments')).map(normalizeAssignmentRow_)
    : [];
  const kinds = configuredCheckBookKinds_();
  const books = {};
  const inputSheets = {};
  const urls = {};
  const sheetCache = {};

  function sheetFor(kind) {
    if (sheetCache[kind]) return sheetCache[kind];
    books[kind] = openOrCreateCheckBook_(kind);
    const sheetName = resolveCheckInputSheetName_(books[kind]);
    const sh = ensureCheckInputSheet_(books[kind], sheetName, kind);
    ensureCheckRosterRows_(sh, students);
    sheetCache[kind] = sh;
    inputSheets[kind] = sh.getName();
    urls[kind] = books[kind].getUrl();
    return sh;
  }

  kinds.forEach(function (kind) {
    sheetFor(kind);
  });

  if (includeTaskColumns) {
    assignments.forEach(function (asg) {
      if (!asg.Assignment_ID) return;
      kindsForAssignment_(asg).forEach(function (kind) {
        if (kinds.indexOf(kind) < 0) return;
        ensureCheckTaskColumn_(sheetFor(kind), asg);
      });
    });
  }

  SpreadsheetApp.flush();
  return {
    students: students,
    assignments: assignments,
    kinds: kinds,
    books: books,
    sheetFor: sheetFor,
    inputSheets: inputSheets,
    urls: urls
  };
}

function prepareCheckBooksStructure_(opts) {
  return summarizeCheckPrepare_(prepareCheckBooksRuntime_(opts));
}

function ensureCheckExportTrigger_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('check_export_trigger_ok')) return { installed: true, cached: true };
  const triggers = ScriptApp.getProjectTriggers();
  let found = false;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === CHECK_EXPORT_TRIGGER_FN) {
      found = true;
      break;
    }
  }
  if (!found) {
    ScriptApp.newTrigger(CHECK_EXPORT_TRIGGER_FN).timeBased().everyMinutes(10).create();
  }
  cache.put('check_export_trigger_ok', '1', 21600);
  return { installed: true, created: !found };
}

/** 時間トリガー入口：正本の未転記提出だけ点検票へ追記 */
function syncCheckSheetsPending() {
  return exportPendingCheckSubmissions_({ source: 'trigger' });
}

function exportPendingCheckSubmissions_(opts) {
  opts = opts || {};
  const cache = CacheService.getScriptCache();
  if (cache.get('check_export_running')) {
    return { status: 'error', message: '点検票の転記処理が実行中です。しばらくしてから再試行してください。' };
  }
  cache.put('check_export_running', '1', 180);
  try {
    try { /* ダッシュボードからはトリガー一覧を触らない（権限待ちで固まる） */ } catch (eTrig) { /* ignore */ }
    const runtime = prepareCheckBooksRuntime_({ includeTaskColumns: true });
    const students = runtime.students;
    const assignments = runtime.assignments;
    const asgById = {};
    assignments.forEach(function (a) { asgById[a.Assignment_ID] = a; });
    const sheetFor = runtime.sheetFor;

    const ssApp = openAppSpreadsheet_();
    const subSheet = ssApp.getSheetByName('assignment_submissions');
    migrateSheetHeaders_(subSheet, SUBMISSION_HEADERS);
    const exportedCol = SUBMISSION_HEADERS.indexOf('Check_Exported') + 1;
    const subs = sheetRowsToObjects_(subSheet);
    const studentByAccount = {};
    students.forEach(function (st) { studentByAccount[st.account] = st; });

    let exported = 0;
    let skipped = 0;
    let pendingLeft = 0;
    for (let i = 0; i < subs.length; i++) {
      const row = subs[i];
      if (isCheckExportedFlag_(row.Check_Exported)) {
        skipped++;
        continue;
      }
      const asg = asgById[String(row.Assignment_ID || '')];
      if (!isCheckExportableSubmission_(asg, row)) continue;
      if (exported >= CHECK_EXPORT_BATCH) {
        pendingLeft++;
        continue;
      }
      const account = String(row.Account || '').toLowerCase();
      const st = studentByAccount[account];
      if (!st) continue;
      const kinds = kindsForAssignment_(asg);
      let okAll = true;
      let wroteAny = false;
      kinds.forEach(function (kind) {
        if (runtime.kinds.indexOf(kind) < 0) return;
        wroteAny = true;
        const sh = sheetFor(kind);
        const idMap = ensureCheckRosterRows_(sh, students);
        const studentRow = idMap[account];
        const col = ensureCheckTaskColumn_(sh, asg);
        const val = checkValueForKind_(kind, row);
        if (!writeCheckCellIfEmpty_(sh, studentRow, col, val)) okAll = false;
      });
      if (!wroteAny) continue;
      if (okAll && exportedCol > 0) {
        subSheet.getRange(row._row, exportedCol).setValue(1);
        exported++;
      } else {
        pendingLeft++;
      }
    }

    const summary = summarizeCheckPrepare_(runtime);
    return {
      status: 'success',
      data: {
        exported: exported,
        alreadyExported: skipped,
        pendingLeft: pendingLeft,
        gradeSheets: summary.gradeSheets,
        studentCount: summary.studentCount,
        urls: summary.urls
      }
    };
  } catch (e) {
    return { status: 'error', message: String(e.message || e) };
  } finally {
    cache.remove('check_export_running');
  }
}

function readCheckSheetSettings_() {
  const props = PropertiesService.getScriptProperties();
  function bookInfo_(kind) {
    const id = String(props.getProperty(checkPropKeyForKind_(kind)) || '').trim();
    if (!id) return { id: '', url: '', title: '' };
    return {
      id: id,
      url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
      title: '開く'
    };
  }
  return {
    year: getCheckYear_(),
    assignment: bookInfo_('assignment'),
    quiz_pf: bookInfo_('quiz_pf'),
    quiz_score: bookInfo_('quiz_score'),
    scopeGrade: String(props.getProperty(PROP.CHECK_SCOPE_GRADE) || '').trim(),
    scopeClass: String(props.getProperty(PROP.CHECK_SCOPE_CLASS) || '').trim(),
    scopeNumber: String(props.getProperty(PROP.CHECK_SCOPE_NUMBER) || '').trim(),
    scopeAttr1: String(props.getProperty(PROP.CHECK_SCOPE_ATTR1) || '').trim(),
    scopeAttr2: String(props.getProperty(PROP.CHECK_SCOPE_ATTR2) || '').trim(),
    scopeAttr3: String(props.getProperty(PROP.CHECK_SCOPE_ATTR3) || '').trim(),
    scopeAttr4: String(props.getProperty(PROP.CHECK_SCOPE_ATTR4) || '').trim(),
    scopeAttr5: String(props.getProperty(PROP.CHECK_SCOPE_ATTR5) || '').trim(),
    triggerInstalled: null
  };
}

function apiAdminGetCheckSheetSettings() {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed || !isAssignmentAdminEmail_(access.email)) {
      return { status: 'error', message: '管理者権限が必要です（whitelist の class=admin）' };
    }
    return { status: 'success', data: readCheckSheetSettings_() };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiAdminSaveCheckSheetSettings(settings) {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed || !isAssignmentAdminEmail_(access.email)) {
      return { status: 'error', message: '管理者権限が必要です（whitelist の class=admin）' };
    }
    settings = settings || {};
    const props = PropertiesService.getScriptProperties();
    const year = String(settings.year || '').trim();
    if (year) props.setProperty(PROP.CHECK_YEAR, year);
    function saveId_(key, raw) {
      const id = String(raw || '').trim();
      if (id) props.setProperty(key, id);
      else props.deleteProperty(key);
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'assignmentId')) {
      saveId_(PROP.CHECK_ASSIGNMENT_SS_ID, settings.assignmentId);
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'quizPfId')) {
      saveId_(PROP.CHECK_QUIZ_PF_SS_ID, settings.quizPfId);
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'quizScoreId')) {
      saveId_(PROP.CHECK_QUIZ_SCORE_SS_ID, settings.quizScoreId);
    }
    function saveScope_(key, raw) {
      const v = String(raw == null ? '' : raw).trim();
      if (v) props.setProperty(key, v);
      else props.deleteProperty(key);
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'scopeGrade')) {
      saveScope_(PROP.CHECK_SCOPE_GRADE, settings.scopeGrade);
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'scopeClass')) {
      saveScope_(PROP.CHECK_SCOPE_CLASS, settings.scopeClass);
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'scopeNumber')) {
      saveScope_(PROP.CHECK_SCOPE_NUMBER, settings.scopeNumber);
    }
    try { props.deleteProperty('CHECK_GRADE_ID_DIGIT'); } catch (eDel) { /* 廃止済み設定 */ }
    if (Object.prototype.hasOwnProperty.call(settings, 'scopeAttr1')) {
      saveScope_(PROP.CHECK_SCOPE_ATTR1, settings.scopeAttr1);
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'scopeAttr2')) {
      saveScope_(PROP.CHECK_SCOPE_ATTR2, settings.scopeAttr2);
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'scopeAttr3')) {
      saveScope_(PROP.CHECK_SCOPE_ATTR3, settings.scopeAttr3);
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'scopeAttr4')) {
      saveScope_(PROP.CHECK_SCOPE_ATTR4, settings.scopeAttr4);
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'scopeAttr5')) {
      saveScope_(PROP.CHECK_SCOPE_ATTR5, settings.scopeAttr5);
    }
    let prepared = null;
    try {
      prepared = prepareCheckBooksStructure_({ includeTaskColumns: false });
    } catch (ePrep) {
      return {
        status: 'error',
        message: '設定は保存しましたが、点検票の見出し・名簿整備に失敗しました: ' + (ePrep.message || ePrep)
      };
    }
    const data = readCheckSheetSettings_();
    data.studentCount = prepared.studentCount;
    data.gradeSheets = prepared.gradeSheets;
    data.inputSheets = prepared.inputSheets;
    data.assignmentCount = prepared.assignmentCount;
    if (prepared.urls) {
      ['assignment', 'quiz_pf', 'quiz_score'].forEach(function (k) {
        if (prepared.urls[k] && data[k]) data[k].url = prepared.urls[k];
      });
    }
    const labels = { assignment: '提出物', quiz_pf: '小テスト合否', quiz_score: '小テスト点数' };
    const sheetBits = (prepared.kinds || []).map(function (k) {
      return (labels[k] || k) + '「' + (prepared.inputSheets[k] || CHECK_DEFAULT_INPUT_SHEET) + '」';
    });
    let message = '設定を保存し、' + (sheetBits.join('・') || '点検票') +
      ' に対象 ' + prepared.studentCount + ' 人の名簿を整備しました。';
    if (!prepared.studentCount) {
      message += ' 0人です。学年・組・番号・attribute が whitelist と一致しているか確認してください。';
    } else {
      message += ' 課題列と提出結果は「今すぐ転記」または時間トリガーで追記します。';
    }
    return {
      status: 'success',
      data: data,
      message: message
    };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function apiAdminSyncCheckSheetsNow() {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed || !isAssignmentAdminEmail_(access.email)) {
      return { status: 'error', message: '管理者権限が必要です（whitelist の class=admin）' };
    }
    return exportPendingCheckSubmissions_({ source: 'manual' });
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

/** dashboard.html 用（google.script.run） */
function apiAdminListAssignments() {
  return apiAdminListAssignments_({});
}
function apiAdminUpsertAssignment(assignment) {
  try {
    return apiAdminUpsertAssignment_({ assignment: assignment });
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}
function apiAdminDeleteAssignments(assignmentIds) {
  try {
    return apiAdminDeleteAssignments_({ assignmentIds: assignmentIds || [] });
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}
function apiAdminListSubmissions(assignmentId, limit) {
  try {
    return apiAdminListSubmissions_({ assignmentId: assignmentId || '', limit: limit || 200 });
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

/** dashboard: 文法学習セット一覧 */
function apiAdminGetGrammarCatalog() {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed || !isAssignmentAdminEmail_(access.email)) {
      return { status: 'error', message: '管理者権限が必要です（whitelist の class=admin）' };
    }
    ensureEnvironment();
    return { status: 'success', data: fetchCatalogFromDrive() };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

/** dashboard: 単語プリセットカタログ */
function apiAdminGetVocabCatalog() {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed || !isAssignmentAdminEmail_(access.email)) {
      return { status: 'error', message: '管理者権限が必要です（whitelist の class=admin）' };
    }
    ensureEnvironment();
    return { status: 'success', data: fetchVocabCatalogFromDrive_() };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

/** dashboard: 選択単元の大/小/文法領域一覧（絞り込みUI用） */
function apiAdminGetGrammarDivisions(subject, unitsCsv) {
  try {
    const access = checkDashboardAccess_();
    if (!access.allowed || !isAssignmentAdminEmail_(access.email)) {
      return { status: 'error', message: '管理者権限が必要です（whitelist の class=admin）' };
    }
    ensureEnvironment();
    const rows = fetchQuestionsFromSheet({
      subject: String(subject || ''),
      unit: String(unitsCsv || '')
    });
    const dai = {};
    const sho = {};
    const area = {};
    rows.forEach(function (r) {
      if (r.daiUnit) dai[r.daiUnit] = true;
      if (r.shoUnit) sho[r.shoUnit] = true;
      if (r.grammarArea) area[r.grammarArea] = true;
    });
    function keys(obj) {
      return Object.keys(obj).sort(function (a, b) { return a.localeCompare(b, 'ja'); });
    }
    return { status: 'success', data: { dai: keys(dai), sho: keys(sho), area: keys(area), rowCount: rows.length } };
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