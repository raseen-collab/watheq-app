/**
 * وثيق — صفحة المستأجر الخاصة (/r/t/{token}): عرض HTML خالص (schema-v70).
 *
 * نفس إطار بوابة مالك الجمعية (lib/hoaPortal.ts): كل نص من القاعدة يمرّ على esc()،
 * والسكربت الوحيد يحمل nonce الاستجابة. الأرقام تُحسب بمحرّك العقود نفسه الذي
 * تستعمله لوحة المكتب وكشف الحساب (contractState + الضريبة) — لا حساب ثانٍ.
 */
import { esc, money, gDate, hDate, addDaysIso, methodAr, riyadhDay, frame, topBar } from "./hoaPortal";
import { REQUEST_CATEGORIES, TENANT_REQUEST_STATUS_AR, requestCatAr, requestLocAr, amountInWordsAr } from "./hoaMoney";
import { contractState, splitVat, unitVatApplies, freqLabel } from "./contracts";
import { statusWindows } from "./contract-state";
import { visiblePayments } from "./documents";
import { unitLabel, unitWordFor } from "./domain";
import { waNumber } from "./utils";
import { enDate, unitWordEn } from "./docEn";

export type TenantPortalData = {
  tenant: Record<string, any> & { name: string; unit: string | null };
  property: Record<string, any> & { name: string };
  office: Record<string, any> | null;
  show_balance: boolean;
  active: boolean;
  today: string;
  payments: { id: string; paid_on: string; amount: number; method: string | null; reference: string | null;
    periods_covered: number | null; reverses: string | null; applies_to: string | null; created_at: string }[];
  claims: { id: string; amount: number; transfer_date: string; bank_ref: string | null; status: "pending" | "approved" | "rejected";
    reject_reason: string | null; recorded_amount: number | null; created_at: string }[];
  requests: { id: string; category: string; location: string; description: string; status: "new" | "in_progress" | "done" | "rejected";
    manager_note: string | null; created_at: string; updated_at: string; closed_at: string | null;
    /** مراحل الطلب بتواريخها وردّ المكتب في كل مرحلة */
    log?: { to: string; note: string | null; at: string }[] }[];
};

/* (24 نوفمبر 2026 — v105) الصفحة بلغة المستأجر: عربي أو English. نص كل جملة من القاموس أدناه —
   البنية والأرقام واحدة للغتين. «both» تُعرض عربية وفي أعلاها زرّ English. */
