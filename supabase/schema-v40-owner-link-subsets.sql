-- ============================================================
-- وثيق — schema-v40: رابط المالك لعقارات مختارة + حارس الملكية
--
-- (١) الميزة: كان الرابط لعقار واحد أو لكل عقارات مالك باسمه. والمالك
--     الذي عنده ست عمائر يريد أحيانًا رابطًا لثلاث منها فقط — كأن تكون
--     الثلاث الأخرى بشراكة مع غيره. فيُضاف نطاق ثالث: قائمة عقارات.
--
-- (٢) الثغرة — وهي الأهمّ:
--     سياسة الكتابة تتحقق أن user_id في الرابط مكتبُ المُدرِج، ولا تتحقق
--     أن property_id عقارٌ لذلك المكتب. والمسار العام /r/[token] يقرأ
--     العقار بمفتاح الخدمة (يتجاوز RLS) دون تقييده بصاحب الرابط.
--     فأي مستخدم مسجَّل يستطيع إنشاء رابط باسمه لعقار مكتب آخر وفتحه،
--     فيرى مستأجريه وجوالاتهم ودفعاته. الشرط الوحيد معرفة معرّف العقار.
--
--     الإصلاح بطبقتين: هذا الحارس يمنع الإدراج من الأصل، والمسار يقيّد
--     القراءة بصاحب الرابط (route.ts) — فلو سقطت إحداهما صمدت الأخرى.
-- ============================================================

alter table owner_links add column if not exists property_ids uuid[];

/* نطاق واحد بالضبط من الثلاثة */
alter table owner_links drop constraint if exists owner_links_scope_chk;
alter table owner_links add constraint owner_links_scope_chk check (
  (property_id is not null)::int
  + (owner_name is not null and property_ids is null)::int
  + (property_ids is not null)::int = 1
);

/* حدّ معقول: رابط بآلاف العقارات ليس «اختيارًا» */
alter table owner_links drop constraint if exists owner_links_ids_len_chk;
alter table owner_links add constraint owner_links_ids_len_chk
  check (property_ids is null or (cardinality(property_ids) between 1 and 200));

/* التنظيف أولًا — قبل الحارس. لو جاء بعده لرفضه الحارس نفسه: فالرابط
   الذي نبطله يشير أصلًا لعقار لا يتبع مكتبه. */
update owner_links l set revoked = true
where l.property_id is not null
  and not exists (select 1 from properties p where p.id = l.property_id and p.user_id = l.user_id);

create or replace function owner_links_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare foreign_n int;
begin
  /* العقار المفرد: يجب أن يكون لمكتب الرابط */
  if new.property_id is not null then
    if not exists (select 1 from properties where id = new.property_id and user_id = new.user_id) then
      raise exception 'العقار لا يتبع هذا المكتب' using errcode = '42501';
    end if;
  end if;

  /* القائمة: كل عقار فيها لمكتب الرابط، ولا معرّف غريب */
  if new.property_ids is not null then
    select count(*) into foreign_n
    from unnest(new.property_ids) as x(id)
    where not exists (select 1 from properties p where p.id = x.id and p.user_id = new.user_id);
    if foreign_n > 0 then
      raise exception 'عقار أو أكثر لا يتبع هذا المكتب' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists owner_links_guard_trg on owner_links;
/* «update of» يحصره في أعمدة النطاق: إبطال رابط (تغيير revoked) أو تعديل
   وصفه لا يُطلق الحارس — وإلا تعذّر إبطال رابط قديم غير متطابق أصلًا. */
create trigger owner_links_guard_trg
  before insert or update of property_id, property_ids, user_id on owner_links
  for each row execute function owner_links_guard();

-- فحص: عدد الروابط المُبطَلة بسبب عدم التطابق (المتوقع صفر في قاعدة سليمة)
select count(*) as روابط_غير_متطابقة_أُبطلت
from owner_links l
where l.revoked and l.property_id is not null
  and not exists (select 1 from properties p where p.id = l.property_id and p.user_id = l.user_id);
