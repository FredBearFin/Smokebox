// Tests for server/smokebox-update.sh: the nightly updater must refuse bad downloads, keep the running version when anything is wrong,
// and put the old build back when the new one does not answer. Runs the real script against a temp folder with a fake systemctl.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'server/smokebox-update.sh');
const have = (cmd) => spawnSync('bash', ['-c', 'command -v ' + cmd]).status === 0;
const skip = !have('flock') || !have('tar') || !have('curl') ? 'needs flock, tar and curl' : false;

// Builds a folder like a release: marker file says which version it is.
function makeTree(dir, marker, { server = 'console.log("hi");\n', html = 'x'.repeat(200000), engine = '//e\n', extra } = {}) {
  fs.mkdirSync(path.join(dir, 'server'), { recursive: true }); fs.mkdirSync(path.join(dir, 'dist'), { recursive: true }); fs.mkdirSync(path.join(dir, 'src/js'), { recursive: true });
  if (server !== null) fs.writeFileSync(path.join(dir, 'server/server.mjs'), server);
  fs.writeFileSync(path.join(dir, 'server/smokebox-update.sh'), '#!/bin/bash\n# marker ' + marker + '\n');
  fs.writeFileSync(path.join(dir, 'dist/smokebox.html'), html);
  fs.writeFileSync(path.join(dir, 'src/js/20-engine.js'), engine);
  fs.writeFileSync(path.join(dir, 'MARKER'), marker);
  if (extra) extra(dir);
}
function tarball(tmp, name, mk) {
  const src = path.join(tmp, name + '-src'); fs.mkdirSync(path.join(src, 'Repo-deploy'), { recursive: true });
  mk(path.join(src, 'Repo-deploy'));
  const out = path.join(tmp, name + '.tgz');
  execFileSync('tar', ['-czf', out, '-C', src, 'Repo-deploy']);
  return out;
}
function setup(label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbupd-' + label + '-'));
  const prefix = path.join(tmp, 'opt-smokebox');
  makeTree(prefix, 'OLD');
  const fakeSystemctl = path.join(tmp, 'systemctl'); const log = path.join(tmp, 'systemctl.log');
  fs.writeFileSync(fakeSystemctl, '#!/bin/bash\necho "$@" >> ' + log + '\n');
  fs.chmodSync(fakeSystemctl, 0o755);
  return { tmp, prefix, log, fakeSystemctl };
}
// Runs fn(port) while a stand-in health page answers 200 (ok true), 500 (ok false), or 200 with the given body (ok a string).
async function withHealth(ok, fn) {
  const srv = http.createServer((req, res) => { res.statusCode = ok ? 200 : 500; res.end(typeof ok === 'string' ? ok : 'x'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(srv.address().port); } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
}
// Runs the script without blocking this process (the health check talks to a server in this very process).
function run(env, extra = {}) {
  return new Promise((resolve) => {
    const p = spawn('bash', [SCRIPT], { env: Object.assign({}, process.env, { SMOKEBOX_HEALTH_TRIES: '3', SMOKEBOX_MIN_BYTES: '300' }, env, extra) });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d)); p.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => p.kill('SIGKILL'), 60000);
    p.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}
const marker = (prefix) => (fs.existsSync(path.join(prefix, 'MARKER')) ? fs.readFileSync(path.join(prefix, 'MARKER'), 'utf8') : null);

test('a good update swaps the build, restarts the service, keeps the old one and refreshes the updater', { skip }, async () => {
  const t = setup('good');
  const tgz = tarball(t.tmp, 'good', (d) => makeTree(d, 'NEW'));
  const self = path.join(t.tmp, 'bin-smokebox-update');
  await withHealth(true, async (port) => {
    const r = await run({ SMOKEBOX_PREFIX: t.prefix, SMOKEBOX_UPDATE_URL: 'file://' + tgz, SMOKEBOX_SYSTEMCTL: t.fakeSystemctl, SMOKEBOX_HEALTH_URL: 'http://127.0.0.1:' + port + '/', SMOKEBOX_SELF_DEST: self, SMOKEBOX_LOCK: path.join(t.tmp, 'lock') });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
  assert.equal(marker(t.prefix), 'NEW');
  assert.equal(marker(t.prefix + '.old'), 'OLD');
  assert.match(fs.readFileSync(t.log, 'utf8'), /restart smokebox/);
  assert.match(fs.readFileSync(self, 'utf8'), /marker NEW/, 'the updater copied itself from the new build');
});

for (const [name, mk, why] of [
  ['an empty download', null, 'empty'],
  ['a tiny archive (an error page)', (d) => { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'a'), 'x'); }, 'bytes'],
  ['a build with no server file', (d) => makeTree(d, 'NEW', { server: null }), 'no server/server.mjs'],
  ['a build whose server file does not parse', (d) => makeTree(d, 'NEW', { server: 'this is ( not javascript' }), 'does not parse'],
  ['a build with a tiny page', (d) => makeTree(d, 'NEW', { html: 'x' }), 'page is only'],
  ['an archive with a symbolic link', (d) => makeTree(d, 'NEW', { extra: (dir) => fs.symlinkSync('/etc/passwd', path.join(dir, 'link')) }), 'links'],
]) {
  test('refuses ' + name + ' and keeps the running version', { skip }, async () => {
    const t = setup('bad');
    let tgz;
    if (mk === null) { tgz = path.join(t.tmp, 'empty.tgz'); fs.writeFileSync(tgz, ''); } else tgz = tarball(t.tmp, 'bad', mk);
    const r = await run({ SMOKEBOX_PREFIX: t.prefix, SMOKEBOX_UPDATE_URL: 'file://' + tgz, SMOKEBOX_SYSTEMCTL: t.fakeSystemctl, SMOKEBOX_LOCK: path.join(t.tmp, 'lock'), SMOKEBOX_MIN_BYTES: name.includes('tiny archive') ? '100000' : '300' });
    assert.notEqual(r.status, 0, 'must fail: ' + r.stdout);
    assert.equal(marker(t.prefix), 'OLD', 'running version kept (' + why + ')');
    assert.ok(!fs.existsSync(t.log), 'the service was not restarted');
    assert.ok(!fs.existsSync(t.prefix + '.new'), 'no half-unpacked folder is left behind');
  });
}

test('refuses an archive with a ".." path (written with a raw tar header, as an attacker would)', { skip }, async () => {
  const t = setup('dots');
  const src = path.join(t.tmp, 'src'); fs.mkdirSync(path.join(src, 'Repo-deploy'), { recursive: true }); makeTree(path.join(src, 'Repo-deploy'), 'NEW');
  const tgz = path.join(t.tmp, 'dots.tgz');
  // --transform puts a ../ in front of one member's name
  execFileSync('tar', ['-czf', tgz, '-C', src, '--transform', 's,^Repo-deploy/MARKER$,Repo-deploy/../MARKER,', 'Repo-deploy']);
  const r = await run({ SMOKEBOX_PREFIX: t.prefix, SMOKEBOX_UPDATE_URL: 'file://' + tgz, SMOKEBOX_SYSTEMCTL: t.fakeSystemctl, SMOKEBOX_LOCK: path.join(t.tmp, 'lock') });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.equal(marker(t.prefix), 'OLD');
  assert.ok(!fs.existsSync(path.join(t.tmp, 'MARKER')), 'nothing was written outside the folder');
});

test('a new build that does not answer is rolled back to the old build and the service is restarted again', { skip }, async () => {
  const t = setup('roll');
  const tgz = tarball(t.tmp, 'roll', (d) => makeTree(d, 'NEW'));
  await withHealth(false, async (port) => {
    const r = await run({ SMOKEBOX_PREFIX: t.prefix, SMOKEBOX_UPDATE_URL: 'file://' + tgz, SMOKEBOX_SYSTEMCTL: t.fakeSystemctl, SMOKEBOX_HEALTH_URL: 'http://127.0.0.1:' + port + '/', SMOKEBOX_LOCK: path.join(t.tmp, 'lock') });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /putting the previous version back/);
  });
  assert.equal(marker(t.prefix), 'OLD', 'the old build is back');
  assert.deepEqual(fs.readFileSync(t.log, 'utf8').trim().split('\n'), ['restart smokebox', 'stop smokebox', 'restart smokebox'], 'restarted for the new build, stopped, and restarted after the rollback');
});

