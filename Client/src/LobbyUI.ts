import { HubConnection } from '@microsoft/signalr';

export class LobbyUI {
    private wrapper: HTMLDivElement;
    private playerName: string = "Guest";
    private cachedRooms: any[] = [];
    private masterConfigs: any = null;

    private connection: HubConnection;
    // >>> NEW: Store the Phaser helper function <<<
    private getIconBase64: (textureKey: string, frame: number) => string | null;
    private onJoinMatch: () => void;
    private targetRoomIdForPassword: string = "";

    // >>> UPDATE: Constructor signature <<<
    constructor(connection: HubConnection, getIconBase64: (key: string, frame: number) => string | null, onJoinMatch: () => void) {
        this.connection = connection;
        this.getIconBase64 = getIconBase64;
        this.onJoinMatch = onJoinMatch;

        this.wrapper = document.createElement('div');
        this.wrapper.id = 'lobby-ui-wrapper';
        this.injectCSS();
        document.body.appendChild(this.wrapper);
        this.buildHTML();
    }

    private injectCSS() {
        const style = document.createElement('style');
        style.innerHTML = `
        /* --- BASE & WRAPPER --- */
        #lobby-ui-wrapper { 
            position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; 
            display: flex; justify-content: center; align-items: center; z-index: 100000; 
            font-family: 'Segoe UI', Tahoma, sans-serif; color: white;
            background: url('/assets/obstacles/map1.jpg') center/cover no-repeat;
        }
        .hidden { display: none !important; }
        
        /* --- PANELS --- */
        .glass-panel { 
            background: rgba(20, 25, 35, 0.85); 
            backdrop-filter: blur(16px); 
            border: 1px solid rgba(255, 255, 255, 0.1); 
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6); 
            border-radius: 16px; 
            padding: 40px; 
            display: flex; flex-direction: column; box-sizing: border-box; 
        }
        
        /* >>> THE MENU FIX: Centered, grander look for Login/Menu <<< */
        .screen-small { width: 450px; align-items: center; }
        .screen-small h2 { 
            text-align: center; border-bottom: none; font-size: 36px; 
            color: #bf55ec; text-shadow: 0 0 15px rgba(191, 85, 236, 0.5); 
            margin-bottom: 30px; padding: 0; width: 100%;
        }
        .screen-small .input-group { width: 100%; }
        .screen-small .lobby-btn { width: 100%; padding: 16px; font-size: 18px; margin-top: 10px; }
        
        /* Standard sizing for the browser/match rooms */
       .screen-full { 
            width: 100vw; 
            max-width: none; 
            height: 100vh; 
            max-height: none; 
            border-radius: 0; 
            border: none; 
            padding: 40px; 
        }
        .screen-full h2 { margin: 0 0 20px 0; font-size: 28px; border-bottom: 2px solid rgba(255,255,255,0.1); padding-bottom: 10px; color: #fff; }

        h3 { margin: 0 0 15px 0; font-size: 20px; color: #e0e0e0; }

        /* --- INPUTS --- */
        .input-group { display: flex; flex-direction: column; margin-bottom: 15px; }
        .input-label { font-size: 13px; color: #aaa; margin-bottom: 5px; text-transform: uppercase; font-weight: bold; }
        .lobby-input { 
            background: rgba(0, 0, 0, 0.5); border: 1px solid #444; color: white; 
            padding: 12px 15px; border-radius: 8px; font-size: 16px; outline: none; transition: border-color 0.2s;
        }
        .lobby-input:focus { border-color: #bf55ec; }

        /* --- BUTTONS --- */
        .lobby-btn { 
            padding: 12px 20px; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; 
            cursor: pointer; transition: all 0.2s; text-transform: uppercase; text-align: center;
        }
        .lobby-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .primary { background: #bf55ec; color: white; }
        .primary:hover:not(:disabled) { background: #d070f8; transform: translateY(-2px); }
        .secondary { background: transparent; color: #bf55ec; border: 2px solid #bf55ec; }
        .secondary:hover:not(:disabled) { background: rgba(191, 85, 236, 0.1); }
        .danger { background: rgba(255, 68, 68, 0.2); color: #ff4444; border: 1px solid #ff4444; }
        .danger:hover:not(:disabled) { background: rgba(255, 68, 68, 0.4); }

        /* --- SERVER BROWSER --- */
        .room-card { 
            background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255,255,255,0.05); 
            border-radius: 12px; padding: 20px; display: flex; justify-content: space-between; 
            align-items: center; transition: 0.2s; 
        }
        .room-card:hover { background: rgba(255,255,255,0.05); border-color: rgba(191, 85, 236, 0.5); }
        .card-title { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
        .card-meta { font-size: 13px; color: #aaa; }
        .card-btn { background: #bf55ec; border: none; padding: 8px 16px; border-radius: 6px; color: white; font-weight: bold; cursor: pointer; }
        .card-btn:hover { background: #d070f8; }

        /* --- MATCH LOBBY GRID --- */
        .waiting-layout { 
            display: grid; 
            grid-template-columns: 350px 1fr; 
            grid-template-rows: 1fr auto; 
            gap: 20px; height: calc(100% - 70px); overflow: hidden; width: 100%;
        }
        .waiting-col { background: rgba(0,0,0,0.3); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; overflow: hidden; }
        
        .col-settings { grid-column: 1; grid-row: 1; }
        .col-roster { grid-column: 2; grid-row: 1; }
        .col-chars { grid-column: 1 / span 2; grid-row: 2; }

        /* --- HORIZONTAL CHARACTER SELECT --- */
        .char-grid { display: flex; flex-direction: row; overflow-x: auto; gap: 15px; padding-bottom: 10px; width: 100%; align-items: center; }
        .char-card { min-width: 140px; flex-shrink: 0; background: rgba(0,0,0,0.5); border: 2px solid transparent; border-radius: 8px; padding: 15px; text-align: center; cursor: pointer; transition: 0.2s; display: flex; flex-direction: column; align-items: center; }
        .char-card:hover { background: rgba(255,255,255,0.1); }
        .char-card.selected { border-color: #00e676; background: rgba(0, 230, 118, 0.1); }
        
        /* --- ROSTER & CHAT --- */
        .roster-item { display: flex; align-items: center; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 6px; margin-bottom: 8px; gap: 10px;}
        .char-avatar { width: 40px; height: 40px; border-radius: 4px; background: #333; display: flex; justify-content: center; align-items: center; font-weight: bold; border: 1px solid #555; overflow: hidden; }
        .ready-badge { font-size: 11px; padding: 4px 8px; border-radius: 4px; font-weight: bold; margin-left: auto; }
        .ready-true { background: rgba(0, 255, 0, 0.2); color: #00ff00; border: 1px solid #00ff00; }
        .ready-false { background: rgba(255, 0, 0, 0.2); color: #ff4444; border: 1px solid #ff4444; }
        .lobby-chat-box { flex: 1; overflow-y: auto; font-size: 14px; margin-bottom: 10px; display: flex; flex-direction: column; justify-content: flex-end; }
        .lobby-chat-msg { padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        
        /* --- TOAST NOTIFICATIONS --- */
        #toast-container { position: fixed; top: 20px; right: 20px; z-index: 999999; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
        .toast { background: rgba(20, 25, 35, 0.95); border-left: 4px solid #bf55ec; padding: 15px 20px; border-radius: 6px; color: white; font-weight: bold; box-shadow: 0 4px 15px rgba(0,0,0,0.5); animation: slideIn 0.3s ease-out forwards; min-width: 250px; }
        .toast.error { border-left-color: #ff4444; }
        .toast.success { border-left-color: #00e676; }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-10px); } }

        /* --- PASSWORD MODAL OVERLAY --- */
        #password-modal-overlay { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); z-index: 200001; display: flex; justify-content: center; align-items: center; }
    `;
        document.head.appendChild(style);
    }

