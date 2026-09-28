-- ═══════════════════════════════════════════════════════════════════
-- وثيق — schema-v49: منع تكرار رقم الفاتورة بنيويًّا
--
-- ⚠️ شغّل schema-v48 أولًا. هذا الملف لا يوقف النزيف — v48 يفعل.
--    هذا يمنع عودته، ويتعامل مع الـ46 فاتورة المصابة أصلًا.
--
-- الخيار المنفَّذ هنا: **لا نغيّر رقم أي فاتورة صدرت.**
--   نضيف عمودًا يعلّم الصفوف المكرّرة القديمة، ونبني فهرس الفرادة على
--   ما عداها. فالماضي يبقى كما هو على الورق وفي القاعدة، والمستقبل
--   يستحيل فيه التكرار.
--
-- لماذا هذا لا إعادة الترقيم: 26 من فواتير عمرو و5 من تميز ربما سُلّمت
--   لمستأجرين. تغيير أرقامها في القاعدة يجعلها تخالف الورق الذي بيدهم —
--   وهذه سجلات ضريبية لطرف ثالث، لا بياناتنا. وإعادة الترقيم لا تُلغي
--   ما صدر أصلًا، فمكسبها تجميلي وخسارتها حقيقية.
--
-- البديل (إعادة الترقيم) مذكور في آخر الملف، معطَّلًا. اقرأه واختر.
--
-- Supabase → SQL Editor → New query → الصق الملف → Run
-- ═══════════════════════════════════════════════════════════════════


-- ── ١) عمود التعليم ──
alter table public.invoices
  add column if not exists legacy_dup boolean not null default false;

comment on column public.invoices.legacy_dup is
  'صفّ يحمل رقم فاتورة مكرَّرًا صدر قبل إصلاح v48 (عطل تجميد invoice_counter، '
  '٦–٢٨ سبتمبر ٢٠٢٦). مستثنى من فهرس الفرادة كي لا يُعاد ترقيم ما سُلّم للعملاء. '
  'لا يُضبط على صفٍّ جديد أبدًا.';


-- ── ٢) علّم الصفوف الزائدة — يُبقى أقدمُ صفّ لكل رقم بلا تعليم ──
with ranked as (
  select id,
         row_number() over (
           partition by user_id, invoice_no
           order by created_at asc, issue_date asc, id asc
         ) as rn
  from public.invoices
)
update public.invoices
   set legacy_dup = true
 where id in (select id from ranked where rn > 1);


-- ── ٣) فهرس الفرادة على ما ليس قديمًا ──
-- من الآن: أي محاولة لإدراج رقم مكرَّر تفشل بخطأ صريح، لا بصمت.
create unique index if not exists invoices_no_unique
  on public.invoices (user_id, invoice_no)
  where not legacy_dup;


-- ── ٤) التحقّق — المتوقَّع: صفر ──
select count(*) as تكرار_باقٍ
from (
  select user_id, invoice_no
  from public.invoices
  where not legacy_dup
  group by user_id, invoice_no
  having count(*) > 1
) x;


-- ── ٥) ما عُلِّم، للسجل ──
select coalesce(pr.org_name, pr.full_name, '—') as المكتب,
       count(*) as صفوف_معلَّمة
from public.invoices i
join public.profiles pr on pr.id = i.user_id
where i.legacy_dup
group by 1
order by 2 desc;


-- ═══════════════════════════════════════════════════════════════════
-- البديل: إعادة الترقيم — لا تشغّله إلا إن قرّرتَ أن مطابقة القاعدة
-- للتسلسل أهمّ من مطابقتها للورق الذي بيد عملاء عمرو وتميز.
-- وإن شغّلته، فأبلغ عمرو وتميز قبل ذلك لا بعده.
--
-- with ranked as (
--   select id, user_id,
--          row_number() over (partition by user_id order by created_at, id) as seq
--   from public.invoices
-- )
-- update public.invoices i
--    set invoice_no = 'INV-' || to_char(now() at time zone 'Asia/Riyadh','YYYY')
--                  || '-' || lpad(r.seq::text, 4, '0'),
--        legacy_dup = false
--   from ranked r where r.id = i.id;
--
-- update public.profiles p
--    set invoice_counter = (select count(*) from public.invoices i where i.user_id = p.id)
--  where exists (select 1 from public.invoices i where i.user_id = p.id);
-- ═══════════════════════════════════════════════════════════════════
