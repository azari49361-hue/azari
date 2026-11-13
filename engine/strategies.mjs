/**
 * استراتژی‌ها و امتیازدهی کیفیت.
 *
 * اصول:
 *  ۱. فقط روی کندل بستهٔ M15 تصمیم گرفته می‌شود (اندیس i = آخرین کندل بسته).
 *  ۲. تایم‌فریم‌های H1/H4 فقط با کندل‌هایی که تا لحظهٔ بسته‌شدن کندل i کامل شده‌اند استفاده می‌شوند (بدون look-ahead).
 *  ۳. همهٔ استراتژی‌ها به‌صورت «خرید» نوشته شده‌اند؛ فروش با آینه‌کردن قیمت‌ها (ضرب در d = ‎-1) ساخته می‌شود.
 *  ۴. هیچ سیگنالی بدون حد ضرر ساختاری، فضای کافی تا مانع بعدی (حمایت/مقاومت) و قدرت روند/نوسان کافی صادر نمی‌شود.
 */
import { CFG } from './config.mjs';
import { ema, rsi, atr, adx, bollinger, highestHigh, swings, trueRange } from './indicators.mjs';
import { aggregate } from './data.mjs';

const M15 = 15 * 60_000;
const fin = (...v) => v.every((x) => Number.isFinite(x));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** محاسبهٔ یک‌باره همهٔ سری‌های لازم برای یک نماد. bars15 باید فقط کندل‌های بسته باشد. */
export function prepare(bars15) {
  const n = bars15.length;
  const closes = bars15.map((b) => b.c);
  const lastEnd = n ? bars15[n - 1].t + M15 : 0;

  const h1 = aggregate(bars15, 60, lastEnd);
  const h4 = aggregate(bars15, 240, lastEnd);
  const h1c = h1.map((b) => b.c);
  const h4c = h4.map((b) => b.c);

  const mapIdx = (htf) => {
    const out = new Int32Array(n).fill(-1);
    let p = -1;
    for (let i = 0; i < n; i++) {
      const closeAt = bars15[i].t + M15;
      while (p + 1 < htf.length && htf[p + 1].ct <= closeAt) p++;
      out[i] = p;
    }
    return out;
  };

  return {
    bars: bars15,
    n,
    ema9: ema(closes, 9),
    ema20: ema(closes, 20),
    ema21: ema(closes, 21),
    ema50: ema(closes, 50),
    rsi: rsi(closes, 14),
    atr: atr(bars15, 14),
    adx: adx(bars15, 14),
    tr: trueRange(bars15),
    bb: bollinger(closes, 20, 2),
    h1: { bars: h1, ema21: ema(h1c, 21), ema50: ema(h1c, 50), adx: adx(h1, 14) },
    h4: { bars: h4, ema21: ema(h4c, 21) },
    h1Idx: mapIdx(h1),
    h4Idx: mapIdx(h4),
  };
}

/** روند تایم‌فریم بالا: +1 صعودی، -1 نزولی، 0 خنثی. */
export function h4Trend(ctx, i) {
  const k = ctx.h4Idx[i];
  if (k < 3) return 0;
  const e = ctx.h4.ema21[k];
  const e3 = ctx.h4.ema21[k - 3];
  if (!fin(e, e3)) return 0;
  const c = ctx.h4.bars[k].c;
  if (c > e && e > e3) return 1;
  if (c < e && e < e3) return -1;
  return 0;
}
export function h1Trend(ctx, i) {
  const k = ctx.h1Idx[i];
  if (k < 0) return 0;
  const e21 = ctx.h1.ema21[k];
  const e50 = ctx.h1.ema50[k];
  if (!fin(e21, e50)) return 0;
  const c = ctx.h1.bars[k].c;
  if (e21 > e50 && c > e50) return 1;
  if (e21 < e50 && c < e50) return -1;
  return 0;
}
export function h1Adx(ctx, i) {
  const k = ctx.h1Idx[i];
  return k < 0 ? NaN : ctx.h1.adx[k];
}

function sessionPoints(sym, hourUtc) {
  if (sym.cls === 'crypto') return 4;
  if (hourUtc >= 12 && hourUtc < 16) return 8; // هم‌پوشانی لندن/نیویورک
  if ((hourUtc >= 7 && hourUtc < 12) || (hourUtc >= 16 && hourUtc < 20)) return 5;
  const asiaPair = ['JPY', 'AUD', 'NZD'].some((c) => sym.base === c || sym.quote === c);
  if (hourUtc < 7 && asiaPair) return 5;
  return 2;
}

