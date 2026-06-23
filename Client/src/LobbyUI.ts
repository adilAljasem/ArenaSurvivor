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
    colorBackground: '#14141c',               // Solid dark background to hide the game map
    colorPrimary: '#e5b35c',                  // Gold for borders and accents
    colorPrimaryHover: '#ffcf77',             // Bright gold hover
    colorBtnBgTop: '#4a3b69',                 // Button gradient top (Purple/Blue)
    colorBtnBgBot: '#2a1f43',                 // Button gradient bottom
    colorText: '#ffffff',
    colorMuted: '#a1a1aa'
};

export class LobbyUI {
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
    private audioJoin = new Audio(LOBBY_ASSETS.sfxJoin);
    private audioMessage = new Audio(LOBBY_ASSETS.sfxMessage);

    constructor(connection: HubConnection, getIconBase64: (key: string, frame: number) => string | null, onJoinMatch: () => void) {
        this.connection = connection;
        this.getIconBase64 = getIconBase64;
        this.onJoinMatch = onJoinMatch;

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
                    document.getElementById('join-password-input')!.focus();
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
        /* --- CORE LAYOUT --- */
        #lobby-ui-wrapper { 
            position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; 
            font-family: 'Segoe UI', Tahoma, sans-serif; color: ${LOBBY_ASSETS.colorText};
            background: ${LOBBY_ASSETS.colorBackground}; /* Solid fallback blocks the game map */
            z-index: 100000;
            overflow: hidden;
        }
        
