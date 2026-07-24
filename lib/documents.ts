import { contractState, buildSchedule, freqLabel } from "./contracts";
import { unitLabel, typeLabel } from "./domain";

const sar = (n: number) => (Number(n) || 0).toLocaleString("en-US");
const today = () => new Date().toISOString().slice(0, 10);

type Tenant = {
  id: string; name: string; unit: string | null; phone: string | null; national_id: string | null;
  rent_amount: number; contract_start: string | null; contract_end: string | null;
  payment_frequency: string | null; paid_periods: number | null; contract_periods: number | null;
};
type Property = { name: string; address: string | null; city: string | null; manager: string | null; property_type: string | null };
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
export function statementHTML(t: Tenant, p: Property, issuer: Issuer = {}) {
  const st = contractState(t);
  const rows = buildSchedule(t);
  const ul = unitLabel(p.property_type);
  const who = issuer.billing_name || p.manager || "إدارة الأملاك";
  const totalContract = (Number(t.rent_amount) || 0) * rows.length;
  const totalPaid = st.paid * (Number(t.rent_amount) || 0);

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
    <div class="r"><span>قيمة الدفعة</span><span>${sar(t.rent_amount)} ريال</span></div>
  </div>
  <div class="box">
    <h3>ملخّص مالي</h3>
    <div class="r"><span>إجمالي قيمة العقد</span><span>${sar(totalContract)} ريال</span></div>
    <div class="r"><span>المسدَّد</span><span>${sar(totalPaid)} ريال</span></div>
    <div class="r"><span>المتأخر</span><span>${sar(st.amountDue)} ريال</span></div>
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
  <thead><tr><th>#</th><th>تاريخ الاستحقاق</th><th>المبلغ (ريال)</th><th>الحالة</th></tr></thead>
  <tbody>
    ${rows.map((r) => `<tr>
      <td>${r.n}</td><td>${r.date}</td><td>${sar(r.amount)}</td>
      <td>${r.status === "paid" ? '<span class="pill p">مسدّدة</span>'
          : r.status === "late" ? '<span class="pill l">متأخرة</span>'
          : '<span class="pill u">قادمة</span>'}</td>
    </tr>`).join("")}
  </tbody>
</table>

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
  const body = `
${header("فاتورة", inv.invoice_no)}
<h1>فاتورة أجرة</h1>
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
  <thead><tr><th>البيان</th><th>الفترة</th><th>تاريخ الاستحقاق</th><th>المبلغ (ريال)</th></tr></thead>
  <tbody>
    <tr>
      <td>أجرة ${ul} رقم (${t.unit || "—"}) بعقار ${p.name}</td>
      <td>${inv.period_label}</td>
      <td>${inv.due_date}</td>
      <td>${sar(inv.amount)}</td>
    </tr>
  </tbody>
</table>

<div class="due"><span class="l">الإجمالي المستحق</span><span class="v">${sar(inv.amount)} ريال</span></div>

<div class="note">
  فاتورة إدارية صادرة عن المؤجّر لغرض التوثيق بين الطرفين. السداد يتم مباشرةً للمؤجّر بالوسيلة المتفق عليها —
  منصة وثيق لا تستلم ولا تحوّل أي مبالغ.
</div>

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
  const rows = p.tenants.map((t) => ({ t, st: contractState(t) }));
  const totalDue = rows.reduce((s, r) => s + r.st.amountDue, 0);
  const totalPaid = rows.reduce((s, r) => s + r.st.paid * (Number(r.t.rent_amount) || 0), 0);
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

${totalDue > 0 ? `<div class="due"><span class="l">إجمالي المستحق على العقار</span><span class="v">${sar(totalDue)} ريال</span></div>` : ""}

<table>
  <thead><tr><th>${ul}</th><th>المستأجر</th><th>الدفعة</th><th>الدورة</th><th>القادمة</th><th>المتأخر</th><th>الحالة</th></tr></thead>
  <tbody>
    ${rows.map(({ t, st }) => `<tr>
      <td>${t.unit || "—"}</td>
      <td>${t.name}</td>
      <td>${sar(t.rent_amount)}</td>
      <td>${freqLabel(t.payment_frequency)}</td>
      <td>${st.nextDueDate || "—"}</td>
      <td>${st.amountDue ? sar(st.amountDue) : "—"}</td>
      <td>${st.status === "late" ? '<span class="pill l">متأخر</span>'
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
