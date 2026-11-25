import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { decryptBackup, encryptBackup } from "./backup-crypto";

/**
 * وثيق — نسخ الصور احتياطيًّا (24 نوفمبر 2026).
 *
 * النسخة اليومية (lib/backup.ts) فيها الجداول فقط؛ صور الصيانة والمعروضات في
 * Storage والقاعدة تحفظ مسارها فقط. هنا:
 *
 *  ١) مرآة يومية مشفّرة داخل دلو «backups»: photos/<الدلو>/<المسار>.wqph
 *     تُنسخ الصورة الجديدة أو المتغيّرة فقط (يُقارن الحجم ووقت التعديل).
 *     تحمي من الحذف الخطأ أو عطل في الدلو نفسه.
 *  ٢) صورة حُذفت من مصدرها (المكتب حذفها أو حُذف الحساب) تبقى نسختها 30 يومًا
 *     — نفس عمر النسخ اليومية للجداول — ثم تُحذف. فلا نحتفظ ببيانات حساب
 *     محذوف إلى الأبد، ولا نفقد صورة حُذفت خطأً اليوم.
 *  ٣) كل جمعة: حزمة مشفّرة بالصور الجديدة خلال الأسبوع تُرسل إلى تليجرام المالك
 *     مع نسخة الجداول — نسخة خارج Supabase.
 *
 * الصيغة: نفس تشفير النسخة (WQBK1 + AES-256-GCM(gzip(JSON))) والمحتوى:
 *   { format: "watheq-photos", version: 1, files: [{ bucket, path, type, size, sha256, b64 }] }
 * الاسترجاع: scripts/restore-photos.mjs
 */

export const PHOTO_BUCKETS = ["maintenance-photos", "listing-photos"] as const;
export const MIRROR_PREFIX = "photos";
export const MANIFEST_PATH = "photos/manifest.wqph";
export const MISSING_KEEP_DAYS = 30;
/** حدّ حزمة تليجرام (حدّ البوت 50MB، والتشفير والترميز يضيفان قليلًا) */
export const OFFSITE_PART_BYTES = 30 * 1024 * 1024;

export type SourceObject = { bucket: string; path: string; size: number; updated: string; type?: string };
export type ManifestEntry = { size: number; updated: string; sha256: string; copied_at: string; missing_since?: string | null };
export type Manifest = { format: "watheq-photos-manifest"; version: 1; entries: Record<string, ManifestEntry> };

export const keyOf = (o: { bucket: string; path: string }) => `${o.bucket}/${o.path}`;
export const mirrorPath = (k: string) => `${MIRROR_PREFIX}/${k}.wqph`;
export const emptyManifest = (): Manifest => ({ format: "watheq-photos-manifest", version: 1, entries: {} });

/**
 * الفرق بين المصدر والمرآة — دالة نقية تُختبر وحدها.
 *  toCopy:   جديد أو تغيّر حجمه/وقته
 *  missing:  غاب عن المصدر اليوم لأول مرة (يُعلَّم ولا يُحذف)
 *  restored: عاد للمصدر بعد غيابه (تُزال علامة الغياب)
 *  toDelete: غائب منذ أكثر من keepDays
 */
export function planMirror(source: SourceObject[], m: Manifest, todayISO: string, keepDays = MISSING_KEEP_DAYS) {
  const src = new Map(source.map((o) => [keyOf(o), o]));
  const toCopy: SourceObject[] = [];
  const missing: string[] = [];
  const restored: string[] = [];
  const toDelete: string[] = [];
  for (const [k, o] of src) {
    const e = m.entries[k];
    if (!e || e.size !== o.size || e.updated !== o.updated) toCopy.push(o);
    else if (e.missing_since) restored.push(k);
  }
  const cutoff = Date.parse(todayISO + "T00:00:00Z") - keepDays * 86400000;
  for (const [k, e] of Object.entries(m.entries)) {
    if (src.has(k)) continue;
    if (!e.missing_since) missing.push(k);
    else if (Date.parse(e.missing_since + "T00:00:00Z") < cutoff) toDelete.push(k);
  }
  return { toCopy, missing, restored, toDelete };
}

