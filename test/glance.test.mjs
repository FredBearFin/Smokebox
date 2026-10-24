// The manager glance panel's pure model: plain words, honest estimates, no numbers invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '86-office-glance']);
const { runOutLine, glanceModel } = SB.office.glancePure;
const now = new Date(2026, 9, 16, 18, 0, 0).getTime();
const card = (m, id) => m.cards.find((c) => c.id === id);

test('with no brisket on hand it says so and does not guess a time', () => {
  const r = runOutLine({ name: 'Brisket', onHandG: 0, shortfallAt: null, rateKnown: false }, now);
  assert.equal(r.tone, 'bad');
  assert.match(r.text, /No brisket is ready/);
});

test('a run-out time is shown as an estimate with its basis', () => {
  const r = runOutLine({ onHandG: 4200, shortfallAt: now + 90 * 60e3, rateKnown: true }, now);
  assert.equal(r.tone, 'warn');
  assert.match(r.text, /4\.2 kg on hand/);
  assert.match(r.text, /around 7:30 pm \(an estimate from the last 2 hours of sales\)/);
});

test('enough stock and a known pace says it should last, still as an estimate', () => {
  const r = runOutLine({ onHandG: 9000, shortfallAt: null, rateKnown: true }, now);
  assert.equal(r.tone, 'good');
  assert.match(r.text, /estimate/);
});

test('no pace yet says there is not enough data, never a made-up time', () => {
  const r = runOutLine({ onHandG: 3000, shortfallAt: null, rateKnown: false }, now);
  assert.equal(r.tone, 'info');
  assert.match(r.text, /Not enough sales yet/);
  assert.doesNotMatch(r.text, /\d:\d\d/);
});

test('the five cards: money, open orders, late tickets, 86 list and the run-out item', () => {
  const m = glanceModel({ now, collected: 412.5, paidOrders: 1, openOrders: 3, openValue: 58.25, tickets: 2, late: 1, nearLate: 2, out86: ['Brisket plate', 'Slaw'], runout: { name: 'Brisket', onHandG: 4000, shortfallAt: now + 3600e3, rateKnown: true } });
  assert.deepEqual(m.cards.map((c) => c.id), ['money', 'open', 'late', 'out86', 'runout']);
  assert.equal(card(m, 'money').value, '$412.50');
  assert.equal(card(m, 'money').sub, '1 paid order, with tax and tips');
  assert.equal(card(m, 'open').value, '3');
  assert.match(card(m, 'open').sub, /\$58\.25 not paid yet\. 2 tickets on the line/);
  assert.equal(card(m, 'late').tone, 'bad');
  assert.equal(card(m, 'out86').sub, 'Brisket plate, Slaw');
  assert.equal(card(m, 'runout').value, '7:00 pm');
});

test('a quiet kitchen reads calmly and a missing input never shows NaN', () => {
  const m = glanceModel({ now });
  assert.equal(card(m, 'money').sub, 'No paid orders yet');
  assert.equal(card(m, 'late').tone, 'good');
  assert.equal(card(m, 'out86').sub, 'Everything is on the menu');
  assert.doesNotMatch(JSON.stringify(m), /NaN|undefined|null/);
  assert.doesNotMatch(JSON.stringify(glanceModel(undefined)), /NaN|undefined/);
});

test('nothing on the panel mentions sample data as if it were the kitchen', () => {
  const m = glanceModel({ now, collected: 5, paidOrders: 1 });
  assert.doesNotMatch(JSON.stringify(m), /sample/i);
});

test('a long 86 list shows four names and the count of the rest', () => {
  const m = glanceModel({ now, out86: ['A', 'B', 'C', 'D', 'E', 'F'] });
  assert.equal(card(m, 'out86').value, '6');
  assert.equal(card(m, 'out86').sub, 'A, B, C, D and 2 more');
});

test('a fresh kitchen shows no 86 list and no red brisket warning', () => {
  const m = glanceModel({ now, fresh: true, out86: ['Brisket', 'Slaw'], runout: { name: 'Brisket', onHandG: 0 } });
  const by = (id) => m.cards.find((c) => c.id === id);
  assert.equal(by('out86').value, '0');
  assert.match(by('out86').sub, /Nothing cooked yet/);
  assert.equal(by('runout').tone, 'info');
});

test('no cook-ahead item means no run-out card, and another item names itself', () => {
  assert.deepEqual(glanceModel({ now }).cards.map((c) => c.id), ['money', 'open', 'late', 'out86']);
  const m = glanceModel({ now, runout: { name: 'Pulled pork', onHandG: 0 } });
  assert.equal(card(m, 'runout').label, 'Pulled pork');
  assert.match(card(m, 'runout').sub, /No pulled pork is ready/);
});
