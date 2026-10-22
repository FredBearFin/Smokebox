# Smokebox UX test report (kitchen use), 2026-10-18

Scope: how the kitchen board works for a cook, not whether the engine is correct. Everything below was measured or replayed in a real browser (Playwright, touch enabled) against the built app. Status as of 2026-10-18: the sections down to "Caveats" are the 2026-10-18 baseline, measured on the app as it stood before the Phase A work; code has changed since, and "Status of the original findings" below says what each finding became. Test scripts live in `ux-scripts/`.

## What was tested (2026-10-18 baseline)
1. First-run screen and a busy board at 1024x768, 1180x820, 1280x800 and 1920x1080.
2. Every button and key piece of text on the board: size in CSS pixels, converted to physical size and reading distance.
3. Real tap counts for the core jobs, by driving the actual buttons.
4. A replay of the hold-limit failure by fast-forwarding the app clock.
5. A distance simulation (shrink and blur a 1920x1080 and a 1280x800 board).
6. The "..." menu, the New batch form, the empty-kitchen screen, sound defaults, screen keep-awake.

## Findings, worst first (2026-10-18 baseline)

### Critical
1. **Batch expiry has no warning ladder, and the one existing signal cries wolf.**
   - Replay: ten starting batches (brisket, pork, ribs, sausage, turkey, mac, beans, slaw, potato salad, pudding) all enter at the same moment with a 4-hour limit.
   - The Hold button lights with a count of 10 about 36 minutes in. The reason is "needs a temperature reading" (readings are due every 30 minutes per batch). It stays lit for 3+ hours, so it teaches people to ignore it. It never mentions expiry.
   - At 4 hours 2 minutes all ten batches are discarded at once. The Hold badge disappears (nothing left to flag). The 86 button shows 17 items off the menu. No sound, no banner, nothing on the board.
   - At the sample cost per kg the loss is about $762 in one instant (brisket alone $341).
   - The Hold sheet does show "35m of 4 h" per batch, but only after you open it.
2. **Sound is off by default, there is no spoken output, and there is no screen keep-awake request.** A kitchen display whose alarms are off and whose tablet may sleep cannot warn anyone.

### High
3. **Tablet widths below 1180 px hide Hold cabinet, Recall, 86 board and the sanitize timer behind a menu.** At 1024x768 the header shows only station tabs, New ticket, Orders, Back office and the menu button. This includes older iPads and cheaper Android tablets.
4. **Text is too small for any real viewing distance.** Measured at 1280x800: ticket number 24.5 px, timer 22 px, item and customer names 16 px, the "Tap START on..." line 12.5 px, status chips 12.5 px, station tags 11 px. Using a 0.4 degree cap-height rule for comfortable reading and 0.2 degree for barely legible:
   - 10.1 in tablet: item names comfortable to 0.9 ft, barely legible to 1.8 ft.
   - 43 in 1080p TV: ticket number comfortable to 5.1 ft, item names comfortable to 3.2 ft and barely legible to 6.4 ft, next-action line barely legible to 5 ft.
   There is no far-display mode.
5. **Taps per ticket are high.** A 3-item ticket costs 8 taps from first touch to bump (4 items cost 10). A 40-ticket rush is about 340 taps. Order entry costs 6 taps plus a name, payment costs 3, 86-ing an item costs 2.
6. **When many tickets are overdue the whole board is pink, with no hierarchy among them.** In the busy test 9 of 13 tickets were overdue and looked identical. Every healthy ticket also carries a green "On time" chip, so healthy tickets add noise instead of staying quiet.

### Medium
7. Tickets have different heights in a multi-column grid, so on a busy board items drop below the fold. The all-day counts sit in a strip at the bottom that is cut off.
8. Toasts stack in the middle of a sheet and cover buttons (seen on the 86 board).
9. The 86 board starts with a "Channel sync" block (simulated, no POS connected) that pushes the real controls down the screen.
10. Units are mixed: the New batch form uses degrees Celsius and kilograms while the hold alerts use degrees Fahrenheit. There is no units setting.
11. The New batch form for a pit master has many inputs (product, raw weight, cook endpoint, rest hours, first temperature, label). There is no "same as last batch" shortcut.