export type PortalLang = "ar" | "en";
const METHOD_EN: Record<string, string> = { transfer: "Bank transfer", ejar: "Ejar platform", cash: "Cash", pos: "Card (POS)", card: "Card", cheque: "Cheque", other: "Other" };
const CAT_EN: Record<string, string> = { plumbing: "Plumbing & leaks", electric: "Electrical & lighting", elevator: "Lift", cleaning: "Cleaning", security: "Security & doors", ac: "Air conditioning", other: "Other" };
const STATUS_EN: Record<string, string> = { new: "Request received", in_progress: "Reviewed — in progress", done: "Maintenance done ✓", rejected: "Rejected" };
const FREQ_EN: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", bimonthly: "Every 2 months", quarterly: "Quarterly", trimester: "Every 4 months", semiannual: "Semi-annual", annual: "Annual", yearly: "Annual" };
const T = {
  ar: {
    flash: {
      claim_ok: "وصل بلاغ الحوالة للمكتب. بعد مطابقتها مع الحساب البنكي تُسجَّل دفعتك وتظهر هنا.",
      claim_amount: "اكتب مبلغ الحوالة بالريال (أكبر من صفر).",
      claim_date: "تاريخ الحوالة لا يكون في المستقبل ولا أقدم من 90 يومًا.",
      claim_ref: "رقم المرجع أو الملاحظة أطول من المسموح.",
      claim_many: "لديك 3 حوالات بانتظار المراجعة — انتظر قرار المكتب ثم أبلغ عن غيرها.",
      claim_norent: "قيمة الإيجار غير مسجّلة بعد — تواصل مع المكتب.",
      claim_err: "تعذّر إرسال بلاغ الحوالة الآن — أعد المحاولة بعد قليل.",
      req_ok: "وصل طلب الصيانة للمكتب. تتابع حالته هنا.",
      req_bad: "اختر نوع المشكلة ومكانها ثم أعد الإرسال.",
      req_text: "اكتب وصف المشكلة (3 إلى 1000 حرف).",
      req_many: "لديك 5 طلبات مفتوحة — ينتظر بعضها الإنجاز قبل فتح طلب جديد.",
      req_err: "تعذّر إرسال الطلب الآن — أعد المحاولة بعد قليل.",
      inactive: "استقبال البلاغات من هذه الصفحة متوقف مؤقتًا — تواصل مع المكتب مباشرة.",
    } as Record<string, string>,
    inactiveNote: (ph: string) => `الصفحة للاطلاع فقط حاليًا — للحوالات والصيانة تواصل مع المكتب مباشرة${ph ? ` على <span dir="ltr">${ph}</span>` : ""}.`,
    asOf: (d: string) => `حسب سجل المكتب حتى ${d}`,
    statusH: "حالة حسابك", incomplete: "بيانات العقد غير مكتملة لدى المكتب بعد — تظهر حالتك هنا بعد استكمالها.",
    owedLbl: (vat: string) => `المستحق عليك${vat}`, cur: "ريال", sar: (n: string) => `${n} ريال`,
    lateN: "دفعات متأخرة", lateCount: (n: number) => n === 1 ? "دفعة واحدة" : n === 2 ? "دفعتان" : `${n} دفعات`,
    lateSince: "متأخر منذ", partialDue: "مدفوع جزئيًّا من الدفعة المستحقة", carried: "دين مرحَّل من مدة سابقة",
    clear: "لا متأخرات عليك ✓", prepaid: "مدفوع مقدّمًا من الدفعة القادمة",
    vatTag: " (شاملة الضريبة)",
    withRenewal: "مع تجديد العقد",
    contractH: "عقدك", contractNo: "رقم العقد", instalment: (vat: string) => `قيمة الدفعة${vat}`, cycle: "دورة السداد",
    next: "الدفعة القادمة", start: "بداية العقد", end: "نهاية العقد", stmt: "كشف الحساب (طباعة / PDF)",
    claimH: "أرسلت الحوالة؟", claimIntro: "أبلغ المكتب بحوالتك ليطابقها مع الحساب البنكي ثم يسجّل دفعتك. لا تحتاج صورة.",
    claimMany: "لديك 3 حوالات بانتظار المراجعة — انتظر قرار المكتب ثم أبلغ عن غيرها.",
    fAmount: "المبلغ المحوَّل (ريال)", fDate: "تاريخ الحوالة", fRef: "رقم المرجع في البنك (اختياري)", fNote: "ملاحظة (اختياري)",
    fNotePh: "مثال: إيجار شهر أكتوبر", claimBtn: "أرسل بلاغ الحوالة",
    waOr: "أو", waLink: "أرسل صورة الإيصال واتساب",
    waText: (ul: string, unit: string, prop: string, name: string) => `السلام عليكم، أرسلت حوالة إيجار ${ul} (${unit}) في ${prop} — مرفق صورة الإيصال. ${name}`,
    transfer: (d: string) => `حوالة ${d}`, ref: "مرجع", cOk: "سُجّلت ✓", cNo: "رُفضت", cWait: "بانتظار المراجعة", rejWhy: "سبب الرفض:",
    paysH: "دفعاتك المسجّلة", carriedPay: " · سداد دين مرحَّل", receipt: "🧾 سند القبض", noPays: "لا دفعات مسجّلة في هذا العقد بعد.",
    reqMany: "لديك 5 طلبات مفتوحة — ينتظر بعضها الإنجاز قبل فتح طلب جديد.",
    newReq: "+ طلب صيانة جديد", rCat: "نوع المشكلة", rWhere: "مكانها", rIn: (ul: string) => `داخل ${ul}`, rCommon: "الأجزاء المشتركة",
    rDesc: "الوصف", rDescPh: "مثال: تسريب مياه تحت مغسلة المطبخ",
    urgent: `<b style="color:#A5322C">عاجل</b> — تسريب ماء، انقطاع كهرباء، مصعد متوقف، باب لا يُقفل`, reqBtn: "أرسل الطلب",
    reqH: "طلبات الصيانة", noReqs: "لا طلبات بعد. أبلغ عن أي عطل من هنا.",
    foot: (org: string, ph: string) => `هذه الصفحة خاصة بك وحدك — لا تشارك رابطها.<br>أي ملاحظة على الأرقام؟ تواصل مع ${org || "المكتب"}${ph ? ` (<span dir="ltr">${ph}</span>)` : ""}.<br>عبر منصة وثيق`,
    pageTitle: (prop: string) => `${prop} — صفحة المستأجر`, badge: "صفحة المستأجر", switchTo: "English", switchLang: "en",
    officeReply: "ردّ المكتب", before: "صور قبل الصيانة", after: "صور بعد الصيانة",
    date: gDate, method: methodAr, cat: requestCatAr, loc: requestLocAr, rstatus: (s: string) => TENANT_REQUEST_STATUS_AR[s] || s,
    freq: (f: string) => freqLabel(f), cats: REQUEST_CATEGORIES,
  },
  en: {
    flash: {
      claim_ok: "Your transfer notice reached the office. Once it is matched with the bank account, your payment is recorded and shown here.",
      claim_amount: "Enter the transferred amount in SAR (more than zero).",
      claim_date: "The transfer date cannot be in the future or older than 90 days.",
      claim_ref: "The reference or note is longer than allowed.",
      claim_many: "You have 3 transfers awaiting review — please wait for the office before reporting another.",
      claim_norent: "The rent amount is not recorded yet — please contact the office.",
      claim_err: "Couldn't send the transfer notice right now — please try again shortly.",
      req_ok: "Your maintenance request reached the office. You can follow its status here.",
      req_bad: "Choose the problem type and location, then send again.",
      req_text: "Describe the problem (3 to 1000 characters).",
      req_many: "You have 5 open requests — some need to be completed before opening a new one.",
      req_err: "Couldn't send the request right now — please try again shortly.",
      inactive: "Notices from this page are paused for now — please contact the office directly.",
    } as Record<string, string>,
    inactiveNote: (ph: string) => `This page is view-only for now — for transfers and maintenance, contact the office directly${ph ? ` at <span dir="ltr">${ph}</span>` : ""}.`,
    asOf: (d: string) => `As per the office records up to ${d}`,
    statusH: "Your account", incomplete: "Your lease details are not complete at the office yet — your status will appear here once they are.",
    owedLbl: (vat: string) => `Amount due${vat}`, cur: "SAR", sar: (n: string) => `SAR ${n}`,
    lateN: "Overdue instalments", lateCount: (n: number) => n === 1 ? "1 instalment" : `${n} instalments`,
    lateSince: "Overdue since", partialDue: "Paid partially towards the due instalment", carried: "Balance carried from a previous term",
    clear: "No overdue amounts ✓", prepaid: "Paid in advance towards the next instalment",
    vatTag: " (incl. VAT)",
    withRenewal: "On lease renewal",
    contractH: "Your lease", contractNo: "Lease number", instalment: (vat: string) => `Instalment${vat}`, cycle: "Payment cycle",
    next: "Next instalment", start: "Lease start", end: "Lease end", stmt: "Account statement (print / PDF)",
    claimH: "Made a transfer?", claimIntro: "Tell the office about your transfer so they can match it with the bank account and record your payment. No photo needed.",
    claimMany: "You have 3 transfers awaiting review — please wait for the office before reporting another.",
    fAmount: "Amount transferred (SAR)", fDate: "Transfer date", fRef: "Bank reference (optional)", fNote: "Note (optional)",
    fNotePh: "e.g. October rent", claimBtn: "Send transfer notice",
    waOr: "Or", waLink: "send the receipt photo on WhatsApp",
    waText: (ul: string, unit: string, prop: string, name: string) => `Hello, I have transferred the rent for ${ul} (${unit}) at ${prop} — receipt photo attached. ${name}`,
    transfer: (d: string) => `Transfer on ${d}`, ref: "ref.", cOk: "Recorded ✓", cNo: "Rejected", cWait: "Awaiting review", rejWhy: "Reason:",
    paysH: "Your recorded payments", carriedPay: " · carried balance", receipt: "🧾 Receipt", noPays: "No payments recorded for this lease yet.",
    reqMany: "You have 5 open requests — some need to be completed before opening a new one.",
    newReq: "+ New maintenance request", rCat: "Problem type", rWhere: "Location", rIn: (_ul: string) => "Inside the unit", rCommon: "Common areas",
    rDesc: "Description", rDescPh: "e.g. Water leak under the kitchen sink",
    urgent: `<b style="color:#A5322C">Urgent</b> — water leak, power cut, lift stopped, door won't lock`, reqBtn: "Send request",
    reqH: "Maintenance requests", noReqs: "No requests yet. Report any issue from here.",
    foot: (org: string, ph: string) => `This page is private to you — please do not share its link.<br>Any question about the figures? Contact ${org || "the office"}${ph ? ` (<span dir="ltr">${ph}</span>)` : ""}.<br>Powered by Watheq`,
    pageTitle: (prop: string) => `${prop} — Tenant page`, badge: "Tenant page", switchTo: "العربية", switchLang: "ar",
    officeReply: "Office reply", before: "Before maintenance", after: "After maintenance",
    date: enDate, method: (m?: string | null) => METHOD_EN[String(m || "")] || "—",
    cat: (v?: string | null) => CAT_EN[String(v || "")] || "Other", loc: (v?: string | null) => v === "unit" ? "Inside the unit" : "Common areas",
    rstatus: (s: string) => STATUS_EN[s] || s, freq: (f: string) => FREQ_EN[String(f || "")] || String(f || "—"),
    cats: REQUEST_CATEGORIES.map((c) => ({ v: c.v, l: CAT_EN[c.v] || c.l })),
  },
};

