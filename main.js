import { Character } from './engine/character.js';
import { Item, SLOT_NAMES, SLOT_DISPLAY, ARMOR_SLOTS, WEAPON_SLOTS, ACCESSORY_SLOTS, ALL_ARMOR_SLOTS, DAMAGE_TYPE_DISPLAY, getSlotCategory, HAND_SLOTS } from './engine/item.js';
import { Buff } from './engine/buff.js';
import { mirror2HToOffhand } from './engine/combat.js';
import { runWinrateSimulation } from './engine/simulation.js';
import { TurnBasedController } from './engine/turnBased.js';
import {
    loadItemsData, getItemByName, getSlots, getSetBuffs, expandCharacterPreset,
    saveLoadout, loadLoadout, deleteLoadout, listLoadouts,
    saveEnemy, loadEnemy, deleteEnemy, listEnemies,
    exportData, getPresets
} from './storage.js';

let player = null;
let enemy = null;
let combatController = null;
let combatActive = false;
let customItems = [];
let customBuffs = [];
let itemCache = null;
let selectedPreviewItem = null;
let selectedPreviewSlot = null;
let previewCharType = 'player';
let previewItemChanged = false;

function init() {
    loadItemsData().then(() => {
        loadCharacters();
        loadCustomData();
        setupTabs();
        setupCombatControls();
        setupCombatPreview();
        setupSimulation();
        setupCharacterEditor();
        setupItemBuilder();
        setupBuffBuilder();
        setupPresetManagement();
        updateUI();
    });
}

function loadCharacters() {
    const savedPlayer = loadLoadout('current_player');
    player = savedPlayer || createDefaultCharacter('Player', false);

    const savedEnemy = loadLoadout('current_enemy');
    if (savedEnemy) {
        enemy = savedEnemy;
    } else {
        const presets = getPresets();
        if (presets.enemies['The Black King']) {
            const expanded = expandCharacterPreset(presets.enemies['The Black King']);
            enemy = Character.fromDict(expanded);
        } else {
            enemy = createDefaultCharacter('Enemy', true);
        }
    }
}

function createDefaultCharacter(name, isEnemy) {
    const gear = {};
    for (const slot of SLOT_NAMES) {
        gear[slot] = new Item({ name: 'Empty', slot: slot });
    }
    if (isEnemy) {
        gear['mainhand'] = getItemByName('Sword of the Black King') || new Item({
            name: 'Iron Sword', slot: 'mainhand', isWeapon: true, numDice: 1, dieSize: 8
        });
    }
    return new Character(name, 11, 10, 10, 50, gear);
}

function getAllAvailableItems() {
    if (itemCache) return itemCache;

    const items = { weapons: [], shields: [], armor: {}, accessories: {} };
    const data = window.__itemData;
    if (!data) return items;

    items.weapons = (data.weapons || []).map(i => new Item({ ...i, slot: 'hand' }));
    items.shields = (data.shields || []).map(i => new Item({ ...i, slot: 'hand', isShield: true }));

    for (const slot of ALL_ARMOR_SLOTS) {
        items.armor[slot] = (data.armor?.[slot] || []).map(i => new Item({ ...i, slot }));
    }

    customItems.forEach(i => {
        if (i.isWeapon) {
            items.weapons.push(new Item({ ...i }));
        } else if (i.isShield) {
            items.shields.push(new Item({ ...i }));
        } else {
            const cat = getSlotCategory(i.slot);
            if (cat === 'armor') items.armor[i.slot] = items.armor[i.slot] || [];
            if (items.armor[i.slot]) items.armor[i.slot].push(new Item({ ...i }));
        }
    });

    itemCache = items;
    return items;
}

function invalidateItemCache() {
    itemCache = null;
}

function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        });
    });
}

function setupCombatControls() {
    document.getElementById('btn-start-combat').addEventListener('click', startCombat);
    document.getElementById('btn-mh-attack').addEventListener('click', () => doPlayerAttack('main'));
    document.getElementById('btn-oh-attack').addEventListener('click', () => doPlayerAttack('off'));
    document.getElementById('btn-flee').addEventListener('click', attemptFlee);
    document.getElementById('btn-end-combat').addEventListener('click', endCombat);
}

function updateBodySilhouette(charType) {
    const char = charType === 'player' ? player : enemy;
    const body = document.getElementById(`${charType}-body`);
    if (!body) return;
    
    const slots = ['helmet', 'chest', 'shirt', 'gloves', 'legs', 'boots', 'mainhand', 'offhand', 'necklace', 'ring1', 'ring2'];
    const defaultNames = {
        'helmet': 'Helmet',
        'chest': 'Chest',
        'shirt': 'Shirt',
        'gloves': 'Gloves',
        'legs': 'Legs',
        'boots': 'Boots',
        'mainhand': 'M.H.',
        'offhand': 'O.H.',
        'necklace': 'Neck',
        'ring1': 'Ring',
        'ring2': 'Ring'
    };
    
    slots.forEach(slot => {
        const slotEl = body.querySelector(`[data-slot="${slot}"]`);
        if (!slotEl) return;
        
        const item = char.gear[slot];
        if (item && !item.isEmpty()) {
            slotEl.classList.add('equipped');
            slotEl.textContent = item.name.length > 9 ? item.name.substring(0, 9) + '..' : item.name;
        } else {
            slotEl.classList.remove('equipped');
            slotEl.textContent = defaultNames[slot];
        }
    });
}

function updateAllBodySilhouettes() {
    updateBodySilhouette('player');
    updateBodySilhouette('enemy');
}

let selectedSlot = null;
let selectedCharType = null;
let previewEditMode = false;

function toggleCombatEditMode() {
    previewEditMode = !previewEditMode;
    if (selectedSlot && selectedCharType) {
        const char = selectedCharType === 'player' ? player : enemy;
        const item = char.gear[selectedSlot];
        if (item && !item.isEmpty()) {
            showCombatPreview(item, selectedSlot, selectedCharType);
        }
    }
}

window.toggleCombatEditMode = toggleCombatEditMode;

window.applyCombatItemEdit = function(charType, slot) {
    const char = charType === 'player' ? player : enemy;
    const item = char.gear[slot];
    if (!item) return;
    
    const preview = document.getElementById('combat-item-preview');
    preview.querySelectorAll('.edit-input').forEach(input => {
        const field = input.dataset.field;
        let value = parseFloat(input.value);
        if (field === 'blockChance') {
            value = value / 100;
        }
        if (field === 'currentDurability') {
            item.currentDurability = value;
        } else {
            item[field] = value;
        }
    });
    
    preview.querySelectorAll('.edit-select').forEach(select => {
        const field = select.dataset.field;
        item[field] = select.value;
    });
    
    saveLoadout(charType === 'player' ? 'current_player' : 'current_enemy', char);
    previewEditMode = false;
    showCombatPreview(item, slot, charType);
    updateUI();
};

function setupCombatPreview() {
    document.querySelectorAll('.body-slot').forEach(el => {
        el.addEventListener('click', () => {
            const charType = el.dataset.char;
            const slot = el.dataset.slot;
            
            document.querySelectorAll('.body-slot').forEach(s => s.classList.remove('selected'));
            el.classList.add('selected');
            
            selectedSlot = slot;
            selectedCharType = charType;
            
            const char = charType === 'player' ? player : enemy;
            const item = char.gear[slot];
            if (item && !item.isEmpty()) {
                showCombatPreview(item, slot, charType);
            } else {
                showEmptySlot(slot, charType);
            }
        });
    });
}

const RESIST_NAMES = { 'E': 'Excellent', 'G': 'Good', 'A': 'Average', 'P': 'Poor', 'M': 'Minimal', 'N': 'None' };

