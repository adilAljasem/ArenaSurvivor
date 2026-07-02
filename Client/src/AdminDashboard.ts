// Deliberately does NOT import LOBBY_ASSETS/game colors — this panel is meant to look like a
// standard server admin dashboard, not an extension of the game's UI.

// ─── API response shapes ────────────────────────────────────────────────────
interface ServerStatus {
    workerId: string;
    url: string;
    activeRooms: number;
    cpuUsage: number;
    ramUsageMB: number;
    lastUpdated: string;
    isStale: boolean;
}

interface DashboardData {
    servers: ServerStatus[];
    totalRooms: number;
    onlinePlayers: number;
    totalRegisteredUsers: number;
    totalBannedUsers: number;
    totalMatchesPlayed: number;
    totalLifetimeKills: number;
}

interface RedisKeyEntry {
    key: string;
    type: string;
    ttlSeconds: number | null;
}

interface RedisKeysResponse {
    keys: RedisKeyEntry[];
    truncated: boolean;
}

interface RedisValueResponse {
    key: string;
    type: string;
    ttlSeconds: number | null;
    value: unknown;
}

interface PlayerSummary {
    playerId: string;
    username: string;
    email: string;
    isAdmin: boolean;
    isBanned: boolean;
    isEmailVerified: boolean;
    createdAt: string;
}

interface PlayerSearchResponse {
    total: number;
    page: number;
    pageSize: number;
    players: PlayerSummary[];
}

interface MatchRecordDto {
    id: number;
    playerId: string;
    roomId: string;
    username: string;
    configId: string;
    difficulty: string;
    highestWave: number;
    totalDamageDealt: number;
    totalDamageTaken: number;
    totalHealingDone: number;
    totalShieldingDone: number;
    kills: number;
    deaths: number;
    matchDate: string;
}

interface MatchSearchResponse {
    total: number;
    page: number;
    pageSize: number;
    matches: MatchRecordDto[];
}

interface AchievementSummary {
    id: string;
    name: string;
    tier: number;
}

interface PlayerDetailResponse {
    user: {
        playerId: string;
        username: string;
        email: string;
        isAdmin: boolean;
        isBanned: boolean;
        banReason: string | null;
        bannedAt: string | null;
        isEmailVerified: boolean;
        createdAt: string;
    };
    recentMatches: MatchRecordDto[];
    achievementsUnlocked: number;
    achievementsTotal: number;
    achievements: AchievementSummary[];
}

// Matches the PascalCase produced by WorkerHeartbeatService's raw JsonSerializer.Serialize
// call (no naming policy applied there) — this is passed through Redis -> AdminController
// untouched, unlike the rest of the API which goes through ASP.NET's camelCase formatter.
interface LiveGame {
    RoomId: string;
    RoomName: string;
    Difficulty: string;
    Wave: number;
    Phase: string;
    MapId: string;
    PlayerCount: number;
    PlayerNames: string[];
    WorkerId: string;
    WorkerUrl: string;
    LastUpdated: string;
}

type PageId = 'dashboard' | 'redis' | 'players' | 'live-games' | 'matches';

export class AdminDashboard {
    private token: string;
    private wrapper: HTMLDivElement;
    private refreshTimers: Partial<Record<PageId, ReturnType<typeof setInterval>>> = {};
    private currentPage: PageId = 'dashboard';
    private matchesPage: number = 1;
    private onAuthFailure?: () => void;

    // mountEl: the container to render into (LobbyUI owns a dedicated screen div for this —
    // AdminDashboard fills whatever it's given rather than assuming it owns the whole viewport).
    // onAuthFailure: called instead of a hard page redirect when the token is missing/rejected,
    // since this now lives inside the same single-page app rather than being its own page —
    // a redirect here would kick the player out of the lobby entirely for a transient auth hiccup.
    constructor(mountEl: HTMLElement, onAuthFailure?: () => void) {
        this.onAuthFailure = onAuthFailure;
        const token = localStorage.getItem('arena_jwt');
        this.token = token || '';

        this.wrapper = document.createElement('div');
        this.wrapper.id = 'admin-wrapper';
        mountEl.appendChild(this.wrapper);

        this.injectCSS();
        this.buildHTML();
        this.bindEvents();

        if (!token) {
            this.handleAuthFailure();
            return;
        }
        this.boot();
    }

    // Lightweight check with no side effects — used by LobbyUI to decide whether to show the
    // "Admin Panel" button at all, before ever constructing this class.
    static async checkIsAdmin(): Promise<boolean> {
        const token = localStorage.getItem('arena_jwt');
        if (!token) return false;
        try {
            const res = await fetch('/api/admin/me', { headers: { 'Authorization': `Bearer ${token}` } });
            return res.ok;
        } catch {
            return false;
        }
    }

