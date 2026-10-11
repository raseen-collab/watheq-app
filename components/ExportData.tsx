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
import { getOffice, officeId } from "@/lib/office";
import { KIND_META as LISTING_KIND, OFFER_LABEL, STATUS_META as LISTING_STATUS } from "@/lib/listings";
import { KIND_META as COMPLIANCE_KIND } from "@/lib/compliance";
import { HEADERS, templateRow, tenantTemplateCells } from "@/lib/importParse";

const UNIT_AR: Record<string, string> = { apartment: "شقة", annex: "شقة ملحق", studio: "استديو", room: "غرفة", shop: "محل", office: "مكتب", warehouse: "مستودع", land: "أرض", villa: "فيلا", other: "أخرى" };

const FREQ_AR: Record<string, string> = {
  daily: "يومي", weekly: "اسبوعي", monthly: "شهري", quarterly: "كل 3 اشهر", trimester: "كل 4 اشهر",
  semiannual: "نصف سنوي", annual: "سنوي", yearly: "سنوي",
};
const METHOD_AR: Record<string, string> = { cash: "نقدًا", transfer: "تحويل بنكي", ejar: "منصة إيجار", card: "بطاقة", pos: "شبكة", cheque: "شيك", other: "أخرى" };
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
  contract: "عقود", renewal: "تجديد", other: "أخرى",
};
const INV_ST_AR: Record<string, string> = { issued: "صادرة", paid: "مدفوعة", void: "ملغاة" };
const REQ_CAT_AR: Record<string, string> = { plumbing: "سباكة", electric: "كهرباء", elevator: "مصعد", cleaning: "نظافة", security: "أمن", ac: "تكييف", other: "أخرى" };
const REQ_ST_AR: Record<string, string> = { new: "جديد", in_progress: "قيد التنفيذ", done: "منجز", rejected: "مرفوض" };
const CLAIM_ST_AR: Record<string, string> = { pending: "بانتظار المراجعة", approved: "معتمد", rejected: "مرفوض" };
const OPEN_ST_AR: Record<string, string> = { active: "نشط", closed: "مغلق" };

/**
 * النسخة الاحتياطية الكاملة (JSON): كل صفوف المكتب بكل أعمدتها كما في القاعدة —
 * لا يسقط عمود أُضيف بعد كتابة أوراق Excel. تُستبعد رموز الروابط (أسرار وصول)
 * وعناوين IP. (11 أكتوبر 2026)
 */
