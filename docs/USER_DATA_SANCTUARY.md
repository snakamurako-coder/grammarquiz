# ユーザーデータ聖域 — マイ単語帳・学習記憶の設計契約

> **この領域は開発中に最も壊れやすい。** リファクタ・レガシー排除・認証変更の前に必ず本書を読むこと。  
> Cursor 向けの短い禁止事項は `.cursor/rules/user-data-sanctuary.mdc` を参照。

---

## 0. 動作確認済みスナップショット（2026-08-27）

| 項目 | 値 |
|---|---|
| **確認** | ログインと Drive 許可を **1回のリダイレクト OAuth（openid + Drive）** に一本化。GAS経由は予備。Drive バナーは再接続用 |
| 実装の正 | Pages → 統一ログイン（PKCE）→ id_token で GAS whitelist → Drive tokens → UserBridge → Drive/Sheets REST |
| 保存先 | マイドライブ直下 `DigitalDrill_MyData/` → `マイ単語帳` / `DigitalDrill学習記録` |
| 初回接続 UI | ログイン画面 **「Googleでログイン（Drive含む）」**。失敗・GAS経由時のみマイページに「Drive を接続」 |

### 効いている設定・実装要点（壊したら戻す）

1. **存在確認は `files.get`** — `driveVerifyFolder_` / `driveVerifyOwnedInFolder_`。`files.list` の `q=id='…'` は **Drive API 非対応**で常に失敗する（過去の主因）。
2. **ログイン ≠ Drive 許可** — アプリログイン（GAS① `authToken`）と Drive OAuth（`dd_google_access_token:<account>` / `dd_google_refresh_token:<account>`）は別物。
3. **ポップアップ禁止・自動 OAuth 禁止** — Drive 許可は **同タブ・リダイレクト**（PKCE）。`prepareDriveAfterLogin_()` は:
   - access 有効 or refresh あり → `ensureUserDataEnvironment({ interactive: false })`（サイレント refresh）
   - なし → 「Drive を接続」バナーのみ（ユーザー操作でリダイレクト）
4. **`ensureAuthorized_({ interactive })` の既定は false** — `true` は「Drive を接続」ボタンのみ。`UserBridge.call` も既定非対話（ログイン直後の同期で Google へ飛ばない＝無限ループ防止）。
5. **メタ／トークンはアカウント別キー** — `dd_user_drive_meta:<account>` / `dd_google_access_token:<account>` / `dd_google_refresh_token:<account>` + pending キー + migrate。
6. **GAS①・GAS② にユーザー Drive のフォルダ操作を書かない** — 作成・読み書きは Pages の REST のみ。**例外**: Web OAuth は `client_secret` 必須のため、認可コード交換／refresh だけは GAS②（Script Properties の `CLIENT_SECRET`）経由。秘密は Pages に置かない。
7. **GCP リダイレクト URI** — `GOOGLE_OAUTH_REDIRECT_URI` または `origin+pathname` を「承認済みのリダイレクト URI」に登録。
8. **約1ヶ月の再同意なし** — `refresh_token` で access を更新。OAuth 同意画面が **テスト** のままだと Google 側で refresh が **7日** で失効する。1ヶ月以上狙うなら同意画面を **本番** にする。
9. **OAuth 再突入ガード** — リダイレクト開始〜復帰直後は自動の対話 OAuth を拒否（無限ループ防止）。

### 運用時の確認手順（デプロイ後）

1. GCP に Pages のリダイレクト URI を登録
2. **GAS①② の Script Properties に `CLIENT_SECRET`**（GCP OAuth クライアントのシークレット）を登録し、Deploy All
3. Pages をハードリロード
4. ログイン（統一ログインまたは GAS① 経由）
5. 未接続時のみプロフィール下 **「Drive を接続」** → 同じタブで Google の Drive/Sheets 許可 → Pages に戻る
6. マイドライブに `DigitalDrill_MyData` / `マイ単語帳` / `DigitalDrill学習記録` がある
7. マイページに学習記録が出る／単語の「マイ単語帳」が選べる
8. ブラウザを閉じたあと再度開いても、バナーなしで Drive が使える（refresh 有効時）

### よくある切り分け

