// Treasure (chest) and Surprise (chance) card decks.
// Each card: { text, act: {...} }
//
// Action kinds:
//   money      { amount }                 - gain/lose from the bank
//   moveTo     { tile: 'start'|'vacation'|'prison'|index, collect: bool }
//   moveBy     { n }
//   nearest    { kind: 'airport'|'utility', payMultiplier }
//   jail                                   - straight to prison
//   getout                                 - keep a get-out-of-prison card
//   collectEach{ amount }                  - every other player pays you
//   payEach    { amount }                  - you pay every other player
//   repairs    { house, hotel }            - pay per building owned

export const TREASURE = [
  { text: 'Bank pays you a dividend of $50.', act: { kind: 'money', amount: 50 } },
  { text: 'Hospital fees. Pay $100.', act: { kind: 'money', amount: -100 } },
  { text: 'You inherit $100.', act: { kind: 'money', amount: 100 } },
  { text: 'Income tax refund. Collect $20.', act: { kind: 'money', amount: 20 } },
  { text: 'Life insurance matures. Collect $100.', act: { kind: 'money', amount: 100 } },
  { text: 'Pay school fees of $50.', act: { kind: 'money', amount: -50 } },
  { text: 'Receive $25 consultancy fee.', act: { kind: 'money', amount: 25 } },
  { text: 'Holiday fund matures. Receive $100.', act: { kind: 'money', amount: 100 } },
  { text: 'Advance to START and collect your salary.', act: { kind: 'moveTo', tile: 'start', collect: true } },
  { text: 'Get out of prison free. Keep this card.', act: { kind: 'getout' } },
  { text: 'You are caught dodging fares. Go to prison!', act: { kind: 'jail' } },
  { text: "It's your birthday. Collect $10 from every player.", act: { kind: 'collectEach', amount: 10 } },
  { text: 'Grand opera night. Collect $50 from every player.', act: { kind: 'collectEach', amount: 50 } },
  { text: "Doctor's fees. Pay $50.", act: { kind: 'money', amount: -50 } },
  { text: 'Sale of stock. You get $50.', act: { kind: 'money', amount: 50 } },
  { text: 'Street repairs. Pay $40 per house and $115 per hotel.', act: { kind: 'repairs', house: 40, hotel: 115 } },
  { text: 'You won second prize in a beauty contest. Collect $10.', act: { kind: 'money', amount: 10 } },
  { text: 'Time to relax. Head straight to Vacation.', act: { kind: 'moveTo', tile: 'vacation' } },
];

export const SURPRISE = [
  { text: 'Advance to START and collect your salary.', act: { kind: 'moveTo', tile: 'start', collect: true } },
  { text: 'Go to prison. Do not pass START, do not collect $200.', act: { kind: 'jail' } },
  { text: 'Advance to the nearest Airport and pay double rent.', act: { kind: 'nearest', target: 'airport', payMultiplier: 2 } },
  { text: 'Advance to the nearest Airport and pay double rent.', act: { kind: 'nearest', target: 'airport', payMultiplier: 2 } },
  { text: 'Advance to the nearest Utility. Pay 10x your dice roll.', act: { kind: 'nearest', target: 'utility', payMultiplier: 10 } },
  { text: 'Go back three spaces.', act: { kind: 'moveBy', n: -3 } },
  { text: 'The bank pays you $150.', act: { kind: 'money', amount: 150 } },
  { text: 'Pay a poor tax of $15.', act: { kind: 'money', amount: -15 } },
  { text: 'Your building loan matures. Collect $150.', act: { kind: 'money', amount: 150 } },
  { text: 'Get out of prison free. Keep this card.', act: { kind: 'getout' } },
  { text: 'You won a crossword competition. Collect $100.', act: { kind: 'money', amount: 100 } },
  { text: 'Speeding fine. Pay $50.', act: { kind: 'money', amount: -50 } },
  { text: 'General repairs. Pay $25 per house and $100 per hotel.', act: { kind: 'repairs', house: 25, hotel: 100 } },
  { text: 'You were elected chairman. Pay each player $50.', act: { kind: 'payEach', amount: 50 } },
  { text: 'Your flight is delayed. Take a vacation instead.', act: { kind: 'moveTo', tile: 'vacation' } },
  { text: 'Your stocks soar. Collect $200.', act: { kind: 'money', amount: 200 } },
  { text: 'Advance to the most expensive street on the board.', act: { kind: 'moveTo', tile: 'priciest', collect: true } },
  { text: 'A generous stranger hands you $75.', act: { kind: 'money', amount: 75 } },
];

export function shuffled(deck) {
  const cards = deck.map((c, i) => ({ ...c, id: i }));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
