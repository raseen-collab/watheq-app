/* النسخة الاحتياطية اليومية (22 نوفمبر 2026)
   تشغيل: npx esbuild lib/backup-crypto.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/backupCrypto.js
          npx esbuild lib/backup.ts --bundle --format=cjs --platform=node --alias:@=. --external:@supabase/supabase-js --outfile=/tmp/b/backup.js
          node tests/backup.js */
const { encryptBackup, decryptBackup, parseKey } = require("/tmp/b/backupCrypto.js");
const { tablesFromOpenApi, expiredDaily, riyadhToday, isOffsiteDay, verifyRoundTrip } = require("/tmp/b/backup.js");
const crypto = require("crypto");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const throws = (f) => { try { f(); return false; } catch { return true; } };

const key = crypto.randomBytes(32), b64 = key.toString("base64");
t("parseKey ok", parseKey(b64).equals(key));
t("parseKey short rejected", throws(() => parseKey(crypto.randomBytes(16).toString("base64"))));
t("parseKey empty rejected", throws(() => parseKey(undefined)));

const json = JSON.stringify({ tables: { tenants: [{ name: "محمد العتيبي", rent: 12500.5 }] }, big: "x".repeat(200000) });
const f = encryptBackup(json, key);
t("magic header", f.subarray(0, 5).toString() === "WQBK1");
t("round trip exact (Arabic + numbers)", decryptBackup(f, key) === json);
t("compressed", f.length < json.length / 10);
t("plaintext not visible", !f.includes(Buffer.from("محمد")));
t("random iv → different files", !encryptBackup(json, key).equals(f));
t("wrong key rejected", throws(() => decryptBackup(f, crypto.randomBytes(32))));
const tampered = Buffer.from(f); tampered[tampered.length - 5] ^= 1;
t("tampered body rejected", throws(() => decryptBackup(tampered, key)));
const tag = Buffer.from(f); tag[20] ^= 1;
t("tampered tag rejected", throws(() => decryptBackup(tag, key)));
t("not a backup rejected", throws(() => decryptBackup(Buffer.from("hello world, definitely not a backup file"), key)));
t("truncated rejected", throws(() => decryptBackup(f.subarray(0, 20), key)));

/* وصف PostgREST: جداول بمسار + مفتاح أساسي، وتعريفات بلا مسار تُستبعد */
const spec = {
  paths: { "/": {}, "/tenants": {}, "/team_members": {}, "/rpc/watheq_x": {}, "/logs": {} },
  definitions: {
    tenants: { properties: { id: { description: "Note:\nThis is a Primary Key.<pk/>" }, name: {} } },
    team_members: { properties: { owner_id: { description: "Note:\nThis is a Primary Key.<pk/>" }, member_id: { description: "Note:\nThis is a Primary Key.<pk/>\nThis is a Foreign Key to `profiles.id`.<fk table='profiles' column='id'/>" }, role: {} } },
    logs: { properties: { at: {}, msg: {} } },
    some_type: { properties: { a: {} } },
  },
};
const tabs = tablesFromOpenApi(spec);
t("tables found (3, sorted)", JSON.stringify(tabs.map((x) => x.name)) === '["logs","team_members","tenants"]');
t("single pk", JSON.stringify(tabs.find((x) => x.name === "tenants").pk) === '["id"]');
t("composite pk", JSON.stringify(tabs.find((x) => x.name === "team_members").pk) === '["owner_id","member_id"]');
t("no pk → empty", tabs.find((x) => x.name === "logs").pk.length === 0);
t("empty spec → []", tablesFromOpenApi({}).length === 0);

/* الاحتفاظ 30 يومًا */
const names = ["2026-10-22.wqbk", "2026-10-23.wqbk", "2026-11-21.wqbk", "2026-11-22.wqbk", "notes.txt", "2026-01-01.json"];
const ex = expiredDaily(names, "2026-11-22");
t("expired = older than 30 days only", JSON.stringify(ex) === '["2026-10-22.wqbk"]');
t("cutoff day kept (exactly 30)", !ex.includes("2026-10-23.wqbk"));
t("non-backup names never deleted", !ex.includes("notes.txt") && !ex.includes("2026-01-01.json"));
t("month boundary", JSON.stringify(expiredDaily(["2026-02-28.wqbk", "2026-02-27.wqbk"], "2026-03-30")) === '["2026-02-27.wqbk"]');

/* يوم الرياض: 22:30 UTC = اليوم التالي في الرياض */
t("riyadh day after 21:00 UTC", riyadhToday(new Date("2026-11-21T22:30:00Z")) === "2026-11-22");
t("riyadh day before 21:00 UTC", riyadhToday(new Date("2026-11-21T20:30:00Z")) === "2026-11-21");
t("monthly trigger day", riyadhToday(new Date("2026-11-30T21:05:00Z")).endsWith("-01"));


/* (23 نوفمبر) الجمعة + تحقق القراءة */
t("2026-11-27 is Friday → offsite", isOffsiteDay("2026-11-27") === true);
t("2026-11-23 Monday → no offsite", isOffsiteDay("2026-11-23") === false);
t("2026-11-28 Saturday → no offsite", isOffsiteDay("2026-11-28") === false);
t("2027-01-01 Friday → offsite", isOffsiteDay("2027-01-01") === true);
const good = JSON.stringify({ format: "watheq-backup", tables: { tenants: [{}, {}], "auth.users": [{}] } });
t("roundtrip match", verifyRoundTrip(good, { tenants: 2, "auth.users": 1 }) === null);
t("roundtrip count mismatch", /tenants/.test(verifyRoundTrip(good, { tenants: 3 }) || ""));
t("roundtrip missing table", /payments/.test(verifyRoundTrip(good, { payments: 0 }) || ""));
t("roundtrip bad json", verifyRoundTrip("{oops", {}) !== null);
t("roundtrip wrong format", verifyRoundTrip(JSON.stringify({ format: "x", tables: {} }), {}) !== null);
t("roundtrip through real encryption", verifyRoundTrip(decryptBackup(encryptBackup(good, key), key), { tenants: 2, "auth.users": 1 }) === null);
console.log(`${ok} ✓ · ${bad} ✗`);
process.exit(bad ? 1 : 0);
