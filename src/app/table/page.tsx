"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ChatSidebar from "./ChatSidebar";
import { loadMuted, makeSounds, saveMuted } from "./_shared/sounds";
import {
  ActionButton, AnimatedAmount, Card, CommunitySlot, PotDisplay, WinBurst,
} from "./_shared/ui";
import type { CardData, FlyFrom, Suit } from "./_shared/ui";
import { BetPill, OpponentSeat } from "./_shared/seat";
import { OVAL_DESKTOP, OVAL_MOBILE, SCENE_H, SCENE_W, useFitScale, useIsMobile } from "./_shared/useFitScale";

// ─── Types ────────────────────────────────────────────────────────────────────

type GameVariant = "holdem" | "omaha";
type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
type Action = "waiting" | "fold" | "call" | "check" | "raise" | "bet" | "allin";

interface PlayerState {
  id: number; name: string; avatar: string; chips: number;
  cards: CardData[]; folded: boolean;
  streetBet: number; totalBet: number;
  action: Action; isHero: boolean;
  isDealer: boolean; isSB: boolean; isBB: boolean;
  isAllIn: boolean;
}

interface SidePot { amount: number; eligibleIds: number[]; }

interface GameState {
  variant: GameVariant;
  deck: CardData[];
  players: PlayerState[];
  community: (CardData | null)[];
  pot: number; sidePots: SidePot[];
  street: Street;
  currentBet: number;
  lastRaiseBy: number;
  actionQueue: number[];
  activeIdx: number | null;
  phaseDelay: boolean;
  winnerId: number | null;
  winnerIds: number[];
  banner: string;
  handNum: number;
  dealerIdx: number;
  actionLog: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

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
const TABLE_NUMBER = 4821;
const NAMES  = ["You","Alex_P","PokerKing","BigBlind88","Sharky99"];
const AVATARS = ["😎","🤠","👑","🎩","🦈"];

// ─── Hand Evaluation ──────────────────────────────────────────────────────────

interface HandResult { rank: number; name: string; tiebreakers: number[]; description: string; }

function combs<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...t] = arr;
  return [...combs(t, k-1).map(c => [h, ...c]), ...combs(t, k)];
}

function evalFive(cards: CardData[]): HandResult {
  const rv = cards.map(c => RANK_VALUE[c.value]).sort((a,b) => b-a);
  const suits = cards.map(c => c.suit);
  const cnt: Record<number,number> = {};
  for (const r of rv) cnt[r] = (cnt[r]||0)+1;
  const grp = Object.entries(cnt).map(([r,n]) => ({r:+r,n})).sort((a,b) => b.n-a.n||b.r-a.r);
  const flush = suits.every(s => s===suits[0]);
  const uniq = [...new Set(rv)].sort((a,b) => b-a);
  let str=false, sHi=0;
  if (uniq.length===5) {
    if (uniq[0]-uniq[4]===4) { str=true; sHi=uniq[0]; }
    if (uniq[0]===14&&uniq[1]===5&&uniq[2]===4&&uniq[3]===3&&uniq[4]===2) { str=true; sHi=5; }
  }
  const n = (r:number) => RANK_NAME[r]??String(r);
  const ns = (r:number) => n(r)+"s";
  if (flush&&str&&sHi===14) return { rank:9, name:"Royal Flush",    tiebreakers:[14],                      description:"Royal Flush" };
  if (flush&&str)            return { rank:8, name:"Straight Flush", tiebreakers:[sHi],                     description:`Straight Flush, ${n(sHi)}-high` };
  if (grp[0].n===4)          return { rank:7, name:"Four of a Kind", tiebreakers:[grp[0].r,grp[1]?.r??0],  description:`Four of a Kind, ${ns(grp[0].r)}` };
  if (grp[0].n===3&&grp[1]?.n===2) return { rank:6, name:"Full House", tiebreakers:[grp[0].r,grp[1].r],   description:`Full House, ${ns(grp[0].r)} over ${ns(grp[1].r)}` };
  if (flush)                 return { rank:5, name:"Flush",           tiebreakers:rv,                        description:`Flush, ${n(rv[0])}-high` };
  if (str)                   return { rank:4, name:"Straight",        tiebreakers:[sHi],                     description:`Straight, ${n(sHi)}-high` };
  if (grp[0].n===3)          return { rank:3, name:"Three of a Kind", tiebreakers:[grp[0].r,...grp.slice(1).map(g=>g.r)], description:`Three of a Kind, ${ns(grp[0].r)}` };
  if (grp[0].n===2&&grp[1]?.n===2) return { rank:2, name:"Two Pair", tiebreakers:[grp[0].r,grp[1].r,grp[2]?.r??0], description:`Two Pair, ${ns(grp[0].r)} and ${ns(grp[1].r)}` };
  if (grp[0].n===2)          return { rank:1, name:"One Pair",        tiebreakers:[grp[0].r,...grp.slice(1).map(g=>g.r)], description:`Pair of ${ns(grp[0].r)}` };
  return                            { rank:0, name:"High Card",        tiebreakers:rv,                        description:`${n(rv[0])}-high` };
}

function cmpArr(a: number[], b: number[]): number {
  for (let i=0; i<Math.min(a.length,b.length); i++) if (a[i]!==b[i]) return a[i]-b[i];
  return 0;
}

function bestHandOf(hole: CardData[], community: (CardData|null)[]): HandResult {
  const board = community.filter((c): c is CardData => c!==null);
  const all = [...hole,...board];
  if (all.length < 5) {
    const pad = [...all];
    while (pad.length < 5) pad.push(all[0]??{value:"2",suit:"♠"});
    return evalFive(pad);
  }
  return combs(all,5).reduce((best,combo) => {
    const h = evalFive(combo);
    return h.rank>best.rank||(h.rank===best.rank&&cmpArr(h.tiebreakers,best.tiebreakers)>0)?h:best;
  }, evalFive(combs(all,5)[0]));
}

function bestHandOfOmaha(hole: CardData[], community: (CardData|null)[]): HandResult {
  const board = community.filter((c): c is CardData => c!==null);
  if (board.length < 3) {
    const sorted = [...hole].sort((a,b) => RANK_VALUE[b.value]-RANK_VALUE[a.value]);
    return { rank:0, name:"High Card", tiebreakers:sorted.map(c=>RANK_VALUE[c.value]).slice(0,5), description:"N/A" };
  }
  const holeCombos = combs(hole, 2);
  const boardCombos = combs(board, 3);
  let best: HandResult = { rank:-1, name:"", tiebreakers:[], description:"" };
  for (const hc of holeCombos) {
    for (const bc of boardCombos) {
      const h = evalFive([...hc,...bc]);
      if (h.rank>best.rank||(h.rank===best.rank&&cmpArr(h.tiebreakers,best.tiebreakers)>0)) best=h;
    }
  }
  return best.rank===-1 ? { rank:0, name:"High Card", tiebreakers:[], description:"N/A" } : best;
}

