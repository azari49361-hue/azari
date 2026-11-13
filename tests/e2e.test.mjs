/**
 * تست سرتاسری محلی: سرور ساختگی Yahoo + تلگرام ساختگی + ریپوی گیت محلی (جای شاخهٔ data).
 * دقیقاً همان دستورهای workflow را اجرا می‌کند: restore-data → engine/run.mjs → publish-data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync, execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { synth } from './helpers.mjs';
import { SYMBOLS } from '../engine/config.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const END = Date.UTC(2026, 10, 11, 15, 0);
const NOW = END + 90_000;

function market() {
  const out = {};
  SYMBOLS.forEach((s, k) => {
    const start = s.code === 'XAUUSD' ? 2650 : s.code === 'BTCUSD' ? 90000 : s.digits === 3 ? 150 : 1.1;
    out[s.code] = synth({ start, sigma: s.minAtr * 1.6, days: 30, endMs: END, seed: 70 + k, crypto: s.cls === 'crypto' });
  });
  return out;
}

function startServers(m) {
  const telegram = [];
  const yahooCalls = [];
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/v8/finance/chart/')) {
      const ysym = decodeURIComponent(url.pathname.split('/').pop());
      yahooCalls.push(ysym);
      const sym = SYMBOLS.find((s) => s.yahoo === ysym);
      const bars = sym ? m[sym.code] : null;
      if (!bars) { res.writeHead(404); return res.end('{}'); }
      const q = { open: bars.map((b) => b.o), high: bars.map((b) => b.h), low: bars.map((b) => b.l), close: bars.map((b) => b.c) };
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ chart: { result: [{ timestamp: bars.map((b) => b.t / 1000), indicators: { quote: [q] } }], error: null } }));
    }
    if (url.pathname.endsWith('/sendMessage')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        telegram.push({ path: url.pathname, ...JSON.parse(body) });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, result: { message_id: 1000 + telegram.length } }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, port: srv.address().port, telegram, yahooCalls })));
}

// async (نه spawnSync): سرور ساختگی در همین پروسه است و باید در حین اجرای فرزند پاسخ بدهد
const sh = (cmd, args, env, cwd = ROOT) =>
  new Promise((ok) =>
    execFile(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60_000 }, (err, stdout, stderr) =>
      ok({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    )
  );

test('زنجیرهٔ کامل workflow: restore → run → publish → اجرای دوم از همان state ادامه می‌دهد', async () => {
  const m = market();
  const { srv, port, telegram } = await startServers(m);
  try {
    const work = mkdtempSync(join(tmpdir(), 'azari-e2e-'));
    const remote = join(work, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    const env = {
      DATA_REMOTE: remote, YAHOO_BASE: `http://127.0.0.1:${port}`, TELEGRAM_API_BASE: `http://127.0.0.1:${port}`,
      TELEGRAM_BOT_TOKEN: '999:TESTSECRET', TELEGRAM_CHANNEL_ID: '@test', AZARI_NOW: String(NOW), STATE_DIR: join(work, 'out'),
    };

    // اجرای اول: شاخهٔ data هنوز نیست
    let r = await sh('bash', ['scripts/restore-data.sh', env.STATE_DIR], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /هنوز وجود ندارد/);
    r = await sh('node', ['engine/run.mjs'], env);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(existsSync(join(env.STATE_DIR, 'state.json')));
    assert.ok(!(r.stdout + r.stderr).includes('TESTSECRET'), 'توکن نباید در لاگ بیاید');
    r = await sh('bash', ['scripts/publish-data.sh', env.STATE_DIR], env);
    assert.equal(r.status, 0, r.stderr);

    const s1 = JSON.parse(readFileSync(join(env.STATE_DIR, 'state.json'), 'utf8'));
    assert.equal(s1.version, 3);
    assert.equal(s1.health.symbolsOk, SYMBOLS.length);
    assert.equal(s1.runs, 1);
    assert.ok(s1.created.length >= 1, 'با این دادهٔ مصنوعی باید حداقل یک سیگنال بسازد');
    assert.ok(telegram.length >= 1 && /سیگنال (خرید|فروش)/.test(telegram[0].text), 'سیگنال باید به تلگرام برود');
    assert.equal(telegram[0].chat_id, '@test');
    const sentFirstRun = telegram.length;

    // شاخهٔ data دقیقاً یک کامیت دارد و state.json داخلش است
    const log = execFileSync('git', ['--git-dir', remote, 'log', '--oneline', 'data'], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(log.length, 1);
    const files = execFileSync('git', ['--git-dir', remote, 'ls-tree', '--name-only', 'data'], { encoding: 'utf8' });
    assert.match(files, /state\.json/);

    // اجرای دوم در یک «ماشین تازه»: restore از شاخهٔ data، سپس run — هیچ پیام تکراری نباید برود
    const env2 = { ...env, STATE_DIR: join(work, 'out2'), AZARI_NOW: String(NOW + 5 * 60_000) };
    r = await sh('bash', ['scripts/restore-data.sh', env2.STATE_DIR], env2);
    assert.match(r.stdout, /بازیابی شد/);
    r = await sh('node', ['engine/run.mjs'], env2);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const s2 = JSON.parse(readFileSync(join(env2.STATE_DIR, 'state.json'), 'utf8'));
    assert.equal(s2.runs, 2);
    assert.equal(s2.signals.length >= s1.signals.length, true);
    assert.equal(telegram.length, sentFirstRun, 'نباید پیام تکراری ارسال شود');
    r = await sh('bash', ['scripts/publish-data.sh', env2.STATE_DIR], env2);
    assert.equal(r.status, 0, r.stderr);
    const log2 = execFileSync('git', ['--git-dir', remote, 'log', '--oneline', 'data'], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(log2.length, 1, 'تاریخچه نباید رشد کند');
  } finally {
    srv.close();
  }
});

test('پیام آزمایشی: SEND_TEST=true پیام می‌فرستد و بدون Secrets خطای روشن می‌دهد', async () => {
  const m = market();
  const { srv, port, telegram } = await startServers(m);
  try {
    const work = mkdtempSync(join(tmpdir(), 'azari-e2e-'));
    const base = { YAHOO_BASE: `http://127.0.0.1:${port}`, TELEGRAM_API_BASE: `http://127.0.0.1:${port}`, AZARI_NOW: String(NOW), STATE_DIR: join(work, 'o'), SEND_TEST: 'true' };
    let r = await sh('node', ['engine/run.mjs'], { ...base, TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHANNEL_ID: '' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Secrets/);
    r = await sh('node', ['engine/run.mjs'], { ...base, TELEGRAM_BOT_TOKEN: '1:abc', TELEGRAM_CHANNEL_ID: '@c' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(telegram.some((t) => /وصل شد/.test(t.text)));
  } finally {
    srv.close();
  }
});
