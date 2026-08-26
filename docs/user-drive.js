/**
 * ユーザー Drive / Sheets 操作（GCP OAuth + REST API）
 * UserBridge から dispatch される唯一の実装。設計契約: docs/USER_DATA_SANCTUARY.md
 */
const UserDriveModule = (function () {
  const META_KEY = 'dd_user_drive_meta';
  const TOKEN_KEY = 'dd_google_access_token';
  const TOKEN_EXP_KEY = 'dd_google_token_expiry';
  const REFRESH_KEY = 'dd_google_refresh_token';
  const REFRESH_OBTAINED_KEY = 'dd_google_refresh_obtained';
  /** PKCE リダイレクト往復用（sessionStorage） */
  const PKCE_VERIFIER_SS = 'dd_oauth_pkce_verifier';
  const PKCE_STATE_SS = 'dd_oauth_state';
  const PKCE_REDIRECT_SS = 'dd_oauth_redirect_uri';
  const PKCE_TOAST_SS = 'dd_oauth_pending_toast';
  const FOLDER_NAME = 'DigitalDrill_MyData';
  const VOCAB_BOOK_NAME = 'マイ単語帳';
  const LOG_BOOK_NAME = 'DigitalDrill学習記録';
  const ITEM_STATE_SHEET = '学習状態';
  const SESSION_LOG_SHEET = '学習記録';
  /** ローカルキャッシュに読み込んだ学習セットの記録（通信量抑制用） */
  const SET_CACHE_LOG_SHEET = '学習セット更新記録';
  const UNREGISTERED = '(未登録)';
  /** refresh_token による再同意なし運用の目標期間（UX・ドキュメント用。Google 側の失効が優先） */
  const REFRESH_SOFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

  const SET_CACHE_LOG_HEADERS = [
    'Set_ID', 'Set_Name', 'Kind', 'Cache_Loaded_At', 'Source_Modified_At',
    'Fingerprint', 'Word_Count', 'Last_Studied_At'
  ];

  const MEANING_KEYS = [
    '意味＠名詞', '意味＠動詞', '意味＠形容詞', '意味＠副詞',
    '意味＠前置詞', '意味＠接続詞', '意味＠その他品詞', '意味＠熟語・慣用表現'
  ];

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

  /** GCP の「承認済みのリダイレクト URI」と一字一句一致させること */
  function getRedirectUri_() {
    const cfg = window.DIGITALDRILL_CONFIG && window.DIGITALDRILL_CONFIG.GOOGLE_OAUTH_REDIRECT_URI;
    if (cfg) return String(cfg);
    return window.location.origin + window.location.pathname;
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

  function refreshStorageKey_() {
    const suffix = accountSuffix_();
    return suffix ? REFRESH_KEY + ':' + suffix : REFRESH_KEY;
  }

  function refreshObtainedStorageKey_() {
    const suffix = accountSuffix_();
    return suffix ? REFRESH_OBTAINED_KEY + ':' + suffix : REFRESH_OBTAINED_KEY;
  }

  /** cceec0b 以前のグローバルキーからアカウント別キーへ一度だけ移行 */
  function migrateLegacyToken_() {
    const suffix = accountSuffix_();
    if (!suffix) return;
    const key = tokenStorageKey_();
    const expKey = tokenExpStorageKey_();
    const refreshKey = refreshStorageKey_();
    const obtainedKey = refreshObtainedStorageKey_();
    if (!localStorage.getItem(key)) {
      const legacyToken = localStorage.getItem(TOKEN_KEY);
      if (legacyToken) {
        localStorage.setItem(key, legacyToken);
        const legacyExp = localStorage.getItem(TOKEN_EXP_KEY);
        if (legacyExp) localStorage.setItem(expKey, legacyExp);
      }
    }
    if (!localStorage.getItem(refreshKey)) {
      const legacyRefresh = localStorage.getItem(REFRESH_KEY);
      if (legacyRefresh) {
        localStorage.setItem(refreshKey, legacyRefresh);
        const legacyObtained = localStorage.getItem(REFRESH_OBTAINED_KEY);
        if (legacyObtained) localStorage.setItem(obtainedKey, legacyObtained);
      }
    }
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

  function canonicalizeVocabHeader_(header) {
    const raw = header === null || header === undefined ? '' : String(header).trim();
    if (!raw) return '';
    if (VOCAB_HEADER_ALIASES[raw]) return VOCAB_HEADER_ALIASES[raw];
    if (raw.indexOf('意味@') === 0) return '意味＠' + raw.slice('意味@'.length);
    return raw;
  }

  function rowToObj_(headers, row) {
    const obj = {};
    headers.forEach(function (h, i) {
      const key = canonicalizeVocabHeader_(h);
      if (!key) return;
      const value = row[i] !== undefined && row[i] !== null ? row[i] : '';
      if (obj[key] === undefined || obj[key] === '') obj[key] = value;
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
    const token = await ensureAuthorized_({ interactive: false });
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
      // 401 時は refresh を一度試してリトライ
      if (res.status === 401 && getRefreshToken_()) {
        try {
          clearAccessTokenOnly_();
          const retryToken = await refreshAccessToken_();
          options.headers.Authorization = 'Bearer ' + retryToken;
          const res2 = await fetch(url, options);
          if (!res2.ok) {
            let detail2 = res2.statusText;
            try {
              const err2 = await res2.json();
              detail2 = err2.error && err2.error.message ? err2.error.message : JSON.stringify(err2);
            } catch (e2) {}
            throw new Error('Google API エラー (' + res2.status + '): ' + detail2);
          }
          if (res2.status === 204) return null;
          return res2.json();
        } catch (e) {
          throw e;
        }
      }
      throw new Error('Google API エラー (' + res.status + '): ' + detail);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function clearAccessTokenOnly_() {
    migrateLegacyToken_();
    localStorage.removeItem(tokenStorageKey_());
    localStorage.removeItem(tokenExpStorageKey_());
  }

  function base64UrlEncode_(bytes) {
    let binary = '';
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomUrlSafe_(byteLen) {
    const bytes = new Uint8Array(byteLen);
    crypto.getRandomValues(bytes);
    return base64UrlEncode_(bytes);
  }

  async function pkceChallenge_(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64UrlEncode_(digest);
  }

  function persistTokenResponse_(data) {
    migrateLegacyToken_();
    if (!data || !data.access_token) {
      throw new Error('トークン応答に access_token がありません');
    }
    localStorage.setItem(tokenStorageKey_(), data.access_token);
    const expiresIn = parseInt(data.expires_in, 10) || 3600;
    localStorage.setItem(tokenExpStorageKey_(), String(Date.now() + (expiresIn - 60) * 1000));
    if (data.refresh_token) {
      localStorage.setItem(refreshStorageKey_(), data.refresh_token);
      localStorage.setItem(refreshObtainedStorageKey_(), String(Date.now()));
    }
  }

  function getRefreshToken_() {
    migrateLegacyToken_();
    return localStorage.getItem(refreshStorageKey_()) || '';
  }

  function hasValidAccessToken_() {
    migrateLegacyToken_();
    const token = localStorage.getItem(tokenStorageKey_());
    const exp = parseInt(localStorage.getItem(tokenExpStorageKey_()) || '0', 10);
    return !!(token && Date.now() < exp);
  }

  /** access 有効、または refresh がありサイレント更新できる見込み */
  function hasCachedToken_() {
    if (hasValidAccessToken_()) return true;
    return !!getRefreshToken_();
  }

  function stripOAuthParamsFromUrl_() {
    try {
      const url = new URL(window.location.href);
      ['code', 'state', 'scope', 'authuser', 'prompt', 'hd', 'error', 'error_description'].forEach(function (k) {
        url.searchParams.delete(k);
      });
      const cleaned = url.pathname + (url.search ? url.search : '') + (url.hash || '');
      window.history.replaceState({}, document.title, cleaned);
    } catch (e) {}
  }

  async function exchangeCodeForTokens_(code, redirectUri, verifier) {
    const body = new URLSearchParams({
      client_id: getClientId_(),
      code: code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error(data.error_description || data.error || ('token exchange failed: ' + res.status));
    }
    persistTokenResponse_(data);
    if (!data.refresh_token && !getRefreshToken_()) {
      console.warn('Drive OAuth: refresh_token が返りませんでした。再同意が必要になることがあります。');
    }
    return data.access_token;
  }

  async function refreshAccessToken_() {
    const refresh = getRefreshToken_();
    if (!refresh) {
      const err = new Error('Drive へのアクセスが許可されていません。画面の「Drive を接続」を押してください。');
      err.code = 'drive_auth_required';
      throw err;
    }
    const body = new URLSearchParams({
      client_id: getClientId_(),
      refresh_token: refresh,
      grant_type: 'refresh_token'
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      clearAuth_();
      const err = new Error(data.error_description || data.error || 'refresh_token が無効です。再接続してください。');
      err.code = 'drive_auth_required';
      throw err;
    }
    persistTokenResponse_(data);
    return data.access_token;
  }

  /**
   * 同タブを Google 認可画面へ遷移（ポップアップなし）。
   * ページはアンロードされるため、呼び出し元の Promise は通常完了しない。
   */
  async function beginRedirectAuth_() {
    const clientId = getClientId_();
    if (!clientId) throw new Error('GOOGLE_CLIENT_ID が未設定です');
    if (!window.crypto || !crypto.subtle) {
      throw new Error('このブラウザでは安全な OAuth（PKCE）を利用できません');
    }
    const verifier = randomUrlSafe_(32);
    const challenge = await pkceChallenge_(verifier);
    const state = 'dddrv.' + randomUrlSafe_(16);
    const redirectUri = getRedirectUri_();
    try {
      sessionStorage.setItem(PKCE_VERIFIER_SS, verifier);
      sessionStorage.setItem(PKCE_STATE_SS, state);
      sessionStorage.setItem(PKCE_REDIRECT_SS, redirectUri);
      sessionStorage.setItem(PKCE_TOAST_SS, '1');
    } catch (e) {
      throw new Error('sessionStorage に書き込めません。ブラウザ設定を確認してください。');
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: getScopes_(),
      state: state,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256'
    });
    window.location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
    return new Promise(function () {});
  }

  /**
   * 認可リダイレクト復帰時の ?code= / ?error= を処理する。
   * @returns {Promise<{handled:boolean, ok?:boolean, justConnected?:boolean, error?:string}>}
   */
  async function consumeOAuthRedirect_() {
    let params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) {
      return { handled: false };
    }
    const state = params.get('state') || '';
    const code = params.get('code');
    const oauthError = params.get('error');
    if (!state || state.indexOf('dddrv.') !== 0) return { handled: false };
    if (!code && !oauthError) return { handled: false };

    const expectedState = sessionStorage.getItem(PKCE_STATE_SS) || '';
    const verifier = sessionStorage.getItem(PKCE_VERIFIER_SS) || '';
    const redirectUri = sessionStorage.getItem(PKCE_REDIRECT_SS) || getRedirectUri_();
    const wantToast = sessionStorage.getItem(PKCE_TOAST_SS) === '1';
    sessionStorage.removeItem(PKCE_STATE_SS);
    sessionStorage.removeItem(PKCE_VERIFIER_SS);
    sessionStorage.removeItem(PKCE_REDIRECT_SS);
    sessionStorage.removeItem(PKCE_TOAST_SS);
    stripOAuthParamsFromUrl_();

    if (oauthError) {
      return {
        handled: true,
        ok: false,
        error: params.get('error_description') || oauthError
      };
    }
    if (!expectedState || state !== expectedState) {
      return { handled: true, ok: false, error: 'OAuth state が一致しません。もう一度「Drive を接続」してください。' };
    }
    if (!verifier) {
      return { handled: true, ok: false, error: 'OAuth 検証情報が見つかりません。もう一度接続してください。' };
    }
    try {
      await exchangeCodeForTokens_(code, redirectUri, verifier);
      return { handled: true, ok: true, justConnected: wantToast };
    } catch (e) {
      return { handled: true, ok: false, error: String(e.message || e) };
    }
  }

  /**
   * @param {{interactive?: boolean}} opts
   * interactive=false のときはリダイレクトせず、キャッシュ／refresh が無ければ失敗する。
   * GAS① 復帰など「ユーザー操作なし」の経路では interactive:false を使うこと。
   */
  async function ensureAuthorized_(opts) {
    opts = opts || {};
    const interactive = opts.interactive !== false;
    migrateLegacyToken_();
    if (hasValidAccessToken_()) {
      return localStorage.getItem(tokenStorageKey_());
    }
    if (authPromise) return authPromise;
    authPromise = (async function () {
      if (getRefreshToken_()) {
        try {
          return await refreshAccessToken_();
        } catch (e) {
          if (!interactive) throw e;
        }
      }
      if (!interactive) {
        const err = new Error('Drive へのアクセスが許可されていません。画面の「Drive を接続」を押してください。');
        err.code = 'drive_auth_required';
        throw err;
      }
      return beginRedirectAuth_();
    })().finally(function () {
      authPromise = null;
    });
    return authPromise;
  }

  function clearAuth_() {
    migrateLegacyToken_();
    localStorage.removeItem(tokenStorageKey_());
    localStorage.removeItem(tokenExpStorageKey_());
    localStorage.removeItem(refreshStorageKey_());
    localStorage.removeItem(refreshObtainedStorageKey_());
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXP_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(REFRESH_OBTAINED_KEY);
  }

  function getRefreshSoftTtlMs_() {
    return REFRESH_SOFT_TTL_MS;
  }

  async function driveList_(query) {
    const q = encodeURIComponent(query);
    const data = await apiFetch_(
      'https://www.googleapis.com/drive/v3/files?q=' + q
        + '&spaces=drive&pageSize=50'
        + '&fields=files(id,name,mimeType,parents,trashed)'
    );
    return data.files || [];
  }

  /** Drive API の q には id 検索が無いので files.get を使う */
  async function driveGet_(fileId, fields) {
    return apiFetch_(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId)
        + '?fields=' + encodeURIComponent(fields || 'id,name,mimeType,trashed,parents')
    );
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
    if (!folderId) return false;
    try {
      const f = await driveGet_(folderId, 'id,mimeType,trashed');
      return !!(f && f.id && !f.trashed && f.mimeType === 'application/vnd.google-apps.folder');
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
    if (!fileId || !folderId) return false;
    try {
      const f = await driveGet_(fileId, 'id,trashed,parents');
      if (!f || f.trashed) return false;
      return (f.parents || []).indexOf(folderId) >= 0;
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
    if (!logSheet) {
      const first = sheets[0] && sheets[0].properties;
      if (first && (first.title === 'シート1' || first.title === 'Sheet1')) {
        await sheetsBatchUpdate_(bookId, [{
          updateSheetProperties: {
            properties: { sheetId: first.sheetId, title: SESSION_LOG_SHEET },
            fields: 'title'
          }
        }]);
      } else {
        await sheetsBatchUpdate_(bookId, [{ addSheet: { properties: { title: SESSION_LOG_SHEET } } }]);
      }
    }
    const header = await sheetsValuesGet_(bookId, SESSION_LOG_SHEET + '!A1:F1');
    const headerRow = header[0] || [];
    const hasTs = headerRow.indexOf('タイムスタンプ') >= 0;
    if (!headerRow.length || !hasTs) {
      await sheetsValuesUpdate_(bookId, SESSION_LOG_SHEET + '!A1:F1', [SESSION_LOG_HEADERS]);
    }
    await ensureItemStateSheet_(bookId);
    await ensureSetCacheLogSheet_(bookId);
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

  async function ensureSetCacheLogSheet_(bookId) {
    const ss = await sheetsGet_(bookId);
    const exists = (ss.sheets || []).some(function (s) { return s.properties.title === SET_CACHE_LOG_SHEET; });
    if (!exists) {
      await sheetsBatchUpdate_(bookId, [{ addSheet: { properties: { title: SET_CACHE_LOG_SHEET } } }]);
    }
    const header = await sheetsValuesGet_(bookId, SET_CACHE_LOG_SHEET + '!A1:H1');
    const row = header[0] || [];
    if (!row.length || row.indexOf('Set_ID') < 0) {
      await sheetsValuesUpdate_(bookId, SET_CACHE_LOG_SHEET + '!A1:H1', [SET_CACHE_LOG_HEADERS]);
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
    const titles = {};
    (ss.sheets || []).forEach(function (s) { titles[s.properties.title] = true; });
    if (!titles[SESSION_LOG_SHEET] || !titles[ITEM_STATE_SHEET] || !titles[SET_CACHE_LOG_SHEET]) {
      await setupLogBook_(bookId);
    } else {
      await ensureSetCacheLogSheet_(bookId);
    }
  }

  /**
   * フォルダ・マイ単語帳・学習記録ブックをなければ作成。
   * @param {{interactive?: boolean}} opts interactive 省略時は true（ボタン押下など）
   */
  async function ensureUserDataEnvironment_(opts) {
    await ensureAuthorized_(opts || {});
    await getVocabBookId_();
    await getLogBookId_();
  }

  async function retryAuthorization_() {
    clearAuth_();
    return ensureAuthorized_({ interactive: true });
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
        dai: Object.keys(daiSet).sort(function (a, b) {
          return String(a).localeCompare(String(b), 'ja', { numeric: true, sensitivity: 'base' });
        }),
        chu: Object.keys(chuSet).sort(function (a, b) {
          return String(a).localeCompare(String(b), 'ja', { numeric: true, sensitivity: 'base' });
        }),
        sho: Object.keys(shoSet).sort(function (a, b) {
          return String(a).localeCompare(String(b), 'ja', { numeric: true, sensitivity: 'base' });
        })
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

  function buildSetId_(sheetName) {
    return 'vocab:' + VOCAB_BOOK_NAME + '/' + String(sheetName || '');
  }

  function fingerprintFromSerialColumn_(colA) {
    let count = 0;
    let maxSerial = 0;
    let sum = 0;
    for (let i = 1; i < (colA || []).length; i++) {
      const raw = colA[i] && colA[i][0] != null ? String(colA[i][0]).trim() : '';
      if (!raw) continue;
      count++;
      const n = parseInt(raw, 10);
      if (!isNaN(n)) {
        if (n > maxSerial) maxSerial = n;
        sum += n;
      }
    }
    return count + ':' + maxSerial + ':' + sum;
  }

  async function opGetVocabBookMeta_() {
    const bookId = await getVocabBookId_();
    const meta = await driveGet_(bookId, 'id,name,modifiedTime,trashed');
    const ss = await sheetsGet_(bookId);
    const sheets = (ss.sheets || []).map(function (s) {
      return { sheetName: s.properties.title, sheetId: s.properties.sheetId };
    });
    return {
      status: 'success',
      data: {
        bookId: bookId,
        bookName: VOCAB_BOOK_NAME,
        bookUrl: sheetUrl_(bookId),
        modifiedTime: meta && meta.modifiedTime ? meta.modifiedTime : '',
        sheets: sheets
      }
    };
  }

  async function opGetVocabSheetFingerprint_(payload) {
    const sheetName = payload.sheetName;
    if (!sheetName) throw new Error('sheetName は必須です。');
    const bookId = await getVocabBookId_();
    const colA = await sheetsValuesGet_(bookId, sheetName + '!A:A');
    const fp = fingerprintFromSerialColumn_(colA);
    const wordCount = parseInt(String(fp).split(':')[0], 10) || 0;
    return {
      status: 'success',
      data: { sheetName: sheetName, fingerprint: fp, wordCount: wordCount }
    };
  }

  async function opGetSetCacheLog_() {
    const bookId = await getLogBookId_();
    await ensureLogBookReady_(bookId);
    const values = await sheetsValuesGet_(bookId, SET_CACHE_LOG_SHEET + '!A:H');
    if (values.length <= 1) return { status: 'success', data: [] };
    const headers = values[0];
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const obj = rowToObj_(headers, values[i]);
      if (!obj.Set_ID) continue;
      rows.push({
        Set_ID: obj.Set_ID || '',
        Set_Name: obj.Set_Name || '',
        Kind: obj.Kind || 'user_vocab',
        Cache_Loaded_At: obj.Cache_Loaded_At || '',
        Source_Modified_At: obj.Source_Modified_At || '',
        Fingerprint: obj.Fingerprint || '',
        Word_Count: obj.Word_Count || '',
        Last_Studied_At: obj.Last_Studied_At || ''
      });
    }
    return { status: 'success', data: rows };
  }

  async function opUpsertSetCacheLog_(payload) {
    const entry = payload || {};
    const setId = entry.Set_ID || buildSetId_(entry.sheetName);
    if (!setId) throw new Error('Set_ID は必須です。');
    const bookId = await getLogBookId_();
    await ensureSetCacheLogSheet_(bookId);
    const values = await sheetsValuesGet_(bookId, SET_CACHE_LOG_SHEET + '!A:H');
    const headers = values.length ? values[0] : SET_CACHE_LOG_HEADERS;
    const idCol = headers.indexOf('Set_ID');
    let existingRow = -1;
    let existing = {};
    for (let r = 1; r < values.length; r++) {
      if (String(values[r][idCol] || '') === String(setId)) {
        existingRow = r + 1;
        existing = rowToObj_(headers, values[r]);
        break;
      }
    }
    const merged = {
      Set_ID: setId,
      Set_Name: entry.Set_Name || existing.Set_Name || entry.sheetName || '',
      Kind: entry.Kind || existing.Kind || 'user_vocab',
      Cache_Loaded_At: entry.Cache_Loaded_At != null ? entry.Cache_Loaded_At : (existing.Cache_Loaded_At || ''),
      Source_Modified_At: entry.Source_Modified_At != null ? entry.Source_Modified_At : (existing.Source_Modified_At || ''),
      Fingerprint: entry.Fingerprint != null ? entry.Fingerprint : (existing.Fingerprint || ''),
      Word_Count: entry.Word_Count != null ? entry.Word_Count : (existing.Word_Count || ''),
      Last_Studied_At: entry.Last_Studied_At != null ? entry.Last_Studied_At : (existing.Last_Studied_At || '')
    };
    const row = SET_CACHE_LOG_HEADERS.map(function (h) { return merged[h] != null ? merged[h] : ''; });
    if (existingRow > 0) {
      await sheetsValuesUpdate_(bookId, SET_CACHE_LOG_SHEET + '!A' + existingRow + ':H' + existingRow, [row]);
    } else {
      await sheetsValuesAppend_(bookId, SET_CACHE_LOG_SHEET + '!A:H', [row]);
    }
    return { status: 'success', data: merged };
  }

  async function opGetVocabCatalog_(payload) {
    const light = !!(payload && payload.light);
    const bookId = await getVocabBookId_();
    const ss = await sheetsGet_(bookId);
    const sheetInfos = [];
    for (let i = 0; i < (ss.sheets || []).length; i++) {
      const name = ss.sheets[i].properties.title;
      if (light) {
        sheetInfos.push({ sheetName: name, wordCount: null, divisions: { dai: [], chu: [], sho: [] }, light: true });
      } else {
        const values = await sheetsValuesGet_(bookId, name + '!A:V');
        sheetInfos.push(buildSheetInfo_(name, values));
      }
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

  function pickLogField_(obj, names) {
    for (let i = 0; i < names.length; i++) {
      const v = obj[names[i]];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  }

  function normalizeSessionLog_(obj) {
    const detailRaw = pickLogField_(obj, ['詳細', 'Detail', 'detail']);
    let detail = {};
    if (detailRaw) {
      try { detail = typeof detailRaw === 'string' ? JSON.parse(detailRaw) : (detailRaw || {}); }
      catch (e) { detail = {}; }
    }
    const setName = pickLogField_(obj, ['学習セット名', 'Set_Name', 'setName'])
      || detail.Set_Name || detail.setName || '';
    const mode = pickLogField_(obj, ['モード', 'Mode', 'mode']) || detail.Mode || detail.mode || '';
    const score = pickLogField_(obj, ['正答率', 'Score', 'score']);
    const duration = pickLogField_(obj, ['解答時間', 'Duration_Sec', 'durationSec', 'timeTaken']);
    return {
      'タイムスタンプ': pickLogField_(obj, ['タイムスタンプ', 'Timestamp', 'timestamp']),
      '学習セット名': setName,
      'モード': mode,
      '正答率': score !== '' ? score : (detail.Score != null ? detail.Score : ''),
      '解答時間': duration !== '' ? duration : (detail.Duration_Sec != null ? detail.Duration_Sec : ''),
      '詳細': typeof detailRaw === 'string' ? detailRaw : (detailRaw ? JSON.stringify(detailRaw) : JSON.stringify(obj))
    };
  }

  async function opGetLearningLogs_() {
    const bookId = await getLogBookId_();
    await ensureLogBookReady_(bookId);
    const values = await sheetsValuesGet_(bookId, SESSION_LOG_SHEET + '!A:F');
    if (values.length <= 1) return { status: 'success', data: [] };
    const headers = values[0];
    const logs = [];
    for (let i = values.length - 1; i >= 1 && logs.length < 50; i--) {
      logs.push(normalizeSessionLog_(rowToObj_(headers, values[i])));
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
    const detailIdx = headers.indexOf('詳細');
    let count = 0;
    for (let i = 1; i < values.length; i++) {
      const name = setIdx >= 0 ? String(values[i][setIdx] || '') : '';
      if (name === String(setId || '')) {
        count++;
        continue;
      }
      if (detailIdx >= 0) {
        try {
          const d = JSON.parse(values[i][detailIdx] || '{}');
          if (d && (String(d.setId || '') === String(setId || '') || String(d.Set_Name || d.setName || '') === String(setId || ''))) {
            count++;
          }
        } catch (e) {}
      }
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
        case 'getVocabCatalog': return await opGetVocabCatalog_(payload || {});
        case 'getVocabWords': return await opGetVocabWords_(payload || {});
        case 'registerVocabWords': return await opRegisterVocabWords_(payload || {});
        case 'getLearningLogs': return await opGetLearningLogs_();
        case 'getItemStates': return await opGetItemStates_(payload || {});
        case 'upsertItemStates': return await opUpsertItemStates_(payload || {});
        case 'saveSessionLog': return await opSaveSessionLog_(payload || {});
        case 'startSession': return await opStartSession_(payload || {});
        case 'countSessionAttempts': return await opCountSessionAttempts_(payload || {});
        case 'getVocabBookMeta': return await opGetVocabBookMeta_();
        case 'getVocabSheetFingerprint': return await opGetVocabSheetFingerprint_(payload || {});
        case 'getSetCacheLog': return await opGetSetCacheLog_();
        case 'upsertSetCacheLog': return await opUpsertSetCacheLog_(payload || {});
        default: return { status: 'error', message: '未対応の op: ' + op };
      }
    } catch (e) {
      return { status: 'error', message: String(e.message || e) };
    }
  }

  return {
    isEnabled: isEnabled_,
    hasCachedToken: hasCachedToken_,
    ensureAuthorized: ensureAuthorized_,
    ensureUserDataEnvironment: ensureUserDataEnvironment_,
    retryAuthorization: retryAuthorization_,
    consumeOAuthRedirect: consumeOAuthRedirect_,
    clearAuth: clearAuth_,
    getRedirectUri: getRedirectUri_,
    refreshSoftTtlMs: getRefreshSoftTtlMs_,
    dispatch: dispatch_
  };
})();

window.UserDriveModule = UserDriveModule;
