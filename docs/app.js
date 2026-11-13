/* AZARI TRADE AI — داشبورد استاتیک. بدون هیچ وابستگی یا سرور؛ فقط state.json را از شاخهٔ data ریپو می‌خواند. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* حالت خصوصی/بدون ذخیره‌سازی */ } },
  };

  let state = null;
  let tab = 'active';
  let selSym = store.get('sym') || 'XAUUSD';
  let knownIds = null;
  let soundOn = store.get('sound') !== '0';
  let loadError = null;
  let fromCache = false;
  let backtest = null;

  // ------------------------------------------------------------ منابع داده
  function sources() {
    const cfg = (window.AZARI_CONFIG || {}).repo || '';
    let owner, name;
    if (cfg.includes('/')) [owner, name] = cfg.split('/');
    else {
      const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
      if (m) { owner = m[1]; name = location.pathname.split('/').filter(Boolean)[0] || `${m[1]}.github.io`; }
    }
    if (!owner) return { state: ['state.json'], bt: ['backtest.json'] };
    const raw = (f) => `https://raw.githubusercontent.com/${owner}/${name}/data/${f}`;
    const api = (f) => `https://api.github.com/repos/${owner}/${name}/contents/${f}?ref=data`;
    const cdn = (f) => `https://cdn.jsdelivr.net/gh/${owner}/${name}@data/${f}`;
    return { state: [raw('state.json'), api('state.json'), cdn('state.json')], bt: [raw('backtest.json'), api('backtest.json')] };
  }

  async function fetchFirst(urls, validate) {
    let lastErr = 'بدون پاسخ';
    for (const base of urls) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      try {
        const isApi = base.includes('api.github.com');
        const url = base + (base.includes('?') ? '&' : '?') + 't=' + Date.now();
        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', headers: isApi ? { Accept: 'application/vnd.github.raw+json' } : undefined });
        if (!res.ok) throw new Error(res.status === 404 ? 'فایل داده هنوز ساخته نشده (۴۰۴)' : `HTTP ${res.status}`);
        const j = await res.json();
        if (!validate(j)) throw new Error('فرمت داده نامعتبر');
        return j;
      } catch (e) {
        lastErr = e.name === 'AbortError' ? 'زمان‌بر شد (timeout)' : e.message || String(e);
      } finally { clearTimeout(timer); }
    }
    throw new Error(lastErr);
  }

  // ------------------------------------------------------------ ابزارها
  const tz = 'Asia/Tehran';
  const fmtDT = (ms) => (ms ? new Intl.DateTimeFormat('fa-IR', { timeZone: tz, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms) : '—');
  const fmtHM = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  function ago(ms) {
    const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (m < 1) return 'همین حالا';
    if (m < 60) return `${fa(m)} دقیقه پیش`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${fa(h)} ساعت پیش`;
    return `${fa(Math.floor(h / 24))} روز پیش`;
  }
  const digits = (code) => state?.meta?.symbols?.[code]?.digits ?? 2;
  const px = (code, v) => (Number.isFinite(v) ? Number(v).toFixed(digits(code)) : '—');
  const signed = (n, d = 2) => (n > 0 ? '+' : '') + Number(n).toFixed(d);
  const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
  const startOfTehranDay = () => {
    const off = 3.5 * 3600000;
    return Math.floor((Date.now() + off) / 86400000) * 86400000 - off;
  };

  const RESULT_FA = { SL: 'حد ضرر', BE: 'سربه‌سر پس از TP1', TP1_LOCK: 'سود قفل‌شده', TP3: 'هر سه هدف', EXPIRED: 'منقضی' };
  const STATUS_FA = { ACTIVE: 'فعال', TP1: 'TP1 خورده', TP2: 'TP2 خورده' };
  const GATE_FA = {
    session: 'خارج از ساعت معامله', low_volatility: 'نوسان کم', spike_candle: 'کندل انفجاری', data: 'داده ناکافی', gap: 'شکاف داده',
    h1: 'روند H1 هم‌جهت نیست', h4: 'روند H4 مخالف', htf_against: 'تایم‌فریم بالا مخالف', htf_flat: 'تایم‌فریم بالا خنثی', adx: 'قدرت روند کم',
    body: 'بدنهٔ کندل ضعیف', rsi: 'RSI نامناسب', no_room: 'مانع نزدیک', cost: 'اسپرد نسبت به ریسک زیاد', no_cross: 'تقاطع نیست', no_break: 'شکستی نیست', no_pullback: 'پولبک نیست',
    late: 'ورود دیر', too_deep: 'پولبک عمیق', close_loc: 'بستهٔ ضعیف', slope: 'شیب ضعیف', ema50: 'زیر/بالای EMA50', no_setup: 'ستاپ نیست',
    trending: 'بازار روندی است', h1_trending: 'H1 روندی است', narrow_band: 'باند باریک', no_compression: 'فشردگی نبود', m15_trend: 'روند M15 ناهم‌جهت',
    below_ema20: 'زیر EMA20', crypto: 'کریپتو', htf_agst: 'مخالف',
  };
  const STRAT_FA = { pullback: 'پولبک', breakout: 'شکست', cross: 'تقاطع', reversion: 'بازگشت' };
  const gateFa = (g) => { const [s, r] = g.includes(':') ? g.split(':') : [null, g]; return (s ? `${STRAT_FA[s] || s}: ` : '') + (GATE_FA[r] || r); };

  // ------------------------------------------------------------ بارگذاری
  async function load() {
    const src = sources();
    try {
      state = await fetchFirst(src.state, (j) => j && j.version && Array.isArray(j.signals) && j.updatedAt);
      loadError = null; fromCache = false;
      store.set('cache', JSON.stringify(state));
    } catch (e) {
      loadError = e.message;
      if (!state) {
        try { const c = store.get('cache'); if (c) { state = JSON.parse(c); fromCache = true; } } catch { /* ignore */ }
      }
    }
    if (state) detectNew();
    render();
    if (!backtest && sources().bt) {
      fetchFirst(src.bt, (j) => j && j.total).then((j) => { backtest = j; renderBacktest(); }).catch(() => {});
    }
  }

  function detectNew() {
    const ids = new Set(state.signals.map((s) => s.id));
    if (knownIds) {
      const fresh = state.signals.filter((s) => !knownIds.has(s.id) && !s.closed);
      if (fresh.length) {
        if (soundOn) beep();
        notify(fresh[0], fresh.length);
      }
    }
    knownIds = ids;
  }
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [660, 880].forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.16);
        o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.17);
      });
    } catch { /* مرورگر اجازه نداد */ }
  }
  function notify(sig, n) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`سیگنال جدید: ${sig.dir === 'BUY' ? 'خرید' : 'فروش'} ${sig.symbol}`, { body: n > 1 ? `و ${n - 1} سیگنال دیگر` : `ورود ${px(sig.symbol, sig.entry)} · کیفیت ${sig.grade}`, icon: 'icon-192.png' });
      }
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------------ رندر
  function render() {
    renderPill(); renderBanner();
    if (!state) { $('#kpis').innerHTML = ''; $('#signals').innerHTML = '<div class="empty">در حال دریافت داده…</div>'; return; }
    renderKpis(); renderSignals(); renderSymbols(); renderChart(); renderPerf(); renderEngine(); renderBacktest();
    const active = state.signals.filter((s) => !s.closed).length;
    document.title = (active ? `(${active}) ` : '') + 'AZARI TRADE AI — سیگنال‌های زنده';
  }

  function renderPill() {
    const pill = $('#pill'); const txt = $('#pillText');
    pill.className = 'pill';
    if (!state) { pill.classList.add(loadError ? 'pill-bad' : 'pill-wait'); txt.textContent = loadError ? 'داده‌ای دریافت نشد' : 'در حال بارگذاری…'; return; }
    const ageMin = (Date.now() - state.updatedAt) / 60000;
    if (fromCache || ageMin > 60) { pill.classList.add('pill-bad'); txt.textContent = `آخرین به‌روزرسانی موتور ${ago(state.updatedAt)}`; }
    else if (ageMin > 25) { pill.classList.add('pill-late'); txt.textContent = `به‌روزرسانی با تأخیر · ${ago(state.updatedAt)}`; }
    else { pill.classList.add('pill-ok'); txt.textContent = `آنلاین · ${ago(state.updatedAt)}`; }
  }

  function renderBanner() {
    const b = $('#banner');
    const msgs = [];
    let bad = false;
    if (loadError && !state) {
      bad = true;
      msgs.push(`فایل داده خوانده نشد: <b>${esc(loadError)}</b>. اگر تازه راه‌اندازی کرده‌اید، یک‌بار در تب Actions گیت‌هاب گزینهٔ <b>Run workflow</b> را برای «signals» بزنید و ۲ دقیقه صبر کنید.`);
    } else if (loadError && state) {
      msgs.push(`ارتباط با فایل داده برقرار نشد (${esc(loadError)})؛ آخرین نسخهٔ ذخیره‌شده نمایش داده می‌شود.`);
    }
    if (state && (state.health?.symbolsOk === 0)) {
      bad = true;
      const e = Object.values(state.feed || {}).find((f) => f.error)?.error;
      msgs.push(`هیچ منبع قیمتی در آخرین اجرا پاسخ نداد${e ? ` (${esc(e)})` : ''}. موتور خودکار دوباره تلاش می‌کند؛ سیگنال جدید تا بازگشت داده صادر نمی‌شود.`);
    }
    if (state && !state.scan?.marketOpen && state.health?.symbolsOk > 0) msgs.push('بازار فارکس/طلا بسته است یا داده تازه نیست؛ نمادهای کریپتو همیشه فعال‌اند.');
    if (state?.scan?.breaker) msgs.push('قطع‌کنندهٔ ضرر روزانه فعال شد؛ تا فردا سیگنال جدید صادر نمی‌شود.');
    b.hidden = !msgs.length;
    b.className = 'banner' + (bad ? ' bad' : '');
    b.innerHTML = msgs.join('<br>');
  }

  function renderKpis() {
    const t = state.today || { count: 0, target: 10, r: 0 };
    const st = state.stats?.all || {};
    const active = state.signals.filter((s) => !s.closed);
    const openR = active.reduce((a, s) => a + (s.floatR || 0), 0);
    const pct = Math.min(100, Math.round((t.count / t.target) * 100));
    const few = (st.n || 0) < 20;
    $('#kpis').innerHTML = `
      <div class="kpi"><div class="l">سیگنال امروز</div><div class="v">${fa(t.count)} <small class="muted">/ ${fa(t.target)}</small></div><div class="bar"><i style="width:${pct}%"></i></div></div>
      <div class="kpi"><div class="l">فعال</div><div class="v">${fa(active.length)}</div><div class="s">شناور <span class="${cls(openR)}">${signed(openR)}R</span></div></div>
      <div class="kpi"><div class="l">نرخ برد (بسته‌شده‌ها)</div><div class="v">${st.winRate != null ? fa(st.winRate) + '٪' : '—'}</div><div class="s">${fa(st.n || 0)} معامله${few ? ' · نمونه کم' : ''}</div></div>
      <div class="kpi"><div class="l">میانگین R</div><div class="v ${cls(st.avgR)}">${st.avgR != null ? signed(st.avgR) : '—'}</div><div class="s">ضریب سود ${st.profitFactor ?? '—'}</div></div>
      <div class="kpi"><div class="l">جمع R</div><div class="v ${cls(st.totalR)}">${signed(st.totalR || 0)}</div><div class="s">امروز <span class="${cls(t.r)}">${signed(t.r || 0)}R</span></div></div>`;
  }

  function filtered() {
    const dayStart = startOfTehranDay();
    const all = state.signals;
    if (tab === 'active') return all.filter((s) => !s.closed);
    if (tab === 'today') return all.filter((s) => s.createdAt >= dayStart);
    return all.filter((s) => s.closed).slice(0, 120);
  }

  function renderSignals() {
    const dayStart = startOfTehranDay();
    $('#cActive').textContent = fa(state.signals.filter((s) => !s.closed).length);
    $('#cToday').textContent = fa(state.signals.filter((s) => s.createdAt >= dayStart).length);
    const list = filtered();
    $('#signals').innerHTML = list.length
      ? list.map(card).join('')
      : `<div class="empty">${tab === 'active' ? 'سیگنال بازی نیست. موتور هر چند دقیقه کندل‌های جدید را اسکن می‌کند و فقط ستاپ‌های با کیفیت بالا را صادر می‌کند.' : 'موردی برای نمایش نیست.'}</div>`;
  }

  function card(s) {
    const buy = s.dir === 'BUY';
    const c = s.symbol;
    const lv = (k, v, extra = '') => `<div class="lv ${extra}"><span class="k">${k}</span><span class="n mono">${px(c, v)}</span></div>`;
    const slMoved = !s.closed && Math.abs(s.sl - s.slInitial) > 1e-9;
    const lo = Math.min(s.slInitial, s.tp[2]); const hi = Math.max(s.slInitial, s.tp[2]);
    const pos = (v) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
    const curPx = s.closed ? s.exitPrice : s.price;
    const track = `<div class="track"><div class="fill" style="left:${Math.min(pos(s.entry), pos(curPx))}%;width:${Math.abs(pos(curPx) - pos(s.entry))}%"></div>
      ${[s.entry, s.tp[0], s.tp[1]].map((v) => `<i class="tick" style="left:${pos(v)}%"></i>`).join('')}<i class="px" style="left:${pos(curPx)}%"></i></div>`;
    let status;
    if (s.closed) {
      const win = s.r > 0;
      status = `<span class="badge ${win ? 'win' : s.r < 0 ? 'loss' : ''}">${esc(RESULT_FA[s.result] || s.result)} · ${signed(s.r)}R</span>`;
    } else status = `<span class="badge gold">${esc(STATUS_FA[s.status] || s.status)}</span>`;
    const txt = encodeURIComponent(`${buy ? 'BUY' : 'SELL'} ${c}\nEntry ${px(c, s.entry)}\nSL ${px(c, s.slInitial)}\nTP1 ${px(c, s.tp[0])}\nTP2 ${px(c, s.tp[1])}\nTP3 ${px(c, s.tp[2])}`);
    return `<article class="sig ${buy ? '' : 'sell'} ${s.closed ? 'done' : ''}">
      <div class="sig-top">
        <div class="sym">${esc(c)}<small>${esc(s.label)}</small></div>
        <div class="row"><span class="badge ${buy ? 'buy' : 'sell'}">${buy ? 'خرید' : 'فروش'}</span><span class="badge gold" title="امتیاز ${s.score}">${esc(s.grade)} · ${fa(s.score)}</span></div>
      </div>
      <div class="row" style="margin-top:6px">${status}${!s.closed ? `<span class="badge ${cls(s.floatR) === 'pos' ? 'win' : cls(s.floatR) === 'neg' ? 'loss' : ''}">شناور ${signed(s.floatR || 0)}R</span>` : ''}</div>
      <div class="levels">
        ${lv('ورود', s.entry, 'en')}
        ${lv(slMoved ? (s.stage >= 2 ? 'حد ضرر (قفل TP1)' : 'حد ضرر (سربه‌سر)') : 'حد ضرر', slMoved ? s.sl : s.slInitial, 'sl')}
        ${lv('TP1 · 1R', s.tp[0], s.hits?.tp1 ? 'hit' : '')}
        ${lv('TP2 · 2R', s.tp[1], s.hits?.tp2 ? 'hit' : '')}
        ${lv('TP3 · 3R', s.tp[2], s.hits?.tp3 ? 'hit' : '')}
        <div class="lv"><span class="k">${s.closed ? 'خروج' : 'قیمت فعلی'}</span><span class="n mono">${px(c, curPx)}</span></div>
      </div>
      ${track}
      <div class="meta"><span>${esc(s.strategyFa)}</span><span>${fmtDT(s.createdAt)}${s.closed ? ` → ${fmtDT(s.closedAt)}` : ''}</span></div>
      <details><summary>دلایل و جزئیات</summary><ul>${(s.reasons || []).map((r) => `<li>${esc(r)}</li>`).join('')}<li>ریسک ${px(c, s.risk)} · ATR ${px(c, s.atr)}${s.roomR ? ` · فضا تا مانع ${s.roomR}R` : ''}</li></ul></details>
      <div class="row" style="margin-top:8px"><button class="copy" data-copy="${txt}">کپی سیگنال</button>
      ${!s.closed ? '<span class="muted" style="font-size:11.5px">با TP1: حد ضرر → ورود · با TP2: حد ضرر → TP1</span>' : ''}</div>
    </article>`;
  }

  function renderSymbols() {
    const codes = Object.keys(state.prices || {});
    const sel = $('#symSelect');
    if (sel.options.length !== codes.length) sel.innerHTML = codes.map((c) => `<option value="${c}">${c} — ${esc(state.meta?.symbols?.[c]?.fa || '')}</option>`).join('');
    if (!codes.includes(selSym)) selSym = codes[0];
    sel.value = selSym;
    $('#prices').innerHTML = codes.map((c) => {
      const p = state.prices[c];
      const ch = p.changePct;
      return `<button class="pr ${c === selSym ? 'on' : ''} ${p.fresh ? '' : 'stale'}" data-sym="${c}">
        <span class="c"><span>${c}</span><span class="${cls(ch)}">${ch != null ? signed(ch) + '٪' : ''}</span></span>
        <span class="p mono">${px(c, p.price)}</span></button>`;
    }).join('');
  }

  function renderChart() {
    const code = selSym;
    const rows = (state.candles?.[code] || []).slice(-96);
    const box = $('#chart');
    if (rows.length < 5) { box.innerHTML = '<div class="empty">داده‌ای برای این نماد نیست.</div>'; return; }
    const sig = state.signals.find((s) => s.symbol === code && !s.closed);
    const levels = sig ? [['ورود', sig.entry, '#e6b84a'], ['SL', sig.sl, '#f0616d'], ['TP1', sig.tp[0], '#2ecc8f'], ['TP2', sig.tp[1], '#2ecc8f'], ['TP3', sig.tp[2], '#2ecc8f']] : [];
    let lo = Math.min(...rows.map((r) => r[3]), ...levels.map((l) => l[1]));
    let hi = Math.max(...rows.map((r) => r[2]), ...levels.map((l) => l[1]));
    const padv = (hi - lo) * 0.06 || 1; lo -= padv; hi += padv;
    const W = 900, H = 340, L = 8, R = 74, T = 10, B = 22;
    const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
    const step = (W - L - R) / rows.length; const bw = Math.max(2, step * 0.62);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#1a283a" stroke-width="1"/><text x="${W - R + 6}" y="${y(v) + 4}" fill="#8296ab" font-size="11" font-family="monospace">${px(code, v)}</text>`;
    }
    let cs = '';
    rows.forEach((r, i) => {
      const [t, o, h, l, c] = r; const x = L + i * step + step / 2; const up = c >= o; const col = up ? '#2ecc8f' : '#f0616d';
      cs += `<line x1="${x}" x2="${x}" y1="${y(h)}" y2="${y(l)}" stroke="${col}" stroke-width="1.2"/><rect x="${x - bw / 2}" y="${Math.min(y(o), y(c))}" width="${bw}" height="${Math.max(1, Math.abs(y(o) - y(c)))}" fill="${col}"/>`;
      if (i % 16 === 0) cs += `<text x="${x}" y="${H - 6}" fill="#8296ab" font-size="10.5" text-anchor="middle" font-family="monospace">${fmtHM(t)}</text>`;
    });
    const lines = levels.map(([n, v, col]) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-width="1.2" stroke-dasharray="5 4"/><rect x="${W - R + 2}" y="${y(v) - 9}" width="${R - 4}" height="16" rx="4" fill="${col}" opacity=".18"/><text x="${W - R + 6}" y="${y(v) + 4}" fill="${col}" font-size="11" font-family="monospace">${n}</text>`).join('');
    const last = rows[rows.length - 1][4];
    const lastLine = `<line x1="${L}" x2="${W - R}" y1="${y(last)}" y2="${y(last)}" stroke="#dbe5ef" stroke-width=".8" stroke-dasharray="2 3" opacity=".6"/>`;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="نمودار ${code}">${g}${cs}${lastLine}${lines}</svg>`;
  }

  function perfTable(title, obj) {
    const rows = Object.entries(obj || {}).filter(([, s]) => s.n > 0).sort((a, b) => b[1].totalR - a[1].totalR);
    if (!rows.length) return '';
    return `<div class="tbl-wrap"><table><thead><tr><th>${title}</th><th>تعداد</th><th>برد</th><th>میانگین R</th><th>جمع R</th><th>ضریب سود</th></tr></thead><tbody>${rows.map(([k, s]) => `<tr><td>${esc(STRAT_FA[k] || k)}</td><td>${fa(s.n)}</td><td>${fa(s.winRate)}٪</td><td class="${cls(s.avgR)}">${signed(s.avgR)}</td><td class="${cls(s.totalR)}">${signed(s.totalR)}</td><td>${s.profitFactor ?? '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function renderPerf() {
    const st = state.stats || {};
    if (!st.all?.n) { $('#perf').innerHTML = '<p class="muted">هنوز معامله‌ای بسته نشده؛ آمار با بسته‌شدن سیگنال‌ها ساخته می‌شود. «برد» یعنی نتیجهٔ نهایی مثبت (حتی +۰٫۳۳R پس از TP1).</p>'; return; }
    const d7 = st.d7 || {};
    $('#perf').innerHTML = `<p class="muted" style="margin-top:0">۷ روز اخیر: ${fa(d7.n || 0)} معامله · برد ${d7.winRate != null ? fa(d7.winRate) + '٪' : '—'} · میانگین R ${d7.avgR != null ? signed(d7.avgR) : '—'} · خروج با حد ضرر کامل ${st.all.slRate != null ? fa(st.all.slRate) + '٪' : '—'} · رسیدن به TP1 ${st.all.tp1Rate != null ? fa(st.all.tp1Rate) + '٪' : '—'}</p>${perfTable('استراتژی', st.byStrategy)}<div style="height:10px"></div>${perfTable('نماد', st.bySymbol)}`;
  }

  function renderBacktest() {
    const p = $('#btPanel');
    if (!backtest) { p.hidden = true; return; }
    p.hidden = false;
    const t = backtest.total; const d = backtest.signalsPerDay;
    $('#btWhen').textContent = `${backtest.days} روز · ${ago(backtest.generatedAt)}`;
    $('#bt').innerHTML = `<p style="margin-top:0">${fa(t.n)} معامله · برد <b>${fa(t.winRate)}٪</b> · میانگین R <b class="${cls(t.avgR)}">${signed(t.avgR)}</b> · جمع R <b class="${cls(t.totalR)}">${signed(t.totalR)}</b> · ضریب سود <b>${t.profitFactor ?? '—'}</b> · بیشینهٔ افت <b>${backtest.maxDrawdownR}R</b> · بیشترین ضرر پیاپی <b>${backtest.maxLossStreak}</b></p>
      <p class="muted">میانگین ${fa(d.avg)} سیگنال در روز (حداقل ${fa(d.min)}، حداکثر ${fa(d.max)}) — ${fa(d.daysAtLeastTarget)} از ${fa(d.activeDays)} روز به هدف روزانه رسید. ${esc(backtest.note)}</p>${perfTable('استراتژی', backtest.byStrategy)}`;
  }

  function renderEngine() {
    const sc = state.scan || {}; const f = state.feed || {};
    const okN = Object.values(f).filter((x) => x.ok).length;
    const srcs = [...new Set(Object.values(f).filter((x) => x.ok).map((x) => x.source))].join('، ') || '—';
    const rej = Object.entries(sc.rejects || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g, n]) => `${gateFa(g)} (${fa(n)})`).join(' · ') || '—';
    const bad = Object.entries(f).filter(([, x]) => !x.ok).map(([c]) => c).join('، ');
    const paused = Object.keys(sc.paused || {}).map((k) => STRAT_FA[k] || k).join('، ');
    $('#engine').innerHTML = `
      <div>آخرین اجرا: <b>${fmtDT(state.updatedAt)}</b> (اجرای شمارهٔ ${fa(state.runs)})</div>
      <div>منبع داده: <b>${esc(srcs)}</b> · ${fa(okN)} از ${fa(Object.keys(f).length)} نماد سالم${bad ? ` · ناموفق: ${esc(bad)}` : ''}</div>
      <div>آستانهٔ کیفیت فعلی: <b>${fa(sc.threshold ?? '—')}</b> از ۱۰۰ (تطبیقی؛ هرگز زیر کف نمی‌رود)</div>
      <div>کندل‌های ارزیابی‌شده: <b>${fa(sc.evaluated || 0)}</b> · کاندیدای خام: <b>${fa(sc.candidates || 0)}</b></div>
      <div>دلایل اصلی رد: ${rej}</div>
      <div>تلگرام: <b>${state.telegram?.configured ? 'فعال' : 'تنظیم نشده'}</b>${state.telegram?.lastError ? ` · خطا: ${esc(state.telegram.lastError)}` : ''}${paused ? ` · استراتژی متوقف: ${esc(paused)}` : ''}</div>`;
  }

  // ------------------------------------------------------------ رویدادها
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-sym],[data-copy]');
    if (!t) return;
    if (t.dataset.tab) {
      tab = t.dataset.tab;
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b === t));
      if (state) renderSignals();
    } else if (t.dataset.sym) {
      selSym = t.dataset.sym; store.set('sym', selSym);
      if (state) { renderSymbols(); renderChart(); }
    } else if (t.dataset.copy) {
      const text = decodeURIComponent(t.dataset.copy);
      (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => { t.textContent = 'کپی شد ✓'; setTimeout(() => (t.textContent = 'کپی سیگنال'), 1500); }).catch(() => {});
    }
  });
  $('#symSelect').addEventListener('change', (e) => { selSym = e.target.value; store.set('sym', selSym); if (state) { renderSymbols(); renderChart(); } });
  const soundBtn = $('#soundBtn');
  const paintSound = () => { soundBtn.classList.toggle('off', !soundOn); soundBtn.textContent = soundOn ? '🔔' : '🔕'; };
  soundBtn.addEventListener('click', () => { soundOn = !soundOn; store.set('sound', soundOn ? '1' : '0'); paintSound(); if (soundOn) beep(); });
  paintSound();
  const notifBtn = $('#notifBtn');
  if ('Notification' in window && Notification.permission === 'default') {
    notifBtn.hidden = false;
    notifBtn.addEventListener('click', async () => { try { await Notification.requestPermission(); } catch { /* ignore */ } notifBtn.hidden = true; });
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, 60000);
  setInterval(() => { if (state) renderPill(); }, 30000);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  load();
})();