// A saved file beside the build, and the env that points the updater at it.
function withData(t, text) { const f = path.join(t.tmp, 'data', 'state.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; }

test('a new build that answers but had to set the saved file aside (dataProblem in /health) is rolled back and the saved file is put back', { skip }, async () => {
  const t = setup('dataproblem');
  const tgz = tarball(t.tmp, 'dp', (d) => makeTree(d, 'NEW'));
  const file = withData(t, '{"kitchen":"real"}');
  // what the new build would do: set the file aside and start empty (stood in for by the fake systemctl on its first restart)
  fs.writeFileSync(t.fakeSystemctl, `#!/bin/bash\necho "$@" >> ${t.log}\nif [ "$*" = "restart smokebox" ] && [ ! -f ${t.tmp}/once ]; then touch ${t.tmp}/once; mv ${file} ${file}.bad-1; echo '{"empty":true}' > ${file}; fi\n`);
  await withHealth('{"ok":true,"seq":0,"dataProblem":"The saved file was not a valid kitchen (state.json.bad-1)"}', async (port) => {
    const r = await run({ SMOKEBOX_PREFIX: t.prefix, SMOKEBOX_UPDATE_URL: 'file://' + tgz, SMOKEBOX_SYSTEMCTL: t.fakeSystemctl, SMOKEBOX_HEALTH_URL: 'http://127.0.0.1:' + port + '/health', SMOKEBOX_LOCK: path.join(t.tmp, 'lock'), SMOKEBOX_DATA_FILE: file });
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /could not read the saved data/);
  });
  assert.equal(marker(t.prefix), 'OLD', 'the old build is back');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"kitchen":"real"}', 'the old build starts on the kitchen\'s data, not the empty file');
  const kept = fs.readdirSync(path.dirname(file));
  assert.ok(kept.some((f) => f.startsWith('state.json.from-new-build-')) && kept.includes('state.json.bad-1'), 'nothing was deleted: ' + kept);
});

