import * as Phaser from 'phaser';
import { HubConnection } from '@microsoft/signalr';

// =========================================================================
// TYPES
// =========================================================================
interface CombinePreview {
    tier: number;
    stats: Record<string, number>;
    skills: string[];
}

interface StatLines {
    posStr: string;
    negStr: string;
    randomStr: string;
    skillsStr: string;
}

// =========================================================================
// SHARED UI HELPERS & TYPOGRAPHY
// =========================================================================
export const UIHelpers = {
    FONT: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",

    getTierColorStr: (tier: number): string => {
        if (tier <= 2) return '#c0c0c0';
        if (tier <= 4) return '#00aaff';
        if (tier <= 6) return '#aa00ff';
        return '#ffd700';
    },

    getTierColorHex: (tier: number): number => {
        if (tier <= 2) return 0xc0c0c0;
        if (tier <= 4) return 0x00aaff;
        if (tier <= 6) return 0xaa00ff;
        return 0xffd700;
    },

    getStatInfo: (key: string): { e: string, n: string } => {
        if (!key) return { e: "❓", n: "Unknown" };
        const map: Record<string, { e: string, n: string }> = {
            maxHp:              { e: "❤️",  n: "Max HP" },
            hpRegen:            { e: "🩹",  n: "HP Regen" },
            lifeSteal:          { e: "🧛",  n: "Life Steal" },
            speed:              { e: "💨",  n: "Speed" },
            haste:              { e: "⏳",  n: "Haste" },
            meleeDamage:        { e: "🗡️",  n: "Melee Dmg" },
            rangedDamage:       { e: "🏹",  n: "Ranged Dmg" },
            elementalDamage:    { e: "🔥",  n: "Elem Dmg" },
            engineering:        { e: "🔧",  n: "Engineering" },
            armor:              { e: "🛡️",  n: "Armor" },
            luck:               { e: "🍀",  n: "Luck" },
            harvesting:         { e: "🌾",  n: "Harvesting" },
            dodge:              { e: "👻",  n: "Dodge" },
            critChance:         { e: "💥",  n: "Crit Chance" },
            critMultiplier:     { e: "✖️",  n: "Crit Mult" },
            knockback:          { e: "💢",  n: "Knockback" },
            pierceCount:        { e: "🏹",  n: "Pierces" },
            bounceCount:        { e: "🪃",  n: "Bounces" },
            attackSpeedPercent: { e: "⚡",  n: "Attack Speed" },
            xpGainPercent:      { e: "🧠",  n: "XP Gain" },
            damagePercent:      { e: "💥",  n: "Damage %" },
            projectileSpeedPercent: { e: "☄️", n: "Proj Speed" },
            range:              { e: "📏",  n: "Range" },
        };
        return map[key] || { e: "❓", n: key.charAt(0).toUpperCase() + key.slice(1) };
    },

    formatVal: (key: string, val: number): string => {
        if (!key) return `${val}`;
        const isPct = key.toLowerCase().includes('percent') || key === 'lifeSteal' || key === 'dodge' || key === 'critChance';
        return isPct ? `${Math.round(val * 100)}%` : `${val}`;
    },

    /**
     * Builds formatted stat-line strings from a config object + optional rolled data.
     * Used by both the Tooltip and the shop-card renderer to keep them in sync.
     */
    buildStatLines: (
        config: any,
        rolledStats: any = null,
        rolledSkills: string[] | null = null,
        atlasConfigs: any = null,
        stackCount: number = 1
    ): StatLines => {
        let posStr = '';
        let negStr = '';
        let randomStr = '';
        let skillsStr = '';

        if (!config) return { posStr, negStr, randomStr, skillsStr };

        try {
            const meleeDmg       = config.meleeDamage      ?? config.MeleeDamage;
            const rangedDmg      = config.rangedDamage      ?? config.RangedDamage;
            const elemDmg        = config.elementalDamage   ?? config.ElementalDamage;
            const cooldown       = config.cooldownSeconds   ?? config.CooldownSeconds;
            const range          = config.range             ?? config.Range;
            const scaling        = config.damageScaling     ?? config.DamageScaling;
            const onHitEffects   = config.applyEffectsOnHit ?? config.ApplyEffectsOnHit;
            const grantedSkills  = config.grantedSkills     ?? config.GrantedSkills;
            const statBonuses    = config.statBonuses       ?? config.StatBonuses;
            const dynamicMods    = config.dynamicModifiers  ?? config.DynamicModifiers;
            const waveEndEffects = config.effectsAtWaveEnd  ?? config.EffectsAtWaveEnd;
            const onPurchase     = config.effectsOnPurchase ?? config.EffectsOnPurchase;
            const traits         = config.traits            ?? config.Traits;
            const mechanics      = config.mechanics         ?? config.Mechanics;

            // Base weapon/item combat stats
            if (meleeDmg)  posStr += `🗡️ Melee Dmg: ${meleeDmg * stackCount}\n`;
            if (rangedDmg) posStr += `🏹 Ranged Dmg: ${rangedDmg * stackCount}\n`;
            if (elemDmg)   posStr += `🔥 Elem Dmg: ${elemDmg * stackCount}\n`;
            if (cooldown)  posStr += `⏱️ Cooldown: ${cooldown}s\n`;
            if (range)     posStr += `📏 Range: ${range}\n`;

            if (scaling) {
                const parts = Object.entries(scaling).map(([k, v]) =>
                    `${Math.round((v as number) * 100)}% ${UIHelpers.getStatInfo(k).n}`
                );
                if (parts.length) posStr += `📈 Scales: ${parts.join(', ')}\n`;
            }

            if (onHitEffects?.length) {
                onHitEffects.forEach((e: string) => { posStr += `�� On Hit: ${e}\n`; });
            }

            // Mechanics
            if (mechanics) {
                Object.entries(mechanics).forEach(([k, v]) => {
                    const info = UIHelpers.getStatInfo(k);
                    posStr += `${info.e} ${info.n}: ${UIHelpers.formatVal(k, (v as number) * stackCount)}\n`;
                });
            }

            // Static stat bonuses
            if (statBonuses) {
                Object.entries(statBonuses).forEach(([k, v]) => {
                    const num = (v as number) * stackCount;
                    const info = UIHelpers.getStatInfo(k);
                    if (num > 0)      posStr += `${info.e} ${info.n}: +${UIHelpers.formatVal(k, num)}\n`;
                    else if (num < 0) negStr  += `${info.e} ${info.n}: ${UIHelpers.formatVal(k, num)}\n`;
                });
            }

            // Dynamic modifiers (conditional stats)
            if (dynamicMods) {
                dynamicMods.forEach((m: any) => {
                    const stat   = m.targetStat        ?? m.TargetStat        ?? "";
                    const amt    = (m.amount           ?? m.Amount)           * stackCount;
                    const thresh = m.conditionThreshold ?? m.ConditionThreshold;
                    const info   = UIHelpers.getStatInfo(stat);
                    const prefix = amt > 0 ? '+' : '';
                    posStr += `⚡ ${info.n}: ${prefix}${UIHelpers.formatVal(stat, amt)} per ${Math.round(thresh * 100)}% missing HP\n`;
                });
            }

            // Wave-end effects
            if (waveEndEffects?.length) {
                waveEndEffects.forEach((e: any) => {
                    const stat   = e.statName ?? e.StatName ?? "";
                    const amt    = (e.amount  ?? e.Amount)  * stackCount;
                    const info   = UIHelpers.getStatInfo(stat);
                    const prefix = amt > 0 ? '+' : '';
                    const line   = `🌊 Wave End: ${info.n} ${prefix}${UIHelpers.formatVal(stat, amt)}\n`;
                    if (amt < 0) negStr += line; else posStr += line;
                });
            }

            // On-purchase effects
            if (onPurchase?.length) {
                onPurchase.forEach((e: string) => { posStr += `🔹 Grants: ${e}\n`; });
            }

            // Granted (permanent) skills from config
            if (grantedSkills?.length) {
                const skillMap = atlasConfigs?.skills ?? atlasConfigs?.Skills;
                grantedSkills.forEach((id: string) => {
                    const s = skillMap?.[id];
                    skillsStr += `⭐ ${s ? (s.name ?? s.Name) : id}\n`;
                });
            }

            // Traits
            if (traits) {
                traits.forEach((t: string) => {
                    if (t === "CannotHeal") negStr += `⚠️ Cannot Heal\n`;
                    else posStr += `🔹 ${t}\n`;
                });
            }

            // Randomly rolled bonus stats
            if (rolledStats && Object.keys(rolledStats).length) {
                Object.entries(rolledStats).forEach(([k, v]) => {
                    const num  = v as number;
                    const info = UIHelpers.getStatInfo(k);
                    if (num > 0)      randomStr += `${info.e} ${info.n}: +${UIHelpers.formatVal(k, num)}\n`;
                    else if (num < 0) negStr     += `${info.e} ${info.n}: ${UIHelpers.formatVal(k, num)}\n`;
                });
            }

            // Randomly rolled skills
            if (rolledSkills?.length) {
                const skillMap = atlasConfigs?.skills ?? atlasConfigs?.Skills;
                rolledSkills.forEach((id: string) => {
                    const s = skillMap?.[id];
                    skillsStr += `✨ ${s ? (s.name ?? s.Name) : id}\n`;
                });
            }

        } catch (e) {
            console.error("UIHelpers.buildStatLines error:", e);
        }

        return { posStr, negStr, randomStr, skillsStr };
    },
};

