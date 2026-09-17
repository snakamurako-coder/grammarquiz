# 小テストモードと通常の単語クイズモード — 移植用引き継ぎ

他アプリへ同じ体験を移植するための仕様書です。  
実装の正本は学習 UI（`docs/index.html` ほか）と課題モジュール（`docs/assignment.js`）、管理画面（`dashboard.html`）、GAS（`code.gs`）です。

この文書では次の2つを主軸にします。

| 呼び名（教室） | 内部フラグ | 入口 |
|---|---|---|
| **B 小テスト** | `currentAppMode === 'assignment-quiz'`（課題マスタ `Kind === 'quiz'`） | タブ「宿題・小テスト」→ 課題カードの「取り組む」 |
| **通常の単語クイズ** | `currentAppMode === 'vocab'` | タブ「単語学習」→ サブタブ「単語クイズ」→ 「開始」 |

同じ問題 UI（選択・タイピング・プール等）を使い回します。差は **誰が範囲を決めるか、いつ正誤を見せるか、何を成績にするか** です。

---

## 0. 移植前に切り分けるもの（混同禁止）

本アプリには「宿題」「小テスト」に似た経路が複数あります。移植時は **B 小テストだけ** を通常クイズと対比してください。

| 経路 | フラグ | 通常クイズとの関係 | 移植時 |
|---|---|---|---|
| **B 小テスト**（本比較の対象） | `assignment-quiz` | 課題マスタから出題。正誤は終了まで隠す | **必須** |
| **A 宿題** | `assignment-homework` | 同じ課題タブだが、範囲完走・即時フィードバック | 小テストとセットで移植することが多い。後述 §11 |
| **URL 宿題ロック** | `VocabLaunchConfig.isHomeworkMode()`（`?homework=1` 等） | 単語タブの UI をロックし、出題を「形式ごと N 問・語重複なし」にする。**AssignmentModule は起動しない** | 小テストではない |
| **授業ライブ（LIVE）** | `LiveRoomModule` | 教員が制限時間・ベストスコアを持つ別系統。通常クイズ UI を流用することがある | 小テストではない |
| **文法タブ** | `currentAppMode === 'grammar'` | 通常単語クイズではない。ただし **小テストのセクションには文法を混ぜられる** | 単語専用なら省略可 |

`assignmentQuizDeferFeedback_()` は **`assignment-quiz` のときだけ true** です。A 宿題では false（即時フィードバック）です。

---

## 1. 体験の差（教室側の一言）

- **通常の単語クイズ**: 生徒が教材・形式・問数を自分で選ぶ。1問ごとに ⭕️/❌ が出る。制限時間も合格ラインもない。結果は自分の学習記録と SRS（間隔反復）に残る。
- **小テスト**: 管理者が範囲・形式・制限時間・合格ライン・ノルマ回数を決める。解答中は正誤も解説も出さない。選び直し可。全問後に「回答一覧」で未回答を直してから提出。合格条件を満たした回数がノルマに達したときだけ、管理者シートに「達成」が1行載る。SRS は動かない。

---

## 2. 入口・権限・期間

### 2.1 通常の単語クイズ

1. ログイン後、モードタブ `data-mode="vocab"`。
2. サブタブ「単語クイズ」（`data-vocab-mode="quiz"`）。
3. 生徒が選ぶもの:
   - ブック種別（プリセット / マイ単語帳）
   - ブック名・シート
   - 大・中・小区分フィルタ
   - 軸: 和英/英和 × 語/句/例文
   - 解答方法: 選択 / タイピング / 音声入力（STT）
   - 選択の出し方: 各問専用 / 選択肢プール
   - ダミー選出、選択肢数、「わからない」「正答はない」
   - 出題数（全問 or 指定）
4. `#vocab-start-btn` → `runVocabQuizSession_`。`currentAppMode = 'vocab'`。
5. PIN は不要（PIN は LIVE 参加用）。

復習セットからの開始（`startVocabReviewSetQuiz_`）も `currentAppMode = 'vocab'` です。出題形式は単語クイズタブの設定を流用し、語の集合だけ復習セットで絞ります。

### 2.2 小テスト

