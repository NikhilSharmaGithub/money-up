// The MoneyMove store catalog. Everything is a cosmetic — never pay-to-win:
// token skins replace the coloured disc on the board, avatars replace the
// initial in the player chip. Prices fit the 1–2 coins-per-win economy.

export const STORE_ITEMS = [
  // ---- token skins (your piece on the board) ----
  { id: 'tok-car', kind: 'token', name: 'Racer', emoji: '🚗', price: 3 },
  { id: 'tok-hat', kind: 'token', name: 'Top Hat', emoji: '🎩', price: 3 },
  { id: 'tok-dog', kind: 'token', name: 'Doggo', emoji: '🐕', price: 4 },
  { id: 'tok-ship', kind: 'token', name: 'Steamer', emoji: '🚢', price: 4 },
  { id: 'tok-rocket', kind: 'token', name: 'Rocket', emoji: '🚀', price: 5 },
  { id: 'tok-haathi', kind: 'token', name: 'Haathi', emoji: '🐘', price: 5 },
  { id: 'tok-flame', kind: 'token', name: 'On Fire', emoji: '🔥', price: 6 },
  { id: 'tok-crown', kind: 'token', name: 'Crown', emoji: '👑', price: 8 },
  { id: 'tok-gem', kind: 'token', name: 'Kohinoor', emoji: '💎', price: 10 },
  { id: 'tok-dragon', kind: 'token', name: 'Dragon', emoji: '🐉', price: 12 },

  // ---- avatars (your face in the player chip) ----
  { id: 'av-cool', kind: 'avatar', name: 'Shades', emoji: '😎', price: 4 },
  { id: 'av-cowboy', kind: 'avatar', name: 'Cowboy', emoji: '🤠', price: 4 },
  { id: 'av-robot', kind: 'avatar', name: 'Robo', emoji: '🤖', price: 4 },
  { id: 'av-alien', kind: 'avatar', name: 'Alien', emoji: '👽', price: 5 },
  { id: 'av-tiger', kind: 'avatar', name: 'Sher', emoji: '🐯', price: 5 },
  { id: 'av-panda', kind: 'avatar', name: 'Panda', emoji: '🐼', price: 5 },
  { id: 'av-fox', kind: 'avatar', name: 'Chalaak', emoji: '🦊', price: 5 },
  { id: 'av-wizard', kind: 'avatar', name: 'Jaadugar', emoji: '🧙', price: 6 },
  { id: 'av-devil', kind: 'avatar', name: 'Shaitan', emoji: '😈', price: 6 },
  { id: 'av-unicorn', kind: 'avatar', name: 'Unicorn', emoji: '🦄', price: 8 },
];

export const itemById = (id) => STORE_ITEMS.find((i) => i.id === id) || null;

/** What an equipped id means visually — clients just render the emoji. */
export const emojiFor = (id) => itemById(id)?.emoji || '';
