import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYahoo, parseTwelve, parseBiquote, normalize, aggregate, closedOnly } from '../engine/data.mjs';

test('Yahoo: کندل‌های null حذف و ترتیب صعودی', () => {
  const bars = parseYahoo({
    chart: { result: [{ timestamp: [1000, 1900, 2800, 3700], indicators: { quote: [{
      open: [1, 2, null, 4], high: [2, 3, 3, 5], low: [0.5, 1.5, 1, 3.5], close: [1.5, 2.5, 2, 4.5] }] } }] },
  });
  assert.equal(bars.length, 3);
  assert.equal(bars[0].t, 1_000_000);
  assert.ok(bars.every((b) => b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c)));
});

test('Yahoo: پاسخ خطا → استثنا (هرگز داده ساختگی نه)', () => {
  assert.throws(() => parseYahoo({ chart: { result: null, error: { description: 'Not Found' } } }), /Not Found/);
});

test('TwelveData: جدیدترین-اول به صعودی تبدیل می‌شود و UTC است', () => {
  const bars = parseTwelve({ status: 'ok', values: [
    { datetime: '2026-01-02 10:15:00', open: '2', high: '3', low: '1', close: '2.5' },
    { datetime: '2026-01-02 10:00:00', open: '1', high: '2', low: '0.5', close: '2' },
  ] });
  assert.equal(bars[0].t, Date.parse('2026-01-02T10:00:00Z'));
  assert.equal(bars.length, 2);
  assert.throws(() => parseTwelve({ status: 'error', message: 'limit' }), /limit/);
});

test('biquote: کندل در حال شکل‌گیری حذف می‌شود', () => {
  const bars = parseBiquote({ bars: [
    { openTime: '2026-01-02T10:15:00Z', open: 2, high: 3, low: 1, close: 2, isOpen: true },
    { openTime: '2026-01-02T10:00:00Z', open: 1, high: 2, low: 0.5, close: 1.5, isOpen: false },
  ] });
  assert.equal(bars.length, 1);
});

test('normalize: تکراری‌ها حذف می‌شوند', () => {
  assert.equal(normalize([{ t: 2, o: 1, h: 1, l: 1, c: 1 }, { t: 2, o: 2, h: 2, l: 2, c: 2 }, { t: 1, o: 1, h: 1, l: 1, c: 1 }]).length, 2);
});

test('closedOnly: کندل در حال شکل‌گیری کنار گذاشته می‌شود', () => {
  const bars = [{ t: 0 }, { t: 900_000 }, { t: 1_800_000 }];
  assert.equal(closedOnly(bars, 1_800_000 + 100).length, 2);
  assert.equal(closedOnly(bars, 2_700_000).length, 3);
});

test('aggregate: H1 فقط از گروه‌های کامل‌شده', () => {
  const H = 3_600_000;
  const bars = Array.from({ length: 6 }, (_, i) => ({ t: i * 900_000, o: i, h: i + 2, l: i - 1, c: i + 1 }));
  const lastEnd = bars[5].t + 900_000; // ۱.۵ ساعت
  const h1 = aggregate(bars, 60, lastEnd);
  assert.equal(h1.length, 1); // گروه دوم هنوز تمام نشده
  assert.equal(h1[0].ct, H);
  assert.equal(h1[0].o, 0); assert.equal(h1[0].c, 4); assert.equal(h1[0].h, 5); assert.equal(h1[0].l, -1);
});
