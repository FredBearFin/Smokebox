// The text side of the chef voice: every line is made speakable (numbers, units, times and symbols as a person says them), kept short,
// delivered with the right rate and loudness, queued one at a time with bursts summarized and stale or bumped calls dropped, and the
// voice is picked sensibly. No audio is played or heard here: these are the exact words and numbers the speech engine would get.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '25-deadlines']);
const D = SB.deadlines;
const T0 = Date.UTC(2026, 9, 12, 16, 0, 0);

// The table: what the screen text says, and the exact words that are spoken.
const TABLE = [
  ['4.50 kg', 'Four and a half kilograms'], ['450 g', 'Four hundred fifty grams'], ['1 kg', 'One kilogram'], ['0.5 kg', 'Half a kilogram'],
  ['2.2 kg', 'Two point two kilograms'], ['1,200 g', 'One thousand two hundred grams'], ['2 lb', 'Two pounds'],
  ['1:20', 'One minute twenty seconds'], ['0:45', 'Forty-five seconds'], ['10:00', 'Ten minutes'], ['2:41 pm', 'Two forty-one P M'], ['9:05 AM', 'Nine oh five A M'],
  ['1 h 20 min', 'One hour twenty minutes'], ['2h 10m', 'Two hours ten minutes'], ['25 min', 'Twenty-five minutes'], ['1 min', 'One minute'], ['3 hours', 'Three hours'],
  ['165 °F', 'One hundred sixty-five degrees Fahrenheit'], ['38 °F, just now', 'Thirty-eight degrees Fahrenheit, just now'], ['4 °C', 'Four degrees Celsius'],
  ['#12', 'Ticket twelve'], ['Ticket 12!', 'Ticket twelve!'], ['x2', 'Two of them'], ['+3 more', 'And three more'], ['Brisket batch 1 +5 more', 'Brisket batch one and five more'],
  ['Brisket 1/2', 'Brisket half'], ['Pork sand.', 'Pork sandwich'], ['R&B', 'R and B'], ['86', 'Eighty-six'], ['$12.40', 'Twelve dollars forty'], ['$5', 'Five dollars'],
  ['25%', 'Twenty-five percent'], ['Lane 2 car 28', 'Lane two car twenty-eight'], ['12 tickets', 'Twelve tickets'], ['', ''], [null, ''],
];
test('speakable text: every row of the table gives exactly the spoken words', () => {
  for (const [input, want] of TABLE) assert.equal(D.spoken(input), want, 'for ' + JSON.stringify(input));
});
test('speakable text: no digit and no symbol survives in any phrase the app speaks', () => {
  const lines = [D.phrase('new_all', { num: 12, count: 3 }), D.phrase('new_all', { num: 5, count: 1 }), D.phrase('new_zone', { num: 12, names: '2 brisket sandwich, hush puppies and 1 more' }),
    D.phrase('summary', { count: 12, first: 5 }), D.phrase('start', { name: '2 brisket sandwich', num: 12 }), D.phrase('start_again', { name: 'Brisket 1/2', num: 3 }),
    D.phrase('ready', { num: 7 }), D.phrase('ready_again', { num: 7 }), D.phrase('past', { who: 'Brisket batch 1 and 2 more', many: true }), D.phrase('expired', { who: 'Pork', many: false }),
    D.phrase('expire', { who: 'Brisket batch 1', mins: 10, goes86: true }), D.phrase('expire', { who: 'Ribs and 1 more', many: true, mins: 90, approx: true })];
  for (const l of lines) assert.ok(!/[0-9#%$&°×/+]/.test(l), 'a digit or symbol is left in: ' + l);
});
test('phrases: the exact spoken line for each kind', () => {
  assert.equal(D.phrase('new_all', { num: 12, count: 3 }), 'Order up! Ticket twelve! three items!');
  assert.equal(D.phrase('new_all', { num: 5, count: 1 }), 'Order up! Ticket five! one item!');
  assert.equal(D.phrase('summary', { count: 12, first: 5 }), 'Twelve new tickets. First up, ticket five.');
  assert.equal(D.phrase('start', { name: '2 brisket sandwich', num: 12 }), 'Fire two brisket sandwich now! Ticket twelve!');
  assert.equal(D.phrase('ready', { num: 7 }), 'Ticket seven is up! Ring it out!');
  assert.equal(D.phrase('expire', { who: 'Brisket batch 1', mins: 10, goes86: true }), 'Heads up! Brisket batch one runs out in ten minutes! Act now!');
  assert.equal(D.phrase('expire', { who: 'Slaw', mins: 60 }), 'Heads up! Slaw expires in one hour! Act now!');
  assert.equal(D.phrase('expire', { who: 'Ribs', mins: 90 }), 'Heads up! Ribs expires in one hour thirty minutes! Act now!');
});
test('length: a spoken line is cut to about 14 words at a sentence end', () => {
  const long = D.phrase('new_zone', { num: 12, names: '2 brisket sandwich, hush puppies, sweet tea, mac and cheese and 4 more' });
  assert.ok(long.split(' ').length <= 14, long);
  assert.ok(/[.!?]$/.test(long), long);
  assert.equal(D.clipWords('One two three.', 14), 'One two three.');
});
test('delivery: calm for a heads-up, faster and louder for fire now, loudest for expired', () => {
  const calm = D.delivery('expire'), fire = D.delivery('start'), again = D.delivery('start_again'), neu = D.delivery('new_all');
  assert.ok(calm.rate <= 1.0 && calm.volume < fire.volume, 'a heads-up is calm and quieter');
  assert.ok(fire.rate > neu.rate && again.rate >= fire.rate, 'fire now is faster than a new ticket, and the reminder faster still');
  assert.equal(D.delivery('nonsense').rate, calm.rate, 'an unknown kind is delivered calmly');
  for (const k of ['new_all', 'new_zone', 'summary', 'ready', 'start', 'start_again', 'ready_again', 'past', 'expired', 'expire']) { const d = D.delivery(k); assert.ok(d.rate >= 0.9 && d.rate <= 1.3 && d.pitch >= 0.9 && d.pitch <= 1.3 && d.volume > 0 && d.volume <= 1, k); }
});

// A state with several new tickets
function board(n, extra) {
  const tickets = [];
  for (let i = 0; i < n; i++) tickets.push({ id: 't' + i, num: 5 + i, status: 'active', createdAt: T0 + i * 100, items: [{ id: 'i' + i, short: 'Mac', name: 'Mac', qty: 1, zone: 'sides', status: 'queued', fireAt: T0 + 600e3 }] });
  return Object.assign({ tickets }, extra || {});
}
test('queue: three or more new tickets become one summary line, not a wall of speech', () => {
  const co = D.makeCallouts();
  co.sync(D.calloutWants(board(12), T0 + 2000, 'all', 'normal'), T0 + 2000);
  const first = co.next(T0 + 2000);
  assert.equal(first.text, 'Twelve new tickets. First up, ticket five.');
  assert.equal(first.style, 'summary');
  assert.equal(co.next(T0 + 2000), null, 'nothing else is said for those tickets');
});
test('queue: two new tickets are called one by one, oldest first', () => {
  const co = D.makeCallouts();
  co.sync(D.calloutWants(board(2), T0 + 2000, 'all', 'normal'), T0 + 2000);
  assert.equal(co.next(T0 + 2000).text, 'Order up! Ticket five! one item!');
  assert.equal(co.next(T0 + 2000).text, 'Order up! Ticket six! one item!');
});
test('queue: a call for a ticket that was bumped before it was spoken never plays', () => {
  const co = D.makeCallouts();
  const s = board(2);
  co.sync(D.calloutWants(s, T0 + 2000, 'all', 'normal'), T0 + 2000);
  s.tickets[0].status = 'expedited';
  co.sync(D.calloutWants(s, T0 + 3000, 'all', 'normal'), T0 + 3000);
  assert.equal(co.next(T0 + 3000).text, 'Order up! Ticket six! one item!');
  assert.equal(co.next(T0 + 3000), null);
});
test('queue: a call older than 45 seconds is dropped, not read out late', () => {
  const co = D.makeCallouts();
  co.sync(D.calloutWants(board(1), T0 + 1000, 'all', 'normal'), T0 + 1000);
  assert.equal(co.next(T0 + 60e3), null);
  assert.equal(co.dropped(), 1);
});
test('queue: dishes to fire are spoken before a finished ticket and a new ticket', () => {
  const s = board(2);
  s.tickets[0].items[0].status = 'displayed'; s.tickets[0].items[0].fireAt = T0;
  s.tickets[1].items[0].status = 'done'; s.tickets[1].items[0].doneAt = T0 + 500;
  const co = D.makeCallouts();
  co.sync(D.calloutWants(s, T0 + 2000, 'all', 'normal'), T0 + 2000);
  const order = []; for (let c; (c = co.next(T0 + 2000)); ) order.push(c.style);
  assert.deepEqual(order, ['start', 'ready', 'new_all']);
});
test('levels: light says no new-ticket call and no reminders, normal one reminder, full the most', () => {
  const lv = (l) => D.voiceLevel(l);
  assert.equal(lv('light').newTicket, false); assert.equal(lv('light').startRepeats, 0); assert.equal(lv('light').readyRepeats, 0);
  assert.equal(lv('normal').newTicket, true); assert.equal(lv('normal').startRepeats, 1);
  assert.ok(lv('full').startRepeats > lv('normal').startRepeats && lv('full').readyRepeats > lv('normal').readyRepeats);
  assert.equal(lv('nonsense'), lv('normal'), 'an unknown level is normal');
  const s = board(1); s.tickets[0].items[0].status = 'displayed'; s.tickets[0].items[0].fireAt = T0;
  const kinds = (l) => D.calloutWants(s, T0 + 200e3, 'all', l).map((w) => w.style).join(',');
  assert.equal(kinds('light'), 'start');
  assert.equal(kinds('normal'), 'new_all,start,start_again');
  assert.ok(kinds('full').split(',').filter((k) => k === 'start_again').length > 1);
});

// Voices as the browsers list them
const v = (name, lang, local) => ({ name, lang, localService: local });
test('voice choice: a voice stored on the tablet beats a network voice, and novelty voices are never chosen', () => {
  const ios = [v('Bad News', 'en-US', true), v('Samantha', 'en-US', true), v('Daniel', 'en-GB', true), v('Aaron', 'en-US', true), v('Anna', 'de-DE', true)];
  assert.equal(D.pickVoice(ios).name, 'Samantha');
  const android = [v('Google US English', 'en-US', false), v('en-us-x-sfg#male_1-local', 'en-US', true), v('Google UK English Female', 'en-GB', false)];
  assert.equal(D.pickVoice(android).name, 'en-us-x-sfg#male_1-local');
  const edge = [v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false), v('Microsoft David - English (United States)', 'en-US', true)];
  assert.equal(D.pickVoice(edge).name, 'Microsoft David - English (United States)');
  assert.equal(D.pickVoice([v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false)]).name.includes('Aria'), true, 'a network voice is used when it is all there is');
});
test('voice choice: premium and Siri voices win among local ones; nothing English means the device default', () => {
  assert.equal(D.pickVoice([v('Samantha', 'en-US', true), v('Samantha (Enhanced)', 'en-US', true)]).name, 'Samantha (Enhanced)');
  assert.equal(D.pickVoice([v('Nicky', 'en-US', true), v('Siri Voice 2', 'en-US', true)]).name, 'Siri Voice 2');
  assert.equal(D.pickVoice([v('Anna', 'de-DE', true)]), null);
  assert.equal(D.pickVoice([v('Zarvox', 'en-US', true)]), null, 'only a novelty voice: use the default instead');
  assert.deepEqual(D.voiceInfo([v('Samantha', 'en-US', true)]), { name: 'Samantha', lang: 'en-US', local: true });
  assert.deepEqual(D.voiceInfo([v('Google US English', 'en-US', false)]), { name: 'Google US English', lang: 'en-US', local: false });
  assert.equal(D.voiceInfo([]), null);
});
