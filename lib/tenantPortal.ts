/**
 * وثيق — صفحة المستأجر الخاصة (/r/t/{token}): عرض HTML خالص (schema-v70).
 *
 * نفس إطار بوابة مالك الجمعية (lib/hoaPortal.ts): كل نص من القاعدة يمرّ على esc()،
 * والسكربت الوحيد يحمل nonce الاستجابة. الأرقام تُحسب بمحرّك العقود نفسه الذي
 * تستعمله لوحة المكتب وكشف الحساب (contractState + الضريبة) — لا حساب ثانٍ.
 */
import { esc, money, gDate, hDate, addDaysIso, methodAr, riyadhDay, frame, topBar } from "./hoaPortal";
import { REQUEST_CATEGORIES, TENANT_REQUEST_STATUS_AR, requestCatAr, requestLocAr } from "./hoaMoney";
import { contractState, splitVat, unitVatApplies, freqLabel } from "./contracts";
import { statusWindows } from "./contract-state";
import { visiblePayments } from "./documents";
import { unitLabel } from "./domain";
import { waNumber } from "./utils";

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

const FLASH: Record<string, [string, string]> = {
  claim_ok: ["f-ok", "وصل بلاغ الحوالة للمكتب. بعد مطابقتها مع الحساب البنكي تُسجَّل دفعتك وتظهر هنا."],
  claim_amount: ["f-err", "اكتب مبلغ الحوالة بالريال (أكبر من صفر)."],
  claim_date: ["f-err", "تاريخ الحوالة لا يكون في المستقبل ولا أقدم من 90 يومًا."],
  claim_ref: ["f-err", "رقم المرجع أو الملاحظة أطول من المسموح."],
  claim_many: ["f-warn", "لديك 3 حوالات بانتظار المراجعة — انتظر قرار المكتب ثم أبلغ عن غيرها."],
  claim_norent: ["f-warn", "قيمة الإيجار غير مسجّلة بعد — تواصل مع المكتب."],
  claim_err: ["f-err", "تعذّر إرسال بلاغ الحوالة الآن — أعد المحاولة بعد قليل."],
  req_ok: ["f-ok", "وصل طلب الصيانة للمكتب. تتابع حالته هنا."],
  req_bad: ["f-err", "اختر نوع المشكلة ومكانها ثم أعد الإرسال."],
  req_text: ["f-err", "اكتب وصف المشكلة (3 إلى 1000 حرف)."],
  req_many: ["f-warn", "لديك 5 طلبات مفتوحة — ينتظر بعضها الإنجاز قبل فتح طلب جديد."],
  req_err: ["f-err", "تعذّر إرسال الطلب الآن — أعد المحاولة بعد قليل."],
  inactive: ["f-warn", "استقبال البلاغات من هذه الصفحة متوقف مؤقتًا — تواصل مع المكتب مباشرة."],
};
export const TENANT_FLASH_CODES = new Set(Object.keys(FLASH));

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
function reqSteps(r: TenantPortalData["requests"][number]): string {
  const steps: { label: string; at: string; note: string | null; tone: string }[] = [
    { label: TENANT_REQUEST_STATUS_AR.new, at: r.created_at, note: null, tone: "#9A5B00" }];
  for (const x of r.log || []) {
    steps.push({ label: TENANT_REQUEST_STATUS_AR[x.to] || x.to, at: x.at, note: x.note || null,
      tone: x.to === "done" ? "#137A50" : x.to === "rejected" ? "#A5322C" : "#9A5B00" });
  }
  /* قبل أي سجل (أو صف قديم): آخر ردّ للمكتب كما كان */
  if (!(r.log || []).length && r.manager_note) steps.push({ label: "ردّ المكتب", at: r.updated_at, note: r.manager_note, tone: "#35514C" });
  return `<ol style="list-style:none;margin:8px 0 0;padding:0 12px 0 0;border-inline-start:2px solid #E4DDCD">${steps.map((x) => `
    <li style="position:relative;padding:3px 0 6px;font-size:13px">
      <span aria-hidden="true" style="position:absolute;inset-inline-start:-19px;top:9px;width:10px;height:10px;border-radius:99px;background:${x.tone}"></span>
      <b style="color:${x.tone}">${esc(x.label)}</b> <span class="muted">· ${gDate(riyadhDay(x.at))}</span>
      ${x.note ? `<div style="overflow-wrap:anywhere">${esc(x.note)}</div>` : ""}
    </li>`).join("")}</ol>`;
}

