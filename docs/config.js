/** GitHub Pages 用設定（デプロイ後に URL を書き換えてください） */
window.DIGITALDRILL_CONFIG = {
  /** GAS② 作成者権限デプロイの exec URL（JSON API） */
  API_URL: 'https://script.google.com/macros/s/AKfycbwZlw4Q3SGI06YRHogjImWKc25jtLaKAVeEyuAwY0SCY34PvmI14W1LRpRzPxWvTgI/exec',
  /** GAS① ユーザー権限デプロイの exec URL（認証） */
  DASHBOARD_URL: 'https://script.google.com/macros/s/AKfycbxN9pnUp_mG6QHBKJz2WPaS-YqZlrhUaSI1XjTc3aXbmivNowfQPAi1Vi0WmpmfcDSo/exec',
  /** Google Identity Services（Pages 上のログインボタン用） */
  GOOGLE_CLIENT_ID: '505252303455-84r495bnnsgiefcrv24ro2qtohlgbk2h.apps.googleusercontent.com',
  /** ユーザー Drive 操作用 OAuth スコープ（GCP で Drive API / Sheets API を有効化し、同意画面に登録） */
  GOOGLE_DRIVE_SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
  /**
   * 静的プリセット manifest（Pages 相対パス）。
   * 教材の取得は「キャッシュ → この manifest → GAS② API」のハイブリッド。
   * manifest が未生成でも API 経由で動くが、初回表示を速くするため
   * scripts/export-static.ps1 で生成しておくこと。
   */
  STATIC_MANIFEST_URL: 'data/manifest.json',
  /**
   * プリセット学習の概要集約用 Google フォーム。
   * 送信は GAS の submitFormSummary 経由（fbzx トークン付き POST）。
   * GAS②（API_URL）優先、認証トークン無効時は GAS①（DASHBOARD_URL）へフォールバック。
   * Drive 保存とは独立に起動する。設計契約: docs/FORM_AGGREGATION_SANCTUARY.md §0
   * ACTION_URL が空のときは送信をスキップする。
   * フォーム作成後、ページソースの entry ID と formResponse URL をここに設定する
   * （code.gs の GOOGLE_FORM_ENTRIES と同時更新）。
   */
  GOOGLE_FORM: {
    ACTION_URL: 'https://docs.google.com/forms/d/e/1FAIpQLSfI7mmZPNniyB602utDUnie6W79DQaZgWJghOKTz8TZeiwMPA/formResponse',
    ENTRIES: {
      User_ID: 'entry.2140028729',
      Mode: 'entry.1570326402',
      Set_ID: 'entry.275307888',
      Set_Name: 'entry.289930202',
      Attempt_No: 'entry.2072779523',
      Correct: 'entry.1267466184',
      Total: 'entry.967050124',
      Score: 'entry.1646102233',
      Duration_Sec: 'entry.1713523091',
      Started_At: 'entry.1357277820',
      Ended_At: 'entry.1702093208'
    }
  }
};

window.API_URL = window.DIGITALDRILL_CONFIG.API_URL;
window.DASHBOARD_URL = window.DIGITALDRILL_CONFIG.DASHBOARD_URL;
window.STATIC_MANIFEST_URL = window.DIGITALDRILL_CONFIG.STATIC_MANIFEST_URL;
