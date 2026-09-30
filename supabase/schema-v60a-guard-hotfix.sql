-- ============================================================
-- وثيق — schema-v60a: إصلاح عاجل — حفظ «الموازنة» في الجمعيات (30 سبتمبر 2026)
--
-- حارس v60 (الجمعية والدفعة تتبعان مكتبها) يقرأ عمود owner_id، وجدول
-- الموازنات لا يملك هذا العمود ⇒ كل حفظ موازنة يفشل بخطأ
-- «record "new" has no field "owner_id"». هذا الملف يستبدل الدالة وحدها
-- بنسخة تقرأ owner_id للدفعات فقط. لا يغيّر أي بيانات. آمن للتكرار.
-- ============================================================
begin;
create or replace function public.watheq_guard_assoc_office()
returns trigger language plpgsql security definer set search_path = public as $$
declare aoff uuid; n_owner uuid; o_owner uuid;
begin
  if tg_table_name = 'payments' then
    n_owner := nullif(to_jsonb(new)->>'owner_id', '')::uuid;
    if tg_op = 'UPDATE' then o_owner := nullif(to_jsonb(old)->>'owner_id', '')::uuid; end if;
  end if;
  -- فكّ الروابط عند الحذف (set null) أو تعديل لا يغيّر الانتماء: لا فحص
  if tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id
     and (new.association_id is null or new.association_id is not distinct from old.association_id)
     and (n_owner is null or n_owner is not distinct from o_owner) then
    return new;
  end if;
  if new.association_id is not null then
    select user_id into aoff from associations where id = new.association_id;
    if aoff is distinct from new.user_id then
      raise exception 'الجمعية لا تتبع هذا المكتب' using errcode = '42501';
    end if;
  end if;
  if n_owner is not null then
    if not exists (select 1 from owners o join associations a on a.id = o.association_id
                   where o.id = n_owner and a.user_id = new.user_id
                     and (new.association_id is null or o.association_id = new.association_id)) then
      raise exception 'المالك لا يتبع هذا المكتب' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

commit;

select position('to_jsonb(new)' in pg_get_functiondef('public.watheq_guard_assoc_office()'::regprocedure)) > 0 as الحارس_مُصلَح;
