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

// ---------------------------------------------------------------------------
// Quick-match tables seat "whoever else was queueing" — so whoever else was
// queueing has to look the part. This pool reads like an actual lobby: first
// names from here and everywhere, the usual crowd of handles with digits and
// underscores, some entries carrying the flag their player picked and most
// not bothering. An entry is a plain name, or [name, flag] when it wears one.

const IN = '🇮🇳';
const QUICK_POOL = [
  // First names, the way the room actually skews.
  ['Aarav', IN], 'Ishita', ['Dhruv', IN], 'Ananya', 'Kabir', ['Priya', IN],
  'Rohan', 'Sneha', ['Vihaan', IN], 'Meera', 'Arjun', ['Tanvi', IN],
  'Aditya', 'Kavya', ['Riya', IN], 'Kunal', 'Pooja', 'Varun',
  ['Divya', IN], 'Simran', 'Yash', ['Neha', IN], 'Shreya', 'Rahul',
  'Anjali', ['Nisha', IN], 'Sameer', 'Aisha', 'Vivek', ['Karan', IN],
  'Swati', 'Amit', 'Ritika', ['Sahil', IN], 'Tejas', 'Parth',
  'Sana', 'Bhavya', 'Irfan', ['Zara', IN], 'Farhan', 'Mahi',
  'Dev', ['Ishaan', IN], 'Avni', 'Reyansh', 'Myra', 'Advait',
  ['Kiara', IN], 'Rudra',
  // The rest of the world drops in too.
  'Mia', ['Ethan', '🇺🇸'], 'Sofia', ['Lucas', '🇧🇷'], 'Emma', 'Noah',
  ['Olivia', '🇬🇧'], 'Liam', 'Chloe', ['Mateo', '🇪🇸'], ['Hana', '🇯🇵'],
  ['Felix', '🇩🇪'], 'Nadia', ['Omar', '🇦🇪'], 'Elena', ['Marco', '🇮🇹'],
  'Yuki', 'Tariq', 'Lena', ['Diego', '🇲🇽'], ['Amara', '🇳🇬'], 'Jonas',
  'Ivy', ['Andrei', '🇷🇴'], 'Fatima', 'Sasha', ['Pedro', '🇵🇹'], 'Alina',
  'Kofi', ['Selim', '🇹🇷'], 'Greta', 'Rosa', ['Jin', '🇰🇷'], 'Tunde',
  'Petra', 'Musa', ['Lily', '🇦🇺'], 'Marcus', 'Anya', ['Theo', '🇫🇷'],
  ['Nour', '🇪🇬'], 'Bella', 'Erik', 'Freya', 'Milan', ['Tomas', '🇵🇱'],
  'Aria', 'Dara', 'Nico', ['Wei', '🇸🇬'],
  // And the half of every lobby that signed up as a username.
  ['rohan22', IN], 'mia_x', 'notlucky', 'pixelpete', 'ayush07', 'dice_dad',
  'snakeyes', ['rentfree', '🇺🇸'], 'luckyleena', 'ish_99', ['veer2005', IN],
  'xdhruvx', 'gg_riya', ['zainplays', '🇵🇰'], ['chai_break', IN],
  'tycoontina', 'brokeboi', 'om3ga', 'sunny004', ['kingkaran', IN],
  'justmeera', 'nova_kid', 'itzpriya', 'lowkeyluke', 'tanmay_11',
  'missrolls', 'diceyvibes', 'arnavgg', 'h0telking', ['paisawala', IN],
  'nidhi_23', 'turbo_tej', 'alexplays', 'board_boss', 'shauryax',
  ['megan_j', '🇬🇧'], ['rolltide7', '🇺🇸'], 'kavi2k', 'thezoyaa', 'muski_',
  ['devansh_m', IN], 'badluckbryn', 'ronny_101', 'seven11', 'aftabb',
  'hardikk', 'lostinrent',
];

const QUICK_IDENTITIES = QUICK_POOL.map((e) => (
  Array.isArray(e) ? { name: e[0], flag: e[1] } : { name: e, flag: '' }
));

/**
 * The same person queueing twice must not meet the same crew twice — that is
 * the fastest way to give the whole thing away. So the last forty identities
 * served sit out, process-wide across every table. Nothing is persisted: a
 * deploy reshuffles the town, which is fine, because so does a real evening.
 */
const RECENT_LIMIT = 40;
const recentlyServed = [];

/** One identity nobody at the table has, and nobody met a few games back. */
export function quickIdentity(takenNames = []) {
  const taken = new Set(takenNames);
  const fresh = QUICK_IDENTITIES.filter(
    (q) => !taken.has(q.name) && !recentlyServed.includes(q.name),
  );
  // The pool is big enough (140+ vs 40 resting) that this fallback should
  // never fire — it exists so a logic slip degrades to a repeat, not a crash.
  const pool = fresh.length ? fresh : QUICK_IDENTITIES.filter((q) => !taken.has(q.name));
  const found = pool[Math.floor(Math.random() * pool.length)]
    || { name: `player${Math.floor(1000 + Math.random() * 9000)}`, flag: '' };
  recentlyServed.push(found.name);
  if (recentlyServed.length > RECENT_LIMIT) {
    recentlyServed.splice(0, recentlyServed.length - RECENT_LIMIT);
  }
  return { ...found };
}
