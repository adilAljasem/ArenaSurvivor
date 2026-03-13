import * as Phaser from 'phaser';

export class StatDisplay extends Phaser.GameObjects.Container {
    private statTexts: Map<string, Phaser.GameObjects.Text> = new Map();

    // The master visual dictionary
    private labels: Record<string, string> = {
        maxHp: "❤️ Max HP", hpRegen: "🩹 HP Regen", lifeSteal: "🧛 % Life Steal",
        damagePercent: "💥 % Damage", meleeDamage: "🗡️ Melee Dmg", rangedDamage: "🏹 Ranged Dmg",
        elementalDamage: "🔥 Elemental Dmg", speed: "💨 Speed", speedPercent: "💨 % Speed",
        range: "📏 Range", engineering: "🔧 Engineering", armor: "🛡️ Armor",
        dodge: "👻 % Dodge", luck: "🍀 Luck", harvesting: "🌾 Harvesting"
    };

    // >>> FIX: Automatically attach the ❓ fallback for unknown stats! <<<
    private getLabel(key: string): string {
        return this.labels[key] || `❓ ${key}`;
    }

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y);

        const bg = scene.add.rectangle(0, 0, 250, 600, 0x1a1a1a, 0.95).setOrigin(0, 0).setStrokeStyle(2, 0x555555);
        const title = scene.add.text(125, 20, 'Stats', { fontSize: '28px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0);
        this.add([bg, title]);

        scene.add.existing(this);
    }

    public updateStats(statsPayload: any) {
        if (!statsPayload) return;

        // >>> FIX: Generate the UI dynamically the first time it receives data! <<<
        if (this.statTexts.size === 0) {
            let index = 0;
            // It loops over EVERY stat the server sends in the dictionary
            Object.keys(statsPayload).forEach(key => {
                const labelText = this.scene.add.text(15, 70 + (index * 25), this.getLabel(key), { fontSize: '14px', color: '#aaaaaa' });
                const valueText = this.scene.add.text(230, 70 + (index * 25), '0', { fontSize: '14px', color: '#00ff00', fontStyle: 'bold' }).setOrigin(1, 0);

                this.add([labelText, valueText]);
                this.statTexts.set(key, valueText);
                index++;
            });
        }

        // Update the values
        Object.entries(statsPayload).forEach(([key, val]) => {
            if (this.statTexts.has(key)) {
                const isPct = key.toLowerCase().includes('chance') || key.toLowerCase().includes('percent') || key === 'lifeSteal' || key === 'dodge';
                const num = val as number;
                const textStr = isPct ? `${Math.round(num * 100)}%` : Math.round(num).toString();
                this.statTexts.get(key)!.setText(textStr);
            }
        });
    }
}