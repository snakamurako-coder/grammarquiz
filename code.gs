// スプレッドシートを操作・返却するGASの基本構造（APIとして機能させる）

// Webアプリとしてデプロイし、GETリクエストを受け取った時の処理
function doGet(e) {
  // CORS対策：GitHub Pagesからのアクセスを許可する
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  // URLパラメータ（?action=xxx）で処理を分岐
  const action = e.parameter.action;
  
  if (action === 'getQuestions') {
    // 例：スプレッドシートから問題を読み込む関数を呼ぶ
    const data = fetchQuestionsFromSheet(e.parameter);
    output.setContent(JSON.stringify({ status: "success", data: data }));
  } else {
    output.setContent(JSON.stringify({ status: "error", message: "Invalid action" }));
  }
  
  return output;
}

// POSTリクエストを受け取った時（学習結果の保存などに使用）
function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    const postData = JSON.parse(e.postData.contents);
    
    if (postData.action === 'saveResult') {
      // 例：結果をスプレッドシートに書き込む処理
      saveResultToSheet(postData.payload);
      output.setContent(JSON.stringify({ status: "success" }));
    }
  } catch (error) {
    output.setContent(JSON.stringify({ status: "error", message: error.toString() }));
  }
  
  return output;
}

// ----------------------------------------------------
// 具体的なスプレッドシート操作ロジック（Cursorで後ほど実装）
// ----------------------------------------------------
function fetchQuestionsFromSheet(params) {
  // TODO: SpreadsheetApp.openById('YOUR_SHEET_ID') 等を用いて、
  // 指定された「学年・科目」「単元名」のシートからデータを抽出、
  // ダミーの有無や出題形式に応じて配列を作って返すロジックを実装します。
  
  // モックデータ返却
  return [
    {
      id: 1,
      format: "sort_ja",
      japanese: "私が議長に最適だと思うのはジョンです。",
      sentence_template: "I ＜並び替え入力箇所＞ is John.",
      correct_answer: "think the best person for chairperson",
      all_correct_words: ["think", "the", "best", "person", "for", "chairperson"],
      dummies: ["a"]
    }
  ];
}

function saveResultToSheet(payload) {
  // TODO: 「フィードバック」や「学習履歴（成績データ）」のシートに、
  // ユーザーID、問題ID、正誤、タイムスタンプを追記（appendRow）するロジックを実装。
}