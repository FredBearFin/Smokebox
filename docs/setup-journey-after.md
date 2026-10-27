# Setup journey after rounds 2 and 3 (measured 2026-10-23; round 3 on branch night/a2-r3)

Same method and same limits as `docs/setup-journey-before.md`: `ux-scripts/setup-journey.mjs` drives the built app in headless Chromium at 1280x800 from empty storage; time is MODELED (1.2 s per tap, 3 s plus 0.25 s per character per typed field, 4 s reading each new screen), not a person with a stopwatch; nothing was tried on a real tablet. One new assumption: the cursor is already in the name box (the sheet and "Save and add another" put it there) and Enter or the tablet keyboard's Next key moves to the price box, so those two fields cost typing but no extra tap. The script checks the cursor really is where it assumes and flags a confusing moment if not (none flagged). Screenshots: `docs/ux-shots/night/a2/` (the round-1 shots were replaced by the new ones; the before numbers are in the before doc and `journey.json` history).

## Numbers against the targets

| Measure | Before (round 1) | After | Target |
|---|---|---|---|
| Fresh install to first PAID ticket, three own dishes: taps | 24 | **13** | about 17 |
| Typed fields | 7 | **6** (53 characters) | 6 |
| List choices (drop-downs) | 4 | **0** | 0 |
| Screens read | 13 | 9 | |
| Modeled time | about 2.0 min | **about 1.4 min** | under 10 min |
| Adding three dishes alone | 11 taps, 6 typed, 3 choices | **6 taps, 6 typed, 0 choices, about 54 s modeled** | under 2 min |
| Dead ends / confusing moments | 0 / 8 (guided), 2 dead ends (naive) | **0 / 0** | 0 |
| Dishes, ingredients, prices the owner did not enter | 21 / 15 / $3.50 to $29 | **0 / 0 / none** | none |
| Red 86 badge on first open | 17 | **0** | none |
| "New tablet?" toast after 8 s | yes | **gone** | gone |
| Tap New ticket with no dishes | an order screen with 17 sold-out tiles | **the Add a dish form opens** | no dead end |
| Taps to change a price later (Menu, Dishes and prices, type) | 3 taps plus scrolling past 21 dishes in the back office | **3 taps, 1 typed field, no back office** | |

The 13 taps: Add your first dish (1); per dish a tap on the station tile when it differs from the last dish and Save (2 each, 6 total; a dish at the same station as the last costs 1); New ticket (1); three dish tiles (3); Cash (1); Send (1). Real first-timers will be slower; this is a best case with no hesitation or typos.

## What changed (screen by screen)

