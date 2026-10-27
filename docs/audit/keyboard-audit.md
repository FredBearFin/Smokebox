# Keyboard-only audit of the back office

Test: `test/office-keyboard.e2e.mjs` (Playwright; only Tab, Shift+Tab, Enter, Space, Escape and the arrow keys; demo kitchen for the seven pages and the safety record, a real own kitchen with paid orders for the sheets and the Data page). Run: `node test/office-keyboard.e2e.mjs`.

## What is asserted
- **All seven office pages:** every control (links, buttons, inputs, selects, summaries, tab stops) is reached with Tab (the Data page has about 690); Tab never stalls (no keyboard trap); every stop is a visible element with a focus ring (computed outline or box shadow) that contrasts at least 3 to 1 with what is behind it (an outline is judged against the parent surface, since it is drawn outside the control); the tab order is the document order (no `tabindex` above 0) and inside each card the document order is also the visual order; headings never skip a level.
- **Arrow-key groups** (Date range, Data source, Rank items by, Show margin): one tab stop each, arrow keys move inside and keep focus in the group.
- **Buttons:** Space and Enter on "View as table" show and hide the table and keep focus on the button; Space on "Show report" shows the pilot report.
- **Sheets:** Close the day, the food safety record and Close the month: Enter on the opening button opens it, focus moves in, Tab (40 presses) and Shift+Tab never leave it, Escape closes it, and focus goes back to the button that opened it.
- **Erase box** on the Data page: Enter on "Erase tickets and records" opens the typed-word box and moves focus into it, the confirm button stays off until the word is typed, Escape closes only the box and gives focus back to the erase button.
- **Landmarks:** a navigation, one main area and one top heading in the back office.

## Found and fixed (my files)
| Where | Problem | Fix |
|---|---|---|
| `40-charts.css` `.ch-svg:focus-visible` | A chart that is a tab stop (the stock curve) showed a near-black ring (`rgb(16,16,16)`) on its dark surface: contrast 1.1 to 1. | The ring uses the chart's own text color (`--ch-text`), 3 px, offset 2 px. |
| `84-office-data.js` `askTyped` | Escape in the erase box was handled only on the input, and it did not stop the page-wide Escape (`60-shell.js` leaves the back office when nothing else handled the key), so Escape in the erase box threw the owner out of the back office and focus was lost. | Escape anywhere in the box now closes only the box, stops the event, and returns focus to the erase button. |
| Test harness | The Tab starting point survived page changes. | Not a product bug; the walk now starts at the first control. |

## For others (not changed)
No keyboard defects were found in the parts of other owners that the test touches: the segmented control (60-shell `SB.ui.segmented`, roving tabindex and arrows work), the sheet shell (`SB.ui.sheet`: focus in, trap, Escape, focus back), and A2's Close the month sheet (opens with focus inside, Tab stays inside, Escape returns focus to the card button).

## Second pass (night/a3-keys2): the former "not checked" list
Asserted in `test/office-keyboard.e2e.mjs`, all passing:
- **Restore confirmation dialog** (Data page, "Replace everything with this backup"): Enter opens it with focus inside; focus does not start on the destructive button; Tab (20) and Shift+Tab (4) stay inside; Escape cancels, nothing is replaced and focus goes back to the button; the destructive button can be reached with Tab and Enter on it restores the backup.
- **PIN keypad** (`SB.shell.promptPin`): opens with focus on "Digit 1"; all 12 keys have a spoken name containing the digit drawn on them; Tab and Shift+Tab stay inside; typing digits on the keyboard works; a wrong PIN says "Wrong PIN. 4 tries left." in an alert region and keeps the keypad open; the count of digits is announced politely; the right PIN closes it, answers yes and gives focus back to the opener; Escape answers no and gives focus back.
- **Thrown-out log sheet** (A1's `76-floor-discards.js`): opens with focus inside; Tab (40) and Shift+Tab stay inside; every control has a name; Escape closes it and focus goes back. No defect found.
- **Manager glance** (`SB.office.glance`, drawn into a host the way the wall board does): no controls (read only), a labelled region. It has no live region: its numbers refresh every 5 seconds without announcing anything, which is deliberate (an announcement every 5 seconds would be noise); a screen reader reads it when the person moves to it.

## Accessible names of the office pages (`test/office-names.e2e.mjs`)
Every office page in the demo kitchen (at 1280 and 390 wide) and in an own kitchen with paid orders: every visible control has an accessible name; a name that differs from the visible words contains them (WCAG 2.5.3, also axe's experimental `label-content-name-mismatch`); `aria-labelledby`, `aria-controls`, `aria-describedby` and `label for` all point at real elements; nothing focusable sits inside `aria-hidden`; ids are unique; roles are valid; every visible table has a name and heading cells; every chart has a name and a role; each page has a live region; axe's name, role and label rules find nothing.
Found and fixed:
| Where | Problem | Fix |
|---|---|---|
| `80-office-core.js` rail links, `30-office.css` | The links for pages that are off ("Safety", "Stock and 86" when cooked-ahead food is not tracked) had `aria-label="Safety"` while the drawn words were "Safety Not tracking": the spoken name lacked the visible words (label in name). | No `aria-label`; the link's content is the name. The full page name stays in the link for screen readers (clipped, not hidden) in the narrow layout, where only the short name is drawn (and marked `aria-hidden`). |

## Not checked
- The thrown-out log's "Fix this entry" sub-sheet and column chooser; the PIN lock after five wrong tries (30 s) and the recovery-code form.
- Screen reader announcements themselves (names and roles are checked, not what a particular screen reader says), a real tablet keyboard.
