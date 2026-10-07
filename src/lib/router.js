// 작은 라우터: '/me/grow/:id' 형태의 경로와 순서대로 실행되는 핸들러 목록.
// 핸들러가 Response를 돌려주면 처리 종료, null/undefined면 다음 핸들러로 넘어간다.
export class Router {
  constructor() {
    this.routes = [];
  }

  on(method, path, handlers) {
    const keys = [];
    const pattern = new RegExp(`^${path.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; })}$`);
    this.routes.push({ method, pattern, keys, handlers });
  }

  get(path, ...handlers) { this.on('GET', path, handlers); }
  post(path, ...handlers) { this.on('POST', path, handlers); }

  match(method, pathname) {
    const m = method === 'HEAD' ? 'GET' : method;
    for (const r of this.routes) {
      if (r.method !== m) continue;
      const hit = r.pattern.exec(pathname);
      if (!hit) continue;
      const params = {};
      r.keys.forEach((k, i) => {
        try { params[k] = decodeURIComponent(hit[i + 1]); } catch { params[k] = hit[i + 1]; }
      });
      return { handlers: r.handlers, params };
    }
    return null;
  }
}
