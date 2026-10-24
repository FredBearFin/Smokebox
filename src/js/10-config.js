/*
 * WHAT THIS FILE IS: The app's settings, written down once: stations, channels, ingredients, menu, combos,
 *    pacing, service hours, food-safety limits, brisket yield formula and size limits. Weights are in grams.
 *    On first run the editable values are copied into the saved state (SPEC section 5). A "starter estimate"
 *    is a guess to confirm by weighing or timing.
 * PARTS: stations, channels, ingredients, menu, combos, pacing, service day, safety, yield, limits.
 * USES: nothing. USED BY: engine, store, metrics, simulator and screens (as SB.config).
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});

  const C = (SB.config = {});
  C.version = 1;
  C.brand = { name: 'Smokebox', sub: 'Kitchen display' };
  // Sentence added to every food-safety message (SPEC section 0, rule 9). Local rules always win.
  C.safetyLine = 'General food-safety guidance. Your local health-code rules override this.';

  /* ---------- stations (zones). "expo" never receives items; it sees whole tickets. ---------- */
  // Stations. Columns: id (short name used in data), name (button label), long (full name), code (3-letter
  // tag on tickets), icon (a name from 05-icons.js). Example: the pit row is id "pit", code "PIT", flame
  // icon. Expo is a view only: it never receives items, it sees whole tickets (SPEC 7.2).
  // audit:data-start
  C.zones = [
    { id: 'pit',   name: 'Pit',           long: 'Pit and slicing',    code: 'PIT', icon: 'flame' },
    { id: 'sides', name: 'Hot sides',     long: 'Hot sides and prep', code: 'HOT', icon: 'pot' },
    { id: 'fry',   name: 'Fry',           long: 'Fry station',        code: 'FRY', icon: 'fry' },
    { id: 'cold',  name: 'Cold and drinks', long: 'Cold prep and drinks', code: 'CLD', icon: 'snow' },
    { id: 'expo',  name: 'Expo',          long: 'Expo and packing',   code: 'EXP', icon: 'bag' },
  ];
  // audit:data-end

  // The four stations that actually receive items (everything except expo).
  C.workZones = ['pit', 'sides', 'fry', 'cold'];

  /* ---------- order channels with ticket-time thresholds (seconds). warn = amber, breach = overdue. Owner-editable. ---------- */
  // Order channels. Columns: id, name, short (tab label), icon, warnSec (the ticket turns amber after this
  // many seconds), breachSec (the ticket is overdue after this many). Example: dine-in goes amber at 540 s
  // (9 minutes) and overdue at 780 s (13 minutes). Drive-thru is tightest because a car is waiting. These
  // are starting values, not from the research report: owner to confirm. They can be changed in the office
  // (Data page).
  // audit:data-start
  C.channels = [
    { id: 'dine_in',     name: 'Dine-in',    short: 'Dine', icon: 'plate',  warnSec: 540, breachSec: 780 },
    { id: 'takeout',     name: 'Takeout',    short: 'Take', icon: 'bag',    warnSec: 480, breachSec: 720 },
    { id: 'drive_thru',  name: 'Drive-thru', short: 'Drive', icon: 'car',   warnSec: 360, breachSec: 540 },
    { id: 'third_party', name: 'Delivery app', short: 'App', icon: 'phone', warnSec: 480, breachSec: 720 },
  ];
  // audit:data-end

  /* Simulated order-channel menu feeds that receive 86 updates. There is no live POS or delivery integration; sync is simulated and labelled as such. */
  C.syncTargets = [
    { id: 'pos',      name: 'Counter POS' },
    { id: 'online',   name: 'Online ordering' },
    { id: 'drive',    name: 'Drive-thru board' },
    { id: 'delivery', name: 'Delivery apps' },
  ];

  // Ingredients. Stock is counted in grams, or in pieces where unit is 'ea' (buns, cornbread). Columns: id;
  // name; unit; tcs (true = food that needs time and temperature control for safety, so its stock lives in
  // timed batches in the hold cabinet); hold ('hot' = keep at 135 F or above, 'cold' = keep at 41 F or
  // below); maxHoldH (hours in the cabinet before discard; the smaller of this and C.safety.defaultMaxHoldH
  // applies); parG (typical opening stock); thresholdG (menu items that use it are 86'd at or below this
  // amount); costPerKg or costEach (raw cost in dollars); thermal (cooked yield comes from the brisket
  // formula, see C.yieldModel); yield (cooked grams per raw gram for the other cooked foods); yieldConfirmed
  // (false = starter estimate).
  // Example: brisket opens at 14 000 g, is 86'd at 700 g, costs 24.36 dollars per raw kg and uses the
  // thermal formula.
  // Every par, threshold, cost and yield here is a starter estimate: owner to confirm by weighing and
  // pricing.
  // audit:data-start
  C.ingredients = [
    { id: 'brisket',  name: 'Brisket',          unit: 'g',  tcs: true,  hold: 'hot',  maxHoldH: 8, holdBasis: 'quality', cookH: 12, restH: 3, parG: 14000, pullG: 4500, thresholdG: 700,  costPerKg: 24.36, thermal: true, yield: 0.55, yieldConfirmed: false, note: 'Starter cost: USDA average brisket $11.05/lb for the week ending 2026-09-25 (from the Pitcall notes), about $24.36/kg. Unverified here.' },
    { id: 'pork',     name: 'Pulled pork',      unit: 'g',  tcs: true,  hold: 'hot',  maxHoldH: 8, holdBasis: 'quality', cookH: 10, restH: 1, parG: 10000, pullG: 2500, thresholdG: 600,  costPerKg: 7.70,  yield: 0.55, yieldConfirmed: false },
    { id: 'ribs',     name: 'St. Louis ribs',   unit: 'g',  tcs: true,  hold: 'hot',  maxHoldH: 4, holdBasis: 'quality', cookH: 5, restH: 0.5, parG: 12000, pullG: 1200, thresholdG: 900,  costPerKg: 9.90,  yield: 0.62, yieldConfirmed: false },
    { id: 'sausage',  name: 'Smoked sausage',   unit: 'g',  tcs: true,  hold: 'hot',  maxHoldH: 4, holdBasis: 'quality', cookH: 1.5, parG: 6000, pullG: 1000,  thresholdG: 400,  costPerKg: 9.00,  yield: 0.90, yieldConfirmed: false },
    { id: 'turkey',   name: 'Smoked turkey',    unit: 'g',  tcs: true,  hold: 'hot',  maxHoldH: 4, holdBasis: 'quality', cookH: 4, parG: 5000, pullG: 1500,  thresholdG: 500,  costPerKg: 11.00, yield: 0.70, yieldConfirmed: false },
    { id: 'mac',      name: 'Mac and cheese',   unit: 'g',  tcs: true,  hold: 'hot',  maxHoldH: 4, holdBasis: 'quality', cookH: 1, parG: 8000, pullG: 2000,  thresholdG: 500,  costPerKg: 3.60,  yield: 1,    yieldConfirmed: false },
    { id: 'beans',    name: 'Pit beans',        unit: 'g',  tcs: true,  hold: 'hot',  maxHoldH: 4, holdBasis: 'quality', cookH: 2, parG: 8000, pullG: 2000,  thresholdG: 500,  costPerKg: 3.00,  yield: 1,    yieldConfirmed: false },
    { id: 'slaw',     name: 'Jalapeno slaw',    unit: 'g',  tcs: true,  hold: 'cold', maxHoldH: 4, holdBasis: 'quality', confirmBasis: true, cookH: 0.5, parG: 7000, pullG: 1500,  thresholdG: 400,  costPerKg: 2.40,  yield: 0.88, yieldConfirmed: false },
    { id: 'potato',   name: 'Potato salad',     unit: 'g',  tcs: true,  hold: 'cold', maxHoldH: 4, holdBasis: 'quality', confirmBasis: true, cookH: 0.5, parG: 6000, pullG: 1500,  thresholdG: 400,  costPerKg: 3.40,  yield: 1,    yieldConfirmed: false },
    { id: 'pudding',  name: 'Banana pudding',   unit: 'g',  tcs: true,  hold: 'cold', maxHoldH: 4, holdBasis: 'quality', confirmBasis: true, cookH: 0.5, parG: 5000, pullG: 1500,  thresholdG: 400,  costPerKg: 5.20,  yield: 1,    yieldConfirmed: false },
    { id: 'cornbread', name: 'Cornbread',       unit: 'ea', tcs: false, parG: 120,   thresholdG: 8,   costEach: 0.45 },
    { id: 'buns',     name: 'Buns',             unit: 'ea', tcs: false, parG: 150,   thresholdG: 10,  costEach: 0.38 },
    { id: 'pickles',  name: 'Pickle chips',     unit: 'g',  tcs: false, parG: 6000,  thresholdG: 300,  costPerKg: 4.20 },
    { id: 'fry_mix',  name: 'Fry batter mix',   unit: 'g',  tcs: false, parG: 8000,  thresholdG: 400,  costPerKg: 2.40 },
    { id: 'tea',      name: 'Sweet tea',        unit: 'g',  tcs: false, parG: 40000, thresholdG: 2000, costPerKg: 0.50 },
  ];

  // audit:data-end

  // Menu categories (the tabs on the order screen). Columns: id, name.
  C.categories = [
    { id: 'meat',     name: 'Meats' },
    { id: 'sandwich', name: 'Sandwiches' },
    { id: 'side',     name: 'Hot sides' },
    { id: 'fried',    name: 'Fried' },
    { id: 'cold',     name: 'Cold and drinks' },
  ];
  // Menu. Columns: id; name (full name on the order screen); short (name on tickets); zone (the station that
  // cooks it); cat (category tab); price (dollars); prepSec (seconds to make one: a starter estimate that
  // the app later replaces with what the line really does); track ('one' = one tap finishes it, 'two' = tap
  // to start, tap again to finish); bom (bill of materials: what ONE portion uses, as ingredient id and
  // quantity in grams or pieces). Meat weights are COOKED weights, because meat stock is counted cooked.
  // Example: Brisket 1/2 lb is cooked in the pit, sells for 14.00, plans 120 s and uses 227 g of cooked
  // brisket. 113 g and 227 g are a quarter and a half pound.
  // Prices, times and portion weights are starter estimates: owner to confirm.
  // audit:data-start
  C.menu = [
    { id: 'brisket_qtr',  name: 'Brisket, 1/4 lb',        short: 'Brisket 1/4',  zone: 'pit',   cat: 'meat',     price: 7.50,  prepSec: 90,  track: 'one', bom: [{ ing: 'brisket', qty: 113 }] },
    { id: 'brisket_half', name: 'Brisket, 1/2 lb',        short: 'Brisket 1/2',  zone: 'pit',   cat: 'meat',     price: 14.00, prepSec: 120, track: 'two', bom: [{ ing: 'brisket', qty: 227 }] },
    { id: 'burnt_ends',   name: 'Burnt ends, 1/2 lb',     short: 'Burnt ends',   zone: 'pit',   cat: 'meat',     price: 15.00, prepSec: 150, track: 'two', bom: [{ ing: 'brisket', qty: 227 }] },
    { id: 'pork_qtr',     name: 'Pulled pork, 1/4 lb',    short: 'Pork 1/4',     zone: 'pit',   cat: 'meat',     price: 6.25,  prepSec: 90,  track: 'one', bom: [{ ing: 'pork', qty: 113 }] },
    { id: 'pork_half',    name: 'Pulled pork, 1/2 lb',    short: 'Pork 1/2',     zone: 'pit',   cat: 'meat',     price: 11.00, prepSec: 100, track: 'two', bom: [{ ing: 'pork', qty: 227 }] },
    { id: 'ribs_half',    name: 'St. Louis ribs, half rack', short: 'Ribs 1/2',  zone: 'pit',   cat: 'meat',     price: 16.00, prepSec: 180, track: 'two', bom: [{ ing: 'ribs', qty: 450 }] },
    { id: 'ribs_full',    name: 'St. Louis ribs, full rack', short: 'Ribs full', zone: 'pit',   cat: 'meat',     price: 29.00, prepSec: 210, track: 'two', bom: [{ ing: 'ribs', qty: 900 }] },
    { id: 'sausage',      name: 'Smoked sausage link',    short: 'Sausage',      zone: 'pit',   cat: 'meat',     price: 6.50,  prepSec: 240, track: 'two', bom: [{ ing: 'sausage', qty: 130 }] },
    { id: 'turkey_half',  name: 'Smoked turkey, 1/2 lb',  short: 'Turkey 1/2',   zone: 'pit',   cat: 'meat',     price: 12.50, prepSec: 110, track: 'two', bom: [{ ing: 'turkey', qty: 227 }] },
    { id: 'brisket_sand', name: 'Brisket sandwich',       short: 'Brisket sandwich', zone: 'pit', cat: 'sandwich', price: 13.50, prepSec: 170, track: 'two', bom: [{ ing: 'brisket', qty: 140 }, { ing: 'buns', qty: 1 }, { ing: 'pickles', qty: 20 }] },
    { id: 'pork_sand',    name: 'Pulled pork sandwich',   short: 'Pork sandwich', zone: 'pit',   cat: 'sandwich', price: 11.50, prepSec: 150, track: 'two', bom: [{ ing: 'pork', qty: 150 }, { ing: 'buns', qty: 1 }, { ing: 'pickles', qty: 20 }] },
    { id: 'mac',          name: 'Smoked mac and cheese',  short: 'Mac and cheese', zone: 'sides', cat: 'side',     price: 5.50,  prepSec: 300, track: 'two', bom: [{ ing: 'mac', qty: 200 }] },
    { id: 'mac_lg',       name: 'Smoked mac and cheese, large', short: 'Large mac and cheese', zone: 'sides', cat: 'side', price: 9.00,  prepSec: 330, track: 'two', bom: [{ ing: 'mac', qty: 400 }] },
    { id: 'beans',        name: 'Pit beans with burnt ends', short: 'Beans',     zone: 'sides', cat: 'side',     price: 5.00,  prepSec: 240, track: 'two', bom: [{ ing: 'beans', qty: 200 }] },
    { id: 'cornbread',    name: 'Cornbread with honey butter (2)', short: 'Cornbread', zone: 'sides', cat: 'side', price: 4.00, prepSec: 90,  track: 'one', bom: [{ ing: 'cornbread', qty: 2 }] },
    { id: 'fried_pickles', name: 'Fried pickle chips',    short: 'Fried pickles', zone: 'fry',  cat: 'fried',    price: 7.00,  prepSec: 360, track: 'two', bom: [{ ing: 'pickles', qty: 150 }, { ing: 'fry_mix', qty: 60 }] },
    { id: 'hushpuppies',  name: 'Hush puppies (6)',       short: 'Hush puppies', zone: 'fry',   cat: 'fried',    price: 5.50,  prepSec: 300, track: 'two', bom: [{ ing: 'fry_mix', qty: 140 }] },
    { id: 'slaw',         name: 'Jalapeno slaw',          short: 'Slaw',         zone: 'cold',  cat: 'cold',     price: 4.00,  prepSec: 30,  track: 'one', bom: [{ ing: 'slaw', qty: 150 }] },
    { id: 'potato',       name: 'Potato salad',           short: 'Potato salad', zone: 'cold',  cat: 'cold',     price: 4.50,  prepSec: 30,  track: 'one', bom: [{ ing: 'potato', qty: 180 }] },
    { id: 'pudding',      name: 'Banana pudding',         short: 'Pudding',      zone: 'cold',  cat: 'cold',     price: 5.00,  prepSec: 45,  track: 'one', bom: [{ ing: 'pudding', qty: 200 }] },
    { id: 'tea',          name: 'Sweet tea, large',       short: 'Sweet tea',    zone: 'cold',  cat: 'cold',     price: 3.50,  prepSec: 25,  track: 'one', bom: [{ ing: 'tea', qty: 480 }] },
  ];

  // audit:data-end

  /* ---------- quick-add combos (shortcuts only: each line is still routed, paced, depleted and priced on its own) ---------- */
  // Combos. Columns: id, name, lines (menu id and quantity of each). Example: the two-meat plate adds
  // brisket, pork, mac, slaw and cornbread in one tap.
  // audit:data-start
  C.combos = [
    { id: 'plate',  name: 'Two-meat plate',   lines: [{ menu: 'brisket_qtr', qty: 1 }, { menu: 'pork_qtr', qty: 1 }, { menu: 'mac', qty: 1 }, { menu: 'slaw', qty: 1 }, { menu: 'cornbread', qty: 1 }] },
    { id: 'sandy',  name: 'Sandwich meal',    lines: [{ menu: 'brisket_sand', qty: 1 }, { menu: 'fried_pickles', qty: 1 }, { menu: 'tea', qty: 1 }] },
    { id: 'family', name: 'Family pack',      lines: [{ menu: 'brisket_half', qty: 2 }, { menu: 'pork_half', qty: 1 }, { menu: 'ribs_full', qty: 1 }, { menu: 'mac_lg', qty: 2 }, { menu: 'beans', qty: 1 }, { menu: 'cornbread', qty: 2 }, { menu: 'slaw', qty: 1 }] },
  ];

  // audit:data-end

  // Preset modifier chips on the order screen. Free text is also allowed.
  C.modifiers = [
    'No pickles', 'Sauce on the side', 'Extra sauce', 'Gluten-free, separate tongs', 'Lean cut', 'Moist cut',
    'Extra bark', 'No jalapenos', 'Allergy, see note',
  ];
  // One-tap customer names on the order screen.
  C.quickNames = ['Walk-up', 'Pickup', 'Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5', 'Table 6'];

  /* ---------- pacing (research report: D_max = max d(i); O(i) = D_max - d(i); item is shown when now >= t_fire + O(i)) ---------- */
  // Meal pacing. The slowest dish on a ticket sets D_max; every other dish waits (D_max minus its own time)
  // before it shows on its station, so the plate finishes together. Example: ribs plan 180 s and slaw 30 s,
  // so D_max is 180 and the slaw shows 150 s after the ribs. Only the formula comes from the research
  // report; the numbers below are this build's choices, owner-editable within bounds.
  C.pacing = {
    enabled: true,
    learnK: 3,        // shrinkage weight toward the starter estimate (same idea as Pitcall's k = 3 days of evidence)
    floorSec: 15,     // an item never plans for less than this
    minFactor: 0.5,   // learned estimate is kept within [minFactor, maxFactor] x starter estimate
    maxFactor: 2.5,
    outlierFactor: 3, // a sample longer than 3x the starter estimate is capped before it is learned from
    qtyFactor: 0.2,   // each extra unit of a line adds 20% to its prep estimate
    qtyCap: 2.0,      // ...to at most 2x
  };

  /* ---------- service day (Pitcall F13: the night belongs to the day it started; 12:45 am counts as hour 24.75 of yesterday) ---------- */
  // openHour 11 and closeHour 21 (11 am to 9 pm) are starter estimates: owner to confirm. The sell-out clock
  // compares 86 times with closeHour.
  // taxRatePct is the sales tax in percent added to an order when it is paid. 0 means no tax is added. The owner
  // sets the real local rate; Smokebox does not know it.
  // soundStartHour is when warning sounds may start (never later than opening, so a pit master who starts at 4 am can
  // hear them); soundOutsideHours lets them sound at any hour. Outside that window the strip shows a note instead.
  C.service = { dayStartHour: 4, openHour: 11, closeHour: 21, taxRatePct: 0, soundStartHour: 11, soundOutsideHours: false,
    // Minutes a sold-out-by-quality-limit dish waits before the channel update starts, in case it is kept serving.
    qualitySyncHoldMin: 10 };

  /* ---------- food safety. Owner-editable inside safetyBounds (hotHoldF can never go below 135, same rule as Pitcall). ---------- */
  // Food-safety limits, in hours, degrees Fahrenheit and minutes. The owner can change them only inside
  // C.safetyBounds, and hot hold can never go below 135 F. The 135, 41 and 165 F limits, the cooling stages
  // and the 4-hour sanitise interval follow the FDA model Food Code (sections shown on each line); local codes can differ. The grace
  // periods run from the first out-of-range READING, not from when the food left the heat (finding F-E1, a
  // deliberate change from the research report). belowHotGraceH 2 is the research report's limit;
  // aboveColdGraceH 4 mirrors it for cold food (starter estimate). defaultMaxHoldH and tempCheckEveryMin are
  // house settings (starter estimates: owner to confirm). Always follow your local health code.
  C.safety = {
    hotHoldF: 135,          // hot TCS must stay at or above (FDA Food Code 3-501.16(A)(1))
    coldHoldF: 41,          // cold TCS must stay at or below (3-501.16(A)(2))
    reheatF: 165,           // reheat target, 15 seconds (3-403.11(A))
    belowHotGraceH: 2,      // below 135F for more than this -> discard (reheat only allowed inside it)
    aboveColdGraceH: 4,     // above 41F for more than this -> discard
    cooling: { stage1ToF: 70, stage1H: 2, totalH: 6, finalF: 41 }, // 135->70 in 2h, then 70->41 inside 4 more (6h total) (3-501.14)
    defaultMaxHoldH: 12,    // the hold limit for a product that has none of its own (every starter product has one)
    hardCapH: 12,           // the longest any batch of any kind may stay in the cabinet: at this age it is thrown out
    tempCheckEveryMin: 120, // a temperature reading is due this often (2 h is our default; check what your health department asks)
    sanitizeEveryH: 4,      // food-contact surfaces (4-602.11)
    holdWindowV2: true,     // marks settings made after the hold limit moved from a flat 4 hours to per-product limits
    tempIntervalV2: true,   // marks settings made after the check interval default moved from 30 to 120 minutes
  };
  // What a fridge, freezer or thermometer-check reading should be. A reading outside is logged anyway (never refused)
  // and flagged, so a warm cooler or a thermometer that reads wrong shows up in the log. Cold units use the cold-hold
  // limit above; a freezer should be at 0 F or colder (FDA consumer guidance). A food thermometer should read 32 F in ice
  // water and 212 F in boiling water, give or take 2 F (boiling water reads lower at high altitude, so check that flag there).
  C.readingChecks = { freezerMaxF: 0, iceF: 32, boilingF: 212, thermometerTolF: 2 };
  // Minutes before a batch's deadline at which each warning rung fires: a soft chime, then a spoken call, then
  // the loud repeating tone. Per-ingredient lists replace the default; long cooks start earlier so there is
  // time to act. Starter values: the owner can tune them.
  // Editable overrides of the ladder live in settings.alerts.ladderThresholds (null = use C.ladderMin).
  C.alerts = { ladderThresholds: null };
  C.ladderMin = { defaultMin: [60, 30, 10], byIng: { brisket: [120, 60, 30, 10], ribs: [90, 45, 20, 10] } };
  // How old each demo starter batch is, in minutes, when a fresh demo kitchen opens. Spread out on purpose so the
  // batches do not all expire at once and the first run shows the warnings working: brisket is the one nearest
  // its 8-hour limit. Ingredients not listed start fresh.
  C.starterAgeMin = { brisket: 455, pork: 410, slaw: 160, ribs: 150, sausage: 120, potato: 100, turkey: 95, mac: 70, beans: 45, pudding: 20 };
  // The allowed range for each owner-editable safety number, as [lowest, highest]. The legal limits are
  // fixed ends: hot hold never below 135 F, cold hold never above 41 F, reheat never below 165 F. The two
  // grace periods and the sanitise interval can be shortened but never lengthened past their defaults. Hold
  // time and check interval are house settings with wider ranges.
  C.safetyBounds = {
    hotHoldF: [135, 200], coldHoldF: [33, 41], reheatF: [165, 212], belowHotGraceH: [0.5, 2], aboveColdGraceH: [0.5, 4],
    defaultMaxHoldH: [0.5, 12], hardCapH: [1, 24], tempCheckEveryMin: [10, 240], sanitizeEveryH: [1, 4],
  };

  // Hold window per product (starter placeholders, owner to confirm; no source gives a maximum hold time):
  // maxHoldH is how long a batch may stay in the cabinet before it is thrown out, counted from when it goes in.
  // Brisket and pulled pork get 8 hours, everything else 4. restH is how long a fresh batch rests before it is
  // ready to serve (brisket 3 h, pulled pork 1 h, ribs 30 min; the research gives 2 to 4 h for large cuts and
  // 30 to 60 min for ribs). holdBasis says what the limit is: "quality" (a house limit for food held at
  // temperature, hot at 135 F or above) or "safety" (time as a public health control, no temperature control).
  // cookH is how long a fresh batch takes from start to ready to rest (starter placeholders, owner to confirm). With restH
  // it tells whether a new batch started now would be ready before close.
  // confirmBasis marks a starter hold basis the owner should check: cold held salads and pudding are set to a quality limit, but
  // a place that holds them outside temperature control needs a safety limit instead.
  // pullG on an ingredient is the set amount one Pull button moves out of the cabinet (one whole brisket, one rack,
  // one pan), in grams. Starter estimates: the owner sets the real unit.
  // Brisket cooked yield, from the Texas A&M AgriLife regression in the research report. Used only for
  // ingredients marked thermal. hot percent = base - perDegC x (T - 75) - perHoldH x holdH, where T is the
  // finishing temperature in C and holdH the hours held hot. chilled percent = the larger of chilledFloor
  // and (hot percent - chilledDelta). T and holdH are kept inside the ranges listed in tempC and holdH so
  // the formula is never stretched past sensible values. defaultTempC 85 and defaultHoldH 2 pre-fill the
  // new-batch form (SPEC 14.3).
  // Example: 85 C and 2 hours held: 72.9 - 8.5 - 4.2 = 60.2 percent, so 10 000 g of raw brisket gives about
  // 6 020 g cooked.
  C.yieldModel = { base: 72.9, perDegC: 0.85, perHoldH: 2.1, chilledDelta: 2.1, chilledFloor: 45, tempC: [75, 90], holdH: [0, 3], defaultTempC: 85, defaultHoldH: 2 };

  // 10 000 ms = the 10 seconds you get to undo (Pitcall rule).
  C.undoMs = 10000;        // Pitcall: 10-second undo
  C.syncTargetSec = 60;    // research report: 86 reaches every channel inside 60 seconds (simulated)
  // Size limits: lines per ticket (30), portions per line (20), customer name (40 characters, as in the
  // ticket spec), note (140, long enough for an allergy note), and how many tickets (5000) and log events
  // (40000) are kept before the oldest are dropped so the saved data stays small enough for the browser.
  // Starter values.
  C.limits = { maxItemsPerTicket: 30, maxQty: 20, maxCustomerLen: 40, maxNoteLen: 140, maxTickets: 5000, maxEvents: 40000, maxOrders: 5000, maxMoney: 10000, maxPrice: 1000, maxOrderMoney: 10000000 };
  // How an order can be paid. Smokebox only records which one it was; the card itself is taken on the owner's own
  // card reader, and no card number ever enters this app.
  C.payMethods = [{ id: 'cash', name: 'Cash' }, { id: 'card', name: 'Card' }, { id: 'other', name: 'Other' }];

  /* ---------- lookup helpers ---------- */
  // Turns a list of cards into a lookup by id: byId(menu).brisket_half is that menu row. Used for the lookup
  // tables below.
  const byId = (arr) => { const m = {}; for (const x of arr) m[x.id] = x; return m; };
  C.zoneById = byId(C.zones);
  C.channelById = byId(C.channels);
  C.ingredientById = byId(C.ingredients);
  C.menuById = byId(C.menu);
  C.payMethodById = byId(C.payMethods);
  C.comboById = byId(C.combos);
  C.syncTargetById = byId(C.syncTargets);

  /* ---------- owner names and extra entries for stations, categories and channels ---------- */
  // The owner can rename stations, menu categories and order channels, and add one or more of each. The
  // choices are kept in this browser (not in the saved kitchen state) under CUSTOM_KEY and applied right
  // here, while this file loads, so the engine, the board and the office all see the same lists. Ids never
  // change: a rename only changes what people read. A change made in the app takes effect after a reload.
  // WATCH OUT: they live outside the kitchen state, so only a backup file carries them to another device (the store
  // writes them into the backup and puts them in place before a restore checks the tickets). An older backup has none,
  // and restoring it on a device without the names would drop tickets that sit on an added station.
  const CUSTOM_KEY = 'smokebox.v1.names';
  // Size limits so a typing slip cannot grow the screen without end: names up to 24 letters.
  const CUSTOM_MAX = { zones: 8, categories: 12, channels: 8, name: 24 };
  // Turns a name into a short id: lower-case letters and digits joined by underscores, with a prefix.
  const slug = (prefix, name) => prefix + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16);
  // The first three letters of a name, upper case, for the small tag on tickets and tabs.
  const codeOf = (name) => String(name).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '???';
  // Cleans one typed name: trims spaces, squeezes runs of spaces, strips invisible direction and zero-width characters; returns '' when it is not usable.
  const cleanName = (x) => (typeof x === 'string' ? (SB.util && SB.util.cleanText ? SB.util.cleanText(x) : x.replace(/\s+/g, ' ').trim()) : '');
  // Checks a typed name against the others in a list (ignoring one id): true if another entry has it.
  const nameTaken = (list, name, exceptId) => list.some((e) => e.id !== exceptId && e.name.toLowerCase() === name.toLowerCase());
  // Rebuilds the lookup tables in place, so code that already holds them still sees the new entries.
  const reindex = () => {
    for (const [tbl, list] of [['zoneById', C.zones], ['channelById', C.channels], ['categoryById', C.categories]]) {
      C[tbl] = C[tbl] || {};
      for (const k of Object.keys(C[tbl])) delete C[tbl][k];
      for (const e of list) C[tbl][e.id] = e;
    }
  };
  // The built-in lists as they were before any custom change, so a spec is always applied to the starters.
  const BASE = { zones: C.zones.map((x) => Object.assign({}, x)), categories: C.categories.map((x) => Object.assign({}, x)), channels: C.channels.map((x) => Object.assign({}, x)) };
  // Applies a custom spec {rename:{zones,categories,channels}, add:{zones,categories,channels}} to the
  // lists. Bad entries are skipped and named in the returned rejected list. Safe to call again with a new spec.
  C.applyCustom = function (spec) {
    const rejected = [];
    const sp = spec && typeof spec === 'object' ? spec : {};
    const ren = sp.rename && typeof sp.rename === 'object' ? sp.rename : {}, add = sp.add && typeof sp.add === 'object' ? sp.add : {};
    const kinds = [['zones', C.zones, 'z_'], ['categories', C.categories, 'c_'], ['channels', C.channels, 'ch_']];
    // Start from the starter entries, then restore the work-station list to the same array object.
    for (const [k, list] of kinds) { list.length = 0; BASE[k].forEach((x) => list.push(Object.assign({}, x))); }
    C.workZones.length = 0; C.zones.forEach((z) => { if (z.id !== 'expo') C.workZones.push(z.id); });
    for (const [k, list] of kinds) {
      const r = ren[k] && typeof ren[k] === 'object' ? ren[k] : {};
      for (const id of Object.keys(r)) {
        const e = list.find((x) => x.id === id), nm = cleanName(r[id]);
        if (!e || !nm || nm.length > CUSTOM_MAX.name || nameTaken(list, nm, id)) { rejected.push(k + '.' + id); continue; }
        e.name = nm;
        if (k === 'zones') { e.long = nm; e.code = codeOf(nm); }
        if (k === 'channels') e.short = nm.slice(0, 5);
      }
      const extra = Array.isArray(add[k]) ? add[k] : [];
      for (const x of extra) {
        const nm = cleanName(x && x.name);
        const id = x && typeof x.id === 'string' && /^[a-z0-9_]{2,24}$/.test(x.id) ? x.id : slug(k === 'zones' ? 'z_' : k === 'categories' ? 'c_' : 'ch_', nm);
        if (!nm || nm.length > CUSTOM_MAX.name || list.length >= BASE[k].length + CUSTOM_MAX[k] || list.some((e) => e.id === id) || nameTaken(list, nm)) { rejected.push(k + '+' + nm); continue; }
        if (k === 'zones') { list.splice(list.length - 1, 0, { id, name: nm, long: nm, code: codeOf(nm), icon: 'pot' }); C.workZones.push(id); } // expo stays last
        else if (k === 'categories') list.push({ id, name: nm });
        else list.push({ id, name: nm, short: nm.slice(0, 5), icon: 'plate', warnSec: 480, breachSec: 720 });
      }
    }
    reindex();
    return { rejected };
  };
  // The spec saved in this browser, or an empty one.
  C.customSpec = function () {
    const U = SB.util;
    let v = null;
    try { v = U && U.storage ? U.storage.get(CUSTOM_KEY, null) : null; } catch (e) { v = null; }
    return v && typeof v === 'object' ? v : { rename: {}, add: {} };
  };
  // Saves a spec for the next start. Returns false if it holds nothing usable or storage refused it.
  // The change shows on the screens after a reload.
  C.saveCustom = function (spec) {
    const U = SB.util;
    if (!U || !U.storage) return false;
    return U.storage.set(CUSTOM_KEY, spec) !== false;
  };
  C.customLimits = CUSTOM_MAX;
  reindex();
  C.applyCustom(C.customSpec());
})(typeof globalThis !== 'undefined' ? globalThis : window);
