"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTable = createTable;
exports.seatPlayer = seatPlayer;
exports.startHand = startHand;
exports.applyAction = applyAction;
exports.settle = settle;
exports.endHand = endHand;
exports.getLegalActions = getLegalActions;
exports.totalPot = totalPot;
exports.toPublicState = toPublicState;
const deck_1 = require("./deck");
const evaluator_1 = require("./evaluator");
const pot_1 = require("./pot");
const types_1 = require("./types");
const BETTING_STREETS = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];
/** Builds an empty table sitting in `WAITING`. */
function createTable(config) {
    const seats = Array.from({ length: config.seatCount }, (_, index) => ({
        index,
        player: null,
    }));
    const state = {
        tableId: config.tableId,
        handId: 0,
        street: 'WAITING',
        seats,
        buttonIndex: config.buttonIndex ?? 0,
        smallBlind: config.smallBlind,
        bigBlind: config.bigBlind,
        board: [],
        deck: [],
        burned: [],
        rng: { seed: config.seed ?? null, handSeed: null },
        actingIndex: null,
        currentBet: 0,
        minRaise: config.bigBlind,
        lastAggressorIndex: null,
        pendingBlinds: [],
        pots: [],
        history: [],
        result: null,
    };
    for (const assignment of config.players ?? []) {
        seatPlayerInPlace(state, assignment);
    }
    return state;
}
/** Seats a player. Returns a new state; `state` is not mutated. */
function seatPlayer(state, assignment) {
    const next = clone(state);
    seatPlayerInPlace(next, assignment);
    return next;
}
function seatPlayerInPlace(state, assignment) {
    const seat = state.seats[assignment.seatIndex];
    if (!seat) {
        throw new types_1.PokerError('ILLEGAL_ACTION', `No seat ${assignment.seatIndex}`);
    }
    if (seat.player) {
        throw new types_1.PokerError('ILLEGAL_ACTION', `Seat ${assignment.seatIndex} is taken`);
    }
    if (findSeatOf(state, assignment.id)) {
        throw new types_1.PokerError('ILLEGAL_ACTION', `${assignment.id} is already seated`);
    }
    seat.player = {
        id: assignment.id,
        name: assignment.name,
        stack: assignment.stack,
        status: assignment.stack > 0 ? 'ACTIVE' : 'SITTING_OUT',
        holeCards: [],
        betThisRound: 0,
        totalCommitted: 0,
        hasActed: false,
        revealed: false,
    };
}
/**
 * Deals a new hand: `WAITING` -> `PREFLOP`.
 *
 * The blinds are *not* posted automatically — the state comes back with
 * `pendingBlinds` queued, and the only legal action until they are cleared is
 * `POST_BLIND` from the player at the head of that queue.
 */
