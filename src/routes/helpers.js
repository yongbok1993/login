import { errorPage } from '../views/public.js';

export function respond(c, body, { status = 200, type = 'text/html; charset=utf-8' } = {}) {
  const headers = new Headers(c.resHeaders);
  headers.set('content-type', type);
  return new Response(c.method === 'HEAD' ? null : body, { status, headers });
}

export function redirect(c, location, status = 303) {
  const headers = new Headers(c.resHeaders);
  headers.set('location', location);
  return new Response(null, { status, headers });
}

/**
 * 화면 공통 컨텍스트. session=true면 CSRF 토큰을 위해 세션을 만든다(폼이 있는 화면).
 * 비로그인 공개 화면은 세션을 만들지 않는다.
 */
export async function buildCtx(c, { session = true, area } = {}) {
  if (session) await c.session.ensure();
  return {
    user: c.user || null,
    csrf: c.session.csrf,
    flash: c.session.row ? await c.session.takeFlash() : null,
    path: c.path,
    devNotice: c.cfg && !c.cfg.isProd ? '개발 환경' : null,
    area,
  };
}

/** view(ctx, props) 결과를 HTML로 응답한다. props가 undefined면 view(ctx). */
export async function render(c, view, props, status = 200, opts = {}) {
  const ctx = await buildCtx(c, opts);
  return respond(c, String(props === undefined ? view(ctx) : view(ctx, props)), { status });
}

export async function deny(c, status, message) {
  const area = c.path.startsWith('/admin') && c.user ? 'admin' : c.user && c.user.role === 'participant' ? 'me' : 'public';
  return render(c, (ctx) => errorPage(ctx, status, message), undefined, status, { session: !!c.user, area });
}

// ── 접근 제어(핸들러 앞에 둔다. Response를 돌려주면 처리 중단) ──

export function requireLogin(c) {
  return c.user ? null : redirect(c, '/login');
}

export function requireParticipant(c) {
  if (!c.user) return redirect(c, '/login');
  if (c.user.role !== 'participant') return redirect(c, '/admin');
  return null;
}

/** 선정된 참여자만. 링크 노출 여부와 별개로 서버에서 확인한다. */
export function requireSelected(c) {
  if (!c.user) return redirect(c, '/login');
  if (c.user.role !== 'participant' || !c.user.is_selected) return deny(c, 403, '선정된 참여자만 이용할 수 있습니다.');
  return null;
}

export function requireStaff(c) {
  if (!c.user) return redirect(c, '/login');
  if (c.user.role !== 'staff' && c.user.role !== 'manager') return deny(c, 403);
  return null;
}

export function requireManager(c) {
  if (!c.user) return redirect(c, '/login');
  if (c.user.role !== 'manager') return deny(c, 403);
  return null;
}

export function intParam(v) {
  return /^\d{1,10}$/.test(String(v)) ? Number(v) : null;
}

/** 폼 값: 단일 문자열 */
export function field(c, name) {
  const v = c.body[name];
  return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
}

/** 폼 값: 같은 이름이 여러 개인 체크박스 */
export function fieldList(c, name) {
  const v = c.body[name];
  return v === undefined ? [] : [].concat(v).map(String);
}
