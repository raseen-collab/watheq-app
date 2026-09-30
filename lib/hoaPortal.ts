/**
 * وثيق — بوابة المالك في اتحاد الملاك: عرض HTML خالص (بلا قاعدة ولا شبكة).
 *
 * يُستدعى من app/r/o/[token]/** بعد جلب البيانات من دوال watheq_hoa_portal*
 * (schema-v61). كل نص مصدره القاعدة يمرّ على esc()، ونص المستند يمرّ على
 * sanitizeHoaHtml مرة أخرى عند العرض. السكربت الوحيد في الصفحات يحمل nonce
 * الاستجابة، وسياسة CSP تمنع غيره.
 */
import { sanitizeHoaHtml } from "./hoaSanitize";
import { periodsAr, PERIOD_WORDS, expenseCatAr, amountInWordsAr, type BuildingData, type FeePeriod } from "./hoaMoney";
import { waNumber } from "./utils";

// ─── الأنواع ────────────────────────────────────────────────────
export type PortalOwner = {
  name: string; unit: string | null; months_late: number; partial_amount: number;
  prepaid_months: number; last_paid: string | null;
  /** v63: رسم هذا المالك للفترة وحصته (إن وُزّعت الرسوم بالحصص) */
  fee?: number | null; share_pct?: number | null;
  /** v64: false = المدير لم يؤكد الرصيد الافتتاحي بعد */
  opening_set?: boolean | null;
};
export type PortalPayment = {
  id: string; paid_on: string; amount: number; method: string | null; reference: string | null; periods_covered: number | null;
};
export type PortalDocItem = {
  id: string; kind: string; title: string; created_at: string; requires_signature: boolean;
  closes_at: string | null; decision: "approve" | "reject" | null; decided_at: string | null; seen_at: string | null;
};
export type PortalData = {
  association: { name: string; fee: number; fee_period?: string | null; fee_basis?: string | null;
    mullak_reg_no?: string | null; unified_no?: string | null;
    bank_name?: string | null; bank_account_name?: string | null; iban?: string | null };
  office: { org_name: string | null; billing_name?: string | null; billing_phone?: string | null } | null;
  owner: PortalOwner;
  today: string;
  payments: PortalPayment[];
  documents: PortalDocItem[];
  /** v62: أرقام العمارة المجمَّعة (بلا أسماء) */
  building?: BuildingData | null;
  /** v64: دفعات عُكست — تُفتح سنداتها برابط مباشر بختم «سند معكوس» ولا تظهر في القائمة */
  reversed_payments?: (PortalPayment & { reversed_on?: string | null })[];
};
export type PortalDocData = {
  status: "ok";
  association: { name: string };
  owner: { name: string; unit: string | null };
  today: string;
  document: {
    id: string; kind: string; title: string; body_html: string; body_sha256: string | null; created_at: string;
    requires_signature: boolean; closes_at: string | null;
  };
  mine: { decision: "approve" | "reject" | "seen"; signed_at: string; typed_name: string | null }[];
};

// ─── أدوات ─────────────────────────────────────────────────────
export const esc = (v: unknown): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** 1,234.50 — الكسور بمنزلتين والصحيح بلا كسور */
export const money = (n: unknown): string => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const abs = Math.abs(v);
  const t = Number.isInteger(abs) ? abs.toLocaleString("en-US")
    : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `−${t}` : t;
};

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** YYYY-MM-DD → «5 مارس 2026» (ميلادي بأسماء عربية) */
export function gDate(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "—";
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return "—";
  return `${Number(m[3])} ${MONTHS_AR[mo]} ${m[1]}`;
}