1. 管理者がダッシュボードで `Kind = quiz` の課題を保存（`assignments` シート）。
2. 配布対象: `Target_Class` + `Target_attribute1`〜`5`（空＝制限なし）。whitelist の属性と照合。
3. 公開 `Active = 1` かつ期間内（`Window_Start`〜`Window_End`。任意の `Deadline`）。
4. 生徒はタブ「宿題・小テスト」。`listMyAssignments` で自分宛だけ見える。
5. 期間によるボタン:
   - 期間内・未達成: **取り組む**
   - 期間前: **予行演習**（成績に載せない）
   - 達成後: **再現**（同じ範囲の再出題。成績に載せない）
   - 期間後: 開始不可（印刷は可）
6. 開始時 `startAssignmentAttempt`。小テストはサーバー行を作らず `submissionId: 'local_…'`, `localSession: true`。
7. `currentAppMode = 'assignment-quiz'`。設定画面は閉じて `#game-screen` へ直行。
8. バナー: `【小テスト】` + 課題名。予行/再現なら警告「成績・進捗にカウントされません」。

ログイン必須。未ログインでは課題一覧は出ません。

---

## 3. 出題の作り方（単語部分）

問題オブジェクト自体（形式キー、choices、空所など）は **同じ `VocabQuizGenerator`** です。分岐は `options.homeworkMode` です。

### 3.1 形式キー（両モード共通）

軸の組み合わせ → 形式キーは `vocabResolveFormats(axes)`。

| 解答 | 選択スタイル | 和英・語 | 和英・句 | 和英・例文 | 英和・語 | 英和・句 | 英和・例文 |
|---|---|---|---|---|---|---|---|
| タイピング / 音声 | — | W1 | W2 | W3 | W4 | W5 | W6 |
| 選択 | 各問専用 | vocab-jaen | C1 | C2 | vocab-enja | enja-ph | enja-ex |
| 選択 | プール | PPW | PPH | PEX | enja-wd-pool | enja-ph-pool | enja-ex-pool |

UI モジュール:

- W1–W3: `TypingModule`（英語記述。W1–W3 かつ `useStt` なら STT バー）
- W4–W6: `VocabJaModule`（日本語記述）
- 英和選択: `VocabQuizModule`
- 和英選択・プールカード: `ChoiceModule`
- プール一括画面: `VocabPoolMatchModule`（連続するプール形式を1ブロックにまとめる）

文法形式 A–H は通常単語クイズには出ません。小テストの **文法セクション** にだけ出ます。

### 3.2 通常クイズ: `buildNormalQuestions`

- 語のリストをシャッフルし、各語について選ばれた形式のうち **その語で作れるものをランダムに1つ** 割り当てる（`pickPlannedItems_`）。
- 出題数: `questionCount === 'all'` なら条件に合う語の数まで。指定ならその件数（上限は語数）。
- 形式数に上限はない（UI で選んだ組み合わせ全部）。
- 同じ語が2形式で出ることはない（1語1問）。
- プール形式はセッション内で共有カード束を1つ作る。
- 語の並びは SRS「出題期限が来た語」で並べ替えうる（`SrsModule.selectDueWords`）。復習セット指定時はセット内の語だけ。
- 足りない形式があっても **例外を投げず**、作れた分だけ返す。0問ならアラート。

### 3.3 小テストの単語セクション: `buildHomeworkQuestions`（`homeworkMode: true`）

課題の各 vocab セクションについて:

- 形式は最大 **4 種**（`formats.slice(0, 4)`）。
- 各形式ごとに `questionCount`（数値。未指定なら **5**）問。
- 語は **セクション横断で重複禁止**（`usedKeys`）。形式 A で使った語は形式 B に出さない。
- プール形式は「その形式の正答カードが互いにぶつからない」ことも見る（`allocPoolWordsUnique_`）。
- 必要数に足りないと **throw**（課題として成立しない、と生徒にメッセージ）。通常クイズのように「作れた分だけ」にはしない。
- SRS・復習セットでは絞らない。管理者が選んだフィルタ後の語集合が範囲。
- 毎回フル出題（A 宿題のような `skipDoneIds` は使わない）。
- `Weakness_Review` が有効で「ニガテ復習」開始のときだけ、ローカル `wrongIds` に残った ID に限定。

