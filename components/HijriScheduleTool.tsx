"use client";
// ============================================================
// وثيق — حاسبة جدول الدفعات الهجري (صفحة عامة بلا تسجيل)
//
// لماذا صفحة عامة لا ميزة داخل اللوحة:
// أغلب المكاتب لا تعرف أن أنظمتها تحسب عقودها الهجرية بأشهر ميلادية،
// فينزاح الاستحقاق ١١ يومًا كل سنة. الادّعاء لا يُقنع؛ لكن جدولًا يراه
// المكتب بعينه على عقده هو يُقنع في ثانيتين.
//
// وهي تُشارَك بلا مقابل: لا تسجيل، لا بريد، لا حدّ استعمال. الأداة التي
// تطلب شيئًا لا تُشارَك في مجموعة واتساب — والتي لا تطلب تُشارَك وحدها.
//
// تعمل كلها في المتصفح: لا خادم ولا قاعدة ولا تكلفة لكل زائر.
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { buildSchedule, FREQUENCIES, type Frequency } from "@/lib/contracts";
import { fromHijri, toHijri, hijriText } from "@/lib/hijri";

const AR_MONTHS = [
  "محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة",
  "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة",
];
const p2 = (n: number) => String(n).padStart(2, "0");
const sar = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-US");
const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** مدد العقد الشائعة — المكتب يفكّر بالمدة لا بعدد الدفعات */
const TERMS = [
  { months: 3, label: "٣ أشهر" }, { months: 6, label: "٦ أشهر" },
  { months: 12, label: "سنة" }, { months: 18, label: "سنة ونصف" },
  { months: 24, label: "سنتان" }, { months: 36, label: "٣ سنوات" },
];
const PER_YEAR: Record<string, number> = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };

export default function HijriScheduleTool() {
  const [cal, setCal] = useState<"h" | "g">("h");
  const [hy, setHy] = useState("1448");
  const [hm, setHm] = useState("2");
  const [hd, setHd] = useState("18");
  const [gDate, setGDate] = useState(todayISO());
  const [freq, setFreq] = useState<Frequency>("semiannual");
  const [months, setMonths] = useState(12);
  const [rent, setRent] = useState("");
  const [copied, setCopied] = useState(false);

  /** تاريخ البداية ميلاديًّا — وسبب الفشل إن فشل التحويل */
  const { startISO, hijriErr } = useMemo(() => {
    if (cal === "g") return { startISO: gDate || null, hijriErr: null as string | null };
    if (!hy || !hm || !hd) return { startISO: null, hijriErr: null };
    const iso = fromHijri(Number(hy), Number(hm), Number(hd));
    if (iso) return { startISO: iso, hijriErr: null };
    /* الأشهر الهجرية ٢٩ أو ٣٠ يومًا — واختيار ٣٠ في شهر مدته ٢٩ خطأ شائع.
       نقول له آخر يوم موجود بدل رسالة عامة. */
    let last = 0;
    for (let k = Number(hd) - 1; k >= 27; k--) if (fromHijri(Number(hy), Number(hm), k)) { last = k; break; }
    return {
      startISO: null,
      hijriErr: last
        ? `اليوم ${hd} لا يوجد في ${AR_MONTHS[Number(hm) - 1]} ${hy}هـ — آخر يوم فيه ${last}.`
        : `التاريخ ${hy}/${hm}/${hd}هـ غير موجود في التقويم.`,
    };
  }, [cal, hy, hm, hd, gDate]);

  const periods = Math.max(1, Math.round((months * (PER_YEAR[freq] ?? 12)) / 12));
  const amount = Number(rent) || 0;

  /** الجدولان: بالتقويم الهجري وبالميلادي — والفرق بينهما هو بيت القصيد */
  const rows = useMemo(() => {
    if (!startISO) return [];
    const base = { contract_start: startISO, payment_frequency: freq, rent_amount: amount || 1, contract_periods: periods, paid_periods: 0, partial_amount: 0 };
    const hij = buildSchedule({ ...base, calendar: "hijri" } as any);
    const greg = buildSchedule({ ...base, calendar: "gregorian" } as any);
    return hij.map((x: any, i: number) => {
      const g = greg[i]?.date || null;
      const drift = g ? Math.round((Date.parse(g) - Date.parse(x.date)) / 86400000) : 0;
      return { n: i + 1, hijriDate: x.date, hijriText: hijriText(x.date), gregOnly: g, drift };
    });
  }, [startISO, freq, periods, amount]);

  const endHij = rows.length ? rows[rows.length - 1] : null;
  const totalDrift = endHij ? endHij.drift : 0;

  const plain = useMemo(() => {
    if (!rows.length) return "";
    const head = `جدول دفعات العقد\nالبداية: ${rows[0].hijriText} (${rows[0].hijriDate})\nالدورة: ${FREQUENCIES.find((f) => f.value === freq)?.label} · المدة: ${months} شهرًا · ${periods} دفعة\n`;
    const body = rows.map((r) => `${r.n}. ${r.hijriText} — ${r.hijriDate}${amount ? ` — ${sar(amount)} ريال` : ""}`).join("\n");
    return `${head}\n${body}\n\nحُسب بحاسبة وثيق المجانية: app.watheqapp.com/tools/hijri`;
  }, [rows, freq, months, periods, amount]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(plain); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* */ }
  };

  return (
    <main className="min-h-screen bg-paper">
      <header className="bg-deep text-[#EAF1EE]">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl border border-goldSoft/50 grid place-items-center text-goldSoft font-display font-bold">و</span>
            <div>
              <div className="font-display font-bold text-goldSoft leading-tight">وثيق</div>
              <div className="text-[11px] opacity-75">أداة مجانية — بلا تسجيل</div>
            </div>
          </div>
          <Link href="/demo" className="bg-gold text-white rounded-lg px-3 py-1.5 text-xs font-bold">جرّب المنصة</Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="font-display font-bold text-deep text-2xl mb-1.5">جدول دفعات العقد بالتقويم الهجري</h1>
        <p className="text-sm text-muted leading-relaxed mb-5">
          أدخل بداية العقد ودورة السداد، واحصل على كل الدفعات بتاريخيها الهجري والميلادي.
          وسترى كم يومًا ينزاح جدولك لو حُسب بالأشهر الميلادية — وهو ما تفعله أكثر الأنظمة.
        </p>

        <div className="bg-white border border-line rounded-2xl p-4 mb-5 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold">تاريخ بداية العقد</label>
              <div className="inline-flex border border-line rounded-lg p-0.5 text-[11px]">
                <button type="button" onClick={() => setCal("h")} className={`px-3 py-1 rounded-md ${cal === "h" ? "bg-deep text-goldSoft" : "text-muted"}`}>هجري</button>
                <button type="button" onClick={() => setCal("g")} className={`px-3 py-1 rounded-md ${cal === "g" ? "bg-deep text-goldSoft" : "text-muted"}`}>ميلادي</button>
              </div>
            </div>
            {cal === "h" ? (
              <div className="grid grid-cols-3 gap-2">
                <select className="fld" value={hd} onChange={(e) => setHd(e.target.value)}>
                  {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select className="fld" value={hm} onChange={(e) => setHm(e.target.value)}>
                  {AR_MONTHS.map((m, i) => <option key={m} value={i + 1}>{i + 1} — {m}</option>)}
                </select>
                <input className="fld" inputMode="numeric" value={hy} onChange={(e) => setHy(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="السنة" />
              </div>
            ) : (
              <input className="fld" type="date" value={gDate} onChange={(e) => setGDate(e.target.value)} />
            )}
            {hijriErr
              ? <p className="text-[11px] text-late font-semibold mt-1.5">⚠️ {hijriErr}</p>
              : startISO && <p className="text-[11px] text-muted mt-1.5">
                  {cal === "h" ? `الموافق ${startISO} ميلادي` : `الموافق ${hijriText(startISO)}`}
                </p>}
          </div>

          <div>
            <label className="text-sm font-semibold block mb-2">دورة السداد</label>
            <div className="grid grid-cols-4 gap-2">
              {FREQUENCIES.filter((f) => PER_YEAR[f.value]).map((f) => (
                <button key={f.value} type="button" onClick={() => setFreq(f.value)}
                  className={`border-2 rounded-lg py-2 text-xs font-semibold ${freq === f.value ? "border-gold bg-[#FBF1DF]" : "border-line hover:border-goldSoft"}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold block mb-2">مدة العقد</label>
              <div className="flex flex-wrap gap-1.5">
                {TERMS.map((t) => (
                  <button key={t.months} type="button" onClick={() => setMonths(t.months)}
                    className={`text-xs px-3 py-1.5 rounded-full border ${months === t.months ? "bg-deep text-goldSoft border-deep" : "border-line text-muted hover:text-deep"}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted mt-1.5">{periods} دفعة</p>
            </div>
            <label className="block">
              <span className="text-sm font-semibold block mb-2">قيمة الدفعة <span className="text-muted font-normal">— اختياري</span></span>
              <input className="fld" inputMode="numeric" value={rent}
                onChange={(e) => setRent(e.target.value.replace(/[^\d.]/g, ""))} placeholder="مثال 25000" />
            </label>
          </div>
        </div>

        {rows.length > 0 && (
          <>
            {/* بيت القصيد: الفارق بين الحسابين — يراه بعينه على عقده هو */}
            {totalDrift !== 0 && (
              <div className="bg-[#FBE9E7] border border-[#F5C6C2] rounded-2xl p-4 mb-4">
                <div className="font-display font-bold text-[#a5322c] mb-1">
                  لو حُسب عقدك بالأشهر الميلادية، لانزاحت آخر دفعة {Math.abs(totalDrift)} يومًا
                </div>
                <p className="text-sm text-[#7a3b36] leading-relaxed">
                  السنة الهجرية ٣٥٤ يومًا والميلادية ٣٦٥. وأكثر الأنظمة تحسب العقد الهجري بأشهر ميلادية،
                  فتتأخر الاستحقاقات تدريجيًّا — ويبقى المستأجر ساكنًا بعد انتهاء عقده الحقيقي دون أن ينتبه أحد.
                </p>
              </div>
            )}

            <div className="bg-white border border-line rounded-2xl overflow-hidden mb-4">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line flex-wrap">
                <div className="text-sm">
                  <b className="text-deep">{rows.length} دفعة</b>
                  <span className="text-muted"> · من {rows[0].hijriText} إلى {endHij?.hijriText}</span>
                </div>
                <button className="btn btn-ghost text-xs" onClick={copy}>{copied ? "نُسخ ✓" : "📋 انسخ الجدول"}</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-paper text-xs text-muted">
                    <tr>
                      <th className="text-right px-4 py-2">#</th>
                      <th className="text-right px-4 py-2">التاريخ الهجري</th>
                      <th className="text-right px-4 py-2">الميلادي</th>
                      {amount > 0 && <th className="text-left px-4 py-2">المبلغ</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.n} className="border-t border-line">
                        <td className="px-4 py-2 text-muted tabular-nums">{r.n}</td>
                        <td className="px-4 py-2 font-semibold text-deep">{r.hijriText}</td>
                        <td className="px-4 py-2 tabular-nums text-muted">{r.hijriDate}</td>
                        {amount > 0 && <td className="px-4 py-2 text-left tabular-nums font-semibold">{sar(amount)}</td>}
                      </tr>
                    ))}
                    {amount > 0 && (
                      <tr className="border-t border-line bg-paper">
                        <td className="px-4 py-2" colSpan={3}><b className="text-deep">إجمالي العقد</b></td>
                        <td className="px-4 py-2 text-left tabular-nums font-bold text-deep">{sar(amount * rows.length)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-deep text-[#EAF1EE] rounded-2xl p-5 text-center">
              <div className="text-sm opacity-85 mb-1">هذا جدول عقد واحد. وفي مكتبك عشرات.</div>
              <div className="font-display font-bold text-goldSoft text-lg mb-3">
                وثيق يحسبها كلها ويذكّرك بكل دفعة قبل موعدها
              </div>
              <Link href="/demo" className="inline-block bg-gold text-white rounded-xl px-5 py-2.5 text-sm font-bold">
                جرّب المنصة — بلا تسجيل
              </Link>
            </div>
          </>
        )}

        <p className="text-[11px] text-muted text-center mt-6 leading-relaxed">
          الحساب بتقويم أم القرى. الأداة مجانية للجميع ولا تُخزَّن فيها أي بيانات —
          كل شيء يجري في متصفحك.
        </p>
      </div>
    </main>
  );
}
