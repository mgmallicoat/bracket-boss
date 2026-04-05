import React, { useState, useEffect, useRef } from "react";

// ─── How many pool games given N teams ───────────────────────────────────────
// Each team plays 2 games. Each game involves 2 teams. So total games = N*2/2 = N.
function expectedGames(n) {
  return n < 2 ? 0 : n;
}

function emptyGame(idx) {
  return { idx, home: "", away: "", homeScore: "", awayScore: "", time: "", locked: false };
}

const DEFAULT_TIEBREAKERS = [
  { id: "wp",   label: "Win %" },
  { id: "rd",   label: "Run Differential" },
  { id: "h2h",  label: "Head-to-Head" },
  { id: "ra",   label: "Runs Allowed" },
];

const USSSA_TIEBREAKERS = [
  { id: "wp",      label: "Win %" },
  { id: "wins",    label: "Number of Wins" },
  { id: "losses",  label: "Number of Losses (fewest)" },
  { id: "h2h_2",   label: "Head-to-Head Win % (2-team ties only)" },
  { id: "avg_ra",  label: "Avg. Runs Allowed" },
  { id: "avg_rd8", label: "Avg. Run Differential (max +8/game)" },
]; 

const PG_TIEBREAKERS = [
  { id: "wp",    label: "Win %" },
  { id: "h2h",   label: "Head-to-Head" },
  { id: "ra",    label: "Runs Allowed" },
  { id: "rf",    label: "Runs Scored" },
  { id: "ra1",   label: "Runs Allowed (drop worst game)" },
  { id: "ra2",   label: "Runs Allowed (drop 2 worst games)" },
];

// ─── Standings ───────────────────────────────────────────────────────────────
function computeStandings(teams, games, tiebreakers = DEFAULT_TIEBREAKERS) {
  const stats = {};
  teams.forEach(t => { stats[t] = { wins: 0, losses: 0, ties: 0, rf: 0, ra: 0, rd: 0, gp: 0, raGames: [] }; });

  games.forEach(g => {
    if (!g.home || !g.away || g.homeScore === "" || g.awayScore === "") return;
    const hs = parseInt(g.homeScore), as = parseInt(g.awayScore);
    if (isNaN(hs) || isNaN(as)) return;
    if (!stats[g.home] || !stats[g.away]) return;
    stats[g.home].rf += hs; stats[g.home].ra += as; stats[g.home].gp++;
    stats[g.away].rf += as; stats[g.away].ra += hs; stats[g.away].gp++;
    stats[g.home].raGames.push(as);
    stats[g.away].raGames.push(hs);
    if (hs > as) { stats[g.home].wins++; stats[g.away].losses++; }
    else if (as > hs) { stats[g.away].wins++; stats[g.home].losses++; }
    else { stats[g.home].ties++; stats[g.away].ties++; }
  });

  Object.keys(stats).forEach(t => {
    stats[t].rd = stats[t].rf - stats[t].ra;
    // Win% = (wins + 0.5*ties) / GP
    stats[t].wp = stats[t].gp ? (stats[t].wins + stats[t].ties * 0.5) / stats[t].gp : 0;
  });

  const scored = games.filter(g => g.home && g.away && g.homeScore !== "" && g.awayScore !== "");

  // Pairwise head-to-head wins
  function h2hWins(team, opp) {
    return scored.filter(g =>
      (g.home === team && g.away === opp) || (g.home === opp && g.away === team)
    ).reduce((w, g) => {
      const hs = parseInt(g.homeScore), as = parseInt(g.awayScore);
      if (g.home === team && hs > as) return w + 1;
      if (g.away === team && as > hs) return w + 1;
      return w;
    }, 0);
  }

  // PG 3-way h2h: if one team beat both others, they win the tiebreaker
  function threeWayH2H(a, b, c) {
    const aBeatsB = h2hWins(a, b) > h2hWins(b, a);
    const aBeatsC = h2hWins(a, c) > h2hWins(c, a);
    const bBeatsA = h2hWins(b, a) > h2hWins(a, b);
    const bBeatsC = h2hWins(b, c) > h2hWins(c, b);
    const cBeatsA = h2hWins(c, a) > h2hWins(a, c);
    const cBeatsB = h2hWins(c, b) > h2hWins(b, c);
    if (aBeatsB && aBeatsC) return { winner: a };
    if (bBeatsA && bBeatsC) return { winner: b };
    if (cBeatsA && cBeatsB) return { winner: c };
    return null; // no clean winner, fall through
  }

  // RA dropping N worst games
  function raDropWorst(team, drop) {
    const sorted = [...stats[team].raGames].sort((a,b) => b - a); // desc
    return sorted.slice(drop).reduce((s,v) => s+v, 0);
  }

  function applyTiebreaker(a, b, tb, allTied) {
    switch(tb.id) {
      case "wp": return stats[b].wp - stats[a].wp;
      case "h2h": {
        // If 3+ tied, check for clean 3-way winner first
        if (allTied && allTied.length === 3) {
          const [x,y,z] = allTied;
          const res = threeWayH2H(x,y,z);
          if (res) {
            if (res.winner === a && res.winner !== b) return -1;
            if (res.winner === b && res.winner !== a) return 1;
          }
          return 0; // no clean winner, fall through
        }
        return h2hWins(b, a) - h2hWins(a, b);
      }
      case "wins":   return stats[b].wins - stats[a].wins;
      case "losses": return stats[a].losses - stats[b].losses;
      case "h2h_2": {
        // USSSA: skip if more than 2 teams tied
        if (allTied && allTied.length > 2) return 0;
        return h2hWins(b, a) - h2hWins(a, b);
      }
      case "avg_ra": {
        const avgA = stats[a].gp ? stats[a].ra / stats[a].gp : 0;
        const avgB = stats[b].gp ? stats[b].ra / stats[b].gp : 0;
        return avgA - avgB; // fewer is better
      }
      case "avg_rd8": {
        // Cap each game's RD at +8, then average
        const cappedRD = (team) => {
          let total = 0;
          scored.forEach(g => {
            if (g.home !== team && g.away !== team) return;
            const hs = parseInt(g.homeScore), as = parseInt(g.awayScore);
            if (isNaN(hs) || isNaN(as)) return;
            const raw = g.home === team ? hs - as : as - hs;
            total += Math.min(8, Math.max(-8, raw));
          });
          return stats[team].gp ? total / stats[team].gp : 0;
        };
        return cappedRD(b) - cappedRD(a); // higher is better
      }
      case "ra":  return stats[a].ra - stats[b].ra;
      case "rf":  return stats[b].rf - stats[a].rf;
      case "ra1": return raDropWorst(a, 1) - raDropWorst(b, 1);
      case "ra2": return raDropWorst(a, 2) - raDropWorst(b, 2);
      default:    return 0;
    }
  }

  return [...teams].sort((a, b) => {
    const tiedWithA = teams.filter(t => Math.abs(stats[t].wp - stats[a].wp) < 0.001);

    for (const tb of tiebreakers) {
      const diff = applyTiebreaker(a, b, tb, tiedWithA.length >= 3 ? tiedWithA : null);
      if (diff !== 0) return diff;
    }
    return 0;
  }).map((t, i) => ({ team: t, seed: i + 1, ...stats[t] }));
}

// ─── Bracket builder ─────────────────────────────────────────────────────────
function buildBracket(poolStandings, settings) {
  const { format, byes, goldCount } = settings;
  const maxLen = Math.max(0, ...poolStandings.map(p => p.length));
  const seededTeams = [];
  for (let i = 0; i < maxLen; i++)
    poolStandings.forEach(pool => { if (pool[i]) seededTeams.push(pool[i]); });

  if (format === "gold-silver") {
    const split = Math.min(Math.max(1, goldCount), seededTeams.length - 1);
    const gold = seededTeams.slice(0, split);
    const silver = seededTeams.slice(split);
    return {
      seededTeams,
      format: "gold-silver",
      gold: makeBracketRound(gold, settings.goldByes || 0),
      silver: makeBracketRound(silver, settings.silverByes || 0),
    };
  }

  return {
    seededTeams,
    format: "single",
    firstRound: makeBracketRound(seededTeams, byes),
  };
}

function makeBracketRound(teams, byes) {
  const n = teams.length;
  if (n === 0) return [];
  if (n === 1) return [[teams[0], null, false]];

  // Find next power of 2 >= n to determine bracket size
  let size = 1;
  while (size < n) size *= 2;

  // Build seeded slots: 1 vs size, 2 vs size-1, etc.
  // Fill with null (TBD) for empty slots
  const slots = Array(size).fill(null);
  teams.forEach((t, i) => { slots[i] = t; });

  // Pair top half vs bottom half recursively (standard bracket order)
  function buildOrder(sz) {
    if (sz <= 1) return [0];
    if (sz === 2) return [0, 1];
    const prev = buildOrder(sz / 2);
    const result = [];
    for (const i of prev) {
      result.push(i, sz - 1 - i);
    }
    return result;
  }

  const order = buildOrder(size);
  const matchups = [];
  for (let i = 0; i < order.length; i += 2) {
    const t1 = slots[order[i]];
    const t2 = slots[order[i + 1]];
    if (!t1 && !t2) continue; // skip empty slots entirely
    const seedIdx = teams.indexOf(t1);
    const isBye = t1 && !t2 || (t1 && seedIdx < byes);
    matchups.push([t1 || t2, (!t1 || isBye) ? null : t2, isBye || !t2]);
  }
  return matchups;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0d12;--surface:#111520;--surface2:#181e2e;--border:#1e2840;
  --accent:#e8c84a;--accent2:#3b82f6;--red:#ef4444;--green:#22c55e;
  --purple:#a855f7;--text:#e8eaf0;--muted:#6b7280;
  --fd:'Bebas Neue',sans-serif;--fb:'DM Sans',sans-serif;--fm:'JetBrains Mono',monospace;
}
body{background:var(--bg);color:var(--text);font-family:var(--fb);}
.app{min-height:100vh;background:radial-gradient(ellipse 80% 40% at 50% -10%,rgba(59,130,246,.1) 0%,transparent 60%),var(--bg);}

