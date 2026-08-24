# DigitalDrill（デジドリ） デプロイ手順

## 構成概要

| コンポーネント | 配置 | 実行権限 | 役割 |
|---|---|---|---|
| **GitHub Pages** | `docs/index.html` | 静的 | 学習UI（文法・単語・音読・マイページ）・STT |
| **GAS①** | `dashboard.html` | **アクセスしているユーザー** | 認証ゲート（whitelist） |
| **GAS②** | JSON API | **作成者（自分）** | プリセット配布・setup・認証 |

同一 GAS プロジェクトから **2つのウェブアプリデプロイ** を作成します。

```text
Pages（学習UI）
  ├─ fetch → GAS②（プリセット読取・認証）
  ├─ no-cors POST → Google フォーム（プリセット学習概要のみ）
  └─ GCP OAuth → Drive/Sheets API（UserDriveModule：マイ単語帳・学習記憶）

GAS① 管理者ダッシュボード（管理者のみ）
  └─ フォーム回答シート・whitelist 閲覧
```

> マイ単語帳・学習記憶の設計契約は [USER_DATA_SANCTUARY.md](USER_DATA_SANCTUARY.md) を参照。

---

## 1. GAS コードのデプロイ

```bash
clasp push
```

---

## 2. GAS②（作成者権限・JSON API）デプロイ

- **実行ユーザー**: 自分
- **アクセス**: 全員（匿名ユーザーを含む）
- exec URL → `docs/config.js` の `API_URL`

---

## 3. GAS①（ユーザー権限）デプロイ

- **実行ユーザー**: **アクセスしているユーザー**
- **アクセス**: Google アカウントを持つ全員
- exec URL → `docs/config.js` の `DASHBOARD_URL`

学習者は **GitHub Pages** を利用します。GAS① URL は認証（`?action=auth`）用です。

---

## 4. GitHub Pages

Settings → Pages → Branch: `main` / Folder: `/docs`

---

## 5. config.js

```javascript
window.DIGITALDRILL_CONFIG = {
  API_URL: '...GAS②.../exec',
  DASHBOARD_URL: '...GAS①.../exec',
  STATIC_MANIFEST_URL: 'data/manifest.json',
  GOOGLE_FORM: {
    ACTION_URL: 'https://docs.google.com/forms/d/e/.../formResponse',
    ENTRIES: {
      User_ID: 'entry.xxxxx',
      Mode: 'entry.xxxxx',
      Set_ID: 'entry.xxxxx',
      Set_Name: 'entry.xxxxx',
      Attempt_No: 'entry.xxxxx',
      Correct: 'entry.xxxxx',
      Total: 'entry.xxxxx',
      Score: 'entry.xxxxx',
      Duration_Sec: 'entry.xxxxx',
      Started_At: 'entry.xxxxx',
      Ended_At: 'entry.xxxxx'
    }
  }
};
```

`ACTION_URL` が空のときはフォーム送信をスキップします（フォーム未作成でもアプリは動作します）。

### プリセット取得はハイブリッド（`PresetModule`）

取得元の切り替え設定はありません。次の順に、使えるものを使います。

| 順 | 取得元 | 速さ | 使う条件 |
|---|---|---|---|
| 1 | localStorage キャッシュ | 即時・通信なし | 教材の版が変わるまで |
| 2 | Pages の `manifest.json` | 即時（CDN・GAS② に触らない） | manifest の版が現行版と一致 |
| 3 | GAS② JSON API | 通信あり | manifest が古い／manifest に無い教材／絞り込み指定あり |

初回アクセスでも `manifest.json` から即座に描画され、教材を更新しない限り
2回目以降はキャッシュのみで完結します（GAS② への通信は版チェック 1 回だけ）。

### 教材更新の検知

- GAS② `?action=presetVersion` が **教材の版**（grammarquizzes / vocabulary 配下の
  スプレッドシートの最終更新時刻から算出した MD5）を返します。
- サーバー側は CacheService に 120 秒キャッシュするため、同時接続数が増えても
  Drive の走査は最大 30回/時 に収まります。
- クライアントは画面表示後に 1 回だけ問い合わせ、版が変わっていたときだけ
  キャッシュを破棄して再取得し、設定画面を描き直します（学習中は次にセット選択へ
  戻ったときに反映）。
- 手動で更新したい場合は学習画面の「キャッシュ更新」ボタン。

教材を更新したら `scripts/export-static.ps1` を再実行して `manifest.json` も作り直してください。
再生成するまでは版が食い違うため、その教材だけ GAS② API 経由になります。

---

## 6. UserBridge / UserDriveModule（ユーザーDrive 操作）

**GAS iframe 経由は廃止。** Pages 上の `UserDriveModule`（`docs/user-drive.js`）が GCP OAuth で Drive/Sheets API を直接呼びます。

```text
UserBridge.call(op, payload)
  → UserDriveModule.ensureAuthorized()   // Drive OAuth（ログインとは別）
  → UserDriveModule.dispatch(op, payload)
  → マイドライブ/DigitalDrill_MyData/…
```

対応 op: `getVocabCatalog`, `getVocabWords`, `registerVocabWords`, `getLearningLogs`, `getItemStates`, `upsertItemStates`, `saveSessionLog`, `startSession`, `countSessionAttempts`

書込 op（`registerVocabWords`, `upsertItemStates`, `saveSessionLog`）は失敗時 `SendOutbox` に残り、次回ログイン時に再送されます。

詳細・禁止事項: [USER_DATA_SANCTUARY.md](USER_DATA_SANCTUARY.md)