function startHand(state, options = {}) {
    if (state.street !== 'WAITING') {
        throw new types_1.PokerError('WRONG_STREET', `Cannot start a hand from ${state.street}; finish the current hand first`);
    }
    const next = clone(state);
    next.handId = state.handId + 1;
    next.street = 'PREFLOP';
    next.board = [];
    next.burned = [];
    next.pots = [];
    next.history = [];
    next.result = null;
    next.currentBet = 0;
    next.minRaise = next.bigBlind;
    next.lastAggressorIndex = null;
    for (const seat of next.seats) {
        const player = seat.player;
        if (!player)
            continue;
        player.holeCards = [];
        player.betThisRound = 0;
        player.totalCommitted = 0;
        player.hasActed = false;
        player.revealed = false;
        player.status =
            player.status === 'SITTING_OUT' || player.stack <= 0 ? 'SITTING_OUT' : 'ACTIVE';
    }
    const dealtIn = next.seats.filter((s) => s.player?.status === 'ACTIVE');
    if (dealtIn.length < 2) {
        throw new types_1.PokerError('NOT_ENOUGH_PLAYERS', `Need at least 2 players with chips, have ${dealtIn.length}`);
    }
    // Normalise the button onto an occupied, dealt-in seat.
    let button = options.buttonIndex ?? next.buttonIndex;
    if (next.seats[button]?.player?.status !== 'ACTIVE') {
        button = nextSeatWhere(next, button, (p) => p.status === 'ACTIVE') ?? button;
    }
    next.buttonIndex = button;
    const handSeed = options.seed !== undefined && options.seed !== null
        ? String(options.seed)
        : next.rng.seed !== null
            ? `${next.rng.seed}#${next.handId}`
            : null;
    next.rng.handSeed = handSeed;
    next.deck = options.deck ? options.deck.slice() : (0, deck_1.shuffle)((0, deck_1.createDeck)(), handSeed);
    // Heads-up: the button posts the small blind. Otherwise blinds sit to the
    // left of the button as usual.
    const smallBlindIndex = dealtIn.length === 2
        ? button
        : nextSeatWhere(next, button, (p) => p.status === 'ACTIVE');
    const bigBlindIndex = nextSeatWhere(next, smallBlindIndex, (p) => p.status === 'ACTIVE');
    // Two cards each, one at a time, starting to the left of the button.
    for (let round = 0; round < 2; round += 1) {
        let seatIndex = button;
        for (let dealt = 0; dealt < dealtIn.length; dealt += 1) {
            seatIndex = nextSeatWhere(next, seatIndex, (p) => p.status === 'ACTIVE');
            const card = next.deck.shift();
            if (!card)
                throw new types_1.PokerError('INVALID_CARDS', 'Deck exhausted while dealing');
            next.seats[seatIndex].player.holeCards.push(card);
        }
    }
    next.pendingBlinds = [
        blindFor(next, smallBlindIndex, 'SMALL', next.smallBlind),
        blindFor(next, bigBlindIndex, 'BIG', next.bigBlind),
    ];
    next.actingIndex = smallBlindIndex;
    next.history.push({ street: 'PREFLOP', playerId: null, type: 'DEAL' });
    return next;
}
function blindFor(state, seatIndex, kind, amount) {
    const player = state.seats[seatIndex].player;
    return { seatIndex, playerId: player.id, kind, amount: Math.min(amount, player.stack) };
}
/**
 * The single reducer. Validates `action` against `state` and returns the next
 * state. Throws `PokerError` on anything illegal. Never mutates `state`.
 */
