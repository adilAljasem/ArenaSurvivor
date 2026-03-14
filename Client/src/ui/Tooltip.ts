import * as Phaser from 'phaser';

export class Tooltip extends Phaser.GameObjects.Container {
    private bg: Phaser.GameObjects.Rectangle;
    private titleText: Phaser.GameObjects.Text;
    private descText: Phaser.GameObjects.Text;
    private negativeText: Phaser.GameObjects.Text;

    private getLabel(key: string): string {
        const labels: Record<string, string> = {
            maxHp: "❤️ Max HP",
            hpRegen: "🩹 HP Regen",
            lifeSteal: "🧛 % Life Steal",
            speed: "💨 Speed",
            speedPercent: "💨 % Speed",
            meleeDamage: "🗡️ Melee Dmg",
            rangedDamage: "🏹 Ranged Dmg",
            elementalDamage: "🔥 Elemental Dmg",
            engineering: "🔧 Engineering",
            armor: "🛡️ Armor",
            luck: "🍀 Luck",
            harvesting: "🌾 Harvesting",
            dodge: "👻 % Dodge",
            critChance: "💥 Crit Chance",
            critMultiplier: "✖️ Crit Multiplier",
            knockback: "💨 Knockback",
            pierceCount: "🏹 Pierces",
            bounceCount: "🪃 Bounces",
            attackSpeedPercent: "⚡ % Attack Speed", xpGainPercent: "🧠 % XP Gain",
        };
        return labels[key] || `❓ ${key}`;
    }

    private formatVal(key: string, val: number): string {
        const isPct = key.toLowerCase().includes('chance') || key.toLowerCase().includes('percent') || key === 'lifeSteal' || key === 'dodge';
        return isPct ? `${Math.round(val * 100)}%` : `${val}`;
    }

    constructor(scene: Phaser.Scene) {
        super(scene, 0, 0);
        this.setDepth(5000);
        this.setVisible(false);

        this.bg = scene.add.rectangle(0, 0, 240, 100, 0x111111, 0.95).setStrokeStyle(2, 0x555555).setOrigin(0, 0);
        this.titleText = scene.add.text(10, 10, '', { fontSize: '18px', color: '#ffd700', fontStyle: 'bold' });
        this.descText = scene.add.text(10, 35, '', { fontSize: '13px', color: '#aaaaaa', wordWrap: { width: 220 } });
        this.negativeText = scene.add.text(10, 35, '', { fontSize: '13px', color: '#ff4444', wordWrap: { width: 220 } });

        this.add([this.bg, this.titleText, this.descText, this.negativeText]);
        scene.add.existing(this);
    }

    public show(config: any, x: number, y: number, stackCount: number = 1) {
        if (!config) return;
        this.titleText.setText(config.name);

        let posStr = `Tier: ${config.tier || 1}\n`;
        let negStr = '';

        // >>> FIX: TYPED BASE DAMAGE WITH LEVEL MULTIPLIERS <<<
        if (config.meleeDamage || config.rangedDamage || config.elementalDamage) {

            if (config.meleeDamage) posStr += `🗡️ Base Melee: ${config.meleeDamage * stackCount}\n`;
            if (config.rangedDamage) posStr += `🏹 Base Ranged: ${config.rangedDamage * stackCount}\n`;
            if (config.elementalDamage) posStr += `🔥 Base Elemental: ${config.elementalDamage * stackCount}\n`;

            if (config.damageScaling) {
                const scales = Object.entries(config.damageScaling).map(([k, v]) => `${(v as number) * 100}% of ${this.getLabel(k)}`);
                if (scales.length > 0) {
                    posStr += `📈 Scales with: ${scales.join(', ')}\n`;
                }
            }
            posStr += `⏱️ CD: ${config.cooldownSeconds}s\n`;
            if (config.range) posStr += `📏 Range: ${config.range}\n`;
        }

        if (config.mechanics) {
            Object.entries(config.mechanics).forEach(([k, v]) => posStr += `${this.getLabel(k)}: ${this.formatVal(k, (v as number) * stackCount)}\n`);
        }

        if (config.statBonuses) {
            Object.entries(config.statBonuses).forEach(([k, v]) => {
                const num = (v as number) * stackCount;
                if (num >= 0) posStr += `+${this.formatVal(k, num)} ${this.getLabel(k)}\n`;
                else negStr += `${this.formatVal(k, num)} ${this.getLabel(k)}\n`;
            });
        }

        if (config.effectsAtWaveEnd) {
            config.effectsAtWaveEnd.forEach((e: any) => {
                const isPct = e.percentAmount !== 0;
                const val = (isPct ? e.percentAmount : e.flatAmount) * stackCount;
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

        this.descText.setText(posStr.trim());
        this.negativeText.setText(negStr.trim());
        this.negativeText.setY(this.descText.y + this.descText.displayHeight + (posStr ? 5 : 0));

        const totalTextHeight = this.descText.displayHeight + (negStr ? this.negativeText.displayHeight + 5 : 0);
        this.bg.height = Math.max(80, 40 + totalTextHeight + 10);

        // Uses the dynamic scene scale bounds!
        let targetX = x + 15;
        let targetY = y + 15;
        if (targetX + this.bg.width > this.scene.scale.width) targetX = x - this.bg.width - 5;
        if (targetY + this.bg.height > this.scene.scale.height) targetY = y - this.bg.height - 5;

        this.setPosition(targetX, targetY);
        this.setVisible(true);
    }

    public hide() {
        this.setVisible(false);
    }
}