// Voice call-out logic: what is worth saying, the station filter, the one-at-a-time queue and stale calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '25-deadlines']);
const D = SB.deadlines;
const T0 = Date.UTC(2026, 9, 12, 16, 0, 0);

// A tiny state with one active ticket: a pit dish at once, a pit dish paced 5 minutes later, a fry dish paced later.
function state(extra) {
  const items = [
    { id: 'i1', short: 'Brisket', name: 'Brisket plate', qty: 2, zone: 'pit', status: 'cooking', fireAt: T0 },
    { id: 'i2', short: 'Ribs', name: 'Ribs', qty: 1, zone: 'pit', status: 'queued', fireAt: T0 + 300e3 },
    { id: 'i3', short: 'Hush puppies', name: 'Hush puppies', qty: 1, zone: 'fry', status: 'queued', fireAt: T0 + 240e3 },
  ];
  return { tickets: [Object.assign({ id: 't1', num: 12, status: 'active', createdAt: T0, items }, extra || {})] };
}

test('wants: a new ticket is called for the all view with the item count, and a paced dish is not called before its time', () => {
  const w = D.calloutWants(state(), T0 + 1000, 'all');
  assert.deepEqual(w.map((x) => x.id), ['n:t1']);
  assert.equal(w[0].text, 'Order up! Ticket twelve! three items!');
});

test('wants: when a paced dish is due it gets a start-now call naming the dish and the ticket', () => {
  const s = state();
  s.tickets[0].items[1].status = 'displayed';
  const w = D.calloutWants(s, T0 + 301e3, 'all');
  const st = w.find((x) => x.kind === 'start');
  assert.equal(st.id, 's:t1:' + Math.floor((T0 + 300e3) / 1000));
  assert.equal(st.text, 'Fire Ribs now! Ticket twelve!');
  assert.equal(st.at, T0 + 300e3);
});

test('wants: a dish that starts with the ticket is called too, and dishes due at the same moment make one call', () => {
  const s = state();
  s.tickets[0].items[0].status = 'displayed';
  s.tickets[0].items[0].fireAt = T0;
  s.tickets[0].items[1].status = 'displayed';
  s.tickets[0].items[1].fireAt = T0;
  const starts = D.calloutWants(s, T0 + 5000, 'all').filter((x) => x.kind === 'start');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].text, 'Fire two Brisket, Ribs now! Ticket twelve!');
});

test('station filter: a station only hears its own dishes, and a ticket with nothing for it is silent', () => {
  const s = state();
  s.tickets[0].items[1].status = 'displayed'; s.tickets[0].items[2].status = 'displayed';
  const firsts = (w) => w.filter((x) => x.id.split(':').length < 4); // leave out the reminders
  const fry = firsts(D.calloutWants(s, T0 + 400e3, 'fry'));
  assert.deepEqual(fry.map((x) => x.id).sort(), ['n:t1', 's:t1:' + Math.floor((T0 + 240e3) / 1000)].sort());
  assert.equal(fry.find((x) => x.kind === 'new').text, 'Order up, ticket twelve! Hush puppies!');
  const pit = firsts(D.calloutWants(s, T0 + 400e3, 'pit'));
  assert.equal(pit.find((x) => x.kind === 'new').text, 'Order up, ticket twelve! two Brisket, Ribs!');
  assert.deepEqual(pit.filter((x) => x.kind === 'start').map((x) => x.id), ['s:t1:' + Math.floor((T0 + 300e3) / 1000)]);
  assert.deepEqual(D.calloutWants(s, T0 + 400e3, 'cold'), []);
});

test('station filter: the expo tab hears new tickets only, never start calls', () => {
  const s = state();
  s.tickets[0].items[1].status = 'displayed';
  const w = D.calloutWants(s, T0 + 400e3, 'expo');
  assert.deepEqual(w.map((x) => x.kind), ['new']);
});

test('wants: bumped tickets and finished dishes make no call', () => {
  const s = state({ status: 'expedited' });
  assert.deepEqual(D.calloutWants(s, T0, 'all'), []);
});