test('a new build that rewrote the saved file and then failed is rolled back with the file from before the update (the newer one kept beside it)', { skip }, async () => {
  const t = setup('newer');
  const tgz = tarball(t.tmp, 'nw', (d) => makeTree(d, 'NEW'));
  const file = withData(t, '{"v":1}');
  fs.writeFileSync(t.fakeSystemctl, `#!/bin/bash\necho "$@" >> ${t.log}\nif [ "$*" = "restart smokebox" ] && [ ! -f ${t.tmp}/once ]; then touch ${t.tmp}/once; echo '{"v":2}' > ${file}; fi\n`);
  await withHealth(false, async (port) => {
    const r = await run({ SMOKEBOX_PREFIX: t.prefix, SMOKEBOX_UPDATE_URL: 'file://' + tgz, SMOKEBOX_SYSTEMCTL: t.fakeSystemctl, SMOKEBOX_HEALTH_URL: 'http://127.0.0.1:' + port + '/health', SMOKEBOX_LOCK: path.join(t.tmp, 'lock'), SMOKEBOX_DATA_FILE: file });
    assert.notEqual(r.status, 0);
  });
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}', 'the old build gets a file it can read, so it does not refuse to start');
  const newer = fs.readdirSync(path.dirname(file)).find((f) => f.startsWith('state.json.from-new-build-'));
  assert.equal(fs.readFileSync(path.join(path.dirname(file), newer), 'utf8').trim(), '{"v":2}');
});

