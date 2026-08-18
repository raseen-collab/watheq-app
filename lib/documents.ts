import { contractState, buildSchedule, freqLabel, splitVat, settleDeposit, vacancyDays, isVacant } from "./contracts";
import { complianceState, brokerageEnd, expectedCommission, UI_LEGAL, LEGAL_DISCLAIMER, DEFAULT_COMMISSION_PCT, type ComplianceItem } from "./compliance";
import { KIND_META as L_KIND, OFFER_LABEL, STATUS_META, freshness, pricePerMeter, shortDesc, sortListings, summarize, STALE_DAYS, type Listing } from "./listings";
import { unitLabel, typeLabel } from "./domain";

const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو",
                   "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

/**
 * 5 مارس 2026 — ميلادي بأسماء عربية.
 * لا يُستعمل Intl مع "ar-SA" لأنه يُخرج التاريخ **هجريًّا** على كثير من
 * الأجهزة، فيقرأ المستأجر تاريخًا لا يطابق عقده.
 */
export function arDate(v?: string | null): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return String(v);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return String(v);
  return `${Number(m[3])} ${MONTHS_AR[mo]} ${m[1]}`;
}

const today = () => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

type Tenant = {
  id: string; name: string; unit: string | null; phone: string | null; national_id: string | null;
  rent_amount: number; contract_start: string | null; contract_end: string | null;
  payment_frequency: string | null; paid_periods: number | null; contract_periods: number | null;
  partial_amount?: number | null;
};
type Property = {
  name: string; address: string | null; city: string | null; manager: string | null; property_type: string | null;
  grace_days?: number | null;
  vat_enabled?: boolean | null; vat_rate?: number | null; vat_inclusive?: boolean | null;
};
export type PaymentRow = {
  id?: string; paid_on: string; amount: number;
  method?: string | null; periods_covered?: number | null; note?: string | null;
};
const METHOD_AR: Record<string, string> = {
  transfer: "تحويل بنكي", cash: "نقدًا", pos: "شبكة", cheque: "شيك", other: "أخرى",
};
const methodAr = (m?: string | null) => METHOD_AR[String(m || "")] || "—";

type Issuer = { billing_name?: string | null; vat_number?: string | null; cr_number?: string | null; billing_phone?: string | null;
  /** true لأي حساب بلا باقة مدفوعة — يُضاف سطر «أُنشئ عبر وثيق» في التذييل فقط.
   *  المستند صالح للاستعمال كاملًا، بلا علامة مائية ولا تقييد. */
  trial?: boolean | null;
  /** true إذا انتهت التجربة ولم يشترك — هنا فقط تعود العلامة المائية. */
  expired?: boolean | null };

/** ثلاث حالات: مشترك = نظيف · تجربة نشطة = سطر المصدر · انتهت بلا اشتراك = علامة مائية */
type Mark = "none" | "brand" | "wm";
const markOf = (i?: Issuer | null): Mark => (i?.expired ? "wm" : i?.trial ? "brand" : "none");

const SHELL = (title: string, inner: string, mark: Mark = "none") => `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<title>${title}</title>
<style>
  @page{size:A4;margin:14mm}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{max-width:100%;overflow-x:hidden}
  /* هوامش الجسم: بدونها يلتصق المحتوى بحافة النافذة ويُقصّ أول سطر في RTL */
  body{font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif;color:#0B211F;line-height:1.7;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;word-wrap:break-word;
      padding:16px;max-width:900px;margin:0 auto}
  @media print{body{padding:0;max-width:none;margin:0}}
  *{box-sizing:border-box}
  .hd{background:#0E3A37;color:#EAF1EE;padding:18px 22px;border-radius:12px;display:table;width:100%;box-sizing:border-box}
  .hd .lg{display:table-cell;vertical-align:middle;text-align:right;white-space:nowrap}
  .hd .lg .seal{display:inline-block;vertical-align:middle;margin-inline-end:11px}
  .hd .lg>div:last-child{display:inline-block;vertical-align:middle}
  .seal{width:40px;height:40px;border-radius:10px;background:#0A2C2A;text-align:center;line-height:40px;color:#E7C877;font-weight:700;font-size:1.3rem;box-shadow:inset 0 0 0 2px rgba(231,200,119,.4)}
  .hd .t{font-weight:700;font-size:1.4rem}
  .hd .s{font-size:.75rem;color:#9FB8B3}
  .hd .meta{display:table-cell;vertical-align:middle;text-align:left;font-size:.8rem;color:#B9CCC7;white-space:nowrap}
  .hd .meta b{color:#E7C877;display:block;font-size:1rem}
  h1{font-size:1.25rem;margin:22px 0 4px;color:#0E3A37}
  h2{font-size:.95rem;margin:20px 0 8px;color:#0E3A37;font-weight:700;
      border-bottom:1px solid #E4DDCD;padding-bottom:5px}
  .sub{color:#5C6B67;font-size:.85rem;margin-bottom:16px}
  /* الهوامش السالبة كانت تدفع العنصر خارج النافذة، وoverflow-x:hidden يقصّه بلا تمرير */
  .grid{display:table;width:100%;border-collapse:separate;border-spacing:7px 0;margin:0 0 18px;table-layout:fixed}
  .box{display:table-cell;width:50%;vertical-align:top;border:1px solid #E4DDCD;border-radius:10px;padding:12px 14px;background:#FBF8F1}
  .box h3{font-size:.78rem;color:#8a5a11;margin-bottom:7px;font-weight:700}
  .box .r{display:table;width:100%;font-size:.84rem;padding:3px 0}
  .box .r span{display:table-cell}
  .box .r span:first-child{color:#5C6B67;text-align:right}
  .box .r span:last-child{font-weight:600;text-align:left;white-space:nowrap;padding-inline-start:10px}
  table{width:100%;border-collapse:collapse;font-size:.83rem;margin-bottom:16px}
  /* جدول أعرض من الشاشة يُمرَّر بدل أن يُقصّ */
  .scrollx{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:16px}
  .scrollx table{margin-bottom:0;min-width:520px}
  @media print{.scrollx{overflow:visible}.scrollx table{min-width:0}}
  th{background:#F3EEE2;padding:8px 10px;text-align:right;font-weight:700;border-bottom:2px solid #E4DDCD;font-size:.78rem}
  td{padding:8px 10px;border-bottom:1px solid #EFE9DA}
  tr:last-child td{border-bottom:0}
  .pill{font-size:.72rem;font-weight:700;padding:3px 9px;border-radius:6px;display:inline-block}
  .pill.p{background:#E6F4EC;color:#137a50}
  .pill.l{background:#FBE9E7;color:#a5322c}
  .pill.u{background:#F3EEE2;color:#5C6B67}
  .tot{display:table;width:100%;border-collapse:separate;border-spacing:5px 0;margin:0 0 18px;table-layout:fixed}
  .tot>div{display:table-cell;vertical-align:top;border:1px solid #E4DDCD;border-radius:10px;padding:11px;text-align:center;background:#FBF8F1}
  .tot .v{font-weight:700;font-size:1.15rem;color:#0E3A37}
  .tot .v.g{color:#1E9E6A}.tot .v.r{color:#D0453F}
  .tot .l{font-size:.7rem;color:#5C6B67;margin-top:3px}
  .due{background:#0E3A37;color:#EAF1EE;border-radius:12px;padding:16px 20px;display:table;width:100%;box-sizing:border-box;margin-bottom:18px}
  .due .l{display:table-cell;vertical-align:middle;text-align:right;font-size:.85rem;color:#B9CCC7}
  .due .v{display:table-cell;vertical-align:middle;text-align:left;font-weight:700;font-size:1.7rem;color:#E7C877;white-space:nowrap;padding-inline-start:14px}
  .note{border-inline-start:3px solid #B8791F;background:#FBF1DF;padding:11px 14px;border-radius:8px;font-size:.78rem;color:#8a5a11;margin-bottom:14px}
  .sign{display:table;width:100%;border-collapse:separate;border-spacing:15px 0;margin:26px 0 0;font-size:.82rem;table-layout:fixed}
  .sign>div{display:table-cell;width:50%;vertical-align:top;border-top:1px solid #E4DDCD;padding-top:8px;color:#5C6B67}
  .ft{margin-top:22px;border-top:1px solid #E4DDCD;padding-top:12px;font-size:.68rem;color:#5C6B67;line-height:1.6;text-align:center}
  .noprint{margin:18px 0;text-align:center}
  .noprint button{margin:0 4px}
  .noprint button{font-family:inherit;font-weight:600;font-size:.9rem;padding:10px 20px;border-radius:9px;border:0;cursor:pointer}
  .noprint .a{background:#0E3A37;color:#F6F1E4}
  .noprint .b{background:#fff;color:#0E3A37;border:1px solid #E4DDCD}
  @media print{.noprint{display:none}}
  /* ── سطر المصدر: تجربة نشطة ── */
  .madeby{margin:18px 0 0;padding-top:9px;border-top:1px solid #E4DDCD;
      font-size:.72rem;color:#8C8579;text-align:center;letter-spacing:.2px}
  .madeby b{font-weight:700;color:#6E675C}
  /* ── علامة مائية: انتهت التجربة بلا اشتراك ── */
  .wm{position:fixed;top:0;right:0;bottom:0;left:0;z-index:9999;pointer-events:none;
      display:flex;align-items:center;justify-content:center}
  .wm span{transform:rotate(-32deg);font-size:3.6rem;font-weight:800;letter-spacing:2px;
      color:rgba(208,69,63,.14);border:6px solid rgba(208,69,63,.14);
      padding:16px 46px;border-radius:18px;white-space:nowrap}
  .trialbar{background:#FBE9E7;border:1px solid #F5C6C2;color:#8f2b26;border-radius:10px;
      padding:11px 15px;margin:14px 0 0;font-size:.82rem;font-weight:600;line-height:1.75}
</style></head><body>
<div class="noprint"><button class="a" onclick="window.print()">🖨️ طباعة / حفظ PDF</button><button class="b" onclick="window.close()">إغلاق</button></div>
${mark === "wm" ? `<div class="wm"><span>نسخة تجريبية — غير معتمدة</span></div>` : ""}
${inner}
${mark === "brand" ? `<div class="madeby">أُنشئ عبر <b>وثيق</b> · watheqapp.netlify.app</div>` : ""}
${mark === "wm" ? `<div class="trialbar">
  انتهت فترة التجربة المجانية ولم يُفعَّل اشتراك، لذا تخرج المستندات بعلامة «نسخة تجريبية».
  لإصدار نسخة نهائية بلا علامة: فعّل اشتراكك عبر watheqdocs@gmail.com
</div>` : ""}
</body></html>`;

/** إعدادات الضريبة الخاصة بالعقار */
const vatOf = (p: Property) => ({
  enabled: !!p.vat_enabled, rate: Number(p.vat_rate) || 15, inclusive: p.vat_inclusive !== false,
});
/** فترة السماح الخاصة بالعقار */
const graceOf = (p: Property) => ({ graceDays: Number(p.grace_days) || 0 });

const header = (docTitle: string, docNo: string) => `
<div class="hd">
  <div class="lg"><div class="seal">و</div><div><div class="t">وثيق</div><div class="s">إدارة الأملاك العقارية</div></div></div>
  <div class="meta">${docTitle}<b>${docNo}</b>التاريخ: ${arDate(today())}</div>
</div>`;

const footer = () => `
<div class="ft">
  صدر هذا المستند عبر منصة وثيق — أداة تنظيمية لإدارة الأملاك.<br>
  وثيق لا يقدّم خدمات قانونية أو محاسبية، ولا يستلم أو يحوّل أي مبالغ. هذا المستند للاستخدام الإداري بين الطرفين، ومسؤولية اعتماده على مُصدِره.<br>
  <b>وثيقة عمل حر رقم FL-763162251</b> — وزارة الموارد البشرية والتنمية الاجتماعية<br>
  watheqdocs@gmail.com · تليجرام: ‎+966550165210
</div>`;

