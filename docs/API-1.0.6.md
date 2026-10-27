# MoneyMove 1.0.6 — server API for the new features

The exact shapes the 1.0.6 server sends and accepts. Clients code against this file; where it
differs from the feature spec, this file wins.

This part covers **F1 Levels & XP, F2 Daily missions, F5 Weekly & friends leaderboards,
F6 Career stats, F8 Prefs & the daily reminder**. **F3 Bot skill, F7 Watch live and F9 Timed
games** are in the second part, at the end of this file (after "Ledger providers").

General rules that hold for everything below:

- `token` is always the caller's own identity token. It is never sent to, or shown about, anyone
  else. Every other player is addressed by their public 6-character friend `code`.
- Every `GET` is read-only and never creates a profile for an unknown token. A `POST` that acts
  (claim, prefs) may.
- Every new field is additive. Old clients that ignore them keep working; `GET /api/leaderboard`
  with no parameters still answers with `top` where it always was.
- Coins paid by missions and level-ups go into the same wallet and ledger as everything else, raise
  `earned` (the only-ever-rises watermark the coin counter animates from), and are **not** part of
  the 40-a-day table-coin cap.

---------------------------------------------------------------------------------------------------

## Which games count

XP, mission progress and career numbers are added **once per finished game per person**, at the
moment the game ends (XP up to a daily ceiling, see F1), and only for games that pass the existing
anti-farm rule: the table must have played at least `2 × seats` turns (the same rule the win purse
uses). A game that ends sooner moves nothing.

