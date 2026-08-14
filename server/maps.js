// Board map definitions.
// Tile order is clockwise starting from START (top-left corner):
//   START -> top row (L->R) -> PRISON corner -> right column (T->B)
//   -> VACATION corner -> bottom row (R->L) -> GO TO PRISON corner -> left column (B->T)

export const GROUPS = {
  BR: { name: 'Brazil', color: '#3ec46d', flag: '🇧🇷' },
  IL: { name: 'Israel', color: '#4aa3e8', flag: '🇮🇱' },
  IT: { name: 'Italy', color: '#c0392b', flag: '🇮🇹' },
  DE: { name: 'Germany', color: '#e8b33c', flag: '🇩🇪' },
  CN: { name: 'China', color: '#e04b4b', flag: '🇨🇳' },
  FR: { name: 'France', color: '#3f6ed6', flag: '🇫🇷' },
  UK: { name: 'United Kingdom', color: '#8e5bd6', flag: '🇬🇧' },
  US: { name: 'United States', color: '#2f80d8', flag: '🇺🇸' },
  IN: { name: 'India', color: '#ef8b3c', flag: '🇮🇳' },
  JP: { name: 'Japan', color: '#d94f6e', flag: '🇯🇵' },
  CA: { name: 'Canada', color: '#e05c5c', flag: '🇨🇦' },
  TR: { name: 'Türkiye', color: '#d63b4a', flag: '🇹🇷' },
  RO: { name: 'Romania', color: '#3f5fd6', flag: '🇷🇴' },
  IE: { name: 'Ireland', color: '#35a76a', flag: '🇮🇪' },

  // regions used by the all-India board
  RJ: { name: 'Rajasthan', color: '#e8913c', flag: '🏰' },
  UP: { name: 'Uttar Pradesh', color: '#4aa3e8', flag: '🕌' },
  MH: { name: 'Maharashtra', color: '#e0556e', flag: '🌇' },
  GJ: { name: 'Gujarat', color: '#f0b429', flag: '🦁' },
  EA: { name: 'East India', color: '#e05c3c', flag: '🐅' },
  KA: { name: 'Karnataka', color: '#5b8def', flag: '💻' },
  TN: { name: 'Tamil Nadu', color: '#8e5bd6', flag: '🛕' },
  ME: { name: 'Metro', color: '#2fb8a0', flag: '💎' },
};

// Rent tiers keyed by price band. Each tier has a "low" and a "high" table;
// the most expensive property inside a colour group uses the "high" table.
const TIERS = [
  { max: 79,   low: [2, 10, 30, 90, 160, 250],       high: [4, 20, 60, 180, 320, 450],       house: 50 },
  { max: 129,  low: [6, 30, 90, 270, 400, 550],      high: [8, 40, 100, 300, 450, 600],      house: 50 },
  { max: 169,  low: [10, 50, 150, 450, 625, 750],    high: [12, 60, 180, 500, 700, 900],     house: 100 },
  { max: 209,  low: [14, 70, 200, 550, 750, 950],    high: [16, 80, 220, 600, 800, 1000],    house: 100 },
  { max: 249,  low: [18, 90, 250, 700, 875, 1050],   high: [20, 100, 300, 750, 925, 1100],   house: 150 },
  { max: 289,  low: [22, 110, 330, 800, 975, 1150],  high: [24, 120, 360, 850, 1025, 1200],  house: 150 },
  { max: 339,  low: [26, 130, 390, 900, 1100, 1275], high: [28, 150, 450, 1000, 1200, 1400], house: 200 },
  { max: 9999, low: [35, 175, 500, 1100, 1300, 1500], high: [50, 200, 600, 1400, 1700, 2000], house: 200 },
];

const tierFor = (price) => TIERS.find((t) => price <= t.max);