function applyAction(state, action) {
    const next = clone(state);
    if (action.type === 'POST_BLIND') {
        postBlind(next, action);
        return next;
    }
    const { seatIndex, player } = requireTurn(next, action.playerId);
    switch (action.type) {
        case 'FOLD':
            player.status = 'FOLDED';
            player.hasActed = true;
            record(next, player.id, 'FOLD');
            break;
        case 'CHECK': {
            if (player.betThisRound !== next.currentBet) {
                throw new types_1.PokerError('ILLEGAL_ACTION', `Cannot check facing a bet of ${next.currentBet}`);
            }
            player.hasActed = true;
            record(next, player.id, 'CHECK');
            break;
        }
        case 'CALL': {
            const toCall = next.currentBet - player.betThisRound;
            if (toCall <= 0) {
                throw new types_1.PokerError('ILLEGAL_ACTION', 'Nothing to call — check instead');
            }
            const amount = Math.min(toCall, player.stack);
            commit(player, amount);
            player.hasActed = true;
            record(next, player.id, 'CALL', amount);
            break;
        }
        case 'BET': {
            if (next.currentBet > 0) {
                throw new types_1.PokerError('ILLEGAL_ACTION', 'Facing a bet — raise instead');
            }
            const to = requireAmount(action);
            const maxTo = player.betThisRound + player.stack;
            if (to > maxTo) {
                throw new types_1.PokerError('INSUFFICIENT_CHIPS', `Cannot bet ${to}, stack is ${player.stack}`);
            }
            const isAllIn = to === maxTo;
            if (to < next.bigBlind && !isAllIn) {
                throw new types_1.PokerError('BELOW_MIN_BET', `Minimum opening bet is ${next.bigBlind}, got ${to}`);
            }
            commit(player, to - player.betThisRound);
            player.hasActed = true;
            applyAggression(next, seatIndex, to, to >= next.bigBlind);
            record(next, player.id, 'BET', to);
            break;
        }
        case 'RAISE': {
            if (next.currentBet === 0) {
                throw new types_1.PokerError('ILLEGAL_ACTION', 'Nothing to raise — bet instead');
            }
            if (player.hasActed) {
                throw new types_1.PokerError('BETTING_NOT_REOPENED', 'Betting was not reopened for you — you may only call or fold');
            }
            const to = requireAmount(action);
            const maxTo = player.betThisRound + player.stack;
            if (to > maxTo) {
                throw new types_1.PokerError('INSUFFICIENT_CHIPS', `Cannot raise to ${to}, max is ${maxTo}`);
            }
            if (to <= next.currentBet) {
                throw new types_1.PokerError('INVALID_AMOUNT', `Raise must exceed the current bet of ${next.currentBet}`);
            }
            const minTo = next.currentBet + next.minRaise;
            const isAllIn = to === maxTo;
            if (to < minTo && !isAllIn) {
                throw new types_1.PokerError('BELOW_MIN_RAISE', `Minimum raise is to ${minTo}, got ${to}`);
            }
            commit(player, to - player.betThisRound);
            player.hasActed = true;
            applyAggression(next, seatIndex, to, to >= minTo);
            record(next, player.id, 'RAISE', to);
            break;
        }
        case 'ALL_IN': {
            if (player.stack <= 0) {
                throw new types_1.PokerError('INSUFFICIENT_CHIPS', 'No chips left to push');
            }
            const to = player.betThisRound + player.stack;
            commit(player, player.stack);
            player.hasActed = true;
            if (to > next.currentBet) {
                const minTo = next.currentBet === 0 ? next.bigBlind : next.currentBet + next.minRaise;
                applyAggression(next, seatIndex, to, to >= minTo);
            }
            record(next, player.id, 'ALL_IN', to);
            break;
        }
        default: {
            const exhaustive = action.type;
            throw new types_1.PokerError('ILLEGAL_ACTION', `Unknown action ${String(exhaustive)}`);
        }
    }
    advance(next, seatIndex);
    return next;
}
/**
 * `SHOWDOWN` -> `PAYOUT`. Moves the awarded chips into the winners' stacks.
 * Split out so a caller can render the reveal before the pot slides across.
 */
function settle(state) {
    if (state.street !== 'SHOWDOWN') {
        throw new types_1.PokerError('WRONG_STREET', `settle() requires SHOWDOWN, got ${state.street}`);
    }
    const next = clone(state);
    creditPayouts(next);
    next.street = 'PAYOUT';
    next.history.push({ street: 'PAYOUT', playerId: null, type: 'PAYOUT' });
    return next;
}
/**
 * `PAYOUT` -> `WAITING`. Clears the hand, moves the button, and sits out
 * anyone who busted.
 */
