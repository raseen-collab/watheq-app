import { createClient as createServiceClient } from "@supabase/supabase-js";
import { isSignupSource } from "./signup-sources";

/**
 * كتابة مصدر التسجيل على الملف الشخصي — من الخادم بمفتاح الخدمة.
 *
 * لماذا الخادم لا المتصفح: صلاحيات الأعمدة على `profiles` تُمنح عمودًا عمودًا
 * (schema-v11)، والمنح جرى لأعمدة الجدول كما كانت في 17 أغسطس. أي عمود أضيف
 * بعده — ومنه `signup_source` — قد يكون بلا `grant update` لدور authenticated،
 * فتفشل كتابة المتصفح بـ42501 **بصمت** لأن النداء كان داخل try/catch صامت.
 * وهذا يفسّر أن 10 من 13 حسابًا بلا مصدر. مفتاح الخدمة يتجاوز RLS والمنح معًا
 * فلا يبقى الرقم رهن منحٍ نسيناه.
 *
 * الأمان: المعرّف يأتي من الجلسة لا من الطلب، والقيمة تُطابَق بقائمة معروفة،
 * والكتابة `is("signup_source", null)` فلا تُستبدل قيمة محفوظة — أي لا يمكن
 * لمستخدم تغيير مصدر أحد ولا إعادة كتابة مصدره بعد تسجيله.
 *
 * @returns true إن كُتبت الآن، false إن لم تُكتب (قيمة غير معروفة، أو
 *          محفوظة مسبقًا، أو تعذّر الاتصال) — لا يُرمى خطأ أبدًا: مصدر
 *          التسجيل رقم تسويقي ولا يجوز أن يمنع أحدًا من الدخول.
 */
export async function recordSignupSource(
  userId: string,
  src?: string | null,
  /**
   * اشترط أن يكون الحساب أُنشئ الآن (خلال 15 دقيقة).
   *
   * يُستعمل حين يأتي المصدر من **الرابط** لا من بيانات الحساب: صاحب حساب قديم
   * مصدره فارغ لو فتح رابط الديمو ودخل بقوقل لكُتب مصدره «النسخة التجريبية»
   * وهو جاء أصلًا من حراج — فيمتلئ الحقل بمعلومة خاطئة، وهي أسوأ من فراغه
   * لأنها تُبنى عليها قرارات القنوات. أما المصدر القادم من `user_metadata`
   * فهو مصدر تسجيل الحساب نفسه فلا يُقيَّد بعمر: من يؤكّد بريده بعد يومين
   * يستحق أن يُحفظ مصدره الصحيح.
   */
  opts: { requireFreshProfile?: boolean } = {},
): Promise<boolean> {
  if (!userId || !isSignupSource(src)) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;

  const FRESH_MS = 15 * 60 * 1000;

  try {
    const db = createServiceClient(url, key, { auth: { persistSession: false } });

    if (opts.requireFreshProfile) {
      const { data: prof, error: profErr } = await db.from("profiles")
        .select("created_at").eq("id", userId).maybeSingle();
      /* يفشل مغلقًا: تجاهل الخطأ كان يجعل فشل قراءة عابرًا يُقرأ «صفّ يُنشأ
         الآن»، فيُكتب المصدر على حساب عمره سنة — وهو بالضبط ما يمنعه الحارس. */
      if (profErr) { console.error("signup_source age check failed:", profErr.message); return false; }
      /* صفّ غير موجود بعد = حساب يُنشأ الآن، فيُسمح ويُعالج التأخير أدناه */
      if (prof?.created_at) {
        const age = Date.now() - Date.parse(String(prof.created_at));
        if (!isFinite(age) || age > FRESH_MS) return false;
      }
    }

    const write = async () => {
      const { data, error } = await db.from("profiles")
        .update({ signup_source: src })
        .eq("id", userId)
        .is("signup_source", null)
        .select("id");
      if (error) { console.error("signup_source write failed:", error.message); return null; }
      return (data || []).length;
    };

    let n = await write();
    /* الحساب الجديد بقوقل: صفّ profiles يُنشئه مُشغِّل على auth.users، وقد لا
       يكون ظاهرًا بعد في اللحظة التي نكتب فيها. محاولة ثانية بعد تأخير قصير
       تكفي؛ وإن لم تكفِ فُقد المصدر كما كان يُفقد دائمًا — بلا عطل. */
    if (n === 0) {
      await new Promise((r) => setTimeout(r, 400));
      n = await write();
    }
    return (n || 0) > 0;
  } catch (e: any) {
    console.error("signup_source write threw:", e?.message || e);
    return false;
  }
}
