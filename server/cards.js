// Treasure (chest) and Surprise (chance) cards, built to order per board.
//
// No fixed decks any more: buildDecks(map) composes each pile fresh from
// three sources — the handful of cards the house insists on, some local
// colour (a country board brings its own deck along; the built-in boards
// keep theirs below), and templates whose blanks are filled from the board
// itself, so a speeding fine happens near a street that actually exists.
//
// Action kinds the engine understands:
//   money       { amount }                  - gain/lose from the bank
//   moveTo      { tile: 'start'|'vacation'|'prison'|'priciest'|index, collect }
//   moveBy      { n }                       - negative walks backwards
//   nearest     { target: 'airport'|'utility', payMultiplier }
//   jail                                    - straight to prison
//   getout                                  - keep a get-out-of-prison card
//   collectEach { amount }                  - every other player pays you
//   payEach     { amount }                  - you pay every other player
//   repairs     { house, hotel }            - pay per building owned
//   perProperty { amount }                  - per street owned; the sign
//                                             decides who pays whom

const randOf = (list) => list[Math.floor(Math.random() * list.length)];

/** Everything a template might want to know about the board. */
function deckContext(map) {
  const streets = map.tiles.filter((t) => t.type === 'property');
  const byPrice = [...streets].sort((a, b) => a.price - b.price);
  return {
    board: map.name,
    streets,
    cheapStreets: byPrice.slice(0, Math.max(2, Math.floor(byPrice.length / 3))),
    priciest: byPrice[byPrice.length - 1],
    airports: map.tiles.filter((t) => t.type === 'airport'),
    utilities: map.tiles.filter((t) => t.type === 'utility'),
  };
}

// Placeholders draw fresh each time, so two copies of a template never read
// the same. A typo'd key keeps its braces — the tests notice.
function fill(text, ctx) {
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    switch (key) {
      case 'street': return randOf(ctx.streets).name;
      case 'cheap': return randOf(ctx.cheapStreets).name;
      case 'priciest': return ctx.priciest.name;
      case 'airport': return randOf(ctx.airports).name;
      case 'utility': return randOf(ctx.utilities).name;
      case 'board': return ctx.board;
      default: return match;
    }
  });
}

// A pool entry is either { text, act, needs? } or a function of the context
// returning a finished card (for when the text and the act must agree on
// which tile they mean). `needs` names a tile type the board must have.
function instantiate(entry, ctx) {
  if (typeof entry === 'function') return entry(ctx);
  if (entry.needs === 'utility' && !ctx.utilities.length) return null;
  if (entry.needs === 'airport' && !ctx.airports.length) return null;
  return { text: fill(entry.text, ctx), act: entry.act };
}

// ---- the owner's cards -------------------------------------------------------
// These make every deck, on every board, no matter what.
const NAMED_TREASURE = [
  { text: 'Advance to START and collect your salary.', act: { kind: 'moveTo', tile: 'start', collect: true } },
  { text: 'You threw a party. Collect $10 from every player.', act: { kind: 'collectEach', amount: 10 } },
  { text: 'Time to relax. Go on vacation.', act: { kind: 'moveTo', tile: 'vacation' } },
  { text: 'Street repairs. Pay $25 per house and $100 per hotel.', act: { kind: 'repairs', house: 25, hotel: 100 } },
];

const NAMED_SURPRISE = [
  { text: 'Go back 10 steps.', act: { kind: 'moveBy', n: -10 } },
  { text: 'Go to prison. Do not pass START, do not collect your salary.', act: { kind: 'jail' } },
  { text: 'Advance to START and collect your salary.', act: { kind: 'moveTo', tile: 'start', collect: true } },
  { text: 'Street repairs. Pay $50 per house and $200 per hotel.', act: { kind: 'repairs', house: 50, hotel: 200 } },
  { text: 'Major street repairs. Pay $100 per house and $400 per hotel.', act: { kind: 'repairs', house: 100, hotel: 400 } },
];

