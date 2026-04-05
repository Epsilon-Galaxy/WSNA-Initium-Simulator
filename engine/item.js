export const RESIST_MULTIPLIERS = {
    'E': 2.0, 'G': 1.5, 'A': 1.0, 'P': 0.75, 'M': 0.5, 'N': 0.0
};

export const RESIST_NAMES = {
    'E': 'Excellent', 'G': 'Good', 'A': 'Average',
    'P': 'Poor', 'M': 'Minimal', 'N': 'None'
};

export const DAMAGE_TYPE_OPTIONS = ['B', 'P', 'S', 'BP', 'BS', 'PS', 'BPS', 'T'];

export const DAMAGE_TYPE_DISPLAY = {
    'B': 'Bludgeoning',
    'P': 'Piercing',
    'S': 'Slashing',
    'BP': 'Bludgeoning/Piercing',
    'BS': 'Bludgeoning/Slashing',
    'PS': 'Piercing/Slashing',
    'BPS': 'All Types',
    'T': 'Typeless'
};

export const SLOT_NAMES = ['helmet', 'chest', 'shirt', 'legs', 'gloves', 'boots',
    'mainhand', 'offhand', 'necklace', 'ring1', 'ring2'];

export const SLOT_DISPLAY = {
    'helmet': 'Helmet', 'chest': 'Chest', 'shirt': 'Shirt', 'legs': 'Legs',
    'gloves': 'Gloves', 'boots': 'Boots', 'hand': 'Hand', 'mainhand': 'Main Hand',
    'offhand': 'Off Hand', 'necklace': 'Necklace', 'ring1': 'Ring', 'ring2': 'Ring',
};

export const BODY_HIT_TABLE = [
    ['helmet', 0.10], ['chest', 0.50], ['legs', 0.30], ['gloves', 0.05], ['boots', 0.05]
];

export const ARMOR_SLOTS = ['helmet', 'chest', 'shirt', 'legs', 'gloves', 'boots'];
export const HAND_SLOTS = ['hand', 'mainhand', 'offhand'];
export const WEAPON_SLOTS = ['hand', 'mainhand', 'offhand'];
export const ACCESSORY_SLOTS = ['necklace', 'ring1', 'ring2'];
export const ALL_ARMOR_SLOTS = [...ARMOR_SLOTS, ...ACCESSORY_SLOTS];

export function parseDamageTypes(combo) {
    if (combo === 'Typeless' || combo === 'T') return ['T'];
    return combo.split('');
}

export function getSlotCategory(slot) {
    if (ARMOR_SLOTS.includes(slot) || ACCESSORY_SLOTS.includes(slot)) return 'armor';
    if (WEAPON_SLOTS.includes(slot)) return 'weapon';
    return null;
}

export class Item {
    constructor(data = {}) {
        this.name = data.name || 'Empty';
        this.slot = data.slot || 'helmet';
        this.image = data.image || '';
        this.blockChance = data.blockChance ?? 0.0;
        this.damageReduction = data.damageReduction ?? 0;
        this.durability = data.durability ?? 10;
        this.currentDurability = data.currentDurability ?? this.durability;
        this.resistB = data.resistB || 'A';
        this.resistP = data.resistP || 'A';
        this.resistS = data.resistS || 'A';
        this.dexPenalty = data.dexPenalty ?? 0.0;
        this.strModifier = data.strModifier ?? 0.0;
        this.intModifier = data.intModifier ?? 0.0;
        this.numDice = data.numDice ?? data.num_dice ?? 0;
        this.dieSize = data.dieSize ?? data.die_size ?? 0;
        this.critMultiplier = data.critMultiplier ?? data.crit_multiplier ?? 3.0;
        this.baseCritChance = data.baseCritChance ?? data.base_crit_chance ?? 0;
        this.damageType = data.damageType ?? data.damage_type ?? 'B';
        this.damageTypeCombo = data.damageTypeCombo || data.damage_type_combo || this.damageType;
        this.coversSlots = data.coversSlots || [];
        this.isTwoHanded = data.isTwoHanded ?? data.is_two_handed ?? false;
        this.isShield = data.isShield ?? data.is_shield ?? false;
        this.isWeapon = data.isWeapon ?? data.is_weapon ?? (this.numDice > 0 && this.dieSize > 0);
        this.isArmor = data.isArmor ?? data.is_armor ?? false;
    }

    isBroken() { return this.currentDurability < 0; }
    isEmpty() { return this.name === 'Empty'; }
    isArmor() { return this.isArmor || (ARMOR_SLOTS.includes(this.slot) && !this.isWeapon && !this.isShield); }
    isAccessory() { return ACCESSORY_SLOTS.includes(this.slot); }

    getDamageTypes() {
        return parseDamageTypes(this.damageTypeCombo);
    }

    getResist(dtype) {
        if (dtype === 'T') return 1.0;
        const mapping = { 'B': this.resistB, 'P': this.resistP, 'S': this.resistS };
        return RESIST_MULTIPLIERS[mapping[dtype]] ?? 1.0;
    }

