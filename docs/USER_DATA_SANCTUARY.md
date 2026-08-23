# ユーザーデータ聖域 — マイ単語帳・学習記憶の設計契約

> **この領域は開発中に最も壊れやすい。** リファクタ・レガシー排除・認証変更の前に必ず本書を読むこと。  
> Cursor 向けの短い禁止事項は `.cursor/rules/user-data-sanctuary.mdc` を参照。

---

## 1. 聖域の範囲（触る前に確認）

| ファイル | 役割 |
|---|---|
| `docs/user-drive.js` | Drive/Sheets REST API の**唯一の実装**（フォルダ作成・単語登録・学習状態・ログ） |
| `docs/index.html` | `AuthGateService` / `UserBridge` / `SendOutbox` / `ItemStateModule` / `VocabRegisterModule` / `onLoginSuccess` |
| `docs/config.js` | `GOOGLE_CLIENT_ID` / `GOOGLE_DRIVE_SCOPES` / `DASHBOARD_URL`（認証用） |

**GAS 側（`code.gs`）にはユーザー Drive 操作を書かない。** 2026-08 以降、`queueUserOp` / `userBridge` / `apiUser*` は廃止済み。

---

## 2. あるべきアーキテクチャ（現行・固定）

```text
【ログイン】Pages → GAS①（?action=auth）→ AuthGateService（authToken のみ）

【ユーザー操作】Pages → UserBridge → UserDriveModule → GCP OAuth → Drive/Sheets API
  ├─ 単語登録     registerVocabWords
  ├─ 学習状態     getItemStates / upsertItemStates
  ├─ セッションログ saveSessionLog / startSession / countSessionAttempts
  └─ 単語読取     getVocabCatalog / getVocabWords / getLearningLogs

【プリセット教材】manifest / GAS② API（ユーザー Drive とは無関係）
```

### 二つの認証を混同しない

| 種類 | 保存キー | 用途 | 取得方法 |
|---|---|---|---|
| **アプリログイン** | `digitaldrill_auth_token` 等 | ホワイトリスト・UI 表示 | GAS① 認証 |
| **Drive OAuth** | `dd_google_access_token:<account>` 等 | マイドライブ読み書き | GIS `initTokenClient` |

ログイン成功 ≠ Drive 権限済み。`onLoginSuccess` で `UserDriveModule.ensureAuthorized()` を呼び、失敗時はトーストで Drive 許可を促す。

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
              └── 学習記録             ← SESSION_LOG_SHEET
```

- アプリ親フォルダ（`grammarquizzes/` 等）内にユーザー資料を置かない
- GAS「ユーザーとして実行」経由の保存先フォールバックは**復活させない**（フォルダ不一致でデータが見えなくなる）

メタデータ（folderId / vocabBookId / logBookId）は `dd_user_drive_meta:<account>` に JSON 保存。

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
| `startSession` / `countSessionAttempts` | | セッション管理 |

書込 op は `USER_BRIDGE_WRITE_OPS` に登録し、`SendOutbox` でオフライン再送対象にする。

### 直列化

`UserBridge._chain` で op を直列実行。並列化やバypass しない。

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
- 空欄の正規化: `(未登録)` = `UNREGISTERED`
- 意味列: `意味＠名詞` 〜 `意味＠熟語・慣用表現` のいずれか1つ以上必須

列構成を変える場合は **同時に** `docs/gem_system_prompt.md` も更新（`.cursor/rules/keep-generator-prompts-in-sync.mdc`）。

---

## 6. OAuth トークン（過去に壊れた原因）

### 必須ルール

1. **アカウント別キー**を使う: `dd_google_access_token:<account>` / `dd_google_token_expiry:<account>`
2. **`migrateLegacyToken_()` を削除しない** — 旧グローバルキー `dd_google_access_token` からの移行
3. **`ensureAuthorized_()`** — 期限切れ時はサイレント更新 → 失敗したら `consent` で再取得
4. キー形式変更時は**必ず移行処理**を添える（移行なしのキー変更は禁止）

### account サフィックス

`AuthGateService.getUser().account` を小文字化し `[a-z0-9@._+-]` 以外を `_` に置換。

---

## 7. 変更してよい / してはいけない

### ✅ してよい

- エラーメッセージの改善（`drive_auth_required` 等）
- 単語登録 UI の UX 改善（`VocabRegisterModule` 内、契約を守る範囲）
- 新 op の追加（`dispatch_` + 本書 + cursor rule を同時更新）

### ❌ してはいけない（過去の障害パターン）

| 禁止 | 起きたこと |
|---|---|
| GAS iframe / `queueUserOp` へのフォールバック復活 | 保存先フォルダ不一致・640行の二重経路 |
| OAuth キー変更 without 移行 | 再認証ループ・登録不能 |
| `UserBridge.queueOp` の try/catch 削除 | OAuth 拒否が未処理例外に |
| `dispatch_` が throw のみ（status 返却なし） | UI が「登録失敗」の詳細を失う |
| 保存先をマイドライブ以外に変更 | 既存ユーザーのデータが見えなくなる |
| `code.gs` にユーザー Drive 操作を再実装 | 聖域の二重化 |

---

## 8. 変更時チェックリスト

機能変更・リファクタ前:

- [ ] 本書 §2 のデータフロー図と矛盾しないか
- [ ] 保存先が `DigitalDrill_MyData`（マイドライブ直下）のままか
- [ ] ログイン（GAS①）と Drive OAuth が分離されているか
- [ ] `UserBridge.call` の戻りが `{ status, message? }` 形式か
- [ ] 書込 op が `USER_BRIDGE_WRITE_OPS` / `SendOutbox` に載っているか
- [ ] トークンキー変更時に `migrateLegacyToken_` 相当があるか

デプロイ後の手動確認:

1. ログイン → Drive 権限ダイアログ（初回 or 期限切れ時）
2. マイページ → 簡易登録で1語追加 → 「登録しました」
3. 「マイ単語帳を開く」リンク → 該当シートに行がある
4. プリセット学習終了 → 学習状態が Drive `学習状態` に反映

---

## 9. トラブルシューティング

| 症状 | 第一疑い | 確認 |
|---|---|---|
| ログインはできるが登録できない | Drive OAuth 未許可 | Console / 「登録エラー:」全文。`drive_auth_required` |
| 以前動いていたのに突然不可 | トークンキー変更 | DevTools → Application → localStorage の `dd_google_*` |
| 登録成功だが単語が見えない | 別フォルダに保存 | Drive で `DigitalDrill_MyData` の場所を確認 |
| `Drive API が未設定` | config 未反映 | `GOOGLE_CLIENT_ID` が Pages にデプロイされているか |

---

## 10. 関連ドキュメント

| ファイル | 内容 |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | デプロイ・認証フロー・データモデル |
| [HANDOVER.md](HANDOVER.md) | コミット・push・clasp 手順 |
| `.cursor/rules/user-data-sanctuary.mdc` | AI 向け短い禁止事項 |

---

## 更新履歴

| 日付 | 内容 |
|---|---|
| 2026-08-23 | 初版（Drive API 一本化後の聖域化。トークン移行・GAS フォールバック削除事故を反映） |