/** حزمة صور → JSON (للتشفير) */
export function bundleJson(files: { bucket: string; path: string; type?: string; data: Buffer }[], meta: Record<string, any> = {}): string {
  return JSON.stringify({
    format: "watheq-photos", version: 1, ...meta,
    files: files.map((f) => ({
      bucket: f.bucket, path: f.path, type: f.type || "application/octet-stream", size: f.data.length,
      sha256: createHash("sha256").update(f.data).digest("hex"), b64: f.data.toString("base64"),
    })),
  });
}

/** فك حزمة والتحقق من كل ملف (sha256) — يرمي عند أي اختلاف */
export function readBundle(file: Buffer, key: Buffer): { bucket: string; path: string; type: string; data: Buffer }[] {
  const m = JSON.parse(decryptBackup(file, key));
  if (m?.format !== "watheq-photos" || !Array.isArray(m.files)) throw new Error("ليست حزمة صور وثيق");
  return m.files.map((f: any) => {
    const data = Buffer.from(String(f.b64 || ""), "base64");
    if (createHash("sha256").update(data).digest("hex") !== f.sha256) throw new Error(`صورة تالفة في الحزمة: ${f.bucket}/${f.path}`);
    return { bucket: f.bucket, path: f.path, type: f.type, data };
  });
}

/** تقسيم الصور على حزم لا تتجاوز maxBytes (الحجم الخام) — صورة أكبر من الحد تبقى وحدها */
export function chunkBySize<T extends { size: number }>(items: T[], maxBytes = OFFSITE_PART_BYTES): T[][] {
  const out: T[][] = [];
  let cur: T[] = [], sum = 0;
  for (const it of items) {
    if (cur.length && sum + it.size > maxBytes) { out.push(cur); cur = []; sum = 0; }
    cur.push(it); sum += it.size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** كل ملفات دلو (مجلدات متداخلة) — Storage يعرض المجلد بلا id */
export async function listBucket(db: SupabaseClient, bucket: string): Promise<SourceObject[]> {
  const out: SourceObject[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8) return;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.storage.from(bucket).list(dir, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) {
        if (/not found/i.test(error.message) && !dir) return; // الدلو غير موجود بعد (لا معروضات بصور)
        throw new Error(`${bucket}/${dir}: ${error.message}`);
      }
      for (const e of data || []) {
        const p = dir ? `${dir}/${e.name}` : e.name;
        if (!e.id) await walk(p, depth + 1);            // مجلد
        else if (e.name !== ".emptyFolderPlaceholder") out.push({
          bucket, path: p, size: Number((e.metadata as any)?.size) || 0,
          updated: String(e.updated_at || e.created_at || ""), type: (e.metadata as any)?.mimetype,
        });
      }
      if (!data || data.length < 1000) break;
    }
  };
  await walk("", 0);
  return out;
}

export async function loadManifest(db: SupabaseClient, bucket: string, key: Buffer): Promise<Manifest> {
  const { data, error } = await db.storage.from(bucket).download(MANIFEST_PATH);
  if (error || !data) {
    /* (25 نوفمبر — Sentry WATHEQ-APP-8) في أول تشغيل يرجع Storage خطأً رسالته «{}» بلا «not found»،
       فكانت المرآة تتوقف قبل أن تبدأ. لا نخمّن من نص الخطأ: نسأل الدلو هل السجل موجود فعلًا —
       غير موجود ⇒ سجل فارغ (أول تشغيل)، موجود ولم يُقرأ ⇒ خطأ حقيقي يتوقف عنده. */
    const { data: list, error: le } = await db.storage.from(bucket).list(MIRROR_PREFIX, { search: "manifest.wqph", limit: 10 });
    if (le) throw new Error(`قراءة سجل الصور: ${le.message || JSON.stringify(le)}`);
    if ((list || []).some((e) => e.name === "manifest.wqph")) {
      throw new Error(`قراءة سجل الصور: ${(error as any)?.message || JSON.stringify(error) || "فارغ"}`);
    }
    return emptyManifest();
  }
  const m = JSON.parse(decryptBackup(Buffer.from(await data.arrayBuffer()), key));
  if (m?.format !== "watheq-photos-manifest") throw new Error("سجل الصور بصيغة غير معروفة");
  return m;
}

