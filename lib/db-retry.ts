/**
 * وثيق — امتصاص انحراف الساعة بين الخوادم
 *
 * الجلسة يُصدرها خادم المصادقة ويتحقق منها خادم التطبيق. فرق ثانية واحدة
 * بين ساعتيهما يجعل الجلسة «صادرة في المستقبل» (JWT issued at future)
 * فتُرفض القراءة، ويرتد المستخدم بخطأ لا ذنب له فيه — رصده Sentry فعليًّا
 * على آيفون بساعة مضبوطة، فالسبب ليس جهاز المستخدم.
 *
 * العلاج: إعادة المحاولة مرة واحدة بعد انتظار قصير. الانحراف ثوانٍ معدودة،
 * فالمحاولة الثانية تنجح عادةً والمستخدم لا يرى شيئًا. وإن فشلت أيضًا،
 * يعود الخطأ كما هو ليظهر صريحًا بدل أن يتنكّر بشاشة ترحيب.
 */

// النمط ضيّق عمدًا: انحراف الساعة وحده. الجلسة المنتهية أو الناقصة تُعالج
// في مكان آخر، وإعادة المحاولة معها تأخير بلا فائدة؛ وأخطاء الصلاحيات
// يجب أن تظهر فورًا لا أن تنتظر.
const SKEW = /issued at future/i;

type Result<T> = { data: T; error: { message: string } | null };

export function isClockSkew(msg?: string | null): boolean {
  return !!msg && SKEW.test(msg);
}

/**
 * محاولتان بتصاعد (1.2ث ثم 3ث). سببه أننا لا نعرف مقدار الانحراف: إن كان
 * أقل من ثانية نجحت الأولى، وإن بلغ ثلاثًا نجحت الثانية. وما فوق ذلك لا
 * تنفع معه إعادة المحاولة — ولهذا تُعرض شاشة لطيفة بدل صفحة خطأ.
 */
export async function withClockSkewRetry<T>(
  // مُنشئ استعلام Supabase «thenable» لا Promise حقيقيًّا — لذا PromiseLike
  run: () => PromiseLike<Result<T>>,
  waits: number[] = [1200, 3000],
): Promise<Result<T>> {
  let last = await run();
  for (const w of waits) {
    if (!last.error || !SKEW.test(last.error.message)) return last;
    await new Promise((r) => setTimeout(r, w));
    last = await run();
  }
  return last;
}
