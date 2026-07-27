import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** تسجيل إقرار المستخدم بحدود المستشار — مرّة واحدة لكل حساب */
export async function POST() {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) {
    return NextResponse.json({ ok: false, error: "سجّل الدخول أولًا." }, { status: 401 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ advisor_ack_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    console.error("Watheq advisor ack error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