export function renderTenantPage(d: TenantPortalData, opts: { nonce: string; base: string; flash?: string | null }): string {
  const t = d.tenant, p = d.property, o = d.office || {};
  const base = opts.base;
  const ul = unitLabel(p.property_type);
  const f = tenantFigures(d);
  const st = f.st;
  const org = String(o.billing_name || o.org_name || "").trim();
  const wa = (() => { const n = waNumber(o.billing_phone || ""); return /^9665\d{8}$/.test(n) ? n : ""; })();
  const vatTag = f.v.enabled ? " (شاملة الضريبة)" : "";

  const flash = opts.flash && FLASH[opts.flash] ? `<div class="flash ${FLASH[opts.flash][0]}" role="status">${FLASH[opts.flash][1]}</div>` : "";
  const inactive = !d.active ? `<div class="flash f-warn">الصفحة للاطلاع فقط حاليًا — للحوالات والصيانة تواصل مع المكتب مباشرة${o.billing_phone ? ` على <span dir="ltr">${esc(o.billing_phone)}</span>` : ""}.</div>` : "";

  /* ١) الحالة — تُخفى كلها إن أخفاها المكتب لهذه الوحدة */
  const asOf = `<div class="muted" style="margin-top:6px">حسب سجل المكتب حتى ${gDate(d.today)}</div>`;
  const status = !d.show_balance ? "" : st.incomplete ? `
<section class="card"><h2>حالة حسابك</h2>
  <div class="muted">بيانات العقد غير مكتملة لدى المكتب بعد — تظهر حالتك هنا بعد استكمالها.</div>
</section>` : f.owed > 0 ? `
<section class="card st-late"><h2>حالة حسابك</h2>
  <div class="muted">المستحق عليك${vatTag}</div>
  <div><span class="big">${money(f.owed)}</span><span class="cur">ريال</span></div>
  ${st.unpaid > 0 ? `<div class="row"><span>دفعات متأخرة</span><b>${st.unpaid === 1 ? "دفعة واحدة" : st.unpaid === 2 ? "دفعتان" : `${st.unpaid} دفعات`}</b></div>` : ""}
  ${f.late > 0 && st.nextDueDate ? `<div class="row"><span>متأخر منذ</span><b>${gDate(st.nextDueDate)}</b></div>` : ""}
  ${f.partialIncl > 0 ? `<div class="row"><span>مدفوع جزئيًّا من الدفعة المستحقة</span><b>${money(f.partialIncl)} ريال</b></div>` : ""}
  ${f.carried > 0 ? `<div class="row"><span>دين مرحَّل من مدة سابقة</span><b>${money(f.carried)} ريال</b></div>` : ""}
  ${asOf}
</section>` : `
<section class="card st-clear"><h2>حالة حسابك</h2>
  <div class="big" style="font-size:22px;color:#137A50">لا متأخرات عليك ✓</div>
  ${f.partialIncl > 0 ? `<div class="row"><span>مدفوع مقدّمًا من الدفعة القادمة</span><b>${money(f.partialIncl)} ريال</b></div>` : ""}
  ${asOf}
</section>`;

  /* ٢) العقد والدفعة القادمة */
  const upcoming = st.vacant ? "—" : st.upcomingDate ? `${gDate(st.upcomingDate)}${hDate(st.upcomingDate) && t.calendar === "hijri" ? `<br><span class="muted">${esc(hDate(st.upcomingDate))}</span>` : ""}`
    : st.endDate ? `مع تجديد العقد` : "—";
  const contract = `
<section class="card"><h2>عقدك</h2>
  <div class="row"><span>${esc(ul)}</span><b>${esc(t.unit || "—")}</b></div>
  ${t.contract_no ? `<div class="row"><span>رقم العقد</span><b dir="ltr">${esc(t.contract_no)}</b></div>` : ""}
  <div class="row"><span>قيمة الدفعة${vatTag}</span><b>${money(f.rentIncl)} ريال</b></div>
  <div class="row"><span>دورة السداد</span><b>${esc(freqLabel(t.payment_frequency))}</b></div>
  <div class="row"><span>الدفعة القادمة</span><b style="text-align:left">${upcoming}</b></div>
  ${t.contract_start ? `<div class="row"><span>بداية العقد</span><b>${gDate(String(t.contract_start))}</b></div>` : ""}
  ${st.endDate ? `<div class="row"><span>نهاية العقد</span><b>${gDate(st.endDate)}</b></div>` : ""}
  ${d.show_balance ? `<div class="noprint" style="margin-top:10px"><a class="btn b-ghost" href="${base}/s">كشف الحساب (طباعة / PDF)</a></div>` : ""}
</section>`;

  /* ٣) «أرسلت الحوالة» — نص فقط */
  const claims = d.claims || [];
  const pendingN = claims.filter((c) => c.status === "pending").length;
  const minDay = addDaysIso(d.today, -90);
  const suggest = d.show_balance && f.owed > 0 ? f.owed : f.rentIncl;
  const claimForm = !d.active ? "" : pendingN >= 3 ? `<div class="flash f-warn">لديك 3 حوالات بانتظار المراجعة — انتظر قرار المكتب ثم أبلغ عن غيرها.</div>` : `
  <form method="post" action="${base}/claim" data-once="1" class="noprint">
    <label class="f" for="ca">المبلغ المحوَّل (ريال)</label>
    <input class="fld" id="ca" name="amount" required inputmode="decimal" autocomplete="off" dir="ltr"${suggest > 0 ? ` placeholder="${esc(String(suggest))}"` : ""}>
    <label class="f" for="cd">تاريخ الحوالة</label>
    <input class="fld" id="cd" name="transfer_date" type="date" required value="${esc(d.today)}" min="${esc(minDay)}" max="${esc(d.today)}">
    <label class="f" for="cr">رقم المرجع في البنك (اختياري)</label>
    <input class="fld" id="cr" name="bank_ref" maxlength="80" dir="ltr" autocomplete="off">
    <label class="f" for="cn">ملاحظة (اختياري)</label>
    <input class="fld" id="cn" name="note" maxlength="300" placeholder="مثال: إيجار شهر أكتوبر">
    <button class="btn b-gold" type="submit" style="width:100%;margin-top:12px">أرسل بلاغ الحوالة</button>
  </form>`;
  const claimBox = !d.active && !claims.length ? "" : `
<section class="card" id="claim"><h2>أرسلت الحوالة؟</h2>
  ${d.active ? `<div class="muted">أبلغ المكتب بحوالتك ليطابقها مع الحساب البنكي ثم يسجّل دفعتك. لا تحتاج صورة.</div>` : ""}
  ${claimForm}
  ${wa && d.active ? `<div class="muted noprint" style="margin-top:8px">أو <a href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(`السلام عليكم، أرسلت حوالة إيجار ${ul} (${t.unit || "—"}) في ${p.name} — مرفق صورة الإيصال. ${t.name}`)}" target="_blank" rel="noopener noreferrer">أرسل صورة الإيصال واتساب</a></div>` : ""}
  ${claims.length ? `<div style="margin-top:12px">${claims.map((c) => `<div class="item"><div class="h">
    <div><b>${money(c.amount)} ريال</b><div class="muted">حوالة ${gDate(c.transfer_date)}${c.bank_ref ? ` · مرجع <span dir="ltr">${esc(c.bank_ref)}</span>` : ""}</div></div>
    ${c.status === "approved" ? `<span class="chip c-ok">سُجّلت ✓</span>` : c.status === "rejected" ? `<span class="chip c-no">رُفضت</span>` : `<span class="chip c-wait">بانتظار المراجعة</span>`}</div>
    ${c.status === "rejected" && c.reject_reason ? `<div class="muted" style="color:#8F2B26">سبب الرفض: ${esc(c.reject_reason)}</div>` : ""}
  </div>`).join("")}</div>` : ""}
