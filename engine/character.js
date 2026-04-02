import { Item, SLOT_NAMES } from './item.js';
import { Buff } from './buff.js';

export class Character {
    constructor(name = 'Character', str = 5.0, dex = 5.0, int = 5.0, hp = 100, gear = {}, buffs = []) {
        this.name = name;
        this.baseStr = str;
        this.baseDex = dex;
        this.baseInt = int;
        this.baseHp = hp;
        this.gear = {};
        this.buffs = buffs;

        for (const slot of SLOT_NAMES) {
            if (gear && gear[slot]) {
                this.gear[slot] = gear[slot] instanceof Item ? gear[slot] : new Item(gear[slot]);
            } else {
                this.gear[slot] = new Item({ name: 'Empty', slot: slot });
            }
        }

        this.currentHp = hp;
    }

    resetCombat() {
        this.currentHp = this.effectiveHp();
        for (const item of Object.values(this.gear)) {
            item.currentDurability = item.durability;
        }
    }

    _applyBuffs(base, stat, itemPct = 0, itemPenalty = 0) {
        let flatTotal = 0;
        let pctTotal = 0;
        for (const b of this.buffs) {
            if (b.stat === stat) {
                flatTotal += b.flatValue;
                pctTotal += b.pctValue;
            }
        }
        pctTotal += itemPct;
        pctTotal -= itemPenalty;
        return (base + flatTotal) * (1 + pctTotal / 100);
    }

    effectiveHp() {
        return Math.max(1, Math.round(this._applyBuffs(this.baseHp, 'hp')));
    }

    _itemMod(stat) {
        let total = 0.0;
        for (const item of Object.values(this.gear)) {
            if (item.isEmpty() || item.isBroken()) continue;
            if (stat === 'str') total += item.strModifier;
            else if (stat === 'int') total += item.intModifier;
        }
        return total;
    }

    totalDexPenalty() {
        let total = 0;
        for (const item of Object.values(this.gear)) {
            if (!item.isEmpty() && !item.isBroken()) {
                total += item.dexPenalty;
            }
        }
        return total;
    }

    effectiveStr() {
        return Math.max(0.0, this._applyBuffs(this.baseStr, 'str', this._itemMod('str'), 0));
    }

    effectiveInt() {
        return Math.max(0.0, this._applyBuffs(this.baseInt, 'int', this._itemMod('int'), 0));
    }

    effectiveDex() {
        return Math.max(0.0, this._applyBuffs(this.baseDex, 'dex', 0, this.totalDexPenalty()));
    }

    effectiveCrit(weapon) {
        const basePct = weapon.baseCritChance;
        const intBonusPct = Math.max(0, this.effectiveInt() - 4) * 2.5;
        return Math.min(1.0, (basePct + intBonusPct) / 100);
    }

    isAlive() { return this.currentHp > 0; }

    toDict() {
        const gear = {};
        for (const slot of SLOT_NAMES) {
            gear[slot] = this.gear[slot].toDict();
        }
        return {
            name: this.name,
            baseStr: this.baseStr,
            baseDex: this.baseDex,
            baseInt: this.baseInt,
            baseHp: this.baseHp,
            gear: gear,
            buffs: this.buffs.map(b => b.toDict()),
        };
    }

    static fromDict(d) {
        const gear = {};
        for (const slot of SLOT_NAMES) {
            if (d.gear && d.gear[slot]) {
                const gearData = d.gear[slot];
                if (typeof gearData === 'string') {
                    if (gearData === 'Empty' || gearData === '') {
                        gear[slot] = new Item({ name: 'Empty', slot: slot });
                    } else {
                        gear[slot] = new Item({ name: gearData, slot: slot });
                    }
                } else {
                    gear[slot] = Item.fromDict(gearData);
                }
            } else {
                gear[slot] = new Item({ name: 'Empty', slot: slot });
            }
        }
        const buffs = (d.buffs || []).map(b => Buff.fromDict(b));
        const char = new Character(
            d.name || 'Character',
            d.baseStr ?? 5.0,
            d.baseDex ?? 5.0,
            d.baseInt ?? 5.0,
            d.baseHp ?? 100,
            gear,
            buffs
        );
        char.currentHp = char.effectiveHp();
        return char;
    }
}