配点: セクションの `pointsPerQuestion`（既定 1）を各問に `_pointsPerQuestion` として付与。得点制合格で使う。通常クイズに配点はない。

### 3.4 小テストは単語専用ではない

1課題は最大 **4 セクション**。各セクション `mode` は `grammar` または `vocab`（`reading` / `ai` / `conversation` は未実装でエラー）。

単語アプリへ移植する場合の判断:

- 単語だけの小テストにするなら、セクションは vocab のみでよい。
- 本家と同じにするなら、文法セクションも同じセッションに連結し、`_assignmentSection` でセクションタブを出す。

---

## 4. 解答中の振る舞い（いちばん移植しやすい差）

判定の単一スイッチ:

```javascript
function assignmentQuizDeferFeedback_() {
  return currentAppMode === 'assignment-quiz';
}
```

これが true のとき（小テスト本番・予行・再現すべて）、各問題モジュールは **即時採点しない**。

### 4.1 通常クイズ（即時）

1. 選択・送信した瞬間に正誤を出す（⭕️ / ❌ / 「わからない」）。
2. 正答文・空所の埋め込み・解説（文法）をその場で出す。
3. `answered` フラグで **同じ問の選び直し不可**。
4. `onQuestionCompleted` は同じ index の再記録を拒否。
5. 詳細設定の「自動遷移」が ON なら、正誤表示のあと次問へ進む。
6. TTS で正答英文を読める。

### 4.2 小テスト（遅延）

1. 選択・入力は **仮回答**（`pendingChoice` / `pendingAnswer_`）。画面上は「選んだ」「✔ 回答を変更できます」程度。⭕️❌ は出さない。
2. `setResultVerdict` は早期 return。解説も出さない。結果スロットを空にする。
3. 同じ問を何度でも選び直せる。戻って来た問は前回の選択を `selected` で復元。
4. 確定タイミング:
   - 次へ / 前へ / セクション移動
   - 回答一覧を開く
   - 制限時間切れ
   - 最終提出  
   これらで `commitPending()` → そのとき初めて `onQuestionCompleted`。
5. 同じ index の再記録を **許可**（スコア差分を補正する意図。実装上の注意は §12）。
6. 自動遷移は `onQuestionCompleted` 経路では無効。仮回答時は `notifyPendingAnswered_` が、自動遷移 ON かつ最終問でなければ 250ms 後に次問、最終問なら回答一覧へ。
7. ナビに **「回答一覧」** ボタンが出る。早期提出ボタンあり。

プール一括 UI（`VocabPoolMatchModule`）も課題セッションではセグメント完了後、小テストなら結果画面ではなく回答一覧へ回す。

---

## 5. ナビゲーション・タイマー

両モード共通:

- ←→ キー、前後ボタンで **未回答のまま移動可**（詳細設定の説明どおり）。
- 途中ドラフト: `localStorage dd_session_draft:{account}`（TTL 7 日）。単語クイズと課題でバナーが別（`#session-resume-banner` / `#assignment-session-resume-banner`）。

### 5.1 通常クイズ

- セッション制限時間なし。
- セクションタブなし。プール形式が連続すれば1つのプール画面、それ以外は1問ずつ。
- 最後の問の「次へ」で結果画面。

### 5.2 小テスト

- `Time_Limit_Sec > 0` なら `deadlineMs` を置き、250ms 間隔で「残り m:ss」。30 秒以下で `urgent`。0 なら「制限なし」。
- 0 秒到達: 未確定回答を flush し、回答一覧を閉じて結果画面へ強制提出（`_timedOut`）。**時間切れ自体は合否判定に使わない**（正答率/得点だけで pass）。結果ステータス表示は未達なら `'forced'`。
- 複数セクション（またはプール塊と逐次塊）があると **セクションタブ**。完了セクションは再ジャンプ不可。未完了セクションが残っていると結果画面に行かずトースト。
- 全セグメント完了時、小テストは結果の前に **回答一覧**（正誤はまだ出さない。自分の解答と未回答マーク、問ごとの「修正」）。提出確認後に結果画面。