// ---- tile shorthand builders -------------------------------------------------
const p = (name, group, price) => ({ type: 'property', name, group, price });
const air = (name, price = 200) => ({ type: 'airport', name, price });
const util = (name, icon, price = 150) => ({ type: 'utility', name, icon, price });
const start = () => ({ type: 'start', name: 'START' });
const prison = () => ({ type: 'prison', name: 'In Prison' });
const vacation = () => ({ type: 'vacation', name: 'Vacation' });
const gotoprison = () => ({ type: 'gotoprison', name: 'Go to prison' });
const treasure = () => ({ type: 'treasure', name: 'Treasure' });
const surprise = () => ({ type: 'surprise', name: 'Surprise' });
const earningsTax = () => ({ type: 'tax', name: 'Earnings Tax', percent: 10 });
const premiumTax = () => ({ type: 'tax', name: 'Premium Tax', amount: 75 });
const refund = (amount = 50) => ({ type: 'refund', name: 'Tax Refund', amount });

// ---- raw map definitions -----------------------------------------------------
const RAW_MAPS = [
  {
    id: 'classic',
    name: 'Classic',
    icon: '🌐',
    description: 'The original 40-tile world tour.',
    tiles: [
      start(),
      p('Salvador', 'BR', 60), treasure(), p('Rio', 'BR', 60), earningsTax(),
      air('TLV Airport'), p('Tel Aviv', 'IL', 100), p('Haifa', 'IL', 110), surprise(), p('Jerusalem', 'IL', 120),
      prison(),
      p('Venice', 'IT', 130), util('Power Company', '⚡'), p('Milan', 'IT', 140), p('Rome', 'IT', 160),
      air('MUC Airport'), p('Frankfurt', 'DE', 180), treasure(), p('Munich', 'DE', 190), p('Berlin', 'DE', 200),
      vacation(),
      p('Shenzhen', 'CN', 210), surprise(), p('Beijing', 'CN', 220), p('Shanghai', 'CN', 240),
      air('CDG Airport'), p('Lyon', 'FR', 260), util('Water Company', '🚰'), p('Toulouse', 'FR', 270), p('Paris', 'FR', 280),
      gotoprison(),
      p('Liverpool', 'UK', 290), p('Manchester', 'UK', 300), treasure(), p('London', 'UK', 320),
      air('JFK Airport'), surprise(), p('San Francisco', 'US', 360), premiumTax(), p('New York', 'US', 400),
    ],
  },
  {
    id: 'worldwide',
    name: 'Mr. Worldwide',
    icon: '🌍',
    description: 'A bigger 48-tile board with two extra countries.',
    tiles: [
      start(),
      p('Salvador', 'BR', 60), treasure(), p('Rio', 'BR', 60), earningsTax(),
      p('Tel Aviv', 'IL', 100), air('TLV Airport'), p('Haifa', 'IL', 100), p('Jerusalem', 'IL', 110), surprise(),
      p('Mumbai', 'IN', 120), p('New Delhi', 'IN', 130),
      prison(),
      p('Venice', 'IT', 140), p('Bologna', 'IT', 140), util('Power Company', '⚡'), p('Milan', 'IT', 160), p('Rome', 'IT', 160),
      air('MUC Airport'), p('Frankfurt', 'DE', 180), treasure(), p('Munich', 'DE', 180), util('Gas Company', '🛢️'), p('Berlin', 'DE', 200),
      vacation(),
      p('Shenzhen', 'CN', 220), surprise(), p('Beijing', 'CN', 220), treasure(), p('Shanghai', 'CN', 240),
      air('CDG Airport'), p('Toulouse', 'FR', 260), p('Paris', 'FR', 260), util('Water Company', '🚰'),
      p('Yokohama', 'JP', 280), p('Tokyo', 'JP', 280),
      gotoprison(),
      p('Liverpool', 'UK', 300), p('Manchester', 'UK', 300), treasure(), p('Birmingham', 'UK', 320), p('London', 'UK', 320),
      air('JFK Airport'), p('Los Angeles', 'US', 350), surprise(), p('San Francisco', 'US', 360), premiumTax(), p('New York', 'US', 400),
    ],
  },
  {
    id: 'deathvalley',
    name: 'Death Valley',
    icon: '☠️',
    description: 'Canada, Germany, UK and USA go head to head.',
    tiles: [
      start(),
      p('Ottawa', 'CA', 60), treasure(), p('Quebec City', 'CA', 60), earningsTax(),
      air('YYZ Airport'), p('Montreal', 'CA', 100), surprise(), p('Vancouver', 'CA', 100), p('Toronto', 'CA', 120),
      prison(),
      p('Wolfsburg', 'DE', 140), util('Power Company', '⚡'), p('Cologne', 'DE', 140), p('Hamburg', 'DE', 160),
      air('MUC Airport'), p('Frankfurt', 'DE', 180), treasure(), p('Munich', 'DE', 180), p('Berlin', 'DE', 200),
      vacation(),
      p('Glasgow', 'UK', 220), surprise(), p('Cambridge', 'UK', 220), p('Liverpool', 'UK', 240),
      air('LHR Airport'), p('Birmingham', 'UK', 260), p('Manchester', 'UK', 260), util('Water Company', '🚰'), p('London', 'UK', 280),
      gotoprison(),
      p('Boston', 'US', 300), p('Seattle', 'US', 300), treasure(), p('Chicago', 'US', 320),
      air('JFK Airport'), surprise(), p('San Francisco', 'US', 350), premiumTax(), p('New York', 'US', 400),
    ],
  },
  {
    id: 'bharat',
    name: 'Bharat',
    icon: '🇮🇳',
    description: 'A tour of India, from Jaipur to New Delhi.',
    tiles: [
      start(),
      p('Jaipur', 'RJ', 60), treasure(), p('Udaipur', 'RJ', 60), earningsTax(),
      air('DEL Airport'), p('Lucknow', 'UP', 100), p('Varanasi', 'UP', 110), surprise(), p('Agra', 'UP', 120),
      prison(),
      p('Pune', 'MH', 140), util('Power Grid', '⚡'), p('Nagpur', 'MH', 140), p('Mumbai', 'MH', 160),
      air('BOM Airport'), p('Surat', 'GJ', 180), treasure(), p('Vadodara', 'GJ', 190), p('Ahmedabad', 'GJ', 200),
      vacation(),
      p('Bhubaneswar', 'EA', 210), surprise(), p('Guwahati', 'EA', 220), p('Kolkata', 'EA', 240),
      air('MAA Airport'), p('Mysuru', 'KA', 260), util('Water Board', '🚰'), p('Mangaluru', 'KA', 270), p('Bengaluru', 'KA', 280),
      gotoprison(),
      p('Madurai', 'TN', 290), p('Coimbatore', 'TN', 300), treasure(), p('Chennai', 'TN', 320),
      air('BLR Airport'), surprise(), p('Hyderabad', 'ME', 360), premiumTax(), p('New Delhi', 'ME', 400),
    ],
  },
  {
    id: 'blitz',
    name: 'Blitz',
    icon: '⚡',
    description: 'A short 28-tile board — games end fast.',
    tiles: [
      start(),
      p('Salvador', 'BR', 60), treasure(), p('Rio', 'BR', 60), earningsTax(),
      p('Tel Aviv', 'IL', 100), p('Jerusalem', 'IL', 120),
      prison(),
      p('Milan', 'IT', 140), util('Power Company', '⚡'), p('Rome', 'IT', 160),
      air('TLV Airport'), p('Munich', 'DE', 180), p('Berlin', 'DE', 200),
      vacation(),
      p('Shenzhen', 'CN', 220), surprise(), p('Beijing', 'CN', 240),
      air('CDG Airport'), p('Lyon', 'FR', 260), p('Paris', 'FR', 280),
      gotoprison(),
      p('Liverpool', 'UK', 300), p('London', 'UK', 320), treasure(),
      air('JFK Airport'), p('San Francisco', 'US', 350), p('New York', 'US', 400),
    ],
  },
  {
    id: 'luckywheel',
    name: 'Lucky Wheel',
    icon: '🍀',
    description: 'Half the board is chance. Pure chaos.',
    tiles: [
      start(),
      p('Antalya', 'TR', 60), p('Istanbul', 'TR', 80), p('Brasov', 'RO', 100), p('Bucharest', 'RO', 120),
      air('TLV Airport'), p('Milan', 'IT', 140), p('Rome', 'IT', 160), p('Munich', 'DE', 180), p('Berlin', 'DE', 200),
      prison(),
      treasure(), earningsTax(), surprise(), treasure(), air('MUC Airport'), surprise(), treasure(), premiumTax(), surprise(),
      vacation(),
      p('Beijing', 'CN', 220), p('Shanghai', 'CN', 240), p('Belfast', 'IE', 260), p('Dublin', 'IE', 280),
      air('CDG Airport'), p('Manchester', 'UK', 300), p('London', 'UK', 320), p('San Francisco', 'US', 350), p('New York', 'US', 400),
      gotoprison(),
      treasure(), surprise(), premiumTax(), treasure(), air('JFK Airport'), surprise(), refund(50), treasure(), surprise(),
    ],
  },
];

