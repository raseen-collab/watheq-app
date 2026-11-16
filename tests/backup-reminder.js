/* تذكير النسخة الشهرية (v87، 16 نوفمبر 2026)
   تشغيل: npx esbuild lib/backupReminder.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/backupReminder.js
           node tests/backup-reminder.js */
const { backupDue } = require("/tmp/b/backupReminder.js");
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log("✗", n); } };
const now = new Date("2026-11-16T10:00:00Z");
const ago = (d) => new Date(now.getTime() - d * 86400000).toISOString();
t("29 days → none", backupDue({ lastBackup: ago(29), now }) === null);
t("30 days → due", backupDue({ lastBackup: ago(30), now })?.days === 30);
t("never, new account → none", backupDue({ lastBackup: null, since: ago(5), now }) === null);
t("never, 14 days old → due (null days)", JSON.stringify(backupDue({ lastBackup: null, since: ago(14), now })) === '{"days":null}');
t("snoozed → none", backupDue({ lastBackup: ago(90), snoozeUntil: new Date(now.getTime() + 3600e3).toISOString(), now }) === null);
t("snooze expired → due", backupDue({ lastBackup: ago(90), snoozeUntil: ago(1), now })?.days === 90);
t("bad snooze string ignored", backupDue({ lastBackup: ago(40), snoozeUntil: "x", now })?.days === 40);
t("no dates at all → none", backupDue({ now }) === null);
console.log(`${ok} ✓ · ${bad} ✗`);
process.exit(bad ? 1 : 0);
