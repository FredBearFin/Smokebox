// harden.sh and harden-remove.sh against a scratch folder with stand-ins for systemctl, apt-get and caddy (SMOKEBOX_HARDEN_ROOT). NOT a real server: nothing
// here proves fail2ban, a real Caddy log or real bans. Proves the file edits, the validate-then-reload-or-roll-back order, idempotence, the undo, and that
// the fail2ban filter's pattern matches Caddy-style 401 log lines (and only those). Run: node --test --test-force-exit test/harden-scripts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbharden-')), R = path.join(tmp, 'root'), BIN = path.join(tmp, 'bin');
const write = (p, s, mode) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, { mode }); };
const stub = (n, body) => write(path.join(BIN, n), '#!/bin/bash\n' + body + '\n', 0o755);
stub('systemctl', `echo "systemctl $*" >> ${tmp}/calls.log`);
stub('apt-get', `echo "apt-get $*" >> ${tmp}/calls.log`);
stub('chown', `echo "chown $*" >> ${tmp}/calls.log`);
stub('id', '[ "$1" = "-u" ] && echo 0 && exit 0; [ "$1" = caddy ] && exit 0; exit 1');
// A caddy that checks what matters: every site block pulls in the log snippet, the snippet import and file are present, and a flag file makes it refuse.
stub('caddy', `echo "caddy $*" >> ${tmp}/calls.log
[ -f ${tmp}/caddy-refuses ] && exit 1
f=""; while [ $# -gt 0 ]; do [ "$1" = --config ] && f="$2"; shift; done
[ -f "$f" ] || exit 1
if grep -q 'import smokebox_log' "$f"; then
  grep -q '^import /etc/caddy/harden-log.caddy$' "$f" || exit 1
  [ -f ${R}/etc/caddy/harden-log.caddy ] || exit 1
  blocks=$(grep -cE '^[^[:space:]#(}{][^{]*\\{[[:space:]]*$' "$f"); imports=$(grep -c '^[[:space:]]*import smokebox_log' "$f")
  [ "$blocks" -eq "$imports" ] || exit 1
  # like the real Caddy: the snippet must be defined (its file imported) before the first site uses it
  def=$(grep -n '^import /etc/caddy/harden-log.caddy$' "$f" | head -1 | cut -d: -f1); use=$(grep -n 'import smokebox_log' "$f" | head -1 | cut -d: -f1)
  [ "$def" -lt "$use" ] || exit 1
fi
exit 0`);
const run = (script, args = []) => spawnSync('bash', [path.join(ROOT, script), ...args], { env: Object.assign({}, process.env, { PATH: BIN + ':' + process.env.PATH, SMOKEBOX_HARDEN_ROOT: R }), encoding: 'utf8', timeout: 60000 });
const MAIN = '1-2-3-4.sslip.io {\n\tencode gzip\n\tbasic_auth {\n\t\tfreddy $2a$14$abcdefghijklmnopqrstuv\n\t}\n\treverse_proxy 127.0.0.1:8787 {\n\t\tflush_interval -1\n\t}\n}\n';
const BETA = 'beta.1-2-3-4.sslip.io {\n\tbasic_auth {\n\t\tfreddy $2a$14$abcdefghijklmnopqrstuv\n\t}\n\treverse_proxy 127.0.0.1:8788\n}\n';
const OLDUP = 'APT::Periodic::Update-Package-Lists "7";\n';
const files = () => { write(path.join(R, 'etc/apt/apt.conf.d/20auto-upgrades'), OLDUP); write(path.join(R, 'etc/caddy/Caddyfile'), MAIN + '\nimport /etc/caddy/beta.caddy\n'); write(path.join(R, 'etc/caddy/beta.caddy'), BETA); };
const rd = (p) => fs.readFileSync(path.join(R, p), 'utf8');

test('both scripts parse', () => { for (const f of ['harden.sh', 'harden-remove.sh']) assert.equal(spawnSync('bash', ['-n', path.join(ROOT, f)]).status, 0, f); });

test('stops when Caddy is not installed there yet', () => {
  const r = run('harden.sh'); assert.notEqual(r.status, 0); assert.match(r.stderr, /Caddyfile is missing/);
});

