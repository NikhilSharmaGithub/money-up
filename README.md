# 🎲 MoneyMove

A real-time multiplayer property-trading board game for the browser — create a room,
share the link, and play with friends or bots. Same genre and flow as richup.io, built
from scratch with an original board, art and codebase.

```bash
npm install
npm start          # → http://localhost:3000
```

Open the link, hit **Create a private game**, copy the room URL and send it to your
friends. Anyone with the link joins instantly — no accounts, no installs.

---

## What's in the game

**Board & movement** — 4 boards (40 to 48 tiles), two dice with doubles, three doubles
sends you to prison, $200 salary for passing START, and a Vacation corner that makes you
miss a turn.

**Property play** — buy streets, airports and utilities; complete a country set to
build houses and hotels; mortgage for half price and lift it back for 10% interest.
Rent scales with the set, the buildings, how many airports the owner holds, and the dice
roll for utilities.

**Auctions** — skip a purchase and the tile goes under the hammer. Live ascending bids
with a countdown that resets on every raise; bots bid too.

**Trading** — offer any mix of cash, properties and get-out-of-prison cards to any
player. Bots evaluate offers and will hunt for the one street they need to finish a set.

**Prison** — roll a double, pay the $50 fine, or spend a card. Three failed attempts and
the fine is forced.

**Cards** — Treasure and Surprise decks with 18 cards each: payouts, fines, teleports,
nearest-airport jumps, per-building repair bills and street collections.

**Going broke** — when you can't pay, the turn stalls in debt: sell buildings, mortgage
streets or trade your way out. Declare bankruptcy and everything transfers to your
creditor. Last player standing wins.

**Rule toggles** — x2 rent on full sets, vacation cash pot, auctions on/off, no rent
while the owner is jailed, mortgage on/off, even build, randomized turn order, starting
cash from $500 to $5000, and up to 8 players.

**Bots** — fill empty seats and play a full strategy: buy, build, bid in auctions,
hunt for the one street they need via trade, and liquidate when cornered.

**Dropped connections** — your seat is held for 30 seconds so a refresh or a flaky
network never costs you a turn. Only after that does a bot step in, and it hands the
seat straight back the moment you return.

**Pass-and-play** — the 👥 button opens a second window with its own identity, so two
people can share one machine. Each seat picks its own name and colour.

## How it feels

Tokens hop tile by tile instead of teleporting, and speed up over long rolls. Dice
tumble. Cash changes float off the player card in green or red. A banner slides in when
the turn passes, the active player's token pulses, and their tile glows gold.

Hovering any street shows its full title deed — every rent step, house cost and mortgage
value — and clicking opens the same deed with the build, sell and mortgage buttons for
properties you own. Those buttons only appear when the move is actually legal, so you
never fire an action just to be told no. Each player card carries colour chips showing
how far along each country set they are, so you can read the table at a glance.

Winning drops confetti. Every sound is synthesised in the browser with the Web Audio
API — dice, cash, rent, gavel, jail door, victory fanfare — so there isn't a single
audio file to download. Toggle it off with the speaker icon.

The whole thing reflows to one column on tablets and phones, and respects
`prefers-reduced-motion`.

## Boards

| Map | Tiles | Flavour |
|---|---|---|
| Classic | 40 | The original world tour — 8 countries |
| Mr. Worldwide | 48 | Bigger board, adds India and Japan, three utilities |
| Death Valley | 40 | Canada, Germany, UK and USA go head to head |
| Bharat | 40 | A tour of India, Jaipur through to New Delhi |
| Blitz | 28 | Short board, two streets per set — games end fast |
| Lucky Wheel | 40 | Half the tiles are chance — pure chaos |
| **Random** | 40 | Generated fresh at the start of every game |

**Random** keeps the classic board *shape* — where the airports, chance tiles and
taxes sit — and shuffles the content: eight countries drawn from a pool of
fourteen, their cities picked at random, fresh airport and utility names. The
price ladder and group sizes stay put, so every generated board is balanced and
playable. A new one is rolled the moment the game starts.

The map picker draws a live miniature of each board from its own tile colours, so
you can see the shape and the spread of colour sets before you commit to one.

## How it fits together

```
server/
  index.js   Express + Socket.IO: rooms, seats, reconnection, event routing
  game.js    The entire rulebook — one authoritative GameRoom per room
  maps.js    Board data; rent tables and layouts are derived from prices
  cards.js   Treasure and Surprise decks
public/
  js/app.js    identity, landing page, socket wiring, render loop
  js/board.js  tile grid, ownership patching, animated token layer, title deeds
  js/ui.js     player cards, settings, action bar, modals, chat, confetti
  js/sound.js  synthesised sound kit (no audio files)
test/
  smoke.js   map integrity + hundreds of bot games + targeted rule assertions
```

The server owns every rule. Clients only send intents (`roll`, `buy`, `bid`, …) and
render the state that comes back, so a tampered client can't cheat. Identity is a token
in `localStorage`, which means refreshing or losing your connection drops you straight
back into your seat — and a bot covers your turns until you're back.

## Deploying

**This will not run on Vercel, Netlify, or any serverless host.** Those platforms
answer each request with a short-lived function, and MoneyMove needs the opposite:
one process that stays alive to hold WebSocket connections open and keep every
room's state in memory. Deploy it there and the landing page loads while every
button quietly does nothing, because `/socket.io/` has nobody listening.

Use anything that runs a normal Node process:

| Host | How |
|---|---|
| **Render** | New → Web Service → point at this repo. `render.yaml` configures it. |
| **Railway** | New Project → Deploy from repo. `Procfile` is picked up automatically. |
| **Fly.io** | `fly launch` — it uses the `Dockerfile`. |
| **Any VPS** | `npm ci && npm start`, behind nginx with WebSocket upgrade headers proxied. |

The server reads `PORT` from the environment, so nothing else needs configuring.
If you put it behind a reverse proxy, make sure the proxy forwards `Upgrade` and
`Connection` headers, otherwise the socket silently falls back and then fails.

## Testing

```bash
npm test
```

Plays hundreds of bot-only games across every map and rule combination, asserting after
every action that nobody holds negative cash, no building sits on an incomplete set, no
mortgaged street carries houses, and even-build is never violated. Then it checks
specific rules directly: full-set rent doubling, airport rent scaling, the even-build
restriction, three-doubles-to-prison, the prison fine, START salary, trade execution and
bankruptcy handover.

## Notes

Board layouts are data. Add a map by dropping a tile list into `RAW_MAPS` in
`server/maps.js` — rent tables, house costs, colour groups and the client's grid layout
are all derived automatically. Sides can be any length as long as there are four corners.

This is an original implementation of a classic public-domain game genre. It is not
affiliated with, endorsed by or derived from the assets of any trademark holder.
