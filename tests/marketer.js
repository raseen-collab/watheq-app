// وثيق — المسوّق العقاري (2 نوفمبر 2026): الأدوار والباقة والسعي والتفويض والمتابعة
// npx esbuild lib/roles.ts        --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/roles.js
// npx esbuild lib/entitlements.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/ent.js
// npx esbuild lib/pricing.ts      --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/pricing.js
// npx esbuild lib/listings.ts     --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/listings.js
// npx esbuild lib/requests.ts     --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/requests.js
// npx esbuild lib/ads.ts          --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/ads.js
// npx esbuild lib/listingPublic.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/lpub.js
const R = require('/tmp/b/roles.js'), E = require('/tmp/b/ent.js'), P = require('/tmp/b/pricing.js');
const L = require('/tmp/b/listings.js'), Q = require('/tmp/b/requests.js'), A = require('/tmp/b/ads.js'), PUB = require('/tmp/b/lpub.js');
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('❌', m); } };
const t = new Date().toISOString().slice(0, 10);
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// الأدوار
ok(R.canAccess('marketer', 'property') && !R.canAccess('marketer', 'association'), 'marketer: property only');
ok(R.homePath('marketer') === '/dashboard/property/listings', 'marketer home = listings');
ok(R.homePath('landlord') === '/dashboard/property' && R.homePath('hoa_manager') === '/dashboard/association', 'others unchanged');
ok(R.homePath('both', 'association') === '/dashboard/association', 'both remembers last');
ok(R.marketerAllowed('/dashboard/property/listings') && !R.marketerAllowed('/dashboard/property') && !R.marketerAllowed('/dashboard/property/import'), 'marketer allowed paths');
ok(!R.canSwitch('marketer'), 'no switcher');
ok(R.ACCOUNT_TYPES.some((a) => a.value === 'marketer'), 'onboarding card exists');

// الباقة
ok(P.subPrice('marketer', null, 12) === 399, 'marketer yearly 399');
ok(P.subPrice('marketer', null, 1) === null, 'marketer no monthly');
ok(P.subPrice('marketer', 'basic', 12) === null, 'marketer + hoa invalid');
ok(P.subPrice('full', null, 12) === 1990 && P.subPrice('basic', null, 1) === 99, 'old prices unchanged');
const paidM = { account_type: 'marketer', plan: 'marketer', subscribed_until: plus(300) };
ok(E.productState(paidM, 'property') === 'paid', 'marketer plan reads paid');
ok(E.limitsFor(paidM, 'property').maxProperties === 0 && E.limitsFor(paidM, 'property').advisorDaily === 0, 'marketer limits: no properties, no advisor');
ok(E.advisorDailyFor({ account_type: 'marketer', trial_ends_at: plus(10) }) === 0, 'marketer trial: advisor 0');
ok(E.productsOf('marketer').join() === 'property', 'marketer products');
ok(E.allExpired({ account_type: 'marketer', plan: 'marketer', subscribed_until: plus(-10) }) === true, 'expired after grace');
ok(E.allExpired({ account_type: 'marketer', plan: 'marketer', subscribed_until: plus(-3) }) === false, 'grace 5 days');

// السعي والتفويض
const base = { id: 'x', code: 'ش-1', kind: 'apartment', offer_type: 'sale', price: 500000, status: 'available', last_confirmed_at: t };
ok(L.commissionLine(base) === null, 'no commission line without pct');
ok(L.commissionLine({ ...base, commission_pct: 2.5 }) === 'السعي 2.5% · ≈ 12,500 ريال', 'commission 2.5% full: ' + L.commissionLine({ ...base, commission_pct: 2.5 }));
ok(L.commissionLine({ ...base, commission_pct: 2.5, my_share_pct: 50 }) === 'السعي 2.5% · نصيبك 50% · ≈ 6,250 ريال', 'commission split: ' + L.commissionLine({ ...base, commission_pct: 2.5, my_share_pct: 50 }));
ok(L.commissionLine({ ...base, price: null, commission_pct: 2.5 }) === 'السعي 2.5%', 'no price → no amount');
ok(L.authorizationWarning(base, false) === null && L.authorizationWarning(base, true) === 'unknown', 'unknown warns marketer only');
ok(L.authorizationWarning({ ...base, owner_authorized: false }, false) === 'missing', 'missing warns everyone');
ok(L.authorizationWarning({ ...base, owner_authorized: true }, true) === null, 'authorized → no warning');
ok(L.authorizationWarning({ ...base, status: 'withdrawn' }, true) === null, 'closed listing → no warning');

