/**
 * ارسال به تلگرام + قالب پیام‌ها.
 * توکن و شناسهٔ کانال فقط از متغیر محیطی (GitHub Secrets) خوانده می‌شود: TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID
 * ارسال بر پایهٔ «وضعیت ذخیره‌شده» است، نه رویداد گذرا: اگر ارسالی شکست بخورد، اجرای بعدی دوباره تلاش می‌کند
 * و هیچ پیامی دوبار نمی‌رود.
 */
import { symbolByCode } from './config.mjs';
import { RESULT_FA } from './tracker.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function fmtPrice(sym, v) {
  return Number(v).toFixed(symbolByCode[sym].digits);
}

export function tehranTime(ms) {
  return new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms));
}

export function newSignalMessage(s) {
  const buy = s.dir === 'BUY';
  const f = (v) => fmtPrice(s.symbol, v);
  return [
    `${buy ? '🟢 <b>سیگنال خرید</b>' : '🔴 <b>سیگنال فروش</b>'} | <b>${s.symbol}</b> (${esc(s.label)}) | M15`,
    `⭐ کیفیت: <b>${s.grade}</b> (امتیاز ${s.score} از ۱۰۰)`,
    '',
    `📍 ورود: <code>${f(s.entry)}</code>`,
    `🛑 حد ضرر: <code>${f(s.slInitial)}</code>`,
    `🎯 TP1: <code>${f(s.tp[0])}</code> (1R)`,
    `🎯 TP2: <code>${f(s.tp[1])}</code> (2R)`,
    `🎯 TP3: <code>${f(s.tp[2])}</code> (3R)`,
    '',
    `📊 استراتژی: ${esc(s.strategyFa)}`,
    ...s.reasons.slice(0, 3).map((r) => `• ${esc(r)}`),
    '',
    `⏱ ${tehranTime(s.createdAt)} (تهران)`,
    '',
    '🔒 <b>مدیریت:</b> با رسیدن به TP1 حد ضرر را روی نقطهٔ ورود ببرید؛ با TP2 حد ضرر را روی TP1 بگذارید.',
    `⚠️ اگر قیمت بیش از ${f(s.risk * 0.5)} از نقطهٔ ورود دور شده، وارد نشوید. ریسک هر معامله ≤ ۱٪ سرمایه.`,
    '<i>تحلیل است، توصیهٔ سرمایه‌گذاری نیست.</i>',
  ].join('\n');
}

export function updateMessage(s, kind) {
  const f = (v) => fmtPrice(s.symbol, v);
  const head = `<b>${s.symbol}</b> ${s.dir === 'BUY' ? 'خرید' : 'فروش'} @ ${f(s.entry)}`;
  switch (kind) {
    case 'tp1': return `✅ ${head}\n🎯 <b>TP1</b> رسید (${f(s.tp[0])})\n🔒 حد ضرر را روی ورود (${f(s.entry)}) بگذارید — معامله بدون ریسک شد.`;
    case 'tp2': return `✅✅ ${head}\n🎯 <b>TP2</b> رسید (${f(s.tp[1])})\n🔒 حد ضرر را روی TP1 (${f(s.tp[0])}) بگذارید.`;
    case 'close': {
      const r = s.r >= 0 ? `+${s.r.toFixed(2)}` : s.r.toFixed(2);
      const icon = s.result === 'TP3' ? '🏆' : s.result === 'SL' ? '❌' : s.r > 0 ? '✅' : '➖';
      return `${icon} ${head}\n📌 نتیجه: <b>${RESULT_FA[s.result]}</b>\n📈 بازده: <b>${r}R</b>`;
    }
    default: return '';
  }
}