| 見え方 | 解釈 |
|---|---|
| Form 集計 SS には行があるがマイページが空 | **正常な別経路**。Form 成功 ≠ Drive 成功。まず「Drive を接続」 |
| GAS① ダッシュボードは動くがマイフォルダが無い | GAS① はユーザー Drive を作らない。Pages の OAuth を見る |
| `redirect_uri_mismatch` | GCP のリダイレクト URI と Pages の URL が不一致 |
| 約1週間で再接続を求められる | 同意画面がテストモード。本番化で長期 refresh が可能 |
| 「組織の権限」に見える | 多くは OAuth 未接続や URI 不一致。ボタン経由で再許可 |

---

## 1. 聖域の範囲（触る前に確認）

| ファイル | 役割 |
|---|---|
| `docs/user-drive.js` | Drive/Sheets REST API の**唯一の実装**（フォルダ作成・単語登録・学習状態・ログ） |
| `docs/index.html` | `AuthGateService` / `UserBridge` / `SendOutbox` / `ItemStateModule` / `VocabRegisterModule` / `onLoginSuccess` / `prepareDriveAfterLogin_` / 「Drive を接続」 |
| `docs/config.js` | `GOOGLE_CLIENT_ID` / `GOOGLE_DRIVE_SCOPES` / `DASHBOARD_URL`（認証用） |

**GAS 側（`code.gs`）にはユーザー Drive 操作を書かない。** 2026-08 以降、`queueUserOp` / `userBridge` / `apiUser*` は廃止済み。

---

## 2. あるべきアーキテクチャ（現行・固定）

```text
【ログイン（推奨）】Pages「Googleでログイン（Drive含む）」
  → 同タブ OAuth（openid + Drive、PKCE・offline）
  → id_token で GAS② login（whitelist）→ AuthGateService
  → Drive access/refresh 保存 → ensureUserDataEnvironment

【ログイン（予備）】Pages → GAS①（?action=auth）→ AuthGateService
  → Drive 未接続なら「Drive を接続」（同タブ・リダイレクト）

【ユーザー操作】Pages → UserBridge → UserDriveModule → access/refresh → Drive/Sheets API
```

### 二つの認証を混同しない

| 種類 | 保存キー | 用途 | 取得方法 |
|---|---|---|---|
| **アプリログイン** | `digitaldrill_auth_token` 等 | ホワイトリスト・UI 表示 | 統一ログインの id_token → GAS、または GAS① |
| **Drive OAuth** | `dd_google_*` | マイドライブ読み書き | 統一ログインで同時取得。切れ時は「Drive を接続」 |

ログイン成功 ≠ Drive 権限済み。詳細は §0。

---

## 3. Drive 上の保存先（変更禁止）

すべて **利用者のマイドライブ直下** に固定する。

```text
マイドライブ/
  └── DigitalDrill_MyData/          ← FOLDER_NAME（user-drive.js）
        ├── マイ単語帳               ← VOCAB_BOOK_NAME（スプレッドシート）
        │     └── シート「デフォルト」等  ← ユーザーが指定する sheetName
        └── DigitalDrill学習記録     ← LOG_BOOK_NAME
              ├── 学習状態             ← ITEM_STATE_SHEET
              ├── 学習記録             ← SESSION_LOG_SHEET
              └── 学習セット更新記録   ← SET_CACHE_LOG_SHEET（ローカルキャッシュ読込履歴）
```

- アプリ親フォルダ（`grammarquizzes/` 等）内にユーザー資料を置かない
- GAS「ユーザーとして実行」経由の保存先フォールバックは**復活させない**（フォルダ不一致でデータが見えなくなる）

メタデータ（folderId / vocabBookId / logBookId）は `dd_user_drive_meta:<account>` に JSON 保存。

### 自動作成（ensureUserDataEnvironment）

`getVocabBookId_` / `getLogBookId_` / `ensureFolder_` が **Drive 接続後**に作成する。  
ログイン直後は `prepareDriveAfterLogin_()`（キャッシュありなら非対話、なしならバナー）。

| 処理 | 関数 |
|---|---|
| フォルダ作成 | `ensureFolder_()`（存在確認は `files.get`） |
| マイ単語帳 SS 作成 + デフォルトシート | `ensureSpreadsheet_(…, VOCAB_BOOK_NAME, setupVocabBook_)` |
| 学習記録 SS 作成 + シート初期化 | `ensureSpreadsheet_(…, LOG_BOOK_NAME, setupLogBook_)` |

