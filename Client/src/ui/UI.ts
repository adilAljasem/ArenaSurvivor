import * as Phaser from 'phaser';
import { HubConnection } from '@microsoft/signalr';

// =========================================================================
// TYPES
// =========================================================================
export interface CombinePreview {
    tier: number;
    stats: Record<string, number>;
    skills: string[];
}

export interface TextBlock {
    text: string;
    color: string;
    isHeader?: boolean;
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

    formatEffectName: (str: string): string => {
        if (!str) return "";
        return str.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    },

    buildStatBlocks: (
        config: any,
        rolledStats: any = null,
        rolledSkills: string[] | null = null,
        atlasConfigs: any = null,
        stackCount: number = 1,
        combinePreview: CombinePreview | null = null
    ): TextBlock[] => {
        const blocks: TextBlock[] = [];
        let posLines: string[] = [];
        let negLines: string[] = [];
        let randomLines: string[] = [];
        let skillsLines: string[] = [];

        if (!config) return blocks;

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

            // Apply stackCount (weapon level or item count) to base stats
            if (meleeDmg)  posLines.push(`🗡️ Melee Dmg: ${meleeDmg * stackCount}`);
            if (rangedDmg) posLines.push(`🏹 Ranged Dmg: ${rangedDmg * stackCount}`);
            if (elemDmg)   posLines.push(`🔥 Elem Dmg: ${elemDmg * stackCount}`);
            if (cooldown)  posLines.push(`⏱️ Cooldown: ${cooldown}s`);
            if (range)     posLines.push(`📏 Range: ${range}`);

            if (scaling) {
                const parts = Object.entries(scaling).map(([k, v]) => `${Math.round((v as number) * 100)}% ${UIHelpers.getStatInfo(k).n}`);
                if (parts.length) posLines.push(`📈 Scales: ${parts.join(', ')}`);
            }

            if (onHitEffects?.length) onHitEffects.forEach((e: string) => posLines.push(`🧪 On Hit: ${UIHelpers.formatEffectName(e)}`));

            if (mechanics) {
                Object.entries(mechanics).forEach(([k, v]) => {
                    const info = UIHelpers.getStatInfo(k);
                    posLines.push(`${info.e} ${info.n}: ${UIHelpers.formatVal(k, (v as number) * stackCount)}`);
                });
            }

            if (statBonuses) {
                Object.entries(statBonuses).forEach(([k, v]) => {
                    const num = (v as number) * stackCount;
                    const info = UIHelpers.getStatInfo(k);
                    if (num > 0) posLines.push(`${info.e} ${info.n}: +${UIHelpers.formatVal(k, num)}`);
                    else if (num < 0) negLines.push(`${info.e} ${info.n}: ${UIHelpers.formatVal(k, num)}`);
                });
            }

            if (dynamicMods) {
                dynamicMods.forEach((m: any) => {
                    const stat = m.targetStat ?? m.TargetStat ?? "";
                    const amt = (m.amount ?? m.Amount) * stackCount;
                    const thresh = m.conditionThreshold ?? m.ConditionThreshold;
                    const info = UIHelpers.getStatInfo(stat);
                    posLines.push(`⚡ ${info.n}: ${amt > 0 ? '+' : ''}${UIHelpers.formatVal(stat, amt)} per ${Math.round(thresh * 100)}% missing HP`);
                });
            }

            if (waveEndEffects?.length) {
                waveEndEffects.forEach((e: any) => {
                    const stat = e.statName ?? e.StatName ?? "";
                    const amt = (e.amount ?? e.Amount) * stackCount;
                    const info = UIHelpers.getStatInfo(stat);
                    const line = `🌊 Wave End: ${info.n} ${amt > 0 ? '+' : ''}${UIHelpers.formatVal(stat, amt)}`;
                    if (amt < 0) negLines.push(line); else posLines.push(line);
                });
            }

            if (onPurchase?.length) onPurchase.forEach((e: string) => posLines.push(`🔹 Grants: ${UIHelpers.formatEffectName(e)}`));

            if (traits) {
                traits.forEach((t: string) => {
                    if (t === "CannotHeal") negLines.push(`⚠️ Cannot Heal`);
                    else posLines.push(`🔹 ${UIHelpers.formatEffectName(t)}`);
                });
            }

            if (grantedSkills?.length) {
                const skillMap = atlasConfigs?.skills ?? atlasConfigs?.Skills;
                grantedSkills.forEach((id: string) => {
                    const s = skillMap?.[id];
                    skillsLines.push(`⭐ ${s ? (s.name ?? s.Name) : id}`);
                });
            }

            if (rolledStats && Object.keys(rolledStats).length) {
                Object.entries(rolledStats).forEach(([k, v]) => {
                    const num = v as number;
                    const info = UIHelpers.getStatInfo(k);
                    if (num > 0) randomLines.push(`${info.e} ${info.n}: +${UIHelpers.formatVal(k, num)}`);
                    else if (num < 0) negLines.push(`${info.e} ${info.n}: ${UIHelpers.formatVal(k, num)}`);
                });
            }

            if (rolledSkills?.length) {
                const skillMap = atlasConfigs?.skills ?? atlasConfigs?.Skills;
                rolledSkills.forEach((id: string) => {
                    const s = skillMap?.[id];
                    skillsLines.push(`✨ ${s ? (s.name ?? s.Name) : id}`);
                });
            }

            if (posLines.length > 0) {
                blocks.push({ text: "[ Base Stats ]", color: "#4fc3f7", isHeader: true });
                blocks.push({ text: posLines.join('\n'), color: "#ffffff" });
            }
            if (negLines.length > 0) {
                blocks.push({ text: negLines.join('\n'), color: "#ef5350" });
            }
            if (randomLines.length > 0) {
                blocks.push({ text: "[ Random Rolls ]", color: "#ffd54f", isHeader: true });
                blocks.push({ text: randomLines.join('\n'), color: "#ffffff" });
            }
            if (skillsLines.length > 0) {
                blocks.push({ text: "[ Skills ]", color: "#ba68c8", isHeader: true });
                blocks.push({ text: skillsLines.join('\n'), color: "#ffffff" });
            }

            if (combinePreview) {
                blocks.push({ text: `[ ⚗️ Combine → Tier ${combinePreview.tier} ]`, color: "#81c784", isHeader: true });
                let comboStr = "";
                const skillMap = atlasConfigs?.skills ?? atlasConfigs?.Skills;
                Object.entries(combinePreview.stats).forEach(([k, v]) => {
                    const num = v as number;
                    const info = UIHelpers.getStatInfo(k);
                    comboStr += `${info.e} ${info.n}: ${num > 0 ? '+' : ''}${UIHelpers.formatVal(k, num)}\n`;
                });
                combinePreview.skills.forEach((id: string) => {
                    const s = skillMap?.[id];
                    comboStr += `⭐ ${s ? (s.name ?? s.Name) : id}\n`;
                });
                blocks.push({ text: comboStr.trim(), color: "#ffffff" });
            }

        } catch (e) {
            console.error("buildStatBlocks error:", e);
        }

