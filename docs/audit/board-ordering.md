# Kitchen board and ordering audit (round 1)

Method: the built `dist/smokebox.html` driven in headless Chromium (Playwright) at 1024x768, 1280x800, 1920x1080 and 2560x1440, then every screenshot read by eye. Screenshots are in `docs/ux-shots/night/a1/`. Everything here is simulated. Nobody used it on a real tablet, TV or in a real kitchen. The test machine clock was about 3 a.m., so "kitchen closed" and "Service is over" notes appear in most shots; that is the clock, not a bug.

States covered: first run (empty), demo loaded, on time, running late, overdue, allergy and rush tickets, 30 and 60 tickets, station tab (PIT), Cabinet tab, New ticket sheet (1280, 1024), `#/new` page, Orders sheet, one-tap payment, Far display (1280, 1920), Wall mode (1920, 2560, Day and Night), Night, Large text.

## P0 (broken or blocks work)

None found beyond P1-1, which was fixed.

## P1 (hurts daily use)

1. **FIXED. Sound-check and "sound paused" notices showed as empty bars with only an X.** First run and every board with sound on but not yet unlocked: a dark 20 px bar with no words (`first-run-1280.png` before, `first-run-1280.png` after). The wrapper was shown but the button inside it kept `hidden`. Cause: `src/js/70-floor-board.js:1411` and `:1418`. The cook never learned that warnings are silent until one tap. Fix: removed the stray `hidden`. Test: `test/strip-notices.e2e.mjs` (fails before, passes after).
2. **FIXED. Header chip said only "not logged".** Nobody knows what is not logged (`levels-t12min-1280.png`). The word "Sanitize" was hidden below 1670 px. Fix: `src/css/20-floor.css` (end of file) shows the word whenever the chip needs attention. Checked at 1280 and 1920; at 1024 the chip is moved into Menu as before.
3. **Too much chrome above the tickets.** Late state at 1280x800: backup banner 60 px, header 80, sound bar 30, pause note 30, two strip rows 100. Tickets start at y=315 of 800 (`levels-t12min-1280.png`), at 1024x768 about y=210 (`many30-1024.png`). Each can be cleared, but a first-time user sees all of it. When the kitchen is closed the "Sound paused" note and the "turn on warning sounds" bar say nearly the same thing. Cause: `70-floor-board.js:1500-1512`. Suggested fix: show one sound bar at a time (unlock first, pause note only after), and default the backup banner to the Menu dot at the board.
4. **New ticket: the customer name field is far down the right pane.** After 3 items it sits behind 12 quick-name chips and needs a scroll (`new-ticket-sheet-3items-1280.png`, `new-page-2items-1280.png`). At 1024 the chips alone fill the pane. Cause: chip row built in `71-floor-order.js` near `:345-373`. Suggested fix: one scrolling row of chips (or only 6), field above chips.
5. **All-overdue board is one wall of red** (13 tickets all "Overdue +30 min", `levels-t42min-1280.png`). Known from the handoff; ranking by age exists, but nothing tells the cook which to do first beyond sort order. Suggested: only the oldest two get the heavy border.
6. **Orders sheet "Pay $23.50 cash" pays with one tap** (`take-payment-1280.png`). Undo toast exists for 10 s, but the method defaults to cash even for card or delivery app orders. Cause: `73-floor-orders.js:241`. Suggested: remember the last method per channel, or label the button "Cash" and "Card" as two buttons.

## P2 (polish)

1. Zero badges: the Cabinet tab always shows a black "0" (and tabs show "0" on a quiet board). Hide zeros. `70-floor-board.js:1547,1560`.
2. Welcome card text is cut mid-sentence ("...begin a dish an...") with no way to read the rest: `20-floor.css:642` clamps to 2 lines in a 450 px column. Widen it or shorten the copy.
3. First run shows a red "86" badge with 17 on an empty kitchen. Accurate (nothing cooked yet) but alarming; the welcome card should say so.
4. Toasts still paint over the first tickets' Bump buttons for 4 s (`night-late`, `new-ticket-send-no-allergy-answer-1280.png`). Taps pass through them, so work is not blocked. The demo-start toast lasts longer and covers the first three tickets.
5. The "All day" strip clips its last chip at the right edge with no fade or arrow. `20-floor.css:505`.
6. At 60 tickets nothing says how many are below the fold (`many60-1920.png`: two rows visible of ten). The tab count is the only hint.
7. Countdown format switches between "25 min", "13 min" and "9:58" in the strip. Fine for experts, odd at first glance.
8. Night theme keeps bright paper slips on a dark board (`night-late-1280.png`). Readable, but glaring in a dark kitchen.
9. Cabinet cards: uneven button grids and repeated "Starter stock" labels (`cabinet-1280.png`). Belongs to the sheets owner.
10. Wall mode: the strip bars span all three panes and take about 330 px at 2560; the toast covers the open-orders list (`wall-2560.png`).
11. "Demo" tags on every ticket and order row when a demo runs (known).

## Looked fine

Ticket levels read clearly with icon plus words (Running late, Overdue +N min). Allergy banner on a ticket and the "Allergy, see note" chip on each item are strong. Rush stamp is clear. Far display at 1920 is genuinely readable. Large text and Night keep layout intact. No console errors in any state. Sending a ticket without answering the allergy question works; the sent ticket gets a clear "Make X, then tap DONE" line.

## Not checked

Real audio, real touch, Safari and iPad, phone widths, role views (`?role=`), the Recall, 86 and Help sheets, Take payment with tip and discount, the guided tour, Far display at 1024.

## Round 2 status

Screenshots: `docs/ux-shots/night/a1/r2-*.png`. Test: `test/board-round2.e2e.mjs` (19 checks, all pass) and `test/strip-notices.e2e.mjs`. Everything is simulated in headless Chromium.

