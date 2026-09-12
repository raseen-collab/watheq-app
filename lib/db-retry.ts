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

/**
 * أخطاء عابرة تستحق إعادة المحاولة.
 *
 * رصد Sentry «Gateway Timeout» عند قراءة ملف الحساب: القاعدة في فرانكفورت
 * والدوال في منطقة أخرى، وأي بطء لحظي يُسقط الصفحة كلها بخطأ خادم — بينما
 * المحاولة الثانية تنجح غالبًا. والمستخدم لا ذنب له، ولا يفهم «504».
 *
 * النمط ضيّق عمدًا: مهلة وبوابة وشبكة فقط. أخطاء الصلاحيات والبيانات
 * تظهر فورًا كما هي، لأن إعادة المحاولة معها تأخير بلا فائدة.
 */
const TRANSIENT = /gateway timeout|timeout|timed out|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|502|503|504|upstream/i;

export function isTransient(msg?: string | null): boolean {
  return !!msg && (SKEW.test(msg) || TRANSIENT.test(msg));
}

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
    if (!last.error || !isTransient(last.error.message)) return last;
    await new Promise((r) => setTimeout(r, w));
    last = await run();
  }
  return last;
}
