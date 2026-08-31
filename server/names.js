// Nobody should be blocked at the door because they can't think of a nickname.
// These read like table names, not like usernames — two words, always short
// enough for a player chip.

const ADJECTIVES = [
  'Lucky', 'Bold', 'Sneaky', 'Royal', 'Swift', 'Golden', 'Silent', 'Cheeky',
  'Grand', 'Wild', 'Clever', 'Rowdy', 'Fancy', 'Iron', 'Velvet', 'Turbo',
  'Chill', 'Mighty', 'Sunny', 'Rogue', 'Neon', 'Cosmic', 'Rapid', 'Jolly',
];

const NOUNS = [
  'Tycoon', 'Baron', 'Mogul', 'Landlord', 'Trader', 'Broker', 'Dealer',
  'Hustler', 'Duke', 'Tiger', 'Falcon', 'Panda', 'Rocket', 'Comet', 'Otter',
  'Badger', 'Cobra', 'Yeti', 'Ninja', 'Chacha', 'Seth', 'Raja', 'Nawab', 'Boss',
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Two words, 16 characters max — the same cap the nickname field enforces. */
export function randomName() {
  for (let tries = 0; tries < 12; tries++) {
    const name = `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
    if (name.length <= 16) return name;
  }
  return 'Lucky Seth';
}