function pickWinner(alive: PlayerState[], community: (CardData|null)[], variant: GameVariant): { winnerId: number; best: HandResult } {
  const eval_ = variant==="omaha" ? bestHandOfOmaha : bestHandOf;
  let best: HandResult|null=null, winnerId=alive[0].id;
  for (const p of alive) {
    const h = eval_(p.cards, community);
    if (!best||h.rank>best.rank||(h.rank===best.rank&&cmpArr(h.tiebreakers,best.tiebreakers)>0)) { best=h; winnerId=p.id; }
  }
  return { winnerId, best: best! };
}

// ─── Side Pots ─────────────────────────────────────────────────────────────────

function buildSidePots(players: PlayerState[]): SidePot[] {
  const hasAllIn = players.some(p => p.isAllIn && !p.folded);
  if (!hasAllIn) return [];

  const contribs = players.map(p => ({ id:p.id, total:p.totalBet, folded:p.folded }));
  const allInLevels = [...new Set(
    players.filter(p => p.isAllIn&&!p.folded).map(p => p.totalBet)
  )].sort((a,b) => a-b);

  const pots: SidePot[] = [];
  let prev = 0;
  for (const level of allInLevels) {
    const amt = contribs.reduce((s,c) => s+Math.max(0, Math.min(c.total,level)-prev), 0);
    const eligible = contribs.filter(c => !c.folded&&c.total>=level).map(c => c.id);
    if (amt>0&&eligible.length>0) pots.push({ amount:amt, eligibleIds:eligible });
    prev = level;
  }
  const remAmt = contribs.reduce((s,c) => s+Math.max(0,c.total-prev), 0);
  if (remAmt>0) {
    const eligible = contribs.filter(c => !c.folded&&c.total>prev).map(c => c.id);
    if (eligible.length>0) pots.push({ amount:remAmt, eligibleIds:eligible });
  }
  return pots;
}

// ─── Game Logic ────────────────────────────────────────────────────────────────

function resolveShowdown(state: GameState): GameState {
  const { players, community, pot, variant } = state;
  const alive = players.filter(p => !p.folded);

  if (alive.length===1) {
    const w = alive[0];
    return {
      ...state,
      players: players.map(p => p.id===w.id ? {...p,chips:p.chips+pot} : p),
      street:"showdown", activeIdx:null, actionQueue:[], phaseDelay:false,
      winnerId:w.id, winnerIds:[w.id],
      banner: w.isHero
        ? `You win $${pot.toLocaleString()}! Opponents folded.`
        : `${w.name} wins $${pot.toLocaleString()}. You folded.`,
      sidePots:[],
    };
  }

  const sidePots = buildSidePots(players);

  if (sidePots.length>0) {
    let updPlayers = players.map(p => ({...p}));
    const parts: string[] = [];
    const allWinnerIds: number[] = [];
    for (const sp of sidePots) {
      const potAlive = alive.filter(p => sp.eligibleIds.includes(p.id));
      if (potAlive.length===0) continue;
      const { winnerId:wid, best } = pickWinner(potAlive, community, variant);
      updPlayers = updPlayers.map(p => p.id===wid ? {...p,chips:p.chips+sp.amount} : p);
      allWinnerIds.push(wid);
      const wp = players.find(p => p.id===wid)!;
      parts.push(`${wp.isHero?'You win':`${wp.name} wins`} $${sp.amount.toLocaleString()} — ${best.description}`);
    }
    const primaryWinner = allWinnerIds[allWinnerIds.length-1]??alive[0].id;
    return {
      ...state, players:updPlayers,
      street:"showdown", activeIdx:null, actionQueue:[], phaseDelay:false,
      winnerId:primaryWinner, winnerIds:[...new Set(allWinnerIds)],
      banner:parts.join(' · '), sidePots:[],
    };
  }

  const { winnerId, best } = pickWinner(alive, community, variant);
  const w = players.find(p => p.id===winnerId)!;
  return {
    ...state,
    players: players.map(p => p.id===winnerId ? {...p,chips:p.chips+pot} : p),
    street:"showdown", activeIdx:null, actionQueue:[], phaseDelay:false,
    winnerId, winnerIds:[winnerId],
    banner: w.isHero
      ? `You win $${pot.toLocaleString()} with ${best.description}!`
      : `${w.name} wins $${pot.toLocaleString()} with ${best.description}!`,
    sidePots:[],
  };
}

function advanceStreet(state: GameState): GameState {
  const { players, dealerIdx, street } = state;
  const next: Street = street==="preflop"?"flop":street==="flop"?"turn":street==="turn"?"river":"showdown";
  if (next==="showdown") return resolveShowdown(state);

  const resetPlayers = players.map(p => ({...p, streetBet:0, action:"waiting" as Action}));
  const community = [...state.community];
  if (next==="flop")  { community[0]=state.deck[0]; community[1]=state.deck[1]; community[2]=state.deck[2]; }
  else if (next==="turn")  { community[3]=state.deck[3]; }
  else if (next==="river") { community[4]=state.deck[4]; }

  const canAct = resetPlayers.filter(p => !p.folded&&!p.isAllIn);

  if (canAct.length<=1) {
    // Auto-run board if everyone is all-in
    const fullComm: (CardData|null)[] = [...community];
    if (!fullComm[0]) { fullComm[0]=state.deck[0]; fullComm[1]=state.deck[1]; fullComm[2]=state.deck[2]; }
    if (!fullComm[3]) fullComm[3]=state.deck[3];
    if (!fullComm[4]) fullComm[4]=state.deck[4];
    return resolveShowdown({...state, players:resetPlayers, community:fullComm, street:"river", currentBet:0, lastRaiseBy:2, actionQueue:[], activeIdx:null, phaseDelay:false});
  }

  // Post-flop action starts left of dealer (SB)
  const actionQueue: number[] = [];
  for (let i=1; i<=5; i++) {
    const idx = (dealerIdx+i)%5;
    if (!resetPlayers[idx].folded&&!resetPlayers[idx].isAllIn) actionQueue.push(idx);
  }

  return { ...state, players:resetPlayers, community, street:next, currentBet:0, lastRaiseBy:2, actionQueue, activeIdx:null, phaseDelay:true };
}