`setupLogBook_` はシート「学習状態」だけがある既存ブックでも、必ずシート「学習記録」を用意する（ヘッダーに「タイムスタンプ」が無ければ書き直す）。

---

## 4. UserBridge 契約

### 入口

```javascript
const result = await UserBridge.call('registerVocabWords', { sheetName, rows });
// result.status === 'success' | 'error'
// 例外を投げず { status: 'error', message } を返すこと（dispatch / queueOp 両方）
```

### 対応 op（追加・削除は本書も更新）

| op | 書込 | 説明 |
|---|---|---|
| `registerVocabWords` | ✓ | マイ単語帳へ行追加 |
| `upsertItemStates` | ✓ | 学習状態シート更新 |
| `saveSessionLog` | ✓ | 学習記録シート追記 |
| `getVocabCatalog` | | シート一覧 |
| `getVocabWords` | | 単語プール取得 |
| `getItemStates` | | 学習状態読取 |
| `getLearningLogs` | | ログ読取 |
| `getVocabBookMeta` | | マイ単語帳 modifiedTime・シート名一覧（軽量） |
| `getVocabSheetFingerprint` | | 通し番号列だけの指紋（軽量新旧判定） |
| `getSetCacheLog` / `upsertSetCacheLog` | ✓(upsert) | 学習セット更新記録シート |
| `startSession` / `countSessionAttempts` | | セッション管理 |

書込 op は `USER_BRIDGE_WRITE_OPS` に登録し、`SendOutbox` でオフライン再送対象にする。

### 直列化

`UserBridge._chain` で op を直列実行。並列化やバypass しない。

---

## 4-a. プリセット教材の IndexedDB 契約（2026-08-28）

### 保管場所の分離

| データ | 保管 | キー例 |
|---|---|---|
| プリセット manifest | **IndexedDB** `digitaldrill_presets` | `manifests`: `{mode}:{hash}` / `meta`: `active`・`pending` |
| マイ単語帳 | **localStorage** | `dd_user_vocab_set:{シート名}` |
| 学習状態 | **localStorage** | `digitaldrill_item_state` |
| UI 設定・認証 | **localStorage** | 各 SETTINGS_KEY / `dd_google_*` |

**`dd_preset_*`（localStorage）は廃止。** 初回起動時に `PresetStore.migrateFromLegacyLocalStorage()` で削除する。

### 静的ファイル

`scripts/export-static.ps1` が生成:

- `docs/data/manifest-index.json` … 版と各モードの hash/path
- `docs/data/manifest-{mode}.{hash}.json` … manifest 本体（内容ハッシュ付き URL）

### 更新ポリシー

1. 起動後 `PresetModule.revalidate()` … index の版と active を比較
2. 新版あり → pending manifest をバックグラウンド取得（**active は維持**）
3. 設定画面バナー表示 → ユーザーが「キャッシュ更新」で pending → active
4. 学習セッション中は active を差し替えない

### 実装

- `docs/preset-store.js` … IndexedDB ラッパー
- `docs/index.html` … `PresetModule`

---

## 4-b. マイ単語帳のローカルキャッシュ契約（通信量抑制・2026-08-26）

### 方針

| 操作 | 挙動 |
|---|---|
| 学習開始（単語・音読） | **ローカルキャッシュのみ**。未キャッシュなら「キャッシュ更新」を促す |
| カタログ表示 | Drive はシート名だけ（`getVocabCatalog({ light: true })`）。語数・区分はキャッシュから補完 |
| 「キャッシュ更新」ボタン | プリセット再取得 ＋ マイ単語帳は**古い／未取得セットだけ**フル読込 |
| 「全学習セットを強制更新」（詳細設定） | 指紋判定を無視し、プリセット＋マイ単語帳**全シート**を取り直す |

### 新旧判定（軽量）

1. `getVocabBookMeta` でブックの `modifiedTime` を取得（1回）
2. ローカルの `sourceModifiedAt` より新しければ、当該シートの **通し番号列（A:A）だけ**取って指紋比較
3. 指紋が同じ → フル読込しない（他シート編集の誤検知を抑止）
4. 指紋が違う／未キャッシュ → `getVocabWords` でフル読込し localStorage（`dd_user_vocab_set:`）へ保存
5. 同時に Drive `学習セット更新記録` を upsert（Cache_Loaded_At / Source_Modified_At / Fingerprint / Last_Studied_At）

