import test from 'node:test';
import assert from 'node:assert/strict';
import { ema, sma, rsi, atr, adx, bollinger, swings } from '../engine/indicators.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('EMA: بذر SMA و ضریب استاندارد', () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.ok(Number.isNaN(out[0]) && Number.isNaN(out[1]));
  close(out[2], 2);
  close(out[3], 4 * 0.5 + 2 * 0.5); // k = 0.5
  close(out[4], 5 * 0.5 + 3 * 0.5);
});

test('SMA', () => {
  const out = sma([1, 2, 3, 4], 2);
  assert.deepEqual(out.slice(1), [1.5, 2.5, 3.5]);
});

test('RSI: روند صرفاً صعودی = ۱۰۰، صرفاً نزولی = ۰، نوسان متقارن ≈ ۵۰', () => {
  const up = Array.from({ length: 40 }, (_, i) => i + 1);
  assert.equal(rsi(up)[39], 100);
  const down = up.slice().reverse();
  close(rsi(down)[39], 0, 1e-6);
  const zig = Array.from({ length: 200 }, (_, i) => 100 + (i % 2 ? 1 : -1));
  assert.ok(Math.abs(rsi(zig)[199] - 50) < 3);
});

test('ATR: رنج ثابت → ATR همان رنج', () => {
  const bars = Array.from({ length: 40 }, (_, i) => ({ t: i, o: 10, h: 11, l: 9, c: 10 }));
  close(atr(bars)[39], 2);
});

test('ADX: روند یکنواخت قوی، رِنج ضعیف', () => {
  const trend = Array.from({ length: 120 }, (_, i) => ({ t: i, o: i, h: i + 1, l: i - 0.2, c: i + 0.8 }));
  assert.ok(adx(trend)[119] > 40);
  const range = Array.from({ length: 120 }, (_, i) => {
    const m = 100 + (i % 2 ? 1 : -1);
    return { t: i, o: m, h: m + 0.5, l: m - 0.5, c: m };
  });
  assert.ok(adx(range)[119] < 20);
});

test('بولینگر: میانهٔ SMA و باندهای متقارن', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 5));
  const b = bollinger(closes, 20, 2);
  close(b.up[29] - b.mid[29], b.mid[29] - b.lo[29]);
});

test('swing فقط با k کندل تأییدکنندهٔ بعدی', () => {
  const bars = [1, 2, 3, 9, 3, 2, 1, 2, 3, 4].map((h, i) => ({ t: i, o: h, h, l: h - 1, c: h }));
  assert.deepEqual(swings(bars, 9, 50, 3).highs, [9]);
  assert.deepEqual(swings(bars, 5, 50, 3).highs, []); // هنوز ۳ کندل بعدش نیامده
});
