import * as Phaser from 'phaser';
import { HubConnection } from '@microsoft/signalr';
import { StatDisplay } from './StatDisplay';
import { InventoryDisplay } from './InventoryDisplay';
import { Tooltip } from './Tooltip';

export class ShopUI extends Phaser.GameObjects.Container {
    private statDisplay: StatDisplay;
    private inventoryDisplay: InventoryDisplay;
    private shopCardsContainer: Phaser.GameObjects.Container;
    private headerText: Phaser.GameObjects.Text;
    private rerollButtonContainer: Phaser.GameObjects.Container;
    private rerollText: Phaser.GameObjects.Text;
    private connection: HubConnection;
    private tooltip: Tooltip;

    private getLabel(key: string): string {
        const labels: Record<string, string> = {
            maxHp: "❤️ Max HP", hpRegen: "🩹 HP Regen", lifeSteal: "🧛 % Life Steal",
            speed: "💨 Speed", speedPercent: "💨 % Speed", meleeDamage: "🗡️ Melee Dmg",
            rangedDamage: "🏹 Ranged Dmg", elementalDamage: "🔥 Elemental Dmg",
            engineering: "🔧 Engineering", armor: "🛡️ Armor", luck: "🍀 Luck",
            harvesting: "🌾 Harvesting", dodge: "👻 % Dodge", critChance: "💥 Crit Chance",
            critMultiplier: "✖️ Crit Multiplier", knockback: "💨 Knockback",
            pierceCount: "🏹 Pierces", bounceCount: "🪃 Bounces"
        };
        return labels[key] || `❓ ${key}`;
    }

    private formatVal(key: string, val: number): string {
        const isPct = key.toLowerCase().includes('chance') || key.toLowerCase().includes('percent') || key === 'lifeSteal' || key === 'dodge';
        return isPct ? `${Math.round(val * 100)}%` : `${val}`;
    }

