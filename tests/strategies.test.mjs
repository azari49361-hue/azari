import test from 'node:test';
import assert from 'node:assert/strict';
import { synth } from './helpers.mjs';
import { prepare, evaluateAt } from '../engine/strategies.mjs';
import { SYMBOLS, CFG } from '../engine/config.mjs';

const END = Date.UTC(2026, 10, 11, 15, 0); // چهارشنبه ۱۵:۰۰ UTC
const eur = SYMBOLS.find((s) => s.code === 'EURUSD');

function allCandidates(seed, days = 40) {
  const bars = synth({ start: 1.1, sigma: 0.0009, days, endMs: END, seed });
  const ctx = prepare(bars);
  const out = [];
  for (let i = 120; i < ctx.n; i++) {
    const r = evaluateAt(eur, ctx, i);
    for (const c of r.candidates) out.push({ i, c });
  }
  return { ctx, out };
}

test('بدون look-ahead: نتیجهٔ i روی داده‌ی کامل = نتیجه روی داده‌ی بریده‌شده تا i', () => {
  const bars = synth({ start: 1.1, sigma: 0.0009, days: 40, endMs: END, seed: 7 });
  const full = prepare(bars);
  let compared = 0;
  for (let i = 200; i < bars.length; i += 3) {
    const a = evaluateAt(eur, full, i);
    const b = evaluateAt(eur, prepare(bars.slice(0, i + 1)), i);
    assert.deepEqual(a.candidates.map((c) => [c.strategy, c.dir, c.entry, c.sl, c.score]), b.candidates.map((c) => [c.strategy, c.dir, c.entry, c.sl, c.score]), `اختلاف در i=${i}`);
    compared++;
  }
  assert.ok(compared > 50);
});

test('کاندیداها از نظر ساختاری سالم‌اند (SL/TP/RR/امتیاز)', () => {
  let total = 0;
  for (const seed of [1, 2, 3, 4]) {
    const { out } = allCandidates(seed);
    for (const { c } of out) {
      total++;
      const d = c.dir === 'BUY' ? 1 : -1;
      assert.ok(d * (c.entry - c.sl) > 0, 'SL باید در سمت زیان باشد');
      assert.ok(d * (c.tp[0] - c.entry) > 0 && c.tp[1] !== c.tp[0] && d * (c.tp[2] - c.tp[1]) > 0, 'پله‌ها صعودی/نزولی');
      const risk = Math.abs(c.entry - c.sl);
      assert.ok(risk >= CFG.slMinAtr * c.atr * 0.97 && risk <= CFG.slMaxAtr * c.atr * 1.03, `ریسک ${risk} خارج از ${c.atr}`);
      assert.ok(c.score >= 0 && c.score <= 100);
      assert.ok(c.roomR === null || c.roomR >= 1.0);
      assert.ok(['pullback', 'breakout', 'cross', 'reversion'].includes(c.strategy));
    }
  }
  assert.ok(total > 0, 'روی دادهٔ مصنوعی باید حداقل چند کاندیدا پیدا شود');
});

test('ساعت خارج از جلسه → هیچ سیگنالی (EURUSD ساعت ۰۳ UTC)', () => {
  const bars = synth({ start: 1.1, sigma: 0.0009, days: 40, endMs: Date.UTC(2026, 10, 11, 3, 0), seed: 5 });
  const ctx = prepare(bars);
  const r = evaluateAt(eur, ctx, ctx.n - 1);
  assert.equal(r.best, null);
  assert.ok(r.rejects.session > 0);
});

test('بازار مرده (ATR زیر حداقل) → رد', () => {
  const bars = synth({ start: 1.1, sigma: 0.00001, days: 40, endMs: END, seed: 5 });
  const ctx = prepare(bars);
  assert.equal(evaluateAt(eur, ctx, ctx.n - 1).best, null);
});
