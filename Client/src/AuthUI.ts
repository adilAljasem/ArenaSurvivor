// // AuthUI.ts
// import { LOBBY_ASSETS } from './LobbyUI';


// export class AuthUI {
//     private wrapper: HTMLDivElement;
//     private onSuccess: () => void;
//     private audioClick = new Audio(LOBBY_ASSETS.sfxClick);

//     constructor(onSuccess: () => void) {
//         this.onSuccess = onSuccess;
//         this.audioClick.load();

//         this.wrapper = document.createElement('div');
//         this.wrapper.id = 'auth-ui-wrapper';
//         document.body.appendChild(this.wrapper);

//         this.render();
//         this.checkVerifyToken();
//         this.checkResetToken();
//         this.bindAudio();
//     }

//     private checkResetToken() {
//         const params = new URLSearchParams(window.location.search);
//         const token = params.get('reset_token');
//         if (token) {
//             this.showTab('reset'); // Jump straight to the reset password form
//         }
//     }


//     private playSound(audio: HTMLAudioElement) {
//         audio.currentTime = 0;
//         audio.play().catch(e => console.warn("Audio play blocked by browser:", e));
//     }

//     private async checkVerifyToken() {
//         const params = new URLSearchParams(window.location.search);
//         const token = params.get('verify_token');
//         if (!token) return;

//         try {
//             const res = await fetch(`/api/auth/verify?token=${token}`);
//             const data = await res.json();
//             if (res.ok) {
//                 this.showNotice('✅ ' + data.message + ' You can now log in.', 'success');
//             } else {
//                 this.showNotice('❌ ' + data.error, 'error');
//             }
//             window.history.replaceState({}, '', window.location.pathname);
//         } catch {
//             this.showNotice('❌ Verification failed. Please try again.', 'error');
//         }
//     }

//     private render() {
//         this.wrapper.innerHTML = `
//             <style>
//                 /* CORE LAYOUT SHARED WITH LOBBY */
//                 #auth-ui-wrapper { 
//                     position: fixed; inset: 0; width: 100vw; height: 100vh;
//                     font-family: 'Segoe UI', Tahoma, sans-serif; color: ${LOBBY_ASSETS.colorText};
//                     background: ${LOBBY_ASSETS.colorBackground};
//                     z-index: 999999; overflow: hidden;
//                 }
//                 #bg-video { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; object-fit: cover; z-index: 1; pointer-events: none; }
//                 .video-overlay { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.6); z-index: 2; pointer-events: none; }
//                 .ui-content { position: relative; z-index: 10; width: 100vw; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
                
//                 /* LOGO */
//                 .game-logo { margin-bottom: 30px; user-select: none; }
//                 .logo-img { width: clamp(250px, 35vw, 600px); height: auto; filter: drop-shadow(0 0 10px rgba(0,0,0,0.8)); transition: transform 0.3s ease; }
                
//                 /* AUTH PANEL */
//                 .auth-panel { background: rgba(0,0,0,0.7); border: 2px solid ${LOBBY_ASSETS.colorPrimary}; border-radius: 8px; padding: 40px; width: 380px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); }
//                 .auth-subtitle { color: ${LOBBY_ASSETS.colorMuted}; font-size: 13px; text-align: center; margin-bottom: 25px; text-transform: uppercase; letter-spacing: 1px; }
                
//                 /* TABS */
//                 .auth-tabs { display: flex; margin-bottom: 25px; border-bottom: 2px solid #333; }
//                 .auth-tab { flex: 1; padding: 10px; cursor: pointer; text-align: center; color: #777; font-size: 14px; font-weight: bold; text-transform: uppercase; transition: 0.2s; border-bottom: 2px solid transparent; margin-bottom: -2px; }
//                 .auth-tab.active { color: ${LOBBY_ASSETS.colorPrimary}; border-bottom-color: ${LOBBY_ASSETS.colorPrimary}; text-shadow: 0 0 5px rgba(229, 179, 92, 0.5); }
//                 .auth-tab:hover:not(.active) { color: #fff; }

