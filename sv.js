// sv.js - 为“智能资产配置器 Pro Max”定制的 Service Worker
// 确保离线可访问，预缓存首页、manifest 及关键资源

const CACHE_NAME = 'asset-config-cache-v1';
// 需要预缓存的关键资源列表（可根据实际扩展）
const PRECACHE_URLS = [
  '/',               // 根路径（返回 index.html）
  '/index.html',     // 显式 HTML 文件
  '/manifest.json'   // PWA 清单文件
  // 如果你有图标文件，请在这里添加，例如 '/favicon.ico', '/logo192.png' 等
];

// 静态资源扩展名（用于未来拆分文件时使用）
const STATIC_EXTENSIONS = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'eot', 'ico'];

// 判断请求是否为静态资源
function isStaticResource(url) {
  const ext = url.pathname.split('.').pop().toLowerCase();
  return STATIC_EXTENSIONS.includes(ext);
}

// 判断请求是否为主文档导航
function isNavigateRequest(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.destination === 'document');
}

// 安装阶段：预缓存关键资源
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] 预缓存资源:', PRECACHE_URLS);
        // 添加所有预缓存资源，如果某个资源 404 不影响整体（用 catch 忽略单个失败）
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn(`预缓存失败 ${url}:`, err)))
        );
      })
      .then(() => self.skipWaiting()) // 立即激活
  );
});

// 激活阶段：清理旧缓存，接管所有客户端
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] 删除旧缓存:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim()) // 立即控制所有页面
  );
});

// 请求拦截：核心缓存策略
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理同源 GET 请求
  if (url.origin !== location.origin || request.method !== 'GET') {
    return;
  }

  // ---------- 1. 导航请求（HTML 页面）：网络优先，失败回退缓存 ----------
  if (isNavigateRequest(request)) {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          // 成功时：缓存最新版本并返回
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          // 网络失败：尝试从缓存中获取
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            console.log('[SW] 离线模式，使用缓存页面:', url.pathname);
            return cachedResponse;
          }
          // 连缓存都没有（极少数情况），返回简单离线页
          return new Response(
            '<h1>📴 离线状态</h1><p>请检查网络连接后刷新页面。</p><p>您的资产配置数据仍安全存储在本地。</p>',
            { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // ---------- 2. 静态资源请求：缓存优先，未命中则网络请求并缓存 ----------
  if (isStaticResource(url)) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return networkResponse;
        }).catch(() => {
          // 彻底离线且无缓存，返回空响应
          return new Response('', { status: 408 });
        });
      })
    );
    return;
  }

  // ---------- 3. 其他请求（如 API、数据接口）默认不缓存，走网络 ----------
  // （你的所有业务数据都在 IndexedDB，不受影响）
});
