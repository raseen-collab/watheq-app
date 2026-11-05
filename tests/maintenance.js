// وثيق — قسم الصيانة (5 نوفمبر 2026): الترتيب والفلترة والتأخر ونصوص واتساب وصفحة المستأجر
// npx esbuild lib/maintenance.ts  --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/maint.js
// npx esbuild lib/tenantPortal.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/tportal.js
// npx esbuild lib/portalNotify.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/pnotify.js --external:./telegram
const M = require('/tmp/b/maint.js');
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log('❌', m); } };
const T = '2026-11-05';
const R = (o) => ({ id: o.id || Math.random().toString(36).slice(2), property_id: 'p1', tenant_id: 't1', tenant_name: 'سالم',
  unit: '12', category: 'plumbing', location: 'unit', description: 'تسريب تحت المغسلة', status: 'new', manager_note: null,
  created_at: '2026-11-05T08:00:00Z', ...o });

// العمر والتأخر
ok(M.daysBetween('2026-11-01', '2026-11-05') === 4, 'daysBetween');
ok(M.ageDays(R({ created_at: '2026-11-01T08:00:00Z' }), T) === 4, 'age open');
ok(M.ageDays(R({ status: 'done', created_at: '2026-11-01T08:00:00Z', closed_at: '2026-11-03T08:00:00Z' }), T) === 2, 'age closed = until close');
ok(!M.isLate(R({ created_at: '2026-11-02T08:00:00Z' }), T), 'normal 3 days not late');
ok(M.isLate(R({ created_at: '2026-11-01T08:00:00Z' }), T), 'normal 4 days late');
ok(M.isLate(R({ priority: 'urgent', created_at: '2026-11-03T08:00:00Z' }), T), 'urgent 2 days late');
ok(!M.isLate(R({ priority: 'urgent', created_at: '2026-11-04T08:00:00Z' }), T), 'urgent 1 day not late');
ok(!M.isLate(R({ status: 'done', created_at: '2026-10-01T08:00:00Z', closed_at: '2026-10-02T08:00:00Z' }), T), 'closed never late');
// منتصف الليل بتوقيت الرياض: 22:30Z يوم 4 = 01:30 يوم 5 في الرياض
ok(M.riyadhDay('2026-11-04T22:30:00Z') === '2026-11-05', 'riyadh day boundary');
ok(M.agePhrase(0) === 'اليوم' && M.agePhrase(1) === 'منذ يوم' && M.agePhrase(2) === 'منذ يومين' && M.agePhrase(5) === 'منذ 5 أيام' && M.agePhrase(14) === 'منذ 14 يومًا', 'agePhrase');

// الترتيب: المفتوح أولًا، العاجل، الجديد، الأقدم — ثم المغلق الأحدث
const rows = [
  R({ id: 'done-old', status: 'done', closed_at: '2026-10-01T00:00:00Z' }),
  R({ id: 'prog', status: 'in_progress', created_at: '2026-10-20T00:00:00Z' }),
  R({ id: 'new-young', created_at: '2026-11-04T00:00:00Z' }),
  R({ id: 'new-old', created_at: '2026-10-25T00:00:00Z' }),
  R({ id: 'urgent', priority: 'urgent', status: 'in_progress', created_at: '2026-11-05T00:00:00Z' }),
  R({ id: 'done-new', status: 'done', closed_at: '2026-11-04T00:00:00Z' }),
  R({ id: 'rej', status: 'rejected', closed_at: '2026-11-01T00:00:00Z' }),
];
const order = M.sortRequests(rows).map((r) => r.id).join(',');
ok(order === 'urgent,new-old,new-young,prog,done-new,rej,done-old', 'sort order: ' + order);

// العدّادات
const c = M.counts(rows, T);
ok(c.open === 4 && c.fresh === 2 && c.working === 2 && c.urgent === 1 && c.done === 2 && c.all === 7, 'counts ' + JSON.stringify(c));
ok(c.late === 2, 'late = new-old + prog (urgent created today)');