function showCombatPreview(item, slot, charType) {
    const preview = document.getElementById('combat-item-preview');
    if (!preview) return;

    if (!item || item.isEmpty()) {
        showEmptySlot(slot, charType);
        return;
    }

    let html = `<div class="preview-name">${item.name}</div>`;
    html += `<div class="preview-slot-type">${SLOT_DISPLAY[item.slot] || item.slot}</div>`;

    if (previewEditMode) {
        html += `<div class="preview-edit-section">`;
        html += `<div class="preview-line"><label>STR: <input type="number" class="edit-input" data-field="strModifier" value="${item.strModifier}"></label></div>`;
        html += `<div class="preview-line"><label>DEX Pen: <input type="number" class="edit-input" data-field="dexPenalty" value="${item.dexPenalty}"></label></div>`;
        html += `<div class="preview-line"><label>INT: <input type="number" class="edit-input" data-field="intModifier" value="${item.intModifier}"></label></div>`;
        
        if (item.isWeapon) {
            html += `<div class="preview-line"><label>Num Dice: <input type="number" class="edit-input" data-field="numDice" value="${item.numDice}" min="0"></label></div>`;
            html += `<div class="preview-line"><label>Die Size: <input type="number" class="edit-input" data-field="dieSize" value="${item.dieSize}" min="0"></label></div>`;
            html += `<div class="preview-line"><label>Crit Mult: <input type="number" class="edit-input" data-field="critMultiplier" value="${item.critMultiplier}" step="0.1"></label></div>`;
            html += `<div class="preview-line"><label>Crit %: <input type="number" class="edit-input" data-field="baseCritChance" value="${item.baseCritChance}" min="0" max="100"></label></div>`;
        }
        
        html += `<div class="preview-line"><label>Block %: <input type="number" class="edit-input" data-field="blockChance" value="${Math.round(item.blockChance * 100)}" min="0" max="100"></label></div>`;
        html += `<div class="preview-line"><label>DR: <input type="number" class="edit-input" data-field="damageReduction" value="${item.damageReduction}" min="0"></label></div>`;
        
        html += `<div class="preview-line"><label>B Res: <select class="edit-select" data-field="resistB"><option value="E" ${item.resistB === 'E' ? 'selected' : ''}>Excellent</option><option value="G" ${item.resistB === 'G' ? 'selected' : ''}>Good</option><option value="A" ${item.resistB === 'A' ? 'selected' : ''}>Average</option><option value="P" ${item.resistB === 'P' ? 'selected' : ''}>Poor</option><option value="M" ${item.resistB === 'M' ? 'selected' : ''}>Minimal</option><option value="N" ${item.resistB === 'N' ? 'selected' : ''}>None</option></select></label></div>`;
        html += `<div class="preview-line"><label>P Res: <select class="edit-select" data-field="resistP"><option value="E" ${item.resistP === 'E' ? 'selected' : ''}>Excellent</option><option value="G" ${item.resistP === 'G' ? 'selected' : ''}>Good</option><option value="A" ${item.resistP === 'A' ? 'selected' : ''}>Average</option><option value="P" ${item.resistP === 'P' ? 'selected' : ''}>Poor</option><option value="M" ${item.resistP === 'M' ? 'selected' : ''}>Minimal</option><option value="N" ${item.resistP === 'N' ? 'selected' : ''}>None</option></select></label></div>`;
        html += `<div class="preview-line"><label>S Res: <select class="edit-select" data-field="resistS"><option value="E" ${item.resistS === 'E' ? 'selected' : ''}>Excellent</option><option value="G" ${item.resistS === 'G' ? 'selected' : ''}>Good</option><option value="A" ${item.resistS === 'A' ? 'selected' : ''}>Average</option><option value="P" ${item.resistS === 'P' ? 'selected' : ''}>Poor</option><option value="M" ${item.resistS === 'M' ? 'selected' : ''}>Minimal</option><option value="N" ${item.resistS === 'N' ? 'selected' : ''}>None</option></select></label></div>`;
        
        html += `<div class="preview-line"><label>Durability: <input type="number" class="edit-input" data-field="currentDurability" value="${item.currentDurability}" min="0"></label></div>`;
        html += `<button class="btn btn-small btn-primary" onclick="applyCombatItemEdit('${charType}', '${slot}')">Apply</button>`;
        html += `<button class="btn btn-small" onclick="toggleCombatEditMode()">Cancel</button>`;
        html += `</div>`;
    } else {
        if (item.dexPenalty !== 0) {
            const sign = item.dexPenalty > 0 ? '-' : '+';
            html += `<div class="preview-line">DEX Pen ${sign}${Math.abs(item.dexPenalty)}</div>`;
        }

        if (item.strModifier !== 0) {
            html += `<div class="preview-line">STR ${item.strModifier > 0 ? '+' : ''}${item.strModifier}%</div>`;
        }

        if (item.intModifier !== 0) {
            html += `<div class="preview-line">INT ${item.intModifier > 0 ? '+' : ''}${item.intModifier}%</div>`;
        }

        if (item.isWeapon) {
            html += `<div class="preview-weapon-stats">`;
            html += `<div class="preview-line">${item.numDice}d${item.dieSize}</div>`;
            html += `<div class="preview-line">Crit Multiplier ${item.critMultiplier}x</div>`;
            html += `<div class="preview-line">Crit Chance ${item.baseCritChance}%</div>`;
            html += `</div>`;
        }

        if (item.blockChance > 0) {
            html += `<div class="preview-line">Block Chance: ${Math.round(item.blockChance * 100)}%</div>`;
        }

        if (item.damageReduction > 0) {
            html += `<div class="preview-line">Damage Reduction: ${item.damageReduction}</div>`;
        }

        html += `<div class="preview-line">Bludgeoning Resistance: ${RESIST_NAMES[item.resistB] || 'Average'}</div>`;
        html += `<div class="preview-line">Piercing Resistance: ${RESIST_NAMES[item.resistP] || 'Average'}</div>`;
        html += `<div class="preview-line">Slashing Resistance: ${RESIST_NAMES[item.resistS] || 'Average'}</div>`;

        html += `<div class="preview-line durability">Durability: ${item.currentDurability}/${item.durability}</div>`;
        
        html += `<button class="btn btn-small btn-warning" onclick="toggleCombatEditMode()" style="margin-top:10px">Edit Stats</button>`;
        html += `<button class="btn btn-small" onclick="showItemSearchInPreview('${charType}', '${slot}')" style="margin-top:10px">Change Item</button>`;
    }

    preview.innerHTML = html;
}

function showEmptySlot(slot, charType) {
    const preview = document.getElementById('combat-item-preview');
    if (!preview) return;
    
    const items = getItemsForSlot(slot);
    let optionsHtml = `<div class="preview-empty-slot">${SLOT_DISPLAY[slot] || slot}</div>`;
    optionsHtml += `<div class="preview-line empty">Empty</div>`;
    optionsHtml += `<div class="preview-change-section">`;
    optionsHtml += `<input type="text" id="combat-item-search" class="preview-search" placeholder="Search items...">`;
    optionsHtml += `<div class="preview-item-list" id="preview-item-list">`;
    
    items.slice(0, 20).forEach(item => {
        optionsHtml += `<div class="preview-item-option" data-item="${item.name}" onclick="equipFromPreview('${charType}', '${slot}', '${item.name.replace(/'/g, "\\'")}')">${item.name}</div>`;
    });
    
    optionsHtml += `</div></div>`;
    preview.innerHTML = optionsHtml;
    
    document.getElementById('combat-item-search').addEventListener('input', (e) => {
        filterPreviewItems(slot, e.target.value);
    });
}