//                 /* SHARED LOBBY INPUTS & BUTTONS */
//                 .input-group { display: flex; flex-direction: column; margin-bottom: 15px; width: 100%; }
//                 .input-label { font-size: 12px; color: ${LOBBY_ASSETS.colorMuted}; margin-bottom: 5px; text-transform: uppercase; font-weight: bold; }
//                 .lobby-input { background: rgba(0,0,0,0.6); border: 2px solid #444; color: white; padding: 12px 15px; border-radius: 6px; font-size: 14px; outline: none; transition: 0.2s; box-sizing: border-box; width: 100%; }
//                 .lobby-input:focus { border-color: ${LOBBY_ASSETS.colorPrimary}; box-shadow: 0 0 10px rgba(229, 179, 92, 0.3); }
                
//                 .lobby-btn { 
//                     width: 100%; padding: 14px; margin-top: 10px;
//                     background: linear-gradient(180deg, ${LOBBY_ASSETS.colorBtnBgTop} 0%, ${LOBBY_ASSETS.colorBtnBgBot} 100%);
//                     border: 2px solid ${LOBBY_ASSETS.colorPrimary}; border-radius: 8px; font-size: 16px; font-weight: bold; color: white;
//                     cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 2px;
//                     box-shadow: 0 6px 15px rgba(0,0,0,0.5), inset 0 0 10px rgba(0,0,0,0.3);
//                 }
//                 .lobby-btn:disabled { opacity: 0.5; cursor: not-allowed; }
//                 .lobby-btn:hover:not(:disabled) { 
//                     border-color: ${LOBBY_ASSETS.colorPrimaryHover}; transform: translateY(-2px);
//                     box-shadow: 0 8px 20px rgba(0,0,0,0.6), inset 0 0 15px rgba(229, 179, 92, 0.2); 
//                 }

//                 /* NOTICES */
//                 .auth-notice { padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 20px; display: none; text-align: center; font-weight: bold; }
//                 .auth-notice.success { background: rgba(76, 175, 80, 0.2); color: #81c784; border: 1px solid #4caf50; }
//                 .auth-notice.error   { background: rgba(244, 67, 54, 0.2); color: #e57373; border: 1px solid #f44336; }
//             </style>

//             <video autoplay muted loop playsinline id="bg-video">
//                 <source src="${LOBBY_ASSETS.bgVideo}" type="video/mp4">
//             </video>
//             <div class="video-overlay"></div>

//             <div id="form-forgot" style="display:none; flex-direction:column;">
//         <div class="auth-subtitle">Enter your email to receive a reset link</div>
//         <div class="input-group">
//             <span class="input-label">Email Address</span>
//             <input id="forgot-email" type="email" class="lobby-input" autocomplete="email" />
//         </div>
//         <button class="lobby-btn" id="btn-forgot">SEND RESET LINK</button>
//         <div style="text-align: center; margin-top: 15px;">
//             <a href="#" onclick="authShowTab('login')" style="color: #e5b35c; font-size: 13px; text-decoration: none;">Back to Login</a>
//         </div>
//     </div>

//     <div id="form-reset" style="display:none; flex-direction:column;">
//         <div class="auth-subtitle">Create a new password</div>
//         <div class="input-group">
//             <span class="input-label">New Password (min 8 chars)</span>
//             <input id="reset-password" type="password" class="lobby-input" />
//         </div>
//         <button class="lobby-btn" id="btn-reset">UPDATE PASSWORD</button>
//     </div>

//             <div class="ui-content">
//                 <div class="game-logo">
//                     <img src="${LOBBY_ASSETS.gameLogo}" class="logo-img" alt="Arena Survivor" />
//                 </div>

//                 <div class="auth-panel">
//                     <div class="auth-subtitle">Save your progress & join the realm</div>
//                     <div class="auth-notice" id="auth-notice"></div>

//                     <div class="auth-tabs">
//                         <div class="auth-tab active" id="tab-login"  onclick="authShowTab('login')">Login</div>
//                         <div class="auth-tab"        id="tab-register" onclick="authShowTab('register')">Register</div>
//                     </div>

//                     <div id="form-login" style="display:flex; flex-direction:column;">
//                         <div class="input-group">
//                             <span class="input-label">Email Address</span>
//                             <input id="login-email" type="email" class="lobby-input" autocomplete="email" />
//                         </div>
//                         <div class="input-group">
//                             <span class="input-label">Password</span>
//                             <input id="login-password" type="password" class="lobby-input" autocomplete="current-password" />
//                         </div>
//                         <button class="lobby-btn" id="btn-login">ENTER THE ARENA</button>
//                         <div style="text-align: center; margin-top: 15px;">
//     <a href="#" onclick="authShowTab('forgot')" style="color: #a1a1aa; font-size: 13px; text-decoration: none; transition: color 0.2s;" onmouseover="this.style.color='#e5b35c'" onmouseout="this.style.color='#a1a1aa'">Forgot Password?</a>
// </div>
//                     </div>