/* Header */
.header{border-bottom:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;gap:12px;background:rgba(10,13,18,.9);backdrop-filter:blur(10px);position:sticky;top:0;z-index:100;}
.logo{width:34px;height:34px;background:var(--accent);clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;}
.htitle{font-family:var(--fd);font-size:24px;letter-spacing:2px;}
.hsub{font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-top:1px;}
.your-badge{margin-left:auto;background:rgba(232,200,74,.1);border:1px solid rgba(232,200,74,.3);border-radius:6px;padding:5px 12px;font-size:12px;color:var(--accent);white-space:nowrap;}

/* Tabs */
.tabs{display:flex;padding:0 24px;border-bottom:1px solid var(--border);background:var(--surface);}
.tab{padding:11px 18px;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;transition:all .2s;font-family:var(--fb);}
.tab.active{color:var(--accent);border-bottom-color:var(--accent);}
.tab:hover:not(.active){color:var(--text);}

.main{padding:24px;max-width:1000px;margin:0 auto;}

/* Cards */
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:16px;}
.ctitle{font-family:var(--fd);font-size:17px;letter-spacing:2px;color:var(--accent);margin-bottom:14px;display:flex;align-items:center;gap:8px;}

/* Inputs */
.input{flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text);font-family:var(--fb);font-size:14px;outline:none;transition:border-color .2s;width:100%;}
.input:focus{border-color:var(--accent2);}
.input::placeholder{color:var(--muted);}
.textarea{resize:vertical;min-height:110px;font-size:13px;line-height:1.5;}
.irow{display:flex;gap:8px;margin-bottom:10px;}

/* Buttons */
.btn{padding:8px 14px;border-radius:6px;border:none;font-family:var(--fb);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;letter-spacing:.5px;}
.btn-acc{background:var(--accent);color:#0a0d12;}
.btn-acc:hover{background:#f0d560;}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--muted);}
.btn-ghost:hover{border-color:var(--text);color:var(--text);}
.btn-blue{background:var(--accent2);color:#fff;}
.btn-blue:hover{background:#2563eb;}
.btn-danger{background:transparent;border:none;color:var(--red);padding:4px 8px;font-size:13px;cursor:pointer;border-radius:4px;}
.btn-danger:hover{background:rgba(239,68,68,.1);}

/* Tags */
.tag-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}
.tag{background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:3px 10px;font-size:12px;display:flex;align-items:center;gap:5px;}
.tag button{background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;line-height:1;}
.tag button:hover{color:var(--red);}

/* Setup */
.setup-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
@media(max-width:680px){.setup-grid{grid-template-columns:1fr;}}

/* Game rows */
.game-list{display:flex;flex-direction:column;gap:8px;margin-bottom:14px;}

.game-row{
  display:grid;
  grid-template-columns:40px 1fr auto 1fr auto;
  align-items:center;
  gap:8px;
  background:var(--surface2);
  border:1px solid var(--border);
  border-radius:8px;
  padding:10px 12px;
  transition:border-color .2s;
}
.game-row.scored{border-color:rgba(59,130,246,.3);}
.game-row.locked{border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.03);}
.game-row.hypo{border-color:rgba(168,85,247,.3);background:rgba(168,85,247,.03);}

.game-num{display:flex;flex-direction:column;align-items:center;gap:1px;flex-shrink:0;}
.game-num-label{font-family:var(--fm);font-size:10px;color:var(--muted);letter-spacing:1px;}
.game-num-time{font-family:var(--fm);font-size:10px;color:var(--accent2);}

.team-select{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:7px 10px;color:var(--text);font-family:var(--fb);font-size:13px;outline:none;cursor:pointer;}
.team-select:focus{border-color:var(--accent2);}
.team-select:disabled{opacity:.5;cursor:default;}
.team-select.yours{border-color:rgba(232,200,74,.4);color:var(--accent);}

.score-block{display:flex;align-items:center;gap:5px;flex-shrink:0;}
.score-input{width:44px;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:6px 4px;color:var(--text);font-family:var(--fm);font-size:15px;font-weight:600;text-align:center;outline:none;transition:border-color .2s;}
.score-input:focus{border-color:var(--accent);}
.score-input:disabled{opacity:.5;cursor:default;}
.score-dash{color:var(--muted);font-family:var(--fm);font-size:15px;}

.game-actions{display:flex;align-items:center;gap:4px;flex-shrink:0;}
.time-input{width:64px;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:5px 6px;color:var(--muted);font-family:var(--fm);font-size:10px;text-align:center;outline:none;}
.time-input:focus{border-color:var(--accent2);color:var(--text);}
.time-input::placeholder{color:var(--border);font-size:9px;}
.lock-btn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:transparent;cursor:pointer;font-size:13px;flex-shrink:0;transition:all .15s;}
.lock-btn:hover{border-color:var(--green);background:rgba(34,197,94,.08);}
.lock-btn.locked{border-color:rgba(34,197,94,.5);background:rgba(34,197,94,.12);}
.del-btn{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:5px;border:none;background:transparent;cursor:pointer;font-size:12px;color:var(--muted);transition:all .15s;}
.del-btn:hover{color:var(--red);background:rgba(239,68,68,.1);}

.add-game-btn{width:100%;padding:9px;border:1px dashed rgba(59,130,246,.3);border-radius:7px;background:transparent;color:var(--accent2);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;font-family:var(--fb);letter-spacing:.5px;}
.add-game-btn:hover{background:rgba(59,130,246,.06);border-color:var(--accent2);}

/* Pool tabs */
.pool-tabs{display:flex;gap:6px;margin-bottom:18px;flex-wrap:wrap;}
.ptab{padding:5px 14px;border-radius:20px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:11px;font-weight:600;cursor:pointer;letter-spacing:.5px;transition:all .15s;font-family:var(--fb);}
.ptab.active{color:#0a0d12;border-color:transparent;}
.ptab:hover:not(.active){border-color:var(--text);color:var(--text);}

/* Pool header */
.pool-header{font-family:var(--fd);font-size:20px;letter-spacing:3px;margin-bottom:6px;color:var(--text);}
.pool-subhead{font-size:11px;color:var(--muted);margin-bottom:14px;}

/* Standings */
.standings-table{width:100%;border-collapse:collapse;font-size:13px;}
.standings-table th{text-align:left;padding:7px 10px;color:var(--muted);font-size:10px;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid var(--border);font-weight:600;}
.standings-table td{padding:9px 10px;border-bottom:1px solid rgba(30,40,64,.5);}
.standings-table tr:last-child td{border-bottom:none;}
.standings-table tr:hover td{background:rgba(255,255,255,.02);}
.your-row td{background:rgba(232,200,74,.04)!important;}
.seed-badge{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:4px;font-family:var(--fm);font-size:11px;font-weight:600;}
.s1{background:rgba(232,200,74,.2);color:var(--accent);}
.s2{background:rgba(59,130,246,.2);color:var(--accent2);}
.s3{background:rgba(107,114,128,.2);color:var(--muted);}
.sx{background:rgba(107,114,128,.1);color:var(--muted);}
.rd-p{color:var(--green);font-family:var(--fm);}
.rd-n{color:var(--red);font-family:var(--fm);}
.rd-z{color:var(--muted);font-family:var(--fm);}
.mono{font-family:var(--fm);font-size:13px;}

/* Bracket */
.bracket-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;}
.matchup-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:border-color .2s,transform .15s;}
.matchup-card:hover{border-color:rgba(232,200,74,.3);transform:translateY(-1px);}
.mlabel{background:var(--surface2);padding:7px 14px;font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border);font-family:var(--fm);}
.mteam{display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid rgba(30,40,64,.6);}
.mteam:last-child{border-bottom:none;}
.mteam.top{background:rgba(232,200,74,.03);}
.mseed{font-family:var(--fm);font-size:11px;color:var(--muted);width:16px;}
.mname{flex:1;font-size:13px;font-weight:600;}
.mpool{font-size:10px;color:var(--muted);background:var(--surface2);padding:2px 6px;border-radius:3px;font-family:var(--fm);}
.mrec{font-family:var(--fm);font-size:11px;color:var(--muted);}
.hl{color:var(--accent)!important;}