// ---- template pools ----------------------------------------------------------
// Treasure leans domestic — neighbours, windfalls, bills. Surprise travels.
const TREASURE_POOL = {
  money: [
    { text: 'Bank pays you a dividend of $50.', act: { kind: 'money', amount: 50 } },
    { text: 'Hospital fees. Pay $100.', act: { kind: 'money', amount: -100 } },
    { text: 'You inherit $100.', act: { kind: 'money', amount: 100 } },
    { text: 'Income tax refund. Collect $20.', act: { kind: 'money', amount: 20 } },
    { text: 'Life insurance matures. Collect $100.', act: { kind: 'money', amount: 100 } },
    { text: 'Pay school fees of $50.', act: { kind: 'money', amount: -50 } },
    { text: 'Receive a $25 consultancy fee.', act: { kind: 'money', amount: 25 } },
    { text: 'Holiday fund matures. Receive $100.', act: { kind: 'money', amount: 100 } },
    { text: "Doctor's fees. Pay $50.", act: { kind: 'money', amount: -50 } },
    { text: 'Sale of stock. You get $50.', act: { kind: 'money', amount: 50 } },
    { text: 'You won second prize in a beauty contest. Collect $10.', act: { kind: 'money', amount: 10 } },
    { text: 'Your lemonade stand on {cheap} turns a profit. Collect $15.', act: { kind: 'money', amount: 15 } },
    { text: 'The neighbours on {street} chip in for your new fence. Collect $40.', act: { kind: 'money', amount: 40 } },
    { text: 'A pothole on {street} eats your front wheel. Pay $35.', act: { kind: 'money', amount: -35 } },
    { text: 'You sublet your spare room near {priciest}. Collect $90.', act: { kind: 'money', amount: 90 } },
    { text: 'The {utility} overcharged you all year. Refunded $45.', act: { kind: 'money', amount: 45 }, needs: 'utility' },
    { text: 'Your lost bag surfaces at {airport}. The airline pays $60 for the trouble.', act: { kind: 'money', amount: 60 }, needs: 'airport' },
    { text: 'Street festival on {cheap}. Your food stall clears $70.', act: { kind: 'money', amount: 70 } },
    { text: "You backed a friend's cafe on {street}. It folds. Pay $80.", act: { kind: 'money', amount: -80 } },
    { text: 'A tax audit finds a mistake in your favour. Collect $125.', act: { kind: 'money', amount: 125 } },
    { text: 'Your dentist raises his rates mid-filling. Pay $65.', act: { kind: 'money', amount: -65 } },
    { text: 'You finally sell the exercise bike. Collect $30.', act: { kind: 'money', amount: 30 } },
    { text: 'The roof asks for a new gutter. Pay $45.', act: { kind: 'money', amount: -45 } },
    { text: 'Your quiet Sunday market stall has its best week. Collect $55.', act: { kind: 'money', amount: 55 } },
    { text: 'The book club fines you for spoilers. Pay $10.', act: { kind: 'money', amount: -10 } },
    { text: 'The council revalues the neighbourhood. Collect $20 per street you own.', act: { kind: 'perProperty', amount: 20 } },
    { text: 'Ground rent falls due across {board}. Pay $15 per street you own.', act: { kind: 'perProperty', amount: -15 } },
  ],
  move: [
    { text: 'You are invited to dinner on {priciest}. Advance there.', act: { kind: 'moveTo', tile: 'priciest', collect: true } },
    { text: 'Take the scenic route. Go back 3 spaces.', act: { kind: 'moveBy', n: -3 } },
    { text: 'The lights are all green. Skip ahead 2 tiles.', act: { kind: 'moveBy', n: 2 } },
    { text: 'Go back 4 spaces and apologise to whoever you overtook.', act: { kind: 'moveBy', n: -4 } },
    { text: 'A long weekend beckons. Off to Vacation.', act: { kind: 'moveTo', tile: 'vacation' } },
    { text: 'Your annual review goes well. Advance to START and collect your salary.', act: { kind: 'moveTo', tile: 'start', collect: true } },
    { text: 'Your ride to the nearest Airport leaves now. Pay the usual rent if someone owns it.', act: { kind: 'nearest', target: 'airport', payMultiplier: 1 }, needs: 'airport' },
    (ctx) => {
      if (!ctx.airports.length) return null;
      const a = randOf(ctx.airports);
      return { text: `You volunteer to collect a parcel from ${a.name}. Advance there.`, act: { kind: 'moveTo', tile: a.index } };
    },
    (ctx) => {
      const t = randOf(ctx.cheapStreets);
      return { text: `An old friend puts you up on ${t.name}. Advance there.`, act: { kind: 'moveTo', tile: t.index, collect: true } };
    },
    { text: 'You walked past your own front door. Go back 2 spaces.', act: { kind: 'moveBy', n: -2 } },
  ],
  social: [
    { text: "It's your birthday. Collect $20 from every player.", act: { kind: 'collectEach', amount: 20 } },
    { text: 'Grand opera night. Collect $50 from every player.', act: { kind: 'collectEach', amount: 50 } },
    { text: 'Housewarming on {street}. Every guest brings $30.', act: { kind: 'collectEach', amount: 30 } },
    { text: 'You lose a bet with the whole table. Pay each player $25.', act: { kind: 'payEach', amount: 25 } },
    { text: 'The round is on you. Pay each player $15.', act: { kind: 'payEach', amount: 15 } },
  ],
  repairs: [
    { text: 'Your buildings fail inspection. Pay $40 per house and $115 per hotel.', act: { kind: 'repairs', house: 40, hotel: 115 } },
    { text: 'Everything needs repainting at once. Pay $30 per house and $110 per hotel.', act: { kind: 'repairs', house: 30, hotel: 110 } },
  ],
  getout: [
    { text: 'Get out of prison free. Keep this card.', act: { kind: 'getout' } },
    { text: 'The judge owes you a favour. Keep this card to walk out of prison once.', act: { kind: 'getout' } },
  ],
  jail: [
    { text: 'You are caught dodging fares. Go to prison.', act: { kind: 'jail' } },
    { text: 'Creative accounting. Go straight to prison.', act: { kind: 'jail' } },
  ],
};

