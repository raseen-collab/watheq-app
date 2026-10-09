# اختبارات وثيق المالية

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
```