// =========================================================================
// TOOLTIP
// =========================================================================
export class Tooltip extends Phaser.GameObjects.Container {
    private bg: Phaser.GameObjects.Graphics;
    private titleText: Phaser.GameObjects.Text;
    private descText: Phaser.GameObjects.Text;
    private bonusText: Phaser.GameObjects.Text;
    private negativeText: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene) {
        super(scene, 0, 0);
        this.setDepth(5000);
        this.setVisible(false);
        this.setScrollFactor(0);

        this.bg = scene.add.graphics();

        this.titleText = scene.add.text(12, 12, '', {
            fontFamily: UIHelpers.FONT, fontSize: '18px', fontStyle: 'bold', resolution: 3
        });
        this.descText = scene.add.text(12, 38, '', {
            fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#dddddd',
            wordWrap: { width: 240 }, lineSpacing: 3, resolution: 3
        });
        this.bonusText = scene.add.text(12, 38, '', {
            fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#ffd700',
            wordWrap: { width: 240 }, lineSpacing: 3, resolution: 3
        });
        this.negativeText = scene.add.text(12, 38, '', {
            fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#ff4444',
            wordWrap: { width: 240 }, lineSpacing: 3, resolution: 3
        });

        this.add([this.bg, this.titleText, this.descText, this.bonusText, this.negativeText]);
        scene.add.existing(this);
    }

    public show(
        config: any,
        x: number,
        y: number,
        stackCount: number = 1,
        atlasConfigs?: any,
        rolledStats?: any,
        rolledSkills?: string[],
        combinePreview?: CombinePreview
    ) {
        if (!config) return;

        try {
            const tier = config.tier ?? config.Tier ?? 1;
            this.titleText.setText(config.name ?? config.Name ?? '').setColor(UIHelpers.getTierColorStr(tier));

            const { posStr, negStr, randomStr, skillsStr } =
                UIHelpers.buildStatLines(config, rolledStats, rolledSkills, atlasConfigs, stackCount);

            // Base stats section
            let descContent = `[ Tier ${tier} ]\n`;
            if (posStr) descContent += posStr;
            this.descText.setText(descContent.trim());

            // Bonus section: random rolls + skills + combine preview
            let bonusContent = '';
            if (randomStr) bonusContent += `[ 🎲 Random Rolls ]\n${randomStr}`;
            if (skillsStr) bonusContent += `\n[ 🌟 Skills ]\n${skillsStr}`;
            if (combinePreview) {
                bonusContent += `\n[ ⚗️ Combine → Tier ${combinePreview.tier} ]\n`;
                const skillMap = atlasConfigs?.skills ?? atlasConfigs?.Skills;
                Object.entries(combinePreview.stats).forEach(([k, v]) => {
                    const num  = v as number;
                    const info = UIHelpers.getStatInfo(k);
                    bonusContent += `${info.e} ${info.n}: ${num > 0 ? '+' : ''}${UIHelpers.formatVal(k, num)}\n`;
                });
                if (combinePreview.skills.length) {
                    combinePreview.skills.forEach((id: string) => {
                        const s = skillMap?.[id];
                        bonusContent += `⭐ ${s ? (s.name ?? s.Name) : id}\n`;
                    });
                }
            }
            this.bonusText.setText(bonusContent.trim());
            this.negativeText.setText(negStr.trim());

            // Layout: stack text objects vertically
            const descBottom = this.descText.y + this.descText.displayHeight;
            const bonusY = descBottom + (posStr.trim() && bonusContent.trim() ? 6 : 0);
            this.bonusText.setY(bonusY);
            const bonusBottom = bonusY + (bonusContent.trim() ? this.bonusText.displayHeight + 6 : 0);
            this.negativeText.setY(bonusBottom);

            const totalHeight =
                bonusBottom +
                (negStr.trim() ? this.negativeText.displayHeight + 6 : 0);
            const bgHeight = Math.max(80, 45 + totalHeight + 10);

            this.bg.clear();
            this.bg.fillStyle(0x111317, 0.95);
            this.bg.fillRoundedRect(0, 0, 260, bgHeight, 8);
            this.bg.lineStyle(2, UIHelpers.getTierColorHex(tier), 1);
            this.bg.strokeRoundedRect(0, 0, 260, bgHeight, 8);

            let targetX = x + 15;
            let targetY = y + 15;
            if (targetX + 260 > this.scene.scale.width)  targetX = x - 265;
            if (targetY + bgHeight > this.scene.scale.height) targetY = y - bgHeight - 5;

            this.setPosition(targetX, targetY);
            this.setVisible(true);
        } catch (err) {
            console.error("Safely caught a Tooltip formatting error:", err);
        }
    }

    public hide() { this.setVisible(false); }
}