const SURPRISE_POOL = {
  money: [
    { text: 'The bank pays you $150.', act: { kind: 'money', amount: 150 } },
    { text: 'Pay a poor tax of $15.', act: { kind: 'money', amount: -15 } },
    { text: 'Your building loan matures. Collect $150.', act: { kind: 'money', amount: 150 } },
    { text: 'You won a crossword competition. Collect $100.', act: { kind: 'money', amount: 100 } },
    { text: 'Speeding fine near {street}. Pay $50.', act: { kind: 'money', amount: -50 } },
    { text: 'Your stocks soar. Collect $200.', act: { kind: 'money', amount: 200 } },
    { text: 'A generous stranger hands you $75.', act: { kind: 'money', amount: 75 } },
    { text: 'Parking ticket outside {priciest}. Pay $40.', act: { kind: 'money', amount: -40 } },
    { text: 'Wrong terminal at {airport}. The rebooking desk takes $55.', act: { kind: 'money', amount: -55 }, needs: 'airport' },
    { text: 'Customs at {airport} takes an interest in your suitcase. Pay $70.', act: { kind: 'money', amount: -70 }, needs: 'airport' },
    { text: 'The {utility} bills you for a month you spent abroad. Pay $30.', act: { kind: 'money', amount: -30 }, needs: 'utility' },
    { text: 'You short-sell property on {street} and it works. Collect $110.', act: { kind: 'money', amount: 110 } },
    { text: 'Your travel blog about {board} finds a sponsor. Collect $90.', act: { kind: 'money', amount: 90 } },
    { text: 'You miss the last train and take a cab across town. Pay $25.', act: { kind: 'money', amount: -25 } },
    { text: 'A street magician relieves you of $20. You applaud anyway.', act: { kind: 'money', amount: -20 } },
    { text: 'You flip a souvenir stall lease near {cheap}. Collect $65.', act: { kind: 'money', amount: 65 } },
    { text: 'Currency exchange goes your way for once. Collect $35.', act: { kind: 'money', amount: 35 } },
    { text: 'Roaming charges. Pay $45.', act: { kind: 'money', amount: -45 } },
    { text: 'A slot machine pays out. Collect $85.', act: { kind: 'money', amount: 85 } },
    { text: 'An investment tip from a taxi driver somehow lands. Collect $120.', act: { kind: 'money', amount: 120 } },
    { text: 'Your umbrella business fails on the first sunny day. Pay $60.', act: { kind: 'money', amount: -60 } },
    { text: 'Duty free was not, in fact, free. Pay $35.', act: { kind: 'money', amount: -35 } },
    { text: 'Property tax. Pay $25 per street you own.', act: { kind: 'perProperty', amount: -25 } },
    { text: 'A developer options land beside yours. Collect $15 per street you own.', act: { kind: 'perProperty', amount: 15 } },
  ],
  move: [
    { text: 'Advance to the nearest Airport and pay double rent.', act: { kind: 'nearest', target: 'airport', payMultiplier: 2 }, needs: 'airport' },
    { text: 'Advance to the nearest Utility. Pay 10x your dice roll.', act: { kind: 'nearest', target: 'utility', payMultiplier: 10 }, needs: 'utility' },
    { text: 'Go back three spaces.', act: { kind: 'moveBy', n: -3 } },
    { text: 'Advance to {priciest}, the most expensive street on the board.', act: { kind: 'moveTo', tile: 'priciest', collect: true } },
    { text: 'Your flight is delayed. Take a vacation instead.', act: { kind: 'moveTo', tile: 'vacation' } },
    { text: 'Tailwind. Skip ahead 5 tiles.', act: { kind: 'moveBy', n: 5 } },
    { text: 'The tour bus overshoots your stop. Move ahead 3 tiles.', act: { kind: 'moveBy', n: 3 } },
    { text: 'You board the wrong bus. Go back 7 spaces.', act: { kind: 'moveBy', n: -7 } },
    { text: 'A shortcut through the alleys. Skip ahead 4 tiles.', act: { kind: 'moveBy', n: 4 } },
    (ctx) => {
      if (!ctx.airports.length) return null;
      const a = randOf(ctx.airports);
      return { text: `Gate change! Sprint to ${a.name}.`, act: { kind: 'moveTo', tile: a.index } };
    },
    (ctx) => {
      const t = randOf(ctx.cheapStreets);
      return { text: `You left your phone at a cafe on ${t.name}. Go back for it.`, act: { kind: 'moveTo', tile: t.index } };
    },
  ],
  social: [
    { text: 'You were elected chairman. Pay each player $50.', act: { kind: 'payEach', amount: 50 } },
    { text: 'You win the pub quiz for the whole table. Collect $15 from every player.', act: { kind: 'collectEach', amount: 15 } },
    { text: 'Your karaoke encore clears the room. Pay each player $20.', act: { kind: 'payEach', amount: 20 } },
    { text: 'You sell everyone here your holiday photos of {board}. Collect $25 from every player.', act: { kind: 'collectEach', amount: 25 } },
    { text: 'You said the tab was on you, and everyone heard. Pay each player $30.', act: { kind: 'payEach', amount: 30 } },
  ],
  repairs: [
    { text: 'General repairs. Pay $25 per house and $100 per hotel.', act: { kind: 'repairs', house: 25, hotel: 100 } },
  ],
  getout: [
    { text: 'Get out of prison free. Keep this card.', act: { kind: 'getout' } },
    { text: 'Your lawyer finds a loophole. Keep this card to walk out of prison once.', act: { kind: 'getout' } },
  ],
  jail: [
    { text: 'Caught fare-dodging at {airport}. Go to prison.', act: { kind: 'jail' }, needs: 'airport' },
    { text: 'You parked in four spaces at once. Go to prison.', act: { kind: 'jail' } },
  ],
};

