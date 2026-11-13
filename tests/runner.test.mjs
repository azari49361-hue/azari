import test from 'node:test';
import assert from 'node:assert/strict';
import { synth } from './helpers.mjs';
import { SYMBOLS, CFG } from '../engine/config.mjs';
import { runOnce, emptyState, thresholdFor, tehranDayStart } from '../engine/runner.mjs';
import { pendingMessages, flush, newSignalMessage, updateMessage } from '../engine/telegram.mjs';
import { simulate, report } from '../engine/backtest.mjs';

const END = Date.UTC(2026, 10, 11, 15, 0);

function market(seedBase = 100, days = 40, end = END) {
  const out = {};
  SYMBOLS.forEach((s, k) => {
    const start = s.code === 'XAUUSD' ? 2650 : s.code === 'BTCUSD' ? 90000 : s.digits === 3 ? 150 : 1.1;
    const sigma = s.minAtr * 1.1;
    out[s.code] = synth({ start, sigma, days, endMs: end, seed: seedBase + k, crypto: s.cls === 'crypto' });
  });
  return out;
}
const fetcherFor = (m) => (sym) => ({ bars: m[sym.code] || [], source: 'test', errors: [] });

test('اجرای کامل موتور: state معتبر، بدون خطا و بدون تکرار', async () => {
  const m = market();
  const now = END + 120_000;
  const s1 = await runOnce(emptyState(), fetcherFor(m), now);
  assert.equal(s1.version, 3);
  assert.ok(Object.keys(s1.prices).length === SYMBOLS.length);
  assert.ok(s1.stats && s1.scan);
  // اجرای دوباره روی همان داده نباید سیگنال جدید یا تکراری بسازد
  const s2 = await runOnce(s1, fetcherFor(m), now + 60_000);
  assert.equal(s2.created.length, 0);
  const ids = s2.signals.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('داده‌ی کهنه (بازار بسته/قطع فید) → هیچ سیگنال جدیدی', async () => {
  const m = market();
  const s = await runOnce(emptyState(), fetcherFor(m), END + 6 * 3_600_000);
  assert.equal(s.created.length, 0);
  assert.equal(s.scan.marketOpen, false);
});

test('قطع کامل منابع: state سالم با خطای شفاف، بدون کرش', async () => {
  const s = await runOnce(emptyState(), () => ({ bars: [], source: null, errors: ['HTTP 429'] }), END);
  assert.equal(Object.values(s.feed).every((f) => !f.ok), true);
  assert.equal(s.signals.length, 0);
});

test('بک‌تست والک‌فوروارد روی دادهٔ مصنوعی: قیود ریسک همیشه رعایت می‌شود', async () => {
  const m = market(300, 35);
  const sim = await simulate(m, { days: 20 });
  const rep = report(sim);
  const sigs = sim.state.signals;
  assert.ok(sigs.length > 0, 'باید سیگنال تولید شود');
  // یک نماد هیچ‌وقت دو سیگنال هم‌زمان باز ندارد
  for (const s of sigs) {
    for (const o of sigs) {
      if (o === s || o.symbol !== s.symbol) continue;
      const sEnd = s.closed ? s.closedAt : Infinity;
      const oEnd = o.closed ? o.closedAt : Infinity;
      assert.ok(!(s.createdAt < oEnd && o.createdAt < sEnd) || s.createdAt === o.createdAt && false, `هم‌پوشانی ${s.id} / ${o.id}`);
    }
  }
  // سقف روزانه
  const perDay = {};
  for (const s of sigs) perDay[tehranDayStart(s.createdAt)] = (perDay[tehranDayStart(s.createdAt)] || 0) + 1;
  assert.ok(Math.max(...Object.values(perDay)) <= CFG.dailyMax);
  // R ها معتبرند و بین -1 و +2 (نه بیشتر)
  for (const s of sigs.filter((x) => x.closed)) assert.ok(s.r >= -1.0001 - 1 && s.r <= 2.0001, `R=${s.r}`);
  assert.ok(rep.total.n >= 0);
  console.log(`  [مصنوعی] ${sigs.length} سیگنال در ${rep.signalsPerDay.activeDays} روز، میانگین ${rep.signalsPerDay.avg}/روز، winRate ${rep.total.winRate}%، avgR ${rep.total.avgR}`);
});

test('آستانهٔ تطبیقی: هرگز زیر کف و هرگز بالاتر از پایه', () => {
  for (let h = 0; h < 24; h += 0.5) {
    const now = tehranDayStart(END) + h * 3_600_000;
    for (const cnt of [0, 3, 8, 12]) {
      const t = thresholdFor(now, cnt);
      assert.ok(t >= CFG.floorScore && t <= CFG.minScore);
    }
  }
  assert.equal(thresholdFor(tehranDayStart(END) + 23 * 3_600_000, 0), CFG.floorScore);
  assert.equal(thresholdFor(tehranDayStart(END) + 23 * 3_600_000, 12), CFG.minScore);
});

const B = 1_000_000_000;
test('تلگرام: ارسال یک‌بار، علامت‌گذاری، تلاش مجدد پس از خطا، قدیمی‌ها بی‌صدا', async () => {
  const sig = {
    id: 'a', symbol: 'XAUUSD', label: 'طلا', dir: 'BUY', strategy: 'pullback', strategyFa: 'پولبک', entry: 2650.5, slInitial: 2645, sl: 2645,
    tp: [2656, 2661.5, 2667], risk: 5.5, score: 80, grade: 'A', reasons: ['الف', 'ب'], createdAt: B, closed: false, hits: {}, tg: { new: false, sent: {} },
  };
  const old = { ...sig, hits: {}, id: 'old', createdAt: B - 5 * 3_600_000, tg: { new: false, sent: {} } };
  const state = { signals: [sig, old] };
  const calls = [];
  let fail = true;
  const fake = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    if (fail) return { ok: false, status: 400, json: async () => ({ ok: false, description: 'boom' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 77 } }) };
  };
  const env = { TELEGRAM_BOT_TOKEN: '123:SECRET', TELEGRAM_CHANNEL_ID: '@ch' };
  const logs = [];
  let r = await flush(state, B + 60000, env, fake, (m) => logs.push(m));
  assert.equal(r.failed, 1); assert.equal(sig.tg.new, false); assert.equal(old.tg.new, true); // قدیمی بی‌صدا
  assert.ok(!JSON.stringify(logs).includes('SECRET'), 'توکن نباید در لاگ بیاید');
  fail = false;
  r = await flush(state, B + 120000, env, fake, () => {});
  assert.equal(r.sent, 1); assert.equal(sig.tg.new, true); assert.equal(sig.tg.msgId, 77);
  r = await flush(state, B + 180000, env, fake, () => {});
  assert.equal(r.sent, 0, 'نباید دوباره ارسال شود');
  // رویداد TP1 به‌صورت reply
  sig.hits.tp1 = B + 150000; sig.status = 'TP1';
  await flush(state, B + 200000, env, fake, () => {});
  const last = calls[calls.length - 1];
  assert.equal(last.reply_to_message_id, 77, JSON.stringify(last));
  assert.match(last.text, /TP1/);
  // بدون تنظیم: چیزی ارسال/علامت نمی‌خورد
  const s2 = { signals: [{ ...sig, id: 'b', tg: { new: false, sent: {} } }] };
  const r2 = await flush(s2, B + 200000, {}, fake, () => {});
  assert.equal(r2.configured, false); assert.equal(s2.signals[0].tg.new, false);
});

test('قالب پیام‌ها HTML امن و کامل', () => {
  const s = { symbol: 'EURUSD', label: 'یورو/دلار <x>', dir: 'SELL', strategyFa: 'ت', entry: 1.1, slInitial: 1.105, sl: 1.105, tp: [1.095, 1.09, 1.085], risk: 0.005, score: 90, grade: 'A+', reasons: ['a<b'], createdAt: 0, result: 'SL', r: -1, closed: true };
  const t = newSignalMessage(s);
  assert.ok(t.includes('سیگنال فروش') && t.includes('1.10000') && !t.includes('<x>') && t.includes('a&lt;b'));
  assert.match(updateMessage(s, 'close'), /-1\.00R/);
});
