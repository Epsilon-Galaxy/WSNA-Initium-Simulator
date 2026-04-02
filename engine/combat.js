import { Item, SLOT_NAMES, SLOT_DISPLAY, BODY_HIT_TABLE, DAMAGE_TYPE_DISPLAY } from './item.js';

export function rollDice(num, sides) {
    if (num <= 0 || sides <= 0) return 0;
    let total = 0;
    for (let i = 0; i < num; i++) {
        total += Math.floor(Math.random() * sides) + 1;
    }
    return total;
}

export function rollHit(attacker, defender) {
    const ae = attacker.effectiveDex();
    const de = defender.effectiveDex();
    const ar = ae > 0 ? Math.random() * ae : 0.0;
    const dr = de > 0 ? Math.random() * de : 0.0;
    return { hit: ar > dr, attackerRoll: ar, defenderRoll: dr };
}

export function rollWeaponDamage(attacker, weapon, log = null) {
    let isCrit = false;
    let diceDmg = 0;
    let strBonus = 0;

    if (!weapon.isShield && !(weapon.numDice === 0 && weapon.dieSize === 0)) {
        diceDmg = rollDice(weapon.numDice, weapon.dieSize);
        const critChance = attacker.effectiveCrit(weapon);
        if (Math.random() < critChance) {
            isCrit = true;
            const mult = weapon.critMultiplier > 0 ? weapon.critMultiplier : 2.0;
            diceDmg = Math.round(diceDmg * mult);
            if (log) log.push(`** CRITICAL HIT x${mult}! Dice rolled ${diceDmg} **`);
        }
    }

    const effStr = attacker.effectiveStr();
    const strMax = (weapon.isTwoHanded ? 3.0 : 2.0) * effStr;
    strBonus = Math.round(Math.random() * strMax);

    return { diceDmg, strBonus, isCrit };
}

export function rollBodyPart() {
    const r = Math.random();
    let cum = 0.0;
    for (const [slot, chance] of BODY_HIT_TABLE) {
        cum += chance;
        if (r < cum) return slot;
    }
    return 'boots';
}

export function resolveItemBlock(item, damage, damageTypes, log = null) {
    if (item.isEmpty() || item.isBroken()) {
        return { remaining: damage, blocked: false, blockedAmount: 0 };
    }
    if (Math.random() >= item.blockChance) {
        return { remaining: damage, blocked: false, blockedAmount: 0 };
    }

    item.currentDurability -= 1;
    const reduction = item.calcDamageReduction(damage, damageTypes);
    const remaining = damage - reduction;
    const broken = item.isBroken();

    return {
        remaining,
        blocked: true,
        blockedAmount: reduction,
        itemName: item.name,
        durability: item.currentDurability,
        broken
    };
}

export function resolveDamageChain(defender, damage, damageTypes, log = null) {
    let remaining = damage;
    const blockedItems = [];

    const blockOrder = ['mainhand', 'offhand', 'ring1', 'ring2', 'necklace'];
    for (const slot of blockOrder) {
        if (remaining <= 0) break;
        const item = defender.gear[slot];
        if (item && !item.isEmpty() && !item.isBroken()) {
            const result = resolveItemBlock(item, remaining, damageTypes, log);
            if (result.blocked) {
                remaining = result.remaining;
                blockedItems.push(result);
                if (result.broken) {
                    blockedItems[blockedItems.length - 1].broken = true;
                }
            }
            if (result.blocked && item.isWeapon && item.isTwoHanded) {
                const mh = defender.gear['mainhand'];
                const oh = defender.gear['offhand'];
                if (mh && oh) {
                    const sharedDura = Math.min(mh.currentDurability, oh.currentDurability);
                    mh.currentDurability = sharedDura;
                    oh.currentDurability = sharedDura;
                }
            }
        }
    }

    if (remaining <= 0) {
        return { damage: 0, blockedItems, fullyBlocked: true };
    }

    const bodySlot = rollBodyPart();
    const bodyItem = defender.gear[bodySlot];
    if (bodyItem && !bodyItem.isEmpty() && !bodyItem.isBroken()) {
        const result = resolveItemBlock(bodyItem, remaining, damageTypes, log);
        if (result.blocked) {
            remaining = result.remaining;
            blockedItems.push(result);
        }
    }

    if (bodySlot === 'chest' && remaining > 0) {
        const shirt = defender.gear['shirt'];
        if (shirt && !shirt.isEmpty() && !shirt.isBroken()) {
            const result = resolveItemBlock(shirt, remaining, damageTypes, log);
            if (result.blocked) {
                remaining = result.remaining;
                blockedItems.push(result);
            }
        }
    }

    const final = Math.max(0, remaining);
    return { damage: final, blockedItems, fullyBlocked: remaining <= 0 };
}

