-- ============================================================
-- وثيق — schema-v98: جوال المالك على العقار (22 نوفمبر 2026 — طلب مكتب الأولى)
--
-- المكتب يريد، حين ينتهي عقد وحدة ولا يتجاوب المستأجر للسداد أو الإخلاء، أن
-- يبلّغ مالك العمارة برسالة واتساب جاهزة من صف الوحدة. الرسالة تُبنى في المتصفح
-- (lib/tenant-messages: ownerAlertText)؛ القاعدة تحفظ الجوال فقط.
-- الجوال يُطبَّع في الواجهة (waNumber) ويُحفظ كما أُدخل حتى 20 خانة.
-- يخضع لسياسات properties نفسها (watheq_can_read / can_manage). آمن للتكرار. لا يحذف بيانات.
-- ============================================================

alter table public.properties add column if not exists owner_phone text;
do $$ begin
  alter table public.properties add constraint properties_owner_phone_len check (owner_phone is null or char_length(owner_phone) <= 20);
exception when duplicate_object then null; end $$;
