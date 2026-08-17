/* ============================================================
   عامل الخدمة (Service Worker) — وثيق
   ------------------------------------------------------------
   ⚠️ بلا مستمع fetch إطلاقًا — عن قصد.

   كروم الحديث لم يعد يشترط مستمع fetch لإظهار زر «تثبيت التطبيق»،
   بل صار ينبّه على المستمع الفارغ:
     "No-op fetch handler may bring overhead during navigation.
      Consider removing the handler if possible."

   فالنسخة الأولى (respondWith) كسرت الطلبات، والثانية (مستمع فارغ)
   أضافت عبئًا بلا فائدة. الصحيح: لا مستمع أصلًا.
   التثبيت يعمل بالبيان (manifest) والأيقونات وحدها.
   ============================================================ */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});
