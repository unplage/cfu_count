// sw.js - 通用 Service Worker (适配 GitHub Pages 多项目)
// 动态确定当前应用的子目录，隔离缓存，确保离线访问正常

// ---------- 1. 动态路径与缓存名称 ----------
// 获取当前 sw.js 所在的目录路径（例如 '/pwa1/'）
const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '');
// 项目标识：目录最后一段（'/' -> 'root'），同一域名下多 PWA 共存时互不干扰
const PROJECT_ID = (BASE_PATH.match(/([^/]+)\/?$/) || [, 'root'])[1];
// 缓存版本号：静态资源变更时 +1
const CACHE_VERSION = 4;
// 缓存名前缀，形如 'pwa-cache-cfu_count--v'
const CACHE_PREFIX = `pwa-cache-${PROJECT_ID}--v`;
// 例如 '/cfu_count/' -> 'pwa-cache-cfu_count--v4'
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
// ONNX Runtime 的 CDN 资源单独缓存（按项目隔离，激活时只清理本项目旧版本）
const CDN_CACHE_PREFIX = `ort-cdn-${PROJECT_ID}--v`;
const CDN_CACHE_NAME = `${CDN_CACHE_PREFIX}1`;
// 旧版本命名（无法用前缀匹配），仅清理本项目的历史缓存
const LEGACY_CACHE_NAMES = [`pwa-cache${BASE_PATH.replace(/\//g, '-')}v3`];

// 预缓存资源列表（全部使用相对于当前 sw.js 的路径）
const PRECACHE_URLS = [
  BASE_PATH,                 // 例如 '/pwa1/'
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.json`,
  `${BASE_PATH}icons/icon-192.png`,
  `${BASE_PATH}icons/icon-512.png`,
  `${BASE_PATH}icons/icon-maskable-192.png`,
  `${BASE_PATH}icons/icon-maskable-512.png`,
  `${BASE_PATH}icons/favicon.ico`,
  `${BASE_PATH}icons/apple-touch-icon-180.png`,
];

// 静态资源扩展名（用于判断是否缓存优先）
const STATIC_EXTENSIONS = ['js', 'css', 'json', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'eot', 'ico', 'wasm'];

// ---------- 2. 工具函数 ----------
function isStaticResource(url) {
  const ext = url.pathname.split('.').pop().toLowerCase();
  return STATIC_EXTENSIONS.includes(ext);
}

function isNavigateRequest(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.destination === 'document');
}

// 缓存优先策略：命中缓存直接返回，否则请求网络并写入缓存
function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    cache.match(request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;
      return fetch(request).then(networkResponse => {
        // 仅缓存成功的 GET 响应（opaque 响应也可缓存，便于离线使用）
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const responseClone = networkResponse.clone();
          cache.put(request, responseClone).catch(err => console.warn('[SW] 写入缓存失败:', err));
        }
        return networkResponse;
      }).catch(() => new Response('', { status: 408 }));
    })
  );
}

// ---------- 3. 安装阶段 ----------
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中，BASE_PATH =', BASE_PATH);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] 预缓存资源:', PRECACHE_URLS);
        // 使用 allSettled 忽略单个资源失败
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn(`预缓存失败 ${url}:`, err)))
        );
      })
      .then(() => self.skipWaiting()) // 立即激活
  );
});

// ---------- 4. 激活阶段（只清理当前项目的旧缓存） ----------
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          // 仅删除"本项目前缀 + 非当前版本"的缓存，其它 PWA 的缓存一律不动
          const isOwnOldVersion =
            (cache.startsWith(CACHE_PREFIX) && cache !== CACHE_NAME) ||
            (cache.startsWith(CDN_CACHE_PREFIX) && cache !== CDN_CACHE_NAME) ||
            LEGACY_CACHE_NAMES.includes(cache);
          if (isOwnOldVersion) {
            console.log('[SW] 删除本项目旧缓存:', cache);
            return caches.delete(cache);
          }
          return undefined;
        })
      );
    }).then(() => self.clients.claim()) // 立即控制所有页面
  );
});

// ---------- 5. 请求拦截 ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);

  // ----- 5.0 ONNX Runtime CDN 资源：缓存优先，首次联网后支持离线推理 -----
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/onnxruntime-web@')) {
    event.respondWith(cacheFirst(request, CDN_CACHE_NAME));
    return;
  }

  // 其余只处理同源请求
  if (url.origin !== location.origin) {
    return;
  }

  // ----- 5.1 导航请求（HTML）：网络优先，失败回退缓存 -----
  if (isNavigateRequest(request)) {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          // 网络失败，只从本项目缓存获取，避免误命中其它 PWA 的同名资源
          const cache = await caches.open(CACHE_NAME);
          const cachedResponse = await cache.match(request);
          if (cachedResponse) {
            console.log('[SW] 离线模式，使用缓存页面:', url.pathname);
            return cachedResponse;
          }
          // 连缓存都没有，返回自定义离线页（可预置 offline.html）
          // 如果希望更美观，可以预缓存一个 offline.html 并在这里返回它
          return new Response(
            '<h1>📴 离线状态</h1><p>请检查网络连接后刷新页面。</p>',
            { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // ----- 5.2 静态资源请求：缓存优先，未命中则网络请求并缓存 -----
  if (isStaticResource(url)) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // ----- 5.3 其他请求（如 API）默认不缓存，直接走网络 -----
  // （业务数据通常存储在 IndexedDB 中，不受影响）
});