/** YYYY-MM-DD → هجري أم القرى بتوقيت الرياض «13 ربيع الآخر 1448 هـ» */
export function hDate(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  try {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+03:00`);
    return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", {
      timeZone: "Asia/Riyadh", day: "numeric", month: "long", year: "numeric",
    }).format(d);
  } catch { return ""; }
}

/** طابع زمني → «5 مارس 2026 · 14:05» بتوقيت الرياض */
export function riyadhStamp(ts?: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${gDate(day)} · ${time}`;
}
const riyadhDay = (ts: string) => {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

const METHOD_AR: Record<string, string> = { transfer: "تحويل بنكي", cash: "نقدًا", pos: "شبكة", cheque: "شيك", other: "أخرى" };
export const methodAr = (m?: string | null) => METHOD_AR[String(m || "")] || "—";
const KIND_AR: Record<string, string> = { minutes: "محضر", notice: "إشعار", circular: "تعميم", budget: "موازنة", other: "مستند" };
export const kindAr = (k?: string | null) => KIND_AR[String(k || "")] || "مستند";
export const receiptNo = (id: string) => String(id || "").replace(/-/g, "").slice(0, 8).toUpperCase();

/** فترة الاشتراك من بيانات البوابة (v63) — الافتراضي شهري كما قبلها */
const periodOfPortal = (a?: { fee_period?: string | null } | null): FeePeriod => (a?.fee_period === "annual" ? "annual" : "monthly");

/** حالة المالك من نموذج v60: الرصيد = مقدَّم×الرسم + الجزئي − متأخر×الرسم */
export function ownerStatus(o: PortalOwner, fee: number) {
  const late = Math.max(0, Number(o.months_late) || 0);
  const partial = Number(o.partial_amount) || 0;
  const prepaid = Math.max(0, Number(o.prepaid_months) || 0);
  const f = Number(fee) || 0;
  if (late > 0) {
    return { kind: "late" as const, late, owed: Math.max(0, Math.round((late * f - partial) * 100) / 100), partial: partial > 0 ? partial : 0, prepaid: 0, credit: 0 };
  }
  const credit = Math.round((prepaid * f + Math.max(0, partial)) * 100) / 100;
  return { kind: credit > 0 ? "credit" as const : "clear" as const, late: 0, owed: 0, partial: Math.max(0, partial), prepaid, credit };
}

// ─── الإطار المشترك ─────────────────────────────────────────────
export const portalCsp = (nonce: string) =>
  `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;

export const portalHeaders = (nonce: string): Record<string, string> => ({
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": portalCsp(nonce),
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "cache-control": "no-store",
});

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#F4F1EA;color:#0B211F;font-family:Tahoma,"Segoe UI",system-ui,-apple-system,sans-serif;line-height:1.7;-webkit-text-size-adjust:100%}
.wrap{max-width:640px;margin:0 auto;padding:16px 16px 40px}
.top{background:#0E3A37;color:#F6F1E4;padding:18px 16px 22px}
.top .in{max-width:640px;margin:0 auto}
.org{font-size:12px;opacity:.75}
.top h1{margin:2px 0 4px;font-size:20px}
.who{font-size:14px;opacity:.9}
.card{background:#fff;border:1px solid #E4DDCD;border-radius:14px;padding:16px;margin-top:14px}
.card h2{font-size:15px;margin:0 0 10px;color:#0E3A37}
.muted{color:#5C6B67;font-size:12.5px}
.big{font-size:28px;font-weight:700;letter-spacing:.3px}
.cur{font-size:14px;font-weight:600;color:#5C6B67;margin-inline-start:4px}
.st-late{border-color:#EFC2BD;background:#FDF3F2}.st-late .big{color:#A5322C}
.st-credit{border-color:#BFE3CF;background:#F1FAF5}.st-credit .big{color:#137A50}
.st-clear{border-color:#BFE3CF;background:#F1FAF5}
.row{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-top:1px solid #F0EBDF;font-size:14px}
.row:first-of-type{border-top:0}
.chip{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:99px;background:#EEF1EF;color:#35514C;white-space:nowrap}
.c-ok{background:#E6F4EC;color:#137A50}.c-no{background:#FBE9E7;color:#A5322C}.c-wait{background:#FDF0DC;color:#9A5B00}
.doc{display:block;text-decoration:none;color:inherit;padding:12px 0;border-top:1px solid #F0EBDF}
.doc:first-of-type{border-top:0}
.doc .t{font-weight:700;font-size:14.5px}
.btn{display:inline-block;border:0;border-radius:10px;padding:11px 18px;font:inherit;font-weight:700;font-size:14.5px;cursor:pointer;text-decoration:none;text-align:center}
.b-deep{background:#0E3A37;color:#F6F1E4}.b-gold{background:#9A6314;color:#fff}.b-ghost{background:#fff;color:#0E3A37;border:1px solid #E4DDCD}
.b-ok{background:#137A50;color:#fff}.b-no{background:#fff;color:#A5322C;border:1.5px solid #A5322C}
.flash{border-radius:12px;padding:12px 14px;margin-top:14px;font-size:14px;font-weight:600}
.f-ok{background:#E6F4EC;color:#0F5E3D}.f-warn{background:#FDF0DC;color:#7A4800}.f-err{background:#FBE9E7;color:#8F2B26}
.pend{border:1.5px solid #E7C877;background:#FFFBF0}
a{color:#0E3A37}
.foot{margin-top:22px;font-size:11.5px;color:#7A857F;text-align:center}
.docbody{border:1px solid #E4DDCD;border-radius:12px;padding:14px;background:#FFFEFB;overflow-x:auto;font-size:14.5px}
.docbody table{border-collapse:collapse;width:100%}.docbody th,.docbody td{border:1px solid #DDD5C2;padding:6px 8px;text-align:start}
.docbody h1{font-size:19px}.docbody h2{font-size:17px}.docbody h3,.docbody h4{font-size:15px}
label.f{display:block;font-size:13px;font-weight:700;margin:12px 0 5px}
input.fld,textarea.fld{width:100%;border:1px solid #D9D1BE;border-radius:10px;padding:11px 12px;font:inherit;font-size:16px;background:#FBF8F1;color:#0B211F}
.ack{display:flex;gap:10px;align-items:flex-start;margin:14px 0;font-size:14px}
.ack input{width:20px;height:20px;margin-top:3px;flex:none}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.two .btn{white-space:normal}
.note{font-size:12px;color:#5C6B67;background:#F6F2E8;border-radius:10px;padding:10px 12px;margin-top:12px}
@media print{.noprint{display:none!important}body{background:#fff}.card{border-color:#ccc}}
`;

function frame(title: string, head: string, body: string, nonce: string, script = ""): string {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
${head}<main class="wrap">${body}</main>${script ? `<script nonce="${esc(nonce)}">${script}</script>` : ""}</body></html>`;
}

const topBar = (org: string | null | undefined, assoc: string, who: string, label = "بوابة المالك") => `
<header class="top"><div class="in">
  <div class="org">${org ? esc(org) + " · " : ""}${esc(label)}</div>
  <h1>${esc(assoc)}</h1>
  <div class="who">${who}</div>
</div></header>`;

const FLASH: Record<string, [string, string]> = {
  approve: ["f-ok", "سُجّل اعتمادك للمستند. شكرًا لك."],
  reject: ["f-ok", "سُجّل رفضك وملاحظتك، وتطّلع عليها إدارة الجمعية."],
  dup: ["f-warn", "سُجّل قرارك سابقًا — لا يمكن تغييره."],
  closed: ["f-warn", "انتهت مدة الرد على هذا المستند."],
  cancelled: ["f-warn", "أُلغي هذا المستند من إدارة الجمعية."],
  notreq: ["f-warn", "هذا المستند للاطلاع فقط ولا يحتاج اعتمادًا."],
  name: ["f-err", "اكتب اسمك الكامل (80 حرفًا كحد أقصى) ثم أعد المحاولة."],
  ack: ["f-err", "ضع علامة على الإقرار بالاطلاع قبل الاعتماد أو الرفض."],
  big: ["f-err", "الملاحظة أطول من المسموح."],
  err: ["f-err", "تعذّر تسجيل قرارك الآن — أعد المحاولة بعد قليل."],
};
const flashBox = (code?: string | null) => {
  const f = code ? FLASH[code] : null;
  return f ? `<div class="flash ${f[0]}" role="status">${f[1]}</div>` : "";
};

const whoLine = (name: string, unit: string | null) => `${esc(name)}${unit ? ` · ${esc(unit)}` : ""}`;

function docChip(d: { requires_signature: boolean; decision: string | null; seen_at?: string | null; closes_at: string | null }, today: string) {
  if (d.decision === "approve") return `<span class="chip c-ok">اعتمدتَه</span>`;
  if (d.decision === "reject") return `<span class="chip c-no">رفضتَه</span>`;
  if (d.requires_signature) {
    if (d.closes_at && d.closes_at < today) return `<span class="chip">انتهت مدة الرد</span>`;
    return `<span class="chip c-wait">بانتظار ردك</span>`;
  }
  return d.seen_at ? `<span class="chip">اطّلعت عليه</span>` : `<span class="chip">للاطلاع</span>`;
}

// ─── الصفحة الرئيسية ────────────────────────────────────────────
export function renderPortalPage(d: PortalData, opts: { nonce: string; base: string; flash?: string | null }): string {
  const fee = Number(d.owner.fee ?? d.association.fee) || 0;
  const per = periodOfPortal(d.association);
  const W = PERIOD_WORDS[per];
  const st = ownerStatus(d.owner, fee);
  const base = opts.base; // /r/o/<token>
  const share = d.owner.share_pct != null && d.association.fee_basis === "share"
    ? `<div class="row"><span>حصة وحدتك</span><b>${esc(Number(d.owner.share_pct).toLocaleString("en-US", { maximumFractionDigits: 4 }))}٪</b></div>` : "";
  const feeRow = `<div class="row"><span>${W.label}${d.association.fee_basis === "share" ? " لوحدتك" : ""}</span><b>${money(fee)} ريال</b></div>${share}`;

  const asOf = `<div class="muted" style="margin-top:6px">الأرقام حسب سجل الجمعية حتى ${gDate(d.today)}</div>`;
  const status = d.owner.opening_set === false ? `
<section class="card"><h2>حالة اشتراكك</h2>
  <div class="big" style="font-size:19px;color:#9A5B00">رصيدك قيد المراجعة لدى إدارة الجمعية</div>
  <div class="muted">تُدخل الإدارة رصيدك الافتتاحي (ما قبل التسجيل في هذه الصفحة)، ثم تظهر هنا حالتك كاملة.</div>
  ${feeRow}
</section>` : st.kind === "late" ? `
<section class="card st-late"><h2>حالة اشتراكك</h2>
  <div class="muted">المستحق عليك</div>
  <div><span class="big">${money(st.owed)}</span><span class="cur">ريال</span></div>
  <div class="row"><span>${per === "annual" ? "سنوات غير مسدَّدة" : "أشهر غير مسدَّدة"}</span><b>${periodsAr(st.late, per)}</b></div>
  ${st.partial > 0 ? `<div class="row"><span>مدفوع جزئيًّا من ${per === "annual" ? "السنة المستحقة" : "الشهر المستحق"}</span><b>${money(st.partial)} ريال</b></div>` : ""}
  ${feeRow}
  <div class="row"><span>آخر سداد</span><b>${d.owner.last_paid ? gDate(d.owner.last_paid) : "—"}</b></div>
</section>` : st.kind === "credit" ? `
<section class="card st-credit"><h2>حالة اشتراكك</h2>
  <div class="muted">لا مستحقات عليك — رصيدك لدى الجمعية</div>
  <div><span class="big">${money(st.credit)}</span><span class="cur">ريال</span></div>
  ${st.prepaid > 0 ? `<div class="row"><span>مسدَّد مقدَّمًا</span><b>${periodsAr(st.prepaid, per)}</b></div>` : ""}
  ${st.partial > 0 ? `<div class="row"><span>رصيد جزئي ${per === "annual" ? "للسنة القادمة" : "للشهر القادم"}</span><b>${money(st.partial)} ريال</b></div>` : ""}
  ${feeRow}
  <div class="row"><span>آخر سداد</span><b>${d.owner.last_paid ? gDate(d.owner.last_paid) : "—"}</b></div>
</section>` : `
<section class="card st-clear"><h2>حالة اشتراكك</h2>
  <div class="big" style="font-size:22px;color:#137A50">لا مستحقات عليك ✓</div>
  ${feeRow}
  <div class="row"><span>آخر سداد</span><b>${d.owner.last_paid ? gDate(d.owner.last_paid) : "—"}</b></div>
</section>`;

  const A = d.association;
  const iban = String(A.iban || "").replace(/\s+/g, "");
  const wa = (() => { const n = waNumber(d.office?.billing_phone || ""); return /^9665\d{8}$/.test(n) ? n : ""; })();
  const bank = st.kind === "late" && iban ? `
<section class="card"><h2>طريقة السداد</h2>
  <div class="muted">حوّل المبلغ إلى حساب الجمعية، ثم أرسل صورة الحوالة لإدارة الجمعية لتسجيلها وإصدار سندك.</div>
  ${A.bank_name ? `<div class="row"><span>البنك</span><b>${esc(A.bank_name)}</b></div>` : ""}
  ${A.bank_account_name ? `<div class="row"><span>اسم الحساب</span><b>${esc(A.bank_account_name)}</b></div>` : ""}
  <div class="row"><span>الآيبان</span><b dir="ltr" style="font-family:monospace;user-select:all">${esc(iban.replace(/(.{4})/g, "$1 ").trim())}</b></div>
  <div class="two noprint" style="margin-top:10px">
    <button class="btn b-ghost" type="button" id="cpiban" data-iban="${esc(iban)}">نسخ الآيبان</button>
    ${wa ? `<a class="btn b-ok" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(`السلام عليكم، أرسلت حوالة اشتراك ${d.owner.unit ? `الوحدة (${d.owner.unit})` : "وحدتي"} في ${d.association.name} — مرفق صورة الإيصال. ${d.owner.name}`)}" target="_blank" rel="noopener noreferrer">أرسلت الحوالة؟ أرسل صورة الإيصال للإدارة</a>` : ""}
  </div>
</section>` : "";

  const pending = d.documents.filter((x) => x.requires_signature && !x.decision && !(x.closes_at && x.closes_at < d.today));
  const pendingBox = pending.length ? `
<section class="card pend"><h2>مستندات بانتظار ردك (${pending.length})</h2>
  ${pending.map((x) => `<a class="doc" href="${base}/d/${esc(x.id)}">
    <div class="t">${esc(x.title)}</div>
    <div class="muted">${kindAr(x.kind)} · صدر ${gDate(riyadhDay(x.created_at))}${x.closes_at ? ` · آخر موعد للرد ${gDate(x.closes_at)}` : ""}</div>
    <div style="margin-top:8px"><span class="btn b-gold" style="padding:8px 14px;font-size:13.5px">اقرأ المستند ثم اعتمد أو ارفض</span></div>
  </a>`).join("")}
</section>` : "";

  const docs = `
<section class="card"><h2>مستندات الجمعية</h2>
  ${d.documents.length ? d.documents.map((x) => `<a class="doc" href="${base}/d/${esc(x.id)}">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
      <div class="t">${esc(x.title)}</div>${docChip(x, d.today)}</div>
    <div class="muted">${kindAr(x.kind)} · ${gDate(riyadhDay(x.created_at))}</div>
  </a>`).join("") : `<div class="muted">لا مستندات منشورة بعد.</div>`}
</section>`;

  const pays = `
<section class="card"><h2>سجل دفعاتك</h2>
  ${d.payments.length ? d.payments.map((p) => `<div class="row">
    <div><b>${money(p.amount)} ريال</b><div class="muted">${gDate(p.paid_on)} · ${methodAr(p.method)}</div></div>
    <a class="btn b-ghost" style="padding:6px 12px;font-size:12.5px;align-self:center" href="${base}/p/${esc(p.id)}">سند القبض</a>
  </div>`).join("") : `<div class="muted">لا دفعات مسجَّلة بعد.</div>`}
</section>`;

  const foot = `<div class="foot">هذه الصفحة خاصة بك وحدك — لا تشارك رابطها.<br>أي ملاحظة على الأرقام؟ تواصل مع إدارة الجمعية.<br>عبر منصة وثيق</div>`;

  const building = d.building ? buildingSection(d.building, { heading: "شفافية العمارة" }) : "";

  return frame(`${d.association.name} — بوابة المالك`,
    topBar(d.office?.org_name, d.association.name, whoLine(d.owner.name, d.owner.unit)),
    flashBox(opts.flash) + pendingBox + status.replace(/<\/section>\s*$/, `${asOf}</section>`) + bank + docs + pays + building + foot, opts.nonce,
    /* نسخ الآيبان — السكربت الوحيد في الصفحة ويحمل nonce الاستجابة */
    `(function(){var b=document.getElementById('cpiban');if(!b)return;b.addEventListener('click',function(){var t=b.getAttribute('data-iban')||'';function done(){b.textContent='نُسخ ✓';setTimeout(function(){b.textContent='نسخ الآيبان';},2000);}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,function(){});}else{var i=document.createElement('input');i.value=t;document.body.appendChild(i);i.select();try{document.execCommand('copy');done();}catch(e){}document.body.removeChild(i);}});})();`);
}

// ─── صفحة المستند ───────────────────────────────────────────────
export function renderDocPage(v: PortalDocData, opts: { nonce: string; base: string; flash?: string | null }): string {
  const doc = v.document;
  const decision = v.mine.find((m) => m.decision !== "seen");
  const seen = v.mine.find((m) => m.decision === "seen");
  const closed = !!(doc.closes_at && doc.closes_at < v.today);
  const base = opts.base;

  const meta = `<div class="muted">${kindAr(doc.kind)} · صدر ${riyadhStamp(doc.created_at)}${doc.closes_at ? ` · آخر موعد للرد ${gDate(doc.closes_at)} (${esc(hDate(doc.closes_at))})` : ""}</div>`;
  const mine = `
<section class="card"><h2>سجلّك مع هذا المستند</h2>
  <div class="row"><span>اطّلعت عليه</span><b>${seen ? riyadhStamp(seen.signed_at) : "الآن"}</b></div>
  ${decision ? `<div class="row"><span>${decision.decision === "approve" ? "اعتمدتَه" : "رفضتَه"} باسم</span><b>${esc(decision.typed_name)}</b></div>
  <div class="row"><span>وقت القرار</span><b>${riyadhStamp(decision.signed_at)}</b></div>` : ""}
  ${doc.body_sha256 ? `<div class="row"><span>بصمة المستند</span><b style="font-family:monospace;font-size:12px" dir="ltr">${esc(doc.body_sha256.slice(0, 16))}</b></div>` : ""}
</section>`;

  let action = "";
  if (doc.requires_signature && !decision) {
    action = closed ? `<section class="card"><div class="flash f-warn" style="margin:0">انتهت مدة الرد على هذا المستند في ${gDate(doc.closes_at)}.</div></section>` : `
<section class="card pend noprint"><h2>ردّك على المستند</h2>
  <form method="post" action="${base}/sign" id="sf">
    <input type="hidden" name="doc" value="${esc(doc.id)}">
    <label class="f" for="nm">اسمك الكامل</label>
    <input class="fld" id="nm" name="typed_name" required maxlength="80" autocomplete="name" placeholder="${esc(v.owner.name)}">
    <label class="f" for="cm">ملاحظة (اختياري)</label>
    <textarea class="fld" id="cm" name="comment" rows="2" maxlength="300"></textarea>
    <label class="ack"><input type="checkbox" name="ack" value="1" required>
      <span>أقرّ بأني اطّلعت على المستند أعلاه، وأن قراري أدناه صادر مني.</span></label>
    <div class="two">
      <button class="btn b-ok" type="submit" name="decision" value="approve">أوافق وأعتمد</button>
      <button class="btn b-no" type="submit" name="decision" value="reject">أرفض</button>
    </div>
  </form>
  <div class="note">يُسجَّل ردّك مرة واحدة ولا يمكن تعديله، ويُحفظ معه اسمك المكتوب ووقت الرد وعنوان الشبكة كدليل موثَّق على الاطلاع والقرار. هذا ليس توقيعًا إلكترونيًّا معتمدًا عبر «نفاذ».</div>
</section>`;
  }

  const body = `
<p class="noprint" style="margin:0"><a href="${base}">→ العودة إلى صفحتك</a></p>
${flashBox(opts.flash)}
<section class="card"><h2 style="font-size:18px">${esc(doc.title)}</h2>${meta}
  <div class="docbody" style="margin-top:12px">${sanitizeHoaHtml(doc.body_html) || `<p class="muted">—</p>`}</div>
</section>
${action}${mine}
<div class="foot">صادر عن إدارة ${esc(v.association.name)} عبر منصة وثيق</div>`;

  // يمنع الإرسال المزدوج بضغطتين
  const script = action && !closed
    ? `(function(){var f=document.getElementById('sf');if(!f)return;f.addEventListener('submit',function(e){if(f.dataset.s){e.preventDefault();return;}f.dataset.s='1';setTimeout(function(){f.querySelectorAll('button').forEach(function(b){b.disabled=true;});},0);});})();`
    : "";
  return frame(doc.title, topBar(null, v.association.name, whoLine(v.owner.name, v.owner.unit)), body, opts.nonce, script);
}

// ─── سند القبض ─────────────────────────────────────────────────
/**
 * السند (للمالك ولإدارة الجمعية): التاريخ بالتقويمين، المبلغ رقمًا وكتابةً (تفقيط)،
 * المستلِم (المكتب/إدارة الجمعية)، ورقم تسجيل الجمعية إن وُجد.
 * «الرصيد بعد هذه الدفعة» يُطبع فقط حين يُعرف من ردّ التسجيل نفسه (لا يُخمَّن لاحقًا).
 * السند المعكوس يُفتح برابطه المباشر بختم واضح بدل أن يختفي.
 */
export function renderReceiptPage(d: PortalData, p: PortalPayment, opts: { nonce: string; base: string;
  reversedOn?: string | null; balanceAfter?: { late: number; partial: number; prepaid: number; fee: number } | null }): string {
  const hij = hDate(p.paid_on);
  const org = d.office?.billing_name || d.office?.org_name;
  const per = periodOfPortal(d.association);
  const receiver = org ? `${esc(org)} — لصالح ${esc(d.association.name)}` : `إدارة ${esc(d.association.name)}`;
  const reg = [d.association.mullak_reg_no ? `رقم التسجيل في «ملاك»: ${esc(d.association.mullak_reg_no)}` : "",
    d.association.unified_no ? `الرقم الموحّد: ${esc(d.association.unified_no)}` : ""].filter(Boolean).join(" · ");
  const reversed = opts.reversedOn !== undefined && opts.reversedOn !== null;
  const ba = opts.balanceAfter;
  const balTxt = ba ? (ba.late > 0 ? `متبقٍّ ${money(Math.max(0, ba.late * ba.fee - ba.partial))} ريال (${periodsAr(ba.late, per)})`
    : ba.prepaid > 0 || ba.partial > 0 ? `لا مستحقات — رصيد لدى الجمعية ${money(ba.prepaid * ba.fee + ba.partial)} ريال` : "لا مستحقات") : "";
  const body = `
${opts.base ? `<p class="noprint" style="margin:0 0 4px"><a href="${opts.base}">→ العودة إلى صفحتك</a></p>` : ""}
<section class="card" style="padding:20px;position:relative">
  ${reversed ? `<div role="status" style="border:2px solid #A5322C;color:#A5322C;border-radius:10px;padding:8px 12px;margin-bottom:12px;font-weight:700;text-align:center">سند معكوس — أُلغيت هذه الدفعة${opts.reversedOn ? ` بتاريخ ${gDate(opts.reversedOn)}` : ""} ولا يُعتدّ بها</div>` : ""}
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;border-bottom:2px solid #0E3A37;padding-bottom:10px">
    <div style="min-width:0"><div style="font-size:20px;font-weight:700;color:#0E3A37">سند قبض</div>
      <div class="muted">${esc(d.association.name)}</div>${reg ? `<div class="muted" style="font-size:11.5px">${reg}</div>` : ""}</div>
    <div style="text-align:left;flex:none"><div class="muted">رقم السند</div><b dir="ltr" style="font-family:monospace;white-space:nowrap">${esc((p as any).receipt_no || receiptNo(p.id))}</b></div>
  </div>
  <div class="row"><span>التاريخ</span><b>${gDate(p.paid_on)}${hij ? `<br><span class="muted">${esc(hij)}</span>` : ""}</b></div>
  <div class="row"><span>استلمنا من</span><b>${esc((p as any).payer_name || d.owner.name)}</b></div>
  <div class="row"><span>الوحدة</span><b>${esc((p as any).unit_label || d.owner.unit || "—")}</b></div>
  <div class="row"><span>المبلغ</span><b style="font-size:18px">${money(p.amount)} ريال سعودي</b></div>
  <div class="row"><span>المبلغ كتابةً</span><b style="text-align:left;font-weight:600;overflow-wrap:anywhere">${esc(amountInWordsAr(p.amount))}</b></div>
  <div class="row"><span>طريقة الدفع</span><b>${methodAr(p.method)}</b></div>
  ${p.reference ? `<div class="row"><span>المرجع</span><b dir="ltr">${esc(p.reference)}</b></div>` : ""}
  <div class="row"><span>البيان</span><b>اشتراك اتحاد الملاك${p.periods_covered && p.periods_covered > 0 ? ` — ${periodsAr(p.periods_covered, per)}` : ""}</b></div>
  ${balTxt ? `<div class="row"><span>الرصيد بعد هذه الدفعة</span><b>${balTxt}</b></div>` : ""}
  <div class="row"><span>المستلِم</span><b style="text-align:left;overflow-wrap:anywhere">${receiver}</b></div>
  <div class="note">سند إلكتروني مستخرج من سجل دفعات الجمعية. الأرقام كما سجّلتها إدارة الجمعية.</div>
</section>
<div class="noprint" style="margin-top:14px;display:flex;gap:10px"><button class="btn b-deep" id="pr" type="button">طباعة / حفظ PDF</button></div>`;
  return frame(`${reversed ? "سند معكوس" : "سند قبض"} ${(p as any).receipt_no || receiptNo(p.id)}`, "", body, opts.nonce,
    `document.getElementById('pr').addEventListener('click',function(){window.print();});`);
}

// ─── شفافية العمارة (أرقام مجمَّعة فقط) ───────────────────────────
const BCSS = `.kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.kpi{border:1px solid #E4DDCD;border-radius:12px;padding:10px 12px;background:#FBF8F1;min-width:0}
.kpi b{display:block;font-size:18px;overflow-wrap:anywhere}.kpi span{font-size:12px;color:#5C6B67}
.bar{height:8px;border-radius:99px;background:#EEE8DA;overflow:hidden;margin-top:6px}.bar i{display:block;height:100%;background:#137A50}
.cat{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:center;padding:7px 0;border-top:1px solid #F0EBDF;font-size:13.5px}
.cat:first-of-type{border-top:0}.cat .bar{grid-column:1 / -1;margin-top:0;height:6px}.cat .bar i{background:#9A6314}
.ex{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:9px 0;border-top:1px solid #F0EBDF;font-size:13.5px}
.ex:first-of-type{border-top:0}.ex .d{overflow-wrap:anywhere}`;

/** أرقام العمارة للمالك وللصفحة العامة — لا اسم مالك ولا وحدة ولا من تأخر */
export function buildingSection(b: BuildingData, opts: { heading?: string } = {}): string {
  const per = b.fee_period === "annual" ? "annual" : "monthly";
  const monthName = gDate(b.month_start).replace(/^\d+\s/, "");
  const yearLabel = b.year_start && b.year_start.slice(5) !== "01-01"
    ? `السنة المالية (من ${gDate(b.year_start)})` : `عام ${esc(String(b.year_start || b.today).slice(0, 4))}`;
  const cats = (b.by_category || []).filter((c) => Number(c.total) > 0);
  const maxCat = Math.max(1, ...cats.map((c) => Number(c.total) || 0));
  const pct = b.collection_pct == null ? null : Math.max(0, Math.min(100, Number(b.collection_pct)));
  return `
<style>${BCSS}</style>
<section class="card"><h2>${esc(opts.heading || "صندوق العمارة")}</h2>
  <div class="muted">أرقام مجمَّعة لكل العمارة — لا تُعرض أسماء الملاك ولا حالة أي وحدة.</div>
  <div style="margin-top:10px"><div class="muted">رصيد الصندوق الآن</div>
    <div><span class="big" style="${Number(b.fund_balance) < 0 ? "color:#A5322C" : ""}">${money(b.fund_balance)}</span><span class="cur">ريال</span></div></div>
  <div class="kpis" style="margin-top:10px">
    <div class="kpi"><span>المحصَّل في ${esc(monthName)}</span><b>${money(b.month_collected)}</b></div>
    <div class="kpi"><span>المصروف في ${esc(monthName)}</span><b>${money(b.month_expenses)}</b></div>
    <div class="kpi"><span>المحصَّل — ${yearLabel}</span><b>${money(b.year_collected)}</b></div>
    <div class="kpi"><span>المصروف — ${yearLabel}</span><b>${money(b.year_expenses)}</b></div>
  </div>
  ${pct != null ? `<div class="row" style="margin-top:8px"><span>نسبة الوحدات المسدِّدة</span><b>${pct}٪ <span class="muted">(${Number(b.owners_paid) || 0} من ${Number(b.owners_total) || 0})</span></b></div>
  <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>` : ""}
  <div class="row"><span>عدد الوحدات</span><b>${Number(b.units) || Number(b.owners_total) || "—"}</b></div>
  ${b.fee != null && Number(b.fee) > 0 ? `<div class="row"><span>${PERIOD_WORDS[per].label} للوحدة</span><b>${money(b.fee)} ريال</b></div>`
    : b.fee_basis === "share" ? `<div class="row"><span>${PERIOD_WORDS[per].label}</span><b>حسب حصة كل وحدة</b></div>` : ""}
</section>
<section class="card"><h2>المصروفات حسب البند — ${yearLabel}</h2>
  ${cats.length ? cats.map((c) => `<div class="cat"><span>${esc(expenseCatAr(c.category))}</span><b>${money(c.total)} ريال</b>
    <div class="bar" aria-hidden="true"><i style="width:${Math.round(((Number(c.total) || 0) / maxCat) * 100)}%"></i></div></div>`).join("")
    : `<div class="muted">لا مصروفات مسجَّلة في هذه الفترة.</div>`}
</section>
<section class="card"><h2>آخر المصروفات</h2>
  ${(b.recent || []).length ? b.recent.map((x) => `<div class="ex"><div class="d"><b>${esc(x.description)}</b>
    <div class="muted">${esc(expenseCatAr(x.category))} · ${gDate(x.spent_on)}</div></div><b>${money(x.amount)} ريال</b></div>`).join("")
    : `<div class="muted">لا مصروفات بعد.</div>`}
</section>`;
}

/** الصفحة العامة /b/<رمز> */
export function renderBuildingPage(b: BuildingData, opts: { nonce: string }): string {
  const body = buildingSection(b, { heading: "صندوق العمارة" }) + `
<div class="foot">صفحة شفافية لملاك وسكان ${esc(b.name)} — تُحدَّث تلقائيًّا من سجل الجمعية.<br>بتاريخ ${gDate(b.today)}${hDate(b.today) ? ` (${esc(hDate(b.today))})` : ""} · عبر منصة وثيق</div>`;
  return frame(`${b.name} — شفافية العمارة`, topBar(b.office?.org_name, b.name, "أرقام مجمَّعة بلا أسماء", "شفافية العمارة"), body, opts.nonce);
}

// ─── سند الصرف ──────────────────────────────────────────────────
export type VoucherRow = {
  voucher_no: string | null; spent_on: string; amount: number; category: string; description: string;
  vendor?: string | null; reference?: string | null; overdraft?: boolean | null;
};
export function renderVoucherPage(v: { association: { name: string }; office?: { org_name: string | null } | null; expense: VoucherRow },
  opts: { nonce: string }): string {
  const e = v.expense;
  const hij = hDate(e.spent_on);
  const org = v.office?.org_name;
  const body = `
<section class="card" style="padding:20px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;border-bottom:2px solid #0E3A37;padding-bottom:10px">
    <div style="min-width:0"><div style="font-size:20px;font-weight:700;color:#0E3A37">سند صرف</div>
      <div class="muted">${esc(v.association.name)}${org ? ` · ${esc(org)}` : ""}</div></div>
    <div style="text-align:left"><div class="muted">رقم السند</div><b dir="ltr" style="font-family:monospace">${esc(e.voucher_no || "—")}</b></div>
  </div>
  <div class="row"><span>التاريخ</span><b>${gDate(e.spent_on)}${hij ? `<br><span class="muted">${esc(hij)}</span>` : ""}</b></div>
  <div class="row"><span>صُرف لـ</span><b style="overflow-wrap:anywhere">${esc(e.vendor || "—")}</b></div>
  <div class="row"><span>البند</span><b>${esc(expenseCatAr(e.category))}</b></div>
  <div class="row"><span>البيان</span><b style="overflow-wrap:anywhere;text-align:left">${esc(e.description)}</b></div>
  <div class="row"><span>المبلغ</span><b style="font-size:18px">${money(e.amount)} ريال سعودي</b></div>
  ${e.reference ? `<div class="row"><span>المرجع / الفاتورة</span><b dir="ltr">${esc(e.reference)}</b></div>` : ""}
  ${e.overdraft ? `<div class="note">سُجّل والصندوق لا يكفي — دفعه مدير العقار مقدّمًا ويُستردّ من الصندوق.</div>` : ""}
  <div class="two" style="margin-top:22px;font-size:13px;color:#5C6B67">
    <div>المستلم: ____________<br><br>التوقيع: ____________</div>
    <div>مدير العقار: ____________<br><br>التوقيع: ____________</div>
  </div>
  <div class="note">سند صرف مستخرج من سجل مصروفات الجمعية. التصحيح يكون بعكس السند لا بتعديله.</div>
</section>
<div class="noprint" style="margin-top:14px;display:flex;gap:10px"><button class="btn b-deep" id="pr" type="button">طباعة / حفظ PDF</button></div>`;
  return frame(`سند صرف ${e.voucher_no || ""}`, "", body, opts.nonce,
    `document.getElementById('pr').addEventListener('click',function(){window.print();});`);
}

// ─── الرفض الودّي (مجهول ومُبطَل بالرد نفسه) ─────────────────────
export function renderDeny(msg = "هذا الرابط غير متاح"): string {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>وثيق</title></head>
<body style="margin:0;font-family:Tahoma,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;background:#F4F1EA;color:#0B211F">
<div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:2rem">🔒</div>
<h1 style="font-size:1.1rem">${esc(msg)}</h1>
<p style="font-size:.9rem;color:#5C6B67">قد يكون الرابط قديمًا أو أُلغي. اطلب من إدارة الجمعية رابطًا جديدًا عبر واتساب.</p></div></body></html>`;
}
export const denyHeaders: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store",
};

export const TOKEN_RE = /^[0-9a-f]{64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FLASH_CODES = new Set(Object.keys(FLASH));