### Done well
- Tap targets are 44 px and up at tablet size, and the main START, DONE and Bump buttons are large with an icon and a word.
- Overdue is shown with an icon and the word "Overdue", not color alone.
- Each ticket has a "what to do next" line (right idea, too small).
- Station tabs show counts. Undo is offered after a bump.
- Type scales up about 25 percent from 1280 to 1920 wide.
- No console errors in any run.

## Caveats
- All tests are simulated. No real cook has used this through a real service.
- The reading-distance angles are my assumptions (0.4 and 0.2 degrees), stated so they can be checked.
- The sample cost numbers come from the sample menu, not a real kitchen.

## Phase A replay: what counts as a false alarm and a miss (written before the run)

This section was committed before the replay was run, so the result cannot shape the definition. The replay is a **simulation**: a scripted pit master and the app's demo crew in a headless browser at 240 times real speed. It is not a real service, and no cook has used the app. It can find noisy or silent warnings in the app's own logic; it cannot say how a real kitchen behaves.

**Sound.** One sounded alert: the first sound at each rung of the warning ladder, each expiry or past-quality sound, and the loud tone repeating while it is unacknowledged (a repeat is counted as its own sound but is only scored as a false alarm if its rung was). The report gives the total number of sounds, and sounds per hour.

**False alarm.** A sound where, at the moment it sounded, any of these held:
1. projected waste was known and below the floor (under 500 g and under 15 percent of the batch);
2. under 300 g remained in the batch;
3. the kitchen was closed and the "sound outside open hours" setting was off (should be impossible; the check proves it);
4. fewer than 60 seconds remained before the deadline, so nobody could have acted.
A sound about a clock deadline when the pace was unknown is not a false alarm by rule 1: the deadline is a fact about time, and no waste estimate was claimed.

**Miss.** A batch with waste at or above the floor (500 g, or 15 percent of the batch, whichever is lower) at its limit that got no sound for that batch at least 10 minutes earlier while the kitchen was open. Limits reached while the kitchen was closed are listed separately and are not counted as misses.

**Method.** 8 virtual hours of service starting at the current hour, closing at the end of them (service hours set in the replay), 240x speed, 1280x800, demo crew on, a scripted pit master cooking new batches every 2 to 3 hours and, when a batch goes past its quality limit, logging a temperature and keeping it serving for an hour if more than 1 kg is left (otherwise discarding it). Run twice. Alerts are read from the board's own alert log (`SB.floor._alerts`), which records the batch, the grams left and whether sound was allowed at the moment of each sound.

Results are in the next section once the run is done.

## Phase A replay: results (2026-10-18, after the definitions above were committed) (SUPERSEDED by the fake-clock replay below: real clock, not repeatable)

Two runs of `ux-scripts/ux9-service-replay.mjs` at 120x speed (one tick of the board is 2 virtual minutes), 1280x800, 8 virtual hours, the demo crew on and the scripted pit master from the method above. **This is a simulation, not a real service.**

| | Run A | Run B |
|---|---|---|
| Sounds in total (first sound at a rung plus repeats) | 16 | 20 |
| Sounds per hour | 2 | 2.5 |
| Repeats of the loud tone | 0 | 1 |
| **False alarms** (rules 1 to 4) | 0 | 0 |
| Limits reached (a batch passed its limit) | 7 | 5 |
| Of those, at or above the floor | 4 | 3 |
| **Misses** | 0 | 0 |
| Limits reached while the kitchen was closed | 0 | 0 |
| Informational: sounds for batches whose real waste at the limit was below the floor | 0 | 3 |
| First-sound lead before the limit, minutes (batches at or above the floor) | [28, 31, 61, 61] | [28, 62, 61] |
| Console errors or page errors | 0 | 0 |

Two earlier runs are not counted: the first version of the script logged a hot temperature (150 F) for cold-hold food, which sent a batch to "chill", and it cleared the alert log after start-up, which dropped the starter brisket's first warning. Both were script faults, fixed before the runs above. The code under test did not change between them.

