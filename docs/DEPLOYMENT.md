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
  ├─ fetch → GAS②（プリセット読取・認証 login）
  ├─ POST → GAS submitFormSummary → Google フォーム（プリセット概要のみ）
  └─ GCP OAuth → Drive/Sheets API（UserDriveModule：マイ単語帳・学習記憶）

GAS①（ユーザー権限）
  ├─ 認証ゲート（?action=auth → Pages）
  └─ 管理者ダッシュボード（フォーム回答・whitelist）
```

> マイ単語帳・学習記憶: [USER_DATA_SANCTUARY.md](USER_DATA_SANCTUARY.md) §0（2026-08-26 修復・動作確認済み）  
> Google Form 集約: [FORM_AGGREGATION_SANCTUARY.md](FORM_AGGREGATION_SANCTUARY.md) §0（2026-08-26 動作確認済み）

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
  STATIC_MANIFEST_INDEX: 'data/manifest-index.json',
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

### プリセット取得はハイブリッド（`PresetModule` + `PresetStore`）

取得元の切り替え設定はありません。次の順に、使えるものを使います。

| 順 | 取得元 | 速さ | 使う条件 |
|---|---|---|---|
| 1 | IndexedDB（active manifest） | 即時・通信なし | 適用済みの版が端末に存在 |
| 2 | Pages の `manifest-index.json` + ハッシュ付き manifest | 初回のみ通信 | index から該当 hash の JSON を取得 |
| 3 | GAS② JSON API | 通信あり | manifest が無い／絞り込み指定あり |

**localStorage はプリセット教材に使いません**（マイ単語帳・設定・学習状態のみ）。

静的ファイル構成（`scripts/export-static.ps1` 生成）:

```text
docs/data/manifest-index.json
docs/data/manifest-grammar.{hash}.json
docs/data/manifest-vocab.{hash}.json
docs/data/manifest-reading.{hash}.json
docs/data/manifest-ai-conversation.{hash}.json
```

初回アクセスで index + 各モード manifest を取得し IndexedDB に保存します。
2回目以降は IndexedDB の active manifest から読み出します（GAS② への通信は版チェック 1 回だけ）。

### 教材更新の検知

- GAS② `?action=presetVersion` が **教材の版**（grammarquizzes / vocabulary 配下の
  スプレッドシートの最終更新時刻から算出した MD5）を返します。
- クライアントは画面表示後に 1 回だけ index の版と active を比較します。
- **版が新しい場合**: バックグラウンドで pending manifest を IndexedDB に取得するが、
  **active は即時切り替えしない**（学習中も現行版を維持）。
- 設定画面に更新バナーが出る。**「キャッシュ更新」** で pending → active に適用。
- 手動で更新したい場合も同じ「キャッシュ更新」ボタン。

教材を更新したら `scripts/export-static.ps1` を再実行して `manifest-index.json` と
ハッシュ付き manifest を作り直し、GitHub Pages に push してください。

---

## 6. UserBridge / UserDriveModule（ユーザーDrive 操作）

**GAS iframe 経由は廃止。** Pages 上の `UserDriveModule`（`docs/user-drive.js`）が GCP OAuth で Drive/Sheets API を直接呼びます。

```text
UserBridge.call(op, payload)
  → UserDriveModule.ensureAuthorized({ interactive })  // Drive OAuth（ログインとは別。「Drive を接続」経由）
  → UserDriveModule.dispatch(op, payload)
  → マイドライブ/DigitalDrill_MyData/…
