// وثيق — بحث الزبون في المعروضات والمطابقة بالغرف (29 أكتوبر 2026)
// npx esbuild lib/listings.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/listings.js
// npx esbuild lib/requests.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/requests.js
const L = { ...require('/tmp/b/listings.js'), matches: require('/tmp/b/requests.js').matches };
const t = new Date().toISOString().slice(0,10);
const mk = (o) => ({ id: o.code, status: 'available', last_confirmed_at: t, ...o });
const items = [
  mk({ code:'ش-101', kind:'apartment', offer_type:'rent', district:'النرجس', city:'الرياض', price:40000, area:140, rooms:3, created_at:'2026-10-01' }),
  mk({ code:'ش-102', kind:'apartment', offer_type:'rent', district:'الياسمين', price:35000, area:110, rooms:2, created_at:'2026-10-05' }),
  mk({ code:'ش-103', kind:'apartment', offer_type:'rent', district:'النرجس', price:0, rooms:null, created_at:'2026-10-10' }),   // بلا سعر ولا غرف
  mk({ code:'ش-104', kind:'apartment', offer_type:'sale', district:'النرجس', price:900000, rooms:4 }),
  mk({ code:'أ-101', kind:'land', offer_type:'sale', district:'الرمال', price:1200000, area:600 }),
  mk({ code:'ف-101', kind:'villa', offer_type:'rent', district:'حطين', price:120000, rooms:5, status:'contracted' }),
];
let fail=0; const ok=(c,m)=>{ if(!c){fail++; console.log('❌',m);} };
const codes = (q) => L.filterListings(items, q).map(x=>x.code).sort().join(',');
// الحالة الافتراضية: المفتوحة فقط (الفيلا متعاقدة)
ok(!codes({}).includes('ف-101'), 'contracted hidden by default');
// شقة للإيجار 3+ غرف: 101 (3) + 103 (مجهول) — لا 102 (2)
ok(codes({kind:'apartment', offer:'rent', roomsMin:3}) === 'ش-101,ش-103', 'rooms 3+ rent: '+codes({kind:'apartment', offer:'rent', roomsMin:3}));
// أقصى سعر 38,000: 102 + 103(بلا سعر) — لا 101
ok(codes({kind:'apartment', offer:'rent', priceMax:38000}) === 'ش-102,ش-103', 'priceMax: '+codes({kind:'apartment', offer:'rent', priceMax:38000}));
// شرط الغرف يُقصي الأرض
ok(!codes({roomsMin:1}).includes('أ-101'), 'land excluded with rooms filter');
// البحث العربي بلا «ال» وبهمزات: «نرجس» يجد النرجس
ok(codes({q:'نرجس'}) === 'ش-101,ش-103,ش-104', 'arabic search: '+codes({q:'نرجس'}));
ok(codes({q:'الياسمين'}) === 'ش-102', 'search with al');
// الكل يُظهر المتعاقد
ok(codes({status:'all'}).includes('ف-101'), 'all shows contracted');
// الترتيب: السعر الأقل — بلا سعر في الآخر
const asc = L.sortListingsBy(L.filterListings(items,{kind:'apartment'}),'price_asc').map(x=>x.code);
ok(asc[asc.length-1]==='ش-103' && asc[0]==='ش-102', 'price_asc puts unpriced last: '+asc);
const desc = L.sortListingsBy(L.filterListings(items,{kind:'apartment'}),'price_desc').map(x=>x.code);
ok(desc[0]==='ش-104' && desc[desc.length-1]==='ش-103', 'price_desc: '+desc);
const newest = L.sortListingsBy(L.filterListings(items,{kind:'apartment', offer:'rent'}),'newest').map(x=>x.code);
ok(newest[0]==='ش-103', 'newest: '+newest);
ok(L.hasSeekerCriteria({q:'نرجس'})===false && L.hasSeekerCriteria({roomsMin:3})===true, 'hasSeekerCriteria');
// المطابقة بالغرف
const req = { id:'r', kind:'apartment', offer_type:'rent', rooms_min:3, status:'active' };
ok(L.matches(items[0], req) === true, '3 rooms matches 3+');
ok(L.matches(items[1], req) === false, '2 rooms rejected for 3+');
ok(L.matches(items[2], req) === true, 'unknown rooms not excluded');
ok(L.matches(items[1], { ...req, rooms_min:null }) === true, 'no rooms_min = any');
// لم يتغير شيء لطلب بلا غرف قديم
ok(L.matches(items[1], { id:'x', kind:'apartment', offer_type:'rent', status:'active' }) === true, 'legacy request unaffected');
console.log(fail ? `❌ ${fail} failures` : '✅ بحث الزبون والمطابقة بالغرف: 16 فحصًا ناجحًا');