function filterPreviewItems(slot, query) {
    const container = document.getElementById('preview-item-list');
    if (!container) return;
    
    const items = getItemsForSlot(slot);
    const filtered = query 
        ? items.filter(i => i.name.toLowerCase().includes(query.toLowerCase()))
        : items.slice(0, 20);
    
    container.innerHTML = filtered.map(item => 
        `<div class="preview-item-option" data-item="${item.name}" onclick="equipFromPreview('${selectedCharType}', '${selectedSlot}', '${item.name.replace(/'/g, "\\'")}')">${item.name}</div>`
    ).join('');
}

window.showItemSearchInPreview = function(charType, slot) {
    selectedCharType = charType;
    selectedSlot = slot;
    showEmptySlot(slot, charType);
};

window.equipFromPreview = function(charType, slot, itemName) {
    const char = charType === 'player' ? player : enemy;
    const items = getItemsForSlot(slot);
    const item = items.find(i => i.name === itemName);
    if (item) {
        const targetSlot = HAND_SLOTS.includes(slot) ? 'mainhand' : slot;
        const actualSlot = findBestEquipSlot(char, targetSlot, item);
        const equippedItem = new Item({ ...item.toDict(), slot: actualSlot });
        char.gear[actualSlot] = equippedItem;
        
        if (actualSlot === 'mainhand' && equippedItem.isTwoHanded) {
            char.gear['offhand'] = new Item({ name: 'Empty', slot: 'offhand' });
        }
        
        saveLoadout(charType === 'player' ? 'current_player' : 'current_enemy', char);
        updateUI();
        showCombatPreview(equippedItem, actualSlot, charType);
    }
};

function hideCombatPreview() {
    selectedSlot = null;
    selectedCharType = null;
    document.querySelectorAll('.body-slot').forEach(s => s.classList.remove('selected'));
    const preview = document.getElementById('combat-item-preview');
    if (preview) {
        preview.innerHTML = '<div class="preview-empty">Click a slot to view item</div>';
    }
}

function renderCombatEquipList(charType) {
    const container = document.getElementById('combat-equip-list');
    if (!container) return;

    const char = charType === 'player' ? player : enemy;
    container.innerHTML = '';

    const slots = ['helmet', 'chest', 'shirt', 'gloves', 'legs', 'boots', 'mainhand', 'offhand', 'necklace', 'ring1', 'ring2'];
    
    for (const slot of slots) {
        const slotData = getSlots()[slot] || {};
        const items = getItemsForSlot(slot);
        const equipped = char.gear[slot];

        let options = `<option value="">Empty</option>`;
        items.forEach(item => {
            const isEquipped = equipped && equipped.name === item.name;
            options += `<option value="${item.name}"${isEquipped ? ' selected' : ''}>${item.name}</option>`;
        });

        const div = document.createElement('div');
        div.className = 'combat-gear-row';
        div.innerHTML = `
            <span class="combat-gear-slot">${slotData.display || slot}</span>
            <select class="combat-gear-select" data-char="${charType}" data-slot="${slot}">${options}</select>
        `;
        container.appendChild(div);

        const select = div.querySelector('select');
        select.addEventListener('change', () => handleCombatGearChange(charType, slot, select.value));
        select.addEventListener('mouseenter', () => {
            const item = char.gear[slot];
            if (item && !item.isEmpty()) {
                showCombatPreview(item, slot, charType);
            }
        });
    }
}

function handleCombatGearChange(charType, slot, itemName) {
    const char = charType === 'player' ? player : enemy;
    if (!itemName) {
        char.gear[slot] = new Item({ name: 'Empty', slot: slot });
    } else {
        const items = getItemsForSlot(slot);
        const item = items.find(i => i.name === itemName);
        if (item) {
            const actualSlot = findBestEquipSlot(char, slot, item);
            const equippedItem = new Item({ ...item.toDict(), slot: actualSlot });
            char.gear[actualSlot] = equippedItem;
            
            if (actualSlot === 'mainhand' && equippedItem.isTwoHanded) {
                char.gear['offhand'] = new Item({ name: 'Empty', slot: 'offhand' });
            }
        }
    }
    saveLoadout(charType === 'player' ? 'current_player' : 'current_enemy', char);
    renderCombatEquipList(charType);
    updateUI();
}

function startCombat() {
    combatActive = true;
    player.resetCombat();
    enemy.resetCombat();
    mirror2HToOffhand(player);
    mirror2HToOffhand(enemy);

    combatController = new TurnBasedController(player, enemy);
    combatController.start();

    document.getElementById('btn-start-combat').disabled = true;
    document.getElementById('btn-mh-attack').disabled = false;
    document.getElementById('btn-oh-attack').disabled = false;
    document.getElementById('btn-flee').disabled = false;
    document.getElementById('btn-end-combat').disabled = false;

    clearLog();
    addLogEntry({ text: '=== COMBAT STARTED ===', type: 'system' });
    updateUI();
}

function endCombat() {
    combatActive = false;
    document.getElementById('btn-start-combat').disabled = false;
    document.getElementById('btn-mh-attack').disabled = true;
    document.getElementById('btn-oh-attack').disabled = true;
    document.getElementById('btn-flee').disabled = true;
    document.getElementById('btn-end-combat').disabled = true;
    addLogEntry({ text: '=== COMBAT ENDED ===', type: 'system' });
}

function doPlayerAttack(type) {
    if (!combatActive) return;
    const result = combatController.doTurn(type);
    result.messages.forEach(msg => addLogEntry(msg));
    if (result.done) {
        addLogEntry({ text: `=== ${result.result.toUpperCase()} ===`, type: 'result' });
        endCombat();
    }
    updateUI();
}

function attemptFlee() {
    if (!combatActive) return;
    const playerDex = player.effectiveDex();
    const enemyDex = enemy.effectiveDex();
    const fleeRoll = Math.random() * Math.max(0.001, playerDex);
    const oppRoll = Math.random() * Math.max(0.001, enemyDex);
    const success = fleeRoll > oppRoll;
    addLogEntry({ text: `Flee: ${fleeRoll.toFixed(2)} vs ${oppRoll.toFixed(2)} -> ${success ? 'SUCCESS' : 'FAILED'}`, type: 'system' });
    if (success) {
        addLogEntry({ text: 'You escaped!', type: 'result' });
        endCombat();
    } else {
        const result = combatController.doTurn('main');
        result.messages.forEach(msg => addLogEntry(msg));
        if (result.done) {
            addLogEntry({ text: `=== ${result.result.toUpperCase()} ===`, type: 'result' });
            endCombat();
        }
    }
    updateUI();
}

function clearLog() {
    document.getElementById('log-content').innerHTML = '';
}

function addLogEntry(entry) {
    const logContent = document.getElementById('log-content');
    const div = document.createElement('div');
    let classes = 'log-entry ' + (entry.type || 'action');
    if (entry.attacker === 'player') {
        classes += ' log-player';
    } else if (entry.attacker === 'enemy') {
        classes += ' log-enemy';
    }
    div.className = classes;
    div.textContent = entry.text;
    logContent.insertBefore(div, logContent.firstChild);
}

