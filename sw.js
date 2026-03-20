// ================================================================
//  K8 Defect Management — Service Worker
//  TWA / PWA 오프라인 지원
// ================================================================

const CACHE_NAME = 'k8-defect-v1';

// 캐시할 앱 쉘 파일
const APP_SHELL = ['/', '/action'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Google APIs / Apps Script: 캐시 안 함
  const url = event.request.url;
  if (url.includes('script.google.com') || url.includes('googleapis.com') || url.includes('google.com/macros')) {
    return;
  }

  // 네비게이션(페이지 전환): 네트워크 우선, 실패 시 캐시
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request).then(r => r || caches.match('/')))
    );
    return;
  }

  // 정적 파일: 캐시 우선
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