What the runs say, and what they do not:
- No false alarm and no miss in either run. Every batch that reached its limit with real food left (4 in run A, 3 in run B) had a sound at least 28 minutes before the limit.
- Run B had 3 sounds about batches that ended with less than the floor left. The definition does not count them (the app projected more waste than came true), but they show a projection can overstate; they are listed as information, not hidden.
- The quality limit worked as designed in the replay: every limit reached was a quality limit, so the batch went to "past quality limit", the scripted cook tasted it and kept it an hour or threw it out, and nothing was thrown out by the app on its own.
- **Not covered:** the replay only exercises batch deadlines. Temperature checks, reheat and chill, cooling, late tickets and the sanitize timer are not scored. The loud repeat tone (every 20 real seconds) barely runs at 120x, so its annoyance is untested (1 repeat in run B, 0 in run A). Safety limits and the hard cap were never reached. Demand comes from the demo crew and hand pulls scripted by me, so it is steadier than a real rush. Nobody listened to the sounds.

## Fake-clock replay (ux10): definitions (written before the first run, 2026-10-18)

This extends the definitions above and is committed before `ux-scripts/ux10-fake-clock-replay.mjs` is run, so the result cannot shape them. It replaces the earlier replay (ux9) for counting: the ux9 runs used the real clock, were not repeatable, and are **superseded** (their numbers above stay as history only). It is still a **simulation**, not a real service.

**Method.** Playwright's fake clock (`page.clock.install`, then `runFor` in 1 second steps) with the app's demo speed at 15x, so one step is 15 virtual seconds and a board tick is 15 virtual seconds. `Math.random` is replaced before the app loads by a seeded generator (the seed is a command-line argument and is printed). The clock install time of each scenario is the demo crew's seed, so each scenario day has its own crew. Each scenario starts from a reset kitchen with service hours 11:00 to 21:00 and runs open to close (10 virtual hours). Every demand scenario uses **exactly one removal path**: tickets from the demo crew, or scripted pulls, never both.

| Scenario | Removal path | What happens |
|---|---|---|
| A, normal day | demo crew tickets, normal rate | the scripted pit master cooks the ux9 schedule (brisket, pork, ribs, mac, beans, sausage) |
| B, busy day at 150 g/min | scripted pulls of pork, jittered (interval 8 to 12 min, 1,500 g give or take 30 percent) | pork cooked in three batches |
| C, late batch with a gap | scripted pulls of pork at about 75 g/min | one 12 kg batch at 11:00, the next at 14:30, so the first runs out while the second rests |
| D, one batch kept three times | none (nothing is sold) | one ribs batch at 11:00; at its quality limit the cook logs a temperature and keeps it 30 minutes, three times in a row, then discards it |
| E, busy demand with many limits | demo crew tickets, rush rate | a new batch of a protein or side every 90 minutes; keep policy as in A |

