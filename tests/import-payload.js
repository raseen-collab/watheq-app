/* حمولة حفظ رفع الإكسل — اختبار انحدار دائم (16 نوفمبر 2026)
   سبب وجوده: عطل 14 نوفمبر (صف شاغر واحد ⇒ status = null للدفعة كلها ⇒ فشل الملف) وقع في
   بناء الحمولة داخل ImportView، ولم يكن يختبره شيء. الآن الحمولة في lib/importPayload.ts
   ويُفحص هنا كل تركيب: شاغرة + ضمن عقد + دين مرحّل + هجري + بداية مستقبلية + جزئي +
   أول استحقاق + عقارات متعددة + جوالات فوضوية — في ملف واحد، كما يأتي من المكاتب.
   تشغيل: npx esbuild lib/importParse.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/importParse.js
           npx esbuild lib/importPayload.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/importPayload.js
           TZ=Asia/Riyadh node tests/import-payload.js */
const P = require("/tmp/b/importParse.js");
const L = require("/tmp/b/importPayload.js");
let ok = 0, bad = 0;
const t = (name, cond, extra) => { if (cond) ok++; else { bad++; console.log("✗", name, extra === undefined ? "" : JSON.stringify(extra)); } };
const TODAY = "2026-11-16";
const PROPS = [{ id: "p-a", name: "عمارة النخيل" }, { id: "p-b", name: "مركز الواحة" }];
const OPTS = { dueChoice: "keep", today: TODAY };

/* قالب وثيق بأعمدة صريحة (العناوين كما في HEADERS) */
const H = ["اسم المستأجر", "رقم الوحدة", "قيمة الدفعة", "دورة السداد", "بداية العقد", "عدد الدفعات", "الجوال", "رقم الهوية", "الدفعات المسددة",
  "العقار", "رقم العقد", "دين مرحل", "أول استحقاق", "عدد الغرف", "جوال إضافي"];
const row = (o) => H.map((h) => o[h] ?? "");
const grid = [H,
  row({ "اسم المستأجر": "محمد", "رقم الوحدة": "1", "قيمة الدفعة": "2500", "دورة السداد": "شهري", "بداية العقد": "2026-01-01", "عدد الدفعات": "12", "الجوال": "0550000001", "الدفعات المسددة": "8", "العقار": "عمارة النخيل" }),
  // شاغرة (بلا اسم ولا مبلغ ولا عقد)
  row({ "رقم الوحدة": "2", "العقار": "عمارة النخيل" }),
  // هجري + دين مرحّل + عدد غرف خارج المدى
  row({ "اسم المستأجر": "سعد", "رقم الوحدة": "3", "قيمة الدفعة": "6000", "دورة السداد": "ربع سنوي", "بداية العقد": "1447/05/01", "عدد الدفعات": "4", "الجوال": "966550000003", "الدفعات المسددة": "1", "العقار": "عمارة النخيل", "دين مرحل": "1500", "عدد الغرف": "99" }),
  // عقد متعدد الشقق: الرئيسية 4 والمشمولة 5
  row({ "اسم المستأجر": "شركة الأفق", "رقم الوحدة": "4", "قيمة الدفعة": "30000", "دورة السداد": "سنوي", "بداية العقد": "2026-03-01", "عدد الدفعات": "1", "الجوال": "0550000004", "العقار": "عمارة النخيل", "رقم العقد": "K-77" }),
  row({ "اسم المستأجر": "شركة الأفق", "رقم الوحدة": "5", "العقار": "عمارة النخيل", "رقم العقد": "K-77" }),
  // بداية مستقبلية + أول استحقاق مختلف
  row({ "اسم المستأجر": "نورة", "رقم الوحدة": "6", "قيمة الدفعة": "3000", "دورة السداد": "شهري", "بداية العقد": "2027-01-01", "عدد الدفعات": "12", "الجوال": "0550000006", "العقار": "عمارة النخيل", "أول استحقاق": "2027-01-10" }),
  // جوالان في خانة واحدة
  row({ "اسم المستأجر": "فهد", "رقم الوحدة": "7", "قيمة الدفعة": "2000", "دورة السداد": "شهري", "بداية العقد": "2026-06-01", "عدد الدفعات": "12", "الجوال": "0550000007 / 0560000007", "العقار": "عمارة النخيل" }),
  // جوال إضافي بنص طويل فيه رقم
  row({ "اسم المستأجر": "خالد", "رقم الوحدة": "8", "قيمة الدفعة": "2000", "دورة السداد": "شهري", "بداية العقد": "2026-06-01", "عدد الدفعات": "12", "الجوال": "0550000008", "العقار": "عمارة النخيل", "جوال إضافي": "0560000008 أخوه الكبير للطوارئ فقط" }),
  // جوال إضافي نص طويل بلا رقم (كان يُسقط الدفعة كلها: phone2 > 30)
  row({ "اسم المستأجر": "ريم", "رقم الوحدة": "9", "قيمة الدفعة": "2000", "دورة السداد": "شهري", "بداية العقد": "2026-06-01", "عدد الدفعات": "12", "الجوال": "0550000009", "العقار": "عمارة النخيل", "جوال إضافي": "يتواصل عن طريق المكتب الرئيسي فقط بعد العصر" }),
  // عقار ثانٍ في الملف نفسه + شاغرة فيه
  row({ "اسم المستأجر": "مؤسسة البناء", "رقم الوحدة": "م1", "قيمة الدفعة": "12000", "دورة السداد": "نصف سنوي", "بداية العقد": "2026-02-01", "عدد الدفعات": "2", "الجوال": "0550000010", "الدفعات المسددة": "1", "العقار": "مركز الواحة" }),
  row({ "رقم الوحدة": "م2", "العقار": "مركز الواحة" }),
];

