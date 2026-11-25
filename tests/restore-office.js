/* استرجاع مكتب واحد من النسخة (24 نوفمبر 2026): صفوفه فقط، إضافة فقط */
const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = (s) => `00000000-0000-4000-8000-${s.padStart(12, "0")}`;
const backup = { format: "watheq-backup", complete: true, failed: [], day: "2026-11-24", counts: {},
  tables: {
    profiles: [{ id: A, full_name: "مكتب أ" }, { id: B, full_name: "مكتب ب" }],
    team_members: [{ id: id("71"), owner_id: A, member_id: id("72") }, { id: id("73"), owner_id: B, member_id: id("74") }],
    properties: [{ id: id("1"), user_id: A, name: "عمارة أ" }, { id: id("2"), user_id: B, name: "عمارة ب" }],
    tenants: [{ id: id("11"), property_id: id("1"), name: "سالم" }, { id: id("12"), property_id: id("2"), name: "ماجد" }],
    payments: [{ id: id("21"), user_id: A, tenant_id: id("11"), amount: 1000 }, { id: id("22"), user_id: B, tenant_id: id("12"), amount: 900 }],
    tenant_files: [{ id: id("31"), tenant_id: id("11"), path: "x" }, { id: id("32"), tenant_id: id("12"), path: "y" }],
    mystery: [{ id: id("41"), foo: 1 }],
  } };
for (const [k, v] of Object.entries(backup.tables)) backup.counts[k] = v.length;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wqro-")); const f = path.join(dir, "b.json");
fs.writeFileSync(f, JSON.stringify(backup));
const run = (...a) => execFileSync("node", [path.join(__dirname, "../scripts/restore-backup.mjs"), f, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString();
const sql = run(`--office=${A}`);
t("office A property in", sql.includes(id("1")));
t("office B property out", !sql.includes(id("2")) && !sql.includes("عمارة ب"));
t("tenant via property", sql.includes(id("11")) && !sql.includes(id("12")));
t("payment via user_id", sql.includes(id("21")) && !sql.includes(id("22")));
t("file via tenant", sql.includes(id("31")) && !sql.includes(id("32")));
t("profile + team of A only", sql.includes("مكتب أ") && !sql.includes("مكتب ب") && sql.includes(id("71")) && !sql.includes(id("73")));
t("unknown table skipped", !sql.includes(id("41")));
t("insert-only forced", /on conflict do nothing/.test(sql) && !/on conflict do update/i.test(sql));
t("id-existence check, no global count", /صفوف المكتب لم تكتمل/.test(sql) && !/عدد الصفوف لا يطابق/.test(sql));
let rejected = false; try { run("--office=not-a-uuid"); } catch { rejected = true; }
t("bad uuid rejected", rejected);
const full = run();
t("full restore unchanged (both offices)", full.includes(id("2")) && /عدد الصفوف لا يطابق/.test(full));
console.log(`restore-office: ${ok} ✓  ${bad} ✗`);
process.exit(bad ? 1 : 0);