/* Misc */
.alert{padding:9px 13px;border-radius:6px;font-size:12px;margin-bottom:14px;}
.alert-warn{background:rgba(232,200,74,.1);border:1px solid rgba(232,200,74,.3);color:var(--accent);}
.alert-info{background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.3);color:var(--accent2);}
.alert-hypo{background:rgba(168,85,247,.1);border:1px solid rgba(168,85,247,.3);color:var(--purple);}
.empty{text-align:center;padding:50px 20px;color:var(--muted);}
.empty .icon{font-size:44px;margin-bottom:14px;}
.empty .msg{font-size:14px;color:var(--text);font-weight:600;margin-bottom:4px;}
.empty .sub{font-size:12px;}
.tb-list{display:flex;flex-direction:column;gap:6px;margin-top:8px;}
.tb-item{display:flex;align-items:center;gap:10px;background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:9px 12px;cursor:grab;user-select:none;transition:border-color .15s,opacity .15s;}
.tb-item:active{cursor:grabbing;}
.tb-item.drag-over{border-color:var(--accent2);background:rgba(59,130,246,.08);}
.tb-rank{font-family:var(--fm);font-size:11px;color:var(--muted);width:16px;flex-shrink:0;}
.tb-label{flex:1;font-size:13px;font-weight:600;}
.tb-handle{color:var(--muted);font-size:14px;flex-shrink:0;}