    private handleAuthFailure() {
        if (this.onAuthFailure) this.onAuthFailure();
        else window.location.href = '/';
    }

    // Called by LobbyUI when navigating back to the main menu — stops background polling
    // instead of leaving intervals running for a screen the player can't see.
    public onHide() {
        Object.values(this.refreshTimers).forEach(t => clearInterval(t));
        this.refreshTimers = {};
    }

    // Called by LobbyUI when re-entering the admin screen — resumes polling and refreshes
    // whichever page was last active, without rebuilding any DOM.
    public onShow() {
        this.switchPage(this.currentPage);
    }

    // ─── API helper ─────────────────────────────────────────────────────────
    private async api<T>(path: string, options: RequestInit = {}): Promise<T> {
        const res = await fetch('/api/admin' + path, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (res.status === 401 || res.status === 403) {
            this.showToast('Access denied.', 'error');
            this.handleAuthFailure();
            throw new Error('Not authorized');
        }
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Request failed: ${res.status}`);
        }
        return res.status === 204 ? (null as T) : res.json();
    }

    private async boot() {
        try {
            const me = await this.api<{ username: string; playerId: string }>('/me');
            this.$('#admin-username')!.textContent = me.username;
            this.switchPage('dashboard');
        } catch {
            // api() already redirects on 401/403; nothing else to do here.
        }
    }

    // ─── DOM helpers ────────────────────────────────────────────────────────
    private $(selector: string): HTMLElement | null {
        return this.wrapper.querySelector(selector);
    }
    private $all(selector: string): NodeListOf<HTMLElement> {
        return this.wrapper.querySelectorAll(selector);
    }

    private escapeHtml(str: unknown): string {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
    }
    private escapeAttr(str: unknown): string {
        return this.escapeHtml(str).replace(/"/g, '&quot;');
    }
    private timeAgo(dateStr: string): string {
        const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
        if (diff < 60) return `${Math.floor(diff)}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    }

    private showToast(msg: string, type: 'info' | 'error' = 'info') {
        const container = this.$('#toast-container')!;
        const toast = document.createElement('div');
        toast.className = `admin-toast${type === 'error' ? ' error' : ''}`;
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
    }

    private openModal(html: string) {
        this.$('#modal-box')!.innerHTML = html;
        this.$('#modal-overlay')!.classList.add('active');
    }
    private closeModal() {
        this.$('#modal-overlay')!.classList.remove('active');
    }

    // ─── Layout ─────────────────────────────────────────────────────────────
    private injectCSS() {
        const style = document.createElement('style');
        style.innerHTML = `
        #admin-wrapper {
            --bg: #0d1117;
            --sidebar-bg: #0a0d12;
            --panel-bg: #161b22;
            --panel-bg-alt: #1c2128;
            --primary: #3b82f6;
            --primary-hover: #60a5fa;
            --text: #e6edf3;
            --muted: #8b949e;
            --danger: #f85149;
            --success: #3fb950;
            --warning: #d29922;
            --border: #30363d;
            width: 100%; height: 100%; display: flex;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px; color: var(--text); background: var(--bg);
        }
        #admin-wrapper * { box-sizing: border-box; }

        #admin-sidebar {
            width: 220px; min-width: 220px; background: var(--sidebar-bg); border-right: 1px solid var(--border);
            display: flex; flex-direction: column; padding: 16px 0;
        }
        .admin-sidebar-title { font-size: 15px; font-weight: 600; color: var(--text); padding: 0 20px; margin-bottom: 4px; }
        .admin-sidebar-title span { display: block; font-size: 11px; color: var(--muted); font-weight: 400; margin-top: 2px; }
        .admin-nav-section { margin-top: 24px; }
        .admin-nav-item {
            display: flex; align-items: center; gap: 10px; padding: 9px 20px; cursor: pointer; color: var(--muted);
            font-weight: 500; font-size: 13px; border-left: 2px solid transparent; transition: 0.12s;
        }
        .admin-nav-item:hover { background: rgba(255,255,255,0.03); color: var(--text); }
        .admin-nav-item.active { color: var(--primary); border-left-color: var(--primary); background: rgba(59,130,246,0.08); }
        .admin-nav-icon { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .admin-nav-icon svg { width: 16px; height: 16px; }
        #admin-sidebar-footer { margin-top: auto; padding: 14px 20px; border-top: 1px solid var(--border); }
        #admin-username { font-size: 12px; color: var(--muted); margin-bottom: 10px; }
        #btn-admin-logout {
            width: 100%; padding: 7px; background: transparent; border: 1px solid var(--border); color: var(--muted);
            border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 12px; display: flex; align-items: center;
            justify-content: center; gap: 6px; transition: 0.12s;
        }
        #btn-admin-logout:hover { border-color: var(--danger); color: var(--danger); }

        #admin-main { flex: 1; overflow-y: auto; padding: 28px 36px; }
        .admin-page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .admin-page-title { font-size: 20px; font-weight: 600; color: var(--text); margin: 0; }
        .admin-page-subtitle { color: var(--muted); font-size: 12px; margin-top: 3px; }
        .admin-page { display: none; }
        .admin-page.active { display: block; }

        .admin-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
        .admin-stat-card { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px 18px; }
        .admin-stat-value { font-size: 24px; font-weight: 600; color: var(--text); line-height: 1.2; }
        .admin-stat-label { font-size: 12px; color: var(--muted); margin-top: 4px; }

        .admin-panel { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 8px; padding: 18px; margin-bottom: 16px; }
        .admin-panel-title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 14px; display: flex; align-items: center; gap: 7px; }
        #admin-wrapper table { width: 100%; border-collapse: collapse; }
        #admin-wrapper th { text-align: left; font-size: 11px; font-weight: 600; color: var(--muted); padding: 8px 10px; border-bottom: 1px solid var(--border); }
        #admin-wrapper td { padding: 9px 10px; font-size: 13px; border-bottom: 1px solid rgba(255,255,255,0.04); color: var(--text); }
        #admin-wrapper tbody tr:hover td { background: rgba(255,255,255,0.02); }
        #admin-wrapper tr.clickable { cursor: pointer; }
        .admin-mono { font-family: 'SF Mono', Consolas, Monaco, monospace; font-size: 12px; color: var(--muted); }
        .admin-empty-state { text-align: center; color: var(--muted); padding: 26px; font-size: 13px; }

        .admin-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
        .admin-badge-green { background: rgba(63,185,80,0.15); color: var(--success); }
        .admin-badge-red { background: rgba(248,81,73,0.15); color: var(--danger); }
        .admin-badge-gray { background: rgba(255,255,255,0.06); color: var(--muted); }
        .admin-badge-blue { background: rgba(59,130,246,0.15); color: var(--primary); }
        .admin-badge-amber { background: rgba(210,153,34,0.15); color: var(--warning); }

        #admin-wrapper .admin-btn {
            padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel-bg-alt);
            color: var(--text); cursor: pointer; font-size: 12px; font-weight: 500; transition: 0.12s;
        }
        #admin-wrapper .admin-btn:hover { border-color: #484f58; }
        #admin-wrapper .admin-btn-danger { border-color: rgba(248,81,73,0.4); color: var(--danger); }
        #admin-wrapper .admin-btn-danger:hover { background: var(--danger); color: #fff; border-color: var(--danger); }
        #admin-wrapper .admin-btn-primary { border-color: var(--primary); background: var(--primary); color: #fff; }
        #admin-wrapper .admin-btn-primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }

        #admin-wrapper input[type=text], #admin-wrapper input[type=search], #admin-wrapper select {
            background: var(--panel-bg-alt); border: 1px solid var(--border); color: var(--text); padding: 8px 12px;
            border-radius: 6px; font-size: 13px; outline: none; width: 100%;
        }
        #admin-wrapper input[type=text]:focus, #admin-wrapper input[type=search]:focus, #admin-wrapper select:focus { border-color: var(--primary); }
        .admin-filter-row { display: flex; gap: 10px; }
        .admin-filter-row input { flex: 1; }
        .admin-filter-row select { width: 160px; flex-shrink: 0; }

        .admin-server-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
        .admin-server-card { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
        .admin-server-card.stale { border-color: var(--danger); }
        .admin-server-card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .admin-server-id { font-weight: 600; font-size: 13px; color: var(--text); font-family: 'SF Mono', Consolas, monospace; }
        .admin-server-metric-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); padding: 3px 0; }
        .admin-server-metric-row b { color: var(--text); font-weight: 500; }

        .admin-pagination { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; font-size: 12px; color: var(--muted); }
        .admin-pagination-btns { display: flex; gap: 6px; }

        #modal-overlay { display: none; position: fixed; inset: 0; background: rgba(1,4,9,0.7); z-index: 1000; align-items: center; justify-content: center; }
        #modal-overlay.active { display: flex; }
        #modal-box { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 8px; padding: 24px; width: 480px; max-height: 80vh; overflow-y: auto; }
        #modal-box h3 { margin-top: 0; color: var(--text); font-size: 16px; font-weight: 600; }

        #toast-container { position: fixed; top: 16px; right: 16px; z-index: 2000; display: flex; flex-direction: column; gap: 8px; }
        .admin-toast { background: var(--panel-bg-alt); border: 1px solid var(--border); border-left: 3px solid var(--primary); padding: 10px 16px; border-radius: 6px; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); animation: adminSlideIn 0.15s ease-out; }
        .admin-toast.error { border-left-color: var(--danger); }
        @keyframes adminSlideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

        .admin-kv-table td:first-child { color: var(--muted); width: 150px; font-size: 12px; }
        .admin-value-box { background: #010409; border: 1px solid var(--border); padding: 12px; border-radius: 6px; font-family: 'SF Mono', Consolas, monospace; font-size: 12px; max-height: 300px; overflow: auto; white-space: pre-wrap; word-break: break-all; color: var(--text); }
        `;
        document.head.appendChild(style);
    }

    // Minimal inline SVG icon set (stroke-based, 24x24 viewBox) — kept intentionally small
    // and neutral rather than pulling in an icon library, matching a standard admin-panel look.
    private static readonly ICONS: Record<string, string> = {
        grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
        database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>',
        users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
        list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
        logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    };

    private buildHTML() {
        const icon = (name: string) => `<span class="admin-nav-icon">${AdminDashboard.ICONS[name]}</span>`;
        this.wrapper.innerHTML = `
        <div id="admin-sidebar">
            <div class="admin-sidebar-title">Admin<span>Arena Survivor</span></div>
            <div class="admin-nav-section">
                <div class="admin-nav-item active" data-page="dashboard">${icon('grid')} Dashboard</div>
                <div class="admin-nav-item" data-page="redis">${icon('database')} Redis</div>
                <div class="admin-nav-item" data-page="players">${icon('users')} Players</div>
                <div class="admin-nav-item" data-page="live-games">${icon('activity')} Live Games</div>
                <div class="admin-nav-item" data-page="matches">${icon('list')} All Matches</div>
            </div>
            <div id="admin-sidebar-footer">
                <div id="admin-username">—</div>
                <button id="btn-admin-logout">${AdminDashboard.ICONS.logout} Log Out</button>
            </div>
        </div>

        <div id="admin-main">
            <div class="admin-page active" id="page-dashboard">
                <div class="admin-page-header">
                    <div>
                        <h1 class="admin-page-title">Dashboard</h1>
                        <div class="admin-page-subtitle">Cluster-wide overview · refreshes every 5s</div>
                    </div>
                </div>
                <div class="admin-stat-grid" id="dashboard-stats"></div>
                <div class="admin-panel">
                    <div class="admin-panel-title">Servers</div>
                    <div id="server-grid" class="admin-server-grid"></div>
                </div>
            </div>

            <div class="admin-page" id="page-redis">
                <div class="admin-page-header">
                    <div>
                        <h1 class="admin-page-title">Redis</h1>
                        <div class="admin-page-subtitle">Browse live keys on the Redis server</div>
                    </div>
                </div>
                <div class="admin-panel">
                    <input type="search" id="redis-pattern" placeholder="Key pattern, e.g. session:* or *" value="*" />
                </div>
                <div class="admin-panel">
                    <div class="admin-panel-title">Keys</div>
                    <table>
                        <thead><tr><th>Key</th><th>Type</th><th>TTL</th><th></th></tr></thead>
                        <tbody id="redis-keys-body"></tbody>
                    </table>
                    <div id="redis-empty" class="admin-empty-state" style="display:none;">No keys match this pattern.</div>
                </div>
            </div>

            <div class="admin-page" id="page-players">
                <div class="admin-page-header">
                    <div>
                        <h1 class="admin-page-title">Players</h1>
                        <div class="admin-page-subtitle">Search registered accounts</div>
                    </div>
                </div>
                <div class="admin-panel">
                    <input type="search" id="player-search" placeholder="Search by username or email..." />
                </div>
                <div class="admin-panel">
                    <table>
                        <thead><tr><th>Username</th><th>Email</th><th>Status</th><th>Joined</th></tr></thead>
                        <tbody id="players-body"></tbody>
                    </table>
                    <div id="players-empty" class="admin-empty-state" style="display:none;">No players found.</div>
                </div>
            </div>

            <div class="admin-page" id="page-live-games">
                <div class="admin-page-header">
                    <div>
                        <h1 class="admin-page-title">Live Games</h1>
                        <div class="admin-page-subtitle">Matches currently in progress · refreshes every 5s</div>
                    </div>
                </div>
                <div id="live-games-grid" class="admin-server-grid"></div>
                <div id="live-games-empty" class="admin-empty-state" style="display:none;">No matches are currently running.</div>
            </div>

            <div class="admin-page" id="page-matches">
                <div class="admin-page-header">
                    <div>
                        <h1 class="admin-page-title">All Matches</h1>
                        <div class="admin-page-subtitle">Full match history across all players</div>
                    </div>
                </div>
                <div class="admin-panel">
                    <div class="admin-filter-row">
                        <input type="search" id="matches-search" placeholder="Search by username, character, or room ID..." />
                        <select id="matches-difficulty-filter">
                            <option value="">All difficulties</option>
                            <option value="easy">Easy</option>
                            <option value="normal">Normal</option>
                            <option value="hard">Hard</option>
                        </select>
                    </div>
                </div>
                <div class="admin-panel">
                    <table>
                        <thead><tr>
                            <th>Date</th><th>Player</th><th>Character</th><th>Difficulty</th><th>Wave</th>
                            <th>Kills</th><th>Deaths</th><th>Dmg Dealt</th><th>Dmg Taken</th><th>Healing</th><th>Shielding</th><th>Room</th>
                        </tr></thead>
                        <tbody id="matches-body"></tbody>
                    </table>
                    <div id="matches-empty" class="admin-empty-state" style="display:none;">No matches found.</div>
                    <div id="matches-pagination" class="admin-pagination" style="display:none;"></div>
                </div>
            </div>
        </div>

        <div id="modal-overlay">
            <div id="modal-box"></div>
        </div>

        <div id="toast-container"></div>
        `;
    }

    private bindEvents() {
        this.$all('.admin-nav-item').forEach(item => {
            item.addEventListener('click', () => this.switchPage(item.dataset.page as PageId));
        });

        this.$('#btn-admin-logout')!.addEventListener('click', () => {
            localStorage.removeItem('arena_jwt');
            localStorage.removeItem('arena_username');
            localStorage.removeItem('arena_playerId');
            window.location.href = '/';
        });

        this.$('#modal-overlay')!.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).id === 'modal-overlay') this.closeModal();
        });

        let redisDebounce: ReturnType<typeof setTimeout>;
        this.$('#redis-pattern')!.addEventListener('input', () => {
            clearTimeout(redisDebounce);
            redisDebounce = setTimeout(() => this.loadRedisKeys(), 350);
        });

        let playerDebounce: ReturnType<typeof setTimeout>;
        this.$('#player-search')!.addEventListener('input', () => {
            clearTimeout(playerDebounce);
            playerDebounce = setTimeout(() => this.loadPlayers(), 350);
        });

        let matchesDebounce: ReturnType<typeof setTimeout>;
        this.$('#matches-search')!.addEventListener('input', () => {
            clearTimeout(matchesDebounce);
            matchesDebounce = setTimeout(() => { this.matchesPage = 1; this.loadMatches(); }, 350);
        });
        this.$('#matches-difficulty-filter')!.addEventListener('change', () => {
            this.matchesPage = 1;
            this.loadMatches();
        });
    }

    private switchPage(pageId: PageId) {
        this.currentPage = pageId;
        this.$all('.admin-nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === pageId));
        this.$all('.admin-page').forEach(p => p.classList.toggle('active', p.id === `page-${pageId}`));
        Object.values(this.refreshTimers).forEach(t => clearInterval(t));

        if (pageId === 'dashboard') {
            this.loadDashboard();
            this.refreshTimers.dashboard = setInterval(() => this.loadDashboard(), 5000);
        } else if (pageId === 'redis') {
            this.loadRedisKeys();
        } else if (pageId === 'players') {
            this.loadPlayers();
        } else if (pageId === 'live-games') {
            this.loadLiveGames();
            this.refreshTimers['live-games'] = setInterval(() => this.loadLiveGames(), 5000);
        } else if (pageId === 'matches') {
            this.loadMatches();
        }
    }

    // ─── Dashboard ──────────────────────────────────────────────────────────
    private async loadDashboard() {
        let data: DashboardData;
        try { data = await this.api<DashboardData>('/dashboard'); } catch { return; }

        this.$('#dashboard-stats')!.innerHTML = `
            <div class="admin-stat-card"><div class="admin-stat-value">${data.onlinePlayers}</div><div class="admin-stat-label">Players Online</div></div>
            <div class="admin-stat-card"><div class="admin-stat-value">${data.totalRooms}</div><div class="admin-stat-label">Active Rooms</div></div>
            <div class="admin-stat-card"><div class="admin-stat-value">${data.servers.length}</div><div class="admin-stat-label">Servers Online</div></div>
            <div class="admin-stat-card"><div class="admin-stat-value">${data.totalRegisteredUsers}</div><div class="admin-stat-label">Registered Users</div></div>
            <div class="admin-stat-card"><div class="admin-stat-value">${data.totalMatchesPlayed}</div><div class="admin-stat-label">Matches Played (all-time)</div></div>
            <div class="admin-stat-card"><div class="admin-stat-value">${data.totalLifetimeKills.toLocaleString()}</div><div class="admin-stat-label">Total Kills (all-time)</div></div>
            <div class="admin-stat-card"><div class="admin-stat-value">${data.totalBannedUsers}</div><div class="admin-stat-label">Banned Users</div></div>
        `;

        const grid = this.$('#server-grid')!;
        if (data.servers.length === 0) {
            grid.innerHTML = `<div class="admin-empty-state">No servers reporting in. Are your Worker/Master nodes running?</div>`;
            return;
        }
        grid.innerHTML = data.servers.map(s => `
            <div class="admin-server-card ${s.isStale ? 'stale' : ''}">
                <div class="admin-server-card-top">
                    <span class="admin-server-id">${s.workerId.substring(0, 8)}</span>
                    <span class="admin-badge ${s.isStale ? 'admin-badge-red' : 'admin-badge-green'}">${s.isStale ? 'STALE' : 'ONLINE'}</span>
                </div>
                <div class="admin-server-metric-row"><span>URL</span><b>${s.url || '—'}</b></div>
                <div class="admin-server-metric-row"><span>Active Rooms</span><b>${s.activeRooms}</b></div>
                <div class="admin-server-metric-row"><span>CPU</span><b>${s.cpuUsage.toFixed(1)}%</b></div>
                <div class="admin-server-metric-row"><span>RAM</span><b>${s.ramUsageMB} MB</b></div>
                <div class="admin-server-metric-row"><span>Last Heartbeat</span><b>${this.timeAgo(s.lastUpdated)}</b></div>
            </div>
        `).join('');
    }

    // ─── Redis ──────────────────────────────────────────────────────────────
    private async loadRedisKeys() {
        const pattern = (this.$('#redis-pattern') as HTMLInputElement).value.trim() || '*';
        let data: RedisKeysResponse;
        try { data = await this.api<RedisKeysResponse>(`/redis/keys?pattern=${encodeURIComponent(pattern)}&limit=200`); } catch { return; }

        const body = this.$('#redis-keys-body')!;
        const empty = this.$('#redis-empty')!;
        if (data.keys.length === 0) {
            body.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';
        body.innerHTML = data.keys.map(k => `
            <tr class="clickable" data-key="${this.escapeAttr(k.key)}">
                <td>${this.escapeHtml(k.key)}</td>
                <td><span class="admin-badge admin-badge-gray">${k.type}</span></td>
                <td>${k.ttlSeconds != null ? Math.round(k.ttlSeconds) + 's' : '—'}</td>
                <td><button class="admin-btn admin-btn-danger btn-del-key" data-key="${this.escapeAttr(k.key)}">Delete</button></td>
            </tr>
        `).join('');

        body.querySelectorAll('tr.clickable').forEach(row => {
            row.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).classList.contains('btn-del-key')) return;
                this.showRedisValue((row as HTMLElement).dataset.key!);
            });
        });
        body.querySelectorAll('.btn-del-key').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const key = (btn as HTMLElement).dataset.key!;
                if (!confirm(`Delete key "${key}"?`)) return;
                await this.api(`/redis/value?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
                this.showToast('Key deleted.');
                this.loadRedisKeys();
            });
        });
    }

    private async showRedisValue(key: string) {
        let data: RedisValueResponse;
        try { data = await this.api<RedisValueResponse>(`/redis/value?key=${encodeURIComponent(key)}`); } catch { return; }
        const valueStr = typeof data.value === 'string' ? data.value : JSON.stringify(data.value, null, 2);
        this.openModal(`
            <h3>${this.escapeHtml(data.key)}</h3>
            <table class="admin-kv-table">
                <tr><td>Type</td><td><span class="admin-badge admin-badge-gray">${data.type}</span></td></tr>
                <tr><td>TTL</td><td>${data.ttlSeconds != null ? Math.round(data.ttlSeconds) + 's' : 'No expiry'}</td></tr>
            </table>
            <div style="margin-top:14px;"><pre class="admin-value-box">${this.escapeHtml(valueStr)}</pre></div>
        `);
    }

    // ─── Players ────────────────────────────────────────────────────────────
    private async loadPlayers() {
        const query = (this.$('#player-search') as HTMLInputElement).value.trim();
        let data: PlayerSearchResponse;
        try { data = await this.api<PlayerSearchResponse>(`/players/search?query=${encodeURIComponent(query)}&pageSize=50`); } catch { return; }

        const body = this.$('#players-body')!;
        const empty = this.$('#players-empty')!;
        if (data.players.length === 0) {
            body.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';
        body.innerHTML = data.players.map(p => `
            <tr class="clickable" data-id="${p.playerId}">
                <td>${this.escapeHtml(p.username)}${p.isAdmin ? ' <span class="admin-badge admin-badge-blue">ADMIN</span>' : ''}</td>
                <td>${this.escapeHtml(p.email)}</td>
                <td>${p.isBanned ? '<span class="admin-badge admin-badge-red">BANNED</span>' : (p.isEmailVerified ? '<span class="admin-badge admin-badge-green">VERIFIED</span>' : '<span class="admin-badge admin-badge-gray">UNVERIFIED</span>')}</td>
                <td>${new Date(p.createdAt).toLocaleDateString()}</td>
            </tr>
        `).join('');

        body.querySelectorAll('tr.clickable').forEach(row => {
            row.addEventListener('click', () => this.showPlayerDetail((row as HTMLElement).dataset.id!));
        });
    }

    private async showPlayerDetail(playerId: string) {
        let data: PlayerDetailResponse;
        try { data = await this.api<PlayerDetailResponse>(`/players/${playerId}`); } catch { return; }
        const u = data.user;

        const matchesHtml = data.recentMatches.length === 0
            ? '<div class="admin-empty-state">No matches played yet.</div>'
            : `<table><thead><tr><th>Date</th><th>Character</th><th>Difficulty</th><th>Wave</th><th>Kills</th></tr></thead><tbody>
                ${data.recentMatches.slice(0, 10).map(m => `
                    <tr><td>${new Date(m.matchDate).toLocaleDateString()}</td><td>${this.escapeHtml(m.configId)}</td><td>${this.escapeHtml(m.difficulty)}</td><td>${m.highestWave}</td><td>${m.kills}</td></tr>
                `).join('')}
            </tbody></table>`;

        const achHtml = data.achievements.length === 0
            ? '<div class="admin-empty-state">No achievements unlocked yet.</div>'
            : data.achievements.map(a => `<span class="admin-badge admin-badge-blue" style="margin:2px;">${this.escapeHtml(a.name)}</span>`).join(' ');

        this.openModal(`
            <h3>${this.escapeHtml(u.username)} ${u.isAdmin ? '<span class="admin-badge admin-badge-blue">ADMIN</span>' : ''}</h3>
            <table class="admin-kv-table">
                <tr><td>Email</td><td>${this.escapeHtml(u.email)}</td></tr>
                <tr><td>Player ID</td><td style="font-size:11px; color:var(--muted);">${u.playerId}</td></tr>
                <tr><td>Joined</td><td>${new Date(u.createdAt).toLocaleString()}</td></tr>
                <tr><td>Status</td><td>${u.isBanned
                    ? `<span class="admin-badge admin-badge-red">BANNED</span>${u.banReason ? ' — ' + this.escapeHtml(u.banReason) : ''}`
                    : '<span class="admin-badge admin-badge-green">ACTIVE</span>'}</td></tr>
            </table>

            <div class="admin-panel-title" style="margin-top:18px;">🏆 Achievements (${data.achievementsUnlocked}/${data.achievementsTotal})</div>
            <div>${achHtml}</div>

            <div class="admin-panel-title" style="margin-top:18px;">🕹 Recent Matches</div>
            ${matchesHtml}

            <div style="margin-top:20px; display:flex; gap:10px;">
                ${u.isBanned
                    ? `<button class="admin-btn admin-btn-primary" id="btn-unban">Unban Player</button>`
                    : `<button class="admin-btn admin-btn-danger" id="btn-ban">Ban Player</button>`}
                <button class="admin-btn" id="btn-close-modal">Close</button>
            </div>
        `);

        this.$('#btn-close-modal')?.addEventListener('click', () => this.closeModal());

        this.$('#btn-ban')?.addEventListener('click', async () => {
            const reason = prompt('Ban reason (optional):') || '';
            try {
                await this.api(`/players/${playerId}/ban`, { method: 'POST', body: JSON.stringify({ reason }) });
                this.showToast('Player banned.');
                this.closeModal();
                this.loadPlayers();
            } catch (e) {
                this.showToast((e as Error).message, 'error');
            }
        });
        this.$('#btn-unban')?.addEventListener('click', async () => {
            await this.api(`/players/${playerId}/unban`, { method: 'POST' });
            this.showToast('Player unbanned.');
            this.closeModal();
            this.loadPlayers();
        });
    }

    // ─── Live Games ─────────────────────────────────────────────────────────
    private async loadLiveGames() {
        let data: { games: LiveGame[] };
        try { data = await this.api<{ games: LiveGame[] }>('/live-games'); } catch { return; }

        const grid = this.$('#live-games-grid')!;
        const empty = this.$('#live-games-empty')!;
        if (data.games.length === 0) {
            grid.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';
        grid.innerHTML = data.games.map(g => `
            <div class="admin-server-card">
                <div class="admin-server-card-top">
                    <span class="admin-server-id">${this.escapeHtml(g.RoomName)}</span>
                    <span class="admin-badge admin-badge-blue">${this.escapeHtml(g.Phase)}</span>
                </div>
                <div class="admin-server-metric-row"><span>Difficulty</span><b>${this.escapeHtml(g.Difficulty)}</b></div>
                <div class="admin-server-metric-row"><span>Wave</span><b>${g.Wave}</b></div>
                <div class="admin-server-metric-row"><span>Map</span><b>${this.escapeHtml((g.MapId || '').replace('map_', ''))}</b></div>
                <div class="admin-server-metric-row"><span>Players</span><b>${g.PlayerCount}</b></div>
                <div style="margin-top:8px; font-size:12px; color:var(--muted);">${(g.PlayerNames || []).map(n => this.escapeHtml(n)).join(', ') || '—'}</div>
            </div>
        `).join('');
    }

    // ─── All Matches ────────────────────────────────────────────────────────
    private async loadMatches() {
        const query = (this.$('#matches-search') as HTMLInputElement).value.trim();
        const difficulty = (this.$('#matches-difficulty-filter') as HTMLSelectElement).value;
        const pageSize = 25;

        let data: MatchSearchResponse;
        try {
            data = await this.api<MatchSearchResponse>(
                `/matches?query=${encodeURIComponent(query)}&difficulty=${encodeURIComponent(difficulty)}&page=${this.matchesPage}&pageSize=${pageSize}`
            );
        } catch { return; }

        const body = this.$('#matches-body')!;
        const empty = this.$('#matches-empty')!;
        const pagination = this.$('#matches-pagination')!;

        if (data.matches.length === 0) {
            body.innerHTML = '';
            empty.style.display = 'block';
            pagination.style.display = 'none';
            return;
        }
        empty.style.display = 'none';

        body.innerHTML = data.matches.map(m => `
            <tr>
                <td class="admin-mono">${new Date(m.matchDate).toLocaleString()}</td>
                <td>${this.escapeHtml(m.username)}</td>
                <td>${this.escapeHtml(m.configId)}</td>
                <td><span class="admin-badge admin-badge-gray">${this.escapeHtml(m.difficulty)}</span></td>
                <td>${m.highestWave}</td>
                <td>${m.kills}</td>
                <td>${m.deaths}</td>
                <td>${Math.round(m.totalDamageDealt).toLocaleString()}</td>
                <td>${Math.round(m.totalDamageTaken).toLocaleString()}</td>
                <td>${Math.round(m.totalHealingDone).toLocaleString()}</td>
                <td>${Math.round(m.totalShieldingDone).toLocaleString()}</td>
                <td class="admin-mono">${this.escapeHtml(m.roomId)}</td>
            </tr>
        `).join('');

        const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
        pagination.style.display = 'flex';
        pagination.innerHTML = `
            <span>${data.total.toLocaleString()} match${data.total === 1 ? '' : 'es'} · page ${data.page} of ${totalPages}</span>
            <div class="admin-pagination-btns">
                <button class="admin-btn" id="btn-matches-prev" ${data.page <= 1 ? 'disabled' : ''}>Previous</button>
                <button class="admin-btn" id="btn-matches-next" ${data.page >= totalPages ? 'disabled' : ''}>Next</button>
            </div>
        `;
        this.$('#btn-matches-prev')?.addEventListener('click', () => {
            if (this.matchesPage > 1) { this.matchesPage--; this.loadMatches(); }
        });
        this.$('#btn-matches-next')?.addEventListener('click', () => {
            if (this.matchesPage < totalPages) { this.matchesPage++; this.loadMatches(); }
        });
    }
}