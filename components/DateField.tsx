"use client";
// ============================================================
// وثيق — حقل تاريخ يقبل الهجري والميلادي
//
// المكتب السعودي يكتب عقوده بالهجري ويتعامل مع البنوك بالميلادي. بدل
// إجباره على تقويم واحد، الحقل يعرض مبدّلًا: يدخل بما يناسبه، ونخزّن
// ميلاديًّا دائمًا (كل حسابات العقود عليه) ونعرض المقابل تحته ليتأكد.
//
// الاختيار يُحفظ في المتصفح، فمن يعمل بالهجري يجده مفتوحًا في كل حقل
// وفي كل مرة — لا يبدّل عشرين مرة في اليوم.
// ============================================================

import { useEffect, useState } from "react";
import { fromHijri, toHijri, hijriText } from "@/lib/hijri";

const PREF = "watheq.cal";
const MONTHS = [
  "محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة",
  "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة",
];

export default function DateField({ value, onChange, id }: {
  value: string;                       // ميلادي ISO أو ""
  onChange: (iso: string) => void;
  id?: string;
}) {
  const [cal, setCal] = useState<"g" | "h">("g");
  const [hy, setHy] = useState("");
  const [hm, setHm] = useState("");
  const [hd, setHd] = useState("");

  // التفضيل المحفوظ — يُقرأ بعد التركيب حتى لا يختلف الخادم عن المتصفح
  useEffect(() => {
    try { const p = localStorage.getItem(PREF); if (p === "h" || p === "g") setCal(p); } catch { /* */ }
  }, []);

  // عند فتح الوضع الهجري: املأ الخانات من القيمة الميلادية الحالية
  useEffect(() => {
    if (cal !== "h") return;
    const h = value ? toHijri(value) : null;
    setHy(h ? String(h.y) : ""); setHm(h ? String(h.m) : ""); setHd(h ? String(h.d) : "");
  }, [cal, value]);

  function pick(next: "g" | "h") {
    setCal(next);
    try { localStorage.setItem(PREF, next); } catch { /* */ }
  }

  function pushHijri(y: string, m: string, d: string) {
    setHy(y); setHm(m); setHd(d);
    const iso = fromHijri(Number(y), Number(m), Number(d));
    if (iso) onChange(iso);
    else if (y && m && d) onChange("");   // تاريخ غير موجود في التقويم
  }

  return (
    <div>
      <div className="flex items-center gap-1 mb-1.5">
        <button type="button" onClick={() => pick("g")}
          className={`text-[11px] px-2 py-0.5 rounded-full border ${cal === "g" ? "bg-deep text-goldSoft border-deep" : "bg-white border-line text-muted"}`}>
          ميلادي
        </button>
        <button type="button" onClick={() => pick("h")}
          className={`text-[11px] px-2 py-0.5 rounded-full border ${cal === "h" ? "bg-deep text-goldSoft border-deep" : "bg-white border-line text-muted"}`}>
          هجري
        </button>
      </div>

      {cal === "g" ? (
        <input id={id} className="fld" type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <input className="fld" inputMode="numeric" placeholder="اليوم" value={hd}
            onChange={(e) => pushHijri(hy, hm, e.target.value.replace(/\D/g, "").slice(0, 2))} />
          <select className="fld" value={hm} onChange={(e) => pushHijri(hy, e.target.value, hd)}>
            <option value="">الشهر</option>
            {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
          <input className="fld" inputMode="numeric" placeholder="السنة" value={hy}
            onChange={(e) => pushHijri(e.target.value.replace(/\D/g, "").slice(0, 4), hm, hd)} />
        </div>
      )}

      {/* المقابل في التقويم الآخر — يرى المستخدم ما سيُحفظ قبل أن يحفظ */}
      <p className="text-[11px] text-muted mt-1">
        {value
          ? (cal === "g" ? `الموافق ${hijriText(value)}` : `الموافق ${value} ميلادي`)
          : (cal === "h" && (hd || hm || hy) ? "أكمل اليوم والشهر والسنة" : "—")}
      </p>
    </div>
  );
}
