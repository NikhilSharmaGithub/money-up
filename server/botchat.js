// What a bot says back when a person says something.
//
// banter.js covers the other direction — the lines a bot fires when the BOARD
// does something: rent landed, a set closed, somebody busted. This file is the
// other half of the conversation, and the two are kept apart because they fail
// differently. A missed board line is silence. A missed reply is a machine
// ignoring you, which reads far worse than saying nothing at all.
//
// There is no model behind this and there is not going to be one. A reply is
// chosen by reading two things: what the message was about, and what is
// actually true at the table at that second. Every template that names a fact
// is thrown away unless the fact is there to fill it — so a bot can only say
// "Aarav owes me 340" at a table where Aarav really does owe 340. That single
// rule is the whole design. It costs nothing and it cannot make things up.
//
// Everything handed in here is public at the table: names, cash, who owns
// what, whose turn it is, the open debt, what was bought last. Nothing a seat
// could not work out for itself is passed in, so a bot can never let slip what
// it privately thinks a street is worth, or what it was refused, or what is
// left in the deck.

/**
 * How long a bot "types" before its reply lands. A reply that appears the
 * instant you press send is the single most robotic thing a table can do, and
 * on a quick match the house players are not supposed to read as house
 * players. Exported so a test can wait exactly long enough and no longer.
 */
export const REPLY_DELAY_MIN = 900;
export const REPLY_DELAY_MAX = 2300;

/**
 * How often a table is allowed to answer, in milliseconds. Four numbers rather
 * than one, because there are four different ways for this to become a
 * nuisance:
 *
 *   TABLE (2.5s)     — two bots talking over each other after one message.
 *   BOT (9s)         — one bot answering everything and becoming the table's
 *                      spokesman while the other three sit mute.
 *   ADDRESSED (4s)   — the same, but shorter: being spoken to by name should
 *                      get an answer sooner than being spoken near.
 *   WINDOW (8/min)   — somebody pasting a wall of text and being buried in
 *                      replies. This one is a hard ceiling; nothing beats it.
 *
 * They are deliberately slower than a person can type. Being answered by every
 * bot at once is what gives a table away.
 */
export const REPLY_GAP_TABLE = 2500;
export const REPLY_GAP_BOT = 9000;
export const REPLY_GAP_ADDRESSED = 4000;
export const REPLY_WINDOW = 60000;
export const REPLY_WINDOW_MAX = 8;

// ------------------------------------------------------------ reading them --

/**
 * Hindi written in Latin letters — the way half this table actually talks.
 * Matching any of these flips the reply to the Hinglish pool, so somebody who
 * types "kitne ka doge" is not answered in careful English. "hi" is left out
 * on purpose: it is a greeting far more often than it is the Hindi word.
 */
const HINGLISH = /(?:[\u0900-\u097F])|\b(?:kya|kyu|kyun|hai|hain|nahi|nahin|nai|karo|karega|karke|kaise|kaun|kitna|kitne|mera|meri|tera|teri|apna|bhai|yaar|yar|acha|achha|thik|theek|paisa|paise|dedo|dega|dena|lelo|lena|chalo|chal|abhi|matlab|jaldi|ruko|haan|bahut|bohot|thoda|zyada|arre|arey|phir|sahi|mast|bas|khatam)\b/i;

/**
 * What the message was about. Order is the whole trick: the narrow, unmistakable
 * readings are asked first and the broad ones last, so "kitna paisa hai" is a
 * question about money rather than a greeting that happens to contain a vowel.
 * First pattern to match wins; nothing matching is ordinary chat.
 */
