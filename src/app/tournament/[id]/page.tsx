"use client";

import { use, useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadMuted, makeSounds, saveMuted } from "../../table/_shared/sounds";
import {
  ActionButton, AnimatedAmount, Card, CommunitySlot, FlashBanner, PotDisplay, WinBurst,
} from "../../table/_shared/ui";
import type { CardData, FlyFrom, Suit } from "../../table/_shared/ui";
import { OpponentSeat } from "../../table/_shared/seat";
import { OVAL_DESKTOP, OVAL_MOBILE, SCENE_H, SCENE_W, useFitScale, useIsMobile } from "../../table/_shared/useFitScale";

// ─── Types ────────────────────────────────────────────────────────────────────

type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
type Action = "waiting" | "fold" | "call" | "check" | "raise" | "bet" | "allin";

interface TPlayer {
  id: number; name: string; avatar: string;
  chips: number; cards: CardData[];
  folded: boolean; eliminated: boolean; finishPos: number | null;
  streetBet: number; totalBet: number;
  action: Action; isHero: boolean;
  isDealer: boolean; isSB: boolean; isBB: boolean; isAllIn: boolean;
}

interface SidePot { amount: number; eligibleIds: number[]; }

interface TGame {
  deck: CardData[];
  players: TPlayer[];
  community: (CardData | null)[];
  pot: number; sidePots: SidePot[];
  street: Street;
  currentBet: number; lastRaiseBy: number;
  actionQueue: number[]; activeIdx: number | null;
  phaseDelay: boolean;
  winnerId: number | null; winnerIds: number[];
  banner: string;
  handNum: number; dealerIdx: number;
  blinds: { sb: number; bb: number };
  numSeats: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const BLIND_LEVELS = [
  { sb: 1,  bb: 2   },
  { sb: 2,  bb: 4   },
  { sb: 4,  bb: 8   },
  { sb: 8,  bb: 16  },
  { sb: 25, bb: 50  },
  { sb: 50, bb: 100 },
];
const LEVEL_DURATION = 120;

const CONFIGS: Record<string, { numSeats: number; prizePool: number; name: string }> = {
  "1": { numSeats: 4, prizePool: 200, name: "4-Player Sit & Go" },
  "2": { numSeats: 6, prizePool: 300, name: "6-Player Sit & Go" },
  "3": { numSeats: 9, prizePool: 450, name: "9-Player Sit & Go" },
};

const BOT_NAMES   = ["Bot_Shark","Bot_Lucky","Bot_King","Bot_Ace","Bot_Fox","Bot_Bear","Bot_Wolf","Bot_Eagle"];
const BOT_AVATARS = ["🦈","🍀","👑","♠️","🦊","🐻","🐺","🦅"];

// Seat positions per opponent count (3, 5, or 8)
const SEAT_POS: Record<number, React.CSSProperties[]> = {
  3: [
    { right: 100, top: 28 },
    { left: "50%", top: 10, transform: "translateX(-50%)" },
    { left: 100, top: 28 },
  ],
  5: [
    { right: 55, bottom: 38 },
    { right: 20, top: "48%", transform: "translateY(-50%)" },
    { right: 88, top: 18 },
    { left: 88, top: 18 },
    { left: 55, bottom: 38 },
  ],
  8: [
    { right: 52, bottom: 38 },
    { right: 16, top: "52%", transform: "translateY(-50%)" },
    { right: 80, top: 18 },
    { right: "50%", top: 10, transform: "translateX(108px)" },
    { left: "50%",  top: 10, transform: "translateX(-108px)" },
    { left: 80, top: 18 },
    { left: 16, top: "52%", transform: "translateY(-50%)" },
    { left: 52, bottom: 38 },
  ],
};

// ─── Hand Evaluation ──────────────────────────────────────────────────────────

const RANK_VALUE: Record<string, number> = {
  "2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,
  "10":10,"J":11,"Q":12,"K":13,"A":14,
};
const RANK_NAME: Record<number, string> = {
  14:"Ace",13:"King",12:"Queen",11:"Jack",10:"Ten",
  9:"Nine",8:"Eight",7:"Seven",6:"Six",5:"Five",4:"Four",3:"Three",2:"Two",
};
const SUITS: Suit[] = ["♠","♥","♦","♣"];
const VALUES = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

interface HandResult { rank: number; name: string; tiebreakers: number[]; description: string; }

function combs<T>(arr: T[], k: number): T[][] {
  if (k===0) return [[]];
  if (arr.length<k) return [];
  const [h,...t]=arr;
  return [...combs(t,k-1).map(c=>[h,...c]),...combs(t,k)];
}

function evalFive(cards: CardData[]): HandResult {
  const rv=cards.map(c=>RANK_VALUE[c.value]).sort((a,b)=>b-a);
  const suits=cards.map(c=>c.suit);
  const cnt:Record<number,number>={};
  for (const r of rv) cnt[r]=(cnt[r]||0)+1;
  const grp=Object.entries(cnt).map(([r,n])=>({r:+r,n})).sort((a,b)=>b.n-a.n||b.r-a.r);
  const flush=suits.every(s=>s===suits[0]);
  const uniq=[...new Set(rv)].sort((a,b)=>b-a);
  let str=false,sHi=0;
  if (uniq.length===5){
    if (uniq[0]-uniq[4]===4){str=true;sHi=uniq[0];}
    if (uniq[0]===14&&uniq[1]===5&&uniq[2]===4&&uniq[3]===3&&uniq[4]===2){str=true;sHi=5;}
  }
  const n=(r:number)=>RANK_NAME[r]??String(r);
  const ns=(r:number)=>n(r)+"s";
  if (flush&&str&&sHi===14) return {rank:9,name:"Royal Flush",   tiebreakers:[14],                     description:"Royal Flush"};
  if (flush&&str)            return {rank:8,name:"Straight Flush",tiebreakers:[sHi],                    description:`Straight Flush, ${n(sHi)}-high`};
  if (grp[0].n===4)          return {rank:7,name:"Four of a Kind",tiebreakers:[grp[0].r,grp[1]?.r??0], description:`Four of a Kind, ${ns(grp[0].r)}`};
  if (grp[0].n===3&&grp[1]?.n===2) return {rank:6,name:"Full House",tiebreakers:[grp[0].r,grp[1].r],  description:`Full House, ${ns(grp[0].r)} over ${ns(grp[1].r)}`};
  if (flush)                 return {rank:5,name:"Flush",         tiebreakers:rv,                       description:`Flush, ${n(rv[0])}-high`};
  if (str)                   return {rank:4,name:"Straight",      tiebreakers:[sHi],                    description:`Straight, ${n(sHi)}-high`};
  if (grp[0].n===3)          return {rank:3,name:"Three of a Kind",tiebreakers:[grp[0].r,...grp.slice(1).map(g=>g.r)],description:`Three of a Kind, ${ns(grp[0].r)}`};
  if (grp[0].n===2&&grp[1]?.n===2) return {rank:2,name:"Two Pair",tiebreakers:[grp[0].r,grp[1].r,grp[2]?.r??0],description:`Two Pair, ${ns(grp[0].r)} and ${ns(grp[1].r)}`};
  if (grp[0].n===2)          return {rank:1,name:"One Pair",      tiebreakers:[grp[0].r,...grp.slice(1).map(g=>g.r)],description:`Pair of ${ns(grp[0].r)}`};
  return                            {rank:0,name:"High Card",     tiebreakers:rv,                       description:`${n(rv[0])}-high`};
}

function cmpArr(a:number[],b:number[]):number {
  for (let i=0;i<Math.min(a.length,b.length);i++) if (a[i]!==b[i]) return a[i]-b[i];
  return 0;
}

function bestHand(hole: CardData[], community: (CardData|null)[]): HandResult {
  const board=community.filter((c):c is CardData=>c!==null);
  const all=[...hole,...board];
  if (all.length<5){const pad=[...all];while(pad.length<5)pad.push(all[0]??{value:"2",suit:"♠"});return evalFive(pad);}
  return combs(all,5).reduce((best,combo)=>{
    const h=evalFive(combo);
    return h.rank>best.rank||(h.rank===best.rank&&cmpArr(h.tiebreakers,best.tiebreakers)>0)?h:best;
  },evalFive(combs(all,5)[0]));
}

function pickWinner(alive: TPlayer[], community: (CardData|null)[]): {winnerId:number;best:HandResult} {
  let best:HandResult|null=null,winnerId=alive[0].id;
  for (const p of alive){
    const h=bestHand(p.cards,community);
    if (!best||h.rank>best.rank||(h.rank===best.rank&&cmpArr(h.tiebreakers,best.tiebreakers)>0)){best=h;winnerId=p.id;}
  }
  return {winnerId,best:best!};
}

// ─── Side Pots ─────────────────────────────────────────────────────────────────

function buildSidePots(players: TPlayer[]): SidePot[] {
  if (!players.some(p=>p.isAllIn&&!p.folded)) return [];
  const contribs=players.map(p=>({id:p.id,total:p.totalBet,folded:p.folded}));
  const levels=[...new Set(players.filter(p=>p.isAllIn&&!p.folded).map(p=>p.totalBet))].sort((a,b)=>a-b);
  const pots:SidePot[]=[];
  let prev=0;
  for (const level of levels){
    const amt=contribs.reduce((s,c)=>s+Math.max(0,Math.min(c.total,level)-prev),0);
    const eligible=contribs.filter(c=>!c.folded&&c.total>=level).map(c=>c.id);
    if (amt>0&&eligible.length>0) pots.push({amount:amt,eligibleIds:eligible});
    prev=level;
  }
  const remAmt=contribs.reduce((s,c)=>s+Math.max(0,c.total-prev),0);
  if (remAmt>0){
    const eligible=contribs.filter(c=>!c.folded&&c.total>prev).map(c=>c.id);
    if (eligible.length>0) pots.push({amount:remAmt,eligibleIds:eligible});
  }
  return pots;
}

// ─── Deck ─────────────────────────────────────────────────────────────────────

function makeDeck():CardData[]{const d:CardData[]=[];for(const s of SUITS)for(const v of VALUES)d.push({suit:s,value:v});return d;}
function shuffle(d:CardData[]):CardData[]{const a=[...d];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

// ─── Tournament Game Logic ─────────────────────────────────────────────────────

function nextActiveSeat(fromIdx: number, players: TPlayer[]): number {
  const N = players.length;
  let next = (fromIdx + 1) % N;
  let guard = 0;
  while (players[next].eliminated) { next = (next + 1) % N; if (++guard > N) break; }
  return next;
}

function makeTournamentPlayers(numSeats: number): TPlayer[] {
  return Array.from({ length: numSeats }, (_, i) => ({
    id: i, name: i === 0 ? "You" : BOT_NAMES[i - 1], avatar: i === 0 ? "😎" : BOT_AVATARS[i - 1],
    chips: 1000, cards: [], folded: false, eliminated: false, finishPos: null,
    streetBet: 0, totalBet: 0, action: "waiting" as Action,
    isHero: i === 0, isDealer: false, isSB: false, isBB: false, isAllIn: false,
  }));
}

function buildTournamentHand(
  handNum: number,
  prevPlayers: TPlayer[],
  prevDealerIdx: number,
  blinds: { sb: number; bb: number }
): TGame {
  const N = prevPlayers.length;

  // Detect and mark newly eliminated players
  const newlyElim = prevPlayers.filter(p => !p.eliminated && p.chips === 0);
  const alreadyElimCount = prevPlayers.filter(p => p.eliminated).length;

  const withElims: TPlayer[] = prevPlayers.map(p => {
    if (!p.eliminated && p.chips === 0) {
      const place = N - alreadyElimCount - (newlyElim.length - 1 - newlyElim.findIndex(e => e.id === p.id));
      return { ...p, eliminated: true, finishPos: Math.max(1, place) };
    }
    return p;
  });

  const dealerIdx = handNum === 1 ? 0 : nextActiveSeat(prevDealerIdx, withElims);
  const sbIdx = nextActiveSeat(dealerIdx, withElims);
  const bbIdx = nextActiveSeat(sbIdx, withElims);

  const deck = shuffle(makeDeck());
  let ci = 0;

  const players: TPlayer[] = withElims.map((p, i) => {
    if (p.eliminated) {
      return { ...p, cards: [], folded: true, isDealer: false, isSB: false, isBB: false,
        streetBet: 0, totalBet: 0, action: "waiting" as Action, isAllIn: false };
    }
    const isSB = i === sbIdx;
    const isBB = i === bbIdx;
    const sbAmt = isSB ? Math.min(blinds.sb, p.chips) : 0;
    const bbAmt = isBB ? Math.min(blinds.bb, p.chips) : 0;
    const posted = sbAmt + bbAmt;
    return {
      ...p, cards: [deck[ci++], deck[ci++]], folded: false,
      isDealer: i === dealerIdx, isSB, isBB,
      chips: p.chips - posted, streetBet: posted, totalBet: posted,
      action: "waiting" as Action, isAllIn: p.chips - posted === 0,
    };
  });

  const communityDeck = [deck[ci++], deck[ci++], deck[ci++], deck[ci++], deck[ci++]];
  const pot = players.reduce((s, p) => s + p.streetBet, 0);
  const currentBet = players[bbIdx]?.streetBet ?? blinds.bb;

  // Build preflop action queue
  const activeIdxs = players.map((p, i) => ({ p, i })).filter(({ p }) => !p.eliminated).map(({ i }) => i);
  const nActive = activeIdxs.length;
  const dealerActivePos = activeIdxs.indexOf(dealerIdx);
  const actionQueue: number[] = [];

  if (nActive === 2) {
    if (!players[dealerIdx].isAllIn) actionQueue.push(dealerIdx);
    if (!players[bbIdx].isAllIn) actionQueue.push(bbIdx);
  } else {
    for (let i = 3; i < nActive + 3; i++) {
      const seatIdx = activeIdxs[(dealerActivePos + i) % nActive];
      if (!players[seatIdx].isAllIn) actionQueue.push(seatIdx);
    }
  }

  return {
    deck: communityDeck, players,
    community: [null, null, null, null, null],
    pot, sidePots: [], street: "preflop",
    currentBet, lastRaiseBy: blinds.bb,
    actionQueue, activeIdx: actionQueue[0] ?? null,
    phaseDelay: false, winnerId: null, winnerIds: [], banner: "",
    handNum, dealerIdx, blinds, numSeats: N,
  };
}

function resolveShowdown(state: TGame): TGame {
  const { players, community, pot } = state;
  const alive = players.filter(p => !p.folded && !p.eliminated);

  if (alive.length === 1) {
    const w = alive[0];
    return {
      ...state,
      players: players.map(p => p.id === w.id ? { ...p, chips: p.chips + pot } : p),
      street: "showdown", activeIdx: null, actionQueue: [], phaseDelay: false,
      winnerId: w.id, winnerIds: [w.id], sidePots: [],
      banner: w.isHero ? `You win $${pot.toLocaleString()}! Opponents folded.` : `${w.name} wins $${pot.toLocaleString()}. You folded.`,
    };
  }

  const activePlayers = players.filter(p => !p.eliminated);
  const sidePots = buildSidePots(activePlayers);

  if (sidePots.length > 0) {
    let upd = players.map(p => ({ ...p }));
    const parts: string[] = [];
    const allWinnerIds: number[] = [];
    for (const sp of sidePots) {
      const potAlive = alive.filter(p => sp.eligibleIds.includes(p.id));
      if (!potAlive.length) continue;
      const { winnerId: wid, best } = pickWinner(potAlive, community);
      upd = upd.map(p => p.id === wid ? { ...p, chips: p.chips + sp.amount } : p);
      allWinnerIds.push(wid);
      const wp = players.find(p => p.id === wid)!;
      parts.push(`${wp.isHero ? "You win" : `${wp.name} wins`} $${sp.amount.toLocaleString()} — ${best.description}`);
    }
    const primary = allWinnerIds[allWinnerIds.length - 1] ?? alive[0].id;
    return {
      ...state, players: upd, street: "showdown", activeIdx: null, actionQueue: [], phaseDelay: false,
      winnerId: primary, winnerIds: [...new Set(allWinnerIds)], banner: parts.join(" · "), sidePots: [],
    };
  }

  const { winnerId, best } = pickWinner(alive, community);
  const w = players.find(p => p.id === winnerId)!;
  return {
    ...state,
    players: players.map(p => p.id === winnerId ? { ...p, chips: p.chips + pot } : p),
    street: "showdown", activeIdx: null, actionQueue: [], phaseDelay: false,
    winnerId, winnerIds: [winnerId], sidePots: [],
    banner: w.isHero ? `You win $${pot.toLocaleString()} with ${best.description}!` : `${w.name} wins $${pot.toLocaleString()} with ${best.description}!`,
  };
}

function advanceStreet(state: TGame): TGame {
  const N = state.numSeats;
  const { players, dealerIdx, street } = state;
  const next: Street = street === "preflop" ? "flop" : street === "flop" ? "turn" : street === "turn" ? "river" : "showdown";
  if (next === "showdown") return resolveShowdown(state);

  const reset = players.map(p => ({ ...p, streetBet: 0, action: "waiting" as Action }));
  const comm = [...state.community];
  if (next === "flop")  { comm[0] = state.deck[0]; comm[1] = state.deck[1]; comm[2] = state.deck[2]; }
  else if (next === "turn")  { comm[3] = state.deck[3]; }
  else if (next === "river") { comm[4] = state.deck[4]; }

  const canAct = reset.filter(p => !p.eliminated && !p.folded && !p.isAllIn);
  if (canAct.length <= 1) {
    const full: (CardData | null)[] = [...comm];
    if (!full[0]) { full[0] = state.deck[0]; full[1] = state.deck[1]; full[2] = state.deck[2]; }
    if (!full[3]) full[3] = state.deck[3];
    if (!full[4]) full[4] = state.deck[4];
    return resolveShowdown({ ...state, players: reset, community: full, street: "river", currentBet: 0, lastRaiseBy: state.blinds.bb, actionQueue: [], activeIdx: null, phaseDelay: false });
  }

  const actionQueue: number[] = [];
  for (let i = 1; i <= N; i++) {
    const idx = (dealerIdx + i) % N;
    if (!reset[idx].eliminated && !reset[idx].folded && !reset[idx].isAllIn) actionQueue.push(idx);
  }

  return { ...state, players: reset, community: comm, street: next, currentBet: 0, lastRaiseBy: state.blinds.bb, actionQueue, activeIdx: null, phaseDelay: true };
}

function processAction(
  prev: TGame, actorIdx: number,
  action: "fold" | "call" | "check" | "raise" | "bet",
  betToAmount?: number
): TGame {
  const N = prev.numSeats;
  const players = prev.players.map(p => ({ ...p }));
  const actor = players[actorIdx];
  let pot = prev.pot, currentBet = prev.currentBet, lastRaiseBy = prev.lastRaiseBy;
  let actionQueue = prev.actionQueue.filter(i => i !== actorIdx);

  if (action === "fold") {
    actor.folded = true; actor.action = "fold";
  } else if (action === "check") {
    actor.action = "check";
  } else if (action === "call") {
    const amt = Math.min(currentBet - actor.streetBet, actor.chips);
    actor.chips -= amt; actor.streetBet += amt; actor.totalBet += amt; pot += amt;
    actor.isAllIn = actor.chips === 0;
    actor.action = actor.chips === 0 ? "allin" : "call";
  } else if ((action === "raise" || action === "bet") && betToAmount !== undefined) {
    const add = Math.min(betToAmount - actor.streetBet, actor.chips);
    const newSB = actor.streetBet + add;
    pot += add; actor.chips -= add; actor.totalBet += add;
    lastRaiseBy = Math.max(1, newSB - currentBet);
    currentBet = newSB; actor.streetBet = newSB;
    actor.isAllIn = actor.chips === 0;
    actor.action = actor.chips === 0 ? "allin" : action === "bet" ? "bet" : "raise";
    actionQueue = [];
    for (let i = 1; i < N; i++) {
      const idx = (actorIdx + i) % N;
      if (!players[idx].eliminated && !players[idx].folded && !players[idx].isAllIn) actionQueue.push(idx);
    }
  }

  const alive = players.filter(p => !p.folded && !p.eliminated);
  if (alive.length === 1) return resolveShowdown({ ...prev, players, pot, currentBet, lastRaiseBy, actionQueue });

  const canStillAct = players.filter(p => !p.eliminated && !p.folded && !p.isAllIn);
  if (actionQueue.length === 0 || canStillAct.length === 0) {
    return advanceStreet({ ...prev, players, pot, currentBet, lastRaiseBy, actionQueue });
  }
  return { ...prev, players, pot, currentBet, lastRaiseBy, actionQueue, activeIdx: actionQueue[0] };
}

function processAIAction(state: TGame): TGame {
  const actorIdx = state.activeIdx!;
  const actor = state.players[actorIdx];
  const callAmt = state.currentBet - actor.streetBet;
  const { bb } = state.blinds;
  const r = Math.random();

  // Short stack shove
  if (actor.chips <= bb * 4 && actor.chips > 0) {
    if (r < 0.35) return processAction(state, actorIdx, "fold");
    const allIn = actor.chips + actor.streetBet;
    return processAction(state, actorIdx, state.currentBet === 0 ? "bet" : "raise", allIn);
  }
  if (callAmt >= actor.chips && callAmt > 0) {
    return r < 0.45 ? processAction(state, actorIdx, "fold") : processAction(state, actorIdx, "call");
  }
  if (r < 0.25 && callAmt > 0) return processAction(state, actorIdx, "fold");
  if (r < 0.80 || callAmt === 0) {
    return callAmt === 0 ? processAction(state, actorIdx, "check") : processAction(state, actorIdx, "call");
  }
  const raiseSize = Math.max(state.lastRaiseBy, Math.ceil(state.currentBet * 0.7) || bb);
  const raiseTo = Math.min(state.currentBet + raiseSize, actor.chips + actor.streetBet);
  if (raiseTo <= state.currentBet) return processAction(state, actorIdx, callAmt === 0 ? "check" : "call");
  return processAction(state, actorIdx, state.currentBet === 0 ? "bet" : "raise", raiseTo);
}

// ─── Deal geometry ────────────────────────────────────────────────────────────

// Cards converge on each seat from the middle of the felt. Seat layouts vary
// with the table size, so the origin is derived from which edge a seat sits on
// rather than hard-coded per position.
function flyFor(pos: React.CSSProperties): FlyFrom {
  const onRight = pos.right !== undefined;
  const onLeft  = pos.left  !== undefined && pos.left !== "50%";
  const onTop   = pos.top   !== undefined;
  return {
    x: onRight ? -250 : onLeft ? 250 : 0,
    y: onTop ? 130 : -165,
    r: onRight ? 20 : -20,
  };
}

// Milliseconds between consecutive cards leaving the dealer's hand.
const DEAL_STRIDE = 70;

// ─── Tournament Header ─────────────────────────────────────────────────────────

function TournamentHeader({
  prizePool, playersRemaining, totalPlayers, blindLevel, levelSecondsLeft, muted, onToggleMute,
}: {
  prizePool: number; playersRemaining: number; totalPlayers: number;
  blindLevel: number; levelSecondsLeft: number; muted: boolean; onToggleMute: () => void;
}) {
  const bl = BLIND_LEVELS[blindLevel];
  const mm = String(Math.floor(levelSecondsLeft / 60)).padStart(2, "0");
  const ss = String(levelSecondsLeft % 60).padStart(2, "0");
  return (
    <header className="shrink-0 flex items-center justify-between px-3 md:px-4 flex-wrap gap-y-1" style={{ minHeight: 44, background: "#0a1410", borderBottom: "1px solid #1a2d1e" }}>
      <div className="flex items-center gap-3 min-w-0">
        <Link href="/tournaments" className="text-sm transition-colors shrink-0" style={{ color: "#4b5563" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#e5e7eb")}
          onMouseLeave={e => (e.currentTarget.style.color = "#4b5563")}>
          ← Tournaments
        </Link>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="font-bold" style={{ color: "#f59e0b" }}>Prize ${prizePool.toLocaleString()}</span>
          <span style={{ color: "#374151" }}>|</span>
          <span style={{ color: "#d1d5db" }}>Players <span className="font-bold">{playersRemaining}/{totalPlayers}</span></span>
          <span style={{ color: "#374151" }}>|</span>
          <span style={{ color: "#d1d5db" }}>Level {blindLevel + 1}: <span className="font-bold text-emerald-400">${bl.sb}/${bl.bb}</span></span>
          <span style={{ color: "#374151" }}>|</span>
          <span style={{ color: blindLevel >= BLIND_LEVELS.length - 1 ? "#6b7280" : "#d1d5db" }}>
            Next: <span className="font-mono font-bold">{blindLevel >= BLIND_LEVELS.length - 1 ? "MAX" : `${mm}:${ss}`}</span>
          </span>
        </div>
      </div>
      <button onClick={onToggleMute} className="px-2 py-1 rounded transition-colors shrink-0"
        style={{ background: "#1a2d1e", color: muted ? "#4b5563" : "#34d399", fontSize: 14, border: "1px solid #2d4a3a" }}
        title={muted ? "Unmute" : "Mute"}>
        {muted ? "🔇" : "🔊"}
      </button>
    </header>
  );
}

// ─── Result Overlay ────────────────────────────────────────────────────────────

function ResultOverlay({
  phase, place, prize, onReturn,
}: {
  phase: "won" | "lost"; place: number; prize: number; onReturn: () => void;
}) {
  const isWin = phase === "won";
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 100, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}>
      <div className="text-center rounded-2xl p-8 mx-4 max-w-sm w-full" style={{ background: isWin ? "linear-gradient(135deg,#064e3b,#065f46)" : "linear-gradient(135deg,#450a0a,#7f1d1d)", border: `1px solid ${isWin ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)"}`, boxShadow: `0 20px 60px ${isWin ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.2)"}` }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>{isWin ? "🏆" : "💀"}</div>
        <h2 className="font-black text-2xl mb-2" style={{ color: isWin ? "#10b981" : "#ef4444" }}>
          {isWin ? "You Win!" : "Eliminated!"}
        </h2>
        <p className="text-white font-bold text-lg mb-1">
          {isWin ? `Prize: $${prize.toLocaleString()}` : `You finished ${place}${ordinal(place)} place`}
        </p>
        {isWin && <p className="text-emerald-300 text-sm mb-6">Added to your balance</p>}
        {!isWin && <p className="text-zinc-400 text-sm mb-6">Better luck next time!</p>}
        <button onClick={onReturn}
          className="font-black rounded-xl px-8 py-3 w-full transition-all"
          style={{ background: isWin ? "#10b981" : "#374151", color: "white" }}
          onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>
          Back to Tournaments
        </button>
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return (s[(v - 20) % 10] || s[v] || s[0]);
}

// ─── Main Tournament Component ─────────────────────────────────────────────────

function TournamentContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const config = CONFIGS[id] ?? CONFIGS["1"];
  const { numSeats, prizePool, name } = config;

  // The deck is shuffled with Math.random() in a state initialiser, so the
  // server HTML can never match the client's first render. Hold the table back
  // until after mount and render a matching placeholder on both sides.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The felt is scaled to the measured height of the area left between the
  // header and the action bar, so nothing can be clipped at any viewport.
  const isMobile = useIsMobile();
  const { ref: tableAreaRef, scale: tableScale } = useFitScale(isMobile ? OVAL_MOBILE : OVAL_DESKTOP);

  // Mute is loaded after mount — localStorage does not exist during SSR — and
  // shares its key with the cash tables, so muting once mutes everywhere.
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { setMuted(loadMuted()); }, []);
  const sounds = useRef(makeSounds(mutedRef));

  const toggleMute = useCallback(() => {
    setMuted(m => { saveMuted(!m); return !m; });
    sounds.current.unlock();
  }, []);

  const [game, setGame] = useState<TGame>(() =>
    buildTournamentHand(1, makeTournamentPlayers(numSeats), -1, BLIND_LEVELS[0])
  );
  const [raiseAmt, setRaiseAmt] = useState(4);
  const [timeLeft, setTimeLeft] = useState(30);
  const [blindLevel, setBlindLevel] = useState(0);
  const [levelSeconds, setLevelSeconds] = useState(0);
  const [levelFlash, setLevelFlash] = useState<string | null>(null);
  const [tournamentStatus, setTournamentStatus] = useState<{ phase: "won" | "lost"; place: number; prize: number } | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const foldRef = useRef<() => void>(() => {});
  const heroAwayRef = useRef(false);

  const hero = game.players[0];
  const opponents = game.players.slice(1);
  const isShowdown = game.street === "showdown";
  const isHeroTurn = game.activeIdx === 0 && !game.phaseDelay && !isShowdown && !hero.folded && !hero.isAllIn && !hero.eliminated;
  const isHeroWinner = game.winnerIds.includes(0);
  const callAmt = Math.min(game.currentBet - hero.streetBet, hero.chips);
  const isBetCtx = game.currentBet === 0 || game.currentBet === hero.streetBet;
  const betRaiseMin = game.currentBet === 0 ? game.blinds.bb : game.currentBet + game.lastRaiseBy;
  const betRaiseMax = Math.max(betRaiseMin, hero.chips + hero.streetBet);
  const playersRemaining = game.players.filter(p => !p.eliminated).length;
  const seatPositions = SEAT_POS[numSeats - 1] ?? SEAT_POS[3];

  // Sync raiseAmt
  useEffect(() => {
    setRaiseAmt(prev => Math.max(betRaiseMin, Math.min(prev, betRaiseMax)));
  }, [game.street, game.handNum, game.currentBet, betRaiseMin, betRaiseMax]);

  // One swoosh per card, on the same clock as the deal animation so each sound
  // lands with its card. Cleared on unmount so a fast next hand cannot stack
  // two hands' worth of deal sounds.
  useEffect(() => {
    const live = game.players.filter(p => !p.eliminated).length;
    const ids = Array.from({ length: live * 2 }, (_, i) =>
      setTimeout(() => sounds.current.deal(), i * DEAL_STRIDE + 40));
    return () => ids.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.handNum]);

  // Win + street sounds
  const prevStreet = useRef<Street>("preflop");
  useEffect(() => {
    if (game.street !== prevStreet.current) {
      prevStreet.current = game.street;
      // Board card hitting the felt — bigger, wider whoosh than a hole card.
      if (game.street === "flop" || game.street === "turn" || game.street === "river") {
        sounds.current.reveal();
      }
      if (game.street === "showdown" && isHeroWinner) sounds.current.win();
    }
  });

  // Phase delay
  useEffect(() => {
    if (!game.phaseDelay) return;
    const id = setTimeout(() => {
      setGame(prev => !prev.phaseDelay ? prev : { ...prev, phaseDelay: false, activeIdx: prev.actionQueue[0] ?? null });
    }, 1800);
    return () => clearTimeout(id);
  }, [game.phaseDelay, game.handNum]);

  // Hero fold ref + 30s timer with away detection
  function heroFold() { sounds.current.fold(); setGame(prev => processAction(prev, 0, "fold")); }
  foldRef.current = heroFold;

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!isHeroTurn || tournamentStatus) { setTimeLeft(30); return; }
    if (heroAwayRef.current) { heroFold(); return; }
    setTimeLeft(30);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (heroAwayRef.current) { foldRef.current(); return 30; }
        if (prev <= 1) { foldRef.current(); return 30; }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isHeroTurn, game.activeIdx, game.handNum, tournamentStatus]);

  // Urgent countdown: a beep every second inside the last ten, climbing in
  // pitch as the clock runs out. Driven off the rendered value rather than the
  // interval so a re-entrant state updater can never double-fire it.
  useEffect(() => {
    if (!isHeroTurn || timeLeft > 10 || timeLeft <= 0) return;
    sounds.current.timer(1 - timeLeft / 10);
  }, [timeLeft, isHeroTurn]);

  // AI turns
  useEffect(() => {
    const idx = game.activeIdx;
    if (idx === null || idx === 0 || isShowdown || game.phaseDelay || tournamentStatus) return;
    const actor = game.players[idx];
    if (!actor || actor.folded || actor.isAllIn || actor.eliminated) return;
    const id = setTimeout(() => {
      setGame(prev => {
        if (prev.activeIdx !== idx || prev.street === "showdown") return prev;
        if (prev.players[idx]?.isHero) return prev;
        const next = processAIAction(prev);
        const prevAction = prev.players[idx].action;
        const nextAction = next.players[idx].action;
        if (nextAction === "fold") sounds.current.fold();
        else if (nextAction === "allin") sounds.current.allin();
        else if (nextAction !== prevAction) sounds.current.chip();
        return next;
      });
    }, 1400);
    return () => clearTimeout(id);
  }, [game.activeIdx, game.handNum, game.phaseDelay, isShowdown, tournamentStatus]);

  // Blind level timer (2-minute levels)
  useEffect(() => {
    const id = setInterval(() => {
      setLevelSeconds(prev => {
        if (prev + 1 >= LEVEL_DURATION) {
          setBlindLevel(l => Math.min(l + 1, BLIND_LEVELS.length - 1));
          return 0;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // "Blinds increased to $4/$8!" — announce every level change after the first.
  const prevBlindLevel = useRef(0);
  useEffect(() => {
    if (blindLevel === prevBlindLevel.current) return;
    prevBlindLevel.current = blindLevel;
    const bl = BLIND_LEVELS[blindLevel];
    setLevelFlash(`Blinds increased to $${bl.sb}/$${bl.bb}!`);
    sounds.current.levelUp();
  }, [blindLevel]);

  // Bust-out sting whenever the field shrinks.
  const prevRemaining = useRef(numSeats);
  useEffect(() => {
    if (playersRemaining < prevRemaining.current) sounds.current.eliminate();
    prevRemaining.current = playersRemaining;
  }, [playersRemaining]);

  // Page visibility → auto-fold when away
  useEffect(() => {
    function onVis() { heroAwayRef.current = document.hidden; }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Tournament end detection (runs after buildTournamentHand marks eliminations)
  useEffect(() => {
    if (tournamentStatus) return;
    const heroPlayer = game.players[0];
    if (heroPlayer.eliminated) {
      setTournamentStatus({ phase: "lost", place: heroPlayer.finishPos ?? numSeats, prize: 0 });
      return;
    }
    if (game.players.slice(1).every(p => p.eliminated)) {
      setTournamentStatus({ phase: "won", place: 1, prize: prizePool });
      fetch("/api/tournament/win", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: prizePool * 100, name }),
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.players]);

  // Hero actions
  function heroCheck() { if (!isHeroTurn || !isBetCtx) return; setGame(prev => processAction(prev, 0, "check")); }
  function heroCall() { if (!isHeroTurn || isBetCtx) return; sounds.current.chip(); setGame(prev => processAction(prev, 0, "call")); }
  function heroBetRaise() {
    if (!isHeroTurn) return;
    const amt = Math.max(betRaiseMin, Math.min(raiseAmt, betRaiseMax));
    // Sliding the bet all the way up is a shove, and should sound like one.
    if (amt >= hero.chips + hero.streetBet) sounds.current.allin();
    else sounds.current.chip();
    setGame(prev => processAction(prev, 0, game.currentBet === 0 ? "bet" : "raise", amt));
  }
  function heroAllIn() {
    if (!isHeroTurn) return;
    sounds.current.allin();
    setGame(prev => processAction(prev, 0, game.currentBet === 0 ? "bet" : "raise", hero.chips + hero.streetBet));
  }
  function newHand() {
    if (tournamentStatus) return;
    if (timerRef.current) clearInterval(timerRef.current);
    const bl = BLIND_LEVELS[blindLevel];
    setGame(prev => buildTournamentHand(prev.handNum + 1, prev.players, prev.dealerIdx, bl));
    setRaiseAmt(Math.max(4, BLIND_LEVELS[blindLevel].bb * 2));
    setTimeLeft(30);
  }

  const communityLabels = ["FLOP", "FLOP", "FLOP", "TURN", "RIVER"];
  const timerColor = timeLeft > 14 ? "#10b981" : timeLeft > 7 ? "#f59e0b" : "#ef4444";
  const timerRadius = 22, timerCirc = 2 * Math.PI * timerRadius, timerDash = (timeLeft / 30) * timerCirc;
  const levelSecondsLeft = LEVEL_DURATION - levelSeconds;

  // Must sit below every hook — an early return above them would change the
  // hook count between the pre-mount and post-mount renders.
  if (!mounted) return <div style={{ background: "#060d08", height: "100vh" }} />;

  return (
    <div className="h-[100dvh] text-white flex flex-col overflow-hidden" style={{ background: "#060d08", userSelect: "none" }}>

      <TournamentHeader
        prizePool={prizePool}
        playersRemaining={playersRemaining}
        totalPlayers={numSeats}
        blindLevel={blindLevel}
        levelSecondsLeft={levelSecondsLeft}
        muted={muted}
        onToggleMute={toggleMute}
      />

      <div className="flex-1 flex overflow-hidden relative">
        <main className="flex-1 flex flex-col overflow-hidden">

          {/* Table scene */}
          <div ref={tableAreaRef} className="table-area flex-1 relative overflow-hidden">
            <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 60%,#0d1f11 0%,#060d08 100%)" }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="table-scene relative" style={{width:SCENE_W,height:SCENE_H,transform:`scale(${tableScale})`}}>

                {/* Felt — gold rail, green bloom off the edge, woven overlay */}
                <div className="absolute felt-oval table-glow" style={{ background: "linear-gradient(155deg,#1a4a2a 0%,#0f3019 50%,#1a4a2a 100%)", boxShadow: ["0 0 0 3px #c9a227", "0 0 0 7px #1e1200", "0 40px 130px rgba(0,0,0,0.95)", "inset 0 2px 6px rgba(255,200,50,0.08)"].join(",") }}>
                  <div className="absolute" style={{ inset: 10, borderRadius: "50%", background: "linear-gradient(155deg,#1c2a00,#162200,#1c2a00)" }}>
                    <div className="absolute felt-texture" style={{ inset: 16, borderRadius: "50%", background: "radial-gradient(ellipse at 45% 38%,#235f35 0%,#1a4a2a 52%,#0f3019 100%)", boxShadow: "inset 0 0 90px rgba(0,0,0,0.6),inset 0 0 30px rgba(0,0,0,0.35)" }}>
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                        <PotDisplay pot={game.pot} />
                        {game.sidePots.length > 0 && (
                          <div className="flex gap-2">
                            {game.sidePots.map((sp, i) => (
                              <span key={i} style={{ background: "rgba(201,162,39,0.2)", color: "#fbbf24", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, border: "1px solid rgba(201,162,39,0.3)" }}>
                                Side: ${sp.amount}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-2" style={{ perspective: "600px" }}>
                          {game.community.map((card, i) => (
                            <CommunitySlot key={`${game.handNum}-${i}-${card !== null}`} card={card} label={communityLabels[i]} flipDelay={i * 120} />
                          ))}
                        </div>
                        {game.phaseDelay && <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>Next street…</div>}
                        {!game.phaseDelay && !game.banner && <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>{game.street}</div>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Opponent seats. Cards fly out from the middle of the felt,
                    one seat at a time, in the order a dealer would pitch them.
                    Busted players fade out in place. */}
                {opponents.map((p, i) => {
                  const pos = seatPositions[i] ?? { right: 60, top: 20 };
                  return (
                    <OpponentSeat
                      key={p.id} player={p} pos={pos}
                      showCards={isShowdown && !p.folded}
                      isCurrentTurn={game.activeIdx === p.id && !game.phaseDelay}
                      isWinner={game.winnerIds.includes(p.id)}
                      compact
                      fly={flyFor(pos)}
                      dealDelay={p.id * DEAL_STRIDE}
                      dealStride={game.numSeats * DEAL_STRIDE}
                    />
                  );
                })}

                {/* Gold burst when the hero takes down the pot */}
                {isShowdown && isHeroWinner && <WinBurst />}

                {/* "Blinds increased to $4/$8!" */}
                {levelFlash && !tournamentStatus && (
                  <FlashBanner message={levelFlash} onDone={() => setLevelFlash(null)} />
                )}

                {/* Hero seat */}
                <div className="absolute flex flex-col items-center gap-1" style={{ bottom: 0, left: "50%", transform: "translateX(-50%)" }}>
                  {isHeroTurn && (
                    <div className="animate-pulse" style={{ background: "#10b981", color: "#000", fontWeight: 900, fontSize: 10, padding: "2px 10px", borderRadius: 4, letterSpacing: 1, boxShadow: "0 0 14px rgba(16,185,129,0.75)" }}>
                      YOUR TURN — {timeLeft}s
                    </div>
                  )}
                  <div className="flex items-center gap-2 rounded-full px-3 py-1.5" style={{
                    background: "rgba(0,0,0,0.78)",
                    border: isHeroWinner ? "2px solid #c9a227" : isHeroTurn ? "2px solid #10b981" : "1px solid rgba(245,158,11,0.35)",
                    backdropFilter: "blur(6px)",
                    boxShadow: isHeroWinner ? "0 0 22px rgba(201,162,39,0.55)" : isHeroTurn ? "0 0 16px rgba(16,185,129,0.5)" : undefined,
                  }}>
                    {(hero.isDealer || hero.isSB || hero.isBB) && (
                      <div style={{ display: "flex", gap: 2, marginRight: 2 }}>
                        {hero.isDealer && <span style={{ background: "#c9a227", color: "#000", fontWeight: 900, fontSize: 8, padding: "1px 4px", borderRadius: 3 }}>D</span>}
                        {hero.isSB     && <span style={{ background: "#6b7280", color: "white", fontWeight: 900, fontSize: 8, padding: "1px 4px", borderRadius: 3 }}>SB</span>}
                        {hero.isBB     && <span style={{ background: "#374151", color: "white", fontWeight: 900, fontSize: 8, padding: "1px 4px", borderRadius: 3 }}>BB</span>}
                      </div>
                    )}
                    <span className="text-lg leading-none">{hero.avatar}</span>
                    <span style={{ color: isHeroWinner ? "#f59e0b" : "#fbbf24", fontWeight: 900, fontSize: 12 }}>You</span>
                    <span style={{ color: "#374151", fontSize: 11 }}>·</span>
                    <AnimatedAmount value={hero.chips} style={{ color: "#f3f4f6", fontWeight: 700, fontSize: 12 }} />
                    {hero.streetBet > 0 && <><span style={{ color: "#374151", fontSize: 11 }}>·</span><span style={{ color: "#fcd34d", fontSize: 11 }}>Bet ${hero.streetBet}</span></>}
                    {hero.folded && <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 900 }}>· FOLDED</span>}
                    {!hero.folded && hero.isAllIn && <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 900 }}>· ALL IN</span>}
                    {isHeroWinner && <span style={{ color: "#f59e0b", fontSize: 11, fontWeight: 900 }}>· WINNER!</span>}
                  </div>
                </div>

                {/* Hand winner banner */}
                {game.banner && !tournamentStatus && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 50 }}>
                    <div style={{ background: isHeroWinner ? "rgba(16,185,129,0.96)" : "rgba(185,30,30,0.96)", color: "white", fontWeight: 900, fontSize: 17, padding: "14px 32px", borderRadius: 16, boxShadow: "0 8px 40px rgba(0,0,0,0.7)", textShadow: "0 2px 8px rgba(0,0,0,0.4)", maxWidth: 540, textAlign: "center", lineHeight: 1.5, animation: "page-fade-in 0.3s ease-out" }}>
                      {game.banner}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>

          {/* Action bar */}
          <div className="shrink-0 px-3 md:px-6 py-3 md:py-4 action-bar-wrapper" style={{ background: "rgba(6,13,8,0.97)", borderTop: "1px solid #1a2d1e" }}>
            <div className="hero-hand-row flex items-end justify-center gap-4 md:gap-8 mb-3 md:mb-4">
              <div className="hero-hand-meta hero-meta-left flex flex-col items-end min-w-[80px]">
                <span className="hero-label" style={{ color: "#4b5563", fontSize: 11 }}>Your hand</span>
                <span style={{ color: "#34d399", fontWeight: 700, fontSize: 12 }}>
                  {hero.cards.map(c => `${c.value}${c.suit}`).join(" ")}
                </span>
              </div>

              {isHeroTurn && (
                <div className="hero-timer">
                  <svg viewBox="0 0 56 56">
                    <circle cx="28" cy="28" r={timerRadius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
                    <circle cx="28" cy="28" r={timerRadius} fill="none" stroke={timerColor} strokeWidth="4"
                      strokeDasharray={`${timerDash} ${timerCirc}`} strokeLinecap="round"
                      style={{ transition: "stroke-dasharray 0.95s linear,stroke 0.3s" }} />
                  </svg>
                  <div className="timer-count" style={{ color: timerColor }}>{timeLeft}</div>
                </div>
              )}

              {/* Hero hole cards: pitched in from the felt, then flipped face
                  up in 3D once they land. */}
              <div className="hero-cards flex gap-1.5 md:gap-2 items-end">
                {hero.cards.map((c, i) => (
                  <div key={`${game.handNum}-${i}`} style={{ transform: i === 0 ? "rotate(-5deg) translateY(4px)" : "rotate(5deg) translateY(4px)", transition: "transform 0.2s" }}>
                    <Card
                      card={c}
                      size="lg"
                      fly={{ x: 0, y: -280, r: 12 }}
                      delay={i * game.numSeats * DEAL_STRIDE}
                      reveal
                      isWinner={isHeroWinner && isShowdown}
                      className={hero.folded ? "card-fold" : ""}
                    />
                  </div>
                ))}
              </div>

              <div className="hero-hand-meta hero-meta-right flex flex-col items-start min-w-[60px]">
                <span className="hero-label" style={{ color: "#4b5563", fontSize: 11 }}>Street</span>
                <span className="hero-street font-black" style={{ fontSize: 14, color: "#10b981", textTransform: "capitalize" }}>{game.street}</span>
                {game.currentBet > hero.streetBet && !isShowdown && (
                  <span style={{ color: "#6b7280", fontSize: 10, marginTop: 2 }}>To call: ${Math.min(game.currentBet - hero.streetBet, hero.chips)}</span>
                )}
              </div>
            </div>

            {/* Buttons */}
            {hero.eliminated ? (
              <div className="flex justify-center">
                <span style={{ color: "#4b5563", fontSize: 13, fontWeight: 700 }}>You have been eliminated.</span>
              </div>
            ) : isShowdown ? (
              <div className="flex justify-center">
                <button onClick={newHand}
                  className="font-black rounded-xl px-10 py-3 transition-all action-btn"
                  style={{ background: "#c9a227", color: "#000", boxShadow: "0 4px 20px rgba(201,162,39,0.5)", fontSize: 16 }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#f59e0b"; e.currentTarget.style.transform = "scale(1.04)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#c9a227"; e.currentTarget.style.transform = "scale(1)"; }}>
                  Next Hand →
                </button>
              </div>
            ) : hero.folded ? (
              <div className="flex justify-center">
                <span style={{ color: "#4b5563", fontSize: 13, fontWeight: 700 }}>Waiting for next hand…</span>
              </div>
            ) : hero.isAllIn ? (
              <div className="flex justify-center">
                <span style={{ color: "#ef4444", fontSize: 14, fontWeight: 900 }}>ALL IN — Waiting for showdown…</span>
              </div>
            ) : (
              <div className="flex items-stretch gap-2 md:gap-3 justify-center flex-wrap action-bar">
                <ActionButton tone="fold" onClick={heroFold} disabled={!isHeroTurn} tip="Discard your hand">
                  Fold
                </ActionButton>

                {isBetCtx ? (
                  <ActionButton tone="check" onClick={heroCheck} disabled={!isHeroTurn} tip="Pass action without betting">
                    Check
                  </ActionButton>
                ) : (
                  <ActionButton tone="call" onClick={heroCall} disabled={!isHeroTurn} tip="Match the current bet">
                    Call ${callAmt.toLocaleString()}
                  </ActionButton>
                )}

                <div className="bet-controls flex items-center gap-2 md:gap-3 rounded-xl px-3 md:px-4 py-2" style={{ background: "#0f1a12", border: "1px solid #2d4a3a" }}>
                  <div className="bet-readout min-w-[56px] md:min-w-[68px]">
                    <div className="bet-readout-label" style={{ color: "#4b5563", fontSize: 11 }}>{isBetCtx ? "Bet" : "Raise to"}</div>
                    <div className="bet-readout-value" style={{ color: "#f59e0b", fontWeight: 900, fontSize: 14 }}>${Math.min(raiseAmt, betRaiseMax).toLocaleString()}</div>
                  </div>
                  <input type="range" min={betRaiseMin} max={betRaiseMax} step={1}
                    value={Math.max(betRaiseMin, Math.min(raiseAmt, betRaiseMax))}
                    onChange={e => setRaiseAmt(Number(e.target.value))}
                    className="bet-slider w-20 md:w-32 cursor-pointer" style={{ accentColor: "#f59e0b" }} />
                  <div className="bet-quick flex flex-col gap-0.5">
                    {([["½P", Math.max(betRaiseMin, Math.round(game.pot * 0.5 / 2) * 2)], ["Pot", Math.max(betRaiseMin, game.pot)]] as [string, number][]).map(([lbl, v]) => (
                      <button key={lbl} onClick={() => setRaiseAmt(Math.min(betRaiseMax, Math.max(betRaiseMin, v)))}
                        className="text-xs px-1.5 py-0.5 rounded transition-colors"
                        style={{ color: "#6b7280", background: "transparent" }}
                        onMouseEnter={e => { e.currentTarget.style.color = "#f59e0b"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "#6b7280"; }}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                  <ActionButton tone="raise" onClick={heroBetRaise} disabled={!isHeroTurn}
                    tip={isBetCtx ? "Open the betting" : "Raise the current bet"}>
                    {isBetCtx ? "Bet" : "Raise"}
                  </ActionButton>
                  <ActionButton tone="allin" onClick={heroAllIn} disabled={!isHeroTurn} compact tip="Go all-in">
                    All-in
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Tournament result overlay */}
        {tournamentStatus && (
          <ResultOverlay
            phase={tournamentStatus.phase}
            place={tournamentStatus.place}
            prize={tournamentStatus.prize}
            onReturn={() => router.push("/tournaments")}
          />
        )}
      </div>

      <div className="shrink-0 text-center py-1 text-xs" style={{ background: "#030806", color: "#374151", borderTop: "1px solid #111" }}>
        18+ · Play Responsibly · GamCare · BeGambleAware
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={
      <div style={{ background: "#060d08", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
        <div className="spinner" />
        <span style={{ color: "#4b5563", fontSize: 13 }}>Loading tournament…</span>
      </div>
    }>
      <TournamentContent params={params} />
    </Suspense>
  );
}
