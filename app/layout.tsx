import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import "./globals.css";

export const metadata: Metadata = {
  title: "وثيق — لوحة التحكم",
  description: "منصة وثيق لإدارة جمعيات الملاك والأملاك",
};

const pill: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "7px",
  borderRadius: "999px", padding: "9px 15px",
  fontSize: ".78rem", fontWeight: 600, textDecoration: "none",
  boxShadow: "0 6px 18px -8px rgba(0,0,0,.5)", whiteSpace: "nowrap",
};

/**
 * أزرار عائمة:
 *  • المستشار — لكل مستخدم مسجّل دخوله
 *  • الإدارة  — لأصحاب المعرّفات في ADMIN_USER_IDS فقط
 *
 * التحقّق كلّه على السيرفر: غير المصرّح له لا يصله رابط الإدارة في صفحة HTML
 * أصلًا، فلا يمكن اكتشافه من المتصفّح. وأي خطأ يُبتلع بصمت حتى لا يتعطّل التطبيق.
 */
async function FloatingLinks() {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id;
    if (!uid) return null;

    const allowed = (process.env.ADMIN_USER_IDS || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const isAdmin = allowed.length > 0 && allowed.includes(uid);

    return (
      <div style={{
        position: "fixed", bottom: "18px", insetInlineStart: "18px", zIndex: 40,
        display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start",
      }}>
        {isAdmin && (
          <Link href="/admin" title="لوحة الإدارة"
            style={{ ...pill, background: "#0E3A37", color: "#E7C877", border: "1px solid rgba(231,200,119,.35)" }}>
            ◆ الإدارة
          </Link>
        )}
        <Link href="/dashboard/advisor" title="المستشار الذكي — إجابات استرشادية"
          style={{ ...pill, background: "#B8791F", color: "#fff", border: "1px solid rgba(255,255,255,.2)" }}>
          💬 المستشار
        </Link>
      </div>
    );
  } catch {
    return null;
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Readex+Pro:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <FloatingLinks />
      </body>
    </html>
  );
}
