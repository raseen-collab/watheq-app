// ============================================================
// وثيق — بيانات تجريبية واقعية
//
// خمسة عقارات وثمانون وحدة تشبه مكتبًا حقيقيًّا في المدينة: أسماء سعودية،
// عقود هجرية وميلادية، متأخرون ومنتظمون وشواغر وسداد جزئي وتنفيذ قضائي،
// معرض تجاري بضريبة، دفعات مسجّلة ومصروفات ومهام. الغرض أن يرى الزائر
// كل ميزة تعمل على بيانات تفهمها عينه — لا صفوف باسم «test 1».
//
// البيانات حتمية (بذرة ثابتة) فيرى كل مسجّل الصورة نفسها المُراجَعة.
// ============================================================

const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

let seed = 1448;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const FIRST = ["محمد", "أحمد", "عبدالله", "خالد", "فهد", "سعود", "تركي", "بندر", "ناصر", "ماجد", "عبدالرحمن", "سلطان", "يوسف", "عمر", "إبراهيم", "فيصل", "نايف", "سعد", "طلال", "مشعل"];
const LAST = ["الحربي", "العتيبي", "القحطاني", "الشمري", "الدوسري", "المطيري", "الزهراني", "الغامدي", "السبيعي", "الجهني", "الأحمدي", "الصاعدي", "العنزي", "البلوي", "الرشيدي"];
const COMPANIES = ["مؤسسة النخبة التجارية", "شركة الأفق للمقاولات", "مكتب البناء الهندسي", "صيدلية الشفاء", "مطعم ريف الشام", "مركز نور للتجميل", "معرض الأناقة للأثاث", "مؤسسة الرواد للتقنية", "مكتب المستقبل للمحاماة", "شركة الأمانة العقارية"];
const person = () => `${pick(FIRST)} ${pick(LAST)}`;
/**
 * لا أرقام جوال ولا هويات عشوائية — إطلاقًا.
 *
 * أي رقم بصيغة 05xxxxxxxx يخصّ إنسانًا حقيقيًّا في الغالب، وزائر يجرّب زر 💬
 * يرسل تذكير إيجار لغريب باسم مستأجر لا يعرفه. وكذلك رقم الهوية.
 *
 * البديل الأفضل: المستأجر التجريبي يحمل جوال المستخدم نفسه إن كان مسجَّلًا —
 * فيضغط 💬 ويصله التذكير على واتسابه ويرى كيف يبدو للمستأجر. وإن لم يكن
 * مسجَّلًا تبقى الخانة فارغة، فيفتح واتساب بالرسالة جاهزة ويختار المستلم.
 */
let DEMO_PHONE: string | null = null;
export const setDemoPhone = (p: string | null) => { DEMO_PHONE = p || null; };

type Freq = "monthly" | "quarterly" | "semiannual" | "annual";
const PER: Record<Freq, number> = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };

export type DemoTenant = {
  unit: string; name: string; phone: string | null; national_id: string | null; contract_no: string;
  rent_amount: number; payment_frequency: Freq; contract_start: string; contract_periods: number;
  paid_periods: number; partial_amount: number; calendar: "hijri" | "gregorian";
  unit_type: string; rooms: number; baths: number; acs: number;
  status: "active" | "vacated"; move_out_date: string | null; litigation: boolean;
  carried_debt: number; elec_account: string | null; water_account: string | null;
  deposit_amount: number | null;
};
export type DemoProperty = {
  name: string; city: string; address: string; property_type: string; usage: string;
  owner_name: string; grace_days: number; mgmt_fee_pct: number | null;
  vat_enabled: boolean; vat_rate: number; vat_inclusive: boolean;
  soon_days: number | null; imminent_days: number | null; expiring_days: number | null;
  tenants: DemoTenant[];
  expenses: { spent_on: string; amount: number; category: string; unit: string | null; note: string; vendor: string | null; billable: boolean; paid_by: string; status: string }[];
  notes: { text: string; kind: string; due_date: string | null; note_date: string }[];
};