        return blocks;
    }
};

// =========================================================================
// TOOLTIP
// =========================================================================
export class Tooltip extends Phaser.GameObjects.Container {
    private bg: Phaser.GameObjects.Graphics;
    private titleText: Phaser.GameObjects.Text;
    private dynamicTexts: Phaser.GameObjects.Text[] = [];
    private currentHeight: number = 80;

    constructor(scene: Phaser.Scene) {
        super(scene, 0, 0);
        this.setDepth(5000);
        this.setVisible(false);
        this.setScrollFactor(0);

        this.bg = scene.add.graphics();
        this.titleText = scene.add.text(12, 12, '', {
            fontFamily: UIHelpers.FONT, fontSize: '18px', fontStyle: 'bold', resolution: 3
        });

        this.add([this.bg, this.titleText]);
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
            this.dynamicTexts.forEach(t => t.destroy());
            this.dynamicTexts = [];

            const tier = config.tier ?? config.Tier ?? 1;
            this.titleText.setText(config.name ?? config.Name ?? '').setColor(UIHelpers.getTierColorStr(tier));

            const blocks = UIHelpers.buildStatBlocks(config, rolledStats, rolledSkills, atlasConfigs, stackCount, combinePreview);

            let currentY = 38;
            blocks.forEach(b => {
                const t = this.scene.add.text(12, currentY, b.text, {
                    fontFamily: UIHelpers.FONT,
                    fontSize: b.isHeader ? '14px' : '13px',
                    fontStyle: b.isHeader ? 'bold' : 'normal',
                    color: b.color,
                    wordWrap: { width: 240 },
                    lineSpacing: 3,
                    resolution: 3
                });
                this.add(t);
                this.dynamicTexts.push(t);
                currentY += t.displayHeight + (b.isHeader ? 2 : 6);
            });

            this.currentHeight = Math.max(80, currentY + 10);

            this.bg.clear();
            this.bg.fillStyle(0x111317, 0.95);
            this.bg.fillRoundedRect(0, 0, 264, this.currentHeight, 8);
            this.bg.lineStyle(2, UIHelpers.getTierColorHex(tier), 1);
            this.bg.strokeRoundedRect(0, 0, 264, this.currentHeight, 8);

            this.updatePosition(x, y);
            this.setVisible(true);
        } catch (err) {
            console.error("Safely caught a Tooltip formatting error:", err);
        }
    }

    public updatePosition(x: number, y: number) {
        let targetX = x + 15;
        let targetY = y + 15;
        
        if (targetX + 264 > this.scene.scale.width) {
            targetX = x - 280;
        }
        
        if (targetY + this.currentHeight > this.scene.scale.height) {
            targetY = y - this.currentHeight - 5;
            if (targetY < 5) targetY = 5;
        }

        this.setPosition(targetX, targetY);
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
export class InventoryDisplay {
    private scene: Phaser.Scene;
    private tooltip: Tooltip;
    
    // Explicit TS fixing here!
    private _elements: (Phaser.GameObjects.GameObject & { setVisible(v: boolean): any; setDepth(d: number): any })[] = [];
    
    private baseX: number = 0;
    private baseY: number = 0;
    private availableWidth: number = 0;
    private currentScale: number = 1;
    private _visible: boolean = false;
    private _depth: number = 1000;
    
    private atlasConfigs: any = null;
    private weaponsData: any[] = [];
    private itemsData: any[] = [];

    constructor(scene: Phaser.Scene, tooltip: Tooltip) {
        this.scene = scene;
        this.tooltip = tooltip;
    }

    public setVisible(value: boolean): this {
        this._visible = value;
        this._elements.forEach(e => e?.setVisible(value));
        return this;
    }

    public setDepth(depth: number): this {
        this._depth = depth;
        this._elements.forEach(e => e?.setDepth(depth));
        return this;
    }

    public setScale(scale: number): this {
        this.currentScale = scale;
        this.redraw();
        return this;
    }

    public setPosition(x: number, y: number): this {
        this.baseX = x;
        this.baseY = y;
        this.redraw();
        return this;
    }

    public setScrollFactor(value: number): this { return this; }

    public updateLayout(availableWidth: number) {
        this.availableWidth = availableWidth;
        this.redraw();
    }

    public updateInventory(weapons: any[], items: any[], atlasConfigs: any) {
        this.weaponsData = weapons || [];
        this.itemsData = items || [];
        this.atlasConfigs = atlasConfigs;
        this.redraw();
    }

    private redraw() {
        this._elements.forEach(e => e?.destroy());
        this._elements = [];

        if (!this.atlasConfigs) return;

        const itemStartX = this.baseX;
        const itemStartY = this.baseY;
        const weaponStartX = this.baseX + (this.availableWidth * this.currentScale) - (180 * this.currentScale);
        const weaponStartY = this.baseY - (80 * this.currentScale);
        
        const slotSize = 65 * this.currentScale;
        const slotGap = 75 * this.currentScale;

        // ---- Items ----
        const itemTitle = this.scene.add.text(itemStartX, itemStartY - (25 * this.currentScale), 'Items', {
            fontFamily: UIHelpers.FONT, fontSize: `${16 * this.currentScale}px`, color: '#a0abbc', fontStyle: 'bold', resolution: 3
        }).setScrollFactor(0).setDepth(this._depth).setVisible(this._visible);
        this._elements.push(itemTitle);

        for (let i = 0; i < 5; i++) {
            const slotX = itemStartX + (i * slotGap);
            const slotY = itemStartY;

            const slotBg = this.scene.add.graphics().setScrollFactor(0).setDepth(this._depth).setVisible(this._visible);
            slotBg.fillStyle(0x161920, 1);
            slotBg.fillRoundedRect(slotX, slotY, slotSize, slotSize, 8 * this.currentScale);
            slotBg.lineStyle(2 * this.currentScale, 0x3a4454, 1);
            slotBg.strokeRoundedRect(slotX, slotY, slotSize, slotSize, 8 * this.currentScale);
            this._elements.push(slotBg);

            if (this.itemsData[i]) {
                const itemData = this.itemsData[i];
                const config = this.atlasConfigs?.items?.[itemData.configId] ?? null;
                const stackCount = itemData.count || 1;

                if (config) {
                    slotBg.lineStyle(2 * this.currentScale, UIHelpers.getTierColorHex(config.tier || 1), 1);
                    slotBg.strokeRoundedRect(slotX, slotY, slotSize, slotSize, 8 * this.currentScale);
                }

                const tex = config?.textureKey ?? config?.TextureKey;
                if (tex && this.scene.textures.exists(tex)) {
                    const icon = this.scene.add.sprite(slotX + (slotSize / 2), slotY + (slotSize / 2), tex)
                        .setScrollFactor(0).setDepth(this._depth).setVisible(this._visible);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min((50 * this.currentScale) / icon.width, (50 * this.currentScale) / icon.height));
                    this._elements.push(icon);
                }

                const hitbox = this.scene.add.rectangle(slotX + (slotSize / 2), slotY + (slotSize / 2), slotSize, slotSize, 0x000000, 0)
                    .setScrollFactor(0).setDepth(this._depth).setVisible(this._visible).setInteractive({ useHandCursor: true });
                
                if (config) {
                    const rolledStats = itemData.rolledStats ?? itemData.RolledStats;
                    const rolledSkills = itemData.rolledSkills ?? itemData.RolledSkills;
                    hitbox.on('pointerover', (p: Phaser.Input.Pointer) => this.tooltip.show(config, p.x, p.y, stackCount, this.atlasConfigs, rolledStats, rolledSkills));
                    hitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.updatePosition(p.x, p.y));
                    hitbox.on('pointerout', () => this.tooltip.hide());
                }
                this._elements.push(hitbox as any);

                if (stackCount > 1) {
                    const countTxt = this.scene.add.text(slotX + slotSize - (5 * this.currentScale), slotY + slotSize - (5 * this.currentScale), `x${stackCount}`, {
                        fontFamily: UIHelpers.FONT, fontSize: `${14 * this.currentScale}px`, color: '#fff', stroke: '#000', strokeThickness: 3 * this.currentScale, resolution: 3
                    }).setOrigin(1, 1).setScrollFactor(0).setDepth(this._depth).setVisible(this._visible);
                    this._elements.push(countTxt);
                }
            }
        }

        // ---- Weapons ----
        const weaponTitle = this.scene.add.text(weaponStartX, weaponStartY - (25 * this.currentScale), 'Weapons', {
            fontFamily: UIHelpers.FONT, fontSize: `${16 * this.currentScale}px`, color: '#a0abbc', fontStyle: 'bold', resolution: 3
        }).setScrollFactor(0).setDepth(this._depth).setVisible(this._visible);
        this._elements.push(weaponTitle);

        for (let i = 0; i < 4; i++) {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const slotX = weaponStartX + (col * slotGap);
            const slotY = weaponStartY + (row * slotGap);

            const slotBg = this.scene.add.graphics().setScrollFactor(0).setDepth(this._depth).setVisible(this._visible);
            slotBg.fillStyle(0x161920, 1);
            slotBg.fillRoundedRect(slotX, slotY, slotSize, slotSize, 8 * this.currentScale);
            slotBg.lineStyle(2 * this.currentScale, 0x3a4454, 1);
            slotBg.strokeRoundedRect(slotX, slotY, slotSize, slotSize, 8 * this.currentScale);
            this._elements.push(slotBg);

            if (this.weaponsData[i]) {
                const weaponData = this.weaponsData[i];
                const config = this.atlasConfigs?.weapons?.[weaponData.configId] ?? null;
                const wLevel = weaponData.level || 1;

                if (config) {
                    slotBg.lineStyle(2 * this.currentScale, UIHelpers.getTierColorHex(wLevel), 1);
                    slotBg.strokeRoundedRect(slotX, slotY, slotSize, slotSize, 8 * this.currentScale);
                }

                const tex = config?.textureKey ?? config?.TextureKey;
                if (tex && this.scene.textures.exists(tex)) {
                    const icon = this.scene.add.sprite(slotX + (slotSize / 2), slotY + (slotSize / 2), tex)
                        .setScrollFactor(0).setDepth(this._depth).setVisible(this._visible);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min((50 * this.currentScale) / icon.width, (50 * this.currentScale) / icon.height));
                    this._elements.push(icon);
                }

                const hitbox = this.scene.add.rectangle(slotX + (slotSize / 2), slotY + (slotSize / 2), slotSize, slotSize, 0x000000, 0)
                    .setScrollFactor(0).setDepth(this._depth).setVisible(this._visible).setInteractive({ useHandCursor: true });

                if (config) {
                    const toolTipConfig = { ...config, tier: wLevel };
                    const rolledStats = weaponData.rolledStats ?? weaponData.RolledStats;
                    const weaponSkills = weaponData.weaponSkills ?? weaponData.WeaponSkills;
                    
                    hitbox.on('pointerover', (p: Phaser.Input.Pointer) => this.tooltip.show(toolTipConfig, p.x, p.y, wLevel, this.atlasConfigs, rolledStats, weaponSkills));
                    hitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.updatePosition(p.x, p.y));
                    hitbox.on('pointerout', () => this.tooltip.hide());
                }
                this._elements.push(hitbox as any);

                const lvlTxt = this.scene.add.text(slotX + slotSize - (5 * this.currentScale), slotY + slotSize - (5 * this.currentScale), `Lv.${wLevel}`, {
                    fontFamily: UIHelpers.FONT, fontSize: `${13 * this.currentScale}px`, color: '#ffffff', stroke: '#000', strokeThickness: 3 * this.currentScale, resolution: 3
                }).setOrigin(1, 1).setScrollFactor(0).setDepth(this._depth).setVisible(this._visible);
                this._elements.push(lvlTxt);
            }
        }
    }
}

