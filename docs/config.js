/** GitHub Pages 用設定（デプロイ後に URL を書き換えてください） */
window.BRIGHTSTAGE_CONFIG = {
  /** GAS② 作成者権限デプロイの exec URL（JSON API） */
  API_URL: 'https://script.google.com/macros/s/YOUR_GAS2_DEPLOYMENT_ID/exec',
  /** GAS① ユーザー権限デプロイの exec URL（管理ダッシュボード） */
  DASHBOARD_URL: 'https://script.google.com/macros/s/YOUR_GAS1_DEPLOYMENT_ID/exec'
};

window.API_URL = window.BRIGHTSTAGE_CONFIG.API_URL;
window.DASHBOARD_URL = window.BRIGHTSTAGE_CONFIG.DASHBOARD_URL;