test('queue: one call at a time, oldest first, and each call is handed out once', () => {
  const q = D.makeCallouts();
  q.sync([{ id: 'b', at: T0 + 2000, text: 'B' }, { id: 'a', at: T0 + 1000, text: 'A' }], T0 + 3000);
  assert.equal(q.next(T0 + 3000).text, 'A');
  assert.equal(q.next(T0 + 3000).text, 'B');
  assert.equal(q.next(T0 + 3000), null);
  q.sync([{ id: 'a', at: T0 + 1000, text: 'A' }], T0 + 4000);
  assert.equal(q.next(T0 + 4000), null, 'a call already handed out is not repeated');
});

test('queue: a call that is stale when it arrives, or while it waits, is dropped not read late', () => {
  const q = D.makeCallouts({ staleMs: 30e3 });
  q.sync([{ id: 'old', at: T0, text: 'old' }, { id: 'fresh', at: T0 + 50e3, text: 'fresh' }], T0 + 60e3);
  assert.equal(q.size(), 1);
  assert.equal(q.next(T0 + 95e3), null, 'fresh waited 45 s, longer than the limit');
  assert.equal(q.dropped(), 2);
});

test('queue: a call whose reason is gone (ticket bumped, dish started) is dropped before it is spoken', () => {
  const q = D.makeCallouts();
  q.sync([{ id: 'x', at: T0, text: 'X' }, { id: 'y', at: T0, text: 'Y' }], T0 + 1000);
  q.sync([{ id: 'y', at: T0, text: 'Y' }], T0 + 2000);
  assert.equal(q.next(T0 + 2000).text, 'Y');
  assert.equal(q.next(T0 + 2000), null);
});

test('queue: a rush keeps only the newest few waiting calls', () => {
  const q = D.makeCallouts({ maxWait: 3 });
  const ws = [1, 2, 3, 4, 5].map((i) => ({ id: 'c' + i, at: T0 + i * 1000, text: 'C' + i }));
  q.sync(ws, T0 + 6000);
  assert.deepEqual([q.next(T0 + 6000).id, q.next(T0 + 6000).id, q.next(T0 + 6000).id], ['c3', 'c4', 'c5']);
});

test('prime: what is already true when call-outs start is not read out, but later arrivals are', () => {
  const q = D.makeCallouts();
  q.prime([{ id: 'n:t1', at: T0, text: 'old' }]);
  q.sync([{ id: 'n:t1', at: T0, text: 'old' }, { id: 'n:t2', at: T0 + 5000, text: 'new' }], T0 + 6000);
  assert.equal(q.next(T0 + 6000).text, 'new');
  assert.equal(q.next(T0 + 6000), null);
});

test('chef voice: every spoken line is short and sharp, in the one built-in style', () => {
  assert.equal(D.phrase('start', { name: '2 brisket sandwich', num: 12 }), 'Fire two brisket sandwich now! Ticket twelve!');
  assert.equal(D.phrase('expire', { who: 'Brisket', many: false, mins: 10, goes86: true, approx: false }), 'Heads up! Brisket runs out in ten minutes! Act now!');
  assert.equal(D.phrase('expire', { who: 'Ribs and 1 more', many: true, mins: 30, approx: true }), 'Heads up! Ribs and one more expire in about thirty minutes! Act now!');
  assert.equal(D.phrase('past', { who: 'Pork', many: false }), 'Pork is past quality! Check it now!');
  assert.equal(D.phrase('expired', { who: 'Pork', many: false }), 'Pork expired! Pull it and log it now!');
  assert.ok(D.CHEF_VOICE.rate > 1 && D.CHEF_VOICE.pitch >= 1, 'faster and sharper than a default voice');
});

