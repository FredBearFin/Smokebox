# Smokebox KDS handoff, written 2026-10-18

Read this whole file first. It is written for a fresh Claude session that has none of the earlier conversation. Freddy is the product owner.

## 0. Ground rules that override everything else

1. **Smokebox is a separate app from Pitcall.** Never touch Pitcall code, the Pitcall project docs (`z-method/refinement.md`, `z-method/pitcall.z.md`, `z-method/findings.md`) or Pitcall memory notes. The two apps may share knowledge, but Smokebox work stays in Smokebox files.
2. **Quick, targeted checks only.** Freddy said: "We don't need nine minute tests, I can test it myself." Never run the long browser suites (`test/floor.e2e.mjs` takes about 117 s, `test/shell.e2e.mjs` about 78 s, and any "run everything" script). The unit suite (about 27 s) is fine.
3. **LEAN comments.** Every named function gets a plain-words comment of at least 6 words directly above it. No stretch of more than 40 lines of code without a note. Check with `node tools/comment-audit.mjs` (a block-comment banner within 2 lines above a function defeats the check, so leave a blank line after banners). See `docs/comment-style.md`.
4. **US spelling in every visible string.**
5. **Freddy's working preferences:** deep, analytical answers (not short ones); weights in grams and kg for food; in lists write every entry out in full (he cannot follow "same as above"); English only; he is blunt and wants honest product judgment, not flattery.
6. Send short status messages during long work so he knows what is happening.

## 1. What Smokebox is

A kitchen display and order-entry app for small BBQ restaurants and bars, shipped as **one self-contained offline HTML file** (`dist/smokebox.html`, about 1.6 MB), with a hidden "back office" of analytics pages.

