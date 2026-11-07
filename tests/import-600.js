/* اختبار 600 ملف مكتب مختلف (7 نوفمبر 2026) — لكل صف «الجواب الصحيح» مسبقًا.
   يقيس: كم ملفًا يذهب للمعاينة مباشرة، وهل يخرج أي رقم خاطئ صامتًا، وهل يُرفض كل صف فاسد صراحة.
   تشغيل: npx esbuild lib/importParse.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/importParse.js
           TZ=Asia/Riyadh node tests/import-600.js [عدد الملفات، افتراضي 600] */
const XLSX = require(require('path').join(__dirname, '..', 'node_modules', 'xlsx'));
const P = require('/tmp/b/importParse.js');
const fs = require('fs');
const N = Number(process.argv[2] || 600);
const DIR = require('os').tmpdir() + '/watheq-import-600';
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
{

const OUT = DIR + '/files/'; fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
let seed = 20261107; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const toAr = (s) => String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const H = {
  name: ['اسم المستأجر', 'المستأجر', 'اسم المستاجر', 'الاسم', 'اسم الساكن', 'الساكن', 'اسم العميل', 'Tenant', 'tenant name', 'المستأجر/ة'],
  unit: ['رقم الوحدة', 'الوحدة', 'رقم الشقة', 'الشقة', 'رقم المحل', 'شقة رقم', 'Unit', 'رقم العين', 'الشقه'],
  rent_annual: ['الإيجار السنوي', 'قيمة الإيجار السنوي', 'الايجار السنوي', 'قيمة العقد السنوية', 'مبلغ الإيجار السنوي', 'الإيجار سنويا', 'Annual rent'],
  rent_payment: ['قيمة الدفعة', 'مبلغ الدفعة', 'القسط', 'قيمة القسط', 'الدفعة'],
  rent_monthly: ['الإيجار الشهري', 'قيمة الإيجار الشهري', 'الايجار شهريا'],
  rent_generic: ['الإيجار', 'قيمة الإيجار', 'مبلغ الإيجار'],
  freq: ['دورة السداد', 'طريقة الدفع', 'طريقة السداد', 'نظام الدفع', 'نظام السداد', 'دورية السداد', 'آلية السداد'],
  start: ['بداية العقد', 'تاريخ بداية العقد', 'تاريخ البداية', 'تاريخ بدء العقد', 'بداية الإيجار', 'تاريخ العقد', 'Start date', 'من تاريخ'],
  end: ['نهاية العقد', 'تاريخ نهاية العقد', 'تاريخ الانتهاء', 'انتهاء العقد', 'تاريخ انتهاء العقد', 'إلى تاريخ', 'ينتهي في'],
  months: ['مدة العقد', 'مدة العقد (أشهر)', 'المدة بالأشهر', 'عدد الأشهر', 'مدة العقد بالأشهر'],
  periods: ['عدد الدفعات', 'عدد الأقساط'],
  paid_count: ['الدفعات المسددة', 'عدد الدفعات المسددة', 'الدفعات المدفوعة'],
  paid_amount: ['المبلغ المسدد', 'المدفوع', 'المسدد', 'المحصل', 'إجمالي المدفوع', 'المبلغ المدفوع'],
  phone: ['الجوال', 'رقم الجوال', 'الهاتف', 'جوال', 'رقم التواصل', 'Mobile', 'رقم الهاتف', 'جوال المستأجر'],
  extra: ['الجنسية', 'رقم الهوية', 'رقم العقد', 'ملاحظات', 'البريد الإلكتروني', 'قيمة التأمين', 'العمولة', 'الحالة', 'المتأخر', 'المتبقي', 'تاريخ آخر دفعة', 'نوع الوحدة', 'المساحة', 'الدور', 'حساب الكهرباء'],
};
const FREQ = { monthly: ['شهري', 'شهريا', 'كل شهر', 'monthly'], quarterly: ['ربع سنوي', 'كل 3 اشهر', '4 دفعات', 'ربع سنويا'], semiannual: ['نصف سنوي', 'كل 6 اشهر', 'دفعتين', 'نصف سنويا'], annual: ['سنوي', 'سنويا', 'دفعة واحدة', 'كل سنة'] };
const PER = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };
const NAMES = ['محمد العتيبي', 'سعد القحطاني', 'فهد الشمري', 'نورة الدوسري', 'مؤسسة الريان', 'عبدالله الزهراني', 'خالد المطيري', 'سارة الغامدي', 'شركة الأفق', 'ماجد الحربي', 'Ahmed Khan', 'ريم السبيعي'];
const iso = (d) => d.toISOString().slice(0, 10);
const addMonths = (s, m) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + m); return iso(d); };
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const serial = (s) => Math.round((Date.parse(s + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);
function hijriOf(isoD) { const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }); const p = Object.fromEntries(f.formatToParts(new Date(isoD + 'T00:00:00Z')).map((x) => [x.type, x.value])); return `${p.year.replace(/\D/g, '')}/${p.month}/${p.day}`; }