```

存在確認は `files.get`（`q=id=` 禁止）。詳細は [USER_DATA_SANCTUARY.md](USER_DATA_SANCTUARY.md) §0。

対応 op: `getVocabCatalog`, `getVocabWords`, `registerVocabWords`, `getLearningLogs`, `getItemStates`, `upsertItemStates`, `saveSessionLog`, `startSession`, `countSessionAttempts`

書込 op（`registerVocabWords`, `upsertItemStates`, `saveSessionLog`）は失敗時 `SendOutbox` に残り、次回ログイン時に再送されます。

詳細・禁止事項: [FORM_AGGREGATION_SANCTUARY.md](FORM_AGGREGATION_SANCTUARY.md)

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
- **書き込み**: Pages → GAS `submitFormSummary`（**GAS② 優先、トークン無効時は GAS①**）→ Google フォーム `formResponse`（fbzx トークン付き）。Drive 保存とは独立
- **反映**: フォーム回答先 SS に即時追記（バッチ・トリガー不要）
- **動作確認**: 2026-08-26 / コミット `f370d43` で Form 記載成功。留意点は [FORM_AGGREGATION_SANCTUARY.md](FORM_AGGREGATION_SANCTUARY.md) §0
- **閲覧**: GAS① 管理者ダッシュボード、または SS を直接開く（制限付き共有）

> 変更時の注意・禁止事項: [FORM_AGGREGATION_SANCTUARY.md](FORM_AGGREGATION_SANCTUARY.md)

#### フォーム初回セットアップ（手動）

1. Google フォームで上記列名の**短答**質問を作成（すべて必須推奨）
2. 回答先を本体 SS（`DigitalDrill`）または GAS が開ける SS に設定
3. フォームの「ページソース」から `formResponse` URL と各 `entry.xxxxx` を `docs/config.js` の `GOOGLE_FORM` **および `code.gs` の `GOOGLE_FORM_ENTRIES`** に設定（二箇所同期必須）
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

GAS② `?action=exportStatic` から `docs/data/manifest-index.json` と
ハッシュ付き `manifest-{mode}.{hash}.json` を生成します。
旧固定名（`manifest-vocab.json` 等）は生成されません。

---

## 9. 認証フロー

### アプリログイン（GAS①）

1. Pages「Googleアカウントでログイン」→ GAS① `?action=auth`
2. whitelist 照合 → `auth` トークン → Pages `?auth=TOKEN`
3. `AuthGateService` が localStorage に保持

### Drive OAuth（UserDriveModule）

詳細・動作確認済み設定: [USER_DATA_SANCTUARY.md](USER_DATA_SANCTUARY.md) §0。

1. ログイン成功 ≠ Drive 許可。キャッシュ（access / refresh）が無ければプロフィール下 **「Drive を接続」** を表示（自動 OAuth・ポップアップは使わない）
2. ボタン押下で **同タブ・リダイレクト（PKCE・offline）** → 復帰後に `refresh_token` を保存。以降はサイレント refresh（目標: 再同意なしで約1ヶ月以上。同意画面が「テスト」だと Google 側で refresh が7日失効）
3. GCP OAuth クライアントに Pages の **承認済みのリダイレクト URI** を登録（`config.js` の `GOOGLE_OAUTH_REDIRECT_URI` または実際の `origin+pathname`）
4. **GAS①・GAS② の Script Properties に `CLIENT_SECRET`**（GCP OAuth クライアントのシークレット）を登録。トークン交換は Pages から Google 直叩きせず GAS② の `exchangeOAuthCode` / `refreshOAuthToken` 経由（Pages に secret を置かない）
5. 許可後、`ensureUserDataEnvironment` が **フォルダ `DigitalDrill_MyData`・`マイ単語帳`・`DigitalDrill学習記録`** をなければ作成
6. フォルダ／ファイルの存在確認は **`files.get`**（`files.list` の `q=id=` は使わない）
7. トークンは `dd_google_access_token:<account>` / `dd_google_refresh_token:<account>` に保存（アカウント別）

**ログイン成功だけでは単語登録・学習記録の読み書きはできない。** Drive 権限の許可が別途必要。

---

## 10. 一括反映

| タスク | 内容 |
|---|---|
| Deploy All | clasp push → GAS①② → git push |
| `-ExportStatic` | 上記 + manifest-index.json とハッシュ付き manifest 生成 |

---

## 同時接続への備え

同時接続数の上限に当たったときだけ再試行します（それ以外のフォールバックは持ちません）。

| 箇所 | 挙動 |
|---|---|
| Pages → GAS②（版チェック・プリセット取得・認証） | HTTP 429 / 5xx とネットワークエラーに限り、指数バックオフで最大4回リトライ（約1s / 2s / 4s + ジッター） |
| Pages → Google フォーム（プリセット概要） | GAS `submitFormSummary`（fbzx）。Drive とは独立。詳細は FORM_AGGREGATION_SANCTUARY |
| 教材の配布 | 通常は Pages の manifest-index + IndexedDB で完結し、GAS② には版チェックの 1 リクエストだけ |
| 学習状態の Drive 同期 | 送信に失敗した Item_ID は dirty のまま残り、次のセッション終了時に再送 |

---

## トラブルシューティング

- **`client_secret missing` / ログイン直後にトークン交換失敗**: GAS①② の Script Properties に `CLIENT_SECRET` が無い、または未デプロイ。GCP コンソールの OAuth クライアントからシークレットをコピーし、両プロジェクトに登録 → Deploy All
- **宿題・小テスト管理が開けない**: 本体 SS の `whitelist` で当該アカウントの `class` 列を `admin` にする（または `ADMIN_EMAIL`）。Deploy All 後にダッシュボードを再読込
- **属性別の宿題が表示されない**: whitelist の `attribute1`～`attribute5` と課題の `Target_attribute1`～`Target_attribute5` が一致しているか確認（空列＝制限なし、複数値はカンマ区切り OR、列同士は AND）。属性変更後は生徒に再ログインしてもらう
- **小テストの達成が SS に出ない**: ノルマ回数（`Required_Pass_Count`）回の「合格条件クリア」がローカルで溜まっているか。達成前は意図的に SS へ書き込まない。達成後に `assignment_submissions` に `passed` が1行追加される
- **単語登録・学習記憶が保存されない**: [USER_DATA_SANCTUARY.md](USER_DATA_SANCTUARY.md) §0・§9。「Drive を接続」→ `DigitalDrill_MyData`。`GOOGLE_CLIENT_ID` が Pages に反映されているか
- **セッション集約が空**: フォーム回答先 SS に行が入っているか、`config.js` の `GOOGLE_FORM` が正しいか確認。**GAS①・GAS② を再デプロイ**（`submitFormSummary` 必須）。プリセット学習（マイ単語帳以外）で終了しているか。詳細は [FORM_AGGREGATION_SANCTUARY.md](FORM_AGGREGATION_SANCTUARY.md)
- **マイページ／マイ単語帳が空**: ユーザー Drive は Pages の `UserDriveModule`（GAS① ではない）。[USER_DATA_SANCTUARY.md](USER_DATA_SANCTUARY.md) §0・HANDOVER「ユーザー Drive — 動作確認済み」
- **教材の更新が反映されない**: サーバー側の版キャッシュ（120秒）が切れるのを待つか「キャッシュ更新」ボタン
- **初回表示が遅い**: `docs/data/manifest-index.json` が未生成。`scripts/export-static.ps1` を実行