test('installs: log snippet, import in every site block (main and beta), jail with a loopback exception, upgrades without reboot, reload after validate', () => {
  files(); const r = run('harden.sh'); assert.equal(r.status, 0, r.stderr + r.stdout);
  const main = rd('etc/caddy/Caddyfile'), beta = rd('etc/caddy/beta.caddy');
  assert.match(main, /1-2-3-4\.sslip\.io \{\n\timport smokebox_log\n/); assert.match(beta, /beta\.1-2-3-4\.sslip\.io \{\n\timport smokebox_log\n/);
  assert.equal((main.match(/import smokebox_log/g) || []).length, 1, 'inner blocks (reverse_proxy, basic_auth) get no import');
  assert.match(main, /^# smokebox-harden\nimport \/etc\/caddy\/harden-log\.caddy\n\n1-2-3-4/, 'the snippet is imported before any site uses it');
  const snip = rd('etc/caddy/harden-log.caddy'); assert.match(snip, /^\(smokebox_log\) \{/); assert.match(snip, /output file \/var\/log\/caddy\/access\.log/); assert.match(snip, /mode 0640/); assert.match(snip, /roll_size 10MiB/); assert.match(snip, /wrap json/); assert.match(snip, /request>uri query \{\s*delete code\s*\}/, 'the beta codes in tablet links are not kept in the log');
  const jail = rd('etc/fail2ban/jail.d/caddy-401.local'); assert.match(jail, /maxretry = 8/); assert.match(jail, /ignoreip = 127\.0\.0\.0\/8 ::1/); assert.match(jail, /logpath  = \/var\/log\/caddy\/access\.log/);
  assert.match(rd('etc/apt/apt.conf.d/20auto-upgrades'), /Unattended-Upgrade "1"/); assert.ok(!/Automatic-Reboot/.test(rd('etc/apt/apt.conf.d/20auto-upgrades')), 'no automatic reboot');
  const calls = fs.readFileSync(path.join(tmp, 'calls.log'), 'utf8'); assert.ok(calls.indexOf('caddy validate') < calls.indexOf('systemctl reload caddy'), 'validated before reload');
  assert.match(calls, /apt-get install -y fail2ban unattended-upgrades/); assert.match(r.stdout, /fail2ban-client status caddy-401/); assert.match(r.stdout, /NOT RUN ON A REAL SERVER/);
  assert.ok(fs.statSync(path.join(R, 'var/log/caddy')).isDirectory());
});

test('the filter pattern matches Caddy 401 lines and nothing else', () => {
  const f = rd('etc/fail2ban/filter.d/caddy-401.conf'); const re = new RegExp(/failregex = (.*)/.exec(f)[1].replace('<HOST>', '(\\d+\\.\\d+\\.\\d+\\.\\d+)'));
  const line = (ip, st) => `{"level":"info","ts":1792770000.5,"logger":"http.log.access.log0","msg":"handled request","request":{"remote_ip":"${ip}","remote_port":"5000","proto":"HTTP/2.0","method":"GET","host":"x","uri":"/","headers":{"User-Agent":["a"]}},"bytes_read":0,"user_id":"","duration":0.0001,"size":0,"status":${st},"resp_headers":{"Www-Authenticate":["Basic"]}}`;
  assert.equal(re.exec(line('203.0.113.9', 401))[1], '203.0.113.9'); assert.equal(re.exec(line('203.0.113.9', 200)), null); assert.equal(re.exec(line('203.0.113.9', 4010)), null); assert.equal(re.exec(line('203.0.113.9', 404)), null);
});

test('a second run changes nothing (one import per block, one snippet line)', () => {
  const before = [rd('etc/caddy/Caddyfile'), rd('etc/caddy/beta.caddy')]; const r = run('harden.sh'); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([rd('etc/caddy/Caddyfile'), rd('etc/caddy/beta.caddy')], before);
});

test('harden-remove.sh puts the Caddy files back byte for byte and removes the jail, filter and upgrade file', () => {
  const r = run('harden-remove.sh'); assert.equal(r.status, 0, r.stderr);
  assert.equal(rd('etc/caddy/Caddyfile'), MAIN + '\nimport /etc/caddy/beta.caddy\n'); assert.equal(rd('etc/caddy/beta.caddy'), BETA);
  for (const p of ['etc/caddy/harden-log.caddy', 'etc/fail2ban/jail.d/caddy-401.local', 'etc/fail2ban/filter.d/caddy-401.conf']) assert.ok(!fs.existsSync(path.join(R, p)), p);
  assert.equal(rd('etc/apt/apt.conf.d/20auto-upgrades'), OLDUP, 'the system\'s own upgrade settings are back');
  assert.equal(run('harden-remove.sh').status, 0, 'removing twice is fine');
});

test('if Caddy refuses the log settings: Caddy files restored, jail and filter removed, non-zero exit', () => {
  files(); fs.writeFileSync(path.join(tmp, 'caddy-refuses'), '');
  const r = run('harden.sh'); assert.notEqual(r.status, 0); assert.match(r.stderr, /did not accept/);
  assert.equal(rd('etc/caddy/Caddyfile'), MAIN + '\nimport /etc/caddy/beta.caddy\n'); assert.equal(rd('etc/caddy/beta.caddy'), BETA);
  for (const p of ['etc/caddy/harden-log.caddy', 'etc/fail2ban/jail.d/caddy-401.local', 'etc/fail2ban/filter.d/caddy-401.conf']) assert.ok(!fs.existsSync(path.join(R, p)), p + ' removed');
  assert.ok(!/systemctl restart fail2ban/.test(fs.readFileSync(path.join(tmp, 'calls.log'), 'utf8').split('caddy-refuses')[0] && ''), 'n/a'); fs.rmSync(path.join(tmp, 'caddy-refuses'));
});

// Runs keep_imports from server/setup-server.sh on its own (the rest of that script installs packages and cannot run here).
const keepImports = (oldText, newText) => {
  const src = fs.readFileSync(path.join(ROOT, 'server/setup-server.sh'), 'utf8');
  const fn = /\nkeep_imports\(\) \{\n[\s\S]*?\n\}\n/.exec(src)[0];
  const d = fs.mkdtempSync(path.join(tmp, 'keep-')), o = path.join(d, 'old'), n = path.join(d, 'new');
  fs.writeFileSync(o, oldText); fs.writeFileSync(n, newText);
  const r = spawnSync('bash', ['-c', 'set -euo pipefail\n' + fn + '\nkeep_imports "$1" "$2"', 'x', o, n], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return fs.readFileSync(n, 'utf8');
};

test('re-running the installer keeps the beta site and the hardening log in the rewritten Caddy file', () => {
  files(); assert.equal(run('harden.sh').status, 0);
  const hardened = rd('etc/caddy/Caddyfile');
  // the installer's fresh site (a new password hash) must come out exactly like the hardened file, apart from the hash
  const fresh = MAIN.replace('abcdefghijklmnopqrstuv', 'NEWHASHnewhashNEWHASHx');
  assert.equal(keepImports(hardened, fresh), hardened.replace('abcdefghijklmnopqrstuv', 'NEWHASHnewhashNEWHASHx'));
  assert.equal(keepImports(MAIN + '\nimport /etc/caddy/beta.caddy\n', fresh), fresh + '\nimport /etc/caddy/beta.caddy\n', 'beta only');
  assert.equal(keepImports(MAIN, fresh), fresh, 'nothing extra: the plain site');
  const src = fs.readFileSync(path.join(ROOT, 'server/setup-server.sh'), 'utf8');
  assert.match(src, /caddy validate --config "\$CADDYFILE\.setup"/, 'the kept version is checked by Caddy before it replaces the file');
  assert.match(src, /printf '%s\\n' "\$PASS" \| caddy hash-password/, 'the password goes to Caddy on its input first');
  assert.equal(run('harden-remove.sh').status, 0);
});

test('tunnel.sh finds the site name even when harden.sh put its import lines at the top', () => {
  const awkProg = /DOMAIN="\$\(awk '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'tunnel.sh'), 'utf8'))[1];
  const f = path.join(tmp, 'tunnel-caddy'); fs.writeFileSync(f, '# smokebox-harden\nimport /etc/caddy/harden-log.caddy\n\n' + MAIN + '\nimport /etc/caddy/beta.caddy\n');
  assert.equal(spawnSync('awk', [awkProg, f], { encoding: 'utf8' }).stdout.trim(), '1-2-3-4.sslip.io');
});
