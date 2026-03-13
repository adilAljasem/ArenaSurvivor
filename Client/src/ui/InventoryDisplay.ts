import * as Phaser from 'phaser';
import { Tooltip } from './Tooltip'; 

export class InventoryDisplay extends Phaser.GameObjects.Container {
    private itemGrid: Phaser.GameObjects.Container;
    private weaponGrid: Phaser.GameObjects.Container;
    private tooltip: Tooltip; 

    constructor(scene: Phaser.Scene, x: number, y: number, tooltip: Tooltip) {
        super(scene, x, y);
        this.tooltip = tooltip;

        this.itemGrid = scene.add.container(20, 550);
        const itemTitle = scene.add.text(0, -30, 'Items (Max 5)', { fontSize: '20px', color: '#ffffff', fontStyle: 'bold' });
        this.itemGrid.add(itemTitle);

        this.weaponGrid = scene.add.container(650, 550);
        // Updated title to Max 4
        const weaponTitle = scene.add.text(0, -30, 'Weapons (Max 4)', { fontSize: '20px', color: '#ffffff', fontStyle: 'bold' });
        this.weaponGrid.add(weaponTitle);

        this.add([this.itemGrid, this.weaponGrid]);
        scene.add.existing(this);
    }

    public updateInventory(weapons: any[], items: any[], atlasConfigs: any) {
        // Clear old sprites (keep the text titles)
        this.itemGrid.list.filter(child => child.type !== 'Text').forEach(c => c.destroy());
        this.weaponGrid.list.filter(child => child.type !== 'Text').forEach(c => c.destroy());

        // 1. ITEMS (Max 5 Slots)
        for (let i = 0; i < 5; i++) {
            const slotX = i * 60;
            const slotBg = this.scene.add.rectangle(slotX, 0, 50, 50, 0x111111).setStrokeStyle(2, 0x555555).setOrigin(0, 0);
            this.itemGrid.add(slotBg);

            if (items && items[i]) {
                const itemData = items[i];
                let config = atlasConfigs?.items ? atlasConfigs.items[itemData.configId] : null;
                
                // >>> FIX: Extract the count safely here to prevent the TypeScript error! <<<
                const stackCount = itemData.count || 1;
                
                if (config && config.textureKey) {
                    const icon = this.scene.add.sprite(slotX + 25, 25, config.textureKey);
                    
                    if (config.iconFrame !== undefined) icon.setFrame(config.iconFrame);
                    icon.setScale(config.scale || 1.0);
                    
                    this.itemGrid.add(icon);

                    // Hover logic with safe stackCount
                    slotBg.setInteractive({ useHandCursor: true });
                    slotBg.on('pointerover', (p: Phaser.Input.Pointer) => this.tooltip.show(config, p.x, p.y, stackCount));
                    slotBg.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.setPosition(p.x + 15, p.y + 15));
                    slotBg.on('pointerout', () => this.tooltip.hide());
                }
                
                if (stackCount > 1) {
                    const countTxt = this.scene.add.text(slotX + 45, 45, `x${stackCount}`, { fontSize: '12px', color: '#fff' }).setOrigin(1, 1);
                    this.itemGrid.add(countTxt);
                }
            }
        }

        // 2. WEAPONS (Max 4 Slots, arranged in a 2x2 grid)
        for (let i = 0; i < 4; i++) {
            // Setup the 2x2 grid math
            const col = i % 2; 
            const row = Math.floor(i / 2);
            const slotX = col * 80;
            const slotY = row * 60;

            const slotBg = this.scene.add.rectangle(slotX, slotY, 70, 50, 0x111111).setStrokeStyle(2, 0x555555).setOrigin(0, 0);
            this.weaponGrid.add(slotBg);

            if (weapons && weapons[i]) {
                const weaponData = weapons[i];
                let config = atlasConfigs?.weapons ? atlasConfigs.weapons[weaponData.configId] : null;
                
                // >>> FIX: Extract the level safely here to prevent the TypeScript error! <<<
                const wLevel = weaponData.level || 1;
                
                if (config && config.textureKey) {
                    const icon = this.scene.add.sprite(slotX + 35, slotY + 25, config.textureKey);
                    
                    if (config.iconFrame !== undefined) icon.setFrame(config.iconFrame);
                    icon.setScale(config.scale || 1.0);
                    
                    this.weaponGrid.add(icon);

                    // Hover logic with safe wLevel
                    slotBg.setInteractive({ useHandCursor: true });
                    slotBg.on('pointerover', (p: Phaser.Input.Pointer) => this.tooltip.show(config, p.x, p.y, wLevel));
                    slotBg.on('pointermove', (p: Phaser.Input.Pointer) => this.tooltip.setPosition(p.x + 15, p.y + 15));
                    slotBg.on('pointerout', () => this.tooltip.hide());
                }

                const lvlTxt = this.scene.add.text(slotX + 65, slotY + 45, `Lv.${wLevel}`, { fontSize: '12px', color: '#00ff00' }).setOrigin(1, 1);
                this.weaponGrid.add(lvlTxt);
            }
        }
    }
}