Fixed:
- P1-3 chrome: the sound bar and the "Sound paused" note no longer show together (the sound bar wins), and a screen under 900 px tall shows one warning row (the rest are counted in "(N more warnings after this one)"). With the backup banner hidden the first ticket starts at or above y=200 at 1280x800 and 1024x768. The backup banner (shell file) still adds 60 px after closing time.
- Toasts: info clears after 5 s, warnings after 6 s, errors stay until cleared (`60-shell.js`, 2 lines). With no sheet open they sit under the header on the notice strip, not over ticket buttons; with a sheet open they stay bottom-left.
- P1-4 New ticket: the customer name box is above the quick names.
- Sold-out dish tap: says "Out of Brisket. Log a batch to sell Brisket, 1/2 lb again." (and a reason-specific line for hand-off, safety hold, quality limit).
- Empty menu: "No dishes yet" and an "Add your first dish" button that opens the setup wizard.
- P1-5 all-overdue board: worst ticket tagged "Do this first", next two "Next", the rest calm paper with a thin red edge and no pulsing.
- B2 tab labels stay on one line; B4 a hidden "Hold cabinet" heading in the Cabinet view; B3 loudness slider and Channel sync row are 44 px tall; `SB.floor._alerts` made once.
- Wording: no "safe"/"unsafe" claims in my files; Specs removed from the Menu sheet (still opens with `SB.sheets.open('specs')` and from Help while the demo is loaded); Pitcall mention removed; pretend, made-up, simulated and sample now say "practice" (the word "Demo" itself is kept for the button and tags, per the glossary option).

Still open: P1-6 one-tap pay default method; P2 items 1-3, 5-11 above; the "New tablet?" toast stays 15 s (`77-floor-setup.js:171`, A2); the Demo and tag names; welcome buttons at 38 px (A2).

## Round 3 status

Screenshots: `docs/ux-shots/night/a1/r3-*.png` (blank board with the module off, demo board, 1024 and 1280, Day and Night, Paid by menu, slim banner). Tests: `test/board-round3.e2e.mjs` (18 checks) and the updated `test/board-round2.e2e.mjs`. Simulated in headless Chromium only.

Fixed:
- **Cook-ahead parts hide when the module is off** (`70-floor-board.js` `cookOn`): Cabinet tab, Hold button, key H, Sanitize chip, batch and temperature rows in the notice strip, the Hold and Sanitize entries in the quick menu, the 86 board "Nothing is cooked yet" note, the stock food-safety note and the Thrown-out log entry. If any batch still holds food, everything stays. An open cabinet closes when the module switches off. Absent setting means on, so the barbecue demo is unchanged.
- **Guide** entry in the quick menu and the Menu sheet, only when `SB.guide.open` exists.
- **Wording:** Thrown-out log, "In range" for "Holding fine", smoker and pit wording made neutral ("Ready at", "Batch on its way", "second batch"), "(practice)" on the first-run demo link. The Demo restart confirm now says it erases the owner's dishes and the button reads "Erase my dishes and restart" when they have any; `Sim.restartDemo({ replaceOwn })` passes the confirmed choice through (3-line change in `45-sim.js`).
- **Backup banner** is a 40 px bar: one line, a small action, and an X (the old "Later" is now the X, with "Later" kept for screen readers). The save-failure banner has no X on purpose.
- **Polish:** zero badges are hidden; welcome buttons 44 px and the welcome text is no longer cut; the All-day strip fades at its right edge; wall mode shows one notice row and no sound-pause note.
- **One-tap pay:** a "Paid by Cash" switch beside Pay (menu: Cash, Card, Other). The Pay button names the method, the choice is remembered on the device (`smokebox.v1.paymethod`), the Tip or discount sheet also remembers it, and the 10 s undo is unchanged.

Left: P2 items 3, 6-11 of the first list; the "New tablet?" 15 s toast (A2); Help sheet text about the cabinet still shows when the module is off.

## Round 4 status

Screenshots: `docs/ux-shots/night/a1/r4-*.png` (blank with the module off and on, demo, 1024 and 1280, Day and Night, Large text, blank 86 board, blank New ticket page, thrown-out log, PIN fold, help links). Test: `test/board-round4.e2e.mjs`. Simulated in headless Chromium only.

