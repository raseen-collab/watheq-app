-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v50: إغلاق الانضمام القسري إلى فريق مكتب آخر
-- طُبِّق على الإنتاج واختُبر: 29 سبتمبر 2026
--
-- الثغرة: team_owner_all كانت FOR ALL بشرط (auth.uid() = owner_id) وحده،
-- فأي مالك يُدرج أي مستخدم عضوًا في فريقه بلا موافقته. بعدها يعيد
-- watheq_my_office مكتبَ المُدرِج للضحية، فتُكتب كل سجلاتها الجديدة باسمه.
-- فُحص الإنتاج قبل الإصلاح: لم تُستغلّ (عضوية واحدة، موظف حقيقي عند تميز).
--
-- الاختبار بعد التطبيق:
--   إدراج مباشر بصفة مستخدم مسجَّل  ⟵ permission denied  ✓
--   تعديل الدور/الصلاحيات من صاحب المكتب ⟵ يعمل (صف واحد) ✓
-- ═══════════════════════════════════════════════════════════════════

drop policy if exists team_owner_all on team_members;

create policy team_owner_select on team_members
  for select using (auth.uid() = owner_id);

create policy team_owner_update on team_members
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy team_owner_delete on team_members
  for delete using (auth.uid() = owner_id);

-- لا سياسة إدراج: العضوية تُنشأ فقط عبر watheq_redeem_invite (security definer).
-- ولا يُعدَّل إلا الدور والصلاحيات — فلا يُحوَّل صفّ إلى مستخدم آخر بتغيير member_id.
revoke insert, update on team_members from authenticated, anon;
grant update (role, perms) on team_members to authenticated;