候補シート = 現在選択中 ＋ 既にローカルにあるもの ＋ 学習セット更新記録にあるもの（初回はブック内全シート）。

### 単語登録後

`registerVocabWords` 成功時はそのシートのローカルキャッシュを **invalidate**（次回はキャッシュ更新が必要）。

### 実装の正

- `docs/index.html` … `UserVocabCacheModule`
- `docs/user-drive.js` … `SET_CACHE_LOG_SHEET` / 関連 op

---

## 5. 単語登録フロー（壊れやすい経路）

```text
VocabRegisterModule.submitCard_
  → readSimpleRow / readFormRow（クライアント検証）
  → compactVocabRow_（空列除去）
  → UserBridge.call('registerVocabWords', …)
  → UserDriveModule.opRegisterVocabWords_
       → getVocabBookId_ → ensureVocabSheet_ → buildVocabRow_ → sheetsValuesAppend_
  → applyRegisterResult（bookUrl キャッシュ更新）
```

### 列契約

- ヘッダー定義の**正**: `user-drive.js` の `VOCAB_HEADERS`（22列）
- クライアント登録 UI: `VOCAB_REGISTER_FIELDS` / `VocabRegisterModule`
- 空欄の正規化: 学習セット（単語帳等）の空欄 sentinel は `×`（`UNREGISTERED`）。読込時に legacy `(未登録)` も `×` へ正規化する。
- 意味列: `意味＠名詞` 〜 `意味＠熟語・慣用表現` のいずれか1つ以上必須

列構成を変える場合は **同時に** `docs/gem_system_prompt.md` も更新（`.cursor/rules/keep-generator-prompts-in-sync.mdc`）。

---

## 6. OAuth トークン（過去に壊れた原因）

### 必須ルール

1. **アカウント別キー**を使う: `dd_google_access_token:<account>` / `dd_google_token_expiry:<account>` / `dd_google_refresh_token:<account>`
2. **`migrateLegacyToken_()` を削除しない** — 旧グローバルキーからの移行
3. **`ensureAuthorized_({ interactive })`** — 期限切れ時は refresh → 失敗したら（対話時のみ）リダイレクト。非対話経路ではリダイレクトしない
4. キー形式変更時は**必ず移行処理**を添える（移行なしのキー変更は禁止）
5. **ポップアップ型 `requestAccessToken` / Token Client は使わない** — 同タブ・リダイレクト + PKCE（§0）
6. **ページ読込直後の自動 OAuth 開始は禁止** — 「Drive を接続」ボタン経由
7. 起動時は `consumeOAuthRedirect` で `?code=` を処理してからセッション復帰

### account サフィックス

`AuthGateService.getUser().account` を小文字化し `[a-z0-9@._+-]` 以外を `_` に置換。

---

## 7. 変更してよい / してはいけない

### ✅ してよい

- エラーメッセージ・「Drive を接続」バナーの UX 改善（契約を守る範囲）
- 単語登録 UI の UX 改善（`VocabRegisterModule` 内）
- 新 op の追加（`dispatch_` + 本書 + cursor rule を同時更新）
- `files.get` の fields 調整・Drive list の `spaces=drive` 維持

### ❌ してはいけない（過去の障害パターン）

| 禁止 | 起きたこと |
|---|---|
| GAS iframe / `queueUserOp` へのフォールバック復活 | 保存先フォルダ不一致・二重経路 |
| OAuth キー変更 without 移行 | 再認証ループ・登録不能 |
| `UserBridge.queueOp` の try/catch 削除 | OAuth 拒否が未処理例外に |
| `dispatch_` が throw のみ（status 返却なし） | UI が「登録失敗」の詳細を失う |
| 保存先をマイドライブ以外に変更 | 既存ユーザーのデータが見えなくなる |
| `onLoginSuccess` でユーザー操作なしに OAuth 開始（リダイレクト含む） | GAS① 復帰直後に意図しない遷移・未接続 |
| GIS Token Client / ポップアップ OAuth の復活 | ポップアップブロックで接続失敗 |
| `files.list` の `q=id='…'` で存在確認 | 検証が常に失敗し meta が不安定 |
| `driveVerifyOwnedRootFolder_` 風の誤った root 判定のみ | meta が毎回消える |
| `code.gs` にユーザー Drive 操作を再実装 | 聖域の二重化。GAS①「が怪しい」時も戻さない |

