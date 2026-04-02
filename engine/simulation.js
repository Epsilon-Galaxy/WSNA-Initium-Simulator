import { Character } from './character.js';
import { resolveFullAttack, mirror2HToOffhand } from './combat.js';
import { SLOT_NAMES } from './item.js';

export class SimResult {
    constructor() {
        this.wins = 0;
        this.losses = 0;
        this.draws = 0;
        this.totalTurns = 0;
        this.totalSims = 0;
        this.playerDuraLoss = {};
        this.enemyDuraLoss = {};
    }

    winRate() { return this.totalSims > 0 ? this.wins / this.totalSims * 100 : 0; }
    lossRate() { return this.totalSims > 0 ? this.losses / this.totalSims * 100 : 0; }
    drawRate() { return this.totalSims > 0 ? this.draws / this.totalSims * 100 : 0; }
    avgTurns() { return this.totalSims > 0 ? this.totalTurns / this.totalSims : 0; }

    avgDuraLoss(side) {
        const d = side === 'player' ? this.playerDuraLoss : this.enemyDuraLoss;
        const result = {};
        for (const slot of SLOT_NAMES) {
            result[slot] = this.totalSims > 0 ? d[slot] / this.totalSims : 0;
        }
        return result;
    }
}

function freshCombatant(templateDict) {
    const c = Character.fromDict(templateDict);
    c.resetCombat();
    return c;
}

export function runWinrateSimulation(playerDict, enemyDict, nSims = 10000, maxTurns = 500) {
    const result = new SimResult();
    result.totalSims = nSims;

    for (const slot of SLOT_NAMES) {
        result.playerDuraLoss[slot] = 0.0;
        result.enemyDuraLoss[slot] = 0.0;
    }

    for (let i = 0; i < nSims; i++) {
        const player = freshCombatant(playerDict);
        const enemy = freshCombatant(enemyDict);
        mirror2HToOffhand(player);
        mirror2HToOffhand(enemy);

        const pStart = {};
        const eStart = {};
        for (const slot of SLOT_NAMES) {
            pStart[slot] = player.gear[slot].currentDurability;
            eStart[slot] = enemy.gear[slot].currentDurability;
        }

        let turns = 0;
        let outcome = 'draw';

        while (turns < maxTurns) {
            turns++;

            resolveFullAttack(player, enemy, true);
            if (!enemy.isAlive()) {
                outcome = 'win';
                break;
            }

            resolveFullAttack(enemy, player, true);
            if (!player.isAlive()) {
                outcome = 'loss';
                break;
            }
        }

        result.totalTurns += turns;
        if (outcome === 'win') result.wins++;
        else if (outcome === 'loss') result.losses++;
        else result.draws++;

        for (const slot of SLOT_NAMES) {
            const pLoss = pStart[slot] - player.gear[slot].currentDurability;
            const eLoss = eStart[slot] - enemy.gear[slot].currentDurability;
            result.playerDuraLoss[slot] += Math.max(0, pLoss);
            result.enemyDuraLoss[slot] += Math.max(0, eLoss);
        }
    }

    return result;
}

export function debugSingleCombat(playerDict, enemyDict, maxTurns = 500) {
    const player = freshCombatant(playerDict);
    const enemy = freshCombatant(enemyDict);
    mirror2HToOffhand(player);
    mirror2HToOffhand(enemy);
    const log = [];

    log.push(`=== DEBUG COMBAT: ${player.name} vs ${enemy.name} ===`);
    log.push(`Player  HP:${player.currentHp}  STR:${player.baseStr.toFixed(2)}  DEX:${player.baseDex.toFixed(2)}  INT:${player.baseInt.toFixed(2)}`);
    log.push(`        eDEX:${player.effectiveDex().toFixed(2)}  eSTR:${player.effectiveStr().toFixed(2)}  eINT:${player.effectiveInt().toFixed(2)}`);
    log.push(`Enemy   HP:${enemy.currentHp}  STR:${enemy.baseStr.toFixed(2)}  DEX:${enemy.baseDex.toFixed(2)}  INT:${enemy.baseInt.toFixed(2)}`);
    log.push(`        eDEX:${enemy.effectiveDex().toFixed(2)}  eSTR:${enemy.effectiveStr().toFixed(2)}  eINT:${enemy.effectiveInt().toFixed(2)}`);

    let turns = 0;
    while (turns < maxTurns) {
        turns++;
        log.push(`\n-- Turn ${turns} --`);
        resolveFullAttack(player, enemy, true, log);
        log.push(`  >> ${enemy.name} HP after: ${enemy.currentHp}`);
        if (!enemy.isAlive()) {
            log.push('ENEMY DEFEATED');
            break;
        }
        resolveFullAttack(enemy, player, true, log);
        log.push(`  >> ${player.name} HP after: ${player.currentHp}`);
        if (!player.isAlive()) {
            log.push('PLAYER DEFEATED');
            break;
        }
    }
    if (turns >= maxTurns) {
        log.push('MAX TURNS REACHED — DRAW');
    }

    return log.join('\n');
}
