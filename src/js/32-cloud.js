/*
 * WHAT THIS FILE IS: The link between this page and the hosted Smokebox server (server/cloud.mjs). It is only active when the server
 *    wrote window.SB_CLOUD into the page (the owner signed in on this device); the single offline file never has it and ignores this file.
 *    SB.cloud.transport() is the store transport (see the TRANSPORT INTERFACE in 30-store.js): the live stream brings the kitchen's state,
 *    and every action this device does is pushed to the server, queued while offline and sent again on reconnect.
 * PARTS: the config, connection status, the transport (stream, push), sign-out, the kitchen-switch guard.
 * USES: EventSource and fetch. USED BY: 99-boot.js (starts the store with this transport), 60-shell.js (offline banner), Settings.
 */

(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const cfg = g.SB_CLOUD && typeof g.SB_CLOUD === 'object' && g.SB_CLOUD.kitchen ? g.SB_CLOUD : null;
  const KITCHEN_KEY = 'smokebox.v1.cloudKitchen';
  // Connection status: connected says the live stream is open; downSince is when it was last lost (0 while connected); pushedAt is the
  // last successful send; sendFailSince is when sending first failed (0 once a send gets through). Either one failing counts as down.
  const st = { connected: false, downSince: 0, pushedAt: 0, sendFailSince: 0, listeners: new Set(), retry: null };

  // Marks the link as working (something arrived from the server just now).
  function up() { st.heardAt = Date.now(); if (!st.connected) { st.connected = true; st.downSince = 0; changed(); } }
  // Marks the link as lost, once: the time it went down is kept so the banner waits a few seconds before it speaks.
  function down() { if (st.connected || !st.downSince) { st.connected = false; st.downSince = Date.now(); changed(); } }
  // Tells everyone listening (the banner, Settings) that the connection status changed.
  function changed() { st.listeners.forEach((fn) => { try { fn(status()); } catch (e) { /* a listener must not stop the others */ } }); }
  // The status in plain values: on (signed in to a server), connected, how long it has been down (ms) and how many actions wait to be sent.
  function status() {
    const waiting = SB.store && typeof SB.store.status === 'function' ? (SB.store.status().outbox || 0) : 0;
    const since = Math.min(st.connected || !st.downSince ? Infinity : st.downSince, st.sendFailSince || Infinity);
    return { on: !!cfg, connected: since === Infinity, downMs: since === Infinity ? 0 : Date.now() - since, waiting };
  }
  // Sends the device to the sign-in page (used when the server says this device is signed out).
  function toSignIn() { try { g.location.href = '/login'; } catch (e) { /* not in a browser */ } }

  // Builds the store transport. The stream reconnects by itself (EventSource does); a stream refused because the device was signed out
  // sends the person to sign in. Every push answered by the server (applied or refused) counts as done; no answer means "try later".
  function transport() {
    let deliver = null, es = null, closed = false;
    // Opens the live stream and hands every snapshot and change to the store as its new state.
    function connect() {
      if (closed || typeof g.EventSource !== 'function') return;
      es = new g.EventSource('/api/events');
      // One kitchen state from the server: the store adopts it and replays its own unconfirmed actions on top.
      const onState = (ev) => {
        let d = null; try { d = JSON.parse(ev.data); } catch (e) { d = null; }
        if (!d || !d.state || !deliver) return;
        up();
        deliver({ type: 'state', state: d.state, opIds: d.opIds });
      };
      es.addEventListener('snapshot', onState);
      es.addEventListener('state', onState);
      es.addEventListener('hb', up);
      es.onerror = () => {
        down();
        // A stream that the browser gave up on (signed out, or the server refused it) is checked once: signed out goes to sign-in,
        // anything else tries again in 5 seconds.
        if (es && es.readyState === 2) {
          es = null;
          g.fetch('/api/me', { credentials: 'same-origin' }).then((r) => { if (r.status === 401) toSignIn(); else st.retry = setTimeout(connect, 5000); }, () => { st.retry = setTimeout(connect, 5000); });
        }
      };
    }
    return {
      name: 'cloud',
      // Starts the stream; deliver is how the store hears from the server.
      // WATCH OUT: a quietly dropped connection (Wi-Fi gone, no error) can leave the stream looking open forever. The server sends a
      // heartbeat every 15 seconds, so 40 seconds of silence means the link is dead: it is marked down and opened again.
      open(d) {
        deliver = d; connect();
        st.watch = setInterval(() => { if (es && st.heardAt && Date.now() - st.heardAt > 40000) { down(); es.close(); es = null; st.heardAt = 0; connect(); } }, 5000);
        return true;
      },
      // Messages for other tabs of the same browser are not for the server.
      post() { return true; },
      // Sends the unconfirmed actions in order and returns the ones the server answered.
      async push(entries) {
        const acked = [];
        for (const e of entries) {
          let r;
          // A send that cannot reach the server means the link is down; the store keeps the action and tries again later.
          try { r = await g.fetch('/api/action', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: e.type, payload: e.payload, opId: e.opId, at: e.now, clientId: SB.cloud.deviceId }) }); } catch (er) { if (!st.sendFailSince) { st.sendFailSince = Date.now(); changed(); } throw er; }
          if (r.status === 401) { toSignIn(); throw new Error('signed out'); }
          if (r.status !== 200) break;
          acked.push(e.opId); st.pushedAt = Date.now();
          if (st.sendFailSince) { st.sendFailSince = 0; changed(); }
        }
        return { acked };
      },
      // Closes the live stream for good and stops retrying.
      close() { closed = true; clearTimeout(st.retry); clearInterval(st.watch); if (es) { es.close(); es = null; } },
    };
  }

  // Signs this device out (only this device; the kitchen and the other devices are not touched) and goes to the sign-in page.
  async function signOut() {
    try { await g.fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch (e) { /* signed out locally anyway */ }
    toSignIn();
  }

  // WATCH OUT: one browser can be signed in to a different kitchen later (another account). What this browser kept for the old kitchen
  // (its saved copy and its queue of unsent actions) must never reach the new one, so it is cleared before the store starts.
  function guardKitchen() {
    if (!cfg || !SB.util || !SB.util.storage) return;
    const U = SB.util;
    let prev = null;
    try { prev = U.storage.get(KITCHEN_KEY, null); } catch (e) { prev = null; }
    if (prev && prev !== cfg.kitchen.id) { try { U.storage.remove('smokebox.v1.state'); U.storage.remove('smokebox.v1.outbox'); } catch (e) { /* the server copy wins anyway */ } }
    try { U.storage.set(KITCHEN_KEY, cfg.kitchen.id); } catch (e) { /* private browsing: nothing kept */ }
  }

  // A short random name for this device, kept per browser, so the server's log says which screen did what.
  const deviceId = (() => {
    try { let d = g.localStorage.getItem('smokebox.v1.deviceId'); if (!d) { d = 'd' + Math.random().toString(36).slice(2, 10); g.localStorage.setItem('smokebox.v1.deviceId', d); } return d; } catch (e) { return 'd-anon'; }
  })();

  SB.cloud = {
    on: !!cfg, kitchen: cfg ? cfg.kitchen : null, email: cfg ? cfg.email : null, deviceId,
    transport, status, signOut, guardKitchen,
    // Calls fn whenever the connection status changes; returns a function that stops it.
    onChange(fn) { st.listeners.add(fn); return () => st.listeners.delete(fn); },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
