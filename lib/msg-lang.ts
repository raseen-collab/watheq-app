// ============================================================
// وثيق — لغة المراسلة للمستأجر (24 نوفمبر 2026 — طلب مكتب الأولى، schema-v105)
// تُحفظ مرة واحدة على الوحدة، وكل رسالة للمستأجر تخرج بها تلقائيًّا.
// «both»: العربي أولًا ثم الإنجليزي في الرسالة نفسها — لمن لا يُعرف تفضيله.
// النصوص الإنجليزية ثابتة مكتوبة (lib/tenant-messages) — لا ترجمة آلية وقت الإرسال.
// ============================================================
export type MsgLang = "ar" | "en" | "both";

export const MSG_LANGS: { v: MsgLang; label: string; short: string }[] = [
  { v: "ar", label: "عربي", short: "ع" },
  { v: "en", label: "English", short: "EN" },
  { v: "both", label: "عربي + English", short: "ع+EN" },
];

export const normLang = (v: unknown): MsgLang => (v === "en" || v === "both" ? v : "ar");
export const langLabel = (v: unknown) => MSG_LANGS.find((x) => x.v === normLang(v))!.label;

/** الرسالة بلغة المستأجر — الدالتان تُستدعيان عند الحاجة فقط */
export function pickMsg(lang: unknown, ar: () => string, en: () => string): string {
  const l = normLang(lang);
  if (l === "en") return en();
  if (l === "both") return `${ar()}\n\n— English —\n\n${en()}`;
  return ar();
}

/** اقتراح: اسم مكتوب بحروف لاتينية فقط (بلا حرف عربي) ← English. وإلا لا اقتراح */
export function suggestLang(name: unknown): MsgLang | null {
  const s = String(name || "").trim();
  if (!s) return null;
  if (/[؀-ۿ]/.test(s)) return null;
  return /[A-Za-z]{2,}/.test(s) ? "en" : null;
}

/** قراءة عمود «اللغة» في ملف الرفع: عربي/ar · انجليزي/English/en · الاثنين/both/عربي+انجليزي */
export function parseLangCell(v: unknown): MsgLang | null {
  const s = String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  if (/^(both|الاثنين|الاثنان|كلاهما|ثنائي|عربي\+?(انجليزي|إنجليزي|english)|ar\+en|ar\/en)$/.test(s)) return "both";
  if (/^(en|eng|english|انجليزي|إنجليزي|انقليزي)$/.test(s)) return "en";
  if (/^(ar|arabic|عربي|العربية|عربية)$/.test(s)) return "ar";
  return null;
}