/** يبني المجموعة كاملة نسبةً إلى تاريخ اليوم — فتبقى الحالات حيّة مهما تأخر التسجيل */
export function buildDemo(today = new Date()): DemoProperty[] {
  seed = 1448;
  const shift = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
  /* هوية بصيغة لا يقبلها النظام السعودي (تبدأ بـ9): تُقرأ رقمًا ولا تطابق أحدًا */
  let idCounter = 9000000001;
  const nid = () => String(idCounter++);
  let ej = 4100;
  const ejar = () => "EJ-" + String(ej++);

  /* توزيع الحالات مقصود: كل شارة يجب أن تظهر في أول نظرة */
  const mk = (unit: string, o: Partial<DemoTenant> & { rent_amount: number; payment_frequency: Freq; unit_type: string }): DemoTenant => {
    const per = PER[o.payment_frequency];
    return {
      unit, name: o.name ?? person(), phone: DEMO_PHONE, national_id: null, contract_no: ejar(),
      contract_periods: per, paid_periods: Math.min(per, o.paid_periods ?? int(0, per)),
      partial_amount: 0, calendar: o.calendar ?? (rnd() < 0.6 ? "hijri" : "gregorian"),
      contract_start: o.contract_start ?? shift(-int(20, 330)),
      rooms: o.rooms ?? int(2, 4), baths: o.baths ?? int(1, 3), acs: o.acs ?? int(1, 4),
      status: "active", move_out_date: null, litigation: false, carried_debt: 0,
      elec_account: "DEMO-E-" + unit, water_account: "DEMO-W-" + unit,   // ظاهرة الوهمية لا تشبه حسابًا حقيقيًّا
      deposit_amount: o.rent_amount, ...o,
    } as DemoTenant;
  };

  const props: DemoProperty[] = [];

  // ── 1) عمارة سكنية كبيرة — 24 شقة، أغلبها هجري ──
  {
    const t: DemoTenant[] = [];
    for (let i = 1; i <= 24; i++) {
      const freq = pick(["monthly", "quarterly", "semiannual"] as const);
      const per = PER[freq];
      const start = shift(-int(30, 320));
      t.push(mk(String(100 + i), { rent_amount: pick([2200, 2500, 2800, 3000, 3200]), payment_frequency: freq, unit_type: "apartment",
        contract_start: start, paid_periods: Math.max(0, Math.round(per * (0.6 + rnd() * 0.45))) }));
    }
    // حالات مقصودة
    t[2] = { ...t[2], paid_periods: 0, contract_start: shift(-95) };                       // متأخر 3 أشهر
    t[5] = { ...t[5], partial_amount: 1200, paid_periods: 4, payment_frequency: "monthly", contract_start: shift(-160) }; // جزئي
    t[8] = { ...t[8], status: "vacated", move_out_date: shift(-22), paid_periods: 5, payment_frequency: "monthly", contract_start: shift(-200) }; // شاغرة بدين
    t[11] = { ...t[11], status: "vacated", move_out_date: shift(-8), paid_periods: 12, payment_frequency: "monthly", contract_periods: 12, contract_start: shift(-370) }; // شاغرة مسدَّدة
    t[14] = { ...t[14], litigation: true, paid_periods: 1, payment_frequency: "monthly", contract_start: shift(-210) };     // تنفيذ
    t[17] = { ...t[17], contract_start: shift(-350), payment_frequency: "annual", contract_periods: 1, paid_periods: 1 }; // ينتهي قريبًا
    t[20] = { ...t[20], contract_start: shift(-88), payment_frequency: "quarterly", paid_periods: 0 };                     // يستحق اليوم تقريبًا
    t[22] = { ...t[22], carried_debt: 4500, paid_periods: 2, payment_frequency: "monthly", contract_start: shift(-70) };  // دين مرحَّل
    props.push({
      name: "عمارة الياسمين", city: "المدينة المنورة", address: "حي العزيزية — شارع الملك عبدالعزيز",
      property_type: "residential", usage: "families", owner_name: "عبدالله بن سعد الحربي",
      grace_days: 3, mgmt_fee_pct: 7.5, vat_enabled: false, vat_rate: 15, vat_inclusive: true,
      soon_days: 10, imminent_days: 5, expiring_days: 49, tenants: t,
      expenses: [
        { spent_on: shift(-12), amount: 1850, category: "maintenance", unit: "103", note: "إصلاح تسريب دورة مياه", vendor: "مؤسسة الصيانة السريعة", billable: true, paid_by: "collections", status: "paid" },
        { spent_on: shift(-25), amount: 650, category: "cleaning", unit: null, note: "نظافة الدرج والمدخل — شهري", vendor: "شركة الإتقان للنظافة", billable: true, paid_by: "collections", status: "paid" },
        { spent_on: shift(-4), amount: 3200, category: "maintenance", unit: null, note: "صيانة المصعد — عقد ربع سنوي", vendor: "مصاعد الخليج", billable: true, paid_by: "office", status: "due" },
        { spent_on: shift(-40), amount: 420, category: "utilities", unit: null, note: "كهرباء الأجزاء المشتركة", vendor: null, billable: true, paid_by: "collections", status: "paid" },
      ],
      notes: [
        { text: "تسريب في سقف شقة 103 — تمت المعاينة وينتظر قطع الغيار", kind: "maintenance", due_date: shift(3), note_date: shift(-5) },
        { text: "تجديد تصريح الدفاع المدني للعمارة", kind: "government", due_date: shift(21), note_date: shift(-10) },
        { text: "دهان مدخل العمارة قبل رمضان", kind: "maintenance", due_date: shift(-2), note_date: shift(-30) },
      ],
    });
  }

  // ── 2) عمارة سكني تجاري مختلطة — 18 وحدة (شقق معفاة + محلات بضريبة) ──
  {
    const t: DemoTenant[] = [];
    for (let i = 1; i <= 14; i++) {
      const freq = pick(["monthly", "quarterly", "semiannual"] as const);
      t.push(mk(String(200 + i), { rent_amount: pick([2400, 2700, 3000]), payment_frequency: freq, unit_type: pick(["apartment", "studio"]),
        paid_periods: Math.round(PER[freq] * (0.4 + rnd() * 0.5)) }));
    }
    for (let i = 1; i <= 4; i++) {
      t.push(mk("م" + i, { name: pick(COMPANIES), rent_amount: pick([11500, 13800, 17250]), payment_frequency: "semiannual", unit_type: "shop",
        rooms: 0, baths: 1, acs: 2, paid_periods: i === 2 ? 0 : 1, contract_start: shift(-int(60, 300)) }));
    }
    props.push({
      name: "مجمع الروضة التجاري السكني", city: "المدينة المنورة", address: "حي الروضة — طريق قباء",
      property_type: "residential", usage: "mixed", owner_name: "شركة الأمانة العقارية",
      grace_days: 5, mgmt_fee_pct: 10, vat_enabled: true, vat_rate: 15, vat_inclusive: true,
      soon_days: 14, imminent_days: 5, expiring_days: 60, tenants: t,
      expenses: [
        { spent_on: shift(-18), amount: 2400, category: "maintenance", unit: "م2", note: "تعديل واجهة المحل", vendor: "ورشة الحداد", billable: true, paid_by: "owner", status: "paid" },
        { spent_on: shift(-9), amount: 900, category: "government", unit: null, note: "رسوم رخصة بلدية", vendor: "بلدي", billable: true, paid_by: "collections", status: "paid" },
      ],
      notes: [{ text: "المحل م2 متأخر دفعة كاملة — تواصل هاتفي ثم خطاب رسمي", kind: "financial", due_date: shift(1), note_date: shift(-3) }],
    });
  }

  // ── 3) معرض تجاري — 8 معارض بضريبة ──
  {
    const t: DemoTenant[] = [];
    for (let i = 1; i <= 8; i++) {
      t.push(mk(String(i), { name: COMPANIES[(i + 3) % COMPANIES.length], rent_amount: pick([34500, 46000, 57500]), payment_frequency: pick(["semiannual", "annual"] as const),
        unit_type: "shop", rooms: 0, baths: 1, acs: 3, calendar: "gregorian", paid_periods: i % 3 === 0 ? 0 : 1, contract_start: shift(-int(40, 340)) }));
    }
    t[4] = { ...t[4], status: "vacated", move_out_date: shift(-45), paid_periods: 2, payment_frequency: "semiannual", contract_start: shift(-380) };
    props.push({
      name: "معارض طريق الملك فهد", city: "المدينة المنورة", address: "طريق الملك فهد — مقابل الحديقة",
      property_type: "showroom", usage: "commercial", owner_name: "ورثة محمد الأحمدي",
      grace_days: 0, mgmt_fee_pct: 5, vat_enabled: true, vat_rate: 15, vat_inclusive: false,
      soon_days: 10, imminent_days: 5, expiring_days: 60, tenants: t,
      expenses: [{ spent_on: shift(-14), amount: 5800, category: "maintenance", unit: null, note: "صيانة التكييف المركزي", vendor: "برودة الشمال", billable: true, paid_by: "collections", status: "paid" }],
      notes: [{ text: "المعرض 5 شاغر — نشر إعلان في حراج ومنصة X", kind: "other", due_date: shift(5), note_date: shift(-1) }],
    });
  }

  // ── 4) فلل — 4 فلل سنوية ──
  {
    const t: DemoTenant[] = [];
    for (let i = 1; i <= 4; i++) {
      t.push(mk("فيلا " + i, { rent_amount: pick([65000, 75000, 85000]), payment_frequency: pick(["annual", "semiannual"] as const),
        unit_type: "villa", rooms: int(5, 7), baths: int(4, 6), acs: int(6, 9), paid_periods: 1, contract_start: shift(-int(100, 330)) }));
    }
    t[1] = { ...t[1], contract_start: shift(-345), payment_frequency: "annual", contract_periods: 1, paid_periods: 1 }; // ينتهي قريبًا
    props.push({
      name: "فلل حي النخيل", city: "المدينة المنورة", address: "حي النخيل — مخطط الأمير نايف",
      property_type: "villa", usage: "families", owner_name: "فهد بن ناصر العتيبي",
      grace_days: 7, mgmt_fee_pct: null, vat_enabled: false, vat_rate: 15, vat_inclusive: true,
      soon_days: null, imminent_days: null, expiring_days: 60, tenants: t,
      expenses: [{ spent_on: shift(-6), amount: 1500, category: "maintenance", unit: "فيلا 3", note: "صيانة مضخة المياه", vendor: null, billable: true, paid_by: "collections", status: "paid" }],
      notes: [{ text: "فيلا 2 — عقدها ينتهي قريبًا: مفاوضة التجديد بزيادة 5%", kind: "renewal", due_date: shift(10), note_date: shift(-2) }],
    });
  }

  // ── 5) مبنى مكاتب — 26 مكتبًا ──
  {
    const t: DemoTenant[] = [];
    for (let i = 1; i <= 26; i++) {
      const freq = pick(["quarterly", "semiannual", "annual"] as const);
      t.push(mk(String(300 + i), { name: rnd() < 0.5 ? pick(COMPANIES) : person(), rent_amount: pick([18000, 24000, 30000, 36000]), payment_frequency: freq,
        unit_type: "office", rooms: int(1, 3), baths: 1, acs: int(1, 3), calendar: "gregorian",
        paid_periods: Math.round(PER[freq] * (0.6 + rnd() * 0.45)), contract_start: shift(-int(30, 340)) }));
    }
    t[3] = { ...t[3], paid_periods: 0, contract_start: shift(-200), payment_frequency: "quarterly" };
    t[9] = { ...t[9], status: "vacated", move_out_date: shift(-60), paid_periods: 4, payment_frequency: "quarterly", contract_start: shift(-400) };
    t[15] = { ...t[15], status: "vacated", move_out_date: shift(-15), paid_periods: 2, payment_frequency: "semiannual", contract_start: shift(-370) };
    props.push({
      name: "برج الأعمال", city: "المدينة المنورة", address: "حي الخالدية — شارع الجامعات",
      property_type: "office", usage: "commercial", owner_name: "شركة الأفق للاستثمار",
      grace_days: 3, mgmt_fee_pct: 8, vat_enabled: true, vat_rate: 15, vat_inclusive: true,
      soon_days: 14, imminent_days: 7, expiring_days: 60, tenants: t,
      expenses: [
        { spent_on: shift(-20), amount: 7200, category: "utilities", unit: null, note: "كهرباء وماء الأجزاء المشتركة — شهري", vendor: null, billable: true, paid_by: "collections", status: "paid" },
        { spent_on: shift(-3), amount: 2100, category: "cleaning", unit: null, note: "نظافة وأمن — شهري", vendor: "شركة الحماية", billable: true, paid_by: "collections", status: "paid" },
        { spent_on: shift(-30), amount: 480, category: "other", unit: null, note: "لوحة إعلانية للمكتب", vendor: null, billable: false, paid_by: "office", status: "paid" },
      ],
      notes: [{ text: "المكتب 310 شاغر منذ شهرين — مراجعة السعر المطلوب", kind: "other", due_date: shift(-4), note_date: shift(-20) }],
    });
  }

  return props;
}

/** الدفعات المسجّلة: لكل وحدة مسدَّدة دفعة أو أكثر، ننشئ سجلًّا حقيقيًّا يظهر في التقارير */
export function demoPayments(p: DemoProperty, today = new Date()) {
  const out: { unit: string; paid_on: string; amount: number; method: string; note: string | null; reference: string | null }[] = [];
  const shift = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
  for (const t of p.tenants) {
    const n = Math.min(t.paid_periods, 3);            // آخر ثلاث دفعات تكفي لتقرير حيّ
    for (let i = 0; i < n; i++) {
      out.push({ unit: t.unit, paid_on: shift(-int(2, 85) - i * 25), amount: t.rent_amount,
        method: pick(["transfer", "transfer", "cash", "pos"]), note: i === 0 && rnd() < 0.3 ? "حوالة بنكية" : null,
        reference: rnd() < 0.7 ? String(int(1000, 9999)) : null });
    }
  }
  return out;
}
