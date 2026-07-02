import { HubConnection } from '@microsoft/signalr';

// ==========================================
// MEDIA & THEME VARIABLES
// ==========================================
export const LOBBY_ASSETS = {
    bgVideo: '/assets/menu/vd1.mp4',
    bgFallbackImage: '/assets/ui/magical_bg.jpg',
    gameLogo: '/assets/menu/logo.png',
    sfxClick: '/assets/Audio/UI/btnclick.mp3',
    sfxJoin: '/assets/Audio/UI/joinedroom.mp3',
    sfxMessage: '/assets/Audio/UI/msg.mp3',

    // "Mage Arena" Style Theme Colors
    colorBackground: '#14141c',
    colorPrimary: '#e5b35c',
    colorPrimaryHover: '#ffcf77',
    colorBtnBgTop: '#4a3b69',
    colorBtnBgBot: '#2a1f43',
    colorText: '#ffffff',
    colorMuted: '#a1a1aa'
};

// Tier→color scheme (Tier 1-4), matching item/weapon rarity coloring.
export const TIER_COLORS: Record<number, string> = {
    1: '#9e9e9e', // Common - gray
    2: '#4a90e2', // Uncommon - blue
    3: '#a259e6', // Rare - purple
    4: '#e5b35c', // Legendary - gold
};
export function getTierColor(tier: number): string {
    return TIER_COLORS[tier] || TIER_COLORS[1];
}

// ==========================================
// 1. AUTHENTICATION UI
// ==========================================
export class AuthUI {
    private wrapper: HTMLDivElement;
    private onSuccess: () => void;
    private audioClick = new Audio(LOBBY_ASSETS.sfxClick);
    private pendingResendEmail: string = '';
    private resendCooldownTimer: ReturnType<typeof setInterval> | null = null;

    constructor(onSuccess: () => void) {
        this.onSuccess = onSuccess;
        this.audioClick.load();

        this.wrapper = document.createElement('div');
        this.wrapper.id = 'auth-ui-wrapper';
        document.body.appendChild(this.wrapper);

        this.render();
        this.checkVerifyToken();
        this.checkResetToken();
        this.fetchVersion(); // <<< NEW
        this.bindAudio();
    }

    private async fetchVersion() {
        try {
            const res = await fetch('/api/auth/version');
            const data = await res.json();
            if (res.ok) {
                const vDiv = document.getElementById('auth-version-display');
                if (vDiv) vDiv.innerText = data.version;
            }
        } catch { }
    }

    private checkResetToken() {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('reset_token');
        if (token) {
            this.showTab('reset');
        }
    }

    private playSound(audio: HTMLAudioElement) {
        audio.currentTime = 0;
        audio.play().catch(e => console.warn("Audio play blocked by browser:", e));
    }

    private async checkVerifyToken() {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('verify_token');
        if (!token) return;

        try {
            const res = await fetch(`/api/auth/verify?token=${token}`);
            const data = await res.json();
            if (res.ok) {
                this.showNotice('✅ ' + data.message + ' You can now log in.', 'success');
            } else {
                this.showNotice('❌ ' + data.error, 'error');
            }
            window.history.replaceState({}, '', window.location.pathname);
        } catch {
            this.showNotice('❌ Verification failed. Please try again.', 'error');
        }
    }

    private render() {
        this.wrapper.innerHTML = `
            <style>
                #auth-ui-wrapper { 
                    position: fixed; inset: 0; width: 100vw; height: 100vh;
                    font-family: 'Segoe UI', Tahoma, sans-serif; color: ${LOBBY_ASSETS.colorText};
                    background: ${LOBBY_ASSETS.colorBackground};
                    z-index: 999999; overflow: hidden;
                }
                #bg-video { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; object-fit: cover; z-index: 1; pointer-events: none; }
                .video-overlay { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.6); z-index: 2; pointer-events: none; }
                .ui-content { position: relative; z-index: 10; width: 100vw; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
                
                .game-logo { margin-bottom: 30px; user-select: none; }
                .logo-img { width: clamp(250px, 35vw, 600px); height: auto; filter: drop-shadow(0 0 10px rgba(0,0,0,0.8)); transition: transform 0.3s ease; }
                
                .auth-panel { background: rgba(0,0,0,0.7); border: 2px solid ${LOBBY_ASSETS.colorPrimary}; border-radius: 8px; padding: 40px; width: 380px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); }
                .auth-subtitle { color: ${LOBBY_ASSETS.colorMuted}; font-size: 13px; text-align: center; margin-bottom: 25px; text-transform: uppercase; letter-spacing: 1px; }
                
                .auth-tabs { display: flex; margin-bottom: 25px; border-bottom: 2px solid #333; }
                .auth-tab { flex: 1; padding: 10px; cursor: pointer; text-align: center; color: #777; font-size: 14px; font-weight: bold; text-transform: uppercase; transition: 0.2s; border-bottom: 2px solid transparent; margin-bottom: -2px; }
                .auth-tab.active { color: ${LOBBY_ASSETS.colorPrimary}; border-bottom-color: ${LOBBY_ASSETS.colorPrimary}; text-shadow: 0 0 5px rgba(229, 179, 92, 0.5); }
                .auth-tab:hover:not(.active) { color: #fff; }

                .input-group { display: flex; flex-direction: column; margin-bottom: 15px; width: 100%; }
                .input-label { font-size: 12px; color: ${LOBBY_ASSETS.colorMuted}; margin-bottom: 5px; text-transform: uppercase; font-weight: bold; }
                .lobby-input { background: rgba(0,0,0,0.6); border: 2px solid #444; color: white; padding: 12px 15px; border-radius: 6px; font-size: 14px; outline: none; transition: 0.2s; box-sizing: border-box; width: 100%; }
                .lobby-input:focus { border-color: ${LOBBY_ASSETS.colorPrimary}; box-shadow: 0 0 10px rgba(229, 179, 92, 0.3); }
                
                .lobby-btn { 
                    width: 100%; padding: 14px; margin-top: 10px;
                    background: linear-gradient(180deg, ${LOBBY_ASSETS.colorBtnBgTop} 0%, ${LOBBY_ASSETS.colorBtnBgBot} 100%);
                    border: 2px solid ${LOBBY_ASSETS.colorPrimary}; border-radius: 8px; font-size: 16px; font-weight: bold; color: white;
                    cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 2px;
                    box-shadow: 0 6px 15px rgba(0,0,0,0.5), inset 0 0 10px rgba(0,0,0,0.3);
                }
                .lobby-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .lobby-btn:hover:not(:disabled) { 
                    border-color: ${LOBBY_ASSETS.colorPrimaryHover}; transform: translateY(-2px);
                    box-shadow: 0 8px 20px rgba(0,0,0,0.6), inset 0 0 15px rgba(229, 179, 92, 0.2); 
                }

                .auth-notice { padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 20px; display: none; text-align: center; font-weight: bold; }
                .auth-notice.success { background: rgba(76, 175, 80, 0.2); color: #81c784; border: 1px solid #4caf50; }
                .auth-notice.error   { background: rgba(244, 67, 54, 0.2); color: #e57373; border: 1px solid #f44336; }
                .resend-btn {
    width:100%; padding:10px; margin-top:8px;
    background:transparent; border:2px solid ${LOBBY_ASSETS.colorPrimary};
    border-radius:6px; font-size:13px; color:${LOBBY_ASSETS.colorPrimary};
    cursor:pointer; transition:all 0.2s; text-transform:uppercase; letter-spacing:1px;
}
.resend-btn:hover:not(:disabled) { background:rgba(229,179,92,0.12); }
.resend-btn:disabled { opacity:0.45; cursor:not-allowed; }

            </style>

            <video autoplay muted loop playsinline id="bg-video">
                <source src="${LOBBY_ASSETS.bgVideo}" type="video/mp4">
            </video>
            <div class="video-overlay"></div>

            <div id="auth-version-display" style="position:fixed; bottom:10px; left:10px; color:#aaa; font-size:14px; z-index: 1000000; font-family: monospace; text-shadow: 1px 1px 2px black;">Connecting...</div>

            <div class="ui-content">
                <div class="game-logo">
                    <img src="${LOBBY_ASSETS.gameLogo}" class="logo-img" alt="Arena Survivor" />
                </div>

                <div class="auth-panel">
                    <div class="auth-subtitle">Save your progress & join the realm</div>
                   <div class="auth-notice" id="auth-notice"></div>
<div id="resend-container" style="display:none; margin-top:6px;">
    <button class="resend-btn" id="btn-resend">📧 Resend Verification Email</button>
</div>


                    <div class="auth-tabs">
                        <div class="auth-tab active" id="tab-login"  onclick="authShowTab('login')">Login</div>
                        <div class="auth-tab"        id="tab-register" onclick="authShowTab('register')">Register</div>
                    </div>

                    <div id="form-login" style="display:flex; flex-direction:column;">
                        <div class="input-group">
                            <span class="input-label">Email Address</span>
                            <input id="login-email" type="email" class="lobby-input" autocomplete="email" />
                        </div>
                        <div class="input-group">
                            <span class="input-label">Password</span>
                            <input id="login-password" type="password" class="lobby-input" autocomplete="current-password" />
                        </div>
                        <button class="lobby-btn" id="btn-login">ENTER THE ARENA</button>
                        <div style="text-align: center; margin-top: 15px;">
                            <a href="#" onclick="authShowTab('forgot')" style="color: #a1a1aa; font-size: 13px; text-decoration: none; transition: color 0.2s;" onmouseover="this.style.color='#e5b35c'" onmouseout="this.style.color='#a1a1aa'">Forgot Password?</a>
                        </div>
                    </div>

                    <div id="form-register" style="display:none; flex-direction:column;">
                        <div class="input-group">
                            <span class="input-label">Email Address</span>
                            <input id="reg-email" type="email" class="lobby-input" autocomplete="email" />
                        </div>
                        <div class="input-group">
                            <span class="input-label">Username (3–20 chars)</span>
                            <input id="reg-username" type="text" class="lobby-input" autocomplete="username" />
                        </div>
                        <div class="input-group">
                            <span class="input-label">Password (min 8 chars)</span>
                            <input id="reg-password" type="password" class="lobby-input" autocomplete="new-password" />
                        </div>
                        <button class="lobby-btn" id="btn-register">CREATE ACCOUNT</button>
                    </div>

                    <div id="form-forgot" style="display:none; flex-direction:column;">
                        <div class="auth-subtitle" style="margin-bottom:15px; border-bottom:1px solid #333; padding-bottom:10px;">Reset Password</div>
                        <div class="input-group">
                            <span class="input-label">Email Address</span>
                            <input id="forgot-email" type="email" class="lobby-input" autocomplete="email" />
                        </div>
                        <button class="lobby-btn" id="btn-forgot">SEND RESET LINK</button>
                        <div style="text-align: center; margin-top: 15px;">
                            <a href="#" onclick="authShowTab('login')" style="color: #e5b35c; font-size: 13px; text-decoration: none;">Back to Login</a>
                        </div>
                    </div>

                    <div id="form-reset" style="display:none; flex-direction:column;">
                        <div class="auth-subtitle" style="margin-bottom:15px; border-bottom:1px solid #333; padding-bottom:10px;">Create a new password</div>
                        <div class="input-group">
                            <span class="input-label">New Password (min 8 chars)</span>
                            <input id="reset-password" type="password" class="lobby-input" />
                        </div>
                        <button class="lobby-btn" id="btn-reset">UPDATE PASSWORD</button>
                    </div>
                </div>
            </div>
        `;

        (window as any).authShowTab = (tab: string) => this.showTab(tab as any);

        this.wrapper.querySelectorAll('input').forEach(el => {
            el.addEventListener('keydown', e => e.stopPropagation());
            el.addEventListener('keyup', e => e.stopPropagation());
        });

        document.getElementById('btn-login')!.addEventListener('click', () => this.handleLogin());
        document.getElementById('btn-register')!.addEventListener('click', () => this.handleRegister());
        document.getElementById('btn-forgot')!.addEventListener('click', () => this.handleForgotPassword());
        document.getElementById('btn-reset')!.addEventListener('click', () => this.handleResetPassword());
        document.getElementById('btn-resend')!.addEventListener('click', () => this.handleResendVerification());


        ['login-email', 'login-password'].forEach(id => document.getElementById(id)!.addEventListener('keydown', e => { if (e.key === 'Enter') this.handleLogin(); }));
        ['reg-email', 'reg-username', 'reg-password'].forEach(id => document.getElementById(id)!.addEventListener('keydown', e => { if (e.key === 'Enter') this.handleRegister(); }));
    }

