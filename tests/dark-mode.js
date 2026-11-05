// وثيق — حارس الوضع الليلي (5 نوفمبر 2026)
// كل لون ثابت فاتح (خلفية/حد) أو داكن (نص) في الواجهة يحتاج مقابلًا ليليًّا في app/globals.css،
// وإلا يبقى فاتحًا فوق الخلفية الداكنة. شغّله قبل الرفع: node tests/dark-mode.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');
const have = new Set([...css.matchAll(/\[class\*="((?:bg|text|border)-\[#[0-9A-Fa-f]{3,6}\])"\]/g)].map((m) => m[1]));
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, f.name);
  if (f.isDirectory()) { if (!/node_modules|\.next|zz-/.test(p)) walk(p); }
  else if (/\.tsx$/.test(f.name)) files.push(p);
} };
walk(path.join(root, 'components')); walk(path.join(root, 'app')); files.push(path.join(root, 'lib/maintenance.ts'));
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
const lum = (rgb) => { const c = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const miss = new Map();
for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?<![\w-])((bg|text|border)-\[(#[0-9A-Fa-f]{3,6})\])/g)) {
  const [cls, , kind, col] = m; const L = lum(hex(col));
  const needs = kind === 'text' ? L <= 0.5 : L >= 0.6;
  if (needs && !have.has(cls)) miss.set(cls, path.relative(root, f));
}
if (miss.size) { for (const [c, f] of miss) console.log('❌ بلا مقابل ليلي:', c, '—', f); console.log(`❌ ${miss.size} لونًا`); process.exit(1); }
console.log(`✅ كل الألوان الثابتة لها مقابل ليلي (${files.length} ملف)`);
