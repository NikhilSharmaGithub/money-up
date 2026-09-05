// The MoneyMove store catalog. Everything is a cosmetic — never pay-to-win:
// token skins replace the coloured disc on the board, avatars replace the
// initial in the player chip. Prices are set against the lean economy — a win
// pays two coins, the day pays one to seven — so owning a piece means either a
// long habit or a visit to the coin shop (see COIN_PACKS).

import { BOARD_ITEMS } from './boards.js';

// Pieces and faces. Boards are sold on the same shelf but live in boards.js,
// because what a board costs is bound up with which two are free today — and
// that is a calendar, not a catalogue.
export const COSMETIC_ITEMS = [
  // ---- token skins (your piece on the board) ----
  // Priced against the new economy: a regular player earns roughly 200 coins
  // a month, so a cheap piece is a fortnight's habit and the top of the shelf
  // is a season's — or one tap in the coin shop.
  { id: 'tok-car', kind: 'token', name: 'Racer', emoji: '🚗', price: 300 },
  { id: 'tok-hat', kind: 'token', name: 'Top Hat', emoji: '🎩', price: 300 },
  { id: 'tok-dog', kind: 'token', name: 'Doggo', emoji: '🐕', price: 400 },
  { id: 'tok-ship', kind: 'token', name: 'Steamer', emoji: '🚢', price: 400 },
  { id: 'tok-scooter', kind: 'token', name: 'Scooty', emoji: '🛵', price: 400 },
  { id: 'tok-auto', kind: 'token', name: 'Auto', emoji: '🛺', price: 450 },
  { id: 'tok-rocket', kind: 'token', name: 'Rocket', emoji: '🚀', price: 500 },
  { id: 'tok-haathi', kind: 'token', name: 'Haathi', emoji: '🐘', price: 500 },
  { id: 'tok-chai', kind: 'token', name: 'Cutting Chai', emoji: '☕', price: 500 },
  { id: 'tok-cricket', kind: 'token', name: 'Cricket', emoji: '🏏', price: 550 },
  { id: 'tok-flame', kind: 'token', name: 'On Fire', emoji: '🔥', price: 600 },
  { id: 'tok-briefcase', kind: 'token', name: 'The Deal', emoji: '💼', price: 600 },
  { id: 'tok-lotus', kind: 'token', name: 'Kamal', emoji: '🪷', price: 650 },
  { id: 'tok-peacock', kind: 'token', name: 'Mor', emoji: '🦚', price: 700 },
  { id: 'tok-crown', kind: 'token', name: 'Crown', emoji: '👑', price: 800 },
  { id: 'tok-gem', kind: 'token', name: 'Kohinoor', emoji: '💎', price: 900 },
  { id: 'tok-dragon', kind: 'token', name: 'Dragon', emoji: '🐉', price: 1000 },
  { id: 'tok-tiger', kind: 'token', name: 'Bagh', emoji: '🐅', price: 1100 },
  { id: 'tok-rickshaw', kind: 'token', name: 'Vintage', emoji: '🏎️', price: 1200 },
  { id: 'tok-trophy', kind: 'token', name: 'Trophy', emoji: '🏆', price: 1500 },

  // ---- avatars (your face in the player chip) ----
  { id: 'av-cool', kind: 'avatar', name: 'Shades', emoji: '😎', price: 350 },
  { id: 'av-cowboy', kind: 'avatar', name: 'Cowboy', emoji: '🤠', price: 350 },
  { id: 'av-robot', kind: 'avatar', name: 'Robo', emoji: '🤖', price: 400 },
  { id: 'av-ninja', kind: 'avatar', name: 'Ninja', emoji: '🥷', price: 400 },
  { id: 'av-alien', kind: 'avatar', name: 'Alien', emoji: '👽', price: 450 },
  { id: 'av-tiger', kind: 'avatar', name: 'Sher', emoji: '🐯', price: 450 },
  { id: 'av-panda', kind: 'avatar', name: 'Panda', emoji: '🐼', price: 450 },
  { id: 'av-fox', kind: 'avatar', name: 'Chalaak', emoji: '🦊', price: 450 },
  { id: 'av-monkey', kind: 'avatar', name: 'Bandar', emoji: '🐵', price: 500 },
  { id: 'av-wizard', kind: 'avatar', name: 'Jaadugar', emoji: '🧙', price: 550 },
  { id: 'av-devil', kind: 'avatar', name: 'Shaitan', emoji: '😈', price: 600 },
  { id: 'av-king', kind: 'avatar', name: 'Maharaja', emoji: '🤴', price: 700 },
  { id: 'av-detective', kind: 'avatar', name: 'Jasoos', emoji: '🕵️', price: 700 },
  { id: 'av-astronaut', kind: 'avatar', name: 'Antariksh', emoji: '👨‍🚀', price: 800 },
  { id: 'av-unicorn', kind: 'avatar', name: 'Unicorn', emoji: '🦄', price: 900 },
  { id: 'av-ghost', kind: 'avatar', name: 'Bhoot', emoji: '👻', price: 950 },
  { id: 'av-dragonface', kind: 'avatar', name: 'Naag', emoji: '🐲', price: 1100 },
  { id: 'av-crownface', kind: 'avatar', name: 'Badshah', emoji: '🫅', price: 1400 },
];

/**
 * The whole shop. Boards come last so a client that renders the list in order
 * shows pieces first, which is the order the shelves grew in.
 */
export const STORE_ITEMS = [...COSMETIC_ITEMS, ...BOARD_ITEMS];

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
