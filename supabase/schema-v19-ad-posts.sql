-- ============================================================
-- وثيق — schema-v19: سجل النشر الإعلاني
--
-- مسؤول الإعلانات الحقيقي لا تكمن قيمته في كتابة النص، بل في أنه يتذكّر
-- ماذا نُشر ومتى وأين، ويقيس ما نتج عنه، ثم يكرّر ما نجح. بلا هذا السجل
-- يبقى أي «مستشار» مولّد نصوص لا أكثر.
--
-- الجدول لصاحب المنصة وحده: RLS مفعّل بلا سياسات، والكتابة عبر الخادم
-- بمفتاح الخدمة بعد فحص ADMIN_USER_IDS — كما في subscription_payments.
-- ============================================================

create table if not exists ad_posts (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null,                       -- haraj | twitter | group | direct | other
  title       text,
  content     text not null,
  posted_at   timestamptz not null default now(),
  url         text,                                -- رابط المنشور إن وُجد
  outcome     text,                                -- ما نتج: ردود، مكالمات، تسجيلات (يكتبه صاحب المنصة)
  replies     int default 0,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create index if not exists ad_posts_posted_idx on ad_posts (posted_at desc);
create index if not exists ad_posts_channel_idx on ad_posts (channel, posted_at desc);

alter table ad_posts enable row level security;
-- بلا سياسات عمدًا: لا وصول لأي مستخدم مسجَّل. الخادم وحده (service_role).
