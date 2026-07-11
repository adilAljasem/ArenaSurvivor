import * as Phaser from 'phaser';

export class ScoreboardUI {
    private wrapper: HTMLDivElement;
    private scene: Phaser.Scene;
    private iconHtmlCache: Map<string, string> = new Map();

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.wrapper = document.createElement('div');
        this.wrapper.id = 'scoreboard-overlay';
        this.wrapper.style.display = 'none';
        this.injectCSS();
        // Fix: Append to the app container so it stays visible in Fullscreen
        const appContainer = document.getElementById('app') || document.body;
        appContainer.appendChild(this.wrapper);
    }

    private injectCSS() {
        const style = document.createElement('style');
        style.innerHTML = `
            #scoreboard-overlay {
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                width: 950px; max-width: 95vw;
                background: rgba(20, 20, 28, 0.85);
                backdrop-filter: blur(12px); 
                border: 2px solid #e5b35c; 
                box-shadow: 0 0 40px rgba(0,0,0,0.9), inset 0 0 20px rgba(229, 179, 92, 0.1);
                border-radius: 6px; color: #fff; font-family: 'Segoe UI', Tahoma, sans-serif;
                z-index: 1000000; display: flex; flex-direction: column; pointer-events: none;
            }
            .sb-header {
                background: linear-gradient(180deg, #4a3b69 0%, #2a1f43 100%); border-bottom: 2px solid #e5b35c;
                display: flex; padding: 12px 15px; font-size: 13px; font-weight: bold;
                text-transform: uppercase; letter-spacing: 1px; color: #ffcf77; text-shadow: 1px 1px 2px black;
            }
            .sb-row { display: flex; padding: 10px 15px; border-bottom: 1px solid rgba(255,255,255,0.05); align-items: center; transition: background 0.2s; }
            .sb-row:nth-child(even) { background: rgba(0,0,0,0.4); }
            .sb-row.is-me { background: rgba(229, 179, 92, 0.15); border-left: 4px solid #e5b35c; }
            
            /* Made the columns slightly wider to fit the new text */
            .sb-col { flex: 1.2; text-align: center; font-size: 16px; font-family: Consolas, monospace; text-shadow: 1px 1px 1px black; }
            .sb-col-player { flex: 2; text-align: left; display: flex; align-items: center; gap: 15px; font-weight: bold; font-size: 18px; font-family: 'Segoe UI', Tahoma, sans-serif; }
            
            .sb-avatar { width: 42px; height: 42px; background: #111; border: 1px solid #e5b35c; border-radius: 4px; overflow: hidden; display: flex; justify-content: center; align-items: center; box-shadow: 0 0 10px rgba(0,0,0,0.8); }
            .sb-avatar img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
            .txt-dmg { color: #ff5555; } .txt-taken { color: #ffaa00; } .txt-heal { color: #55ff55; }
            .txt-kd { color: #aaaaaa; font-weight: bold; } .txt-kd span { color: #ffffff; }

            .sb-gameover-footer {
                display: flex; flex-direction: column; align-items: center; gap: 6px;
                padding: 18px 15px 22px; border-top: 2px solid #e5b35c;
                background: linear-gradient(180deg, rgba(42,31,67,0.4) 0%, rgba(20,20,28,0.6) 100%);
            }
            .sb-gameover-title {
                font-size: 22px; font-weight: bold; letter-spacing: 3px; color: #ff5555;
                text-shadow: 0 0 12px rgba(255,85,85,0.6), 1px 1px 2px black;
            }
            .sb-gameover-wave {
                font-size: 15px; color: #ffcf77; font-family: Consolas, monospace; font-weight: bold;
                text-shadow: 1px 1px 1px black; margin-bottom: 4px;
            }
            .sb-exit-btn {
                pointer-events: auto; cursor: pointer;
                background: linear-gradient(180deg, #4a3b69 0%, #2a1f43 100%);
                border: 2px solid #e5b35c; border-radius: 6px; color: #fff;
                font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 16px; font-weight: bold;
                padding: 10px 28px; letter-spacing: 1px; transition: background 0.15s, border-color 0.15s;
            }
            .sb-exit-btn:hover { background: linear-gradient(180deg, #5c4a80 0%, #3a2c54 100%); border-color: #ffcf77; }
        `;
        document.head.appendChild(style);
    }

    // Icon HTML for the scoreboard rows, cached per (textureKey, frame) so the canvas draw +
    // toDataURL cost is only ever paid once per icon, no matter how many times update() runs.
    // (A CSS background-position crop was tried here instead, to skip the canvas work
    // entirely, but this project's asset pipeline serves texture images as blob: URLs that
    // get revoked after Phaser's initial load — so re-referencing img.src later 404s.
    // getBase64 works because it draws from the already-decoded bitmap, not the URL.)
    private getIconHtml(textureKey: string, frame: number, _size: number): string | null {
        const cacheKey = `${textureKey}::${frame}`;
        const cached = this.iconHtmlCache.get(cacheKey);
        if (cached !== undefined) return cached;

        const base64 = this.scene.textures.exists(textureKey) ? this.scene.textures.getBase64(textureKey, frame) : '';
        const html = base64 ? `<img src="${base64}" style="width:100%; height:100%; object-fit:contain; image-rendering:pixelated;" />` : null;

        if (html) this.iconHtmlCache.set(cacheKey, html);
        return html;
    }

    // Pre-computes and caches every known character's scoreboard icon in the background, so
    // the FIRST time someone opens the scoreboard mid-match it's already warm instead of
    // synchronously paying the canvas-draw + toDataURL cost right when TAB is pressed (that
    // one-time cost is what caused the freeze). Spread across idle callbacks in small chunks
    // so this never competes with an actual frame being rendered - call once, right after the
    // match handshake gives us the character list, well before anyone's likely to open it.
    public prewarmIcons(masterConfigs: any) {
        const characters = masterConfigs?.characters || masterConfigs?.Characters;
        if (!characters) return;

        const entries = Object.values(characters) as any[];
        let i = 0;

        const step = (deadline?: any) => {
            const hasTime = () => !deadline || typeof deadline.timeRemaining !== 'function' || deadline.timeRemaining() > 0;
            while (i < entries.length && hasTime()) {
                const cfg = entries[i++];
                const texKey = cfg?.textureKey || cfg?.TextureKey;
                const frame = cfg?.iconFrame ?? cfg?.IconFrame ?? 0;
                if (texKey) this.getIconHtml(texKey, frame, 42);
            }
            if (i < entries.length) scheduleNext();
        };

        const scheduleNext = () => {
            if ('requestIdleCallback' in window) {
                (window as any).requestIdleCallback(step);
            } else {
                setTimeout(() => step(), 16); // Safari fallback - one chunk per frame-ish
            }
        };

        scheduleNext();
    }

    // Shared row-building for both the live (TAB-hold) view and the match-over screen, so
    // there's one place that knows how to render a player row instead of two copies drifting.
    private buildRowsHtml(players: any[], masterConfigs: any, myConnectionId: string): string {
        const sortedPlayers = [...players].sort((a, b) => b.totalDamageDealt - a.totalDamageDealt);
        let rowsHtml = '';

        sortedPlayers.forEach(p => {
            const isMe = p.connectionId === myConnectionId;
            const charCfg = masterConfigs.characters?.[p.configId] || masterConfigs.Characters?.[p.configId];

            let iconHtml = '<div style="font-size:16px; color:#aaa;">?</div>';
            if (charCfg) {
                const texKey = charCfg.textureKey || charCfg.TextureKey;
                const frame = charCfg.iconFrame ?? charCfg.IconFrame ?? 0;
                const spriteHtml = this.getIconHtml(texKey, frame, 42);
                if (spriteHtml) {
                    iconHtml = spriteHtml;
                }
            }

            rowsHtml += `
                <div class="sb-row ${isMe ? 'is-me' : ''}">
                    <div class="sb-col-player"><div class="sb-avatar">${iconHtml}</div><span>${p.name}</span></div>
                    <div class="sb-col txt-dmg">${Math.round(p.totalDamageDealt).toLocaleString()}</div>
                    <div class="sb-col txt-taken">${Math.round(p.totalDamageTaken).toLocaleString()}</div>
                    
                    <!-- NEW FORMATTED HEAL AND SHIELD COLUMN -->
                    <div class="sb-col" style="font-family: Consolas, monospace;">
                        <span style="color: #55ff55; font-weight: bold; text-shadow: 1px 1px 1px black;">✚ ${Math.round(p.totalHealingDone).toLocaleString()}</span>
                        <span style="color: #888888; margin: 0 4px;">/</span>
                        <span style="color: #e8f0fe; font-weight: bold; text-shadow: 1px 1px 1px black;">🛡️ ${Math.round(p.totalShieldingDone).toLocaleString()}</span>
                    </div>
                    
                    <div class="sb-col txt-kd"><span>${p.kills}</span> / ${p.deaths}</div>
                </div>`;
        });

        return rowsHtml;
    }

    private headerHtml(): string {
        return `
            <div class="sb-header">
                <div class="sb-col-player" style="color: #fff;">Player</div>
                <div class="sb-col" style="text-align: center;">Damage</div>
                <div class="sb-col" style="text-align: center;">Total Damage Taken</div>
                <div class="sb-col" style="text-align: center;">Heal / Shield</div>
                <div class="sb-col" style="text-align: center;">Kills / Deaths</div>
            </div>
        `;
    }

    public update(players: any[], masterConfigs: any, myConnectionId: string) {
        if (this.isMatchOverMode) return; // match-over screen stays put until Exit is clicked

        const rowsHtml = this.buildRowsHtml(players, masterConfigs, myConnectionId);
        this.wrapper.innerHTML = `${this.headerHtml()}<div id="sb-body">${rowsHtml}</div>`;
    }

    // Match-over version: same table, plus a footer with the wave reached and an Exit button.
    // Stays visible (hide() becomes a no-op) until the person actually clicks Exit, so
    // releasing TAB or anything else that would normally hide the live scoreboard can't
    // dismiss the match-over screen out from under them.
    private isMatchOverMode: boolean = false;

    public showMatchOver(players: any[], masterConfigs: any, myConnectionId: string, reachedWave: number, onExit: () => void) {
        this.isMatchOverMode = true;

        const rowsHtml = this.buildRowsHtml(players, masterConfigs, myConnectionId);
        this.wrapper.innerHTML = `
            ${this.headerHtml()}
            <div id="sb-body">${rowsHtml}</div>
            <div class="sb-gameover-footer">
                <div class="sb-gameover-title">MATCH OVER</div>
                <div class="sb-gameover-wave">Reached Wave ${reachedWave}</div>
                <button id="sb-exit-btn" class="sb-exit-btn">Exit to Main Menu</button>
            </div>
        `;

        document.getElementById('sb-exit-btn')!.addEventListener('click', () => onExit());

        this.show();
    }

    public show() { this.wrapper.style.display = 'flex'; }
    public hide() {
        if (this.isMatchOverMode) return;
        this.wrapper.style.display = 'none';
    }

    // Called when returning to the lobby after a match ends, so the live TAB-hold scoreboard
    // (update()/hide()) works again for the next match instead of staying permanently stuck
    // in match-over mode from the previous one.
    public resetMatchOverState() {
        this.isMatchOverMode = false;
        this.wrapper.style.display = 'none';
    }
}