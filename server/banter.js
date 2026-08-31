// What the table sounds like: the lines bots type, and the filter every
// message passes through on its way in.
//
// Bot chatter is deliberately sparse and reactive. A bot talks when something
// happened — it landed a big rent, it wants a street, someone busted — never
// on a timer, because filler chat is the fastest way to look like a machine.

// ------------------------------------------------------------------ banter --
// {name} is the other player, {tile} / {mine} / {yours} are street names.

const LINES = {
  greet: [
    'gl hf', 'good luck all', 'lets go 🎲', 'may the dice be kind',
    'first time on this board, be gentle',
  ],
  bigRentTaken: [
    'thank you 🙏', 'rent day is my favourite day', 'pleasure doing business',
    'that one pays for itself now', 'ka-ching',
  ],
  bigRentPaid: [
    'ouch', 'brutal', 'that hurt more than it should', 'ok that was expensive',
    'i walked right into it',
  ],
  setComplete: [
    'set complete 😏 houses incoming', 'thats the set — rent goes up from here',
    'finally. building on that tonight',
  ],
  bust: [
    'gg {name}', 'gg wp {name}', 'unlucky {name}', '{name} fought well',
  ],
  win: ['gg all', 'gg wp everyone', 'good games 🙌'],
  lost: ['gg', 'well played', 'gg, good board'],
  // Asking for a street, straight up.
  wantTile: [
    'anyone selling {tile}? paying over the odds',
    '{name} that {tile} is doing nothing for you — name your price',
    'i need {tile}, make me pay for it',
  ],
  // The mutually-useful swap — the one that actually gets accepted.
  swap: [
    "{name} i'll give you {yours} for {mine} — we both make sets, everyone wins",
    "{name} straight swap? {yours} your way, {mine} mine. we both walk away with a colour",
    "{name} that {mine} is worth nothing to you alone. take {yours} for it and we both build",
  ],
  // Pressure, the friendly kind.
  nudge: [
    "{name} you're miles ahead already, throw me a bone here",
    'last offer before i start building, then it gets pricey for everyone',
    "come on {name}, it's a fair deal and you know it",
    "i'm not winning this either way, might as well trade",
  ],
  accept: ['done ✅', 'deal', 'works for me', 'taken 🤝'],
  decline: [
    'nah, too rich for me', 'cant do that one', 'not this time',
    'sweeten it and ask again',
  ],
  jail: ['well this is embarrassing', 'see you all in three turns', 'prison arc'],
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** One line, with {name}/{tile}/{mine}/{yours} filled in. */
export function banter(kind, vars = {}) {
  const list = LINES[kind];
  if (!list) return null;
  return pick(list).replace(/\{(\w+)\}/g, (m, key) => vars[key] ?? m);
}

// ------------------------------------------------------------------ filter --
// Masking, not blocking: the message still lands, the word is just starred
// out, so nobody has to guess why their line vanished.

const BAD_WORDS = new Set([
  'fuck', 'fucker', 'fucking', 'fucked', 'motherfucker', 'shit', 'shite',
  'bullshit', 'bitch', 'bitches', 'bastard', 'asshole', 'arsehole', 'cunt',
  'dick', 'dickhead', 'prick', 'cock', 'pussy', 'slut', 'whore', 'wanker',
  'twat', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'rape',
  'rapist', 'chutiya', 'chutiye', 'madarchod', 'behenchod', 'bhenchod',
  'bhosdike', 'bhosda', 'gaand', 'gandu', 'lauda', 'lund', 'randi', 'harami',
  'kutta', 'kutiya', 'kamina', 'kamine', 'saala', 'chodu', 'jhaat',
]);

/** Letters people swap in to sneak a word past a filter. */
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

/**
 * Normalise a token the way a reader's eye does: unswap leetspeak, drop
 * padding characters, and collapse "fuuuuck" back to "fuck". Only used for
 * matching — the original text is what gets masked, so nothing else shifts.
 */
function normalise(word) {
  const swapped = word.toLowerCase().replace(/[0-9@$!|]/g, (c) => LEET[c] ?? c);
  const letters = swapped.replace(/[^a-z]/g, '');
  return letters.replace(/(.)\1{2,}/g, '$1$1').replace(/(.)\1/g, '$1');
}

const isBad = (token) => {
  const n = normalise(token);
  if (!n) return false;
  if (BAD_WORDS.has(n)) return true;
  // "fuuuck"/"fuck!!" collapse to the same stem, so also try the un-deduped form.
  const loose = token.toLowerCase().replace(/[0-9@$!|]/g, (c) => LEET[c] ?? c).replace(/[^a-z]/g, '');
  return BAD_WORDS.has(loose);
};

/**
 * Star out anything on the list. Word-shaped runs only, so "Scunthorpe" and
 * "class" survive — the point is to take the sting out of chat, not to
 * censor half the dictionary.
 */
export function cleanText(text) {
  return String(text ?? '').replace(/[\p{L}\p{N}@$!|]+/gu, (token) => (
    isBad(token) ? '*'.repeat(token.length) : token
  ));
}

/** True when a name is nothing but a masked slur — those get replaced wholesale. */
export const isAllMasked = (text) => /^\*+$/.test(String(text).trim());
