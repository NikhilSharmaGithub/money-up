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
- Log, right after `Game started! Good luck.`: `The board was shuffled`.
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
