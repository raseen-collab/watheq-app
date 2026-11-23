-- ============================================================
-- وثيق — schema-v102 (23 نوفمبر 2026) — من فحص Supabase Performance Advisor
--
-- auth_rls_initplan: 14 سياسة RLS كانت تحسب auth.uid() لكل صف. نفس المنطق حرفيًّا،
-- فقط auth.uid() ← (select auth.uid()) فتُحسب مرة واحدة لكل استعلام.
-- ALTER POLICY فقط (لا حذف ولا إعادة إنشاء)، آمن للتكرار.
-- + فهارس للمفاتيح الأجنبية غير المفهرسة (unindexed_foreign_keys) — إضافة فقط.
-- ============================================================
alter policy advisor_delete_own on public.advisor_log using (user_id = (select auth.uid()));
alter policy advisor_insert_own on public.advisor_log with check (user_id = (select auth.uid()));
alter policy advisor_select_own on public.advisor_log using (user_id = (select auth.uid()));
alter policy assoc_delete on public.associations using ((select auth.uid()) = user_id);
alter policy msg_insert on public.office_messages with check (watheq_can_read(user_id) and (author_id = (select auth.uid())));
alter policy msg_update on public.office_messages
  using (watheq_can_read(user_id) and ((author_id = (select auth.uid())) or (assigned_to = (select auth.uid())) or watheq_perm(user_id, 'undo_actions'::text)))
  with check (watheq_can_read(user_id));
alter policy profiles_self on public.profiles using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
alter policy prop_delete on public.properties using ((select auth.uid()) = user_id);
alter policy subscription_claims_own on public.subscription_claims using (user_id = (select auth.uid()));
alter policy invites_owner_all on public.team_invites using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
alter policy team_member_read_self on public.team_members using ((select auth.uid()) = member_id);
alter policy team_owner_delete on public.team_members using ((select auth.uid()) = owner_id);
alter policy team_owner_select on public.team_members using ((select auth.uid()) = owner_id);
alter policy team_owner_update on public.team_members using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

-- فهارس المفاتيح الأجنبية (24) — تسرّع الربط والحذف المتسلسل حين يكبر عدد المشتركين
create index if not exists fk_help_feedback_user_id on public.help_feedback (user_id);
create index if not exists fk_help_queries_user_id on public.help_queries (user_id);
create index if not exists fk_hoa_payment_claims_approved_payment_id on public.hoa_payment_claims (approved_payment_id);
create index if not exists fk_hoa_payment_claims_link_id on public.hoa_payment_claims (link_id);
create index if not exists fk_hoa_requests_expense_id on public.hoa_requests (expense_id);
create index if not exists fk_hoa_requests_link_id on public.hoa_requests (link_id);
create index if not exists fk_hoa_signatures_link_id on public.hoa_signatures (link_id);
create index if not exists fk_hoa_signatures_owner_id on public.hoa_signatures (owner_id);
create index if not exists fk_listing_links_user_id on public.listing_links (user_id);
create index if not exists fk_listing_shows_user_id on public.listing_shows (user_id);
create index if not exists fk_listings_brokerage_id on public.listings (brokerage_id);
create index if not exists fk_office_ledger_property_id on public.office_ledger (property_id);
create index if not exists fk_office_messages_property_id on public.office_messages (property_id);
create index if not exists fk_office_messages_tenant_id on public.office_messages (tenant_id);
create index if not exists fk_owner_links_property_id on public.owner_links (property_id);
create index if not exists fk_past_tenancies_unit_row_id on public.past_tenancies (unit_row_id);
create index if not exists fk_problem_reports_user_id on public.problem_reports (user_id);
create index if not exists fk_team_invites_owner_id on public.team_invites (owner_id);
create index if not exists fk_team_invites_used_by on public.team_invites (used_by);
create index if not exists fk_team_members_member_id on public.team_members (member_id);
create index if not exists fk_tenant_payment_claims_link_id on public.tenant_payment_claims (link_id);
create index if not exists fk_tenant_payment_claims_property_id on public.tenant_payment_claims (property_id);
create index if not exists fk_tenant_requests_expense_id on public.tenant_requests (expense_id);
create index if not exists fk_tenant_requests_link_id on public.tenant_requests (link_id);