</section>`;

  /* ٤) سجل الدفعات (المدة الحالية) — الدفعة المعكوسة وعكسها يسقطان معًا */
  const shown = visiblePayments((d.payments || []) as any[]).filter((x: any) => !x._adjust).reverse();
  const pays = `
<section class="card"><h2>دفعاتك المسجّلة</h2>
  ${shown.length ? shown.map((x: any) => `<div class="row">
    <div><b>${money(f.v.enabled && !f.v.inclusive ? splitVat(Number(x.amount) || 0, f.v).total : Number(x.amount))} ريال</b>
      <div class="muted">${gDate(x.paid_on)} · ${methodAr(x.method)}${x.applies_to === "carried" ? " · سداد دين مرحَّل" : ""}</div></div>
    ${x.reference ? `<span class="muted" dir="ltr" style="align-self:center">${esc(x.reference)}</span>` : ""}
  </div>`).join("") : `<div class="muted">لا دفعات مسجّلة في هذا العقد بعد.</div>`}
</section>`;

  /* ٥) طلبات الصيانة — نص فقط */
  const reqs = d.requests || [];
  const openReqs = reqs.filter((r) => r.status === "new" || r.status === "in_progress").length;
  const reqForm = !d.active ? "" : openReqs >= 5 ? `<div class="flash f-warn">لديك 5 طلبات مفتوحة — ينتظر بعضها الإنجاز قبل فتح طلب جديد.</div>` : `
  <details class="more noprint"${reqs.length ? "" : " open"} style="margin-top:10px"><summary>+ طلب صيانة جديد</summary>
  <form method="post" action="${base}/request" data-once="1">
    <label class="f" for="rc">نوع المشكلة</label>
    <select class="fld" id="rc" name="category" required>${REQUEST_CATEGORIES.map((c) => `<option value="${esc(c.v)}">${esc(c.l)}</option>`).join("")}</select>
    <div class="f">مكانها</div>
    <div class="radio"><label><input type="radio" name="location" value="unit" checked> داخل ${esc(ul)}</label><label><input type="radio" name="location" value="common"> الأجزاء المشتركة</label></div>
    <label class="f" for="rd">الوصف</label>
    <textarea class="fld" id="rd" name="description" rows="3" required minlength="3" maxlength="1000" placeholder="مثال: تسريب مياه تحت مغسلة المطبخ"></textarea>
    <button class="btn b-deep" type="submit" style="width:100%;margin-top:12px">أرسل الطلب</button>
  </form></details>`;
  const reqBox = !d.active && !reqs.length ? "" : `
