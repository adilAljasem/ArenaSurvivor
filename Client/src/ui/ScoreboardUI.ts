import * as Phaser from 'phaser';

export class ScoreboardUI {
    private wrapper: HTMLDivElement;
    private scene: Phaser.Scene;

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
        `;
        document.head.appendChild(style);
    }

    public update(players: any[], masterConfigs: any, myConnectionId: string) {
        // Sort by damage dealt descending
        const sortedPlayers = [...players].sort((a, b) => b.totalDamageDealt - a.totalDamageDealt);
        let rowsHtml = '';

        sortedPlayers.forEach(p => {
            const isMe = p.connectionId === myConnectionId;
            const charCfg = masterConfigs.characters?.[p.configId] || masterConfigs.Characters?.[p.configId];

            let iconHtml = '<div style="font-size:16px; color:#aaa;">?</div>';
            if (charCfg) {
                const texKey = charCfg.textureKey || charCfg.TextureKey;
                const frame = charCfg.iconFrame ?? charCfg.IconFrame ?? 0;
                if (this.scene.textures.exists(texKey)) {
                    iconHtml = `<img src="${this.scene.textures.getBase64(texKey, frame)}" />`;
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

        this.wrapper.innerHTML = `
            <div class="sb-header">
                <div class="sb-col-player" style="color: #fff;">Player</div>
                <div class="sb-col" style="text-align: center;">Damage</div>
                <div class="sb-col" style="text-align: center;">Total Damage Taken</div>
                <div class="sb-col" style="text-align: center;">Heal / Shield</div>
                <div class="sb-col" style="text-align: center;">Kills / Deaths</div>
            </div>
            <div id="sb-body">${rowsHtml}</div>
        `;
    }

    public show() { this.wrapper.style.display = 'flex'; }
    public hide() { this.wrapper.style.display = 'none'; }
}