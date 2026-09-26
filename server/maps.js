// Board map definitions.
// Tile order is clockwise starting from START (top-left corner):
//   START -> top row (L->R) -> PRISON corner -> right column (T->B)
//   -> VACATION corner -> bottom row (R->T) -> GO TO PRISON corner -> left column (B->T)

import { COUNTRY_BOARDS } from './countries.js';

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

  // The countries the continent boards add. A country's colour is the same
  // on every board it appears on, so these were chosen for the one board each
  // of them lives on: the classic ladder where it fits — browns and light
  // blues at the cheap end, greens and dark blues at the dear end — bent
  // wherever a country already on that board owns the colour (India's orange
  // on Asia, Italy's red on Europe). Keys are ISO 3166 codes, except that a
  // code the Indian regions below already hold (TN, KA, ME, EA) is off
  // limits: this is one flat object, and a Tunisia keyed 'TN' would quietly
  // rename and repaint Tamil Nadu on the Bharat board.
  // Africa
  ET: { name: 'Ethiopia', color: '#a0703f', flag: '🇪🇹' },
  GH: { name: 'Ghana', color: '#4fb3d9', flag: '🇬🇭' },
  TZ: { name: 'Tanzania', color: '#d1699e', flag: '🇹🇿' },
  KE: { name: 'Kenya', color: '#e5883a', flag: '🇰🇪' },
  MA: { name: 'Morocco', color: '#d64545', flag: '🇲🇦' },
  NG: { name: 'Nigeria', color: '#d2ac2a', flag: '🇳🇬' },
  EG: { name: 'Egypt', color: '#3f9e63', flag: '🇪🇬' },
  ZA: { name: 'South Africa', color: '#4a6fd4', flag: '🇿🇦' },
  // Asia (India, China and Japan are above)
  VN: { name: 'Vietnam', color: '#a9744a', flag: '🇻🇳' },
  ID: { name: 'Indonesia', color: '#52b0d6', flag: '🇮🇩' },
  TH: { name: 'Thailand', color: '#8e6fd0', flag: '🇹🇭' },
  KR: { name: 'South Korea', color: '#3d63c9', flag: '🇰🇷' },
  AE: { name: 'United Arab Emirates', color: '#3a9a5c', flag: '🇦🇪' },
  // Europe (Italy, Germany, France and the UK are above)
  PT: { name: 'Portugal', color: '#9e6b45', flag: '🇵🇹' },
  GR: { name: 'Greece', color: '#4aa8dc', flag: '🇬🇷' },
  NL: { name: 'Netherlands', color: '#f07a2e', flag: '🇳🇱' },
  ES: { name: 'Spain', color: '#cf5f95', flag: '🇪🇸' },
  // North America (Canada and the United States are above)
  JM: { name: 'Jamaica', color: '#a47a4c', flag: '🇯🇲' },
  CU: { name: 'Cuba', color: '#56b6d8', flag: '🇨🇺' },
  DO: { name: 'Dominican Republic', color: '#cc6aa6', flag: '🇩🇴' },
  CR: { name: 'Costa Rica', color: '#e08a3c', flag: '🇨🇷' },
  PA: { name: 'Panama', color: '#c9a227', flag: '🇵🇦' },
  MX: { name: 'Mexico', color: '#2f9a5a', flag: '🇲🇽' },
  // South America (Brazil is above)
  BO: { name: 'Bolivia', color: '#a3764c', flag: '🇧🇴' },
  EC: { name: 'Ecuador', color: '#d4ad2b', flag: '🇪🇨' },
  UY: { name: 'Uruguay', color: '#62b6e0', flag: '🇺🇾' },
  PE: { name: 'Peru', color: '#d2443f', flag: '🇵🇪' },
  CO: { name: 'Colombia', color: '#e8883a', flag: '🇨🇴' },
  CL: { name: 'Chile', color: '#d0628f', flag: '🇨🇱' },
  AR: { name: 'Argentina', color: '#8a6ccf', flag: '🇦🇷' },
  // Oceania
  WS: { name: 'Samoa', color: '#a0724a', flag: '🇼🇸' },
  TO: { name: 'Tonga', color: '#cd5f93', flag: '🇹🇴' },
  SB: { name: 'Solomon Islands', color: '#cba62a', flag: '🇸🇧' },
  VU: { name: 'Vanuatu', color: '#e3843a', flag: '🇻🇺' },
  PG: { name: 'Papua New Guinea', color: '#d8473f', flag: '🇵🇬' },
  FJ: { name: 'Fiji', color: '#55b4dc', flag: '🇫🇯' },
  NZ: { name: 'New Zealand', color: '#2f8f5b', flag: '🇳🇿' },
  AU: { name: 'Australia', color: '#2f5fc4', flag: '🇦🇺' },

  // regions used by the country boards live under namespaced keys, e.g.
  // IN_MH — registered below from COUNTRY_BOARDS so two countries can both
  // have a "NE" region without colliding.

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

  // ---- the continent boards ---------------------------------------------------
  // One board per inhabited continent, so a table can pick where in the world
  // it wants to play rather than which single country. Each is the classic
  // board exactly — same shape, same prices, same corners, taxes and chance
  // tiles in the same places — with eight of that continent's countries on
  // it, cheapest set first. The dearest street in every set is the city
  // people have heard of, because that is the one a set gets remembered by.
  //
  // Each airport is the gateway to the country right after it, so walking
  // the board reads like a flight plan rather than four codes picked at
  // random. Antarctica is left out on purpose: it has no countries of its
  // own to put on a board.
  //
  // Every one of them wears the folded map as its badge, not a globe. The
  // globe is Mr. Worldwide's, and the apps already on people's phones draw
  // it as his plane; the folded map is what every client, shipped or not,
  // falls back to for a mark it does not know, so it is right everywhere
  // without an update.
  {
    id: 'continent-africa',
    name: 'Africa',
    icon: '🗺️',
    description: 'Eight countries of Africa, from Addis Ababa to Cape Town.',
    tiles: [
      start(),
      p('Gondar', 'ET', 60), treasure(), p('Addis Ababa', 'ET', 60), earningsTax(),
      air('ACC Airport'), p('Tamale', 'GH', 100), p('Kumasi', 'GH', 110), surprise(), p('Accra', 'GH', 120),
      prison(),
      p('Arusha', 'TZ', 130), util('Sahara Solar', '☀️'), p('Zanzibar City', 'TZ', 140), p('Dar es Salaam', 'TZ', 160),
      air('NBO Airport'), p('Kisumu', 'KE', 180), treasure(), p('Mombasa', 'KE', 190), p('Nairobi', 'KE', 200),
      vacation(),
      p('Fes', 'MA', 210), surprise(), p('Marrakech', 'MA', 220), p('Casablanca', 'MA', 240),
      air('LOS Airport'), p('Kano', 'NG', 260), util('Nile Water Co', '🚰'), p('Abuja', 'NG', 270), p('Lagos', 'NG', 280),
      gotoprison(),
      p('Luxor', 'EG', 290), p('Alexandria', 'EG', 300), treasure(), p('Cairo', 'EG', 320),
      air('JNB Airport'), surprise(), p('Johannesburg', 'ZA', 360), premiumTax(), p('Cape Town', 'ZA', 400),
    ],
  },
  {
    id: 'continent-asia',
    name: 'Asia',
    icon: '🗺️',
    description: 'Eight countries of Asia, from Hanoi to Tokyo.',
    tiles: [
      start(),
      p('Da Nang', 'VN', 60), treasure(), p('Hanoi', 'VN', 60), earningsTax(),
      air('CGK Airport'), p('Yogyakarta', 'ID', 100), p('Denpasar', 'ID', 110), surprise(), p('Jakarta', 'ID', 120),
      prison(),
      p('Chiang Mai', 'TH', 130), util('Mekong Hydro', '⚡'), p('Phuket', 'TH', 140), p('Bangkok', 'TH', 160),
      air('DEL Airport'), p('Bengaluru', 'IN', 180), treasure(), p('New Delhi', 'IN', 190), p('Mumbai', 'IN', 200),
      vacation(),
      p('Incheon', 'KR', 210), surprise(), p('Busan', 'KR', 220), p('Seoul', 'KR', 240),
      air('DXB Airport'), p('Sharjah', 'AE', 260), util('Monsoon Water Co', '💧'), p('Abu Dhabi', 'AE', 270), p('Dubai', 'AE', 280),
      gotoprison(),
      p('Shenzhen', 'CN', 290), p('Beijing', 'CN', 300), treasure(), p('Shanghai', 'CN', 320),
      air('HND Airport'), surprise(), p('Osaka', 'JP', 360), premiumTax(), p('Tokyo', 'JP', 400),
    ],
  },
  {
    id: 'continent-europe',
    name: 'Europe',
    icon: '🗺️',
    description: 'Eight countries of Europe, from Lisbon to London.',
    tiles: [
      start(),
      p('Porto', 'PT', 60), treasure(), p('Lisbon', 'PT', 60), earningsTax(),
      air('ATH Airport'), p('Patras', 'GR', 100), p('Thessaloniki', 'GR', 110), surprise(), p('Athens', 'GR', 120),
      prison(),
      p('Utrecht', 'NL', 130), util('North Sea Wind', '🌬️'), p('Rotterdam', 'NL', 140), p('Amsterdam', 'NL', 160),
      air('MAD Airport'), p('Seville', 'ES', 180), treasure(), p('Barcelona', 'ES', 190), p('Madrid', 'ES', 200),
      vacation(),
      p('Venice', 'IT', 210), surprise(), p('Milan', 'IT', 220), p('Rome', 'IT', 240),
      air('FRA Airport'), p('Frankfurt', 'DE', 260), util('Alpine Water Co', '💧'), p('Munich', 'DE', 270), p('Berlin', 'DE', 280),
      gotoprison(),
      p('Lyon', 'FR', 290), p('Marseille', 'FR', 300), treasure(), p('Paris', 'FR', 320),
      air('LHR Airport'), surprise(), p('Manchester', 'UK', 360), premiumTax(), p('London', 'UK', 400),
    ],
  },
  {
    id: 'continent-north-america',
    name: 'North America',
    icon: '🗺️',
    description: 'Eight countries of North America, from Kingston to New York.',
    tiles: [
      start(),
      p('Montego Bay', 'JM', 60), treasure(), p('Kingston', 'JM', 60), earningsTax(),
      air('HAV Airport'), p('Cienfuegos', 'CU', 100), p('Varadero', 'CU', 110), surprise(), p('Havana', 'CU', 120),
      prison(),
      p('Puerto Plata', 'DO', 130), util('Niagara Power', '⚡'), p('Punta Cana', 'DO', 140), p('Santo Domingo', 'DO', 160),
      air('SJO Airport'), p('Limón', 'CR', 180), treasure(), p('Puntarenas', 'CR', 190), p('San José', 'CR', 200),
      vacation(),
      p('Bocas del Toro', 'PA', 210), surprise(), p('Colón', 'PA', 220), p('Panama City', 'PA', 240),
      air('MEX Airport'), p('Guadalajara', 'MX', 260), util('Great Lakes Water', '🚰'), p('Cancún', 'MX', 270), p('Mexico City', 'MX', 280),
      gotoprison(),
      p('Vancouver', 'CA', 290), p('Montreal', 'CA', 300), treasure(), p('Toronto', 'CA', 320),
      air('JFK Airport'), surprise(), p('Los Angeles', 'US', 360), premiumTax(), p('New York', 'US', 400),
    ],
  },
  {
    id: 'continent-south-america',
    name: 'South America',
    icon: '🗺️',
    description: 'Eight countries of South America, from La Paz to Rio de Janeiro.',
    tiles: [
      start(),
      p('Sucre', 'BO', 60), treasure(), p('La Paz', 'BO', 60), earningsTax(),
      air('UIO Airport'), p('Cuenca', 'EC', 100), p('Guayaquil', 'EC', 110), surprise(), p('Quito', 'EC', 120),
      prison(),
      p('Salto', 'UY', 130), util('Andes Hydro', '⚡'), p('Punta del Este', 'UY', 140), p('Montevideo', 'UY', 160),
      air('LIM Airport'), p('Arequipa', 'PE', 180), treasure(), p('Cusco', 'PE', 190), p('Lima', 'PE', 200),
      vacation(),
      p('Cartagena', 'CO', 210), surprise(), p('Medellín', 'CO', 220), p('Bogotá', 'CO', 240),
      air('SCL Airport'), p('Concepción', 'CL', 260), util('Amazon Water Co', '💧'), p('Valparaíso', 'CL', 270), p('Santiago', 'CL', 280),
      gotoprison(),
      p('Mendoza', 'AR', 290), p('Córdoba', 'AR', 300), treasure(), p('Buenos Aires', 'AR', 320),
      air('GRU Airport'), surprise(), p('São Paulo', 'BR', 360), premiumTax(), p('Rio de Janeiro', 'BR', 400),
    ],
  },
  {
    id: 'continent-oceania',
    name: 'Oceania',
    icon: '🗺️',
    description: 'Eight countries of Oceania, from Apia to Sydney.',
    tiles: [
      start(),
      p('Salelologa', 'WS', 60), treasure(), p('Apia', 'WS', 60), earningsTax(),
      air('TBU Airport'), p('Pangai', 'TO', 100), p('Neiafu', 'TO', 110), surprise(), p("Nuku'alofa", 'TO', 120),
      prison(),
      p('Gizo', 'SB', 130), util('Trade Wind Power', '🌬️'), p('Auki', 'SB', 140), p('Honiara', 'SB', 160),
      air('VLI Airport'), p('Lenakel', 'VU', 180), treasure(), p('Luganville', 'VU', 190), p('Port Vila', 'VU', 200),
      vacation(),
      p('Mount Hagen', 'PG', 210), surprise(), p('Lae', 'PG', 220), p('Port Moresby', 'PG', 240),
      air('NAN Airport'), p('Lautoka', 'FJ', 260), util('Coral Sea Water', '💧'), p('Nadi', 'FJ', 270), p('Suva', 'FJ', 280),
      gotoprison(),
      p('Christchurch', 'NZ', 290), p('Wellington', 'NZ', 300), treasure(), p('Auckland', 'NZ', 320),
      air('SYD Airport'), surprise(), p('Melbourne', 'AU', 360), premiumTax(), p('Sydney', 'AU', 400),
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

// Countries with deep city pools — the only ones allowed to hold the two
// priciest tiers, so a tiny map corner never outranks the majors.
const MAJOR_COUNTRIES = ['US', 'IN', 'UK', 'DE', 'CN', 'FR', 'BR', 'CA', 'JP', 'IT'];

export function generateRandomMap() {
  // Five majors + three from everywhere, shuffled across the tiers…
  const majors = shuffle(MAJOR_COUNTRIES).slice(0, 5);
  const others = shuffle(Object.keys(CITY_POOL).filter((c) => !majors.includes(c))).slice(0, 3);
  const countries = shuffle([...majors, ...others]);

  // …but the top two tiers (the last two groups) must belong to majors.
  for (const slot of [GROUP_SIZES.length - 1, GROUP_SIZES.length - 2]) {
    if (!MAJOR_COUNTRIES.includes(countries[slot])) {
      const swap = countries.findIndex(
        (c, i) => i < GROUP_SIZES.length - 2 && MAJOR_COUNTRIES.includes(c),
      );
      [countries[slot], countries[swap]] = [countries[swap], countries[slot]];
    }
  }
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

// ---- country boards ----------------------------------------------------------
// Each COUNTRY_BOARDS entry becomes a full 40-tile board in the proven classic
// shape, plus its own localized Treasure/Surprise deck. Group keys are
// namespaced (IN_MH, US_CA…) so regions never collide across countries.
for (const b of COUNTRY_BOARDS) {
  for (const g of b.groups) {
    GROUPS[`${b.id.toUpperCase()}_${g.key}`] = { name: g.name, color: g.color, flag: g.flag };
  }
}

function buildCountryMap(b) {
  const gkey = (k) => `${b.id.toUpperCase()}_${k}`;
  const streets = b.cities.map((c, i) => p(c.name, gkey(c.group), PRICE_LADDER[i]));
  let s = 0, a = 0, u = 0;
  const S = () => streets[s++];
  const A = () => air(b.airports[a++]);
  const U = () => util(b.utilities[u].name, b.utilities[u++].icon);

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

  const map = buildMap({
    id: `country-${b.id}`,
    name: b.name,
    icon: b.icon,
    description: b.description,
    tiles,
  });
  map.deck = { treasure: b.treasure, surprise: b.surprise };
  map.country = true;
  return map;
}

export const COUNTRY_MAPS = Object.fromEntries(
  COUNTRY_BOARDS.map((b) => [`country-${b.id}`, buildCountryMap(b)]),
);

// Colour used to draw a tile in the little board thumbnails on the map picker.
const TYPE_COLORS = {
  airport: '#5b8def', utility: '#22d3ee', treasure: '#f59e0b', surprise: '#ec4899',
  tax: '#ef4444', refund: '#22c55e', start: '#4ade80', prison: '#818cf8',
  vacation: '#2dd4bf', gotoprison: '#fb7185',
};
const swatch = (t) => (t.type === 'property' ? GROUPS[t.group]?.color || '#8b5cf6' : TYPE_COLORS[t.type] || '#6d6394');

export const MAPS = {
  ...Object.fromEntries(RAW_MAPS.map((m) => [m.id, buildMap(m)])),
  ...COUNTRY_MAPS,
};

const summarise = (m) => ({
  id: m.id,
  name: m.name,
  icon: m.icon,
  description: m.description,
  country: !!m.country,
  size: m.size,
  streets: m.tiles.filter((t) => t.type === 'property').length,
  airports: m.airportCount,
  utilities: m.utilityCount,
  countries: Object.keys(m.groups).length,
  // What is actually ON it — every colour set with its own cities, in board
  // order. A rim of coloured chips says a board exists; this says whether you
  // want it. Nobody ever bought a board because it had 22 streets; they buy it
  // because it has Marine Drive on it.
  sets: Object.entries(m.groups).map(([g, idxs]) => ({
    name: GROUPS[g]?.name || g,
    color: GROUPS[g]?.color || '#8b5cf6',
    cities: idxs.map((i) => m.tiles[i].name),
  })),
  // The three names for a card with room for three. Deliberately the DEAREST
  // streets rather than the first ones: a board is laid out cheapest-first, so
  // taking the top of the list sells Canada on Corner Brook and Whitehorse.
  // The expensive end is the recognisable end — it is where Toronto is, and
  // Mumbai, and Manhattan — and recognising something is the whole job here.
  headline: m.tiles
    .filter((t) => t.type === 'property')
    .sort((a, b) => b.price - a.price)
    .slice(0, 3)
    .map((t) => t.name),
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

// hasOwn rather than a lookup: '__proto__' and 'constructor' are inherited off
// Object.prototype, so `MAPS[id] || MAPS.classic` handed back Object.prototype
// for either of them — a "board" with no tiles, no layout and no id.
export const getMap = (id) => (id === 'random'
  ? generateRandomMap()
  : (Object.hasOwn(MAPS, id) ? MAPS[id] : MAPS.classic));
