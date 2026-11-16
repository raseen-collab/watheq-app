/** متى يظهر تذكير النسخة الشهرية — نقيّ ليُختبر (components/BackupReminder) */
export const BACKUP_EVERY_DAYS = 30;
export const FIRST_BACKUP_AFTER_DAYS = 14;

export function backupDue(o: { lastBackup?: string | null; since?: string | null; snoozeUntil?: string | null; now: Date }): null | { days: number | null } {
  const now = o.now.getTime();
  const snooze = o.snoozeUntil ? Date.parse(o.snoozeUntil) : NaN;
  if (Number.isFinite(snooze) && snooze > now) return null;
  const last = o.lastBackup ? Date.parse(o.lastBackup) : NaN;
  if (Number.isFinite(last)) {
    const days = Math.floor((now - last) / 86400000);
    return days >= BACKUP_EVERY_DAYS ? { days } : null;
  }
  const since = o.since ? Date.parse(o.since) : NaN;
  if (!Number.isFinite(since)) return null;
  return (now - since) / 86400000 >= FIRST_BACKUP_AFTER_DAYS ? { days: null } : null;
}