export async function saveManifest(db: SupabaseClient, bucket: string, m: Manifest, key: Buffer) {
  const { error } = await db.storage.from(bucket).upload(MANIFEST_PATH, encryptBackup(JSON.stringify(m), key),
    { contentType: "application/octet-stream", upsert: true });
  if (error) throw new Error(`حفظ سجل الصور: ${error.message}`);
}

export type MirrorResult = {
  sources: number; copied: number; marked_missing: number; deleted: number; pending: number;
  failed: string[]; newThisWeek: { bucket: string; path: string; size: number }[];
};

/**
 * تشغيل المرآة. budgetMs: يتوقف عن النسخ قبل انتهاء وقت الدالة ويكمل غدًا
 * (pending)، ويحفظ السجل دائمًا بما أُنجز — لا نسخ مكرر ولا ضياع.
 */
export async function runPhotoMirror(db: SupabaseClient, backupBucket: string, key: Buffer, todayISO: string,
  opts: { budgetMs?: number; now?: () => number } = {}): Promise<MirrorResult> {
  const now = opts.now || Date.now;
  const start = now();
  const budget = opts.budgetMs ?? 40_000;
  const source: SourceObject[] = [];
  for (const b of PHOTO_BUCKETS) source.push(...(await listBucket(db, b)));
  const m = await loadManifest(db, backupBucket, key);
  const plan = planMirror(source, m, todayISO);
  const failed: string[] = [];
  let copied = 0, deleted = 0;

  for (const k of plan.missing) m.entries[k].missing_since = todayISO;
  for (const k of plan.restored) m.entries[k].missing_since = null;

  for (const o of plan.toCopy) {
    if (now() - start > budget) break;
    const k = keyOf(o);
    try {
      const { data, error } = await db.storage.from(o.bucket).download(o.path);
      if (error || !data) throw new Error(error?.message || "فارغ");
      const buf = Buffer.from(await data.arrayBuffer());
      const enc = encryptBackup(bundleJson([{ bucket: o.bucket, path: o.path, type: o.type, data: buf }]), key);
      const up = await db.storage.from(backupBucket).upload(mirrorPath(k), enc, { contentType: "application/octet-stream", upsert: true });
      if (up.error) throw new Error(up.error.message);
      m.entries[k] = { size: o.size, updated: o.updated, sha256: createHash("sha256").update(buf).digest("hex"), copied_at: todayISO, missing_since: null };
      copied++;
    } catch (e: any) { failed.push(`${k}: ${String(e?.message || e)}`); }
  }

  if (plan.toDelete.length) {
    for (let i = 0; i < plan.toDelete.length; i += 500) {
      const part = plan.toDelete.slice(i, i + 500);
      const { error } = await db.storage.from(backupBucket).remove(part.map(mirrorPath));
      if (error) { failed.push(`حذف نسخ قديمة: ${error.message}`); continue; }
      for (const k of part) delete m.entries[k];
      deleted += part.length;
    }
  }

  await saveManifest(db, backupBucket, m, key);

  const weekAgo = Date.parse(todayISO + "T00:00:00Z") - 7 * 86400000;
  const newThisWeek = Object.entries(m.entries)
    .filter(([, e]) => !e.missing_since && Date.parse(e.copied_at + "T00:00:00Z") > weekAgo)
    .map(([k, e]) => { const i = k.indexOf("/"); return { bucket: k.slice(0, i), path: k.slice(i + 1), size: e.size }; });

  return {
    sources: source.length, copied, marked_missing: plan.missing.length, deleted,
    pending: plan.toCopy.length - copied - failed.filter((f) => !f.startsWith("حذف")).length,
    failed, newThisWeek,
  };
}
