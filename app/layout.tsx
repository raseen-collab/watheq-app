import type { Metadata, Viewport } from "next";
import PWARegister from "@/components/PWARegister";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import "./globals.css";

export const metadata: Metadata = {
  title: "وثيق — لوحة التحكم",
  description: "منصة وثيق لإدارة جمعيات الملاك والأملاك",
  applicationName: "وثيق",
  // شاشة كاملة بلا شريط عنوان المتصفح عند التثبيت على آيفون
  appleWebApp: { capable: true, title: "وثيق", statusBarStyle: "default" },
  // النسخة الحديثة من الوسم؛ apple-mobile-web-app-capable وحدها صارت مهجورة
  other: { "mobile-web-app-capable": "yes" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

/** لون شريط النظام في الوضع المثبَّت */
export const viewport: Viewport = {
  themeColor: "#0E3A37",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const pill: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "7px",
  borderRadius: "999px", padding: "9px 15px",
  fontSize: ".78rem", fontWeight: 600, textDecoration: "none",
  boxShadow: "0 6px 18px -8px rgba(0,0,0,.5)", whiteSpace: "nowrap",
};

/** يطبّق الوضع قبل رسم الصفحة — يمنع وميض الأبيض عند التحميل */
const THEME_INIT = `(function(){try{
var t=localStorage.getItem("watheq_theme");
if(!t)t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
if(t==="dark")document.documentElement.setAttribute("data-theme","dark");
}catch(e){}})();`;

const THEME_TOGGLE = `(function(){
var K="watheq_theme";
function dark(){return document.documentElement.getAttribute("data-theme")==="dark";}
function paint(){document.querySelectorAll("[data-wq-theme]").forEach(function(b){
  b.textContent=dark()?"\\u2600 نهاري":"\\u263E ليلي";
  b.setAttribute("aria-label",dark()?"التبديل للوضع النهاري":"التبديل للوضع الليلي");});}
document.addEventListener("click",function(e){
  var b=e.target.closest&&e.target.closest("[data-wq-theme]");
  if(!b)return; e.preventDefault();
  var d=dark();
  if(d)document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme","dark");
  try{localStorage.setItem(K,d?"light":"dark");}catch(err){}
  paint();});
paint();
})();`;

/**
 * أزرار عائمة:
 *  • الوضع الليلي — لكل زائر
 *  • المستشار     — لكل مستخدم مسجّل دخوله
 *  • الإدارة      — لأصحاب المعرّفات في ADMIN_USER_IDS فقط
 *
 * التحقّق من الإدارة يتمّ على السيرفر: غير المصرّح له لا يصله الرابط
 * في صفحة HTML أصلًا. وأي خطأ يُبتلع بصمت حتى لا يتعطّل التطبيق.
 */
async function FloatingLinks() {
  let uid: string | null = null;
  let isAdmin = false;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    uid = data?.user?.id ?? null;
    const allowed = (process.env.ADMIN_USER_IDS || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    isAdmin = !!uid && allowed.length > 0 && allowed.includes(uid);
  } catch {
    /* تجاهل */
  }

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
      {uid && (
        <Link href="/dashboard/advisor" title="المستشار الذكي — إجابات استرشادية"
          style={{ ...pill, background: "#B8791F", color: "#fff", border: "1px solid rgba(255,255,255,.2)" }}>
          💬 المستشار
        </Link>
      )}
      <button type="button" className="wq-theme-btn" data-wq-theme aria-label="التبديل للوضع الليلي">
        ☾ ليلي
      </button>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Readex+Pro:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <PWARegister />
        {children}
        <FloatingLinks />
        <script dangerouslySetInnerHTML={{ __html: THEME_TOGGLE }} />
      </body>
    </html>
  );
}
