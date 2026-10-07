"use client";
/**
 * إرسال محطة القمع من المتصفح — لا ينتظر ولا يرمي خطأ أبدًا.
 *
 * المصدر: `?src=` في الرابط أولًا، ثم ما حُفظ في هذه الجلسة، ثم استنتاج من
 * الصفحة السابقة. يُحفظ في sessionStorage حتى لا يضيع حين ينتقل الزائر من
 * التجربة إلى صفحة التسجيل.
 * الجلسة: `?wv=` القادم من الموقع التسويقي أولًا (نفس الزائر عبر النطاقين)،
 * وإلا رقم عشوائي جديد.
 */
import { isSid, type FunnelEvent } from "./funnel";
import { isSignupSource, sourceFromReferrer } from "./signup-sources";

const K_SID = "wq_sid", K_SRC = "wq_src";

function store(k: string, v?: string): string {
  try {
    if (v !== undefined) sessionStorage.setItem(k, v);
    return sessionStorage.getItem(k) || "";
  } catch { return v || ""; }
}

function randomSid(): string {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  try {
    const b = new Uint8Array(20); crypto.getRandomValues(b);
    b.forEach((x) => { s += a[x % a.length]; });
  } catch { for (let i = 0; i < 20; i++) s += a[Math.floor(Math.random() * a.length)]; }
  return s;
}

export function funnelSid(): string {
  let q = "";
  try { q = new URL(location.href).searchParams.get("wv") || ""; } catch {}
  if (isSid(q)) return store(K_SID, q);
  const cur = store(K_SID);
  return isSid(cur) ? cur : store(K_SID, randomSid());
}

/** مصدر الجلسة — يعود "" إن لم يُعرف (ولا يُخمَّن) */
export function funnelSrc(): string {
  let q = "";
  try { q = new URL(location.href).searchParams.get("src") || ""; } catch {}
  if (isSignupSource(q) && q !== "skip") return store(K_SRC, q);
  const cur = store(K_SRC);
  if (isSignupSource(cur)) return cur;
  const inf = sourceFromReferrer(typeof document === "undefined" ? "" : document.referrer);
  return isSignupSource(inf) ? store(K_SRC, inf) : "";
}

const sent = new Set<string>();

export function track(event: FunnelEvent): void {
  try {
    if (typeof window === "undefined" || sent.has(event)) return;
    sent.add(event);
    const body = JSON.stringify({ e: event, v: funnelSid(), s: funnelSrc() || undefined, p: location.pathname });
    const blob = new Blob([body], { type: "text/plain" });
    if (navigator.sendBeacon && navigator.sendBeacon("/api/track", blob)) return;
    fetch("/api/track", { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {});
  } catch { /* القياس لا يعطّل شيئًا */ }
}
