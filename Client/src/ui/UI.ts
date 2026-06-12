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

    getSkillColorStr: (level: number): string => {
        if (level <= 1) return '#c0c0c0'; // Brown
        if (level === 2) return '#29b6f6'; // Blue
        if (level === 3) return '#ab47bc'; // Purple
        return '#ffca28'; // Gold
    },

    getSkillColorHex: (level: number): number => {
        if (level <= 1) return 0xc0c0c0;
        if (level === 2) return 0x29b6f6;
        if (level === 3) return 0xab47bc;
        return 0xffca28;
    },

    getTierColorStr: (tier: number): string => {
        if (tier <= 1) return '#c0c0c0';
        if (tier === 2) return '#00aaff';
        if (tier === 3) return '#aa00ff';
        return '#ffd700';
    },

    getTierColorHex: (tier: number): number => {
        if (tier <= 1) return 0xc0c0c0;
        if (tier === 2) return 0x00aaff;
        if (tier === 3) return 0xaa00ff;
        return 0xffd700;
    },

    getStatInfo: (key: string): { e: string, n: string } => {
        if (!key) return { e: "❓", n: "Unknown" };
        const map: Record<string, { e: string, n: string }> = {
            maxHp: { e: "❤️", n: "Max HP" },
            hpRegen: { e: "🩹", n: "HP Regen" },
            lifeSteal: { e: "🧛", n: "Life Steal" },
            movementSpeed: { e: "💨", n: "MovementSpeed" },
            haste: { e: "⏳", n: "Haste" },
            meleeDamage: { e: "🗡️", n: "Melee Dmg" },
            rangedDamage: { e: "🏹", n: "Ranged Dmg" },
            magicDamage: { e: "🔥", n: "Magic Dmg" },
            engineering: { e: "🔧", n: "Engineering" },
            armor: { e: "🛡️", n: "Armor" },
            magicDefense: { e: "✨", n: "Magic Def" },
            defensePercent: { e: "🧱", n: "Defense %" },
            luck: { e: "🍀", n: "Luck" },
            harvesting: { e: "🌾", n: "Harvesting" },
            dodge: { e: "👻", n: "Dodge" },
            critChance: { e: "💥", n: "Crit Chance" },
            critMultiplier: { e: "✖️", n: "Crit Mult" },
            knockback: { e: "💢", n: "Knockback" },
            pierceCount: { e: "🏹", n: "Pierces" },
            bounceCount: { e: "🪃", n: "Bounces" },
            attackSpeedPercent: { e: "⚡", n: "Attack Speed" },
            xpGainPercent: { e: "🧠", n: "XP Gain" },
            damagePercent: { e: "💥", n: "Damage %" },
            projectileSpeedPercent: { e: "☄️", n: "Proj Speed" },
            range: { e: "📏", n: "Range" },
        };
        return map[key] || { e: "❓", n: key.charAt(0).toUpperCase() + key.slice(1) };
    },

    formatVal: (key: string, val: number): string => {
        if (!key) return `${Math.round(val)}`;
        const isPct = key.toLowerCase().includes('percent') || key === 'lifeSteal' || key === 'dodge' || key === 'critChance' || key === 'projectileBlockChance';

        // Cap visual percentages at 100% (1.0) so the UI doesn't look broken
        if (key === 'critChance' || key === 'dodge' || key === 'projectileBlockChance') {
            val = Math.min(1.0, val);
        }

        return isPct ? `${Math.round(val * 100)}%` : `${Math.round(val)}`;
    },

    formatEffectName: (str: string): string => {
        if (!str) return "";
        return str.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    },

    // >>> NEW: Synergy Resolver! 
    // Takes an array of raw IDs, counts duplicates, and follows the JSON nextLevelId chain!
    resolveSynergies: (rawIds: string[], dict: any): string[] => {
        if (!rawIds || rawIds.length === 0) return [];
        const counts: Record<string, number> = {};
        rawIds.forEach(id => {
            if (id) counts[id] = (counts[id] || 0) + 1;
        });

        const finalIds: string[] = [];
        for (const baseId in counts) {
            let currentId = baseId;
            const count = counts[baseId];

            for (let i = 1; i < count; i++) {
                // Find config (case-insensitive fallback just in case)
                let cfg = dict?.[currentId];
                if (!cfg && dict) {
                    const foundKey = Object.keys(dict).find(k => k.toLowerCase() === currentId.toLowerCase());
                    if (foundKey) cfg = dict[foundKey];
                }

                const nextId = cfg?.nextLevelId || cfg?.NextLevelId;
                if (nextId) {
                    currentId = nextId;
                }
            }
            finalIds.push(currentId);
        }
        return finalIds;
    },

    buildStatBlocks: (
        config: any,
        totalBaseStats: any = null,
        _rolledStats: any = null,
        rolledSkills: any = null,
        atlasConfigs: any = null,
        stackCount: number = 1
    ): TextBlock[] => {
        const blocks: TextBlock[] = [];
        let posLines: string[] = [];
        let negLines: string[] = [];
        let randomLines: string[] = [];
        let skillsLines: string[] = [];
        let traitBlocks: TextBlock[] = [];

        if (!config) return blocks;

        try {
            const cfgMelee = config.meleeDamage ?? config.MeleeDamage;
            const meleeDmg = totalBaseStats?.meleeDamage ?? totalBaseStats?.MeleeDamage ?? (cfgMelee ? cfgMelee * stackCount : undefined);

            const cfgRanged = config.rangedDamage ?? config.RangedDamage;
            const rangedDmg = totalBaseStats?.rangedDamage ?? totalBaseStats?.RangedDamage ?? (cfgRanged ? cfgRanged * stackCount : undefined);

            const cfgMagic = config.magicDamage ?? config.MagicDamage ?? config.elementalDamage ?? config.ElementalDamage;
            const magicDmg = totalBaseStats?.magicDamage ?? totalBaseStats?.MagicDamage ?? (cfgMagic ? cfgMagic * stackCount : undefined);
            const cooldown = config.cooldownSeconds ?? config.CooldownSeconds;
            const range = config.range ?? config.Range;
            const scaling = config.damageScaling ?? config.DamageScaling;
            const onHitEffects = config.applyEffectsOnHit ?? config.ApplyEffectsOnHit;
            const dynamicMods = config.dynamicModifiers ?? config.DynamicModifiers;
            const waveEndEffects = config.effectsAtWaveEnd ?? config.EffectsAtWaveEnd;
            const onPurchase = config.effectsOnPurchase ?? config.EffectsOnPurchase;
            const mechanics = config.mechanics ?? config.Mechanics;

            if (meleeDmg) posLines.push(`🗡️ Melee Dmg: ${Math.round(meleeDmg)}`);
            if (rangedDmg) posLines.push(`🏹 Ranged Dmg: ${Math.round(rangedDmg)}`);
            if (magicDmg) posLines.push(`🔥 Magic Dmg: ${Math.round(magicDmg)}`);
            if (cooldown) posLines.push(`⏱️ Cooldown: ${cooldown}s`); // Keep decimals for cooldowns (e.g., 1.5s)
            if (range) posLines.push(`📏 Range: ${Math.round(range)}`);

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

            const statSource = (totalBaseStats && Object.keys(totalBaseStats).length > 0)
                ? totalBaseStats
                : (config.statBonuses ?? config.StatBonuses);

            if (statSource) {
                Object.entries(statSource).forEach(([k, v]) => {
                    if (["meleeDamage", "MeleeDamage", "rangedDamage", "RangedDamage", "magicDamage", "MagicDamage"].includes(k)) return;
                    const num = totalBaseStats ? (v as number) : (v as number) * stackCount;
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

            // ====================================================================
            // >>> SYNERGIZE TRAITS <<<
            // Duplicate the base traits by stackCount to simulate combining them!
            // ====================================================================
            const traitMap = atlasConfigs?.traits ?? atlasConfigs?.Traits;
            const traits = config.traits ?? config.Traits ?? [];
            const rawTraits: string[] = [];
            for (let i = 0; i < stackCount; i++) rawTraits.push(...traits);
            const finalTraits = UIHelpers.resolveSynergies(rawTraits, traitMap);

            if (finalTraits.length > 0) {
                traitBlocks.push({ text: "[ Traits ]", color: "#ffb74d", isHeader: true });

                finalTraits.forEach((t: string) => {
                    let traitCfg = traitMap?.[t];
                    if (!traitCfg && traitMap) {
                        const foundKey = Object.keys(traitMap).find(k => k.toLowerCase() === t.toLowerCase());
                        if (foundKey) traitCfg = traitMap[foundKey];
                    }

                    if (traitCfg) {
                        const name = traitCfg.name ?? traitCfg.Name ?? t;
                        const desc = traitCfg.description ?? traitCfg.Description ?? "";
                        const isNeg = traitCfg.isNegative ?? traitCfg.IsNegative ?? false;

                        const line = desc ? `💠 ${name}\n   └ ${desc}` : `💠 ${name}`;
                        traitBlocks.push({ text: line, color: isNeg ? "#ef5350" : "#81c784" });
                    } else {
                        traitBlocks.push({ text: `💠 ${UIHelpers.formatEffectName(t)}`, color: "#81c784" });
                    }
                });
            }
            // ====================================================================
            // >>> SYNERGIZE SKILLS <<<
            // ====================================================================
            const skillMap = atlasConfigs?.skills ?? atlasConfigs?.Skills;

            // 1. Base Granted Skills (Multiply by item level to resolve synergy)
            const grantedSkills = config.grantedSkills ?? config.GrantedSkills ?? [];
            const rawGranted: string[] = [];
            for (let i = 0; i < stackCount; i++) {
                rawGranted.push(...grantedSkills.map((s: any) => typeof s === 'string' ? s : (s.configId ?? s.ConfigId)));
            }
            const finalGranted = UIHelpers.resolveSynergies(rawGranted, skillMap);

            // 2. Random Rolled Skills (The array is natively passed from the server)
            // >>> THE FIX: Filter out the base granted skills so they don't print twice! <<<
            const baseGrantedSet = new Set(grantedSkills.map((s: any) => typeof s === 'string' ? s : (s.configId ?? s.ConfigId)));

            const rawRolled = (rolledSkills || [])
                .map((s: any) => typeof s === 'string' ? s : (s.configId ?? s.ConfigId))
                .filter((id: string) => !baseGrantedSet.has(id)); // Removes the duplicates!

            const finalRolled = UIHelpers.resolveSynergies(rawRolled, skillMap);

            if (finalGranted.length > 0) {
                finalGranted.forEach(id => {
                    const s = skillMap?.[id];
                    skillsLines.push(`⭐ ${s ? (s.name ?? s.Name) : id}`);
                });
            }

            if (finalRolled.length > 0) {
                finalRolled.forEach(id => {
                    const s = skillMap?.[id];
                    skillsLines.push(`✨ ${s ? (s.name ?? s.Name) : id}`);
                });
            }

            // ====================================================================
            // >>> ASSEMBLE THE FINAL BLOCKS <<<
            // ====================================================================
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
            if (traitBlocks.length > 0) {
                blocks.push(...traitBlocks);
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
    private hideTimer?: Phaser.Time.TimerEvent;

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
        config: any, x: number, y: number, incomingLevel: number, atlasConfigs: any,
        totalBaseStats?: any, rolledStats?: any, rolledSkills?: any
    ) {
        if (!config) return;

        if (this.hideTimer) {
            this.hideTimer.remove();
            this.hideTimer = undefined;
        }

        try {
            this.dynamicTexts.forEach(t => t.destroy());
            this.dynamicTexts = [];

            const tier = config.tier ?? config.Tier ?? 1;
            const maxLevel = config.maxLevel ?? config.MaxLevel ?? 5;

            this.titleText.setText(`${config.name ?? config.Name ?? ''} (Tier ${tier} - Lv.${incomingLevel}/${maxLevel})`).setColor(UIHelpers.getTierColorStr(tier));

            // >>> THE FIX: We pass incomingLevel to buildStatBlocks so it can resolve synergies! <<<
            const blocks = UIHelpers.buildStatBlocks(config, totalBaseStats, rolledStats, rolledSkills, atlasConfigs, incomingLevel);

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

            this.setDepth(9999);
            this.setVisible(true);
        } catch (err) {
            console.error("Safely caught a Tooltip formatting error:", err);
        }
    }

    public updatePosition(x: number, y: number) {
        let targetX = x + 15;
        let targetY = y + 15;

        // X Boundary (Flip left if too far right)
        if (targetX + 264 > this.scene.scale.width) {
            targetX = x - 280;
        }
        // Y Boundary (Flip UP if it hits the bottom of the screen)
        if (targetY + this.currentHeight > this.scene.scale.height) {
            targetY = y - this.currentHeight - 5;
            if (targetY < 5) targetY = 5;
        }

        this.setPosition(targetX, targetY);
    }

    public hide() {
        this.hideTimer = this.scene.time.delayedCall(15, () => {
            this.setVisible(false);
        });
    }

    public showSkill(config: any, level: number, x: number, y: number, playerStats?: any) { // <<< FIX: Added playerStats to signature
        if (!config) return;
        if (this.hideTimer) { this.hideTimer.remove(); this.hideTimer = undefined; }

        try {
            this.dynamicTexts.forEach(t => t.destroy());
            this.dynamicTexts = [];

            const colorStr = UIHelpers.getSkillColorStr(level);
            this.titleText.setText(config.name ?? config.Name ?? "Unknown Skill").setColor(colorStr);

            let currentY = 38;
            const addLine = (text: string, color: string = '#ffffff') => {
                const t = this.scene.add.text(12, currentY, text, { fontFamily: UIHelpers.FONT, fontSize: '13px', color: color, wordWrap: { width: 240 }, resolution: 3 });
                this.add(t);
                this.dynamicTexts.push(t);
                currentY += t.displayHeight + 4;
            };

            // >>> MOBA HASTE MATH <<<
            const hasteVal = Math.max(0, playerStats?.haste || 0);
            const hasteMult = (100 + hasteVal) / 100;

            const rawCd = config.cooldownSeconds ?? config.CooldownSeconds;
            const rawCast = config.castTimeSeconds ?? config.CastTimeSeconds;
            const rad = config.radius ?? config.Radius;
            const dmg = config.baseDamage ?? config.BaseDamage;
            const effects = config.applyEffects ?? config.ApplyEffects;
            const root = config.stopMoving ?? config.StopMoving;

            if (rawCd) {
                const actualCd = (rawCd / hasteMult).toFixed(1);
                const cdStr = hasteMult > 1 ? `⏱️ Cooldown: ${actualCd}s (${rawCd}s base)` : `⏱️ Cooldown: ${rawCd}s`;
                addLine(cdStr, '#4fc3f7');
            }
            if (rawCast) {
                const actualCast = (rawCast / hasteMult).toFixed(1);
                const castStr = hasteMult > 1 ? `⏳ Cast Time: ${actualCast}s (${rawCast}s base)` : `⏳ Cast Time: ${rawCast}s`;
                addLine(castStr, '#4fc3f7');
            }

            if (dmg) addLine(`💥 Base Damage: ${Math.round(dmg)}`, '#ff8a65');
            if (rad) addLine(`📏 Radius/Range: ${Math.round(rad)}`, '#aed581');
            if (root) addLine(`🛑 Roots player while casting!`, '#ef5350');

            if (effects && effects.length > 0) {
                addLine(`[ Applied Effects ]`, '#ffd54f');
                effects.forEach((e: string) => addLine(`🧪 ${UIHelpers.formatEffectName(e)}`));
            }

            this.currentHeight = Math.max(80, currentY + 10);

            const colorHex = UIHelpers.getSkillColorHex(level);
            this.bg.clear().fillStyle(0x111317, 0.95).fillRoundedRect(0, 0, 264, this.currentHeight, 8)
                .lineStyle(2, colorHex, 1).strokeRoundedRect(0, 0, 264, this.currentHeight, 8);

            this.updatePosition(x, y);
            this.setDepth(9999).setVisible(true);
        } catch (e) {
            console.error("Skill tooltip error:", e);
        }
    }
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
        bg.fillRoundedRect(0, 0, 240, 640, 12); // Increased height to 640
        bg.lineStyle(2, 0x3a4454, 1);
        bg.strokeRoundedRect(0, 0, 240, 640, 12); // Increased height to 640

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
                const labelText = this.scene.add.text(15, 80 + (index * 21), `${info.e} ${info.n}`, {
                    fontFamily: UIHelpers.FONT, fontSize: '12px', color: '#aaaaaa', resolution: 3
                });
                const valueText = this.scene.add.text(220, 80 + (index * 21), '0', {
                    fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#ffffff', fontStyle: 'bold', resolution: 3
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
                if (numVal > 0) textObj.setColor('#00ff00');
                else if (numVal < 0) textObj.setColor('#ff4444');
                else textObj.setColor('#ffffff');
            }
        });
    }
}

// =========================================================================
// INVENTORY DISPLAY
// =========================================================================
export class InventoryDisplay extends Phaser.GameObjects.Container {
    private itemGrid: Phaser.GameObjects.Container;
    private itemScrollable: Phaser.GameObjects.Container;
    private weaponGrid: Phaser.GameObjects.Container;
    private tooltip: Tooltip;
    private atlasConfigs: any = null;
    private connection: HubConnection;

    private maxItemScroll: number = 0;
    private itemMaskGraphics: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene, x: number, y: number, tooltip: Tooltip, connection: HubConnection) {
        super(scene, x, y);
        this.setScrollFactor(0); // >>> FIX 1: Prevents the UI from moving with the map camera! <<<

        this.tooltip = tooltip;
        this.connection = connection;

        this.itemGrid = scene.add.container(0, 0);
        const itemTitle = scene.add.text(0, -25, 'Items', {
            fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#a0abbc', fontStyle: 'bold', resolution: 3
        });
        this.itemGrid.add(itemTitle);

        this.itemScrollable = scene.add.container(0, 0);
        this.itemGrid.add(this.itemScrollable);

        // >>> THE BULLETPROOF MASK SETUP <<<
        // 1. Create it in the scene (NOT in the container) so it never inherits weird scales
        this.itemMaskGraphics = scene.add.graphics();
        this.itemMaskGraphics.setScrollFactor(0); // Lock to screen
        this.itemMaskGraphics.setVisible(false); // Hide the white box

        // 2. Draw the rectangle EXACTLY ONCE at 0,0
        this.itemMaskGraphics.fillStyle(0xffffff);
        this.itemMaskGraphics.fillRect(0, 0, 395, 85);

        // 3. Apply it
        this.itemScrollable.setMask(this.itemMaskGraphics.createGeometryMask());

        this.weaponGrid = scene.add.container(390, 0);
        const weaponTitle = scene.add.text(0, -25, 'Weapons', {
            fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#a0abbc', fontStyle: 'bold', resolution: 3
        });
        this.weaponGrid.add(weaponTitle);

        this.add([this.itemGrid, this.weaponGrid]);
        scene.add.existing(this);
    }

    public updateLayout(availableWidth: number) {
        this.weaponGrid.setPosition(availableWidth - 180, -80);

        if (this.itemMaskGraphics) {
            // 1. Force the mask to match the exact scale of the UI container
            this.itemMaskGraphics.setScale(this.scaleX, this.scaleY);

            // 2. Position it, multiplying the offset by the scale so it always wraps perfectly
            this.itemMaskGraphics.setPosition(
                this.x - (10 * this.scaleX),
                this.y - (10 * this.scaleY)
            );
        }
    }

    public updateInventory(weapons: any[], items: any[], maxItemSlots: number, atlasConfigs: any) {
        this.atlasConfigs = atlasConfigs;
        this.itemScrollable.removeAll(true);
        this.weaponGrid.removeAll(true);

        const titleStyle = { fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#a0abbc', fontStyle: 'bold', resolution: 3 } as const;
        this.weaponGrid.add(this.scene.add.text(0, -25, 'Weapons', titleStyle));

        // Calculate rows and scroll limits based on dynamic trait cap!
        const totalItemSlots = Math.max(5, maxItemSlots, items?.length || 0);
        const rows = Math.ceil(totalItemSlots / 5);
        this.maxItemScroll = Math.max(0, (rows - 1) * 75);

        if (this.itemScrollable.y < -this.maxItemScroll) this.itemScrollable.y = -this.maxItemScroll;
        if (this.itemScrollable.y > 0) this.itemScrollable.y = 0;

        let updateThumb = () => { };

        // ---- Item slots ----
        for (let i = 0; i < totalItemSlots; i++) {
            const col = i % 5;
            const row = Math.floor(i / 5);
            const slotX = col * 75;
            const slotY = row * 75;

            const slotContainer = this.scene.add.container(slotX, slotY);
            this.itemScrollable.add(slotContainer);

            const slotBg = this.scene.add.graphics();
            slotBg.fillStyle(0x161920, 1);
            slotBg.fillRoundedRect(0, 0, 65, 65, 8);
            slotBg.lineStyle(2, 0x3a4454, 1);
            slotBg.strokeRoundedRect(0, 0, 65, 65, 8);
            slotContainer.add(slotBg);

            const itemData = items?.find((x: any) => (x.slotIndex ?? x.SlotIndex) === i);

            if (itemData) {
                const config = atlasConfigs?.items?.[itemData.configId || itemData.ConfigId] ?? null;
                const iLevel = itemData.level || itemData.Level || 1;
                const iTier = config?.tier ?? config?.Tier ?? 1;

                if (config) {
                    slotBg.lineStyle(2, UIHelpers.getTierColorHex(iTier), 1);
                    slotBg.strokeRoundedRect(0, 0, 65, 65, 8);
                }

                let icon: any;
                const tex = config?.textureKey ?? config?.TextureKey;
                if (tex && this.scene.textures.exists(tex)) {
                    icon = this.scene.add.sprite(32.5, 32.5, tex);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min(50 / icon.width, 50 / icon.height));
                } else {
                    icon = this.scene.add.rectangle(32.5, 32.5, 40, 40, 0x000000).setStrokeStyle(2, 0x00ff00);
                }
                slotContainer.add(icon);

                const hitbox = this.scene.add.rectangle(32.5, 32.5, 65, 65, 0x000000, 0)
                    .setInteractive({ useHandCursor: true })
                    .setScrollFactor(0);

                hitbox.on('wheel', (p: any, dx: number, dy: number, dz: number, event: any) => {
                    if (this.maxItemScroll > 0) {
                        this.itemScrollable.y -= dy * 0.5;
                        if (this.itemScrollable.y < -this.maxItemScroll) this.itemScrollable.y = -this.maxItemScroll;
                        if (this.itemScrollable.y > 0) this.itemScrollable.y = 0;
                        updateThumb();
                        event.stopPropagation();
                    }
                });

                if (config) {
                    hitbox.on('pointerover', (p: Phaser.Input.Pointer) => {
                        slotBg.lineStyle(2, 0xffffff, 1);
                        slotBg.strokeRoundedRect(0, 0, 65, 65, 8);
                        this.tooltip.show(config, p.x, p.y, iLevel, this.atlasConfigs, itemData.totalBaseStats ?? itemData.TotalBaseStats, itemData.rolledStats ?? itemData.RolledStats, itemData.itemSkills ?? itemData.ItemSkills);
                    });
                    hitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.updatePosition(p.x, p.y));
                    hitbox.on('pointerout', () => {
                        slotBg.lineStyle(2, UIHelpers.getTierColorHex(iTier), 1);
                        slotBg.strokeRoundedRect(0, 0, 65, 65, 8);
                        this.tooltip.hide();
                    });
                }
                slotContainer.add(hitbox);

                const iMax = config?.maxLevel ?? config?.MaxLevel ?? 5;
                const lvlTxt = this.scene.add.text(60, 60, `Lv.${iLevel}/${iMax}`, {
                    fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#ffffff', stroke: '#000', strokeThickness: 3, resolution: 3
                }).setOrigin(1, 1);
                slotContainer.add(lvlTxt);

                // Recycle Button
                const delBg = this.scene.add.circle(55, 10, 10, 0xd32f2f).setStrokeStyle(1, 0xffffff);
                const delTxt = this.scene.add.text(55, 10, '🗑️', { fontSize: '10px' }).setOrigin(0.5);
                const delHit = this.scene.add.circle(55, 10, 14, 0x000000, 0).setInteractive({ useHandCursor: true });
                delHit.on('pointerdown', () => this.connection.invoke("RecycleGear", false, itemData.slotIndex ?? itemData.SlotIndex));
                slotContainer.add([delBg, delTxt, delHit]);
            } else {
                // Empty slots must also support scrolling!
                const hitbox = this.scene.add.rectangle(32.5, 32.5, 65, 65, 0x000000, 0).setInteractive().setScrollFactor(0);
                hitbox.on('wheel', (p: any, dx: number, dy: number, dz: number, event: any) => {
                    if (this.maxItemScroll > 0) {
                        this.itemScrollable.y -= dy * 0.5;
                        if (this.itemScrollable.y < -this.maxItemScroll) this.itemScrollable.y = -this.maxItemScroll;
                        if (this.itemScrollable.y > 0) this.itemScrollable.y = 0;
                        updateThumb();
                        event.stopPropagation();
                    }
                });
                slotContainer.add(hitbox);
            }
        }

        // Optional Vertical Scroll Indicator for Items
        if (this.maxItemScroll > 0) {
            const scrollBg = this.scene.add.graphics();
            scrollBg.fillStyle(0x000000, 0.5);
            scrollBg.fillRoundedRect(375, 0, 4, 65, 2);
            this.itemGrid.add(scrollBg);

            const scrollThumb = this.scene.add.graphics();
            this.itemGrid.add(scrollThumb);

            const thumbHeight = Math.max(15, 65 * (65 / (rows * 75)));
            updateThumb = () => {
                scrollThumb.clear();
                scrollThumb.fillStyle(0x8892a0, 1);
                const progress = Math.abs(this.itemScrollable.y) / this.maxItemScroll;
                const thumbY = progress * (65 - thumbHeight);
                scrollThumb.fillRoundedRect(375, thumbY, 4, thumbHeight, 2);
            };
            updateThumb();
        }

        // ---- Weapon slots (SHRUNK TO MAX 2) ----
        for (let i = 0; i < 2; i++) {
            const col = i % 2;
            const row = Math.floor(i / 2);
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
                const config = atlasConfigs?.weapons?.[weaponData.configId] ?? null;
                const wLevel = weaponData.level || 1;
                const wTier = config?.tier ?? config?.Tier ?? 1;

                if (config) {
                    slotBg.lineStyle(2, UIHelpers.getTierColorHex(wTier), 1);
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
                    .setInteractive({ useHandCursor: true }).setScrollFactor(0);

                if (config) {
                    hitbox.on('pointerover', (p: Phaser.Input.Pointer) => {
                        slotBg.lineStyle(2, 0xffffff, 1);
                        slotBg.strokeRoundedRect(slotX, slotY, 65, 65, 8);
                        this.tooltip.show(config, p.x, p.y, wLevel, atlasConfigs, weaponData.totalBaseStats ?? weaponData.TotalBaseStats, weaponData.rolledStats ?? weaponData.RolledStats, weaponData.weaponSkills ?? weaponData.WeaponSkills);
                    });
                    hitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.updatePosition(p.x, p.y));
                    hitbox.on('pointerout', () => {
                        slotBg.lineStyle(2, UIHelpers.getTierColorHex(wTier), 1);
                        slotBg.strokeRoundedRect(slotX, slotY, 65, 65, 8);
                        this.tooltip.hide();
                    });
                }
                this.weaponGrid.add(hitbox);

                const wMax = config?.maxLevel ?? config?.MaxLevel ?? 5;
                const lvlTxt = this.scene.add.text(slotX + 60, slotY + 60, `Lv.${wLevel}/${wMax}`, {
                    fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#ffffff', stroke: '#000', strokeThickness: 3, resolution: 3
                }).setOrigin(1, 1);
                this.weaponGrid.add(lvlTxt);

                // Recycle Button (Weapons)
                const delBg = this.scene.add.circle(slotX + 55, slotY + 10, 10, 0xd32f2f).setStrokeStyle(1, 0xffffff);
                const delTxt = this.scene.add.text(slotX + 55, slotY + 10, '🗑️', { fontSize: '10px' }).setOrigin(0.5);
                const delHit = this.scene.add.circle(slotX + 55, slotY + 10, 14, 0x000000, 0).setInteractive({ useHandCursor: true });
                delHit.on('pointerdown', () => this.connection.invoke("RecycleGear", true, weaponData.slotIndex ?? weaponData.SlotIndex));
                this.weaponGrid.add([delBg, delTxt, delHit]);
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

        this.inventoryDisplay = new InventoryDisplay(scene, 0, 0, this.tooltip, connection); //       this.inventoryDisplay.setScrollFactor(0).setDepth(D + 1);
        this._elements.push(this.inventoryDisplay as any);

        this.shopCardsContainer = scene.add.container(0, 0).setScrollFactor(0).setDepth(D + 1);
        this.levelUpContainer = scene.add.container(0, 0).setScrollFactor(0).setDepth(D + 1);
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

        this._elements.forEach(el => {
            if (el === this.levelUpContainer) {
                el.setVisible(value && this.levelUpContainer.list.length > 0);
            } else if (el === this.shopCardsContainer || el === this.rerollButtonContainer) {
                el.setVisible(value && this.levelUpContainer.list.length === 0);
            } else {
                el.setVisible(value);
            }
        });
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
        this.statDisplay.setPosition(width - statsWidth, Math.max(20, (height - (640 * scale)) / 2));
        this.inventoryDisplay.setPosition(40 * scale, height - (90 * scale));

        const availableWidth = width - statsWidth - (40 * scale);
        this.inventoryDisplay.updateLayout(availableWidth / scale);

        const rawCardsWidth = 3 * 280;
        const rawCardsHeight = 480;
        const headerBottom = 100 * scale;
        const inventoryTop = height - (210 * scale);
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
            this.inventoryDisplay.updateInventory(uiData.weapons, uiData.ownedItems, uiData.maxItemSlots || 5, atlasConfigs);

            this.tooltip.hide();
            this.shopCardsContainer.removeAll(true);
            this.levelUpContainer.removeAll(true);

            // =========================================================
            // LEVEL UP CARDS RENDERER
            // =========================================================
            if (uiData.pendingLevelUps > 0) {
                this.shopCardsContainer.setVisible(false);
                this.rerollButtonContainer.setVisible(false);
                this.levelUpContainer.setVisible(this._visible);

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
                    hitbox.on('pointerdown', () => {
                        this.levelUpContainer.setVisible(false);
                        this.connection.invoke("SelectLevelUpStat", card.id || card.Id).catch((err: any) => console.error(err));
                    });
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
                    const amount = card.amount ?? card.Amount;
                    const info = UIHelpers.getStatInfo(statName);
                    const isPct = statName.toLowerCase().includes('percent') || statName === 'lifeSteal' || statName === 'dodge';
                    const valStr = isPct ? `+${Math.round(amount * 100)}%` : `+${amount}`;
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
            this.shopCardsContainer.setVisible(this._visible);
            this.rerollButtonContainer.setVisible(this._visible);

            this.headerText.setText(`Shop (Wave ${uiData.currentWave})`);
            this.headerText.setColor('#ffffff');
            const cost = uiData.currentRerollCost || 2;
            this.rerollText.setText(`REROLL 💰 ${cost}`);
            this.rerollText.setColor(uiData.gold >= cost ? '#ffffff' : '#ff4444');

            if (!uiData.currentShop) return;

            uiData.currentShop.forEach((item: any, index: number) => {
                const cardX = index * 280;

                let config: any = undefined;
                let isWeapon = false;

                const configId = item.configId ?? item.ConfigId;
                const isLocked = item.isLocked ?? item.IsLocked;

                if (atlasConfigs?.items?.[configId]) {
                    config = atlasConfigs.items[configId];
                } else if (atlasConfigs?.weapons?.[configId]) {
                    config = atlasConfigs.weapons[configId];
                    isWeapon = true;
                }

                const tier = config?.tier ?? config?.Tier ?? 1;
                const tierColor = isLocked ? 0x888888 : UIHelpers.getTierColorHex(tier);

                // -------------------------------------------------------------
                // 1. BASE BACKGROUND
                // -------------------------------------------------------------
                const cardBg = this.scene.add.graphics();
                cardBg.fillStyle(0x161920, 1);
                cardBg.fillRoundedRect(cardX, 0, 240, 480, 12);
                this.shopCardsContainer.add(cardBg);

                // -------------------------------------------------------------
                // 2. SCROLLABLE TEXT CONTAINER 
                // -------------------------------------------------------------
                const statsContainer = this.scene.add.container(0, 0);
                this.shopCardsContainer.add(statsContainer);

                const totalBaseStats = item.totalBaseStats ?? item.TotalBaseStats;
                const rolledStats = item.rolledStats ?? item.RolledStats;
                const rolledSkills = item.weaponSkills ?? item.WeaponSkills ?? item.itemSkills ?? item.ItemSkills;

                const blocks = UIHelpers.buildStatBlocks(
                    config,
                    totalBaseStats,
                    rolledStats,
                    rolledSkills,
                    atlasConfigs,
                    1
                );

                let currentY = 115;
                blocks.forEach(b => {
                    const t = this.scene.add.text(cardX + 15, currentY, b.text, {
                        fontFamily: UIHelpers.FONT,
                        fontSize: b.isHeader ? '13px' : '12px',
                        fontStyle: b.isHeader ? 'bold' : 'normal',
                        color: b.color,
                        lineSpacing: 1,
                        wordWrap: { width: 200 },
                        resolution: 3
                    }).setOrigin(0, 0);
                    statsContainer.add(t);
                    currentY += t.displayHeight + (b.isHeader ? 2 : 4);
                });

                const viewHeight = 260;
                const textHeight = currentY - 115;
                const maxScroll = Math.max(0, textHeight - viewHeight + 10);
                let updateScrollBar = () => { };

                if (maxScroll > 0) {
                    const scrollBarBg = this.scene.add.graphics();
                    scrollBarBg.fillStyle(0x000000, 0.5);
                    scrollBarBg.fillRoundedRect(cardX + 225, 115, 4, viewHeight, 2);
                    this.shopCardsContainer.add(scrollBarBg);

                    const scrollBar = this.scene.add.graphics();
                    this.shopCardsContainer.add(scrollBar);
                    const barHeight = Math.max(20, viewHeight * (viewHeight / textHeight));

                    updateScrollBar = () => {
                        scrollBar.clear();
                        scrollBar.fillStyle(0x8892a0, 1);
                        const progress = Math.abs(statsContainer.y) / maxScroll;
                        const barY = 115 + (progress * (viewHeight - barHeight));
                        scrollBar.fillRoundedRect(cardX + 225, barY, 4, barHeight, 2);
                    };
                    updateScrollBar();
                }

                // -------------------------------------------------------------
                // 3. SOLID BLOCKERS (The "Stencil-less Mask")
                // -------------------------------------------------------------
                const blockers = this.scene.add.graphics();
                blockers.fillStyle(0x161920, 1);

                blockers.fillRoundedRect(cardX, 0, 240, 115, 12);
                blockers.fillRect(cardX, 50, 240, 65);

                blockers.fillRoundedRect(cardX, 375, 240, 105, 12);
                blockers.fillRect(cardX, 375, 240, 60);

                this.shopCardsContainer.add(blockers);

                // -------------------------------------------------------------
                // 4. BORDER 
                // -------------------------------------------------------------
                const cardBorder = this.scene.add.graphics();
                cardBorder.lineStyle(2, tierColor, 1);
                cardBorder.strokeRoundedRect(cardX, 0, 240, 480, 12);
                this.shopCardsContainer.add(cardBorder);

                // -------------------------------------------------------------
                // 5. HEADER CONTENT 
                // -------------------------------------------------------------
                const tierTextStr = `Tier ${tier} ${isWeapon ? 'Weapon' : 'Item'}`;
                const tierTextObj = this.scene.add.text(cardX + 120, 20, tierTextStr, {
                    fontFamily: UIHelpers.FONT, fontSize: '12px', color: UIHelpers.getTierColorStr(tier), fontStyle: 'bold', resolution: 3
                }).setOrigin(0.5);

                const nameText = this.scene.add.text(cardX + 120, 40, item.name ?? item.Name ?? "Unknown", {
                    fontFamily: UIHelpers.FONT, fontSize: '20px', color: '#ffffff', fontStyle: 'bold', resolution: 3
                }).setOrigin(0.5);

                let icon: any = null;
                const tex = config?.textureKey ?? config?.TextureKey;
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
                // 6. FOOTER CONTENT & BUTTONS 
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
                buyHitbox.on('pointerover', (p: Phaser.Input.Pointer) => {
                    buyBtnBg.clear();
                    buyBtnBg.fillStyle(0x4caf50, 1);
                    buyBtnBg.fillRoundedRect(cardX + 30, 390, 180, 40, 20);

                    this.tooltip.show(config, p.x, p.y, 1, atlasConfigs, item.totalBaseStats ?? item.TotalBaseStats, rolledStats, rolledSkills);
                });
                buyHitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.updatePosition(p.x, p.y));
                buyHitbox.on('pointerout', () => {
                    buyBtnBg.clear();
                    buyBtnBg.fillStyle(0x2e7d32, 1);
                    buyBtnBg.fillRoundedRect(cardX + 30, 390, 180, 40, 20);
                    this.tooltip.hide();
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

                // >>> FIX: Added underscores to unused variables <<<
                cardHitbox.on('wheel', (_pointer: Phaser.Input.Pointer, _dx: number, dy: number, _dz: number, event: Phaser.Types.Input.EventData) => {
                    if (maxScroll > 0) {
                        statsContainer.y -= dy * 0.5;
                        if (statsContainer.y < -maxScroll) statsContainer.y = -maxScroll;
                        if (statsContainer.y > 0) statsContainer.y = 0;
                        updateScrollBar();
                        event.stopPropagation();
                    }
                });

                this.scene.input.setDraggable(cardHitbox);
                // >>> FIX: Added underscores to unused variables <<<
                cardHitbox.on('drag', (pointer: Phaser.Input.Pointer, _dragX: number, _dragY: number) => {
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

                    this.tooltip.show(config, p.x, p.y, 1, atlasConfigs, item.totalBaseStats ?? item.TotalBaseStats, rolledStats, rolledSkills);
                });

                cardHitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.updatePosition(p.x, p.y));
                cardHitbox.on('pointerout', () => {
                    cardBorder.lineStyle(2, tierColor, 1);
                    cardBorder.strokeRoundedRect(cardX, 0, 240, 480, 12);
                    this.tooltip.hide();
                });

                this.shopCardsContainer.add([cardHitbox, buyHitbox, lockHitbox]);
            });

        } catch (err) {
            console.error("Safely caught UI Update error to prevent game freeze:", err);
        }
    }
}


// =========================================================================
// SKILL ACTION BAR & TOOLTIP EXTENSION
// =========================================================================

export class SkillActionBar extends Phaser.GameObjects.Container {
    private slots: Map<string, { bg: Phaser.GameObjects.Graphics, icon: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle, cdOverlay: Phaser.GameObjects.Rectangle, border: Phaser.GameObjects.Graphics, text: Phaser.GameObjects.Text, hitbox: Phaser.GameObjects.Rectangle }> = new Map();
    private atlasConfigs: any = null;
    private tooltip: Tooltip;
    private playerStats: any = null;

    private activeSkillsData: { configId: string, currentCooldown: number }[] = [];

    constructor(scene: Phaser.Scene) {
        super(scene, 0, 0);

        // Private tooltip to prevent camera overlap bugs
        this.tooltip = new Tooltip(scene);

        this.setDepth(2000);
        this.setScrollFactor(0);
        scene.add.existing(this);
    }

    public updateLayout(width: number, height: number) {
        let scale = Math.min(width / 1280, height / 720);
        scale = Phaser.Math.Clamp(scale, 0.5, 3.0);

        this.setScale(scale);
        this.setPosition(width / 2, height - (35 * scale));
    }

    public updateSkills(skills: { configId: string, currentCooldown: number }[], atlasConfigs: any, playerStats?: any) {
        this.atlasConfigs = atlasConfigs;
        this.activeSkillsData = skills;
        this.playerStats = playerStats;

        const skillMap = atlasConfigs?.skills ?? atlasConfigs?.Skills;
        if (!skillMap) return;

        const currentIds = new Set(skills.map(s => s.configId));
        for (const [id, slot] of this.slots.entries()) {
            if (!currentIds.has(id)) {
                slot.bg.destroy(); slot.icon.destroy(); slot.cdOverlay.destroy();
                slot.border.destroy(); slot.text.destroy(); slot.hitbox.destroy();
                this.slots.delete(id);
            }
        }

        const slotSize = 48;
        const spacing = 10;
        const totalWidth = (skills.length * slotSize) + ((skills.length - 1) * spacing);
        const startX = -totalWidth / 2;

        skills.forEach((skillData, index) => {
            const configId = skillData.configId;
            const config = skillMap[configId];
            if (!config) return;

            const nameStr = config.name ?? config.Name ?? "";
            const lvlMatch = nameStr.match(/Lv\.(\d+)/i);
            const level = lvlMatch ? parseInt(lvlMatch[1]) : 1;
            const borderColorHex = UIHelpers.getSkillColorHex(level);

            const xPos = startX + (index * (slotSize + spacing)) + (slotSize / 2);
            let slot = this.slots.get(configId);

            if (!slot) {
                const bg = this.scene.add.graphics();
                bg.fillStyle(0x111317, 1.0).fillRoundedRect(xPos - slotSize / 2, -slotSize / 2, slotSize, slotSize, 6);

                let icon: any;
                const tex = config.textureKey || config.TextureKey;
                if (tex && this.scene.textures.exists(tex)) {
                    icon = this.scene.add.sprite(xPos, 0, tex);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setDisplaySize(slotSize, slotSize);
                } else {
                    icon = this.scene.add.rectangle(xPos, 0, slotSize, slotSize, 0x444444);
                }

                const cdOverlay = this.scene.add.rectangle(xPos, slotSize / 2, slotSize, slotSize, 0x000000, 0.75).setOrigin(0.5, 1);

                const border = this.scene.add.graphics();
                border.lineStyle(2, borderColorHex, 1).strokeRoundedRect(xPos - slotSize / 2, -slotSize / 2, slotSize, slotSize, 6);

                const lvlText = lvlMatch ? `L${level}` : "";
                const text = this.scene.add.text(xPos + slotSize / 2 - 2, slotSize / 2 - 2, lvlText, {
                    fontFamily: UIHelpers.FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 4
                }).setOrigin(1, 1);

                // >>> EXACT INVENTORY MATCH: Added useHandCursor and setScrollFactor(0) to fix the pointer coordinate bug <<<
                const hitbox = this.scene.add.rectangle(xPos, 0, slotSize, slotSize, 0x000000, 0)
                    .setInteractive({ useHandCursor: true })
                    .setScrollFactor(0);

                hitbox.on('pointerover', (p: Phaser.Input.Pointer) => {
                    border.clear().lineStyle(3, 0xffffff, 1).strokeRoundedRect(xPos - slotSize / 2, -slotSize / 2, slotSize, slotSize, 6);
                    // >>> 4. PASS STATS TO THE TOOLTIP <<<
                    this.tooltip.showSkill(config, level, p.x, p.y, this.playerStats);
                });

                hitbox.on('pointermove', (p: Phaser.Input.Pointer) => {
                    this.tooltip.updatePosition(p.x, p.y);
                });

                hitbox.on('pointerout', () => {
                    border.clear().lineStyle(2, borderColorHex, 1).strokeRoundedRect(xPos - slotSize / 2, -slotSize / 2, slotSize, slotSize, 6);
                    this.tooltip.hide();
                });

                this.add([bg, icon, cdOverlay, border, text, hitbox]);
                this.slots.set(configId, { bg, icon, cdOverlay, border, text, hitbox });
            } else {
                slot.bg.clear().fillStyle(0x111317, 1.0).fillRoundedRect(xPos - slotSize / 2, -slotSize / 2, slotSize, slotSize, 6);
                slot.icon.setX(xPos);
                slot.cdOverlay.setX(xPos);
                slot.border.clear().lineStyle(2, borderColorHex, 1).strokeRoundedRect(xPos - slotSize / 2, -slotSize / 2, slotSize, slotSize, 6);
                slot.text.setPosition(xPos + slotSize / 2 - 2, slotSize / 2 - 2);
                slot.hitbox.setX(xPos);
            }
        });
    }

    public smoothTickCooldowns(deltaSeconds: number) {
        const skillMap = this.atlasConfigs?.skills ?? this.atlasConfigs?.Skills;
        if (!skillMap) return;

        // >>> MOBA HASTE MATH <<<
        const hasteVal = Math.max(0, this.playerStats?.haste || 0);
        const hasteMult = (100 + hasteVal) / 100;

        this.activeSkillsData.forEach(skillData => {
            const slot = this.slots.get(skillData.configId);
            if (slot) {
                skillData.currentCooldown = Math.max(0, skillData.currentCooldown - deltaSeconds);
                const config = skillMap[skillData.configId];

                // >>> DIVIDE BY HASTE MULTIPLIER <<<
                const rawMaxCd = config?.cooldownSeconds ?? config?.CooldownSeconds ?? 1;
                const trueMaxCd = rawMaxCd / hasteMult;

                if (skillData.currentCooldown > 0) {
                    const pct = skillData.currentCooldown / trueMaxCd;
                    slot.cdOverlay.scaleY = Phaser.Math.Clamp(pct, 0, 1);
                    slot.cdOverlay.setVisible(true);

                    // >>> RESTORE THE TIMER TEXT <<<
                    // Shows the remaining seconds (e.g., "1.2")
                    slot.text.setText(skillData.currentCooldown.toFixed(1));

                } else {
                    slot.cdOverlay.setVisible(false);

                    // >>> RESTORE THE LEVEL TEXT WHEN READY <<<
                    const nameStr = config?.name ?? config?.Name ?? "";
                    const lvlMatch = nameStr.match(/Lv\.(\d+)/i);
                    const levelText = lvlMatch ? `L${lvlMatch[1]}` : "";
                    slot.text.setText(levelText);
                }
            }
        });
    }
}