    private bindAudio() {
        const playClick = () => this.playSound(this.audioClick);
        document.querySelectorAll('.auth-tab, .lobby-btn').forEach(el => el.addEventListener('click', playClick));

        const logo = this.wrapper.querySelector('.logo-img') as HTMLImageElement;
        document.querySelectorAll('.lobby-btn').forEach(btn => {
            btn.addEventListener('mouseenter', () => logo.style.transform = 'scale(1.08)');
            btn.addEventListener('mouseleave', () => logo.style.transform = 'scale(1)');
        });
    }

    private showTab(tab: 'login' | 'register' | 'forgot' | 'reset') {
        const isLogin = tab === 'login';
        const isReg = tab === 'register';
        const isForgot = tab === 'forgot';
        const isReset = tab === 'reset';

        (document.getElementById('form-login') as HTMLElement).style.display = isLogin ? 'flex' : 'none';
        (document.getElementById('form-register') as HTMLElement).style.display = isReg ? 'flex' : 'none';
        (document.getElementById('form-forgot') as HTMLElement).style.display = isForgot ? 'flex' : 'none';
        (document.getElementById('form-reset') as HTMLElement).style.display = isReset ? 'flex' : 'none';

        document.getElementById('tab-login')!.classList.toggle('active', isLogin);
        document.getElementById('tab-register')!.classList.toggle('active', isReg);

        (document.querySelector('.auth-tabs') as HTMLElement).style.display = (isForgot || isReset) ? 'none' : 'flex';

        this.hideNotice();
        const resendEl = document.getElementById('resend-container');
        if (resendEl) resendEl.style.display = 'none';
    }

    private showNotice(msg: string, type: 'success' | 'error' | 'info') {
        const el = document.getElementById('auth-notice')!;
        el.textContent = msg;
        el.className = `auth-notice ${type}`;
        el.style.display = 'block';
    }

    private hideNotice() {
        document.getElementById('auth-notice')!.style.display = 'none';
    }

    private setLoading(btnId: string, loading: boolean) {
        const btn = document.getElementById(btnId) as HTMLButtonElement;
        btn.disabled = loading;
        btn.textContent = loading ? 'PLEASE WAIT...' : (btnId === 'btn-login' ? 'ENTER THE ARENA' : 'SUBMITTING...');
    }

    private async handleLogin() {
        const email = (document.getElementById('login-email') as HTMLInputElement).value.trim();
        const password = (document.getElementById('login-password') as HTMLInputElement).value;
        if (!email || !password) { this.showNotice('Please fill in all fields.', 'error'); return; }

        this.setLoading('btn-login', true);
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();

            if (res.ok) {
                // 1. Save the credentials sent by the backend to localStorage
                localStorage.setItem('arena_jwt', data.token);
                localStorage.setItem('arena_username', data.username);
                localStorage.setItem('arena_playerId', data.playerId);

                // 2. Show a proper success message
                this.showNotice('✅ Login successful! Entering the arena...', 'success');

                // 3. Trigger the onSuccess callback to close the UI and start the game
                if (this.onSuccess) {
                    this.onSuccess();
                }
            } else {
                // Keep your existing error handling for unauthorized/unverified users
                this.showNotice('❌ ' + data.error, 'error');
                if (data.error?.includes('verify')) {
                    this.pendingResendEmail = email;
                    const c = document.getElementById('resend-container');
                    if (c) c.style.display = 'block';
                }
            }

        } catch {
            this.showNotice('❌ Connection error.', 'error');
        } finally {
            this.setLoading('btn-login', false);
        }
    }

    private async handleRegister() {
        const email = (document.getElementById('reg-email') as HTMLInputElement).value.trim();
        const username = (document.getElementById('reg-username') as HTMLInputElement).value.trim();
        const password = (document.getElementById('reg-password') as HTMLInputElement).value;
        if (!email || !username || !password) { this.showNotice('Please fill in all fields.', 'error'); return; }

        this.setLoading('btn-register', true);
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, username, password })
            });
            const data = await res.json();
            if (res.ok) {
                this.pendingResendEmail = email;
                const msg = data.message ?? 'Account created! Check your email to verify.';
                this.showNotice('✅ ' + msg, 'success');
                const c = document.getElementById('resend-container');
                if (c) c.style.display = 'block';
                // Redirect to login after 5 s — enough time to hit Resend if needed.
                setTimeout(() => this.showTab('login'), 5000);
            } else {
                this.showNotice('❌ ' + data.error, 'error');
            }
        } catch {
            this.showNotice('❌ Connection error.', 'error');
        } finally {
            this.setLoading('btn-register', false);
        }
    }

    private async handleForgotPassword() {
        const email = (document.getElementById('forgot-email') as HTMLInputElement).value.trim();
        if (!email) { this.showNotice('Please enter your email.', 'error'); return; }

        this.setLoading('btn-forgot', true);
        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (res.ok) {
                this.showNotice('✅ ' + data.message, 'success');
            } else {
                this.showNotice('❌ ' + data.error, 'error');
            }
        } catch {
            this.showNotice('❌ Connection error.', 'error');
        } finally {
            this.setLoading('btn-forgot', false);
        }
    }

    private async handleResetPassword() {
        const password = (document.getElementById('reset-password') as HTMLInputElement).value;
        const params = new URLSearchParams(window.location.search);
        const token = params.get('reset_token');

        if (!password || !token) { this.showNotice('Please enter a new password.', 'error'); return; }

        this.setLoading('btn-reset', true);
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword: password })
            });
            const data = await res.json();
            if (res.ok) {
                this.showNotice('✅ ' + data.message, 'success');
                window.history.replaceState({}, '', window.location.pathname);
                setTimeout(() => this.showTab('login'), 2000);
            } else {
                this.showNotice('❌ ' + data.error, 'error');
            }
        } catch {
            this.showNotice('❌ Connection error.', 'error');
        } finally {
            this.setLoading('btn-reset', false);
        }
    }

    private async handleResendVerification() {
        if (!this.pendingResendEmail) return;
        const btn = document.getElementById('btn-resend') as HTMLButtonElement;

        try {
            btn.disabled = true;
            btn.textContent = 'SENDING...';

            const res = await fetch('/api/auth/resend-verification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.pendingResendEmail })
            });
            const data = await res.json();

            if (res.status === 429) this.showNotice('⏳ ' + data.error, 'error');
            else if (res.ok) this.showNotice('✅ ' + data.message, 'success');
            else this.showNotice('❌ ' + data.error, 'error');
        } catch {
            this.showNotice('❌ Connection error.', 'error');
        }

        // 60-second client-side cooldown (mirrors the server rate limit)
        let seconds = 60;
        btn.textContent = `Resend in ${seconds}s`;
        if (this.resendCooldownTimer) clearInterval(this.resendCooldownTimer);
        this.resendCooldownTimer = setInterval(() => {
            seconds--;
            if (seconds <= 0) {
                clearInterval(this.resendCooldownTimer!);
                this.resendCooldownTimer = null;
                btn.disabled = false;
                btn.textContent = '📧 Resend Verification Email';
            } else {
                btn.textContent = `Resend in ${seconds}s`;
            }
        }, 1000);
    }
}


// ==========================================
// 2. LOBBY UI (SignalR Connected)
// ==========================================
export class LobbyUI {
    private playerId: string;
    private wrapper: HTMLDivElement;
    private playerName: string = "Guest";
    private cachedRooms: any[] = [];
    private masterConfigs: any = null;

    private connection: HubConnection;
    private getIconBase64: (textureKey: string, frame: number) => string | null;
    private onJoinMatch: () => void;
    private targetRoomIdForPassword: string = "";

    private lastPlayerCount: number = 0;

    private audioClick = new Audio(LOBBY_ASSETS.sfxClick);
    private pendingResendEmail: string = '';
    private resendCooldownTimer: ReturnType<typeof setInterval> | null = null;
    private audioJoin = new Audio(LOBBY_ASSETS.sfxJoin);
    private audioMessage = new Audio(LOBBY_ASSETS.sfxMessage);

    constructor(connection: HubConnection, getIconBase64: (key: string, frame: number) => string | null, onJoinMatch: () => void, playerId: string) {
        this.playerId = playerId;
        this.connection = connection;
        this.getIconBase64 = getIconBase64;
        this.onJoinMatch = onJoinMatch;

        this.playerName = localStorage.getItem('arena_username') ?? "Traveler";

        this.audioClick.load();
        this.audioJoin.load();
        this.audioMessage.load();

        this.wrapper = document.createElement('div');
        this.wrapper.id = 'lobby-ui-wrapper';
        this.injectCSS();
        document.body.appendChild(this.wrapper);
        this.buildHTML();
    }

    private playSound(audio: HTMLAudioElement) {
        audio.currentTime = 0;
        audio.play().catch(e => console.warn("Audio play blocked by browser:", e));
    }

    private applyKeyboardFix() {
        const inputs = this.wrapper.querySelectorAll('input, select');
        inputs.forEach(el => {
            el.addEventListener('keydown', (e: Event) => e.stopPropagation());
            el.addEventListener('keyup', (e: Event) => e.stopPropagation());
            el.addEventListener('keypress', (e: Event) => e.stopPropagation());
        });
    }