---

## 8. 変更時チェックリスト

機能変更・リファクタ前:

- [ ] 本書 §0・§2 のデータフローと矛盾しないか
- [ ] 保存先が `DigitalDrill_MyData`（マイドライブ直下）のままか
- [ ] ログイン（GAS①）と Drive OAuth が分離されているか
- [ ] 存在確認が `files.get` か（`q=id=` を使っていないか）
- [ ] ログイン直後に自動 OAuth（リダイレクト含む）していないか（バナー＋ユーザー操作）
- [ ] Drive 接続が同タブ・リダイレクト（ポップアップでない）か
- [ ] `consumeOAuthRedirect` が起動時に走るか
- [ ] GCP リダイレクト URI が Pages URL と一致しているか
- [ ] `UserBridge.call` の戻りが `{ status, message? }` 形式か
- [ ] 書込 op が `USER_BRIDGE_WRITE_OPS` / `SendOutbox` に載っているか
- [ ] マイ単語帳の学習開始がキャッシュのみか（開始時に getVocabWords を呼ばないか）
- [ ] 「キャッシュ更新」が modifiedTime → 指紋 → 必要時のみフル読込か
- [ ] `学習セット更新記録` シートが setupLogBook で作られるか
- [ ] トークンキー変更時に `migrateLegacyToken_` 相当があるか

デプロイ後の手動確認: §0 の手順 1–5。

---

## 9. トラブルシューティング

| 症状 | 第一疑い | 確認 |
|---|---|---|
| ログインはできるが登録できない | Drive OAuth 未許可 | プロフィール下「Drive を接続」。Console / `drive_auth_required` |
| 以前動いていたのに突然不可 | トークンキー変更・期限切れ | DevTools → Application → localStorage の `dd_google_*` |
| 登録成功だが単語が見えない | 別フォルダに保存 | Drive で `DigitalDrill_MyData` の場所を確認 |
| `Drive API が未設定` | config 未反映 | `GOOGLE_CLIENT_ID` が Pages にデプロイされているか |
| フォルダ／学習記録が作れない・読めない | OAuth 未接続 or 検証回帰 | GAS① に戻さない。「Drive を接続」→ `DigitalDrill_MyData`。`files.get` のままか |
| Form は届くがマイページが空 | Drive 経路のみ失敗 | Form 成功 ≠ Drive 成功。§0 切り分け表 |
| GAS① ダッシュボードは動くがマイデータが無い | 経路の取り違え | ユーザー Drive は Pages のみ。Dashboard は作らない |
| マイ単語帳で開始できない | 未キャッシュ | 「キャッシュ更新」→ シートが「キャッシュ済」か確認 |

---

## 10. 関連ドキュメント

| ファイル | 内容 |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | デプロイ・認証フロー・データモデル |
| [HANDOVER.md](HANDOVER.md) | コミット・push・clasp・動作確認メモ |
| [FORM_AGGREGATION_SANCTUARY.md](FORM_AGGREGATION_SANCTUARY.md) | 管理者 Form 集約（別聖域） |
| `.cursor/rules/user-data-sanctuary.mdc` | AI 向け短い禁止事項 |

---

## 更新履歴

| 日付 | 内容 |
|---|---|
| 2026-08-27 | Web OAuth の client_secret 必須に対応。トークン交換／refresh を GAS②（Script Properties `CLIENT_SECRET`）経由に変更 |
| 2026-08-23 | ensureUserDataEnvironment・フォルダ検証修正・setupVocabBook 堅牢化 |
| 2026-08-27 | ログインと Drive 許可を1回のリダイレクト（openid+Drive）に一本化。GIS ボタン廃止。Drive バナーは再接続用 |
| 2026-08-27 | **致命修正**: UserBridge 既定を非対話化。ログイン直後の自動同期が Google へ飛ばす無限ループを解消。PKCE二重保管・pendingトークン・OAuth再突入ガード |
| 2026-08-27 | Drive OAuth を同タブ・リダイレクト + PKCE + refresh_token に変更（ポップアップ廃止・約1ヶ月再同意目標） |
| 2026-08-26 | Drive 検証を files.get に修正。「Drive を接続」ボタン。§0 動作確認済みを追記（修復成功） |
| 2026-08-26 | マイ単語帳ローカルキャッシュ・学習セット更新記録シート（§4-b）。開始はキャッシュのみ |