.tournament-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 18px;display:flex;align-items:center;gap:12px;}
.tournament-card:hover{border-color:rgba(59,130,246,.3);}
.t-info{flex:1;}
.t-name{font-size:14px;font-weight:600;margin-bottom:3px;}
.t-meta{font-size:11px;color:var(--muted);font-family:var(--fm);}
.t-actions{display:flex;gap:6px;flex-shrink:0;}
.bracket-settings{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end;margin-bottom:20px;}
.bs-group{display:flex;flex-direction:column;gap:6px;}
.bs-label{font-size:11px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;font-family:var(--fm);}
.bs-options{display:flex;gap:6px;}
.bs-opt{padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;font-family:var(--fb);}
.bs-opt.active{background:var(--accent);color:#0a0d12;border-color:var(--accent);}
.bs-opt:hover:not(.active){border-color:var(--text);color:var(--text);}
.bs-select{background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-family:var(--fb);font-size:13px;outline:none;}
.bracket-section{margin-bottom:28px;}
.bracket-section-title{font-family:var(--fd);font-size:18px;letter-spacing:3px;padding:8px 14px;border-radius:7px;margin-bottom:12px;display:inline-block;}
.gold-title{background:rgba(232,200,74,.12);color:var(--accent);}
.silver-title{background:rgba(107,114,128,.12);color:#9ca3af;}
.bye-card{background:rgba(34,197,94,.05);border:1px solid rgba(34,197,94,.2);border-radius:10px;overflow:hidden;}
.bye-label-bar{background:rgba(34,197,94,.1);padding:7px 14px;font-size:10px;font-weight:600;letter-spacing:2px;color:var(--green);font-family:var(--fm);}

.divider{display:flex;align-items:center;gap:10px;margin:14px 0;color:var(--muted);font-size:11px;letter-spacing:1px;text-transform:uppercase;}
.divider::before,.divider::after{content:'';flex:1;height:1px;background:var(--border);}
.parse-hint{font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:10px;}
.scenario-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:20px;}
.scenario-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;}
.scenario-header{display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid var(--border);background:var(--surface2);}
.scenario-name-input{flex:1;background:transparent;border:none;outline:none;color:var(--text);font-family:var(--fd);font-size:15px;letter-spacing:1px;}
.scenario-body{padding:12px 14px;flex:1;}
.scenario-game{display:flex;align-items:center;gap:5px;margin-bottom:7px;font-size:12px;}
.scenario-team{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;min-width:0;}
.scenario-team.yours{color:var(--accent);}
.scenario-score{width:36px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:4px 2px;color:var(--text);font-family:var(--fm);font-size:13px;font-weight:600;text-align:center;outline:none;flex-shrink:0;}
.scenario-score:focus{border-color:var(--accent);}
.scenario-score:disabled{opacity:.4;}
.scenario-dash{color:var(--muted);font-family:var(--fm);font-size:13px;flex-shrink:0;}
.scenario-lock-badge{font-size:9px;color:var(--green);font-family:var(--fm);padding:2px 5px;background:rgba(34,197,94,.1);border-radius:3px;white-space:nowrap;flex-shrink:0;}
.scenario-section-title{font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;font-family:var(--fm);margin:10px 0 6px;}
.scenario-seed-row{display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px;border-bottom:1px solid rgba(30,40,64,.4);}
.scenario-seed-row:last-child{border-bottom:none;}
.scenario-seed-row.yours-row{background:rgba(232,200,74,.04);margin:0 -4px;padding:4px;}
.scenario-sr-seed{font-family:var(--fm);font-size:10px;color:var(--muted);width:18px;flex-shrink:0;}
.scenario-sr-name{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.scenario-sr-rec{font-family:var(--fm);font-size:10px;color:var(--muted);flex-shrink:0;}
.scenario-sr-bracket{font-family:var(--fm);font-size:9px;padding:1px 5px;border-radius:3px;flex-shrink:0;margin-left:2px;}
.scenario-diff{font-size:10px;color:var(--accent2);font-family:var(--fm);margin-top:2px;}
`;

const POOL_NAMES = ["Pool A","Pool B","Pool C","Pool D"];
const POOL_COLORS = ["#e8c84a","#3b82f6","#a855f7","#22c55e"];

function buildAllRounds(initialMatchups) {
  const rounds = [initialMatchups];
  let current = initialMatchups;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i];
      const b = current[i + 1];
      // If a matchup is a bye, that team is known for the next round
      const knownA = a && a[2] ? a[0] : null; // bye team advances known
      const knownB = b && b[2] ? b[0] : null;
      next.push([knownA, knownB, false]);
    }
    if (next.length === 0) break;
    rounds.push(next);
    current = next;
    if (current.length <= 1) break;
  }
  return rounds;
}

function VisualBracket({ matchups, seededTeams, standings, yourTeam, title, color }) {
  const [isPortrait, setIsPortrait] = useState(
    typeof window !== "undefined" ? window.innerWidth < window.innerHeight : false
  );

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const handler = e => setIsPortrait(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const rounds = buildAllRounds(matchups, seededTeams);
  const numRounds = rounds.length;

  const SLOT_W = 160;
  const SLOT_H = 52;
  const H_GAP = 48;  // horizontal gap between rounds
  const V_PAD = 16;  // vertical padding between slots

  // For each round, compute vertical positions of each matchup
  function getSlotPositions(roundIdx) {
    const count = rounds[roundIdx].length;
    const totalH = rounds[0].length * (SLOT_H + V_PAD);
    const spacing = totalH / count;
    return Array.from({length: count}, (_, i) => spacing * i + spacing / 2 - SLOT_H / 2);
  }

  function teamLabel(t) {
    if (!t) return null;
    const seed = seededTeams.findIndex(s => s.team === t.team) + 1;
    const st = standings[t.poolIdx]?.find(s => s.team === t.team);
    const rec = st ? `${st.wins}-${st.losses}${st.ties > 0 ? `-${st.ties}` : ""}` : "";
    return { seed, name: t.team, rec, isYours: t.team === yourTeam };
  }

  const svgW = numRounds * (SLOT_W + H_GAP) - H_GAP;
  const svgH = rounds[0].length * (SLOT_H + V_PAD) + V_PAD;

  if (isPortrait) {
    // Portrait: each round is a row of cards stacked top to bottom
    const roundLabels = ["Round 1","Quarterfinals","Semifinals","Finals","Championship"];
    return (
      <div style={{marginBottom:20}}>
        {title && <div className={`bracket-section-title ${color==="gold"?"gold-title":"silver-title"}`} style={{marginBottom:12}}>{title}</div>}
        {rounds.map((round, ri) => {
          const isLast = ri === numRounds - 1;
          const label = isLast ? "🏆 Championship" : (roundLabels[ri] || `Round ${ri+1}`);
          return (
            <div key={ri} style={{marginBottom:16}}>
              <div style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--fm)",letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>{label}</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {round.map(([t1,t2,isBye],mi) => {
                  const l1 = teamLabel(t1);
                  const l2 = t2 ? teamLabel(t2) : null;
                  return (
                    <div key={mi} style={{
                      background:"var(--surface)",
                      border:`1px solid ${isLast?"var(--accent)":"var(--border)"}`,
                      borderRadius:7, overflow:"hidden",
                      boxShadow: isLast ? "0 0 10px rgba(232,200,74,.15)" : "none"
                    }}>
                      {isBye && <div style={{background:"rgba(34,197,94,.1)",padding:"2px 8px",fontSize:9,color:"var(--green)",fontFamily:"var(--fm)",letterSpacing:1}}>BYE</div>}
                      {l1 ? <SlotLine label={l1}/> : <SlotLine label={null}/>}
                      {!isBye && (l2 ? <SlotLine label={l2}/> : <SlotLine label={null}/>)}
                    </div>
                  );
                })}
              </div>
              {ri < numRounds - 1 && (
                <div style={{textAlign:"center",color:"var(--border)",fontSize:16,marginTop:4}}>↓</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Landscape: left-to-right
  return (
    <div style={{overflowX:"auto",marginBottom:20}}>
      {title && <div className={`bracket-section-title ${color==="gold"?"gold-title":"silver-title"}`} style={{marginBottom:12}}>{title}</div>}
      <div style={{position:"relative",width:svgW+H_GAP,height:svgH}}>
        {rounds.map((round, ri) => {
          const positions = getSlotPositions(ri);
          const x = ri * (SLOT_W + H_GAP);
          return round.map(([t1, t2, isBye], mi) => {
            const y = positions[mi];
            const l1 = teamLabel(t1);
            const l2 = t2 ? teamLabel(t2) : null;
            const isChamp = ri === numRounds - 1;
            // Draw connector line to next round
            const nextPositions = ri < numRounds - 1 ? getSlotPositions(ri + 1) : null;
            const nextSlotY = nextPositions ? nextPositions[Math.floor(mi / 2)] + SLOT_H / 2 : null;

            return (
              <React.Fragment key={`${ri}-${mi}`}>
                {/* Connector lines */}
                {nextSlotY !== null && (
                  <svg style={{position:"absolute",left:0,top:0,width:svgW+H_GAP,height:svgH,pointerEvents:"none",overflow:"visible"}}>
                    <path
                      d={`M ${x+SLOT_W} ${y+SLOT_H/2} H ${x+SLOT_W+H_GAP/2} V ${nextSlotY} H ${x+SLOT_W+H_GAP}`}
                      fill="none" stroke="var(--border)" strokeWidth="1.5"
                    />
                  </svg>
                )}
                <div style={{
                  position:"absolute", left:x, top:y,
                  width:SLOT_W, background:"var(--surface)",
                  border:`1px solid ${isChamp?"var(--accent)":"var(--border)"}`,
                  borderRadius:6, overflow:"hidden", fontSize:11,
                  boxShadow: isChamp ? "0 0 12px rgba(232,200,74,.2)" : "none"
                }}>
                  {isChamp && <div style={{background:"rgba(232,200,74,.15)",padding:"2px 6px",fontSize:9,color:"var(--accent)",fontFamily:"var(--fm)",letterSpacing:1,textAlign:"center"}}>🏆 CHAMPION</div>}
                  {isBye && ri === 0 && <div style={{background:"rgba(34,197,94,.1)",padding:"2px 6px",fontSize:9,color:"var(--green)",fontFamily:"var(--fm)",letterSpacing:1}}>BYE</div>}
                  {l1 && <SlotLine label={l1} />}
                  {l2 && <SlotLine label={l2} />}
                  {!l1 && <SlotLine label={null} />}
                  {!l2 && !isBye && <SlotLine label={null} />}
                </div>
              </React.Fragment>
            );
          });
        })}
        {/* Round labels */}
        {rounds.map((round, ri) => {
          const x = ri * (SLOT_W + H_GAP);
          const labels = ["Round 1","Round 2","Semis","Finals","Championship"];
          const label = numRounds <= 5 ? (labels[numRounds - 1 - (numRounds - 1 - ri)] || `Round ${ri+1}`) : `Round ${ri+1}`;
          const roundLabels = ["Round 1","Quarterfinals","Semifinals","Finals","Championship"];
          const rl = roundLabels[ri] || (ri === numRounds-1 ? "Championship" : `Round ${ri+1}`);
          return (
            <div key={ri} style={{position:"absolute",left:x,top:svgH-18,width:SLOT_W,textAlign:"center",fontSize:9,color:"var(--muted)",fontFamily:"var(--fm)",letterSpacing:1,textTransform:"uppercase"}}>
              {rl}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlotLine({ label }) {
  if (!label) return (
    <div style={{padding:"5px 8px",borderTop:"1px solid var(--border)",color:"var(--border)",fontSize:10,fontFamily:"var(--fm)"}}>TBD</div>
  );
  return (
    <div style={{
      padding:"5px 8px",borderTop:"1px solid var(--border)",
      display:"flex",alignItems:"center",gap:4,
      background: label.isYours ? "rgba(232,200,74,.06)" : "transparent"
    }}>
      <span style={{color:"var(--muted)",fontFamily:"var(--fm)",fontSize:9,flexShrink:0}}>#{label.seed}</span>
      <span style={{flex:1,fontWeight:600,fontSize:11,color:label.isYours?"var(--accent)":"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
        {label.isYours?"🏆 ":""}{label.name}
      </span>
      <span style={{color:"var(--muted)",fontFamily:"var(--fm)",fontSize:9,flexShrink:0}}>{label.rec}</span>
    </div>
  );
}

function TeamTag({ name, isYours, onClaim, onRemove, onRename }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  const inputRef = useRef(null);
  useEffect(() => setVal(name), [name]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  function commit() {
    const t = val.trim();
    if (t && t !== name) onRename(t);
    setEditing(false);
  }
  if (editing) return (
    <div className="tag" style={{borderColor:"var(--accent2)",padding:"2px 6px"}}>
      <input ref={inputRef} value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if(e.key==="Enter") commit(); if(e.key==="Escape"){setVal(name);setEditing(false);} }}
        style={{background:"transparent",border:"none",outline:"none",color:"var(--text)",fontFamily:"var(--fb)",fontSize:12,width:Math.max(60,val.length*8)+"px"}}
      />
    </div>
  );
  return (
    <div className="tag" onClick={onClaim} onDoubleClick={e=>{e.stopPropagation();setEditing(true);}}
      style={{cursor:"pointer",...(isYours?{borderColor:"var(--accent)",color:"var(--accent)",background:"rgba(232,200,74,.08)"}:{})}}>
      {isYours?"🏆 ":""}{name}
      <button onClick={e=>{e.stopPropagation();onRemove();}}>✕</button>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("setup");
  const [pools, setPools] = useState([{ name:"", teams:[], newTeam:"" }]);
  const [yourTeam, setYourTeam] = useState("");
  const [poolGames, setPoolGames] = useState({});
  const [activePool, setActivePool] = useState(0);
  const [bulkText, setBulkText] = useState({});
  const [bulkOpen, setBulkOpen] = useState({});
  const [bulkLoading, setBulkLoading] = useState({});
  const [savedTournaments, setSavedTournaments] = useState([]);
  const [tournamentName, setTournamentName] = useState("");
  const [tiebreakers, setTiebreakers] = useState(DEFAULT_TIEBREAKERS);
  const dragTb = useRef(null);
  const [bracketSettings, setBracketSettings] = useState({ format:"single", elim:"single", byes:0, goldByes:0, silverByes:0, goldCount:4 });
  const [scenarios, setScenarios] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  // When teams change, seed game slots if not already present
  const teamsKey = pools.map(p => p.teams.join(",")).join("|");
  useEffect(() => {
    setPoolGames(prev => {
      const next = { ...prev };
      pools.forEach((pool, pi) => {
        const n = pool.teams.length;
        const needed = expectedGames(n);
        const existing = prev[pi] || [];
        // Keep existing games whose teams still exist, reset if team was removed
        const cleaned = existing.map(g => ({
          ...g,
          home: pool.teams.includes(g.home) ? g.home : "",
          away: pool.teams.includes(g.away) ? g.away : "",
        }));
        // Pad up to needed
        while (cleaned.length < needed) cleaned.push(emptyGame(cleaned.length));
        next[pi] = cleaned;
      });
      return next;
    });
  }, [teamsKey]);

  // ── Pool management ──
  function addPool() {
    if (pools.length >= 4) return;
    setPools(p => [...p, { name: POOL_NAMES[p.length], teams:[], newTeam:"" }]);
  }
  function addTeam(pi) {
    const name = pools[pi].newTeam.trim();
    if (!name || pools[pi].teams.includes(name)) return;
    setPools(p => p.map((pl,i) => i===pi ? {...pl, teams:[...pl.teams,name], newTeam:""} : pl));
  }
  function removeTeam(pi, team) {
    setPools(p => p.map((pl,i) => i===pi ? {...pl, teams:pl.teams.filter(t=>t!==team)} : pl));
    if (team === yourTeam) setYourTeam("");
  }
  function renameTeam(pi, oldName, newName) {
    setPools(p => p.map((pl,i) => i===pi ? {...pl, teams:pl.teams.map(t=>t===oldName?newName:t)} : pl));
    setPoolGames(prev => {
      const next = { ...prev };
      if (next[pi]) next[pi] = next[pi].map(g => ({
        ...g,
        home: g.home === oldName ? newName : g.home,
        away: g.away === oldName ? newName : g.away,
      }));
      return next;
    });
    if (yourTeam === oldName) setYourTeam(newName);
  }

  // ── Game management ──
  function updateGame(pi, idx, field, val) {
    setPoolGames(prev => {
      const games = [...(prev[pi]||[])];
      games[idx] = { ...games[idx], [field]: val };
      // If locking, clear hypothetical flag
      if (field === "locked" && val === true) games[idx].hypothetical = false;
      return { ...prev, [pi]: games };
    });
  }

  function addGame(pi) {
    setPoolGames(prev => {
      const games = [...(prev[pi]||[])];
      games.push(emptyGame(games.length));
      return { ...prev, [pi]: games };
    });
  }

  function removeGame(pi, idx) {
    setPoolGames(prev => {
      const games = (prev[pi]||[]).filter((_,i)=>i!==idx).map((g,i)=>({...g,idx:i}));
      return { ...prev, [pi]: games };
    });
  }

  // ── Bulk import ──
  async function handleBulkAdd(pi) {
    const raw = (bulkText[pi]||"").trim();
    if (!raw) return;
    const lines = raw.split(/\n/).map(l=>l.trim()).filter(Boolean);
    const looksClean = lines.every(l => !l.includes("\t") && l.split(/\s{2,}/).length===1 && l.length<60);
    let teams = [];
    if (looksClean) {
      teams = lines;
    } else {
      setBulkLoading(b=>({...b,[pi]:true}));
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({
            model:"claude-sonnet-4-20250514", max_tokens:500,
            messages:[{role:"user",content:`Extract only the team names from this tournament data. Return one team name per line, nothing else — no numbers, seeds, scores, records, headers.\n\n${raw}`}]
          })
        });
        const data = await res.json();
        teams = (data.content?.[0]?.text||"").split(/\n/).map(l=>l.trim()).filter(Boolean);
      } catch(e) { teams = lines; }
      setBulkLoading(b=>({...b,[pi]:false}));
    }
    if (!teams.length) return;
    setPools(p => p.map((pl,i) => {
      if (i!==pi) return pl;
      const merged = [...pl.teams];
      teams.forEach(t => { if(!merged.includes(t)) merged.push(t); });
      return {...pl, teams:merged};
    }));
    setBulkText(b=>({...b,[pi]:""}));
    setBulkOpen(b=>({...b,[pi]:false}));
  }

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("bracket-boss-state");
      if (saved) {
        const s = JSON.parse(saved);
        if (s.pools) setPools(s.pools);
        if (s.yourTeam) setYourTeam(s.yourTeam);
        if (s.poolGames) setPoolGames(s.poolGames);
        if (s.savedTournaments) setSavedTournaments(s.savedTournaments);
        if (s.tiebreakers) setTiebreakers(s.tiebreakers);
        if (s.bracketSettings) setBracketSettings(s.bracketSettings);
        if (s.scenarios) setScenarios(s.scenarios);
      }
    } catch(e) {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem("bracket-boss-state", JSON.stringify({ pools, yourTeam, poolGames, savedTournaments, tiebreakers, bracketSettings, scenarios }));
    } catch(e) {}
  }, [pools, yourTeam, poolGames, savedTournaments, tiebreakers, bracketSettings, scenarios, hydrated]);

  function saveTournament() {
    const name = tournamentName.trim() || `Tournament ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;
    const snapshot = {
      id: Date.now(),
      name,
      savedAt: new Date().toISOString(),
      pools: JSON.parse(JSON.stringify(pools)),
      yourTeam,
      poolGames: JSON.parse(JSON.stringify(poolGames)),
    };
    setSavedTournaments(prev => [snapshot, ...prev]);
    setTournamentName("");
  }

  function loadTournament(t) {
    if (!confirm(`Load "${t.name}"? This will replace your current data.`)) return;
    setPools(t.pools);
    setYourTeam(t.yourTeam);
    setPoolGames(t.poolGames);
    setTab("scores");
  }

  function duplicateTournament(t) {
    const copy = {
      ...JSON.parse(JSON.stringify(t)),
      id: Date.now(),
      name: `${t.name} (copy)`,
      savedAt: new Date().toISOString(),
    };
    setSavedTournaments(prev => [copy, ...prev]);
  }

  function deleteTournament(id) {
    if (!confirm("Delete this saved tournament?")) return;
    setSavedTournaments(prev => prev.filter(t => t.id !== id));
  }

  // Merge locked games with a scenario's overrides to produce a full game list
  function gamesForScenario(pi, scenarioOverrides) {
    return (poolGames[pi]||[]).map(g => {
      if (g.locked) return g; // locked = real, always use as-is
      const key = `${pi}:${g.idx}`;
      const ov = scenarioOverrides[key];
      if (ov) return { ...g, homeScore: ov.homeScore, awayScore: ov.awayScore };
      return g;
    });
  }

  function standingsForScenario(overrides) {
    return pools.map((pool, i) => {
      const games = gamesForScenario(i, overrides);
      const s = computeStandings(pool.teams, games, tiebreakers);
      return s.map(st => ({...st, pool:pool.name, poolIdx:i}));
    });
  }

  function addScenario() {
    // Seed with current unlocked scores as starting point
    const overrides = {};
    pools.forEach((_, pi) => {
      (poolGames[pi]||[]).forEach(g => {
        if (!g.locked && g.home && g.away) {
          const key = `${pi}:${g.idx}`;
          overrides[key] = { homeScore: g.homeScore, awayScore: g.awayScore };
        }
      });
    });
    setScenarios(prev => [...prev, {
      id: Date.now(),
      name: `Scenario ${prev.length + 1}`,
      overrides,
    }]);
  }

  function updateScenarioName(id, name) {
    setScenarios(prev => prev.map(s => s.id===id ? {...s, name} : s));
  }

  function updateScenarioScore(id, pi, idx, field, val) {
    const key = `${pi}:${idx}`;
    setScenarios(prev => prev.map(s => {
      if (s.id !== id) return s;
      return { ...s, overrides: { ...s.overrides, [key]: { ...s.overrides[key], [field]: val } } };
    }));
  }

  function deleteScenario(id) {
    setScenarios(prev => prev.filter(s => s.id !== id));
  }

  function allStandings() {
    return pools.map((pool, i) => {
      const s = computeStandings(pool.teams, poolGames[i]||[], tiebreakers);
      return s.map(st => ({...st, pool:pool.name, poolIdx:i}));
    });
  }

  const totalTeams = pools.reduce((s,p)=>s+p.teams.length,0);
  const standings = allStandings();
  const bracket = buildBracket(standings, bracketSettings);
  const { seededTeams } = bracket;

  const hasHypo = Object.values(poolGames).flat().some(g =>
    !g.locked && g.home && g.away && g.homeScore !== "" && g.awayScore !== ""
  );

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div className="logo">⬦</div>
        <div>
          <div className="htitle">BRACKET BOSS</div>
          <div className="hsub">Travel Baseball Tournament Predictor</div>
        </div>
        {yourTeam && <div className="your-badge">🏆 {yourTeam}</div>}
        {hydrated && (
          <button className="btn btn-ghost" style={{marginLeft: yourTeam ? "8px" : "auto", fontSize:10, padding:"4px 10px", opacity:.5}}
            onClick={() => {
              if (!confirm("Clear all data and start over?")) return;
              try { localStorage.removeItem("bracket-boss-state"); } catch(e) {}
              setTimeout(() => {
                setPools([{ name:"", teams:[], newTeam:"" }]);
                setYourTeam("");
                setPoolGames({});
                setScenarios([]);
                setSavedTournaments([]);
                setTiebreakers(DEFAULT_TIEBREAKERS);
                setBracketSettings({ format:"single", elim:"single", byes:0, goldByes:0, silverByes:0, goldCount:4 });
                setShowAdvanced(false);
                setTab("setup");
              }, 50);
            }}>
            ↺ Reset
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {[["setup","⚙ Setup"],["scores","⚾ Pool Games"],["bracket","🏆 Bracket"],["scenarios","🔀 Scenarios"],["saved","📁 My Tournaments"]].map(([id,lbl])=>(
          <button key={id} className={`tab ${tab===id?"active":""}`} onClick={()=>setTab(id)}>{lbl}</button>
        ))}
      </div>

      {!hydrated ? (
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:"var(--muted)",fontSize:13,fontFamily:"var(--fm)"}}>
          Loading saved data…
        </div>
      ) : (
      <div className="main">

        {/* ── SETUP ── */}
        {tab==="setup" && (
          <div>
            {/* Paste import */}
            <div className="card">
              <div className="ctitle">📋 Import Teams</div>
              <p className="parse-hint">Paste a copied team list or table — AI will extract just the team names. Or add them one at a time below.</p>
              {pools.map((pool,i) => bulkOpen[i] ? (
                <div key={i} style={{marginBottom:10}}>
                  <div style={{fontSize:12,color:POOL_COLORS[i],fontWeight:600,marginBottom:6}}>{pool.name}</div>
                  <textarea className="input textarea" style={{minHeight:90}}
                    placeholder="Paste anything — table, webpage text, list..."
                    value={bulkText[i]||""}
                    onChange={e=>setBulkText(b=>({...b,[i]:e.target.value}))} />
                  <div style={{display:"flex",gap:6,marginTop:6}}>
                    <button className="btn btn-acc" disabled={!!bulkLoading[i]} onClick={()=>handleBulkAdd(i)}>
                      {bulkLoading[i]?"Extracting…":"Add Teams"}
                    </button>
                    <button className="btn btn-ghost" onClick={()=>setBulkOpen(b=>({...b,[i]:false}))}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button key={i} className="btn btn-ghost" style={{marginRight:8,marginBottom:4,fontSize:11}}
                  onClick={()=>setBulkOpen(b=>({...b,[i]:true}))}>
                  📋 Paste for {pool.name}
                </button>
              ))}
            </div>

            <div className="divider">or add manually</div>

            {/* Pool cards */}
            <div className="setup-grid" style={{gridTemplateColumns: pools.length === 1 ? "1fr" : undefined}}>
              {pools.map((pool,i) => (
                <div className="card" key={i} style={{marginBottom:0}}>
                  {pools.length > 1 && (
                    <div className="ctitle" style={{color:POOL_COLORS[i]}}>
                      ◈ <input
                        className="input"
                        style={{display:"inline",width:"auto",maxWidth:160,padding:"2px 8px",fontSize:17,fontFamily:"var(--fd)",letterSpacing:2,color:POOL_COLORS[i],background:"transparent",border:"1px solid transparent",borderRadius:4}}
                        placeholder={POOL_NAMES[i]}
                        value={pool.name}
                        onChange={e=>setPools(p=>p.map((pl,idx)=>idx===i?{...pl,name:e.target.value}:pl))}
                        onFocus={e=>e.target.style.borderColor=POOL_COLORS[i]}
                        onBlur={e=>e.target.style.borderColor="transparent"}
                      />
                      <button className="btn-danger" style={{marginLeft:"auto",fontSize:12}} onClick={()=>setPools(p=>p.filter((_,idx)=>idx!==i))}>✕</button>
                    </div>
                  )}
                  <div className="irow">
                    <input className="input" placeholder="Add team..." value={pool.newTeam}
                      onChange={e=>setPools(p=>p.map((pl,idx)=>idx===i?{...pl,newTeam:e.target.value}:pl))}
                      onKeyDown={e=>e.key==="Enter"&&addTeam(i)} />
                    <button className="btn btn-acc" onClick={()=>addTeam(i)}>Add</button>
                  </div>
                  <p style={{fontSize:11,color:"var(--muted)",marginBottom:6}}>Tap to claim · Double-click to rename</p>
                  <div className="tag-list">
                    {pool.teams.map(t=>(
                      <TeamTag key={t} name={t} isYours={t===yourTeam}
                        onClaim={()=>setYourTeam(t===yourTeam?"":t)}
                        onRemove={()=>removeTeam(i,t)}
                        onRename={n=>renameTeam(i,t,n)}
                      />
                    ))}
                    {!pool.teams.length && <span style={{fontSize:12,color:"var(--muted)"}}>No teams yet</span>}
                  </div>
                  <div style={{marginTop:10,fontSize:11,color:"var(--muted)"}}>
                    {pool.teams.length} teams → {expectedGames(pool.teams.length)} pool games
                  </div>
                </div>
              ))}
            </div>

            <div style={{marginTop:14}}>
              <button className="btn btn-ghost" style={{fontSize:11,opacity:.6}}
                onClick={()=>setShowAdvanced(s=>!s)}>
                {showAdvanced ? "▾ Advanced" : "▸ Advanced"} (multiple pools)
              </button>
              {showAdvanced && pools.length<4 && (
                <button className="btn btn-ghost" style={{marginLeft:8,fontSize:11}} onClick={addPool}>+ Add Pool</button>
              )}
            </div>
            {totalTeams>=2 && (
              <div className="alert alert-info" style={{marginTop:16}}>
                Ready — head to <strong>Scores</strong> to enter pool play games in order.
              </div>
            )}
            <p className="footnote">Tiebreakers apply in order top → bottom. Drag to reorder.</p>
            <div className="card" style={{marginTop:14}}>
              <div className="ctitle">◈ Tiebreaker Order</div>
              <p style={{fontSize:12,color:"var(--muted)",marginBottom:10}}>Drag to reorder, or pick a preset. Standings update instantly.</p>
              <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                <button className="btn btn-ghost" style={{fontSize:11}}
                  onClick={() => setTiebreakers(DEFAULT_TIEBREAKERS)}>
                  Standard
                </button>
                <button className="btn btn-ghost" style={{fontSize:11}}
                  onClick={() => setTiebreakers(PG_TIEBREAKERS)}>
                  ⚾ Perfect Game
                </button>
                <button className="btn btn-ghost" style={{fontSize:11}}
                  onClick={() => setTiebreakers(USSSA_TIEBREAKERS)}>
                  ⚾ USSSA
                </button>
              </div>
              <div className="tb-list">
                {tiebreakers.map((tb, idx) => (
                  <div key={tb.id} className="tb-item"
                    draggable
                    onDragStart={() => { dragTb.current = idx; }}
                    onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }}
                    onDragLeave={e => e.currentTarget.classList.remove("drag-over")}
                    onDrop={e => {
                      e.currentTarget.classList.remove("drag-over");
                      const from = dragTb.current;
                      if (from === null || from === idx) return;
                      setTiebreakers(prev => {
                        const next = [...prev];
                        const [moved] = next.splice(from, 1);
                        next.splice(idx, 0, moved);
                        return next;
                      });
                      dragTb.current = null;
                    }}
                  >
                    <span className="tb-rank">{idx + 1}</span>
                    <span className="tb-label">{tb.label}</span>
                    <span className="tb-handle">⠿</span>
                  </div>
                ))}
              </div>


            <div className="card" style={{marginBottom:20}}>
              <div className="ctitle">◈ Bracket Settings</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:24,alignItems:"flex-start"}}>
                <div className="bs-group">
                  <div className="bs-label">Elimination</div>
                  <div className="bs-options">
                    {[["single","Single"],["double","Double"]].map(([val,lbl])=>(
                      <button key={val} className={`bs-opt ${bracketSettings.elim===val?"active":""}`}
                        onClick={()=>setBracketSettings(s=>({...s,elim:val}))}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div className="bs-group">
                  <div className="bs-label">Grouping</div>
                  <div className="bs-options">
                    {[["single","One Bracket"],["gold-silver","Gold / Silver"]].map(([val,lbl])=>(
                      <button key={val} className={`bs-opt ${bracketSettings.format===val?"active":""}`}
                        onClick={()=>setBracketSettings(s=>({...s,format:val}))}>{lbl}</button>
                    ))}
                  </div>
                </div>
                {bracketSettings.format==="gold-silver" && (
                  <div className="bs-group">
                    <div className="bs-label">Gold split</div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:12,color:"var(--muted)"}}>Top</span>
                      <input type="text" inputMode="numeric" className="bs-select" style={{width:48,textAlign:"center"}}
                        value={bracketSettings.goldCount}
                        onChange={e=>setBracketSettings(s=>({...s,goldCount:e.target.value.replace(/[^0-9]/g,"")}))}
                        onBlur={e=>{
                          const v=parseInt(e.target.value);
                          setBracketSettings(s=>({...s,goldCount:Math.min(isNaN(v)?1:Math.max(1,v),totalTeams-1)}));
                        }}
                      />
                      <span style={{fontSize:12,color:"var(--accent)"}}>Gold</span>
                      <span style={{fontSize:12,color:"#9ca3af",marginLeft:2}}>/ rest Silver</span>
                    </div>
                  </div>
                )}
                {bracketSettings.format==="single" ? (
                  <div className="bs-group">
                    <div className="bs-label">Byes</div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:12,color:"var(--muted)"}}>Top</span>
                      <input type="text" inputMode="numeric" className="bs-select" style={{width:48,textAlign:"center"}}
                        value={bracketSettings.byes}
                        onChange={e=>setBracketSettings(s=>({...s,byes:e.target.value.replace(/[^0-9]/g,"")}))}
                        onBlur={e=>{
                          const v=parseInt(e.target.value);
                          setBracketSettings(s=>({...s,byes:Math.min(isNaN(v)?0:Math.max(0,v),totalTeams-2)}));
                        }}
                      />
                      <span style={{fontSize:12,color:"var(--muted)"}}>{bracketSettings.byes===0||bracketSettings.byes===""?"(none)":"get byes"}</span>
                    </div>
                  </div>
                ) : (
                  <div className="bs-group">
                    <div className="bs-label">Byes</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:11,color:"var(--accent)",width:44,flexShrink:0}}>Gold top</span>
                        <input type="text" inputMode="numeric" className="bs-select" style={{width:44,textAlign:"center"}}
                          value={bracketSettings.goldByes}
                          onChange={e=>setBracketSettings(s=>({...s,goldByes:e.target.value.replace(/[^0-9]/g,"")}))}
                          onBlur={e=>{
                            const v=parseInt(e.target.value);
                            setBracketSettings(s=>({...s,goldByes:Math.min(isNaN(v)?0:Math.max(0,v),Math.max(0,s.goldCount-2))}));
                          }}
                        />
                        <span style={{fontSize:11,color:"var(--muted)"}}>{bracketSettings.goldByes===0||bracketSettings.goldByes===""?"(none)":"byes"}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:11,color:"#9ca3af",width:44,flexShrink:0}}>Silver top</span>
                        <input type="text" inputMode="numeric" className="bs-select" style={{width:44,textAlign:"center"}}
                          value={bracketSettings.silverByes}
                          onChange={e=>setBracketSettings(s=>({...s,silverByes:e.target.value.replace(/[^0-9]/g,"")}))}
                          onBlur={e=>{
                            const v=parseInt(e.target.value);
                            const sc=totalTeams-bracketSettings.goldCount;
                            setBracketSettings(s=>({...s,silverByes:Math.min(isNaN(v)?0:Math.max(0,v),Math.max(0,sc-2))}));
                          }}
                        />
                        <span style={{fontSize:11,color:"var(--muted)"}}>{bracketSettings.silverByes===0||bracketSettings.silverByes===""?"(none)":"byes"}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {bracketSettings.elim==="double" && (
                <div className="alert alert-info" style={{marginTop:12,marginBottom:0}}>
                  Showing winners bracket — losers bracket depends on actual results.
                </div>
              )}
            </div>
            </div>
          </div>
        )}

        {/* ── SCORES ── */}
        {tab==="scores" && (
          <div>
            {totalTeams<2 ? (
              <div className="empty"><div className="icon">⚙️</div><div className="msg">Set up your pools first</div><div className="sub">Add teams in Setup</div></div>
            ) : (
              <>
                {pools.length>1 && (
                  <div className="pool-tabs">
                    {pools.map((p,i)=>(
                      <button key={i} className={`ptab ${activePool===i?"active":""}`}
                        style={activePool===i?{background:POOL_COLORS[i]}:{}}
                        onClick={()=>setActivePool(i)}>{p.name}</button>
                    ))}
                  </div>
                )}

                {[pools.length===1?0:activePool].map(pi => {
                  const pool = pools[pi];
                  const games = poolGames[pi]||[];
                  const poolStandings = standings[pi]||[];
                  const needed = expectedGames(pool.teams.length);

                  return (
                    <div key={pi}>
                      <div className="pool-header" style={{color:POOL_COLORS[pi]}}>{pool.name}</div>
                      <div className="pool-subhead">
                        {pool.teams.length} teams · {needed} pool games (each team plays 2) · enter in order
                      </div>

                      <div className="game-list">
                        {games.map((g,idx) => {
                          const scored = g.home && g.away && g.homeScore!=="" && g.awayScore!=="";
                          const isHypo = scored && !g.locked;
                          const homeIsYours = g.home === yourTeam;
                          const awayIsYours = g.away === yourTeam;

                          // Count games per team (excluding this game)
                          const gameCounts = {};
                          pool.teams.forEach(t => { gameCounts[t] = 0; });
                          games.forEach((gg, i2) => {
                            if (i2 === idx) return;
                            if (gg.home) gameCounts[gg.home] = (gameCounts[gg.home] || 0) + 1;
                            if (gg.away) gameCounts[gg.away] = (gameCounts[gg.away] || 0) + 1;
                          });
                          // Available = teams with < 2 games, plus whatever is already selected
                          const availableHome = pool.teams.filter(t => t === g.home || (gameCounts[t] || 0) < 2);
                          const availableAway = pool.teams.filter(t => t === g.away || (gameCounts[t] || 0) < 2);

                          return (
                            <div key={idx} className={`game-row ${g.locked?"locked":scored?"scored":""} ${isHypo?"hypo":""}`}>
                              {/* Game number / time */}
                              <div className="game-num">
                                <span className="game-num-label">G{idx+1}</span>
                                {g.time && <span className="game-num-time">{g.time}</span>}
                              </div>

                              {/* Home team */}
                              <select className={`team-select ${homeIsYours?"yours":""}`}
                                value={g.home} disabled={g.locked}
                                onChange={e=>updateGame(pi,idx,"home",e.target.value)}>
                                <option value="">— Team —</option>
                                {availableHome.map(t=><option key={t} value={t}>{t}</option>)}
                              </select>

                              {/* Scores */}
                              <div className="score-block">
                                <input className="score-input" type="text" inputMode="numeric" pattern="[0-9]*" placeholder="–"
                                  value={g.homeScore} disabled={g.locked}
                                  onChange={e=>{
                                    const v = e.target.value.replace(/[^0-9]/g,"");
                                    updateGame(pi,idx,"homeScore",v);
                                  }} />
                                <span className="score-dash">–</span>
                                <input className="score-input" type="text" inputMode="numeric" pattern="[0-9]*" placeholder="–"
                                  value={g.awayScore} disabled={g.locked}
                                  onChange={e=>{
                                    const v = e.target.value.replace(/[^0-9]/g,"");
                                    updateGame(pi,idx,"awayScore",v);
                                  }} />
                              </div>

                              {/* Away team */}
                              <select className={`team-select ${awayIsYours?"yours":""}`}
                                value={g.away} disabled={g.locked}
                                onChange={e=>updateGame(pi,idx,"away",e.target.value)}>
                                <option value="">— Team —</option>
                                {availableAway.map(t=><option key={t} value={t}>{t}</option>)}
                              </select>

                              {/* Actions: time + lock + delete */}
                              <div className="game-actions">
                                {!g.locked && (
                                  <input className="time-input" placeholder="9:00 AM"
                                    value={g.time||""}
                                    onChange={e=>updateGame(pi,idx,"time",e.target.value)}
                                    title="Game time (optional)" />
                                )}
                                <button className={`lock-btn ${g.locked?"locked":""}`}
                                  onClick={()=>updateGame(pi,idx,"locked",!g.locked)}
                                  title={g.locked?"Unlock to edit":"Lock as final result"}>
                                  {g.locked?"🔒":"🔓"}
                                </button>
                                {!g.locked && (
                                  <button className="del-btn" onClick={()=>removeGame(pi,idx)} title="Remove game">✕</button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <button className="add-game-btn" onClick={()=>addGame(pi)}>+ Add Game</button>

                      {/* Standings */}
                      {poolStandings.length>0 && games.some(g=>g.home&&g.away&&g.homeScore!==""&&g.awayScore!=="") && (
                        <div className="card" style={{marginTop:16}}>
                          <div className="ctitle" style={{color:POOL_COLORS[pi]}}>◈ {pool.name} Standings</div>
                          <table className="standings-table">
                            <thead>
                              <tr><th>#</th><th>Team</th><th>W-L-T</th><th>Win%</th><th>RD</th><th>RF</th><th>RA</th></tr>
                            </thead>
                            <tbody>
                              {poolStandings.map((s,rank)=>(
                                <tr key={s.team} className={s.team===yourTeam?"your-row":""}>
                                  <td><span className={`seed-badge s${rank<3?rank+1:"x"}`}>{rank+1}</span></td>
                                  <td style={{fontWeight:600,color:s.team===yourTeam?"var(--accent)":"var(--text)"}}>{s.team===yourTeam?"🏆 ":""}{s.team}</td>
                                  <td className="mono">{s.wins}-{s.losses}{s.ties>0?`-${s.ties}`:""}</td>
                                  <td className="mono">{s.gp ? s.wp.toFixed(3) : "—"}</td>
                                  <td className={s.rd>0?"rd-p":s.rd<0?"rd-n":"rd-z"}>{s.rd>0?"+":""}{s.rd}</td>
                                  <td className="mono">{s.rf}</td>
                                  <td className="mono">{s.ra}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* ── BRACKET ── */}
        {tab==="bracket" && (
          <div>
            {seededTeams.length<2 ? (
              <div className="empty"><div className="icon">🏆</div><div className="msg">No bracket yet</div><div className="sub">Add teams in Setup to see projections</div></div>
            ) : (
              <>
                {hasHypo && (
                  <div className="alert alert-hypo">◈ Some games are unlocked — bracket includes hypothetical scores</div>
                )}
                <div style={{fontSize:11,color:"var(--muted)",marginBottom:14,fontStyle:"italic"}}>
                  Bracket format, grouping, and byes are configured in <button onClick={()=>setTab("setup")} style={{background:"none",border:"none",color:"var(--accent2)",cursor:"pointer",fontSize:11,fontStyle:"italic",padding:0,textDecoration:"underline"}}>Setup</button>.
                </div>
                <div className="card" style={{marginBottom:20}}>
                  <div className="ctitle">◈ Overall Seeding</div>
                  <table className="standings-table">
                    <thead><tr><th>Seed</th><th>Team</th><th>Pool</th><th>W-L-T</th><th>Win%</th><th>RD</th></tr></thead>
                    <tbody>
                      {seededTeams.map((s,i)=>{
                        const st=standings[s.poolIdx]?.find(st=>st.team===s.team);
                        const isGold=bracketSettings.format==="gold-silver"&&i<bracketSettings.goldCount;
                        const isSilver=bracketSettings.format==="gold-silver"&&i>=bracketSettings.goldCount;
                        return (
                          <tr key={s.team} className={s.team===yourTeam?"your-row":""}>
                            <td><span className={`seed-badge s${i<3?i+1:"x"}`}>{i+1}</span></td>
                            <td style={{fontWeight:600,color:s.team===yourTeam?"var(--accent)":"var(--text)"}}>
                              {s.team===yourTeam?"🏆 ":""}{s.team}
                              {isGold&&<span style={{marginLeft:6,fontSize:9,background:"rgba(232,200,74,.2)",color:"var(--accent)",padding:"1px 5px",borderRadius:3,fontFamily:"var(--fm)",letterSpacing:1}}>GOLD</span>}
                              {isSilver&&<span style={{marginLeft:6,fontSize:9,background:"rgba(107,114,128,.2)",color:"#9ca3af",padding:"1px 5px",borderRadius:3,fontFamily:"var(--fm)",letterSpacing:1}}>SILVER</span>}
                            </td>
                            <td style={{fontFamily:"var(--fm)",fontSize:11,color:POOL_COLORS[s.poolIdx]||"var(--muted)"}}>{s.pool}</td>
                            <td className="mono">{st?.wins??0}-{st?.losses??0}{st?.ties>0?`-${st.ties}`:""}</td>
                            <td className="mono">{st?.gp?st.wp.toFixed(3):"—"}</td>
                            <td className={st?.rd>0?"rd-p":st?.rd<0?"rd-n":"rd-z"}>{st?.rd>0?"+":""}{st?.rd??0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {bracket.format==="gold-silver" ? (
                  <>
                    <VisualBracket matchups={bracket.gold} seededTeams={seededTeams} standings={standings} yourTeam={yourTeam} title="🥇 Gold Bracket" color="gold" />
                    <VisualBracket matchups={bracket.silver} seededTeams={seededTeams} standings={standings} yourTeam={yourTeam} title="🥈 Silver Bracket" color="silver" />
                  </>
                ) : (
                  <VisualBracket matchups={bracket.firstRound} seededTeams={seededTeams} standings={standings} yourTeam={yourTeam} />
                )}
              </>
            )}
          </div>
        )}

        {/* ── SCENARIOS ── */}
        {tab==="scenarios" && (
          <div>
            {pools.flatMap((_, pi) => (poolGames[pi]||[]).filter(g => !g.locked && g.home && g.away)).length === 0 ? (
              <div className="empty">
                <div className="icon">🔀</div>
                <div className="msg">No unlocked games</div>
                <div className="sub">Scenarios compare different outcomes for unlocked games. Lock real results in the Scores tab to set your baseline.</div>
              </div>
            ) : (
              <>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                  <p style={{fontSize:13,color:"var(--muted)",flex:1}}>
                    Each scenario uses your locked results as the baseline. Edit the unlocked games to explore different outcomes.
                  </p>
                  <button className="btn btn-acc" onClick={addScenario}>+ New Scenario</button>
                </div>

                {scenarios.length === 0 ? (
                  <div className="empty" style={{padding:"30px 20px"}}>
                    <div className="icon">✨</div>
                    <div className="msg">No scenarios yet</div>
                    <div className="sub">Hit "+ New Scenario" to start comparing outcomes</div>
                  </div>
                ) : (
                  <div className="scenario-grid">
                    {scenarios.map(scenario => {
                      const scenStandings = standingsForScenario(scenario.overrides);
                      const scenBracket = buildBracket(scenStandings, bracketSettings);
                      const baseBracket = buildBracket(allStandings(), bracketSettings);

                      const allScenTeams = scenBracket.seededTeams;

                      return (
                        <div className="scenario-card" key={scenario.id}>
                          <div className="scenario-header">
                            <input className="scenario-name-input"
                              value={scenario.name}
                              onChange={e=>updateScenarioName(scenario.id, e.target.value)}
                              placeholder="Scenario name…"
                            />
                            <button className="btn-danger" style={{fontSize:12}} onClick={()=>deleteScenario(scenario.id)}>✕</button>
                          </div>
                          <div className="scenario-body">

                            {/* Games */}
                            <div className="scenario-section-title">Pool Games</div>
                            {pools.flatMap((pool, pi) =>
                              (poolGames[pi]||[])
                                .filter(g => g.home && g.away)
                                .map(g => {
                                  const key = `${pi}:${g.idx}`;
                                  const ov = scenario.overrides[key] || {};
                                  const hs = g.locked ? g.homeScore : (ov.homeScore ?? "");
                                  const as2 = g.locked ? g.awayScore : (ov.awayScore ?? "");
                                  return (
                                    <div className="scenario-game" key={key}>
                                      <span className={`scenario-team ${g.home===yourTeam?"yours":""}`}>{g.home===yourTeam?"🏆 ":""}{g.home}</span>
                                      <input className="scenario-score" type="text" inputMode="numeric"
                                        value={hs} disabled={g.locked} placeholder="–"
                                        onChange={e=>updateScenarioScore(scenario.id, pi, g.idx, "homeScore", e.target.value.replace(/[^0-9]/g,""))}
                                      />
                                      <span className="scenario-dash">–</span>
                                      <input className="scenario-score" type="text" inputMode="numeric"
                                        value={as2} disabled={g.locked} placeholder="–"
                                        onChange={e=>updateScenarioScore(scenario.id, pi, g.idx, "awayScore", e.target.value.replace(/[^0-9]/g,""))}
                                      />
                                      <span className={`scenario-team ${g.away===yourTeam?"yours":""}`} style={{textAlign:"right"}}>{g.away===yourTeam?"🏆 ":""}{g.away}</span>
                                      {g.locked && <span className="scenario-lock-badge">🔒</span>}
                                    </div>
                                  );
                                })
                            )}

                            {/* Seeding */}
                            <div className="scenario-section-title" style={{marginTop:14}}>Projected Seeding</div>
                            {allScenTeams.map((s, i) => {
                              const st = scenStandings[s.poolIdx]?.find(x => x.team === s.team);
                              const baseSeedIdx = baseBracket.seededTeams.findIndex(x => x.team === s.team);
                              const diff = baseSeedIdx - i; // positive = improved vs baseline
                              return (
                                <div key={s.team} className={`scenario-seed-row ${s.team===yourTeam?"yours-row":""}`}>
                                  <span className="scenario-sr-seed">#{i+1}</span>
                                  <span className={`scenario-sr-name ${s.team===yourTeam?"hl":""}`}>{s.team===yourTeam?"🏆 ":""}{s.team}</span>
                                  <span className="scenario-sr-rec">{st?.wins??0}-{st?.losses??0}{st?.ties>0?`-${st.ties}`:""}</span>
                                  {diff !== 0 && baseSeedIdx >= 0 && (
                                    <span style={{fontSize:10,fontFamily:"var(--fm)",color:diff>0?"var(--green)":diff<0?"var(--red)":"var(--muted)",flexShrink:0}}>
                                      {diff>0?`▲${diff}`:`▼${Math.abs(diff)}`}
                                    </span>
                                  )}
                                </div>
                              );
                            })}

                            {/* Visual bracket */}
                            <div className="scenario-section-title" style={{marginTop:14}}>Bracket</div>
                            <div style={{transform:"scale(0.75)",transformOrigin:"top left",width:"133%",marginBottom:-40}}>
                              {scenBracket.format==="gold-silver" ? (
                                <>
                                  <VisualBracket matchups={scenBracket.gold} seededTeams={allScenTeams} standings={scenStandings} yourTeam={yourTeam} title="🥇 Gold" color="gold" />
                                  <VisualBracket matchups={scenBracket.silver} seededTeams={allScenTeams} standings={scenStandings} yourTeam={yourTeam} title="🥈 Silver" color="silver" />
                                </>
                              ) : (
                                <VisualBracket matchups={scenBracket.firstRound} seededTeams={allScenTeams} standings={scenStandings} yourTeam={yourTeam} />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {tab==="saved" && (
          <div>
            <div className="card">
              <div className="ctitle">💾 Save Current Tournament</div>
              <p style={{fontSize:12,color:"var(--muted)",marginBottom:12}}>
                Save a snapshot of your current pools, teams, and scores. Load or duplicate it anytime.
              </p>
              <div className="irow">
                <input className="input" placeholder={`Tournament ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}`}
                  value={tournamentName}
                  onChange={e=>setTournamentName(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&saveTournament()} />
                <button className="btn btn-acc" onClick={saveTournament}>Save</button>
              </div>
              <p style={{fontSize:11,color:"var(--muted)"}}>
                {pools.reduce((s,p)=>s+p.teams.length,0)} teams across {pools.length} pool{pools.length!==1?"s":""}
                {" · "}{Object.values(poolGames).flat().filter(g=>g.home&&g.away&&g.homeScore!==""&&g.awayScore!=="").length} scored games
              </p>
            </div>

            <div className="ctitle" style={{marginBottom:12}}>◈ Saved Tournaments</div>

            {savedTournaments.length===0 ? (
              <div className="empty" style={{padding:"30px 20px"}}>
                <div className="icon">📁</div>
                <div className="msg">No saved tournaments yet</div>
                <div className="sub">Save the current tournament above to get started</div>
              </div>
            ) : (
              <div className="tournament-list">
                {savedTournaments.map(t => {
                  const teamCount = t.pools.reduce((s,p)=>s+p.teams.length,0);
                  const gameCount = Object.values(t.poolGames||{}).flat().filter(g=>g.home&&g.away&&g.homeScore!==""&&g.awayScore!=="").length;
                  const date = new Date(t.savedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
                  return (
                    <div className="tournament-card" key={t.id}>
                      <div className="t-info">
                        <div className="t-name">{t.name}</div>
                        <div className="t-meta">{teamCount} teams · {gameCount} games scored · saved {date}</div>
                      </div>
                      <div className="t-actions">
                        <button className="btn btn-blue" style={{fontSize:11,padding:"6px 10px"}} onClick={()=>loadTournament(t)}>Load</button>
                        <button className="btn btn-ghost" style={{fontSize:11,padding:"6px 10px"}} onClick={()=>duplicateTournament(t)} title="Duplicate for scenario comparison">⧉ Copy</button>
                        <button className="btn-danger" style={{fontSize:13}} onClick={()=>deleteTournament(t.id)}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
