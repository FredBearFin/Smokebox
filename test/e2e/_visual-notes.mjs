// Visual defects found by LOOKING at the contact sheets (tools/qa-contact.mjs). A test cannot see these, so a person
// (the QA engineer) writes them here and tools/qa.mjs copies them into docs/qa-report.md. Owner keys are the ones in
// tools/qa.mjs OWNERS. Not a test file (the runner skips names that start with an underscore).
export default [
  {
    where: 'Board, all-day dock, 1280 and 390 wide',
    what: 'The last chip in the all-day bar is cut in half at the right edge ("Fried pickles x1" at 1280, "Co" and "Frie" at 390) and nothing shows that the bar scrolls sideways (no fade, arrow or scrollbar at rest). .fl-dock-list is the intended inner scroller, but a cook cannot tell that more chips exist.',
    owner: 'board',
    shot: 'contact-floor.png',
  },
  {
    where: 'Office, page title of Tickets, Stations, Sales and money, Safety, Stock and 86, Menu, prices and shop (Ember and Paper, also 280 and 390)',
    what: 'After moving to a page from the left rail the title (h1) is drawn inside a thick focus-ring box; only Pace (the first page) has no box. It looks like a stray frame around the heading. Move focus to the heading without a visible ring (the ring is for keyboard users on controls), or keep it only when the move came from the keyboard.',
    owner: 'officeA',
    shot: 'contact-office-ember.png',
  },
  {
    where: 'Office Tickets, "How long tickets take" chart',
    what: 'The reference-line label "Warn 7m 56s" runs into the red Overdue line: the last characters ("56s") are crossed by the line. The label should sit on the other side of its line or be pushed left.',
    owner: 'lead',
    shot: 'contact-office-ember.png',
  },
  {
    where: 'Office Stations, "Items waiting at each station" area chart',
    what: 'The direct labels at the right end of the series (Cold and drinks, Fry, Hot sides, Pit) are packed 12 px apart and the lowest one, "Pit", sits on the x-axis baseline so the line strikes through the word. Readable but cramped.',
    owner: 'lead',
    shot: 'contact-office-ember.png',
  },
  {
    where: 'Office Pace at 280 wide, headline',
    what: 'A duration is broken across two lines: "within 9m" at the end of one line and "03s;" at the start of the next. A time such as 9m 03s should never split (use a no-break space between the minute and second parts).',
    owner: 'officeA',
    shot: 'contact-narrow.png',
  },
  {
    where: 'Office bottom tab bar at 280 and 390 wide',
    what: 'The seven tab labels (Pace, Tickets, Stations, Money, Safety, Stock, Data) are 9.5 to 10.5 px (30-office.css lines 243 and 285): hard to read on a phone held at arm\'s length in a kitchen.',
    owner: 'officeA',
    shot: 'contact-narrow.png',
  },
  {
    where: 'Any sheet that is open when a toast appears (280, 390 and 1280)',
    what: 'The "Order discarded." toast is drawn over the lower part of the open sheet and hides content (the Nothing has been 86\'d lines, the Discard button of a hold card). It goes away by itself after a few seconds, but while it is up it covers a control the cook may want.',
    owner: 'lead',
    shot: 'contact-narrow.png',
  },
];
