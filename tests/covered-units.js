/* عقد واحد يشمل عدة شقق (13 نوفمبر 2026) — ملف «الأولى»: المبلغ على شقة واحدة من كل عقد
   تشغيل: npx esbuild lib/importParse.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/importParse.js
           npx esbuild lib/contracts.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/contracts.js
           npx esbuild lib/contract-state.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/contract-state.js
           node tests/covered-units.js */
const P = require("/tmp/b/importParse.js");
const C = require("/tmp/b/contracts.js");
const S = require("/tmp/b/contract-state.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const H = ["اسم المستأجر","رقم الوحدة","قيمة الدفعة","دورة السداد","بداية العقد","عدد الدفعات","الجوال","رقم الهوية","الدفعات المسدّدة","العقار (اختياري)","حساب الكهرباء (اختياري)","حساب الماء (اختياري)","رقم العقد (اختياري)"];
const g = [H,
  ["فهد","ش3","47500","كل 3 اشهر","2026-01-01","12","","","2","مركز","","","111"],
  ["فهد","ش4","","","","","","","","مركز","","","111"],
  ["","ش5","","","","","","","","مركز","","","111"],
  ["سعد","ش6","","","","","","","","مركز","","","111"],          // اسم آخر ⇒ لا يُشمل
  ["فهد","ش7","","كل 3 اشهر","2026-05-01","","","","","مركز","","","111"], // بداية أخرى ⇒ لا يُشمل
  ["علي","ش8","","","","","","","","مركز","","","999"],          // لا رئيسية
  ["","ب1","","","","","","","","مركز","","","" ],                 // شاغرة
  ["","ب2","3000","","","","","","","مركز","","","" ],             // مبلغ بلا اسم ⇒ خطأ
];
const { rows } = P.parseGrid(g, [{ id: "Z", name: "مركز" }], "2026-11-13");
const u = (x) => rows.find((r) => r.unit === x);
t("lead ok", !u("ش3")._error && u("ش3").rent_amount === 47500 && !u("ش3")._cover);
t("ش4 covered by ش3", u("ش4")._cover === "ش3" && u("ش4").rent_amount === 0 && u("ش4").paid_periods === 0 && u("ش4").contract_start === "2026-01-01" && !u("ش4")._error);
t("ش5 empty name inherits", u("ش5")._cover === "ش3" && u("ش5").name === "فهد");
t("ش6 other tenant rejected", !!u("ش6")._error && !u("ش6")._cover);
t("ش7 other start rejected", !!u("ش7")._error && !u("ش7")._cover);
t("ش8 no lead rejected with hint", /لا توجد في الملف وحدة أخرى بالعقد 999/.test(u("ش8")._error || ""));
t("ب1 vacant", u("ب1")._vacant === true && !u("ب1")._error && u("ب1").name === "شاغرة");
t("ب2 amount without name stays error", u("ب2")._error === "الاسم مفقود");
const st = C.contractState({ covered_by: "x", rent_amount: 0, contract_start: "2026-01-01", payment_frequency: "quarterly", paid_periods: 0, contract_periods: 12, status: "active" });
t("covered state: not incomplete, nothing owed", st.incomplete === false && st.unpaid === 0 && st.amountDue === 0 && st.status === "ok" && st.totalOwed === 0);
const st2 = C.contractState({ covered_by: "x", rent_amount: 0, contract_start: "2026-01-01", payment_frequency: "quarterly", status: "vacated", move_out_date: "2026-10-01" });
t("vacated covered = vacant path", st2.vacant === true);
t("covered: no duplicate renewal alert", S.renewalDue({ covered_by: "x", status: "active" }, { daysToEnd: -5 }) === false && st.daysToEnd === null);
t("covered: status ok", S.unitStatus({ covered_by: "x" }, { status: "ok", daysToEnd: -5 }) === "ok");
console.log(bad ? `❌ ${bad} فشل` : `✅ ${ok} اختبار — العقد الذي يشمل عدة وحدات`);
process.exit(bad ? 1 : 0);
