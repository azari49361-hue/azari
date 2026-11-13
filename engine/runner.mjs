/**
 * یک چرخهٔ کامل موتور: دریافت داده → پیگیری سیگنال‌های باز → اسکن → فیلتر ریسک → ساخت state جدید.
 * fetcher تزریق‌پذیر است تا تست و بک‌تست بدون اینترنت اجرا شوند.
 */
import { CFG, SYMBOLS, STRATEGY_FA, symbolByCode } from './config.mjs';
import { closedOnly } from './data.mjs';
import { prepare, evaluateAt } from './strategies.mjs';
import { advance } from './tracker.mjs';
import { buildStats, pausedStrategies } from './stats.mjs';
import { fxClosed } from './market.mjs';

const M15 = 15 * 60_000;
const TEHRAN_OFFSET_MS = 3.5 * 3_600_000; // ایران ساعت تابستانی ندارد (از ۱۴۰۱)

export function tehranDayStart(now) {
  return Math.floor((now + TEHRAN_OFFSET_MS) / 86_400_000) * 86_400_000 - TEHRAN_OFFSET_MS;
}
const tehranHour = (now) => (((now + TEHRAN_OFFSET_MS) % 86_400_000) / 3_600_000);

/** آستانهٔ امتیاز: اگر از هدف روزانه عقب هستیم کمی (تا کف) آسان‌تر می‌شود؛ هرگز زیر کف نمی‌رود. */
export function thresholdFor(now, todayCount) {
  const progress = Math.min(1, Math.max(0, (tehranHour(now) - 9.5) / 15)); // ساعات فعال بازار ≈ ۰۹:۳۰ تا ۰۰:۳۰ تهران
  const expected = CFG.dailyTarget * progress;
  const deficit = expected - todayCount;
  if (deficit <= 0.5) return CFG.minScore;
  return Math.max(CFG.floorScore, CFG.minScore - 2 * Math.ceil(deficit));
}

function exposureOf(sig) {
  const sym = symbolByCode[sig.symbol];
  const d = sig.dir === 'BUY' ? 1 : -1;
  const out = {};
  out[sym.base] = d;
  if (sym.cls !== 'crypto') out[sym.quote] = -d;
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await fn(items[k], k);
      }
    })
  );
  return out;
}

export function emptyState() {
  return { version: 3, updatedAt: 0, signals: [], lastEval: {}, scan: {}, feed: {}, prices: {}, candles: {}, stats: {}, runs: 0 };
}

/**
 * @param prev state قبلی
 * @param fetchBars (sym) => {bars, source, errors}
 * @param now ms
 */