function renderCharacterSummary(char, charType) {
    const container = document.getElementById('sim-summary-content');
    if (!container) return;

    let html = `<div class="summary-char-name">${char.name}</div>`;
    html += `<div class="summary-char-stats">STR: ${char.effectiveStr().toFixed(1)} | DEX: ${char.effectiveDex().toFixed(1)} | INT: ${char.effectiveInt().toFixed(1)}</div>`;
    html += `<div class="summary-char-stats">HP: ${char.effectiveHp()}</div>`;
    
    html += '<div class="summary-gear">';
    
    const displaySlots = ['mainhand', 'offhand', 'helmet', 'chest', 'shirt', 'legs', 'gloves', 'boots', 'necklace', 'ring1', 'ring2'];
    
    for (const slot of displaySlots) {
        const item = char.gear[slot];
        if (item && !item.isEmpty()) {
            let statsText = '';
            if (item.isWeapon) {
                statsText = `${item.numDice}d${item.dieSize} ${item.getDamageTypeDisplay()}`;
            } else {
                const parts = [];
                if (item.damageReduction > 0) parts.push(`DR${item.damageReduction}`);
                if (item.blockChance > 0) parts.push(`BC${Math.round(item.blockChance * 100)}%`);
                if (item.strModifier !== 0) parts.push(`STR${item.strModifier > 0 ? '+' : ''}${item.strModifier}`);
                if (item.dexPenalty !== 0) {
                    const sign = item.dexPenalty > 0 ? '-' : '+';
                    parts.push(`DEX Pen${sign}${Math.abs(item.dexPenalty)}`);
                }
                statsText = parts.join(' | ') || 'Armor';
            }
            
            html += `
                <div class="summary-gear-item">
                    <div class="slot-name">${SLOT_DISPLAY[slot] || slot}</div>
                    <div class="item-name" title="${item.name}">${item.name}</div>
                    <div class="item-stats">${statsText}</div>
                </div>
            `;
        }
    }
    
    html += '</div>';
    
    container.innerHTML = html;
}

function setupSimulation() {
    document.getElementById('btn-run-simulation').addEventListener('click', () => {
        const simCount = parseInt(document.getElementById('sim-count').value) || 1000;
        const maxTurns = parseInt(document.getElementById('sim-max-turns').value) || 500;
        document.getElementById('sim-winrate').textContent = 'Running...';
        document.getElementById('sim-avg-turns').textContent = '...';
        document.getElementById('sim-player-wins').textContent = '...';
        document.getElementById('sim-enemy-wins').textContent = '...';
        setTimeout(() => {
            const result = runWinrateSimulation(player.toDict(), enemy.toDict(), simCount, maxTurns);
            document.getElementById('sim-winrate').textContent = result.winRate().toFixed(1) + '%';
            document.getElementById('sim-avg-turns').textContent = result.avgTurns().toFixed(1);
            document.getElementById('sim-player-wins').textContent = result.wins;
            document.getElementById('sim-enemy-wins').textContent = result.losses;
        }, 50);
    });

    document.querySelectorAll('.summary-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.summary-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const charType = tab.dataset.summary;
            const char = charType === 'player' ? player : enemy;
            renderCharacterSummary(char, charType);
        });
    });
}

function setupCharacterEditor() {
    document.getElementById('btn-save-player').addEventListener('click', savePlayer);
    document.getElementById('btn-save-enemy').addEventListener('click', saveCurrentEnemy);
    renderGearEditors();
    renderBuffEditors();
    updateCharacterForms();
    setupItemSearch();
}

let selectedSearchItem = null;

function setupItemSearch() {
    const searchInput = document.getElementById('item-search-input');
    const filters = document.querySelectorAll('.search-filters input');
    
    searchInput.addEventListener('input', () => renderSearchResults());
    filters.forEach(f => f.addEventListener('change', () => renderSearchResults()));
    
    renderSearchResults();
}

function renderSearchResults() {
    const container = document.getElementById('search-results');
    const query = (document.getElementById('item-search-input')?.value || '').toLowerCase();
    
    const showWeapons = document.getElementById('filter-weapons')?.checked ?? true;
    const showArmor = document.getElementById('filter-armor')?.checked ?? true;
    const showShields = document.getElementById('filter-shields')?.checked ?? true;
    
    const allItems = getAllAvailableItems();
    const items = [];
    
    if (showWeapons) items.push(...allItems.weapons.map(i => ({...i, type: 'weapon'})));
    if (showShields) items.push(...allItems.shields.map(i => ({...i, type: 'shield'})));
    if (showArmor) {
        for (const slot of ALL_ARMOR_SLOTS) {
            if (allItems.armor[slot]) {
                items.push(...allItems.armor[slot].map(i => ({...i, type: 'armor'})));
            }
        }
    }
    
    const filtered = items.filter(i => i.name.toLowerCase().includes(query));
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="preview-empty">No items found</div>';
        return;
    }
    
    container.innerHTML = filtered.slice(0, 50).map(item => {
        let stats = [];
        if (item.isWeapon) stats.push(`${item.numDice}d${item.dieSize}`);
        if (item.damageReduction > 0) stats.push(`DR${item.damageReduction}`);
        if (item.blockChance > 0) stats.push(`BC${Math.round(item.blockChance * 100)}%`);
        
    const slotDisplay = item.slot === 'hand' ? 'Hand' : (SLOT_DISPLAY[item.slot] || item.slot);
        
        return `
            <div class="search-item" data-name="${encodeURIComponent(item.name)}" data-slot="${item.slot}" data-type="${item.type}">
                <div class="search-item-name">${item.name}</div>
                <div class="search-item-slot">${slotDisplay}</div>
                <div class="search-item-stats">${stats.join(' | ')}</div>
                <div class="search-item-actions">
                    <button class="btn btn-small btn-primary" onclick="event.stopPropagation(); equipSearchItem(this.closest('.search-item')?.dataset.name, '${item.slot}', 'player')">Equip P</button>
                    <button class="btn btn-small btn-danger" onclick="event.stopPropagation(); equipSearchItem(this.closest('.search-item')?.dataset.name, '${item.slot}', 'enemy')">Equip E</button>
                </div>
            </div>
        `;
    }).join('');
    
    container.querySelectorAll('.search-item').forEach(el => {
        el.addEventListener('click', () => {
            container.querySelectorAll('.search-item').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
            const decodedName = decodeURIComponent(el.dataset.name);
            const item = items.find(i => i.name === decodedName);
            if (item) {
                selectedSearchItem = item;
                showSearchItemPreview(item);
            }
        });
    });
}

function showSearchItemPreview(item) {
    const preview = document.getElementById('item-preview');
    if (!preview) return;
    
    let html = `<div class="preview-name">${item.name}</div>`;
    html += `<div class="preview-slot-type">${SLOT_DISPLAY[item.slot] || item.slot}</div>`;

    if (item.dexPenalty !== 0) {
        const sign = item.dexPenalty > 0 ? '-' : '+';
        html += `<div class="preview-line">DEX Pen ${sign}${Math.abs(item.dexPenalty)}</div>`;
    }

    if (item.strModifier !== 0) {
        html += `<div class="preview-line">STR ${item.strModifier > 0 ? '+' : ''}${item.strModifier}</div>`;
    }

    if (item.intModifier !== 0) {
        html += `<div class="preview-line">INT ${item.intModifier > 0 ? '+' : ''}${item.intModifier}</div>`;
    }

    if (item.isWeapon) {
        html += `<div class="preview-weapon-stats">`;
        html += `<div class="preview-line">${item.numDice}d${item.dieSize}</div>`;
        html += `<div class="preview-line">Crit Multiplier ${item.critMultiplier}x</div>`;
        html += `<div class="preview-line">Crit Chance ${item.baseCritChance}%</div>`;
        html += `</div>`;
    }

    if (item.blockChance > 0) {
        html += `<div class="preview-line">Block Chance: ${Math.round(item.blockChance * 100)}%</div>`;
    }

    if (item.damageReduction > 0) {
        html += `<div class="preview-line">Damage Reduction: ${item.damageReduction}</div>`;
    }

    html += `<div class="preview-line">Bludgeoning Resistance: ${RESIST_NAMES[item.resistB] || 'Average'}</div>`;
    html += `<div class="preview-line">Piercing Resistance: ${RESIST_NAMES[item.resistP] || 'Average'}</div>`;
    html += `<div class="preview-line">Slashing Resistance: ${RESIST_NAMES[item.resistS] || 'Average'}</div>`;

    html += `<div class="preview-line durability">Durability: ${item.currentDurability}/${item.durability}</div>`;

    preview.innerHTML = html;
}

