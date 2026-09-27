/* فصل الديمو وتعريف «العميل الدافع» — التعريفان اللذان تعتمد عليهما كل لوحات الإدارة.
   يُبنى أولًا: npx esbuild lib/real-data.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/real-data.js */
const { splitDemo, isPayingCustomer } = require("/tmp/b/real-data.js");

let fails = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log(`❌ ${name}\n   نتج: ${g}\n   المتوقع: ${w}`); }
};
const DAY = 86400000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

/* ═══ 1) العطل الذي كسر كل شيء: حذف عقار تجريبي يُفرّغ مرجع دفعاته ═══
   payments.property_id = on delete set null. قبل وسم الدفعة نفسها كانت
   الدفعات اليتيمة تُقرأ حقيقية، فيظهر حساب لم يُدخل شيئًا «يحصّل إيجارات». */
{
  const props = [{ id: "d1", user_id: "u", is_demo: true }];
  const pays = [
    { id: "p1", property_id: "d1", is_demo: true },   // دفعة ديمو بعقارها
    { id: "p2", property_id: null, is_demo: true },   // عقارها حُذف — الوسم باقٍ
    { id: "p3", property_id: null },                  // دفعة حقيقية بلا عقار
  ];
  const s = splitDemo(props, [], pays);
  eq("الدفعة التجريبية اليتيمة تبقى تجريبية", s.realPayments.map((p) => p.id), ["p3"]);
  eq("الحساب يبقى «ديمو فقط» بعد حذف عقاره", s.demoOnly("u"), true);
}

/* الصفوف القديمة التي سبقت الوسم: المرجع وحده يكفي */
{
  const s = splitDemo(
    [{ id: "d1", user_id: "u", is_demo: true }, { id: "r1", user_id: "u", is_demo: false }],
    [], [{ id: "old", property_id: "d1" }, { id: "real", property_id: "r1" }],
  );
  eq("دفعة قديمة بلا وسم تُعرف من عقارها", s.realPayments.map((p) => p.id), ["real"]);
}

/* الوحدات تتبع عقارها (on delete cascade فلا يتامى) */
{
  const s = splitDemo(
    [{ id: "d", user_id: "u", is_demo: true }, { id: "r", user_id: "u" }],
    [{ id: "t1", property_id: "d" }, { id: "t2", property_id: "r" }], [],
  );
  eq("الوحدة التجريبية تُستثنى", s.realTenants.map((t) => t.id), ["t2"]);
  eq("حساب فيه حقيقي ليس «ديمو فقط»", s.demoOnly("u"), false);
}

/* حواف */
{
  const e = splitDemo([], [], []);
  eq("لا بيانات", [e.realProperties.length, e.realTenants.length, e.realPayments.length], [0, 0, 0]);
  const n = splitDemo(
    [{ id: "a", user_id: "u", is_demo: null }],
    [{ id: "t", property_id: "a" }],
    [{ id: "y", property_id: "a", is_demo: null }],
  );
  eq("is_demo فارغ يُعدّ حقيقيًّا", [n.realProperties.length, n.realTenants.length, n.realPayments.length], [1, 1, 1]);
  eq("صاحب جمعية بلا عقار ليس ديمو",
     splitDemo([], [], [], [{ user_id: "a" }]).demoOnly("a"), false);
}

/* ═══ 2) «عميل دافع» — التعريف الذي كان محسوبًا بثلاث طرق ═══ */
{
  const admins = ["me"];
  const members = new Set(["emp"]);
  const o = { admins, memberIds: members };

  eq("مشترك ساري",
     isPayingCustomer({ id: "a", plan: "pro", subscribed_until: inDays(30) }, o), true);

  /* فترة السماح 5 أيام: هنا كان /admin يقول «دافع» وتليجرام «غير دافع» */
  eq("داخل فترة السماح يُعدّ دافعًا في كل الشاشات",
     isPayingCustomer({ id: "b", plan: "pro", subscribed_until: inDays(-2) }, o), true);
  eq("بعد السماح لا يُعدّ دافعًا",
     isPayingCustomer({ id: "c", plan: "pro", subscribed_until: inDays(-30) }, o), false);

  /* باقة مضبوطة يدويًّا بلا تاريخ — subState يعدّها سارية */
  eq("باقة بلا تاريخ اشتراك تُعدّ سارية",
     isPayingCustomer({ id: "d", plan: "pro", subscribed_until: null }, o), true);

  /* تاريخ مستقبلي بلا باقة — المقارنة المباشرة كانت تعدّه دافعًا */
  eq("تاريخ مستقبلي بلا باقة ليس دافعًا",
     isPayingCustomer({ id: "e", plan: null, subscribed_until: inDays(30) }, o), false);

  eq("حسابك أنت ليس عميلًا دافعًا",
     isPayingCustomer({ id: "me", plan: "pro", subscribed_until: inDays(700) }, o), false);
  eq("الموظف ليس عميلًا دافعًا",
     isPayingCustomer({ id: "emp", plan: "pro", subscribed_until: inDays(30) }, o), false);
  eq("في تجربة ليس دافعًا",
     isPayingCustomer({ id: "f", plan: null, trial_ends_at: inDays(10) }, o), false);
  eq("بلا خيارات: حسابك يُعدّ دافعًا (السلوك الافتراضي)",
     isPayingCustomer({ id: "me", plan: "pro", subscribed_until: inDays(700) }), true);
}

console.log(fails ? `\n❌ ${fails} فشل` : "✅ فصل الديمو وتعريف الدافع سليمان");
process.exit(fails ? 1 : 0);