//                     <div id="form-register" style="display:none; flex-direction:column;">
//                         <div class="input-group">
//                             <span class="input-label">Email Address</span>
//                             <input id="reg-email" type="email" class="lobby-input" autocomplete="email" />
//                         </div>
//                         <div class="input-group">
//                             <span class="input-label">Username (3–20 chars)</span>
//                             <input id="reg-username" type="text" class="lobby-input" autocomplete="username" />
//                         </div>
//                         <div class="input-group">
//                             <span class="input-label">Password (min 8 chars)</span>
//                             <input id="reg-password" type="password" class="lobby-input" autocomplete="new-password" />
//                         </div>
//                         <button class="lobby-btn" id="btn-register">CREATE ACCOUNT</button>
//                     </div>
//                 </div>
//             </div>
//         `;

//         // FIX: Casting 'tab' so TypeScript doesn't throw Error 2345
//         (window as any).authShowTab = (tab: string) => this.showTab(tab as 'login' | 'register');

//         this.wrapper.querySelectorAll('input').forEach(el => {
//             el.addEventListener('keydown', e => e.stopPropagation());
//             el.addEventListener('keyup', e => e.stopPropagation());
//         });

//         document.getElementById('btn-login')!.addEventListener('click', () => this.handleLogin());
//         document.getElementById('btn-register')!.addEventListener('click', () => this.handleRegister());
//         document.getElementById('btn-forgot')!.addEventListener('click', () => this.handleForgotPassword());
//         document.getElementById('btn-reset')!.addEventListener('click', () => this.handleResetPassword());
//         ['login-email', 'login-password'].forEach(id =>
//             document.getElementById(id)!.addEventListener('keydown', e => { if (e.key === 'Enter') this.handleLogin(); })
//         );
//         ['reg-email', 'reg-username', 'reg-password'].forEach(id =>
//             document.getElementById(id)!.addEventListener('keydown', e => { if (e.key === 'Enter') this.handleRegister(); })
//         );
//     }

//     private bindAudio() {
//         // Add click sounds to tabs and buttons
//         const playClick = () => this.playSound(this.audioClick);

//         document.querySelectorAll('.auth-tab, .lobby-btn').forEach(el => {
//             el.addEventListener('click', playClick);
//         });

//         // Add logo hover effect for buttons
//         const logo = this.wrapper.querySelector('.logo-img') as HTMLImageElement;
//         document.querySelectorAll('.lobby-btn').forEach(btn => {
//             btn.addEventListener('mouseenter', () => logo.style.transform = 'scale(1.08)');
//             btn.addEventListener('mouseleave', () => logo.style.transform = 'scale(1)');
//         });
//     }
//     private showTab(tab: 'login' | 'register' | 'forgot' | 'reset') {
//         const isLogin = tab === 'login';
//         const isReg = tab === 'register';
//         const isForgot = tab === 'forgot';
//         const isReset = tab === 'reset';

//         (document.getElementById('form-login') as HTMLElement).style.display = isLogin ? 'flex' : 'none';
//         (document.getElementById('form-register') as HTMLElement).style.display = isReg ? 'flex' : 'none';
//         (document.getElementById('form-forgot') as HTMLElement).style.display = isForgot ? 'flex' : 'none';
//         (document.getElementById('form-reset') as HTMLElement).style.display = isReset ? 'flex' : 'none';

//         document.getElementById('tab-login')!.classList.toggle('active', isLogin);
//         document.getElementById('tab-register')!.classList.toggle('active', isReg);

//         // Hide the tabs themselves if we are in a recovery flow
//         (document.querySelector('.auth-tabs') as HTMLElement).style.display = (isForgot || isReset) ? 'none' : 'flex';

//         this.hideNotice();
//     }

//     private showNotice(msg: string, type: 'success' | 'error' | 'info') {
//         const el = document.getElementById('auth-notice')!;
//         el.textContent = msg;
//         el.className = `auth-notice ${type}`;
//         el.style.display = 'block';
//     }

//     private hideNotice() {
//         document.getElementById('auth-notice')!.style.display = 'none';
//     }

