import * as Phaser from 'phaser';
import { HubConnection } from '@microsoft/signalr';

// =========================================================================
// SHARED UI HELPERS & TYPOGRAPHY
// =========================================================================
export const UIHelpers = {
    FONT: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",

    getTierColorStr: (tier: number): string => {
        if (tier <= 2) return '#c0c0c0'; // Silver
        if (tier <= 4) return '#00aaff'; // Blue
        if (tier <= 6) return '#aa00ff'; // Purple
        return '#ffd700'; // Gold
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
            maxHp: { e: "❤️", n: "Max HP" }, hpRegen: { e: "🩹", n: "HP Regen" }, lifeSteal: { e: "🧛", n: "Life Steal" },
            speed: { e: "💨", n: "Speed" }, haste: { e: "⏳", n: "Haste" }, meleeDamage: { e: "🗡️", n: "Melee Dmg" },
            rangedDamage: { e: "🏹", n: "Ranged Dmg" }, elementalDamage: { e: "🔥", n: "Elem Dmg" },
            engineering: { e: "🔧", n: "Engineering" }, armor: { e: "🛡️", n: "Armor" }, luck: { e: "🍀", n: "Luck" },
            harvesting: { e: "🌾", n: "Harvesting" }, dodge: { e: "👻", n: "Dodge" }, critChance: { e: "💥", n: "Crit Chance" },
            critMultiplier: { e: "✖️", n: "Crit Mult" }, knockback: { e: "💨", n: "Knockback" },
            pierceCount: { e: "🏹", n: "Pierces" }, bounceCount: { e: "🪃", n: "Bounces" },
            attackSpeedPercent: { e: "⚡", n: "Attack Speed" }, xpGainPercent: { e: "🧠", n: "XP Gain" },
            damagePercent: { e: "💥", n: "Damage %" }, projectileSpeedPercent: { e: "☄️", n: "Proj Speed" }
        };
        return map[key] || { e: "❓", n: key.charAt(0).toUpperCase() + key.slice(1) };
    },

    formatVal: (key: string, val: number): string => {
        if (!key) return `${val}`;
        const isPct = key.toLowerCase().includes('percent') || key === 'lifeSteal' || key === 'dodge' || key === 'critChance';
        return isPct ? `${Math.round(val * 100)}%` : `${val}`;
    }
};

