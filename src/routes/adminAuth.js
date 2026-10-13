import { hashPassword, loginIdProblem, normalizeLoginId, passwordProblem, verifyPassword } from '../lib/password.js';
import { verifyPin } from '../lib/pin.js';
import { loginBlock, PHONE_LOCK_MINUTES, recordAttempt } from '../services/login.js';
import { findAdminByLoginId, isAdminRole, setAdminCredentials } from '../services/users.js';
import { adminAccountForm, adminLoginForm } from '../views/adminAuth.js';
import { field, redirect, render, requireStaff } from './helpers.js';

const LOGIN_FAILED = '아이디 또는 비밀번호가 맞지 않습니다.';
// 로그인 시도 기록·잠금은 번호 대신 'id:<아이디>'를 키로 쓴다.
const attemptKey = (loginId) => `id:${loginId}`;

/** 관리자(운영 담당·전체 관리자) 로그인: 아이디 + 비밀번호 */
export function adminAuthRoutes(r) {
  r.get('/admin/login', (c) => {
    if (isAdminRole(c.user)) return redirect(c, '/admin', 302);
    return render(c, adminLoginForm, {});
  });

  r.post('/admin/login', async (c) => {
    const { db, cfg } = c;
    const loginId = normalizeLoginId(field(c, 'login_id'));
    const fail = (error) => render(c, adminLoginForm, { loginId, error }, 422);
    if (!loginId) return fail(LOGIN_FAILED);
    if (await loginBlock(db, { phone: attemptKey(loginId), ip: c.ip })) {
      return fail(`로그인 시도가 많아 잠시 잠겼습니다. ${PHONE_LOCK_MINUTES}분 뒤 다시 시도하거나 전체 관리자에게 문의해 주세요.`);
    }
    const user = await findAdminByLoginId(db, loginId);
    const ok = await verifyPassword(cfg.sessionSecret, field(c, 'password'), user && user.password_hash);
    await recordAttempt(db, { kind: 'login', phone: attemptKey(loginId), ip: c.ip, success: ok && !!user });
    if (!ok || !user) return fail(LOGIN_FAILED);
    await c.session.regenerate(user.id);
    return redirect(c, user.password_must_change ? '/admin/account' : '/admin');
  });

  // ── 본인 아이디·비밀번호 설정/변경 ──
  r.get('/admin/account', requireStaff, (c) => render(c, adminAccountForm, {}));

  r.post('/admin/account', requireStaff, async (c) => {
    const { db, cfg, user } = c;
    const values = { login_id: field(c, 'login_id') };
    const fail = (errors, status = 422) => render(c, adminAccountForm, { values, errors }, status);
    const lockKey = user.password_hash && user.login_id ? attemptKey(user.login_id) : user.phone;
    if (await loginBlock(db, { phone: lockKey })) return fail({ current: '시도가 많아 잠시 잠겼습니다. 잠시 후 다시 시도해 주세요.' }, 429);
    const current = field(c, 'current');
    const okCurrent = user.password_hash
      ? await verifyPassword(cfg.sessionSecret, current, user.password_hash)
      : await verifyPin(cfg.sessionSecret, current, user.pin_hash);
    await recordAttempt(db, { kind: 'pin', phone: lockKey, ip: c.ip, success: okCurrent });
    if (!okCurrent) return fail({ current: user.password_hash ? '비밀번호가 맞지 않습니다.' : 'PIN이 맞지 않습니다.' });
    const loginId = normalizeLoginId(values.login_id);
    const errors = {};
    const idProblem = loginIdProblem(loginId);
    if (idProblem) errors.login_id = idProblem;
    const password = field(c, 'password');
    const problem = passwordProblem(password, { loginId });
    if (problem) errors.password = problem;
    else if (password !== field(c, 'password_confirm')) errors.password_confirm = '비밀번호가 서로 다릅니다.';
    else if (user.password_hash && current === password) errors.password = '현재 비밀번호와 다른 비밀번호를 입력해 주세요.';
    if (Object.keys(errors).length) return fail(errors);
    const saved = await setAdminCredentials(db, user.id, { loginId, passwordHash: await hashPassword(cfg.sessionSecret, password) },
      c.session.tokenHash);
    if (!saved) return fail({ login_id: '이미 사용 중인 아이디입니다.' });
    await c.session.regenerate(user.id);
    await c.session.flash('ok', '아이디와 비밀번호가 저장되었습니다. 다음부터 관리자 로그인 화면에서 로그인해 주세요.');
    return redirect(c, '/admin');
  });
}
