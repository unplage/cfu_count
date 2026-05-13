// sv.js - 通用 GitHub Pages 缓存 Service Worker
// 策略：
// - 导航/HTML 请求：网络优先 (Network First)，网络失败时回退缓存
// - 静态资源 (js,css,图片,字体等)：缓存优先 (Cache First)，缓存缺失时请求网络并缓存
// - 同源请求有效，跨域请求不处理

const CACHE_NAME = 'gh-pages-cache-v1';      // 缓存版本，修改后会自动更新
const STATIC_EXTENSIONS = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'eot'];

// 判断是否为静态资源（基于扩展名）
function isStaticResource(url) {
  const ext = url.pathname.split('.').pop().toLowerCase();
  return STATIC_EXTENSIONS.includes(ext);
}

// 判断是否为导航请求（页面主体加载）
function isNavigateRequest(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.destination === 'document');
}

// 安装事件 - 可选预缓存（这里默认不做预缓存，保持通用，可自行取消注释）
self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  // 强制等待中的 SW 立即激活
  self.skipWaiting();
});

// 激活事件 - 清理旧缓存，控制所有未控制的客户端
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] 删除旧缓存', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 主请求拦截逻辑
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理同源 GET 请求（避免跨域、POST 等复杂情况）
  if (url.origin !== location.origin || request.method !== 'GET') {
    return;
  }

  // ---------- 1. 导航请求（HTML 页面）采用 Network First ----------
  if (isNavigateRequest(request)) {
    event.respondWith(
      fetch(request).then((networkResponse) => {
        // 网络请求成功，克隆并存入缓存
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      }).catch(async () => {
        // 网络失败，尝试从缓存中获取
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          console.log('[SW] 使用缓存 HTML:', url.pathname);
          return cachedResponse;
        }
        // 连缓存都没有，返回一个简单的离线提示
        return new Response(
          '<h1>你现在处于离线状态</h1><p>请检查网络连接，并重新加载此页面。</p>',
          { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html' } }
        );
      })
    );
    return;
  }

  // ---------- 2. 静态资源（JS/CSS/图片等）采用 Cache First ----------
  if (isStaticResource(url)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // 命中缓存，直接返回（同时后台静默更新缓存，保持新鲜，可选）
          // 这里为了简单，不做 stale-while-revalidate，有需要可以自行添加
          return cachedResponse;
        }
        // 缓存缺失，请求网络并存入缓存
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        }).catch(() => {
          // 网络失败且无缓存，返回空（让浏览器的默认错误页面处理）
          return new Response('Resource not available offline', { status: 408 });
        });
      })
    );
    return;
  }

  // 其他类型的请求（如 API、其他同源请求）默认走网络，不缓存
  // 如果需要，可自行添加策略
});
