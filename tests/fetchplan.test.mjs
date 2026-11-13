import test from 'node:test';
import assert from 'node:assert/strict';
import { synth } from './helpers.mjs';
import { SYMBOLS } from '../engine/config.mjs';
import { runOnce, emptyState } from '../engine/runner.mjs';
import { fxClosed } from '../engine/market.mjs';
import { advance } from '../engine/tracker.mjs';

const END = Date.UTC(2026, 10, 11, 15, 0); // چهارشنبه ۱۵:۰۰ UTC
function market(end = END) {
  const out = {};
  SYMBOLS.forEach((s, k) => {
    const start = s.code === 'XAUUSD' ? 2650 : s.code === 'BTCUSD' ? 90000 : s.digits === 3 ? 150 : 1.1;
    out[s.code] = synth({ start, sigma: s.minAtr * 1.6, days: 30, endMs: end, seed: 40 + k, crypto: s.cls === 'crypto' });
  });
  return out;
}
const counting = (m) => {
  const calls = [];
  const f = (sym) => { calls.push(sym.code); return { bars: m[sym.code] || [], source: 'test', errors: [] }; };
  return { f, calls };
};

test('fxClosed: آخر هفته بسته، وسط هفته باز (ساعت نیویورک، با DST)', () => {
  assert.equal(fxClosed(Date.UTC(2026, 10, 14, 12, 0)), true);  // شنبه
  assert.equal(fxClosed(Date.UTC(2026, 10, 15, 12, 0)), true);  // یکشنبه ظهر
  assert.equal(fxClosed(Date.UTC(2026, 10, 15, 23, 0)), false); // یکشنبه ۱۸:۰۰ نیویورک (نوامبر = EST) → باز
  assert.equal(fxClosed(Date.UTC(2026, 10, 11, 15, 0)), false); // چهارشنبه
  assert.equal(fxClosed(Date.UTC(2026, 10, 13, 21, 30)), false); // جمعه ۱۶:۳۰ نیویورک → هنوز باز
  assert.equal(fxClosed(Date.UTC(2026, 10, 13, 22, 30)), true); // جمعه ۱۷:۳۰ نیویورک → بسته
});

test('اجرای اول همه نمادها را می‌گیرد؛ اجرای ۵ دقیقه بعد فقط طلا (و نمادهای دارای سیگنال باز)', async () => {
  const m = market();
  const a = counting(m);
  const now = END + 90_000;
  const s1 = await runOnce(emptyState(), a.f, now);
  assert.equal(a.calls.length, SYMBOLS.length);
  const b = counting(m);
  const s2 = await runOnce(s1, b.f, now + 5 * 60_000);
  const open = new Set(s1.signals.filter((s) => !s.closed).map((s) => s.symbol));
  assert.ok(b.calls.every((c) => c === 'XAUUSD' || open.has(c)), `فراخوانی غیرضروری: ${b.calls}`);
  // قیمت و نمودار نمادهای رد‌شده حفظ می‌شود (سایت هیچ‌وقت خالی نمی‌شود)
  assert.equal(Object.keys(s2.prices).length, SYMBOLS.length);
  assert.equal(Object.keys(s2.candles).length, SYMBOLS.length);
  // با بسته‌شدن کندل بعدی دوباره همه گرفته می‌شوند
  const c = counting(m);
  await runOnce(s2, c.f, now + 15 * 60_000);
  assert.equal(c.calls.length, SYMBOLS.length);
});

test('آخر هفته: فقط کریپتو (و نمادهای دارای سیگنال باز) دریافت می‌شود', async () => {
  const sat = Date.UTC(2026, 10, 14, 12, 0);
  const m = market(sat);
  const a = counting(m);
  const s1 = await runOnce(emptyState(), a.f, sat + 30_000); // اجرای اول: هنوز داده‌ای نداشته → همه (تا سایت خالی نماند)
  assert.equal(a.calls.length, SYMBOLS.length);
  const b = counting(m);
  await runOnce(s1, b.f, sat + 20 * 60_000);
  const crypto = SYMBOLS.filter((s) => s.cls === 'crypto').map((s) => s.code);
  assert.ok(b.calls.every((c) => crypto.includes(c)), `در تعطیلی فارکس نباید گرفته شود: ${b.calls}`);
});

test('هزینهٔ اسپرد از R کم می‌شود', () => {
  const M = 900_000, T0 = 10 * M;
  const sig = { id: 'x', symbol: 'EURUSD', dir: 'BUY', entry: 100, slInitial: 90, sl: 90, tp: [110, 120, 130], candleT: T0 - M, createdAt: T0, closed: false, costR: 0.1 };
  const s = advance(sig, [{ t: T0, o: 100, h: 101, l: 89, c: 90 }], T0 + 50 * M);
  assert.equal(s.result, 'SL');
  assert.equal(s.r, -1.1);
});
