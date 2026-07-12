import * as Phaser from 'phaser';
import { HubConnection } from '@microsoft/signalr';
import { AudioManager } from '../AudioManager';

// =========================================================================
// TYPES & KEYBOARD NAVIGATION INTERFACE
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
    // If true, renderers draw a thin divider line immediately above this block instead of at
    // a fixed position - used to put the divider right above the "Base Stats" section,
    // wherever that ends up landing (below On Hit / Scales, or right under the title if
    // there's no weapon-info content at all).
    dividerBefore?: boolean;
    // If set, renderers draw a small stat icon (see STAT_ICON_PATHS) to the left of this
    // line's text instead of no icon.
    iconKey?: string;
}

export interface FocusItem {
    onFocus: (p?: Phaser.Input.Pointer) => void;
    onBlur: () => void;
    onSelect: () => void;
}

// Config dictionaries are usually keyed with the exact casing the id was written with, but
// occasionally get looked up with different casing (e.g. a raw skill id vs. the dictionary's
// own key casing). This exact-then-case-insensitive-scan lookup was repeated 5 times across
// resolveSynergies/buildStatBlocks below with only the local variable names differing.
function findConfigCaseInsensitive(dict: any, id: string): any {
    if (!dict) return undefined;
    const direct = dict[id];
    if (direct) return direct;
    const foundKey = Object.keys(dict).find(k => k.toLowerCase() === id.toLowerCase());
    return foundKey ? dict[foundKey] : undefined;
}

// Shared layout routine for an array of TextBlocks (see buildStatBlocks): creates one Phaser
// Text (plus an icon Image if the block has one - see TextBlock.iconKey) per block, top-to-
// bottom, and reports where (if anywhere) a block asked for a divider (see
// TextBlock.dividerBefore) so the caller can position one without re-implementing this loop -
// used identically by Tooltip.show() and the Shop's big purchase card.
function layoutStatBlocks(
    scene: Phaser.Scene,
    blocks: TextBlock[],
    opts: {
        x: number, startY: number,
        headerFontSize: string, normalFontSize: string,
        wordWrapWidth: number, lineSpacing: number,
        headerGap: number, normalGap: number,
        dividerGapAbove: number, dividerGapBelow: number,
        iconSize?: number, iconGap?: number,
    }
): { texts: Phaser.GameObjects.Text[], icons: Phaser.GameObjects.Image[], endY: number, dividerYs: number[] } {
    const texts: Phaser.GameObjects.Text[] = [];
    const icons: Phaser.GameObjects.Image[] = [];
    let currentY = opts.startY;
    const dividerYs: number[] = [];
    const iconSize = opts.iconSize ?? 14;
    const iconGap = opts.iconGap ?? 4;

    blocks.forEach(b => {
        if (b.dividerBefore) {
            dividerYs.push(currentY + opts.dividerGapAbove);
            currentY += opts.dividerGapAbove + opts.dividerGapBelow;
        }

        let textX = opts.x;
        let rowHeight = 0;
        if (b.iconKey) {
            const texKey = ensureStatIconTexture(scene, b.iconKey);
            const icon = scene.add.image(opts.x + iconSize / 2, currentY + iconSize / 2, texKey);
            icon.setDisplaySize(iconSize, iconSize);
            icons.push(icon);
            textX = opts.x + iconSize + iconGap;
            rowHeight = iconSize;
        }

        const t = scene.add.text(textX, currentY, b.text, {
            fontFamily: UIHelpers.FONT,
            fontSize: b.isHeader ? opts.headerFontSize : opts.normalFontSize,
            fontStyle: b.isHeader ? 'bold' : 'normal',
            color: b.color,
            wordWrap: { width: opts.wordWrapWidth - (textX - opts.x) },
            lineSpacing: opts.lineSpacing,
            resolution: 3
        });
        texts.push(t);
        rowHeight = Math.max(rowHeight, t.displayHeight);
        currentY += rowHeight + (b.isHeader ? opts.headerGap : opts.normalGap);
    });

    return { texts, icons, endY: currentY, dividerYs };
}

// =========================================================================
// STAT ICONS (SVG-based, replacing the old emoji set)
// =========================================================================
// Inner SVG markup (no <svg> wrapper, no color) for each icon concept - kept deliberately
// simple (circles/lines/basic paths) so it reads clearly at the small sizes these render at.
// A few related stats intentionally share an icon (see STAT_ICON_ALIASES below) and are told
// apart by their badge color/label instead, same as real game UIs commonly do.
// IMPORTANT: LobbyUI.ts keeps its own copy of this exact object - if you add/change an icon
// here, mirror the change there so the lobby's collection cards stay visually identical.
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
    // Same shield silhouette as armor plus a reinforcement band - same "defense" family,
    // visually distinct rather than an identical reused icon.
    defensePercent: '<path d="M12 2 20 5v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5Z"/><path d="M7 10.5h10"/>',
    magicDefense: '<path d="M12 2 20 6.5v9L12 22 4 15.5v-9Z"/>',
    // A barrier/dome shape - distinct from magicDefense's hexagon, reads as an energy shield.
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
    // Non-Stats.json extras used for weapon-info lines, so the whole tooltip reads consistently.
    cooldown: '<circle cx="12" cy="13" r="8"/><path d="M12 13V8M9 2h6"/>',
    scaling: '<path d="M12 20V4M6 10l6-6 6 6"/>',
    onhit: '<path d="M9 2h6M10 2v5l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V2"/>',
    default: '<circle cx="12" cy="12" r="9"/><path d="M12 16h.01M12 8v4"/>',
};

// Every stat now has its own unique icon (see STAT_ICON_PATHS) - this stays as the mechanism
// for it, in case a genuinely intentional icon reuse comes up later, but is empty for now.
const STAT_ICON_ALIASES: Record<string, string> = {};

function getStatIconKey(key: string): string {
    return STAT_ICON_ALIASES[key] || key;
}

// Each icon's own fixed, characteristic color (e.g. a red heart, yellow lightning bolt) -
// independent of whether the line it's on is showing a positive or negative value. This is
// what the old emoji set had for free; a plain-shape icon needs it assigned explicitly or
// everything ends up the same 2-3 sign colors (green/red/gray) and loses its identity.
// IMPORTANT: LobbyUI.ts keeps its own copy of this exact object - keep them in sync.
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
    cooldown: '#ff8a65',
    scaling: '#ffca28',
    onhit: '#9ccc65',
    default: '#9e9e9e',
};

function getStatIconColor(key: string): string {
    return STAT_ICON_COLORS[getStatIconKey(key)] ?? STAT_ICON_COLORS['default'];
}