function processAction(
  prev: GameState, actorIdx: number,
  action: "fold"|"call"|"check"|"raise"|"bet",
  betToAmount?: number
): GameState {
  const players = prev.players.map(p => ({...p}));
  const actor = players[actorIdx];
  let pot=prev.pot, currentBet=prev.currentBet, lastRaiseBy=prev.lastRaiseBy;
  let actionQueue = prev.actionQueue.filter(i => i!==actorIdx);
  const actorLabel = actor.isHero ? "You" : actor.name;
  let logEntry = "";

  if (action==="fold") {
    actor.folded=true; actor.action="fold";
    logEntry = `${actorLabel} folded`;
  } else if (action==="check") {
    actor.action="check";
    logEntry = `${actorLabel} checked`;
  } else if (action==="call") {
    const amt = Math.min(currentBet-actor.streetBet, actor.chips);
    actor.chips-=amt; actor.streetBet+=amt; actor.totalBet+=amt; pot+=amt;
    actor.isAllIn = actor.chips===0;
    actor.action = actor.chips===0 ? "allin" : "call";
    logEntry = `${actorLabel} called $${amt.toLocaleString()}${actor.isAllIn?" (All In)":""}`;
  } else if ((action==="raise"||action==="bet")&&betToAmount!==undefined) {
    const add = Math.min(betToAmount-actor.streetBet, actor.chips);
    const newSB = actor.streetBet+add;
    pot+=add; actor.chips-=add; actor.totalBet+=add;
    lastRaiseBy = Math.max(1, newSB-currentBet);
    currentBet=newSB; actor.streetBet=newSB;
    actor.isAllIn = actor.chips===0;
    actor.action = actor.chips===0 ? "allin" : action==="bet" ? "bet" : "raise";
    logEntry = action==="bet"
      ? `${actorLabel} bet $${newSB.toLocaleString()}${actor.isAllIn?" (All In)":""}`
      : `${actorLabel} raised to $${newSB.toLocaleString()}${actor.isAllIn?" (All In)":""}`;
    // Raise re-opens action for all non-folded, non-allin players
    actionQueue=[];
    for (let i=1; i<=4; i++) {
      const idx=(actorIdx+i)%5;
      if (!players[idx].folded&&!players[idx].isAllIn) actionQueue.push(idx);
    }
  }

  const actionLog = logEntry ? [...prev.actionLog, logEntry].slice(-20) : prev.actionLog;

  const alive = players.filter(p => !p.folded);
  if (alive.length===1) return resolveShowdown({...prev,players,pot,currentBet,lastRaiseBy,actionQueue,actionLog});

  const canStillAct = players.filter(p => !p.folded&&!p.isAllIn);
  if (actionQueue.length===0||canStillAct.length===0) {
    return advanceStreet({...prev,players,pot,currentBet,lastRaiseBy,actionQueue,actionLog});
  }
  return {...prev,players,pot,currentBet,lastRaiseBy,actionQueue,actionLog,activeIdx:actionQueue[0]};
}

function processAIAction(state: GameState): GameState {
  const actorIdx = state.activeIdx!;
  const actor = state.players[actorIdx];
  const callAmt = state.currentBet-actor.streetBet;
  const r = Math.random();
  if (callAmt>=actor.chips&&callAmt>0) {
    if (r<0.45) return processAction(state,actorIdx,"fold");
    return processAction(state,actorIdx,"call");
  }
  if (r<0.25&&callAmt>0) return processAction(state,actorIdx,"fold");
  if (r<0.80||callAmt===0) {
    if (callAmt===0) return processAction(state,actorIdx,"check");
    return processAction(state,actorIdx,"call");
  }
  const raiseSize = Math.max(state.lastRaiseBy, Math.ceil(state.currentBet*0.7)||2);
  const raiseTo = Math.min(state.currentBet+raiseSize, actor.chips+actor.streetBet);
  if (raiseTo<=state.currentBet) return processAction(state,actorIdx,callAmt===0?"check":"call");
  return processAction(state,actorIdx,state.currentBet===0?"bet":"raise",raiseTo);
}

// ─── Deck ─────────────────────────────────────────────────────────────────────

