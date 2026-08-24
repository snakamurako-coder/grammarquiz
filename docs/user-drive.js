/**
 * ユーザー Drive / Sheets 操作（GCP OAuth + REST API）
 * UserBridge から dispatch される唯一の実装。設計契約: docs/USER_DATA_SANCTUARY.md
 */
const UserDriveModule = (function () {
  const META_KEY = 'dd_user_drive_meta';
  const TOKEN_KEY = 'dd_google_access_token';
  const TOKEN_EXP_KEY = 'dd_google_token_expiry';
  const FOLDER_NAME = 'DigitalDrill_MyData';
  const VOCAB_BOOK_NAME = 'マイ単語帳';
  const LOG_BOOK_NAME = 'DigitalDrill学習記録';
  const ITEM_STATE_SHEET = '学習状態';
  const SESSION_LOG_SHEET = '学習記録';
  const UNREGISTERED = '(未登録)';

  const VOCAB_HEADERS = [
    '通し番号', '大区分', '中区分', '小区分', '英単語・熟語の表現',
    '意味＠名詞', '意味＠動詞', '意味＠形容詞', '意味＠副詞', '意味＠前置詞',
    '意味＠接続詞', '意味＠その他品詞', '意味＠熟語・慣用表現',
    'メモ', '類義語・同義語', '対義語', '派生語・関連語',
    '英文による定義', 'チャンク', 'チャンク訳', '例文', '例文訳'
  ];

  const ITEM_STATE_HEADERS = [
    'Item_ID', 'Kind', 'Set_ID', 'Total_Attempts', 'Total_Wrong',
    'Recent_Bits', 'Last_Seen', 'Step_Index', 'EF', 'Next_Review', 'Avg_Time'
  ];

  const SESSION_LOG_HEADERS = ['タイムスタンプ', '学習セット名', 'モード', '正答率', '解答時間', '詳細'];

  const MEANING_KEYS = [
    '意味＠名詞', '意味＠動詞', '意味＠形容詞', '意味＠副詞',
    '意味＠前置詞', '意味＠接続詞', '意味＠その他品詞', '意味＠熟語・慣用表現'
  ];

  let tokenClient = null;
  let authPromise = null;

  function getClientId_() {
    return (window.DIGITALDRILL_CONFIG && window.DIGITALDRILL_CONFIG.GOOGLE_CLIENT_ID) || '';
  }

  function getScopes_() {
    return (window.DIGITALDRILL_CONFIG && window.DIGITALDRILL_CONFIG.GOOGLE_DRIVE_SCOPES)
      || 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';
  }

  function isEnabled_() {
    return !!getClientId_();
  }

  function accountSuffix_() {
    const user = window.AuthGateService && AuthGateService.getUser ? AuthGateService.getUser() : null;
    const account = user && user.account ? String(user.account).toLowerCase() : '';
    return account ? account.replace(/[^a-z0-9@._+-]/gi, '_') : '';
  }

  function metaStorageKey_() {
    const suffix = accountSuffix_();
    return suffix ? META_KEY + ':' + suffix : META_KEY;
  }

  function tokenStorageKey_() {
    const suffix = accountSuffix_();
    return suffix ? TOKEN_KEY + ':' + suffix : TOKEN_KEY;
  }

  function tokenExpStorageKey_() {
    const suffix = accountSuffix_();
    return suffix ? TOKEN_EXP_KEY + ':' + suffix : TOKEN_EXP_KEY;
  }

  /** cceec0b 以前のグローバルキーからアカウント別キーへ一度だけ移行 */
  function migrateLegacyToken_() {
    const suffix = accountSuffix_();
    if (!suffix) return;
    const key = tokenStorageKey_();
    const expKey = tokenExpStorageKey_();
    if (localStorage.getItem(key)) return;
    const legacyToken = localStorage.getItem(TOKEN_KEY);
    if (!legacyToken) return;
    localStorage.setItem(key, legacyToken);
    const legacyExp = localStorage.getItem(TOKEN_EXP_KEY);
    if (legacyExp) localStorage.setItem(expKey, legacyExp);
  }

  /** アカウント別 meta キー導入前の dd_user_drive_meta を移行 */
  function migrateLegacyMeta_() {
    const suffix = accountSuffix_();
    if (!suffix) return;
    const key = metaStorageKey_();
    if (localStorage.getItem(key)) return;
    const legacy = localStorage.getItem(META_KEY);
    if (!legacy) return;
    localStorage.setItem(key, legacy);
  }

  function loadMeta_() {
    migrateLegacyMeta_();
    try {
      const raw = localStorage.getItem(metaStorageKey_());
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveMeta_(meta) {
    try { localStorage.setItem(metaStorageKey_(), JSON.stringify(meta)); } catch (e) {}
  }

  function normField_(value) {
    if (value === null || value === undefined) return UNREGISTERED;
    const s = String(value).trim();
    return s === '' ? UNREGISTERED : s;
  }

  function rowToObj_(headers, row) {
    const obj = {};
    headers.forEach(function (h, i) {
      if (h) obj[h] = row[i] !== undefined && row[i] !== null ? row[i] : '';
    });
    return obj;
  }

  function sheetUrl_(bookId, sheetId) {
    if (!bookId) return '';
    let url = 'https://docs.google.com/spreadsheets/d/' + bookId + '/edit';
    if (sheetId) url += '#gid=' + sheetId;
    return url;
  }

  function nowJst_() {
    return new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).replace(/\//g, '/');
  }

  async function apiFetch_(url, options) {
    const token = await ensureAuthorized_();
    options = options || {};
    options.headers = Object.assign({}, options.headers || {}, {
      Authorization: 'Bearer ' + token
    });
    const res = await fetch(url, options);
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const err = await res.json();
        detail = err.error && err.error.message ? err.error.message : JSON.stringify(err);
      } catch (e) {}
      throw new Error('Google API エラー (' + res.status + '): ' + detail);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function waitForOAuth2_(attempts) {
    attempts = attempts || 0;
    return new Promise(function (resolve, reject) {
      if (window.google && google.accounts && google.accounts.oauth2) {
        resolve(true);
        return;
      }
      if (attempts >= 50) {
        reject(new Error('Google OAuth ライブラリが読み込まれていません'));
        return;
      }
      setTimeout(function () {
        waitForOAuth2_(attempts + 1).then(resolve, reject);
      }, 100);
    });
  }

  function initTokenClient_() {
    if (tokenClient) return tokenClient;
    if (!window.google || !google.accounts || !google.accounts.oauth2) return null;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: getClientId_(),
      scope: getScopes_(),
      callback: function () {}
    });
    return tokenClient;
  }

  function requestAccessToken_(prompt) {
    return waitForOAuth2_().then(function () {
      return new Promise(function (resolve, reject) {
        const client = initTokenClient_();
        if (!client) {
          reject(new Error('Google OAuth ライブラリが初期化できません'));
          return;
        }
        client.callback = function (resp) {
          if (resp.error) {
            reject(new Error(resp.error_description || resp.error));
            return;
          }
          localStorage.setItem(tokenStorageKey_(), resp.access_token);
          localStorage.setItem(tokenExpStorageKey_(), String(Date.now() + (resp.expires_in - 60) * 1000));
          resolve(resp.access_token);
        };
        client.requestAccessToken({ prompt: prompt || '' });
      });
    });
  }

  async function ensureAuthorized_() {
    migrateLegacyToken_();
    const token = localStorage.getItem(tokenStorageKey_());
    const exp = parseInt(localStorage.getItem(tokenExpStorageKey_()) || '0', 10);
    if (token && Date.now() < exp) return token;
    if (authPromise) return authPromise;
    authPromise = (async function () {
      try {
        return await requestAccessToken_(token ? '' : 'consent');
      } catch (e) {
        if (!token) throw e;
        clearAuth_();
        return await requestAccessToken_('consent');
      }
    })().finally(function () {
      authPromise = null;
    });
    return authPromise;
  }

  function clearAuth_() {
    localStorage.removeItem(tokenStorageKey_());
    localStorage.removeItem(tokenExpStorageKey_());
  }

  async function driveList_(query) {
    const q = encodeURIComponent(query);
    const data = await apiFetch_(
      'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name,mimeType)&pageSize=20'
    );
    return data.files || [];
  }

  async function driveCreateFolder_(name, parentId) {
    const body = {
      name: name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : ['root']
    };
    return apiFetch_('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  async function driveCreateSpreadsheet_(name, parentId) {
    const body = {
      name: name,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: parentId ? [parentId] : ['root']
    };
    return apiFetch_('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  async function driveVerifyFolder_(folderId) {
    try {
      const files = await driveList_(
        "id='" + String(folderId).replace(/'/g, "\\'") + "' and mimeType='application/vnd.google-apps.folder' and trashed=false"
      );
      return files.length > 0;
    } catch (e) {
      return false;
    }
  }

  async function driveVerifyOwnedRootFolder_(folderId) {
    try {
      const files = await driveList_(
        "id='" + String(folderId).replace(/'/g, "\\'") + "' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false"
      );
      return files.length > 0;
    } catch (e) {
      return false;
    }
  }

  async function findMyDataFolder_() {
    const qName = FOLDER_NAME.replace(/'/g, "\\'");
    let found = await driveList_(
      "name='" + qName + "' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false"
    );
    if (found.length) return found[0];
    found = await driveList_(
      "name='" + qName + "' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    );
    return found.length ? found[0] : null;
  }

  async function driveVerifyOwnedInFolder_(fileId, folderId) {
    try {
      const files = await driveList_(
        "id='" + String(fileId).replace(/'/g, "\\'") + "' and '" + String(folderId).replace(/'/g, "\\'") + "' in parents and trashed=false"
      );
      return files.length > 0;
    } catch (e) {
      return false;
    }
  }

  async function ensureFolder_() {
    const meta = loadMeta_();
    if (meta.folderId && await driveVerifyFolder_(meta.folderId)) return meta.folderId;

    const found = await findMyDataFolder_();
    if (found) {
      meta.folderId = found.id;
      saveMeta_(meta);
      return meta.folderId;
    }

    delete meta.folderId;
    delete meta.vocabBookId;
    delete meta.logBookId;
    saveMeta_(meta);

    const created = await driveCreateFolder_(FOLDER_NAME, null);
    meta.folderId = created.id;
    saveMeta_(meta);
    return meta.folderId;
  }

  async function findSpreadsheetInFolder_(folderId, name) {
    const files = await driveList_(
      "name='" + name.replace(/'/g, "\\'") + "' and mimeType='application/vnd.google-apps.spreadsheet' and '" + folderId + "' in parents and trashed=false"
    );
    return files.length ? files[0] : null;
  }

  async function ensureSpreadsheet_(folderId, name, setupFn) {
    const meta = loadMeta_();
    const metaKey = name === VOCAB_BOOK_NAME ? 'vocabBookId' : 'logBookId';
    if (meta[metaKey] && await driveVerifyOwnedInFolder_(meta[metaKey], folderId)) return meta[metaKey];
    delete meta[metaKey];
    saveMeta_(meta);

    const existing = await findSpreadsheetInFolder_(folderId, name);
    if (existing) {
      meta[metaKey] = existing.id;
      saveMeta_(meta);
      if (setupFn) await setupFn(existing.id);
      return existing.id;
    }

    const created = await driveCreateSpreadsheet_(name, folderId);
    meta[metaKey] = created.id;
    saveMeta_(meta);
    if (setupFn) await setupFn(created.id);
    return created.id;
  }

  async function sheetsGet_(id) {
    return apiFetch_('https://sheets.googleapis.com/v4/spreadsheets/' + id + '?fields=sheets.properties,spreadsheetId,properties.title');
  }

  async function sheetsValuesGet_(id, range) {
    const data = await apiFetch_(
      'https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(range)
    );
    return data.values || [];
  }

  async function sheetsValuesUpdate_(id, range, values) {
    return apiFetch_(
      'https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(range) + '?valueInputOption=USER_ENTERED',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: values }) }
    );
  }

  async function sheetsValuesAppend_(id, range, values) {
    return apiFetch_(
      'https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(range) + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: values }) }
    );
  }

  async function sheetsBatchUpdate_(id, requests) {
    return apiFetch_(
      'https://sheets.googleapis.com/v4/spreadsheets/' + id + ':batchUpdate',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: requests }) }
    );
  }

  async function setupVocabBook_(bookId) {
    const ss = await sheetsGet_(bookId);
    let sheets = ss.sheets || [];
    if (!sheets.length) {
      await sheetsBatchUpdate_(bookId, [{ addSheet: { properties: { title: 'デフォルト' } } }]);
      await sheetsValuesUpdate_(bookId, 'デフォルト!A1:V1', [VOCAB_HEADERS]);
      return;
    }
    let targetSheet = sheets.find(function (s) { return s.properties.title === 'デフォルト'; });
    if (!targetSheet) {
      const first = sheets[0].properties;
      if (first.title === 'シート1' || first.title === 'Sheet1') {
        await sheetsBatchUpdate_(bookId, [{
          updateSheetProperties: {
            properties: { sheetId: first.sheetId, title: 'デフォルト' },
            fields: 'title'
          }
        }]);
        targetSheet = { properties: { title: 'デフォルト' } };
      } else {
        targetSheet = { properties: { title: first.title } };
      }
    }
    const sheetTitle = targetSheet.properties.title;
    const header = await sheetsValuesGet_(bookId, sheetTitle + '!A1:V1');
    if (!header.length || header[0][0] !== '通し番号') {
      await sheetsValuesUpdate_(bookId, sheetTitle + '!A1:V1', [VOCAB_HEADERS]);
    }
  }

  async function setupLogBook_(bookId) {
    const ss = await sheetsGet_(bookId);
    const sheets = ss.sheets || [];
    let logSheet = sheets.find(function (s) { return s.properties.title === SESSION_LOG_SHEET; });
    if (!logSheet && sheets.length) {
      const first = sheets[0].properties;
      if (first.title === 'シート1' || first.title === 'Sheet1') {
        await sheetsBatchUpdate_(bookId, [{
          updateSheetProperties: {
            properties: { sheetId: first.sheetId, title: SESSION_LOG_SHEET },
            fields: 'title'
          }
        }]);
      } else if (first.title !== ITEM_STATE_SHEET) {
        await sheetsBatchUpdate_(bookId, [{ addSheet: { properties: { title: SESSION_LOG_SHEET } } }]);
      }
    }
    const header = await sheetsValuesGet_(bookId, SESSION_LOG_SHEET + '!A1:F1');
    if (!header.length || !header[0].length) {
      await sheetsValuesUpdate_(bookId, SESSION_LOG_SHEET + '!A1:F1', [SESSION_LOG_HEADERS]);
    }
    await ensureItemStateSheet_(bookId);
  }

  async function ensureItemStateSheet_(bookId) {
    const ss = await sheetsGet_(bookId);
    const exists = (ss.sheets || []).some(function (s) { return s.properties.title === ITEM_STATE_SHEET; });
    if (!exists) {
      await sheetsBatchUpdate_(bookId, [{ addSheet: { properties: { title: ITEM_STATE_SHEET } } }]);
    }
    const header = await sheetsValuesGet_(bookId, ITEM_STATE_SHEET + '!A1:K1');
    if (!header.length || !header[0].length) {
      await sheetsValuesUpdate_(bookId, ITEM_STATE_SHEET + '!A1:K1', [ITEM_STATE_HEADERS]);
    }
  }

  async function getVocabBookId_() {
    const folderId = await ensureFolder_();
    return ensureSpreadsheet_(folderId, VOCAB_BOOK_NAME, setupVocabBook_);
  }

  async function getLogBookId_() {
    const folderId = await ensureFolder_();
    return ensureSpreadsheet_(folderId, LOG_BOOK_NAME, setupLogBook_);
  }

  async function ensureLogBookReady_(bookId) {
    const ss = await sheetsGet_(bookId);
    const hasSheet = (ss.sheets || []).some(function (s) {
      return s.properties.title === SESSION_LOG_SHEET;
    });
    if (!hasSheet) await setupLogBook_(bookId);
  }

  /** ログイン後: フォルダ・マイ単語帳・学習記録ブックをなければ作成 */
  async function ensureUserDataEnvironment_() {
    await ensureAuthorized_();
    await getVocabBookId_();
    await getLogBookId_();
  }

  async function retryAuthorization_() {
    clearAuth_();
    return ensureAuthorized_();
  }

  function buildSheetInfo_(sheetName, values) {
    if (!values || values.length <= 1) {
      return { sheetName: sheetName, wordCount: 0, divisions: { dai: [], chu: [], sho: [] } };
    }
    const headers = values[0];
    const daiIdx = headers.indexOf('大区分');
    const chuIdx = headers.indexOf('中区分');
    const shoIdx = headers.indexOf('小区分');
    const wordIdx = headers.indexOf('英単語・熟語の表現');
    const daiSet = {};
    const chuSet = {};
    const shoSet = {};
    let count = 0;
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const word = wordIdx >= 0 ? row[wordIdx] : '';
      if (!word || String(word).trim() === '') continue;
      count++;
      if (daiIdx >= 0) daiSet[normField_(row[daiIdx])] = true;
      if (chuIdx >= 0) chuSet[normField_(row[chuIdx])] = true;
      if (shoIdx >= 0) shoSet[normField_(row[shoIdx])] = true;
    }
    return {
      sheetName: sheetName,
      wordCount: count,
      divisions: {
        dai: Object.keys(daiSet).sort(),
        chu: Object.keys(chuSet).sort(),
        sho: Object.keys(shoSet).sort()
      }
    };
  }

  function validateVocabRow_(rowObj) {
    const word = normField_(rowObj['英単語・熟語の表現']);
    if (word === UNREGISTERED) throw new Error('英単語・熟語の表現（5列目）は必須です。');
    const hasMeaning = MEANING_KEYS.some(function (k) { return normField_(rowObj[k]) !== UNREGISTERED; });
    if (!hasMeaning) throw new Error('6〜13列目のいずれか1つの意味は必須です: ' + word);
  }

  function buildVocabRow_(rowObj) {
    validateVocabRow_(rowObj);
    return VOCAB_HEADERS.map(function (h) {
      if (h === '通し番号') return '';
      return normField_(rowObj[h]);
    });
  }

  async function ensureVocabSheet_(bookId, sheetName) {
    const ss = await sheetsGet_(bookId);
    let sheet = (ss.sheets || []).find(function (s) { return s.properties.title === sheetName; });
    if (!sheet) {
      await sheetsBatchUpdate_(bookId, [{ addSheet: { properties: { title: sheetName } } }]);
      await sheetsValuesUpdate_(bookId, sheetName + '!A1:V1', [VOCAB_HEADERS]);
      return;
    }
    const header = await sheetsValuesGet_(bookId, sheetName + '!A1:V1');
    if (!header.length || header[0][0] !== '通し番号') {
      await sheetsValuesUpdate_(bookId, sheetName + '!A1:V1', [VOCAB_HEADERS]);
    }
  }

  async function renumberVocabSheet_(bookId, sheetName) {
    const values = await sheetsValuesGet_(bookId, sheetName + '!A:A');
    if (values.length <= 1) return;
    const nums = [];
    for (let i = 1; i < values.length; i++) nums.push([i]);
    await sheetsValuesUpdate_(bookId, sheetName + '!A2:A' + values.length, nums);
  }

  function parseWordsFromSheet_(values, sheetName, filters, includeBookPool) {
    if (!values || values.length <= 1) return { words: [], pool: [], bookPool: [] };
    const headers = values[0];
    const daiFilter = (filters && filters.dai) || [];
    const chuFilter = (filters && filters.chu) || [];
    const shoFilter = (filters && filters.sho) || [];
    const words = [];
    const pool = [];
    for (let r = 1; r < values.length; r++) {
      const rowObj = rowToObj_(headers, values[r]);
      rowObj._rowIndex = r + 1;
      const word = normField_(rowObj['英単語・熟語の表現']);
      if (word === UNREGISTERED) continue;
      pool.push(rowObj);
      const dai = normField_(rowObj['大区分']);
      const chu = normField_(rowObj['中区分']);
      const sho = normField_(rowObj['小区分']);
      if (daiFilter.length && daiFilter.indexOf(dai) === -1) continue;
      if (chuFilter.length && chuFilter.indexOf(chu) === -1) continue;
      if (shoFilter.length && shoFilter.indexOf(sho) === -1) continue;
      words.push(rowObj);
    }
    return { words: words, pool: pool, bookPool: includeBookPool ? pool.slice() : pool };
  }

  function buildWordId_(bookName, sheetName, serialNo) {
    return String(bookName || UNREGISTERED) + '|' + String(sheetName || UNREGISTERED) + '|' + String(serialNo || UNREGISTERED);
  }

  async function opGetVocabCatalog_() {
    const bookId = await getVocabBookId_();
    const ss = await sheetsGet_(bookId);
    const sheetInfos = [];
    for (let i = 0; i < (ss.sheets || []).length; i++) {
      const name = ss.sheets[i].properties.title;
      const values = await sheetsValuesGet_(bookId, name + '!A:V');
      sheetInfos.push(buildSheetInfo_(name, values));
    }
    return {
      status: 'success',
      data: {
        presets: [],
        userBooks: [{
          bookName: VOCAB_BOOK_NAME,
          bookId: bookId,
          bookUrl: sheetUrl_(bookId),
          source: 'user',
          sheets: sheetInfos
        }]
      }
    };
  }

  async function opGetVocabWords_(payload) {
    const sheetName = payload.sheetName;
    if (!sheetName) throw new Error('sheetName は必須です。');
    const bookId = await getVocabBookId_();
    const filters = payload.filters || (payload.filtersJson ? JSON.parse(payload.filtersJson) : {});
    const includeBookPool = payload.includeBookPool !== false;
    const values = await sheetsValuesGet_(bookId, sheetName + '!A:V');
    const parsed = parseWordsFromSheet_(values, sheetName, filters, false);
    if (includeBookPool) {
      const ss = await sheetsGet_(bookId);
      const bookPool = [];
      for (let i = 0; i < (ss.sheets || []).length; i++) {
        const name = ss.sheets[i].properties.title;
        const sv = await sheetsValuesGet_(bookId, name + '!A:V');
        if (sv.length <= 1) continue;
        const headers = sv[0];
        for (let r = 1; r < sv.length; r++) {
          const rowObj = rowToObj_(headers, sv[r]);
          if (normField_(rowObj['英単語・熟語の表現']) === UNREGISTERED) continue;
          rowObj._sheetName = name;
          bookPool.push(rowObj);
        }
      }
      parsed.bookPool = bookPool;
    }
    return { status: 'success', data: parsed };
  }

  async function opRegisterVocabWords_(payload) {
    const sheetName = payload.sheetName;
    const rows = payload.rows || [];
    if (!sheetName) throw new Error('sheetName は必須です。');
    if (!rows.length) throw new Error('登録する単語がありません。');
    const bookId = await getVocabBookId_();
    await ensureVocabSheet_(bookId, sheetName);
    const built = rows.map(buildVocabRow_);
    await sheetsValuesAppend_(bookId, sheetName + '!A:V', built);
    await renumberVocabSheet_(bookId, sheetName);
    const ss = await sheetsGet_(bookId);
    const sheet = (ss.sheets || []).find(function (s) { return s.properties.title === sheetName; });
    return {
      status: 'success',
      data: {
        registeredCount: built.length,
        sheetName: sheetName,
        bookName: VOCAB_BOOK_NAME,
        bookId: bookId,
        bookUrl: sheetUrl_(bookId),
        sheetUrl: sheet ? sheetUrl_(bookId, sheet.properties.sheetId) : sheetUrl_(bookId)
      }
    };
  }

  async function opGetItemStates_(payload) {
    const setIdFilter = payload.setId || '';
    const bookId = await getLogBookId_();
    await ensureItemStateSheet_(bookId);
    const values = await sheetsValuesGet_(bookId, ITEM_STATE_SHEET + '!A:K');
    if (values.length <= 1) return { status: 'success', data: {} };
    const headers = values[0];
    const idx = {};
    ITEM_STATE_HEADERS.forEach(function (h) { idx[h] = headers.indexOf(h); });
    const states = {};
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const itemId = normField_(row[idx['Item_ID']]);
      if (itemId === UNREGISTERED) continue;
      const setId = normField_(row[idx['Set_ID']]);
      if (setIdFilter && setId !== setIdFilter && itemId.indexOf(setIdFilter) !== 0) continue;
      states[itemId] = {
        Item_ID: itemId,
        Kind: normField_(row[idx['Kind']]),
        Set_ID: setId,
        Total_Attempts: parseInt(row[idx['Total_Attempts']], 10) || 0,
        Total_Wrong: parseInt(row[idx['Total_Wrong']], 10) || 0,
        Recent_Bits: parseInt(row[idx['Recent_Bits']], 10) || 0,
        Last_Seen: parseInt(row[idx['Last_Seen']], 10) || 0,
        Step_Index: parseInt(row[idx['Step_Index']], 10) || 0,
        EF: parseFloat(row[idx['EF']]) || 2.5,
        Next_Review: parseInt(row[idx['Next_Review']], 10) || 0,
        Avg_Time: parseInt(row[idx['Avg_Time']], 10) || 0
      };
    }
    return { status: 'success', data: states };
  }

  async function opUpsertItemStates_(payload) {
    const rows = payload.rows || [];
    if (!rows.length) return { status: 'success', data: { updated: 0, inserted: 0 } };
    const bookId = await getLogBookId_();
    await ensureItemStateSheet_(bookId);
    const values = await sheetsValuesGet_(bookId, ITEM_STATE_SHEET + '!A:K');
    const headers = values.length ? values[0] : ITEM_STATE_HEADERS;
    const itemIdCol = headers.indexOf('Item_ID');
    const rowMap = {};
    for (let r = 1; r < values.length; r++) {
      const id = normField_(values[r][itemIdCol]);
      if (id !== UNREGISTERED) rowMap[id] = r + 1;
    }
    let updated = 0;
    let inserted = 0;
    const newRows = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const itemId = normField_(row.Item_ID);
      if (itemId === UNREGISTERED) continue;
      const normalized = ITEM_STATE_HEADERS.map(function (h) {
        if (h === 'Item_ID') return itemId;
        if (h === 'Kind') return row.Kind || (itemId.indexOf('|') >= 0 ? 'vocab' : 'grammar');
        if (row[h] != null) return row[h];
        if (h === 'EF') return 2.5;
        return 0;
      });
      const existingRow = rowMap[itemId];
      if (existingRow) {
        await sheetsValuesUpdate_(bookId, ITEM_STATE_SHEET + '!A' + existingRow + ':K' + existingRow, [normalized]);
        updated++;
      } else {
        newRows.push(normalized);
        inserted++;
      }
    }
    if (newRows.length) {
      await sheetsValuesAppend_(bookId, ITEM_STATE_SHEET + '!A:K', newRows);
    }
    return { status: 'success', data: { updated: updated, inserted: inserted } };
  }

  async function opGetLearningLogs_() {
    const bookId = await getLogBookId_();
    await ensureLogBookReady_(bookId);
    const values = await sheetsValuesGet_(bookId, SESSION_LOG_SHEET + '!A:F');
    if (values.length <= 1) return { status: 'success', data: [] };
    const headers = values[0];
    const logs = [];
    for (let i = values.length - 1; i >= 1 && logs.length < 20; i--) {
      logs.push(rowToObj_(headers, values[i]));
    }
    return { status: 'success', data: logs };
  }

  async function opSaveSessionLog_(payload) {
    const bookId = await getLogBookId_();
    const ss = await sheetsGet_(bookId);
    const hasSheet = (ss.sheets || []).some(function (s) { return s.properties.title === SESSION_LOG_SHEET; });
    if (!hasSheet) await setupLogBook_(bookId);
    const entry = payload || {};
    await sheetsValuesAppend_(bookId, SESSION_LOG_SHEET + '!A:F', [[
      nowJst_(),
      entry.setName || entry.setId || '',
      entry.mode || '',
      entry.score != null ? entry.score : (entry.correctRate || ''),
      entry.durationSec != null ? entry.durationSec : (entry.timeTaken || ''),
      JSON.stringify(entry)
    ]]);
    return { status: 'success', message: '学習記録を保存しました' };
  }

  async function opCountSessionAttempts_(payload) {
    const setId = payload.setId || '';
    const bookId = await getLogBookId_();
    await ensureLogBookReady_(bookId);
    const values = await sheetsValuesGet_(bookId, SESSION_LOG_SHEET + '!A:F');
    if (values.length <= 1) return { status: 'success', data: { count: 0, attemptNo: 1 } };
    const headers = values[0];
    const setIdx = headers.indexOf('学習セット名');
    let count = 0;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][setIdx] || '') === String(setId || '')) count++;
    }
    return { status: 'success', data: { count: count, attemptNo: count + 1 } };
  }

  async function opStartSession_(payload) {
    const sheetName = payload.sheetName;
    if (!sheetName) throw new Error('sheetName は必須です。');
    const wordRes = await opGetVocabWords_({
      sheetName: sheetName,
      filters: payload.filters || {},
      includeBookPool: true
    });
    const wordData = wordRes.data;
    if (!wordData.words || !wordData.words.length) throw new Error('出題できる単語がありません');
    const statesRes = await opGetItemStates_({ setId: '' });
    const allStates = statesRes.data || {};
    const srsStates = {};
    wordData.words.forEach(function (w) {
      const id = buildWordId_(VOCAB_BOOK_NAME, sheetName, w['通し番号']);
      if (allStates[id]) srsStates[id] = allStates[id];
    });
    const user = window.AuthGateService && AuthGateService.getUser ? AuthGateService.getUser() : null;
    return {
      status: 'success',
      data: {
        mode: payload.mode || 'reading',
        setName: VOCAB_BOOK_NAME + ' / ' + sheetName,
        bookName: VOCAB_BOOK_NAME,
        sheetName: sheetName,
        filters: payload.filters || {},
        words: wordData.words,
        pool: wordData.pool,
        bookPool: wordData.bookPool,
        srsStates: srsStates,
        options: payload.options || {},
        createdAt: new Date().toISOString(),
        userEmail: user && user.account ? user.account : ''
      }
    };
  }

  async function dispatch_(op, payload) {
    try {
      switch (op) {
        case 'getVocabCatalog': return await opGetVocabCatalog_();
        case 'getVocabWords': return await opGetVocabWords_(payload || {});
        case 'registerVocabWords': return await opRegisterVocabWords_(payload || {});
        case 'getLearningLogs': return await opGetLearningLogs_();
        case 'getItemStates': return await opGetItemStates_(payload || {});
        case 'upsertItemStates': return await opUpsertItemStates_(payload || {});
        case 'saveSessionLog': return await opSaveSessionLog_(payload || {});
        case 'startSession': return await opStartSession_(payload || {});
        case 'countSessionAttempts': return await opCountSessionAttempts_(payload || {});
        default: return { status: 'error', message: '未対応の op: ' + op };
      }
    } catch (e) {
      return { status: 'error', message: String(e.message || e) };
    }
  }

  return {
    isEnabled: isEnabled_,
    ensureAuthorized: ensureAuthorized_,
    ensureUserDataEnvironment: ensureUserDataEnvironment_,
    retryAuthorization: retryAuthorization_,
    clearAuth: clearAuth_,
    dispatch: dispatch_
  };
})();

window.UserDriveModule = UserDriveModule;
