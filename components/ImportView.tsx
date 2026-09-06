"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { derivedEndDate, FREQUENCIES, type Frequency } from "@/lib/contracts";
import { typeIcon, unitLabel } from "@/lib/domain";
import { sar } from "@/lib/utils";
import { parseHijriInput, hijriShort } from "@/lib/hijri";

type Prop = { id: string; name: string; property_type: string | null };
type Row = {
  name: string; unit: string; rent_amount: number; phone: string; national_id: string;
  contract_start: string; payment_frequency: Frequency; contract_periods: number | null;
  paid_periods: number;
  elec_account?: string; water_account?: string; contract_no?: string;
  prop_name?: string;
  prop_id?: string;
  _error?: string;
};

// العمود التاسع «الدفعات المسدّدة» اختياري: بدونه يُعدّ العقد لم يُسدَّد منه شيء —
// وهذا كارثة لمكتب ينقل عقودًا قائمة (عقد من يناير يُرفع في سبتمبر = 8 «متأخرات» وهمية).
// القوالب القديمة بثمانية أعمدة تبقى تعمل: الغائب = 0.
const HEADERS = ["اسم المستأجر", "رقم الوحدة", "قيمة الدفعة", "دورة السداد", "بداية العقد", "عدد الدفعات", "الجوال", "رقم الهوية", "الدفعات المسدّدة", "العقار", "حساب الكهرباء", "حساب الماء", "رقم العقد"];
// عمود عاشر اختياري «العقار»: ملف واحد لكل المحفظة بدل ملف لكل عقار — مكتب بـ40
// عقارًا لا يرفع 40 مرة. الاسم يجب أن يطابق عقارًا موجودًا؛ الصف الفارغ يذهب للعقار المختار.

const FREQ_MAP: Record<string, Frequency> = {
  "يومي": "daily", "اسبوعي": "weekly", "شهري": "monthly",
  "ربع سنوي": "quarterly", "كل 3 اشهر": "quarterly", "ربعي": "quarterly", "كل ثلاثة اشهر": "quarterly",
  "نصف سنوي": "semiannual", "كل 6 اشهر": "semiannual", "نصفي": "semiannual", "كل ستة اشهر": "semiannual",
  "سنوي": "annual", "سنويا": "annual",
  daily: "daily", weekly: "weekly", monthly: "monthly",
  quarterly: "quarterly", semiannual: "semiannual", annual: "annual", yearly: "annual",
};

/**
 * توحيد الكتابة العربية قبل المطابقة. المكتب يكتب «كل 3 أشهر» و«نصف سنوى»
 * و«شهرى» — وأي اختلاف بهمزة أو ألف مقصورة كان يسقط إلى «شهري» بصمت،
 * فيتحوّل عقد ربع سنوي بـ18,000 إلى شهري ويظهر المستأجر متأخرًا بعشرات
 * الآلاف. التوحيد يزيل التشكيل والتطويل ويوحّد الهمزات والياء والتاء.
 */
function arKey(v: string): string {
  return String(v || "")
    .replace(/[\u064B-\u0652\u0640]/g, "")   // تشكيل وتطويل
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
const FREQ_LOOKUP: Record<string, Frequency> = Object.fromEntries(
  Object.entries(FREQ_MAP).map(([k, v]) => [arKey(k).replace(/ه$/, "ه"), v]),
) as Record<string, Frequency>;

/** تحويل الأرقام العربية والتواريخ */
const toEnDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/** هل التاريخ حقيقي فعلًا؟ 2026-02-31 و2026-13-45 يمرّان بالشكل ويفشلان هنا */
function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || y < 1900 || y > 2100) return false;
  return d <= new Date(y, mo, 0).getDate();
}

function normalizeDate(v: string): string {
  const s = toEnDigits(String(v || "").trim());
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** قارئ CSV بسيط يدعم علامات الاقتباس */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const t = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === ";") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}