// ---- post-processing ---------------------------------------------------------
// Fills in rent tables, house costs, group membership and the side layout used
// by the client renderer.
function buildMap(raw) {
  const tiles = raw.tiles.map((t, i) => ({ ...t, index: i }));

  // group -> indices, and highest price inside each group
  const groups = {};
  tiles.forEach((t) => {
    if (t.type !== 'property') return;
    (groups[t.group] ||= []).push(t.index);
  });

  for (const [g, idxs] of Object.entries(groups)) {
    const maxPrice = Math.max(...idxs.map((i) => tiles[i].price));
    idxs.forEach((i) => {
      const tile = tiles[i];
      const tier = tierFor(tile.price);
      tile.rent = tile.price === maxPrice ? [...tier.high] : [...tier.low];
      tile.houseCost = tier.house;
      tile.groupSize = idxs.length;
    });
  }

  const airports = tiles.filter((t) => t.type === 'airport').length;
  const utilities = tiles.filter((t) => t.type === 'utility').length;

  // corner indices, in board order
  const cornerTypes = ['start', 'prison', 'vacation', 'gotoprison'];
  const corners = tiles.filter((t) => cornerTypes.includes(t.type)).map((t) => t.index);
  if (corners.length !== 4) throw new Error(`map ${raw.id}: expected 4 corners, got ${corners.length}`);

  const layout = {
    corners,
    top: range(corners[0] + 1, corners[1]),
    right: range(corners[1] + 1, corners[2]),
    bottom: range(corners[2] + 1, corners[3]),
    left: range(corners[3] + 1, tiles.length),
  };

  return {
    id: raw.id,
    // Identifies this exact board. Generated boards share the id "random" but
    // each gets its own uid, so the client knows to rebuild the tile grid.
    uid: raw.uid || raw.id,
    name: raw.name,
    icon: raw.icon,
    description: raw.description,
    tiles,
    layout,
    groups,
    airportCount: airports,
    utilityCount: utilities,
    size: tiles.length,
  };
}

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

