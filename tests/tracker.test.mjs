import test from 'node:test';
import assert from 'node:assert/strict';
import { advance } from '../engine/tracker.mjs';

const M = 900_000;
const T0 = 10 * M;
// BUY @100، ریسک ۱۰ → SL=90, TP=110/120/130
const base = (dir = 'BUY') => ({
  id: 'x', symbol: 'EURUSD', dir, entry: 100, slInitial: dir === 'BUY' ? 90 : 110, sl: dir === 'BUY' ? 90 : 110,
  tp: dir === 'BUY' ? [110, 120, 130] : [90, 80, 70], candleT: T0 - M, createdAt: T0, closed: false,
});
const bar = (k, o, h, l, c) => ({ t: T0 + k * M, o, h, l, c });
const NOW = T0 + 50 * M;

test('حد ضرر قبل از TP1 → -1R', () => {
  const s = advance(base(), [bar(0, 100, 101, 95, 96), bar(1, 96, 97, 89, 90)], NOW);
  assert.equal(s.result, 'SL'); assert.equal(s.r, -1); assert.ok(s.closed);
});

test('TP1 سپس برگشت به ورود → BE با +۰.۳۳R (برنده)', () => {
  const s = advance(base(), [bar(0, 100, 111, 99.5, 108), bar(1, 108, 109, 99, 100)], NOW);
  // کندل ۰: TP1 خورد و low=99.5 ≤ ورود → بدبینانه BE همان کندل
  assert.equal(s.result, 'BE'); assert.equal(s.r, 0.333);
});

test('TP1 در کندل تمیز، BE در کندل بعد', () => {
  const s = advance(base(), [bar(0, 100, 111, 100.5, 110), bar(1, 110, 110.5, 99, 100)], NOW);
  assert.equal(s.hits.tp1 !== null, true); assert.equal(s.result, 'BE'); assert.equal(s.r, 0.333);
});

test('TP1 و TP2 سپس خروج با حد ضرر روی TP1 → +1.333R', () => {
  const s = advance(base(), [bar(0, 100, 111, 100.5, 110), bar(1, 110, 121, 109, 120), bar(2, 120, 121, 109, 110)], NOW);
  assert.equal(s.result, 'TP1_LOCK'); assert.equal(s.r, 1.333);
});

test('هر سه هدف → +2R', () => {
  const s = advance(base(), [bar(0, 100, 111, 100.5, 110), bar(1, 110, 131, 110.5, 130)], NOW);
  assert.equal(s.result, 'TP3'); assert.equal(s.r, 2);
});

test('هم SL هم TP در یک کندل → بدبینانه SL', () => {
  const s = advance(base(), [bar(0, 100, 115, 89, 100)], NOW);
  assert.equal(s.result, 'SL');
});

test('فروش آینه‌ای: TP3 و SL', () => {
  const win = advance(base('SELL'), [bar(0, 100, 99.5, 89, 90), bar(1, 90, 89.5, 69, 70)], NOW);
  assert.equal(win.result, 'TP3'); assert.equal(win.r, 2);
  const loss = advance(base('SELL'), [bar(0, 100, 111, 99, 108)], NOW);
  assert.equal(loss.result, 'SL'); assert.equal(loss.r, -1);
});

test('کندل خود سیگنال و قبل از آن نادیده گرفته می‌شود', () => {
  const s = advance(base(), [{ t: T0 - M, o: 100, h: 200, l: 1, c: 100 }, { t: T0 - 2 * M, o: 1, h: 1, l: 1, c: 1 }], NOW);
  assert.equal(s.closed, false); assert.equal(s.status, 'ACTIVE');
});

test('انقضا: بسته با قیمت بازار و R شناور', () => {
  const sig = { ...base(), createdAt: T0 - 30 * 3_600_000 };
  const s = advance(sig, [bar(0, 100, 105, 98, 104)], NOW, 20 * 3_600_000);
  assert.equal(s.result, 'EXPIRED'); assert.equal(s.r, 0.4);
});

test('idempotent: اجرای دوباره روی همان داده نتیجهٔ یکسان می‌دهد', () => {
  const bars = [bar(0, 100, 111, 100.5, 110), bar(1, 110, 121, 110.5, 118)];
  const a = advance(base(), bars, NOW);
  const b = advance(a, bars, NOW);
  assert.deepEqual({ ...a }, { ...b });
  assert.equal(a.status, 'TP2');
});
