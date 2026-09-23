"use client";
import { today } from "@/lib/utils";
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

const UNIT_AR: Record<string, string> = { apartment: "شقة", annex: "شقة ملحق", studio: "استديو", room: "غرفة", shop: "محل", office: "مكتب", warehouse: "مستودع", land: "أرض", villa: "فيلا", other: "أخرى" };

const FREQ_AR: Record<string, string> = {
  daily: "يومي", weekly: "اسبوعي", monthly: "شهري", quarterly: "كل 3 اشهر", trimester: "كل 4 اشهر",
  semiannual: "نصف سنوي", annual: "سنوي", yearly: "سنوي",
};
const METHOD_AR: Record<string, string> = { cash: "نقدًا", transfer: "تحويل بنكي", card: "بطاقة", other: "أخرى" };
/* مسمّيات عربية للحقول المضافة — الملف يُقرأ بيد الإنسان لا بالكود */
const EXP_CAT_AR: Record<string, string> = {
  maintenance: "صيانة", utilities: "فواتير", cleaning: "نظافة",
  government: "رسوم حكومية", security: "أمن", insurance: "تأمين", other: "أخرى",
};
const PAID_BY_AR: Record<string, string> = {
  collections: "من التحصيل", office: "المكتب", owner: "المالك",
};
const DEBT_ST_AR: Record<string, string> = {
  open: "مفتوح", promised: "وعد بالسداد", settled: "سُوّي", written_off: "شُطب", legal: "أُحيل للتنفيذ",
};
const NOTE_KIND_AR: Record<string, string> = {
  maintenance: "صيانة", government: "حكومي", financial: "مالي",
  contract: "عقود", other: "أخرى",
};

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
  useEffect(() => { getOffice(supabase).then((o) => setAllowed(!o || o.isOwner || o.perms?.export_data !== false)); }, [supabase]);

  /** Supabase يقصّ عند 1000 صف بصمت — نجلب حتى ينتهي الجدول فعلًا */
  async function all(table: string, select = "*", order = "created_at"): Promise<any[]> {
    const out: any[] = [];
    for (let i = 0; ; i += 1000) {
      /* ترتيب ثانوي بالمعرّف: صفّان بوقت إنشاء واحد عند حدّ صفحة قد يتكرر أحدهما أو يسقط */
      const { data, error } = await supabase.from(table).select(select).order(order, { ascending: true }).order("id", { ascending: true }).range(i, i + 999);
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
      /* أرشيف المستأجرين السابقين (v45) — قبل الترحيل لا جدول */
      const past = await all("past_tenancies", "*", "archived_at").catch(() => []);
      /* سجلّ التصحيحات (v43): كل شطب وتنازل وتصحيح عدّاد — بدونه يختفي دينٌ شُطب
         من النسخة الاحتياطية بلا أثر يشرح أين ذهب */
      const adjustments = await all("ledger_adjustments", "*", "created_at").catch(() => []);
      const assocNotes = await all("association_notes").catch(() => []);
      const pastById: Record<string, any> = {}; past.forEach((x: any) => { pastById[x.id] = x; });
      const invoiceHolder = (inv: any) => past
        .filter((a: any) => a.unit_row_id && a.unit_row_id === inv.tenant_id && String(a.archived_at || "") > String(inv.created_at || ""))
        .sort((a: any, b: any) => String(a.archived_at).localeCompare(String(b.archived_at)))[0] || null;
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
        "نوع الوحدة": UNIT_AR[t.unit_type] || "",
        "الغرف": t.rooms ?? "", "دورات المياه": t.baths ?? "", "المكيفات": t.acs ?? "", "أول استحقاق": t.first_due || "", "الضريبة": t.vat_mode === "on" ? "تُطبَّق" : t.vat_mode === "off" ? "معفاة" : "تلقائي",
        "حساب الكهرباء": t.elec_account || "", "حساب الماء": t.water_account || "",
        /* الأعمدة الثلاثة الأخيرة تُكمل تطابق ورقة «قالب الرفع» مع القالب
           الرسمي: من صدّر بياناته ثم أعاد رفعها كان يفقد التقويم والدين
           المرحَّل — أي تعود عقوده الهجرية ميلادية وتختفي ديون سابقة. */
        "التقويم": t.calendar === "hijri" ? "هجري" : "ميلادي",
        "مدة العقد (أشهر)": "",
        "دين مرحَّل": Number(t.carried_debt) || 0,
      })), [22, 12, 12, 12, 12, 10, 14, 14, 12, 22, 16, 12, 8, 10, 10, 12, 10, 14, 14, 12, 16, 12]);

      add("العقارات", props.map((p) => ({
        "العقار": p.name, "النوع": p.property_type || "", "المدينة": p.city || "", "الحي/العنوان": p.address || "",
        "المالك": p.owner_name || "", "المدير/المكتب": p.manager || "", "فترة السماح (أيام)": p.grace_days || 0,
        "أتعاب الإدارة %": p.mgmt_fee_pct || "", "ضريبة مفعّلة": p.vat_enabled ? "نعم" : "لا",
        "عدد الوحدات": tenants.filter((t) => t.property_id === p.id).length,
        "الاستخدام": ({ families: "سكني — عوائل", singles: "سكني — عزّاب", mixed: "سكني تجاري", commercial: "تجاري" } as any)[p.usage] || "",
        "نسبة الضريبة": p.vat_rate ?? "", "الضريبة شاملة": p.vat_inclusive === false ? "لا" : "نعم",
        "نافذة قريب (يوم)": p.soon_days ?? "", "نافذة مستحق (يوم)": p.imminent_days ?? "", "تنبيه انتهاء العقد (يوم)": p.expiring_days ?? "",
      })), [24, 12, 12, 20, 18, 18, 10, 10, 10, 10, 18, 10, 12, 14, 14, 18]);

      add("الوحدات والمستأجرون", tenants.map((t) => ({
        "العقار": pName[t.property_id] || "", "الوحدة": t.unit || "", "المستأجر": t.name, "رقم العقد": t.contract_no || "", "الجوال": t.phone || "",
        "رقم الهوية": t.national_id || "", "قيمة الدفعة": t.rent_amount, "الدورة": FREQ_AR[t.payment_frequency] || "",
        "بداية العقد": t.contract_start || "", "نهاية العقد": t.contract_end || "", "عدد الدفعات": t.contract_periods || "",
        "المسدَّد (دفعات)": t.paid_periods || 0, "مبلغ جزئي": t.partial_amount || 0, "الحالة": STATUS_AR[t.status] || t.status || "نشط",
        "تاريخ الإخلاء": t.move_out_date || "", "التأمين": t.deposit_amount || "", "خصومات التأمين": t.deposit_deductions || "",
        "حساب الكهرباء": t.elec_account || "", "حساب الماء": t.water_account || "",
        "قراءة كهرباء (تسليم)": t.meter_elec_in || "", "قراءة كهرباء (إخلاء)": t.meter_elec_out || "",
        "قراءة ماء (تسليم)": t.meter_water_in || "", "قراءة ماء (إخلاء)": t.meter_water_out || "",
        /* حقول أُضيفت بعد كتابة التصدير: بدونها يفقدها من صدّر بياناته
           للأرشفة أو للانتقال — والغرض من التصدير ألا يفقد شيئًا. */
        "التقويم": t.calendar === "hijri" ? "هجري" : "ميلادي",
        "أول استحقاق": t.first_due || "",
        "نوع الوحدة": UNIT_AR[t.unit_type] || "", "الغرف": t.rooms ?? "", "دورات المياه": t.baths ?? "", "المكيفات": t.acs ?? "",
        "الضريبة": t.vat_mode === "on" ? "تُطبَّق" : t.vat_mode === "off" ? "معفاة" : "تلقائي",
        "دين مرحَّل": Number(t.carried_debt) || 0, "سبب الدين المرحَّل": t.carried_debt_note || "",
        /* متابعة الدين (v36): بلا حالته وتاريخه لا يستطيع المكتب استئناف المطالبة */
        "حالة الدين": DEBT_ST_AR[(t as any).debt_status] || "", "نشأ الدين": (t as any).debt_since || "", "آخر متابعة": (t as any).debt_note || "",
        "في التنفيذ": t.litigation ? "نعم" : "", "رقم طلب التنفيذ": t.enforcement_no || "",
        "ملاحظات التأمين": t.deposit_notes || "", "تاريخ الإشعار": t.notice_date || "",
      })), [22, 10, 22, 14, 14, 12, 10, 12, 12, 10, 10, 10, 12, 12, 10, 12, 14, 14, 12, 12, 12, 12, 10, 12, 14, 8, 10, 10, 10, 12, 20, 10, 14, 20, 12]);

      add("الدفعات", payments.map((x) => ({
        "التاريخ": x.paid_on, "العقار": pName[x.property_id] || pName[tById[x.tenant_id]?.property_id] || "",
        /* الساكن باسمه الحيّ؛ ودفعات من سبقه بالاسم المحفوظ فيها (v45) */
        "الوحدة": (x.tenant_id && tById[x.tenant_id]?.unit) || x.unit_label || "",
        "المستأجر": (x.tenant_id && tById[x.tenant_id]?.name) || x.payer_name || "",
        "تسدّد": ({ rent: "أقساط", carried: "دين مرحَّل", past_debt: "دين مستأجر سابق" } as any)[x.applies_to] || "أقساط",
        "المبلغ": x.amount, "الطريقة": METHOD_AR[x.method] || x.method || "", "الدفعات المغطاة": x.periods_covered || "",
        /* مرجع الحوالة يُطابق به المكتب كشف بنكه — وكان يسقط من التصدير */
        "مرجع الحوالة": x.reference || "", "ملاحظة": x.note || "",
      })), [12, 22, 10, 22, 14, 12, 12, 10, 14, 24]);

      add("المستأجرون السابقون", past.map((x: any) => ({
        "العقار": pName[x.property_id] || "", "الوحدة": x.unit || "", "المستأجر": x.name, "الجوال": x.phone || "",
        "الهوية": x.national_id || "", "تاريخ الأرشفة": String(x.archived_at || "").slice(0, 10),
        "الدين": Number(x.debt_amount) || 0, "المسدَّد منه": Number(x.debt_paid) || 0,
        "المتبقي": Math.max(0, (Number(x.debt_amount) || 0) - (Number(x.debt_paid) || 0)),
        "الحالة": ({ open: "مفتوح", promised: "وعد بالسداد", legal: "أُحيل للتنفيذ", settled: "سُوّي", written_off: "شُطب" } as any)[x.debt_status] || x.debt_status,
        "ملاحظة": x.debt_note || "",
      })));
      add("سجل التصحيحات", adjustments.map((x: any) => {
        const tn = x.tenant_id ? tById[x.tenant_id] : null;
        return {
          "التاريخ": String(x.created_at || "").slice(0, 10),
          "العقار": pName[x.property_id] || "", "الوحدة": tn?.unit || "",
          "النوع": ({ repair: "تصحيح/شطب", counter: "تعديل العدّاد", opening: "رصيد افتتاحي", renewal: "تجديد", relet: "إعادة تأجير" } as any)[x.kind] || x.kind || "",
          "المبلغ": Number(x.amount) || 0, "تغيّر العدّاد": Number(x.delta) || 0, "البيان": x.note || "",
        };
      }), [12, 22, 10, 16, 12, 12, 60]);

      add("الفواتير", invoices.map((x) => ({
        "رقم الفاتورة": x.invoice_no, "التاريخ": (x.created_at || "").slice(0, 10), "العقار": pName[x.property_id] || "",
        /* فاتورة صدرت قبل أرشفة مستأجرٍ من هذه الوحدة هي فاتورته هو — لا فاتورة
           الساكن الحالي (إعادة التأجير تُبقي صفّ الوحدة نفسه) */
        "المستأجر": invoiceHolder(x)?.name || tById[x.tenant_id]?.name || "",
        "الوحدة": invoiceHolder(x)?.unit || tById[x.tenant_id]?.unit || "",
        "الفترة": x.period_label || "", "المبلغ": x.amount, "الاستحقاق": x.due_date || "",
        "الحالة": x.status || "", "ملاحظات": x.notes || "",
      })), [16, 12, 22, 22, 10, 16, 12, 12, 12, 30]);

      /* المصروفات: «يُخصم من المالك» و«من دفعه» و«الحالة» هي جوهر التصنيف
         المالي — وبدونها لا يستطيع المكتب إعادة بناء صافي أي مالك من الملف. */
      add("المصروفات", expenses.map((x) => ({
        "التاريخ": x.spent_on, "العقار": pName[x.property_id] || "", "الوحدة": x.unit || "",
        "التصنيف": EXP_CAT_AR[x.category] || x.category || "", "المبلغ": x.amount,
        "يُخصم من المالك": x.billable === false ? "لا" : "نعم",
        "من دفعه": PAID_BY_AR[x.paid_by] || x.paid_by || "",
        "الحالة": x.status === "due" ? "مستحق" : "مدفوع",
        "المورّد": x.vendor || "", "رقم الفاتورة": x.invoice_no || "",
        "ملاحظة": x.note || "",
      })), [12, 22, 10, 14, 12, 14, 14, 10, 18, 14, 30]);

      add("سجل العقار", notes.map((n) => ({
        "التاريخ": n.note_date, "العقار": pName[n.property_id] || "", "الوحدة": n.unit || "",
        "النوع": NOTE_KIND_AR[n.kind] || n.kind || "", "الملاحظة": n.text,
        "الموعد": n.due_date || "", "أُنجزت": n.done_at ? (n.done_at || "").slice(0, 10) : "لا",
      })), [12, 22, 10, 14, 50, 12, 12]);

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
        /* أعمدة الملاك الحقيقية: الأشهر المتأخرة والجزئي — كانت الورقة تقرأ paid_periods
           و status (لا وجود لهما في الجدول) فتُصدّر «المسدَّد 0» لكل مالك، ويسقط
           دين الجمعيات من النسخة الاحتياطية. المتأخر بالريال بمعادلة كشف المالك. */
        const aFee: Record<string, number> = Object.fromEntries(assocs.map((a: any) => [a.id, Number(a.fee) || 0]));
        add("ملاك الجمعيات", owners.map((o: any) => {
          const fee = aFee[o.association_id] || 0, late = Number(o.months_late) || 0, part = Number(o.partial_amount) || 0;
          return { "الجمعية": aName[o.association_id] || "", "المالك": o.name, "الوحدة": o.unit || "", "الجوال": o.phone || "",
            "الأشهر المتأخرة": late, "مدفوع من الشهر التالي": part,
            "المتأخر (ريال)": Math.max(0, Math.round((late * fee - part) * 100) / 100),
            "آخر سداد": String(o.last_paid || "").slice(0, 10) };
        }), [22, 22, 10, 14, 12, 14, 14, 12]);
        add("سجل الجمعيات", assocNotes.map((n: any) => ({ "الجمعية": aName[n.association_id] || "",
          "التاريخ": String(n.note_date || n.created_at || "").slice(0, 10), "الملاحظة": n.text || "" })), [22, 12, 70]);
      }

      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ["نسخة كاملة من بيانات حسابك في وثيق"],
        [`تاريخ التصدير: ${new Date().toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" })}`],
        [""],
        ["ورقة «قالب الرفع» بنفس أعمدة قالب الرفع في وثيق — لو رجعت يومًا، ارفعها كما هي من صفحة «رفع Excel» وتعود كل وحداتك بعقودها ودفعاتها المسدّدة."],
        ["بقية الأوراق للعمل خارج وثيق: كل جدول بأسماء أعمدة عربية واضحة، بلا أكواد داخلية."],
        ["البيانات ملكك. وثيق لا يحتفظ بحق عليها ولا يقيّد نقلها."],
      ]), "اقرأني");

      const stamp = today();
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
