/**
 * دریافت داده (فقط قیمت واقعی؛ هیچ مقداری ساخته نمی‌شود).
 * ترتیب منابع: Yahoo Finance (رایگان، بدون کلید) ← Twelve Data (اختیاری، با کلید) ← biquote (فقط طلا).
 * قالب کندل در کل پروژه: { t: زمان بازشدن (ms, UTC), o, h, l, c }
 */
import { CFG } from './config.mjs';

const UA = 'Mozilla/5.0 (compatible; AzariTradeAI/3.0; +https://github.com)';
const M15 = 15 * 60_000;

async function fetchJson(url, { timeoutMs = 20_000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (err.fatal) break;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// ------------------------------------------------------------------ parsers (خالص و تست‌شده)

export function parseYahoo(json) {
  const r = json?.chart?.result?.[0];
  if (!r?.timestamp || !r?.indicators?.quote?.[0]) throw new Error(json?.chart?.error?.description || 'پاسخ Yahoo معتبر نیست');
  const q = r.indicators.quote[0];
  const bars = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if ([o, h, l, c].some((v) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) continue;
    bars.push({ t: r.timestamp[i] * 1000, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c });
  }
  return normalize(bars);
}

export function parseTwelve(json) {
  if (json?.status === 'error' || !Array.isArray(json?.values)) throw new Error(json?.message || 'پاسخ TwelveData معتبر نیست');
  const bars = json.values
    .map((v) => ({
      t: Date.parse(`${String(v.datetime).replace(' ', 'T')}Z`),
      o: parseFloat(v.open),
      h: parseFloat(v.high),
      l: parseFloat(v.low),
      c: parseFloat(v.close),
    }))
    .filter((b) => Number.isFinite(b.t) && [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0));
  return normalize(bars);
}

export function parseBiquote(json) {
  if (!Array.isArray(json?.bars)) throw new Error('پاسخ biquote معتبر نیست');
  const bars = json.bars
    .filter((b) => b.isOpen !== true)
    .map((b) => ({ t: Date.parse(b.openTime), o: +b.open, h: +b.high, l: +b.low, c: +b.close }))
    .filter((b) => Number.isFinite(b.t) && [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0));
  return normalize(bars);
}

/** مرتب‌سازی صعودی، حذف تکراری‌ها. (منابع مختلف ترتیب متفاوتی دارند.) */
export function normalize(bars) {
  const map = new Map();
  for (const b of bars) map.set(b.t, b);
  return [...map.values()].sort((a, b) => a.t - b.t);
}

// ------------------------------------------------------------------ providers

async function yahoo(sym, range = '10d') {
  // YAHOO_BASE فقط برای تست محلی است (سرور ساختگی)
  const hosts = process.env.YAHOO_BASE ? [process.env.YAHOO_BASE] : ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  let err;
  for (const h of hosts) {
    try {
      const url = `${h}/v8/finance/chart/${encodeURIComponent(sym.yahoo)}?interval=15m&range=${range}&includePrePost=false`;
      return parseYahoo(await fetchJson(url));
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

async function twelve(sym) {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error('کلید TwelveData تنظیم نشده');
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym.td)}&interval=15min&outputsize=1500&timezone=UTC&apikey=${key}`;
  return parseTwelve(await fetchJson(url));
}

async function biquote(sym) {
  if (sym.code !== 'XAUUSD') throw new Error('biquote فقط برای طلا');
  return parseBiquote(await fetchJson(`https://biquote.io/api/XAUUSD/ohlc?interval=15m&limit=1000`));
}

/** آخرین کندل‌های M15 نماد را از اولین منبع سالم می‌گیرد. */
export async function fetchBars(sym, { range = '10d' } = {}) {
  const chain = [
    ['yahoo', () => yahoo(sym, range)],
    ['twelvedata', () => twelve(sym)],
    ['biquote', () => biquote(sym)],
  ];
  const errors = [];
  for (const [name, fn] of chain) {
    try {
      const bars = await fn();
      if (bars.length >= 150) return { bars, source: name, errors };
      errors.push(`${name}: داده کم (${bars.length} کندل)`);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return { bars: [], source: null, errors };
}

// ------------------------------------------------------------------ helpers

/** فقط کندل‌های کاملاً بسته‌شده (زمان بسته‌شدن ≤ now). */
export function closedOnly(bars, now, tfMs = M15) {
  return bars.filter((b) => b.t + tfMs <= now);
}

/**
 * تجمیع کندل M15 به تایم‌فریم بالاتر (H1/H4) روی مرزهای UTC.
 * هر کندل تجمیعی `ct` (زمان بسته‌شدن) دارد؛ فقط گروه‌هایی که پایانشان ≤ آخرین کندل بستهٔ M15 است برمی‌گردند.
 */
export function aggregate(bars15, minutes, lastClosedEnd) {
  const span = minutes * 60_000;
  const groups = new Map();
  for (const b of bars15) {
    const k = Math.floor(b.t / span) * span;
    const g = groups.get(k);
    if (!g) groups.set(k, { t: k, ct: k + span, o: b.o, h: b.h, l: b.l, c: b.c, n: 1 });
    else {
      g.h = Math.max(g.h, b.h);
      g.l = Math.min(g.l, b.l);
      g.c = b.c;
      g.n++;
    }
  }
  return [...groups.values()].sort((a, b) => a.t - b.t).filter((g) => g.ct <= lastClosedEnd);
}
