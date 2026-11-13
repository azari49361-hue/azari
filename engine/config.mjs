/**
 * تنظیمات مرکزی موتور سیگنال.
 * همهٔ مقدارها با متغیر محیطی (در GitHub: Settings → Secrets and variables → Actions → Variables) قابل تغییرند.
 */

const num = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] !== undefined ? v : def;
};

/**
 * نمادهای تحت پوشش. هر نماد: کد داخلی، نام فارسی، نماد Yahoo، تعداد اعشار، حداقل ATR (فیلتر بازار مرده)،
 * spr = اسپرد معمول بروکر (واحد قیمت؛ برای محاسبهٔ هزینهٔ واقعی)، و ساعت‌های مجاز معامله به UTC. فهرست عمداً متنوع است تا بدون پایین‌آوردن کیفیت، تعداد فرصت روزانه کافی باشد.
 */
export const SYMBOLS = [
  { code: 'XAUUSD', fa: 'طلا', yahoo: 'XAUUSD=X', td: 'XAU/USD', digits: 2, minAtr: 1.2, spr: 0.25, hours: [7, 21], cls: 'metal', base: 'XAU', quote: 'USD' },
  { code: 'EURUSD', fa: 'یورو/دلار', yahoo: 'EURUSD=X', td: 'EUR/USD', digits: 5, minAtr: 0.00035, spr: 0.0001, hours: [6, 21], cls: 'fx', base: 'EUR', quote: 'USD' },
  { code: 'GBPUSD', fa: 'پوند/دلار', yahoo: 'GBPUSD=X', td: 'GBP/USD', digits: 5, minAtr: 0.00045, spr: 0.00013, hours: [6, 21], cls: 'fx', base: 'GBP', quote: 'USD' },
  { code: 'USDJPY', fa: 'دلار/ین', yahoo: 'USDJPY=X', td: 'USD/JPY', digits: 3, minAtr: 0.045, spr: 0.012, hours: [0, 21], cls: 'fx', base: 'USD', quote: 'JPY' },
  { code: 'AUDUSD', fa: 'دلار استرالیا', yahoo: 'AUDUSD=X', td: 'AUD/USD', digits: 5, minAtr: 0.00028, spr: 0.00013, hours: [0, 21], cls: 'fx', base: 'AUD', quote: 'USD' },
  { code: 'NZDUSD', fa: 'دلار نیوزیلند', yahoo: 'NZDUSD=X', td: 'NZD/USD', digits: 5, minAtr: 0.00025, spr: 0.00016, hours: [0, 21], cls: 'fx', base: 'NZD', quote: 'USD' },
  { code: 'USDCAD', fa: 'دلار/کانادا', yahoo: 'USDCAD=X', td: 'USD/CAD', digits: 5, minAtr: 0.00035, spr: 0.00016, hours: [6, 21], cls: 'fx', base: 'USD', quote: 'CAD' },
  { code: 'USDCHF', fa: 'دلار/فرانک', yahoo: 'USDCHF=X', td: 'USD/CHF', digits: 5, minAtr: 0.00032, spr: 0.00016, hours: [6, 21], cls: 'fx', base: 'USD', quote: 'CHF' },
  { code: 'EURJPY', fa: 'یورو/ین', yahoo: 'EURJPY=X', td: 'EUR/JPY', digits: 3, minAtr: 0.06, spr: 0.02, hours: [0, 21], cls: 'fx', base: 'EUR', quote: 'JPY' },
  { code: 'GBPJPY', fa: 'پوند/ین', yahoo: 'GBPJPY=X', td: 'GBP/JPY', digits: 3, minAtr: 0.08, spr: 0.03, hours: [0, 21], cls: 'fx', base: 'GBP', quote: 'JPY' },
  { code: 'EURGBP', fa: 'یورو/پوند', yahoo: 'EURGBP=X', td: 'EUR/GBP', digits: 5, minAtr: 0.00022, spr: 0.00014, hours: [6, 21], cls: 'fx', base: 'EUR', quote: 'GBP' },
  { code: 'AUDJPY', fa: 'استرالیا/ین', yahoo: 'AUDJPY=X', td: 'AUD/JPY', digits: 3, minAtr: 0.05, spr: 0.025, hours: [0, 21], cls: 'fx', base: 'AUD', quote: 'JPY' },
  { code: 'NZDJPY', fa: 'نیوزیلند/ین', yahoo: 'NZDJPY=X', td: 'NZD/JPY', digits: 3, minAtr: 0.045, spr: 0.03, hours: [0, 21], cls: 'fx', base: 'NZD', quote: 'JPY' },
  { code: 'CADJPY', fa: 'کانادا/ین', yahoo: 'CADJPY=X', td: 'CAD/JPY', digits: 3, minAtr: 0.05, spr: 0.03, hours: [0, 21], cls: 'fx', base: 'CAD', quote: 'JPY' },
  { code: 'CHFJPY', fa: 'فرانک/ین', yahoo: 'CHFJPY=X', td: 'CHF/JPY', digits: 3, minAtr: 0.05, spr: 0.035, hours: [0, 21], cls: 'fx', base: 'CHF', quote: 'JPY' },
  { code: 'EURAUD', fa: 'یورو/استرالیا', yahoo: 'EURAUD=X', td: 'EUR/AUD', digits: 5, minAtr: 0.0004, spr: 0.0003, hours: [0, 21], cls: 'fx', base: 'EUR', quote: 'AUD' },
  { code: 'GBPAUD', fa: 'پوند/استرالیا', yahoo: 'GBPAUD=X', td: 'GBP/AUD', digits: 5, minAtr: 0.0005, spr: 0.0004, hours: [0, 21], cls: 'fx', base: 'GBP', quote: 'AUD' },
  { code: 'EURCAD', fa: 'یورو/کانادا', yahoo: 'EURCAD=X', td: 'EUR/CAD', digits: 5, minAtr: 0.0004, spr: 0.0003, hours: [6, 21], cls: 'fx', base: 'EUR', quote: 'CAD' },
  { code: 'EURCHF', fa: 'یورو/فرانک', yahoo: 'EURCHF=X', td: 'EUR/CHF', digits: 5, minAtr: 0.0002, spr: 0.00018, hours: [6, 21], cls: 'fx', base: 'EUR', quote: 'CHF' },
  { code: 'GBPCHF', fa: 'پوند/فرانک', yahoo: 'GBPCHF=X', td: 'GBP/CHF', digits: 5, minAtr: 0.0004, spr: 0.0003, hours: [6, 21], cls: 'fx', base: 'GBP', quote: 'CHF' },
  { code: 'AUDCAD', fa: 'استرالیا/کانادا', yahoo: 'AUDCAD=X', td: 'AUD/CAD', digits: 5, minAtr: 0.00025, spr: 0.0003, hours: [0, 21], cls: 'fx', base: 'AUD', quote: 'CAD' },
  { code: 'AUDNZD', fa: 'استرالیا/نیوزیلند', yahoo: 'AUDNZD=X', td: 'AUD/NZD', digits: 5, minAtr: 0.00018, spr: 0.0003, hours: [0, 12], cls: 'fx', base: 'AUD', quote: 'NZD' },
  { code: 'BTCUSD', fa: 'بیت‌کوین', yahoo: 'BTC-USD', td: 'BTC/USD', digits: 1, minAtr: 40, spr: 25, hours: [0, 24], cls: 'crypto', base: 'BTC', quote: 'USD' },
  { code: 'ETHUSD', fa: 'اتریوم', yahoo: 'ETH-USD', td: 'ETH/USD', digits: 2, minAtr: 3, spr: 1.5, hours: [0, 24], cls: 'crypto', base: 'ETH', quote: 'USD' },
];

