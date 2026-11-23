// ============================================================
// وثيق — تقرير الدعم الأسبوعي (23 نوفمبر 2026)
//
// كل أحد صباحًا على تليجرام صاحب المنصة: ما الذي سأل عنه المستخدمون ولم يجدوا جوابه،
// والأجوبة التي قالوا «ما أفادت»، والبلاغات المفتوحة. منها نعرف ما نصلحه وما نشرحه.
// دالة صافية: تأخذ الصفوف وتبني النص — الجلب في المسار.
// ============================================================
export type HQ = { question: string; answered: boolean; via?: string | null; matched_id?: string | null; created_at: string };
export type FB = { question: string; helpful: boolean; matched_id?: string | null; created_at: string };
export type PR = { message: string; status: string | null; path?: string | null; created_at: string };

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const norm = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[؟?!.،,]+$/g, "");

/** أسئلة فريدة (بلا تكرار نفس النص) مع عدد مرات ورودها، الأكثر أولًا */
export function uniqueQuestions(rows: { question: string }[], max = 10): { q: string; n: number }[] {
  const m = new Map<string, { q: string; n: number }>();
  for (const r of rows) {
    const k = norm(r.question).toLowerCase();
    if (!k) continue;
    const cur = m.get(k);
    if (cur) cur.n++; else m.set(k, { q: norm(r.question), n: 1 });
  }
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, max);
}

export function supportWeeklyText(input: { hq: HQ[]; fb: FB[]; reports: PR[]; openReports: PR[]; advisorCount: number; from: string; to: string }): string {
  const { hq, fb, reports, openReports } = input;
  const unanswered = hq.filter((r) => !r.answered);
  const ai = hq.filter((r) => r.via === "ai");
  const aiHit = ai.filter((r) => r.answered).length;
  const down = fb.filter((r) => !r.helpful), up = fb.filter((r) => r.helpful);
  const L: string[] = [];
  L.push(`🧭 <b>تقرير الدعم الأسبوعي</b> — ${esc(input.from)} إلى ${esc(input.to)}`);
  L.push("");
  L.push(`💬 أسئلة المساعد: <b>${hq.length}</b> — وجد جوابًا ${hq.length - unanswered.length} · بلا جواب ${unanswered.length}`);
  if (ai.length) L.push(`🤖 منها بالمطابقة الذكية: ${ai.length} (وجد ${aiHit})`);
  if (fb.length) L.push(`👍 ${up.length} · 👎 ${down.length}`);
  if (input.advisorCount) L.push(`⚖️ أسئلة المستشار: ${input.advisorCount}`);

  const uq = uniqueQuestions(unanswered, 10);
  if (uq.length) {
    L.push("", "<b>❓ سألوا ولم يجدوا جوابًا</b> (أضفها لقاعدة المساعد أو حسّن الميزة):");
    for (const x of uq) L.push(`• ${esc(clip(x.q, 120))}${x.n > 1 ? ` (×${x.n})` : ""}`);
  }
  if (down.length) {
    L.push("", "<b>👎 جواب ما أفاد</b> (راجع نص الجواب):");
    for (const x of uniqueQuestions(down, 8)) {
      const id = down.find((d) => norm(d.question).toLowerCase() === x.q.toLowerCase())?.matched_id;
      L.push(`• ${esc(clip(x.q, 100))}${id ? ` ← ${esc(id)}` : ""}`);
    }
  }
  L.push("", `🐞 بلاغات المشاكل هذا الأسبوع: <b>${reports.length}</b> · مفتوحة الآن: <b>${openReports.length}</b>`);
  for (const r of openReports.slice(0, 8)) L.push(`• ${esc(clip(r.message, 110))}${r.path ? ` — <code>${esc(r.path)}</code>` : ""}`);
  if (!hq.length && !reports.length && !openReports.length) L.push("", "أسبوع هادئ: لا أسئلة ولا بلاغات.");
  else if (openReports.length) L.push("", "للحل: app.watheqapp.com/admin/reports");
  return L.join("\n");
}
