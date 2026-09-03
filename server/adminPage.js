// The master admin dashboard — one self-contained page, no external assets.
//
// Served by GET /admin (key-guarded) from index.js. Everything it shows comes
// from /api/admin/data, polled every five seconds; every action POSTs to an
// /api/admin/* route with the key in the body, and every one of those POSTs
// lands in the audit log the Moderation section shows.
//
// The page is an operations desk laid out as eight sections behind a fixed
// sidebar — Overview, Revenue, Players, Tables, Games, Economy, Moderation,
// System — each deep-linkable via location.hash, so /admin?key=K#players goes
// straight to the player table.
//
// The Overview is the front desk: a four-card hero row (revenue, players,
// live-now, games — each with an in-card 14-day sparkline), a subordinate
// stat strip, two 30-day area charts with real axes, a merged newest-first
// activity feed (games, ledger credits, sign-ups, admin actions), and the
// two most-used tools — broadcast and credit-coins — inlined as quick
// actions that reuse the section forms' endpoints.
//
// House rules the page follows:
//   - every user-controlled string (names, flags, emails, reasons, broadcast
//     text) goes through esc() before touching innerHTML;
//   - re-renders replace table bodies only, never the standing inputs, and
//     the inputs that DO live inside a re-rendered drawer are snapshotted and
//     restored around the swap — search, sort, scroll, the open drawer, the
//     active section and half-typed text all survive the five-second refresh;
//   - charts are hand-drawn SVG or plain divs, no libraries;
//   - no emoji in the chrome — bots are marked "(bot)" in plain text.
//
// NOTE for editors: this whole file is one template literal. Keep backticks,
// backslashes and the ${ sequence out of the page source — client-side JS
// here uses string concatenation only, on purpose (String.fromCharCode(10)
// stands in for the newline escape in the CSV code).