/** كشف حساب مستأجر — كامل الدفعات والأرصدة */
export function statementHTML(t: Tenant, p: Property, issuer: Issuer = {}, payments: PaymentRow[] = []) {
  const st = contractState(t, graceOf(p));
  const rows = buildSchedule(t);
  const ul = unitLabel(p.property_type);
  const who = issuer.billing_name || p.manager || "إدارة الأملاك";
  const v = vatOf(p);
  const unit = splitVat(Number(t.rent_amount) || 0, v);      // تفصيل الدفعة الواحدة
  const totalContract = unit.total * rows.length;
  const totalPaid = st.paid * unit.total;
  const dueSplit = splitVat(st.amountDue, v);                 // تفصيل الرصيد المستحق

  const body = `
${header("كشف حساب", `${t.name}`)}
<h1>كشف حساب ${ul} رقم (${t.unit || "—"})</h1>
<div class="sub">${p.name}${p.address ? ` — ${p.address}` : ""}${p.city ? `، ${p.city}` : ""} · ${typeLabel(p.property_type)}</div>

<div class="grid">
  <div class="box">
    <h3>بيانات المؤجّر</h3>
    <div class="r"><span>الاسم</span><span>${who}</span></div>
    ${issuer.cr_number ? `<div class="r"><span>السجل التجاري</span><span>${issuer.cr_number}</span></div>` : ""}
    ${issuer.vat_number ? `<div class="r"><span>الرقم الضريبي</span><span>${issuer.vat_number}</span></div>` : ""}
    ${issuer.billing_phone ? `<div class="r"><span>للتواصل</span><span>${issuer.billing_phone}</span></div>` : ""}
  </div>
  <div class="box">
    <h3>بيانات المستأجر</h3>
    <div class="r"><span>الاسم</span><span>${t.name}</span></div>
    ${t.national_id ? `<div class="r"><span>الهوية / السجل</span><span>${t.national_id}</span></div>` : ""}
    ${t.phone ? `<div class="r"><span>الجوال</span><span>${t.phone}</span></div>` : ""}
    <div class="r"><span>${ul}</span><span>${t.unit || "—"}</span></div>
  </div>
</div>

<div class="grid">
  <div class="box">
    <h3>بيانات العقد</h3>
    <div class="r"><span>بداية العقد</span><span>${arDate(t.contract_start)}</span></div>
    <div class="r"><span>نهاية العقد</span><span>${arDate(st.endDate)}</span></div>
    <div class="r"><span>دورة السداد</span><span>${freqLabel(t.payment_frequency)}</span></div>
    <div class="r"><span>قيمة الدفعة${v.enabled ? " (شاملة الضريبة)" : ""}</span><span>${sar(unit.total)} ريال</span></div>
    ${v.enabled ? `<div class="r"><span>منها إيجار أساسي</span><span>${sar(unit.base)} ريال</span></div>
    <div class="r"><span>ضريبة القيمة المضافة (${v.rate}%)</span><span>${sar(unit.vat)} ريال</span></div>` : ""}
  </div>
  <div class="box">
    <h3>ملخّص مالي</h3>
    <div class="r"><span>إجمالي قيمة العقد</span><span>${sar(totalContract)} ريال</span></div>
    <div class="r"><span>المسدَّد</span><span>${sar(totalPaid)} ريال</span></div>
    <div class="r"><span>المتأخر</span><span>${sar(st.amountDue)} ريال</span></div>
    ${v.enabled && st.amountDue > 0 ? `<div class="r"><span>منه ضريبة</span><span>${sar(dueSplit.vat)} ريال</span></div>` : ""}
    ${st.hasPartial ? `<div class="r"><span>مدفوع جزئيًّا</span><span>${sar(st.partial)} ريال</span></div>` : ""}
    <div class="r"><span>الدفعة القادمة</span><span>${arDate(st.nextDueDate)}</span></div>
  </div>
</div>

<div class="tot">
  <div><div class="v">${rows.length}</div><div class="l">إجمالي الدفعات</div></div>
  <div><div class="v g">${st.paid}</div><div class="l">مسدّدة</div></div>
  <div><div class="v r">${st.unpaid}</div><div class="l">متأخرة</div></div>
  <div><div class="v">${Math.max(0, rows.length - st.due)}</div><div class="l">قادمة</div></div>
</div>

${st.amountDue > 0 ? `<div class="due"><span class="l">الرصيد المستحق حتى تاريخه</span><span class="v">${sar(st.amountDue)} ريال</span></div>` : ""}

<h1 style="font-size:1rem">تفصيل الدفعات</h1>
<table>
  <thead><tr><th>#</th><th>تاريخ الاستحقاق</th>${v.enabled ? "<th>الأساس</th><th>الضريبة</th>" : ""}<th>الإجمالي (ريال)</th><th>الحالة</th></tr></thead>
  <tbody>
    ${rows.map((r) => { const x = splitVat(r.amount, v); return `<tr>
      <td>${r.n}</td><td>${arDate(r.date)}</td>
      ${v.enabled ? `<td>${sar(x.base)}</td><td>${sar(x.vat)}</td>` : ""}
      <td>${sar(x.total)}</td>
      <td>${r.status === "paid" ? '<span class="pill p">مسدّدة</span>'
          : r.status === "partial" ? '<span class="pill u">سداد جزئي</span>'
          : r.status === "late" ? '<span class="pill l">متأخرة</span>'
          : '<span class="pill u">قادمة</span>'}</td>
    </tr>`; }).join("")}
  </tbody>
</table>

${payments.length ? `
<h1 style="font-size:1rem">المدفوعات المستلمة</h1>
<table>
  <thead><tr><th>#</th><th>تاريخ الاستلام</th><th>المبلغ (ريال)</th><th>طريقة السداد</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${payments.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td>${r.paid_on || "—"}</td>
      <td>${sar(r.amount)}</td>
      <td>${methodAr(r.method)}</td>
      <td>${r.note ? String(r.note).replace(/</g, "&lt;") : "—"}</td>
    </tr>`).join("")}
    <tr style="background:#F3EEE2;font-weight:700">
      <td colspan="2">إجمالي المستلم</td>
      <td>${sar(payments.reduce((a, r) => a + (Number(r.amount) || 0), 0))}</td>
      <td colspan="2">${payments.length} عملية</td>
    </tr>
  </tbody>
</table>
<div class="note" style="border-inline-start-color:#1E9E6A;background:#E6F4EC;color:#137a50">
  هذا الجدول مستخرج من سجل المدفوعات الموثّق في المنصة بتواريخه وطرق سداده، ويصلح للمطابقة مع سجلاتكم.
</div>` : `
<div class="note">لا توجد مدفوعات موثّقة في سجل المنصة لهذا العقد حتى تاريخه. الأرصدة أعلاه مستنتجة من دورة العقد وعدد الدفعات المسجّلة.</div>`}

<div class="note">كشف استرشادي صادر آليًّا من بيانات العقد المسجّلة. يُرجى مطابقته مع سجلاتكم، وإشعارنا بأي فرق.</div>

<div class="sign">
  <div>المؤجّر / الوكيل: ${who}<br><br>التوقيع: ________________</div>
  <div>المستأجر: ${t.name}<br><br>التوقيع: ________________</div>
</div>
${footer()}`;
  return SHELL(`كشف حساب — ${t.name}`, body, markOf(issuer));
}

/** فاتورة دفعة واحدة */
export function invoiceHTML(
  t: Tenant, p: Property,
  inv: { invoice_no: string; amount: number; due_date: string; period_label: string },
  issuer: Issuer = {}
) {
  const ul = unitLabel(p.property_type);
  const who = issuer.billing_name || p.manager || "إدارة الأملاك";
  const v = vatOf(p);
  const x = splitVat(Number(inv.amount) || 0, v);
  const body = `
${header(v.enabled ? "فاتورة ضريبية" : "فاتورة", inv.invoice_no)}
<h1>${v.enabled ? "فاتورة ضريبية — أجرة" : "فاتورة أجرة"}</h1>
<div class="sub">${inv.period_label} · ${freqLabel(t.payment_frequency)}</div>

<div class="grid">
  <div class="box">
    <h3>المُصدِر</h3>
    <div class="r"><span>الاسم</span><span>${who}</span></div>
    ${issuer.cr_number ? `<div class="r"><span>السجل التجاري</span><span>${issuer.cr_number}</span></div>` : ""}
    ${issuer.vat_number ? `<div class="r"><span>الرقم الضريبي</span><span>${issuer.vat_number}</span></div>` : ""}
    ${issuer.billing_phone ? `<div class="r"><span>للتواصل</span><span>${issuer.billing_phone}</span></div>` : ""}
  </div>
  <div class="box">
    <h3>إلى</h3>
    <div class="r"><span>الاسم</span><span>${t.name}</span></div>
    ${t.national_id ? `<div class="r"><span>الهوية / السجل</span><span>${t.national_id}</span></div>` : ""}
    <div class="r"><span>${ul}</span><span>${t.unit || "—"}</span></div>
    <div class="r"><span>العقار</span><span>${p.name}</span></div>
  </div>
</div>

<table>
  <thead><tr><th>البيان</th><th>الفترة</th><th>تاريخ الاستحقاق</th><th>المبلغ قبل الضريبة (ريال)</th></tr></thead>
  <tbody>
    <tr>
      <td>أجرة ${ul} رقم (${t.unit || "—"}) بعقار ${p.name}</td>
      <td>${inv.period_label}</td>
      <td>${inv.due_date}</td>
      <td>${sar(x.base)}</td>
    </tr>
  </tbody>
</table>

${v.enabled ? `<table style="max-width:340px;margin-inline-start:auto">
  <tbody>
    <tr><td>الإجمالي قبل الضريبة</td><td style="text-align:left;font-weight:600">${sar(x.base)}</td></tr>
    <tr><td>ضريبة القيمة المضافة (${v.rate}%)</td><td style="text-align:left;font-weight:600">${sar(x.vat)}</td></tr>
    <tr><td style="font-weight:700">الإجمالي شامل الضريبة</td><td style="text-align:left;font-weight:700">${sar(x.total)}</td></tr>
  </tbody>
</table>` : ""}

<div class="due"><span class="l">الإجمالي المستحق${v.enabled ? " (شامل الضريبة)" : ""}</span><span class="v">${sar(x.total)} ريال</span></div>

${v.enabled && !issuer.vat_number ? `<div class="note" style="border-inline-start-color:#D0453F;background:#FBE9E7;color:#a5322c">
  <b>تنبيه:</b> الضريبة مفعّلة لكن الرقم الضريبي للمُصدِر غير مسجَّل. أضِفه في إعدادات الحساب قبل اعتماد الفاتورة رسميًّا.
</div>` : ""}

<div class="note">
  فاتورة إدارية صادرة عن المؤجّر لغرض التوثيق بين الطرفين. السداد يتم مباشرةً للمؤجّر بالوسيلة المتفق عليها —
  منصة وثيق لا تستلم ولا تحوّل أي مبالغ.
</div>
${v.enabled ? `<div class="note" style="border-inline-start-color:#D0453F;background:#FBE9E7;color:#a5322c">
  <b>تنويه مهم:</b> هذا مستند إداري يبيّن احتساب الضريبة، وليس فاتورة إلكترونية معتمدة من هيئة الزكاة والضريبة والدخل
  (لا يتضمّن رمز الاستجابة السريعة ولا التوقيع الإلكتروني المطلوبين في نظام الفاتورة الإلكترونية).
  للاعتماد الضريبي الرسمي، أصدرها من حلّ فوترة معتمد أو راجع محاسبك.
</div>` : ""}

<div class="sign">
  <div>المُصدِر: ${who}<br><br>التوقيع: ________________</div>
  <div>تاريخ الإصدار: ${today()}<br><br>رقم الفاتورة: ${inv.invoice_no}</div>
