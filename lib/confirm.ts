/**
 * تأكيد وتنبيه بنوافذ وثيق بدل نوافذ المتصفح (24 نوفمبر 2026 — طلب عبيد بعد تقييم التجربة).
 *
 * confirm()/alert() تظهر بعنوان «localhost يقول…» أو اسم الموقع، بزرّين «موافق/إلغاء» لا يقولان
 * ما يحدث، وتقطع الصفحة على الجوال. هنا نفس الاستعمال تقريبًا — `if (!(await wqConfirm(msg))) return;` —
 * والنافذة من تصميم وثيق: سؤال واضح، زر باسم الفعل (أحمر للحذف)، و«رجوع» لا يغيّر شيئًا.
 *
 * المضيف (components/ConfirmHost) مركّب مرة واحدة في app/layout. إن لم يُركّب لأي سبب
 * نعود لنافذة المتصفح — لا يضيع تأكيد أبدًا.
 */
export type ConfirmOpts = { title?: string; ok?: string; cancel?: string; danger?: boolean };
export type ConfirmReq = { kind: "confirm" | "alert"; message: string; opts: ConfirmOpts; resolve: (v: boolean) => void };

let host: ((r: ConfirmReq) => void) | null = null;

export function registerConfirmHost(fn: (r: ConfirmReq) => void): () => void {
  host = fn;
  return () => { if (host === fn) host = null; };
}

export function wqConfirm(message: string, opts: ConfirmOpts = {}): Promise<boolean> {
  if (!host) return Promise.resolve(typeof window !== "undefined" ? window.confirm(message) : false);
  return new Promise((resolve) => host!({ kind: "confirm", message, opts, resolve }));
}

export function wqAlert(message: string, opts: ConfirmOpts = {}): Promise<void> {
  if (!host) { if (typeof window !== "undefined") window.alert(message); return Promise.resolve(); }
  return new Promise((resolve) => host!({ kind: "alert", message, opts, resolve: () => resolve() }));
}

/** العنوان والنص من الرسالة: السطر الأول سؤال، والباقي شرح. سطر أول طويل جدًا يبقى نصًّا بعنوان عام */
export function splitMessage(message: string, kind: "confirm" | "alert"): { title: string; body: string } {
  const m = String(message || "").trim();
  const cut = m.indexOf("\n");
  const first = (cut === -1 ? m : m.slice(0, cut)).trim();
  const rest = (cut === -1 ? "" : m.slice(cut + 1)).trim();
  if (first.length <= 140) return { title: first, body: rest };
  return { title: kind === "alert" ? "تنبيه" : "تأكيد", body: m };
}

/** نص زر الموافقة ولونه من فعل السؤال — «حذف…؟» ← «نعم، احذف» بالأحمر */
const VERBS: [RegExp, string, boolean][] = [
  [/^(?:حذف|احذف)/, "نعم، احذف", true],
  [/^عكس/, "نعم، اعكس", true],
  [/^إبطال/, "نعم، أبطِل الرابط", true],
  [/^إزالة/, "نعم، أزِل", true],
  [/^فكّ|^فك /, "نعم، فكّ الربط", true],
  [/^التراجع/, "نعم، تراجع", true],
  [/^إلغاء/, "نعم، ألغِ", true],
  [/^أرشفة/, "نعم، أرشِف", false],
  [/^تسجيل/, "نعم، سجّل", false],
  [/^نقل/, "نعم، انقل", false],
  [/^تصحيح/, "نعم، صحّح", false],
  [/^تطبيق/, "نعم، طبّق", false],
  [/^منح/, "نعم، امنح", false],
  [/^حفظ/, "نعم، احفظ", false],
];
export function okLabel(title: string, opts: ConfirmOpts): { ok: string; danger: boolean } {
  const t = title.replace(/^[^\p{L}]+/u, "");
  for (const [re, label, danger] of VERBS) if (re.test(t)) return { ok: opts.ok || label, danger: opts.danger ?? danger };
  if (/لم يُحفظ|تجاهل/.test(title)) return { ok: opts.ok || "نعم، تجاهل ما أدخلته", danger: opts.danger ?? true };
  return { ok: opts.ok || "نعم، تابع", danger: !!opts.danger };
}
