// Independent-review fixes on the hub: a damaged or refused state.json is never overwritten (#3), and a stalled event-stream client is dropped
// instead of growing the hub's memory (#7).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHub } from '../server/server.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubfix-'));
let n = 0;
// A fresh data file path in its own folder.
const fileIn = () => { const d = path.join(dir, 'd' + ++n); fs.mkdirSync(d); return path.join(d, 'state.json'); };
const act = async (port, body) => (await fetch('http://127.0.0.1:' + port + '/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const ticket = (i) => ({ type: 'createTicket', payload: { customer: 'G' + i, items: [{ menuId: 'tea' }] }, opId: 'o' + i });

test('#3: an unreadable state.json is kept as state.json.bad-<time> before anything is written, and the hub says so', async () => {
  const file = fileIn();
  const damaged = '{"v":1,"seq":7,"state":{"v":1,"tickets":[{"id":"t_1","cust';
  fs.writeFileSync(file, damaged);
  const hub = await createHub({ dataFile: file, tickMs: 600000, saveMs: 10, starter: true });
  const port = await hub.listen(0);
  try {
    assert.ok(hub.dataProblem && /unreadable/i.test(hub.dataProblem.words), JSON.stringify(hub.dataProblem));
    const bads = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith('state.json.bad-'));
    assert.equal(bads.length, 1);
    assert.equal(fs.readFileSync(path.join(path.dirname(file), bads[0]), 'utf8'), damaged, 'the damaged text is kept exactly');
    assert.equal((await act(port, ticket(1))).report, 'ok');
    hub.flush();
    assert.equal(fs.readFileSync(path.join(path.dirname(file), bads[0]), 'utf8'), damaged, 'and a later save does not touch it');
    const h = await (await fetch('http://127.0.0.1:' + port + '/health')).json();
    assert.equal(h.ok, true); assert.match(h.dataProblem, /state\.json\.bad-/);
  } finally { await hub.close(); }
});

test('#3: a file this version refuses (a newer format) is left exactly as it is and the hub will not start on it', async () => {
  const file = fileIn();
  const text = JSON.stringify({ v: 1, seq: 3, state: { v: 2, tickets: [] } });
  fs.writeFileSync(file, text);
  await assert.rejects(() => createHub({ dataFile: file, tickMs: 600000 }), /refus|newer|version/i);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.json']);
});

test('#3: a good file loads as before, nothing is renamed, and health shows no problem', async () => {
  const file = fileIn();
  const a = await createHub({ dataFile: file, tickMs: 600000, saveMs: 10, starter: true });
  const pa = await a.listen(0); await act(pa, ticket(1)); a.flush(); await a.close();
  const b = await createHub({ dataFile: file, tickMs: 600000, saveMs: 10 });
  const pb = await b.listen(0);
  try {
    assert.equal(b.snapshot().state.tickets.length, 1);
    assert.equal(b.dataProblem, null);
    assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f !== 'state.json' && !f.endsWith('.bak')), []);
    const h = await (await fetch('http://127.0.0.1:' + pb + '/health')).json();
    assert.equal(h.dataProblem, undefined);
  } finally { await b.close(); }
});

test('#3: a rolling .bak of the previous save is kept', async () => {
  const file = fileIn();
  const hub = await createHub({ dataFile: file, tickMs: 600000, saveMs: 10, starter: true, bakEveryMs: 0 });
  const port = await hub.listen(0);
  try {
    await act(port, ticket(1)); hub.flush();
    const first = fs.readFileSync(file, 'utf8');
    await act(port, ticket(2)); hub.flush();
    assert.equal(fs.readFileSync(file + '.bak', 'utf8'), first, 'the .bak holds the save before this one');
  } finally { await hub.close(); }
});

test('#7: a client that stops reading is dropped once its backlog passes the cap, and memory does not follow it', async () => {
  const hub = await createHub({ dataFile: null, tickMs: 600000, heartbeatMs: 600000, starter: true, maxClientBacklog: 100 * 1024 });
  const port = await hub.listen(0);
  const stalled = net.connect(port, '127.0.0.1');
  await new Promise((r) => stalled.once('connect', r));
  stalled.write('GET /events HTTP/1.1\r\nHost: x\r\n\r\n');
  stalled.pause();
  stalled.on('error', () => {});
  try {
    for (let i = 0; i < 40 && hub.clientCount() < 1; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(hub.clientCount(), 1);
    for (let i = 0; i < 1500 && hub.clientCount() > 0; i++) await act(port, ticket(i));
    assert.equal(hub.clientCount(), 0, 'the stalled client was dropped');
    assert.equal((await act(port, ticket(99999))).report, 'ok', 'and the hub keeps working');
  } finally { stalled.destroy(); await hub.close(); }
});

test('#7: a healthy client that keeps reading is never dropped', async () => {
  const hub = await createHub({ dataFile: null, tickMs: 600000, heartbeatMs: 600000, starter: true, maxClientBacklog: 100 * 1024 });
  const port = await hub.listen(0);
  const ctrl = new AbortController();
  const res = await fetch('http://127.0.0.1:' + port + '/events', { signal: ctrl.signal });
  let got = 0; (async () => { try { const rd = res.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.length; } } catch (e) { /* closed */ } })();
  try {
    for (let i = 0; i < 150; i++) await act(port, ticket(i));
    assert.equal(hub.clientCount(), 1); assert.ok(got > 0);
  } finally { ctrl.abort(); await hub.close(); }
});

test('an action the hub cannot write to its log is refused (503), changes nothing, and can be sent again once the disk works', async () => {
  const file = fileIn();
  const wal = path.join(path.dirname(file), 'no-such-folder', 'state.json.wal');
  const hub = await createHub({ dataFile: file, walFile: wal, tickMs: 600000, saveMs: 10, starter: true });
  const port = await hub.listen(0);
  try {
    const seq0 = hub.snapshot().seq, tickets0 = hub.snapshot().state.tickets.length;
    const res = await fetch('http://127.0.0.1:' + port + '/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ticket(1)) });
    assert.equal(res.status, 503);
    assert.match((await res.json()).info.error, /could not save/);
    assert.equal(hub.snapshot().seq, seq0, 'no change was counted or sent to screens');
    assert.equal(hub.snapshot().state.tickets.length, tickets0, 'the ticket was not made');
    fs.mkdirSync(path.dirname(wal));
    const again = await act(port, ticket(1));
    assert.equal(again.report, 'ok'); assert.ok(!again.duplicate, 'the refused opId was not remembered');
    assert.equal(hub.snapshot().state.tickets.length, tickets0 + 1);
  } finally { await hub.close(); }
});