const manifest = [];
for (let fi = 0; fi < N; fi++) {
  const fmt = pick(['xlsx-typed', 'xlsx-typed', 'xlsx-text', 'csv']);
  const rentKind = pick(['annual', 'annual', 'payment', 'payment', 'monthly', 'generic']);
  const durKind = pick(['periods', 'months', 'end', 'none']);
  const paidKind = pick(['count', 'amount', 'amount', 'none']);
  const dateFmt = fmt === 'xlsx-typed' ? pick(['date', 'date', 'iso', 'serial', 'hijri']) : pick(['iso', 'dmy', 'dmy', 'ymd-slash', 'hijri', 'hijri-h', 'd-m-y-short']);
  const arabicDigits = fmt !== 'xlsx-typed' && chance(0.15);
  const amountFmt = pick(['plain', 'comma', 'riyal', 'plain']);
  const phoneFmt = pick(['05', '05', '+966', '966', '5x', 'spaced']);
  const titleRows = pick([0, 0, 1, 2]); const serialCol = chance(0.4); const totals = chance(0.35); const extras = Math.floor(rnd() * 3);
  const shuffle = chance(0.5); const freqCol = rentKind !== 'generic' || chance(0.8);
  const calHijri = dateFmt.startsWith('hijri');
  // الأعمدة
  const cols = [];
  cols.push({ f: 'name', h: pick(H.name) }, { f: 'unit', h: pick(H.unit) });
  cols.push({ f: 'rent', h: pick(H['rent_' + rentKind]) });
  if (freqCol) cols.push({ f: 'freq', h: pick(H.freq) });
  cols.push({ f: 'start', h: pick(H.start) });
  if (durKind === 'periods') cols.push({ f: 'periods', h: pick(H.periods) });
  if (durKind === 'months') cols.push({ f: 'months', h: pick(H.months) });
  if (durKind === 'end') cols.push({ f: 'end', h: pick(H.end) });
  if (paidKind !== 'none') cols.push({ f: 'paid', h: pick(H['paid_' + paidKind]) });
  cols.push({ f: 'phone', h: pick(H.phone) });
  const usedH = new Set(cols.map((c) => c.h));
  for (let e = 0; e < extras; e++) { const h = pick(H.extra); if (!usedH.has(h)) { usedH.add(h); cols.push({ f: 'extra', h }); } }
  if (shuffle) for (let i = cols.length - 1; i > 2; i--) { const j = 2 + Math.floor(rnd() * (i - 1)); [cols[i], cols[j]] = [cols[j], cols[i]]; }
  if (serialCol) cols.unshift({ f: 'serial', h: pick(['م', '#', 'مسلسل']) });
  const nRows = 5 + Math.floor(rnd() * 80);
  const fileFreq = pick(Object.keys(PER)); // بعض الملفات بلا عمود دورة = كلها سنوي (عام)
  const rows = []; const truth = [];
  for (let r = 0; r < nRows; r++) {
    const freq = freqCol ? pick(Object.keys(PER)) : 'annual';
    const per = PER[freq];
    const termMonths = durKind === 'none' ? 12 : pick([12, 12, 12, 24, 6, 36].filter((m) => (m * per) % 12 === 0));
    const periods = termMonths * per / 12;
    const annual = pick([12000, 18000, 24000, 30000, 36000, 42000, 48000, 60000, 85000, 120000]);
    const pay = Math.round((annual / per) * 100) / 100;
    let start = `20${pick(['25', '26'])}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${pick(['01', '01', '15', '10', '20'])}`;
    if (calHijri) { // ابدأ من تاريخ هجري حقيقي
      start = iso(new Date(Date.parse(start + 'T00:00:00Z')));
    }
    const paidCnt = Math.floor(rnd() * Math.min(periods, 6));
    const partial = paidKind === 'amount' && chance(0.3) ? Math.round(pay * pick([0.5, 0.25]) * 100) / 100 : 0;
    const rentVal = rentKind === 'annual' || (rentKind === 'generic' && freq === 'annual') ? annual : rentKind === 'monthly' ? Math.round(annual / 12 * 100) / 100 : rentKind === 'generic' ? annual : pay;
    const fmtAmt = (n) => { let s = amountFmt === 'comma' ? Number(n).toLocaleString('en-US') : String(n); if (amountFmt === 'riyal') s += ' ريال'; return arabicDigits ? toAr(s) : s; };
    const fmtDate = (d) => {
      if (fmt === 'xlsx-typed' && dateFmt === 'date') return new Date(d + 'T00:00:00');
      if (fmt === 'xlsx-typed' && dateFmt === 'serial') return serial(d);
      let s;
      if (dateFmt === 'iso') s = d; else if (dateFmt === 'dmy') { const [y, m, dd] = d.split('-'); s = `${dd}/${m}/${y}`; }
      else if (dateFmt === 'd-m-y-short') { const [y, m, dd] = d.split('-'); s = `${+dd}/${+m}/${y}`; }
      else if (dateFmt === 'ymd-slash') s = d.replace(/-/g, '/');
      else if (dateFmt === 'hijri') s = hijriOf(d); else if (dateFmt === 'hijri-h') s = hijriOf(d) + 'هـ'; else s = d;
      return arabicDigits ? toAr(s) : s;
    };
    const phoneN = '05' + String(Math.floor(10000000 + rnd() * 89999999));
    const fmtPhone = () => { const n9 = phoneN.slice(1); const s = phoneFmt === '05' ? phoneN : phoneFmt === '+966' ? '+966' + n9 : phoneFmt === '966' ? '966' + n9 : phoneFmt === '5x' ? (fmt === 'xlsx-typed' ? Number(n9) : n9) : `${phoneN.slice(0, 3)} ${phoneN.slice(3, 6)} ${phoneN.slice(6)}`; return arabicDigits && typeof s === 'string' ? toAr(s) : s; };
    const unitV = pick([String(100 + r), String(r + 1), `A-${r + 1}`, `شقة ${r + 1}`]);
    const unitCell = arabicDigits ? toAr(unitV) : (fmt === 'xlsx-typed' && /^\d+$/.test(unitV) ? Number(unitV) : unitV);
    const endD = addDays(addMonths(start, termMonths), -1);
    const paidAmt = Math.round((paidCnt * pay + partial) * 100) / 100;
    const row = cols.map((c) => {
      switch (c.f) {
        case 'serial': return fmt === 'xlsx-typed' ? r + 1 : String(r + 1);
        case 'name': return NAMES[(r + fi) % NAMES.length] + ' ' + (r + 1);
        case 'unit': return unitCell;
        case 'rent': return fmt === 'xlsx-typed' && amountFmt === 'plain' ? rentVal : fmtAmt(rentVal);
        case 'freq': return pick(FREQ[freq]);
        case 'start': return fmtDate(start);
        case 'end': return fmtDate(endD);
        case 'months': return arabicDigits ? toAr(termMonths) : (fmt === 'xlsx-typed' ? termMonths : String(termMonths));
        case 'periods': return arabicDigits ? toAr(periods) : (fmt === 'xlsx-typed' ? periods : String(periods));
        case 'paid': return paidKind === 'count' ? (fmt === 'xlsx-typed' ? paidCnt : (arabicDigits ? toAr(paidCnt) : String(paidCnt))) : (fmt === 'xlsx-typed' && amountFmt === 'plain' ? paidAmt : fmtAmt(paidAmt));
        case 'phone': return fmtPhone();
        default: return pick(['', 'سعودي', 'نشط', '1000', 'x']);
      }
    });
    rows.push(row);
    truth.push({ unit: unitV, name: NAMES[(r + fi) % NAMES.length] + ' ' + (r + 1), freq, pay, periods, start, paidCnt: paidKind === 'none' ? 0 : paidCnt, partial: paidKind === 'amount' ? partial : 0, phone: phoneN });
  }
  const grid = [];
  for (let t = 0; t < titleRows; t++) grid.push([t === 0 ? pick(['كشف مستأجري عمارة الياسمين', 'بيانات المستأجرين 1448', 'تقرير الإيجارات']) : '']);
  grid.push(cols.map((c) => c.h));
  rows.forEach((r, i) => { grid.push(r); if (chance(0.03)) grid.push(cols.map(() => '')); });
  if (totals) { const tr = cols.map(() => ''); tr[cols.findIndex((c) => c.f === 'name')] = pick(['الإجمالي', 'المجموع', 'اجمالي']); grid.push(tr); }
  const fname = `f${String(fi).padStart(3, '0')}.${fmt === 'csv' ? 'csv' : 'xlsx'}`;
  if (fmt === 'csv') fs.writeFileSync(OUT + fname, (chance(0.7) ? '﻿' : '') + grid.map((r) => r.map((c) => { const s = c instanceof Date ? iso(c) : String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n'));
  else { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid, { cellDates: true }), pick(['Sheet1', 'المستأجرين', 'الإيجارات 2026', 'ورقة1'])); XLSX.writeFile(wb, OUT + fname); }
  manifest.push({ fname, fmt, rentKind, durKind, paidKind, dateFmt, arabicDigits, amountFmt, phoneFmt, titleRows, serialCol, totals, extras, freqCol, cols: cols.map((c) => ({ f: c.f, h: c.h })), truth });
}
fs.writeFileSync(DIR + '/manifest.json', JSON.stringify(manifest));
console.log('generated', manifest.length);

}
{
const TODAY = '2026-11-07';
const M = JSON.parse(fs.readFileSync(DIR + '/manifest.json', 'utf8'));
function readSheets2(path) {
  if (/\.xlsx$/.test(path)) { const wb = XLSX.read(fs.readFileSync(path), { cellDates: true }); return wb.SheetNames.map((name) => ({ name, grid: P.gridFromSheetRows(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false })) })); }
  return [{ name: '', grid: P.parseCSV(fs.readFileSync(path, 'utf8')) }];
}
const FMAP = { name: 'name', unit: 'unit', rent: 'rent', freq: 'freq', start: 'start', periods: 'periods', months: 'months', end: 'months', paid: 'paid', phone: 'phone' };
const stats = { files: 0, auto: 0, asked: 0, crashed: 0, rows: 0, okRows: 0, wrongRows: 0, errRows: 0, missingRows: 0, extraRows: 0, questions: {}, wrongField: {}, errMsg: {}, byDim: {} };
const examples = { wrong: [], err: [], asked: [], missing: [] };
const bump = (o, k, n = 1) => (o[k] = (o[k] || 0) + n);
for (const m of M) {
  stats.files++;
  let st = 'auto';
  try {
    const s = readSheets2(DIR + '/files/' + m.fname)[0];
    const p = P.prepareGrid(s.grid);
    const g = p.grid;
    const a = P.analyzeColumns(g);
    let c = P.initialConfig(a);
    const probs = P.mappingProblems(c);
    const sure = !probs.length && !a.reasons.length;
    let opts;
    if (sure) opts = { rentBasis: c.rentBasis || undefined, paidBasis: c.paidBasis || undefined };
    else {
      st = 'asked'; stats.asked++;
      // ماذا سُئل
      a.reasons.forEach((r) => bump(stats.questions, 'reason: ' + r.replace(/«[^»]*»/g, '«…»').slice(0, 70)));
      probs.forEach((r) => bump(stats.questions, 'problem: ' + r.replace(/«[^»]*»/g, '«…»').slice(0, 70)));
      if (examples.asked.length < 12) examples.asked.push({ f: m.fname, reasons: a.reasons, probs, headers: g[0] });
      // المكتب يجيب صحيحًا
      const head = g[0].map((x) => P.cleanCell ? P.cleanCell(x) : String(x).trim());
      const fields = head.map(() => null);
      for (const col of m.cols) {
        if (!FMAP[col.f]) continue;
        const h = col.f === 'end' ? 'مدة العقد (أشهر)' : col.h;
        const i = head.indexOf(h);
        if (i >= 0) fields[i] = FMAP[col.f];
      }
      c = { ...c, fields, headerRow: true,
        rentBasis: m.rentKind === 'monthly' ? 'monthly' : (m.rentKind === 'payment' ? 'payment' : 'annual'),
        paidBasis: m.paidKind === 'amount' ? 'amount' : 'count',
        defFreq: m.freqCol ? null : 'annual' };
      opts = P.configToOptions(c);
    }
    if (st === 'auto') stats.auto++;
    const { rows } = P.parseGrid(g, [], TODAY, opts);
    const T = m.truth;
    stats.rows += T.length;
    if (rows.length < T.length) { stats.missingRows += T.length - rows.length; if (examples.missing.length < 8) examples.missing.push({ f: m.fname, got: rows.length, want: T.length, prep: p.notes }); }
    if (rows.length > T.length) stats.extraRows += rows.length - T.length;
    for (let i = 0; i < Math.min(rows.length, T.length); i++) {
      const r = rows[i], t = T[i];
      if (r._error) { stats.errRows++; bump(stats.errMsg, r._error.replace(/«[^»]*»/g, '«…»').replace(/\d[\d,.\/-]*/g, 'N').slice(0, 80)); if (examples.err.length < 15) examples.err.push({ f: m.fname, row: i, err: r._error, m: { date: m.dateFmt, rent: m.rentKind, dur: m.durKind, paid: m.paidKind } }); continue; }
      const bad = [];
      if (Math.abs(r.rent_amount - t.pay) > 0.011) bad.push(`rent ${r.rent_amount}≠${t.pay}`);
      if (r.payment_frequency !== t.freq) bad.push(`freq ${r.payment_frequency}≠${t.freq}`);
      const per = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 }[t.freq];
      const effP = r.contract_periods || per;
      if (effP !== t.periods) bad.push(`periods ${r.contract_periods}≠${t.periods}`);
      if (r.contract_start !== t.start) bad.push(`start ${r.contract_start}≠${t.start}`);
      if ((r.paid_periods || 0) !== t.paidCnt) bad.push(`paid ${r.paid_periods}≠${t.paidCnt}`);
      if (Math.abs((r.partial_amount || 0) - t.partial) > 0.011) bad.push(`partial ${r.partial_amount}≠${t.partial}`);
      if (r.phone !== t.phone) bad.push(`phone ${r.phone}≠${t.phone}`);
      if (bad.length) { stats.wrongRows++; bad.forEach((b) => bump(stats.wrongField, b.split(' ')[0] + ' [' + (b.startsWith('start') ? m.dateFmt : b.startsWith('rent') ? m.rentKind : b.startsWith('periods') ? m.durKind : b.startsWith('paid') || b.startsWith('partial') ? m.paidKind : b.startsWith('phone') ? m.phoneFmt : '') + ']'));
        if (examples.wrong.length < 25) examples.wrong.push({ f: m.fname, st, row: i, bad, m: { fmt: m.fmt, date: m.dateFmt, rent: m.rentKind, dur: m.durKind, paid: m.paidKind, phone: m.phoneFmt, ar: m.arabicDigits } }); }
      else stats.okRows++;
    }
    for (const k of ['fmt', 'rentKind', 'durKind', 'paidKind', 'dateFmt', 'titleRows', 'freqCol']) { const key = k + '=' + m[k]; stats.byDim[key] = stats.byDim[key] || { n: 0, auto: 0 }; stats.byDim[key].n++; if (st === 'auto') stats.byDim[key].auto++; }
  } catch (e) { stats.crashed++; if (examples.err.length < 15) examples.err.push({ f: m.fname, crash: String(e.stack).slice(0, 200) }); }
}
global.__S = stats;
void ('BY DIM (auto/n):', Object.entries(stats.byDim).sort().map(([k, v]) => `${k}: ${v.auto}/${v.n}`).join(' · '));


}
{
/* نفس الـ600 ملف، مع إفساد ~6% من الصفوف عمدًا: المطلوب أن يُرفض كل صف فاسد صراحة، ولا يمر صامتًا بأرقام خاطئة */
const M2 = JSON.parse(fs.readFileSync(DIR + '/manifest.json', 'utf8'));
let seed2 = 99; const rnd2 = () => ((seed2 = (seed2 * 1103515245 + 12345) % 2147483648) / 2147483648);
const KINDS = ['rent-empty', 'rent-text', 'date-bad', 'date-impossible', 'freq-unknown', 'name-empty', 'paid-over'];
const res = { corrupted: 0, rejected: 0, silent: 0, byKind: {}, silentEx: [] };
function readSheets3(path) {
  if (/\.xlsx$/.test(path)) { const wb = XLSX.read(fs.readFileSync(path), { cellDates: true }); return wb.SheetNames.map((name) => ({ name, grid: P.gridFromSheetRows(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false })) })); }
  return [{ name: '', grid: P.parseCSV(fs.readFileSync(path, 'utf8')) }];
}
for (const m of M2) {
  const g0 = readSheets3(DIR + '/files/' + m.fname)[0].grid;
  const p = P.prepareGrid(g0); const g = p.grid.map((r) => [...r]);
  const head = g[0].map((x) => P.headerKey(x));
  const colOf = (f) => { const c = m.cols.find((c) => c.f === f); if (!c) return -1; const h = f === 'end' ? 'مدة العقد (أشهر)' : c.h; return g[0].indexOf(h); };
  const idx = { rent: colOf('rent'), start: colOf('start'), freq: colOf('freq'), name: colOf('name'), paid: colOf('paid'), periods: colOf('periods') };
  const marks = new Map();
  // صفوف البيانات = كل ما بعد العناوين بترتيب الحقيقة (التجهيز حذف الفارغ والمجموع)
  for (let i = 1; i < g.length; i++) {
    if (rnd2() > 0.06) continue;
    const kind = KINDS[Math.floor(rnd2() * KINDS.length)];
    const row = g[i];
    if (kind === 'rent-empty' && idx.rent >= 0) row[idx.rent] = '';
    else if (kind === 'rent-text' && idx.rent >= 0) row[idx.rent] = 'حسب الاتفاق';
    else if (kind === 'date-bad' && idx.start >= 0) row[idx.start] = 'بداية الشهر';
    else if (kind === 'date-impossible' && idx.start >= 0) row[idx.start] = '2026-13-45';
    else if (kind === 'freq-unknown' && idx.freq >= 0) row[idx.freq] = 'كل شهرين';
    else if (kind === 'name-empty' && idx.name >= 0) row[idx.name] = '';
    else if (kind === 'paid-over' && idx.paid >= 0 && idx.periods >= 0 && m.paidKind === 'count') row[idx.paid] = String(Number(P.toEnDigits ? P.toEnDigits(row[idx.periods]) : row[idx.periods]) + 3);
    else continue;
    marks.set(i, kind);
  }
  if (!marks.size) continue;
  const a = P.analyzeColumns(g); let c = P.initialConfig(a);
  const sure = !P.mappingProblems(c).length && !a.reasons.length;
  let opts;
  if (sure) opts = { rentBasis: c.rentBasis || undefined, paidBasis: c.paidBasis || undefined };
  else {
    const fields = g[0].map(() => null);
    const FM = { name: 'name', unit: 'unit', rent: 'rent', freq: 'freq', start: 'start', periods: 'periods', months: 'months', end: 'months', paid: 'paid', phone: 'phone' };
    for (const col of m.cols) { if (!FM[col.f]) continue; const i = g[0].indexOf(col.f === 'end' ? 'مدة العقد (أشهر)' : col.h); if (i >= 0) fields[i] = FM[col.f]; }
    c = { ...c, fields, headerRow: true, rentBasis: m.rentKind === 'monthly' ? 'monthly' : m.rentKind === 'payment' ? 'payment' : 'annual', paidBasis: m.paidKind === 'amount' ? 'amount' : 'count', defFreq: m.freqCol ? null : 'annual' };
    opts = P.configToOptions(c);
  }
  const { rows } = P.parseGrid(g, [], '2026-11-07', opts);
  // صف الجدول i ↔ rows[i-1] (لا صفوف فارغة بعد التجهيز)
  for (const [i, kind] of marks) {
    res.corrupted++; res.byKind[kind] = res.byKind[kind] || { n: 0, rejected: 0 }; res.byKind[kind].n++;
    const r = rows[i - 1];
    if (!r) continue;
    if (r._error) { res.rejected++; res.byKind[kind].rejected++; }
    else { res.silent++; if (res.silentEx.length < 10) res.silentEx.push({ f: m.fname, kind, row: { rent: r.rent_amount, start: r.contract_start, freq: r.payment_frequency, name: r.name, paid: r.paid_periods } }); }
  }
}


global.__C = res;
}
const S = global.__S, C = global.__C;
const autoPct = Math.round(S.auto / S.files * 100);
console.log(`ملفات ${S.files} · للمعاينة مباشرة ${S.auto} (${autoPct}%) · صفوف ${S.rows} · صحيحة ${S.okRows} · خاطئة صامتة ${S.wrongRows} · مرفوضة ${S.errRows} · انهيار ${S.crashed}`);
console.log(`صفوف أُفسدت عمدًا ${C.corrupted} · رُفضت ${C.rejected} · مرّت صامتة ${C.silent}`);
const fail = S.wrongRows > 0 || S.crashed > 0 || S.errRows > 0 || C.silent > 0 || autoPct < 75;
console.log(fail ? '❌ فشل' : '✅ 600 ملف: صفر رقم خاطئ، وكل صف فاسد مرفوض');
process.exit(fail ? 1 : 0);
