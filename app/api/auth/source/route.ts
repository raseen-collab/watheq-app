import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { recordSignupSource } from "@/lib/signup-source-server";
import { isSignupSource } from "@/lib/signup-sources";

export const dynamic = "force-dynamic";

/**
 * تثبيت مصدر التسجيل على الملف الشخصي بعد أول دخول ناجح.
 *
 * بلا جسم طلب: المعرّف من الجلسة، والقيمة من `user_metadata` الذي كُتب عند
 * إنشاء الحساب (تسجيل بالبريد)، أو من `?src=` إن جاء من رابط حملة. لا يقبل
 * معرّف مستخدم من الطلب إطلاقًا — نفس مبدأ مسار تليجرام بعد إصلاحه.
 *
 * يُستدعى من صفحة الدخول بعد نجاح الدخول. سبب التأجيل إلى ما بعد الدخول:
 * عند إنشاء الحساب لا توجد جلسة بعد إن كان تأكيد البريد مُفعَّلًا.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  /* بيانات الحساب أولى من الرابط: هي مصدر تسجيل هذا الحساب فعلًا ولا تُقيَّد
     بعمر. أما القادم من الرابط فيُشترط أن يكون الحساب جديدًا، وإلا كُتب مصدر
     خاطئ لصاحب حساب قديم فتح رابط حملة. */
  const meta = (user.user_metadata as any)?.signup_source;
  if (isSignupSource(meta)) {
    const saved = await recordSignupSource(user.id, meta);
    return NextResponse.json({ ok: true, saved, from: "metadata" });
  }

  const q = new URL(request.url).searchParams.get("src");
  const saved = await recordSignupSource(user.id, q, { requireFreshProfile: true });
  return NextResponse.json({ ok: true, saved, from: "link" });
}
