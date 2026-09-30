/**
 * وثيق — تنظيف HTML مستندات اتحاد الملاك (محاضر، إشعارات، تعاميم).
 *
 * المستند يكتبه المكتب ويُعرض على صفحة المالك العامة، فيُنظَّف مرتين:
 * عند الإصدار (app/api/hoa/documents) وعند العرض (app/r/o/.../d/...).
 * قائمة سماح صارمة: وسوم تنسيق أساسية فقط، ولا سمات إلا dir/colspan/rowspan.
 * لا سكربت، لا معالجات أحداث، لا style ولا روابط ولا صور — ولا شيء يحمل عنوانًا.
 * والوسوم تُوازَن (كل مفتوح يُغلق) كي لا يبتلع المستند بقية الصفحة.
 * بلا مكتبات: يعمل في الخادم والمتصفح.
 */

const ALLOWED = new Set([
  "p", "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td",
  "ul", "ol", "li", "b", "strong", "i", "em", "u", "br", "span", "div",
]);
const VOID = new Set(["br"]);
/** عناصر يُحذف محتواها كاملًا لا وسمها فقط */
const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "noscript", "template", "textarea",
  "title", "svg", "math", "xmp", "plaintext", "noembed", "noframes", "select", "button", "head"];

export const HOA_BODY_MAX = 200_000;

const ENTITY_RE = /^&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/;

/** يهرّب النص مع إبقاء الكيانات السليمة (&amp; &#1234;) كما هي */
function escText(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<") out += "&lt;";
    else if (c === ">") out += "&gt;";
    else if (c === '"') out += "&quot;";
    else if (c === "&") {
      const m = ENTITY_RE.exec(s.slice(i, i + 40));
      if (m) { out += m[0]; i += m[0].length - 1; } else out += "&amp;";
    } else out += c;
  }
  return out;
}

function cleanAttrs(tag: string, raw: string): string {
  const out: string[] = [];
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    const val = (m[2] ?? m[3] ?? m[4] ?? "").trim().toLowerCase();
    if (seen.has(name)) continue;
    if (name === "dir" && /^(rtl|ltr|auto)$/.test(val)) { out.push(`dir="${val}"`); seen.add(name); }
    else if ((name === "colspan" || name === "rowspan") && (tag === "td" || tag === "th") && /^[1-9]\d?$/.test(val)) {
      out.push(`${name}="${val}"`); seen.add(name);
    }
  }
  return out.length ? " " + out.join(" ") : "";
}

export function sanitizeHoaHtml(input: unknown): string {
  let s = String(input ?? "");
  if (s.length > HOA_BODY_MAX * 2) s = s.slice(0, HOA_BODY_MAX * 2);
  s = s.replace(/\u0000/g, "");
  // تعليقات و CDATA و doctype وتعليمات المعالجة
  s = s.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g, "")
       .replace(/<![^>]*>?/g, "").replace(/<\?[^>]*>?/g, "");
  // العناصر الخطرة بمحتواها. غير المُغلق منها يُسقط كل ما بعده.
  for (const t of DROP_WITH_CONTENT) {
    const block = new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?<\\/${t}\\s*>`, "gi");
    let prev: string;
    do { prev = s; s = s.replace(block, ""); } while (s !== prev);
    const open = new RegExp(`<${t}\\b`, "i").exec(s);
    if (open) s = s.slice(0, open.index);
    s = s.replace(new RegExp(`<\\/${t}\\s*>`, "gi"), "");
  }

  const stack: string[] = [];
  let out = "";
  let i = 0;
  /* لاصق (y) بدل قصّ النص في كل لفّة، ومسح الخصائص يتوقف عند «<» وبحدّ أقصى —
     كان مدخل مثل "<a" مكرّرًا يستهلك عشرات الثواني */
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^<>"']|"[^"<]*"|'[^'<]*'){0,2000})>/y;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) { out += escText(s.slice(i)); break; }
    out += escText(s.slice(i, lt));
    tagRe.lastIndex = lt;
    const m = tagRe.exec(s);
    if (!m) { out += "&lt;"; i = lt + 1; continue; }
    i = lt + m[0].length;
    const closing = m[1] === "/";
    let tag = m[2].toLowerCase();
    if (tag === "h5" || tag === "h6") tag = "h4";
    if (!ALLOWED.has(tag)) continue;                       // الوسم يسقط ويبقى نصه
    if (VOID.has(tag)) { if (!closing) out += "<br>"; continue; }
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at < 0) continue;                                // إغلاق بلا فتح: يُتجاهل
      while (stack.length > at) out += `</${stack.pop()}>`;
      continue;
    }
    if (stack.length >= 40) continue;                      // تداخل مفرط
    stack.push(tag);
    out += `<${tag}${cleanAttrs(tag, m[3] || "")}>`;
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

/** نص عادي (من مربع نص) → فقرات HTML مهرّبة */
export function plainTextToHoaHtml(text: string): string {
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return String(text || "").replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n");
}
