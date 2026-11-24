#!/usr/bin/env node
/**
 * وثيق — استرجاع نسخة الجداول (JSON مفكوك من .wqbk) إلى قاعدة Postgres.
 *
 *   1) فك النسخة:   BACKUP_ENCRYPTION_KEY='...' node scripts/decrypt-backup.mjs 2026-11-22.wqbk > backup.json
 *   2) ولّد SQL:     node scripts/restore-backup.mjs backup.json > restore.sql
 *   3) نفّذه على قاعدة فيها المخطط (الجداول) وبلا بيانات:
 *        psql "<رابط القاعدة>" -v ON_ERROR_STOP=1 -f restore.sql
 *
 * خيارات:
 *   --tables=a,b       استرجاع جداول محددة فقط (مثلًا payments,tenants لمكتب واحد بعد خطأ)
 *   --skip-existing    صف موجود بنفس المفتاح يُترك (ON CONFLICT DO NOTHING) — للاسترجاع فوق قاعدة حية
 *   --with-auth        يضيف حسابات الدخول إلى auth.users (قاعدة تجريبية فقط؛ في Supabase
 *                      تُستعاد الحسابات من لوحة Authentication أو تُدعى من جديد)
 *
 * كيف يعمل: كل الاسترجاع في معاملة واحدة (كلّه أو لا شيء)، والمشغّلات والقيود الخارجية
 * معطّلة أثناءه (session_replication_role = replica) فلا يهم ترتيب الجداول ولا تعمل
 * المشغّلات (عدّادات السندات، السجلات) على بيانات قديمة. بعد الالتزام: فحص يطابق عدد
 * صفوف كل جدول مع النسخة، وفحص كل مفتاح خارجي (لا صف يشير لصف غير موجود) — أي اختلاف = خطأ صريح.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) { console.error("الاستخدام: node scripts/restore-backup.mjs backup.json [--tables=a,b] [--skip-existing] [--with-auth] > restore.sql"); process.exit(2); }
const opt = (n) => args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
const only = opt("tables") ? opt("tables").split("=")[1].split(",").map((s) => s.trim()).filter(Boolean) : null;
const skip = !!opt("skip-existing");
const withAuth = !!opt("with-auth");

const m = JSON.parse(readFileSync(file, "utf8"));
if (m?.format !== "watheq-backup") { console.error("ليست نسخة جداول وثيق (format=watheq-backup)"); process.exit(1); }
if (!m.complete) console.error(`⚠️ النسخة ناقصة: ${m.failed.join(" | ")}`);

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`اسم جدول غير متوقع: ${s}`);
  return s;
};
const tag = "wq" + Math.random().toString(36).slice(2, 10);
const lit = (rows) => {
  const j = JSON.stringify(rows);
  if (j.includes(`$${tag}$`)) throw new Error("تعارض نادر في محدد النص — أعد التشغيل");
  return `$${tag}$${j}$${tag}$`;
};

const names = Object.keys(m.tables).filter((t) => t !== "auth.users" && (!only || only.includes(t))).sort();
if (only) for (const t of only) if (!(t in m.tables)) { console.error(`الجدول ${t} غير موجود في النسخة`); process.exit(1); }
const out = [];
out.push(`-- وثيق: استرجاع نسخة ${m.day} (${names.length} جدول)`);
out.push("\\set ON_ERROR_STOP 1");
out.push("begin;");
out.push("set local session_replication_role = replica;");
if (withAuth && Array.isArray(m.tables["auth.users"])) {
  out.push(`insert into auth.users (id, email, phone, created_at, last_sign_in_at, email_confirmed_at, user_metadata, app_metadata)
select id, email, phone, created_at, last_sign_in_at, email_confirmed_at, user_metadata, app_metadata
from json_populate_recordset(null::auth.users, ${lit(m.tables["auth.users"])})${skip ? " on conflict do nothing" : ""};`);
}
const CHUNK = 5000;
for (const t of names) {
  const rows = m.tables[t] || [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    out.push(`insert into public.${ident(t)} select * from json_populate_recordset(null::public.${ident(t)}, ${lit(rows.slice(i, i + CHUNK))})${skip ? " on conflict do nothing" : ""};`);
  }
}
out.push("commit;");

/* التحقق بعد الالتزام */
const expect = names.map((t) => `('${ident(t)}', ${Number(m.counts[t] ?? (m.tables[t] || []).length)})`).join(",\n  ");
out.push(`do $chk$
declare r record; n bigint; bad text := '';
begin
  for r in select * from (values
  ${expect || "(null::text, 0)"}) v(t, expected) where t is not null loop
    execute format('select count(*) from public.%I', r.t) into n;
    if ${skip ? "n < r.expected" : "n <> r.expected"} then bad := bad || format('%s: %s صف بدل %s; ', r.t, n, r.expected); end if;
  end loop;
  if bad <> '' then raise exception 'عدد الصفوف لا يطابق النسخة: %', bad; end if;
  raise notice 'عدد الصفوف مطابق في كل الجداول';
end $chk$;`);
out.push(`do $fk$
declare c record; n bigint; bad text := '';
begin
  for c in
    select con.conname, con.conrelid::regclass as child, con.confrelid::regclass as parent,
      (select string_agg(format('ch.%I', a.attname), ',' order by k.i) from unnest(con.conkey) with ordinality k(n,i) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.n) as ccols,
      (select string_agg(format('ch.%I is not null', a.attname), ' and ' order by k.i) from unnest(con.conkey) with ordinality k(n,i) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.n) as nn,
      (select string_agg(format('p.%I', a.attname), ',' order by k.i) from unnest(con.confkey) with ordinality k(n,i) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.n) as pcols
    from pg_constraint con where con.contype='f' and con.connamespace='public'::regnamespace
  loop
    execute format('select count(*) from %s ch where %s and not exists (select 1 from %s p where (%s) = (%s))', c.child, c.nn, c.parent, c.pcols, c.ccols) into n;
    if n > 0 then bad := bad || format('%s (%s صف); ', c.conname, n); end if;
  end loop;
  if bad <> '' then raise warning 'صفوف تشير لصفوف غير موجودة: %', bad; else raise notice 'كل المفاتيح الخارجية سليمة'; end if;
end $fk$;`);
process.stdout.write(out.join("\n") + "\n");
console.error(`جاهز: ${names.length} جدول · ${names.reduce((s, t) => s + (m.tables[t] || []).length, 0)} صف${withAuth ? ` · ${(m.tables["auth.users"] || []).length} حساب دخول` : ""}`);