const INTENTS = [
  ['gg', /\b(?:gg|wp|gh|good game|well played|rematch|ek aur|one more|play again)\b/i],
  ['greet', /^\s*(?:hi+|hey+|hello+|yo+|sup|wassup|hola|namaste|namaskar|salaam|assalam|gm|good (?:morning|evening|afternoon|night)|kaise ho|kya haal|kya chal|hru)\b/i],
  ['turnQ', /\b(?:whose turn|who(?:'?s| is) turn|kiski turn|kiska turn|turn kiski|turn kiska|my turn|meri turn|who(?:'?s| is) (?:next|playing|up))\b/i],
  ['moneyQ', /\b(?:how much (?:money|cash|do you have)|kitna paisa|kitne paise|kitna cash|your balance|how rich)\b/i],
  ['leaderQ', /\b(?:who(?:'?s| is)? winning|who(?:'?s| is) ahead|kaun jeet|kaun aage|kon jeet|leading|the leader)\b/i],
  ['trade', /\b(?:trade|swap|deal|exchange|offer|sell|selling|buy from you|sauda|bech|becho|bechega|bechoge|dega|doge|de do|dedo|le lo|lelo|kitne ka|kitne me|your price|name your price)\b/i],
  ['rent', /\b(?:rent|kiraya|kiraaya|expensive|mehnga|mehanga|costly|robbery|daylight|loot|luta|chuna)\b/i],
  ['broke', /\b(?:broke|bankrupt|no money|out of (?:money|cash)|paise nahi|paisa nahi|kangal|khatam ho|mortgage|cant pay|can'?t pay)\b/i],
  ['jail', /\b(?:jail|prison|jel|locked up|arrest)\b/i],
  ['luck', /\b(?:dice|roll(?:ed|s)? (?:bad|terrible)|unlucky|bad luck|luck|kismat|kismet|rigged|cheat|cheating|fix(?:ed)?|scripted|why me|always me)\b/i],
  ['hurry', /\b(?:jaldi|hurry|faster|so slow|too slow|afk|are you (?:there|alive)|so gaye|sote|kitni der|still waiting|waiting for)\b/i],
  ['afk', /\b(?:brb|afk|ruko|ruk ja|one min|1 min|2 min|two min|hold on|back in|be right back)\b/i],
  ['help', /\b(?:how (?:do|does|to)|kaise khel|kaise hota|what (?:is|are|does)|kya hota|kya h(?:ai|e)|matlab kya|rules|samjha|explain)\b/i],
  ['taunt', /\b(?:noob|nub|ez|easy|trash|weak|bakwas|bekar|loser|hopeless|nikamma|you suck|get good)\b/i],
  ['thanks', /\b(?:thanks|thank you|thx|tysm|ty\b|shukriya|dhanyavad)\b/i],
  ['sorry', /\b(?:sorry|my bad|apolog|galti|maaf)\b/i],
  // "nice" on its own is praise; "the weather is nice" is somebody talking
  // about the weather, so the loose form has to stay anchored.
  ['praise', /^\s*(?:nice|great|badhiya|mast|wah)\b[\s.]*$|\b(?:nice (?:one|move|play|roll|trade|buy|deal|set)|good (?:one|move|play|call)|well played|shabash|respect|clever play)\b/i],
  ['laugh', /(?:\blol\b|\blmao\b|\brofl\b|haha|hehe|hahah|\bxd\b|😂|🤣)/i],
  ['agree', /^\s*(?:ok(?:ay)?|k|haan|han|ha|yes|yep|yup|sure|done|sahi|thik|theek|achha|acha|fine)\b/i],
];

/** What was said, as far as templates need to care. */
export function readMessage(raw) {
  const text = String(raw ?? '').trim();
  const found = INTENTS.find(([, re]) => re.test(text));
  return {
    intent: found ? found[0] : 'chat',
    hinglish: HINGLISH.test(text),
    question: /\?\s*$/.test(text) || /^\s*(?:who|what|when|where|why|how|kaun|kya|kab|kahan|kaise|kitna|kitne)\b/i.test(text),
  };
}

/**
 * Names people actually type. A seat called "chai_break" gets answered by
 * "chai", "rohan22" by "rohan", "Lucky Seth" by "lucky" or "seth" — because
 * that is how somebody halfway through a game types it. Three letters is the
 * floor: shorter fragments collide with ordinary words.
 */
function nameKeys(name) {
  const out = new Set();
  const full = String(name || '').toLowerCase().trim();
  if (full.length >= 3) out.add(full);
  for (const part of full.split(/[\s_\-.]+/)) {
    if (part.length >= 3) out.add(part);
    const bare = part.replace(/\d+$/, '');
    if (bare.length >= 3) out.add(bare);
  }
  return [...out];
}

/**
 * Who, if anyone, was spoken to by name. The longest match wins, so "Aarav" on
 * a table that also seats "Aaravi" answers the right person, and the speaker's
 * own name never counts — people talk about themselves constantly.
 */
export function whoIsAddressed(raw, people, speakerName = '') {
  const text = String(raw ?? '').toLowerCase();
  if (!text) return null;
  const mine = new Set(nameKeys(speakerName));
  let best = null;
  for (const person of people || []) {
    for (const key of nameKeys(person.name)) {
      if (mine.has(key)) continue;
      // Word-shaped only: "kiran" must not fire inside "kirana". Every
      // occurrence is tried, because the first one may be the one buried in a
      // longer word while the real mention comes later in the line.
      for (let at = text.indexOf(key); at !== -1; at = text.indexOf(key, at + 1)) {
        if (/[a-z0-9]/.test(text[at - 1] || '')) continue;
        if (/[a-z0-9]/.test(text[at + key.length] || '')) continue;
        if (!best || key.length > best.key.length) best = { id: person.id, key };
        break;
      }
    }
  }
  return best ? best.id : null;
}

// -------------------------------------------------------------- what to say --
//
// Every bucket is split into the English pool and the Hinglish one, and a
// message written in Hinglish is answered from the Hinglish pool where it has
// something to say. Placeholders are filled from facts that are true right
// now; a template naming a fact the table cannot supply is simply never picked,
// which is what keeps a bot honest without a single extra check.

const REPLIES = {
  greet: {
    en: [
      'hey {name}',
      'alright {name}',
      "hi {name}, you've walked in on {turn}'s turn",
      'hello {name}. {leader} is ahead if you were wondering',
      'hey {name}, grab a seat, {turn} is rolling',
      'good to see you {name}. {left} streets still unsold',
    ],
    hi: [
      'haan {name}',
      'arre {name}, aa gaye',
      'hi {name}, abhi {turn} ki turn hai',
      '{name} aao, {leader} aage chal raha hai',
    ],
  },

  turnQ: {
    en: ['{turn} is up', "it's on {turn}", '{turn}, and then round to you', '{turn} is rolling right now'],
    hi: ['{turn} ki turn hai', 'abhi {turn} khel raha hai', '{turn} ka number hai, uske baad tum'],
  },
  turnMe: {
    en: ['mine. one second', 'me, i am thinking', 'me. rolling now'],
    hi: ['meri turn hai, ek second', 'main hi hoon, soch raha hoon'],
  },
  turnYou: {
    en: ['you {name}. we are all waiting', 'yours. go on', 'you are up {name}'],
    hi: ['tumhari hi turn hai {name}', 'tum hi ho, chalo jaldi'],
  },

  leaderQ: {
    en: [
      '{leader} on paper. {tail} is the one i would not write off',
      '{leader}, comfortably. ask again in ten turns',
      '{leader} is ahead. i am not, in case that was the real question',
      '{leader} is counting money, {tail} is counting problems',
    ],
    hi: ['{leader} aage hai abhi', '{leader} jeet raha hai, {tail} pichhe hai', 'paise {leader} ke paas hain, mere paas sirf {cash}'],
  },
  // The same question when the answer is "me" or "you". Split out rather than
  // swapping a pronoun into the line above, because "{leader} is counting
  // money" with i or you in it comes out as broken English.
  leaderMe: {
    en: ['me, if we are being honest', 'me. ask again after {turn} rolls', 'me on paper. {tail} is the one to watch', 'i am, and i am as surprised as you'],
    hi: ['main hi hoon abhi', 'filhaal main, dekhte hain aage kya hota hai', 'main, par abhi kuch pakka nahi'],
  },
  leaderYou: {
    en: ['you are {name}, and you know it', 'you. which is why nobody is trading with you', 'you are ahead {name}. enjoy it while it lasts'],
    hi: ['tum hi ho {name}', 'tum aage ho, isiliye koi trade nahi kar raha', 'abhi tum {name}, dekhte hain'],
  },

  moneyQ: {
    en: [
      'i am on {cash}. not enough for what i want',
      '{cash}, and most of it is spoken for',
      '{cash}. ask {leader}, that is where the money went',
    ],
    hi: ['{cash} bache hain mere paas', 'mere paas {cash} hai, bas', '{cash}. sab paisa {leader} ke paas chala gaya'],
  },

  // Somebody wants to deal and this bot is one street short of a colour that
  // the person they are talking to happens to be holding.
  trade: {
    en: [
      '{name} i want {yourWant}. name a number',
      'give me {yourWant} and take whatever you think it is worth, {name}',
      '{yourWant} does nothing for you on its own {name} — i will pay over the odds',
      'yes. {yourWant}. everything else is negotiable',
      '{name} {yourWant} completes {yourWantGroup} for me and we both know it, so make it expensive',
      'sent it over — {yourWant} your side, cash mine. have a look {name}',
    ],
    hi: [
      '{name} mujhe {yourWant} chahiye, price bolo',
      '{yourWant} de do {name}, paisa jitna bolo',
      '{name} {yourWant} tumhare kisi kaam ka nahi, mujhe {yourWantGroup} mil jayega',
      'haan, {yourWant} ke liye baat karte hain {name}',
    ],
  },
  // Same intent, nothing this person holds that the bot needs.
  tradeNone: {
    en: [
      'nothing of yours i need right now {name}. ask me when the board fills up',
      'you are not holding anything that finishes a colour for me {name}',
      'i would rather buy from {leader}, no offence {name}',
      'not yet {name}. get something i am short of first',
    ],
    hi: [
      '{name} abhi tumhare paas mera kaam ka kuch nahi hai',
      'baad me {name}, abhi kuch chahiye hi nahi',
      '{name} pehle kuch aisa lo jo mera set pura kare',
    ],
  },

  rent: {
    en: [
      'rent is the only part of this game that works {name}',
      '{debtor} owes {creditor} {debt} right now, so yes, it adds up',
      'you say robbery, i say {set} was an investment',
      'wait until there are houses on it {name}',
      'cheap compared to what {leader} is charging',
    ],
    hi: [
      'kiraya hi to kamai hai {name}',
      '{debtor} ko {creditor} ko {debt} dena hai, abhi to shuru hua hai',
      'abhi to ghar bhi nahi bane {name}',
    ],
  },

  broke: {
    en: [
      'mortgage something {name}, everybody does it',
      'i have {cash} and a lot of optimism',
      'sell me a street {name} and the problem goes away',
      'ask {leader} for a loan, they can afford to be generous',
      'it happens. {tail} has been there all game',
    ],
    hi: [
      'kuch mortgage kar do {name}, sabhi karte hain',
      'mere paas bhi sirf {cash} hai',
      '{name} ek street bech do, paisa aa jayega',
    ],
  },

  jail: {
    en: [
      'safest place on the board with {leader} building',
      'three turns of not paying rent {name}, could be worse',
      'i would stay in there if i were you',
      'jail is fine. jail with {left} streets unsold is not',
    ],
    hi: [
      'jail me rehna hi thik hai abhi',
      'teen turn koi kiraya nahi dena padega {name}',
      'bahar aakar {leader} ko paisa hi dena hai',
    ],
  },

  luck: {
    en: [
      'the dice are not personal {name}, they just look like it',
      'i rolled my way into {boughtTile} so i am not going to complain today',
      'skill is deciding what to do with a bad roll. mostly',
      '{leader} is not lucky, {leader} just buys everything',
      'we are all rolling the same numbers {name}',
    ],
    hi: [
      'dice kisi ka sagaa nahi hota {name}',
      'kismat nahi, {leader} sab kuch khareed raha hai',
      'sab wahi number nikal rahe hain {name}',
    ],
  },

  hurry: {
    en: [
      'i am here. {turn} is the one thinking',
      'one second {name}, i am doing sums',
      'go on then {turn}',
      'nearly there. {left} streets left and then it gets quick',
    ],
    hi: [
      'haan haan aa raha hoon',
      '{turn} soch raha hai, main nahi',
      'ek second {name}',
    ],
  },

  afk: {
    en: ['take your time {name}', 'we will still be here', 'go, {turn} is slow anyway', 'fine, i will buy things while you are gone'],
    hi: ['aaram se {name}', 'koi baat nahi, jao', 'theek hai, hum hain yahi'],
  },

  help: {
    en: [
      'buy the cheap colours early {name}, the expensive ones bankrupt you',
      'a full colour is worth three loose streets. that is the whole game',
      'ask for a trade before you need it {name}',
      'mortgage before you go bankrupt, not after',
      '{leader} is doing it right if you want something to copy',
    ],
    hi: [
      'pura colour lo {name}, alag alag street ka kuch faida nahi',
      'sasti wali pehle lo, mehngi baad me',
      'bankrupt hone se pehle mortgage kar lo',
      '{leader} ko dekho, wahi sahi khel raha hai',
    ],
  },

  taunt: {
    en: [
      '{leader} is winning {name}, and it is not you',
      'say that again when you own a colour',
      'noted. i will remember that when you land on {set}',
      'big words with {left} streets still unbought',
      'ok. {turn} is rolling, we will see',
    ],
    hi: [
      'jeet {leader} raha hai {name}, tum nahi',
      'pehle ek colour pura karo phir bolna',
      'yaad rakhunga, {set} pe aana zaroor',
    ],
  },

  thanks: {
    en: ['any time {name}', 'do not thank me yet', 'thank me after you land on {set}', 'all part of the service'],
    hi: ['koi baat nahi {name}', 'abhi shukriya mat bolo', '{set} pe aana, phir bolna'],
  },

  sorry: {
    en: ['nothing to be sorry about {name}', 'it is a board game, relax', 'you will make it back off {tail}', 'happens to all of us'],
    hi: ['koi baat nahi {name}', 'chalta hai yaar', 'wapas mil jayega'],
  },

  praise: {
    en: ['ha, thanks {name}', 'i have been saving that one', 'say that to {leader}, they earned it more', 'it looks better than it is'],
    hi: ['shukriya {name}', 'arre bas thoda sa', '{leader} ko bolo, wo zyada acha khel raha hai'],
  },

  laugh: {
    en: ['ha', 'it is funnier when it is not your money', 'wait for the rent', '{tail} is not laughing'],
    hi: ['haha sahi hai', 'kiraya aane do phir hasna', 'ha ha'],
  },

  agree: {
    en: ['right', 'good. {turn} is up then', 'settled', 'ok. {yourWant} still on the table if you change your mind'],
    hi: ['theek hai', 'haan chalo', 'sahi hai, {turn} ki turn'],
  },

  gg: {
    en: ['gg {name}', 'gg, good board', 'gg. {leader} earned that', 'gg all, i want another one'],
    hi: ['gg {name}', 'gg, acha game tha', 'gg, ek aur khelte hain'],
  },

  // A question nobody wrote a rule for. Answer it as a player would: by
  // pointing at whatever is actually happening.
  question: {
    en: [
      'no idea {name}. ask {leader}, they are the one winning',
      'depends on whether {turn} buys it',
      'honestly {name}, i am only watching {want}',
      'ask me after this turn',
      'i would say {leader}, but i would say that about everything today',
      '{tileFree} if you are asking what to buy',
      'not {tile}, {tileOwner} already has that one',
    ],
    hi: [
      'pata nahi {name}, {leader} se poocho',
      '{turn} ke khelne ke baad batata hoon',
      'main to bas {want} pe nazar rakhe hue hoon',
      '{tileFree} le lo, abhi khali hai',
    ],
  },

  // Ordinary chat. Still anchored to something real, because a line about the
  // board is always a better answer than a line about nothing.
  chat: {
    en: [
      'fair enough {name}. {turn} is up though',
      '{boughtBy} taking {boughtTile} changed my whole plan',
      'true. {leader} is still running away with it',
      'i hear you {name}. i am still short of {want}',
      '{debtor} owes {creditor} {debt}, that is what i am watching',
      'possibly. {left} streets left to argue over',
      'sure. {set} is paying for itself now, that is the part i like',
      'you are not wrong {name}',
      '{tail} has had a rough one, to be fair',
      'the pot is on {pot}, somebody is going to enjoy that',
      'funny you mention {tile}, {tileOwner} has been sitting on it all game',
      '{tileFree} is still unbought if anyone is listening',
    ],
    hi: [
      'sahi bola {name}, waise {turn} ki turn hai',
      '{boughtBy} ne {boughtTile} le liya, poora plan kharab',
      'haan, {leader} bahut aage nikal gaya',
      'mujhe to bas {want} chahiye {name}',
      '{debtor} ko {creditor} ko {debt} dena hai, wahi dekh raha hoon',
      '{left} street abhi bhi khali padi hain',
      '{tile} to {tileOwner} ke paas hai',
      '{tileFree} abhi tak kisi ne li hi nahi',
    ],
  },

  // The floor. Nothing here names a fact, so there is always something to say,
  // and it is short enough to pass for somebody half paying attention.
  shrug: {
    en: ['fair', 'ha, ok {name}', 'you might be right {name}', 'hm'],
    hi: ['theek hai {name}', 'haan sahi', 'hmm'],
  },
};

const rand = (list) => list[Math.floor(Math.random() * list.length)];

/** Fill the slots, and say whether the template survived it. */
const fill = (tpl, facts) => tpl.replace(/\{(\w+)\}/g, (m, k) => (
  facts[k] === undefined || facts[k] === null || facts[k] === '' ? m : String(facts[k])
));
const complete = (text) => !/\{\w+\}/.test(text);

/**
 * One line from a bucket: only templates every fact supports, preferring ones
 * this table has not used lately so two games do not read the same.
 */
function pickLine(bucket, hinglish, facts, recent) {
  const pool = REPLIES[bucket];
  if (!pool) return null;
  const order = hinglish ? [pool.hi, pool.en] : [pool.en, pool.hi];
  for (const list of order) {
    const usable = (list || []).filter((tpl) => complete(fill(tpl, facts)));
    if (!usable.length) continue;
    const fresh = usable.filter((tpl) => !recent.includes(tpl));
    const tpl = rand(fresh.length ? fresh : usable);
    return { template: tpl, text: fill(tpl, facts) };
  }
  return null;
}

/**
 * Which bucket answers this message. Usually the intent itself — the exceptions
 * are the handful whose answer depends on WHO, not on what was typed. "Who is
 * winning" needs a different sentence when the honest answer is "me" or "you",
 * because a pronoun dropped into a third-person line comes out as nonsense.
 *
 * When nobody is clearly in front there is no leader to name at all; every
 * leaderQ template wants one, so they are all unusable and the caller's
 * fallback picks up an ordinary line instead.
 */
function bucketFor(read, facts) {
  if (read.intent === 'trade') return facts.yourWant ? 'trade' : 'tradeNone';
  if (read.intent === 'leaderQ' && facts.leaderIs === 'me') return 'leaderMe';
  if (read.intent === 'leaderQ' && facts.leaderIs === 'you') return 'leaderYou';
  if (read.intent === 'turnQ' && facts.turnIs === 'me') return 'turnMe';
  if (read.intent === 'turnQ' && facts.turnIs === 'you') return 'turnYou';
  if (read.intent === 'chat' && read.question) return 'question';
  return read.intent;
}

/**
 * Who answers, when nobody was named. In order: the bot this message is about
 * (it holds what was mentioned, or it is owed money by the speaker), then the
 * bot whose turn it is, then whoever has been quiet longest. The last one is
 * what stops a single bot becoming the table's spokesman.
 */
function chooseBot(scene, read) {
  const alive = scene.bots.filter((b) => !b.bankrupt);
  const pool = alive.length ? alive : scene.bots;
  const by = (test) => pool.find(test);
  return (
    (scene.tileHit && by((b) => b.id === scene.tileHit.ownerId))
    || (read.intent === 'trade' && by((b) => b.needs.some((n) => n.holderId === scene.speaker.id)))
    || (scene.debt && by((b) => b.id === scene.debt.creditorId && scene.debt.debtorId === scene.speaker.id))
    || (scene.turn && by((b) => b.id === scene.turn.id))
    || [...pool].sort((a, b) => (a.spokeAt || 0) - (b.spokeAt || 0))[0]
    || null
  );
}

/**
 * Everything a template may name, and nothing that is not true.
 *
 * The one rule that matters here: a fact pointing at the speaker or at the bot
 * itself is dropped rather than swapped for a pronoun. "{leader} is counting
 * money" with an "i" or a "you" in the hole comes out as broken English, and a
 * bot with bad grammar is worse than a bot with nothing to say. Dropping it
 * makes those templates unusable and something else gets picked; the handful
 * of lines that genuinely need to say "me" live in their own bucket.
 */
function factsFor(scene, bot) {
  // Two kinds of want: the street this particular person is holding (which is
  // what a trade is actually about) and any street at all (fine to grumble
  // about in passing).
  const yours = bot.needs.find((n) => n.holderId === scene.speaker.id) || null;
  const any = yours || bot.needs[0] || null;
  // Neither of the two people in this exchange may be named in the third
  // person; anyone else at the table may.
  const other = (name) => (name === bot.name || name === scene.speaker.name ? undefined : name);
  const notSelf = (name) => (name === bot.name ? undefined : name);
  const who = (name) => (name === bot.name ? 'me' : name === scene.speaker.name ? 'you' : name ? 'other' : null);

  return {
    name: scene.speaker.name,
    bot: bot.name,
    cash: bot.cash,
    turn: other(scene.turn?.name),
    turnIs: who(scene.turn?.name),
    leader: other(scene.leader?.name),
    leaderIs: who(scene.leader?.name),
    tail: other(scene.tail?.name),
    left: scene.left || undefined,
    pot: scene.pot || undefined,
    set: bot.sets[0],
    want: any?.tileName,
    yourWant: yours?.tileName,
    yourWantGroup: yours?.groupName,
    boughtBy: notSelf(scene.lastBuy?.byName),
    boughtTile: scene.lastBuy && notSelf(scene.lastBuy.byName) ? scene.lastBuy.tileName : undefined,
    // "Nikhil owes me $340" is how a person says this out loud, so the
    // creditor is the one slot where naming yourself reads correctly.
    debtor: notSelf(scene.debt?.debtorName),
    creditor: scene.debt?.creditorName === bot.name ? 'me' : scene.debt?.creditorName,
    debt: scene.debt?.amount,
    tile: scene.tileHit?.ownerId ? scene.tileHit.name : undefined,
    tileOwner: scene.tileHit?.ownerId ? notSelf(scene.tileHit.ownerName) : undefined,
    tileFree: scene.tileHit && !scene.tileHit.ownerId ? scene.tileHit.name : undefined,
  };
}

/**
 * Work out who replies and what they say, or null for "let it pass".
 *
 * Pure: the caller owns every timer, every cooldown and the actual sending. It
 * is written that way so the whole of this can be exercised by a test a
 * thousand times over without a table, a socket or a clock.
 */
export function planReply(scene) {
  if (!scene?.bots?.length || !scene.speaker) return null;
  const read = readMessage(scene.text);
  const addressedId = whoIsAddressed(scene.text, scene.bots, scene.speaker.name);
  const bot = addressedId
    ? scene.bots.find((b) => b.id === addressedId)
    : chooseBot(scene, read);
  if (!bot) return null;

  const facts = factsFor(scene, bot);
  const recent = scene.recent || [];
  const line = pickLine(bucketFor(read, facts), read.hinglish, facts, recent)
    || pickLine('chat', read.hinglish, facts, recent)
    || pickLine('shrug', read.hinglish, facts, recent);
  if (!line) return null;

  // "Kiran, trade?" should be able to produce an actual offer rather than a
  // line about one — but only when this person really is sitting on the street
  // that finishes a colour, which is the same test the template just passed.
  const offerTo = read.intent === 'trade'
    && bot.needs.some((n) => n.holderId === scene.speaker.id)
    ? scene.speaker.id : null;

  return {
    botId: bot.id,
    line: line.text,
    template: line.template,
    intent: read.intent,
    addressed: !!addressedId,
    offerTo,
  };
}
