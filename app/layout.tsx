import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import "./globals.css";

export const metadata: Metadata = {
  title: "وثيق — لوحة التحكم",
  description: "منصة وثيق لإدارة جمعيات الملاك والأملاك",
};

/**
 * رابط لوحة الإدارة — يظهر لأصحاب المعرّفات في ADMIN_USER_IDS فقط.
 *
 * التحقّق يتمّ على السيرفر بالكامل: من ليس مصرّحًا له لا يصله الرابط
 * في صفحة HTML أصلًا، فلا يمكن اكتشافه من المتصفّح.
 * وأي خطأ هنا يُبتلع بصمت حتى لا يتعطّل التطبيق كلّه.
 */
async function AdminLink() {
  try {
    const allowed = (process.env.ADMIN_USER_IDS || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.length) return null;

    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id;
    if (!uid || !allowed.includes(uid)) return null;

    return (
      <Link
        href="/admin"
        title="لوحة الإدارة"
        style={{
          position: "fixed", bottom: "18px", insetInlineStart: "18px", zIndex: 40,
          display: "inline-flex", alignItems: "center", gap: "7px",
          background: "#0E3A37", color: "#E7C877",
          border: "1px solid rgba(231,200,119,.35)", borderRadius: "999px",
          padding: "8px 14px", fontSize: ".78rem", fontWeight: 600,
          textDecoration: "none", boxShadow: "0 6px 18px -8px rgba(0,0,0,.5)",
        }}
      >
        ◆ الإدارة
      </Link>
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
        {/* @ts-expect-error — مكوّن سيرفر غير متزامن داخل التخطيط */}
        <AdminLink />
      </body>
    </html>
  );
}