export const CFG = {
  /** تایم‌فریم تصمیم (دقیقه) — فقط روی کندل بسته تصمیم گرفته می‌شود. */
  tfMinutes: 15,
  /** حداقل امتیاز کیفیت (۰ تا ۱۰۰). */
  minScore: num('MIN_SCORE', 72),
  /** کف امتیاز هنگام «عقب بودن از هدف روزانه» (هرگز پایین‌تر از این نمی‌رود). */
  floorScore: num('FLOOR_SCORE', 66),
  /** هدف حداقل تعداد سیگنال در شبانه‌روز (به وقت تهران). */
  dailyTarget: num('DAILY_TARGET', 10),
  /** سقف سیگنال در شبانه‌روز تا کیفیت فدای تعداد نشود. */
  dailyMax: num('DAILY_MAX', 24),
  /** حداقل نسبت پاداش به ریسک تا نزدیک‌ترین مانع (حمایت/مقاومت). */
  minRoomR: num('MIN_ROOM_R', 1.3),
  /** سقف همزمان فعال برای یک ارز (مثلاً کوتاه‌کردن دلار روی چند جفت‌ارز هم‌زمان). */
  maxCurrencyExposure: num('MAX_CURRENCY_EXPOSURE', 2),
  /** سقف کل سیگنال‌های هم‌زمان فعال. */
  maxActive: num('MAX_ACTIVE', 8),
  /** اگر امروز مجموع R از این مقدار بدتر شد، تا فردا سیگنال جدید صادر نمی‌شود (قطع‌کنندهٔ ضرر). */
  dailyLossLimitR: num('DAILY_LOSS_LIMIT_R', -4),
  /** سیگنال بازِ قدیمی‌تر از این (ساعت) بسته می‌شود. */
  expireHours: num('EXPIRE_HOURS', 20),
  /** حداکثر کهنگی آخرین کندل بسته برای اینکه داده «زنده» حساب شود (دقیقه). */
  maxDataAgeMin: num('MAX_DATA_AGE_MIN', 40),
  /** تاریخچهٔ نگهداری‌شده در state (روز). */
  keepDays: num('KEEP_DAYS', 30),
  /** اگر اسپرد معمول بیش از این کسر از ریسک (فاصلهٔ حد ضرر) باشد، سیگنال صادر نمی‌شود (هزینه سود را می‌خورد). */
  maxCostR: num('MAX_COST_R', 0.18),
  /** ضریب حد ضرر (کف/سقف بر حسب ATR). */
  slMinAtr: 1.0,
  slMaxAtr: 2.2,
  /** پله‌های هدف بر حسب R. */
  tpR: [1, 2, 3],
  /** نمایش تعداد کندل برای نمودار سایت. */
  chartBars: 120,
  /** اگر ۲۰ سیگنال آخر یک استراتژی میانگین R کمتر از این داشت، موقتاً متوقف می‌شود. */
  strategyPauseAvgR: num('STRATEGY_PAUSE_AVG_R', -0.25),
  timezone: 'Asia/Tehran',
};

export const STRATEGY_FA = {
  pullback: 'پولبک به میانگین در جهت روند',
  breakout: 'شکست با مومنتوم',
  cross: 'تقاطع EMA با تأیید روند',
  reversion: 'بازگشت از باند بولینگر (بازار رِنج)',
};

export const symbolByCode = Object.fromEntries(SYMBOLS.map((s) => [s.code, s]));