export function resolveAttack(attacker, defender, weapon, log = null) {
    const hitResult = rollHit(attacker, defender);
    if (!hitResult.hit) {
        return { damage: 0, hit: false, isCrit: false, diceDmg: 0, strBonus: 0 };
    }

    if (!weapon.isEmpty() && !weapon.isBroken()) {
        weapon.currentDurability -= 1;
    }

    const { diceDmg, strBonus, isCrit } = rollWeaponDamage(attacker, weapon, log);
    const dmgTypes = weapon.getDamageTypes();
    const damageResult = resolveDamageChain(defender, diceDmg + strBonus, dmgTypes, log);

    defender.currentHp -= damageResult.damage;

    return {
        damage: damageResult.damage,
        hit: true,
        isCrit,
        diceDmg,
        strBonus,
        damageTypes: dmgTypes,
        blockedItems: damageResult.blockedItems,
        fullyBlocked: damageResult.fullyBlocked,
        weaponName: weapon.name
    };
}

export function mirror2HToOffhand(char) {
    const mh = char.gear['mainhand'];
    if (mh && !mh.isEmpty() && !mh.isBroken() && mh.isWeapon && mh.isTwoHanded) {
        const oh = Item.fromDict(mh.toDict());
        oh.slot = 'offhand';
        oh.currentDurability = mh.currentDurability;
        char.gear['offhand'] = oh;
    }
}

export function resolveFullAttack(attacker, defender, useMainhand = true, log = null) {
    const weaponSlot = useMainhand ? 'mainhand' : 'offhand';
    let weapon = attacker.gear[weaponSlot];
    if (!weapon) {
        weapon = new Item({ name: 'Empty', slot: weaponSlot });
    }
    if (weapon.isEmpty()) {
        weapon = new Item({ name: 'Fists', slot: 'mainhand', isWeapon: true, isShield: true });
    }
    if (log) log.push(`[${attacker.name}] attacks with ${weapon.name}:`);

    const mhResult = resolveAttack(attacker, defender, weapon, log);
    let ohDmg = 0;

    if (useMainhand && !weapon.isTwoHanded) {
        const oh = attacker.gear['offhand'];
        if (oh && !oh.isEmpty() && !oh.isBroken() && oh.isWeapon && !oh.isShield) {
            if (Math.random() < attacker.effectiveCrit(oh)) {
                if (log) log.push(`[Offhand proc!] [${oh.name}]:`);
                const result = resolveAttack(attacker, defender, oh, log);
                ohDmg = result.damage;
            }
        }
    }
    return { mhDamage: mhResult.damage, ohDamage: ohDmg, hit: mhResult.hit };
}

export function resolveFlee(fleeing, opponent, log = null) {
    const fr = Math.random() * Math.max(0.001, fleeing.effectiveDex());
    const opr = Math.random() * Math.max(0.001, opponent.effectiveDex());
    const ok = fr > opr;
    if (log) log.push(`Flee roll: ${fr.toFixed(2)} vs ${opr.toFixed(2)} -> ${ok ? 'SUCCESS' : 'FAILED'}`);
    return ok;
}
