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

type Member = { owner_id: string; member_id: string; role: string; member_name: string | null; created_at: string; perms?: Record<string, boolean> | null };

/**
 * الصلاحيات الدقيقة: الدور يحدد الافتراضي، وهذه استثناءات صريحة لكل موظف.
 * محصّل يسجّل الدفعات ولا يُصدر الفواتير؟ أطفئ «إصدار الفواتير» له وحده.
 */
const PERMS: { k: string; label: string; hint: string; def: Record<string, boolean>; group: string; locked?: boolean }[] = [
  { group: "التحصيل اليومي", k: "record_payments", label: "تسجيل الدفعات", hint: "زرّا ✔ و½ في اللوحة", def: { manager: true, collector: true, viewer: false } },
  { group: "التحصيل اليومي", k: "issue_invoices",  label: "إصدار الفواتير", hint: "الفاتورة الضريبية المرقّمة", def: { manager: true, collector: true, viewer: false } },
  { group: "التحصيل اليومي", k: "send_reminders",  label: "التذكيرات والخطابات", hint: "تذكير واتساب ونموذج الإشعار", def: { manager: true, collector: true, viewer: false } },
  { group: "التحصيل اليومي", k: "add_notes",       label: "إضافة ملاحظات", hint: "سجل العقار", def: { manager: true, collector: true, viewer: false } },
  { group: "التحصيل اليومي", k: "view_activity",   label: "سجل العمليات", hint: "من سجّل ماذا ومتى", def: { manager: true, collector: true, viewer: true } },

  { group: "العقود والوحدات", k: "edit_tenants",    label: "إضافة وتعديل الوحدات", hint: "العقود والرفع من Excel", def: { manager: true, collector: false, viewer: false } },
  { group: "العقود والوحدات", k: "renew_contracts", label: "تجديد العقود", hint: "تمديد المدة وتعديل الإيجار", def: { manager: true, collector: false, viewer: false } },
  { group: "العقود والوحدات", k: "move_out",        label: "الإخلاء والمخالصة", hint: "إنهاء العقد وتسوية التأمين", def: { manager: true, collector: false, viewer: false } },

  { group: "أرقام المكتب والمالك", k: "manage_expenses",   label: "تسجيل المصروفات", hint: "ما يُدفع نيابة عن المالك", def: { manager: true, collector: false, viewer: false } },
  { group: "أرقام المكتب والمالك", k: "view_financials",   label: "أرقام المالك", hint: "تقرير المالك وكشفه وأتعاب الإدارة", def: { manager: true, collector: false, viewer: false } },
  { group: "أرقام المكتب والمالك", k: "owner_links",       label: "روابط الملّاك", hint: "إنشاؤها وإبطالها", def: { manager: true, collector: false, viewer: false } },
  { group: "أرقام المكتب والمالك", k: "export_data",       label: "تصدير بيانات المكتب", hint: "ملف Excel بكل شيء", def: { manager: true, collector: false, viewer: false } },

  { group: "المكتب", k: "manage_listings",   label: "المعروضات والطلبات", hint: "سجل المعروضات ومطابقة الباحثين", def: { manager: true, collector: false, viewer: false } },
  { group: "المكتب", k: "manage_compliance", label: "التزامات المكتب", hint: "رخصة فال وعقود الوساطة والتراخيص", def: { manager: true, collector: false, viewer: false } },

  { group: "إدارية — للمدير فقط", k: "undo_actions", label: "التراجع والحذف", hint: "إلغاء دفعة، حذف وحدة أو مصروف أو ملاحظة", def: { manager: true, collector: false, viewer: false }, locked: true },
];
const GROUPS = ["التحصيل اليومي", "العقود والوحدات", "أرقام المكتب والمالك", "المكتب", "إدارية — للمدير فقط"];
const permOn = (m: Member, k: string) => {
  const ex = (m.perms || {})[k];
  if (typeof ex === "boolean") return ex;
  return PERMS.find((p) => p.k === k)?.def[m.role] ?? false;
};
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
    const { data: d1 } = await supabase.from("team_invites").delete().eq("id", id).select("id");
    if (!d1?.length) { alert("هذا الإجراء يحتاج صلاحية صاحب المكتب."); return; }
    await load();
  }

  async function changeRole(m: Member, newRole: string) {
    const { error } = await supabase.from("team_members")
      .update({ role: newRole }).eq("owner_id", m.owner_id).eq("member_id", m.member_id);
    if (!error) await load();
  }

  async function togglePerm(m: Member, k: string) {
    const meta = PERMS.find((p) => p.k === k);
    if (meta?.locked) { alert("التراجع والحذف صلاحية إدارية — تُمنح بترقية الموظف إلى «مدير» لا باستثناء."); return; }
    const next = { ...(m.perms || {}), [k]: !permOn(m, k) };
    // إن عاد الاستثناء لمطابقة افتراضي الدور نحذفه — نُبقي الاستثناءات الصريحة فقط
    const def = PERMS.find((p) => p.k === k)?.def[m.role];
    if (next[k] === def) delete next[k];
    const { data, error } = await supabase.from("team_members").update({ perms: next })
      .eq("owner_id", m.owner_id).eq("member_id", m.member_id).select("member_id");
    if (error) return alert(error.message);
    if (!data?.length) return alert("هذا الإجراء يحتاج صلاحية صاحب المكتب.");
    setMembers((cur) => cur.map((x) => x.member_id === m.member_id ? { ...x, perms: next } : x));
  }

  async function removeMember(m: Member) {
    if (!confirm(`إزالة «${m.member_name || "الموظف"}» من المكتب؟ يفقد الوصول فورًا، وكل ما سجّله يبقى محفوظًا باسمه.`)) return;
    // حذف رفضته السياسات يرجع بلا خطأ وبصفر صفوف — لا نوهم صاحب المكتب بالنجاح
    const { data, error } = await supabase.from("team_members").delete()
      .eq("owner_id", m.owner_id).eq("member_id", m.member_id).select("member_id");
    if (error) return alert(error.message);
    if (!data?.length) return alert("هذا الإجراء يحتاج صلاحية صاحب المكتب.");
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
              <details className="w-full mt-1">
                <summary className="cursor-pointer text-xs text-muted">صلاحيات مخصّصة {Object.keys(m.perms || {}).length > 0 && <span className="text-gold font-semibold">({Object.keys(m.perms || {}).length} استثناء)</span>}</summary>
                <div className="mt-2 bg-paper border border-line rounded-lg p-2 space-y-2">
                  {GROUPS.map((g) => (
                    <div key={g}>
                      <div className="text-[11px] font-bold text-deep mb-1">{g}</div>
                      <div className="grid sm:grid-cols-2 gap-1.5">
                        {PERMS.filter((x) => x.group === g).map((perm) => {
                          const on = permOn(m, perm.k);
                          const custom = typeof (m.perms || {})[perm.k] === "boolean";
                          return (
                            <label key={perm.k} className={`flex items-start gap-2 text-sm ${perm.locked ? "opacity-70" : "cursor-pointer"}`}
                              title={perm.locked ? "تُمنح بترقية الموظف إلى مدير" : undefined}>
                              <input type="checkbox" className="w-4 h-4 mt-0.5" checked={on} disabled={perm.locked}
                                onChange={() => togglePerm(m, perm.k)} />
                              <span>
                                {perm.label}
                                {perm.locked && <span className="text-[10px] text-muted"> 🔒</span>}
                                {custom && <span className="text-[10px] text-gold"> · مخصّص</span>}
                                <span className="block text-[11px] text-muted">{perm.hint}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted mt-1">بلا تخصيص تتبع صلاحياتُه دورَه. أي تغيير هنا يسري فورًا، وتحرسه قاعدة البيانات لا الواجهة.</p>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