const { rows } = P.parseGrid(grid, PROPS, TODAY);
const by = (u) => rows.find((r) => r.unit === u);
t("parse: 11 rows", rows.length === 11, rows.length);
t("parse: no blocking errors", rows.every((r) => !r._error), rows.filter((r) => r._error).map((r) => [r.unit, r._error]));
t("parse: unit 2 vacant", by("2") && by("2")._vacant === true, by("2"));
t("parse: unit 5 covered by 4", by("5") && by("5")._cover === "4" && by("5").rent_amount === 0, by("5"));
t("parse: hijri", by("3") && by("3").calendar === "hijri", by("3") && by("3").calendar);
t("parse: two phones split", by("7") && by("7").phone === "0550000007" && by("7").phone2 === "0560000007", by("7") && [by("7").phone, by("7").phone2, by("7")._note]);
t("parse: phone2 number extracted from text", by("8") && by("8").phone2 === "0560000008", by("8") && by("8").phone2);
t("parse: unreadable long phone2 dropped with note", by("9") && !by("9").phone2 && /جوال إضافي/.test(by("9")._note || ""), by("9") && [by("9").phone2, by("9")._note]);
t("parse: second property", by("م1") && by("م1").prop_id === "p-b" && by("م2") && by("م2")._vacant, [by("م1") && by("م1").prop_id]);

/* التجميع كما في ImportView: كل صف لعقاره */
const groups = new Map();
rows.forEach((r) => { const pid = r.prop_id; (groups.get(pid) || groups.set(pid, []).get(pid)).push(r); });
const all = [];
for (const [pid, list] of groups) {
  const { main, covered } = L.buildImportPayload(list, pid, OPTS);
  const probsMain = L.importPayloadProblems(main);
  t(`payload ${pid}: main has no DB problems`, probsMain.length === 0, probsMain);
  // كل دفعة 100 كما في الواجهة — مفاتيح متطابقة داخل كل دفعة
  for (let i = 0; i < main.length; i += 100) t(`payload ${pid}: batch keys uniform`, L.importPayloadProblems(main.slice(i, i + 100)).length === 0);
  const res = L.resolveCovered(covered, (u) => (u === "4" ? "lead-id-4" : undefined));
  t(`payload ${pid}: covered resolved`, res.missing === 0, res);
  t(`payload ${pid}: covered no DB problems`, L.importPayloadProblems(res.rows).length === 0, L.importPayloadProblems(res.rows));
  all.push(...main.map((x) => ({ ...x, _batch: "main" })), ...res.rows.map((x) => ({ ...x, _batch: "covered" })));
}
const P_ = (u) => all.find((r) => r.unit === u);
t("payload: vacant has status vacated + no dates", P_("2").status === "vacated" && P_("2").contract_start === null && P_("2").contract_end === null && P_("2").move_out_date === TODAY, P_("2"));
t("payload: non-vacant status active (the 14 Nov bug)", ["1", "3", "4", "6", "7", "8", "9", "م1"].every((u) => P_(u).status === "active"), all.map((r) => [r.unit, r.status]));
t("payload: hijri end ≠ gregorian end", P_("3").calendar === "hijri" && P_("3").contract_end && P_("3").contract_end < "2026-10-23", P_("3").contract_end);
t("payload: carried debt + note", P_("3").carried_debt === 1500 && P_("3").carried_debt_note === "رصيد سابق من ملف الرفع", P_("3"));
t("payload: debt-less row has note key = null (not missing)", "carried_debt_note" in P_("1") && P_("1").carried_debt_note === null, P_("1"));
t("payload: rooms clamped 99 → 50", P_("3").rooms === 50, P_("3").rooms);
t("payload: covered row → covered_by, rent 0, separate batch", P_("5").covered_by === "lead-id-4" && P_("5").rent_amount === 0 && P_("5")._batch === "covered", P_("5"));
t("payload: future start, anchor from first_due (10)", P_("6").billing_anchor_day === 10 && P_("6").first_due === "2027-01-10", P_("6"));
t("payload: dueChoice drop → anchor from start (1), first_due null", (() => {
  const r = L.tenantInsertRow({ ...by("6"), _due: "x" }, "p-a", { dueChoice: "drop", today: TODAY });
  return r.billing_anchor_day === 1 && r.first_due === null;
})());
t("payload: phone2 ≤ 30 everywhere", all.every((r) => !r.phone2 || r.phone2.length <= 30));
t("payload: no undefined values anywhere", all.every((r) => Object.values(r).every((v) => v !== undefined)), all.filter((r) => Object.values(r).some((v) => v === undefined)).map((r) => r.unit));
t("payload: second property rows carry its id", P_("م1").property_id === "p-b" && P_("م2").property_id === "p-b" && P_("1").property_id === "p-a");

