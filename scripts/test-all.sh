#!/usr/bin/env bash
# وثيق — تشغيل كل الاختبارات (22 نوفمبر 2026)
# يبني حزم lib/ التي تحتاجها الاختبارات إلى /tmp ثم يشغّل كل tests/*.js بتوقيت الرياض.
# أي اختبار يفشل = خروج بخطأ (CI يوقف الدمج). تشغيل محلي: bash scripts/test-all.sh
set -uo pipefail
cd "$(dirname "$0")/.."
ESB="npx --yes esbuild@0.23.1"
mkdir -p /tmp/b
build_fail=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  eval "${line/npx esbuild/$ESB} --log-level=error" || { echo "✗ build: $line"; build_fail=1; }
done <<'BUILDS'
npx esbuild lib/ads.ts          --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/ads.js
npx esbuild lib/ads.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/ads.js
npx esbuild lib/backup-crypto.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/backupCrypto.js
npx esbuild lib/backup.ts --bundle --format=cjs --platform=node --alias:@=. --external:@supabase/supabase-js --outfile=/tmp/b/backup.js
npx esbuild lib/backup-photos.ts --bundle --format=cjs --platform=node --alias:@=. --external:@supabase/supabase-js --outfile=/tmp/b/backupPhotos.js
npx esbuild lib/backup-crypto.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/backupCryptoP.js
npx esbuild lib/backupReminder.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/backupReminder.js
npx esbuild lib/clock-diag.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/clock-diag.js
npx esbuild lib/collection.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/collection.js
npx esbuild lib/contract-state.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/contract-state.js
npx esbuild lib/contract-state.ts lib/contracts.ts --bundle --format=cjs --platform=node --alias:@=. --outdir=/tmp/b
npx esbuild lib/contracts.ts  --bundle --format=cjs --platform=node --outfile=/tmp/c.js    --alias:@=.
npx esbuild lib/contracts.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/contracts.js
npx esbuild lib/db-retry.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/db-retry.js
npx esbuild lib/docEn.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/docEn.js
npx esbuild lib/documents.ts  --bundle --format=cjs --platform=node --outfile=/tmp/docs.js --alias:@=.
npx esbuild lib/documents.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/documents.js
npx esbuild lib/documents.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/docs.js
npx esbuild lib/domain.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/domain.js
npx esbuild lib/export-extras.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/exportExtras.js
npx esbuild lib/friendlyError.ts --bundle --format=cjs --platform=node --external:@sentry/nextjs --outfile=/tmp/b/friendlyError.js
npx esbuild lib/confirm.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/confirm.js
npx esbuild lib/office-copy.ts --bundle --format=cjs --platform=node --alias:@=. --external:@supabase/supabase-js --outfile=/tmp/b/officeCopy.js
npx esbuild lib/msg-lang.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/msgLang.js
npx esbuild lib/doc-search.ts --bundle --format=cjs --platform=node --outfile=/tmp/b/docSearch.js
npx esbuild lib/tenant-messages.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/tenantMessages.js
npx esbuild lib/einvoice.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/einvoice.js
npx esbuild lib/fee-invoice.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/fee-invoice.js
npx esbuild lib/help-ai.ts lib/help-kb.ts --bundle --format=cjs --platform=node --alias:@=. --outdir=/tmp/b/helpai
npx esbuild lib/support-weekly.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/support-weekly.js
npx esbuild lib/analytics-scrub.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/analytics-scrub.js
npx esbuild lib/entitlements.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/ent.js
npx esbuild lib/expenses.ts   --bundle --format=cjs --platform=node --outfile=/tmp/exp.js  --alias:@=.
npx esbuild lib/expenses.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/expenses.js
npx esbuild lib/funnel.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/funnel.js
npx esbuild lib/importParse.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/importParse.js
npx esbuild lib/importPayload.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/importPayload.js
npx esbuild lib/listingPublic.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/lpub.js
npx esbuild lib/listings.ts     --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/listings.js
npx esbuild lib/listings.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/listings.js
npx esbuild lib/maintenance.ts  --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/maint.js
npx esbuild lib/office-ledger.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/office-ledger.js
npx esbuild lib/portalNotify.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/pnotify.js --external:./telegram
npx esbuild lib/pricing.ts      --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/pricing.js
npx esbuild lib/pricing.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/pricing.js
npx esbuild lib/problem-report.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/problemReport.js
npx esbuild lib/real-data.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/real-data.js
npx esbuild lib/requests.ts     --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/requests.js
npx esbuild lib/requests.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/requests.js
npx esbuild lib/roles.ts        --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/roles.js
npx esbuild lib/roles.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/roles.js
npx esbuild lib/sandbox-db.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/sandbox-db.js
npx esbuild lib/signup-sources.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/signup-sources.js
npx esbuild lib/tenant-messages.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/tenant-messages.js
npx esbuild lib/tenantPortal.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/tenantPortal.js
npx esbuild lib/tenantPortal.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/tportal.js
npx esbuild lib/trust.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/trust.js
npx esbuild lib/accounting-export.ts --bundle --format=cjs --platform=node --alias:@=. --outfile=/tmp/b/acctExport.js
BUILDS
[ $build_fail -eq 0 ] || { echo "فشل بناء حزم الاختبار"; exit 1; }

pass=0; fail=0; failed=()
for f in tests/*.js; do
  if out=$(TZ=Asia/Riyadh timeout 300 node "$f" 2>&1); then
    pass=$((pass+1)); echo "✓ $f — $(echo "$out" | tail -1)"
  else
    fail=$((fail+1)); failed+=("$f"); echo "✗ $f"; echo "$out" | tail -15
  fi
done
echo "──────── $pass ناجح · $fail فاشل"
[ $fail -eq 0 ] || { printf '  ✗ %s\n' "${failed[@]}"; exit 1; }
