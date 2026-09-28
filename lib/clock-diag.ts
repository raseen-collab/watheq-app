/* ══════════════════════════════════════════════════════════════════
   قياس الانحراف بين ساعتَي خادم المصادقة وخادم البيانات.

   لماذا هذا الملف ولماذا فشل ما قبله:

   مقياس v53 (clock_probe) يقارن `iat` في الرمز بساعة القاعدة. والفرق
   بينهما في الوضع الطبيعي = **عمر الرمز**، سالبًا دائمًا: رمز عمره خمس
   دقائق يعطي −300. فانحراف مقداره ثوانٍ يغرق في عمر الرمز ولا يُرى إلا
   إذا صادفنا رمزًا طازجًا في اللحظة نفسها — أي بالحظّ.

   وهذا الملف يقيس الشيء المطلوب مباشرة: ترويسة `Date` في ردّ كل خادم.
   ترويسة `Date` هي ساعة الخادم نفسه لحظة الرد. فإن طلبنا الخادمين في
   لحظة واحدة وقارنّا ترويستيهما، ظهر الانحراف بينهما بلا رمز ولا حظّ.

   حدّ الدقّة: ترويسة `Date` بدقّة الثانية (RFC 9110) — لا تُظهر أجزاء
   الثانية. وهذا كافٍ: PostgREST يقارن `iat` بساعته بدقّة الثانية أيضًا،
   فما يرفض الرمز هو فرق ثانية كاملة أو أكثر.

   حدّ آخر يجب قوله: أمام الخادمين بوّابة (Kong). إن كانت البوّابة هي من
   يضع `Date` بدل الخادم الخلفي، قاسَ هذا الملف ساعة البوّابة مرتين وظهر
   الفرق صفرًا دائمًا — فلا يُقرأ الصفر دليلًا على سلامة الساعتين. ولهذا
   يُرجع المسار ترويسة `server` مع كل قياس: بها نعرف من ردّ فعلًا.
   ══════════════════════════════════════════════════════════════════ */

/** ترويسة Date → ثوانٍ منذ الحقبة. تُرجع null لما لا يُقرأ. */
export function parseHttpDate(v?: string | null): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.round(t / 1000) : null;
}

export type Verdict = "positive-skew" | "sub-second" | "no-positive-skew" | "no-data";

export type Summary = {
  n: number;
  min: number | null;
  max: number | null;
  median: number | null;
  /** أكثر قيمة تكرّرت — أمتن من المتوسط أمام قياس واحد شاذّ */
  mode: number | null;
  verdict: Verdict;
  /** سطر عربي واحد صالح للعرض وللصق في تذكرة الدعم */
  label: string;
};

/**
 * @param diffs لكل قياس: ساعة خادم المصادقة ناقص ساعة خادم البيانات.
 *   موجب = المصادقة تسبق البيانات = الرمز يُولد «في المستقبل» = العطل.
 */
export function summarize(diffs: number[]): Summary {
  const xs = diffs.filter((d) => Number.isFinite(d)).slice().sort((a, b) => a - b);
  if (!xs.length) {
    return { n: 0, min: null, max: null, median: null, mode: null, verdict: "no-data",
      label: "لا قياسات — لم تُقرأ ترويسة Date من أي خادم." };
  }
  const min = xs[0];
  const max = xs[xs.length - 1];
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);

  const freq = new Map<number, number>();
  xs.forEach((x) => freq.set(x, (freq.get(x) || 0) + 1));
  let mode = xs[0], best = 0;
  freq.forEach((c, v) => { if (c > best || (c === best && Math.abs(v) > Math.abs(mode))) { best = c; mode = v; } });

  /* التصنيف بالأقصى لا بالوسيط: نافذة الرفض تفتحها أسوأ لحظة لا اللحظة
     المتوسطة. قياس واحد بـ+2 يعني أن الرمز المولَّد في تلك الثانية مرفوض. */
  let verdict: Verdict, label: string;
  if (max >= 1) {
    verdict = "positive-skew";
    label = `خادم المصادقة يسبق خادم البيانات بما يصل إلى ${max} ثانية `
      + `(الوسيط ${median}، الأكثر تكرارًا ${mode}، من ${xs.length} قياسًا). `
      + `هذا بعينه سبب JWT issued at future: كل رمز يُصدر في هذه النافذة يُرفض.`;
  } else if (max === 0 && min <= -1) {
    verdict = "sub-second";
    label = `الفرق أقل من ثانية: القياسات تتراوح بين ${min} و0 من ${xs.length} قياسًا — `
      + `أي أن الساعتين على حدّ الثانية، والعطل يقع حين تعبر النافذة الثانية الكاملة.`;
  } else if (max <= 0) {
    verdict = "no-positive-skew";
    label = `لا سبق موجب في هذه القياسات (بين ${min} و${max} من ${xs.length} قياسًا): `
      + `خادم المصادقة لا يسبق خادم البيانات الآن. العطل متقطّع، فغياب السبق `
      + `في هذه اللحظة لا ينفي وقوعه في غيرها.`;
  } else {
    verdict = "sub-second";
    label = `قياسات متفرّقة بين ${min} و${max} من ${xs.length} قياسًا.`;
  }
  return { n: xs.length, min, max, median, mode, verdict, label };
}