        #bg-video {
            position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; 
            object-fit: cover; z-index: 1; /* Positively indexed to overlay canvas */
            pointer-events: none;
        }

        .ui-content {
            position: relative;
            z-index: 10; /* Placed above the video */
            width: 100vw; height: 100vh;
        }

        .hidden { display: none !important; }

       /* --- VIDEO OVERLAY --- */
        .video-overlay {
            position: absolute; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.6); /* Black transparent overlay */
            z-index: 2; /* Sits above video, below UI */
            pointer-events: none;
        }

       /* --- THE GAME LOGO --- */
        .game-logo {
            text-align: center;
            margin-bottom: 40px;
            user-select: none;
            display: flex;
            justify-content: center;
        }
        
        .logo-img {
            /* clamp(MIN, IDEAL, MAX) 
               300px: Smallest it will ever get (for tiny windows)
               40vw: It will try to take up 40% of the screen width
               700px: Largest it will ever get (for 4K monitors)
            */
            width: clamp(300px, 40vw, 700px); 
            height: auto; /* Keeps the aspect ratio perfect */
            
            transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), filter 0.3s ease;
            filter: drop-shadow(0 0 10px rgba(0,0,0,0.8));
        }
        
        .logo-img.enlarged {
            transform: scale(1.08); /* Makes it pop out when hovering over buttons */
            filter: drop-shadow(0 0 25px rgba(229, 179, 92, 0.6)); 
        }
        
        /* --- CENTERED MENU PANEL (Mage Arena Style) --- */
        .center-menu-panel {
            position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
            display: flex; flex-direction: column; align-items: center;
            padding: 40px; box-sizing: border-box;
            width: 400px;
        }

        /* --- FULL SCREENS (Browser & Match) --- */
        .full-screen-panel {
            position: absolute; left: 0; top: 0; width: 100vw; height: 100vh;
            background: rgba(20, 20, 28, 0.95); /* Dark tint to read text */
            padding: 40px; box-sizing: border-box;
            display: flex; flex-direction: column;
        }

        /* --- TYPOGRAPHY & INPUTS --- */
        h2 { margin: 0 0 20px 0; font-size: 32px; border-bottom: 2px solid ${LOBBY_ASSETS.colorPrimary}; padding-bottom: 10px; color: #fff; text-transform: uppercase; letter-spacing: 2px; text-shadow: 2px 2px 0 #000; }
        h3 { margin: 0 0 15px 0; font-size: 18px; color: ${LOBBY_ASSETS.colorPrimary}; text-transform: uppercase; letter-spacing: 1px; }
        
        .input-group { display: flex; flex-direction: column; margin-bottom: 15px; width: 100%; }
        .input-label { font-size: 12px; color: ${LOBBY_ASSETS.colorMuted}; margin-bottom: 5px; text-transform: uppercase; font-weight: bold; }
        .lobby-input { 
            background: rgba(0,0,0,0.6); border: 2px solid #444; color: white; 
            padding: 12px 15px; border-radius: 6px; font-size: 16px; outline: none; transition: 0.2s;
        }
        .lobby-input:focus { border-color: ${LOBBY_ASSETS.colorPrimary}; box-shadow: 0 0 10px rgba(229, 179, 92, 0.3); }

        /* --- MAGE ARENA STYLE BUTTONS --- */
        .lobby-btn { 
            display: flex; justify-content: center; align-items: center; gap: 15px;
            width: 100%; padding: 14px; margin-bottom: 15px;
            background: linear-gradient(180deg, ${LOBBY_ASSETS.colorBtnBgTop} 0%, ${LOBBY_ASSETS.colorBtnBgBot} 100%);
            border: 2px solid ${LOBBY_ASSETS.colorPrimary}; 
            border-radius: 8px; font-size: 18px; font-weight: bold; color: white;
            cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 2px;
            text-shadow: 2px 2px 2px rgba(0,0,0,0.8);
            box-shadow: 0 6px 15px rgba(0,0,0,0.5), inset 0 0 10px rgba(0,0,0,0.3);
        }
        .lobby-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .lobby-btn:hover:not(:disabled) { 
            background: linear-gradient(180deg, #5c4a82 0%, #362954 100%);
            border-color: ${LOBBY_ASSETS.colorPrimaryHover}; 
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0,0,0,0.6), inset 0 0 15px rgba(229, 179, 92, 0.2); 
        }

        /* Specific Button Overrides */
        .btn-green {
            background: linear-gradient(180deg, #2e7d32 0%, #1b5e20 100%);
            border-color: #4caf50;
        }
        .btn-green:hover:not(:disabled) {
            background: linear-gradient(180deg, #388e3c 0%, #2e7d32 100%);
            border-color: #81c784;
        }
        
        .danger { background: linear-gradient(180deg, #8b0000 0%, #4a0000 100%); border-color: #ff4444; }
        .danger:hover:not(:disabled) { background: linear-gradient(180deg, #a50000 0%, #660000 100%); }

        /* --- BROWSER CARDS --- */
        .room-card { 
            background: rgba(0,0,0,0.6); border: 2px solid #333; 
            border-radius: 8px; padding: 20px; display: flex; justify-content: space-between; 
            align-items: center; transition: 0.2s; 
        }
        .room-card:hover { border-color: ${LOBBY_ASSETS.colorPrimary}; background: rgba(0,0,0,0.8); }
        .card-title { font-size: 20px; font-weight: bold; margin-bottom: 5px; color: #fff; text-shadow: 1px 1px 2px #000; }
        .card-meta { font-size: 14px; color: ${LOBBY_ASSETS.colorMuted}; }

        /* --- MATCH LOBBY GRID --- */
        .waiting-layout { 
            display: grid; grid-template-columns: 350px 1fr; grid-template-rows: 1fr auto; 
            gap: 20px; height: calc(100% - 70px); overflow: hidden; width: 100%;
        }
        .waiting-col { background: rgba(0,0,0,0.6); border: 2px solid #333; border-radius: 8px; padding: 20px; display: flex; flex-direction: column; overflow: hidden; }
        .col-settings { grid-column: 1; grid-row: 1; }
        .col-roster { grid-column: 2; grid-row: 1; }
        .col-chars { grid-column: 1 / span 2; grid-row: 2; }

        /* --- HORIZONTAL CHARACTER SELECT --- */
        .char-grid { display: flex; flex-direction: row; overflow-x: auto; gap: 15px; padding-bottom: 10px; width: 100%; align-items: center; }
        .char-card { min-width: 140px; flex-shrink: 0; background: rgba(0,0,0,0.5); border: 2px solid transparent; border-radius: 8px; padding: 15px; text-align: center; cursor: pointer; transition: 0.2s; display: flex; flex-direction: column; align-items: center; }
        .char-card:hover { background: rgba(0,0,0,0.8); border-color: #555; }
        .char-card.selected { border-color: ${LOBBY_ASSETS.colorPrimary}; background: rgba(229, 179, 92, 0.1); box-shadow: inset 0 0 15px rgba(229, 179, 92, 0.2); }
        
        /* --- ROSTER & CHAT --- */
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
        `;
        document.head.appendChild(style);
    }

    private buildHTML() {
        this.wrapper.innerHTML = `
        <video autoplay muted loop playsinline id="bg-video">
            <source src="${LOBBY_ASSETS.bgVideo}" type="video/mp4">
        </video>
        <div class="video-overlay"></div> <div class="ui-content">
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

            <div id="screen-login" class="center-menu-panel">
                <div class="game-logo">
                    <img src="${LOBBY_ASSETS.gameLogo}" class="logo-img" alt="Mage Arena" />
                </div>
                <div class="input-group" style="margin-bottom: 25px;">
                    <span class="input-label" style="text-align: center;">Enter your name</span>
                    <input type="text" id="player-name-input" class="lobby-input" placeholder="Traveler" value="Guest" style="text-align: center;" />
                </div>
                <button id="btn-next" class="lobby-btn">ENTER REALM</button>
            </div>

            <div id="screen-menu" class="center-menu-panel hidden">
                <div class="game-logo">
                    <img src="${LOBBY_ASSETS.gameLogo}" class="logo-img" alt="Mage Arena" />
                </div>
                <button id="btn-play" class="lobby-btn">NEW GAME</button>
                <button id="btn-collection" class="lobby-btn">COLLECTION</button>
                <button id="btn-settings" class="lobby-btn">OPTIONS</button>
                <button id="btn-tos" class="lobby-btn">EXIT</button>
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
                                <button id="btn-send-chat" class="lobby-btn" style="padding: 14px 20px; margin: 0; width: auto;">➤</button>
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

        // Attach click sounds to all UI buttons
        document.querySelectorAll('.lobby-btn').forEach(btn => {
            btn.addEventListener('click', () => this.playSound(this.audioClick));
        });

        const logos = document.querySelectorAll('.logo-img');
        document.querySelectorAll('.lobby-btn').forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                logos.forEach(logo => logo.classList.add('enlarged'));
            });
            btn.addEventListener('mouseleave', () => {
                logos.forEach(logo => logo.classList.remove('enlarged'));
            });
        });

        // Navigation Bindings
        document.getElementById('btn-next')!.onclick = () => {
            const input = (document.getElementById('player-name-input') as HTMLInputElement).value.trim();
            if (input) this.playerName = input;
            switchScreen('screen-login', 'screen-menu');
        };

        document.getElementById('btn-play')!.onclick = () => {
            switchScreen('screen-menu', 'screen-browser');
            this.refreshRooms();
        };

        // Static buttons
        document.getElementById('btn-collection')!.onclick = () => this.showToast("Collection", "Collection menu coming soon!");
        document.getElementById('btn-settings')!.onclick = () => this.showToast("Settings", "Settings menu coming soon!");
        document.getElementById('btn-tos')!.onclick = () => this.showToast("Exit", "Goodbye!");

        // Return Navigation
        document.getElementById('btn-back-menu')!.onclick = () => switchScreen('screen-browser', 'screen-menu');
        document.getElementById('btn-refresh')!.onclick = () => this.refreshRooms();

        // Browser Search logic
        document.getElementById('search-input')!.addEventListener('input', (e) => {
            const q = (e.target as HTMLInputElement).value.toLowerCase();
            this.renderRoomGrid(this.cachedRooms.filter(r => r.roomName.toLowerCase().includes(q) || r.roomId.toLowerCase().includes(q)));
        });

        // Room Creation Logic - Creates a room directly with "easy" difficulty default
        document.getElementById('btn-goto-create')!.onclick = () => {
            const roomName = `${this.playerName}'s Game`;
            this.connection.invoke("CreateRoom", this.playerName, roomName, "", "easy");
            switchScreen('screen-browser', 'screen-waiting');
        };

        // Leave Room
        document.getElementById('btn-leave-match')!.onclick = () => {
            this.connection.invoke("LeaveRoom");
            switchScreen('screen-waiting', 'screen-browser');
            this.refreshRooms();
        };

        // Password logic
        document.getElementById('btn-cancel-password')!.onclick = () => {
            document.getElementById('password-modal-overlay')!.classList.add('hidden');
            (document.getElementById('join-password-input') as HTMLInputElement).value = "";
        };
        document.getElementById('btn-submit-password')!.onclick = () => {
            const pw = (document.getElementById('join-password-input') as HTMLInputElement).value;
            this.connection.invoke("JoinRoom", this.playerName, this.targetRoomIdForPassword, pw);
            document.getElementById('password-modal-overlay')!.classList.add('hidden');
        };

        // Save Settings
        document.getElementById('btn-save-settings')!.onclick = () => {
            const rName = (document.getElementById('lobby-edit-name') as HTMLInputElement).value.trim();
            const rPass = (document.getElementById('lobby-edit-pass') as HTMLInputElement).value.trim();
            const rDiff = (document.getElementById('lobby-edit-diff') as HTMLSelectElement).value;
            const rMap = (document.getElementById('lobby-edit-map') as HTMLSelectElement).value;
            this.connection.invoke("UpdateRoomSettings", rName, rPass, rDiff, rMap);
        };

        // Ready & Start match
        document.getElementById('btn-toggle-ready')!.onclick = () => this.connection.invoke("ToggleReady");
        document.getElementById('btn-start-match')!.onclick = () => this.connection.invoke("StartMatch");

        // Chat
        const submitChat = () => {
            const inputEl = document.getElementById('lobby-chat-input') as HTMLInputElement;
            const text = inputEl.value.trim();
            if (text) {
                this.connection.invoke("SendChatMessage", text);
                inputEl.value = '';
            }
        };

        document.getElementById('lobby-chat-input')!.addEventListener('keydown', (e: any) => {
            if (e.key === 'Enter') submitChat();
        });
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