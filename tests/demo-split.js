/* فصل بيانات التجربة — اختبار التعريف الواحد الذي تعتمد عليه كل لوحات الإدارة.
   يُبنى أولًا: npx esbuild lib/real-data.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/real-data.js */
const { splitDemo } = require("/tmp/b/real-data.js");

let fails = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log(`❌ ${name}\n   نتج: ${g}\n   المتوقع: ${w}`); }
};

/* الحالة الحقيقية المرصودة على المنصة (27 سبتمبر 2026):
   حسابان لم يُدخلا إلا بذرة التجربة — 5 عقارات و80 وحدة و148 دفعة لكل منهما —
   وحساب ثالث فيه بيانات حقيقية، ورابع جمع الاثنين. */
const props = [];
const tenants = [];
const pays = [];
const seed = (uid, n, demo) => {
  for (let i = 0; i < n; i++) {
    const id = `${uid}-p${i}-${demo ? "d" : "r"}`;
    props.push({ id, user_id: uid, is_demo: demo });
    for (let u = 0; u < 16; u++) tenants.push({ id: `${id}-t${u}`, property_id: id });
    for (let k = 0; k < 4; k++) pays.push({ id: `${id}-y${k}`, user_id: uid, property_id: id });
  }
};
seed("demo1", 5, true);                         // ديمو فقط
seed("demo2", 5, true);                         // ديمو فقط
seed("real1", 7, false);                        // حقيقي فقط
seed("both", 5, true); seed("both", 2, false);  // جرّب الديمو ثم أدخل بياناته
pays.push({ id: "orphan", user_id: "real1", property_id: null }); // دفعة بلا عقار

const s = splitDemo(props, tenants, pays, [{ user_id: "assocOnly" }]);

eq("العقارات الحقيقية", s.realProperties.length, 9);          // 7 + 2
eq("الوحدات الحقيقية", s.realTenants.length, 9 * 16);
eq("الدفعات الحقيقية", s.realPayments.length, 9 * 4 + 1);     // + اليتيمة
eq("عقارات الديمو", s.demoPropIds.size, 15);                  // 5 + 5 + 5

eq("حساب ديمو فقط (1)", s.demoOnly("demo1"), true);
eq("حساب ديمو فقط (2)", s.demoOnly("demo2"), true);
eq("حساب فيه حقيقي لا يُعدّ ديمو", s.demoOnly("both"), false);
eq("حساب بلا ديمو أصلًا", s.demoOnly("real1"), false);
eq("صاحب جمعية بلا عقار ليس ديمو", s.demoOnly("assocOnly"), false);

// حواف
const empty = splitDemo([], [], []);
eq("لا بيانات", [empty.realProperties.length, empty.realTenants.length, empty.realPayments.length], [0, 0, 0]);
eq("لا بيانات — demoOnly", empty.demoOnly("x"), false);

const nulls = splitDemo(
  [{ id: "a", user_id: "u", is_demo: null }, { id: "b", user_id: "u", is_demo: undefined }],
  [{ id: "t", property_id: "a" }],
  [{ id: "y", property_id: "b" }],
);
eq("is_demo فارغ يُعدّ حقيقيًّا", [nulls.realProperties.length, nulls.realTenants.length, nulls.realPayments.length], [2, 1, 1]);

/* وحدة مربوطة بعقار غير موجود في الجدول: لا تُحسب حقيقية بلا عقار معروف */
const orphanUnit = splitDemo([{ id: "a", user_id: "u", is_demo: true }], [{ id: "t", property_id: "zz" }], []);
eq("وحدة بعقار مجهول تبقى محسوبة", orphanUnit.realTenants.length, 1);

console.log(fails ? `\n❌ ${fails} فشل` : "✅ فصل بيانات التجربة سليم");
process.exit(fails ? 1 : 0);
