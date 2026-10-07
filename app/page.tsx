import { redirect } from "next/navigation";

/**
 * جذر التطبيق يحوّل إلى اللوحة (ومنها إلى الدخول لمن لا جلسة له).
 * مصدر الزائر (?src=) ومعرّف جلسة القمع (?wv=) يعبران التحويل: روابط قديمة
 * منشورة تفتح الجذر مباشرةً، وضياعهما هنا كان يسجّل الحساب بلا قناة.
 */
export default function Home({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const q = new URLSearchParams();
  const src = searchParams?.src, wv = searchParams?.wv;
  if (typeof src === "string" && /^[a-z]{2,20}$/.test(src)) q.set("src", src);
  if (typeof wv === "string" && /^[A-Za-z0-9]{10,40}$/.test(wv)) q.set("wv", wv);
  const qs = q.toString();
  redirect(qs ? `/dashboard?${qs}` : "/dashboard");
}
