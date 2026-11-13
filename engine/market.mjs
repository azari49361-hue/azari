/**
 * وضعیت باز/بسته بودن بازار فارکس و طلا (بر پایهٔ ساعت نیویورک؛ تغییر ساعت تابستانی خودکار لحاظ می‌شود).
 * بسته: از جمعه ۱۷:۰۰ نیویورک تا یکشنبه ۱۷:۰۰ نیویورک. کریپتو همیشه باز است.
 */
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });

export function fxClosed(now) {
  const parts = fmt.formatToParts(new Date(now));
  const wd = parts.find((p) => p.type === 'weekday').value;
  const h = Number(parts.find((p) => p.type === 'hour').value);
  if (wd === 'Sat') return true;
  if (wd === 'Fri' && h >= 17) return true;
  if (wd === 'Sun' && h < 17) return true;
  return false;
}
