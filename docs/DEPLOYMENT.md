# BrightStage デプロイ手順（2UI構成）

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
window.BRIGHTSTAGE_CONFIG = {
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

作成者Drive に `materials/`、`vocabulary/`（プリセット）、管理ブックが生成されます。

---

## 7. ユーザー環境（自動）

GAS① ダッシュボードに初回アクセスすると、**ユーザー自身のマイドライブ** に以下が自動作成されます:

- `BrightStage_MyData/` フォルダ
- `マイ単語帳`（「サンプル」シートに10語、「デフォルト」空シート）
- `BrightStage学習記録`

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

## 9. clasp deploy の更新

```bash
# GAS② を更新
clasp deploy -i <GAS2_DEPLOYMENT_ID> --description "API update"

# GAS① を更新
clasp deploy -i <GAS1_DEPLOYMENT_ID> --description "Dashboard update"
```

---

## 10. Script Properties（任意）

Apps Script → プロジェクトの設定 → スクリプト プロパティ:

| キー | 説明 |
|---|---|
| `PAGES_URL` | GitHub Pages の URL（GAS① リダイレクト先。未設定時は既定値） |

---

## トラブルシューティング

- **dashboard が真っ白**: GAS① のデプロイが「ユーザーとして実行」になっているか確認
- **API が 403**: GAS② が「全員（匿名）」アクセスになっているか確認
- **セッションが見つからない**: CacheService TTL は6時間。再スタートしてください
- **プリセットが古い**: GitHub Pages の「キャッシュ更新」ボタンを押す