    private buildHTML() {
        this.wrapper.innerHTML = `
        <div id="lobby-version-display" style="position:fixed; bottom:10px; left:10px; color:#aaa; font-size:14px; z-index: 1000000; font-family: monospace; text-shadow: 1px 1px 2px black;"></div>
        <div id="toast-container"></div>
        
        <div id="password-modal-overlay" class="hidden">
            <div class="glass-panel screen-small">
                <h3>Room Password</h3>
                <input type="password" id="join-password-input" class="lobby-input" placeholder="Enter password..." />
                <div style="display:flex; gap:10px; margin-top:20px;">
                    <button id="btn-cancel-password" class="lobby-btn secondary" style="flex:1;">Cancel</button>
                    <button id="btn-submit-password" class="lobby-btn primary" style="flex:1;">Join Room</button>
                </div>
            </div>
        </div>

        <div id="screen-login" class="glass-panel screen-small">
            <h2>Welcome</h2>
            <div class="input-group">
                <span class="input-label">Player Name</span>
                <input type="text" id="player-name-input" class="lobby-input" placeholder="Enter your name..." value="Guest" />
            </div>
            <button id="btn-next" class="lobby-btn primary">Continue</button>
        </div>

        <div id="screen-menu" class="glass-panel screen-small hidden">
            <h2>Main Menu</h2>
            <button id="btn-play" class="lobby-btn primary" style="margin-bottom: 15px;">Play Game</button>
        </div>

        <div id="screen-browser" class="glass-panel screen-full hidden">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 style="margin:0; border:none; padding:0;">Server Browser</h2>
                <button id="btn-back-menu" class="lobby-btn secondary" style="width: auto; padding: 8px 24px; margin:0;">Back</button>
            </div>
            <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                <input type="text" id="search-input" class="lobby-input" placeholder="Search rooms..." style="flex: 1; margin:0;" />
                <button id="btn-refresh" class="lobby-btn secondary" style="width: auto; margin:0;">Refresh</button>
                <button id="btn-goto-create" class="lobby-btn primary" style="width: auto; margin:0;">Create Room</button>
            </div>
            <div id="room-list-container" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;"></div>
        </div>

        <div id="screen-create" class="glass-panel screen-small hidden">
            <h2>Create Room</h2>
            <div class="input-group"><span class="input-label">Room Name</span><input type="text" id="create-room-name" class="lobby-input" placeholder="My Arena" /></div>
            <div class="input-group"><span class="input-label">Password (Optional)</span><input type="password" id="create-room-pass" class="lobby-input" placeholder="Leave blank for open room" /></div>
            <div class="input-group">
                <span class="input-label">Difficulty</span>
                <select id="create-room-diff" class="lobby-input">
                    <option value="easy">Easy</option><option value="normal" selected>Normal</option><option value="hard">Hard</option>
                </select>
            </div>
            <div style="display:flex; gap:10px; margin-top:20px;">
                <button id="btn-cancel-create" class="lobby-btn secondary" style="flex:1;">Cancel</button>
                <button id="btn-confirm-create" class="lobby-btn primary" style="flex:1;">Create</button>
            </div>
        </div>

        <div id="screen-waiting" class="glass-panel screen-full hidden">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 style="margin:0; border:none; padding:0;">Lobby <span id="waiting-room-code" style="color: #bf55ec; font-family: monospace; font-size: 20px; margin-left: 10px;"></span></h2>
                
                <div style="display: flex; gap: 15px;">
                    <button id="btn-toggle-ready" class="lobby-btn secondary" style="border-color: #00e676; color: #00e676; margin: 0;">READY UP</button>
                    <button id="btn-start-match" class="lobby-btn primary hidden" style="margin: 0;" disabled>LAUNCH GAME</button>
                    <button id="btn-leave-match" class="lobby-btn danger" style="width: auto; padding: 8px 24px; margin:0;">Leave Match</button>
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
                        <button id="btn-save-settings" class="lobby-btn secondary">Apply Settings</button>
                    </div>
                    <div id="client-view" class="hidden">
                        <div class="input-group"><span class="input-label">Room Name</span><div id="client-view-name" style="font-weight:bold; font-size:18px;"></div></div>
                        <div class="input-group"><span class="input-label">Difficulty</span><div id="client-view-diff" style="font-weight:bold; font-size:18px;"></div></div>
                        <div class="input-group"><span class="input-label">Map</span><div id="client-view-map" style="font-weight:bold; font-size:18px;"></div></div>
                        <p style="color: #bf55ec; font-style: italic; margin-top: auto;">Only Host can edit settings.</p>
                    </div>
                </div>

                <div class="waiting-col col-roster">
                    <h3 style="margin-bottom: 10px;">Players</h3>
                    <div id="waiting-roster" style="flex: none; margin-bottom: 15px; max-height: 250px; overflow-y:auto;"></div>
                    
                    <div style="flex: 1; background: rgba(0,0,0,0.4); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; margin-bottom: 15px;">
                        <div id="lobby-chat-history" class="lobby-chat-box"></div>
                        
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="text" id="lobby-chat-input" class="lobby-input" placeholder="Send a message..." style="margin: 0; padding: 10px; font-size: 14px; flex: 1;" />
                            <button id="btn-send-chat" class="lobby-btn primary" style="padding: 8px 15px; margin: 0; display: flex; justify-content: center; align-items: center; font-size: 18px;">➤</button>
                        </div>
                    </div>
                    <p id="waiting-host-msg" style="color: #aaa; text-align: center; font-size: 13px; margin-top: auto;">Waiting for host...</p>
                </div>

                <div class="waiting-col col-chars">
                    <h3 style="margin-bottom: 10px; flex-shrink: 0;">Select Character</h3>
                    <div id="character-grid" class="char-grid"></div>
                </div>
            </div>
        </div>
    `;

        this.applyKeyboardFix();
        this.bindEvents();
    }