<section class="card" id="req"><h2>طلبات الصيانة</h2>
  ${reqs.length ? reqs.map((r) => `<div class="item"><div class="h">
    <div style="min-width:0"><b>${esc(requestCatAr(r.category))}</b> <span class="muted">· ${esc(r.location === "unit" ? `داخل ${ul}` : requestLocAr(r.location))}</span></div>
    <span class="chip ${r.status === "done" ? "c-ok" : r.status === "rejected" ? "c-no" : "c-wait"}">${esc(TENANT_REQUEST_STATUS_AR[r.status] || r.status)}</span></div>
    <div style="overflow-wrap:anywhere;margin-top:4px">${esc(r.description)}</div>
    ${reqSteps(r)}
  </div>`).join("") : `<div class="muted">لا طلبات بعد. أبلغ عن أي عطل من هنا.</div>`}
  ${reqForm}
</section>`;

  const foot = `<div class="foot">هذه الصفحة خاصة بك وحدك — لا تشارك رابطها.<br>أي ملاحظة على الأرقام؟ تواصل مع ${org ? esc(org) : "المكتب"}${o.billing_phone ? ` (<span dir="ltr">${esc(o.billing_phone)}</span>)` : ""}.<br>عبر منصة وثيق</div>`;

  return frame(`${p.name} — صفحة المستأجر`,
    topBar(org || null, p.name, `${esc(t.name)}${t.unit ? ` · ${esc(ul)} ${esc(t.unit)}` : ""}`, "صفحة المستأجر"),
    flash + inactive + status + contract + claimBox + pays + reqBox + foot, opts.nonce,
    /* منع الإرسال المزدوج — السكربت الوحيد ويحمل nonce الاستجابة */
    `(function(){document.querySelectorAll('form[data-once]').forEach(function(f){f.addEventListener('submit',function(e){if(f.dataset.s){e.preventDefault();return;}f.dataset.s='1';setTimeout(function(){f.querySelectorAll('button').forEach(function(x){x.disabled=true;});},0);});});})();`);
}

export function renderTenantDeny(msg = "هذا الرابط غير متاح"): string {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>وثيق</title></head>
<body style="margin:0;font-family:Tahoma,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;background:#F4F1EA;color:#0B211F">
<div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:2rem">🔒</div>
<h1 style="font-size:1.1rem">${esc(msg)}</h1>
<p style="font-size:.9rem;color:#5C6B67">قد يكون الرابط قديمًا أو أُلغي. اطلب من مكتب إدارة الأملاك رابطًا جديدًا عبر واتساب.</p></div></body></html>`;
}
