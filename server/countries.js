// Country boards — 12 nations, each with its own regions, cities and a
// fully original, locally flavoured Treasure/Surprise deck.
// Generated content, validated against the engine's card-action vocabulary.

export const COUNTRY_BOARDS = [
  {
    "id": "in",
    "name": "Bharat Bazaar",
    "icon": "🇮🇳",
    "description": "From Shillong pines to Marine Drive penthouses - buy up the subcontinent, yaar!",
    "groups": [
      {
        "key": "NE",
        "name": "The Northeast",
        "color": "#a67c52",
        "flag": "🦏"
      },
      {
        "key": "GP",
        "name": "Gangetic Plains",
        "color": "#4fa8c9",
        "flag": "🛕"
      },
      {
        "key": "RJ",
        "name": "Rajasthan",
        "color": "#d1699e",
        "flag": "🐪"
      },
      {
        "key": "EC",
        "name": "Eastern Coast",
        "color": "#e08a3c",
        "flag": "🐟"
      },
      {
        "key": "GJ",
        "name": "Gujarat",
        "color": "#d95c5c",
        "flag": "🦁"
      },
      {
        "key": "SI",
        "name": "Southern Metros",
        "color": "#c9a233",
        "flag": "☕"
      },
      {
        "key": "DL",
        "name": "Delhi NCR",
        "color": "#56a05e",
        "flag": "🏛️"
      },
      {
        "key": "MH",
        "name": "Maharashtra",
        "color": "#5b7fd4",
        "flag": "🎬"
      }
    ],
    "cities": [
      {
        "name": "Shillong",
        "group": "NE"
      },
      {
        "name": "Guwahati",
        "group": "NE"
      },
      {
        "name": "Patna",
        "group": "GP"
      },
      {
        "name": "Varanasi",
        "group": "GP"
      },
      {
        "name": "Lucknow",
        "group": "GP"
      },
      {
        "name": "Jodhpur",
        "group": "RJ"
      },
      {
        "name": "Udaipur",
        "group": "RJ"
      },
      {
        "name": "Jaipur",
        "group": "RJ"
      },
      {
        "name": "Bhubaneswar",
        "group": "EC"
      },
      {
        "name": "Visakhapatnam",
        "group": "EC"
      },
      {
        "name": "Kolkata",
        "group": "EC"
      },
      {
        "name": "Vadodara",
        "group": "GJ"
      },
      {
        "name": "Surat",
        "group": "GJ"
      },
      {
        "name": "Ahmedabad",
        "group": "GJ"
      },
      {
        "name": "Chennai",
        "group": "SI"
      },
      {
        "name": "Hyderabad",
        "group": "SI"
      },
      {
        "name": "Bengaluru",
        "group": "SI"
      },
      {
        "name": "Noida",
        "group": "DL"
      },
      {
        "name": "Gurugram",
        "group": "DL"
      },
      {
        "name": "New Delhi",
        "group": "DL"
      },
      {
        "name": "Pune",
        "group": "MH"
      },
      {
        "name": "Mumbai",
        "group": "MH"
      }
    ],
    "airports": [
      "DEL Airport",
      "CCU Airport",
      "MAA Airport",
      "BOM Airport"
    ],
    "utilities": [
      {
        "name": "Bijli Board",
        "icon": "⚡"
      },
      {
        "name": "Jal Nigam",
        "icon": "🚰"
      }
    ],
    "treasure": [
      {
        "text": "Your Diwali rangoli wins the society competition. The committee pays $100.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "The raddiwala pays top rate for your newspaper mountain. Collect $25.",
        "act": {
          "kind": "money",
          "amount": 25
        }
      },
      {
        "text": "A cricketer stops at your chai tapri and the queue goes viral. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "Wedding season! You play dhol at three baraats in one night. Collect $120.",
        "act": {
          "kind": "money",
          "amount": 120
        }
      },
      {
        "text": "Monsoon hits and your umbrella stall outside the metro prints money. Collect $80.",
        "act": {
          "kind": "money",
          "amount": 80
        }
      },
      {
        "text": "You win the housing society's antakshari night. Bragging rights plus $50.",
        "act": {
          "kind": "money",
          "amount": 50
        }
      },
      {
        "text": "Cousin's destination wedding in Udaipur. The outfit alone costs $75. Pay up.",
        "act": {
          "kind": "money",
          "amount": -75
        }
      },
      {
        "text": "A scam caller asks for your OTP. You waste his whole hour instead. Karma pays $45.",
        "act": {
          "kind": "money",
          "amount": 45
        }
      },
      {
        "text": "Your Rajdhani Express arrives early for once. Speed to START and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Long weekend! You book a houseboat in Alleppey. Drift over to VACATION.",
        "act": {
          "kind": "moveTo",
          "tile": "vacation"
        }
      },
      {
        "text": "Uncle-ji makes one phone call and doors open. Keep this card to walk out of jail once.",
        "act": {
          "kind": "getout"
        }
      },
      {
        "text": "You jumped the queue at the railway counter. The aunties saw everything. Go to jail.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Griha pravesh at your new flat! Guests arrive with shagun envelopes. Collect $30 from each player.",
        "act": {
          "kind": "collectEach",
          "amount": 30
        }
      },
      {
        "text": "The monsoon found every leak you ignored. Pay $30 per house and $110 per hotel to fix them.",
        "act": {
          "kind": "repairs",
          "house": 30,
          "hotel": 110
        }
      }
    ],
    "surprise": [
      {
        "text": "Your UPI-for-chaiwalas startup somehow lands funding. Collect $200.",
        "act": {
          "kind": "money",
          "amount": 200
        }
      },
      {
        "text": "You asked 'last price?' at the emporium and still paid full. Pay $100.",
        "act": {
          "kind": "money",
          "amount": -100
        }
      },
      {
        "text": "Your Chandni Chowk street food vlog goes viral. A ghee brand pays $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "You find crisp notes in an old kurta during Diwali cleaning. Collect $50.",
        "act": {
          "kind": "money",
          "amount": 50
        }
      },
      {
        "text": "Your 'waterproof' phone met the Holi bucket. Pay $60 for repairs.",
        "act": {
          "kind": "money",
          "amount": -60
        }
      },
      {
        "text": "The Vande Bharat hits top speed. Zoom to START and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Bollywood calls! Screen test in Mumbai. Move to Mumbai; collect salary if you pass START.",
        "act": {
          "kind": "moveTo",
          "tile": "priciest",
          "collect": true
        }
      },
      {
        "text": "Flight ticket flash sale ends tonight! Dash to the nearest airport. If owned, pay double rent.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Your visa interview got preponed. Rush to the nearest airport; if owned, pay double rent.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Inverter dies during the IPL final. Go to the nearest utility; if owned, pay 10x your dice roll.",
        "act": {
          "kind": "nearest",
          "target": "utility",
          "payMultiplier": 10
        }
      },
      {
        "text": "You walk back three stalls because that pani puri wala gives six, not five. Move back 3 spaces.",
        "act": {
          "kind": "moveBy",
          "n": -3
        }
      },
      {
        "text": "Promotion party! Chai and samosas for the whole table are on you. Pay each player $30.",
        "act": {
          "kind": "payEach",
          "amount": 30
        }
      },
      {
        "text": "The TC catches you ticketless on the local train. No jugaad will save you. Go to jail.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Seepage season. The painter quotes 'minimum' rates: pay $40 per house and $115 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 40,
          "hotel": 115
        }
      }
    ]
  },
  {
    "airports": [
      "JFK Airport",
      "ATL Airport",
      "ORD Airport",
      "LAX Airport"
    ],
    "cities": [
      {
        "name": "Birmingham",
        "group": "DS"
      },
      {
        "name": "Memphis",
        "group": "DS"
      },
      {
        "name": "Omaha",
        "group": "HL"
      },
      {
        "name": "Kansas City",
        "group": "HL"
      },
      {
        "name": "St. Louis",
        "group": "HL"
      },
      {
        "name": "Albuquerque",
        "group": "SW"
      },
      {
        "name": "Tucson",
        "group": "SW"
      },
      {
        "name": "Phoenix",
        "group": "SW"
      },
      {
        "name": "Cleveland",
        "group": "GL"
      },
      {
        "name": "Detroit",
        "group": "GL"
      },
      {
        "name": "Chicago",
        "group": "GL"
      },
      {
        "name": "San Antonio",
        "group": "TX"
      },
      {
        "name": "Dallas",
        "group": "TX"
      },
      {
        "name": "Austin",
        "group": "TX"
      },
      {
        "name": "Salt Lake City",
        "group": "MW"
      },
      {
        "name": "Las Vegas",
        "group": "MW"
      },
      {
        "name": "Denver",
        "group": "MW"
      },
      {
        "name": "San Diego",
        "group": "CA"
      },
      {
        "name": "Los Angeles",
        "group": "CA"
      },
      {
        "name": "San Francisco",
        "group": "CA"
      },
      {
        "name": "Boston",
        "group": "NE"
      },
      {
        "name": "New York City",
        "group": "NE"
      }
    ],
    "description": "From Memphis blues to Manhattan lights — buy up the land of the free, one deed at a time.",
    "groups": [
      {
        "key": "DS",
        "name": "Deep South",
        "color": "#9c6644",
        "flag": "🎺"
      },
      {
        "key": "HL",
        "name": "Heartland",
        "color": "#d9a13b",
        "flag": "🌽"
      },
      {
        "key": "SW",
        "name": "Southwest",
        "color": "#e2703a",
        "flag": "🌵"
      },
      {
        "key": "GL",
        "name": "Great Lakes",
        "color": "#3e8fc1",
        "flag": "🚗"
      },
      {
        "key": "TX",
        "name": "Texas",
        "color": "#d64545",
        "flag": "🤠"
      },
      {
        "key": "MW",
        "name": "Mountain West",
        "color": "#8f6fc9",
        "flag": "🏔️"
      },
      {
        "key": "CA",
        "name": "California",
        "color": "#4fa05f",
        "flag": "🌉"
      },
      {
        "key": "NE",
        "name": "Northeast",
        "color": "#5470d6",
        "flag": "🗽"
      }
    ],
    "icon": "🇺🇸",
    "id": "us",
    "name": "The American Dream",
    "surprise": [
      {
        "text": "A venture capitalist funds your app that rates gas station snacks. Collect $200 in seed money.",
        "act": {
          "kind": "money",
          "amount": 200
        }
      },
      {
        "text": "You breezed through the express toll lane without a pass. Pay $65 in 'convenience fees'.",
        "act": {
          "kind": "money",
          "amount": -65
        }
      },
      {
        "text": "Your true-crime podcast about a missing lawn gnome cracks the charts. Collect $110 in ad money.",
        "act": {
          "kind": "money",
          "amount": 110
        }
      },
      {
        "text": "The HOA fines you for your flock of lawn flamingos. Tacky? Iconic. Pay $30.",
        "act": {
          "kind": "money",
          "amount": -30
        }
      },
      {
        "text": "Your five-alarm chili takes the county fair by storm. Blue ribbon plus $75.",
        "act": {
          "kind": "money",
          "amount": 75
        }
      },
      {
        "text": "You hopped the scenic Amtrak home. Glide back to Start and collect your salary on arrival.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Broadway calls — you're cast as Tree #2! Advance to New York City. Collect salary if you pass Start.",
        "act": {
          "kind": "moveTo",
          "tile": "priciest",
          "collect": true
        }
      },
      {
        "text": "Gate change, again — sprint to the nearest Airport. If it's owned, pay the owner double the fare.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "You booked the cheap fare with two layovers. Advance to the nearest Airport; owner collects double.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "July heat wave: the whole block cranks the AC. Advance to the nearest Utility and pay 10x the dice.",
        "act": {
          "kind": "nearest",
          "target": "utility",
          "payMultiplier": 10
        }
      },
      {
        "text": "You left your phone at the diner. Go back 3 spaces and grab another slice of pie.",
        "act": {
          "kind": "moveBy",
          "n": -3
        }
      },
      {
        "text": "Your March Madness bracket busted in round one. Pay each player $30 and blame the refs.",
        "act": {
          "kind": "payEach",
          "amount": 30
        }
      },
      {
        "text": "You jaywalked in front of a rookie cop during the Fourth of July parade. Head straight to Jail.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "The inspector says your deck was 'built on vibes'. Pay $45 per house and $120 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 45,
          "hotel": 120
        }
      }
    ],
    "treasure": [
      {
        "text": "Your Thanksgiving turkey fry goes viral and nothing explodes. Sponsors kick in $120.",
        "act": {
          "kind": "money",
          "amount": 120
        }
      },
      {
        "text": "Monday-night miracle wins you the fantasy football league. Collect $100 and eternal bragging rights.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "Girl Scout cookie season: your doorstep resale empire nets $50.",
        "act": {
          "kind": "money",
          "amount": 50
        }
      },
      {
        "text": "Your tax refund lands right before Memorial Day weekend. Collect $150 and fire up the grill.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "A collector at your garage sale pays $80 for your 'vintage' baseball cards. Never doubt the attic.",
        "act": {
          "kind": "money",
          "amount": 80
        }
      },
      {
        "text": "You returned your shopping cart in the rain. A stranger salutes. The universe pays $20.",
        "act": {
          "kind": "money",
          "amount": 20
        }
      },
      {
        "text": "Jury duty turns out to be a two-day case about a fence. Collect $40 for your civic patience.",
        "act": {
          "kind": "money",
          "amount": 40
        }
      },
      {
        "text": "Your Super Bowl party's wing order got out of hand. Pay $75 and regret nothing.",
        "act": {
          "kind": "money",
          "amount": -75
        }
      },
      {
        "text": "Route 66 road trip! Top down, radio up — cruise back to Start and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Your PTO finally got approved. Head straight to Vacation — the lake house is waiting.",
        "act": {
          "kind": "moveTo",
          "tile": "vacation"
        }
      },
      {
        "text": "Your cousin passed the bar exam and owes you one. Keep this card to spring yourself from Jail.",
        "act": {
          "kind": "getout"
        }
      },
      {
        "text": "Caught scalping playoff tickets outside the stadium. Straight to Jail — no rain check.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Your backyard barbecue is legendary in three counties. Each player chips in $25 for brisket.",
        "act": {
          "kind": "collectEach",
          "amount": 25
        }
      },
      {
        "text": "Hurricane season roof inspection: pay $35 per house and $110 per hotel. Tarp not included.",
        "act": {
          "kind": "repairs",
          "house": 35,
          "hotel": 110
        }
      }
    ],
    "utilities": [
      {
        "name": "Liberty Power Co",
        "icon": "⚡"
      },
      {
        "name": "Old Glory Water",
        "icon": "💧"
      }
    ]
  },
  {
    "airports": [
      "LHR Airport",
      "MAN Airport",
      "EDI Airport",
      "BFS Airport"
    ],
    "cities": [
      {
        "name": "Derry",
        "group": "NI"
      },
      {
        "name": "Belfast",
        "group": "NI"
      },
      {
        "name": "Wrexham",
        "group": "CYM"
      },
      {
        "name": "Swansea",
        "group": "CYM"
      },
      {
        "name": "Cardiff",
        "group": "CYM"
      },
      {
        "name": "Sunderland",
        "group": "NE"
      },
      {
        "name": "Durham",
        "group": "NE"
      },
      {
        "name": "Newcastle",
        "group": "NE"
      },
      {
        "name": "Sheffield",
        "group": "YKS"
      },
      {
        "name": "York",
        "group": "YKS"
      },
      {
        "name": "Leeds",
        "group": "YKS"
      },
      {
        "name": "Stoke-on-Trent",
        "group": "MID"
      },
      {
        "name": "Nottingham",
        "group": "MID"
      },
      {
        "name": "Birmingham",
        "group": "MID"
      },
      {
        "name": "Dundee",
        "group": "SCO"
      },
      {
        "name": "Glasgow",
        "group": "SCO"
      },
      {
        "name": "Edinburgh",
        "group": "SCO"
      },
      {
        "name": "Blackpool",
        "group": "NW"
      },
      {
        "name": "Liverpool",
        "group": "NW"
      },
      {
        "name": "Manchester",
        "group": "NW"
      },
      {
        "name": "Brighton",
        "group": "SE"
      },
      {
        "name": "London",
        "group": "SE"
      }
    ],
    "description": "Queue politely, buy boldly: from Belfast to Big Ben, all of Blighty is up for grabs.",
    "groups": [
      {
        "key": "NI",
        "name": "Northern Ireland",
        "color": "#3BA55D",
        "flag": "☘️"
      },
      {
        "key": "CYM",
        "name": "Wales",
        "color": "#D9484A",
        "flag": "🐉"
      },
      {
        "key": "NE",
        "name": "North East England",
        "color": "#2E9FAF",
        "flag": "⚓"
      },
      {
        "key": "YKS",
        "name": "Yorkshire",
        "color": "#C9A227",
        "flag": "🫖"
      },
      {
        "key": "MID",
        "name": "The Midlands",
        "color": "#D95F2B",
        "flag": "⚙️"
      },
      {
        "key": "SCO",
        "name": "Scotland",
        "color": "#4A6FD1",
        "flag": "🥃"
      },
      {
        "key": "NW",
        "name": "North West England",
        "color": "#C255A1",
        "flag": "⚽"
      },
      {
        "key": "SE",
        "name": "London & South East",
        "color": "#8B5CF6",
        "flag": "👑"
      }
    ],
    "icon": "🇬🇧",
    "id": "gb",
    "name": "Blighty",
    "surprise": [
      {
        "text": "Your rainy-day fund matures. Given the weather, it's enormous. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "ULEZ camera clocks your beloved old banger. Pay $60.",
        "act": {
          "kind": "money",
          "amount": -60
        }
      },
      {
        "text": "Your showstopper bake goes viral on national telly. Sponsorships roll in — collect $200.",
        "act": {
          "kind": "money",
          "amount": 200
        }
      },
      {
        "text": "In the Wimbledon queue since dawn; a banker buys your spot. Collect $70.",
        "act": {
          "kind": "money",
          "amount": 70
        }
      },
      {
        "text": "The heating bill lands. Three jumpers were not enough. Pay $85.",
        "act": {
          "kind": "money",
          "amount": -85
        }
      },
      {
        "text": "The night bus miraculously stops outside your door. Advance to START and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "The Big Smoke is calling! Advance to London. Collect salary if you pass START.",
        "act": {
          "kind": "moveTo",
          "tile": "priciest",
          "collect": true
        }
      },
      {
        "text": "Fog grounds every runway but one. Advance to the nearest Airport; if owned, pay double the fee.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Half-term stampede! Advance to the nearest Airport; if owned, pay the owner double.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Half-time kettle surge! Advance to the nearest Utility; if owned, pay 10x the dice roll.",
        "act": {
          "kind": "nearest",
          "target": "utility",
          "payMultiplier": 10
        }
      },
      {
        "text": "You stood on the left of the escalator. Go back 3 spaces and think about what you did.",
        "act": {
          "kind": "moveBy",
          "n": -3
        }
      },
      {
        "text": "You let slip it's your birthday at the pub. Your round! Pay each player $30.",
        "act": {
          "kind": "payEach",
          "amount": 30
        }
      },
      {
        "text": "You put the milk in first on live telly. Straight to Prison, no appeal.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Storm season strips your guttering. Pay $40 per house and $115 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 40,
          "hotel": 115
        }
      }
    ],
    "treasure": [
      {
        "text": "Your Glastonbury resale ticket is actually real. Scenes in the mud — collect $100.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "Your Victoria sponge wins the village fete. The WI demands a recount. Collect $50.",
        "act": {
          "kind": "money",
          "amount": 50
        }
      },
      {
        "text": "Sunny bank holiday! Your beer garden table sells out by noon. Collect $80.",
        "act": {
          "kind": "money",
          "amount": 80
        }
      },
      {
        "text": "That dusty teapot you took to the antiques valuation? Georgian. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "Premium Bonds finally pay out after 40 years of hope. Collect $75.",
        "act": {
          "kind": "money",
          "amount": 75
        }
      },
      {
        "text": "Delay Repay actually approves your claim for leaves on the line. Collect $40.",
        "act": {
          "kind": "money",
          "amount": 40
        }
      },
      {
        "text": "A Brighton seagull nicks your entire fish supper. Pay $25 for round two.",
        "act": {
          "kind": "money",
          "amount": -25
        }
      },
      {
        "text": "You win the office sweepstake on the Grand National. Collect $60.",
        "act": {
          "kind": "money",
          "amount": 60
        }
      },
      {
        "text": "Your bank holiday plans go exactly to plan — a first. Advance to START and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "The sun is out in Cornwall. Drop everything and go to VACATION.",
        "act": {
          "kind": "moveTo",
          "tile": "vacation"
        }
      },
      {
        "text": "Your solicitor's very stern letter works wonders. Keep this to get out of Prison free.",
        "act": {
          "kind": "getout"
        }
      },
      {
        "text": "Caught jumping the queue at the post office. The nation gasps. Go to Prison.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "It's your round — but everyone still owes you from last time. Collect $25 from each player.",
        "act": {
          "kind": "collectEach",
          "amount": 25
        }
      },
      {
        "text": "The damp survey is grim reading. Pay $30 per house and $110 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 30,
          "hotel": 110
        }
      }
    ],
    "utilities": [
      {
        "name": "Kettle Power Co.",
        "icon": "⚡"
      },
      {
        "name": "Drizzle Water Co",
        "icon": "💧"
      }
    ]
  },
  {
    "id": "de",
    "name": "Deutschland",
    "icon": "🇩🇪",
    "description": "A tour of Germany, from Schwerin to Berlin — no speed limit on the rent.",
    "groups": [
      {
        "key": "MV",
        "name": "Mecklenburg-Vorpommern",
        "color": "#3fae8c",
        "flag": "⛵"
      },
      {
        "key": "SN",
        "name": "Sachsen",
        "color": "#8e5bd6",
        "flag": "🎻"
      },
      {
        "key": "NW",
        "name": "Nordrhein-Westfalen",
        "color": "#e08e39",
        "flag": "⚽"
      },
      {
        "key": "HAN",
        "name": "Hansestädte",
        "color": "#4a7dab",
        "flag": "⚓"
      },
      {
        "key": "HE",
        "name": "Hessen",
        "color": "#d05252",
        "flag": "🏦"
      },
      {
        "key": "BW",
        "name": "Baden-Württemberg",
        "color": "#d4507c",
        "flag": "🕰️"
      },
      {
        "key": "BY",
        "name": "Bayern",
        "color": "#5b8def",
        "flag": "🥨"
      },
      {
        "key": "BB",
        "name": "Hauptstadtregion",
        "color": "#c9a227",
        "flag": "🐻"
      }
    ],
    "cities": [
      {
        "name": "Schwerin",
        "group": "MV"
      },
      {
        "name": "Rostock",
        "group": "MV"
      },
      {
        "name": "Chemnitz",
        "group": "SN"
      },
      {
        "name": "Leipzig",
        "group": "SN"
      },
      {
        "name": "Dresden",
        "group": "SN"
      },
      {
        "name": "Dortmund",
        "group": "NW"
      },
      {
        "name": "Düsseldorf",
        "group": "NW"
      },
      {
        "name": "Köln",
        "group": "NW"
      },
      {
        "name": "Lübeck",
        "group": "HAN"
      },
      {
        "name": "Bremen",
        "group": "HAN"
      },
      {
        "name": "Hamburg",
        "group": "HAN"
      },
      {
        "name": "Kassel",
        "group": "HE"
      },
      {
        "name": "Wiesbaden",
        "group": "HE"
      },
      {
        "name": "Frankfurt",
        "group": "HE"
      },
      {
        "name": "Freiburg",
        "group": "BW"
      },
      {
        "name": "Heidelberg",
        "group": "BW"
      },
      {
        "name": "Stuttgart",
        "group": "BW"
      },
      {
        "name": "Augsburg",
        "group": "BY"
      },
      {
        "name": "Nürnberg",
        "group": "BY"
      },
      {
        "name": "München",
        "group": "BY"
      },
      {
        "name": "Potsdam",
        "group": "BB"
      },
      {
        "name": "Berlin",
        "group": "BB"
      }
    ],
    "airports": [
      "FRA Airport",
      "MUC Airport",
      "BER Airport",
      "HAM Airport"
    ],
    "utilities": [
      {
        "name": "Stadtwerke",
        "icon": "⚡"
      },
      {
        "name": "Wasserwerk",
        "icon": "🚰"
      }
    ],
    "treasure": [
      {
        "text": "You finally return the bottle crates. The Pfand machine sings. Collect $40.",
        "act": {
          "kind": "money",
          "amount": 40
        }
      },
      {
        "text": "Against all odds, your Steuererklärung comes back positive. Collect $120.",
        "act": {
          "kind": "money",
          "amount": 120
        }
      },
      {
        "text": "Your Schrebergarten wins 'Prettiest Plot'. The committee pays $75, grudgingly.",
        "act": {
          "kind": "money",
          "amount": 75
        }
      },
      {
        "text": "Oma tucks $50 into your jacket pocket. Refusing is not an option.",
        "act": {
          "kind": "money",
          "amount": 50
        }
      },
      {
        "text": "Your Sparbuch pays interest for the first time in a decade. Collect $25.",
        "act": {
          "kind": "money",
          "amount": 25
        }
      },
      {
        "text": "You win the office Bundesliga Tippspiel on goal difference. Collect $60.",
        "act": {
          "kind": "money",
          "amount": 60
        }
      },
      {
        "text": "The Rundfunkbeitrag letter finds you. It always finds you. Pay $55.",
        "act": {
          "kind": "money",
          "amount": -55
        }
      },
      {
        "text": "'Just one Brötchen' becomes a full bakery bag. Pay $20.",
        "act": {
          "kind": "money",
          "amount": -20
        }
      },
      {
        "text": "Miracle on the A1: no Stau, no Baustelle. Advance to START and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Brückentag! One day off becomes four. Head straight to Vacation.",
        "act": {
          "kind": "moveTo",
          "tile": "vacation"
        }
      },
      {
        "text": "You filed the correct form, in triplicate, on time. Get out of prison free. Keep this card.",
        "act": {
          "kind": "getout"
        }
      },
      {
        "text": "You crossed on red in front of children. The shame is enormous. Go to prison!",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "You host a proper Grillabend. Everyone chips in for Bratwurst. Collect $20 from every player.",
        "act": {
          "kind": "collectEach",
          "amount": 20
        }
      },
      {
        "text": "Altbau charm, Altbau pipes. Pay $40 per house and $115 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 40,
          "hotel": 115
        }
      }
    ],
    "surprise": [
      {
        "text": "Blitzed doing 160 where 120 was posted. The photo is unflattering. Pay $80.",
        "act": {
          "kind": "money",
          "amount": -80
        }
      },
      {
        "text": "You found a free table at Oktoberfest and sublet it. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "Your startup wins a Berlin hackathon with one slide and pure confidence. Collect $200.",
        "act": {
          "kind": "money",
          "amount": 200
        }
      },
      {
        "text": "Quiet time starts at 22:00 sharp. Your party did not. Pay $70.",
        "act": {
          "kind": "money",
          "amount": -70
        }
      },
      {
        "text": "Your train arrives 61 minutes late — the magic number. Delay refund: collect $25.",
        "act": {
          "kind": "money",
          "amount": 25
        }
      },
      {
        "text": "Green wave! Every Ampel turns green just for you. Advance to START and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "The club doorman nods. Unbelievable. Advance to Berlin, the priciest spot on the board.",
        "act": {
          "kind": "moveTo",
          "tile": "priciest",
          "collect": true
        }
      },
      {
        "text": "Warnstreik! Your flight leaves right now. Advance to the nearest Airport and pay double rent.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Last call for the Mallorca charter. Run! Advance to the nearest Airport and pay double rent.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Heating past level 3 in October. Advance to the nearest Utility and pay 10x your dice roll.",
        "act": {
          "kind": "nearest",
          "target": "utility",
          "payMultiplier": 10
        }
      },
      {
        "text": "You left your Hausschuhe at home. Unthinkable. Go back three spaces.",
        "act": {
          "kind": "moveBy",
          "n": -3
        }
      },
      {
        "text": "You lose a round of Skat spectacularly. Drinks on you — pay each player $30.",
        "act": {
          "kind": "payEach",
          "amount": 30
        }
      },
      {
        "text": "Caught mowing the lawn on a Sunday. The neighbors saw everything. Go to prison!",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "The building inspector is wonderfully gründlich. Pay $30 per house and $110 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 30,
          "hotel": 110
        }
      }
    ]
  },
  {
    "id": "fr",
    "name": "L'Hexagone",
    "icon": "🇫🇷",
    "description": "From Breton crêpes to Parisian rooftops — buy the Hexagon one baguette at a time.",
    "groups": [
      {
        "key": "HDF",
        "name": "Hauts-de-France",
        "color": "#B4654A",
        "flag": "🍟"
      },
      {
        "key": "BRE",
        "name": "Bretagne",
        "color": "#3A9FBF",
        "flag": "🥞"
      },
      {
        "key": "OCC",
        "name": "Occitanie",
        "color": "#D9822B",
        "flag": "🏉"
      },
      {
        "key": "NAQ",
        "name": "Nouvelle-Aquitaine",
        "color": "#B05C7F",
        "flag": "🍷"
      },
      {
        "key": "GES",
        "name": "Grand Est",
        "color": "#C99A2E",
        "flag": "🥨"
      },
      {
        "key": "ARA",
        "name": "Auvergne-Rhône-Alpes",
        "color": "#4F9D5D",
        "flag": "🏔️"
      },
      {
        "key": "PAC",
        "name": "Provence-Côte d'Azur",
        "color": "#9678D3",
        "flag": "🪻"
      },
      {
        "key": "IDF",
        "name": "Île-de-France",
        "color": "#4A6FD4",
        "flag": "🗼"
      }
    ],
    "cities": [
      {
        "name": "Amiens",
        "group": "HDF"
      },
      {
        "name": "Lille",
        "group": "HDF"
      },
      {
        "name": "Brest",
        "group": "BRE"
      },
      {
        "name": "Quimper",
        "group": "BRE"
      },
      {
        "name": "Rennes",
        "group": "BRE"
      },
      {
        "name": "Perpignan",
        "group": "OCC"
      },
      {
        "name": "Montpellier",
        "group": "OCC"
      },
      {
        "name": "Toulouse",
        "group": "OCC"
      },
      {
        "name": "La Rochelle",
        "group": "NAQ"
      },
      {
        "name": "Biarritz",
        "group": "NAQ"
      },
      {
        "name": "Bordeaux",
        "group": "NAQ"
      },
      {
        "name": "Reims",
        "group": "GES"
      },
      {
        "name": "Colmar",
        "group": "GES"
      },
      {
        "name": "Strasbourg",
        "group": "GES"
      },
      {
        "name": "Grenoble",
        "group": "ARA"
      },
      {
        "name": "Annecy",
        "group": "ARA"
      },
      {
        "name": "Lyon",
        "group": "ARA"
      },
      {
        "name": "Marseille",
        "group": "PAC"
      },
      {
        "name": "Cannes",
        "group": "PAC"
      },
      {
        "name": "Nice",
        "group": "PAC"
      },
      {
        "name": "Versailles",
        "group": "IDF"
      },
      {
        "name": "Paris",
        "group": "IDF"
      }
    ],
    "airports": [
      "CDG Airport",
      "NCE Airport",
      "LYS Airport",
      "BOD Airport"
    ],
    "utilities": [
      {
        "name": "Volt Hexagone",
        "icon": "⚡"
      },
      {
        "name": "Eaux Gauloises",
        "icon": "💧"
      }
    ],
    "treasure": [
      {
        "text": "Your boulangerie wins Best Baguette — the Élysée now orders daily. Collect $100.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "Your crêpe stand at the Fête de la Musique sells out by 9pm. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "You win the village pétanque tournament, undefeated on gravel. Collect $80.",
        "act": {
          "kind": "money",
          "amount": 80
        }
      },
      {
        "text": "A film crew shoots in your Montmartre courtyard. Location fee: collect $120.",
        "act": {
          "kind": "money",
          "amount": 120
        }
      },
      {
        "text": "August: the whole office is at the beach and you watered the plants. Bonus $60.",
        "act": {
          "kind": "money",
          "amount": 60
        }
      },
      {
        "text": "You find forgotten cash in your raclette sweater from last winter. Collect $30.",
        "act": {
          "kind": "money",
          "amount": 30
        }
      },
      {
        "text": "You knock over a pyramid of macarons at the pâtisserie. Pay $50.",
        "act": {
          "kind": "money",
          "amount": -50
        }
      },
      {
        "text": "The oyster splurge at the Christmas market got out of hand. Pay $100.",
        "act": {
          "kind": "money",
          "amount": -100
        }
      },
      {
        "text": "The TGV hits 300 km/h and you nap through every stop. Advance to Start and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Les grandes vacances! Out-of-office on until September. Head to Vacation.",
        "act": {
          "kind": "moveTo",
          "tile": "vacation"
        }
      },
      {
        "text": "Your lawyer pleads with such flair the judge applauds. Keep this card to leave Prison for free.",
        "act": {
          "kind": "getout"
        }
      },
      {
        "text": "You cut the Saturday queue at the boulangerie. Unforgivable. Go directly to Prison.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Your fondue night is legendary; every friend chips in for the cheese. Collect $25 from each player.",
        "act": {
          "kind": "collectEach",
          "amount": 25
        }
      },
      {
        "text": "Storm season rattles your zinc rooftops. Pay $30 per house and $110 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 30,
          "hotel": 110
        }
      }
    ],
    "surprise": [
      {
        "text": "Your start-up pitch at a Paris tech fair gets a standing ovation. Collect $200.",
        "act": {
          "kind": "money",
          "amount": 200
        }
      },
      {
        "text": "You call the Tour de France podium in the office pool. Collect $100.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "Fined for picnicking on a pristine château lawn. The gendarme keeps your saucisson. Pay $60.",
        "act": {
          "kind": "money",
          "amount": -60
        }
      },
      {
        "text": "You parked à la parisienne — bumper to bumper, literally. Pay $80 for the scratches.",
        "act": {
          "kind": "money",
          "amount": -80
        }
      },
      {
        "text": "A lost tourist pays for directions delivered in flawless franglais. Collect $50.",
        "act": {
          "kind": "money",
          "amount": 50
        }
      },
      {
        "text": "Métro strike! You walk the whole way and discover you love it. Advance to Start and collect salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Fashion Week declares your look très chic. Advance to Paris; collect salary if you pass Start.",
        "act": {
          "kind": "moveTo",
          "tile": "priciest",
          "collect": true
        }
      },
      {
        "text": "Last-minute seats to the sun! Dash to the nearest Airport. If it's owned, pay double the fee.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Your cousin's wedding in Corsica won't wait. Fly to the nearest Airport; if owned, pay double.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Heatwave! Every fan in France is sold out. Go to the nearest Utility; if owned, pay 10x the dice.",
        "act": {
          "kind": "nearest",
          "target": "utility",
          "payMultiplier": 10
        }
      },
      {
        "text": "You left your tote at the fromagerie. Go back 3 spaces before the camembert ripens.",
        "act": {
          "kind": "moveBy",
          "n": -3
        }
      },
      {
        "text": "You lose a rugby bet and owe the whole café a round. Pay each player $30.",
        "act": {
          "kind": "payEach",
          "amount": 30
        }
      },
      {
        "text": "Caught hopping the métro turnstile with a baguette as a vaulting pole. Go directly to Prison.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "The heritage inspector adores your shutters but not your gutters. Pay $45 per house, $120 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 45,
          "hotel": 120
        }
      }
    ]
  },
  {
    "id": "it",
    "name": "Il Bel Paese",
    "icon": "🇮🇹",
    "description": "Buy the boot from Sicilian piazzas to Roman palazzi — espresso rights included.",
    "groups": [
      {
        "key": "PUG",
        "name": "Puglia",
        "color": "#7fae3f",
        "flag": "🫒"
      },
      {
        "key": "SIC",
        "name": "Sicilia",
        "color": "#e2703a",
        "flag": "🌋"
      },
      {
        "key": "CAM",
        "name": "Campania",
        "color": "#3f9ad6",
        "flag": "🍕"
      },
      {
        "key": "EMR",
        "name": "Emilia-Romagna",
        "color": "#d64545",
        "flag": "🏎️"
      },
      {
        "key": "TOS",
        "name": "Toscana",
        "color": "#9c5bb8",
        "flag": "🍷"
      },
      {
        "key": "VEN",
        "name": "Veneto",
        "color": "#2fb8a0",
        "flag": "🎭"
      },
      {
        "key": "LOM",
        "name": "Lombardia",
        "color": "#5b6ee0",
        "flag": "👠"
      },
      {
        "key": "LAZ",
        "name": "Lazio",
        "color": "#c9a227",
        "flag": "🏛️"
      }
    ],
    "cities": [
      {
        "name": "Bari",
        "group": "PUG"
      },
      {
        "name": "Lecce",
        "group": "PUG"
      },
      {
        "name": "Palermo",
        "group": "SIC"
      },
      {
        "name": "Catania",
        "group": "SIC"
      },
      {
        "name": "Taormina",
        "group": "SIC"
      },
      {
        "name": "Napoli",
        "group": "CAM"
      },
      {
        "name": "Sorrento",
        "group": "CAM"
      },
      {
        "name": "Amalfi",
        "group": "CAM"
      },
      {
        "name": "Parma",
        "group": "EMR"
      },
      {
        "name": "Modena",
        "group": "EMR"
      },
      {
        "name": "Bologna",
        "group": "EMR"
      },
      {
        "name": "Pisa",
        "group": "TOS"
      },
      {
        "name": "Siena",
        "group": "TOS"
      },
      {
        "name": "Firenze",
        "group": "TOS"
      },
      {
        "name": "Padova",
        "group": "VEN"
      },
      {
        "name": "Verona",
        "group": "VEN"
      },
      {
        "name": "Venezia",
        "group": "VEN"
      },
      {
        "name": "Bergamo",
        "group": "LOM"
      },
      {
        "name": "Como",
        "group": "LOM"
      },
      {
        "name": "Milano",
        "group": "LOM"
      },
      {
        "name": "Tivoli",
        "group": "LAZ"
      },
      {
        "name": "Roma",
        "group": "LAZ"
      }
    ],
    "airports": [
      "NAP Airport",
      "CTA Airport",
      "MXP Airport",
      "FCO Airport"
    ],
    "utilities": [
      {
        "name": "Rete Elettrica",
        "icon": "⚡"
      },
      {
        "name": "Acquedotto",
        "icon": "🚰"
      }
    ],
    "treasure": [
      {
        "text": "Nonna says you're too skinny and slips cash in your coat. No refusing. Collect $100.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "You bet on the underdog contrada at the Palio di Siena. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "Superbonus! The state refunds your trullo's new roof. Collect $110.",
        "act": {
          "kind": "money",
          "amount": 110
        }
      },
      {
        "text": "A collector in Modena buys your grandfather's Vespa at full shine. Collect $140.",
        "act": {
          "kind": "money",
          "amount": 140
        }
      },
      {
        "text": "Your Puglia olive harvest breaks the frantoio's records. Collect $75.",
        "act": {
          "kind": "money",
          "amount": 75
        }
      },
      {
        "text": "Your tiramisu wins first prize at the village sagra. Collect $50.",
        "act": {
          "kind": "money",
          "amount": 50
        }
      },
      {
        "text": "You sat down for espresso in Piazza San Marco. The seated price: pay $60.",
        "act": {
          "kind": "money",
          "amount": -60
        }
      },
      {
        "text": "A ZTL camera catches your Fiat in the centro storico. Pay $90.",
        "act": {
          "kind": "money",
          "amount": -90
        }
      },
      {
        "text": "Your Frecciarossa hits 300 km/h. Ride it all the way to START and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Ferragosto! The whole country is at the beach. Join them on Vacation.",
        "act": {
          "kind": "moveTo",
          "tile": "vacation"
        }
      },
      {
        "text": "Your avvocato finds a friendly comma in a 1942 law. Get out of prison free. Keep this card.",
        "act": {
          "kind": "getout"
        }
      },
      {
        "text": "You put cream in the carbonara on live TV. Go directly to prison.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "It's your laurea! Laurel crown on, party at yours. Collect $25 from every player.",
        "act": {
          "kind": "collectEach",
          "amount": 25
        }
      },
      {
        "text": "Restoration season: scaffolding wraps all your facades. Pay $35 per house and $110 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 35,
          "hotel": 110
        }
      }
    ],
    "surprise": [
      {
        "text": "Milan Fashion Week books your rooftop for a runway. Collect $200.",
        "act": {
          "kind": "money",
          "amount": 200
        }
      },
      {
        "text": "Your dog sniffs out a white truffle near Alba. Collect $180.",
        "act": {
          "kind": "money",
          "amount": 180
        }
      },
      {
        "text": "Your fantacalcio squad sweeps the whole season. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "Two sunbeds and an umbrella in Rimini, high season. Pay $95.",
        "act": {
          "kind": "money",
          "amount": -95
        }
      },
      {
        "text": "You ordered a cappuccino after lunch. The waiter's stare costs $75.",
        "act": {
          "kind": "money",
          "amount": -75
        }
      },
      {
        "text": "Tailwind on the coast road. Scooter straight to START and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "All roads lead to Roma. Advance there; collect salary if you pass START.",
        "act": {
          "kind": "moveTo",
          "tile": "priciest",
          "collect": true
        }
      },
      {
        "text": "Sciopero! Trains halt nationwide. Dash to the nearest Airport; if owned, pay double rent.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "A $9 flight deal expires tonight. Sprint to the nearest Airport; if owned, pay double rent.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Every fountain in town must flow for the festa. Nearest Utility; if owned, pay 10x your roll.",
        "act": {
          "kind": "nearest",
          "target": "utility",
          "payMultiplier": 10
        }
      },
      {
        "text": "You strolled against the passeggiata current. Go back 3 spaces.",
        "act": {
          "kind": "moveBy",
          "n": -3
        }
      },
      {
        "text": "Your side loses the derby. Pizza for the whole table is on you. Pay each player $40.",
        "act": {
          "kind": "payEach",
          "amount": 40
        }
      },
      {
        "text": "You dove in the box and VAR saw everything. Go directly to prison.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Acqua alta laps at your doorsteps. Pay $40 per house and $115 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 40,
          "hotel": 115
        }
      }
    ]
  },
  {
    "airports": [
      "MAD Airport",
      "BCN Airport",
      "AGP Airport",
      "BIO Airport"
    ],
    "cities": [
      {
        "name": "Mérida",
        "group": "EXT"
      },
      {
        "name": "Cáceres",
        "group": "EXT"
      },
      {
        "name": "León",
        "group": "CYL"
      },
      {
        "name": "Burgos",
        "group": "CYL"
      },
      {
        "name": "Salamanca",
        "group": "CYL"
      },
      {
        "name": "Vigo",
        "group": "GAL"
      },
      {
        "name": "A Coruña",
        "group": "GAL"
      },
      {
        "name": "Santiago",
        "group": "GAL"
      },
      {
        "name": "Elche",
        "group": "VAL"
      },
      {
        "name": "Alicante",
        "group": "VAL"
      },
      {
        "name": "Valencia",
        "group": "VAL"
      },
      {
        "name": "Granada",
        "group": "AND"
      },
      {
        "name": "Sevilla",
        "group": "AND"
      },
      {
        "name": "Málaga",
        "group": "AND"
      },
      {
        "name": "Vitoria",
        "group": "EUS"
      },
      {
        "name": "Bilbao",
        "group": "EUS"
      },
      {
        "name": "San Sebastián",
        "group": "EUS"
      },
      {
        "name": "Tarragona",
        "group": "CAT"
      },
      {
        "name": "Girona",
        "group": "CAT"
      },
      {
        "name": "Barcelona",
        "group": "CAT"
      },
      {
        "name": "Alcalá de Henares",
        "group": "MAD"
      },
      {
        "name": "Madrid",
        "group": "MAD"
      }
    ],
    "description": "Twelve grapes, one peninsula: buy Spain city by city, from the dehesa to the Gran Vía.",
    "groups": [
      {
        "key": "EXT",
        "name": "Extremadura",
        "color": "#A9713B",
        "flag": "🐖"
      },
      {
        "key": "CYL",
        "name": "Castilla y León",
        "color": "#9061C2",
        "flag": "🏰"
      },
      {
        "key": "GAL",
        "name": "Galicia",
        "color": "#3B9EA8",
        "flag": "🐙"
      },
      {
        "key": "VAL",
        "name": "C. Valenciana",
        "color": "#E58E26",
        "flag": "🥘"
      },
      {
        "key": "AND",
        "name": "Andalucía",
        "color": "#4EA654",
        "flag": "💃"
      },
      {
        "key": "EUS",
        "name": "Euskadi",
        "color": "#CB4C4C",
        "flag": "🍢"
      },
      {
        "key": "CAT",
        "name": "Cataluña",
        "color": "#C9A227",
        "flag": "🦎"
      },
      {
        "key": "MAD",
        "name": "Comunidad de Madrid",
        "color": "#4A72D8",
        "flag": "🐻"
      }
    ],
    "icon": "🇪🇸",
    "id": "es",
    "name": "España",
    "surprise": [
      {
        "text": "Your San Fermín sprint makes the evening news — fastest trainers in Pamplona. Collect $200.",
        "act": {
          "kind": "money",
          "amount": 200
        }
      },
      {
        "text": "A radar on the A-2 flashes twice: once for you, once for luck. Pay $100.",
        "act": {
          "kind": "money",
          "amount": -100
        }
      },
      {
        "text": "You defend tortilla WITH onion on live TV and win the national debate. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "You reach the beach at 9 am. The front-row umbrellas were staked out at 7. Pay $75 for row two.",
        "act": {
          "kind": "money",
          "amount": -75
        }
      },
      {
        "text": "Your Benidorm flat is booked solid from June to September. Collect $120.",
        "act": {
          "kind": "money",
          "amount": 120
        }
      },
      {
        "text": "The AVE hits 300 km/h and leaves on time. A miracle! Ride it to START and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Job interview on Gran Vía! Advance to Madrid. If you pass START, collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "priciest",
          "collect": true
        }
      },
      {
        "text": "Puente weekend — half of Spain flies at once. Nearest airport; if owned, pay double rent.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Your cabin bag is 2 cm too big for the low-cost gauge. Nearest airport; if owned, pay double rent.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Heatwave: every fan in Spain switches on at 3 pm. Nearest utility; if owned, pay 10x the dice roll.",
        "act": {
          "kind": "nearest",
          "target": "utility",
          "payMultiplier": 10
        }
      },
      {
        "text": "You miss your exit on the roundabout. Don't worry, there's another roundabout. Go back 3 spaces.",
        "act": {
          "kind": "moveBy",
          "n": -3
        }
      },
      {
        "text": "It's your santo! Tradition is merciless: today you treat everyone. Pay each player $30.",
        "act": {
          "kind": "payEach",
          "amount": 30
        }
      },
      {
        "text": "You ran a blender at 4 pm during siesta hours. The neighbours' verdict is unanimous: off to jail.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "A gota fría bursts over your street in October. Pay $40 per house and $115 per hotel for repairs.",
        "act": {
          "kind": "repairs",
          "house": 40,
          "hotel": 115
        }
      }
    ],
    "treasure": [
      {
        "text": "Sunday lunch at abuela's: she slips $100 into your pocket and refuses all argument. Collect it.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "You win the village paella contest — your secret was letting the socarrat happen. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "The office's shared El Gordo décimo wins a little pellizco. Your cut: collect $80.",
        "act": {
          "kind": "money",
          "amount": 80
        }
      },
      {
        "text": "You finish the Camino de Santiago and your blisters finally forgive you. Collect $70.",
        "act": {
          "kind": "money",
          "amount": 70
        }
      },
      {
        "text": "Menú del día: three courses, bread, wine AND coffee included. Collect the $40 you didn't spend.",
        "act": {
          "kind": "money",
          "amount": 40
        }
      },
      {
        "text": "Harvest week in La Rioja — you stomp grapes by day and sing by night. Collect $110.",
        "act": {
          "kind": "money",
          "amount": 110
        }
      },
      {
        "text": "You said the next round of tapas was on you. Then the next three. Pay $60.",
        "act": {
          "kind": "money",
          "amount": -60
        }
      },
      {
        "text": "Your landlord raises the rent because the flat 'gets great light'. Pay $90.",
        "act": {
          "kind": "money",
          "amount": -90
        }
      },
      {
        "text": "Midnight at Puerta del Sol: twelve grapes, twelve wishes. Advance to START and collect your pay.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "It's August. Your office, your bar and your gym are all closed. Go on VACATION like everyone else.",
        "act": {
          "kind": "moveTo",
          "tile": "vacation"
        }
      },
      {
        "text": "Your gestor finds the exact form, stamped in triplicate. This card walks you out of jail at no cost.",
        "act": {
          "kind": "getout"
        }
      },
      {
        "text": "You put chorizo in a paella on national TV. Valencia has spoken: straight to jail, no excuses.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "July, 5 pm: your terrace is the only one with shade. Every player pays you $25 for a chair.",
        "act": {
          "kind": "collectEach",
          "amount": 25
        }
      },
      {
        "text": "The comunidad de vecinos finally votes to fix the lift. Pay $30 per house and $110 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 30,
          "hotel": 110
        }
      }
    ],
    "utilities": [
      {
        "name": "Luz Ibérica",
        "icon": "⚡"
      },
      {
        "name": "Aguas del Ebro",
        "icon": "💧"
      }
    ]
  },
  {
    "airports": [
      "HND Airport",
      "KIX Airport",
      "CTS Airport",
      "FUK Airport"
    ],
    "cities": [
      {
        "name": "Matsuyama",
        "group": "SK"
      },
      {
        "name": "Takamatsu",
        "group": "SK"
      },
      {
        "name": "Matsue",
        "group": "CG"
      },
      {
        "name": "Okayama",
        "group": "CG"
      },
      {
        "name": "Hiroshima",
        "group": "CG"
      },
      {
        "name": "Aomori",
        "group": "TH"
      },
      {
        "name": "Morioka",
        "group": "TH"
      },
      {
        "name": "Sendai",
        "group": "TH"
      },
      {
        "name": "Naha",
        "group": "KY"
      },
      {
        "name": "Kagoshima",
        "group": "KY"
      },
      {
        "name": "Fukuoka",
        "group": "KY"
      },
      {
        "name": "Hakodate",
        "group": "HK"
      },
      {
        "name": "Otaru",
        "group": "HK"
      },
      {
        "name": "Sapporo",
        "group": "HK"
      },
      {
        "name": "Kanazawa",
        "group": "CB"
      },
      {
        "name": "Nagano",
        "group": "CB"
      },
      {
        "name": "Nagoya",
        "group": "CB"
      },
      {
        "name": "Kobe",
        "group": "KS"
      },
      {
        "name": "Kyoto",
        "group": "KS"
      },
      {
        "name": "Osaka",
        "group": "KS"
      },
      {
        "name": "Yokohama",
        "group": "KT"
      },
      {
        "name": "Tokyo",
        "group": "KT"
      }
    ],
    "description": "From Shikoku citrus groves to Shibuya neon — buy Japan one bullet-train stop at a time.",
    "groups": [
      {
        "key": "SK",
        "name": "Shikoku",
        "color": "#DF8636",
        "flag": "🍊"
      },
      {
        "key": "CG",
        "name": "Chugoku",
        "color": "#8F9E3D",
        "flag": "⛩️"
      },
      {
        "key": "TH",
        "name": "Tohoku",
        "color": "#2AA7A8",
        "flag": "🍎"
      },
      {
        "key": "KY",
        "name": "Kyushu & Okinawa",
        "color": "#D14D5E",
        "flag": "🌋"
      },
      {
        "key": "HK",
        "name": "Hokkaido",
        "color": "#8B6FC9",
        "flag": "⛷️"
      },
      {
        "key": "CB",
        "name": "Chubu",
        "color": "#4E8FD9",
        "flag": "🗻"
      },
      {
        "key": "KS",
        "name": "Kansai",
        "color": "#3F9E63",
        "flag": "🍵"
      },
      {
        "key": "KT",
        "name": "Kanto",
        "color": "#C9518F",
        "flag": "🗼"
      }
    ],
    "icon": "🇯🇵",
    "id": "jp",
    "name": "Nippon",
    "surprise": [
      {
        "text": "You eat a full bento on a packed local train. The silent auntie glare demands penance. Pay $50.",
        "act": {
          "kind": "money",
          "amount": -50
        }
      },
      {
        "text": "Your capsule-hotel review tops the travel rankings; a booking site sponsors you. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "The Shuto Expressway camera never blinks. Speeding fine: pay $100.",
        "act": {
          "kind": "money",
          "amount": -100
        }
      },
      {
        "text": "You win the shotengai year-of-ramen lottery and trade the coupons for cash. Collect $200.",
        "act": {
          "kind": "money",
          "amount": 200
        }
      },
      {
        "text": "Fifth clear umbrella this rainy season, left at the izakaya again. Pay $30.",
        "act": {
          "kind": "money",
          "amount": -30
        }
      },
      {
        "text": "Your one-car local train departs to the second, as always. Advance to Start and collect salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Shibuya's neon is calling. Night bus to Tokyo! If you pass Start, collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "priciest",
          "collect": true
        }
      },
      {
        "text": "Snow closes the runway up north. Rebook and dash to the nearest airport. If owned, pay double rent.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Cheap seats to the Sapporo Snow Festival! Race to the nearest airport. If owned, pay double rent.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Heated toilet seat left on all winter. Go to the nearest utility; if owned, pay 10x the dice.",
        "act": {
          "kind": "nearest",
          "target": "utility",
          "payMultiplier": 10
        }
      },
      {
        "text": "You bow farewell, then keep bowing all the way down the platform. Shuffle back 3 spaces.",
        "act": {
          "kind": "moveBy",
          "n": -3
        }
      },
      {
        "text": "You hogged the karaoke mic past midnight; the overtime room fee is on you. Pay each player $35.",
        "act": {
          "kind": "payEach",
          "amount": 35
        }
      },
      {
        "text": "Riding the Yamanote loop all afternoon on one 140-yen ticket? The gates know. Go to Prison.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Seismic retrofit inspection week. Pay $40 per house, $115 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 40,
          "hotel": 115
        }
      }
    ],
    "treasure": [
      {
        "text": "Your konbini egg sando goes viral with tourists. The queue wraps the block. Collect $100.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "You hand a lost wallet in at the koban; the owner returns with a gift envelope. Collect $50.",
        "act": {
          "kind": "money",
          "amount": 50
        }
      },
      {
        "text": "The sakura forecast lands exactly on your hanami picnic. You sublet prime tarp space. Collect $80.",
        "act": {
          "kind": "money",
          "amount": 80
        }
      },
      {
        "text": "Your 300-yen gacha capsule hides the ultra-rare figure. A collector pays up. Collect $120.",
        "act": {
          "kind": "money",
          "amount": 120
        }
      },
      {
        "text": "You doze past your stop on the last train and wake at the depot. Taxi home: pay $60.",
        "act": {
          "kind": "money",
          "amount": -60
        }
      },
      {
        "text": "Your office Koshien bracket comes in first. Snack-fund glory. Collect $40.",
        "act": {
          "kind": "money",
          "amount": 40
        }
      },
      {
        "text": "Akihabara buys your mint first-print manga collection. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "A typhoon cancels the ferry, but your travel insurance actually pays out. Collect $70.",
        "act": {
          "kind": "money",
          "amount": 70
        }
      },
      {
        "text": "Hatsumode omikuji: GREAT BLESSING. Advance to Start and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Golden Week! Shinkansen booked, onsen towel rolled. Off to Vacation you go.",
        "act": {
          "kind": "moveTo",
          "tile": "vacation"
        }
      },
      {
        "text": "A kindly station master stamps your pass VALID ANYWHERE. Keep this card to leave Prison at no cost.",
        "act": {
          "kind": "getout"
        }
      },
      {
        "text": "You used flash photography at morning sumo practice. The oyakata escorts you to Prison.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Your matsuri takoyaki stall sells out before the fireworks. Collect $30 from each player.",
        "act": {
          "kind": "collectEach",
          "amount": 30
        }
      },
      {
        "text": "Fresh tatami and new shoji screens across your properties. Pay $30 per house, $110 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 30,
          "hotel": 110
        }
      }
    ],
    "utilities": [
      {
        "name": "Denki Power Co.",
        "icon": "⚡"
      },
      {
        "name": "Onsen Waterworks",
        "icon": "♨️"
      }
    ]
  },
  {
    "airports": [
      "PEK Airport",
      "PVG Airport",
      "CAN Airport",
      "CTU Airport"
    ],
    "cities": [
      {
        "name": "Kashgar",
        "group": "XB"
      },
      {
        "name": "Urumqi",
        "group": "XB"
      },
      {
        "name": "Changchun",
        "group": "DB"
      },
      {
        "name": "Harbin",
        "group": "DB"
      },
      {
        "name": "Shenyang",
        "group": "DB"
      },
      {
        "name": "Lanzhou",
        "group": "HH"
      },
      {
        "name": "Zhengzhou",
        "group": "HH"
      },
      {
        "name": "Xi'an",
        "group": "HH"
      },
      {
        "name": "Nanchang",
        "group": "HZ"
      },
      {
        "name": "Changsha",
        "group": "HZ"
      },
      {
        "name": "Wuhan",
        "group": "HZ"
      },
      {
        "name": "Kunming",
        "group": "XN"
      },
      {
        "name": "Chongqing",
        "group": "XN"
      },
      {
        "name": "Chengdu",
        "group": "XN"
      },
      {
        "name": "Suzhou",
        "group": "JN"
      },
      {
        "name": "Nanjing",
        "group": "JN"
      },
      {
        "name": "Hangzhou",
        "group": "JN"
      },
      {
        "name": "Zhuhai",
        "group": "PRD"
      },
      {
        "name": "Guangzhou",
        "group": "PRD"
      },
      {
        "name": "Shenzhen",
        "group": "PRD"
      },
      {
        "name": "Beijing",
        "group": "JH"
      },
      {
        "name": "Shanghai",
        "group": "JH"
      }
    ],
    "description": "Hotpot, high-speed rail and the Bund — five thousand years, one property empire.",
    "groups": [
      {
        "key": "XB",
        "name": "Silk Road Northwest",
        "color": "#A9784F",
        "flag": "🐪"
      },
      {
        "key": "DB",
        "name": "Dongbei",
        "color": "#5FA8DC",
        "flag": "❄️"
      },
      {
        "key": "HH",
        "name": "Yellow River Valley",
        "color": "#C9A227",
        "flag": "🏺"
      },
      {
        "key": "HZ",
        "name": "Middle Yangtze",
        "color": "#E2703A",
        "flag": "🌶️"
      },
      {
        "key": "XN",
        "name": "The Southwest",
        "color": "#4FA05E",
        "flag": "🐼"
      },
      {
        "key": "JN",
        "name": "Jiangnan Delta",
        "color": "#3AA79B",
        "flag": "🍵"
      },
      {
        "key": "PRD",
        "name": "Pearl River Delta",
        "color": "#9067C6",
        "flag": "🥟"
      },
      {
        "key": "JH",
        "name": "Jing-Hu Municipalities",
        "color": "#D0453E",
        "flag": "🐉"
      }
    ],
    "icon": "🇨🇳",
    "id": "cn",
    "name": "Zhongguo",
    "surprise": [
      {
        "text": "Your clip of a grandpa breakdancing at the park goes viral. Platform bonus: collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "You win first prize at the company's Spring Festival gala lottery. Collect $180.",
        "act": {
          "kind": "money",
          "amount": 180
        }
      },
      {
        "text": "The crossing camera catches you jaywalking and shows it on the big screen. Pay $50.",
        "act": {
          "kind": "money",
          "amount": -50
        }
      },
      {
        "text": "You paid extra for the glass skywalk, then crossed it on all fours. Pay $60.",
        "act": {
          "kind": "money",
          "amount": -60
        }
      },
      {
        "text": "Deluxe KTV room until 3am, and you sang one song. Split the bill? Never. Pay $75.",
        "act": {
          "kind": "money",
          "amount": -75
        }
      },
      {
        "text": "The maglev hits 431 km/h — you're at Start before your tea cools. Collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Investors call: your pitch worked. Advance to Shanghai; collect salary if you pass Start.",
        "act": {
          "kind": "moveTo",
          "tile": "priciest",
          "collect": true
        }
      },
      {
        "text": "Chunyun rush! Dash to the nearest Airport. If it's owned, pay the owner double.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Your 240-hour layover tour is boarding — go to the nearest Airport and pay double if owned.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Dinnertime surge: 10,000 rice cookers at once. Nearest Utility — if owned, pay 10x your dice roll.",
        "act": {
          "kind": "nearest",
          "target": "utility",
          "payMultiplier": 10
        }
      },
      {
        "text": "You left your phone at the teahouse. Your whole life is on it. Go back 3 spaces.",
        "act": {
          "kind": "moveBy",
          "n": -3
        }
      },
      {
        "text": "You lose the bill-grabbing battle at dinner — honour demands you pay each player $35.",
        "act": {
          "kind": "payEach",
          "amount": 35
        }
      },
      {
        "text": "Caught sneaking into the panda enclosure for a selfie. Off to Prison with you.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "The Spring Festival fireworks were glorious. Your roofs disagree: $30 per house, $110 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 30,
          "hotel": 110
        }
      }
    ],
    "treasure": [
      {
        "text": "Lunar New Year hongbao from Grandma — 'spend it wisely,' she says. You won't. Collect $88.",
        "act": {
          "kind": "money",
          "amount": 88
        }
      },
      {
        "text": "Your livestream sells 400 rice cookers in four minutes. Collect $120.",
        "act": {
          "kind": "money",
          "amount": 120
        }
      },
      {
        "text": "The mahjong elders let you win a round — respect must be paid. Collect $50.",
        "act": {
          "kind": "money",
          "amount": 50
        }
      },
      {
        "text": "The square-dance aunties hire you to haul their speaker. Collect $35.",
        "act": {
          "kind": "money",
          "amount": 35
        }
      },
      {
        "text": "Mid-Autumn bonus: your boss hands out mooncakes AND cash this year. Collect $100.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "Double 11 midnight sale: you wake up to 37 parcels and one regret. Pay $95.",
        "act": {
          "kind": "money",
          "amount": -95
        }
      },
      {
        "text": "Yunnan mushroom season — you foraged the safe ones and sold the lot. Collect $70.",
        "act": {
          "kind": "money",
          "amount": 70
        }
      },
      {
        "text": "Tourists at West Lake pay you to take 200 photos from 'the good angle.' Collect $40.",
        "act": {
          "kind": "money",
          "amount": 40
        }
      },
      {
        "text": "Your G-series bullet train arrives to the minute, as always. Ride it to Start and collect salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Golden Week at last! Join 800 million happy travellers — off to Vacation you go.",
        "act": {
          "kind": "moveTo",
          "tile": "vacation"
        }
      },
      {
        "text": "An old guanxi favour is repaid: keep this card to walk out of Prison, free of charge.",
        "act": {
          "kind": "getout"
        }
      },
      {
        "text": "You cut the soup-dumpling queue. The aunties saw everything. Go to Prison.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Your hotpot broth is legendary. Every player pays $30 for a seat at your table.",
        "act": {
          "kind": "collectEach",
          "amount": 30
        }
      },
      {
        "text": "Typhoon season roars up the coast — pay $40 per house and $115 per hotel for repairs.",
        "act": {
          "kind": "repairs",
          "house": 40,
          "hotel": 115
        }
      }
    ],
    "utilities": [
      {
        "name": "Panda Power Co",
        "icon": "⚡"
      },
      {
        "name": "Yangtze Water Co",
        "icon": "💧"
      }
    ]
  },
  {
    "id": "br",
    "name": "Brasil",
    "icon": "🇧🇷",
    "description": "Own Brazil do Oiapoque ao Chuí — samba, football, açaí and beachfront rent.",
    "groups": [
      {
        "key": "AMZ",
        "name": "Amazônia",
        "color": "#4CAF50",
        "flag": "🦜"
      },
      {
        "key": "CO",
        "name": "Centro-Oeste",
        "color": "#26A69A",
        "flag": "🐆"
      },
      {
        "key": "NE",
        "name": "Nordeste",
        "color": "#ED8936",
        "flag": "🏖️"
      },
      {
        "key": "BA",
        "name": "Bahia",
        "color": "#E05C5C",
        "flag": "🪘"
      },
      {
        "key": "SUL",
        "name": "Sul",
        "color": "#8B6FD0",
        "flag": "🧉"
      },
      {
        "key": "MG",
        "name": "Minas Gerais",
        "color": "#C9A227",
        "flag": "🧀"
      },
      {
        "key": "SP",
        "name": "São Paulo",
        "color": "#607D8B",
        "flag": "🏙️"
      },
      {
        "key": "RJ",
        "name": "Rio de Janeiro",
        "color": "#3B82F6",
        "flag": "🎭"
      }
    ],
    "cities": [
      {
        "name": "Belém",
        "group": "AMZ"
      },
      {
        "name": "Manaus",
        "group": "AMZ"
      },
      {
        "name": "Campo Grande",
        "group": "CO"
      },
      {
        "name": "Cuiabá",
        "group": "CO"
      },
      {
        "name": "Brasília",
        "group": "CO"
      },
      {
        "name": "Natal",
        "group": "NE"
      },
      {
        "name": "Fortaleza",
        "group": "NE"
      },
      {
        "name": "Recife",
        "group": "NE"
      },
      {
        "name": "Ilhéus",
        "group": "BA"
      },
      {
        "name": "Porto Seguro",
        "group": "BA"
      },
      {
        "name": "Salvador",
        "group": "BA"
      },
      {
        "name": "Curitiba",
        "group": "SUL"
      },
      {
        "name": "Porto Alegre",
        "group": "SUL"
      },
      {
        "name": "Florianópolis",
        "group": "SUL"
      },
      {
        "name": "Ouro Preto",
        "group": "MG"
      },
      {
        "name": "Uberlândia",
        "group": "MG"
      },
      {
        "name": "Belo Horizonte",
        "group": "MG"
      },
      {
        "name": "Santos",
        "group": "SP"
      },
      {
        "name": "Campinas",
        "group": "SP"
      },
      {
        "name": "São Paulo",
        "group": "SP"
      },
      {
        "name": "Niterói",
        "group": "RJ"
      },
      {
        "name": "Rio de Janeiro",
        "group": "RJ"
      }
    ],
    "airports": [
      "MAO Airport",
      "REC Airport",
      "BSB Airport",
      "GRU Airport"
    ],
    "utilities": [
      {
        "name": "Rede Elétrica",
        "icon": "⚡"
      },
      {
        "name": "Águas Tropicais",
        "icon": "💧"
      }
    ],
    "treasure": [
      {
        "text": "Your brigadeiro stand outsells the bakery at the festa junina. Collect $80.",
        "act": {
          "kind": "money",
          "amount": 80
        }
      },
      {
        "text": "Vovó's feijoada wins the neighborhood cook-off. Prize barely covers the nap. Collect $50.",
        "act": {
          "kind": "money",
          "amount": 50
        }
      },
      {
        "text": "You sell a complete World Cup sticker album, shiny legends included. Collect $100.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "Your açaí bowl goes viral in Belém. Purists approve: no granola in sight. Collect $70.",
        "act": {
          "kind": "money",
          "amount": 70
        }
      },
      {
        "text": "Your 13th salary hits the account in December. Try to save it. You won't. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "You win the building's churrasco raffle: picanha included. Collect $60.",
        "act": {
          "kind": "money",
          "amount": 60
        }
      },
      {
        "text": "Pix refund arrives in two seconds flat. Modern life is beautiful. Collect $40.",
        "act": {
          "kind": "money",
          "amount": 40
        }
      },
      {
        "text": "Guaraná and pastel for the whole table after Brazil scores. Worth it. Pay $55.",
        "act": {
          "kind": "money",
          "amount": -55
        }
      },
      {
        "text": "Payday Pix alert sings! Dash over to Start and scoop up your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Férias at last: hammock, dunes and coconut water in Jericoacoara. Go to Vacation.",
        "act": {
          "kind": "moveTo",
          "tile": "vacation"
        }
      },
      {
        "text": "Habeas corpus granted in record time. Keep this card to walk out of Prison anytime.",
        "act": {
          "kind": "getout"
        }
      },
      {
        "text": "Caught hopping the Maracanã turnstile without a ticket. Straight to Prison with you.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Birthday churrasco! Everyone chips in for the meat. Collect $25 from each player.",
        "act": {
          "kind": "collectEach",
          "amount": 25
        }
      },
      {
        "text": "Summer storms flood the garage again. Pay $35 per house and $110 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 35,
          "hotel": 110
        }
      }
    ],
    "surprise": [
      {
        "text": "Your samba school takes the title at the Sapucaí. Parade bonus! Collect $200.",
        "act": {
          "kind": "money",
          "amount": 200
        }
      },
      {
        "text": "Investors adore your feira delivery app. São Paulo money rains. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "Your Pantanal capybara video hits a million views. Collect $100.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "Speed camera on the Marginal clocks you at 62 in a 60. Pay $60.",
        "act": {
          "kind": "money",
          "amount": -60
        }
      },
      {
        "text": "Beach tab: chair, umbrella, Globo biscuit and iced mate. It adds up. Pay $45.",
        "act": {
          "kind": "money",
          "amount": -45
        }
      },
      {
        "text": "Your driver knows a shortcut past the blocos. Zip ahead to Start and collect your salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "Carnaval calls! Fly to Rio de Janeiro. Collect salary if you pass Start.",
        "act": {
          "kind": "moveTo",
          "tile": "priciest",
          "collect": true
        }
      },
      {
        "text": "Gate changed three times. Dash to the nearest airport; if owned, pay double the fee.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Red-eye promo to the Northeast! Go to the nearest airport; if owned, pay double the fee.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "The chuveiro elétrico blows a fuse again. Nearest utility; if owned, pay 10x the dice.",
        "act": {
          "kind": "nearest",
          "target": "utility",
          "payMultiplier": 10
        }
      },
      {
        "text": "You left your Havaianas at the beach kiosk. Go back 3 spaces.",
        "act": {
          "kind": "moveBy",
          "n": -3
        }
      },
      {
        "text": "Lost a bet on the clássico: pizza rodízio is on you. Pay each player $35.",
        "act": {
          "kind": "payEach",
          "amount": 35
        }
      },
      {
        "text": "You cut the bakery line on Sunday morning. Unforgivable. Straight to Prison with you.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Post-Carnaval cleanup for all your blocks. Pay $40 per house and $115 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 40,
          "hotel": 115
        }
      }
    ]
  },
  {
    "airports": [
      "SYD Airport",
      "MEL Airport",
      "PER Airport",
      "DRW Airport"
    ],
    "cities": [
      {
        "name": "Alice Springs",
        "group": "NT"
      },
      {
        "name": "Darwin",
        "group": "NT"
      },
      {
        "name": "Devonport",
        "group": "TAS"
      },
      {
        "name": "Launceston",
        "group": "TAS"
      },
      {
        "name": "Hobart",
        "group": "TAS"
      },
      {
        "name": "Coober Pedy",
        "group": "SA"
      },
      {
        "name": "Mount Gambier",
        "group": "SA"
      },
      {
        "name": "Adelaide",
        "group": "SA"
      },
      {
        "name": "Kalgoorlie",
        "group": "WA"
      },
      {
        "name": "Fremantle",
        "group": "WA"
      },
      {
        "name": "Perth",
        "group": "WA"
      },
      {
        "name": "Cairns",
        "group": "QLD"
      },
      {
        "name": "Gold Coast",
        "group": "QLD"
      },
      {
        "name": "Brisbane",
        "group": "QLD"
      },
      {
        "name": "Gungahlin",
        "group": "ACT"
      },
      {
        "name": "Belconnen",
        "group": "ACT"
      },
      {
        "name": "Canberra",
        "group": "ACT"
      },
      {
        "name": "Ballarat",
        "group": "VIC"
      },
      {
        "name": "Geelong",
        "group": "VIC"
      },
      {
        "name": "Melbourne",
        "group": "VIC"
      },
      {
        "name": "Byron Bay",
        "group": "NSW"
      },
      {
        "name": "Sydney",
        "group": "NSW"
      }
    ],
    "description": "Scoop up the Great Southern Land, from red-dirt roadhouses to harbourside penthouses.",
    "groups": [
      {
        "key": "NT",
        "name": "Northern Territory",
        "color": "#C75B39",
        "flag": "🐊"
      },
      {
        "key": "TAS",
        "name": "Tasmania",
        "color": "#3F9B63",
        "flag": "😈"
      },
      {
        "key": "SA",
        "name": "South Australia",
        "color": "#8B5FBF",
        "flag": "🍷"
      },
      {
        "key": "WA",
        "name": "Western Australia",
        "color": "#B5912E",
        "flag": "⛏️"
      },
      {
        "key": "QLD",
        "name": "Queensland",
        "color": "#A63A50",
        "flag": "🐠"
      },
      {
        "key": "ACT",
        "name": "Capital Territory",
        "color": "#5B6ACF",
        "flag": "🏛️"
      },
      {
        "key": "VIC",
        "name": "Victoria",
        "color": "#2E97A7",
        "flag": "☕"
      },
      {
        "key": "NSW",
        "name": "New South Wales",
        "color": "#4BA3E3",
        "flag": "🎭"
      }
    ],
    "icon": "🇦🇺",
    "id": "au",
    "name": "Straya",
    "surprise": [
      {
        "text": "Your office sweep pick wins the Melbourne Cup by a nose. Collect $200.",
        "act": {
          "kind": "money",
          "amount": 200
        }
      },
      {
        "text": "Your sausage sizzle outside the hardware store breaks the sales record. Collect $100.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "You film a magpie swooping the postie in September and it goes viral. Collect $50.",
        "act": {
          "kind": "money",
          "amount": 50
        }
      },
      {
        "text": "You left the esky lid open and the prawns copped it. Pay $60 for a fresh kilo.",
        "act": {
          "kind": "money",
          "amount": -60
        }
      },
      {
        "text": "Parked in a clearway on grand final day. Cop it sweet: pay $90.",
        "act": {
          "kind": "money",
          "amount": -90
        }
      },
      {
        "text": "The Indian Pacific pulls out right on time, with you aboard. Advance to Start and collect salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "New Year's Eve fireworks on the harbour! Advance to Sydney. Collect salary if you pass Start.",
        "act": {
          "kind": "moveTo",
          "tile": "priciest",
          "collect": true
        }
      },
      {
        "text": "Fog closes the runway down south. Dash to the nearest Airport; if it's owned, pay double the fare.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Schoolies week: every seat north is gone. Advance to the nearest Airport; owned means double fare.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Heatwave! Every aircon on the street maxes out. Advance to the nearest Utility; pay 10x the dice.",
        "act": {
          "kind": "nearest",
          "target": "utility",
          "payMultiplier": 10
        }
      },
      {
        "text": "You left your keep cup at that laneway cafe in Melbourne. Go back 3 spaces for it.",
        "act": {
          "kind": "moveBy",
          "n": -3
        }
      },
      {
        "text": "You lose a friendly bet and it's your shout for the whole table. Pay each player $30.",
        "act": {
          "kind": "payEach",
          "amount": 30
        }
      },
      {
        "text": "You pushed in at the coffee queue in Melbourne. Unforgivable. Go directly to Prison.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Termites hit the deck and rust hits the gutters. Pay $40 per house and $115 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 40,
          "hotel": 115
        }
      }
    ],
    "treasure": [
      {
        "text": "Your meat pie stall sells out by half-time at the footy. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "You strike a nugget fossicking near Kalgoorlie. The assay office pays $120.",
        "act": {
          "kind": "money",
          "amount": 120
        }
      },
      {
        "text": "Tourists pay you to pronounce 'Wagga Wagga' and 'Mooloolaba' properly. Collect $100.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "You win the thong-throwing contest at the Australia Day barbie. Collect $80.",
        "act": {
          "kind": "money",
          "amount": 80
        }
      },
      {
        "text": "Your pavlova wins the bake-off. New Zealand lodges a protest. Collect $60.",
        "act": {
          "kind": "money",
          "amount": 60
        }
      },
      {
        "text": "You snap a quokka selfie so good a tourism board licenses it. Collect $40.",
        "act": {
          "kind": "money",
          "amount": 40
        }
      },
      {
        "text": "Seagulls launch a coordinated raid on your hot chips at the beach. Pay $20 for backup chips.",
        "act": {
          "kind": "money",
          "amount": -20
        }
      },
      {
        "text": "Your ute gets bogged on the beach as the tide comes in. The tow costs $80.",
        "act": {
          "kind": "money",
          "amount": -80
        }
      },
      {
        "text": "A road train's slipstream carries you across the Nullarbor. Advance to Start and collect salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "It's a long weekend and the surf's pumping. Chuck a sickie and head to Vacation.",
        "act": {
          "kind": "moveTo",
          "tile": "vacation"
        }
      },
      {
        "text": "Your mate the bush lawyer finally wins a case — yours. Get out of Prison free; keep this card.",
        "act": {
          "kind": "getout"
        }
      },
      {
        "text": "Caught doing burnouts in the servo car park. Go directly to Prison.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Your lamington drive for the surf lifesaving club smashes its target. Collect $25 from each player.",
        "act": {
          "kind": "collectEach",
          "amount": 25
        }
      },
      {
        "text": "Cyclone season's coming. Re-batten every roof: pay $30 per house and $110 per hotel.",
        "act": {
          "kind": "repairs",
          "house": 30,
          "hotel": 110
        }
      }
    ],
    "utilities": [
      {
        "name": "Boomerang Energy",
        "icon": "⚡"
      },
      {
        "name": "Billabong Water",
        "icon": "💧"
      }
    ]
  },
  {
    "id": "ca",
    "name": "The Great White North",
    "icon": "🇨🇦",
    "description": "Coast to coast to coast: grab a double-double and buy up the whole True North, eh?",
    "groups": [
      {
        "key": "NL",
        "name": "Newfoundland",
        "color": "#A9835E",
        "flag": "🐋"
      },
      {
        "key": "NT",
        "name": "The North",
        "color": "#56B4D3",
        "flag": "🌌"
      },
      {
        "key": "MR",
        "name": "The Maritimes",
        "color": "#E06A5A",
        "flag": "🦞"
      },
      {
        "key": "PR",
        "name": "The Prairies",
        "color": "#D9A83C",
        "flag": "🌾"
      },
      {
        "key": "AB",
        "name": "Alberta",
        "color": "#D96AA8",
        "flag": "🤠"
      },
      {
        "key": "QC",
        "name": "Québec",
        "color": "#6B7FD7",
        "flag": "⚜️"
      },
      {
        "key": "BC",
        "name": "British Columbia",
        "color": "#55A860",
        "flag": "🌲"
      },
      {
        "key": "ON",
        "name": "Ontario",
        "color": "#9C5BC0",
        "flag": "🗼"
      }
    ],
    "cities": [
      {
        "name": "Corner Brook",
        "group": "NL"
      },
      {
        "name": "St. John's",
        "group": "NL"
      },
      {
        "name": "Whitehorse",
        "group": "NT"
      },
      {
        "name": "Yellowknife",
        "group": "NT"
      },
      {
        "name": "Iqaluit",
        "group": "NT"
      },
      {
        "name": "Charlottetown",
        "group": "MR"
      },
      {
        "name": "Moncton",
        "group": "MR"
      },
      {
        "name": "Halifax",
        "group": "MR"
      },
      {
        "name": "Regina",
        "group": "PR"
      },
      {
        "name": "Saskatoon",
        "group": "PR"
      },
      {
        "name": "Winnipeg",
        "group": "PR"
      },
      {
        "name": "Edmonton",
        "group": "AB"
      },
      {
        "name": "Calgary",
        "group": "AB"
      },
      {
        "name": "Banff",
        "group": "AB"
      },
      {
        "name": "Trois-Rivières",
        "group": "QC"
      },
      {
        "name": "Québec City",
        "group": "QC"
      },
      {
        "name": "Montréal",
        "group": "QC"
      },
      {
        "name": "Kelowna",
        "group": "BC"
      },
      {
        "name": "Victoria",
        "group": "BC"
      },
      {
        "name": "Vancouver",
        "group": "BC"
      },
      {
        "name": "Ottawa",
        "group": "ON"
      },
      {
        "name": "Toronto",
        "group": "ON"
      }
    ],
    "airports": [
      "YVR Airport",
      "YYC Airport",
      "YYZ Airport",
      "YHZ Airport"
    ],
    "utilities": [
      {
        "name": "Maple Hydro",
        "icon": "⚡"
      },
      {
        "name": "True North Gas",
        "icon": "🔥"
      }
    ],
    "treasure": [
      {
        "text": "You roll up the rim of your coffee cup and it actually says WINNER. Collect $100.",
        "act": {
          "kind": "money",
          "amount": 100
        }
      },
      {
        "text": "The CRA re-checks your taxes and finds a credit you missed. Refund! Collect $120.",
        "act": {
          "kind": "money",
          "amount": 120
        }
      },
      {
        "text": "Your backyard rink is glass-smooth. The whole street pays admission to skate. Collect $90.",
        "act": {
          "kind": "money",
          "amount": 90
        }
      },
      {
        "text": "Your poutine stand at the winter carnival sells out before noon. Collect $75.",
        "act": {
          "kind": "money",
          "amount": 75
        }
      },
      {
        "text": "November: a $50 bill surfaces in last winter's parka pocket. Collect $50.",
        "act": {
          "kind": "money",
          "amount": 50
        }
      },
      {
        "text": "You snow-blow the entire cul-de-sac before sunrise. Grateful neighbours pass the hat: collect $60.",
        "act": {
          "kind": "money",
          "amount": 60
        }
      },
      {
        "text": "Your sugar shack's first spring boil takes gold at the maple festival. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "A Toronto raccoon defeats your raccoon-proof green bin. Pay $40 for the deluxe latch.",
        "act": {
          "kind": "money",
          "amount": -40
        }
      },
      {
        "text": "You catch the transcontinental train west in a sleeper car. Advance to START and collect salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "May two-four weekend! Strap the canoe to the car and head for the cottage. Advance to Vacation.",
        "act": {
          "kind": "moveTo",
          "tile": "vacation"
        }
      },
      {
        "text": "Bank one sincere, extremely Canadian 'sorry'. Keep this card to talk your way out of Jail.",
        "act": {
          "kind": "getout"
        }
      },
      {
        "text": "You cut the 7 a.m. drive-thru coffee line. Straight to Jail — no salary on the way.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "Your Nanaimo bars steal the show at the community potluck. Collect $25 from each player.",
        "act": {
          "kind": "collectEach",
          "amount": 25
        }
      },
      {
        "text": "Pothole season strikes early. Pay $35 per house and $110 per hotel for spring repairs.",
        "act": {
          "kind": "repairs",
          "house": 35,
          "hotel": 110
        }
      }
    ],
    "surprise": [
      {
        "text": "Your indie hockey documentary wins the audience prize at a Toronto film fest. Collect $200.",
        "act": {
          "kind": "money",
          "amount": 200
        }
      },
      {
        "text": "The freeze-thaw turns a windshield chip into a full crack. Pay $60 at the glass shop.",
        "act": {
          "kind": "money",
          "amount": -60
        }
      },
      {
        "text": "A collector pays top dollar for your box of vintage Expo 86 pins. Collect $150.",
        "act": {
          "kind": "money",
          "amount": 150
        }
      },
      {
        "text": "It takes $100 of rodeo midway games, but the giant plush moose is finally yours. Pay $100.",
        "act": {
          "kind": "money",
          "amount": -100
        }
      },
      {
        "text": "City tourists buy out your northern lights photo prints. Collect $75.",
        "act": {
          "kind": "money",
          "amount": 75
        }
      },
      {
        "text": "A warm chinook wind sweeps you clear across the board. Advance to START and collect salary.",
        "act": {
          "kind": "moveTo",
          "tile": "start",
          "collect": true
        }
      },
      {
        "text": "You score playoff tickets downtown. Advance to Toronto. Collect salary if you pass START.",
        "act": {
          "kind": "moveTo",
          "tile": "priciest",
          "collect": true
        }
      },
      {
        "text": "Whiteout on the highway — you fly instead. Advance to the nearest airport. If owned, pay double.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "Seat sale! You snag a cross-country flight. Advance to the nearest airport; owner collects double.",
        "act": {
          "kind": "nearest",
          "target": "airport",
          "payMultiplier": 2
        }
      },
      {
        "text": "An ice storm snaps the lines. Advance to the nearest utility; if owned, pay 10x your dice roll.",
        "act": {
          "kind": "nearest",
          "target": "utility",
          "payMultiplier": 10
        }
      },
      {
        "text": "You left the reusable bags in the car. Trudge back 3 spaces through the slush to get them.",
        "act": {
          "kind": "moveBy",
          "n": -3
        }
      },
      {
        "text": "You lose the 'no, you take the last donut hole' standoff and buy a round. Pay each player $30.",
        "act": {
          "kind": "payEach",
          "amount": 30
        }
      },
      {
        "text": "Photo radar clocks you doing 140 on the Trans-Canada. Off to Jail, and no salary either.",
        "act": {
          "kind": "jail"
        }
      },
      {
        "text": "An early blizzard buries your properties. Pay $40 per house and $115 per hotel for snow clearing.",
        "act": {
          "kind": "repairs",
          "house": 40,
          "hotel": 115
        }
      }
    ]
  }
];