---

## 6. 採点・合格・ノルマ・サーバー記録

### 6.1 通常クイズ

- 合格ラインなし。結果は `正解数 / 全問` と正答率。
- 1セッション = 1回の学習記録。ベストスコアという概念はない（ベストは LIVE のみ）。
- 挑戦回数の上限もノルマもない。

### 6.2 小テスト（1回の取り組み）

ローカル判定 `evaluatePassLocal_` / サーバー `evaluateQuizAttemptPass_`:

- `Pass_Mode === 'points'`: `points >= Pass_Score`（各問 `_pointsPerQuestion` の合計）。
- それ以外（`rate`）: `round(correct / total * 100) >= Pass_Score`。
- `timedOut` は合否に入れない。

ノルマ:

- `Required_Pass_Count`（旧列 `Max_Attempts` を読むフォールバックあり）。
- **挑戦回数に上限はない**。合格した回だけ `clearCount++`。
- 例: ノルマ 3 → 制限時間内に合格ラインを3回クリアで「達成」。

サーバー（`assignment_submissions`）:

- **達成前は行を書かない**（ローカル `localStorage dd_quiz_pass:{assignmentId}:{account}` に `clearCount` / `clears[]`）。
- ノルマ到達かつ今回合格かつ未達成のとき `recordAchievement: true` → 1行 `Status = 'passed'`。
- 通信失敗時は `pendingAchievement` をローカルに残し、一覧の「再度報告」。
- 既にサーバー達成済みなら以降は `clientOnly`（成績は増やさない）。

結果画面の点数表示は問数ベース（`currentScore / totalQuestionsCount`）。得点制の合格計算は別変数 `pointsEarned` / `pointsMax`。

予行・再現は `preview: true` で **提出も進捗も学習記録も書かない**。

---

## 7. 学習記録・SRS・マーク

| | 通常単語クイズ | 小テスト |
|---|---|---|
| Drive 学習ログ | 毎セッション `saveVocabSessionResults`。`Set_ID = vocab:{book}/{sheet}` | 本番終了後 `saveSessionResultsUnified('assignment-quiz', 課題名)`。`Set_ID = assignment:{assignmentId}`。予行/再現は保存しない |
| Google Form 集約 | プリセット教材のときだけ | `currentSessionIsPreset = false` のため送らない |
| 回答時 SRS | `SrsModule.update(wordId, …)` | **更新しない** |
| 復習セット | 記録する（セット起動時） | 使えない |
| 結果画面 👍/😫 | あり（SRS + ItemState） | なし（`currentAppMode === 'vocab'` のときだけ出す） |
| 文法 AlgorithmModule | 使わない | 文法セクションがあっても課題中は通常の文法記録経路に乗らない（assignment 分岐） |

A 宿題だけ、回答のたびに `dd_hw_progress:` の `doneIds` / `wrongIds` を更新し、GAS `saveHomeworkProgress` で `Progress_JSON` を書く。小テストの `onAnswered` も同じ `markDone_` を呼ぶが、サーバー進捗保存は `Kind === 'homework'` のときだけ。小テストの `wrongIds` はニガテ復習の出題絞りに使う。

---

## 8. UI 差分チェックリスト

移植先で「小テストらしく」するために必要な画面要素:

- 課題一覧（種別ラベル、期間、合格ライン、クリア n／ノルマ、取り組む/予行/再現/印刷/再度報告）
- セッション中バナー（【小テスト】タイトル、予行・再現警告）
- 残り時間（プール画面ヘッダにも同じ残りを出す）
- セクションタブ（複数ブロック時）
- 回答一覧（未回答警告、修正ジャンプ、提出確認。正誤は出さない）
- 結果画面（ここではじめて正誤・正答。単語マークは出さない）

通常クイズ側で残すもの:

- 教材・形式の全設定 UI
- 即時 ⭕️❌
- 自動遷移
- 結果の 👍/😫
- 用紙印刷ボタン（URL 宿題ロック時は隠す。通常クイズでは出す）

小テスト中に出さない / 使えないもの:

- 単語カード、Word Link、復習セット（課題タブ経路では生徒は設定画面に戻らない）
- 出題設定の変更（管理者 JSON が正本）