    // Add this helper method to the class to trigger the notifications
    private showToast(title: string, message: string, type: 'error' | 'success' | 'info' = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<div style="font-size: 12px; color: #aaa; text-transform: uppercase;">${title}</div><div>${message}</div>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease-out forwards';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    private applyKeyboardFix() {
        // Prevent Phaser from stealing input when typing in ANY field
        const inputs = this.wrapper.querySelectorAll('input, select');
        inputs.forEach(el => {
            el.addEventListener('keydown', (e: Event) => e.stopPropagation());
            el.addEventListener('keyup', (e: Event) => e.stopPropagation());
            el.addEventListener('keypress', (e: Event) => e.stopPropagation());
        });
    }

    private bindEvents() {
        const switchScreen = (hideId: string, showId: string) => {
            document.getElementById(hideId)!.classList.add('hidden');
            document.getElementById(showId)!.classList.remove('hidden');
        };

        // Navigation
        document.getElementById('btn-next')!.onclick = () => {
            const input = (document.getElementById('player-name-input') as HTMLInputElement).value.trim();
            if (input) this.playerName = input;
            switchScreen('screen-login', 'screen-menu');
        };
        document.getElementById('btn-play')!.onclick = () => { switchScreen('screen-menu', 'screen-browser'); this.refreshRooms(); };
        document.getElementById('btn-back-menu')!.onclick = () => switchScreen('screen-browser', 'screen-menu');
        document.getElementById('btn-goto-create')!.onclick = () => switchScreen('screen-browser', 'screen-create');
        document.getElementById('btn-cancel-create')!.onclick = () => switchScreen('screen-create', 'screen-browser');
        document.getElementById('btn-refresh')!.onclick = () => this.refreshRooms();

        document.getElementById('search-input')!.addEventListener('input', (e) => {
            const q = (e.target as HTMLInputElement).value.toLowerCase();
            this.renderRoomGrid(this.cachedRooms.filter(r => r.roomName.toLowerCase().includes(q) || r.roomId.toLowerCase().includes(q)));
        });

        // Room Creation & Joining
        document.getElementById('btn-confirm-create')!.onclick = () => {
            const rName = (document.getElementById('create-room-name') as HTMLInputElement).value.trim();
            const rPass = (document.getElementById('create-room-pass') as HTMLInputElement).value.trim();
            const rDiff = (document.getElementById('create-room-diff') as HTMLSelectElement).value;
            this.connection.invoke("CreateRoom", this.playerName, rName, rPass, rDiff);
            switchScreen('screen-create', 'screen-waiting');
        };

        document.getElementById('btn-leave-match')!.onclick = () => {
            this.connection.invoke("LeaveRoom");
            switchScreen('screen-waiting', 'screen-browser');
            this.refreshRooms();
        };

        // Custom Password Modal Logic
        document.getElementById('btn-cancel-password')!.onclick = () => {
            document.getElementById('password-modal-overlay')!.classList.add('hidden');
            (document.getElementById('join-password-input') as HTMLInputElement).value = "";
        };
        document.getElementById('btn-submit-password')!.onclick = () => {
            const pw = (document.getElementById('join-password-input') as HTMLInputElement).value;
            this.connection.invoke("JoinRoom", this.playerName, this.targetRoomIdForPassword, pw);
            document.getElementById('password-modal-overlay')!.classList.add('hidden');
        };

        // Host Settings Update
        document.getElementById('btn-save-settings')!.onclick = () => {
            const rName = (document.getElementById('lobby-edit-name') as HTMLInputElement).value.trim();
            const rPass = (document.getElementById('lobby-edit-pass') as HTMLInputElement).value.trim();
            const rDiff = (document.getElementById('lobby-edit-diff') as HTMLSelectElement).value;
            const rMap = (document.getElementById('lobby-edit-map') as HTMLSelectElement).value;
            this.connection.invoke("UpdateRoomSettings", rName, rPass, rDiff, rMap);
        };

        // Ready & Start
        document.getElementById('btn-toggle-ready')!.onclick = () => {
            this.connection.invoke("ToggleReady");
        };
        document.getElementById('btn-start-match')!.onclick = () => {
            this.connection.invoke("StartMatch");
        };

        // Lobby Chat
        const submitChat = () => {
            const inputEl = document.getElementById('lobby-chat-input') as HTMLInputElement;
            const text = inputEl.value.trim();
            if (text) {
                this.connection.invoke("SendChatMessage", text);
                inputEl.value = '';
            }
        };

        // Send via Enter Key
        document.getElementById('lobby-chat-input')!.addEventListener('keydown', (e: any) => {
            if (e.key === 'Enter') submitChat();
        });

        // Send via Button Click
        document.getElementById('btn-send-chat')!.addEventListener('click', () => submitChat());

        // --- SIGNALR LISTENERS ---

        this.connection.invoke("GetServerVersion").then((v: string) => {
            const vDiv = document.getElementById('lobby-version-display');
            if (vDiv) vDiv.innerText = v;
        }).catch(err => console.error("Failed to fetch version:", err));

        this.connection.on("LobbyError", (msg: string) => {
            // Smart Password Catching
            if (msg === "Incorrect password.") {
                this.showToast("Room Locked", "The host updated the room. A password is now required.", "error");
                document.getElementById('password-modal-overlay')!.classList.remove('hidden');
                document.getElementById('join-password-input')!.focus();
            } else {
                // Replaces the old ugly alert()
                this.showToast("System Error", msg, "error");
            }
        });
        this.connection.on("ReceiveChatMessage", (sender: string, msg: string) => {
            const history = document.getElementById('lobby-chat-history')!;
            const div = document.createElement('div');
            div.className = 'lobby-chat-msg';
            div.innerHTML = `<strong style="color: #bf55ec;">${sender}:</strong> ${msg}`;
            history.appendChild(div);
            history.scrollTop = history.scrollHeight;
        });

        this.connection.on("ReceiveHandshake", (payload: any) => {
            this.masterConfigs = payload;
            this.renderCharacterGrid();
        });

        this.connection.on("LobbyListUpdated", () => {
            // Only auto-refresh if they are currently looking at the browser screen
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

            let allReady = true;

            data.players.forEach((p: any) => {
                if (!p.isReady) allReady = false;

                let charName = "Choosing...";
                let iconHtml = `<div class="char-avatar" style="font-size:16px;">?</div>`;

                if (p.characterId && this.masterConfigs?.characters?.[p.characterId]) {
                    const charData = this.masterConfigs.characters[p.characterId];
                    charName = charData.name || charData.Id || p.characterId;

                    // >>> ASK PHASER FOR THE IMAGE <<<
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
            <span style="font-weight:bold; font-size: 15px;">${p.name} ${p.id === data.hostId ? '<span style="color:#bf55ec;">(Host)</span>' : ''}</span>
            <span style="font-size: 11px; color:#aaa;">${charName}</span>
        </div>
        <div class="ready-badge ${p.isReady ? 'ready-true' : 'ready-false'}">${p.isReady ? 'READY' : 'NOT READY'}</div>
    `;
                roster.appendChild(item);

                // Update my own "Ready" button visually, AND re-render the character grid to lock/unlock it
                if (p.id === this.connection.connectionId) {
                    const readyBtn = document.getElementById('btn-toggle-ready')!;
                    readyBtn.innerText = p.isReady ? "CANCEL READY" : "READY UP";
                    readyBtn.style.background = p.isReady ? "rgba(0, 230, 118, 0.2)" : "";

                    // Re-render grid to apply the grayed-out lock effect based on new ready state
                    this.renderCharacterGrid();
                }
            });

            // The host can only launch if EVERYONE is ready
            const startBtn = document.getElementById('btn-start-match') as HTMLButtonElement;
            startBtn.disabled = !allReady;
        });
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

            // >>> ASK PHASER FOR THE IMAGE <<<
            const textureKey = char.textureKey || char.TextureKey;
            const frame = char.iconFrame ?? char.IconFrame ?? 0;
            const base64Img = this.getIconBase64(textureKey, frame);

            // Clean, standard HTML <img> tag!
            const iconHtml = base64Img
                ? `<img src="${base64Img}" style="width: 48px; height: 48px; margin-bottom: 10px; image-rendering: pixelated; object-fit: contain;" />`
                : `<div style="width: 48px; height: 48px; background: #333; border-radius: 8px; margin-bottom: 10px; display:flex; justify-content:center; align-items:center; font-size:24px; font-weight:bold; color:#bf55ec;">${(char.name || "C").charAt(0).toUpperCase()}</div>`;

            card.innerHTML = `
            ${iconHtml}
            <div style="font-weight:bold; font-size:14px; margin-bottom: 5px;">${char.name || char.Id}</div>
        `;

            if (isLocalPlayerReady) {
                card.style.opacity = '0.5';
                card.style.cursor = 'not-allowed';
            }

            card.onclick = () => {
                if (isLocalPlayerReady) return;

                this.connection.invoke("SelectCharacter", char.id || char.Id);
                document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
            };
            grid.appendChild(card);
        });
    }

    private refreshRooms() {
        const container = document.getElementById('room-list-container')!;
        container.innerHTML = `<div style="padding: 20px; color: #aaa; text-align: center; width: 100%;">Connecting to server...</div>`;

        this.connection.invoke("RequestLobbyData").then((rooms: any[]) => {
            this.cachedRooms = rooms;
            this.renderRoomGrid(rooms);
        });
    }

    private renderRoomGrid(rooms: any[]) {
        const container = document.getElementById('room-list-container')!;
        container.innerHTML = '';

        if (rooms.length === 0) {
            container.innerHTML = `<div style="padding: 20px; color: #aaa; text-align: center; width: 100%;">No matches found. Check your search or create a new one!</div>`;
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
                    <span style="color: #bf55ec; font-weight: bold;">${room.playerCount} Players</span>
                    <button class="card-btn">JOIN</button>
                </div>
            `;

            card.querySelector('.card-btn')!.addEventListener('click', () => {
                if (room.hasPassword) {
                    this.targetRoomIdForPassword = room.roomId;
                    document.getElementById('password-modal-overlay')!.classList.remove('hidden');
                    document.getElementById('join-password-input')!.focus();
                } else {
                    this.connection.invoke("JoinRoom", this.playerName, room.roomId, "");
                }
            });
            container.appendChild(card);
        });
    }
}