</div>
${footer()}`;
  return SHELL(`فاتورة ${inv.invoice_no} — ${t.name}`, body, markOf(issuer));
}

/* ═══════════════════ عرض سعر تأجير وحدة ═══════════════════ */

export type ChargeRow = { label: string; who: "owner" | "tenant" };

export const DEFAULT_CHARGES: ChargeRow[] = [
  { label: "استهلاك الكهرباء", who: "tenant" },
  { label: "استهلاك المياه", who: "tenant" },
  { label: "الإنترنت والاتصالات", who: "tenant" },
  { label: "النظافة الداخلية للوحدة", who: "tenant" },
  { label: "الصيانة الإنشائية والتمديدات الأساسية", who: "owner" },
  { label: "صيانة المصعد والأجزاء المشتركة", who: "owner" },
  { label: "رسوم جمعية الملاك / الخدمات المشتركة", who: "owner" },
];

export type QuoteInput = {
  quote_no: string;
  tenant_name: string;
  unit: string;
  rent_amount: number;        // إيجار الدفعة الواحدة
  payment_frequency: string;
  contract_periods: number;
  start_date: string;
  deposit: number;
  valid_until: string;
  charges: ChargeRow[];
  notes?: string | null;
};

/** عرض سعر تأجير — يُرسل لمستأجر محتمل قبل التعاقد */
export function quotationHTML(p: Property, q: QuoteInput, issuer: Issuer = {}) {
  const ul = unitLabel(p.property_type);
  const who = issuer.billing_name || p.manager || "إدارة الأملاك";
  const v = vatOf(p);
  const periods = Math.max(1, Number(q.contract_periods) || 1);
  const perPeriod = Number(q.rent_amount) || 0;
  const gross = perPeriod * periods;
  const x = splitVat(gross, v);
  const xp = splitVat(perPeriod, v);
  const rows = buildSchedule({
    contract_start: q.start_date, payment_frequency: q.payment_frequency,
    rent_amount: perPeriod, contract_periods: periods, paid_periods: 0,
  });
  const tenantRows = q.charges.filter((c) => c.who === "tenant");
  const ownerRows = q.charges.filter((c) => c.who === "owner");

  const body = `
${header("عرض سعر", q.quote_no)}
<h1>عرض سعر تأجير ${ul}</h1>
<div class="sub">${p.name}${p.city ? ` · ${p.city}` : ""} · ${ul} رقم ${q.unit || "—"}</div>

<div class="grid">
  <div class="box">
    <h3>المُصدِر</h3>
    <div class="r"><span>الاسم</span><span>${who}</span></div>
    ${issuer.cr_number ? `<div class="r"><span>السجل التجاري</span><span>${issuer.cr_number}</span></div>` : ""}
    ${issuer.vat_number ? `<div class="r"><span>الرقم الضريبي</span><span>${issuer.vat_number}</span></div>` : ""}
    ${issuer.billing_phone ? `<div class="r"><span>للتواصل</span><span>${issuer.billing_phone}</span></div>` : ""}
    ${p.address ? `<div class="r"><span>العنوان</span><span>${p.address}</span></div>` : ""}
  </div>
  <div class="box">
    <h3>العرض مُقدَّم إلى</h3>
    <div class="r"><span>الاسم</span><span>${q.tenant_name || "—"}</span></div>
    <div class="r"><span>${ul}</span><span>${q.unit || "—"}</span></div>
    <div class="r"><span>تاريخ الإصدار</span><span>${today()}</span></div>
    <div class="r"><span>صالح حتى</span><span>${q.valid_until || "—"}</span></div>
  </div>
</div>

<h2>شروط العرض</h2>
<table>
  <tbody>
    <tr><td>إيجار الدفعة الواحدة${v.enabled ? " (قبل الضريبة)" : ""}</td><td style="text-align:left;font-weight:600">${sar(xp.base)} ريال</td></tr>
    <tr><td>دورية السداد</td><td style="text-align:left;font-weight:600">${freqLabel(q.payment_frequency)}</td></tr>
    <tr><td>عدد الدفعات</td><td style="text-align:left;font-weight:600">${periods}</td></tr>
    <tr><td>تاريخ بداية العقد المقترح</td><td style="text-align:left;font-weight:600">${q.start_date || "—"}</td></tr>
    <tr><td>مبلغ التأمين المسترد</td><td style="text-align:left;font-weight:600">${sar(q.deposit)} ريال</td></tr>
  </tbody>
</table>

<h2>إجمالي قيمة العقد</h2>
<table style="max-width:380px;margin-inline-start:auto">
  <tbody>
    <tr><td>الإجمالي قبل الضريبة</td><td style="text-align:left;font-weight:600">${sar(x.base)}</td></tr>
    ${v.enabled ? `<tr><td>ضريبة القيمة المضافة (${v.rate}%)</td><td style="text-align:left;font-weight:600">${sar(x.vat)}</td></tr>` : ""}
    <tr><td style="font-weight:700">الإجمالي${v.enabled ? " شامل الضريبة" : ""}</td><td style="text-align:left;font-weight:700">${sar(x.total)}</td></tr>
    <tr><td>التأمين المسترد</td><td style="text-align:left;font-weight:600">${sar(q.deposit)}</td></tr>
    <tr><td style="font-weight:700">المطلوب عند التعاقد (الدفعة الأولى + التأمين)</td><td style="text-align:left;font-weight:700">${sar(xp.total + (Number(q.deposit) || 0))}</td></tr>
  </tbody>
</table>

<h2>جدول الدفعات المقترح</h2>
<table>
  <thead><tr><th>#</th><th>تاريخ الاستحقاق</th><th>المبلغ${v.enabled ? " (شامل الضريبة)" : ""} (ريال)</th></tr></thead>
  <tbody>
    ${rows.map((r) => `<tr><td>${r.n}</td><td>${arDate(r.date)}</td><td>${sar(splitVat(r.amount, v).total)}</td></tr>`).join("")}
  </tbody>
</table>

<h2>من يتحمّل ماذا</h2>
<div class="grid">
  <div class="box">
    <h3>على المستأجر</h3>
    ${tenantRows.length ? tenantRows.map((c) => `<div class="r"><span>${c.label}</span><span>✔</span></div>`).join("") : `<div class="r"><span>—</span><span></span></div>`}
  </div>
  <div class="box">
    <h3>على المؤجّر</h3>
    ${ownerRows.length ? ownerRows.map((c) => `<div class="r"><span>${c.label}</span><span>✔</span></div>`).join("") : `<div class="r"><span>—</span><span></span></div>`}
  </div>
</div>

${q.notes ? `<h2>ملاحظات إضافية</h2><div class="note">${q.notes}</div>` : ""}

<div class="note">
  هذا <b>عرض سعر مبدئي غير مُلزم</b>، وصلاحيته تنتهي بتاريخ ${q.valid_until || "—"}. لا يُنشئ هذا المستند
  علاقة إيجارية ولا يقوم مقام العقد.
</div>
<div class="note" style="border-inline-start-color:#8a5a11;background:#FBF1DF;color:#8a5a11">
  <b>التعاقد النهائي:</b> يُوثَّق عقد الإيجار عبر <b>منصة إيجار</b> التابعة للهيئة العامة للعقار، وهي المرجع
  المعتمد لتوثيق العقود ومطالباتها. توثيق العقد وتحصيل مقابله يتمّان بين الطرفين عبر القنوات الرسمية —
  منصة وثيق تُجهّز المستندات فقط ولا تستلم ولا تحوّل أي مبالغ.
</div>

<div class="sign">
  <div>المؤجّر / وكيله: ${who}<br><br>التوقيع: ________________</div>
  <div>اطّلع المستأجر المحتمل<br><br>التوقيع: ________________</div>
</div>
${footer()}`;
  return SHELL(`عرض سعر ${q.quote_no} — ${q.tenant_name || p.name}`, body, markOf(issuer));
}

/** كشف حساب عقار كامل — كل الوحدات */
export function propertyStatementHTML(p: Property & { tenants: Tenant[] }, issuer: Issuer = {}) {
  const ul = unitLabel(p.property_type);
  const who = issuer.billing_name || p.manager || "إدارة الأملاك";
  const v = vatOf(p);
  const rows = p.tenants.map((t) => ({ t, st: contractState(t, graceOf(p)) }));
  const totalDue = rows.reduce((s, r) => s + r.st.amountDue, 0);
  const totalPaid = rows.reduce((s, r) => s + r.st.paid * splitVat(Number(r.t.rent_amount) || 0, v).total, 0);
  const totalVat = v.enabled ? rows.reduce((s, r) => s + splitVat(r.st.amountDue, v).vat, 0) : 0;
  const late = rows.filter((r) => r.st.status === "late").length;

  const body = `
${header("كشف حساب عقار", p.name)}
<h1>كشف حساب ${p.name}</h1>
<div class="sub">${typeLabel(p.property_type)}${p.address ? ` — ${p.address}` : ""}${p.city ? `، ${p.city}` : ""} · ${p.tenants.length} ${ul}</div>

<div class="tot">
  <div><div class="v">${p.tenants.length}</div><div class="l">إجمالي الوحدات</div></div>
  <div><div class="v g">${p.tenants.length - late}</div><div class="l">منتظمة</div></div>
  <div><div class="v r">${late}</div><div class="l">متأخرة</div></div>
  <div><div class="v">${sar(totalPaid)}</div><div class="l">المُحصَّل (ريال)</div></div>
</div>

${totalDue > 0 ? `<div class="due"><span class="l">إجمالي المستحق على العقار${v.enabled ? ` (منه ضريبة ${sar(totalVat)} ريال)` : ""}</span><span class="v">${sar(totalDue)} ريال</span></div>` : ""}

<table>
  <thead><tr><th>${ul}</th><th>المستأجر</th><th>الدفعة</th><th>الدورة</th><th>القادمة</th><th>المتأخر</th><th>الحالة</th></tr></thead>
  <tbody>
    ${rows.map(({ t, st }) => `<tr>
      <td>${t.unit || "—"}</td>
      <td>${t.name}</td>
      <td>${sar(splitVat(Number(t.rent_amount) || 0, v).total)}</td>
      <td>${freqLabel(t.payment_frequency)}</td>
      <td>${arDate(st.nextDueDate)}</td>
      <td>${st.amountDue ? sar(st.amountDue) : "—"}</td>
      <td>${st.inGrace ? '<span class="pill u">فترة سماح</span>'
          : st.hasPartial && st.status === "late" ? '<span class="pill u">سداد جزئي</span>'
          : st.status === "late" ? '<span class="pill l">متأخر</span>'
          : st.status === "soon" ? '<span class="pill u">يستحق قريبًا</span>'
          : '<span class="pill p">منتظم</span>'}</td>
    </tr>`).join("")}
  </tbody>
</table>