The pit master's policy at a quality limit (A, B, C, E): log a temperature in range, then keep the batch serving for an hour if more than 1 kg is left, else discard it. In B and C the scripted pulls log the estimator's pace against the realized pace every 10 virtual minutes (the realized pace is the grams pulled in the last 2 hours over the elapsed time, floored at 30 minutes, and the generator's true rate is printed beside it).

**Definitions kept from above.** False alarm rules 1 to 4 and the miss rule are unchanged. A repeat of the loud tone is counted as its own sound but takes the verdict of the first sound of its rung (it is a false alarm only if that first sound was). Nobody taps the strip in the simulation, so loud tones repeat every 20 virtual seconds until the row goes away, and **repeat counts at 15x are not comparable with the ux9 numbers** (those counted real seconds).

**Added for kept batches.**
- **Lapse.** A batch returning to past its quality limit after a keep (its extension ended). Every lapse must get a `past` sound within 2 virtual minutes of the lapse, for its own row (a fresh id, not the one from the first limit). A lapse with no such sound is a miss, whatever the grams.
- **Every `past` sound is scored.** A past sound is a false alarm if the batch was not in the past state at that moment, or under 300 g remained (rule 2), or the kitchen was closed with the setting off (rule 3).
- **Extension end rung.** For every kept batch with at least 300 g left when its extension has 10 minutes to run, the extension must get a rung sound (a non-repeat expiry sound for that extension's row) at least 5 virtual minutes before the extension ends. No sound for the new row may come at the keep tap (within 1 virtual minute of the tap). A missing rung sound is a miss; a sound at the tap is a false alarm.
- **Lapse misses use the 5-minute rule above**, not the 10-minute rule for first limits, because a 30-minute keep has only the 10-minute rung.

**Reported per scenario and day.** Sounds in total, first sounds at a rung, repeats, false alarms (with their rules), limits reached, misses, lapses, lapses sounded within 2 minutes, extension-end rung sounds, `past` sounds. Each scenario is run twice with the same seed; the two results must be identical (the report prints a fingerprint of the full sound log for each run and compares them). Results are appended below once the runs are done.

## Fake-clock replay (ux10): results (2026-10-18, after the definitions above were committed)

`node ux-scripts/ux10-fake-clock-replay.mjs 20261018 A,B,C,D,E out.json 10`, run **twice with the same seed**. All five scenarios gave identical results both times (same sound log fingerprint: A da1f72b09f30df4f, B e330ed78ce187585, C 2ac941878ac0b06c, D ce43c5d9c4047e68, E 5a295071207479a4). An earlier pair of runs with the first version of scenario E also matched run to run. The earlier ux9 runs (real clock, not repeatable) are **superseded**; their table above is history. **This is a simulation, not a real service.** Repeat counts at 15x are not comparable with the ux9 numbers.

| | A normal | B busy, pulls | C gap, pulls | D kept 3 times | E busy tickets |
|---|---|---|---|---|---|
| Removal path | 376 crew tickets | 68 kg of pulls | 26 kg of pulls | none | 1,764 crew tickets |
| Sounds in total | 45 | 0 | 0 | 90 | 0 |
| First sounds at a rung | 7 | 0 | 0 | 14 | 0 |
| Repeats of the loud tone (nobody taps) | 38 | 0 | 0 | 76 | 0 |
| `past` sounds | 2 | 0 | 0 | 4 | 0 |
| **False alarms** | 0 | 0 | 0 | 0 | 0 |
| Sounds at a keep tap | 0 | 0 | 0 | 0 | 0 |
| Limits reached (at or above the floor) | 3 (0) | 0 | 0 | 1 (1) | 2 (0) |
| **Misses** | 0 | 0 | 0 | 0 | 0 |
| Lapses, sounded within 2 virtual minutes | 0 | 0 | 0 | 3 of 3 | 0 |
| Extension-end rung sounds required, missing | 0 | 0 | 0 | 3 required, 0 missing | 0 |
| Console or page errors | 0 | 0 | 0 | 0 | 0 |

Pace estimate against the generator's true rate, logged every 10 virtual minutes (all minutes, including the first hour or two before the estimate has settled, so this is harsher than the unit test): B (true 150 g/min) median error 10.9 percent, 90th percentile 33.3, worst 63.9; C (true 75 g/min) median 5.7, 90th percentile 18.5, worst 53.3.

What this says, and what it does not:
- Scenario D is the one that exercises the fix: a batch kept three times in a row sounded a fresh `past` sound at every lapse within 2 virtual minutes, each extension had its rung sound at least 5 minutes before it ended, and no sound came at a keep tap.
- **Scenario E did not do its job.** As committed (a batch of each product every 90 minutes) it sold out before any limit: 1,347 tickets, 0 sounds, 0 limits. I changed it before the counted runs to overproduce (10 kg of ten products every 60 minutes for 6 hours). It still produced only 2 limits, both below the floor, and no sounds. The demo crew in rush mode sells the oldest batch first fast enough that overproduction rarely reaches a limit. "Busy demand with many limits" is therefore **not tested**; a different demand shape would be needed. Scenarios B and C also reached no limit (everything sold), so they test the pace estimate and quiet running, not the ladder.
- The ladder was exercised properly only in A and D. The loud tone repeats every 20 virtual seconds while nobody taps the strip: 76 repeats in D. A real cook who taps the row stops them; the number shows the cost of ignoring a row, not the usual case.
- Not covered, as before: temperature checks, reheat, cooling, late tickets, the sanitize timer, and anything a real kitchen does that the script does not. Nobody listened to the sounds.

## Alert ladder extensions (2026-10-19)

Built on the existing ladder, not beside it: editable warning times, "remind me later", one sound leader per device, strip step styling and per-tablet loudness.

**What was built and how it was checked**
- **Warning times** (`settings.alerts.ladderThresholds`, office Food safety panel, "Batch expiry warnings only"): 1 to 5 falling whole minutes, last warning at least 5 minutes. The ladder remembers the smallest announced threshold, so editing mid-countdown no longer degrades the last rung to a speech-less repeat or voices an unannounced rung. Unit tests reproduce both faults.
- **Remind me later**: early rungs only, 10 or 30 minutes, clamped before the limit; never the last rung, past or expired. In the cabinet card, not the strip. Unit tests and a browser check.
- **Sound leader**: Web Locks (`smokebox-sound`), heartbeat fallback, pending queue so a held sound is not lost. Two real tabs in one browser context, fake clock, counting audio stubs (`test/ux-sound-leader.mjs`): one tab plays, the other is silent, takeover without replay, and a variant with the "played" message lost replays once.
- **Hidden and restored** (`test/ux-hidden-restore.mjs`): with `runFor` each rung sounds once; with `fastForward` one catch-up sound. Found and fixed a double sound at the limit (expiry row and past row both sounded).
- **Strip**: rows carry first/middle/last and a snoozed flag (CSS: border width, underline on the last, dotted when put off); a visually hidden live region announces each warning once (no assertive region on the ticking strip); "Sound is off on this tablet" bar when sound is off. Loudness slider per tablet (20 to 100 percent, never 0; loud warnings keep at least half level). Contrast script: 260 of 260 pairs pass.
- Volume and sound on/off are per tablet (they describe a speaker); warning times are shared (they describe the food). The sound switch is the mute; there is no second mute flag.

**Not tested, and limits to state in the pilot protocol**
- Real tablet audio and speech, and real hidden-page timer throttling (browsers slow hidden pages to about one timer a second, and to about one a minute after some minutes). **The board warns only while it is in front and the screen is awake**; a locked screen runs no JavaScript at all.
- A crash or force-kill of the sound leader (only a normal tab close was tested), and Safari and iPad (Web Locks should exist from Safari 15.4; the heartbeat fallback is untested in a real browser).
- Snooze and leader behaviour across devices: not built; that is the Connected mode, after the gate.
- The ux10 replay sound counts changed after the limit fix and are re-run in the next section.

### ux10 re-run after the alert-ladder extensions (2026-10-19)

Same seed (20261018), two runs, identical fingerprints both times (A 41321ea781a4fe03, B e330ed78ce187585, C 2ac941878ac0b06c, D 7ba6e8e06916ca34, E 5a295071207479a4). **Only A and D changed** from the earlier counted runs, and only because the limit no longer sounds twice (the expiry row at the limit is quiet; the past row sounds): A 45 to 43 sounds (first sounds 7 to 5), D 90 to 89 (14 to 13). B, C and E are unchanged. False alarms 0 and misses 0 in every scenario; D still sounded 3 of 3 lapses within 2 virtual minutes with all 3 extension rungs present and no sound at a keep tap. The sound-leader gate does not affect the alert log the replay reads (a single tab), so it is not exercised here. The limits stated for scenario E and the untested items above still apply.

## Real-service gate (visit two)

The protocol, pass thresholds and observer sheet are in `docs/pilot-protocol.md` and `docs/pilot-observer-sheet.md`. The Data page has a Pilot report (pulls against the observer's cut count, sounds, discards and cost, taps per job) built from the event log and a saved sound log; its limits are stated in the protocol. Nothing in this report is from a real kitchen yet.

## Phase A: strip readability and taps (measured 2026-10-18)

Screenshots: `docs/ux-shots/strip-1024x768.png`, `strip-1280x800.png`, `strip-1920x1080.png`. At every size the strip shows the two or three most urgent rows above the tickets; at 1024x768 and 1280x800 it uses 175 px of the screen (two rows; a third row is hidden below 820 px height), at 1920x1080 157 px.

Text sizes in the strip (CSS px): countdown 28 (40.8 at 1920 wide), batch name 22 (26.4), what-happens line 17 (20.4). Reading distance with the same assumptions as the table above (cap height 0.72 times font size; 0.4 degrees comfortable, 0.2 barely legible):

| Screen | Countdown | Batch name | What-happens line |
|---|---|---|---|
| 10.1 in tablet, 1280x800 | 1.6 ft / 3.2 ft | 1.3 ft / 2.5 ft | 1.0 ft / 2.0 ft |
| 24 in monitor, 1920x1080 | 3.8 ft / 7.6 ft | 2.5 ft / 4.9 ft | 1.9 ft / 3.8 ft |
| 32 in TV, 1920x1080 | 5.1 ft / 10.2 ft | 3.3 ft / 6.6 ft | 2.5 ft / 5.1 ft |
| 43 in TV, 1920x1080 | 6.8 ft / 13.7 ft | 4.4 ft / 8.9 ft | 3.4 ft / 6.9 ft |

(comfortable / barely legible)

**The acceptance test is not met yet.** The test was: from 10 feet, in 10 seconds, with no taps, know which batch is about to go and what to do. On a 43 in TV the countdown is comfortable to 6.8 ft and barely legible at 10 ft; the batch name is comfortable to 4.4 ft; the line that says what happens is barely legible at 7 ft. On a tablet nothing in the strip reads from across a kitchen. The strip says the right thing, but not yet at the size it needs. Far-display type (the line board's big-type mode and a bigger strip) is the next step and is planned after the real-service gate unless the pilot decides otherwise.

Taps (counted by driving the buttons on a 1280x800 touch screen, 2026-10-18): pulling a unit from the cabinet 2 taps (Hold, Pull); keeping a past-quality batch serving 3 taps once initials are remembered (Hold, Keep, confirm) when a fresh reading already exists, plus the usual 3 taps to log one if it does not; discarding a past-quality batch 3 taps (Hold, Discard, confirm; the reason is now pre-filled). With the Cabinet view left open on a pit tablet (it replaces the tickets on that screen, see below) they are 1, 2 and 2.

## Status of the original findings

| # | Finding | Status |
|---|---|---|
| 1 | No warning ladder, cry-wolf badge | Built: strip, ladder, grouped sounds, badge says why. Replayed in simulation (above). |
| 2 | Sound off, nothing spoken, no wake lock | Built: on by default with a tap-to-allow bar, spoken calls, wake lock request (refused in headless Chromium; untested on a real tablet). |
| 3 | Hold, 86, Recall hidden below 1180 px | Fixed at 1024 px (words drop before buttons; the Hold button became the Cabinet tab). Not checked on a real 1024-wide Android tablet. |
| 4 | Text too small | Far-display preset built; the reading-distance and 10-foot acceptance tests are still open. |
| 5 | Too many taps | Pull and keep are 2 and 3 taps. Clean-hands bump, inferred items: open (phase C). |
| 6 | All-pink board, "On time" chips | Healthy badges are hidden and overdue headers use a strong edge; real-service hierarchy test remains open. |
| 7 | Uneven ticket heights, fold, counts strip | Far-display cards stretch to a shared row height; busy-board and all-day-strip checks remain open. |
| 8 | Toasts cover buttons | Moved bottom-left on tablets and up. Not re-checked against every sheet. |
| 9 | Channel sync block on the 86 board | Folded below the menu and stock. |
| 10 | Mixed units | Open: the cook endpoint now also shows F; no units setting. |
| 11 | New batch form | Starts from the last batch of each product. Fewer inputs: open. |

## Follow-up: far-display preset (2026-10-22)

The board now has an optional **Far display** ticket-size preset in Settings. It enlarges the attention strip and ticket content, narrows the grid to fewer columns, hides the healthy "On time" badge, and gives overdue ticket heads a stronger edge instead of tinting every overdue head pink. This is a visual treatment, not a measured claim: the 10-foot acceptance test has **not** been repeated with cooks or at a real TV distance. Uneven card heights, mixed temperature/weight units, and real-device warning behavior remain open. Do not treat this change as evidence that Phase B has passed.

## Cabinet view (built after the replay)

The hold cabinet is now a page view as well as a sheet: the **Cabinet** tab sits after the station tabs (with the count of batches needing attention) and replaces the tickets on the same screen; the strip and header stay above it. The Hold button left the header (the tab is that button), which is also what keeps Recall and 86 visible on a 1024 px tablet: header fit at 1024x768 measured with the Cabinet tab in place: tab, 86 and Recall visible, Orders and Back office words dropped. `H` toggles it; tapping a strip row opens it on that batch; a station tab brings the tickets back. At 1920 wide its text scales with the board's large-screen factor (1.2). Screenshots: `docs/ux-shots/cabinet-1024x768.png`, `cabinet-1920x1080.png`. It is the same builder as the sheet, so both stay in step. Checked in a real browser at 1024x768 and 1920x1080: opens in one tap, Pull works in one tap from it, the tickets come back, `H` toggles, no console errors. Not yet checked: a real tablet, and the type is still not large enough for a TV across a room (see the readability section).
