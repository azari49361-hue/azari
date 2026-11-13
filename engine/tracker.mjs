/**
 * پیگیری سیگنال‌ها — تابع خالص: وضعیت هر سیگنال همیشه از اول و از روی کندل‌های واقعی بعد از ورود بازسازی می‌شود،
 * پس اجرای تکراری/دیرهنگام Actions هیچ‌وقت نتیجه را خراب نمی‌کند (idempotent).
 *
 * مدیریت معامله (سه پله، هر کدام ۱/۳ حجم):
 *   TP1 (=1R)  → حد ضرر به نقطهٔ ورود (بدون ریسک)
 *   TP2 (=2R)  → حد ضرر به TP1 (قفل سود)
 *   TP3 (=3R)  → بسته‌شدن کامل
 * اگر در یک کندل هم حد ضرر و هم هدف لمس شده باشد، «بدبینانه» فرض می‌شود حد ضرر اول خورده است.
 */
const M15 = 15 * 60_000;

/** R نهایی از روی ۳ پله: پله‌های پر‌شده در TP خودشان، بقیه در قیمت خروج. */
export function realizedR(sig, legs, exitPrice) {
  const d = sig.dir === 'BUY' ? 1 : -1;
  const risk = Math.abs(sig.entry - sig.slInitial);
  let total = 0;
  for (let k = 0; k < 3; k++) {
    const px = legs[k] ? sig.tp[k] : exitPrice;
    total += (d * (px - sig.entry)) / risk;
  }
  // هزینهٔ اسپرد (اگر روی سیگنال ثبت شده) از بازده کم می‌شود تا آمار صادقانه باشد
  return total / 3 - (sig.costR || 0);
}

/**
 * @param sig سیگنال ذخیره‌شده
 * @param bars همهٔ کندل‌های M15 (شامل کندل در حال شکل‌گیری)، صعودی
 * @param now زمان فعلی (ms)
 * @returns سیگنال به‌روزشده (کپی)
 */
export function advance(sig, bars, now, expireMs) {
  const s = { ...sig, hits: { tp1: null, tp2: null, tp3: null }, closed: false, result: null, closedAt: null, exitPrice: null };
  const d = s.dir === 'BUY' ? 1 : -1;
  const legs = [false, false, false];
  let curSl = s.slInitial;
  let lastClose = s.entry;
  const at = (bar) => Math.min(bar.t + M15, now);

  const close = (result, price, bar) => {
    s.closed = true;
    s.result = result;
    s.exitPrice = price;
    s.closedAt = at(bar);
    s.r = Number(realizedR(s, legs, price).toFixed(3));
  };

  outer: for (const bar of bars) {
    if (bar.t < s.candleT + M15) continue; // فقط کندل‌های بعد از کندل سیگنال
    lastClose = bar.c;
    const hiM = d > 0 ? bar.h : -bar.l;
    const loM = d > 0 ? bar.l : -bar.h;

    // ۱) حد ضرر جاری (بدبینانه: قبل از اهداف)
    if (loM <= d * curSl) {
      const result = !legs[0] ? 'SL' : !legs[1] ? 'BE' : 'TP1_LOCK';
      close(result, curSl, bar);
      break;
    }
    // ۲) اهداف به‌ترتیب؛ پس از هر هدف، حد ضرر سفت می‌شود و در همان کندل دوباره بدبینانه بررسی می‌شود
    for (let k = 0; k < 3; k++) {
      if (legs[k]) continue;
      if (hiM < d * s.tp[k]) break;
      legs[k] = true;
      s.hits[`tp${k + 1}`] = at(bar);
      if (k === 2) {
        close('TP3', s.tp[2], bar);
        break outer;
      }
      curSl = k === 0 ? s.entry : s.tp[0];
      if (loM <= d * curSl) {
        close(k === 0 ? 'BE' : 'TP1_LOCK', curSl, bar);
        break outer;
      }
    }
  }

  s.sl = curSl;
  s.stage = legs[1] ? 2 : legs[0] ? 1 : 0;

  if (!s.closed && expireMs && now - s.createdAt > expireMs) {
    const lastBar = bars[bars.length - 1] || { t: now - M15 };
    close('EXPIRED', lastClose, lastBar);
    s.closedAt = now;
  }
  if (!s.closed) {
    s.price = lastClose;
    s.floatR = Number(((d * (lastClose - s.entry)) / Math.abs(s.entry - s.slInitial)).toFixed(2));
    s.status = s.stage === 0 ? 'ACTIVE' : s.stage === 1 ? 'TP1' : 'TP2';
  } else {
    s.status = s.result;
    delete s.price;
    delete s.floatR;
  }
  return s;
}

/** برچسب‌های فارسی نتیجه. */
export const RESULT_FA = {
  SL: 'حد ضرر',
  BE: 'سربه‌سر پس از TP1',
  TP1_LOCK: 'سود قفل‌شده (TP1) پس از TP2',
  TP3: 'هر سه هدف',
  EXPIRED: 'منقضی (بسته با قیمت بازار)',
};