Fixed:
- **Empty menu:** combos no longer appear unless every dish in them is on the menu; the blank New ticket page hides search and categories and shows "No dishes yet" with "Add your first dish" (which now opens the Dishes screen); the blank 86 board shows the same friendly block instead of two zero tabs, an empty Stock heading and Channel sync. Settings text no longer says "Hush puppies"; Stock and the sound line drop food and batch talk when cook-ahead is off.
- **"?" help links** (guarded on `SB.guide`): Orders and Take payment sheets, New ticket sheet and page, Hold cabinet sheet and page, the sound bar, and the PIN pad. Not done by me: Set up this tablet (A2's file).
- **Close the day** button in the Orders footer (shows only when `SB.office.openCloseDay` exists).
- **Staff initials:** asked once per tablet (and again after 2 idle hours) when logging a temperature, reheating, discarding or marking surfaces sanitized, only with cook-ahead on; "Skip" never blocks the action. The cabinet shows "Entries are saved as JM" with Switch person, the batch card says "checked by JM 2:40 pm", and the thrown-out log fills initials from the entry.
- **Fix an entry** in the thrown-out log uses `correctSafety`: the old entry stays, the fix is a new entry with initials and time, and the box says so in plain words.
- **PIN lock-out:** a "Forgot the PIN?" fold under the keypad (what the PIN protects, that it cannot be recovered, ask whoever set it, clear site data, restore a backup that brings its old PIN back). The lock message points to it. Options for Freddy: `docs/audit/pin-recovery-options.md`. No PIN logic changed.

Left: the tour toast on an empty menu (message sent to A4 with the new text); the "?" on Set up this tablet (A2); "Fix this entry" only covers thrown-out entries (not temperature or sanitize rows, which need a safety page owner); initials are not asked for start cooling or keep serving beyond the existing keep-serving box; P2 items 3 and 6 to 11 of the first list.

## Round 5 status

Screenshots: `docs/ux-shots/night/a1/r5-before-slips-*` and `r5-after-slips-*` (4, 8, 12 and 30 tickets at 1024, 1280 and 1920; Day, Night, Large text) and `r5-after-cabinet-*`. Test: `test/board-round5.e2e.mjs`. Simulated in headless Chromium (software rendering), not on a tablet or TV.

Fixed:
- **Ticket slips:** tickets in one grid row now share one height (Bump stays right under the dishes, so it is never pushed out of reach). Item rows are about 15 px shorter (start time and station tag share a line), helper lines (start times, next-step line) are quieter and smaller, dish names a little larger, and waiting dishes are dimmed by colour, not by thin text. Far display keeps the bigger helper lines.
- **Hold cabinet:** one compact card for every batch: name and status on one line, ring and the amount left, last reading, next reading and serve-by, one main button (Taste and keep, Reheat or Log temp) and a "..." for the rest (pull, remind me, cooling, discard, corrections). The card went from about 330 px to 227 px and three cards fit across at 1280, so six batches show on one screen instead of two. "Starter stock" is named once in the summary line, not on each card; yield and cost notes moved out of the cards.
- **Units on the floor:** cabinet cards, sheets, toasts, help text, the thrown-out log, the notice strip text and the temperature boxes follow Fahrenheit/Celsius and kg/lb. The temperature boxes show the chosen unit and still store Fahrenheit (70 C is saved as 158 F). Cost per kg lines read per lb when pounds are chosen. Weight inputs in the New batch and restock forms still take kilograms (same as A3's office pages).
- **Motion system:** one custom property, `--sb-motion` (in `00-tokens.css`; reduced motion sets it to 0), scales every duration. Print-in 240 ms, bump-out slides sideways and fades in 260 ms, time colours ease, and a changed ticket or dish gets one 800 ms highlight. The overdue pulse now runs 3 times and the "check it" row flash 6 times, then they hold still; nothing loops for ever.
- **P2:** the "Amount" header in the thrown-out log no longer breaks.

Performance (headless Chromium, software rendering, 4 s of a 120x clock with tickets changing state; frames per second are not a tablet figure):

| Tickets | Motion on: avg / p95 / worst frame | Motion off: avg / p95 / worst frame |
|---|---|---|
| 60 | 16.7 / 16.8 / 33.3 ms | 17.4 / 16.8 / 66.7 ms |
| 200 | 19.2 / 33.4 / 66.7 ms | 17.3 / 16.8 / 66.6 ms |

Left: weight inputs in kg; "check this reading" and sanitize rows are not fixable from the log yet; P2 items 3 and 6 to 11 of the first list; no before/after of far display at 1024.

## Round 6 status

Screenshots: `docs/ux-shots/night/a1/r6-*.png` (Far display and Wall mode at 1920, 2560 and 3840; blank, late and 60 tickets). Tests: `test/board-contrast.e2e.mjs` and the updated `test/board-round2.e2e.mjs`. Simulated in headless Chromium only.

Fixed:
- **A real Night bug (mine, from round 3):** late tickets after the first three had a transparent head, so at Night the ticket number, customer and timer were dark text on the dark board (contrast 1.1 to 2:1, unreadable) and the "Next" tag was dark on dark. Heads now use the paper colour and the tag uses the slip colours. The new contrast test would have caught it.
- **Contrast:** a pair checker over computed styles (4.5:1 small text, 3:1 large) found no other failure on the board, New ticket, Orders and the cabinet in Day, Night and Night with Large text. Focus rings are visible (outline at least 2 px). Keyboard: Tab reaches the controls, Enter opens New ticket and Orders, Escape closes them and focus returns to the board.
- **Far display and Wall mode:** a 4K screen (3000 px and wider) now draws the board at twice size; Far display also enlarges dish names (1.3 times), the strip batch name and explanation (1.25 times) and the sound note, and keeps one strip row below 1300 px of height; the demo and backup bar grow on 4K. No horizontal scroll at any size; wall panes (orders, glance) work with a blank kitchen, the demo and 60 tickets; the strip never covers tickets (it pushes them down). New numbers against the 10-foot test are in `docs/ux-test-report.md`: which batch passes on a 43 in TV or larger; the explanation line is barely legible; the next-action line fails on a 43 in TV and passes only barely on 55 in and 65 in 4K TVs; a 32 in 1440p monitor fails most lines.
- **Touch size:** the sound bar, the pause note and their clear buttons are at least 44 px high.
- **Wording (A4's round 5 rows):** "held back" instead of "locked for safety", "Select" instead of "Tick", "Start and Done", "your dishes", "pulled pork or chili", "Demo batch", "restaurants that cook food ahead", "Sample history", demo wording instead of practice.

Left: the Overdue badge is small at 10 feet (the red outline and the "Do this first" tag carry the message); the physical size of a 2560x1440 32 in monitor needs browser zoom; P2 items 3 and 6 to 11 of the first list.

## Round 7 status

Screenshots: `docs/ux-shots/night/a1/r7-*.png`. Tests: `test/board-contrast.e2e.mjs` (now also the 86, Recall, Menu, Help and discards sheets in Day, Night and Night with Large text, and focus rings by control type). `board-round3` and `board-round4` re-run and pass. Simulated in headless Chromium only.

Fixed:
- **Focus rings:** the dish row button had no ring at all, and controls on the dark sound bar (clear X, help "?") had a ring the same colour as the bar. Both now show a ring of at least 2 px with 3:1 contrast in Day and Night. The new sheets showed no contrast failures.
- **Overdue badge in Far display:** bigger and on its own line (see `docs/ux-test-report.md`).
- **Friday rush** (a blank kitchen, six dishes added, 40 tickets one every 250 ms, then Start, Bump with its "Bump anyway" confirm, tab switches, Orders with 40 orders, Pay, the 86 board, New ticket, and the cabinet tab after turning cooking ahead on): no overlap, no clipped text, no page errors. Time from tap to the next painted frame: new ticket 30 ms on average (worst 52), tap Start 16 ms, Bump 12 ms, tab switch 30 to 38 ms, Pay 36 ms, open the 86 board 46 ms, open New ticket 93 ms, open Orders with 40 orders 112 ms. The one thing found: in the cabinet view the 10-second "Paid ... Undo" toast sat on top of the In the cabinet and New batch tabs; it now sits below them.
- **Order sheet with 36 dishes and 12 categories at 768x1024:** no clipped tile names (a 40-character name wraps to five lines), the 12 category tabs wrap to two rows, search plus Enter adds the first match. Emoji, Arabic and Hebrew names draw correctly; right-to-left customer names now align right (`dir="auto"` on slip, tile, wall, Orders and Recall names).
- **From A2's first-time owner run:** tabs for categories with no dish are hidden (and all tabs when fewer than two categories have a dish); the payment note says "No sales tax is added. Set it under Menu, Tax, hours and PIN." when the tax rate is 0; the New batch weight starts at the usual batch size the owner typed.
- **Wording (A4):** research-report sentence removed from Help, "step 1 of 2" and "step 2 of 2" for cooling, "throw it out".

Left: a hint of how many tickets are below the fold (P2 6); countdown format switching between minutes and mm:ss (P2 7); bright slips at Night (P2 8); the Demo tag on every ticket (P2 11); wall names that are too long end in an ellipsis (no way to read the rest on a TV).

## Round 8 status (final)

Final screenshots with a "what to look for" list: `docs/ux-shots/final/README.md`. All board checks re-run on the merged build (e7e9c93 plus this branch): `board-round2` to `board-round5`, `board-contrast` (42 checks) and `strip-notices` pass.

Done this round:
- The "Demo" tag on tickets, Orders rows and Recall rows is hidden inside the demo (the demo bar already says it) and still shows beside real tickets.
- On the notice strip the count of more warnings now reads "+N more" beside the batch name, where a long explanation can no longer cut it off.

Known, not done:
- **A hint of how many tickets are below the fold.** The tab count is the only hint. Needs a small "N more below" pill tied to the scroll position; not small enough to do safely this late.
- **Countdown format.** The strip shows minutes ("25 min") until under 10 minutes, then mm:ss ("9:58"). It is consistent with itself, but the two forms look different at a glance. Left as the design.
- **Bright slips at Night.** Paper slips stay light on the dark board. Readable (contrast checked) but bright in a dark kitchen. A dim-paper Night mode would be a design change.
- "Show me how it works" shows twice when the setup card and the empty board are up together.
- Wall list names that are too long end in an ellipsis.
- A 32 in 2560x1440 monitor is too small for Far display from 10 feet (see `docs/ux-test-report.md`); the next-action line fails on a 43 in TV.
- Nothing here was tested on a real tablet, TV or in a real kitchen.

## Follow-up round (night/a1-r10): known bugs closed

- **1920 px header and the Demo clock chip (B5):** not reproducible on this build. I measured the header at 1704, 1760, 1800, 1920, 2000, 2199, 2200 and 2560 px with the Demo clock chip showing, with and without "Sanitize" needing attention: one row every time (the header drops the tab icons first when tight). Test: `board-round10`.
- **Small touch targets (qa 09a/b/c/e):** the controls still under 44 px were the round "?" help link (28 px) and the "Back to my kitchen" demo bar button (34 px), plus the "Cabinet" tab text sticking out by 3 px at 390 px with Large text. The "?" link is now a 44 px target with the same 28 px circle, the demo bar buttons are 44 px on screens up to 1024 px wide and on touch, and the phone tabs have tighter padding. The old exemption list in `test/e2e/09-viewports.mjs` is switched off, so nothing is excused any more.
- **Tour ringing a hidden element (qa 13e/13f):** the tour ring now skips elements with no box (the hidden "On time" badge). Edit in `74-floor-tour.js`, A4 told.
- **Duplicate "Show me how it works":** the empty board leaves out its walkthrough button while the setup card is up, and puts it back when the card goes.
- **"N more tickets below":** a small pill at the bottom right of the board, above the all-day strip. It reads the position of every ticket only on scroll and about once a second, appears only when something is out of sight, scrolls down 85 percent of a screen when tapped, and is hidden in wall mode and the cabinet.

## Round 11: other kitchens and rough use

Screenshots: `docs/ux-shots/night/a1/r11-*.png`. Test: `test/board-round11.e2e.mjs`. Simulated in headless Chromium.

**Note on the earlier follow-up (r10):** its commits were first made on `night/a1-r8` and not pushed under the r10 name (the remote `night/a1-r10` is only the base). They are carried onto this branch as one commit, so this branch has everything.

### One-station kitchen on one phone (390x844, the only screen)
Checked: a blank kitchen with five dishes all made at one station and the other stations marked "Not used".
- **Fixed:** the board showed three tabs (All, the one station, Expo) that all list the same tickets, and the header took two rows (155 px). With one station in use those tabs now hide (the Cabinet tab stays when cooking ahead is on), the header is one row (78 px) and the first ticket starts at y=163 instead of 219.
- **Fixed:** the "Ticket #101 sent to 1 station." message now says "sent." in a one-station kitchen.
- **Works:** tickets at 390 px (two dishes per ticket, Start and Bump at 44 px or more), New ticket with a Menu/Order switch and a "View order" button, the sound bar, the "more tickets below" pill, no sideways scroll. The only control under 44 px was the "?" help link, fixed in the follow-up round.
- **No cook-ahead kitchen:** Cabinet, Hold, Sanitize and batch rows are hidden (round 3), so nothing about batches shows.
- **Left:** "Send to kitchen" is the button name for a person who is the kitchen (a main button, Freddy's call); a phone shows the Order pane in a second view, so a one-person order is: pick dishes, tap View order, tap Send.

### Counter service with no kitchen (a bakery)
What happens today: add dishes at a "no cooking" station (Cold and drinks) as one-step dishes; New ticket, pick items, choose Cash (Pay now), Send. The order is created and paid in one step; a ticket also appears on the board ("Make Croissant and Coffee, then tap DONE") with a Done button per item and Bump. Nothing blocks work, but the kitchen step feels extra:
- The ticket stays on the board until someone taps Done on each item and Bump; Bump on an unfinished ticket asks "Bump anyway?".
- The channel defaults to Dine-in; the strip, timers and "late" colours still run for a ticket nobody will cook.
- The "next step" line can be turned off in Menu, Next step, and stations that are not used are hidden.
Larger needs (not done): a setting that finishes one-step dishes and bumps the ticket as soon as it is paid ("counter service"); a Walk-up channel without a kitchen time limit. Both need engine and settings work.

### Rough use ("drunk Friday")
Scripted in one browser: a double-tapped Send made one ticket and one order; triple-tapping a dish started it once; a double-tapped Bump and 12 presses of Z (undo) lost or duplicated nothing; Escape pressed three times over stacked sheets left none open; rotating 1024x768 to 768x1024 and back mid-order kept the order lines with no sideways scroll; going offline and online kept every ticket (the app is local); a clock moved back three hours left the board working (the app's clock never runs backwards); three tabs open at once ended with the same seven tickets each. No console errors.
- **Known, not fixed:** an order that is half built is lost when the page is reloaded (the draft lives in memory only). Saving it would be a store/settings change.

### Long text
A 40-character customer name and 24-character dish names (the menu limit) were put on the slip, strip, wall, Far display, Orders, Recall, payment and the 390 px order sheet: no element runs past the screen or is cut off, except the wall list, which cut names to about 13 letters. **Fixed:** wall list names wrap onto two lines. The strip row with a 40-character batch name wraps cleanly at 390, 1280 and 1920.

## Round 12: counter, pizza and truck kitchens

All checks ran in headless Chromium with a simulated clock. Nothing here was tried on a real device or in a real kitchen.

What changed:
- **Unfinished order comes back.** The order screen saves the half-built order after every change (dishes, quantities, mods, name, channel, note, rush, payment, tip, allergy) and restores it on the next open, with the note "Restored your unfinished order. Clear it to start fresh." It is cleared by Send, Clear and an empty order. Dishes that were removed or archived since are dropped quietly. Uses `SB.store.saveDraft` when the engine side provides it, otherwise browser storage under `smokebox.v1.orderdraft`.
- **Counter service.** When `settings.service.counter` is true the board shows one list of orders: station and EXP tabs are hidden, the next-step lines, START or DONE wording, late badges, late colors, tier tags and pulsing are off, and the strip leaves out late, start, ready and new-ticket rows. Bump never asks "Bump anyway?": it marks the dishes done first, so the office numbers do not count a forced bump. Slips stay readable (same type sizes as the normal board).
- **Order chips** follow `settings.service.chips` (trimmed, up to 12, 24 letters each). Absent means the default list. An empty list hides the chip row.
- **Renamed stations show at once.** `SB.floor.refreshNames()` re-applies the saved names and remounts the board on the same tab. The back office save calls it, and only falls back to the Reload button if it is missing.
- **Settings.** The board's Menu button is now Settings (label, aria-label and the quick list heading). Bump keeps its name.
- **Channel sync strip removed** from the 86 board, with its help line, styles and tests. Demo wording replaces "practice" in my files.

Choices made without asking: the counter flag is read defensively (missing means off); a station tab left open when counter turns on is switched to All; the draft is kept per browser, not per user; drafts are not saved in the demo any differently.

Not done or not checked: the shared currency formatter is not in this branch yet, so board, order and payment surfaces still use `U.fmtMoney`; no "Paid, done" screen beyond the existing one-tap pay (counter orders are paid when sent); the engine currently rejects the counter setting from the settings route, so the test switches it on inside the page. `src/js/85-office-stock.js` (A3) still has a "Channel sync (practice only)" section, and `tools/guide-walk.mjs` (A4) clicks a button named "Menu".

## Round 14: cold items in the cabinet, page order, narrow Hold sheet

Checked in headless Chromium with a simulated clock only. Nothing here was tried on a real device or in a real kitchen.

- **Cold item card.** A cold item kept in a fridge (engine `coldInfo`) shows "In the fridge since <date>, made <date>", a Take out or Put back main action (initials asked once, Undo toast), a ring that counts time out of the fridge, and one line in words: "1 h 20 min out of your 2 h limit", or "Out for 1 h 20 min, no limit set" when the hours are blank. A fridge date row reads "Use by Sun 10/25 (your 3 days)" or "No limit set". Next reading says "Not needed while it is out". Colors follow the status and the share of the limit used (normal, then amber from 75 percent, red when used up or the engine says bad). Wording says "your limit" and never states a rule. Hot cards are unchanged and the card does nothing when the engine has no cold-item model.
- **Page order of slips.** Overdue slips are now moved to the front in the page, most overdue first (before, only a CSS order moved them, so keyboard and screen reader users met them last). A focused control keeps its focus when a slip moves. This is the B3/B4 reorder item in e2e-triage.
- **Hold sheet at 280 px with Large text** no longer sticks out 9 px: name and status may wrap and the name breaks long words.
- **Not done:** call-outs for the cold feed rows use the engine's own phrases and I did not add any board wording for them; the strip shows them like other rows (checked only that nothing breaks).
- **Tests:** `test/board-round14.e2e.mjs`. `test/floor.e2e.mjs` expectations for slip order now put the overdue ticket first.

## Round 15: cold items on the strip and voice

Headless Chromium with a simulated clock only; nothing was tried on a real device or in a real kitchen.

- The strip shows the engine's `coldOut` row ("27m 59s left of your 1-hour limit out of the fridge. Put it back in the fridge, or use it. Your food-safety plan comes first.") and the `coldDate` row (last 6 hours of the last fridge day). Neither says "overdue" or "late"; the tab dots only talk about overdue tickets.
- The voice says a cold row once when it first shows or gets worse, for example "Chicken salad batch 1: 28 minutes left of your out-of-fridge limit." The first pass after the board opens only remembers what is already there, so a reload reads nothing old. It follows the same sound and speech switches and the same leader tab as the other warnings.
- When a Take out or Put back itself ends the batch, the cook sees the engine's words as a warning instead of the plain "taken out" message. This case could not be reproduced in a test.
- Tests: `test/board-round15.e2e.mjs` (feed row, strip words, spoken once, no overdue wording). All board suites passed on the merged build, including `floor` and `floor-sheets` (floor: 201 passed, 0 failed, 2 known reported).
- Not done: a cold row has no chime ladder of its own (the engine gives it zero rungs), so the sound is a single chime with the spoken line.

## Round 16: pull logging friction, keep-awake and sound, readings

Headless Chromium with a simulated clock and a stubbed wake lock only. Nothing here was tried on a real tablet, with real greasy hands, or in a real kitchen. The seconds are a model, not a stopwatch on a person: 1.5 s per tap plus 0.6 s per typed character.

### Taps from the board (script: `test/board-round16-taps.e2e.mjs`, same numbers on a 390 px phone and a 1024 px tablet)

| Flow | Before: taps, seconds | After: taps, seconds | What changed |
|---|---|---|---|
| Pull (Cabinet tab, then the pull) | 3, 4.5 | 2, 3.0 | Pull sits next to the main button on the card, no longer behind "...". It is 1 tap when the board is already on the Cabinet tab. |
| Log a temperature | 3, 4.5 | 3, 4.5 | Unchanged (Cabinet, Log temp, Save). |
| New batch, first product | 3, 4.5 | 3, 4.5 | Unchanged. |
| New batch, a different product | 4, 6.0 | 4, 6.0 | Unchanged. |
| New batch, same product as last time | 3, 4.5 | 3, 4.5 | The form now opens on the product used last (before it opened on the first product), with its weights filled in. The first temperature is still typed or confirmed on purpose: a one-tap batch with a made-up temperature would defeat the log. |
| Cold item: Take out / Put back | 2 and 1 | 2 and 1 | Unchanged (initials are asked once per tablet). |

No flow needs typing. Cabinet card buttons are now at least 52 px tall (was 44). Honest result: only the pull got faster; the others were already as short as the form allows. A "pull again" action exists in the engine (`pullAgain`), but pulls here already use one fixed amount per product, so it was not needed.

### Keep awake and sound
- The screen wake lock is asked for when the board shows, again at the first tap if the browser had refused, again when the page comes back to the front, and again when the system takes it back. It is let go when the board closes.
- Calm lines in the strip, dismissible, never blocking work: "Warnings are silent: sound is off on this tablet. Tap to turn on." (tapping turns sound on); "This screen may go to sleep, and warnings stop while it sleeps. Keep the tablet plugged in with its screen set to stay on." (no wake lock or refused); "The board was in the background for N minutes. Warnings are silent while it is hidden." (for 10 minutes after it returns). The existing bar that asks for one tap when the browser has not let the board play sound stays.
- A quiet "Checked 2:07 pm" stamp at the right end of the All day strip shows the last time the board checked its warnings.
- "Test the sound" in Settings plays a chime and a voice line and says in words whether the browser allowed it.
- Not checked: how long real tablets (iPad, Android) really stay awake, or whether Safari grants the wake lock at the first tap. The note that the page was hidden only appears after the page comes back, because a hidden page cannot show anything.

### Readings sheet
- New sheet "Readings" (Settings links, the sanitize chip menu and the narrow-screen menu), shown only when cook-ahead is on. Three small forms: fridge, freezer or display case (kind, optional name, temperature), food thermometer check (ice water, boiling water or other, starts at 32 or 212), sanitizer strip (ppm, optional product and place, also marks surfaces sanitized). Names used last time come back as one-tap chips. A list of the last six readings with Fix, which adds a note next to the entry (nothing is erased).
- Undo: the engine does not let the two temperature entries be undone (only the sanitize action can), so a wrong entry is fixed with a note instead. Not done: an Undo button on the sanitizer strip reading.
- Tests: `test/board-round16.e2e.mjs`.

## Round 19 (main track): speed with 60 and 200 tickets, and four notices at once

Headless Chromium on a shared machine, not a tablet. Script: `test/board-perf.e2e.mjs`. A demo kitchen with cook-ahead items, a cold fridge item and 60 or 200 open tickets. Each cell is the median of 7 taps (3 for the sheet), in milliseconds, from the tap to the next painted frame (two animation frames); the script time inside the tap is in brackets. A frame is about 16 ms, so 25 ms is "painted on the next frame".

| Screen, tickets | Start a dish | Bump | New ticket arrives | Switch station | Open Cabinet tab | Open Readings |
|---|---|---|---|---|---|---|
| 1280x800, 60 | 26 (1.5) | 39 (4.1) | 26 (0.3) | 140 (39) | 84 (12) | 26 (2.2) |
| 1280x800, 200 | 32 (4.7) | 56 (7.6) | 25 (0.4) | 204 (142) | 101 (24) | 31 (1.9) |
| 390x844, 60 | 24 (1.7) | 30 (2.8) | 23 (0.3) | 76 (59) | 90 (17) | 31 (2.8) |
| 390x844, 200 | 26 (3.9) | 36 (4.7) | 29 (0.3) | 176 (156) | 61 (18) | 35 (2.4) |

- The cooking taps (Start, Done, Bump) and a new ticket stay at one or two frames even with 200 tickets open (max 56 ms).
- The slowest thing is switching to a station tab that has many tickets: the board is rebuilt from scratch, about 0.7 ms per slip. Going to a tab with 200 slips takes 140 to 270 ms in the script (the worst single switch measured was 268 ms). It is not a cooking tap and 200 open tickets is far above a real rush, so I left it. A fix would keep the slips of the last tab in a pool, or draw only the first screens of slips and the rest when idle; both touch ticket order and focus, so not done tonight.
- No jank or overlap found in the new features (readings, counter service, cold items, tablet checks, pull beside the main button) in the existing layout suites; all board suites, `floor-sheets` (177) and `floor` (202) pass on this branch.

### Notices on the strip
- Warning rows (batches, tickets) always show, one or two by screen height.
- Everything else is one notice line at a time, in this order: the "tap for sound" bar, then the note (sound off, screen may sleep, the board was in the background, kitchen closed). The bar adds "(1 more notice)" when another waits, and its X is now "Clear all notices". After it is cleared the next notice does not come back until its words change.
- Checked at 1024 (Day, and Night with Large text) and 1920 (Night, Large text): `test/board-notices.e2e.mjs`. The strip stays under 30 percent of the screen height with a demo banner, the sound bar and two warning rows. At Night the notice line is a light bar on a dark board by design (inverted strip); it reads well but is the brightest thing on screen.
- Not checked: the update line (it lives on the offline track, not on main), a backup banner together with all of the above, and a real tablet.

### Round 19 fixes after A6's regression run (main track)
- **17 compact tickets at 390 px:** 12.5 screens before, 11.9 now (limit 12). A ticket went from 356 to 298 px tall: the name and the channel line share one row, the dish rows have 2 px less padding around the unchanged 44 px tap tile, the Bump row and the top of the ticket are slimmer, the next-step line is one line with an ellipsis, and the gap between tickets is 10 px. Phone width only; all tap targets are still 44 px or more.
- **Burst of 12 tickets rendering twice:** I could not reproduce it. One notification reaches the board per burst (checked 8 times, also with four busy processes on the machine), and `floor` now passes this check (202 passed, 0 failed). The second render in A6's log came with long tasks of 100 to 130 ms, so I read it as the one-second tick arriving in the 1.2 s wait (a time-driven change is a legitimate second render). Nothing was changed for it.
- **`.fl-checked` 9 px past the floor at 280 px:** the stamp now shrinks, and below 340 px wide it is not shown. `contract` passes (18 of 18).
- **Switching station tab with many tickets:** the first 36 slips are built at once and the rest 25 ms later. Script time for a switch with 200 tickets fell from 126 to 156 ms to 33 to 43 ms at 1280x800 and 390x844. The two-frame tap-to-paint number stays high at 1280 (110 to 228 ms) because the second chunk lands inside the measured window; the first screenful is on screen after the first frame. Not measured on a tablet.

## Round 20: the chef voice, text side

No audio was played or heard. These are the exact words and numbers the speech engine is given, checked by tests (`test/voice-text.test.mjs`, `test/callouts.test.mjs`, `test/voice-ui.e2e.mjs` with the speech engine stubbed).

- **What is spoken** (everything goes through `SB.deadlines.spoken`, which turns screen text into words): new ticket, start now (and reminder), ring it out (and reminder), the heads-up for a batch about to expire, past quality, expired, the cold-item low-time line, the sound test lines and the sample call in "Test the voice". **Not spoken:** the update line, the readings sheet, the silent-sound line, the screen-may-sleep line and the cabinet card lines (they are text and screen-reader announcements only).
- **Speakable text:** `4.50 kg` is "four and a half kilograms", `1:20` is "one minute twenty seconds", `2:41 pm` is "two forty-one P M", `1 h 20 min` is "one hour twenty minutes", `165 °F` is "one hundred sixty-five degrees Fahrenheit", `#12` is "ticket twelve", `x2` is "two of them", `+3 more` is "and three more", `Brisket 1/2` is "Brisket half", `$12.40` is "twelve dollars forty". The full table is the test.
- **Length and delivery:** a line is cut to about 14 words at a sentence end. A heads-up is calm (rate 1.0, volume 0.85), a new ticket brisk (1.1, 0.9), "fire now" fast and loud (1.2, full volume), its reminder faster (1.25), expired fastest (1.25).
- **Queue:** one line at a time with a pause of 0.7 s plus the time the words need; three or more waiting new tickets become one line ("Twelve new tickets. First up, ticket five."), even when the queue overflowed; a call for a ticket that was bumped or started before its turn is dropped; so is any call older than 45 seconds. Fire-now calls go before ring-it-out calls, then new-ticket calls.
- **Levels:** Light has no new-ticket call and no reminders, Normal one reminder, Full up to four for a dish and two for a finished ticket; an unknown level is Normal.
- **Voice choice:** English voices only; voices stored on the tablet beat network voices (a kitchen may be offline); premium, enhanced and Siri voices and known good names (Samantha, Daniel, Aaron, Nicky, Google US English, Microsoft David or Aria and the Android local voices) rank higher; novelty voices (Zarvox, Bad News and the like) are never chosen; none left means the device default. "Test the voice" in Settings speaks a sample call and names the voice and whether it is stored on the tablet or needs the internet.
- **Not checked:** how any of this sounds, through a real tablet speaker or any voice; which voices real iPads and Android tablets list; that "Siri" voices are available to web pages.

## Round 21: the board side of the review fixes

Headless Chromium with a stubbed clock and storage only (`test/board-review-fixes.e2e.mjs`). Nothing here was tried on a real tablet.

- **Held-data screen** (saved data unreadable and could not be set aside). Plain words, nothing covers it (z-index above the board and toasts), no sideways scroll, every button 48 px tall, at 390 and 1280 in Day, and Night with Large text (it now follows the tablet's Night and Large text, which it ignored before). Changed in `99-boot.js`: the way forward ("I have the file: continue and replace it") stays off until the old data has been downloaded or shown, and a third button "Show the data so I can copy it" is the way out when downloads are blocked, so there is no dead end and no stray tap replaces the data.
- **Load note** ("Smokebox could not read some saved records and left out 1 order, 2 tickets, 1 batch while opening..."): checked with a saved kitchen that has junk records. It is a warning toast, clearable, over the top right; the board works behind it. The wording is long but plain. Not changed.
- **Clock jump** (more than 36 hours ahead). The old prompt was a box over the whole screen, which blocks tickets. On the board it is now a calm strip notice: "This tablet's clock jumped ahead by about 3 days. Smokebox is still using the old time, so tickets and timers keep running." with "Keep the old time" (hides it for 10 minutes) and "Use the new time", which only asks a second question (Use the new time / Keep the old time) before it changes anything. It comes first on the strip, both buttons are 44 px or more, tickets can still be started and finished, timers do not jump. Tested with a 3-day jump of `Date.now`. Off the board (office pages) the old box still asks.
- **Reopening a paid order of a closed day:** the Orders drawer shows the engine's sentence ("That sale belongs to a day that is already closed, so it cannot be opened again: it would move to another day and count twice. Make the correction in your own records, or ask whoever keeps the books.") and the order stays paid. The Reopen button is still shown; a tap gets the reason.
- **Start over** (needs a saved backup and the PIN): unchanged on the board side; Settings still opens as before.
- **Not checked:** a real device with a really full browser store; the clock notice on the 390 px phone and at Night; the Orders drawer reason on the phone; what happens when the board is not showing (office pages) and the clock jumps.

## Slow tablet

Emulated, not a real tablet. `test/board-slow.e2e.mjs` runs Chromium with the CPU slowed 4x and 6x (CDP `Emulation.setCPUThrottlingRate`), an 800x1280 touch screen, voice on, a cabinet of 10 batches, 60 and then 200 open tickets and a saved history (the app keeps about 1,470 tickets of a 5,000-ticket history, 3.4 MB, because the browser's storage is about 5 MB). Numbers are the median milliseconds from tap to the next painted frame, from one run on a shared machine, so read them as sizes, not promises. The test only warns when a number is high; it fails only on page errors.

Before and after the fixes below (200 open tickets):

| Action | 4x before | 4x after | 6x before | 6x after |
| --- | --- | --- | --- | --- |
| Orders drawer open | 656 | 267 | 1751 | 422 |
| Station tab switch | 550 | 343 | 653 | 532 |
| Start / Bump / New ticket Send | 96 / 85 / 189 | 58 / 43 / 240 | 73 / 72 / 548 | 96 / 92 / 296 |
| Pay (quick pay) | 236 | 112 | 342 | 183 |
| Burst of 12 tickets | 173 | 71 | 158 | 117 |

At 60 open tickets after the fixes, 4x / 6x: Start 146 / 146, Done 199 / 182, Bump 121 / 132, Station tab 225 / 398, Orders drawer 126 / 239, Send 168 / 206, Pay 65 / 119, burst of 12 tickets 147 / 219. Boot to the first painted board with the saved history: 1.1 s unthrottled, 1.9 s at 4x, 3.2 s at 6x.

What was slow and what changed (my files, no change of behavior):
- Orders drawer built every open order's row in one go, then the sheet's focus forced a layout of the whole list (800 ms of a 1.3 s open at 6x). Rows now build 16, then 30 per frame, and rows below the visible part use `content-visibility: auto`.
- The per-second tick read the header position (a forced layout every second while the board had just been rewritten). The reading now waits for the next frame and shares its layout.
- "N more tickets below" read the position of every ticket on every change; it now halves the list (a few reads).
- A station switch built the first 36 tickets and then all the rest in one task. It now builds 18, then 30 at a time.

Still slow, and not mine:
- The saved copy is written whole and synchronously: `SB.store.flush()` took 41 ms at 1x and 135 to 463 ms at 6x with 1,470 tickets of history (JSON.stringify of 3.4 MB plus the storage write). A Done tap that finishes a ticket costs 165 to 246 ms of script at 6x, which looks like this save. Idea: keep history in a separate saved key that is written only when it changes, or save from an idle callback.
- Boot at 6x: JSON.parse of the saved state (`get` 128 to 177 ms), `validateBackup` (86 to 170 ms), `repairTicket` (30 to 68 ms), `checkInvariants` (26 ms at 4x). `importAll` of a 11.9 MB backup took 982 ms unthrottled. Profile hint: CDP `Profiler` with a 500 microsecond interval while booting, as the test does.
- The browser keeps only about 1,470 of 5,000 tickets of history; the rest is trimmed at save time.

Not checked: a real tablet, memory pressure, thermal throttling, a 5,000-ticket history held whole.
