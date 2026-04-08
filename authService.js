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
                this.saveSession(); // セッションをローカルストレージに保存
                return { success: true, user: this.currentUser };
            } else {
                return { success: false, message: data.message || "認証に失敗しました。" };
            }
        } catch (error) {
            console.error("AuthService Login Error:", error);
            return { success: false, message: "通信エラーが発生しました。" };
        }
    },

    saveSession() {
        if (this.currentUser) {
            localStorage.setItem('brightstage_user_data', JSON.stringify(this.currentUser));
            localStorage.setItem('brightstage_login_time', Date.now().toString());
        }
    },

    loadSession() {
        try {
            const dataStr = localStorage.getItem('brightstage_user_data');
            const timeStr = localStorage.getItem('brightstage_login_time');
            if (dataStr && timeStr) {
                const loginTime = parseInt(timeStr, 10);
                const thirtyDays = 30 * 24 * 60 * 60 * 1000; // 30日間の有効期限（任意に調整可能）
                if (Date.now() - loginTime < thirtyDays) {
                    this.currentUser = JSON.parse(dataStr);
                    return true;
                } else {
                    this.clearSession();
                }
            }
        } catch (e) {
            console.error("Session load error", e);
            this.clearSession();
        }
        return false;
    },

    clearSession() {
        this.currentUser = null;
        localStorage.removeItem('brightstage_user_data');
        localStorage.removeItem('brightstage_login_time');
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