<div class="note">كشف استرشادي صادر آليًّا من بيانات العقود المسجّلة بتاريخ ${today()}.</div>
<div class="sign"><div>المؤجّر / الوكيل: ${who}<br><br>التوقيع: ________________</div><div>تاريخ الإصدار: ${today()}</div></div>
${footer()}`;
  return SHELL(`كشف حساب — ${p.name}`, body, markOf(issuer));
}

/** فتح المستند في نافذة جديدة للطباعة */
/**
 * يعرض المستند للمستخدم.
 *
 * كان يعتمد على window.open وحدها، وسفاري على الآيفون يحجبها افتراضيًّا
 * (وكذلك وضع التطبيق المثبَّت)، فكان المستخدم يرى «اسمح بالنوافذ المنبثقة»
 * ولا يصل إلى مستنده أبدًا — وهو جوهر المنتج.
 *
 * الآن: تُجرَّب النافذة أولًا (أفضل تجربة على الحاسب للطباعة)، وإن حُجبت
 * يُعرض المستند داخل التطبيق نفسه في طبقة ملء الشاشة، فلا يعتمد على إذن.
 */
export function openDoc(html: string) {
  try {
    const w = window.open("", "_blank");
    if (w && w.document) {
      w.document.write(html);
      w.document.close();
      return;
    }
  } catch {
    /* محجوبة — نكمل إلى البديل */
  }
  showDocInline(html);
}

/** عرض المستند داخل الصفحة في طبقة ملء الشاشة مع أزرار طباعة وإغلاق */
function showDocInline(html: string) {
  const prev = document.getElementById("watheq-doc-overlay");
  if (prev) prev.remove();

  const overlay = document.createElement("div");
  overlay.id = "watheq-doc-overlay";
  overlay.setAttribute("dir", "rtl");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:#F6F1E4;display:flex;flex-direction:column";

  const bar = document.createElement("div");
  bar.style.cssText =
    "flex:0 0 auto;display:flex;gap:8px;padding:10px 12px;background:#0E3A37;" +
    "align-items:center;padding-top:calc(10px + env(safe-area-inset-top))";

  const mkBtn = (label: string, bg: string, color: string) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      `appearance:none;border:0;border-radius:10px;padding:10px 16px;font-size:15px;` +
      `font-weight:700;cursor:pointer;background:${bg};color:${color};` +
      `font-family:inherit`;
    return b;
  };

  const printBtn = mkBtn("🖨️ طباعة / حفظ PDF", "#E7C877", "#0E3A37");
  const closeBtn = mkBtn("إغلاق", "transparent", "#F6F1E4");
  closeBtn.style.border = "1px solid rgba(246,241,228,.45)";

  const frame = document.createElement("iframe");
  frame.style.cssText = "flex:1 1 auto;width:100%;border:0;background:#fff";
  frame.setAttribute("title", "مستند وثيق");

  printBtn.onclick = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.print();
    }
  };
  closeBtn.onclick = () => overlay.remove();

  bar.appendChild(printBtn);
  bar.appendChild(closeBtn);
  overlay.appendChild(bar);
  overlay.appendChild(frame);
  document.body.appendChild(overlay);

  // srcdoc بدل document.write: يعمل في كل المتصفحات ولا يحتاج إذنًا
  frame.srcdoc = html;
}

// ============================================================
// كشوف حساب جمعيات الملاك — بنفس هوية مستندات الأملاك
// ============================================================

type OwnerRow = {
  id?: string; name: string; unit: string | null; phone: string | null;
  months_late: number; last_paid: string | null; partial_amount?: number | null;
};
type AssociationDoc = {
  name: string; units?: number; fee: number;
  cert_expiry?: string | null; fund_balance?: number | null;
  owners?: OwnerRow[];
};

const owed = (o: OwnerRow, fee: number) =>
  Math.max(0, (Number(o.months_late) || 0) * fee - (Number(o.partial_amount) || 0));

/** كشف حساب مالك واحد في جمعية */
export function ownerStatementHTML(
  o: OwnerRow, a: AssociationDoc, issuer: Issuer = {}, payments: PaymentRow[] = []
) {
  const fee = Number(a.fee) || 0;
  const who = issuer.billing_name || `إدارة ${a.name}`;
  const due = owed(o, fee);
  const partial = Number(o.partial_amount) || 0;
  const received = payments.reduce((x, r) => x + (Number(r.amount) || 0), 0);

  const body = `
${header("كشف حساب مالك", o.name)}
<h1>كشف حساب الوحدة رقم (${o.unit || "—"})</h1>
<div class="sub">${a.name} · جمعية ملاك${a.units ? ` · ${a.units} وحدة` : ""}</div>

<div class="grid">
  <div class="box">
    <h3>بيانات الجمعية</h3>
    <div class="r"><span>الاسم</span><span>${a.name}</span></div>
    <div class="r"><span>اشتراك الفترة</span><span>${sar(fee)} ريال</span></div>
    ${a.cert_expiry ? `<div class="r"><span>انتهاء الشهادة</span><span>${a.cert_expiry}</span></div>` : ""}
    ${issuer.billing_phone ? `<div class="r"><span>للتواصل</span><span>${issuer.billing_phone}</span></div>` : ""}
  </div>
  <div class="box">
    <h3>بيانات المالك</h3>
    <div class="r"><span>الاسم</span><span>${o.name}</span></div>
    <div class="r"><span>الوحدة</span><span>${o.unit || "—"}</span></div>
    ${o.phone ? `<div class="r"><span>الجوال</span><span>${o.phone}</span></div>` : ""}
    <div class="r"><span>آخر سداد</span><span>${o.last_paid || "—"}</span></div>
  </div>
</div>

<div class="tot">
  <div><div class="v r">${o.months_late || 0}</div><div class="l">فترات متأخرة</div></div>
  <div><div class="v">${sar(fee)}</div><div class="l">اشتراك الفترة (ريال)</div></div>
  <div><div class="v g">${sar(partial)}</div><div class="l">مدفوع جزئيًّا (ريال)</div></div>
  <div><div class="v g">${sar(received)}</div><div class="l">إجمالي المستلم (ريال)</div></div>
</div>

${due > 0 ? `<div class="due"><span class="l">الرصيد المستحق حتى تاريخه</span><span class="v">${sar(due)} ريال</span></div>` : ""}

${payments.length ? `
<h1 style="font-size:1rem">المدفوعات المستلمة</h1>
<table>
  <thead><tr><th>#</th><th>تاريخ الاستلام</th><th>المبلغ (ريال)</th><th>طريقة السداد</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${payments.map((r, i) => `<tr>
      <td>${i + 1}</td><td>${r.paid_on || "—"}</td><td>${sar(r.amount)}</td>
      <td>${methodAr(r.method)}</td><td>${r.note ? String(r.note).replace(/</g, "&lt;") : "—"}</td>
    </tr>`).join("")}
    <tr style="background:#F3EEE2;font-weight:700">
      <td colspan="2">إجمالي المستلم</td><td>${sar(received)}</td><td colspan="2">${payments.length} عملية</td>
    </tr>
  </tbody>
</table>` : `<div class="note">لا توجد مدفوعات موثّقة في سجل المنصة لهذه الوحدة حتى تاريخه.</div>`}

<div class="note">
  تُخصَّص اشتراكات الصيانة لتشغيل الأجزاء المشتركة وصيانتها وفق الموازنة المعتمدة، ويكون السداد في الحساب البنكي للجمعية.
  هذا كشف استرشادي صادر آليًّا — يُرجى مطابقته مع سجلاتكم وإشعارنا بأي فرق.
</div>

<div class="sign">
  <div>إدارة الجمعية: ${who}<br><br>التوقيع: ________________</div>
  <div>المالك: ${o.name}<br><br>التوقيع: ________________</div>
</div>
${footer()}`;
  return SHELL(`كشف حساب — ${o.name}`, body, markOf(issuer));
}

/** كشف حساب الجمعية كاملة — كل الملّاك */
export function associationStatementHTML(a: AssociationDoc, issuer: Issuer = {}) {
  const fee = Number(a.fee) || 0;
  const who = issuer.billing_name || `إدارة ${a.name}`;
  const rows = a.owners || [];
  const late = rows.filter((o) => (Number(o.months_late) || 0) > 0);
  const totalDue = rows.reduce((s, o) => s + owed(o, fee), 0);
  const expected = rows.length * fee;
  const pct = rows.length ? Math.round(((rows.length - late.length) / rows.length) * 100) : 0;

  const body = `
${header("كشف حساب جمعية", a.name)}
<h1>كشف حساب ${a.name}</h1>
<div class="sub">جمعية ملاك · ${rows.length} مالك${a.units ? ` من ${a.units} وحدة` : ""} · اشتراك الفترة ${sar(fee)} ريال</div>

<div class="tot">
  <div><div class="v">${rows.length}</div><div class="l">إجمالي الملّاك</div></div>
  <div><div class="v g">${rows.length - late.length}</div><div class="l">منتظم</div></div>
  <div><div class="v r">${late.length}</div><div class="l">متأخر</div></div>
  <div><div class="v">${pct}%</div><div class="l">نسبة السداد</div></div>
</div>

<div class="grid">
  <div class="box">
    <h3>الوضع المالي</h3>
    <div class="r"><span>الإيرادات المتوقّعة للفترة</span><span>${sar(expected)} ريال</span></div>
    <div class="r"><span>إجمالي المتأخر</span><span>${sar(totalDue)} ريال</span></div>
    ${a.fund_balance != null ? `<div class="r"><span>رصيد الصندوق</span><span>${sar(a.fund_balance)} ريال</span></div>` : ""}
  </div>
  <div class="box">
    <h3>الوضع النظامي</h3>
    <div class="r"><span>انتهاء الشهادة</span><span>${a.cert_expiry || "—"}</span></div>
    ${issuer.cr_number ? `<div class="r"><span>السجل التجاري</span><span>${issuer.cr_number}</span></div>` : ""}
    ${issuer.billing_phone ? `<div class="r"><span>للتواصل</span><span>${issuer.billing_phone}</span></div>` : ""}
  </div>
</div>

${totalDue > 0 ? `<div class="due"><span class="l">إجمالي المستحق على الملّاك</span><span class="v">${sar(totalDue)} ريال</span></div>` : ""}

<table>
  <thead><tr><th>الوحدة</th><th>المالك</th><th>فترات متأخرة</th><th>المتأخر (ريال)</th><th>آخر سداد</th><th>الحالة</th></tr></thead>
  <tbody>
    ${rows.map((o) => {
      const d = owed(o, fee); const m = Number(o.months_late) || 0;
      return `<tr>
        <td>${o.unit || "—"}</td>
        <td>${o.name}</td>
        <td>${m || "—"}</td>
        <td>${d ? sar(d) : "—"}</td>
        <td>${o.last_paid || "—"}</td>
        <td>${m >= 3 ? '<span class="pill l">حرج</span>'
            : (Number(o.partial_amount) || 0) > 0 && m > 0 ? '<span class="pill u">سداد جزئي</span>'
            : m > 0 ? '<span class="pill l">متأخر</span>'
            : '<span class="pill p">مسدّد</span>'}</td>
      </tr>`;
    }).join("")}
  </tbody>
</table>

<div class="note">كشف استرشادي صادر آليًّا من بيانات الجمعية المسجّلة بتاريخ ${today()}. يُصرف من الاشتراكات وفق الموازنة المعتمدة من الجمعية العامة.</div>
<div class="sign"><div>إدارة الجمعية: ${who}<br><br>التوقيع: ________________</div><div>تاريخ الإصدار: ${today()}</div></div>
${footer()}`;
  return SHELL(`كشف حساب — ${a.name}`, body, markOf(issuer));
}

// ============================================================
// الموازنة التقديرية ومحضر الجمعية العمومية التأسيسية
// ============================================================

export type BudgetItem = { label: string; monthly: number; note?: string | null };

/** بنود مصروفات نموذجية لعقار سكني مشترك — نقطة بداية يعدّلها المستخدم */
export const DEFAULT_BUDGET_ITEMS: BudgetItem[] = [
  { label: "النظافة العامة للأجزاء المشتركة", monthly: 0 },
  { label: "الأمن والحراسة", monthly: 0 },
  { label: "صيانة المصاعد (عقد دوري)", monthly: 0 },
  { label: "صيانة التكييف والتهوية", monthly: 0 },
  { label: "كهرباء ومياه الأجزاء المشتركة", monthly: 0 },
  { label: "صيانة المضخات والخزانات", monthly: 0 },
  { label: "مكافحة الحشرات", monthly: 0 },
  { label: "أعمال سباكة وكهرباء طارئة", monthly: 0 },
  { label: "أجرة مدير العقار", monthly: 0 },
  { label: "مصروفات إدارية وبنكية", monthly: 0 },
];

/** الموازنة التقديرية السنوية — أساس اعتماد الاشتراك من الجمعية العامة */
export function budgetHTML(
  a: AssociationDoc & { units?: number },
  budget: { year: number; items: BudgetItem[]; reserve_pct?: number; notes?: string | null },
  issuer: Issuer = {}
) {
  const who = issuer.billing_name || `إدارة ${a.name}`;
  const items = (budget.items || []).filter((i) => i && i.label);
  const monthlyTotal = items.reduce((s, i) => s + (Number(i.monthly) || 0), 0);
  const annualOps = monthlyTotal * 12;
  const reservePct = Number(budget.reserve_pct ?? 10) || 0;
  const reserve = Math.round(annualOps * (reservePct / 100));
  const annualTotal = annualOps + reserve;

  const units = Number(a.units) || (a.owners || []).length || 0;
  const perUnitYear = units ? Math.round(annualTotal / units) : 0;
  const perUnitMonth = units ? Math.round(annualTotal / units / 12) : 0;
  const currentFee = Number(a.fee) || 0;
  const currentAnnual = currentFee * 12 * units;
  const gap = annualTotal - currentAnnual;

  const body = `