// =========================================================================
// STAT DISPLAY
// =========================================================================
export class StatDisplay extends Phaser.GameObjects.Container {
    private statTexts: Map<string, Phaser.GameObjects.Text> = new Map();
    private levelText: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y);

        const bg = scene.add.graphics();
        bg.fillStyle(0x161920, 0.95);
        bg.fillRoundedRect(0, 0, 240, 560, 12);
        bg.lineStyle(2, 0x3a4454, 1);
        bg.strokeRoundedRect(0, 0, 240, 560, 12);

        const title = scene.add.text(120, 15, 'Character Stats', {
            fontFamily: UIHelpers.FONT, fontSize: '22px', color: '#ffffff', fontStyle: 'bold', resolution: 3
        }).setOrigin(0.5, 0);
        this.levelText = scene.add.text(120, 45, 'Level: 1', {
            fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#ffb300', fontStyle: 'bold', resolution: 3
        }).setOrigin(0.5, 0);

        this.add([bg, title, this.levelText]);
        scene.add.existing(this);
    }

    public updateStats(statsPayload: any, level: number = 1) {
        if (!statsPayload) return;

        this.levelText.setText(`Level: ${level}`);

        if (this.statTexts.size === 0) {
            let index = 0;
            Object.keys(statsPayload).forEach(key => {
                const info = UIHelpers.getStatInfo(key);
                const labelText = this.scene.add.text(15, 85 + (index * 24), `${info.e} ${info.n}`, {
                    fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#aaaaaa', resolution: 3
                });
                const valueText = this.scene.add.text(220, 85 + (index * 24), '0', {
                    fontFamily: UIHelpers.FONT, fontSize: '14px', color: '#ffffff', fontStyle: 'bold', resolution: 3
                }).setOrigin(1, 0);
                this.add([labelText, valueText]);
                this.statTexts.set(key, valueText);
                index++;
            });
        }

        Object.entries(statsPayload).forEach(([key, val]) => {
            const textObj = this.statTexts.get(key);
            if (textObj) {
                const numVal = val as number;
                textObj.setText(UIHelpers.formatVal(key, numVal));
                if (numVal > 0)      textObj.setColor('#00ff00');
                else if (numVal < 0) textObj.setColor('#ff4444');
                else                 textObj.setColor('#ffffff');
            }
        });
    }
}

// =========================================================================
// INVENTORY DISPLAY
// =========================================================================
export class InventoryDisplay extends Phaser.GameObjects.Container {
    private itemGrid: Phaser.GameObjects.Container;
    private weaponGrid: Phaser.GameObjects.Container;
    private tooltip: Tooltip;
    private atlasConfigs: any = null;

