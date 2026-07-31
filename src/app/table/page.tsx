"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ChatSidebar from "./ChatSidebar";

// ─── Types ────────────────────────────────────────────────────────────────────

type Suit = "♠" | "♥" | "♦" | "♣";
type GameVariant = "holdem" | "omaha";
interface CardData { value: string; suit: Suit; }
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

// ─── Sound System ─────────────────────────────────────────────────────────────

function makeSounds(mutedRef: React.MutableRefObject<boolean>) {
  let ctx: AudioContext|null = null;
  function getCtx(): AudioContext|null {
    if (typeof window==="undefined") return null;
    if (!ctx) {
      try { ctx = new (window.AudioContext||(window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext)(); }
      catch { return null; }
    }
    if (ctx.state==="suspended") ctx.resume().catch(()=>{});
    return ctx;
  }
  function beep(freq:number, dur:number, type:OscillatorType="sine", vol=0.22) {
    if (mutedRef.current) return;
    const c=getCtx(); if (!c) return;
    try {
      const osc=c.createOscillator(); const gain=c.createGain();
      osc.connect(gain); gain.connect(c.destination);
      osc.type=type; osc.frequency.value=freq;
      gain.gain.setValueAtTime(vol,c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+dur);
      osc.start(c.currentTime); osc.stop(c.currentTime+dur);
    } catch {}
  }
  return {
    deal() {
      if (mutedRef.current) return;
      const c=getCtx(); if (!c) return;
      try {
        const len=Math.floor(c.sampleRate*0.065);
        const buf=c.createBuffer(1,len,c.sampleRate);
        const d=buf.getChannelData(0);
        for (let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len)*0.4;
        const src=c.createBufferSource(); src.buffer=buf;
        const gain=c.createGain(); gain.gain.value=0.45;
        src.connect(gain); gain.connect(c.destination); src.start();
      } catch {}
    },
    chip()  { beep(850,0.055,"square",0.1); },
    win()   {
      if (mutedRef.current) return;
      [523,659,784,1047].forEach((f,i) => setTimeout(()=>beep(f,0.28,"sine",0.18),i*110));
    },
    fold()  { beep(140,0.16,"triangle",0.18); },
    timer() { beep(880,0.07,"square",0.09); },
  };
}

// ─── Card Component ────────────────────────────────────────────────────────────
// Uses pure CSS animations — no JS timer state.
// dealAnim: fly-in when hole cards are dealt (with optional per-card delay)
// flipAnim: rotateY reveal when community cards appear
// Neither flag: card renders immediately at full opacity (no animation)

function Card({ card, faceDown=false, size="md",
  dealAnim=false, dealDelay=0,
  flipAnim=false, flipDelay=0,
  isWinner=false,
}: {
  card?: CardData|null; faceDown?: boolean; size?: "sm"|"md"|"lg";
  dealAnim?: boolean; dealDelay?: number;
  flipAnim?: boolean; flipDelay?: number;
  isWinner?: boolean;
}) {
  const dims = {
    sm: {w:30,h:44,corner:9, suit:13,pad:2,r:4},
    md: {w:52,h:72,corner:12,suit:22,pad:4,r:6},
    lg: {w:84,h:118,corner:20,suit:46,pad:6,r:8},
  }[size];

  // CSS animation class — only applied when explicitly requested
  const animClass = dealAnim ? "card-deal" : flipAnim ? "card-flip" : "";
  const winnerClass = isWinner ? "card-winner" : "";

  const base: React.CSSProperties = {
    width:dims.w, height:dims.h, borderRadius:dims.r, flexShrink:0,
    ...(dealAnim && dealDelay > 0 ? { animationDelay:`${dealDelay}ms` } :
        flipAnim && flipDelay > 0 ? { animationDelay:`${flipDelay}ms` } : {}),
  };

  if (!card||faceDown) return (
    <div className={animClass} style={{
      ...base,
      background:"linear-gradient(155deg,#1e3a8a 0%,#1e40af 55%,#1e3a8a 100%)",
      border:"1.5px solid rgba(200,210,255,0.25)",
      display:"flex",alignItems:"center",justifyContent:"center",
      boxShadow:"0 2px 8px rgba(0,0,0,0.5)",
      backgroundImage:"repeating-linear-gradient(45deg,rgba(255,255,255,0.04) 0,rgba(255,255,255,0.04) 2px,transparent 0,transparent 50%)",
      backgroundSize:"8px 8px",
    }}>
      <span style={{color:"rgba(200,220,255,0.22)",fontSize:dims.corner-1,fontWeight:900}}>PS</span>
    </div>
  );

  const isRed = card.suit==="♥"||card.suit==="♦";
  const col = isRed?"#dc2626":"#111827";

  return (
    <div
      className={[animClass, winnerClass].filter(Boolean).join(" ")}
      style={{
        ...base,
        background:"white", padding:dims.pad,
        border:isWinner?"2px solid #c9a227":"1px solid #e5e7eb",
        boxShadow:isWinner
          ?"0 4px 12px rgba(0,0,0,0.5),0 0 20px rgba(201,162,39,0.5)"
          :"0 4px 12px rgba(0,0,0,0.5)",
        display:"flex",flexDirection:"column",justifyContent:"space-between",
      }}
    >
      <span style={{fontSize:dims.corner,fontWeight:900,lineHeight:1,color:col}}>{card.value}</span>
      <span style={{fontSize:dims.suit,textAlign:"center",lineHeight:1,color:col,display:"block"}}>{card.suit}</span>
      <span style={{fontSize:dims.corner,fontWeight:900,lineHeight:1,color:col,transform:"rotate(180deg)",alignSelf:"flex-end",display:"block"}}>{card.value}</span>
    </div>
  );
}

// CommunitySlot: key must include whether card is present so React unmounts
// the placeholder and mounts a fresh Card (triggering the flip CSS animation).
function CommunitySlot({ card, label, flipDelay=0 }: { card:CardData|null; label:string; flipDelay?:number }) {
  if (!card) return (
    <div style={{width:52,height:72,borderRadius:6,flexShrink:0,border:"2px dashed rgba(255,255,255,0.1)",background:"rgba(0,0,0,0.18)",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{color:"rgba(255,255,255,0.2)",fontSize:9,fontWeight:700}}>{label}</span>
    </div>
  );
  return <Card card={card} size="md" flipAnim flipDelay={flipDelay} />;
}

// ─── OpponentSeat ─────────────────────────────────────────────────────────────

const SEAT_POS: React.CSSProperties[] = [
  { right:60, bottom:18 },
  { right:95, top:10 },
  { left:95,  top:10 },
  { left:70,  bottom:18 },
];

function OpponentSeat({ player, pos, showCards, isCurrentTurn, isWinner }: {
  player:PlayerState; pos:React.CSSProperties;
  showCards:boolean; isCurrentTurn:boolean; isWinner:boolean;
}) {
  const { folded } = player;
  const actionLabel: Record<Action,string> = {
    waiting:"",fold:"FOLDED",call:"CALL",check:"CHECK",raise:"RAISE",bet:"BET",allin:"ALL IN",
  };
  const borderCol = isWinner?"#c9a227":isCurrentTurn?"#f59e0b":folded?"#2d3748":"#4b5563";
  const glow = isWinner
    ? "0 0 0 3px rgba(201,162,39,0.55),0 0 24px rgba(201,162,39,0.45)"
    : isCurrentTurn?"0 0 0 3px rgba(245,158,11,0.5),0 0 20px rgba(245,158,11,0.4)":undefined;

  return (
    <div className={`absolute flex flex-col items-center gap-1 ${isWinner?"winner-seat":""}`} style={{...pos,zIndex:20}}>
      {isCurrentTurn&&!folded&&(
        <div className="animate-pulse" style={{background:"#f59e0b",color:"#000",fontWeight:900,fontSize:9,padding:"2px 8px",borderRadius:4,letterSpacing:1,boxShadow:"0 0 10px rgba(245,158,11,0.6)"}}>
          THINKING…
        </div>
      )}
      {isWinner&&<div style={{background:"#c9a227",color:"#000",fontWeight:900,fontSize:9,padding:"2px 7px",borderRadius:4,letterSpacing:1}}>WINNER!</div>}

      <div style={{position:"relative",width:60,height:60}}>
        <div style={{
          position:"absolute",inset:0,borderRadius:"50%",
          background:folded?"#1f2937":"linear-gradient(145deg,#374151,#4b5563)",
          border:`3px solid ${borderCol}`,boxShadow:glow,opacity:folded?0.42:1,
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:24,overflow:"hidden",transition:"border-color 0.3s,box-shadow 0.3s",
        }}>
          {player.avatar}
          {folded&&(
            <div style={{position:"absolute",inset:0,borderRadius:"50%",background:"rgba(0,0,0,0.65)",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontSize:9,fontWeight:900,color:"#9ca3af",letterSpacing:1}}>FOLDED</span>
            </div>
          )}
        </div>
        {(player.isDealer||player.isSB||player.isBB)&&(
          <div style={{position:"absolute",bottom:-4,right:-4,display:"flex",gap:2}}>
            {player.isDealer&&<span style={{background:"#c9a227",color:"#000",fontWeight:900,fontSize:8,padding:"1px 4px",borderRadius:3}}>D</span>}
            {player.isSB   &&<span style={{background:"#6b7280",color:"white",fontWeight:900,fontSize:8,padding:"1px 4px",borderRadius:3}}>SB</span>}
            {player.isBB   &&<span style={{background:"#374151",color:"white",fontWeight:900,fontSize:8,padding:"1px 4px",borderRadius:3}}>BB</span>}
          </div>
        )}
      </div>

      <div style={{
        background:isWinner?"rgba(201,162,39,0.18)":"rgba(0,0,0,0.82)",backdropFilter:"blur(8px)",
        border:`1px solid ${isWinner?"rgba(201,162,39,0.5)":isCurrentTurn?"rgba(245,158,11,0.3)":"rgba(255,255,255,0.05)"}`,
        borderRadius:8,padding:"4px 8px",
        display:"flex",flexDirection:"column",alignItems:"center",
        opacity:folded?0.45:1,transition:"all 0.3s",
      }}>
        <span style={{color:isWinner?"#f59e0b":"white",fontWeight:700,fontSize:11,whiteSpace:"nowrap"}}>{player.name}</span>
        <span style={{color:"#fbbf24",fontWeight:900,fontSize:11}}>${player.chips.toLocaleString()}</span>
        {player.isAllIn&&!folded&&<span style={{color:"#ef4444",fontSize:10,fontWeight:900}}>ALL IN</span>}
        {!player.isAllIn&&player.action!=="waiting"&&!folded&&(
          <span style={{color:player.action==="fold"?"#6b7280":"#34d399",fontSize:10,fontWeight:700}}>
            {actionLabel[player.action]}
          </span>
        )}
      </div>

      {!folded&&(
        <div style={{display:"flex",gap:2,flexWrap:"wrap",justifyContent:"center",maxWidth:player.cards.length>2?72:64}}>
          {player.cards.map((c,i) => (
            <div key={i} className={folded?"card-fold":""}>
              <Card
                card={showCards?c:null}
                faceDown={!showCards}
                size="sm"
                isWinner={isWinner&&showCards}
              />
            </div>
          ))}
        </div>
      )}
      {player.streetBet>0&&!folded&&(
        <div className="chip-slide" style={{display:"flex",alignItems:"center",gap:5,marginTop:2,background:"rgba(0,0,0,0.55)",borderRadius:20,padding:"2px 8px 2px 3px",border:"1px solid rgba(245,158,11,0.3)"}}>
          <div style={{position:"relative",width:20,height:14,flexShrink:0}}>
            <div style={{position:"absolute",left:0,width:13,height:13,borderRadius:"50%",background:"radial-gradient(circle at 35% 30%,#fde68a,#f59e0b 60%,#b45309)",border:"1.5px solid #fde68a",boxShadow:"0 1px 2px rgba(0,0,0,0.6)"}}/>
            <div style={{position:"absolute",left:6,width:13,height:13,borderRadius:"50%",background:"radial-gradient(circle at 35% 30%,#fde68a,#f59e0b 60%,#b45309)",border:"1.5px solid #fde68a",boxShadow:"0 1px 2px rgba(0,0,0,0.6)"}}/>
          </div>
          <span style={{color:"#fcd34d",fontSize:12,fontWeight:900}}>${player.streetBet.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

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

  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const sounds = useRef(makeSounds(mutedRef));

  const [game, setGame] = useState<GameState>(() => buildInitialState(1,undefined,variant));
  const [raiseAmt, setRaiseAmt] = useState(4);
  const [dealTick, setDealTick] = useState(0);
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

  // Deal sound on new hand
  useEffect(() => {
    setDealTick(t => t+1);
    for (let i=0;i<10;i++) setTimeout(()=>sounds.current.deal(), i*180+50);
  }, [game.handNum]);

  // Track hero's chip count at the start of each hand (post-blinds)
  useEffect(() => {
    heroChipsAtHandStartRef.current = game.players[0].chips;
  }, [game.handNum]);

  // Sound on action + report win/loss to wallet
  const prevStreet = useRef<Street>("preflop");
  useEffect(() => {
    if (game.street!==prevStreet.current) {
      prevStreet.current = game.street;
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
        if (prev===8) sounds.current.timer();
        if (prev<=1) { foldRef.current(); return 30; }
        return prev-1;
      });
    },1000);
    return ()=>{ if (timerRef.current) clearInterval(timerRef.current); };
  },[isHeroTurn, game.activeIdx, game.handNum]);

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
    sounds.current.chip();
    setGame(prev=>processAction(prev,0,a,amt));
  }
  function heroAllIn() {
    if (!isHeroTurn) return;
    const amt = hero.chips+hero.streetBet;
    const a: "bet"|"raise" = game.currentBet===0?"bet":"raise";
    sounds.current.chip();
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
    <div className="h-screen text-white flex flex-col overflow-hidden" style={{background:"#060d08",userSelect:"none"}}>

      {/* ── Header ── */}
      <header className="flex items-center justify-between shrink-0 px-3 md:px-4" style={{height:44,background:"#0a1410",borderBottom:"1px solid #1a2d1e"}}>
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <a href="/lobby" onClick={handleLeaveTable} className="text-sm transition-colors shrink-0 cursor-pointer" style={{color:"#4b5563"}}
            onMouseEnter={e=>(e.currentTarget.style.color="#e5e7eb")}
            onMouseLeave={e=>(e.currentTarget.style.color="#4b5563")}>
            ← Lobby
          </a>
          <span className="text-white font-bold text-sm truncate">{variantLabel}</span>
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
          <span style={{color:"#c9a227"}} className="font-bold">Pot: ${game.pot.toLocaleString()}</span>
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
            onClick={()=>setMuted(m=>!m)}
            className="tip px-2 py-1 rounded transition-colors"
            data-tip={muted?"Unmute sounds":"Mute sounds"}
            style={{background:"#1a2d1e",color:muted?"#4b5563":"#34d399",fontSize:14,border:"1px solid #2d4a3a"}}
            title={muted?"Unmute":"Mute"}>
            {muted?"🔇":"🔊"}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 flex flex-col overflow-hidden">

          {/* ── Table scene ── */}
          <div className="flex-1 relative overflow-hidden">
            <div className="absolute inset-0" style={{background:"radial-gradient(ellipse at 50% 60%,#0d1f11 0%,#060d08 100%)"}} />
            <div className="absolute inset-0 flex items-start justify-center pt-1 md:items-center md:pt-0">
              <div className="table-scene relative" style={{width:800,height:440}}>

                {/* Felt */}
                <div className="absolute" style={{left:70,top:55,width:660,height:330,borderRadius:"50%",
                  background:"linear-gradient(155deg,#1a4a2a 0%,#0f3019 50%,#1a4a2a 100%)",
                  boxShadow:["0 0 0 3px #c9a227","0 0 0 7px #1e1200","0 40px 130px rgba(0,0,0,0.95)","inset 0 2px 6px rgba(255,200,50,0.08)"].join(",")}}>
                  <div className="absolute" style={{inset:10,borderRadius:"50%",background:"linear-gradient(155deg,#1c2a00,#162200,#1c2a00)"}}>
                    <div className="absolute" style={{inset:16,borderRadius:"50%",background:"radial-gradient(ellipse at 45% 38%,#235f35 0%,#1a4a2a 52%,#0f3019 100%)",boxShadow:"inset 0 0 90px rgba(0,0,0,0.6),inset 0 0 30px rgba(0,0,0,0.35)"}}>
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                        <span className="font-black tracking-wide" style={{color:"#f59e0b",fontSize:24,textShadow:"0 2px 10px rgba(0,0,0,0.7)"}}>
                          Pot: ${game.pot.toLocaleString()}
                        </span>
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

                {/* Opponent seats */}
                {opponents.map((p,i) => (
                  <OpponentSeat
                    key={p.id} player={p} pos={SEAT_POS[i]}
                    showCards={isShowdown&&!p.folded}
                    isCurrentTurn={game.activeIdx===p.id&&!game.phaseDelay}
                    isWinner={game.winnerIds.includes(p.id)}
                  />
                ))}

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
                    <span style={{color:"#f3f4f6",fontWeight:700,fontSize:12}}>${hero.chips.toLocaleString()}</span>
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
                    <div className="chip-slide" style={{display:"flex",alignItems:"center",gap:5,background:"rgba(0,0,0,0.55)",borderRadius:20,padding:"2px 8px 2px 3px",border:"1px solid rgba(245,158,11,0.3)"}}>
                      <div style={{position:"relative",width:20,height:14,flexShrink:0}}>
                        <div style={{position:"absolute",left:0,width:13,height:13,borderRadius:"50%",background:"radial-gradient(circle at 35% 30%,#fde68a,#f59e0b 60%,#b45309)",border:"1.5px solid #fde68a",boxShadow:"0 1px 2px rgba(0,0,0,0.6)"}}/>
                        <div style={{position:"absolute",left:6,width:13,height:13,borderRadius:"50%",background:"radial-gradient(circle at 35% 30%,#fde68a,#f59e0b 60%,#b45309)",border:"1.5px solid #fde68a",boxShadow:"0 1px 2px rgba(0,0,0,0.6)"}}/>
                      </div>
                      <span style={{color:"#fcd34d",fontSize:12,fontWeight:900}}>${hero.streetBet.toLocaleString()} to pot</span>
                    </div>
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
            <div className="flex items-end justify-center gap-4 md:gap-8 mb-3 md:mb-4">
              <div className="flex flex-col items-end min-w-[90px] md:min-w-[110px]">
                <span style={{color:"#4b5563",fontSize:11}}>Your hand</span>
                <span style={{color:"#34d399",fontWeight:700,fontSize:12}}>
                  {hero.cards.map(c => `${c.value}${c.suit}`).join(" ")}
                </span>
                {variant==="omaha"&&(
                  <span style={{color:"#6b7280",fontSize:10,marginTop:2}}>Pick 2 of 4</span>
                )}
              </div>

              {isHeroTurn&&(
                <div style={{position:"relative",width:56,height:56,flexShrink:0}}>
                  <svg width="56" height="56" style={{position:"absolute",top:0,left:0,transform:"rotate(-90deg)"}}>
                    <circle cx="28" cy="28" r={timerRadius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4"/>
                    <circle cx="28" cy="28" r={timerRadius} fill="none" stroke={timerColor} strokeWidth="4"
                      strokeDasharray={`${timerDash} ${timerCirc}`}
                      strokeLinecap="round"
                      style={{transition:"stroke-dasharray 0.95s linear,stroke 0.3s"}}/>
                  </svg>
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <span style={{color:timerColor,fontWeight:900,fontSize:16}}>{timeLeft}</span>
                  </div>
                </div>
              )}

              <div className="flex gap-1.5 md:gap-2 items-end">
                {hero.cards.map((c,i) => (
                  <div key={`${game.handNum}-${i}`} style={{
                    transform: hero.cards.length===2
                      ? (i===0?"rotate(-5deg) translateY(4px)":"rotate(5deg) translateY(4px)")
                      : (i<2?"rotate(-4deg) translateY(3px)":"rotate(3deg) translateY(3px)"),
                    transition:"transform 0.2s",
                  }}>
                    <Card card={c} size={hero.cards.length>2?"md":"lg"} dealAnim dealDelay={i*120} isWinner={isHeroWinner&&isShowdown} />
                  </div>
                ))}
              </div>

              <div className="flex flex-col items-start min-w-[70px] md:min-w-[80px]">
                <span style={{color:"#4b5563",fontSize:11}}>Street</span>
                <span className="font-black" style={{fontSize:15,color:"#10b981",textTransform:"capitalize"}}>{game.street}</span>
                {game.currentBet>hero.streetBet&&!isShowdown&&(
                  <span style={{color:"#6b7280",fontSize:10,marginTop:2}}>To call: ${Math.min(game.currentBet-hero.streetBet,hero.chips)}</span>
                )}
              </div>
            </div>

            {/* Pot / current bet reminder */}
            {!isShowdown&&!hero.folded&&!hero.isAllIn&&(
              <div className="flex justify-center mb-2">
                <span style={{color:"#6b7280",fontSize:11,fontWeight:700}}>
                  Pot: <span style={{color:"#f59e0b",fontWeight:900}}>${game.pot.toLocaleString()}</span>
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

                {/* Fold */}
                <button onClick={heroFold} disabled={!isHeroTurn}
                  className="tip font-black rounded-xl text-sm px-6 md:px-8 py-2.5 md:py-3 transition-all disabled:opacity-40 action-btn"
                  data-tip="Discard your hand"
                  style={{background:"#7f1d1d",color:"#fecaca",boxShadow:"0 4px 14px rgba(127,29,29,0.45)"}}
                  onMouseEnter={e=>{if(isHeroTurn){e.currentTarget.style.background="#991b1b";e.currentTarget.style.transform="translateY(-1px)";}}}
                  onMouseLeave={e=>{e.currentTarget.style.background="#7f1d1d";e.currentTarget.style.transform="";}}>
                  Fold
                </button>

                {/* Check or Call */}
                {isBetContext ? (
                  <button onClick={heroCheck} disabled={!isHeroTurn}
                    className="tip font-black rounded-xl text-sm px-6 md:px-8 py-2.5 md:py-3 transition-all disabled:opacity-40 action-btn"
                    data-tip="Pass action without betting"
                    style={{background:"#1f2937",color:"#d1d5db",boxShadow:"0 4px 12px rgba(0,0,0,0.4)"}}
                    onMouseEnter={e=>{if(isHeroTurn){e.currentTarget.style.background="#374151";e.currentTarget.style.transform="translateY(-1px)";}}}
                    onMouseLeave={e=>{e.currentTarget.style.background="#1f2937";e.currentTarget.style.transform="";}}>
                    Check
                  </button>
                ) : (
                  <button onClick={heroCall} disabled={!isHeroTurn}
                    className="tip font-black rounded-xl text-sm px-6 md:px-8 py-2.5 md:py-3 transition-all disabled:opacity-40 action-btn"
                    data-tip={`Match the current bet of $${game.currentBet}`}
                    style={{background:"#14532d",color:"#bbf7d0",boxShadow:"0 4px 14px rgba(20,83,45,0.45)"}}
                    onMouseEnter={e=>{if(isHeroTurn){e.currentTarget.style.background="#166534";e.currentTarget.style.transform="translateY(-1px)";}}}
                    onMouseLeave={e=>{e.currentTarget.style.background="#14532d";e.currentTarget.style.transform="";}}>
                    Call ${callAmt.toLocaleString()}
                  </button>
                )}

                {/* Bet / Raise + slider */}
                <div className="flex items-center gap-2 md:gap-3 rounded-xl px-3 md:px-4 py-2" style={{background:"#0f1a12",border:"1px solid #2d4a3a"}}>
                  <div className="min-w-[60px] md:min-w-[72px]">
                    <div style={{color:"#4b5563",fontSize:11}}>{isBetContext?"Bet":"Raise to"}</div>
                    <div style={{color:"#f59e0b",fontWeight:900,fontSize:15}}>${Math.min(raiseAmt,betRaiseMax).toLocaleString()}</div>
                  </div>
                  <input type="range"
                    min={betRaiseMin} max={betRaiseMax} step={1}
                    value={Math.max(betRaiseMin,Math.min(raiseAmt,betRaiseMax))}
                    onChange={e=>setRaiseAmt(Number(e.target.value))}
                    className="w-20 md:w-32 cursor-pointer" style={{accentColor:"#f59e0b"}}/>
                  <div className="flex flex-col gap-0.5">
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
                  <button onClick={heroBetRaise} disabled={!isHeroTurn}
                    className="tip font-black rounded-xl text-sm px-4 md:px-5 py-2 md:py-2.5 whitespace-nowrap transition-all disabled:opacity-40 action-btn"
                    data-tip={isBetContext?"Open the betting":"Raise the current bet"}
                    style={{background:"#b45309",color:"#fef3c7",boxShadow:"0 4px 14px rgba(180,83,9,0.45)"}}
                    onMouseEnter={e=>{if(isHeroTurn){e.currentTarget.style.background="#d97706";e.currentTarget.style.transform="translateY(-1px)";}}}
                    onMouseLeave={e=>{e.currentTarget.style.background="#b45309";e.currentTarget.style.transform="";}}>
                    {isBetContext?"Bet":"Raise to"} ${Math.max(betRaiseMin,Math.min(raiseAmt,betRaiseMax)).toLocaleString()}
                  </button>
                  <button onClick={heroAllIn} disabled={!isHeroTurn}
                    className="tip font-black rounded-xl text-xs px-3 py-2 whitespace-nowrap transition-all disabled:opacity-40"
                    data-tip="Go all-in with all your chips"
                    style={{background:"#450a0a",color:"#fca5a5",border:"1px solid #7f1d1d"}}
                    onMouseEnter={e=>{if(isHeroTurn){e.currentTarget.style.background="#7f1d1d";}}}
                    onMouseLeave={e=>{e.currentTarget.style.background="#450a0a";}}>
                    All-in
                  </button>
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