function endHand(state) {
    if (state.street !== 'PAYOUT') {
        throw new types_1.PokerError('WRONG_STREET', `endHand() requires PAYOUT, got ${state.street}`);
    }
    const next = clone(state);
    next.street = 'WAITING';
    next.actingIndex = null;
    next.board = [];
    next.deck = [];
    next.burned = [];
    next.pendingBlinds = [];
    next.currentBet = 0;
    next.minRaise = next.bigBlind;
    next.lastAggressorIndex = null;
    for (const seat of next.seats) {
        const player = seat.player;
        if (!player)
            continue;
        player.holeCards = [];
        player.betThisRound = 0;
        player.totalCommitted = 0;
        player.hasActed = false;
        player.revealed = false;
        player.status = player.stack > 0 ? 'ACTIVE' : 'SITTING_OUT';
    }
    const nextButton = nextSeatWhere(next, next.buttonIndex, (p) => p.status === 'ACTIVE');
    if (nextButton !== null)
        next.buttonIndex = nextButton;
    return next;
}
// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------
function postBlind(state, action) {
    const pending = state.pendingBlinds[0];
    if (!pending) {
        throw new types_1.PokerError('ILLEGAL_ACTION', 'No blind is due');
    }
    if (pending.playerId !== action.playerId) {
        throw new types_1.PokerError('NOT_YOUR_TURN', `${pending.playerId} owes the ${pending.kind.toLowerCase()} blind, not ${action.playerId}`);
    }
    const player = state.seats[pending.seatIndex].player;
    const amount = Math.min(pending.amount, player.stack);
    if (action.amount !== undefined && action.amount !== amount) {
        throw new types_1.PokerError('INVALID_AMOUNT', `Blind is ${amount}, got ${action.amount}`);
    }
    commit(player, amount);
    // A blind is forced, not an action: the big blind keeps the option to raise
    // when the action comes back around, so `hasActed` stays false.
    state.currentBet = Math.max(state.currentBet, player.betThisRound);
    state.pendingBlinds.shift();
    record(state, player.id, 'POST_BLIND', amount);
    if (state.pendingBlinds.length > 0) {
        state.actingIndex = state.pendingBlinds[0].seatIndex;
        return;
    }
    advance(state, pending.seatIndex);
}
function requireTurn(state, playerId) {
    if (!BETTING_STREETS.includes(state.street)) {
        throw new types_1.PokerError('WRONG_STREET', `No betting is open on ${state.street}`);
    }
    if (state.pendingBlinds.length > 0) {
        throw new types_1.PokerError('BLIND_REQUIRED', `${state.pendingBlinds[0].playerId} must post the blind first`);
    }
    if (state.actingIndex === null) {
        throw new types_1.PokerError('ILLEGAL_ACTION', 'Nobody is to act');
    }
    const player = state.seats[state.actingIndex]?.player;
    if (!player) {
        throw new types_1.PokerError('ILLEGAL_ACTION', 'Nobody is to act');
    }
    if (player.id !== playerId) {
        throw new types_1.PokerError('NOT_YOUR_TURN', `It is ${player.id}'s turn, not ${playerId}'s`);
    }
    if (player.status !== 'ACTIVE') {
        throw new types_1.PokerError('PLAYER_CANNOT_ACT', `${playerId} is ${player.status}`);
    }
    return { seatIndex: state.actingIndex, player };
}
function requireAmount(action) {
    const amount = action.amount;
    if (amount === undefined || !Number.isInteger(amount) || amount <= 0) {
        throw new types_1.PokerError('INVALID_AMOUNT', `${action.type} needs a positive whole "to" amount, got ${String(amount)}`);
    }
    return amount;
}
function commit(player, amount) {
    if (amount < 0 || amount > player.stack) {
        throw new types_1.PokerError('INSUFFICIENT_CHIPS', `Cannot commit ${amount}, stack is ${player.stack}`);
    }
    player.stack -= amount;
    player.betThisRound += amount;
    player.totalCommitted += amount;
    if (player.stack === 0)
        player.status = 'ALL_IN';
}
/**
 * Records a bet/raise. `reopens` is false for an all-in that falls short of a
 * full raise: the amount to call still goes up, but players who have already
 * acted keep `hasActed`, so they can only call or fold — the betting is not
 * reopened for them.
 */