test('a good update leaves the saved file alone (a copy is kept as .before-update)', { skip }, async () => {
  const t = setup('keepdata');
  const tgz = tarball(t.tmp, 'kd', (d) => makeTree(d, 'NEW'));
  const file = withData(t, '{"kitchen":"real"}');
  await withHealth('{"ok":true,"seq":4}', async (port) => {
    const r = await run({ SMOKEBOX_PREFIX: t.prefix, SMOKEBOX_UPDATE_URL: 'file://' + tgz, SMOKEBOX_SYSTEMCTL: t.fakeSystemctl, SMOKEBOX_HEALTH_URL: 'http://127.0.0.1:' + port + '/health', SMOKEBOX_SELF_DEST: path.join(t.tmp, 'self'), SMOKEBOX_LOCK: path.join(t.tmp, 'lock'), SMOKEBOX_DATA_FILE: file });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
  assert.equal(marker(t.prefix), 'NEW');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"kitchen":"real"}');
  assert.equal(fs.readFileSync(file + '.before-update', 'utf8'), '{"kitchen":"real"}');
});

test('the beta\'s nightly update names its own saved file, so a rollback there never touches the real kitchen\'s file', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'beta.sh'), 'utf8'), /export SMOKEBOX_DATA_FILE=\$DATA\/state\.json /);
  assert.match(fs.readFileSync(SCRIPT, 'utf8'), /if \[ -z "\$DATA" \] && \[ -z "\$\{SMOKEBOX_PREFIX:-\}" \]; then DATA=\/var\/lib\/smokebox\/state\.json; fi/);
});

test('a second update while one is running does nothing', { skip }, async () => {
  const t = setup('lock');
  const lock = path.join(t.tmp, 'lock');
  const tgz = tarball(t.tmp, 'lock', (d) => makeTree(d, 'NEW'));
  const holder = spawnSync('bash', ['-c', `exec 9>${lock}; flock -n 9; SMOKEBOX_PREFIX=${t.prefix} SMOKEBOX_UPDATE_URL=file://${tgz} SMOKEBOX_SYSTEMCTL=${t.fakeSystemctl} SMOKEBOX_LOCK=${lock} bash ${SCRIPT} 9>&-`], { encoding: 'utf8', timeout: 30000, env: Object.assign({}, process.env, { SMOKEBOX_MIN_BYTES: '300' }) });
  // The script opens the same lock file itself; while the outer shell holds it, the inner run must exit 0 without changing anything.
  assert.equal(holder.status, 0, holder.stdout + holder.stderr);
  assert.match(holder.stdout, /another update is running/);
  assert.equal(marker(t.prefix), 'OLD');
});

test('the install scripts parse and refuse short passwords', { skip: !have('bash') }, () => {
  for (const f of ['go.sh', 'server/setup-server.sh', 'tunnel.sh', 'server/smokebox-update.sh']) assert.equal(spawnSync('bash', ['-n', path.join(ROOT, f)]).status, 0, f + ' parses');
  // Runs as non-root: setup-server stops at the password check or the root check, never installing anything.
  const r = spawnSync('bash', [path.join(ROOT, 'server/setup-server.sh'), 'America/New_York', 'freddy', 'short'], { encoding: 'utf8', timeout: 20000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /at least 8 characters/);
});

/* ---- the real deploy download: what GitHub's branch archive contains (git archive honors the same .gitattributes export-ignore rules) ---- */

const haveGit = have('git') && fs.existsSync(path.join(ROOT, '.git'));
function realExport(tmp) {
  const tgz = path.join(tmp, 'real.tgz');
  const out = execFileSync('git', ['-C', ROOT, 'archive', '--worktree-attributes', '--format=tar.gz', '--prefix=SmokeBoxKDS-deploy/', 'HEAD'], { maxBuffer: 1 << 30 });
  fs.writeFileSync(tgz, out);
  return tgz;
}

test('the real deploy archive is small and holds exactly what the server needs (no tests, docs, tools or screenshots)', { skip: !haveGit }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbexp-'));
  const tgz = realExport(tmp);
  const size = fs.statSync(tgz).size;
  assert.ok(size < 10 * 1024 * 1024, 'the archive is ' + Math.round(size / 1e6) + ' MB; it should be a few MB at most');
  const names = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean);
  for (const need of ['server/server.mjs', 'server/setup-server.sh', 'server/smokebox-update.sh', 'dist/smokebox.html', 'src/js/00-util.js', 'src/js/10-config.js', 'src/js/20-engine.js', 'go.sh', 'tunnel.sh']) assert.ok(names.includes('SmokeBoxKDS-deploy/' + need), 'missing ' + need);
  for (const bad of ['test/', 'docs/', 'tools/', 'ux-scripts/', 'reference/', '.github/', 'dist/integ.html', 'dist/qa.html']) assert.ok(!names.some((n) => n.startsWith('SmokeBoxKDS-deploy/' + bad)), 'should be left out: ' + bad);
});

