import { HubConnection } from '@microsoft/signalr';
import { AdminDashboard } from './AdminDashboard';

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
// STAT ICONS (SVG-based, replacing the old plain-text-only labels)
// ==========================================
// Inner SVG markup (no <svg> wrapper, no color) for each icon concept - kept deliberately
// simple (circles/lines/basic paths) so it reads clearly at the small sizes these render at.
// A few related stats intentionally share an icon (see STAT_ICON_ALIASES below) and are told
// apart by their badge color/label instead, same as real game UIs commonly do.
// IMPORTANT: UI.ts (the in-game client) keeps its own copy of this exact object - if you
// add/change an icon here, mirror the change there so every screen stays visually identical.
const STAT_ICON_PATHS: Record<string, string> = {
    maxHp: '<path d="M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54Z"/>',
    hpRegen: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    lifeStealPercent: '<path d="M12 2C12 2 5 10.5 5 15a7 7 0 0 0 14 0C19 10.5 12 2 12 2Z"/>',
    damagePercent: '<path d="m12 2 2.2 6.8H21l-5.6 4.1 2.1 6.9L12 15.7l-5.5 4.1 2.1-6.9L3 8.8h6.8Z"/>',
    meleeDamage: '<path d="M12 2v14M8 6h8M9 20h6M12 16v4"/>',
    rangedDamage: '<path d="M6 3a9 9 0 0 0 0 18M6 3l3 3M6 21l3-3M3 12h14M14 9l4 3-4 3"/>',
    magicDamage: '<path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8Z"/>',
    movementSpeed: '<path d="M4 12h6M13 6l6 6-6 6"/>',
    range: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    haste: '<path d="M13 2 4 14h6l-1 8 9-12h-6Z"/>',
    engineering: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    armor: '<path d="M12 2 20 5v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5Z"/>',
    defensePercent: '<path d="M12 2 20 5v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5Z"/><path d="M7 10.5h10"/>',
    magicDefense: '<path d="M12 2 20 6.5v9L12 22 4 15.5v-9Z"/>',
    shieldPower: '<path d="M4 15a8 8 0 0 1 16 0"/><path d="M4 15h16"/>',
    dodge: '<path d="M4 12c4-8 12-8 16 0M16 8l4 4-4 4"/>',
    luck: '<circle cx="9" cy="8" r="3.1"/><circle cx="15" cy="8" r="3.1"/><circle cx="9" cy="14" r="3.1"/><circle cx="15" cy="14" r="3.1"/><path d="M12 14v7"/>',
    harvesting: '<path d="M12 2C7 4 4 9 4 14a8 8 0 0 0 16 0c0-5-3-10-8-12Z"/><path d="M12 6v14"/>',
    attackSpeedPercent: '<circle cx="12" cy="13" r="8"/><path d="M12 13V8M9 2h6"/>',
    xpGainPercent: '<path d="M12 20V4M6 10l6-6 6 6"/>',
    projectileSpeedPercent: '<path d="M3 12h4M9 12h4M17 6l4 6-4 6"/>',
    critChance: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M18.4 5.6l-4.2 4.2M9.8 14.2l-4.2 4.2"/>',
    healPower: '<path d="M12 3v6M12 15v6M6 12H3M21 12h-3"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>',
    pickupRange: '<path d="M6 4v8a6 6 0 0 0 12 0V4M6 4h4M14 4h4M6 9h4M14 9h4"/>',
    default: '<circle cx="12" cy="12" r="9"/><path d="M12 16h.01M12 8v4"/>',
};

// Every stat now has its own unique icon (see STAT_ICON_PATHS) - this stays as the mechanism
// for it, in case a genuinely intentional icon reuse comes up later, but is empty for now.
const STAT_ICON_ALIASES: Record<string, string> = {};

function getStatIconKey(key: string): string {
    return STAT_ICON_ALIASES[key] || key;
}

// Each icon's own fixed, characteristic color (e.g. a red heart, yellow lightning bolt) -
// independent of whether the badge it's in is showing a positive or negative value. This is
// what the old emoji set had for free; a plain-shape icon needs it assigned explicitly or
// everything ends up the same 2-3 sign colors (green/red/gray) and loses its identity.
const STAT_ICON_COLORS: Record<string, string> = {
    maxHp: '#ef5350',
    hpRegen: '#66bb6a',
    lifeStealPercent: '#c2185b',
    damagePercent: '#ffa726',
    meleeDamage: '#e64a19',
    rangedDamage: '#66bb6a',
    magicDamage: '#ab47bc',
    movementSpeed: '#29b6f6',
    range: '#26a69a',
    haste: '#fdd835',
    engineering: '#90a4ae',
    armor: '#5c6bc0',
    defensePercent: '#7986cb',
    magicDefense: '#7e57c2',
    shieldPower: '#26c6da',
    dodge: '#4fc3f7',
    luck: '#66bb6a',
    harvesting: '#8bc34a',
    attackSpeedPercent: '#ff8a65',
    xpGainPercent: '#ffca28',
    projectileSpeedPercent: '#4dd0e1',
    critChance: '#ff5252',
    healPower: '#f06292',
    pickupRange: '#7986cb',
    default: '#9e9e9e',
};

function getStatIconColor(key: string): string {
    return STAT_ICON_COLORS[getStatIconKey(key)] ?? STAT_ICON_COLORS['default'];
}

// Inline SVG for a stat icon - safe to drop straight into innerHTML. Bakes in the icon's own
// fixed color (see STAT_ICON_COLORS) rather than inheriting the wrapping badge's sign-color,
// so e.g. the heart stays red whether it's showing a +10 or a -10 Max HP.
function statIconSvg(key: string, sizePx: number = 13): string {
    const color = getStatIconColor(key);
    const inner = (STAT_ICON_PATHS[getStatIconKey(key)] ?? STAT_ICON_PATHS['default']).replace(/currentColor/g, color);
    return `<svg viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;flex-shrink:0;margin-right:2px;">${inner}</svg>`;
}

// ==========================================
// CHARACTER BASE STAT REFERENCE VALUES
// ==========================================
// "Normal"/expected value for each base stat, used only by the character picker UI to show
// how a character's stat compares to the norm. Example: if movementSpeed here is 180 and a
// character has 160, the UI shows "160 (-20)" in red next to it; a character with 200 shows
// "200 (+20)" in green. A stat with no entry here (or an exact match) shows with no diff tag.
// EDIT THESE NUMBERS to rebalance what "normal" means for each stat — nothing else reads
// from this table, so changing it only changes what players see, not actual gameplay.
export const CHARACTER_BASE_STAT_REFERENCE: Record<string, number> = {
    maxHp: 100,
    hpRegen: 0.5,
    lifeStealPercent: 0,
    damagePercent: 0,
    meleeDamage: 5,
    rangedDamage: 5,
    magicDamage: 5,
    movementSpeed: 180,
    range: 0,
    haste: 0,
    engineering: 0,
    armor: 5,
    magicDefense: 5,
    defensePercent: 0,
    dodge: 0,
    luck: 0,
    harvesting: 0,
    attackSpeedPercent: 0,
    xpGainPercent: 0,
    projectileSpeedPercent: 0,
    critChance: 0,
    healPower: 0,
    shieldPower: 0,
    pickupRange: 0,
};

// ==========================================
// PERCENT-STYLE STAT CLASSIFICATION
// ==========================================
// Whether a stat should ever render with a "%" is decided purely by its name: any key ending
// in "Percent" (damagePercent, lifeStealPercent, defensePercent, ...) - exactly matching the
// naming convention already used in Stats.json. Stats without that suffix (dodge, critChance,
// healPower, shieldPower, etc.) always render as plain flat numbers when shown as a base/bonus
// stat. This does NOT apply to the statMultipliers bucket, which always shows "%" regardless
// of key - a multiplier is inherently a percentage no matter what stat it's scaling.
function isPercentStat(key: string): boolean {
    return !!key && key.endsWith('Percent');
}

// Difficulty id -> color. Falls back to a neutral gray for any custom difficulty id not
// listed here, so new difficulties added server-side (Configs/Difficulties.json) never break.
const DIFFICULTY_COLORS: Record<string, string> = {
    easy: '#4caf50',
    normal: '#4a90e2',
    hard: '#e5b35c',
    nightmare: '#8b0000',
};
export function getDifficultyColor(id: string): string {
    return DIFFICULTY_COLORS[(id || '').toLowerCase()] || '#888';
}

// Minimal inline SVG icon set for the main lobby menu buttons — stroke-based, 24x24 viewBox,
// using currentColor so they pick up each button's text color automatically. Same technique
// AdminDashboard.ts uses for its sidebar icons.
const MENU_ICONS: Record<string, string> = {
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 5H4a2 2 0 0 0 0 4h3"/><path d="M17 5h3a2 2 0 0 1 0 4h-3"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
};
function menuIcon(name: keyof typeof MENU_ICONS): string {
    return `<span class="lobby-btn-icon">${MENU_ICONS[name]}</span>`;
}

