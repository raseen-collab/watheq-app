-- ============================================================
-- وثيق — schema-v101 (23 نوفمبر 2026) — من فحص Supabase Security Advisor
--
-- can_access_dashboard(p_user, p_dash): SECURITY DEFINER لا يستعمل auth.uid()،
-- فكان أي مستخدم مسجَّل يقدر يسأل عن نوع حساب مستخدم آخر (تسريب بسيط).
-- غير مستعمَلة في الكود ولا في أي سياسة RLS ولا دالة أخرى (فُحص) — فتُسحب صلاحية
-- تنفيذها من المتصفح. لا حذف (قاعدة عبيد). آمن للتكرار.
-- ============================================================
revoke all on function public.can_access_dashboard(uuid, text) from public, anon, authenticated;