    getDamageTypeDisplay() {
        return DAMAGE_TYPE_DISPLAY[this.damageTypeCombo] || this.damageTypeCombo;
    }

    calcDamageReduction(damage, damageTypes) {
        if (!damageTypes || damageTypes.length === 0) return 0;
        
        const typed = damageTypes.filter(d => d !== 'T');
        let reduction = 0;
        
        if (typed.length > 0) {
            const worstResist = Math.min(...typed.map(d => this.getResist(d)));
            reduction = this.damageReduction * worstResist;
        }
        
        if (damageTypes.includes('T')) {
            reduction += this.damageReduction;
        }
        
        return Math.round(reduction);
    }

    getAllCoveredSlots() {
        return [this.slot, ...this.coversSlots];
    }

    getDisplayStats() {
        const stats = [];
        if (this.damageReduction > 0) {
            stats.push({ label: 'DR', value: this.damageReduction });
        }
        if (this.blockChance > 0) {
            stats.push({ label: 'BC', value: Math.round(this.blockChance * 100) + '%' });
        }
        if (this.durability > 0) {
            stats.push({ label: 'Dura', value: this.durability });
        }
        if (this.isWeapon) {
            stats.push({ label: 'Dice', value: `${this.numDice}d${this.dieSize}` });
            stats.push({ label: 'Crit', value: `${this.baseCritChance}%` });
            stats.push({ label: 'Crit Mult', value: `${this.critMultiplier}x` });
            stats.push({ label: 'Type', value: this.getDamageTypeDisplay() });
        }
        if (this.strModifier !== 0) {
            stats.push({ label: 'STR', value: (this.strModifier > 0 ? '+' : '') + this.strModifier });
        }
        if (this.dexPenalty !== 0) {
            const sign = this.dexPenalty > 0 ? '-' : '+';
            stats.push({ label: 'DEX Pen', value: sign + Math.abs(this.dexPenalty) });
        }
        if (this.intModifier !== 0) {
            stats.push({ label: 'INT', value: (this.intModifier > 0 ? '+' : '') + this.intModifier });
        }
        if (this.resistB !== 'A' || this.resistP !== 'A' || this.resistS !== 'A') {
            stats.push({ label: 'Resists', value: `${this.resistB}/${this.resistP}/${this.resistS}` });
        }
        if (this.coversSlots.length > 0) {
            const slotNames = this.coversSlots.map(s => SLOT_DISPLAY[s] || s).join(', ');
            stats.push({ label: 'Also Covers', value: slotNames });
        }
        if (this.isTwoHanded) {
            stats.push({ label: 'Type', value: '2H' });
        }
        return stats;
    }

    toDict() {
        return {
            name: this.name,
            slot: this.slot,
            image: this.image,
            blockChance: this.blockChance,
            damageReduction: this.damageReduction,
            durability: this.durability,
            currentDurability: this.currentDurability,
            resistB: this.resistB,
            resistP: this.resistP,
            resistS: this.resistS,
            dexPenalty: this.dexPenalty,
            strModifier: this.strModifier,
            intModifier: this.intModifier,
            isWeapon: this.isWeapon,
            isShield: this.isShield,
            isTwoHanded: this.isTwoHanded,
            numDice: this.numDice,
            dieSize: this.dieSize,
            critMultiplier: this.critMultiplier,
            baseCritChance: this.baseCritChance,
            damageTypeCombo: this.damageTypeCombo,
            coversSlots: this.coversSlots,
        };
    }

    static fromDict(d) {
        const combo = d.damageTypeCombo || d.damage_type_combo || '';
        const item = new Item({
            name: d.name || 'Empty',
            slot: d.slot || 'helmet',
            image: d.image || '',
            blockChance: d.blockChance ?? d.block_chance ?? 0.0,
            damageReduction: d.damageReduction ?? d.damage_reduction ?? 0,
            durability: d.durability ?? 10,
            resistB: d.resistB || d.resist_b || 'A',
            resistP: d.resistP || d.resist_p || 'A',
            resistS: d.resistS || d.resist_s || 'A',
            dexPenalty: d.dexPenalty ?? d.dex_penalty ?? 0.0,
            strModifier: d.strModifier ?? d.str_modifier ?? 0.0,
            intModifier: d.intModifier ?? d.int_modifier ?? 0.0,
            isWeapon: d.isWeapon ?? d.is_weapon ?? false,
            isShield: d.isShield ?? d.is_shield ?? false,
            isTwoHanded: d.isTwoHanded ?? d.is_two_handed ?? false,
            numDice: d.numDice ?? d.num_dice ?? 0,
            dieSize: d.dieSize ?? d.die_size ?? 0,
            critMultiplier: d.critMultiplier ?? d.crit_multiplier ?? 3.0,
            baseCritChance: d.baseCritChance ?? d.base_crit_chance ?? 0,
            damageTypeCombo: combo,
            coversSlots: d.coversSlots || [],
        });
        item.currentDurability = item.durability;
        return item;
    }
}
