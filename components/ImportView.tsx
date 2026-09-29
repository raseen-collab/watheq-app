"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { derivedEndDate, FREQUENCIES, parseDate } from "@/lib/contracts";
import { typeIcon, unitLabel } from "@/lib/domain";
import { sar, openExternal, today } from "@/lib/utils";
import { hijriShort } from "@/lib/hijri";
import { waLink, WATHEQ_WA } from "@/lib/utils";

import {
  HEADERS, NOTE_HEADER, EXAMPLE_MARK, parseCSV, gridFromSheetRows, parseGrid, markExisting, unitKey,
  type Prop, type Row, type ColumnInfo,
} from "@/lib/importParse";

/* التحليل كله في lib/importParse (دوال نقية مختبَرة) — هنا الواجهة والحفظ فقط (30 سبتمبر 2026) */
const blocked = (r: Row) => !!(r._error || r._exists);

export default function ImportView({ properties }: { properties: Prop[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [propId, setPropId] = useState(properties[0]?.id || "");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  /* صفوف بدايتها بعد اليوم بلا دفعات: كانت تُلوَّن فقط وتُرفع — والنمط نفسه
     (موعد الدفعة القادمة في خانة البداية) تكرّر 33 مرة عند مكتب واحد. الآن
     لا يُحفظ الملف حتى يقرّر المكتب صراحةً أنها عقود جديدة لم تبدأ. */
  const [futureOk, setFutureOk] = useState(false);
  /** قرار صفوف «أول استحقاق» المختلف: keep = كما في الملف · drop = يدفعون يوم بداية العقد */
  const [dueChoice, setDueChoice] = useState<null | "keep" | "drop">(null);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<number | null>(null);
  const [fileName, setFileName] = useState("");
  /** أي الأعمدة فُهمت وأيها تُجوهل + صفوف الأمثلة المتجاهلة — يظهر سطرًا في المعاينة */
  const [colInfo, setColInfo] = useState<ColumnInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const checkSeq = useRef(0);

  const activeProp = properties.find((p) => p.id === propId);
  const ul = unitLabel(activeProp?.property_type);

  function downloadTemplate() {
    /* الأمثلة تحمل علامة «مثال» في عمود الملاحظة فتُتجاهل إن نُسي حذفها —
       كانت تُرفع مستأجرين حقيقيين باسم «عبدالله الحربي» (30 سبتمبر 2026) */
    const pad = (r: string[]) => [...r, ...Array(HEADERS.length - r.length).fill(""), EXAMPLE_MARK];
    const sample = [
      [...HEADERS, NOTE_HEADER],
      pad(["عبدالله الحربي", "101", "2500", "شهري", "2026-01-01", "12", "0501234567", "1012345678", "8", ""]),
      pad(["مؤسسة النور التجارية", "معرض 2", "18000", "كل 3 اشهر", "2026-02-15", "4", "0559876543", "7001234567", "2", ""]),
      pad(["خالد القحطاني", "أرض A", "60000", "سنوي", "2025-06-01", "3", "0533334444", "", "1", ""]),
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
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const sheet = wb.Sheets["الوحدات"] || wb.Sheets[wb.SheetNames[0]];
      /**
       * raw:true عمدًا: raw:false يُخرج التاريخ بصيغة الخلية الأصلية
       * (مثل 1/1/26) وهي ملتبسة يوم/شهر — فنأخذ القيم الخام ونحوّل
       * كائن التاريخ بأنفسنا إلى yyyy-mm-dd بلا لبس، بالمكوّنات
       * المحلية لا toISOString حتى لا ينزاح يومًا مع فارق التوقيت.
       */
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1, raw: true, defval: "", blankrows: false,
      }) as any[][];
      // صفر الجوال المفقود يُعاد في المحلّل بعد معرفة عمود الجوال بالاسم لا بالموضع
      return gridFromSheetRows(rows);
    }
    return parseCSV(await f.text());
  }

  /**
   * تحميل قارئ Excel: الحزمة المضمّنة أولًا، وإن تعذّر تحميل جزئها (تحديث
   * نشر، ذاكرة متصفح قديمة) نجلب النسخة نفسها من CDN — الفشل هنا كان يظهر
   * للمستخدم كـ«تعذّرت قراءته» بلا سبب، والملف سليم.
   */
  async function loadXlsx(): Promise<any> {
    try { return await import("xlsx"); }
    catch (e) {
      console.warn("xlsx chunk failed, loading from CDN", e);
      if (!(window as any).XLSX) {
        await new Promise<void>((res, rej) => {
          const sc = document.createElement("script");
          sc.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
          sc.onload = () => res(); sc.onerror = () => rej(new Error("تعذّر تحميل قارئ Excel — تحقق من الاتصال"));
          document.head.appendChild(sc);
        });
      }
      return (window as any).XLSX;
    }
  }

  async function handleFile(f: File) {
    setFileName(f.name); setDone(null);
    let grid: string[][] = [];
    try { grid = await readGrid(f); }
    catch (e: any) {
      // السبب الفعلي يظهر للمستخدم — لا رسالة عامة تخفي المشكلة
      setFileName(`${f.name} — تعذّرت قراءته: ${e?.message || e}`);
      return;
    }
    if (!grid.length) return;

    const { rows: parsed, info } = parseGrid(grid, properties, today());
    setColInfo(info);
    setRows(parsed); setFutureOk(false); setDueChoice(null);   // ملف جديد = سؤال جديد
    checkExisting(parsed, propId);
  }

  /**
   * الوحدات الموجودة أصلًا في العقار الهدف تُعلَّم في المعاينة قبل الحفظ —
   * برقم الوحدة وحده لا (الوحدة + الاسم): من صحّح إملاء اسم وأعاد الرفع كان
   * يضاعف الوحدة (30 سبتمبر 2026). يُعاد الفحص إن غيّر العقار المختار.
   */
  async function checkExisting(list: Row[], selPid: string) {
    const seq = ++checkSeq.current;
    const pids = Array.from(new Set(list.filter((r) => !r._error && r.unit).map((r) => r.prop_id || selPid).filter(Boolean)));
    if (!pids.length) { setRows(markExisting(list, selPid, new Set(), () => "")); return; }
    setChecking(true);
    try {
      const existing = await fetchExistingUnits(pids);
      if (seq !== checkSeq.current) return;   // ملف أحدث أو عقار آخر اختير في الأثناء
      const pName = (id: string) => properties.find((p) => p.id === id)?.name || "العقار";
      setRows(markExisting(list, selPid, existing, pName));
    } catch (e) {
      console.warn("existing units check failed", e);   // الفحص يُعاد وقت الحفظ على أي حال
    } finally { if (seq === checkSeq.current) setChecking(false); }
  }

  /** مفاتيح `${property_id}|${unitKey}` للوحدات الموجودة — على صفحات 1000 (Supabase يقصّ بصمت) */
  async function fetchExistingUnits(pids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; ; i += 1000) {
      const { data, error } = await supabase.from("tenants").select("property_id, unit")
        .in("property_id", pids).order("id", { ascending: true }).range(i, i + 999);
      if (error) throw error;
      (data || []).forEach((t: any) => { if (t.unit) out.add(`${t.property_id}|${unitKey(t.unit)}`); });
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  async function importRows() {
    const valid0 = rows.filter((r) => !blocked(r));
    if (!valid0.length) return alert("لا توجد صفوف صالحة");
    // كل صف يذهب لعقاره المذكور في الملف، وإلا للعقار المختار في القائمة
    const groups = new Map<string, Row[]>();
    for (const r of valid0) {
      const pid = r.prop_id || propId;
      if (!pid) return alert("اختر العقار أولًا — أو اكتب اسم العقار في عمود «العقار» لكل صف");
      /* push لا نسخ المصفوفة كل صف: النسخ كان O(n²) على ملف 2000 صف (30 سبتمبر 2026) */
      const g = groups.get(pid);
      if (g) g.push(r); else groups.set(pid, [r]);
    }
    setBusy(true);
    const key = (u: string, n: string) => `${(u || "").trim()}|${(n || "").trim()}`;
    let inserted = 0, skipped = 0;
    /* فحص أخير وقت الحفظ: المعاينة قد تكون قديمة (زميل أضاف وحدة، أو رفعٌ سابق نجح) */
    let unitsNow: Set<string>;
    try { unitsNow = await fetchExistingUnits(Array.from(groups.keys())); }
    catch (e: any) { setBusy(false); return alert(`تعذّر التحقق من الوحدات الموجودة: ${e?.message || e}`); }
    const skippedRows = new Set<Row>();
    for (const [pid, list] of groups) {
      /**
       * حماية من الرفع المكرر: نفس الملف مرتين = كل الوحدات مكررة. الوحدة ذات
       * الرقم تُطابَق برقمها وحده (30 سبتمبر 2026)؛ وبلا رقم وحدة نطابق الاسم كما كان.
       */
      const noUnit = list.some((r) => !r.unit);
      const { data: existing } = noUnit
        ? await supabase.from("tenants").select("unit, name").eq("property_id", pid).limit(1000)
        : { data: [] as any[] };
      const seen = new Set((existing || []).map((t: any) => key(t.unit, t.name)));
      const fresh = list.filter((r) => {
        const dup = r.unit ? unitsNow.has(`${pid}|${unitKey(r.unit)}`) : seen.has(key(r.unit, r.name));
        if (dup) skippedRows.add(r);
        return !dup;
      });
      skipped += list.length - fresh.length;
      if (!fresh.length) continue;
      const payload = fresh.map((r) => ({
        property_id: pid,
        name: r.name, unit: r.unit || null, phone: r.phone || null, national_id: r.national_id || null,
        rent_amount: r.rent_amount, contract_start: r.contract_start || null,
        payment_frequency: r.payment_frequency, contract_periods: r.contract_periods,
        /* بتقويم العقد لا ميلاديًّا دائمًا: عقد هجري مرفوع من إكسل كان
           يُحفظ بنهاية متأخرة 11 يومًا (السنة الميلادية 365 والهجرية 354). */
        contract_end: r.contract_start
          ? derivedEndDate(r.contract_start, r.payment_frequency, r.contract_periods, null,
              r.calendar === "hijri" ? "hijri" : "gregorian")
          : null,
        paid_periods: r.paid_periods,
        // يوم المرساة كما يفعل الإدخال اليدوي: يُشتق من البداية عند غيابه،
        // لكن حفظه صراحةً يبقي المواعيد ثابتة لو عُدّل تاريخ البداية لاحقًا
        /* من «أول استحقاق» إن وُجد في الملف، وإلا من البداية — كالإدخال اليدوي */
        billing_anchor_day: (r.first_due && !(r._due && dueChoice === "drop")) ? parseDate(r.first_due).getDate()
          : r.contract_start ? parseDate(r.contract_start).getDate() : null,
        /* كل ما يُقرأ من الملف يُحفظ. كانت الحمولة 11 حقلًا فقط، فيضيع ما يعرضه
           الرفع في المراجعة: العقد الهجري يُحفظ ميلاديًّا (تنحرف أقساطه 11 يومًا
           كل سنة)، والدين المرحَّل يختفي، و«أول استحقاق» يسقط فتُحسب الأقساط من
           البداية، ونوع الوحدة ووضع الضريبة يضيعان. */
        calendar: r.calendar === "hijri" ? "hijri" : "gregorian",
        carried_debt: r.carried_debt && r.carried_debt > 0 ? r.carried_debt : 0,
        ...(r.carried_debt && r.carried_debt > 0 ? { carried_debt_note: "رصيد سابق من ملف الرفع" } : {}),
        first_due: (r._due && dueChoice === "drop") ? null : (r.first_due || null),
        unit_type: r.unit_type || null, vat_mode: r.vat_mode || null,
        contract_no: r.contract_no || null, elec_account: r.elec_account || null, water_account: r.water_account || null,
        rooms: r.rooms ?? null, baths: r.baths ?? null, acs: r.acs ?? null,
      }));
      /* على دفعات من 100 صف: مكتب يرفع 450 وحدة دفعة واحدة قد تنتهي مهلة
         الطلب أو يُرفض حجمه، فيفشل الرفع كله بعد دقيقة انتظار. وبالدفعات
         يُحفظ ما نجح ويُقال له أين توقف بالضبط. */
      const BATCH = 100;
      for (let i = 0; i < payload.length; i += BATCH) {
        let part: any[] = payload.slice(i, i + BATCH);
        /* عمود اختياري ناقص في قاعدة مكتبٍ ما: يُحذف من المحاولة ويُعاد الحفظ بدونه —
           لا يسقط الرفع كله لأجله (المبدأ نفسه في حفظ الإعدادات، schema-v41) */
        const OPTIONAL = ["first_due", "unit_type", "vat_mode", "contract_no", "elec_account", "water_account", "rooms", "baths", "acs", "carried_debt_note"];
        let { error } = await supabase.from("tenants").insert(part);
        for (let tries = 0; error && tries < OPTIONAL.length; tries++) {
          const col = OPTIONAL.find((c) => new RegExp(`\\b${c}\\b`).test(error!.message));
          if (!col) break;
          part = part.map(({ [col]: _drop, ...rest }) => rest);
          ({ error } = await supabase.from("tenants").insert(part));
        }
        if (error) {
          setBusy(false);
          return alert(`تعذّر الحفظ: ${error.message}\n\nأُضيف ${inserted + i} صفًّا قبل التوقف.\nراجع اللوحة، واحذف الملف من الصفوف المضافة قبل إعادة الرفع (المكرر يُتخطّى تلقائيًّا).`);
        }
        setProgress(inserted + Math.min(i + BATCH, payload.length));
      }
      inserted += fresh.length;
    }
    setBusy(false);
    /* الصفوف التي بها خطأ لم تُرفع: تبقى على الشاشة وتُذكر — كانت الشاشة تُمسح
       كلها فلا يعرف المكتب أيّها سقط */
    const left = rows.filter((r) => blocked(r) || skippedRows.has(r)).map((r) => skippedRows.has(r) && !r._exists
      ? { ...r, _exists: `الوحدة «${r.unit || r.name}» موجودة أصلًا — تُخطّيت` } : r);
    const leftMsg = left.length ? `\n\n⚠️ لم تُرفع ${left.length} ${left.length === 1 ? "وحدة" : "وحدات"} بها مشكلة أو موجودة أصلًا — بقيت أمامك في الجدول: صحّحها في الملف وارفعها وحدها.` : "";
    if (!inserted) return alert(`كل الصفوف (${skipped}) موجودة أصلًا — لم يُضف شيء.${leftMsg}`);
    if (skipped || left.length) alert(`أُضيفت ${inserted} وحدة${skipped ? `، وتُخطّيت ${skipped} موجودة أصلًا` : ""}.${leftMsg}`);
    setDone(inserted); setRows(left);
    router.refresh();
  }

  /* عدّ بمرور واحد — 2000 صف تُعاد رسمها مع كل تغيير */
  let validCount = 0, warnCount = 0, dueCount = 0, existsCount = 0;
  for (const r of rows) {
    if (r._exists && !r._error) existsCount++;
    if (blocked(r)) continue;
    validCount++;
    if (r._warn) warnCount++;
    if (r._due) dueCount++;
  }
  const errorCount = rows.length - validCount - existsCount;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="font-display font-bold text-deep text-2xl mb-1">رفع الوحدات من ملف Excel</h1>
      <p className="text-muted mb-6">لديك عشرات المستأجرين؟ ارفعهم دفعة واحدة بدل الإدخال اليدوي.</p>

      {!properties.length ? (
        /* مكتب أتى ومعه ملف جاهز: لا تُغلق الباب في وجهه — أعطه القالب أولًا
           ثم وجّهه لإنشاء العقارات، فعمود «العقار» في القالب يوزّع الصفوف. */
        <div className="bg-white border border-line rounded-2xl p-6">
          <h2 className="font-display font-bold text-deep text-lg mb-1">ابدأ من هنا — حتى قبل إنشاء العقارات</h2>
          <p className="text-sm text-muted mb-4">حمّل القالب وعبّئه، واكتب اسم العقار في عمود «العقار» لكل وحدة. ثم أنشئ العقارات بالأسماء نفسها وارفع الملف مرة واحدة.</p>
          <div className="grid sm:grid-cols-3 gap-3 mb-5">
            <div className="border border-line rounded-xl p-3">
              <div className="text-xs font-bold text-goldInk mb-1">١</div>
              <div className="text-sm font-semibold text-deep mb-2">حمّل القالب</div>
              <a href="/watheq-template.xlsx" download className="btn btn-gold text-xs justify-center w-full">⬇ قالب Excel</a>
            </div>
            <div className="border border-line rounded-xl p-3">
              <div className="text-xs font-bold text-goldInk mb-1">٢</div>
              <div className="text-sm font-semibold text-deep mb-2">أنشئ عقاراتك</div>
              <a href="/dashboard/property" className="btn btn-ghost text-xs justify-center w-full">+ إضافة عقار</a>
            </div>
            <div className="border border-line rounded-xl p-3">
              <div className="text-xs font-bold text-goldInk mb-1">٣</div>
              <div className="text-sm font-semibold text-deep mb-2">ارجع وارفع</div>
              <span className="text-[11px] text-muted">كل صف يذهب لعقاره تلقائيًّا</span>
            </div>
          </div>
          <div className="bg-paper border border-line rounded-xl p-3 text-sm">
            <b className="text-deep">أو وفّر على نفسك الوقت:</b> أرسل لنا ملفك بأي شكل (إكسل، صورة دفتر، أي شيء) ونجهّز حسابك كاملًا خلال يوم — بلا أي التزام.
            <a href={waLink(WATHEQ_WA, "السلام عليكم، عندي ملف بيانات عقارات وأبغى أجهّز حسابي في وثيق.")} target="_blank" rel="noreferrer"
               className="btn btn-wa text-xs mt-2" onClick={(e) => { e.preventDefault(); openExternal(waLink(WATHEQ_WA, "السلام عليكم، عندي ملف بيانات عقارات وأبغى أجهّز حسابي في وثيق.")); }}>💬 أرسل ملفك على واتساب</a>
          </div>
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
            <select className="fld mb-4" value={propId} onChange={(e) => { setPropId(e.target.value); if (rows.length) checkExisting(rows, e.target.value); }}>
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
                    {existsCount > 0 && <> · <span className="text-late font-semibold">{existsCount} موجودة أصلًا في العقار — لن تُرفع</span></>}
                    {checking && <> · <span>جارٍ فحص الوحدات الموجودة…</span></>}
                    {warnCount > 0 && <> · <span className="text-[#8a5a11] font-semibold">{warnCount} بدايتها بعد اليوم — تحقّق منها</span></>}
                  </div>
                  {colInfo && (
                    /* ما فهمناه من الملف ظاهرًا: عمود بعنوان غير معروف كان يُقرأ بموضعه بصمت (30 سبتمبر 2026) */
                    <div className="text-[11.5px] text-muted mt-1 leading-relaxed">
                      {colInfo.mode === "headers"
                        ? <>الأعمدة المقروءة بالعنوان ({colInfo.recognized.length}): {colInfo.recognized.join("، ")}
                            {colInfo.ignored.length > 0 && <> · <b className="text-[#8a5a11]">تُجوهل ({colInfo.ignored.length}): {colInfo.ignored.join("، ")}</b></>}</>
                        : <>لم نجد عناوين معروفة — قُرئت الأعمدة بترتيب القالب: {HEADERS.slice(0, 9).join("، ")}…</>}
                      {colInfo.examples > 0 && <> · <b>تم تجاهل {colInfo.examples} صفوف أمثلة</b> (المعلَّمة «مثال»)</>}
                    </div>
                  )}
                </div>
                <button onClick={importRows} disabled={busy || checking || !validCount || (warnCount > 0 && !futureOk) || (dueCount > 0 && !dueChoice)} className="btn btn-gold text-sm disabled:opacity-40"
                  title={(warnCount > 0 && !futureOk) || (dueCount > 0 && !dueChoice) ? "قرّر أولًا في التنبيهات أدناه" : undefined}>
                  {busy ? (progress ? `جارٍ الحفظ… ${progress}` : "جارٍ الحفظ…") : `حفظ ${validCount} وحدة`}
                </button>
              </div>
              {warnCount > 0 && (
                <div className="mx-4 mb-3 rounded-xl border border-[#F2D49B] bg-[#FFF6E5] p-3 text-[12.5px] leading-relaxed">
                  <b className="text-deep">{warnCount} {warnCount === 1 ? "وحدة" : "وحدات"} بداية عقدها بعد اليوم ولا دفعات مسدَّدة</b> (الصفوف الصفراء).
                  <div className="mt-1">إن كان المستأجر <b>ساكنًا الآن</b>: فالمكتوب غالبًا <b>موعد الدفعة القادمة</b> — صحّح في الملف «بداية العقد» من إيجار
                    و«الدفعات المسدّدة»، ثم ارفعه من جديد. وإن كانت <b>عقودًا جديدة لم يسكن مستأجروها بعد</b>، فأكّد:</div>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer min-h-[44px]">
                    <input type="checkbox" className="w-4 h-4" checked={futureOk} onChange={(e) => setFutureOk(e.target.checked)} />
                    <span>نعم، هذه {warnCount === 1 ? "الوحدة عقد جديد" : `الـ${warnCount} عقود جديدة`} لم يسكن {warnCount === 1 ? "مستأجره" : "مستأجروها"} بعد</span>
                  </label>
                </div>
              )}
              {dueCount > 0 && (
                <div className="mx-4 mb-3 rounded-xl border border-[#F2D49B] bg-[#FFF6E5] p-3 text-[12.5px] leading-relaxed">
                  <b className="text-deep">{dueCount} {dueCount === 1 ? "وحدة" : "وحدات"} فيها «أول استحقاق» يختلف عن بداية العقد</b> (مُعلَّمة في الجدول).
                  <div className="mt-1">«أول استحقاق» يغيّر يوم الدفع الشهري كله. أغلب المستأجرين يدفعون يوم بداية العقد — تأكّد قبل الحفظ:</div>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer min-h-[44px]">
                    <input type="radio" name="dueChoice" className="w-4 h-4" checked={dueChoice === "drop"} onChange={() => setDueChoice("drop")} />
                    <span>يدفعون يوم <b>بداية العقد</b> — تجاهل عمود «أول استحقاق» لهذه الوحدات</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                    <input type="radio" name="dueChoice" className="w-4 h-4" checked={dueChoice === "keep"} onChange={() => setDueChoice("keep")} />
                    <span>أول دفعة فعلًا في التاريخ المكتوب — احفظه كما هو</span>
                  </label>
                </div>
              )}
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
                      <tr key={i} className={`border-t border-line ${blocked(r) ? "bg-[#FBE9E7]" : r._warn ? "bg-[#FFF6E5]" : ""}`}>
                        <td className="p-2 font-medium">{r.name || "—"}{r.prop_name && <div className="text-[11px] text-muted">🏢 {r.prop_name}</div>}</td>
                        <td className="p-2">{r.unit || "—"}</td>
                        <td className="p-2">{sar(r.rent_amount)}</td>
                        <td className="p-2">{FREQUENCIES.find((f) => f.value === r.payment_frequency)?.label}</td>
                        <td className="p-2">{r.contract_start || "—"}{r.contract_start && <div className="text-[11px] text-muted">{hijriShort(r.contract_start)}</div>}
                          {!r._error && r._due && <div className={`text-[11px] font-semibold ${dueChoice === "drop" ? "text-muted line-through" : "text-[#8a5a11]"}`}>⚠ {r._due}</div>}</td>
                        <td className="p-2">{r._error || r._exists
                          ? <span className="text-late font-semibold">{r._error || r._exists}</span>
                          : r._warn
                            ? <span className="text-[#8a5a11] text-[12px] leading-relaxed"><b>⚠ تحقّق:</b> {r._warn}</span>
                            : <span className="text-paid font-semibold">جاهزة</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-paper2 border border-line rounded-xl p-4 text-sm text-muted leading-relaxed">
            <b className="text-deep">ملاحظات:</b> الأعمدة: {HEADERS.join(" · ")} · <b>العقار</b> (اختياري — لرفع كل المحفظة من ملف واحد؛ الاسم كما هو في اللوحة). <b>«بداية العقد»</b>: التاريخ المكتوب في عقد إيجار — <b>لا موعد الدفعة القادمة</b>، ولو كان العقد بدأ قبل سنة.
            {" "}<b>«الدفعات المسدّدة»</b>: كم دفعة دفعها المستأجر من هذا العقد حتى اليوم — مثال الصف الأول: عقد شهري بدأ 1 يناير 2026 ودفع حتى أغسطس = 8. وثيق يحسب منها الدفعة القادمة والمتأخرات.
            {" "}<b>«عدد الدفعات»</b> و<b>«مدة العقد (أشهر)»</b> للمعلومة نفسها: املأ أحدهما — وإن مُلئا معًا يُعتمد «عدد الدفعات». <b>«العقار»</b> اختياري: اكتب اسم العقار كما هو في وثيق ليذهب الصف إليه — فترفع كل عقاراتك من ملف واحد؛ والفارغ يذهب للعقار المختار أعلاه.
            دورة السداد تقبل: يومي، أسبوعي، شهري، كل 3 أشهر، كل 6 أشهر، سنوي.
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