    constructor(scene: Phaser.Scene, x: number, y: number, tooltip: Tooltip) {
        super(scene, x, y);
        this.tooltip = tooltip;

        this.itemGrid = scene.add.container(0, 0);
        const itemTitle = scene.add.text(0, -25, 'Items', {
            fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#a0abbc', fontStyle: 'bold', resolution: 3
        });
        this.itemGrid.add(itemTitle);

        this.weaponGrid = scene.add.container(320, 0);
        const weaponTitle = scene.add.text(0, -25, 'Weapons', {
            fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#a0abbc', fontStyle: 'bold', resolution: 3
        });
        this.weaponGrid.add(weaponTitle);

        this.add([this.itemGrid, this.weaponGrid]);
        scene.add.existing(this);
    }

    public updateLayout(availableWidth: number) {
        this.weaponGrid.setPosition(availableWidth - 180, -80);
    }

    public updateInventory(weapons: any[], items: any[], atlasConfigs: any) {
        this.atlasConfigs = atlasConfigs;
        this.itemGrid.list.filter(child => child.type !== 'Text').forEach(c => (c as any).destroy());
        this.weaponGrid.list.filter(child => child.type !== 'Text').forEach(c => (c as any).destroy());

        // ---- Item slots ----
        for (let i = 0; i < 5; i++) {
            const slotX = i * 75;
            const slotBg = this.scene.add.graphics();
            slotBg.fillStyle(0x161920, 1);
            slotBg.fillRoundedRect(slotX, 0, 65, 65, 8);
            slotBg.lineStyle(2, 0x3a4454, 1);
            slotBg.strokeRoundedRect(slotX, 0, 65, 65, 8);
            this.itemGrid.add(slotBg);

            if (items?.[i]) {
                const itemData = items[i];
                const config = atlasConfigs?.items?.[itemData.configId] ?? null;
                const stackCount = itemData.count || 1;

                if (config) {
                    slotBg.lineStyle(2, UIHelpers.getTierColorHex(config.tier || 1), 1);
                    slotBg.strokeRoundedRect(slotX, 0, 65, 65, 8);
                }

                let icon: any;
                const tex = config?.textureKey ?? config?.TextureKey;
                if (tex && this.scene.textures.exists(tex)) {
                    icon = this.scene.add.sprite(slotX + 32.5, 32.5, tex);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min(50 / icon.width, 50 / icon.height));
                } else {
                    icon = this.scene.add.rectangle(slotX + 32.5, 32.5, 40, 40, 0x000000).setStrokeStyle(2, 0x00ff00);
                }
                this.itemGrid.add(icon);

                const hitbox = this.scene.add.rectangle(slotX + 32.5, 32.5, 65, 65, 0x000000, 0)
                    .setInteractive({ useHandCursor: true });
                if (config) {
                    const rolledStats  = itemData.rolledStats  ?? itemData.RolledStats;
                    const rolledSkills = itemData.rolledSkills ?? itemData.RolledSkills;
                    hitbox.on('pointerover', (p: Phaser.Input.Pointer) =>
                        this.tooltip.show(config, p.x, p.y, stackCount, this.atlasConfigs, rolledStats, rolledSkills));
                    hitbox.on('pointermove', (p: Phaser.Input.Pointer) =>
                        this.tooltip.setPosition(p.x + 15, p.y + 15));
                    hitbox.on('pointerout', () => this.tooltip.hide());
                }
                this.itemGrid.add(hitbox);

                if (stackCount > 1) {
                    const countTxt = this.scene.add.text(slotX + 60, 60, `x${stackCount}`, {
                        fontFamily: UIHelpers.FONT, fontSize: '14px', color: '#fff',
                        stroke: '#000', strokeThickness: 3, resolution: 3
                    }).setOrigin(1, 1);
                    this.itemGrid.add(countTxt);
                }
            }
        }

        // ---- Weapon slots ----
        for (let i = 0; i < 4; i++) {
            const col  = i % 2;
            const row  = Math.floor(i / 2);
            const slotX = col * 75;
            const slotY = row * 75;

            const slotBg = this.scene.add.graphics();
            slotBg.fillStyle(0x161920, 1);
            slotBg.fillRoundedRect(slotX, slotY, 65, 65, 8);
            slotBg.lineStyle(2, 0x3a4454, 1);
            slotBg.strokeRoundedRect(slotX, slotY, 65, 65, 8);
            this.weaponGrid.add(slotBg);

            if (weapons?.[i]) {
                const weaponData = weapons[i];
                const config     = atlasConfigs?.weapons?.[weaponData.configId] ?? null;
                const wLevel     = weaponData.level || 1;

                if (config) {
                    slotBg.lineStyle(2, UIHelpers.getTierColorHex(wLevel), 1);
                    slotBg.strokeRoundedRect(slotX, slotY, 65, 65, 8);
                }

                let icon: any;
                const tex = config?.textureKey ?? config?.TextureKey;
                if (tex && this.scene.textures.exists(tex)) {
                    icon = this.scene.add.sprite(slotX + 32.5, slotY + 32.5, tex);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min(50 / icon.width, 50 / icon.height));
                } else {
                    icon = this.scene.add.rectangle(slotX + 32.5, slotY + 32.5, 40, 40, 0x000000).setStrokeStyle(2, 0x00ff00);
                }
                this.weaponGrid.add(icon);

                const hitbox = this.scene.add.rectangle(slotX + 32.5, slotY + 32.5, 65, 65, 0x000000, 0)
                    .setInteractive({ useHandCursor: true });
                if (config) {
                    const toolTipConfig = { ...config, tier: wLevel };
                    const rolledStats   = weaponData.rolledStats   ?? weaponData.RolledStats;
                    const weaponSkills  = weaponData.weaponSkills   ?? weaponData.WeaponSkills;
                    hitbox.on('pointerover', (p: Phaser.Input.Pointer) =>
                        this.tooltip.show(toolTipConfig, p.x, p.y, 1, this.atlasConfigs, rolledStats, weaponSkills));
                    hitbox.on('pointermove', (p: Phaser.Input.Pointer) =>
                        this.tooltip.setPosition(p.x + 15, p.y + 15));
                    hitbox.on('pointerout', () => this.tooltip.hide());
                }
                this.weaponGrid.add(hitbox);

                const lvlTxt = this.scene.add.text(slotX + 60, slotY + 60, `Lv.${wLevel}`, {
                    fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#ffffff',
                    stroke: '#000', strokeThickness: 3, resolution: 3
                }).setOrigin(1, 1);
                this.weaponGrid.add(lvlTxt);
            }
        }
    }
}

