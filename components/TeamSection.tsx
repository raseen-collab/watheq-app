"use client";
// ============================================================
// وثيق — قسم «الموظفون» في الإعدادات (المالك فقط)
//
// الانضمام برمز لا ببريد: المالك يولّد رمزًا بدور محدد ويرسله
// بنفسه على واتساب، والموظف يُدخله في شاشة الترحيب. لا خدمات بريد،
// ولا انتظار، والرمز يُحرق بعد أول استخدام وينتهي بعد أسبوع.
//
// الأمان ليس هنا: هذه الواجهة عرضٌ وأزرار فقط — سياسات v9 في القاعدة
// هي التي تمنع الموظف مما لا يحق له، حتى لو عُدّلت هذه الشاشة كلها.
// ============================================================

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-client";
import { getOffice, makeInviteCode, ROLE_LABEL } from "@/lib/office";

type Member = { owner_id: string; member_id: string; role: string; member_name: string | null; created_at: string };
type Invite = { id: string; code: string; role: string; expires_at: string; used_at: string | null };

const ROLE_HELP: Record<string, string> = {
  manager: "كل شيء عدا الاشتراك والفوترة وإدارة الموظفين",
  collector: "يسجّل الدفعات والملاحظات ويقرأ — لا يحذف ولا يعدّل العقود",
  viewer: "قراءة فقط",
};

export default function TeamSection() {
  const supabase = createClient();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [role, setRole] = useState("collector");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(true);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const office = await getOffice(supabase);
    if (office && !office.isOwner) { setIsOwner(false); return; }
    const [m, i] = await Promise.all([
      supabase.from("team_members").select("*").eq("owner_id", user.id).order("created_at"),
      supabase.from("team_invites").select("id, code, role, expires_at, used_at")
        .eq("owner_id", user.id).is("used_at", null).gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }),
    ]);
    setMembers((m.data as Member[]) || []);
    setInvites((i.data as Invite[]) || []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function createInvite() {
    setBusy(true); setMsg(null);
    const { data: { user } } = await supabase.auth.getUser();
    const code = makeInviteCode();
    const { error } = await supabase.from("team_invites")
      .insert({ owner_id: user!.id, code, role });
    setBusy(false);
    if (error) { setMsg("تعذّر إنشاء الدعوة — شغّل schema-v9 وv9b أولًا إن لم تفعل."); return; }
    await load();
  }

  async function copyInvite(code: string) {
    // رابط التطبيق من العنوان الحالي لا من نص ثابت — الموقع التسويقي
    // (watheqapp.com) لا يحوي صفحة دخول، وكان الموظف يصل إلى 404
    const appOrigin = typeof window !== "undefined" ? window.location.origin : "https://app.watheqapp.com";
    const text = `تمت دعوتك للانضمام لمكتبنا على وثيق.\n\n١. سجّل حسابًا جديدًا من هنا: ${appOrigin}/login\n٢. بعد التسجيل ستظهر شاشة الترحيب — اضغط «موظف في مكتب مشترك؟ عندي رمز دعوة» وأدخل الرمز: ${code}\n\nالرمز يعمل مرة واحدة وينتهي خلال ٧ أيام.`;
    try { await navigator.clipboard.writeText(text); setCopied(code); setTimeout(() => setCopied(null), 1800); } catch {}
  }

  async function revokeInvite(id: string) {
    await supabase.from("team_invites").delete().eq("id", id);
    await load();
  }

  async function changeRole(m: Member, newRole: string) {
    const { error } = await supabase.from("team_members")
      .update({ role: newRole }).eq("owner_id", m.owner_id).eq("member_id", m.member_id);
    if (!error) await load();
  }

  async function removeMember(m: Member) {
    if (!confirm(`إزالة «${m.member_name || "الموظف"}» من المكتب؟ يفقد الوصول فورًا، وكل ما سجّله يبقى محفوظًا باسمه.`)) return;
    await supabase.from("team_members").delete()
      .eq("owner_id", m.owner_id).eq("member_id", m.member_id);
    await load();
  }

  if (!isOwner) return (
    <div className="bg-white border border-line rounded-2xl p-5 text-sm text-muted">
      👥 إدارة الموظفين والدعوات لصاحب المكتب.
    </div>
  );

  return (
    <div className="bg-white border border-line rounded-2xl p-5">
      <h3 className="font-display font-bold text-deep text-lg mb-1">👥 الموظفون</h3>
      <p className="text-xs text-muted mb-4 leading-relaxed">
        كل موظف بحسابه وكلمة مروره ودوره — وتعرف من سجّل كل دفعة.
        الاشتراك والفوترة تبقى لك وحدك مهما كان الدور.
      </p>

      {/* إنشاء دعوة */}
      <div className="flex flex-wrap items-end gap-2 mb-1">
        <div>
          <label className="block text-xs font-semibold mb-1">دور الموظف الجديد</label>
          <select className="fld" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="collector">محصّل</option>
            <option value="manager">مدير</option>
            <option value="viewer">مشاهد</option>
          </select>
        </div>
        <button className="btn btn-gold" onClick={createInvite} disabled={busy}>
          {busy ? "..." : "+ رمز دعوة"}
        </button>
      </div>
      <p className="text-[11px] text-muted mb-4">{ROLE_HELP[role]}</p>
      {msg && <p className="text-sm text-late mb-3">{msg}</p>}

      {/* دعوات سارية */}
      {invites.length > 0 && (
        <div className="mb-5">
          <div className="text-xs font-bold text-muted mb-2">دعوات بانتظار الاستخدام</div>
          <div className="flex flex-col gap-2">
            {invites.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-2 bg-paper2 border border-line rounded-xl px-3 py-2">
                <code className="font-mono font-bold tracking-widest text-deep" dir="ltr">{i.code}</code>
                <span className="text-xs text-muted">{ROLE_LABEL[i.role]}</span>
                <span className="text-[11px] text-muted">تنتهي {new Date(i.expires_at).toLocaleDateString("ar-SA")}</span>
                <span className="ms-auto flex gap-1.5">
                  <button className="btn btn-ghost text-xs" onClick={() => copyInvite(i.code)}
                    title="رسالة جاهزة بالرمز والخطوات — أرسلها للموظف على واتساب">
                    {copied === i.code ? "✓ نُسخت" : "نسخ رسالة الدعوة"}
                  </button>
                  <button className="btn btn-ghost text-xs" onClick={() => revokeInvite(i.id)}>إلغاء</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* الموظفون الحاليون */}
      {members.length === 0 ? (
        <p className="text-sm text-muted">لا موظفون بعد — أنشئ رمز دعوة وأرسله لموظفك.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {members.map((m) => (
            <div key={m.member_id} className="flex flex-wrap items-center gap-2 border border-line rounded-xl px-3 py-2">
              <b className="text-deep">{m.member_name || "موظف"}</b>
              <select className="fld !w-auto !py-1 text-sm" value={m.role}
                onChange={(e) => changeRole(m, e.target.value)}
                title={ROLE_HELP[m.role]}>
                <option value="manager">مدير</option>
                <option value="collector">محصّل</option>
                <option value="viewer">مشاهد</option>
              </select>
              <span className="ms-auto">
                <button className="btn btn-ghost text-xs text-late" onClick={() => removeMember(m)}>إزالة</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