test('chef voice: the best-sounding English voice is picked, and none means the device default', () => {
  const v = (name, lang) => ({ name, lang });
  const list = [v('Microsoft Mark', 'en-US'), v('Anna', 'de-DE'), v('Google US English', 'en-US'), v('Microsoft Aria Online (Natural)', 'en-US'), v('Samantha', 'en-US')];
  assert.equal(D.pickVoice(list).name, 'Microsoft Aria Online (Natural)');
  assert.equal(D.pickVoice([v('Anna', 'de-DE')]), null, 'no English voice, so the device default');
  assert.equal(D.pickVoice([]), null);
  assert.equal(D.pickVoice(null), null);
  // the owner's choice wins while the device still has that voice; a voice that is gone falls back to the best one
  assert.equal(D.pickVoice(list, 'Samantha').name, 'Samantha');
  assert.equal(D.pickVoice(list, 'Gone voice').name, 'Microsoft Aria Online (Natural)');
  assert.equal(D.pickVoice(list, '').name, 'Microsoft Aria Online (Natural)');
});

test('levels: light skips the new-ticket call and never repeats; normal repeats a waiting dish once; full keeps reminding', () => {
  const s = state();
  s.tickets[0].items[1].status = 'displayed';
  s.tickets[0].items[2].status = 'cooking'; // only the ribs are waiting to start
  const key = Math.floor((T0 + 300e3) / 1000);
  const kinds = (lvl, t) => D.calloutWants(s, t, 'all', lvl).map((x) => x.id);
  assert.deepEqual(kinds('light', T0 + 400e3), ['s:t1:' + key], 'light: the start call only, once');
  assert.deepEqual(kinds('light', T0 + 700e3), ['s:t1:' + key]);
  assert.deepEqual(kinds('normal', T0 + 310e3), ['n:t1', 's:t1:' + key], 'normal: new ticket plus the start call');
  assert.deepEqual(kinds('normal', T0 + 326e3), ['n:t1', 's:t1:' + key, 's:t1:' + key + ':1'], 'normal: one reminder after 25 s');
  assert.deepEqual(kinds('normal', T0 + 800e3), ['n:t1', 's:t1:' + key, 's:t1:' + key + ':1'], 'normal: never more than one reminder');
  assert.equal(kinds('full', T0 + 300e3 + 61e3).filter((x) => x.startsWith('s:')).length, 4, 'full: start plus three reminders after 61 s');
  assert.equal(kinds('full', T0 + 900e3).filter((x) => x.startsWith('s:')).length, 5, 'full: start plus four reminders, then stops');
  assert.equal(D.voiceLevel('nonsense'), D.voiceLevel('normal'), 'an unknown level is normal');
});

test('ring out: when every dish on a ticket is done the counter hears it, with reminders by level, and a station tab does not', () => {
  const s = state();
  s.tickets[0].items.forEach((it, i) => { it.status = 'done'; it.doneAt = T0 + 100e3 + i * 1000; });
  const w = D.calloutWants(s, T0 + 110e3, 'all');
  assert.deepEqual(w.map((x) => x.id), ['r:t1']);
  assert.equal(w[0].text, 'Ticket twelve is up! Ring it out!');
  assert.equal(w[0].at, T0 + 102e3, 'at the time the last dish finished');
  assert.deepEqual(D.calloutWants(s, T0 + 140e3, 'all', 'normal').map((x) => x.id), ['r:t1', 'r:t1:1']);
  assert.equal(D.calloutWants(s, T0 + 400e3, 'all', 'full').length, 3, 'full: the call plus two reminders');
  assert.equal(D.calloutWants(s, T0 + 400e3, 'all', 'light').length, 1, 'light: the call once');
  assert.deepEqual(D.calloutWants(s, T0 + 140e3, 'pit'), [], 'a cooking station is not asked to ring out');
  assert.deepEqual(D.calloutWants(s, T0 + 140e3, 'expo', 'normal').map((x) => x.id), ['r:t1', 'r:t1:1'], 'expo hears it');
  s.tickets[0].status = 'expedited';
  assert.deepEqual(D.calloutWants(s, T0 + 140e3, 'all'), [], 'once the ticket is bumped the call stops');
});
