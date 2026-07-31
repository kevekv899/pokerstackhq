"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Navbar from "../components/Navbar";

type GameType = "Texas Hold'em" | "Omaha" | "Sit & Go";

interface TableData {
  id: number;
  name: string;
  game: GameType;
  variant: "holdem" | "omaha" | "sitgo";
  stakes: string;
  stakesNum: number;
  seats: number;
  maxSeats: number;
  avgPot: string;
  avgPotNum: number;
  handsPH: number;
  status: "active" | "waiting";
  preview: string[];
}

const BASE_TABLES: TableData[] = [
  { id:1,  name:"Emerald High",      game:"Texas Hold'em", variant:"holdem", stakes:"$1/$2",        stakesNum:2,     seats:4, maxSeats:9, avgPot:"$45",     avgPotNum:45,    handsPH:72, status:"active",  preview:["A♠","K♥","7♦"] },
  { id:2,  name:"Diamond Room",      game:"Texas Hold'em", variant:"holdem", stakes:"$2/$5",        stakesNum:5,     seats:7, maxSeats:9, avgPot:"$120",    avgPotNum:120,   handsPH:68, status:"active",  preview:["Q♣","Q♥","3♠"] },
  { id:3,  name:"Platinum Club",     game:"Texas Hold'em", variant:"holdem", stakes:"$5/$10",       stakesNum:10,    seats:6, maxSeats:9, avgPot:"$280",    avgPotNum:280,   handsPH:65, status:"active",  preview:["J♦","10♣","2♥"] },
  { id:4,  name:"Gold Rush",         game:"Texas Hold'em", variant:"holdem", stakes:"$0.25/$0.50",  stakesNum:0.5,   seats:2, maxSeats:9, avgPot:"$12",     avgPotNum:12,    handsPH:80, status:"active",  preview:["8♠","8♦","K♣"] },
  { id:5,  name:"Micro Grind",       game:"Texas Hold'em", variant:"holdem", stakes:"$0.01/$0.02",  stakesNum:0.02,  seats:8, maxSeats:9, avgPot:"$0.80",   avgPotNum:0.8,   handsPH:88, status:"active",  preview:["5♥","4♦","9♠"] },
  { id:6,  name:"Omaha Fury",        game:"Omaha",          variant:"omaha",  stakes:"$1/$2",        stakesNum:2,     seats:5, maxSeats:9, avgPot:"$95",     avgPotNum:95,    handsPH:60, status:"active",  preview:["A♦","K♠","Q♥"] },
  { id:7,  name:"PLO Madness",       game:"Omaha",          variant:"omaha",  stakes:"$2/$5",        stakesNum:5,     seats:3, maxSeats:9, avgPot:"$220",    avgPotNum:220,   handsPH:55, status:"active",  preview:["9♣","8♦","7♠"] },
  { id:8,  name:"Omaha Express",     game:"Omaha",          variant:"omaha",  stakes:"$0.50/$1",     stakesNum:1,     seats:6, maxSeats:9, avgPot:"$38",     avgPotNum:38,    handsPH:62, status:"active",  preview:["J♠","J♣","4♥"] },
  { id:9,  name:"High Roller",       game:"Texas Hold'em", variant:"holdem", stakes:"$25/$50",      stakesNum:50,    seats:4, maxSeats:6, avgPot:"$1,400",  avgPotNum:1400,  handsPH:48, status:"active",  preview:["A♣","A♥","K♦"] },
  { id:10, name:"Beginner's Den",    game:"Texas Hold'em", variant:"holdem", stakes:"$0.01/$0.02",  stakesNum:0.02,  seats:1, maxSeats:9, avgPot:"$0.60",   avgPotNum:0.6,   handsPH:90, status:"waiting", preview:[] },
  { id:11, name:"Weekend Warriors",  game:"Omaha",          variant:"omaha",  stakes:"$0.25/$0.50",  stakesNum:0.5,   seats:0, maxSeats:6, avgPot:"$22",     avgPotNum:22,    handsPH:0,  status:"waiting", preview:[] },
  { id:12, name:"Nightly Grind",     game:"Texas Hold'em", variant:"holdem", stakes:"$0.50/$1",     stakesNum:1,     seats:5, maxSeats:9, avgPot:"$28",     avgPotNum:28,    handsPH:75, status:"active",  preview:["6♦","5♣","3♥"] },
];

type FilterType = "All" | "Hold'em" | "Omaha" | "Tournaments";
type SortType = "Stakes" | "Players" | "Pot Size";