// ---- flavour for the built-in boards ----------------------------------------
// Country boards carry their own decks (map.deck, from countries.js). The
// built-in boards get their colour here instead. A board with neither entry
// nor deck still fills up from the templates above.
const FLAVOUR = {
  classic: {
    treasure: [
      { text: 'Your round-the-world ticket has a typo. Pay $60 to reissue it.', act: { kind: 'money', amount: -60 } },
      { text: 'Your postcard collection turns out to be worth something. Collect $40.', act: { kind: 'money', amount: 40 } },
      { text: 'Seven countries, one power adapter. It finally dies. Pay $20.', act: { kind: 'money', amount: -20 } },
      { text: 'Your phrasebook side hustle takes off. Collect $65.', act: { kind: 'money', amount: 65 } },
    ],
    surprise: [
      { text: 'You cross three time zones and bill for all of them. Collect $95.', act: { kind: 'money', amount: 95 } },
      { text: 'Jet lag. You pay for the same breakfast twice. Pay $30.', act: { kind: 'money', amount: -30 } },
      { text: 'The world tour continues. Move ahead 6 tiles.', act: { kind: 'moveBy', n: 6 } },
      { text: 'Your suitcase went on without you. Take the next flight to the nearest Airport.', act: { kind: 'nearest', target: 'airport', payMultiplier: 1 } },
    ],
  },
  worldwide: {
    treasure: [
      { text: 'Two extra countries, two extra stamps in the passport. A collector pays $50 for the old one.', act: { kind: 'money', amount: 50 } },
      { text: 'You learn to say thank you in nine languages. Tips improve. Collect $35.', act: { kind: 'money', amount: 35 } },
      { text: 'Your frequent flyer points finally add up to something. Collect $75.', act: { kind: 'money', amount: 75 } },
      { text: 'Excess baggage, again. Pay $40.', act: { kind: 'money', amount: -40 } },
    ],
    surprise: [
      { text: 'A bigger board means longer taxi rides. Pay $30.', act: { kind: 'money', amount: -30 } },
      { text: 'Mr. Worldwide himself retweets your itinerary. Collect $100.', act: { kind: 'money', amount: 100 } },
      { text: 'You fell asleep on the express train. Move ahead 6 tiles.', act: { kind: 'moveBy', n: 6 } },
      { text: 'Your visa paperwork is a mess. Sort it out in prison.', act: { kind: 'jail' } },
    ],
  },
  deathvalley: {
    treasure: [
      { text: 'Four superpowers, one board. Your war chest grows. Collect $80.', act: { kind: 'money', amount: 80 } },
      { text: 'You sell survival guides at the border. Collect $45.', act: { kind: 'money', amount: 45 } },
      { text: 'Heatstroke insurance pays out. Collect $60.', act: { kind: 'money', amount: 60 } },
      { text: 'Water is not free in Death Valley. Pay $35.', act: { kind: 'money', amount: -35 } },
    ],
    surprise: [
      { text: 'The strong eat first here. Collect $25 from every player.', act: { kind: 'collectEach', amount: 25 } },
      { text: 'You blinked. Pay each player $20.', act: { kind: 'payEach', amount: 20 } },
      { text: 'A sandstorm swallows the road. Go back 5 spaces.', act: { kind: 'moveBy', n: -5 } },
      { text: 'No mercy on this board. Pay $75.', act: { kind: 'money', amount: -75 } },
    ],
  },
  bharat: {
    treasure: [
      { text: 'Diwali bonus lands early. Collect $100.', act: { kind: 'money', amount: 100 } },
      { text: 'Your chai stall outside {street} has a queue around the corner. Collect $45.', act: { kind: 'money', amount: 45 } },
      { text: 'Wedding season. Three baraats, one band, your dhol. Collect $70.', act: { kind: 'money', amount: 70 } },
      { text: 'The monsoon finds the one leak you ignored. Pay $55.', act: { kind: 'money', amount: -55 } },
    ],
    surprise: [
      { text: 'Your train arrives on time and so do you. Advance to START and collect your salary.', act: { kind: 'moveTo', tile: 'start', collect: true } },
      { text: 'The auto driver refuses the meter. Pay $25.', act: { kind: 'money', amount: -25 } },
      { text: 'Your street food vlog goes viral. Collect $110.', act: { kind: 'money', amount: 110 } },
      { text: 'You jumped the railway queue. The aunties saw. Go to prison.', act: { kind: 'jail' } },
    ],
  },
  blitz: {
    treasure: [
      { text: 'Short board, fast money. Collect $60.', act: { kind: 'money', amount: 60 } },
      { text: 'You lapped the board before your tea went cold. Collect $40.', act: { kind: 'money', amount: 40 } },
      { text: 'No time to read the fine print. Pay $50.', act: { kind: 'money', amount: -50 } },
    ],
    surprise: [
      { text: 'Blitz rules: blink and you owe. Pay each player $10.', act: { kind: 'payEach', amount: 10 } },
      { text: 'Everything is closer here. Skip ahead 3 tiles.', act: { kind: 'moveBy', n: 3 } },
      { text: 'A rushed deal pays off. Collect $80.', act: { kind: 'money', amount: 80 } },
    ],
  },
  luckywheel: {
    treasure: [
      { text: 'The wheel likes you today. Collect $130.', act: { kind: 'money', amount: 130 } },
      { text: 'You bet on red. It came up whatever this is. Pay $40.', act: { kind: 'money', amount: -40 } },
      { text: 'Found: one lucky coin. Worth $25, apparently.', act: { kind: 'money', amount: 25 } },
      { text: 'A fortune teller charges you for good news. Pay $30.', act: { kind: 'money', amount: -30 } },
    ],
    surprise: [
      { text: 'Half this board is chance. So is this. Collect $150.', act: { kind: 'money', amount: 150 } },
      { text: 'The house always wins. Pay $65.', act: { kind: 'money', amount: -65 } },
      { text: 'Spin again. Move ahead 8 tiles.', act: { kind: 'moveBy', n: 8 } },
      { text: 'Your lucky streak draws a crowd. Collect $20 from every player.', act: { kind: 'collectEach', amount: 20 } },
    ],
  },
  random: {
    treasure: [
      { text: 'Nobody has ever played this board before. Charge admission. Collect $50.', act: { kind: 'money', amount: 50 } },
      { text: 'You drew the map yourself, badly. Pay a cartographer $35.', act: { kind: 'money', amount: -35 } },
      { text: 'First to lap a brand new board. Collect $60.', act: { kind: 'money', amount: 60 } },
    ],
    surprise: [
      { text: 'The dice built this board. They like you. Collect $100.', act: { kind: 'money', amount: 100 } },
      { text: 'The dice built this board. They do not like you. Pay $70.', act: { kind: 'money', amount: -70 } },
      { text: 'Uncharted territory ahead. Skip forward 5 tiles.', act: { kind: 'moveBy', n: 5 } },
    ],
  },
};

