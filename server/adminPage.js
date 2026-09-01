// The master admin dashboard — one self-contained page, no external assets.
//
// Served by GET /admin (key-guarded) from index.js. Everything it shows comes
// from /api/admin/data, polled every five seconds; the two actions POST to
// /api/admin/credit and /api/admin/close-room with the key in the body.
//
// House rules the page follows:
//   - every user-controlled string (names, flags, emails, chat-adjacent text)
//     goes through esc() before touching innerHTML;
//   - re-renders replace table bodies only, never the inputs, so the search
//     box, sort choice, expanded room and scroll positions all survive the
//     five-second refresh;
//   - charts are hand-drawn SVG, no libraries;
//   - no emoji in the chrome — bots are marked "(bot)" in plain text.
//
// NOTE for editors: this whole file is one template literal. Keep backticks,
// backslashes and the ${ sequence out of the page source — client-side JS
// here uses string concatenation only, on purpose.

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
    margin: 0; padding: 22px clamp(14px, 3vw, 36px) 60px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #efeadd; background-color: #0b120e; min-height: 100vh;
    background-image:
      radial-gradient(1100px 520px at 15% -8%, rgba(38, 84, 58, .55), transparent 60%),
      radial-gradient(900px 420px at 95% 0%, rgba(227, 169, 60, .08), transparent 55%);
  }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
  h1 { font-size: 21px; margin: 0; letter-spacing: .2px; }
  h1 span { color: #e3a93c; font-weight: 600; }
  .status { font-size: 12px; color: #93a396; }
  .status .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #4fd98b; margin-right: 6px; vertical-align: 1px; }
  .status.err .dot { background: #e06c5f; }
  h2 { font-size: 12px; margin: 0 0 12px; color: #a9b4a6; text-transform: uppercase; letter-spacing: 1.4px; font-weight: 600; }
  h2 .count { color: #e3a93c; margin-left: 6px; letter-spacing: normal; text-transform: none; }
  h3 { font-size: 13px; margin: 0 0 10px; color: #cfd8cb; font-weight: 600; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .tile { background: linear-gradient(180deg, #16221b, #121b15); border: 1px solid #263a2e; border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 3px; }
  .tile b { font-size: 24px; color: #e3a93c; font-weight: 700; letter-spacing: .3px; }
  .tile span { font-size: 11px; color: #93a396; text-transform: uppercase; letter-spacing: 1px; }
  .tile em { font-style: normal; font-size: 11px; color: #b8c4b4; }

  .card { background: linear-gradient(180deg, #15201a, #111a15); border: 1px solid #263a2e; border-radius: 16px; padding: 16px 18px; margin-bottom: 18px; box-shadow: 0 8px 24px rgba(0, 0, 0, .25); }
  .cards { display: flex; gap: 16px; flex-wrap: wrap; align-items: stretch; }
  .cards .card { flex: 1 1 320px; min-width: 0; }

  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #1f2f26; vertical-align: top; }
  th { color: #7d8b7f; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .8px; position: sticky; top: 0; background: #131d17; z-index: 1; white-space: nowrap; }
  th.sortable { cursor: pointer; color: #cfd8cb; }
  th.sortable:hover { color: #e3a93c; }
  .scroll { overflow: auto; border: 1px solid #1f2f26; border-radius: 10px; }
  tr.row:hover td { background: rgba(227, 169, 60, .05); cursor: pointer; }
  tr.open td { background: rgba(227, 169, 60, .07); }
  .detail-box { background: #0e1712; border: 1px solid #24382c; border-radius: 10px; padding: 12px; margin: 4px 0 8px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
  .detail-box table th { position: static; }

  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .pill.ok { background: rgba(79, 217, 139, .12); color: #4fd98b; }
  .pill.warn { background: rgba(227, 169, 60, .14); color: #e3a93c; }
  .pill.dim { background: rgba(150, 160, 150, .12); color: #93a396; }
  .bot { color: #93a396; font-size: 11px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .dim { color: #93a396; }
  .gold { color: #e3a93c; font-weight: 600; }
  .ok { color: #4fd98b; }
  .hint { font-size: 12px; color: #93a396; margin: -6px 0 10px; }
  .caption { font-size: 12px; color: #93a396; margin-top: 8px; }
  .legend { display: flex; gap: 14px; margin-top: 10px; font-size: 12px; color: #b8c4b4; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
  .idsplit { display: flex; gap: 26px; margin-top: 14px; }
  .idsplit b { display: block; font-size: 20px; color: #efeadd; }
  .idsplit span { font-size: 11px; color: #93a396; text-transform: uppercase; letter-spacing: 1px; }

  .chart svg { width: 100%; height: auto; display: block; }
  .axis { fill: #7d8b7f; font-size: 10px; }
  .empty { fill: #7d8b7f; font-size: 13px; }

  input { background: #0d1511; border: 1px solid #2a4033; color: #efeadd; border-radius: 10px; padding: 9px 12px; font: inherit; width: 100%; }
  input:focus { outline: none; border-color: #e3a93c; }
  #search { max-width: 420px; margin-bottom: 12px; }
  .field { margin-bottom: 10px; }
  .field label { font-size: 11px; color: #93a396; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px; }
  .btn { background: #e3a93c; color: #171207; border: none; border-radius: 10px; padding: 9px 16px; font: inherit; font-weight: 700; cursor: pointer; }
  .btn:hover { filter: brightness(1.08); }
  .danger { background: #3a1f1b; color: #f0b9ae; border: 1px solid #6b3a31; border-radius: 10px; padding: 8px 14px; font: inherit; font-weight: 600; cursor: pointer; }
  .danger:hover { background: #4a2620; }
  .msg { font-size: 12px; margin-top: 10px; min-height: 16px; }
  .msg.ok { color: #4fd98b; }
  .msg.err { color: #e06c5f; }
  .divider { border: none; border-top: 1px solid #1f2f26; margin: 16px 0; }
</style>
</head>
<body>
<header>
  <h1>MoneyMove <span>Master Admin</span></h1>
  <div id="status" class="status"></div>
</header>
<main>
  <section class="tiles" id="tiles"></section>

  <section class="card">
    <h2>Revenue — last 30 days</h2>
    <div id="revchart" class="chart"></div>
    <div class="legend">
      <span><i style="background:#7ba0f2"></i>Stripe</span>
      <span><i style="background:#b9c7bd"></i>Apple</span>
      <span><i style="background:#e3a93c"></i>Other</span>
    </div>
    <div id="revcaption" class="caption"></div>
    <hr class="divider">
    <h3>Purchases</h3>
    <div class="scroll" style="max-height:340px"><table><tbody id="purchases"></tbody></table></div>
  </section>

  <section class="card">
    <h2>Live rooms <span class="count" id="roomcount"></span></h2>
    <p class="hint">Click a room to inspect its players or close it. Playing tables sort first.</p>
    <div class="scroll" style="max-height:440px"><table><tbody id="roomsT"></tbody></table></div>
  </section>

  <section class="cards">
    <div class="card" style="flex:1 1 260px;max-width:420px">
      <h2>Games per day</h2>
      <div id="sparkline" class="chart"></div>
      <div id="sparkcaption" class="caption"></div>
    </div>
    <div class="card" style="flex:2 1 420px">
      <h2>Recent games</h2>
      <div class="scroll" style="max-height:320px"><table><tbody id="games"></tbody></table></div>
    </div>
  </section>

  <section class="card">
    <h2>Players <span class="count" id="playercount"></span></h2>
    <input id="search" type="search" placeholder="Filter by code, name, email or provider" autocomplete="off" spellcheck="false">
    <div class="scroll" style="max-height:480px"><table><tbody id="playersT"></tbody></table></div>
  </section>

  <section class="cards">
    <div class="card">
      <h2>Top wallets</h2>
      <div class="scroll" style="max-height:380px"><table><tbody id="wallets"></tbody></table></div>
    </div>
    <div class="card">
      <h2>Karma distribution</h2>
      <div id="karma" class="chart"></div>
      <div class="idsplit" id="identity"></div>
    </div>
    <div class="card">
      <h2>Actions</h2>
      <h3>Credit coins</h3>
      <div class="field"><label for="c-code">Friend code</label><input id="c-code" autocomplete="off" spellcheck="false" placeholder="e.g. QK7M2X"></div>
      <div class="field"><label for="c-coins">Coins</label><input id="c-coins" type="number" min="1" step="1" placeholder="500"></div>
      <div class="field"><label for="c-reason">Reason</label><input id="c-reason" autocomplete="off" placeholder="Refund, prize, goodwill..."></div>
      <button class="btn" id="c-go">Credit coins</button>
      <div class="msg" id="actionmsg"></div>
      <hr class="divider">
      <h3>Close a room</h3>
      <div class="field"><label for="k-room">Room id</label><input id="k-room" autocomplete="off" spellcheck="false" placeholder="e.g. x7km2"></div>
      <button class="danger" id="k-go">Close room</button>
      <div class="msg" id="closemsg"></div>
    </div>
  </section>
</main>
<script>
(function () {
  'use strict';
  var KEY = new URLSearchParams(location.search).get('key') || '';
  var state = { data: null, search: '', sort: null, dir: -1, expanded: null, lastFetch: 0, error: false };
  var DAY = 86400000;

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
  function dayStart(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function last30Days() {
    var days = [], now = Date.now();
    for (var i = 29; i >= 0; i--) days.push(dayStart(now - i * DAY));
    return days;
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
  function post(url, body, cb) {
    body.key = KEY;
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }); })
      .then(cb)
      .catch(function () { cb({ error: 'Network error' }); });
  }

  // -------------------------------------------------------------- render --
  function renderStatus() {
    var el = document.getElementById('status');
    if (state.error) {
      el.className = 'status err';
      el.innerHTML = '<span class="dot"></span>connection lost — retrying';
    } else {
      el.className = 'status';
      el.innerHTML = '<span class="dot"></span>live · refreshes every 5s · updated ' +
        new Date(state.lastFetch).toLocaleTimeString();
    }
  }

  function tileHtml(v, label, sub) {
    return '<div class="tile"><b>' + esc(v) + '</b><span>' + esc(label) + '</span>' +
      (sub ? '<em>' + esc(sub) + '</em>' : '') + '</div>';
  }

  function renderTiles() {
    var t = state.data.totals || {};
    var r = state.data.revenue || {};
    swap('tiles',
      tileHtml(fmtUsd(r.total), 'revenue (ledger)', fmtUsd(r.last7d) + ' in the last 7 days') +
      tileHtml(fmtNum(t.gamesStarted), 'games started', '') +
      tileHtml(fmtNum(t.gamesEnded), 'games finished', '') +
      tileHtml(fmtNum(t.liveRooms), 'live rooms', '') +
      tileHtml(fmtNum(t.liveSockets), 'live sockets', '') +
      tileHtml(fmtNum(t.profiles), 'profiles', '') +
      tileHtml(fmtNum(t.coinsInCirculation), 'coins in circulation', '') +
      tileHtml(t.avgKarma == null ? '—' : Number(t.avgKarma).toFixed(1), 'average karma', ''));
    var cap = r.since
      ? 'Ledger since ' + fmtWhen(r.since) + ' — purchases made before then predate the ledger and are not counted here.'
      : 'The ledger is empty — it records purchases from today onward; anything bought earlier predates it.';
    document.getElementById('revcaption').textContent = cap;
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
      svg += '<text x="' + (padL + plotW / 2) + '" y="' + (padT + plotH / 2) + '" text-anchor="middle" class="empty">No revenue in the ledger yet</text>';
    }
    svg += '</svg>';
    document.getElementById('revchart').innerHTML = svg;
  }

  function renderPurchases() {
    var led = (state.data.ledger || []).slice().reverse().slice(0, 200);
    var html = '<tr><th>when</th><th>provider</th><th>pack / reason</th><th>usd</th><th>coins</th><th>buyer</th></tr>';
    led.forEach(function (e) {
      html += '<tr><td>' + fmtWhen(e.at) + '</td>' +
        '<td><span class="pill ' + (e.provider === 'admin' ? 'warn' : 'dim') + '">' + esc(e.provider) + '</span></td>' +
        '<td>' + esc(e.packId || e.note || '—') + '</td>' +
        '<td class="gold">' + (e.usd > 0 ? fmtUsd(e.usd) : '—') + '</td>' +
        '<td>' + fmtNum(e.coins) + '</td>' +
        '<td class="mono">' + esc(e.code || '?') + '</td></tr>';
    });
    if (!led.length) {
      html += '<tr><td colspan="6" class="dim">No entries yet. The ledger records every credit from now on; older purchases predate it and exist only as receipt ids.</td></tr>';
    }
    swap('purchases', html);
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
          return '<tr><td>' + esc(p.name) + (p.isBot ? ' <span class="bot">(bot)</span>' : '') + '</td>' +
            '<td>' + st + '</td>' +
            '<td>' + (p.money == null ? '—' : '$' + fmtNum(p.money)) + '</td>' +
            '<td>' + (p.netWorth == null ? '—' : '$' + fmtNum(p.netWorth)) + '</td></tr>';
        }).join('') || '<tr><td colspan="4" class="dim">Nobody seated</td></tr>';
        html += '<tr class="detail"><td colspan="7"><div class="detail-box">' +
          '<table><tr><th>player</th><th>state</th><th>cash</th><th>net worth</th></tr>' + rows + '</table>' +
          '<button class="danger" data-close="' + esc(r.id) + '">Close this room</button>' +
          '</div></td></tr>';
      }
    });
    if (!rooms.length) html += '<tr><td colspan="7" class="dim">No live rooms</td></tr>';
    swap('roomsT', html);
  }

  function renderGames() {
    var games = state.data.recentGames || [];
    var html = '<tr><th>when</th><th>room</th><th>map</th><th>winner</th><th>players</th><th>turns</th></tr>';
    games.slice(0, 100).forEach(function (g) {
      html += '<tr><td>' + fmtWhen(g.at) + '</td><td class="mono">' + esc(g.roomId) + '</td>' +
        '<td>' + esc(g.map) + '</td><td class="ok">' + esc(g.winner || '—') + '</td>' +
        '<td>' + esc((g.players || []).join(', ')) + '</td><td>' + fmtNum(g.turns) + '</td></tr>';
    });
    if (!games.length) html += '<tr><td colspan="6" class="dim">No finished games yet</td></tr>';
    swap('games', html);

    var days = last30Days();
    var map = {};
    days.forEach(function (d) { map[d] = 0; });
    games.forEach(function (g) { var d = dayStart(g.at); if (map[d] != null) map[d]++; });
    var counts = days.map(function (d) { return map[d]; });
    var max = Math.max.apply(null, counts.concat([1]));
    var W = 320, H = 84, pad = 8;
    var pts = counts.map(function (c, i) {
      var x = pad + i * (W - 2 * pad) / 29;
      var y = H - pad - c * (H - 2 * pad) / max;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var total = counts.reduce(function (a, b) { return a + b; }, 0);
    document.getElementById('sparkline').innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      '<polyline points="' + pts + '" fill="none" stroke="#e3a93c" stroke-width="2" stroke-linejoin="round"/></svg>';
    document.getElementById('sparkcaption').textContent =
      total + ' of the ' + games.length + ' most recent finished games fell in the last 30 days (peak ' + max + '/day).';
  }

  function renderPlayers() {
    var profs = (state.data.profiles || []).slice();
    var q = state.search.trim().toLowerCase();
    if (q) {
      profs = profs.filter(function (p) {
        var hay = (p.code + ' ' + (p.name || '') + ' ' + (p.email || '') + ' ' +
          ((p.login && p.login.provider) || '') + ' ' + (p.status || '')).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    if (state.sort) {
      var k = state.sort;
      profs.sort(function (a, b) { return ((Number(a[k]) || 0) - (Number(b[k]) || 0)) * (state.dir < 0 ? -1 : 1); });
    }
    var arrow = function (k) { return state.sort === k ? (state.dir < 0 ? ' ▾' : ' ▴') : ''; };
    var html = '<tr><th>code</th><th>name</th><th>flag</th>' +
      '<th class="sortable" data-sort="coins" title="Click to sort">coins' + arrow('coins') + '</th>' +
      '<th class="sortable" data-sort="karma" title="Click to sort">karma' + arrow('karma') + '</th>' +
      '<th>friends</th><th>status</th><th>login</th></tr>';
    profs.slice(0, 500).forEach(function (p) {
      var login = p.login
        ? esc(p.login.provider) + (p.email ? ' <span class="dim">' + esc(p.email) + '</span>' : '')
        : '<span class="dim">—</span>';
      html += '<tr><td class="mono">' + esc(p.code) + '</td><td>' + esc(p.name || '—') + '</td>' +
        '<td>' + esc(p.flag || '') + '</td><td class="gold">' + fmtNum(p.coins) + '</td>' +
        '<td>' + fmtNum(p.karma) + '</td><td>' + fmtNum(p.friends) + '</td>' +
        '<td>' + esc(p.status) + (p.roomId ? ' <span class="mono dim">(' + esc(p.roomId) + ')</span>' : '') + '</td>' +
        '<td>' + login + '</td></tr>';
    });
    if (!profs.length) html += '<tr><td colspan="8" class="dim">' + (q ? 'Nobody matches that filter' : 'No profiles yet') + '</td></tr>';
    document.getElementById('playercount').textContent =
      fmtNum(profs.length) + (q ? ' matching' : '') + (profs.length > 500 ? ' (showing 500)' : '');
    swap('playersT', html);
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

    var b = e.karmaBuckets || [];
    var max = Math.max.apply(null, b.concat([1]));
    var W = 300, H = 96, padB = 16, slot = W / 10, bw = slot * 0.7;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
    b.forEach(function (v, i) {
      var x = i * slot + (slot - bw) / 2;
      if (v > 0) {
        var h = Math.max(2, v * (H - padB - 8) / max);
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

  function renderAll() {
    if (!state.data) return;
    renderStatus();
    renderTiles();
    renderRevenue();
    renderPurchases();
    renderRooms();
    renderGames();
    renderPlayers();
    renderEconomy();
  }

  // ------------------------------------------------------------- actions --
  function creditCoins() {
    var code = document.getElementById('c-code').value.trim().toUpperCase();
    var coins = parseInt(document.getElementById('c-coins').value, 10);
    var reason = document.getElementById('c-reason').value.trim();
    var msg = document.getElementById('actionmsg');
    if (!code || !(coins > 0)) {
      msg.textContent = 'Enter a friend code and a positive coin amount.';
      msg.className = 'msg err';
      return;
    }
    if (!confirm('Credit ' + fmtNum(coins) + ' coins to ' + code + '?' + (reason ? ' Reason: ' + reason : ''))) return;
    post('/api/admin/credit', { code: code, coins: coins, reason: reason }, function (r) {
      if (r && r.ok) {
        msg.textContent = 'Credited ' + fmtNum(coins) + ' coins to ' + code +
          (r.name ? ' (' + r.name + ')' : '') + ' — new balance ' + fmtNum(r.coins) + '.';
        msg.className = 'msg ok';
        document.getElementById('c-coins').value = '';
        document.getElementById('c-reason').value = '';
        refresh();
      } else {
        msg.textContent = (r && r.error) || 'Credit failed.';
        msg.className = 'msg err';
      }
    });
  }

  function closeRoom(id, msgEl) {
    if (!id) return;
    if (!confirm('Close room ' + id + '? Its table is torn down and everyone in it is disconnected.')) return;
    post('/api/admin/close-room', { roomId: id }, function (r) {
      if (r && r.ok) {
        if (state.expanded === id) state.expanded = null;
        if (msgEl) { msgEl.textContent = 'Room ' + id + ' closed.'; msgEl.className = 'msg ok'; }
        refresh();
      } else {
        var err = (r && r.error) || 'Could not close the room.';
        if (msgEl) { msgEl.textContent = err; msgEl.className = 'msg err'; }
        else alert(err);
      }
    });
  }

  // -------------------------------------------------------------- wiring --
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var closeBtn = e.target.closest('[data-close]');
    if (closeBtn) { closeRoom(closeBtn.getAttribute('data-close'), null); return; }
    var th = e.target.closest('th.sortable');
    if (th) {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = -1; }
      renderPlayers();
      return;
    }
    var row = e.target.closest('.room-row');
    if (row) {
      var id = row.getAttribute('data-room');
      state.expanded = state.expanded === id ? null : id;
      renderRooms();
    }
  });
  document.getElementById('search').addEventListener('input', function (e) {
    state.search = e.target.value;
    renderPlayers();
  });
  document.getElementById('c-go').addEventListener('click', creditCoins);
  document.getElementById('k-go').addEventListener('click', function () {
    var id = document.getElementById('k-room').value.trim().toLowerCase();
    var msg = document.getElementById('closemsg');
    if (!id) { msg.textContent = 'Enter a room id.'; msg.className = 'msg err'; return; }
    closeRoom(id, msg);
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
    refresh();
    setInterval(refresh, 5000);
  }
})();
</script>
</body>
</html>`;