${header("موازنة تقديرية", String(budget.year))}
<h1>الموازنة التقديرية لعام ${budget.year}</h1>
<div class="sub">${a.name} · جمعية ملاك${units ? ` · ${units} وحدة` : ""}</div>

<div class="note">
  هذه موازنة تقديرية تُعرض على الجمعية العامة لاعتمادها، وعلى أساسها يُحدَّد اشتراك الصيانة.
  الأرقام أدناه مدخلة من إدارة الجمعية وقابلة للتعديل قبل التصويت.
</div>

<h1 style="font-size:1rem">أولًا: المصروفات التشغيلية</h1>
<table>
  <thead><tr><th>#</th><th>البند</th><th>شهريًّا (ريال)</th><th>سنويًّا (ريال)</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${items.map((i, n) => `<tr>
      <td>${n + 1}</td>
      <td>${String(i.label).replace(/</g, "&lt;")}</td>
      <td>${sar(i.monthly)}</td>
      <td>${sar((Number(i.monthly) || 0) * 12)}</td>
      <td>${i.note ? String(i.note).replace(/</g, "&lt;") : "—"}</td>
    </tr>`).join("")}
    <tr style="background:#F3EEE2;font-weight:700">
      <td colspan="2">إجمالي المصروفات التشغيلية</td>
      <td>${sar(monthlyTotal)}</td>
      <td>${sar(annualOps)}</td>
      <td>—</td>
    </tr>
  </tbody>
</table>

<h1 style="font-size:1rem">ثانيًا: احتياطي الصيانة الرأسمالية</h1>
<table>
  <tbody>
    <tr><td>نسبة الاحتياطي من المصروفات التشغيلية</td><td style="text-align:left;font-weight:600">${reservePct}%</td></tr>
    <tr><td>مبلغ الاحتياطي السنوي</td><td style="text-align:left;font-weight:600">${sar(reserve)} ريال</td></tr>
  </tbody>
</table>
<div class="note">
  يُخصَّص الاحتياطي للأعمال الكبيرة غير الدورية (تجديد المصاعد، العزل، الأصباغ الخارجية، استبدال المضخات)،
  ويقي الملّاك من مطالبات مالية مفاجئة.
</div>

<div class="due">
  <span class="l">إجمالي الموازنة التقديرية لعام ${budget.year}</span>
  <span class="v">${sar(annualTotal)} ريال</span>
</div>

<h1 style="font-size:1rem">ثالثًا: الاشتراك المقترح لكل وحدة</h1>
${units > 0 ? `<div class="tot">
  <div><div class="v">${units}</div><div class="l">عدد الوحدات</div></div>
  <div><div class="v">${sar(perUnitYear)}</div><div class="l">سنويًّا لكل وحدة (ريال)</div></div>
  <div><div class="v">${sar(perUnitMonth)}</div><div class="l">شهريًّا لكل وحدة (ريال)</div></div>
  ${currentFee > 0
    ? `<div><div class="v ${gap > 0 ? "r" : "g"}">${sar(Math.abs(gap))}</div><div class="l">${gap > 0 ? "عجز متوقّع (ريال)" : "فائض متوقّع (ريال)"}</div></div>`
    : `<div><div class="v">—</div><div class="l">لم يُعتمد اشتراك بعد</div></div>`}
</div>` : `<div class="note" style="border-inline-start-color:#D0453F;background:#FBE9E7;color:#a5322c">
  <b>لم يُحدَّد عدد الوحدات.</b> أدخل عدد وحدات العقار في إعدادات الجمعية ليُحتسب الاشتراك المقترح لكل وحدة —
  وهو الرقم الذي تُبنى عليه الموازنة.
</div>`}

${currentFee > 0 ? `<table>
  <tbody>
    <tr><td>الاشتراك الحالي المعتمد</td><td style="text-align:left;font-weight:600">${sar(currentFee)} ريال / شهر لكل وحدة</td></tr>
    <tr><td>إيرادات الاشتراك الحالي سنويًّا</td><td style="text-align:left;font-weight:600">${sar(currentAnnual)} ريال</td></tr>
    <tr style="background:${gap > 0 ? "#FBE9E7" : "#E6F4EC"};font-weight:700">
      <td>${gap > 0 ? "الفرق المطلوب تغطيته" : "الفائض المرحّل"}</td>
      <td style="text-align:left">${sar(Math.abs(gap))} ريال</td>
    </tr>
  </tbody>
</table>` : ""}

${budget.notes ? `<div class="note">${String(budget.notes).replace(/</g, "&lt;")}</div>` : ""}

<div class="note">
  يُحدَّد مبلغ الاشتراك السنوي بقرار من الجمعية العامة وفق النظام الأساسي للجمعية،
  ويُودَع في الحساب البنكي للجمعية ويُصرف منه وفق هذه الموازنة المعتمدة.
</div>

<div class="sign">
  <div>أعدّها: ${who}<br><br>التوقيع: ________________</div>
  <div>اعتماد رئيس الجمعية<br><br>التوقيع: ________________</div>
</div>
${footer()}`;
  return SHELL(`الموازنة التقديرية ${budget.year} — ${a.name}`, body, markOf(issuer));
}

/** محضر الجمعية العمومية التأسيسية */
export function foundingMinutesHTML(
  a: AssociationDoc & { units?: number },
  d: {
    meeting_date?: string; place?: string; mode?: string;
    attendees?: number; total_units?: number;
    president?: string; manager?: string;
    fee?: number; due_day?: string; bank?: string;
    year?: number; annual_budget?: number;
  },
  issuer: Issuer = {}
) {
  const who = issuer.billing_name || `إدارة ${a.name}`;
  const date = d.meeting_date || today();
  const units = Number(d.total_units) || Number(a.units) || (a.owners || []).length || 0;
  const att = Number(d.attendees) || 0;
  const quorum = units ? Math.round((att / units) * 100) : 0;
  const fee = Number(d.fee) || Number(a.fee) || 0;

  const body = `
${header("محضر اجتماع", "الجمعية العمومية التأسيسية")}
<h1>محضر الجمعية العمومية التأسيسية</h1>
<div class="sub">${a.name}${units ? ` · ${units} وحدة عقارية` : ""}</div>

<div class="grid">
  <div class="box">
    <h3>بيانات الاجتماع</h3>
    <div class="r"><span>التاريخ</span><span>${date}</span></div>
    <div class="r"><span>طريقة الانعقاد</span><span>${d.mode || "حضوري"}</span></div>
    ${d.place ? `<div class="r"><span>المكان</span><span>${d.place}</span></div>` : ""}
    <div class="r"><span>عدد الحاضرين</span><span>${att || "—"} من ${units || "—"}</span></div>
    <div class="r"><span>نسبة الحضور</span><span>${units ? quorum + "%" : "—"}</span></div>
  </div>
  <div class="box">
    <h3>الأساس النظامي</h3>
    <div class="r"><span>النظام</span><span>ملكية الوحدات العقارية وفرزها وإدارتها</span></div>
    <div class="r"><span>المرسوم الملكي</span><span>م/85 وتاريخ 02/07/1441هـ</span></div>
    <div class="r"><span>الجهة المشرفة</span><span>الهيئة العامة للعقار</span></div>
  </div>
</div>

<div class="note">
  عُقد هذا الاجتماع لتأسيس جمعية ملاك العقار المشترك المذكور أعلاه، وفقًا لنظام ملكية الوحدات العقارية
  وفرزها وإدارتها ولائحته التنفيذية، وبما أن عدد ملّاك الوحدات المفرزة ثلاثة أو أكثر.
</div>

<h1 style="font-size:1rem">جدول الأعمال والقرارات</h1>
<table>
  <thead><tr><th>#</th><th>البند</th><th>القرار</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>تأسيس جمعية الملاك واعتماد نظامها الأساسي</td>
        <td>الموافقة على التأسيس واعتماد النظام الأساسي (الاسترشادي الصادر من الهيئة).</td></tr>
    <tr><td>2</td><td>انتخاب رئيس الجمعية</td>
        <td>${d.president ? `انتخاب المكرَّم <b>${String(d.president).replace(/</g, "&lt;")}</b> رئيسًا للجمعية.` : "________________________________"}</td></tr>
    <tr><td>3</td><td>تعيين مدير العقار</td>
        <td>${d.manager ? `تعيين <b>${String(d.manager).replace(/</g, "&lt;")}</b> مديرًا للعقار.` : "________________________________"}</td></tr>
    <tr><td>4</td><td>اعتماد الموازنة التقديرية${d.year ? ` لعام ${d.year}` : ""}</td>
        <td>${d.annual_budget ? `اعتماد موازنة بإجمالي <b>${sar(d.annual_budget)}</b> ريال.` : "________________________________"}</td></tr>
    <tr><td>5</td><td>تحديد اشتراك الصيانة وموعد سداده</td>
        <td>${fee ? `تحديد الاشتراك بمبلغ <b>${sar(fee)}</b> ريال لكل وحدة${d.due_day ? `، يُسدَّد ${d.due_day}` : ""}.` : "________________________________"}</td></tr>
    <tr><td>6</td><td>فتح الحساب البنكي للجمعية</td>
        <td>${d.bank ? `تفويض إدارة الجمعية بفتح حساب لدى <b>${String(d.bank).replace(/</g, "&lt;")}</b> باسم الجمعية.` : "تفويض إدارة الجمعية بفتح حساب بنكي باسم الجمعية."}</td></tr>
    <tr><td>7</td><td>تسجيل الجمعية لدى الهيئة العامة للعقار</td>
        <td>تفويض رئيس الجمعية بإتمام التسجيل عبر منصة «ملاك» واستكمال المتطلبات النظامية.</td></tr>
  </tbody>
</table>

<div class="note">
  تُودَع الاشتراكات في الحساب البنكي للجمعية، ولا يجوز الصرف منها إلا وفق الموازنة المعتمدة.
  ولا يملك مدير العقار صلاحية تعديل النظام الأساسي أو فرض رسوم جديدة.
</div>

<h1 style="font-size:1rem">توقيعات الحاضرين</h1>
<table>
  <thead><tr><th>#</th><th>اسم المالك</th><th>الوحدة</th><th>التوقيع</th></tr></thead>
  <tbody>
    ${(a.owners && a.owners.length
      ? a.owners.map((o, i) => `<tr><td>${i + 1}</td><td>${String(o.name).replace(/</g, "&lt;")}</td><td>${o.unit || "—"}</td><td>________________</td></tr>`).join("")
      : Array.from({ length: 8 }, (_, i) => `<tr><td>${i + 1}</td><td>________________</td><td>____</td><td>________________</td></tr>`).join(""))}
  </tbody>
</table>

<div class="sign">
  <div>رئيس الجمعية: ${d.president || "________________"}<br><br>التوقيع: ________________</div>
  <div>مدير العقار: ${d.manager || "________________"}<br><br>التوقيع: ________________</div>
</div>
<div class="note" style="border-inline-start-color:#D0453F;background:#FBE9E7;color:#a5322c">
  <b>تنويه:</b> هذا نموذج محضر استرشادي أعدّته إدارة الجمعية للاستخدام الإداري.
  وثيق لا يقدّم خدمات قانونية ولا يمثّل الجمعية أمام أي جهة — راجع النموذج مع مختص مرخّص
  وطابقه مع النظام الأساسي المعتمد قبل تقديمه رسميًّا.
</div>
${footer()}`;
  return SHELL(`محضر تأسيسي — ${a.name}`, body, markOf(issuer));
}