export async function runOnce(prev, fetchBars, now = Date.now()) {
  const state = { ...emptyState(), ...prev, version: 3 };
  state.signals = (prev.signals || []).map((s) => ({ ...s }));
  state.lastEval = { ...(prev.lastEval || {}) };
  state.feed = {};
  state.prices = {};
  state.candles = {};

  // ---------- ۱) دریافت داده
  // برای کم‌کردن فشار روی منبع رایگان: نماد فقط وقتی دوباره گرفته می‌شود که سیگنال باز دارد، کندل بستهٔ جدیدی منتظرش است،
  // هنوز هیچ‌وقت داده‌ای از آن نگرفته‌ایم، یا نمادِ شاخص (طلا) است. در تعطیلی بازار فارکس، فقط نمادهای دارای سیگنال باز.
  const expectedOpen = Math.floor((now - 20_000) / M15) * M15 - M15; // زمان بازشدن آخرین کندلی که باید تا الان بسته شده باشد
  const closedFx = fxClosed(now);
  const openSyms = new Set(state.signals.filter((s) => !s.closed).map((s) => s.symbol));
  const mustFetch = (sym) => {
    if (openSyms.has(sym.code)) return true;
    if (!prev.feed?.[sym.code]?.ok || !prev.prices?.[sym.code] || !prev.candles?.[sym.code]) return true;
    if (sym.cls !== 'crypto' && closedFx) return false;
    if (sym.code === 'XAUUSD') return true;
    return (state.lastEval[sym.code] || 0) < expectedOpen;
  };
  const toFetch = SYMBOLS.filter(mustFetch);
  const carried = SYMBOLS.filter((s) => !toFetch.includes(s));
  const fetched = await mapLimit(toFetch, 4, async (sym) => {
    try {
      return { sym, ...(await fetchBars(sym)) };
    } catch (e) {
      return { sym, bars: [], source: null, errors: [String(e.message || e)] };
    }
  });
  // نمادهای رد‌شده: آخرین مقدار معتبر نگه داشته می‌شود (تازگی دوباره از روی زمان آخرین کندل محاسبه می‌شود)
  for (const sym of carried) {
    const pf = prev.feed?.[sym.code];
    if (!pf?.ok) continue;
    const ageMin = pf.lastCandle ? Math.round((now - (pf.lastCandle + M15)) / 60_000) : null;
    const fresh = ageMin !== null && ageMin <= CFG.maxDataAgeMin;
    state.feed[sym.code] = { ...pf, ageMin, fresh, carried: true };
    if (prev.prices?.[sym.code]) state.prices[sym.code] = { ...prev.prices[sym.code], fresh };
    if (prev.candles?.[sym.code]) state.candles[sym.code] = prev.candles[sym.code];
  }

  const data = {}; // code -> {all, closed, ctx}
  for (const f of fetched) {
    const code = f.sym.code;
    if (!f.bars.length) {
      state.feed[code] = { ok: false, source: null, error: f.errors.join(' | ').slice(0, 300) };
      continue;
    }
    const closed = closedOnly(f.bars, now);
    const lastClosed = closed[closed.length - 1];
    const ageMin = lastClosed ? Math.round((now - (lastClosed.t + M15)) / 60_000) : null;
    const fresh = ageMin !== null && ageMin <= CFG.maxDataAgeMin;
    state.feed[code] = { ok: true, source: f.source, ageMin, fresh, lastCandle: lastClosed ? lastClosed.t : null };
    data[code] = { all: f.bars, closed, fresh, ctx: null };

    // قیمت و نمودار
    const last = f.bars[f.bars.length - 1];
    const dayAgo = closed.length > 96 ? closed[closed.length - 97].c : closed[0]?.c;
    state.prices[code] = {
      price: last.c,
      t: last.t,
      changePct: dayAgo ? Number((((last.c - dayAgo) / dayAgo) * 100).toFixed(3)) : null,
      fresh,
    };
    state.candles[code] = f.bars.slice(-CFG.chartBars).map((b) => [b.t, b.o, b.h, b.l, b.c]);
  }

  // ---------- ۲) پیگیری سیگنال‌های باز
  const expireMs = CFG.expireHours * 3_600_000;
  for (let k = 0; k < state.signals.length; k++) {
    const sig = state.signals[k];
    if (sig.closed) continue;
    const dset = data[sig.symbol];
    if (!dset) continue; // داده نداریم: وضعیت دست‌نخورده می‌ماند (هرگز حدس نمی‌زنیم)
    state.signals[k] = advance(sig, dset.all, now, expireMs);
  }

  // ---------- ۳) محدودیت‌های ریسک
  const dayStart = tehranDayStart(now);
  const today = state.signals.filter((s) => s.createdAt >= dayStart);
  const todayClosedR = state.signals.filter((s) => s.closed && s.closedAt >= dayStart && Number.isFinite(s.r)).reduce((a, s) => a + s.r, 0);
  const breaker = todayClosedR <= CFG.dailyLossLimitR;
  const active = state.signals.filter((s) => !s.closed);
  const paused = pausedStrategies(state.signals, CFG.strategyPauseAvgR);
  const threshold = thresholdFor(now, today.length);

  const scan = {
    at: now,
    threshold,
    todayCount: today.length,
    todayR: Number(todayClosedR.toFixed(2)),
    breaker,
    paused,
    evaluated: 0,
    candidates: 0,
    rejects: {},
    skipped: [],
    marketOpen: Object.values(data).some((d) => d.fresh),
  };

  // ---------- ۴) اسکن کندل‌های جدید بسته‌شده
  const pool = [];
  for (const sym of SYMBOLS) {
    const d = data[sym.code];
    if (!d || !d.fresh) continue;
    if (d.closed.length < 150) continue;
    d.ctx = prepare(d.closed);
    const ctx = d.ctx;
    const lastIdx = ctx.n - 1;
    const prevEval = state.lastEval[sym.code] || 0;
    // کندل‌های جدید؛ در اولین اجرا فقط آخرین کندل. حداکثر ۳ کندل اخیر (جبران تأخیر Actions).
    const from = prevEval ? Math.max(0, lastIdx - 2) : lastIdx;
    for (let i = from; i <= lastIdx; i++) {
      if (ctx.bars[i].t <= prevEval) continue;
      scan.evaluated++;
      const { candidates, rejects } = evaluateAt(sym, ctx, i);
      for (const [g, c] of Object.entries(rejects)) scan.rejects[g] = (scan.rejects[g] || 0) + c;
      for (const c of candidates) pool.push({ ...c, _i: i });
    }
    state.lastEval[sym.code] = ctx.bars[lastIdx].t;
  }
  scan.candidates = pool.length;

  // ---------- ۵) فیلتر نهایی: اعتبار ورود، امتیاز، ریسک پرتفوی
  const exposure = {};
  for (const s of active) for (const [c, v] of Object.entries(exposureOf(s))) exposure[c] = (exposure[c] || 0) + v;
  const activeSyms = new Set(active.map((s) => s.symbol));
  let activeCount = active.length;
  let dayCount = today.length;
  const takenSyms = new Set();

  pool.sort((a, b) => b.score - a.score || b.candleT - a.candleT);
  const created = [];
  const skip = (c, why) => scan.skipped.push({ symbol: c.symbol, strategy: c.strategy, dir: c.dir, score: c.score, why });

  for (const c of pool) {
    if (breaker) { skip(c, 'قطع‌کنندهٔ ضرر روزانه'); continue; }
    if (paused[c.strategy]) { skip(c, `استراتژی موقتاً متوقف (میانگین R اخیر ${paused[c.strategy]})`); continue; }
    if (c.score < threshold) { skip(c, `امتیاز ${c.score} < آستانه ${threshold}`); continue; }
    if (activeSyms.has(c.symbol) || takenSyms.has(c.symbol)) { skip(c, 'نماد سیگنال باز دارد'); continue; }
    if (activeCount >= CFG.maxActive) { skip(c, 'سقف سیگنال هم‌زمان'); continue; }
    if (dayCount >= CFG.dailyMax) { skip(c, 'سقف روزانه'); continue; }

    const id = `${c.symbol}-${c.candleT}`;
    if (state.signals.some((s) => s.id === id)) { skip(c, 'تکراری'); continue; }

    // ورود هنوز معتبر است؟ (قیمت از ورود زیاد دور نشده، SL/TP1 هنوز لمس نشده)
    const d = data[c.symbol];
    const dirSign = c.dir === 'BUY' ? 1 : -1;
    const fake = { ...c, id, dir: c.dir, entry: c.entry, slInitial: c.sl, tp: c.tp, createdAt: now, candleT: c.candleT };
    const probe = advance(fake, d.all, now, 0);
    const livePx = d.all[d.all.length - 1].c;
    const drift = (dirSign * (livePx - c.entry)) / c.risk;
    if (probe.closed || probe.hits.tp1 || drift > 0.5 || drift < -0.5) { skip(c, 'ورود دیگر معتبر نیست (قیمت دور شده)'); continue; }

    // هم‌پوشانی ارز
    const exp = exposureOf(c);
    if (Object.entries(exp).some(([cur, v]) => Math.abs((exposure[cur] || 0) + v) > CFG.maxCurrencyExposure)) {
      skip(c, 'تمرکز بیش از حد روی یک ارز'); continue;
    }

    for (const [cur, v] of Object.entries(exp)) exposure[cur] = (exposure[cur] || 0) + v;
    takenSyms.add(c.symbol);
    activeCount++;
    dayCount++;
    const sig = {
      id,
      symbol: c.symbol,
      label: symbolByCode[c.symbol].fa,
      dir: c.dir,
      tf: 'M15',
      strategy: c.strategy,
      strategyFa: STRATEGY_FA[c.strategy],
      entry: c.entry,
      slInitial: c.sl,
      sl: c.sl,
      tp: c.tp,
      risk: c.risk,
      atr: c.atr,
      score: c.score,
      grade: c.grade,
      roomR: c.roomR,
      costR: c.costR,
      reasons: c.reasons,
      candleT: c.candleT,
      createdAt: now,
      closed: false,
      status: 'ACTIVE',
      stage: 0,
      hits: { tp1: null, tp2: null, tp3: null },
      price: livePx,
      floatR: Number((drift).toFixed(2)),
      tg: { new: false, sent: {} },
    };
    state.signals.unshift(sig);
    created.push(sig);
  }

  // ---------- ۶) نگهداری و آمار
  const cutoff = now - CFG.keepDays * 86_400_000;
  state.signals = state.signals.filter((s) => !s.closed || s.closedAt >= cutoff);
  state.signals.sort((a, b) => b.createdAt - a.createdAt);
  state.stats = buildStats(state.signals, now);
  state.scan = scan;
  state.today = { count: dayCount, target: CFG.dailyTarget, r: scan.todayR };
  state.updatedAt = now;
  state.runs = (prev.runs || 0) + 1;
  state.created = created.map((s) => s.id);
  state.meta = { symbols: Object.fromEntries(SYMBOLS.map((x) => [x.code, { fa: x.fa, digits: x.digits }])) };
  return state;
}
