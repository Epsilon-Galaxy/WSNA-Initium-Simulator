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

        const result = resolveAttack(attacker, defender, weapon);

        messages.push({
            text: `${attackerName} attacks with ${weapon.name}.`,
            type: 'action'
        });

        if (!result.hit) {
            messages.push({
                text: `The attack MISSED.`,
                type: 'miss'
            });
            return result;
        }

        messages.push({
            text: `The attack HIT.`,
            type: 'hit'
        });

        const typeStr = result.damageTypes
            .map(t => DAMAGE_TYPE_DISPLAY[t] || t)
            .join('/');
        const strInfo = result.strBonus > 0 ? ` (${result.strBonus} from strength)` : '';

        if (result.damage === 0) {
            if (result.fullyBlocked) {
                let blockMsg = `All ${result.diceDmg + result.strBonus} damage was blocked`;
                if (result.blockedItems.length > 0) {
                    const blockerNames = result.blockedItems.map(b => b.itemName).join(', ');
                    blockMsg += ` due to ${blockerNames}`;
                }
                blockMsg += '.';
                messages.push({ text: blockMsg, type: 'blocked' });
            }
        } else {
            if (result.blockedItems.length > 0) {
                const totalBlocked = result.blockedItems.reduce((sum, b) => sum + b.blockedAmount, 0);
                const firstBlocker = result.blockedItems[0];
                
                if (result.fullyBlocked || totalBlocked >= result.diceDmg + result.strBonus - result.damage) {
                    let blockMsg = `However, ${result.damage} damage was done.`;
                    messages.push({ text: blockMsg, type: 'damage' });
                } else {
                    let blockMsg = `This attack was partially blocked.`;
                    messages.push({ text: blockMsg, type: 'blocked' });
                }
            } else {
                messages.push({
                    text: `${result.damage} damage was done to ${defenderName} with ${weapon.name}.`,
                    type: 'damage'
                });
            }
        }

        return result;
    }
}
