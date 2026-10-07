import { createComoAdapter } from './como/adapters.js';
import { loadConfig } from './config.js';
import { Router } from './lib/router.js';
import { purgeExpired, Session } from './lib/session.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { deny, redirect, render, respond } from './routes/helpers.js';
import { meRoutes } from './routes/me.js';
import { groupByTheme, listPrograms } from './services/programs.js';
import { getUser } from './services/users.js';
import { homePage } from './views/public.js';

const MAX_BODY = 20 * 1024;

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'none'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** Cloudflare Pages 환경 변수·바인딩으로 의존성을 만든다. D1 바인딩 이름은 DB. */
export function depsFromEnv(env) {
  const cfg = loadConfig(env);
  return { cfg, db: env.DB, como: createComoAdapter(cfg), logger: console };
}

function buildRouter() {
  const r = new Router();
  r.get('/healthz', (c) => respond(c, 'ok', { type: 'text/plain; charset=utf-8' }));
  r.get('/', async (c) => render(c, homePage, groupByTheme(await listPrograms(c.db, { publicOnly: true })), 200, { session: !!c.user }));
  authRoutes(r);
  meRoutes(r);
  adminRoutes(r);
  return r;
}

async function parseBody(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.startsWith('application/x-www-form-urlencoded')) return {};
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('payload_too_large'), { status: 413 });
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) {
    if (k in out) out[k] = [].concat(out[k], v);
    else out[k] = v;
  }
  return out;
}

function withHeaders(response, cfg, user) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
  if (cfg && cfg.isProd) res.headers.set('Strict-Transport-Security', 'max-age=31536000');
  // 개인 화면과 POST 응답은 캐시하지 않는다.
  if (user || res.headers.has('set-cookie')) res.headers.set('Cache-Control', 'no-store');
  return res;
}

function plainError(status, message) {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS } });
}

export function createApp({ resolveDeps = depsFromEnv } = {}) {
  const router = buildRouter();

  return {
    async fetch(request, env = {}, ctx = {}) {
      let deps;
      try {
        deps = resolveDeps(env);
      } catch (err) {
        console.error(err);
        return plainError(500, `설정 오류: ${err.message}`);
      }
      if (!deps.db) return plainError(500, '설정 오류: D1 데이터베이스 바인딩(DB)이 없습니다.');

      const url = new URL(request.url);
      const c = {
        ...deps,
        req: request,
        url,
        path: url.pathname,
        method: request.method,
        query: url.searchParams,
        params: {},
        body: {},
        ip: request.headers.get('cf-connecting-ip') || null,
        resHeaders: new Headers(),
        user: null,
      };
      c.session = new Session(c);

      try {
        if (c.method === 'POST') {
          const len = Number(request.headers.get('content-length') || 0);
          if (len > MAX_BODY) return withHeaders(plainError(413, '요청이 너무 큽니다.'), deps.cfg);
          c.body = await parseBody(request);
        }
        await c.session.load();
        if (c.session.userId) c.user = await getUser(c.db, c.session.userId);

        const match = router.match(c.method, c.path);
        let response = null;
        if (c.method === 'POST' && !c.session.checkCsrf(typeof c.body._csrf === 'string' ? c.body._csrf : '')) {
          response = await deny(c, 403, '요청이 만료되었습니다. 페이지를 새로 열어 다시 시도해 주세요.');
        } else if (c.user && c.user.pin_must_change && !['/account/pin', '/logout'].includes(c.path)) {
          // 관리자가 초기화한 임시 PIN으로 로그인했으면 새 PIN을 정할 때까지 다른 화면을 막는다.
          response = redirect(c, '/account/pin', 302);
        } else if (!match) {
          response = await deny(c, 404);
        } else {
          c.params = match.params;
          for (const h of match.handlers) {
            response = await h(c);
            if (response) break;
          }
          if (!response) response = await deny(c, 404);
        }
        // 만료 세션·로그인 시도 기록 정리(가끔, 응답 이후)
        if (Math.random() < 0.01 && ctx.waitUntil) ctx.waitUntil(purgeExpired(c.db).catch(() => {}));
        return withHeaders(response, deps.cfg, c.user);
      } catch (err) {
        if (err.status === 413) return withHeaders(plainError(413, '요청이 너무 큽니다.'), deps.cfg);
        deps.logger.error(err);
        try {
          return withHeaders(await deny(c, 500), deps.cfg, c.user);
        } catch {
          return plainError(500, '오류가 발생했습니다.');
        }
      }
    },
  };
}
