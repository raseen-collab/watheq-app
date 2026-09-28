-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v48: إغلاق «INV-2026-0000»
--
-- ما حدث:
--   trg_guard_profile_columns (BEFORE UPDATE على profiles) يُلغي أي تغيير
--   في invoice_counter ما لم تُرفع العلامة watheq.bump_invoice_counter.
--   و next_invoice_no ترفعها فعلًا — لكن الحارس لا يراها. والنتيجة أن
--   UPDATE … RETURNING يُعيد القيمة القديمة (لأن تريجرات BEFORE تعدّل
--   الصفّ الذي يُعيده RETURNING)، فيخرج الرقم نفسه في كل إصدار:
--     عمرو   عدّاده 0  → 26 فاتورة كلها INV-2026-0000
--     تميز   عدّاده 0  →  5 فواتير كلها INV-2026-0000
--     عبيد   عدّاده 16 → 15 فاتورة كلها INV-2026-0016
--   منذ ٦ سبتمبر ٢٠٢٦ تقريبًا، بلا رسالة خطأ واحدة.
--
-- لماذا لا يرى الحارس العلامة: لا أعرف على وجه اليقين. ولهذا لا يحاول
-- هذا الملف إصلاح المصافحة — بل يُلغي الحاجة إليها.
--
-- والمسوّغ من تعليق الحارس نفسه:
--   «أقصى ضرر محتمل لو ملكها أن يقفز رقم فاتورته — لا شيء يُشترى به.»
--   أي أن حماية هذا العمود عديمة القيمة أمنيًّا بتقدير كاتبها، وهي الآن
--   تُنتج فواتير ضريبية مكرّرة لعملاء حقيقيين. فتُرفع الحماية.
--
-- ما لا يتغيّر: حماية plan و subscribed_until و trial_* و id و created_at
-- تبقى كما هي حرفيًّا. لا نلمس شيئًا آخر في هذه الدفعة.
--
-- Supabase → SQL Editor → New query → الصق الملف كاملًا → Run
-- ═══════════════════════════════════════════════════════════════════


-- ── ١) الحارس: بلا فقرة invoice_counter ──
create or replace function public.guard_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- الخادم وحده يعدّل الباقة والاشتراك والتجربة والمعرّف
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and auth.uid() is not null then
    new.id               := old.id;
    new.plan             := old.plan;
    new.subscribed_until := old.subscribed_until;
    new.trial_started_at := old.trial_started_at;
    new.trial_ends_at    := old.trial_ends_at;
    new.created_at       := old.created_at;

    -- invoice_counter: أُزيل من الحارس في v48.
    -- كان يُلغى بصمت فيتجمّد العدّاد وتتكرّر أرقام الفواتير الضريبية.
    -- الحماية الحقيقية لرقم الفاتورة هي فهرس الفرادة على invoices
    -- (القسم ٣ أدناه)، لا حارسٌ على عدّاد.
  end if;
  return new;
end $$;


-- ── ٢) الدالة: بلا العلامة التي لم يعد أحد يقرأها ──
create or replace function public.next_invoice_no(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare n int; uid uuid := auth.uid();
begin
  if uid is null or not (uid = p_user
      or watheq_perm(p_user, 'record_payments')
      or watheq_perm(p_user, 'edit_units')) then
    raise exception 'not authorized';
  end if;

  update public.profiles set invoice_counter = coalesce(invoice_counter, 0) + 1
   where id = p_user returning invoice_counter into n;

  if n is null then raise exception 'المكتب غير موجود'; end if;
  return 'INV-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' || lpad(n::text, 4, '0');
end $$;

revoke all on function public.next_invoice_no(uuid) from public, anon;
grant execute on function public.next_invoice_no(uuid) to authenticated;


-- ── ٣) التحقّق: شغّله وحده بعد الجملتين أعلاه ──
-- المتوقَّع: رقم أعلى بواحد من عدّادك، ومختلف في كل تشغيل.
-- ⚠️ ملاحظة: في محرّر SQL تكون auth.uid() فارغة، فقد ترفض الدالة.
--    التحقّق الحقيقي في التطبيق: أصدر فاتورة تجريبية لوحدة عندك
--    وتأكّد أن رقمها INV-2026-0018 لا 0016.

-- select invoice_counter from profiles where org_name = 'عبيد';


-- ═══════════════════════════════════════════════════════════════════
-- القسم ٣: فهرس الفرادة — لا تشغّله الآن
--
-- يجب أن تسبقه إعادة ترقيم الفواتير الموجودة (٢٦ لعمرو، ٥ لتميز،
-- ١٥ لك). وهي قرار يمسّ سجلات ضريبية لعملاء — نتّخذه صباحًا لا الآن.
-- تشغيله قبل ذلك سيفشل، ولو نجح لَمنع عمرو من إصدار أي فاتورة.
--
-- create unique index concurrently if not exists invoices_no_unique
--   on invoices (user_id, invoice_no);
-- ═══════════════════════════════════════════════════════════════════
