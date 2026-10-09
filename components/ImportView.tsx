"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";
import { derivedEndDate, FREQUENCIES, parseDate } from "@/lib/contracts";
import { typeIcon, unitLabel } from "@/lib/domain";
import { sar, openExternal, today } from "@/lib/utils";
import { hijriShort } from "@/lib/hijri";
import { waLink, WATHEQ_WA } from "@/lib/utils";

import {
  HEADERS, NOTE_HEADER, EXAMPLE_MARK, parseCSV, gridFromSheetRows, parseGrid, markExisting, unitKey,
  analyzeColumns, initialConfig, rentBasisFromHeader, paidBasisFromHeader, mappingProblems, configToOptions, headerSignature, validSavedConfig, columnSamples, columnLetter,
  FIELDS, FIELD_LABEL, REQUIRED_FIELDS,
  type Prop, type Row, type ColumnInfo, type ColumnAnalysis, type MapConfig, type Field,
} from "@/lib/importParse";
import type { Frequency } from "@/lib/contracts";

/* التحليل كله في lib/importParse (دوال نقية مختبَرة) — هنا الواجهة والحفظ فقط (30 سبتمبر 2026) */
const blocked = (r: Row) => !!(r._error || r._exists);

type Sheet = { name: string; grid: string[][] };
/* مطابقة المكتب لملفه تُتذكّر في متصفحه (بصمة العناوين فقط — لا بيانات) فلا يُسأل
   كل شهر عن الملف نفسه. التخزين قد يُمنع (تصفح خاص): الفشل صامت والسؤال يعود. */