export function inSession(sym, hourUtc) {
  const [a, b] = sym.hours;
  return hourUtc >= a && hourUtc < b;
}

/** آیا کندل i در ساعت مجاز و نوسان معقول است؟ (گیت‌های مشترک همهٔ استراتژی‌ها) */
function commonGates(sym, ctx, i) {
  if (i < 60) return 'data';
  const { atr: A, ema20, ema50, rsi: R, adx: X } = ctx;
  if (!fin(A[i], ema20[i], ema50[i], R[i], X[i], ctx.ema9[i], ctx.ema21[i], ctx.bb.mid[i])) return 'data';
  const hour = new Date(ctx.bars[i].t + M15).getUTCHours();
  if (!inSession(sym, hour)) return 'session';
  if (A[i] < sym.minAtr) return 'low_volatility';
  if (ctx.tr[i] > 2.6 * A[i]) return 'spike_candle'; // کندل انفجاری/خبری: دنبال نمی‌کنیم
  const ageGap = ctx.bars[i].t - ctx.bars[i - 1].t;
  if (ageGap > 3 * M15) return 'gap';
  return null;
}

/** حد ضرر ساختاری با کف/سقف ATR. همه‌چیز در فضای آینه‌شده (خرید). */
function structuralRisk(entryM, lowM, a, pad = 0.15) {
  const raw = entryM - (lowM - pad * a);
  return clamp(raw, CFG.slMinAtr * a, CFG.slMaxAtr * a);
}

/** فاصلهٔ نزدیک‌ترین مانع در جهت معامله به‌صورت مضرب R. */
function roomInR(ctx, i, d, entry, risk) {
  const sw = swings(ctx.bars, i, 160, 3);
  const dayHigh = highestHigh(ctx.bars, i, 96); // بدون کندل جاری
  const obstacles = [];
  if (d > 0) {
    for (const x of sw.highs) if (x > entry + 0.05 * risk) obstacles.push(x - entry);
    if (dayHigh > entry + 0.05 * risk) obstacles.push(dayHigh - entry);
  } else {
    let dayLow = Infinity;
    for (let j = Math.max(0, i - 96); j < i; j++) dayLow = Math.min(dayLow, ctx.bars[j].l);
    for (const x of sw.lows) if (x < entry - 0.05 * risk) obstacles.push(entry - x);
    if (dayLow < entry - 0.05 * risk) obstacles.push(entry - dayLow);
  }
  if (!obstacles.length) return Infinity;
  return Math.min(...obstacles) / risk;
}

const DIR_FA = { 1: 'خرید', [-1]: 'فروش' };

/**
 * ارزیابی همهٔ استراتژی‌ها روی کندل بستهٔ i.
 * خروجی: { best: کاندیدای با بالاترین امتیاز | null, candidates: [...], rejects: {gate: count} }
 */