// ============================================================
// مخالصة إخلاء وحدة — تسوية التأمين وقراءات العدادات
// ============================================================

export function moveOutSettlementHTML(
  t: Tenant & {
    status?: string | null; move_out_date?: string | null; notice_date?: string | null;
    deposit_amount?: number | null; deposit_deductions?: number | null; deposit_notes?: string | null;
    meter_elec_in?: string | null; meter_elec_out?: string | null;
    meter_water_in?: string | null; meter_water_out?: string | null;
    turnover_checklist?: { label: string; done?: boolean; note?: string | null }[] | null;
  },
  p: Property, issuer: Issuer = {}
) {
  const st = contractState(t as any, { graceDays: Number(p.grace_days) || 0 });
  const ul = unitLabel(p.property_type);
  const who = issuer.billing_name || p.manager || "إدارة الأملاك";
  const s = settleDeposit(t as any, st.amountDue);
  const list = Array.isArray(t.turnover_checklist) ? t.turnover_checklist : [];
  const doneCount = list.filter((x) => x?.done).length;
  const vac = vacancyDays(t.move_out_date);

  const body = `
${header("مخالصة إخلاء", t.name)}
<h1>مخالصة إخلاء ${ul} رقم (${t.unit || "—"})</h1>
<div class="sub">${p.name}${p.address ? ` — ${p.address}` : ""}${p.city ? `، ${p.city}` : ""} · ${typeLabel(p.property_type)}</div>

<div class="grid">
  <div class="box">
    <h3>بيانات الطرفين</h3>
    <div class="r"><span>المؤجّر / الوكيل</span><span>${who}</span></div>
    <div class="r"><span>المستأجر</span><span>${t.name}</span></div>
    ${t.national_id ? `<div class="r"><span>الهوية / السجل</span><span>${t.national_id}</span></div>` : ""}
    ${t.phone ? `<div class="r"><span>الجوال</span><span>${t.phone}</span></div>` : ""}
  </div>
  <div class="box">
    <h3>بيانات الإخلاء</h3>
    <div class="r"><span>بداية العقد</span><span>${arDate(t.contract_start)}</span></div>
    <div class="r"><span>نهاية العقد</span><span>${arDate(st.endDate)}</span></div>
    ${t.notice_date ? `<div class="r"><span>تاريخ الإشعار</span><span>${arDate(t.notice_date)}</span></div>` : ""}
    <div class="r"><span>تاريخ الإخلاء الفعلي</span><span>${arDate(t.move_out_date)}</span></div>
    ${vac !== null ? `<div class="r"><span>أيام الشغور حتى تاريخه</span><span>${vac}</span></div>` : ""}
  </div>
</div>

<h1 style="font-size:1rem">أولًا: قراءات العدادات</h1>
<table>
  <thead><tr><th>العدّاد</th><th>عند التسليم</th><th>عند الإخلاء</th><th>الفرق</th></tr></thead>
  <tbody>
    <tr>
      <td>الكهرباء</td><td>${t.meter_elec_in || "—"}</td><td>${t.meter_elec_out || "—"}</td>
      <td>${(Number(t.meter_elec_out) && Number(t.meter_elec_in)) ? sar(Number(t.meter_elec_out) - Number(t.meter_elec_in)) : "—"}</td>
    </tr>
    <tr>
      <td>المياه</td><td>${t.meter_water_in || "—"}</td><td>${t.meter_water_out || "—"}</td>
      <td>${(Number(t.meter_water_out) && Number(t.meter_water_in)) ? sar(Number(t.meter_water_out) - Number(t.meter_water_in)) : "—"}</td>
    </tr>
  </tbody>
</table>
<div class="note">يتحمّل المستأجر استهلاك الخدمات حتى تاريخ الإخلاء، ويلتزم بنقل أو فصل الاشتراكات باسمه.</div>

<h1 style="font-size:1rem">ثانيًا: تسوية مبلغ التأمين</h1>
<table>
  <tbody>
    <tr><td>مبلغ التأمين المستلم</td><td style="text-align:left;font-weight:600">${sar(s.deposit)} ريال</td></tr>
    <tr><td>يُخصم: إيجار متأخر حتى تاريخ الإخلاء</td><td style="text-align:left;font-weight:600">${sar(s.outstanding)} ريال</td></tr>
    <tr><td>يُخصم: تلفيات وأعمال إصلاح</td><td style="text-align:left;font-weight:600">${sar(s.deductions)} ريال</td></tr>
    ${s.refund > 0
      ? `<tr style="background:#E6F4EC;font-weight:700"><td>المستحق ردّه للمستأجر</td><td style="text-align:left">${sar(s.refund)} ريال</td></tr>`
      : `<tr style="background:#FBE9E7;font-weight:700"><td>المستحق على المستأجر بعد استنفاد التأمين</td><td style="text-align:left">${sar(s.dueFromTenant)} ريال</td></tr>`}
  </tbody>
</table>
${t.deposit_notes ? `<div class="note">تفصيل الخصومات: ${String(t.deposit_notes).replace(/</g, "&lt;")}</div>` : ""}

${list.length ? `
<h1 style="font-size:1rem">ثالثًا: قائمة تحقّق التسليم (${doneCount} من ${list.length})</h1>
<table>
  <thead><tr><th>#</th><th>البند</th><th>الحالة</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${list.map((x, i) => `<tr>
      <td>${i + 1}</td>
      <td>${String(x.label || "").replace(/</g, "&lt;")}</td>
      <td>${x.done ? '<span class="pill p">تم</span>' : '<span class="pill u">لم يتم</span>'}</td>
      <td>${x.note ? String(x.note).replace(/</g, "&lt;") : "—"}</td>
    </tr>`).join("")}
  </tbody>
</table>` : ""}

<div class="note">
  بتوقيع الطرفين على هذه المخالصة، تُعدّ العلاقة الإيجارية منتهية عن ${ul} رقم (${t.unit || "—"})،
  ويُقرّ كل طرف باستلام مستحقّاته الموضّحة أعلاه، مع بقاء أي التزام لم يُذكر صراحةً خاضعًا لأحكام العقد والأنظمة المعمول بها.
</div>

<div class="sign">
  <div>المؤجّر / الوكيل: ${who}<br><br>التوقيع: ________________</div>
  <div>المستأجر: ${t.name}<br><br>التوقيع: ________________</div>
</div>
<div class="note" style="border-inline-start-color:#B8791F;background:#FBF1DF;color:#8a5a11">
  مستند إداري صادر عن إدارة الأملاك لتوثيق التسليم بين الطرفين. وثيق لا يقدّم خدمات قانونية ولا يستلم أي مبالغ —
  راجعه مع مختص مرخّص قبل الاعتماد الرسمي.
</div>
${footer()}`;
  return SHELL(`مخالصة إخلاء — ${t.name}`, body, markOf(issuer));
}

// ============================================================
// محضر الاجتماع السنوي للجمعية العمومية
// أساسه النظام الأساسي: المادة (14/2) توجب انعقاد الجمعية العامة مرّتين سنويًّا على الأقل،
// وأحد الاجتماعين خلال الأشهر الثلاثة التالية لنهاية السنة المالية؛ والمادة (التاسعة)
// تجعل اعتماد الميزانية وتقرير المدير وإبراء ذمّته من اختصاصات الجمعية العامة.
// ملاحظة: إصدار شهادة الجمعية إجراء إلكتروني مباشر في منصة «ملاك» ولا يتطلّب رفع مستندات.
// ============================================================

export function renewalMinutesHTML(
  a: AssociationDoc & { units?: number },
  d: {
    meeting_date?: string; place?: string; mode?: string;
    attendees?: number; total_units?: number;
    president?: string; manager?: string;
    fee?: number; year?: number; annual_budget?: number;
    collected?: number; spent?: number; fund_balance?: number;
    notes?: string;
  },
  issuer: Issuer = {}
) {
  const esc = (s: any) => String(s ?? "").replace(/</g, "&lt;");
  const date = d.meeting_date || today();
  const units = Number(d.total_units) || Number(a.units) || (a.owners || []).length || 0;
  const att = Number(d.attendees) || 0;
  const quorum = units ? Math.round((att / units) * 100) : 0;
  const fee = Number(d.fee) || Number(a.fee) || 0;
  const nextYear = Number(d.year) || new Date().getFullYear() + 1;
  const collected = Number(d.collected) || 0;
  const spent = Number(d.spent) || 0;
  const fund = d.fund_balance !== undefined ? Number(d.fund_balance) || 0 : Number(a.fund_balance) || 0;

  const body = `
${header("محضر اجتماع", "الجمعية العمومية السنوية")}
<h1>محضر اجتماع الجمعية العمومية السنوي</h1>
<div class="sub">${a.name}${units ? ` · ${units} وحدة عقارية` : ""} · الاجتماع السنوي واعتماد موازنة عام ${nextYear}</div>

<div class="grid">
  <div class="box">
    <h3>بيانات الاجتماع</h3>
    <div class="r"><span>التاريخ</span><span>${date}</span></div>
    <div class="r"><span>طريقة الانعقاد</span><span>${d.mode || "حضوري"}</span></div>
    ${d.place ? `<div class="r"><span>المكان</span><span>${esc(d.place)}</span></div>` : ""}
    <div class="r"><span>عدد الحاضرين</span><span>${att || "—"} من ${units || "—"}</span></div>
    <div class="r"><span>نسبة الحضور</span><span>${units ? quorum + "%" : "—"}</span></div>
  </div>
  <div class="box">
    <h3>الأساس النظامي</h3>
    <div class="r"><span>النظام</span><span>ملكية الوحدات العقارية وفرزها وإدارتها</span></div>
    <div class="r"><span>المرسوم الملكي</span><span>م/85 وتاريخ 02/07/1441هـ</span></div>
    <div class="r"><span>الجهة المشرفة</span><span>الهيئة العامة للعقار — منصة ملاك</span></div>
    <div class="r"><span>سند الانعقاد</span><span>النظام الأساسي — المادتان (9) و(14/2)</span></div>
  </div>
</div>

<div class="note">
  عُقد هذا الاجتماع السنوي لاستعراض أعمال الجمعية عن العام المنقضي، واعتماد الموازنة التقديرية
  لعام ${nextYear}، وتقرير مبلغ اشتراك الصيانة تمهيدًا لإدخاله في قرار رسوم الاشتراك بمنصة «ملاك»
  وطرحه للتصويت.
</div>

<h1 style="font-size:1rem">أولًا: الموقف المالي للعام المنقضي</h1>
<table>
  <tbody>
    <tr><td>إجمالي الاشتراكات المحصَّلة</td><td style="text-align:left;font-weight:600">${collected ? sar(collected) + " ريال" : "________________"}</td></tr>
    <tr><td>إجمالي المصروفات (تشغيل وصيانة)</td><td style="text-align:left;font-weight:600">${spent ? sar(spent) + " ريال" : "________________"}</td></tr>
    <tr style="background:#F3EEE2;font-weight:700"><td>رصيد صندوق الجمعية</td><td style="text-align:left">${sar(fund)} ريال</td></tr>
  </tbody>
</table>

