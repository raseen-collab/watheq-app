"use client";
// ============================================================
// وثيق — تصدير كل بيانات الحساب إلى Excel
//
// المبدأ: البيانات ملك المكتب لا ملك وثيق. من قرر المغادرة يأخذ كل
// شيء بضغطة، بصيغة يفتحها ويعمل عليها بلا وثيق — ومن قرر العودة
// يعيد رفع ورقة «قالب الرفع» كما هي.
//
// يعمل في المتصفح بالكامل: يقرأ عبر سياسات الأمان نفسها (المالك يرى
// حسابه، الموظف يرى مكتبه)، يجلب على دفعات 1000 حتى لا يُقصّ شيء،
// ويبني الملف بـ SheetJS الموجودة أصلًا لقراءة ملفات الرفع.
// ============================================================

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { getOffice } from "@/lib/office";

const FREQ_AR: Record<string, string> = {
  daily: "يومي", weekly: "اسبوعي", monthly: "شهري", quarterly: "كل 3 اشهر",
  semiannual: "نصف سنوي", annual: "سنوي", yearly: "سنوي",
};
const METHOD_AR: Record<string, string> = { cash: "نقدًا", transfer: "تحويل بنكي", card: "بطاقة", other: "أخرى" };
const STATUS_AR: Record<string, string> = { active: "نشط", notice: "إشعار إخلاء", vacated: "مُخلاة", litigation: "في التنفيذ" };

