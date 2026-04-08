// authService.js
// Google認証機能の分離モジュール

const AuthService = {
    currentUser: null,

    async loginWithToken(idToken) {
        try {
            const apiUrl = window.API_URL;
            if (!apiUrl) {
                throw new Error("API_URLが設定されていません。");
            }

            const response = await fetch(apiUrl, {
                method: "POST",
                body: JSON.stringify({
                    action: "login",
                    idToken: idToken
                })
            });

            const data = await response.json();
            
            if (data.status === "success") {
                this.currentUser = data.user;
                return { success: true, user: this.currentUser };
            } else {
                return { success: false, message: data.message || "認証に失敗しました。" };
            }
        } catch (error) {
            console.error("AuthService Login Error:", error);
            return { success: false, message: "通信エラーが発生しました。" };
        }
    },

    isLoggedIn() {
        return this.currentUser !== null;
    }
};

window.AuthService = AuthService;

// Google Identity Servicesが期待するグローバルコールバック
window.handleCredentialResponse = async function(response) {
    const msgEl = document.getElementById('login-msg');
    if (msgEl) {
        msgEl.textContent = "認証中...";
        msgEl.style.color = "#555";
    }

    const result = await AuthService.loginWithToken(response.credential);

    if (result.success) {
        if (msgEl) msgEl.textContent = "";
        
        // メイン側（app.jsなど）に定義された処理を呼び出す
        if (typeof window.onLoginSuccess === 'function') {
            window.onLoginSuccess(result.user);
        }
    } else {
        if (msgEl) {
            msgEl.textContent = "エラー: " + result.message;
            msgEl.style.color = "#f44336";
        }
    }
};