function applyAggression(state, seatIndex, to, reopens) {
    const increment = to - state.currentBet;
    state.currentBet = to;
    if (!reopens)
        return;
    state.minRaise = increment;
    state.lastAggressorIndex = seatIndex;
    for (const seat of state.seats) {
        if (seat.index === seatIndex)
            continue;
        if (seat.player?.status === 'ACTIVE')
            seat.player.hasActed = false;
    }
}
function record(state, playerId, type, amount) {
    state.history.push({ street: state.street, playerId, type, amount });
}
// ---------------------------------------------------------------------------
// Round / street progression
// ---------------------------------------------------------------------------
function advance(state, fromIndex) {
    if (contenders(state).length <= 1) {
        endWithoutShowdown(state);
        return;
    }
    const nextIndex = nextToAct(state, fromIndex);
    if (nextIndex !== null) {
        state.actingIndex = nextIndex;
        return;
    }
    closeBettingRound(state);
    runOut(state);
}
/**
 * The round is over once every player who can still act has acted since the
 * last full raise *and* matched the current bet — which is exactly the
 * condition under which nobody is left to act.
 */
function nextToAct(state, fromIndex) {
    const count = state.seats.length;
    for (let step = 1; step <= count; step += 1) {
        const seat = state.seats[(fromIndex + step) % count];
        const player = seat.player;
        if (!player || player.status !== 'ACTIVE')
            continue;
        if (!player.hasActed || player.betThisRound < state.currentBet)
            return seat.index;
    }
    return null;
}
function closeBettingRound(state) {
    returnUncalledBet(state);
    for (const seat of state.seats) {
        if (!seat.player)
            continue;
        seat.player.betThisRound = 0;
        seat.player.hasActed = false;
    }
    state.currentBet = 0;
    state.minRaise = state.bigBlind;
    state.lastAggressorIndex = null;
    state.pots = (0, pot_1.buildPots)(players(state));
}
/**
 * Hands back the slice of a bet nobody could cover. Without this the chips
 * would sit in a pot only their owner is eligible for.
 */
