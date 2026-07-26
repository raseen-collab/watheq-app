import { contractState, buildSchedule, freqLabel, splitVat } from "./contracts";
import { unitLabel, typeLabel } from "./domain";

const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const today = () => new Date().toISOString().slice(0, 10);

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

type Issuer = { billing_name?: string | null; vat_number?: string | null; cr_number?: string | null; billing_phone?: string | null };

const SHELL = (title: string, inner: string) => `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<title>${title}</title>
<style>
  @page{size:A4;margin:14mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif;color:#0B211F;line-height:1.7;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .hd{background:#0E3A37;color:#EAF1EE;padding:18px 22px;border-radius:12px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
  .hd .lg{display:flex;align-items:center;gap:11px}
  .seal{width:40px;height:40px;border-radius:10px;background:#0A2C2A;display:grid;place-items:center;color:#E7C877;font-weight:700;font-size:1.3rem;box-shadow:inset 0 0 0 2px rgba(231,200,119,.4)}
  .hd .t{font-weight:700;font-size:1.4rem}
  .hd .s{font-size:.75rem;color:#9FB8B3}
  .hd .meta{text-align:left;font-size:.8rem;color:#B9CCC7}
  .hd .meta b{color:#E7C877;display:block;font-size:1rem}
  h1{font-size:1.25rem;margin:22px 0 4px;color:#0E3A37}
  .sub{color:#5C6B67;font-size:.85rem;margin-bottom:16px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}
  .box{border:1px solid #E4DDCD;border-radius:10px;padding:12px 14px;background:#FBF8F1}
  .box h3{font-size:.78rem;color:#8a5a11;margin-bottom:7px;font-weight:700}
  .box .r{display:flex;justify-content:space-between;gap:10px;font-size:.84rem;padding:3px 0}
  .box .r span:first-child{color:#5C6B67}
  .box .r span:last-child{font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:.83rem;margin-bottom:16px}
  th{background:#F3EEE2;padding:8px 10px;text-align:right;font-weight:700;border-bottom:2px solid #E4DDCD;font-size:.78rem}
  td{padding:8px 10px;border-bottom:1px solid #EFE9DA}
  tr:last-child td{border-bottom:0}
  .pill{font-size:.72rem;font-weight:700;padding:3px 9px;border-radius:6px;display:inline-block}
  .pill.p{background:#E6F4EC;color:#137a50}
  .pill.l{background:#FBE9E7;color:#a5322c}
  .pill.u{background:#F3EEE2;color:#5C6B67}
  .tot{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
  .tot div{border:1px solid #E4DDCD;border-radius:10px;padding:11px;text-align:center;background:#FBF8F1}
  .tot .v{font-weight:700;font-size:1.15rem;color:#0E3A37}
  .tot .v.g{color:#1E9E6A}.tot .v.r{color:#D0453F}
  .tot .l{font-size:.7rem;color:#5C6B67;margin-top:3px}
  .due{background:#0E3A37;color:#EAF1EE;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px}
  .due .l{font-size:.85rem;color:#B9CCC7}
  .due .v{font-weight:700;font-size:1.7rem;color:#E7C877}
  .note{border-inline-start:3px solid #B8791F;background:#FBF1DF;padding:11px 14px;border-radius:8px;font-size:.78rem;color:#8a5a11;margin-bottom:14px}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:26px;font-size:.82rem}
  .sign div{border-top:1px solid #E4DDCD;padding-top:8px;color:#5C6B67}
  .ft{margin-top:22px;border-top:1px solid #E4DDCD;padding-top:12px;font-size:.68rem;color:#5C6B67;line-height:1.6;text-align:center}
  .noprint{margin:18px 0;display:flex;gap:8px;justify-content:center}
  .noprint button{font-family:inherit;font-weight:600;font-size:.9rem;padding:10px 20px;border-radius:9px;border:0;cursor:pointer}
  .noprint .a{background:#0E3A37;color:#F6F1E4}
  .noprint .b{background:#fff;color:#0E3A37;border:1px solid #E4DDCD}
  @media print{.noprint{display:none}}
</style></head><body>
<div class="noprint"><button class="a" onclick="window.print()">🖨️ طباعة / حفظ PDF</button><button class="b" onclick="window.close()">إغلاق</button></div>
${inner}
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
  <div class="meta">${docTitle}<b>${docNo}</b>التاريخ: ${today()}</div>
</div>`;

const footer = () => `
<div class="ft">
  صدر هذا المستند عبر منصة وثيق — أداة تنظيمية لإدارة الأملاك.<br>
  وثيق لا يقدّم خدمات قانونية أو محاسبية، ولا يستلم أو يحوّل أي مبالغ. هذا المستند للاستخدام الإداري بين الطرفين، ومسؤولية اعتماده على مُصدِره.<br>
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
    <div class="r"><span>بداية العقد</span><span>${t.contract_start || "—"}</span></div>
    <div class="r"><span>نهاية العقد</span><span>${st.endDate || "—"}</span></div>
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
    <div class="r"><span>الدفعة القادمة</span><span>${st.nextDueDate || "—"}</span></div>
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
      <td>${r.n}</td><td>${r.date}</td>
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
  return SHELL(`كشف حساب — ${t.name}`, body);
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
  return SHELL(`فاتورة ${inv.invoice_no} — ${t.name}`, body);
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
      <td>${st.nextDueDate || "—"}</td>
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
  return SHELL(`كشف حساب — ${p.name}`, body);
}

/** فتح المستند في نافذة جديدة للطباعة */
export function openDoc(html: string) {
  const w = window.open("", "_blank");
  if (!w) { alert("فضلًا اسمح بالنوافذ المنبثقة لعرض المستند."); return; }
  w.document.write(html);
  w.document.close();
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
  return SHELL(`كشف حساب — ${o.name}`, body);
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
  return SHELL(`كشف حساب — ${a.name}`, body);
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
<div class="tot">
  <div><div class="v">${units || "—"}</div><div class="l">عدد الوحدات</div></div>
  <div><div class="v">${sar(perUnitYear)}</div><div class="l">سنويًّا لكل وحدة (ريال)</div></div>
  <div><div class="v">${sar(perUnitMonth)}</div><div class="l">شهريًّا لكل وحدة (ريال)</div></div>
  <div><div class="v ${gap > 0 ? "r" : "g"}">${sar(Math.abs(gap))}</div><div class="l">${gap > 0 ? "عجز متوقّع (ريال)" : "فائض متوقّع (ريال)"}</div></div>
</div>

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
  return SHELL(`الموازنة التقديرية ${budget.year} — ${a.name}`, body);
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
  return SHELL(`محضر تأسيسي — ${a.name}`, body);
}