<h1 style="font-size:1rem">ثانيًا: جدول الأعمال والقرارات</h1>
<table>
  <thead><tr><th>#</th><th>البند</th><th>القرار</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>تقرير أعمال الجمعية عن العام المنقضي</td>
        <td>استُعرض التقرير وصودق عليه.</td></tr>
    <tr><td>2</td><td>المصادقة على الحساب الختامي والموقف المالي</td>
        <td>صودق على الموقف المالي الموضّح أعلاه.</td></tr>
    <tr><td>3</td><td>اعتماد الموازنة التقديرية لعام ${nextYear}</td>
        <td>${d.annual_budget ? `اعتماد موازنة بإجمالي <b>${sar(d.annual_budget)}</b> ريال (مرفقة بهذا المحضر).` : "اعتماد الموازنة التقديرية المرفقة بهذا المحضر."}</td></tr>
    <tr><td>4</td><td>اشتراك الصيانة لعام ${nextYear}</td>
        <td>${fee ? `إقرار الاشتراك بمبلغ <b>${sar(fee)}</b> ريال لكل وحدة.` : "________________________________"}</td></tr>
    <tr><td>5</td><td>مدير العقار</td>
        <td>${d.manager ? `تجديد تعيين <b>${esc(d.manager)}</b> مديرًا للعقار.` : "________________________________"}</td></tr>
    <tr><td>6</td><td>إدخال قرار رسوم الاشتراك في المنصة</td>
        <td>تفويض ${d.president ? `رئيس الجمعية <b>${esc(d.president)}</b>` : "رئيس الجمعية"} ومدير العقار بإنشاء قرار
            «إعادة تحديد رسوم الاشتراك» في منصة «ملاك» ببنود موازنة عام ${nextYear} وطرحه لتصويت الأعضاء،
            ثم إصدار الفواتير وفق موعد الاستحقاق المعتمد.</td></tr>
    ${d.notes ? `<tr><td>7</td><td>بنود إضافية</td><td>${esc(d.notes)}</td></tr>` : ""}
  </tbody>
</table>

<div class="note">
  تُودَع الاشتراكات في الحساب البنكي للجمعية، ولا يُصرف منها إلا وفق الموازنة المعتمدة.
  ويُرفق بهذا المحضر: الموازنة التقديرية لعام ${nextYear}.
</div>

<h1 style="font-size:1rem">توقيعات الحاضرين</h1>
<table>
  <thead><tr><th>#</th><th>اسم المالك</th><th>الوحدة</th><th>التوقيع</th></tr></thead>
  <tbody>
    ${(a.owners && a.owners.length
      ? a.owners.map((o, i) => `<tr><td>${i + 1}</td><td>${esc(o.name)}</td><td>${o.unit || "—"}</td><td>________________</td></tr>`).join("")
      : Array.from({ length: 8 }, (_, i) => `<tr><td>${i + 1}</td><td>________________</td><td>____</td><td>________________</td></tr>`).join(""))}
  </tbody>
</table>

<div class="sign">
  <div>رئيس الجمعية: ${d.president ? esc(d.president) : "________________"}<br><br>التوقيع: ________________</div>
  <div>مدير العقار: ${d.manager ? esc(d.manager) : "________________"}<br><br>التوقيع: ________________</div>
</div>
<div class="note" style="border-inline-start-color:#D0453F;background:#FBE9E7;color:#a5322c">
  <b>تنويه:</b> هذا نموذج محضر استرشادي أعدّته إدارة الجمعية للاستخدام الإداري.
  وثيق لا يقدّم خدمات قانونية ولا يمثّل الجمعية أمام أي جهة — طابق النموذج مع النظام الأساسي
  المعتمد ومتطلبات منصة «ملاك» قبل رفعه رسميًّا.
</div>
${footer()}`;
  return SHELL(`محضر الاجتماع السنوي — ${a.name}`, body, markOf(issuer));
}

// ============================================================
// فاتورة اشتراك وثيق — من وثيق إلى المشترك (تُصدر من لوحة الإدارة فقط)
// ============================================================

export type SubInvoice = {
  invoice_no: string;
  /** اسم المشترك ومنشأته */
  to_name: string;
  to_org?: string | null;
  to_phone?: string | null;
  /** الباقة كما تُعرض للمشترك، مثل: باقة المالك · الاحترافية */
  plan_label: string;
  months: number;
  amount: number;
  /** بداية ونهاية الفترة المشمولة (YYYY-MM-DD) */
  from_date: string;
  to_date: string;
  method?: string | null;
  paid_at?: string | null;
  /** الرقم الضريبي لوثيق — إن وُجد تُحتسب الضريبة، وإن غاب تُطبع فاتورة بلا ضريبة */
  vat_number?: string | null;
  vat_rate?: number | null;
};

/**
 * فاتورة/إيصال اشتراك تُسلَّم للمشترك.
 * لا علامة مائية ولا سطر «أُنشئ عبر وثيق» — المُصدِر هنا وثيق نفسه.
 */
export function subscriptionInvoiceHTML(inv: SubInvoice) {
  const rate = Number(inv.vat_rate ?? 15);
  const hasVat = !!inv.vat_number;
  const total = Number(inv.amount) || 0;
  const base = hasVat ? Math.round((total / (1 + rate / 100)) * 100) / 100 : total;
  const vat = Math.round((total - base) * 100) / 100;
  const paid = inv.paid_at || today();

  const body = `
${header(hasVat ? "فاتورة ضريبية" : "فاتورة اشتراك", inv.invoice_no)}
<h1>${hasVat ? "فاتورة ضريبية — اشتراك وثيق" : "فاتورة اشتراك وثيق"}</h1>
<div class="sub">الفترة: ${inv.from_date} حتى ${inv.to_date} · ${inv.months} ${inv.months === 1 ? "شهر" : "شهرًا"}</div>

<div class="grid">
  <div class="box">
    <h3>المُصدِر</h3>
    <div class="r"><span>الاسم</span><span>وثيق — منصة إدارة الأملاك</span></div>
    <div class="r"><span>وثيقة العمل الحر</span><span>FL-763162251</span></div>
    ${inv.vat_number ? `<div class="r"><span>الرقم الضريبي</span><span>${inv.vat_number}</span></div>` : ""}
    <div class="r"><span>للتواصل</span><span>watheqdocs@gmail.com</span></div>
  </div>
  <div class="box">
    <h3>إلى</h3>
    <div class="r"><span>الاسم</span><span>${inv.to_name || "—"}</span></div>
    ${inv.to_org ? `<div class="r"><span>المنشأة</span><span>${inv.to_org}</span></div>` : ""}
    ${inv.to_phone ? `<div class="r"><span>الجوال</span><span>${inv.to_phone}</span></div>` : ""}
    <div class="r"><span>الباقة</span><span>${inv.plan_label}</span></div>
  </div>
</div>

<table>
  <thead><tr><th>البيان</th><th>الفترة</th><th>المدة</th><th>المبلغ${hasVat ? " قبل الضريبة" : ""} (ريال)</th></tr></thead>
  <tbody>
    <tr>
      <td>اشتراك منصة وثيق — ${inv.plan_label}</td>
      <td>${inv.from_date} → ${inv.to_date}</td>
      <td>${inv.months} ${inv.months === 1 ? "شهر" : "شهرًا"}</td>
      <td>${sar(base)}</td>
    </tr>
  </tbody>
</table>

${hasVat ? `<table style="max-width:340px;margin-inline-start:auto">
  <tbody>
    <tr><td>الإجمالي قبل الضريبة</td><td style="text-align:left;font-weight:600">${sar(base)}</td></tr>
    <tr><td>ضريبة القيمة المضافة (${rate}%)</td><td style="text-align:left;font-weight:600">${sar(vat)}</td></tr>
    <tr><td style="font-weight:700">الإجمالي شامل الضريبة</td><td style="text-align:left;font-weight:700">${sar(total)}</td></tr>
  </tbody>
</table>` : ""}

<div class="due"><span class="l">الإجمالي المدفوع${hasVat ? " (شامل الضريبة)" : ""}</span><span class="v">${sar(total)} ريال</span></div>

<div class="note">
  ${methodAr(inv.method) !== "—" ? `وسيلة السداد: <b>${methodAr(inv.method)}</b> · ` : ""}تاريخ السداد: <b>${paid}</b>.
  يسري الاشتراك حتى <b>${inv.to_date}</b>، وتبقى بيانات الحساب ومستنداته متاحة للمشترك طوال الفترة.
</div>

${hasVat ? `<div class="note" style="border-inline-start-color:#D0453F;background:#FBE9E7;color:#a5322c">
  <b>تنويه:</b> هذا مستند إداري يبيّن احتساب الضريبة، وليس فاتورة إلكترونية معتمدة من هيئة الزكاة والضريبة والدخل
  (لا يتضمّن رمز الاستجابة السريعة ولا التوقيع الإلكتروني المطلوبين نظامًا).
</div>` : `<div class="note">
  <b>لا تشمل هذه الفاتورة ضريبة القيمة المضافة</b> — المُصدِر غير مسجَّل في ضريبة القيمة المضافة،
  وهي مستند إداري لإثبات السداد وليست فاتورة إلكترونية معتمدة من هيئة الزكاة والضريبة والدخل.
</div>`}

<div class="sign">
  <div>المُصدِر: وثيق<br><br>التوقيع: ________________</div>
  <div>تاريخ الإصدار: ${today()}<br><br>رقم الفاتورة: ${inv.invoice_no}</div>
</div>
${footer()}`;
  return SHELL(`فاتورة ${inv.invoice_no} — ${inv.to_name}`, body, "none");
}

// ============================================================
// تقرير المالك الدوري — أهم مستند يقدّمه مكتب إدارة الأملاك لمالكه:
// إشغال + محصَّل الفترة فعليًّا (من سجل الدفعات) + المتأخرات الحالية.
// يختلف عن «كشف حساب العقار»: ذاك لقطة لحظية، وهذا حصاد فترة.
// ============================================================

export type OwnerReportPayment = PaymentRow & { tenant_name?: string | null; unit?: string | null };

export function ownerReportHTML(
  p: Property & { tenants: (Tenant & { status?: string | null; move_out_date?: string | null })[] },
  period: { label: string; from: string; to: string },
  payments: OwnerReportPayment[] = [],
  issuer: Issuer = {},
) {
  const ul = unitLabel(p.property_type);
  const who = issuer.billing_name || p.manager || "إدارة الأملاك";
  const v = vatOf(p);
  const g = graceOf(p);

  const rows = (p.tenants || []).map((t) => ({ t, st: contractState(t, g), vacant: isVacant(t) }));
  const total = rows.length;
  const vacant = rows.filter((r) => r.vacant).length;
  const occupied = total - vacant;
  const occupancy = total ? Math.round((occupied / total) * 100) : 0;
  const late = rows.filter((r) => !r.vacant && r.st.status === "late").length;
  const totalDue = rows.reduce((s, r) => s + (r.vacant ? 0 : r.st.amountDue), 0);
  const collected = payments.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const expiring = rows.filter((r) => !r.vacant && r.st.daysToEnd !== null && r.st.daysToEnd >= 0 && r.st.daysToEnd <= 60).length;

  const body = `
${header("تقرير دوري للمالك", p.name)}
<h1>تقرير المالك — ${p.name}</h1>
<div class="sub">${typeLabel(p.property_type)}${p.address ? ` — ${p.address}` : ""}${p.city ? `، ${p.city}` : ""} · الفترة: <b>${period.label}</b> (${arDate(period.from)} إلى ${arDate(period.to)})</div>

<div class="tot">
  <div><div class="v">${total}</div><div class="l">إجمالي الوحدات</div></div>
  <div><div class="v">${occupancy}%</div><div class="l">الإشغال (${vacant} شاغرة)</div></div>
  <div><div class="v g">${sar(collected)}</div><div class="l">المُحصَّل خلال الفترة (ريال)</div></div>
  <div><div class="v${totalDue ? " r" : ""}">${sar(totalDue)}</div><div class="l">المتأخرات القائمة (ريال)</div></div>
</div>

