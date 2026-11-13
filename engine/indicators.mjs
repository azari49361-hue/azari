/**
 * اندیکاتورها — توابع خالص و علّی (causal): مقدار هر اندیس فقط به کندل‌های قبل/همان اندیس وابسته است،
 * پس بک‌تست و اجرای زنده نتیجهٔ یکسان می‌دهند و هیچ نگاه‌به‌آینده‌ای (look-ahead) وجود ندارد.
 * همهٔ آرایه‌ها هم‌طول ورودی‌اند؛ جایی که داده کافی نیست مقدار NaN است.
 */

export function ema(values, period) {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sma(values, period) {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** RSI به روش Wilder. */
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let ag = gain / period;
  let al = loss / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

export function trueRange(bars) {
  return bars.map((b, i) =>
    i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))
  );
}

/** ATR به روش Wilder. */
export function atr(bars, period = 14) {
  const out = new Array(bars.length).fill(NaN);
  if (bars.length <= period) return out;
  const tr = trueRange(bars);
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** ADX (قدرت روند) به روش Wilder. */
export function adx(bars, period = 14) {
  const n = bars.length;
  const out = new Array(n).fill(NaN);
  if (n < period * 2 + 1) return out;
  const tr = trueRange(bars);
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = bars[i].h - bars[i - 1].h;
    const down = bars[i - 1].l - bars[i].l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  let sTR = 0;
  let sP = 0;
  let sM = 0;
  for (let i = 1; i <= period; i++) {
    sTR += tr[i];
    sP += plusDM[i];
    sM += minusDM[i];
  }
  const dx = new Array(n).fill(NaN);
  const calcDx = (i) => {
    const pdi = sTR === 0 ? 0 : (100 * sP) / sTR;
    const mdi = sTR === 0 ? 0 : (100 * sM) / sTR;
    dx[i] = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
  };
  calcDx(period);
  for (let i = period + 1; i < n; i++) {
    sTR = sTR - sTR / period + tr[i];
    sP = sP - sP / period + plusDM[i];
    sM = sM - sM / period + minusDM[i];
    calcDx(i);
  }
  let sum = 0;
  for (let i = period; i < period * 2; i++) sum += dx[i];
  let prev = sum / period;
  out[period * 2 - 1] = prev;
  for (let i = period * 2; i < n; i++) {
    prev = (prev * (period - 1) + dx[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** باند بولینگر (میانگین، بالا، پایین). */
export function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const up = new Array(closes.length).fill(NaN);
  const lo = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / period);
    up[i] = mid[i] + mult * sd;
    lo[i] = mid[i] - mult * sd;
  }
  return { mid, up, lo };
}

/** بیشینهٔ high و کمینهٔ low در n کندل قبل از اندیس i (خود i شامل نیست). */
export function highestHigh(bars, i, n) {
  let m = -Infinity;
  for (let j = Math.max(0, i - n); j < i; j++) m = Math.max(m, bars[j].h);
  return m;
}
export function lowestLow(bars, i, n) {
  let m = Infinity;
  for (let j = Math.max(0, i - n); j < i; j++) m = Math.min(m, bars[j].l);
  return m;
}

/**
 * نقاط چرخش (swing) تأییدشده: بالاترین/پایین‌ترین نقطه‌ای که k کندل دو طرفش پایین‌تر/بالاتر است.
 * فقط کندل‌های ≤ i استفاده می‌شوند؛ swing وقتی تأیید می‌شود که k کندل بعدش هم بسته شده باشد.
 */
export function swings(bars, i, lookback = 120, k = 3) {
  const highs = [];
  const lows = [];
  const start = Math.max(k, i - lookback);
  for (let j = start; j <= i - k; j++) {
    let isHigh = true;
    let isLow = true;
    for (let d = 1; d <= k; d++) {
      if (bars[j].h <= bars[j - d].h || bars[j].h <= bars[j + d].h) isHigh = false;
      if (bars[j].l >= bars[j - d].l || bars[j].l >= bars[j + d].l) isLow = false;
    }
    if (isHigh) highs.push(bars[j].h);
    if (isLow) lows.push(bars[j].l);
  }
  return { highs, lows };
}