// Builds a self-contained SVG string for a stat icon, with its own fixed color baked directly
// in (see STAT_ICON_COLORS) - this is rasterized once into a texture, not tinted per-instance,
// since the color no longer varies by context the way the old sign-tinted version did.
function buildStatIconSvgString(key: string): string {
    const color = getStatIconColor(key);
    const inner = (STAT_ICON_PATHS[getStatIconKey(key)] ?? STAT_ICON_PATHS['default']).replace(/currentColor/g, color);
    // viewBox stays 0 0 24 24 (path coordinates unchanged) - width/height is bumped to 64 so
    // the browser rasterizes at higher pixel density. This only affects the one-time texture
    // generation per unique icon (cached forever after via ensureStatIconTexture), so it's a
    // free quality win: crisper edges when Phaser downscales it to the ~14-22px display size
    // these actually render at, with zero ongoing performance cost.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// Lazily registers (and caches) a Phaser texture for a stat icon, keyed by icon name so
// aliased stats (e.g. defensePercent -> armor) share one texture instead of duplicating it.
function ensureStatIconTexture(scene: Phaser.Scene, key: string): string {
    const texKey = `staticon_${getStatIconKey(key)}`;
    if (!scene.textures.exists(texKey)) {
        const svgStr = buildStatIconSvgString(key);
        const b64 = btoa(unescape(encodeURIComponent(svgStr)));
        scene.textures.addBase64(texKey, `data:image/svg+xml;base64,${b64}`);
    }
    return texKey;
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

    getStatInfo: (key: string): { iconKey: string, n: string } => {
        if (!key) return { iconKey: 'default', n: "Unknown" };
        const map: Record<string, string> = {
            maxHp: "Max HP",
            hpRegen: "HP Regen",
            lifeStealPercent: "Life Steal",
            damagePercent: "Damage %",
            meleeDamage: "Melee Damage",
            rangedDamage: "Ranged Damage",
            magicDamage: "Magic Damage",
            movementSpeed: "Movement Speed",
            range: "Range",
            haste: "Haste",
            engineering: "Engineering",
            armor: "Armor",
            magicDefense: "Magic Defense",
            defensePercent: "Defense %",
            dodge: "Dodge Chance",
            luck: "Luck",
            harvesting: "Harvesting",
            attackSpeedPercent: "Attack Speed %",
            xpGainPercent: "XP Gain %",
            projectileSpeedPercent: "Proj. Speed %",
            critChance: "Crit Chance",
            healPower: "Heal Power",
            shieldPower: "Shield Power",
            pickupRange: "Pickup Range"
        };
        return { iconKey: getStatIconKey(key), n: map[key] || key };
    },

    // A stat shows with a "%" only if it's one of the handful of genuinely percent/chance-based
    // stats (dodge, critChance, projectileBlockChance, or anything with "percent" in the name,
    // e.g. lifeStealPercent). healPower/shieldPower are NOT percent-displayed here - they're
    // plain flat numbers, same rule the lobby character card already uses.
    isPercentStat: (key: string): boolean => {
        if (!key) return false;
        const lower = key.toLowerCase();
        return lower.includes('percent') || key === 'dodge' || key === 'critChance' || key === 'projectileBlockChance';
    },

    formatVal: (key: string, val: number): string => {
        if (!key) return `${Math.round(val)}`;

        if (key === 'critChance' || key === 'dodge' || key === 'projectileBlockChance') {
            val = Math.min(1.0, val);
        }

        if (UIHelpers.isPercentStat(key)) return `${Math.round(val * 100)}%`;
        return `${Math.round(val)}`;
    },

    formatEffectName: (str: string): string => {
        if (!str) return "";
        return str.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    },

    // A skill config is "Immune" if it's meant to ignore the caster's outside power-scaling
    // stats entirely - haste (cooldown/cast time) and magicDamage/damagePercent (damage).
    // Single source of truth for the casing-insensitive read, used anywhere the client needs
    // to know this (tooltip preview, action-bar cooldown bar, etc).
    isImmune: (config: any): boolean => {
        return !!(config?.immune ?? config?.Immune);
    },

    resolveSynergies: (rawIds: string[], dict: any, isSkillMap: boolean = false): string[] => {
        if (!rawIds || rawIds.length === 0) return [];

        if (!isSkillMap) {
            // Legacy Trait Logic
            const counts: Record<string, number> = {};
            rawIds.forEach(id => {
                if (id) counts[id] = (counts[id] || 0) + 1;
            });

            const finalIds: string[] = [];
            for (const baseId in counts) {
                let currentId = baseId;
                const count = counts[baseId];

                for (let i = 1; i < count; i++) {
                    let cfg = findConfigCaseInsensitive(dict, currentId);

                    const nextId = cfg?.nextLevelId || cfg?.NextLevelId;
                    if (nextId) {
                        currentId = nextId;
                    }
                }
                finalIds.push(currentId);
            }
            return finalIds;
        } else {
            // New Auto-Chess Skill Logic (2x Tier 1 = 1x Tier 2)
            let currentIds = [...rawIds];
            let merged = true;

            while (merged) {
                merged = false;

                const familyMap: Record<string, Record<number, string[]>> = {};
                currentIds.forEach(id => {
                    let cfg = findConfigCaseInsensitive(dict, id);

                    const family = cfg?.skillFamily || cfg?.SkillFamily;
                    const tier = cfg?.tier || cfg?.Tier || 1;

                    if (family) {
                        if (!familyMap[family]) familyMap[family] = {};
                        if (!familyMap[family][tier]) familyMap[family][tier] = [];
                        familyMap[family][tier].push(id);
                    }
                });

                for (const family in familyMap) {
                    for (const tierStr in familyMap[family]) {
                        const tier = parseInt(tierStr);
                        const idsInTier = familyMap[family][tier];

                        // Check if these identical skills are allowed to auto-merge
                        let scales = false;
                        if (idsInTier.length >= 2) {
                            const sampleId = idsInTier[0];
                            let c = findConfigCaseInsensitive(dict, sampleId);
                            scales = c?.scalesWithGearLevel ?? c?.ScalesWithGearLevel ?? false;
                        }

                        // >>> FIX: Only merge if scales is true <<<
                        if (idsInTier.length >= 2 && scales) {
                            let nextTierId: string | null = null;
                            for (const dictKey in dict) {
                                const c = dict[dictKey];
                                const cFam = c?.skillFamily || c?.SkillFamily;
                                const cTier = c?.tier || c?.Tier || 1;

                                if (cFam === family && cTier === tier + 1) {
                                    nextTierId = dictKey;
                                    break;
                                }
                            }

                            if (nextTierId) {
                                const removeId = idsInTier[0];
                                currentIds.splice(currentIds.indexOf(removeId), 1);
                                currentIds.splice(currentIds.indexOf(removeId), 1);
                                currentIds.push(nextTierId);
                                merged = true;
                                break;
                            }
                        }
                    }
                    if (merged) break;
                }
            }

            // 2. HIGHEST TIER FILTER FOR UI
            // Hides the lower tiers from the UI while keeping them in memory.
            const finalFilteredIds: string[] = [];
            const familyMaxTiers: Record<string, { id: string, tier: number }> = {};
            const noFamilyIds: string[] = [];

            currentIds.forEach(id => {
                let cfg = findConfigCaseInsensitive(dict, id);

                const family = cfg?.skillFamily || cfg?.SkillFamily;
                const tier = cfg?.tier || cfg?.Tier || 1;

                if (family) {
                    if (!familyMaxTiers[family] || tier > familyMaxTiers[family].tier) {
                        familyMaxTiers[family] = { id, tier };
                    }
                } else {
                    if (!noFamilyIds.includes(id)) noFamilyIds.push(id);
                }
            });

            Object.values(familyMaxTiers).forEach(item => finalFilteredIds.push(item.id));
            finalFilteredIds.push(...noFamilyIds);

            return finalFilteredIds;
        }
    },

    buildStatBlocks: (
        config: any,
        totalBaseStats: any = null,
        rolledStats: any = null,
        rolledSkills: any = null,
        atlasConfigs: any = null,
        stackCount: number = 1
    ): TextBlock[] => {
        const blocks: TextBlock[] = [];
        let weaponInfoLines: TextBlock[] = [];
        let posLines: TextBlock[] = [];
        let negLines: TextBlock[] = [];
        let randomLines: TextBlock[] = [];
        let negRandomLines: TextBlock[] = [];
        let skillsLines: string[] = [];
        let traitBlocks: TextBlock[] = [];

        if (!config) return blocks;

        try {
            // Items always declare itemFamily; weapons never do (they use weaponFamily
            // inconsistently, when at all) - this is what tells apart "meleeDamage is this
            // weapon's own primary combat stat" from "meleeDamage is just one of this item's
            // granted stat bonuses, no different from maxHp or armor".
            const isWeapon = !(config.itemFamily ?? config.ItemFamily);

            const cfgMelee = config.meleeDamage ?? config.MeleeDamage;
            const meleeDmg = isWeapon ? (totalBaseStats?.meleeDamage ?? totalBaseStats?.MeleeDamage ?? (cfgMelee ? cfgMelee * stackCount : undefined)) : undefined;

            const cfgRanged = config.rangedDamage ?? config.RangedDamage;
            const rangedDmg = isWeapon ? (totalBaseStats?.rangedDamage ?? totalBaseStats?.RangedDamage ?? (cfgRanged ? cfgRanged * stackCount : undefined)) : undefined;

            const cfgMagic = config.magicDamage ?? config.MagicDamage ?? config.elementalDamage ?? config.ElementalDamage;
            const magicDmg = isWeapon ? (totalBaseStats?.magicDamage ?? totalBaseStats?.MagicDamage ?? (cfgMagic ? cfgMagic * stackCount : undefined)) : undefined;
            const cooldown = config.cooldownSeconds ?? config.CooldownSeconds;
            const range = config.range ?? config.Range;
            const scaling = config.damageScaling ?? config.DamageScaling;
            const onHitEffects = config.applyEffectsOnHit ?? config.ApplyEffectsOnHit;
            const dynamicMods = config.dynamicModifiers ?? config.DynamicModifiers;
            const waveEndEffects = config.effectsAtWaveEnd ?? config.EffectsAtWaveEnd;
            const onPurchase = config.effectsOnPurchase ?? config.EffectsOnPurchase;
            const mechanics = config.mechanics ?? config.Mechanics;
            const effectsMap = atlasConfigs?.effects ?? atlasConfigs?.Effects;

            // "Weapon info" - damage, cooldown, range, scaling, on-hit effects. Rendered first,
            // with no header of its own; the "Base Stats" section (and its divider) comes
            // right after this.
            if (meleeDmg) weaponInfoLines.push({ text: `Melee Dmg: ${Math.round(meleeDmg)}`, color: "#ffffff", iconKey: "meleeDamage" });
            if (rangedDmg) weaponInfoLines.push({ text: `Ranged Dmg: ${Math.round(rangedDmg)}`, color: "#ffffff", iconKey: "rangedDamage" });
            if (magicDmg) weaponInfoLines.push({ text: `Magic Dmg: ${Math.round(magicDmg)}`, color: "#ffffff", iconKey: "magicDamage" });
            if (cooldown) weaponInfoLines.push({ text: `Cooldown: ${cooldown}s`, color: "#ffffff", iconKey: "cooldown" });
            if (range) weaponInfoLines.push({ text: `Range: ${Math.round(range)}`, color: "#ffffff", iconKey: "range" });

            if (scaling) {
                const parts = Object.entries(scaling).map(([k, v]) => `${Math.round((v as number) * 100)}% ${UIHelpers.getStatInfo(k).n}`);
                if (parts.length) weaponInfoLines.push({ text: `Scales: ${parts.join(', ')}`, color: "#ffffff", iconKey: "scaling" });
            }

            if (onHitEffects?.length) {
                onHitEffects.forEach((e: string) => {
                    // Look up the effect's actual configured name (same pattern as traits/skills
                    // below) instead of just title-casing the raw config id.
                    const effectCfg = findConfigCaseInsensitive(effectsMap, e);
                    const name = effectCfg ? (effectCfg.name ?? effectCfg.Name ?? UIHelpers.formatEffectName(e)) : UIHelpers.formatEffectName(e);
                    weaponInfoLines.push({ text: `On Hit: ${name}`, color: "#ffffff", iconKey: "onhit" });
                });
            }

            if (mechanics) {
                Object.entries(mechanics).forEach(([k, v]) => {
                    const info = UIHelpers.getStatInfo(k);
                    posLines.push({ text: `${info.n}: ${UIHelpers.formatVal(k, (v as number) * stackCount)}`, color: "#ffffff", iconKey: info.iconKey });
                });
            }

            const damageStatKeys = ["meleeDamage", "MeleeDamage", "rangedDamage", "RangedDamage", "magicDamage", "MagicDamage"];
            // >>> FIX: totalBaseStats being non-empty used to be treated as "this has the bonus
            // stats we need to show" - but for weapons, totalBaseStats now only ever holds
            // meleeDamage/rangedDamage/magicDamage (their own damage identity), never the
            // weapon's statBonuses (movementSpeed, critChance, etc - those come from
            // config.statBonuses directly). So check whether totalBaseStats actually has
            // anything BEYOND the damage keys before trusting it as the bonus-stat source;
            // otherwise fall back to the config's own statBonuses, same as items already do.
            const totalBaseStatsHasBonuses = totalBaseStats && Object.keys(totalBaseStats).some(k => !damageStatKeys.includes(k));
            const statSource = totalBaseStatsHasBonuses ? totalBaseStats : (config.statBonuses ?? config.StatBonuses);

            if (statSource) {
                Object.entries(statSource).forEach(([k, v]) => {
                    // Only skip damage keys when the source is totalBaseStats AND this is a
                    // weapon (already shown above via meleeDmg/rangedDmg/magicDmg). Items never
                    // pull these out to the top - see isWeapon above - so an item's
                    // meleeDamage/rangedDamage/magicDamage bonus must still show here, same as
                    // any other stat bonus like maxHp or armor.
                    if (isWeapon && totalBaseStatsHasBonuses && damageStatKeys.includes(k)) return;
                    const num = totalBaseStatsHasBonuses ? (v as number) : (v as number) * stackCount;
                    const info = UIHelpers.getStatInfo(k);

                    if (num > 0) posLines.push({ text: `${info.n}: +${UIHelpers.formatVal(k, num)}`, color: "#ffffff", iconKey: info.iconKey });
                    else if (num < 0) negLines.push({ text: `${info.n}: ${UIHelpers.formatVal(k, num)}`, color: "#ef5350", iconKey: info.iconKey });
                });
            }

            if (dynamicMods) {
                dynamicMods.forEach((m: any) => {
                    const stat = m.targetStat ?? m.TargetStat ?? "";
                    const amt = (m.amount ?? m.Amount) * stackCount;
                    const thresh = m.conditionThreshold ?? m.ConditionThreshold;
                    const info = UIHelpers.getStatInfo(stat);
                    posLines.push({ text: `${info.n}: ${amt > 0 ? '+' : ''}${UIHelpers.formatVal(stat, amt)} per ${Math.round(thresh * 100)}% missing HP`, color: "#ffffff", iconKey: info.iconKey });
                });
            }

            if (waveEndEffects?.length) {
                waveEndEffects.forEach((e: any) => {
                    const stat = e.statName ?? e.StatName ?? "";
                    const amt = (e.amount ?? e.Amount) * stackCount;
                    const info = UIHelpers.getStatInfo(stat);
                    const block: TextBlock = { text: `Wave End: ${info.n} ${amt > 0 ? '+' : ''}${UIHelpers.formatVal(stat, amt)}`, color: amt < 0 ? "#ef5350" : "#ffffff", iconKey: info.iconKey };
                    if (amt < 0) negLines.push(block); else posLines.push(block);
                });
            }

            if (onPurchase?.length) onPurchase.forEach((e: string) => posLines.push({ text: `Grants: ${UIHelpers.formatEffectName(e)}`, color: "#ffffff", iconKey: "onhit" }));

            const traitMap = atlasConfigs?.traits ?? atlasConfigs?.Traits;
            const traits = config.traits ?? config.Traits ?? [];
            const rawTraits: string[] = [];
            for (let i = 0; i < stackCount; i++) rawTraits.push(...traits);
            const finalTraits = UIHelpers.resolveSynergies(rawTraits, traitMap, false);
            if (finalTraits.length > 0) {
                traitBlocks.push({ text: "[ Traits ]", color: "#ffb74d", isHeader: true });

                finalTraits.forEach((t: string) => {
                    let traitCfg = findConfigCaseInsensitive(traitMap, t);

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

            const skillMap = atlasConfigs?.skills ?? atlasConfigs?.Skills;
            const grantedSkillsRaw = config.grantedSkills ?? config.GrantedSkills ?? [];

            // Map out the base Skill Families so we can recognize them even after they upgrade their Tier
            const baseExactIds = new Set<string>();
            const baseFamilies = new Set<string>();

            grantedSkillsRaw.forEach((s: any) => {
                const id = typeof s === 'string' ? s : (s.configId ?? s.ConfigId);
                if (id) {
                    baseExactIds.add(id.toLowerCase());
                    const sCfg = skillMap?.[id];
                    const fam = sCfg?.skillFamily || sCfg?.SkillFamily;
                    if (fam) baseFamilies.add(fam);
                }
            });

            const finalGrantedDisplay: string[] = [];
            const finalRolledDisplay: string[] = [];

            // If the server provided live data for this specific item, it is the single source of truth.
            if (rolledSkills && rolledSkills.length > 0) {
                const gearSkillsRaw = rolledSkills.map((s: any) => typeof s === 'string' ? s : (s.configId ?? s.ConfigId));
                const finalGearSkills = UIHelpers.resolveSynergies(gearSkillsRaw, skillMap, true);

                finalGearSkills.forEach(id => {
                    const sCfg = skillMap?.[id];
                    const fam = sCfg?.skillFamily || sCfg?.SkillFamily;

                    // If it shares a family with a native skill, or exactly matches the ID, it's a native ⭐ skill.
                    if ((fam && baseFamilies.has(fam)) || baseExactIds.has(id.toLowerCase())) {
                        finalGrantedDisplay.push(id);
                    } else {
                        finalRolledDisplay.push(id); // Otherwise, it truly is a random bonus ✨ skill.
                    }
                });
            } else {
                // Fallback for static Config tooltips (e.g., hovering an item in a wiki/static menu)
                const rawGranted: string[] = [];
                for (let i = 0; i < stackCount; i++) {
                    rawGranted.push(...grantedSkillsRaw.map((s: any) => typeof s === 'string' ? s : (s.configId ?? s.ConfigId)));
                }
                finalGrantedDisplay.push(...UIHelpers.resolveSynergies(rawGranted, skillMap, true));
            }

            // Render final categories
            if (finalGrantedDisplay.length > 0) {
                finalGrantedDisplay.forEach(id => {
                    const s = skillMap?.[id];
                    const scales = (s?.scalesWithGearLevel || s?.ScalesWithGearLevel) ? " ⬆️" : "";
                    skillsLines.push(`⭐ ${s ? (s.name ?? s.Name) : id}${scales}`);
                });
            }

            if (finalRolledDisplay.length > 0) {
                finalRolledDisplay.forEach(id => {
                    const s = skillMap?.[id];
                    const scales = (s?.scalesWithGearLevel || s?.ScalesWithGearLevel) ? " ⬆️" : "";
                    skillsLines.push(`✨ ${s ? (s.name ?? s.Name) : id}${scales}`);
                });
            }

            if (rolledStats) {
                Object.entries(rolledStats).forEach(([k, v]) => {
                    const num = v as number;
                    if (!num) return;
                    const info = UIHelpers.getStatInfo(k);
                    if (num > 0) randomLines.push({ text: `${info.n}: +${UIHelpers.formatVal(k, num)}`, color: "#ffffff", iconKey: info.iconKey });
                    else negRandomLines.push({ text: `${info.n}: ${UIHelpers.formatVal(k, num)}`, color: "#ef5350", iconKey: info.iconKey });
                });
            }

            if (weaponInfoLines.length > 0) {
                blocks.push(...weaponInfoLines);
            }
            if (posLines.length > 0) {
                blocks.push({ text: "[ Base Stats ]", color: "#4fc3f7", isHeader: true, dividerBefore: true });
                blocks.push(...posLines);
            }
            if (negLines.length > 0) {
                blocks.push(...negLines);
            }
            if (randomLines.length > 0 || negRandomLines.length > 0) {
                blocks.push({ text: "[ Random Rolls ]", color: "#ffd54f", isHeader: true, dividerBefore: true });
                blocks.push(...randomLines);
                blocks.push(...negRandomLines);
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
    private dynamicIcons: Phaser.GameObjects.Image[] = [];
    private dynamicDividers: Phaser.GameObjects.Rectangle[] = [];
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

    // Creates a divider rectangle at the given y (same style everywhere it's used), adds it
    // to the container, and tracks it in dynamicDividers for cleanup on the next show/showSkill.
    private addDivider(y: number) {
        const d = this.scene.add.rectangle(12, y, 240, 2, 0x3a4454).setOrigin(0, 0.5);
        this.add(d);
        this.dynamicDividers.push(d);
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
            this.dynamicIcons.forEach(i => i.destroy());
            this.dynamicDividers.forEach(d => d.destroy());
            this.dynamicTexts = [];
            this.dynamicIcons = [];
            this.dynamicDividers = [];

            const tier = config.tier ?? config.Tier ?? 1;
            const maxLevel = config.maxLevel ?? config.MaxLevel ?? 5;

            this.titleText.setText(`${config.name ?? config.Name ?? ''} (Tier ${tier} - Lv.${incomingLevel}/${maxLevel})`).setColor(UIHelpers.getTierColorStr(tier));

            const blocks = UIHelpers.buildStatBlocks(config, totalBaseStats, rolledStats, rolledSkills, atlasConfigs, incomingLevel);

            const { texts, icons, endY, dividerYs } = layoutStatBlocks(this.scene, blocks, {
                x: 12, startY: 38,
                headerFontSize: '14px', normalFontSize: '13px',
                wordWrapWidth: 240, lineSpacing: 3,
                headerGap: 2, normalGap: 6,
                dividerGapAbove: 4, dividerGapBelow: 10,
            });
            texts.forEach(t => { this.add(t); this.dynamicTexts.push(t); });
            icons.forEach(i => { this.add(i); this.dynamicIcons.push(i); });
            dividerYs.forEach(y => this.addDivider(y));

            this.currentHeight = Math.max(80, endY + 10);

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

        if (targetX + 264 > this.scene.scale.width) {
            targetX = x - 280;
        }
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

    public showSkill(config: any, level: number, x: number, y: number, playerStats?: any) {
        if (!config) return;
        if (this.hideTimer) { this.hideTimer.remove(); this.hideTimer = undefined; }

        try {
            this.dynamicTexts.forEach(t => t.destroy());
            this.dynamicIcons.forEach(i => i.destroy());
            this.dynamicDividers.forEach(d => d.destroy());
            this.dynamicTexts = [];
            this.dynamicIcons = [];
            this.dynamicDividers = [];

            const colorStr = UIHelpers.getSkillColorStr(level);
            this.titleText.setText(config.name ?? config.Name ?? "Unknown Skill").setColor(colorStr);

            // Skill tooltips don't have a "Base Stats"/"Random Rolls" section to position a
            // divider against (see show() for that logic) - always just one, at its default
            // spot right under the title.
            this.addDivider(34);

            let currentY = 44;
            const addLine = (text: string, color: string = '#ffffff') => {
                const t = this.scene.add.text(12, currentY, text, { fontFamily: UIHelpers.FONT, fontSize: '13px', color: color, wordWrap: { width: 240 }, resolution: 3 });
                this.add(t);
                this.dynamicTexts.push(t);
                currentY += t.displayHeight + 4;
            };

            const hasteVal = Math.max(0, playerStats?.haste || 0);
            const isImmune = UIHelpers.isImmune(config);
            const hasteMult = isImmune ? 1 : (100 + hasteVal) / 100;


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
            if (isImmune) addLine(`🛡️ Immune to Haste & Damage Scaling`, '#b0bec5');

            if (dmg) addLine(`💥 Base Damage: ${Math.round(dmg)}`, '#ff8a65');
            if (rad) addLine(`📏 Radius/Range: ${Math.round(rad)}`, '#aed581');
            if (root) addLine(`🛑 Roots player while casting!`, '#ef5350');

            const family = config.skillFamily ?? config.SkillFamily;
            const scales = config.scalesWithGearLevel ?? config.ScalesWithGearLevel;

            if (family) addLine(`👪 Skill Family: ${family}`, '#b0bec5');
            if (scales) addLine(`⬆️ Upgrades automatically with gear level!`, '#81c784');

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
        bg.fillRoundedRect(0, 0, 240, 640, 12);
        bg.lineStyle(2, 0x3a4454, 1);
        bg.strokeRoundedRect(0, 0, 240, 640, 12);

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
                const rowY = 80 + (index * 21);

                const iconTexKey = ensureStatIconTexture(this.scene, info.iconKey);
                const icon = this.scene.add.image(15 + 7, rowY + 7, iconTexKey);
                icon.setDisplaySize(14, 14);

                const labelText = this.scene.add.text(15 + 18, rowY, info.n, {
                    fontFamily: UIHelpers.FONT, fontSize: '12px', color: '#aaaaaa', resolution: 3
                });
                const valueText = this.scene.add.text(220, rowY, '0', {
                    fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#ffffff', fontStyle: 'bold', resolution: 3
                }).setOrigin(1, 0);
                this.add([icon, labelText, valueText]);
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
// Item-slot grid sizing. Shrunk from the original 65/75 so 3 rows fit in the viewport
// before scrolling kicks in (was ~1 row). Shared between the constructor (viewport mask)
// and updateInventory (slot layout, scrollbar, scroll-into-view math) so they can't drift
// out of sync with each other.
const ITEM_SLOT_SIZE = 45;
const ITEM_SLOT_HALF = ITEM_SLOT_SIZE / 2;
const ITEM_CELL_SIZE = 52;
const ITEM_VIEWPORT_W = 395;
const ITEM_VISIBLE_ROWS = 3;
const ITEM_VIEWPORT_H = ITEM_CELL_SIZE * ITEM_VISIBLE_ROWS;

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
        this.setScrollFactor(0);

        this.tooltip = tooltip;
        this.connection = connection;

        this.itemGrid = scene.add.container(0, 0);
        const itemTitle = scene.add.text(0, -25, 'Items', {
            fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#a0abbc', fontStyle: 'bold', resolution: 3
        });
        this.itemGrid.add(itemTitle);

        this.itemScrollable = scene.add.container(0, 0);
        this.itemGrid.add(this.itemScrollable);

        this.itemMaskGraphics = scene.add.graphics();
        this.itemMaskGraphics.setScrollFactor(0);
        this.itemMaskGraphics.setVisible(false);

        this.itemMaskGraphics.fillStyle(0xffffff);
        this.itemMaskGraphics.fillRect(0, 0, ITEM_VIEWPORT_W, ITEM_VIEWPORT_H);

        this.itemScrollable.setMask(this.itemMaskGraphics.createGeometryMask());

        this.weaponGrid = scene.add.container(390, 0);
        this.add([this.itemGrid, this.weaponGrid]);
        scene.add.existing(this);
    }

    public updateLayout(availableWidth: number) {
        this.weaponGrid.setPosition(availableWidth - 180, -80);

        if (this.itemMaskGraphics) {
            this.itemMaskGraphics.setScale(this.scaleX, this.scaleY);
            this.itemMaskGraphics.setPosition(
                this.x - (10 * this.scaleX),
                this.y - (10 * this.scaleY)
            );
        }
    }

    public updateInventory(
        weapons: any[],
        items: any[],
        maxItemSlots: number,
        atlasConfigs: any,
        registerFocus?: (row: number, col: number, item: FocusItem) => void,
        setMouseFocus?: (row: number, col: number) => void
    ) {
        this.atlasConfigs = atlasConfigs;
        this.itemScrollable.removeAll(true);
        this.weaponGrid.removeAll(true);

        const titleStyle = { fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#a0abbc', fontStyle: 'bold', resolution: 3 } as const;
        this.weaponGrid.add(this.scene.add.text(0, -25, 'Weapons', titleStyle));

        const totalItemSlots = Math.max(5, maxItemSlots, items?.length || 0);
        const rows = Math.ceil(totalItemSlots / 5);
        this.maxItemScroll = Math.max(0, (rows - ITEM_VISIBLE_ROWS) * ITEM_CELL_SIZE);

        if (this.itemScrollable.y < -this.maxItemScroll) this.itemScrollable.y = -this.maxItemScroll;
        if (this.itemScrollable.y > 0) this.itemScrollable.y = 0;

        let updateThumb = () => { };

        // ---- ITEM SLOTS (Row 3) ----
        for (let i = 0; i < totalItemSlots; i++) {
            const col = i % 5;
            const row = Math.floor(i / 5);
            const slotX = col * ITEM_CELL_SIZE;
            const slotY = row * ITEM_CELL_SIZE;

            // CENTERED SLOT CONTAINER (Scales smoothly from its center)
            const slotContainer = this.scene.add.container(slotX + ITEM_SLOT_HALF, slotY + ITEM_SLOT_HALF);
            this.itemScrollable.add(slotContainer);

            const slotBg = this.scene.add.graphics();
            slotBg.fillStyle(0x161920, 1);
            slotBg.fillRoundedRect(-ITEM_SLOT_HALF, -ITEM_SLOT_HALF, ITEM_SLOT_SIZE, ITEM_SLOT_SIZE, 8);
            slotBg.lineStyle(2, 0x3a4454, 1);
            slotBg.strokeRoundedRect(-ITEM_SLOT_HALF, -ITEM_SLOT_HALF, ITEM_SLOT_SIZE, ITEM_SLOT_SIZE, 8);
            slotContainer.add(slotBg);

            const itemData = items?.find((x: any) => (x.slotIndex ?? x.SlotIndex) === i);
            const hitbox = this.scene.add.rectangle(0, 0, ITEM_SLOT_SIZE, ITEM_SLOT_SIZE, 0x000000, 0)
                .setInteractive({ useHandCursor: true }).setScrollFactor(0);

            if (itemData) {
                const config = atlasConfigs?.items?.[itemData.configId || itemData.ConfigId] ?? null;
                const iLevel = itemData.level || itemData.Level || 1;
                const iTier = config?.tier ?? config?.Tier ?? 1;

                if (config) {
                    slotBg.lineStyle(2, UIHelpers.getTierColorHex(iTier), 1);
                    slotBg.strokeRoundedRect(-ITEM_SLOT_HALF, -ITEM_SLOT_HALF, ITEM_SLOT_SIZE, ITEM_SLOT_SIZE, 8);
                }

                let icon: any;
                const tex = config?.textureKey ?? config?.TextureKey;
                if (tex && this.scene.textures.exists(tex)) {
                    icon = this.scene.add.sprite(0, 0, tex);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min(35 / icon.width, 35 / icon.height));
                } else {
                    icon = this.scene.add.rectangle(0, 0, 28, 28, 0x000000).setStrokeStyle(2, 0x00ff00);
                }
                slotContainer.add(icon);
                slotContainer.add(hitbox);

                const iMax = config?.maxLevel ?? config?.MaxLevel ?? 5;
                const lvlTxt = this.scene.add.text(19, 19, `Lv.${iLevel}/${iMax}`, {
                    fontFamily: UIHelpers.FONT, fontSize: '10px', color: '#ffffff', stroke: '#000', strokeThickness: 2, resolution: 3
                }).setOrigin(1, 1);
                slotContainer.add(lvlTxt);

                if (config) {
                    const focusItem: FocusItem = {
                        onFocus: (p?: Phaser.Input.Pointer) => {
                            AudioManager.getInstance().playUiSfx('ui_hover');
                            slotBg.clear();
                            slotBg.fillStyle(0x2a303a, 1);
                            slotBg.lineStyle(4, 0xffffff, 1);
                            slotBg.strokeRoundedRect(-ITEM_SLOT_HALF, -ITEM_SLOT_HALF, ITEM_SLOT_SIZE, ITEM_SLOT_SIZE, 8);

                            // POP THE WHOLE SLOT CONTAINER!
                            this.scene.tweens.add({ targets: slotContainer, scale: 1.15, duration: 100 });
                            slotContainer.setDepth(10); // Bring forward

                            const bx = p ? p.x : hitbox.getBounds().centerX;
                            const by = p ? p.y : hitbox.getBounds().centerY;
                            this.tooltip.show(config, bx, by, iLevel, this.atlasConfigs, itemData.totalBaseStats ?? itemData.TotalBaseStats, itemData.rolledStats ?? itemData.RolledStats, itemData.itemSkills ?? itemData.ItemSkills);

                            if (!p && this.maxItemScroll > 0) {
                                const targetY = slotContainer.y - ITEM_SLOT_HALF; // True top of slot
                                const visibleTop = Math.abs(this.itemScrollable.y);
                                const visibleBottom = visibleTop + ITEM_VIEWPORT_H;
                                if (targetY < visibleTop) this.itemScrollable.y = -targetY;
                                else if (targetY + ITEM_SLOT_SIZE > visibleBottom) this.itemScrollable.y = -(targetY + ITEM_SLOT_SIZE - ITEM_VIEWPORT_H);
                                if (this.itemScrollable.y < -this.maxItemScroll) this.itemScrollable.y = -this.maxItemScroll;
                                if (this.itemScrollable.y > 0) this.itemScrollable.y = 0;
                                updateThumb();
                            }
                        },
                        onBlur: () => {
                            slotBg.clear();
                            slotBg.fillStyle(0x161920, 1);
                            slotBg.lineStyle(2, UIHelpers.getTierColorHex(iTier), 1);
                            slotBg.strokeRoundedRect(-ITEM_SLOT_HALF, -ITEM_SLOT_HALF, ITEM_SLOT_SIZE, ITEM_SLOT_SIZE, 8);

                            this.scene.tweens.add({ targets: slotContainer, scale: 1.0, duration: 100 });
                            slotContainer.setDepth(0);

                            this.tooltip.hide();
                        },
                        onSelect: () => {
                            AudioManager.getInstance().playUiSfx('ui_recycle');
                            this.connection.invoke("RecycleGear", false, itemData.slotIndex ?? itemData.SlotIndex);
                        }
                    };

                    if (registerFocus) registerFocus(3, i, focusItem);
                    hitbox.on('pointerdown', () => focusItem.onSelect());
                    hitbox.on('pointerover', (p: Phaser.Input.Pointer) => { if (setMouseFocus) setMouseFocus(3, i); focusItem.onFocus(p); });
                    hitbox.on('pointerout', () => focusItem.onBlur());
                    hitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.updatePosition(p.x, p.y));
                }

                const delBg = this.scene.add.circle(15.5, -15.5, 7, 0xd32f2f).setStrokeStyle(1, 0xffffff);
                const delTxt = this.scene.add.text(15.5, -15.5, '🗑️', { fontSize: '8px' }).setOrigin(0.5);
                slotContainer.add([delBg, delTxt]);
            } else {
                slotContainer.add(hitbox);
                const focusItemEmpty: FocusItem = {
                    onFocus: (p?: Phaser.Input.Pointer) => {
                        slotBg.lineStyle(2, 0xffffff, 1);
                        slotBg.strokeRoundedRect(-ITEM_SLOT_HALF, -ITEM_SLOT_HALF, ITEM_SLOT_SIZE, ITEM_SLOT_SIZE, 8);
                        if (!p && this.maxItemScroll > 0) {
                            const targetY = slotContainer.y - ITEM_SLOT_HALF;
                            const visibleTop = Math.abs(this.itemScrollable.y);
                            const visibleBottom = visibleTop + ITEM_VIEWPORT_H;
                            if (targetY < visibleTop) this.itemScrollable.y = -targetY;
                            else if (targetY + ITEM_SLOT_SIZE > visibleBottom) this.itemScrollable.y = -(targetY + ITEM_SLOT_SIZE - ITEM_VIEWPORT_H);
                            if (this.itemScrollable.y < -this.maxItemScroll) this.itemScrollable.y = -this.maxItemScroll;
                            if (this.itemScrollable.y > 0) this.itemScrollable.y = 0;
                            updateThumb();
                        }
                    },
                    onBlur: () => {
                        slotBg.lineStyle(2, 0x3a4454, 1);
                        slotBg.strokeRoundedRect(-ITEM_SLOT_HALF, -ITEM_SLOT_HALF, ITEM_SLOT_SIZE, ITEM_SLOT_SIZE, 8);
                    },
                    onSelect: () => { }
                };
                if (registerFocus) registerFocus(3, i, focusItemEmpty);
                hitbox.on('pointerover', (p: Phaser.Input.Pointer) => { if (setMouseFocus) setMouseFocus(3, i); focusItemEmpty.onFocus(p); });
                hitbox.on('pointerout', () => focusItemEmpty.onBlur());
            }

            hitbox.on('wheel', (p: any, dx: number, dy: number, dz: number, event: any) => {
                if (this.maxItemScroll > 0) {
                    this.itemScrollable.y -= dy * 0.5;
                    if (this.itemScrollable.y < -this.maxItemScroll) this.itemScrollable.y = -this.maxItemScroll;
                    if (this.itemScrollable.y > 0) this.itemScrollable.y = 0;
                    updateThumb();
                    event.stopPropagation();
                }
            });
        }

        if (this.maxItemScroll > 0) {
            const scrollBg = this.scene.add.graphics();
            scrollBg.fillStyle(0x000000, 0.5);
            scrollBg.fillRoundedRect(375, 0, 4, ITEM_VIEWPORT_H, 2);
            this.itemGrid.add(scrollBg);

            const scrollThumb = this.scene.add.graphics();
            this.itemGrid.add(scrollThumb);

            const thumbHeight = Math.max(15, ITEM_VIEWPORT_H * (ITEM_VIEWPORT_H / (rows * ITEM_CELL_SIZE)));
            updateThumb = () => {
                scrollThumb.clear();
                scrollThumb.fillStyle(0x8892a0, 1);
                const progress = Math.abs(this.itemScrollable.y) / this.maxItemScroll;
                const thumbY = progress * (ITEM_VIEWPORT_H - thumbHeight);
                scrollThumb.fillRoundedRect(375, thumbY, 4, thumbHeight, 2);
            };
            updateThumb();
        }

        // ---- WEAPON SLOTS (Row 2) ----
        for (let i = 0; i < 2; i++) {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const slotX = col * 75;
            const slotY = row * 75;

            // CENTERED SLOT CONTAINER
            const weaponSlotContainer = this.scene.add.container(slotX + 32.5, slotY + 32.5);
            this.weaponGrid.add(weaponSlotContainer);

            const slotBg = this.scene.add.graphics();
            slotBg.fillStyle(0x161920, 1);
            slotBg.fillRoundedRect(-32.5, -32.5, 65, 65, 8);
            slotBg.lineStyle(2, 0x3a4454, 1);
            slotBg.strokeRoundedRect(-32.5, -32.5, 65, 65, 8);
            weaponSlotContainer.add(slotBg);

            const hitbox = this.scene.add.rectangle(0, 0, 65, 65, 0x000000, 0)
                .setInteractive({ useHandCursor: true }).setScrollFactor(0);

            if (weapons?.[i]) {
                const weaponData = weapons[i];
                const config = atlasConfigs?.weapons?.[weaponData.configId] ?? null;
                const wLevel = weaponData.level || 1;
                const wTier = config?.tier ?? config?.Tier ?? 1;

                if (config) {
                    slotBg.lineStyle(2, UIHelpers.getTierColorHex(wTier), 1);
                    slotBg.strokeRoundedRect(-32.5, -32.5, 65, 65, 8);
                }

                let icon: any;
                const tex = config?.textureKey ?? config?.TextureKey;
                if (tex && this.scene.textures.exists(tex)) {
                    icon = this.scene.add.sprite(0, 0, tex);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min(50 / icon.width, 50 / icon.height));
                } else {
                    icon = this.scene.add.rectangle(0, 0, 40, 40, 0x000000).setStrokeStyle(2, 0x00ff00);
                }
                weaponSlotContainer.add(icon);
                weaponSlotContainer.add(hitbox);

                if (config) {
                    const focusItem: FocusItem = {
                        onFocus: (p?: Phaser.Input.Pointer) => {
                            AudioManager.getInstance().playUiSfx('ui_hover');
                            slotBg.clear();
                            slotBg.fillStyle(0x2a303a, 1);
                            slotBg.lineStyle(4, 0xffffff, 1);
                            slotBg.strokeRoundedRect(-32.5, -32.5, 65, 65, 8);

                            // POP THE WHOLE WEAPON SLOT
                            this.scene.tweens.add({ targets: weaponSlotContainer, scale: 1.15, duration: 100, zIndex: 10 });

                            const bx = p ? p.x : hitbox.getBounds().centerX;
                            const by = p ? p.y : hitbox.getBounds().centerY;
                            this.tooltip.show(config, bx, by, wLevel, atlasConfigs, weaponData.totalBaseStats ?? weaponData.TotalBaseStats, weaponData.rolledStats ?? weaponData.RolledStats, weaponData.weaponSkills ?? weaponData.WeaponSkills);
                        },
                        onBlur: () => {
                            slotBg.clear();
                            slotBg.fillStyle(0x161920, 1);
                            slotBg.lineStyle(2, UIHelpers.getTierColorHex(wTier), 1);
                            slotBg.strokeRoundedRect(-32.5, -32.5, 65, 65, 8);

                            this.scene.tweens.add({ targets: weaponSlotContainer, scale: 1.0, duration: 100, zIndex: 0 });

                            this.tooltip.hide();
                        },
                        onSelect: () => {
                            AudioManager.getInstance().playUiSfx('ui_recycle');
                            this.connection.invoke("RecycleGear", true, weaponData.slotIndex ?? weaponData.SlotIndex);
                        }
                    };
                    if (registerFocus) registerFocus(2, i, focusItem);
                    hitbox.on('pointerdown', () => focusItem.onSelect());

                    hitbox.on('pointerover', (p: Phaser.Input.Pointer) => { if (setMouseFocus) setMouseFocus(2, i); focusItem.onFocus(p); });
                    hitbox.on('pointerout', () => focusItem.onBlur());
                    hitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.updatePosition(p.x, p.y));
                }

                const wMax = config?.maxLevel ?? config?.MaxLevel ?? 5;
                const lvlTxt = this.scene.add.text(27.5, 27.5, `Lv.${wLevel}/${wMax}`, {
                    fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#ffffff', stroke: '#000', strokeThickness: 3, resolution: 3
                }).setOrigin(1, 1);
                weaponSlotContainer.add(lvlTxt);

                const delBg = this.scene.add.circle(22.5, -22.5, 10, 0xd32f2f).setStrokeStyle(1, 0xffffff);
                const delTxt = this.scene.add.text(22.5, -22.5, '🗑️', { fontSize: '10px' }).setOrigin(0.5);
                weaponSlotContainer.add([delBg, delTxt]);
            } else {
                weaponSlotContainer.add(hitbox);
                const focusItemEmpty: FocusItem = {
                    onFocus: () => { slotBg.lineStyle(2, 0xffffff, 1); slotBg.strokeRoundedRect(-32.5, -32.5, 65, 65, 8); },
                    onBlur: () => { slotBg.lineStyle(2, 0x3a4454, 1); slotBg.strokeRoundedRect(-32.5, -32.5, 65, 65, 8); },
                    onSelect: () => { }
                };
                if (registerFocus) registerFocus(2, i, focusItemEmpty);
                hitbox.on('pointerover', (p: Phaser.Input.Pointer) => { if (setMouseFocus) setMouseFocus(2, i); focusItemEmpty.onFocus(); });
                hitbox.on('pointerout', () => focusItemEmpty.onBlur());
            }
        }
    }
}

// =========================================================================
// MAIN SHOP UI (WITH KEYBOARD NAVIGATION)
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

    private focusGrid: FocusItem[][] = [];
    private focusRow: number = 0;
    private focusCol: number = 0;
    private isKeyboardNavActive: boolean = false;

    private currentGold: number = 0;
    private currentWeapons: any[] = [];
    private currentItems: any[] = [];
    private maxItemSlots: number = 5;

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

        rerollHitbox.on('pointerdown', () => this.connection.invoke("RerollShop").catch((err: any) => console.error(err)));
        rerollHitbox.on('pointerover', () => {
            this.setMouseFocus(1, 0);
            rerollBg.clear();
            rerollBg.fillStyle(0xd84315, 1);
            rerollBg.fillRoundedRect(-80, -22.5, 160, 45, 8);
        });
        rerollHitbox.on('pointerout', () => {
            if (this.focusGrid[1]?.[0]) this.focusGrid[1][0].onBlur();
        });

        this.rerollButtonContainer.add([rerollBg, this.rerollText, rerollHitbox]);
        this._elements.push(this.rerollButtonContainer);

        this.tooltip = new Tooltip(scene);

        this.statDisplay = new StatDisplay(scene, 0, 0);
        this.statDisplay.setScrollFactor(0).setDepth(D + 1);
        this._elements.push(this.statDisplay as any);

        this.inventoryDisplay = new InventoryDisplay(scene, 0, 0, this.tooltip, connection);
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

        scene.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
            if (document.activeElement?.id === 'chat-input' || document.activeElement?.id === 'lobby-chat-input') return;
            if (!this._visible) return;

            let dr = 0, dc = 0;
            if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') dr = -1;
            else if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') dr = 1;
            else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') dc = -1;
            else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') dc = 1;
            else if (e.key === ' ' || e.key === 'Enter') {
                if (this.focusGrid[this.focusRow]?.[this.focusCol]) {
                    this.focusGrid[this.focusRow][this.focusCol].onSelect();
                }
                e.preventDefault();
                return;
            }

            if (dr !== 0 || dc !== 0) {
                if (!this.isKeyboardNavActive) {
                    this.isKeyboardNavActive = true;
                    if (this.focusGrid[this.focusRow]?.[this.focusCol]) {
                        this.focusGrid[this.focusRow][this.focusCol].onFocus();
                    } else {
                        this.moveFocus(0, 1);
                    }
                } else {
                    this.moveFocus(dr, dc);
                }
                e.preventDefault();
            }
        });
    }

    get visible(): boolean { return this._visible; }

    public setMouseFocus(row: number, col: number) {
        if (this.isKeyboardNavActive) {
            if (this.focusGrid[this.focusRow]?.[this.focusCol]) {
                this.focusGrid[this.focusRow][this.focusCol].onBlur();
            }
            this.isKeyboardNavActive = false;
        }
        this.focusRow = row;
        this.focusCol = col;
    }

    private registerFocus(row: number, col: number, item: FocusItem) {
        if (!this.focusGrid[row]) this.focusGrid[row] = [];
        this.focusGrid[row][col] = item;
    }

    private moveFocus(dr: number, dc: number) {
        if (this.focusGrid.length === 0) return;

        if (this.focusGrid[this.focusRow]?.[this.focusCol]) {
            this.focusGrid[this.focusRow][this.focusCol].onBlur();
        }

        this.focusRow += dr;
        if (this.focusRow < 0) this.focusRow = this.focusGrid.length - 1;
        if (this.focusRow >= this.focusGrid.length) this.focusRow = 0;

        let rowSafeguard = 0;
        while ((!this.focusGrid[this.focusRow] || this.focusGrid[this.focusRow].length === 0) && rowSafeguard < 10) {
            this.focusRow += (dr === 0 ? 1 : dr);
            if (this.focusRow < 0) this.focusRow = this.focusGrid.length - 1;
            if (this.focusRow >= this.focusGrid.length) this.focusRow = 0;
            rowSafeguard++;
        }

        if (dc !== 0 || !this.focusGrid[this.focusRow][this.focusCol]) {
            const currentRow = this.focusGrid[this.focusRow];
            if (dr !== 0 && dc === 0) {
                if (!currentRow[this.focusCol]) {
                    let closestCol = 0;
                    for (let i = 0; i <= this.focusCol; i++) {
                        if (currentRow[i]) closestCol = i;
                    }
                    this.focusCol = closestCol;
                }
            } else {
                this.focusCol += dc;
                const maxCols = currentRow.length;
                if (this.focusCol < 0) this.focusCol = maxCols - 1;
                if (this.focusCol >= maxCols) this.focusCol = 0;

                let colSafeguard = 0;
                while (!currentRow[this.focusCol] && colSafeguard < 20) {
                    this.focusCol += (dc === 0 ? 1 : dc);
                    if (this.focusCol < 0) this.focusCol = maxCols - 1;
                    if (this.focusCol >= maxCols) this.focusCol = 0;
                    colSafeguard++;
                }
            }
        }

        if (this.focusGrid[this.focusRow]?.[this.focusCol]) {
            this.focusGrid[this.focusRow][this.focusCol].onFocus();
        }
    }

    public updateJustStats(statsPayload: any, level: number) {
        if (this.statDisplay) {
            this.statDisplay.updateStats(statsPayload, level);
        }
    }

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
            if (this.isKeyboardNavActive && this.focusGrid[this.focusRow]?.[this.focusCol]) {
                this.focusGrid[this.focusRow][this.focusCol].onBlur();
            }
            this.focusGrid = [];

            this.statDisplay.updateStats(uiData.stats, uiData.level || 1);

            this.inventoryDisplay.updateInventory(uiData.weapons, uiData.ownedItems, uiData.maxItemSlots || 5, atlasConfigs,
                (r, c, item) => this.registerFocus(r, c, item),
                (r, c) => this.setMouseFocus(r, c)
            );

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
                    const cardXOffset = index * 280;

                    // CENTERED CARD CONTAINER
                    const singleCardContainer = this.scene.add.container(cardXOffset + 120, 160);
                    this.levelUpContainer.add(singleCardContainer);

                    const bgGraphics = this.scene.add.graphics();
                    bgGraphics.fillStyle(0x161920, 1);
                    bgGraphics.fillRoundedRect(-120, -160, 240, 320, 12);
                    bgGraphics.lineStyle(2, UIHelpers.getTierColorHex(card.tier || card.Tier || 1), 1);
                    bgGraphics.strokeRoundedRect(-120, -160, 240, 320, 12);

                    const hitbox = this.scene.add.rectangle(0, 0, 240, 320, 0x000000, 0)
                        .setScrollFactor(0).setInteractive({ useHandCursor: true });

                    const focusItem: FocusItem = {
                        onFocus: () => {
                            AudioManager.getInstance().playUiSfx('ui_hover');
                            bgGraphics.clear();
                            bgGraphics.fillStyle(0x161920, 1);
                            bgGraphics.fillRoundedRect(-120, -160, 240, 320, 12);
                            bgGraphics.lineStyle(5, 0xffffff, 1);
                            bgGraphics.strokeRoundedRect(-120, -160, 240, 320, 12);

                            this.scene.tweens.add({ targets: singleCardContainer, scale: 1.05, duration: 100 });
                        },
                        onBlur: () => {
                            bgGraphics.clear();
                            bgGraphics.fillStyle(0x161920, 1);
                            bgGraphics.fillRoundedRect(-120, -160, 240, 320, 12);
                            bgGraphics.lineStyle(2, UIHelpers.getTierColorHex(card.tier || card.Tier || 1), 1);
                            bgGraphics.strokeRoundedRect(-120, -160, 240, 320, 12);

                            this.scene.tweens.add({ targets: singleCardContainer, scale: 1.0, duration: 100 });
                        },
                        onSelect: () => {
                            // >>> CHANGED: Play a distinct level up sound instead of ui_buy
                            AudioManager.getInstance().playUiSfx('ui_levelup');
                            this.levelUpContainer.setVisible(false);
                            this.connection.invoke("SelectLevelUpStat", card.id || card.Id).catch((err: any) => console.error(err));
                        }
                    };
                    this.registerFocus(0, index, focusItem);

                    hitbox.on('pointerdown', () => focusItem.onSelect());
                    hitbox.on('pointerover', () => { this.setMouseFocus(0, index); focusItem.onFocus(); });
                    hitbox.on('pointerout', () => focusItem.onBlur());

                    const nameText = this.scene.add.text(0, -110, card.name || card.Name, {
                        fontFamily: UIHelpers.FONT, fontSize: '22px', color: '#fff', fontStyle: 'bold', resolution: 3
                    }).setOrigin(0.5);
                    const tierText = this.scene.add.text(0, -80, `Tier ${card.tier || card.Tier || 1}`, {
                        fontFamily: UIHelpers.FONT, fontSize: '14px', color: UIHelpers.getTierColorStr(card.tier || card.Tier || 1), resolution: 3
                    }).setOrigin(0.5);

                    const statName = card.statName || card.StatName || "";
                    const amount = card.amount ?? card.Amount;
                    const info = UIHelpers.getStatInfo(statName);
                    const isPct = UIHelpers.isPercentStat(statName);
                    const valStr = isPct ? `+${UIHelpers.formatVal(statName, amount)}` : `+${amount}`;

                    const statIcon = this.scene.add.image(0, -34, ensureStatIconTexture(this.scene, info.iconKey));
                    statIcon.setDisplaySize(22, 22);

                    const statText = this.scene.add.text(0, 0, `${info.n}:\n${valStr}`, {
                        fontFamily: UIHelpers.FONT, fontSize: '20px', color: '#00ff00', fontStyle: 'bold', align: 'center', resolution: 3
                    }).setOrigin(0.5);

                    singleCardContainer.add([bgGraphics, nameText, tierText, statIcon, statText, hitbox]);
                });

                this.safelyReapplyKeyboardFocus();
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

            this.registerFocus(1, 0, {
                onFocus: () => {
                    const rBg = this.rerollButtonContainer.list[0] as Phaser.GameObjects.Graphics;
                    rBg.clear(); rBg.fillStyle(0xd84315, 1); rBg.fillRoundedRect(-80, -22.5, 160, 45, 8);
                },
                onBlur: () => {
                    const rBg = this.rerollButtonContainer.list[0] as Phaser.GameObjects.Graphics;
                    rBg.clear(); rBg.fillStyle(0x1a1e24, 1); rBg.fillRoundedRect(-80, -22.5, 160, 45, 8);
                    rBg.lineStyle(2, 0xd84315, 1); rBg.strokeRoundedRect(-80, -22.5, 160, 45, 8);
                },
                onSelect: () => this.connection.invoke("RerollShop").catch((err: any) => console.error(err))
            });

            if (!uiData.currentShop) return;

            uiData.currentShop.forEach((item: any, index: number) => {
                const cardXOffset = index * 280;

                // CENTERED CARD CONTAINER
                const singleCardContainer = this.scene.add.container(cardXOffset + 120, 240);
                this.shopCardsContainer.add(singleCardContainer);

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

                let darkBgColor = 0x161920;
                if (!isLocked) {
                    if (tier === 1) darkBgColor = 0x222428;
                    else if (tier === 2) darkBgColor = 0x132233;
                    else if (tier === 3) darkBgColor = 0x241233;
                    else if (tier >= 4) darkBgColor = 0x332812;
                }

                // 1. BASE BACKGROUND
                const cardBg = this.scene.add.graphics();
                cardBg.fillStyle(darkBgColor, 1);
                cardBg.fillRoundedRect(-120, -240, 240, 480, 12);
                singleCardContainer.add(cardBg);

                // 2. SCROLLABLE TEXT CONTAINER 
                const statsContainer = this.scene.add.container(0, 0);
                singleCardContainer.add(statsContainer);

                const totalBaseStats = item.totalBaseStats ?? item.TotalBaseStats;
                const rolledStats = item.rolledStats ?? item.RolledStats;
                const rolledSkills = item.weaponSkills ?? item.WeaponSkills ?? item.itemSkills ?? item.ItemSkills;

                const blocks = UIHelpers.buildStatBlocks(config, totalBaseStats, rolledStats, rolledSkills, atlasConfigs, 1);

                const { texts, icons, endY, dividerYs } = layoutStatBlocks(this.scene, blocks, {
                    x: -105, startY: -108,
                    headerFontSize: '13px', normalFontSize: '12px',
                    wordWrapWidth: 200, lineSpacing: 1,
                    headerGap: 2, normalGap: 4,
                    dividerGapAbove: 2, dividerGapBelow: 6,
                });
                texts.forEach(t => statsContainer.add(t));
                icons.forEach(i => statsContainer.add(i));
                // Lives inside statsContainer (not singleCardContainer) so it scrolls together
                // with the text it's marking the boundary of - a divider that stayed at a fixed
                // screen position while the content scrolled past it would drift out of
                // alignment with the section it's marking the moment the user scrolled at all.
                dividerYs.forEach(y => {
                    const sectionDivider = this.scene.add.rectangle(0, y, 200, 2, 0x3a4454).setOrigin(0.5);
                    statsContainer.add(sectionDivider);
                });
                const currentY = endY;

                const viewHeight = 250;
                const textHeight = currentY - (-108);
                const maxScroll = Math.max(0, textHeight - viewHeight + 10);
                let updateScrollBar = () => { };

                if (maxScroll > 0) {
                    const scrollBarBg = this.scene.add.graphics();
                    scrollBarBg.fillStyle(0x000000, 0.5);
                    scrollBarBg.fillRoundedRect(105, -108, 4, viewHeight, 2);
                    singleCardContainer.add(scrollBarBg);

                    const scrollBar = this.scene.add.graphics();
                    singleCardContainer.add(scrollBar);
                    const barHeight = Math.max(20, viewHeight * (viewHeight / textHeight));

                    updateScrollBar = () => {
                        scrollBar.clear();
                        scrollBar.fillStyle(0x8892a0, 1);
                        const progress = Math.abs(statsContainer.y) / maxScroll;
                        const barY = -108 + (progress * (viewHeight - barHeight));
                        scrollBar.fillRoundedRect(105, barY, 4, barHeight, 2);
                    };
                    updateScrollBar();
                }

                // 3. SOLID BLOCKERS
                const blockers = this.scene.add.graphics();
                blockers.fillStyle(darkBgColor, 1);
                blockers.fillRoundedRect(-120, -240, 240, 128, 12);
                blockers.fillRect(-120, -190, 240, 78);
                blockers.fillRoundedRect(-120, 135, 240, 105, 12);
                blockers.fillRect(-120, 135, 240, 60);
                singleCardContainer.add(blockers);

                // 4. BORDER 
                const cardBorder = this.scene.add.graphics();
                cardBorder.lineStyle(2, tierColor, 1);
                cardBorder.strokeRoundedRect(-120, -240, 240, 480, 12);
                singleCardContainer.add(cardBorder);

                // 5. HEADER CONTENT 
                const tierTextStr = `Tier ${tier} ${isWeapon ? 'Weapon' : 'Item'}`;
                const tierTextObj = this.scene.add.text(0, -226, tierTextStr, {
                    fontFamily: UIHelpers.FONT, fontSize: '12px', color: UIHelpers.getTierColorStr(tier), fontStyle: 'bold', resolution: 3
                }).setOrigin(0.5);

                const nameText = this.scene.add.text(0, -208, item.name ?? item.Name ?? "Unknown", {
                    fontFamily: UIHelpers.FONT, fontSize: '20px', color: '#ffffff', fontStyle: 'bold', resolution: 3
                }).setOrigin(0.5);

                let icon: any = null;
                const tex = config?.textureKey ?? config?.TextureKey;
                if (tex && tex.trim() !== "" && this.scene.textures.exists(tex)) {
                    icon = this.scene.add.sprite(0, -158, tex);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min(80 / icon.width, 80 / icon.height));
                }

                // Original static divider, right below the icon/header - unchanged from before.
                const topDivider = this.scene.add.rectangle(0, -114, 200, 2, 0x3a4454).setOrigin(0.5);

                singleCardContainer.add([tierTextObj, nameText, topDivider]);
                if (icon) singleCardContainer.add(icon);

                // 6. FOOTER CONTENT & BUTTONS 
                const buyBtnBg = this.scene.add.graphics();
                buyBtnBg.fillStyle(0x2e7d32, 1);
                buyBtnBg.fillRoundedRect(-90, 150, 180, 40, 20);
                const buyText = this.scene.add.text(0, 170, `BUY 💰 ${item.price ?? item.Price}`, {
                    fontFamily: UIHelpers.FONT, fontSize: '16px', fontStyle: 'bold', color: '#ffffff', resolution: 3
                }).setOrigin(0.5);

                const buyHitbox = this.scene.add.rectangle(0, 170, 180, 40, 0x000000, 0)
                    .setScrollFactor(0).setInteractive({ useHandCursor: true });

                const lockBtnBg = this.scene.add.graphics();
                lockBtnBg.fillStyle(isLocked ? 0x443300 : 0x2a303a, 1);
                lockBtnBg.fillRoundedRect(-50, 200, 100, 26, 13);
                const lockText = this.scene.add.text(0, 213, isLocked ? '🔒 LOCKED' : '🔓 Lock', {
                    fontFamily: UIHelpers.FONT, fontSize: '12px', color: isLocked ? '#ffb300' : '#8892a0', resolution: 3
                }).setOrigin(0.5);

                const lockHitbox = this.scene.add.rectangle(0, 213, 100, 26, 0x000000, 0)
                    .setScrollFactor(0).setInteractive({ useHandCursor: true });
                lockHitbox.on('pointerdown', () => this.connection.invoke("ToggleLock", configId).catch((err: any) => console.error(err)));

                singleCardContainer.add([buyBtnBg, buyText, lockBtnBg, lockText]);

                // 7. CARD HOVER / SCROLL HITBOX
                const cardHitbox = this.scene.add.rectangle(0, 0, 240, 480, 0x000000, 0)
                    .setScrollFactor(0).setInteractive();

                const focusItem: FocusItem = {
                    onFocus: (p?: Phaser.Input.Pointer) => {
                        AudioManager.getInstance().playUiSfx('ui_hover');
                        cardBorder.clear();
                        cardBorder.lineStyle(6, 0xffffff, 1);
                        cardBorder.strokeRoundedRect(-120, -240, 240, 480, 12);

                        // WHOLE CARD POP!
                        this.scene.tweens.add({ targets: singleCardContainer, scale: 1.05, duration: 100 });

                        const bx = p ? p.x : cardHitbox.getBounds().centerX;
                        const by = p ? p.y : cardHitbox.getBounds().centerY;
                        this.tooltip.show(config, bx, by, 1, atlasConfigs, item.totalBaseStats ?? item.TotalBaseStats, rolledStats, rolledSkills);
                    },
                    onBlur: () => {
                        cardBorder.clear();
                        cardBorder.lineStyle(2, tierColor, 1);
                        cardBorder.strokeRoundedRect(-120, -240, 240, 480, 12);

                        this.scene.tweens.add({ targets: singleCardContainer, scale: 1.0, duration: 100 });

                        this.tooltip.hide();
                    },
                    onSelect: () => {
                        this.connection.invoke("BuyItem", configId).catch((err: any) => console.error(err));
                    }
                };
                this.registerFocus(0, index, focusItem);

                cardHitbox.on('wheel', (_p: any, _dx: number, dy: number, _dz: number, event: Phaser.Types.Input.EventData) => {
                    if (maxScroll > 0) {
                        statsContainer.y -= dy * 0.5;
                        if (statsContainer.y < -maxScroll) statsContainer.y = -maxScroll;
                        if (statsContainer.y > 0) statsContainer.y = 0;
                        updateScrollBar();
                        event.stopPropagation();
                    }
                });

                this.scene.input.setDraggable(cardHitbox);
                cardHitbox.on('drag', (pointer: Phaser.Input.Pointer) => {
                    if (maxScroll > 0) {
                        statsContainer.y += (pointer.y - pointer.prevPosition.y);
                        if (statsContainer.y < -maxScroll) statsContainer.y = -maxScroll;
                        if (statsContainer.y > 0) statsContainer.y = 0;
                        updateScrollBar();
                    }
                });

                cardHitbox.on('pointerover', (p: Phaser.Input.Pointer) => { this.setMouseFocus(0, index); focusItem.onFocus(p); });
                cardHitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.updatePosition(p.x, p.y));
                cardHitbox.on('pointerout', () => focusItem.onBlur());

                buyHitbox.on('pointerdown', () => focusItem.onSelect());
                buyHitbox.on('pointerover', (p: Phaser.Input.Pointer) => {
                    this.setMouseFocus(0, index);
                    focusItem.onFocus(p); // Keep the card popped out while hovering the button
                    buyBtnBg.clear(); buyBtnBg.fillStyle(0x4caf50, 1); buyBtnBg.fillRoundedRect(-90, 150, 180, 40, 20);
                });
                buyHitbox.on('pointerout', () => {
                    focusItem.onBlur();
                    buyBtnBg.clear(); buyBtnBg.fillStyle(0x2e7d32, 1); buyBtnBg.fillRoundedRect(-90, 150, 180, 40, 20);
                });

                singleCardContainer.add([cardHitbox, buyHitbox, lockHitbox]);
            });

            this.safelyReapplyKeyboardFocus();

        } catch (err) {
            console.error("Safely caught UI Update error to prevent game freeze:", err);
        }
    }

    private safelyReapplyKeyboardFocus() {
        if (this.isKeyboardNavActive) {
            if (this.focusRow >= this.focusGrid.length) this.focusRow = this.focusGrid.length - 1;
            while (this.focusRow >= 0 && (!this.focusGrid[this.focusRow] || this.focusGrid[this.focusRow].length === 0)) {
                this.focusRow--;
            }
            if (this.focusRow >= 0) {
                if (this.focusCol >= this.focusGrid[this.focusRow].length) {
                    this.focusCol = this.focusGrid[this.focusRow].length - 1;
                }
                if (this.focusGrid[this.focusRow]?.[this.focusCol]) {
                    this.focusGrid[this.focusRow][this.focusCol].onFocus();
                }
            }
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

        // A skill with showCastBar explicitly false gets no action-bar button at all - not
        // just no world-space cast bar. Filter these out before laying out slots so the
        // remaining buttons sit flush together instead of leaving a gap.
        const visibleSkills = skills.filter(s => {
            const cfg = skillMap[s.configId];
            if (!cfg) return true; // let the per-skill `if (!config) return;` below handle it
            const showCastBar = cfg.showCastBar ?? cfg.ShowCastBar;
            return showCastBar !== false;
        });

        const currentIds = new Set(visibleSkills.map(s => s.configId));
        for (const [id, slot] of this.slots.entries()) {
            if (!currentIds.has(id)) {
                slot.bg.destroy(); slot.icon.destroy(); slot.cdOverlay.destroy();
                slot.border.destroy(); slot.text.destroy(); slot.hitbox.destroy();
                this.slots.delete(id);
            }
        }

        const slotSize = 48;
        const spacing = 10;
        const totalWidth = (visibleSkills.length * slotSize) + ((visibleSkills.length - 1) * spacing);
        const startX = -totalWidth / 2;

        visibleSkills.forEach((skillData, index) => {
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

                const hitbox = this.scene.add.rectangle(xPos, 0, slotSize, slotSize, 0x000000, 0)
                    .setInteractive({ useHandCursor: true })
                    .setScrollFactor(0);

                hitbox.on('pointerover', (p: Phaser.Input.Pointer) => {
                    border.clear().lineStyle(3, 0xffffff, 1).strokeRoundedRect(xPos - slotSize / 2, -slotSize / 2, slotSize, slotSize, 6);
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

        const hasteVal = Math.max(0, this.playerStats?.haste || 0);
        const hasteMult = (100 + hasteVal) / 100;

        this.activeSkillsData.forEach(skillData => {
            const slot = this.slots.get(skillData.configId);
            if (slot) {
                skillData.currentCooldown = Math.max(0, skillData.currentCooldown - deltaSeconds);
                const config = skillMap[skillData.configId];

                const skillHasteMult = UIHelpers.isImmune(config) ? 1 : hasteMult;
                const rawMaxCd = config?.cooldownSeconds ?? config?.CooldownSeconds ?? 1;
                const trueMaxCd = rawMaxCd / skillHasteMult;

                if (skillData.currentCooldown > 0) {
                    const pct = skillData.currentCooldown / trueMaxCd;
                    slot.cdOverlay.scaleY = Phaser.Math.Clamp(pct, 0, 1);
                    slot.cdOverlay.setVisible(true);
                    slot.text.setText(skillData.currentCooldown.toFixed(1));
                } else {
                    slot.cdOverlay.setVisible(false);
                    const nameStr = config?.name ?? config?.Name ?? "";
                    const lvlMatch = nameStr.match(/Lv\.(\d+)/i);
                    const levelText = lvlMatch ? `L${lvlMatch[1]}` : "";
                    slot.text.setText(levelText);
                }
            }
        });
    }
}

export class LootNotifier {
    private scene: Phaser.Scene;

    // --- Loot pickups: right-middle, multiple can be visible and stacked at once ---
    private activeLootToasts: Phaser.GameObjects.Container[] = [];

    // --- Achievements: bottom-right, strictly ONE visible at a time, fully sequential ---
    private achievementQueue: Array<() => void> = [];
    private isShowingAchievement: boolean = false;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    private getTierColor(tier: number): number {
        switch (tier) {
            case 1: return 0xc0c0c0; // Common / Gray
            case 2: return 0x29b6f6; // Rare / Blue
            case 3: return 0xab47bc; // Epic / Purple
            case 4: return 0xffca28; // Legendary / Gold
            default: return 0xffffff;
        }
    }

    // Builds the visual container (text, icon, background) sized to its content.
    // Positioning/animation is handled separately by each caller below, since loot
    // and achievement toasts move completely differently.
    private buildToast(playerName: string, itemName: string, tier: number, textureKey: string, iconFrame: number, verb: string) {
        const isMobile = this.scene.scale.width < 800;
        const uiScale = isMobile ? 0.85 : 1.0;
        const height = 45;
        const padding = 15;

        const container = this.scene.add.container(0, 0).setDepth(10000).setScrollFactor(0);
        container.setScale(uiScale);

        const tierColor = this.getTierColor(tier);
        const hexColorString = '#' + tierColor.toString(16).padStart(6, '0');

        const prefixText = this.scene.add.text(0, 0, `${playerName} ${verb} `, {
            fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            fontSize: '16px',
            color: '#ffffff',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0, 0.5);
        container.add(prefixText);

        const itemText = this.scene.add.text(0, 0, itemName, {
            fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            fontSize: '16px',
            color: hexColorString,
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0, 0.5);
        container.add(itemText);

        let iconWidthSpace = 0;
        if (textureKey && this.scene.textures.exists(textureKey)) {
            const targetIconSize = 36;
            const icon = this.scene.add.sprite(0, 0, textureKey);

            if (iconFrame !== undefined && iconFrame !== null) {
                icon.setFrame(iconFrame);
            }

            const maxDim = Math.max(icon.width, icon.height);
            const dynamicScale = maxDim > 0 ? (targetIconSize / maxDim) : 1;

            icon.setScale(dynamicScale);
            container.add(icon);

            iconWidthSpace = targetIconSize;
        }

        const textGap = 10;
        const totalWidth = padding + prefixText.width + itemText.width + (iconWidthSpace > 0 ? textGap + iconWidthSpace : 0) + padding;

        prefixText.setX(-totalWidth + padding);
        itemText.setX(-totalWidth + padding + prefixText.width);

        if (container.list.length > 2) {
            const iconObj = container.list[2] as Phaser.GameObjects.Sprite;
            iconObj.setX(-padding - (iconWidthSpace / 2));
        }

        const bg = this.scene.add.graphics();
        bg.fillStyle(0x000000, 0.15);
        bg.fillRoundedRect(-totalWidth, -height / 2, totalWidth, height, 8);
        bg.lineStyle(2, tierColor, 0.8);
        bg.strokeRoundedRect(-totalWidth, -height / 2, totalWidth, height, 8);
        container.addAt(bg, 0);

        return { container, totalWidth, height, uiScale };
    }

    // ============================================================
    // LOOT PICKUPS — right-middle, multiple can stack simultaneously
    // ============================================================
    public show(playerName: string, itemName: string, tier: number, textureKey: string, iconFrame: number) {
        const { container, totalWidth, height, uiScale } =
            this.buildToast(playerName, itemName, tier, textureKey, iconFrame, "picked up");

        const targetX = this.scene.scale.width - (20 * uiScale);
        const baseY = this.scene.scale.height / 2;

        this.activeLootToasts.unshift(container);
        this.activeLootToasts.forEach((toast, index) => {
            const slotY = baseY + (index * (height + 10) * uiScale);
            if (toast === container) {
                toast.y = slotY;
            } else {
                this.scene.tweens.add({ targets: toast, y: slotY, duration: 250, ease: 'Power2' });
            }
        });

        const startX = this.scene.scale.width + (totalWidth * uiScale);
        container.setX(startX);

        this.scene.tweens.add({
            targets: container,
            x: targetX,
            duration: 400,
            ease: 'Back.easeOut',
            onComplete: () => {
                this.scene.time.delayedCall(2000, () => {
                    this.scene.tweens.add({
                        targets: container,
                        alpha: 0,
                        x: targetX + 100,
                        duration: 300,
                        onComplete: () => {
                            container.destroy();
                            this.activeLootToasts = this.activeLootToasts.filter(t => t !== container);
                        }
                    });
                });
            }
        });
    }

    // ============================================================
    // ACHIEVEMENTS — bottom-right, strictly one at a time: rise up,
    // hold 4s, sink back down, THEN the next queued one rises.
    // ============================================================
    public showAchievement(playerName: string, itemName: string, tier: number, textureKey: string, iconFrame: number) {
        this.achievementQueue.push(() => this.spawnAchievementToast(playerName, itemName, tier, textureKey, iconFrame));
        this.processAchievementQueue();
    }

    private processAchievementQueue() {
        if (this.isShowingAchievement || this.achievementQueue.length === 0) return;
        this.isShowingAchievement = true;
        const next = this.achievementQueue.shift()!;
        next();
    }

    private spawnAchievementToast(playerName: string, itemName: string, tier: number, textureKey: string, iconFrame: number) {
        const { container, uiScale } =
            this.buildToast(playerName, itemName, tier, textureKey, iconFrame, "unlocked");

        const targetX = this.scene.scale.width - (20 * uiScale);
        const restY = this.scene.scale.height - (90 * uiScale);   // resting spot near bottom-right
        const hiddenY = this.scene.scale.height + 80;              // fully off-screen below

        container.setX(targetX);
        container.setY(hiddenY);

        this.scene.tweens.add({
            targets: container,
            y: restY,
            duration: 400,
            ease: 'Back.easeOut',
            onComplete: () => {
                this.scene.time.delayedCall(4000, () => {
                    this.scene.tweens.add({
                        targets: container,
                        y: hiddenY,
                        duration: 350,
                        ease: 'Power2',
                        onComplete: () => {
                            container.destroy();
                            this.isShowingAchievement = false;
                            this.processAchievementQueue();
                        }
                    });
                });
            }
        });
    }
}