/** پیام‌های ارسال‌نشده را از روی وضعیت سیگنال‌ها بساز. (فقط رویدادهای ≤ ۳ ساعت اخیر؛ قدیمی‌ها بی‌صدا علامت می‌خورند.) */
export function pendingMessages(signals, now, maxAgeMs = 3 * 3_600_000) {
  const out = [];
  for (const s of signals) {
    s.tg ||= { new: false, sent: {} };
    const fresh = (t) => t && now - t <= maxAgeMs;
    if (!s.tg.new) out.push({ sig: s, kind: 'new', silent: !fresh(s.createdAt) });
    if (s.hits?.tp1 && !s.tg.sent.tp1) out.push({ sig: s, kind: 'tp1', silent: !fresh(s.hits.tp1) });
    if (s.hits?.tp2 && !s.tg.sent.tp2) out.push({ sig: s, kind: 'tp2', silent: !fresh(s.hits.tp2) });
    if (s.closed && !s.tg.sent.close) out.push({ sig: s, kind: 'close', silent: !fresh(s.closedAt) });
  }
  return out;
}

export function isConfigured(env = process.env) {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHANNEL_ID);
}

async function call(token, method, body, fetchImpl = fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl(`${process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) return j.result;
    if (res.status === 429 && j.parameters?.retry_after) {
      await new Promise((r) => setTimeout(r, Math.min(j.parameters.retry_after, 20) * 1000));
      continue;
    }
    throw new Error(j.description || `HTTP ${res.status}`);
  }
  throw new Error('Telegram: تلاش‌ها تمام شد');
}

/** پیام‌های معلق را می‌فرستد و علامت‌ها را روی state می‌گذارد. توکن هرگز لاگ نمی‌شود. */
export async function flush(state, now, env = process.env, fetchImpl = fetch, log = console.log) {
  const pending = pendingMessages(state.signals, now);
  const result = { configured: isConfigured(env), sent: 0, failed: 0, error: null };
  const mark = (p) => {
    if (p.kind === 'new') p.sig.tg.new = true;
    else p.sig.tg.sent[p.kind] = true;
  };
  if (!result.configured) return result; // بدون تنظیم، چیزی علامت نمی‌خورد تا بعد از تنظیم، رویدادهای تازه برسند

  const token = env.TELEGRAM_BOT_TOKEN;
  const chat = env.TELEGRAM_CHANNEL_ID;
  for (const p of pending) {
    if (p.silent) { mark(p); continue; }
    try {
      const text = p.kind === 'new' ? newSignalMessage(p.sig) : updateMessage(p.sig, p.kind);
      const body = { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true };
      if (p.kind !== 'new' && p.sig.tg.msgId) { body.reply_to_message_id = p.sig.tg.msgId; body.allow_sending_without_reply = true; }
      const msg = await call(token, 'sendMessage', body, fetchImpl);
      if (p.kind === 'new') p.sig.tg.msgId = msg.message_id;
      mark(p);
      result.sent++;
    } catch (e) {
      result.failed++;
      result.error = String(e.message || e).replace(token, '***');
      log(`telegram: ارسال ${p.kind} برای ${p.sig.id} ناموفق: ${result.error}`);
      if (/chat not found|Unauthorized|Forbidden/i.test(result.error)) break; // خطای تنظیمات؛ ادامه بی‌فایده است
    }
  }
  return result;
}

/** پیام آزمایشی برای راستی‌آزمایی تنظیمات (Run workflow با گزینهٔ send_test). */
export async function sendTest(env = process.env, fetchImpl = fetch) {
  if (!isConfigured(env)) throw new Error('TELEGRAM_BOT_TOKEN یا TELEGRAM_CHANNEL_ID در Secrets تنظیم نشده است.');
  const token = env.TELEGRAM_BOT_TOKEN;
  try {
    return await call(token, 'sendMessage', {
      chat_id: env.TELEGRAM_CHANNEL_ID,
      text: `✅ <b>AZARI TRADE AI</b> به این کانال وصل شد.\nاز این پس سیگنال‌ها و نتیجهٔ TP/SL اینجا ارسال می‌شود.\n⏱ ${tehranTime(Date.now())} (تهران)`,
      parse_mode: 'HTML',
    }, fetchImpl);
  } catch (e) {
    throw new Error(String(e.message || e).replace(token, '***'));
  }
}
