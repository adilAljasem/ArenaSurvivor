import * as Phaser from 'phaser';
import { HubConnection } from '@microsoft/signalr';

// =========================================================================
// SHARED UI HELPERS & TYPOGRAPHY
// =========================================================================
export const UIHelpers = {
    FONT: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    
    getLabel: (key: string): string => {
        const labels: Record<string, string> = {
            maxHp: "❤️ Max HP", hpRegen: "🩹 HP Regen", lifeSteal: "🧛 % Life Steal",
            speed: "💨 Speed", meleeDamage: "🗡️ Melee Dmg", 
            rangedDamage: "🏹 Ranged Dmg", elementalDamage: "🔥 Elemental Dmg",
            engineering: "🔧 Engineering", armor: "🛡️ Armor", luck: "🍀 Luck",
            harvesting: "🌾 Harvesting", dodge: "👻 % Dodge", critChance: "💥 Crit Chance",
            critMultiplier: "✖️ Crit Multiplier", knockback: "💨 Knockback",
            pierceCount: "🏹 Pierces", bounceCount: "🪃 Bounces",
            attackSpeedPercent: "⚡ % Attack Speed", xpGainPercent: "🧠 % XP Gain",
            damagePercent: "💥 % Damage"
        };
        return labels[key] || `❓ ${key}`;
    },

    formatVal: (key: string, val: number): string => {
        const isPct = key.toLowerCase().includes('percent') || key === 'lifeSteal' || key === 'dodge';
        return isPct ? `${Math.round(val * 100)}%` : `${val}`;
    }
};