const BACKUP_TABLES: [string, string][] = [
  ["properties", "created_at"], ["tenants", "created_at"], ["payments", "created_at"], ["expenses", "created_at"],
  ["property_notes", "created_at"], ["invoices", "created_at"], ["past_tenancies", "archived_at"], ["ledger_adjustments", "created_at"],
  ["listings", "created_at"], ["seeker_requests", "created_at"], ["compliance_items", "created_at"],
  ["tenant_requests", "created_at"], ["tenant_payment_claims", "created_at"], ["office_messages", "created_at"],
  ["associations", "created_at"], ["owners", "created_at"], ["association_notes", "created_at"], ["association_expenses", "created_at"],
  ["association_budgets", "created_at"], ["hoa_documents", "created_at"], ["hoa_signatures", "created_at"],
  ["hoa_requests", "created_at"], ["hoa_request_log", "created_at"], ["hoa_payment_claims", "created_at"],
];
const SECRET_KEYS = new Set(["token", "token_hash", "ip"]);
const stripSecrets = (rows: any[]) => rows.map((r) => Object.fromEntries(Object.entries(r || {}).filter(([k]) => !SECRET_KEYS.has(k))));
/** جدول غير موجود في قاعدة هذا المكتب (ترحيل لم يُشغَّل) — ليس خطأً */
const missingTable = (e: any) => e?.code === "42P01" || e?.code === "PGRST205" || /relation "[^"]+" does not exist|Could not find the table/i.test(String(e?.message || ""));
const missingColumn = (e: any) => e?.code === "42703" || /column "?[\w.]+"? does not exist/i.test(String(e?.message || ""));

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
    let ord: string | null = order;
    for (let i = 0; ; i += 1000) {
      /* ترتيب ثانوي بالمعرّف: صفّان بوقت إنشاء واحد عند حدّ صفحة قد يتكرر أحدهما أو يسقط */
      let q = supabase.from(table).select(select);
      if (ord) q = q.order(ord, { ascending: true });
      const { data, error } = await q.order("id", { ascending: true }).range(i, i + 999);
      if (error) {
        if (out.length === 0 && missingTable(error)) return [];
        /* عمود الترتيب غير موجود في هذا الجدول: نعيد بالمعرّف وحده — لا نُسقط الجدول */
        if (out.length === 0 && ord && missingColumn(error)) { ord = null; i -= 1000; continue; }
        throw new Error(`${table}: ${error.message}`);
      }
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
      /* سقف أمان لا قصّ صامت: نتوقف بخطأ صريح بدل ملفٍ ناقص يبدو كاملًا */
      if (out.length >= 500000) throw new Error(`${table}: أكثر من 500,000 صف — تواصل معنا لتصديره`);
    }
    return out;
  }
  /** جدول ثانوي: فشله لا يوقف التصدير، لكنه يُسجَّل ويُقال للمستخدم (كان يُبتلع فتخرج ورقته «لا بيانات») */
  async function opt(table: string, failed: string[], select = "*", order = "created_at"): Promise<any[]> {
    try { return await all(table, select, order); }
    catch (e: any) { failed.push(String(e?.message || e)); return []; }
  }

  /** النسخة الاحتياطية الكاملة — كل الجداول بكل الأعمدة، ملف JSON واحد */
  async function exportBackup() {
    setBusy(true); setMsg(null);
    try {
      const failed: string[] = [];
      const tables: Record<string, any[]> = {};
      for (const [t, ord] of BACKUP_TABLES) tables[t] = stripSecrets(await opt(t, failed, "*", ord));
      const oid = await officeId(supabase).catch(() => null);
      let settings: any = null;
      if (oid) {
        const { data, error } = await supabase.from("profiles").select("*").eq("id", oid).maybeSingle();
        if (error) failed.push(`profiles: ${error.message}`); else settings = data;
      }
      const backup = { format: "watheq-backup", version: 1, exported_at: new Date().toISOString(),
        office_settings: settings, tables, failed };
      const blob = new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `watheq-backup-${today()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const total = Object.values(tables).reduce((n, r) => n + r.length, 0);
      setMsg(failed.length
        ? `⚠ صُدّرت النسخة (${total} صف) — وتعذّر ${failed.length} جدول: ${failed.join(" · ")}`
        : `✓ نسخة احتياطية كاملة: ${total} صف من ${Object.values(tables).filter((r) => r.length).length} جدول.`);
    } catch (e: any) {
      setMsg(`تعذّر التصدير: ${e?.message || e}`);
    } finally { setBusy(false); }
  }

  async function exportAll() {
    setBusy(true); setMsg(null);
    try {
      const XLSX = await import("xlsx");
      /* الأساسية تُوقف التصدير إن فشلت؛ الثانوية تُسجَّل وتُعلَن (لا تُبتلع بصمت) */
      const failed: string[] = [];
      const [props, tenants, payments, expenses, notes, listings, requests, compliance, assocs, owners] = await Promise.all([
        all("properties"), all("tenants"), all("payments", "*", "paid_on"), all("expenses", "*", "spent_on"),
        all("property_notes", "*", "note_date"), opt("listings", failed), opt("seeker_requests", failed), opt("compliance_items", failed),
        opt("associations", failed), opt("owners", failed),
      ]);
      const invoices = await opt("invoices", failed);
      /* أرشيف المستأجرين السابقين (v45) — قبل الترحيل لا جدول */
      const past = await opt("past_tenancies", failed, "*", "archived_at");
      /* سجلّ التصحيحات (v43): كل شطب وتنازل وتصحيح عدّاد — بدونه يختفي دينٌ شُطب
         من النسخة الاحتياطية بلا أثر يشرح أين ذهب */
      const adjustments = await opt("ledger_adjustments", failed, "*", "created_at");
      const assocNotes = await opt("association_notes", failed);
      /* طلبات الصيانة وبلاغات الحوالات من رابط المستأجر (v70) — كانت لا تُصدَّر */
      const tReqs = await opt("tenant_requests", failed);
      const tClaims = await opt("tenant_payment_claims", failed);
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
      /* الترتيب من HEADERS نفسها (lib/importParse): كانت الورقة تكتب «رقم العقد»
         مكان «حساب الكهرباء» وما بعده بترتيب آخر، والرفع القديم يقرأ بالموضع —
         فتعود الضريبة والتقويم وأول استحقاق في خانات غيرها (30 سبتمبر 2026). */
      {
        /* الوحدات المُخلاة لا تدخل قالب الرفع: القالب بلا عمود «الحالة»، فكانت تعود
           عند الرفع عقودًا قائمة بمتأخرات وهمية. بياناتها كاملة في «الوحدات والمستأجرون». */
        const live = tenants.filter((t) => t.status !== "vacated");
        const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...live.map((t) => templateRow(tenantTemplateCells(t, pName[t.property_id] || "")))]);
        /* الجوال والهوية والحسابات نصًّا: إكسل يحذف صفر الجوال من الرقم */
        const textCols = [6, 7, 10, 11, 12];
        for (let r = 1; r <= live.length; r++) for (const c of textCols) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell && cell.v !== "") { cell.t = "s"; cell.v = String(cell.v); cell.z = "@"; }
        }
        ws["!cols"] = [22, 12, 12, 12, 12, 10, 14, 14, 12, 22, 16, 16, 12, 12, 8, 10, 10, 12, 10, 10, 14, 12].map((w) => ({ wch: w }));
        XLSX.utils.book_append_sheet(wb, ws, "قالب الرفع");
      }

      add("العقارات", props.map((p) => ({
        "العقار": p.name, "النوع": p.property_type || "", "المدينة": p.city || "", "الحي/العنوان": p.address || "",
        "المالك": p.owner_name || "", "المدير/المكتب": p.manager || "", "فترة السماح (أيام)": p.grace_days || 0,
        "أتعاب الإدارة %": p.mgmt_fee_pct || "", "ضريبة مفعّلة": p.vat_enabled ? "نعم" : "لا",
        "عدد الوحدات": tenants.filter((t) => t.property_id === p.id).length,
        "الاستخدام": ({ families: "سكني — عوائل", singles: "سكني — عزّاب", mixed: "سكني تجاري", commercial: "تجاري" } as any)[p.usage] || "",
        "نسبة الضريبة": p.vat_rate ?? "", "الضريبة شاملة": p.vat_inclusive === false ? "لا" : "نعم",
        "نافذة قريب (يوم)": p.soon_days ?? "", "نافذة مستحق (يوم)": p.imminent_days ?? "", "تنبيه انتهاء العقد (يوم)": p.expiring_days ?? "",
        // عدادات العقار الرئيسية (schema-v68): «كهرباء — المصعد: 3001234 · ماء: 4005678»
        "عدادات العقار": (Array.isArray(p.meters) ? p.meters : [])
          .map((m: any) => `${m.type === "water" ? "ماء" : "كهرباء"}${m.label ? ` — ${m.label}` : ""}: ${m.account}`).join(" · "),
      })), [24, 12, 12, 20, 18, 18, 10, 10, 10, 10, 18, 10, 12, 14, 14, 18, 40]);

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

      /* M1: ورقة «الدفعات» للإيجارات فقط — دفعات الجمعيات في ورقتها (كانت تختلط بلا عقار ولا مستأجر) */
      const rentPays = payments.filter((x: any) => !x.association_id && !x.owner_id);
      const hoaPays = payments.filter((x: any) => x.association_id || x.owner_id);
      /* الدفعة المعكوسة وعكسها: كانا بلا علامة — «عكس» صفّه سالب و«معكوسة» أصله */
      const rentRev = new Set(rentPays.filter((x: any) => x.reverses).map((x: any) => String(x.reverses)));
      add("الدفعات", rentPays.map((x) => ({
        "التاريخ": x.paid_on, "العقار": pName[x.property_id] || pName[tById[x.tenant_id]?.property_id] || "",
        /* الساكن باسمه الحيّ؛ ودفعات من سبقه بالاسم المحفوظ فيها (v45) */
        "الوحدة": (x.tenant_id && tById[x.tenant_id]?.unit) || x.unit_label || "",
        "المستأجر": (x.tenant_id && tById[x.tenant_id]?.name) || x.payer_name || "",
        "تسدّد": ({ rent: "أقساط", carried: "دين مرحَّل", past_debt: "دين مستأجر سابق" } as any)[x.applies_to] || "أقساط",
        "المبلغ": x.amount, "الطريقة": METHOD_AR[x.method] || x.method || "", "الدفعات المغطاة": x.periods_covered || "",
        /* مرجع الحوالة يُطابق به المكتب كشف بنكه — وكان يسقط من التصدير */
        "مرجع الحوالة": x.reference || "", "ملاحظة": x.note || "",
        "الحالة": x.reverses ? "عكس" : rentRev.has(String(x.id)) ? "معكوسة" : "",
        "رقم السند": x.receipt_no || "", "وقت التسجيل": String(x.created_at || "").replace("T", " ").slice(0, 16),
      })), [12, 22, 10, 22, 14, 12, 12, 10, 14, 24, 10, 12, 16]);

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
        "الحالة": INV_ST_AR[x.status] || x.status || "", "ملاحظات": x.notes || "",
        "تاريخ الإصدار": x.issue_date || "", "ضريبة": x.vat_enabled ? `${x.vat_rate ?? 15}% ${x.vat_inclusive === false ? "مضافة" : "شاملة"}` : "",
      })), [16, 12, 22, 22, 10, 16, 12, 12, 12, 30, 12, 14]);

      /* المصروفات: «يُخصم من المالك» و«من دفعه» و«الحالة» هي جوهر التصنيف
         المالي — وبدونها لا يستطيع المكتب إعادة بناء صافي أي مالك من الملف. */
      add("المصروفات", expenses.map((x) => ({
        "التاريخ": x.spent_on, "العقار": pName[x.property_id] || "", "الوحدة": x.unit || "",
        "التصنيف": EXP_CAT_AR[x.category] || x.category || "", "المبلغ": x.amount,
        "يُخصم من المالك": x.billable === false ? "لا" : "نعم",
        "من دفعه": PAID_BY_AR[x.paid_by] || x.paid_by || "",
        "الحالة": x.status === "due" ? "مستحق" : "مدفوع",
        "المورّد": x.vendor || "", "رقم الفاتورة": x.invoice_no || "", "رقم سند الصرف": x.voucher_no || "", "المستلم": x.payee_name || "",
        "هوية/سجل المستلم": x.payee_ref || "",
        "ملاحظة": x.note || "",
      })), [12, 22, 10, 14, 12, 14, 14, 10, 18, 14, 14, 18, 16, 30]);

      add("سجل العقار", notes.map((n) => ({
        "التاريخ": n.note_date, "العقار": pName[n.property_id] || "", "الوحدة": n.unit || "",
        "النوع": NOTE_KIND_AR[n.kind] || n.kind || "", "الملاحظة": n.text,
        "الموعد": n.due_date || "", "أُنجزت": n.done_at ? (n.done_at || "").slice(0, 10) : "لا",
      })), [12, 22, 10, 14, 50, 12, 12]);

      add("المعروضات", listings.map((l) => ({
        "الكود": l.code, "النوع": (LISTING_KIND as any)[l.kind]?.label || l.kind, "العرض": (OFFER_LABEL as any)[l.offer_type] || l.offer_type,
        "العنوان": l.title || "", "المدينة": l.city || "", "الحي": l.district || "",
        "المساحة": l.area || "", "السعر": l.price || "", "الحالة": (LISTING_STATUS as any)[l.status]?.label || l.status || "",
        "المالك": l.owner_name || "", "جوال المالك": l.owner_phone || "",
        "المصدر": l.source === "broker" ? "وسيط" : l.source === "owner" ? "مالك" : "",
        "رقم الصك": l.deed_no || "", "المخطط": l.plan_no || "", "القطعة": l.parcel_no || "", "عدد الشوارع": l.street_count ?? "",
        "رقم الوحدة": l.unit_no || "", "الدور": l.floor_no ?? "", "الغرف": l.rooms ?? "", "دورات المياه": l.baths ?? "",
        "عمر البناء": l.building_age ?? "", "مؤثث": l.furnished ? "نعم" : l.furnished === false ? "لا" : "",
        "آخر تأكيد": String(l.last_confirmed_at || "").slice(0, 10), "ملاحظة": l.note || "",
      })), [10, 10, 10, 20, 12, 14, 10, 12, 12, 18, 14, 8, 14, 10, 10, 8, 10, 6, 6, 8, 8, 6, 12, 30]);

      add("طلبات الباحثين", requests.map((r) => ({
        "الاسم": r.seeker_name || "", "الجوال": r.seeker_phone || "", "يبحث عن": (LISTING_KIND as any)[r.kind]?.label || r.kind || "", "العرض": (OFFER_LABEL as any)[r.offer_type] || r.offer_type || "",
        "المدينة": r.city || "", "الأحياء": r.districts || "", "السعر الأقصى": r.price_max || "",
        "المساحة من": r.area_min || "", "إلى": r.area_max || "", "الحالة": OPEN_ST_AR[r.status] || r.status || "", "ملاحظة": r.note || "",
      })), [18, 14, 10, 10, 12, 20, 12, 10, 10, 10, 30]);

      add("التزامات المكتب", compliance.map((c) => ({
        "النوع": (COMPLIANCE_KIND as any)[c.kind]?.one || c.kind, "العنوان": c.title, "الرقم المرجعي": c.ref_no || "", "البداية": c.start_date || "",
        "الانتهاء": c.end_date || "", "الحالة": OPEN_ST_AR[c.status] || c.status || "",
        "العقار": pName[c.property_id] || "", "الطرف": c.party || "", "نوع الصفقة": c.deal_type === "sale" ? "بيع" : c.deal_type === "rent" ? "إيجار" : "",
        "حصري": c.exclusive ? "نعم" : c.exclusive === false ? "لا" : "", "المنصة": c.platform || "",
        "العمولة %": c.commission_pct ?? "", "قيمة الصفقة": c.amount ?? "", "ملاحظة": c.note || "",
      })), [12, 26, 16, 12, 12, 10, 20, 18, 10, 8, 14, 10, 12, 30]);

      add("طلبات الصيانة", tReqs.map((r: any) => ({
        "التاريخ": String(r.created_at || "").slice(0, 10), "العقار": pName[r.property_id] || "",
        "الوحدة": r.unit || tById[r.tenant_id]?.unit || "", "المستأجر": r.tenant_name || tById[r.tenant_id]?.name || "",
        "النوع": REQ_CAT_AR[r.category] || r.category || "", "المكان": r.location === "common" ? "مرافق مشتركة" : "داخل الوحدة",
        "الوصف": r.description || "", "الحالة": REQ_ST_AR[r.status] || r.status || "", "ملاحظة المكتب": r.manager_note || "",
        "أُغلق": String(r.closed_at || "").slice(0, 10),
      })), [12, 22, 10, 20, 10, 14, 50, 12, 30, 12]);

      add("بلاغات الحوالات", tClaims.map((c: any) => ({
        "تاريخ البلاغ": String(c.created_at || "").slice(0, 10), "العقار": pName[c.property_id] || "",
        "الوحدة": c.unit || tById[c.tenant_id]?.unit || "", "المستأجر": c.tenant_name || tById[c.tenant_id]?.name || "",
        "المبلغ": Number(c.amount) || 0, "تاريخ الحوالة": c.transfer_date || "", "مرجع البنك": c.bank_ref || "",
        "ملاحظة المستأجر": c.note || "", "الحالة": CLAIM_ST_AR[c.status] || c.status || "",
        "المسجَّل فعلًا": c.recorded_amount ?? "", "سبب الرفض": c.reject_reason || "", "تاريخ القرار": String(c.decided_at || "").slice(0, 10),
      })), [12, 22, 10, 20, 12, 12, 16, 24, 14, 12, 24, 12]);

      if (assocs.length) {
        const aName: Record<string, string> = {}; assocs.forEach((a) => { aName[a.id] = a.name; });
        add("جمعيات الملاك", assocs.map((a) => ({ "الجمعية": a.name, "المدينة": a.city || "", "الاشتراك للفترة": a.fee ?? a.monthly_fee ?? "", "الفترة": a.fee_period === "annual" ? "سنوي" : "شهري", "أساس التوزيع": a.fee_basis === "share" ? "حسب الحصص" : "متساوٍ", "عدد الملاك": owners.filter((o) => o.association_id === a.id).length })));
        /* أعمدة الملاك الحقيقية: الأشهر المتأخرة والجزئي — كانت الورقة تقرأ paid_periods
           و status (لا وجود لهما في الجدول) فتُصدّر «المسدَّد 0» لكل مالك، ويسقط
           دين الجمعيات من النسخة الاحتياطية. المتأخر بالريال بمعادلة كشف المالك. */
        const aFee: Record<string, number> = Object.fromEntries(assocs.map((a: any) => [a.id, Number(a.fee) || 0]));
        add("ملاك الجمعيات", owners.map((o: any) => {
          /* v63: رسم المالك الخاص (من حصته) إن وُجد */
          const fee = Number(o.fee_override) > 0 ? Number(o.fee_override) : aFee[o.association_id] || 0, late = Number(o.months_late) || 0, part = Number(o.partial_amount) || 0;
          return { "الجمعية": aName[o.association_id] || "", "المالك": o.name, "الوحدة": o.unit || "", "الجوال": o.phone || "",
            "الفترات المتأخرة": late, "الجزئي أو الرصيد (ريال)": part,
            "أشهر مقدَّمة": Number(o.prepaid_months) || 0,
            "المتأخر (ريال)": Math.max(0, Math.round((late * fee - part) * 100) / 100),
            "آخر سداد": String(o.last_paid || "").slice(0, 10),
            "رسم الفترة (ريال)": fee, "الحصة ٪": o.share_pct ?? "", "المساحة م²": o.area_m2 ?? "" };
        }), [22, 22, 10, 14, 12, 14, 10, 14, 12, 12, 10, 10]);
        const oById: Record<string, any> = Object.fromEntries(owners.map((o: any) => [o.id, o]));
        const reversedIds = new Set(hoaPays.filter((x: any) => x.reverses).map((x: any) => String(x.reverses)));
        add("دفعات الجمعيات", hoaPays.map((x: any) => ({
          "الجمعية": aName[x.association_id] || "", "المالك / الدافع": x.payer_name || oById[x.owner_id]?.name || "",
          "الوحدة": x.unit_label || oById[x.owner_id]?.unit || "", "التاريخ": String(x.paid_on || "").slice(0, 10),
          "المبلغ": Number(x.amount) || 0, "الطريقة": METHOD_AR[x.method] || x.method || "", "رقم السند": x.receipt_no || "",
          "المرجع": x.reference || "", "الحالة": x.reverses ? "عكس" : reversedIds.has(String(x.id)) ? "معكوسة" : "",
        })), [22, 22, 10, 12, 12, 12, 12, 16, 10]);
        const assocExp = await opt("association_expenses", failed, "*", "spent_on");
        const expRev = new Set(assocExp.filter((x: any) => x.reverses).map((x: any) => String(x.reverses)));
        add("مصروفات الجمعيات", assocExp.map((x: any) => ({
          "الجمعية": aName[x.association_id] || "", "رقم سند الصرف": x.voucher_no || "", "التاريخ": String(x.spent_on || "").slice(0, 10),
          "البند": x.category || "", "البيان": x.description || "", "المبلغ": Number(x.amount) || 0, "المورّد": x.vendor || "",
          "المرجع": x.reference || "", "الحالة": x.reverses ? "عكس" : expRev.has(String(x.id)) ? "معكوس" : "",
        })), [22, 14, 12, 14, 30, 12, 18, 14, 10]);
        add("سجل الجمعيات", assocNotes.map((n: any) => ({ "الجمعية": aName[n.association_id] || "",
          "التاريخ": String(n.note_date || n.created_at || "").slice(0, 10), "الملاحظة": n.text || "" })), [22, 12, 70]);
      }

      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ["نسخة كاملة من بيانات حسابك في وثيق"],
        [`تاريخ التصدير: ${new Date().toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh" })}`],
        [""],
        ["ورقة «قالب الرفع» بنفس أعمدة قالب الرفع في وثيق — لو رجعت يومًا، ارفعها من صفحة «رفع Excel» وتعود وحداتك القائمة بعقودها وعدد دفعاتها المسدّدة ودينها المرحَّل."],
        ["ما لا يعود بالرفع (محفوظ هنا للرجوع إليه): سجل الدفعات بتواريخها، الوحدات المُخلاة، المبالغ الجزئية، الفواتير، المستأجرون السابقون. أنشئ العقارات بأسمائها نفسها قبل الرفع."],
        ["بقية الأوراق للعمل خارج وثيق: كل جدول بأسماء أعمدة عربية واضحة، بلا أكواد داخلية."],
        ["للنسخة الكاملة بكل الحقول كما هي في النظام: زر «نسخة احتياطية كاملة (JSON)» في الصفحة نفسها."],
        ...(failed.length ? [[""], ["⚠ تعذّر تصدير هذه الجداول (أوراقها فارغة في هذا الملف — أعد المحاولة):"], ...failed.map((f) => [f])] : []),
        ["البيانات ملكك. وثيق لا يحتفظ بحق عليها ولا يقيّد نقلها."],
      ]), "اقرأني");

      const stamp = today();
      XLSX.writeFile(wb, `watheq-export-${stamp}.xlsx`);
      setMsg(failed.length
        ? `⚠ صُدّر الملف — وتعذّر ${failed.length} جدول (مذكورة في ورقة «اقرأني»): ${failed.map((f) => f.split(":")[0]).join("، ")}. أعد المحاولة.`
        : `✓ صُدّر: ${props.length} عقار · ${tenants.length} وحدة · ${payments.length} دفعة · ${expenses.length} مصروف · ${invoices.length} فاتورة.`);
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
        ملف Excel واحد فيه كل شيء: العقارات، الوحدات والعقود، الدفعات، المصروفات، الفواتير، المستأجرون السابقون، طلبات الصيانة، السجل، المعروضات، الالتزامات، والجمعيات.
        بياناتك ملكك — تأخذها كاملة متى شئت، وتعيد رفعها كما هي إن عدت.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-gold" onClick={exportAll} disabled={busy}>
          {busy ? "جارٍ التجهيز…" : "⬇ تصدير كل البيانات (Excel)"}
        </button>
        <button className="btn btn-ghost" onClick={exportBackup} disabled={busy}
          title="كل الجداول بكل الحقول كما هي في النظام — للحفظ الآمن، لا للقراءة">
          ⬇ نسخة احتياطية كاملة (JSON)
        </button>
        {msg && <span className={`text-sm ${msg.startsWith("✓") ? "text-[#137a50]" : msg.startsWith("⚠") ? "text-[#9A4B00]" : "text-late"}`}>{msg}</span>}
      </div>
    </div>
  );
}
