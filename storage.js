import { Item } from './engine/item.js';
import { Character } from './engine/character.js';
import { Buff } from './engine/buff.js';
import { SLOT_NAMES, ARMOR_SLOTS, WEAPON_SLOTS, ACCESSORY_SLOTS, ALL_ARMOR_SLOTS } from './engine/item.js';

let itemData = null;
let itemsByName = {};

export async function loadItemsData() {
    try {
        const res = await fetch('./data/items.json');
        itemData = await res.json();
        window.__itemData = itemData;
        rebuildItemIndex();
        return itemData;
    } catch (e) {
        console.error('Failed to load items:', e);
        return null;
    }
}

function rebuildItemIndex() {
    itemsByName = {};
    if (!itemData) return;

    const addItems = (items, defaultSlot) => {
        (items || []).forEach(item => {
            itemsByName[item.name] = { ...item, slot: item.slot || defaultSlot };
        });
    };

    addItems(itemData.weapons, 'hand');
    addItems(itemData.shields, 'hand');

    for (const slot of ALL_ARMOR_SLOTS) {
        addItems(itemData.armor?.[slot], slot);
    }
}

export function getItemDataByName(name) {
    if (!name || name === 'Empty') return null;
    return itemsByName[name] || null;
}

export function expandCharacterPreset(presetDict) {
    const expanded = { ...presetDict };
    expanded.gear = {};

    for (const slot of SLOT_NAMES) {
        const gearData = presetDict.gear?.[slot];
        if (!gearData) {
            expanded.gear[slot] = new Item({ name: 'Empty', slot: slot });
        } else if (typeof gearData === 'string') {
            if (gearData === 'Empty' || gearData === '') {
                expanded.gear[slot] = new Item({ name: 'Empty', slot: slot });
            } else {
                const itemDataResult = getItemDataByName(gearData);
                if (itemDataResult) {
                    expanded.gear[slot] = new Item({ ...itemDataResult, slot });
                } else {
                    expanded.gear[slot] = new Item({ name: gearData, slot: slot });
                }
            }
        } else {
            expanded.gear[slot] = Item.fromDict(gearData);
        }
    }

    return expanded;
}

export function getItemByName(name) {
    if (!name || name === 'Empty') return null;
    const data = itemsByName[name];
    if (!data) return null;
    return new Item({ ...data, slot: data.slot });
}

export function getItemsBySlot(slot) {
    if (!itemData) return [];

    const cat = ALL_ARMOR_SLOTS.includes(slot) ? 'armor' :
                WEAPON_SLOTS.includes(slot) ? 'weapon' : null;

    if (!cat) return [];

    if (cat === 'weapon') {
        if (slot === 'offhand') {
            return (itemData.shields || []).map(i => new Item({ ...i, slot: 'hand', isShield: true }));
        }
        return (itemData.weapons || []).map(i => new Item({ ...i, slot: 'hand' }));
    }

    if (cat === 'armor') {
        return (itemData.armor?.[slot] || []).map(i => new Item({ ...i, slot }));
    }

    return [];
}

export function getAllStaticItems() {
    const result = [];

    if (!itemData) return result;

    (itemData.weapons || []).forEach(i => {
        result.push(new Item({ ...i, slot: 'hand' }));
    });

    (itemData.shields || []).forEach(i => {
        result.push(new Item({ ...i, slot: 'hand', isShield: true }));
    });

    for (const slot of ALL_ARMOR_SLOTS) {
        (itemData.armor?.[slot] || []).forEach(i => {
            result.push(new Item({ ...i, slot }));
        });
    }

    return result;
}

export function getSlots() {
    return itemData?.slots || {};
}

export function getSetBuffs() {
    if (!itemData?.setBuffs) return [];
    return itemData.setBuffs.map(b => new Buff(b.name, b.stat, b.flatValue, b.pctValue));
}

export function getPresets() {
    return itemData?.presets || { enemies: {}, loadouts: {} };
}

