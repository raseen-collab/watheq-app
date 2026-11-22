/* buildBackup بقاعدة وهمية: صفحات >1000، مفتاح مركّب، جدول يفشل، المستخدمون
   تشغيل: (بعد بناء /tmp/b/backup.js كما في tests/backup.js) node tests/backup-build.js */
const { buildBackup } = require("/tmp/b/backup.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const DATA = {
  payments: Array.from({ length: 2345 }, (_, i) => ({ id: 2345 - i, amount: i })), // مخزّنة بغير ترتيب
  team_members: [{ owner_id: "b", member_id: "1" }, { owner_id: "a", member_id: "2" }],
  broken: null,
};
const orders = {};
function from(name) {
  const st = { ord: [] };
  const q = {
    select() { return q; },
    order(c) { st.ord.push(c); orders[name] = st.ord.slice(); return q; },
    async range(a, b) {
      if (DATA[name] === null) return { data: null, error: { message: "permission denied" } };
      let rows = DATA[name].slice();
      if (st.ord.length) rows.sort((x, y) => { for (const c of st.ord) { if (x[c] < y[c]) return -1; if (x[c] > y[c]) return 1; } return 0; });
      return { data: rows.slice(a, b + 1), error: null };
    },
  };
  return q;
}
const users = Array.from({ length: 1500 }, (_, i) => ({ id: "u" + i, email: `u${i}@x.sa`, encrypted_password: "SHOULD_NOT_APPEAR" }));
const db = { from, auth: { admin: { async listUsers({ page, perPage }) { return { data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null }; } } } };
global.fetch = async () => ({ ok: true, json: async () => ({
  paths: { "/payments": {}, "/team_members": {}, "/broken": {} },
  definitions: {
    payments: { properties: { id: { description: "<pk/>" }, amount: {} } },
    team_members: { properties: { owner_id: { description: "<pk/>" }, member_id: { description: "<pk/>" } } },
    broken: { properties: { id: { description: "<pk/>" } } },
  } }) });
(async () => {
  const r = await buildBackup(db, "https://x.supabase.co", "k", new Date("2026-11-21T22:00:00Z"));
  const j = JSON.parse(r.json);
  t("all 2345 payments, none lost across pages", j.tables.payments.length === 2345);
  t("no duplicates", new Set(j.tables.payments.map((p) => p.id)).size === 2345);
  t("ordered by pk", j.tables.payments[0].id === 1 && j.tables.payments[2344].id === 2345);
  t("composite pk ordering used", JSON.stringify(orders.team_members) === '["owner_id","member_id"]');
  t("failed table reported, not silent", r.failed.length === 1 && /broken/.test(r.failed[0]));
  t("file marked incomplete", j.complete === false);
  t("broken table absent (not an empty list pretending)", !("broken" in j.tables));
  t("users paged (1500)", j.tables["auth.users"].length === 1500);
  t("no password field", !r.json.includes("SHOULD_NOT_APPEAR"));
  t("riyadh day in file", j.day === "2026-11-22");
  t("counts match", j.counts.payments === 2345 && j.counts["auth.users"] === 1500);
  global.fetch = async () => ({ ok: true, json: async () => ({ paths: {}, definitions: {} }) });
  let threw = false; try { await buildBackup(db, "u", "k"); } catch { threw = true; }
  t("empty table list → throws (no empty backup)", threw);
  global.fetch = async () => ({ ok: false, status: 401 });
  threw = false; try { await buildBackup(db, "u", "k"); } catch { threw = true; }
  t("openapi 401 → throws", threw);
  console.log(`${ok} ✓ · ${bad} ✗`); process.exit(bad ? 1 : 0);
})();
