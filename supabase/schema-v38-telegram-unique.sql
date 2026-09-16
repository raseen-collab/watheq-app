-- ============================================================
-- وثيق — schema-v38: محادثة تليجرام واحدة لحساب واحد
--
-- العطل: ربط الحساب لا يفكّ ارتباط المحادثة بحساب سابق. فلو ربط المكتب
-- محادثته بحساب ثانٍ (أو ربط موظف ثم صاحب المكتب من الجهاز نفسه)، صار
-- صفّان بنفس telegram_chat_id.
--
-- وعندها يتعطّل البوت للاثنين معًا بلا رسالة: البحث بالمحادثة يستعمل
-- maybeSingle، وهي تُرجع خطأً حين تجد أكثر من صف — فيقول البوت «حسابك
-- غير مربوط» لمن ربط حسابه للتوّ.
--
-- الفهرس الفريد يمنع الحالة من الجذر، والكود يفكّ الارتباط السابق قبل
-- الربط الجديد (انظر linkAccount).
-- ============================================================

/* تنظيف ما قد يكون تكوّن قبل الفهرس: نُبقي أحدث ارتباط ونفكّ الباقي */
update profiles p set telegram_chat_id = null, telegram_username = null, telegram_linked_at = null
where telegram_chat_id is not null
  and exists (
    select 1 from profiles q
    where q.telegram_chat_id = p.telegram_chat_id
      and q.id <> p.id
      and coalesce(q.telegram_linked_at, 'epoch'::timestamptz) > coalesce(p.telegram_linked_at, 'epoch'::timestamptz)
  );

create unique index if not exists profiles_telegram_chat_uniq
  on profiles (telegram_chat_id) where telegram_chat_id is not null;

comment on index profiles_telegram_chat_uniq is
  'محادثة تليجرام لا تُربط بأكثر من حساب — وإلا تعطّل البحث بالمحادثة للاثنين';