window.equipSearchItem = function(itemName, slot, charType) {
    if (!itemName || !charType) return;
    const decodedName = decodeURIComponent(itemName);
    const char = charType === 'player' ? player : enemy;
    
    const targetSlot = slot === 'hand' ? findBestEquipSlot(char, 'mainhand', { isTwoHanded: false }) : slot;
    const items = getItemsForSlot(targetSlot);
    const item = items.find(i => i.name === decodedName);
    
    if (item) {
        const actualSlot = findBestEquipSlot(char, targetSlot, item);
        const equippedItem = new Item({ ...item.toDict(), slot: actualSlot });
        char.gear[actualSlot] = equippedItem;
        
        if (equippedItem.coversSlots.length > 0) {
            equippedItem.coversSlots.forEach(coveredSlot => {
                char.gear[coveredSlot] = new Item({ ...equippedItem.toDict(), slot: coveredSlot });
            });
        }
        if (actualSlot === 'mainhand' && equippedItem.isTwoHanded) {
            char.gear['offhand'] = new Item({ name: 'Empty', slot: 'offhand' });
        }
        renderGearEditors();
        updateUI();
        updateAllBodySilhouettes();
    }
};

function getItemsForSlot(slot) {
    const items = getAllAvailableItems();
    const cat = getSlotCategory(slot);

    if (cat === 'weapon') {
        const weapons = items.weapons || [];
        const shields = items.shields || [];
        return [...weapons, ...shields];
    }
    if (cat === 'armor') return items.armor[slot] || [];
    return [];
}

function renderGearEditors() {
    renderGearGrid('player-gear', player, 'player');
    renderGearGrid('enemy-gear', enemy, 'enemy');
}

function renderGearGrid(containerId, char, charType) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    for (const slot of SLOT_NAMES) {
        const slotData = getSlots()[slot] || {};
        const items = getItemsForSlot(slot);
        const equipped = char.gear[slot];

        const div = document.createElement('div');
        div.className = 'gear-slot';

        let options = `<option value="">Empty</option>`;
        items.forEach(item => {
            const isEquipped = equipped && equipped.name === item.name;
            options += `<option value="${item.name}"${isEquipped ? ' selected' : ''}>${item.name}</option>`;
        });

        div.innerHTML = `
            <span class="gear-slot-label">${slotData.display || slot}</span>
            <select id="${charType}-gear-${slot}" class="gear-select" data-char="${charType}" data-slot="${slot}">${options}</select>
        `;
        container.appendChild(div);

        const select = div.querySelector('select');
        select.addEventListener('change', () => handleGearChange(charType, slot, select.value));
        select.addEventListener('mouseenter', () => showItemPreview(select.value, slot, charType, equipped));
        select.addEventListener('mouseleave', () => hideItemPreview());
    }
}

function showItemPreview(itemName, slot, charType, equippedItem = null) {
    let item = null;
    
    if (equippedItem && equippedItem.name === itemName) {
        item = equippedItem;
    } else if (itemName) {
        const items = getItemsForSlot(slot);
        item = items.find(i => i.name === itemName);
    }
    
    if (item) {
        selectedPreviewItem = item;
        selectedPreviewSlot = slot;
        previewCharType = charType;
        updateItemPreview();
    }
}

function hideItemPreview() {
}

function updateItemPreview(editMode = true) {
    const preview = document.getElementById('item-preview');
    if (!preview) return;

    if (!selectedPreviewItem || selectedPreviewItem.isEmpty()) {
        preview.innerHTML = '<div class="preview-empty">Select an item to preview</div>';
        return;
    }

    const item = selectedPreviewItem;
    let html = `<div class="preview-name">${item.name}</div>`;
    html += `<div class="preview-slot-type">${SLOT_DISPLAY[item.slot] || item.slot}</div>`;

    html += `<div class="preview-line">`;
    html += `DEX Pen <input type="number" class="preview-edit" data-field="dexPenalty" value="${item.dexPenalty}" style="width:50px">`;
    html += `</div>`;

    html += `<div class="preview-line">`;
    html += `STR <input type="number" class="preview-edit" data-field="strModifier" value="${item.strModifier}" style="width:50px">%`;
    html += `</div>`;

    html += `<div class="preview-line">`;
    html += `INT <input type="number" class="preview-edit" data-field="intModifier" value="${item.intModifier}" style="width:50px">%`;
    html += `</div>`;

    if (item.isWeapon) {
        html += `<div class="preview-weapon-stats">`;
        html += `<div class="preview-line">Dice <input type="number" class="preview-edit" data-field="numDice" value="${item.numDice}" min="0" style="width:40px">d<input type="number" class="preview-edit" data-field="dieSize" value="${item.dieSize}" min="1" style="width:40px"></div>`;
        html += `<div class="preview-line">Type <select class="preview-edit" data-field="damageTypeCombo" style="width:80px">${getDamageTypeOptions(item.damageTypeCombo)}</select></div>`;
        html += `<div class="preview-line">Crit Mult <input type="number" class="preview-edit" data-field="critMultiplier" value="${item.critMultiplier}" step="0.1" style="width:50px">x</div>`;
        html += `<div class="preview-line">Crit % <input type="number" class="preview-edit" data-field="baseCritChance" value="${item.baseCritChance}" min="0" max="100" style="width:50px">%</div>`;
        html += `</div>`;
    }

    html += `<div class="preview-line">`;
    html += `Block <input type="number" class="preview-edit" data-field="blockChance" value="${Math.round(item.blockChance * 100)}" min="0" max="100" style="width:50px">%`;
    html += `</div>`;

    html += `<div class="preview-line">`;
    html += `DR <input type="number" class="preview-edit" data-field="damageReduction" value="${item.damageReduction}" min="0" style="width:50px">`;
    html += `</div>`;

    html += `<div class="preview-line">B Res <select class="preview-edit" data-field="resistB" style="width:90px">${getResistOptions(item.resistB)}</select></div>`;
    html += `<div class="preview-line">P Res <select class="preview-edit" data-field="resistP" style="width:90px">${getResistOptions(item.resistP)}</select></div>`;
    html += `<div class="preview-line">S Res <select class="preview-edit" data-field="resistS" style="width:90px">${getResistOptions(item.resistS)}</select></div>`;

    html += `<div class="preview-line durability">Durability <input type="number" class="preview-edit" data-field="durability" value="${item.durability}" min="1" style="width:60px"></div>`;

    html += `<div class="preview-actions">`;
    html += `<button class="btn btn-small btn-primary" onclick="applyPreviewChanges()">Apply</button>`;
    html += `<button class="btn btn-small btn-secondary" onclick="resetPreviewItem()">Reset</button>`;
    html += `</div>`;

    preview.innerHTML = html;

    preview.querySelectorAll('.preview-edit').forEach(input => {
        input.addEventListener('change', () => previewItemChanged = true);
        input.addEventListener('input', () => previewItemChanged = true);
    });
}

function getResistOptions(current) {
    const opts = ['E', 'G', 'A', 'P', 'M', 'N'];
    const names = { 'E': 'Excellent', 'G': 'Good', 'A': 'Average', 'P': 'Poor', 'M': 'Minimal', 'N': 'None' };
    return opts.map(o => `<option value="${o}"${o === current ? ' selected' : ''}>${names[o]}</option>`).join('');
}