const MAP_KEY = "wq_import_map_v1:";
function loadSavedMap(a: ColumnAnalysis): MapConfig | null {
  const sig = headerSignature(a);
  if (!sig) return null;
  try { const v = localStorage.getItem(MAP_KEY + sig); return v ? validSavedConfig(a, JSON.parse(v)) : null; }
  catch { return null; }
}
function saveMap(a: ColumnAnalysis, c: MapConfig) {
  const sig = headerSignature(a);
  if (!sig) return;
  try { localStorage.setItem(MAP_KEY + sig, JSON.stringify(c)); } catch { /* تخزين ممنوع — لا بأس */ }
}
const firstRowOf = (g: string[][]) => g.find((r) => (r || []).some((c) => String(c ?? "").trim())) || [];

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
  /* «طابق أعمدتك»: الملف يُقرأ في المتصفح، وما فيه لبس يُسأل عنه قبل المعاينة (9 أكتوبر 2026) */
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [analysis, setAnalysis] = useState<ColumnAnalysis | null>(null);
  const [cfg, setCfg] = useState<MapConfig | null>(null);
  const [stage, setStage] = useState<"idle" | "map" | "preview">("idle");
  const grid = sheets[sheetIdx]?.grid || [];

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
   * قراءة ملف إكسل مباشرة — بلا خطوة «احفظ CSV». داخل المتصفح فقط: لا يُرفع
   * الملف لأي خادم. SheetJS يُحمَّل عند الحاجة (import ديناميكي) فلا يثقل الصفحة
   * على من يرفع CSV. كل الأوراق تُقرأ، والافتراضي ورقة «الوحدات» (قالبنا) أو الأكثر صفوفًا.
   */
  async function readSheets(f: File): Promise<Sheet[]> {
    if (/\.(xlsx|xls)$/i.test(f.name)) {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      return (wb.SheetNames as string[]).map((name) => ({ name, grid: sheetGrid(XLSX, wb.Sheets[name]) }))
        .filter((s) => s.grid.some((r) => r.some((c) => String(c).trim())));
    }
    return [{ name: "", grid: parseCSV(await f.text()) }];
  }

  /**
   * raw:true عمدًا: raw:false يُخرج التاريخ بصيغة الخلية الأصلية (مثل 1/1/26)
   * وهي ملتبسة يوم/شهر — فنأخذ القيم الخام ونحوّل كائن التاريخ بأنفسنا إلى
   * yyyy-mm-dd بلا لبس، بالمكوّنات المحلية لا toISOString حتى لا ينزاح يومًا.
   * صفر الجوال المفقود يُعاد في المحلّل بعد معرفة عمود الجوال.
   */
  function sheetGrid(XLSX: any, sheet: any): string[][] {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: false }) as any[][];
    return gridFromSheetRows(rows);
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
    setRows([]); setColInfo(null); setStage("idle"); setAnalysis(null); setCfg(null); setSheets([]);
    let list: Sheet[] = [];
    try { list = await readSheets(f); }
    catch (e: any) {
      // السبب الفعلي يظهر للمستخدم — لا رسالة عامة تخفي المشكلة
      setFileName(`${f.name} — تعذّرت قراءته: ${e?.message || e}`);
      return;
    }
    if (!list.length) { setFileName(`${f.name} — الملف فارغ`); return; }
    /* ورقة «الوحدات» (قالبنا) إن وُجدت، وإلا الأكثر صفوفًا — لا الأولى عمياء */
    let idx = list.findIndex((s) => s.name === "الوحدات");
    if (idx < 0) idx = list.reduce((b, s, i) => s.grid.length > list[b].grid.length ? i : b, 0);
    setSheets(list); setSheetIdx(idx);
    startSheet(list[idx].grid, false);
  }

  /**
   * ما فُهم بيقين يذهب للمعاينة مباشرة (قالبنا، أو ملف طابقه المكتب من قبل).
   * وما فيه لبس — عمود مجهول، ترتيب بلا عناوين، «الإيجار» لا نعرف أسنوي هو —
   * يمرّ بخطوة المطابقة. التخمين هنا يصنع متأخرات وهمية بعشرات الآلاف.
   */
  function startSheet(g: string[][], forceMap: boolean) {
    const a = analyzeColumns(g);
    const saved = loadSavedMap(a);
    const c = saved || initialConfig(a);
    setAnalysis(a); setCfg(c);
    const sure = !mappingProblems(c).length && (saved ? true : !a.reasons.length);
    if (sure && !forceMap) runParse(g, c, !saved);
    else { setRows([]); setColInfo(null); setStage("map"); }
  }

  /** auto = الاكتشاف بالعناوين كما هو (معلومات الأعمدة تقول «بالعنوان»)؛ وإلا مطابقة المكتب */
  function runParse(g: string[][], c: MapConfig, auto: boolean) {
    const opts = auto
      ? { rentBasis: c.rentBasis || undefined, paidBasis: c.paidBasis || undefined }
      : configToOptions(c);
    const { rows: parsed, info } = parseGrid(g, properties, today(), opts);
    setColInfo(info);
    setRows(parsed); setFutureOk(false); setDueChoice(null);   // ملف جديد = سؤال جديد
    setStage("preview");
    checkExisting(parsed, propId);
  }

  function confirmMapping() {
    if (!analysis || !cfg || mappingProblems(cfg).length) return;
    saveMap(analysis, cfg);
    runParse(grid, cfg, false);
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
  let validCount = 0, warnCount = 0, dueCount = 0, existsCount = 0, partialCount = 0;
  for (const r of rows) {
    if (r._exists && !r._error) existsCount++;
    if (blocked(r)) continue;
    validCount++;
    if (r._note && r._note.includes("جزئي —")) partialCount++;
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
              <span className="text-[11px] text-muted">كل صف يذهب لعقاره تلقائيًّا — وملفك بأعمدته هو يُطابَق معك ويُقرأ داخل جهازك</span>
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
            <StepCard n="٢" title="املأ بياناتك — أو استعمل ملفك" desc="عندك ملف إكسل بأعمدتك؟ ارفعه كما هو: نطابق أعمدته معك خطوة بخطوة." />
            <StepCard n="٣" title="ارفعه هنا" desc="يُقرأ داخل متصفحك — لا يُحفظ شيء حتى تراجع المعاينة وتضغط «حفظ»." />
          </div>

          <div className="bg-white border border-line rounded-2xl p-5 mb-5">
            <label className="block text-sm font-semibold mb-2">العقار الذي ستُضاف إليه الوحدات</label>
            <select className="fld mb-4" value={propId} onChange={(e) => { setPropId(e.target.value); if (rows.length) checkExisting(rows, e.target.value); }}>
              {properties.map((p) => <option key={p.id} value={p.id}>{typeIcon(p.property_type)} {p.name}</option>)}
            </select>

            <label className="block border-2 border-dashed border-line rounded-xl p-8 text-center cursor-pointer hover:border-goldSoft transition">
              <input type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleFile(f); }} />
              <div className="text-3xl mb-2">📄</div>
              <div className="font-semibold text-deep">{fileName || "اضغط لاختيار ملف Excel أو CSV"}</div>
              <div className="text-xs text-muted mt-1">‎.xlsx يُقرأ مباشرة — لا حاجة لتحويله. Numbers: صدّره Excel أو CSV أولًا</div>
              <div className="text-[11px] text-muted mt-1">🔒 الملف يُقرأ داخل جهازك ولا يُرسل لأي مكان — لا يُحفظ شيء قبل ضغطك «حفظ»</div>
            </label>
          </div>

          {done !== null && (
            <div className="bg-[#E6F4EC] border border-[#B7DFC7] text-[#137a50] rounded-xl p-4 mb-5 flex items-center justify-between flex-wrap gap-3">
              <span>✓ تم استيراد <b>{done}</b> وحدة بنجاح.</span>
              <a href="/dashboard/property" className="btn btn-primary text-sm">عرض العقار ←</a>
            </div>
          )}

          {stage === "map" && analysis && cfg && (
            <MappingStep grid={grid} analysis={analysis} cfg={cfg} setCfg={setCfg} properties={properties}
              sheets={sheets} sheetIdx={sheetIdx}
              onSheet={(i) => { setSheetIdx(i); startSheet(sheets[i].grid, true); }}
              onConfirm={confirmMapping} />
          )}

          {stage === "preview" && rows.length === 0 && done === null && (
            /* ملف كل صفوفه أمثلة أو فارغة: كان لا يظهر شيء إطلاقًا فيظن المكتب أن الرفع تعطّل */
            <div className="bg-[#FFF6E5] border border-[#F2D49B] rounded-xl p-4 mb-5 text-sm leading-relaxed">
              <b className="text-deep">لم نجد صفوف مستأجرين في الملف.</b>
              {colInfo && colInfo.examples > 0 && <> تجاهلنا {colInfo.examples} صفوف أمثلة (المعلَّمة «مثال») — أضف بياناتك تحتها أو مكانها ثم ارفعه من جديد.</>}
              {analysis && <> · <button type="button" onClick={() => setStage("map")} className="text-goldInk font-semibold underline underline-offset-2">✎ مطابقة الأعمدة</button></>}
            </div>
          )}

          {stage === "preview" && rows.length > 0 && (
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
                    {partialCount > 0 && <> · <span className="text-[#8a5a11] font-semibold">{partialCount} فيها مبلغ جزئي — سجّله بعد الرفع</span></>}
                  </div>
                  {colInfo && (
                    /* ما فهمناه من الملف ظاهرًا: عمود بعنوان غير معروف كان يُقرأ بموضعه بصمت (30 سبتمبر 2026) */
                    <div className="text-[11.5px] text-muted mt-1 leading-relaxed">
                      {colInfo.mode === "headers"
                        ? <>الأعمدة المقروءة بالعنوان ({colInfo.recognized.length}): {colInfo.recognized.join("، ")}
                            {colInfo.ignored.length > 0 && <> · <b className="text-[#8a5a11]">تُجوهل ({colInfo.ignored.length}): {colInfo.ignored.join("، ")}</b></>}</>
                        : colInfo.mode === "manual"
                        ? <>مطابقتك ({colInfo.recognized.length}): {colInfo.recognized.join("، ")}
                            {colInfo.ignored.length > 0 && <> · <b className="text-[#8a5a11]">لا تُرفع: {colInfo.ignored.join("، ")}</b></>}</>
                        : <>لم نجد عناوين معروفة — قُرئت الأعمدة بترتيب القالب: {HEADERS.slice(0, 9).join("، ")}…</>}
                      {colInfo.examples > 0 && <> · <b>تم تجاهل {colInfo.examples} صفوف أمثلة</b> (المعلَّمة «مثال»)</>}
                      {analysis && <> · <button type="button" onClick={() => setStage("map")} className="text-goldInk font-semibold underline underline-offset-2">✎ تعديل مطابقة الأعمدة</button></>}
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
                            : <span className="text-paid font-semibold">جاهزة</span>}
                          {!blocked(r) && r._note && <div className={`text-[11px] leading-relaxed mt-0.5 ${r._note.includes("جزئي —") ? "text-[#8a5a11] font-semibold" : "text-muted"}`}>{r._note}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-paper2 border border-line rounded-xl p-4 text-sm text-muted leading-relaxed">
            <b className="text-deep">ملفك بأعمدة أخرى؟</b> ارفعه كما هو — نعرض لك أعمدته لتطابقها، ونسألك إن كان المبلغ سنويًّا أو قيمة الدفعة، والمسدَّد عددًا أو مبلغًا. كل ذلك داخل متصفحك.{" "}
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

/* المبلغ والمسدَّد يُختاران هنا بلا افتراض أساسهما — الأساس يُحدَّد تحت القائمة */
const MAP_LABEL: Partial<Record<Field, string>> = { rent: "مبلغ الإيجار (أساسه تحت)", paid: "المسدَّد (عدد أو مبلغ — تحت)" };
const RENT_BASIS: { v: "payment" | "annual" | "monthly"; l: string; d: string }[] = [
  { v: "payment", l: "قيمة كل دفعة (القسط)", d: "المبلغ الذي يدفعه المستأجر كل مرة" },
  { v: "annual", l: "الإيجار السنوي", d: "نقسمه على عدد الدفعات في السنة: 30,000 بدورة كل 3 أشهر = 7,500" },
  { v: "monthly", l: "الإيجار الشهري", d: "نحوّله حسب الدورة: 2,500 بدورة كل 3 أشهر = 7,500" },
];
const PAID_BASIS: { v: "count" | "amount"; l: string; d: string }[] = [
  { v: "count", l: "عدد الدفعات المسدَّدة", d: "مثل 8 — كم دفعة دفعها من هذا العقد" },
  { v: "amount", l: "المبلغ المسدَّد بالريال", d: "مثل 20,000 — نحوّله لعدد دفعات كاملة وننبّهك على الجزئي" },
];

/**
 * خطوة «طابق أعمدتك»: كل عمود في ملف المكتب ← حقل في وثيق (أو لا يُرفع)،
 * وأساس المبلغ والمسدَّد يُختار صراحةً متى لم يحسمه العنوان. معاينة أول الصفوف
 * تتحدّث مع كل اختيار — يرى المكتب الرقم الذي سيُحفظ قبل أن يتجاوز هذه الخطوة.
 */
function MappingStep({ grid, analysis, cfg, setCfg, properties, sheets, sheetIdx, onSheet, onConfirm }: {
  grid: string[][]; analysis: ColumnAnalysis; cfg: MapConfig; setCfg: (c: MapConfig) => void; properties: Prop[];
  sheets: Sheet[]; sheetIdx: number; onSheet: (i: number) => void; onConfirm: () => void;
}) {
  const first = useMemo(() => firstRowOf(grid).map((c) => String(c ?? "").trim()), [grid]);
  const samples = useMemo(() => columnSamples(grid, cfg.headerRow, analysis.width, 2), [grid, cfg.headerRow, analysis.width]);
  const problems = mappingProblems(cfg);
  const has = (f: Field) => cfg.fields.includes(f);
  /* معاينة حيّة لأول 4 صفوف — بنفس المحلّل الذي سيحفظ */
  const mini = useMemo(() => {
    if (problems.length) return null;
    const ne = grid.filter((r) => (r || []).some((c) => String(c ?? "").trim()));
    return parseGrid(ne.slice(0, (cfg.headerRow ? 1 : 0) + 4), properties, today(), configToOptions(cfg)).rows;
  }, [grid, cfg, properties, problems.length]);
  const set = (patch: Partial<MapConfig>) => setCfg({ ...cfg, ...patch });
  const setField = (i: number, f: Field | null) => {
    const fields = [...cfg.fields];
    fields[i] = f;
    /* عمود المبلغ/المسدَّد تغيّر: أساسه يُسأل من جديد ما لم يحسمه عنوان العمود الجديد */
    const patch: Partial<MapConfig> = { fields };
    const h = cfg.headerRow ? first[i] || "" : "";
    if (f === "rent" || cfg.fields[i] === "rent") patch.rentBasis = f === "rent" ? rentBasisFromHeader(h) : null;
    if (f === "paid" || cfg.fields[i] === "paid") patch.paidBasis = f === "paid" ? paidBasisFromHeader(h) : null;
    set(patch);
  };
  const cols = Array.from({ length: analysis.width }, (_, i) => i)
    .filter((i) => (cfg.headerRow && first[i]) || samples[i].length || cfg.fields[i]);

  return (
    <div className="bg-white border border-line rounded-2xl p-4 sm:p-5 mb-5">
      <h2 className="font-display font-bold text-deep text-lg">طابق أعمدتك</h2>
      <p className="text-sm text-muted mt-1 leading-relaxed">ملفك لا يشبه قالبنا تمامًا — لا بأس. حدّد ماذا يحوي كل عمود، ونقرأه كما تقصد بالضبط.
        {analysis.reasons.length > 0 && <span className="block text-[12.5px] text-[#8a5a11] mt-1">{analysis.reasons.join(" · ")}</span>}</p>
      <div className="text-[11.5px] text-muted mt-2 bg-paper border border-line rounded-lg px-3 py-2">🔒 الملف يُقرأ داخل متصفحك فقط — لا يُرسل ولا يُحفظ منه شيء حتى تراجع المعاينة وتضغط «حفظ».</div>

      {sheets.length > 1 && (
        <label className="block mt-4">
          <span className="block text-sm font-semibold mb-1">الورقة</span>
          <select className="fld" value={sheetIdx} onChange={(e) => onSheet(Number(e.target.value))}>
            {sheets.map((s, i) => <option key={i} value={i}>{s.name} ({s.grid.length} صف)</option>)}
          </select>
        </label>
      )}

      <label className="flex items-center gap-2 mt-4 cursor-pointer min-h-[44px] text-sm">
        <input type="checkbox" className="w-4 h-4" checked={cfg.headerRow} onChange={(e) => set({ headerRow: e.target.checked })} />
        <span>الصف الأول عناوين أعمدة (لا يُرفع كمستأجر)</span>
      </label>

      <div className="mt-2 border border-line rounded-xl divide-y divide-line">
        {cols.map((i) => {
          const f = cfg.fields[i];
          return (
            <div key={i} className={`p-3 flex flex-wrap items-center gap-2 ${!f && samples[i].length ? "bg-[#FFFBF2]" : ""}`}>
              <div className="min-w-0 flex-1 basis-[180px]">
                <div className="text-sm font-semibold text-deep truncate">
                  <span className="text-[11px] text-muted font-normal ml-1.5" dir="ltr">{columnLetter(i)}</span>
                  {(cfg.headerRow && first[i]) || <span className="text-muted font-normal">بلا عنوان</span>}
                </div>
                <div className="text-[11.5px] text-muted truncate">{samples[i].length ? samples[i].join(" · ") : "لا بيانات"}</div>
              </div>
              <select className="fld flex-1 basis-[200px] sm:flex-none sm:w-60" value={f || ""} aria-label={`العمود ${columnLetter(i)}`}
                onChange={(e) => setField(i, (e.target.value || null) as Field | null)}>
                <option value="">— لا يُرفع —</option>
                {FIELDS.map((k) => {
                  const taken = cfg.fields.some((x, j) => x === k && j !== i);
                  return <option key={k} value={k} disabled={taken}>{MAP_LABEL[k] || FIELD_LABEL[k]}{REQUIRED_FIELDS.includes(k) ? " *" : ""}{taken ? " (مختار)" : ""}</option>;
                })}
              </select>
            </div>
          );
        })}
      </div>

      {has("rent") && (
        <fieldset className="mt-4 border border-line rounded-xl p-3">
          <legend className="text-sm font-semibold text-deep px-1">مبلغ الإيجار في ملفك هو…</legend>
          {RENT_BASIS.map((o) => (
            <label key={o.v} className="flex items-start gap-2 cursor-pointer min-h-[44px] py-1">
              <input type="radio" name="rentBasis" className="w-4 h-4 mt-1" checked={cfg.rentBasis === o.v} onChange={() => set({ rentBasis: o.v })} />
              <span className="text-sm"><b>{o.l}</b>{analysis.rentHint === o.v && <span className="text-[11px] text-paid font-semibold"> (من عنوان العمود)</span>}
                <span className="block text-[11.5px] text-muted">{o.d}</span></span>
            </label>
          ))}
        </fieldset>
      )}

      {has("paid") && (
        <fieldset className="mt-3 border border-line rounded-xl p-3">
          <legend className="text-sm font-semibold text-deep px-1">عمود المسدَّد في ملفك هو…</legend>
          {PAID_BASIS.map((o) => (
            <label key={o.v} className="flex items-start gap-2 cursor-pointer min-h-[44px] py-1">
              <input type="radio" name="paidBasis" className="w-4 h-4 mt-1" checked={cfg.paidBasis === o.v} onChange={() => set({ paidBasis: o.v })} />
              <span className="text-sm"><b>{o.l}</b>
                {analysis.paidHint === o.v ? <span className="text-[11px] text-paid font-semibold"> (من عنوان العمود)</span>
                  : !analysis.paidHint && analysis.paidSuggest === o.v ? <span className="text-[11px] text-[#8a5a11] font-semibold"> (الأرجح من قيم ملفك)</span> : null}
                <span className="block text-[11.5px] text-muted">{o.d}</span></span>
            </label>
          ))}
        </fieldset>
      )}

      {(!has("freq") || !has("calendar")) && (
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          {!has("freq") && (
            <label className="block">
              <span className="block text-sm font-semibold mb-1">ملفك بلا عمود دورة سداد — الدورة لكل الصفوف *</span>
              <select className="fld" value={cfg.defFreq || ""} onChange={(e) => set({ defFreq: (e.target.value || null) as Frequency | null })}>
                <option value="">— اختر —</option>
                {FREQUENCIES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </label>
          )}
          {!has("calendar") && (
            <label className="block">
              <span className="block text-sm font-semibold mb-1">تقويم العقود</span>
              <select className="fld" value={cfg.defCal || ""} onChange={(e) => set({ defCal: (e.target.value || null) as MapConfig["defCal"] })}>
                <option value="">تلقائي — حسب صيغة كل تاريخ</option>
                <option value="hijri">هجري لكل العقود</option>
                <option value="gregorian">ميلادي لكل العقود</option>
              </select>
            </label>
          )}
        </div>
      )}

      {mini && mini.length > 0 && (
        <div className="mt-4">
          <div className="text-sm font-semibold text-deep mb-1">هكذا سنقرأ أول الصفوف</div>
          <div className="overflow-x-auto border border-line rounded-xl">
            <table className="w-full text-[12.5px] min-w-[480px]">
              <thead className="bg-paper2"><tr>
                <th className="p-2 text-right font-semibold">المستأجر</th><th className="p-2 text-right font-semibold">الدفعة</th>
                <th className="p-2 text-right font-semibold">الدورة</th><th className="p-2 text-right font-semibold">المسدَّد</th>
                <th className="p-2 text-right font-semibold">ملاحظة</th>
              </tr></thead>
              <tbody>{mini.map((r, k) => (
                <tr key={k} className={`border-t border-line ${r._error ? "bg-[#FBE9E7]" : ""}`}>
                  <td className="p-2">{r.name || "—"}</td>
                  <td className="p-2">{sar(r.rent_amount)}</td>
                  <td className="p-2">{FREQUENCIES.find((x) => x.value === r.payment_frequency)?.label}</td>
                  <td className="p-2">{r.paid_periods} {r.paid_periods === 1 ? "دفعة" : "دفعات"}</td>
                  <td className="p-2">{r._error ? <span className="text-late font-semibold">{r._error}</span> : <span className="text-muted">{r._note || "—"}</span>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="mt-4 rounded-xl border border-[#F2D49B] bg-[#FFF6E5] p-3 text-[12.5px] leading-relaxed list-disc pr-5">
          {problems.map((p, k) => <li key={k}>{p}</li>)}
        </ul>
      )}
      <button type="button" onClick={onConfirm} disabled={problems.length > 0} className="btn btn-gold text-sm mt-4 w-full sm:w-auto justify-center disabled:opacity-40">
        عرض معاينة كل الصفوف ←
      </button>
    </div>
  );
}
