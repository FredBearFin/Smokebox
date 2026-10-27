# Handoff: merge the night work into deploy

For the thread that owns `deploy` right now (the one that produced PR #32, branch `claude/busy-carson-7dtevu`).
Written 2026-10-24 by the night thread. Nothing here has been pushed to `deploy` or `main` by the night thread since commit b01ddbd.

## What to merge
Branch **`integration/all`** in `FredBearFin/SmokeBoxKDS` (remote name `kds`). It is `deploy` as of b01ddbd plus four finished pieces:

| Piece | Branch it came from | What it does |
|---|---|---|
| Board sleep and slow-tablet work | `night/a1-sleep` | Sleep and wake summary, put-off reminders, discarded-page reload, faster Orders drawer and station switch |
| Set-aside history screen | `night/a2-parked` | Data page card to bring back history an older build set aside (backup first, typed word, Undo); "Saved history: N% full" in Settings; cook-ahead label fix |
| Keyboard and screen-reader work | `night/a3-keys2` | Focus, Escape and name fixes in the office; new `office-keyboard` and `office-names` tests |
| Faster saves | `night/a5-savecost` | Multi-tab check reads only the action-id list; compact text built from remembered pieces |

I also added one word, `sleepSnap`, to the kitchen-data key list in `src/js/00-util.js`, because A1's code stores a per-tab key and `test/demo-isolation.test.mjs` requires every `smokebox.v1.*` key to be classified.

`deploy` has moved on since (6b6636a, PR #32, 91 files). A trial merge of `integration/all` with it shows **3 conflicts**. I did not resolve them. Resolve each by keeping both sides' intent, commit, and test before pushing.

## How to do it
1. `git fetch kds`, branch from `kds/deploy`, then `git merge kds/integration/all`. Resolve the 3 conflicts.
2. Regenerate generated files with tooling, never by hand: `node tools/build.mjs --quiet` (dist), `node tools/build-guide.mjs` (Guide page file from `docs/sop`).
3. Run: `node tools/comment-audit.mjs`, `node tools/test.mjs`, `node tools/smoke.mjs`, `node tools/boot-old-saves.mjs`, `node tools/guide-walk.mjs`, `node tools/guide-a11y.mjs`.
4. Then the browser suites in `test/*.e2e.mjs`, one at a time (they rebuild `dist` and cannot run in parallel). The ones that matter most for this merge: `parked-copy`, `office-keyboard`, `office-names`, `month-close`, `multitab`, `office-data`, `setup-wizard`, `board-sleep`, `board-slow`, `print-qa`.

## Results on `integration/all` just before this note
- Unit 967 pass, 0 fail, 0 todo. Smoke 11/11. Old saves 43/43. Guide walk 324/324. Guide a11y 34/34. Comment audit passes.
- The browser suites above were run by the agents on their own branches and passed. They were **not** run on the combined `integration/all` build.
- Timing tests (5000-ticket metrics budgets, `floor` tick, `board-update`) are flaky when the machine is loaded; they pass alone. Check a failure alone before treating it as real.
- Nothing has been run on a real tablet, in Safari, on a printer, or on the real server.

## Do not
- Put the experimental `connected` track (branch `connected`, `night/a5-conn-all`, `night/a2-merge2`, anything `*-conn*`) on `deploy` or the server without the owner's say-so.
- `git stash` (shared across worktrees), or `npm install` in `/opt/npm-tools`.
- Weaken a test, a golden hash (`test/golden-hashes.test.mjs`) or the clock-jump hold (over 36 hours) to get green.
- Edit `src/js/20-engine.js`, `30-store.js`, `10-config.js` or `00-util.js` casually. They carry the data-safety rules (see below).

## What the next engineer must know
- **Saved state has three forms.** Under 300 tickets and 2,500 events: plain. Larger: compact (`fmt: 2`, about 56% of the size). Backups, exports and hub snapshots are always plain. Read the store's save through `store.decodeSaved()`; never assume `.state` exists in a raw saved copy.
- **Several tabs depend on a per-save action-id list.** Never reuse an action id in one page, never order by wall clock, never drop the list from a save, or tickets are silently lost (`test/multitab-clock.test.mjs`, `test/multitab.e2e.mjs`).
- **Never drop history without a committed export.** Close the month needs proof of its backup; the hub may not run it; a day with sales after its last close is never cleared.
- **The board never adds or removes nodes in the per-second tick** and never forces layout there. New notices go into the existing priority chain on the strip.
- **The office is a layer on the engine; it never edits it.** Every number has a plain-words definition in `docs/audit/office.md` and a reference check in `test/metrics-reference.test.mjs`.
- Every named function needs a plain-words comment of at least six words (`node tools/comment-audit.mjs`).

## Known open problems (most important first)
1. At 250 tickets a day the browser's 5 MB limit is reached in about 15 days; older tickets are then lost on reload. Protection is the nudge, Close the month and the daily backup.
2. Safari and iPad can clear all site storage after about 7 days unused. Only monthly files and backups protect against it.
3. A save that is damaged but still parses as valid data is not detected (no checksum).
4. Board bugs seen on main before this merge: the cold-item out-of-fridge line is shown but not spoken (`test/board-round15.e2e.mjs`), and `board-round16` fails; it may only be time-of-day dependent (it fails after the kitchen closes).
5. Sales CSV can miss a sale paid after a day's last close once that month is cleared.
6. Not yet built: owner Screens panel on the connected track; ideas not done: event diet, archive chunks per key, skip validation on own save.

## Where the rest is
- All 163 night branches are on `kds` under `night/*`. 46 are not on `deploy`: almost all are connected-track work; the others are `a2-journey` (owner journey test, 185 checks, about 5 minutes, `test/owner-journey.e2e.mjs`) and the two reviews (`review-r1`, `review-r2`).
- Reports: `docs/STATE-OF-THE-APP.md`, `docs/known-limits.md`, `docs/audit/e2e-triage.md`, `docs/audit/keyboard-audit.md`, `docs/audit/history-storage-v2.md`, `docs/audit/decisions-for-freddy.md`.
- Business questions (price, pilot restaurant, support contact, terms and liability) belong to the owner; do not decide them.
