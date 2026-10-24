# Smokebox hub (PROTOTYPE)

A small Node process that keeps one shared kitchen state so several screens can show the same board. It is a **prototype for the connected plan** (`docs/connected-plan.md`). It is not part of the Solo offer, it does not change `dist/smokebox.html`, and the browser client transport is not wired yet (it is Agent 2's branch `a2/transport`). Zero npm dependencies; Node 22.

## Run it
```
node tools/build.mjs --quiet                       # writes dist/smokebox.html
SMOKEBOX_TZ=America/New_York SMOKEBOX_DATA=./hub-state.json node server/server.mjs
```
Then open `http://127.0.0.1:8787/`. The page served is the normal single-file app; the browser does not yet use a hub transport (only the Node test helper `test/_hub-transport.mjs` does).

| Variable | Meaning | Default |
|---|---|---|
| `PORT` | listen port | 8787 |
| `HOST` | listen address. WATCH OUT: the hub has no password of its own, so `0.0.0.0` lets anyone on that network read and change the whole kitchen; use it only on a network you fully trust, and keep `127.0.0.1` behind Caddy (as `go.sh` does) everywhere else | 127.0.0.1 |
| `SMOKEBOX_TZ` | process time zone (the service day rolls over at 4 am local time) | system |
| `SMOKEBOX_DATA` | JSON file for saving; checked with the engine's `validateBackup` on start | none (memory only) |
| `SMOKEBOX_HTML` | page to serve | `dist/smokebox.html` |
| `SMOKEBOX_STARTER` | `1` starts with demo stock; default is an empty kitchen like a real first run | empty |

## Protocol
- `GET /events`: Server-Sent Events. First an `snapshot` event, then a `state` event after every change, plus an `hb` heartbeat every 15 s. Every `state`/`snapshot` body is `{ state, serverNow, seq }`; `state` events also carry `by` (the sender's `clientId`), `opId` and `type`. `serverNow` lets a client correct its clock.
- `POST /action` with `{ type, payload, clientId, opId }`. The hub runs `engine.apply(state, type, payload, Date.now())` and answers `{ report, info, seq }`. A repeated `opId` is answered with the first reply plus `duplicate: true` and is not applied again (the last 5000 are remembered, in memory only). A refused action changes nothing. An action the hub cannot write to its log on disk is answered 503 and is not applied, so "ok" always means it survives a restart.
- A 1 s tick runs `engine.tick`; it broadcasts only when something became due.
- Saving is debounced (0.5 s), written through a temp file and a rename.

## Catching up and action times
- Every `state` event also carries `op`: `{ seq, opId, actionType, payload, now, by }`, the action that caused it. A device that applies `op` messages from other devices (the store's `{ type: 'action' }` transport message) stays in step.
- `GET /events?since=N`: a screen that was away gets one `catchup` event `{ ops, serverNow, seq }` with the actions after N (the last 5000 are kept in memory), or a full `snapshot` if the log no longer reaches back that far.
- `POST /action` accepts an optional `at` (the time the device did the action, for example a queued action replayed after being offline). The hub uses `at` only between the time of its last applied action and its own clock, so time never runs backwards or into the future.

## Known limits (prototype)
- Snapshot and `state` events also carry `opIds` (the actions in the recent log). A client that adopts the hub state (store transport message `{ type: 'state', state, opIds }`) treats those as confirmed and replays its own unconfirmed actions on top, so ticket numbers follow the hub's order; `test/hub-sync.test.mjs` checks this after an offline replay. The `opIds` list grows with the log (up to 5000), which is fine for a prototype only.
- No login, no TLS in the hub itself: the password is Caddy's (`setup-server.sh`). Anything that reaches the hub's port directly (a `HOST=0.0.0.0` network, or any program or user on the server itself) can read and change all kitchen data without it.
- Whole state is sent on every change (fine for a small kitchen, not for a big one).
- The opId memory resets on restart.
- Tested only in Node with fake clients (`test/hub.test.mjs`). Not tested with browsers, real Wi-Fi, or a real kitchen.
