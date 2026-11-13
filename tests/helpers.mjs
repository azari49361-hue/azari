/** دادهٔ مصنوعی قابل تکرار (فقط برای تست مکانیک؛ لبهٔ سودآوری را اثبات نمی‌کند). */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

const M15 = 900_000;
export const isFxClosed = (t) => {
  const d = new Date(t);
  const dow = d.getUTCDay();
  const h = d.getUTCHours();
  return (dow === 5 && h >= 21) || dow === 6 || (dow === 0 && h < 22);
};

/** سری M15 با رژیم‌های روند صعودی/نزولی/رِنج. endMs باید مضرب ۱۵ دقیقه باشد (زمان بازشدن آخرین کندل = endMs - 15m). */
export function synth({ start = 1.1, sigma = 0.0008, days = 30, endMs, seed = 1, crypto = false }) {
  const r = rng(seed);
  const n = days * 96;
  const bars = [];
  let p = start;
  let regime = 0;
  let left = 0;
  for (let k = 0; k < n; k++) {
    const t = endMs - (n - k) * M15;
    if (!crypto && isFxClosed(t)) continue;
    if (left <= 0) {
      const u = r();
      regime = u < 0.35 ? 1 : u < 0.7 ? -1 : 0;
      left = 40 + Math.floor(r() * 120);
    }
    left--;
    const drift = regime * 0.12 * sigma;
    const pull = regime === 0 ? (start - p) * 0.01 : 0;
    const o = p;
    let c = o + drift + pull + sigma * gauss(r);
    const wick = () => Math.abs(gauss(r)) * sigma * 0.5;
    const h = Math.max(o, c) + wick();
    const l = Math.min(o, c) - wick();
    bars.push({ t, o, h, l, c });
    p = c;
  }
  return bars;
}