function returnUncalledBet(state) {
    let top = null;
    let topBet = 0;
    let secondBet = 0;
    for (const seat of state.seats) {
        const player = seat.player;
        if (!player || player.betThisRound <= 0)
            continue;
        if (player.betThisRound > topBet) {
            secondBet = topBet;
            topBet = player.betThisRound;
            top = player;
        }
        else if (player.betThisRound > secondBet) {
            secondBet = player.betThisRound;
        }
    }
    if (!top || topBet <= secondBet)
        return;
    const refund = topBet - secondBet;
    top.stack += refund;
    top.betThisRound -= refund;
    top.totalCommitted -= refund;
    if (top.status === 'ALL_IN' && top.stack > 0)
        top.status = 'ACTIVE';
}
/** Deals whatever streets are left and stops at the next betting decision. */
function runOut(state) {
    for (;;) {
        if (contenders(state).length <= 1) {
            endWithoutShowdown(state);
            return;
        }
        if (state.street === 'RIVER') {
            goToShowdown(state);
            return;
        }
        dealNextStreet(state);
        const canAct = players(state).filter((p) => p.status === 'ACTIVE').length;
        if (canAct >= 2) {
            const first = nextToAct(state, state.buttonIndex);
            if (first !== null) {
                state.actingIndex = first;
                return;
            }
        }
        // Everyone left is all-in (or only one player can act): keep dealing.
    }
}
function dealNextStreet(state) {
    const draw = () => {
        const card = state.deck.shift();
        if (!card)
            throw new types_1.PokerError('INVALID_CARDS', 'Deck exhausted');
        return card;
    };
    switch (state.street) {
        case 'PREFLOP':
            state.street = 'FLOP';
            state.burned.push(draw());
            state.board.push(draw(), draw(), draw());
            break;
        case 'FLOP':
            state.street = 'TURN';
            state.burned.push(draw());
            state.board.push(draw());
            break;
        case 'TURN':
            state.street = 'RIVER';
            state.burned.push(draw());
            state.board.push(draw());
            break;
        default:
            throw new types_1.PokerError('WRONG_STREET', `Cannot deal past ${state.street}`);
    }
    state.actingIndex = null;
    record(state, null, 'STREET');
}
// ---------------------------------------------------------------------------
// Hand resolution
// ---------------------------------------------------------------------------
function endWithoutShowdown(state) {
    returnUncalledBet(state);
    for (const seat of state.seats) {
        if (seat.player)
            seat.player.betThisRound = 0;
    }
    state.currentBet = 0;
    state.minRaise = state.bigBlind;
    state.lastAggressorIndex = null;
    state.pots = (0, pot_1.buildPots)(players(state));
    const awards = (0, pot_1.awardPots)(state.pots, new Map(), oddChipOrder(state));
    state.result = {
        handId: state.handId,
        wentToShowdown: false,
        pots: awards,
        payouts: (0, pot_1.payoutsFromAwards)(awards),
        showdown: null,
    };
    state.actingIndex = null;
    state.street = 'PAYOUT';
    creditPayouts(state);
    record(state, null, 'PAYOUT');
}
function goToShowdown(state) {
    state.street = 'SHOWDOWN';
    state.actingIndex = null;
    const strengths = new Map();
    const entries = [];
    for (const player of contenders(state)) {
        player.revealed = true;
        const hand = (0, evaluator_1.evaluate7)([...player.holeCards, ...state.board]);
        strengths.set(player.id, hand);
        entries.push({
            playerId: player.id,
            holeCards: player.holeCards.map((c) => ({ ...c })),
            hand,
        });
    }
    state.pots = (0, pot_1.buildPots)(players(state));
    const awards = (0, pot_1.awardPots)(state.pots, strengths, oddChipOrder(state));
    state.result = {
        handId: state.handId,
        wentToShowdown: true,
        pots: awards,
        payouts: (0, pot_1.payoutsFromAwards)(awards),
        showdown: entries,
    };
    record(state, null, 'SHOWDOWN');
}
function creditPayouts(state) {
    const payouts = state.result?.payouts;
    if (!payouts)
        return;
    for (const seat of state.seats) {
        const player = seat.player;
        if (!player)
            continue;
        const won = payouts[player.id];
        if (won)
            player.stack += won;
    }
}
/** Player ids clockwise from the first seat left of the button. */
function oddChipOrder(state) {
    const order = [];
    const count = state.seats.length;
    for (let step = 1; step <= count; step += 1) {
        const seat = state.seats[(state.buttonIndex + step) % count];
        if (seat.player)
            order.push(seat.player.id);
    }
    return order;
}
// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
/** What `playerId` may legally do right now, or null if it is not their turn. */
function getLegalActions(state, playerId) {
    const empty = {
        playerId,
        canFold: false,
        canCheck: false,
        canCall: false,
        callAmount: 0,
        canBet: false,
        minBet: 0,
        canRaise: false,
        minRaiseTo: 0,
        maxRaiseTo: 0,
        canAllIn: false,
        allInTo: 0,
        canPostBlind: false,
        blindAmount: 0,
    };
    const pending = state.pendingBlinds[0];
    if (pending) {
        if (pending.playerId !== playerId)
            return null;
        const player = state.seats[pending.seatIndex].player;
        return { ...empty, canPostBlind: true, blindAmount: Math.min(pending.amount, player.stack) };
    }
    if (!BETTING_STREETS.includes(state.street) || state.actingIndex === null)
        return null;
    const player = state.seats[state.actingIndex]?.player;
    if (!player || player.id !== playerId || player.status !== 'ACTIVE')
        return null;
    const toCall = state.currentBet - player.betThisRound;
    const maxRaiseTo = player.betThisRound + player.stack;
    return {
        playerId,
        canFold: true,
        canCheck: toCall === 0,
        canCall: toCall > 0 && player.stack > 0,
        callAmount: Math.min(Math.max(toCall, 0), player.stack),
        canBet: state.currentBet === 0 && player.stack > 0,
        minBet: Math.min(state.bigBlind, maxRaiseTo),
        canRaise: state.currentBet > 0 &&
            !player.hasActed &&
            player.stack > 0 &&
            maxRaiseTo > state.currentBet,
        minRaiseTo: Math.min(state.currentBet + state.minRaise, maxRaiseTo),
        maxRaiseTo,
        canAllIn: player.stack > 0,
        allInTo: maxRaiseTo,
        canPostBlind: false,
        blindAmount: 0,
    };
}
/** Chips in collected pots plus chips wagered in the current, open round. */
function totalPot(state) {
    const live = players(state).reduce((sum, p) => sum + p.betThisRound, 0);
    return (0, pot_1.potTotal)(state.pots) + live;
}
// ---------------------------------------------------------------------------
// Public projection — the only thing a client may ever receive
// ---------------------------------------------------------------------------
/**
 * Projects `state` down to what `viewerId` is allowed to see.
 *
 * The deck, the burn pile and the RNG seed are dropped entirely. Hole cards
 * are returned for the viewer only, plus any opponent who was revealed at
 * showdown. Everyone else's cards come back as null.
 *
 * This is built field by field on purpose — never spread `TableState` here,
 * or a future secret field leaks to the client by default.
 */