test('the server starts from the extracted deploy archive and serves the page', { skip: !haveGit }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbexp-'));
  const tgz = realExport(tmp);
  execFileSync('tar', ['-xzf', tgz, '-C', tmp]);
  const dir = path.join(tmp, 'SmokeBoxKDS-deploy');
  const child = spawn(process.execPath, [path.join(dir, 'server/server.mjs')], { env: Object.assign({}, process.env, { PORT: '0', HOST: '127.0.0.1' }) });
  let log = '';
  child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  try {
    let port = 0;
    for (let i = 0; i < 100 && !port; i++) { const m = /127\.0\.0\.1:(\d+)/.exec(log); if (m && Number(m[1]) > 0) port = Number(m[1]); else await new Promise((r) => setTimeout(r, 100)); }
    assert.ok(port, 'the hub printed its address: ' + log);
    const body = await new Promise((resolve, reject) => http.get({ port, host: '127.0.0.1', path: '/' }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(c) })); }).on('error', reject));
    assert.equal(body.status, 200);
    assert.ok(body.buf.equals(fs.readFileSync(path.join(dir, 'dist/smokebox.html'))), 'the page served is dist/smokebox.html');
  } finally { child.kill(); }
});

test('the updater accepts the real (small) deploy archive with its default size limits', { skip: skip || !haveGit }, async () => {
  const t = setup('real');
  const tgz = realExport(t.tmp);
  await withHealth(true, async (port) => {
    const r = await run({ SMOKEBOX_PREFIX: t.prefix, SMOKEBOX_UPDATE_URL: 'file://' + tgz, SMOKEBOX_SYSTEMCTL: t.fakeSystemctl, SMOKEBOX_HEALTH_URL: 'http://127.0.0.1:' + port + '/', SMOKEBOX_SELF_DEST: path.join(t.tmp, 'self'), SMOKEBOX_LOCK: path.join(t.tmp, 'lock') }, { SMOKEBOX_MIN_BYTES: '100000' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
  assert.ok(fs.existsSync(path.join(t.prefix, 'server/server.mjs')) && marker(t.prefix) === null, 'the new build replaced the old one');
  assert.equal(marker(t.prefix + '.old'), 'OLD');
});

// ---- integrity: optional signature, pinned reference, special files, update time zone ----
const haveSsl = spawnSync('bash', ['-c', 'openssl version | grep -q "OpenSSL 3"']).status === 0;
function keys(tmp, name = 'k') {
  const priv = path.join(tmp, name + '.pem'), pub = path.join(tmp, name + '-pub.pem');
  execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', priv], { stdio: 'pipe' }); execFileSync('openssl', ['pkey', '-in', priv, '-pubout', '-out', pub], { stdio: 'pipe' });
  return { priv, pub };
}
const SIGN = path.join(ROOT, 'tools/sign-deploy.sh');
const signedTarball = (t, name, key, { tamper, drop, extra } = {}) => tarball(t.tmp, name, (d) => { makeTree(d, 'NEW'); execFileSync('bash', [SIGN, key.priv, d], { stdio: 'pipe' }); if (tamper) fs.appendFileSync(path.join(d, 'src/js/20-engine.js'), '// tampered\n'); if (extra) fs.writeFileSync(path.join(d, 'server/extra.mjs'), 'x'); if (drop) fs.rmSync(path.join(d, 'deploy.manifest.sig')); });
const runWith = (t, tgz, port, env = {}) => run(Object.assign({ SMOKEBOX_PREFIX: t.prefix, SMOKEBOX_UPDATE_URL: 'file://' + tgz, SMOKEBOX_SYSTEMCTL: t.fakeSystemctl, SMOKEBOX_HEALTH_URL: 'http://127.0.0.1:' + port + '/health', SMOKEBOX_SELF_DEST: path.join(t.tmp, 'self'), SMOKEBOX_LOCK: path.join(t.tmp, 'lock') }, env));

test('no public key installed: the update goes ahead and the log says loudly that nothing is verified', { skip }, async () => {
  const t = setup('nosig'); const tgz = tarball(t.tmp, 'u', (d) => makeTree(d, 'NEW'));
  await withHealth(true, async (port) => { const r = await runWith(t, tgz, port, { SMOKEBOX_PUBKEY: path.join(t.tmp, 'absent') }); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /WARNING: updates are NOT verified/); assert.equal(marker(t.prefix), 'NEW'); });
});
test('public key installed and a correct signature: the update goes ahead', { skip: skip || !haveSsl }, async () => {
  const t = setup('sig-ok'); const key = keys(t.tmp); const tgz = signedTarball(t, 'u', key);
  await withHealth(true, async (port) => { const r = await runWith(t, tgz, port, { SMOKEBOX_PUBKEY: key.pub }); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /signature OK/); assert.equal(marker(t.prefix), 'NEW'); });
});
for (const [label, mk, re] of [
  ['a file changed after signing', (t, k) => signedTarball(t, 'u', k, { tamper: true }), /does not match the signed list|signature/],
  ['a file added that is not on the signed list', (t, k) => signedTarball(t, 'u', k, { extra: true }), /not on the signed list/],
  ['the signature file is missing', (t, k) => signedTarball(t, 'u', k, { drop: true }), /not signed/],
  ['an unsigned build', (t) => tarball(t.tmp, 'u', (d) => makeTree(d, 'NEW')), /not signed/],
  ['signed with a different key', (t) => signedTarball(t, 'u', keys(t.tmp, 'other')), /signature does not match/],
]) {
  test('public key installed, ' + label + ': refused, the running version is kept', { skip: skip || !haveSsl }, async () => {
    const t = setup('sig-bad'); const key = keys(t.tmp); const tgz = mk(t, key);
    await withHealth(true, async (port) => { const r = await runWith(t, tgz, port, { SMOKEBOX_PUBKEY: key.pub }); assert.notEqual(r.status, 0); assert.match(r.stdout, re); assert.equal(marker(t.prefix), 'OLD'); assert.ok(!fs.existsSync(t.prefix + '.old'), 'nothing was swapped'); });
  });
}

test('an archive with a FIFO or a device file is refused (only plain files and folders are allowed)', { skip }, async () => {
  const t = setup('fifo'); const tgz = tarball(t.tmp, 'u', (d) => { makeTree(d, 'NEW'); execFileSync('mkfifo', [path.join(d, 'pipe')]); });
  await withHealth(true, async (port) => { const r = await runWith(t, tgz, port); assert.notEqual(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /special files/); assert.equal(marker(t.prefix), 'OLD'); });
});

test('SMOKEBOX_UPDATE_REF pins a tag or a commit: the download address is built from it, bad values are refused', { skip }, async () => {
  const t = setup('ref'); const tgz = tarball(t.tmp, 'u', (d) => makeTree(d, 'NEW'));
  const fakeBin = path.join(t.tmp, 'bin'); fs.mkdirSync(fakeBin); const seen = path.join(t.tmp, 'curl.log');
  fs.writeFileSync(path.join(fakeBin, 'curl'), `#!/bin/bash\nfor a in "$@"; do case "$a" in http*) echo "$a" >> ${seen};; esac; done\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && cp ${tgz} "$2"; shift; done\nexit 0\n`, { mode: 0o755 });
  await withHealth(true, async (port) => {
    const env = { PATH: fakeBin + ':' + process.env.PATH };
    // curl is faked for the download; the health check talks to the real server, so give it a second fake path through the same stub
    fs.writeFileSync(path.join(fakeBin, 'curl'), `#!/bin/bash\nurl=""; out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; http*) url="$1";; esac; shift; done\necho "$url" >> ${seen}\ncase "$url" in *github.com*) cp ${tgz} "$out";; *) /usr/bin/curl -sS --max-time 3 "$url" ${'${out:+-o "$out"}'};; esac\n`, { mode: 0o755 });
    let r = await run({ SMOKEBOX_PREFIX: t.prefix, SMOKEBOX_SYSTEMCTL: t.fakeSystemctl, SMOKEBOX_HEALTH_URL: 'http://127.0.0.1:' + port + '/health', SMOKEBOX_SELF_DEST: path.join(t.tmp, 'self'), SMOKEBOX_LOCK: path.join(t.tmp, 'lock'), SMOKEBOX_PUBKEY: path.join(t.tmp, 'absent'), SMOKEBOX_UPDATE_REF: 'v1.2.3' }, env);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /pinned to v1.2.3/);
    assert.match(fs.readFileSync(seen, 'utf8'), /archive\/refs\/tags\/v1\.2\.3\.tar\.gz/);
    const sha = 'a'.repeat(40); fs.writeFileSync(seen, '');
    const t2 = setup('ref2'); r = await run({ SMOKEBOX_PREFIX: t2.prefix, SMOKEBOX_SYSTEMCTL: t2.fakeSystemctl, SMOKEBOX_HEALTH_URL: 'http://127.0.0.1:' + port + '/health', SMOKEBOX_SELF_DEST: path.join(t2.tmp, 'self'), SMOKEBOX_LOCK: path.join(t2.tmp, 'lock'), SMOKEBOX_PUBKEY: path.join(t.tmp, 'absent'), SMOKEBOX_UPDATE_REF: sha }, env);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(fs.readFileSync(seen, 'utf8'), new RegExp('archive/' + sha + '\\.tar\\.gz'));
    const t3 = setup('ref3'); r = await run({ SMOKEBOX_PREFIX: t3.prefix, SMOKEBOX_SYSTEMCTL: t3.fakeSystemctl, SMOKEBOX_LOCK: path.join(t3.tmp, 'lock'), SMOKEBOX_UPDATE_REF: '../../evil' }, env);
    assert.notEqual(r.status, 0); assert.match(r.stdout, /not allowed/); assert.equal(marker(t3.prefix), 'OLD');
  });
});

test('the install scripts put the zone in the update times, and refuse an unknown zone', () => {
  const go = fs.readFileSync(path.join(ROOT, 'go.sh'), 'utf8'), beta = fs.readFileSync(path.join(ROOT, 'beta.sh'), 'utf8');
  assert.match(go, /OnCalendar=\*-\*-\* 04:30:00 \$\{TZNAME\}/); assert.match(go, /smokebox-update\.timer <<EOF/); assert.match(go, /zoneinfo\/\$TZNAME/);
  assert.match(beta, /OnCalendar=\*-\*-\* 04:50:00 \$TZNAME/); assert.match(beta, /beta-update\.timer <<EOF/);
  const r = spawnSync('bash', ['-c', 'cd /tmp && bash ' + path.join(ROOT, 'go.sh') + ' u pw Nowhere/Bogus 2>&1'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);   // not root, or unknown zone: it must stop before downloading anything
});