// =========================================================================
// TOOLTIP
// =========================================================================
export class Tooltip extends Phaser.GameObjects.Container {
    private bg: Phaser.GameObjects.Graphics;
    private titleText: Phaser.GameObjects.Text;
    private descText: Phaser.GameObjects.Text;
    private negativeText: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene) {
        super(scene, 0, 0);
        this.setDepth(5000);
        this.setVisible(false);

        this.bg = scene.add.graphics();
        
        this.titleText = scene.add.text(12, 12, '', { fontFamily: UIHelpers.FONT, fontSize: '18px', fontStyle: 'bold', resolution: 3 });
        this.descText = scene.add.text(12, 38, '', { fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#dddddd', wordWrap: { width: 240 }, lineSpacing: 3, resolution: 3 });
        this.negativeText = scene.add.text(12, 38, '', { fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#ff4444', wordWrap: { width: 240 }, lineSpacing: 3, resolution: 3 });

        this.add([this.bg, this.titleText, this.descText, this.negativeText]);
        scene.add.existing(this);
    }

    public show(config: any, x: number, y: number, stackCount: number = 1) {
        if (!config) return;
        
        try {
            const tier = config.tier ?? config.Tier ?? 1;
            this.titleText.setText(config.name ?? config.Name).setColor(UIHelpers.getTierColorStr(tier));

            let posStr = `[ Tier ${tier} ]\n`;
            let negStr = '';

            const meleeDmg = config.meleeDamage ?? config.MeleeDamage;
            const rangedDmg = config.rangedDamage ?? config.RangedDamage;
            const elemDmg = config.elementalDamage ?? config.ElementalDamage;
            const cooldown = config.cooldownSeconds ?? config.CooldownSeconds;
            const range = config.range ?? config.Range;
            const scaling = config.damageScaling ?? config.DamageScaling;
            const mechanics = config.mechanics ?? config.Mechanics;
            const statBonuses = config.statBonuses ?? config.StatBonuses;
            const effectsAtWaveEnd = config.effectsAtWaveEnd ?? config.EffectsAtWaveEnd;
            const dynamicModifiers = config.dynamicModifiers ?? config.DynamicModifiers;
            const effectsOnPurchase = config.effectsOnPurchase ?? config.EffectsOnPurchase;
            const traits = config.traits ?? config.Traits;

            if (meleeDmg || rangedDmg || elemDmg || cooldown || range) {
                if (meleeDmg) posStr += `🗡️ Melee Dmg: ${meleeDmg * stackCount}\n`;
                if (rangedDmg) posStr += `🏹 Ranged Dmg: ${rangedDmg * stackCount}\n`;
                if (elemDmg) posStr += `🔥 Elem Dmg: ${elemDmg * stackCount}\n`;
                if (cooldown) posStr += `⏱️ CD: ${cooldown}s\n`;
                if (range) posStr += `📏 Range: ${range}\n`;
                if (scaling) {
                    const scales = Object.entries(scaling).map(([k, v]) => `${(v as number) * 100}% of ${UIHelpers.getStatInfo(k).n}`);
                    if (scales.length > 0) posStr += `📈 Scales: ${scales.join(', ')}\n`;
                }
            }

            if (mechanics) {
                Object.entries(mechanics).forEach(([k, v]) => {
                    const info = UIHelpers.getStatInfo(k);
                    posStr += `${info.e} ${info.n}: ${UIHelpers.formatVal(k, (v as number) * stackCount)}\n`;
                });
            }

            if (statBonuses) {
                Object.entries(statBonuses).forEach(([k, v]) => {
                    const num = (v as number) * stackCount;
                    const info = UIHelpers.getStatInfo(k);
                    if (num > 0) posStr += `${info.e} ${info.n}: +${UIHelpers.formatVal(k, num)}\n`;
                    else if (num < 0) negStr += `${info.e} ${info.n}: ${UIHelpers.formatVal(k, num)}\n`;
                });
            }

            if (effectsAtWaveEnd) {
                effectsAtWaveEnd.forEach((e: any) => {
                    const statName = e.statName ?? e.StatName ?? "";
                    const amount = (e.amount ?? e.Amount) * stackCount;
                    const info = UIHelpers.getStatInfo(statName);
                    const prefix = amount > 0 ? '+' : '';
                    posStr += `🌊 Wave End: ${info.n} ${prefix}${UIHelpers.formatVal(statName, amount)}\n`;
                });
            }
            
            if (dynamicModifiers) {
                dynamicModifiers.forEach((m: any) => {
                    const targetStat = m.targetStat ?? m.TargetStat ?? "";
                    const amount = m.amount ?? m.Amount;
                    const conditionThreshold = m.conditionThreshold ?? m.ConditionThreshold;
                    const info = UIHelpers.getStatInfo(targetStat);
                    const prefix = amount > 0 ? '+' : '';
                    posStr += `⚡ ${info.n}: ${prefix}${UIHelpers.formatVal(targetStat, amount)} / ${Math.round(conditionThreshold * 100)}% missing HP\n`;
                });
            }

            if (effectsOnPurchase) effectsOnPurchase.forEach((e: string) => posStr += `🔹 Grants: ${e}\n`);
            if (traits) traits.forEach((t: string) => {
                if (t === "CannotHeal") negStr += `⚠️ Cannot Heal\n`;
                else posStr += `🔹 ${t}\n`;
            });

            this.descText.setText(posStr.trim());
            this.negativeText.setText(negStr.trim());
            this.negativeText.setY(this.descText.y + this.descText.displayHeight + (posStr ? 8 : 0));

            const totalTextHeight = this.descText.displayHeight + (negStr ? this.negativeText.displayHeight + 8 : 0);
            const bgHeight = Math.max(80, 45 + totalTextHeight + 15);

            this.bg.clear();
            this.bg.fillStyle(0x111317, 0.95);
            this.bg.fillRoundedRect(0, 0, 260, bgHeight, 8);
            this.bg.lineStyle(2, UIHelpers.getTierColorHex(tier), 1);
            this.bg.strokeRoundedRect(0, 0, 260, bgHeight, 8);

            let targetX = x + 15;
            let targetY = y + 15;
            if (targetX + 260 > this.scene.scale.width) targetX = x - 265;
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

        const title = scene.add.text(120, 15, 'Character Stats', { fontFamily: UIHelpers.FONT, fontSize: '22px', color: '#ffffff', fontStyle: 'bold', resolution: 3 }).setOrigin(0.5, 0);
        this.levelText = scene.add.text(120, 45, 'Level: 1', { fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#ffb300', fontStyle: 'bold', resolution: 3 }).setOrigin(0.5, 0);

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
                const labelText = this.scene.add.text(15, 85 + (index * 24), `${info.e} ${info.n}`, { fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#aaaaaa', resolution: 3 });
                const valueText = this.scene.add.text(220, 85 + (index * 24), '0', { fontFamily: UIHelpers.FONT, fontSize: '14px', color: '#ffffff', fontStyle: 'bold', resolution: 3 }).setOrigin(1, 0);
                this.add([labelText, valueText]);
                this.statTexts.set(key, valueText);
                index++;
            });
        }

        Object.entries(statsPayload).forEach(([key, val]) => {
            if (this.statTexts.has(key)) {
                const textObj = this.statTexts.get(key)!;
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
    private weaponGrid: Phaser.GameObjects.Container;
    private tooltip: Tooltip;

    constructor(scene: Phaser.Scene, x: number, y: number, tooltip: Tooltip) {
        super(scene, x, y);
        this.tooltip = tooltip;

        this.itemGrid = scene.add.container(0, 0);
        const itemTitle = scene.add.text(0, -25, 'Items', { fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#a0abbc', fontStyle: 'bold', resolution: 3 });
        this.itemGrid.add(itemTitle);

        this.weaponGrid = scene.add.container(320, 0);
        const weaponTitle = scene.add.text(0, -25, 'Weapons', { fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#a0abbc', fontStyle: 'bold', resolution: 3 });
        this.weaponGrid.add(weaponTitle);

        this.add([this.itemGrid, this.weaponGrid]);
        scene.add.existing(this);
    }

    public updateLayout(availableWidth: number) {
        this.weaponGrid.setPosition(availableWidth - 180, -80);
    }

    public updateInventory(weapons: any[], items: any[], atlasConfigs: any) {
        this.itemGrid.list.filter(child => child.type !== 'Text').forEach(c => c.destroy());
        this.weaponGrid.list.filter(child => child.type !== 'Text').forEach(c => c.destroy());

        for (let i = 0; i < 5; i++) {
            const slotX = i * 75; 
            const slotBg = this.scene.add.graphics();
            slotBg.fillStyle(0x161920, 1);
            slotBg.fillRoundedRect(slotX, 0, 65, 65, 8);
            slotBg.lineStyle(2, 0x3a4454, 1);
            slotBg.strokeRoundedRect(slotX, 0, 65, 65, 8);
            this.itemGrid.add(slotBg);

            if (items && items[i]) {
                const itemData = items[i];
                let config = atlasConfigs?.items ? atlasConfigs.items[itemData.configId] : null;
                const stackCount = itemData.count || 1;

                if (config) {
                    slotBg.lineStyle(2, UIHelpers.getTierColorHex(config.tier || config.Tier || 1), 1);
                    slotBg.strokeRoundedRect(slotX, 0, 65, 65, 8);
                }

                let icon;
                if (config && (config.textureKey || config.TextureKey) && this.scene.textures.exists(config.textureKey || config.TextureKey)) {
                    icon = this.scene.add.sprite(slotX + 32.5, 32.5, config.textureKey || config.TextureKey);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min(50 / icon.width, 50 / icon.height));
                } else {
                    icon = this.scene.add.rectangle(slotX + 32.5, 32.5, 40, 40, 0x000000).setStrokeStyle(2, 0x00ff00);
                }
                this.itemGrid.add(icon);

                const hitbox = this.scene.add.rectangle(slotX + 32.5, 32.5, 65, 65, 0x000000, 0).setInteractive({ useHandCursor: true });
                if (config) {
                    hitbox.on('pointerover', (p: Phaser.Input.Pointer) => this.tooltip.show(config, p.x, p.y, stackCount));
                    hitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.setPosition(p.x + 15, p.y + 15));
                    hitbox.on('pointerout', () => this.tooltip.hide());
                }
                this.itemGrid.add(hitbox);

                if (stackCount > 1) {
                    const countTxt = this.scene.add.text(slotX + 60, 60, `x${stackCount}`, { fontFamily: UIHelpers.FONT, fontSize: '14px', color: '#fff', stroke: '#000', strokeThickness: 3, resolution: 3 }).setOrigin(1, 1);
                    this.itemGrid.add(countTxt);
                }
            }
        }

        for (let i = 0; i < 4; i++) {
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

            if (weapons && weapons[i]) {
                const weaponData = weapons[i];
                let config = atlasConfigs?.weapons ? atlasConfigs.weapons[weaponData.configId] : null;
                const wLevel = weaponData.level || 1;

                if (config) {
                    slotBg.lineStyle(2, UIHelpers.getTierColorHex(wLevel), 1);
                    slotBg.strokeRoundedRect(slotX, slotY, 65, 65, 8);
                }

                let icon;
                if (config && (config.textureKey || config.TextureKey) && this.scene.textures.exists(config.textureKey || config.TextureKey)) {
                    icon = this.scene.add.sprite(slotX + 32.5, slotY + 32.5, config.textureKey || config.TextureKey);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min(50 / icon.width, 50 / icon.height));
                } else {
                    icon = this.scene.add.rectangle(slotX + 32.5, slotY + 32.5, 40, 40, 0x000000).setStrokeStyle(2, 0x00ff00);
                }
                this.weaponGrid.add(icon);

                const hitbox = this.scene.add.rectangle(slotX + 32.5, slotY + 32.5, 65, 65, 0x000000, 0).setInteractive({ useHandCursor: true });
                if (config) {
                    const toolTipConfig = { ...config, tier: wLevel }; 
                    hitbox.on('pointerover', (p: Phaser.Input.Pointer) => this.tooltip.show(toolTipConfig, p.x, p.y, 1));
                    hitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.setPosition(p.x + 15, p.y + 15));
                    hitbox.on('pointerout', () => this.tooltip.hide());
                }
                this.weaponGrid.add(hitbox);

                const lvlTxt = this.scene.add.text(slotX + 60, slotY + 60, `Lv.${wLevel}`, { fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#ffffff', stroke: '#000', strokeThickness: 3, resolution: 3 }).setOrigin(1, 1);
                this.weaponGrid.add(lvlTxt);
            }
        }
    }
}

// =========================================================================
// MAIN SHOP UI
// =========================================================================
export class ShopUI extends Phaser.GameObjects.Container {
    private statDisplay: StatDisplay;
    private inventoryDisplay: InventoryDisplay;
    private shopCardsContainer: Phaser.GameObjects.Container;
    private levelUpContainer: Phaser.GameObjects.Container;
    private headerText: Phaser.GameObjects.Text;
    private rerollButtonContainer: Phaser.GameObjects.Container;
    private rerollText: Phaser.GameObjects.Text;
    private connection: HubConnection;
    private tooltip: Tooltip;

    constructor(scene: Phaser.Scene, connection: HubConnection) {
        super(scene, 0, 0);
        this.connection = connection;

        const overlay = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, 0x07090c, 0.90).setOrigin(0, 0).setInteractive();
        this.add(overlay);

        this.headerText = scene.add.text(0, 0, 'Shop', { fontFamily: UIHelpers.FONT, fontSize: '32px', color: '#ffffff', fontStyle: 'bold', resolution: 3 });
        this.add(this.headerText);

        this.rerollButtonContainer = scene.add.container(0, 0);
        const rerollBg = scene.add.graphics();
        rerollBg.fillStyle(0x1a1e24, 1);
        rerollBg.fillRoundedRect(-80, -22.5, 160, 45, 8);
        rerollBg.lineStyle(2, 0xd84315, 1); 
        rerollBg.strokeRoundedRect(-80, -22.5, 160, 45, 8);
        
        this.rerollText = scene.add.text(0, 0, 'REROLL 💰 2', { fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#ffffff', fontStyle: 'bold', resolution: 3 }).setOrigin(0.5);

        const rerollHitbox = scene.add.rectangle(0, 0, 160, 45, 0x000000, 0).setInteractive({ useHandCursor: true });
        rerollHitbox.on('pointerdown', () => this.connection.invoke("RerollShop").catch((err: any) => console.error(err)));
        rerollHitbox.on('pointerover', () => { rerollBg.clear(); rerollBg.fillStyle(0xd84315, 1); rerollBg.fillRoundedRect(-80, -22.5, 160, 45, 8); });
        rerollHitbox.on('pointerout', () => { rerollBg.clear(); rerollBg.fillStyle(0x1a1e24, 1); rerollBg.fillRoundedRect(-80, -22.5, 160, 45, 8); rerollBg.lineStyle(2, 0xd84315, 1); rerollBg.strokeRoundedRect(-80, -22.5, 160, 45, 8);});
        
        this.rerollButtonContainer.add([rerollBg, this.rerollText, rerollHitbox]);
        this.add(this.rerollButtonContainer);

        this.tooltip = new Tooltip(scene);
        this.statDisplay = new StatDisplay(scene, 0, 0);
        this.inventoryDisplay = new InventoryDisplay(scene, 0, 0, this.tooltip);
        this.add([this.statDisplay, this.inventoryDisplay]);

        this.shopCardsContainer = scene.add.container(0, 0);
        this.levelUpContainer = scene.add.container(0, 0);
        this.add([this.shopCardsContainer, this.levelUpContainer]);

        scene.add.existing(this);

        this.updateLayout(scene.scale.width, scene.scale.height);
        scene.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
            overlay.setSize(gameSize.width, gameSize.height);
            this.updateLayout(gameSize.width, gameSize.height);
        });
    }

    // >>> THE FIX: Ensure tooltip is hidden if shop is forced closed, preventing ghost hitboxes! <<<
    public setVisible(value: boolean): this {
        if (!value && this.tooltip) {
            this.tooltip.hide();
        }
        return super.setVisible(value);
    }

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
            this.inventoryDisplay.updateInventory(uiData.weapons, uiData.ownedItems, atlasConfigs);

            this.shopCardsContainer.removeAll(true);
            this.levelUpContainer.removeAll(true);
            
            // Just in case a tooltip was hovering before the wipe
            this.tooltip.hide();

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

                    const hitbox = this.scene.add.rectangle(cardX + 120, 160, 240, 320, 0x000000, 0).setInteractive({ useHandCursor: true });
                    hitbox.on('pointerdown', () => this.connection.invoke("SelectLevelUpStat", card.id || card.Id).catch((err: any) => console.error(err)));
                    hitbox.on('pointerover', () => { bgGraphics.lineStyle(4, 0xffffff, 1); bgGraphics.strokeRoundedRect(cardX, 0, 240, 320, 12); });
                    hitbox.on('pointerout', () => { bgGraphics.lineStyle(2, UIHelpers.getTierColorHex(card.tier || card.Tier || 1), 1); bgGraphics.strokeRoundedRect(cardX, 0, 240, 320, 12); });

                    const nameText = this.scene.add.text(cardX + 120, 50, card.name || card.Name, { fontFamily: UIHelpers.FONT, fontSize: '22px', color: '#fff', fontStyle: 'bold', resolution: 3 }).setOrigin(0.5);
                    const tierText = this.scene.add.text(cardX + 120, 80, `Tier ${card.tier || card.Tier || 1}`, { fontFamily: UIHelpers.FONT, fontSize: '14px', color: UIHelpers.getTierColorStr(card.tier || card.Tier || 1), resolution: 3 }).setOrigin(0.5);

                    const statName = card.statName || card.StatName || "";
                    const amount = card.amount ?? card.Amount;

                    const info = UIHelpers.getStatInfo(statName);
                    const isPct = statName.toLowerCase().includes('percent') || statName === 'lifeSteal' || statName === 'dodge';
                    const valStr = isPct ? `+${Math.round(amount * 100)}%` : `+${amount}`;

                    const statText = this.scene.add.text(cardX + 120, 160, `${info.e} ${info.n}: ${valStr}`, { fontFamily: UIHelpers.FONT, fontSize: '20px', color: '#00ff00', fontStyle: 'bold', align: 'center', resolution: 3 }).setOrigin(0.5);

                    this.levelUpContainer.add([bgGraphics, hitbox, nameText, tierText, statText]);
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

            uiData.currentShop.forEach((item: any, index: number) => {
                const cardX = index * 280;
                
                let config = undefined;
                let isWeapon = false;

                const configId = item.configId || item.ConfigId;
                const isLocked = item.isLocked ?? item.IsLocked;

                if (atlasConfigs?.items && atlasConfigs.items[configId]) {
                    config = atlasConfigs.items[configId];
                } else if (atlasConfigs?.weapons && atlasConfigs.weapons[configId]) {
                    config = atlasConfigs.weapons[configId];
                    isWeapon = true;
                }

                const tier = config?.tier || config?.Tier || 1;
                const tierColor = isLocked ? 0x888888 : UIHelpers.getTierColorHex(tier);

                const cardBg = this.scene.add.graphics();
                cardBg.fillStyle(0x161920, 1);
                cardBg.fillRoundedRect(cardX, 0, 240, 480, 12);
                cardBg.lineStyle(2, tierColor, 1);
                cardBg.strokeRoundedRect(cardX, 0, 240, 480, 12);
                this.shopCardsContainer.add(cardBg);

                const tex = config?.textureKey || config?.TextureKey;
                if (tex && tex.trim() !== "" && this.scene.textures.exists(tex)) {
                    const icon = this.scene.add.sprite(cardX + 120, 75, tex);
                    const frame = config.iconFrame ?? config.IconFrame;
                    if (frame !== undefined) icon.setFrame(frame);
                    icon.setScale(Math.min(64 / icon.width, 64 / icon.height));
                    this.shopCardsContainer.add(icon);
                }

                const nameText = this.scene.add.text(cardX + 120, 135, item.name || item.Name || "Unknown", { fontFamily: UIHelpers.FONT, fontSize: '18px', color: UIHelpers.getTierColorStr(tier), fontStyle: 'bold', resolution: 3 }).setOrigin(0.5);
                const typeStr = isWeapon ? "Weapon" : "Item";
                const typeText = this.scene.add.text(cardX + 120, 155, typeStr, { fontFamily: UIHelpers.FONT, fontSize: '12px', color: '#8892a0', fontStyle: 'italic', resolution: 3 }).setOrigin(0.5);
                const divider = this.scene.add.rectangle(cardX + 120, 170, 200, 2, 0x3a4454).setOrigin(0.5);

                let baseStatsStr = '';
                let randomStatsStr = '';
                let skillsStr = '';
                let negStr = '';

                if (config) {
                    const meleeDmg = config.meleeDamage ?? config.MeleeDamage;
                    const rangedDmg = config.rangedDamage ?? config.RangedDamage;
                    const elemDmg = config.elementalDamage ?? config.ElementalDamage;
                    const cooldown = config.cooldownSeconds ?? config.CooldownSeconds;

                    if (meleeDmg) baseStatsStr += `🗡️ Melee Dmg: ${meleeDmg}\n`;
                    if (rangedDmg) baseStatsStr += `🏹 Ranged Dmg: ${rangedDmg}\n`;
                    if (elemDmg) baseStatsStr += `🔥 Elem Dmg: ${elemDmg}\n`;
                    if (cooldown) baseStatsStr += `⏱️ Cooldown: ${cooldown}s\n`;

                    const statBonuses = config.statBonuses ?? config.StatBonuses;
                    if (statBonuses) {
                        Object.entries(statBonuses).forEach(([k, v]) => {
                            const num = v as number;
                            const info = UIHelpers.getStatInfo(k);
                            if (num > 0) baseStatsStr += `${info.e} ${info.n}: +${UIHelpers.formatVal(k, num)}\n`;
                            else if (num < 0) negStr += `${info.e} ${info.n}: ${UIHelpers.formatVal(k, num)}\n`;
                        });
                    }

                    const dynamicModifiers = config.dynamicModifiers ?? config.DynamicModifiers;
                    if (dynamicModifiers) {
                        dynamicModifiers.forEach((m: any) => {
                            const targetStat = m.targetStat ?? m.TargetStat ?? "";
                            const amount = m.amount ?? m.Amount;
                            const conditionThreshold = m.conditionThreshold ?? m.ConditionThreshold;
                            const info = UIHelpers.getStatInfo(targetStat);
                            const prefix = amount > 0 ? '+' : '';
                            baseStatsStr += `⚡ ${info.n}: ${prefix}${UIHelpers.formatVal(targetStat, amount)} / ${Math.round(conditionThreshold * 100)}% missing HP\n`;
                        });
                    }

                    const effectsAtWaveEnd = config.effectsAtWaveEnd ?? config.EffectsAtWaveEnd;
                    if (effectsAtWaveEnd) {
                        effectsAtWaveEnd.forEach((e: any) => {
                            const statName = e.statName ?? e.StatName ?? "";
                            const amount = e.amount ?? e.Amount;
                            const info = UIHelpers.getStatInfo(statName);
                            const prefix = amount > 0 ? '+' : '';
                            baseStatsStr += `🌊 Wave End: ${info.n} ${prefix}${UIHelpers.formatVal(statName, amount)}\n`;
                        });
                    }

                    const effectsOnPurchase = config.effectsOnPurchase ?? config.EffectsOnPurchase;
                    if (effectsOnPurchase) effectsOnPurchase.forEach((e: string) => baseStatsStr += `🔹 Grants: ${e}\n`);

                    const traits = config.traits ?? config.Traits;
                    if (traits) {
                        traits.forEach((t: string) => {
                            if (t === "CannotHeal") negStr += `⚠️ Cannot Heal\n`;
                            else baseStatsStr += `🔹 ${t}\n`;
                        });
                    }
                }

                const rolledStats = item.rolledStats || item.RolledStats;
                if (rolledStats && Object.keys(rolledStats).length > 0) {
                    Object.entries(rolledStats).forEach(([k, v]) => {
                        const num = v as number;
                        const info = UIHelpers.getStatInfo(k);
                        if (num > 0) randomStatsStr += `${info.e} ${info.n}: +${UIHelpers.formatVal(k, num)}\n`;
                        else if (num < 0) negStr += `${info.e} ${info.n}: ${UIHelpers.formatVal(k, num)}\n`;
                    });
                }

                const rolledSkills = item.weaponSkills || item.WeaponSkills;
                if (rolledSkills && rolledSkills.length > 0) {
                    rolledSkills.forEach((skillId: string) => {
                        const s = (atlasConfigs?.skills || atlasConfigs?.Skills)?.[skillId];
                        skillsStr += `✨ ${s ? (s.name || s.Name) : skillId}\n`;
                    });
                }

                let finalPosStr = '';
                if (baseStatsStr) finalPosStr += `[ 📊 Base Stats ]\n${baseStatsStr}`;
                if (randomStatsStr) finalPosStr += `\n[ 🎲 Random Stats ]\n${randomStatsStr}`;
                if (skillsStr) finalPosStr += `\n[ 🌟 Skills ]\n${skillsStr}`;

                const posTextObj = this.scene.add.text(cardX + 15, 180, finalPosStr.trim(), { fontFamily: UIHelpers.FONT, fontSize: '12px', color: '#dddddd', lineSpacing: 2, resolution: 3 }).setOrigin(0, 0);
                const negTextObj = this.scene.add.text(cardX + 15, 180 + posTextObj.height + 4, negStr.trim(), { fontFamily: UIHelpers.FONT, fontSize: '12px', color: '#ff4444', lineSpacing: 2, resolution: 3 }).setOrigin(0, 0);

                // BUY BUTTON
                const buyBtnBg = this.scene.add.graphics();
                buyBtnBg.fillStyle(0x2e7d32, 1); 
                buyBtnBg.fillRoundedRect(cardX + 30, 390, 180, 40, 20);
                const buyText = this.scene.add.text(cardX + 120, 410, `BUY 💰 ${item.price || item.Price}`, { fontFamily: UIHelpers.FONT, fontSize: '16px', fontStyle: 'bold', color: '#ffffff', resolution: 3 }).setOrigin(0.5);
                
                const buyHitbox = this.scene.add.rectangle(cardX + 120, 410, 180, 40, 0x000000, 0).setInteractive({ useHandCursor: true });
                buyHitbox.on('pointerdown', () => this.connection.invoke("BuyItem", configId).catch((err: any) => console.error(err)));
                buyHitbox.on('pointerover', () => { buyBtnBg.clear(); buyBtnBg.fillStyle(0x4caf50, 1); buyBtnBg.fillRoundedRect(cardX + 30, 390, 180, 40, 20); });
                buyHitbox.on('pointerout', () => { buyBtnBg.clear(); buyBtnBg.fillStyle(0x2e7d32, 1); buyBtnBg.fillRoundedRect(cardX + 30, 390, 180, 40, 20); });

                // LOCK BUTTON
                const lockBtnBg = this.scene.add.graphics();
                lockBtnBg.fillStyle(isLocked ? 0x443300 : 0x2a303a, 1);
                lockBtnBg.fillRoundedRect(cardX + 70, 440, 100, 26, 13);
                const lockText = this.scene.add.text(cardX + 120, 453, isLocked ? '🔒 LOCKED' : '🔓 Lock', { fontFamily: UIHelpers.FONT, fontSize: '12px', color: isLocked ? '#ffb300' : '#8892a0', resolution: 3 }).setOrigin(0.5);
                
                const lockHitbox = this.scene.add.rectangle(cardX + 120, 453, 100, 26, 0x000000, 0).setInteractive({ useHandCursor: true });
                lockHitbox.on('pointerdown', () => this.connection.invoke("ToggleLock", configId).catch((err: any) => console.error(err)));

                // TOOLTIP HOVER
                const cardHitbox = this.scene.add.rectangle(cardX + 120, 240, 240, 480, 0x000000, 0).setInteractive();
                cardHitbox.on('pointerover', (p: Phaser.Input.Pointer) => {
                    cardBg.lineStyle(3, 0xffffff, 1); cardBg.strokeRoundedRect(cardX, 0, 240, 480, 12);
                    
                    const tooltipData = config ? { ...config } : {};
                    tooltipData.tier = tier;
                    tooltipData.name = item.name || item.Name;
                    if (item.rolledStats || item.RolledStats) tooltipData.statBonuses = { ...(tooltipData.statBonuses || {}), ...(item.rolledStats || item.RolledStats) };
                    
                    const skillsList = item.weaponSkills || item.WeaponSkills;
                    if (skillsList && skillsList.length > 0) {
                        const skillNames = skillsList.map((id: string) => {
                            const s = (atlasConfigs?.skills || atlasConfigs?.Skills)?.[id];
                            return s ? (s.name || s.Name) : id;
                        });
                        tooltipData.effectsOnPurchase = [ ...(tooltipData.effectsOnPurchase || []), ...skillNames.map((n:string) => `${n}`) ];
                    }
                    this.tooltip.show(tooltipData, p.x, p.y, 1);
                });
                cardHitbox.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.setPosition(p.x + 15, p.y + 15));
                cardHitbox.on('pointerout', () => {
                    cardBg.lineStyle(2, tierColor, 1); cardBg.strokeRoundedRect(cardX, 0, 240, 480, 12);
                    this.tooltip.hide();
                });

                this.shopCardsContainer.add([cardHitbox, divider, nameText, typeText, posTextObj, negTextObj, buyBtnBg, buyText, buyHitbox, lockBtnBg, lockText, lockHitbox]);
            });

        } catch (err) {
            console.error("Safely caught UI Update error to prevent game freeze:", err);
        }
    }
}