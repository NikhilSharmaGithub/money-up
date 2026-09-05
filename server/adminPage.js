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
// The Overview is the front desk, and it leads with REAL PLAYERS: a profile
// is minted the moment any browser joins a lobby, so the profile count is a
// count of visitors. A real player has finished at least one game, which is
// what turnsPlayed records. The hero row is four cards (real players,
// revenue, live-now, games — each with an in-card 14-day sparkline), the
// strip below it carries the raw profile count labelled honestly, three
// 30-day area charts read the server's day series (real players per day,
// games per day, new real players per day), and the activity feed hides
// visitor lines behind one switch. Broadcast and credit-coins sit alongside
// as quick actions that reuse the section forms' endpoints.
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
  .substrip { display: grid; grid-template-columns: repeat(auto-fit, minmax(152px, 1fr)); gap: 12px; margin-bottom: 16px; }
  /* The secondary strip: number on top, plain-language label under it. The
     labels here have to be honest rather than short ("profiles incl.
     visitors"), so they get their own line instead of fighting the value. */
  .scard { background: #121b15; border: 1px solid #1f2f26; border-radius: 12px; padding: 10px 14px 11px; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-width: 0; }
  .scard b { font-size: 19px; color: #cfd8cb; font-weight: 700; white-space: nowrap; line-height: 1.1; }
  .scard span { font-size: 10px; color: #7d8b7f; text-transform: uppercase; letter-spacing: .9px; line-height: 1.4; }
  .scard .microstack { width: 100%; display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: #0d1511; border: 1px solid #1f2f26; margin: 3px 0 1px; }
  .scard .microstack i { display: block; height: 100%; }
  .ovgrid { display: grid; grid-template-columns: minmax(0, 1.42fr) minmax(0, 1fr); gap: 16px; align-items: stretch; }
  .ovcol { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .ovcol .card { margin-bottom: 0; }
  /* The right rail carries less than the chart stack; the feed eats the
     difference so a 1280-1600 desktop never shows a column of nothing. */
  .ovcol .card.grow { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  /* Long enough to stand beside the chart stack, capped so a busy feed
     scrolls inside its card instead of stretching the whole row. */
  .ovcol .card.grow .feed { flex: 1; min-height: 240px; max-height: 68vh; }
  .feed { max-height: 420px; overflow-y: auto; }
  .feed-row { display: flex; gap: 10px; padding: 8px 4px; border-bottom: 1px solid #16241b; align-items: flex-start; font-size: 12.5px; }
  .feed-row:last-child { border-bottom: none; }
  .feed-row .glyph { flex: none; width: 26px; height: 26px; border-radius: 8px; background: #0e1712; border: 1px solid #24382c; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
  .feed-row .glyph svg { width: 14px; height: 14px; display: block; }
  .feed-row .ftext { flex: 1; min-width: 0; line-height: 1.45; color: #b8c4b4; overflow-wrap: break-word; }
  .feed-row .ftext b { color: #efeadd; font-weight: 600; }
  .feed-row .ftime { flex: none; font-size: 11px; color: #7d8b7f; padding-top: 2px; white-space: nowrap; }
  .qa-label { font-size: 11px; color: #93a396; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .qa-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .qa-row input { min-width: 0; flex: 1 1 96px; width: auto; }
  .qa-row .btn { flex: none; }

  /* A two-state switch that reads as one control: real players by default,
     everyone on request. Both halves are real buttons, so the keyboard gets
     them for free. */
  .seg { display: inline-flex; background: #0d1511; border: 1px solid #2a4033; border-radius: 10px; padding: 2px; gap: 2px; }
  .seg button { background: transparent; border: none; color: #a9b4a6; font: inherit; font-size: 12px; font-weight: 600; padding: 6px 13px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
  .seg button:hover { color: #efeadd; }
  .seg button[aria-pressed="true"] { background: rgba(227, 169, 60, .14); color: #e3a93c; }
  .seg .tally { color: #7d8b7f; font-weight: 500; margin-left: 5px; }
  .seg button[aria-pressed="true"] .tally { color: rgba(227, 169, 60, .7); }

  /* One visible focus ring for everything that takes focus, rows included. */
  a:focus-visible, button:focus-visible, input:focus-visible, tr:focus-visible, th:focus-visible {
    outline: 2px solid #e3a93c; outline-offset: -2px; border-radius: 8px;
  }
  tr:focus-visible td { background: rgba(227, 169, 60, .06); }

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
  /* The only distinction on this page that matters twice: a real player who
     has finished a game, and a browser that looked in. */
  .pill.player { background: rgba(227, 169, 60, .14); color: #e3a93c; }
  .pill.visitor { background: rgba(150, 160, 150, .1); color: #8b9a8d; font-weight: 500; }
  .bot { color: #93a396; font-size: 11px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .dim { color: #93a396; }
  .gold { color: #e3a93c; font-weight: 600; }
  .ok { color: #4fd98b; }
  .hint { font-size: 12px; color: #93a396; margin: -6px 0 10px; }
  .caption { font-size: 12px; color: #93a396; margin-top: 8px; }
  /* The people who joined, one to a line. */
  .cupcodebox {
    display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    margin-top: 10px; padding: 10px 13px; border-radius: 12px;
    background: rgba(232, 181, 46, .07); border: 1px solid rgba(232, 181, 46, .3);
  }
  .cupcodebox span { font-size: 12px; color: #93a396; }
  .cupcodebox b {
    font-size: 20px; font-weight: 800; color: #e8b52e;
    font-family: ui-monospace, monospace; letter-spacing: 2px;
  }
  /* One card per cup, and the one you are editing wears the highlight. */
  .cupcard {
    padding: 11px 13px; margin-bottom: 8px; border-radius: 12px; cursor: pointer;
    background: rgba(255, 255, 255, .02); border: 1px solid rgba(255, 255, 255, .07);
  }
  .cupcard:hover { border-color: rgba(232, 181, 46, .4); }
  .cupcard.on { background: rgba(232, 181, 46, .08); border-color: #e8b52e; }
  .cupcard-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .cupcard-top b { font-size: 14px; color: #dfe7e0; }
  .cupcard .caption { margin-top: 3px; }
  .cupstate {
    font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
    padding: 2px 8px; border-radius: 99px; color: #93a396;
    background: rgba(255, 255, 255, .05);
  }
  .cupstate.joining { color: #7ee2a8; background: rgba(126, 226, 168, .12); }
  .cupstate.running { color: #e8b52e; background: rgba(232, 181, 46, .14); }
  .cupstate.scheduled { color: #9fc4e8; background: rgba(159, 196, 232, .12); }
  .cuplist { margin-top: 8px; max-height: 320px; overflow: auto; }
  .cuprow {
    display: flex; align-items: baseline; gap: 10px; padding: 6px 2px;
    border-bottom: 1px solid rgba(255, 255, 255, .05); font-size: 13px;
  }
  .cupnum { width: 26px; color: #6d7d70; font-variant-numeric: tabular-nums; }
  .cupwho { flex: 1; min-width: 0; color: #dfe7e0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cupcode { color: #93a396; font-family: ui-monospace, monospace; font-size: 12px; }
  .cupout { color: #e2566d; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
  /* The switch is on and nothing is open — said plainly, because the tile
     above reads CUPS ON and that is not the same thing. */
  .cupnudge {
    padding: 12px 14px; border-radius: 12px; font-size: 13px; line-height: 1.55;
    color: #e8d9b0; background: rgba(232, 181, 46, .09);
    border: 1px solid rgba(232, 181, 46, .38);
  }
  .cupnudge b { color: #e8b52e; }
  /* The join window, counting down for real — see cupClockText. */
  .cupclock {
    display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    margin-top: 10px; padding: 10px 13px; border-radius: 12px;
    background: rgba(232, 181, 46, .08); border: 1px solid rgba(232, 181, 46, .35);
  }
  .cupclock span { font-size: 12px; color: #93a396; }
  .cupclock b {
    font-size: 26px; font-weight: 800; color: #e8b52e;
    font-variant-numeric: tabular-nums; letter-spacing: .5px;
  }
  .legend { display: flex; gap: 14px; margin-top: 10px; font-size: 12px; color: #b8c4b4; flex-wrap: wrap; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
  .idsplit { display: flex; gap: 26px; margin-top: 14px; flex-wrap: wrap; }
  .idsplit b { display: block; font-size: 20px; color: #efeadd; }
  .idsplit span { font-size: 11px; color: #93a396; text-transform: uppercase; letter-spacing: 1px; }

  .chart svg { width: 100%; height: auto; display: block; }
  /* Ten karma buckets have no business being three feet wide on a big
     monitor — the histogram keeps its own scale. */
  #karma svg { max-width: 440px; }
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
  <a href="#ads">Ads</a>
  <a href="#cup">Cup</a>
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
          <h2>Real players per day — last 30 <span class="count" id="ov-real-count"></span></h2>
          <p class="hint">Distinct humans who finished a game that day. Someone who opened a lobby and left is never counted here.</p>
          <div id="ov-real" class="chart"></div>
          <div id="ov-real-cap" class="caption"></div>
        </div>
        <div class="card">
          <h2>Games per day — last 30 <span class="count" id="ov-games-count"></span></h2>
          <div id="ov-games" class="chart"></div>
          <div id="ov-games-cap" class="caption"></div>
        </div>
        <div class="card">
          <h2>New real players per day — last 30 <span class="count" id="ov-newp-count"></span></h2>
          <p class="hint">The day a player finished their first game — not the day a browser first said hello.</p>
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
            <input id="qa-code" autocomplete="off" spellcheck="false" placeholder="Code" style="width:88px;flex:none">
            <input id="qa-coins" type="number" min="1" step="1" placeholder="Coins" style="width:76px;flex:none">
            <input id="qa-reason" autocomplete="off" placeholder="Reason — refund, prize">
            <button class="btn sm" id="qa-cgo" type="button">Credit</button>
          </div>
          <div class="msg" id="qa-cres"></div>
        </div>
        <div class="card grow">
          <h2>Activity <span class="count" id="feedcount"></span></h2>
          <div class="toolbar" style="margin-bottom:8px">
            <div class="seg" role="group" aria-label="Whether visitor lines appear in the feed">
              <button type="button" id="feed-hide" aria-pressed="true">Players only</button>
              <button type="button" id="feed-all" aria-pressed="false">Include visitors <span class="tally" id="feed-vcount"></span></button>
            </div>
          </div>
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
      <p class="hint">Real players first: a profile that has finished at least one game. Everyone else is a visitor — a browser that opened a lobby, a test tab, a second phone — and stays out of the way until you ask for it. Click a row to open the record.</p>
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Which players to list">
          <button type="button" id="pf-real" aria-pressed="true">Real players <span class="tally" id="pf-real-n"></span></button>
          <button type="button" id="pf-all" aria-pressed="false">Everyone <span class="tally" id="pf-all-n"></span></button>
        </div>
        <input id="search" type="search" placeholder="Filter by code, name, email or provider" autocomplete="off" spellcheck="false">
        <button class="btn ghost sm" id="csv-players" type="button">Export players CSV</button>
      </div>
      <div class="scroll" style="max-height:520px"><table><tbody id="playersT"></tbody></table></div>
    </section>
    <div class="cards">
      <section class="card">
        <h2>Credit coins</h2>
        <div class="field"><label for="c-code">Friend code</label><input id="c-code" autocomplete="off" spellcheck="false" placeholder="e.g. QK7M2X"></div>
        <div class="field"><label for="c-coins">Coins</label><input id="c-coins" type="number" min="1" step="1" placeholder="500"></div>
        <div class="field"><label for="c-reason">Reason</label><input id="c-reason" autocomplete="off" placeholder="Refund, prize, goodwill..."></div>
        <button class="btn" id="c-go">Credit coins</button>
        <div class="msg" id="actionmsg"></div>
      </section>
      <section class="card">
        <h2>Real players vs visitors</h2>
        <div id="playermix"></div>
      </section>
    </div>
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

  <section class="panel" id="sec-ads">
    <section class="tiles" id="adtiles"></section>
    <section class="card">
      <h2>The switch</h2>
      <p class="hint">One master switch, and a switch per placement. Ads stay off until this says otherwise, and none of it needs a redeploy or an app update — the setting lives on disk beside the wallets, so a restart remembers what you decided. While ads are off no client draws an ad button at all.</p>
      <div id="adswitch"></div>
      <div class="msg" id="adsmsg"></div>
    </section>
    <div class="cards">
      <div class="card">
        <h2>What a view pays</h2>
        <p class="hint">A win pays 2 coins and the day pays 1 to 7, so these numbers are wages. Keep them small enough that the shop is still worth visiting.</p>
        <div id="adrewards"></div>
        <div style="margin-top:14px"><button class="btn sm" id="ad-save">Save rewards and caps</button></div>
        <div class="msg" id="adnummsg"></div>
      </div>
      <div class="card">
        <h2>Who is serving</h2>
        <p class="hint">The house shows the game's own full-screen promo and needs nothing configured. Google is one choice serving two networks — AdMob in the app, H5 in the browser — and each falls back to the house on its own until its ids are pasted in below.</p>
        <div id="adprovider"></div>
        <div style="margin-top:14px"><button class="btn sm" id="ad-mob-save">Save ids</button></div>
        <div class="msg" id="adprovmsg"></div>
      </div>
    </div>
    <section class="card">
      <h2>Verification</h2>
      <p class="hint">A rewarded view pays only when the ticket and the network's own confirmation both check out. This is that door: what Google has called with, and what has been turned away.</p>
      <div id="adssv"></div>
    </section>
    <section class="card">
      <h2>Today</h2>
      <div id="adtoday"></div>
      <div class="caption">Read straight off the ledger — every ad payout is a row there, provider <span class="mono">ads</span>, the same book card payments and win purses are written in.</div>
    </section>
  </section>

  <section class="panel" id="sec-cup">
    <section class="tiles" id="cuptiles"></section>
    <section class="card">
      <h2>Tournaments</h2>
      <p class="hint">A cup is a join window and a knockout. Everyone who enters is paired off when the doors shut — a hundred entrants make fifty tables — and the winners play on until one is left. First, second and third are paid by you, by hand: this desk records who finished where and remembers which ones you have settled. It never moves money on its own.</p>
      <div id="cupswitch"></div>
      <div class="msg" id="cupmsg"></div>
    </section>
    <div class="cards">
      <div class="card" style="grid-column:1 / -1">
        <h2>Your cups</h2>
        <p class="hint">Up to six at once. Pick one to edit it below, or start a new one.</p>
        <div id="cuplistall"></div>
        <div style="margin-top:12px"><button class="btn sm" id="cup-new">＋ New cup</button></div>
      </div>
      <div class="card">
        <h2 id="cup-formtitle">Set up a cup</h2>
        <p class="hint">Three things decide a cup: when players can start joining, how long joining stays open, and what the winners get. Save it once and you can change any of it — the date included — right up until the games start.</p>
        <div class="mini-forms">
          <div class="field"><label>Name</label><input id="cup-name" value="MoneyMove Cup" /></div>
          <div class="field"><label>Joining starts (leave blank to start now)</label><input id="cup-when" type="datetime-local" /></div>
          <div class="field"><label>Joining stays open for (minutes)</label><input id="cup-mins" type="number" value="5" min="1" /></div>
          <div class="field"><label>Player limit (0 = no limit)</label><input id="cup-max" type="number" value="0" min="0" /></div>
          <div class="field"><label>Join code (blank = anyone can join)</label><input id="cup-code" placeholder="e.g. SUNDAY" maxlength="16" /></div>
          <div class="field"><label>1st prize</label><input id="cup-first" type="number" value="200" /></div>
          <div class="field"><label>2nd prize</label><input id="cup-second" type="number" value="100" /></div>
          <div class="field"><label>3rd prize</label><input id="cup-third" type="number" value="50" /></div>
          <div class="field"><label>Currency you pay in</label><input id="cup-cur" value="USD" /></div>
        </div>
        <div class="caption" id="cup-when-note"></div>
        <div style="margin-top:14px"><button class="btn sm" id="cup-open">Save this cup</button>
          <button class="btn sm ghost" id="cup-now">Start joining now</button>
          <button class="btn sm ghost" id="cup-close">Stop joining and start the games</button>
          <button class="btn sm ghost" id="cup-cancel">Delete this cup</button></div>
        <p class="hint" style="margin-top:10px"><b>Save this cup</b> creates it, and saves your changes to it afterwards. <b>Start joining now</b> opens it ahead of the date. <b>Stop joining</b> shuts the list early and pairs everyone off.</p>
      </div>
      <div class="card">
        <h2>What is happening</h2>
        <div id="cupnow"></div>
      </div>
    </div>
    <section class="card">
      <h2>Owed</h2>
      <p class="hint">Finished cups and the three people to pay. Marking one paid is a note to yourself — nothing leaves an account from here.</p>
      <div id="cupowed"></div>
    </section>
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
    data: null, search: '', sort: 'games', dir: -1,
    // The desk opens on people, not browsers: real players only, and a feed
    // with the visitor noise switched off. Both are one click away.
    onlyReal: true, feedTourists: false,
    expanded: null, expandedPlayer: null, drawerMsg: null,
    lastFetch: 0, error: false,
    // The ads gateway keeps its own books and its own endpoint, so it is
    // polled beside the main payload rather than folded into it.
    ads: null, adsError: false,
    cup: null,
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
  /**
   * Every profile the server knows, each row already flagged real (finished
   * a game) or not. The payload called this list "profiles" before the desk
   * learned the difference; keep reading that too, so an old tab still renders.
   */
  function allPlayers() {
    return (state.data && (state.data.players || state.data.profiles)) || [];
  }
  /** The server's day series, oldest first — the book of who actually played. */
  function series() { return (state.data && state.data.series) || []; }
  /**
   * The days of that series as timestamps, rebuilt from the server's date
   * key in the reader's own clock. The server stamps each day with its own
   * local midnight, and a desk open in another timezone — a UTC box read
   * from India, the normal case — buckets the recent-games fallback into
   * midnights that no day on this axis has, so the games line goes flat
   * beside a hero that says six games today. A day's key is its name; the
   * reader's midnight for that name is where it belongs on this axis.
   */
  function seriesDays() {
    return series().map(function (d) {
      // Split, not a regex: this whole file is one template literal, and a
      // backslash inside it never reaches the browser.
      var p = String((d && d.key) || '').split('-');
      var y = Number(p[0]), mo = Number(p[1]), day = Number(p[2]);
      var named = p.length === 3 && y > 1970 && mo >= 1 && mo <= 12 && day >= 1 && day <= 31;
      return named ? new Date(y, mo - 1, day).getTime() : (d && d.at);
    });
  }
  /** That series keyed by day, so a lookup never depends on array positions. */
  function seriesByDay() {
    var s = series(), d = seriesDays(), map = {}, i;
    for (i = 0; i < s.length; i++) map[d[i]] = s[i];
    return map;
  }
  /** One column of the series over an arbitrary day list — 0 where it is silent. */
  function seriesPerDay(days, key) {
    var book = seriesByDay();
    return days.map(function (d) { return book[d] ? (Number(book[d][key]) || 0) : 0; });
  }
  /**
   * Games per day for a set of days, from whichever book actually knows.
   * A day the tally recorded is read from the tally; a day it never saw
   * (anything before this panel shipped) falls back to the recent-games
   * list, which is capped at a hundred but does remember the past.
   */
  function gamesPerDay(days) {
    var book = seriesByDay();
    var tail = perDayOver(days, (state.data && state.data.recentGames) || [], function (g) { return g.at; });
    return days.map(function (d, i) {
      var row = book[d];
      return row && row.recorded ? (Number(row.games) || 0) : tail[i];
    });
  }
  /** True once the day book has seen at least one day — the honest cut-off. */
  function bookHasHistory() {
    return series().some(function (d) { return d.recorded; });
  }
  function sum(list) { return list.reduce(function (a, b) { return a + b; }, 0); }
  function peak(list) { return list.length ? Math.max.apply(null, list) : 0; }
  function countNonZero(list) {
    var n = 0;
    list.forEach(function (v) { if (v > 0) n++; });
    return n;
  }
  /**
   * Axis ticks that do not lie. The old scale hung its gridlines at 0, half
   * and all of the peak, so a peak of 5 drew a line labelled "3" at 2.5.
   * This rounds the top of the scale up to a 1-2-5 step and puts a label on
   * every step, which also gives an all-zero series a real 0-1 axis to hang
   * its baseline on instead of a bare line.
   */
  function niceTicks(max, wanted, integer) {
    var want = wanted > 0 ? wanted : 4;
    if (!(max > 0) || !isFinite(max)) return { top: 1, step: 1, ticks: [0, 1] };
    var raw = max / want;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    if (!(mag > 0) || !isFinite(mag)) mag = 1;
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    if (integer && step < 1) step = 1;
    var top = Math.ceil(max / step - 1e-9) * step;
    if (!(top > 0)) top = step;
    var ticks = [], i;
    // Multiply rather than accumulate: 0.1 added seven times is not 0.7.
    for (i = 0; i * step <= top + 1e-9 && i <= 20; i++) ticks.push(i * step);
    if (ticks[ticks.length - 1] < top) ticks.push(top);
    return { top: top, step: step, ticks: ticks };
  }
  /** Evenly spaced x-label positions, deduped — works for 1 day or 90. */
  function tickIndexes(n, wanted) {
    if (n <= 0) return [];
    if (n === 1) return [0];
    var want = Math.max(2, Math.min(wanted || 5, n));
    var out = [], seen = {}, i, idx;
    for (i = 0; i < want; i++) {
      idx = Math.round(i * (n - 1) / (want - 1));
      if (!seen[idx]) { seen[idx] = 1; out.push(idx); }
    }
    return out;
  }
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
    var W = 640, H = o.h || 190, padL = 48, padR = 12, padT = 12, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var n = Math.min(days.length, counts.length);
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img"' +
      (o.title ? ' aria-label="' + esc(o.title) + '"' : '') + '>';
    if (n <= 0) {
      // No axis to draw at all — say so rather than render an empty frame.
      return svg + '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" class="empty">' +
        esc(o.empty || 'Nothing recorded yet') + '</text></svg>';
    }
    var max = peak(counts.slice(0, n));
    var live = countNonZero(counts.slice(0, n));
    var sc = niceTicks(max, H > 200 ? 4 : 3, !o.frac);
    var fmt = o.fmt || function (v) { return String(Math.round(v * 100) / 100); };
    var xFor = function (i) { return padL + (n > 1 ? i * plotW / (n - 1) : plotW / 2); };
    var yFor = function (v) { return H - padB - (v / sc.top) * plotH; };
    var band = n > 1 ? plotW / (n - 1) : plotW;
    var i;

    // Faint weekly uprights, so the eye can count weeks without labels.
    for (i = 7; i < n; i += 7) {
      svg += '<line x1="' + xFor(i).toFixed(1) + '" y1="' + padT + '" x2="' + xFor(i).toFixed(1) +
        '" y2="' + (H - padB) + '" stroke="#16251c" stroke-width="1"/>';
    }
    sc.ticks.forEach(function (v) {
      var y = yFor(v);
      svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) +
        '" stroke="' + (v === 0 ? '#28402f' : '#1e2f24') + '" stroke-width="1"/>' +
        '<text x="' + (padL - 7) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" class="axis">' + esc(fmt(v)) + '</text>';
    });
    tickIndexes(n, 5).forEach(function (di) {
      svg += '<text x="' + xFor(di).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="axis">' + dateLabel(days[di]) + '</text>';
    });

    if (max > 0) {
      var pts = [];
      for (i = 0; i < n; i++) pts.push(xFor(i).toFixed(1) + ',' + yFor(counts[i]).toFixed(1));
      svg += gradientDefs(o.id, o.color);
      // One point has no area to fill; give it a stub so the day still reads
      // as a column rather than a floating dot.
      if (n === 1) {
        svg += '<rect x="' + (xFor(0) - 9).toFixed(1) + '" y="' + yFor(counts[0]).toFixed(1) + '" width="18" height="' +
          (H - padB - yFor(counts[0])).toFixed(1) + '" fill="url(#' + o.id + ')"/>';
      } else {
        svg += '<path d="M' + xFor(0).toFixed(1) + ',' + (H - padB) + ' L' + pts.join(' L') + ' L' +
          xFor(n - 1).toFixed(1) + ',' + (H - padB) + ' Z" fill="url(#' + o.id + ')"/>';
        svg += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + o.color +
          '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      }
      for (i = 0; i < n; i++) {
        var c = counts[i];
        svg += '<circle cx="' + xFor(i).toFixed(1) + '" cy="' + yFor(c).toFixed(1) + '" r="' +
          (live <= 2 && c > 0 ? '3.6' : '2.4') + '" fill="' + o.color +
          '" fill-opacity="' + (c > 0 ? '1' : '.28') + '"/>';
      }
      // A lone day of data is a fact, not a trend: label it in place so the
      // spike cannot be mistaken for a line.
      if (live === 1) {
        for (i = 0; i < n; i++) {
          if (counts[i] <= 0) continue;
          var lx = Math.min(W - padR - 30, Math.max(padL + 30, xFor(i)));
          svg += '<text x="' + lx.toFixed(1) + '" y="' + Math.max(padT + 9, yFor(counts[i]) - 8).toFixed(1) +
            '" text-anchor="middle" class="axis" fill="' + o.color + '">' + esc(fmt(counts[i])) + '</text>';
        }
      }
    } else {
      svg += '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) +
        '" stroke="#2a4033" stroke-width="1.5" stroke-dasharray="3 6" stroke-linecap="round"/>';
      svg += '<text x="' + (padL + plotW / 2).toFixed(1) + '" y="' + (padT + plotH / 2 + 4).toFixed(1) +
        '" text-anchor="middle" class="empty">' + esc(o.empty || 'Nothing recorded yet') + '</text>';
    }

    // Hover targets last, so a whole day-wide column answers the pointer —
    // a 2px dot is not a target anyone can hit.
    for (i = 0; i < n; i++) {
      svg += '<rect x="' + Math.max(padL, xFor(i) - band / 2).toFixed(1) + '" y="' + padT +
        '" width="' + Math.min(band, W - padR - padL).toFixed(1) + '" height="' + plotH.toFixed(1) +
        '" fill="transparent"><title>' + esc(dateLabel(days[i]) + ' — ' + (o.tip ? o.tip(counts[i]) : counts[i])) + '</title></rect>';
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
    if (kind === 'visit') {
      // A door left ajar: someone looked in, nobody sat down.
      return s + '#6f7d71"><path d="M4 2.6h5.2v10.8H4z"/><path d="M9.2 4.2 12 3v10l-2.8-1.2"/><circle cx="7.6" cy="8" r=".7"/></svg>';
    }
    if (kind === 'admin') {
      return s + '#e88a7d"><path d="M8 2.2l4.6 1.7v3.3c0 2.9-1.8 4.9-4.6 6.4-2.8-1.5-4.6-3.5-4.6-6.4V3.9z"/></svg>';
    }
    return s + '#93a396"><circle cx="8" cy="8" r="5.5"/></svg>';
  }

  // ------------------------------------------------------------ sections --
  var SECTIONS = ['overview', 'revenue', 'players', 'tables', 'games', 'economy', 'ads', 'cup', 'moderation', 'system'];
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
    // Ads paying out on a provider the owner did not choose is the sort of
    // thing that goes unnoticed for a month unless the front page says it.
    var ads = state.ads;
    if (ads && ads.settings && ads.settings.enabled && ads.provider) {
      if (ads.settings.testMode) {
        html += '<div class="alert red"><b>Rewarded ads are live on Google\\'s TEST ids.</b> ' +
          'No impression earns anything and rewards are paid without server-side verification. Turn test mode off in Ads.</div>';
      } else if (!ads.provider.ok) {
        html += '<div class="alert amber"><b>Rewarded ads are live on the house adapter.</b> ' +
          esc(ads.provider.line) + ' Coins are being paid for house promos, not for anything an advertiser has bought.</div>';
      } else if (ads.ssv && ads.provider.per && ads.provider.per.ios === 'admob' && !ads.ssv.lastOkAt && ads.ssv.rejected) {
        html += '<div class="alert amber"><b>Every AdMob verification callback so far has been turned away.</b> ' +
          esc(ads.ssv.lastRejectReason || '') + ' — no reward on the app can be paid until one lands. See Ads → Verification.</div>';
      }
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
    // One fortnight, one axis: the hero's four sparklines share the tail of
    // the same day list the charts below are drawn on, so "today" means the
    // same thing in every card even when the server's calendar is a few
    // hours ahead of the reader's.
    var sDays = seriesDays();
    var days14 = sDays.length >= 14 ? sDays.slice(-14) : lastNDays(14);
    var paid = (state.data.ledger || []).filter(function (e) { return e.usd > 0; });
    var revSpark = perDayOver(days14, paid, function (e) { return e.at; }, function (e) { return e.usd; });
    // Both game numbers come off the same blended day series the chart below
    // draws. Counting the hero from the recent-games list instead put "2
    // games today" beside a chart that had recorded one — the same number,
    // two books, one card apart.
    var gSpark = gamesPerDay(days14);
    var realSpark = seriesPerDay(days14, 'players');
    var gToday = gSpark.length ? gSpark[gSpark.length - 1] : 0;
    var g14 = sum(gSpark);

    var split = { stripe: 0, apple: 0 };
    paid.forEach(function (e) { if (split[e.provider] != null) split[e.provider] += e.usd; });

    var html = '';

    // The headline the owner asked for: people who have actually played.
    // Everything about a browser that opened a lobby lives downstairs in the
    // secondary strip, labelled for what it is.
    var playedToday = realSpark.length ? realSpark[realSpark.length - 1] : 0;
    var played14 = sum(realSpark);
    var realFoot = t.realPlayers > 0
      ? (playedToday > 0
        ? fmtNum(playedToday) + ' finished a game today · ' + fmtNum(played14) + ' player-days over the last 14.'
        : (played14 > 0
          ? 'Nobody has finished a game today — ' + fmtNum(played14) + ' player-days over the last 14.'
          : 'Nobody has finished a game in a fortnight. The line is real players per day.'))
      : (t.profiles > 0
        ? 'No profile has finished a game yet, so nobody counts as a real player. ' +
          fmtNum(t.profiles) + ' profile' + (t.profiles === 1 ? '' : 's') + ' exist' + (t.profiles === 1 ? 's' : '') +
          ', all of them visitors so far.'
        : 'Nobody has opened a lobby yet. The first finished game puts the first player on this line.');
    // The big number is who was *around* today; the line and the footnote
    // are who *played*. Both belong on this card, but the label has to say
    // which is which — "5 today" over "1 finished a game today" is the same
    // overcount the profile row was guilty of, one rung up.
    html += '<div class="hcard"><div class="hlabel">Real players</div>' +
      '<div class="hmain"><b class="hbig">' + fmtNum(t.realToday) + '<small> seen today</small></b>' +
      '<div class="hside"><div><b>' + fmtNum(t.realWeek) + '</b><span>seen this week</span></div>' +
      '<div><b>' + fmtNum(t.realPlayers) + '</b><span>all-time</span></div></div></div>' +
      '<div class="hspark">' + miniSpark(realSpark, '#4fd98b', 'hs-real') + '</div>' +
      '<div class="hfoot">' + realFoot + '</div></div>';

    var revFoot = paid.length
      ? fmtUsd(split.stripe) + ' Stripe · ' + fmtUsd(split.apple) + ' Apple'
      : 'Ledger starts today — the first sale draws the first line.';
    html += '<div class="hcard"><div class="hlabel">Revenue</div>' +
      '<div class="hmain"><b class="hbig">' + fmtUsd(r.total) + '</b>' +
      '<div class="hside"><div><b>' + fmtUsd(r.last7d) + '</b><span>last 7 days</span></div>' +
      '<div><b>' + fmtNum(r.purchases) + '</b><span>purchases</span></div></div></div>' +
      '<div class="hspark">' + miniSpark(revSpark, '#7ba0f2', 'hs-rev') + '</div>' +
      '<div class="hfoot">' + revFoot + '</div></div>';

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

    var finishRate = t.gamesStarted > 0 ? Math.round((t.gamesEnded || 0) / t.gamesStarted * 100) : null;
    html += '<div class="hcard"><div class="hlabel">Games</div>' +
      '<div class="hmain"><b class="hbig">' + fmtNum(gToday) + '<small> today</small></b>' +
      '<div class="hside"><div><b>' + fmtNum(t.gamesEnded) + '</b><span>finished</span></div>' +
      '<div><b>' + fmtNum(t.gamesStarted) + '</b><span>started</span></div></div></div>' +
      '<div class="hspark">' + miniSpark(gSpark, '#e3a93c', 'hs-games') + '</div>' +
      '<div class="hfoot">' + fmtNum(g14) + ' finished in the last 14 days' +
      (finishRate == null ? '.' : ' — ' + finishRate + '% of started games reach an ending.') + '</div></div>';

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
    // A profile is minted the moment a browser joins a lobby, so this number
    // counts visitors and test tabs. It stays on the page — it just stops
    // pretending to be an audience.
    var realPct = t.profiles > 0 ? (Number(t.realPlayers || 0) / t.profiles * 100).toFixed(1) : '0';
    swap('substrip',
      '<div class="scard" title="Every profile ever minted — one is created the moment any browser joins a lobby"><b>' +
        fmtNum(t.profiles) + '</b>' +
        (t.profiles > 0 ? '<span class="microstack"><i style="width:' + realPct + '%;background:#e3a93c"></i><i style="flex:1;background:#33473a"></i></span>' : '') +
        '<span>profiles incl. visitors · ' + fmtNum(t.realPlayers) + ' real</span></div>' +
      '<div class="scard"><b>' + fmtNum(t.dau) + ' / ' + fmtNum(t.wau) + '</b><span>any profile seen · today / 7d</span></div>' +
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
      // A one-coin daily reward saying "1 coins" is the busiest line on a
      // quiet server; count the noun.
      var coins = fmtNum(e.coins) + ' coin' + (e.coins === 1 ? '' : 's');
      if (e.provider === 'admin') txt = '<b>' + esc(e.code || '?') + '</b> credited ' + coins + ' <span class="dim">· admin' + (e.note ? ' — ' + esc(e.note) : '') + '</span>';
      // The note says which payout this was — a win or a runner-up placing.
      // They are not the same thing and the feed should not call them one.
      else if (e.provider === 'win') txt = '<b>' + esc(e.code || '?') + '</b> earned ' + coins + ' <span class="dim">· ' + esc(e.note || 'game payout') + '</span>';
      // A streak claim is not a sale, and saying "bought" about it made the
      // busiest line on a quiet server read like revenue.
      else if (e.provider === 'daily') txt = '<b>' + esc(e.code || '?') + '</b> claimed ' + coins + ' <span class="dim">· daily reward' + (e.note ? ' — ' + esc(e.note) : '') + '</span>';
      else txt = '<b>' + esc(e.code || '?') + '</b> bought ' + esc(e.packId || 'coins') + ' <span class="dim">· ' + esc(e.provider) + (e.usd > 0 ? ' · ' + fmtUsd(e.usd) : '') + '</span>';
      evts.push({ at: e.at, kind: 'coin', html: txt });
    });
    // Sign-up lines, told honestly. A profile with no finished game is a
    // browser that looked in — it says so, and it is hidden by default so
    // the feed reads as a record of play instead of a record of page loads.
    var cutoff = Date.now() - 30 * DAY;
    allPlayers().forEach(function (p) {
      if (!p.created || p.created < cutoff) return;
      if (p.real) {
        evts.push({
          at: p.created, kind: 'join',
          html: '<b>' + esc(p.name || p.code) + '</b> joined <span class="dim">· player · ' + esc(p.code) +
            ' · ' + fmtNum(p.games) + ' game' + (p.games === 1 ? '' : 's') + ' since</span>',
        });
      } else {
        evts.push({
          at: p.created, kind: 'visit', tourist: true,
          html: '<b>' + esc(p.name || p.code) + '</b> opened a lobby <span class="dim">· visitor, no game finished · ' + esc(p.code) + '</span>',
        });
      }
    });
    // The day a visitor becomes a player is worth a line of its own.
    allPlayers().forEach(function (p) {
      if (!p.real || !p.firstPlayedExact || p.firstPlayed < cutoff) return;
      evts.push({
        at: p.firstPlayed, kind: 'game',
        html: '<b>' + esc(p.name || p.code) + '</b> finished their first game <span class="dim">· now a real player · ' + esc(p.code) + '</span>',
      });
    });
    ((state.data.moderation || {}).audit || []).forEach(function (a) {
      // Credits already surface as their ledger entry — one line per story.
      if (!a.at || a.action === 'credit') return;
      evts.push({ at: a.at, kind: 'admin', html: '<b>' + esc(a.action) + '</b> ' + esc(a.target || '') + (a.detail ? ' <span class="dim">· ' + esc(a.detail) + '</span>' : '') });
    });
    evts.sort(function (a, b) { return b.at - a.at; });
    var tourists = 0;
    evts.forEach(function (ev) { if (ev.tourist) tourists++; });
    var visible = state.feedTourists ? evts : evts.filter(function (ev) { return !ev.tourist; });
    var shown = visible.slice(0, 30);
    document.getElementById('feedcount').textContent =
      shown.length ? (shown.length < visible.length ? shown.length + ' of ' + fmtNum(visible.length) : String(shown.length)) : '';
    var vc = document.getElementById('feed-vcount');
    if (vc) vc.textContent = tourists ? '+' + fmtNum(tourists) : '';
    var html = shown.map(function (ev) {
      return '<div class="feed-row"><span class="glyph">' + glyph(ev.kind) + '</span>' +
        '<div class="ftext">' + ev.html + '</div>' +
        '<span class="ftime" title="' + esc(fmtWhen(ev.at)) + '">' + fmtAgo(ev.at) + '</span></div>';
    }).join('');
    if (!shown.length) {
      html = '<div class="dim" style="font-size:13px;padding:8px 2px;line-height:1.5">' +
        (tourists && !state.feedTourists
          ? 'Nothing but visitor traffic in the last 30 days — ' + fmtNum(tourists) +
            ' browser' + (tourists === 1 ? '' : 's') + ' opened a lobby without finishing a game. Switch to "Include visitors" to see them.'
          : 'Quiet so far — finished games, sales, sign-ups and admin actions land here as they happen.') + '</div>';
    } else if (!state.feedTourists && tourists) {
      html += '<div class="dim" style="font-size:11.5px;padding:9px 4px 2px;line-height:1.5">' +
        fmtNum(tourists) + ' visitor line' + (tourists === 1 ? '' : 's') + ' hidden — profiles that never finished a game.</div>';
    }
    var el = document.getElementById('feed');
    var top = el.scrollTop;
    el.innerHTML = html;
    el.scrollTop = top;
  }

  /** Set a section header's count chip, or clear it when there is nothing to say. */
  function setCount(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text || '';
  }

  function renderOverviewCharts() {
    var t = state.data.totals || {};
    // Every chart on this page rides the server's day series, so all three
    // share one axis and one definition of "a day".
    var days = seriesDays();
    var haveSeries = days.length > 0;
    if (!haveSeries) days = last30Days();

    // 1. Real players per day — the graph the owner asked for.
    var rCounts = seriesPerDay(days, 'players');
    var rTotal = sum(rCounts), rPeak = peak(rCounts), rDays = countNonZero(rCounts);
    document.getElementById('ov-real').innerHTML = areaChart(days, rCounts, {
      id: 'ag-real', color: '#4fd98b', h: 200, title: 'Real players per day, last 30 days',
      empty: 'No finished games in 30 days — the first one draws the first point',
      tip: function (v) { return v + ' real player' + (v === 1 ? '' : 's'); },
    });
    setCount('ov-real-count', rPeak > 0 ? 'peak ' + fmtNum(rPeak) + '/day' : '');
    document.getElementById('ov-real-cap').textContent = rTotal > 0
      ? fmtNum(rTotal) + ' player-day' + (rTotal === 1 ? '' : 's') + ' across ' + fmtNum(rDays) + ' active day' +
        (rDays === 1 ? '' : 's') + ' — the same person on two days counts twice. ' +
        fmtNum(t.realPlayers) + ' real player' + (t.realPlayers === 1 ? '' : 's') + ' all-time.'
      : 'This line is drawn from finished games, and it started recording when this panel shipped — a game that ends today puts its players on today.';

    // 2. Games per day. The day book is the better source — it is not capped
    // at a hundred games — but it only started recording when this panel
    // shipped, so any day it never saw falls back to the recent-games tail
    // rather than claiming a quiet day that wasn't.
    var gCounts = gamesPerDay(days);
    var gTotal = sum(gCounts), gPeak = peak(gCounts);
    document.getElementById('ov-games').innerHTML = areaChart(days, gCounts, {
      id: 'ag-games', color: '#e3a93c', h: 200, title: 'Games finished per day, last 30 days',
      empty: 'No finished games yet — the first one draws the first point',
      tip: function (v) { return v + ' game' + (v === 1 ? '' : 's'); },
    });
    setCount('ov-games-count', gPeak > 0 ? 'peak ' + fmtNum(gPeak) + '/day' : '');
    document.getElementById('ov-games-cap').textContent = gTotal > 0
      ? fmtNum(gTotal) + ' game' + (gTotal === 1 ? '' : 's') + ' finished in the last 30 days, of ' +
        fmtNum(t.gamesEnded) + ' all-time.' +
        (bookHasHistory() ? '' : ' Drawn from the recent-games list until the day tally has a history of its own.')
      : 'Finished games land here as tables wrap up.';

    // 3. New real players per day — first finished game, not first page load.
    var nCounts = seriesPerDay(days, 'newReal');
    var nTotal = sum(nCounts);
    var tourists = Math.max(0, Number(t.profiles || 0) - Number(t.realPlayers || 0));
    var exact = 0;
    allPlayers().forEach(function (p) { if (p.real && p.firstPlayedExact) exact++; });
    document.getElementById('ov-newp').innerHTML = areaChart(days, nCounts, {
      id: 'ag-newp', color: '#7ba0f2', h: 200, title: 'New real players per day, last 30 days',
      empty: 'Nobody has finished a first game in 30 days',
      tip: function (v) { return v + ' new real player' + (v === 1 ? '' : 's'); },
    });
    setCount('ov-newp-count', nTotal > 0 ? fmtNum(nTotal) + ' in 30d' : '');
    document.getElementById('ov-newp-cap').textContent = nTotal > 0
      ? fmtNum(nTotal) + ' visitor' + (nTotal === 1 ? '' : 's') + ' became real player' + (nTotal === 1 ? '' : 's') +
        ' in the last 30 days.' + (exact < t.realPlayers ? ' Players who turned real before first-game tracking shipped are dated by their profile birthdate.' : '')
      : 'A point lands here the day someone finishes their first game.' +
        (tourists > 0
          ? ' ' + fmtNum(tourists) + ' profile' + (tourists === 1 ? ' is' : 's are') + ' still waiting to become one.'
          : '');
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
    var W = 860, H = 200, padL = 52, padR = 8, padT = 10, padB = 24;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var n = days.length;
    // Dollars are fractional, so the ticks are too — but they still land on
    // round steps, and the top of the scale is a number, not the peak bar.
    var sc = niceTicks(max, 3, false);
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Revenue per day, last 30 days">';
    sc.ticks.forEach(function (v) {
      var y = H - padB - (v / sc.top) * plotH;
      svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) +
        '" stroke="' + (v === 0 ? '#28402f' : '#223428') + '" stroke-width="1"/>' +
        '<text x="' + (padL - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="axis">' + fmtUsd(v) + '</text>';
    });
    var step = plotW / Math.max(1, n), bw = Math.max(4, step * 0.6);
    days.forEach(function (d, i) {
      var x = padL + i * step + (step - bw) / 2;
      var y = H - padB;
      [['apple', '#b9c7bd'], ['stripe', '#7ba0f2'], ['other', '#e3a93c']].forEach(function (s) {
        var v = byDay[d][s[0]];
        if (v <= 0) return;
        var h = Math.max(1.5, v / sc.top * plotH);
        y -= h;
        svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) +
          '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + s[1] + '"><title>' +
          dateLabel(d) + ' — ' + s[0] + ' ' + fmtUsd(v) + '</title></rect>';
      });
    });
    tickIndexes(n, 5).forEach(function (i) {
      var x = padL + i * step + step / 2;
      svg += '<text x="' + x.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" class="axis">' + dateLabel(days[i]) + '</text>';
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
    // Zero draws nothing: a sliver where there is no value reads as "a
    // little", which is a different claim from "none".
    var pct = max > 0 && value > 0 ? Math.max(0.6, value / max * 100) : 0;
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
      html += '<tr class="row room-row' + (state.expanded === r.id ? ' open' : '') + '" data-room="' + esc(r.id) +
        '" tabindex="0" role="button" aria-expanded="' + (state.expanded === r.id ? 'true' : 'false') + '">' +
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

    // The day book, not the 100-game tail: the table below forgets, this
    // line does not.
    var haveSeries = series().length > 0;
    var days = haveSeries ? seriesDays() : last30Days();
    var counts = gamesPerDay(days);
    var pCounts = seriesPerDay(days, 'players');
    document.getElementById('gameschart').innerHTML = areaChart(days, counts, {
      id: 'ag-games2', color: '#e3a93c', h: 190, title: 'Games finished per day, last 30 days',
      empty: 'No finished games yet — the first one draws the first point',
      tip: function (v) { return v + ' game' + (v === 1 ? '' : 's'); },
    });
    var total = sum(counts);
    document.getElementById('gamescaption').textContent = total > 0
      ? fmtNum(total) + ' finished in the last 30 days (peak ' + fmtNum(peak(counts)) + '/day)' +
        (bookHasHistory() ? ', with ' + fmtNum(sum(pCounts)) + ' real player-days behind them' : '') +
        '. The table below keeps only the ' + fmtNum(games.length) + ' most recent.'
      : 'Finished games land here as tables wrap up. Only the most recent 100 are kept in the table below.';
  }

  function playerByCode(code) {
    var profs = allPlayers();
    for (var i = 0; i < profs.length; i++) if (profs[i].code === code) return profs[i];
    return null;
  }

  function fact(label, value, raw) {
    return '<div><span>' + esc(label) + '</span><b>' + (raw ? value : esc(value)) + '</b></div>';
  }

  function drawerHtml(p, cols) {
    var html = '<tr class="pdetail"><td colspan="' + (cols || 10) + '"><div class="detail-box">';

    html += '<div class="facts">' +
      fact('code', p.code) +
      fact('name', (p.name || '—') + (p.flag ? ' ' + p.flag : '')) +
      fact('kind', p.real
        ? '<span class="pill player">real player</span>'
        : '<span class="pill visitor">visitor — no finished game</span>', true) +
      fact('games', fmtNum(p.games)) +
      fact('wins', fmtNum(p.wins) + (p.winnings ? ' · ' + fmtNum(p.winnings) + ' coins won' : '')) +
      fact('turns played', fmtNum(p.turnsPlayed)) +
      fact('coins', fmtNum(p.coins)) +
      fact('karma', fmtNum(p.karma)) +
      fact('friends', fmtNum(p.friends)) +
      fact('sign-in', p.login ? p.login.provider + (p.email ? ' · ' + p.email : '') : 'anonymous') +
      fact('first game', p.real
        ? fmtWhen(p.firstPlayed) + (p.firstPlayedExact ? '' : ' (est. from birthdate)')
        : 'never') +
      fact('profile created', fmtWhen(p.created)) +
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
    var everyone = allPlayers();
    var realTotal = 0;
    everyone.forEach(function (p) { if (p.real) realTotal++; });
    setCount('pf-real-n', realTotal ? fmtNum(realTotal) : '0');
    setCount('pf-all-n', fmtNum(everyone.length));
    var btnReal = document.getElementById('pf-real');
    var btnAll = document.getElementById('pf-all');
    if (btnReal) btnReal.setAttribute('aria-pressed', state.onlyReal ? 'true' : 'false');
    if (btnAll) btnAll.setAttribute('aria-pressed', state.onlyReal ? 'false' : 'true');

    var profs = state.onlyReal ? everyone.filter(function (p) { return p.real; }) : everyone.slice();
    var q = state.search.trim().toLowerCase();
    if (q) {
      profs = profs.filter(function (p) {
        var hay = (p.code + ' ' + (p.name || '') + ' ' + (p.email || '') + ' ' +
          ((p.login && p.login.provider) || '') + ' ' + (p.status || '') +
          (p.real ? ' player real' : ' visitor tourist') +
          (p.banned ? ' banned' : '')).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    // Busiest first by default: games, then wins, then the wallet. Every
    // sort falls back to games and then to turns, so a player who was already
    // playing before the game counter shipped still ranks by the record that
    // does go back — and two ties never shuffle between refreshes.
    var k = state.sort || 'games';
    var dir = state.dir < 0 ? -1 : 1;
    profs.sort(function (a, b) {
      var d = ((Number(a[k]) || 0) - (Number(b[k]) || 0)) * dir;
      if (d) return d;
      return (Number(b.games) || 0) - (Number(a.games) || 0) ||
        (Number(b.turnsPlayed) || 0) - (Number(a.turnsPlayed) || 0) ||
        (a.code < b.code ? -1 : 1);
    });

    var arrow = function (key) { return state.sort === key ? (state.dir < 0 ? ' ▾' : ' ▴') : ''; };
    var th = function (key, label) {
      return '<th class="sortable" data-sort="' + key + '" tabindex="0" role="button" title="Sort by ' + label + '">' +
        label + arrow(key) + '</th>';
    };
    var html = '<tr><th>code</th><th>name</th>' +
      (state.onlyReal ? '' : '<th>kind</th>') +
      th('games', 'games') + th('wins', 'wins') + th('turnsPlayed', 'turns') +
      th('coins', 'coins') + th('karma', 'karma') +
      th('seen', 'last seen') + '<th>status</th><th>login</th></tr>';
    var cols = state.onlyReal ? 10 : 11;
    profs.slice(0, 500).forEach(function (p) {
      var login = p.login
        ? esc(p.login.provider) + (p.email ? ' <span class="dim">' + esc(p.email) + '</span>' : '')
        : '<span class="dim">—</span>';
      html += '<tr class="row player-row' + (state.expandedPlayer === p.code ? ' open' : '') +
        '" data-player="' + esc(p.code) + '" tabindex="0" role="button" aria-expanded="' +
        (state.expandedPlayer === p.code ? 'true' : 'false') + '">' +
        '<td class="mono">' + esc(p.code) + '</td>' +
        '<td>' + esc(p.name || '—') + (p.flag ? ' ' + esc(p.flag) : '') +
          (p.banned ? ' <span class="pill bad">banned</span>' : '') + '</td>' +
        (state.onlyReal ? '' : '<td>' + (p.real
          ? '<span class="pill player">player</span>'
          : '<span class="pill visitor">visitor</span>') + '</td>') +
        '<td>' + fmtNum(p.games) + '</td>' +
        '<td>' + (p.wins > 0 ? '<span class="ok">' + fmtNum(p.wins) + '</span>' : '<span class="dim">0</span>') + '</td>' +
        '<td class="dim">' + fmtNum(p.turnsPlayed) + '</td>' +
        '<td class="gold">' + fmtNum(p.coins) + '</td>' +
        '<td>' + fmtNum(p.karma) + '</td>' +
        '<td>' + (p.seen ? fmtAgo(p.seen) : '—') + '</td>' +
        '<td>' + esc(p.status) + (p.roomId ? ' <span class="mono dim">(' + esc(p.roomId) + ')</span>' : '') + '</td>' +
        '<td>' + login + '</td></tr>';
      if (state.expandedPlayer === p.code) html += drawerHtml(p, cols);
    });
    if (!profs.length) {
      html += '<tr><td colspan="' + cols + '" class="dim" style="padding:16px 10px;line-height:1.6">' +
        (q
          ? 'Nobody matches that filter' + (state.onlyReal ? ' among real players — try "Everyone".' : '.')
          : (state.onlyReal && everyone.length
            ? 'No real players yet. ' + fmtNum(everyone.length) + ' profile' + (everyone.length === 1 ? ' exists' : 's exist') +
              ', but none has finished a game — a profile is minted the moment any browser joins a lobby. Switch to "Everyone" to see them.'
            : 'No profiles yet — the first browser to open a lobby gets the first row.')) + '</td></tr>';
    }
    document.getElementById('playercount').textContent =
      fmtNum(profs.length) + (state.onlyReal ? ' real' : ' incl. visitors') + (q ? ' matching' : '') +
      (profs.length > 500 ? ' (showing 500)' : '');
    keepInputs(['d-coins', 'd-creason', 'd-karma', 'd-kreason', 'd-breason'], function () {
      swap('playersT', html);
    });
  }

  /**
   * The split, drawn once so the ratio is impossible to misread: how many of
   * the profiles on file belong to someone who has actually played.
   */
  function renderPlayerMix() {
    var t = state.data.totals || {};
    var everyone = allPlayers();
    var real = Number(t.realPlayers || 0);
    var total = everyone.length || Number(t.profiles || 0);
    var visitors = Math.max(0, total - real);
    var pct = total > 0 ? (real / total * 100) : 0;
    var never = 0, once = 0;
    everyone.forEach(function (p) {
      if (!p.real) return;
      // Exactly one, not "at most one": a real player carrying turns from
      // before the game counter shipped has games 0, and we do not know how
      // many they played. Counting them as one-and-done would be a guess.
      if (p.games === 1) once++;
      if (!p.wins) never++;
    });
    var html = total
      ? '<div class="stack">' +
          (real ? '<i style="width:' + pct.toFixed(1) + '%;background:#e3a93c"></i>' : '') +
          (visitors ? '<i style="flex:1;background:#33473a"></i>' : '') +
        '</div>' +
        '<div class="legend">' +
          '<span><i style="background:#e3a93c"></i>' + fmtNum(real) + ' real player' + (real === 1 ? '' : 's') +
            ' · ' + pct.toFixed(0) + '%</span>' +
          '<span><i style="background:#33473a"></i>' + fmtNum(visitors) + ' visitor' + (visitors === 1 ? '' : 's') + '</span>' +
        '</div>'
      : '<div class="dim" style="font-size:13px">No profiles on file yet.</div>';
    html += '<div class="caption">A profile is minted the moment any browser joins a lobby — a test tab, a second phone and a passer-by all get one. ' +
      'A real player has finished at least one game, which is the only number on this desk worth planning around.</div>';
    if (real) {
      html += '<div class="idsplit">' +
        '<div><b>' + fmtNum(t.realToday) + '</b><span>seen today</span></div>' +
        '<div><b>' + fmtNum(t.realWeek) + '</b><span>seen this week</span></div>' +
        '<div><b>' + fmtNum(once) + '</b><span>played once only</span></div>' +
        '<div><b>' + fmtNum(real - never) + '</b><span>have won a game</span></div></div>';
    }
    document.getElementById('playermix').innerHTML = html;
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

  // ---------------------------------------------------------------- ads --
  // The gateway ships dark and is meant to be switched on years after it was
  // written, so this card has one job: make it obvious what is live, what a
  // view pays, and what stops anyone farming it. Every control here writes
  // through to a file on disk — no redeploy, no env var, no restart.
  var AD_SLOTS = [
    { id: 'doubleWin', label: 'Double a win', line: 'After winning, one ad pays the purse a second time.' },
    { id: 'freeCoins', label: 'Free coins', line: 'A small grant, for anyone who wants to sit through one.' },
  ];
  var AD_INPUTS = ['ad-dw-factor', 'ad-dw-cap', 'ad-fc-coins', 'ad-fc-cap',
    'ad-pre-every',
    'ad-gap', 'ad-ceiling', 'ad-ttl', 'ad-window', 'ad-ssvwait',
    'ad-mob-app', 'ad-mob-dw', 'ad-mob-fc', 'ad-mob-net', 'ad-mob-pre',
    'ad-h5-client', 'ad-h5-dw', 'ad-h5-fc'];

  // What each kind of client is told, in the words the desk should use for it.
  var AD_SURFACES = [
    { id: 'ios', label: 'iPhone app' },
    { id: 'android', label: 'Android app' },
    { id: 'web', label: 'Browser' },
  ];
  var AD_NET_NAME = { house: 'House', admob: 'AdMob', h5: 'H5' };

  /** The same two-button switch the rest of this page uses. */
  function adSeg(name, val, options) {
    var html = '<span class="seg" role="group">';
    options.forEach(function (o) {
      html += '<button type="button" data-ads-set="' + esc(name) + '" data-ads-val="' + esc(o.val) + '"' +
        ' aria-pressed="' + (String(o.val) === String(val) ? 'true' : 'false') + '">' + esc(o.text) + '</button>';
    });
    return html + '</span>';
  }

  function adNum(id, label, val, hint) {
    return '<div class="field" style="width:132px"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" type="number" min="0" step="1" value="' + esc(val) + '">' +
      (hint ? '<div class="caption" style="margin-top:5px;line-height:1.4">' + esc(hint) + '</div>' : '') +
      '</div>';
  }

  function adText(id, label, val, placeholder, hint) {
    return '<div class="field" style="flex:1;min-width:230px"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" type="text" spellcheck="false" value="' + esc(val || '') + '" placeholder="' + esc(placeholder) + '">' +
      (hint ? '<div class="caption" style="margin-top:5px;line-height:1.4">' + esc(hint) + '</div>' : '') +
      '</div>';
  }

  /**
   * The verification door, per network. This card exists because the way this
   * fails in production is silence: an SSV URL with a typo in it, or pasted
   * onto one ad unit and not the other, and nothing anywhere says so — the
   * ads play, the rewards refuse, and the owner hears about it from a player.
   * So the counts are printed even when they are zero, and the last rejection
   * is kept in the server's own words.
   */
  function renderAdSsv(a, s) {
    var ssv = a.ssv || {};
    var pv = a.provider || {};
    var nets = pv.networks || {};
    var mobLive = (pv.per || {}).ios === 'admob';

    var html = '<div class="mini-forms" style="gap:26px;margin-bottom:14px">' +
      '<div><div class="dim" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase">callback URL</div>' +
      '<div class="mono" style="font-size:13px;margin-top:3px">' + esc(ssv.url || '/api/ads/ssv') + '</div></div>' +
      '<div><div class="dim" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase">confirmed</div>' +
      '<div style="font-size:13px;margin-top:3px"><b>' + fmtNum(ssv.ok) + '</b> since boot</div></div>' +
      '<div><div class="dim" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase">turned away</div>' +
      '<div style="font-size:13px;margin-top:3px"><b>' + fmtNum(ssv.rejected) + '</b> since boot</div></div>' +
      '<div><div class="dim" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase">verifier keys</div>' +
      '<div style="font-size:13px;margin-top:3px">' +
      (ssv.keysAt ? fmtNum(ssv.keyCount) + ' held, fetched ' + fmtWhen(ssv.keysAt) : 'not fetched yet') +
      '</div></div>' +
      '</div>';

    var rows = '<tr><th>network</th><th>state</th><th>last word from it</th></tr>';
    rows += '<tr><td>AdMob <span class="dim">app</span></td>' +
      '<td>' + (nets.admob && nets.admob.ready
        ? (mobLive ? '<span class="pill ok">serving</span>' : '<span class="pill dim">configured, not chosen</span>')
        : '<span class="pill warn">not configured</span>') + '</td>' +
      '<td>' + (ssv.lastOkAt
        ? 'confirmed ' + fmtWhen(ssv.lastOkAt) + ' <span class="dim">— unit ' + esc(ssv.lastOkUnit || '?') +
          ', network ' + esc(ssv.lastOkNetwork || '?') + '</span>'
        : '<span class="dim">no callback has ever reached this server</span>') + '</td></tr>';
    rows += '<tr><td>H5 <span class="dim">browser</span></td>' +
      '<td>' + (nets.h5 && nets.h5.ready
        ? ((pv.per || {}).web === 'h5' ? '<span class="pill ok">serving</span>' : '<span class="pill dim">configured, not chosen</span>')
        : '<span class="pill warn">not configured</span>') + '</td>' +
      '<td class="dim">no server-side verification exists for this product — the ticket and the caps are the whole limit</td></tr>';
    html += '<div class="scroll"><table>' + rows + '</table></div>';

    if (ssv.lastRejectAt) {
      html += '<div class="alert amber" style="margin-top:12px"><b>Last rejected callback:</b> ' +
        esc(ssv.lastRejectReason || 'unknown reason') +
        ' <span class="dim">— ad unit ' + esc(ssv.lastRejectUnit || 'not named') + ', ' + fmtWhen(ssv.lastRejectAt) + '.</span>' +
        ' Every rejection is on the server log with its reason and unit.</div>';
    }
    if (mobLive && !s.testMode && !ssv.lastOkAt) {
      html += '<div class="caption" style="margin-top:10px">AdMob is serving and nothing has called yet. Until a callback lands, every claim on the app answers <span class="mono">402</span> — check the SSV URL on <b>each</b> rewarded unit in the console.</div>';
    }
    if (ssv.keysError) {
      html += '<div class="caption" style="margin-top:8px">Last key fetch failed: ' + esc(ssv.keysError) + '. Callbacks are refused rather than trusted while the set cannot be read.</div>';
    }
    swap('adssv', html);
  }

  function renderAds() {
    var a = state.ads;
    if (!a) {
      swap('adswitch', '<div class="dim" style="font-size:13px">' +
        (state.adsError ? 'The ads gateway did not answer. It is mounted at /api/ads — check the server log.' : 'Loading…') + '</div>');
      return;
    }
    var s = a.settings || {};
    var caps = s.caps || {};
    var pv = a.provider || {};
    var today = a.today || {};
    var slots = s.placements || {};
    var inters = s.interstitials || {};
    var preGame = inters.preGame || {};
    var interUnits = (s.admob && s.admob.interstitialUnits) || {};
    var dw = slots.doubleWin || {};
    var fc = slots.freeCoins || {};

    // Who is serving is now two answers, because the app and the browser buy
    // from different Google desks and one of them can be ready before the
    // other. The tile says both rather than picking a winner.
    var per = pv.per || {};
    var serving = (AD_NET_NAME[per.ios] || 'House') + ' / ' + (AD_NET_NAME[per.web] || 'House');

    swap('adtiles',
      tileHtml(s.enabled ? 'ADS ON' : 'ADS OFF', 'rewarded ads', s.enabled ? 'the watch-an-ad buttons are showing' : 'every ad button is hidden in the app and the web') +
      tileHtml(serving, 'serving', s.testMode ? 'TEST ids — no revenue' : 'app / browser') +
      tileHtml(fmtNum(today.views), 'views today', '') +
      tileHtml(fmtNum(today.coins), 'coins paid today', '') +
      tileHtml(fmtNum(today.players), 'players reached', 'distinct wallets') +
      tileHtml(fmtNum(a.tickets && a.tickets.outstanding), 'tickets in flight', 'offers not yet claimed'));

    var sw = '<div class="mini-forms" style="gap:26px">' +
      '<div><div class="field"><label>Ads master switch</label>' +
      adSeg('enabled', s.enabled ? '1' : '0', [{ val: '0', text: 'Ads OFF' }, { val: '1', text: 'Ads ON' }]) +
      '</div><div class="caption" style="max-width:260px">One switch for the lot. Off, and no player on any platform sees an ad button at all — not "Watch an ad — double your winnings" on the game-over sheet, not the free-coins card on the home screen. They do not grey out; they are not drawn.</div></div>';
    // The two families, above the individual slots: one switch each, because
    // rewarded and interstitial are different products and an owner wanting
    // one of them gone should not have to remember which slots belonged to it.
    var kinds = s.kinds || { rewarded: true, interstitial: true };
    sw += '<div><div class="field"><label>Rewarded ads</label>' +
      adSeg('kind:rewarded', kinds.rewarded === false ? '0' : '1',
        [{ val: '0', text: 'Off' }, { val: '1', text: 'On' }]) +
      '</div><div class="caption" style="max-width:260px">Both of the ads that pay coins — the double-win offer and the free-coins card. Off, and neither is drawn and neither claim is honoured, whatever the two switches below say.</div></div>';
    sw += '<div><div class="field"><label>Interstitial ads</label>' +
      adSeg('kind:interstitial', kinds.interstitial === false ? '0' : '1',
        [{ val: '0', text: 'Off' }, { val: '1', text: 'On' }]) +
      '</div><div class="caption" style="max-width:260px">Every break that pays the player nothing. Off, and no full-screen ad is shown anywhere, whatever the pre-game switch says.</div></div>';
    AD_SLOTS.forEach(function (slot) {
      var spec = slots[slot.id] || {};
      sw += '<div><div class="field"><label>' + esc(slot.label) + '</label>' +
        adSeg('placement:' + slot.id, spec.enabled ? '1' : '0', [{ val: '0', text: 'Off' }, { val: '1', text: 'On' }]) +
        '</div><div class="caption" style="max-width:260px">' + esc(slot.line) + '</div></div>';
    });
    // The one break that pays nothing. Its own switch, because it is the one
    // an owner is most likely to want off in a hurry.
    sw += '<div><div class="field"><label>Pre-game break</label>' +
      adSeg('interstitial:preGame', preGame.enabled ? '1' : '0',
        [{ val: '0', text: 'Off' }, { val: '1', text: 'On' }]) +
      '</div><div class="caption" style="max-width:260px">A full-screen ad while a quick match is being found. Pays the player nothing — it is the only ad here that does not. iPhone only, and only with an interstitial unit id below.</div></div>';
    sw += '</div>';
    if (!s.enabled) {
      sw += '<div class="caption" style="margin-top:12px">Nothing pays out while ads are off: both the offer and the reward endpoint refuse, and <span class="mono">/api/ads/config</span> reports <span class="mono">enabled: false</span> — so every client, including one already installed on a phone, draws no ad button until you switch it back on. It takes effect on the next screen a player opens; no redeploy, no app update.</div>';
    } else if (!pv.ok) {
      sw += '<div class="alert amber" style="margin-top:12px"><b>Ads are live on the house adapter.</b> ' + esc(pv.line) + '</div>';
    }
    // Test mode pays real coins for Google's test inventory and cannot be
    // verified, so it is the one state on this page that shouts while ads are
    // live. It is fine on a staging server and never fine on this one.
    if (s.testMode && s.enabled) {
      sw += '<div class="alert red" style="margin-top:12px"><b>Test mode is ON while ads are live.</b> ' +
        'Google test ids are serving, no impression earns anything, and rewards are paid without server-side verification. ' +
        'Turn it off under "Who is serving" before leaving this server alone.</div>';
    }
    if (s.changedAt) sw += '<div class="caption" style="margin-top:8px">Last changed ' + fmtWhen(s.changedAt) + '.</div>';
    swap('adswitch', sw);

    // What the caps actually add up to, so nobody has to do the arithmetic
    // in their head. A win pays 2 coins today, which is what the double-up
    // is worth per view.
    // Read every number the way the server reads it: a zero is a zero here,
    // not a missing value that quietly becomes the default.
    var num = function (v, d) { return isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d; };
    var perDw = Math.max(0, Math.round((num(dw.factor, 2) - 1) * 2));
    var reach = num(dw.dailyCap, 0) * perDw + num(fc.dailyCap, 0) * num(fc.coins, 0);
    var ceiling = num(caps.dailyCoinCap, 0);
    var bind = ceiling <= 0
      ? 'The ceiling is zero, so nothing pays out at all: the placements above stay live and every claim is refused. That is the way to shut the faucet without changing anything else.'
      : ceiling < reach
        ? 'The ceiling binds first: a player tops out at ' + fmtNum(ceiling) + ' coins a day, not ' + fmtNum(reach) + '.'
        : 'The per-placement caps bind first: a player tops out at ' + fmtNum(reach) + ' coins a day, under the ' + fmtNum(ceiling) + '-coin ceiling.';

    swap('adrewards',
      '<div class="mini-forms" style="gap:16px">' +
      adNum('ad-dw-factor', 'Win × factor', dw.factor, 'A win pays ' + perDw + ' extra coin(s) per view at this factor.') +
      adNum('ad-dw-cap', 'Double-ups a day', dw.dailyCap, '') +
      adNum('ad-fc-coins', 'Free coins a view', fc.coins, '') +
      adNum('ad-fc-cap', 'Free views a day', fc.dailyCap, '') +
      adNum('ad-pre-every', 'Pre-game gap (min)', preGame.everyMinutes,
        'The shortest wait between two pre-game breaks on one device. An ad before every single game is how an app gets deleted.') +
      '</div><hr class="divider">' +
      '<div class="mini-forms" style="gap:16px">' +
      adNum('ad-gap', 'Seconds between claims', caps.minIntervalSec, 'Longer than an ad, so hitting it takes effort.') +
      adNum('ad-ceiling', 'Coin ceiling a day', caps.dailyCoinCap, 'The hard stop, whatever the caps above say. Zero stops every payout.') +
      adNum('ad-ttl', 'Ticket life (sec)', caps.ticketTtlSec, 'How long an offer stays claimable.') +
      adNum('ad-window', 'Win window (min)', caps.winWindowMin, 'How stale a win may be and still be doubled. Zero: none are.') +
      adNum('ad-ssvwait', 'Wait for Google (sec)', caps.ssvWaitSec, 'How long a claim holds the door for the verification callback before saying "not yet". Zero: no wait.') +
      '</div>' +
      '<div class="caption" style="margin-top:10px">' + esc(bind) + '</div>');

    var mob = s.admob || {};
    var units = mob.units || {};
    var h5 = s.h5 || {};
    var h5slots = h5.slots || {};
    var nets = pv.networks || {};

    // What every kind of client is actually being told right now. One setting
    // produces three answers, so the desk prints all three rather than leaving
    // the owner to work out which half of "Google" his phone is getting.
    var surfaces = '<div class="mini-forms" style="gap:18px;margin:12px 0 14px">';
    AD_SURFACES.forEach(function (surface) {
      var net = per[surface.id] || 'house';
      surfaces += '<div><div class="dim" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase">' +
        esc(surface.label) + '</div><div style="font-size:14px;margin-top:3px">' +
        '<span class="pill ' + (net === 'house' ? 'dim' : 'ok') + '">' + esc(AD_NET_NAME[net] || net) + '</span>' +
        '</div></div>';
    });
    surfaces += '</div>';

    /** One network's readiness, in a line the owner can act on. The line names
     *  its own network, so the pill is the only label the row needs. */
    function netLine(net) {
      net = net || {};
      return '<div style="font-size:13px;margin-bottom:8px">' +
        (net.ready ? '<span class="pill ok">configured</span>' : '<span class="pill warn">not configured</span>') +
        ' <span class="dim">' + esc(net.line || '') + '</span></div>';
    }

    swap('adprovider',
      '<div class="mini-forms" style="gap:26px">' +
      '<div><div class="field"><label>Adapter</label>' +
      adSeg('provider', (s.provider === 'google' ? 'google' : 'house'),
        [{ val: 'house', text: 'House' }, { val: 'google', text: 'Google' }]) +
      '</div></div>' +
      '<div><div class="field"><label>Test ids</label>' +
      adSeg('testMode', s.testMode ? '1' : '0', [{ val: '0', text: 'Live' }, { val: '1', text: 'Test' }]) +
      '</div><div class="caption" style="max-width:260px">Google\\'s own published ids. Real ads, no revenue, and no verification — for checking a client is wired up before the account exists.</div></div>' +
      '</div>' +
      surfaces +
      '<div style="font-size:13px;margin:10px 0 14px">' +
      (pv.ok ? '<span class="pill ok">ready</span>' : '<span class="pill warn">falling back</span>') +
      ' <span class="dim">' + esc(pv.line || '') + '</span></div>' +
      '<hr class="divider">' +
      netLine(nets.admob) +
      '<div class="mini-forms" style="gap:16px">' +
      adText('ad-mob-app', 'AdMob app id', mob.appId, 'ca-app-pub-…~…', '') +
      '</div><div class="mini-forms" style="gap:16px;margin-top:8px">' +
      adText('ad-mob-dw', 'Double-win rewarded unit', units.doubleWin, 'ca-app-pub-…/…', '') +
      adText('ad-mob-fc', 'Free-coins rewarded unit', units.freeCoins, 'ca-app-pub-…/…', '') +
      '</div><div class="mini-forms" style="gap:16px;margin-top:8px">' +
      adText('ad-mob-pre', 'Pre-game INTERSTITIAL unit', interUnits.preGame, 'ca-app-pub-…/…',
        'A different kind of unit from the two above — make it as Interstitial in AdMob, not Rewarded.') +
      '</div><div class="mini-forms" style="gap:16px;margin-top:8px">' +
      adText('ad-mob-net', 'Pin ad_network (optional)', mob.adNetworkId, '5450213213286189855',
        'Leave blank unless you have seen what arrives. Under mediation the callback names whoever filled the slot, and pinning the wrong one rejects your own revenue.') +
      '</div>' +
      '<div class="caption" style="margin-top:10px">On AdMob a reward is paid only once the server-side verification callback from Google reaches <span class="mono">/api/ads/ssv</span> and its signature checks out. Paste that path, on this host, into the SSV URL field of <b>each</b> rewarded ad unit in the AdMob console.</div>' +
      '<hr class="divider">' +
      netLine(nets.h5) +
      '<div class="mini-forms" style="gap:16px">' +
      adText('ad-h5-client', 'AdSense publisher id', h5.clientId, 'ca-pub-…', 'From the approved AdSense account. This alone switches the browser on.') +
      '</div><div class="mini-forms" style="gap:16px;margin-top:8px">' +
      adText('ad-h5-dw', 'Double-win slot (optional)', h5slots.doubleWin, '1234567890', '') +
      adText('ad-h5-fc', 'Free-coins slot (optional)', h5slots.freeCoins, '1234567890', '') +
      '</div>' +
      '<div class="caption" style="margin-top:10px">H5 Games Ads has no server-side verification — Google publishes none for it — so a browser reward rests on the ticket, the interval and the caps above, exactly as a house ad does. Keep the browser\\'s numbers where you would be happy to see them all claimed.</div>');

    renderAdSsv(a, s);

    var by = today.byPlacement || {};
    var rows = '<tr><th>placement</th><th>views today</th><th>coins paid</th><th>cap each</th></tr>';
    AD_SLOTS.forEach(function (slot) {
      var row = by[slot.id] || { views: 0, coins: 0 };
      var spec = slots[slot.id] || {};
      rows += '<tr><td>' + esc(slot.label) + (spec.enabled ? '' : ' <span class="pill dim">off</span>') + '</td>' +
        '<td>' + fmtNum(row.views) + '</td><td>' + fmtNum(row.coins) + '</td>' +
        '<td class="dim">' + fmtNum(spec.dailyCap) + ' a player a day</td></tr>';
    });
    rows += '<tr><td><b>total</b></td><td><b>' + fmtNum(today.views) + '</b></td>' +
      '<td><b>' + fmtNum(today.coins) + '</b></td><td class="dim">across ' + fmtNum(today.players) + ' player(s)</td></tr>';
    swap('adtoday', '<div class="scroll"><table>' + rows + '</table></div>' +
      (today.views ? '' : '<div class="caption">Nothing paid out today.</div>'));
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
    renderPlayerMix();
    renderEconomy();
    keepInputs(AD_INPUTS, renderAds);
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

  /**
   * Every ads control writes the same way: a patch of only what changed, so
   * two tabs open on this page cannot overwrite each other's untouched fields.
   */
  function saveAds(patch, msgId) {
    post('/api/ads/admin', patch, function (r) {
      if (r && r.ok) {
        setMsg(msgId, r.changed && r.changed.length ? 'Saved — ' + r.changed.join(', ') + '.' : 'Nothing to change.', true);
        refreshAds();
      } else {
        setMsg(msgId, (r && r.error) || 'Could not save.', false);
      }
    });
  }

  function adFieldNum(id) {
    var el = document.getElementById(id);
    if (!el || el.value === '') return undefined;
    var n = Number(el.value);
    return isFinite(n) ? n : undefined;
  }
  function adFieldText(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : undefined;
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

    // The cup switches and its pay-out notes.
    el = t.closest('[data-cup-en]');
    if (el) {
      if (el.getAttribute('aria-pressed') === 'true') return;
      var on = el.getAttribute('data-cup-en') === '1';
      if (on && !confirm('Switch tournaments ON?' + NL + NL +
        'The cup card appears on the web for every player, and anybody signed in can enter.')) return;
      cupPost('enable', { enabled: on });
      return;
    }
    el = t.closest('[data-cup-paid]');
    if (el) {
      var parts = el.getAttribute('data-cup-paid').split('|');
      if (!confirm('Mark ' + parts[1] + ' place as paid?' + NL + NL +
        'This is a note to yourself. Nothing leaves any account from here.')) return;
      cupPost('paid', { cupId: parts[0], place: parts[1] });
      return;
    }

    // The ads switches. Turning the system on is the one click on this page
    // that starts paying strangers, so it asks first.
    el = t.closest('[data-ads-set]');
    if (el) {
      var what = el.getAttribute('data-ads-set');
      var val = el.getAttribute('data-ads-val');
      if (el.getAttribute('aria-pressed') === 'true') return;
      var patch = {};
      if (what === 'enabled') {
        if (val === '1' && !confirm('Switch rewarded ads ON?' + NL + NL +
          'Clients will start showing ad buttons and paying coins for finished views, immediately, on this server.')) return;
        patch.enabled = val === '1';
      } else if (what === 'provider') {
        patch.provider = val;
      } else if (what === 'testMode') {
        if (val === '1' && !confirm('Switch to Google\\'s TEST ids?' + NL + NL +
          'Real ads from Google\\'s test account, no revenue, and rewards pay without server-side verification. ' +
          'For proving a client is wired up — never for a server with players on it.')) return;
        patch.testMode = val === '1';
      } else if (what.indexOf('kind:') === 0) {
        patch.kinds = {};
        patch.kinds[what.slice(5)] = val === '1';
      } else if (what.indexOf('placement:') === 0) {
        patch.placements = {};
        patch.placements[what.slice(10)] = { enabled: val === '1' };
      } else if (what.indexOf('interstitial:') === 0) {
        if (val === '1' && !confirm('Turn the pre-game break on?' + NL + NL +
          'A full-screen ad while a quick match is being found. It pays the player nothing — ' +
          'it is the one ad here that is purely revenue. Needs an interstitial unit id below.')) return;
        patch.interstitials = {};
        patch.interstitials[what.slice(13)] = { enabled: val === '1' };
      } else return;
      saveAds(patch, 'adsmsg');
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

  // Enter or Space on a focused row does what a click does — the drawer is
  // the main verb on this page and it should not need a mouse.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var el = e.target;
    if (!el || !el.closest) return;
    if (el.closest('input, textarea, button, a')) return;
    var row = el.closest('.player-row, .room-row, th.sortable');
    if (!row) return;
    e.preventDefault();
    row.click();
  });

  document.getElementById('search').addEventListener('input', function (e) {
    state.search = e.target.value;
    renderPlayers();
  });

  // The two switches that decide whether this desk is looking at people or
  // at browsers. Both re-render in place; neither touches the poll.
  function setOnlyReal(on) {
    if (state.onlyReal === on) return;
    state.onlyReal = on;
    state.expandedPlayer = null;
    state.drawerMsg = null;
    if (state.data) renderPlayers();
  }
  // The date box is read as this browser's own wall clock and sent as an
  // instant, so the server never has to guess which timezone the desk is in.
  function cupWhenMs() {
    var raw = (document.getElementById('cup-when') || {}).value;
    if (!raw) return 0;
    var t = new Date(raw).getTime();
    return isFinite(t) ? t : 0;
  }
  function cupWhenNote() {
    var note = document.getElementById('cup-when-note');
    if (!note) return;
    var ms = cupWhenMs();
    if (!ms) { note.textContent = 'Blank — joining starts the moment you save.'; return; }
    var away = ms - Date.now();
    if (away <= 60000) { note.textContent = 'That time has passed — joining will just start now.'; return; }
    var mins = Math.round(away / 60000);
    var human = mins < 60 ? mins + ' minutes'
      : mins < 1440 ? (Math.round(mins / 6) / 10) + ' hours'
        : (Math.round(mins / 144) / 10) + ' days';
    note.textContent = 'Players will see this cup straight away and count down to ' +
      new Date(ms).toLocaleString() + ' — ' + human + ' from now. Nobody can join until then.';
  }
  var cupWhenBox = document.getElementById('cup-when');
  if (cupWhenBox) { cupWhenBox.addEventListener('input', cupWhenNote); cupWhenNote(); }

  // The button's own label follows the situation: nothing exists yet, or
  // there is something to save changes to.
  function cupButtonLabels() {
    var running = (!cupMakingNew && cupPicked)
      ? ((state.cup && state.cup.cups) || []).find(function (x) { return x.id === cupPicked; })
      : null;
    var title = document.getElementById('cup-formtitle');
    if (title) title.textContent = running ? 'Editing "' + running.name + '"' : 'Set up a new cup';
    var save = document.getElementById('cup-open');
    if (save) save.textContent = running ? 'Save changes' : 'Save this cup';
    var early = document.getElementById('cup-now');
    if (early) early.style.display = running && running.state === 'scheduled' ? '' : 'none';
    var stop = document.getElementById('cup-close');
    if (stop) stop.style.display = running && running.state === 'joining' ? '' : 'none';
    var del = document.getElementById('cup-cancel');
    if (del) del.style.display = running ? '' : 'none';
  }

  // Clicking a cup in the list points the form and the live panel at it.
  document.addEventListener('click', function (e) {
    var pick = e.target.closest && e.target.closest('[data-cup-pick]');
    if (!pick) return;
    cupMakingNew = false;
    cupPicked = pick.getAttribute('data-cup-pick');
    cupFormFilled = '';
    if (state.cup) renderCup();
  });
  var cupNewBtn = document.getElementById('cup-new');
  if (cupNewBtn) cupNewBtn.addEventListener('click', function () {
    // An empty form makes a new cup rather than changing the one on screen.
    cupMakingNew = true;
    cupPicked = '';
    cupFormFilled = 'new';
    ['cup-when', 'cup-code'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var name = document.getElementById('cup-name');
    if (name) { name.value = 'MoneyMove Cup'; name.focus(); name.select(); }
    cupButtonLabels();
    cupWhenNote();
    var list = document.getElementById('cuplistall');
    if (list) list.querySelectorAll('.cupcard.on').forEach(function (el) { el.classList.remove('on'); });
  });

  var cupOpenBtn = document.getElementById('cup-open');
  if (cupOpenBtn) cupOpenBtn.addEventListener('click', function () {
    var mins = Math.max(1, Number(document.getElementById('cup-mins').value) || 5);
    var cap = Math.max(0, Number(document.getElementById('cup-max').value) || 0);
    var code = (document.getElementById('cup-code').value || '').trim();
    var when = cupWhenMs();
    var running = cupPicked ? (state.cup.cups || []).find(function (x) { return x.id === cupPicked; }) : null;
    var ask = running
      ? 'Save these changes to "' + running.name + '"?' + NL + NL +
        'Everyone who has already joined stays joined.'
      : when > Date.now() + 60000
        ? 'Announce this cup for ' + new Date(when).toLocaleString() + '?' + NL + NL +
          'Players see it now and count down. Joining opens by itself then, stays open ' +
          mins + ' minutes, and the games start when it closes.'
        : 'Open joining now, for ' + mins + ' minutes?' + NL + NL +
          'When it closes, everyone who joined is paired off and the games start.';
    if (!confirm(ask)) return;
    cupPost(running ? 'update' : 'open', {
      cupId: running ? running.id : '',
      name: document.getElementById('cup-name').value,
      joinSeconds: mins * 60,
      opensAt: when,
      maxPlayers: cap,
      joinCode: code,
      prize: {
        currency: document.getElementById('cup-cur').value,
        first: Number(document.getElementById('cup-first').value),
        second: Number(document.getElementById('cup-second').value),
        third: Number(document.getElementById('cup-third').value),
      },
    });
  });
  var cupNowBtn = document.getElementById('cup-now');
  if (cupNowBtn) cupNowBtn.addEventListener('click', function () {
    if (!confirm('Let people start joining right now, ahead of the date?')) return;
    cupPost('openNow', { cupId: cupPicked });
  });
  var cupCloseBtn = document.getElementById('cup-close');
  if (cupCloseBtn) cupCloseBtn.addEventListener('click', function () {
    if (!confirm('Stop people joining now and start the games?')) return;
    cupPost('close', { cupId: cupPicked });
  });
  var cupCancelBtn = document.getElementById('cup-cancel');
  if (cupCancelBtn) cupCancelBtn.addEventListener('click', function () {
    if (!confirm('Delete this cup?' + NL + NL + 'Everyone who joined is dropped and nothing is paid.')) return;
    cupPost('cancel', { cupId: cupPicked });
  });

  document.getElementById('pf-real').addEventListener('click', function () { setOnlyReal(true); });
  document.getElementById('pf-all').addEventListener('click', function () { setOnlyReal(false); });

  function setFeedTourists(on) {
    if (state.feedTourists === on) return;
    state.feedTourists = on;
    document.getElementById('feed-hide').setAttribute('aria-pressed', on ? 'false' : 'true');
    document.getElementById('feed-all').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (state.data) renderFeed();
  }
  document.getElementById('feed-hide').addEventListener('click', function () { setFeedTourists(false); });
  document.getElementById('feed-all').addEventListener('click', function () { setFeedTourists(true); });

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

  document.getElementById('ad-save').addEventListener('click', function () {
    saveAds({
      placements: {
        doubleWin: { factor: adFieldNum('ad-dw-factor'), dailyCap: adFieldNum('ad-dw-cap') },
        freeCoins: { coins: adFieldNum('ad-fc-coins'), dailyCap: adFieldNum('ad-fc-cap') },
      },
      interstitials: {
        preGame: { everyMinutes: adFieldNum('ad-pre-every') },
      },
      caps: {
        minIntervalSec: adFieldNum('ad-gap'),
        dailyCoinCap: adFieldNum('ad-ceiling'),
        ticketTtlSec: adFieldNum('ad-ttl'),
        winWindowMin: adFieldNum('ad-window'),
        ssvWaitSec: adFieldNum('ad-ssvwait'),
      },
    }, 'adnummsg');
  });

  // Both networks save together: they are one decision — "here are my Google
  // ids" — and an owner who pastes four fields and presses one button should
  // not discover that only two of them went.
  document.getElementById('ad-mob-save').addEventListener('click', function () {
    saveAds({
      admob: {
        appId: adFieldText('ad-mob-app'),
        units: { doubleWin: adFieldText('ad-mob-dw'), freeCoins: adFieldText('ad-mob-fc') },
        interstitialUnits: { preGame: adFieldText('ad-mob-pre') },
        adNetworkId: adFieldText('ad-mob-net'),
      },
      h5: {
        clientId: adFieldText('ad-h5-client'),
        slots: { doubleWin: adFieldText('ad-h5-dw'), freeCoins: adFieldText('ad-h5-fc') },
      },
    }, 'adprovmsg');
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

  // The export follows the switch: real players by default, everyone when
  // the table is showing everyone. The kind column says which is which.
  document.getElementById('csv-players').addEventListener('click', function () {
    var rows = [['code', 'name', 'flag', 'kind', 'games', 'wins', 'turns_played', 'coins', 'karma', 'friends',
      'status', 'room', 'provider', 'email', 'first_game', 'last_seen', 'created', 'banned']];
    allPlayers().forEach(function (p) {
      if (state.onlyReal && !p.real) return;
      rows.push([p.code, p.name || '', p.flag || '', p.real ? 'player' : 'visitor',
        p.games, p.wins, p.turnsPlayed, p.coins, p.karma, p.friends, p.status,
        p.roomId || '', (p.login && p.login.provider) || '', p.email || '',
        p.real ? iso(p.firstPlayed) : '', iso(p.seen), iso(p.created), p.banned ? 'yes' : 'no']);
    });
    downloadCsv('moneymove-' + (state.onlyReal ? 'real-players-' : 'profiles-') +
      new Date().toISOString().slice(0, 10) + '.csv', rows);
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
    refreshAds();
    refreshCup();
  }

  // ── the cup ──────────────────────────────────────────────────────────
  // Everything the owner does to a tournament is one POST; the read comes
  // back on the same reply, so the desk never has to ask twice.
  function cupPost(action, body) {
    var payload = body || {};
    payload.action = action;
    post('/api/admin/cup', payload, function (d) {
      var msg = document.getElementById('cupmsg');
      if (d && d.error) { if (msg) { msg.textContent = d.error; msg.className = 'msg bad'; } return; }
      if (msg) { msg.textContent = 'Done.'; msg.className = 'msg good'; }
      // A cup that was just made becomes the one the desk is looking at.
      if (d && d.cup && d.cup.id) { cupMakingNew = false; cupPicked = d.cup.id; cupFormFilled = ''; }
      if (action === 'cancel') { cupMakingNew = false; cupPicked = ''; cupFormFilled = ''; }
      if (d && d.view) { state.cup = d.view; renderCup(); }
    });
  }

  // The join window's deadline, as the page last heard it, and the second
  // hand that runs against it.
  var cupClosesAt = 0;
  function cupClockText() {
    if (!cupClosesAt) return '';
    var left = Math.max(0, Math.round((cupClosesAt - Date.now()) / 1000));
    // Days and hours for an announcement, minutes and seconds for a door
    // that is actually closing — mm:ss is useless at three days out.
    if (left >= 86400) return Math.floor(left / 86400) + 'd ' + Math.floor((left % 86400) / 3600) + 'h';
    if (left >= 3600) return Math.floor(left / 3600) + 'h ' + Math.floor((left % 3600) / 60) + 'm';
    var m = Math.floor(left / 60), s = left % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  setInterval(function () {
    var el = document.getElementById('cup-clock');
    if (el && cupClosesAt) el.textContent = cupClockText();
  }, 1000);

  function cupMoney(cup, n) {
    var cur = (cup && cup.prize && cup.prize.currency) || 'USD';
    return (cur === 'USD' ? '$' : cur + ' ') + n;
  }

  // The form is filled from the cup that exists, the first time we see it, so
  // "change the date" is: open the panel, edit the box, press save. Only once
  // per cup — refilling it every five seconds would fight whoever is typing.
  var cupFormFilled = '';
  function fillCupForm(c) {
    if (!c || cupFormFilled === c.id) return;
    cupFormFilled = c.id;
    var set = function (id, value) {
      var el = document.getElementById(id);
      if (el) el.value = value;
    };
    set('cup-name', c.name);
    set('cup-mins', Math.max(1, Math.round((c.closesAt - c.openedAt) / 60000)));
    set('cup-max', c.maxPlayers || 0);
    set('cup-code', c.joinCode || '');
    set('cup-first', c.prize.first);
    set('cup-second', c.prize.second);
    set('cup-third', c.prize.third);
    set('cup-cur', c.prize.currency);
    // datetime-local wants the browser's own wall clock, without a zone.
    var d = new Date(c.openedAt);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    set('cup-when', c.state === 'scheduled'
      ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
      : '');
    cupWhenNote();
  }

  /** Which cup the form and the live panel are looking at. */
  var cupPicked = '';
  /** True while the form is being used to make a new one rather than edit an
   *  existing cup — the five-second refresh must not drag it back. */
  var cupMakingNew = false;
  var cupState = { scheduled: 'Waiting for its time', joining: 'Open for joining',
    running: 'Games in progress', done: 'Finished' };

  function renderCup() {
    var v = state.cup;
    if (!v) { swap('cuptiles', tileHtml('—', 'tournaments', 'loading')); return; }
    var cups = v.cups || [];
    // Stay on the cup you were looking at; fall back to the first. Unless a
    // new one is being written, in which case leave the form alone.
    if (!cupMakingNew && !cups.some(function (x) { return x.id === cupPicked; })) {
      cupPicked = cups.length ? cups[0].id : '';
      cupFormFilled = '';
    }
    var c = cupMakingNew ? null : (cups.find(function (x) { return x.id === cupPicked; }) || null);
    fillCupForm(c);
    if (!c) cupFormFilled = '';
    cupButtonLabels();

    // Every cup, one to a row, with what it is doing and when.
    swap('cuplistall', cups.length
      ? cups.map(function (x) {
        var when = x.state === 'scheduled' ? 'opens ' + new Date(x.openedAt).toLocaleString()
          : x.state === 'joining' ? 'closes ' + new Date(x.closesAt).toLocaleString()
            : x.state === 'running' ? (x.rounds.length + ' rounds drawn') : '';
        return '<div class="cupcard' + (x.id === cupPicked ? ' on' : '') + '" data-cup-pick="' + esc(x.id) + '">' +
          '<div class="cupcard-top"><b>' + esc(x.name) + '</b>' +
          '<span class="cupstate ' + esc(x.state) + '">' + esc(cupState[x.state] || x.state) + '</span></div>' +
          '<div class="caption">' + esc(when) + ' · ' + x.entrants.length +
          (x.maxPlayers ? ' of ' + x.maxPlayers : '') + ' joined' +
          (x.joinCode ? ' · code ' + esc(x.joinCode) : '') + '</div>' +
          '</div>';
      }).join('')
      : '<div class="caption">No cups yet. Press <b>New cup</b> and fill in the form below.</div>');

    var live = !c ? 'NONE'
      : c.state === 'scheduled' ? 'ANNOUNCED'
        : c.state === 'joining' ? 'JOINING OPEN'
          : c.state === 'running' ? 'RUNNING' : 'DONE';
    swap('cuptiles',
      tileHtml(v.enabled ? 'CUPS ON' : 'CUPS OFF', 'tournaments',
        !v.enabled ? 'hidden everywhere'
          : cups.length ? (cups.length === 1 ? 'players can see it' : cups.length + ' cups running')
            : 'on, but no cup made yet') +
      tileHtml(live, 'looking at', c ? esc(c.name) : 'no cup made') +
      tileHtml(c ? fmtNum(c.entrants.length) + (c.maxPlayers ? ' / ' + c.maxPlayers : '') : '0',
        'joined', c && c.maxPlayers ? 'limit set' : 'signed-in players') +
      tileHtml(String(cups.length), 'cups', 'live right now') +
      tileHtml(fmtNum(v.history.length), 'finished', 'kept for a while'));

    swap('cupswitch', '<div class="field"><label>Cup master switch</label>' +
      '<span class="seg" role="group">' +
      '<button type="button" data-cup-en="0" aria-pressed="' + (v.enabled ? 'false' : 'true') + '">Cups OFF</button>' +
      '<button type="button" data-cup-en="1" aria-pressed="' + (v.enabled ? 'true' : 'false') + '">Cups ON</button>' +
      '</span></div>' +
      '<div class="caption" style="max-width:520px;margin-top:8px">Off, and no player sees a cup at all — the card is not drawn and the join route refuses. This is the switch that keeps it hidden while you try it out.</div>');

    var now = '';
    if (!c) {
      // The commonest confusion at this desk: the switch is on, the tile says
      // CUPS ON, and nothing at all is happening because no cup was opened.
      now = v.enabled
        ? '<div class="cupnudge"><b>No cup yet.</b> The switch is on, but players see nothing ' +
          'until you fill in the form beside this and press <b>Save this cup</b>.</div>'
        : '<div class="caption">Cups are switched off — nobody sees anything. Turn them on, ' +
          'then set one up.</div>';
    }
    else {
      var plain = c.state === 'scheduled' ? 'waiting for its start time'
        : c.state === 'joining' ? 'open for joining'
          : c.state === 'running' ? 'games in progress' : 'finished';
      now = '<div class="field"><label>' + esc(c.name) + '</label></div>' +
        '<div class="caption">' + esc(plain) + ' · prizes ' +
        cupMoney(c, c.prize.first) + ' / ' + cupMoney(c, c.prize.second) + ' / ' + cupMoney(c, c.prize.third) + '</div>';
      // The clock, which ticks on its own between the five-second refreshes.
      // A countdown that only moves when the page reloads is not a countdown.
      if (c.state === 'scheduled') {
        cupClosesAt = c.openedAt;
        now += '<div class="caption" style="margin-top:6px">Joining opens <b>' +
          esc(new Date(c.openedAt).toLocaleString()) + '</b>. Players can see it and are counting down.</div>' +
          '<div class="cupclock"><span>Joining opens in</span>' +
          '<b id="cup-clock">' + cupClockText() + '</b></div>';
      } else if (c.state === 'joining') {
        cupClosesAt = c.closesAt;
        now += '<div class="cupclock"><span>Joining closes in</span>' +
          '<b id="cup-clock">' + cupClockText() + '</b></div>';
      } else {
        cupClosesAt = 0;
      }
      // Every round, not only the latest: the whole bracket is the thing
      // worth watching while a cup runs.
      var shown = 0;
      for (var ri = c.rounds.length - 1; ri >= 0; ri--) {
        var r = c.rounds[ri];
        var doneCount = 0;
        r.matches.forEach(function (m) { if (m.state === 'done') doneCount++; });
        now += '<div class="caption" style="margin-top:12px">Round ' + (ri + 1) + ' · <b>' + esc(r.kind) +
          '</b> — ' + doneCount + ' of ' + r.matches.length + ' tables finished.</div>';
        var room = r.matches.slice(0, Math.max(0, 80 - shown));
        shown += room.length;
        now += '<div>' + room.map(function (m) {
          var right = m.state === 'done'
            ? (m.void ? 'void — nobody came' : 'won by <b>' + esc(m.winner || '—') + '</b>' + (m.walkover ? ' (walkover)' : ''))
            : m.state === 'playing' ? 'playing at <b>' + esc(m.roomId || '—') + '</b>' : 'waiting for a table';
          return '<div class="caption" style="display:flex;gap:10px;justify-content:space-between;' +
            'padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)">' +
            '<span>' + esc(m.a) + ' v ' + esc(m.b) + '</span><span>' + right + '</span></div>';
        }).join('') + '</div>';
        if (room.length < r.matches.length) {
          now += '<div class="caption">and ' + (r.matches.length - room.length) + ' more tables</div>';
          break;
        }
      }
      // Who has actually joined. A comma-separated line was unreadable past
      // about six names, and this is the list the owner watches fill up.
      if (c.joinCode) {
        now += '<div class="cupcodebox"><span>Invite only — the code is</span>' +
          '<b>' + esc(c.joinCode) + '</b></div>' +
          '<div class="caption">Share it with whoever you want in. Nobody else can join, ' +
          'and no player ever sees it from the app.</div>';
      }
      now += '<div class="caption" style="margin-top:12px">Joined so far: <b>' + c.entrants.length +
        (c.maxPlayers ? ' of ' + c.maxPlayers : '') + '</b></div>';
      if (c.entrants.length) {
        now += '<div class="cuplist">' + c.entrants.slice(0, 200).map(function (e, i) {
          return '<div class="cuprow"><span class="cupnum">' + (i + 1) + '</span>' +
            '<span class="cupwho">' + esc(e.name) + '</span>' +
            '<span class="cupcode">' + esc(e.code) + '</span>' +
            (e.out ? '<span class="cupout">out</span>' : '') + '</div>';
        }).join('') + '</div>';
        if (c.entrants.length > 200) {
          now += '<div class="caption">and ' + (c.entrants.length - 200) + ' more</div>';
        }
      } else {
        now += '<div class="caption">Nobody yet.</div>';
      }
    }
    swap('cupnow', now);

    var owed = '';
    v.history.forEach(function (h) {
      if (!h.standings) return;
      var paid = h.paid || {};
      owed += '<div class="card" style="margin-bottom:10px"><b>' + esc(h.name) + '</b>' +
        '<div class="caption">' + h.entrants.length + ' entered</div>';
      ['first', 'second', 'third'].forEach(function (place) {
        var who = h.standings[place];
        if (!who) return;
        owed += '<div class="field" style="margin-top:8px"><label>' + place + ' — ' +
          cupMoney(h, h.prize[place]) + '</label>' +
          '<div class="caption">' + esc(who.name) + ' (' + esc(who.code) + ') ' +
          (paid[place] ? '· <b>paid</b>' : '<button class="btn sm" style="margin-left:8px" data-cup-paid="' +
            esc(h.id) + '|' + place + '">Mark paid</button>') + '</div></div>';
      });
      owed += '</div>';
    });
    swap('cupowed', owed || '<div class="caption">Nothing owed. Finished cups show up here with their three names.</div>');
  }

  function refreshCup() {
    post('/api/admin/cup', { action: 'read' }, function (d) {
      if (d && d.view) { state.cup = d.view; renderCup(); }
    });
  }

  // The ads gateway is its own router with its own books, so it answers on
  // its own endpoint. A server too old to have it simply leaves the card
  // saying so, and the rest of the page carries on.
  function refreshAds() {
    fetch('/api/ads/admin?key=' + encodeURIComponent(KEY))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        state.ads = d;
        state.adsError = false;
        keepInputs(AD_INPUTS, renderAds);
        if (state.data) renderAlerts();
      })
      .catch(function () {
        state.adsError = true;
        if (!state.ads) renderAds();
      });
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