// ==========================================
// 1. AUTHENTICATION UI
// ==========================================
// ═══════════════════════════════════════════════════════════════════════════
// TERMS OF SERVICE
// Starting-point legal template — NOT reviewed by a lawyer. Fill in the [PLACEHOLDER]
// fields (contact email, jurisdiction) before relying on this, and get it reviewed by an
// actual attorney before you're depending on it in a real dispute, especially if you ever
// add real-money purchases or operate in a jurisdiction with strong consumer-protection law
// (EU/UK especially — "all sales final" is NOT always enforceable there for digital goods).
// ═══════════════════════════════════════════════════════════════════════════
const TERMS_OF_SERVICE_HTML = `
<h3>1. Acceptance of Terms</h3>
<p>By creating an account or otherwise accessing or playing Arena Survivor (the "Game"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not create an account or use the Game.</p>

<h3>2. Eligibility</h3>
<p>You must be at least 13 years old to create an account. If you are under the age of majority in your jurisdiction, you confirm that a parent or legal guardian has reviewed and agreed to these Terms on your behalf.</p>

<h3>3. Independent, Small-Scale Project</h3>
<p>Arena Survivor is developed and operated by an independent developer, not a company with guaranteed resources or dedicated support staff. The Game is provided on a best-effort basis. There is no guarantee of any minimum uptime, continued availability, or ongoing development. The Game may be modified, suspended, or permanently discontinued at any time, with or without notice, for any reason, including but not limited to lack of funding, time, or interest. If the Game is discontinued, no compensation, refund, or replacement will be provided for any lost access, virtual currency, virtual items, or progress.</p>

<h3>4. Accounts</h3>
<p>You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. You agree to provide accurate registration information. One account per person; accounts may not be sold, transferred, or shared.</p>

<h3>5. Acceptable Use</h3>
<p>You agree not to: cheat, exploit bugs, use unauthorized third-party software, or attempt to gain an unfair advantage; harass, threaten, or abuse other players; attempt to disrupt, overload, or gain unauthorized access to the Game's servers or infrastructure; or use the Game for any unlawful purpose.</p>
<p>Violation of this section may result in a warning, temporary suspension, or permanent termination of your account at the sole discretion of the developer, without refund of any kind.</p>

<h3>6. Virtual Currency and Virtual Items</h3>
<p>The Game may include virtual currency, virtual items, achievements, or other in-game content ("Virtual Items"). Virtual Items have no real-world monetary value, are not redeemable for real currency, and are not transferable outside the Game. You do not own Virtual Items; you receive a limited, revocable, non-transferable license to use them within the Game for as long as the Game remains operational and your account remains in good standing.</p>
<p><strong>All purchases or acquisitions of Virtual Items, where applicable, are final. No refunds, exchanges, or returns will be provided for any purchase</strong>, except where required by applicable law. Virtual Items may be modified, rebalanced, removed, or wiped as part of normal game updates, and no compensation is owed for such changes. If your account is suspended or terminated for violating these Terms, you forfeit all Virtual Items and progress associated with that account without compensation.</p>

<h3>7. Service Provided "As Is"</h3>
<p>The Game is provided "as is" and "as available," without warranties of any kind, whether express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. The developer does not warrant that the Game will be uninterrupted, secure, error-free, or free of loss of data.</p>

<h3>8. Limitation of Liability</h3>
<p>To the maximum extent permitted by applicable law, the developer shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of data, progress, or virtual items, arising out of or related to your use of, or inability to use, the Game — even if advised of the possibility of such damages. Where liability cannot be fully excluded under applicable law, the developer's total liability to you for any claim arising from these Terms or the Game is limited to the total amount, if any, you paid to the developer in the twelve (12) months preceding the claim.</p>

<h3>9. Termination</h3>
<p>The developer may suspend or terminate your account at any time, for any reason or no reason, including for suspected violation of these Terms, with or without notice. You may stop using the Game at any time.</p>

<h3>10. Intellectual Property</h3>
<p>All game content, including but not limited to code, art, audio, characters, and design, is the property of the developer or its licensors and is protected by applicable intellectual property laws. Nothing in these Terms grants you any ownership rights in the Game.</p>

<h3>11. Data</h3>
<p>Account creation requires an email address, username, and password. Gameplay data (match history, achievements, statistics) is stored to support core features such as achievements and leaderboards. Do not share sensitive personal information in chat or usernames, as this data is visible to other players and, where relevant, to server administrators.</p>

<h3>12. Changes to These Terms</h3>
<p>These Terms may be updated from time to time. Continued use of the Game after changes are posted constitutes acceptance of the revised Terms. Material changes will be reflected by an updated "last modified" reference where practical.</p>

<h3>13. Governing Law</h3>
<p>These Terms are governed by the laws of [PLACEHOLDER: your country/state], without regard to conflict-of-law principles. Any disputes shall be resolved in the courts of [PLACEHOLDER: your jurisdiction].</p>

<h3>14. Contact</h3>
<p>Questions about these Terms can be sent to [PLACEHOLDER: contact email].</p>

<p style="color:#888; font-size:11px; margin-top:20px; border-top:1px solid #333; padding-top:12px;">Last updated: 2026-7-02</p>
`;

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

    // Shared by handleLogin/handleRegister/handleForgotPassword/handleResetPassword/
    // handleResendVerification - all five previously repeated this exact fetch + JSON
    // parse + catch-network-error block, then diverged on what to do with the result
    // (that per-handler logic is unchanged, only the request plumbing is shared here).
    private async postAuth(url: string, body: any): Promise<{ ok: boolean; status: number; data: any }> {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            return { ok: res.ok, status: res.status, data };
        } catch {
            // A thrown fetch means the request never reached the server, so there's no
            // real HTTP status - 0 is a safe sentinel that can't accidentally match a
            // real status check (e.g. handleResendVerification's `status === 429`).
            return { ok: false, status: 0, data: { error: 'Connection error.' } };
        }
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

                #tos-modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:1000001; align-items:center; justify-content:center; }
                #tos-modal-overlay.active { display:flex; }
                #tos-modal-box { background:#161616; border:2px solid ${LOBBY_ASSETS.colorPrimary}; border-radius:8px; width:560px; max-width:90vw; max-height:80vh; display:flex; flex-direction:column; box-shadow:0 10px 40px rgba(0,0,0,0.8); }
                #tos-modal-header { padding:20px 24px; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center; flex-shrink:0; }
                #tos-modal-header h2 { margin:0; font-size:18px; color:${LOBBY_ASSETS.colorPrimary}; }
                #btn-close-tos { background:none; border:none; color:${LOBBY_ASSETS.colorMuted}; font-size:20px; cursor:pointer; line-height:1; padding:4px; }
                #btn-close-tos:hover { color:#fff; }
                #tos-modal-body { padding:20px 24px; overflow-y:auto; font-size:13px; line-height:1.6; color:#ddd; }
                #tos-modal-body h3 { color:${LOBBY_ASSETS.colorPrimary}; font-size:14px; margin:18px 0 8px; }
                #tos-modal-body h3:first-child { margin-top:0; }
                #tos-modal-body p { margin:0 0 10px; }
                #tos-modal-footer { padding:16px 24px; border-top:1px solid #333; flex-shrink:0; }
                #tos-modal-footer button { width:100%; margin:0; }

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
                        <label style="display:flex; align-items:flex-start; gap:8px; margin-bottom:15px; cursor:pointer; user-select:none;">
                            <input type="checkbox" id="reg-accept-terms" style="margin-top:3px; width:16px; height:16px; flex-shrink:0; accent-color:${LOBBY_ASSETS.colorPrimary}; cursor:pointer;" />
                            <span style="font-size:12px; color:${LOBBY_ASSETS.colorMuted}; line-height:1.4;">
                                I have read and agree to the <a href="#" id="link-view-terms" style="color:${LOBBY_ASSETS.colorPrimary}; text-decoration:underline;">Terms of Service</a>.
                            </span>
                        </label>
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

            <div id="tos-modal-overlay">
                <div id="tos-modal-box">
                    <div id="tos-modal-header">
                        <h2>Terms of Service</h2>
                        <button id="btn-close-tos">✕</button>
                    </div>
                    <div id="tos-modal-body">${TERMS_OF_SERVICE_HTML}</div>
                    <div id="tos-modal-footer">
                        <button class="lobby-btn" id="btn-accept-tos-from-modal">I Agree</button>
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

        document.getElementById('link-view-terms')!.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('tos-modal-overlay')!.classList.add('active');
        });
        document.getElementById('btn-close-tos')!.addEventListener('click', () => {
            document.getElementById('tos-modal-overlay')!.classList.remove('active');
        });
        document.getElementById('tos-modal-overlay')!.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).id === 'tos-modal-overlay') {
                document.getElementById('tos-modal-overlay')!.classList.remove('active');
            }
        });
        // Reading it via the modal and clicking "I Agree" also checks the box for you —
        // still fully editable/uncheckable afterward, this is just a convenience.
        document.getElementById('btn-accept-tos-from-modal')!.addEventListener('click', () => {
            (document.getElementById('reg-accept-terms') as HTMLInputElement).checked = true;
            document.getElementById('tos-modal-overlay')!.classList.remove('active');
        });


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
        const { ok, data } = await this.postAuth('/api/auth/login', { email, password });

        if (ok) {
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

        this.setLoading('btn-login', false);
    }

    private async handleRegister() {
        const email = (document.getElementById('reg-email') as HTMLInputElement).value.trim();
        const username = (document.getElementById('reg-username') as HTMLInputElement).value.trim();
        const password = (document.getElementById('reg-password') as HTMLInputElement).value;
        const acceptedTerms = (document.getElementById('reg-accept-terms') as HTMLInputElement).checked;
        if (!email || !username || !password) { this.showNotice('Please fill in all fields.', 'error'); return; }
        if (!acceptedTerms) { this.showNotice('You must agree to the Terms of Service to create an account.', 'error'); return; }

        this.setLoading('btn-register', true);
        const { ok, data } = await this.postAuth('/api/auth/register', { email, username, password, acceptedTerms });

        if (ok) {
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

        this.setLoading('btn-register', false);
    }

    private async handleForgotPassword() {
        const email = (document.getElementById('forgot-email') as HTMLInputElement).value.trim();
        if (!email) { this.showNotice('Please enter your email.', 'error'); return; }

        this.setLoading('btn-forgot', true);
        const { ok, data } = await this.postAuth('/api/auth/forgot-password', { email });

        if (ok) {
            this.showNotice('✅ ' + data.message, 'success');
        } else {
            this.showNotice('❌ ' + data.error, 'error');
        }

        this.setLoading('btn-forgot', false);
    }

    private async handleResetPassword() {
        const password = (document.getElementById('reset-password') as HTMLInputElement).value;
        const params = new URLSearchParams(window.location.search);
        const token = params.get('reset_token');

        if (!password || !token) { this.showNotice('Please enter a new password.', 'error'); return; }

        this.setLoading('btn-reset', true);
        const { ok, data } = await this.postAuth('/api/auth/reset-password', { token, newPassword: password });

        if (ok) {
            this.showNotice('✅ ' + data.message, 'success');
            window.history.replaceState({}, '', window.location.pathname);
            setTimeout(() => this.showTab('login'), 2000);
        } else {
            this.showNotice('❌ ' + data.error, 'error');
        }

        this.setLoading('btn-reset', false);
    }

    private async handleResendVerification() {
        if (!this.pendingResendEmail) return;
        const btn = document.getElementById('btn-resend') as HTMLButtonElement;

        btn.disabled = true;
        btn.textContent = 'SENDING...';

        const { ok, status, data } = await this.postAuth('/api/auth/resend-verification', { email: this.pendingResendEmail });

        if (status === 429) this.showNotice('⏳ ' + data.error, 'error');
        else if (ok) this.showNotice('✅ ' + data.message, 'success');
        else this.showNotice('❌ ' + data.error, 'error');

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
    private selectedCreateDifficulty: string = '';
    private selectedCreateMapId: string = '';
    private masterConfigs: any = null;

    private connection: HubConnection;
    private getIconHtml: (textureKey: string, frame: number, size: number) => string | null;
    private onJoinMatch: () => void;
    private targetRoomIdForPassword: string = "";

    private lastPlayerCount: number = 0;

    private audioClick = new Audio(LOBBY_ASSETS.sfxClick);
    private pendingResendEmail: string = '';
    private resendCooldownTimer: ReturnType<typeof setInterval> | null = null;
    private audioJoin = new Audio(LOBBY_ASSETS.sfxJoin);
    private audioMessage = new Audio(LOBBY_ASSETS.sfxMessage);

    private adminDashboard: AdminDashboard | null = null;

    constructor(connection: HubConnection, getIconHtml: (key: string, frame: number, size: number) => string | null, onJoinMatch: () => void, playerId: string) {
        this.playerId = playerId;
        this.connection = connection;
        this.getIconHtml = getIconHtml;
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

        // Only shows the Admin Panel button if this account actually is one — checked
        // server-side (AdminOnlyAttribute re-verifies live against the DB), this is just
        // whether to bother showing the button at all.
        AdminDashboard.checkIsAdmin().then(isAdmin => {
            if (isAdmin) document.getElementById('btn-admin-panel')?.classList.remove('hidden');
        });
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
            const spriteHtml = m.textureKey ? this.getIconHtml(m.textureKey, m.iconFrame, 18) : null;
            const iconHtml = spriteHtml
                ? `<div style="width:18px; height:18px; display:inline-block;">${spriteHtml}</div>`
                : `<span style="font-size:13px;">🏆</span>`;
            return `<div class="lock-req-badge">${iconHtml}<span>${m.name}</span></div>`;
        }).join('');
        return `<div class="lock-overlay"><div class="lock-icon">🔒</div><div class="lock-req-label">Requires</div><div class="lock-req-list">${badges}</div></div>`;
    }

    private showInfoModal(kind: 'skill' | 'effect' | 'trait', id: string) {
        const content = document.getElementById('info-modal-content')!;
        const sourceMap: any = {
            skill: this.masterConfigs?.skills || this.masterConfigs?.Skills || {},
            effect: this.masterConfigs?.effects || this.masterConfigs?.Effects || {},
            trait: this.masterConfigs?.traits || this.masterConfigs?.Traits || {},
        };
        const cfg = sourceMap[kind][id];

        if (!cfg) {
            content.innerHTML = `<div class="info-modal-header"><div class="info-modal-title">${id}</div></div><div class="info-modal-desc">No data found for this ${kind}.</div>`;
            document.getElementById('info-modal-overlay')!.classList.remove('hidden');
            return;
        }

        const name = this.pick(cfg, 'name') || id;
        const description = this.pick(cfg, 'description') || 'No description available.';
        const textureKey = this.pick(cfg, 'textureKey');
        const frame = this.pick(cfg, 'iconFrame') ?? 0;
        const spriteHtml = textureKey ? this.getIconHtml(textureKey, frame, 56) : null;
        const iconHtml = spriteHtml
            ? spriteHtml
            : (kind === 'trait' ? '★' : name.charAt(0).toUpperCase());

        let detailsHtml = '';
        if (kind === 'skill') {
            const cooldown = this.pick(cfg, 'cooldownSeconds') ?? 0;
            const castTime = this.pick(cfg, 'castTimeSeconds') ?? 0;
            const channelTime = this.pick(cfg, 'channelDurationSeconds') ?? 0;
            const baseDamage = this.pick(cfg, 'baseDamage') ?? 0;
            const range = this.pick(cfg, 'range') ?? 0;
            const radius = this.pick(cfg, 'radius') ?? 0;
            const actionType = this.pick(cfg, 'actionType') ?? '';
            const targetType = this.pick(cfg, 'targetType') ?? '';
            const applyEffects: string[] = this.pick(cfg, 'applyEffects') || [];
            const effectsSource = this.masterConfigs?.effects || this.masterConfigs?.Effects || {};

            detailsHtml = `
                <div class="coll-stat-grid">
                    ${actionType ? `<div class="coll-stat"><span class="coll-stat-label">Type</span><span class="coll-stat-value">${actionType}</span></div>` : ''}
                    ${targetType ? `<div class="coll-stat"><span class="coll-stat-label">Target</span><span class="coll-stat-value">${targetType}</span></div>` : ''}
                    ${cooldown > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Cooldown</span><span class="coll-stat-value">${this.formatNumber(cooldown)}s</span></div>` : ''}
                    ${castTime > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Cast Time</span><span class="coll-stat-value">${this.formatNumber(castTime)}s</span></div>` : ''}
                    ${channelTime > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Channel</span><span class="coll-stat-value">${this.formatNumber(channelTime)}s</span></div>` : ''}
                    ${baseDamage > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Base Damage</span><span class="coll-stat-value">${this.formatNumber(baseDamage)}</span></div>` : ''}
                    ${range > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Range</span><span class="coll-stat-value">${this.formatNumber(range)}</span></div>` : ''}
                    ${radius > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Radius</span><span class="coll-stat-value">${this.formatNumber(radius)}</span></div>` : ''}
                </div>
                ${applyEffects.length ? `<div style="margin-top:12px;"><div class="coll-section-label">💥 Applies Effects</div><div class="coll-badge-row">${this.buildRefBadgeRow(applyEffects, effectsSource, 'effect')}</div></div>` : ''}
            `;
        } else if (kind === 'effect') {
            const isBuff = !!this.pick(cfg, 'isBuff');
            const duration = this.pick(cfg, 'duration') ?? 0;
            const tickRate = this.pick(cfg, 'tickRate') ?? 0;
            const tickDamage = this.pick(cfg, 'tickDamage') ?? 0;
            const grantedShield = this.pick(cfg, 'grantedShield') ?? 0;
            const statModifiers = this.pick(cfg, 'statModifiers') || {};
            const statMultipliers = this.pick(cfg, 'statMultipliers') || {};
            const modBadges = Object.entries(statModifiers).map(([k, v]) => this.buildStatBadge(this.formatStatName(k), v as number, false, '', k)).join('');
            const multBadges = Object.entries(statMultipliers).map(([k, v]) => this.buildStatBadge(this.formatStatName(k), v as number, true, '', k)).join('');

            detailsHtml = `
                <div class="coll-tags" style="margin-bottom:12px;">
                    <span class="coll-tag" style="background:${isBuff ? '#2e7d32' : '#8b0000'};">${isBuff ? 'Buff' : 'Debuff'}</span>
                </div>
                <div class="coll-stat-grid">
                    ${duration > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Duration</span><span class="coll-stat-value">${this.formatNumber(duration)}s</span></div>` : ''}
                    ${tickRate > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Tick Rate</span><span class="coll-stat-value">${this.formatNumber(tickRate)}s</span></div>` : ''}
                    ${tickDamage > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Tick Damage</span><span class="coll-stat-value">${this.formatNumber(tickDamage)}</span></div>` : ''}
                    ${grantedShield > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Shield</span><span class="coll-stat-value">${this.formatNumber(grantedShield)}</span></div>` : ''}
                </div>
                ${(modBadges || multBadges) ? `<div style="margin-top:12px;"><div class="coll-section-label">✨ Stat Effects</div><div class="coll-badge-row">${modBadges}${multBadges}</div></div>` : ''}
            `;
        } else {
            const isNegative = !!this.pick(cfg, 'isNegative');
            const statBonuses = this.pick(cfg, 'statBonuses') || {};
            const statMultipliers = this.pick(cfg, 'statMultipliers') || {};
            const grantedSkills: string[] = this.pick(cfg, 'grantedSkills') || [];
            const skillsSource = this.masterConfigs?.skills || this.masterConfigs?.Skills || {};
            const bonusBadges = Object.entries(statBonuses).map(([k, v]) => this.buildStatBadge(this.formatStatName(k), v as number, false, '', k)).join('');
            const multBadges = Object.entries(statMultipliers).map(([k, v]) => this.buildStatBadge(this.formatStatName(k), v as number, true, '', k)).join('');

            detailsHtml = `
                <div class="coll-tags" style="margin-bottom:12px;">
                    <span class="coll-tag" style="background:${isNegative ? '#8b0000' : '#2e7d32'};">${isNegative ? 'Negative' : 'Positive'}</span>
                </div>
                ${(bonusBadges || multBadges) ? `<div><div class="coll-section-label">✨ Stat Effects</div><div class="coll-badge-row">${bonusBadges}${multBadges}</div></div>` : ''}
                ${grantedSkills.length ? `<div style="margin-top:12px;"><div class="coll-section-label">⚡ Grants Skills</div><div class="coll-badge-row">${this.buildRefBadgeRow(grantedSkills, skillsSource, 'skill')}</div></div>` : ''}
            `;
        }

        content.innerHTML = `
            <div class="info-modal-header">
                <div class="info-modal-icon">${iconHtml}</div>
                <div>
                    <div class="info-modal-title">${name}</div>
                    <div class="info-modal-kind">${kind}</div>
                </div>
            </div>
            <div class="info-modal-desc">${description}</div>
            ${detailsHtml}
        `;
        document.getElementById('info-modal-overlay')!.classList.remove('hidden');
    }

    private selectedDetailCharacterId: string = '';

    private renderCharacterGrid() {
        if (!this.masterConfigs?.characters) return;
        const list = document.getElementById('character-picker-list')!;
        // >>> FIX: selecting a character re-renders this whole list (to update the
        // "selected" highlight), which used to reset scroll to the top every click.
        // Save/restore it across the rebuild so browsing stays put.
        const preservedScrollTop = list.scrollTop;
        list.innerHTML = '';

        const readyBtn = document.getElementById('btn-toggle-ready')!;
        const isLocalPlayerReady = readyBtn.innerText.includes("CANCEL");
        const characters = this.masterConfigs.characters;
        const entries = Object.values(characters) as any[];

        // No auto-default to "first unlocked" — leads with the picker list alone until the
        // player actually picks something (or the server tells us they already have, on
        // rejoin). A stale selection pointing at a character that no longer exists just clears.
        if (this.selectedDetailCharacterId && !characters[this.selectedDetailCharacterId]) {
            this.selectedDetailCharacterId = '';
        }

        entries.forEach(char => {
            const id = this.pick(char, 'id');
            const name = this.pick(char, 'name') || id;
            const { locked } = this.isCharacterLocked(char);

            const item = document.createElement('div');
            item.className = `char-picker-item ${id === this.selectedDetailCharacterId ? 'selected' : ''} ${locked ? 'locked' : ''}`;
            item.innerHTML = `
                <div class="char-picker-icon">${this.buildIconHtml(char, (name || 'C').charAt(0).toUpperCase(), 34)}</div>
                <div class="char-picker-name">${name}</div>
                ${locked ? `<span class="char-picker-lock">🔒</span>` : ''}
            `;
            item.onclick = () => {
                this.selectedDetailCharacterId = id;
                this.renderCharacterGrid();
                if (!locked && !isLocalPlayerReady) {
                    this.connection.invoke("SelectCharacter", id);
                }
            };
            list.appendChild(item);
        });

        list.scrollTop = preservedScrollTop;

        this.renderCharacterDetail();
    }

    private renderCharacterDetail() {
        const panel = document.getElementById('character-detail-panel')!;
        panel.innerHTML = '';

        if (!this.selectedDetailCharacterId) {
            panel.innerHTML = `
                <div class="char-detail-placeholder">
                    <div class="char-detail-placeholder-icon">☺</div>
                    <div>Pick a character to see their stats, traits, and skills.</div>
                </div>
            `;
            return;
        }

        const char = this.masterConfigs?.characters?.[this.selectedDetailCharacterId];
        if (!char) return;
        panel.appendChild(this.buildCharacterCollectionCard(char));
    }

    private cachedAchievements: any[] = [];
    private activeAchFilter: string = 'all';
    private activeCollectionTab: string = 'enemies';

    private loadScoreboard() {
        const grid = document.getElementById('scoreboard-grid')!;
        grid.innerHTML = `<div style="padding: 20px; color: ${LOBBY_ASSETS.colorMuted};">Loading...</div>`;

        this.connection.invoke("GetScoreboard").then((data: any) => {
            grid.innerHTML = '';
            const myId = data.myPlayerId;

            const boards: { key: string, title: string, icon: string, format: (v: number) => string }[] = [
                { key: 'highestWave', title: 'Highest Wave Reached', icon: '🌊', format: v => Math.floor(v).toString() },
                { key: 'damageDone', title: 'Damage Done', icon: '⚔️', format: v => Math.round(v).toLocaleString() },
                { key: 'healingDone', title: 'Healing Done', icon: '💚', format: v => Math.round(v).toLocaleString() },
                { key: 'shieldDone', title: 'Shielding Done', icon: '🛡️', format: v => Math.round(v).toLocaleString() },
                { key: 'damageTaken', title: 'Damage Taken', icon: '🩸', format: v => Math.round(v).toLocaleString() },
            ];

            boards.forEach(board => {
                const entries: { playerId: string, username: string, value: number }[] = data[board.key] || [];
                const panel = document.createElement('div');
                panel.className = 'score-panel';

                const rows = entries.length === 0
                    ? `<div style="padding: 20px; color: ${LOBBY_ASSETS.colorMuted}; text-align:center; font-size:13px;">No data yet this week.</div>`
                    : entries.map((e, i) => {
                        const rank = i + 1;
                        const isMe = e.playerId === myId;
                        const rankClass = rank <= 3 ? `rank-${rank}` : '';
                        const rankDisplay = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank.toString();
                        return `
                            <div class="score-row ${rankClass} ${isMe ? 'is-me' : ''}">
                                <div class="score-rank ${rankClass}">${rankDisplay}</div>
                                <div class="score-name">${this.escapeIfExists(e.username)}</div>
                                <div class="score-value">${board.format(e.value)}</div>
                            </div>
                        `;
                    }).join('');

                panel.innerHTML = `
                    <div class="score-panel-header">
                        <div class="score-panel-title">${board.icon} ${board.title}</div>
                        <div class="score-panel-subtitle">Top ${entries.length} · Last 7 Days</div>
                    </div>
                    <div class="score-list">${rows}</div>
                `;
                grid.appendChild(panel);
            });
        }).catch(err => {
            console.error("Failed to load scoreboard:", err);
            grid.innerHTML = `<div style="padding: 20px; color: #ff6666;">Failed to load scoreboard.</div>`;
        });
    }

    // Small helper — scoreboard usernames come straight from MatchRecord snapshots (trusted
    // server data), but escape anyway since it's still user-chosen text rendered as HTML.
    private escapeIfExists(str: string): string {
        if (!str) return '';
        return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
    }

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

        const spriteHtml = a.textureKey ? this.getIconHtml(a.textureKey, a.iconFrame || 0, 44) : null;
        const iconHtml = spriteHtml
            ? spriteHtml
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
        // Drop the "Percent" suffix (damagePercent, lifeStealPercent, etc.) - the "%" already
        // shown on the value makes the word redundant in the label.
        let displayKey = key;
        if (isPercentStat(key)) {
            displayKey = displayKey.slice(0, -'Percent'.length);
        }
        const withSpaces = displayKey.replace(/([A-Z])/g, ' $1').trim();
        return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
    }

    private formatNumber(n: number): string {
        if (n === undefined || n === null || isNaN(n)) return '0';
        if (Number.isInteger(n)) return n.toString();
        return n.toFixed(2).replace(/\.?0+$/, '');
    }

    // Unsigned display of a raw stat value, e.g. for enemy/character base-stat grids that
    // aren't rendered through buildStatBadge. Only Percent-suffixed stats (see isPercentStat)
    // get a "%" - everything else (dodge, critChance, healPower, shieldPower, etc.) is a plain
    // flat number here.
    private formatStatValue(key: string, value: number): string {
        if (isPercentStat(key)) return `${Math.round(value * 100)}%`;
        return this.formatNumber(value);
    }

    // Compares a character's actual base stat value against the CHARACTER_BASE_STAT_REFERENCE
    // table (top of file) and returns a small colored "(+X)" / "(-X)" tag to append after the
    // stat value — green if above the reference, red if below, nothing if it matches exactly
    // or the stat has no reference entry configured.
    private buildStatDiffSuffix(key: string, value: number): string {
        const reference = CHARACTER_BASE_STAT_REFERENCE[key];
        if (reference === undefined) return '';
        const diff = value - reference;
        if (diff === 0) return '';
        const color = diff > 0 ? '#4caf50' : '#f44336';
        const sign = diff > 0 ? '+' : '';
        const diffDisplay = isPercentStat(key) ? `${Math.round(diff * 100)}%` : this.formatNumber(diff);
        return ` <span class="stat-diff-tag" style="color:${color};">(${sign}${diffDisplay})</span>`;
    }

    // Sign-colored stat badge: green for positive, red for negative, neutral gray for zero.
    // Shows "%" if EITHER the bucket says so (isPercent=true, i.e. the statMultipliers bucket -
    // always percent, no matter the key, since a multiplier is inherently a percentage) OR the
    // stat's own name is Percent-suffixed (see isPercentStat) - so e.g. a flat "lifeStealPercent"
    // bonus still shows "+5%" even outside the multiplier bucket. Anything else is a flat number.
    private buildStatBadge(label: string, value: number, isPercent: boolean, suffix: string = '', statKey: string = ''): string {
        const color = value > 0 ? '#4caf50' : (value < 0 ? '#f44336' : '#999');
        const sign = value > 0 ? '+' : '';
        const showAsPercent = isPercent || isPercentStat(statKey);
        const displayValue = showAsPercent ? `${sign}${Math.round(value * 100)}%` : `${sign}${this.formatNumber(value)}${suffix}`;
        return `<span class="coll-badge" style="color:${color}; border-color:${color}66;">${statIconSvg(statKey)}${label} ${displayValue}</span>`;
    }

    private buildIconHtml(entry: any, fallbackLetter: string, size: number): string {
        const textureKey = this.pick(entry, 'textureKey');
        const frame = this.pick(entry, 'iconFrame') ?? 0;
        const spriteHtml = textureKey ? this.getIconHtml(textureKey, frame, size) : null;
        return spriteHtml || fallbackLetter;
    }

    // Renders a badge for a skill/effect id, resolving its display name + icon from the
    // matching config dictionary (masterConfigs.skills or masterConfigs.effects) so the
    // collection shows readable names/art instead of raw config ids. Clickable — opens the
    // info modal with that skill/effect's full data.
    private buildRefBadge(id: string, sourceDict: any, kind: 'skill' | 'effect'): string {
        const cfg = sourceDict ? sourceDict[id] : null;
        const name = cfg ? (this.pick(cfg, 'name') || id) : id;
        const textureKey = cfg ? this.pick(cfg, 'textureKey') : null;
        const frame = cfg ? (this.pick(cfg, 'iconFrame') ?? 0) : 0;
        const spriteHtml = textureKey ? this.getIconHtml(textureKey, frame, 16) : null;
        const iconHtml = spriteHtml
            ? `<span style="width:16px; height:16px; display:inline-block; margin-right:5px; vertical-align:middle;">${spriteHtml}</span>`
            : '';
        return `<span class="coll-badge clickable" data-kind="${kind}" data-id="${id}">${iconHtml}${name}</span>`;
    }

    private buildRefBadgeRow(ids: string[], sourceDict: any, kind: 'skill' | 'effect'): string {
        if (!ids || ids.length === 0) return '';
        return ids.map(id => this.buildRefBadge(id, sourceDict, kind)).join('');
    }

    // Traits have no icon in their config, just name/description/stat data.
    private buildTraitBadge(id: string, sourceDict: any): string {
        const cfg = sourceDict ? sourceDict[id] : null;
        const name = cfg ? (this.pick(cfg, 'name') || id) : id;
        const isNegative = cfg ? !!this.pick(cfg, 'isNegative') : false;
        return `<span class="coll-badge clickable" data-kind="trait" data-id="${id}" style="${isNegative ? 'border-color:#8b0000;' : ''}">${name}</span>`;
    }

    private buildTraitBadgeRow(ids: string[], sourceDict: any): string {
        if (!ids || ids.length === 0) return '';
        return ids.map(id => this.buildTraitBadge(id, sourceDict)).join('');
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
            .map(([k, v]) => `<div class="coll-stat"><span class="coll-stat-label">${statIconSvg(k)}${this.formatStatName(k)}</span><span class="coll-stat-value">${this.formatStatValue(k, v as number)}</span></div>`)
            .join('');

        card.innerHTML = `
            <div class="coll-card-header">
                <div class="coll-icon" style="border: 2px solid ${color};">${this.buildIconHtml(e, (name || '?').charAt(0).toUpperCase(), 52)}</div>
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
                    <div class="coll-section-label">🎒 Starting Gear</div>
                    <div class="coll-badge-row">
                        ${startingWeapons.map(w => `<span class="coll-badge">${w}</span>`).join('')}
                        ${startingItems.map(i => `<span class="coll-badge">${i}</span>`).join('')}
                    </div>
                </div>` : ''}
            ${startingSkills.length ? `
                <div>
                    <div class="coll-section-label">⚡ Skills</div>
                    <div class="coll-badge-row">${this.buildRefBadgeRow(startingSkills, skillsSource, 'skill')}</div>
                </div>` : ''}
            ${onDeathSkills.length ? `
                <div>
                    <div class="coll-section-label">☠ On Death</div>
                    <div class="coll-badge-row">${this.buildRefBadgeRow(onDeathSkills, skillsSource, 'skill')}</div>
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
        const traits: string[] = this.pick(w, 'traits') || [];
        const skillsSource = this.masterConfigs?.skills || this.masterConfigs?.Skills || {};
        const effectsSource = this.masterConfigs?.effects || this.masterConfigs?.Effects || {};
        const traitsSource = this.masterConfigs?.traits || this.masterConfigs?.Traits || {};
        const required: string[] = this.pick(w, 'requiredAchievements') || [];
        const { locked, missing } = this.isGearLocked(required);

        const dmgBadges = [
            melee > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Melee Dmg</span><span class="coll-stat-value">${this.formatNumber(melee)}</span></div>` : '',
            ranged > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Ranged Dmg</span><span class="coll-stat-value">${this.formatNumber(ranged)}</span></div>` : '',
            magic > 0 ? `<div class="coll-stat"><span class="coll-stat-label">Magic Dmg</span><span class="coll-stat-value">${this.formatNumber(magic)}</span></div>` : '',
        ].join('');

        const bonusBadges = Object.entries(statBonuses)
            .map(([k, v]) => this.buildStatBadge(this.formatStatName(k), v as number, false, '', k))
            .join('');

        card.innerHTML = `
            ${locked ? this.buildLockOverlay(missing) : ''}
            <div class="coll-card-header">
                <div class="coll-icon" style="border: 2px solid ${color};">${this.buildIconHtml(w, (name || '?').charAt(0).toUpperCase(), 52)}</div>
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
            ${bonusBadges ? `<div><div class="coll-section-label">📊 Bonus Stats</div><div class="coll-badge-row">${bonusBadges}</div></div>` : ''}
            ${traits.length ? `<div><div class="coll-section-label">🏷 Traits</div><div class="coll-badge-row">${this.buildTraitBadgeRow(traits, traitsSource)}</div></div>` : ''}
            ${grantedSkills.length ? `<div><div class="coll-section-label">⚡ Granted Skills</div><div class="coll-badge-row">${this.buildRefBadgeRow(grantedSkills, skillsSource, 'skill')}</div></div>` : ''}
            ${onHitEffects.length ? `<div><div class="coll-section-label">💥 On-Hit Effects</div><div class="coll-badge-row">${this.buildRefBadgeRow(onHitEffects, effectsSource, 'effect')}</div></div>` : ''}
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
        const traits: string[] = this.pick(it, 'traits') || [];
        const skillsSource = this.masterConfigs?.skills || this.masterConfigs?.Skills || {};
        const effectsSource = this.masterConfigs?.effects || this.masterConfigs?.Effects || {};
        const traitsSource = this.masterConfigs?.traits || this.masterConfigs?.Traits || {};
        const required: string[] = this.pick(it, 'requiredAchievements') || [];
        const { locked, missing } = this.isGearLocked(required);

        const bonusBadges = Object.entries(statBonuses)
            .map(([k, v]) => this.buildStatBadge(this.formatStatName(k), v as number, false, '', k))
            .join('');
        const multBadges = Object.entries(statMultipliers)
            .map(([k, v]) => this.buildStatBadge(this.formatStatName(k), v as number, true, '', k))
            .join('');
        const waveEndBadges = effectsAtWaveEnd.map(we => {
            const statName = this.pick(we, 'statName') || '';
            const amount = this.pick(we, 'amount') ?? 0;
            return this.buildStatBadge(this.formatStatName(statName), amount, false, "/wave", statName);
        }).join('');

        card.innerHTML = `
            ${locked ? this.buildLockOverlay(missing) : ''}
            <div class="coll-card-header">
                <div class="coll-icon" style="border: 2px solid ${color};">${this.buildIconHtml(it, (name || '?').charAt(0).toUpperCase(), 52)}</div>
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
            ${(bonusBadges || multBadges) ? `<div><div class="coll-section-label">📊 Bonus Stats</div><div class="coll-badge-row">${bonusBadges}${multBadges}</div></div>` : ''}
            ${traits.length ? `<div><div class="coll-section-label">🏷 Traits</div><div class="coll-badge-row">${this.buildTraitBadgeRow(traits, traitsSource)}</div></div>` : ''}
            ${grantedSkills.length ? `<div><div class="coll-section-label">⚡ Granted Skills</div><div class="coll-badge-row">${this.buildRefBadgeRow(grantedSkills, skillsSource, 'skill')}</div></div>` : ''}
            ${effectsOnPurchase.length ? `<div><div class="coll-section-label">🛒 On Purchase</div><div class="coll-badge-row">${this.buildRefBadgeRow(effectsOnPurchase, effectsSource, 'effect')}</div></div>` : ''}
            ${waveEndBadges ? `<div><div class="coll-section-label">🌊 Wave-End Bonus</div><div class="coll-badge-row">${waveEndBadges}</div></div>` : ''}
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
        const description = this.pick(c, 'description') || '';
        const hitRadius = this.pick(c, 'hitRadius') ?? 0;
        const baseStats = this.pick(c, 'baseStats') || {};
        const statMultipliers = this.pick(c, 'statMultipliers') || {};
        const traits: string[] = this.pick(c, 'traits') || [];
        const startingWeapons: string[] = this.pick(c, 'startingWeapons') || [];
        const startingItems: string[] = this.pick(c, 'startingItems') || [];
        const startingSkills: string[] = this.pick(c, 'startingSkills') || [];
        const onDeathSkills: string[] = this.pick(c, 'onDeathSkills') || [];
        const skillsSource = this.masterConfigs?.skills || this.masterConfigs?.Skills || {};
        const traitsSource = this.masterConfigs?.traits || this.masterConfigs?.Traits || {};
        const required: string[] = this.pick(c, 'requiredAchievements') || [];
        const { locked, missing } = this.isGearLocked(required);

        const statBadges = Object.entries(baseStats)
            .filter(([, v]) => (v as number) !== 0)
            .map(([k, v]) => `<div class="coll-stat"><span class="coll-stat-label">${statIconSvg(k)}${this.formatStatName(k)}</span><span class="coll-stat-value">${this.formatStatValue(k, v as number)}${this.buildStatDiffSuffix(k, v as number)}</span></div>`)
            .join('');
        const multBadges = Object.entries(statMultipliers)
            .filter(([, v]) => (v as number) !== 0)
            .map(([k, v]) => this.buildStatBadge(this.formatStatName(k), v as number, true, '', k))
            .join('');

        card.innerHTML = `
            ${locked ? this.buildLockOverlay(missing) : ''}
            <div class="coll-card-header">
                <div class="coll-icon" style="border: 2px solid ${color};">${this.buildIconHtml(c, (name || '?').charAt(0).toUpperCase(), 52)}</div>
                <div class="coll-title-block">
                    <div class="coll-name">${name}</div>
                    <div class="coll-subtitle">Hit Radius ${hitRadius}</div>
                    ${description ? `<div class="char-description">${description}</div>` : ''}
                </div>
            </div>
            <div class="coll-section-label">📈 Base Stats</div>
            <div class="coll-stat-grid">${statBadges}</div>
            ${multBadges ? `<div><div class="coll-section-label">✨ Stat Multipliers</div><div class="coll-badge-row">${multBadges}</div></div>` : ''}
            ${traits.length ? `<div><div class="coll-section-label">🏷 Traits</div><div class="coll-badge-row">${this.buildTraitBadgeRow(traits, traitsSource)}</div></div>` : ''}
            ${(startingWeapons.length || startingItems.length) ? `
                <div>
                    <div class="coll-section-label">🎒 Starting Gear</div>
                    <div class="coll-badge-row">
                        ${startingWeapons.map(w => `<span class="coll-badge">${w}</span>`).join('')}
                        ${startingItems.map(i => `<span class="coll-badge">${i}</span>`).join('')}
                    </div>
                </div>` : ''}
            ${startingSkills.length ? `
                <div>
                    <div class="coll-section-label">⚡ Skills</div>
                    <div class="coll-badge-row">${this.buildRefBadgeRow(startingSkills, skillsSource, 'skill')}</div>
                </div>` : ''}
            ${onDeathSkills.length ? `
                <div>
                    <div class="coll-section-label">☠ On Death</div>
                    <div class="coll-badge-row">${this.buildRefBadgeRow(onDeathSkills, skillsSource, 'skill')}</div>
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
            const difficulty: string = room.difficulty || room.Difficulty || '';
            const diffColor = getDifficultyColor(difficulty);
            const maxPlayers = room.maxPlayers || room.MaxPlayers || 4;
            const playerCount = room.playerCount ?? room.PlayerCount ?? 0;
            const mapName = (room.mapId || room.MapId || 'map_forest').replace('map_', '').replace(/_/g, ' ');

            const pips = Array.from({ length: maxPlayers }, (_, i) =>
                `<span class="player-pip ${i < playerCount ? 'filled' : ''}"></span>`
            ).join('');

            const card = document.createElement('div');
            card.className = 'room-card';
            card.innerHTML = `
                <div class="room-card-accent" style="background:${diffColor};"></div>
                <div class="room-card-main">
                    <div class="room-card-top">
                        <div class="card-title">${room.roomName}${room.hasPassword ? ' <span title="Password protected">🔒</span>' : ''}</div>
                        ${difficulty ? `<span class="coll-tag" style="background:${diffColor};">${difficulty}</span>` : ''}
                    </div>
                    <div class="card-meta">🗺 ${mapName} &nbsp;•&nbsp; 🌊 Wave ${room.wave}</div>
                    <div class="room-card-pips" title="${playerCount}/${maxPlayers} players">${pips}</div>
                </div>
                <button class="card-btn lobby-btn btn-green" style="width:auto; padding: 10px 28px; margin:0; min-height: 0; font-size: 14px;">JOIN</button>
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

    private renderCreateRoomOptions() {
        const diffContainer = document.getElementById('create-room-difficulty-cards')!;
        const mapContainer = document.getElementById('create-room-map-cards')!;

        const difficulties = this.masterConfigs?.difficulties || this.masterConfigs?.Difficulties || {};
        const maps = this.masterConfigs?.maps || this.masterConfigs?.Maps || {};
        const diffEntries: any[] = Object.values(difficulties);
        const mapEntries: any[] = Object.values(maps);

        // Default to the first available option (or a sane fallback) if nothing's picked yet,
        // or if a previously-picked id no longer exists in a freshly-loaded config set.
        if (!this.selectedCreateDifficulty || !diffEntries.some(d => this.pick(d, 'id') === this.selectedCreateDifficulty)) {
            this.selectedCreateDifficulty = diffEntries.length > 0 ? (this.pick(diffEntries[0], 'id') || 'normal') : 'normal';
        }
        if (!this.selectedCreateMapId || !mapEntries.some(m => this.pick(m, 'id') === this.selectedCreateMapId)) {
            this.selectedCreateMapId = mapEntries.length > 0 ? (this.pick(mapEntries[0], 'id') || 'map_forest') : 'map_forest';
        }

        diffContainer.innerHTML = diffEntries.length === 0
            ? `<div style="color:${LOBBY_ASSETS.colorMuted}; font-size:13px;">No difficulties configured.</div>` : '';
        diffEntries.forEach(d => {
            const id = this.pick(d, 'id') || '';
            const name = this.pick(d, 'name') || id;
            const color = getDifficultyColor(id);
            const goldMult = this.pick(d, 'goldMultiplier') ?? 1;
            const card = document.createElement('div');
            card.className = `picker-card ${id === this.selectedCreateDifficulty ? 'selected' : ''}`;
            card.style.setProperty('--pc-color', color);
            card.innerHTML = `
                <div class="picker-card-icon" style="color:${color};">⚔</div>
                <div class="picker-card-name">${name}</div>
                <div class="picker-card-sub">${this.formatNumber(goldMult)}x Gold</div>
            `;
            card.onclick = () => { this.selectedCreateDifficulty = id; this.renderCreateRoomOptions(); };
            diffContainer.appendChild(card);
        });

        mapContainer.innerHTML = mapEntries.length === 0
            ? `<div style="color:${LOBBY_ASSETS.colorMuted}; font-size:13px;">No maps configured.</div>` : '';
        mapEntries.forEach(m => {
            const id = this.pick(m, 'id') || '';
            const name = this.pick(m, 'name') || id.replace('map_', '');
            const textureKey = this.pick(m, 'textureKey');
            const spriteHtml = textureKey ? this.getIconHtml(textureKey, 0, 60) : null;
            const card = document.createElement('div');
            card.className = `picker-card ${id === this.selectedCreateMapId ? 'selected' : ''}`;
            card.innerHTML = `
                <div class="picker-card-icon">${spriteHtml || '🗺'}</div>
                <div class="picker-card-name">${name}</div>
            `;
            card.onclick = () => { this.selectedCreateMapId = id; this.renderCreateRoomOptions(); };
            mapContainer.appendChild(card);
        });
    }

    private injectCSS() {
        // Every quit-and-return-to-lobby cycle constructs a new LobbyUI, and this used to
        // add another identical <style> block to <head> each time with no cleanup - harmless
        // for a single session, but needless DOM/memory bloat over a long play session. The
        // CSS is static (doesn't depend on any per-instance state), so it's safe to just skip
        // re-injecting if it's already there.
        if (document.getElementById('lobby-ui-styles')) return;

        const style = document.createElement('style');
        style.id = 'lobby-ui-styles';
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

        /* Themed scrollbars everywhere in the lobby, instead of the bare OS scrollbar —
           applies to every scrollable descendant (char picker, achievements, collection,
           room browser, chat, modals) without needing to repeat this per section. */
        #lobby-ui-wrapper *::-webkit-scrollbar { width: 10px; height: 10px; }
        #lobby-ui-wrapper *::-webkit-scrollbar-track { background: rgba(0,0,0,0.35); border-radius: 6px; }
        #lobby-ui-wrapper *::-webkit-scrollbar-thumb {
            background: linear-gradient(180deg, #4a3b69 0%, #2a1f43 100%);
            border: 2px solid rgba(0,0,0,0.35);
            border-radius: 6px;
        }
        #lobby-ui-wrapper *::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(180deg, ${LOBBY_ASSETS.colorPrimary} 0%, #8a6a35 100%);
        }
        #lobby-ui-wrapper *::-webkit-scrollbar-corner { background: transparent; }
        #lobby-ui-wrapper * { scrollbar-width: thin; scrollbar-color: #4a3b69 rgba(0,0,0,0.35); }
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
        .lobby-btn-icon { width: 20px; height: 20px; flex-shrink: 0; opacity: 0.85; }
        .lobby-btn-icon svg { width: 100%; height: 100%; display: block; }
        .lobby-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .lobby-btn:hover:not(:disabled) { background: linear-gradient(180deg, #5c4a82 0%, #362954 100%); border-color: ${LOBBY_ASSETS.colorPrimaryHover}; transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.6), inset 0 0 15px rgba(229, 179, 92, 0.2); }
        .btn-green { background: linear-gradient(180deg, #2e7d32 0%, #1b5e20 100%); border-color: #4caf50; }
        .btn-green:hover:not(:disabled) { background: linear-gradient(180deg, #388e3c 0%, #2e7d32 100%); border-color: #81c784; }
        .danger { background: linear-gradient(180deg, #8b0000 0%, #4a0000 100%); border-color: #ff4444; }
        .danger:hover:not(:disabled) { background: linear-gradient(180deg, #a50000 0%, #660000 100%); }
        .room-card { position: relative; background: rgba(0,0,0,0.6); border: 2px solid #333; border-radius: 8px; padding: 18px 20px 18px 24px; display: flex; justify-content: space-between; align-items: center; transition: 0.2s; overflow: hidden; }
        .room-card:hover { border-color: ${LOBBY_ASSETS.colorPrimary}; background: rgba(0,0,0,0.8); transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,0,0,0.5); }
        .room-card-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; }
        .room-card-main { flex: 1; min-width: 0; }
        .room-card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
        .card-title { font-size: 19px; font-weight: bold; color: #fff; text-shadow: 1px 1px 2px #000; }
        .card-meta { font-size: 13px; color: ${LOBBY_ASSETS.colorMuted}; margin-bottom: 8px; text-transform: capitalize; }
        .room-card-pips { display: flex; gap: 5px; }
        .player-pip { width: 10px; height: 10px; border-radius: 50%; background: #333; border: 1px solid #444; }
        .player-pip.filled { background: ${LOBBY_ASSETS.colorPrimary}; border-color: ${LOBBY_ASSETS.colorPrimary}; box-shadow: 0 0 6px rgba(229, 179, 92, 0.6); }

        /* --- Create Room picker cards --- */
        .picker-card-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px; }
        .picker-card { --pc-color: ${LOBBY_ASSETS.colorPrimary}; position: relative; background: rgba(0,0,0,0.5); border: 2px solid #333; border-radius: 10px; padding: 16px; cursor: pointer; transition: 0.2s; text-align: center; }
        .picker-card:hover { border-color: var(--pc-color); transform: translateY(-2px); }
        .picker-card.selected { border-color: var(--pc-color); background: rgba(0,0,0,0.7); box-shadow: 0 0 16px var(--pc-color); }
        .picker-card-icon { width: 100%; height: 60px; display: flex; align-items: center; justify-content: center; font-size: 28px; margin-bottom: 10px; border-radius: 6px; background: rgba(255,255,255,0.04); overflow: hidden; }
        .picker-card-icon img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
        .picker-card-name { font-weight: bold; font-size: 14px; color: #fff; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
        .picker-card-sub { font-size: 11px; color: ${LOBBY_ASSETS.colorMuted}; }
        .picker-card.selected .picker-card-name { color: var(--pc-color); }
        .match-settings-bar { display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap; background: rgba(0,0,0,0.6); border: 2px solid #333; border-radius: 8px; padding: 12px 18px; margin-bottom: 16px; }
        .settings-bar-field { flex: 1; min-width: 130px; margin-bottom: 0; }
        .settings-bar-field .input-label { font-size: 11px; margin-bottom: 4px; }
        .settings-bar-field .lobby-input { padding: 8px 12px; font-size: 13px; }
        .waiting-layout { display: grid; grid-template-columns: 340px 1fr; grid-template-rows: 1fr; gap: 20px; height: calc(100% - 160px); overflow: hidden; width: 100%; }
        .waiting-col { background: rgba(0,0,0,0.6); border: 2px solid #333; border-radius: 8px; padding: 20px; display: flex; flex-direction: column; overflow: hidden; }
        .col-roster { grid-column: 1; grid-row: 1; }
        .col-right-stack { grid-column: 2; grid-row: 1; display: flex; flex-direction: column; gap: 20px; overflow: hidden; min-height: 0; }
        .col-chat { flex: 3 1 0; min-height: 0; }
        .col-chars { flex: 2 1 0; min-height: 0; }
        .roster-scroll { flex: 1; overflow-y: auto; padding-right: 6px; }
        @media (max-width: 1100px) {
            .waiting-layout { grid-template-columns: 280px 1fr; }
        }
        .char-grid { display: flex; flex-direction: row; overflow-x: auto; gap: 15px; padding-bottom: 10px; width: 100%; align-items: center; }
        .char-select-layout { display: flex; gap: 16px; flex: 1; overflow: hidden; }
        .char-picker-list { width: 240px; min-width: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 6px; }
        .char-picker-loading {
            color: ${LOBBY_ASSETS.colorMuted}; font-size: 13px; text-align: center;
            padding: 30px 10px; animation: pulseFade 1.4s ease-in-out infinite;
        }
        @keyframes pulseFade { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        .char-picker-item { position: relative; display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.5); border: 2px solid #333; border-radius: 8px; padding: 8px 10px; cursor: pointer; transition: 0.2s; }
        .char-picker-item:hover { border-color: #555; background: rgba(0,0,0,0.7); }
        .char-picker-item.selected { border-color: ${LOBBY_ASSETS.colorPrimary}; background: rgba(229, 179, 92, 0.1); box-shadow: inset 0 0 12px rgba(229, 179, 92, 0.15); }
        .char-picker-item.locked { opacity: 0.5; }
        .char-picker-icon { width: 34px; height: 34px; min-width: 34px; border-radius: 5px; background: #111; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: bold; color: ${LOBBY_ASSETS.colorPrimary}; overflow: hidden; }
        .char-picker-icon img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
        .char-picker-name { font-size: 13px; font-weight: bold; color: #fff; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .char-picker-lock { font-size: 13px; }
        .char-detail-panel { flex: 1; overflow-y: auto; padding-right: 6px; }
        .char-detail-panel .coll-card { min-height: 0; height: auto; }
        .char-detail-placeholder { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: ${LOBBY_ASSETS.colorMuted}; font-size: 14px; text-align: center; padding: 20px; }
        .char-detail-placeholder-icon { font-size: 40px; opacity: 0.4; }
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
        .lobby-chat-input-row { position: relative; display: flex; align-items: center; }
        .lobby-chat-input-row .lobby-chat-input { margin: 0; flex: 1; padding-left: 42px; }
        .lobby-btn.lobby-chat-send-btn { position: absolute; left: 6px; top: 50%; transform: translateY(-50%); width: 28px; height: 28px; padding: 0; margin: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; border-radius: 50%; z-index: 2; }
        #toast-container { position: fixed; top: 20px; right: 20px; z-index: 999999; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
        .toast { background: ${LOBBY_ASSETS.colorBtnBgTop}; border-left: 4px solid ${LOBBY_ASSETS.colorPrimary}; padding: 15px 20px; border-radius: 4px; color: white; font-weight: bold; box-shadow: 0 4px 15px rgba(0,0,0,0.8); animation: slideIn 0.3s ease-out forwards; min-width: 250px; }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-10px); } }
        #password-modal-overlay { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); z-index: 200001; display: flex; justify-content: center; align-items: center; }
        .modal-box { background: ${LOBBY_ASSETS.colorBtnBgTop}; border: 2px solid ${LOBBY_ASSETS.colorPrimary}; padding: 40px; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); width: 400px; text-align: center; }

        /* --- Info modal (skill/effect/trait detail popup) --- */
        #info-modal-overlay { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); z-index: 200002; display: flex; justify-content: center; align-items: center; }
        .info-modal-box { width: 420px; text-align: left; position: relative; padding: 30px; max-height: 80vh; overflow-y: auto; }
        .info-modal-close { position: absolute; top: 14px; right: 14px; background: rgba(0,0,0,0.5); border: 1px solid #444; color: #fff; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; font-size: 14px; line-height: 1; }
        .info-modal-close:hover { border-color: ${LOBBY_ASSETS.colorPrimary}; color: ${LOBBY_ASSETS.colorPrimary}; }
        .info-modal-header { display: flex; gap: 14px; align-items: center; margin-bottom: 16px; }
        .info-modal-icon { width: 56px; height: 56px; min-width: 56px; border-radius: 8px; display: flex; justify-content: center; align-items: center; font-size: 26px; font-weight: bold; color: #fff; background: #111; overflow: hidden; }
        .info-modal-icon img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
        .info-modal-title { font-size: 20px; font-weight: bold; color: #fff; }
        .info-modal-kind { font-size: 11px; color: ${LOBBY_ASSETS.colorPrimary}; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
        .info-modal-desc { font-size: 13px; color: #ccc; line-height: 1.5; margin-bottom: 16px; }
        .coll-badge.clickable { cursor: pointer; transition: 0.15s; }
        .coll-badge.clickable:hover { border-color: ${LOBBY_ASSETS.colorPrimary}; background: rgba(229, 179, 92, 0.12); color: #fff; }
        .coll-tag-negative { background: #8b0000; }

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
        .coll-card { position: relative; background: rgba(0,0,0,0.5); border: 2px solid #333; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 10px; transition: 0.2s; }
        .coll-card:not(.locked):hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
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
        .stat-diff-tag { font-weight: bold; font-size: 11px; }
        .char-description { color: ${LOBBY_ASSETS.colorMuted}; font-size: 12px; line-height: 1.4; margin-top: 6px; max-width: 320px; }
        .coll-section-label { font-size: 10px; color: ${LOBBY_ASSETS.colorMuted}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
        .coll-badge-row { display: flex; gap: 6px; flex-wrap: wrap; }
        .coll-badge { font-size: 11px; padding: 4px 9px; border-radius: 12px; background: rgba(255,255,255,0.06); border: 1px solid #333; color: #ddd; }
        .coll-empty { padding: 20px; color: ${LOBBY_ASSETS.colorMuted}; grid-column: 1 / -1; text-align: center; }
        .coll-card.locked { opacity: 0.55; filter: grayscale(0.6); }

        /* --- Scoreboard --- */
        .score-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; padding-bottom: 20px; align-content: start; }
        .score-panel { background: rgba(0,0,0,0.5); border: 2px solid #333; border-radius: 10px; display: flex; flex-direction: column; max-height: 480px; overflow: hidden; }
        .score-panel-header { padding: 16px 18px 12px; border-bottom: 1px solid #333; flex-shrink: 0; }
        .score-panel-title { font-size: 15px; font-weight: bold; color: #fff; display: flex; align-items: center; gap: 8px; }
        .score-panel-subtitle { font-size: 11px; color: ${LOBBY_ASSETS.colorMuted}; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.5px; }
        .score-list { flex: 1; overflow-y: auto; padding: 6px 10px; }
        .score-row { display: flex; align-items: center; gap: 12px; padding: 9px 8px; border-radius: 6px; }
        .score-row.is-me { background: rgba(229,179,92,0.12); border: 1px solid ${LOBBY_ASSETS.colorPrimary}; }
        .score-rank { width: 28px; min-width: 28px; text-align: center; font-weight: bold; font-size: 14px; color: ${LOBBY_ASSETS.colorMuted}; }
        .score-rank.rank-1 { color: #ffd700; font-size: 17px; }
        .score-rank.rank-2 { color: #c8c8d0; font-size: 16px; }
        .score-rank.rank-3 { color: #cd7f32; font-size: 15px; }
        .score-name { flex: 1; min-width: 0; font-size: 13px; font-weight: bold; color: #eee; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .score-row.is-me .score-name { color: ${LOBBY_ASSETS.colorPrimary}; }
        .score-value { font-size: 13px; font-weight: bold; color: ${LOBBY_ASSETS.colorPrimary}; white-space: nowrap; }
        .score-row.rank-1 .score-value { color: #ffd700; }
        .score-row.rank-2 .score-value { color: #c8c8d0; }
        .score-row.rank-3 .score-value { color: #cd7f32; }
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

            <div id="info-modal-overlay" class="hidden">
                <div class="modal-box info-modal-box">
                    <button id="btn-close-info-modal" class="info-modal-close">✕</button>
                    <div id="info-modal-content"></div>
                </div>
            </div>

            <div id="screen-menu" class="center-menu-panel">
                <div class="game-logo">
                    <img src="${LOBBY_ASSETS.gameLogo}" class="logo-img" alt="Mage Arena" />
                </div>
                <button id="btn-play" class="lobby-btn">${menuIcon('play')}NEW GAME</button>
                <button id="btn-achievements" class="lobby-btn">${menuIcon('trophy')}ACHIEVEMENTS</button>
                <button id="btn-collection" class="lobby-btn">${menuIcon('grid')}COLLECTION</button>
                <button id="btn-scoreboard" class="lobby-btn">${menuIcon('chart')}SCOREBOARD</button>
                <button id="btn-settings" class="lobby-btn">${menuIcon('gear')}OPTIONS</button>
                <button id="btn-fullscreen" class="lobby-btn">${menuIcon('expand')}TOGGLE FULLSCREEN</button>
                <button id="btn-admin-panel" class="lobby-btn hidden" style="background: linear-gradient(180deg, #3a2a4a 0%, #241730 100%); border-color: #9b6dff;">${menuIcon('shield')}ADMIN PANEL</button>
                <button id="btn-tos" class="lobby-btn danger">${menuIcon('logout')}LOGOUT</button>
            </div>

            <div id="screen-scoreboard" class="full-screen-panel hidden">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <h2 style="margin:0; border:none; padding:0;">Scoreboard</h2>
                    <button id="btn-back-from-scoreboard" class="lobby-btn danger" style="width: auto; padding: 10px 30px; margin:0;">Back</button>
                </div>
                <p style="color: ${LOBBY_ASSETS.colorMuted}; margin: 0 0 20px 0; font-size: 13px;">Top performers over the last 7 days.</p>
                <div id="scoreboard-grid" class="score-grid"></div>
            </div>

            <div id="screen-admin-panel" class="full-screen-panel hidden" style="padding: 0; position: relative;">
                <button id="btn-back-from-admin" class="lobby-btn danger" style="position: absolute; top: 16px; right: 16px; z-index: 10; width: auto; padding: 10px 24px; margin: 0;">Back to Menu</button>
                <div id="admin-mount-point" style="width: 100%; height: 100%;"></div>
            </div>

            <div id="screen-browser" class="full-screen-panel hidden">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <h2 style="margin:0; border:none; padding:0;">Server Browser</h2>
                    <button id="btn-back-menu" class="lobby-btn danger" style="width: auto; padding: 10px 30px; margin:0;">Back</button>
                </div>
                <p style="color: ${LOBBY_ASSETS.colorMuted}; margin: 0 0 20px 0; font-size: 13px;">Join an existing arena, or forge your own.</p>

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

            <div id="screen-create-room" class="full-screen-panel hidden">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <h2 style="margin:0; border:none; padding:0;">Forge Your Arena</h2>
                    <button id="btn-back-from-create-room" class="lobby-btn danger" style="width: auto; padding: 10px 30px; margin:0;">Back</button>
                </div>
                <p style="color: ${LOBBY_ASSETS.colorMuted}; margin: 0 0 20px 0; font-size: 13px;">Choose your battlefield and challenge level.</p>

                <div style="flex:1; overflow-y:auto; padding-right: 10px;">
                    <div style="display:flex; gap:15px; margin-bottom: 24px;">
                        <div class="input-group" style="flex:1;">
                            <span class="input-label">Room Name</span>
                            <input type="text" id="create-room-name" class="lobby-input" placeholder="My Arena" />
                        </div>
                        <div class="input-group" style="flex:1;">
                            <span class="input-label">Password (optional)</span>
                            <input type="password" id="create-room-password" class="lobby-input" placeholder="Leave blank for open room" />
                        </div>
                    </div>

                    <div class="coll-section-label" style="font-size:13px; margin-bottom:10px;">Difficulty</div>
                    <div id="create-room-difficulty-cards" class="picker-card-row"></div>

                    <div class="coll-section-label" style="font-size:13px; margin: 20px 0 10px;">Map</div>
                    <div id="create-room-map-cards" class="picker-card-row"></div>
                </div>

                <button id="btn-confirm-create-room" class="lobby-btn btn-green" style="margin-top: 20px; font-size: 20px; padding: 16px;">⚔ CREATE ROOM</button>
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
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                    <h2 style="margin:0; border:none; padding:0;">Lobby <span id="waiting-room-code" style="color: ${LOBBY_ASSETS.colorPrimary};"></span></h2>
                    
                    <div style="display: flex; gap: 15px;">
                        <button id="btn-toggle-ready" class="lobby-btn btn-green" style="margin: 0; width: 200px;">READY UP</button>
                        <button id="btn-start-match" class="lobby-btn hidden" style="margin: 0; width: 200px;" disabled>LAUNCH GAME</button>
                        <button id="btn-leave-match" class="lobby-btn danger" style="width: auto; padding: 10px 30px; margin:0;">Leave Match</button>
                    </div>
                </div>

                <div id="host-controls" class="match-settings-bar">
                    <div class="input-group settings-bar-field"><span class="input-label">Room Name</span><input type="text" id="lobby-edit-name" class="lobby-input" /></div>
                    <div class="input-group settings-bar-field"><span class="input-label">Password</span><input type="password" id="lobby-edit-pass" class="lobby-input" placeholder="Leave blank for open room" /></div>
                    <div class="input-group settings-bar-field">
                        <span class="input-label">Difficulty</span>
                        <select id="lobby-edit-diff" class="lobby-input">
                            <option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option>
                        </select>
                    </div>
                    <div class="input-group settings-bar-field">
                        <span class="input-label">Map</span>
                        <select id="lobby-edit-map" class="lobby-input">
                            <option value="map_forest">Forest</option>
                        </select>
                    </div>
                </div>
                <div id="client-view" class="match-settings-bar hidden">
                    <div class="input-group settings-bar-field"><span class="input-label">Room Name</span><div id="client-view-name" style="font-weight:bold; font-size:16px;"></div></div>
                    <div class="input-group settings-bar-field"><span class="input-label">Difficulty</span><div id="client-view-diff" style="font-weight:bold; font-size:16px;"></div></div>
                    <div class="input-group settings-bar-field"><span class="input-label">Map</span><div id="client-view-map" style="font-weight:bold; font-size:16px;"></div></div>
                    <p style="color: ${LOBBY_ASSETS.colorMuted}; font-style: italic; margin: 0; align-self: center;">Only Host can edit settings.</p>
                </div>

                <div class="waiting-layout">
                    <div class="waiting-col col-roster">
                        <h3>🛡 Players</h3>
                        <div id="waiting-roster" class="roster-scroll"></div>
                        <p id="waiting-host-msg" style="color: ${LOBBY_ASSETS.colorMuted}; text-align: center; font-size: 13px; margin-top: auto; padding-top: 12px;">Waiting for host...</p>
                    </div>

                    <div class="col-right-stack">
                        <div class="waiting-col col-chat">
                            <h3>💬 Chat</h3>
                            <div style="flex: 1; background: rgba(0,0,0,0.4); border-radius: 8px; padding: 15px; display: flex; flex-direction: column; overflow: hidden; border: 2px solid #333;">
                                <div id="lobby-chat-history" class="lobby-chat-box"></div>
                                <div class="lobby-chat-input-row">
                                    <button id="btn-send-chat" class="lobby-btn lobby-chat-send-btn">➤</button>
                                    <input type="text" id="lobby-chat-input" class="lobby-input lobby-chat-input" placeholder="Send a message..." />
                                </div>
                            </div>
                        </div>

                        <div class="waiting-col col-chars">
                            <h3 style="flex-shrink: 0;">Select Character</h3>
                            <div class="char-select-layout">
                                <div id="character-picker-list" class="char-picker-list">
                                    <div class="char-picker-loading">Loading characters…</div>
                                </div>
                                <div id="character-detail-panel" class="char-detail-panel"></div>
                            </div>
                        </div>
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

        document.getElementById('btn-scoreboard')!.onclick = () => {
            switchScreen('screen-menu', 'screen-scoreboard');
            this.loadScoreboard();
        };
        document.getElementById('btn-back-from-scoreboard')!.onclick = () => switchScreen('screen-scoreboard', 'screen-menu');

        document.getElementById('btn-admin-panel')!.onclick = () => {
            switchScreen('screen-menu', 'screen-admin-panel');
            if (this.adminDashboard) {
                this.adminDashboard.onShow();
            } else {
                this.adminDashboard = new AdminDashboard(
                    document.getElementById('admin-mount-point')!,
                    () => switchScreen('screen-admin-panel', 'screen-menu') // auth failure mid-session -> just bounce back to menu
                );
            }
        };
        document.getElementById('btn-back-from-admin')!.onclick = () => {
            switchScreen('screen-admin-panel', 'screen-menu');
            this.adminDashboard?.onHide();
        };

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
            switchScreen('screen-browser', 'screen-create-room');
            (document.getElementById('create-room-name') as HTMLInputElement).value = `${this.playerName}'s Arena`;
            (document.getElementById('create-room-password') as HTMLInputElement).value = '';

            if (!this.masterConfigs?.difficulties && !this.masterConfigs?.Difficulties) {
                this.connection.invoke("GetCollectionCatalog").then((payload: any) => {
                    this.masterConfigs = { ...(this.masterConfigs || {}), ...payload };
                    this.renderCreateRoomOptions();
                }).catch(err => console.error("Failed to load create-room options:", err));
            } else {
                this.renderCreateRoomOptions();
            }
        };

        document.getElementById('btn-back-from-create-room')!.onclick = () => switchScreen('screen-create-room', 'screen-browser');

        document.getElementById('btn-confirm-create-room')!.onclick = () => {
            const roomName = (document.getElementById('create-room-name') as HTMLInputElement).value.trim() || `${this.playerName}'s Arena`;
            const password = (document.getElementById('create-room-password') as HTMLInputElement).value;
            this.connection.invoke("CreateRoom", this.playerName, roomName, password, this.selectedCreateDifficulty, this.selectedCreateMapId);
            switchScreen('screen-create-room', 'screen-waiting');
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

        document.getElementById('btn-close-info-modal')!.onclick = () => {
            document.getElementById('info-modal-overlay')!.classList.add('hidden');
        };
        document.getElementById('info-modal-overlay')!.addEventListener('click', (e) => {
            if (e.target === document.getElementById('info-modal-overlay')) {
                document.getElementById('info-modal-overlay')!.classList.add('hidden');
            }
        });

        // Event delegation: any .coll-badge.clickable rendered inside the Collection grid
        // (skills/effects/traits) opens the info modal, regardless of which card built it.
        // Event delegation on the whole UI wrapper: any .coll-badge.clickable rendered
        // anywhere (Collection grid, room character detail panel, info modal itself for
        // drill-down) opens the info modal, regardless of which container built it.
        this.wrapper.addEventListener('click', (e) => {
            const badge = (e.target as HTMLElement).closest('.coll-badge.clickable') as HTMLElement | null;
            if (!badge) return;
            const kind = badge.dataset.kind as 'skill' | 'effect' | 'trait';
            const id = badge.dataset.id;
            if (kind && id) this.showInfoModal(kind, id);
        });

        const applySettings = () => {
            const rName = (document.getElementById('lobby-edit-name') as HTMLInputElement).value.trim();
            const rPass = (document.getElementById('lobby-edit-pass') as HTMLInputElement).value.trim();
            const rDiff = (document.getElementById('lobby-edit-diff') as HTMLSelectElement).value;
            const rMap = (document.getElementById('lobby-edit-map') as HTMLSelectElement).value;
            this.connection.invoke("UpdateRoomSettings", rName, rPass, rDiff, rMap);
        };

        // Dropdowns apply the instant a new option is picked. Text fields apply on blur (and on
        // Enter, which just blurs) rather than on every keystroke, so we're not spamming
        // UpdateRoomSettings while the host is still mid-type.
        document.getElementById('lobby-edit-diff')!.addEventListener('change', applySettings);
        document.getElementById('lobby-edit-map')!.addEventListener('change', applySettings);
        document.getElementById('lobby-edit-name')!.addEventListener('blur', applySettings);
        document.getElementById('lobby-edit-pass')!.addEventListener('blur', applySettings);
        document.getElementById('lobby-edit-name')!.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); });
        document.getElementById('lobby-edit-pass')!.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); });

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

        this.connection.off("LobbyError");
        this.connection.on("LobbyError", (msg: string) => {
            if (msg === "Incorrect password.") {
                this.showToast("Room Locked", "The host updated the room. A password is now required.", "error");
                document.getElementById('password-modal-overlay')!.classList.remove('hidden');
                document.getElementById('join-password-input')!.focus();
            } else {
                this.showToast("System Error", msg, "error");
            }
        });

        this.connection.off("ReceiveChatMessage");
        this.connection.on("ReceiveChatMessage", (sender: string, msg: string) => {
            const history = document.getElementById('lobby-chat-history')!;
            const div = document.createElement('div');
            div.className = 'lobby-chat-msg';
            div.innerHTML = `<strong style="color: ${LOBBY_ASSETS.colorPrimary};">${sender}:</strong> ${msg}`;
            history.appendChild(div);
            history.scrollTop = history.scrollHeight;
            this.playSound(this.audioMessage);
        });

        this.connection.off("ReceiveHandshake");
        this.connection.on("ReceiveHandshake", (payload: any) => {
            this.masterConfigs = payload;
            this.renderCharacterGrid();
        });

        // NOTE: achievements currently only unlock mid-match (server-side, via GameRoom →
        // MatchHub's connection), so this fires only if you later add lobby-side unlock
        // triggers. The character grid still updates correctly on lobby (re)join either way,
        // since InnerJoinRoom re-fetches UnlockedAchievementIds from the DB every time.
        this.connection.off("AchievementUnlocked");
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

        this.connection.off("LobbyListUpdated");
        this.connection.on("LobbyListUpdated", () => {
            if (!document.getElementById('screen-browser')!.classList.contains('hidden')) {
                this.refreshRooms();
            }
        });

        this.connection.off("RoomSettingsUpdated");
        this.connection.on("RoomSettingsUpdated", (data: any) => {
            document.getElementById('client-view-name')!.innerText = data.roomName + (data.hasPassword ? " 🔒" : "");
            document.getElementById('client-view-diff')!.innerText = data.difficulty.toUpperCase();
            document.getElementById('client-view-map')!.innerText = data.mapId.replace('map_', '').toUpperCase();

            (document.getElementById('lobby-edit-name') as HTMLInputElement).value = data.roomName;
            (document.getElementById('lobby-edit-diff') as HTMLSelectElement).value = data.difficulty;
            (document.getElementById('lobby-edit-map') as HTMLSelectElement).value = data.mapId;
        });

        this.connection.off("UpdateLobbyRoster");
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
                    const spriteHtml = this.getIconHtml(textureKey, frame, 40);

                    if (spriteHtml) {
                        iconHtml = `<div class="char-avatar" style="padding: 0;">${spriteHtml}</div>`;
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

                    // Server truth for "what I've actually got selected" — empty on a fresh
                    // join (nothing picked yet), or my confirmed pick on rejoin. Character
                    // clicks set this locally too for instant feedback; this just keeps it
                    // in sync with what the server actually has on record.
                    this.selectedDetailCharacterId = p.characterId || '';
                    this.renderCharacterGrid();
                }
            });

            const startBtn = document.getElementById('btn-start-match') as HTMLButtonElement;
            startBtn.disabled = !allReady;
        });
    }
}