// ---- random board generator --------------------------------------------------
// Keeps the proven classic *shape* (where the airports, chance tiles and taxes
// sit) and randomises the content: which countries appear, which of their cities
// get used, and which airports and utilities show up.
const CITY_POOL = {
  BR: ['Salvador', 'Rio', 'São Paulo', 'Brasília', 'Recife'],
  IL: ['Tel Aviv', 'Haifa', 'Jerusalem', 'Eilat'],
  IT: ['Venice', 'Milan', 'Rome', 'Bologna', 'Naples', 'Turin'],
  DE: ['Frankfurt', 'Munich', 'Berlin', 'Hamburg', 'Cologne', 'Wolfsburg'],
  CN: ['Shanghai', 'Beijing', 'Shenzhen', 'Chengdu', 'Guangzhou'],
  FR: ['Paris', 'Toulouse', 'Lyon', 'Marseille', 'Nice'],
  UK: ['London', 'Manchester', 'Liverpool', 'Birmingham', 'Glasgow', 'Cambridge'],
  US: ['New York', 'San Francisco', 'Chicago', 'Boston', 'Seattle', 'Los Angeles'],
  IN: ['Mumbai', 'New Delhi', 'Bengaluru', 'Chennai', 'Kolkata', 'Jaipur'],
  JP: ['Tokyo', 'Yokohama', 'Osaka', 'Kyoto'],
  CA: ['Toronto', 'Montreal', 'Vancouver', 'Ottawa', 'Quebec City'],
  TR: ['Istanbul', 'Antalya', 'Ankara', 'Izmir'],
  RO: ['Bucharest', 'Brasov', 'Cluj'],
  IE: ['Dublin', 'Belfast', 'Cork'],
};