${totalDue > 0 || expiring > 0 ? `<div class="note">${[
    late ? `${late} ${late === 1 ? "وحدة متأخرة" : "وحدات متأخرة"} بإجمالي ${sar(totalDue)} ريال` : "",
    expiring ? `${expiring} ${expiring === 1 ? "عقد ينتهي" : "عقود تنتهي"} خلال 60 يومًا — قرار التجديد مطلوب` : "",
  ].filter(Boolean).join(" · ")}</div>` : ""}

<h2>حالة الوحدات في نهاية الفترة</h2>
<div class="scrollx"><table>
  <thead><tr><th>${ul}</th><th>المستأجر</th><th>الدفعة</th><th>الدورة</th><th>نهاية العقد</th><th>المتأخر</th><th>الحالة</th></tr></thead>
  <tbody>
    ${rows.map(({ t, st, vacant: vc }) => `<tr>
      <td>${t.unit || "—"}</td>
      <td>${vc ? "—" : t.name}</td>
      <td>${vc ? "—" : sar(splitVat(Number(t.rent_amount) || 0, v).total)}</td>
      <td>${vc ? "—" : freqLabel(t.payment_frequency)}</td>
      <td>${vc ? "—" : arDate(st.endDate)}</td>
      <td>${!vc && st.amountDue ? sar(st.amountDue) : "—"}</td>
      <td>${vc ? '<span class="pill u">شاغرة</span>'
          : st.status === "late" ? '<span class="pill l">متأخر</span>'
          : st.inGrace ? '<span class="pill u">فترة سماح</span>'
          : st.status === "soon" ? '<span class="pill u">يستحق قريبًا</span>'
          : '<span class="pill p">منتظم</span>'}</td>
    </tr>`).join("")}
  </tbody>
</table></div>

<h2>الدفعات المستلمة خلال الفترة (${payments.length})</h2>
${payments.length ? `<div class="scrollx"><table>
  <thead><tr><th>التاريخ</th><th>المستأجر</th><th>${ul}</th><th>المبلغ</th><th>الطريقة</th><th>ملاحظة</th></tr></thead>
  <tbody>
    ${payments.map((x) => `<tr>
      <td>${arDate(x.paid_on)}</td>
      <td>${x.tenant_name || "—"}</td>
      <td>${x.unit || "—"}</td>
      <td><b>${sar(x.amount)}</b></td>
      <td>${methodAr(x.method)}</td>
      <td>${x.note ? String(x.note) : "—"}</td>
    </tr>`).join("")}
    <tr><td colspan="3"><b>الإجمالي</b></td><td><b>${sar(collected)}</b></td><td colspan="2">—</td></tr>
  </tbody>
</table></div>` : `<div class="sub">لم تُسجَّل دفعات خلال هذه الفترة.</div>`}

<div class="note">تقرير استرشادي صادر آليًّا من سجل الدفعات وبيانات العقود المسجّلة في وثيق بتاريخ ${today()}. الأرقام تعكس ما وثّقه المكتب في النظام.</div>
<div class="sign"><div>إدارة الأملاك: ${who}<br><br>التوقيع: ________________</div><div>المالك: ____________________<br><br>تاريخ الإصدار: ${today()}</div></div>
${footer()}`;
  return SHELL(`تقرير المالك — ${p.name} — ${period.label}`, body, markOf(issuer));
}

// ============================================================
// سجل التزامات المكتب العقاري — نسخة مطبوعة لملف المكتب:
// رخصة فال · عقود الوساطة ونوافذ عمولتها · تراخيص الإعلانات،
// مع الحدود النظامية بصياغة استرشادية موحّدة (UI_LEGAL).
// ============================================================

const DEAL_AR: Record<string, string> = { sale: "بيع", rent: "إيجار" };
const phasePill = (tone: "ok" | "warn" | "bad" | "muted", label: string) =>
  `<span class="pill ${tone === "ok" ? "p" : tone === "bad" ? "l" : "u"}">${label}</span>`;

export function complianceRegisterHTML(items: ComplianceItem[], orgName: string, issuer: Issuer = {}) {
  const who = issuer.billing_name || orgName || "المكتب العقاري";
  const fal = items.filter((x) => x.kind === "fal_license");
  const bro = items.filter((x) => x.kind === "brokerage");
  const ads = items.filter((x) => x.kind === "ad_license");

  const falRows = fal.map((it) => {
    const st = complianceState(it);
    return `<tr>
      <td>${it.title}</td>
      <td>${it.ref_no || "—"}</td>
      <td>${arDate(it.start_date)}</td>
      <td>${arDate(st.endDate)}</td>
      <td>${phasePill(st.tone, st.label)}</td>
    </tr>`;
  }).join("");

  const broRows = bro.map((it) => {
    const st = complianceState(it);
    const be = brokerageEnd(it);
    const fee = expectedCommission(it);
    return `<tr>
      <td>${it.title}${it.exclusive ? ' <span class="pill u">حصري</span>' : ""}</td>
      <td>${it.party || "—"}</td>
      <td>${DEAL_AR[String(it.deal_type || "")] || "—"}</td>
      <td>${it.ref_no || "—"}</td>
      <td>${arDate(it.start_date)}</td>
      <td>${arDate(st.endDate)}${be.derived ? ' <span class="pill u">مستنتج 90 يومًا</span>' : ""}</td>
      <td>${st.windowEnd ? arDate(st.windowEnd) : "—"}</td>
      <td>${fee ? `${sar(fee)} <span style="font-size:.7rem;color:#5C6B67">(${Number(it.commission_pct) > 0 ? it.commission_pct : DEFAULT_COMMISSION_PCT}%)</span>` : "—"}</td>
      <td>${phasePill(st.tone, st.label)}</td>
    </tr>`;
  }).join("");

  const adRows = ads.map((it) => {
    const st = complianceState(it);
    return `<tr>
      <td>${it.title}</td>
      <td>${it.platform || "—"}</td>
      <td>${it.ref_no || "—"}</td>
      <td>${arDate(it.start_date)}</td>
      <td>${arDate(st.endDate)}</td>
      <td>${phasePill(st.tone, st.label)}</td>
    </tr>`;
  }).join("");

  const body = `
${header("سجل التزامات المكتب", who)}
<h1>سجل التزامات المكتب العقاري</h1>
<div class="sub">${who} · تاريخ الإصدار: ${arDate(today())} · ${items.length} بند</div>

<h2>🪪 رخصة فال</h2>
${fal.length ? `<div class="scrollx"><table>
  <thead><tr><th>الرخصة</th><th>رقمها</th><th>الإصدار</th><th>الانتهاء</th><th>الحالة</th></tr></thead>
  <tbody>${falRows}</tbody>
</table></div>` : `<div class="sub">لم تُسجَّل رخصة فال بعد — سجّلها ليصلك تنبيه قبل انتهائها بثلاثين يومًا.</div>`}

<h2>🤝 عقود الوساطة (${bro.length})</h2>
${bro.length ? `<div class="scrollx"><table>
  <thead><tr><th>العقد</th><th>المالك</th><th>النوع</th><th>رقم الإيداع</th><th>الإبرام</th><th>الانتهاء</th><th>نافذة العمولة حتى</th><th>العمولة المتوقعة</th><th>الحالة</th></tr></thead>
  <tbody>${broRows}</tbody>
</table></div>` : `<div class="sub">لا عقود وساطة مسجّلة.</div>`}

<h2>📢 تراخيص الإعلانات (${ads.length})</h2>
${ads.length ? `<div class="scrollx"><table>
  <thead><tr><th>الإعلان</th><th>المنصة</th><th>رقم الترخيص</th><th>البداية</th><th>الانتهاء</th><th>الحالة</th></tr></thead>
  <tbody>${adRows}</tbody>
</table></div>` : `<div class="sub">لا تراخيص إعلانات مسجّلة.</div>`}

<h2>الحدود النظامية — استرشاديًّا</h2>
<table>
  <tbody>
    ${UI_LEGAL.map((x) => `<tr><td style="width:90px"><b>${x.ref}</b></td><td>${x.text}</td></tr>`).join("")}
  </tbody>
</table>

<div class="note">${LEGAL_DISCLAIMER}</div>
<div class="sign"><div>أعدّه: ${who}<br><br>التوقيع: ________________</div><div>تاريخ الإصدار: ${today()}</div></div>
${footer()}`;
  return SHELL(`سجل التزامات المكتب — ${who}`, body, markOf(issuer));
}

// ============================================================
// سجل المعروضات — نسخة مطبوعة تحلّ محلّ الأوراق المتفرقة:
// كل معروض بكوده وحالته وسعر متره وتاريخ آخر تأكيد لتوفره.
// ============================================================

export function listingsRegisterHTML(items: Listing[], orgName: string, issuer: Issuer = {}) {
  const who = issuer.billing_name || orgName || "المكتب العقاري";
  const rows = sortListings(items || []);
  const s = summarize(rows);

  const line = (l: Listing) => {
    const meta = L_KIND[l.kind] || L_KIND.other;
    const st = STATUS_META[(l.status || "available") as keyof typeof STATUS_META] || STATUS_META.available;
    const fr = freshness(l);
    const ppm = pricePerMeter(l);
    return `<tr>
      <td><b>${l.code}</b></td>
      <td>${meta.icon} ${meta.label} — ${OFFER_LABEL[l.offer_type] || ""}</td>
      <td>${shortDesc(l)}${l.title ? `<div style="font-size:.72rem;color:#5C6B67">${l.title}</div>` : ""}</td>
      <td>${Number(l.price) > 0 ? sar(Number(l.price)) : "—"}</td>
      <td>${ppm ? sar(ppm) : "—"}</td>
      <td>${l.owner_name || "—"}${l.owner_phone ? `<div style="font-size:.72rem;color:#5C6B67">${l.owner_phone}</div>` : ""}</td>
      <td>${arDate(l.last_confirmed_at)}${fr.stale ? ' <span class="pill u">راجعه</span>' : ""}</td>
      <td><span class="pill ${st.tone === "ok" ? "p" : st.tone === "warn" ? "u" : "u"}">${st.label}</span></td>
    </tr>`;
  };

  const body = `
${header("سجل المعروضات", who)}
<h1>سجل المعروضات</h1>
<div class="sub">${who} · تاريخ الإصدار: ${arDate(today())} · ${s.total} معروض</div>

<div class="tot">
  <div><div class="v">${s.total}</div><div class="l">إجمالي المعروضات</div></div>
  <div><div class="v g">${s.available}</div><div class="l">متاح</div></div>
  <div><div class="v">${s.reserved}</div><div class="l">محجوز بعربون</div></div>
  <div><div class="v${s.stale ? " r" : ""}">${s.stale}</div><div class="l">يحتاج تأكيد توفر</div></div>
</div>

${s.stale > 0 ? `<div class="note">${s.stale} ${s.stale === 1 ? "معروض لم يُؤكَّد توفره" : "معروضًا لم تُؤكَّد توفراتها"} منذ ${STALE_DAYS} يومًا أو أكثر — تأكّد من المالك قبل عرضها على أي عميل.</div>` : ""}

<h2>المعروضات</h2>
${rows.length ? `<div class="scrollx"><table>
  <thead><tr><th>الكود</th><th>النوع</th><th>الوصف</th><th>السعر</th><th>سعر المتر</th><th>المالك</th><th>آخر تأكيد</th><th>الحالة</th></tr></thead>
  <tbody>${rows.map(line).join("")}</tbody>
</table></div>` : `<div class="sub">لا معروضات مسجّلة بعد.</div>`}

<div class="note">سجل داخلي للمكتب صادر آليًّا من وثيق بتاريخ ${today()}. الأسعار والحالات تعكس ما وثّقه المكتب، ولا يُعدّ هذا المستند عرضًا أو إعلانًا عقاريًّا.</div>
<div class="sign"><div>أعدّه: ${who}<br><br>التوقيع: ________________</div><div>تاريخ الإصدار: ${today()}</div></div>
${footer()}`;
  return SHELL(`سجل المعروضات — ${who}`, body, markOf(issuer));
}
