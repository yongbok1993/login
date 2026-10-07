import { errorPage } from '../views/public.js';

export function buildCtx(req, extra = {}) {
  return {
    user: req.user || null,
    csrf: req.session.csrf,
    flash: req.session.takeFlash(),
    path: req.path,
    devNotice: req.app.locals.devNotice,
    ...extra,
  };
}

/** view(ctx, props) 결과를 HTML로 응답한다. */
export function render(req, res, view, props, status = 200) {
  const ctx = buildCtx(req);
  res.status(status).type('html').send(String(props === undefined ? view(ctx) : view(ctx, props)));
}

export function deny(req, res, status, message) {
  const area = req.path.startsWith('/admin') ? 'admin' : req.user && req.user.role === 'participant' ? 'me' : 'public';
  res.status(status).type('html').send(String(errorPage(buildCtx(req, { area: req.user ? area : 'public' }), status, message)));
}

export function requireLogin(req, res, next) {
  if (!req.user) return res.redirect(303, '/login');
  next();
}

export function requireParticipant(req, res, next) {
  if (!req.user) return res.redirect(303, '/login');
  if (req.user.role !== 'participant') return res.redirect(303, '/admin');
  next();
}

/** 선정된 참여자만. 링크 노출 여부와 별개로 서버에서 확인한다. */
export function requireSelected(req, res, next) {
  if (!req.user) return res.redirect(303, '/login');
  if (req.user.role !== 'participant' || !req.user.is_selected) {
    return deny(req, res, 403, '선정된 참여자만 이용할 수 있습니다.');
  }
  next();
}

export function requireStaff(req, res, next) {
  if (!req.user) return res.redirect(303, '/login');
  if (req.user.role !== 'staff' && req.user.role !== 'manager') return deny(req, res, 403);
  next();
}

export function requireManager(req, res, next) {
  if (!req.user) return res.redirect(303, '/login');
  if (req.user.role !== 'manager') return deny(req, res, 403);
  next();
}

export function intParam(v) {
  return /^\d{1,10}$/.test(String(v)) ? Number(v) : null;
}