const AIRPORT_POOL = [
  'JFK Airport', 'TLV Airport', 'MUC Airport', 'CDG Airport', 'LHR Airport',
  'YYZ Airport', 'DEL Airport', 'BOM Airport', 'NRT Airport', 'GRU Airport',
];

const UTILITY_POOL = [
  ['Power Company', '⚡'], ['Water Company', '🚰'],
  ['Gas Company', '🛢️'], ['Solar Farm', '☀️'], ['Wind Farm', '🌬️'],
];

// Group sizes and the price ladder walked around the board, classic proportions.
const GROUP_SIZES = [2, 3, 3, 3, 3, 3, 3, 2];
const PRICE_LADDER = [
  60, 60, 100, 110, 120, 130, 140, 160, 180, 190, 200,
  210, 220, 240, 260, 270, 280, 290, 300, 320, 350, 400,
];

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const pick = (list, n) => shuffle(list).slice(0, n);

export function generateRandomMap() {
  const countries = pick(Object.keys(CITY_POOL), GROUP_SIZES.length);
  const streets = [];
  let priceIndex = 0;
  countries.forEach((country, g) => {
    pick(CITY_POOL[country], GROUP_SIZES[g]).forEach((city) => {
      streets.push(p(city, country, PRICE_LADDER[priceIndex++]));
    });
  });

  const airports = pick(AIRPORT_POOL, 4);
  const utilities = pick(UTILITY_POOL, 2);
  let s = 0, a = 0, u = 0;
  const S = () => streets[s++];
  const A = () => air(airports[a++]);
  const U = () => { const [name, icon] = utilities[u++]; return util(name, icon); };

  const tiles = [
    start(),
    S(), treasure(), S(), earningsTax(), A(), S(), S(), surprise(), S(),
    prison(),
    S(), U(), S(), S(), A(), S(), treasure(), S(), S(),
    vacation(),
    S(), surprise(), S(), S(), A(), S(), U(), S(), S(),
    gotoprison(),
    S(), S(), treasure(), S(), A(), surprise(), S(), premiumTax(), S(),
  ];

  return buildMap({
    id: 'random',
    uid: `random-${Math.random().toString(36).slice(2, 10)}`,
    name: 'Random',
    icon: '🎲',
    description: 'A freshly shuffled board every single game.',
    tiles,
  });
}

// Colour used to draw a tile in the little board thumbnails on the map picker.
const TYPE_COLORS = {
  airport: '#5b8def', utility: '#22d3ee', treasure: '#f59e0b', surprise: '#ec4899',
  tax: '#ef4444', refund: '#22c55e', start: '#4ade80', prison: '#818cf8',
  vacation: '#2dd4bf', gotoprison: '#fb7185',
};
const swatch = (t) => (t.type === 'property' ? GROUPS[t.group]?.color || '#8b5cf6' : TYPE_COLORS[t.type] || '#6d6394');

export const MAPS = Object.fromEntries(RAW_MAPS.map((m) => [m.id, buildMap(m)]));

const summarise = (m) => ({
  id: m.id,
  name: m.name,
  icon: m.icon,
  description: m.description,
  size: m.size,
  streets: m.tiles.filter((t) => t.type === 'property').length,
  airports: m.airportCount,
  utilities: m.utilityCount,
  countries: Object.keys(m.groups).length,
  // everything the client needs to draw a miniature of the board
  preview: {
    colors: m.tiles.map(swatch),
    sides: {
      top: m.layout.top.length,
      right: m.layout.right.length,
      bottom: m.layout.bottom.length,
      left: m.layout.left.length,
    },
  },
});

/** Built fresh on every call, so the picker's Random thumbnail is never stale. */
export const mapList = () => [...Object.values(MAPS).map(summarise), summarise(generateRandomMap())];
export const MAP_LIST = mapList();

export const getMap = (id) => (id === 'random' ? generateRandomMap() : MAPS[id] || MAPS.classic);