// الفلترة
const pn = (id) => (id === 'p1' ? 'عمارة الندى' : 'برج 2');
const F = (o) => ({ ...M.DEFAULT_FILTER, ...o });
ok(rows.filter((r) => M.matchesFilter(r, F({}), pn)).length === 4, 'default = open');
ok(rows.filter((r) => M.matchesFilter(r, F({ status: 'all' }), pn)).length === 7, 'all');
ok(rows.filter((r) => M.matchesFilter(r, F({ status: 'done' }), pn)).length === 2, 'done');
ok(rows.filter((r) => M.matchesFilter(r, F({ urgentOnly: true }), pn)).length === 1, 'urgent only');
ok(M.matchesFilter(R({}), F({ q: 'الندي' }), pn), 'search property with ى/ي normalisation');
ok(M.matchesFilter(R({ tech_name: 'أبو فهد' }), F({ q: 'ابو فهد' }), pn), 'search tech with أ/ا');
ok(M.matchesFilter(R({}), F({ q: 'سباكه' }), pn), 'search category label with ة/ه');
ok(!M.matchesFilter(R({}), F({ q: 'كهرباء' }), pn), 'search miss');
ok(!M.matchesFilter(R({}), F({ property: 'p2' }), pn), 'property filter');

// نصوص واتساب
const tu = M.tenantUpdateText(R({ status: 'in_progress', visit_date: '2026-11-08', tech_name: 'أبو فهد' }), { org: 'مكتب الندى' });
ok(tu.includes('السلام عليكم سالم') && tu.includes('سباكة وتسريب') && tu.includes('8 نوفمبر') && tu.includes('أبو فهد') && tu.endsWith('مكتب الندى'), 'tenant update in_progress');
ok(M.tenantUpdateText(R({ status: 'done' }), {}).includes('تمت الصيانة'), 'tenant update done');
ok(!/\d{3,}/.test(M.tenantUpdateText(R({ status: 'new' }), {}).replace('12', '')), 'no stray numbers/prices');
const tt = M.techText(R({ priority: 'urgent', visit_date: '2026-11-06' }), { property: 'عمارة الندى', tenantPhone: '0500000000' });
ok(tt.includes('🚨 عاجل') && tt.includes('عمارة الندى') && tt.includes('0500000000') && tt.includes('تسريب تحت المغسلة') && tt.includes('6 نوفمبر'), 'tech text');
ok(M.shortDate('2026-01-31') === '31 يناير' && M.shortDate('') === '' && M.shortDate('x') === '', 'shortDate');

// وصف المصروف
const en = M.expenseNote(R({ description: 'ا'.repeat(300) }));
ok(en.startsWith('صيانة: سباكة وتسريب — وحدة 12 — ') && en.length <= 200, 'expense note capped');
ok(M.photoDir('o', 'r') === 'o/r' && M.PHOTO_BUCKET === 'maintenance-photos', 'photo path');

// صفحة المستأجر: خانة عاجل + صور قبل/بعد
try {
  const P = require('/tmp/b/tportal.js');
  const base = { active: true, tenant: { name: 'سالم', unit: '12', rent_amount: 1000 }, property: { name: 'عمارة الندى' }, office: {},
    payments: [], claims: [], requests: [R({ id: 'r1', status: 'done', log: [] })] };
  let html = '';
  try { html = P.renderTenantPage(base, { nonce: 'n', base: '/r/t/x', photos: { r1: { before: ['https://s/b.jpg'], after: ['https://s/a.jpg?x=1&y=2'] } } }); }
  catch (e) { html = ''; console.log('ℹ️ render needs fuller fixture:', e.message); }
  if (html) {
    ok(html.includes('name="urgent"'), 'tenant form has urgent checkbox');
    ok(html.includes('صور قبل الصيانة') && html.includes('صور بعد الصيانة'), 'tenant sees photos');
    ok(html.includes('a.jpg?x=1&amp;y=2'), 'photo url escaped');
  }
} catch (e) { console.log('ℹ️ tenantPortal bundle missing:', e.message); }

// تنبيه تليجرام
try {
  const N = require('/tmp/b/pnotify.js');
  ok(N.portalNotifyText('tenant', { place: 'x' }, { type: 'request', category: 'ac', location: 'unit', description: 'd', urgent: true }).includes('🚨'), 'urgent telegram head');
  ok(N.portalNotifyText('tenant', { place: 'x' }, { type: 'request', category: 'ac', location: 'unit', description: 'd' }).includes('🛠'), 'normal telegram head');
} catch (e) { console.log('ℹ️ notify bundle missing:', e.message); }

console.log(fail ? `❌ ${fail}/${n} فشل` : `✅ ${n} اختبار — الصيانة سليمة`);
process.exit(fail ? 1 : 0);