export const adminPageHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>MoneyMove — Master Admin</title>
<style>
  * { box-sizing: border-box; }
  html { color-scheme: dark; }
  body {
    margin: 0; padding: 22px clamp(14px, 3vw, 36px) 60px; padding-left: 232px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #efeadd; background-color: #0b120e; min-height: 100vh;
    background-image:
      radial-gradient(1100px 520px at 15% -8%, rgba(38, 84, 58, .55), transparent 60%),
      radial-gradient(900px 420px at 95% 0%, rgba(227, 169, 60, .08), transparent 55%);
  }
  h2 { font-size: 12px; margin: 0 0 12px; color: #a9b4a6; text-transform: uppercase; letter-spacing: 1.4px; font-weight: 600; }
  h2 .count { color: #e3a93c; margin-left: 6px; letter-spacing: normal; text-transform: none; }
  h3 { font-size: 13px; margin: 0 0 10px; color: #cfd8cb; font-weight: 600; }

  /* ------------------------------------------------------------ sidebar -- */
  aside {
    position: fixed; top: 0; left: 0; bottom: 0; width: 208px; z-index: 5;
    padding: 20px 14px 16px; display: flex; flex-direction: column; gap: 3px;
    background: linear-gradient(180deg, #101a13, #0b120e);
    border-right: 1px solid #1f2f26; overflow-y: auto;
  }
  aside .brand { font-size: 16px; font-weight: 700; margin: 0 8px 16px; letter-spacing: .2px; }
  aside .brand span { display: block; color: #e3a93c; font-size: 10px; letter-spacing: 1.6px; text-transform: uppercase; margin-top: 2px; }
  aside a { color: #a9b4a6; text-decoration: none; font-size: 13px; padding: 8px 11px; border-radius: 9px; border: 1px solid transparent; }
  aside a:hover { color: #efeadd; background: rgba(227, 169, 60, .06); }
  aside a.active { color: #e3a93c; background: rgba(227, 169, 60, .1); border-color: rgba(227, 169, 60, .25); font-weight: 600; }
  aside .spacer { flex: 1; }
  .status { font-size: 11px; color: #93a396; padding: 0 8px; line-height: 1.5; }
  .status .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #4fd98b; margin-right: 6px; vertical-align: 1px; }
  .status.err .dot { background: #e06c5f; }
  @media (max-width: 820px) {
    body { padding-left: clamp(14px, 3vw, 36px); padding-top: 96px; }
    aside { position: fixed; top: 0; left: 0; right: 0; bottom: auto; width: auto; flex-direction: row; align-items: center; overflow-x: auto; padding: 10px 12px; border-right: none; border-bottom: 1px solid #1f2f26; }
    aside .brand { display: none; }
    aside a { white-space: nowrap; }
    aside .status { display: none; }
  }

  /* ------------------------------------------------------------- panels -- */
  .panel { display: none; }
  .panel.active { display: block; }

  #alerts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; }
  #alerts:not(:empty) { margin-bottom: 14px; }
  .alert { border-radius: 12px; padding: 9px 13px; font-size: 12px; border: 1px solid; line-height: 1.45; }
  .alert.red { background: rgba(224, 108, 95, .1); border-color: #6b3a31; color: #f0b9ae; }
  .alert.amber { background: rgba(227, 169, 60, .09); border-color: #6b5426; color: #e9c67f; }
  .alert b { font-weight: 700; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .tile { background: linear-gradient(180deg, #16221b, #121b15); border: 1px solid #263a2e; border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 3px; }
  .tile b { font-size: 24px; color: #e3a93c; font-weight: 700; letter-spacing: .3px; }
  .tile span { font-size: 11px; color: #93a396; text-transform: uppercase; letter-spacing: 1px; }
  .tile em { font-style: normal; font-size: 11px; color: #b8c4b4; }

  /* ----------------------------------------------------- overview desk -- */
  .hero { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
  .hcard { background: linear-gradient(180deg, #16221b, #111a15); border: 1px solid #263a2e; border-radius: 16px; padding: 15px 17px 13px; display: flex; flex-direction: column; gap: 9px; min-width: 0; box-shadow: 0 8px 24px rgba(0, 0, 0, .25); }
  .hlabel { font-size: 11px; color: #93a396; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .hmain { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; row-gap: 6px; }
  .hbig { font-size: 33px; line-height: 1; color: #e3a93c; font-weight: 700; letter-spacing: .3px; white-space: nowrap; }
  .hbig small { font-size: 12px; color: #93a396; font-weight: 600; letter-spacing: .4px; }
  .hside { display: flex; gap: 13px; padding-bottom: 3px; flex-wrap: wrap; }
  .hside b { display: block; font-size: 14px; color: #efeadd; line-height: 1.1; white-space: nowrap; }
  .hside span { display: block; font-size: 9px; color: #7d8b7f; text-transform: uppercase; letter-spacing: .8px; margin-top: 2px; white-space: nowrap; }
  .hspark { margin-top: auto; }
  .hspark svg { width: 100%; height: 46px; display: block; }
  .hfoot { font-size: 11px; color: #93a396; line-height: 1.45; min-height: 15px; }
  .pulse { width: 8px; height: 8px; border-radius: 50%; background: #4fd98b; display: inline-block; flex: none; animation: pulse 1.8s ease-out infinite; }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(79, 217, 139, .55); }
    70% { box-shadow: 0 0 0 7px rgba(79, 217, 139, 0); }
    100% { box-shadow: 0 0 0 0 rgba(79, 217, 139, 0); }
  }
  .substrip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
  .scard { background: #121b15; border: 1px solid #1f2f26; border-radius: 12px; padding: 9px 15px; display: flex; align-items: center; gap: 10px; min-width: 0; }
  .scard b { font-size: 17px; color: #cfd8cb; font-weight: 700; white-space: nowrap; }
  .scard span { font-size: 10px; color: #7d8b7f; text-transform: uppercase; letter-spacing: 1px; line-height: 1.35; }
  .scard .microstack { flex: 1; display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: #0d1511; border: 1px solid #1f2f26; min-width: 34px; max-width: 90px; }
  .scard .microstack i { display: block; height: 100%; }
  .ovgrid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .ovcol { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .ovcol .card { margin-bottom: 0; }
  .feed { max-height: 420px; overflow-y: auto; }
  .feed-row { display: flex; gap: 10px; padding: 8px 4px; border-bottom: 1px solid #16241b; align-items: flex-start; font-size: 12.5px; }
  .feed-row:last-child { border-bottom: none; }
  .feed-row .glyph { flex: none; width: 26px; height: 26px; border-radius: 8px; background: #0e1712; border: 1px solid #24382c; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
  .feed-row .glyph svg { width: 14px; height: 14px; display: block; }
  .feed-row .ftext { flex: 1; min-width: 0; line-height: 1.45; color: #b8c4b4; overflow-wrap: break-word; }
  .feed-row .ftext b { color: #efeadd; font-weight: 600; }
  .feed-row .ftime { flex: none; font-size: 11px; color: #7d8b7f; padding-top: 2px; white-space: nowrap; }
  .qa-label { font-size: 11px; color: #93a396; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .qa-row { display: flex; gap: 8px; align-items: center; }
  .qa-row input { min-width: 0; }
  .qa-row .btn { flex: none; }
  @media (max-width: 1150px) {
    .hero, .substrip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .ovgrid { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 640px) {
    .hero, .substrip { grid-template-columns: minmax(0, 1fr); }
    .hbig { font-size: 28px; }
  }

  .card { background: linear-gradient(180deg, #15201a, #111a15); border: 1px solid #263a2e; border-radius: 16px; padding: 16px 18px; margin-bottom: 18px; box-shadow: 0 8px 24px rgba(0, 0, 0, .25); }
  .cards { display: flex; gap: 16px; flex-wrap: wrap; align-items: stretch; }
  .cards .card { flex: 1 1 320px; min-width: 0; }

  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #1f2f26; vertical-align: top; }
  th { color: #7d8b7f; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .8px; position: sticky; top: 0; background: #131d17; z-index: 1; white-space: nowrap; }
  th.sortable { cursor: pointer; color: #cfd8cb; }
  th.sortable:hover { color: #e3a93c; }
  .scroll { overflow: auto; border: 1px solid #1f2f26; border-radius: 10px; }
  .scroll > table > tbody > tr:hover td { background: rgba(227, 169, 60, .03); }
  tr.row:hover td { background: rgba(227, 169, 60, .05) !important; cursor: pointer; }
  tr.open td { background: rgba(227, 169, 60, .07); }
  .detail-box { background: #0e1712; border: 1px solid #24382c; border-radius: 10px; padding: 14px; margin: 4px 0 8px; display: flex; flex-direction: column; gap: 14px; align-items: flex-start; }
  .detail-box table th { position: static; }
  .detail-box .inner-scroll { max-height: 200px; overflow: auto; border: 1px solid #1f2f26; border-radius: 8px; width: 100%; }

  .facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px 18px; width: 100%; }
  .facts b { display: block; font-size: 13px; color: #efeadd; font-weight: 600; word-break: break-word; }
  .facts span { display: block; font-size: 10px; color: #93a396; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }

  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .pill.ok { background: rgba(79, 217, 139, .12); color: #4fd98b; }
  .pill.warn { background: rgba(227, 169, 60, .14); color: #e3a93c; }
  .pill.dim { background: rgba(150, 160, 150, .12); color: #93a396; }
  .pill.bad { background: rgba(224, 108, 95, .14); color: #e88a7d; }
  .bot { color: #93a396; font-size: 11px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .dim { color: #93a396; }
  .gold { color: #e3a93c; font-weight: 600; }
  .ok { color: #4fd98b; }
  .hint { font-size: 12px; color: #93a396; margin: -6px 0 10px; }
  .caption { font-size: 12px; color: #93a396; margin-top: 8px; }
  .legend { display: flex; gap: 14px; margin-top: 10px; font-size: 12px; color: #b8c4b4; flex-wrap: wrap; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
  .idsplit { display: flex; gap: 26px; margin-top: 14px; flex-wrap: wrap; }
  .idsplit b { display: block; font-size: 20px; color: #efeadd; }
  .idsplit span { font-size: 11px; color: #93a396; text-transform: uppercase; letter-spacing: 1px; }

  .chart svg { width: 100%; height: auto; display: block; }
  .axis { fill: #7d8b7f; font-size: 10px; }
  .empty { fill: #7d8b7f; font-size: 13px; }

  .hbar { display: flex; align-items: center; gap: 10px; margin: 7px 0; font-size: 12px; }
  .hbar .lbl { width: 130px; color: #b8c4b4; text-align: right; flex: none; }
  .hbar .track { flex: 1; background: #0d1511; border: 1px solid #1f2f26; border-radius: 6px; height: 16px; overflow: hidden; }
  .hbar .fill { height: 100%; border-radius: 5px; min-width: 2px; }
  .hbar .val { width: 170px; color: #cfd8cb; flex: none; }

  .stack { display: flex; height: 26px; border-radius: 8px; overflow: hidden; border: 1px solid #1f2f26; background: #0d1511; }
  .stack i { display: block; height: 100%; }

  input, textarea { background: #0d1511; border: 1px solid #2a4033; color: #efeadd; border-radius: 10px; padding: 9px 12px; font: inherit; width: 100%; }
  input:focus, textarea:focus { outline: none; border-color: #e3a93c; }
  #search { max-width: 420px; }
  .toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .field { margin-bottom: 10px; }
  .field label { font-size: 11px; color: #93a396; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px; }
  .btn { background: #e3a93c; color: #171207; border: none; border-radius: 10px; padding: 9px 16px; font: inherit; font-weight: 700; cursor: pointer; }
  .btn:hover { filter: brightness(1.08); }
  a.btn { text-decoration: none; display: inline-block; }
  .btn.ghost { background: transparent; color: #e3a93c; border: 1px solid rgba(227, 169, 60, .4); font-weight: 600; }
  .btn.ghost:hover { background: rgba(227, 169, 60, .08); filter: none; }
  .danger { background: #3a1f1b; color: #f0b9ae; border: 1px solid #6b3a31; border-radius: 10px; padding: 8px 14px; font: inherit; font-weight: 600; cursor: pointer; }
  .danger:hover { background: #4a2620; }
  .btn.sm, .danger.sm { padding: 5px 11px; font-size: 12px; }
  .msg { font-size: 12px; margin-top: 10px; min-height: 16px; }
  .msg.ok { color: #4fd98b; }
  .msg.err { color: #e06c5f; }
  .divider { border: none; border-top: 1px solid #1f2f26; margin: 16px 0; }
  .mini-forms { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-end; width: 100%; }
  .mini { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
  .mini .field { margin-bottom: 0; }
  .mini input { width: 120px; }
  .mini input.wide { width: 190px; }
</style>
</head>
<body>
<aside id="nav">
  <div class="brand">MoneyMove<span>Master Admin</span></div>
  <a href="#overview">Overview</a>
  <a href="#revenue">Revenue</a>
  <a href="#players">Players</a>
  <a href="#tables">Tables</a>
  <a href="#games">Games</a>
  <a href="#economy">Economy</a>
  <a href="#moderation">Moderation</a>
  <a href="#system">System</a>
  <div class="spacer"></div>
  <div id="status" class="status"></div>
</aside>
<main>

  <section class="panel" id="sec-overview">
    <div id="alerts"></div>
    <div class="hero" id="hero"></div>
    <div class="substrip" id="substrip"></div>
    <div class="ovgrid">
      <div class="ovcol">
        <div class="card">
          <h2>Games per day — last 30</h2>
          <div id="ov-games" class="chart"></div>
          <div id="ov-games-cap" class="caption"></div>
        </div>
        <div class="card">
          <h2>New players per day — last 30</h2>
          <div id="ov-newp" class="chart"></div>
          <div id="ov-newp-cap" class="caption"></div>
        </div>
      </div>
      <div class="ovcol">
        <div class="card">
          <h2>Quick actions</h2>
          <div class="qa-label">Broadcast to every connected client</div>
          <div class="qa-row">
            <input id="qa-bmsg" autocomplete="off" maxlength="200" placeholder="Maintenance in 10 minutes — finish your turns">
            <button class="btn sm" id="qa-bgo" type="button">Send</button>
          </div>
          <div class="msg" id="qa-bres"></div>
          <hr class="divider" style="margin:10px 0 12px">
          <div class="qa-label">Credit coins to a friend code</div>
          <div class="qa-row">
            <input id="qa-code" autocomplete="off" spellcheck="false" placeholder="Code" style="width:104px;flex:none">
            <input id="qa-coins" type="number" min="1" step="1" placeholder="Coins" style="width:86px;flex:none">
            <input id="qa-reason" autocomplete="off" placeholder="Reason — refund, prize...">
            <button class="btn sm" id="qa-cgo" type="button">Credit</button>
          </div>
          <div class="msg" id="qa-cres"></div>
        </div>
        <div class="card">
          <h2>Activity <span class="count" id="feedcount"></span></h2>
          <div class="feed" id="feed"></div>
        </div>
      </div>
    </div>
  </section>

  <section class="panel" id="sec-revenue">
    <section class="card">
      <h2>Revenue — last 30 days</h2>
      <div id="revchart" class="chart"></div>
      <div class="legend">
        <span><i style="background:#7ba0f2"></i>Stripe</span>
        <span><i style="background:#b9c7bd"></i>Apple</span>
        <span><i style="background:#e3a93c"></i>Other</span>
      </div>
      <div id="revcaption" class="caption"></div>
    </section>
    <div class="cards">
      <div class="card">
        <h2>Revenue by pack</h2>
        <div id="bypack"></div>
      </div>
      <div class="card">
        <h2>Paying players</h2>
        <div class="idsplit" id="revstats"></div>
        <div class="caption">ARPU is total ledger revenue over distinct buyers — everyone who ever paid, not just this month.</div>
      </div>
    </div>
    <section class="card">
      <h2>Purchases <span class="count" id="purchasecount"></span></h2>
      <div class="toolbar"><button class="btn ghost sm" id="csv-ledger" type="button">Export ledger CSV</button></div>
      <div class="scroll" style="max-height:380px"><table><tbody id="purchases"></tbody></table></div>
    </section>
  </section>

  <section class="panel" id="sec-players">
    <section class="card">
      <h2>Players <span class="count" id="playercount"></span></h2>
      <p class="hint">Click a player to open their record — wallet, purchases, and the actions that apply to them.</p>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Filter by code, name, email or provider" autocomplete="off" spellcheck="false">
        <button class="btn ghost sm" id="csv-players" type="button">Export players CSV</button>
      </div>
      <div class="scroll" style="max-height:520px"><table><tbody id="playersT"></tbody></table></div>
    </section>
    <section class="card" style="max-width:460px">
      <h2>Credit coins</h2>
      <div class="field"><label for="c-code">Friend code</label><input id="c-code" autocomplete="off" spellcheck="false" placeholder="e.g. QK7M2X"></div>
      <div class="field"><label for="c-coins">Coins</label><input id="c-coins" type="number" min="1" step="1" placeholder="500"></div>
      <div class="field"><label for="c-reason">Reason</label><input id="c-reason" autocomplete="off" placeholder="Refund, prize, goodwill..."></div>
      <button class="btn" id="c-go">Credit coins</button>
      <div class="msg" id="actionmsg"></div>
    </section>
  </section>

  <section class="panel" id="sec-tables">
    <div class="cards">
      <div class="card">
        <h2>Seats right now</h2>
        <div id="occupancy"></div>
      </div>
      <div class="card">
        <h2>Quick-match queue</h2>
        <p class="hint">Open quick lobbies and their fuse — the countdown to bots filling the empty chairs.</p>
        <div class="scroll" style="max-height:220px"><table><tbody id="quickT"></tbody></table></div>
      </div>
    </div>
    <section class="card">
      <h2>Live rooms <span class="count" id="roomcount"></span></h2>
      <p class="hint">Click a room to inspect its players, kick a seat or close it. Playing tables sort first.</p>
      <div class="scroll" style="max-height:440px"><table><tbody id="roomsT"></tbody></table></div>
    </section>
    <section class="card" style="max-width:460px">
      <h2>Close a room</h2>
      <div class="field"><label for="k-room">Room id</label><input id="k-room" autocomplete="off" spellcheck="false" placeholder="e.g. x7km2"></div>
      <button class="danger" id="k-go">Close room</button>
      <div class="msg" id="closemsg"></div>
    </section>
  </section>

  <section class="panel" id="sec-games">
    <section class="card">
      <h2>Games per day — last 30</h2>
      <div id="gameschart" class="chart"></div>
      <div id="gamescaption" class="caption"></div>
    </section>
    <section class="card">
      <h2>Recent games <span class="count" id="gamecount"></span></h2>
      <div class="scroll" style="max-height:420px"><table><tbody id="games"></tbody></table></div>
    </section>
  </section>

  <section class="panel" id="sec-economy">
    <section class="card">
      <h2>Coin flows</h2>
      <div id="flows"></div>
      <div class="caption">Mints are read off the ledger — win payouts only started writing entries when this panel shipped, so older payouts are invisible here. Burn is the list price of every cosmetic currently sitting in a wallet.</div>
    </section>
    <div class="cards">
      <div class="card">
        <h2>Top wallets</h2>
        <div class="scroll" style="max-height:380px"><table><tbody id="wallets"></tbody></table></div>
      </div>
      <div class="card">
        <h2>Karma distribution</h2>
        <div id="karma" class="chart"></div>
        <div class="idsplit" id="identity"></div>
      </div>
    </div>
  </section>

  <section class="panel" id="sec-moderation">
    <div class="cards">
      <div class="card">
        <h2>Broadcast</h2>
        <p class="hint">One line to every connected client, in and out of games, as the toast their UI already renders.</p>
        <div class="field"><label for="b-msg">Message</label><input id="b-msg" autocomplete="off" maxlength="200" placeholder="Maintenance in 10 minutes — finish your turns"></div>
        <button class="btn" id="b-go">Send to everyone</button>
        <div class="msg" id="bmsg"></div>
      </div>
      <div class="card">
        <h2>Ban a device</h2>
        <p class="hint">Bans stick to the device token behind a friend code — renaming does not shake one off.</p>
        <div class="field"><label for="m-code">Friend code</label><input id="m-code" autocomplete="off" spellcheck="false" placeholder="e.g. QK7M2X"></div>
        <div class="field"><label for="m-reason">Reason</label><input id="m-reason" autocomplete="off" placeholder="Abuse, spam, chargeback..."></div>
        <button class="danger" id="m-go">Ban this device</button>
        <div class="msg" id="modmsg"></div>
      </div>
    </div>
    <section class="card">
      <h2>Banned devices <span class="count" id="bancount"></span></h2>
      <div class="scroll" style="max-height:280px"><table><tbody id="bansT"></tbody></table></div>
    </section>
    <section class="card">
      <h2>Audit log <span class="count" id="auditcount"></span></h2>
      <p class="hint">Every admin action this server has taken, newest first. The file survives restarts.</p>
      <div class="scroll" style="max-height:420px"><table><tbody id="auditT"></tbody></table></div>
    </section>
  </section>

  <section class="panel" id="sec-system">
    <section class="tiles" id="systiles"></section>
    <section class="card">
      <h2>Persistence</h2>
      <div id="persist"></div>
    </section>
    <section class="card">
      <h2>Stripe webhook</h2>
      <div id="webhookT"></div>
    </section>
    <section class="card">
      <h2>Backups</h2>
      <div id="backupT"></div>
      <div style="margin-top:10px"><a class="btn sm" id="backup-dl" href="#" download>Download backup</a></div>
      <div class="caption" style="margin-top:8px">A copy of every data file lands in backup/ daily, kept a week — same disk as the originals, so it survives accidents, not outages. The button downloads the live files to somewhere that does.</div>
    </section>
    <section class="card">
      <h2>Configuration</h2>
      <div class="scroll"><table><tbody id="configT"></tbody></table></div>
    </section>
  </section>

</main>
<script>
(function () {
  'use strict';
  var KEY = new URLSearchParams(location.search).get('key') || '';
  var state = {
    data: null, search: '', sort: null, dir: -1,
    expanded: null, expandedPlayer: null, drawerMsg: null,
    lastFetch: 0, error: false,
  };
  var DAY = 86400000;
  var NL = String.fromCharCode(10);

  // ------------------------------------------------------------- helpers --
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(n) { return Number(n || 0).toLocaleString('en-US'); }
  function fmtUsd(n) { return '$' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2); }
  function dateLabel(t) { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function fmtWhen(t) {
    if (!t) return '—';
    var d = new Date(t);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function fmtAge(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    if (h < 48) return h + 'h ' + (m % 60) + 'm';
    return Math.floor(h / 24) + 'd';
  }
  function fmtBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return fmtNum(n) + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function fmtUptime(sec) {
    var s = Math.floor(sec || 0);
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm ' + (s % 60) + 's';
  }
  function dayStart(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function lastNDays(n) {
    var days = [], now = Date.now();
    for (var i = n - 1; i >= 0; i--) days.push(dayStart(now - i * DAY));
    return days;
  }
  function last30Days() { return lastNDays(30); }
  function fmtAgo(t) {
    var s = Math.floor((Date.now() - t) / 1000);
    if (s < 45) return 'now';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }
  /** innerHTML swap that keeps the nearest scroll container where it was. */
  function swap(id, html) {
    var el = document.getElementById(id);
    if (!el) return;
    var sc = el.closest ? el.closest('.scroll') : null;
    var top = sc ? sc.scrollTop : 0;
    var left = sc ? sc.scrollLeft : 0;
    el.innerHTML = html;
    if (sc) { sc.scrollTop = top; sc.scrollLeft = left; }
  }
  /**
   * A render that rebuilds a region containing inputs: snapshot their values
   * and the caret first, put everything back after. Half-typed text must
   * survive the five-second refresh or the drawer is unusable.
   */
  function keepInputs(ids, renderFn) {
    var saved = {}, i, el;
    var active = document.activeElement;
    var focusId = active && active.id && ids.indexOf(active.id) >= 0 ? active.id : null;
    for (i = 0; i < ids.length; i++) {
      el = document.getElementById(ids[i]);
      if (el) saved[ids[i]] = el.value;
    }
    renderFn();
    for (i = 0; i < ids.length; i++) {
      el = document.getElementById(ids[i]);
      if (el && saved[ids[i]] != null) el.value = saved[ids[i]];
    }
    if (focusId) {
      el = document.getElementById(focusId);
      if (el) {
        el.focus();
        try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) { /* number inputs refuse */ }
      }
    }
  }
  function post(url, body, cb) {
    body.key = KEY;
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }); })
      .then(cb)
      .catch(function () { cb({ error: 'Network error' }); });
  }
  function csvText(rows) {
    return rows.map(function (row) {
      return row.map(function (v) {
        var s = String(v == null ? '' : v);
        var needs = s.indexOf('"') >= 0 || s.indexOf(',') >= 0 || s.indexOf(NL) >= 0;
        return needs ? '"' + s.split('"').join('""') + '"' : s;
      }).join(',');
    }).join(NL);
  }
  function downloadCsv(name, rows) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csvText(rows)], { type: 'text/csv' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function iso(t) { return t ? new Date(t).toISOString() : ''; }
  /** Bucket items into the given day list; val(it) weighs each item (default 1). */
  function perDayOver(days, items, at, val) {
    var map = {};
    days.forEach(function (d) { map[d] = 0; });
    items.forEach(function (it) {
      var t = at(it);
      if (!t) return;
      var d = dayStart(t);
      if (map[d] != null) map[d] += val ? val(it) : 1;
    });
    return days.map(function (d) { return map[d]; });
  }
  function perDay(items, at) { return perDayOver(last30Days(), items, at); }
  function gradientDefs(id, color) {
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + color + '" stop-opacity=".32"/>' +
      '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>';
  }
  /** Tiny in-card sparkline: gradient area + line; dashed baseline when flat. */
  function miniSpark(counts, color, id) {
    var W = 160, H = 46, pad = 4;
    var max = 0;
    counts.forEach(function (c) { if (c > max) max = c; });
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">';
    if (max <= 0) {
      return svg + '<line x1="' + pad + '" y1="' + (H - 8) + '" x2="' + (W - pad) + '" y2="' + (H - 8) +
        '" stroke="#2a4033" stroke-width="1.5" stroke-dasharray="2 5" stroke-linecap="round"/></svg>';
    }
    var pts = counts.map(function (c, i) {
      var x = pad + (counts.length > 1 ? i * (W - 2 * pad) / (counts.length - 1) : (W - 2 * pad) / 2);
      var y = H - 6 - c * (H - 15) / max;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    svg += gradientDefs(id, color);
    svg += '<path d="M' + pad + ',' + (H - 2) + ' L' + pts.join(' L') + ' L' + (W - pad) + ',' + (H - 2) +
      ' Z" fill="url(#' + id + ')"/>';
    svg += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color +
      '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    var lastPt = pts[pts.length - 1].split(',');
    svg += '<circle cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="2.6" fill="' + color + '"/>';
    return svg + '</svg>';
  }
  /**
   * The workhorse day-series chart: labeled y ticks, faint weekly verticals,
   * gradient area under the line, a hoverable dot per day — and a designed
   * skeleton (grid + dashed baseline + one line of copy) when there is no
   * data yet, never a lone flat line.
   */
  function areaChart(days, counts, o) {
    var W = 640, H = o.h || 190, padL = 46, padR = 12, padT = 12, padB = 24;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var max = 0;
    counts.forEach(function (c) { if (c > max) max = c; });
    var xFor = function (i) { return padL + (days.length > 1 ? i * plotW / (days.length - 1) : plotW / 2); };
    var yFor = function (v) { return H - padB - (max > 0 ? v / max * plotH : 0); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img">';
    var i;
    for (i = 7; i < days.length; i += 7) {
      svg += '<line x1="' + xFor(i).toFixed(1) + '" y1="' + padT + '" x2="' + xFor(i).toFixed(1) +
        '" y2="' + (H - padB) + '" stroke="#16251c" stroke-width="1"/>';
    }
    var ticks = max >= 4 ? [0, 0.5, 1] : [0, 1];
    ticks.forEach(function (f) {
      var y = H - padB - f * plotH;
      svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) +
        '" stroke="#1e2f24" stroke-width="1"/>';
      var lbl = max > 0 ? (o.fmt ? o.fmt(max * f) : String(Math.round(max * f))) : (f === 0 ? '0' : '');
      if (lbl) svg += '<text x="' + (padL - 7) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" class="axis">' + lbl + '</text>';
    });
    [0, Math.floor((days.length - 1) / 2), days.length - 1].forEach(function (di) {
      svg += '<text x="' + xFor(di).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" class="axis">' + dateLabel(days[di]) + '</text>';
    });
    if (max > 0) {
      var pts = counts.map(function (c, ci) { return xFor(ci).toFixed(1) + ',' + yFor(c).toFixed(1); });
      svg += gradientDefs(o.id, o.color);
      svg += '<path d="M' + xFor(0).toFixed(1) + ',' + (H - padB) + ' L' + pts.join(' L') + ' L' +
        xFor(days.length - 1).toFixed(1) + ',' + (H - padB) + ' Z" fill="url(#' + o.id + ')"/>';
      svg += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + o.color +
        '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      counts.forEach(function (c, ci) {
        svg += '<circle cx="' + xFor(ci).toFixed(1) + '" cy="' + yFor(c).toFixed(1) + '" r="2.4" fill="' + o.color +
          '" fill-opacity="' + (c > 0 ? '1' : '.3') + '"><title>' + dateLabel(days[ci]) + ' — ' +
          (o.tip ? o.tip(c) : c) + '</title></circle>';
      });
    } else {
      svg += '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) +
        '" stroke="#2a4033" stroke-width="1.5" stroke-dasharray="3 6" stroke-linecap="round"/>';
      svg += '<text x="' + (padL + plotW / 2).toFixed(1) + '" y="' + (padT + plotH / 2 + 4).toFixed(1) +
        '" text-anchor="middle" class="empty">' + o.empty + '</text>';
    }
    return svg + '</svg>';
  }
  /** Seats at live tables as a strip of little squares: gold humans, sage bots, hollow empties. */
  function seatStrip(humans, bots, empty) {
    var W = 160, H = 46;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMinYMid meet" aria-hidden="true">';
    var total = humans + bots + empty;
    if (total <= 0) {
      return svg + '<line x1="4" y1="' + (H - 8) + '" x2="' + (W - 4) + '" y2="' + (H - 8) +
        '" stroke="#2a4033" stroke-width="1.5" stroke-dasharray="2 5" stroke-linecap="round"/></svg>';
    }
    var cells = [];
    var cap = 20, i;
    var take = function (n, color, hollow) {
      for (var k = 0; k < n; k++) cells.push({ c: color, hollow: hollow });
    };
    if (total <= cap) {
      take(humans, '#e3a93c'); take(bots, '#5d7a66'); take(empty, '#1b2a20', true);
    } else {
      var hN = Math.round(humans / total * cap), bN = Math.round(bots / total * cap);
      var eN = Math.max(0, cap - hN - bN);
      take(hN, '#e3a93c'); take(bN, '#5d7a66'); take(eN, '#1b2a20', true);
      // Two .5 shares both rounding up can mint a 21st cell — clip to the cap
      // so the strip never grows a clipped third row.
      if (cells.length > cap) cells.length = cap;
    }
    var size = 11, gap = 4, per = 10;
    var yBase = cells.length > per ? 8 : 14;
    for (i = 0; i < cells.length; i++) {
      var col = i % per, row = Math.floor(i / per);
      svg += '<rect x="' + (2 + col * (size + gap)).toFixed(1) + '" y="' + (yBase + row * (size + gap)).toFixed(1) +
        '" width="' + size + '" height="' + size + '" rx="3" fill="' + cells[i].c + '"' +
        (cells[i].hollow ? ' stroke="#24382c" stroke-width="1"' : '') + '/>';
    }
    return svg + '</svg>';
  }
  /** Hand-drawn 16x16 stroke glyphs for the activity feed. */
  function glyph(kind) {
    var s = '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke="';
    if (kind === 'game') {
      return s + '#4fd98b"><path d="M5 2.8h6v3.6a3 3 0 0 1-6 0z"/>' +
        '<path d="M5 3.8H3.2a2.3 2.3 0 0 0 2 2.6M11 3.8h1.8a2.3 2.3 0 0 1-2 2.6"/>' +
        '<path d="M8 9.4v2M5.8 13.4h4.4"/></svg>';
    }
    if (kind === 'coin') {
      return s + '#e3a93c"><circle cx="8" cy="8" r="5.6"/><circle cx="8" cy="8" r="2.3"/></svg>';
    }
    if (kind === 'join') {
      return s + '#b9c7bd"><circle cx="8" cy="5.4" r="2.5"/><path d="M3.6 13c.7-2.7 2.4-4.1 4.4-4.1s3.7 1.4 4.4 4.1"/></svg>';
    }
    if (kind === 'admin') {
      return s + '#e88a7d"><path d="M8 2.2l4.6 1.7v3.3c0 2.9-1.8 4.9-4.6 6.4-2.8-1.5-4.6-3.5-4.6-6.4V3.9z"/></svg>';
    }
    return s + '#93a396"><circle cx="8" cy="8" r="5.5"/></svg>';
  }

  // ------------------------------------------------------------ sections --
  var SECTIONS = ['overview', 'revenue', 'players', 'tables', 'games', 'economy', 'moderation', 'system'];
  function applySection() {
    var sec = (location.hash || '').replace('#', '');
    if (SECTIONS.indexOf(sec) < 0) sec = 'overview';
    var i;
    var panels = document.querySelectorAll('.panel');
    for (i = 0; i < panels.length; i++) panels[i].classList.toggle('active', panels[i].id === 'sec-' + sec);
    var links = document.querySelectorAll('#nav a');
    for (i = 0; i < links.length; i++) links[i].classList.toggle('active', links[i].getAttribute('href') === '#' + sec);
  }
  window.addEventListener('hashchange', applySection);

  // -------------------------------------------------------------- render --
  function renderStatus() {
    var el = document.getElementById('status');
    if (state.error) {
      el.className = 'status err';
      el.innerHTML = '<span class="dot"></span>connection lost — retrying';
    } else {
      el.className = 'status';
      el.innerHTML = '<span class="dot"></span>live · refreshes every 5s<br>updated ' +
        new Date(state.lastFetch).toLocaleTimeString();
    }
  }

  function renderAlerts() {
    var c = state.data.config || {};
    var wh = (state.data.system || {}).webhook || {};
    var html = '';
    if (wh.failing) {
      html += '<div class="alert red"><b>The Stripe webhook is failing.</b> The most recent delivery was rejected' +
        (wh.lastFailure ? ' ' + fmtAgo(wh.lastFailure.at) + ' (' + esc(wh.lastFailure.reason || 'no reason recorded') + ')' : '') +
        (wh.lastSuccess ? '; the last good one landed ' + fmtAgo(wh.lastSuccess) + '.' : ' and none has ever succeeded.') +
        ' Card payments are completing at Stripe without crediting coins here.</div>';
    }
    if (!c.dataDirEnv) {
      html += '<div class="alert red"><b>DATA_DIR is not set.</b> Wallets, the ledger, bans, stats and the audit log live in the repo folder and are wiped on the next deploy. Point DATA_DIR at a persistent disk.</div>';
    }
    if (c.adminKeyDefault) {
      html += '<div class="alert red"><b>The admin key is still the default.</b> Anyone who reads the source can open this page — set ADMIN_KEY in the environment.</div>';
    }
    if (c.stripe && !c.stripeWebhook) {
      html += '<div class="alert red"><b>STRIPE_WEBHOOK_SECRET is missing.</b> Card checkouts will complete at Stripe and never credit coins here — every web sale becomes a support ticket.</div>';
    } else if (!c.stripe) {
      html += '<div class="alert amber"><b>Stripe is not configured</b> — the web store cannot take card payments. Only App Store purchases can credit coins.</div>';
    }
    document.getElementById('alerts').innerHTML = html;
  }

  function tileHtml(v, label, sub) {
    return '<div class="tile"><b>' + esc(v) + '</b><span>' + esc(label) + '</span>' +
      (sub ? '<em>' + esc(sub) + '</em>' : '') + '</div>';
  }

  function renderHero() {
    var t = state.data.totals || {};
    var r = state.data.revenue || {};
    var days14 = lastNDays(14);
    var paid = (state.data.ledger || []).filter(function (e) { return e.usd > 0; });
    var games = state.data.recentGames || [];
    var profs = state.data.profiles || [];
    var revSpark = perDayOver(days14, paid, function (e) { return e.at; }, function (e) { return e.usd; });
    var gSpark = perDayOver(days14, games, function (g) { return g.at; });
    var pSpark = perDayOver(days14, profs, function (p) { return p.created; });
    var today = dayStart(Date.now());
    var weekAgo = Date.now() - 7 * DAY;
    var gToday = 0, g14 = 0, newWeek = 0;
    games.forEach(function (g) {
      if (g.at >= today) gToday++;
      if (g.at >= today - 13 * DAY) g14++;
    });
    profs.forEach(function (p) { if (p.created && p.created >= weekAgo) newWeek++; });

    var split = { stripe: 0, apple: 0 };
    paid.forEach(function (e) { if (split[e.provider] != null) split[e.provider] += e.usd; });

    var html = '';

    var revFoot = paid.length
      ? fmtUsd(split.stripe) + ' Stripe · ' + fmtUsd(split.apple) + ' Apple'
      : 'Ledger starts today — the first sale draws the first line.';
    html += '<div class="hcard"><div class="hlabel">Revenue</div>' +
      '<div class="hmain"><b class="hbig">' + fmtUsd(r.total) + '</b>' +
      '<div class="hside"><div><b>' + fmtUsd(r.last7d) + '</b><span>last 7 days</span></div>' +
      '<div><b>' + fmtNum(r.purchases) + '</b><span>purchases</span></div></div></div>' +
      '<div class="hspark">' + miniSpark(revSpark, '#7ba0f2', 'hs-rev') + '</div>' +
      '<div class="hfoot">' + revFoot + '</div></div>';

    var p14 = 0;
    pSpark.forEach(function (c) { p14 += c; });
    var pFoot = newWeek > 0
      ? '+' + fmtNum(newWeek) + ' new profile' + (newWeek === 1 ? '' : 's') + ' this week — the line is sign-ups, last 14 days.'
      : (p14 > 0
        ? 'None this week — the line is sign-ups, last 14 days.'
        : 'The line is sign-ups over 14 days — none since the birthdate field shipped.');
    html += '<div class="hcard"><div class="hlabel">Players</div>' +
      '<div class="hmain"><b class="hbig">' + fmtNum(t.dau) + '<small> today</small></b>' +
      '<div class="hside"><div><b>' + fmtNum(t.wau) + '</b><span>7 days</span></div>' +
      '<div><b>' + fmtNum(t.mau) + '</b><span>30 days</span></div>' +
      '<div><b>' + fmtNum(t.profiles) + '</b><span>all-time</span></div></div></div>' +
      '<div class="hspark">' + miniSpark(pSpark, '#4fd98b', 'hs-newp') + '</div>' +
      '<div class="hfoot">' + pFoot + '</div></div>';

    var rooms = state.data.rooms || [];
    var humans = 0, bots = 0, seats = 0, inGame = 0, lobbies = 0, playing = 0;
    rooms.forEach(function (rm) {
      if (rm.status === 'ended') return;
      if (rm.status === 'playing') playing++;
      else if (rm.status === 'lobby') lobbies++;
      seats += rm.maxPlayers || 0;
      (rm.players || []).forEach(function (p) {
        if (p.isBot) bots++; else humans++;
        if (rm.status === 'playing') inGame++;
      });
    });
    var alive = t.liveSockets > 0 || playing > 0 || humans > 0;
    var liveFoot = alive
      ? playing + ' playing · ' + lobbies + ' in lobby — ' + fmtNum(humans) + ' human' + (humans === 1 ? '' : 's') +
        ', ' + fmtNum(bots) + ' bot' + (bots === 1 ? '' : 's') + ' seated.'
      : 'The felt is quiet — no sockets, no seats, nothing moving.';
    html += '<div class="hcard"><div class="hlabel">' + (alive ? '<span class="pulse"></span>' : '') + 'Live now</div>' +
      '<div class="hmain"><b class="hbig">' + fmtNum(t.liveRooms) + '<small> room' + (t.liveRooms === 1 ? '' : 's') + '</small></b>' +
      '<div class="hside"><div><b>' + fmtNum(t.liveSockets) + '</b><span>sockets</span></div>' +
      '<div><b>' + fmtNum(inGame) + '</b><span>in game</span></div></div></div>' +
      '<div class="hspark">' + seatStrip(humans, bots, Math.max(0, seats - humans - bots)) + '</div>' +
      '<div class="hfoot">' + liveFoot + '</div></div>';

    html += '<div class="hcard"><div class="hlabel">Games</div>' +
      '<div class="hmain"><b class="hbig">' + fmtNum(gToday) + '<small> today</small></b>' +
      '<div class="hside"><div><b>' + fmtNum(t.gamesEnded) + '</b><span>finished</span></div>' +
      '<div><b>' + fmtNum(t.gamesStarted) + '</b><span>started</span></div></div></div>' +
      '<div class="hspark">' + miniSpark(gSpark, '#e3a93c', 'hs-games') + '</div>' +
      '<div class="hfoot">' + fmtNum(g14) + ' finished in the last 14 days.</div></div>';

    swap('hero', html);
  }

  function renderSubstrip() {
    var t = state.data.totals || {};
    var e = state.data.economy || {};
    var humans = 0, bots = 0;
    (state.data.rooms || []).forEach(function (rm) {
      if (rm.status === 'ended') return;
      (rm.players || []).forEach(function (p) { if (p.isBot) bots++; else humans++; });
    });
    var signedPct = t.profiles > 0 ? Math.round((e.signedIn || 0) / t.profiles * 100) : 0;
    var seated = humans + bots;
    var hPct = seated > 0 ? (humans / seated * 100).toFixed(1) : '0';
    swap('substrip',
      '<div class="scard"><b>' + fmtNum(t.coinsInCirculation) + '</b><span>coins in circulation</span></div>' +
      '<div class="scard"><b>' + (t.avgKarma == null ? '—' : Number(t.avgKarma).toFixed(1)) + '</b><span>average karma</span></div>' +
      '<div class="scard"><b>' + signedPct + '%</b><span>signed in · ' + fmtNum(e.signedIn) + ' of ' + fmtNum(t.profiles) + '</span></div>' +
      '<div class="scard"><b>' + fmtNum(humans) + ' : ' + fmtNum(bots) + '</b>' +
        (seated > 0 ? '<span class="microstack"><i style="width:' + hPct + '%;background:#e3a93c"></i><i style="flex:1;background:#5d7a66"></i></span>' : '') +
        '<span>humans vs bots seated</span></div>');
  }

  function renderFeed() {
    var evts = [];
    (state.data.recentGames || []).forEach(function (g) {
      if (!g.at) return;
      var txt = g.winner
        ? '<b>' + esc(g.winner) + '</b>' + (g.winnerIsBot ? ' <span class="dim">(house)</span>' : '') + ' won on ' + esc(g.map) + ' <span class="dim">· ' + esc(g.roomId) + ' · ' + fmtNum(g.turns) + ' turns</span>'
        : 'Game ended on ' + esc(g.map) + ' <span class="dim">· ' + esc(g.roomId) + '</span>';
      evts.push({ at: g.at, kind: 'game', html: txt });
    });
    (state.data.ledger || []).forEach(function (e) {
      if (!e.at) return;
      var txt;
      if (e.provider === 'admin') txt = '<b>' + esc(e.code || '?') + '</b> credited ' + fmtNum(e.coins) + ' coins <span class="dim">· admin' + (e.note ? ' — ' + esc(e.note) : '') + '</span>';
      else if (e.provider === 'win') txt = '<b>' + esc(e.code || '?') + '</b> earned ' + fmtNum(e.coins) + ' coins <span class="dim">· win payout</span>';
      else txt = '<b>' + esc(e.code || '?') + '</b> bought ' + esc(e.packId || 'coins') + ' <span class="dim">· ' + esc(e.provider) + (e.usd > 0 ? ' · ' + fmtUsd(e.usd) : '') + '</span>';
      evts.push({ at: e.at, kind: 'coin', html: txt });
    });
    var cutoff = Date.now() - 30 * DAY;
    (state.data.profiles || []).forEach(function (p) {
      if (!p.created || p.created < cutoff) return;
      evts.push({ at: p.created, kind: 'join', html: '<b>' + esc(p.name || p.code) + '</b> joined <span class="dim">· new profile · ' + esc(p.code) + '</span>' });
    });
    ((state.data.moderation || {}).audit || []).forEach(function (a) {
      // Credits already surface as their ledger entry — one line per story.
      if (!a.at || a.action === 'credit') return;
      evts.push({ at: a.at, kind: 'admin', html: '<b>' + esc(a.action) + '</b> ' + esc(a.target || '') + (a.detail ? ' <span class="dim">· ' + esc(a.detail) + '</span>' : '') });
    });
    evts.sort(function (a, b) { return b.at - a.at; });
    var shown = evts.slice(0, 25);
    document.getElementById('feedcount').textContent =
      shown.length ? (shown.length < evts.length ? shown.length + ' of ' + fmtNum(evts.length) : String(shown.length)) : '';
    var html = shown.map(function (ev) {
      return '<div class="feed-row"><span class="glyph">' + glyph(ev.kind) + '</span>' +
        '<div class="ftext">' + ev.html + '</div>' +
        '<span class="ftime" title="' + esc(fmtWhen(ev.at)) + '">' + fmtAgo(ev.at) + '</span></div>';
    }).join('');
    if (!shown.length) {
      html = '<div class="dim" style="font-size:13px;padding:8px 2px;line-height:1.5">Quiet so far — finished games, sales, sign-ups and admin actions land here as they happen.</div>';
    }
    var el = document.getElementById('feed');
    var top = el.scrollTop;
    el.innerHTML = html;
    el.scrollTop = top;
  }

  function renderOverviewCharts() {
    var days = last30Days();
    var games = state.data.recentGames || [];
    var gCounts = perDay(games, function (g) { return g.at; });
    var gTotal = gCounts.reduce(function (a, b) { return a + b; }, 0);
    var gPeak = Math.max.apply(null, gCounts.concat([0]));
    document.getElementById('ov-games').innerHTML = areaChart(days, gCounts, {
      id: 'ag-games', color: '#e3a93c', h: 208,
      empty: 'No finished games yet — the first one draws the first point',
      tip: function (v) { return v + ' game' + (v === 1 ? '' : 's'); },
    });
    document.getElementById('ov-games-cap').textContent = gTotal > 0
      ? gTotal + ' of the ' + games.length + ' most recent finished games fell in the last 30 days (peak ' + gPeak + '/day).'
      : 'Finished games land here as tables wrap up.';

    var profs = state.data.profiles || [];
    var pCounts = perDay(profs, function (p) { return p.created; });
    var pTotal = pCounts.reduce(function (a, b) { return a + b; }, 0);
    document.getElementById('ov-newp').innerHTML = areaChart(days, pCounts, {
      id: 'ag-newp', color: '#4fd98b', h: 208,
      empty: 'Sign-ups start counting now — profiles predate the birthdate field',
      tip: function (v) { return v + ' new player' + (v === 1 ? '' : 's'); },
    });
    document.getElementById('ov-newp-cap').textContent = pTotal > 0
      ? pTotal + ' new player' + (pTotal === 1 ? '' : 's') + ' in the last 30 days, of ' + fmtNum(profs.length) + ' all-time.'
      : fmtNum(profs.length) + ' profiles all-time — older ones have no birthdate, so the line starts with the next sign-up.';
  }

  function renderRevenue() {
    var entries = (state.data.ledger || []).filter(function (e) { return e.usd > 0; });
    var days = last30Days();
    var byDay = {};
    days.forEach(function (d) { byDay[d] = { stripe: 0, apple: 0, other: 0 }; });
    entries.forEach(function (e) {
      var d = dayStart(e.at);
      if (!byDay[d]) return;
      var k = e.provider === 'stripe' ? 'stripe' : (e.provider === 'apple' ? 'apple' : 'other');
      byDay[d][k] += e.usd;
    });
    var max = 0;
    days.forEach(function (d) {
      var t = byDay[d].stripe + byDay[d].apple + byDay[d].other;
      if (t > max) max = t;
    });
    var W = 860, H = 200, padL = 48, padR = 8, padT = 10, padB = 22;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img">';
    [0, 0.5, 1].forEach(function (f) {
      var y = H - padB - f * plotH;
      svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#223428" stroke-width="1"/>';
      var label = f === 0 ? '$0' : (max > 0 ? fmtUsd(max * f) : '');
      if (label) svg += '<text x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="axis">' + label + '</text>';
    });
    var step = plotW / 30, bw = Math.max(4, step * 0.6);
    days.forEach(function (d, i) {
      var x = padL + i * step + (step - bw) / 2;
      var y = H - padB;
      [['apple', '#b9c7bd'], ['stripe', '#7ba0f2'], ['other', '#e3a93c']].forEach(function (s) {
        var v = byDay[d][s[0]];
        if (v <= 0) return;
        var h = max > 0 ? Math.max(1.5, v / max * plotH) : 0;
        y -= h;
        svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) +
          '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + s[1] + '"><title>' +
          dateLabel(d) + ' — ' + s[0] + ' ' + fmtUsd(v) + '</title></rect>';
      });
    });
    [0, 15, 29].forEach(function (i) {
      var x = padL + i * step + step / 2;
      svg += '<text x="' + x + '" y="' + (H - 6) + '" text-anchor="middle" class="axis">' + dateLabel(days[i]) + '</text>';
    });
    if (!entries.length) {
      svg += '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) +
        '" stroke="#2a4033" stroke-width="1.5" stroke-dasharray="3 6" stroke-linecap="round"/>';
      svg += '<text x="' + (padL + plotW / 2) + '" y="' + (padT + plotH / 2) +
        '" text-anchor="middle" class="empty">Ledger starts today — the first sale draws the first bar</text>';
    }
    svg += '</svg>';
    document.getElementById('revchart').innerHTML = svg;
    document.getElementById('revcaption').textContent = (state.data.revenue || {}).since
      ? 'Ledger since ' + fmtWhen(state.data.revenue.since) + ' — purchases made before then predate the ledger and are not counted here.'
      : 'The ledger is empty — it records purchases from today onward; anything bought earlier predates it.';
  }

  function hbar(label, value, max, color, valText) {
    var pct = max > 0 ? Math.max(0.5, value / max * 100) : 0;
    return '<div class="hbar"><span class="lbl">' + esc(label) + '</span>' +
      '<span class="track"><span class="fill" style="width:' + pct.toFixed(1) + '%;background:' + color + '"></span></span>' +
      '<span class="val">' + valText + '</span></div>';
  }

  function renderByPack() {
    var r = state.data.revenue || {};
    var packs = r.byPack || [];
    var max = 0;
    packs.forEach(function (p) { if (p.usd > max) max = p.usd; });
    var html = '';
    packs.forEach(function (p) {
      html += hbar(p.packId, p.usd, max, '#7ba0f2',
        '<span class="gold">' + fmtUsd(p.usd) + '</span> <span class="dim">· ' + fmtNum(p.count) + ' sale' + (p.count === 1 ? '' : 's') + '</span>');
    });
    if (!packs.length) html = '<div class="dim" style="font-size:13px">No paid packs in the ledger yet.</div>';
    document.getElementById('bypack').innerHTML = html;
    document.getElementById('revstats').innerHTML =
      '<div><b>' + fmtNum(r.buyers) + '</b><span>distinct buyers</span></div>' +
      '<div><b>' + (r.arpu == null ? '—' : fmtUsd(r.arpu)) + '</b><span>ARPU</span></div>' +
      '<div><b>' + fmtNum(r.purchases) + '</b><span>paid purchases</span></div>';
  }

  function renderPurchases() {
    var led = (state.data.ledger || []).slice().reverse().slice(0, 200);
    var html = '<tr><th>when</th><th>provider</th><th>pack / reason</th><th>usd</th><th>coins</th><th>buyer</th></tr>';
    led.forEach(function (e) {
      var pill = e.provider === 'admin' ? 'warn' : (e.provider === 'win' ? 'ok' : 'dim');
      html += '<tr><td>' + fmtWhen(e.at) + '</td>' +
        '<td><span class="pill ' + pill + '">' + esc(e.provider) + '</span></td>' +
        '<td>' + esc(e.packId || e.note || '—') + '</td>' +
        '<td class="gold">' + (e.usd > 0 ? fmtUsd(e.usd) : '—') + '</td>' +
        '<td>' + fmtNum(e.coins) + '</td>' +
        '<td class="mono">' + esc(e.code || '?') + '</td></tr>';
    });
    if (!led.length) {
      html += '<tr><td colspan="6" class="dim">No entries yet. The ledger records every credit from now on; older purchases predate it and exist only as receipt ids.</td></tr>';
    }
    swap('purchases', html);
    document.getElementById('purchasecount').textContent = (state.data.ledger || []).length || '';
  }

  function statusWeight(s) { return s === 'playing' ? 0 : (s === 'lobby' ? 1 : 2); }

  function renderRooms() {
    var rooms = (state.data.rooms || []).slice().sort(function (a, b) {
      return statusWeight(a.status) - statusWeight(b.status) || a.ageMs - b.ageMs;
    });
    document.getElementById('roomcount').textContent = rooms.length || '';
    var html = '<tr><th>room</th><th>status</th><th>map</th><th>players</th><th>sockets</th><th>turns</th><th>age</th></tr>';
    rooms.forEach(function (r) {
      var names = (r.players || []).map(function (p) {
        return esc(p.name) + (p.isBot ? ' <span class="bot">(bot)</span>' : '');
      }).join(', ') || '<span class="dim">empty</span>';
      var pill = r.status === 'playing' ? 'ok' : (r.status === 'lobby' ? 'warn' : 'dim');
      html += '<tr class="row room-row' + (state.expanded === r.id ? ' open' : '') + '" data-room="' + esc(r.id) + '">' +
        '<td class="mono">' + esc(r.id) + (r.quick ? ' <span class="bot">(quick)</span>' : '') + '</td>' +
        '<td><span class="pill ' + pill + '">' + esc(r.status) + '</span></td>' +
        '<td>' + esc(r.map) + '</td><td>' + names + '</td>' +
        '<td>' + fmtNum(r.sockets) + '</td><td>' + fmtNum(r.turns) + '</td><td>' + fmtAge(r.ageMs) + '</td></tr>';
      if (state.expanded === r.id) {
        var rows = (r.players || []).map(function (p) {
          var st = p.bankrupt ? '<span class="dim">bankrupt</span>' : (p.connected ? '<span class="ok">connected</span>' : '<span class="dim">away</span>');
          var kick = (!p.isBot && p.code)
            ? '<button class="danger sm" data-kick="' + esc(p.code) + '" data-room="' + esc(r.id) + '">Kick</button>'
            : '';
          return '<tr><td>' + esc(p.name) + (p.isBot ? ' <span class="bot">(bot)</span>' : '') + '</td>' +
            '<td class="mono">' + esc(p.code || '—') + '</td>' +
            '<td>' + st + '</td>' +
            '<td>' + (p.money == null ? '—' : '$' + fmtNum(p.money)) + '</td>' +
            '<td>' + (p.netWorth == null ? '—' : '$' + fmtNum(p.netWorth)) + '</td>' +
            '<td>' + kick + '</td></tr>';
        }).join('') || '<tr><td colspan="6" class="dim">Nobody seated</td></tr>';
        html += '<tr class="detail"><td colspan="7"><div class="detail-box">' +
          '<table><tr><th>player</th><th>code</th><th>state</th><th>cash</th><th>net worth</th><th></th></tr>' + rows + '</table>' +
          '<button class="danger" data-close="' + esc(r.id) + '">Close this room</button>' +
          '</div></td></tr>';
      }
    });
    if (!rooms.length) html += '<tr><td colspan="7" class="dim">No live rooms</td></tr>';
    swap('roomsT', html);
  }

  function renderQuick() {
    if (!state.data) return;
    var now = Date.now();
    var qs = (state.data.rooms || []).filter(function (r) { return r.quick && r.status === 'lobby'; });
    var html = '<tr><th>room</th><th>seats</th><th>humans</th><th>kick-off</th></tr>';
    qs.forEach(function (r) {
      var humans = (r.players || []).filter(function (p) { return !p.isBot; }).length;
      var fuse = r.quickStartAt
        ? (r.quickStartAt > now ? Math.ceil((r.quickStartAt - now) / 1000) + 's' : 'now')
        : '<span class="dim">waiting</span>';
      html += '<tr><td class="mono">' + esc(r.id) + '</td>' +
        '<td>' + fmtNum((r.players || []).length) + ' / ' + fmtNum(r.maxPlayers) + '</td>' +
        '<td>' + fmtNum(humans) + '</td>' +
        '<td class="gold">' + fuse + '</td></tr>';
    });
    if (!qs.length) html += '<tr><td colspan="4" class="dim">Nobody is queueing right now</td></tr>';
    swap('quickT', html);
  }

  function renderOccupancy() {
    var rooms = (state.data.rooms || []).filter(function (r) { return r.status !== 'ended'; });
    var humans = 0, bots = 0, seats = 0;
    rooms.forEach(function (r) {
      seats += r.maxPlayers || 0;
      (r.players || []).forEach(function (p) { if (p.isBot) bots++; else humans++; });
    });
    var empty = Math.max(0, seats - humans - bots);
    var total = Math.max(1, humans + bots + empty);
    var seg = function (n, color) {
      if (n <= 0) return '';
      return '<i style="width:' + (n / total * 100).toFixed(1) + '%;background:' + color + '"></i>';
    };
    var html = seats
      ? '<div class="stack">' + seg(humans, '#e3a93c') + seg(bots, '#5d7a66') + seg(empty, '#182219') + '</div>'
      : '<div class="dim" style="font-size:13px">No open tables.</div>';
    html += '<div class="legend">' +
      '<span><i style="background:#e3a93c"></i>' + fmtNum(humans) + ' human' + (humans === 1 ? '' : 's') + '</span>' +
      '<span><i style="background:#5d7a66"></i>' + fmtNum(bots) + ' bot' + (bots === 1 ? '' : 's') + '</span>' +
      '<span><i style="background:#182219"></i>' + fmtNum(empty) + ' empty seat' + (empty === 1 ? '' : 's') + '</span></div>';
    html += '<div class="caption">' + fmtNum(rooms.length) + ' open table' + (rooms.length === 1 ? '' : 's') +
      ' — quick tables seed bots, so a bot-heavy bar means the queue is carrying the room count.</div>';
    document.getElementById('occupancy').innerHTML = html;
  }

  function renderGames() {
    var games = state.data.recentGames || [];
    var html = '<tr><th>when</th><th>room</th><th>map</th><th>winner</th><th>players</th><th>turns</th></tr>';
    games.slice(0, 100).forEach(function (g) {
      html += '<tr><td>' + fmtWhen(g.at) + '</td><td class="mono">' + esc(g.roomId) + '</td>' +
        '<td>' + esc(g.map) + '</td><td class="ok">' + esc(g.winner || '—') + (g.winnerIsBot ? ' <span class="dim">(house)</span>' : '') + '</td>' +
        '<td>' + esc((g.players || []).join(', ')) + '</td><td>' + fmtNum(g.turns) + '</td></tr>';
    });
    if (!games.length) html += '<tr><td colspan="6" class="dim">No finished games yet</td></tr>';
    swap('games', html);
    document.getElementById('gamecount').textContent = games.length || '';

    var days = last30Days();
    var counts = perDay(games, function (g) { return g.at; });
    var max = Math.max.apply(null, counts.concat([0]));
    document.getElementById('gameschart').innerHTML = areaChart(days, counts, {
      id: 'ag-games2', color: '#e3a93c', h: 180,
      empty: 'No finished games yet — the first one draws the first point',
      tip: function (v) { return v + ' game' + (v === 1 ? '' : 's'); },
    });
    var total = counts.reduce(function (a, b) { return a + b; }, 0);
    document.getElementById('gamescaption').textContent = total > 0
      ? total + ' finished in the last 30 days (peak ' + max + '/day). Only the ' + games.length + ' most recent games are kept.'
      : 'Finished games land here as tables wrap up. Only the most recent 100 are kept.';
  }

  function playerByCode(code) {
    var profs = state.data.profiles || [];
    for (var i = 0; i < profs.length; i++) if (profs[i].code === code) return profs[i];
    return null;
  }

  function fact(label, value, raw) {
    return '<div><span>' + esc(label) + '</span><b>' + (raw ? value : esc(value)) + '</b></div>';
  }

  function drawerHtml(p) {
    var html = '<tr class="pdetail"><td colspan="9"><div class="detail-box">';

    html += '<div class="facts">' +
      fact('code', p.code) +
      fact('name', (p.name || '—') + (p.flag ? ' ' + p.flag : '')) +
      fact('coins', fmtNum(p.coins)) +
      fact('karma', fmtNum(p.karma)) +
      fact('friends', fmtNum(p.friends)) +
      fact('sign-in', p.login ? p.login.provider + (p.email ? ' · ' + p.email : '') : 'anonymous') +
      fact('created', fmtWhen(p.created)) +
      fact('last seen', fmtWhen(p.seen)) +
      fact('room', p.roomId ? p.roomId + ' (' + p.status + ')' : 'not seated') +
      fact('standing', p.banned ? '<span class="pill bad">banned</span>' : '<span class="pill ok">in good standing</span>', true) +
      '</div>';

    var buys = (state.data.ledger || []).filter(function (e) { return e.code === p.code; }).reverse().slice(0, 15);
    if (buys.length) {
      var rows = '<tr><th>when</th><th>provider</th><th>pack / reason</th><th>usd</th><th>coins</th></tr>';
      buys.forEach(function (e) {
        rows += '<tr><td>' + fmtWhen(e.at) + '</td><td>' + esc(e.provider) + '</td>' +
          '<td>' + esc(e.packId || e.note || '—') + '</td>' +
          '<td class="gold">' + (e.usd > 0 ? fmtUsd(e.usd) : '—') + '</td>' +
          '<td>' + fmtNum(e.coins) + '</td></tr>';
      });
      html += '<div style="width:100%"><h3>Ledger entries</h3><div class="inner-scroll"><table>' + rows + '</table></div></div>';
    } else {
      html += '<div class="dim" style="font-size:12px">No ledger entries for this player.</div>';
    }

    html += '<div class="mini-forms">' +
      '<div class="mini">' +
        '<div class="field"><label for="d-coins">Coins</label><input id="d-coins" type="number" min="1" step="1" placeholder="500"></div>' +
        '<div class="field"><label for="d-creason">Reason</label><input id="d-creason" class="wide" autocomplete="off" placeholder="Refund, prize..."></div>' +
        '<button class="btn sm" data-pcredit="' + esc(p.code) + '">Credit</button>' +
      '</div>' +
      '<div class="mini">' +
        '<div class="field"><label for="d-karma">Karma 0–100</label><input id="d-karma" type="number" min="0" max="100" step="1" placeholder="' + esc(p.karma) + '"></div>' +
        '<div class="field"><label for="d-kreason">Reason</label><input id="d-kreason" class="wide" autocomplete="off" placeholder="Reset, penalty..."></div>' +
        '<button class="btn sm" data-pkarma="' + esc(p.code) + '">Set karma</button>' +
      '</div>' +
      '<div class="mini">' +
      (p.banned
        ? '<button class="btn sm ghost" data-punban="' + esc(p.code) + '">Lift the ban</button>'
        : '<div class="field"><label for="d-breason">Ban reason</label><input id="d-breason" class="wide" autocomplete="off" placeholder="Abuse, spam..."></div>' +
          '<button class="danger sm" data-pban="' + esc(p.code) + '">Ban device</button>') +
      (p.roomId
        ? '<button class="danger sm" data-pkick="' + esc(p.code) + '" data-room="' + esc(p.roomId) + '">Kick from ' + esc(p.roomId) + '</button>'
        : '') +
      '</div></div>';

    var m = state.drawerMsg;
    html += '<div class="msg' + (m ? ' ' + m.cls : '') + '" id="drawermsg">' + (m ? esc(m.text) : '') + '</div>';
    html += '</div></td></tr>';
    return html;
  }

  function renderPlayers() {
    var profs = (state.data.profiles || []).slice();
    var q = state.search.trim().toLowerCase();
    if (q) {
      profs = profs.filter(function (p) {
        var hay = (p.code + ' ' + (p.name || '') + ' ' + (p.email || '') + ' ' +
          ((p.login && p.login.provider) || '') + ' ' + (p.status || '') +
          (p.banned ? ' banned' : '')).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    if (state.sort) {
      var k = state.sort;
      profs.sort(function (a, b) { return ((Number(a[k]) || 0) - (Number(b[k]) || 0)) * (state.dir < 0 ? -1 : 1); });
    }
    var arrow = function (k) { return state.sort === k ? (state.dir < 0 ? ' ▾' : ' ▴') : ''; };
    var html = '<tr><th>code</th><th>name</th>' +
      '<th class="sortable" data-sort="coins" title="Click to sort">coins' + arrow('coins') + '</th>' +
      '<th class="sortable" data-sort="karma" title="Click to sort">karma' + arrow('karma') + '</th>' +
      '<th>friends</th>' +
      '<th class="sortable" data-sort="seen" title="Click to sort">last seen' + arrow('seen') + '</th>' +
      '<th class="sortable" data-sort="created" title="Click to sort">created' + arrow('created') + '</th>' +
      '<th>status</th><th>login</th></tr>';
    profs.slice(0, 500).forEach(function (p) {
      var login = p.login
        ? esc(p.login.provider) + (p.email ? ' <span class="dim">' + esc(p.email) + '</span>' : '')
        : '<span class="dim">—</span>';
      html += '<tr class="row player-row' + (state.expandedPlayer === p.code ? ' open' : '') + '" data-player="' + esc(p.code) + '">' +
        '<td class="mono">' + esc(p.code) + '</td>' +
        '<td>' + esc(p.name || '—') + (p.flag ? ' ' + esc(p.flag) : '') +
          (p.banned ? ' <span class="pill bad">banned</span>' : '') + '</td>' +
        '<td class="gold">' + fmtNum(p.coins) + '</td>' +
        '<td>' + fmtNum(p.karma) + '</td><td>' + fmtNum(p.friends) + '</td>' +
        '<td>' + fmtWhen(p.seen) + '</td><td>' + fmtWhen(p.created) + '</td>' +
        '<td>' + esc(p.status) + (p.roomId ? ' <span class="mono dim">(' + esc(p.roomId) + ')</span>' : '') + '</td>' +
        '<td>' + login + '</td></tr>';
      if (state.expandedPlayer === p.code) html += drawerHtml(p);
    });
    if (!profs.length) html += '<tr><td colspan="9" class="dim">' + (q ? 'Nobody matches that filter' : 'No profiles yet') + '</td></tr>';
    document.getElementById('playercount').textContent =
      fmtNum(profs.length) + (q ? ' matching' : '') + (profs.length > 500 ? ' (showing 500)' : '');
    keepInputs(['d-coins', 'd-creason', 'd-karma', 'd-kreason', 'd-breason'], function () {
      swap('playersT', html);
    });
  }

  function renderEconomy() {
    var e = state.data.economy || {};
    var html = '<tr><th>#</th><th>code</th><th>name</th><th>coins</th><th>karma</th></tr>';
    (e.topWallets || []).forEach(function (p, i) {
      html += '<tr><td class="dim">' + (i + 1) + '</td><td class="mono">' + esc(p.code) + '</td>' +
        '<td>' + esc(p.name || '—') + '</td><td class="gold">' + fmtNum(p.coins) + '</td>' +
        '<td>' + fmtNum(p.karma) + '</td></tr>';
    });
    if (!(e.topWallets || []).length) html += '<tr><td colspan="5" class="dim">No wallets yet</td></tr>';
    swap('wallets', html);

    var f = e.flows || {};
    var max = Math.max(f.wins || 0, f.purchases || 0, f.grants || 0, f.burned || 0);
    document.getElementById('flows').innerHTML =
      hbar('minted by wins', f.wins || 0, max, '#4fd98b', fmtNum(f.wins) + ' coins') +
      hbar('minted by purchases', f.purchases || 0, max, '#7ba0f2', fmtNum(f.purchases) + ' coins') +
      hbar('minted by admin', f.grants || 0, max, '#e3a93c', fmtNum(f.grants) + ' coins') +
      hbar('burned in the store', f.burned || 0, max, '#e06c5f', fmtNum(f.burned) + ' coins');

    var b = e.karmaBuckets || [];
    var kmax = Math.max.apply(null, b.concat([1]));
    var W = 300, H = 96, padB = 16, slot = W / 10, bw = slot * 0.7;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
    b.forEach(function (v, i) {
      var x = i * slot + (slot - bw) / 2;
      if (v > 0) {
        var h = Math.max(2, v * (H - padB - 8) / kmax);
        svg += '<rect x="' + x.toFixed(1) + '" y="' + (H - padB - h).toFixed(1) + '" width="' + bw.toFixed(1) +
          '" height="' + h.toFixed(1) + '" rx="2" fill="#e3a93c" opacity="' + (0.35 + 0.65 * i / 9).toFixed(2) +
          '"><title>karma ' + (i * 10) + '–' + (i === 9 ? 100 : i * 10 + 9) + ': ' + v + ' player' + (v === 1 ? '' : 's') + '</title></rect>';
      } else {
        svg += '<rect x="' + x.toFixed(1) + '" y="' + (H - padB - 1) + '" width="' + bw.toFixed(1) + '" height="1" fill="#2a4033"/>';
      }
      if (i === 0 || i === 9) {
        svg += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 3) + '" text-anchor="middle" class="axis">' + (i === 0 ? '0' : '100') + '</text>';
      }
    });
    svg += '</svg>';
    document.getElementById('karma').innerHTML = svg;
    document.getElementById('identity').innerHTML =
      '<div><b>' + fmtNum(e.signedIn) + '</b><span>signed in</span></div>' +
      '<div><b>' + fmtNum(e.anonymous) + '</b><span>anonymous</span></div>' +
      '<div><b>' + fmtNum(e.coinsInCirculation) + '</b><span>coins held</span></div>';
  }

  function renderModeration() {
    var mod = state.data.moderation || {};
    var bans = mod.bans || [];
    document.getElementById('bancount').textContent = bans.length || '';
    var html = '<tr><th>code</th><th>name</th><th>reason</th><th>banned</th><th></th></tr>';
    bans.forEach(function (b) {
      html += '<tr><td class="mono">' + esc(b.code) + '</td><td>' + esc(b.name || '—') + '</td>' +
        '<td>' + esc(b.reason || '—') + '</td><td>' + fmtWhen(b.at) + '</td>' +
        '<td><button class="btn ghost sm" data-unban="' + esc(b.code) + '">Unban</button></td></tr>';
    });
    if (!bans.length) html += '<tr><td colspan="5" class="dim">Nobody is banned.</td></tr>';
    swap('bansT', html);

    var audit = (mod.audit || []).slice().reverse();
    document.getElementById('auditcount').textContent = audit.length || '';
    var ah = '<tr><th>when</th><th>action</th><th>target</th><th>detail</th></tr>';
    audit.forEach(function (a) {
      var pill = a.action === 'ban' || a.action === 'kick' || a.action === 'close-room' ? 'bad'
        : (a.action === 'credit' || a.action === 'karma' ? 'warn' : 'dim');
      ah += '<tr><td>' + fmtWhen(a.at) + '</td>' +
        '<td><span class="pill ' + pill + '">' + esc(a.action) + '</span></td>' +
        '<td class="mono">' + esc(a.target || '—') + '</td>' +
        '<td>' + esc(a.detail || '') + '</td></tr>';
    });
    if (!audit.length) ah += '<tr><td colspan="4" class="dim">No admin actions recorded yet. Every POST from this page lands here.</td></tr>';
    swap('auditT', ah);
  }

  function renderSystem() {
    var s = state.data.system || {};
    var rbs = s.roomsByStatus || {};
    swap('systiles',
      tileHtml(fmtUptime(s.uptimeSec), 'uptime', '') +
      tileHtml(fmtBytes(s.rss), 'memory (rss)', '') +
      tileHtml(s.node || '—', 'node', '') +
      tileHtml(fmtNum(s.sockets), 'open sockets', '') +
      tileHtml(fmtNum(rbs.lobby), 'lobbies', '') +
      tileHtml(fmtNum(rbs.playing), 'playing', ''));

    var d = s.data || {};
    var c = state.data.config || {};
    var envPill = c.dataDirEnv
      ? '<span class="pill ok">DATA_DIR set</span>'
      : '<span class="pill bad">DATA_DIR unset — wiped on deploy</span>';
    var html = '<div style="font-size:13px;margin-bottom:12px">Data directory ' + envPill +
      '<div class="mono dim" style="margin-top:6px;word-break:break-all">' + esc(d.dir || '?') + '</div></div>';
    var fileRow = function (name, info) {
      return '<tr><td class="mono">' + esc(name) + '</td>' +
        '<td>' + (info ? fmtBytes(info.size) : '<span class="dim">not written yet</span>') + '</td>' +
        '<td>' + (info ? fmtWhen(info.savedAt) : '—') + '</td></tr>';
    };
    html += '<div class="scroll"><table><tr><th>file</th><th>size</th><th>last saved</th></tr>' +
      fileRow('social.json — profiles, wallets, DMs', d.social) +
      fileRow('ledger.json — every credit', d.ledger) +
      fileRow('bans.json — banned devices', d.bans) +
      fileRow('stats.json — game counters', d.stats) +
      fileRow('audit.json — admin actions', d.audit) +
      fileRow('webhook-health.json — stripe deliveries', d.webhook) +
      '</table></div>';
    document.getElementById('persist').innerHTML = html;

    // Stripe delivery record: two timestamps and the verdict between them.
    var wh = s.webhook || {};
    swap('webhookT',
      '<div class="scroll"><table><tr><th>delivery</th><th>when</th><th>detail</th></tr>' +
      '<tr><td>last success</td><td>' + (wh.lastSuccess ? fmtWhen(wh.lastSuccess) : '<span class="dim">never</span>') +
        '</td><td class="dim">Signature verified, event handled.</td></tr>' +
      '<tr><td>last failure</td><td>' + (wh.lastFailure ? fmtWhen(wh.lastFailure.at) : '<span class="dim">never</span>') +
        '</td><td class="dim">' + (wh.lastFailure ? esc(wh.lastFailure.reason || 'no reason recorded') : '—') + '</td></tr>' +
      '</table></div>' +
      (wh.failing
        ? '<div class="alert red" style="margin-top:10px"><b>Failing.</b> The rejection is newer than the last success — see the Overview strip.</div>'
        : (wh.lastSuccess ? '' : '<div class="caption" style="margin-top:8px">No delivery recorded yet — Stripe has not knocked since this record began.</div>')));

    var b = s.backup || null;
    swap('backupT', b
      ? '<div style="font-size:13px">Last snapshot ' + fmtWhen(b.at) + ' — ' + fmtNum(b.copied) + ' file(s) copied' +
        '<div class="mono dim" style="margin-top:6px;word-break:break-all">' + esc(b.dir || '') + '</div></div>'
      : '<div class="dim" style="font-size:13px">No snapshot yet this boot — check the server log.</div>');

    var flag = function (on, okText, badText, badCls) {
      return on ? '<span class="pill ok">' + okText + '</span>' : '<span class="pill ' + (badCls || 'bad') + '">' + badText + '</span>';
    };
    swap('configT',
      '<tr><th>setting</th><th>state</th><th>why it matters</th></tr>' +
      '<tr><td>ADMIN_KEY</td><td>' + flag(!c.adminKeyDefault, 'custom', 'still the default') +
        '</td><td class="dim">Guards this page and every action on it.</td></tr>' +
      '<tr><td>DATA_DIR</td><td>' + flag(c.dataDirEnv, 'set', 'unset') +
        '</td><td class="dim">Without it every file above dies on the next deploy.</td></tr>' +
      '<tr><td>Stripe checkout</td><td>' + flag(c.stripe, 'enabled', 'off', 'dim') +
        '</td><td class="dim">Card payments on the web store.</td></tr>' +
      '<tr><td>Stripe webhook</td><td>' + flag(c.stripeWebhook, 'secret set', 'missing', c.stripe ? 'bad' : 'dim') +
        '</td><td class="dim">The only path that credits coins after a card payment.</td></tr>');
  }

  function renderAll() {
    if (!state.data) return;
    renderStatus();
    renderAlerts();
    renderHero();
    renderSubstrip();
    renderFeed();
    renderOverviewCharts();
    renderRevenue();
    renderByPack();
    renderPurchases();
    renderRooms();
    renderQuick();
    renderOccupancy();
    renderGames();
    renderPlayers();
    renderEconomy();
    renderModeration();
    renderSystem();
  }

  // ------------------------------------------------------------- actions --
  function setMsg(id, text, ok) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'msg ' + (ok ? 'ok' : 'err');
  }
  function setDrawerMsg(text, ok) {
    state.drawerMsg = { text: text, cls: ok ? 'ok' : 'err' };
    var el = document.getElementById('drawermsg');
    if (el) { el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'err'); }
  }

  function creditCoins(code, coins, reason, done) {
    if (!code || !(coins > 0)) return done({ error: 'Enter a friend code and a positive coin amount.' });
    if (!confirm('Credit ' + fmtNum(coins) + ' coins to ' + code + '?' + (reason ? ' Reason: ' + reason : ''))) return;
    post('/api/admin/credit', { code: code, coins: coins, reason: reason }, done);
  }

  function closeRoom(id, msgId) {
    if (!id) return;
    if (!confirm('Close room ' + id + '? Its table is torn down and everyone in it is disconnected.')) return;
    post('/api/admin/close-room', { roomId: id }, function (r) {
      if (r && r.ok) {
        if (state.expanded === id) state.expanded = null;
        if (msgId) setMsg(msgId, 'Room ' + id + ' closed.', true);
        refresh();
      } else {
        var err = (r && r.error) || 'Could not close the room.';
        if (msgId) setMsg(msgId, err, false);
        else alert(err);
      }
    });
  }

  function kickSeat(roomId, code, done) {
    if (!confirm('Kick ' + code + ' from room ' + roomId + '? In a live game their deeds go back to the bank, like a timeout.')) return;
    post('/api/admin/kick', { roomId: roomId, code: code }, done);
  }

  function banDevice(code, reason, done) {
    if (!code) return done({ error: 'Enter a friend code.' });
    if (!confirm('Ban ' + code + '? Their device can no longer join any table.' + (reason ? ' Reason: ' + reason : ''))) return;
    post('/api/admin/ban', { code: code, reason: reason }, done);
  }

  // -------------------------------------------------------------- wiring --
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var t = e.target;
    var el;

    el = t.closest('[data-close]');
    if (el) { closeRoom(el.getAttribute('data-close'), null); return; }

    el = t.closest('[data-kick]');
    if (el) {
      kickSeat(el.getAttribute('data-room'), el.getAttribute('data-kick'), function (r) {
        if (!(r && r.ok)) alert((r && r.error) || 'Kick failed.');
        refresh();
      });
      return;
    }

    el = t.closest('[data-unban]');
    if (el) {
      var code = el.getAttribute('data-unban');
      if (!confirm('Lift the ban on ' + code + '?')) return;
      post('/api/admin/unban', { code: code }, function (r) {
        setMsg('modmsg', r && r.ok ? 'Ban lifted for ' + code + '.' : ((r && r.error) || 'Unban failed.'), !!(r && r.ok));
        refresh();
      });
      return;
    }

    el = t.closest('[data-pcredit]');
    if (el) {
      var v = parseInt((document.getElementById('d-coins') || {}).value, 10);
      creditCoins(el.getAttribute('data-pcredit'), v, ((document.getElementById('d-creason') || {}).value || '').trim(), function (r) {
        if (r && r.ok) {
          setDrawerMsg('Credited — new balance ' + fmtNum(r.coins) + '.', true);
          var ci = document.getElementById('d-coins'); if (ci) ci.value = '';
          refresh();
        } else setDrawerMsg((r && r.error) || 'Credit failed.', false);
      });
      return;
    }

    el = t.closest('[data-pkarma]');
    if (el) {
      var code2 = el.getAttribute('data-pkarma');
      var k = parseInt((document.getElementById('d-karma') || {}).value, 10);
      var kr = ((document.getElementById('d-kreason') || {}).value || '').trim();
      if (!(k >= 0 && k <= 100)) return setDrawerMsg('Karma is a number from 0 to 100.', false);
      if (!confirm('Set karma of ' + code2 + ' to ' + k + '?' + (kr ? ' Reason: ' + kr : ''))) return;
      post('/api/admin/karma', { code: code2, karma: k, reason: kr }, function (r) {
        if (r && r.ok) { setDrawerMsg('Karma set to ' + r.karma + '.', true); refresh(); }
        else setDrawerMsg((r && r.error) || 'Karma change failed.', false);
      });
      return;
    }

    el = t.closest('[data-pban]');
    if (el) {
      banDevice(el.getAttribute('data-pban'), ((document.getElementById('d-breason') || {}).value || '').trim(), function (r) {
        if (r && r.ok) { setDrawerMsg('Banned ' + r.code + '.', true); refresh(); }
        else setDrawerMsg((r && r.error) || 'Ban failed.', false);
      });
      return;
    }

    el = t.closest('[data-punban]');
    if (el) {
      var code3 = el.getAttribute('data-punban');
      if (!confirm('Lift the ban on ' + code3 + '?')) return;
      post('/api/admin/unban', { code: code3 }, function (r) {
        if (r && r.ok) { setDrawerMsg('Ban lifted.', true); refresh(); }
        else setDrawerMsg((r && r.error) || 'Unban failed.', false);
      });
      return;
    }

    el = t.closest('[data-pkick]');
    if (el) {
      kickSeat(el.getAttribute('data-room'), el.getAttribute('data-pkick'), function (r) {
        if (r && r.ok) { setDrawerMsg('Kicked from ' + r.roomId + '.', true); refresh(); }
        else setDrawerMsg((r && r.error) || 'Kick failed.', false);
      });
      return;
    }

    el = t.closest('th.sortable');
    if (el) {
      var s = el.getAttribute('data-sort');
      if (state.sort === s) state.dir = -state.dir;
      else { state.sort = s; state.dir = -1; }
      renderPlayers();
      return;
    }

    el = t.closest('.room-row');
    if (el) {
      var id = el.getAttribute('data-room');
      state.expanded = state.expanded === id ? null : id;
      renderRooms();
      return;
    }

    el = t.closest('.player-row');
    if (el) {
      var pc = el.getAttribute('data-player');
      state.expandedPlayer = state.expandedPlayer === pc ? null : pc;
      state.drawerMsg = null;
      renderPlayers();
    }
  });

  document.getElementById('search').addEventListener('input', function (e) {
    state.search = e.target.value;
    renderPlayers();
  });

  document.getElementById('c-go').addEventListener('click', function () {
    var code = document.getElementById('c-code').value.trim().toUpperCase();
    var coins = parseInt(document.getElementById('c-coins').value, 10);
    var reason = document.getElementById('c-reason').value.trim();
    creditCoins(code, coins, reason, function (r) {
      if (r && r.ok) {
        setMsg('actionmsg', 'Credited ' + fmtNum(coins) + ' coins to ' + code +
          (r.name ? ' (' + r.name + ')' : '') + ' — new balance ' + fmtNum(r.coins) + '.', true);
        document.getElementById('c-coins').value = '';
        document.getElementById('c-reason').value = '';
        refresh();
      } else setMsg('actionmsg', (r && r.error) || 'Credit failed.', false);
    });
  });

  document.getElementById('k-go').addEventListener('click', function () {
    var id = document.getElementById('k-room').value.trim().toLowerCase();
    if (!id) return setMsg('closemsg', 'Enter a room id.', false);
    closeRoom(id, 'closemsg');
  });

  document.getElementById('b-go').addEventListener('click', function () {
    var msg = document.getElementById('b-msg').value.trim();
    if (!msg) return setMsg('bmsg', 'Type a message first.', false);
    if (!confirm('Send to every connected client?' + NL + NL + msg)) return;
    post('/api/admin/broadcast', { message: msg }, function (r) {
      if (r && r.ok) {
        setMsg('bmsg', 'Sent' + (r.reached != null ? ' to ' + fmtNum(r.reached) + ' socket' + (r.reached === 1 ? '' : 's') : '') + '.', true);
        document.getElementById('b-msg').value = '';
        refresh();
      } else setMsg('bmsg', (r && r.error) || 'Broadcast failed.', false);
    });
  });

  // The Overview quick actions share the section forms' plumbing — same
  // endpoints, same confirms, their own message lines.
  document.getElementById('qa-bgo').addEventListener('click', function () {
    var msg = document.getElementById('qa-bmsg').value.trim();
    if (!msg) return setMsg('qa-bres', 'Type a message first.', false);
    if (!confirm('Send to every connected client?' + NL + NL + msg)) return;
    post('/api/admin/broadcast', { message: msg }, function (r) {
      if (r && r.ok) {
        setMsg('qa-bres', 'Sent' + (r.reached != null ? ' to ' + fmtNum(r.reached) + ' socket' + (r.reached === 1 ? '' : 's') : '') + '.', true);
        document.getElementById('qa-bmsg').value = '';
        refresh();
      } else setMsg('qa-bres', (r && r.error) || 'Broadcast failed.', false);
    });
  });

  document.getElementById('qa-cgo').addEventListener('click', function () {
    var code = document.getElementById('qa-code').value.trim().toUpperCase();
    var coins = parseInt(document.getElementById('qa-coins').value, 10);
    var reason = document.getElementById('qa-reason').value.trim();
    creditCoins(code, coins, reason, function (r) {
      if (r && r.ok) {
        setMsg('qa-cres', 'Credited ' + fmtNum(coins) + ' to ' + code + (r.name ? ' (' + r.name + ')' : '') +
          ' — new balance ' + fmtNum(r.coins) + '.', true);
        document.getElementById('qa-coins').value = '';
        document.getElementById('qa-reason').value = '';
        refresh();
      } else setMsg('qa-cres', (r && r.error) || 'Credit failed.', false);
    });
  });

  document.getElementById('m-go').addEventListener('click', function () {
    var code = document.getElementById('m-code').value.trim().toUpperCase();
    var reason = document.getElementById('m-reason').value.trim();
    banDevice(code, reason, function (r) {
      if (r && r.ok) {
        setMsg('modmsg', 'Banned ' + r.code + (r.name ? ' (' + r.name + ')' : '') + '.', true);
        document.getElementById('m-code').value = '';
        document.getElementById('m-reason').value = '';
        refresh();
      } else setMsg('modmsg', (r && r.error) || 'Ban failed.', false);
    });
  });

  document.getElementById('csv-players').addEventListener('click', function () {
    var rows = [['code', 'name', 'flag', 'coins', 'karma', 'friends', 'status', 'room', 'provider', 'email', 'last_seen', 'created', 'banned']];
    (state.data && state.data.profiles || []).forEach(function (p) {
      rows.push([p.code, p.name || '', p.flag || '', p.coins, p.karma, p.friends, p.status,
        p.roomId || '', (p.login && p.login.provider) || '', p.email || '',
        iso(p.seen), iso(p.created), p.banned ? 'yes' : 'no']);
    });
    downloadCsv('moneymove-players-' + new Date().toISOString().slice(0, 10) + '.csv', rows);
  });

  document.getElementById('csv-ledger').addEventListener('click', function () {
    var rows = [['at', 'provider', 'pack', 'usd', 'coins', 'buyer_code', 'txn', 'note']];
    (state.data && state.data.ledger || []).forEach(function (e) {
      rows.push([iso(e.at), e.provider, e.packId || '', e.usd, e.coins, e.code || '', e.txn || '', e.note || '']);
    });
    downloadCsv('moneymove-ledger-' + new Date().toISOString().slice(0, 10) + '.csv', rows);
  });

  function refresh() {
    fetch('/api/admin/data?key=' + encodeURIComponent(KEY))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        state.data = d;
        state.error = false;
        state.lastFetch = Date.now();
        renderAll();
      })
      .catch(function () { state.error = true; renderStatus(); });
  }

  if (!KEY) {
    document.body.innerHTML = '<p style="padding:40px">Append ?key=YOUR_ADMIN_KEY to the URL to open the dashboard.</p>';
  } else {
    applySection();
    // The backup download is a plain link so the browser handles the file;
    // it carries the key the same way opening this page did.
    document.getElementById('backup-dl').href = '/api/admin/backup?key=' + encodeURIComponent(KEY);
    refresh();
    setInterval(refresh, 5000);
    // The quick-match fuse is the one number on the page that lies within
    // five seconds — tick it by itself.
    setInterval(renderQuick, 1000);
  }
})();
</script>
</body>
</html>`;