- Market decision: sell to tiny restaurants and bars (rural West Virginia is the mental model). It is a small order-entry system plus kitchen display, not a full POS. Software only, no hardware hub.
- Packages: **Solo** (one device, no internet needed; this is today's app) and **Connected** (front of house and kitchen on separate devices, needs Wi-Fi or internet; not built yet). Connected mode must survive internet blips: offline-first, queue and sync, host assigns ids, engine stays deterministic.
- Payments are only recorded (cash, card, other), never processed. Card readers stay separate.

Code layout (`src/js`, concatenated in file-name order by `tools/build.mjs`; files starting with `_` are skipped; all code hangs off the global `SB`):

| File | What it holds |
|---|---|
| `00-util.js` | helpers, money and date formatting, `U.parseDollars`, seeded random numbers |
| `05-icons.js` | SVG icons |
| `10-config.js` | menu, ingredients (par, 86 level, hold limits), channels, zones, safety settings, pay methods |
| `20-engine.js` | pure deterministic engine: `apply(state, type, payload, now)`, actions `A.<name>`, invariants I1 to I16, gates for batch hold and cooling |
| `30-store.js` | state, virtual clock (`setSpeed` up to 1000x), persistence, multi-tab sync, dataset bundle, CSV export |
| `40-metrics.js` | analytics (`M.sales`, pace, anatomy, stock burn, sell-out clock, insights) |
| `45-sim.js` | 14 days of sample history and the live demo crew (`SB.sim.live.burst(n)`, `.crew(false)`) |
| `50-charts.js` | SVG charts |
| `60-shell.js` | router, UI kit (`SB.ui.sheet`, `segmented`, `toast`, etc.), quick menu |
| `70-floor-board.js` | the kitchen board: header, station tabs, ticket slips, sound, header badges |
| `71-floor-order.js` | New ticket sheet (pay now or add a round) |
| `72-floor-sheets.js` | Hold cabinet, 86 board, Recall, Demo, Help sheets |
| `73-floor-orders.js` | Orders list and Take payment |
| `74-floor-tour.js` | guided tour |
| `80` to `85` | back office pages: Pace, Tickets, Stations, Sales and money, Safety, Stock and 86, Menu and settings |
| `99-boot.js` | startup |

CSS is in `src/css/*.css`. Longer docs: `SPEC.md` (contract; section 20 is the as-built addendum and the code overrides both), `docs/design-notes.md` (tokens and components), `docs/office-contract.md`, `docs/smokebox.z.md` (formal engine spec), `docs/qa-report.md`, `docs/findings.md`, `docs/agent-brief.md` (older brief for sub-agents, partly outdated).

### The order model (built Oct 2026)
An **Order** (the bill) owns prices, tax, tip, discount and payment. Each round of food is a kitchen **ticket** linked by `orderId`. Paying freezes the totals; revenue truth comes from paid orders. Actions: `createTicket` (optional `orderId`, `pay`), `payOrder`, `reopenOrder`, `voidOrder`. Tax is a flat percent setting (`service.taxRatePct`, 0 to 20, default 0). Back office "Sales and money" shows Takings from paid orders. Orders CSV export exists.

## 2. What Freddy said on Oct 18 (the product feedback that drives the next work)

- The kitchen display is for **tablets and computers/TVs, not phones.** Phone is useful only as a **manager glance tab** (money so far today, open orders, anything late, what is 86'd, when brisket runs out). I (the previous session) wasted effort on phone layouts for the kitchen.
- **Who uses it:** pit master (batch decisions, hours ahead), line/assembly cook (ticket clock, minutes), expo/runner, counter person, owner. In tiny places one person wears several hats, so device follows role, not person.
- **Chefs are cooking.** Make it less tap-based and more of a thing that tells them what to do ("screams at you"): an active expo-caller, not a passive digital ticket rail.
- **Features were hidden in menus.** While he played with it, all the meat in the hold cabinet expired and went 86 because he was not watching the times. The app should have warned him that the meat was reaching its time.
- He wants **real user-interface testing**, not more functional testing. The app is very functional but was built and tested as an engine, not as something a cook reads from 6 feet away.
- He parked the Kenya/overseas idea: "forget the Kenya thing."
- His verdict: the product "needs a ton of work actually," but he thinks it should exist and "it seems good."

Why it should exist (my analysis): BBQ's real problem is meat, not tickets. Cooked-ahead meat sits in a hold cabinet and the ticket triggers slicing and assembly. Two clocks: the **batch clock** (hours; pit master; how much to cook, when to load, when it runs out) and the **ticket clock** (minutes; line and expo). Generic kitchen displays do not think in batches, hold time, yield and sell-out. Lead with the pit and the count, and use the ticket board as the delivery vehicle.

## 3. UX test results (measured Oct 18; full detail in `docs/ux-test-report.md`, scripts in `ux-scripts/`)

**Critical**
1. **Batch expiry has no warning ladder and the one signal cries wolf.** Replayed by fast-forwarding the clock on an idle kitchen. The ten starting batches (one per ingredient, all `enteredAt: now`, see `20-engine.js` near line 2314) have a 4-hour hold limit (`defaultMaxHoldH: 4` in `10-config.js`). The Hold button lights with "10" at about 36 minutes because each batch needs a temperature reading every 30 minutes (`tempCheckEveryMin: 30`). It says nothing about expiry and stays lit for 3+ hours. At 4 h 2 min all ten batches are discarded at once: Hold badge disappears, 86 badge shows 17, no sound, no banner. Sample value lost: about $762 (parG x costPerKg; brisket alone $341). The Hold sheet does show "35m of 4 h" per batch, but only after you open it.
2. **Sound is off by default, nothing is spoken, and there is no screen keep-awake request** (no `wakeLock` anywhere). Existing sound: `chime()` (two notes, new ticket) and `checkChime()` (three beeps when a dish's time is up) in `70-floor-board.js`; `F.setSound` switches it on.

**High**
3. Below 1180 px wide, Hold cabinet, 86 board, Recall and the sanitize timer move into the Menu button (`css/20-floor.css` near line 165). At 1024x768 they are gone from the header. Affects older/smaller iPads and 1024-wide Android tablets.
4. **Text is too small for distance.** Measured on a 1280x800 tablet: ticket number 24.5 px, timer 22 px, item and customer names 16 px, "Tap START on..." line 12.5 px, status chips 12.5 px, station tags 11 px. With my stated assumptions (cap height 0.72 x font size; 0.4 degrees comfortable, 0.2 barely legible), item names are comfortable to about 0.9 ft on a 10.1-inch tablet and about 3.2 ft on a 43-inch 1080p TV (barely legible to 6.4 ft). Ticket numbers on that TV are comfortable to about 5 ft. There is no far-display mode. Use `ux-scripts/reading-distance.py`.
5. **Taps:** a 3-item ticket costs 8 taps from first touch to bump (4 items cost 10), about 340 taps in a 40-ticket rush. New order with 3 items: 6 taps plus a name. Payment: 3 taps. 86 an item: 2 taps. Analytics (pace, anatomy) depend on these taps being accurate.
6. When many tickets are overdue the whole board is pink with no ranking (9 of 13 in the test), and every healthy ticket carries a green "On time" chip, so the screen is never quiet.

**Medium**
7. Tickets have different heights in a multi-column grid; busy boards push items below the fold; the all-day counts strip at the bottom is cut off.
8. Toasts stack in the middle of a sheet and cover buttons (seen on the 86 board).
9. The 86 board opens with a simulated "Channel sync" block (no POS connected) that pushes the real controls down.
10. Units are mixed: New batch form uses degrees Celsius and kg; hold alerts use degrees Fahrenheit. No units setting.
11. The New batch form has many inputs (product, raw weight, cook endpoint, rest hours, first temperature, label) and no "same as last batch" shortcut.

**Done well:** tap targets 44 px and up (primary buttons larger); START/DONE/Bump have icon plus word; Overdue uses icon plus word, not color alone; each ticket already has a "what to do next" line (right idea, too small); station tabs with counts; Undo after bump; type scales about 25 percent from 1280 to 1920 wide; no console errors in any run.

**Corrections to things the previous session first said:** tap cost is higher than first estimated (8, not 4 to 7, per 3-item ticket); and the Hold badge does light early (for temperature readings), it does not wait for expiry.

**Caveat:** everything was simulated. No real cook has used the app through a real service.

## 4. Proposed plan (Freddy has not yet approved the order; confirm before building)

**Phase A: stop losing meat silently**
- A1. One **deadline feed**: a single function returning every upcoming deadline sorted by urgency, each with "what happens if nothing is done" (batch expiry, temperature check due, cooling stage deadlines, sell-out ETA from stock burn, late tickets, sanitize timer). The engine already has `gate()` and `statusDeadline()` (`20-engine.js` near lines 459 and 493) and the discard dialog already computes which menu items go 86.
- A2. An always-visible **attention strip** at the top of the kitchen board showing the top one to three items with countdowns.
- A3. A **batch escalation ladder** (placeholders, tunable): about 60 minutes left a soft chime and amber note; 30 minutes a spoken call and banner ("Brisket goes 86 in 30 minutes, no other brisket in the cabinet"); 10 minutes large type and a loud tone repeating until acknowledged; at expiry a distinct sound and a discard-and-log prompt. Make severity depend on whether another batch of the same item exists.
- A4. Sound **on by default** with a first-run sound check (browsers need a first tap to unlock audio; `hookAudioUnlock` exists); voice **out** with `speechSynthesis`, not voice in; request a screen wake lock.
- A5. Fix the temperature-check cry-wolf: the badge must say why it is lit; consider a cabinet-level reading or a longer default interval (Freddy should confirm; check local health code).
- A6. Stagger the demo's starting batches (different ages, one or two near expiry) so first run shows warnings working.

**Phase B: display for a kitchen**
- Far-display ("TV") mode: bigger type, fewer columns, one dominant NOW instruction with NEXT and LATER below; a quiet screen when everything is fine (drop the "On time" chips); overdue tickets ranked and escalating in size.
- Fix the 1180 px header breakpoint (keep Hold, 86, Recall visible on tablets, or use a bottom bar); non-blocking toasts; collapse or remove the Channel sync block on the 86 board; units setting (degrees F or C, lb or kg).

**Phase C: fewer taps**
- Move the bump to clean hands (runner or counter taps "picked up"); cook taps nothing in the common case.
- Track per-item events only for long cooks and pit batches; infer short items as estimates and mark them "estimated" so analytics can tell real from guessed timestamps.
- Whole-card large targets; "same as last batch" for the pit; optional foot pedal or Bluetooth button mapped to "bump oldest" (optional extra, because Freddy wants software only).

**Phase D: role views.** Kitchen (the active caller; separate pit screen for the batch clock and line screen for the ticket clock), Front (order entry and payment), Manager (phone glance tab). Device equals role.

**Phase E: Connected mode** (open question: browser-only WebRTC with the kitchen page as host and a join code, versus an installed host app later). **Later:** end-of-day close and cash count, Sales CSV, refresh the Claude Docs guide (doc id 96b752ed-b6fd-4f95-8ba3-be48ae8ffdbc is stale: old header image and page names, no order docs).

**Acceptance test for Phase A and B:** start a service with three batches of different ages and walk away. From 10 feet, within 10 seconds, with zero taps, a person should know which batch is about to go, what happens if nothing is done, and what to do.

## 5. How to build and check (all quick)

Requires Node 22. Browser scripts need Playwright; `tools/pw.mjs` loads it from `/opt/npm-tools/node_modules/` (this path is specific to the environment the project was built in; change the `createRequire` path in `tools/pw.mjs`, `tools/qa.mjs`, `tools/contract-check.mjs`, `tools/code-fingerprint.mjs`, `tools/qa-contact.mjs` and `test/artifact.e2e.mjs` if Playwright or acorn live elsewhere).

```
node tools/build.mjs --quiet                  # writes dist/smokebox.html
node tools/test.mjs                           # unit suite, about 27 s, 307 tests
node --test test/engine.unit.test.mjs         # engine only
node --test test/metrics.test.mjs             # analytics
node tools/comment-audit.mjs                  # LEAN comment check, must say "all files pass"
node tools/contract-check.mjs                 # static references plus a boot and smoke pass, about 30 s
node tools/code-fingerprint.mjs check         # shows which files changed since the last accept
node tools/code-fingerprint.mjs accept        # run after a deliberate code change
node test/floor-sheets.e2e.mjs --only=order,recall    # one quick browser group, about 12 s
node tools/build-artifact.mjs                 # writes dist/smokebox.artifact.html for publishing
```

UX measurement scripts: `cd ux-scripts && mkdir -p out && node ux2-text-and-tap-sizes.mjs` (needs `dist/smokebox.html` built first). Useful app hooks in the browser console or scripts: `SB.floor.setWelcome(false)`, `SB.sim.live.crew(false)`, `SB.sim.live.burst(9)` (nine demo tickets), `SB.store.setSpeed(1000)` (fast-forward the clock), `SB.store.now()`, `SB.router.go({kind:'office', section:'money'})`.

## 6. Known simplifications

- Voiding a ticket does not auto-void its order (the Orders screen offers "Void empty order").
- Sample orders have one round each; default tax is 0 so sample Takings show $0 tax.
- Demo-seeded "Table 4" order exists on first run, so a new "Table 4" opens a second order with the same name.
- Channel sync (to POS, online ordering, drive-thru, delivery apps) is simulated and labeled as such.
- Starter numbers (prep times, yields, costs, par levels) are labeled "starter estimate".

## 7. Publishing

The page is published privately as **Smokebox KDS** (version 6 as of Oct 18): https://claude.ai/artifact/Mtm1cPrWuZxqtMydv8FtQZ. To update it from a new conversation, read it with the Artifact tool first, then publish `dist/smokebox.artifact.html` with that URL (no icon on redeploy). The artifact build renames `data-theme` to `data-look` (done by `tools/build-artifact.mjs`). Artifacts cannot use WebRTC or service workers, so any two-device link test needs a downloaded HTML file, not an artifact.

## 8. Open questions for Freddy

1. Which POS or card reader do the target restaurants use today? If they ring cards on a separate terminal, staff would enter payments twice. This decides whether Smokebox replaces order entry or must sit beside it.
2. Who physically stands at the pit in the target places? Is the meat cooked ahead and sliced to order, or cooked to order?
3. How do orders reach the cooks today (paper rail, shouting, a printer)?
4. Which devices do owners and cooks already own (tablet, TV, old laptop)?
5. Connected mode route: browser-only join code first, or an installed host app?
6. Can he arrange one watched real service at a BBQ place? That is the missing test.

## 9. Not in this package

Pitcall materials and the large reference PDFs (Pitcall sibling spec, foodservice research report, UI design slides, web-design and Z-notation books) were left out to keep this package small and Smokebox-only. `reference/smokebox_original.html` (the original brief page) is included. Test output folders and old build variants were dropped; `node tools/build.mjs` recreates `dist/smokebox.html`.

## 10. Session of 2026-10-19: the two-tap pivot (what was built)

Freddy's direction: tickets are two taps (**Start**, then **Release**), the app tells the cook when to fire each item ("for dumb chefs", so plain imperative sentences), and the back office becomes Six Sigma style defect analysis.

**Engine (`20-engine.js`)**
- `createTicket` takes `awaitStart:true`. Such a ticket fires nothing until `startTicket`. `startTicket` re-times the plan from the Start moment (items get `rebased:true`, ticket gets `startedAt`), and is undoable. Items already worked by hand (fire now) keep their times.
- `releaseTicket` finishes every open item (no prep-time learning, items marked `released`) and bumps in one step, undoable. Events: `ticket_started` (lagMs), `ticket_released` (startLagMs, cookMs, afterReadyMs), plus the usual `ticket_expedited`.
- Invariant I5 now reads: `fireAt = (rebased ? startedAt : createdAt) + offset`; the due-but-queued check skips tickets waiting for Start. New report ids `notStarted`, `alreadyStarted`.
- Tickets made without `awaitStart` behave exactly as before (the 14-day history sim still uses the old per-item taps).

**Coach (`26-coach.js`, `SB.coach`)**: pure function `read(state, now)` turns open tickets into cards: phase (`start`, `fire`, `run`, `plate`), one headline sentence ("Drop 2 x Hush puppies in the fryer"), per-item steps (wait, fire, cook, pull) and the one button. Late tickets jump the queue. Wording tables (`SAY`, `SAY_BY_MENU`, `SAY_BY_ZONE`) are starter text.

**Call screen (`75-floor-caller.js`, `24-floor-call.css`)**: first tab on the board and the home view. Big card for the most urgent job, smaller cards below, one giant button per ticket. Chime and spoken line (`speechSynthesis`) for a new ticket, an item to put on and a plate to release. `F.setCallMode(false)` switches back to the classic board (it starts every waiting ticket first). The order sheet and the demo crew create tickets with `awaitStart` while Call mode is on; the crew taps Start and Release itself.

**Quality page (`41-quality.js`, `86-office-quality.js`, `33-office-quality.css`)**: first page in the back office. Defect types (late, started late, plate waited, released early, sent out incomplete, recalled, voided, ran out of an item, batch thrown away, temperature check late), DPMO and sigma level (1.5 shift), Pareto, likely causes of late tickets, p-chart and individuals chart of daily numbers, Cpk against the overdue limit, worst tickets, and a table saying how each defect is counted. Under 20 tickets there is no sigma score; under 5 days or 30 tickets the charts and Cpk say "not enough data". Targets in `SB.quality.TARGETS` (start within 60 s, plate wait under 90 s) are starter estimates.

**Checks run this session**: `node tools/test.mjs` (396 pass, includes new `twotap`, `coach`, `quality` tests and the fuzz test extended with the two actions; also run with 1500 sequences x 3 seeds), comment audit passes, contract check shows 8/8 office pages clean, one quick browser group (`floor-sheets --only=order,recall`) passes. Real-browser flow checked at 1024x768, 1280x800 and 1920x1080: Start then Release is exactly 2 taps. The long browser suites were not run (per the ground rules), so `test/floor.e2e.mjs`, `shell.e2e.mjs` and `office*.e2e.mjs` may need their expectations updated for the Call tab and the eighth office page.

**Not done yet / next**
1. Learning loop: Release does not teach prep times, so the starter times stay fixed. Idea: learn from Start-to-ready only when the cook confirms "it was ready".
2. Phase A leftovers still apply (staggered demo batches, temp-check badge wording). The attention strip is shown above the Call screen and is clamped to one line there.
3. No cause codes yet for non-late defects; the page infers causes from timestamps only.
4. Header at 1024 px still moves Recall, 86 and Hold into the menu (Phase B).
5. Open product questions in section 8 still stand, especially whether a runner exists (Release meaning) and who stands at the pit.