export function evaluateAt(sym, ctx, i) {
  const rejects = {};
  const rej = (g) => {
    rejects[g] = (rejects[g] || 0) + 1;
  };
  const gate = commonGates(sym, ctx, i);
  if (gate) {
    rej(gate);
    return { best: null, candidates: [], rejects };
  }

  const candidates = [];
  for (const d of [1, -1]) {
    for (const fn of [pullback, breakout, cross, reversion]) {
      const r = fn(sym, ctx, i, d);
      if (r.reject) rej(r.reject);
      else candidates.push(r.cand);
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return { best: candidates[0] || null, candidates, rejects };
}

// ------------------------------------------------------------------ ساخت کاندیدا + امتیاز

function build(sym, ctx, i, d, strategy, { riskM, htfPts, extraReasons, roomOverride }) {
  const bar = ctx.bars[i];
  const A = ctx.atr[i];
  const entry = bar.c;
  const risk = riskM;
  const room = roomOverride ?? roomInR(ctx, i, d, entry, risk);
  if (room < CFG.minRoomR) return { reject: 'no_room' };
  // هزینهٔ اسپرد نسبت به ریسک: اگر حد ضرر آن‌قدر نزدیک است که اسپرد بخش بزرگی از 1R را می‌خورد، معامله ارزش ندارد
  const costR = (sym.spr || 0) / risk;
  if (costR > CFG.maxCostR) return { reject: 'cost' };

  const body = Math.abs(bar.c - bar.o) / A;
  const range = bar.h - bar.l || 1e-9;
  const loc = d > 0 ? (bar.c - bar.l) / range : (bar.h - bar.c) / range;
  const rsiM = d > 0 ? ctx.rsi[i] : 100 - ctx.rsi[i];
  const x = ctx.adx[i];
  const hour = new Date(bar.t + M15).getUTCHours();

  let score = 0;
  const parts = {};
  parts.htf = htfPts;
  parts.structure = d * (ctx.ema20[i] - ctx.ema50[i]) > 0 && d * (ctx.ema50[i] - ctx.ema50[i - 5]) > 0 ? 8 : 2;
  parts.adx = Math.round(clamp((x - 18) / 17, 0, 1) * 10);
  parts.candle = Math.round(clamp((body - 0.3) / 0.7, 0, 1) * 10 + clamp((loc - 0.5) / 0.4, 0, 1) * 6);
  parts.rsi = rsiM >= 50 && rsiM <= 62 ? 8 : rsiM >= 45 && rsiM <= 68 ? 5 : 2;
  parts.room = Number.isFinite(room) ? Math.round(clamp((room - CFG.minRoomR) / (3 - CFG.minRoomR), 0, 1) * 14) : 14;
  parts.session = sessionPoints(sym, hour);
  parts.strategy = { pullback: 8, breakout: 5, cross: 5, reversion: 4 }[strategy];
  for (const v of Object.values(parts)) score += v;
  score = Math.min(100, Math.round(score));

  const dp = sym.digits;
  const r = (v) => Number(v.toFixed(dp));
  // سطوح از مقادیر گردشده ساخته می‌شوند تا مضرب‌های R دقیق بمانند (۱R، ۲R، ۳R)
  const entryR = r(entry);
  const slR = r(entry - d * risk);
  const riskR = Math.abs(entryR - slR);
  const tps = CFG.tpR.map((m) => r(entryR + d * riskR * m));

  return {
    cand: {
      symbol: sym.code,
      dir: d > 0 ? 'BUY' : 'SELL',
      strategy,
      entry: entryR,
      sl: slR,
      tp: tps,
      risk: Number(riskR.toFixed(dp)),
      atr: Number(A.toFixed(dp + 1)),
      score,
      grade: score >= 85 ? 'A+' : score >= 78 ? 'A' : score >= 72 ? 'B+' : 'B',
      candleT: bar.t,
      closeT: bar.t + M15,
      roomR: Number.isFinite(room) ? Number(room.toFixed(2)) : null,
      costR: Number(costR.toFixed(3)),
      reasons: [
        ...extraReasons,
        `ADX ${x.toFixed(0)} · RSI ${ctx.rsi[i].toFixed(0)} · بدنهٔ کندل ${body.toFixed(2)}×ATR`,
        Number.isFinite(room) ? `فضای ${room.toFixed(1)}R تا مانع بعدی` : 'مانع نزدیکی در مسیر نیست',
      ],
      parts,
    },
  };
}

const trendFa = (t) => (t > 0 ? 'صعودی' : t < 0 ? 'نزولی' : 'خنثی');

// ------------------------------------------------------------------ ۱) پولبک در جهت روند
function pullback(sym, ctx, i, d) {
  const { bars, ema20, ema50, rsi: R, adx: X, atr: Aarr } = ctx;
  const A = Aarr[i];
  const h4 = d * h4Trend(ctx, i);
  const h1 = d * h1Trend(ctx, i);
  if (h1 !== 1) return { reject: 'pullback:h1' };
  if (h4 === -1) return { reject: 'pullback:h4' };
  if (!(d * (ema20[i] - ema50[i]) > 0 && d * (ema50[i] - ema50[i - 5]) > 0)) return { reject: 'pullback:m15_trend' };
  if (X[i] < 18) return { reject: 'pullback:adx' };

  const bar = bars[i];
  const M = (v) => d * v; // آینه
  // کندل ماشه: هم‌جهت، بدنهٔ معنادار، بسته‌شدن نزدیک سقف (در فضای آینه)
  const body = M(bar.c) - M(bar.o);
  const rangeV = bar.h - bar.l || 1e-9;
  const loc = d > 0 ? (bar.c - bar.l) / rangeV : (bar.h - bar.c) / rangeV;
  if (body < 0.4 * A) return { reject: 'pullback:body' };
  if (loc < 0.6) return { reject: 'pullback:close_loc' };
  if (!(M(bar.c) > M(ema20[i]))) return { reject: 'pullback:below_ema20' };

  // پولبک اخیر: در ۸ کندل قبل قیمت به ناحیهٔ EMA20 رسیده، ولی از EMA50 عمیق‌تر نرفته
  let touched = false;
  let deepest = Infinity;
  for (let j = i - 8; j < i; j++) {
    const lowM = d > 0 ? bars[j].l : -bars[j].h;
    deepest = Math.min(deepest, lowM);
    if (lowM <= M(ema20[j]) + 0.15 * A) touched = true;
  }
  if (!touched) return { reject: 'pullback:no_pullback' };
  if (deepest < M(ema50[i]) - 0.6 * A) return { reject: 'pullback:too_deep' };
  // کندل‌های اخیر باید زیر/روی EMA20 بوده باشند (یعنی تازه برگشته)
  let recentBelow = false;
  for (let j = i - 3; j < i; j++) if (M(bars[j].c) <= M(ema20[j]) + 0.1 * A) recentBelow = true;
  if (!recentBelow) return { reject: 'pullback:late' };

  const rsiM = d > 0 ? R[i] : 100 - R[i];
  const rsiPrev = d > 0 ? R[i - 1] : 100 - R[i - 1];
  if (rsiM < 45 || rsiM > 68 || rsiM <= rsiPrev) return { reject: 'pullback:rsi' };

  let lowM = Infinity;
  for (let j = i - 6; j <= i; j++) lowM = Math.min(lowM, d > 0 ? bars[j].l : -bars[j].h);
  const riskM = structuralRisk(M(bar.c), lowM, A);
  const htfPts = (h4 === 1 ? 14 : 5) + 14;
  return build(sym, ctx, i, d, 'pullback', {
    riskM,
    htfPts,
    extraReasons: [
      `${DIR_FA[d]} در جهت روند: H1 ${trendFa(d * 1)} و H4 ${trendFa(d * h4)}`,
      'پولبک به EMA20 و بازگشت با کندل تأییدی قوی',
    ],
  });
}

// ------------------------------------------------------------------ ۲) شکست با مومنتوم
function breakout(sym, ctx, i, d) {
  const { bars, rsi: R, adx: X, atr: Aarr, tr } = ctx;
  const A = Aarr[i];
  const bar = bars[i];
  const h4 = d * h4Trend(ctx, i);
  const h1 = d * h1Trend(ctx, i);
  if (h1 === -1 || h4 === -1) return { reject: 'breakout:htf_against' };
  if (h1 === 0 && h4 === 0) return { reject: 'breakout:htf_flat' };

  // سطح شکست: سقف/کف ۲۰ کندل قبل
  let level;
  if (d > 0) {
    level = highestHigh(bars, i, 20);
    if (!(bar.c > level && bars[i - 1].c <= level)) return { reject: 'breakout:no_break' };
  } else {
    level = Infinity;
    for (let j = i - 20; j < i; j++) level = Math.min(level, bars[j].l);
    if (!(bar.c < level && bars[i - 1].c >= level)) return { reject: 'breakout:no_break' };
  }
  const body = Math.abs(bar.c - bar.o);
  if (!(d * (bar.c - bar.o) > 0) || body < 0.6 * A) return { reject: 'breakout:body' };
  const rangeV = bar.h - bar.l || 1e-9;
  const loc = d > 0 ? (bar.c - bar.l) / rangeV : (bar.h - bar.c) / rangeV;
  if (loc < 0.7) return { reject: 'breakout:close_loc' };
  if (X[i] < 20 || !(X[i] > X[i - 3])) return { reject: 'breakout:adx' };

  // فشردگی قبل از شکست: میانگین رنج ۱۰ کندل قبل کوچک‌تر از ATR
  let s = 0;
  for (let j = i - 10; j < i; j++) s += tr[j];
  if (s / 10 > 0.95 * A) return { reject: 'breakout:no_compression' };

  const rsiM = d > 0 ? R[i] : 100 - R[i];
  if (rsiM < 55 || rsiM > 76) return { reject: 'breakout:rsi' };

  let lowM = Infinity;
  for (let j = i - 3; j <= i; j++) lowM = Math.min(lowM, d > 0 ? bars[j].l : -bars[j].h);
  const riskM = structuralRisk(d * bar.c, lowM, A, 0.1);
  const htfPts = (h4 === 1 ? 14 : 6) + (h1 === 1 ? 14 : 6);
  return build(sym, ctx, i, d, 'breakout', {
    riskM,
    htfPts,
    extraReasons: [
      `${DIR_FA[d]}: شکست ${d > 0 ? 'سقف' : 'کف'} ۲۰ کندل با بستهٔ قوی پس از فشردگی`,
      `روند H1 ${trendFa(d * h1)} · H4 ${trendFa(d * h4)}`,
    ],
  });
}

// ------------------------------------------------------------------ ۳) تقاطع EMA با تأیید روند
function cross(sym, ctx, i, d) {
  const { bars, ema9, ema21, ema50, rsi: R, adx: X, atr: Aarr } = ctx;
  const A = Aarr[i];
  const bar = bars[i];
  const crossed = d > 0 ? ema9[i - 1] <= ema21[i - 1] && ema9[i] > ema21[i] : ema9[i - 1] >= ema21[i - 1] && ema9[i] < ema21[i];
  if (!crossed) return { reject: 'cross:no_cross' };
  const h4 = d * h4Trend(ctx, i);
  const h1 = d * h1Trend(ctx, i);
  if (h1 !== 1) return { reject: 'cross:h1' };
  if (h4 === -1) return { reject: 'cross:h4' };
  if (X[i] < 20) return { reject: 'cross:adx' };
  if (!(d * (ema21[i] - ema21[i - 3]) > 0)) return { reject: 'cross:slope' };
  if (!(d * (bar.c - ema50[i]) > 0)) return { reject: 'cross:ema50' };
  if (!(d * (bar.c - bar.o) >= 0.35 * A)) return { reject: 'cross:body' };
  const rsiM = d > 0 ? R[i] : 100 - R[i];
  if (rsiM < 52 || rsiM > 68) return { reject: 'cross:rsi' };

  let lowM = Infinity;
  for (let j = i - 8; j <= i; j++) lowM = Math.min(lowM, d > 0 ? bars[j].l : -bars[j].h);
  const riskM = structuralRisk(d * bar.c, lowM, A, 0.1);
  return build(sym, ctx, i, d, 'cross', {
    riskM,
    htfPts: (h4 === 1 ? 14 : 5) + 14,
    extraReasons: [`${DIR_FA[d]}: تقاطع EMA9/21 با تأیید H1 ${trendFa(d * h1)} و شیب EMA21`],
  });
}

// ------------------------------------------------------------------ ۴) بازگشت از باند بولینگر در بازار رِنج
function reversion(sym, ctx, i, d) {
  const { bars, rsi: R, adx: X, atr: Aarr, bb } = ctx;
  const A = Aarr[i];
  const bar = bars[i];
  if (sym.cls === 'crypto') return { reject: 'reversion:crypto' };
  if (X[i] >= 20) return { reject: 'reversion:trending' };
  const hx = h1Adx(ctx, i);
  if (!fin(hx) || hx >= 25) return { reject: 'reversion:h1_trending' };
  const h4 = d * h4Trend(ctx, i);
  const h1 = d * h1Trend(ctx, i);
  if (h4 === -1 && h1 === -1) return { reject: 'reversion:htf_against' };

  // یکی از ۲ کندل قبل بیرون باند بسته شده و کندل فعلی به داخل برگشته
  const outside = (j) => (d > 0 ? bars[j].c < bb.lo[j] : bars[j].c > bb.up[j]);
  const inside = d > 0 ? bar.c > bb.lo[i] : bar.c < bb.up[i];
  if (!(inside && (outside(i - 1) || outside(i - 2)))) return { reject: 'reversion:no_setup' };
  if (!(d * (bar.c - bar.o) >= 0.3 * A)) return { reject: 'reversion:body' };
  const rsiM = d > 0 ? R[i] : 100 - R[i];
  const rsiPrev = Math.min(...[1, 2].map((k) => (d > 0 ? R[i - k] : 100 - R[i - k])));
  if (!(rsiPrev < 36 && rsiM > rsiPrev)) return { reject: 'reversion:rsi' };
  if (bb.up[i] - bb.lo[i] < 2.5 * A) return { reject: 'reversion:narrow_band' };

  let lowM = Infinity;
  for (let j = i - 3; j <= i; j++) lowM = Math.min(lowM, d > 0 ? bars[j].l : -bars[j].h);
  const riskM = structuralRisk(d * bar.c, lowM, A, 0.2);
  const toMid = d * (bb.mid[i] - bar.c);
  const roomR = toMid / riskM;
  if (roomR < 1.0) return { reject: 'reversion:no_room' };
  const htfPts = (h4 >= 0 ? 10 : 0) + (h1 >= 0 ? 10 : 0) + (hx < 22 ? 8 : 0);
  return build(sym, ctx, i, d, 'reversion', {
    riskM,
    htfPts,
    roomOverride: roomR,
    extraReasons: [`${DIR_FA[d]}: بازگشت به داخل باند بولینگر در بازار رِنج (ADX پایین) با هدف میانگین`],
  });
}