    private showToast(title: string, message: string, type: 'error' | 'success' | 'info' = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<div style="font-size: 12px; color: ${LOBBY_ASSETS.colorMuted}; text-transform: uppercase;">${title}</div><div>${message}</div>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease-out forwards';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    private isCharacterLocked(char: any): { locked: boolean, missing: { id: string, name: string, textureKey: string, iconFrame: number }[] } {
        return this.isGearLocked(char.requiredAchievements || char.RequiredAchievements || []);
    }

    private isGearLocked(required: string[]): { locked: boolean, missing: { id: string, name: string, textureKey: string, iconFrame: number }[] } {
        if (!required || required.length === 0) return { locked: false, missing: [] };

        const unlocked: string[] = this.masterConfigs?.myUnlockedAchievements || this.masterConfigs?.MyUnlockedAchievements || [];
        const missingIds = required.filter(id => !unlocked.includes(id));
        if (missingIds.length === 0) return { locked: false, missing: [] };

        const achievements = this.masterConfigs?.achievements || this.masterConfigs?.Achievements || {};
        const missing = missingIds.map(id => {
            const a = achievements[id];
            return {
                id,
                name: a ? (this.pick(a, 'name') || id) : id,
                textureKey: a ? (this.pick(a, 'textureKey') || '') : '',
                iconFrame: a ? (this.pick(a, 'iconFrame') ?? 0) : 0
            };
        });
        return { locked: true, missing };
    }

    // Icon + name badges for the roomier Collection cards.
    private buildLockOverlay(missing: { id: string, name: string, textureKey: string, iconFrame: number }[]): string {
        const badges = missing.map(m => {
            const base64Img = m.textureKey ? this.getIconBase64(m.textureKey, m.iconFrame) : null;
            const iconHtml = base64Img
                ? `<img src="${base64Img}" style="width:18px; height:18px; object-fit:contain; image-rendering:pixelated;" />`
                : `<span style="font-size:13px;">🏆</span>`;
            return `<div class="lock-req-badge">${iconHtml}<span>${m.name}</span></div>`;
        }).join('');
        return `<div class="lock-overlay"><div class="lock-icon">🔒</div><div class="lock-req-label">Requires</div><div class="lock-req-list">${badges}</div></div>`;
    }

    private renderCharacterGrid() {
        if (!this.masterConfigs?.characters) return;
        const grid = document.getElementById('character-grid')!;
        grid.innerHTML = '';

        const readyBtn = document.getElementById('btn-toggle-ready')!;
        const isLocalPlayerReady = readyBtn.innerText.includes("CANCEL");

        Object.values(this.masterConfigs.characters).forEach((char: any) => {
            const card = document.createElement('div');
            card.className = 'char-card';

            const textureKey = char.textureKey || char.TextureKey;
            const frame = char.iconFrame ?? char.IconFrame ?? 0;
            const base64Img = this.getIconBase64(textureKey, frame);

            const iconHtml = base64Img
                ? `<img src="${base64Img}" style="width: 48px; height: 48px; margin-bottom: 10px; image-rendering: pixelated; object-fit: contain;" />`
                : `<div style="width: 48px; height: 48px; background: #111; border-radius: 4px; margin-bottom: 10px; display:flex; justify-content:center; align-items:center; font-size:24px; font-weight:bold; color:${LOBBY_ASSETS.colorPrimary};">${(char.name || "C").charAt(0).toUpperCase()}</div>`;

            card.innerHTML = `
            ${iconHtml}
            <div style="font-weight:bold; font-size:14px; margin-bottom: 5px;">${char.name || char.Id}</div>
        `;

            const { locked, missing } = this.isCharacterLocked(char);

            if (locked) {
                const overlay = document.createElement('div');
                overlay.className = 'lock-overlay';
                overlay.innerHTML = `<div class="lock-icon">🔒</div><div class="lock-req">Requires: ${missing.map(m => m.name).join(', ')}</div>`;
                card.appendChild(overlay);
            } else if (isLocalPlayerReady) {
                card.style.opacity = '0.5';
                card.style.cursor = 'not-allowed';
            }

            card.onclick = () => {
                if (locked || isLocalPlayerReady) return;
                this.connection.invoke("SelectCharacter", char.id || char.Id);
                document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
            };
            grid.appendChild(card);
        });
    }

    private cachedAchievements: any[] = [];
    private activeAchFilter: string = 'all';
    private activeCollectionTab: string = 'enemies';

    private loadAchievements() {
        const grid = document.getElementById('achievements-grid')!;
        grid.innerHTML = `<div style="padding: 20px; color: ${LOBBY_ASSETS.colorMuted};">Loading...</div>`;

        this.connection.invoke("GetAchievementCatalog").then((catalog: any[]) => {
            this.cachedAchievements = catalog || [];
            this.renderAchievementGrid();
        }).catch(err => {
            console.error("Failed to load achievements:", err);
            grid.innerHTML = `<div style="padding: 20px; color: #ff6666;">Failed to load achievements.</div>`;
        });
    }

    private renderAchievementGrid() {
        const grid = document.getElementById('achievements-grid')!;
        grid.innerHTML = '';

        if (this.cachedAchievements.length === 0) {
            grid.innerHTML = `<div style="padding: 20px; color: ${LOBBY_ASSETS.colorMuted};">No achievements available yet.</div>`;
            return;
        }

        const filtered = this.cachedAchievements.filter(a => {
            switch (this.activeAchFilter) {
                case 'unlocked': return !!a.isUnlocked;
                case 'locked': return !a.isUnlocked;
                case 'tier1': return (a.tier ?? 1) === 1;
                case 'tier2': return (a.tier ?? 1) === 2;
                case 'tier3': return (a.tier ?? 1) === 3;
                case 'tier4': return (a.tier ?? 1) === 4;
                default: return true;
            }
        });

        if (filtered.length === 0) {
            grid.innerHTML = `<div style="padding: 20px; color: ${LOBBY_ASSETS.colorMuted};">No achievements match this filter.</div>`;
            return;
        }

        // Unlocked first, then by tier descending, so the good stuff isn't buried.
        const sorted = [...filtered].sort((a, b) => {
            if (a.isUnlocked !== b.isUnlocked) return a.isUnlocked ? -1 : 1;
            return (b.tier || 0) - (a.tier || 0);
        });

        sorted.forEach(a => this.renderAchievementCard(grid, a));
    }

    private renderAchievementCard(grid: HTMLElement, a: any) {
        const tier = a.tier ?? 1;
        const color = getTierColor(tier);
        const isUnlocked = !!a.isUnlocked;
        const isHidden = !!a.isHidden;

        const card = document.createElement('div');
        card.className = `ach-card ${isUnlocked ? 'unlocked' : 'locked'}`;
        // Border always reflects tier color; the .locked class's grayscale/opacity filter
        // handles the "not yet earned" dimming on top of it.
        card.style.borderColor = color;

        if (isHidden) {
            card.innerHTML = `
                <div class="ach-icon" style="background:#1a1a1a; color:#555; border: 2px solid ${color};">?</div>
                <div class="ach-body">
                    <div class="ach-name" style="color:#666;">Hidden Achievement</div>
                    <div class="ach-desc">Keep playing to discover this one.</div>
                </div>
            `;
            grid.appendChild(card);
            return;
        }

        const base64Img = a.textureKey ? this.getIconBase64(a.textureKey, a.iconFrame || 0) : null;
        const iconHtml = base64Img
            ? `<img src="${base64Img}" style="width:100%; height:100%; object-fit:contain; image-rendering:pixelated;" />`
            : (a.name || "A").charAt(0).toUpperCase();

        const threshold = a.threshold || 1;
        const progress = Math.min(a.progress || 0, threshold);
        const pct = Math.max(0, Math.min(100, (progress / threshold) * 100));

        const progressHtml = isUnlocked
            ? `<div class="ach-progress-label">Unlocked${a.unlockedAt ? ' — ' + new Date(a.unlockedAt).toLocaleDateString() : ''}</div>`
            : `
                <div class="ach-progress-track"><div class="ach-progress-fill" style="width:${pct}%; background:${color};"></div></div>
                <div class="ach-progress-label">${Math.floor(progress)} / ${threshold}</div>
            `;

        card.innerHTML = `
            ${isUnlocked ? `<div class="ach-unlocked-badge">✅</div>` : ''}
            <div class="ach-icon" style="background:${color}22; border: 2px solid ${color};">${iconHtml}</div>
            <div class="ach-body">
                <div class="ach-name" style="color:${isUnlocked ? color : '#ccc'};">${a.name}</div>
                <div class="ach-desc">${a.description || ''}</div>
                ${progressHtml}
            </div>
        `;
        grid.appendChild(card);
    }

    // --- Collection ---

    // The server sends handshake payloads with inconsistent casing depending on source
    // (anonymous SignalR objects vs raw config dictionaries), so read defensively both ways —
    // same pattern already used for char.textureKey / char.TextureKey elsewhere in this file.
    private pick(obj: any, key: string): any {
        if (!obj) return undefined;
        const lower = key.charAt(0).toLowerCase() + key.slice(1);
        const upper = key.charAt(0).toUpperCase() + key.slice(1);
        return obj[lower] !== undefined ? obj[lower] : obj[upper];
    }

    private formatStatName(key: string): string {
        const withSpaces = key.replace(/([A-Z])/g, ' $1').trim();
        return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
    }

    private formatNumber(n: number): string {
        if (n === undefined || n === null || isNaN(n)) return '0';
        if (Number.isInteger(n)) return n.toString();
        return n.toFixed(2).replace(/\.?0+$/, '');
    }

    private buildIconHtml(entry: any, fallbackLetter: string): string {
        const textureKey = this.pick(entry, 'textureKey');
        const frame = this.pick(entry, 'iconFrame') ?? 0;
        const base64Img = textureKey ? this.getIconBase64(textureKey, frame) : null;
        return base64Img ? `<img src="${base64Img}" />` : fallbackLetter;
    }

    // Renders a badge for a skill/effect id, resolving its display name + icon from the
    // matching config dictionary (masterConfigs.skills or masterConfigs.effects) so the
    // collection shows readable names/art instead of raw config ids.
    private buildRefBadge(id: string, sourceDict: any): string {
        const cfg = sourceDict ? sourceDict[id] : null;
        const name = cfg ? (this.pick(cfg, 'name') || id) : id;
        const textureKey = cfg ? this.pick(cfg, 'textureKey') : null;
        const frame = cfg ? (this.pick(cfg, 'iconFrame') ?? 0) : 0;
        const base64Img = textureKey ? this.getIconBase64(textureKey, frame) : null;
        const iconHtml = base64Img
            ? `<img src="${base64Img}" style="width:16px; height:16px; object-fit:contain; image-rendering:pixelated; margin-right:5px; vertical-align:middle;" />`
            : '';
        return `<span class="coll-badge">${iconHtml}${name}</span>`;
    }