// =========================================================================
// MAIN SHOP UI
// =========================================================================
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

    private _elements: (Phaser.GameObjects.GameObject & { setVisible(v: boolean): any; setDepth(d: number): any })[] = [];
    private _visible: boolean = false;
    private _depth: number = 1000;

    constructor(scene: Phaser.Scene, connection: HubConnection) {
        this.scene = scene;
        this.connection = connection;
        const D = this._depth;

        this.overlay = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, 0x07090c, 0.90)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(D).setInteractive();
        this._elements.push(this.overlay);

        this.headerText = scene.add.text(0, 0, 'Shop', {
            fontFamily: UIHelpers.FONT, fontSize: '32px', color: '#ffffff', fontStyle: 'bold', resolution: 3
        }).setScrollFactor(0).setDepth(D + 1);
        this._elements.push(this.headerText);

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

        this.inventoryDisplay = new InventoryDisplay(scene, this.tooltip);
        this.inventoryDisplay.setDepth(D + 1);
        this._elements.push(this.inventoryDisplay as any);

        this.shopCardsContainer = scene.add.container(0, 0).setScrollFactor(0).setDepth(D + 1);
        this.levelUpContainer   = scene.add.container(0, 0).setScrollFactor(0).setDepth(D + 1);
        this._elements.push(this.shopCardsContainer);
        this._elements.push(this.levelUpContainer);

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

                // -------------------------------------------------------------
                // 1. BASE BACKGROUND
                // -------------------------------------------------------------
                const cardBg = this.scene.add.graphics();
                cardBg.fillStyle(0x161920, 1);
                cardBg.fillRoundedRect(cardX, 0, 240, 480, 12);
                this.shopCardsContainer.add(cardBg);

                // -------------------------------------------------------------
                // 2. SCROLLABLE TEXT (Placed underneath the blockers)
                // -------------------------------------------------------------
                let combinePreview: CombinePreview | undefined;
                if (isWeapon && config && ownedWeaponsMap[configId]) {
                    const owned = ownedWeaponsMap[configId];
                    const combinedStats: Record<string, number> = {};
                    const accumulate = (bonuses: any) => {
                        if (!bonuses) return;
                        Object.entries(bonuses).forEach(([k, v]) => { combinedStats[k] = (combinedStats[k] ?? 0) + (v as number); });
                    };
                    accumulate(config.statBonuses ?? config.StatBonuses);
                    accumulate(config.statBonuses ?? config.StatBonuses);
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

                const rolledStats  = item.rolledStats  ?? item.RolledStats;
                const rolledSkills = item.weaponSkills  ?? item.WeaponSkills;
                const blocks = UIHelpers.buildStatBlocks(config, rolledStats, rolledSkills, atlasConfigs, 1, combinePreview);

                const statsContainer = this.scene.add.container(0, 0);
                this.shopCardsContainer.add(statsContainer);

                let currentY = 115;
                blocks.forEach(b => {
                    const t = this.scene.add.text(cardX + 15, currentY, b.text, {
                        fontFamily: UIHelpers.FONT,
                        fontSize: b.isHeader ? '13px' : '12px',
                        fontStyle: b.isHeader ? 'bold' : 'normal',
                        color: b.color,
                        lineSpacing: 1,
                        wordWrap: { width: 200 }, // Leave room for scrollbar
                        resolution: 3
                    }).setOrigin(0, 0);
                    statsContainer.add(t);
                    currentY += t.displayHeight + (b.isHeader ? 2 : 4);
                });

                // SCROLLBAR CALCS
                const maxScroll = Math.max(0, currentY - 115 - 260);
                let updateScrollBar = () => {};

                if (maxScroll > 0) {
                    const scrollBarBg = this.scene.add.graphics();
                    scrollBarBg.fillStyle(0x000000, 0.5);
                    scrollBarBg.fillRoundedRect(cardX + 225, 115, 4, 260, 2);
                    this.shopCardsContainer.add(scrollBarBg);

                    const scrollBar = this.scene.add.graphics();
                    this.shopCardsContainer.add(scrollBar);
                    const barHeight = Math.max(20, 260 * (260 / (currentY - 115)));
                    
                    updateScrollBar = () => {
                        scrollBar.clear();
                        scrollBar.fillStyle(0x8892a0, 1);
                        const progress = Math.abs(statsContainer.y) / maxScroll;
                        const barY = 115 + (progress * (260 - barHeight));
                        scrollBar.fillRoundedRect(cardX + 225, barY, 4, barHeight, 2);
                    };
                    updateScrollBar();
                }

                // -------------------------------------------------------------
                // 3. SOLID BLOCKERS (The "Stencil-less Mask")
                // By drawing the same color block over the top and bottom of the card, 
                // the scrolling text is naturally "clipped" without using WebGL masks!
                // -------------------------------------------------------------
                const blockers = this.scene.add.graphics();
                blockers.fillStyle(0x161920, 1);
                
                // Top Blocker (Hides text scrolling up)
                blockers.fillRoundedRect(cardX, 0, 240, 115, 12);
                blockers.fillRect(cardX, 50, 240, 65); // Square off the bottom of the top blocker
                
                // Bottom Blocker (Hides text scrolling down)
                blockers.fillRoundedRect(cardX, 375, 240, 105, 12);
                blockers.fillRect(cardX, 375, 240, 60); // Square off the top of the bottom blocker
                
                this.shopCardsContainer.add(blockers);

                // -------------------------------------------------------------
                // 4. BORDER (Drawn above blockers so it stays visible)
                // -------------------------------------------------------------
                const cardBorder = this.scene.add.graphics();
                cardBorder.lineStyle(2, tierColor, 1);
                cardBorder.strokeRoundedRect(cardX, 0, 240, 480, 12);
                this.shopCardsContainer.add(cardBorder);

                // -------------------------------------------------------------
                // 5. HEADER CONTENT (Drawn over the top blocker)
                // -------------------------------------------------------------
                const tierTextStr = `Tier ${tier} ${isWeapon ? 'Weapon' : 'Item'}`;
                const tierTextObj = this.scene.add.text(cardX + 120, 20, tierTextStr, {
                    fontFamily: UIHelpers.FONT, fontSize: '12px', color: UIHelpers.getTierColorStr(tier), fontStyle: 'bold', resolution: 3
                }).setOrigin(0.5);
                
                const nameText = this.scene.add.text(cardX + 120, 40, item.name ?? item.Name ?? "Unknown", {
                    fontFamily: UIHelpers.FONT, fontSize: '20px', color: '#ffffff', fontStyle: 'bold', resolution: 3
                }).setOrigin(0.5);

                const tex = config?.textureKey ?? config?.TextureKey;
                let icon: any = null;
                if (tex && tex.trim() !== "" && this.scene.textures.exists(tex)) {
                    icon = this.scene.add.sprite(cardX + 120, 75, tex);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min(48 / icon.width, 48 / icon.height));
                }

                const divider = this.scene.add.rectangle(cardX + 120, 105, 200, 2, 0x3a4454).setOrigin(0.5);
                
                this.shopCardsContainer.add([tierTextObj, nameText, divider]);
                if (icon) this.shopCardsContainer.add(icon);

                // -------------------------------------------------------------
                // 6. FOOTER CONTENT & BUTTONS (Drawn over the bottom blocker)
                // -------------------------------------------------------------
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

                this.shopCardsContainer.add([buyBtnBg, buyText, lockBtnBg, lockText]);

                // -------------------------------------------------------------
                // 7. CARD HOVER / SCROLL HITBOX
                // -------------------------------------------------------------
                const cardHitbox = this.scene.add.rectangle(cardX + 120, 240, 240, 480, 0x000000, 0)
                    .setScrollFactor(0).setInteractive();
                
                cardHitbox.on('wheel', (pointer: Phaser.Input.Pointer, dx: number, dy: number, dz: number, event: Phaser.Types.Input.EventData) => {
                    if (maxScroll > 0) {
                        statsContainer.y -= dy * 0.5;
                        if (statsContainer.y < -maxScroll) statsContainer.y = -maxScroll;
                        if (statsContainer.y > 0) statsContainer.y = 0;
                        updateScrollBar();
                        event.stopPropagation();
                    }
                });

                this.scene.input.setDraggable(cardHitbox);
                cardHitbox.on('drag', (pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
                    if (maxScroll > 0) {
                        statsContainer.y += (pointer.y - pointer.prevPosition.y); 
                        if (statsContainer.y < -maxScroll) statsContainer.y = -maxScroll;
                        if (statsContainer.y > 0) statsContainer.y = 0;
                        updateScrollBar();
                    }
                });

                cardHitbox.on('pointerover', (p: Phaser.Input.Pointer) => {
                    cardBorder.lineStyle(3, 0xffffff, 1);
                    cardBorder.strokeRoundedRect(cardX, 0, 240, 480, 12);
                    this.tooltip.show(config, p.x, p.y, 1, atlasConfigs, rolledStats, rolledSkills, combinePreview);
                });
                cardHitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.updatePosition(p.x, p.y));
                cardHitbox.on('pointerout', () => {
                    cardBorder.lineStyle(2, tierColor, 1);
                    cardBorder.strokeRoundedRect(cardX, 0, 240, 480, 12);
                    this.tooltip.hide();
                });

                // Add hitboxes last so they correctly capture pointer events on top of visuals
                this.shopCardsContainer.add([cardHitbox, buyHitbox, lockHitbox]);
            });

        } catch (err) {
            console.error("Safely caught UI Update error to prevent game freeze:", err);
        }
    }
}