export default function ExportData() {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  /**
   * التصدير يُخرج المحفظة كاملة: أسماء المستأجرين وجوالاتهم وهوياتهم وكل
   * الدفعات. حقٌّ لصاحب المكتب ومديره — لا لمحصّل قد يغادر غدًا ومعه الملف.
   */
  const [allowed, setAllowed] = useState(true);
  useEffect(() => { getOffice(supabase).then((o) => setAllowed(!o || o.isOwner || o.role === "manager")); }, [supabase]);

  /** Supabase يقصّ عند 1000 صف بصمت — نجلب حتى ينتهي الجدول فعلًا */
  async function all(table: string, select = "*", order = "created_at"): Promise<any[]> {
    const out: any[] = [];
    for (let i = 0; ; i += 1000) {
      const { data, error } = await supabase.from(table).select(select).order(order, { ascending: true }).range(i, i + 999);
      if (error) { if (out.length === 0 && /does not exist|relation/.test(error.message)) return []; throw new Error(`${table}: ${error.message}`); }
      out.push(...(data || []));
      if (!data || data.length < 1000 || out.length > 200000) break;
    }
    return out;
  }

  async function exportAll() {
    setBusy(true); setMsg(null);
    try {
      const XLSX = await import("xlsx");
      const [props, tenants, payments, expenses, notes, listings, requests, compliance, assocs, owners] = await Promise.all([
        all("properties"), all("tenants"), all("payments", "*", "paid_on"), all("expenses", "*", "spent_on"),
        all("property_notes", "*", "note_date"), all("listings"), all("seeker_requests"), all("compliance_items"),
        all("associations").catch(() => []), all("owners").catch(() => []),
      ]);
      const invoices = await all("invoices").catch(() => []);
      const pName: Record<string, string> = {}; props.forEach((p) => { pName[p.id] = p.name; });
      const tById: Record<string, any> = {}; tenants.forEach((t) => { tById[t.id] = t; });

      const wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      const add = (name: string, rows: Record<string, any>[], widths?: number[]) => {
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "—": "لا بيانات" }]);
        if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
        XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
      };

      // 1) ورقة تُعاد إلى وثيق كما هي — بنفس أعمدة قالب الرفع وترتيبها
      add("قالب الرفع", tenants.map((t) => ({
        "اسم المستأجر": t.name, "رقم الوحدة": t.unit || "", "قيمة الدفعة": t.rent_amount,
        "دورة السداد": FREQ_AR[t.payment_frequency] || t.payment_frequency || "شهري",
        "بداية العقد": t.contract_start || "", "عدد الدفعات": t.contract_periods || "",
        "الجوال": t.phone || "", "رقم الهوية": t.national_id || "",
        "الدفعات المسدّدة": t.paid_periods || 0, "العقار": pName[t.property_id] || "",
        "رقم العقد": t.contract_no || "",
        "حساب الكهرباء": t.elec_account || "", "حساب الماء": t.water_account || "",
      })), [22, 12, 12, 12, 12, 10, 14, 14, 12, 22, 16, 14, 14]);

      add("العقارات", props.map((p) => ({
        "العقار": p.name, "النوع": p.property_type || "", "المدينة": p.city || "", "الحي/العنوان": p.address || "",
        "المالك": p.owner_name || "", "المدير/المكتب": p.manager || "", "فترة السماح (أيام)": p.grace_days || 0,
        "أتعاب الإدارة %": p.mgmt_fee_pct || "", "ضريبة مفعّلة": p.vat_enabled ? "نعم" : "لا",
        "عدد الوحدات": tenants.filter((t) => t.property_id === p.id).length,
      })), [24, 12, 12, 20, 18, 18, 10, 10, 10, 10]);

      add("الوحدات والمستأجرون", tenants.map((t) => ({
        "العقار": pName[t.property_id] || "", "الوحدة": t.unit || "", "المستأجر": t.name, "رقم العقد": t.contract_no || "", "الجوال": t.phone || "",
        "رقم الهوية": t.national_id || "", "قيمة الدفعة": t.rent_amount, "الدورة": FREQ_AR[t.payment_frequency] || "",
        "بداية العقد": t.contract_start || "", "نهاية العقد": t.contract_end || "", "عدد الدفعات": t.contract_periods || "",
        "المسدَّد (دفعات)": t.paid_periods || 0, "مبلغ جزئي": t.partial_amount || 0, "الحالة": STATUS_AR[t.status] || t.status || "نشط",
        "تاريخ الإخلاء": t.move_out_date || "", "التأمين": t.deposit_amount || "", "خصومات التأمين": t.deposit_deductions || "",
        "حساب الكهرباء": t.elec_account || "", "حساب الماء": t.water_account || "",
        "قراءة كهرباء (تسليم)": t.meter_elec_in || "", "قراءة كهرباء (إخلاء)": t.meter_elec_out || "",
        "قراءة ماء (تسليم)": t.meter_water_in || "", "قراءة ماء (إخلاء)": t.meter_water_out || "",
      })), [22, 10, 22, 14, 14, 12, 10, 12, 12, 10, 10, 10, 12, 12, 10, 12, 14, 14, 12, 12, 12, 12]);

      add("الدفعات", payments.map((x) => ({
        "التاريخ": x.paid_on, "العقار": pName[x.property_id] || pName[tById[x.tenant_id]?.property_id] || "",
        "الوحدة": tById[x.tenant_id]?.unit || "", "المستأجر": tById[x.tenant_id]?.name || "",
        "المبلغ": x.amount, "الطريقة": METHOD_AR[x.method] || x.method || "", "الدفعات المغطاة": x.periods_covered || "",
        "ملاحظة": x.note || "",
      })), [12, 22, 10, 22, 12, 12, 10, 24]);

      add("الفواتير", invoices.map((x) => ({
        "رقم الفاتورة": x.invoice_no, "التاريخ": (x.created_at || "").slice(0, 10), "العقار": pName[x.property_id] || "",
        "المستأجر": tById[x.tenant_id]?.name || "", "الوحدة": tById[x.tenant_id]?.unit || "",
        "الفترة": x.period_label || "", "المبلغ": x.amount, "الاستحقاق": x.due_date || "",
      })), [16, 12, 22, 22, 10, 16, 12, 12]);

      add("المصروفات", expenses.map((x) => ({
        "التاريخ": x.spent_on, "العقار": pName[x.property_id] || "", "الوحدة": x.unit || "",
        "التصنيف": x.category || "", "المبلغ": x.amount, "ملاحظة": x.note || "",
      })), [12, 22, 10, 14, 12, 30]);

      add("سجل العقار", notes.map((n) => ({
        "التاريخ": n.note_date, "العقار": pName[n.property_id] || "", "الملاحظة": n.text,
      })), [12, 22, 60]);

      add("المعروضات", listings.map((l) => ({
        "الكود": l.code, "النوع": l.kind, "العرض": l.offer_type, "المدينة": l.city || "", "الحي": l.district || "",
        "المساحة": l.area || "", "السعر": l.price || "", "الحالة": l.status || "", "المالك": l.owner_name || "",
        "جوال المالك": l.owner_phone || "", "ملاحظة": l.note || "",
      })), [10, 10, 10, 12, 14, 10, 12, 12, 18, 14, 30]);

      add("طلبات الباحثين", requests.map((r) => ({
        "الاسم": r.seeker_name || "", "الجوال": r.seeker_phone || "", "يبحث عن": r.kind || "", "العرض": r.offer_type || "",
        "المدينة": r.city || "", "الأحياء": r.districts || "", "السعر الأقصى": r.price_max || "",
        "المساحة من": r.area_min || "", "إلى": r.area_max || "", "الحالة": r.status || "", "ملاحظة": r.note || "",
      })), [18, 14, 10, 10, 12, 20, 12, 10, 10, 10, 30]);

      add("التزامات المكتب", compliance.map((c) => ({
        "النوع": c.kind, "العنوان": c.title, "الرقم المرجعي": c.ref_no || "", "البداية": c.start_date || "",
        "الانتهاء": c.end_date || "", "الحالة": c.status || "", "ملاحظة": c.note || "",
      })), [12, 26, 16, 12, 12, 10, 30]);

      if (assocs.length) {
        const aName: Record<string, string> = {}; assocs.forEach((a) => { aName[a.id] = a.name; });
        add("جمعيات الملاك", assocs.map((a) => ({ "الجمعية": a.name, "المدينة": a.city || "", "الاشتراك الشهري": a.monthly_fee || "", "عدد الملاك": owners.filter((o) => o.association_id === a.id).length })));
        add("ملاك الجمعيات", owners.map((o) => ({ "الجمعية": aName[o.association_id] || "", "المالك": o.name, "الوحدة": o.unit || "", "الجوال": o.phone || "", "الحالة": o.status || "", "المسدَّد": o.paid_periods || 0 })));
      }

      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ["نسخة كاملة من بيانات حسابك في وثيق"],
        [`تاريخ التصدير: ${new Date().toLocaleDateString("ar-SA")}`],
        [""],
        ["ورقة «قالب الرفع» بنفس أعمدة قالب الرفع في وثيق — لو رجعت يومًا، ارفعها كما هي من صفحة «رفع Excel» وتعود كل وحداتك بعقودها ودفعاتها المسدّدة."],
        ["بقية الأوراق للعمل خارج وثيق: كل جدول بأسماء أعمدة عربية واضحة، بلا أكواد داخلية."],
        ["البيانات ملكك. وثيق لا يحتفظ بحق عليها ولا يقيّد نقلها."],
      ]), "اقرأني");

      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `watheq-export-${stamp}.xlsx`);
      setMsg(`✓ صُدّر: ${props.length} عقار · ${tenants.length} وحدة · ${payments.length} دفعة · ${expenses.length} مصروف.`);
    } catch (e: any) {
      setMsg(`تعذّر التصدير: ${e?.message || e}`);
    } finally { setBusy(false); }
  }

  if (!allowed) return (
    <div className="bg-white border border-line rounded-2xl p-5 text-sm text-muted">
      📦 تصدير بيانات المكتب متاح لصاحب المكتب ومديره.
    </div>
  );

  return (
    <div className="bg-white border border-line rounded-2xl p-5">
      <h3 className="font-display font-bold text-deep text-lg mb-1">📦 تصدير بياناتي</h3>
      <p className="text-xs text-muted mb-4 leading-relaxed">
        ملف Excel واحد فيه كل شيء: العقارات، الوحدات والعقود، الدفعات، المصروفات، السجل، المعروضات، الالتزامات.
        بياناتك ملكك — تأخذها كاملة متى شئت، وتعيد رفعها كما هي إن عدت.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-gold" onClick={exportAll} disabled={busy}>
          {busy ? "جارٍ التجهيز…" : "⬇ تصدير كل البيانات (Excel)"}
        </button>
        {msg && <span className={`text-sm ${msg.startsWith("✓") ? "text-[#137a50]" : "text-late"}`}>{msg}</span>}
      </div>
    </div>
  );
}
