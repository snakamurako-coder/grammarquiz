# フォーム集約聖域 — Google Form → 集計 SS の設計契約

> **この領域はコード変更のたびに壊れやすい。** リファクタ・認証変更・保存経路整理の前に必ず本書を読むこと。  
> Cursor 向けの短い禁止事項は `.cursor/rules/form-aggregation-sanctuary.mdc` を参照。

---

## 1. 聖域の範囲

| ファイル | 役割 |
|---|---|
| `docs/index.html` | `buildSessionSummary_` / `submitSessionSummary_` / `sendResultToGoogleForm` / `currentSessionIsPreset` |
| `docs/config.js` | `GOOGLE_FORM.ACTION_URL` / `GOOGLE_FORM.ENTRIES`（参照・空判定） |
| `code.gs` | `submitFormSummary`（doPost）/ `GOOGLE_FORM_ENTRIES` / `submitGoogleFormSummary_` / `fetchGoogleFormContext_` |

**ユーザー個人の学習詳細は Drive（UserBridge）側。フォーム集約は管理者向けの粗粒度サマリーだけ。**

---

## 2. あるべきアーキテクチャ（現行・固定）

```text
【送信トリガー】
  セッション終了 → saveSessionResultsUnified()
    → saveSessionLog（Drive・ユーザー個人）
    → submitSessionSummary_（条件付き）
         → sendResultToGoogleForm()
              → GAS② POST action=submitFormSummary（authToken 必須）
                   → viewform から fbzx 取得
                   → formResponse へ POST（entry.xxxxx + fbzx）
                        → フォーム回答先 SS（集計用）

【送信対象】
  管理者プリセットの文法・単語学習のみ（currentSessionIsPreset === true）
  マイ単語帳・音読は送らない
```

### Drive 保存と Form 集約は別経路

| 経路 | 粒度 | 保存先 | 失敗時 |
|---|---|---|---|
| **Drive** | 個人（学習状態・ログ） | ユーザー `DigitalDrill学習記録` | SendOutbox 再送 |
| **Google Form** | 管理者集約（1セッション1行） | 本体 SS の回答シート | Console `[Form]` のみ（再送なし） |

Drive 保存が成功しても Form が空、またはその逆があり得る。**Form 未反映 ≠ 学習記録未保存**。

---

## 3. 送信条件（全部満たすこと）

1. **ログイン済み** — `AuthGateService.isValid()`
2. **`config.js` の `GOOGLE_FORM.ACTION_URL` が非空**
3. **`currentSessionIsPreset === true`**
   - 文法開始時: 常に `true`（プリセット教材のみ）
   - 単語: ブック種別が `preset` のとき `true` / `user`（マイ単語帳）のとき `false`
   - 音読: 常に `false`
4. **GAS② がデプロイ済み** — `doPost` に `submitFormSummary` があること（push だけでは不十分）

---

## 4. fbzx 問題（過去に壊れた最大原因）

Google Form の programmatic POST には **`fbzx` トークン**（＋ `partialResponse` / `pageHistory` / `fvv`）が必須。  
**`fvv=1` と entry だけでは回答 SS に記録されない**（エラーも出ず silent fail しやすい）。

| 方式 | 結果 |
|---|---|
| ❌ ブラウザから iframe / fetch で formResponse 直 POST | fbzx 取得不可（CORS）→ **集計 SS に載らない** |
| ❌ `no-cors` fetch のみ（fbzx なし） | 同上 |
| ✅ **GAS② が viewform を取得 → fbzx 付き POST** | 現行の正 |

**ブラウザ直 POST への回帰は禁止。**

---

## 5. entry ID の二重管理（同期必須）

フォームの質問を追加・並べ替え・作り直すと `entry.xxxxx` が変わる。次の **2箇所を必ず同時更新**：

| 場所 | 定数名 |
|---|---|
| `docs/config.js` | `GOOGLE_FORM.ENTRIES` |
| `code.gs` | `GOOGLE_FORM_ENTRIES` |

`config.js` の ENTRIES はクライアント側の参照用。実際の POST は **`code.gs` の `GOOGLE_FORM_ENTRIES` が使われる**。

質問タイトル（列名）の正:

`User_ID`, `Mode`, `Set_ID`, `Set_Name`, `Attempt_No`, `Correct`, `Total`, `Score`, `Duration_Sec`, `Started_At`, `Ended_At`