    private buildRefBadgeRow(ids: string[], sourceDict: any): string {
        if (!ids || ids.length === 0) return '';
        return ids.map(id => this.buildRefBadge(id, sourceDict)).join('');
    }

    // Always re-fetches, unlike the initial handshake — otherwise newly-unlocked achievements
    // earned mid-session (after Collection was first opened) would stay stale until reload.
    private refreshCollectionCatalog() {
        const grid = document.getElementById('collection-grid')!;
        grid.innerHTML = `<div class="coll-empty">Loading collection data...</div>`;

        this.connection.invoke("GetCollectionCatalog").then((payload: any) => {
            this.masterConfigs = { ...(this.masterConfigs || {}), ...payload };
            this.renderCollectionGrid();
        }).catch(err => {
            console.error("Failed to load collection catalog:", err);
            grid.innerHTML = `<div class="coll-empty">Failed to load collection data.</div>`;
        });
    }

    private renderCollectionGrid() {
        const grid = document.getElementById('collection-grid')!;

        if (!this.masterConfigs) {
            this.refreshCollectionCatalog();
            return;
        }

        grid.innerHTML = '';

        const sourceMap: Record<string, any> = {
            enemies: this.masterConfigs.enemies || this.masterConfigs.Enemies || {},
            weapons: this.masterConfigs.weapons || this.masterConfigs.Weapons || {},
            items: this.masterConfigs.items || this.masterConfigs.Items || {},
            characters: this.masterConfigs.characters || this.masterConfigs.Characters || {},
        };

        const searchQuery = (document.getElementById('coll-search') as HTMLInputElement).value.trim().toLowerCase();
        let entries: any[] = Object.values(sourceMap[this.activeCollectionTab] || {});

        if (searchQuery) {
            entries = entries.filter(e => {
                const name = (this.pick(e, 'name') || this.pick(e, 'id') || '').toString().toLowerCase();
                return name.includes(searchQuery);
            });
        }

        if (entries.length === 0) {
            grid.innerHTML = `<div class="coll-empty">No entries found.</div>`;
            return;
        }

        // Tier ascending (weaker/common first), then alphabetical within a tier.
        entries.sort((a, b) => {
            const tierA = this.pick(a, 'tier') ?? 0;
            const tierB = this.pick(b, 'tier') ?? 0;
            if (tierA !== tierB) return tierA - tierB;
            return (this.pick(a, 'name') || '').localeCompare(this.pick(b, 'name') || '');
        });

        entries.forEach(entry => {
            let card: HTMLElement;
            switch (this.activeCollectionTab) {
                case 'weapons': card = this.buildWeaponCard(entry); break;
                case 'items': card = this.buildItemCard(entry); break;
                case 'characters': card = this.buildCharacterCollectionCard(entry); break;
                default: card = this.buildEnemyCard(entry); break;
            }
            grid.appendChild(card);
        });
    }

    private buildEnemyCard(e: any): HTMLElement {
        const card = document.createElement('div');
        card.className = 'coll-card';
        const tier = this.pick(e, 'tier') ?? 1;
        const color = getTierColor(tier);

        const name = this.pick(e, 'name') || this.pick(e, 'id');
        const isBoss = !!this.pick(e, 'isBoss');
        const minWave = this.pick(e, 'minWave') ?? 1;
        const maxWave = this.pick(e, 'maxWave') ?? 999;
        const baseStats = this.pick(e, 'baseStats') || {};
        const movesRandomly = !!this.pick(e, 'movesRandomly');
        const hitRadius = this.pick(e, 'hitRadius') ?? 0;
        const attackRadius = this.pick(e, 'attackRadius') ?? 0;
        const weaponDropChance = this.pick(e, 'weaponDropChance') ?? 0;
        const itemDropChance = this.pick(e, 'itemDropChance') ?? 0;
        const startingWeapons: string[] = this.pick(e, 'startingWeapons') || [];
        const startingItems: string[] = this.pick(e, 'startingItems') || [];
        const startingSkills: string[] = this.pick(e, 'startingSkills') || [];
        const onDeathSkills: string[] = this.pick(e, 'onDeathSkills') || [];
        const skillsSource = this.masterConfigs?.skills || this.masterConfigs?.Skills || {};

        const statBadges = Object.entries(baseStats)
            .filter(([, v]) => (v as number) !== 0)
            .map(([k, v]) => `<div class="coll-stat"><span class="coll-stat-label">${this.formatStatName(k)}</span><span class="coll-stat-value">${this.formatNumber(v as number)}</span></div>`)
            .join('');

        card.innerHTML = `
            <div class="coll-card-header">
                <div class="coll-icon" style="border: 2px solid ${color};">${this.buildIconHtml(e, (name || '?').charAt(0).toUpperCase())}</div>
                <div class="coll-title-block">
                    <div class="coll-name">${name}</div>
                    <div class="coll-subtitle">Wave ${minWave}${maxWave < 999 ? '-' + maxWave : '+'}${movesRandomly ? ' • Wanders' : ''}</div>
                </div>
            </div>
            <div class="coll-tags">
                <span class="coll-tag coll-tag-tier" style="background:${color};">Tier ${tier}</span>
                ${isBoss ? `<span class="coll-tag coll-tag-boss">Boss</span>` : ''}
            </div>
            <div class="coll-stat-grid">
                ${statBadges}
                <div class="coll-stat"><span class="coll-stat-label">Hit Radius</span><span class="coll-stat-value">${hitRadius}</span></div>
                <div class="coll-stat"><span class="coll-stat-label">Attack Range</span><span class="coll-stat-value">${attackRadius}</span></div>
                ${weaponDropChance > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Weapon Drop</span><span class="coll-stat-value">${Math.round(weaponDropChance * 100)}%</span></div>` : ''}
                ${itemDropChance > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Item Drop</span><span class="coll-stat-value">${Math.round(itemDropChance * 100)}%</span></div>` : ''}
            </div>
            ${(startingWeapons.length || startingItems.length) ? `
                <div>
                    <div class="coll-section-label">Starting Gear</div>
                    <div class="coll-badge-row">
                        ${startingWeapons.map(w => `<span class="coll-badge">${w}</span>`).join('')}
                        ${startingItems.map(i => `<span class="coll-badge">${i}</span>`).join('')}
                    </div>
                </div>` : ''}
            ${startingSkills.length ? `
                <div>
                    <div class="coll-section-label">Skills</div>
                    <div class="coll-badge-row">${this.buildRefBadgeRow(startingSkills, skillsSource)}</div>
                </div>` : ''}
            ${onDeathSkills.length ? `
                <div>
                    <div class="coll-section-label">On Death</div>
                    <div class="coll-badge-row">${this.buildRefBadgeRow(onDeathSkills, skillsSource)}</div>
                </div>` : ''}
        `;
        card.style.borderColor = color;
        return card;
    }

