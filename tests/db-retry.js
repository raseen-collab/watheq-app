/* إعادة المحاولة على انحراف الساعة والأخطاء العابرة.
   npx esbuild lib/db-retry.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/db-retry.js */
const { withClockSkewRetry, isClockSkew, isTransient } = require("/tmp/b/db-retry.js");

let fails = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log(`❌ ${name}\n   نتج: ${g}\n   المتوقع: ${w}`); }
  else console.log(`✓ ${name}`);
};

/* ═══ 1) التمييز: ما يستحق إعادة المحاولة وما لا يستحق ═══ */
eq("انحراف الساعة يُلتقط", isClockSkew("JWT issued at future"), true);
eq("ومهما اختلفت الحالة", isClockSkew("jwt ISSUED AT FUTURE"), true);
eq("الجلسة المنتهية ليست انحرافًا", isClockSkew("JWT expired"), false);

eq("المهلة عابرة", isTransient("Gateway Timeout"), true);
eq("انقطاع الشبكة عابر", isTransient("fetch failed"), true);
eq("504 عابر", isTransient("upstream 504"), true);
eq("انحراف الساعة عابر أيضًا", isTransient("JWT issued at future"), true);

/* الحاسم: خطأ صلاحيات يجب أن يظهر فورًا، لا أن ينتظر 4 ثوانٍ ثم يظهر */
eq("رفض الصلاحية ليس عابرًا", isTransient("permission denied for table profiles"), false);
eq("خطأ العمود ليس عابرًا", isTransient('column "x" does not exist'), false);
eq("not authorized ليس عابرًا", isTransient("not authorized"), false);
eq("فارغ ليس عابرًا", isTransient(null), false);

/* ═══ 2) سلوك إعادة المحاولة ═══ */
const run = async () => {
  /* ينجح من أول مرة: لا انتظار ولا محاولة ثانية */
  let calls = 0;
  let r = await withClockSkewRetry(() => { calls++; return Promise.resolve({ data: [1], error: null }); }, [5, 5]);
  eq("النجاح لا يُعيد المحاولة", [calls, r.data], [1, [1]]);

  /* ينجح في الثانية: المستخدم لا يرى شيئًا */
  calls = 0;
  r = await withClockSkewRetry(() => {
    calls++;
    return Promise.resolve(calls === 1
      ? { data: null, error: { message: "JWT issued at future" } }
      : { data: ["ok"], error: null });
  }, [5, 5]);
  eq("انحراف عابر يُمتص في المحاولة الثانية", [calls, r.error, r.data], [2, null, ["ok"]]);

  /* يفشل دائمًا: يعود الخطأ كما هو بعد استنفاد المحاولات */
  calls = 0;
  r = await withClockSkewRetry(() => {
    calls++;
    return Promise.resolve({ data: null, error: { message: "JWT issued at future" } });
  }, [5, 5]);
  eq("الانحراف الطويل يعود خطأً صريحًا", [calls, r.error.message], [3, "JWT issued at future"]);

  /* خطأ صلاحيات: محاولة واحدة فقط — لا تأخير بلا فائدة */
  calls = 0;
  r = await withClockSkewRetry(() => {
    calls++;
    return Promise.resolve({ data: null, error: { message: "permission denied for table profiles" } });
  }, [5, 5]);
  eq("خطأ الصلاحية يظهر فورًا بلا انتظار", calls, 1);

  /* المُنشئ thenable لا Promise — كما يُرجعه Supabase فعلًا */
  calls = 0;
  r = await withClockSkewRetry(() => ({
    then: (res) => { calls++; res(calls === 1 ? { data: null, error: { message: "fetch failed" } } : { data: [7], error: null }); },
  }), [5]);
  eq("يعمل مع thenable لا Promise", [calls, r.data], [2, [7]]);

  console.log(fails ? `\n❌ ${fails} فشل` : "\n✅ إعادة المحاولة تمتص العابر وتُظهر الدائم فورًا");
  process.exit(fails ? 1 : 0);
};
run();
