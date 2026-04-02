import { resolveAttack, mirror2HToOffhand } from './combat.js';
import { Item, DAMAGE_TYPE_DISPLAY } from './item.js';

export class TurnBasedController {
    constructor(player, enemy) {
        this.player = player;
        this.enemy = enemy;
        this.turn = 0;
        this.active = false;
    }

    start() {
        this.turn = 0;
        this.active = true;
        this.player.resetCombat();
        this.enemy.resetCombat();
        mirror2HToOffhand(this.player);
        mirror2HToOffhand(this.enemy);
    }

    doTurn(type = 'main') {
        if (!this.active) return { done: false, messages: [] };

        const messages = [];
        this.turn++;
        messages.push({ text: `-- Turn ${this.turn} --`, type: 'turn' });

        const weaponSlot = type === 'off' ? 'offhand' : 'mainhand';
        let weapon = this.player.gear[weaponSlot];
        if (!weapon || weapon.isEmpty()) {
            weapon = new Item({ name: 'Fists', slot: 'mainhand', isWeapon: true, isShield: true });
        }

        const playerResult = this.resolveAttackerAttack(this.player, this.enemy, weapon, messages, true);

        if (!this.enemy.isAlive()) {
            messages.push({ text: `${this.enemy.name} has been defeated!`, type: 'victory' });
            this.active = false;
            return { done: true, result: 'victory', messages };
        }

        const enemyWeapon = this.enemy.gear['mainhand'];
        if (!enemyWeapon || enemyWeapon.isEmpty()) {
            messages.push({ text: `${this.enemy.name} has no weapon, counterattacks with Fists.`, type: 'system' });
        }

        const actualEnemyWeapon = enemyWeapon || new Item({ name: 'Fists', slot: 'mainhand', isWeapon: true, isShield: true });
        this.resolveAttackerAttack(this.enemy, this.player, actualEnemyWeapon, messages, false);

        if (!this.player.isAlive()) {
            messages.push({ text: `${this.player.name} has been defeated!`, type: 'defeat' });
            this.active = false;
            return { done: true, result: 'defeat', messages };
        }

        return { done: false, messages };
    }

    resolveAttackerAttack(attacker, defender, weapon, messages, isPlayer) {
        const attackerName = attacker.name;
        const defenderName = defender.name;
        const attackerType = isPlayer ? 'player' : 'enemy';

        const result = resolveAttack(attacker, defender, weapon);

        messages.push({
            text: `${attackerName} attacks with ${weapon.name}.`,
            type: 'action',
            attacker: attackerType
        });

        if (!result.hit) {
            messages.push({
                text: `The attack MISSED.`,
                type: 'miss',
                attacker: attackerType
            });
            return result;
        }

        const critMsg = result.isCrit ? ' CRITICAL HIT!' : '';
        messages.push({
            text: `The attack HIT${critMsg}`,
            type: result.isCrit ? 'crit' : 'hit',
            attacker: attackerType
        });

        const typeStr = result.damageTypes
            .map(t => DAMAGE_TYPE_DISPLAY[t] || t)
            .join('/');
        const strInfo = result.strBonus > 0 ? ` (${result.strBonus} from strength)` : '';
        const totalRolled = result.diceDmg + result.strBonus;
        const strPart = result.strBonus > 0 ? ` (${result.strBonus} from strength)` : '';

        if (result.damage === 0) {
            if (result.fullyBlocked) {
                let blockMsg = `All ${totalRolled} damage${strPart} was blocked`;
                if (result.blockedItems.length > 0) {
                    const blockerNames = result.blockedItems.map(b => b.itemName).join(', ');
                    blockMsg += ` by ${blockerNames}`;
                }
                blockMsg += '.';
                messages.push({ text: blockMsg, type: 'blocked', attacker: attackerType });
            }
        } else {
            if (result.blockedItems.length > 0) {
                const totalBlocked = result.blockedItems.reduce((sum, b) => sum + b.blockedAmount, 0);
                const blockedNames = result.blockedItems.map(b => b.itemName).join(', ');
                
                if (result.fullyBlocked || totalBlocked >= totalRolled - result.damage) {
                    let blockMsg = `${totalRolled} damage${strPart} rolled, blocked by ${blockedNames}, but ${result.damage} damage was done.`;
                    messages.push({ text: blockMsg, type: 'damage', attacker: attackerType });
                } else {
                    let blockMsg = `${totalRolled} damage${strPart} rolled, partially blocked by ${blockedNames}.`;
                    messages.push({ text: blockMsg, type: 'blocked', attacker: attackerType });
                }
            } else {
                const hitSlotMsg = result.bodySlotHit ? ` (hit on ${result.bodySlotHit})` : '';
                let damageMsg = `${totalRolled} damage${strPart} rolled, ${result.damage} damage was done to ${defenderName} with ${weapon.name}${hitSlotMsg}.`;
                
                if (result.failedBlocks && result.failedBlocks.length > 0) {
                    const failedNames = result.failedBlocks.map(f => f.itemName || f.slot).join(', ');
                    damageMsg += ` (unblocked by ${failedNames})`;
                }
                
                messages.push({
                    text: damageMsg,
                    type: 'damage',
                    attacker: attackerType
                });
            }
        }

        return result;
    }
}