    constructor(scene: Phaser.Scene, connection: HubConnection) {
        super(scene, 0, 0);
        this.connection = connection;

        const overlay = scene.add.rectangle(0, 0, 1280, 720, 0x000000, 0.85).setOrigin(0, 0);
        this.add(overlay);

        // UI Polish: Removed duplicate gold counter
        this.headerText = scene.add.text(40, 20, 'Shop (Wave 1)', { fontSize: '32px', color: '#ffffff', fontStyle: 'bold' });
        this.add(this.headerText);

        this.rerollButtonContainer = scene.add.container(750, 40);
        const rerollBg = scene.add.rectangle(0, 0, 180, 50, 0x222222).setStrokeStyle(2, 0xffffff);
        this.rerollText = scene.add.text(0, 0, 'REROLL - 💰 2', { fontSize: '20px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);

        rerollBg.setInteractive({ useHandCursor: true });
        rerollBg.on('pointerdown', () => this.connection.invoke("RerollShop").catch((err: any) => console.error(err)));
        rerollBg.on('pointerover', () => rerollBg.setFillStyle(0x444444));
        rerollBg.on('pointerout', () => rerollBg.setFillStyle(0x222222));
        this.rerollButtonContainer.add([rerollBg, this.rerollText]);
        this.add(this.rerollButtonContainer);

        this.tooltip = new Tooltip(scene);
        this.statDisplay = new StatDisplay(scene, 1010, 20);
        this.inventoryDisplay = new InventoryDisplay(scene, 0, 0, this.tooltip);
        this.add([this.statDisplay, this.inventoryDisplay]);

        this.shopCardsContainer = scene.add.container(120, 100);
        this.add(this.shopCardsContainer);

        scene.add.existing(this);
    }

    public updateUIData(uiData: any, atlasConfigs: any) {
        if (!uiData) return;

        this.headerText.setText(`Shop (Wave ${uiData.currentWave})`);
        const cost = uiData.currentRerollCost || 2;
        this.rerollText.setText(`REROLL - 💰 ${cost}`);
        this.rerollText.setColor(uiData.gold >= cost ? '#ffffff' : '#ff0000');

        this.statDisplay.updateStats(uiData.stats);
        this.inventoryDisplay.updateInventory(uiData.weapons, uiData.ownedItems, atlasConfigs);

        this.shopCardsContainer.removeAll(true);
        if (!uiData.currentShop) return;

        uiData.currentShop.forEach((item: any, index: number) => {
            const cardX = index * 280;
            const cardBg = this.scene.add.rectangle(cardX, 0, 240, 430, 0x1a1a1a).setOrigin(0, 0).setStrokeStyle(3, item.isLocked ? 0xffd700 : 0x555555);
            cardBg.setInteractive({ useHandCursor: true });

            let config = undefined;
            let isWeapon = false; // <<< NEW: Identify if it is a weapon

            if (atlasConfigs?.items && atlasConfigs.items[item.configId]) {
                config = atlasConfigs.items[item.configId];
            } else if (atlasConfigs?.weapons && atlasConfigs.weapons[item.configId]) {
                config = atlasConfigs.weapons[item.configId];
                isWeapon = true;
            }

            // --- UI POLISH: THE CLEAN CARD HEADER ---

            // 1. Image firmly locked to the left side
            if (config && config.textureKey) {
                const icon = this.scene.add.sprite(cardX + 40, 45, config.textureKey);
                if (config.iconFrame !== undefined) icon.setFrame(config.iconFrame);
                icon.setScale((config.scale || 1.0) * 1.5);
                this.shopCardsContainer.add(icon);
            }

            // 2. Name printed next to the image
            const nameText = this.scene.add.text(cardX + 75, 30, item.name || "Unknown", { fontSize: '18px', color: '#fff', fontStyle: 'bold' }).setOrigin(0, 0.5);

            // 3. Item/Weapon Type printed under the name
            const typeStr = isWeapon ? "Weapon" : "Item";
            const typeColor = isWeapon ? '#ffaaaa' : '#aaaaff';
            const typeText = this.scene.add.text(cardX + 75, 50, typeStr, { fontSize: '14px', color: typeColor, fontStyle: 'italic' }).setOrigin(0, 0.5);

            // 4. A clean graphical divider line
            const divider = this.scene.add.rectangle(cardX + 120, 75, 220, 2, 0x333333).setOrigin(0.5);

            // --- BUILD STAT STRINGS ---
            let posStr = `Tier: ${config?.tier || 1}\n`;
            let negStr = '';

            if (config) {
                if (config.damage) {
                    // >>> SMART WEAPON LABELS <<<
                    let dmgLabel = "⚔️ Base Dmg";
                    if (config.damageScaling) {
                        if (config.damageScaling["rangedDamage"]) dmgLabel = "🏹 Ranged Dmg";
                        else if (config.damageScaling["meleeDamage"]) dmgLabel = "🗡️ Melee Dmg";
                        else if (config.damageScaling["elementalDamage"]) dmgLabel = "🔥 Elemental Dmg";
                    }
                    posStr += `${dmgLabel}: ${config.damage}`;

                    if (config.damageScaling) {
                        const scales = Object.entries(config.damageScaling).map(([k, v]) => `${(v as number) * 100}% ${this.getLabel(k)}`);
                        if (scales.length > 0) posStr += ` (+${scales.join(', ')})`;
                    }
                    posStr += `\n⏱️ CD: ${config.cooldownSeconds}s\n`;
                    if (config.range) posStr += `📏 Range: ${config.range}\n`;
                }

                if (config.mechanics) {
                    Object.entries(config.mechanics).forEach(([k, v]) => posStr += `${this.getLabel(k)}: ${this.formatVal(k, v as number)}\n`);
                }
                if (config.statBonuses) {
                    Object.entries(config.statBonuses).forEach(([k, v]) => {
                        const num = v as number;
                        if (num >= 0) posStr += `+${this.formatVal(k, num)} ${this.getLabel(k)}\n`;
                        else negStr += `${this.formatVal(k, num)} ${this.getLabel(k)}\n`;
                    });
                }
                if (config.effectsAtWaveEnd) {
                    config.effectsAtWaveEnd.forEach((e: any) => {
                        const isPct = e.percentAmount !== 0;
                        const val = isPct ? e.percentAmount : e.flatAmount;
                        if (val > 0) posStr += `+${this.formatVal(isPct ? 'percent' : e.statName, val)} ${this.getLabel(e.statName)} at wave end\n`;
                        else if (val < 0) negStr += `${this.formatVal(isPct ? 'percent' : e.statName, val)} ${this.getLabel(e.statName)} at wave end\n`;
                    });
                }
                if (config.dynamicModifiers) {
                    config.dynamicModifiers.forEach((m: any) => {
                        const isPct = m.bonusPercent !== 0;
                        const valStr = isPct ? `${m.bonusPercent * 100}%` : `${m.bonusFlat}`;
                        posStr += `+${valStr} ${this.getLabel(m.targetStat)} per ${m.conditionThreshold * 100}% ${m.conditionType.replace('MissingHealthPercent', 'missing HP')}\n`;
                    });
                }
                if (config.effectsOnPurchase) config.effectsOnPurchase.forEach((e: string) => posStr += `🔹 ${e}\n`);
                if (config.traits) config.traits.forEach((t: string) => {
                    if (t === "CannotHeal") negStr += `(You can't heal in any way)\n`;
                    else posStr += `🔹 ${t}\n`;
                });
            }

            // Moved the text down slightly to fit the new header and divider
            const posTextObj = this.scene.add.text(cardX + 10, 85, posStr.trim(), { fontSize: '13px', color: '#bbbbbb', wordWrap: { width: 220 } }).setOrigin(0, 0);
            const negTextObj = this.scene.add.text(cardX + 10, 85 + posTextObj.height + 4, negStr.trim(), { fontSize: '13px', color: '#ff4444', wordWrap: { width: 220 } }).setOrigin(0, 0);

            // --- BUY AND LOCK BUTTONS ---
            const buyBtnBg = this.scene.add.rectangle(cardX + 120, 340, 160, 45, 0x44aa44).setOrigin(0.5);
            // UI Polish: Merged price and buy button text
            const buyText = this.scene.add.text(cardX + 120, 340, `BUY - 💰 ${item.price}`, { fontSize: '18px', fontStyle: 'bold' }).setOrigin(0.5);

            buyBtnBg.setInteractive({ useHandCursor: true });
            buyBtnBg.on('pointerdown', () => this.connection.invoke("BuyItem", item.configId).catch((err: any) => console.error(err)));

            const lockBtnBg = this.scene.add.rectangle(cardX + 120, 395, 100, 30, 0x333333).setOrigin(0.5).setStrokeStyle(1, 0x777777);
            const lockText = this.scene.add.text(cardX + 120, 395, item.isLocked ? '🔒 LOCKED' : '🔓 Lock', { fontSize: '14px', color: item.isLocked ? '#ffd700' : '#ffffff' }).setOrigin(0.5);
            lockBtnBg.setInteractive({ useHandCursor: true });
            lockBtnBg.on('pointerdown', () => this.connection.invoke("ToggleLock", item.configId).catch((err: any) => console.error(err)));

            cardBg.on('pointerover', () => cardBg.setStrokeStyle(3, 0xffffff));
            cardBg.on('pointerout', () => cardBg.setStrokeStyle(3, item.isLocked ? 0xffd700 : 0x555555));

            this.shopCardsContainer.add([cardBg, divider, nameText, typeText, posTextObj, negTextObj, buyBtnBg, buyText, lockBtnBg, lockText]);
        });
    }
}