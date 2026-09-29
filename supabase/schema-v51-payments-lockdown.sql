-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v51: منع الدفعات المزوّرة بين المكاتب
-- طُبِّق على الإنتاج واختُبر: 29 سبتمبر 2026
--
-- الثغرة: سياسة الإدراج كانت تتحقق من user_id وحده، ولا تربط tenant_id
-- بالمكتب نفسه. فمكتب يُدرج دفعة باسمه تشير إلى مستأجر مكتب آخر، ثم
-- يستدعي watheq_reverse_payment فتُعدَّل أرصدة ذلك المستأجر.
--
-- لماذا المنع الكامل آمن: المتصفح لا يُدرج دفعة مباشرة أبدًا. كل تسجيل
-- يمرّ عبر دوال watheq_record_* و watheq_reverse/undo/relet (كلها security
-- definer — تُحقِّق منها في الإنتاج: 8/8)، والبوت والتجريبي بمفتاح الخدمة.
-- والتعديل من الواجهة موضعان فقط: التاريخ والمرجع، واسم الدافع والوحدة.
--
-- الاختبار بعد التطبيق:
--   إدراج مباشر بصفة مستخدم مسجَّل ⟵ permission denied ✓
--   watheq_record_payment بصفة صاحب المكتب ⟵ يعمل ✓
-- ═══════════════════════════════════════════════════════════════════

revoke insert on payments from authenticated, anon;

revoke update on payments from authenticated, anon;
grant update (paid_on, reference, note, payer_name, unit_label) on payments to authenticated;