---

## 9. データモデル（移植時の最小スキーマ）

### 9.1 課題マスタ（本家 `assignments`）

```
Assignment_ID, Title, Kind,          // Kind: 'quiz' | 'homework'
Window_Start, Window_End, Deadline,
Time_Limit_Sec,                      // 0 = なし
Required_Pass_Count,                 // ノルマ回数
Pass_Score, Pass_Mode,               // Pass_Mode: 'rate' | 'points'
Weakness_Review,                     // 0/1
Target_Class, Target_attribute1..5,
Sections_JSON,                       // 最大4。下記
Active, Created_By, Updated_At
```

`Sections_JSON` の1要素（単語）のイメージ:

```json
{
  "mode": "vocab",
  "bookType": "preset",
  "bookName": "…",
  "sheetName": "…",
  "filters": { "dai": [], "chu": [], "sho": [] },
  "axes": {
    "directions": ["jaen"],
    "grains": ["WD"],
    "response": "choice",
    "choiceStyle": "dedicated"
  },
  "questionCount": 5,
  "choiceCount": 4,
  "includeNone": true,
  "includeUnknown": true,
  "poolDummyCount": 2,
  "pointsPerQuestion": 1
}
```

文法セクションは `mode: "grammar"` + `subject` / `units` / `formats` / フィルタ。

### 9.2 提出（本家 `assignment_submissions`）

小テストは達成時のみ:

```
Submission_ID, Assignment_ID, Account, Attempt_No, Status,  // Status: passed
Score, Correct, Total, Points, Points_Max, Duration_Sec, Timed_Out,
Progress_JSON, Detail_JSON, Submitted_At
```

クライアント作業領域（達成前）:

```javascript
// localStorage key: dd_quiz_pass:{assignmentId}:{account}
{
  "clearCount": 0,
  "clears": [{ "at": "ISO", "score": 80, "durationSec": 120 }],
  "serverAchieved": false,
  "pendingAchievement": null
}
```

セッション中メモリ:

```javascript
{
  assignment, submissionId, attemptNo, startedAtMs, deadlineMs,
  rangeIds, pointsMax, pointsEarned, reviewWrong, answerLog,
  preview, reproduce, _timedOut
}
```

### 9.3 通常クイズのセッション設定スナップショット

学習ログの `settings` に、ブック・フィルタ・形式軸・問数などを保存。再現は **設定の復元** であり、当時の同一問題リストの再出題ではない。小テストの「再現」は **同じ課題範囲で問題を作り直す**。

---

## 10. 解答確定の移植手順（推奨実装順）

1. 問題生成を2モードにする  
   - 自由学習: 1語1形式、問数指定、足りなければ減らす  
   - テスト: 形式ごと N 問、語重複なし、足りなければ作成失敗
2. セッションに `deferFeedback` フラグを持たせる（本家は `currentAppMode` で代用）
3. 各解答 UI に「仮回答 / 即時採点」の分岐を入れる（選択・記述・日本語記述・訂正・プール）
4. 移動・タイムアウト・提出の直前に `commitPending`
5. テストだけ回答一覧（正誤なし）→ 提出 → 結果（正誤あり）
6. テストは SRS を切る。通常クイズは回答のたびに更新
7. テストの成績は「合格した回数」をクライアントで数え、ノルマ到達でサーバー1行
8. 制限時間はセッション時計。切れても採点式は同じ。未回答は不正解として確定してから提出

共通部品として残してよいもの: 形式キー、空所組み立て、英語正規化、選択肢ダミー、プールカード。

---

## 11. A 宿題との差（小テストと一緒に移植する場合）

| | A 宿題 | B 小テスト |
|---|---|---|
| 目的 | 範囲を分割して完走 | 時間内に合格ラインをノルマ回クリア |
| 出題 | 未消化 `doneIds` を除く | 毎回フル |
| 開始時サーバー | `in_progress` 行 + Progress_JSON | 行なし |
| フィードバック | 即時（通常クイズと同じ） | 遅延 |
| 回答一覧 | なし | あり |
| 合格 | 範囲の全 ID が done | 正答率または得点 × ノルマ回数 |
| 点検票 | 提出物（○/空欄） | 小テスト合否 |

