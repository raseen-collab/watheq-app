# اختبارات وثيق

**كلها بأمر واحد:** `bash scripts/test-all.sh` — يبني الحزم ويشغّل كل `tests/*.js` بتوقيت الرياض، ويخرج بخطأ عند أي فشل.
**فحص الدخان (390px):** بعد `npx next build && npx next start -p 3000` ← `node tests/smoke.cjs`.
**CI:** `.github/workflows/ci.yml` يشغّل tsc ← next build ← الاختبارات ← فحص الدخان على كل رفع وكل Pull Request.

## الاختبارات المالية

شغّلها قبل أي رفع يمسّ الحسابات:

```bash
npx esbuild lib/contracts.ts  --bundle --format=cjs --platform=node --outfile=/tmp/c.js    --alias:@=.
npx esbuild lib/documents.ts  --bundle --format=cjs --platform=node --outfile=/tmp/docs.js --alias:@=.
npx esbuild lib/expenses.ts   --bundle --format=cjs --platform=node --outfile=/tmp/exp.js  --alias:@=.

node tests/exhaustive.js    # كل التوليفات + شاهد مستقل
node tests/adversarial.js   # مدخلات فاسدة ومتطرفة
node tests/sim.js           # 55 عقارًا · 700 وحدة
node tests/recon.js         # مطابقة الأرقام بين الشاشات
node tests/edge.js          # حواف معروفة
```

المطلوب: ✅ في كل واحد. أي ❌ يعني رقمًا خاطئًا سيراه مالك أو مشترك.

## رفع الوحدات من إكسل — «طابق أعمدتك»

```bash
npx esbuild lib/importParse.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/importParse.js
node tests/import-mapping.js
TZ=Asia/Riyadh node tests/import-mapping.js   # تواريخ إكسل بتوقيت الرياض
TZ=Asia/Riyadh node tests/import-office-files.js   # ملفات المكاتب كما تأتي (عنوان، «م»، نهاية العقد، المجموع، الهجري)
node tests/rent-collection-import.js   # جدول التحصيل المجاني من الموقع
TZ=Asia/Riyadh node tests/import-600.js   # 600 ملف مكتب مختلف: صفر رقم خاطئ صامت، وكل صف فاسد مرفوض (~15 ثانية)
```

## بحث الزبون في المعروضات

```bash
npx esbuild lib/listings.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/listings.js
npx esbuild lib/requests.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/requests.js
node tests/listings-search.js
```

## المسوّق العقاري (2 نوفمبر 2026)

```bash
for f in roles:roles entitlements:ent pricing:pricing listings:listings requests:requests ads:ads listingPublic:lpub; do
  npx esbuild lib/${f%%:*}.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/${f##*:}.js; done
node tests/marketer.js   # الأدوار، 399 سنوي، السعي والتفويض، المتابعة، الإعلان بلا ترخيص، صفحة الزبون
```

## النسخة الاحتياطية اليومية (22 نوفمبر 2026)

```bash
npx esbuild lib/backup-crypto.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/backupCrypto.js
npx esbuild lib/backup.ts --bundle --format=cjs --platform=node --alias:@=. --external:@supabase/supabase-js --outfile=/tmp/b/backup.js
node tests/backup.js         # التشفير، التلاعب، المفتاح الخاطئ، قائمة الجداول، الاحتفاظ 30 يومًا
node tests/backup-build.js   # صفحات >1000 بلا فقد ولا تكرار، جدول فاشل يُبلَّغ، المستخدمون بلا كلمات مرور
```