Who gets them: every human seat at the table when it ends — winners, losers, players who went
bankrupt and players who walked out (their numbers are still the room's). Not house players, and not
pass & play guest seats (`<token>_p2` …): a guest has no level.

---------------------------------------------------------------------------------------------------

## F1 — Levels & XP

### The curve

Level `L` starts at total XP `50 · L · (L − 1)`:

| Level | 1 | 2   | 3   | 4   | 5    | 6    | 7    | 8    | 9    | 10   |
|-------|---|-----|-----|-----|------|------|------|------|------|------|
| XP    | 0 | 100 | 300 | 600 | 1000 | 1500 | 2100 | 2800 | 3600 | 4500 |

Everywhere a level is shown in full the server sends four numbers:

```json
{ "xp": 142, "level": 2, "levelFloor": 100, "levelNext": 300 }
```

- `levelFloor` = XP at which the current level started, `levelNext` = XP at which the next starts.
- Progress bar fraction = `(xp − levelFloor) / (levelNext − levelFloor)`.

### What earns XP

Per counted game, per person:

| Part        | XP                                              |
|-------------|-------------------------------------------------|
| played      | +20                                             |
| win         | +30 (every human on the winning side of a team game; a bankrupt teammate does not count as a winner) |
| runner-up   | +15 (the best-placed human who did not win — the same person the 1-coin runner-up purse goes to) |
| turns       | +1 per 2 of the seat's **own** turns, at most +20 |

A claimed daily mission is worth +10 XP (F2). Nothing else pays XP.

**Daily ceiling.** Games pay a person at most **600 XP per day** in all (the server's calendar day:
the same day key and midnight as the daily reward and the missions). The game that crosses 600
pays only the part that fits; every game after it that day pays 0 XP. Mission progress and the
career still count those games. Mission XP (+10 per claim) is not part of the 600 and is still
paid after it. The ceiling resets at the server's midnight.

Profiles that existed before 1.0.6 were credited once, at server start, with 20 XP per game and
30 XP per win already on file; no level-up coins were paid for that credit.

### Level-up coins

Every level reached pays **5 coins**, once per level for the life of the profile (ledger provider
`level`, txn `level:<code>:<level>`). Crossing two levels at once pays 10. Because game XP has a daily
ceiling, so do the level-ups it can buy.

### The `progress` socket event (new)

Sent at game end to **each person's own sockets** in that room, right after the final `state`
(so the results screen is already up). Only for counted games. Never sent about anyone else.

```json
{
  "roomId": "vxhoc",
  "xpGained": 52,
  "xpParts": { "played": 20, "win": 30, "runnerUp": 0, "turns": 2 },
  "xpCapped": false,
  "xp": 142,
  "level": 2,
  "levelFloor": 100,
  "levelNext": 300,
  "levelUp": { "from": 1, "to": 2, "coins": 5 },
  "missionsCompleted": ["winGame"]
}
```

- `xpGained` is the XP actually added. `xpParts` is what the game was worth before the daily
  ceiling, part by part. `xpCapped` is `false` when `xpGained` is the sum of `xpParts`, and `true`
  when the ceiling cut it (then `xpGained` is less, and `0` once the day's 600 are used up): show
  something like "Daily XP limit reached". The event is sent either way.
- `levelUp` is `null` when no level was crossed. When present, show the "Level 2!" (+5 coins)
  celebration. `coins` is what was actually paid (5 per level).
- `missionsCompleted` lists the mission kinds (F2) this game pushed over their target — good moment
  to refresh the missions card. It may be empty.

Fallback for a client that was not connected when the game ended: `GET /api/me` carries
`lastLevelUp` (below). Remember the `at` you last celebrated and celebrate a newer one once.

### `level` on room state seats

Every row of `state.players` (full states and patches alike) now has:

```json
{ "id": "…", "name": "Asha", "code": "G4S69R", "level": 2, … }
```

- A person: their level (≥ 1).
- A house player (bot): a stable level from 3 to 40, derived from its seat `code` (`H0xxxx`). The
  same number its profile card shows.
- A pass & play guest: `0` — show no chip.
- An old server never sends the field: treat absent as "no chip".

The level updates in the `ended` state already (the final state is built after XP is added).

### Room `stats` additions

The end-of-game `state.stats[playerId]` object gains two counters (other keys unchanged):

```json
{ "turns": 5, "setsCompleted": 1, "doubles": 0, "streetsBought": 2, … }
```

- `turns` — this seat's own turns this game.
- `setsCompleted` — colour sets this seat completed (each set counted once per player per game).

---------------------------------------------------------------------------------------------------

## F2 — Daily missions

Three missions per player per day, dealt deterministically from the player's friend code and the
server's calendar day (the same day key and midnight the daily reward uses). Never two of a kind.

| `kind`          | `target` | `title`                  | counted from (per counted game)       |
|-----------------|----------|--------------------------|---------------------------------------|
| `playGames`     | 2        | Play 2 games             | +1 per game                           |
| `winGame`       | 1        | Win a game               | +1 if on the winning side             |
| `buyStreets`    | 6        | Buy 6 streets            | `stats.streetsBought`                 |
| `buildHouses`   | 4        | Build 4 houses           | `stats.housesBuilt`                   |
| `collectRent`   | 1500     | Collect $1,500 in rent   | `stats.rentCollected`                 |
| `completeSet`   | 1        | Complete a colour set    | `stats.setsCompleted`                 |
| `winAuction`    | 1        | Win an auction           | `stats.auctionsWon`                   |
| `completeTrade` | 1        | Complete a trade         | `stats.tradesCompleted`               |
| `rollDoubles`   | 3        | Roll 3 doubles           | `stats.doubles`                       |
| `lapsBoard`     | 3        | Lap the board 3 times    | `stats.laps`                          |

Rewards: each mission **3 coins + 10 XP** when claimed; all three done → **bonus 5 coins**
(no XP). **Changed in Round 2 (G10, end of this file): each mission is 0 coins + 10 XP, and the
bonus is 3 coins.** The shapes below are unchanged; only the numbers in them moved. Progress is tracked for everybody (signed in or not); **claiming needs a signed-in
account** (Google / Apple), the same rule as the daily reward. Progress resets at the server's
midnight (`resetsAt`); unclaimed rewards from yesterday are gone.

A mission's `id` is its `kind` (unique within a day). The bonus is claimed with `id: "bonus"`.

### `GET /api/missions?token=<token>`

`400 { "error": "Missing identity" }` without a token. Otherwise `200`:

```json
{
  "day": "2026-10-13",
  "resetsAt": 1791961200000,
  "signedIn": true,
  "missions": [
    { "id": "playGames", "kind": "playGames", "title": "Play 2 games", "target": 2, "progress": 1,
      "coins": 3, "xp": 10, "done": false, "claimed": false },
    { "id": "winGame", "kind": "winGame", "title": "Win a game", "target": 1, "progress": 1,
      "coins": 3, "xp": 10, "done": true, "claimed": false },
    { "id": "winAuction", "kind": "winAuction", "title": "Win an auction", "target": 1, "progress": 0,
      "coins": 3, "xp": 10, "done": false, "claimed": false }
  ],
  "bonus": { "coins": 5, "ready": false, "claimed": false }
}
```

- `progress` never exceeds `target`. `done` = `progress >= target`.
- `bonus.ready` = all three `done` and the bonus not yet claimed (claiming the three individually
  is not required first).
- `signedIn: false` → show progress and a "Sign in to claim" affordance instead of Claim buttons.
- An unknown token gets the three missions its code will be dealt, at 0 progress.
- Refresh after each game ends (or on the `progress` event) and when returning home.

### `POST /api/missions/claim`

Body: `{ "token": "<token>", "id": "winGame" }` (or `"id": "bonus"`).

`200` on success — and also on a repeat claim (idempotent; nothing is paid twice):

```json
{
  "ok": true,
  "id": "winGame",
  "awarded": { "coins": 3, "xp": 10 },
  "coins": 110,
  "earned": 10,
  "xp": 152,
  "level": 2,
  "levelFloor": 100,
  "levelNext": 300,
  "levelUp": null,
  "missions": { "...": "the full GET /api/missions body, already updated" }
}
```

- `coins` is the **wallet balance** after the claim (not the amount); `awarded` is what this claim
  paid. `earned` is the wallet's watermark (same as `/api/wallet`).
- `levelUp` is `{ from, to, coins }` if the mission's 10 XP crossed a level (its coins are already
  in `coins`), else `null`.
- A repeat claim (retry, second tab, already claimed) answers the same shape with
  `"duplicate": true` and `"awarded": { "coins": 0, "xp": 0 }`. Treat it as success, play no coin
  animation.
- Bonus success: `"awarded": { "coins": 5, "xp": 0 }`.

Errors:

| Status | Body                                                                          | When |
|--------|-------------------------------------------------------------------------------|------|
| 401    | `{ "error": "Sign in to claim mission rewards", "needsLogin": true }`          | not signed in (or unknown token) |
| 400    | `{ "error": "That mission is not finished yet" }`                              | `progress < target` |
| 400    | `{ "error": "Finish all three missions first" }`                               | bonus before all three are done |
| 400    | `{ "error": "That mission is not one of today's", "missions": { …GET body… } }` | stale card across midnight / unknown id — redraw from `missions` |

---------------------------------------------------------------------------------------------------

## F5 — Leaderboards: all time, this week, friends

### `GET /api/leaderboard?scope=all|week|friends&token=<token>`

Both parameters optional. `scope` defaults to `all`; an unknown scope is `all`. The token only marks
the caller's row and fills `you`.

```json
{
  "scope": "week",
  "week": "2026-W42",
  "resetsAt": 1792368000000,
  "top": [
    { "code": "G4S69R", "name": "Asha", "flag": "🇮🇳", "level": 2, "wins": 1, "winnings": 2, "you": true }
  ],
  "you": { "rank": 1, "wins": 1 }
}
```

- `top`: at most 50 rows, most wins first; ties → more `winnings`, then name, then code.
  Row fields: `code, name, flag, level, wins, winnings`, plus `"you": true` on the caller's own row
  only (absent otherwise).
- `you`: `null` without a (known) token. Otherwise `{ rank, wins }` where `rank` is the caller's
  1-based place in the **whole** ordering (they may be below the top 50) or `null` if they are not
  on this board, and `wins` is their win count **for this scope**.
- `week` and `resetsAt` are present **only** for `scope=week`.

Scopes:

| scope     | who is on it                                                       | `wins` / `winnings` mean |
|-----------|--------------------------------------------------------------------|--------------------------|
| `all`     | everyone with at least one win (house players never)              | lifetime                 |
| `week`    | everyone with at least one win since Monday 00:00 UTC             | this ISO week only       |
| `friends` | the caller and their friends, **including friends with 0 wins**   | lifetime                 |

- The week is the ISO week (`"YYYY-Www"`), starting Monday 00:00 **UTC**; `resetsAt` is the next
  Monday 00:00 UTC in ms ("Resets Monday").
- `scope=friends` without a token → `{ "scope": "friends", "top": [], "you": null }`.
- A runner-up coin is never a win on any board.
- Tapping a row opens the profile: `GET /api/player?code=<row.code>&token=<own token>` (F6).

---------------------------------------------------------------------------------------------------

## F6 — Career stats

### `GET /api/player?code=<code>&token=<own token>` — additions

The existing card gains `level` and `career`. Nothing else changed; nothing private is added.

```json
{
  "code": "G4S69R", "name": "Asha", "flag": "🇮🇳", "avatar": "😎",
  "wins": 7, "games": 13, "winnings": 15,
  "titles": [{ "title": "Dealmaker", "count": 5 }],
  "since": 1786000000000,
  "relation": "friend",
  "level": 4,
  "career": {
    "streetsBought": 52,
    "housesBuilt": 18,
    "rentCollected": 23450,
    "biggestRent": 1800,
    "auctionsWon": 6,
    "tradesCompleted": 9,
    "doubles": 31,
    "favoriteBoard": { "id": "classic", "name": "Classic", "games": 8 }
  }
}
```

- Career counters are lifetime totals of counted games from 1.0.6 on (older games were not
  recorded, so a veteran's career starts at 0 while their `wins`/`games` do not). `biggestRent` is
  the single largest rent ever collected (a record, not a sum).
- `favoriteBoard` is the board played most (`id`, display `name`, `games` on it) or `null`.
  `id` is a board id from `/api/maps` (or `"random"`, name `"Random"`).
- House players (`H0xxxx` codes) answer in the same shape: `level` = the level they wore at the
  table, `career` = stable made-up numbers scaled to their (made-up) `games`.
- Labels for the grid: Streets bought, Houses built, Rent collected, Biggest rent, Auctions won,
  Trades, Favourite board. (`doubles` is there too if a client wants it.)

### `GET /api/me?token=<token>` — additions

```json
{
  "code": "G4S69R", "name": "Asha", "flag": "", "coins": 107, "karma": 100,
  "provider": "google", "email": "…", "picture": "", "appleRevocable": false,

  "xp": 142, "level": 2, "levelFloor": 100, "levelNext": 300,
  "career": { "streetsBought": 2, "housesBuilt": 0, "rentCollected": 0, "biggestRent": 0,
              "auctionsWon": 0, "tradesCompleted": 0, "doubles": 0,
              "favoriteBoard": { "id": "classic", "name": "Classic", "games": 1 } },
  "prefs": { "dailyReminder": true, "inviteAlerts": true },
  "lastLevelUp": { "from": 1, "to": 2, "coins": 5, "at": 1791877551072 }
}
```

- `career` is exactly what others see on this player's card.
- `lastLevelUp` is the most recent level-up (from a game or a mission claim) or `null`.
- An unknown token gets `xp 0, level 1, levelFloor 0, levelNext 100`, an all-zero career with
  `favoriteBoard: null`, both prefs `true`, `lastLevelUp: null` (and, as before, `code: ""`).

---------------------------------------------------------------------------------------------------

## F8 — Prefs and the daily reminder (iOS + Android)

### `GET /api/prefs?token=<token>`

```json
{ "dailyReminder": true, "inviteAlerts": true }
```

Both default to `true` (also for unknown tokens; reading does not create a profile).

### `POST /api/prefs`

Body: `{ "token": "<token>", "dailyReminder": false }` — send either field or both; a field left
out keeps its value. Values must be booleans (`"true"`/`"false"` and `1`/`0` are also accepted).

`200`:

```json
{ "ok": true, "dailyReminder": false, "inviteAlerts": true }
```

`400 { "error": "dailyReminder must be true or false" }` for anything else (nothing in that
request is applied); `400 { "error": "Missing identity" }` without a token.

### Invite pushes

`POST /api/invite` is unchanged for the inviter. If the invited friend has `inviteAlerts: false`,
no push is sent to their phones; the invite itself is still stored and shows as the in-app banner
(`GET /api/invite`). The inviter is not told.

### The daily reminder push

The server checks every 10 minutes and sends **at most one reminder per day, never two within
20 hours**, to a profile that:

- is signed in (Google/Apple), has `dailyReminder` on, has a registered push device, is not banned,
  and has opened the app within the last 7 days;
- has not claimed today's daily reward (it is claimable);
- is 20–24 hours (mod 24 h) past their last daily claim — i.e. about the time of day they usually
  claim. With no claim on file: past their last reminder, or failing that their last visit.

The push:

| | |
|---|---|
| title | `MoneyMove` |
| body | `Your daily coins are ready — keep your streak going` |
| collapse id | `daily` (APNs `apns-collapse-id`, FCM `collapse_key` and notification `tag`) |
| iOS payload | `{ "aps": { "alert": { "title": "MoneyMove", "body": "…" }, "sound": "default", "interruption-level": "active" }, "kind": "daily" }` |
| Android `data` | `{ "kind": "daily", "collapseId": "daily" }` |
| Android channel | `social` (the existing channel; no new channel needed) |

A tapped `kind: "daily"` push should open the app on the home screen (where the daily reward card
is). Web does not register for push and gets no reminder.

---------------------------------------------------------------------------------------------------

## Ledger providers (admin)

Two new zero-dollar providers: `mission` (`packId` = the mission kind or `bonus`, txn
`mission:<day>:<code>:<id>`) and `level` (txn `level:<code>:<level>`). The admin "Coin flows"
panel now shows a separate **minted by rewards** bar (daily, ads, missions, level-ups), which
were previously counted under purchases.

===================================================================================================

# Part two — the tables: F3 bot skill, F7 watch live, F9 timed games

Everything here rides the existing socket protocol: the lobby's `settings` event, `join`, `toast`,
`joinFailed`, `you`, `state` / `statePatch`. One new HTTP route (`GET /api/live`). Every new state
field is additive and present on full states and patches alike; an old server never sends them —
treat absent as the default given below.

---------------------------------------------------------------------------------------------------

## Two new lobby settings

Both live in `state.settings` with the others, are changed by the host in the lobby with the
existing socket event, and are validated like the others: a patch with one bad value is refused
**whole** (nothing in it applied) and the host gets a `toast` `{ type: "error", message }`.

```js
socket.emit('settings', { botLevel: 'hard', timeLimit: 30 });
```

| key         | type   | values                         | default    |
|-------------|--------|--------------------------------|------------|
| `botLevel`  | string | `"easy"` `"normal"` `"hard"`   | `"normal"` |
| `timeLimit` | number | `0` `20` `30` `45` `60` (minutes; `0` = no limit) | `0` |

- `timeLimit` sent as text (`"30"`) is accepted and stored as the number `30`; `null` is `0`.
  Anything else (25, -1, true, an array…) is refused.
- Only the host, only in the lobby (a guest's patch is ignored silently, as before).

Refusals (exact `toast` messages):

| When                                   | message |
|----------------------------------------|---------|
| `botLevel` not one of the three        | `Bot skill is easy, normal or hard` |
| `timeLimit` not one of the five        | `Game length is 20, 30, 45 or 60 minutes, or no limit` |
| at a Play-now table (`state.quick`)    | `A Play-now table keeps its seats, privacy, house players, teams and clock` (unchanged — any key outside the rolled rules and the board) |
| at a cup table (`state.cup`)           | `A cup table is set by the cup` (unchanged — every setting) |

**Clients:** show "Bot skill" (Easy / Normal / Hard) and "Game length" (Unlimited / 20 / 30 / 45 /
60 min) to the host; everyone else sees the values in the settings summary. Hide both when
`state.quick` or `state.cup` is true. Play-now tables always play `normal` with no clock, whatever
the field says.

---------------------------------------------------------------------------------------------------

## F3 — Bot skill

`settings.botLevel` binds the **house players the host added** (`isBot: true` seats at a private
or public table). It never touches:

- a person's seat the house is covering (`botControlled`) — that always plays normal;
- a Play-now table's house players — always normal;
- a cup table — it has no house players.

What changes (normal is exactly the bot that shipped in 1.0.5):

| | easy | normal | hard |
|---|---|---|---|
| Buying | only with a cushion (≥ $400 and ≥ 2× its usual floor left after paying), ignores colour races, and passes on about 1 street in 3 it could afford | as before | buys almost anything it can pay for, keeping half the usual floor |
| Building | at most 1 house per turn, only from spare cash | as before | races full colours to 3 houses on almost nothing |
| Auctions | bids at most half the sticker price | as before | bids up to the sticker, never past it (ordinary street: each bot stops somewhere from $5 under the sticker to the sticker), or 1.1× its own valuation (colour race) |
| Trades | never starts one (still answers offers, and still answers a chat "trade?" request) | as before | offers twice as often (every 2 turns, same player every 5) |

All of it is deterministic for a given game: the easy bot's "now and then" is a hash of the seat,
the street and the turn, not a random draw. Measured over 60 seeded games of one autopiloted seat
against 3 house players, that seat won 54 against easy, 15 against normal, 13 against hard.

No new state fields: read the setting from `state.settings.botLevel`.

---------------------------------------------------------------------------------------------------

## F9 — Timed games

### New top-level state fields

```json
{
  "status": "playing",
  "endsAt": 1791882600000,
  "timeUp": false,
  "endReason": null,
  "startedAt": 1791880800000,
  "turnCount": 37,
  "turn": { "endsAt": 1791880890000, "...": "the per-turn shot clock, unchanged" }
}
```

| field       | type          | meaning |
|-------------|---------------|---------|
| `endsAt`    | ms \| null    | When the game clock runs out. `null` = no clock (untimed table, lobby, Play-now, cup). **Not** `turn.endsAt`, which is still the per-turn shot clock, and not `auction.endsAt`. |
| `timeUp`    | bool          | `true` from the moment the clock ran out: the turn on the board is the last one ("Last turn" is a fair label). Stays `true` in the ended state of a timed game. |
| `endReason` | string \| null | Only once `status` is `"ended"`: `"time"` = decided on the clock (a timed game, or a cup game decided at its whistle); `"last"` = everyone else went out. `null` before the end. |
| `startedAt` | ms \| null    | When this game's dice started. `null` in the lobby. |
| `turnCount` | int           | Turns played so far (the same number `GET /api/live` shows). |

Countdown chip: `mm:ss` of `endsAt − now` while `status === "playing"` and `endsAt` is set; warm/red
under 2:00; at 0:00 (or when `timeUp` is true) show "Last turn". The server is the clock — the game
ends when the server says so, whatever the chip reads.

### How a timed game ends

1. At start the log says: `A 30-minute game — when the clock runs out, the richest player wins`.
2. When `endsAt` passes:
   - if nobody is mid-turn (the player to move has not rolled, nothing owed, no auction) the game
     ends **at once**;
   - otherwise `timeUp` becomes `true`, the log says `Time's up — this is the last turn`, and the
     turn in progress plays out — **a double no longer earns another roll** — and the game ends the
     moment that turn ends (End turn, the shot clock, or the house covering an absent seat). If the
     turn has not ended 90 seconds after `endsAt` the game ends anyway (an auction still under the
     hammer is allowed to close first).
3. The winner is the **richest player still in** by net worth — cash, plus each deed's price (half
   if mortgaged), plus houses at cost; the same `netWorth` every seat row carries. A debt open at
   that moment counts against its debtor (and is then written off). Equal fortunes: seat order.
   - **Teams:** the team whose standing members are worth the most **together** wins; a level tie
     goes to the team of the single richest player. `winner` is that team's richest member;
     `winningTeam` is the team index.
4. Log lines, in order: `Time's up — richest player wins`, then the usual
   `🏆 Asha wins the game!` or `🏆 Team Azure wins the game! (Asha & Bilal)`.
5. Everything after is the ordinary end of a game, run once: `status: "ended"`, `winner`,
   `winningTeam`, `stats`, `titles`, `history`; the win and runner-up purses, the leaderboard, XP
   (the `progress` event), mission progress and the career card — under the same anti-farm rule.
   Nobody is knocked out to end it: every losing seat keeps `bankrupt: false` and everything it
   owned, so the standings read as the board did at the whistle.

Game-over screen: when `endReason === "time"`, say "Time's up" (and that the richest player won).

`Play again` (rematch) clears `endsAt`, `timeUp` and `endReason`; the next start arms a fresh clock
from `settings.timeLimit`.

---------------------------------------------------------------------------------------------------

## F7 — Watch live games

### `GET /api/live`

No parameters, no token. `200`:

```json
{
  "games": [
    {
      "roomId": "xtex8",
      "mapId": "classic",
      "mapName": "Classic",
      "players": [
        { "name": "Asha", "flag": "🇮🇳", "color": "#4ade80", "avatar": "😎", "level": 4, "bot": false, "out": false },
        { "name": "Ravi", "flag": "", "color": "#60a5fa", "avatar": "", "level": 12, "bot": true, "out": false }
      ],
      "turnCount": 37,
      "startedAt": 1791880800000,
      "endsAt": null,
      "watching": 2
    }
  ]
}
```

- Listed: tables with `status: "playing"`, **public** (`settings.isPrivate === false` — this
  includes Play-now tables), not cup tables, with at least one person still connected (in the
  game or knocked out and watching). At most **20**, most connected people first, then the most
  recently started.
- `players` is every seat in turn order: `name`, `flag` (may be ""), `color`, `avatar` (equipped
  emoji, may be ""), `level` (same as the seat's `level` in the state; 0 for a pass & play guest),
  `bot`, `out` (bankrupt / removed). At a Play-now table `bot` is **always false** — the house
  players pass as people there, exactly as the table's own state says.
- `endsAt` is the game clock (F9) or `null`. `watching` = the table's `spectators` count.
- Nothing else: no tokens, no seat ids, no friend codes. `roomId` is the code to watch with.
- Empty list → "No public games right now".

### Watching: `join` with `spectate: true`

```js
socket.emit('join', { roomId: 'xtex8', token, name, flag, proto: 2, spectate: true });
```

- Seats nobody, claims nothing, says nothing in the log, and sends **no `joinFailed`**. The
  socket gets `you` → `{ "playerId": "<own token>", "roomId": "xtex8", "spectator": true }`, then
  a full `state` (patches after that, for `proto: 2`), like any other socket.
- Every id in a watcher's state is an alias — including the watcher's own, if that identity also
  has a seat at the table on another device. So no row ever matches the client's own id: render the
  existing read-only spectator view, with no actions.
- Every action event from a watching socket (`roll`, `buy`, `endTurn`, `chat`, `trade:*`,
  `settings`, `start`, `rematch`, `quit`, `bankrupt` …) is refused with
  `toast` `{ type: "error", message: "You are watching this game" }` and changes nothing.
  `resync` still works.
- A table that is not there (finished and closed, or a mistyped code):
  `joinFailed` `{ "message": "That game has finished", "spectate": false }` — and no room is
  opened under that code.
- Banned identities get the existing `joinFailed` (`You are banned from MoneyMove`).
- A watching socket **never** becomes a player by accident. To play, the client sends an ordinary
  `join` without `spectate`; the socket leaves the rail first and goes through the normal door
  (which, mid-game, still answers `joinFailed` with `spectate: true` as before).
- Leave by closing the socket or joining another room. A watcher leaving never affects any seat —
  even one with the same token.

### `state.spectators`

```json
{ "spectators": 2 }
```

On every state (full and patch), for everyone at the table: how many **people** are watching
without a seat — watchers who joined with `spectate: true` plus anyone the old path turned into a
spectator (a full table, a game already under way). Distinct identities, not sockets; a seated
player (in the game or knocked out) is never counted. `0` when nobody is watching.

===================================================================================================

# Round 2 — G1 prison, G2 daily cycle, G5 bankrupt estates, G6 auction-only, G7 shuffled board, G8 public trades, G10 missions

Same rules as the two parts above: every new field is additive and rides full states and patches
alike; an old server never sends it — treat absent as the default given here. Where this part
differs from the round-2 spec, this part wins. G3, G4 and G9 are client-only and add no server
shapes (G4 reads everything it lists from `state.settings`, including the three keys below).

---------------------------------------------------------------------------------------------------

## Three more lobby settings

In `state.settings` with the others, changed by the host in the lobby with the existing socket
event, validated the same way: a patch with one bad value is refused **whole** and the host gets a
`toast` `{ type: "error", message }`. A guest's patch is still ignored silently.

```js
socket.emit('settings', { bankruptProperties: 'auction', auctionOnly: true, shuffleBoard: true });
```

| key                  | type    | values                     | default     |
|----------------------|---------|----------------------------|-------------|
| `bankruptProperties` | string  | `"release"` `"auction"`    | `"release"` |
| `auctionOnly`        | boolean | `true` `false`             | `false`     |
| `shuffleBoard`       | boolean | `true` `false`             | `false`     |

- `bankruptProperties` is a list, like `botLevel`: anything else (`null`, `1`, `true`, an array…)
  is refused.
- `auctionOnly` and `shuffleBoard` are switches like every other switch: whatever arrives is
  stored as `true`/`false` (never refused).
- **`auctionOnly` forces `auction` on.** A patch that turns `auctionOnly` on sets `auction: true`
  as well (even if the same patch says `auction: false`). A patch that turns `auction` off (and
  does not turn `auctionOnly` on) turns `auctionOnly` off too. The two never contradict each
  other in `state.settings`, so a client can render both toggles straight from it.

Refusals (exact `toast` messages):

| When                                         | message |
|----------------------------------------------|---------|
| `bankruptProperties` not one of the two      | `Bankrupt properties go back to the bank or to auction` |
| any of the three at a Play-now table         | `A Play-now table keeps its seats, privacy, house players, teams and clock` (the existing message) |
| any of the three at a cup table              | `A cup table is set by the cup` (the existing message) |

A Play-now table and a cup table always play the defaults (`release`, no auction-only, the
printed board) whatever the fields say. **Clients:** show the three to the host in the lobby; hide
them when `state.quick` or `state.cup` is true.

> **Later rounds change the Play-now half of this.** From 1.0.7 a Play-now table rolls
> `bankruptProperties` and its host may change it (Round 3, H3); from 1.0.8 the same goes for
> `shuffleBoard` (Round 4). Only `auctionOnly` is still refused at a Play-now table. Cup tables
> are unchanged: all three refused, all three played at the default.

Labels the "This table's rules" sheet (G4) can use: Bankrupt properties — "Back to the bank" /
"Auctioned"; Auction-only — on/off; Shuffled board — on/off.

---------------------------------------------------------------------------------------------------

## G1 — Prison: the third failed roll walks out free

Server rule (no new fields):

1. A turn in prison, before rolling: **Pay $50** (`jailPay`) opens the door and **ends the
   turn** (no roll) — unchanged. A get-out card (`jailCard`) frees the player, who then rolls —
   unchanged.
2. Rolling a double walks out and moves by that roll, with no extra roll — unchanged.
3. A miss on the first or second try: still in prison, turn over. `jailTurns` counts the misses
   (`1`, then `2`). Log: `Asha rolled 1+2 — still in prison (1/3)`.
4. **A miss on the third try: the player walks out free — no $50, no debt, whatever their cash —
   and moves by that roll as usual** (buy offer, rent, card, auction…). No extra roll (it was not
   a double). Log: `Asha rolled 2+3 — third try, so they walk out of prison free`, kind
   `dice` — it is the throw, like the double-escape line (`… rolled a double (3+3) and walked out
   of prison`, also `dice`): play the dice sound and show it as the dice land, not the
   prison-door sound.

`turn.debt.jailRelease` is never sent any more (it only existed for the old fine).

**How to play text** (every client; the web /how-to-play page already says this):

> Land on Go to Prison, draw the card, or roll three doubles in a row, and you are locked up. On
> each turn inside you can roll for a double, which walks you out and moves you by that roll. You
> can also pay the $50 fine before rolling, which opens the door but ends that turn, or use a
> get-out card. If your third roll still is not a double, you walk out for free and move by that
> roll anyway.

---------------------------------------------------------------------------------------------------

## G2 — Daily reward: cycles of 1 → 7 → 1

The amount climbs 1, 2, … 7 coins over a streak, and the day after a 7-coin day pays **1** again
(a new cycle), for as long as the streak lasts. A missed day also starts again at 1. A streak
from before this change that had been sitting on 7-coin days starts its next cycle at 1.

### `GET /api/daily?token=<token>` — additions

```json
{
  "signedIn": true, "claimable": true, "streak": 9, "amount": 3, "nextAt": null,
  "cycleDay": 3, "cycleLength": 7, "claimedToday": false
}
```

| field          | meaning |
|----------------|---------|
| `cycleDay`     | 1–7: the step of the current 7-day cycle the card is about. **Before** today's claim (`claimedToday: false`): the step today's claim pays — always equal to `amount`. **After** it (`claimedToday: true`): the step that was claimed today; `amount` is then tomorrow's, which is `cycleDay % 7 + 1`. |
| `cycleLength`  | Always `7`. |
| `claimedToday` | `true` once today's coin has been collected (the same moment `nextAt` becomes a number and `claimable` false). |

- `streak` still counts the whole run of days (it can be 9, 16, 40…); draw the bar from `cycleDay`,
  never from `streak`.
- The bar: steps `1…7` labelled `1…7` coins. Steps `< cycleDay` are collected. Step `cycleDay` is
  "today" when `claimedToday` is false, collected when it is true.
- No streak / broken streak / unknown token: `cycleDay: 1`, `amount: 1`, `streak: 0`.

### `POST /api/daily/claim` — additions

`200` gains `cycleDay` (the step just paid; equal to `amount`):

```json
{ "ok": true, "amount": 1, "coins": 51, "earned": 1, "streak": 8, "nextAt": 1791961200000, "cycleDay": 1 }
```

`409 { "error": "Already claimed today", "claimed": true, "streak": 8, "nextAt": …, "cycleDay": 1 }`
(the step claimed today). `401` is unchanged.

---------------------------------------------------------------------------------------------------

## G5 — Bankrupt properties: release or auction

`settings.bankruptProperties`:

- `"release"` (default) — exactly today's rule: the player's properties go back to the bank,
  unowned, buildings gone and mortgages lifted.
- `"auction"` — the same estate (buildings gone back to the bank, mortgages lifted) is sold to the
  remaining players **one property at a time, in board order**, through the ordinary auction
  (starting bid $10, the usual 20 s / +12 s per bid, escrowed bids, house players bid as usual).
  A lot nobody bids on stays with the bank. The game continues normally after the last lot.

It applies to **every** way a player's properties go back to the bank: bankrupt to the bank
(taxes, cards, bank debts), conceding (`bankrupt`), walking out (`quit`), and being removed for
timeouts. **Bankrupt to another player:** in this game the creditor has always kept only the
cash that was paid (the properties never went to the creditor — they go back to the bank), and
that is unchanged; so at an `"auction"` table those properties are auctioned too.

Not sold (released instead): once a timed game's clock has run out (`timeUp`), and when the
bankruptcy ends the game (one player or team left).

### What clients see

The running lot is the ordinary `state.auction`, with one new field, `estate`:

```json
{
  "auction": {
    "tile": 6, "bid": 0, "leader": null, "inRace": ["u_…", "u_…"], "endsAt": 1791891901400,
    "estate": { "from": "Ravi", "left": 2 }
  }
}
```

| `auction.estate` | meaning |
|------------------|---------|
| `null`           | An ordinary auction (a declined deed, or an auction-only landing). Old servers never send the field — treat absent as `null`. |
| `{ from, left }` | A lot from a bankrupt player's estate. `from` is that player's **name** (not an id). `left` is how many more lots **of this estate** follow this one (0 on its last; another estate queued behind it is not counted). |

Suggested label: "Ravi's estate — 2 more after this".

- While lots run, `turn.phase` is `"auction"` and the turn does not move. Rolling, ending the turn,
  `buy` and `skipBuy` are refused (`Cannot roll now` / `Auction in progress`).
- While lots run the turn has **no shot clock**: `turn.endsAt` is `null` from the first lot to the
  last (hide the turn clock, as for any `null`), and nobody can time out on it. When the turn goes
  back to its player after the last lot it gets one fresh `turn.endsAt` (and an away player one
  "Your turn" push — once per sale, not once per lot).
- If the bankrupt player held the turn, the turn passes to the next player when the last lot
  falls. If somebody else holds it, it **picks up exactly where it was**: back to `"roll"` if they
  had not rolled yet, back to `"action"` with the same `turn.pending` if a deed was on offer,
  `"debt"` if they owe money, otherwise wherever their dice say (another roll on a double).
- **Timed games (F9):** if the game clock ran out during the sale and the turn it dropped into had
  not rolled yet (nothing owed, no deed on offer), the throw is **not** handed back: the game ends
  on the clock the moment the last lot falls, exactly as it would have ended at once had no hammer
  been up (`status: "ended"`, `endReason: "time"`). A turn that had already rolled plays out as
  any last turn does (a deed on offer is still theirs to decide; End turn ends the game).
- Two estates in a row (a card can knock out two players) queue: the first estate's lots, then
  the second's.

Log lines, in order: `Ravi went bankrupt — the streets return to the bank` (or the existing
creditor line), `Ravi's 3 properties go to auction, one at a time` (`1 property goes`), then per
lot the usual `Tel Aviv goes to auction! Starting bid $10` … `Asha won Tel Aviv at auction for
120` / `Nobody bid on Tel Aviv — it stays with the bank`. If a timed game's clock runs out
mid-sale: `The rest of the estate stays with the bank` when the lot under the hammer falls (then,
on an unrolled turn, `Time's up — richest player wins` and the winner line).

Stats: an estate lot won counts in `stats.auctionsWon` (the "Win an auction" mission, Auction
Hawk), never in `stats.streetsBought` — at an auction-only table too.

---------------------------------------------------------------------------------------------------

## G6 — Auction-only

With `settings.auctionOnly: true`, landing on an unowned street, airport or utility — by dice,
by card, or walking out of prison — starts its auction **at once**:

- There is never a `turn.pending` of type `"buy"` and never a `"action"` phase for a purchase.
  Draw the auction UI from `state.auction` (with `estate: null`), never a Buy panel.
- `turn.phase` is `"auction"` until the hammer falls; then the turn carries on as after any
  landing (`"end"`, or `"roll"` after a double).
- The deed's `price` is still on the tile (board and deed card) and is the reference for the
  bidding; bids may go above it. The roller bids like everyone else.
- House players bid as they always do. Log: `Rio goes to auction! Starting bid $10`.
- `buy` / `skipBuy` while a lot is up: `toast` `Auction in progress`.
- **Stats:** the hammer is the only way a street is bought here, so winning the lot of a
  **street** (`type: "property"`) that somebody landed on counts in `stats.streetsBought` as well
  as `stats.auctionsWon` — the "Buy 6 streets" mission, the Land Grabber title and the career's
  streets bought all move at an auction-only table. An airport or utility won counts in
  `auctionsWon` only (buying one never counted as a street), and so does an estate lot (G5). At
  every other table nothing changes: only `buy` counts a street bought.

---------------------------------------------------------------------------------------------------

## G7 — Shuffled board

With `settings.shuffleBoard: true`, each game (each `start`, including after Play again) deals a
new layout from a fresh seed:

- START and the other corners, Treasure/Surprise, taxes, airports and utilities stay on their
  squares.
- Every colour set keeps its streets together and moves, whole, onto the squares of another set
  **of the same size** (Classic: the two 2-street sets swap or stay, the six 3-street sets are
  permuted). Inside a set the streets keep their order. Each street carries its own deed: name,
  price, rent table, house cost, group, flag. Expensive streets can now sit right after START.
- Log, right after `Game started! Good luck.`: `The board was shuffled`. From 1.0.8 the line goes
  on to say what moved (`The board was shuffled — United States, the priciest set, now sits right
  after START`) — it always **starts** with `The board was shuffled`; match on that, never on the
  whole line. See Round 4.
- Cards that name a square ("Advance to Rio", the nearest airport, the priciest street) follow the
  streets. Sets, rent, building, even-build, mortgages, trades, bots, the deadlock rule and the
  end-of-game stats all use the shuffled layout.
- The board keeps its **id** (`state.mapId`, `state.map.id`, `settings.mapId` stay `"classic"`):
  careers ("Favourite board"), the shop and Watch live count it as Classic.

### Where clients draw the board from — `state.map` (this is the only copy)

Every state (full and patch) carries the board the table is playing:

```json
{
  "mapId": "classic",
  "map": {
    "id": "classic",
    "uid": "classic~1a2q0ns",
    "name": "Classic",
    "icon": "🌐",
    "tiles": [ { "type": "start", "name": "START", "index": 0 },
               { "type": "property", "name": "San Francisco", "group": "US", "price": 360,
                 "rent": [35, 175, 500, 1100, 1300, 1500], "houseCost": 200, "groupSize": 2, "index": 1 }, "…" ],
    "layout": { "corners": [0, 10, 20, 30], "top": [1, "…"], "right": ["…"], "bottom": ["…"], "left": ["…"] },
    "size": 40,
    "groups": { "US": [1, 3], "IL": [6, 7, 9], "…": [] },
    "shuffled": true
  },
  "groups": { "US": { "name": "United States", "color": "#2f80d8", "flag": "🇺🇸" }, "…": {} }
}
```

- **Draw every square, deed, set, flag and price from `state.map.tiles[i]`, and every set from
  `state.map.groups`** — the board, the deed card, the property list, trade rows (a tile index in
  a trade is a square of `state.map`), set/monopoly detection, build buttons, the mini-map.
  Colours and flags come from the top-level `state.groups[tile.group]`.
- **Never** use a board from `GET /api/maps` (or a bundled copy) to draw a table: the shuffled
  layout exists nowhere else. `/api/maps` is for the board picker only.
- `state.map.uid` identifies the exact layout. It changes whenever the layout does (a shuffled
  board is `<board uid>~<seed>`; a Random board is `random-xxxx`, shuffled `random-xxxx~seed`).
  A client that caches anything per board must key it on `uid` and rebuild when it changes —
  the web client already does (`board.js`, `map.uid || map.id`).
- `state.map.shuffled`: `true` while a shuffled game is on (and in its ended state); `false` in
  the lobby and on an unshuffled board. Old servers never send it — treat absent as `false`.
- The lobby shows the printed board (`shuffled: false`, `uid: "classic"`). Play again restores
  the printed board in the lobby; the next start deals a new shuffle (a different seed) if the
  setting is still on, or plays the printed board if it was switched off.

---------------------------------------------------------------------------------------------------

## G8 — Trades are public at the table

`state.trades` has always been sent to every socket at the table; from 1.0.6 every client shows
the offers that are not its own too ("Table trades", read-only). The rules the server enforces:

| who                                   | may |
|---------------------------------------|-----|
| the receiver (`trade.to`)             | `trade:respond` (accept/decline — a counter is a decline plus a new offer), `trade:ignore`, `trade:viewing` |
| the sender (`trade.from`)             | `trade:cancel`, `trade:viewing` |
| anyone else at the table              | read it — nothing else |
| a watcher (`spectate: true`)          | read it — every action is refused with `You are watching this game` |

Refusals (`toast`, the offer is untouched):

| event | from | message |
|-------|------|---------|
| `trade:respond` | not the receiver | `Not your trade` |
| `trade:cancel`  | the receiver | `Decline it instead` |
| `trade:cancel`  | anyone else | `Not your trade` |
| `trade:viewing` | not a party | no toast, no change (ignored) — "X is reading this" only ever names a party |

Ids: `from`, `to` and `viewers` are aliased exactly like every other id — a third player or a
watcher sees the same ids it sees on `state.players`, so `players.find(p => p.id === trade.from)`
gives the name; no token is ever in another viewer's state. Each party still sees its own real id.

```json
{ "id": 7, "from": "u_1pc4f6m61atbjlvfxrv", "to": "u_8rvv37ovuu6ykdsxp3",
  "give": { "money": 300, "tiles": [6], "cards": 0 }, "get": { "money": 0, "tiles": [], "cards": 0 },
  "at": 1791891882281 }
```

Row text, e.g. "Ravi → Asha: Tel Aviv for $300": `give` is what the sender parts with, `get` what
the sender asks for; tile names from `state.map.tiles[i].name`.

Log lines (kind `trade`, for everyone): `Ravi sent a trade offer to Asha`, `Asha declined the
trade from Ravi`, `Ravi and Asha completed a trade` (unchanged), and new:
`Ravi withdrew the trade offer to Asha`.

---------------------------------------------------------------------------------------------------

## G10 — Missions: XP each, coins only for all three

Numbers only; the shapes in F2 are unchanged.

- Each mission: **0 coins + 10 XP**. `GET /api/missions` rows read `"coins": 0, "xp": 10`.
  Claiming one: `"awarded": { "coins": 0, "xp": 10 }`; `coins` (the wallet balance) does not move.
  No coin-ledger row is written for it (nothing is minted); the claim is still once only
  (`duplicate: true` on a repeat).
- All three done: **bonus 3 coins** (`"bonus": { "coins": 3, … }`), claimed once with
  `id: "bonus"` → `"awarded": { "coins": 3, "xp": 0 }`. Claiming the three missions first is still
  not required.
- Card: show "+10 XP" on each mission row and the coin amount only on the all-done bonus row.

===================================================================================================

# Round 3 — 1.0.7

H2 (the bankrupt player chooses; smarter house players) and H3 (the same setting at Play-now
tables). H1, H4 and H5 are client-only and add no server shapes. Same rules as the parts above:
every new field is additive and rides full states and patches alike; an old server never sends it
— treat absent as the default given here. Where this part differs from the round-3 spec, this part
wins.

---------------------------------------------------------------------------------------------------

## `bankruptProperties` gains a third value

| key                  | type   | values                                 | default     |
|----------------------|--------|----------------------------------------|-------------|
| `bankruptProperties` | string | `"release"` `"auction"` `"choose"`     | `"release"` |

```js
socket.emit('settings', { bankruptProperties: 'choose' });
```

- `"release"` and `"auction"` are exactly G5. `"choose"` is new: the player who goes out decides
  (below).
- Anything else (`null`, `1`, `true`, `"decide"`, an array…) is refused **whole**, with the new
  message `Bankrupt properties go back to the bank, to auction, or the player decides` (it replaces
  the round-2 message `Bankrupt properties go back to the bank or to auction`).
- **Play-now tables roll it and their host may change it** (H3) — see the end of this part.
- **Cup tables** still refuse it (`A cup table is set by the cup`) and always play `"release"`,
  whatever the field says. `auctionOnly` and `shuffleBoard` stay private-table only: a Play-now
  patch carrying either is refused whole with the existing Play-now message. (1.0.8: `shuffleBoard`
  joins the Play-now roll — see Round 4. `auctionOnly` is still refused.)

Labels (every client):

| value       | segmented control   | one-line explanation under it                                        | rules sheet row ("Bankrupt properties") |
|-------------|---------------------|----------------------------------------------------------------------|-----------------------------------------|
| `release`   | Back to the bank    | A bankrupt player's properties go back to the bank, unowned.         | Back to the bank                        |
| `auction`   | Auction them        | A bankrupt player's properties are auctioned to everyone, one by one. | Auctioned                               |
| `choose`    | Player decides      | The player who goes bankrupt picks: back to the bank, or auction.    | Player decides                          |

---------------------------------------------------------------------------------------------------

## H2 — `"choose"`: the bankrupt player is asked

Whenever a player leaves play holding deeds — bankrupt to the bank or to a player, conceding,
walking out, removed for timeouts — their deeds become the bank's at once (buildings gone back,
mortgages lifted, exactly as `"release"` leaves them). At a `"choose"` table the bankrupt player
is then **asked** whether the bank keeps them or they go to auction. The creditor of a bankruptcy
to a player keeps the cash already paid, as always; the deeds never go to the creditor.

### `state.bankruptChoice` (new, top level)

```json
{
  "bankruptChoice": {
    "playerId": "u_2xwvqmcqwaz0d2dus9a",
    "name": "Ravi",
    "properties": [11, 13, 14, 21],
    "endsAt": 1792012201909
  }
}
```

| field        | meaning |
|--------------|---------|
| `playerId`   | Who is being asked. Aliased like every other id: the bankrupt player's own client sees its own id, everybody else (and every watcher) the alias they see on `state.players`. **Show the prompt when `playerId` is the client's own id**; everyone else shows "Ravi is deciding what happens to their streets…". |
| `name`       | The player's display name (the same as their `players` row). |
| `properties` | The deeds in question, as board indices **in board order** — draw the rows from `state.map.tiles[i]` (flag/colour from `state.groups`, `price`). They are already absent from `state.ownership` (the bank's). Airports and utilities included. Never empty. |
| `endsAt`     | ms since epoch: when the house answers for them (20 s after the question opened). Draw the countdown from it. |

`null` whenever nobody is being asked (always `null` at `"release"`/`"auction"` tables, in the
lobby and once the game has ended). An old server never sends it — treat absent as `null`.

### Answering — socket `bankruptChoice` (new)

```js
socket.emit('bankruptChoice', { auction: true });   // "Auction them to everyone"
socket.emit('bankruptChoice', { auction: false });  // "Give them back to the bank"
```

No ack. On success the next state has `bankruptChoice: null` (or the next player's question, see
"Two at once") and the log lines below. Refusals (`toast { type: "error", message }`, nothing
changes, the question stays open):

| when                                         | message |
|----------------------------------------------|---------|
| no question is open                          | `There is nothing to decide right now` |
| the socket is not the player being asked     | `That decision is not yours` |
| `auction` is not exactly `true` or `false` (missing, `"yes"`, `1`, no payload…) | `Choose the bank or an auction` |
| a watcher (`spectate: true`)                 | `You are watching this game` |

### Give up / Declare bankruptcy with the answer in the dialog

```js
socket.emit('bankrupt', { auction: true });   // or { auction: false }
```

- At a `"choose"` table the player who answers here is **not asked again**: the answer is applied
  as they go out. Show the two options inside the Give up confirmation (and the debt sheet's
  Declare bankruptcy confirmation) only when **all** of these hold:
  - `state.settings.bankruptProperties === "choose"`;
  - the player owns at least one deed;
  - a sale could still happen once they are out — `state.timeUp` is not `true`, and at least two
    **other** players are still in (not `bankrupt`), so their going out does not end the game;
    with teams on (`settings.teams > 0`) those players must also be on at least two different
    teams, because one team left is a game won.

  Otherwise show the plain confirmation, saying the deeds go back to the bank — which is where
  they go, whatever was sent (the "Not asked at all" rule below). The same test decides the
  Leave sheet's wording: promise a choice on Give up only when these options would be shown. At an
  `"auction"` table the same last condition decides whether the confirmation may say the deeds
  are auctioned.
- `bankrupt` with no payload (every older client), or with an `auction` that is not `true`/`false`,
  concedes exactly as before — and the question follows.
- At a `"release"` or `"auction"` table the payload is ignored: the table's rule decides.
- `quit` (Leave game) takes no answer: a player who walks out is not asked (below).

### While the question is open — the game holds still

- `turn.phase` is **not** changed: it says where the turn is. Clients disable the turn's own
  buttons while `state.bankruptChoice` is non-null.
- `roll`, `buy`, `skipBuy`, `endTurn`, `jailPay`, `jailCard` are refused with
  `toast` `Waiting for Ravi to decide about their properties` (Ravi = `bankruptChoice.name`).
- No shot clock: `turn.endsAt` is `null` from the moment the question opens, and nobody can time
  out on it. The house plays nobody's turn.
- An auction already under the hammer carries on (`bid`, `passBid` work); building, mortgaging and
  trading work as always.
- If the bankrupt player held the turn, the turn passes to the next player at once (a normal
  `"Asha's turn"`), and that turn waits on the answer.
- When it is answered: **back to the bank** → the turn picks up exactly where it was, with one
  fresh `turn.endsAt` (and an away player one "Your turn" push). **Auction** → the estate sale of
  G5 runs (`state.auction.estate = { from, left }`), and when its last lot falls the turn picks up
  the same way.

### Who is asked, and who the house decides for

- **Asked:** a connected person, and a **house player** — which gets the same `bankruptChoice`
  (at a Play-now table it passes for a person) and answers after a person's pause of 1.8–3.2 s
  (the same pause every time the same game is replayed), by the house's rule below. Its log line
  reads like anyone's.
- **Not asked — the house decides on the spot:** a player who is disconnected, a seat the house is
  covering (`botControlled`, including a missed turn), a player who walks out (`quit`), and one
  removed for timeouts. A player who disconnects while their question is open is answered for at
  once.
- **No answer within 20 s:** the house decides.
- **Two at once** (a card that collects from everybody can knock out two): one question at a time,
  in the order they went out; the second opens, with its own 20 s, when the first is answered.
- **Not asked at all:** once a timed game's clock has run out (nothing is sold after time — an open
  or waiting question is dropped at that moment and the deeds stay with the bank), and when the
  bankruptcy ends the game. A question still open when the game ends is simply cleared.

### The house's rule (house players, absent players, and anyone who does not answer)

It picks whatever keeps the game competitive. **Back to the bank** when either:

1. one side still in holds **more cash than every other side still in put together** — a side
   is one player, or at a team table a team's players still in, counted as one purse (so when
   only two sides are left, the richer one always does, unless they hold exactly the same) —
   they would win every lot; or
2. the auction could hand **the leader** — the player still in with the highest `netWorth` (ties:
   more cash, then seat order) — **or the player with the most cash**, a colour set or all but one
   street of one: for any colour the lots touch, what that player's side already holds plus every
   lot of that colour makes the **whole colour**, or — on a colour of three or more streets they
   already hold a piece of — **all but one** street of it. (Airports and utilities never trip this.)

**Auction** otherwise. Deterministic: the same board always gets the same answer. It reads only
what every client can see.

### Log lines, in order

At a `"choose"` table the bankruptcy line no longer says where the streets went:

| moment | line (kind `bankrupt`) |
|--------|------------------------|
| goes out | `Ravi concedes the game` (concede only), then `Ravi went bankrupt` — or `Ravi went bankrupt — Asha keeps what was paid` |
| asked | `Ravi is deciding what happens to their 3 properties` (`…to their property` for one) |
| answers / a house player decides | `Ravi chose to auction their properties` · `Ravi gave their properties back to the bank` |
| no answer in 20 s | `Ravi didn't choose in time — the house put their properties up for auction` · `…— the house gave their properties back to the bank` |
| not there to ask | `Ravi isn't here to choose — the house put their properties up for auction` · `…gave their properties back to the bank` |
| clock ran out | `Time's up — Ravi's properties go back to the bank` |

An auction is followed by G5's lines (`Ravi's 3 properties go to auction, one at a time`, then each
lot). `"release"` and `"auction"` tables log exactly as in G5.

### Old clients

A 1.0.6 client at a `"choose"` table (a host on 1.0.7 set it, or a Play-now table rolled it) never
sends `bankruptChoice`: its own question times out after 20 s and the house decides; when somebody
else is deciding it sees the game wait, and its Roll button gets the `Waiting for …` toast.

---------------------------------------------------------------------------------------------------

## H2 — Smarter house players

No new fields. What changed in how house players play (`settings.botLevel`, F3; a seat the house
covers and every Play-now house player still play **normal**):

**Every lot, at every skill** (an ordinary auction, an auction-only landing, an estate lot):

| | easy | normal | hard |
|---|---|---|---|
| Ordinary street (no colour race) | half the sticker | as 1.0.6 (a bargain: under the sticker) | as 1.0.6 ($5 under the sticker to the sticker) |
| Completes **its own** colour | half the sticker | the higher of its 1.0.6 ceiling and the sticker + 35% of the colour's built rent (`rent[3]` of each street × 0.9) | the same with 60% |
| Would complete **the leader's** colour | half the sticker | its 1.0.6 ceiling × 1.15 | its 1.0.6 ceiling × 1.3 |
| Would leave the leader one street short (colour of 3+) | half the sticker | at least 1.25 × the sticker | at least 1.5 × the sticker |
| Never bids itself bankrupt | the same → | after any bid, the dearest rent within one throw of the bot (2–12 squares ahead, built and doubled as `rentFor` charges it, airports, utilities at a throw of 7, taxes) is still payable from the cash left plus what it could raise (half of every building, half the price of every unmortgaged deed, the lot itself included) — otherwise it passes | the same |

Each bot's own temper (0.85–1.15) scales these as it always has. The "leader" is the player still
in with the highest net worth. The cash a bot keeps back while bidding (its floor) is unchanged for
easy and normal.

**Hard only**, to make it really harder than normal:

- **Cash reserve read off the board ahead of it:** the rent waiting within one throw at about the
  one-in-six mark of the 2d6 odds, between $80 and $500 (normal keeps 75% of the worst rent
  anywhere on the board, $120–$400). It buys, builds and bids with that reserve.
- **Mortgages strays to build:** while a full colour of its own is under three houses a street, it
  mortgages just enough of its strays (cheapest first; never a deed of a colour it owns or one that
  decides a colour race) to pay for getting there, keeping half its reserve. It lifts a mortgage
  outside a full colour of its own only when that leaves nothing short — so it never lifts a deed
  and mortgages it again in the same turn.
- **Trades:** it counts a quarter of what a deal hands the other side (the colour it would complete
  for them) against the deal — so it no longer signs a swap that finishes a cheap colour for itself
  and a dear one for its rival, without the difference in cash.

**Measured** — one seat the house plays for a person (always normal) against three house players,
Classic, auctions on, bankrupt estates released, random seat order, played to a winner or 500 turns
(then the richest wins); the same 720 seeds (1001–1240, 5001–5240, 9001–9240) before and after.
Lower = stronger bots:

| the seat won … against | easy | normal | hard |
|------------------------|------|--------|------|
| 1.0.6                  | 666 / 720 (92.5%) | 206 / 720 (28.6%) | 197 / 720 (27.4%) |
| 1.0.7                  | 666 / 720 (92.5%) | 206 / 720 (28.6%) | **118 / 720 (16.4%)** |
| 1.0.7, first 60 seeds (1001–1060) | 55 / 60 | 16 / 60 | 13 / 60 |

1.0.6's hard was no stronger than normal over a large sample; 1.0.7's hard cuts the person's share
by about two fifths. `test/round3.mjs` re-runs 120 seeds (7001–7120) on every `npm test`: 30 / 120
against normal, 17 / 120 against hard. The F3 table above still holds; read its auction row
together with the lot table here, and its hard column with the three hard-only additions (its
"usual floor" for a hard bot is now the reserve read off the board ahead of it). F3's measured
line (54 / 15 / 13 of 60) was a different harness; the table here is the one to quote.

---------------------------------------------------------------------------------------------------

## H3 — The setting at Play-now tables

- `bankruptProperties` is one of the rules a Play-now table **rolls**, weighted:
  `"release"` 50%, `"auction"` 25%, `"choose"` 25%. A Play-now table **plays** what it rolled (or
  what its host changed it to) — the old "Play-now plays the defaults" rule now holds only for
  `auctionOnly` and `shuffleBoard` (from 1.0.8, only `auctionOnly` — see Round 4).
- **Host-editable in the Play-now lobby** like the other rolled rules: it is in
  `state.quickLobby.editable`, the host sends the ordinary `settings` event
  (`{ bankruptProperties: "choose" }`), a change un-readies everybody as any rule change does, and
  `state.quickRoll.edited` lists it while it differs from the roll.
- `state.quickRoll.parts` gains **one phrase, last** (after `even build on/off`):

  | value     | phrase |
  |-----------|--------|
  | `release` | `bankrupt streets back to the bank` |
  | `auction` | `bankrupt streets auctioned` |
  | `choose`  | `bankrupt player decides` |

  So the roll line reads e.g. `This table rolled: Classic · $1,500 to start · x2 rent on full sets
  on · vacation cash off · auctions on · no rent while jailed off · even build on · bankrupt player
  decides`, and a host's change `Hana changed the rules: bankrupt streets auctioned`.
- Show it in the Play-now lobby's rule list (the same segmented control as a private table, for
  the host; the value for everyone else) and in the rules sheet.
- Cup tables: unchanged — refused, always `"release"`.

---------------------------------------------------------------------------------------------------

## Place facts (1.0.7)

One checked "Did you know?" line per street and one per country or region, to show under a card.
The text lives in `server/facts.json` and is served exactly as written; read once at boot.

```
GET /api/facts
→ 200  Cache-Control: public, max-age=86400
       ETag: "0a1b2c3d4e5f6789"            (the version, quoted — a strong tag)
{
  "version": "0a1b2c3d4e5f6789",
  "places": { "Mumbai|IN": "…", "Jaipur|IN_RJ": "…", "Jaipur|RJ": "…", … },
  "groups": { "IN": "…", "IN_RJ": "…", "RJ": "…", … }
}
```

- **Look a street up by `"<tile.name>|<tile.group>"`** exactly as the board sends them (accents
  and all: `"São Paulo|BR"`), and its set by `tile.group`. The same city has its own key on each
  set it sits in.
- `version` is 16 hex characters, a hash of `places` + `groups`: it changes when, and only when, a
  fact does (or one is added). Cache the body by it; there is nothing else to key on.
- **Revalidate** with `If-None-Match: "<version>"` → `304`, no body, same headers. A weak tag
  (`W/"…"`), a list, or `*` matches too, and so does a request a browser's `fetch()` has stamped
  `Cache-Control: no-cache`. Any other tag gets the full `200`.
- **The web client sends no If-None-Match**: the site and the API are different origins and CORS
  allows only `Content-Type`, so the header would fail its preflight. A plain `fetch()` lets the
  browser's HTTP cache revalidate with the ETag itself. The apps send the header directly.
- **Random boards**: a city the random generator deals that has no fact under its own key
  (`Kolkata|IN`) is served the same city's fact from a board of the same country (`Kolkata|EA`) —
  added to `places` under the random board's key, so the lookup above is still all a client does.
  Never across countries.
- **Missing is normal**: a street with no fact, or an old server with no route (`404`), shows no
  line. Show the set's fact, if any, on its own.
- `test/facts.mjs` (in `npm test`) fails the build if a street or set on any board — stock,
  shuffled, or anything the random generator can deal — has no fact, if a fact is outside 40–170
  characters or has an emoji, or if a fact belongs to no street any board deals.

===================================================================================================

# Round 4 — 1.0.8: the shuffled board at Play-now tables

Until 1.0.8 a Play-now table always played the printed board: `shuffleBoard` was a private-table
switch (G7). From 1.0.8 a Play-now table rolls it like its other house rules and its host may
change it. Nothing about the shuffled board itself changes — G7 is still exactly how a board is
shuffled, sent and drawn. Same rules as the parts above: every change is additive; an old server
never rolls it, and an old server's roll has eight phrases, not nine.

---------------------------------------------------------------------------------------------------

## The roll

- `shuffleBoard` is one of the rules a Play-now table **rolls**, weighted `false` 2 : `true` 1 —
  about one table in three plays a shuffled board. It is the last rolled rule (after
  `bankruptProperties`).
- It is never dealt `true` onto a board with no two colour sets of the same size: a shuffle only
  trades sets of one size, so such a board would be dealt exactly as printed while the lobby said
  otherwise. Today **every** stock board — all 24 in `MAPS` and Random — has such a pair, so this
  never fires; it keeps the chip honest if a board without one is ever added.
- A Play-now table **plays** what it rolled, or what its host changed it to: `start` deals a
  shuffled board exactly as G7 says (a fresh seed, `state.map.shuffled: true`, a new
  `state.map.uid`, the board's id unchanged). The lobby always shows the printed board
  (`state.map.shuffled: false`); the shuffle happens at the deal.
- Cup tables: unchanged — `shuffleBoard` is refused there and never played.
- `auctionOnly` is still private-table only: a Play-now patch carrying it is refused whole with
  `A Play-now table keeps its seats, privacy, house players, teams and clock`.

## The Play-now lobby

- `state.quickLobby.editable` includes `"shuffleBoard"`. In full it is now `startingCash`,
  `x2rent`, `vacationCash`, `auction`, `noRentInPrison`, `evenBuild`, `bankruptProperties`,
  `shuffleBoard`, `mapId` — test membership, never position.
- The host sends the ordinary `settings` event (`{ shuffleBoard: true }`). As with every rolled
  rule, a change un-readies everybody else, `state.quickRoll.edited` lists `"shuffleBoard"` while
  it differs from the roll, and the log says `Hana changed the rules: shuffled board on`. Changed
  together with other rules it is named last: `Hana changed the rules: auctions off · shuffled
  board on`. Sending the value that is already set changes nothing and says nothing.
- At a Play-now table only: moving the board to one that cannot be shuffled turns the switch off
  with it (`Hana changed the rules: <Board> board · shuffled board off`), and turning it on there
  is a no-op. A private table keeps whatever its host set, as since 1.0.6.
- `state.quickRoll.keys` includes `"shuffleBoard"` on a table a 1.0.8 server rolled.
- `state.quickRoll.parts` gains a **ninth phrase, last**, read off the live setting:
  `shuffled board on` / `shuffled board off`.

  | index | phrase (example)                      | key                  |
  |-------|---------------------------------------|----------------------|
  | 0     | `Classic`                             | `mapId`              |
  | 1     | `$1,500 to start`                     | `startingCash`       |
  | 2     | `x2 rent on full sets on`             | `x2rent`             |
  | 3     | `vacation cash off`                   | `vacationCash`       |
  | 4     | `auctions on`                         | `auction`            |
  | 5     | `no rent while jailed off`            | `noRentInPrison`     |
  | 6     | `even build on`                       | `evenBuild`          |
  | 7     | `bankrupt player decides`             | `bankruptProperties` |
  | 8     | `shuffled board on` (**new**)         | `shuffleBoard`       |

  Last, so the 1.0.7 apps already in the stores — whose index → key maps have eight entries —
  keep every existing chip on its own rule and show the ninth as a plain chip. **Clients:** append
  `shuffleBoard` as the ninth entry of the index → key map, and look indices up safely: a roll
  from an older server has eight phrases and no index 8.

  The roll line in the log therefore reads e.g. `This table rolled: Classic · $1,500 to start · x2
  rent on full sets on · vacation cash off · auctions on · no rent while jailed off · even build on
  · bankrupt player decides · shuffled board on`.

## The deal — the log line

Kind `system`, right after `Game started! Good luck.`, on any table that deals a shuffled board
(private or Play-now):

```
The board was shuffled — <what moved>
```

| `<what moved>`                                              | when |
|-------------------------------------------------------------|------|
| `<Set>, the priciest set, now sits right after START`      | the set now first after START was not first on the printed board, and it holds the board's priciest street |
| `<Set> now sits right after START`                          | the set now first after START was not first on the printed board |
| `<N> of <M> sets moved, and <Set> still opens the board`    | the first set after START did not move; N of the board's M sets did |

`<Set>` is the set's display name, `state.groups[key].name` — the name the deeds and the property
list already use (`United States`, `Maharashtra`, `The Northeast`). Examples:

- `The board was shuffled — United States, the priciest set, now sits right after START`
- `The board was shuffled — France now sits right after START`
- `The board was shuffled — 5 of 8 sets moved, and Brazil still opens the board`

On the vanishingly rare deal where no set ended up moving, the line is the bare 1.0.6
`The board was shuffled`. **Clients:** match the line by its opening `The board was shuffled`,
never the whole text, and never parse the clause — for a "shuffled board" heads-up, read
`state.map.shuffled` and key it on `state.map.uid`.

## Old clients

- Every shipped client already draws the board from `state.map` and redraws when
  `state.map.uid` changes (G7), so a 1.0.7 or older app at a shuffled Play-now table plays the
  shuffled board correctly.
- A 1.0.7 app shows the ninth phrase as a chip with no "changed by host" mark, and a 1.0.7 host has
  no control for it (the table still plays what was rolled; a 1.0.8 host can change it).
- Their table rules sheets ("i") read the shuffle only at a host-set private table, so at a
  Play-now table that rolled it on they say the wrong thing. iOS 1.0.6/1.0.7 show
  `Shuffled board: Off — Every street stays where the board prints it` both in the lobby (right
  under a `shuffled board on` chip) and in the game, while the sheet's own Board row says
  `Shuffled for this game`. Android 1.0.6/1.0.7 show Off in the lobby only; after the deal they
  read On, from `state.map.shuffled`. Only the words are wrong — the board is dealt and played
  correctly, and updating to 1.0.8 fixes the sheet. No server change can help: the old sheets
  ignore `settings.shuffleBoard` whenever `quick` is true.