1. First open: empty board, one big "Add your first dish" button, two quiet links (Show me how it works, Try the busy-night demo (pretend)). No welcome card, no 86 badge count, no demo tickets. (`01-A-first-open.png`; blank-start data comes from A5's branch.)
2. "Dishes and prices" sheet: name, price, four big station tiles (Pit, Hot sides, Fry, Cold and drinks, each with a plain hint), Save and add another, Save and finish. The first dish needs a station tile tap; after that the last station stays chosen. Category, prep time and short ticket name are under "More options" and default from the station tile; a prep time the owner did not type is stored as a guess ("starter estimate"), fixing the old "Confirmed by default" oddity. Half-typed text is kept if the tab closes.
3. Dishes so far appear in the same sheet as editable rows (name, price, Remove). Remove archives the dish. The main Menu sheet now has a clear "Dishes and prices" entry (the header Menu button itself is not renamed). The full back-office editor stays one tap away for ingredients and prep times.
4. "More ways to add dishes" fold: "Start from an example menu" adds 8 dishes with made-up prices, each marked Example, with a one-tap "Remove all example dishes". Import is not built yet.
5. "Tax, hours and PIN" sheet (from the Dishes sheet): tax percent, opening hours as plain times ("10 am", "1 am (next day)"), optional PIN, and one yes/no "Do you cook meat ahead and hold it hot?" that is only remembered for now (it says "Nothing changes yet"). The kg and probe-temperature step is gone from setup.
6. After the first dish a slim card says "Your menu is ready, your menu has N dishes" until the first ticket exists or it is closed. There is no "Finish setup" flag: setup is done when one dish exists, and the board always reflects the saved dishes after a reload.
7. The 8-second "New tablet? 6-step setup" toast is removed. The tablet checklist stays under Menu, "Set up this tablet".

## Tests

`node test/setup-wizard.e2e.mjs` rewritten for the new flow (19 checks, about 20 s, all pass): first-run button, no welcome card or tickets, New ticket with no dishes opens the form, missing station message, saved dish with station and guessed prep time, remembered station, right category and tap style, duplicate name refused, price edit, Remove, example menu marked and removed in one tap, reload keeps dishes and the half-typed name, tax and hours saved, no late toast, Menu has Dishes and prices, no page errors. Unit suite: 517 pass, 0 fail. Comment audit: all files pass. The slow floor and shell suites were not run.

## Not checked

- A real tablet, on-screen keyboard behavior (does Next/Enter move to the price box?), real first-timers. The 2-minute and 10-minute targets are modeled only.
- Cook-ahead meat flow: the yes/no does nothing yet; ingredients, batches and the cabinet for a cooked-meat dish were not touched.
- Station tiles with owner-renamed or extra custom stations (defaults for a custom station are generic; the tiles list `workZones`).
- A removed dish keeps its name, so re-adding the same name is refused with an explanatory message (engine rule, not changed).
- The Demo sheet's "Restart demo" on an own kitchen that already has dishes: A5 says it is refused unless `replaceOwn: true`; its confirm text needs to say it erases the owner's dishes. I did not change that sheet.
- Import, the tour text (still talks about the old setup in places), phone widths, Night theme and Large text on the new sheets.
- The old floor.e2e check of the welcome card (line 709 of test/floor.e2e.mjs) will need updating; I did not run that suite.

## Questions for Freddy

1. Is "Where is it made?" with four station tiles the right wording for a restaurant owner, or would "Who makes it?" or "Kitchen / Bar" read better? The station names (Pit, Hot sides, Fry, Cold and drinks) are still the barbecue config.
2. Should the example menu exist at all? It is hidden and labeled, but it is still made-up barbecue prices.
3. Should the first dish require tapping a station, or should the app pre-pick one (faster, but risks a wrong station on a ticket)?
4. The cook-ahead yes/no sits in "Tax, hours and PIN". Do you want it asked once, right after the first dish, instead?
5. Removed dishes block their name forever. Is that acceptable, or should Remove truly delete a dish with no tickets?

## Round 3 additions (branch night/a2-r3)

New measured variant D: a one-station kitchen (the other three stations hidden before the owner starts). Same script, same model.

| Run | Taps | Typed fields | List choices | Modeled time |
|---|---|---|---|---|
| A: four stations (default) | 13 | 6 | 0 | about 1.4 min |
| D: one station showing, no "Where is it made?" question | **10** | 6 | 0 | about 1.3 min |

What changed in round 3:
1. **Stations.** Inside Dishes and prices, a "Change stations" fold lets the owner rename a station, hide it or add one ("Bar"). Names are written through `SB.config.applyCustom` / `saveCustom` (the same saved names the board, tickets and Data page read; nothing duplicated), checked first so a bad name changes nothing, and shown on the tiles at once; the board and tickets show them after a reload (a Reload button appears). With only one station showing, the question is skipped and every dish goes to it. Hiding only removes the tile from the add form: the board's station tabs still list all stations (the shared config has no "hidden" idea and I may not edit it).
2. **Editing later.** Remove now shows "Removed X. Undo". A fold "Removed dishes" lists removed dishes with "Bring it back". Typing a name that belongs to a removed dish shows "X was removed earlier. Bring it back" and un-archives it at the typed price. **Reorder is not done**: there is no engine action to move a menu item, and I may not edit the engine.
3. **Cook-ahead** is now the real setting (`settings.modules.cookAhead` through updateSettings), asked as "Do you cook food ahead and hold it warm or cold?", Yes/No, with a one-line note on what appears. An old saved kitchen with no value counts as Yes so nothing vanishes from it.
4. **Settings grouped by task** in the back office page: Shop (Menu, Appearance and hours, PIN), Kitchen (Ingredients, Time limits), Safety (Food safety), Devices (Data, About), Advanced (Meal pacing, in a fold that starts closed and opens when linked to). There is no separate Money panel (tax lives in Appearance and service hours, so it sits under Shop), so I did not invent an empty Money group. Panel labels and help text belong to A3 and were not changed.
5. **First-steps card** ("Your menu is ready") is marked done for good the moment any ticket or order exists, so clearing the board later does not bring it back; its buttons are at least 44 px high.

Screenshots looked at: `r3-blank-kitchen`, `r3-dishes-three-stations` (Change stations open), `r3-dishes-one-station`, `r3-dishes-night-large` (Night plus Large text), `r3-dishes-phone-390`, `r3-firstrun-phone-390`, `r3-shop-sheet`, `r3-settings-groups` in `docs/ux-shots/night/a2/`.

Tests: `test/setup-wizard.e2e.mjs` now has 31 checks (all pass), including Undo, Bring it back, station rename/hide/add, one-station skip, the real cook-ahead setting, and the card never returning. Unit suite 526 pass, 0 fail.

Not checked in round 3: the new settings grouping on phone width and in Night; a station renamed then restored on another device (names are per browser, as the config warns; a backup does not carry them); more than 8 added stations (the config's limit); Reload button wording on a real tablet; the board's own station tabs after hiding (they still show every station); what A1 and A3 hide when cook-ahead is No (their gating was not merged when I wired the setting).

Questions for Freddy: (a) Should hiding a station also hide its board tab? That needs a small change in the shared config and board. (b) Is "Change stations" too much for a first run, or fine because it is folded shut? (c) Do you want dish reorder? It needs an engine action first.

## Round 4 additions (branch night/a2-r4)

New measured run E: the cook-ahead path from a blank kitchen. The owner adds one dish (Brisket plate), taps "Yes, I cook ahead", adds Brisket (hot, 4 h default), links the dish, logs a first batch in the cabinet with the pre-filled values, then takes a paid order for it. Same model and limits as above (modeled time, headless Chromium, no real person).

| Run | Taps | Typed fields | List choices | Modeled time | Result |
|---|---|---|---|---|---|
| A: three dishes, four stations | 13 | 6 | 0 | about 1.4 min | paid |
| D: three dishes, one station | 10 | 6 | 0 | about 1.3 min | paid |
| **E: one cooked-ahead dish, Brisket added and linked, first batch logged, order paid** | **14** | **3** (dish name, price, Brisket) | 0 | **about 0.9 min** | 1 batch logged, paid |

The batch is logged with the form's starting values (raw weight, cook endpoint, first reading 150 F). A real cook would check the probe and change them, so real time is longer. Cooked-ahead is optional: runs A and D never touch it.

What changed:
1. **Cooked-ahead food.** After the first dish the Dishes sheet asks "Do you cook any of this ahead and hold it?" with "Yes, I cook ahead" (turns the cook-ahead setting on and opens the sheet) and "No, skip this" (remembered). The "Cooked-ahead food" sheet takes a name, hot or cold, how long it may stay (4 h default, with a note that the local health code decides and to ask the health department), an optional usual batch size in kg, and a tick list of dishes with grams per serving (150 is a starting guess). It calls addIngredient, then updateMenuItem with a bom for each ticked dish; the dish's existing recipe lines are kept. "Log a first batch" opens the cabinet on the new batch form with the product chosen. An empty cabinet Product list now says "No cooked-ahead items yet" with an "Add a cooked-ahead item" button, and hides the weight form and the Put in hold cabinet button until there is a product.
2. **Portions on hand.** A dish row has "I count what I made" (starting number, then Start counting). A counted dish shows "N left" (or "0 left (sold out)"), "+10", a custom Add, and Stop counting. A dish that already lists ingredients gets the plain refusal. The hidden "Portions of X" ingredient is never listed in my sheets.
3. **Stations: Not used.** Hide is now "Not used" / "Use again". A station marked Not used leaves the add-form tiles and its board tab, unless it has open tickets or is the tab being viewed (so no ticket is ever out of sight). Done with a small `F.applyHiddenTabs` in the board plus a CSS hide, no shared-config edit.
4. A list bug found while testing: the dish list did not redraw after a button press inside a row. Fixed (it now waits only while a text box is being typed in).

Tests: `test/setup-wizard.e2e.mjs` has 38 checks, all pass (adds the cooked-ahead question, Brisket added and linked, first batch form, portions 20 left and +10 to 30, the hidden ingredient not shown, a Not used station losing its tab). Unit suite 543 or 544 pass; one run showed 1 failure that did not repeat in two re-runs (0 fail), so a flaky timing test; I did not find which.

Screenshots looked at: `r4-question-blank` (module off, question after the first dish), `r4-portions`, `r4-added-night` (Night), `r4-cooked-phone-390`, `r4-portions-phone-390`, `r4-cabinet-no-product`, and the E run steps.

Not checked: the order screen's wording when a counted dish runs out (A1's sentence; I only saw the row text); real cooking yields (a new item has no yield or cook model, so a batch counts cooked weight 1 to 1 with raw until the owner enters real numbers); cold items and a batch size above 1000 kg; undo of Add item (the engine supports it, my sheet does not expose it); Stock and 86 office lists still need A3 to filter the hidden "Portions of" ingredients.

Questions for Freddy: (a) Is 4 hours the right careful default, and should the sheet name a typical value for cold food? (b) Is 150 grams per serving a sensible starting guess, or should the owner be asked? (c) Should "Yes, I cook ahead" turn the whole cook-ahead part on right there, or ask once more?

## Round 5 additions (branch night/a2-r5)

Numbers for runs A to E are unchanged (A 13 taps and 6 typed fields, D 10 taps, E 14 taps and 3 typed fields); round 5 adds paths beside them, not steps in them.

1. **Try the demo.** In a real kitchen the first-run board offers "Try the demo" (the old "Busy-night demo" wording is gone from the places I own). It asks once in plain words, saves the real kitchen, and opens the demo in this tab (`SB.store.enterDemo`). In the demo every screen, including the back office, has a slim bar across the top: "You are trying the demo. Nothing here is your kitchen." with a "Back to my kitchen" button that is never hidden (`leaveDemo` erases the demo and returns). The Menu entry and the Demo sheet read "Try the demo" in a real kitchen and no longer offer Restart/Load there (so the old "could not be restarted" message cannot appear); the crew and clock controls live only inside the demo. Checked in `test/demo-mode.e2e.mjs` (10 checks): a normal tab has no bar, a ?demo tab has it, the bar stays in the back office, the owner's dish is intact after leaving, and no `smokebox.demo.` keys are left.
2. **Import a menu** (optional, secondary): a quiet link "Have a menu file? Import it" inside "More ways to add dishes" opens a sheet. Choose a file or paste text, "Check it", and a preview shows the detected format in plain words, one row per dish with a tick, a name box, a price box and a station list, and a plain problem line under any row with a problem (a row with no price stays unticked until a price is typed; a name taken by a removed dish says so). "Import N dishes" adds the ticked rows through A5's importer actions (imported prep times are stored as guesses); "Remove these N" takes the whole batch off the menu again (they are archived, as Remove does). "Export my menu" downloads a CSV. Checked in `test/menu-import-ui.e2e.mjs` (11 checks) with A5's generic.csv fixture. Only the generic CSV and pasted lines were driven in the browser; Square, Toast and Clover files were not tried in the screen (A5's unit tests cover the parser).
3. **Reorder** is not built: the engine still has no action that moves a menu item (checked `20-engine.js`; nothing named like moveMenuItem). The up/down controls need that action first.
4. **Set up this tablet** has a small "Help: setting up · no sound" line using the guide links when the guide is in the build, and the checklist's "discard log" line now says to save a backup every day (and the thrown-out log if the owner cooks ahead).

Screenshots looked at: `r5-import-phone-390`, `r5-import-night`, `r5-demo-bar-phone-390`, plus the demo bar and import preview at 1280.

Not checked in round 5: real Square, Toast or Clover exports through the screen; files over 1 MB; the demo bar with Large text; the browser Back button inside a demo tab; two tabs (one demo, one real) open at once; importing into a menu that already has about 150 dishes.
Questions for Freddy: (a) Is a one-question confirm before the demo right, or should the button just open it? (b) Should the demo bar be allowed to say more (for example "your own kitchen is safe")? (c) Do you want imported dishes ticked by default, or all unticked until the owner reviews?

## Round 6 additions (branch night/a2-r6), final numbers

Journey runs after all changes (modeled time, headless Chromium; not a person or a real tablet):

| Run | Taps | Typed fields | List choices | Modeled time | Dead ends |
|---|---|---|---|---|---|
| A: fresh install to first paid ticket, three dishes | 13 (target about 17) | 6 (target 6) | 0 | about 1.4 min | 0 |
| D: same with one station | 10 | 6 | 0 | about 1.3 min | 0 |
| E: one cooked-ahead dish, Brisket linked, first batch logged, paid | 14 | 3 | 0 | about 0.9 min | 0 |
| Three dishes alone | 6 taps | 6 | 0 | about 54 s (target under 2 min) | 0 |
| Back next day: board to Dishes and prices | 2 taps (Menu, Dishes and prices) | | | | |

What changed in round 6:
1. **Reorder.** Each dish row has Up and Down buttons (44 px, switched off at the ends) using the engine's `moveMenuItem`. A move offers "Moved X up. Undo". The order screen reads the menu list in order within each category (`71-floor-order.js` builds tiles from `menu.filter` per category), so a move shows there with no change to that file; moving a dish never moves it into another category's group. I did not add drag: it is not simple to do keyboard-accessibly on a tablet sheet.
2. **Touch audit** (`ux-scripts/touch-audit.mjs`): 10 screens x 3 sizes (390x844, 768x1024, 1024x768) x Day, Night and Large text = 90 screens, shots in `docs/ux-shots/night/a2/audit/`. Found and fixed: small round "?" help links (28 px; now have a 44 px tap area), 24 px checkboxes in the cooked-ahead and import lists (now 44 px rows), a sideways scroll in the import sheet at 390 wide with Large text, and the file chooser button. Left: two strips on the first-run board (the "Tap here to turn on warning sounds" bar is 34 px tall and its clear button 44x34); they are the board's, not setup's, so I did not change them (A1). Forms: name box has `autocapitalize=words`, Enter or Next moves to price, price is `inputmode=decimal` with `enterkeyhint=done`, which saves; every box scrolls itself to the middle when focused so a tablet keyboard does not cover it. Not tried with a real on-screen keyboard.
3. **One way to show messages.** Every message in my screens goes through one helper and style (green for done, red and bold for a problem; problems are announced as alerts). Common refusals now say what happened and what to do next in one line: price out of range, name too long, name taken (and, in Dishes and prices, a one-tap "Bring it back" when a removed dish has the name), menu full (150 dishes), too many cooked-ahead items, cook-ahead switched off. Destructive actions are all undoable: Remove, a move and Stop counting show an Undo bar; Not used has "Use again"; an import has "Remove these N".
4. **Second run** (`ux-scripts/setup-second-run.mjs`, 12 checks pass): a new tab after a half-typed dish shows the board (not setup), keeps the saved dishes and shows the first-steps card until a first ticket; Dishes and prices is two taps away and the half-typed name and price come back; after the first paid ticket the card is gone; the next day the board shows with no card and all dishes; after a restore from a backup into a clean browser the dishes are back, no first-run screen and no card; after leaving the demo the real kitchen is back and the board shows.

Tests: setup-wizard.e2e.mjs (reorder, undo, Stop counting undo, refusal line added), demo-mode.e2e.mjs, menu-import-ui.e2e.mjs all pass singly. Unit suite 585 pass; one run showed 1 failure that passed on re-run (same intermittent timing test A5 mentioned).

Not checked in round 6: a real tablet or phone (on-screen keyboard, thumb reach); drag reorder (not built); the board's own touch sizes (A1); the guide pages themselves; moving a dish between categories (the category follows the station tile unless set under More options; there is no move across groups); restore from a backup made on a different device with renamed stations (names are per browser).
Questions for Freddy: (a) Is "up and down one place" enough, or do you want to drag dishes? (b) Should the order screen sort dishes in a category by this order (as it does now) or alphabetically? (c) The sound-warning strip on the board is shorter than a finger; do you want it taller or removed from first run?

## Round 7: first-time owner simulation (branch night/a2-r7)

Three made-up owners drove the real UI from a blank install to a first paid ticket (`ux-scripts/first-time-owners.mjs`; logs and shots in `docs/ux-shots/night/a2/sim/`). They are scripts playing people, so "hesitation" below means a moment where the screen said something unclear, said nothing, or did something the owner would not expect, found by reading what each slip produced. No real person did any of this.

### Owner 1: food truck, 5 dishes (really 7 with slips), never sets up tax
Slips tried: blank name, "12,50", "$7", "6.", "abc", "1500", a repeated name, a 70-letter name, closing the sheet half done, browser Back with the sheet open, reload in the middle.
- Blank name, no station, "abc" and "1500" each gave one plain line that says what to do. Good.
- "12,50", "$7" and "6." were all read correctly and saved as $12.50, $7.00 and $6.00. **Fixed:** the price box now says "Reads as $12.50" as you type, so the reading is seen before saving.
- A 70-letter name is cut to 60 letters by the box without a word. Left: harmless, but silent (proposal: a "60 letters" hint under the name box).
- Browser Back with a sheet open closes the sheet and the app stays; closing the sheet half done and reloading both bring back the half-typed name and price.
- **Hesitation: tax.** The truck never sets tax. The bill said "Paid $21.50" with no hint that no tax was added. The first-steps card mentions tax only until the first ticket. **Fixed:** the main Menu now lists "Tax, hours and PIN" (Menu, then Tax, hours and PIN), and the tax text says dish prices are before tax. **For A1:** in the order screen's payment note (`71-floor-order.js`, the `paintNote` / `ord-pay-note` text, line 825), when the tax rate is 0 add "No sales tax is added. Set it under Menu, Tax, hours and PIN." so a taxed truck notices on the first bill.
- **For A1:** the order screen's category tabs list all five barbecue categories (Meats, Sandwiches, Hot sides, Fried, Cold and drinks) even when empty; tabs for categories with no dish could be hidden.

### Owner 2: cafe, cooks nothing ahead, 25 dishes from a spreadsheet CSV
File had a blank name, a repeated "Latte", a blank price, prices "$4.50", "4.75", "3", and one unquoted "4,50".
- The preview named the format in plain words and counted "22 of 25 dishes are ready; 3 need a fix". Blank name, duplicate and no-price rows were flagged with a fix line. Good.
- **Hesitation 1:** every one of the 22 rows carried the same line "category 'Coffee' is not one of yours", and all 22 dishes would have landed in "Meats" at station "Pit" (barbecue words for a cafe). **Fixed:** one note names the categories the file uses, with an "Add these categories" button that adds them and re-reads the file so each dish lands in its own; the per-row repeat is gone; and one list "Put all these dishes at:" sets the station for every row at once.
- **Hesitation 2 (found by the simulation):** the unquoted "4,50" split into price 4 and category "50", so Cappuccino would have been imported at $4.00 in a category called "50" with no warning. **Fixed here:** a category that is only digits now shows a warning ("looks like the end of a price split at a comma"), the row is left unticked, and "50" is not offered as a category. **For A5:** the importer itself should flag a row with more fields than the header and a numeric last field (`13-menu-import.js`).
- Left: the order screen still shows the five barbecue categories next to the cafe's new ones. A "Change categories" fold like "Change stations" would fix it; proposed, not built.

### Owner 3: rural diner, cooks pots ahead
Seven dishes, then Pot roast as a cooked-ahead item. Slips: hours "4 hrs", hours "13", batch "6 kg", saving with no dish selected, reload in the middle.
- "4 hrs", "13" and "6 kg" each got a one-line fix message. Good.
- **Hesitation:** saving with no dish selected said "Added Pot roast" and nothing was linked, so the dish never counted down (after a reload the dish had 0 recipe lines). **Fixed:** the first save with no dish selected now stops with "No dish is selected, so nothing will use this item and it will not count down. Select a dish above, or tap Save again to keep it without one."
- The cabinet form opened with Pot roast chosen and a first-reading hint, but its starting weight was half the "usual batch size" typed in the sheet (3 kg for 6). **For A1:** `buildBatchForm` (`72-floor-sheets.js` line 1049, `defaultKg`) uses half the par; the cooked-ahead sheet stores the typed batch size as par. Either use the par as is, or tell me where to store a separate usual batch size.
- Left: the half-typed Cooked-ahead sheet is not kept if the tab closes (the Dishes form is).

### Other changes this round
- Prices are read generously (`12.50`, `12,50`, `$14`, `14.`, `USD 12`, `1 200`) through the importer's reader, and shown back before saving.
- Dish rows have a category picker ("Move to") next to the up and down buttons.
- A4's wording rows landed (demo text; "clear" instead of "untick").

### Currency symbol (proposal only)
Prices show "$" everywhere (`U.fmtMoney`). A currency setting would need one setting (symbol and where it goes) read by that function, plus the CSV import/export; 00-util.js is not mine, so I did not build it. Proposal: `settings.ui.currency = { symbol, after }` default `$`, shown under "Tax, hours and PIN" as "Your currency symbol".

### Steps list for the Guide (A4)
1. Open Smokebox. The board says "Welcome. Let's build your menu." Tap "Add your first dish".
2. Type the dish name, press Enter or Next, type the price (12.50, 12,50 and $12.50 all work; Smokebox shows how it read it), tap where it is made, tap "Save and add another". The last station stays chosen.
3. More ways: "Have a menu file? Import it" (inside "More ways to add dishes"): choose a file or paste, check the preview, add the categories from the file if offered, pick one station for all, import. "Remove these N" undoes an import.
4. Change names: "Change stations" renames or marks a station "Not used" (its tab leaves the board when it has no tickets). Rename or reorder dishes in "Your dishes": up and down, Category picker, Remove (with Undo).
5. Tax: Menu, then "Tax, hours and PIN". Dish prices are before tax.
6. Cook food ahead? Say "Yes, I cook ahead" under the dishes (or in Tax, hours and PIN), add the item, select the dishes that use it, then "Log a first batch".
7. First ticket: New ticket, tap dishes, choose Cash or Card, Send to kitchen.
8. Coming back: the board is the first screen. Menu, then "Dishes and prices" is two taps.
9. Demo: "Try the demo" opens a separate demo kitchen; "Back to my kitchen" returns and erases the demo.

## Round 8 (final): merged-build re-check (branch night/a2-r8)

On the merged build (e7e9c93): the three browser tests, the second-run script (12 checks), the first-time-owners script and the touch audit (90 screens) all pass or run clean. One new check was added: a spreadsheet row with a price split at its comma ("Cappuccino,4,50,Coffee") arrives **unticked** in the real preview with the importer's "more columns than the header ... price may be 4.50, not 4" line, and a normal row beside it stays ticked. The diner script needed one change (a second Save after the "no dish selected" warning), which is the intended behavior since round 7. Final scripted numbers are in `docs/setup-timing.md`; the checklist for timing it with a stopwatch is there too, and the ten-step first look is `docs/try-this-first.md`.

## Round 11: not just barbecue (branch night/a2-r11)

Four first-time owners of other kitchens drove the real UI from a blank install to a first paid ticket with messy input (`ux-scripts/other-kitchens.mjs`; logs, results and screenshots in `docs/ux-shots/night/a2/other/`). After every screen the script scans what is on screen for barbecue words the owner never typed (Meats, Pit, smoker, brisket, ribs, slaw, Hot sides, ...). **PASS** = reached a paid ticket, no page errors, no barbecue words on any scanned screen. Scripted, headless Chromium, 1024x768; not real people.

| Kitchen | What the script did | Result |
|---|---|---|
| Pizza shop | one station renamed Oven, three others marked Not used, section renamed Pizzas, 12 dishes with sizes as separate dishes and prices "$11", "14.5", "15,50", "5." | PASS |
| Bakery-cafe | 30 items imported from a CSV with a header row and a Notes column (commas inside quotes), one section and one station for all | PASS |
| Taco truck | one station renamed Grill, section Tacos, 8 dishes with "3.5" and "$4"; a 3-taco cash order from the board took 6 taps | PASS |
| Bar with food | 10 food dishes, no drinks added, station renamed, section Bar food | PASS |

### Hesitation log (found by reading what each run showed)
1. **Every dish landed under "Meats".** The pizzas, pastries and tacos all sat under the heading "Meats" on the order screen, because the section came from the station's barbecue guess. **Fixed:** the add form now shows a "Menu section" pick list (starts from the station's guess, remembers the owner's last hand pick, so a pizza shop picks "Pizzas" once) and a "Change menu sections" fold (rename, Not used, add; same style as "Change stations"; names are saved through the shared owner-names mechanism, so the order screen follows at once). The import preview has a matching "Put all these dishes in" list for files with no category column (the bakery).
2. **Starter names were barbecue** (stations Pit, Hot sides, Fry; sections Meats, Sandwiches, Fried). **Fixed by A5** (`applyStarterNames`, a new empty kitchen starts with Kitchen, Prep, Fryer, Cold and drinks, Expo and Mains, Sides, Snacks, Desserts, Drinks). I changed my own station hints ("Grill, oven or main line", "Prep and sides") and made the section guess work from the section's name as well as its id, so a Fryer dish still lands in Snacks.
3. **A bakery that never renames stations saw tabs for stations nothing is made at.** **Fixed:** once a menu has dishes, a station tab no dish is made at waits (and returns when a dish is added there or a ticket arrives).
4. **After renaming a station the board still showed the old name** until a reload. Left as it is (the screen says "Reload to show on the board" with a button); the scripts tap it. Proposal: apply station renames to the board live (a board change, A1).
5. **Cooked-ahead question card used "chili ... potato salad"** as examples. **Fixed:** neutral "Soup in a warmer, salads in a cooler."
6. **Left, for others:**
   - A1, order screen customer chips: Walk-up, Pickup, Table 1 to Table 6 are a sit-down default. A pizza shop wants "Phone", "Delivery", a taco truck wants none of the tables. The channel names (Dine-in, Takeout, Drive-thru, Delivery app) are renamable in the Data page but there is no "Phone". Proposal: chips follow the channels, tables hidden unless the owner turns them on.
   - A1, a bakery or taco truck with a counter hand-off still gets kitchen tickets (START/DONE, "Bump", an EXP tab). A "counter mode" with no kitchen ticket is a product decision (not built).
   - A5, import: the Notes column of the bakery file is ignored (not stored on the dish); fine, but the preview does not say so. One line "Notes column ignored" would help.
   - A5, 00-util.js and 30-store.js: the two new keys `setup.hiddenCategories` and `setup.lastCategory` need to be classified as kitchen data and added to the Start over list (asked; until done one unit test, "every smokebox.v1 key ... is classified", fails on this branch).

### Defaults chosen (all easy to change)
- The Menu section list is always in the add form (not under More options) so a non-barbecue owner sees it at the moment it matters; its starting value is the station's guess, then the owner's last hand pick.
- "Not used" sections only leave the pick list; dishes already in them keep them.
- A station no dish is made at keeps its tab hidden only while the menu has dishes and no ticket needs it.

### Not checked in round 11
Real people; a food truck's real one-handed speed; the Data page rename of channels (A3); Toast, Square or Clover exports for these kinds of menus; a menu with sizes entered as modifiers instead of separate dishes (not supported by the form).

## Round 12: How you serve, required cook-ahead answer, PIN recovery code (branch night/a2-r12)

Built on A5's settings (`night/a5-r12`) and Freddy's decisions. All checks scripted, headless Chromium; no real tablet.

1. **Settings, How you serve** (a sheet, `test/serve.e2e.mjs`, 15 checks): Counter service on/off ("You hand food over at the counter and do not need kitchen tickets. Leave it off if cooks work from tickets."); Order buttons (rename, move up and down, add, remove, reset to the starting list, up to 12, repeats refused in plain words, an empty name refused); Currency symbol ($, euro, pound or your own, validated by the store's own rule). Every change saves at once, shows in the one message style, and offers Undo (the order buttons use the engine's undoable `setChips`). Touch audit: 135 screens (3 sizes x Day, Night, Large text) with no small, clipped or sideways-scrolling items, including this sheet and the new question card.
2. **Optional first-run question "How do you serve?"** under the dishes: Table and kitchen tickets (the starting state), Counter service (counter on, buttons Walk-up, Pickup, Phone, Delivery) and Food truck / one person (buttons Walk-up, Pickup). Skippable and remembered. **Journey numbers did not get worse** for people who skip it: A 13 taps / 6 typed, D 10, E 14 (answering costs one tap). Defaults I chose: truck leaves counter service off (a one-person kitchen still wants tickets to see what is queued); counter service switches the tables off by replacing the button list.
3. **Cook-ahead question is now required**: "Do you cook food ahead?" with Yes, I cook ahead / No / Not sure (Not sure counts as No and says: "Turning it on adds the Cabinet, batch timers and their warnings. Turn it on any time under Settings, Tax, hours and PIN."). No skip button and no permanent board reminder.
4. **PIN recovery code** (`test/pin-recovery-ui.e2e.mjs`, 8 checks): setting a PIN opens "Write down your recovery code" with Copy, Print, a checkbox "I saved it" and a Done button that stays off until the box is selected; the code is not in the saved state. A "Make a recovery code" button covers a PIN set before codes existed. On the keypad, "Forgot the PIN?" now takes the code and a new PIN (or empty to remove it) and shows the store's plain refusals (wrong code with tries left, locked for 15 minutes, no code saved).
5. **Import preview** names columns the parser ignored ("Ignored column: Calories") and says notes and descriptions are not kept.
6. **Wording**: "Menu" as the name of the button that opens the Settings sheet is now "Settings" in my screens (A1 changes the board button); "category" is "section"; demo and sample wording (A3 has the office lines). Guide quotes that changed are listed for A4.

Left or not checked: real tablets; printing the recovery code on a real printer (only that the call is made); the board button label (A1); two new setup keys (`setup.serveSkipped`, `setup.serveAnswer`) wait for A5 to classify them, so until then the unit test "every smokebox.v1 key is classified" and A4's Guide-label test fail on this branch; counter service was exercised only as a setting (A5's engine and A1's board own the effect on tickets).

## Round 14: cold items in the cooked-ahead form (branch night/a2-r14)

Built on A5's cold-item fields (`night/a5-r14`: `fridge`, `fridgeDays` 1 to 30 whole days, `outHours` 0.25 to 24; no defaults; null clears one).

- **The form:** Hot or cold already existed. **Hot is unchanged** (the "How long may it stay, in hours?" box). **Cold** hides that box and shows two optional boxes: "How many days may it stay in the fridge?" and "How many hours may it be out of the fridge?", with the one line "Use the limits your local health department gives you. Leave a box empty for no limit set: Smokebox will then only show the time." No numbers are suggested and no rule is claimed. A cold item is saved as kept in a fridge (`fridge: true`) so the limits can be set and it can be taken out and put back.
- **Refusals in the one message style:** days must be a whole number from 1 to 30; hours from 0.25 to 24; blank is fine.
- **Editing later in the same place:** the cooked-ahead list in Dishes and prices shows each item's limits ("Cold, 3 days in the fridge, 2 h out" or "Cold, no limit set") with an **Edit** button that opens the same boxes, filled in, with hot or cold fixed. Clearing a box saves "no limit set". Existing batches keep the limits they were made with (A5).
- **Tests:** new `test/cold-items.e2e.mjs` (12 checks, all pass): box visibility for hot and cold, the note and no suggested numbers, plain refusals, a saved item with both limits, blank limits, the list text, edit, change and clear. setup-wizard, demo-mode, menu-import-ui, serve, start-over, pin-recovery-ui and other-kitchens (4 of 4) pass. Unit suite 722 pass, 0 fail on a clean run (an earlier run overlapped with browser jobs and failed four performance timings).
- **Touch audit:** 153 screens (3 sizes x Day, Night, Large text), including the cold form, the cold edit form and the "Read as" import preview: no small, clipped or sideways-scrolling items.
- **Re-runs not done in round 13:** first-time-owners (0 page errors for all three owners) and second-run (12 of 12 checks).

Not checked: a real tablet; showing the "made on" date or the limits anywhere other than the form and list (batch screens are A1's); what a health department's limits look like in practice (no numbers were chosen).

## Round 15: final checks (branch night/a2-r15)

- **Real flows added to the tests.** `test/serve.e2e.mjs` now runs counter service end to end (counter on, an order paid in cash, the ticket is finished at once and no slip is left on the board; counter off, the same order leaves a ticket). `test/setup-wizard.e2e.mjs` now runs a cold item end to end with the cabinet card: create "Chicken salad" with 3 days and 2 hours out, make a batch (it copies the limits and a made-on date), see the fridge date and the 2 h limit on the card, Take out (initials asked once), Put back, then Undo. The wizard test has 60 checks.
- **Sweep of every screen I own** at 390x844, 768x1024, 1024x768 and 1920x1080 in Day, Night and Large text (216 screens, plus the bottom of each long sheet at the smallest and widest sizes; shots in `docs/ux-shots/night/a2/audit/`). The audit found nothing small, clipped or scrolling sideways. Reading the pictures by eye, I found and fixed:
  1. The dish name box example was "Brisket plate" and the cooked-ahead example was "Brisket": barbecue words in a neutral kitchen. Now "House salad" and "Soup".
  2. The Fryer station tile said "Fryer" twice (title and hint). Now "Fried foods".
  3. The example menu (hidden fold) was barbecue dishes with made-up prices. Now Chicken plate, Club sandwich, Mac and cheese, Green beans, French fries, Onion rings, Coleslaw, Iced tea.
  4. The "Set up this tablet" help line showed two bare round "?" icons side by side. Each now has words ("setting up", "no sound").
  5. The Try the demo sheet repeated "Try the demo" as its title and again as a heading. The heading is gone.
  6. At 1920 wide the Dishes sheet was narrow and the Remove button wrapped to a second line. The sheet is wider (880 px).
  7. The "Full menu editor (ingredients, prep times)" button wrapped with its icon off to one side. Shortened to "Full menu editor".
- **Seen but not mine:** the "Tap here to turn on warning sounds" bar is the biggest thing on the first-run phone screen (A1's board); the "Sanitize not logged" button appears as soon as cooking ahead is on (A1's board).
- **Final journey numbers (re-run):** A 13 taps / 6 typed fields / about 1.4 min; D (one station) 10 taps; E (cook-ahead) 14 taps / 3 typed fields / about 0.9 min. See `docs/setup-timing.md`. `docs/try-this-first.md` now has steps 11 to 16 for How you serve, counter service, cold items, the PIN recovery code, Start over and the import cents choice.

## Round 16: Get this tablet ready and the pilot visit card

- New sheet "Get this tablet ready" (Settings, and the top of Set up this tablet). Five cards, each with a green tick ("Ready") or an amber "Do this" line: screen stays awake, sound is on, volume is loud enough, added to the home screen, full screen.
- The browser can only report some things. Screen awake (browser hold), installed and full screen are read from the page. Sound and volume cannot be read, so the sheet plays a real beep ("Test the sound") and asks "Did you hear it?". A Yes ticks both. The summary line says a tick is not a promise it stays that way all day.
- Nothing new is stored: the answers live only while the sheet is open, so no new storage keys. The sheet holds its own screen hold only while open and lets go on close.
- "Pilot visit checklist" sheet (Settings): seven steps with minutes, total 14, tick boxes and a Print this card button. Same content as `docs/pilot-visit-checklist.md`.
- Journey run F (modeled): 6 taps, 2 screens read, about 0.3 min for the app side. The rest of the 14 minutes is talking with the owner and the menu import, not modeled.
- Not checked: any real tablet, real speaker, iPad Safari behavior of the wake lock, or an actual visit. The 14 minutes is a plan.


## First-month owner journey (test/owner-journey.e2e.mjs)

One scripted run of the real UI in Chromium on a blank install, with a simulated clock (the page's Date moved by an offset; timers real). 185 checks, run twice, all green; about 5 minutes. Every phase is checked against the engine (checkInvariants) and an independent ledger the script keeps in cents from its own price table (8% tax, discounts and tips as typed). Taps are counted by the script (one per click; typed fields counted apart; "store" means a store call instead of a screen, and there were none). Headless Chromium on a mouse, not a person: no thinking time, no mis-taps.

| Phase | Taps | Typed fields |
|---|---|---|
| day 0: first run, dishes | 7 | 6 |
| day 0: import a menu, change a price | 10 | 1 |
| day 0: how you serve, cook-ahead, tablet checks, PIN | 36 | 12 |
| day 1: first service | 49 | 4 |
| day 2: discount | 53 | 5 |
| day 3: void, thrown-out batch | 44 | 3 |
| day 4: reopen, refused reopen | 36 | 4 |
| day 5: service, backup | 51 | 5 |
| day 6: service | 54 | 6 |
| day 7: service | 55 | 6 |
| day 8: restore from the day-5 backup, undo | 21 | 0 |
| day 8: service | 49 | 5 |
| day 9: service | 50 | 5 |
| day 10: service | 49 | 5 |
| day 44: service | 48 | 5 |
| day 45: service | 50 | 5 |
| day 46: Close the month | 21 | 1 |
| Start over: PIN, backup, blank first screen | 15 | 1 |
| Total | 698 | 79 |

What it covers: day 0 (three dishes typed, one CSV import, a price change, an order button, two cooked-ahead items, tablet checks, tax, a PIN with its recovery code); days 1-10 (orders, board taps, cash and card, a discount, a void of a ticket and then the empty order, a reopen on the same day and a refused reopen after the day closed, closing each evening with starting cash, a dish thrown out by hand and leftovers thrown out at close, a temperature reading, a cold batch taken out of the fridge and put back, the day-5 backup, the day-8 restore with Undo this restore); days 44-45 of service, then day 46 Close the month (PIN keypad, counts, five files, CLOSE, Undo offered), the seven office pages, and Start over (PIN, backup, ERASE) ending on the blank first screen.

What the journey found:
- The clock guard works as designed: a step under 36 hours is accepted; the script never needed the clock question.
- Close the month on day 46 moved out exactly the 28 orders of the ten service days (27 paid plus the voided one) and left days 44 and 45 matching the ledger to the cent, with the engine invariants holding after it.
- Office pages open without NaN, undefined or null after the month is closed; Sales and money for the last 7 days shows 6 orders and $106 of food, the same as the ledger for days 44-45.
- (A3) No office page says that history before 2026-11-13 was closed (`archivedBefore` is set and nothing reads it in this build); and there is no button for Close the month on the Data page here (A3's card is on night/a3-month). The script opens the sheet by its name.
- (A2, mine, left) The cooked-ahead form's boxes have accessible names that differ from their visible labels ("Hours it may be out of the fridge" against "How many hours may it be out of the fridge?", and the same for the days, hours and kilograms boxes): WCAG 2.5.3 Label in Name. axe does not flag it; speech-control users would say the visible words. Changing it means updating setup-wizard, cold-items, guide-walk and first-time-owners, so it was left.
- (script, not the app) A few cheap pitfalls worth knowing: the order screen and the pay box start on the way the last order was paid, so a tap is needed only when it differs (this is by design and saves taps); the cabinet "Who is this?" box appears once per tablet; Playwright's own fake clock froze the page's drawing between steps, so the script moves the page's Date directly.

Not checked: a real person, a real tablet or touch use, sound and voice, printing, the hub and follower screens, more than one tablet, a real clock over 46 days, taxes other than 8%, order edits and add-a-round, delivery and drive-thru channels.