    private buildWeaponCard(w: any): HTMLElement {
        const card = document.createElement('div');
        card.className = 'coll-card';
        const tier = this.pick(w, 'tier') ?? 1;
        const color = getTierColor(tier);

        const name = this.pick(w, 'name') || this.pick(w, 'id');
        const family = this.pick(w, 'weaponFamily') || '';
        const price = this.pick(w, 'price') ?? 0;
        const cooldown = this.pick(w, 'cooldownSeconds') ?? 0;
        const melee = this.pick(w, 'meleeDamage') ?? 0;
        const ranged = this.pick(w, 'rangedDamage') ?? 0;
        const magic = this.pick(w, 'magicDamage') ?? 0;
        const range = this.pick(w, 'range') ?? 0;
        const projCount = this.pick(w, 'projectileCount') ?? 1;
        const maxLevel = this.pick(w, 'maxLevel') ?? 5;
        const allowDupes = !!this.pick(w, 'allowDuplicates');
        const statBonuses = this.pick(w, 'statBonuses') || {};
        const grantedSkills: string[] = this.pick(w, 'grantedSkills') || [];
        const onHitEffects: string[] = this.pick(w, 'applyEffectsOnHit') || [];
        const skillsSource = this.masterConfigs?.skills || this.masterConfigs?.Skills || {};
        const effectsSource = this.masterConfigs?.effects || this.masterConfigs?.Effects || {};
        const required: string[] = this.pick(w, 'requiredAchievements') || [];
        const { locked, missing } = this.isGearLocked(required);

        const dmgBadges = [
            melee > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Melee Dmg</span><span class="coll-stat-value">${this.formatNumber(melee)}</span></div>` : '',
            ranged > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Ranged Dmg</span><span class="coll-stat-value">${this.formatNumber(ranged)}</span></div>` : '',
            magic > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Magic Dmg</span><span class="coll-stat-value">${this.formatNumber(magic)}</span></div>` : '',
        ].join('');

        const bonusBadges = Object.entries(statBonuses)
            .map(([k, v]) => `<span class="coll-badge">${this.formatStatName(k)} +${this.formatNumber(v as number)}</span>`)
            .join('');

        card.innerHTML = `
            ${locked ? this.buildLockOverlay(missing) : ''}
            <div class="coll-card-header">
                <div class="coll-icon" style="border: 2px solid ${color};">${this.buildIconHtml(w, (name || '?').charAt(0).toUpperCase())}</div>
                <div class="coll-title-block">
                    <div class="coll-name">${name}</div>
                    <div class="coll-subtitle">${family || 'Weapon'} • ${price}g</div>
                </div>
            </div>
            <div class="coll-tags">
                <span class="coll-tag coll-tag-tier" style="background:${color};">Tier ${tier}</span>
                ${allowDupes ? `<span class="coll-tag" style="background:#444;">Stackable</span>` : ''}
            </div>
            <div class="coll-stat-grid">
                ${dmgBadges}
                <div class="coll-stat"><span class="coll-stat-label">Cooldown</span><span class="coll-stat-value">${this.formatNumber(cooldown)}s</span></div>
                <div class="coll-stat"><span class="coll-stat-label">Range</span><span class="coll-stat-value">${this.formatNumber(range)}</span></div>
                <div class="coll-stat"><span class="coll-stat-label">Projectiles</span><span class="coll-stat-value">${projCount}</span></div>
                <div class="coll-stat"><span class="coll-stat-label">Max Level</span><span class="coll-stat-value">${maxLevel}</span></div>
            </div>
            ${bonusBadges ? `<div><div class="coll-section-label">Bonus Stats</div><div class="coll-badge-row">${bonusBadges}</div></div>` : ''}
            ${grantedSkills.length ? `<div><div class="coll-section-label">Granted Skills</div><div class="coll-badge-row">${this.buildRefBadgeRow(grantedSkills, skillsSource)}</div></div>` : ''}
            ${onHitEffects.length ? `<div><div class="coll-section-label">On-Hit Effects</div><div class="coll-badge-row">${this.buildRefBadgeRow(onHitEffects, effectsSource)}</div></div>` : ''}
        `;
        card.style.borderColor = color;
        if (locked) card.classList.add('locked');
        return card;
    }

    private buildItemCard(it: any): HTMLElement {
        const card = document.createElement('div');
        card.className = 'coll-card';
        const tier = this.pick(it, 'tier') ?? 1;
        const color = getTierColor(tier);

        const name = this.pick(it, 'name') || this.pick(it, 'id');
        const family = this.pick(it, 'itemFamily') || '';
        const price = this.pick(it, 'price') ?? 0;
        const maxLevel = this.pick(it, 'maxLevel') ?? 5;
        const allowDupes = !!this.pick(it, 'allowDuplicates');
        const statBonuses = this.pick(it, 'statBonuses') || {};
        const statMultipliers = this.pick(it, 'statMultipliers') || {};
        const grantedSkills: string[] = this.pick(it, 'grantedSkills') || [];
        const effectsOnPurchase: string[] = this.pick(it, 'effectsOnPurchase') || [];
        const effectsAtWaveEnd: any[] = this.pick(it, 'effectsAtWaveEnd') || [];
        const skillsSource = this.masterConfigs?.skills || this.masterConfigs?.Skills || {};
        const effectsSource = this.masterConfigs?.effects || this.masterConfigs?.Effects || {};
        const required: string[] = this.pick(it, 'requiredAchievements') || [];
        const { locked, missing } = this.isGearLocked(required);

        const bonusBadges = Object.entries(statBonuses)
            .map(([k, v]) => `<span class="coll-badge">${this.formatStatName(k)} +${this.formatNumber(v as number)}</span>`)
            .join('');
        const multBadges = Object.entries(statMultipliers)
            .map(([k, v]) => `<span class="coll-badge">${this.formatStatName(k)} +${Math.round((v as number) * 100)}%</span>`)
            .join('');
        const waveEndBadges = effectsAtWaveEnd.map(we => {
            const statName = this.pick(we, 'statName') || '';
            const amount = this.pick(we, 'amount') ?? 0;
            return `<span class="coll-badge">${this.formatStatName(statName)} +${this.formatNumber(amount)}/wave</span>`;
        }).join('');

        card.innerHTML = `
            ${locked ? this.buildLockOverlay(missing) : ''}
            <div class="coll-card-header">
                <div class="coll-icon" style="border: 2px solid ${color};">${this.buildIconHtml(it, (name || '?').charAt(0).toUpperCase())}</div>
                <div class="coll-title-block">
                    <div class="coll-name">${name}</div>
                    <div class="coll-subtitle">${family || 'Item'} • ${price}g</div>
                </div>
            </div>
            <div class="coll-tags">
                <span class="coll-tag coll-tag-tier" style="background:${color};">Tier ${tier}</span>
                ${allowDupes ? `<span class="coll-tag" style="background:#444;">Stackable</span>` : ''}
            </div>
            <div class="coll-stat-grid">
                <div class="coll-stat"><span class="coll-stat-label">Max Level</span><span class="coll-stat-value">${maxLevel}</span></div>
            </div>
            ${(bonusBadges || multBadges) ? `<div><div class="coll-section-label">Bonus Stats</div><div class="coll-badge-row">${bonusBadges}${multBadges}</div></div>` : ''}
            ${grantedSkills.length ? `<div><div class="coll-section-label">Granted Skills</div><div class="coll-badge-row">${this.buildRefBadgeRow(grantedSkills, skillsSource)}</div></div>` : ''}
            ${effectsOnPurchase.length ? `<div><div class="coll-section-label">On Purchase</div><div class="coll-badge-row">${this.buildRefBadgeRow(effectsOnPurchase, effectsSource)}</div></div>` : ''}
            ${waveEndBadges ? `<div><div class="coll-section-label">Wave-End Bonus</div><div class="coll-badge-row">${waveEndBadges}</div></div>` : ''}
        `;
        card.style.borderColor = color;
        if (locked) card.classList.add('locked');
        return card;
    }

    private buildCharacterCollectionCard(c: any): HTMLElement {
        const card = document.createElement('div');
        card.className = 'coll-card';
        const color = LOBBY_ASSETS.colorPrimary;

        const name = this.pick(c, 'name') || this.pick(c, 'id');
        const hitRadius = this.pick(c, 'hitRadius') ?? 0;
        const baseStats = this.pick(c, 'baseStats') || {};
        const startingWeapons: string[] = this.pick(c, 'startingWeapons') || [];
        const startingItems: string[] = this.pick(c, 'startingItems') || [];
        const startingSkills: string[] = this.pick(c, 'startingSkills') || [];
        const onDeathSkills: string[] = this.pick(c, 'onDeathSkills') || [];
        const skillsSource = this.masterConfigs?.skills || this.masterConfigs?.Skills || {};
        const required: string[] = this.pick(c, 'requiredAchievements') || [];
        const { locked, missing } = this.isGearLocked(required);

        const statBadges = Object.entries(baseStats)
            .filter(([, v]) => (v as number) !== 0)
            .map(([k, v]) => `<div class="coll-stat"><span class="coll-stat-label">${this.formatStatName(k)}</span><span class="coll-stat-value">${this.formatNumber(v as number)}</span></div>`)
            .join('');

        card.innerHTML = `
            ${locked ? this.buildLockOverlay(missing) : ''}
            <div class="coll-card-header">
                <div class="coll-icon" style="border: 2px solid ${color};">${this.buildIconHtml(c, (name || '?').charAt(0).toUpperCase())}</div>
                <div class="coll-title-block">
                    <div class="coll-name">${name}</div>
                    <div class="coll-subtitle">Hit Radius ${hitRadius}</div>
                </div>
            </div>
            <div class="coll-stat-grid">${statBadges}</div>
            ${(startingWeapons.length || startingItems.length) ? `
                <div>
                    <div class="coll-section-label">Starting Gear</div>
                    <div class="coll-badge-row">
                        ${startingWeapons.map(w => `<span class="coll-badge">${w}</span>`).join('')}
                        ${startingItems.map(i => `<span class="coll-badge">${i}</span>`).join('')}
                    </div>
                </div>` : ''}
            ${startingSkills.length ? `
                <div>
                    <div class="coll-section-label">Skills</div>
                    <div class="coll-badge-row">${this.buildRefBadgeRow(startingSkills, skillsSource)}</div>
                </div>` : ''}
            ${onDeathSkills.length ? `
                <div>
                    <div class="coll-section-label">On Death</div>
                    <div class="coll-badge-row">${this.buildRefBadgeRow(onDeathSkills, skillsSource)}</div>
                </div>` : ''}
        `;
        card.style.borderColor = color;
        if (locked) card.classList.add('locked');
        return card;
    }

    private refreshRooms() {
        const container = document.getElementById('room-list-container')!;
        container.innerHTML = `<div style="padding: 20px; color: ${LOBBY_ASSETS.colorMuted}; text-align: center; width: 100%;">Connecting to the rift...</div>`;

        this.connection.invoke("RequestLobbyData").then((rooms: any[]) => {
            this.cachedRooms = rooms;
            this.renderRoomGrid(rooms);
        });
    }

    private renderRoomGrid(rooms: any[]) {
        const container = document.getElementById('room-list-container')!;
        container.innerHTML = '';

        if (rooms.length === 0) {
            container.innerHTML = `<div style="padding: 20px; color: ${LOBBY_ASSETS.colorMuted}; text-align: center; width: 100%;">No matches found. Create your own game!</div>`;
            return;
        }

        rooms.forEach(room => {
            const card = document.createElement('div');
            card.className = 'room-card';
            card.innerHTML = `
                <div>
                    <div class="card-title">${room.roomName} ${room.hasPassword ? '🔒' : ''}</div>
                    <div class="card-meta">Map: ${room.mapId.replace('map_', '')} | Wave: ${room.wave}</div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="color: ${LOBBY_ASSETS.colorPrimary}; font-weight: bold; margin-right: 15px;">${room.playerCount} Players</span>
                    <button class="card-btn lobby-btn" style="width:auto; padding: 8px 24px; margin:0; min-height: 0; font-size: 14px;">JOIN</button>
                </div>
            `;

            card.querySelector('.card-btn')!.addEventListener('click', () => {
                if (room.hasPassword) {
                    this.targetRoomIdForPassword = room.roomId;
                    document.getElementById('password-modal-overlay')!.classList.remove('hidden');
                } else {
                    this.connection.invoke("JoinRoom", this.playerName, room.roomId, "");
                }
            });
            container.appendChild(card);
        });
    }

    private injectCSS() {
        const style = document.createElement('style');
        style.innerHTML = `
        #lobby-ui-wrapper { 
            position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; 
            font-family: 'Segoe UI', Tahoma, sans-serif; color: ${LOBBY_ASSETS.colorText};
            background: ${LOBBY_ASSETS.colorBackground}; 
            z-index: 100000; overflow: hidden;
        }
        #bg-video { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; object-fit: cover; z-index: 1; pointer-events: none; }
        .ui-content { position: relative; z-index: 10; width: 100vw; height: 100vh; }
        .hidden { display: none !important; }
        .video-overlay { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.6); z-index: 2; pointer-events: none; }
        .game-logo { text-align: center; margin-bottom: 40px; user-select: none; display: flex; justify-content: center; }
        .logo-img { width: clamp(300px, 40vw, 700px); height: auto; transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), filter 0.3s ease; filter: drop-shadow(0 0 10px rgba(0,0,0,0.8)); }
        .logo-img.enlarged { transform: scale(1.08); filter: drop-shadow(0 0 25px rgba(229, 179, 92, 0.6)); }
        .center-menu-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; padding: 40px; box-sizing: border-box; width: 400px; }
        .full-screen-panel { position: absolute; left: 0; top: 0; width: 100vw; height: 100vh; background: rgba(20, 20, 28, 0.95); padding: 40px; box-sizing: border-box; display: flex; flex-direction: column; }
        h2 { margin: 0 0 20px 0; font-size: 32px; border-bottom: 2px solid ${LOBBY_ASSETS.colorPrimary}; padding-bottom: 10px; color: #fff; text-transform: uppercase; letter-spacing: 2px; text-shadow: 2px 2px 0 #000; }
        h3 { margin: 0 0 15px 0; font-size: 18px; color: ${LOBBY_ASSETS.colorPrimary}; text-transform: uppercase; letter-spacing: 1px; }
        .input-group { display: flex; flex-direction: column; margin-bottom: 15px; width: 100%; }
        .input-label { font-size: 12px; color: ${LOBBY_ASSETS.colorMuted}; margin-bottom: 5px; text-transform: uppercase; font-weight: bold; }
        .lobby-input { background: rgba(0,0,0,0.6); border: 2px solid #444; color: white; padding: 12px 15px; border-radius: 6px; font-size: 16px; outline: none; transition: 0.2s; }
        .lobby-input:focus { border-color: ${LOBBY_ASSETS.colorPrimary}; box-shadow: 0 0 10px rgba(229, 179, 92, 0.3); }
        .lobby-btn { display: flex; justify-content: center; align-items: center; gap: 15px; width: 100%; padding: 14px; margin-bottom: 15px; background: linear-gradient(180deg, ${LOBBY_ASSETS.colorBtnBgTop} 0%, ${LOBBY_ASSETS.colorBtnBgBot} 100%); border: 2px solid ${LOBBY_ASSETS.colorPrimary}; border-radius: 8px; font-size: 18px; font-weight: bold; color: white; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 2px; text-shadow: 2px 2px 2px rgba(0,0,0,0.8); box-shadow: 0 6px 15px rgba(0,0,0,0.5), inset 0 0 10px rgba(0,0,0,0.3); }
        .lobby-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .lobby-btn:hover:not(:disabled) { background: linear-gradient(180deg, #5c4a82 0%, #362954 100%); border-color: ${LOBBY_ASSETS.colorPrimaryHover}; transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.6), inset 0 0 15px rgba(229, 179, 92, 0.2); }
        .btn-green { background: linear-gradient(180deg, #2e7d32 0%, #1b5e20 100%); border-color: #4caf50; }
        .btn-green:hover:not(:disabled) { background: linear-gradient(180deg, #388e3c 0%, #2e7d32 100%); border-color: #81c784; }
        .danger { background: linear-gradient(180deg, #8b0000 0%, #4a0000 100%); border-color: #ff4444; }
        .danger:hover:not(:disabled) { background: linear-gradient(180deg, #a50000 0%, #660000 100%); }
        .room-card { background: rgba(0,0,0,0.6); border: 2px solid #333; border-radius: 8px; padding: 20px; display: flex; justify-content: space-between; align-items: center; transition: 0.2s; }
        .room-card:hover { border-color: ${LOBBY_ASSETS.colorPrimary}; background: rgba(0,0,0,0.8); }
        .card-title { font-size: 20px; font-weight: bold; margin-bottom: 5px; color: #fff; text-shadow: 1px 1px 2px #000; }
        .card-meta { font-size: 14px; color: ${LOBBY_ASSETS.colorMuted}; }
        .waiting-layout { display: grid; grid-template-columns: 350px 1fr; grid-template-rows: 1fr auto; gap: 20px; height: calc(100% - 70px); overflow: hidden; width: 100%; }
        .waiting-col { background: rgba(0,0,0,0.6); border: 2px solid #333; border-radius: 8px; padding: 20px; display: flex; flex-direction: column; overflow: hidden; }
        .col-settings { grid-column: 1; grid-row: 1; }
        .col-roster { grid-column: 2; grid-row: 1; }
        .col-chars { grid-column: 1 / span 2; grid-row: 2; }
        .char-grid { display: flex; flex-direction: row; overflow-x: auto; gap: 15px; padding-bottom: 10px; width: 100%; align-items: center; }
        .char-card { min-width: 140px; flex-shrink: 0; background: rgba(0,0,0,0.5); border: 2px solid transparent; border-radius: 8px; padding: 15px; text-align: center; cursor: pointer; transition: 0.2s; display: flex; flex-direction: column; align-items: center; }
        .char-card:hover { background: rgba(0,0,0,0.8); border-color: #555; }
        .char-card.selected { border-color: ${LOBBY_ASSETS.colorPrimary}; background: rgba(229, 179, 92, 0.1); box-shadow: inset 0 0 15px rgba(229, 179, 92, 0.2); }
        .roster-item { display: flex; align-items: center; padding: 12px; background: rgba(0,0,0,0.5); border: 1px solid #444; border-radius: 6px; margin-bottom: 8px; gap: 10px;}
        .char-avatar { width: 40px; height: 40px; border-radius: 4px; background: #111; display: flex; justify-content: center; align-items: center; font-weight: bold; border: 1px solid ${LOBBY_ASSETS.colorPrimary}; overflow: hidden; }
        .ready-badge { font-size: 12px; padding: 6px 10px; border-radius: 4px; font-weight: bold; margin-left: auto; text-shadow: 1px 1px 1px #000; }
        .ready-true { background: rgba(76, 175, 80, 0.8); color: #fff; }
        .ready-false { background: rgba(244, 67, 54, 0.8); color: #fff; }
        .lobby-chat-box { flex: 1; overflow-y: auto; font-size: 15px; margin-bottom: 10px; display: flex; flex-direction: column; justify-content: flex-end; }
        .lobby-chat-msg { padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        #toast-container { position: fixed; top: 20px; right: 20px; z-index: 999999; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
        .toast { background: ${LOBBY_ASSETS.colorBtnBgTop}; border-left: 4px solid ${LOBBY_ASSETS.colorPrimary}; padding: 15px 20px; border-radius: 4px; color: white; font-weight: bold; box-shadow: 0 4px 15px rgba(0,0,0,0.8); animation: slideIn 0.3s ease-out forwards; min-width: 250px; }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-10px); } }
        #password-modal-overlay { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); z-index: 200001; display: flex; justify-content: center; align-items: center; }
        .modal-box { background: ${LOBBY_ASSETS.colorBtnBgTop}; border: 2px solid ${LOBBY_ASSETS.colorPrimary}; padding: 40px; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); width: 400px; text-align: center; }

        /* --- Achievements --- */
        .ach-filter-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 15px; flex-wrap: wrap; }
        .ach-filter-sep { width: 2px; height: 20px; background: #333; margin: 0 4px; }
        .ach-filter-btn { --tier-color: ${LOBBY_ASSETS.colorPrimary}; background: rgba(0,0,0,0.5); border: 2px solid #333; color: ${LOBBY_ASSETS.colorMuted}; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; transition: 0.2s; }
        .ach-filter-btn:hover { border-color: var(--tier-color); color: #fff; }
        .ach-filter-btn.active { background: var(--tier-color); border-color: var(--tier-color); color: #fff; }
        .ach-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 15px; padding-right: 10px; padding-bottom: 20px; align-content: start; }
        .ach-card { position: relative; background: rgba(0,0,0,0.5); border: 2px solid #333; border-radius: 8px; padding: 16px; display: flex; gap: 12px; align-items: flex-start; min-height: 92px; }
        .ach-card.unlocked { background: rgba(0,0,0,0.6); padding-right: 36px; }
        .ach-card.locked { opacity: 0.55; filter: grayscale(0.6); }
        .ach-icon { width: 44px; height: 44px; min-width: 44px; border-radius: 6px; display: flex; justify-content: center; align-items: center; font-size: 20px; font-weight: bold; color: #fff; background: #111; overflow: hidden; }
        .ach-body { flex: 1; min-width: 0; }
        .ach-name { font-weight: bold; font-size: 14px; margin-bottom: 4px; color: #fff; line-height: 1.3; word-wrap: break-word; }
        .ach-desc { font-size: 12px; color: ${LOBBY_ASSETS.colorMuted}; margin-bottom: 8px; line-height: 1.4; word-wrap: break-word; }
        .ach-progress-track { width: 100%; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.1); overflow: hidden; }
        .ach-progress-fill { height: 100%; border-radius: 3px; transition: width 0.3s ease; }
        .ach-progress-label { font-size: 11px; color: ${LOBBY_ASSETS.colorMuted}; margin-top: 4px; text-align: right; }
        .ach-unlocked-badge { position: absolute; top: 8px; right: 8px; font-size: 16px; }
        .lock-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.65); display: flex; flex-direction: column; justify-content: center; align-items: center; border-radius: 6px; z-index: 5; text-align: center; padding: 6px; cursor: not-allowed; }
        .lock-overlay .lock-icon { font-size: 22px; margin-bottom: 4px; }
        .lock-overlay .lock-req { font-size: 13px; color: #ddd; line-height: 1.4; font-weight: bold; padding: 0 8px; }
        .lock-overlay .lock-req-label { font-size: 11px; color: ${LOBBY_ASSETS.colorMuted}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
        .lock-req-list { display: flex; flex-direction: column; gap: 6px; align-items: center; max-width: 90%; }
        .lock-req-badge { display: flex; align-items: center; gap: 7px; background: rgba(0,0,0,0.6); border: 1px solid ${LOBBY_ASSETS.colorPrimary}; border-radius: 20px; padding: 5px 12px; font-size: 12px; font-weight: bold; color: #fff; }
        .char-card { position: relative; }

        /* --- Collection --- */
        .coll-tab-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 20px; }
        .coll-tab-btn { display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.5); border: 2px solid #333; color: ${LOBBY_ASSETS.colorMuted}; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; transition: 0.2s; }
        .coll-tab-icon { font-size: 16px; }
        .coll-tab-btn:hover { border-color: ${LOBBY_ASSETS.colorPrimary}; color: #fff; }
        .coll-tab-btn.active { background: linear-gradient(180deg, ${LOBBY_ASSETS.colorBtnBgTop} 0%, ${LOBBY_ASSETS.colorBtnBgBot} 100%); border-color: ${LOBBY_ASSETS.colorPrimary}; color: #fff; box-shadow: 0 0 12px rgba(229, 179, 92, 0.25); }
        .coll-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; padding-right: 10px; padding-bottom: 20px; align-content: start; }
        .coll-card { position: relative; background: rgba(0,0,0,0.5); border: 2px solid #333; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
        .coll-card-header { display: flex; gap: 12px; align-items: center; }
        .coll-icon { width: 52px; height: 52px; min-width: 52px; border-radius: 6px; display: flex; justify-content: center; align-items: center; font-size: 22px; font-weight: bold; color: #fff; background: #111; overflow: hidden; }
        .coll-icon img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
        .coll-title-block { flex: 1; min-width: 0; }
        .coll-name { font-weight: bold; font-size: 16px; color: #fff; line-height: 1.3; word-wrap: break-word; }
        .coll-subtitle { font-size: 11px; color: ${LOBBY_ASSETS.colorMuted}; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
        .coll-tags { display: flex; gap: 6px; flex-wrap: wrap; }
        .coll-tag { font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 8px; border-radius: 4px; color: #fff; }
        .coll-tag-boss { background: #8b0000; }
        .coll-tag-tier { }
        .coll-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
        .coll-stat { display: flex; justify-content: space-between; font-size: 12px; padding: 4px 8px; background: rgba(255,255,255,0.04); border-radius: 4px; }
        .coll-stat-label { color: ${LOBBY_ASSETS.colorMuted}; }
        .coll-stat-value { color: #fff; font-weight: bold; }
        .coll-section-label { font-size: 10px; color: ${LOBBY_ASSETS.colorMuted}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
        .coll-badge-row { display: flex; gap: 6px; flex-wrap: wrap; }
        .coll-badge { font-size: 11px; padding: 4px 9px; border-radius: 12px; background: rgba(255,255,255,0.06); border: 1px solid #333; color: #ddd; }
        .coll-empty { padding: 20px; color: ${LOBBY_ASSETS.colorMuted}; grid-column: 1 / -1; text-align: center; }
        .coll-card.locked { opacity: 0.55; filter: grayscale(0.6); }
        `;
        document.head.appendChild(style);
    }

    private buildHTML() {
        this.wrapper.innerHTML = `
        <video autoplay muted loop playsinline id="bg-video">
            <source src="${LOBBY_ASSETS.bgVideo}" type="video/mp4">
        </video>
        <div class="video-overlay"></div> <div class="ui-content">
        <div id="lobby-version-display" style="position:fixed; bottom:10px; left:10px; color:#aaa; font-size:14px; z-index: 1000000; font-family: monospace; text-shadow: 1px 1px 2px black;"></div>
            <div id="lobby-version-display" style="position:fixed; bottom:10px; right:10px; color:#aaa; font-size:14px; z-index: 1000000; font-family: monospace; text-shadow: 1px 1px 2px black;"></div>
            <div id="toast-container"></div>
            
            <div id="password-modal-overlay" class="hidden">
                <div class="modal-box">
                    <h3>Room Password</h3>
                    <input type="password" id="join-password-input" class="lobby-input" placeholder="Enter password..." style="width: 100%; margin-bottom: 20px; box-sizing: border-box; text-align: center;" />
                    <div style="display:flex; gap:10px;">
                        <button id="btn-cancel-password" class="lobby-btn danger" style="flex:1; margin:0;">Cancel</button>
                        <button id="btn-submit-password" class="lobby-btn" style="flex:1; margin:0;">Join</button>
                    </div>
                </div>
            </div>

            <div id="screen-menu" class="center-menu-panel">
                <div class="game-logo">
                    <img src="${LOBBY_ASSETS.gameLogo}" class="logo-img" alt="Mage Arena" />
                </div>
                <button id="btn-play" class="lobby-btn">NEW GAME</button>
                <button id="btn-achievements" class="lobby-btn">ACHIEVEMENTS</button>
                <button id="btn-collection" class="lobby-btn">COLLECTION</button>
                <button id="btn-settings" class="lobby-btn">OPTIONS</button>
                <button id="btn-fullscreen" class="lobby-btn">TOGGLE FULLSCREEN</button>
                <button id="btn-tos" class="lobby-btn danger">LOGOUT</button>
            </div>

            <div id="screen-browser" class="full-screen-panel hidden">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 style="margin:0; border:none; padding:0;">Server Browser</h2>
                    <button id="btn-back-menu" class="lobby-btn danger" style="width: auto; padding: 10px 30px; margin:0;">Back</button>
                </div>
                
                <div style="display: flex; gap: 15px; margin-bottom: 20px; align-items: center;">
                    <div style="position: relative; width: 300px;">
                        <span style="position: absolute; left: 15px; top: 50%; transform: translateY(-50%); font-size: 16px;">🔍</span>
                        <input type="text" id="search-input" class="lobby-input" placeholder="Search rooms..." style="width: 100%; padding-left: 45px; margin: 0; box-sizing: border-box;" />
                    </div>
                    
                    <button id="btn-refresh" class="lobby-btn" style="width: auto; padding: 10px 25px; margin: 0;">Refresh</button>
                    
                    <div style="flex: 1; display: flex; justify-content: flex-end;">
                        <button id="btn-goto-create" class="lobby-btn btn-green" style="width: 300px; font-size: 22px; padding: 15px; margin: 0;">+ CREATE ROOM</button>
                    </div>
                </div>
                <div id="room-list-container" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; padding-right: 10px;"></div>
            </div>

            <div id="screen-achievements" class="full-screen-panel hidden">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 style="margin:0; border:none; padding:0;">Achievements</h2>
                    <button id="btn-back-from-achievements" class="lobby-btn danger" style="width: auto; padding: 10px 30px; margin:0;">Back</button>
                </div>
                <div id="ach-filter-bar" class="ach-filter-bar">
                    <button class="ach-filter-btn active" data-filter="all">All</button>
                    <button class="ach-filter-btn" data-filter="unlocked">Unlocked</button>
                    <button class="ach-filter-btn" data-filter="locked">Locked</button>
                    <span class="ach-filter-sep"></span>
                    <button class="ach-filter-btn" data-filter="tier1" style="--tier-color:${TIER_COLORS[1]}">Tier 1</button>
                    <button class="ach-filter-btn" data-filter="tier2" style="--tier-color:${TIER_COLORS[2]}">Tier 2</button>
                    <button class="ach-filter-btn" data-filter="tier3" style="--tier-color:${TIER_COLORS[3]}">Tier 3</button>
                    <button class="ach-filter-btn" data-filter="tier4" style="--tier-color:${TIER_COLORS[4]}">Tier 4</button>
                </div>
                <div id="achievements-grid" class="ach-grid"></div>
            </div>

            <div id="screen-collection" class="full-screen-panel hidden">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 style="margin:0; border:none; padding:0;">Collection</h2>
                    <button id="btn-back-from-collection" class="lobby-btn danger" style="width: auto; padding: 10px 30px; margin:0;">Back</button>
                </div>
                <div class="coll-tab-bar">
                    <button class="coll-tab-btn active" data-tab="enemies"><span class="coll-tab-icon">☠</span> Enemies</button>
                    <button class="coll-tab-btn" data-tab="weapons"><span class="coll-tab-icon">⚔</span> Weapons</button>
                    <button class="coll-tab-btn" data-tab="items"><span class="coll-tab-icon">◆</span> Items</button>
                    <button class="coll-tab-btn" data-tab="characters"><span class="coll-tab-icon">☺</span> Characters</button>
                    <input type="text" id="coll-search" class="lobby-input" placeholder="Search..." style="margin: 0 0 0 auto; width: 220px; padding: 8px 14px;" />
                </div>
                <div id="collection-grid" class="coll-grid"></div>
            </div>

            <div id="screen-waiting" class="full-screen-panel hidden">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 style="margin:0; border:none; padding:0;">Lobby <span id="waiting-room-code" style="color: ${LOBBY_ASSETS.colorPrimary};"></span></h2>
                    
                    <div style="display: flex; gap: 15px;">
                        <button id="btn-toggle-ready" class="lobby-btn btn-green" style="margin: 0; width: 200px;">READY UP</button>
                        <button id="btn-start-match" class="lobby-btn hidden" style="margin: 0; width: 200px;" disabled>LAUNCH GAME</button>
                        <button id="btn-leave-match" class="lobby-btn danger" style="width: auto; padding: 10px 30px; margin:0;">Leave Match</button>
                    </div>
                </div>

                <div class="waiting-layout">
                    <div class="waiting-col col-settings">
                        <h3>Match Settings</h3>
                        <div id="host-controls">
                            <div class="input-group"><span class="input-label">Room Name</span><input type="text" id="lobby-edit-name" class="lobby-input" /></div>
                            <div class="input-group"><span class="input-label">Password</span><input type="password" id="lobby-edit-pass" class="lobby-input" placeholder="Leave blank for open room" /></div>
                            <div class="input-group">
                                <span class="input-label">Difficulty</span>
                                <select id="lobby-edit-diff" class="lobby-input">
                                    <option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option>
                                </select>
                            </div>
                            <div class="input-group">
                                <span class="input-label">Map</span>
                                <select id="lobby-edit-map" class="lobby-input">
                                    <option value="map_forest">Forest</option>
                                </select>
                            </div>
                            <button id="btn-save-settings" class="lobby-btn" style="margin-top: auto;">Apply Settings</button>
                        </div>
                        <div id="client-view" class="hidden">
                            <div class="input-group"><span class="input-label">Room Name</span><div id="client-view-name" style="font-weight:bold; font-size:18px;"></div></div>
                            <div class="input-group"><span class="input-label">Difficulty</span><div id="client-view-diff" style="font-weight:bold; font-size:18px;"></div></div>
                            <div class="input-group"><span class="input-label">Map</span><div id="client-view-map" style="font-weight:bold; font-size:18px;"></div></div>
                            <p style="color: ${LOBBY_ASSETS.colorMuted}; font-style: italic; margin-top: auto;">Only Host can edit settings.</p>
                        </div>
                    </div>

                    <div class="waiting-col col-roster">
                        <h3>Players</h3>
                        <div id="waiting-roster" style="flex: none; margin-bottom: 15px; max-height: 250px; overflow-y:auto; padding-right: 10px;"></div>
                        
                        <div style="flex: 1; background: rgba(0,0,0,0.4); border-radius: 8px; padding: 15px; display: flex; flex-direction: column; margin-bottom: 15px; border: 2px solid #333;">
                            <div id="lobby-chat-history" class="lobby-chat-box"></div>
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <input type="text" id="lobby-chat-input" class="lobby-input" placeholder="Send a message..." style="margin: 0; flex: 1;" />
                                <button id="btn-send-chat" class="lobby-btn" style="padding: 14px 20px; margin: 0; width: auto;">💬</button>
                            </div>
                        </div>
                        <p id="waiting-host-msg" style="color: ${LOBBY_ASSETS.colorMuted}; text-align: center; font-size: 13px; margin-top: auto;">Waiting for host...</p>
                    </div>

                    <div class="waiting-col col-chars">
                        <h3 style="flex-shrink: 0;">Select Character</h3>
                        <div id="character-grid" class="char-grid"></div>
                    </div>
                </div>
            </div>
        </div>
        `;

        this.applyKeyboardFix();
        this.bindEvents();
    }

    private bindEvents() {
        const switchScreen = (hideId: string, showId: string) => {
            document.getElementById(hideId)!.classList.add('hidden');
            document.getElementById(showId)!.classList.remove('hidden');
        };

        document.querySelectorAll('.lobby-btn').forEach(btn => {
            btn.addEventListener('click', () => this.playSound(this.audioClick));
        });

        const logos = document.querySelectorAll('.logo-img');
        document.querySelectorAll('.lobby-btn').forEach(btn => {
            btn.addEventListener('mouseenter', () => logos.forEach(logo => logo.classList.add('enlarged')));
            btn.addEventListener('mouseleave', () => logos.forEach(logo => logo.classList.remove('enlarged')));
        });

        document.getElementById('btn-play')!.onclick = () => {
            switchScreen('screen-menu', 'screen-browser');
            this.refreshRooms();
        };

        document.getElementById('btn-collection')!.onclick = () => {
            switchScreen('screen-menu', 'screen-collection');
            this.refreshCollectionCatalog();
        };
        document.getElementById('btn-back-from-collection')!.onclick = () => switchScreen('screen-collection', 'screen-menu');

        document.querySelectorAll('.coll-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.coll-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeCollectionTab = (btn as HTMLElement).dataset.tab || 'enemies';
                (document.getElementById('coll-search') as HTMLInputElement).value = '';
                this.renderCollectionGrid();
            });
        });

        document.getElementById('coll-search')!.addEventListener('input', () => this.renderCollectionGrid());
        document.getElementById('btn-achievements')!.onclick = () => {
            switchScreen('screen-menu', 'screen-achievements');
            this.loadAchievements();
        };
        document.getElementById('btn-back-from-achievements')!.onclick = () => switchScreen('screen-achievements', 'screen-menu');

        document.querySelectorAll('.ach-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.ach-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeAchFilter = (btn as HTMLElement).dataset.filter || 'all';
                this.renderAchievementGrid();
            });
        });

        document.getElementById('btn-settings')!.onclick = () => this.showToast("Settings", "Settings menu coming soon!");
        document.getElementById('btn-fullscreen')!.onclick = () => {
            if (!document.fullscreenElement) {
                // Enter fullscreen
                document.documentElement.requestFullscreen().then(() => {
                    // Try to lock the ESC key so it triggers the game menu instead of closing fullscreen
                    if ('keyboard' in navigator && (navigator as any).keyboard && (navigator as any).keyboard.lock) {
                        (navigator as any).keyboard.lock(['Escape']).catch((e: any) => console.warn("Keyboard lock failed:", e));
                    }
                }).catch(err => {
                    console.warn(`Error attempting to enable fullscreen: ${err.message}`);
                });
            } else {
                // Exit fullscreen
                if (document.exitFullscreen) document.exitFullscreen();
            }
        };
        document.getElementById('btn-tos')!.onclick = () => {
            localStorage.removeItem('arena_jwt');
            localStorage.removeItem('arena_username');
            localStorage.removeItem('arena_playerId');
            window.location.reload();
        };

        document.getElementById('btn-back-menu')!.onclick = () => switchScreen('screen-browser', 'screen-menu');
        document.getElementById('btn-refresh')!.onclick = () => this.refreshRooms();

        document.getElementById('search-input')!.addEventListener('input', (e) => {
            const q = (e.target as HTMLInputElement).value.toLowerCase();
            this.renderRoomGrid(this.cachedRooms.filter(r => r.roomName.toLowerCase().includes(q) || r.roomId.toLowerCase().includes(q)));
        });

        document.getElementById('btn-goto-create')!.onclick = () => {
            const roomName = `${this.playerName}'s Game`;
            this.connection.invoke("CreateRoom", this.playerName, roomName, "", "easy");
            switchScreen('screen-browser', 'screen-waiting');
        };

        document.getElementById('btn-leave-match')!.onclick = () => {
            this.connection.invoke("LeaveRoom");
            sessionStorage.removeItem('currentRoomId');

            const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.pushState({ path: cleanUrl }, '', cleanUrl);

            switchScreen('screen-waiting', 'screen-browser');
            this.refreshRooms();
        };

        document.getElementById('btn-cancel-password')!.onclick = () => {
            document.getElementById('password-modal-overlay')!.classList.add('hidden');
            (document.getElementById('join-password-input') as HTMLInputElement).value = "";
        };

        document.getElementById('btn-submit-password')!.onclick = () => {
            const pw = (document.getElementById('join-password-input') as HTMLInputElement).value;
            this.connection.invoke("JoinRoom", this.playerName, this.targetRoomIdForPassword, pw);
            document.getElementById('password-modal-overlay')!.classList.add('hidden');
        };

        document.getElementById('btn-save-settings')!.onclick = () => {
            const rName = (document.getElementById('lobby-edit-name') as HTMLInputElement).value.trim();
            const rPass = (document.getElementById('lobby-edit-pass') as HTMLInputElement).value.trim();
            const rDiff = (document.getElementById('lobby-edit-diff') as HTMLSelectElement).value;
            const rMap = (document.getElementById('lobby-edit-map') as HTMLSelectElement).value;
            this.connection.invoke("UpdateRoomSettings", rName, rPass, rDiff, rMap);
        };

        document.getElementById('btn-toggle-ready')!.onclick = () => this.connection.invoke("ToggleReady");
        document.getElementById('btn-start-match')!.onclick = () => this.connection.invoke("StartMatch");

        const submitChat = () => {
            const inputEl = document.getElementById('lobby-chat-input') as HTMLInputElement;
            const text = inputEl.value.trim();
            if (text) {
                this.connection.invoke("SendChatMessage", text);
                inputEl.value = '';
            }
        };

        document.getElementById('lobby-chat-input')!.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') submitChat(); });
        document.getElementById('btn-send-chat')!.addEventListener('click', () => submitChat());

        // --- SIGNALR LISTENERS ---
        this.connection.invoke("GetServerVersion").then((v: string) => {
            const vDiv = document.getElementById('lobby-version-display');
            if (vDiv) vDiv.innerText = v;
        }).catch(err => console.error("Failed to fetch version:", err));

        this.connection.on("LobbyError", (msg: string) => {
            if (msg === "Incorrect password.") {
                this.showToast("Room Locked", "The host updated the room. A password is now required.", "error");
                document.getElementById('password-modal-overlay')!.classList.remove('hidden');
                document.getElementById('join-password-input')!.focus();
            } else {
                this.showToast("System Error", msg, "error");
            }
        });

        this.connection.on("ReceiveChatMessage", (sender: string, msg: string) => {
            const history = document.getElementById('lobby-chat-history')!;
            const div = document.createElement('div');
            div.className = 'lobby-chat-msg';
            div.innerHTML = `<strong style="color: ${LOBBY_ASSETS.colorPrimary};">${sender}:</strong> ${msg}`;
            history.appendChild(div);
            history.scrollTop = history.scrollHeight;
            this.playSound(this.audioMessage);
        });

        this.connection.on("ReceiveHandshake", (payload: any) => {
            this.masterConfigs = payload;
            this.renderCharacterGrid();
        });

        // NOTE: achievements currently only unlock mid-match (server-side, via GameRoom →
        // MatchHub's connection), so this fires only if you later add lobby-side unlock
        // triggers. The character grid still updates correctly on lobby (re)join either way,
        // since InnerJoinRoom re-fetches UnlockedAchievementIds from the DB every time.
        this.connection.on("AchievementUnlocked", (achievementIds: string[]) => {
            if (!achievementIds || achievementIds.length === 0) return;

            // Keep the local unlocked-set in sync so lock overlays update immediately
            // without waiting for the next handshake.
            if (this.masterConfigs) {
                this.masterConfigs.myUnlockedAchievements = [
                    ...(this.masterConfigs.myUnlockedAchievements || []),
                    ...achievementIds
                ];
            }

            const achievements = this.masterConfigs?.achievements || {};
            achievementIds.forEach(id => {
                const a = achievements[id];
                const name = a ? (a.name || a.Name || id) : id;
                this.showToast("🏆 Achievement Unlocked", name, "success");
            });

            this.renderCharacterGrid();
            if (!document.getElementById('screen-achievements')!.classList.contains('hidden')) {
                this.loadAchievements();
            }
        });

        this.connection.on("LobbyListUpdated", () => {
            if (!document.getElementById('screen-browser')!.classList.contains('hidden')) {
                this.refreshRooms();
            }
        });

        this.connection.on("RoomSettingsUpdated", (data: any) => {
            document.getElementById('client-view-name')!.innerText = data.roomName + (data.hasPassword ? " 🔒" : "");
            document.getElementById('client-view-diff')!.innerText = data.difficulty.toUpperCase();
            document.getElementById('client-view-map')!.innerText = data.mapId.replace('map_', '').toUpperCase();

            (document.getElementById('lobby-edit-name') as HTMLInputElement).value = data.roomName;
            (document.getElementById('lobby-edit-diff') as HTMLSelectElement).value = data.difficulty;
            (document.getElementById('lobby-edit-map') as HTMLSelectElement).value = data.mapId;
        });

        this.connection.on("UpdateLobbyRoster", (data: any) => {
            const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?roomId=' + data.roomId;
            window.history.pushState({ path: newUrl }, '', newUrl);
            document.getElementById('screen-browser')!.classList.add('hidden');
            document.getElementById('screen-waiting')!.classList.remove('hidden');
            document.getElementById('waiting-room-code')!.innerText = data.roomId;

            const isHost = this.connection.connectionId === data.hostId;

            if (isHost) {
                document.getElementById('host-controls')!.classList.remove('hidden');
                document.getElementById('client-view')!.classList.add('hidden');
                document.getElementById('btn-start-match')!.classList.remove('hidden');
                document.getElementById('waiting-host-msg')!.classList.add('hidden');
            } else {
                document.getElementById('host-controls')!.classList.add('hidden');
                document.getElementById('client-view')!.classList.remove('hidden');
                document.getElementById('btn-start-match')!.classList.add('hidden');
                document.getElementById('waiting-host-msg')!.classList.remove('hidden');
            }

            const roster = document.getElementById('waiting-roster')!;
            roster.innerHTML = '';

            const currentCount = data.players.length;
            if (currentCount > this.lastPlayerCount && this.lastPlayerCount > 0) {
                this.playSound(this.audioJoin);
            }
            this.lastPlayerCount = currentCount;

            let allReady = true;

            data.players.forEach((p: any) => {
                if (!p.isReady) allReady = false;

                let charName = "Choosing...";
                let iconHtml = `<div class="char-avatar" style="font-size:16px;">?</div>`;

                if (p.characterId && this.masterConfigs?.characters?.[p.characterId]) {
                    const charData = this.masterConfigs.characters[p.characterId];
                    charName = charData.name || charData.Id || p.characterId;
                    const textureKey = charData.textureKey || charData.TextureKey;
                    const frame = charData.iconFrame ?? charData.IconFrame ?? 0;
                    const base64Img = this.getIconBase64(textureKey, frame);

                    if (base64Img) {
                        iconHtml = `<div class="char-avatar" style="padding: 0;"><img src="${base64Img}" style="width: 100%; height: 100%; image-rendering: pixelated; object-fit: contain;" /></div>`;
                    } else {
                        iconHtml = `<div class="char-avatar">${charName.charAt(0).toUpperCase()}</div>`;
                    }
                }

                const item = document.createElement('div');
                item.className = 'roster-item';
                item.innerHTML = `
                    ${iconHtml}
                    <div style="display:flex; flex-direction: column;">
                        <span style="font-weight:bold; font-size: 16px;">${p.name} ${p.id === data.hostId ? `<span style="color:${LOBBY_ASSETS.colorPrimary};">(Host)</span>` : ''}</span>
                        <span style="font-size: 12px; color:${LOBBY_ASSETS.colorMuted};">${charName}</span>
                    </div>
                    <div class="ready-badge ${p.isReady ? 'ready-true' : 'ready-false'}">${p.isReady ? 'READY' : 'NOT READY'}</div>
                `;
                roster.appendChild(item);

                if (p.id === this.connection.connectionId) {
                    const readyBtn = document.getElementById('btn-toggle-ready')!;

                    if (p.isReady) {
                        readyBtn.innerText = "CANCEL READY";
                        readyBtn.classList.remove('btn-green');
                        readyBtn.classList.add('danger');
                    } else {
                        readyBtn.innerText = "READY UP";
                        readyBtn.classList.add('btn-green');
                        readyBtn.classList.remove('danger');
                    }

                    this.renderCharacterGrid();
                }
            });

            const startBtn = document.getElementById('btn-start-match') as HTMLButtonElement;
            startBtn.disabled = !allReady;
        });
    }
}