// ---- composition -------------------------------------------------------------
// The mix every deck aims for: about half money, a quarter movement, and the
// rest split between the social cards, repairs and the prison pair.
const QUOTAS = { money: 19, move: 9, social: 4, repairs: 2, getout: 1, jail: 1 };
const CATEGORY = {
  money: 'money', perProperty: 'money',
  moveTo: 'move', moveBy: 'move', nearest: 'move',
  collectEach: 'social', payEach: 'social',
  repairs: 'repairs', getout: 'getout', jail: 'jail',
};

// Local colour is welcome but must not drown the varied templates.
const FLAVOUR_CAP = 16;

function composeDeck(named, flavour, pools, ctx) {
  const seen = new Set();
  const cards = [];
  const used = { money: 0, move: 0, social: 0, repairs: 0, getout: 0, jail: 0 };
  const add = (card) => {
    if (!card || !card.text || seen.has(card.text)) return false;
    seen.add(card.text);
    cards.push({ text: card.text, act: card.act });
    used[CATEGORY[card.act.kind]]++;
    return true;
  };

  // House cards first — they are non-negotiable.
  for (const c of named) add(instantiate(c, ctx));

  // Then the board's own colour, up to the cap and within each quota.
  let flavourLeft = FLAVOUR_CAP;
  for (const entry of shuffle(flavour)) {
    if (!flavourLeft) break;
    const cat = CATEGORY[entry.act?.kind] ?? CATEGORY[instantiate(entry, ctx)?.act?.kind];
    if (!cat || used[cat] >= QUOTAS[cat]) continue;
    if (add(instantiate(entry, ctx))) flavourLeft--;
  }

  // Templates top up whatever each category still lacks.
  for (const [cat, quota] of Object.entries(QUOTAS)) {
    for (const entry of shuffle(pools[cat] || [])) {
      if (used[cat] >= quota) break;
      add(instantiate(entry, ctx));
    }
  }
  return cards;
}

/**
 * The one entry point: a Treasure and a Surprise deck cut for this board.
 * Country boards contribute their own deck as flavour; the built-in boards
 * use the FLAVOUR table; everything else runs on templates alone.
 */
export function buildDecks(map) {
  const ctx = deckContext(map);
  const local = FLAVOUR[map.id];
  return {
    treasure: composeDeck(NAMED_TREASURE, map.deck?.treasure || local?.treasure || [], TREASURE_POOL, ctx),
    surprise: composeDeck(NAMED_SURPRISE, map.deck?.surprise || local?.surprise || [], SURPRISE_POOL, ctx),
  };
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function shuffled(deck) {
  const cards = deck.map((c, i) => ({ ...c, id: i }));
  return shuffle(cards);
}
