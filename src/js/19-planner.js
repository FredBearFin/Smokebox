/*
 * WHAT THIS FILE IS: SB.planner, the bridge to the Rust kitchen engine (engine/, bytes in 18-engine-wasm.js). The engine
 *    plans every open ticket across the whole kitchen, knowing how many dishes each station can cook at once.
 * PARTS: start the engine (async in a browser, which may not compile it on the spot; at once in Node), plan(input).
 * USES: SB.engineWasm. USED BY: 20-engine.js (ticket plans and re-plans), the servers, tests.
 * WATCH OUT: plan() returns null until the engine has started; callers must then use their own plan, and the boot waits
 *    for start() before the kitchen opens, so a working tablet always plans with the engine.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  let ex = null;
  const enc = typeof TextEncoder === 'function' ? new TextEncoder() : null, dec = typeof TextDecoder === 'function' ? new TextDecoder() : null;

  // The engine's bytes, decoded from base64 (atob in a browser, Buffer in Node).
  function bytes() {
    const b64 = SB.engineWasm && SB.engineWasm.base64;
    if (!b64) return null;
    if (typeof g.Buffer === 'function') return new Uint8Array(g.Buffer.from(b64, 'base64'));
    const s = g.atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  // Keeps the engine's three entry points once it is running.
  function keep(instance) { ex = instance.exports; return true; }

  // Sends one JSON request into the engine and reads the JSON answer, freeing both buffers.
  function call(fn, obj) {
    const inBytes = enc.encode(JSON.stringify(obj));
    const ip = ex.sb_alloc(inBytes.length);
    new Uint8Array(ex.memory.buffer, ip, inBytes.length).set(inBytes);
    const r = ex[fn](ip, inBytes.length);
    ex.sb_free(ip, inBytes.length);
    // The answer comes back as one 64-bit number: where it is (high half) and how long (low half).
    const big = BigInt.asUintN(64, BigInt(r)), op = Number(big >> 32n), ol = Number(big & 0xffffffffn);
    const text = dec.decode(new Uint8Array(ex.memory.buffer, op, ol));
    ex.sb_free(op, ol);
    return JSON.parse(text);
  }

  SB.planner = {
    // True once the engine is running.
    ready: () => !!ex,
    // Starts the engine at once (Node, tests and the servers). Returns false when there are no bytes or no WebAssembly.
    startSync() {
      if (ex) return true;
      const b = bytes();
      if (!b || typeof WebAssembly !== 'object' || !enc) return false;
      return keep(new WebAssembly.Instance(new WebAssembly.Module(b), {}));
    },
    // Starts the engine without blocking the page (a browser will not compile a large module on the spot). Resolves true or false.
    start() {
      if (ex) return Promise.resolve(true);
      const b = bytes();
      if (!b || typeof WebAssembly !== 'object' || !enc) return Promise.resolve(false);
      return WebAssembly.instantiate(b, {}).then((r) => keep(r.instance), () => false);
    },
    // Plans the whole kitchen: input { now, stations:[{id, capacity}], tickets:[{id, createdAt, paced, items:[...]}] }.
    // Returns { items:[{ticketId, id, fireAt, held, freeAt}] }, or null when the engine is not running or refused the input.
    plan(input) {
      if (!ex) return null;
      try { const out = call('sb_plan', input); return out && Array.isArray(out.items) ? out : null; } catch (e) { return null; }
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