// =========================================================================
// MAIN SHOP UI
// =========================================================================
// NOTE: ShopUI is a plain manager class (NOT a Container) to avoid Phaser 3's
// known issue where Container children's input hit-areas ignore the parent
// Container's scrollFactor when the game camera is scrolled.  Every inner
// container is added directly to the scene and has setScrollFactor(0) set
// explicitly, matching the pattern used by EscMenu.
export class ShopUI {
    private scene: Phaser.Scene;
    private statDisplay: StatDisplay;
    private inventoryDisplay: InventoryDisplay;
    private shopCardsContainer: Phaser.GameObjects.Container;
    private levelUpContainer: Phaser.GameObjects.Container;
    private headerText: Phaser.GameObjects.Text;
    private rerollButtonContainer: Phaser.GameObjects.Container;
    private rerollText: Phaser.GameObjects.Text;
    private connection: HubConnection;
    private tooltip: Tooltip;
    private overlay: Phaser.GameObjects.Rectangle;

    // All top-level scene objects owned by this UI (for setVisible / setDepth)
    private _elements: (Phaser.GameObjects.GameObject & { setVisible(v: boolean): any; setDepth(d: number): any })[] = [];
    private _visible: boolean = false;
    private _depth: number = 1000;

    constructor(scene: Phaser.Scene, connection: HubConnection) {
        this.scene = scene;
        this.connection = connection;
        const D = this._depth;

        // Full-screen overlay – blocks clicks reaching the game world beneath
        this.overlay = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, 0x07090c, 0.90)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(D).setInteractive();
        this._elements.push(this.overlay);

        this.headerText = scene.add.text(0, 0, 'Shop', {
            fontFamily: UIHelpers.FONT, fontSize: '32px', color: '#ffffff', fontStyle: 'bold', resolution: 3
        }).setScrollFactor(0).setDepth(D + 1);
        this._elements.push(this.headerText);

        // Reroll button (its own Container so internal layout stays relative)
        this.rerollButtonContainer = scene.add.container(0, 0).setScrollFactor(0).setDepth(D + 1);
        const rerollBg = scene.add.graphics();
        rerollBg.fillStyle(0x1a1e24, 1);
        rerollBg.fillRoundedRect(-80, -22.5, 160, 45, 8);
        rerollBg.lineStyle(2, 0xd84315, 1);
        rerollBg.strokeRoundedRect(-80, -22.5, 160, 45, 8);

        this.rerollText = scene.add.text(0, 0, 'REROLL 💰 2', {
            fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#ffffff', fontStyle: 'bold', resolution: 3
        }).setOrigin(0.5);

        const rerollHitbox = scene.add.rectangle(0, 0, 160, 45, 0x000000, 0)
            .setScrollFactor(0).setInteractive({ useHandCursor: true });
        rerollHitbox.on('pointerdown', () =>
            this.connection.invoke("RerollShop").catch((err: any) => console.error(err)));
        rerollHitbox.on('pointerover', () => {
            rerollBg.clear();
            rerollBg.fillStyle(0xd84315, 1);
            rerollBg.fillRoundedRect(-80, -22.5, 160, 45, 8);
        });
        rerollHitbox.on('pointerout', () => {
            rerollBg.clear();
            rerollBg.fillStyle(0x1a1e24, 1);
            rerollBg.fillRoundedRect(-80, -22.5, 160, 45, 8);
            rerollBg.lineStyle(2, 0xd84315, 1);
            rerollBg.strokeRoundedRect(-80, -22.5, 160, 45, 8);
        });

        this.rerollButtonContainer.add([rerollBg, this.rerollText, rerollHitbox]);
        this._elements.push(this.rerollButtonContainer);

        this.tooltip = new Tooltip(scene);

        this.statDisplay = new StatDisplay(scene, 0, 0);
        this.statDisplay.setScrollFactor(0).setDepth(D + 1);
        this._elements.push(this.statDisplay as any);

        this.inventoryDisplay = new InventoryDisplay(scene, 0, 0, this.tooltip);
        this.inventoryDisplay.setScrollFactor(0).setDepth(D + 1);
        this._elements.push(this.inventoryDisplay as any);

        // Card containers are direct scene objects (not nested inside another Container)
        this.shopCardsContainer = scene.add.container(0, 0).setScrollFactor(0).setDepth(D + 1);
        this.levelUpContainer   = scene.add.container(0, 0).setScrollFactor(0).setDepth(D + 1);
        this._elements.push(this.shopCardsContainer);
        this._elements.push(this.levelUpContainer);

        // Defensive: any click on the scene hides the tooltip (e.g. after buy/reroll destroys hitboxes)
        scene.input.on('pointerdown', () => this.tooltip?.hide());