宿題と小テストは同じ `AssignmentModule`・同じセクション JSON です。差は Kind と上記テーブルです。

---

## 12. 移植時の落とし穴

1. **`isHomeworkMode()` を小テストだと思わない。** URL パラメータで単語タブをロックするだけの別機能。
2. **A 宿題を小テストのフィードバック仕様で作らない。** 遅延フィードバックは quiz のみ。
3. **小テストに文法が混ざる** のが本家仕様。単語専用アプリならセクションを vocab に固定すると明示する。
4. **ベストスコアは LIVE の話。** 通常クイズも小テストも「今回の点」または「クリア回数」。
5. **PIN は LIVE。** 課題 ID で始める。
6. **達成前にサーバーへ毎回答を送らない** のが意図（通信・改ざん耐性より運用負荷）。改ざん耐性を上げる移植なら、この点は設計判断。
7. **時間切れ ≠ 不合格。** 点がラインに達していればクリア。
8. **不足問数:** 通常クイズは減らして開始、小テストはエラーで開始しない。
9. **回答上書きのスコア:** 本家は「差分補正」のあと、さらに `if (isCorrect) currentScore++` がある。選び直しで点数がずれうる。移植では **「前回値を差し引いて今回値を足す」1か所** にまとめた方がよい。配点 `pointsEarned` も `onAnswered` が正解のたびに加算するだけで減算しない。
10. **再現と学習記録の再現は別物。** 課題の再現 = 同範囲の新規出題。マイページ学習記録の「再現」は文法/単語なら設定復元、課題なら `reproduceById`。

---

## 13. 実装ファイル索引

| ファイル | 役割 |
|---|---|
| `docs/index.html` | `currentAppMode`、`assignmentQuizDeferFeedback_`、各問題モジュール、`VocabQuizGenerator`、`GameSessionPlay`、結果保存、回答一覧 |
| `docs/assignment.js` | 課題一覧・開始・タイマー・合格・提出・再現 |
| `docs/vocab-session-draft.js` | 途中復帰 |
| `docs/paper-quiz-module.js` | 印刷（課題はフル範囲。小テスト中の体験とは別） |
| `dashboard.html` | 管理者が Kind / 時間 / 合格 / セクションを保存 |
| `assignment-section-ui.html` | セクション UI（ダッシュボードから読み込み） |
| `code.gs` | `assignments` / `assignment_submissions` API（開始は quiz ならローカル、提出は達成時のみ行追加） |

関連 API: `listMyAssignments` / `startAssignmentAttempt` / `submitAssignmentAttempt` / `reportQuizAchievement`（宿題用に `saveHomeworkProgress`）。

運用メモ: `docs/DEPLOYMENT.md` — 「小テストの達成が SS に出ない」はノルマ未達か、達成前は書かない仕様。

---

## 14. 受け入れ確認（移植先のテスト観点）

通常クイズ:

- [ ] 生徒が形式と問数を変えられる
- [ ] 1問ごとに正誤が出る。選び直しできない
- [ ] スペース付き英語と `look ～ after` の記号正規化が通常どおり動く
- [ ] 結果に 👍/😫 があり、再学習の出題順に影響する（SRS を移植する場合）
- [ ] 制限時間・合格メッセージが出ない

小テスト:

- [ ] 生徒は範囲を変えられない
- [ ] 解答中に正誤・正答・解説が出ない
- [ ] 選び直しでき、回答一覧から修正できる
- [ ] 未回答のまま提出すると不正解として確定する
- [ ] 制限時間切れで強制提出され、点がライン以上ならクリアになる
- [ ] 不合格でも何度でも受けられる。合格 n 回で達成
- [ ] 達成まで管理者側に途中点数が並ばない（本家仕様を踏襲する場合）
- [ ] 達成後の再現は成績に入らない
- [ ] 形式ごと N 問・語がセクション内で重複しない。語が足りないと開始できない
- [ ] SRS / 復習セットが動かない

以上が、本家で「小テスト」と「通常の単語クイズ」を分けている理由と、移植時に再現すべき境界です。