---

## 6. summary ペイロード契約

`buildSessionSummary_()` が生成し、`submitFormSummary` 経由で GAS に渡すフィールド:

| キー | 内容 |
|---|---|
| `Mode` | `grammar` / `vocab`（reading は Form 非送信） |
| `Set_ID` | 例: `grammar:学年/シート名` / `vocab:ブック/シート` |
| `Set_Name` | 表示用セット名 |
| `Attempt_No` | 同一 Set の試行回数 |
| `Correct` / `Total` / `Score` | 正答数・総数・正答率 |
| `Duration_Sec` | 解答時間（秒） |
| `Started_At` / `Ended_At` | ISO 8601 |

GAS 側 `User_ID` は authToken から解決（クライアントから送らない）。

---

## 7. 変更してよい / してはいけない

### ✅ してよい

- フォーム URL・entry ID の更新（§5 の二重同期を守る）
- `fetchGoogleFormContext_` のキャッシュ TTL 調整（現行 300 秒）
- 送信失敗時のリトライ回数調整（現行 2 回・2 回目は fbzx 再取得）

### ❌ してはいけない（障害パターン）

| 禁止 | 起きたこと |
|---|---|
| ブラウザから formResponse へ直接 POST | fbzx 欠落 → SS に行が増えない |
| `submitSessionSummary_` の削除・save 経路から切り離し | 集計完全停止 |
| `currentSessionIsPreset` フラグの誤設定 | プリセットなのに送られない / 逆 |
| `code.gs` の `GOOGLE_FORM_ENTRIES` だけ更新 | entry 不一致で列が空 |
| GAS② push のみで deploy 省略 | 旧 doPost のまま → `無効なaction` |
| Form 送信を Drive 保存の成否に連動させる | 片方成功時にもう片方がスキップされる |

---

## 8. 変更時チェックリスト

- [ ] 送信経路は **Pages → GAS② submitFormSummary → formResponse** のままか
- [ ] `fbzx` / `partialResponse` / `pageHistory` / `fvv` を GAS POST に含めているか
- [ ] `GOOGLE_FORM_ENTRIES`（code.gs）と `config.js` ENTRIES が一致しているか
- [ ] フォーム質問タイトルが上記 §6 と一致しているか
- [ ] `shouldSendSessionSummaryToForm_()` が `currentSessionIsPreset` を見ているか
- [ ] 文法/単語プリセット開始時に `currentSessionIsPreset = true` か
- [ ] マイ単語帳・音読で `false` か
- [ ] **GAS② を `clasp deploy -i` したか**（Pages だけ deploy では不十分）

---

## 9. デプロイ後の手動確認

1. ログイン
2. **管理者プリセット**の文法 or 単語で 1 セッション完走
3. 集計 SS（フォーム回答シート）に 1 行追加される
4. 列 `User_ID`, `Mode`, `Set_Name`, `Score` 等が空でない
5. マイ単語帳で完走 → **SS に行が増えない**（正常）

Console に `[Form]` エラーが出ていないかも確認。

---

## 10. トラブルシューティング

| 症状 | 第一疑い | 確認 |
|---|---|---|
| SS に一切載らない | GAS② 未デプロイ / fbzx 回帰 | `clasp deploy -i`（GAS②）。code.gs に `submitFormSummary` があるか |
| 行はあるが列が空 | entry ID 不一致 | フォーム「ページソース」と `GOOGLE_FORM_ENTRIES` を照合 |
| プリセットなのに載らない | `currentSessionIsPreset` | 単語ブック種別が `preset` か |
| マイページにはあるが SS にない | Form 非対象セッション | マイ単語帳は設計上 SS 非送信 |
| Drive は保存されるが SS にない | Form 経路のみ失敗 | Network タブで `submitFormSummary` の応答 |

---

## 11. 関連ドキュメント

| ファイル | 内容 |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) §6-7 | フォーム初回セットアップ・データモデル |
| [USER_DATA_SANCTUARY.md](USER_DATA_SANCTUARY.md) | ユーザー Drive 保存（別聖域） |
| `.cursor/rules/form-aggregation-sanctuary.mdc` | AI 向け短い禁止事項 |

---

## 更新履歴

| 日付 | 内容 |
|---|---|
| 2026-08-24 | 初版（fbzx 問題・GAS② 経由送信への修正を反映） |
