/* ============================================================
   عامل الخدمة (Service Worker) — وثيق
   ------------------------------------------------------------
   غرضه الوحيد: استيفاء شرط كروم لإظهار زر «تثبيت التطبيق»،
   وهو وجود مستمع fetch.

   ⚠️ لا يعترض أي طلب ولا يخزّن شيئًا.

   النسخة السابقة كانت تستدعي:
       event.respondWith(fetch(event.request));
   وهذا خطأ: أي فشل شبكة عابر يتحول إلى استجابة خطأ صلبة
   (FetchEvent … resulted in a network error response) بدل أن
   يتكفّل المتصفح بالأمر كما لو لم يكن هناك عامل خدمة أصلًا.
   المستمع الفارغ يحقق شرط التثبيت ولا يمسّ أي طلب.
   ============================================================ */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // احذف أي مخزن خلّفته نسخة سابقة
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// مستمع بلا respondWith: المتصفح يتولى الطلب كالمعتاد
self.addEventListener("fetch", () => {});