export function generateRandomItem(slot, category = null) {
    if (!itemData?.categories) return null;

    let slotCategory = category;
    if (!slotCategory) {
        if (ALL_ARMOR_SLOTS.includes(slot)) slotCategory = 'armor';
        else if (WEAPON_SLOTS.includes(slot)) slotCategory = 'weapons';
    }

    const cat = itemData.categories[slotCategory];
    if (!cat || !cat.statRanges) return null;

    const ranges = cat.statRanges;
    const item = {
        name: `Generated ${slot}`,
        slot: slot,
        durability: randomInt(ranges.durability?.min || 50, ranges.durability?.max || 500),
        blockChance: ranges.blockChance ? randomFloat(ranges.blockChance.min, ranges.blockChance.max) : 0,
        damageReduction: randomInt(ranges.damageReduction?.min || 0, ranges.damageReduction?.max || 20),
        resistB: randomResist(),
        resistP: randomResist(),
        resistS: randomResist(),
        strModifier: 0,
        dexPenalty: 0,
        intModifier: 0,
        isWeapon: slotCategory === 'weapons',
        isShield: false,
        isTwoHanded: false,
        coversSlots: [],
    };

    if (slotCategory === 'weapons') {
        item.numDice = randomInt(ranges.numDice?.min || 1, ranges.numDice?.max || 4);
        item.dieSize = randomInt(ranges.dieSize?.min || 4, ranges.dieSize?.max || 12);
        item.critMultiplier = randomFloat(ranges.critMultiplier?.min || 2.0, ranges.critMultiplier?.max || 3.5);
        item.baseCritChance = randomInt(ranges.critChance?.min || 5, ranges.critChance?.max || 20);
        item.damageTypeCombo = randomElement(['B', 'P', 'S', 'BP', 'BS', 'PS']);
        item.isTwoHanded = Math.random() < 0.3;
    }

    const statRoll = Math.random();
    if (statRoll < 0.33) {
        item.strModifier = randomInt(1, 5);
    } else if (statRoll < 0.66) {
        item.intModifier = randomInt(1, 5);
    } else {
        item.dexPenalty = randomInt(1, 3);
    }

    return new Item(item);
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
}

function randomResist() {
    return randomElement(['E', 'G', 'A', 'P', 'M', 'N']);
}

function randomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function savePresetsToStorage(presets) {
    if (itemData) {
        itemData.presets = presets;
        localStorage.setItem('isim_items_backup', JSON.stringify(itemData));
    }
}

export function saveLoadout(name, char) {
    const presets = getPresets();
    presets.loadouts[name] = char.toDict();
    savePresetsToStorage(presets);
}

export function loadLoadout(name) {
    const presets = getPresets();
    if (presets.loadouts[name]) {
        return Character.fromDict(presets.loadouts[name]);
    }
    return null;
}

export function deleteLoadout(name) {
    const presets = getPresets();
    if (presets.loadouts[name]) {
        delete presets.loadouts[name];
        savePresetsToStorage(presets);
    }
}

export function listLoadouts() {
    const presets = getPresets();
    return Object.keys(presets.loadouts);
}

export function saveEnemy(name, char) {
    const presets = getPresets();
    presets.enemies[name] = char.toDict();
    savePresetsToStorage(presets);
}

export function loadEnemy(name) {
    const presets = getPresets();
    if (presets.enemies[name]) {
        const expanded = expandCharacterPreset(presets.enemies[name]);
        return Character.fromDict(expanded);
    }
    return null;
}

export function deleteEnemy(name) {
    const presets = getPresets();
    if (presets.enemies[name]) {
        delete presets.enemies[name];
        savePresetsToStorage(presets);
    }
}

export function listEnemies() {
    const presets = getPresets();
    return Object.keys(presets.enemies);
}

export function exportData() {
    const data = {
        presets: getPresets(),
        customItems: JSON.parse(localStorage.getItem('isim_custom_items') || '[]'),
        customBuffs: JSON.parse(localStorage.getItem('isim_custom_buffs') || '[]')
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'isim_data.json';
    a.click();
    URL.revokeObjectURL(url);
}