/* «ضمن عقد» وحدتها الرئيسية مكرّرة في الملف ⇒ تُعلَّم بخطأ قبل الحفظ (لا فشل بعد حفظ الباقي) */
{
  const g2 = [H,
    row({ "اسم المستأجر": "شركة الأفق", "رقم الوحدة": "4", "قيمة الدفعة": "30000", "دورة السداد": "سنوي", "بداية العقد": "2026-03-01", "عدد الدفعات": "1", "رقم العقد": "K-77" }),
    row({ "اسم المستأجر": "شركة الأفق", "رقم الوحدة": "4", "قيمة الدفعة": "30000", "دورة السداد": "سنوي", "بداية العقد": "2026-03-01", "عدد الدفعات": "1", "رقم العقد": "K-78" }),
    row({ "اسم المستأجر": "شركة الأفق", "رقم الوحدة": "5", "رقم العقد": "K-77" }),
  ];
  const r2 = P.parseGrid(g2, PROPS, TODAY).rows;
  const c = r2.find((r) => r.unit === "5");
  t("covered with blocked lead → blocked too", c && !!c._error && /الوحدة الرئيسية/.test(c._error), c && c._error);
}

/* importPayloadProblems يلتقط فعلًا الأنماط التي أسقطت ملفات سابقًا */
{
  const good = L.tenantInsertRow(by("1"), "p-a", OPTS);
  const missingKey = { ...good }; delete missingKey.status;
  t("problems: missing key in one row caught", L.importPayloadProblems([good, missingKey]).some((m) => /مفاتيح/.test(m)));
  t("problems: null status caught", L.importPayloadProblems([{ ...good, status: null }]).some((m) => /status/.test(m)));
  t("problems: undefined value caught", L.importPayloadProblems([{ ...good, unit_type: undefined }]).some((m) => /undefined/.test(m)));
  t("problems: long phone2 caught", L.importPayloadProblems([{ ...good, phone2: "x".repeat(31) }]).some((m) => /phone2/.test(m)));
  t("problems: bad vat_mode caught", L.importPayloadProblems([{ ...good, vat_mode: null }]).some((m) => /vat_mode/.test(m)));
  t("problems: rooms 51 caught", L.importPayloadProblems([{ ...good, rooms: 51 }]).some((m) => /rooms/.test(m)));
}

/* splitPhones مباشرة */
{
  const s = P.splitPhones;
  t("phones: +966 normalized", s("+966 55 000 0001", "").phone === "0550000001");
  t("phones: landline untouched", s("0112345678", "").phone === "0112345678");
  t("phones: phone2 = phone dropped", s("0550000001", "0550000001").phone2 === "");
  t("phones: two in main, phone2 occupied → keep phone2", (() => { const x = s("0550000001 - 0560000001", "0570000001"); return x.phone === "0550000001" && x.phone2 === "0570000001"; })());
  t("phones: text + one mobile → number only", s("0550000001 أبو محمد", "").phone === "0550000001");
  t("phones: arabic digits", s("٠٥٥٠٠٠٠٠٠١", "").phone === "0550000001");
}

console.log(`import-payload: ${ok} ✅ ${bad ? bad + " ❌" : ""}`);
process.exit(bad ? 1 : 0);
