/** GitHub Pages 用設定（デプロイ後に URL を書き換えてください） */
window.DIGITALDRILL_CONFIG = {
  /** GAS② 作成者権限デプロイの exec URL（JSON API） */
  API_URL: 'https://script.google.com/macros/s/AKfycbwZlw4Q3SGI06YRHogjImWKc25jtLaKAVeEyuAwY0SCY34PvmI14W1LRpRzPxWvTgI/exec',
  /** GAS① ユーザー権限デプロイの exec URL（UserBridge・認証） */
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
  STATIC_MANIFEST_URL: 'data/manifest.json'
};

window.API_URL = window.DIGITALDRILL_CONFIG.API_URL;
window.DASHBOARD_URL = window.DIGITALDRILL_CONFIG.DASHBOARD_URL;
window.STATIC_MANIFEST_URL = window.DIGITALDRILL_CONFIG.STATIC_MANIFEST_URL;
