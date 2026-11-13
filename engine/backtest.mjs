#!/usr/bin/env node
/**
 * بک‌تست «والک‌فوروارد» با همان موتور زنده: زمان را ۱۵ دقیقه‌ای جلو می‌بریم و در هر گام دقیقاً runOnce را با
 * داده‌ای که تا آن لحظه وجود داشته اجرا می‌کنیم (همان فیلترها، ریسک پرتفوی، آستانهٔ تطبیقی و مدیریت معامله).
 * بنابراین نتیجه همان چیزی است که اگر موتور در آن روزها زنده بود می‌داد.
 *
 * اجرا:  node engine/backtest.mjs [روز=40]      (نیازمند اینترنت برای دریافت داده)
 * محدودیت‌ها (صادقانه): اسپرد/لغزش/کمیسیون لحاظ نشده؛ داده Yahoo است نه بروکر شما؛ گذشته ≠ آینده.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SYMBOLS, CFG } from './config.mjs';
import { fetchBars } from './data.mjs';
import { emptyState, runOnce } from './runner.mjs';
import { summarize } from './stats.mjs';

const M15 = 900_000;

export async function simulate(barsBySym, { days = 40, warmupBars = 600, window = 1200, onProgress } = {}) {
  const saved = { keepDays: CFG.keepDays, expire: CFG.expireHours };
  CFG.keepDays = 3650;
  try {
    const all = Object.values(barsBySym).flat();
    let endT = 0;
    for (const b of all) if (b.t > endT) endT = b.t; // (نه Math.max(...) — با ده‌ها هزار کندل پشتهٔ فراخوانی پر می‌شود)
    endT += M15;
    const startT = endT - days * 86_400_000;
    const ptr = {};
    let state = emptyState();
    let steps = 0;
    for (let now = Math.ceil(startT / M15) * M15 + 60_000; now <= endT + 60_000; now += M15) {
      const fetcher = (sym) => {
        const bars = barsBySym[sym.code] || [];
        let p = ptr[sym.code] ?? 0;
        while (p < bars.length && bars[p].t + M15 <= now) p++;
        ptr[sym.code] = p;
        if (p < warmupBars) return { bars: [], source: null, errors: ['warmup'] };
        return { bars: bars.slice(Math.max(0, p - window), p), source: 'backtest', errors: [] };
      };
      state = await runOnce(state, fetcher, now);
      steps++;
      if (onProgress && steps % 500 === 0) onProgress(steps, state);
    }
    return { state, startT, endT, days };
  } finally {
    CFG.keepDays = saved.keepDays;
    CFG.expireHours = saved.expire;
  }
}

export function report(sim) {
  const sigs = sim.state.signals;
  const closed = sigs.filter((s) => s.closed && Number.isFinite(s.r));
  const open = sigs.filter((s) => !s.closed).length;
  const by = (key) => {
    const g = {};
    for (const s of closed) (g[s[key]] ||= []).push(s);
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, summarize(v)]).sort((a, b) => b[1].totalR - a[1].totalR));
  };
  // کاهش سرمایه (drawdown) بر حسب R به ترتیب زمان بسته‌شدن
  let cum = 0, peak = 0, maxDd = 0, streak = 0, maxStreak = 0;
  for (const s of [...closed].sort((a, b) => a.closedAt - b.closedAt)) {
    cum += s.r; peak = Math.max(peak, cum); maxDd = Math.max(maxDd, peak - cum);
    if (s.r < 0) { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0;
  }
  const perDay = new Map();
  for (const s of sigs) {
    const k = new Date(s.createdAt + 3.5 * 3_600_000).toISOString().slice(0, 10);
    perDay.set(k, (perDay.get(k) || 0) + 1);
  }
  const counts = [...perDay.values()];
  return {
    generatedAt: Date.now(),
    days: sim.days,
    period: { from: new Date(sim.startT).toISOString(), to: new Date(sim.endT).toISOString() },
    total: summarize(closed),
    open,
    signalsPerDay: {
      avg: counts.length ? Number((counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)) : 0,
      min: counts.length ? Math.min(...counts) : 0,
      max: counts.length ? Math.max(...counts) : 0,
      daysAtLeastTarget: counts.filter((c) => c >= CFG.dailyTarget).length,
      activeDays: counts.length,
    },
    maxDrawdownR: Number(maxDd.toFixed(2)),
    maxLossStreak: maxStreak,
    byStrategy: by('strategy'),
    bySymbol: by('symbol'),
    byGrade: by('grade'),
    config: { minScore: CFG.minScore, floorScore: CFG.floorScore, dailyTarget: CFG.dailyTarget },
    note: 'اسپرد، لغزش و کمیسیون لحاظ نشده؛ داده Yahoo است؛ نتیجهٔ گذشته تضمین آینده نیست.',
  };
}

export function printReport(r) {
  const line = (k, s) => `  ${k.padEnd(10)} n=${String(s.n).padStart(3)}  برد ${String(s.winRate).padStart(5)}%  میانگین R ${String(s.avgR).padStart(6)}  جمع R ${String(s.totalR).padStart(6)}  PF ${s.profitFactor ?? '-'}  SL ${s.slRate}%  TP1 ${s.tp1Rate}%`;
  console.log(`\n=== بک‌تست ${r.days} روزه (${r.period.from.slice(0, 10)} → ${r.period.to.slice(0, 10)}) ===`);
  console.log(line('کل', r.total));
  console.log(`  سیگنال/روز: میانگین ${r.signalsPerDay.avg} (حداقل ${r.signalsPerDay.min}، حداکثر ${r.signalsPerDay.max}) | روزهای ≥ هدف ${CFG.dailyTarget}: ${r.signalsPerDay.daysAtLeastTarget} از ${r.signalsPerDay.activeDays}`);
  console.log(`  بیشینهٔ افت: ${r.maxDrawdownR}R | بیشترین ضرر پیاپی: ${r.maxLossStreak} | هنوز باز: ${r.open}`);
  for (const [title, g] of [['استراتژی', r.byStrategy], ['نماد', r.bySymbol], ['درجه', r.byGrade]]) {
    console.log(`\n-- بر اساس ${title}`);
    for (const [k, s] of Object.entries(g)) console.log(line(k, s));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const days = Number(process.argv[2]) || 40;
  const barsBySym = {};
  for (const sym of SYMBOLS) {
    const r = await fetchBars(sym, { range: '60d', futuresFallback: true });
    if (r.bars.length) { barsBySym[sym.code] = r.bars; console.log(`${sym.code}: ${r.bars.length} کندل از ${r.source}`); }
    else console.log(`${sym.code}: ❌ ${r.errors.join(' | ')}`);
  }
  if (!Object.keys(barsBySym).length) { console.error('هیچ داده‌ای دریافت نشد.'); process.exit(1); }
  const sim = await simulate(barsBySym, { days, onProgress: (n) => console.log(`... ${n} گام`) });
  const rep = report(sim);
  printReport(rep);
  const dir = process.env.STATE_DIR || './out';
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'backtest.json'), JSON.stringify(rep));
}