function getDamageTypeOptions(current) {
    const opts = ['B', 'P', 'S', 'BP', 'BS', 'PS', 'BPS'];
    const names = { 'B': 'Bludge', 'P': 'Pierce', 'S': 'Slash', 'BP': 'B/P', 'BS': 'B/S', 'PS': 'P/S', 'BPS': 'All' };
    return opts.map(o => `<option value="${o}"${o === current ? ' selected' : ''}>${names[o]}</option>`).join('');
}

window.applyPreviewChanges = function() {
    if (!selectedPreviewItem || !previewCharType || !selectedPreviewSlot) return;
    
    const char = previewCharType === 'player' ? player : enemy;
    const preview = document.getElementById('item-preview');
    const item = selectedPreviewItem;
    const oldDurability = item.durability;
    
    preview.querySelectorAll('.preview-edit').forEach(input => {
        const field = input.dataset.field;
        let value = input.type === 'number' ? (parseFloat(input.value) || 0) : input.value;
        
        if (field === 'blockChance') value = value / 100;
        
        if (item[field] !== undefined) {
            item[field] = value;
        }
    });
    
    item.currentDurability = item.durability;
    
    if (item.coversSlots.length > 0) {
        item.coversSlots.forEach(coveredSlot => {
            const coveredItem = new Item({ ...item.toDict(), slot: coveredSlot });
            char.gear[coveredSlot] = coveredItem;
        });
    }
    
    mirror2HToOffhand(char);
    char.currentHp = char.effectiveHp();
    
    previewItemChanged = false;
    renderGearEditors();
    updateUI();
    updateItemPreview();
};

window.resetPreviewItem = function() {
    const items = getItemsForSlot(selectedPreviewSlot);
    const originalItem = items.find(i => i.name === selectedPreviewItem.name);
    if (originalItem) {
        selectedPreviewItem = new Item({ ...originalItem });
        updateItemPreview();
    }
};

function findBestEquipSlot(char, slot, item) {
    if (slot !== 'mainhand' && slot !== 'offhand') {
        return slot;
    }
    
    const mh = char.gear['mainhand'];
    const oh = char.gear['offhand'];
    const mhEmpty = !mh || mh.isEmpty();
    const ohEmpty = !oh || oh.isEmpty();
    
    if (item.isTwoHanded) {
        return 'mainhand';
    }
    
    if (item.isShield) {
        if (ohEmpty) return 'offhand';
        if (mhEmpty) return 'mainhand';
        return 'offhand';
    }
    
    if (mhEmpty) {
        return 'mainhand';
    }
    if (ohEmpty) {
        return 'offhand';
    }
    
    return 'mainhand';
}

function handleGearChange(charType, slot, value) {
    const char = charType === 'player' ? player : enemy;
    let item = null;

    if (value) {
        const items = getItemsForSlot(slot);
        item = items.find(i => i.name === value);
    }

    if (!item) {
        item = new Item({ name: 'Empty', slot: slot });
    } else {
        const actualSlot = findBestEquipSlot(char, slot, item);
        item = new Item({ ...item.toDict(), slot: actualSlot });
        slot = actualSlot;
    }

    char.gear[slot] = item;

    if (item.coversSlots.length > 0) {
        item.coversSlots.forEach(coveredSlot => {
            char.gear[coveredSlot] = new Item({ ...item.toDict(), slot: coveredSlot });
            const coveredSelect = document.getElementById(`${charType}-gear-${coveredSlot}`);
            if (coveredSelect) {
                coveredSelect.value = item.name;
            }
        });
    }

    if (slot === 'mainhand' && item.isTwoHanded) {
        char.gear['offhand'] = new Item({ name: 'Empty', slot: 'offhand' });
        const offhandSelect = document.getElementById(`${charType}-gear-offhand`);
        if (offhandSelect) offhandSelect.value = '';
    }

    renderGearEditors();
    updateUI();
}

function renderBuffEditors() {
    renderBuffGrid('player-buffs', player);
    renderBuffGrid('enemy-buffs', enemy);
}

function renderBuffGrid(containerId, char) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const setBuffs = getSetBuffs();
    const groupedBuffs = {};
    setBuffs.forEach(buff => {
        if (!groupedBuffs[buff.name]) groupedBuffs[buff.name] = buff;
    });

    for (const [name, buff] of Object.entries(groupedBuffs)) {
        const isActive = char.buffs.some(b => b.name === name);
        const div = document.createElement('div');
        div.className = 'buff-item';
        div.innerHTML = `
            <input type="checkbox" id="buff-${name.replace(/[^a-zA-Z0-9]/g, '')}" ${isActive ? 'checked' : ''}>
            <label for="buff-${name.replace(/[^a-zA-Z0-9]/g, '')}">${name}</label>
        `;
        container.appendChild(div);
        div.querySelector('input').addEventListener('change', (e) => {
            toggleBuff(char, name, e.target.checked);
        });
    }
}

function toggleBuff(char, buffName, active) {
    if (active) {
        const setBuffs = getSetBuffs().filter(b => b.name === buffName);
        char.buffs.push(...setBuffs.map(b => new Buff(b.name, b.stat, b.flatValue, b.pctValue)));
    } else {
        char.buffs = char.buffs.filter(b => b.name !== buffName);
    }
    char.currentHp = char.effectiveHp();
    updateUI();
}

function updateCharacterForms() {
    document.getElementById('player-name-input').value = player.name;
    document.getElementById('player-str-input').value = player.baseStr;
    document.getElementById('player-dex-input').value = player.baseDex;
    document.getElementById('player-int-input').value = player.baseInt;
    document.getElementById('player-hp-input').value = player.baseHp;

    document.getElementById('enemy-name-input').value = enemy.name;
    document.getElementById('enemy-str-input').value = enemy.baseStr;
    document.getElementById('enemy-dex-input').value = enemy.baseDex;
    document.getElementById('enemy-int-input').value = enemy.baseInt;
    document.getElementById('enemy-hp-input').value = enemy.baseHp;

    renderGearEditors();
}

function savePlayer() {
    const strInput = document.getElementById('player-str-input');
    const dexInput = document.getElementById('player-dex-input');
    const intInput = document.getElementById('player-int-input');
    const hpInput = document.getElementById('player-hp-input');
    
    player.name = document.getElementById('player-name-input').value || 'Player';
    player.baseStr = Math.max(1, Math.min(100, parseFloat(strInput.value) || 10));
    player.baseDex = Math.max(1, Math.min(100, parseFloat(dexInput.value) || 10));
    player.baseInt = Math.max(1, Math.min(100, parseFloat(intInput.value) || 10));
    player.baseHp = Math.max(1, Math.min(10000, parseInt(hpInput.value) || 100));
    
    strInput.value = player.baseStr;
    dexInput.value = player.baseDex;
    intInput.value = player.baseInt;
    hpInput.value = player.baseHp;
    
    player.currentHp = player.effectiveHp();
    mirror2HToOffhand(player);
    saveLoadout('current_player', player);
    updateUI();
}

function saveCurrentEnemy() {
    const strInput = document.getElementById('enemy-str-input');
    const dexInput = document.getElementById('enemy-dex-input');
    const intInput = document.getElementById('enemy-int-input');
    const hpInput = document.getElementById('enemy-hp-input');
    
    enemy.name = document.getElementById('enemy-name-input').value || 'Enemy';
    enemy.baseStr = Math.max(1, Math.min(100, parseFloat(strInput.value) || 10));
    enemy.baseDex = Math.max(1, Math.min(100, parseFloat(dexInput.value) || 10));
    enemy.baseInt = Math.max(1, Math.min(100, parseFloat(intInput.value) || 10));
    enemy.baseHp = Math.max(1, Math.min(10000, parseInt(hpInput.value) || 100));
    
    strInput.value = enemy.baseStr;
    dexInput.value = enemy.baseDex;
    intInput.value = enemy.baseInt;
    hpInput.value = enemy.baseHp;
    
    enemy.currentHp = enemy.effectiveHp();
    enemy.currentHp = enemy.effectiveHp();
    mirror2HToOffhand(enemy);
    saveLoadout('current_enemy', enemy);
    updateUI();
}

