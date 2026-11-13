#!/usr/bin/env node
/**
 * نقطهٔ ورود GitHub Actions: یک چرخه اجرا می‌کند و state.json را به‌روز می‌کند.
 *   STATE_DIR  پوشهٔ ذخیرهٔ state.json (پیش‌فرض ./out)
 * هیچ‌وقت با خطای شبکه کرش نمی‌کند: خطا در state ثبت می‌شود تا سایت دلیلش را نشان دهد.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchBars } from './data.mjs';
import { runOnce, emptyState } from './runner.mjs';
import { flush, sendTest } from './telegram.mjs';

const dir = process.env.STATE_DIR || './out';
mkdirSync(dir, { recursive: true });
const file = join(dir, 'state.json');

let prev = emptyState();
if (existsSync(file)) {
  try {
    prev = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('state.json خراب بود؛ از صفر شروع می‌شود:', e.message);
  }
}

if (process.env.SEND_TEST === 'true') {
  try {
    await sendTest();
    console.log('✅ پیام آزمایشی به تلگرام ارسال شد.');
  } catch (e) {
    console.error('❌ پیام آزمایشی ارسال نشد:', e.message);
    process.exitCode = 1;
  }
}

const now = Number(process.env.AZARI_NOW) || Date.now(); // AZARI_NOW فقط برای تست
const state = await runOnce(prev, (sym) => fetchBars(sym), now);
const tg = await flush(state, now);
state.telegram = { configured: tg.configured, lastError: tg.error, sentLastRun: tg.sent };

const ok = Object.values(state.feed).filter((f) => f.ok).length;
state.health = { symbolsOk: ok, symbolsTotal: Object.keys(state.feed).length };
writeFileSync(file, JSON.stringify(state));

console.log(
  `run #${state.runs}: داده ${ok}/${state.health.symbolsTotal} نماد | کندل‌های ارزیابی‌شده ${state.scan.evaluated} | کاندیدا ${state.scan.candidates} | ` +
    `سیگنال جدید ${state.created.length} | امروز ${state.today.count}/${state.today.target} | آستانه ${state.scan.threshold} | ` +
    `تلگرام: ${tg.configured ? `${tg.sent} ارسال، ${tg.failed} خطا` : 'تنظیم نشده'}`
);
for (const [code, f] of Object.entries(state.feed)) if (!f.ok) console.log(`  ⚠ ${code}: ${f.error}`);
