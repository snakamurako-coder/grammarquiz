# DigitalDrill（デジドリ） デプロイ手順（2UI構成）

## 構成概要

| コンポーネント | 配置 | 実行権限 | 役割 |
|---|---|---|---|
| GAS① 管理ダッシュボード | `script.google.com/.../exec`（dashboard.html） | **アクセスしているユーザー** | 単語登録・マイ単語帳・学習スタート・成績保存 |
| GAS② JSON API | `script.google.com/.../exec?action=...` | **作成者（自分）** | プリセット配布・採点API・CacheService |
| GitHub Pages | `docs/index.html` | 静的 | 単語N択・文法演習・音読プレースホルダ |

同一GASプロジェクトから **2つのウェブアプリデプロイ** を作成します。

---

## 1. GAS コードのデプロイ

```bash
clasp push
```

`.claspignore` により `docs/` は GAS にアップロードされません。

---

## 2. GAS②（作成者権限・JSON API）デプロイ

1. [Apps Script エディタ](https://script.google.com) を開く
2. **デプロイ** → **新しいデプロイ** → 種類: **ウェブアプリ**
3. 設定:
   - **実行ユーザー**: 自分
   - **アクセス**: 全員（匿名ユーザーを含む）
4. デプロイして **exec URL** をコピー → `docs/config.js` の `API_URL` に設定

`appsscript.json` の既定設定は GAS② 向けです:

```json
"webapp": {
  "access": "ANYONE_ANONYMOUS",
  "executeAs": "USER_DEPLOYING"
}
```

---

## 3. GAS①（ユーザー権限・管理ダッシュボード）デプロイ

1. 同じプロジェクトで **もう1つ** ウェブアプリデプロイを作成
2. 設定:
   - **実行ユーザー**: **アクセスしているユーザー**
   - **アクセス**: Google アカウントを持つ全員
3. exec URL をコピー → `docs/config.js` の `DASHBOARD_URL` に設定

GAS① にアクセスすると `dashboard.html` が表示されます（`doGet` パラメータなし）。

---

## 4. GitHub Pages の有効化

1. GitHub リポジトリ → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / Folder: **`/docs`**
4. 数分後 `https://<user>.github.io/grammarquiz/` で公開

---

## 5. config.js の設定

[docs/config.js](config.js) を編集:

```javascript
window.DIGITALDRILL_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/GAS2_DEPLOYMENT_ID/exec',
  DASHBOARD_URL: 'https://script.google.com/macros/s/GAS1_DEPLOYMENT_ID/exec'
};
```

---

## 6. 初回セットアップ（作成者Drive）

GAS② の exec URL にアクセス:

```
https://script.google.com/macros/s/.../exec?action=setup
```

または Apps Script エディタで `setupEnvironment(true)` を実行。

作成者Drive に `grammarquizzes/`（文法演習）、`vocabulary/`（プリセット）、管理ブックが生成されます。
旧環境の `materials/` フォルダは初回アクセス時に自動で `grammarquizzes/` にリネームされます。

セットアップ実行者のメールアドレスが `ADMIN_EMAIL` として記録され、**管理者はホワイトリスト登録なしで常に利用できます**。

---

## 7. ユーザー環境（自動）

GAS① ダッシュボードに初回アクセスすると、**ユーザー自身のマイドライブ** に以下が自動作成されます:

- `DigitalDrill_MyData/` フォルダ
- `マイ単語帳`（「サンプル」シートに10語、「デフォルト」空シート）
- `DigitalDrill学習記録`

---

## 8. 学習フロー

### 音読（プレースホルダ）

1. GAS① ダッシュボード → シート選択 → 「音読練習」→ **学習スタート**
2. GitHub Pages に `?token=...&mode=reading` でリダイレクト
3. 単語・チャンク・例文を表示 → テキスト入力 → GAS② で採点
4. 「ダッシュボードへ戻る」→ GAS① が結果をユーザーDriveに保存

### 単語N択（GitHub Pages 直接）

1. GitHub Pages でプリセットを選択（localStorage キャッシュ）
2. または GAS① から「単語学習」モードで学習スタート（トークン経由）

### 文法演習

GitHub Pages から直接（GAS② API + キャッシュ）

---

## 9. 一括反映（推奨）

Cursor / VS Code の **Tasks: Run Task** から次を実行:

| タスク | 内容 |
|---|---|
| **★ Deploy All (Pages + GAS① + GAS②)** | `clasp push` → 両デプロイ更新 → `git commit`（必要時）→ `git push` |
| Deploy: GAS only | GAS①②のみ |
| Deploy: Pages only | GitHub Pages のみ |

実装: [`scripts/deploy-all.ps1`](../scripts/deploy-all.ps1)  
デプロイIDは [`docs/config.js`](config.js) から自動取得します（URL・権限設定は維持）。

手動の場合:

```bash
# GAS② を更新
clasp deploy -i <GAS2_DEPLOYMENT_ID> --description "API update"

# GAS① を更新
clasp deploy -i <GAS1_DEPLOYMENT_ID> --description "Dashboard update"
```

---

## 10. 認証フロー（GAS① 認証ゲート + 短命トークン）

GitHub Pages 上では Google Session を直接取得できないため、**GAS① で本人確認 → 短命トークン → Pages** の流れです。

```text
1. 利用者が Pages を開く（未ログインならログイン画面）
2. 「Googleアカウントでログイン」→ GAS① ?action=auth
3. GAS①: Session.getActiveUser + whitelist 照合
4. 成功: auth トークン（TTL 90分）を CacheService に保存 → Pages?auth=TOKEN へリダイレクト
5. Pages: トークンを localStorage に保存し学習画面へ
6. 成績・記録の保存時のみ GAS② に authToken を付与（identity はサーバー側でトークンから解決）
```

| 項目 | 値 |
|---|---|
| 認証入口 | `DASHBOARD_URL?action=auth` |
| トークン TTL | **90分（5400秒）** |
| 読み取り API | 匿名のまま（問題取得・カタログ等） |
| 保護 API | `saveResult`, `saveSessionLog`, `getUserLogs`, `scoreReading`, `save`, `registerVocabWords` 等 |

ダッシュボードから「学習スタート」した場合も `authToken` が URL に付与されます。

---

## 11. ホワイトリスト（利用者制限）

ホワイトリストに登録されたユーザーと管理者のみがアプリを利用できます。

- **登録方法**: 管理ブック（作成者Drive の `DigitalDrill管理`）の `whitelist` シートに、`account` 列へ利用者の Google メールアドレスを追記
- **GitHub Pages 学習画面**: GAS① 認証ゲート経由。未登録ユーザーは `?action=auth` で拒否
- **GAS① ダッシュボード**: アクセス時に whitelist（Script Properties キャッシュ）と照合
- **管理者**: セットアップ実行者（`ADMIN_EMAIL`）は whitelist 登録不要で常に利用可
- **キャッシュ**: whitelist は GAS② のリクエスト時に約10分間隔で Script Properties へ同期されます

---

## 12. Script Properties（任意）

Apps Script → プロジェクトの設定 → スクリプト プロパティ:

| キー | 説明 |
|---|---|
| `PAGES_URL` | GitHub Pages の URL（GAS① リダイレクト先。未設定時は既定値） |
| `ADMIN_EMAIL` | 管理者メールアドレス（setup 時に自動設定。変更可） |
| `WHITELIST_CACHE` | whitelist の自動キャッシュ（手動編集不要） |

---

## トラブルシューティング

- **「利用が許可されていないアカウントです」**: 管理ブックの `whitelist` シートを確認
- **「認証トークンが無効」**: 90分経過後は再ログイン（GAS① `?action=auth`）
- **成績が保存されない**: Pages でログイン済みか確認（authToken 必須）
- **dashboard が真っ白**: GAS① のデプロイが「ユーザーとして実行」になっているか確認
- **API が 403**: GAS② が「全員（匿名）」アクセスになっているか確認
- **セッションが見つからない**: CacheService TTL は6時間。再スタートしてください
- **プリセットが古い**: GitHub Pages の「キャッシュ更新」ボタンを押す