function toPublicState(state, viewerId) {
    const showdownReached = state.street === 'SHOWDOWN' || state.street === 'PAYOUT';
    const seats = state.seats.map((seat) => {
        const player = seat.player;
        if (!player)
            return { index: seat.index, player: null };
        const isViewer = player.id === viewerId;
        const visible = isViewer || (showdownReached && player.revealed && player.status !== 'FOLDED');
        return {
            index: seat.index,
            player: {
                id: player.id,
                name: player.name,
                seatIndex: seat.index,
                stack: player.stack,
                status: player.status,
                betThisRound: player.betThisRound,
                totalCommitted: player.totalCommitted,
                hasCards: player.holeCards.length > 0,
                holeCards: visible ? player.holeCards.map((c) => ({ ...c })) : null,
                isViewer,
            },
        };
    });
    const actingPlayer = state.actingIndex === null ? null : (state.seats[state.actingIndex]?.player ?? null);
    return {
        tableId: state.tableId,
        handId: state.handId,
        street: state.street,
        buttonIndex: state.buttonIndex,
        smallBlind: state.smallBlind,
        bigBlind: state.bigBlind,
        board: state.board.map((c) => ({ ...c })),
        seats,
        actingIndex: state.actingIndex,
        actingPlayerId: actingPlayer?.id ?? null,
        currentBet: state.currentBet,
        minRaise: state.minRaise,
        pots: state.pots.map((pot) => ({
            amount: pot.amount,
            eligiblePlayerIds: pot.eligiblePlayerIds.slice(),
        })),
        totalPot: totalPot(state),
        history: state.history.map((event) => ({ ...event })),
        result: state.result ? structuredClone(state.result) : null,
        viewerId,
        legalActions: getLegalActions(state, viewerId),
    };
}
// ---------------------------------------------------------------------------
// Small internals
// ---------------------------------------------------------------------------
function clone(state) {
    return structuredClone(state);
}
function players(state) {
    return state.seats.map((s) => s.player).filter((p) => p !== null);
}
/** Players still in the hand: not folded, not sitting out. */
function contenders(state) {
    return players(state).filter((p) => p.status === 'ACTIVE' || p.status === 'ALL_IN');
}
function findSeatOf(state, playerId) {
    return state.seats.find((s) => s.player?.id === playerId);
}
function nextSeatWhere(state, fromIndex, predicate) {
    const count = state.seats.length;
    for (let step = 1; step <= count; step += 1) {
        const seat = state.seats[(fromIndex + step) % count];
        if (seat.player && predicate(seat.player))
            return seat.index;
    }
    return null;
}
//# sourceMappingURL=engine.js.map