const FLASH_TONE: Record<string, string> = {
  claim_ok: "f-ok", claim_amount: "f-err", claim_date: "f-err", claim_ref: "f-err", claim_many: "f-warn", claim_norent: "f-warn", claim_err: "f-err",
  req_ok: "f-ok", req_bad: "f-err", req_text: "f-err", req_many: "f-warn", req_err: "f-err", inactive: "f-warn",
};
export const TENANT_FLASH_CODES = new Set(Object.keys(FLASH_TONE));

/** لغة الصفحة: ?lang= يغلب (زرّ التبديل)، ثم لغة المستأجر — «both» تبدأ عربية */
export function portalLang(tenantLang: unknown, override?: string | null): PortalLang {
  if (override === "en" || override === "ar") return override;
  return tenantLang === "en" ? "en" : "ar";
}


/** ما يُعرض للمستأجر من الأرقام — بالمحرّك نفسه وبالضريبة كما في كشف الحساب */
export function tenantFigures(d: TenantPortalData) {
  const t = d.tenant, p = d.property;
  const st = contractState(t as any, statusWindows(p as any, (d.office || {}) as any));
  const v = { enabled: unitVatApplies(t as any, p as any), rate: Number(p.vat_rate) || 15, inclusive: p.vat_inclusive !== false };
  const incl = (n: number) => (v.enabled ? splitVat(Number(n) || 0, v).total : Number(n) || 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const carried = Math.max(0, Number(t.carried_debt) || 0);
  const late = r2(incl(st.amountDue));
  return {
    st, v, incl,
    rentIncl: r2(incl(Number(t.rent_amount) || 0)),
    late, carried,
    owed: r2(late + carried),
    partialIncl: st.hasPartial ? r2(incl(Number(st.partial) || 0)) : 0,
  };
}

/** مراحل الطلب: الاستلام (تلقائي عند الإرسال) ثم كل تغيير من المكتب بتاريخه وردّه */
type Dict = typeof T.ar | typeof T.en;
function reqSteps(r: TenantPortalData["requests"][number], L: Dict = T.ar): string {
  const steps: { label: string; at: string; note: string | null; tone: string }[] = [
    { label: L.rstatus("new"), at: r.created_at, note: null, tone: "#9A5B00" }];
  for (const x of r.log || []) {
    steps.push({ label: L.rstatus(x.to), at: x.at, note: x.note || null,
      tone: x.to === "done" ? "#137A50" : x.to === "rejected" ? "#A5322C" : "#9A5B00" });
  }
  /* قبل أي سجل (أو صف قديم): آخر ردّ للمكتب كما كان */
  if (!(r.log || []).length && r.manager_note) steps.push({ label: L.officeReply, at: r.updated_at, note: r.manager_note, tone: "#35514C" });
  return `<ol style="list-style:none;margin:8px 0 0;padding:0;padding-inline-start:12px;border-inline-start:2px solid #E4DDCD">${steps.map((x) => `
    <li style="position:relative;padding:3px 0 6px;font-size:13px">
      <span aria-hidden="true" style="position:absolute;inset-inline-start:-19px;top:9px;width:10px;height:10px;border-radius:99px;background:${x.tone}"></span>
      <b style="color:${x.tone}">${esc(x.label)}</b> <span class="muted">· ${L.date(riyadhDay(x.at))}</span>
      ${x.note ? `<div style="overflow-wrap:anywhere">${esc(x.note)}</div>` : ""}
    </li>`).join("")}</ol>`;
}

/** v79: صور الصيانة قبل/بعد لكل طلب — روابط موقّتة يولّدها المسار بمفتاح الخدمة */
export type TenantReqPhotos = Record<string, { before: string[]; after: string[] }>;

function reqPhotos(p?: { before: string[]; after: string[] }, L: Dict = T.ar): string {
  if (!p || (!p.before.length && !p.after.length)) return "";
  const strip = (label: string, urls: string[], tone: string) => !urls.length ? "" : `
    <div style="margin-top:8px"><div style="font-size:12px;font-weight:700;color:${tone}">${label}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${urls.map((u) =>
      `<a href="${esc(u)}" target="_blank" rel="noreferrer"><img src="${esc(u)}" alt="${label}" loading="lazy" style="width:76px;height:76px;object-fit:cover;border-radius:10px;border:1px solid #E4DDCD"></a>`).join("")}</div></div>`;
  return strip(L.before, p.before, "#8A5A11") + strip(L.after, p.after, "#137A50");
}

export function renderTenantPage(d: TenantPortalData, opts: { nonce: string; base: string; flash?: string | null; photos?: TenantReqPhotos; lang?: PortalLang }): string {
  const t = d.tenant, p = d.property, o = d.office || {};
  const lang: PortalLang = opts.lang || portalLang((t as any).msg_lang);
  const L: Dict = T[lang];
  const base = opts.base;
  const ul = lang === "en" ? unitWordEn((t as any).unit_type, p.property_type) : unitWordFor((t as any).unit_type, p.property_type);
  const f = tenantFigures(d);
  const st = f.st;
  const org = String(o.billing_name || o.org_name || "").trim();
  const wa = (() => { const n = waNumber(o.billing_phone || ""); return /^9665\d{8}$/.test(n) ? n : ""; })();
  const vatTag = f.v.enabled ? L.vatTag : "";
  const ph = o.billing_phone ? esc(o.billing_phone) : "";

  const flash = opts.flash && FLASH_TONE[opts.flash] ? `<div class="flash ${FLASH_TONE[opts.flash]}" role="status">${L.flash[opts.flash]}</div>` : "";
  const inactive = !d.active ? `<div class="flash f-warn">${L.inactiveNote(ph)}</div>` : "";
  /* زرّ اللغة — يغيّر هذه الزيارة فقط (?lang=) */
  const switcher = `<div class="noprint" style="text-align:end;margin:-4px 0 8px"><a href="${base}?lang=${L.switchLang}" style="font-size:13px;font-weight:700" lang="${L.switchLang}">🌐 ${L.switchTo}</a></div>`;

  /* ١) الحالة — تُخفى كلها إن أخفاها المكتب لهذه الوحدة */
  const asOf = `<div class="muted" style="margin-top:6px">${L.asOf(L.date(d.today))}</div>`;
  const status = !d.show_balance ? "" : st.incomplete ? `
<section class="card"><h2>${L.statusH}</h2>
  <div class="muted">${L.incomplete}</div>
</section>` : f.owed > 0 ? `
<section class="card st-late"><h2>${L.statusH}</h2>
  <div class="muted">${L.owedLbl(vatTag)}</div>
  <div><span class="big">${money(f.owed)}</span><span class="cur">${L.cur}</span></div>
  ${st.unpaid > 0 ? `<div class="row"><span>${L.lateN}</span><b>${L.lateCount(st.unpaid)}</b></div>` : ""}
  ${f.late > 0 && st.nextDueDate ? `<div class="row"><span>${L.lateSince}</span><b>${L.date(st.nextDueDate)}</b></div>` : ""}
  ${f.partialIncl > 0 ? `<div class="row"><span>${L.partialDue}</span><b>${L.sar(money(f.partialIncl))}</b></div>` : ""}
  ${f.carried > 0 ? `<div class="row"><span>${L.carried}</span><b>${L.sar(money(f.carried))}</b></div>` : ""}
  ${asOf}
</section>` : `
<section class="card st-clear"><h2>${L.statusH}</h2>
  <div class="big" style="font-size:22px;color:#137A50">${L.clear}</div>
  ${f.partialIncl > 0 ? `<div class="row"><span>${L.prepaid}</span><b>${L.sar(money(f.partialIncl))}</b></div>` : ""}
  ${asOf}
</section>`;

  /* ٢) العقد والدفعة القادمة */
  const upcoming = st.vacant ? "—" : st.upcomingDate ? `${L.date(st.upcomingDate)}${lang === "ar" && hDate(st.upcomingDate) && t.calendar === "hijri" ? `<br><span class="muted">${esc(hDate(st.upcomingDate))}</span>` : ""}`
    : st.endDate ? L.withRenewal : "—";
  const contract = `
<section class="card"><h2>${L.contractH}</h2>
  <div class="row"><span>${esc(ul)}</span><b>${esc(t.unit || "—")}</b></div>
  ${t.contract_no ? `<div class="row"><span>${L.contractNo}</span><b dir="ltr">${esc(t.contract_no)}</b></div>` : ""}
  <div class="row"><span>${L.instalment(vatTag)}</span><b>${L.sar(money(f.rentIncl))}</b></div>
  <div class="row"><span>${L.cycle}</span><b>${esc(L.freq(t.payment_frequency))}</b></div>
  <div class="row"><span>${L.next}</span><b style="text-align:end">${upcoming}</b></div>
  ${t.contract_start ? `<div class="row"><span>${L.start}</span><b>${L.date(String(t.contract_start))}</b></div>` : ""}
  ${st.endDate ? `<div class="row"><span>${L.end}</span><b>${L.date(st.endDate)}</b></div>` : ""}
  ${d.show_balance ? `<div class="noprint" style="margin-top:10px"><a class="btn b-ghost" href="${base}/s">${L.stmt}</a></div>` : ""}
</section>`;

  /* ٣) «أرسلت الحوالة» — نص فقط */
  const claims = d.claims || [];
  const pendingN = claims.filter((c) => c.status === "pending").length;
  const minDay = addDaysIso(d.today, -90);
  const suggest = d.show_balance && f.owed > 0 ? f.owed : f.rentIncl;
  const claimForm = !d.active ? "" : pendingN >= 3 ? `<div class="flash f-warn">${L.claimMany}</div>` : `
  <form method="post" action="${base}/claim" data-once="1" class="noprint">
    <label class="f" for="ca">${L.fAmount}</label>
    <input class="fld" id="ca" name="amount" required inputmode="decimal" autocomplete="off" dir="ltr"${suggest > 0 ? ` placeholder="${esc(String(suggest))}"` : ""}>
    <label class="f" for="cd">${L.fDate}</label>
    <input class="fld" id="cd" name="transfer_date" type="date" required value="${esc(d.today)}" min="${esc(minDay)}" max="${esc(d.today)}">
    <label class="f" for="cr">${L.fRef}</label>
    <input class="fld" id="cr" name="bank_ref" maxlength="80" dir="ltr" autocomplete="off">
    <label class="f" for="cn">${L.fNote}</label>
    <input class="fld" id="cn" name="note" maxlength="300" placeholder="${L.fNotePh}">
    <button class="btn b-gold" type="submit" style="width:100%;margin-top:12px">${L.claimBtn}</button>
  </form>`;
  const claimBox = !d.active && !claims.length ? "" : `
<section class="card" id="claim"><h2>${L.claimH}</h2>
  ${d.active ? `<div class="muted">${L.claimIntro}</div>` : ""}
  ${claimForm}
  ${wa && d.active ? `<div class="muted noprint" style="margin-top:8px">${L.waOr} <a href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(L.waText(ul, t.unit || "—", p.name, t.name))}" target="_blank" rel="noopener noreferrer">${L.waLink}</a></div>` : ""}
  ${claims.length ? `<div style="margin-top:12px">${claims.map((c) => `<div class="item"><div class="h">
    <div><b>${L.sar(money(c.amount))}</b><div class="muted">${L.transfer(L.date(c.transfer_date))}${c.bank_ref ? ` · ${L.ref} <span dir="ltr">${esc(c.bank_ref)}</span>` : ""}</div></div>
    ${c.status === "approved" ? `<span class="chip c-ok">${L.cOk}</span>` : c.status === "rejected" ? `<span class="chip c-no">${L.cNo}</span>` : `<span class="chip c-wait">${L.cWait}</span>`}</div>
    ${c.status === "rejected" && c.reject_reason ? `<div class="muted" style="color:#8F2B26">${L.rejWhy} ${esc(c.reject_reason)}</div>` : ""}
  </div>`).join("")}</div>` : ""}
</section>`;

  /* ٤) سجل الدفعات (المدة الحالية) — الدفعة المعكوسة وعكسها يسقطان معًا */
  const shown = visiblePayments((d.payments || []) as any[]).filter((x: any) => !x._adjust).reverse();
  const pays = `
<section class="card"><h2>${L.paysH}</h2>
  ${shown.length ? shown.map((x: any) => `<div class="row">
    <div><b>${L.sar(money(f.v.enabled && !f.v.inclusive && (!x.applies_to || x.applies_to === "rent") ? splitVat(Number(x.amount) || 0, f.v).total : Number(x.amount)))}</b>
      <div class="muted">${L.date(x.paid_on)} · ${L.method(x.method)}${x.applies_to === "carried" ? L.carriedPay : ""}</div></div>
    <span style="align-self:center;text-align:end">${x.reference ? `<span class="muted" dir="ltr">${esc(x.reference)}</span><br>` : ""}${Number(x.amount) > 0 && !x.reverses ? `<a class="noprint" href="${base}/p/${esc(String(x.id))}" style="font-size:12px;white-space:nowrap">${L.receipt}</a>` : ""}</span>
  </div>`).join("") : `<div class="muted">${L.noPays}</div>`}
</section>`;

  /* ٥) طلبات الصيانة — نص فقط */
  const reqs = d.requests || [];
  const openReqs = reqs.filter((r) => r.status === "new" || r.status === "in_progress").length;
  const reqForm = !d.active ? "" : openReqs >= 5 ? `<div class="flash f-warn">${L.reqMany}</div>` : `
  <details class="more noprint"${reqs.length ? "" : " open"} style="margin-top:10px"><summary>${L.newReq}</summary>
  <form method="post" action="${base}/request" data-once="1">
    <label class="f" for="rc">${L.rCat}</label>
    <select class="fld" id="rc" name="category" required>${L.cats.map((c) => `<option value="${esc(c.v)}">${esc(c.l)}</option>`).join("")}</select>
    <div class="f">${L.rWhere}</div>
    <div class="radio"><label><input type="radio" name="location" value="unit" checked> ${esc(L.rIn(ul))}</label><label><input type="radio" name="location" value="common"> ${L.rCommon}</label></div>
    <label class="f" for="rd">${L.rDesc}</label>
    <textarea class="fld" id="rd" name="description" rows="3" required minlength="3" maxlength="1000" placeholder="${L.rDescPh}"></textarea>
    <label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-size:14px"><input type="checkbox" name="urgent" value="1" style="margin-top:5px"> <span>${L.urgent}</span></label>
    <button class="btn b-deep" type="submit" style="width:100%;margin-top:12px">${L.reqBtn}</button>
  </form></details>`;
  const reqBox = !d.active && !reqs.length ? "" : `
<section class="card" id="req"><h2>${L.reqH}</h2>
  ${reqs.length ? reqs.map((r) => `<div class="item"><div class="h">
    <div style="min-width:0"><b>${esc(L.cat(r.category))}</b> <span class="muted">· ${esc(r.location === "unit" ? L.rIn(ul) : L.loc(r.location))}</span></div>
    <span class="chip ${r.status === "done" ? "c-ok" : r.status === "rejected" ? "c-no" : "c-wait"}">${esc(L.rstatus(r.status))}</span></div>
    <div style="overflow-wrap:anywhere;margin-top:4px">${esc(r.description)}</div>
    ${reqSteps(r, L)}
    ${reqPhotos(opts.photos?.[r.id], L)}
  </div>`).join("") : `<div class="muted">${L.noReqs}</div>`}
  ${reqForm}
</section>`;

  const foot = `<div class="foot">${L.foot(org ? esc(org) : "", ph)}</div>`;

  const html = frame(L.pageTitle(p.name),
    topBar(org || null, p.name, `${esc(t.name)}${t.unit ? ` · ${esc(ul)} ${esc(t.unit)}` : ""}`, L.badge),
    switcher + flash + inactive + status + contract + claimBox + pays + reqBox + foot, opts.nonce,
    /* منع الإرسال المزدوج — السكربت الوحيد ويحمل nonce الاستجابة */
    `(function(){document.querySelectorAll('form[data-once]').forEach(function(f){f.addEventListener('submit',function(e){if(f.dataset.s){e.preventDefault();return;}f.dataset.s='1';setTimeout(function(){f.querySelectorAll('button').forEach(function(x){x.disabled=true;});},0);});});})();`);
  return lang === "en" ? html.replace('<html lang="ar" dir="rtl">', '<html lang="en" dir="ltr">') : html;
}

/** سند قبض دفعة إيجار من صفحة المستأجر (schema-v80) — /r/t/{token}/p/{payment} */
export type TenantReceiptData = {
  payment: { id: string; paid_on: string; amount: number; method: string | null; reference: string | null; periods_covered: number | null;
    applies_to: string | null; receipt_no: string | null; created_at: string; payer_name: string | null; unit_label: string | null; reversed_on: string | null;
    /** (v88) ملاحظة المكتب على الدفعة — تُطبع في السند */
    note?: string | null };
  tenant: { name: string; unit: string | null; unit_type: string | null; contract_no: string | null; payment_frequency: string | null; vat_mode: string | null };
  property: { name: string; city: string | null; property_type: string | null; vat_enabled: boolean | null; vat_rate: number | null; vat_inclusive: boolean | null };
  office: Record<string, any> | null;
};
export function renderTenantReceiptPage(d: TenantReceiptData, opts: { nonce: string; base: string }): string {
  const { payment: x, tenant: t, property: p } = d; const o = d.office || {};
  const org = String(o.billing_name || o.org_name || "").trim();
  const ul = unitWordFor(t.unit_type, p.property_type);
  const unit = String(x.unit_label || t.unit || "—");
  const no = x.receipt_no || "—";
  const reversed = !!x.reversed_on;
  const n = Number(x.periods_covered) || 0;
  const statement = x.applies_to === "carried" ? "سداد دين مرحَّل من مدة سابقة"
    : x.applies_to === "past_debt" ? "سداد متأخرات مستأجر سابق"
    : `أجرة ${ul} رقم (${unit})${n > 0 ? ` — ${n === 1 ? "دفعة واحدة" : n === 2 ? "دفعتان" : `${n} دفعات`} (${freqLabel(t.payment_frequency)})` : " — دفعة جزئية"}`;
  const hij = hDate(x.paid_on);
  const note = String(x.note || "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "").replace(/\s*[—-]\s*$/, "").trim().slice(0, 500);
  const body = `
<p class="noprint" style="margin:0 0 4px"><a href="${opts.base}">→ العودة إلى صفحتك</a></p>
<section class="card" style="padding:20px;position:relative">
  ${reversed ? `<div role="status" style="border:2px solid #A5322C;color:#A5322C;border-radius:10px;padding:8px 12px;margin-bottom:12px;font-weight:700;text-align:center">سند معكوس — أُلغيت هذه الدفعة${x.reversed_on ? ` بتاريخ ${gDate(riyadhDay(x.reversed_on))}` : ""} ولا يُعتدّ بها</div>` : ""}
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;border-bottom:2px solid #0E3A37;padding-bottom:10px">
    <div style="min-width:0"><div style="font-size:20px;font-weight:700;color:#0E3A37">سند قبض</div>
      <div class="muted">${esc(org || "إدارة الأملاك")}</div>${o.cr_number ? `<div class="muted" style="font-size:11.5px">س.ت ${esc(o.cr_number)}</div>` : ""}</div>
    <div style="text-align:left;flex:none"><div class="muted">رقم السند</div><b dir="ltr" style="font-family:monospace;white-space:nowrap">${esc(no)}</b></div>
  </div>
  <div class="row"><span>التاريخ</span><b>${gDate(x.paid_on)}${hij ? `<br><span class="muted">${esc(hij)}</span>` : ""}</b></div>
  <div class="row"><span>استلمنا من</span><b>${esc(x.payer_name || t.name)}</b></div>
  <div class="row"><span>${esc(ul)}</span><b>${esc(unit)} — ${esc(p.name)}</b></div>
  ${t.contract_no ? `<div class="row"><span>رقم العقد</span><b dir="ltr">${esc(t.contract_no)}</b></div>` : ""}
  <div class="row"><span>المبلغ</span><b style="font-size:18px">${money(x.amount)} ريال سعودي</b></div>
  <div class="row"><span>المبلغ كتابةً</span><b style="text-align:left;font-weight:600;overflow-wrap:anywhere">${esc(amountInWordsAr(x.amount))}</b></div>
  <div class="row"><span>طريقة الدفع</span><b>${methodAr(x.method)}</b></div>
  ${x.reference ? `<div class="row"><span>المرجع</span><b dir="ltr">${esc(x.reference)}</b></div>` : ""}
  <div class="row"><span>البيان</span><b style="text-align:left">${esc(statement)}</b></div>
  ${note ? `<div class="row"><span>ملاحظة</span><b style="text-align:left;font-weight:600;overflow-wrap:anywhere;white-space:pre-line">${esc(note)}</b></div>` : ""}
  <div class="row"><span>المستلِم</span><b style="text-align:left;overflow-wrap:anywhere">${esc(org || "إدارة الأملاك")}</b></div>
  <div class="note">سند إلكتروني مستخرج من سجل دفعات المكتب كما سجّلها، ولا يُعدّ إبراءً عمّا سواه من مستحقات.</div>
</section>
<div class="noprint" style="margin-top:14px;display:flex;gap:10px"><button class="btn b-deep" id="pr" type="button">طباعة / حفظ PDF</button></div>
<div class="foot">عبر منصة وثيق</div>`;
  return frame(`${reversed ? "سند معكوس" : "سند قبض"} ${no}`, topBar(org || null, p.name, `${esc(t.name)}${t.unit ? ` · ${esc(ul)} ${esc(t.unit)}` : ""}`, "سند قبض"),
    body, opts.nonce, `document.getElementById('pr').addEventListener('click',function(){window.print();});`);
}

export function renderTenantDeny(msg = "هذا الرابط غير متاح"): string {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>وثيق</title></head>
<body style="margin:0;font-family:Tahoma,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;background:#F4F1EA;color:#0B211F">
<div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:2rem">🔒</div>
<h1 style="font-size:1.1rem">${esc(msg)}</h1>
<p style="font-size:.9rem;color:#5C6B67">قد يكون الرابط قديمًا أو أُلغي. اطلب من مكتب إدارة الأملاك رابطًا جديدًا عبر واتساب.</p></div></body></html>`;
}
