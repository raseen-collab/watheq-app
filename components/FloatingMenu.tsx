"use client";
// ============================================================
// وثيق — زرّ عائم واحد
//
// كانت خمسة أزرار عائمة دائمة: الإدارة · المستشار · الوضع الليلي ·
// الفريق · مساعدة. وقياس المراجعة رصدها تغطّي عنوان «سجل العقار»،
// وأسماء الأشهر في رسم التحصيل، وآخر سطر في صفحة الرفع، وأول صف من
// الجدول — أي أنها تُخفي المحتوى الذي جاء المكتب لأجله.
//
// واحدٌ يفتح قائمة: يشغل زاوية واحدة، وما فيها ليس فعلًا يوميًّا.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon, { type IconName } from "@/components/Icon";

type Item = { label: string; icon: IconName; href?: string; run?: () => void };

export default function FloatingMenu({ isAdmin, signedIn }: { isAdmin: boolean; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [unread, setUnread] = useState(0);

  /* عدّاد رسائل الفريق يصل من OfficeChat — فالبند يحمل الرقم كما كان
     يحمله الزرّ القديم. */
  useEffect(() => {
    const h = (e: any) => setUnread(Number(e.detail?.unread) || 0);
    window.addEventListener("watheq:unread", h);
    return () => window.removeEventListener("watheq:unread", h);
  }, []);

  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [open]);

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", "dark");
    try { localStorage.setItem("watheq_theme", isDark ? "light" : "dark"); } catch { /* */ }
    setDark(!isDark);
    setOpen(false);
  }

  const items: Item[] = [
    /* «الفريق» كان زرًّا عائمًا مستقلًّا في الزاوية نفسها فيتزاحم مع هذا
       ويغطّي أحدهما الآخر — صار بندًا هنا يفتح المحادثة بالحدث نفسه. */
    ...(signedIn ? [{
      label: unread > 0 ? `الفريق (${unread})` : "الفريق",
      icon: "owner" as IconName,
      run: () => { window.dispatchEvent(new CustomEvent("watheq:chat")); setOpen(false); },
    }] : []),
    ...(signedIn ? [{ label: "المستشار الذكي", icon: "chart" as IconName, href: "/dashboard/advisor" }] : []),
    { label: dark ? "الوضع النهاري" : "الوضع الليلي", icon: dark ? "check" : "shield", run: toggleTheme },
    ...(isAdmin ? [{ label: "لوحة الإدارة", icon: "settings" as IconName, href: "/admin" }] : []),
  ];

  return (
    <div className="wq-fab">
      {open && (
        <>
          <div className="fixed inset-0 z-[39]" onClick={() => setOpen(false)} />
          {/* كانت تُفتح ضيّقة بلون داكن جدًّا فتبدو كتلة سوداء لا قائمة.
              سطح البطاقة نفسه بحدوده، وعرض يتّسع للنص، وظلّ يفصلها عمّا تحتها. */}
          <div className="wq-fab-menu absolute bottom-full mb-3 end-0 z-40 w-[230px] bg-white border border-line rounded-2xl shadow-2xl py-1.5 overflow-hidden">
            {items.map((it, i) => it.href ? (
              <Link key={i} href={it.href} onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-3 text-sm font-semibold text-deep hover:bg-paper2 transition">
                <Icon name={it.icon} /> {it.label}
              </Link>
            ) : (
              <button key={i} type="button" onClick={it.run}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-sm font-semibold text-deep hover:bg-paper2 transition">
                <Icon name={it.icon} /> {it.label}
              </button>
            ))}
          </div>
        </>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-label="أدوات" aria-expanded={open}
        className="bg-deep text-goldSoft rounded-full shadow-lg border border-goldSoft/30 w-12 h-12 grid place-items-center">
        <Icon name={open ? "close" : "settings"} size={20} />
      </button>
    </div>
  );
}
