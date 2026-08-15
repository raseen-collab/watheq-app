import type { MetadataRoute } from "next";

/**
 * بيان التطبيق (PWA) — يجعل وثيق قابلًا للتثبيت على الشاشة الرئيسية.
 * Next يضيف <link rel="manifest"> تلقائيًّا لوجود هذا الملف.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "وثيق — إدارة الأملاك وجمعيات الملاك",
    short_name: "وثيق",
    description:
      "رتّب عقود عقاراتك ومواعيدها في مكان واحد، وتنبيهات قبل انتهاء أي عقد، ومستندات جاهزة للطباعة.",
    // يفتح على اللوحة مباشرةً؛ الوسيط يحوّل غير المسجَّل إلى /login
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F6F1E4",
    theme_color: "#0E3A37",
    lang: "ar",
    dir: "rtl",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // maskable: خلفية ممتدة حتى الحواف ليقصّها أندرويد بأي شكل بلا قطع الحرف
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