function updateItemSlotOptions() {
    const typeSelect = document.getElementById('item-type-input');
    const slotSelect = document.getElementById('item-slot-input');
    const weaponStats = document.getElementById('weapon-stats-section');
    
    const type = typeSelect.value;
    let slots = [];
    
    if (type === 'weapon') {
        slots = [{ value: 'hand', label: 'Hand' }];
        weaponStats.style.display = 'block';
        document.getElementById('item-numdice-input').value = '1';
        document.getElementById('item-diesize-input').value = '8';
    } else if (type === 'armor') {
        slots = [
            ...ARMOR_SLOTS.map(s => ({ value: s, label: SLOT_DISPLAY[s] || s })),
            { value: 'necklace', label: 'Necklace' },
            { value: 'ring1', label: 'Ring' },
            { value: 'ring2', label: 'Ring' }
        ];
        weaponStats.style.display = 'none';
        document.getElementById('item-numdice-input').value = '0';
        document.getElementById('item-diesize-input').value = '0';
    } else if (type === 'shield') {
        slots = [{ value: 'hand', label: 'Hand' }];
        weaponStats.style.display = 'none';
        document.getElementById('item-numdice-input').value = '0';
        document.getElementById('item-diesize-input').value = '0';
    }
    
    const currentValue = slotSelect.value;
    slotSelect.innerHTML = slots.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
    
    if (slots.some(s => s.value === currentValue)) {
        slotSelect.value = currentValue;
    }
    
    const coversSection = document.getElementById('covers-slots-section');
    if (coversSection) {
        coversSection.style.display = type === 'armor' ? 'block' : 'none';
    }
}

function setupItemBuilder() {
    const typeSelect = document.getElementById('item-type-input');
    
    typeSelect.addEventListener('change', updateItemSlotOptions);
    
    document.getElementById('btn-create-item').addEventListener('click', createItem);
    document.getElementById('btn-clear-item').addEventListener('click', clearItemForm);
    renderCustomItems();
    updateItemSlotOptions();
}

function createItem() {
    const name = document.getElementById('item-name-input').value.trim();
    if (!name) return alert('Please enter an item name');

    const slot = document.getElementById('item-slot-input').value;
    const type = document.getElementById('item-type-input').value;

    const numDice = parseInt(document.getElementById('item-numdice-input').value) || 0;
    const dieSize = parseInt(document.getElementById('item-diesize-input').value) || 0;
    const blockChance = parseInt(document.getElementById('item-bc-input').value) / 100;

    const isWeapon = type === 'weapon';
    const isShield = type === 'shield';

    const coversSlots = [];
    document.querySelectorAll('.covers-slot-check:checked').forEach(cb => {
        if (cb.value !== slot) coversSlots.push(cb.value);
    });

    const item = {
        name,
        slot,
        durability: parseInt(document.getElementById('item-dura-input').value) || 100,
        blockChance,
        damageReduction: parseInt(document.getElementById('item-dr-input').value) || 0,
        resistB: document.getElementById('item-resist-b-input').value,
        resistP: document.getElementById('item-resist-p-input').value,
        resistS: document.getElementById('item-resist-s-input').value,
        strModifier: parseInt(document.getElementById('item-str-input').value) || 0,
        dexPenalty: parseInt(document.getElementById('item-dex-input').value) || 0,
        intModifier: parseInt(document.getElementById('item-int-input').value) || 0,
        isWeapon,
        isShield,
        isTwoHanded: document.getElementById('item-twohanded-input').checked,
        numDice,
        dieSize,
        critMultiplier: parseFloat(document.getElementById('item-critmult-input').value) || 2,
        baseCritChance: parseInt(document.getElementById('item-critchance-input').value) || 0,
        damageTypeCombo: document.getElementById('item-damagetype-input').value,
        coversSlots,
    };

    const existingIndex = customItems.findIndex(i => i.name === name);
    if (existingIndex >= 0) {
        customItems[existingIndex] = item;
    } else {
        customItems.push(item);
    }

    saveCustomItems();
    invalidateItemCache();
    renderCustomItems();
    renderGearEditors();
    clearItemForm();
}

function clearItemForm() {
    document.getElementById('item-name-input').value = '';
    document.getElementById('item-type-input').value = 'weapon';
    document.getElementById('item-bc-input').value = '50';
    document.getElementById('item-dr-input').value = '10';
    document.getElementById('item-dura-input').value = '100';
    document.getElementById('item-resist-b-input').value = 'A';
    document.getElementById('item-resist-p-input').value = 'A';
    document.getElementById('item-resist-s-input').value = 'A';
    document.getElementById('item-str-input').value = '0';
    document.getElementById('item-dex-input').value = '0';
    document.getElementById('item-int-input').value = '0';
    document.getElementById('item-numdice-input').value = '1';
    document.getElementById('item-diesize-input').value = '8';
    document.getElementById('item-critmult-input').value = '2';
    document.getElementById('item-critchance-input').value = '10';
    document.getElementById('item-twohanded-input').checked = false;
    document.querySelectorAll('.covers-slot-check').forEach(cb => cb.checked = false);
    updateItemSlotOptions();
}