function makeDeck(): CardData[] {
  const d: CardData[]=[];
  for (const s of SUITS) for (const v of VALUES) d.push({suit:s,value:v});
  return d;
}
function shuffle(d: CardData[]): CardData[] {
  const a=[...d];
  for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

function buildInitialState(handNum: number, prevPlayers?: PlayerState[], variant: GameVariant="holdem", prevLog: string[]=[]): GameState {
  const deck = shuffle(makeDeck());
  let ci=0;
  const dealerIdx = (handNum-1)%5;
  const sbIdx = (dealerIdx+1)%5;
  const bbIdx = (dealerIdx+2)%5;

  const baseChips = prevPlayers
    ? prevPlayers.map(p => Math.max(p.chips, 20))
    : [200,200,175,185,210];

  const chips = baseChips.map((c,i) => {
    if (i===sbIdx) return Math.max(0,c-1);
    if (i===bbIdx) return Math.max(0,c-2);
    return c;
  });

  const holeCount = variant==="omaha" ? 4 : 2;

  const players: PlayerState[] = NAMES.map((name,i) => {
    const cards: CardData[]=[];
    for (let k=0;k<holeCount;k++) cards.push(deck[ci++]);
    return {
      id:i, name, avatar:AVATARS[i], chips:chips[i],
      cards, folded:false,
      streetBet: i===sbIdx?1:i===bbIdx?2:0,
      totalBet:  i===sbIdx?1:i===bbIdx?2:0,
      action:"waiting", isHero:i===0,
      isDealer:i===dealerIdx, isSB:i===sbIdx, isBB:i===bbIdx,
      isAllIn:false,
    };
  });

  const communityDeck=[deck[ci++],deck[ci++],deck[ci++],deck[ci++],deck[ci++]];

  const actionQueue: number[]=[];
  for (let i=3;i<=7;i++) actionQueue.push((dealerIdx+i)%5);

  const sbLabel = players[sbIdx].isHero ? "You" : players[sbIdx].name;
  const bbLabel = players[bbIdx].isHero ? "You" : players[bbIdx].name;
  const actionLog = [...prevLog, `${sbLabel} posted small blind $1`, `${bbLabel} posted big blind $2`].slice(-20);

  return {
    variant, deck:communityDeck, players,
    community:[null,null,null,null,null],
    pot:3, sidePots:[],
    street:"preflop",
    currentBet:2, lastRaiseBy:2,
    actionQueue, activeIdx:actionQueue[0],
    phaseDelay:false, winnerId:null, winnerIds:[], banner:"", handNum, dealerIdx,
    actionLog,
  };
}

// ─── Seat geometry ────────────────────────────────────────────────────────────

const SEAT_POS: React.CSSProperties[] = [
  { right:60, bottom:18 },
  { right:95, top:10 },
  { left:95,  top:10 },
  { left:70,  bottom:18 },
];

// Where each seat's cards fly in FROM, in px relative to where they land.
// These point back at the dealer position in the middle of the felt, so every
// card appears to be pitched out from the centre of the table.
const SEAT_FLY: FlyFrom[] = [
  { x:-292, y:-175, r: 22 },
  { x:-257, y:  95, r: 18 },
  { x: 257, y:  95, r:-18 },
  { x: 282, y:-175, r:-22 },
];
// The hero's cards live in the action bar below the felt, so they arrive from
// well above rather than from a seat coordinate.
const HERO_FLY: FlyFrom = { x:0, y:-280, r:12 };

// Milliseconds between consecutive cards leaving the dealer's hand.
const DEAL_STRIDE = 70;

// ─── TableContent ─────────────────────────────────────────────────────────────

function TableContent() {
  const searchParams = useSearchParams();
  const variant = ((searchParams.get("variant")??"holdem") as GameVariant);
  const router = useRouter();

  // Hero/opponent cards come from a Math.random() shuffle, so the server HTML
  // can never match the client's first render. Hold back the whole table until
  // after mount and render a matching placeholder on both sides.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The felt is scaled to the measured height of the area left between the
  // header and the action bar, so nothing can be clipped at any viewport.
  const isMobile = useIsMobile();
  const { ref: tableAreaRef, scale: tableScale } = useFitScale(isMobile ? OVAL_MOBILE : OVAL_DESKTOP);

  // Mute is loaded after mount — localStorage does not exist during SSR — and
  // written back on every toggle so the preference survives a reload.
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { setMuted(loadMuted()); }, []);

  const sounds = useRef(makeSounds(mutedRef));

  const toggleMute = useCallback(() => {
    setMuted(m => { saveMuted(!m); return !m; });
    sounds.current.unlock();
  }, []);

  const [game, setGame] = useState<GameState>(() => buildInitialState(1,undefined,variant));
  const [raiseAmt, setRaiseAmt] = useState(4);
  const [timeLeft, setTimeLeft] = useState(30);
  const [bannerFading, setBannerFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const foldRef  = useRef<()=>void>(()=>{});

  const [realBalance, setRealBalance] = useState<number | null>(null);
  const [isGuest, setIsGuest]         = useState(false);
  const buyinDoneRef   = useRef(false);
  const cashoutDoneRef = useRef(false);
  const gameRef = useRef(game);
  useEffect(() => { gameRef.current = game; }, [game]);
  const heroChipsAtHandStartRef = useRef(game.players[0].chips);

  // `hand` and `table` are only used to phrase the in-app notification
  // ("🏆 You won $47 with a Full House!"); the balance move ignores them.
  async function reportGameResult(type: "win"|"loss", amount: number, hand?: string) {
    if (!buyinDoneRef.current || amount<=0) return;
    try {
      const res = await fetch("/api/wallet/game-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          amount: Math.round(amount*100),
          hand,
          table: TABLE_NUMBER,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRealBalance(data.balance / 100);
      }
    } catch {}
  }

  // Auth check + buy-in on mount
  useEffect(() => {
    (async () => {
      const meRes = await fetch("/api/auth/me");
      const meData = await meRes.json();
      const user = meData.user;
      if (!user) { setIsGuest(true); return; }
      if (user.balance < 20000) {
        router.replace("/wallet?message=Insufficient+balance%2C+please+deposit+funds");
        return;
      }
      if (buyinDoneRef.current) return;
      buyinDoneRef.current = true;
      const res = await fetch("/api/table/buyin", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setRealBalance(data.balance / 100);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Send cashout when page is closed/refreshed (sendBeacon survives unload)
  useEffect(() => {
    function handleBeforeUnload() {
      if (cashoutDoneRef.current || !buyinDoneRef.current) return;
      cashoutDoneRef.current = true;
      const finalChips = gameRef.current.players[0].chips;
      navigator.sendBeacon(
        "/api/table/cashout",
        new Blob([JSON.stringify({ finalChips })], { type: "application/json" })
      );
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Send cashout on SPA unmount (browser back, programmatic navigation)
  useEffect(() => {
    return () => {
      if (cashoutDoneRef.current || !buyinDoneRef.current) return;
      cashoutDoneRef.current = true;
      const finalChips = gameRef.current.players[0].chips;
      fetch("/api/table/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalChips }),
        keepalive: true,
      }).catch(() => {});
    };
  }, []);

  async function handleLeaveTable(e: React.MouseEvent) {
    e.preventDefault();
    if (!cashoutDoneRef.current && buyinDoneRef.current) {
      cashoutDoneRef.current = true;
      const finalChips = gameRef.current.players[0].chips;
      await fetch("/api/table/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalChips }),
      }).catch(() => {});
    }
    router.push("/lobby");
  }

  const hero = game.players[0];
  const opponents = game.players.slice(1);
  const activePlayers = game.players.filter(p => !p.folded);
  const isShowdown = game.street==="showdown";
  const isHeroTurn = game.activeIdx===0&&!game.phaseDelay&&!isShowdown&&!hero.folded&&!hero.isAllIn;
  const isHeroWinner = game.winnerIds.includes(0);
  const callAmt = Math.min(game.currentBet-hero.streetBet, hero.chips);
  const isBetContext = game.currentBet===0||game.currentBet===hero.streetBet;
  const betRaiseMin = game.currentBet===0 ? 2 : game.currentBet+game.lastRaiseBy;
  const betRaiseMax = Math.max(betRaiseMin, hero.chips+hero.streetBet);

  useEffect(() => {
    setRaiseAmt(prev => Math.max(betRaiseMin, Math.min(prev, betRaiseMax)));
  }, [game.street, game.handNum, game.currentBet, betRaiseMin, betRaiseMax]);

  // One swoosh per card, on the same clock as the deal animation so the sound
  // lands with the card. Cleared on unmount so a fast next hand cannot stack
  // two hands' worth of deal sounds on top of each other.
  useEffect(() => {
    const holeCount = variant==="omaha" ? 4 : 2;
    const ids = Array.from({length:holeCount*5}, (_,i) =>
      setTimeout(() => sounds.current.deal(), i*DEAL_STRIDE+40));
    return () => ids.forEach(clearTimeout);
  }, [game.handNum, variant]);

  // Track hero's chip count at the start of each hand (post-blinds)
  useEffect(() => {
    heroChipsAtHandStartRef.current = game.players[0].chips;
  }, [game.handNum]);

  // Sound on action + report win/loss to wallet
  const prevStreet = useRef<Street>("preflop");
  useEffect(() => {
    if (game.street!==prevStreet.current) {
      prevStreet.current = game.street;
      // Board card hitting the felt — bigger, wider whoosh than a hole card.
      if (game.street==="flop"||game.street==="turn"||game.street==="river") {
        sounds.current.reveal();
      }
      if (game.street==="showdown") {
        if (isHeroWinner) sounds.current.win();
        const heroEnd = game.players[0];
        const netChange = heroEnd.chips - heroChipsAtHandStartRef.current;
        const amountWon = netChange + heroEnd.totalBet;
        if (isHeroWinner && amountWon>0) {
          // Only meaningful when the hand actually reached a showdown — an
          // uncontested win has no hand to name, so send nothing and let the
          // notification fall back to the plain "You won $X!" wording.
          const contested = game.players.filter(p => !p.folded).length > 1;
          const evalHand = game.variant==="omaha" ? bestHandOfOmaha : bestHandOf;
          const handName = contested
            ? evalHand(heroEnd.cards, game.community).name
            : undefined;
          reportGameResult("win", amountWon, handName);
        }
        else if (!isHeroWinner && heroEnd.totalBet>0) reportGameResult("loss", heroEnd.totalBet);
      }
    }
  });

  // Phase delay
  useEffect(() => {
    if (!game.phaseDelay) return;
    const id = setTimeout(()=>{
      setGame(prev => {
        if (!prev.phaseDelay) return prev;
        return {...prev, phaseDelay:false, activeIdx:prev.actionQueue[0]??null};
      });
    }, 1800);
    return ()=>clearTimeout(id);
  }, [game.phaseDelay, game.handNum]);

  // Hero 30s timer
  function heroFold() { sounds.current.fold(); setGame(prev=>processAction(prev,0,"fold")); }
  foldRef.current = heroFold;
  useEffect(()=>{
    if (timerRef.current) clearInterval(timerRef.current);
    if (!isHeroTurn) { setTimeLeft(30); return; }
    setTimeLeft(30);
    timerRef.current = setInterval(()=>{
      setTimeLeft(prev=>{
        if (prev<=1) { foldRef.current(); return 30; }
        return prev-1;
      });
    },1000);
    return ()=>{ if (timerRef.current) clearInterval(timerRef.current); };
  },[isHeroTurn, game.activeIdx, game.handNum]);

  // Urgent countdown: a beep every second inside the last ten, climbing in
  // pitch as the clock runs out. Driven off the rendered value rather than the
  // interval so a re-entrant state updater can never double-fire it.
  useEffect(()=>{
    if (!isHeroTurn||timeLeft>10||timeLeft<=0) return;
    sounds.current.timer(1-timeLeft/10);
  },[timeLeft, isHeroTurn]);

  // AI turns
  useEffect(()=>{
    const idx=game.activeIdx;
    if (idx===null||idx===0||isShowdown||game.phaseDelay) return;
    const actor=game.players[idx];
    if (!actor||actor.folded||actor.isAllIn) return;
    const id=setTimeout(()=>{
      setGame(prev=>{
        if (prev.activeIdx!==idx||prev.street==="showdown") return prev;
        if (prev.players[idx]?.isHero) return prev;
        const next = processAIAction(prev);
        const prevActor = prev.players[idx];
        const nextActor = next.players[idx];
        if (nextActor.action==="fold") sounds.current.fold();
        else if (nextActor.action==="allin") sounds.current.allin();
        else if (nextActor.action!==prevActor.action) sounds.current.chip();
        return next;
      });
    },1400);
    return ()=>clearTimeout(id);
  },[game.activeIdx, game.handNum, game.phaseDelay, isShowdown]);

  // Auto-deal 4 seconds after showdown — fade banner at 3.5s, deal at 4s
  useEffect(() => {
    if (game.street !== "showdown") { setBannerFading(false); return; }
    const fadeId = setTimeout(() => setBannerFading(true), 3500);
    const dealId = setTimeout(() => {
      if (timerRef.current) clearInterval(timerRef.current);
      setGame(prev => buildInitialState(prev.handNum+1, prev.players, variant, prev.actionLog));
      setRaiseAmt(4);
      setTimeLeft(30);
      setBannerFading(false);
    }, 4000);
    return () => { clearTimeout(fadeId); clearTimeout(dealId); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.street, game.handNum]);

  function heroCheck() {
    if (!isHeroTurn||!isBetContext) return;
    setGame(prev=>processAction(prev,0,"check"));
  }
  function heroCall() {
    if (!isHeroTurn||isBetContext) return;
    sounds.current.chip();
    setGame(prev=>processAction(prev,0,"call"));
  }
  function heroBetRaise() {
    if (!isHeroTurn) return;
    const amt = Math.max(betRaiseMin,Math.min(raiseAmt,betRaiseMax));
    const a: "bet"|"raise" = game.currentBet===0?"bet":"raise";
    // Sliding the bet all the way up is a shove, and should sound like one.
    if (amt>=hero.chips+hero.streetBet) sounds.current.allin();
    else sounds.current.chip();
    setGame(prev=>processAction(prev,0,a,amt));
  }
  function heroAllIn() {
    if (!isHeroTurn) return;
    const amt = hero.chips+hero.streetBet;
    const a: "bet"|"raise" = game.currentBet===0?"bet":"raise";
    sounds.current.allin();
    setGame(prev=>processAction(prev,0,a,amt));
  }
  function newHand() {
    if (timerRef.current) clearInterval(timerRef.current);
    setGame(prev=>buildInitialState(prev.handNum+1,prev.players,variant,prev.actionLog));
    setRaiseAmt(4);
    setTimeLeft(30);
  }

  const communityLabels = ["FLOP","FLOP","FLOP","TURN","RIVER"];
  const timerColor = timeLeft>14?"#10b981":timeLeft>7?"#f59e0b":"#ef4444";
  const timerRadius=22, timerCirc=2*Math.PI*timerRadius, timerDash=(timeLeft/30)*timerCirc;

  const variantLabel = variant==="omaha" ? "Pot-Limit Omaha" : "NL Texas Hold'em";

  // Must sit below every hook — an early return above them would change the
  // hook count between the pre-mount and post-mount renders.
  if (!mounted) return <div style={{background:"#060d08", height:"100vh"}} />;

  return (
    <div className="h-[100dvh] text-white flex flex-col overflow-hidden" style={{background:"#060d08",userSelect:"none"}}>

      {/* ── Header ── */}
      <header className="table-header flex items-center justify-between shrink-0 px-2 md:px-4 gap-2 h-[38px] md:h-11" style={{background:"#0a1410",borderBottom:"1px solid #1a2d1e"}}>
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <a href="/lobby" onClick={handleLeaveTable} className="text-[11px] md:text-sm transition-colors shrink-0 cursor-pointer whitespace-nowrap" style={{color:"#4b5563"}}
            onMouseEnter={e=>(e.currentTarget.style.color="#e5e7eb")}
            onMouseLeave={e=>(e.currentTarget.style.color="#4b5563")}>
            ← Lobby
          </a>
          <span className="hdr-title text-white font-bold text-xs md:text-sm truncate">{variantLabel}</span>
          <span className="text-zinc-500 text-xs hidden sm:inline">$1/$2 · Table #{TABLE_NUMBER}</span>
          <span className="text-xs px-2 py-0.5 rounded font-mono hidden md:inline" style={{background:"#1a2d1e",color:"#6b7280"}}>
            Hand #{game.handNum.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2 md:gap-4 text-xs shrink-0" style={{color:"#6b7280"}}>
          <span className="hidden sm:flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background:"#10b981"}} />
            {activePlayers.length}/5 active
          </span>
          <span style={{color:"#c9a227"}} className="font-bold whitespace-nowrap text-[11px] md:text-xs">
            Pot: <AnimatedAmount value={game.pot} />
          </span>
          <span className="hidden sm:inline uppercase" style={{fontSize:11}}>{game.street}</span>
          {realBalance !== null && (
            <span className="hidden sm:block text-xs font-bold px-2 py-0.5 rounded" style={{color:"#34d399",background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.2)"}}>
              ${realBalance.toLocaleString("en-US",{minimumFractionDigits:2})}
            </span>
          )}
          {isGuest && (
            <span className="hidden sm:block text-xs font-bold px-2 py-0.5 rounded" style={{color:"#f59e0b",background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.2)"}}>
              GUEST · Fake Chips
            </span>
          )}
          <button
            onClick={toggleMute}
            className="tip px-1.5 md:px-2 py-0.5 md:py-1 rounded transition-colors shrink-0 text-xs md:text-sm"
            data-tip={muted?"Unmute sounds":"Mute sounds"}
            style={{background:"#1a2d1e",color:muted?"#4b5563":"#34d399",border:"1px solid #2d4a3a"}}
            title={muted?"Unmute":"Mute"}>
            {muted?"🔇":"🔊"}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 flex flex-col overflow-hidden">

          {/* ── Table scene ── */}
          <div ref={tableAreaRef} className="table-area flex-1 relative overflow-hidden">
            <div className="absolute inset-0" style={{background:"radial-gradient(ellipse at 50% 60%,#0d1f11 0%,#060d08 100%)"}} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="table-scene relative" style={{width:SCENE_W,height:SCENE_H,transform:`scale(${tableScale})`}}>

                {/* Felt — gold rail, green bloom off the edge, woven overlay */}
                <div className="absolute felt-oval table-glow" style={{
                  background:"linear-gradient(155deg,#1a4a2a 0%,#0f3019 50%,#1a4a2a 100%)",
                  boxShadow:["0 0 0 3px #c9a227","0 0 0 7px #1e1200","0 40px 130px rgba(0,0,0,0.95)","inset 0 2px 6px rgba(255,200,50,0.08)"].join(",")}}>
                  <div className="absolute" style={{inset:10,borderRadius:"50%",background:"linear-gradient(155deg,#1c2a00,#162200,#1c2a00)"}}>
                    <div className="absolute felt-texture" style={{inset:16,borderRadius:"50%",background:"radial-gradient(ellipse at 45% 38%,#235f35 0%,#1a4a2a 52%,#0f3019 100%)",boxShadow:"inset 0 0 90px rgba(0,0,0,0.6),inset 0 0 30px rgba(0,0,0,0.35)"}}>
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                        <PotDisplay pot={game.pot} />
                        {game.sidePots.length>0&&(
                          <div className="flex gap-2 flex-wrap justify-center">
                            {game.sidePots.map((sp,i) => (
                              <span key={i} style={{background:"rgba(201,162,39,0.2)",color:"#fbbf24",fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:4,border:"1px solid rgba(201,162,39,0.3)"}}>
                                {i===0?"Main Pot":`Side Pot ${i}`}: ${sp.amount.toLocaleString()}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-2" style={{perspective:"600px"}}>
                          {game.community.map((card,i) => (
                            <CommunitySlot key={`${game.handNum}-${i}-${card!==null}`} card={card} label={communityLabels[i]} flipDelay={i*120} />
                          ))}
                        </div>
                        {game.phaseDelay&&(
                          <div style={{color:"rgba(255,255,255,0.35)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:2}}>
                            Next street…
                          </div>
                        )}
                        {!game.phaseDelay&&!game.banner&&(
                          <div style={{color:"rgba(255,255,255,0.2)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:2}}>
                            {game.street}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Opponent seats. Cards fly out from the middle of the felt,
                    one seat at a time, in the order a dealer would pitch them. */}
                {opponents.map((p,i) => (
                  <OpponentSeat
                    key={p.id} player={p} pos={SEAT_POS[i]}
                    showCards={isShowdown&&!p.folded}
                    isCurrentTurn={game.activeIdx===p.id&&!game.phaseDelay}
                    isWinner={game.winnerIds.includes(p.id)}
                    fly={SEAT_FLY[i]}
                    dealDelay={p.id*DEAL_STRIDE}
                    dealStride={5*DEAL_STRIDE}
                  />
                ))}

                {/* Gold burst when the hero takes it down */}
                {isShowdown&&isHeroWinner&&<WinBurst />}

                {/* Hero seat */}
                <div className="absolute flex flex-col items-center gap-1" style={{bottom:0,left:"50%",transform:"translateX(-50%)"}}>
                  {isHeroTurn&&(
                    <div className="animate-pulse" style={{background:"#10b981",color:"#000",fontWeight:900,fontSize:10,padding:"2px 10px",borderRadius:4,letterSpacing:1,boxShadow:"0 0 14px rgba(16,185,129,0.75)"}}>
                      YOUR TURN — {timeLeft}s
                    </div>
                  )}
                  <div className="flex items-center gap-2 rounded-full px-3 py-1.5" style={{
                    background:"rgba(0,0,0,0.78)",
                    border:isHeroWinner?"2px solid #c9a227":isHeroTurn?"2px solid #10b981":"1px solid rgba(245,158,11,0.35)",
                    backdropFilter:"blur(6px)",
                    boxShadow:isHeroWinner?"0 0 22px rgba(201,162,39,0.55)":isHeroTurn?"0 0 16px rgba(16,185,129,0.5)":undefined,
                  }}>
                    {(hero.isDealer||hero.isSB||hero.isBB)&&(
                      <div style={{display:"flex",gap:2,marginRight:2}}>
                        {hero.isDealer&&<span style={{background:"#c9a227",color:"#000",fontWeight:900,fontSize:8,padding:"1px 4px",borderRadius:3}}>D</span>}
                        {hero.isSB    &&<span style={{background:"#6b7280",color:"white",fontWeight:900,fontSize:8,padding:"1px 4px",borderRadius:3}}>SB</span>}
                        {hero.isBB    &&<span style={{background:"#374151",color:"white",fontWeight:900,fontSize:8,padding:"1px 4px",borderRadius:3}}>BB</span>}
                      </div>
                    )}
                    <span className="text-lg leading-none">{hero.avatar}</span>
                    <span style={{color:isHeroWinner?"#f59e0b":"#fbbf24",fontWeight:900,fontSize:12}}>You</span>
                    <span style={{color:"#374151",fontSize:11}}>·</span>
                    <AnimatedAmount value={hero.chips} style={{color:"#f3f4f6",fontWeight:700,fontSize:12}} />
                    {hero.streetBet>0&&<><span style={{color:"#374151",fontSize:11}}>·</span><span style={{color:"#fcd34d",fontSize:11}}>Bet ${hero.streetBet}</span></>}
                    {hero.folded&&<span style={{color:"#ef4444",fontSize:11,fontWeight:900}}>· FOLDED</span>}
                    {!hero.folded&&hero.isAllIn&&<span style={{color:"#ef4444",fontSize:11,fontWeight:900}}>· ALL IN</span>}
                    {isHeroWinner&&<span style={{color:"#f59e0b",fontSize:11,fontWeight:900}}>· WINNER!</span>}
                  </div>

                  {!hero.folded&&(hero.totalBet>0||hero.streetBet>0)&&(
                    <div className="flex items-center gap-3" style={{background:"rgba(0,0,0,0.7)",borderRadius:8,padding:"3px 10px",border:"1px solid rgba(245,158,11,0.2)"}}>
                      <div className="flex flex-col items-center">
                        <span style={{color:"#4b5563",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>Stack</span>
                        <span style={{color:"#f3f4f6",fontWeight:900,fontSize:12}}>${hero.chips.toLocaleString()}</span>
                      </div>
                      {hero.totalBet>0&&(
                        <div className="flex flex-col items-center">
                          <span style={{color:"#4b5563",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>In Pot</span>
                          <span style={{color:"#fcd34d",fontWeight:900,fontSize:12}}>${hero.totalBet.toLocaleString()}</span>
                        </div>
                      )}
                      {hero.streetBet>0&&(
                        <div className="flex flex-col items-center">
                          <span style={{color:"#4b5563",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>Your Bet</span>
                          <span style={{color:"#fbbf24",fontWeight:900,fontSize:12}}>${hero.streetBet.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {hero.streetBet>0&&!hero.folded&&(
                    <BetPill amount={hero.streetBet} suffix="to pot" />
                  )}
                </div>

                {/* Winner banner */}
                {game.banner&&(
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{zIndex:50}}>
                    <div style={{
                      background:isHeroWinner?"rgba(16,185,129,0.96)":"rgba(185,30,30,0.96)",
                      color:"white",fontWeight:900,fontSize:18,
                      padding:"16px 36px",borderRadius:16,
                      boxShadow:"0 8px 40px rgba(0,0,0,0.7)",
                      textShadow:"0 2px 8px rgba(0,0,0,0.4)",
                      maxWidth:560,textAlign:"center",lineHeight:1.5,
                      animation:"page-fade-in 0.3s ease-out",
                      opacity:bannerFading?0:1,
                      transition:"opacity 0.5s ease-out",
                    }}>
                      {game.banner}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>

          {/* ── Action bar ── */}
          <div className="shrink-0 px-3 md:px-6 py-3 md:py-4 action-bar-wrapper" style={{background:"rgba(6,13,8,0.97)",borderTop:"1px solid #1a2d1e"}}>

            {/* Hero cards + timer */}
            <div className="hero-hand-row flex items-end justify-center gap-4 md:gap-8 mb-3 md:mb-4">
              <div className="hero-hand-meta hero-meta-left flex flex-col items-end min-w-[90px] md:min-w-[110px]">
                <span className="hero-label" style={{color:"#4b5563",fontSize:11}}>Your hand</span>
                <span className="truncate-1" style={{color:"#34d399",fontWeight:700,fontSize:12,maxWidth:130}}>
                  {hero.cards.map(c => `${c.value}${c.suit}`).join(" ")}
                </span>
                {variant==="omaha"&&(
                  <span style={{color:"#6b7280",fontSize:10,marginTop:2}}>Pick 2 of 4</span>
                )}
              </div>

              {isHeroTurn&&(
                <div className="hero-timer">
                  <svg viewBox="0 0 56 56">
                    <circle cx="28" cy="28" r={timerRadius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4"/>
                    <circle cx="28" cy="28" r={timerRadius} fill="none" stroke={timerColor} strokeWidth="4"
                      strokeDasharray={`${timerDash} ${timerCirc}`}
                      strokeLinecap="round"
                      style={{transition:"stroke-dasharray 0.95s linear,stroke 0.3s"}}/>
                  </svg>
                  <div className="timer-count" style={{color:timerColor}}>{timeLeft}</div>
                </div>
              )}

              {/* Hero hole cards: pitched in from the felt, then flipped face
                  up in 3D once they land. */}
              <div className="hero-cards flex gap-1.5 md:gap-2 items-end">
                {hero.cards.map((c,i) => (
                  <div key={`${game.handNum}-${i}`} style={{
                    transform: hero.cards.length===2
                      ? (i===0?"rotate(-5deg) translateY(4px)":"rotate(5deg) translateY(4px)")
                      : (i<2?"rotate(-4deg) translateY(3px)":"rotate(3deg) translateY(3px)"),
                    transition:"transform 0.2s",
                  }}>
                    <Card
                      card={c}
                      size={hero.cards.length>2?"md":"lg"}
                      fly={HERO_FLY}
                      delay={i*5*DEAL_STRIDE}
                      reveal
                      isWinner={isHeroWinner&&isShowdown}
                      className={hero.folded?"card-fold":""}
                    />
                  </div>
                ))}
              </div>

              <div className="hero-hand-meta hero-meta-right flex flex-col items-start min-w-[70px] md:min-w-[80px]">
                <span className="hero-label" style={{color:"#4b5563",fontSize:11}}>Street</span>
                <span className="hero-street font-black" style={{fontSize:15,color:"#10b981",textTransform:"capitalize"}}>{game.street}</span>
                {game.currentBet>hero.streetBet&&!isShowdown&&(
                  <span style={{color:"#6b7280",fontSize:10,marginTop:2}}>To call: ${Math.min(game.currentBet-hero.streetBet,hero.chips)}</span>
                )}
              </div>
            </div>

            {/* Pot / current bet reminder */}
            {!isShowdown&&!hero.folded&&!hero.isAllIn&&(
              <div className="flex justify-center mb-2">
                <span style={{color:"#6b7280",fontSize:11,fontWeight:700}}>
                  Pot: <AnimatedAmount value={game.pot} style={{color:"#f59e0b",fontWeight:900}} />
                  {game.currentBet>0&&<> · Current bet: <span style={{color:"#fbbf24",fontWeight:900}}>${game.currentBet.toLocaleString()}</span></>}
                </span>
              </div>
            )}

            {/* Buttons */}
            {isShowdown ? (
              <div className="flex justify-center items-center gap-3">
                <span style={{color:"#4b5563",fontSize:13,fontWeight:700}}>
                  {bannerFading ? "Dealing…" : "Next hand in a moment…"}
                </span>
              </div>
            ) : hero.folded ? (
              <div className="flex justify-center">
                <span style={{color:"#4b5563",fontSize:13,fontWeight:700}}>Waiting for next hand…</span>
              </div>
            ) : hero.isAllIn ? (
              <div className="flex justify-center">
                <span style={{color:"#ef4444",fontSize:14,fontWeight:900}}>ALL IN — Waiting for showdown…</span>
              </div>
            ) : (
              <div className="flex items-stretch gap-2 md:gap-3 justify-center flex-wrap action-bar">

                <ActionButton tone="fold" onClick={heroFold} disabled={!isHeroTurn} tip="Discard your hand">
                  Fold
                </ActionButton>

                {isBetContext ? (
                  <ActionButton tone="check" onClick={heroCheck} disabled={!isHeroTurn} tip="Pass action without betting">
                    Check
                  </ActionButton>
                ) : (
                  <ActionButton tone="call" onClick={heroCall} disabled={!isHeroTurn} tip={`Match the current bet of $${game.currentBet}`}>
                    Call ${callAmt.toLocaleString()}
                  </ActionButton>
                )}

                {/* Bet / Raise + slider — collapses to one compact row on phones */}
                <div className="bet-controls flex items-center gap-2 md:gap-3 rounded-xl px-3 md:px-4 py-2" style={{background:"#0f1a12",border:"1px solid #2d4a3a"}}>
                  <div className="bet-readout min-w-[60px] md:min-w-[72px]">
                    <div className="bet-readout-label" style={{color:"#4b5563",fontSize:11}}>{isBetContext?"Bet":"Raise to"}</div>
                    <div className="bet-readout-value" style={{color:"#f59e0b",fontWeight:900,fontSize:15}}>${Math.min(raiseAmt,betRaiseMax).toLocaleString()}</div>
                  </div>
                  <input type="range"
                    min={betRaiseMin} max={betRaiseMax} step={1}
                    value={Math.max(betRaiseMin,Math.min(raiseAmt,betRaiseMax))}
                    onChange={e=>setRaiseAmt(Number(e.target.value))}
                    className="bet-slider w-20 md:w-32 cursor-pointer" style={{accentColor:"#f59e0b"}}/>
                  <div className="bet-quick flex flex-col gap-0.5">
                    {([
                      ["½P", Math.max(betRaiseMin,Math.round(game.pot*0.5/2)*2)],
                      ["Pot",Math.max(betRaiseMin,game.pot)],
                    ] as [string,number][]).map(([label,v])=>(
                      <button key={label}
                        onClick={()=>setRaiseAmt(Math.min(betRaiseMax,Math.max(betRaiseMin,v)))}
                        className="text-xs px-1.5 py-0.5 rounded transition-colors"
                        style={{color:"#6b7280",background:"transparent"}}
                        onMouseEnter={e=>{e.currentTarget.style.color="#f59e0b";}}
                        onMouseLeave={e=>{e.currentTarget.style.color="#6b7280";}}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <ActionButton tone="raise" onClick={heroBetRaise} disabled={!isHeroTurn}
                    tip={isBetContext?"Open the betting":"Raise the current bet"}>
                    {/* The amount is already shown in the readout to the left,
                        so drop it from the label on phones to save the row. */}
                    <span className="md:hidden">{isBetContext?"Bet":"Raise"}</span>
                    <span className="hidden md:inline">
                      {isBetContext?"Bet":"Raise to"} ${Math.max(betRaiseMin,Math.min(raiseAmt,betRaiseMax)).toLocaleString()}
                    </span>
                  </ActionButton>
                  <ActionButton tone="allin" onClick={heroAllIn} disabled={!isHeroTurn} compact
                    tip="Go all-in with all your chips">
                    All-in
                  </ActionButton>
                </div>

              </div>
            )}
          </div>
        </main>

        {/* ── Betting history ── */}
        <aside className="hidden lg:flex flex-col shrink-0" style={{width:190,background:"#0a1410",borderLeft:"1px solid #1a2d1e"}}>
          <div className="px-3 py-2.5 shrink-0" style={{borderBottom:"1px solid #1a2d1e"}}>
            <span style={{color:"#6b7280",fontSize:11,fontWeight:900,letterSpacing:1,textTransform:"uppercase"}}>Action Log</span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
            {game.actionLog.length===0
              ? <span style={{color:"#374151",fontSize:11}}>No actions yet</span>
              : game.actionLog.slice(-5).reverse().map((entry,i) => (
                  <div key={`${game.actionLog.length}-${i}`} style={{
                    color:i===0?"#d1d5db":"#6b7280",fontSize:11.5,lineHeight:1.4,
                    padding:"4px 0",borderBottom:i<4?"1px solid rgba(255,255,255,0.05)":"none",
                  }}>
                    {entry}
                  </div>
                ))}
          </div>
        </aside>

        {/* ── Live chat ── */}
        <ChatSidebar game={game} heroAvatar={hero.avatar} />
      </div>

      {/* Responsible gaming footer */}
      <div className="shrink-0 text-center py-1 text-xs" style={{background:"#030806",color:"#374151",borderTop:"1px solid #111"}}>
        18+ · Play Responsibly · GamCare · BeGambleAware
      </div>
    </div>
  );
}

// ─── Default Export (Suspense wrapper) ────────────────────────────────────────

export default function TablePage() {
  return (
    <Suspense fallback={
      <div style={{background:"#060d08",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
        <div className="spinner"/>
        <span style={{color:"#4b5563",fontSize:13}}>Loading table…</span>
      </div>
    }>
      <TableContent/>
    </Suspense>
  );
}