---

## 7. データモデル

### ユーザー層（細粒度）— ユーザーDrive `DigitalDrill学習記録` / シート `学習状態`

| 列 | 説明 |
|---|---|
| Item_ID | 文法 rowId / 単語 book\|sheet\|通し番号 |
| Kind | grammar / vocab |
| Set_ID | 教材識別子 |
| Total_Attempts / Total_Wrong | 累計 |
| Recent_Bits | 直近16回正誤（下位5ビットで直近5回正答率） |
| Last_Seen | UNIX秒 |
| Step_Index, EF, Next_Review, Avg_Time | SRS（単語） |

クライアント側の保管場所は `localStorage['digitaldrill_item_state']` の1箇所のみです。
`ItemStateModule` が唯一の読み書き口で、`SrsModule` は出題間隔の計算だけを担当します。
セッション終了時に未反映（dirty）の Item_ID だけを UserBridge 経由で Drive へ送ります。

### 管理者層（粗粒度）— Google フォーム回答先 SS

Forms が自動付与する「タイムスタンプ」に加え、短答質問（質問タイトル = 列名）で次を送ります。

User_ID, Mode, Set_ID, Set_Name, Attempt_No, Correct, Total, Score, Duration_Sec, Started_At, Ended_At

- **送信対象**: 管理者プリセットの文法・単語学習のみ（マイ単語帳・音読は送らない）
- **書き込み**: Pages → GAS② `submitFormSummary` → Google フォーム `formResponse`（fbzx トークン付き）。GAS 同時実行上限を回避しつつ確実に到達
- **反映**: フォーム回答先 SS に即時追記（バッチ・トリガー不要）
- **閲覧**: GAS① 管理者ダッシュボード、または SS を直接開く（制限付き共有）

#### フォーム初回セットアップ（手動）

1. Google フォームで上記列名の**短答**質問を作成（すべて必須推奨）
2. 回答先を本体 SS（`DigitalDrill`）または GAS が開ける SS に設定
3. フォームの「ページソース」から `formResponse` URL と各 `entry.xxxxx` を `docs/config.js` の `GOOGLE_FORM` に設定
4. フォームは「リンクを知っている人が回答可」等。回答先 SS は**制限付き共有**（学習者を編集者にしない）
5. 確認画面に SS URL を出さない
6. （任意）Script Property `FORM_RESPONSE_SHEET` に回答シート名を設定。未設定時は `フォームの回答` で始まるシート、または見出し `User_ID` があるシートを自動検出

---

## 8. 静的プリセット export

```powershell
.\scripts\export-static.ps1
# または Deploy All with -ExportStatic
.\scripts\deploy-all.ps1 -ExportStatic
```

GAS② `?action=exportStatic` から `docs/data/manifest.json` を生成します。

---

## 9. 認証フロー

### アプリログイン（GAS①）

1. Pages「Googleアカウントでログイン」→ GAS① `?action=auth`
2. whitelist 照合 → `auth` トークン → Pages `?auth=TOKEN`
3. `AuthGateService` が localStorage に保持

### Drive OAuth（UserDriveModule）

1. ログイン成功後、`onLoginSuccess` で `UserDriveModule.ensureUserDataEnvironment()` を実行
2. **フォルダ `DigitalDrill_MyData`・`マイ単語帳`・`DigitalDrill学習記録` がなければ自動作成**
3. 初回 or 期限切れ時、Google の Drive/Sheets 権限ダイアログを表示
4. トークンは `dd_google_access_token:<account>` に保存（アカウント別）

**ログイン成功だけでは単語登録できない。** Drive 権限の許可が別途必要。許可後は上記3点がマイドライブ直下に作られる。

---

## 10. 一括反映

| タスク | 内容 |
|---|---|
| Deploy All | clasp push → GAS①② → git push |
| `-ExportStatic` | 上記 + manifest.json 生成 |

---

## 同時接続への備え

同時接続数の上限に当たったときだけ再試行します（それ以外のフォールバックは持ちません）。

| 箇所 | 挙動 |
|---|---|
| Pages → GAS②（版チェック・プリセット取得・認証） | HTTP 429 / 5xx とネットワークエラーに限り、指数バックオフで最大4回リトライ（約1s / 2s / 4s + ジッター） |
| Pages → Google フォーム（プリセット概要） | `no-cors` POST。ネットワークエラー以外は成功扱い。GAS 同時実行を消費しない |
| 教材の配布 | 通常は Pages の `manifest.json`（CDN）とローカルキャッシュで完結し、GAS② には版チェックの 1 リクエストしか出さない |
| 学習状態の Drive 同期 | 送信に失敗した Item_ID は dirty のまま残り、次のセッション終了時に再送 |

---

## トラブルシューティング

- **単語登録・学習記憶が保存されない**: [USER_DATA_SANCTUARY.md](USER_DATA_SANCTUARY.md) §9 を参照。Drive OAuth 未許可が最多。`GOOGLE_CLIENT_ID` が Pages に反映されているか確認
- **セッション集約が空**: フォーム回答先 SS に行が入っているか、`config.js` の `GOOGLE_FORM` が正しいか確認。**GAS② を再デプロイ**（`submitFormSummary` 必須）。プリセット学習（マイ単語帳以外）で終了しているか
- **教材の更新が反映されない**: サーバー側の版キャッシュ（120秒）が切れるのを待つか「キャッシュ更新」ボタン
- **初回表示が遅い**: `docs/data/manifest.json` が未生成。`scripts/export-static.ps1` を実行
