/** آمار عملکرد از روی سیگنال‌های بسته‌شده — صادقانه و بر پایهٔ R (نه فقط نرخ برد). */

export function summarize(closed) {
  const n = closed.length;
  if (!n) return { n: 0, winRate: null, avgR: null, totalR: 0, profitFactor: null, slRate: null, tp1Rate: null };
  const wins = closed.filter((s) => s.r > 0);
  const losses = closed.filter((s) => s.r < 0);
  const grossWin = wins.reduce((a, s) => a + s.r, 0);
  const grossLoss = Math.abs(losses.reduce((a, s) => a + s.r, 0));
  const totalR = closed.reduce((a, s) => a + s.r, 0);
  return {
    n,
    winRate: Number(((wins.length / n) * 100).toFixed(1)),
    avgR: Number((totalR / n).toFixed(3)),
    totalR: Number(totalR.toFixed(2)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? null : null,
    slRate: Number(((closed.filter((s) => s.result === 'SL').length / n) * 100).toFixed(1)),
    tp1Rate: Number(((closed.filter((s) => s.hits?.tp1).length / n) * 100).toFixed(1)),
  };
}

export function buildStats(signals, now) {
  const closed = signals.filter((s) => s.closed && Number.isFinite(s.r));
  const within = (days) => closed.filter((s) => now - s.closedAt <= days * 86_400_000);
  const group = (key) => {
    const out = {};
    for (const s of closed) (out[s[key]] ||= []).push(s);
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, summarize(v)]));
  };
  return {
    all: summarize(closed),
    d7: summarize(within(7)),
    byStrategy: group('strategy'),
    bySymbol: group('symbol'),
  };
}

/** استراتژی‌ای که ۲۰ نتیجهٔ آخرش میانگین R بدتر از حد داشته، موقتاً متوقف می‌شود. */
export function pausedStrategies(signals, threshold, minSamples = 20) {
  const paused = {};
  const byStrat = {};
  for (const s of signals) if (s.closed && Number.isFinite(s.r)) (byStrat[s.strategy] ||= []).push(s);
  for (const [name, list] of Object.entries(byStrat)) {
    const last = list.sort((a, b) => b.closedAt - a.closedAt).slice(0, minSamples);
    if (last.length < minSamples) continue;
    const avg = last.reduce((a, s) => a + s.r, 0) / last.length;
    if (avg < threshold) paused[name] = Number(avg.toFixed(2));
  }
  return paused;
}