function SeatBar({ seats, max }: { seats:number; max:number }) {
  const pct=(seats/max)*100;
  const color = pct>80?"#ef4444":pct>50?"#f59e0b":"#10b981";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{width:`${pct}%`,background:color}}/>
      </div>
      <span className="text-xs tabular-nums text-zinc-400 w-8 text-right">{seats}/{max}</span>
    </div>
  );
}

function TablePreview({ cards }: { cards:string[] }) {
  const suits: Record<string,string> = {"♠":"#1e40af","♥":"#dc2626","♦":"#dc2626","♣":"#1e40af"};
  if (cards.length===0) return (
    <div className="flex gap-1 mt-2">
      {[0,1,2].map(i=>(
        <div key={i} style={{width:28,height:38,borderRadius:3,background:"rgba(0,0,0,0.3)",border:"1px dashed rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <span style={{fontSize:7,color:"rgba(255,255,255,0.15)"}}>?</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="flex gap-1 mt-2">
      {cards.map((c,i)=>{
        const suit=c.slice(-1); const val=c.slice(0,-1);
        const col=suits[suit]??"#1e40af";
        return (
          <div key={i} style={{width:28,height:38,borderRadius:3,background:"white",border:"1px solid #e5e7eb",display:"flex",flexDirection:"column",justifyContent:"space-between",padding:2,boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}>
            <span style={{fontSize:7,fontWeight:900,color:col,lineHeight:1}}>{val}</span>
            <span style={{fontSize:10,textAlign:"center",color:col,lineHeight:1}}>{suit}</span>
          </div>
        );
      })}
      <div style={{width:28,height:38,borderRadius:3,background:"rgba(0,0,0,0.2)",border:"1px dashed rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <span style={{fontSize:7,color:"rgba(255,255,255,0.2)"}}>TURN</span>
      </div>
      <div style={{width:28,height:38,borderRadius:3,background:"rgba(0,0,0,0.2)",border:"1px dashed rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <span style={{fontSize:7,color:"rgba(255,255,255,0.2)"}}>RIV</span>
      </div>
    </div>
  );
}

function LobbyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramFilter = searchParams.get("filter");
  const initialFilter: FilterType =
    paramFilter === "omaha" ? "Omaha" :
    paramFilter === "holdem" ? "Hold'em" :
    paramFilter === "tournaments" ? "Tournaments" : "All";
  const [activeFilter, setActiveFilter] = useState<FilterType>(initialFilter);
  const [sortBy, setSortBy] = useState<SortType>("Stakes");
  const [search, setSearch] = useState("");
  const [playerCounts, setPlayerCounts] = useState<Record<number,number>>(
    Object.fromEntries(BASE_TABLES.map(t=>[t.id,t.seats]))
  );
  const [hoveredTable, setHoveredTable] = useState<number|null>(null);
  const [quickSeating, setQuickSeating] = useState(false);

  // Live player count simulation (every 5 seconds)
  useEffect(()=>{
    const id = setInterval(()=>{
      setPlayerCounts(prev=>{
        const next={...prev};
        for (const t of BASE_TABLES) {
          if (t.status==="active") {
            const delta = Math.floor(Math.random()*3)-1; // -1, 0, or +1
            next[t.id] = Math.max(0, Math.min(t.maxSeats-1, (next[t.id]??t.seats)+delta));
          }
        }
        return next;
      });
    },5000);
    return ()=>clearInterval(id);
  },[]);

  const tables = BASE_TABLES.map(t=>({...t,seats:playerCounts[t.id]??t.seats}));

  const filtered = tables.filter(t=>{
    const matchFilter =
      activeFilter==="All" ? true :
      activeFilter==="Hold'em" ? t.variant==="holdem" :
      activeFilter==="Omaha" ? t.variant==="omaha" :
      activeFilter==="Tournaments" ? t.variant==="sitgo" : true;
    const matchSearch = search===""||t.name.toLowerCase().includes(search.toLowerCase())||t.stakes.includes(search);
    return matchFilter&&matchSearch;
  });

  const sorted = [...filtered].sort((a,b)=>{
    if (sortBy==="Stakes") return b.stakesNum-a.stakesNum;
    if (sortBy==="Players") return b.seats-a.seats;
    if (sortBy==="Pot Size") return b.avgPotNum-a.avgPotNum;
    return 0;
  });

  const quickSeat = useCallback(()=>{
    setQuickSeating(true);
    // Find best table: active, not full, most players
    const best = tables
      .filter(t=>t.status==="active"&&t.seats<t.maxSeats)
      .sort((a,b)=>b.seats-a.seats)[0];
    if (best) {
      setTimeout(()=>{
        router.push(best.variant==="omaha" ? "/table/omaha" : "/table");
      },800);
    } else {
      setQuickSeating(false);
    }
  },[tables,router]);

  const filterOptions: FilterType[] = ["All","Hold'em","Omaha","Tournaments"];
  const sortOptions: SortType[] = ["Stakes","Players","Pot Size"];

  const totalPlayers = Object.values(playerCounts).reduce((a,b)=>a+b,0);

  return (
    <div className="min-h-screen bg-zinc-950 text-white page-enter">
      <Navbar/>

      <main className="pt-16">
        {/* Page Header */}
        <div className="bg-gradient-to-b from-emerald-950/60 to-zinc-950 border-b border-emerald-900/30 py-10 px-4">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <p className="text-emerald-400 text-sm font-semibold uppercase tracking-widest mb-2">Cash Games</p>
                <h1 className="text-3xl md:text-4xl font-black">Game Lobby</h1>
                <p className="text-zinc-400 mt-2 text-sm flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse inline-block"/>
                  <span className="text-white font-semibold tabular-nums">{totalPlayers.toLocaleString()}</span> players at tables ·{" "}
                  <span className="text-white font-semibold">{tables.filter(t=>t.status==="active").length}</span> active tables
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={quickSeat}
                  disabled={quickSeating}
                  className="inline-flex items-center gap-2 font-bold text-sm px-5 py-2.5 rounded-full transition-all duration-150 disabled:opacity-60"
                  style={{background:"#c9a227",color:"#000",boxShadow:"0 4px 16px rgba(201,162,39,0.35)"}}
                  onMouseEnter={e=>{if(!quickSeating){e.currentTarget.style.background="#f59e0b";e.currentTarget.style.transform="scale(1.04)";}}}
                  onMouseLeave={e=>{e.currentTarget.style.background="#c9a227";e.currentTarget.style.transform="";}}>
                  {quickSeating ? (
                    <><span className="inline-block w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin"/>Finding seat…</>
                  ) : "⚡ Quick Seat"}
                </button>
                <Link
                  href="/tournaments"
                  className="inline-flex items-center gap-2 border border-amber-700/60 text-amber-400 hover:bg-amber-900/20 text-sm font-semibold px-5 py-2.5 rounded-full transition-colors duration-150">
                  🏆 Tournaments
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-8">

          {/* Filter + Sort + Search row */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
              {filterOptions.map(f=>(
                <button
                  key={f}
                  onClick={()=>setActiveFilter(f)}
                  className="px-4 py-2 rounded-full text-sm font-semibold transition-all duration-150"
                  style={activeFilter===f
                    ? {background:"#c9a227",color:"#000",boxShadow:"0 2px 10px rgba(201,162,39,0.3)"}
                    : {background:"#27272a",color:"#a1a1aa"}}
                  onMouseEnter={e=>{if(activeFilter!==f){e.currentTarget.style.background="#3f3f46";e.currentTarget.style.color="#f4f4f5";}}}
                  onMouseLeave={e=>{if(activeFilter!==f){e.currentTarget.style.background="#27272a";e.currentTarget.style.color="#a1a1aa";}}}>
                  {f}
                </button>
              ))}
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2 ml-0 sm:ml-auto">
              <span className="text-zinc-500 text-xs font-semibold uppercase tracking-wider hidden sm:inline">Sort:</span>
              {sortOptions.map(s=>(
                <button
                  key={s}
                  onClick={()=>setSortBy(s)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150"
                  style={sortBy===s
                    ? {background:"#1a4a2a",color:"#34d399",border:"1px solid #166534"}
                    : {background:"transparent",color:"#52525b",border:"1px solid #27272a"}}
                  onMouseEnter={e=>{if(sortBy!==s){e.currentTarget.style.color="#a1a1aa";}}}
                  onMouseLeave={e=>{if(sortBy!==s){e.currentTarget.style.color="#52525b";}}}>
                  {s}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={e=>setSearch(e.target.value)}
                placeholder="Search tables…"
                className="bg-zinc-800 border border-zinc-700 rounded-full pl-9 pr-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 w-full sm:w-48 transition-colors"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">🔍</span>
            </div>
          </div>

          {/* Result count */}
          {sorted.length<BASE_TABLES.length&&(
            <p className="text-zinc-500 text-sm mb-4">
              Showing <span className="text-white font-semibold">{sorted.length}</span> of {BASE_TABLES.length} tables
              {search&&<> matching &ldquo;{search}&rdquo;</>}
            </p>
          )}

          {/* Table grid */}
          {sorted.length===0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">🃏</div>
              <p className="text-zinc-400 font-semibold">No tables found</p>
              <p className="text-zinc-600 text-sm mt-1">Try adjusting your filters</p>
              <button onClick={()=>{setSearch("");setActiveFilter("All");}} className="mt-4 text-emerald-400 text-sm hover:text-emerald-300 transition-colors">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sorted.map(table=>{
                const isFull = table.seats>=table.maxSeats;
                const isHovered = hoveredTable===table.id;
                const href = table.variant==="sitgo" ? "/tournaments" : table.variant==="omaha" ? "/table/omaha" : "/table";

                return (
                  <div
                    key={table.id}
                    className="group bg-zinc-900 border border-zinc-800/60 rounded-2xl p-5 transition-all duration-200"
                    style={isHovered
                      ? {borderColor:table.variant==="omaha"?"rgba(201,162,39,0.5)":"rgba(16,185,129,0.5)",transform:"translateY(-2px)",boxShadow:table.variant==="omaha"?"0 12px 40px rgba(201,162,39,0.15)":"0 12px 40px rgba(16,185,129,0.15)"}
                      : {}}
                    onMouseEnter={()=>setHoveredTable(table.id)}
                    onMouseLeave={()=>setHoveredTable(null)}>

                    {/* Table header */}
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          {table.status==="active"
                            ? <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shrink-0"/>
                            : <span className="w-2 h-2 bg-zinc-600 rounded-full shrink-0"/>}
                          <span className="font-bold text-white">{table.name}</span>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <span className="text-xs text-zinc-500">{table.game}</span>
                          {table.variant==="omaha"&&(
                            <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{background:"rgba(201,162,39,0.15)",color:"#c9a227",border:"1px solid rgba(201,162,39,0.25)"}}>PLO</span>
                          )}
                        </div>
                      </div>
                      <span className="bg-zinc-800 text-zinc-300 text-xs font-mono font-bold px-2.5 py-1 rounded-lg shrink-0">
                        {table.stakes}
                      </span>
                    </div>

                    {/* Community card preview (shown on hover) */}
                    <div style={{overflow:"hidden",maxHeight:isHovered?"60px":"0",transition:"max-height 0.3s ease",opacity:isHovered?1:0}}>
                      <TablePreview cards={table.preview}/>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-2 gap-3 mt-3 mb-4 text-xs">
                      <div className="bg-zinc-800/60 rounded-lg px-3 py-2">
                        <div className="text-zinc-500 mb-0.5">Avg. Pot</div>
                        <div className="text-white font-bold">{table.avgPot}</div>
                      </div>
                      <div className="bg-zinc-800/60 rounded-lg px-3 py-2">
                        <div className="text-zinc-500 mb-0.5">Hands/hr</div>
                        <div className="text-white font-bold">{table.status==="waiting"?"—":table.handsPH}</div>
                      </div>
                    </div>

                    {/* Seat bar */}
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
                        <span>Seats</span>
                        <span className={table.seats>=table.maxSeats?"text-red-400":table.seats>=table.maxSeats*0.8?"text-amber-400":"text-emerald-400"}>
                          {isFull?"Full":`${table.maxSeats-table.seats} open`}
                        </span>
                      </div>
                      <SeatBar seats={table.seats} max={table.maxSeats}/>
                    </div>

                    {/* Sit Down button */}
                    {isFull ? (
                      <div className="block w-full text-center text-sm font-bold py-2.5 rounded-xl bg-zinc-800 text-zinc-500 cursor-not-allowed">
                        Table Full
                      </div>
                    ) : (
                      <Link
                        href={href}
                        className="block w-full text-center text-sm font-bold py-2.5 rounded-xl transition-all duration-150"
                        style={table.variant==="omaha"
                          ? {background:"rgba(201,162,39,0.85)",color:"#000"}
                          : {background:"#166534",color:"white"}}
                        onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.02)";if(table.variant==="omaha"){e.currentTarget.style.background="#c9a227";}else{e.currentTarget.style.background="#15803d";}}}
                        onMouseLeave={e=>{e.currentTarget.style.transform="";if(table.variant==="omaha"){e.currentTarget.style.background="rgba(201,162,39,0.85)";}else{e.currentTarget.style.background="#166534";}}}>
                        {table.variant==="omaha"?"Play Omaha →":"Sit Down →"}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Responsible gambling footer */}
      <footer className="bg-zinc-950 border-t border-zinc-800/40 py-4 px-4 mt-8">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-zinc-600 text-xs">
            🔞 18+ only · Gambling can be addictive · <a href="#" className="hover:text-zinc-400 transition-colors">GamCare</a> · <a href="#" className="hover:text-zinc-400 transition-colors">BeGambleAware</a> · <a href="#" className="hover:text-zinc-400 transition-colors">Set deposit limits</a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function LobbyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="spinner"/>
      </div>
    }>
      <LobbyContent/>
    </Suspense>
  );
}