// =========================================================================
// TOOLTIP
// =========================================================================
export class Tooltip extends Phaser.GameObjects.Container {
    private bg: Phaser.GameObjects.Rectangle;
    private titleText: Phaser.GameObjects.Text;
    private descText: Phaser.GameObjects.Text;
    private negativeText: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene) {
        super(scene, 0, 0);
        this.setDepth(5000);
        this.setVisible(false);

        this.bg = scene.add.rectangle(0, 0, 240, 100, 0x111111, 0.95).setStrokeStyle(2, 0x555555).setOrigin(0, 0);
        
        // >>> RESOLUTION: 3 APPLIED EVERYWHERE <<<
        this.titleText = scene.add.text(10, 10, '', { fontFamily: UIHelpers.FONT, fontSize: '18px', color: '#ffd700', fontStyle: 'bold', resolution: 3 });
        this.descText = scene.add.text(10, 35, '', { fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#aaaaaa', wordWrap: { width: 220 }, resolution: 3 });
        this.negativeText = scene.add.text(10, 35, '', { fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#ff4444', wordWrap: { width: 220 }, resolution: 3 });

        this.add([this.bg, this.titleText, this.descText, this.negativeText]);
        scene.add.existing(this);
    }

    public show(config: any, x: number, y: number, stackCount: number = 1) { 
        if (!config) return;
        this.titleText.setText(config.name);

        let posStr = `Tier: ${config.tier || 1}\n`;
        let negStr = '';

        if (config.meleeDamage || config.rangedDamage || config.elementalDamage) {
            if (config.meleeDamage) posStr += `🗡️ Base Melee: ${config.meleeDamage * stackCount}\n`;
            if (config.rangedDamage) posStr += `🏹 Base Ranged: ${config.rangedDamage * stackCount}\n`;
            if (config.elementalDamage) posStr += `🔥 Base Elemental: ${config.elementalDamage * stackCount}\n`;
            
            if (config.damageScaling) {
                const scales = Object.entries(config.damageScaling).map(([k, v]) => `${(v as number)*100}% of ${UIHelpers.getLabel(k)}`);
                if (scales.length > 0) posStr += `📈 Scales with: ${scales.join(', ')}\n`;
            }
            posStr += `⏱️ CD: ${config.cooldownSeconds}s\n`;
            if (config.range) posStr += `📏 Range: ${config.range}\n`;
        }

        if (config.mechanics) Object.entries(config.mechanics).forEach(([k, v]) => posStr += `${UIHelpers.getLabel(k)}: ${UIHelpers.formatVal(k, (v as number) * stackCount)}\n`);
        
        if (config.statBonuses) {
            Object.entries(config.statBonuses).forEach(([k, v]) => {
                const num = (v as number) * stackCount;
                if (num >= 0) posStr += `+${UIHelpers.formatVal(k, num)} ${UIHelpers.getLabel(k)}\n`;
                else negStr += `${UIHelpers.formatVal(k, num)} ${UIHelpers.getLabel(k)}\n`;
            });
        }

        if (config.effectsAtWaveEnd) {
            config.effectsAtWaveEnd.forEach((e: any) => {
                const isPct = e.statName.toLowerCase().includes('percent') || e.statName === 'lifeSteal' || e.statName === 'dodge';
                const val = e.amount * stackCount;
                const valStr = isPct ? `${Math.round(val * 100)}%` : `${val}`;
                const prefix = val > 0 ? '+' : '';
                posStr += `${prefix}${valStr} ${UIHelpers.getLabel(e.statName)} at wave end\n`;
            });
        }

        if (config.dynamicModifiers) {
            config.dynamicModifiers.forEach((m: any) => {
                const isPct = m.targetStat.toLowerCase().includes('percent') || m.targetStat === 'lifeSteal' || m.targetStat === 'dodge';
                const valStr = isPct ? `${Math.round(m.amount * 100)}%` : `${m.amount}`;
                const prefix = m.amount > 0 ? '+' : '';
                posStr += `${prefix}${valStr} ${UIHelpers.getLabel(m.targetStat)} per ${Math.round(m.conditionThreshold * 100)}% ${m.conditionType.replace('MissingHealthPercent', 'missing HP')}\n`;
            });
        }

        if (config.effectsOnPurchase) config.effectsOnPurchase.forEach((e: string) => posStr += `🔹 ${e}\n`);
        if (config.traits) config.traits.forEach((t: string) => {
            if (t === "CannotHeal") negStr += `(You can't heal in any way)\n`;
            else posStr += `🔹 ${t}\n`;
        });

        this.descText.setText(posStr.trim());
        this.negativeText.setText(negStr.trim());
        this.negativeText.setY(this.descText.y + this.descText.displayHeight + (posStr ? 5 : 0));

        const totalTextHeight = this.descText.displayHeight + (negStr ? this.negativeText.displayHeight + 5 : 0);
        this.bg.height = Math.max(80, 40 + totalTextHeight + 10);

        let targetX = x + 15;
        let targetY = y + 15;
        if (targetX + this.bg.width > this.scene.scale.width) targetX = x - this.bg.width - 5;
        if (targetY + this.bg.height > this.scene.scale.height) targetY = y - this.bg.height - 5;

        this.setPosition(targetX, targetY);
        this.setVisible(true);
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
        const bg = scene.add.rectangle(0, 0, 240, 560, 0x1a1a1a, 0.95).setOrigin(0, 0).setStrokeStyle(2, 0x555555);
        const title = scene.add.text(120, 15, 'Stats', { fontFamily: UIHelpers.FONT, fontSize: '26px', color: '#ffffff', fontStyle: 'bold', resolution: 3 }).setOrigin(0.5, 0);
        
        this.levelText = scene.add.text(120, 45, 'Level: 1', { fontFamily: UIHelpers.FONT, fontSize: '18px', color: '#ffd700', fontStyle: 'bold', resolution: 3 }).setOrigin(0.5, 0);

        this.add([bg, title, this.levelText]);
        scene.add.existing(this);
    }

    public updateStats(statsPayload: any, level: number = 1) {
        if (!statsPayload) return;

        this.levelText.setText(`Level: ${level}`);

        if (this.statTexts.size === 0) {
            let index = 0;
            Object.keys(statsPayload).forEach(key => {
                const labelText = this.scene.add.text(15, 80 + (index * 24), UIHelpers.getLabel(key), { fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#aaaaaa', resolution: 3 });
                const valueText = this.scene.add.text(220, 80 + (index * 24), '0', { fontFamily: UIHelpers.FONT, fontSize: '14px', color: '#00ff00', fontStyle: 'bold', resolution: 3 }).setOrigin(1, 0);
                this.add([labelText, valueText]);
                this.statTexts.set(key, valueText);
                index++;
            });
        }

        Object.entries(statsPayload).forEach(([key, val]) => {
            if (this.statTexts.has(key)) {
                this.statTexts.get(key)!.setText(UIHelpers.formatVal(key, val as number));
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
        const itemTitle = scene.add.text(0, -25, 'Items', { fontFamily: UIHelpers.FONT, fontSize: '18px', color: '#ffffff', fontStyle: 'bold', resolution: 3 });
        this.itemGrid.add(itemTitle);

        this.weaponGrid = scene.add.container(320, 0);
        const weaponTitle = scene.add.text(0, -25, 'Weapons', { fontFamily: UIHelpers.FONT, fontSize: '18px', color: '#ffffff', fontStyle: 'bold', resolution: 3 });
        this.weaponGrid.add(weaponTitle);

        this.add([this.itemGrid, this.weaponGrid]);
        scene.add.existing(this);
    }

    public updateInventory(weapons: any[], items: any[], atlasConfigs: any) {
        this.itemGrid.list.filter(child => child.type !== 'Text').forEach(c => c.destroy());
        this.weaponGrid.list.filter(child => child.type !== 'Text').forEach(c => c.destroy());

        for (let i = 0; i < 5; i++) {
            const slotX = i * 55;
            const slotBg = this.scene.add.rectangle(slotX, 0, 50, 50, 0x111111).setStrokeStyle(2, 0x555555).setOrigin(0, 0);
            this.itemGrid.add(slotBg);

            if (items && items[i]) {
                const itemData = items[i];
                let config = atlasConfigs?.items ? atlasConfigs.items[itemData.configId] : null;
                const stackCount = itemData.count || 1;
                
                let icon;
                if (config && config.textureKey && config.textureKey.trim() !== "" && this.scene.textures.exists(config.textureKey)) {
                    icon = this.scene.add.sprite(slotX + 25, 25, config.textureKey);
                    if (config.iconFrame !== undefined) icon.setFrame(config.iconFrame);
                    icon.setScale(config.scale || 1.0);
                } else {
                    icon = this.scene.add.rectangle(slotX + 25, 25, 24, 24, 0x000000).setStrokeStyle(2, 0x00ff00);
                }
                this.itemGrid.add(icon);

                if (config) {
                    slotBg.setInteractive({ useHandCursor: true });
                    slotBg.on('pointerover', (p: Phaser.Input.Pointer) => this.tooltip.show(config, p.x, p.y, stackCount));
                    slotBg.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.setPosition(p.x + 15, p.y + 15));
                    slotBg.on('pointerout', () => this.tooltip.hide());
                }

                if (stackCount > 1) {
                    const countTxt = this.scene.add.text(slotX + 45, 45, `x${stackCount}`, { fontFamily: UIHelpers.FONT, fontSize: '12px', color: '#fff', stroke: '#000', strokeThickness: 3, resolution: 3 }).setOrigin(1, 1);
                    this.itemGrid.add(countTxt);
                }
            }
        }

        for (let i = 0; i < 4; i++) {
            const col = i % 2; 
            const row = Math.floor(i / 2);
            const slotX = col * 60;
            const slotY = row * 55;

            const slotBg = this.scene.add.rectangle(slotX, slotY, 55, 50, 0x111111).setStrokeStyle(2, 0x555555).setOrigin(0, 0);
            this.weaponGrid.add(slotBg);

            if (weapons && weapons[i]) {
                const weaponData = weapons[i];
                let config = atlasConfigs?.weapons ? atlasConfigs.weapons[weaponData.configId] : null;
                const wLevel = weaponData.level || 1;
                
                let icon;
                if (config && config.textureKey && config.textureKey.trim() !== "" && this.scene.textures.exists(config.textureKey)) {
                    icon = this.scene.add.sprite(slotX + 27, slotY + 25, config.textureKey);
                    if (config.iconFrame !== undefined) icon.setFrame(config.iconFrame);
                    icon.setScale(config.scale || 1.0);
                } else {
                    icon = this.scene.add.rectangle(slotX + 27, slotY + 25, 24, 24, 0x000000).setStrokeStyle(2, 0x00ff00);
                }
                this.weaponGrid.add(icon);

                if (config) {
                    slotBg.setInteractive({ useHandCursor: true });
                    slotBg.on('pointerover', (p: Phaser.Input.Pointer) => this.tooltip.show(config, p.x, p.y, wLevel));
                    slotBg.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.setPosition(p.x + 15, p.y + 15));
                    slotBg.on('pointerout', () => this.tooltip.hide());
                }

                const lvlTxt = this.scene.add.text(slotX + 52, slotY + 47, `Lv.${wLevel}`, { fontFamily: UIHelpers.FONT, fontSize: '11px', color: '#00ff00', stroke: '#000', strokeThickness: 2, resolution: 3 }).setOrigin(1, 1);
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

        const overlay = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, 0x000000, 0.90).setOrigin(0, 0);
        this.add(overlay);

        this.headerText = scene.add.text(0, 0, 'Shop (Wave 1)', { fontFamily: UIHelpers.FONT, fontSize: '32px', color: '#ffffff', fontStyle: 'bold', resolution: 3 });
        this.add(this.headerText);

        this.rerollButtonContainer = scene.add.container(0, 0);
        const rerollBg = scene.add.rectangle(0, 0, 160, 45, 0x222222).setStrokeStyle(2, 0xffffff);
        this.rerollText = scene.add.text(0, 0, 'REROLL - 💰 2', { fontFamily: UIHelpers.FONT, fontSize: '18px', color: '#ffffff', fontStyle: 'bold', resolution: 3 }).setOrigin(0.5);

        rerollBg.setInteractive({ useHandCursor: true });
        rerollBg.on('pointerdown', () => this.connection.invoke("RerollShop").catch((err: any) => console.error(err)));
        rerollBg.on('pointerover', () => rerollBg.setFillStyle(0x444444));
        rerollBg.on('pointerout', () => rerollBg.setFillStyle(0x222222));
        this.rerollButtonContainer.add([rerollBg, this.rerollText]);
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

    private updateLayout(width: number, height: number) {
        let scale = Math.min(width / 1280, height / 720);
        scale = Phaser.Math.Clamp(scale, 0.5, 3.0); 

        this.headerText.setScale(scale);
        this.rerollButtonContainer.setScale(scale);
        this.statDisplay.setScale(scale);
        this.inventoryDisplay.setScale(scale);

        const statsWidth = 240 * scale;
        this.statDisplay.setPosition(width - statsWidth, Math.max(20, (height - (560 * scale)) / 2));
        this.inventoryDisplay.setPosition(40 * scale, height - (130 * scale)); 

        const availableWidth = width - statsWidth - (40 * scale); 
        const rawCardsWidth = 3 * 280; 
        
        let cardScale = Math.min(scale, availableWidth / rawCardsWidth);
        this.shopCardsContainer.setScale(cardScale);
        this.levelUpContainer.setScale(cardScale);

        this.headerText.setPosition(40 * scale, 50 * scale).setOrigin(0, 0.5);
        this.rerollButtonContainer.setPosition(availableWidth / 2, 50 * scale);
        
        const cardsActualWidth = rawCardsWidth * cardScale;
        const centerX = (availableWidth - cardsActualWidth) / 2;
        const centerY = (height - (460 * cardScale)) / 2;
        
        this.shopCardsContainer.setPosition(centerX + (120 * cardScale), centerY);
        this.levelUpContainer.setPosition(centerX + (120 * cardScale), centerY);
    }

    public updateUIData(uiData: any, atlasConfigs: any) {
        if (!uiData) return;

        this.statDisplay.updateStats(uiData.stats, uiData.level || 1);
        this.inventoryDisplay.updateInventory(uiData.weapons, uiData.ownedItems, atlasConfigs);

        this.shopCardsContainer.removeAll(true);
        this.levelUpContainer.removeAll(true);

        if (uiData.pendingLevelUps > 0) {
            this.shopCardsContainer.setVisible(false);
            this.rerollButtonContainer.setVisible(false);
            this.levelUpContainer.setVisible(true);
            
            this.headerText.setText(`LEVEL UP! (x${uiData.pendingLevelUps})`);
            this.headerText.setColor('#00ff00');

            uiData.levelUpChoices.forEach((card: any, index: number) => {
                const cardX = index * 280;
                const cardBg = this.scene.add.rectangle(cardX, 0, 240, 320, 0x1a1a1a).setOrigin(0, 0).setStrokeStyle(3, 0xffd700);
                cardBg.setInteractive({ useHandCursor: true });
                cardBg.on('pointerdown', () => this.connection.invoke("SelectLevelUpStat", card.id).catch((err: any) => console.error(err)));
                cardBg.on('pointerover', () => cardBg.setStrokeStyle(3, 0xffffff));
                cardBg.on('pointerout', () => cardBg.setStrokeStyle(3, 0xffd700));

                const nameText = this.scene.add.text(cardX + 120, 50, card.name, { fontFamily: UIHelpers.FONT, fontSize: '24px', color: '#fff', fontStyle: 'bold', resolution: 3 }).setOrigin(0.5);
                const tierText = this.scene.add.text(cardX + 120, 80, `Tier ${card.tier}`, { fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#aaa', resolution: 3 }).setOrigin(0.5);

                const isPct = card.statName.toLowerCase().includes('percent') || card.statName === 'lifeSteal' || card.statName === 'dodge';
                const valStr = isPct ? `+${Math.round(card.amount * 100)}%` : `+${card.amount}`;
                
                const statText = this.scene.add.text(cardX + 120, 160, `${valStr}\n${UIHelpers.getLabel(card.statName)}`, { fontFamily: UIHelpers.FONT, fontSize: '22px', color: '#00ff00', fontStyle: 'bold', align: 'center', resolution: 3 }).setOrigin(0.5);

                this.levelUpContainer.add([cardBg, nameText, tierText, statText]);
            });
            return; 
        }

        this.levelUpContainer.setVisible(false);
        this.shopCardsContainer.setVisible(true);
        this.rerollButtonContainer.setVisible(true);
        
        this.headerText.setText(`Shop (Wave ${uiData.currentWave})`);
        this.headerText.setColor('#ffffff');
        const cost = uiData.currentRerollCost || 2;
        this.rerollText.setText(`REROLL - 💰 ${cost}`);
        this.rerollText.setColor(uiData.gold >= cost ? '#ffffff' : '#ff0000');

        if (!uiData.currentShop) return;

        uiData.currentShop.forEach((item: any, index: number) => {
            const cardX = index * 280;
            const cardBg = this.scene.add.rectangle(cardX, 0, 240, 460, 0x1a1a1a).setOrigin(0, 0).setStrokeStyle(3, item.isLocked ? 0xffd700 : 0x555555);
            cardBg.setInteractive({ useHandCursor: true });

            let config = undefined;
            let isWeapon = false; 

            if (atlasConfigs?.items && atlasConfigs.items[item.configId]) {
                config = atlasConfigs.items[item.configId];
            } else if (atlasConfigs?.weapons && atlasConfigs.weapons[item.configId]) {
                config = atlasConfigs.weapons[item.configId];
                isWeapon = true;
            }

            if (config && config.textureKey && config.textureKey.trim() !== "" && this.scene.textures.exists(config.textureKey)) {
                const icon = this.scene.add.sprite(cardX + 120, 65, config.textureKey);
                if (config.iconFrame !== undefined) icon.setFrame(config.iconFrame);
                icon.setScale((config.scale || 1.0) * 2.5); 
                this.shopCardsContainer.add(icon);
            } else {
                const icon = this.scene.add.rectangle(cardX + 120, 65, 48, 48, 0x000000).setStrokeStyle(2, 0x00ff00);
                this.shopCardsContainer.add(icon);
            }

            const nameText = this.scene.add.text(cardX + 120, 115, item.name || "Unknown", { fontFamily: UIHelpers.FONT, fontSize: '20px', color: '#fff', fontStyle: 'bold', resolution: 3 }).setOrigin(0.5);
            const typeStr = isWeapon ? "Weapon" : "Item";
            const typeColor = isWeapon ? '#ffaaaa' : '#aaaaff';
            const typeText = this.scene.add.text(cardX + 120, 135, typeStr, { fontFamily: UIHelpers.FONT, fontSize: '14px', color: typeColor, fontStyle: 'italic', resolution: 3 }).setOrigin(0.5);
            const divider = this.scene.add.rectangle(cardX + 120, 150, 200, 2, 0x333333).setOrigin(0.5);

            let posStr = `Tier: ${config?.tier || 1}\n`;
            let negStr = '';

            if (config) {
                if (config.meleeDamage || config.rangedDamage || config.elementalDamage) {
                    if (config.meleeDamage) posStr += `🗡️ Base Melee: ${config.meleeDamage}\n`;
                    if (config.rangedDamage) posStr += `🏹 Base Ranged: ${config.rangedDamage}\n`;
                    if (config.elementalDamage) posStr += `🔥 Base Elemental: ${config.elementalDamage}\n`;
                    
                    if (config.damageScaling) {
                        const scales = Object.entries(config.damageScaling).map(([k, v]) => `${(v as number)*100}% of ${UIHelpers.getLabel(k)}`);
                        if (scales.length > 0) posStr += `📈 Scales with: ${scales.join(', ')}\n`;
                    }
                    posStr += `⏱️ CD: ${config.cooldownSeconds}s\n`;
                    if (config.range) posStr += `📏 Range: ${config.range}\n`;
                }

                if (config.mechanics) Object.entries(config.mechanics).forEach(([k, v]) => posStr += `${UIHelpers.getLabel(k)}: ${UIHelpers.formatVal(k, v as number)}\n`);
                
                if (config.statBonuses) {
                    Object.entries(config.statBonuses).forEach(([k, v]) => {
                        const num = v as number;
                        if (num >= 0) posStr += `+${UIHelpers.formatVal(k, num)} ${UIHelpers.getLabel(k)}\n`;
                        else negStr += `${UIHelpers.formatVal(k, num)} ${UIHelpers.getLabel(k)}\n`;
                    });
                }
                if (config.effectsAtWaveEnd) {
                    config.effectsAtWaveEnd.forEach((e: any) => {
                        const isPct = e.statName.toLowerCase().includes('percent') || e.statName === 'lifeSteal' || e.statName === 'dodge';
                        const valStr = isPct ? `${Math.round(e.amount * 100)}%` : `${e.amount}`;
                        const prefix = e.amount > 0 ? '+' : '';
                        posStr += `${prefix}${valStr} ${UIHelpers.getLabel(e.statName)} at wave end\n`;
                    });
                }
                if (config.dynamicModifiers) {
                    config.dynamicModifiers.forEach((m: any) => {
                        const isPct = m.targetStat.toLowerCase().includes('percent') || m.targetStat === 'lifeSteal' || m.targetStat === 'dodge';
                        const valStr = isPct ? `${Math.round(m.amount * 100)}%` : `${m.amount}`;
                        const prefix = m.amount > 0 ? '+' : '';
                        posStr += `${prefix}${valStr} ${UIHelpers.getLabel(m.targetStat)} per ${Math.round(m.conditionThreshold * 100)}% ${m.conditionType.replace('MissingHealthPercent', 'missing HP')}\n`;
                    });
                }
                if (config.effectsOnPurchase) config.effectsOnPurchase.forEach((e: string) => posStr += `🔹 ${e}\n`);
                if (config.traits) config.traits.forEach((t: string) => {
                    if (t === "CannotHeal") negStr += `(You can't heal in any way)\n`;
                    else posStr += `🔹 ${t}\n`;
                });
            }

            const posTextObj = this.scene.add.text(cardX + 15, 165, posStr.trim(), { fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#bbbbbb', wordWrap: { width: 210 }, lineSpacing: 4, resolution: 3 }).setOrigin(0, 0);
            const negTextObj = this.scene.add.text(cardX + 15, 165 + posTextObj.height + 6, negStr.trim(), { fontFamily: UIHelpers.FONT, fontSize: '13px', color: '#ff4444', wordWrap: { width: 210 }, lineSpacing: 4, resolution: 3 }).setOrigin(0, 0);

            const buyBtnBg = this.scene.add.rectangle(cardX + 120, 380, 160, 45, 0x44aa44).setOrigin(0.5);
            const buyText = this.scene.add.text(cardX + 120, 380, `BUY - 💰 ${item.price}`, { fontFamily: UIHelpers.FONT, fontSize: '18px', fontStyle: 'bold', resolution: 3 }).setOrigin(0.5);

            buyBtnBg.setInteractive({ useHandCursor: true });
            buyBtnBg.on('pointerdown', () => this.connection.invoke("BuyItem", item.configId).catch((err: any) => console.error(err)));

            const lockBtnBg = this.scene.add.rectangle(cardX + 120, 435, 100, 25, 0x333333).setOrigin(0.5).setStrokeStyle(1, 0x777777);
            const lockText = this.scene.add.text(cardX + 120, 435, item.isLocked ? '🔒 LOCKED' : '🔓 Lock', { fontFamily: UIHelpers.FONT, fontSize: '13px', color: item.isLocked ? '#ffd700' : '#ffffff', resolution: 3 }).setOrigin(0.5);
            lockBtnBg.setInteractive({ useHandCursor: true });
            lockBtnBg.on('pointerdown', () => this.connection.invoke("ToggleLock", item.configId).catch((err: any) => console.error(err)));

            cardBg.on('pointerover', () => cardBg.setStrokeStyle(3, 0xffffff));
            cardBg.on('pointerout', () => cardBg.setStrokeStyle(3, item.isLocked ? 0xffd700 : 0x555555));

            this.shopCardsContainer.add([cardBg, divider, nameText, typeText, posTextObj, negTextObj, buyBtnBg, buyText, lockBtnBg, lockText]);
        });
    }
}