//     private setLoading(btnId: string, loading: boolean) {
//         const btn = document.getElementById(btnId) as HTMLButtonElement;
//         btn.disabled = loading;
//         btn.textContent = loading ? 'PLEASE WAIT...' : (btnId === 'btn-login' ? 'ENTER THE ARENA' : 'CREATE ACCOUNT');
//     }

//     private async handleLogin() {
//         const email = (document.getElementById('login-email') as HTMLInputElement).value.trim();
//         const password = (document.getElementById('login-password') as HTMLInputElement).value;
//         if (!email || !password) { this.showNotice('Please fill in all fields.', 'error'); return; }

//         this.setLoading('btn-login', true);
//         try {
//             const res = await fetch('/api/auth/login', {
//                 method: 'POST',
//                 headers: { 'Content-Type': 'application/json' },
//                 body: JSON.stringify({ email, password })
//             });
//             const data = await res.json();
//             if (res.ok) {
//                 localStorage.setItem('arena_jwt', data.token);
//                 localStorage.setItem('arena_username', data.username);
//                 localStorage.setItem('arena_playerId', data.playerId);
//                 this.wrapper.remove();
//                 this.onSuccess();
//             } else {
//                 this.showNotice('❌ ' + data.error, 'error');
//             }
//         } catch {
//             this.showNotice('❌ Connection error. Please try again.', 'error');
//         } finally {
//             this.setLoading('btn-login', false);
//         }
//     }

//     private async handleRegister() {
//         const email = (document.getElementById('reg-email') as HTMLInputElement).value.trim();
//         const username = (document.getElementById('reg-username') as HTMLInputElement).value.trim();
//         const password = (document.getElementById('reg-password') as HTMLInputElement).value;
//         if (!email || !username || !password) { this.showNotice('Please fill in all fields.', 'error'); return; }

//         this.setLoading('btn-register', true);
//         try {
//             const res = await fetch('/api/auth/register', {
//                 method: 'POST',
//                 headers: { 'Content-Type': 'application/json' },
//                 body: JSON.stringify({ email, username, password })
//             });
//             const data = await res.json();
//             if (res.ok) {
//                 this.showNotice('✅ ' + data.message, 'success');
//                 setTimeout(() => this.showTab('login'), 2000);
//             } else {
//                 this.showNotice('❌ ' + data.error, 'error');
//             }
//         } catch {
//             this.showNotice('❌ Connection error. Please try again.', 'error');
//         } finally {
//             this.setLoading('btn-register', false);
//         }
//     }

//     private async handleForgotPassword() {
//         const email = (document.getElementById('forgot-email') as HTMLInputElement).value.trim();
//         if (!email) { this.showNotice('Please enter your email.', 'error'); return; }

//         this.setLoading('btn-forgot', true);
//         try {
//             const res = await fetch('/api/auth/forgot-password', {
//                 method: 'POST',
//                 headers: { 'Content-Type': 'application/json' },
//                 body: JSON.stringify({ email })
//             });
//             const data = await res.json();
//             if (res.ok) {
//                 this.showNotice('✅ ' + data.message, 'success');
//             } else {
//                 this.showNotice('❌ ' + data.error, 'error');
//             }
//         } catch {
//             this.showNotice('❌ Connection error.', 'error');
//         } finally {
//             this.setLoading('btn-forgot', false);
//         }
//     }

//     private async handleResetPassword() {
//         const password = (document.getElementById('reset-password') as HTMLInputElement).value;
//         const params = new URLSearchParams(window.location.search);
//         const token = params.get('reset_token');

//         if (!password || !token) { this.showNotice('Please enter a new password.', 'error'); return; }

//         this.setLoading('btn-reset', true);
//         try {
//             const res = await fetch('/api/auth/reset-password', {
//                 method: 'POST',
//                 headers: { 'Content-Type': 'application/json' },
//                 body: JSON.stringify({ token, newPassword: password })
//             });
//             const data = await res.json();
//             if (res.ok) {
//                 this.showNotice('✅ ' + data.message, 'success');
//                 window.history.replaceState({}, '', window.location.pathname); // Clear URL
//                 setTimeout(() => this.showTab('login'), 2000);
//             } else {
//                 this.showNotice('❌ ' + data.error, 'error');
//             }
//         } catch {
//             this.showNotice('❌ Connection error.', 'error');
//         } finally {
//             this.setLoading('btn-reset', false);
//         }
//     }
// }