// المتابعة
const req = { id: 'r', kind: 'apartment', offer_type: 'rent', status: 'active' };
ok(Q.followUpOf(req).kind === 'none', 'no dates → none');
ok(Q.followUpOf({ ...req, follow_up_at: t }).kind === 'due', 'today due');
ok(Q.followUpOf({ ...req, follow_up_at: plus(-2) }).kind === 'overdue' && Q.followUpOf({ ...req, follow_up_at: plus(-2) }).days === 2, 'overdue 2');
ok(Q.followUpOf({ ...req, follow_up_at: plus(3) }).kind === 'scheduled', 'scheduled');
ok(Q.followUpOf({ ...req, last_contact_at: plus(-8) }).kind === 'due', '8 days since contact → due');
ok(Q.followUpOf({ ...req, last_contact_at: plus(-3) }).kind === 'none', '3 days → fine');
ok(Q.followUpOf({ ...req, status: 'closed', follow_up_at: plus(-5) }).kind === 'none', 'closed → none');
ok(Q.needsFollowUp({ ...req, follow_up_at: t }) && !Q.needsFollowUp(req), 'needsFollowUp');

// الإعلان بلا ترخيص (تجاوز بإقرار): لا undefined ولا سطر فارغ في الذيل
const office = { org_name: 'مكتب', billing_phone: '0500000000', fal_license: '', ad_license: '' };
const h = A.harajAd({ ...base, district: 'النرجس', area: 120 }, office);
ok(!/undefined/.test(h.body) && !/\n$/.test(h.body) && !/ترخيص/.test(h.body), 'haraj without license clean');
const w = A.whatsappAd(base, office);
ok(!/undefined/.test(w) && !/\n$/.test(w), 'whatsapp without license clean');
const x = A.xAd(base, office);
ok(!/undefined/.test(x) && x.length <= 280, 'x without license clean');
const h2 = A.harajAd(base, { ...office, fal_license: '1200012345', ad_license: '7100012345' });
ok(/ترخيص الإعلان: 7100012345 · رخصة فال: 1200012345/.test(h2.body), 'both licenses line');
ok(/رخصة فال: 1200012345/.test(A.harajAd(base, { ...office, fal_license: '1200012345' }).body) && !/ترخيص الإعلان/.test(A.harajAd(base, { ...office, fal_license: '1200012345' }).body), 'fal only');

// صفحة الزبون: لا بيانات مالك، تهريب HTML، الحالة المغلقة
const pub = { open: true, status: 'available', code: 'ش-1', kind: 'apartment', offer_type: 'sale', title: '<b>تشطيب</b>', district: 'النرجس', city: 'الرياض', price: 500000, area: 120, rooms: 3, owner_id: 'u', listing_id: 'l', office: { name: 'أبو خالد', phone: '0550000000' } };
const html = PUB.renderListingPage(pub, ['https://x.supabase.co/a.jpg', 'https://x.supabase.co/b.jpg'], { nonce: 'abc' });
ok(!/<b>تشطيب<\/b>/.test(html) && /&lt;b&gt;تشطيب/.test(html), 'title escaped');
ok(/wa\.me\/966550000000/.test(html) && /tel:\+966550000000/.test(html), 'marketer phone normalized: ' + (html.match(/wa\.me\/\d+/) || [''])[0]);
ok(/500,000 ريال/.test(html) && /120 م²/.test(html) && /الغرف/.test(html), 'specs + price');
ok(/nonce="abc"/.test(html) && !/owner_phone|المالك/.test(html), 'nonce present, no owner words');
const closed = PUB.renderClosedPage({ ...pub, open: false, status: 'contracted' }, { nonce: 'n' });
ok(/لم يعد متاحًا/.test(closed) && !/500,000/.test(closed) && !/النرجس/.test(closed), 'closed page hides details');
ok(PUB.LISTING_TOKEN_RE.test('a'.repeat(48)) && !PUB.LISTING_TOKEN_RE.test('a'.repeat(47)) && !PUB.LISTING_TOKEN_RE.test('A'.repeat(48)), 'token regex');
ok(PUB.waDigits('05 5016 5210') === '966550165210' && PUB.waDigits('+966550165210') === '966550165210' && PUB.waDigits('') === '', 'waDigits');

console.log(fail ? `❌ ${fail} failures` : '✅ marketer tests passed');
process.exit(fail ? 1 : 0);