function renderCustomItems() {
    const container = document.getElementById('custom-items-list');
    if (customItems.length === 0) {
        container.innerHTML = '<p class="empty-msg">No custom items yet. Create one using the form!</p>';
        return;
    }

    container.innerHTML = customItems.map((item, idx) => {
        const itemObj = new Item({ ...item });
        const stats = itemObj.getDisplayStats();
        return `
            <div class="item-card">
                <h4>${item.name}</h4>
                <div class="item-stats">
                    ${stats.map(s => `<span>${s.label}: ${s.value}</span>`).join('')}
                </div>
                <div class="item-actions">
                    <button class="btn btn-small btn-danger" onclick="deleteCustomItem(${idx})">Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

window.deleteCustomItem = function(idx) {
    customItems.splice(idx, 1);
    saveCustomItems();
    invalidateItemCache();
    renderCustomItems();
    renderGearEditors();
};

function saveCustomItems() {
    localStorage.setItem('isim_custom_items', JSON.stringify(customItems));
}

function loadCustomData() {
    try {
        const items = localStorage.getItem('isim_custom_items');
        if (items) customItems = JSON.parse(items);
        const buffs = localStorage.getItem('isim_custom_buffs');
        if (buffs) customBuffs = JSON.parse(buffs);
    } catch (e) {
        console.error('Failed to load custom data', e);
    }
}

function setupBuffBuilder() {
    document.getElementById('buff-flat-input').addEventListener('input', updateBuffPreview);
    document.getElementById('buff-pct-input').addEventListener('input', updateBuffPreview);
    document.getElementById('btn-create-buff').addEventListener('click', createBuff);
    document.getElementById('btn-clear-buff').addEventListener('click', clearBuffForm);
    renderCustomBuffs();
    updateBuffPreview();
}

function updateBuffPreview() {
    const flat = parseInt(document.getElementById('buff-flat-input').value) || 0;
    const pct = parseInt(document.getElementById('buff-pct-input').value) || 0;
    document.getElementById('buff-preview').textContent = `Preview: ${flat >= 0 ? '+' : ''}${flat} flat / ${pct >= 0 ? '+' : ''}${pct}%`;
}

function createBuff() {
    const name = document.getElementById('buff-name-input').value.trim();
    if (!name) return alert('Please enter a buff name');

    const buff = {
        name,
        stat: document.getElementById('buff-stat-input').value,
        flatValue: parseInt(document.getElementById('buff-flat-input').value) || 0,
        pctValue: parseInt(document.getElementById('buff-pct-input').value) || 0,
    };

    const existingIndex = customBuffs.findIndex(b => b.name === name);
    if (existingIndex >= 0) {
        customBuffs[existingIndex] = buff;
    } else {
        customBuffs.push(buff);
    }

    saveCustomBuffs();
    renderCustomBuffs();
    clearBuffForm();
}

function clearBuffForm() {
    document.getElementById('buff-name-input').value = '';
    document.getElementById('buff-stat-input').value = 'str';
    document.getElementById('buff-flat-input').value = '0';
    document.getElementById('buff-pct-input').value = '0';
    updateBuffPreview();
}

function renderCustomBuffs() {
    const container = document.getElementById('custom-buffs-list');
    if (customBuffs.length === 0) {
        container.innerHTML = '<p class="empty-msg">No custom buffs yet. Create one using the form!</p>';
        return;
    }

    container.innerHTML = customBuffs.map((buff, idx) => `
        <div class="buff-card">
            <h4>${buff.name}</h4>
            <div class="buff-stats">
                <span>Stat: ${buff.stat.toUpperCase()}</span>
                <span>${buff.flatValue >= 0 ? '+' : ''}${buff.flatValue} flat</span>
                <span>${buff.pctValue >= 0 ? '+' : ''}${buff.pctValue}%</span>
            </div>
            <div class="buff-actions">
                <button class="btn btn-small btn-danger" onclick="deleteCustomBuff(${idx})">Delete</button>
            </div>
        </div>
    `).join('');
}

window.deleteCustomBuff = function(idx) {
    customBuffs.splice(idx, 1);
    saveCustomBuffs();
    renderCustomBuffs();
};

function saveCustomBuffs() {
    localStorage.setItem('isim_custom_buffs', JSON.stringify(customBuffs));
}

function setupPresetManagement() {
    document.getElementById('preset-type-input').addEventListener('change', updatePresetList);
    document.getElementById('btn-load-preset').addEventListener('click', loadPreset);
    document.getElementById('btn-save-preset').addEventListener('click', savePreset);
    document.getElementById('btn-delete-preset').addEventListener('click', deletePreset);
    document.getElementById('btn-export').addEventListener('click', () => exportData());
    document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file-input').click());
    document.getElementById('import-file-input').addEventListener('change', handleImport);

    updatePresetList();
    renderEnemyCards();
}

function updatePresetList() {
    const type = document.getElementById('preset-type-input').value;
    const select = document.getElementById('preset-list-input');
    select.innerHTML = '';

    const items = type === 'loadout' ? listLoadouts() : listEnemies();
    items.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });

    if (items.length === 0) {
        select.innerHTML = '<option>No presets saved</option>';
    }
}

function loadPreset() {
    const type = document.getElementById('preset-type-input').value;
    const name = document.getElementById('preset-list-input').value;
    if (!name || name === 'No presets saved') return;

    let char;
    if (type === 'loadout') {
        char = loadLoadout(name);
        if (char) player = char;
    } else {
        char = loadEnemy(name);
        if (char) enemy = char;
    }

    if (char) {
        updateCharacterForms();
        updateUI();
    }
}

function savePreset() {
    const name = document.getElementById('preset-name-input').value.trim();
    if (!name) return alert('Please enter a preset name');

    const type = document.getElementById('preset-save-type-input').value;
    if (type === 'loadout') {
        saveLoadout(name, player);
    } else {
        saveEnemy(name, enemy);
    }

    document.getElementById('preset-name-input').value = '';
    updatePresetList();
    renderEnemyCards();
}

function deletePreset() {
    const type = document.getElementById('preset-type-input').value;
    const name = document.getElementById('preset-list-input').value;
    if (!name || name === 'No presets saved') return;

    if (type === 'loadout') {
        deleteLoadout(name);
    } else {
        deleteEnemy(name);
    }

    updatePresetList();
    renderEnemyCards();
}

function renderEnemyCards() {
    const container = document.getElementById('enemy-cards');
    const presets = getPresets();
    const enemies = presets.enemies;

    if (Object.keys(enemies).length === 0) {
        container.innerHTML = '<p class="empty-msg">No enemy presets available.</p>';
        return;
    }

    container.innerHTML = Object.entries(enemies).map(([key, data]) => `
        <div class="enemy-card" onclick="loadEnemyPreset('${key}')">
            <h4>${data.name || key}</h4>
            <div class="enemy-stats">
                <div>STR: ${data.baseStr} | DEX: ${data.baseDex} | INT: ${data.baseInt}</div>
                <div>HP: ${data.baseHp}</div>
            </div>
        </div>
    `).join('');
}

window.loadEnemyPreset = function(name) {
    const presets = getPresets();
    if (presets.enemies[name]) {
        const expanded = expandCharacterPreset(presets.enemies[name]);
        enemy = Character.fromDict(expanded);
        updateCharacterForms();
        updateUI();
    }
};

function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (data.customItems) {
                customItems = data.customItems;
                saveCustomItems();
                invalidateItemCache();
                renderCustomItems();
            }
            if (data.customBuffs) {
                customBuffs = data.customBuffs;
                saveCustomBuffs();
                renderCustomBuffs();
            }
            updatePresetList();
            renderEnemyCards();
            alert('Import successful!');
        } catch (err) {
            alert('Import failed: ' + err.message);
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

function updateUI() {
    document.getElementById('player-name').textContent = player.name;
    document.getElementById('player-str').innerHTML = `${player.baseStr} <span class="eff-value">(${player.effectiveStr().toFixed(1)})</span>`;
    document.getElementById('player-dex').innerHTML = `${player.baseDex} <span class="eff-value">(${player.effectiveDex().toFixed(1)})</span>`;
    document.getElementById('player-int').innerHTML = `${player.baseInt} <span class="eff-value">(${player.effectiveInt().toFixed(1)})</span>`;

    const playerHpPct = Math.max(0, player.currentHp / player.effectiveHp() * 100);
    document.getElementById('player-hp-fill').style.width = playerHpPct + '%';
    document.getElementById('player-hp-text').textContent = `${Math.max(0, Math.round(player.currentHp))}/${player.effectiveHp()}`;

    document.getElementById('enemy-name').textContent = enemy.name;
    document.getElementById('enemy-str').innerHTML = `${enemy.baseStr} <span class="eff-value">(${enemy.effectiveStr().toFixed(1)})</span>`;
    document.getElementById('enemy-dex').innerHTML = `${enemy.baseDex} <span class="eff-value">(${enemy.effectiveDex().toFixed(1)})</span>`;
    document.getElementById('enemy-int').innerHTML = `${enemy.baseInt} <span class="eff-value">(${enemy.effectiveInt().toFixed(1)})</span>`;

    const enemyHpPct = Math.max(0, enemy.currentHp / enemy.effectiveHp() * 100);
    document.getElementById('enemy-hp-fill').style.width = enemyHpPct + '%';
    document.getElementById('enemy-hp-text').textContent = `${Math.max(0, Math.round(enemy.currentHp))}/${enemy.effectiveHp()}`;

    updateAllBodySilhouettes();
}

window.__setItemData = function(data) {
    window.__itemData = data;
    invalidateItemCache();
};

document.addEventListener('DOMContentLoaded', init);
