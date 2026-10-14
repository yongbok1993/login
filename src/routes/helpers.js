import { canUseInternal, isApprovedParticipant } from '../services/users.js';
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
// 메뉴 노출과 관계없이 모든 화면·요청에서 서버가 로그인·역할·승인 상태를 확인한다.
// 사용자 정보는 요청마다 DB에서 다시 읽으므로 승인 해제·이용 중지·로그아웃은 즉시 반영된다.

export function requireLogin(c) {
  return c.user ? null : redirect(c, '/login');
}

/** 참여자(승인 대기 포함) 본인 화면 */
export function requireParticipant(c) {
  if (!c.user) return redirect(c, '/login');
  if (c.user.role !== 'participant') return redirect(c, '/admin');
  return null;
}

function notApprovedMessage(user) {
  if (user.account_status === 'suspended') return '이용이 중지된 상태입니다. 자세한 내용은 담당자에게 문의해 주세요.';
  return '신청이 접수되었습니다. 참여 확정 후 내부 서비스를 이용할 수 있습니다.';
}

/** 승인된(이용 중인) 참여자만 */
export function requireSelected(c) {
  if (!c.user) return redirect(c, '/login');
  if (!isApprovedParticipant(c.user)) {
    return c.user.role === 'participant' ? deny(c, 403, notApprovedMessage(c.user)) : deny(c, 403);
  }
  return null;
}

/** 게시판: 로그인한 신청자(승인 대기·승인 해제 포함)와 담당자. 이용 중지 계정은 제외 */
export function requireBoardUser(c) {
  if (!c.user) return redirect(c, '/login');
  if (c.user.role === 'participant' && c.user.account_status === 'suspended') return deny(c, 403, notApprovedMessage(c.user));
  return null;
}

/** 내부 서비스(상세 프로그램 등): 승인된 참여자와 관리자 */
export function requireMember(c) {
  if (!c.user) return redirect(c, '/login');
  if (!canUseInternal(c.user)) return deny(c, 403, notApprovedMessage(c.user));
  return null;
}

export function requireStaff(c) {
  if (!c.user) return redirect(c, '/admin/login');
  if (c.user.role !== 'staff' && c.user.role !== 'manager') return deny(c, 403);
  return null;
}

export function requireManager(c) {
  if (!c.user) return redirect(c, '/admin/login');
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
