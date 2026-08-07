"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPots = buildPots;
exports.potTotal = potTotal;
exports.awardPots = awardPots;
exports.payoutsFromAwards = payoutsFromAwards;
const evaluator_1 = require("./evaluator");
/**
 * Splits everything the players committed this hand into a main pot plus any
 * side pots.
 *
 * Contributions are sliced at each distinct all-in level. Every layer is
 * funded by all players who reached that level — including folded players,
 * whose chips stay in the pot — but only players who are still in the hand
 * are eligible to win it. Pots come back ordered smallest layer first, which
 * is also the order they must be awarded in.
 */
function buildPots(players) {
    const contributors = players.filter((p) => p.totalCommitted > 0);
    if (contributors.length === 0)
        return [];
    const levels = Array.from(new Set(contributors.map((p) => p.totalCommitted))).sort((a, b) => a - b);
    const pots = [];
    let previousLevel = 0;
    for (const level of levels) {
        const layer = level - previousLevel;
        previousLevel = level;
        if (layer <= 0)
            continue;
        const inLayer = contributors.filter((p) => p.totalCommitted >= level);
        const amount = layer * inLayer.length;
        if (amount <= 0)
            continue;
        const eligible = inLayer
            .filter((p) => p.status !== 'FOLDED')
            .map((p) => p.id);
        if (eligible.length === 0) {
            // Dead money nobody can win on its own — fold it back into the pot
            // below it, or into the first pot if this is the bottom layer.
            if (pots.length > 0) {
                pots[pots.length - 1].amount += amount;
            }
            else {
                pots.push({ amount, eligiblePlayerIds: [] });
            }
            continue;
        }
        const previous = pots[pots.length - 1];
        if (previous && sameIds(previous.eligiblePlayerIds, eligible)) {
            previous.amount += amount;
        }
        else {
            pots.push({ amount, eligiblePlayerIds: eligible });
        }
    }
    // A bottom layer with no eligible players (everyone in it folded) can only
    // be claimed by whoever is left, so hand it to the survivors.
    if (pots.length > 0 && pots[0].eligiblePlayerIds.length === 0) {
        const survivors = players
            .filter((p) => p.status !== 'FOLDED' && p.status !== 'SITTING_OUT')
            .map((p) => p.id);
        if (pots.length > 1) {
            pots[1].amount += pots[0].amount;
            pots.shift();
        }
        else {
            pots[0].eligiblePlayerIds = survivors;
        }
    }
    return pots;
}
function sameIds(a, b) {
    if (a.length !== b.length)
        return false;
    const set = new Set(a);
    return b.every((id) => set.has(id));
}
/** Total chips sitting in a list of pots. */
function potTotal(pots) {
    return pots.reduce((sum, pot) => sum + pot.amount, 0);
}
/**
 * Awards every pot to the best eligible hand(s).
 *
 * @param pots        Ordered smallest first, as returned by `buildPots`.
 * @param strengths   Evaluated hand per player. A player missing from the map
 *                    (or mapped to null) cannot win — folded, or never dealt.
 * @param oddChipOrder Player ids ordered starting from the first seat left of
 *                    the button. Split pots that do not divide evenly give the
 *                    leftover chips out one at a time in this order.
 */
function awardPots(pots, strengths, oddChipOrder) {
    const seatRank = new Map(oddChipOrder.map((id, index) => [id, index]));
    const positionOf = (id) => seatRank.get(id) ?? Number.MAX_SAFE_INTEGER;
    return pots.map((pot, potIndex) => {
        const contenders = pot.eligiblePlayerIds.filter((id) => strengths.get(id));
        // Uncontested (everyone else folded): the lone eligible player takes it
        // without needing an evaluated hand.
        const claimants = contenders.length > 0 ? contenders : pot.eligiblePlayerIds.slice();
        if (claimants.length === 0) {
            return { potIndex, amount: pot.amount, eligiblePlayerIds: pot.eligiblePlayerIds, winners: [] };
        }
        let winners = claimants;
        if (contenders.length > 1) {
            winners = claimants.reduce((best, id) => {
                if (best.length === 0)
                    return [id];
                const cmp = (0, evaluator_1.compareHands)(strengths.get(id), strengths.get(best[0]));
                if (cmp > 0)
                    return [id];
                if (cmp === 0)
                    return [...best, id];
                return best;
            }, []);
        }
        winners = winners.slice().sort((a, b) => positionOf(a) - positionOf(b));
        const share = Math.floor(pot.amount / winners.length);
        let remainder = pot.amount - share * winners.length;
        const payouts = winners.map((playerId) => {
            let amount = share;
            if (remainder > 0) {
                amount += 1;
                remainder -= 1;
            }
            return { playerId, amount };
        });
        return {
            potIndex,
            amount: pot.amount,
            eligiblePlayerIds: pot.eligiblePlayerIds,
            winners: payouts,
        };
    });
}
/** Collapses pot awards into a per-player total. */
function payoutsFromAwards(awards) {
    const payouts = {};
    for (const award of awards) {
        for (const winner of award.winners) {
            payouts[winner.playerId] = (payouts[winner.playerId] ?? 0) + winner.amount;
        }
    }
    return payouts;
}
//# sourceMappingURL=pot.js.map