        this.updateLayout(scene.scale.width, scene.scale.height);
        scene.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
            this.overlay.setSize(gameSize.width, gameSize.height);
            this.updateLayout(gameSize.width, gameSize.height);
        });
    }

    get visible(): boolean { return this._visible; }

    public setVisible(value: boolean): this {
        this._visible = value;
        if (!value && this.tooltip) this.tooltip.hide();
        this._elements.forEach(el => el.setVisible(value));
        return this;
    }

    public setDepth(depth: number): this {
        this._depth = depth;
        this.overlay.setDepth(depth);
        this.headerText.setDepth(depth + 1);
        this.rerollButtonContainer.setDepth(depth + 1);
        this.statDisplay.setDepth(depth + 1);
        this.inventoryDisplay.setDepth(depth + 1);
        this.shopCardsContainer.setDepth(depth + 1);
        this.levelUpContainer.setDepth(depth + 1);
        return this;
    }

    // No-op: every element has its scrollFactor set individually in the constructor
    public setScrollFactor(_value: number): this { return this; }

    private updateLayout(width: number, height: number) {
        let scale = Math.min(width / 1280, height / 720);
        scale = Phaser.Math.Clamp(scale, 0.5, 3.0);

        this.headerText.setScale(scale);
        this.rerollButtonContainer.setScale(scale);
        this.statDisplay.setScale(scale);
        this.inventoryDisplay.setScale(scale);

        const statsWidth = 240 * scale;
        this.statDisplay.setPosition(width - statsWidth, Math.max(20, (height - (560 * scale)) / 2));
        this.inventoryDisplay.setPosition(40 * scale, height - (90 * scale));

        const availableWidth = width - statsWidth - (40 * scale);
        this.inventoryDisplay.updateLayout(availableWidth / scale);

        const rawCardsWidth         = 3 * 280;
        const rawCardsHeight        = 480;
        const headerBottom          = 100 * scale;
        const inventoryTop          = height - (210 * scale);
        const availableHeightForCards = inventoryTop - headerBottom;

        let cardScale = Math.min(scale, availableWidth / rawCardsWidth, availableHeightForCards / rawCardsHeight);

        this.shopCardsContainer.setScale(cardScale);
        this.levelUpContainer.setScale(cardScale);

        this.headerText.setPosition(40 * scale, 50 * scale).setOrigin(0, 0.5);
        this.rerollButtonContainer.setPosition(availableWidth / 2, 50 * scale);

        const cardsActualWidth = rawCardsWidth * cardScale;
        const centerX = (availableWidth - cardsActualWidth) / 2;
        const centerY = headerBottom + ((availableHeightForCards - (rawCardsHeight * cardScale)) / 2);

        this.shopCardsContainer.setPosition(centerX + (120 * cardScale), centerY);
        this.levelUpContainer.setPosition(centerX + (120 * cardScale), centerY);
    }

    public updateUIData(uiData: any, atlasConfigs: any) {
        if (!uiData) return;

        try {
            this.statDisplay.updateStats(uiData.stats, uiData.level || 1);
            this.inventoryDisplay.updateInventory(uiData.weapons, uiData.ownedItems, atlasConfigs);

            // Always hide before rebuilding card objects so destroyed hitboxes
            // don't leave a stale tooltip visible on screen.
            this.tooltip.hide();
            this.shopCardsContainer.removeAll(true);
            this.levelUpContainer.removeAll(true);

            // =========================================================
            // LEVEL UP CARDS RENDERER
            // =========================================================
            if (uiData.pendingLevelUps > 0) {
                this.shopCardsContainer.setVisible(false);
                this.rerollButtonContainer.setVisible(false);
                this.levelUpContainer.setVisible(true);

                this.headerText.setText(`LEVEL UP! (x${uiData.pendingLevelUps})`);
                this.headerText.setColor('#ffb300');

                uiData.levelUpChoices.forEach((card: any, index: number) => {
                    const cardX = index * 280;

                    const bgGraphics = this.scene.add.graphics();
                    bgGraphics.fillStyle(0x161920, 1);
                    bgGraphics.fillRoundedRect(cardX, 0, 240, 320, 12);
                    bgGraphics.lineStyle(2, UIHelpers.getTierColorHex(card.tier || card.Tier || 1), 1);
                    bgGraphics.strokeRoundedRect(cardX, 0, 240, 320, 12);

                    const hitbox = this.scene.add.rectangle(cardX + 120, 160, 240, 320, 0x000000, 0)
                        .setScrollFactor(0).setInteractive({ useHandCursor: true });
                    hitbox.on('pointerdown', () =>
                        this.connection.invoke("SelectLevelUpStat", card.id || card.Id).catch((err: any) => console.error(err)));
                    hitbox.on('pointerover', () => {
                        bgGraphics.lineStyle(4, 0xffffff, 1);
                        bgGraphics.strokeRoundedRect(cardX, 0, 240, 320, 12);
                    });
                    hitbox.on('pointerout', () => {
                        bgGraphics.lineStyle(2, UIHelpers.getTierColorHex(card.tier || card.Tier || 1), 1);
                        bgGraphics.strokeRoundedRect(cardX, 0, 240, 320, 12);
                    });

                    const nameText = this.scene.add.text(cardX + 120, 50, card.name || card.Name, {
                        fontFamily: UIHelpers.FONT, fontSize: '22px', color: '#fff', fontStyle: 'bold', resolution: 3
                    }).setOrigin(0.5);
                    const tierText = this.scene.add.text(cardX + 120, 80, `Tier ${card.tier || card.Tier || 1}`, {
                        fontFamily: UIHelpers.FONT, fontSize: '14px', color: UIHelpers.getTierColorStr(card.tier || card.Tier || 1), resolution: 3
                    }).setOrigin(0.5);

                    const statName = card.statName || card.StatName || "";
                    const amount   = card.amount   ?? card.Amount;
                    const info     = UIHelpers.getStatInfo(statName);
                    const isPct    = statName.toLowerCase().includes('percent') || statName === 'lifeSteal' || statName === 'dodge';
                    const valStr   = isPct ? `+${Math.round(amount * 100)}%` : `+${amount}`;
                    const statText = this.scene.add.text(cardX + 120, 160, `${info.e} ${info.n}: ${valStr}`, {
                        fontFamily: UIHelpers.FONT, fontSize: '20px', color: '#00ff00', fontStyle: 'bold', align: 'center', resolution: 3
                    }).setOrigin(0.5);

                    this.levelUpContainer.add([bgGraphics, nameText, tierText, statText, hitbox]);
                });
                return;
            }

            // =========================================================
            // SHOP CARDS RENDERER
            // =========================================================
            this.levelUpContainer.setVisible(false);
            this.shopCardsContainer.setVisible(true);
            this.rerollButtonContainer.setVisible(true);

            this.headerText.setText(`Shop (Wave ${uiData.currentWave})`);
            this.headerText.setColor('#ffffff');
            const cost = uiData.currentRerollCost || 2;
            this.rerollText.setText(`REROLL 💰 ${cost}`);
            this.rerollText.setColor(uiData.gold >= cost ? '#ffffff' : '#ff4444');

            if (!uiData.currentShop) return;

            // Build a map of owned weapon configIds for combine-preview
            const ownedWeaponsMap: Record<string, any> = {};
            if (uiData.weapons) {
                uiData.weapons.forEach((w: any) => {
                    const id = w.configId ?? w.ConfigId;
                    if (id) ownedWeaponsMap[id] = w;
                });
            }

            uiData.currentShop.forEach((item: any, index: number) => {
                const cardX = index * 280;

                let config: any = undefined;
                let isWeapon    = false;

                const configId = item.configId ?? item.ConfigId;
                const isLocked = item.isLocked ?? item.IsLocked;

                if (atlasConfigs?.items?.[configId]) {
                    config   = atlasConfigs.items[configId];
                } else if (atlasConfigs?.weapons?.[configId]) {
                    config   = atlasConfigs.weapons[configId];
                    isWeapon = true;
                }

                const tier      = config?.tier ?? config?.Tier ?? 1;
                const tierColor = isLocked ? 0x888888 : UIHelpers.getTierColorHex(tier);

                // ---- Card background ----
                const cardBg = this.scene.add.graphics();
                cardBg.fillStyle(0x161920, 1);
                cardBg.fillRoundedRect(cardX, 0, 240, 480, 12);
                cardBg.lineStyle(2, tierColor, 1);
                cardBg.strokeRoundedRect(cardX, 0, 240, 480, 12);
                this.shopCardsContainer.add(cardBg);

                // ---- Icon ----
                const tex = config?.textureKey ?? config?.TextureKey;
                if (tex && tex.trim() !== "" && this.scene.textures.exists(tex)) {
                    const icon = this.scene.add.sprite(cardX + 120, 75, tex);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min(64 / icon.width, 64 / icon.height));
                    this.shopCardsContainer.add(icon);
                }

                // ---- Name / type header ----
                const nameText = this.scene.add.text(cardX + 120, 135, item.name ?? item.Name ?? "Unknown", {
                    fontFamily: UIHelpers.FONT, fontSize: '18px', color: UIHelpers.getTierColorStr(tier), fontStyle: 'bold', resolution: 3
                }).setOrigin(0.5);
                const typeStr  = isWeapon ? "⚔️ Weapon" : "🎒 Item";
                const typeText = this.scene.add.text(cardX + 120, 155, typeStr, {
                    fontFamily: UIHelpers.FONT, fontSize: '12px', color: '#8892a0', fontStyle: 'italic', resolution: 3
                }).setOrigin(0.5);
                const divider  = this.scene.add.rectangle(cardX + 120, 170, 200, 2, 0x3a4454).setOrigin(0.5);

                // ---- Build stat text using shared helper ----
                const rolledStats  = item.rolledStats  ?? item.RolledStats;
                const rolledSkills = item.weaponSkills  ?? item.WeaponSkills;
                const { posStr, negStr, randomStr, skillsStr } =
                    UIHelpers.buildStatLines(config, rolledStats, rolledSkills, atlasConfigs, 1);

                // ---- Weapon combine preview ----
                let combinePreview: CombinePreview | undefined;
                if (isWeapon && config && ownedWeaponsMap[configId]) {
                    const owned = ownedWeaponsMap[configId];
                    const combinedStats: Record<string, number> = {};
                    const accumulate = (bonuses: any) => {
                        if (!bonuses) return;
                        Object.entries(bonuses).forEach(([k, v]) => {
                            combinedStats[k] = (combinedStats[k] ?? 0) + (v as number);
                        });
                    };
                    // Sum base stat bonuses from both weapon instances
                    accumulate(config.statBonuses ?? config.StatBonuses);
                    accumulate(config.statBonuses ?? config.StatBonuses);
                    // Sum random rolled stats from both instances
                    accumulate(owned.rolledStats  ?? owned.RolledStats);
                    accumulate(item.rolledStats   ?? item.RolledStats);

                    const ownedSkills = owned.weaponSkills ?? owned.WeaponSkills ?? [];
                    const shopSkills  = item.weaponSkills  ?? item.WeaponSkills  ?? [];
                    const allSkills   = [...(config.grantedSkills ?? []), ...ownedSkills, ...shopSkills];
                    combinePreview = {
                        tier:   (config.tier ?? 1) + 1,
                        stats:  combinedStats,
                        skills: [...new Set(allSkills)],
                    };
                }

                // ---- Build card body text ----
                let finalPosStr = '';
                if (posStr)      finalPosStr += `[ 📊 Base Stats ]\n${posStr}`;
                if (randomStr)   finalPosStr += `\n[ 🎲 Random Rolls ]\n${randomStr}`;
                if (skillsStr)   finalPosStr += `\n[ 🌟 Skills ]\n${skillsStr}`;
                if (combinePreview) {
                    const skillMap = atlasConfigs?.skills ?? atlasConfigs?.Skills;
                    finalPosStr += `\n[ ⚗️ Combine → Tier ${combinePreview.tier} ]\n`;
                    Object.entries(combinePreview.stats).forEach(([k, v]) => {
                        const num  = v as number;
                        const info = UIHelpers.getStatInfo(k);
                        finalPosStr += `${info.e} ${info.n}: ${num > 0 ? '+' : ''}${UIHelpers.formatVal(k, num)}\n`;
                    });
                    if (combinePreview.skills.length) {
                        combinePreview.skills.forEach((id: string) => {
                            const s = skillMap?.[id];
                            finalPosStr += `⭐ ${s ? (s.name ?? s.Name) : id}\n`;
                        });
                    }
                }

                const posTextObj = this.scene.add.text(cardX + 15, 180, finalPosStr.trim(), {
                    fontFamily: UIHelpers.FONT, fontSize: '12px', color: '#dddddd', lineSpacing: 2, resolution: 3
                }).setOrigin(0, 0);
                const negTextObj = this.scene.add.text(cardX + 15, 180 + posTextObj.height + 4, negStr.trim(), {
                    fontFamily: UIHelpers.FONT, fontSize: '12px', color: '#ff4444', lineSpacing: 2, resolution: 3
                }).setOrigin(0, 0);

                // ---- Buy button ----
                const buyBtnBg = this.scene.add.graphics();
                buyBtnBg.fillStyle(0x2e7d32, 1);
                buyBtnBg.fillRoundedRect(cardX + 30, 390, 180, 40, 20);
                const buyText = this.scene.add.text(cardX + 120, 410, `BUY 💰 ${item.price ?? item.Price}`, {
                    fontFamily: UIHelpers.FONT, fontSize: '16px', fontStyle: 'bold', color: '#ffffff', resolution: 3
                }).setOrigin(0.5);

                const buyHitbox = this.scene.add.rectangle(cardX + 120, 410, 180, 40, 0x000000, 0)
                    .setScrollFactor(0).setInteractive({ useHandCursor: true });
                buyHitbox.on('pointerdown', () =>
                    this.connection.invoke("BuyItem", configId).catch((err: any) => console.error(err)));
                buyHitbox.on('pointerover', () => {
                    buyBtnBg.clear();
                    buyBtnBg.fillStyle(0x4caf50, 1);
                    buyBtnBg.fillRoundedRect(cardX + 30, 390, 180, 40, 20);
                });
                buyHitbox.on('pointerout', () => {
                    buyBtnBg.clear();
                    buyBtnBg.fillStyle(0x2e7d32, 1);
                    buyBtnBg.fillRoundedRect(cardX + 30, 390, 180, 40, 20);
                });

                // ---- Lock button ----
                const lockBtnBg = this.scene.add.graphics();
                lockBtnBg.fillStyle(isLocked ? 0x443300 : 0x2a303a, 1);
                lockBtnBg.fillRoundedRect(cardX + 70, 440, 100, 26, 13);
                const lockText = this.scene.add.text(cardX + 120, 453, isLocked ? '🔒 LOCKED' : '🔓 Lock', {
                    fontFamily: UIHelpers.FONT, fontSize: '12px', color: isLocked ? '#ffb300' : '#8892a0', resolution: 3
                }).setOrigin(0.5);

                const lockHitbox = this.scene.add.rectangle(cardX + 120, 453, 100, 26, 0x000000, 0)
                    .setScrollFactor(0).setInteractive({ useHandCursor: true });
                lockHitbox.on('pointerdown', () =>
                    this.connection.invoke("ToggleLock", configId).catch((err: any) => console.error(err)));

                // ---- Whole-card hover hitbox for tooltip ----
                const cardHitbox = this.scene.add.rectangle(cardX + 120, 240, 240, 480, 0x000000, 0)
                    .setScrollFactor(0).setInteractive();
                cardHitbox.on('pointerover', (p: Phaser.Input.Pointer) => {
                    cardBg.lineStyle(3, 0xffffff, 1);
                    cardBg.strokeRoundedRect(cardX, 0, 240, 480, 12);
                    this.tooltip.show(config, p.x, p.y, 1, atlasConfigs, rolledStats, rolledSkills, combinePreview);
                });
                cardHitbox.on('pointermove', (p: Phaser.Input.Pointer) =>
                    this.tooltip.setPosition(p.x + 15, p.y + 15));
                cardHitbox.on('pointerout', () => {
                    cardBg.lineStyle(2, tierColor, 1);
                    cardBg.strokeRoundedRect(cardX, 0, 240, 480, 12);
                    this.tooltip.hide();
                });

                // Order: visuals first → cardHitbox → buy/lock on top (highest z = first processed for input)
                this.shopCardsContainer.add([
                    divider, nameText, typeText, posTextObj, negTextObj,
                    buyBtnBg, buyText, lockBtnBg, lockText,
                    cardHitbox,
                    buyHitbox,
                    lockHitbox,
                ]);
            });

        } catch (err) {
            console.error("Safely caught UI Update error to prevent game freeze:", err);
        }
    }
}
