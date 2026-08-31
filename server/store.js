// The MoneyMove store catalog. Everything is a cosmetic — never pay-to-win:
// token skins replace the coloured disc on the board, avatars replace the
// initial in the player chip. Prices fit the 50–100 coins-per-win economy (see COIN_PACKS).

export const STORE_ITEMS = [
  // ---- token skins (your piece on the board) ----
  { id: 'tok-car', kind: 'token', name: 'Racer', emoji: '🚗', price: 150 },
  { id: 'tok-hat', kind: 'token', name: 'Top Hat', emoji: '🎩', price: 150 },
  { id: 'tok-dog', kind: 'token', name: 'Doggo', emoji: '🐕', price: 200 },
  { id: 'tok-ship', kind: 'token', name: 'Steamer', emoji: '🚢', price: 200 },
  { id: 'tok-rocket', kind: 'token', name: 'Rocket', emoji: '🚀', price: 250 },
  { id: 'tok-haathi', kind: 'token', name: 'Haathi', emoji: '🐘', price: 250 },
  { id: 'tok-flame', kind: 'token', name: 'On Fire', emoji: '🔥', price: 300 },
  { id: 'tok-crown', kind: 'token', name: 'Crown', emoji: '👑', price: 400 },
  { id: 'tok-gem', kind: 'token', name: 'Kohinoor', emoji: '💎', price: 500 },
  { id: 'tok-dragon', kind: 'token', name: 'Dragon', emoji: '🐉', price: 600 },

  // ---- avatars (your face in the player chip) ----
  { id: 'av-cool', kind: 'avatar', name: 'Shades', emoji: '😎', price: 200 },
  { id: 'av-cowboy', kind: 'avatar', name: 'Cowboy', emoji: '🤠', price: 200 },
  { id: 'av-robot', kind: 'avatar', name: 'Robo', emoji: '🤖', price: 200 },
  { id: 'av-alien', kind: 'avatar', name: 'Alien', emoji: '👽', price: 250 },
  { id: 'av-tiger', kind: 'avatar', name: 'Sher', emoji: '🐯', price: 250 },
  { id: 'av-panda', kind: 'avatar', name: 'Panda', emoji: '🐼', price: 250 },
  { id: 'av-fox', kind: 'avatar', name: 'Chalaak', emoji: '🦊', price: 250 },
  { id: 'av-wizard', kind: 'avatar', name: 'Jaadugar', emoji: '🧙', price: 300 },
  { id: 'av-devil', kind: 'avatar', name: 'Shaitan', emoji: '😈', price: 300 },
  { id: 'av-unicorn', kind: 'avatar', name: 'Unicorn', emoji: '🦄', price: 400 },
];

export const itemById = (id) => STORE_ITEMS.find((i) => i.id === id) || null;

/** What an equipped id means visually — clients just render the emoji. */
export const emojiFor = (id) => itemById(id)?.emoji || '';

// ---------------------------------------------------------------- coin packs --
// Paid top-ups. `price` is the display string only — the real charge always
// comes from the platform store (StoreKit on iOS), never from our own maths,
// and coins are granted only after the platform receipt verifies.
export const COIN_PACKS = [
  { id: 'coins.small', productId: 'com.moneymove.game.coins.small', coins: 500, price: '4.99', emoji: '🪙', name: 'Pocket change', bonus: 0 },
  { id: 'coins.mid', productId: 'com.moneymove.game.coins.mid', coins: 1100, price: '9.99', emoji: '💰', name: 'Deep pockets', bonus: 10 },
  { id: 'coins.large', productId: 'com.moneymove.game.coins.large', coins: 2500, price: '19.99', emoji: '🏦', name: 'Tycoon chest', bonus: 25 },
];

export const packByProductId = (pid) => COIN_PACKS.find((p) => p.productId === pid) || null;