export default function ImportView({ properties }: { properties: Prop[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [propId, setPropId] = useState(properties[0]?.id || "");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [fileName, setFileName] = useState("");

  const activeProp = properties.find((p) => p.id === propId);
  const ul = unitLabel(activeProp?.property_type);

  function downloadTemplate() {
    const sample = [
      HEADERS,
      ["عبدالله الحربي", "101", "2500", "شهري", "2026-01-01", "12", "0501234567", "1012345678", "8", ""],
      ["مؤسسة النور التجارية", "معرض 2", "18000", "كل 3 اشهر", "2026-02-15", "4", "0559876543", "7001234567", "2", ""],
      ["خالد القحطاني", "أرض A", "60000", "سنوي", "2025-06-01", "3", "0533334444", "", "1", ""],
    ];
    const csv = "\uFEFF" + sample.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "watheq-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /**
   * قراءة ملف إكسل مباشرة — بلا خطوة «احفظ CSV».
   * SheetJS يُحمَّل عند الحاجة فقط (import ديناميكي) فلا يثقل الصفحة
   * على من يرفع CSV. ورقة «الوحدات» تُقرأ إن وُجدت — وهي ورقة قالبنا —
   * وإلا فأول ورقة، حتى يعمل ملف المستخدم القديم أيضًا.
   *
   * raw:false + dateNF: نأخذ النص المعروض لا القيمة الخام، فتخرج
   * تواريخ إكسل الحقيقية بصيغة yyyy-mm-dd التي يفهمها المحلل أدناه،
   * ويبقى تاريخ قالبنا النصي كما هو. جوال حُفظ رقمًا (سقط صفره) يُعاد
   * صفره هنا — أشهر تلف يصيب الجوالات في إكسل.
   */
  async function readGrid(f: File): Promise<string[][]> {
    if (/\.(xlsx|xls)$/i.test(f.name)) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const sheet = wb.Sheets["الوحدات"] || wb.Sheets[wb.SheetNames[0]];
      /**
       * raw:true عمدًا: raw:false يُخرج التاريخ بصيغة الخلية الأصلية
       * (مثل 1/1/26) وهي ملتبسة يوم/شهر — فنأخذ القيم الخام ونحوّل
       * كائن التاريخ بأنفسنا إلى yyyy-mm-dd بلا لبس، بالمكوّنات
       * المحلية لا toISOString حتى لا ينزاح يومًا مع فارق التوقيت.
       */
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, {
        header: 1, raw: true, defval: "", blankrows: false,
      }) as any[][];
      const pad = (n: number) => String(n).padStart(2, "0");
      return rows.map((r) => r.map((c, i) => {
        if (c instanceof Date && !isNaN(c.getTime()))
          return `${c.getFullYear()}-${pad(c.getMonth() + 1)}-${pad(c.getDate())}`;
        let v = String(c ?? "").trim();
        if (i === 6 && /^5\d{8}$/.test(v.replace(/\D/g, ""))) v = "0" + v.replace(/\D/g, "");
        return v;
      }));
    }
    return parseCSV(await f.text());
  }

  async function handleFile(f: File) {
    setFileName(f.name); setDone(null);
    let grid: string[][] = [];
    try { grid = await readGrid(f); }
    catch { setFileName(f.name + " — تعذّرت قراءته، جرّب حفظه CSV UTF-8 ثم ارفعه"); return; }
    if (!grid.length) return;

    // تخطّي صف العناوين إن وُجد
    const start = grid[0].some((c) => String(c).includes("اسم") || String(c).toLowerCase().includes("name")) ? 1 : 0;

    const parsed: Row[] = grid.slice(start).map((r) => {
      const [name, unit, rent, freq, startDate, periods, phone, nid, paid, propName, elecAcc, waterAcc, contractNo] = r.map((x) => String(x ?? "").trim());
      const rentN = Number(toEnDigits(rent).replace(/[^\d.]/g, "")) || 0;
      const fk = arKey(freq);
      const frequency: Frequency = FREQ_LOOKUP[fk] || "monthly";
      const freqUnknown = !!freq.trim() && !FREQ_LOOKUP[fk];
      /* المكاتب السعودية تكتب العقود بالهجري. نجرّب الهجري أولًا (السنة
         1300–1600 تحسمه بلا لبس) ثم الميلادي — فيقبل الملف الصيغتين معًا. */
      const cs = parseHijriInput(startDate) || normalizeDate(startDate);
      const pr = Number(toEnDigits(periods)) || null;
      const pd = Math.max(0, Math.floor(Number(toEnDigits(paid)) || 0));
      let err = "";
      if (!name) err = "الاسم مفقود";
      else if (!rentN) err = "قيمة الدفعة مفقودة";
      else if (startDate && !cs) err = "تاريخ غير مفهوم";
      // لا نمرّر تاريخًا مستحيلًا (2026-13-45): كان يُحفظ كما هو ويفسد كل الحسابات
      else if (cs && !isRealDate(cs)) err = `تاريخ غير صحيح: ${startDate}`;
      else if (freqUnknown) err = `دورة سداد غير معروفة: «${freq.trim()}» — استخدم القائمة المنسدلة في القالب`;
      else if (!freq.trim()) err = "دورة السداد مفقودة";
      else if (pr && pd > pr) err = "الدفعات المسدّدة أكثر من عدد دفعات العقد";
      const norm = (x: string) => x.replace(/\s+/g, " ").trim();
      const target = propName ? properties.find((p) => norm(p.name) === norm(propName)) : undefined;
      if (propName && !target && !err) err = `العقار «${propName}» غير موجود — أنشئه أولًا أو صحّح الاسم`;
      return {
        name, unit, rent_amount: rentN, phone: toEnDigits(phone), national_id: toEnDigits(nid),
        contract_start: cs, payment_frequency: frequency, contract_periods: pr, paid_periods: pd,
        elec_account: (elecAcc || "").trim() || undefined, water_account: (waterAcc || "").trim() || undefined,
        contract_no: (contractNo || "").trim() || undefined,
        prop_name: propName || undefined, prop_id: target?.id,
        _error: err || undefined,
      };
    });
    /**
     * تكرار داخل الملف نفسه: 160 صفًّا مكتوبة يدويًّا فيها عادةً وحدة مكرّرة.
     * نعلّمها قبل الحفظ لا بعده — الاكتشاف بعد الرفع يعني بحثًا يدويًّا في اللوحة.
     */
    const seenInFile = new Map<string, number>();
    parsed.forEach((r) => {
      const k = `${(r.prop_name || "").trim()}|${(r.unit || "").trim()}`;
      if (!r.unit) return;
      seenInFile.set(k, (seenInFile.get(k) || 0) + 1);
    });
    parsed.forEach((r) => {
      if (r._error || !r.unit) return;
      const k = `${(r.prop_name || "").trim()}|${(r.unit || "").trim()}`;
      if ((seenInFile.get(k) || 0) > 1) r._error = `رقم الوحدة «${r.unit}» مكرّر في الملف`;
    });
    setRows(parsed);
  }

  async function importRows() {
    const valid0 = rows.filter((r) => !r._error);
    if (!valid0.length) return alert("لا توجد صفوف صالحة");
    // كل صف يذهب لعقاره المذكور في الملف، وإلا للعقار المختار في القائمة
    const groups = new Map<string, Row[]>();
    for (const r of valid0) {
      const pid = r.prop_id || propId;
      if (!pid) return alert("اختر العقار أولًا — أو اكتب اسم العقار في عمود «العقار» لكل صف");
      groups.set(pid, [...(groups.get(pid) || []), r]);
    }
    setBusy(true);
    const key = (u: string, n: string) => `${(u || "").trim()}|${(n || "").trim()}`;
    let inserted = 0, skipped = 0;
    for (const [pid, list] of groups) {
      /**
       * حماية من الرفع المكرر: نفس الملف مرتين = كل الوحدات مكررة. نقارن
       * (رقم الوحدة + الاسم) مع الموجود في العقار ونتخطى المطابق — لا حذف ولا دمج.
       */
      const { data: existing } = await supabase.from("tenants").select("unit, name").eq("property_id", pid).limit(1000);
      const seen = new Set((existing || []).map((t: any) => key(t.unit, t.name)));
      const fresh = list.filter((r) => !seen.has(key(r.unit, r.name)));
      skipped += list.length - fresh.length;
      if (!fresh.length) continue;
      const payload = fresh.map((r) => ({
        property_id: pid,
        name: r.name, unit: r.unit || null, phone: r.phone || null, national_id: r.national_id || null,
        rent_amount: r.rent_amount, contract_start: r.contract_start || null,
        payment_frequency: r.payment_frequency, contract_periods: r.contract_periods,
        contract_end: r.contract_start ? derivedEndDate(r.contract_start, r.payment_frequency, r.contract_periods) : null,
        paid_periods: r.paid_periods,
        // يوم المرساة كما يفعل الإدخال اليدوي: يُشتق من البداية عند غيابه،
        // لكن حفظه صراحةً يبقي المواعيد ثابتة لو عُدّل تاريخ البداية لاحقًا
        billing_anchor_day: r.contract_start ? new Date(r.contract_start).getDate() : null,
      }));
      const { error } = await supabase.from("tenants").insert(payload);
      if (error) { setBusy(false); return alert(`تعذّر الحفظ في أحد العقارات: ${error.message}\nأُضيف ${inserted} قبل التوقف — راجع اللوحة قبل إعادة الرفع.`); }
      inserted += fresh.length;
    }
    setBusy(false);
    if (!inserted) return alert(`كل الصفوف (${skipped}) موجودة أصلًا — لم يُضف شيء.`);
    if (skipped) alert(`أُضيفت ${inserted} وحدة، وتُخطّيت ${skipped} موجودة أصلًا.`);
    setDone(inserted); setRows([]);
    router.refresh();
  }

  const validCount = rows.filter((r) => !r._error).length;
  const errorCount = rows.length - validCount;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="font-display font-bold text-deep text-2xl mb-1">رفع الوحدات من ملف Excel</h1>
      <p className="text-muted mb-6">لديك عشرات المستأجرين؟ ارفعهم دفعة واحدة بدل الإدخال اليدوي.</p>

      {!properties.length ? (
        <div className="bg-white border border-line rounded-2xl p-8 text-center">
          <p className="text-muted mb-4">أضف عقارًا أولًا لترفع وحداته.</p>
          <a href="/dashboard/property" className="btn btn-gold">← الذهاب للعقارات</a>
        </div>
      ) : (
        <>
          {/* الخطوات */}
          <div className="grid md:grid-cols-3 gap-3 mb-6">
            <StepCard n="١" title="حمّل القالب" desc="ملف جاهز بالأعمدة الصحيحة وأمثلة توضيحية.">
              <div className="flex flex-col gap-1.5 mt-2">
                <a href="/watheq-template.xlsx" download className="btn btn-gold text-xs justify-center"
                  title="قوائم منسدلة لدورة السداد، وخانات لا تحذف صفر الجوال، وورقة شرح">⬇ قالب Excel — منسدلات جاهزة</a>
                <button onClick={downloadTemplate} className="btn btn-ghost text-xs">⬇ قالب CSV مجرّد</button>
              </div>
            </StepCard>
            <StepCard n="٢" title="املأ بياناتك" desc="افتحه بـ Excel واملأ صفًّا لكل وحدة — القوائم المنسدلة تمنع الخطأ." />
            <StepCard n="٣" title="ارفعه هنا" desc="سنتحقق من البيانات ونعرضها لك قبل الحفظ." />
          </div>

          <div className="bg-white border border-line rounded-2xl p-5 mb-5">
            <label className="block text-sm font-semibold mb-2">العقار الذي ستُضاف إليه الوحدات</label>
            <select className="fld mb-4" value={propId} onChange={(e) => setPropId(e.target.value)}>
              {properties.map((p) => <option key={p.id} value={p.id}>{typeIcon(p.property_type)} {p.name}</option>)}
            </select>

            <label className="block border-2 border-dashed border-line rounded-xl p-8 text-center cursor-pointer hover:border-goldSoft transition">
              <input type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <div className="text-3xl mb-2">📄</div>
              <div className="font-semibold text-deep">{fileName || "اضغط لاختيار ملف Excel أو CSV"}</div>
              <div className="text-xs text-muted mt-1">‎.xlsx يُقرأ مباشرة — لا حاجة لتحويله. Numbers: صدّره Excel أو CSV أولًا</div>
            </label>
          </div>

          {done !== null && (
            <div className="bg-[#E6F4EC] border border-[#B7DFC7] text-[#137a50] rounded-xl p-4 mb-5 flex items-center justify-between flex-wrap gap-3">
              <span>✓ تم استيراد <b>{done}</b> وحدة بنجاح.</span>
              <a href="/dashboard/property" className="btn btn-primary text-sm">عرض العقار ←</a>
            </div>
          )}

          {rows.length > 0 && (
            <div className="bg-white border border-line rounded-2xl overflow-hidden mb-5">
              <div className="px-5 py-4 border-b border-line flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="font-semibold">معاينة قبل الحفظ</h2>
                  <div className="text-sm text-muted">
                    <span className="text-paid font-semibold">{validCount} صالحة</span>
                    {errorCount > 0 && <> · <span className="text-late font-semibold">{errorCount} بها مشكلة</span></>}
                  </div>
                </div>
                <button onClick={importRows} disabled={busy || !validCount} className="btn btn-gold text-sm disabled:opacity-40">
                  {busy ? "..." : `حفظ ${validCount} وحدة`}
                </button>
              </div>
              <div className="overflow-x-auto max-h-[50vh]">
                <table className="w-full text-sm">
                  <thead className="bg-paper2 sticky top-0">
                    <tr>
                      <th className="p-2 text-right font-semibold">المستأجر</th>
                      <th className="p-2 text-right font-semibold">{ul}</th>
                      <th className="p-2 text-right font-semibold">الدفعة</th>
                      <th className="p-2 text-right font-semibold">الدورة</th>
                      <th className="p-2 text-right font-semibold">البداية</th>
                      <th className="p-2 text-right font-semibold">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={`border-t border-line ${r._error ? "bg-[#FBE9E7]" : ""}`}>
                        <td className="p-2 font-medium">{r.name || "—"}{r.prop_name && <div className="text-[11px] text-muted">🏢 {r.prop_name}</div>}</td>
                        <td className="p-2">{r.unit || "—"}</td>
                        <td className="p-2">{sar(r.rent_amount)}</td>
                        <td className="p-2">{FREQUENCIES.find((f) => f.value === r.payment_frequency)?.label}</td>
                        <td className="p-2">{r.contract_start || "—"}{r.contract_start && <div className="text-[11px] text-muted">{hijriShort(r.contract_start)}</div>}</td>
                        <td className="p-2">{r._error
                          ? <span className="text-late font-semibold">{r._error}</span>
                          : <span className="text-paid font-semibold">جاهزة</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-paper2 border border-line rounded-xl p-4 text-sm text-muted leading-relaxed">
            <b className="text-deep">ملاحظات:</b> الأعمدة: {HEADERS.join(" · ")} · <b>العقار</b> (اختياري — لرفع كل المحفظة من ملف واحد؛ الاسم كما هو في اللوحة). <b>«الدفعات المسدّدة»</b> مهمّة للعقود القائمة: كم دفعة سُدّدت منذ بداية العقد حتى اليوم — بدونها يُعدّ العقد غير مسدَّد بالكامل. <b>«العقار»</b> اختياري: اكتب اسم العقار كما هو في وثيق ليذهب الصف إليه — فترفع كل عقاراتك من ملف واحد؛ والفارغ يذهب للعقار المختار أعلاه.
            دورة السداد تقبل: يومي، أسبوعي، شهري، كل ٣ أشهر، كل ٦ أشهر، سنوي.
            التواريخ تُقبل بصيغة 2026-01-01 أو 01/01/2026. الأرقام العربية مدعومة.
          </div>
        </>
      )}
    </div>
  );
}

function StepCard({ n, title, desc, children }: { n: string; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <div className="bg-white border border-line rounded-xl p-4 relative">
      <div className="absolute -top-3 right-4 w-7 h-7 rounded-lg bg-gold text-white grid place-items-center font-display font-bold text-sm">{n}</div>
      <div className="font-semibold text-deep mt-2 mb-1">{title}</div>
      <div className="text-xs text-muted leading-relaxed">{desc}</div>
      {children}
    </div>
  );
}
